-- 023_rename_slots_no_wakil.sql
-- Safely update the 2 official trade slots to Day 1 with no wakil orin

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

-- Ensure all other slots are removed
DELETE FROM scheduled_runs WHERE slot_id NOT IN ('slot-1700', 'slot-2030');
DELETE FROM trade_slots WHERE id NOT IN ('slot-1700', 'slot-2030');
