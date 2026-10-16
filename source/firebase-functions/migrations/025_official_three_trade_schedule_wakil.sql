-- 025_official_three_trade_schedule_wakil.sql
-- Restore the 3 official daily trade slots:
-- 1. slot-1645: 16:45 (Day 1 Session 1 - all users, BTCUSD BUY 60s 118 bps / 1.18%)
-- 2. slot-1830: 18:30 (Day 1 Session 2 - all users, XAUUSD BUY 180s 122 bps / 1.22%)
-- 3. slot-2030: 20:30 (Day 1 Session 3 - Wakil only, ETHUSD BUY 90s 109 bps / 1.09%)
--
-- Balance Doubling Schedule:
-- - Regular users: 2 trades/day (16:45 & 18:30) -> balance doubles in 29 days (~2.418% daily compound)
-- - Wakil users: 3 trades/day (16:45, 18:30 & 20:30) -> balance doubles in 20 days (~3.526% daily compound)

-- 1. Remove obsolete or erroneous slots (such as slot-1700)
DELETE FROM scheduled_runs WHERE slot_id NOT IN ('slot-1645', 'slot-1830', 'slot-2030');
DELETE FROM trade_slots WHERE id NOT IN ('slot-1645', 'slot-1830', 'slot-2030');

-- 2. Upsert slot-1645 (16:45 Turkey Time)
INSERT INTO trade_slots (
  id, name, local_time, timezone, days_of_week,
  asset, direction, duration_sec, settlement_bps,
  eligibility, opens_offset_min, closes_after_min, mode, enabled, updated_at
)
VALUES (
  'slot-1645',
  'اقتناص قمة البيتكوين - جلسة لندن',
  '16:45',
  'Europe/Istanbul',
  '[0,1,2,3,4,5,6]'::jsonb,
  'BTCUSD',
  'BUY',
  60,
  118,
  'all',
  0,
  60,
  'auto',
  TRUE,
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  local_time = '16:45',
  timezone = 'Europe/Istanbul',
  days_of_week = EXCLUDED.days_of_week,
  asset = EXCLUDED.asset,
  direction = EXCLUDED.direction,
  duration_sec = EXCLUDED.duration_sec,
  settlement_bps = EXCLUDED.settlement_bps,
  eligibility = 'all',
  mode = 'auto',
  enabled = TRUE,
  updated_at = NOW();

-- 3. Upsert slot-1830 (18:30 Turkey Time)
INSERT INTO trade_slots (
  id, name, local_time, timezone, days_of_week,
  asset, direction, duration_sec, settlement_bps,
  eligibility, opens_offset_min, closes_after_min, mode, enabled, updated_at
)
VALUES (
  'slot-1830',
  'زخم الذهب الفوري - افتتاح نيويورك',
  '18:30',
  'Europe/Istanbul',
  '[0,1,2,3,4,5,6]'::jsonb,
  'XAUUSD',
  'BUY',
  180,
  122,
  'all',
  0,
  60,
  'auto',
  TRUE,
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  local_time = '18:30',
  timezone = 'Europe/Istanbul',
  days_of_week = EXCLUDED.days_of_week,
  asset = EXCLUDED.asset,
  direction = EXCLUDED.direction,
  duration_sec = EXCLUDED.duration_sec,
  settlement_bps = EXCLUDED.settlement_bps,
  eligibility = 'all',
  mode = 'auto',
  enabled = TRUE,
  updated_at = NOW();

-- 4. Upsert slot-2030 (20:30 Turkey Time - Wakil Only)
INSERT INTO trade_slots (
  id, name, local_time, timezone, days_of_week,
  asset, direction, duration_sec, settlement_bps,
  eligibility, opens_offset_min, closes_after_min, mode, enabled, updated_at
)
VALUES (
  'slot-2030',
  'صفقة الوكيل المعتمد - اقتناص سيولة الإيثيريوم',
  '20:30',
  'Europe/Istanbul',
  '[0,1,2,3,4,5,6]'::jsonb,
  'ETHUSD',
  'BUY',
  90,
  109,
  'advanced',
  0,
  60,
  'auto',
  TRUE,
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  local_time = '20:30',
  timezone = 'Europe/Istanbul',
  days_of_week = EXCLUDED.days_of_week,
  asset = EXCLUDED.asset,
  direction = EXCLUDED.direction,
  duration_sec = EXCLUDED.duration_sec,
  settlement_bps = EXCLUDED.settlement_bps,
  eligibility = 'advanced',
  mode = 'auto',
  enabled = TRUE,
  updated_at = NOW();
