import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { withTx } from './db.ts';
import { renderMessageTemplate, getTelegramChannelId } from './telegram.ts';

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

      // Check if run date matches scheduled days of week (calculated in slot's timezone date)
      const [y, m, d] = runDate.split('-').map(Number);
      const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (!days.includes(dayOfWeek)) continue;

      // Check existing run for (slot_id, run_date)
      const runCheck = await client.query(
        `SELECT id, status FROM scheduled_runs WHERE slot_id = $1 AND run_date = $2`,
        [slot.id, runDate]
      );

      if (runCheck.rowCount > 0) continue;

      const windowStartMs = targetTimeMs;
      const windowGraceEndMs = targetTimeMs + Number(slot.closes_after_min || 60) * 60 * 1000;

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
      await executeSlot(slot, client, nowMs, runDate);
      runsCreated++;
      console.log(`[SCHEDULER_RUN] Slot ${slot.id} executed for ${runDate} (Mode: ${slot.mode})`);
    }

    return { runsCreated, missed };
  });
}

export interface DayTradeSession {
  name: string;
  asset: string;
  dir: 'BUY' | 'SELL';
  dur: number;
  bps: number;
}

export interface DayPlan {
  d: number;
  s1: DayTradeSession;
  s2: DayTradeSession;
}

export const SCHEDULE_29_DAYS: DayPlan[] = [
  { d: 1, s1: { name: 'اقتناص قمة البيتكوين - جلسة لندن', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 118 }, s2: { name: 'زخم الذهب الفوري - افتتاح نيويورك', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 122 } },
  { d: 2, s1: { name: 'ارتداد اليورو مقابل الدولار', asset: 'EURUSD', dir: 'SELL', dur: 120, bps: 112 }, s2: { name: 'اختراق مقاومة الإيثيريوم السريعة', asset: 'ETHUSD', dir: 'BUY', dur: 90, bps: 128 } },
  { d: 3, s1: { name: 'موجة صعود الذهب - تداولات المساء', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 125 }, s2: { name: 'فرصة سولانا السريعة - زخم السيولة', asset: 'SOLUSD', dir: 'BUY', dur: 60, bps: 115 } },
  { d: 4, s1: { name: 'تداول كسر اتجاه الجنيه الإسترليني', asset: 'GBPUSD', dir: 'BUY', dur: 120, bps: 120 }, s2: { name: 'صفقة البيتكوين المسائية - حركة الحيتان', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 120 } },
  { d: 5, s1: { name: 'ضغط شراء الذهب - الجلسة الأوروبية', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 110 }, s2: { name: 'اندفاع الإيثيريوم اللحظي - الجلسة الأمريكية', asset: 'ETHUSD', dir: 'BUY', dur: 90, bps: 130 } },
  { d: 6, s1: { name: 'انعكاس اليورو اللحظي - تأكيد النمط', asset: 'EURUSD', dir: 'BUY', dur: 60, bps: 122 }, s2: { name: 'استقرار الذهب فوق الدعم الرئيسي', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 118 } },
  { d: 7, s1: { name: 'تأكيد اتجاه البيتكوين الصاعد', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 115 }, s2: { name: 'اقتناص قاع الجنيه الإسترليني', asset: 'GBPUSD', dir: 'BUY', dur: 120, bps: 125 } },
  { d: 8, s1: { name: 'زخم الذهب مع افتتاح أسواق السلع', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 128 }, s2: { name: 'موجة صعود سولانا - تحرك الزخم', asset: 'SOLUSD', dir: 'BUY', dur: 60, bps: 113 } },
  { d: 9, s1: { name: 'تأكيد كسر اتجاه الإيثيريوم', asset: 'ETHUSD', dir: 'BUY', dur: 90, bps: 114 }, s2: { name: 'صفقة البيتكوين الفورية - ارتداد الدعم', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 126 } },
  { d: 10, s1: { name: 'تداول الذهب اللحظي - سيولة المساء', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 121 }, s2: { name: 'اختراق اليورو مقابل الدولار', asset: 'EURUSD', dir: 'BUY', dur: 120, bps: 120 } },
  { d: 11, s1: { name: 'فرصة الجنيه الإسترليني - كسر القناة', asset: 'GBPUSD', dir: 'SELL', dur: 60, bps: 116 }, s2: { name: 'اندفاع البيتكوين - زخم السيولة الأمريكية', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 124 } },
  { d: 12, s1: { name: 'صعود الذهب الفوري نحو الهدف الأول', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 124 }, s2: { name: 'صفقة الإيثيريوم - تأكيد الاتجاه الصاعد', asset: 'ETHUSD', dir: 'BUY', dur: 90, bps: 117 } },
  { d: 13, s1: { name: 'زخم سولانا - اختراق مستوى المقاومة', asset: 'SOLUSD', dir: 'BUY', dur: 60, bps: 109 }, s2: { name: 'تداول الذهب الآمن - افتتاح المساء', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 131 } },
  { d: 14, s1: { name: 'ارتداد البيتكوين من منطقة الطلب', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 126 }, s2: { name: 'موجة اليورو الهابطة - جني أرباح', asset: 'EURUSD', dir: 'SELL', dur: 120, bps: 115 } },
  { d: 15, s1: { name: 'تأكيد شراء الذهب - ثبات أعلى المتوسط', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 118 }, s2: { name: 'فرصة الإيثيريوم السريعة - ختام الجلسة', asset: 'ETHUSD', dir: 'BUY', dur: 60, bps: 123 } },
  { d: 16, s1: { name: 'كسر نطاق الجنيه الإسترليني العرضي', asset: 'GBPUSD', dir: 'BUY', dur: 120, bps: 113 }, s2: { name: 'زخم البيتكوين المسائي - اختراق القمة', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 128 } },
  { d: 17, s1: { name: 'صعود الذهب اللحظي - تفاعل مع الأخبار', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 122 }, s2: { name: 'ارتداد سولانا الإيجابي - اتجاه صاعد', asset: 'SOLUSD', dir: 'BUY', dur: 60, bps: 119 } },
  { d: 18, s1: { name: 'تداول الإيثيريوم الفوري - زخم قوي', asset: 'ETHUSD', dir: 'BUY', dur: 90, bps: 111 }, s2: { name: 'صفقة الذهب الذهبية - استمرار الاتجاه', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 130 } },
  { d: 19, s1: { name: 'استقرار اليورو مقابل الدولار الأمريكي', asset: 'EURUSD', dir: 'BUY', dur: 120, bps: 125 }, s2: { name: 'فرصة البيتكوين المسائية - زخم الشراء', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 116 } },
  { d: 20, s1: { name: 'تأكيد اختراق الذهب لمستويات جديدة', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 119 }, s2: { name: 'موجة الجنيه الإسترليني - حركة سيولة عالية', asset: 'GBPUSD', dir: 'BUY', dur: 90, bps: 122 } },
  { d: 21, s1: { name: 'اندفاع الإيثيريوم السريع - سيولة العصر', asset: 'ETHUSD', dir: 'BUY', dur: 60, bps: 115 }, s2: { name: 'صفقة الذهب الاستراتيجية - تداولات الليل', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 126 } },
  { d: 22, s1: { name: 'تداول البيتكوين الآمن - نموذج كسر قاع', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 127 }, s2: { name: 'انعكاس سولانا - تأكيد شمعة الابتلاع', asset: 'SOLUSD', dir: 'BUY', dur: 90, bps: 114 } },
  { d: 23, s1: { name: 'ارتداد اليورو نحو مستويات المقاومة', asset: 'EURUSD', dir: 'BUY', dur: 120, bps: 114 }, s2: { name: 'زخم الذهب الفوري - استهداف قمة اليوم', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 127 } },
  { d: 24, s1: { name: 'صفقة الجنيه الإسترليني - كسر تريند صاعد', asset: 'GBPUSD', dir: 'BUY', dur: 60, bps: 123 }, s2: { name: 'تحرك البيتكوين اللحظي - سيولة حيتان', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 118 } },
  { d: 25, s1: { name: 'صعود الإيثيريوم الاستثماري - الجلسة الأولى', asset: 'ETHUSD', dir: 'BUY', dur: 90, bps: 112 }, s2: { name: 'تداول الذهب الحاسم - الجلسة المسائية', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 129 } },
  { d: 26, s1: { name: 'اختراق سولانا السريع نحو مستويات عليا', asset: 'SOLUSD', dir: 'BUY', dur: 60, bps: 120 }, s2: { name: 'فرصة البيتكوين المؤكدة - ارتداد قوي', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 121 } },
  { d: 27, s1: { name: 'تأكيد شراء اليورو - افتتاح الأسواق', asset: 'EURUSD', dir: 'BUY', dur: 120, bps: 116 }, s2: { name: 'صفقة الذهب المميزة - استقرار الأسعار', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 125 } },
  { d: 28, s1: { name: 'موجة الجنيه الإسترليني الصاعدة', asset: 'GBPUSD', dir: 'BUY', dur: 90, bps: 124 }, s2: { name: 'اندفاع الإيثيريوم - تأكيد كسر خط الاتجاه', asset: 'ETHUSD', dir: 'BUY', dur: 60, bps: 117 } },
  { d: 29, s1: { name: 'صفقة البيتكوين الختامية - ختام دورة التداول', asset: 'BTCUSD', dir: 'BUY', dur: 60, bps: 118 }, s2: { name: 'صفقة الذهب الختامية - اكتمال مضاعفة الرصيد', asset: 'XAUUSD', dir: 'BUY', dur: 180, bps: 123 } }
];

export function get29DaySlotPlan(runDate: string, slotId: string): { dayIndex: number; session: DayTradeSession } {
  const cycleStart = new Date('2026-10-16T00:00:00Z').getTime();
  const currentMs = new Date(runDate + 'T00:00:00Z').getTime();
  const diffDays = Math.floor((currentMs - cycleStart) / 86400000);
  const dayIndex = ((diffDays % 29) + 29) % 29 + 1;
  const plan = SCHEDULE_29_DAYS[dayIndex - 1] || SCHEDULE_29_DAYS[0];
  const isSession1 = slotId.includes('1700') || slotId.includes('session1') || slotId.includes('first');
  const session = isSession1 ? plan.s1 : plan.s2;
  return { dayIndex, session };
}

async function executeSlot(slot: any, client: any, nowMs: number, runDate: string) {
  const { session } = get29DaySlotPlan(runDate, slot.id);
  const tradeAsset = session.asset || slot.asset || 'BTCUSD';
  const tradeDirection = session.dir || slot.direction || 'BUY';
  const tradeDuration = Number(session.dur || slot.duration_sec || 60);
  const tradeBps = Number(session.bps || slot.settlement_bps || 118);
  const tradeTitle = session.name || slot.name || 'صفقة معتمدة';

  const contractId = 'contract-auto-' + randomUUID();
  const code = 'ORIN-' + randomBytes(6).toString('hex').toUpperCase();
  const opensAtMs = nowMs + Number(slot.opens_offset_min || 0) * 60 * 1000;
  const closesAtMs = opensAtMs + Number(slot.closes_after_min || 60) * 60 * 1000;
  const hashVal = createHash('sha256').update(code + ':' + tradeAsset + ':' + tradeDirection + ':' + tradeBps).digest('hex');

  const initialStatus = 'active';
  const runStatus = 'published';

  // Synchronize slot record in trade_slots table with today's live parameters so admin dashboard displays them
  await client.query(
    `UPDATE trade_slots
     SET name = $1, asset = $2, direction = $3, duration_sec = $4, settlement_bps = $5, updated_at = NOW()
     WHERE id = $6`,
    [tradeTitle, tradeAsset, tradeDirection, tradeDuration, tradeBps, slot.id]
  );

  await client.query(
    `INSERT INTO profiles (id, email, display_name, role)
     VALUES ('scheduler', 'scheduler@orin.internal', 'ORIN Scheduler Engine', 'admin')
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO contracts (id, code, title, asset, direction, duration_sec, settlement_bps, status, opens_at, closes_at, eligibility, hash, admin_id, created_at, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TO_TIMESTAMP($9/1000.0), TO_TIMESTAMP($10/1000.0), $11, $12, 'scheduler', NOW(), NOW())`,
    [contractId, code, tradeTitle, tradeAsset, tradeDirection, tradeDuration, tradeBps, initialStatus, opensAtMs, closesAtMs, slot.eligibility || 'all', hashVal]
  );

  const runId = 'run-' + randomUUID();
  await client.query(
    `INSERT INTO scheduled_runs (id, slot_id, run_date, status, contract_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (slot_id, run_date) DO UPDATE SET contract_id = EXCLUDED.contract_id, status = EXCLUDED.status, updated_at = NOW()`,
    [runId, slot.id, runDate, runStatus, contractId]
  );

  const cInfo = {
    id: contractId,
    code,
    title: tradeTitle,
    asset: tradeAsset,
    direction: tradeDirection,
    durationSec: tradeDuration,
    settlementBps: tradeBps,
    opensAtMs,
    closesAtMs
  };

  const tpl = renderMessageTemplate('regular_slot', cInfo, tradeTitle);
  const channelId = getTelegramChannelId();
  const outboxPayload = JSON.stringify({
    method: 'sendMessage',
    body: {
      chat_id: channelId,
      text: tpl.text,
      parse_mode: 'HTML',
      reply_markup: tpl.reply_markup
    }
  });

  // 1. Enqueue main formatted trade signal announcement
  await client.query(
    `INSERT INTO telegram_outbox (id, kind, contract_id, payload, status, created_at, updated_at)
     VALUES ($1, 'channel_post', $2, $3::jsonb, 'pending', NOW(), NOW())
     ON CONFLICT (kind, contract_id) DO NOTHING`,
    ['outbox-post-' + contractId, contractId, outboxPayload]
  );

  // 2. Enqueue standalone trade code message for easy 1-tap copying on mobile
  const codePayload = JSON.stringify({
    method: 'sendMessage',
    body: {
      chat_id: channelId,
      text: `<code>${code}</code>`,
      parse_mode: 'HTML'
    }
  });

  await client.query(
    `INSERT INTO telegram_outbox (id, kind, contract_id, payload, status, created_at, updated_at)
     VALUES ($1, 'channel_code', $2, $3::jsonb, 'pending', NOW() + INTERVAL '1 second', NOW() + INTERVAL '1 second')
     ON CONFLICT (kind, contract_id) DO NOTHING`,
    ['outbox-code-' + contractId, contractId, codePayload]
  );

  return { code, contractId, runId, isAuto: true };
}

export async function triggerSlotRunDirectly(slotId: string, force = true): Promise<{ ok: boolean; code?: string; contractId?: string; isAuto?: boolean; outboxProcessed?: number }> {
  const result = await withTx(async (client) => {
    const slotRes = await client.query('SELECT * FROM trade_slots WHERE id = $1', [slotId]);
    if (slotRes.rowCount === 0) {
      throw new Error('Trade slot not found');
    }
    const slot = slotRes.rows[0];
    const nowMs = Date.now();
    const runDate = getCurrentDateStrInTz(nowMs, slot.timezone || 'Europe/Istanbul');
    return await executeSlot(slot, client, nowMs, force ? `${runDate}-${Date.now().toString(36)}` : runDate);
  });

  let outboxProcessed = 0;
  try {
    const { processTelegramOutboxOnce } = await import('./telegram.js');
    const outboxRes = await processTelegramOutboxOnce();
    outboxProcessed = outboxRes.processed;
  } catch (err: any) {
    console.error('[TRIGGER_SLOT_OUTBOX_ERROR]', err?.message || err);
  }

  return { ok: true, ...result, outboxProcessed };
}
