import type { Database } from "./engine.ts";

// Keep compound trigger statements intact when sending them to the D1 binding.
// Initialization must succeed before any virtual account is created or modified.
const statements = [
  "CREATE TRIGGER IF NOT EXISTS contracts_no_update BEFORE UPDATE ON contracts BEGIN SELECT RAISE(ABORT, 'Published contract terms are immutable'); END;",
  "CREATE TRIGGER IF NOT EXISTS contracts_no_delete BEFORE DELETE ON contracts BEGIN SELECT RAISE(ABORT, 'Published contracts cannot be deleted'); END;",
  "CREATE TRIGGER IF NOT EXISTS positions_terms_no_update BEFORE UPDATE OF user_id,contract_id,amount_cents,result_cents,started_at,ends_at ON positions BEGIN SELECT RAISE(ABORT, 'Position terms are immutable'); END;",
  "CREATE TRIGGER IF NOT EXISTS positions_valid_insert BEFORE INSERT ON positions WHEN typeof(NEW.amount_cents)!='integer' OR NEW.amount_cents<100 OR typeof(NEW.result_cents)!='integer' OR NEW.ends_at<=NEW.started_at OR NEW.status!='active' BEGIN SELECT RAISE(ABORT, 'Invalid virtual position'); END;",
  "CREATE TRIGGER IF NOT EXISTS positions_no_delete BEFORE DELETE ON positions BEGIN SELECT RAISE(ABORT, 'Positions cannot be deleted'); END;",
  "CREATE TRIGGER IF NOT EXISTS positions_settlement_only BEFORE UPDATE OF status ON positions WHEN OLD.status!='active' OR NEW.status!='settled' OR NOT EXISTS(SELECT 1 FROM journals WHERE id='settle:'||OLD.id AND status='posted') BEGIN SELECT RAISE(ABORT, 'Position requires a posted settlement'); END;",
  "CREATE TRIGGER IF NOT EXISTS ledger_valid_insert BEFORE INSERT ON ledger_entries WHEN typeof(NEW.amount_cents)!='integer' OR NEW.amount_cents=0 OR NOT EXISTS(SELECT 1 FROM journals WHERE id=NEW.journal_id AND status='pending') BEGIN SELECT RAISE(ABORT, 'Ledger requires integer nonzero amounts and an open journal'); END;",
  "CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'Ledger entries are immutable'); END;",
  "CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'Ledger entries cannot be deleted'); END;",
  "CREATE TRIGGER IF NOT EXISTS journal_validate_post BEFORE UPDATE OF status ON journals BEGIN\n SELECT CASE WHEN OLD.status!='pending' OR NEW.status!='posted' THEN RAISE(ABORT,'Invalid journal transition') END;\n SELECT CASE WHEN (SELECT COUNT(*) FROM ledger_entries WHERE journal_id=NEW.id)<2 OR (SELECT COALESCE(SUM(amount_cents),0) FROM ledger_entries WHERE journal_id=NEW.id)!=0 THEN RAISE(ABORT,'Unbalanced double-entry journal') END;\n SELECT CASE WHEN EXISTS(SELECT e.account FROM ledger_entries e JOIN journals j ON e.journal_id=j.id WHERE (j.status='posted' OR j.id=NEW.id) AND e.account IN(SELECT account FROM ledger_entries WHERE journal_id=NEW.id AND account LIKE 'user:%') GROUP BY e.account HAVING SUM(e.amount_cents)<0) THEN RAISE(ABORT,'Negative virtual user account') END;\n END;",
  "CREATE TRIGGER IF NOT EXISTS journals_no_metadata_update BEFORE UPDATE OF id,kind,user_id,reference,effective_at,created_at ON journals BEGIN SELECT RAISE(ABORT, 'Journal metadata is immutable'); END;",
  "CREATE TRIGGER IF NOT EXISTS journals_no_delete BEFORE DELETE ON journals BEGIN SELECT RAISE(ABORT, 'Journals cannot be deleted'); END;",
  "CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END;",
  "CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events cannot be deleted'); END;",
  "CREATE TRIGGER IF NOT EXISTS receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'Receipts are immutable'); END;",
  "CREATE TRIGGER IF NOT EXISTS receipts_no_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT, 'Receipts cannot be deleted'); END;"
];
const initialized = new WeakMap<Database, Promise<void>>();
export async function ensureInvariants(db:Database):Promise<void>{
  let pending=initialized.get(db);
  if(!pending){
    pending=db.batch(statements.map(sql=>db.prepare(sql))).then(()=>undefined).catch(error=>{initialized.delete(db);throw error;});
    initialized.set(db,pending);
  }
  await pending;
}
