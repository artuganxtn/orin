-- =====================================================================
-- COMPLETE ORIN POSTGRESQL SCHEMA (CONSOLIDATED DDL)
-- =====================================================================

-- SCHEMA MIGRATIONS TABLE
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. PROFILES
CREATE TABLE profiles (
  id VARCHAR(128) PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  display_name VARCHAR(100),
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  tier VARCHAR(20) NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'advanced', 'vip')),
  accepted_at TIMESTAMPTZ,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. ACCOUNTS
CREATE TABLE accounts (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  account_number VARCHAR(12) NOT NULL UNIQUE,
  type VARCHAR(20) NOT NULL DEFAULT 'real' CHECK (type IN ('real', 'demo')),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  reserved_cents BIGINT NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  realized_cents BIGINT NOT NULL DEFAULT 0,
  bonus_cents BIGINT NOT NULL DEFAULT 0 CHECK (bonus_cents >= 0),
  bonus_reserved_cents BIGINT NOT NULL DEFAULT 0 CHECK (bonus_reserved_cents >= 0),
  bonus_profit_cents BIGINT NOT NULL DEFAULT 0 CHECK (bonus_profit_cents >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  revision INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_accounts_one_real_per_user ON accounts(user_id) WHERE type = 'real';

-- 3. ONE LEDGER: JOURNALS & JOURNAL_ENTRIES
CREATE TABLE journals (
  id VARCHAR(128) PRIMARY KEY,
  kind VARCHAR(50) NOT NULL CHECK (kind IN ('deposit', 'allocation', 'settlement', 'adjustment', 'referral_reward', 'team_activity', 'nonwithdrawable_bonus', 'bonus_allocation', 'bonus_settlement', 'bonus_profit_unlock', 'withdrawal', 'bonus_expired', 'early_exit_fee', 'withdrawal_fee', 'wallet_transfer')),
  reference VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE journal_entries (
  id BIGSERIAL PRIMARY KEY,
  journal_id VARCHAR(128) NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  user_id VARCHAR(128) REFERENCES profiles(id),
  account_id VARCHAR(128) REFERENCES accounts(id),
  bucket VARCHAR(64) NOT NULL CHECK (
    bucket IN ('cash', 'reserved', 'bonus', 'bonus_reserved', 'bonus_profit')
    OR bucket LIKE 'system:%'
  ),
  amount_cents BIGINT NOT NULL,
  CONSTRAINT chk_bucket_system_nullness CHECK (
    (bucket LIKE 'system:%' AND user_id IS NULL AND account_id IS NULL)
    OR
    (bucket NOT LIKE 'system:%' AND user_id IS NOT NULL AND account_id IS NOT NULL)
  )
);

-- 4. CONTRACTS & REVOCATION
CREATE TABLE contracts (
  id VARCHAR(128) PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  asset VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  duration_sec INT NOT NULL,
  settlement_bps INT NOT NULL,
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  eligibility VARCHAR(50) NOT NULL DEFAULT 'all' CHECK (eligibility IN ('all', 'standard', 'advanced', 'vip')),
  canonical TEXT,
  published_at TIMESTAMPTZ,
  admin_id VARCHAR(128) REFERENCES profiles(id),
  hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contract_revocation_state (
  contract_id VARCHAR(128) PRIMARY KEY REFERENCES contracts(id),
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  revoked_by VARCHAR(128) REFERENCES profiles(id),
  revoked_at TIMESTAMPTZ
);

-- 5. POSITIONS & RECEIPTS
CREATE TABLE positions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  contract_id VARCHAR(128) NOT NULL REFERENCES contracts(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  result_cents BIGINT NOT NULL,
  is_bonus BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ,
  CONSTRAINT uq_positions_user_contract UNIQUE (user_id, contract_id)
);

CREATE TABLE receipts (
  id VARCHAR(128) PRIMARY KEY,
  position_id VARCHAR(64) NOT NULL UNIQUE REFERENCES positions(id),
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  payload JSONB NOT NULL,
  hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. DEPOSITS & PAYMENT REVIEWS
CREATE TABLE deposits (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  coin VARCHAR(30) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'nowpayments',
  payment_id VARCHAR(128),
  pay_address VARCHAR(256),
  status VARCHAR(50) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'confirming', 'confirmed', 'sending', 'finished', 'failed', 'refunded', 'expired', 'review', 'partially_paid')),
  credited BOOLEAN NOT NULL DEFAULT FALSE,
  credited_cents BIGINT NOT NULL DEFAULT 0,
  actually_paid TEXT,
  review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE TABLE payment_reviews (
  id VARCHAR(128) PRIMARY KEY,
  deposit_id VARCHAR(128) NOT NULL REFERENCES deposits(id),
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'rejected')),
  resolved_by VARCHAR(128) REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE payment_ids (
  payment_id VARCHAR(128) PRIMARY KEY,
  deposit_id VARCHAR(128) NOT NULL REFERENCES deposits(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. STAFF, SECURITY ACCESS & SESSIONS
CREATE TABLE staff (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  valid_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE access_status (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'suspended')),
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE session_revocations (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  valid_after TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. BONUS WALLETS & AUDIT
CREATE TABLE bonus_wallets (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  profit_limit_cents BIGINT NOT NULL CHECK (profit_limit_cents >= 0),
  first_deposit_cents BIGINT NOT NULL CHECK (first_deposit_cents >= 0),
  eligible_assets JSONB NOT NULL,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit (
  id BIGSERIAL PRIMARY KEY,
  actor_id VARCHAR(128),
  action VARCHAR(100) NOT NULL,
  reference VARCHAR(128),
  payload JSONB,
  payload_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_audit_action_reference UNIQUE (action, reference)
);

-- 9. APPROVALS & WITHDRAWALS
CREATE TABLE approvals (
  id VARCHAR(128) PRIMARY KEY,
  kind VARCHAR(30) NOT NULL CHECK (kind IN ('adjustment', 'referral_reward', 'team_activity', 'withdrawal')),
  reward_kind VARCHAR(30),
  reward_id VARCHAR(128),
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  delta_cents BIGINT NOT NULL,
  before_cents BIGINT NOT NULL,
  after_cents BIGINT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason TEXT NOT NULL,
  reference VARCHAR(128) NOT NULL,
  requested_by VARCHAR(128) NOT NULL REFERENCES profiles(id),
  approved_by VARCHAR(128) REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  CONSTRAINT chk_approvals_no_self_approval CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE TABLE withdrawal_requests (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  coin VARCHAR(30) NOT NULL,
  address VARCHAR(256) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'paid', 'rejected')),
  approval_id VARCHAR(128) REFERENCES approvals(id),
  tx_hash VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. LOW-RISK DOCS (WITH OWNER_ID & INDEX)
CREATE TABLE docs (
  collection VARCHAR(64) NOT NULL,
  id VARCHAR(128) NOT NULL,
  owner_id VARCHAR(128) REFERENCES profiles(id),
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);

CREATE INDEX idx_docs_owner ON docs(collection, owner_id);

-- 11. ANCILLARY REGISTRIES
CREATE TABLE customer_registry (
  customer_key VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL UNIQUE REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE verified_customers (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  customer_key VARCHAR(64) NOT NULL REFERENCES customer_registry(customer_key),
  id_number_last4 VARCHAR(4) NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  event_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE kyc_files (
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

CREATE TABLE kyc_access_log (
  id BIGSERIAL PRIMARY KEY,
  staff_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  kyc_file_id VARCHAR(128) NOT NULL REFERENCES kyc_files(id),
  action VARCHAR(50) NOT NULL,
  reason TEXT NOT NULL,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE kyc_requests (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  customer_key VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id VARCHAR(128) REFERENCES profiles(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE program_members (
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

CREATE TABLE referral_rewards (
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

CREATE TABLE referral_codes (
  code VARCHAR(30) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL UNIQUE REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE referral_attributions (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  referral_code VARCHAR(30) NOT NULL REFERENCES referral_codes(code),
  referrer_user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE commands (
  fingerprint VARCHAR(64) PRIMARY KEY,
  action VARCHAR(50) NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE program_evidence (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  kind VARCHAR(50) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE qualified_deposits (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  deposit_id VARCHAR(128) NOT NULL REFERENCES deposits(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bonus_claims (
  customer_key VARCHAR(64) PRIMARY KEY REFERENCES customer_registry(customer_key),
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE eligible_revenue (
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

CREATE TABLE activity_payments (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  period_id VARCHAR(30) NOT NULL,
  cents BIGINT NOT NULL,
  approval_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period_id)
);

CREATE TABLE financial_references (
  reference_hash VARCHAR(64) PRIMARY KEY,
  reference VARCHAR(128) NOT NULL,
  approval_id VARCHAR(128) NOT NULL REFERENCES approvals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE program_configuration (
  key VARCHAR(64) PRIMARY KEY,
  config JSONB NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE program_configuration_history (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(64) NOT NULL,
  config JSONB NOT NULL,
  revision INT NOT NULL,
  changed_by VARCHAR(128) REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE control_configuration (
  key VARCHAR(64) PRIMARY KEY,
  config JSONB NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE deposit_rate_limits (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trusted_events (
  event_id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  account_id VARCHAR(128),
  type VARCHAR(50) NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  cents BIGINT,
  status VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. TRIGGERS & PROCEDURES
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% table is append-only: updates and deletes are prohibited', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_audit_change() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit table is append-only: updates and deletes are prohibited';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_account_balance_update() RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.balance_cents <> OLD.balance_cents OR
      NEW.reserved_cents <> OLD.reserved_cents OR
      NEW.bonus_cents <> OLD.bonus_cents OR
      NEW.bonus_reserved_cents <> OLD.bonus_reserved_cents OR
      NEW.bonus_profit_cents <> OLD.bonus_profit_cents) THEN
    IF current_setting('app.ledger_mutation', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Direct update of balance columns on accounts is prohibited. Use journal entries.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION apply_journal_entry_to_account() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_id IS NOT NULL THEN
    PERFORM set_config('app.ledger_mutation', 'on', true);
    IF NEW.bucket = 'cash' THEN
      UPDATE accounts SET balance_cents = balance_cents + NEW.amount_cents, updated_at = NOW() WHERE id = NEW.account_id;
    ELSIF NEW.bucket = 'reserved' THEN
      UPDATE accounts SET reserved_cents = reserved_cents + NEW.amount_cents, updated_at = NOW() WHERE id = NEW.account_id;
    ELSIF NEW.bucket = 'bonus' THEN
      UPDATE accounts SET bonus_cents = bonus_cents + NEW.amount_cents, updated_at = NOW() WHERE id = NEW.account_id;
    ELSIF NEW.bucket = 'bonus_reserved' THEN
      UPDATE accounts SET bonus_reserved_cents = bonus_reserved_cents + NEW.amount_cents, updated_at = NOW() WHERE id = NEW.account_id;
    ELSIF NEW.bucket = 'bonus_profit' THEN
      UPDATE accounts SET bonus_profit_cents = bonus_profit_cents + NEW.amount_cents, updated_at = NOW() WHERE id = NEW.account_id;
    END IF;
    PERFORM set_config('app.ledger_mutation', 'off', true);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION check_journal_entry_count() RETURNS TRIGGER AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM journal_entries WHERE journal_id = NEW.id;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'Journal % must have at least 2 entries, found %', NEW.id, v_count;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_journal_balance() RETURNS TRIGGER AS $$
DECLARE
  v_sum BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_sum
  FROM journal_entries
  WHERE journal_id = NEW.journal_id;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'Journal % entries do not balance: sum is % cents', NEW.journal_id, v_sum;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_account_balance_update
BEFORE UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION check_account_balance_update();

CREATE TRIGGER trg_journals_immutable
BEFORE UPDATE OR DELETE ON journals
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE CONSTRAINT TRIGGER trg_check_journal_entry_count
AFTER INSERT ON journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_journal_entry_count();

CREATE TRIGGER trg_journal_entries_immutable
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE TRIGGER trg_apply_journal_entry
AFTER INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION apply_journal_entry_to_account();

CREATE CONSTRAINT TRIGGER trg_journal_balance
AFTER INSERT OR UPDATE ON journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_journal_balance();

CREATE TRIGGER trg_audit_immutable
BEFORE UPDATE OR DELETE ON audit
FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();

-- 13. RECONCILIATION VIEW
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
