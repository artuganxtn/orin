import { randomUUID } from 'node:crypto';
import { withTx } from './db.ts';
import { requireVerifiedKyc } from './kyc.ts';

export class WithdrawalError extends Error {
  constructor(message: string, public status = 400, public code = 'withdrawal_error') {
    super(message);
  }
}

export interface WithdrawalRequestInput {
  accountId?: string;
  amountCents: number;
  coin?: string;
  currency?: string;
  address: string;
  now?: number | Date;
}

export async function requestWithdrawal(
  user: { id: string },
  input: WithdrawalRequestInput
) {
  const amountCents = Number(input.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new WithdrawalError('المبلغ غير صالح.', 400);
  }
  const address = String(input.address || '').trim();
  if (!address || address.length < 5 || address.length > 256) {
    throw new WithdrawalError('عنوان المحفظة غير صالح.', 400);
  }
  const coin = String(input.coin || 'USDT').toUpperCase();
  const currency = String(input.currency || 'USD').toUpperCase();
  const nowMs = input.now ? (input.now instanceof Date ? input.now.getTime() : Number(input.now)) : Date.now();

  return await withTx(async (client) => {
    // Verify user profile is active
    const pRes = await client.query('SELECT id, disabled FROM profiles WHERE id = $1', [user.id]);
    if (pRes.rowCount === 0 || pRes.rows[0].disabled) {
      throw new WithdrawalError('الوصول إلى الحساب غير متاح.', 403);
    }

    // Verify OTP proof bound to sha256(userId|amountCents|coin|address) if provided or strictly required
    const proofId = (input as any).proofId || (input as any).otpProofId;
    if (proofId) {
      const { computeWithdrawalBoundHash, consumeOtpProof } = await import('./otp.js');
      const boundHash = computeWithdrawalBoundHash(user.id, amountCents, coin, address);
      const proofConsumed = await consumeOtpProof(proofId, user.id, 'withdrawal', boundHash, client);
      if (!proofConsumed) {
        throw new WithdrawalError('رمز تأكيد السحب غير صالح أو مستخدم مسبقًا / Invalid or consumed OTP proof', 403, 'otp_required');
      }
    } else if (process.env.ORIN_STRICT_WITHDRAWAL_OTP === 'true') {
      throw new WithdrawalError('رمز التأكيد للبريد الإلكتروني مطلوب للسحب / OTP proof required', 403, 'otp_required');
    }

    // Verify account belongs to user
    let accountId = input.accountId;
    if (!accountId) {
      const accRes = await client.query(
        "SELECT id, balance_cents, reserved_cents FROM accounts WHERE user_id = $1 AND type = 'real' LIMIT 1",
        [user.id]
      );
      if (accRes.rowCount === 0) {
        throw new WithdrawalError('الحساب غير موجود.', 404);
      }
      accountId = accRes.rows[0].id;
    }

    const accRes = await client.query(
      'SELECT id, balance_cents, reserved_cents FROM accounts WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [accountId, user.id]
    );
    if (accRes.rowCount === 0) {
      throw new WithdrawalError('الحساب غير موجود.', 404);
    }

    const account = accRes.rows[0];

    // Check sum of pending/approved withdrawals that have not yet been paid
    const pendingRes = await client.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total_pending
       FROM withdrawal_requests
       WHERE account_id = $1 AND status IN ('requested', 'approved')`,
      [accountId]
    );
    const pendingCents = BigInt(pendingRes.rows[0]?.total_pending || 0);

    // Check wallet spot/futures balance if contract_wallets document exists
    const docRes = await client.query(
      `SELECT data FROM docs WHERE collection = 'contract_wallets' AND id = $1 FOR UPDATE`,
      [accountId]
    );
    const walletData = docRes.rows[0]?.data?.wallet;
    if (walletData && walletData.perpetualCents !== undefined && walletData.perpetualCents !== null) {
      const perpetualCents = BigInt(Math.max(0, Number(walletData.perpetualCents || 0)));
      const withdrawablePerp = perpetualCents - pendingCents;
      if (withdrawablePerp < BigInt(amountCents) && perpetualCents > 0n) {
        throw new WithdrawalError(
          'أموال العقود الآجلة مقفلة ولا يمكن سحبها مباشرة. يرجى تحويل الرصيد المطلوب إلى العقود الفورية أولاً للسحب. / Futures balance is locked. Transfer funds to Spot (العقود الفورية) before withdrawing.',
          409,
          'futures_locked'
        );
      }
    }

    const availableCash = BigInt(account.balance_cents) - BigInt(account.reserved_cents);
    if (availableCash < BigInt(amountCents)) {
      throw new WithdrawalError('المبلغ المطلوب يتجاوز الرصيد النقدي المتاح في الحساب. / Requested debit exceeds withdrawable cash', 409);
    }

    // Always 5% withdrawal fee
    const feeCents = Math.round(amountCents * 0.05);
    const netAmountCents = amountCents - feeCents;

    const wdId = 'wd-' + randomUUID();
    await client.query(
      `INSERT INTO withdrawal_requests (id, user_id, account_id, amount_cents, fee_cents, net_amount_cents, currency, coin, address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'requested')`,
      [wdId, user.id, accountId, amountCents, feeCents, netAmountCents, currency, coin, address]
    );

    // Immediately create journal and journal entries to debit user's cash balance
    // The database trigger apply_journal_entry_to_account automatically subtracts amountCents from accounts.balance_cents
    const journalId = 'jnl-wd-' + randomUUID();
    await client.query(
      `INSERT INTO journals (id, kind, reference, created_at) VALUES ($1, 'withdrawal', $2, NOW())`,
      [journalId, wdId]
    );
    await client.query(
      `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
       ($1, $2, $3, 'cash', -$4),
       ($1, NULL, NULL, 'system:payout-clearing', $4)`,
      [journalId, user.id, accountId, amountCents]
    );

    // Deduct amountCents from perpetualCents in contract_wallets doc if present
    if (docRes.rows[0]?.data) {
      const wState = docRes.rows[0].data;
      if (wState.wallet) {
        wState.wallet.perpetualCents = Math.max(0, (Number(wState.wallet.perpetualCents) || 0) - amountCents);
        wState.wallet.version = (wState.wallet.version || 1) + 1;
        wState.wallet.updatedAt = Date.now();
        await client.query(
          `UPDATE docs SET data = $1, updated_at = NOW() WHERE collection = 'contract_wallets' AND id = $2`,
          [JSON.stringify(wState), accountId]
        );
      }
    }

    // Also register an approval record so it appears under financial approvals
    await client.query(
      `INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, created_at)
       VALUES ($1, 'withdrawal', $2, $3, $4, $5, $6, 'pending', $7, $8, $9, NOW())
       ON CONFLICT (id) DO NOTHING`,
      ['appr-' + wdId, user.id, accountId, -amountCents, Number(account.balance_cents), Number(account.balance_cents) - amountCents, `طلب سحب ${amountCents / 100} ${coin} إلى ${address}`, wdId, user.id]
    );

    return {
      ok: true,
      id: wdId,
      amountCents,
      feeCents,
      feeRate: 0.05,
      netAmountCents,
      coin,
      currency,
      address,
      status: 'requested',
      message: 'تم استلام طلب السحب وخصم الرصيد بنجاح. سيتم مراجعته وتحويله من قِبل الإدارة.'
    };
  });
}

export async function proposeWithdrawalApproval(
  admin1: { id: string },
  input: { withdrawalId: string; reason?: string }
) {
  const wdId = input.withdrawalId;
  return await withTx(async (client) => {
    const wdRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1', [wdId]);
    if (wdRes.rowCount === 0) {
      throw new WithdrawalError('طلب السحب غير موجود.', 404);
    }
    const wd = wdRes.rows[0];
    if (wd.status !== 'requested') {
      throw new WithdrawalError(`طلب السحب في حالة لا تسمح بطلب الموافقة (${wd.status}).`, 409);
    }

    const accRes = await client.query('SELECT balance_cents FROM accounts WHERE id = $1', [wd.account_id]);
    const balanceCents = Number(accRes.rows[0]?.balance_cents || 0);

    const apprId = 'appr-' + randomUUID();
    const deltaCents = -Number(wd.amount_cents);
    const afterCents = balanceCents + deltaCents;
    const reason = input.reason || 'Administrative withdrawal approval request';

    await client.query(
      `INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by)
       VALUES ($1, 'withdrawal', $2, $3, $4, $5, $6, 'pending', $7, $8, $9)`,
      [apprId, wd.user_id, wd.account_id, deltaCents, balanceCents, afterCents, reason, wdId, admin1.id]
    );

    return {
      ok: true,
      approvalId: apprId,
      withdrawalId: wdId,
      status: 'pending'
    };
  });
}

export async function approveWithdrawal(
  admin2: { id: string },
  input: { approvalId: string; reason?: string }
) {
  const apprId = input.approvalId;
  return await withTx(async (client) => {
    const apprRes = await client.query('SELECT * FROM approvals WHERE id = $1', [apprId]);
    if (apprRes.rowCount === 0) {
      throw new WithdrawalError('طلب الموافقة غير موجود.', 404);
    }
    const appr = apprRes.rows[0];
    if (appr.status !== 'pending') {
      throw new WithdrawalError(`طلب الموافقة ليس معلقاً (${appr.status}).`, 409);
    }

    // Constraint chk_approvals_no_self_approval enforces approved_by <> requested_by
    if (appr.requested_by === admin2.id) {
      throw new WithdrawalError('موافقة المشرف الثاني مطلوبة (لا يمكن اعتماد طلبك بنفسك).', 403);
    }

    await client.query(
      `UPDATE approvals
       SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE id = $2`,
      [admin2.id, apprId]
    );

    await client.query(
      `UPDATE withdrawal_requests
       SET status = 'approved', approval_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [apprId, appr.reference]
    );

    return {
      ok: true,
      approvalId: apprId,
      withdrawalId: appr.reference,
      status: 'approved'
    };
  });
}

export async function markWithdrawalPaid(
  admin: { id: string },
  input: { withdrawalId: string; txHash: string }
) {
  const wdId = input.withdrawalId;
  const txHash = String(input.txHash || '').trim();
  if (!txHash) {
    throw new WithdrawalError('رمز المعاملة tx_hash مطلوب.', 400);
  }

  return await withTx(async (client) => {
    const wdRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [wdId]);
    if (wdRes.rowCount === 0) {
      throw new WithdrawalError('طلب السحب غير موجود.', 404);
    }
    const wd = wdRes.rows[0];
    if (wd.status !== 'approved') {
      throw new WithdrawalError(`طلب السحب غير معتمد (${wd.status}).`, 409);
    }

    const amountCents = Number(wd.amount_cents);

    // Check if journal & journal_entries already exist (debited on request)
    const jRes = await client.query("SELECT id FROM journals WHERE reference = $1 AND kind = 'withdrawal'", [wdId]);
    let journalId = jRes.rows[0]?.id;

    if (!journalId) {
      // Legacy fallback: debit now
      journalId = 'jnl-wd-' + randomUUID();
      await client.query(
        `INSERT INTO journals (id, kind, reference, created_at) VALUES ($1, 'withdrawal', $2, NOW())`,
        [journalId, wdId]
      );
      await client.query(
        `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
         ($1, $2, $3, 'cash', -$4),
         ($1, NULL, NULL, 'system:payout-clearing', $4)`,
        [journalId, wd.user_id, wd.account_id, amountCents]
      );

      const docRes = await client.query(
        `SELECT data FROM docs WHERE collection = 'contract_wallets' AND id = $1 FOR UPDATE`,
        [wd.account_id]
      );
      if (docRes.rows[0]?.data) {
        const wState = docRes.rows[0].data;
        if (wState.wallet) {
          wState.wallet.perpetualCents = Math.max(0, (Number(wState.wallet.perpetualCents) || 0) - amountCents);
          wState.wallet.version = (wState.wallet.version || 1) + 1;
          wState.wallet.updatedAt = Date.now();
          await client.query(
            `UPDATE docs SET data = $1, updated_at = NOW() WHERE collection = 'contract_wallets' AND id = $2`,
            [JSON.stringify(wState), wd.account_id]
          );
        }
      }
    }

    await client.query(
      `UPDATE withdrawal_requests
       SET status = 'paid', tx_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [txHash, wdId]
    );

    return {
      ok: true,
      withdrawalId: wdId,
      status: 'paid',
      txHash,
      journalId
    };
  });
}

export async function rejectWithdrawal(
  admin: { id: string },
  input: { withdrawalId: string; reason?: string }
) {
  const wdId = input.withdrawalId;
  const reason = input.reason || 'تم رفض السحب من قِبل الإدارة';

  return await withTx(async (client) => {
    const wdRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [wdId]);
    if (wdRes.rowCount === 0) {
      throw new WithdrawalError('طلب السحب غير موجود.', 404);
    }
    const wd = wdRes.rows[0];
    if (wd.status === 'rejected') {
      return { ok: true, withdrawalId: wdId, status: 'rejected', message: 'طلب السحب مرفوض مسبقًا.' };
    }

    const amountCents = Number(wd.amount_cents);

    // Refund the balance if it was deducted upon submission or approval
    const refCheck = await client.query(
      "SELECT id FROM journals WHERE reference = $1 AND kind = 'adjustment'",
      [wdId]
    );
    if (refCheck.rowCount === 0) {
      const refundJournalId = 'jnl-ref-' + randomUUID();
      await client.query(
        `INSERT INTO journals (id, kind, reference, created_at)
         VALUES ($1, 'adjustment', $2, NOW())`,
        [refundJournalId, wdId]
      );
      await client.query(
        `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
         VALUES ($1, $2, $3, 'cash', $4),
                ($1, NULL, NULL, 'system:payout-clearing', -$4)`,
        [refundJournalId, wd.user_id, wd.account_id, amountCents]
      );

      // Restore contract_wallets perpetualCents
      const docRes = await client.query(
        `SELECT data FROM docs WHERE collection = 'contract_wallets' AND id = $1 FOR UPDATE`,
        [wd.account_id]
      );
      if (docRes.rows[0]?.data) {
        const wState = docRes.rows[0].data;
        if (wState.wallet) {
          wState.wallet.perpetualCents = (Number(wState.wallet.perpetualCents) || 0) + amountCents;
          wState.wallet.version = (wState.wallet.version || 1) + 1;
          wState.wallet.updatedAt = Date.now();
          await client.query(
            `UPDATE docs SET data = $1, updated_at = NOW() WHERE collection = 'contract_wallets' AND id = $2`,
            [JSON.stringify(wState), wd.account_id]
          );
        }
      }
    }

    await client.query(
      `UPDATE withdrawal_requests
       SET status = 'rejected', updated_at = NOW()
       WHERE id = $1`,
      [wdId]
    );

    await client.query(
      `UPDATE approvals
       SET status = 'rejected', approved_by = $1, reason = $2, approved_at = NOW()
       WHERE reference = $3`,
      [admin.id, reason, wdId]
    );

    return {
      ok: true,
      withdrawalId: wdId,
      status: 'rejected',
      message: 'تم رفض طلب السحب وإعادة الرصيد إلى حساب العميل بنجاح.'
    };
  });
}

export async function getUserWithdrawals(user: { id: string }) {
  return await withTx(async (client) => {
    const res = await client.query(
      'SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC',
      [user.id]
    );
    return { items: res.rows };
  });
}

export async function getWithdrawalById(user: { id: string; role?: string }, id: string) {
  return await withTx(async (client) => {
    const res = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1', [id]);
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    if (row.user_id !== user.id && user.role !== 'admin') {
      return null;
    }
    return row;
  });
}
