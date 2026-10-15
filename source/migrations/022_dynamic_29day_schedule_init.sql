-- 022_dynamic_29day_schedule_init.sql
-- Initialize the 2 daily slots to Day 1 of the 29-day doubling challenge
-- Clear any test runs and ensure strictly only these 2 slots exist

-- 1. Clear old runs
DELETE FROM scheduled_runs WHERE slot_id NOT IN ('slot-1700', 'slot-2030');

-- 2. Delete any slots other than slot-1700 and slot-2030
DELETE FROM trade_slots WHERE id NOT IN ('slot-1700', 'slot-2030');

-- 3. Configure Day 1 Session 1 (17:00 UTC+3, BTCUSD BUY 60s, 118 bps / +1.18%)
UPDATE trade_slots
SET name = 'اقتناص قمة البيتكوين - جلسة لندن',
    asset = 'BTCUSD',
    direction = 'BUY',
    duration_sec = 60,
    settlement_bps = 118,
    mode = 'auto',
    enabled = TRUE,
    updated_at = NOW()
WHERE id = 'slot-1700';

-- 4. Configure Day 1 Session 2 (20:30 UTC+3, XAUUSD BUY 180s, 122 bps / +1.22%)
UPDATE trade_slots
SET name = 'زخم الذهب الفوري - افتتاح نيويورك',
    asset = 'XAUUSD',
    direction = 'BUY',
    duration_sec = 180,
    settlement_bps = 122,
    mode = 'auto',
    enabled = TRUE,
    updated_at = NOW()
WHERE id = 'slot-2030';
