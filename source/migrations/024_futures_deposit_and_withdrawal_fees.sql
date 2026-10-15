-- =====================================================================
-- MIGRATION 024: FUTURES DEPOSITS, CHALLENGE 20% EARLY EXIT FEE, AND 5% WITHDRAWAL FEE
-- =====================================================================

-- 1. Add fee_cents and net_amount_cents to withdrawal_requests
ALTER TABLE withdrawal_requests
  ADD COLUMN IF NOT EXISTS fee_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount_cents BIGINT;

-- 2. Backfill existing withdrawal_requests if any have net_amount_cents as NULL
UPDATE withdrawal_requests
SET fee_cents = ROUND(amount_cents * 0.05),
    net_amount_cents = amount_cents - ROUND(amount_cents * 0.05)
WHERE net_amount_cents IS NULL;

-- 3. Ensure permissions for orin_app
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orin_app') THEN
    GRANT SELECT, INSERT, UPDATE ON withdrawal_requests TO orin_app;
  END IF;
END $$;
