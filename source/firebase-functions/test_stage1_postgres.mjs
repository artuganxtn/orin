import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

console.log('Initializing local PostgreSQL 17.5 via PGlite...');
const pg = new PGlite();

// 1. Run Migrations
const schemaSql = `
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
`;

await pg.exec(schemaSql);
console.log('PostgreSQL migrations applied successfully!');

// Save migration file
writeFileSync('../database_schema.sql', schemaSql);

// Replay Smoke Test in Postgres Transaction
await pg.exec('BEGIN');

// Users & Staff
await pg.exec(`
  INSERT INTO profiles (id, email, display_name, role) VALUES
  ('usr-alice-100', 'alice@orin.test', 'Alice Trader', 'user'),
  ('usr-bob-200', 'bob@orin.test', 'Bob Friend', 'user'),
  ('admin-super-uid', 'superadmin@orin.test', 'Super Admin', 'admin'),
  ('admin-maker-uid', 'maker@orin.test', 'Finance Maker', 'admin'),
  ('admin-checker-uid', 'checker@orin.test', 'Finance Checker', 'admin');
`);

await pg.exec(`
  INSERT INTO staff (user_id, roles, status) VALUES
  ('admin-super-uid', '["super_admin"]'::jsonb, 'active'),
  ('admin-maker-uid', '["finance"]'::jsonb, 'active'),
  ('admin-checker-uid', '["finance", "finance_approver"]'::jsonb, 'active');
`);

// Accounts
await pg.exec(`
  INSERT INTO accounts (id, user_id, account_number, type, balance_cents, reserved_cents, realized_cents) VALUES
  ('acc-alice-1', 'usr-alice-100', '323684678464', 'real', 0, 0, 0),
  ('acc-bob-1', 'usr-bob-200', '523684678465', 'real', 0, 0, 0);
`);

// 1. DEPOSIT Alice $1000
await pg.exec(`
  INSERT INTO deposits (id, user_id, account_id, amount_cents, coin, status, confirmed_at)
  VALUES ('np-dep-alice-1', 'usr-alice-100', 'acc-alice-1', 100000, 'usdttrc20', 'finished', NOW());

  INSERT INTO payment_ids (payment_id, deposit_id) VALUES ('900001', 'np-dep-alice-1');

  INSERT INTO trusted_events (event_id, user_id, account_id, type, fingerprint, cents, status)
  VALUES ('nowpayments-900001', 'usr-alice-100', 'acc-alice-1', 'deposit', 'fp-dep-1', 100000, 'confirmed');

  INSERT INTO journals (id, kind, reference) VALUES ('deposit-nowpayments-900001', 'deposit', 'nowpayments-900001');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('deposit-nowpayments-900001', 'usr-alice-100', 'acc-alice-1', 'cash', 100000),
  ('deposit-nowpayments-900001', NULL, NULL, 'system:payment-clearing', -100000);

  UPDATE accounts SET balance_cents = balance_cents + 100000 WHERE id = 'acc-alice-1';
`);

// 2. JOIN CONTRACT Alice $100 (10000 cents)
await pg.exec(`
  INSERT INTO contracts (id, code, title, asset, direction, duration_sec, settlement_bps, opens_at, closes_at, hash)
  VALUES ('cnt-btc-60s', 'LAB-BTC60S', 'BTC 60s Contract', 'BTCUSD', 'BUY', 60, 500, NOW(), NOW() + INTERVAL '1 day', 'hash-cnt-1');

  INSERT INTO positions (id, user_id, contract_id, account_id, amount_cents, result_cents, started_at, ends_at)
  VALUES ('pos-alice-1', 'usr-alice-100', 'cnt-btc-60s', 'acc-alice-1', 10000, 500, NOW(), NOW() + INTERVAL '60 seconds');

  INSERT INTO journals (id, kind, reference) VALUES ('allocate:pos-alice-1', 'allocation', 'pos-alice-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('allocate:pos-alice-1', 'usr-alice-100', 'acc-alice-1', 'cash', -10000),
  ('allocate:pos-alice-1', 'usr-alice-100', 'acc-alice-1', 'reserved', 10000);

  UPDATE accounts SET balance_cents = balance_cents - 10000, reserved_cents = reserved_cents + 10000 WHERE id = 'acc-alice-1';
`);

// 3. SETTLE CONTRACT Alice (+500 cents profit)
await pg.exec(`
  UPDATE positions SET status = 'settled', settled_at = NOW() WHERE id = 'pos-alice-1';

  INSERT INTO receipts (id, position_id, user_id, payload, hash)
  VALUES ('receipt:pos-alice-1', 'pos-alice-1', 'usr-alice-100', '{"resultCents": 500}'::jsonb, 'hash-rec-1');

  INSERT INTO journals (id, kind, reference) VALUES ('settle:pos-alice-1', 'settlement', 'pos-alice-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('settle:pos-alice-1', 'usr-alice-100', 'acc-alice-1', 'reserved', -10000),
  ('settle:pos-alice-1', 'usr-alice-100', 'acc-alice-1', 'cash', 10500),
  ('settle:pos-alice-1', NULL, NULL, 'system:trading-pnl', -500);

  UPDATE accounts SET balance_cents = balance_cents + 10500, reserved_cents = reserved_cents - 10000, realized_cents = realized_cents + 500 WHERE id = 'acc-alice-1';
`);

// 4. KYC VERIFY Alice
await pg.exec(`
  INSERT INTO kyc_files (id, user_id, country, document_type, id_number_full, document_image_data, status)
  VALUES ('kyc-alice-doc', 'usr-alice-100', 'SA', 'passport', 'P 1234 5678', 'data:image/jpeg;base64,...', 'verified');

  INSERT INTO customer_registry (customer_key, user_id)
  VALUES ('67a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0455', 'usr-alice-100');

  INSERT INTO verified_customers (user_id, customer_key, id_number_last4, event_id)
  VALUES ('usr-alice-100', '67a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0455', '5678', 'kyc-req-alice');
`);

// 5. FINANCE ADJUSTMENT: CREDIT (+5000 cents)
await pg.exec(`
  INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, approved_by, approved_at)
  VALUES ('req-fin-prop-credit-1', 'adjustment', 'usr-alice-100', 'acc-alice-1', 5000, 100500, 105500, 'approved', 'Promo credit', 'ref-fin-credit-1', 'admin-maker-uid', 'admin-checker-uid', NOW());

  INSERT INTO financial_references (reference_hash, reference, approval_id)
  VALUES ('hash-ref-credit-1', 'ref-fin-credit-1', 'req-fin-prop-credit-1');

  INSERT INTO journals (id, kind, reference) VALUES ('adjustment:req-fin-prop-credit-1', 'adjustment', 'ref-fin-credit-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('adjustment:req-fin-prop-credit-1', 'usr-alice-100', 'acc-alice-1', 'cash', 5000),
  ('adjustment:req-fin-prop-credit-1', NULL, NULL, 'system:adjustment-clearing', -5000);

  UPDATE accounts SET balance_cents = balance_cents + 5000 WHERE id = 'acc-alice-1';
`);

// 6. FINANCE ADJUSTMENT: DEBIT (-1000 cents)
await pg.exec(`
  INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, approved_by, approved_at)
  VALUES ('req-fin-prop-debit-1', 'adjustment', 'usr-alice-100', 'acc-alice-1', -1000, 105500, 104500, 'approved', 'Maintenance fee', 'ref-fin-debit-1', 'admin-maker-uid', 'admin-checker-uid', NOW());

  INSERT INTO financial_references (reference_hash, reference, approval_id)
  VALUES ('hash-ref-debit-1', 'ref-fin-debit-1', 'req-fin-prop-debit-1');

  INSERT INTO journals (id, kind, reference) VALUES ('adjustment:req-fin-prop-debit-1', 'adjustment', 'ref-fin-debit-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('adjustment:req-fin-prop-debit-1', 'usr-alice-100', 'acc-alice-1', 'cash', -1000),
  ('adjustment:req-fin-prop-debit-1', NULL, NULL, 'system:adjustment-clearing', 1000);

  UPDATE accounts SET balance_cents = balance_cents - 1000 WHERE id = 'acc-alice-1';
`);

// 7. REFERRAL: Enroll & Payout (+8000 cents)
await pg.exec(`
  INSERT INTO customer_registry (customer_key, user_id)
  VALUES ('77a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0499', 'usr-bob-200');

  INSERT INTO verified_customers (user_id, customer_key, id_number_last4, event_id)
  VALUES ('usr-bob-200', '77a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0499', '5432', 'kyc-req-bob');

  INSERT INTO program_members (user_id, referral_code, direct_count, team_count, qualified_count)
  VALUES ('usr-alice-100', 'ORIN-ALICE0001', 1, 1, 1),
          ('usr-bob-200', 'ORIN-BOB0000002', 0, 0, 0);

  INSERT INTO referral_rewards (referred_user_id, referrer_user_id, amount_cents, status, paid_at)
  VALUES ('usr-bob-200', 'usr-alice-100', 8000, 'paid', NOW());

  INSERT INTO journals (id, kind, reference) VALUES ('reward:usr-bob-200', 'referral_reward', 'ref-reward-usr-bob-200');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('reward:usr-bob-200', 'usr-alice-100', 'acc-alice-1', 'cash', 8000),
  ('reward:usr-bob-200', NULL, NULL, 'system:program-expense', -8000);

  UPDATE accounts SET balance_cents = balance_cents + 8000 WHERE id = 'acc-alice-1';
`);

// 8. TEAM ACTIVITY REWARD (+2500 cents)
await pg.exec(`
  INSERT INTO eligible_revenue (id, user_id, period_id, net_revenue_cents, direct, active_team, finalized, paid_at)
  VALUES ('usr-alice-100_2026-10', 'usr-alice-100', '2026-10', 200000, 5, 20, TRUE, NOW());

  INSERT INTO activity_payments (id, user_id, period_id, cents, approval_id)
  VALUES ('usr-alice-100_2026-10', 'usr-alice-100', '2026-10', 2500, 'req-team-prop-1');

  INSERT INTO journals (id, kind, reference) VALUES ('team:usr-alice-100_2026-10', 'team_activity', 'ref-team-usr-alice-100');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('team:usr-alice-100_2026-10', 'usr-alice-100', 'acc-alice-1', 'cash', 2500),
  ('team:usr-alice-100_2026-10', NULL, NULL, 'system:program-expense', -2500);

  UPDATE accounts SET balance_cents = balance_cents + 2500 WHERE id = 'acc-alice-1';
`);

// 9. BONUS CLAIM (10000 cents bonus)
await pg.exec(`
  INSERT INTO bonus_claims (customer_key, user_id)
  VALUES ('67a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0455', 'usr-alice-100');

  INSERT INTO bonus_wallets (user_id, account_id, bonus_cents, claimed, claimed_at)
  VALUES ('usr-alice-100', 'acc-alice-1', 10000, TRUE, NOW());

  INSERT INTO journals (id, kind, reference) VALUES ('bonus-claim-alice', 'nonwithdrawable_bonus', 'claim-alice-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('bonus-claim-alice', 'usr-alice-100', 'acc-alice-1', 'bonus', 10000),
  ('bonus-claim-alice', NULL, NULL, 'system:program-grant', -10000);

  UPDATE accounts SET bonus_cents = bonus_cents + 10000 WHERE id = 'acc-alice-1';
`);

// 10. BONUS TRADE & SETTLE:
// Allocation: bonus 5000 -> bonus_reserved 5000
await pg.exec(`
  INSERT INTO journals (id, kind, reference) VALUES ('bonus-allocate-pos-2', 'bonus_allocation', 'pos-alice-bonus-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('bonus-allocate-pos-2', 'usr-alice-100', 'acc-alice-1', 'bonus', -5000),
  ('bonus-allocate-pos-2', 'usr-alice-100', 'acc-alice-1', 'bonus_reserved', 5000);

  UPDATE accounts SET bonus_cents = bonus_cents - 5000, bonus_reserved_cents = bonus_reserved_cents + 5000 WHERE id = 'acc-alice-1';
`);

// Settlement:
// bonus_reserved -5000 -> bonus +5000
// profit +250:
// Path A (Locked): credited to bonus_profit bucket (counter-entry system:program-payout)
await pg.exec(`
  INSERT INTO journals (id, kind, reference) VALUES ('bonus-settle-pos-2', 'bonus_settlement', 'pos-alice-bonus-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('bonus-settle-pos-2', 'usr-alice-100', 'acc-alice-1', 'bonus_reserved', -5000),
  ('bonus-settle-pos-2', 'usr-alice-100', 'acc-alice-1', 'bonus', 5000),
  ('bonus-settle-pos-2', 'usr-alice-100', 'acc-alice-1', 'bonus_profit', 250),
  ('bonus-settle-pos-2', NULL, NULL, 'system:program-payout', -250);

  UPDATE accounts SET bonus_reserved_cents = bonus_reserved_cents - 5000, bonus_cents = bonus_cents + 5000, bonus_profit_cents = bonus_profit_cents + 250 WHERE id = 'acc-alice-1';
`);

// Path B (Unlock): User has qualifying deposit -> unlock 250 bonus_profit into cash (capped at profit limit)
await pg.exec(`
  INSERT INTO journals (id, kind, reference) VALUES ('bonus-unlock-alice-1', 'bonus_profit_unlock', 'pos-alice-bonus-1');

  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('bonus-unlock-alice-1', 'usr-alice-100', 'acc-alice-1', 'bonus_profit', -250),
  ('bonus-unlock-alice-1', 'usr-alice-100', 'acc-alice-1', 'cash', 250);

  UPDATE accounts SET bonus_profit_cents = bonus_profit_cents - 250, balance_cents = balance_cents + 250, realized_cents = realized_cents + 250 WHERE id = 'acc-alice-1';
`);

// 11. AUDIT INSERT
await pg.exec(`
  INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
  VALUES ('usr-alice-100', 'TRADE_JOINED', 'pos-alice-1', '{"amountCents": 10000}'::jsonb, 'hash-audit-1');
`);

// 12. WITHDRAWAL REQUEST
await pg.exec(`
  INSERT INTO withdrawal_requests (id, user_id, account_id, amount_cents, coin, address, status)
  VALUES ('wd-alice-001', 'usr-alice-100', 'acc-alice-1', 15000, 'USDT', 'TJ1234567890abcdef1234567890abcdef', 'requested');
`);

await pg.exec('COMMIT');

console.log('Smoke flow transaction committed successfully!');

// Test append-only trigger on audit:
console.log('Testing audit append-only trigger...');
await assert.rejects(async () => {
  await pg.exec("UPDATE audit SET action = 'tampered' WHERE actor_id = 'usr-alice-100'");
}, /audit table is append-only/);

await assert.rejects(async () => {
  await pg.exec("DELETE FROM audit WHERE actor_id = 'usr-alice-100'");
}, /audit table is append-only/);
console.log('Audit append-only trigger verified!');

// Test deferred constraint trigger on unbalanced journal:
console.log('Testing deferred constraint trigger on unbalanced journal entries...');
await assert.rejects(async () => {
  await pg.exec(`
    BEGIN;
    INSERT INTO journals (id, kind, reference) VALUES ('j-unbalanced', 'test', 'ref-unbalanced');
    INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
    VALUES ('j-unbalanced', 'usr-alice-100', 'acc-alice-1', 'cash', 1000);
    COMMIT;
  `);
}, /entries do not balance/);
console.log('Deferred constraint trigger verified!');

console.log('Executing Invariant Reconciliation Query...');

const recRes = await pg.query('SELECT * FROM account_ledger_reconciliation;');
console.log('--- RECONCILIATION QUERY RESULT ---');
console.table(recRes.rows);

const mismatchRes = await pg.query('SELECT * FROM account_ledger_reconciliation WHERE cash_discrepancy <> 0 OR bonus_discrepancy <> 0;');
console.log('Mismatch count:', mismatchRes.rows.length);
assert.equal(mismatchRes.rows.length, 0, 'Reconciliation must have 0 rows of mismatch!');
console.log('INVARIANT VERIFIED: 0 mismatch rows returned!');
