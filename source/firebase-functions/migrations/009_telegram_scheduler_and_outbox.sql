-- 009_telegram_scheduler_and_outbox.sql

CREATE TABLE IF NOT EXISTS trade_slots (
  id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  local_time VARCHAR(8) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Istanbul',
  days_of_week JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
  asset VARCHAR(32) NOT NULL DEFAULT 'BTCUSD',
  direction VARCHAR(8) NOT NULL DEFAULT 'BUY',
  duration_sec INTEGER NOT NULL DEFAULT 60,
  settlement_bps INTEGER NOT NULL DEFAULT 850,
  eligibility VARCHAR(32) NOT NULL DEFAULT 'all',
  opens_offset_min INTEGER NOT NULL DEFAULT 0,
  closes_after_min INTEGER NOT NULL DEFAULT 60,
  mode VARCHAR(16) NOT NULL DEFAULT 'review',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_runs (
  id VARCHAR(128) PRIMARY KEY,
  slot_id VARCHAR(128) NOT NULL REFERENCES trade_slots(id),
  run_date VARCHAR(10) NOT NULL,
  status VARCHAR(24) NOT NULL,
  contract_id VARCHAR(128) REFERENCES contracts(id),
  telegram_message_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(slot_id, run_date)
);

CREATE TABLE IF NOT EXISTS telegram_outbox (
  id VARCHAR(128) PRIMARY KEY,
  kind VARCHAR(32) NOT NULL,
  contract_id VARCHAR(128) NOT NULL REFERENCES contracts(id),
  payload JSONB NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  message_id VARCHAR(128),
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(kind, contract_id)
);

INSERT INTO trade_slots (id, name, local_time, timezone, days_of_week, asset, direction, duration_sec, settlement_bps, eligibility, opens_offset_min, closes_after_min, mode, enabled)
VALUES
  ('slot-1645', 'الصفقة الأولى - العصر', '16:45', 'Europe/Istanbul', '[0,1,2,3,4,5,6]'::jsonb, 'BTCUSD', 'BUY', 60, 850, 'all', 0, 60, 'review', TRUE),
  ('slot-1830', 'الصفقة الثانية - المساء', '18:30', 'Europe/Istanbul', '[0,1,2,3,4,5,6]'::jsonb, 'ETHUSD', 'BUY', 120, 850, 'all', 0, 60, 'review', TRUE),
  ('slot-2030', 'صفقة وكيل أورين - الليل', '20:30', 'Europe/Istanbul', '[0,1,2,3,4,5,6]'::jsonb, 'XAUUSD', 'BUY', 180, 900, 'all', 0, 60, 'auto', TRUE)
ON CONFLICT (id) DO NOTHING;
