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

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'سجّل الدخول للمتابعة.' });
  }

  const token = authHeader.slice(7);
  try {
    let uid: string;
    let email: string;
    let name: string = 'مستخدم ORIN';
    let verified: boolean = true;
    let role: string = 'user';

    // Test auth bypass ONLY when NODE_ENV === 'test'
    if (process.env.NODE_ENV === 'test' && token.startsWith('test-token-')) {
      const parts = token.split(':');
      uid = parts[0].replace('test-token-', '');
      email = parts[1] || `${uid}@orin.top`;
      role = parts[2] || (uid.includes('admin') ? 'admin' : 'user');
      name = parts[3] || uid;
    } else {
      // All other environments: verify with firebase-admin verifyIdToken ONLY
      const decoded = await adminAuth.verifyIdToken(token, true);
      uid = decoded.uid;
      email = decoded.email || `${uid}@orin.top`;
      name = typeof decoded.name === 'string' ? decoded.name : 'مستخدم ORIN';
      verified = decoded.email_verified === true;
      role = (decoded as any).admin || (decoded as any).role === 'admin' ? 'admin' : 'user';
    }

    // Create the profiles row on first request (and ensure active real account exists)
    await withTx(async (client) => {
      await client.query(
        `INSERT INTO profiles (id, email, display_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
        [uid, email, name, role]
      );

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
           ON CONFLICT (id) DO NOTHING`,
          [accId, uid, accNum]
        );
      }
    });

    req.user = { id: uid, email, name, verified, role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'انتهت جلسة الدخول. سجّل الدخول مجددًا.' });
  }
}
