-- 015_support_assistant_idempotency.sql
-- Enforces atomic 1-reply per customer message and advisory locks for support assistant

CREATE TABLE IF NOT EXISTS support_assistant_replies (
  thread_id VARCHAR(128) NOT NULL,
  in_reply_to VARCHAR(128) NOT NULL,
  assistant_message_id VARCHAR(128) NOT NULL,
  reply_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, in_reply_to)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_assistant_replies_uniq 
  ON support_assistant_replies (thread_id, in_reply_to);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orin_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON support_assistant_replies TO orin_app;
  END IF;
END $$;
