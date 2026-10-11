import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { publish, join, settle, state } from './src/contracts.js';
import { pool as dbPool } from './src/db.js';

const { Pool } = pg;

console.log('=== STARTING TEST SUITE FOR STAGE 1 FIXES, STAGE 2 & STAGE 3 ===');

const ep = new EmbeddedPostgres({
  port: 5433,
  databaseDir: './.pgdata',
  persistent: true
});

try {
  await ep.start();
} catch (e) {
  // If already running or needs restart
}
console.log('PostgreSQL 18.4 engine active on 127.0.0.1:5433');

const adminPool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: 'password',
  database: 'postgres',
  max: 10
});

const schemaSql = `
-- Drop existing objects for fresh schema deployment
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
DROP TABLE IF EXISTS payment_reviews CASCADE;
DROP TABLE IF EXISTS payment_ids CASCADE;
DROP TABLE IF EXISTS deposits CASCADE;
DROP TABLE IF EXISTS receipts CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS contract_revocation_state CASCADE;
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

-- 1. BEFORE UPDATE TRIGGER ON ACCOUNTS: rejects balance changes unless ledger set transaction-local flag
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
$$ LANGUAGE plpgsql;

-- 2. APPLY JOURNAL ENTRY TO ACCOUNT
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. CONSTRAINT TRIGGER ON JOURNALS: reject < 2 entries at commit
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

-- 4. CONSTRAINT TRIGGER ON JOURNAL ENTRIES: entries of one journal sum to 0
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

-- TABLES
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

CREATE TRIGGER trg_check_account_balance_update
BEFORE UPDATE ON accounts
FOR EACH ROW
EXECUTE FUNCTION check_account_balance_update();

CREATE TABLE journals (
  id VARCHAR(128) PRIMARY KEY,
  kind VARCHAR(50) NOT NULL CHECK (kind IN ('deposit', 'allocation', 'settlement', 'adjustment', 'referral_reward', 'team_activity', 'nonwithdrawable_bonus', 'bonus_allocation', 'bonus_settlement', 'bonus_profit_unlock', 'withdrawal', 'bonus_expired')),
  reference VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_journals_immutable
BEFORE UPDATE OR DELETE ON journals
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE CONSTRAINT TRIGGER trg_check_journal_entry_count
AFTER INSERT ON journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_journal_entry_count();

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_audit_immutable
BEFORE UPDATE OR DELETE ON audit
FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();

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

CREATE TABLE docs (
  collection VARCHAR(64) NOT NULL,
  id VARCHAR(128) NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);

-- RECONCILIATION VIEW
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

-- 7. APPLICATION ROLE
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'orin_app') THEN
    CREATE ROLE orin_app WITH LOGIN PASSWORD 'orin_app_pass';
  END IF;
END $$;

GRANT CONNECT ON DATABASE postgres TO orin_app;
GRANT USAGE ON SCHEMA public TO orin_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO orin_app;
GRANT UPDATE ON profiles, contracts, positions, receipts, deposits, payment_reviews, approvals, withdrawal_requests, docs, bonus_wallets TO orin_app;
GRANT UPDATE (status, currency, revision, updated_at) ON accounts TO orin_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orin_app;

-- Ensure orin_app has NO delete or update on journals, journal_entries, audit
REVOKE DELETE, UPDATE ON journals, journal_entries, audit FROM orin_app;
REVOKE UPDATE (balance_cents, reserved_cents, bonus_cents, bonus_reserved_cents, bonus_profit_cents) ON accounts FROM orin_app;
`;

const client = await adminPool.connect();
await client.query(schemaSql);
client.release();
console.log('Schema deployed with triggers, constraint triggers, and orin_app role.');

// TEST 1: Direct UPDATE on accounts balance columns is blocked by BEFORE UPDATE trigger
console.log('Testing Fix 1: Direct UPDATE on accounts balance rejected...');
const tClient = await adminPool.connect();
await tClient.query(`
  INSERT INTO profiles (id, email, display_name) VALUES ('usr-t1', 't1@orin.test', 'T1 User');
  INSERT INTO accounts (id, user_id, account_number, balance_cents) VALUES ('acc-t1', 'usr-t1', '111122223333', 0);
  INSERT INTO journals (id, kind, reference) VALUES ('j-t1-seed', 'deposit', 'seed');
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('j-t1-seed', 'usr-t1', 'acc-t1', 'cash', 5000),
  ('j-t1-seed', NULL, NULL, 'system:payment-clearing', -5000);
`);

await assert.rejects(async () => {
  await tClient.query("UPDATE accounts SET balance_cents = 6000 WHERE id = 'acc-t1'");
}, /Direct update of balance columns on accounts is prohibited/);
console.log('[PASS] Fix 1 Verified: Direct UPDATE fails with trigger exception!');

// Verify journal insert works and modifies account balance:
await tClient.query(`
  BEGIN;
  INSERT INTO journals (id, kind, reference) VALUES ('j-t1', 'deposit', 'ref-t1');
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('j-t1', 'usr-t1', 'acc-t1', 'cash', 2500),
  ('j-t1', NULL, NULL, 'system:payment-clearing', -2500);
  COMMIT;
`);
const accRes = await tClient.query("SELECT balance_cents FROM accounts WHERE id = 'acc-t1'");
assert.equal(accRes.rows[0].balance_cents, '7500');
console.log('[PASS] Fix 1 Verified: Journal insert properly applied balance update via trigger! Balance is now 7500.');

// TEST 2: Constraint trigger on journals rejects < 2 entries at commit
console.log('Testing Fix 2: Constraint trigger rejects journal with < 2 entries...');
await assert.rejects(async () => {
  await tClient.query(`
    BEGIN;
    INSERT INTO journals (id, kind, reference) VALUES ('j-single', 'deposit', 'ref-single');
    INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
    ('j-single', 'usr-t1', 'acc-t1', 'cash', 100);
    COMMIT;
  `);
}, /must have at least 2 entries/);
console.log('[PASS] Fix 2 Verified: Journal with single entry rejected at commit!');
tClient.release();

// TEST 7: Test orin_app role permissions
console.log('Testing Fix 7: Restricted application role (orin_app)...');
const appPool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'orin_app',
  password: 'orin_app_pass',
  database: 'postgres',
  max: 2
});

const appClient = await appPool.connect();

// 7a. Direct UPDATE on balance columns fails with permission denied
await assert.rejects(async () => {
  await appClient.query("UPDATE accounts SET balance_cents = 9999 WHERE id = 'acc-t1'");
}, /permission denied/);
console.log('[PASS] Fix 7a Verified: orin_app cannot update balance_cents!');

// 7b. DELETE on journal_entries fails with permission denied
await assert.rejects(async () => {
  await appClient.query("DELETE FROM journal_entries WHERE journal_id = 'j-t1'");
}, /permission denied for table journal_entries/);
console.log('[PASS] Fix 7b Verified: orin_app cannot DELETE from journal_entries!');

// 7c. Journal insert works under orin_app and updates accounts via trigger
await appClient.query(`
  BEGIN;
  INSERT INTO journals (id, kind, reference) VALUES ('j-app-test', 'deposit', 'ref-app-test');
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('j-app-test', 'usr-t1', 'acc-t1', 'cash', 1000),
  ('j-app-test', NULL, NULL, 'system:payment-clearing', -1000);
  COMMIT;
`);
const appAccRes = await appClient.query("SELECT balance_cents FROM accounts WHERE id = 'acc-t1'");
assert.equal(appAccRes.rows[0].balance_cents, '8500');
console.log('[PASS] Fix 7c Verified: orin_app successfully performed journal insert and balance updated to 8500!');
appClient.release();
await appPool.end();

// STAGE 2 & STAGE 3 TESTS: contracts.ts with real PostgreSQL
console.log('=== TESTING STAGE 3: contracts.ts REAL EXECUTION ===');

// Publish contract
const adminUser = { id: 'admin-super-uid', verified: true, role: 'admin' };
const traderUser = { id: 'usr-alice-100', verified: true, role: 'user' };

const setupCli = await adminPool.connect();
await setupCli.query(`
  INSERT INTO profiles (id, email, display_name, role) VALUES ('admin-super-uid', 'admin@orin.test', 'Admin User', 'admin') ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id, email, display_name, role) VALUES ('usr-alice-100', 'alice@orin.test', 'Alice Trader', 'user') ON CONFLICT DO NOTHING;
  INSERT INTO accounts (id, user_id, account_number, type, balance_cents) VALUES ('acc-alice-real', 'usr-alice-100', '100100100100', 'real', 0) ON CONFLICT DO NOTHING;
  -- Fund Alice with 10,000 cents ($100)
  INSERT INTO journals (id, kind, reference) VALUES ('j-fund-alice', 'deposit', 'dep-alice-fund');
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('j-fund-alice', 'usr-alice-100', 'acc-alice-real', 'cash', 10000),
  ('j-fund-alice', NULL, NULL, 'system:payment-clearing', -10000);
`);
setupCli.release();

const now = Date.now();
const pubRes = await publish(adminUser, {
  title: 'BTC 60s Fast Contract',
  asset: 'BTCUSD',
  direction: 'BUY',
  durationSec: 60,
  settlementBps: 500, // +5%
  opensAt: now - 1000,
  closesAt: now + 3600000,
  eligibility: 'all'
}, now);
console.log('Contract Published:', pubRes);

// TEST 3A: 50 concurrent join() calls with full balance -> exactly 1 succeeds
console.log('Test 3A: 50 concurrent join() calls for full balance (10,000 cents)...');
const joinResults = await Promise.allSettled(
  Array.from({ length: 50 }, (_, i) =>
    join(traderUser, {
      code: pubRes.code,
      amountCents: 10000,
      confirmed: true,
      contractHash: pubRes.hash
    }, now)
  )
);

const joinSuccesses = joinResults.filter(r => r.status === 'fulfilled' && r.value.reused === false).length;
const joinReused = joinResults.filter(r => r.status === 'fulfilled' && r.value.reused === true).length;
const joinFailures = joinResults.filter(r => r.status === 'rejected').length;

console.log(`Join Concurrency Results: New Successful = ${joinSuccesses}, Reused = ${joinReused}, Failed = ${joinFailures}`);
assert.equal(joinSuccesses, 1, 'Exactly 1 new allocation must succeed!');
console.log('[PASS] 50 concurrent join() calls: Exactly 1 succeeded in allocating balance!');

// TEST 3B: Join on revoked or expired contract rejected
console.log('Test 3B: Join on revoked / expired contract...');
const revCli = await adminPool.connect();
await revCli.query(`INSERT INTO contract_revocation_state (contract_id, revoked, reason) VALUES ($1, true, 'Safety halt')`, [pubRes.id]);
revCli.release();

await assert.rejects(async () => {
  await join(traderUser, { code: pubRes.code, amountCents: 100, confirmed: true }, now);
}, /تم إيقاف هذا الكود/);
console.log('[PASS] Join on revoked contract rejected!');

// Unrevoke and test expired contract
const unrevCli = await adminPool.connect();
await unrevCli.query(`DELETE FROM contract_revocation_state WHERE contract_id = $1`, [pubRes.id]);
unrevCli.release();

await assert.rejects(async () => {
  await join(traderUser, { code: pubRes.code, amountCents: 100, confirmed: true }, now + 4000000);
}, /العقد خارج نافذة المشاركة/);
console.log('[PASS] Join on expired contract rejected!');

// TEST 3C: Settle twice -> once (idempotent)
console.log('Test 3C: Settle twice -> once...');
const settleTime = now + 65000;
const settleRes1 = await settle(traderUser, settleTime);
console.log('First settlement run:', settleRes1);
assert.equal(settleRes1.length, 1);
assert.equal(settleRes1[0].resultCents, 500);

const settleRes2 = await settle(traderUser, settleTime);
console.log('Second settlement run (idempotent):', settleRes2);
assert.equal(settleRes2.length, 0);
console.log('[PASS] Settle twice executed exactly once!');

// TEST 3D: Reserved never negative
const chkCli = await adminPool.connect();
const resNegative = await chkCli.query('SELECT * FROM accounts WHERE reserved_cents < 0 OR bonus_reserved_cents < 0');
assert.equal(resNegative.rows.length, 0);
console.log('[PASS] Reserved balance never negative (CHECK constraint enforced)!');

// TEST 3E: Invariant view returns 0 mismatches after every test
console.log('Test 3E: Invariant reconciliation query check...');
const mismatchRes = await chkCli.query(`
  SELECT * FROM account_ledger_reconciliation
  WHERE cash_discrepancy <> 0
     OR reserved_discrepancy <> 0
     OR bonus_discrepancy <> 0
     OR bonus_reserved_discrepancy <> 0
     OR bonus_profit_discrepancy <> 0;
`);
console.log('Mismatches count:', mismatchRes.rows.length);
assert.equal(mismatchRes.rows.length, 0, 'Reconciliation must return 0 mismatches!');
console.log('[PASS] INVARIANT VERIFIED: 0 mismatch rows returned after all tests!');

// Print state output
const userState = await state(traderUser, settleTime);
console.log('User State Output:', {
  user: userState.user,
  balanceCents: userState.balanceCents,
  reservedCents: userState.reservedCents,
  realizedCents: userState.realizedCents,
  positionsCount: userState.positions.length,
  receiptsCount: userState.receipts.length,
  ledgerEntriesCount: userState.ledger.length
});

chkCli.release();
await adminPool.end();
await dbPool.end();
await ep.stop();
console.log('=== ALL TESTS COMPLETED AND PASSED WITH EXIT CODE 0 ===');
