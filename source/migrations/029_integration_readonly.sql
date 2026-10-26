-- Additive only. No customer/ledger/history data is changed by this migration.
-- Applying this migration does not enable integrations or create any API key.
CREATE TABLE IF NOT EXISTS integration_keys (
  id UUID PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  label VARCHAR(80) NOT NULL,
  secret_hash CHAR(64) NOT NULL,
  scopes JSONB NOT NULL CHECK (jsonb_typeof(scopes) = 'array'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(128) NOT NULL REFERENCES profiles(id),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS integration_keys_tenant_created ON integration_keys (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_rate_limits (
  subject_hash CHAR(64) PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL CHECK (hits > 0)
);

CREATE TABLE IF NOT EXISTS integration_audit (
  id UUID PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  actor_hash CHAR(64) NOT NULL,
  key_id UUID,
  action VARCHAR(40) NOT NULL,
  outcome VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integration_audit_created ON integration_audit (created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orin_app') THEN
    GRANT SELECT, INSERT, UPDATE ON integration_keys TO orin_app;
    GRANT SELECT, INSERT, UPDATE ON integration_rate_limits TO orin_app;
    GRANT SELECT, INSERT ON integration_audit TO orin_app;
  END IF;
END $$;
