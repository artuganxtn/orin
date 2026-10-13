import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { withTx } from './db.ts';

export class RegistrationError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}
const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const validRegistrationEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function codeDigest(secret: string, challenge: string, email: string, code: string) {
  return createHmac('sha256', secret).update(JSON.stringify([challenge, email, code])).digest('hex');
}
export function validChallenge(record: any, challenge: string, email: string, code: string, secret: string, now: number): 'ok' | 'invalid' | 'expired' | 'locked' | 'used' {
  if (!record || record.email !== email || record.delivery !== 'sent') return 'invalid';
  if (record.used) return 'used';
  if (record.expiresAtMs <= now) return 'expired';
  if (record.attempts >= 5) return 'locked';
  if (typeof record.digest !== 'string' || !/^[a-f0-9]{64}$/.test(record.digest)) return 'invalid';
  const actual = Buffer.from(codeDigest(secret, challenge, email, code), 'hex');
  const expected = Buffer.from(record.digest, 'hex');
  return timingSafeEqual(actual, expected) ? 'ok' : 'invalid';
}

type Mailer = (input: { to: string; code: string; challengeId: string }) => Promise<void>;

export function emailRegistration(auth: Pick<Auth, 'createUser' | 'createCustomToken'>, secret: string, mail: Mailer, now = Date.now) {
  if (secret.length < 32) throw new RegistrationError('service-unavailable', 503);
  const key = (s: string) => createHmac('sha256', secret).update(s).digest('hex');

  async function send(input: any, ip: string) {
    const email = normalize(input?.email);
    if (!validRegistrationEmail(email)) throw new RegistrationError('invalid-email');
    const id = randomBytes(24).toString('hex');
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const time = now();

    const rates = [
      { key: key('email:' + email), limit: 3 },
      { key: key('ip:' + ip), limit: 10 },
      { key: 'global-' + Math.floor(time / 86400000), limit: 200 }
    ];

    await withTx(async (client) => {
      for (let i = 0; i < rates.length; i++) {
        const r = rates[i];
        const window = i === 2 ? 86400000 : 3600000;
        const res = await client.query('SELECT data FROM docs WHERE collection = $1 AND id = $2 FOR UPDATE', ['orinEmailRates', r.key]);
        const data = res.rows[0]?.data;
        const times: number[] = (data?.times ?? []).filter((n: number) => n > time - window);
        if (times.length >= r.limit || (i === 0 && times.some((n: number) => n > time - 60000))) {
          throw new RegistrationError('too-many-requests', 429);
        }
        const nextTimes = [...times, time];
        await client.query(
          `INSERT INTO docs (collection, id, data, updated_at)
           VALUES ('orinEmailRates', $1, $2, NOW())
           ON CONFLICT (collection, id) DO UPDATE SET data = $2, updated_at = NOW()`,
          [r.key, JSON.stringify({ times: nextTimes })]
        );
      }

      const challengeData = {
        email,
        digest: codeDigest(secret, id, email, code),
        createdAt: time,
        expiresAtMs: time + 600000,
        attempts: 0,
        used: false,
        delivery: 'pending'
      };
      await client.query(
        `INSERT INTO docs (collection, id, data, updated_at)
         VALUES ('orinEmailChallenges', $1, $2, NOW())`,
        [id, JSON.stringify(challengeData)]
      );
    });

    try {
      await mail({ to: email, code, challengeId: id });
      await withTx(async (client) => {
        await client.query(
          `UPDATE docs SET data = jsonb_set(data, '{delivery}', '"sent"') WHERE collection = 'orinEmailChallenges' AND id = $1`,
          [id]
        );
      });
    } catch {
      await withTx(async (client) => {
        await client.query(
          `UPDATE docs SET data = jsonb_set(jsonb_set(data, '{delivery}', '"failed"'), '{digest}', '""') WHERE collection = 'orinEmailChallenges' AND id = $1`,
          [id]
        );
      });
      throw new RegistrationError('delivery-unavailable', 503);
    }
    return { challengeId: id, expiresIn: 600, retryAfter: 60 };
  }

  async function register(input: any) {
    const email = normalize(input?.email);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const password = input?.password;
    const code = input?.code;
    const id = input?.challengeId;

    if (!validRegistrationEmail(email) || name.length < 2 || name.length > 100 || typeof password !== 'string' || password.length < 8 || password.length > 128 || typeof code !== 'string' || !/^\d{6}$/.test(code) || typeof id !== 'string' || !/^[a-f0-9]{48}$/.test(id)) {
      throw new RegistrationError('invalid-input');
    }

    const time = now();
    const outcome = await withTx(async (client) => {
      const res = await client.query('SELECT data FROM docs WHERE collection = $1 AND id = $2 FOR UPDATE', ['orinEmailChallenges', id]);
      const record = res.rows[0]?.data;
      const status = validChallenge(record, id, email, code, secret, time);
      if (status === 'ok') {
        await client.query(
          `UPDATE docs SET data = jsonb_set(jsonb_set(jsonb_set(data, '{used}', 'true'), '{usedAt}', $1), '{digest}', '""') WHERE collection = 'orinEmailChallenges' AND id = $2`,
          [JSON.stringify(time), id]
        );
      } else if (record && record.email === email && !record.used && record.expiresAtMs > time && record.attempts < 5) {
        await client.query(
          `UPDATE docs SET data = jsonb_set(data, '{attempts}', $1) WHERE collection = 'orinEmailChallenges' AND id = $2`,
          [JSON.stringify(record.attempts + 1), id]
        );
      }
      return status;
    });

    if (outcome !== 'ok') throw new RegistrationError('code-' + outcome, 400);

    try {
      const user = await auth.createUser({ email, password, displayName: name, emailVerified: true });
      await withTx(async (client) => {
        await client.query(
          `INSERT INTO profiles (id, email, display_name, role, disabled, email_verified)
           VALUES ($1, $2, $3, 'user', FALSE, TRUE)
           ON CONFLICT (id) DO UPDATE SET email_verified = TRUE, updated_at = NOW()`,
          [user.uid, email, name]
        );
      });
      return { token: await auth.createCustomToken(user.uid) };
    } catch (error: any) {
      const code = error?.code;
      if (code === 'auth/email-already-exists') throw new RegistrationError('email-already-exists', 409);
      throw new RegistrationError('registration-incomplete', 503);
    }
  }

  return { send, register };
}
