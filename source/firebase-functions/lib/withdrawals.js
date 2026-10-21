var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/db.ts
import pg from "pg";
function getPool() {
  return pool;
}
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

// src/otp.ts
var otp_exports = {};
__export(otp_exports, {
  OtpError: () => OtpError,
  computeOtpHmac: () => computeOtpHmac,
  computeUnsubscribeTokenHash: () => computeUnsubscribeTokenHash,
  computeWithdrawalBoundHash: () => computeWithdrawalBoundHash,
  consumeOtpProof: () => consumeOtpProof,
  createOtpChallenge: () => createOtpChallenge,
  verifyOtpChallenge: () => verifyOtpChallenge
});
import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
function computeOtpHmac(secret, challengeId, email, code) {
  return createHmac("sha256", secret).update(`${challengeId}:${email.toLowerCase().trim()}:${code}`).digest("hex");
}
function computeWithdrawalBoundHash(userId, amountCents, coin, address) {
  const normCoin = String(coin || "USDT").toUpperCase().trim();
  const normAddr = String(address || "").trim();
  return createHash("sha256").update(`${userId}:${amountCents}:${normCoin}:${normAddr}`).digest("hex");
}
function computeUnsubscribeTokenHash(secret, userId) {
  return createHmac("sha256", secret).update(`unsub:${userId}`).digest("hex");
}
async function createOtpChallenge(emailInput, purpose, secret, ip, userId, boundHash, dbClient) {
  const email = String(emailInput || "").toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OtpError("invalid-email", 400);
  }
  const challengeId = "otp-" + randomBytes(24).toString("hex");
  const code = String(randomInt(0, 1e6)).padStart(6, "0");
  const codeHmac = computeOtpHmac(secret, challengeId, email, code);
  const runWithClient = async (client) => {
    const emailKey = createHash("sha256").update(`rate:email:${email}`).digest("hex");
    const ipKey = createHash("sha256").update(`rate:ip:${ip}`).digest("hex");
    const eRes = await client.query("SELECT data FROM docs WHERE collection = $1 AND id = $2 FOR UPDATE", ["orinOtpRates", emailKey]);
    const iRes = await client.query("SELECT data FROM docs WHERE collection = $1 AND id = $2 FOR UPDATE", ["orinOtpRates", ipKey]);
    const now = Date.now();
    const hrAgo = now - 36e5;
    const minAgo = now - 6e4;
    const eTimes = (eRes.rows[0]?.data?.times ?? []).filter((t) => t > hrAgo);
    const iTimes = (iRes.rows[0]?.data?.times ?? []).filter((t) => t > hrAgo);
    if (eTimes.some((t) => t > minAgo)) {
      throw new OtpError("cooldown-active", 429);
    }
    const isInternalIp = !ip || ip === "unknown" || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("172.") || ip.startsWith("192.168.");
    if (eTimes.length >= 5 || !isInternalIp && iTimes.length >= 20) {
      throw new OtpError("too-many-requests", 429);
    }
    await client.query(
      `INSERT INTO docs (collection, id, data, updated_at) VALUES ('orinOtpRates', $1, $2, NOW())
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [emailKey, JSON.stringify({ times: [...eTimes, now] })]
    );
    await client.query(
      `INSERT INTO docs (collection, id, data, updated_at) VALUES ('orinOtpRates', $1, $2, NOW())
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [ipKey, JSON.stringify({ times: [...iTimes, now] })]
    );
    await client.query(
      `INSERT INTO otp_challenges (id, user_id, email, purpose, code_hmac, bound_hash, max_attempts, expires_at, created_at, ip)
       VALUES ($1, $2, $3, $4, $5, $6, 5, NOW() + INTERVAL '10 minutes', NOW(), $7)`,
      [challengeId, userId || null, email, purpose, codeHmac, boundHash || null, ip]
    );
    return { challengeId, code, retryAfter: 60 };
  };
  if (dbClient) {
    return await runWithClient(dbClient);
  } else {
    return await withTx(async (client) => runWithClient(client));
  }
}
async function verifyOtpChallenge(challengeId, emailInput, code, purpose, secret, boundHash) {
  const email = String(emailInput || "").toLowerCase().trim();
  const pool2 = getPool();
  const res = await pool2.query(`SELECT * FROM otp_challenges WHERE id = $1`, [challengeId]);
  const c = res.rows[0];
  if (!c || c.consumed_at || c.email !== email || c.purpose !== purpose) {
    throw new OtpError("code-invalid", 400);
  }
  if (new Date(c.expires_at).getTime() <= Date.now()) {
    throw new OtpError("code-expired", 400);
  }
  if (c.attempts >= c.max_attempts) {
    throw new OtpError("code-locked", 400);
  }
  if (boundHash && c.bound_hash && c.bound_hash !== boundHash) {
    throw new OtpError("code-invalid", 400);
  }
  const actualHmac = computeOtpHmac(secret, challengeId, email, code);
  const expectedHmac = c.code_hmac;
  const match = timingSafeEqual(Buffer.from(actualHmac, "hex"), Buffer.from(expectedHmac, "hex"));
  if (!match) {
    const updated = await pool2.query(
      `UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts, max_attempts`,
      [challengeId]
    );
    const newAttempts = updated.rows[0]?.attempts ?? c.attempts + 1;
    if (newAttempts >= (c.max_attempts || 5)) {
      throw new OtpError("code-locked", 400);
    }
    throw new OtpError("code-invalid", 400);
  }
  return await withTx(async (client) => {
    await client.query(`UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1`, [challengeId]);
    const proofId = "proof-" + randomBytes(24).toString("hex");
    const proofBound = boundHash || c.bound_hash || "unbound";
    await client.query(`ALTER TABLE otp_proofs ALTER COLUMN user_id DROP NOT NULL`).catch(() => {
    });
    await client.query(
      `INSERT INTO otp_proofs (id, user_id, purpose, bound_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '5 minutes', NOW())`,
      [proofId, c.user_id && c.user_id !== "anonymous" ? c.user_id : null, purpose, proofBound]
    );
    return { proofId, userId: c.user_id };
  });
}
async function consumeOtpProof(proofId, userId, purpose, boundHash, client) {
  const res = await client.query(
    `SELECT * FROM otp_proofs WHERE id = $1 FOR UPDATE`,
    [proofId]
  );
  const p = res.rows[0];
  if (!p || p.consumed_at) return false;
  if (p.user_id && p.user_id !== userId) return false;
  if (p.purpose !== purpose) return false;
  if (p.bound_hash !== boundHash && p.bound_hash !== "unbound") return false;
  if (new Date(p.expires_at).getTime() <= Date.now()) return false;
  await client.query(`UPDATE otp_proofs SET consumed_at = NOW() WHERE id = $1`, [proofId]);
  return true;
}
var OtpError;
var init_otp = __esm({
  "src/otp.ts"() {
    init_db();
    OtpError = class extends Error {
      constructor(code, status = 400) {
        super(code);
        this.code = code;
        this.status = status;
      }
    };
  }
});

// src/withdrawals.ts
init_db();
import { randomUUID as randomUUID2 } from "node:crypto";

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
async function notifyWithdrawalSubmitted(client, p) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  const feeUsd = (p.feeCents / 100).toFixed(2);
  const netUsd = (p.netAmountCents / 100).toFixed(2);
  const shortAddr = p.address.length > 18 ? `${p.address.slice(0, 8)}...${p.address.slice(-6)}` : p.address;
  await createNotice(client, {
    userId: p.userId,
    title: "\u0637\u0644\u0628 \u0633\u062D\u0628 \u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0648\u0627\u0644\u062A\u062F\u0642\u064A\u0642 \u23F3",
    message: `\u062A\u0645 \u0627\u0633\u062A\u0644\u0627\u0645 \u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u0631\u0642\u0645 (${p.wdId}) \u0628\u0642\u064A\u0645\u0629 ${amountUsd} USDT \u0628\u0646\u062C\u0627\u062D.
\u2022 \u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u0637\u0644\u0648\u0628: ${amountUsd} USDT
\u2022 \u0631\u0633\u0648\u0645 \u0627\u0644\u0633\u062D\u0628 (5%): ${feeUsd} USDT
\u2022 \u0627\u0644\u0635\u0627\u0641\u064A \u0627\u0644\u0645\u0633\u062A\u062D\u0642: ${netUsd} USDT (${p.coin})
\u2022 \u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u062D\u0641\u0638\u0629: ${shortAddr}
\u0627\u0644\u0637\u0644\u0628 \u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0648\u0627\u0644\u062A\u062D\u0642\u0642 \u0627\u0644\u0645\u0627\u0644\u064A \u0645\u0646 \u0642\u0650\u0628\u0644 \u0625\u062F\u0627\u0631\u0629 ORIN.`,
    category: "financial",
    deepLink: "/withdraw",
    metadata: {
      type: "withdrawal_submitted",
      withdrawalId: p.wdId,
      amountCents: p.amountCents,
      feeCents: p.feeCents,
      netAmountCents: p.netAmountCents,
      coin: p.coin,
      address: p.address,
      status: "requested"
    }
  });
  const email = p.userEmail || p.userId;
  await createNotice(client, {
    userId: "admin",
    targetRole: "admin",
    title: "\u0637\u0644\u0628 \u0633\u062D\u0628 \u062C\u062F\u064A\u062F \u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u{1F514}",
    message: `\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 ${email} \u0642\u062F\u0645 \u0637\u0644\u0628 \u0633\u062D\u0628 \u0628\u0642\u064A\u0645\u0629 ${amountUsd} USDT (${p.coin}) \u0625\u0644\u0649 \u0627\u0644\u0639\u0646\u0648\u0627\u0646 ${shortAddr}. \u0627\u0644\u0645\u0639\u0631\u0651\u0641: ${p.wdId}.`,
    category: "financial",
    deepLink: "/admin/withdrawals",
    metadata: {
      type: "admin_withdrawal_requested",
      withdrawalId: p.wdId,
      amountCents: p.amountCents,
      coin: p.coin,
      address: p.address
    }
  });
}
async function notifyWithdrawalApproved(client, p) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  const netUsd = (p.netAmountCents / 100).toFixed(2);
  await createNotice(client, {
    userId: p.userId,
    title: "\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0648\u0645\u0648\u0627\u0641\u0642\u0629 \u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u2705",
    message: `\u062A\u0645\u062A \u0645\u0631\u0627\u062C\u0639\u0629 \u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 (${p.wdId}) \u0648\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u064A\u0647 \u0628\u0646\u062C\u0627\u062D \u0628\u0642\u064A\u0645\u0629 ${amountUsd} USDT (${p.coin}).
\u0635\u0627\u0641\u064A \u0627\u0644\u0645\u0628\u0644\u063A (${netUsd} USDT) \u0642\u064A\u062F \u0627\u0644\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0641\u0648\u0631\u064A \u0625\u0644\u0649 \u0645\u062D\u0641\u0638\u062A\u0643 \u0648\u0633\u064A\u0632\u0648\u062F \u0628\u0627\u0644\u0640 TxID \u0641\u0648\u0631 \u0627\u0644\u0627\u0643\u062A\u0645\u0627\u0644 \u0639\u0644\u0649 \u0627\u0644\u0628\u0644\u0648\u0643\u062A\u0634\u064A\u0646.`,
    category: "financial",
    deepLink: "/activity",
    metadata: {
      type: "withdrawal_approved",
      withdrawalId: p.wdId,
      amountCents: p.amountCents,
      netAmountCents: p.netAmountCents,
      coin: p.coin,
      status: "approved"
    }
  });
}
async function notifyWithdrawalPaid(client, p) {
  const netUsd = (p.netAmountCents / 100).toFixed(2);
  await createNotice(client, {
    userId: p.userId,
    title: "\u062A\u0645 \u062A\u0646\u0641\u064A\u0630 \u0648\u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u0633\u062D\u0628 \u0628\u0646\u062C\u0627\u062D \u{1F680}",
    message: `\u062A\u0645 \u062A\u062D\u0648\u064A\u0644 \u0645\u0628\u0644\u063A ${netUsd} USDT (${p.coin}) \u0628\u0646\u062C\u0627\u062D \u0625\u0644\u0649 \u0645\u062D\u0641\u0638\u062A\u0643.
\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0639\u0644\u0649 \u0627\u0644\u0628\u0644\u0648\u0643\u062A\u0634\u064A\u0646 (TxID):
${p.txHash}
\u062A\u0645 \u062A\u0633\u0648\u064A\u0629 \u0627\u0644\u0645\u0639\u0627\u0645\u0644\u0629 \u0648\u0627\u0643\u062A\u0645\u0627\u0644\u0647\u0627 \u0628\u0646\u062C\u0627\u062D \u0641\u064A \u0643\u0634\u0641 \u0627\u0644\u062D\u0633\u0627\u0628.`,
    category: "financial",
    deepLink: "/activity",
    metadata: {
      type: "withdrawal_paid",
      withdrawalId: p.wdId,
      amountCents: p.amountCents,
      netAmountCents: p.netAmountCents,
      coin: p.coin,
      txHash: p.txHash,
      status: "paid"
    }
  });
}
async function notifyWithdrawalRejected(client, p) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  await createNotice(client, {
    userId: p.userId,
    title: "\u0625\u0634\u0639\u0627\u0631 \u0628\u0631\u0641\u0636 \u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u0648\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0631\u0635\u064A\u062F \u26A0\uFE0F",
    message: `\u062A\u0645 \u0631\u0641\u0636 \u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 (${p.wdId}).
\u0627\u0644\u0633\u0628\u0628: ${p.reason || "\u0645\u0631\u0641\u0648\u0636 \u0645\u0646 \u0642\u0628\u0644 \u0627\u0644\u062A\u062F\u0642\u064A\u0642 \u0627\u0644\u0645\u0627\u0644\u064A"}.
\u062A\u0645\u062A \u0625\u0639\u0627\u062F\u0629 \u0643\u0627\u0645\u0644 \u0627\u0644\u0645\u0628\u0644\u063A (${amountUsd} USDT) \u0641\u0648\u0631\u0627\u064B \u0625\u0644\u0649 \u0631\u0635\u064A\u062F\u0643 \u0627\u0644\u0645\u062A\u0627\u062D \u0641\u064A \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u0622\u062C\u0644\u0629 (\u0645\u062D\u0641\u0638\u0629 \u0627\u0644\u0633\u062D\u0628).`,
    category: "financial",
    deepLink: "/withdraw",
    metadata: {
      type: "withdrawal_rejected",
      withdrawalId: p.wdId,
      amountCents: p.amountCents,
      reason: p.reason,
      status: "rejected"
    }
  });
}

// src/withdrawals.ts
var WithdrawalError = class extends Error {
  constructor(message, status = 400, code = "withdrawal_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
};
async function requestWithdrawal(user, input) {
  const amountCents = Number(input.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new WithdrawalError("\u0627\u0644\u0645\u0628\u0644\u063A \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.", 400);
  }
  const address = String(input.address || "").trim();
  if (!address || address.length < 5 || address.length > 256) {
    throw new WithdrawalError("\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u062D\u0641\u0638\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.", 400);
  }
  const coin = String(input.coin || "USDT").toUpperCase();
  const currency = String(input.currency || "USD").toUpperCase();
  const nowMs = input.now ? input.now instanceof Date ? input.now.getTime() : Number(input.now) : Date.now();
  return await withTx(async (client) => {
    const pRes = await client.query("SELECT id, disabled FROM profiles WHERE id = $1", [user.id]);
    if (pRes.rowCount === 0 || pRes.rows[0].disabled) {
      throw new WithdrawalError("\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D.", 403);
    }
    const proofId = input.proofId || input.otpProofId;
    if (proofId) {
      const { computeWithdrawalBoundHash: computeWithdrawalBoundHash2, consumeOtpProof: consumeOtpProof2 } = await Promise.resolve().then(() => (init_otp(), otp_exports));
      const boundHash = computeWithdrawalBoundHash2(user.id, amountCents, coin, address);
      const proofConsumed = await consumeOtpProof2(proofId, user.id, "withdrawal", boundHash, client);
      if (!proofConsumed) {
        throw new WithdrawalError("\u0631\u0645\u0632 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0633\u062D\u0628 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0645\u0633\u062A\u062E\u062F\u0645 \u0645\u0633\u0628\u0642\u064B\u0627 / Invalid or consumed OTP proof", 403, "otp_required");
      }
    } else if (process.env.ORIN_STRICT_WITHDRAWAL_OTP === "true") {
      throw new WithdrawalError("\u0631\u0645\u0632 \u0627\u0644\u062A\u0623\u0643\u064A\u062F \u0644\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A \u0645\u0637\u0644\u0648\u0628 \u0644\u0644\u0633\u062D\u0628 / OTP proof required", 403, "otp_required");
    }
    let accountId = input.accountId;
    if (!accountId) {
      const accRes2 = await client.query(
        "SELECT id, balance_cents, reserved_cents FROM accounts WHERE user_id = $1 AND type = 'real' LIMIT 1",
        [user.id]
      );
      if (accRes2.rowCount === 0) {
        throw new WithdrawalError("\u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.", 404);
      }
      accountId = accRes2.rows[0].id;
    }
    const accRes = await client.query(
      "SELECT id, balance_cents, reserved_cents FROM accounts WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [accountId, user.id]
    );
    if (accRes.rowCount === 0) {
      throw new WithdrawalError("\u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.", 404);
    }
    const account = accRes.rows[0];
    const pendingRes = await client.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total_pending
       FROM withdrawal_requests
       WHERE account_id = $1 AND status IN ('requested', 'approved')`,
      [accountId]
    );
    const pendingCents = BigInt(pendingRes.rows[0]?.total_pending || 0);
    const docRes = await client.query(
      `SELECT data FROM docs WHERE collection = 'contract_wallets' AND id = $1 FOR UPDATE`,
      [accountId]
    );
    const availableCash = BigInt(account.balance_cents) - BigInt(account.reserved_cents);
    if (availableCash < BigInt(amountCents) || availableCash <= 0n) {
      throw new WithdrawalError("\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u064A\u062A\u062C\u0627\u0648\u0632 \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D \u0644\u0644\u0633\u062D\u0628 \u0641\u064A \u0627\u0644\u062D\u0633\u0627\u0628.", 409);
    }
    let wState = docRes.rows[0]?.data;
    if (wState?.wallet) {
      const curFutures = Math.max(0, Number(wState.wallet.futuresCents || 0));
      if (curFutures < amountCents) {
        throw new WithdrawalError(
          "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u064A\u062A\u062C\u0627\u0648\u0632 \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D \u0641\u064A \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u0622\u062C\u0644\u0629 (\u0645\u062D\u0641\u0638\u0629 \u0627\u0644\u0633\u062D\u0628). \u0631\u0635\u064A\u062F \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u062F\u0627\u0626\u0645\u0629 \u0645\u062E\u0635\u0635 \u0644\u0644\u062A\u062F\u0627\u0648\u0644 \u0641\u0642\u0637 \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u0633\u062D\u0628\u0647 \u0645\u0628\u0627\u0634\u0631\u0629. \u064A\u0631\u062C\u0649 \u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u0631\u0627\u062F \u0633\u062D\u0628\u0647 \u0645\u0646 \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u062F\u0627\u0626\u0645\u0629 \u0625\u0644\u0649 \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u0622\u062C\u0644\u0629 \u0623\u0648\u0644\u0627\u064B.",
          409
        );
      }
    }
    const feeCents = Math.round(amountCents * 0.05);
    const netAmountCents = amountCents - feeCents;
    const wdId = "wd-" + randomUUID2();
    await client.query(
      `INSERT INTO withdrawal_requests (id, user_id, account_id, amount_cents, fee_cents, net_amount_cents, currency, coin, address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'requested')`,
      [wdId, user.id, accountId, amountCents, feeCents, netAmountCents, currency, coin, address]
    );
    const journalId = "jnl-wd-" + randomUUID2();
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
    if (wState?.wallet) {
      wState.wallet.futuresCents = Math.max(0, Number(wState.wallet.futuresCents || 0) - amountCents);
      wState.wallet.version = (wState.wallet.version || 1) + 1;
      wState.wallet.updatedAt = Date.now();
      if (Array.isArray(wState.operations)) {
        wState.operations.push({
          id: "wd-op-" + wdId,
          kind: "withdrawal",
          amountCents,
          feeCents,
          netAmountCents,
          afterFuturesCents: wState.wallet.futuresCents,
          afterPerpetualCents: wState.wallet.perpetualCents,
          createdAt: Date.now()
        });
      }
      await client.query(
        `UPDATE docs SET data = $1, updated_at = NOW() WHERE collection = 'contract_wallets' AND id = $2`,
        [JSON.stringify(wState), accountId]
      );
    }
    await client.query(
      `INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, created_at)
       VALUES ($1, 'withdrawal', $2, $3, $4, $5, $6, 'pending', $7, $8, $9, NOW())
       ON CONFLICT (id) DO NOTHING`,
      ["appr-" + wdId, user.id, accountId, -amountCents, Number(account.balance_cents), Number(account.balance_cents) - amountCents, `\u0637\u0644\u0628 \u0633\u062D\u0628 ${amountCents / 100} ${coin} \u0625\u0644\u0649 ${address}`, wdId, user.id]
    );
    const profRes = await client.query("SELECT email FROM profiles WHERE id = $1", [user.id]);
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
      status: "requested",
      message: "\u062A\u0645 \u0627\u0633\u062A\u0644\u0627\u0645 \u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u0648\u062E\u0635\u0645 \u0627\u0644\u0631\u0635\u064A\u062F \u0628\u0646\u062C\u0627\u062D. \u0633\u064A\u062A\u0645 \u0645\u0631\u0627\u062C\u0639\u062A\u0647 \u0648\u062A\u062D\u0648\u064A\u0644\u0647 \u0645\u0646 \u0642\u0650\u0628\u0644 \u0627\u0644\u0625\u062F\u0627\u0631\u0629."
    };
  });
}
async function proposeWithdrawalApproval(admin1, input) {
  const wdId = input.withdrawalId;
  return await withTx(async (client) => {
    const wdRes = await client.query("SELECT * FROM withdrawal_requests WHERE id = $1", [wdId]);
    if (wdRes.rowCount === 0) {
      throw new WithdrawalError("\u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.", 404);
    }
    const wd = wdRes.rows[0];
    if (wd.status !== "requested") {
      throw new WithdrawalError(`\u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u0641\u064A \u062D\u0627\u0644\u0629 \u0644\u0627 \u062A\u0633\u0645\u062D \u0628\u0637\u0644\u0628 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 (${wd.status}).`, 409);
    }
    const accRes = await client.query("SELECT balance_cents FROM accounts WHERE id = $1", [wd.account_id]);
    const balanceCents = Number(accRes.rows[0]?.balance_cents || 0);
    const apprId = "appr-" + randomUUID2();
    const deltaCents = -Number(wd.amount_cents);
    const afterCents = balanceCents + deltaCents;
    const reason = input.reason || "Administrative withdrawal approval request";
    await client.query(
      `INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by)
       VALUES ($1, 'withdrawal', $2, $3, $4, $5, $6, 'pending', $7, $8, $9)`,
      [apprId, wd.user_id, wd.account_id, deltaCents, balanceCents, afterCents, reason, wdId, admin1.id]
    );
    return {
      ok: true,
      approvalId: apprId,
      withdrawalId: wdId,
      status: "pending"
    };
  });
}
async function approveWithdrawal(admin2, input) {
  const apprId = input.approvalId;
  return await withTx(async (client) => {
    const apprRes = await client.query("SELECT * FROM approvals WHERE id = $1", [apprId]);
    if (apprRes.rowCount === 0) {
      throw new WithdrawalError("\u0637\u0644\u0628 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.", 404);
    }
    const appr = apprRes.rows[0];
    if (appr.status !== "pending") {
      throw new WithdrawalError(`\u0637\u0644\u0628 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0644\u064A\u0633 \u0645\u0639\u0644\u0642\u0627\u064B (${appr.status}).`, 409);
    }
    if (appr.requested_by === admin2.id) {
      throw new WithdrawalError("\u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u0645\u0634\u0631\u0641 \u0627\u0644\u062B\u0627\u0646\u064A \u0645\u0637\u0644\u0648\u0628\u0629 (\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0639\u062A\u0645\u0627\u062F \u0637\u0644\u0628\u0643 \u0628\u0646\u0641\u0633\u0643).", 403);
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
    const wdRes = await client.query("SELECT * FROM withdrawal_requests WHERE id = $1", [appr.reference]);
    if (wdRes.rowCount > 0) {
      const wd = wdRes.rows[0];
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
      status: "approved"
    };
  });
}
async function markWithdrawalPaid(admin, input) {
  const wdId = input.withdrawalId;
  const txHash = String(input.txHash || "").trim();
  if (!txHash) {
    throw new WithdrawalError("\u0631\u0645\u0632 \u0627\u0644\u0645\u0639\u0627\u0645\u0644\u0629 tx_hash \u0645\u0637\u0644\u0648\u0628.", 400);
  }
  return await withTx(async (client) => {
    const wdRes = await client.query("SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE", [wdId]);
    if (wdRes.rowCount === 0) {
      throw new WithdrawalError("\u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.", 404);
    }
    const wd = wdRes.rows[0];
    if (wd.status !== "approved") {
      throw new WithdrawalError(`\u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u063A\u064A\u0631 \u0645\u0639\u062A\u0645\u062F (${wd.status}).`, 409);
    }
    const amountCents = Number(wd.amount_cents);
    const jRes = await client.query("SELECT id FROM journals WHERE reference = $1 AND kind = 'withdrawal'", [wdId]);
    let journalId = jRes.rows[0]?.id;
    if (!journalId) {
      journalId = "jnl-wd-" + randomUUID2();
      await client.query(
        `INSERT INTO journals (id, kind, reference, created_at) VALUES ($1, 'withdrawal', $2, NOW())`,
        [journalId, wdId]
      );
      await client.query(
        `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
         ($1, $2, $3, 'cash', $4),
         ($1, NULL, NULL, 'system:payout-clearing', $5)`,
        [journalId, wd.user_id, wd.account_id, -amountCents, amountCents]
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
      status: "paid",
      txHash,
      journalId
    };
  });
}
async function rejectWithdrawal(admin, input) {
  const wdId = input.withdrawalId;
  const reason = input.reason || "\u062A\u0645 \u0631\u0641\u0636 \u0627\u0644\u0633\u062D\u0628 \u0645\u0646 \u0642\u0650\u0628\u0644 \u0627\u0644\u0625\u062F\u0627\u0631\u0629";
  return await withTx(async (client) => {
    const wdRes = await client.query("SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE", [wdId]);
    if (wdRes.rowCount === 0) {
      throw new WithdrawalError("\u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.", 404);
    }
    const wd = wdRes.rows[0];
    if (wd.status === "rejected") {
      return { ok: true, withdrawalId: wdId, status: "rejected", message: "\u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u0645\u0631\u0641\u0648\u0636 \u0645\u0633\u0628\u0642\u064B\u0627." };
    }
    const amountCents = Number(wd.amount_cents);
    const refCheck = await client.query(
      "SELECT id FROM journals WHERE reference = $1 AND kind = 'adjustment'",
      [wdId]
    );
    if (refCheck.rowCount === 0) {
      const refundJournalId = "jnl-ref-" + randomUUID2();
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
      const docRes = await client.query(
        `SELECT data FROM docs WHERE collection = 'contract_wallets' AND id = $1 FOR UPDATE`,
        [wd.account_id]
      );
      if (docRes.rows[0]?.data) {
        const wState = docRes.rows[0].data;
        if (wState.wallet) {
          wState.wallet.futuresCents = (Number(wState.wallet.futuresCents) || 0) + amountCents;
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
      status: "rejected",
      message: "\u062A\u0645 \u0631\u0641\u0636 \u0637\u0644\u0628 \u0627\u0644\u0633\u062D\u0628 \u0648\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0631\u0635\u064A\u062F \u0625\u0644\u0649 \u062D\u0633\u0627\u0628 \u0627\u0644\u0639\u0645\u064A\u0644 \u0628\u0646\u062C\u0627\u062D."
    };
  });
}
async function getUserWithdrawals(user) {
  return await withTx(async (client) => {
    const res = await client.query(
      "SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC",
      [user.id]
    );
    return { items: res.rows };
  });
}
async function getWithdrawalById(user, id) {
  return await withTx(async (client) => {
    const res = await client.query("SELECT * FROM withdrawal_requests WHERE id = $1", [id]);
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    if (row.user_id !== user.id && user.role !== "admin") {
      return null;
    }
    return row;
  });
}
export {
  WithdrawalError,
  approveWithdrawal,
  getUserWithdrawals,
  getWithdrawalById,
  markWithdrawalPaid,
  proposeWithdrawalApproval,
  rejectWithdrawal,
  requestWithdrawal
};
//# sourceMappingURL=withdrawals.js.map
