import pg from 'pg';
import { renderEmailTemplate } from '../firebase-functions/lib/mail/templates.js';
import { sendMailDirect } from '../firebase-functions/lib/mail/transport.js';

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5433/postgres';
const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

console.log('=== RUNNING ORIN DAILY REMINDER CRON JOB ===');

try {
  // Select active users opted-in to daily_reminder who haven't received reminder in last 24h
  const res = await client.query(`
    SELECT ep.user_id, ep.locale, ep.unsubscribe_token_hash, p.email, p.display_name,
           a.balance_cents, a.bonus_profit_cents,
           (SELECT COUNT(*) FROM positions WHERE user_id = ep.user_id AND status = 'active') AS open_positions,
           (SELECT status FROM kyc_files WHERE user_id = ep.user_id ORDER BY created_at DESC LIMIT 1) AS kyc_status
    FROM email_preferences ep
    JOIN profiles p ON ep.user_id = p.id
    LEFT JOIN accounts a ON ep.user_id = a.user_id AND a.type = 'real'
    WHERE ep.daily_reminder = TRUE
      AND p.disabled = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM email_outbox eo
        WHERE eo.to_email = p.email
          AND eo.template = 'daily_reminder'
          AND eo.created_at >= NOW() - INTERVAL '24 hours'
      )
  `);

  console.log(`Found ${res.rows.length} opted-in users for daily reminder.`);

  let sentCount = 0;
  for (const row of res.rows) {
    const balanceUsd = ((Number(row.balance_cents || 0) + Number(row.bonus_profit_cents || 0)) / 100).toFixed(2);
    const openPositions = Number(row.open_positions || 0);
    const kycStatus = row.kyc_status || 'unsubmitted';

    const rendered = renderEmailTemplate('daily_reminder', row.locale || 'ar', {
      balanceUsd,
      openPositions,
      kycStatus,
      unsubscribeToken: row.unsubscribe_token_hash
    });

    const mailRes = await sendMailDirect(row.email, rendered.subject, rendered.html, rendered.text);
    if (mailRes.ok) {
      sentCount++;
      await client.query(
        `INSERT INTO email_outbox (id, to_email, template, locale, payload, status, created_at, sent_at)
         VALUES ($1, $2, 'daily_reminder', $3, $4::jsonb, 'sent', NOW(), NOW())`,
        ['cron-' + Math.random().toString(36).slice(2), row.email, row.locale || 'ar', JSON.stringify({ balanceUsd, openPositions, kycStatus })]
      );
    }
  }

  console.log(`Successfully sent ${sentCount} daily reminder emails.`);
} catch (err) {
  console.error('Daily reminder cron job error:', err);
} finally {
  client.release();
  await pool.end();
  process.exit(0);
}
