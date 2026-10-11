import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

const { Pool } = pg;

console.log('--- 1. STARTING REAL POSTGRESQL ENGINE ---');
const ep = new EmbeddedPostgres({
  port: 5433,
  databaseDir: './.pgdata',
  persistent: true
});

try {
  await ep.start();
} catch (e) {
  // If not initialized, initialize and start
  await ep.initialise();
  await ep.start();
}
console.log('Real PostgreSQL 18.4 engine running on localhost:5433');

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: 'password',
  database: 'postgres',
  max: 10
});

// Load and apply schema
console.log('--- 2. APPLYING COMPLETE STAGE 1 SCHEMA ---');

const schemaSql = `
-- Drop existing views/tables to ensure clean schema
DROP VIEW IF EXISTS account_ledger_reconciliation CASCADE;
DROP TABLE IF EXISTS journal_entries CASCADE;
DROP TABLE IF EXISTS journals CASCADE;
DROP TABLE IF EXISTS withdrawal_requests CASCADE;
DROP TABLE IF EXISTS financial_references CASCADE;
DROP TABLE IF EXISTS approvals CASCADE;
DROP TABLE IF EXISTS activity_payments CASCADE;
DROP TABLE IF EXISTS eligible_revenue CASCADE;
DROP TABLE IF EXISTS bonus_claims CASCADE;
DROP TABLE IF EXISTS bonus_wallets CASCADE;
DROP TABLE IF EXISTS referral_rewards CASCADE;
DROP TABLE IF EXISTS program_members CASCADE;
DROP TABLE IF EXISTS verified_customers CASCADE;
DROP TABLE IF EXISTS customer_registry CASCADE;
DROP TABLE IF EXISTS kyc_access_log CASCADE;
DROP TABLE IF EXISTS kyc_files CASCADE;
DROP TABLE IF EXISTS kyc_requests CASCADE;
DROP TABLE IF EXISTS audit CASCADE;
DROP TABLE IF EXISTS staff CASCADE;
DROP TABLE IF EXISTS payment_ids CASCADE;
DROP TABLE IF EXISTS deposits CASCADE;
DROP TABLE IF EXISTS receipts CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS docs CASCADE;
DROP TABLE IF EXISTS commands CASCADE;
DROP TABLE IF EXISTS program_evidence CASCADE;
DROP TABLE IF EXISTS qualified_deposits CASCADE;
DROP TABLE IF EXISTS referral_codes CASCADE;
DROP TABLE IF EXISTS referral_attributions CASCADE;
DROP TABLE IF EXISTS program_configuration CASCADE;
DROP TABLE IF EXISTS program_configuration_history CASCADE;
DROP TABLE IF EXISTS control_configuration CASCADE;
DROP TABLE IF EXISTS access_status CASCADE;
DROP TABLE IF EXISTS session_revocations CASCADE;
DROP TABLE IF EXISTS deposit_rate_limits CASCADE;
DROP TABLE IF EXISTS contract_revocation_state CASCADE;
DROP TABLE IF EXISTS trusted_events CASCADE;

-- Trigger Functions
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

CREATE OR REPLACE FUNCTION apply_journal_entry_to_account() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_id IS NOT NULL THEN
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_journal_balance() RETURNS TRIGGER AS $$
DECLARE
  v_sum BIGINT;
  v_count INT;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0), COUNT(*) INTO v_sum, v_count
  FROM journal_entries
  WHERE journal_id = NEW.journal_id;

  IF v_count < 2 THEN
    RAISE EXCEPTION 'Journal % must have at least 2 entries, found %', NEW.journal_id, v_count;
  END IF;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'Journal % entries do not balance: sum is % cents', NEW.journal_id, v_sum;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

-- 3. JOURNALS & JOURNAL_ENTRIES (ONE LEDGER, APPEND-ONLY)
CREATE TABLE journals (
  id VARCHAR(128) PRIMARY KEY,
  kind VARCHAR(50) NOT NULL CHECK (kind IN ('deposit', 'allocation', 'settlement', 'adjustment', 'referral_reward', 'team_activity', 'nonwithdrawable_bonus', 'bonus_allocation', 'bonus_settlement', 'bonus_profit_unlock', 'withdrawal')),
  reference VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_journals_immutable
BEFORE UPDATE OR DELETE ON journals
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

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

-- 4. CONTRACTS
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
  hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(128)
);

-- 5. POSITIONS
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
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  coin VARCHAR(30) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'nowpayments',
  payment_id VARCHAR(128),
  pay_address VARCHAR(256),
  status VARCHAR(50) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'confirming', 'confirmed', 'sending', 'finished', 'failed', 'refunded', 'expired')),
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

-- 10. PROGRAM ENTITIES & TERMS
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

-- Bonus Wallets: Terms and flags only (no balance columns)
CREATE TABLE bonus_wallets (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  account_id VARCHAR(128) NOT NULL REFERENCES accounts(id),
  profit_limit_cents BIGINT NOT NULL DEFAULT 20000 CHECK (profit_limit_cents >= 0),
  first_deposit_cents BIGINT NOT NULL DEFAULT 50000 CHECK (first_deposit_cents >= 0),
  eligible_assets JSONB NOT NULL DEFAULT '["BTCUSD", "ETHUSD"]'::jsonb,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
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

-- 11. APPROVALS & FINANCIAL_REFERENCES
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

CREATE TABLE financial_references (
  reference_hash VARCHAR(64) PRIMARY KEY,
  reference VARCHAR(128) NOT NULL,
  approval_id VARCHAR(128) NOT NULL REFERENCES approvals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. WITHDRAWAL_REQUESTS (ONE TABLE)
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

-- 13. STAFF & AUDIT
CREATE TABLE staff (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
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

-- 14. KYC_FILES & ACCESS LOG & REVIEW WORKFLOW
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

-- 15. LOW-RISK DOCS (support, tickets, campaigns, announcements, public content, demo wallets, sessions, devices, notices)
CREATE TABLE docs (
  collection VARCHAR(64) NOT NULL,
  id VARCHAR(128) NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);

-- 16. ADDITIONAL OPERATIONAL TABLES
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

CREATE TABLE access_status (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  ip_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE session_revocations (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  session_id VARCHAR(128) NOT NULL,
  reason VARCHAR(100) NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE deposit_rate_limits (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contract_revocation_state (
  contract_id VARCHAR(128) PRIMARY KEY REFERENCES contracts(id),
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  revoked_by VARCHAR(128) REFERENCES profiles(id),
  revoked_at TIMESTAMPTZ
);

-- 17. RECONCILIATION VIEW
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
`;

const client = await pool.connect();
await client.query(schemaSql);
client.release();
console.log('Stage 1 schema successfully deployed on real PostgreSQL 18.4!');

writeFileSync('../database_schema.sql', schemaSql);

// Helper for AES-256-GCM encryption of KYC files
function encryptKyc(text, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { ciphertext: encrypted, iv: iv.toString('hex'), tag };
}

const KYC_FILES_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const encryptedKycData = encryptKyc('P12345678', KYC_FILES_KEY);
const encryptedImageData = encryptKyc('data:image/jpeg;base64,sampleKycDocImageData', KYC_FILES_KEY);

console.log('--- 3. REPLAYING SMOKE FLOW VIA LEDGER ONLY (NO DIRECT ACCOUNT WRITES) ---');

const smokeClient = await pool.connect();
await smokeClient.query('BEGIN');

// Insert Profiles & Accounts with ZERO balances initially
await smokeClient.query(`
  INSERT INTO profiles (id, email, display_name, role) VALUES
  ('usr-alice-100', 'alice@orin.test', 'Alice Trader', 'user'),
  ('usr-bob-200', 'bob@orin.test', 'Bob Friend', 'user'),
  ('admin-super-uid', 'superadmin@orin.test', 'Super Admin', 'admin'),
  ('admin-maker-uid', 'maker@orin.test', 'Finance Maker', 'admin'),
  ('admin-checker-uid', 'checker@orin.test', 'Finance Checker', 'admin');

  INSERT INTO staff (user_id, roles, status) VALUES
  ('admin-super-uid', '["super_admin"]'::jsonb, 'active'),
  ('admin-maker-uid', '["finance"]'::jsonb, 'active'),
  ('admin-checker-uid', '["finance", "finance_approver"]'::jsonb, 'active');

  INSERT INTO accounts (id, user_id, account_number, type, balance_cents, reserved_cents, realized_cents, bonus_cents, bonus_reserved_cents, bonus_profit_cents) VALUES
  ('acc-alice-1', 'usr-alice-100', '323684678464', 'real', 0, 0, 0, 0, 0, 0),
  ('acc-bob-1', 'usr-bob-200', '523684678465', 'real', 0, 0, 0, 0, 0, 0);
`);

// 1. DEPOSIT $1000 (100000 cents) -> cash bucket
await smokeClient.query(`
  INSERT INTO deposits (id, user_id, account_id, amount_cents, coin, status, confirmed_at)
  VALUES ('np-dep-alice-1', 'usr-alice-100', 'acc-alice-1', 100000, 'usdttrc20', 'finished', NOW());

  INSERT INTO journals (id, kind, reference) VALUES ('deposit-nowpayments-900001', 'deposit', 'np-dep-alice-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('deposit-nowpayments-900001', 'usr-alice-100', 'acc-alice-1', 'cash', 100000),
  ('deposit-nowpayments-900001', NULL, NULL, 'system:payment-clearing', -100000);
`);

// 2. JOIN CONTRACT Alice $100 (10000 cents) -> cash -10000, reserved +10000
await smokeClient.query(`
  INSERT INTO contracts (id, code, title, asset, direction, duration_sec, settlement_bps, opens_at, closes_at, hash)
  VALUES ('cnt-btc-60s', 'LAB-BTC60S', 'BTC 60s Contract', 'BTCUSD', 'BUY', 60, 500, NOW(), NOW() + INTERVAL '1 day', 'hash-cnt-1');

  INSERT INTO positions (id, user_id, contract_id, account_id, amount_cents, result_cents, started_at, ends_at)
  VALUES ('pos-alice-1', 'usr-alice-100', 'cnt-btc-60s', 'acc-alice-1', 10000, 500, NOW(), NOW() + INTERVAL '60 seconds');

  INSERT INTO journals (id, kind, reference) VALUES ('allocate:pos-alice-1', 'allocation', 'pos-alice-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('allocate:pos-alice-1', 'usr-alice-100', 'acc-alice-1', 'cash', -10000),
  ('allocate:pos-alice-1', 'usr-alice-100', 'acc-alice-1', 'reserved', 10000);
`);

// 3. SETTLE CONTRACT Alice (+500 cents profit) -> reserved -10000, cash +10500, system:trading-pnl -500
await smokeClient.query(`
  UPDATE positions SET status = 'settled', settled_at = NOW() WHERE id = 'pos-alice-1';

  INSERT INTO receipts (id, position_id, user_id, payload, hash)
  VALUES ('receipt:pos-alice-1', 'pos-alice-1', 'usr-alice-100', '{"resultCents": 500}'::jsonb, 'hash-rec-1');

  INSERT INTO journals (id, kind, reference) VALUES ('settle:pos-alice-1', 'settlement', 'pos-alice-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('settle:pos-alice-1', 'usr-alice-100', 'acc-alice-1', 'reserved', -10000),
  ('settle:pos-alice-1', 'usr-alice-100', 'acc-alice-1', 'cash', 10500),
  ('settle:pos-alice-1', NULL, NULL, 'system:trading-pnl', -500);
`);

// 4. KYC VERIFY Alice (AES-GCM encrypted in kyc_files)
await smokeClient.query(`
  INSERT INTO kyc_files (id, user_id, country, document_type, id_number_encrypted, id_number_iv, id_number_tag, document_image_encrypted, document_image_iv, document_image_tag, status)
  VALUES ('kyc-alice-doc', 'usr-alice-100', 'SA', 'passport',
    '${encryptedKycData.ciphertext}', '${encryptedKycData.iv}', '${encryptedKycData.tag}',
    '${encryptedImageData.ciphertext}', '${encryptedImageData.iv}', '${encryptedImageData.tag}',
    'verified');

  INSERT INTO customer_registry (customer_key, user_id)
  VALUES ('67a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0455', 'usr-alice-100');

  INSERT INTO verified_customers (user_id, customer_key, id_number_last4, event_id)
  VALUES ('usr-alice-100', '67a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0455', '5678', 'kyc-req-alice');
`);

// 5. FINANCE ADJUSTMENT: CREDIT (+5000 cents) -> cash +5000
await smokeClient.query(`
  INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, approved_by, approved_at)
  VALUES ('req-fin-prop-credit-1', 'adjustment', 'usr-alice-100', 'acc-alice-1', 5000, 100500, 105500, 'approved', 'Promo credit', 'ref-fin-credit-1', 'admin-maker-uid', 'admin-checker-uid', NOW());

  INSERT INTO journals (id, kind, reference) VALUES ('adjustment:req-fin-prop-credit-1', 'adjustment', 'ref-fin-credit-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('adjustment:req-fin-prop-credit-1', 'usr-alice-100', 'acc-alice-1', 'cash', 5000),
  ('adjustment:req-fin-prop-credit-1', NULL, NULL, 'system:adjustment-clearing', -5000);
`);

// 6. FINANCE ADJUSTMENT: DEBIT (-1000 cents) -> cash -1000
await smokeClient.query(`
  INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, approved_by, approved_at)
  VALUES ('req-fin-prop-debit-1', 'adjustment', 'usr-alice-100', 'acc-alice-1', -1000, 105500, 104500, 'approved', 'Maintenance fee', 'ref-fin-debit-1', 'admin-maker-uid', 'admin-checker-uid', NOW());

  INSERT INTO journals (id, kind, reference) VALUES ('adjustment:req-fin-prop-debit-1', 'adjustment', 'ref-fin-debit-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('adjustment:req-fin-prop-debit-1', 'usr-alice-100', 'acc-alice-1', 'cash', -1000),
  ('adjustment:req-fin-prop-debit-1', NULL, NULL, 'system:adjustment-clearing', 1000);
`);

// 7. REFERRAL: Payout (+8000 cents) -> cash +8000
await smokeClient.query(`
  INSERT INTO referral_codes (code, user_id) VALUES ('ORIN-ALICE0001', 'usr-alice-100'), ('ORIN-BOB0000002', 'usr-bob-200');

  INSERT INTO referral_attributions (user_id, referral_code, referrer_user_id)
  VALUES ('usr-bob-200', 'ORIN-ALICE0001', 'usr-alice-100');

  INSERT INTO customer_registry (customer_key, user_id)
  VALUES ('77a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0499', 'usr-bob-200');

  INSERT INTO verified_customers (user_id, customer_key, id_number_last4, event_id)
  VALUES ('usr-bob-200', '77a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0499', '5432', 'kyc-req-bob');

  INSERT INTO referral_rewards (referred_user_id, referrer_user_id, amount_cents, status, paid_at)
  VALUES ('usr-bob-200', 'usr-alice-100', 8000, 'paid', NOW());

  INSERT INTO journals (id, kind, reference) VALUES ('reward:usr-bob-200', 'referral_reward', 'ref-reward-usr-bob-200');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('reward:usr-bob-200', 'usr-alice-100', 'acc-alice-1', 'cash', 8000),
  ('reward:usr-bob-200', NULL, NULL, 'system:program-expense', -8000);
`);

// 8. TEAM ACTIVITY REWARD (+2500 cents) -> cash +2500
await smokeClient.query(`
  INSERT INTO eligible_revenue (id, user_id, period_id, net_revenue_cents, direct, active_team, finalized, paid_at)
  VALUES ('usr-alice-100_2026-10', 'usr-alice-100', '2026-10', 200000, 5, 20, TRUE, NOW());

  INSERT INTO activity_payments (id, user_id, period_id, cents, approval_id)
  VALUES ('usr-alice-100_2026-10', 'usr-alice-100', '2026-10', 2500, 'req-team-prop-1');

  INSERT INTO journals (id, kind, reference) VALUES ('team:usr-alice-100_2026-10', 'team_activity', 'ref-team-usr-alice-100');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('team:usr-alice-100_2026-10', 'usr-alice-100', 'acc-alice-1', 'cash', 2500),
  ('team:usr-alice-100_2026-10', NULL, NULL, 'system:program-expense', -2500);
`);

// 9. BONUS CLAIM (10000 cents bonus) -> bonus +10000
await smokeClient.query(`
  INSERT INTO bonus_claims (customer_key, user_id)
  VALUES ('67a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0455', 'usr-alice-100');

  INSERT INTO bonus_wallets (user_id, account_id, claimed, claimed_at)
  VALUES ('usr-alice-100', 'acc-alice-1', TRUE, NOW());

  INSERT INTO journals (id, kind, reference) VALUES ('bonus-claim-alice', 'nonwithdrawable_bonus', 'claim-alice-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('bonus-claim-alice', 'usr-alice-100', 'acc-alice-1', 'bonus', 10000),
  ('bonus-claim-alice', NULL, NULL, 'system:program-grant', -10000);
`);

// 10. BONUS TRADE & SETTLE:
// Allocation: bonus -5000, bonus_reserved +5000
await smokeClient.query(`
  INSERT INTO journals (id, kind, reference) VALUES ('bonus-allocate-pos-2', 'bonus_allocation', 'pos-alice-bonus-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('bonus-allocate-pos-2', 'usr-alice-100', 'acc-alice-1', 'bonus', -5000),
  ('bonus-allocate-pos-2', 'usr-alice-100', 'acc-alice-1', 'bonus_reserved', 5000);
`);

// Settlement: bonus_reserved -5000, bonus +5000, bonus_profit +250, system:program-payout -250
await smokeClient.query(`
  INSERT INTO journals (id, kind, reference) VALUES ('bonus-settle-pos-2', 'bonus_settlement', 'pos-alice-bonus-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('bonus-settle-pos-2', 'usr-alice-100', 'acc-alice-1', 'bonus_reserved', -5000),
  ('bonus-settle-pos-2', 'usr-alice-100', 'acc-alice-1', 'bonus', 5000),
  ('bonus-settle-pos-2', 'usr-alice-100', 'acc-alice-1', 'bonus_profit', 250),
  ('bonus-settle-pos-2', NULL, NULL, 'system:program-payout', -250);
`);

// Unlock: bonus_profit -250, cash +250
await smokeClient.query(`
  INSERT INTO journals (id, kind, reference) VALUES ('bonus-unlock-alice-1', 'bonus_profit_unlock', 'pos-alice-bonus-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('bonus-unlock-alice-1', 'usr-alice-100', 'acc-alice-1', 'bonus_profit', -250),
  ('bonus-unlock-alice-1', 'usr-alice-100', 'acc-alice-1', 'cash', 250);
`);

// 11. WITHDRAWAL: cash -15000, system:payout-clearing +15000
await smokeClient.query(`
  INSERT INTO withdrawal_requests (id, user_id, account_id, amount_cents, coin, address, status)
  VALUES ('wd-alice-001', 'usr-alice-100', 'acc-alice-1', 15000, 'USDT', 'TJ1234567890abcdef1234567890abcdef', 'paid');

  INSERT INTO journals (id, kind, reference) VALUES ('withdrawal:wd-alice-001', 'withdrawal', 'wd-alice-001');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('withdrawal:wd-alice-001', 'usr-alice-100', 'acc-alice-1', 'cash', -15000),
  ('withdrawal:wd-alice-001', NULL, NULL, 'system:payout-clearing', 15000);
`);

await smokeClient.query('COMMIT');
smokeClient.release();
console.log('Smoke flow replayed through JOURNALS ONLY successfully!');

console.log('--- 4. CONCURRENCY & INTEGRITY TESTS ON REAL POSTGRESQL ---');

// TEST 8A: 50 concurrent inserts across 2 connections needing full balance -> exactly 1 succeeds
console.log('Test 8A: 50 concurrent allocation attempts for full balance...');

// Fund a test user with exactly 10,000 cents
const testSetupClient = await pool.connect();
await testSetupClient.query(`
  INSERT INTO profiles (id, email, display_name, role) VALUES ('usr-conc-99', 'conc@orin.test', 'Conc User', 'user');
  INSERT INTO accounts (id, user_id, account_number, type, balance_cents) VALUES ('acc-conc-99', 'usr-conc-99', '999988887777', 'real', 0);
  INSERT INTO journals (id, kind, reference) VALUES ('deposit:conc-99', 'deposit', 'dep-conc-99');
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('deposit:conc-99', 'usr-conc-99', 'acc-conc-99', 'cash', 10000),
  ('deposit:conc-99', NULL, NULL, 'system:payment-clearing', -10000);
`);
testSetupClient.release();

const conn1 = await pool.connect();
const conn2 = await pool.connect();

let successCount = 0;
let failureCount = 0;

const queue = Array.from({ length: 50 }, (_, i) => i);

async function worker(client) {
  while (queue.length > 0) {
    const index = queue.shift();
    if (index === undefined) break;
    const jid = `alloc:conc-test-${index}`;
    try {
      await client.query('BEGIN');
      // Lock account row and verify balance
      const bRes = await client.query('SELECT balance_cents FROM accounts WHERE id = $1 FOR UPDATE', ['acc-conc-99']);
      if (BigInt(bRes.rows[0].balance_cents) < 10000n) {
        throw new Error('Insufficient balance');
      }
      await client.query('INSERT INTO journals (id, kind, reference) VALUES ($1, $2, $3)', [jid, 'allocation', `ref-${index}`]);
      await client.query(`
        INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
        ($1, 'usr-conc-99', 'acc-conc-99', 'cash', -10000),
        ($1, 'usr-conc-99', 'acc-conc-99', 'reserved', 10000)
      `, [jid]);
      await client.query('COMMIT');
      successCount++;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      failureCount++;
    }
  }
}

await Promise.all([worker(conn1), worker(conn2)]);
conn1.release();
conn2.release();

console.log(`Concurrent Allocation Results: Successes = ${successCount}, Failures = ${failureCount}`);
assert.equal(successCount, 1, 'Exactly 1 allocation must succeed!');
assert.equal(failureCount, 49, 'Exactly 49 allocations must fail!');
console.log('[PASS] Concurrency proof: Exactly 1 out of 50 succeeded!');

// TEST 8B: Direct UPDATE of accounts.balance_cents outside ledger flagged by reconciliation view
console.log('Test 8B: Direct update of balance_cents outside ledger flagged by reconciliation view...');
const tamperClient = await pool.connect();
await tamperClient.query("UPDATE accounts SET balance_cents = balance_cents + 99999 WHERE id = 'acc-alice-1'");

const tamperedRec = await tamperClient.query("SELECT * FROM account_ledger_reconciliation WHERE user_id = 'usr-alice-100'");
console.log('Tampered account cash discrepancy:', tamperedRec.rows[0].cash_discrepancy);
assert.equal(tamperedRec.rows[0].cash_discrepancy, '99999');
console.log('[PASS] Reconciliation view successfully caught tamper of 99999 cents!');

// Revert the tamper
await tamperClient.query("UPDATE accounts SET balance_cents = balance_cents - 99999 WHERE id = 'acc-alice-1'");
tamperClient.release();

// TEST 8C: DELETE on journal_entries is rejected
console.log('Test 8C: DELETE on journal_entries rejected...');
const delClient = await pool.connect();
await assert.rejects(async () => {
  await delClient.query('DELETE FROM journal_entries WHERE id = 1');
}, /journal_entries table is append-only/);
console.log('[PASS] DELETE on journal_entries blocked by immutability trigger!');

// TEST 8D: Self-approval rejected by check constraint
console.log('Test 8D: Approving your own approval is rejected...');
await assert.rejects(async () => {
  await delClient.query(`
    INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, approved_by)
    VALUES ('app-self-test', 'adjustment', 'usr-alice-100', 'acc-alice-1', 100, 100, 200, 'approved', 'self', 'ref-self', 'admin-maker-uid', 'admin-maker-uid')
  `);
}, /chk_approvals_no_self_approval/);
delClient.release();
console.log('[PASS] Self-approval blocked by check constraint!');

console.log('--- 5. INVARIANT RECONCILIATION QUERY RESULTS ---');
const verifyClient = await pool.connect();
const finalRec = await verifyClient.query('SELECT * FROM account_ledger_reconciliation;');
console.table(finalRec.rows);

const mismatchCheck = await verifyClient.query(`
  SELECT * FROM account_ledger_reconciliation
  WHERE cash_discrepancy <> 0
     OR reserved_discrepancy <> 0
     OR bonus_discrepancy <> 0
     OR bonus_reserved_discrepancy <> 0
     OR bonus_profit_discrepancy <> 0;
`);
console.log('Mismatched rows count:', mismatchCheck.rows.length);
assert.equal(mismatchCheck.rows.length, 0, 'Reconciliation must return exactly 0 rows of mismatch!');
console.log('INVARIANT VERIFIED: Exactly 0 mismatch rows across all users and buckets!');

verifyClient.release();
await pool.end();
await ep.stop();
console.log('--- ALL REAL POSTGRESQL TESTS COMPLETED SUCCESSFULLY ---');
