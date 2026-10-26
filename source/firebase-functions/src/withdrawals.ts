import { randomUUID, createHash } from 'node:crypto';
import { withTx } from './db.ts';
import { requireVerifiedKyc } from './kyc.ts';
import {
  createNotice,
  notifyWithdrawalSubmitted,
  notifyWithdrawalApproved,
  notifyWithdrawalPaid,
  notifyWithdrawalRejected
} from './notifications.ts';
import { loadContractWallet, saveContractWallet, readBalanceCents } from './wallet-ledger.ts';
import { readPolicyRuntime, policyLedger, cohortAmount, savePolicyEvidence, type PolicyClient } from './financial-policy.ts';
import { LEGACY_FINANCIAL_POLICY } from '../../lib/financial-policy';

export class WithdrawalError extends Error {
  constructor(message: string, public status = 400, public code = 'withdrawal_error') {
    super(message);
  }
}

export interface WithdrawalRequestInput {
  requestId?: string;
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
  if (input.requestId !== undefined && (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId))) {
    throw new WithdrawalError('Invalid withdrawal request ID', 400);
  }
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
      'SELECT id, type, currency, balance_cents, reserved_cents FROM accounts WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [accountId, user.id]
    );
    if (accRes.rowCount === 0) {
      throw new WithdrawalError('الحساب غير موجود.', 404);
    }

    const account = accRes.rows[0];
    if (account.type !== 'real' || account.currency !== 'USD' || currency !== 'USD') {
      throw new WithdrawalError('السحب متاح من الحساب الحقيقي بالدولار فقط. / Withdrawals require a real USD account.', 403);
    }

    const commandId = input.requestId ? createHash('sha256').update(accountId + ':' + input.requestId).digest('hex') : null;
    const fingerprint = JSON.stringify({ accountId, amountCents, coin, currency, address });
    if (commandId) {
      const previous = await client.query("SELECT data FROM docs WHERE collection = 'withdrawal_commands' AND id = $1", [commandId]);
      if (previous.rows[0]) {
        if (previous.rows[0].data.fingerprint !== fingerprint) throw new WithdrawalError('Withdrawal request details changed', 409);
        return previous.rows[0].data.response;
      }
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

    // Check sum of pending/approved withdrawals that have not yet been paid
    const pendingRes = await client.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total_pending
       FROM withdrawal_requests
       WHERE account_id = $1 AND status IN ('requested', 'approved')`,
      [accountId]
    );
    const pendingCents = BigInt(pendingRes.rows[0]?.total_pending || 0);

    // Strict wallet separation:
    // perpetualCents = Permanent Futures (trading only, CANNOT be withdrawn!)
    // futuresCents = Withdrawable Futures (withdrawable)
    const { state: wState } = await loadContractWallet(client, accountId, user.id, account.balance_cents, true);
    const policy = policyLedger(wState, await readPolicyRuntime(client));
    const curFutures = wState.wallet.futuresCents;
    if (curFutures < amountCents) {
      throw new WithdrawalError(
        'المبلغ المطلوب يتجاوز الرصيد المتاح في العقود الآجلة (محفظة السحب). رصيد العقود الدائمة مخصص للتداول فقط ولا يمكن سحبه مباشرة. يرجى تحويل المبلغ المراد سحبه من العقود الدائمة إلى العقود الآجلة أولاً.',
        409
      );
    }

    // 5% standard withdrawal fee
    const feeCents = Math.round(amountCents * LEGACY_FINANCIAL_POLICY.externalWithdrawalFeeRate);
    const netAmountCents = amountCents - feeCents;
    const policySpotCents = cohortAmount(amountCents, wState, policy, 'spot');

    const wdId = 'wd-' + randomUUID();
    const inserted = await client.query(
      `INSERT INTO withdrawal_requests (id, user_id, account_id, amount_cents, fee_cents, net_amount_cents, currency, coin, address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'requested') RETURNING created_at`,
      [wdId, user.id, accountId, amountCents, feeCents, netAmountCents, currency, coin, address]
    );

    // Immediately create journal and journal entries to debit user's cash balance
    // The database trigger apply_journal_entry_to_account automatically subtracts amountCents from accounts.balance_cents
    const journalId = 'jnl-' + wdId;
    await client.query(
      `INSERT INTO journals (id, kind, reference, created_at) VALUES ($1, 'withdrawal', $2, NOW())`,
      [journalId, wdId]
    );
    await client.query(
      `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
       ($1, $2, $3, 'cash', $4),
       ($1, NULL, NULL, 'system:payout-clearing', $5)`,
      [journalId, user.id, accountId, -amountCents, amountCents]
    );

    // Deduct amountCents strictly from futuresCents in contract_wallets doc.
    // perpetualCents (Permanent Futures / Trading) is completely protected and CAN NEVER BE WITHDRAWN!
    const balanceAfter = await readBalanceCents(client, accountId);
    wState.wallet.futuresCents = Math.max(0, balanceAfter - wState.wallet.perpetualCents);
    if (policy) {
      policy.policySpotCents -= policySpotCents;
      await savePolicyEvidence(client, 'financial_policy_withdrawals', wdId, user.id, { accountId, policySpotCents });
    }

    if (Array.isArray(wState.operations)) {
      wState.operations.unshift({
        id: 'wd-op-' + wdId,
        kind: 'withdrawal',
        amountCents,
        feeCents,
        netAmountCents,
        afterFuturesCents: wState.wallet.futuresCents,
        afterPerpetualCents: wState.wallet.perpetualCents,
        createdAt: Date.now()
      });
    }

    await saveContractWallet(client, accountId, user.id, wState);

    // Also register an approval record so it appears under financial approvals
    await client.query(
      `INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, created_at)
       VALUES ($1, 'withdrawal', $2, $3, $4, $5, $6, 'pending', $7, $8, $9, NOW())
       ON CONFLICT (id) DO NOTHING`,
      ['appr-' + wdId, user.id, accountId, -amountCents, Number(account.balance_cents), Number(account.balance_cents) - amountCents, `طلب سحب ${amountCents / 100} ${coin} إلى ${address}`, wdId, user.id]
    );

    // Enhanced In-app Notifications for the User & Admin
    const profRes = await client.query('SELECT email FROM profiles WHERE id = $1', [user.id]);
    const userEmail = profRes.rows[0]?.email || user.id;

    await notifyWithdrawalSubmitted(client, {
      userId: user.id,
      wdId,
      amountCents,
      feeCents,
      netAmountCents,
      coin,
      address,
      userEmail
    });


    const response = {
      ok: true,
      id: wdId,
      amountCents,
      feeCents,
      feeRate: 0.05,
      netAmountCents,
      coin,
      currency,
      address,
      accountId,
      createdAt: new Date(inserted.rows[0].created_at).getTime(),
      status: 'requested',
      message: 'تم استلام طلب السحب وخصم الرصيد بنجاح. سيتم مراجعته وتحويله من قِبل الإدارة.'
    };
    if (commandId) await savePolicyEvidence(client, 'withdrawal_commands', commandId, user.id, { fingerprint, response });
    return response;
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
  input: { approvalId: string; reason?: string },
  transactionClient?: PolicyClient
) {
  const apprId = input.approvalId;
  const run = async (client: PolicyClient) => {
    const apprRes = await client.query('SELECT * FROM approvals WHERE id = $1 FOR UPDATE', [apprId]);
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
    const wdRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [appr.reference]);
    const wd = wdRes.rows[0];
    if (!wd || wd.status !== 'requested') throw new WithdrawalError('طلب السحب ليس قيد المراجعة.', 409);
    await ensureWithdrawalDebited(client, wd);

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

    // Notify the user of withdrawal approval with rich details
    if (wdRes.rows.length > 0) {
      await notifyWithdrawalApproved(client, {
        userId: wd.user_id,
        wdId: wd.id,
        amountCents: Number(wd.amount_cents),
        netAmountCents: Number(wd.net_amount_cents),
        coin: wd.coin,
        address: wd.address
      });
    }

    return {
      ok: true,
      approvalId: apprId,
      withdrawalId: appr.reference,
      status: 'approved'
    };
  };
  return transactionClient ? run(transactionClient) : withTx(run);
}

/** Shared by both admin entry points; never debits trading or loses cohort data. */
async function ensureWithdrawalDebited(client: PolicyClient, wd: any) {
  const account = await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [wd.account_id]);
  const existing = await client.query("SELECT id FROM journals WHERE reference = $1 AND kind = 'withdrawal'", [wd.id]);
  if (existing.rows[0]) return existing.rows[0].id as string;
  if (!account.rows[0] || account.rows[0].type !== 'real') throw new WithdrawalError('الحساب غير متاح للسحب.', 409);
  const amountCents = Number(wd.amount_cents);
  const { state } = await loadContractWallet(client, wd.account_id, wd.user_id, account.rows[0].balance_cents, true);
  const policy = policyLedger(state, await readPolicyRuntime(client));
  if (state.wallet.futuresCents < amountCents) throw new WithdrawalError('الرصيد المتاح للسحب غير كافٍ.', 409);
  const policySpotCents = cohortAmount(amountCents, state, policy, 'spot');
  const journalId = 'jnl-wd-' + randomUUID();
  await client.query("INSERT INTO journals (id, kind, reference, created_at) VALUES ($1, 'withdrawal', $2, NOW())", [journalId, wd.id]);
  await client.query(`INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
    ($1, $2, $3, 'cash', $4), ($1, NULL, NULL, 'system:payout-clearing', $5)`,
    [journalId, wd.user_id, wd.account_id, -amountCents, amountCents]);
  state.wallet.futuresCents = (await readBalanceCents(client, wd.account_id)) - state.wallet.perpetualCents;
  if (policy) {
    policy.policySpotCents -= policySpotCents;
    await savePolicyEvidence(client, 'financial_policy_withdrawals', wd.id, wd.user_id, { accountId: wd.account_id, policySpotCents });
  }
  await saveContractWallet(client, wd.account_id, wd.user_id, state);
  return journalId;
}

/** Existing direct administrator approval route; access control stays upstream. */
export async function approveWithdrawalById(admin: { id: string }, input: { withdrawalId: string }) {
  return withTx(async client => {
    const result = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [input.withdrawalId]);
    const wd = result.rows[0];
    if (!wd) throw new WithdrawalError('طلب السحب غير موجود.', 404);
    if (wd.status === 'approved') return { ok: true, status: 'approved', withdrawalId: wd.id };
    if (wd.status !== 'requested') throw new WithdrawalError('طلب السحب ليس قيد المراجعة.', 409);
    await ensureWithdrawalDebited(client, wd);
    await client.query("UPDATE withdrawal_requests SET status = 'approved', updated_at = NOW() WHERE id = $1", [wd.id]);
    await client.query("UPDATE approvals SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE reference = $2 AND status = 'pending'", [admin.id, wd.id]);
    await notifyWithdrawalApproved(client, { userId: wd.user_id, wdId: wd.id, amountCents: Number(wd.amount_cents), netAmountCents: Number(wd.net_amount_cents), coin: wd.coin, address: wd.address });
    return { ok: true, status: 'approved', withdrawalId: wd.id };
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

    const journalId = await ensureWithdrawalDebited(client, wd);

    await client.query(
      `UPDATE withdrawal_requests
       SET status = 'paid', tx_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [txHash, wdId]
    );

    await notifyWithdrawalPaid(client, {
      userId: wd.user_id,
      wdId: wd.id,
      amountCents: Number(wd.amount_cents),
      netAmountCents: Number(wd.net_amount_cents),
      coin: wd.coin,
      address: wd.address,
      txHash
    });

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
  input: { withdrawalId: string; reason?: string },
  transactionClient?: PolicyClient
) {
  const wdId = input.withdrawalId;
  const reason = input.reason || 'تم رفض السحب من قِبل الإدارة';

  const run = async (client: PolicyClient) => {
    const wdRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [wdId]);
    if (wdRes.rowCount === 0) {
      throw new WithdrawalError('طلب السحب غير موجود.', 404);
    }
    const wd = wdRes.rows[0];
    if (wd.status === 'rejected') {
      return { ok: true, withdrawalId: wdId, status: 'rejected', message: 'طلب السحب مرفوض مسبقًا.' };
    }
    if (!['requested', 'approved'].includes(wd.status)) {
      throw new WithdrawalError('لا يمكن رفض عملية سحب مدفوعة أو نهائية. / A paid or final withdrawal cannot be rejected.', 409);
    }

    const amountCents = Number(wd.amount_cents);
    const accountBefore = await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [wd.account_id]);
    const { state: refundWallet } = await loadContractWallet(client, wd.account_id, wd.user_id, accountBefore.rows[0].balance_cents, true);
    const policy = policyLedger(refundWallet, await readPolicyRuntime(client));
    const debitCheck = await client.query("SELECT id FROM journals WHERE reference = $1 AND kind = 'withdrawal'", [wdId]);

    // Refund the balance if it was deducted upon submission or approval
    const refCheck = await client.query(
      "SELECT id FROM journals WHERE reference = $1 AND kind = 'adjustment'",
      [wdId]
    );
    if (refCheck.rowCount === 0 && debitCheck.rows.length > 0) {
      const refundJournalId = 'jnl-ref-' + randomUUID();
      await client.query(
        `INSERT INTO journals (id, kind, reference, created_at)
         VALUES ($1, 'adjustment', $2, NOW())`,
        [refundJournalId, wdId]
      );
      await client.query(
        `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
         VALUES ($1, $2, $3, 'cash', $4),
                ($1, NULL, NULL, 'system:payout-clearing', $5)`,
        [refundJournalId, wd.user_id, wd.account_id, amountCents, -amountCents]
      );

      // Restore contract_wallets futuresCents (withdrawable futures)
      const balanceAfter = await readBalanceCents(client, wd.account_id);
      refundWallet.wallet.futuresCents = balanceAfter - refundWallet.wallet.perpetualCents;
      if (policy) {
        const original = await client.query("SELECT data FROM docs WHERE collection = 'financial_policy_withdrawals' AND id = $1", [wdId]);
        const restored = Number(original.rows[0]?.data?.policySpotCents ?? 0);
        if (!Number.isSafeInteger(restored) || restored < 0 || restored > amountCents) throw new WithdrawalError('Withdrawal cohort requires reconciliation', 409);
        policy.policySpotCents += restored;
      }
      await saveContractWallet(client, wd.account_id, wd.user_id, refundWallet);
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

    await notifyWithdrawalRejected(client, {
      userId: wd.user_id,
      wdId: wd.id,
      amountCents: Number(wd.amount_cents),
      coin: wd.coin,
      reason
    });

    return {
      ok: true,
      withdrawalId: wdId,
      status: 'rejected',
      message: 'تم رفض طلب السحب وإعادة الرصيد إلى حساب العميل بنجاح.'
    };
  };
  return transactionClient ? run(transactionClient) : withTx(run);
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
