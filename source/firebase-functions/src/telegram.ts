import { randomUUID } from 'node:crypto';
import { withTx } from './db.ts';

export function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface ContractMessageInfo {
  id: string;
  code: string;
  title: string;
  asset: string;
  direction: string;
  durationSec: number;
  settlementBps: number;
  opensAtMs: number;
  closesAtMs: number;
}

export function formatTurkeyTime(timeMs: number): string {
  return new Date(timeMs).toLocaleString('en-US', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function renderMessageTemplate(
  kind: 'regular_slot' | 'agent_slot' | 'ended_slot' | 'admin_preview',
  c: ContractMessageInfo,
  slotName = 'صفقة معتمدة'
): { text: string; reply_markup?: any } {
  const codeEsc = escapeHtml(c.code);
  const titleEsc = escapeHtml(c.title || slotName);
  const slotNameEsc = escapeHtml(slotName);
  const assetEsc = escapeHtml(c.asset);
  const dirText = c.direction === 'BUY' ? '🟢 شراء صعود (BUY)' : '🔴 بيع هبوط (SELL)';
  const dirTextEsc = escapeHtml(dirText);
  const durationStr = c.durationSec < 60 ? `${c.durationSec} ثانية` : `${Math.round(c.durationSec / 60)} دقيقة`;
  const pctText = (c.settlementBps / 100).toFixed(1) + '%';
  const startTimeStr = formatTurkeyTime(c.opensAtMs);
  const endTimeStr = formatTurkeyTime(c.closesAtMs);

  if (kind === 'ended_slot') {
    const text =
      `⛔ <b>انتهى موعد المشاركة في الصفقة</b> ⛔\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📌 <b>اسم الصفقة:</b> ${titleEsc}\n` +
      `📊 <b>الأصل:</b> ${assetEsc}\n` +
      `🔑 <b>كود الصفقة:</b> <code>${codeEsc}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `تم إغلاق باب الانضمام لهذه الصفقة رسمياً. تابع القناة للصفقة القادمة.`;
    return { text };
  }

  if (kind === 'admin_preview') {
    const text =
      `📋 <b>معاينة صفقة للتأكيد قبل النشر</b> 📋\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📌 <b>الفترة:</b> ${slotNameEsc}\n` +
      `📊 <b>الأصل:</b> ${assetEsc}\n` +
      `🎯 <b>الاتجاه:</b> ${dirTextEsc}\n` +
      `⏱️ <b>المدة:</b> ${durationStr}\n` +
      `📈 <b>النسبة:</b> ${pctText}\n` +
      `⏰ <b>التوقيت (تركيا):</b> ${startTimeStr} - ${endTimeStr}\n` +
      `🔑 <b>الكود المقترح:</b>\n` +
      `<code>${codeEsc}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `يرجى اختيار الإجراء المناسب:`;

    const reply_markup = {
      inline_keyboard: [[
        { text: '✅ موافقة ونشر', callback_data: `appr:${c.id}` },
        { text: '❌ إلغاء', callback_data: `skip:${c.id}` }
      ]]
    };
    return { text, reply_markup };
  }

  const badgeHeader = kind === 'agent_slot'
    ? `🤖 <b>إشارة تداول تلقائية من وكيل ORIN الذكي</b> 🤖`
    : `🚀 <b>إشارة تداول معتمدة من إدارة ORIN</b> 🚀`;

  const text =
    `${badgeHeader}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 <b>الصفقة:</b> ${titleEsc}\n` +
    `📊 <b>الأصل المالي:</b> ${assetEsc}\n` +
    `🎯 <b>نوع الصفقة:</b> ${dirTextEsc}\n` +
    `⏱️ <b>مدة الصفقة:</b> ${durationStr}\n` +
    `📈 <b>نسبة الأرباح المقفلة:</b> ${pctText}\n` +
    `⏰ <b>فترة المشاركة (توقيت تركيا):</b> ${startTimeStr} - ${endTimeStr}\n` +
    `🔑 <b>كود الدخول في الصفقة:</b>\n` +
    `<code>${codeEsc}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━`;

  return { text };
}

export const DEFAULT_TELEGRAM_BOT_TOKEN = '8435789146:AAGDwXQ3NcBf0CMdsAo0ZeL4Pn28RyS_4sM';
export const DEFAULT_TELEGRAM_CHANNEL_ID = '-1003753942964';

export function getTelegramBotToken(): string {
  const envToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (envToken && envToken !== 'mock-bot-token') return envToken;
  return DEFAULT_TELEGRAM_BOT_TOKEN;
}

export function getTelegramChannelId(): string {
  const testChat = (process.env.TELEGRAM_TEST_CHANNEL_ID || '').trim();
  const prodChat = (process.env.TELEGRAM_CHANNEL_ID || '').trim();
  if (process.env.TELEGRAM_MODE === 'test' && testChat && testChat !== '@testchannel') {
    return testChat;
  }
  if (prodChat && prodChat !== '@channel') {
    return prodChat;
  }
  return DEFAULT_TELEGRAM_CHANNEL_ID;
}

export async function sendTelegramApiRequest(
  methodName: string,
  bodyData: Record<string, any>,
  telegramBaseUrl = 'https://api.telegram.org'
): Promise<{ ok: boolean; result?: any; description?: string; retry_after?: number; status?: number }> {
  const token = getTelegramBotToken();
  const url = `${telegramBaseUrl}/bot${token}/${methodName}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });

    const json = (await res.json().catch(() => ({}))) as any;
    if (res.status === 429) {
      return {
        ok: false,
        status: 429,
        retry_after: Number(json.parameters?.retry_after || json.retry_after || 5),
        description: json.description || 'Rate limited'
      };
    }

    if (!res.ok || !json.ok) {
      return {
        ok: false,
        status: res.status,
        description: json.description || `Telegram API error HTTP ${res.status}`
      };
    }

    return { ok: true, status: 200, result: json.result };
  } catch (err: any) {
    return { ok: false, status: 500, description: err.message };
  }
}

export async function processTelegramOutboxOnce(telegramBaseUrl = 'https://api.telegram.org'): Promise<{ processed: number; errors: number }> {
  const autoPost = process.env.TELEGRAM_AUTO_POST_ENABLED !== 'false';
  if (!autoPost) {
    console.log('[TELEGRAM_OUTBOX] Kill switch active (TELEGRAM_AUTO_POST_ENABLED=false), skipping outbox.');
    return { processed: 0, errors: 0 };
  }

  return await withTx(async (client) => {
    const rowsRes = await client.query(
      `SELECT * FROM telegram_outbox
       WHERE (status = 'pending' OR (status = 'failed' AND attempts < 10)) AND next_attempt_at <= NOW()
       ORDER BY created_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED`
    );

    let processed = 0;
    let errors = 0;

    for (const row of rowsRes.rows) {
      const payload = row.payload || {};
      const method = payload.method || 'sendMessage';
      const body = payload.body || {};

      if (!body.chat_id || body.chat_id === '@channel' || body.chat_id === '@testchannel') {
        body.chat_id = getTelegramChannelId();
      }

      if (process.env.TELEGRAM_MODE === 'test') {
        const testChat = process.env.TELEGRAM_TEST_CHANNEL_ID || DEFAULT_TELEGRAM_CHANNEL_ID;
        if (testChat && body.chat_id && body.chat_id !== testChat) {
          body.chat_id = testChat;
        }
      }

      const res = await sendTelegramApiRequest(method, body, telegramBaseUrl);
      if (res.ok) {
        const msgId = String(res.result?.message_id || '');
        await client.query(
          `UPDATE telegram_outbox
           SET status = 'sent', attempts = attempts + 1, message_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [msgId, row.id]
        );

        await client.query(
          `UPDATE scheduled_runs SET telegram_message_id = $1, updated_at = NOW() WHERE contract_id = $2`,
          [msgId, row.contract_id]
        );
        processed++;
        console.log(`[TELEGRAM_OUTBOX_SUCCESS] Outbox ID ${row.id} sent message_id ${msgId}`);
      } else {
        errors++;
        const nextDelaySec = res.status === 429 ? (res.retry_after || 5) : Math.pow(2, Math.min(row.attempts + 1, 6)) * 5;
        const attempts = row.attempts + 1;
        const newStatus = attempts >= 5 ? 'failed' : 'pending';

        await client.query(
          `UPDATE telegram_outbox
           SET attempts = $1, status = $2, last_error = $3, next_attempt_at = NOW() + ($4 || ' seconds')::interval, updated_at = NOW()
           WHERE id = $5`,
          [attempts, newStatus, res.description, `${nextDelaySec}`, row.id]
        );
        console.log(`[TELEGRAM_OUTBOX_ERROR] Outbox ID ${row.id} attempt ${attempts} failed: ${res.description}. Next attempt in ${nextDelaySec}s`);
      }
    }

    return { processed, errors };
  });
}
