-- =====================================================================
-- MIGRATION 003: DOCS, ANCILLARY TABLES, OWNER INDEXES & RECONCILIATION VIEW
-- =====================================================================

CREATE TABLE IF NOT EXISTS docs (
  collection VARCHAR(64) NOT NULL,
  id VARCHAR(128) NOT NULL,
  owner_id VARCHAR(128) REFERENCES profiles(id),
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);

ALTER TABLE docs ADD COLUMN IF NOT EXISTS owner_id VARCHAR(128) REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS idx_docs_owner ON docs(collection, owner_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_audit_action_reference') THEN
    ALTER TABLE audit ADD CONSTRAINT uq_audit_action_reference UNIQUE (action, reference);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS customer_registry (
  customer_key VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL UNIQUE REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verified_customers (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  customer_key VARCHAR(64) NOT NULL REFERENCES customer_registry(customer_key),
  id_number_last4 VARCHAR(4) NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  event_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kyc_files (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  country VARCHAR(2) NOT NULL,
  document_type VARCHAR(50) NOT NULL,
  id_number_encrypted TEXT NOT NULL,
  id_number_iv VARCHAR(32) NOT NULL,
  id_number_tag VARCHAR(32) NOT NULL,
  document_image_encrypted TEXT NOT NULL,
  document_image_iv VARCHAR(32) NOT NULL,
  document_image_tag VARCHAR(32) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'verified', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kyc_access_log (
  id BIGSERIAL PRIMARY KEY,
  staff_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  kyc_file_id VARCHAR(128) NOT NULL REFERENCES kyc_files(id),
  action VARCHAR(50) NOT NULL,
  reason TEXT NOT NULL,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kyc_requests (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  customer_key VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id VARCHAR(128) REFERENCES profiles(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS program_members (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  referral_code VARCHAR(30) NOT NULL UNIQUE,
  parent_user_id VARCHAR(128) REFERENCES profiles(id),
  ancestors JSONB NOT NULL DEFAULT '[]'::jsonb,
  badges JSONB NOT NULL DEFAULT '[]'::jsonb,
  direct_count INT NOT NULL DEFAULT 0,
  team_count INT NOT NULL DEFAULT 0,
  qualified_count INT NOT NULL DEFAULT 0,
  active_team_count INT NOT NULL DEFAULT 0,
  paid_cents BIGINT NOT NULL DEFAULT 0,
  pending_cents BIGINT NOT NULL DEFAULT 0,
  activity_reward_cents BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  referred_user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  referrer_user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
  evidence_id VARCHAR(128),
  approval_id VARCHAR(128),
  qualified_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_codes (
  code VARCHAR(30) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL UNIQUE REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_attributions (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  referral_code VARCHAR(30) NOT NULL REFERENCES referral_codes(code),
  referrer_user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commands (
  fingerprint VARCHAR(64) PRIMARY KEY,
  action VARCHAR(50) NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS program_evidence (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  kind VARCHAR(50) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qualified_deposits (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  deposit_id VARCHAR(128) NOT NULL REFERENCES deposits(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bonus_claims (
  customer_key VARCHAR(64) PRIMARY KEY REFERENCES customer_registry(customer_key),
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eligible_revenue (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  period_id VARCHAR(30) NOT NULL,
  net_revenue_cents BIGINT NOT NULL,
  direct INT NOT NULL,
  active_team INT NOT NULL,
  finalized BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TIMESTAMPTZ,
  approval_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period_id)
);

CREATE TABLE IF NOT EXISTS activity_payments (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  period_id VARCHAR(30) NOT NULL,
  cents BIGINT NOT NULL,
  approval_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period_id)
);

CREATE TABLE IF NOT EXISTS financial_references (
  reference_hash VARCHAR(64) PRIMARY KEY,
  reference VARCHAR(128) NOT NULL,
  approval_id VARCHAR(128) NOT NULL REFERENCES approvals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS program_configuration (
  key VARCHAR(64) PRIMARY KEY,
  config JSONB NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS program_configuration_history (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(64) NOT NULL,
  config JSONB NOT NULL,
  revision INT NOT NULL,
  changed_by VARCHAR(128) REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_configuration (
  key VARCHAR(64) PRIMARY KEY,
  config JSONB NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposit_rate_limits (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trusted_events (
  event_id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  account_id VARCHAR(128),
  type VARCHAR(50) NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  cents BIGINT,
  status VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reconciliation View
CREATE OR REPLACE VIEW account_ledger_reconciliation AS
WITH ledger_sums AS (
  SELECT
    user_id,
    account_id,
    COALESCE(SUM(CASE WHEN bucket = 'cash' THEN amount_cents ELSE 0 END), 0) AS total_cash_ledger,
    COALESCE(SUM(CASE WHEN bucket = 'reserved' THEN amount_cents ELSE 0 END), 0) AS total_reserved_ledger,
    COALESCE(SUM(CASE WHEN bucket = 'bonus' THEN amount_cents ELSE 0 END), 0) AS total_bonus_ledger,
    COALESCE(SUM(CASE WHEN bucket = 'bonus_reserved' THEN amount_cents ELSE 0 END), 0) AS total_bonus_reserved_ledger,
    COALESCE(SUM(CASE WHEN bucket = 'bonus_profit' THEN amount_cents ELSE 0 END), 0) AS total_bonus_profit_ledger
  FROM journal_entries
  WHERE user_id IS NOT NULL
  GROUP BY user_id, account_id
)
SELECT
  a.user_id,
  a.id AS account_id,
  a.balance_cents,
  COALESCE(l.total_cash_ledger, 0) AS ledger_cash,
  (a.balance_cents - COALESCE(l.total_cash_ledger, 0)) AS cash_discrepancy,
  a.reserved_cents,
  COALESCE(l.total_reserved_ledger, 0) AS ledger_reserved,
  (a.reserved_cents - COALESCE(l.total_reserved_ledger, 0)) AS reserved_discrepancy,
  a.bonus_cents,
  COALESCE(l.total_bonus_ledger, 0) AS ledger_bonus,
  (a.bonus_cents - COALESCE(l.total_bonus_ledger, 0)) AS bonus_discrepancy,
  a.bonus_reserved_cents,
  COALESCE(l.total_bonus_reserved_ledger, 0) AS ledger_bonus_reserved,
  (a.bonus_reserved_cents - COALESCE(l.total_bonus_reserved_ledger, 0)) AS bonus_reserved_discrepancy,
  a.bonus_profit_cents,
  COALESCE(l.total_bonus_profit_ledger, 0) AS ledger_bonus_profit,
  (a.bonus_profit_cents - COALESCE(l.total_bonus_profit_ledger, 0)) AS bonus_profit_discrepancy
FROM accounts a
LEFT JOIN ledger_sums l ON a.user_id = l.user_id AND a.id = l.account_id;

-- Ensure orin_app has permissions on these newly created objects
GRANT SELECT, INSERT, UPDATE ON docs, program_evidence, referral_codes, referral_attributions, commands, qualified_deposits, bonus_claims, eligible_revenue, activity_payments, financial_references, program_configuration, program_configuration_history, control_configuration, deposit_rate_limits, trusted_events TO orin_app;
GRANT SELECT, INSERT ON kyc_files, kyc_access_log, kyc_requests, customer_registry, verified_customers, program_members, referral_rewards TO orin_app;
