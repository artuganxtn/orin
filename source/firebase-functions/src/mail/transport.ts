import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { withTx, getPool } from '../db.ts';
import { renderEmailTemplate } from './templates.ts';

export interface SentMemoryEmail {
  id: string;
  to: string;
  template: string;
  locale: string;
  payload: any;
  subject: string;
  text: string;
  html: string;
  sentAt: number;
}

const globalOutbox: SentMemoryEmail[] = (globalThis as any).__testMemoryOutbox || [];
(globalThis as any).__testMemoryOutbox = globalOutbox;
export const testMemoryOutbox: SentMemoryEmail[] = globalOutbox;

export function setTestFailNextSend(fail: boolean) {
  (globalThis as any).__testFailNextSend = fail;
}

export function clearTestMemoryOutbox() {
  testMemoryOutbox.length = 0;
  (globalThis as any).__testFailNextSend = false;
}

export function validateMailConfigAtStartup() {
  if (process.env.NODE_ENV === 'test') return;

  const from = (process.env.ORIN_MAIL_FROM || process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || process.env.ORIN_MAIL_API_KEY || '').trim();

  if (process.env.NODE_ENV === 'production') {
    if (!from || !pass) {
      console.error('[MAIL_STARTUP_FATAL] Refusing to start in production: ORIN_MAIL_FROM/SMTP_USER and SMTP_PASS/ORIN_MAIL_API_KEY are required.');
      throw new Error('Mail Layer Configuration Missing: ORIN_MAIL_FROM and SMTP_PASS/ORIN_MAIL_API_KEY are required in production.');
    }
  }
}

export async function verifyMailConnectionAtStartup(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;

  validateMailConfigAtStartup();

  const from = (process.env.ORIN_MAIL_FROM || process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || process.env.ORIN_MAIL_API_KEY || '').trim();
  if (!from || !pass) return;

  const host = process.env.SMTP_HOST || 'smtp.titan.email';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE !== 'false';
  const user = process.env.SMTP_USER || from;

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 15000
    });
    await transporter.verify();
    console.log('[MAIL_STARTUP_VERIFY] SMTP connection verified: status=ok');
  } catch (err: any) {
    const code = err?.code || 'VERIFY_FAILED';
    console.warn(`[MAIL_STARTUP_VERIFY] SMTP verification failed: status=failed code=${code}`);
  }
}

export function getMailFromAddress(): string {
  let from = (process.env.SMTP_FROM || '').trim();
  if (from) {
    if (!from.includes('@')) {
      const user = (process.env.SMTP_USER || process.env.ORIN_MAIL_FROM || 'support@javl900.com').trim();
      from = `"${from.replace(/"/g, '')}" <${user}>`;
    }
    return from;
  }
  const raw = (process.env.ORIN_MAIL_FROM || process.env.SMTP_USER || 'support@javl900.com').trim();
  if (raw.includes('<') && raw.includes('>')) {
    return raw;
  }
  return `"ORIN Trading" <${raw}>`;
}

export async function sendMailDirect(
  to: string,
  subject: string,
  html: string,
  text: string,
  extraMeta?: { id?: string; template?: string; locale?: string; payload?: any }
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (process.env.NODE_ENV === 'test') {
    if ((globalThis as any).__testFailNextSend) {
      (globalThis as any).__testFailNextSend = false;
      console.warn(`[MAIL_SEND_FAILED] to=${to} reason=SIMULATED_FAIL status=failed`);
      return { ok: false, error: 'SIMULATED_TRANSPORT_FAILURE' };
    }
    const msgId = 'test-msg-' + randomUUID();
    testMemoryOutbox.push({
      id: extraMeta?.id || msgId,
      to,
      template: extraMeta?.template || 'custom',
      locale: extraMeta?.locale || 'ar',
      payload: extraMeta?.payload || {},
      subject,
      text,
      html,
      sentAt: Date.now()
    });
    return { ok: true, messageId: msgId };
  }

  const host = process.env.SMTP_HOST || 'smtp.titan.email';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE !== 'false';
  const rawFrom = (process.env.SMTP_FROM || process.env.ORIN_MAIL_FROM || process.env.SMTP_USER || 'support@javl900.com').trim();
  const matchFrom = rawFrom.match(/<([^>]+)>/);
  const emailOnly = matchFrom ? matchFrom[1].trim() : rawFrom.replace(/["']/g, '').trim();
  const fromAddress = emailOnly;
  const user = (process.env.SMTP_USER || fromAddress).trim();
  const pass = (process.env.SMTP_PASS || process.env.TITAN_PASSWORD || process.env.ORIN_MAIL_API_KEY || '').trim();
  const mailKey = (process.env.ORIN_MAIL_API_KEY || process.env.RESEND_API_KEY || '').trim();

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000
    });

    const from = getMailFromAddress();
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text
    });

    console.log(`[MAIL_SENT_SMTP] Successfully sent "${subject}" to ${to} (MessageID: ${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (smtpErr: any) {
    const errorCode = smtpErr?.code || 'SMTP_ERROR';
    console.warn(`[MAIL_SEND_FAILED] to=${to} reason=${errorCode} status=failed message=${smtpErr.message}. Checking Resend API fallback...`);

    if (mailKey && mailKey.startsWith('re_')) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + mailKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `ORIN <${fromAddress}>`,
            to: [to],
            subject,
            html,
            text
          }),
          signal: AbortSignal.timeout(12000)
        });

        if (resendRes.ok) {
          const json = await resendRes.json() as any;
          console.log(`[MAIL_SENT_RESEND] Successfully sent "${subject}" to ${to} via Resend API (ID: ${json.id})`);
          return { ok: true, messageId: json.id };
        } else {
          const errJson = await resendRes.json().catch(() => ({})) as any;
          console.error(`[MAIL_RESEND_FAILED] Resend API error: ${errJson.message || resendRes.statusText}`);
        }
      } catch (resendErr: any) {
        console.error(`[MAIL_RESEND_EXCEPTION] Resend API exception: ${resendErr.message}`);
      }
    }

    return { ok: false, error: `${errorCode}: ${smtpErr.message}` };
  }
}

const PRIORITY_TEMPLATES = new Set(['password_reset_code', 'signup_code', 'withdrawal_code']);

export function triggerImmediateEmailSend() {
  setTimeout(() => {
    void processEmailOutboxOnce().catch((err) => {
      console.warn(`[MAIL_PRIORITY_DISPATCH_WARN] ${err?.message || err}`);
    });
  }, 100);
}

export async function enqueueEmail(
  toEmail: string,
  template: string,
  locale = 'ar',
  payload: Record<string, any> = {},
  dedupeKey?: string,
  dbClient?: any
): Promise<string> {
  const id = 'mail-' + randomUUID();
  const dKey = dedupeKey || null;

  const runWithClient = async (client: any) => {
    const res = await client.query(
      `INSERT INTO email_outbox (id, to_email, template, locale, payload, status, dedupe_key, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', $6, NOW())
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [id, toEmail, template, locale, JSON.stringify(payload), dKey]
    );

    const outboxId = res.rows[0]?.id || id;

    if (PRIORITY_TEMPLATES.has(template)) {
      triggerImmediateEmailSend();
    }

    return outboxId;
  };

  if (dbClient) {
    return await runWithClient(dbClient);
  } else {
    return await withTx(async (client) => runWithClient(client));
  }
}

let isOutboxProcessing = false;

export async function processEmailOutboxOnce(): Promise<{ processed: number; errors: number }> {
  if (isOutboxProcessing) {
    return { processed: 0, errors: 0 };
  }
  isOutboxProcessing = true;
  try {
    const rows = await withTx(async (client) => {
      const rowsRes = await client.query(
        `SELECT * FROM email_outbox
         WHERE status IN ('queued', 'sending') AND next_attempt_at <= NOW() AND attempts < 5
         ORDER BY created_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED`
      );
      if (rowsRes.rows.length === 0) return [];
      const ids = rowsRes.rows.map((r: any) => r.id);
      await client.query(
        `UPDATE email_outbox SET status = 'sending' WHERE id = ANY($1::varchar[])`,
        [ids]
      );
      return rowsRes.rows;
    });

    let processed = 0;
    let errors = 0;

    for (const row of rows) {
      const rendered = renderEmailTemplate(row.template, row.locale || 'ar', row.payload || {});
      const res = await sendMailDirect(
        row.to_email,
        rendered.subject,
        rendered.html,
        rendered.text,
        { id: row.id, template: row.template, locale: row.locale, payload: row.payload }
      );

      const pool = getPool();
      if (res.ok) {
        await pool.query(
          `UPDATE email_outbox
           SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, last_error = NULL
           WHERE id = $1`,
          [row.id]
        );
        processed++;
      } else {
        errors++;
        const attempts = row.attempts + 1;
        const nextDelaySec = Math.pow(2, attempts) * 10;
        const status = attempts >= 5 ? 'failed' : 'queued';

        await pool.query(
          `UPDATE email_outbox
           SET attempts = $1, status = $2, last_error = $3, next_attempt_at = NOW() + ($4 || ' seconds')::interval
           WHERE id = $5`,
          [attempts, status, res.error || 'Failed to send', `${nextDelaySec}`, row.id]
        );
      }
    }

    return { processed, errors };
  } finally {
    isOutboxProcessing = false;
  }
}
