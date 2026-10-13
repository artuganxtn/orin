import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { authMiddleware } from './auth-middleware.ts';
import { paymentsHandle } from './payments-http.ts';
import { programSummary, programAction, adminPrograms, accountActivity, getReferralsSummary } from './programs.ts';
import { action, state, verify } from './contracts.ts';
import { getSettings, saveSettings, configuration, saveConfiguration } from './settings.ts';
import { inbox, readNotices, listCampaigns, campaign } from './notifications.ts';
import {
  requestWithdrawal,
  getUserWithdrawals,
  getWithdrawalById,
  proposeWithdrawalApproval,
  approveWithdrawal,
  markWithdrawalPaid
} from './withdrawals.ts';
import { submitKyc, getKycStatus, verifyKycCustomer, listKycFiles, readKycFile } from './kyc.ts';
import { supportAssistantCapability, supportAssistantReply, escalateSupportTicket } from './support.ts';
import { operationQueues, readAudit, readTickets } from './control-operations.ts';
import { controlAction, controlRead } from './control-center.ts';
import { controlRbacMiddleware } from './control-rbac.ts';

import {
  getTradingAccounts,
  createTradingAccount,
  selectTradingAccount,
  getDemoWallet,
  operateDemoWallet,
  getSupportMessages,
  sendSupportMessage,
  attributeReferral
} from './client-services.ts';
import { withTx } from './db.ts';

export const app = express();

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Orin-Session', 'X-Nowpayments-Sig']
}));

// Body parser with raw body retention for webhooks
app.use(express.json({
  limit: '10mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  }
}));

// 1. Health checks
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, status: 'healthy', timestamp: Date.now() });
});

// Compression middleware
import compression from 'compression';
app.use(compression({ level: 6 }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, app: 'ORIN', backend: 'postgres', mode: 'production' });
});

import { identityHandle } from './email-registration-http.ts';

// 2. NOWPayments webhook & public payment endpoints
app.all('/api/payments/nowpayments/ipn', paymentsHandle);
app.get('/api/payments/readiness', paymentsHandle);

// Public identity & registration endpoints
app.use('/orinIdentity', identityHandle);
app.use('/api/identity', identityHandle);

// 3. Public market configuration
app.get('/api/markets/configuration', async (_req: Request, res: Response) => {
  try {
    res.json(await configuration());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Authenticated routes under /api
const api = express.Router();
api.use(authMiddleware);

// Payments (user authenticated)
api.use('/payments', paymentsHandle);

// Withdrawals
api.post('/withdrawals', async (req: Request, res: Response) => {
  try {
    const result = await requestWithdrawal(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/withdrawals', async (req: Request, res: Response) => {
  try {
    const result = await getUserWithdrawals(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

api.get('/withdrawals/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const result = await getWithdrawalById(req.user!, id);
    if (!result) {
      return res.status(404).json({ error: 'طلب السحب غير موجود' });
    }
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// KYC routes
api.post('/kyc', async (req: Request, res: Response) => {
  try {
    const result = await submitKyc(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/kyc', async (req: Request, res: Response) => {
  try {
    const result = await getKycStatus(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// Settings
api.get('/settings', async (req: Request, res: Response) => {
  try {
    const result = await getSettings(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

api.patch('/settings', async (req: Request, res: Response) => {
  try {
    const result = await saveSettings(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.patch('/markets/configuration', async (req: Request, res: Response) => {
  try {
    const result = await saveConfiguration(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Notifications
api.get('/notifications', async (req: Request, res: Response) => {
  try {
    const offset = Number(req.query.offset || 0);
    const key = req.query.id as string | undefined;
    const result = await inbox(req.user!, Date.now(), offset, key);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/notifications', async (req: Request, res: Response) => {
  try {
    const result = await readNotices(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/admin/notifications', async (req: Request, res: Response) => {
  try {
    const result = await listCampaigns(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/admin/notifications', async (req: Request, res: Response) => {
  try {
    const result = await campaign(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Programs & Referrals
api.get('/programs', async (req: Request, res: Response) => {
  try {
    const result = await programSummary(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/programs', async (req: Request, res: Response) => {
  try {
    const result = await programAction(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/referrals', async (req: Request, res: Response) => {
  try {
    const result = await getReferralsSummary(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/admin/programs', async (req: Request, res: Response) => {
  try {
    const result = await adminPrograms(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/admin/programs', async (req: Request, res: Response) => {
  try {
    const result = await adminPrograms(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Admin Users Directory & Management
api.get('/bootstrap', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const [settingsRes, stateRes, configRes, kycRes] = await Promise.all([
      getSettings(user),
      state(user),
      configuration(),
      getKycStatus(user)
    ]);

    const etag = 'W/"' + createHash('sha1').update(JSON.stringify({ settingsRes, stateRes, configRes, kycRes })).digest('hex') + '"';
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.set('ETag', etag);
    res.set('Cache-Control', 'private, no-cache');
    res.json({
      settings: settingsRes,
      state: stateRes,
      configuration: configRes,
      kyc: kycRes,
      timestamp: Date.now()
    });
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/admin/users', async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
    }
    const result = await withTx(async (client) => {
      const qRes = await client.query(
        `SELECT id as uid, email, display_name as "displayName", role, disabled, created_at as "createdAt"
         FROM profiles
         ORDER BY created_at DESC
         LIMIT 50`
      );
      return qRes.rows;
    });
    res.json({ users: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

api.patch('/admin/users/:id', async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
    }
    const { id } = req.params;
    const { displayName, role, disabled } = req.body;
    await withTx(async (client) => {
      await client.query(
        `UPDATE profiles
         SET display_name = COALESCE($1, display_name),
             role = COALESCE($2, role),
             disabled = COALESCE($3, disabled),
             updated_at = NOW()
         WHERE id = $4`,
        [displayName, role, disabled, id]
      );
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/account-activity', async (req: Request, res: Response) => {
  try {
    const result = await accountActivity(req.user!, String(req.query.accountId || ''));
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

// Trading Accounts
api.get('/trading-accounts', async (req: Request, res: Response) => {
  try {
    const result = await getTradingAccounts(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.post('/trading-accounts', async (req: Request, res: Response) => {
  try {
    const result = await createTradingAccount(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.patch('/trading-accounts', async (req: Request, res: Response) => {
  try {
    const result = await selectTradingAccount(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

// Demo Wallet
api.get('/demo-wallet', async (req: Request, res: Response) => {
  try {
    const accountId = String(req.query.accountId || '');
    const result = await getDemoWallet(req.user!, accountId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.post('/demo-wallet', async (req: Request, res: Response) => {
  try {
    const result = await operateDemoWallet(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

// Support Messages
api.get('/support/messages', async (req: Request, res: Response) => {
  try {
    const result = await getSupportMessages(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.post('/support/messages', async (req: Request, res: Response) => {
  try {
    const result = await sendSupportMessage(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

// Referral Code Attribution
api.post('/referrals/attribute', async (req: Request, res: Response) => {
  try {
    const result = await attributeReferral(req.user!, req.body?.code);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

// Published Content
api.get('/content/:slug', async (req: Request, res: Response) => {
  try {
    const result = await withTx(async (client) => {
      const docRes = await client.query('SELECT data FROM docs WHERE collection = $1 AND id = $2', ['public_content', req.params.slug]);
      return docRes.rows[0]?.data || null;
    });
    if (!result) return res.status(404).json({ error: 'Content not found' });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Contracts & Lab
api.get('/lab', async (req: Request, res: Response) => {
  try {
    const result = await state(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.post('/lab', async (req: Request, res: Response) => {
  try {
    const result = await action(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.post('/invitations/verify', async (req: Request, res: Response) => {
  try {
    const result = await verify(req.user!, req.body?.code);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

// Control Center endpoints & RBAC
api.use('/control', controlRbacMiddleware());
api.use('/admin', controlRbacMiddleware());

api.get('/control/session', async (req: Request, res: Response) => {
  try {
    res.json({
      id: 'session-' + req.user!.id,
      uid: req.user!.id,
      role: req.user!.role || 'admin',
      roles: ['admin', 'operations', 'compliance', 'finance'],
      status: 'active',
      createdAt: Date.now()
    });
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/control/queues', async (req: Request, res: Response) => {
  try {
    const result = await operationQueues(req.user!, (req.user as any).roles || []);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/control/audit', async (req: Request, res: Response) => {
  try {
    const result = await readAudit(req.user!, req.query);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/control/tickets', async (req: Request, res: Response) => {
  try {
    const result = await readTickets(req.user!, req.query);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.post('/control/action', async (req: Request, res: Response) => {
  try {
    const result = await controlAction(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/control/staff', async (req: Request, res: Response) => {
  try {
    const result = await controlRead(req.user!, 'staff');
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/control/kyc-detail', controlRbacMiddleware('kyc.documents'), async (req: Request, res: Response) => {
  try {
    const id = String(req.query.id || req.query.documentId || req.query.target || '');
    const reason = String(req.query.reason || 'Staff document inspection');
    const result = await readKycFile(req.user!, id, reason);
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/control/kyc-document', controlRbacMiddleware('kyc.documents'), async (req: Request, res: Response) => {
  try {
    const id = String(req.query.id || req.query.documentId || req.query.target || '');
    const reason = String(req.query.reason || 'Staff document inspection');
    const result = await readKycFile(req.user!, id, reason);

    if (req.headers.accept?.includes('image/') && result.documentImage?.startsWith('data:image/')) {
      const parts = result.documentImage.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
      const buf = Buffer.from(parts[1], 'base64');
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(buf);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/control/user', async (req: Request, res: Response) => {
  try {
    const uid = String(req.query.uid || req.query.id || '');
    const result = await withTx(async (client) => {
      const pRes = await client.query('SELECT * FROM profiles WHERE id = $1', [uid]);
      if (pRes.rowCount === 0) throw Object.assign(new Error('User not found'), { status: 404 });
      const p = pRes.rows[0];
      const accRes = await client.query('SELECT * FROM accounts WHERE user_id = $1', [uid]);
      return {
        id: p.id,
        uid: p.id,
        email: p.email,
        displayName: p.display_name,
        role: p.role,
        disabled: p.disabled,
        accounts: accRes.rows.map(a => ({
          id: a.id,
          type: a.type,
          balanceCents: Number(a.balance_cents),
          status: a.status
        }))
      };
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/control/:module', async (req: Request, res: Response) => {
  try {
    const moduleName = String(req.params.module || '');
    const result = await controlRead(req.user!, moduleName, req.query);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/experience/admin/users', async (req: Request, res: Response) => {
  try {
    const result = await withTx(async (client) => {
      const qRes = await client.query('SELECT id AS uid, display_name AS "displayName", email, role, disabled, created_at AS "createdAt" FROM profiles ORDER BY created_at DESC LIMIT 1000');
      return { users: qRes.rows.map(r => ({ ...r, createdAt: new Date(r.createdAt).getTime() })), truncated: false };
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/experience/admin/requests', async (req: Request, res: Response) => {
  try {
    res.json({ requests: [] });
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/experience/admin/audit', async (req: Request, res: Response) => {
  try {
    const result = await readAudit(req.user!, req.query);
    res.json({ events: result.rows });
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/admin/staff', async (req: Request, res: Response) => {
  try {
    const result = await controlRead(req.user!, 'staff');
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/admin/kyc/files', async (req: Request, res: Response) => {
  try {
    const result = await listKycFiles(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/admin/kyc/files/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const reason = String(req.query.reason || 'Staff audit review');
    const result = await readKycFile(req.user!, id, reason);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

// Experience routes
api.get('/experience/configuration', async (_req: Request, res: Response) => {
  try {
    const result = await withTx(async (client) => {
      const docRes = await client.query("SELECT data FROM docs WHERE collection = 'system' AND id = 'experience_configuration'");
      if (docRes.rowCount && docRes.rows[0].data) {
        return docRes.rows[0].data;
      }
      return {
        configuration: {
          maintenance: false,
          messageAr: 'نعمل على تحسين ORIN. حاول بعد قليل.',
          messageEn: 'ORIN is being updated. Please try again shortly.',
          welcomeAr: '',
          welcomeEn: '',
          supportEmail: ''
        },
        revision: 1
      };
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

api.patch('/experience/configuration', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  const config = req.body?.configuration;
  if (!config || typeof config !== 'object') return res.status(400).json({ error: 'إعدادات غير صالحة.' });
  try {
    const nextRevision = (Number(req.body?.revision) || 0) + 1;
    const payloadData = { configuration: config, revision: nextRevision };
    await withTx(async (client) => {
      await client.query(
        `INSERT INTO docs (collection, id, data, updated_at)
         VALUES ('system', 'experience_configuration', $1::jsonb, NOW())
         ON CONFLICT (collection, id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [JSON.stringify(payloadData)]
      );

      const auditPayload = JSON.stringify({ actorId: req.user!.id, action: 'experience_configuration_updated', revision: nextRevision });
      const auditHash = createHash('sha256').update(auditPayload).digest('hex');
      const refId = 'exp-cfg-' + Date.now() + '-' + randomUUID().slice(0, 8);
      await client.query(
        `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
         VALUES ($1, 'experience_configuration_updated', $2, $3::jsonb, $4)`,
        [req.user!.id, refId, auditPayload, auditHash]
      );
    });
    res.json(payloadData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/experience/profile', async (req: Request, res: Response) => {
  try {
    const result = await withTx(async (client) => {
      const pRes = await client.query('SELECT profile, created_at FROM profiles WHERE id = $1', [req.user!.id]);
      if (pRes.rowCount === 0) throw new Error('Profile not found');
      const row = pRes.rows[0];
      const docRes = await client.query("SELECT data FROM docs WHERE collection = 'avatars' AND id = $1", [req.user!.id]);
      const avatarData = docRes.rows[0]?.data;
      return {
        photo: avatarData?.photo || '',
        createdAt: new Date(row.created_at).getTime(),
        deletionRequested: row.profile?.closureStatus === 'requested',
        emailVerified: req.user!.verified
      };
    });
    res.json(result);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

api.post('/experience/avatar', async (req: Request, res: Response) => {
  const photo = String(req.body?.photo || '');
  if (photo.length > 60000) return res.status(400).json({ error: 'اختر صورة صالحة بحجم صغير.' });
  try {
    await withTx(async (client) => {
      await client.query(
        `INSERT INTO docs (collection, id, data, updated_at)
         VALUES ('avatars', $1, jsonb_build_object('photo', $2::text, 'updatedAt', extract(epoch from now())*1000), NOW())
         ON CONFLICT (collection, id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [req.user!.id, photo]
      );
    });
    res.json({ photo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

api.post('/experience/deletion-request', async (req: Request, res: Response) => {
  if (req.body?.confirmed !== true) return res.status(400).json({ error: 'أكّد الطلب أولًا.' });
  try {
    await withTx(async (client) => {
      await client.query(
        `UPDATE profiles
         SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{closureStatus}', '"requested"'),
             updated_at = NOW()
         WHERE id = $1`,
        [req.user!.id]
      );

      const auditPayload = JSON.stringify({ uid: req.user!.id, action: 'account_deletion_requested', timestamp: Date.now() });
      const auditHash = createHash('sha256').update(auditPayload).digest('hex');
      const refId = req.user!.id + '-del-' + Date.now();
      await client.query(
        `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
         VALUES ($1, 'account_deletion_requested', $2, $3::jsonb, $4)`,
        [req.user!.id, refId, auditPayload, auditHash]
      );
    });
    res.json({ requested: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/experience/admin/users', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  try {
    const users = await withTx(async (client) => {
      const qRes = await client.query(
        `SELECT id as uid, email, display_name as "displayName", role, disabled, created_at as "createdAt"
         FROM profiles
         ORDER BY created_at DESC
         LIMIT 100`
      );
      return qRes.rows.map(r => ({ ...r, createdAt: new Date(r.createdAt).getTime() }));
    });
    res.json({ users, truncated: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

api.patch('/experience/admin/user', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  const { uid, displayName, role, disabled } = req.body;
  await withTx(async (client) => {
    await client.query(
      `UPDATE profiles
       SET display_name = COALESCE($1, display_name),
           role = COALESCE($2, role),
           disabled = COALESCE($3, disabled),
           updated_at = NOW()
       WHERE id = $4`,
      [displayName, role, disabled, uid]
    );
  });
  res.json({ saved: true });
});

api.get('/experience/admin/audit', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  try {
    const events = await withTx(async (client) => {
      const qRes = await client.query(
        `SELECT id, actor_id as "actorId", action, reference, payload, created_at as "createdAt"
         FROM audit
         ORDER BY created_at DESC
         LIMIT 100`
      );
      return qRes.rows.map(r => ({ ...r, id: String(r.id), createdAt: new Date(r.createdAt).getTime() }));
    });
    res.json({ events });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/experience/admin/requests', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  try {
    const requests = await withTx(async (client) => {
      const qRes = await client.query(
        `SELECT id as uid, email, display_name as "displayName", created_at as "createdAt"
         FROM profiles
         WHERE profile->>'closureStatus' = 'requested'
         ORDER BY updated_at DESC
         LIMIT 100`
      );
      return qRes.rows.map(r => ({ ...r, createdAt: new Date(r.createdAt).getTime(), type: 'deletion', status: 'requested' }));
    });
    res.json({ requests });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

api.post('/admin/support/reply', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  const { uid, id, text } = req.body || {};
  if (!uid || !text) return res.status(400).json({ error: 'بيانات غير صالحة.' });
  const msgId = id || randomUUID();
  try {
    await withTx(async (client) => {
      const docRes = await client.query("SELECT data FROM docs WHERE collection = 'support_threads' AND id = $1 FOR UPDATE", [uid]);
      const thread = docRes.rows[0]?.data || { id: uid, messages: [], handoffRequested: false, updatedAt: Date.now() };
      thread.messages.push({
        id: msgId,
        text,
        senderId: req.user!.id,
        kind: 'staff',
        createdAt: Date.now()
      });
      thread.updatedAt = Date.now();
      await client.query(
        `INSERT INTO docs (collection, id, data, updated_at)
         VALUES ('support_threads', $1, $2, NOW())
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [uid, JSON.stringify(thread)]
      );

      const auditPayload = JSON.stringify({ actorId: req.user!.id, action: 'support_reply_sent', uid, msgId });
      const auditHash = createHash('sha256').update(auditPayload).digest('hex');
      const refId = uid + '-' + msgId;
      await client.query(
        `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
         VALUES ($1, 'support_reply_sent', $2, $3::jsonb, $4)`,
        [req.user!.id, refId, auditPayload, auditHash]
      );
    });
    res.json({ ok: true, messageId: msgId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/admin/support/threads', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  try {
    const threads = await withTx(async (client) => {
      const qRes = await client.query(
        `SELECT id, data, updated_at FROM docs WHERE collection = 'support_threads' ORDER BY updated_at DESC LIMIT 50`
      );
      return qRes.rows.map(r => ({
        id: r.id,
        updatedAt: new Date(r.updated_at).getTime(),
        handoffRequested: !!r.data?.handoffRequested
      }));
    });
    res.json({ threads });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Support AI & Ticket Escalation Routes
api.get('/support/assistant', async (req: Request, res: Response) => {
  try {
    const result = await supportAssistantCapability(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.post('/support/assistant', async (req: Request, res: Response) => {
  try {
    const result = await supportAssistantReply(req.user!, req.body || {});
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.post('/support/escalate', async (req: Request, res: Response) => {
  try {
    const result = await escalateSupportTicket(req.user!, req.body?.messageId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

// Mount /api
app.use('/api', api);

// 5. Unported routes under /api return 501
app.use('/api', (req: Request, res: Response) => {
  res.status(501).json({ error: 'Route not implemented on server yet', path: req.path });
});

// 6. Built web app as static files
const candidates = [
  resolve(process.cwd(), '../firebase-dist'),
  resolve(process.cwd(), '../firebase-web/dist'),
  resolve(process.cwd(), '../dist'),
  resolve(process.cwd(), 'public')
];
let staticPath = candidates.find(p => existsSync(p));
if (staticPath) {
  app.use(express.static(staticPath, {
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
    }
  }));
  app.use((req: Request, res: Response, next) => {
    if (req.path.startsWith('/api') || req.path === '/healthz') return next();
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.sendFile(resolve(staticPath!, 'index.html'));
  });
}

import { validateProductionEnv } from './env-validation.ts';
export { validateProductionEnv };

// Start server if executed directly
const PORT = Number(process.env.PORT || 10000);
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  validateProductionEnv();
  if (process.env.DATABASE_URL) {
    const { runMigrations } = await import('./migrate.ts');
    const migrationsDir = resolve(process.cwd(), '../migrations');
    if (existsSync(migrationsDir)) {
      runMigrations(process.env.DATABASE_URL, migrationsDir)
        .then(() => console.log('[DATABASE] All migrations verified and applied successfully.'))
        .catch(err => console.error('[DATABASE_MIGRATION_WARNING]', err.message));
    }
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ORIN Express backend running on http://0.0.0.0:${PORT}`);
  });
}

