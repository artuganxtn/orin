-- 021_delete_obsolete_trade_slots.sql
-- Clean up all obsolete and test slots so only the 2 official slots exist

-- 1. Remove runs pointing to obsolete slots
DELETE FROM scheduled_runs
WHERE slot_id NOT IN ('slot-1700', 'slot-2030');

-- 2. Delete all slots except the two official daily slots
DELETE FROM trade_slots
WHERE id NOT IN ('slot-1700', 'slot-2030');
