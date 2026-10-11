import { randomUUID } from 'node:crypto';
import { withTx } from './db.ts';

export class ClientError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function newAccountNumber(): string {
  let digits = '';
  while (digits.length < 12) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    for (const byte of bytes) {
      if (byte >= 250 || (!digits.length && byte % 10 === 0)) continue;
      digits += String(byte % 10);
      if (digits.length === 12) break;
    }
  }
  return digits;
}

// 1. Trading Accounts
export async function getTradingAccounts(user: { id: string }, dbClient?: any) {
  const run = async (client: any) => {
    const accRes = await client.query(
      `SELECT id, account_number, type, currency, balance_cents, reserved_cents, realized_cents, created_at
       FROM accounts
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [user.id]
    );

    const profRes = await client.query(
      `SELECT preferences FROM profiles WHERE id = $1`,
      [user.id]
    );
    const prefs = profRes.rows[0]?.preferences || {};
    const savedActiveId = prefs.activeAccountId;

    const accounts = accRes.rows.map((row: any) => ({
      id: row.id,
      accountNumber: row.account_number,
      type: row.type,
      currency: row.currency,
      balanceCents: Number(row.balance_cents),
      reservedCents: Number(row.reserved_cents),
      realizedCents: Number(row.realized_cents),
      createdAt: new Date(row.created_at).getTime()
    }));

    const activeId = accounts.find((a: any) => a.id === savedActiveId)?.id || (accounts[0]?.id ?? '');
    return { accounts, activeId };
  };

  if (dbClient) return await run(dbClient);
  return await withTx(run);
}

export async function createTradingAccount(user: { id: string }, input: { id?: string; type?: string }) {
  const type = String(input.type || 'demo').toLowerCase();
  if (!['real', 'demo'].includes(type)) {
    throw new ClientError('نوع الحساب غير صالح. / Invalid account type.', 400);
  }

  const id = input.id || 'acc-' + randomUUID();

  return await withTx(async (client) => {
    // Generate unique account number
    let accountNumber = newAccountNumber();
    for (let i = 0; i < 5; i++) {
      const chk = await client.query('SELECT 1 FROM accounts WHERE account_number = $1', [accountNumber]);
      if (chk.rowCount === 0) break;
      accountNumber = newAccountNumber();
    }

    if (type === 'real') {
      const realChk = await client.query("SELECT id FROM accounts WHERE user_id = $1 AND type = 'real'", [user.id]);
      if (realChk.rowCount && realChk.rowCount > 0) {
        throw new ClientError('لديك حساب حقيقي بالفعل. / You already have a real account.', 409);
      }
    }

    await client.query(
      `INSERT INTO accounts (id, user_id, account_number, type, currency, status)
       VALUES ($1, $2, $3, $4, 'USD', 'active')`,
      [id, user.id, accountNumber, type]
    );

    return await getTradingAccounts(user, client);
  });
}

export async function selectTradingAccount(user: { id: string }, input: { id?: string }) {
  const selectedId = String(input.id || '').trim();
  if (!selectedId) {
    throw new ClientError('معرف الحساب مطلوب. / Account id required.', 400);
  }

  return await withTx(async (client) => {
    const chk = await client.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [selectedId, user.id]);
    if (chk.rowCount === 0) {
      throw new ClientError('الحساب غير متاح. / Account unavailable.', 404);
    }

    await client.query(
      `UPDATE profiles
       SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{activeAccountId}', to_jsonb($1::text)),
           updated_at = NOW()
       WHERE id = $2`,
      [selectedId, user.id]
    );

    return await getTradingAccounts(user, client);
  });
}

// 2. Demo Wallets
export async function getDemoWallet(user: { id: string }, accountId: string) {
  return await withTx(async (client) => {
    const accRes = await client.query(
      `SELECT id, user_id, type FROM accounts WHERE id = $1 AND user_id = $2`,
      [accountId, user.id]
    );
    if (accRes.rowCount === 0 || accRes.rows[0].type !== 'demo') {
      throw new ClientError('الحساب التجريبي غير موجود. / Demo account required.', 404);
    }

    const docRes = await client.query(
      `SELECT data FROM docs WHERE collection = 'demo_wallets' AND id = $1`,
      [accountId]
    );

    const data = docRes.rows[0]?.data || {
      wallet: {
        ownerId: user.id,
        accountId,
        currency: 'USD',
        futuresCents: 1000000,
        perpetualCents: 0,
        version: 1,
        updatedAt: Date.now()
      },
      operations: []
    };

    return data;
  });
}

export async function operateDemoWallet(
  user: { id: string },
  input: { accountId: string; requestId: string; kind: 'reset' | 'transfer'; amountCents?: number; from?: string }
) {
  const accountId = input.accountId;
  const requestId = input.requestId;
  const kind = input.kind;
  const amountCents = Number(input.amountCents || 0);

  if (!accountId || !requestId || !['reset', 'transfer'].includes(kind)) {
    throw new ClientError('بيانات العملية غير صالحة. / Invalid demo operation request.', 400);
  }

  return await withTx(async (client) => {
    const accRes = await client.query(
      `SELECT id, user_id, type FROM accounts WHERE id = $1 AND user_id = $2`,
      [accountId, user.id]
    );
    if (accRes.rowCount === 0 || accRes.rows[0].type !== 'demo') {
      throw new ClientError('الحساب التجريبي مطلوب. / Demo account required.', 404);
    }

    const docRes = await client.query(
      `SELECT data FROM docs WHERE collection = 'demo_wallets' AND id = $1 FOR UPDATE`,
      [accountId]
    );

    let state = docRes.rows[0]?.data || {
      wallet: {
        ownerId: user.id,
        accountId,
        currency: 'USD',
        futuresCents: 1000000,
        perpetualCents: 0,
        version: 1,
        updatedAt: Date.now()
      },
      operations: []
    };

    const existingOp = state.operations.find((o: any) => o.id === requestId);
    if (existingOp) {
      return state;
    }

    let nextFutures = state.wallet.futuresCents;
    let nextPerp = state.wallet.perpetualCents;

    if (kind === 'reset') {
      nextFutures = 1000000;
      nextPerp = 0;
    } else if (kind === 'transfer') {
      if (input.from === 'futures') {
        if (nextFutures < amountCents) throw new ClientError('الرصيد غير كافٍ للتحويل.', 400);
        nextFutures -= amountCents;
        nextPerp += amountCents;
      } else {
        if (nextPerp < amountCents) throw new ClientError('الرصيد غير كافٍ للتحويل.', 400);
        nextPerp -= amountCents;
        nextFutures += amountCents;
      }
    }

    const newOp = {
      id: requestId,
      kind,
      amountCents,
      from: kind === 'reset' ? 'reset' : input.from,
      to: kind === 'reset' ? 'futures' : (input.from === 'futures' ? 'perpetual' : 'futures'),
      afterFuturesCents: nextFutures,
      afterPerpetualCents: nextPerp,
      createdAt: Date.now()
    };

    state.wallet.futuresCents = nextFutures;
    state.wallet.perpetualCents = nextPerp;
    state.wallet.version += 1;
    state.wallet.updatedAt = Date.now();
    state.operations.unshift(newOp);
    if (state.operations.length > 50) state.operations.pop();

    await client.query(
      `INSERT INTO docs (collection, id, data, updated_at)
       VALUES ('demo_wallets', $1, $2, NOW())
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [accountId, JSON.stringify(state)]
    );

    return state;
  });
}

// 3. Support Messages
export async function getSupportMessages(user: { id: string }) {
  return await withTx(async (client) => {
    const docRes = await client.query(
      `SELECT data FROM docs WHERE collection = 'support_threads' AND id = $1`,
      [user.id]
    );
    const data = docRes.rows[0]?.data || {
      id: user.id,
      messages: [],
      handoffRequested: false,
      updatedAt: Date.now()
    };
    return data;
  });
}

export async function sendSupportMessage(user: { id: string }, input: { id?: string; text: string }) {
  const text = String(input.text || '').trim();
  if (!text) throw new ClientError('نص الرسالة مطلوب. / Message text required.', 400);
  const msgId = input.id || randomUUID();

  return await withTx(async (client) => {
    const docRes = await client.query(
      `SELECT data FROM docs WHERE collection = 'support_threads' AND id = $1 FOR UPDATE`,
      [user.id]
    );

    const thread = docRes.rows[0]?.data || {
      id: user.id,
      messages: [],
      handoffRequested: false,
      updatedAt: Date.now()
    };

    const exists = thread.messages.some((m: any) => m.id === msgId);
    if (!exists) {
      thread.messages.push({
        id: msgId,
        text,
        senderId: user.id,
        kind: 'customer',
        createdAt: Date.now()
      });
      thread.updatedAt = Date.now();

      await client.query(
        `INSERT INTO docs (collection, id, data, updated_at)
         VALUES ('support_threads', $1, $2, NOW())
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [user.id, JSON.stringify(thread)]
      );
    }

    return thread;
  });
}

// 4. Referral Code Attribution
export async function attributeReferral(user: { id: string }, code: string) {
  const normCode = String(code || '').trim().toUpperCase();
  if (!/^ORIN-[A-F0-9]{12}$/.test(normCode)) {
    throw new ClientError('كود الدعوة غير صالح. / Invalid referral code format.', 400);
  }

  return await withTx(async (client) => {
    const codeRes = await client.query('SELECT user_id FROM referral_codes WHERE code = $1', [normCode]);
    if (codeRes.rowCount === 0) {
      throw new ClientError('كود الدعوة غير موجود. / Referral code not found.', 404);
    }
    if (codeRes.rows[0].user_id === user.id) {
      throw new ClientError('لا يمكنك استخدام كود الدعوة الخاص بك. / Cannot attribute own code.', 400);
    }

    const referrerUserId = codeRes.rows[0].user_id;
    await client.query(
      `INSERT INTO referral_attributions (user_id, referral_code, referrer_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id, normCode, referrerUserId]
    );

    return { ok: true, referralCode: normCode };
  });
}
