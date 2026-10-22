import { randomUUID } from 'node:crypto';
import { withTx } from './db.ts';
import { notifyTransferCompleted } from './notifications.ts';
import { loadContractWallet, saveContractWallet, challengeInfo, readBalanceCents } from './wallet-ledger.ts';

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
      `SELECT id, account_number, type, currency, balance_cents, reserved_cents, realized_cents, bonus_profit_cents, created_at
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

    const accounts = await Promise.all(accRes.rows.map(async (row: any) => {
      let settledPnl = 0;
      let dailyProfitCents = 0;
      try {
        const sRes = await client.query(
          `SELECT
             COALESCE(SUM(result_cents), 0) AS total_settled,
             COALESCE(SUM(CASE WHEN COALESCE(settled_at, ends_at) >= NOW() - INTERVAL '24 hours' THEN result_cents ELSE 0 END), 0) AS daily_settled
           FROM positions WHERE user_id = $1 AND (account_id = $2 OR account_id IS NULL) AND status = 'settled'`,
          [user.id, row.id]
        );
        settledPnl = Number(sRes.rows[0]?.total_settled || 0);
        dailyProfitCents = Number(sRes.rows[0]?.daily_settled || 0);
      } catch {
        settledPnl = 0;
        dailyProfitCents = 0;
      }
      const bonusProfit = Number(row.bonus_profit_cents || 0);
      const accRealized = Number(row.realized_cents || 0);
      const realizedCents = settledPnl !== 0 ? (settledPnl + bonusProfit) : (accRealized !== 0 ? accRealized : bonusProfit);
      return {
        id: row.id,
        accountNumber: row.account_number,
        type: row.type,
        currency: row.currency,
        balanceCents: Number(row.balance_cents),
        reservedCents: Number(row.reserved_cents),
        realizedCents,
        dailyProfitCents,
        createdAt: new Date(row.created_at).getTime()
      };
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

// 2. Demo & Contract Wallets
export async function getDemoWallet(user: { id: string }, accountId: string) {
  return await withTx(async (client) => {
    const accRes = await client.query(
      `SELECT id, user_id, type, balance_cents FROM accounts WHERE id = $1 AND user_id = $2`,
      [accountId, user.id]
    );
    if (accRes.rowCount === 0) {
      throw new ClientError('الحساب غير موجود. / Account not found.', 404);
    }

    const acc = accRes.rows[0];
    const isReal = acc.type === 'real';

    if (isReal) {
      const { state } = await loadContractWallet(client, accountId, user.id, acc.balance_cents, false);
      const challenge = await challengeInfo(client, user.id);
      return { ...state, challenge };
    }

    // Demo Account wallet
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
    throw new ClientError('بيانات العملية غير صالحة. / Invalid transfer operation request.', 400);
  }

  return await withTx(async (client) => {
    const accRes = await client.query(
      `SELECT id, user_id, type, balance_cents FROM accounts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [accountId, user.id]
    );
    if (accRes.rowCount === 0) {
      throw new ClientError('الحساب غير موجود. / Account not found.', 404);
    }

    const acc = accRes.rows[0];
    const isReal = acc.type === 'real';

    if (isReal && kind === 'reset') {
      throw new ClientError('لا يمكن إعادة تعيين الحساب الحقيقي. / Cannot reset real account.', 400);
    }

    if (isReal) {
      const { state } = await loadContractWallet(client, accountId, user.id, acc.balance_cents, true);

      const existingOp = state.operations.find((o: any) => o.id === requestId);
      if (existingOp) {
        const challenge = await challengeInfo(client, user.id);
        return { ...state, challenge };
      }

      if (amountCents <= 0) {
        throw new ClientError('يرجى إدخال مبلغ تحويل صالح أكبر من الصفر. / Please enter a valid transfer amount.', 400);
      }

      const curFutures = state.wallet.futuresCents;
      const curPerp = state.wallet.perpetualCents;
      let feeCents = 0;
      let feeRate = 0;
      let netAmountCents = amountCents;

      if (input.from === 'futures') {
        if (curFutures < amountCents) {
          throw new ClientError('الرصيد المتاح في العقود الآجلة غير كافٍ للتحويل. / Insufficient available balance in futures.', 400);
        }
        // Funding trading wallet is always 100% free with 0% fee
        feeRate = 0;
        feeCents = 0;
        netAmountCents = amountCents;
        state.wallet.perpetualCents = curPerp + amountCents;
        state.wallet.futuresCents = curFutures - amountCents;
      } else {
        if (curPerp < amountCents) {
          throw new ClientError('الرصيد المتاح في العقود الدائمة غير كافٍ للتحويل. / Insufficient available balance in perpetual.', 400);
        }

        // Early transfer from Perpetual Trading to Withdrawable Futures (20% fee if before 29 days)
        const challenge = await challengeInfo(client, user.id);
        if (challenge.isBefore29Days) {
          feeRate = 0.20;
          feeCents = Math.round(amountCents * 0.20);
          netAmountCents = amountCents - feeCents;
        } else {
          feeRate = 0;
          feeCents = 0;
          netAmountCents = amountCents;
        }

        // Deduct early exit fee from accounts cash ledger so total wallet cents match account balance cents
        if (feeCents > 0) {
          const jnlId = 'jnl-fee-' + randomUUID();
          await client.query(
            `INSERT INTO journals (id, kind, reference, created_at) VALUES ($1, 'early_exit_fee', $2, NOW())`,
            [jnlId, requestId]
          );
          await client.query(
            `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
             ($1, $2, $3, 'cash', $4),
             ($1, NULL, NULL, 'system:early-exit-fee', $5)`,
            [jnlId, user.id, accountId, -feeCents, feeCents]
          );
        }

        // Post-fee balance
        const balanceAfter = await readBalanceCents(client, accountId);
        state.wallet.perpetualCents = curPerp - amountCents;
        state.wallet.futuresCents = Math.max(0, balanceAfter - state.wallet.perpetualCents);
      }

      const newOp = {
        id: requestId,
        kind: 'transfer',
        amountCents,
        feeCents,
        feeRate,
        netAmountCents,
        from: input.from,
        to: input.from === 'futures' ? 'perpetual' : 'futures',
        afterFuturesCents: state.wallet.futuresCents,
        afterPerpetualCents: state.wallet.perpetualCents,
        createdAt: Date.now()
      };
      state.operations.unshift(newOp);
      await saveContractWallet(client, accountId, user.id, state);

      await notifyTransferCompleted(client, {
        userId: user.id,
        amountCents,
        feeCents,
        netAmountCents,
        from: input.from || 'futures',
        to: input.from === 'futures' ? 'perpetual' : 'futures'
      });

      const updatedChallenge = await challengeInfo(client, user.id);
      return { ...state, challenge: updatedChallenge };
    }

    // Demo account logic
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
    if (existingOp) return state;

    if (kind === 'reset') {
      state.wallet.futuresCents = 1000000;
      state.wallet.perpetualCents = 0;
    } else {
      if (amountCents <= 0) throw new ClientError('يرجى إدخال مبلغ صالح.', 400);
      if (input.from === 'futures') {
        if (state.wallet.futuresCents < amountCents) throw new ClientError('الرصيد غير كافٍ.', 400);
        state.wallet.futuresCents -= amountCents;
        state.wallet.perpetualCents += amountCents;
      } else {
        if (state.wallet.perpetualCents < amountCents) throw new ClientError('الرصيد غير كافٍ.', 400);
        state.wallet.perpetualCents -= amountCents;
        state.wallet.futuresCents += amountCents;
      }
    }

    const newOp = {
      id: requestId,
      kind,
      amountCents,
      feeCents: 0,
      feeRate: 0,
      netAmountCents: amountCents,
      from: kind === 'reset' ? 'reset' : input.from,
      to: kind === 'reset' ? 'futures' : (input.from === 'futures' ? 'perpetual' : 'futures'),
      afterFuturesCents: state.wallet.futuresCents,
      afterPerpetualCents: state.wallet.perpetualCents,
      createdAt: Date.now()
    };
    state.operations.unshift(newOp);
    if (state.operations.length > 50) state.operations.pop();
    state.wallet.version = (state.wallet.version || 1) + 1;
    state.wallet.updatedAt = Date.now();

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

export async function sendSupportMessage(user: { id: string }, input: { id?: string; text: string; locale?: string }) {
  const text = String(input.text || '').trim();
  if (!text) throw new ClientError('نص الرسالة مطلوب. / Message text required.', 400);
  const msgId = input.id || randomUUID();
  const locale = input.locale === 'en' ? 'en' : 'ar';

  await withTx(async (client) => {
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
  });

  // Exactly one trigger point: server-side after customer message is stored
  try {
    const { supportAssistantReply } = await import('./support.ts');
    await supportAssistantReply(user, { message: text, messageId: msgId, locale });
  } catch (err: any) {
    console.warn('[SUPPORT_BOT_TRIGGER_WARN]', err?.message || err);
  }

  return await getSupportMessages(user);
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

    // Record referral reward for referrer
    await client.query(
      `INSERT INTO referral_rewards (referred_user_id, referrer_user_id, amount_cents, status)
       VALUES ($1, $2, 2500, 'approved')
       ON CONFLICT (referred_user_id) DO NOTHING`,
      [user.id, referrerUserId]
    );

    // Increment referrer direct count in program_members if exists
    await client.query(
      `UPDATE program_members SET direct_count = direct_count + 1, team_count = team_count + 1 WHERE user_id = $1`,
      [referrerUserId]
    );

    return { ok: true, referralCode: normCode };
  });
}
