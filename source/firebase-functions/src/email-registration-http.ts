import { adminAuth } from './firebase-admin-init.ts';
import { emailRegistration, RegistrationError } from './email-registration.ts';
import { sendOtpEmail, sendWelcomeEmail } from './email-service.ts';

const defineSecret = (name: string) => ({ value: () => process.env[name] || '' });
const defineString = (name: string, opts?: { default?: string }) => ({ value: () => process.env[name] || opts?.default || '' });

const key = defineSecret('ORIN_MAIL_API_KEY');
const pepper = defineSecret('ORIN_EMAIL_CODE_SECRET');
const from = defineString('ORIN_MAIL_FROM', { default: '' });
const enabled = defineString('ORIN_EMAIL_CODES_ENABLED', { default: 'true' });

export let lastTestOtp: { email: string; code: string; challengeId: string } | null = null;

const defaultOrigins = [
  'https://orin-trader.top',
  'https://www.orin-trader.top',
  'https://orin-99951.web.app',
  'https://orin-99951.firebaseapp.com'
];

function getAllowedOrigins() {
  const list = [...defaultOrigins];
  if (process.env.ALLOWED_ORIGINS) {
    list.push(...process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()));
  }
  return list;
}

export async function identityHandle(req: any, res: any) {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  try {
    const origin = req.get('origin');
    const allowed = getAllowedOrigins();
    if (
      origin &&
      !allowed.includes(origin) &&
      !(
        process.env.NODE_ENV === 'test' ||
        (process.env.FUNCTIONS_EMULATOR === 'true' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      )
    ) {
      throw new RegistrationError('origin-denied', 403);
    }
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    const getKey = () => {
      try {
        return key.value() || process.env.ORIN_MAIL_API_KEY || process.env.SMTP_PASS || process.env.TITAN_PASSWORD || (process.env.NODE_ENV === 'test' ? 'test_mail_key' : '');
      } catch {
        return process.env.ORIN_MAIL_API_KEY || process.env.SMTP_PASS || process.env.TITAN_PASSWORD || (process.env.NODE_ENV === 'test' ? 'test_mail_key' : '');
      }
    };
    const getPepper = () => {
      try {
        return pepper.value() || process.env.ORIN_EMAIL_CODE_SECRET || (process.env.NODE_ENV === 'test' ? 'test_pepper_0123456789abcdef0123456789abcdef' : '');
      } catch {
        return process.env.ORIN_EMAIL_CODE_SECRET || (process.env.NODE_ENV === 'test' ? 'test_pepper_0123456789abcdef0123456789abcdef' : '');
      }
    };
    const getFrom = () => {
      try {
        return from.value() || process.env.ORIN_MAIL_FROM || process.env.SMTP_USER || 'support@javl900.com';
      } catch {
        return process.env.ORIN_MAIL_FROM || process.env.SMTP_USER || 'support@javl900.com';
      }
    };
    const getEnabled = () => {
      try {
        return enabled.value() || process.env.ORIN_EMAIL_CODES_ENABLED || 'true';
      } catch {
        return process.env.ORIN_EMAIL_CODES_ENABLED || 'true';
      }
    };

    const keyVal = getKey();
    const pepperVal = getPepper();
    const fromVal = getFrom();
    const enabledVal = getEnabled();

    if (enabledVal !== 'true' || !keyVal || pepperVal.length < 32 || !fromVal) {
      throw new RegistrationError('service-unavailable', 503);
    }
    if (req.method !== 'POST') throw new RegistrationError('method-not-allowed', 405);
    if (!req.is('application/json') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Buffer.byteLength(JSON.stringify(req.body)) > 4000) {
      throw new RegistrationError('invalid-input');
    }

    const authClient = (process.env.NODE_ENV === 'test') ? {
      createUser: async ({ email, displayName }: any) => ({
        uid: 'fb-user-' + Buffer.from(email).toString('hex').slice(0, 12),
        email,
        displayName
      }),
      createCustomToken: async (uid: string) => `firebase-custom-token-for-${uid}`
    } : adminAuth;

    const service = emailRegistration(authClient as any, pepperVal, async ({ to, code, challengeId }) => {
      if (process.env.NODE_ENV === 'test') {
        lastTestOtp = { email: to, code, challengeId };
        (globalThis as any).__lastTestOtp = lastTestOtp;
        return;
      }
      try {
        await sendOtpEmail(to, code, challengeId);
      } catch (err) {
        console.warn('[Mail] Titan SMTP failed, checking fallback:', err);
        if (keyVal && keyVal.startsWith('re_')) {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + keyVal,
              'Content-Type': 'application/json',
              'Idempotency-Key': 'orin-code/' + challengeId
            },
            body: JSON.stringify({
              from: fromVal,
              to: [to],
              subject: 'ORIN - رمز التحقق',
              text: `رمز التحقق لإنشاء حساب ORIN: ${code}\nينتهي خلال 10 دقائق. لا تشارك الرمز مع أي شخص.\nYour ORIN verification code: ${code}. Expires in 10 minutes.`,
              html: `<div dir="rtl" style="font-family:Arial,sans-serif;background:#040812;padding:32px;color:#fff"><h1 style="color:#00d2ff">ORIN</h1><h2>تأكيد بريدك الإلكتروني</h2><p>رمز إنشاء الحساب الخاص بك</p><div dir="ltr" style="font-size:36px;letter-spacing:8px;background:#030712;border:2px solid #00d2ff;border-radius:16px;padding:20px;text-align:center;color:#00f2fe">${code}</div><p>صالح لمدة 10 دقائق. لا تشارك الرمز مع أي شخص.</p></div>`
            }),
            signal: AbortSignal.timeout(12000),
            redirect: 'error'
          });
          if (!response.ok) throw new Error('Mail provider unavailable');
        } else {
          throw err;
        }
      }
    });

    const p = req.path || '';
    if (p === '/send-code' || p.endsWith('/send-code')) {
      res.json(await service.send(req.body, req.ip || 'unknown'));
      return;
    }
    if (p === '/register' || p.endsWith('/register')) {
      const result = await service.register(req.body);
      if (req.body?.email && req.body?.name && process.env.NODE_ENV !== 'test') {
        sendWelcomeEmail(req.body.email, req.body.name).catch(e => console.warn('[Mail] Welcome notice:', e));
      }
      res.json(result);
      return;
    }
    if (p === '/test-mail' || p.endsWith('/test-mail')) {
      const testTo = req.body?.to || fromVal;
      await sendOtpEmail(testTo, '789012', 'test-challenge');
      res.json({ ok: true, sentTo: testTo });
      return;
    }
    throw new RegistrationError('not-found', 404);
  } catch (error) {
    res.status(error instanceof RegistrationError ? error.status : 503).json({
      code: error instanceof RegistrationError ? error.code : 'service-unavailable'
    });
  }
}

export const orinIdentity = identityHandle;

