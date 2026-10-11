import { randomUUID } from 'node:crypto';
import { withTx } from './db.ts';
import { requireVerifiedKyc } from './kyc.ts';

export class WithdrawalError extends Error {
  constructor(message: string, public status = 400) {
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
    // Verify user profile is active and KYC is verified
    const pRes = await client.query('SELECT id, disabled FROM profiles WHERE id = $1', [user.id]);
    if (pRes.rowCount === 0 || pRes.rows[0].disabled) {
      throw new WithdrawalError('الوصول إلى الحساب غير متاح.', 403);
    }

    await requireVerifiedKyc(user, client);

    // Earliest confirmed deposit must be at least 20 days old (20-day lock)
    const depRes = await client.query(
      `SELECT MIN(created_at) AS earliest_deposit
       FROM deposits
       WHERE user_id = $1 AND status = 'finished'`,
      [user.id]
    );
    const earliestDeposit = depRes.rows[0]?.earliest_deposit;
    if (!earliestDeposit) {
      throw new WithdrawalError('Debit adjustment requires earliest deposit to be at least 20 days old', 409);
    }
    const earliestMs = new Date(earliestDeposit).getTime();
    if (nowMs - earliestMs < 20 * 86400 * 1000) {
      throw new WithdrawalError('Debit adjustment requires earliest deposit to be at least 20 days old', 409);
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

    const available = BigInt(account.balance_cents) - BigInt(account.reserved_cents) - pendingCents;
    if (available < BigInt(amountCents)) {
      throw new WithdrawalError('Requested debit exceeds withdrawable cash', 409);
    }

    const wdId = 'wd-' + randomUUID();
    await client.query(
      `INSERT INTO withdrawal_requests (id, user_id, account_id, amount_cents, currency, coin, address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'requested')`,
      [wdId, user.id, accountId, amountCents, currency, coin, address]
    );

    return {
      ok: true,
      id: wdId,
      amountCents,
      coin,
      currency,
      address,
      status: 'requested',
      message: 'تم استلام طلب السحب وسيتم مراجعته يدويًا من قِبل الإدارة.'
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

    // Verify account cash balance
    const accRes = await client.query('SELECT balance_cents FROM accounts WHERE id = $1 FOR UPDATE', [wd.account_id]);
    const balanceCents = Number(accRes.rows[0]?.balance_cents || 0);
    if (balanceCents < amountCents) {
      throw new WithdrawalError('رصيد الحساب غير كافٍ لإتمام السحب.', 400);
    }

    // Insert journal & journal_entries: user cash (-amount) vs system:payout-clearing (+amount)
    const journalId = 'j-wd-' + randomUUID();
    await client.query(
      `INSERT INTO journals (id, kind, reference) VALUES ($1, 'withdrawal', $2)`,
      [journalId, wdId]
    );

    await client.query(
      `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
       ($1, $2, $3, 'cash', $4),
       ($1, NULL, NULL, 'system:payout-clearing', $5)`,
      [journalId, wd.user_id, wd.account_id, -amountCents, amountCents]
    );

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
