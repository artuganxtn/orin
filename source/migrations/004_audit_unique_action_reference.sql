-- =====================================================================
-- MIGRATION 004: UNIQUE CONSTRAINT ON AUDIT(ACTION, REFERENCE)
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_audit_action_reference'
  ) THEN
    ALTER TABLE audit ADD CONSTRAINT uq_audit_action_reference UNIQUE (action, reference);
  END IF;
END $$;
