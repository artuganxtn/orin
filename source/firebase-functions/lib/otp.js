// src/otp.ts
import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

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
function getPool() {
  return pool;
}
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

// src/otp.ts
var OtpError = class extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
};
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
export {
  OtpError,
  computeOtpHmac,
  computeUnsubscribeTokenHash,
  computeWithdrawalBoundHash,
  consumeOtpProof,
  createOtpChallenge,
  verifyOtpChallenge
};
//# sourceMappingURL=otp.js.map
