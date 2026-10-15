/**
 * Server-only integration boundary for PostgreSQL.
 * Invoke only AFTER provider adapters verify signature and final status.
 */
import { withTx } from './db.ts';
import { createHash } from 'node:crypto';

export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');

const key = (s: string) => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(s)) throw new ApiError('Invalid trusted event id');
  return s;
};

const validMoney = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 4;

export async function recordVerifiedCustomer(uid: string, customerKey: string, eventId: string, idNumberLast4?: string) {
  key(uid);
  key(eventId);
  if (!/^[a-f0-9]{64}$/.test(customerKey)) throw new ApiError('Use an irreversible provider customer fingerprint');

  return withTx(async (client) => {
    const fingerprint = hash(JSON.stringify({ uid, customerKey }));

    // 1. Check trusted_events idempotency
    const evRes = await client.query('SELECT fingerprint FROM trusted_events WHERE event_id = $1', [eventId]);
    if (evRes.rows.length > 0) {
      if (evRes.rows[0].fingerprint !== fingerprint) throw new ApiError('Event conflict', 409);
      return;
    }

    // 2. Check customer_registry uniqueness
    const regRes = await client.query('SELECT user_id FROM customer_registry WHERE customer_key = $1', [customerKey]);
    if (regRes.rows.length > 0 && regRes.rows[0].user_id !== uid) {
      throw new ApiError('Duplicate customer', 409);
    }

    // 3. Check verified_customers identity consistency
    const vcRes = await client.query('SELECT customer_key FROM verified_customers WHERE user_id = $1', [uid]);
    if (vcRes.rows.length > 0 && vcRes.rows[0].customer_key !== customerKey) {
      throw new ApiError('Verification identity changed; review required', 409);
    }

    // 4. Upsert customer_registry & verified_customers
    await client.query(
      `INSERT INTO customer_registry (customer_key, user_id)
       VALUES ($1, $2)
       ON CONFLICT (customer_key) DO NOTHING`,
      [customerKey, uid]
    );

    const last4 = idNumberLast4 ?? customerKey.slice(-4);
    await client.query(
      `INSERT INTO verified_customers (user_id, customer_key, id_number_last4, verified, revoked, event_id)
       VALUES ($1, $2, $3, true, false, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         customer_key = EXCLUDED.customer_key,
         id_number_last4 = EXCLUDED.id_number_last4,
         verified = true,
         revoked = false,
         event_id = EXCLUDED.event_id`,
      [uid, customerKey, last4, eventId]
    );

    // 5. Update program_members badges
    const mRes = await client.query('SELECT badges FROM program_members WHERE user_id = $1', [uid]);
    if (mRes.rows.length > 0) {
      const currentBadges: string[] = Array.isArray(mRes.rows[0].badges)
        ? mRes.rows[0].badges
        : JSON.parse(mRes.rows[0].badges || '[]');
      if (!currentBadges.includes('verified')) {
        currentBadges.push('verified');
        await client.query(
          'UPDATE program_members SET badges = $1::jsonb WHERE user_id = $2',
          [JSON.stringify(currentBadges), uid]
        );
      }
    }

    // 6. Record trusted_events & audit
    await client.query(
      `INSERT INTO trusted_events (event_id, user_id, type, fingerprint, status)
       VALUES ($1, $2, 'verification', $3, 'confirmed')
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, uid, fingerprint]
    );

    const payload = JSON.stringify({ eventId });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ('provider', 'CUSTOMER_VERIFIED', $1, $2::jsonb, $3)
       ON CONFLICT (action, reference) DO NOTHING`,
      [uid, payload, hash(payload)]
    );
  });
}

export async function recordConfirmedDeposit(e: {
  eventId: string;
  uid: string;
  accountId: string;
  currency: 'USD';
  cents: number;
  eligible: boolean;
  depositId?: string;
}) {
  key(e.eventId);
  key(e.uid);
  key(e.accountId);
  if (e.currency !== 'USD' || !validMoney(e.cents) || e.cents === 0 || typeof e.eligible !== 'boolean') {
    throw new ApiError('Invalid confirmed deposit');
  }

  return withTx(async (client) => {
    const fingerprint = hash(JSON.stringify(e));

    // 1. Idempotency check on trusted_events
    const evRes = await client.query('SELECT fingerprint FROM trusted_events WHERE event_id = $1', [e.eventId]);
    if (evRes.rows.length > 0) {
      if (evRes.rows[0].fingerprint !== fingerprint) throw new ApiError('Event conflict', 409);
      return;
    }

    // 2. Profile & account status checks
    const profRes = await client.query('SELECT disabled FROM profiles WHERE id = $1', [e.uid]);
    if (profRes.rows.length === 0 || profRes.rows[0].disabled) throw new ApiError('Funding account restricted', 409);

    const accRes = await client.query('SELECT * FROM accounts WHERE user_id = $1 AND id = $2', [e.uid, e.accountId]);
    if (accRes.rows.length === 0) throw new ApiError('Invalid funding account', 409);
    const acc = accRes.rows[0];
    if (acc.type !== 'real' || acc.currency !== 'USD' || !validMoney(Number(acc.balance_cents) + e.cents)) {
      throw new ApiError('Invalid funding account', 409);
    }

    const gateRes = await client.query('SELECT status FROM access_status WHERE user_id = $1', [e.uid]);
    if (gateRes.rows[0]?.status === 'suspended') throw new ApiError('Funding account restricted', 409);

    // 3. Program configuration
    const cfgRes = await client.query("SELECT config FROM program_configuration WHERE key = 'current'");
    const cfg = cfgRes.rows[0]?.config ?? {};
    const firstDepositCents = Number(cfg.firstDepositCents ?? 100000);

    // 4. Ledger insert for deposit (cash vs system:payment-clearing)
    const journalId = 'deposit-' + e.eventId;
    await client.query(
      `INSERT INTO journals (id, kind, reference)
       VALUES ($1, 'deposit', $2)
       ON CONFLICT (id) DO NOTHING`,
      [journalId, e.eventId]
    );

    await client.query(
      `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
       VALUES
         ($1, $2, $3, 'cash', $4),
         ($1, NULL, NULL, 'system:payment-clearing', -$4)`,
      [journalId, e.uid, e.accountId, e.cents]
    );

    // 4b. Ensure deposit goes directly into Futures (العقود الآجلة)
    const docRes = await client.query(
      `SELECT data FROM docs WHERE collection = 'contract_wallets' AND id = $1 FOR UPDATE`,
      [e.accountId]
    );
    let walletState = docRes.rows[0]?.data;
    if (!walletState) {
      walletState = {
        wallet: {
          ownerId: e.uid,
          accountId: e.accountId,
          currency: 'USD',
          futuresCents: e.cents,
          perpetualCents: 0,
          version: 1,
          updatedAt: Date.now()
        },
        operations: []
      };
    } else {
      walletState.wallet = walletState.wallet || {};
      walletState.wallet.futuresCents = (Number(walletState.wallet.futuresCents) || 0) + e.cents;
      walletState.wallet.version = (walletState.wallet.version || 1) + 1;
      walletState.wallet.updatedAt = Date.now();
    }
    await client.query(
      `INSERT INTO docs (collection, id, data, updated_at)
       VALUES ('contract_wallets', $1, $2, NOW())
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [e.accountId, JSON.stringify(walletState)]
    );

    // 5. Qualified deposit & bonus profit unlock
    if (e.eligible) {
      const qdRes = await client.query('SELECT amount_cents FROM qualified_deposits WHERE user_id = $1', [e.uid]);
      const prevAmount = qdRes.rows[0] ? Number(qdRes.rows[0].amount_cents) : 0;
      if (qdRes.rows.length === 0 || e.cents > prevAmount) {
        const depId = e.depositId ?? e.eventId;
        const depCheck = await client.query('SELECT id FROM deposits WHERE id = $1', [depId]);
        if (depCheck.rows.length === 0) {
          await client.query(
            `INSERT INTO deposits (id, user_id, account_id, amount_cents, coin, status, credited, credited_cents)
             VALUES ($1, $2, $3, $4, 'USD', 'finished', true, $4)
             ON CONFLICT (id) DO NOTHING`,
            [depId, e.uid, e.accountId, e.cents]
          );
        }

        await client.query(
          `INSERT INTO qualified_deposits (id, user_id, deposit_id, amount_cents)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET amount_cents = EXCLUDED.amount_cents`,
          ['qd-' + e.eventId, e.uid, depId, e.cents]
        );

        const bwRes = await client.query('SELECT * FROM bonus_wallets WHERE user_id = $1', [e.uid]);
        if (bwRes.rows.length > 0) {
          const bw = bwRes.rows[0];
          const reqDeposit = Number(bw.first_deposit_cents ?? firstDepositCents);
          if (e.cents >= reqDeposit) {
            // Check bonus profit on account
            const freshAccRes = await client.query('SELECT bonus_profit_cents FROM accounts WHERE id = $1', [e.accountId]);
            const profitCents = Number(freshAccRes.rows[0]?.bonus_profit_cents ?? 0);
            const profitLimit = Number(bw.profit_limit_cents ?? 20000);
            const withdrawableProfit = Math.min(profitLimit, profitCents);

            if (withdrawableProfit > 0) {
              const unlockJournalId = 'profit-unlock-' + e.eventId;
              await client.query(
                `INSERT INTO journals (id, kind, reference)
                 VALUES ($1, 'bonus_profit_unlock', $2)
                 ON CONFLICT (id) DO NOTHING`,
                [unlockJournalId, e.eventId]
              );

              await client.query(
                `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
                 VALUES
                   ($1, $2, $3, 'cash', $4),
                   ($1, $2, $3, 'bonus_profit', -$4)`,
                [unlockJournalId, e.uid, e.accountId, withdrawableProfit]
              );
            }
          }
        }
      }
    }

    // 6. Referral reward qualification
    const rewRes = await client.query('SELECT * FROM referral_rewards WHERE referred_user_id = $1', [e.uid]);
    if (rewRes.rows.length > 0) {
      const reward = rewRes.rows[0];
      const isReferralEligible = e.eligible && e.cents >= firstDepositCents && reward.status === 'pending';

      if (isReferralEligible) {
        if (reward.referrer_user_id === e.uid) {
          await client.query(
            "UPDATE referral_rewards SET status = 'rejected', updated_at = NOW() WHERE referred_user_id = $1",
            [e.uid]
          );
        } else {
          const [rkRes, rfkRes] = await Promise.all([
            client.query('SELECT customer_key FROM verified_customers WHERE user_id = $1', [reward.referrer_user_id]),
            client.query('SELECT customer_key FROM verified_customers WHERE user_id = $1', [e.uid])
          ]);

          const rk = rkRes.rows[0]?.customer_key;
          const rfk = rfkRes.rows[0]?.customer_key;

          if (rk && rfk && rk === rfk) {
            await client.query(
              "UPDATE referral_rewards SET status = 'rejected', updated_at = NOW() WHERE referred_user_id = $1",
              [e.uid]
            );
          } else {
            const evCheck = await client.query('SELECT id FROM program_evidence WHERE id = $1', [e.uid]);
            if (evCheck.rows.length === 0) {
              const meta = JSON.stringify({
                depositCents: e.cents,
                eventId: e.eventId,
                termsVersion: cfg.termsVersion ?? 'v1.0'
              });
              await client.query(
                `INSERT INTO program_evidence (id, user_id, kind, metadata)
                 VALUES ($1, $2, 'referral_qualified', $3::jsonb)`,
                [e.uid, e.uid, meta]
              );

              await client.query(
                `UPDATE referral_rewards
                 SET status = 'approved', evidence_id = $1, qualified_at = NOW(), approved_at = NOW()
                 WHERE referred_user_id = $2`,
                [e.uid, e.uid]
              );

              // Update referrer counts
              await client.query(
                `UPDATE program_members
                 SET qualified_count = qualified_count + 1, pending_cents = pending_cents + $1
                 WHERE user_id = $2`,
                [Number(reward.amount_cents ?? 8000), reward.referrer_user_id]
              );

              // Update ancestors active team count
              const mRes = await client.query('SELECT ancestors FROM program_members WHERE user_id = $1', [e.uid]);
              if (mRes.rows.length > 0) {
                const ancestors: string[] = Array.isArray(mRes.rows[0].ancestors)
                  ? mRes.rows[0].ancestors
                  : JSON.parse(mRes.rows[0].ancestors || '[]');
                for (const ancId of ancestors) {
                  await client.query(
                    'UPDATE program_members SET active_team_count = active_team_count + 1 WHERE user_id = $1',
                    [ancId]
                  );
                }
              }
            }
          }
        }
      }
    }

    // 7. Update member badges
    const memRes = await client.query('SELECT badges FROM program_members WHERE user_id = $1', [e.uid]);
    if (memRes.rows.length > 0) {
      const badges: string[] = Array.isArray(memRes.rows[0].badges)
        ? memRes.rows[0].badges
        : JSON.parse(memRes.rows[0].badges || '[]');
      if (!badges.includes('first_deposit')) {
        badges.push('first_deposit');
        await client.query('UPDATE program_members SET badges = $1::jsonb WHERE user_id = $2', [
          JSON.stringify(badges),
          e.uid
        ]);
      }
    }

    // 8. Record trusted_events & audit
    await client.query(
      `INSERT INTO trusted_events (event_id, user_id, account_id, type, fingerprint, cents, status)
       VALUES ($1, $2, $3, 'deposit', $4, $5, 'confirmed')
       ON CONFLICT (event_id) DO NOTHING`,
      [e.eventId, e.uid, e.accountId, fingerprint, e.cents]
    );

    const auditPayload = JSON.stringify({ eventId: e.eventId, cents: e.cents, accountId: e.accountId });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ('provider', 'DEPOSIT_CONFIRMED', $1, $2::jsonb, $3)
       ON CONFLICT (action, reference) DO NOTHING`,
      [e.uid, auditPayload, hash(auditPayload)]
    );
  });
}

export async function recordFinalBonusProfit(e: {
  eventId: string;
  uid: string;
  accountId: string;
  asset: string;
  profitCents: number;
  closedAt: number;
}) {
  key(e.eventId);
  key(e.uid);
  key(e.accountId);
  if (!validMoney(e.profitCents) || !Number.isSafeInteger(e.closedAt)) {
    throw new ApiError('Invalid finalized net profit');
  }

  return withTx(async (client) => {
    const fingerprint = hash(JSON.stringify(e));

    // 1. Idempotency check
    const evRes = await client.query('SELECT fingerprint FROM trusted_events WHERE event_id = $1', [e.eventId]);
    if (evRes.rows.length > 0) {
      if (evRes.rows[0].fingerprint !== fingerprint) throw new ApiError('Event conflict', 409);
      return;
    }

    // 2. Bonus wallet check
    const bwRes = await client.query('SELECT * FROM bonus_wallets WHERE user_id = $1', [e.uid]);
    if (bwRes.rows.length === 0 || bwRes.rows[0].account_id !== e.accountId) throw new ApiError('Trade not eligible', 409);
    const bw = bwRes.rows[0];

    // 3. KYC check
    const vcRes = await client.query('SELECT verified, revoked FROM verified_customers WHERE user_id = $1', [e.uid]);
    if (vcRes.rows.length === 0 || !vcRes.rows[0].verified || vcRes.rows[0].revoked) throw new ApiError('Trade not eligible', 409);

    // 4. Trade validity window & asset
    const claimedAt = new Date(bw.claimed_at).getTime();
    const expiresAt = new Date(bw.expires_at).getTime();
    const eligibleAssets: string[] = Array.isArray(bw.eligible_assets)
      ? bw.eligible_assets
      : JSON.parse(bw.eligible_assets || '[]');

    if (e.closedAt < claimedAt || e.closedAt > expiresAt || !eligibleAssets.includes(e.asset)) {
      throw new ApiError('Trade not eligible', 409);
    }

    // 5. Cap check
    const accRes = await client.query('SELECT bonus_profit_cents FROM accounts WHERE id = $1', [e.accountId]);
    const currentProfit = Number(accRes.rows[0]?.bonus_profit_cents ?? 0);
    const newProfit = currentProfit + e.profitCents;
    const profitLimit = Number(bw.profit_limit_cents);

    if (!validMoney(newProfit) || newProfit > profitLimit) {
      throw new ApiError('Configured profit cap exceeded; review required', 409);
    }

    // 6. Ledger insert for bonus profit (bonus_profit vs system:broker-clearing)
    const journalId = 'profit-' + e.eventId;
    await client.query(
      `INSERT INTO journals (id, kind, reference)
       VALUES ($1, 'bonus_settlement', $2)
       ON CONFLICT (id) DO NOTHING`,
      [journalId, e.eventId]
    );

    await client.query(
      `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
       VALUES
         ($1, $2, $3, 'bonus_profit', $4),
         ($1, NULL, NULL, 'system:broker-clearing', -$4)`,
      [journalId, e.uid, e.accountId, e.profitCents]
    );

    // Check if qualified deposit unlocks this profit immediately
    const qdRes = await client.query('SELECT amount_cents FROM qualified_deposits WHERE user_id = $1', [e.uid]);
    const qualifiedCents = qdRes.rows[0] ? Number(qdRes.rows[0].amount_cents) : 0;
    const reqDeposit = Number(bw.first_deposit_cents ?? 50000);
    if (qualifiedCents >= reqDeposit) {
      const unlockJournalId = 'profit-unlock-' + e.eventId;
      await client.query(
        `INSERT INTO journals (id, kind, reference)
         VALUES ($1, 'bonus_profit_unlock', $2)
         ON CONFLICT (id) DO NOTHING`,
        [unlockJournalId, e.eventId]
      );

      await client.query(
        `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
         VALUES
           ($1, $2, $3, 'cash', $4),
           ($1, $2, $3, 'bonus_profit', -$4)`,
        [unlockJournalId, e.uid, e.accountId, e.profitCents]
      );
    }

    // 7. Update badges
    const mRes = await client.query('SELECT badges FROM program_members WHERE user_id = $1', [e.uid]);
    if (mRes.rows.length > 0) {
      const badges: string[] = Array.isArray(mRes.rows[0].badges)
        ? mRes.rows[0].badges
        : JSON.parse(mRes.rows[0].badges || '[]');
      if (!badges.includes('trader')) {
        badges.push('trader');
        await client.query('UPDATE program_members SET badges = $1::jsonb WHERE user_id = $2', [
          JSON.stringify(badges),
          e.uid
        ]);
      }
    }

    // 8. Record trusted_events & audit
    await client.query(
      `INSERT INTO trusted_events (event_id, user_id, account_id, type, fingerprint, cents, status)
       VALUES ($1, $2, $3, 'bonus_profit', $4, $5, 'confirmed')
       ON CONFLICT (event_id) DO NOTHING`,
      [e.eventId, e.uid, e.accountId, fingerprint, e.profitCents]
    );

    const auditPayload = JSON.stringify({ eventId: e.eventId, profitCents: e.profitCents });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ('broker', 'BONUS_PROFIT_CONFIRMED', $1, $2::jsonb, $3)
       ON CONFLICT (action, reference) DO NOTHING`,
      [e.uid, auditPayload, hash(auditPayload)]
    );
  });
}
