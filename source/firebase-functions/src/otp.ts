import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { withTx, getPool } from './db.ts';

export class OtpError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

export function computeOtpHmac(secret: string, challengeId: string, email: string, code: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${email.toLowerCase().trim()}:${code}`).digest('hex');
}

export function computeWithdrawalBoundHash(userId: string, amountCents: number, coin: string, address: string): string {
  const normCoin = String(coin || 'USDT').toUpperCase().trim();
  const normAddr = String(address || '').trim();
  return createHash('sha256').update(`${userId}:${amountCents}:${normCoin}:${normAddr}`).digest('hex');
}

export function computeUnsubscribeTokenHash(secret: string, userId: string): string {
  return createHmac('sha256', secret).update(`unsub:${userId}`).digest('hex');
}

export async function createOtpChallenge(
  emailInput: string,
  purpose: 'signup' | 'withdrawal' | 'login_device' | 'password_reset',
  secret: string,
  ip: string,
  userId?: string,
  boundHash?: string,
  dbClient?: any
): Promise<{ challengeId: string; code: string; retryAfter: number }> {
  const email = String(emailInput || '').toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OtpError('invalid-email', 400);
  }

  const challengeId = 'otp-' + randomBytes(24).toString('hex');
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const codeHmac = computeOtpHmac(secret, challengeId, email, code);

  const runWithClient = async (client: any) => {
    const emailKey = createHash('sha256').update(`rate:email:${email}`).digest('hex');
    const ipKey = createHash('sha256').update(`rate:ip:${ip}`).digest('hex');

    const eRes = await client.query('SELECT data FROM docs WHERE collection = $1 AND id = $2 FOR UPDATE', ['orinOtpRates', emailKey]);
    const iRes = await client.query('SELECT data FROM docs WHERE collection = $1 AND id = $2 FOR UPDATE', ['orinOtpRates', ipKey]);

    const now = Date.now();
    const hrAgo = now - 3600000;
    const minAgo = now - 60000;

    const eTimes: number[] = (eRes.rows[0]?.data?.times ?? []).filter((t: number) => t > hrAgo);
    const iTimes: number[] = (iRes.rows[0]?.data?.times ?? []).filter((t: number) => t > hrAgo);

    if (eTimes.some(t => t > minAgo)) {
      throw new OtpError('cooldown-active', 429);
    }

    const isInternalIp = !ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('172.') || ip.startsWith('192.168.');
    if (eTimes.length >= 5 || (!isInternalIp && iTimes.length >= 20)) {
      throw new OtpError('too-many-requests', 429);
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

export async function verifyOtpChallenge(
  challengeId: string,
  emailInput: string,
  code: string,
  purpose: string,
  secret: string,
  boundHash?: string
): Promise<{ proofId: string; userId?: string }> {
  const email = String(emailInput || '').toLowerCase().trim();
  const pool = getPool();

  const res = await pool.query(`SELECT * FROM otp_challenges WHERE id = $1`, [challengeId]);
  const c = res.rows[0];

  if (!c || c.consumed_at || c.email !== email || c.purpose !== purpose) {
    throw new OtpError('code-invalid', 400);
  }

  if (new Date(c.expires_at).getTime() <= Date.now()) {
    throw new OtpError('code-expired', 400);
  }

  if (c.attempts >= c.max_attempts) {
    throw new OtpError('code-locked', 400);
  }

  if (boundHash && c.bound_hash && c.bound_hash !== boundHash) {
    throw new OtpError('code-invalid', 400);
  }

  const actualHmac = computeOtpHmac(secret, challengeId, email, code);
  const expectedHmac = c.code_hmac;

  const match = timingSafeEqual(Buffer.from(actualHmac, 'hex'), Buffer.from(expectedHmac, 'hex'));

  if (!match) {
    const updated = await pool.query(
      `UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts, max_attempts`,
      [challengeId]
    );
    const newAttempts = updated.rows[0]?.attempts ?? (c.attempts + 1);
    if (newAttempts >= (c.max_attempts || 5)) {
      throw new OtpError('code-locked', 400);
    }
    throw new OtpError('code-invalid', 400);
  }

  return await withTx(async (client) => {
    await client.query(`UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1`, [challengeId]);

    const proofId = 'proof-' + randomBytes(24).toString('hex');
    const proofBound = boundHash || c.bound_hash || 'unbound';

    await client.query(`ALTER TABLE otp_proofs ALTER COLUMN user_id DROP NOT NULL`).catch(() => {});

    await client.query(
      `INSERT INTO otp_proofs (id, user_id, purpose, bound_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '5 minutes', NOW())`,
      [proofId, (c.user_id && c.user_id !== 'anonymous') ? c.user_id : null, purpose, proofBound]
    );

    return { proofId, userId: c.user_id };
  });
}

export async function consumeOtpProof(
  proofId: string,
  userId: string,
  purpose: string,
  boundHash: string,
  client: any
): Promise<boolean> {
  const res = await client.query(
    `SELECT * FROM otp_proofs WHERE id = $1 FOR UPDATE`,
    [proofId]
  );

  const p = res.rows[0];
  if (!p || p.consumed_at) return false;
  if (p.user_id && p.user_id !== userId) return false;
  if (p.purpose !== purpose) return false;
  if (p.bound_hash !== boundHash && p.bound_hash !== 'unbound') return false;
  if (new Date(p.expires_at).getTime() <= Date.now()) return false;

  await client.query(`UPDATE otp_proofs SET consumed_at = NOW() WHERE id = $1`, [proofId]);
  return true;
}
