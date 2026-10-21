// src/db.ts
import pg from "pg";
var { Pool } = pg;
var connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}
if (!connectionString.includes("client_encoding")) {
  connectionString += (connectionString.includes("?") ? "&" : "?") + "client_encoding=UTF8";
}
var isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
var pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 8
});
pool.on("error", (err, _client) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});
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

// src/program-ingestion.ts
import { createHash } from "node:crypto";

// src/notifications.ts
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
async function recordConfirmedDeposit(e) {
  key(e.eventId);
  key(e.uid);
  key(e.accountId);
  if (e.currency !== "USD" || !validMoney(e.cents) || e.cents === 0 || typeof e.eligible !== "boolean") {
    throw new ApiError("Invalid confirmed deposit");
  }
  return withTx(async (client) => {
    const fingerprint = hash(JSON.stringify(e));
    const evRes = await client.query("SELECT fingerprint FROM trusted_events WHERE event_id = $1", [e.eventId]);
    if (evRes.rows.length > 0) {
      if (evRes.rows[0].fingerprint !== fingerprint) throw new ApiError("Event conflict", 409);
      return;
    }
    const profRes = await client.query("SELECT disabled FROM profiles WHERE id = $1", [e.uid]);
    if (profRes.rows.length === 0 || profRes.rows[0].disabled) throw new ApiError("Funding account restricted", 409);
    const accRes = await client.query("SELECT * FROM accounts WHERE user_id = $1 AND id = $2", [e.uid, e.accountId]);
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
          currency: "USD",
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
    await notifyDepositCredited(client, {
      userId: e.uid,
      amountCents: e.cents,
      coin: "USDT",
      depositId: e.depositId ?? e.eventId
    });
    if (e.eligible) {
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
      const isReferralEligible = e.eligible && e.cents >= firstDepositCents && reward.status === "pending";
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
    if (memRes.rows.length > 0) {
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
    const auditPayload = JSON.stringify({ eventId: e.eventId, cents: e.cents, accountId: e.accountId });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ('provider', 'DEPOSIT_CONFIRMED', $1, $2::jsonb, $3)
       ON CONFLICT (action, reference) DO NOTHING`,
      [e.uid, auditPayload, hash(auditPayload)]
    );
  });
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
  createdAt: d.created_at ? new Date(d.created_at).getTime() : d.createdAt
});
var states = /* @__PURE__ */ new Set(["waiting", "confirming", "confirmed", "sending", "finished", "partially_paid", "failed", "refunded", "expired"]);
function paymentService(provider, ipnSecret) {
  async function create(u, input) {
    const accountId = safeId(input.accountId);
    const requestId = safeId(input.requestId);
    const amountCents = input.amountCents;
    const coin = input.coin;
    if (Object.keys(input).some((k) => !["accountId", "requestId", "amountCents", "coin"].includes(k)) || !Number.isSafeInteger(amountCents) || amountCents < 1e5 || amountCents > 1e7 || !PAYMENT_COINS.some((c) => c.id === coin)) {
      throw new ApiError3("\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 \u0644\u0644\u0625\u064A\u062F\u0627\u0639 1,000 \u062F\u0648\u0644\u0627\u0631 \u0623\u0645\u0631\u064A\u0643\u064A. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0645\u0628\u0644\u063A \u0648\u0627\u0644\u0639\u0645\u0644\u0629.");
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
      await withTx(async (client) => {
        await client.query(
          "UPDATE deposits SET status = 'finished', credited = true, credited_cents = $1, confirmed_at = NOW(), updated_at = NOW() WHERE id = $2",
          [creditedCents, safeOrderId]
        );
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
        "SELECT * FROM deposits WHERE user_id = $1 AND account_id = $2 ORDER BY created_at DESC LIMIT 20",
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
