import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { withTx } from '../db.ts';
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

export const testMemoryOutbox: SentMemoryEmail[] = [];

export function clearTestMemoryOutbox() {
  testMemoryOutbox.length = 0;
}

export function validateMailConfigAtStartup() {
  if (process.env.NODE_ENV === 'test') return;

  const from = process.env.ORIN_MAIL_FROM || process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS || process.env.ORIN_MAIL_API_KEY;

  if (!from || !pass) {
    throw new Error('Mail Layer Configuration Missing: ORIN_MAIL_FROM and SMTP_PASS/ORIN_MAIL_API_KEY are required in production.');
  }
}

export async function sendMailDirect(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (process.env.NODE_ENV === 'test') {
    const msgId = 'test-msg-' + randomUUID();
    return { ok: true, messageId: msgId };
  }

  const host = process.env.SMTP_HOST || 'smtp.titan.email';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE !== 'false';
  const user = process.env.SMTP_USER || process.env.ORIN_MAIL_FROM || 'support@javl900.com';
  const pass = process.env.SMTP_PASS || process.env.TITAN_PASSWORD || process.env.ORIN_MAIL_API_KEY || '';
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

    const info = await transporter.sendMail({
      from: `"ORIN Trading" <${user}>`,
      to,
      subject,
      html,
      text
    });

    console.log(`[MAIL_SENT_SMTP] Successfully sent "${subject}" to ${to} (MessageID: ${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (smtpErr: any) {
    console.warn(`[MAIL_SMTP_FAILED] SMTP delivery to ${to} failed: ${smtpErr.message}. Checking Resend API fallback...`);

    if (mailKey && mailKey.startsWith('re_')) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + mailKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `ORIN Trading <${user}>`,
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

    return { ok: false, error: smtpErr.message };
  }
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

    if (process.env.NODE_ENV === 'test') {
      const rendered = renderEmailTemplate(template, locale as 'ar' | 'en', payload);
      testMemoryOutbox.push({
        id: outboxId,
        to: toEmail,
        template,
        locale,
        payload,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        sentAt: Date.now()
      });
    }

    return outboxId;
  };

  if (dbClient) {
    return await runWithClient(dbClient);
  } else {
    return await withTx(async (client) => runWithClient(client));
  }
}

export async function processEmailOutboxOnce(): Promise<{ processed: number; errors: number }> {
  return await withTx(async (client) => {
    const rowsRes = await client.query(
      `SELECT * FROM email_outbox
       WHERE status IN ('queued', 'sending') AND next_attempt_at <= NOW() AND attempts < 5
       ORDER BY created_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED`
    );

    let processed = 0;
    let errors = 0;

    for (const row of rowsRes.rows) {
      const rendered = renderEmailTemplate(row.template, row.locale || 'ar', row.payload || {});
      const res = await sendMailDirect(row.to_email, rendered.subject, rendered.html, rendered.text);

      if (res.ok) {
        await client.query(
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

        await client.query(
          `UPDATE email_outbox
           SET attempts = $1, status = $2, last_error = $3, next_attempt_at = NOW() + ($4 || ' seconds')::interval
           WHERE id = $5`,
          [attempts, status, res.error || 'Failed to send', `${nextDelaySec}`, row.id]
        );
      }
    }

    return { processed, errors };
  });
}
