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

  return await withTx(async (client) => {
    let userMsgText = text;
    if (!userMsgText && input.messageId) {
      const msgRes = await client.query(
        `SELECT data FROM docs WHERE collection = 'support_messages' AND id = $1`,
        [input.messageId]
      );
      if (msgRes.rowCount) {
        userMsgText = msgRes.rows[0].data?.text || '';
      }
    }

    const lower = userMsgText.toLowerCase();

    let reply = '';
    if (lower.includes('deposit') || lower.includes('إيداع') || lower.includes('شحن') || lower.includes('تعبئة')) {
      reply = locale === 'en'
        ? 'Deposits on ORIN are processed on Real Accounts in USD via USDT (TRC20, BEP20, ERC20), BTC, and ETH. Minimum deposit is $1,000 USD. Go to the Deposit section, choose your network, and copy your assigned deposit wallet address.'
        : 'الإيداع في منصة ORIN يتاح للحسابات الحقيقية بالدولار عبر USDT (شبكات TRC20, BEP20, ERC20) و BTC و ETH. الحد الأدنى للإيداع هو 1,000$. يمكنك الذهاب لقسم الإيداع، اختيار الشبكة، ونسخ عنوان المحفظة المخصص لحسابك.';
    } else if (lower.includes('withdraw') || lower.includes('سحب') || lower.includes('صرف') || lower.includes('تحويل إلى محفظة')) {
      reply = locale === 'en'
        ? 'Withdrawals are open for verified (KYC) real accounts 20 days after your first confirmed deposit. Fixed withdrawal fee is $25 USDT. Requests are processed directly to your digital wallet address.'
        : 'السحب متاح للحسابات الحقيقية الموثّقة (KYC) بعد مرور 20 يومًا من تاريخ أول إيداع مؤكد. رسم السحب الثابت هو 25$ USDT وتُنَفَّذ الطلبات مباشرة إلى عنوان محفظتك الرقمية.';
    } else if (lower.includes('kyc') || lower.includes('توثيق') || lower.includes('هوية') || lower.includes('جواز') || lower.includes('بطاقة')) {
      reply = locale === 'en'
        ? 'Identity verification (KYC) is required for financial operations. Go to Settings -> Identity Verification, enter your full name, ID number, and upload a clear picture of your ID Card, Passport, or Driver License.'
        : 'توثيق الهوية (KYC) شرط أساسي للعمليات المالية. يمكنك الانتقال إلى الإعدادات -> توثيق الهوية، إدخال اسمك الثلاثي ورقم الوثيقة، وتحميل صورة واضحة لبطاقة الهوية أو جواز السفر أو رخصة القيادة.';
    } else if (lower.includes('code') || lower.includes('كود') || lower.includes('إشارة') || lower.includes('صفقة') || lower.includes('تداول') || lower.includes('شروط')) {
      reply = locale === 'en'
        ? 'ORIN trading is 100% signal-code driven. Private VIP channels release 12-character trade codes (e.g. ORIN-XXXXXXXXXXXX) with pre-locked asset, direction, duration, and profit rates. Enter the code in the Trade portal and confirm entry.'
        : 'التداول في منصة ORIN يعتمد 100% على أكواد الصفقات المعتمدة (VIP Signal Codes). يتم نشر كود مكون من 12 حرفًا (مثل ORIN-XXXXXXXXXXXX) بشروط مقفلة رقميًا عبر القنوات الخاصة. ادخل الكود في بوابة الصفقات واضغط «تأكيد الدخول».';
    } else if (lower.includes('demo') || lower.includes('تجريبي') || lower.includes('حقيقي') || lower.includes('real')) {
      reply = locale === 'en'
        ? 'ORIN features two distinct account types: Real Account (USD) for live trading, deposits, and withdrawals; and Demo Account for practice. Demo balances cannot be withdrawn.'
        : 'منصة ORIN توفر نوعين من الحسابات: الحساب الحقيقي (USD) للتداول الفعلي والإيداع والسحب، والحساب التجريبي للتدريب والتجربة برصيد غير قابل للسحب.';
    } else if (lower.includes('support') || lower.includes('دعم') || lower.includes('متابعة') || lower.includes('فريق') || lower.includes('تواصل')) {
      reply = locale === 'en'
        ? 'I am Adam, your ORIN AI assistant. If you need human assistance or document review, click "Team Follow-up" at the top of the chat to connect with our compliance support team.'
        : 'أنا Adam مساعدك الذكي في ORIN. إذا كنت بحاجة إلى استفسار أعمق أو مراجعة مع موظف دعم، اضغط على «متابعة مع الفريق» في أعلى المحادثة لفتح تذكرة متابعة مباشرة.';
    } else {
      reply = locale === 'en'
        ? 'Welcome to ORIN Support. I am Adam, your intelligent assistant. I can help you with Deposits, Withdrawals, VIP Trade Codes, KYC Verification, and Account Security. How can I assist you today?'
        : 'أهلًا بك في مركز دعم ORIN. أنا Adam مساعدك الذكي. يمكنني إجابتك عن الإيداع، السحب، أكواد الصفقات، توثيق الهوية (KYC)، وأمان الحساب. كيف يمكنني مساعدتك اليوم؟';
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && userMsgText) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are Adam, official AI support assistant for ORIN trading platform. Answer in ${locale === 'ar' ? 'Arabic' : 'English'} according to ORIN rules: Minimum deposit $1000 USD via USDT TRC20/BEP20/ERC20; 20-day withdrawal lock after first deposit; VIP signal codes (e.g. ORIN-XXXXXXXXXXXX) for trades; KYC required for withdrawals. Be concise, polite, and helpful.\nUser: ${userMsgText}`
              }]
            }]
          })
        });
        if (response.ok) {
          const json = (await response.json()) as any;
          const aiReply = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (aiReply && aiReply.trim().length > 5) {
            reply = aiReply.trim();
          }
        }
      } catch (e) {
        console.warn('Gemini API call skipped, using local ORIN knowledge base');
      }
    }

    if (userMsgText && input.messageId) {
      const userDocData = JSON.stringify({
        id: input.messageId,
        uid: u.id,
        text: userMsgText,
        kind: 'customer',
        createdAt: Date.now()
      });
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data)
         VALUES ('support_messages', $1, $2, $3::jsonb)
         ON CONFLICT (collection, id) DO NOTHING`,
        [input.messageId, u.id, userDocData]
      );
    }

    const replyMsgId = 'asst-' + randomUUID();
    const assistantDocData = JSON.stringify({
      id: replyMsgId,
      uid: u.id,
      text: reply,
      kind: 'assistant',
      createdAt: Date.now(),
      assistant: { id: 'adam-ai', name: 'Adam', inReplyTo: input.messageId || null }
    });

    await client.query(
      `INSERT INTO docs (collection, id, owner_id, data)
       VALUES ('support_messages', $1, $2, $3::jsonb)
       ON CONFLICT (collection, id) DO NOTHING`,
      [replyMsgId, u.id, assistantDocData]
    );

    return {
      ok: true,
      status: 'ready',
      messageId: replyMsgId,
      reply,
      assistant: { id: 'adam-ai', name: 'Adam' }
    };
  });
}
