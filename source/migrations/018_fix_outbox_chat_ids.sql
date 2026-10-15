-- 018_fix_outbox_chat_ids.sql
-- Normalize chat_id in any existing outbox records and reset them for immediate dispatch
UPDATE telegram_outbox
SET status = 'pending',
    attempts = 0,
    next_attempt_at = NOW(),
    payload = jsonb_set(payload, '{body,chat_id}', '"-1003753942964"'::jsonb),
    updated_at = NOW()
WHERE status IN ('pending', 'failed');
