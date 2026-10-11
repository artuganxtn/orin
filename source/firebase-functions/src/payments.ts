import { withTx } from './db.ts';
import { recordConfirmedDeposit } from './program-ingestion.ts';
import { NowPayments, providerId, units, validIpn } from './nowpayments.ts';
import { PAYMENT_COINS, type DepositView, type DepositStatus } from '../../lib/payments';
import { createHash } from 'node:crypto';
import { requireVerifiedKyc } from './kyc.ts';

export type Data = Record<string, any>;
export interface Identity {
  id: string;
  name?: string;
  email?: string;
  verified?: boolean;
}

export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');

const safeId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new ApiError('معرّف الحساب غير صالح.');
  return value;
};

const depositView = (d: Data): DepositView => ({
  id: d.id,
  accountId: d.account_id ?? d.accountId,
  amountCents: Number(d.amount_cents ?? d.amountCents),
  coin: d.coin,
  status: d.status,
  paymentId: d.payment_id ?? d.paymentId ?? null,
  address: d.pay_address ?? d.address ?? null,
  payAmount: d.pay_amount ? String(d.pay_amount) : (d.payAmount ? String(d.payAmount) : null),
  extraId: d.extra_id ?? d.extraId ?? null,
  credited: !!d.credited,
  createdAt: d.created_at ? new Date(d.created_at).getTime() : d.createdAt
});

const states = new Set(['waiting', 'confirming', 'confirmed', 'sending', 'finished', 'partially_paid', 'failed', 'refunded', 'expired']);

export function paymentService(provider: Pick<NowPayments, 'create' | 'get'>, ipnSecret: string) {
  async function create(u: Identity, input: Data): Promise<DepositView> {
    const accountId = safeId(input.accountId);
    const requestId = safeId(input.requestId);
    const amountCents = input.amountCents;
    const coin = input.coin;

    if (
      Object.keys(input).some(k => !['accountId', 'requestId', 'amountCents', 'coin'].includes(k)) ||
      !Number.isSafeInteger(amountCents) ||
      amountCents < 100000 ||
      amountCents > 10000000 ||
      !PAYMENT_COINS.some(c => c.id === coin)
    ) {
      throw new ApiError('الحد الأدنى للإيداع 1,000 دولار أمريكي. تحقق من المبلغ والعملة.');
    }

    const id = 'np-' + hash(u.id + ':' + requestId);
    const fingerprint = hash(JSON.stringify({ accountId, amountCents, coin }));

    const existing = await withTx(async (client) => {
      // 1. Check user profile & access
      const profRes = await client.query('SELECT disabled FROM profiles WHERE id = $1', [u.id]);
      if (profRes.rows.length === 0 || profRes.rows[0].disabled) throw new ApiError('الحساب موقوف.', 403);

      const gateRes = await client.query('SELECT status FROM access_status WHERE user_id = $1', [u.id]);
      if (gateRes.rows[0]?.status === 'suspended' || gateRes.rows[0]?.status === 'restricted') {
        throw new ApiError('الحساب موقوف.', 403);
      }

      await requireVerifiedKyc(u, client);

      // 2. Check real USD account
      const accRes = await client.query('SELECT * FROM accounts WHERE user_id = $1 AND id = $2', [u.id, accountId]);
      const a = accRes.rows[0];
      if (!a || a.type !== 'real' || a.currency !== 'USD') throw new ApiError('الإيداع متاح للحساب الحقيقي فقط.', 403);
      if (a.status === 'restricted') throw new ApiError('الحساب المالي مقيّد.', 403);

      // 3. Check existing deposit
      const oldRes = await client.query('SELECT * FROM deposits WHERE id = $1', [id]);
      if (oldRes.rows.length > 0) {
        const old = oldRes.rows[0];
        if (Number(old.amount_cents) !== amountCents || old.coin !== coin || old.account_id !== accountId) {
          throw new ApiError('تغيّرت تفاصيل طلب الدفع. افتح طلبًا جديدًا.', 409);
        }
        return old;
      }

      // 4. Rate limiting (window 30 min, max 5)
      const rateRes = await client.query('SELECT window_start, count FROM deposit_rate_limits WHERE user_id = $1', [u.id]);
      const now = new Date();
      if (rateRes.rows.length > 0) {
        const r = rateRes.rows[0];
        const winStart = new Date(r.window_start).getTime();
        if (now.getTime() - winStart < 1800000) {
          if (r.count >= 5) {
            throw new ApiError('توجد طلبات دفع حديثة. راجع سجل الإيداع قبل إنشاء طلب آخر.', 429);
          }
          await client.query('UPDATE deposit_rate_limits SET count = count + 1, updated_at = NOW() WHERE user_id = $1', [u.id]);
        } else {
          await client.query('UPDATE deposit_rate_limits SET window_start = NOW(), count = 1, updated_at = NOW() WHERE user_id = $1', [u.id]);
        }
      } else {
        await client.query('INSERT INTO deposit_rate_limits (user_id, window_start, count) VALUES ($1, NOW(), 1)', [u.id]);
      }

      // 5. Insert deposit row
      const insRes = await client.query(
        `INSERT INTO deposits (id, user_id, account_id, amount_cents, coin, status, credited, credited_cents)
         VALUES ($1, $2, $3, $4, $5, 'waiting', false, 0)
         RETURNING *`,
        [id, u.id, accountId, amountCents, coin]
      );

      // Record command for idempotency
      await client.query(
        `INSERT INTO commands (fingerprint, action, result)
         VALUES ($1, 'deposit_create', $2::jsonb)
         ON CONFLICT (fingerprint) DO NOTHING`,
        [fingerprint, JSON.stringify({ id, accountId, amountCents, coin })]
      );

      const payload = JSON.stringify({ accountId, amountCents, coin });
      await client.query(
        `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
         VALUES ($1, 'DEPOSIT_REQUESTED', $2, $3::jsonb, $4)
         ON CONFLICT (action, reference) DO NOTHING`,
        [u.id, id, payload, hash(payload)]
      );

      return null;
    });

    if (existing) return depositView(existing);

    try {
      const payment = await provider.create(id, amountCents, coin);
      await reconcile(id, payment, false);
    } catch (error) {
      await withTx(async (client) => {
        await client.query(
          "UPDATE deposits SET status = 'review', updated_at = NOW() WHERE id = $1 AND status = 'waiting'",
          [id]
        );
      });
      console.error('ORIN payment create failed', { orderId: id, code: error instanceof ApiError ? error.status : 'network' });
    }

    const finalRow = await withTx(async (client) => {
      const r = await client.query('SELECT * FROM deposits WHERE id = $1', [id]);
      return r.rows[0];
    });
    return depositView(finalRow);
  }

  async function reconcile(id: string, payment: Data, allowCredit = true) {
    const safeOrderId = safeId(id);
    const pid = providerId(payment.payment_id);

    const d = await withTx(async (client) => {
      const rRes = await client.query('SELECT * FROM deposits WHERE id = $1', [safeOrderId]);
      if (rRes.rows.length === 0) throw new ApiError('Unknown payment order', 404);
      const row = rRes.rows[0];

      if (
        payment.order_id !== safeOrderId ||
        payment.price_currency !== 'usd' ||
        payment.pay_currency !== row.coin ||
        units(payment.price_amount, 2) !== BigInt(row.amount_cents) ||
        (row.payment_id && pid !== row.payment_id) ||
        payment.parent_payment_id
      ) {
        throw new ApiError('Payment does not match the stored order', 409);
      }

      const status: DepositStatus = states.has(payment.payment_status) ? payment.payment_status : 'review';
      if (typeof payment.pay_address !== 'string' || !/^[a-zA-Z0-9:_-]{12,256}$/.test(payment.pay_address) || units(payment.pay_amount) <= BigInt(0)) {
        throw new ApiError('Invalid payment destination', 502);
      }

      // Check payment_ids
      const pIdRes = await client.query('SELECT deposit_id FROM payment_ids WHERE payment_id = $1', [pid]);
      if (pIdRes.rows.length > 0 && pIdRes.rows[0].deposit_id !== safeOrderId) {
        throw new ApiError('Payment identity conflict', 409);
      }

      await client.query(
        `INSERT INTO payment_ids (payment_id, deposit_id)
         VALUES ($1, $2)
         ON CONFLICT (payment_id) DO NOTHING`,
        [pid, safeOrderId]
      );

      const reversal = row.credited && ['refunded', 'failed', 'partially_paid'].includes(status);
      if (reversal) {
        await client.query(
          `INSERT INTO payment_reviews (id, deposit_id, user_id, reason, status)
           VALUES ($1, $2, $3, 'provider_reversal_after_credit', 'pending')
           ON CONFLICT (id) DO NOTHING`,
          [pid, safeOrderId, row.user_id]
        );
      }

      await client.query(
        `UPDATE deposits
         SET payment_id = $1, pay_address = $2, pay_amount = $3, extra_id = $4, status = $5, updated_at = NOW()
         WHERE id = $6`,
        [pid, payment.pay_address, String(payment.pay_amount ?? ''), payment.payin_extra_id ?? payment.extra_id ?? null, reversal ? 'review' : (row.credited ? 'finished' : status), safeOrderId]
      );

      return row;
    });

    const status: DepositStatus = states.has(payment.payment_status) ? payment.payment_status : 'review';

    if (allowCredit && status === 'finished') {
      const expected = units(payment.pay_amount);
      let paid: bigint | null = null;
      try {
        const raw = payment.actually_paid != null ? payment.actually_paid : payment.amount_received;
        if (raw != null) paid = units(raw);
      } catch {}

      const profRes = await withTx(async (client) => {
        const pr = await client.query('SELECT disabled FROM profiles WHERE id = $1', [d.user_id]);
        const gr = await client.query('SELECT status FROM access_status WHERE user_id = $1', [d.user_id]);
        return { disabled: pr.rows[0]?.disabled, suspended: gr.rows[0]?.status === 'suspended' };
      });

      if (paid === null || paid * 1000n < expected * 995n || profRes.disabled || profRes.suspended) {
        await withTx(async (client) => {
          const fresh = await client.query('SELECT credited FROM deposits WHERE id = $1', [safeOrderId]);
          if (!fresh.rows[0]?.credited) {
            await client.query(
              "UPDATE deposits SET status = 'review', review_reason = $1, updated_at = NOW() WHERE id = $2",
              [paid === null || paid * 1000n < expected * 995n ? 'amount_mismatch' : 'account_restricted', safeOrderId]
            );
            await client.query(
              `INSERT INTO payment_reviews (id, deposit_id, user_id, reason, status)
               VALUES ($1, $2, $3, 'amount_mismatch', 'pending')
               ON CONFLICT (id) DO NOTHING`,
              [pid, safeOrderId, d.user_id]
            );
          }
        });
        return;
      }

      // Authoritative credit
      const creditedCents = Math.min(Number(d.amount_cents), Math.floor(Number((BigInt(d.amount_cents) * paid) / expected)));

      await recordConfirmedDeposit({
        eventId: 'nowpayments-' + pid,
        uid: d.user_id,
        accountId: d.account_id,
        currency: 'USD',
        cents: creditedCents,
        eligible: true,
        depositId: safeOrderId
      });

      await withTx(async (client) => {
        await client.query(
          "UPDATE deposits SET status = 'finished', credited = true, credited_cents = $1, confirmed_at = NOW(), updated_at = NOW() WHERE id = $2",
          [creditedCents, safeOrderId]
        );
      });
    }
  }

  async function get(u: Identity, id: string, refresh = false): Promise<DepositView> {
    const safeOrderId = safeId(id);
    const row = await withTx(async (client) => {
      const res = await client.query('SELECT * FROM deposits WHERE id = $1', [safeOrderId]);
      if (res.rows.length === 0 || res.rows[0].user_id !== u.id) throw new ApiError('طلب الدفع غير متاح.', 404);
      return res.rows[0];
    });

    if (refresh && row.payment_id && !row.credited) {
      const payment = await provider.get(row.payment_id);
      await reconcile(safeOrderId, payment);
      const refreshed = await withTx(async (client) => {
        const res = await client.query('SELECT * FROM deposits WHERE id = $1', [safeOrderId]);
        return res.rows[0];
      });
      return depositView(refreshed);
    }

    return depositView(row);
  }

  async function list(u: Identity, accountId: string): Promise<DepositView[]> {
    safeId(accountId);
    return withTx(async (client) => {
      const accRes = await client.query('SELECT id FROM accounts WHERE user_id = $1 AND id = $2', [u.id, accountId]);
      if (accRes.rows.length === 0) throw new ApiError('الحساب غير متاح.', 404);

      const depRes = await client.query(
        'SELECT * FROM deposits WHERE user_id = $1 AND account_id = $2 ORDER BY created_at DESC LIMIT 20',
        [u.id, accountId]
      );
      return depRes.rows.map(depositView);
    });
  }

  async function webhook(body: Data, signature: string) {
    if (!validIpn(body, signature, ipnSecret)) {
      throw new ApiError('Invalid payment notification signature', 401);
    }
    const id = safeId(body.order_id);
    if (!id.startsWith('np-')) throw new ApiError('Unknown payment order', 404);

    let current = body;
    try {
      const fetched = await provider.get(providerId(body.payment_id));
      if (fetched && fetched.payment_id) {
        if (providerId(fetched.payment_id) !== providerId(body.payment_id)) {
          throw new ApiError('Payment identity mismatch', 409);
        }
        current = fetched;
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      current = body;
    }
    await reconcile(id, current);
    return { ok: true };
  }

  return { create, get, list, webhook };
}
