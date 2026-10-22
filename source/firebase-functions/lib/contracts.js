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

// src/contracts.ts
init_db();
import { createHash, randomUUID as randomUUID2 } from "node:crypto";

// src/client-services.ts
init_db();

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
  const ownerId = opts.userId === "*" || opts.userId === "admin" ? null : opts.userId;
  await client.query(
    `INSERT INTO docs (collection, id, owner_id, data, updated_at)
     VALUES ('orinNotices', $1, $2, $3::jsonb, NOW())
     ON CONFLICT (collection, id) DO UPDATE SET data = $3::jsonb, updated_at = NOW()`,
    [noticeId, ownerId, JSON.stringify(noticeData)]
  );
  return noticeData;
}
async function notifyTradeOpened(client, p) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  const dirAr = p.direction === "BUY" ? "\u0634\u0631\u0627\u0621" : "\u0628\u064A\u0639";
  await createNotice(client, {
    userId: p.userId,
    title: `\u0641\u062A\u062D \u0635\u0641\u0642\u0629 \u062A\u062F\u0627\u0648\u0644 \u062C\u062F\u064A\u062F\u0629 (${p.asset}) \u{1F4C8}`,
    message: `\u062A\u0645 \u062A\u062E\u0635\u064A\u0635 ${amountUsd} USDT \u0645\u0646 \u0631\u0635\u064A\u062F \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u062F\u0627\u0626\u0645\u0629 (\u0627\u0644\u062A\u062F\u0627\u0648\u0644) \u0644\u0635\u0641\u0642\u0629 ${dirAr} \u0639\u0644\u0649 \u0623\u0635\u0644 ${p.asset}.
\u0645\u062F\u0629 \u0627\u0644\u0639\u0642\u062F: ${p.durationSec} \u062B\u0627\u0646\u064A\u0629.`,
    category: "opportunity",
    deepLink: "/activity",
    metadata: {
      type: "trade_opened",
      positionId: p.positionId,
      asset: p.asset,
      direction: p.direction,
      amountCents: p.amountCents,
      durationSec: p.durationSec
    }
  });
}
async function notifyTradeSettled(client, p) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  const resultUsd = (Math.abs(p.resultCents) / 100).toFixed(2);
  const isGain = p.resultCents >= 0;
  const returnedUsd = ((p.amountCents + p.resultCents) / 100).toFixed(2);
  await createNotice(client, {
    userId: p.userId,
    title: isGain ? `\u0631\u0628\u062D \u0645\u0624\u0643\u062F \u0645\u0646 \u0635\u0641\u0642\u0629 ${p.asset} \u{1F389}` : `\u062A\u0633\u0648\u064A\u0629 \u0635\u0641\u0642\u0629 ${p.asset}`,
    message: isGain ? `\u062A\u0645\u062A \u062A\u0633\u0648\u064A\u0629 \u0627\u0644\u0635\u0641\u0642\u0629 \u0628\u0646\u062C\u0627\u062D \u0648\u062A\u062D\u0642\u064A\u0642 \u0623\u0631\u0628\u0627\u062D \u0628\u0642\u064A\u0645\u0629 +${resultUsd} USDT!
\u062A\u0645 \u0625\u0631\u062C\u0627\u0639 \u0631\u0623\u0633 \u0627\u0644\u0645\u0627\u0644 \u0648\u0627\u0644\u0623\u0631\u0628\u0627\u062D \u0628\u0625\u062C\u0645\u0627\u0644\u064A ${returnedUsd} USDT \u0645\u0628\u0627\u0634\u0631\u0629 \u0625\u0644\u0649 \u0631\u0635\u064A\u062F \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u062F\u0627\u0626\u0645\u0629 (\u0627\u0644\u062A\u062F\u0627\u0648\u0644).` : `\u062A\u0645\u062A \u062A\u0633\u0648\u064A\u0629 \u0627\u0644\u0635\u0641\u0642\u0629 \u0628\u0646\u062A\u064A\u062C\u0629 (${p.resultCents < 0 ? "-" : ""}${resultUsd} USDT). \u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0631\u0635\u064A\u062F \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u062F\u0627\u0626\u0645\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B.`,
    category: "financial",
    deepLink: "/activity",
    metadata: {
      type: "trade_settled",
      positionId: p.positionId,
      asset: p.asset,
      resultCents: p.resultCents,
      isGain
    }
  });
}

// src/wallet-ledger.ts
async function loadContractWallet(client, accountId, ownerId, balanceCents, lock = true) {
  const res = await client.query(
    `SELECT data FROM docs WHERE collection = 'contract_wallets' AND id = $1${lock ? " FOR UPDATE" : ""}`,
    [accountId]
  );
  const raw = res.rows[0]?.data;
  const existed = !!raw?.wallet;
  const state2 = existed ? { ...raw, operations: Array.isArray(raw.operations) ? raw.operations : [] } : {
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
  normalizeWallet(state2, balanceCents);
  return { state: state2, existed };
}
function normalizeWallet(state2, balanceCents) {
  const total = Math.max(0, Number(balanceCents) || 0);
  const perp = Math.min(total, Math.max(0, Math.trunc(Number(state2.wallet.perpetualCents) || 0)));
  state2.wallet.perpetualCents = perp;
  state2.wallet.futuresCents = total - perp;
  return state2;
}
async function saveContractWallet(client, accountId, ownerId, state2) {
  state2.wallet.version = (Number(state2.wallet.version) || 1) + 1;
  state2.wallet.updatedAt = Date.now();
  if (state2.operations.length > 50) state2.operations.length = 50;
  await client.query(
    `INSERT INTO docs (collection, id, owner_id, data, updated_at)
     VALUES ('contract_wallets', $1, $2, $3, NOW())
     ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [accountId, ownerId, JSON.stringify(state2)]
  );
}
async function readBalanceCents(client, accountId) {
  const r = await client.query("SELECT balance_cents FROM accounts WHERE id = $1", [accountId]);
  return Number(r.rows[0]?.balance_cents || 0);
}

// src/client-services.ts
async function getTradingAccounts(user, dbClient) {
  const run = async (client) => {
    const accRes = await client.query(
      `SELECT id, account_number, type, currency, balance_cents, reserved_cents, realized_cents, bonus_profit_cents, created_at
       FROM accounts
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [user.id]
    );
    const profRes = await client.query(
      `SELECT preferences FROM profiles WHERE id = $1`,
      [user.id]
    );
    const prefs = profRes.rows[0]?.preferences || {};
    const savedActiveId = prefs.activeAccountId;
    const accounts = await Promise.all(accRes.rows.map(async (row) => {
      let settledPnl = 0;
      let dailyProfitCents = 0;
      try {
        const sRes = await client.query(
          `SELECT
             COALESCE(SUM(result_cents), 0) AS total_settled,
             COALESCE(SUM(CASE WHEN COALESCE(settled_at, ends_at) >= NOW() - INTERVAL '24 hours' THEN result_cents ELSE 0 END), 0) AS daily_settled
           FROM positions WHERE user_id = $1 AND (account_id = $2 OR account_id IS NULL) AND status = 'settled'`,
          [user.id, row.id]
        );
        settledPnl = Number(sRes.rows[0]?.total_settled || 0);
        dailyProfitCents = Number(sRes.rows[0]?.daily_settled || 0);
      } catch {
        settledPnl = 0;
        dailyProfitCents = 0;
      }
      const bonusProfit = Number(row.bonus_profit_cents || 0);
      const accRealized = Number(row.realized_cents || 0);
      const realizedCents = settledPnl !== 0 ? settledPnl + bonusProfit : accRealized !== 0 ? accRealized : bonusProfit;
      return {
        id: row.id,
        accountNumber: row.account_number,
        type: row.type,
        currency: row.currency,
        balanceCents: Number(row.balance_cents),
        reservedCents: Number(row.reserved_cents),
        realizedCents,
        dailyProfitCents,
        createdAt: new Date(row.created_at).getTime()
      };
    }));
    const activeId = accounts.find((a) => a.id === savedActiveId)?.id || (accounts[0]?.id ?? "");
    return { accounts, activeId };
  };
  if (dbClient) return await run(dbClient);
  return await withTx(run);
}

// src/contracts.ts
function hash(data) {
  return createHash("sha256").update(data).digest("hex");
}
function resultCents(amountCents, bps) {
  return Math.round(amountCents * bps / 1e4);
}
var ApiError = class extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
};
async function publish(u, input, now = Date.now()) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const asset = input.asset;
  const direction = input.direction;
  const duration = Number(input.durationSec);
  const bps = Number(input.settlementBps);
  const opensAt = Number(input.opensAt);
  const closesAt = Number(input.closesAt);
  const eligibility = input.eligibility ?? "all";
  if (!title || title.length > 80 || !["BUY", "SELL"].includes(direction)) {
    throw new ApiError("\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u0642\u062F \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.");
  }
  if (!Number.isInteger(duration) || duration < 60 || duration > 300 || !Number.isInteger(bps) || Math.abs(bps) > 1e3) {
    throw new ApiError("\u0627\u0644\u0645\u062F\u0629 60\u2013300 \u062B\u0627\u0646\u064A\u0629 \u0648\u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0645\u0646 -10% \u0625\u0644\u0649 +10%.");
  }
  if (!["all", "standard", "advanced", "vip"].includes(eligibility) || opensAt >= closesAt) {
    throw new ApiError("\u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0623\u0648 \u0627\u0644\u0623\u0647\u0644\u064A\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.");
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
    adminId: u.id
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
async function join(u, input, now = Date.now()) {
  const rawCode = String(input.code ?? input.contractId ?? "").trim();
  const amount = Number(input.amountCents);
  if (!rawCode || !Number.isSafeInteger(amount) || amount <= 0 || input.confirmed !== true) {
    throw new ApiError("\u0631\u0627\u062C\u0639 \u0627\u0644\u0645\u0628\u0644\u063A \u0648\u0623\u0643\u0651\u062F \u0634\u0631\u0648\u0637 \u0627\u0644\u062D\u0633\u0627\u0628.");
  }
  return withTx(async (client) => {
    const cRes = await client.query(
      `SELECT c.*, COALESCE(r.revoked, false) AS is_revoked
       FROM contracts c
       LEFT JOIN contract_revocation_state r ON c.id = r.contract_id
       WHERE c.code = $1 OR c.id = $1`,
      [rawCode]
    );
    if (cRes.rows.length === 0) throw new ApiError("\u0627\u0644\u062F\u0639\u0648\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0644\u062D\u0633\u0627\u0628\u0643.", 404);
    const c = cRes.rows[0];
    if (c.is_revoked || c.status !== "active") throw new ApiError("\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F.", 409);
    const opensAtMs = new Date(c.opens_at).getTime();
    const closesAtMs = new Date(c.closes_at).getTime();
    if (now < opensAtMs || now >= closesAtMs) throw new ApiError("\u0627\u0644\u0639\u0642\u062F \u062E\u0627\u0631\u062C \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629.", 409);
    if (input.contractHash && input.contractHash !== c.hash) {
      throw new ApiError("\u0631\u0627\u062C\u0639 \u0634\u0631\u0648\u0637 \u0627\u0644\u0639\u0642\u062F \u0627\u0644\u062D\u0627\u0644\u064A\u0629.", 409);
    }
    const profRes = await client.query("SELECT tier, role FROM profiles WHERE id = $1", [u.id]);
    const userTier = profRes.rows[0]?.tier ?? "standard";
    const userRole = profRes.rows[0]?.role ?? "user";
    let isWakil = userRole === "agency" || userRole === "admin" || userTier === "advanced" || userTier === "vip";
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
    if (c.eligibility !== "all") {
      const isEligible = c.eligibility === userTier || ["advanced", "vip"].includes(c.eligibility) && isWakil;
      if (!isEligible) {
        throw new ApiError("\u062D\u0633\u0627\u0628\u0643 \u063A\u064A\u0631 \u0645\u0624\u0647\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u0639\u0642\u062F (\u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u0642\u0629 \u0645\u062E\u0635\u0635\u0629 \u0644\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0645\u0639\u062A\u0645\u062F\u064A\u0646 \u0641\u0642\u0637).", 403);
      }
    }
    let accRes = await client.query(
      input.accountId ? `SELECT * FROM accounts WHERE user_id = $1 AND id = $2 FOR UPDATE` : `SELECT * FROM accounts WHERE user_id = $1 AND type = 'real' FOR UPDATE`,
      input.accountId ? [u.id, input.accountId] : [u.id]
    );
    if (accRes.rows.length === 0 && !input.accountId) {
      accRes = await client.query(
        `SELECT * FROM accounts WHERE user_id = $1 ORDER BY (type = 'real') DESC LIMIT 1 FOR UPDATE`,
        [u.id]
      );
    }
    if (accRes.rows.length === 0) throw new ApiError("\u062D\u0633\u0627\u0628 \u062A\u062F\u0627\u0648\u0644 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.", 404);
    const acc = accRes.rows[0];
    const existingPos = await client.query(
      `SELECT id, status FROM positions WHERE user_id = $1 AND contract_id = $2`,
      [u.id, c.id]
    );
    if (existingPos.rows.length > 0) {
      throw new ApiError("\u062A\u0645 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0648\u062F \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u0642\u0629 \u0645\u0633\u0628\u0642\u064B\u0627. \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0643\u0648\u062F \u0623\u0643\u062B\u0631 \u0645\u0646 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u0644\u0643\u0644 \u0645\u0633\u062A\u062E\u062F\u0645.", 409);
    }
    const posId = hash(`position:${u.id}:${c.id}`);
    const useBonus = input.useBonus === true;
    if (useBonus) {
      const bRes = await client.query("SELECT * FROM bonus_wallets WHERE user_id = $1", [u.id]);
      if (bRes.rows.length === 0 || !bRes.rows[0].claimed) {
        throw new ApiError("\u0645\u062D\u0641\u0638\u0629 \u0627\u0644\u0628\u0648\u0646\u0635 \u063A\u064A\u0631 \u0645\u0641\u0639\u0644\u0629.", 409);
      }
      const bWallet = bRes.rows[0];
      if (bWallet.expires_at && now >= new Date(bWallet.expires_at).getTime()) {
        throw new ApiError("\u0627\u0646\u062A\u0647\u062A \u0635\u0644\u0627\u062D\u064A\u0629 \u0645\u062D\u0641\u0638\u0629 \u0627\u0644\u0628\u0648\u0646\u0635.", 409);
      }
      const eligibleAssets = Array.isArray(bWallet.eligible_assets) ? bWallet.eligible_assets : typeof bWallet.eligible_assets === "string" ? JSON.parse(bWallet.eligible_assets) : [];
      if (Array.isArray(eligibleAssets) && eligibleAssets.length > 0 && !eligibleAssets.includes(c.asset)) {
        throw new ApiError("\u0627\u0644\u0623\u0635\u0644 \u063A\u064A\u0631 \u0645\u0624\u0647\u0644 \u0644\u0644\u062A\u062F\u0627\u0648\u0644 \u0628\u0627\u0644\u0628\u0648\u0646\u0635.", 409);
      }
      if (BigInt(acc.bonus_cents) < BigInt(amount)) {
        throw new ApiError("\u0631\u0635\u064A\u062F \u0627\u0644\u0628\u0648\u0646\u0635 \u063A\u064A\u0631 \u0643\u0627\u0641\u064D \u0644\u0647\u0630\u0627 \u0627\u0644\u0639\u0642\u062F.", 409);
      }
    } else {
      if (BigInt(acc.balance_cents) < BigInt(amount)) {
        throw new ApiError("\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D \u063A\u064A\u0631 \u0643\u0627\u0641\u064D \u0644\u0647\u0630\u0627 \u0627\u0644\u0639\u0642\u062F.", 409);
      }
      if (acc.type === "real") {
        const { state: wState } = await loadContractWallet(client, acc.id, u.id, acc.balance_cents, true);
        const curPerp = wState.wallet.perpetualCents;
        let finalPerp = curPerp;
        let finalFutures = wState.wallet.futuresCents;
        if (curPerp < amount) {
          const deficit = amount - curPerp;
          if (finalFutures >= deficit) {
            finalPerp += deficit;
            finalFutures -= deficit;
            wState.operations.unshift({
              id: "fund-" + randomUUID2(),
              kind: "transfer",
              amountCents: deficit,
              feeCents: 0,
              feeRate: 0,
              netAmountCents: deficit,
              from: "futures",
              to: "perpetual",
              afterFuturesCents: finalFutures,
              afterPerpetualCents: finalPerp,
              createdAt: now
            });
          } else {
            const totalAvail = ((curPerp + finalFutures) / 100).toFixed(2);
            throw new ApiError(
              `\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D \u0641\u064A \u0627\u0644\u062D\u0633\u0627\u0628 (${totalAvail} USD) \u063A\u064A\u0631 \u0643\u0627\u0641\u064D \u0644\u0642\u064A\u0645\u0629 \u0647\u0630\u0627 \u0627\u0644\u0639\u0642\u062F (${(amount / 100).toFixed(2)} USD). \u064A\u0631\u062C\u0649 \u0634\u062D\u0646 \u0627\u0644\u0631\u0635\u064A\u062F \u0623\u0648\u0644\u0627\u064B.`,
              409
            );
          }
        }
        wState.wallet.perpetualCents = finalPerp - amount;
        wState.wallet.futuresCents = finalFutures;
        await saveContractWallet(client, acc.id, u.id, wState);
      }
    }
    const durationSec = c.duration_sec;
    const endsAtMs = now + durationSec * 1e3;
    const pnl = resultCents(amount, c.settlement_bps);
    await client.query(
      `INSERT INTO positions (id, user_id, contract_id, account_id, amount_cents, result_cents, is_bonus, status, started_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0))`,
      [posId, u.id, c.id, acc.id, amount, pnl, useBonus, now, endsAtMs]
    );
    const jid = `allocate:${posId}`;
    const kind = useBonus ? "bonus_allocation" : "allocation";
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
    const auditPayload = JSON.stringify({
      contractId: c.id,
      contractHash: c.hash,
      amountCents: amount,
      startedAt: now,
      endsAt: endsAtMs,
      accountId: acc.id,
      isBonus: useBonus
    });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ($1, 'AMOUNT_ALLOCATED', $2, $3::jsonb, $4)
       ON CONFLICT (action, reference) DO NOTHING`,
      [u.id, posId, auditPayload, hash(auditPayload)]
    );
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
async function settle(u, now = Date.now()) {
  return withTx(async (client) => {
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
      if (p.status !== "active") continue;
      const expected = resultCents(Number(p.amount_cents), p.settlement_bps);
      const jid = `settle:${p.id}`;
      const amountCents = Number(p.amount_cents);
      await client.query(
        `UPDATE positions SET status = 'settled', settled_at = to_timestamp($1 / 1000.0) WHERE id = $2`,
        [now, p.id]
      );
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
        processedAt: now
      };
      const payloadStr = JSON.stringify(receipt);
      const receiptHash = hash(payloadStr);
      await client.query(
        `INSERT INTO receipts (id, position_id, user_id, payload, hash)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (position_id) DO NOTHING`,
        [`receipt:${p.id}`, p.id, u.id, payloadStr, receiptHash]
      );
      if (p.is_bonus) {
        await client.query(
          `INSERT INTO journals (id, kind, reference) VALUES ($1, 'bonus_settlement', $2)`,
          [jid, p.id]
        );
        if (expected >= 0) {
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
      if (!p.is_bonus) {
        const accTypeRes = await client.query("SELECT type FROM accounts WHERE id = $1", [p.account_id]);
        if (accTypeRes.rows[0]?.type === "real") {
          const balanceAfter = await readBalanceCents(client, p.account_id);
          const { state: wState } = await loadContractWallet(client, p.account_id, u.id, balanceAfter - (amountCents + expected), true);
          wState.wallet.perpetualCents = wState.wallet.perpetualCents + Math.max(0, amountCents + expected);
          wState.wallet.futuresCents = Math.max(0, balanceAfter - wState.wallet.perpetualCents);
          await saveContractWallet(client, p.account_id, u.id, wState);
        }
      }
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
async function state(u, now = Date.now()) {
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
    const user = profRes.rows[0] ?? { id: u.id, display_name: "", tier: "standard" };
    const isAdmin = u.role === "admin" || user.role === "admin";
    const seenAt = user.preferences?.seen_at ? Number(user.preferences.seen_at) : user.updated_at ? new Date(user.updated_at).getTime() : 0;
    const acceptedAt = user.accepted_at ? new Date(user.accepted_at).getTime() : null;
    const acc = accRes.rows[0] ?? {
      balance_cents: "0",
      reserved_cents: "0",
      realized_cents: "0",
      bonus_cents: "0",
      bonus_reserved_cents: "0",
      bonus_profit_cents: "0"
    };
    let accountDirectory = null;
    try {
      accountDirectory = await getTradingAccounts(u, client);
    } catch {
      accountDirectory = { accounts: [], activeId: "" };
    }
    let perpetualCents = 0;
    let futuresCents = Number(acc.balance_cents || 0);
    if (acc.id) {
      try {
        const { state: w } = await loadContractWallet(client, acc.id, u.id, acc.balance_cents, false);
        perpetualCents = w.wallet.perpetualCents;
        futuresCents = w.wallet.futuresCents;
      } catch {
      }
    }
    const contracts = cntRes.rows.map((c) => ({
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
      canonical: c.canonical || "",
      opens_at: c.opens_at ? new Date(c.opens_at).getTime() : 0,
      opensAt: c.opens_at ? new Date(c.opens_at).getTime() : 0,
      closes_at: c.closes_at ? new Date(c.closes_at).getTime() : 0,
      closesAt: c.closes_at ? new Date(c.closes_at).getTime() : 0,
      published_at: c.published_at ? new Date(c.published_at).getTime() : c.created_at ? new Date(c.created_at).getTime() : 0,
      publishedAt: c.published_at ? new Date(c.published_at).getTime() : c.created_at ? new Date(c.created_at).getTime() : 0,
      admin_id: c.admin_id || "",
      hash: c.hash || "",
      participants: 0
    }));
    const contractMap = new Map(contracts.map((c) => [c.id, c]));
    const positions = posRes.rows.map((p) => {
      let contract = contractMap.get(p.contract_id);
      if (!contract) {
        contract = {
          id: p.contract_id,
          code: "",
          title: "",
          asset: "XAUUSD",
          direction: "BUY",
          duration_sec: 60,
          durationSec: 60,
          settlement_bps: 0,
          settlementBps: 0,
          eligibility: "all",
          canonical: "",
          opens_at: 0,
          opensAt: 0,
          closes_at: 0,
          closesAt: 0,
          published_at: 0,
          publishedAt: 0,
          admin_id: "",
          hash: "",
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
    let notifications = [];
    try {
      const noticeRows = await client.query(
        `SELECT id, data, updated_at FROM docs
         WHERE collection = 'orinNotices'
           AND (owner_id = $1 OR owner_id IS NULL OR data->>'user_id' = $1 OR data->>'user_id' = '*')
         ORDER BY updated_at DESC LIMIT 50`,
        [u.id]
      );
      notifications = noticeRows.rows.map((r) => ({
        id: r.id,
        title: r.data?.title || "",
        message: r.data?.message || r.data?.body || "",
        contract_id: r.data?.contract_id || null,
        created_at: r.data?.created_at || (r.updated_at ? new Date(r.updated_at).getTime() : now)
      }));
    } catch {
      notifications = [];
    }
    const receipts = recRes.rows.map((r) => ({
      id: r.id,
      position_id: r.position_id,
      positionId: r.position_id,
      user_id: r.user_id,
      userId: r.user_id,
      payload: typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload),
      hash: r.hash,
      created_at: r.created_at ? new Date(r.created_at).getTime() : 0,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : 0
    }));
    const ledger = jrnRes.rows.map((je) => ({
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
    let audit = [];
    if (isAdmin) {
      try {
        const audRes = await client.query(`SELECT * FROM audit ORDER BY created_at DESC LIMIT 100`);
        audit = audRes.rows.map((a) => ({
          id: String(a.id),
          actor_id: a.actor_id,
          action: a.action,
          reference: a.reference,
          payload: typeof a.payload === "string" ? a.payload : JSON.stringify(a.payload),
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
      totalRealizedCents = settled !== 0 ? settled + bonusProfit : accRealized !== 0 ? accRealized : bonusProfit;
    } catch {
      totalRealizedCents = Number(acc.realized_cents || 0);
      dailyProfitCents = 0;
    }
    return {
      serverTime: now,
      user: {
        id: u.id,
        name: user.display_name || "\u0645\u0633\u062A\u062E\u062F\u0645 ORIN",
        tier: user.tier || "standard",
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
      audit
    };
  } finally {
    client.release();
  }
}
async function revokeContract(u, contractId, reason, effectiveNow = Date.now()) {
  return await withTx(async (client) => {
    await client.query(`UPDATE contracts SET status = 'cancelled' WHERE id = $1`, [contractId]);
    await client.query(`
      INSERT INTO contract_revocation_state (contract_id, revoked, reason, revoked_by, revoked_at)
      VALUES ($1, TRUE, $2, $3, TO_TIMESTAMP($4 / 1000.0))
      ON CONFLICT (contract_id) DO UPDATE SET revoked = TRUE, reason = $2, revoked_by = $3, revoked_at = TO_TIMESTAMP($4 / 1000.0)
    `, [contractId, reason || "Revoked by admin", u.id, effectiveNow]);
    return { ok: true, revoked: true, contractId };
  });
}
async function action(u, input, now = Date.now()) {
  const act = input?.action;
  const effectiveNow = input?.now || now;
  let result = { ok: true };
  if (act === "publish") {
    result = await publish(u, input.contract || input, effectiveNow);
  } else if (act === "join") {
    const joinInput = {
      code: input.code || input.contractCode || input.contractId,
      amountCents: input.amountCents,
      confirmed: input.confirmed !== false,
      contractHash: input.contractHash,
      useBonus: input.useBonus
    };
    result = await join(u, joinInput, effectiveNow);
  } else if (act === "settle") {
    result = await settle(u, effectiveNow);
  } else if (act === "revoke") {
    result = await revokeContract(u, input.contractId, input.reason, effectiveNow);
  } else if (act === "accept") {
    await withTx(async (client) => {
      await client.query(`UPDATE profiles SET accepted_at = NOW() WHERE id = $1`, [u.id]);
    });
    result = { ok: true, accepted: true };
  } else if (act === "read") {
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
async function verify(u, code) {
  return await withTx(async (client) => {
    const rawCode = String(code || "").trim().toUpperCase();
    const res = await client.query("SELECT * FROM contracts WHERE code = $1 OR hash = $1", [rawCode]);
    if (res.rowCount === 0) {
      throw new ApiError("\u0643\u0648\u062F \u0627\u0644\u0635\u0641\u0642\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u064A\u0647.", 404);
    }
    const contract = res.rows[0];
    const prevPositions = await client.query(
      "SELECT id, status, amount_cents FROM positions WHERE user_id = $1 AND contract_id = $2",
      [u.id, contract.id]
    );
    if (prevPositions.rows.length > 0) {
      throw new ApiError("\u062A\u0645 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0648\u062F \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u0642\u0629 \u0645\u0633\u0628\u0642\u064B\u0627 \u0645\u0646 \u0642\u0650\u0628\u0644 \u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628. \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0643\u0648\u062F \u0623\u0643\u062B\u0631 \u0645\u0646 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629.", 409);
    }
    return { ok: true, contract };
  });
}
export {
  ApiError,
  action,
  hash,
  join,
  publish,
  resultCents,
  revokeContract,
  settle,
  state,
  verify
};
//# sourceMappingURL=contracts.js.map
