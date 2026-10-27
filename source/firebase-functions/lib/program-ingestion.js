var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};

// src/db.ts
import pg from "pg";
async function withTx(fn, maxRetries = 5) {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("SET client_encoding TO 'UTF8'").catch(() => {
      });
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      client.release();
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
      });
      client.release(err);
      if ((err.code === "40001" || err.code === "40P01") && attempt < maxRetries) {
        attempt++;
        const backoffMs = Math.floor(Math.random() * 50) * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw err;
    }
  }
}
var Pool, connectionString, isLocal, pool;
var init_db = __esm({
  "src/db.ts"() {
    ({ Pool } = pg);
    connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    if (!connectionString.includes("client_encoding")) {
      connectionString += (connectionString.includes("?") ? "&" : "?") + "client_encoding=UTF8";
    }
    isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
    pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 8
    });
    pool.on("error", (err, _client) => {
      console.error("Unexpected error on idle PostgreSQL client", err);
    });
  }
});

// src/wallet-ledger.ts
async function loadContractWallet(client, accountId, ownerId, balanceCents, lock = true) {
  const res = await client.query(
    `SELECT data FROM docs WHERE collection = 'contract_wallets' AND id = $1${lock ? " FOR UPDATE" : ""}`,
    [accountId]
  );
  const raw = res.rows[0]?.data;
  const existed = !!raw?.wallet;
  const state = existed ? { ...raw, operations: Array.isArray(raw.operations) ? raw.operations : [] } : {
    wallet: {
      ownerId,
      accountId,
      currency: "USD",
      futuresCents: 0,
      perpetualCents: 0,
      version: 1,
      updatedAt: Date.now()
    },
    operations: []
  };
  normalizeWallet(state, balanceCents);
  return { state, existed };
}
function normalizeWallet(state, balanceCents) {
  const total = Math.max(0, Number(balanceCents) || 0);
  const perp = Math.min(total, Math.max(0, Math.trunc(Number(state.wallet.perpetualCents) || 0)));
  state.wallet.perpetualCents = perp;
  state.wallet.futuresCents = total - perp;
  return state;
}
async function saveContractWallet(client, accountId, ownerId, state) {
  state.wallet.version = (Number(state.wallet.version) || 1) + 1;
  state.wallet.updatedAt = Date.now();
  if (state.operations.length > 50) state.operations.length = 50;
  await client.query(
    `INSERT INTO docs (collection, id, owner_id, data, updated_at)
     VALUES ('contract_wallets', $1, $2, $3, NOW())
     ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [accountId, ownerId, JSON.stringify(state)]
  );
}
async function readBalanceCents(client, accountId) {
  const r = await client.query("SELECT balance_cents FROM accounts WHERE id = $1", [accountId]);
  return Number(r.rows[0]?.balance_cents || 0);
}
var init_wallet_ledger = __esm({
  "src/wallet-ledger.ts"() {
  }
});

// src/program-ingestion.ts
init_db();
import { createHash } from "node:crypto";

// src/notifications.ts
init_db();
import { randomUUID } from "node:crypto";
async function createNotice(client, opts) {
  const noticeId = "notif-" + randomUUID();
  const ts = opts.now || Date.now();
  const cat = opts.category === "finance" ? "financial" : opts.category || "financial";
  const targetRole = opts.targetRole || (opts.userId === "admin" || opts.deepLink?.startsWith("/admin") ? "admin" : void 0);
  const noticeData = {
    id: noticeId,
    user_id: opts.userId,
    title: opts.title,
    message: opts.message,
    category: cat,
    created_at: ts,
    deep_link: opts.deepLink || "/notifications",
    ...opts.metadata ? { metadata: opts.metadata } : {}
  };
  if (targetRole) {
    noticeData.target_role = targetRole;
  }
  const ownerId = opts.userId === "*" ? null : opts.userId;
  await client.query(
    `INSERT INTO docs (collection, id, owner_id, data, updated_at)
     VALUES ('orinNotices', $1, $2, $3::jsonb, NOW())
     ON CONFLICT (collection, id) DO UPDATE SET data = $3::jsonb, updated_at = NOW()`,
    [noticeId, ownerId, JSON.stringify(noticeData)]
  );
  return noticeData;
}
async function notifyDepositCredited(client, p) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  await createNotice(client, {
    userId: p.userId,
    title: "\u062A\u0645 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0648\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0631\u0635\u064A\u062F \u0628\u0646\u062C\u0627\u062D \u{1F4B0}",
    message: `\u062A\u0645 \u062A\u0623\u0643\u064A\u062F \u0625\u064A\u062F\u0627\u0639 \u0645\u0628\u0644\u063A ${amountUsd} USDT \u0628\u0646\u062C\u0627\u062D \u0648\u0625\u0636\u0627\u0641\u062A\u0647 \u0625\u0644\u0649 \u0645\u062D\u0641\u0638\u0629 \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u0622\u062C\u0644\u0629 \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u0643.
\u0627\u0644\u0631\u0635\u064A\u062F \u062C\u0627\u0647\u0632 \u0627\u0644\u0622\u0646 \u0644\u0644\u062A\u062D\u0648\u064A\u0644 \u0625\u0644\u0649 \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u062F\u0627\u0626\u0645\u0629 \u0644\u0628\u062F\u0621 \u0627\u0644\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u0641\u0648\u0631\u064A.`,
    category: "financial",
    deepLink: "/activity",
    metadata: {
      type: "deposit_credited",
      amountCents: p.amountCents,
      depositId: p.depositId
    }
  });
}

// src/program-ingestion.ts
init_wallet_ledger();

// ../lib/financial-policy.ts
var DEPOSIT_MIN_CENTS = 1e4;
var DEPOSIT_MAX_CENTS = 15e5;
var LEGACY_FINANCIAL_POLICY = {
  version: "legacy-29-day-v1",
  depositMinCents: DEPOSIT_MIN_CENTS,
  depositMaxCents: DEPOSIT_MAX_CENTS,
  depositCreditPocket: "futures",
  tradingPocket: "perpetual",
  withdrawablePocket: "futures",
  spotToTradingFeeRate: 0,
  tradingToSpot: { basis: "elapsed_days", days: 29, beforeFeeRate: 0.2, afterFeeRate: 0 },
  externalWithdrawalFeeRate: 0.05,
  activatedAt: null,
  automaticSpotFundingForTrades: true
};
var SIGNAL_FINANCIAL_POLICY = {
  ...LEGACY_FINANCIAL_POLICY,
  version: "signal-doubling-v1",
  depositCreditPocket: "perpetual",
  automaticSpotFundingForTrades: false,
  tradingToSpot: { basis: "actual_capital_doubling", beforeFeeRate: 0.2, afterFeeRate: 0 },
  doublingScope: "account_aggregate_new_confirmed_deposits",
  qualifyingProfit: "account_net_realized_nonbonus_official_signal_profit_after_first_eligible_deposit",
  exemption: "permanent_account_including_future_deposits",
  existingFundsTreatment: "grandfathered_original_fee_rule_until_account_exemption",
  legacyTradingToSpot: LEGACY_FINANCIAL_POLICY.tradingToSpot
};

// src/financial-policy.ts
async function policyTimestamp(client) {
  const result = await client.query("SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS now_ms");
  const timestamp = Number(result.rows[0]?.now_ms);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("Financial event time unavailable");
  return timestamp;
}
async function readPolicyRuntime(client) {
  const r = await client.query("SELECT data FROM docs WHERE collection = 'financial_policy_configuration' AND id = 'current'");
  const config = r.rows[0]?.data;
  if (!config) return { activatedAt: null };
  if (config.status === "staged" && config.activatedAt === null) return { activatedAt: null, staged: true };
  if (config.version !== "signal-doubling-v1" || config.doublingScope !== "account_aggregate" || config.existingFundsTreatment !== "grandfathered" || config.status !== "active" || config.clientReleaseConfirmed !== true || !Number.isSafeInteger(config.activatedAt) || config.activatedAt <= 0) {
    throw new Error("Financial policy configuration requires operator review");
  }
  return { activatedAt: config.activatedAt };
}
function policyLedger(state, runtime) {
  const old = state.signalPolicy;
  if (runtime.activatedAt === null) {
    if (old) throw new Error("Cannot deactivate a funded financial policy without reconciliation");
    return null;
  }
  if (old && (old.version !== "signal-doubling-v1" || old.activatedAt !== runtime.activatedAt)) throw new Error("Financial policy cutover mismatch");
  const data = old ? { ...old, earlyFeeRemainderUnits: old.earlyFeeRemainderUnits ?? 0 } : {
    version: "signal-doubling-v1",
    activatedAt: runtime.activatedAt,
    eligiblePrincipalCents: 0,
    netSignalProfitCents: 0,
    firstEligibleDepositAt: null,
    permanentlyExemptAt: null,
    policyTradingCents: 0,
    policySpotCents: 0,
    policyReservedCents: 0,
    earlyFeeRemainderUnits: 0
  };
  for (const key2 of ["eligiblePrincipalCents", "policyTradingCents", "policySpotCents", "policyReservedCents"]) {
    if (!Number.isSafeInteger(data[key2]) || data[key2] < 0) throw new Error("Financial policy amounts require reconciliation");
  }
  if (!Number.isInteger(data.earlyFeeRemainderUnits) || data.earlyFeeRemainderUnits < 0 || data.earlyFeeRemainderUnits > 4) throw new Error("Invalid early-transfer fee remainder");
  if (!Number.isSafeInteger(data.netSignalProfitCents) || data.policyTradingCents > state.wallet.perpetualCents || data.policySpotCents > state.wallet.futuresCents) {
    throw new Error("Wallet cohort mismatch requires reconciliation");
  }
  for (const timestamp of [data.firstEligibleDepositAt, data.permanentlyExemptAt]) {
    if (timestamp !== null && (!Number.isSafeInteger(timestamp) || timestamp < runtime.activatedAt)) throw new Error("Invalid financial policy event time");
  }
  if (data.eligiblePrincipalCents > 0 && data.firstEligibleDepositAt === null || data.permanentlyExemptAt !== null && (data.firstEligibleDepositAt === null || data.permanentlyExemptAt < data.firstEligibleDepositAt)) {
    throw new Error("Financial policy eligibility history requires reconciliation");
  }
  state.signalPolicy = data;
  return data;
}
function recordEligibleDeposit(policy, amountCents, confirmedAt) {
  const principal = policy.eligiblePrincipalCents + amountCents;
  if (!Number.isSafeInteger(principal)) throw new Error("Eligible principal exceeds supported range");
  policy.eligiblePrincipalCents = principal;
  policy.policyTradingCents += amountCents;
  policy.firstEligibleDepositAt ??= confirmedAt;
}
async function savePolicyEvidence(client, collection, id, ownerId, data) {
  await client.query(`INSERT INTO docs (collection, id, owner_id, data, updated_at)
    VALUES ($1, $2, $3, $4::jsonb, NOW())`, [collection, id, ownerId, JSON.stringify(data)]);
}

// src/program-ingestion.ts
var ApiError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var hash = (text) => createHash("sha256").update(text).digest("hex");
var key = (s) => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(s)) throw new ApiError("Invalid trusted event id");
  return s;
};
var validMoney = (n) => Number.isSafeInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 4;
async function recordVerifiedCustomer(uid, customerKey, eventId, idNumberLast4) {
  key(uid);
  key(eventId);
  if (!/^[a-f0-9]{64}$/.test(customerKey)) throw new ApiError("Use an irreversible provider customer fingerprint");
  return withTx(async (client) => {
    const fingerprint = hash(JSON.stringify({ uid, customerKey }));
    const evRes = await client.query("SELECT fingerprint FROM trusted_events WHERE event_id = $1", [eventId]);
    if (evRes.rows.length > 0) {
      if (evRes.rows[0].fingerprint !== fingerprint) throw new ApiError("Event conflict", 409);
      return;
    }
    const regRes = await client.query("SELECT user_id FROM customer_registry WHERE customer_key = $1", [customerKey]);
    if (regRes.rows.length > 0 && regRes.rows[0].user_id !== uid) {
      throw new ApiError("Duplicate customer", 409);
    }
    const vcRes = await client.query("SELECT customer_key FROM verified_customers WHERE user_id = $1", [uid]);
    if (vcRes.rows.length > 0 && vcRes.rows[0].customer_key !== customerKey) {
      throw new ApiError("Verification identity changed; review required", 409);
    }
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
    const mRes = await client.query("SELECT badges FROM program_members WHERE user_id = $1", [uid]);
    if (mRes.rows.length > 0) {
      const currentBadges = Array.isArray(mRes.rows[0].badges) ? mRes.rows[0].badges : JSON.parse(mRes.rows[0].badges || "[]");
      if (!currentBadges.includes("verified")) {
        currentBadges.push("verified");
        await client.query(
          "UPDATE program_members SET badges = $1::jsonb WHERE user_id = $2",
          [JSON.stringify(currentBadges), uid]
        );
      }
    }
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
async function recordConfirmedDeposit(e, transactionClient) {
  key(e.eventId);
  key(e.uid);
  key(e.accountId);
  if (e.currency !== "USD" || !validMoney(e.cents) || e.cents === 0 || typeof e.eligible !== "boolean") {
    throw new ApiError("Invalid confirmed deposit");
  }
  const run = async (client) => {
    const fingerprint = hash(JSON.stringify(e));
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["deposit:" + e.eventId]);
    const evRes = await client.query("SELECT fingerprint FROM trusted_events WHERE event_id = $1", [e.eventId]);
    if (evRes.rows.length > 0) {
      if (evRes.rows[0].fingerprint !== fingerprint) throw new ApiError("Event conflict", 409);
      return;
    }
    const profRes = await client.query("SELECT disabled FROM profiles WHERE id = $1", [e.uid]);
    if (profRes.rows.length === 0 || profRes.rows[0].disabled) throw new ApiError("Funding account restricted", 409);
    const accRes = await client.query("SELECT * FROM accounts WHERE user_id = $1 AND id = $2 FOR UPDATE", [e.uid, e.accountId]);
    if (accRes.rows.length === 0) throw new ApiError("Invalid funding account", 409);
    const acc = accRes.rows[0];
    if (acc.type !== "real" || acc.currency !== "USD" || !validMoney(Number(acc.balance_cents) + e.cents)) {
      throw new ApiError("Invalid funding account", 409);
    }
    const gateRes = await client.query("SELECT status FROM access_status WHERE user_id = $1", [e.uid]);
    if (gateRes.rows[0]?.status === "suspended") throw new ApiError("Funding account restricted", 409);
    const cfgRes = await client.query("SELECT config FROM program_configuration WHERE key = 'current'");
    const cfg = cfgRes.rows[0]?.config ?? {};
    const firstDepositCents = Number(cfg.firstDepositCents ?? 1e5);
    const runtime = await readPolicyRuntime(client);
    const { state: walletState } = await loadContractWallet(client, e.accountId, e.uid, acc.balance_cents, true);
    const policy = policyLedger(walletState, runtime);
    const confirmedAt = await policyTimestamp(client);
    const oldOrder = e.depositId ? await client.query("SELECT created_at, credited FROM deposits WHERE id = $1 AND account_id = $2 AND user_id = $3 FOR UPDATE", [e.depositId, e.accountId, e.uid]) : { rows: [] };
    if (oldOrder.rows[0]?.credited) return;
    const orderCreatedAt = oldOrder.rows[0]?.created_at ? new Date(oldOrder.rows[0].created_at).getTime() : confirmedAt;
    const eligibleNewDeposit = !!policy && orderCreatedAt >= policy.activatedAt && confirmedAt >= policy.activatedAt;
    const journalId = "deposit-" + e.eventId;
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
         ($1, NULL, NULL, 'system:payment-clearing', $5)`,
      [journalId, e.uid, e.accountId, e.cents, -e.cents]
    );
    if (eligibleNewDeposit && policy) {
      recordEligibleDeposit(policy, e.cents, confirmedAt);
      walletState.wallet.perpetualCents += e.cents;
    }
    const balanceAfter = await readBalanceCents(client, e.accountId);
    walletState.wallet.futuresCents = balanceAfter - walletState.wallet.perpetualCents;
    if (policy) {
      await savePolicyEvidence(client, "financial_policy_deposits", e.eventId, e.uid, {
        accountId: e.accountId,
        depositId: e.depositId ?? null,
        amountCents: e.cents,
        confirmedAt,
        orderCreatedAt,
        eligibleNewDeposit,
        activatedAt: policy.activatedAt
      });
    }
    await saveContractWallet(client, e.accountId, e.uid, walletState);
    if (oldOrder.rows.length > 0) {
      await client.query("UPDATE deposits SET credited = TRUE, credited_cents = $1, status = 'finished', confirmed_at = NOW(), updated_at = NOW() WHERE id = $2", [e.cents, e.depositId]);
      await savePolicyEvidence(client, "deposit_credit_references", e.depositId, e.uid, { accountId: e.accountId, journalId });
    }
    await notifyDepositCredited(client, {
      userId: e.uid,
      amountCents: e.cents,
      coin: "USDT",
      depositId: e.depositId ?? e.eventId
    });
    const qualifiesForPrograms = e.eligible && e.source !== "manual_review";
    if (qualifiesForPrograms) {
      const qdRes = await client.query("SELECT amount_cents FROM qualified_deposits WHERE user_id = $1", [e.uid]);
      const prevAmount = qdRes.rows[0] ? Number(qdRes.rows[0].amount_cents) : 0;
      if (qdRes.rows.length === 0 || e.cents > prevAmount) {
        const depId = e.depositId ?? e.eventId;
        const depCheck = await client.query("SELECT id FROM deposits WHERE id = $1", [depId]);
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
          ["qd-" + e.eventId, e.uid, depId, e.cents]
        );
        const bwRes = await client.query("SELECT * FROM bonus_wallets WHERE user_id = $1", [e.uid]);
        if (bwRes.rows.length > 0) {
          const bw = bwRes.rows[0];
          const reqDeposit = Number(bw.first_deposit_cents ?? firstDepositCents);
          if (e.cents >= reqDeposit) {
            const freshAccRes = await client.query("SELECT bonus_profit_cents FROM accounts WHERE id = $1", [e.accountId]);
            const profitCents = Number(freshAccRes.rows[0]?.bonus_profit_cents ?? 0);
            const profitLimit = Number(bw.profit_limit_cents ?? 2e4);
            const withdrawableProfit = Math.min(profitLimit, profitCents);
            if (withdrawableProfit > 0) {
              const unlockJournalId = "profit-unlock-" + e.eventId;
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
                   ($1, $2, $3, 'bonus_profit', $5)`,
                [unlockJournalId, e.uid, e.accountId, withdrawableProfit, -withdrawableProfit]
              );
            }
          }
        }
      }
    }
    const rewRes = await client.query("SELECT * FROM referral_rewards WHERE referred_user_id = $1", [e.uid]);
    if (rewRes.rows.length > 0) {
      const reward = rewRes.rows[0];
      const isReferralEligible = qualifiesForPrograms && e.cents >= firstDepositCents && reward.status === "pending";
      if (isReferralEligible) {
        if (reward.referrer_user_id === e.uid) {
          await client.query(
            "UPDATE referral_rewards SET status = 'rejected', updated_at = NOW() WHERE referred_user_id = $1",
            [e.uid]
          );
        } else {
          const [rkRes, rfkRes] = await Promise.all([
            client.query("SELECT customer_key FROM verified_customers WHERE user_id = $1", [reward.referrer_user_id]),
            client.query("SELECT customer_key FROM verified_customers WHERE user_id = $1", [e.uid])
          ]);
          const rk = rkRes.rows[0]?.customer_key;
          const rfk = rfkRes.rows[0]?.customer_key;
          if (rk && rfk && rk === rfk) {
            await client.query(
              "UPDATE referral_rewards SET status = 'rejected', updated_at = NOW() WHERE referred_user_id = $1",
              [e.uid]
            );
          } else {
            const evCheck = await client.query("SELECT id FROM program_evidence WHERE id = $1", [e.uid]);
            if (evCheck.rows.length === 0) {
              const meta = JSON.stringify({
                depositCents: e.cents,
                eventId: e.eventId,
                termsVersion: cfg.termsVersion ?? "v1.0"
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
              await client.query(
                `UPDATE program_members
                 SET qualified_count = qualified_count + 1, pending_cents = pending_cents + $1
                 WHERE user_id = $2`,
                [Number(reward.amount_cents ?? 8e3), reward.referrer_user_id]
              );
              const mRes = await client.query("SELECT ancestors FROM program_members WHERE user_id = $1", [e.uid]);
              if (mRes.rows.length > 0) {
                const ancestors = Array.isArray(mRes.rows[0].ancestors) ? mRes.rows[0].ancestors : JSON.parse(mRes.rows[0].ancestors || "[]");
                for (const ancId of ancestors) {
                  await client.query(
                    "UPDATE program_members SET active_team_count = active_team_count + 1 WHERE user_id = $1",
                    [ancId]
                  );
                }
              }
            }
          }
        }
      }
    }
    const memRes = await client.query("SELECT badges FROM program_members WHERE user_id = $1", [e.uid]);
    if (memRes.rows.length > 0 && e.source !== "manual_review") {
      const badges = Array.isArray(memRes.rows[0].badges) ? memRes.rows[0].badges : JSON.parse(memRes.rows[0].badges || "[]");
      if (!badges.includes("first_deposit")) {
        badges.push("first_deposit");
        await client.query("UPDATE program_members SET badges = $1::jsonb WHERE user_id = $2", [
          JSON.stringify(badges),
          e.uid
        ]);
      }
    }
    await client.query(
      `INSERT INTO trusted_events (event_id, user_id, account_id, type, fingerprint, cents, status)
       VALUES ($1, $2, $3, 'deposit', $4, $5, 'confirmed')
       ON CONFLICT (event_id) DO NOTHING`,
      [e.eventId, e.uid, e.accountId, fingerprint, e.cents]
    );
    const auditPayload = JSON.stringify({ eventId: e.eventId, cents: e.cents, accountId: e.accountId, source: e.source ?? "provider", actorId: e.actorId ?? "provider", receiptReference: e.receiptReference ?? null });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ($1, 'DEPOSIT_CONFIRMED', $2, $3::jsonb, $4)
       ON CONFLICT (action, reference) DO NOTHING`,
      [e.actorId ?? "provider", e.eventId, auditPayload, hash(auditPayload)]
    );
  };
  return transactionClient ? run(transactionClient) : withTx(run);
}
async function recordFinalBonusProfit(e) {
  key(e.eventId);
  key(e.uid);
  key(e.accountId);
  if (!validMoney(e.profitCents) || !Number.isSafeInteger(e.closedAt)) {
    throw new ApiError("Invalid finalized net profit");
  }
  return withTx(async (client) => {
    const fingerprint = hash(JSON.stringify(e));
    const evRes = await client.query("SELECT fingerprint FROM trusted_events WHERE event_id = $1", [e.eventId]);
    if (evRes.rows.length > 0) {
      if (evRes.rows[0].fingerprint !== fingerprint) throw new ApiError("Event conflict", 409);
      return;
    }
    const bwRes = await client.query("SELECT * FROM bonus_wallets WHERE user_id = $1", [e.uid]);
    if (bwRes.rows.length === 0 || bwRes.rows[0].account_id !== e.accountId) throw new ApiError("Trade not eligible", 409);
    const bw = bwRes.rows[0];
    const vcRes = await client.query("SELECT verified, revoked FROM verified_customers WHERE user_id = $1", [e.uid]);
    if (vcRes.rows.length === 0 || !vcRes.rows[0].verified || vcRes.rows[0].revoked) throw new ApiError("Trade not eligible", 409);
    const claimedAt = new Date(bw.claimed_at).getTime();
    const expiresAt = new Date(bw.expires_at).getTime();
    const eligibleAssets = Array.isArray(bw.eligible_assets) ? bw.eligible_assets : JSON.parse(bw.eligible_assets || "[]");
    if (e.closedAt < claimedAt || e.closedAt > expiresAt || !eligibleAssets.includes(e.asset)) {
      throw new ApiError("Trade not eligible", 409);
    }
    const accRes = await client.query("SELECT bonus_profit_cents FROM accounts WHERE id = $1", [e.accountId]);
    const currentProfit = Number(accRes.rows[0]?.bonus_profit_cents ?? 0);
    const newProfit = currentProfit + e.profitCents;
    const profitLimit = Number(bw.profit_limit_cents);
    if (!validMoney(newProfit) || newProfit > profitLimit) {
      throw new ApiError("Configured profit cap exceeded; review required", 409);
    }
    const journalId = "profit-" + e.eventId;
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
         ($1, NULL, NULL, 'system:broker-clearing', $5)`,
      [journalId, e.uid, e.accountId, e.profitCents, -e.profitCents]
    );
    const qdRes = await client.query("SELECT amount_cents FROM qualified_deposits WHERE user_id = $1", [e.uid]);
    const qualifiedCents = qdRes.rows[0] ? Number(qdRes.rows[0].amount_cents) : 0;
    const reqDeposit = Number(bw.first_deposit_cents ?? 5e4);
    if (qualifiedCents >= reqDeposit) {
      const unlockJournalId = "profit-unlock-" + e.eventId;
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
           ($1, $2, $3, 'bonus_profit', $5)`,
        [unlockJournalId, e.uid, e.accountId, e.profitCents, -e.profitCents]
      );
    }
    const mRes = await client.query("SELECT badges FROM program_members WHERE user_id = $1", [e.uid]);
    if (mRes.rows.length > 0) {
      const badges = Array.isArray(mRes.rows[0].badges) ? mRes.rows[0].badges : JSON.parse(mRes.rows[0].badges || "[]");
      if (!badges.includes("trader")) {
        badges.push("trader");
        await client.query("UPDATE program_members SET badges = $1::jsonb WHERE user_id = $2", [
          JSON.stringify(badges),
          e.uid
        ]);
      }
    }
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
export {
  ApiError,
  hash,
  recordConfirmedDeposit,
  recordFinalBonusProfit,
  recordVerifiedCustomer
};
//# sourceMappingURL=program-ingestion.js.map
