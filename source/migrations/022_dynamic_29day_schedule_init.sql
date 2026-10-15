-- 022_dynamic_29day_schedule_init.sql
-- Initialize the 2 daily slots to Day 1 of the 29-day doubling challenge
-- Clear any test runs and ensure strictly only these 2 slots exist

-- 1. Clear old runs
DELETE FROM scheduled_runs;

-- 2. Clear test outbox messages
DELETE FROM telegram_outbox WHERE contract_id LIKE 'contract-auto-%';

-- 3. Clear auto test contracts
DELETE FROM contracts WHERE admin_id = 'scheduler';

-- 4. Delete any slots other than slot-1700 and slot-2030
DELETE FROM trade_slots WHERE id NOT IN ('slot-1700', 'slot-2030');

-- 5. Configure Day 1 Session 1 (17:00 UTC+3, BTCUSD BUY 60s, 118 bps / +1.18%)
INSERT INTO trade_slots (
  id, name, local_time, timezone, days_of_week, asset, direction,
  duration_sec, settlement_bps, eligibility, opens_offset_min, closes_after_min, mode, enabled
)
VALUES (
  'slot-1700', 'اقتناص قمة البيتكوين - جلسة لندن', '17:00', 'Europe/Istanbul',
  '[0,1,2,3,4,5,6]'::jsonb, 'BTCUSD', 'BUY', 60, 118, 'all', 0, 60, 'auto', TRUE
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  local_time = EXCLUDED.local_time,
  asset = EXCLUDED.asset,
  direction = EXCLUDED.direction,
  duration_sec = EXCLUDED.duration_sec,
  settlement_bps = EXCLUDED.settlement_bps,
  mode = 'auto',
  enabled = TRUE,
  updated_at = NOW();

-- 6. Configure Day 1 Session 2 (20:30 UTC+3, XAUUSD BUY 180s, 122 bps / +1.22%)
INSERT INTO trade_slots (
  id, name, local_time, timezone, days_of_week, asset, direction,
  duration_sec, settlement_bps, eligibility, opens_offset_min, closes_after_min, mode, enabled
)
VALUES (
  'slot-2030', 'زخم الذهب الفوري - افتتاح نيويورك', '20:30', 'Europe/Istanbul',
  '[0,1,2,3,4,5,6]'::jsonb, 'XAUUSD', 'BUY', 180, 122, 'all', 0, 60, 'auto', TRUE
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  local_time = EXCLUDED.local_time,
  asset = EXCLUDED.asset,
  direction = EXCLUDED.direction,
  duration_sec = EXCLUDED.duration_sec,
  settlement_bps = EXCLUDED.settlement_bps,
  mode = 'auto',
  enabled = TRUE,
  updated_at = NOW();
