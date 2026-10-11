import { randomUUID, createHmac } from 'node:crypto';
import { withTx } from './db.ts';
import { ApiError, type Identity, type Data } from './store.ts';
import { computeCustomerKey, verifyKycCustomer } from './kyc.ts';
import { proposeWithdrawalApproval, approveWithdrawal, markWithdrawalPaid } from './withdrawals.ts';

export { computeCustomerKey };

export async function controlRead(u: Identity, module: string, _q: Data = {}) {
  if (module === 'support-ai' || module === 'support') {
    throw new ApiError('Support AI is deprecated and not implemented on server', 501);
  }

  if (module === 'staff') {
    return await withTx(async (client) => {
      const res = await client.query(`
        SELECT s.user_id AS id, p.email, p.display_name AS "displayName",
               s.roles, s.status, s.valid_after AS "validAfter", s.created_at AS "createdAt"
        FROM staff s
        JOIN profiles p ON s.user_id = p.id
        ORDER BY s.created_at DESC
      `);
      return { rows: res.rows, nextCursor: null };
    });
  }

  if (module === 'kyc') {
    return await withTx(async (client) => {
      const res = await client.query(`
        SELECT id, user_id AS "userId", country, document_type AS "documentType",
               status, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM kyc_files
        ORDER BY created_at DESC
        LIMIT 50
      `);
      return { rows: res.rows, nextCursor: null };
    });
  }

  throw new ApiError(`Module ${module} not implemented on server yet`, 501);
}

export async function controlAction(u: Identity, input: Data) {
  const action = String(input.action || '');
  const target = String(input.target || '');
  const payload = input.data || {};
  const reason = String(input.reason || payload.reason || 'Administrative action');
  const requestId = String(input.requestId || 'req-' + randomUUID());

  if (action.startsWith('support.ai.') || action.startsWith('support.')) {
    throw new ApiError('Support AI actions are deprecated and return 501', 501);
  }

  // 1. Contract Publish
  if (action === 'contract.publish') {
    const contractId = target || payload.contractId;
    return await withTx(async (client) => {
      const res = await client.query(
        `UPDATE contracts
         SET status = 'active', published_at = NOW(), admin_id = $1
         WHERE id = $2
         RETURNING id, status, published_at`,
        [u.id, contractId]
      );
      if (res.rowCount === 0) {
        throw new ApiError('Contract not found', 404);
      }
      return { ok: true, published: true, contractId, status: res.rows[0].status };
    });
  }

  // 2. Contract Revoke
  if (action === 'contract.revoke') {
    const contractId = target || payload.contractId;
    return await withTx(async (client) => {
      const res = await client.query(
        `UPDATE contracts
         SET status = 'cancelled'
         WHERE id = $1
         RETURNING id`,
        [contractId]
      );
      if (res.rowCount === 0) {
        throw new ApiError('Contract not found', 404);
      }
      await client.query(
        `INSERT INTO contract_revocation_state (contract_id, revoked, reason, revoked_by, revoked_at)
         VALUES ($1, TRUE, $2, $3, NOW())
         ON CONFLICT (contract_id) DO UPDATE SET revoked = TRUE, reason = $2, revoked_by = $3, revoked_at = NOW()`,
        [contractId, reason, u.id]
      );
      return { ok: true, revoked: true, contractId };
    });
  }

  // 3. Balance Adjustment Propose (finance.propose)
  if (action === 'finance.propose') {
    const uid = String(payload.uid || target);
    const accountId = String(payload.accountId || '');
    const deltaCents = Number(payload.deltaCents || 0);
    if (!Number.isSafeInteger(deltaCents) || deltaCents === 0) {
      throw new ApiError('Valid deltaCents required', 400);
    }
    const reference = String(payload.reference || 'adj-ref-' + randomUUID());

    return await withTx(async (client) => {
      const accRes = await client.query(
        'SELECT id, balance_cents, reserved_cents, type FROM accounts WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [accountId, uid]
      );
      if (accRes.rowCount === 0) throw new ApiError('Account not found', 404);
      const acc = accRes.rows[0];
      if (acc.type !== 'real') throw new ApiError('Real account required for adjustments', 400);

      const beforeCents = Number(acc.balance_cents);
      const afterCents = beforeCents + deltaCents;
      if (afterCents < Number(acc.reserved_cents)) {
        throw new ApiError('Adjustment would breach reserved balance', 409);
      }

      const approvalId = requestId.startsWith('req-') ? requestId.replace('req-', 'appr-') : 'appr-' + requestId;
      await client.query(
        `INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, created_at)
         VALUES ($1, 'adjustment', $2, $3, $4, $5, $6, 'pending', $7, $8, $9, NOW())`,
        [approvalId, uid, accountId, deltaCents, beforeCents, afterCents, reason, reference, u.id]
      );

      return { ok: true, approvalId, status: 'pending', deltaCents };
    });
  }

  // 4. Reward Propose (reward.propose)
  if (action === 'reward.propose') {
    const uid = String(payload.uid || target);
    const accountId = String(payload.accountId || '');
    const amountCents = Number(payload.amountCents || payload.deltaCents || 0);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new ApiError('Valid reward amount required', 400);
    }
    const reference = String(payload.reference || 'rew-ref-' + randomUUID());

    return await withTx(async (client) => {
      const accRes = await client.query('SELECT id, balance_cents FROM accounts WHERE id = $1 AND user_id = $2', [accountId, uid]);
      if (accRes.rowCount === 0) throw new ApiError('Account not found', 404);
      const beforeCents = Number(accRes.rows[0].balance_cents);
      const afterCents = beforeCents + amountCents;
      const approvalId = requestId.startsWith('req-') ? requestId.replace('req-', 'rew-appr-') : 'rew-appr-' + requestId;

      await client.query(
        `INSERT INTO approvals (id, kind, reward_kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, created_at)
         VALUES ($1, 'referral_reward', 'referral', $2, $3, $4, $5, $6, 'pending', $7, $8, $9, NOW())`,
        [approvalId, uid, accountId, amountCents, beforeCents, afterCents, reason, reference, u.id]
      );

      return { ok: true, approvalId, status: 'pending', amountCents };
    });
  }

  // 5. Finance Approve (finance.approve) - TWO PERSON RULE ENFORCED
  if (action === 'finance.approve' || action === 'reward.approve') {
    const approvalId = target || payload.approvalId;
    return await withTx(async (client) => {
      const apprRes = await client.query(
        'SELECT * FROM approvals WHERE id = $1 FOR UPDATE',
        [approvalId]
      );
      if (apprRes.rowCount === 0) throw new ApiError('Approval record not found', 404);
      const appr = apprRes.rows[0];

      if (appr.status !== 'pending') {
        throw new ApiError(`Approval is not pending (status: ${appr.status})`, 409);
      }

      // TWO-PERSON RULE: Approver cannot be requester
      if (appr.requested_by === u.id) {
        throw new ApiError('Self-approval blocked: two-person rule requires distinct reviewer', 409);
      }

      const deltaCents = Number(appr.delta_cents);
      const uid = appr.user_id;
      const accountId = appr.account_id;
      const kind = appr.kind; // 'adjustment' or 'referral_reward'
      const journalId = 'jnl-' + randomUUID();
      const sysBucket = kind === 'adjustment' ? 'system:adjustment' : 'system:referral_rewards';

      // 1. Create Journal
      await client.query(
        `INSERT INTO journals (id, kind, reference, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [journalId, kind, appr.reference]
      );

      // 2. Double-entry Journal Entries (trigger automatically updates account balance)
      await client.query(
        `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
         VALUES ($1, $2, $3, 'cash', $4),
                ($1, NULL, NULL, $5, $6)`,
        [journalId, uid, accountId, deltaCents, sysBucket, -deltaCents]
      );

      // 3. Update Approval status
      await client.query(
        `UPDATE approvals
         SET status = 'approved', approved_by = $1, approved_at = NOW()
         WHERE id = $2`,
        [u.id, approvalId]
      );

      return { ok: true, status: 'approved', approvalId, journalId };
    });
  }

  // 6. Finance Reject (finance.reject)
  if (action === 'finance.reject' || action === 'reward.reject') {
    const approvalId = target || payload.approvalId;
    return await withTx(async (client) => {
      const res = await client.query(
        `UPDATE approvals
         SET status = 'rejected', approved_by = $1, approved_at = NOW()
         WHERE id = $2 AND status = 'pending'
         RETURNING id`,
        [u.id, approvalId]
      );
      if (res.rowCount === 0) throw new ApiError('Pending approval not found', 404);
      return { ok: true, status: 'rejected', approvalId };
    });
  }

  // 7. Deposit Review Resolve (payment.review)
  if (action === 'payment.review' || action === 'deposit.resolve') {
    const depositId = target || payload.depositId;
    const decision = payload.decision || (action === 'deposit.resolve' ? 'approve' : 'reject');

    return await withTx(async (client) => {
      const depRes = await client.query('SELECT * FROM deposits WHERE id = $1 FOR UPDATE', [depositId]);
      if (depRes.rowCount === 0) throw new ApiError('Deposit not found', 404);
      const dep = depRes.rows[0];

      await client.query(
        `UPDATE payment_reviews
         SET status = (CASE WHEN $1 = 'approve' THEN 'resolved' ELSE 'rejected' END),
             resolved_by = $2, resolved_at = NOW()
         WHERE deposit_id = $3 AND status = 'pending'`,
        [decision, u.id, depositId]
      );

      if (decision === 'approve' && !dep.credited) {
        const amount = Number(dep.amount_cents);
        const journalId = 'jnl-dep-resolve-' + randomUUID();

        await client.query(
          `INSERT INTO journals (id, kind, reference, created_at)
           VALUES ($1, 'deposit', $2, NOW())`,
          [journalId, `review-resolve-${depositId}`]
        );

        await client.query(
          `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
           VALUES ($1, $2, $3, 'cash', $4),
                  ($1, NULL, NULL, 'system:deposits', $5)`,
          [journalId, dep.user_id, dep.account_id, amount, -amount]
        );

        await client.query(
          `UPDATE deposits
           SET status = 'confirmed', credited = TRUE, credited_cents = $1, updated_at = NOW()
           WHERE id = $2`,
          [amount, depositId]
        );
      } else if (decision === 'reject') {
        await client.query(
          `UPDATE deposits
           SET status = 'failed', review_reason = $1, updated_at = NOW()
           WHERE id = $2`,
          [reason, depositId]
        );
      }

      return { ok: true, decision, depositId };
    });
  }

  // 8. User Status Restrict / Suspend (user.status)
  if (action === 'user.status') {
    const userId = target || payload.userId;
    const status = String(payload.status || 'restricted'); // 'active', 'restricted', 'suspended'
    if (!['active', 'restricted', 'suspended'].includes(status)) {
      throw new ApiError('Invalid status. Allowed: active, restricted, suspended', 400);
    }

    return await withTx(async (client) => {
      await client.query(
        `UPDATE profiles
         SET disabled = ($1 = 'suspended'), updated_at = NOW()
         WHERE id = $2`,
        [status, userId]
      );

      await client.query(
        `INSERT INTO access_status (user_id, status, reason, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, updated_at = NOW()`,
        [userId, status, reason]
      );

      return { ok: true, status, userId };
    });
  }

  // 9. KYC Review (kyc.review)
  if (action === 'kyc.review') {
    const kycReqId = target || payload.requestId;
    const dec = String(payload.status || 'approved'); // 'approved' or 'rejected'

    return await withTx(async (client) => {
      const reqRes = await client.query('SELECT * FROM kyc_requests WHERE id = $1 FOR UPDATE', [kycReqId]);
      if (reqRes.rowCount === 0) throw new ApiError('KYC request not found', 404);
      const kycReq = reqRes.rows[0];

      await client.query(
        `UPDATE kyc_requests
         SET status = $1, reviewer_id = $2, reason = $3, reviewed_at = NOW()
         WHERE id = $4`,
        [dec, u.id, reason, kycReqId]
      );

      const fileStatus = dec === 'approved' ? 'verified' : 'rejected';
      await client.query(
        `UPDATE kyc_files
         SET status = $1, updated_at = NOW()
         WHERE user_id = $2`,
        [fileStatus, kycReq.user_id]
      );

      if (dec === 'approved') {
        const eventId = 'kyc-approved-' + randomUUID();
        await client.query(
          `INSERT INTO verified_customers (user_id, customer_key, id_number_last4, verified, revoked, event_id, created_at)
           VALUES ($1, $2, '0000', TRUE, FALSE, $3, NOW())
           ON CONFLICT (user_id) DO UPDATE SET verified = TRUE, revoked = FALSE, event_id = EXCLUDED.event_id`,
          [kycReq.user_id, kycReq.customer_key, eventId]
        );
      }

      return { ok: true, status: dec, requestId: kycReqId, userId: kycReq.user_id };
    });
  }

  // 10. Customer Verify (delegates to verifyKycCustomer)
  if (action === 'customer.verify') {
    return await verifyKycCustomer(u, payload);
  }

  // 11. Withdrawal Propose / Approve / Pay
  if (action === 'withdrawal.propose') {
    return await proposeWithdrawalApproval(u, payload);
  }
  if (action === 'withdrawal.approve') {
    return await approveWithdrawal(u, payload);
  }
  if (action === 'withdrawal.pay') {
    return await markWithdrawalPaid(u, payload);
  }

  // Unported actions return 501
  throw new ApiError(`Control action ${action} not implemented on server yet`, 501);
}
