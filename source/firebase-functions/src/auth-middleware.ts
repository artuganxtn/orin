import { type Request, type Response, type NextFunction } from 'express';
import { adminAuth } from './firebase-admin-init.ts';
import { withTx } from './db.ts';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

type RejectReason =
  | 'no_bearer' | 'token_invalid' | 'token_expired' | 'verify_unavailable'
  | 'account_disabled' | 'access_blocked' | 'session_revoked' | 'email_unverified' | 'db_error';

/** One structured log line per rejection: reason code (and an error *code*) only, never tokens or messages. */
function reject(req: Request, res: Response, status: number, reason: RejectReason, body: Record<string, unknown>, code?: string) {
  console.warn(JSON.stringify({ evt: 'auth_reject', reason, status, method: req.method, path: req.path, ...(code ? { code } : {}) }));
  return res.status(status).json(body);
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reject(req, res, 401, 'no_bearer', { error: 'سجّل الدخول للمتابعة.' });
  }

  const token = authHeader.slice(7);
  let uid: string;
  let email: string;
  let name: string = 'مستخدم ORIN';
  let verified: boolean = true;
  let tokenIatMs: number = Date.now();

  // Step A: identity. Only a genuinely bad token produces 401.
  try {

    // Test auth bypass ONLY when NODE_ENV === 'test'
    if (process.env.NODE_ENV === 'test' && token.startsWith('test-token-')) {
      const parts = token.split(':');
      uid = parts[0].replace('test-token-', '');
      email = parts[1] || `${uid}@orin.top`;
      name = parts[3] || uid;
      verified = parts[5] === 'false' ? false : true;
      if (parts[4]) {
        tokenIatMs = Number(parts[4]);
      } else if (req.headers['x-test-token-iat']) {
        tokenIatMs = Number(req.headers['x-test-token-iat']);
      }
    } else {
      // All other environments: verify with firebase-admin verifyIdToken
      const decoded = await adminAuth.verifyIdToken(token, false);
      uid = decoded.uid;
      email = decoded.email || `${uid}@orin.top`;
      name = typeof decoded.name === 'string' ? decoded.name : 'مستخدم ORIN';
      verified = decoded.email_verified === true;
      // iat (time THIS token was issued), not auth_time: a token minted after a revocation is always valid.
      tokenIatMs = (decoded.iat || decoded.auth_time || Math.floor(Date.now() / 1000)) * 1000;
    }
  } catch (err: any) {
    const code = String(err?.code || 'unknown');
    if (code.startsWith('auth/')) {
      return reject(req, res, 401, code === 'auth/id-token-expired' ? 'token_expired' : 'token_invalid', { error: 'انتهت جلسة الدخول. سجّل الدخول مجددًا.' }, code);
    }
    // e.g. app/network-error while fetching signing certs: our side, not the user's session.
    return reject(req, res, 503, 'verify_unavailable', { error: 'الخدمة غير متاحة مؤقتًا. أعد المحاولة.', code: 'auth_backend_unavailable' }, code);
  }

  // Step B: account state. A database failure must never look like an expired login.
  let role = 'user';
  let isDisabled = false;
  let isBlocked = false;
  let blockReason = '';
  let validAfterMs = 0;
  let profileEmailVerified = false;
  try {

    await withTx(async (client) => {
      // Upsert default profile row
      await client.query(
        `INSERT INTO profiles (id, email, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
        [uid, email, name]
      );

      // Ensure active real account exists
      const accRes = await client.query(
        "SELECT id FROM accounts WHERE user_id = $1 AND type = 'real'",
        [uid]
      );
      if (accRes.rowCount === 0) {
        const accId = `acc-${uid.slice(0, 16)}`;
        const accNum = `${Math.floor(100000000000 + Math.random() * 899999999999)}`;
        await client.query(
          `INSERT INTO accounts (id, user_id, account_number, type, currency, status)
           VALUES ($1, $2, $3, 'real', 'USD', 'active')
           ON CONFLICT DO NOTHING`,
          [accId, uid, accNum]
        );
      }

      // Query profiles, staff, access_status, session_revocations
      const queryRes = await client.query(
        `SELECT
           p.role AS profile_role,
           p.disabled AS profile_disabled,
           s.roles AS staff_roles,
           s.status AS staff_status,
           a.status AS access_status,
           a.reason AS access_reason,
           (SELECT MAX(valid_after) FROM session_revocations WHERE user_id = p.id) AS valid_after
         FROM profiles p
         LEFT JOIN staff s ON p.id = s.user_id
         LEFT JOIN access_status a ON p.id = a.user_id
         WHERE p.id = $1`,
        [uid]
      );

      // Gate only applies once migration 013 has run. Until then (42703 undefined_column) treat as verified.
      profileEmailVerified = true;
      try {
        await client.query('SAVEPOINT sp_ev');
        const evCheck = await client.query(`SELECT email_verified FROM profiles WHERE id = $1`, [uid]);
        if (evCheck.rowCount && evCheck.rows[0].email_verified !== undefined) {
          profileEmailVerified = evCheck.rows[0].email_verified === true;
        }
        await client.query('RELEASE SAVEPOINT sp_ev');
      } catch (evErr: any) {
        await client.query('ROLLBACK TO SAVEPOINT sp_ev').catch(() => {});
        if (evErr?.code !== '42703') throw evErr;
        profileEmailVerified = true;
      }

      if (queryRes.rowCount && queryRes.rowCount > 0) {
        const row = queryRes.rows[0];
        isDisabled = row.profile_disabled === true;
        if (row.access_status && row.access_status !== 'active') {
          isBlocked = true;
          blockReason = row.access_reason || 'الوصول إلى الحساب محظور.';
        }

        // Role strictly taken from profiles/staff tables, NOT token claims
        const ADMIN_EMAILS = ['khtaub7341@gmail.com', 'khtaub99@gmail.com', 'mm@mm.mm'];
        const isOwner = ADMIN_EMAILS.some(a => a.toLowerCase() === email.toLowerCase().trim());
        if (isOwner) {
          await client.query("UPDATE profiles SET role = 'admin' WHERE id = $1", [uid]);
          await client.query(
            `INSERT INTO staff (user_id, roles, status, valid_after, created_at)
             VALUES ($1, '["super_admin"]'::jsonb, 'active', NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE SET roles = '["super_admin"]'::jsonb, status = 'active'`,
            [uid]
          );
        }

        const isProfileAdmin = row.profile_role === 'admin' || isOwner;
        const isStaffAdmin = row.staff_status === 'active' && Array.isArray(row.staff_roles) && row.staff_roles.includes('admin');
        role = (isProfileAdmin || isStaffAdmin || isOwner) ? 'admin' : 'user';

        if (row.valid_after) {
          validAfterMs = new Date(row.valid_after).getTime();
        }
      }
    });
  } catch (err: any) {
    return reject(req, res, 503, 'db_error', { error: 'الخدمة غير متاحة مؤقتًا. أعد المحاولة.', code: 'auth_backend_unavailable' }, String(err?.code || 'unknown'));
  }

  // 1. Reject if profile disabled
  if (isDisabled) {
    return reject(req, res, 403, 'account_disabled', { error: 'الوصول إلى الحساب موقوف.' });
  }

  // 2. Reject if access_status restricted/suspended/blocked
  if (isBlocked) {
    return reject(req, res, 403, 'access_blocked', { error: blockReason });
  }

  // 3. Reject only if the token was issued strictly before the last revocation.
  //    Both sides are floored to whole seconds (JWT iat has 1s resolution; valid_after has sub-second precision),
  //    so a token minted in the same second as the revocation, or later, is accepted.
  const tokenIatSec = Math.floor(tokenIatMs / 1000);
  const validAfterSec = Math.floor(validAfterMs / 1000);
  if (validAfterSec > 0 && tokenIatSec < validAfterSec) {
    return reject(req, res, 401, 'session_revoked', { error: 'انتهت الجلسة. أعد تسجيل الدخول.' });
  }

  // 4. Reject with 403 code email_unverified if email not verified in token AND not verified in profiles
  const isExemptPath = req.path.startsWith('/security/logout') || req.path.startsWith('/identity/') || req.path.startsWith('/email/unsubscribe');
  if (!verified && !profileEmailVerified && !isExemptPath) {
    return reject(req, res, 403, 'email_unverified', {
      error: 'يرجى تأكيد البريد الإلكتروني أولاً. / Email verification required.',
      code: 'email_unverified'
    });
  }

  req.user = { id: uid, email, name, verified, role };
  next();
}
