-- =====================================================================
-- MIGRATION 001: CORE TABLES & LEDGER
-- =====================================================================

CREATE TABLE IF NOT EXISTS profiles (
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

CREATE TABLE IF NOT EXISTS accounts (
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_real_per_user ON accounts(user_id) WHERE type = 'real';

CREATE TABLE IF NOT EXISTS journals (
  id VARCHAR(128) PRIMARY KEY,
  kind VARCHAR(50) NOT NULL CHECK (kind IN ('deposit', 'allocation', 'settlement', 'adjustment', 'referral_reward', 'team_activity', 'nonwithdrawable_bonus', 'bonus_allocation', 'bonus_settlement', 'bonus_profit_unlock', 'withdrawal', 'bonus_expired')),
  reference VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entries (
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

CREATE TABLE IF NOT EXISTS contracts (
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

CREATE TABLE IF NOT EXISTS contract_revocation_state (
  contract_id VARCHAR(128) PRIMARY KEY REFERENCES contracts(id),
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  revoked_by VARCHAR(128) REFERENCES profiles(id),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS positions (
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

CREATE TABLE IF NOT EXISTS receipts (
  id VARCHAR(128) PRIMARY KEY,
  position_id VARCHAR(64) NOT NULL UNIQUE REFERENCES positions(id),
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  payload JSONB NOT NULL,
  hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposits (
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

CREATE TABLE IF NOT EXISTS payment_reviews (
  id VARCHAR(128) PRIMARY KEY,
  deposit_id VARCHAR(128) NOT NULL REFERENCES deposits(id),
  user_id VARCHAR(128) NOT NULL REFERENCES profiles(id),
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'rejected')),
  resolved_by VARCHAR(128) REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payment_ids (
  payment_id VARCHAR(128) PRIMARY KEY,
  deposit_id VARCHAR(128) NOT NULL REFERENCES deposits(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  valid_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS access_status (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'suspended')),
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_revocations (
  user_id VARCHAR(128) PRIMARY KEY REFERENCES profiles(id),
  valid_after TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bonus_wallets (
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

CREATE TABLE IF NOT EXISTS audit (
  id BIGSERIAL PRIMARY KEY,
  actor_id VARCHAR(128),
  action VARCHAR(100) NOT NULL,
  reference VARCHAR(128),
  payload JSONB,
  payload_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_audit_action_reference UNIQUE (action, reference)
);

CREATE TABLE IF NOT EXISTS approvals (
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

CREATE TABLE IF NOT EXISTS withdrawal_requests (
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
