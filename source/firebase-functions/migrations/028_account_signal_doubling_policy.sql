-- Prospective activation only. Never updates existing balances, deposits,
-- positions, receipts, journal entries or wallet documents.
-- This migration stages the complete engine; it does NOT activate monetary
-- changes or break installed clients. Follow docs/FINANCIAL-POLICY.md for the
-- explicit coordinated-client-release activation and immutable cutover.
INSERT INTO docs (collection, id, data, updated_at)
VALUES ('financial_policy_configuration', 'current', jsonb_build_object(
  'version', 'signal-doubling-v1',
  'status', 'staged',
  'activatedAt', NULL,
  'clientReleaseConfirmed', FALSE,
  'doublingScope', 'account_aggregate',
  'existingFundsTreatment', 'grandfathered'
), NOW())
ON CONFLICT (collection, id) DO NOTHING;
