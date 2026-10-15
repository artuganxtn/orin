-- 017_telegram_credentials_and_test_slot.sql

-- Reset any failed telegram_outbox messages to pending so they can be dispatched with the verified bot token
UPDATE telegram_outbox
SET status = 'pending', attempts = 0, next_attempt_at = NOW()
WHERE status = 'failed';

-- Delete any stale runs for the test slot today
DELETE FROM scheduled_runs
WHERE slot_id IN ('slot-test-0103', 'slot-test-0105')
  AND run_date = TO_CHAR(NOW() AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD');

-- Insert the scheduled test trade slot for 15-16 minutes from now (01:05 Europe/Istanbul)
INSERT INTO trade_slots (
  id, name, local_time, timezone, days_of_week, asset, direction,
  duration_sec, settlement_bps, eligibility, opens_offset_min, closes_after_min, mode, enabled
)
VALUES
  ('slot-test-0105', 'صفقة اختبارية معتمدة - ذهب (XAU/USD)', '01:05', 'Europe/Istanbul', '[0,1,2,3,4,5,6]'::jsonb, 'XAUUSD', 'BUY', 180, 900, 'all', 0, 60, 'auto', TRUE)
ON CONFLICT (id) DO UPDATE SET
  local_time = EXCLUDED.local_time,
  mode = 'auto',
  enabled = TRUE,
  updated_at = NOW();
