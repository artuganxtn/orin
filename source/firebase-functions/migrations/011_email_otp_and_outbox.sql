-- 011_email_otp_and_outbox.sql

CREATE TABLE IF NOT EXISTS otp_challenges (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) REFERENCES profiles(id),
  email VARCHAR(255) NOT NULL,
  purpose VARCHAR(64) NOT NULL,
  code_hmac VARCHAR(128) NOT NULL,
  bound_hash VARCHAR(128),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip VARCHAR(45) NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS otp_proofs (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NULL REFERENCES profiles(id),
  purpose VARCHAR(64) NOT NULL,
  bound_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE otp_proofs ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS email_outbox (
  id VARCHAR(128) PRIMARY KEY,
  to_email VARCHAR(255) NOT NULL,
  template VARCHAR(64) NOT NULL,
  locale VARCHAR(8) NOT NULL DEFAULT 'ar',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  dedupe_key VARCHAR(128) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS email_preferences (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  daily_reminder BOOLEAN NOT NULL DEFAULT FALSE,
  marketing BOOLEAN NOT NULL DEFAULT FALSE,
  locale VARCHAR(8) NOT NULL DEFAULT 'ar',
  unsubscribe_token_hash VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orin_app') THEN
    GRANT SELECT, INSERT, UPDATE ON otp_challenges TO orin_app;
    GRANT SELECT, INSERT, UPDATE ON otp_proofs TO orin_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON email_outbox TO orin_app;
    GRANT SELECT, INSERT, UPDATE ON email_preferences TO orin_app;
  END IF;
END $$;
