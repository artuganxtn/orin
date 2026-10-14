-- 016_auto_mode_trade_slots.sql
-- Update trade_slots default mode to 'auto' and make existing slots auto and enabled.
ALTER TABLE trade_slots ALTER COLUMN mode SET DEFAULT 'auto';
UPDATE trade_slots SET mode = 'auto', enabled = TRUE;

-- Clear any missed runs for today so the scheduler can immediately process valid windows
DELETE FROM scheduled_runs
WHERE status = 'missed'
  AND run_date = TO_CHAR(NOW() AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD');
