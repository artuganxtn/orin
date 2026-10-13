import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { withTx } from './db.ts';
import { renderMessageTemplate } from './telegram.ts';

export interface TradeSlotRow {
  id: string;
  name: string;
  local_time: string; // 'HH:MM'
  timezone: string; // 'Europe/Istanbul'
  days_of_week: number[]; // [0..6]
  asset: string;
  direction: string;
  duration_sec: number;
  settlement_bps: number;
  eligibility: string;
  opens_offset_min: number;
  closes_after_min: number;
  mode: 'review' | 'auto';
  enabled: boolean;
}

export function computeSlotTargetTime(slotTimeStr: string, tz: string, dateStr: string): number {
  const [hours, minutes] = slotTimeStr.split(':').map(Number);
  const [year, month, day] = dateStr.split('-').map(Number);

  // Istanbul is UTC+3 with no DST (standard offset +03:00)
  const offsetHours = tz === 'Europe/Istanbul' ? 3 : 0;
  const targetUtcMs = Date.UTC(year, month - 1, day, hours - offsetHours, minutes, 0, 0);
  return targetUtcMs;
}

export function getCurrentDateStrInTz(nowMs: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(nowMs));

  const y = parts.find(p => p.type === 'year')?.value ?? '2026';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const d = parts.find(p => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export async function processSchedulerSlotsOnce(nowMs = Date.now()): Promise<{ runsCreated: number; missed: number }> {
  return await withTx(async (client) => {
    const slotsRes = await client.query(
      `SELECT * FROM trade_slots WHERE enabled = TRUE FOR UPDATE SKIP LOCKED`
    );

    let runsCreated = 0;
    let missed = 0;

    for (const slot of slotsRes.rows) {
      const days = Array.isArray(slot.days_of_week) ? slot.days_of_week : [0, 1, 2, 3, 4, 5, 6];
      const runDate = getCurrentDateStrInTz(nowMs, slot.timezone || 'Europe/Istanbul');
      const targetTimeMs = computeSlotTargetTime(slot.local_time, slot.timezone || 'Europe/Istanbul', runDate);

      // Check if run date matches scheduled days of week
      const runDateObj = new Date(targetTimeMs);
      const dayOfWeek = runDateObj.getUTCDay();
      if (!days.includes(dayOfWeek)) continue;

      // Check existing run for (slot_id, run_date)
      const runCheck = await client.query(
        `SELECT id, status FROM scheduled_runs WHERE slot_id = $1 AND run_date = $2`,
        [slot.id, runDate]
      );

      if (runCheck.rowCount > 0) continue;

      const windowStartMs = targetTimeMs;
      const windowGraceEndMs = targetTimeMs + 10 * 60 * 1000; // 10 min grace

      if (nowMs < windowStartMs) {
        continue; // Not due yet
      }

      if (nowMs > windowGraceEndMs) {
        // Missed run window
        const runId = 'run-' + randomUUID();
        await client.query(
          `INSERT INTO scheduled_runs (id, slot_id, run_date, status, created_at, updated_at)
           VALUES ($1, $2, $3, 'missed', NOW(), NOW())
           ON CONFLICT (slot_id, run_date) DO NOTHING`,
          [runId, slot.id, runDate]
        );

        const auditPayload = JSON.stringify({ slotId: slot.id, runDate, targetTimeMs, nowMs, reason: 'grace_period_exceeded' });
        await client.query(
          `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
           VALUES ('scheduler', 'TRADE_SLOT_MISSED', $1, $2::jsonb, $3)
           ON CONFLICT DO NOTHING`,
          [slot.id + '-' + runDate, auditPayload, createHash('sha256').update(auditPayload).digest('hex')]
        );
        missed++;
        console.log(`[SCHEDULER_MISSED] Slot ${slot.id} missed for ${runDate} (Target: ${new Date(targetTimeMs).toISOString()})`);
        continue;
      }

      // Execute slot run
      const contractId = 'contract-auto-' + randomUUID();
      const code = 'ORIN-' + randomBytes(6).toString('hex').toUpperCase();
      const title = slot.name || 'صفقة معتمدة';
      const opensAtMs = nowMs + Number(slot.opens_offset_min || 0) * 60 * 1000;
      const closesAtMs = opensAtMs + Number(slot.closes_after_min || 60) * 60 * 1000;
      const hashVal = createHash('sha256').update(code + ':' + slot.asset + ':' + slot.direction + ':' + slot.settlement_bps).digest('hex');

      const isAuto = slot.mode === 'auto';
      const initialStatus = isAuto ? 'active' : 'cancelled';
      const runStatus = isAuto ? 'published' : 'draft';

      await client.query(
        `INSERT INTO profiles (id, email, display_name, role)
         VALUES ('scheduler', 'scheduler@orin.internal', 'ORIN Scheduler Engine', 'admin')
         ON CONFLICT (id) DO NOTHING`
      );

      await client.query(
        `INSERT INTO contracts (id, code, title, asset, direction, duration_sec, settlement_bps, status, opens_at, closes_at, eligibility, hash, admin_id, created_at, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TO_TIMESTAMP($9/1000.0), TO_TIMESTAMP($10/1000.0), $11, $12, 'scheduler', NOW(), ${isAuto ? 'NOW()' : 'NULL'})`,
        [contractId, code, title, slot.asset, slot.direction, Number(slot.duration_sec), Number(slot.settlement_bps), initialStatus, opensAtMs, closesAtMs, slot.eligibility || 'all', hashVal]
      );

      const runId = 'run-' + randomUUID();
      await client.query(
        `INSERT INTO scheduled_runs (id, slot_id, run_date, status, contract_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [runId, slot.id, runDate, runStatus, contractId]
      );

      // Create telegram outbox record if auto or admin preview
      const cInfo = {
        id: contractId,
        code,
        title,
        asset: slot.asset,
        direction: slot.direction,
        durationSec: Number(slot.duration_sec),
        settlementBps: Number(slot.settlement_bps),
        opensAtMs,
        closesAtMs
      };

      if (isAuto) {
        const tpl = renderMessageTemplate('agent_slot', cInfo, slot.name);
        const channelId = process.env.TELEGRAM_MODE === 'test' ? (process.env.TELEGRAM_TEST_CHANNEL_ID || '@testchannel') : (process.env.TELEGRAM_CHANNEL_ID || '@channel');
        const outboxPayload = JSON.stringify({
          method: 'sendMessage',
          body: {
            chat_id: channelId,
            text: tpl.text,
            parse_mode: 'HTML',
            reply_markup: tpl.reply_markup
          }
        });

        await client.query(
          `INSERT INTO telegram_outbox (id, kind, contract_id, payload, status, created_at, updated_at)
           VALUES ($1, 'channel_post', $2, $3::jsonb, 'pending', NOW(), NOW())
           ON CONFLICT (kind, contract_id) DO NOTHING`,
          ['outbox-post-' + contractId, contractId, outboxPayload]
        );
      } else {
        const adminChatId = (process.env.ADMIN_TELEGRAM_IDS || '').split(',')[0] || '@adminchat';
        const tpl = renderMessageTemplate('admin_preview', cInfo, slot.name);
        const outboxPayload = JSON.stringify({
          method: 'sendMessage',
          body: {
            chat_id: adminChatId,
            text: tpl.text,
            parse_mode: 'HTML',
            reply_markup: tpl.reply_markup
          }
        });

        await client.query(
          `INSERT INTO telegram_outbox (id, kind, contract_id, payload, status, created_at, updated_at)
           VALUES ($1, 'admin_preview', $2, $3::jsonb, 'pending', NOW(), NOW())
           ON CONFLICT (kind, contract_id) DO NOTHING`,
          ['outbox-preview-' + contractId, contractId, outboxPayload]
        );
      }

      runsCreated++;
      console.log(`[SCHEDULER_RUN] Slot ${slot.id} executed run ${runId} (Contract ${contractId}, Mode: ${slot.mode})`);
    }

    return { runsCreated, missed };
  });
}
