import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
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
import { controlRbacMiddleware, checkControlPermission } from './control-rbac.ts';

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
app.set('trust proxy', 1);

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

import { processEmailOutboxOnce, verifyMailConnectionAtStartup } from './mail/transport.ts';
import { processSchedulerSlotsOnce } from './scheduler.ts';
import { processTelegramOutboxOnce } from './telegram.ts';

// Start email outbox worker interval in web process
setInterval(() => void processEmailOutboxOnce().catch(() => {}), 5000);

// Start trade slot scheduler interval (runs every 30s to evaluate daily schedule by time)
setInterval(() => void processSchedulerSlotsOnce().catch((err) => {
  if (process.env.NODE_ENV !== 'test') console.warn('[SCHEDULER_INTERVAL_WARN]', err?.message || err);
}), 30000);

// Start telegram outbox dispatcher interval (runs every 5s to deliver queued trade signals)
setInterval(() => void processTelegramOutboxOnce().catch((err) => {
  if (process.env.NODE_ENV !== 'test') console.warn('[TELEGRAM_OUTBOX_INTERVAL_WARN]', err?.message || err);
}), 5000);

void verifyMailConnectionAtStartup().catch((err) => {
  console.warn('[MAIL_STARTUP_VERIFY_WARN]', err?.message || err);
});

// 1. Health checks
app.get('/healthz', async (_req: Request, res: Response) => {
  try {
    const outboxCheck = await withTx(async (client) => {
      const qRes = await client.query(`
        SELECT COUNT(*) AS queued,
               EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::INT AS oldest_sec
        FROM email_outbox
        WHERE status IN ('queued', 'sending')
      `);
      return {
        queued: Number(qRes.rows[0]?.queued || 0),
        oldestQueuedSec: Number(qRes.rows[0]?.oldest_sec || 0)
      };
    });
    res.status(200).json({ ok: true, status: 'healthy', timestamp: Date.now(), outbox: outboxCheck });
  } catch {
    res.status(200).json({ ok: true, status: 'healthy', timestamp: Date.now(), outbox: { queued: 0, oldestQueuedSec: 0 } });
  }
});

// Compression middleware
import compression from 'compression';
app.use(compression({ level: 6 }));

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const stats = await withTx(async (client) => {
      const qRes = await client.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('queued', 'sending'))::INT AS queued,
          COUNT(*) FILTER (WHERE status = 'failed')::INT AS failed,
          COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status IN ('queued', 'sending'))))::INT, 0) AS oldest_sec
        FROM email_outbox
      `);
      const row = qRes.rows[0];
      return {
        queueDepth: Number(row?.queued || 0),
        oldestQueuedAge: Number(row?.oldest_sec || 0),
        failedCount: Number(row?.failed || 0)
      };
    });
    res.status(200).json({
      ok: true,
      app: 'ORIN',
      backend: 'postgres',
      mode: process.env.NODE_ENV || 'production',
      outbox: stats,
      queueDepth: stats.queueDepth,
      oldestQueuedAge: stats.oldestQueuedAge,
      failedCount: stats.failedCount
    });
  } catch {
    res.status(200).json({
      ok: true,
      app: 'ORIN',
      backend: 'postgres',
      mode: process.env.NODE_ENV || 'production',
      queueDepth: 0,
      oldestQueuedAge: 0,
      failedCount: 0
    });
  }
});

import { identityHandle } from './email-registration-http.ts';

// 2. NOWPayments webhook & public payment endpoints
app.all('/api/payments/nowpayments/ipn', paymentsHandle);
app.get('/api/payments/readiness', paymentsHandle);

// Public identity & registration endpoints
app.use('/orinIdentity', identityHandle);
app.use('/api/identity', identityHandle);

// Password Reset Routes (Public)
app.post('/api/auth/reset/start', async (req: Request, res: Response) => {
  res.set('Cache-Control', 'private, no-store');
  const sameResponse = {
    ok: true,
    message: 'إذا كان البريد مسجّلاً، فستصلك رسالة تحتوي على رمز إعادة تعيين كلمة المرور.'
  };

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn(`[AUTH_RESET_START] reason=invalid_email_format`);
    return res.json(sameResponse);
  }

  const secret = process.env.ORIN_EMAIL_CODE_SECRET || process.env.ORIN_SECURITY_MASTER_KEY || 'orin_email_code_secure_secret_pepper_2026';

  try {
    const { createOtpChallenge } = await import('./otp.js');
    const { enqueueEmail, processEmailOutboxOnce } = await import('./mail/transport.js');
    const { adminAuth } = await import('./firebase-admin-init.js');

    let codeToSend = '';
    let challengeId = '';

    await withTx(async (client) => {
      let userId = '';
      const pRes = await client.query('SELECT id, email, disabled FROM profiles WHERE LOWER(TRIM(email)) = $1', [email]);
      if (pRes.rows && pRes.rows.length > 0) {
        if (pRes.rows[0].disabled) {
          console.warn(`[AUTH_RESET_START] reason=user_disabled email=${email}`);
          return;
        }
        userId = pRes.rows[0].id;
      } else {
        // Fallback to Firebase Auth for users without profiles row
        let fbUser: any = null;
        try {
          fbUser = await adminAuth.getUserByEmail(email);
        } catch (fbErr: any) {
          console.warn(`[AUTH_RESET_START] reason=unknown_email email=${email} fbErr=${fbErr?.message || fbErr}`);
          return;
        }
        if (fbUser.disabled) {
          console.warn(`[AUTH_RESET_START] reason=fb_user_disabled email=${email}`);
          return;
        }
        userId = fbUser.uid;
        await client.query(
          `INSERT INTO profiles (id, email, display_name, role)
           VALUES ($1, $2, $3, 'user')
           ON CONFLICT (id) DO NOTHING`,
          [userId, email, fbUser.displayName || 'مستخدم ORIN']
        );
        console.log(`[AUTH_RESET_START] reason=profile_backfilled uid=${userId} email=${email}`);
      }

      // Single client, single transaction for challenge and outbox enqueue
      const challenge = await createOtpChallenge(email, 'password_reset', secret, req.ip || 'unknown', userId, undefined, client);
      codeToSend = challenge.code;
      challengeId = challenge.challengeId;
      await enqueueEmail(email, 'password_reset_code', 'ar', { code: challenge.code }, `reset:${challenge.challengeId}`, client);
      console.log(`[AUTH_RESET_START] reason=challenge_enqueued challengeId=${challenge.challengeId}`);
    });

    if (codeToSend) {
      try {
        const { renderEmailTemplate } = await import('./mail/templates.js');
        const { sendMailDirect } = await import('./mail/transport.js');
        const rendered = renderEmailTemplate('password_reset_code', 'ar', { code: codeToSend });
        const sendRes = await sendMailDirect(
          email,
          rendered.subject,
          rendered.html,
          rendered.text,
          { id: challengeId, template: 'password_reset_code', locale: 'ar', payload: { code: codeToSend } }
        );
        if (sendRes.ok) {
          const pool = (await import('./db.js')).getPool();
          await pool.query(
            `UPDATE email_outbox SET status = 'sent', sent_at = NOW(), attempts = attempts + 1 WHERE dedupe_key = $1`,
            [`reset:${challengeId}`]
          );
          console.log(`[AUTH_RESET_START] reason=email_sent_direct to=${email}`);
        } else {
          console.warn(`[AUTH_RESET_START] reason=direct_send_failed to=${email} err=${sendRes.error}`);
        }
      } catch (dispErr: any) {
        console.error(`[AUTH_RESET_START] reason=immediate_dispatch_failed`, dispErr?.message || dispErr);
      }
    }

    res.json(sameResponse);
  } catch (err: any) {
    if (err?.code === 'cooldown-active') {
      console.warn(`[AUTH_RESET_START] reason=cooldown_active email=${email}`);
      res.set('Retry-After', '60');
      return res.json(sameResponse);
    }
    if (err?.code === 'too-many-requests') {
      console.warn(`[AUTH_RESET_START] reason=rate_limited email=${email}`);
      res.set('Retry-After', '3600');
      return res.json(sameResponse);
    }
    console.error(`[AUTH_RESET_START] reason=internal_error error=${err?.message || err}`);
    res.json(sameResponse);
  }
});

app.post('/api/auth/reset/confirm', async (req: Request, res: Response) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!email || !code || !/^\d{6}$/.test(code) || newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'البيانات المدخلة غير صحيحة.', code: 'invalid-input' });
    }

    const secret = process.env.ORIN_EMAIL_CODE_SECRET || process.env.ORIN_SECURITY_MASTER_KEY || 'orin_email_code_secure_secret_pepper_2026';

    const { OtpError, computeOtpHmac } = await import('./otp.js');
    const { enqueueEmail } = await import('./mail/transport.js');
    const { adminAuth } = await import('./firebase-admin-init.js');

    const { getPool, withTx } = await import('./db.js');
    const pool = getPool();

    let uid = '';
    let challengeId = '';

    // Step 1: Verify code server-side finding newest unconsumed challenge
    const cRes = await pool.query(
      `SELECT * FROM otp_challenges
       WHERE LOWER(email) = LOWER($1) AND purpose = 'password_reset' AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    const c = cRes.rows[0];
    if (!c) {
      throw new OtpError('code-invalid', 400);
    }

    if (new Date(c.expires_at).getTime() <= Date.now()) {
      throw new OtpError('code-expired', 400);
    }

    if (c.attempts >= c.max_attempts) {
      throw new OtpError('code-locked', 400);
    }

    const actualHmac = computeOtpHmac(secret, c.id, email, code);
    const match = timingSafeEqual(Buffer.from(actualHmac, 'hex'), Buffer.from(c.code_hmac, 'hex'));

    if (!match) {
      const updated = await pool.query(
        `UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts, max_attempts`,
        [c.id]
      );
      const attempts = updated.rows[0]?.attempts || (c.attempts + 1);
      const maxAttempts = c.max_attempts || 5;
      const remaining = Math.max(0, maxAttempts - attempts);
      if (attempts >= maxAttempts) {
        throw new OtpError('code-locked', 400);
      }
      const err = new OtpError('code-invalid', 400) as any;
      err.attemptsLeft = remaining;
      throw err;
    }

    challengeId = c.id;
    uid = c.user_id || '';

    // Step 2: Validate password strength (same rule as signup: min 8, max 128)
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.', code: 'weak-password' });
    }

    if (!uid) {
      const fbUser = await adminAuth.getUserByEmail(email);
      uid = fbUser.uid;
    }

    // Step 3: Firebase updateUser (Firebase failure must not burn the code)
    await adminAuth.updateUser(uid, { password: newPassword });
    await adminAuth.revokeRefreshTokens(uid).catch(() => {});

    // Step 4: Consume challenge, revoke sessions, and enqueue password_changed
    await withTx(async (client) => {
      await client.query(`UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1`, [challengeId]);
      await client.query(
        `INSERT INTO session_revocations (user_id, valid_after, updated_at) VALUES ($1, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET valid_after = NOW(), updated_at = NOW()`,
        [uid]
      );

      const payload = JSON.stringify({ uid, email, action: 'PASSWORD_RESET_COMPLETED' });
      await client.query(
        `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
         VALUES ($1, 'PASSWORD_RESET_COMPLETED', $2, $3::jsonb, $4)
         ON CONFLICT DO NOTHING`,
        [uid, challengeId, payload, createHash('sha256').update(payload).digest('hex')]
      );

      await enqueueEmail(email, 'password_changed', 'ar', {}, `pass-change:${challengeId}`, client);
    });

    res.json({ ok: true, message: 'تم تغيير كلمة المرور وإبطال الجلسات بنجاح.' });
  } catch (err: any) {
    const code = err?.code || 'service-unavailable';
    const status = err?.status || (code === 'code-invalid' || code === 'code-expired' || code === 'code-locked' || code === 'weak-password' ? 400 : 500);
    res.status(status).json({
      error: err.message || 'تعذر تغيير كلمة المرور.',
      code,
      ...(err.attemptsLeft !== undefined ? { attemptsLeft: err.attemptsLeft } : {})
    });
  }
});

// Admin Mail Test Endpoint
app.post('/api/admin/mail/test', authMiddleware, async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required', code: 'forbidden' });
  }

  if (process.env.NODE_ENV === 'production' && process.env.ORIN_MAIL_DEBUG !== 'true') {
    return res.status(403).json({ error: 'Endpoint disabled in production without ORIN_MAIL_DEBUG=true', code: 'disabled' });
  }

  const to = String(req.body?.to || req.user.email || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'Valid recipient email required', code: 'invalid_recipient' });
  }

  const { sendMailDirect } = await import('./mail/transport.js');
  const result = await sendMailDirect(
    to,
    'ORIN SMTP Verification Test',
    '<div style="font-family:sans-serif;padding:20px;"><h2>ORIN Test Email</h2><p>This is a test email sent from the ORIN admin panel to verify SMTP transport connectivity.</p></div>',
    'ORIN Test Email: SMTP transport connectivity verified.'
  );

  res.json(result);
});

// 3. Public market configuration & feeds
app.get('/api/markets/configuration', async (_req: Request, res: Response) => {
  try {
    res.json(await configuration());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3b. Public market proxy & quote feed (ensures clients behind ISP crypto blocks always receive live data)
const marketQuoteCache = new Map<string, { expires: number; data: any }>();
const marketCandleCache = new Map<string, { expires: number; data: any }>();

app.get('/api/market/quote', async (req: Request, res: Response) => {
  const pair = String(req.query.pair || 'BTC-USD').toUpperCase();
  const cached = marketQuoteCache.get(pair);
  if (cached && cached.expires > Date.now()) {
    return res.json(cached.data);
  }

  const cleanPair = pair.replace('-', '').toLowerCase();
  const binanceSymbol = pair.replace('-USD', 'USDT').replace('-', '');

  // 1. Try Binance
  try {
    const bRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`, { signal: AbortSignal.timeout(3500) }).catch(() => null);
    if (bRes && bRes.ok) {
      const bData = (await bRes.json()) as any;
      const price = Number(bData.lastPrice);
      const open = Number(bData.openPrice);
      const high = Number(bData.highPrice);
      const low = Number(bData.lowPrice);
      const volume = Number(bData.volume);
      const asOf = Number(bData.closeTime) || Date.now();
      const quote = {
        pair,
        price,
        open,
        high,
        low,
        volume,
        change: Number(bData.priceChangePercent) || ((price / open - 1) * 100),
        fetchedAt: Date.now(),
        asOf,
        source: 'Binance'
      };
      marketQuoteCache.set(pair, { expires: Date.now() + 3000, data: quote });
      return res.json(quote);
    }
  } catch {}

  // 2. Try Bitstamp
  try {
    const bsRes = await fetch(`https://www.bitstamp.net/api/v2/ticker/${cleanPair}/`, { signal: AbortSignal.timeout(3500) }).catch(() => null);
    if (bsRes && bsRes.ok) {
      const bsData = (await bsRes.json()) as any;
      const price = Number(bsData.last);
      const open = Number(bsData.open_24);
      const high = Number(bsData.high);
      const low = Number(bsData.low);
      const volume = Number(bsData.volume);
      const asOf = Number(bsData.timestamp) * 1000 || Date.now();
      const quote = {
        pair,
        price,
        open,
        high,
        low,
        volume,
        change: (price / open - 1) * 100,
        fetchedAt: Date.now(),
        asOf,
        source: 'Bitstamp'
      };
      marketQuoteCache.set(pair, { expires: Date.now() + 3000, data: quote });
      return res.json(quote);
    }
  } catch {}

  // 3. Try Coinbase
  try {
    const cbRes = await fetch(`https://api.exchange.coinbase.com/products/${pair}/stats`, { signal: AbortSignal.timeout(3500) }).catch(() => null);
    if (cbRes && cbRes.ok) {
      const cbData = (await cbRes.json()) as any;
      const price = Number(cbData.last);
      const open = Number(cbData.open);
      const high = Number(cbData.high);
      const low = Number(cbData.low);
      const volume = Number(cbData.volume);
      const quote = {
        pair,
        price,
        open,
        high,
        low,
        volume,
        change: (price / open - 1) * 100,
        fetchedAt: Date.now(),
        asOf: Date.now(),
        source: 'Coinbase Exchange'
      };
      marketQuoteCache.set(pair, { expires: Date.now() + 3000, data: quote });
      return res.json(quote);
    }
  } catch {}

  res.status(503).json({ error: 'Market feed unavailable' });
});

app.get('/api/market/candles', async (req: Request, res: Response) => {
  const pair = String(req.query.pair || 'BTC-USD').toUpperCase();
  const cached = marketCandleCache.get(pair);
  if (cached && cached.expires > Date.now()) {
    return res.json(cached.data);
  }

  const cleanPair = pair.replace('-', '').toLowerCase();
  const binanceSymbol = pair.replace('-USD', 'USDT').replace('-', '');

  try {
    const bRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=15m&limit=96`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (bRes && bRes.ok) {
      const klines = (await bRes.json()) as any[];
      const points = klines.map((k: any) => ({
        at: Math.floor(Number(k[0]) / 900000) * 900000,
        price: Number(k[4])
      }));
      const windowEnd = Math.floor(Date.now() / 900000) * 900000;
      const result = {
        pair,
        source: 'Binance',
        points,
        windowEnd,
        receivedAt: Date.now()
      };
      marketCandleCache.set(pair, { expires: Date.now() + 60000, data: result });
      return res.json(result);
    }
  } catch {}

  try {
    const bsRes = await fetch(`https://www.bitstamp.net/api/v2/ohlc/${cleanPair}/?step=900&limit=96&exclude_current_candle=true`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (bsRes && bsRes.ok) {
      const bsData = (await bsRes.json()) as any;
      const ohlc = bsData?.data?.ohlc || [];
      const points = ohlc.map((k: any) => ({
        at: Number(k.timestamp) * 1000,
        price: Number(k.close)
      }));
      const windowEnd = Math.floor(Date.now() / 900000) * 900000;
      const result = {
        pair,
        source: 'Bitstamp',
        points,
        windowEnd,
        receivedAt: Date.now()
      };
      marketCandleCache.set(pair, { expires: Date.now() + 60000, data: result });
      return res.json(result);
    }
  } catch {}

  res.status(503).json({ error: 'Candles unavailable' });
});

app.get('/api/market/proxy', async (req: Request, res: Response) => {
  const pair = String(req.query.pair || 'BTC-USD');
  const endpoint = String(req.query.endpoint || '/ticker');
  try {
    const cbRes = await fetch('https://api.exchange.coinbase.com/products/' + pair + endpoint, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
    if (!cbRes.ok) return res.status(cbRes.status).json({ error: 'Upstream error' });
    const data = await cbRes.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// Public published content (banner, terms, etc.)
app.get('/api/content/:slug', async (req: Request, res: Response) => {
  try {
    const result = await withTx(async (client) => {
      const docRes = await client.query('SELECT data FROM docs WHERE collection = $1 AND id = $2', ['public_content', req.params.slug]);
      return docRes.rows[0]?.data || null;
    });
    res.json(result || { slug: req.params.slug, status: 'empty' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Direct mobile downloads (Android APK & Apple iOS WebClip profile)
// Direct mobile downloads (Android APK & Apple iOS WebClip profile)
app.get(['/downloads/orin.apk', '/downloads/ORIN-Android-1.6.2.apk', '/orin.apk'], (_req: Request, res: Response) => {
  const candidates = [
    resolve(process.cwd(), 'source/firebase-dist/downloads/ORIN-Android-1.6.2.apk'),
    resolve(process.cwd(), 'source/public/downloads/ORIN-Android-1.6.2.apk'),
    resolve(process.cwd(), 'source/firebase-dist/downloads/orin.apk'),
    resolve(process.cwd(), 'source/public/downloads/orin.apk'),
    resolve(process.cwd(), 'firebase-dist/downloads/ORIN-Android-1.6.2.apk'),
    resolve(process.cwd(), 'public/downloads/ORIN-Android-1.6.2.apk'),
    resolve(process.cwd(), 'downloads/ORIN-Android-1.6.2.apk'),
    resolve(process.cwd(), 'ORIN-Android-1.6.2-Live.apk'),
    resolve(process.cwd(), 'deliverables/ORIN-Android-1.6.2.apk'),
    resolve(process.cwd(), '../firebase-dist/downloads/ORIN-Android-1.6.2.apk'),
    resolve(process.cwd(), '../public/downloads/ORIN-Android-1.6.2.apk'),
    resolve(process.cwd(), '../deliverables/ORIN-Android-1.6.2.apk'),
    resolve(__dirname, '../../firebase-dist/downloads/ORIN-Android-1.6.2.apk'),
    resolve(__dirname, '../../public/downloads/ORIN-Android-1.6.2.apk'),
    resolve(__dirname, '../../../public/downloads/ORIN-Android-1.6.2.apk')
  ];
  const found = candidates.find(p => existsSync(p));
  if (found) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="ORIN-Android-1.6.2.apk"');
    return res.sendFile(found);
  }
  res.status(404).type('text/plain').send('APK file not found on server.');
});

app.get(['/orin.mobileconfig', '/app.mobileconfig', '/downloads/orin.mobileconfig'], (_req: Request, res: Response) => {
  const candidates = [
    resolve(process.cwd(), 'source/firebase-dist/orin.mobileconfig'),
    resolve(process.cwd(), 'source/public/orin.mobileconfig'),
    resolve(process.cwd(), 'firebase-dist/orin.mobileconfig'),
    resolve(process.cwd(), 'public/orin.mobileconfig'),
    resolve(process.cwd(), '../firebase-dist/orin.mobileconfig'),
    resolve(process.cwd(), '../public/orin.mobileconfig'),
    resolve(__dirname, '../../firebase-dist/orin.mobileconfig'),
    resolve(__dirname, '../../public/orin.mobileconfig'),
    resolve(__dirname, '../../../public/orin.mobileconfig')
  ];
  const found = candidates.find(p => existsSync(p));
  if (found) {
    res.setHeader('Content-Type', 'application/x-apple-aspen-config');
    res.setHeader('Content-Disposition', 'attachment; filename="orin.mobileconfig"');
    return res.sendFile(found);
  }
  res.status(404).type('text/plain').send('iOS configuration profile not found.');
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
      const chRes = await client.query(
        "SELECT id, data, updated_at FROM docs WHERE collection = 'orinEmailChallenges' AND LOWER(data->>'email') = LOWER($1) ORDER BY updated_at DESC LIMIT 1",
        [p.email]
      ).catch(() => ({ rows: [] }));
      const pendingChallenge = chRes.rows[0]?.data;
      return {
        id: p.id,
        uid: p.id,
        email: p.email,
        displayName: p.display_name,
        role: p.role,
        disabled: p.disabled,
        emailVerified: !!p.email_verified,
        pendingOtp: pendingChallenge ? {
          code: pendingChallenge.code || null,
          adminVerified: !!pendingChallenge.admin_verified,
          used: !!pendingChallenge.used,
          expiresAt: pendingChallenge.expiresAtMs
        } : null,
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

api.get('/control/session', async (req: Request, res: Response) => {
  try {
    const permCheck = await checkControlPermission(req.user!.id);
    if (!permCheck.allowed) {
      return res.status(403).json({ error: 'غير مصرح بالدخول لمركز التحكم.' });
    }
    res.json({
      available: true,
      uid: req.user!.id,
      roles: permCheck.roles,
      permissions: permCheck.permissions,
      reauthSeconds: 300,
      capabilities: {
        payments: true,
        execution: true,
        kycDocuments: true,
        push: true,
        scheduler: true
      }
    });
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post('/control/action', async (req: Request, res: Response) => {
  try {
    const permCheck = await checkControlPermission(req.user!.id);
    if (!permCheck.allowed) {
      return res.status(403).json({ error: 'صلاحيات الإدارة غير كافية.' });
    }
    const result = await controlAction(req.user!, req.body || {});
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

api.get('/control/:module', async (req: Request, res: Response) => {
  try {
    const moduleName = String(req.params.module || '');
    const permCheck = await checkControlPermission(req.user!.id);
    if (!permCheck.allowed) {
      return res.status(403).json({ error: 'غير مصرح بالدخول لمركز التحكم.' });
    }
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
  resolve(process.cwd(), 'source/firebase-dist'),
  resolve(process.cwd(), 'firebase-dist'),
  resolve(__dirname, '../../firebase-dist'),
  resolve(process.cwd(), '../firebase-dist'),
  resolve(process.cwd(), '../firebase-web/dist'),
  resolve(process.cwd(), '../dist'),
  resolve(process.cwd(), 'dist'),
  resolve(process.cwd(), 'public'),
  resolve(process.cwd(), 'source/public')
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

