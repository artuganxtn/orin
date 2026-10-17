-- =====================================================================
-- MIGRATION 026: RECONCILE PENDING AND APPROVED WITHDRAWALS
-- Deduct balances for withdrawals that were approved or requested
-- prior to the automatic submission debit fix.
-- =====================================================================

DO $$
DECLARE
  r RECORD;
  v_journal_id TEXT;
BEGIN
  FOR r IN
    SELECT w.id, w.user_id, w.account_id, w.amount_cents
    FROM withdrawal_requests w
    WHERE w.status IN ('requested', 'approved', 'paid')
      AND NOT EXISTS (
        SELECT 1 FROM journals j WHERE j.reference = w.id AND j.kind = 'withdrawal'
      )
  LOOP
    v_journal_id := 'jnl-wd-' || r.id;
    INSERT INTO journals (id, kind, reference, created_at)
    VALUES (v_journal_id, 'withdrawal', r.id, NOW())
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
    VALUES
      (v_journal_id, r.user_id, r.account_id, 'cash', -r.amount_cents),
      (v_journal_id, NULL, NULL, 'system:payout-clearing', r.amount_cents)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;
