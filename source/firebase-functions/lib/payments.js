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

// src/payments.ts
init_db();

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
function isNewDepositAmount(amountCents) {
  return typeof amountCents === "number" && Number.isSafeInteger(amountCents) && amountCents >= DEPOSIT_MIN_CENTS && amountCents <= DEPOSIT_MAX_CENTS;
}

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

// src/nowpayments.ts
import { createHmac, timingSafeEqual } from "node:crypto";
var ApiError2 = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key2, item]) => [key2, canonical(item)]));
  return value;
}
function validIpn(body, signature, secret) {
  if (!secret || !body || typeof body !== "object" || Array.isArray(body) || !/^[a-fA-F0-9]{128}$/.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(JSON.stringify(canonical(body))).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
function providerId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new ApiError2("Invalid payment identifier", 502);
  const result = String(value ?? "");
  if (!/^[0-9]{1,30}$/.test(result)) throw new ApiError2("Invalid payment identifier", 502);
  return result;
}
function units(value, decimals = 18) {
  const text = String(value ?? "");
  if (!/^\d{1,20}(\.\d{1,18})?$/.test(text)) throw new ApiError2("Invalid provider amount", 502);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) throw new ApiError2("Invalid amount precision", 502);
  return BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0"));
}

// ../lib/payments.ts
var PAYMENT_COINS = [
  { id: "usdttrc20", label: "USDT", network: "TRON \xB7 TRC20" },
  { id: "usdtbsc", label: "USDT", network: "BNB Smart Chain \xB7 BEP20" },
  { id: "btc", label: "BTC", network: "Bitcoin" },
  { id: "eth", label: "ETH", network: "Ethereum \xB7 ERC20" }
];

// src/payments.ts
import { createHash as createHash2 } from "node:crypto";
var ApiError3 = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var hash2 = (text) => createHash2("sha256").update(text).digest("hex");
var safeId = (value) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new ApiError3("\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.");
  return value;
};
var depositView = (d) => ({
  id: d.id,
  accountId: d.account_id ?? d.accountId,
  amountCents: Number(d.amount_cents ?? d.amountCents),
  coin: d.coin,
  status: d.status,
  paymentId: d.payment_id ?? d.paymentId ?? null,
  address: d.pay_address ?? d.address ?? null,
  payAmount: d.pay_amount ? String(d.pay_amount) : d.payAmount ? String(d.payAmount) : null,
  extraId: d.extra_id ?? d.extraId ?? null,
  credited: !!d.credited,
  creditedCents: Number.isSafeInteger(Number(d.credited_cents)) && d.credited_cents != null ? Number(d.credited_cents) : void 0,
  creditJournalId: typeof d.credit_journal_id === "string" ? d.credit_journal_id : void 0,
  createdAt: d.created_at ? new Date(d.created_at).getTime() : d.createdAt
});
var states = /* @__PURE__ */ new Set(["waiting", "confirming", "confirmed", "sending", "finished", "partially_paid", "failed", "refunded", "expired"]);
function paymentService(provider, ipnSecret) {
  async function create(u, input) {
    const accountId = safeId(input.accountId);
    const requestId = safeId(input.requestId);
    const amountCents = input.amountCents;
    const coin = input.coin;
    if (Object.keys(input).some((k) => !["accountId", "requestId", "amountCents", "coin"].includes(k)) || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !PAYMENT_COINS.some((c) => c.id === coin)) {
      throw new ApiError3("\u062A\u062D\u0642\u0642 \u0645\u0646 \u0645\u0628\u0644\u063A \u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0648\u0627\u0644\u0639\u0645\u0644\u0629. / Check the deposit amount and currency.");
    }
    const id = "np-" + hash2(u.id + ":" + requestId);
    const fingerprint = hash2(JSON.stringify({ accountId, amountCents, coin }));
    const existing = await withTx(async (client) => {
      const profRes = await client.query("SELECT disabled FROM profiles WHERE id = $1", [u.id]);
      if (profRes.rows.length === 0 || profRes.rows[0].disabled) throw new ApiError3("\u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0648\u0642\u0648\u0641.", 403);
      const gateRes = await client.query("SELECT status FROM access_status WHERE user_id = $1", [u.id]);
      if (gateRes.rows[0]?.status === "suspended" || gateRes.rows[0]?.status === "restricted") {
        throw new ApiError3("\u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0648\u0642\u0648\u0641.", 403);
      }
      const accRes = await client.query("SELECT * FROM accounts WHERE user_id = $1 AND id = $2", [u.id, accountId]);
      const a = accRes.rows[0];
      if (!a || a.type !== "real" || a.currency !== "USD") throw new ApiError3("\u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0645\u062A\u0627\u062D \u0644\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0641\u0642\u0637.", 403);
      if (a.status === "restricted") throw new ApiError3("\u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0627\u0644\u064A \u0645\u0642\u064A\u0651\u062F.", 403);
      const oldRes = await client.query("SELECT * FROM deposits WHERE id = $1", [id]);
      if (oldRes.rows.length > 0) {
        const old = oldRes.rows[0];
        if (Number(old.amount_cents) !== amountCents || old.coin !== coin || old.account_id !== accountId) {
          throw new ApiError3("\u062A\u063A\u064A\u0651\u0631\u062A \u062A\u0641\u0627\u0635\u064A\u0644 \u0637\u0644\u0628 \u0627\u0644\u062F\u0641\u0639. \u0627\u0641\u062A\u062D \u0637\u0644\u0628\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627.", 409);
        }
        return old;
      }
      if (!isNewDepositAmount(amountCents)) {
        throw new ApiError3("\u0645\u0628\u0644\u063A \u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0627\u0644\u062C\u062F\u064A\u062F \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0628\u064A\u0646 100 \u064815,000 \u062F\u0648\u0644\u0627\u0631 \u0623\u0645\u0631\u064A\u0643\u064A. / New deposits must be between $100 and $15,000 USD.");
      }
      const rateRes = await client.query("SELECT window_start, count FROM deposit_rate_limits WHERE user_id = $1", [u.id]);
      const now = /* @__PURE__ */ new Date();
      if (rateRes.rows.length > 0) {
        const r = rateRes.rows[0];
        const winStart = new Date(r.window_start).getTime();
        if (now.getTime() - winStart < 18e5) {
          if (r.count >= 5) {
            throw new ApiError3("\u062A\u0648\u062C\u062F \u0637\u0644\u0628\u0627\u062A \u062F\u0641\u0639 \u062D\u062F\u064A\u062B\u0629. \u0631\u0627\u062C\u0639 \u0633\u062C\u0644 \u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0642\u0628\u0644 \u0625\u0646\u0634\u0627\u0621 \u0637\u0644\u0628 \u0622\u062E\u0631.", 429);
          }
          await client.query("UPDATE deposit_rate_limits SET count = count + 1, updated_at = NOW() WHERE user_id = $1", [u.id]);
        } else {
          await client.query("UPDATE deposit_rate_limits SET window_start = NOW(), count = 1, updated_at = NOW() WHERE user_id = $1", [u.id]);
        }
      } else {
        await client.query("INSERT INTO deposit_rate_limits (user_id, window_start, count) VALUES ($1, NOW(), 1)", [u.id]);
      }
      const insRes = await client.query(
        `INSERT INTO deposits (id, user_id, account_id, amount_cents, coin, status, credited, credited_cents)
         VALUES ($1, $2, $3, $4, $5, 'waiting', false, 0)
         RETURNING *`,
        [id, u.id, accountId, amountCents, coin]
      );
      await client.query(
        `INSERT INTO commands (fingerprint, action, result)
         VALUES ($1, 'deposit_create', $2::jsonb)
         ON CONFLICT (fingerprint) DO NOTHING`,
        [fingerprint, JSON.stringify({ id, accountId, amountCents, coin })]
      );
      const payload = JSON.stringify({ accountId, amountCents, coin });
      await client.query(
        `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
         VALUES ($1, 'DEPOSIT_REQUESTED', $2, $3::jsonb, $4)
         ON CONFLICT (action, reference) DO NOTHING`,
        [u.id, id, payload, hash2(payload)]
      );
      return null;
    });
    if (existing) return depositView(existing);
    try {
      const payment = await provider.create(id, amountCents, coin);
      await reconcile(id, payment, false);
    } catch (error) {
      await withTx(async (client) => {
        await client.query(
          "UPDATE deposits SET status = 'review', updated_at = NOW() WHERE id = $1 AND status = 'waiting'",
          [id]
        );
      });
      console.error("ORIN payment create failed", { orderId: id, code: error instanceof ApiError3 ? error.status : "network" });
    }
    const finalRow = await withTx(async (client) => {
      const r = await client.query("SELECT * FROM deposits WHERE id = $1", [id]);
      return r.rows[0];
    });
    return depositView(finalRow);
  }
  async function reconcile(id, payment, allowCredit = true) {
    const safeOrderId = safeId(id);
    const pid = providerId(payment.payment_id);
    const d = await withTx(async (client) => {
      const rRes = await client.query("SELECT * FROM deposits WHERE id = $1", [safeOrderId]);
      if (rRes.rows.length === 0) throw new ApiError3("Unknown payment order", 404);
      const row = rRes.rows[0];
      if (payment.order_id !== safeOrderId || payment.price_currency !== "usd" || payment.pay_currency !== row.coin || units(payment.price_amount, 2) !== BigInt(row.amount_cents) || row.payment_id && pid !== row.payment_id || payment.parent_payment_id) {
        throw new ApiError3("Payment does not match the stored order", 409);
      }
      const status2 = states.has(payment.payment_status) ? payment.payment_status : "review";
      if (typeof payment.pay_address !== "string" || !/^[a-zA-Z0-9:_-]{12,256}$/.test(payment.pay_address) || units(payment.pay_amount) <= BigInt(0)) {
        throw new ApiError3("Invalid payment destination", 502);
      }
      const pIdRes = await client.query("SELECT deposit_id FROM payment_ids WHERE payment_id = $1", [pid]);
      if (pIdRes.rows.length > 0 && pIdRes.rows[0].deposit_id !== safeOrderId) {
        throw new ApiError3("Payment identity conflict", 409);
      }
      await client.query(
        `INSERT INTO payment_ids (payment_id, deposit_id)
         VALUES ($1, $2)
         ON CONFLICT (payment_id) DO NOTHING`,
        [pid, safeOrderId]
      );
      const reversal = row.credited && ["refunded", "failed", "partially_paid"].includes(status2);
      if (reversal) {
        await client.query(
          `INSERT INTO payment_reviews (id, deposit_id, user_id, reason, status)
           VALUES ($1, $2, $3, 'provider_reversal_after_credit', 'pending')
           ON CONFLICT (id) DO NOTHING`,
          [pid, safeOrderId, row.user_id]
        );
      }
      await client.query(
        `UPDATE deposits
         SET payment_id = $1, pay_address = $2, pay_amount = $3, extra_id = $4, status = $5, updated_at = NOW()
         WHERE id = $6`,
        [pid, payment.pay_address, String(payment.pay_amount ?? ""), payment.payin_extra_id ?? payment.extra_id ?? null, reversal ? "review" : row.credited ? "finished" : status2, safeOrderId]
      );
      return row;
    });
    const status = states.has(payment.payment_status) ? payment.payment_status : "review";
    if (allowCredit && status === "finished") {
      const expected = units(payment.pay_amount);
      let paid = null;
      try {
        const raw = payment.actually_paid != null ? payment.actually_paid : payment.amount_received;
        if (raw != null) paid = units(raw);
      } catch {
      }
      const profRes = await withTx(async (client) => {
        const pr = await client.query("SELECT disabled FROM profiles WHERE id = $1", [d.user_id]);
        const gr = await client.query("SELECT status FROM access_status WHERE user_id = $1", [d.user_id]);
        return { disabled: pr.rows[0]?.disabled, suspended: gr.rows[0]?.status === "suspended" };
      });
      if (paid === null || paid * 1000n < expected * 995n || profRes.disabled || profRes.suspended) {
        await withTx(async (client) => {
          const fresh = await client.query("SELECT credited FROM deposits WHERE id = $1", [safeOrderId]);
          if (!fresh.rows[0]?.credited) {
            await client.query(
              "UPDATE deposits SET status = 'review', review_reason = $1, updated_at = NOW() WHERE id = $2",
              [paid === null || paid * 1000n < expected * 995n ? "amount_mismatch" : "account_restricted", safeOrderId]
            );
            await client.query(
              `INSERT INTO payment_reviews (id, deposit_id, user_id, reason, status)
               VALUES ($1, $2, $3, 'amount_mismatch', 'pending')
               ON CONFLICT (id) DO NOTHING`,
              [pid, safeOrderId, d.user_id]
            );
          }
        });
        return;
      }
      const creditedCents = Math.min(Number(d.amount_cents), Math.floor(Number(BigInt(d.amount_cents) * paid / expected)));
      await recordConfirmedDeposit({
        eventId: "nowpayments-" + pid,
        uid: d.user_id,
        accountId: d.account_id,
        currency: "USD",
        cents: creditedCents,
        eligible: true,
        depositId: safeOrderId
      });
    }
  }
  async function get(u, id, refresh = false) {
    const safeOrderId = safeId(id);
    const row = await withTx(async (client) => {
      const res = await client.query("SELECT * FROM deposits WHERE id = $1", [safeOrderId]);
      if (res.rows.length === 0 || res.rows[0].user_id !== u.id) throw new ApiError3("\u0637\u0644\u0628 \u0627\u0644\u062F\u0641\u0639 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D.", 404);
      return res.rows[0];
    });
    if (refresh && row.payment_id && !row.credited) {
      const payment = await provider.get(row.payment_id);
      await reconcile(safeOrderId, payment);
      const refreshed = await withTx(async (client) => {
        const res = await client.query("SELECT * FROM deposits WHERE id = $1", [safeOrderId]);
        return res.rows[0];
      });
      return depositView(refreshed);
    }
    return depositView(row);
  }
  async function list(u, accountId) {
    if (!accountId) return [];
    try {
      safeId(accountId);
    } catch {
      return [];
    }
    return withTx(async (client) => {
      const accRes = await client.query("SELECT id FROM accounts WHERE user_id = $1 AND id = $2", [u.id, accountId]);
      if (accRes.rows.length === 0) return [];
      const depRes = await client.query(
        `SELECT d.*, ref.data->>'journalId' AS credit_journal_id
         FROM deposits d LEFT JOIN docs ref ON ref.collection = 'deposit_credit_references' AND ref.id = d.id AND ref.owner_id = d.user_id
         WHERE d.user_id = $1 AND d.account_id = $2 ORDER BY d.created_at DESC LIMIT 20`,
        [u.id, accountId]
      );
      return depRes.rows.map(depositView);
    });
  }
  async function webhook(body, signature) {
    if (!validIpn(body, signature, ipnSecret)) {
      throw new ApiError3("Invalid payment notification signature", 401);
    }
    const id = safeId(body.order_id);
    if (!id.startsWith("np-")) throw new ApiError3("Unknown payment order", 404);
    let current = body;
    try {
      const fetched = await provider.get(providerId(body.payment_id));
      if (fetched && fetched.payment_id) {
        if (providerId(fetched.payment_id) !== providerId(body.payment_id)) {
          throw new ApiError3("Payment identity mismatch", 409);
        }
        current = fetched;
      }
    } catch (e) {
      if (e instanceof ApiError3) throw e;
      current = body;
    }
    await reconcile(id, current);
    return { ok: true };
  }
  return { create, get, list, webhook };
}
export {
  ApiError3 as ApiError,
  hash2 as hash,
  paymentService
};
//# sourceMappingURL=payments.js.map
