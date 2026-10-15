-- 019_two_trades_daily_doubling_schedule.sql
-- 29-day capital doubling schedule (2 trades per day, compounding to 2x):
-- Session 1 (17:00 UTC+03:00 GMT+3): +1.17% (117 bps)
-- Session 2 (20:30 UTC+03:00 GMT+3): +1.24% (124 bps)
-- Daily Compound: 1.0117 * 1.0124 = 1.024245 (+2.42% daily) -> 2.00x in 29 days

-- 1. Disable obsolete or test slots
UPDATE trade_slots
SET enabled = FALSE, updated_at = NOW()
WHERE id IN ('slot-1645', 'slot-1830', 'slot-test-0103', 'slot-test-0105');

-- 2. Configure Slot 1 (Session 1: 17:00 UTC+3, 117 bps / +1.17%)
INSERT INTO trade_slots (
  id, name, local_time, timezone, days_of_week, asset, direction,
  duration_sec, settlement_bps, eligibility, opens_offset_min, closes_after_min, mode, enabled
)
VALUES (
  'slot-1700', 'الصفقة الأولى - الجلسة الأولى', '17:00', 'Europe/Istanbul',
  '[0,1,2,3,4,5,6]'::jsonb, 'BTCUSD', 'BUY', 60, 117, 'all', 0, 60, 'auto', TRUE
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

-- 3. Configure Slot 2 (Session 2: 20:30 UTC+3, 124 bps / +1.24% - Agent Gold VIP)
INSERT INTO trade_slots (
  id, name, local_time, timezone, days_of_week, asset, direction,
  duration_sec, settlement_bps, eligibility, opens_offset_min, closes_after_min, mode, enabled
)
VALUES (
  'slot-2030', 'الصفقة الثانية - صفقة وكيل أورين', '20:30', 'Europe/Istanbul',
  '[0,1,2,3,4,5,6]'::jsonb, 'XAUUSD', 'BUY', 180, 124, 'all', 0, 60, 'auto', TRUE
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
