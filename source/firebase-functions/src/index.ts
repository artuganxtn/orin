import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { authMiddleware } from './auth-middleware.ts';
import { paymentsHandle } from './payments-http.ts';
import { programSummary, programAction, adminPrograms, accountActivity } from './programs.ts';
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
import { operationQueues, readAudit, readTickets } from './control-operations.ts';
import { controlAction, controlRead } from './control-center.ts';

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
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/withdrawals', async (req: Request, res: Response) => {
  try {
    const result = await getUserWithdrawals(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// KYC routes
api.post('/kyc', async (req: Request, res: Response) => {
  try {
    const result = await submitKyc(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/kyc', async (req: Request, res: Response) => {
  try {
    const result = await getKycStatus(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Settings
api.get('/settings', async (req: Request, res: Response) => {
  try {
    const result = await getSettings(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
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
    const result = await programSummary(req.user!);
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
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Trading Accounts
api.get('/trading-accounts', async (req: Request, res: Response) => {
  try {
    const result = await getTradingAccounts(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/trading-accounts', async (req: Request, res: Response) => {
  try {
    const result = await createTradingAccount(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.patch('/trading-accounts', async (req: Request, res: Response) => {
  try {
    const result = await selectTradingAccount(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Demo Wallet
api.get('/demo-wallet', async (req: Request, res: Response) => {
  try {
    const accountId = String(req.query.accountId || '');
    const result = await getDemoWallet(req.user!, accountId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/demo-wallet', async (req: Request, res: Response) => {
  try {
    const result = await operateDemoWallet(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Support Messages
api.get('/support/messages', async (req: Request, res: Response) => {
  try {
    const result = await getSupportMessages(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/support/messages', async (req: Request, res: Response) => {
  try {
    const result = await sendSupportMessage(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Referral Code Attribution
api.post('/referrals/attribute', async (req: Request, res: Response) => {
  try {
    const result = await attributeReferral(req.user!, req.body?.code);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
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
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/lab', async (req: Request, res: Response) => {
  try {
    const result = await action(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/invitations/verify', async (req: Request, res: Response) => {
  try {
    const result = await verify(req.user!, req.body?.code);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Control Center endpoints
api.get('/control/queues', async (req: Request, res: Response) => {
  try {
    const result = await operationQueues(req.user!, (req.user as any).roles || []);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/control/audit', async (req: Request, res: Response) => {
  try {
    const result = await readAudit(req.user!, req.query);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/control/tickets', async (req: Request, res: Response) => {
  try {
    const result = await readTickets(req.user!, req.query);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/control/action', async (req: Request, res: Response) => {
  try {
    const result = await controlAction(req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/control/staff', async (req: Request, res: Response) => {
  try {
    const result = await controlRead(req.user!, 'staff');
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/admin/staff', async (req: Request, res: Response) => {
  try {
    const result = await controlRead(req.user!, 'staff');
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/admin/kyc/files', async (req: Request, res: Response) => {
  try {
    const result = await listKycFiles(req.user!);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get('/admin/kyc/files/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const reason = String(req.query.reason || 'Staff audit review');
    const result = await readKycFile(req.user!, id, reason);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Experience routes
api.get('/experience/configuration', async (_req: Request, res: Response) => {
  res.json({
    configuration: {
      maintenance: false,
      messageAr: 'نعمل على تحسين ORIN. حاول بعد قليل.',
      messageEn: 'ORIN is being updated. Please try again shortly.',
      welcomeAr: '',
      welcomeEn: '',
      supportEmail: ''
    },
    revision: 1
  });
});

api.patch('/experience/configuration', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  res.json({ configuration: req.body?.configuration, revision: (req.body?.revision || 0) + 1 });
});

api.get('/experience/profile', async (req: Request, res: Response) => {
  res.json({
    photo: '',
    createdAt: Date.now(),
    deletionRequested: false,
    emailVerified: true
  });
});

api.post('/experience/avatar', async (req: Request, res: Response) => {
  res.json({ photo: req.body?.photo || '' });
});

api.post('/experience/deletion-request', async (req: Request, res: Response) => {
  res.json({ requested: true });
});

api.get('/experience/admin/users', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
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
  res.json({ events: [] });
});

api.get('/experience/admin/requests', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  res.json({ requests: [] });
});

api.post('/admin/support/reply', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  res.json({ ok: true });
});

api.get('/admin/support/threads', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة.' });
  res.json({ threads: [] });
});

// Support AI deprecated routes return 501
api.all('/support/assistant', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Support AI is deprecated and not implemented on server' });
});
api.all('/support/escalate', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Support AI is deprecated and not implemented on server' });
});
api.all('/admin/support-ai', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Support AI is deprecated and not implemented on server' });
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
  app.use(express.static(staticPath));
  app.use((req: Request, res: Response, next) => {
    if (req.path.startsWith('/api') || req.path === '/healthz') return next();
    res.sendFile(resolve(staticPath!, 'index.html'));
  });
}

import { validateProductionEnv } from './env-validation.ts';
export { validateProductionEnv };

// Start server if executed directly
const PORT = Number(process.env.PORT || 10000);
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  validateProductionEnv();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ORIN Express backend running on http://0.0.0.0:${PORT}`);
  });
}

