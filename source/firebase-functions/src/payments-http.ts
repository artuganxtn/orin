import type { Request, Response } from 'express';
import { NowPayments } from './nowpayments.ts';
import { paymentService, ApiError, type Identity } from './payments.ts';
import { PAYMENT_COINS } from '../../lib/payments';

const defaultOrigins = [
  'https://orin-trader.top',
  'https://www.orin-trader.top',
  'https://orin-99951.web.app',
  'https://orin-99951.firebaseapp.com',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost'
];

function getAllowedOrigins() {
  const list = [...defaultOrigins];
  if (process.env.ALLOWED_ORIGINS) list.push(...process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()));
  return list;
}

export async function paymentsHandle(req: Request, res: Response) {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');

  try {
    const origin = req.get('origin');
    const allowed = getAllowedOrigins();
    if (origin) {
      if (!allowed.includes(origin) && !(process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
        throw new ApiError('مصدر الطلب غير مسموح.', 403);
      }
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Orin-Session');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    const keyVal = process.env.ORIN_NOWPAYMENTS_API_KEY || '';
    const secretVal = process.env.ORIN_NOWPAYMENTS_IPN_SECRET || '';
    const callback = process.env.ORIN_PAYMENTS_CALLBACK_URL || 'https://api.orin.trade/api/payments/nowpayments/ipn';

    const service = paymentService(new NowPayments(keyVal, callback), secretVal);

    if (req.method === 'POST' && (!req.body || typeof req.body !== 'object')) {
      throw new ApiError('بيانات طلب غير صالحة.');
    }

    const fullPath = (req.originalUrl || req.url || req.path).split('?')[0];
    const subPath = req.path.split('?')[0];
    const isPath = (target: string) => fullPath === target || subPath === target || fullPath.endsWith(target) || subPath.endsWith(target);

    if (isPath('/nowpayments/ipn') && req.method === 'POST') {
      res.json(await service.webhook(req.body, req.get('x-nowpayments-sig') ?? ''));
      return;
    }

    const enabled = process.env.ORIN_DEPOSITS_ENABLED === 'true' && !!keyVal && !!secretVal;
    if (req.method === 'GET' && isPath('/readiness')) {
      res.json({
        provider: 'ORIN Pay',
        deposits: enabled,
        withdrawals: false,
        coins: PAYMENT_COINS,
        ...(!enabled ? { reason: 'activation_pending' } : {})
      });
      return;
    }

    // Get user from req.user (set by auth middleware)
    const user: Identity = (req as any).user;
    if (!user || !user.id) {
      throw new ApiError('سجّل الدخول للمتابعة.', 401);
    }

    if (req.method === 'POST' && isPath('/deposits')) {
      if (!enabled) throw new ApiError('الإيداع بانتظار إكمال إعداد الخدمة.', 503);
      res.json(await service.create(user, req.body));
      return;
    }

    if (req.method === 'GET' && isPath('/deposits')) {
      res.json({ items: await service.list(user, String(req.query.accountId ?? '')) });
      return;
    }

    const match = fullPath.match(/deposits\/(np-[a-f0-9]{64})$/) || subPath.match(/deposits\/(np-[a-f0-9]{64})$/);
    if (req.method === 'GET' && match) {
      res.json(await service.get(user, match[1], req.query.refresh === 'true'));
      return;
    }

    throw new ApiError('المسار غير متاح.', 404);
  } catch (error: any) {
    const status = error instanceof ApiError ? error.status : typeof error?.status === 'number' ? error.status : 503;
    const message = error instanceof ApiError ? error.message : typeof error?.message === 'string' && error.message ? error.message : 'تعذر الاتصال بخدمة الدفع. راجع حالة الطلب ثم أعد المحاولة.';
    res.status(status).json({ error: message });
  }
}
