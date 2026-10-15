-- 020_cleanup_manual_test_slots.sql
-- Ensure only the 2 official slots (slot-1700 and slot-2030) are active
UPDATE trade_slots
SET enabled = FALSE, updated_at = NOW()
WHERE id NOT IN ('slot-1700', 'slot-2030');
