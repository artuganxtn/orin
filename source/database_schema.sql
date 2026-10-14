
-- Extension for cryptographic helpers if needed
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

CREATE OR REPLACE FUNCTION prevent_audit_change() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit table is append-only: updates and deletes are prohibited';
END;
$$ LANGUAGE plpgsql;

-- 1. PROFILES
CREATE TABLE profiles (
  id VARCHAR(128) PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  display_name VARCHAR(100),
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  tier VARCHAR(20) NOT NULL DEFAULT 'standard',
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
  type VARCHAR(20) NOT NULL DEFAULT 'real',
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  reserved_cents BIGINT NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  realized_cents BIGINT NOT NULL DEFAULT 0,
  bonus_cents BIGINT NOT NULL DEFAULT 0 CHECK (bonus_cents >= 0),
  bonus_reserved_cents BIGINT NOT NULL DEFAULT 0 CHECK (bonus_reserved_cents >= 0),
  bonus_profit_cents BIGINT NOT NULL DEFAULT 0 CHECK (bonus_profit_cents >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  revision INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. JOURNALS & JOURNAL_ENTRIES
CREATE TABLE journals (
  id VARCHAR(128) PRIMARY KEY,
  kind VARCHAR(50) NOT NULL,
  reference VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE journal_entries (
  id BIGSERIAL PRIMARY KEY,
  journal_id VARCHAR(128) NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  user_id VARCHAR(128) REFERENCES profiles(id),
  account_id VARCHAR(128) REFERENCES accounts(id),
  bucket VARCHAR(64) NOT NULL,
  amount_cents BIGINT NOT NULL
);

CREATE CONSTRAINT TRIGGER trg_journal_balance
AFTER INSERT OR UPDATE ON journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_journal_balance();

-- 4. CONTRACTS
CREATE TABLE contracts (
  id VARCHAR(128) PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  asset VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  duration_sec INT NOT NULL,
  settlement_bps INT NOT NULL,
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  eligibility VARCHAR(50) NOT NULL DEFAULT 'all',
  hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(128)
);

-- 5. POSITIONS
CREATE TABLE positions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  contract_id VARCHAR(128) NOT NULL REFERENCES contracts(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  amount_cents BIGINT NOT NULL,
  result_cents BIGINT NOT NULL,
  is_bonus BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ
);

-- 6. RECEIPTS
CREATE TABLE receipts (
  id VARCHAR(128) PRIMARY KEY,
  position_id VARCHAR(64) NOT NULL UNIQUE REFERENCES positions(id),
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  payload JSONB NOT NULL,
  hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. DEPOSITS & PAYMENT_IDS
CREATE TABLE deposits (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  amount_cents BIGINT NOT NULL,
  coin VARCHAR(30) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'nowpayments',
  payment_id VARCHAR(128),
  pay_address VARCHAR(256),
  status VARCHAR(50) NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE TABLE payment_ids (
  payment_id VARCHAR(128) PRIMARY KEY,
  deposit_id VARCHAR(128) NOT NULL REFERENCES deposits(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. TRUSTED_EVENTS
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

-- 9. CUSTOMER_REGISTRY & VERIFIED_CUSTOMERS
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

-- 10. PROGRAM ENTITIES
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
  amount_cents BIGINT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  evidence_id VARCHAR(128),
  approval_id VARCHAR(128),
  qualified_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bonus_wallets (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  bonus_cents BIGINT NOT NULL DEFAULT 0,
  reserved_bonus_cents BIGINT NOT NULL DEFAULT 0,
  profit_cents BIGINT NOT NULL DEFAULT 0,
  withdrawable_profit_cents BIGINT NOT NULL DEFAULT 0,
  qualified_deposit_cents BIGINT NOT NULL DEFAULT 0,
  profit_limit_cents BIGINT NOT NULL DEFAULT 20000,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
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

-- 11. APPROVALS & FINANCIAL_REFERENCES
CREATE TABLE approvals (
  id VARCHAR(128) PRIMARY KEY,
  kind VARCHAR(30) NOT NULL,
  reward_kind VARCHAR(30),
  reward_id VARCHAR(128),
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  delta_cents BIGINT NOT NULL,
  before_cents BIGINT NOT NULL,
  after_cents BIGINT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL,
  reference VARCHAR(128) NOT NULL,
  requested_by VARCHAR(128) NOT NULL REFERENCES profiles(id),
  approved_by VARCHAR(128) REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

CREATE TABLE financial_references (
  reference_hash VARCHAR(64) PRIMARY KEY,
  reference VARCHAR(128) NOT NULL,
  approval_id VARCHAR(128) NOT NULL REFERENCES approvals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. WITHDRAWAL_REQUESTS
CREATE TABLE withdrawal_requests (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  coin VARCHAR(30) NOT NULL,
  address VARCHAR(256) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'paid', 'rejected')),
  approval_id VARCHAR(128) REFERENCES approvals(id),
  tx_hash VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. STAFF & AUDIT
CREATE TABLE staff (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  valid_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit (
  id BIGSERIAL PRIMARY KEY,
  actor_id VARCHAR(128),
  action VARCHAR(100) NOT NULL,
  reference VARCHAR(128),
  payload JSONB,
  payload_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_audit_immutable
BEFORE UPDATE OR DELETE ON audit
FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();

-- 14. KYC_FILES & ACCESS LOG
CREATE TABLE kyc_files (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  country VARCHAR(2) NOT NULL,
  document_type VARCHAR(50) NOT NULL,
  id_number_full TEXT NOT NULL,
  document_image_data TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'review',
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

-- 15. DOCS (Low-risk collections)
CREATE TABLE docs (
  collection VARCHAR(64) NOT NULL,
  id VARCHAR(128) NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);

-- 16. RECONCILIATION VIEW
CREATE OR REPLACE VIEW account_ledger_reconciliation AS
WITH ledger_sums AS (
  SELECT
    user_id,
    account_id,
    COALESCE(SUM(CASE WHEN bucket IN ('cash', 'reserved') THEN amount_cents ELSE 0 END), 0) AS total_cash_reserved_ledger,
    COALESCE(SUM(CASE WHEN bucket IN ('bonus', 'bonus_reserved', 'bonus_profit') THEN amount_cents ELSE 0 END), 0) AS total_bonus_ledger
  FROM journal_entries
  WHERE user_id IS NOT NULL
  GROUP BY user_id, account_id
)
SELECT
  a.user_id,
  a.id AS account_id,
  a.balance_cents,
  a.reserved_cents,
  (a.balance_cents + a.reserved_cents) AS account_cash_total,
  COALESCE(l.total_cash_reserved_ledger, 0) AS ledger_cash_total,
  ((a.balance_cents + a.reserved_cents) - COALESCE(l.total_cash_reserved_ledger, 0)) AS cash_discrepancy,
  (a.bonus_cents + a.bonus_reserved_cents + a.bonus_profit_cents) AS account_bonus_total,
  COALESCE(l.total_bonus_ledger, 0) AS ledger_bonus_total,
  ((a.bonus_cents + a.bonus_reserved_cents + a.bonus_profit_cents) - COALESCE(l.total_bonus_ledger, 0)) AS bonus_discrepancy
FROM accounts a
LEFT JOIN ledger_sums l ON a.user_id = l.user_id AND a.id = l.account_id;
