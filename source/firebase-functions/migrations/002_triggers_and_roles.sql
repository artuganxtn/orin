-- =====================================================================
-- MIGRATION 002: TRIGGERS, CONSTRAINTS & APPLICATION ROLE
-- =====================================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

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
    PERFORM set_config('app.ledger_mutation', 'off', true);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

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

-- Triggers
DROP TRIGGER IF EXISTS trg_check_account_balance_update ON accounts;
CREATE TRIGGER trg_check_account_balance_update
BEFORE UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION check_account_balance_update();

DROP TRIGGER IF EXISTS trg_journals_immutable ON journals;
CREATE TRIGGER trg_journals_immutable
BEFORE UPDATE OR DELETE ON journals
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_check_journal_entry_count ON journals;
CREATE CONSTRAINT TRIGGER trg_check_journal_entry_count
AFTER INSERT ON journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_journal_entry_count();

DROP TRIGGER IF EXISTS trg_journal_entries_immutable ON journal_entries;
CREATE TRIGGER trg_journal_entries_immutable
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_apply_journal_entry ON journal_entries;
CREATE TRIGGER trg_apply_journal_entry
AFTER INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION apply_journal_entry_to_account();

DROP TRIGGER IF EXISTS trg_journal_balance ON journal_entries;
CREATE CONSTRAINT TRIGGER trg_journal_balance
AFTER INSERT OR UPDATE ON journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_journal_balance();

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit;
CREATE TRIGGER trg_audit_immutable
BEFORE UPDATE OR DELETE ON audit
FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();

-- Application Role Setup
DO $$
DECLARE
  v_pass TEXT;
BEGIN
  v_pass := NULLIF(current_setting('app.orin_app_password', true), '');
  IF v_pass IS NULL THEN
    RAISE EXCEPTION 'app.orin_app_password configuration is required and cannot be empty';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'orin_app') THEN
    EXECUTE format('CREATE ROLE orin_app WITH LOGIN PASSWORD %L', v_pass);
  ELSE
    EXECUTE format('ALTER ROLE orin_app WITH LOGIN PASSWORD %L', v_pass);
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO orin_app', current_database());
  GRANT USAGE ON SCHEMA public TO orin_app;
  GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO orin_app;
  GRANT UPDATE ON profiles, contracts, positions, receipts, deposits, payment_reviews, approvals, withdrawal_requests, bonus_wallets TO orin_app;
  GRANT UPDATE (status, currency, revision, updated_at) ON accounts TO orin_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orin_app;

  REVOKE DELETE, UPDATE ON journals, journal_entries, audit FROM orin_app;
  REVOKE UPDATE (balance_cents, reserved_cents, bonus_cents, bonus_reserved_cents, bonus_profit_cents) ON accounts FROM orin_app;
END $$;
