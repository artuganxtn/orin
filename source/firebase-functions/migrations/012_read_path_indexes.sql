-- 012_read_path_indexes.sql
-- Optimizes read-path queries for 60fps scrolling and fast list responses.

CREATE INDEX IF NOT EXISTS idx_positions_user_status_ends ON positions (user_id, status, ends_at);
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_id ON journal_entries (user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_user_created ON receipts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_opens_at ON contracts (opens_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_collection_owner ON docs (collection, owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox (status, next_attempt_at);
