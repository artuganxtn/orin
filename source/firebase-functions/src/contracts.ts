import { withTx, pool } from './db.ts';
import { createHash, randomUUID } from 'node:crypto';
import { getTradingAccounts } from './client-services.ts';
import { requireVerifiedKyc } from './kyc.ts';
import { notifyTradeOpened, notifyTradeSettled } from './notifications.ts';
import { loadContractWallet, saveContractWallet, readBalanceCents } from './wallet-ledger.ts';
import { readPolicyRuntime, policyLedger, cohortAmount, recordSignalResult, savePolicyEvidence, policyTimestamp } from './financial-policy.ts';
import { proportionalCents } from '../../lib/financial-policy';

export interface Identity {
  id: string;
  email?: string;
  verified?: boolean;
  role?: string;
}

export function hash(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function resultCents(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10000);
}

export class ApiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function publish(u: Identity, input: any, now = Date.now()) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const asset = input.asset;
  const direction = input.direction;
  const duration = Number(input.durationSec);
  const bps = Number(input.settlementBps);
  const opensAt = Number(input.opensAt);
  const closesAt = Number(input.closesAt);
  const eligibility = input.eligibility ?? 'all';

  if (!title || title.length > 80 || !['BUY', 'SELL'].includes(direction)) {
    throw new ApiError('بيانات العقد غير صالحة.');
  }
  if (!Number.isInteger(duration) || duration < 60 || duration > 300 || !Number.isInteger(bps) || Math.abs(bps) > 1000) {
    throw new ApiError('المدة 60–300 ثانية والتسوية من -10% إلى +10%.');
  }
  if (!['all', 'standard', 'advanced', 'vip'].includes(eligibility) || opensAt >= closesAt) {
    throw new ApiError('نافذة المشاركة أو الأهلية غير صالحة.');
  }

  const key = `cnt-${hash(title + asset + opensAt).slice(0, 16)}`;
  const code = `LAB-${hash(key).slice(0, 10).toUpperCase()}`;
  const terms = {
    version: 1,
    id: key,
    code,
    title,
    asset,
    direction,
    durationSec: duration,
    settlementBps: bps,
    eligibility,
    opensAt,
    closesAt,
    publishedAt: now,
    adminId: u.id,
  };
  const canonical = JSON.stringify(terms);
  const digest = hash(canonical);

  return withTx(async (client) => {
    await client.query(
      `INSERT INTO contracts (id, code, title, asset, direction, duration_sec, settlement_bps, opens_at, closes_at, eligibility, canonical, published_at, admin_id, hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0), $10, $11, to_timestamp($12 / 1000.0), $13, $14, 'active')`,
      [key, code, title, asset, direction, duration, bps, opensAt, closesAt, eligibility, canonical, now, u.id, digest]
    );

    const payload = JSON.stringify({ terms, sha256: digest });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ($1, 'CONTRACT_PUBLISHED_AND_LOCKED', $2, $3::jsonb, $4)
       ON CONFLICT (action, reference) DO NOTHING`,
      [u.id, key, payload, hash(payload)]
    );

    return { id: key, code, hash: digest };
  });
}

export async function join(u: Identity, input: any, now = Date.now()) {
  const rawCode = String(input.code ?? input.contractId ?? '').trim();
  const amount = Number(input.amountCents);
  if (!rawCode || !Number.isSafeInteger(amount) || amount <= 0 || input.confirmed !== true) {
    throw new ApiError('راجع المبلغ وأكّد شروط الحساب.');
  }

  return withTx(async (client) => {
    // 1. Fetch Contract
    const cRes = await client.query(
      `SELECT c.*, COALESCE(r.revoked, false) AS is_revoked
       FROM contracts c
       LEFT JOIN contract_revocation_state r ON c.id = r.contract_id
       WHERE c.code = $1 OR c.id = $1`,
      [rawCode]
    );
    if (cRes.rows.length === 0) throw new ApiError('الدعوة غير متاحة لحسابك.', 404);
    const c = cRes.rows[0];

    if (c.is_revoked || c.status !== 'active') throw new ApiError('تم إيقاف هذا الكود.', 409);

    const opensAtMs = new Date(c.opens_at).getTime();
    const closesAtMs = new Date(c.closes_at).getTime();
    if (now < opensAtMs || now >= closesAtMs) throw new ApiError('العقد خارج نافذة المشاركة.', 409);

    if (input.contractHash && input.contractHash !== c.hash) {
      throw new ApiError('راجع شروط العقد الحالية.', 409);
    }

    // 2. Eligibility Check against Profile Tier & Agency (Wakil) status
    const profRes = await client.query('SELECT tier, role FROM profiles WHERE id = $1', [u.id]);
    const userTier = profRes.rows[0]?.tier ?? 'standard';
    const userRole = profRes.rows[0]?.role ?? 'user';

    let isWakil = userRole === 'agency' || userRole === 'admin' || userTier === 'advanced' || userTier === 'vip';
    if (!isWakil) {
      try {
        const agencyRes = await client.query(
          `SELECT data FROM docs WHERE collection = 'agencies' AND id = $1`,
          [u.id]
        );
        isWakil = agencyRes.rows[0]?.data?.agencyGranted === true;
      } catch {
        isWakil = false;
      }
    }

    if (c.eligibility !== 'all') {
      const isEligible = c.eligibility === userTier || (['advanced', 'vip'].includes(c.eligibility) && isWakil);
      if (!isEligible) {
        throw new ApiError('حسابك غير مؤهل لهذا العقد (هذه الصفقة مخصصة للوكلاء المعتمدين فقط).', 403);
      }
    }

    // 3. Resolve Account & Lock for Update
    let accRes = await client.query(
      input.accountId
        ? `SELECT * FROM accounts WHERE user_id = $1 AND id = $2 FOR UPDATE`
        : `SELECT * FROM accounts WHERE user_id = $1 AND type = 'real' FOR UPDATE`,
      input.accountId ? [u.id, input.accountId] : [u.id]
    );
    if (accRes.rows.length === 0 && !input.accountId) {
      accRes = await client.query(
        `SELECT * FROM accounts WHERE user_id = $1 ORDER BY (type = 'real') DESC LIMIT 1 FOR UPDATE`,
        [u.id]
      );
    }
    if (accRes.rows.length === 0) throw new ApiError('حساب تداول غير موجود.', 404);
    const acc = accRes.rows[0];

    // 4. Strict One-Time Code Usage Check per User
    const existingPos = await client.query(
      `SELECT id, status FROM positions WHERE user_id = $1 AND contract_id = $2`,
      [u.id, c.id]
    );
    if (existingPos.rows.length > 0) {
      throw new ApiError('تم استخدام كود هذه الصفقة مسبقًا. لا يمكن استخدام الكود أكثر من مرة واحدة لكل مستخدم.', 409);
    }
    const posId = hash(`position:${u.id}:${c.id}`);

    const useBonus = input.useBonus === true;
    let policyPositionAllocation: { policyPrincipalCents: number; legacyPrincipalCents: number; activatedAt: number } | null = null;
    if (useBonus) {
      // Bonus wallet checks: claimed, expiry, and eligible assets
      const bRes = await client.query('SELECT * FROM bonus_wallets WHERE user_id = $1', [u.id]);
      if (bRes.rows.length === 0 || !bRes.rows[0].claimed) {
        throw new ApiError('محفظة البونص غير مفعلة.', 409);
      }
      const bWallet = bRes.rows[0];
      if (bWallet.expires_at && now >= new Date(bWallet.expires_at).getTime()) {
        throw new ApiError('انتهت صلاحية محفظة البونص.', 409);
      }
      const eligibleAssets = Array.isArray(bWallet.eligible_assets)
        ? bWallet.eligible_assets
        : (typeof bWallet.eligible_assets === 'string' ? JSON.parse(bWallet.eligible_assets) : []);
      if (Array.isArray(eligibleAssets) && eligibleAssets.length > 0 && !eligibleAssets.includes(c.asset)) {
        throw new ApiError('الأصل غير مؤهل للتداول بالبونص.', 409);
      }
      if (BigInt(acc.bonus_cents) < BigInt(amount)) {
        throw new ApiError('رصيد البونص غير كافٍ لهذا العقد.', 409);
      }
    } else {
      if (BigInt(acc.balance_cents) < BigInt(amount)) {
        throw new ApiError('الرصيد المتاح غير كافٍ لهذا العقد.', 409);
      }
      // Strict separation: real-account trades are funded from Permanent Contracts (perpetualCents).
      // If Permanent Contracts balance is lower than trade amount, but Withdrawable Futures has enough,
      // seamlessly fund the needed deficit (100% free, 0% fee) so the trade never fails.
      if (acc.type === 'real') {
        const { state: wState } = await loadContractWallet(client, acc.id, u.id, acc.balance_cents, true);
        const runtime = await readPolicyRuntime(client);
        const policy = policyLedger(wState, runtime);
        const curPerp = wState.wallet.perpetualCents;
        let finalPerp = curPerp;
        let finalFutures = wState.wallet.futuresCents;

        if (curPerp < amount) {
          if (policy) {
            throw new ApiError('رصيد التداول غير كافٍ. حوّل المبلغ من المحفظة الفورية إلى محفظة التداول أولاً؛ التحويل مجاني. / Insufficient trading balance. Transfer from spot to trading first; the transfer is free.', 409);
          }
          const deficit = amount - curPerp;
          if (finalFutures >= deficit) {
            // Auto-fund from Withdrawable Futures to Permanent Contracts
            finalPerp += deficit;
            finalFutures -= deficit;
            wState.operations.unshift({
              id: 'fund-' + randomUUID(),
              kind: 'transfer',
              amountCents: deficit,
              feeCents: 0,
              feeRate: 0,
              netAmountCents: deficit,
              from: 'futures',
              to: 'perpetual',
              afterFuturesCents: finalFutures,
              afterPerpetualCents: finalPerp,
              createdAt: now
            });
          } else {
            const totalAvail = ((curPerp + finalFutures) / 100).toFixed(2);
            throw new ApiError(
              `إجمالي الرصيد المتاح في الحساب (${totalAvail} USD) غير كافٍ لقيمة هذا العقد (${(amount / 100).toFixed(2)} USD). يرجى شحن الرصيد أولاً.`,
              409
            );
          }
        }

        if (policy) {
          const policyPrincipalCents = cohortAmount(amount, wState, policy, 'trading');
          policy.policyTradingCents -= policyPrincipalCents;
          policy.policyReservedCents += policyPrincipalCents;
          policyPositionAllocation = { policyPrincipalCents, legacyPrincipalCents: amount - policyPrincipalCents, activatedAt: policy.activatedAt };
        }
        // Allocate trade amount from Permanent Contracts
        wState.wallet.perpetualCents = finalPerp - amount;
        wState.wallet.futuresCents = finalFutures;
        await saveContractWallet(client, acc.id, u.id, wState);
      }
    }

    const durationSec = c.duration_sec;
    const endsAtMs = now + durationSec * 1000;
    const pnl = resultCents(amount, c.settlement_bps);

    // 5. Insert Position
    await client.query(
      `INSERT INTO positions (id, user_id, contract_id, account_id, amount_cents, result_cents, is_bonus, status, started_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0))`,
      [posId, u.id, c.id, acc.id, amount, pnl, useBonus, now, endsAtMs]
    );
    if (policyPositionAllocation) {
      await savePolicyEvidence(client, 'financial_policy_positions', posId, u.id, {
        accountId: acc.id, ...policyPositionAllocation,
      });
    }

    // 6. Insert Journal & Entries (Double-Entry Ledger)
    const jid = `allocate:${posId}`;
    const kind = useBonus ? 'bonus_allocation' : 'allocation';
    await client.query(
      `INSERT INTO journals (id, kind, reference) VALUES ($1, $2, $3)`,
      [jid, kind, posId]
    );

    if (useBonus) {
      await client.query(
        `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
         ($1, $2, $3, 'bonus', $4),
         ($1, $2, $3, 'bonus_reserved', $5)`,
        [jid, u.id, acc.id, -amount, amount]
      );
    } else {
      await client.query(
        `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
         ($1, $2, $3, 'cash', $4),
         ($1, $2, $3, 'reserved', $5)`,
        [jid, u.id, acc.id, -amount, amount]
      );
    }

    // 7. Audit (idempotent unique on action + reference)
    const auditPayload = JSON.stringify({
      contractId: c.id,
      contractHash: c.hash,
      amountCents: amount,
      startedAt: now,
      endsAt: endsAtMs,
      accountId: acc.id,
      isBonus: useBonus,
    });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ($1, 'AMOUNT_ALLOCATED', $2, $3::jsonb, $4)
       ON CONFLICT (action, reference) DO NOTHING`,
      [u.id, posId, auditPayload, hash(auditPayload)]
    );

    // Enhanced notification on opening a trade
    await notifyTradeOpened(client, {
      userId: u.id,
      positionId: posId,
      asset: c.asset,
      direction: c.direction,
      amountCents: amount,
      durationSec: c.duration_sec
    });

    return { id: posId, reused: false };
  });
}

export async function settle(u: Identity, now = Date.now()) {
  return withTx(async (client) => {
    // Select active positions due for settlement
    const posRes = await client.query(
      `SELECT p.*, c.settlement_bps, c.code AS contract_code, c.hash AS contract_hash, c.asset, c.direction, c.duration_sec
       FROM positions p
       JOIN contracts c ON p.contract_id = c.id
       WHERE p.user_id = $1 AND p.status = 'active' AND p.ends_at <= to_timestamp($2 / 1000.0)
       FOR UPDATE OF p SKIP LOCKED`,
      [u.id, now]
    );

    const settledResults = [];
    for (const p of posRes.rows) {
      if (p.status !== 'active') continue;

      // Serialize deposits, transfers, trades, withdrawals and the permanent
      // exemption latch on the same account row, before touching its cash.
      const accountRes = await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [p.account_id]);
      const account = accountRes.rows[0];
      if (!account) throw new ApiError('حساب التداول غير موجود.', 409);
      const realCash = !p.is_bonus && account.type === 'real';
      const walletBefore = realCash ? (await loadContractWallet(client, p.account_id, u.id, account.balance_cents, true)).state : null;
      const runtime = realCash ? await readPolicyRuntime(client) : { activatedAt: null };
      const policy = walletBefore ? policyLedger(walletBefore, runtime) : null;
      const allocationRes = policy
        ? await client.query("SELECT data FROM docs WHERE collection = 'financial_policy_positions' AND id = $1", [p.id])
        : { rows: [] };
      const policyPrincipalCents = Number(allocationRes.rows[0]?.data?.policyPrincipalCents ?? 0);
      const settledAt = await policyTimestamp(client);

      const expected = resultCents(Number(p.amount_cents), p.settlement_bps);
      const jid = `settle:${p.id}`;
      const amountCents = Number(p.amount_cents);

      // Update position
      await client.query(
        `UPDATE positions SET status = 'settled', settled_at = to_timestamp($1 / 1000.0) WHERE id = $2`,
        [settledAt, p.id]
      );

      // Receipt
      const receipt = {
        version: 1,
        receiptId: `R-${p.id.slice(0, 12).toUpperCase()}`,
        contractId: p.contract_id,
        contractCode: p.contract_code,
        contractHash: p.contract_hash,
        positionId: p.id,
        asset: p.asset,
        direction: p.direction,
        amountCents,
        durationSec: p.duration_sec,
        lockedSettlementBps: p.settlement_bps,
        resultCents: expected,
        returnedCents: amountCents + expected,
        processedAt: settledAt,
      };
      const payloadStr = JSON.stringify(receipt);
      const receiptHash = hash(payloadStr);

      await client.query(
        `INSERT INTO receipts (id, position_id, user_id, payload, hash)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (position_id) DO NOTHING`,
        [`receipt:${p.id}`, p.id, u.id, payloadStr, receiptHash]
      );

      // Journal & entries
      if (p.is_bonus) {
        await client.query(
          `INSERT INTO journals (id, kind, reference) VALUES ($1, 'bonus_settlement', $2)`,
          [jid, p.id]
        );
        if (expected >= 0) {
          // Profit: principal returned to bonus bucket, profit to bonus_profit bucket
          await client.query(
            `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
             ($1, $2, $3, 'bonus_reserved', $4),
             ($1, $2, $3, 'bonus', $5)`,
            [jid, u.id, p.account_id, -amountCents, amountCents]
          );
          if (expected > 0) {
            await client.query(
              `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
               ($1, $2, $3, 'bonus_profit', $4),
               ($1, NULL, NULL, 'system:program-payout', $5)`,
              [jid, u.id, p.account_id, expected, -expected]
            );
          }
        } else {
          // Loss: principal returned minus loss to bonus bucket, counter-entry on system:program-pnl
          const returnedBonus = amountCents + expected;
          const lossCents = -expected;
          await client.query(
            `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
             ($1, $2, $3, 'bonus_reserved', $4),
             ($1, $2, $3, 'bonus', $5),
             ($1, NULL, NULL, 'system:program-pnl', $6)`,
            [jid, u.id, p.account_id, -amountCents, returnedBonus, lossCents]
          );
        }
      } else {
        await client.query(
          `INSERT INTO journals (id, kind, reference) VALUES ($1, 'settlement', $2)`,
          [jid, p.id]
        );
        await client.query(
          `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
           ($1, $2, $3, 'reserved', $4),
           ($1, $2, $3, 'cash', $5),
           ($1, NULL, NULL, 'system:trading-pnl', $6)`,
          [jid, u.id, p.account_id, -amountCents, amountCents + expected, -expected]
        );
      }

      // Return principal + P&L directly to Permanent Contracts (perpetualCents) — never to withdrawable futures.
      if (walletBefore) {
        const balanceAfter = await readBalanceCents(client, p.account_id);
        walletBefore.wallet.perpetualCents += Math.max(0, amountCents + expected);
        walletBefore.wallet.futuresCents = balanceAfter - walletBefore.wallet.perpetualCents;
        if (policy) {
          if (!Number.isSafeInteger(policyPrincipalCents) || policyPrincipalCents < 0 || policyPrincipalCents > amountCents
            || policy.policyReservedCents < policyPrincipalCents) throw new ApiError('Trade cohort requires reconciliation', 409);
          const policyProfitCents = proportionalCents(expected, policyPrincipalCents, amountCents);
          policy.policyReservedCents -= policyPrincipalCents;
          policy.policyTradingCents += policyPrincipalCents + policyProfitCents;
          // Every position here is an official contract/code signal, whether
          // admin-published or scheduled. Bonus and generic cash income never enter.
          const counted = policy.firstEligibleDepositAt !== null && settledAt >= policy.firstEligibleDepositAt;
          recordSignalResult(policy, expected, settledAt);
          await savePolicyEvidence(client, 'financial_policy_settlements', p.id, u.id, {
            accountId: p.account_id, profitCents: expected, policyProfitCents, counted, settledAt,
            permanentlyExemptAt: policy.permanentlyExemptAt,
          });
        }
        await saveContractWallet(client, p.account_id, u.id, walletBefore);
      }

      // Enhanced notification on trade settlement
      await notifyTradeSettled(client, {
        userId: u.id,
        positionId: p.id,
        asset: p.asset,
        direction: p.direction,
        amountCents,
        resultCents: expected
      });

      settledResults.push({ positionId: p.id, resultCents: expected });
    }
    return settledResults;
  });
}

export async function state(u: Identity, now = Date.now()) {
  const client = await pool.connect();
  try {
    const profRes = await client.query(`SELECT * FROM profiles WHERE id = $1`, [u.id]);
    const accRes = await client.query(`SELECT * FROM accounts WHERE user_id = $1 AND type = 'real'`, [u.id]);
    const posRes = await client.query(
      `SELECT * FROM positions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 100`,
      [u.id]
    );
    const cntRes = await client.query(
      `SELECT * FROM contracts ORDER BY opens_at DESC LIMIT 100`
    );
    const recRes = await client.query(
      `SELECT * FROM receipts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [u.id]
    );
    const jrnRes = await client.query(
      `SELECT je.*, j.kind, j.reference, j.created_at
       FROM journal_entries je
       JOIN journals j ON je.journal_id = j.id
       WHERE je.user_id = $1
       ORDER BY je.id DESC LIMIT 300`,
      [u.id]
    );

    const user = profRes.rows[0] ?? { id: u.id, display_name: '', tier: 'standard' };
    const isAdmin = u.role === 'admin' || user.role === 'admin';
    const seenAt = user.preferences?.seen_at ? Number(user.preferences.seen_at) : (user.updated_at ? new Date(user.updated_at).getTime() : 0);
    const acceptedAt = user.accepted_at ? new Date(user.accepted_at).getTime() : null;

    const acc = accRes.rows[0] ?? {
      balance_cents: '0',
      reserved_cents: '0',
      realized_cents: '0',
      bonus_cents: '0',
      bonus_reserved_cents: '0',
      bonus_profit_cents: '0',
    };

    let accountDirectory = null;
    try {
      accountDirectory = await getTradingAccounts(u, client);
    } catch {
      accountDirectory = { accounts: [], activeId: '' };
    }

    // Wallet split for the real account (permanent = trading only, futures = withdrawable)
    let perpetualCents = 0;
    let futuresCents = Number(acc.balance_cents || 0);
    if (acc.id) {
      try {
        const { state: w } = await loadContractWallet(client, acc.id, u.id, acc.balance_cents, false);
        perpetualCents = w.wallet.perpetualCents;
        futuresCents = w.wallet.futuresCents;
      } catch {
        /* keep defaults */
      }
    }

    const contracts = cntRes.rows.map(c => ({
      id: c.id,
      code: c.code,
      title: c.title,
      asset: c.asset,
      direction: c.direction,
      duration_sec: Number(c.duration_sec),
      durationSec: Number(c.duration_sec),
      settlement_bps: Number(c.settlement_bps),
      settlementBps: Number(c.settlement_bps),
      eligibility: c.eligibility,
      canonical: c.canonical || '',
      opens_at: c.opens_at ? new Date(c.opens_at).getTime() : 0,
      opensAt: c.opens_at ? new Date(c.opens_at).getTime() : 0,
      closes_at: c.closes_at ? new Date(c.closes_at).getTime() : 0,
      closesAt: c.closes_at ? new Date(c.closes_at).getTime() : 0,
      published_at: c.published_at ? new Date(c.published_at).getTime() : (c.created_at ? new Date(c.created_at).getTime() : 0),
      publishedAt: c.published_at ? new Date(c.published_at).getTime() : (c.created_at ? new Date(c.created_at).getTime() : 0),
      admin_id: c.admin_id || '',
      hash: c.hash || '',
      participants: 0
    }));
    const contractMap = new Map(contracts.map(c => [c.id, c]));

    const positions = posRes.rows.map(p => {
      let contract = contractMap.get(p.contract_id);
      if (!contract) {
        contract = {
          id: p.contract_id,
          code: '',
          title: '',
          asset: 'XAUUSD',
          direction: 'BUY',
          duration_sec: 60,
          durationSec: 60,
          settlement_bps: 0,
          settlementBps: 0,
          eligibility: 'all',
          canonical: '',
          opens_at: 0,
          opensAt: 0,
          closes_at: 0,
          closesAt: 0,
          published_at: 0,
          publishedAt: 0,
          admin_id: '',
          hash: '',
          participants: 0
        };
      }
      return {
        id: p.id,
        user_id: p.user_id,
        userId: p.user_id,
        contract_id: p.contract_id,
        contractId: p.contract_id,
        account_id: p.account_id,
        accountId: p.account_id,
        amount_cents: Number(p.amount_cents),
        amountCents: Number(p.amount_cents),
        result_cents: Number(p.result_cents),
        resultCents: Number(p.result_cents),
        is_bonus: Boolean(p.is_bonus),
        isBonus: Boolean(p.is_bonus),
        status: p.status,
        started_at: p.started_at ? new Date(p.started_at).getTime() : 0,
        startedAt: p.started_at ? new Date(p.started_at).getTime() : 0,
        ends_at: p.ends_at ? new Date(p.ends_at).getTime() : 0,
        endsAt: p.ends_at ? new Date(p.ends_at).getTime() : 0,
        settled_at: p.settled_at ? new Date(p.settled_at).getTime() : null,
        settledAt: p.settled_at ? new Date(p.settled_at).getTime() : null,
        contract
      };
    });

    let notifications: any[] = [];
    try {
      const noticeRows = await client.query(
        `SELECT id, data, updated_at FROM docs
         WHERE collection = 'orinNotices'
           AND (owner_id = $1 OR owner_id IS NULL OR data->>'user_id' = $1 OR data->>'user_id' = '*')
         ORDER BY updated_at DESC LIMIT 50`,
        [u.id]
      );
      notifications = noticeRows.rows.map(r => ({
        id: r.id,
        title: r.data?.title || '',
        message: r.data?.message || r.data?.body || '',
        contract_id: r.data?.contract_id || null,
        created_at: r.data?.created_at || (r.updated_at ? new Date(r.updated_at).getTime() : now)
      }));
    } catch {
      notifications = [];
    }

    const receipts = recRes.rows.map(r => ({
      id: r.id,
      position_id: r.position_id,
      positionId: r.position_id,
      user_id: r.user_id,
      userId: r.user_id,
      payload: typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload),
      hash: r.hash,
      created_at: r.created_at ? new Date(r.created_at).getTime() : 0,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : 0
    }));

    const ledger = jrnRes.rows.map(je => ({
      id: String(je.id),
      journal_id: je.journal_id,
      journalId: je.journal_id,
      account_id: je.account_id,
      accountId: je.account_id,
      account: je.bucket,
      bucket: je.bucket,
      amount_cents: Number(je.amount_cents),
      amountCents: Number(je.amount_cents),
      kind: je.kind,
      reference: je.reference || null,
      effective_at: je.created_at ? new Date(je.created_at).getTime() : 0,
      effectiveAt: je.created_at ? new Date(je.created_at).getTime() : 0
    }));

    let audit: any[] = [];
    if (isAdmin) {
      try {
        const audRes = await client.query(`SELECT * FROM audit ORDER BY created_at DESC LIMIT 100`);
        audit = audRes.rows.map(a => ({
          id: String(a.id),
          actor_id: a.actor_id,
          action: a.action,
          reference: a.reference,
          payload: typeof a.payload === 'string' ? a.payload : JSON.stringify(a.payload),
          payload_hash: a.payload_hash,
          created_at: a.created_at ? new Date(a.created_at).getTime() : 0
        }));
      } catch {
        audit = [];
      }
    }

    let totalRealizedCents = Number(acc.realized_cents || 0);
    let dailyProfitCents = 0;
    try {
      const settledRes = await client.query(
        `SELECT
           COALESCE(SUM(result_cents), 0) AS total_settled,
           COALESCE(SUM(CASE WHEN COALESCE(settled_at, ends_at) >= NOW() - INTERVAL '24 hours' THEN result_cents ELSE 0 END), 0) AS daily_settled
         FROM positions
         WHERE user_id = $1 AND status = 'settled'`,
        [u.id]
      );
      const settled = Number(settledRes.rows[0]?.total_settled || 0);
      dailyProfitCents = Number(settledRes.rows[0]?.daily_settled || 0);
      const bonusProfit = Number(acc.bonus_profit_cents || 0);
      const accRealized = Number(acc.realized_cents || 0);
      totalRealizedCents = settled !== 0 ? (settled + bonusProfit) : (accRealized !== 0 ? accRealized : bonusProfit);
    } catch {
      totalRealizedCents = Number(acc.realized_cents || 0);
      dailyProfitCents = 0;
    }

    return {
      serverTime: now,
      user: {
        id: u.id,
        name: user.display_name || 'مستخدم ORIN',
        tier: user.tier || 'standard',
        accepted_at: acceptedAt,
        acceptedAt,
        seen_at: seenAt,
        seenAt
      },
      isAdmin,
      accountDirectory,
      balanceCents: Number(acc.balance_cents),
      perpetualCents,
      futuresCents,
      reservedCents: Number(acc.reserved_cents),
      realizedCents: totalRealizedCents,
      dailyProfitCents,
      bonusCents: Number(acc.bonus_cents),
      bonusReservedCents: Number(acc.bonus_reserved_cents),
      bonusProfitCents: Number(acc.bonus_profit_cents),
      bonus_cents: Number(acc.bonus_cents),
      bonus_reserved_cents: Number(acc.bonus_reserved_cents),
      bonus_profit_cents: Number(acc.bonus_profit_cents),
      contracts,
      positions,
      notifications,
      receipts,
      ledger,
      audit,
    };
  } finally {
    client.release();
  }
}

export async function revokeContract(u: Identity, contractId: string, reason?: string, effectiveNow = Date.now()) {
  return await withTx(async (client) => {
    await client.query(`UPDATE contracts SET status = 'cancelled' WHERE id = $1`, [contractId]);
    await client.query(`
      INSERT INTO contract_revocation_state (contract_id, revoked, reason, revoked_by, revoked_at)
      VALUES ($1, TRUE, $2, $3, TO_TIMESTAMP($4 / 1000.0))
      ON CONFLICT (contract_id) DO UPDATE SET revoked = TRUE, reason = $2, revoked_by = $3, revoked_at = TO_TIMESTAMP($4 / 1000.0)
    `, [contractId, reason || 'Revoked by admin', u.id, effectiveNow]);
    return { ok: true, revoked: true, contractId };
  });
}

export async function action(u: Identity, input: any, now = Date.now()) {
  const act = input?.action;
  // The HTTP body is untrusted. Only the server/trusted caller controls time;
  // a customer must not fast-forward signal settlement or fee qualification.
  const effectiveNow = now;
  let result: any = { ok: true };
  if (act === 'publish') {
    result = await publish(u, input.contract || input, effectiveNow);
  } else if (act === 'join') {
    const joinInput = {
      code: input.code || input.contractCode || input.contractId,
      amountCents: input.amountCents,
      confirmed: input.confirmed !== false,
      contractHash: input.contractHash,
      useBonus: input.useBonus
    };
    result = await join(u, joinInput, effectiveNow);
  } else if (act === 'settle') {
    result = await settle(u, effectiveNow);
  } else if (act === 'revoke') {
    result = await revokeContract(u, input.contractId, input.reason, effectiveNow);
  } else if (act === 'accept') {
    await withTx(async (client) => {
      await client.query(`UPDATE profiles SET accepted_at = NOW() WHERE id = $1`, [u.id]);
    });
    result = { ok: true, accepted: true };
  } else if (act === 'read') {
    await withTx(async (client) => {
      await client.query(
        `UPDATE profiles
         SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{seen_at}', to_jsonb($2::bigint))
         WHERE id = $1`,
        [u.id, effectiveNow]
      );
    });
    result = { ok: true, seen_at: effectiveNow };
  } else {
    throw new ApiError(`Unsupported contract action: ${act}`, 400);
  }
  const currentState = await state(u, effectiveNow);
  return { ...result, result, state: currentState };
}

export async function verify(u: Identity, code: string) {
  return await withTx(async (client) => {
    const rawCode = String(code || '').trim().toUpperCase();
    const res = await client.query('SELECT * FROM contracts WHERE code = $1 OR hash = $1', [rawCode]);
    if (res.rowCount === 0) {
      throw new ApiError('كود الصفقة غير صالح أو لم يتم العثور عليه.', 404);
    }
    const contract = res.rows[0];

    // Strictly verify if user has already participated in this contract
    const prevPositions = await client.query(
      'SELECT id, status, amount_cents FROM positions WHERE user_id = $1 AND contract_id = $2',
      [u.id, contract.id]
    );
    if (prevPositions.rows.length > 0) {
      throw new ApiError('تم استخدام كود هذه الصفقة مسبقًا من قِبل هذا الحساب. لا يمكن استخدام الكود أكثر من مرة واحدة.', 409);
    }

    return { ok: true, contract };
  });
}

