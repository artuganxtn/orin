-- OPERATOR-ONLY RELEASE STEP. NOT an automatic migration or application script.
-- Run only after backups and a coordinated release of this backend + frontend
-- + native client with fee quote/confirmation support. This assistant has NOT
-- executed this SQL. Do not run old backend writers after this step.
-- This exact one-way update is idempotent; it never moves a historical balance.
BEGIN;
UPDATE docs
SET data = data || jsonb_build_object(
  'status', 'active',
  'clientReleaseConfirmed', TRUE,
  'activatedAt', FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
), updated_at = NOW()
WHERE collection = 'financial_policy_configuration' AND id = 'current'
  AND data->>'version' = 'signal-doubling-v1'
  AND data->>'doublingScope' = 'account_aggregate'
  AND data->>'existingFundsTreatment' = 'grandfathered'
  AND data->>'status' = 'staged' AND data->>'activatedAt' IS NULL
RETURNING data;
COMMIT;
-- Exactly one row on first activation, zero on replay. Zero is not evidence of
-- readiness: read the row and verify its status/cutover before opening traffic.
