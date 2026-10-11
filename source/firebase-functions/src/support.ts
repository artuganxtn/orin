import { randomUUID, createHash } from 'node:crypto';
import { withTx } from './db.ts';

export class SupportError extends Error {
  code: string;
  constructor(message: string, public status = 400, code = 'support_error') {
    super(message);
    this.code = code;
  }
}

export type Identity = { id: string; email?: string; name?: string; role?: string };

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

export async function supportAssistantCapability(u: Identity) {
  return await withTx(async (client) => {
    // Check if user has an active support ticket
    const ticketRes = await client.query(
      `SELECT id, data FROM docs WHERE collection = 'support_tickets' AND owner_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [u.id]
    );

    let activeTicket = null;
    if (ticketRes.rowCount) {
      const d = ticketRes.rows[0].data || {};
      activeTicket = {
        id: ticketRes.rows[0].id,
        status: d.status || 'submitted',
        createdAt: d.createdAt || new Date(ticketRes.rows[0].created_at).getTime()
      };
    }

    return {
      available: true,
      reason: 'ready',
      knowledgeVersion: 'v2026.1',
      activeTicket,
      requiredServices: []
    };
  });
}

export async function escalateSupportTicket(u: Identity, messageId?: string) {
  return await withTx(async (client) => {
    const ticketId = 'spt-' + randomUUID();
    const payload = JSON.stringify({
      id: ticketId,
      userId: u.id,
      status: 'submitted',
      messageId: messageId || null,
      createdAt: Date.now()
    });

    await client.query(
      `INSERT INTO docs (collection, id, owner_id, data)
       VALUES ('support_tickets', $1, $2, $3::jsonb)
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [ticketId, u.id, payload]
    );

    const auditPayload = JSON.stringify({ ticketId, userId: u.id, messageId });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ($1, 'SUPPORT_TICKET_ESCALATED', $2, $3::jsonb, $4)
       ON CONFLICT (action, reference) DO NOTHING`,
      [u.id, ticketId, auditPayload, hash(auditPayload)]
    );

    return {
      ok: true,
      ticket: {
        id: ticketId,
        userId: u.id,
        status: 'submitted',
        createdAt: Date.now()
      }
    };
  });
}

export async function supportAssistantReply(u: Identity, input: { message?: string; messageId?: string; locale?: string }) {
  const text = String(input.message || '').trim();
  const locale = input.locale === 'en' ? 'en' : 'ar';

  // Optional Gemini API integration
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && text) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are Adam, the official AI support assistant for ORIN trading platform. Answer concisely and accurately in ${locale === 'ar' ? 'Arabic' : 'English'}.\nUser message: ${text}`
            }]
          }]
        })
      });
      if (response.ok) {
        const json = (await response.json()) as any;
        const replyText = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (replyText) {
          return {
            ok: true,
            status: 'ready',
            reply: replyText,
            assistant: { id: 'adam-ai', name: 'Adam' }
          };
        }
      }
    } catch (e) {
      console.warn('Gemini support AI call warning:', e);
    }
  }

  // Localized smart assistant responses
  const lower = text.toLowerCase();
  let reply = 'أهلًا بك في مركز دعم ORIN. أنا Adam مساعدك الذكي. يمكنك الاستفسار عن عمليات التداول والإيداع والسحب وتوثيق الهوية (KYC)، أو الضغط على "متابعة مع الفريق" للتواصل مع مراجع الامتثال.';
  if (lower.includes('deposit') || text.includes('إيداع')) {
    reply = 'الإيداع متاح للحساب الحقيقي عبر USDT BEP20/TRC20 و BTC و ETH. يُرجى تحويل المبلغ بدقة مع التأكد من اختيار الشبكة الصحيحة.';
  } else if (lower.includes('withdraw') || text.includes('سحب')) {
    reply = 'السحب متاح للحساب الحقيقي الموثّق (KYC) بعد مرور 20 يومًا على أول إيداع مؤكد، ويتم معالجة الطلب مباشرة إلى عنوان محفظتك.';
  } else if (lower.includes('kyc') || text.includes('توثيق') || text.includes('هوية')) {
    reply = 'يمكنك تقديم وثيقة الهوية (بطاقة هوية، جواز سفر، رخصة قيادة) عبر قسم الإعدادات -> توثيق الهوية. فور التوثيق، تتاح جميع العمليات المالية.';
  }

  return {
    ok: true,
    status: 'ready',
    reply,
    assistant: { id: 'adam-ai', name: 'Adam' }
  };
}
