import pg from 'pg';
import assert from 'node:assert/strict';
import EmbeddedPostgres from 'embedded-postgres';

const ep = new EmbeddedPostgres({
  port: 5433,
  databaseDir: './.pgdata',
  persistent: true
});
await ep.start().catch(() => {});

const { Pool } = pg;

const appUrl = 'postgres://orin_app:orin_app_pass@localhost:5433/postgres';
const adminUrl = 'postgres://postgres:password@localhost:5433/postgres';

const adminPool = new Pool({ connectionString: adminUrl });
const appPool = new Pool({ connectionString: appUrl });

const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const aliceId = 'usr-replay-alice-' + runId;
const accAliceId = 'acc-replay-alice-' + runId;
const accNum = '9' + Math.floor(10000000000 + Math.random() * 90000000000);
const admin1Id = 'admin-replay-1-' + runId;
const admin2Id = 'admin-replay-2-' + runId;

// 1. Seed user, profile, account as admin
const adminCli = await adminPool.connect();
await adminCli.query(`
  INSERT INTO profiles (id, email, display_name, role) VALUES
  ($1, $2, 'Alice Replay', 'user'),
  ($3, $4, 'First Admin', 'admin'),
  ($5, $6, 'Second Admin', 'admin');
`, [
  aliceId, `${aliceId}@orin.test`,
  admin1Id, `${admin1Id}@orin.test`,
  admin2Id, `${admin2Id}@orin.test`
]);

await adminCli.query(`
  INSERT INTO accounts (id, user_id, account_number, type, balance_cents, bonus_cents, bonus_profit_cents)
  VALUES ($1, $2, $3, 'real', 0, 0, 0);
`, [accAliceId, aliceId, accNum]);
adminCli.release();

// 2. Execute full smoke replay connected as orin_app
const cli = await appPool.connect();

const journals = [
  {
    id: `j-dep-${runId}`,
    kind: 'deposit',
    ref: `dep-order-1-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'cash', amount_cents: 100000 },
      { user_id: null, account_id: null, bucket: 'system:payment-clearing', amount_cents: -100000 }
    ]
  },
  {
    id: `j-alloc-${runId}`,
    kind: 'allocation',
    ref: `pos-trade-1-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'cash', amount_cents: -10000 },
      { user_id: aliceId, account_id: accAliceId, bucket: 'reserved', amount_cents: 10000 }
    ]
  },
  {
    id: `j-settle-${runId}`,
    kind: 'settlement',
    ref: `pos-trade-1-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'reserved', amount_cents: -10000 },
      { user_id: aliceId, account_id: accAliceId, bucket: 'cash', amount_cents: 10500 },
      { user_id: null, account_id: null, bucket: 'system:trading-pnl', amount_cents: -500 }
    ]
  },
  {
    id: `j-adj-cred-${runId}`,
    kind: 'adjustment',
    ref: `adj-credit-1-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'cash', amount_cents: 5000 },
      { user_id: null, account_id: null, bucket: 'system:adjustment-clearing', amount_cents: -5000 }
    ]
  },
  {
    id: `j-adj-deb-${runId}`,
    kind: 'adjustment',
    ref: `adj-debit-1-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'cash', amount_cents: -1000 },
      { user_id: null, account_id: null, bucket: 'system:adjustment-clearing', amount_cents: 1000 }
    ]
  },
  {
    id: `j-ref-rew-${runId}`,
    kind: 'referral_reward',
    ref: `ref-reward-1-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'cash', amount_cents: 8000 },
      { user_id: null, account_id: null, bucket: 'system:program-expense', amount_cents: -8000 }
    ]
  },
  {
    id: `j-team-rew-${runId}`,
    kind: 'team_activity',
    ref: `team-reward-1-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'cash', amount_cents: 2500 },
      { user_id: null, account_id: null, bucket: 'system:program-expense', amount_cents: -2500 }
    ]
  },
  {
    id: `j-bonus-grant-${runId}`,
    kind: 'nonwithdrawable_bonus',
    ref: `bonus-claim-1-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'bonus', amount_cents: 10000 },
      { user_id: null, account_id: null, bucket: 'system:program-grant', amount_cents: -10000 }
    ]
  },
  {
    id: `j-bonus-alloc-${runId}`,
    kind: 'bonus_allocation',
    ref: `pos-btrade-1-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'bonus', amount_cents: -5000 },
      { user_id: aliceId, account_id: accAliceId, bucket: 'bonus_reserved', amount_cents: 5000 }
    ]
  },
  {
    id: `j-bonus-settle-${runId}`,
    kind: 'bonus_settlement',
    ref: `pos-btrade-1-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'bonus_reserved', amount_cents: -5000 },
      { user_id: aliceId, account_id: accAliceId, bucket: 'bonus', amount_cents: 5000 },
      { user_id: aliceId, account_id: accAliceId, bucket: 'bonus_profit', amount_cents: 250 },
      { user_id: null, account_id: null, bucket: 'system:program-payout', amount_cents: -250 }
    ]
  },
  {
    id: `j-bonus-unlock-${runId}`,
    kind: 'bonus_profit_unlock',
    ref: `unlock-qualifying-dep-${runId}`,
    entries: [
      { user_id: aliceId, account_id: accAliceId, bucket: 'bonus_profit', amount_cents: -250 },
      { user_id: aliceId, account_id: accAliceId, bucket: 'cash', amount_cents: 250 }
    ]
  }
];

await cli.query('BEGIN;');
for (const j of journals) {
  await cli.query('INSERT INTO journals (id, kind, reference) VALUES ($1, $2, $3)', [j.id, j.kind, j.ref]);
  for (const e of j.entries) {
    await cli.query(
      'INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES ($1, $2, $3, $4, $5)',
      [j.id, e.user_id, e.account_id, e.bucket, e.amount_cents]
    );
  }
}
await cli.query('COMMIT;');

// Intermediate balance check before withdrawal:
const preWithdrawalAcc = await cli.query('SELECT * FROM accounts WHERE id = $1', [accAliceId]);
console.log('--- PRE-WITHDRAWAL ALICE BALANCE (EXACT MATCH TO 115,250 CENTS) ---');
console.table(preWithdrawalAcc.rows);

// 3. WITHDRAWAL STEPS:
// Step A: Withdrawal Requested by Alice (15,000 cents = $150.00)
const wdId = 'wd-req-' + runId;
await cli.query(`
  INSERT INTO withdrawal_requests (id, user_id, account_id, currency, amount_cents, coin, address, status)
  VALUES ($1, $2, $3, 'USD', 15000, 'USDT_TRC20', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'requested');
`, [wdId, aliceId, accAliceId]);
console.log('[WITHDRAWAL STEP 1: REQUESTED]');
const wdStep1 = await cli.query('SELECT id, user_id, amount_cents, status, approval_id FROM withdrawal_requests WHERE id = $1', [wdId]);
console.table(wdStep1.rows);

// Step B: Approved by Second Admin (Maker-Checker Governance)
const approvalId = 'appr-wd-' + runId;
const adminCli2 = await adminPool.connect();
await adminCli2.query(`
  INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, approved_by, approved_at)
  VALUES ($1, 'withdrawal', $2, $3, -15000, 115250, 100250, 'approved', 'Dual-control withdrawal approval', $4, $5, $6, NOW());
`, [approvalId, aliceId, accAliceId, wdId, admin1Id, admin2Id]);
adminCli2.release();

await cli.query(`
  UPDATE withdrawal_requests
  SET status = 'approved', approval_id = $1
  WHERE id = $2;
`, [approvalId, wdId]);
console.log('[WITHDRAWAL STEP 2: APPROVED BY SECOND ADMIN]');
const wdStep2 = await cli.query('SELECT id, user_id, amount_cents, status, approval_id FROM withdrawal_requests WHERE id = $1', [wdId]);
console.table(wdStep2.rows);

// Step C: Paid via ledger journal kind 'withdrawal'
const wdJournalId = 'j-wd-' + runId;
await cli.query('BEGIN;');
await cli.query(`
  INSERT INTO journals (id, kind, reference) VALUES ($1, 'withdrawal', $2);
`, [wdJournalId, wdId]);
await cli.query(`
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ($1, $2, $3, 'cash', -15000),
  ($1, NULL, NULL, 'system:payout-clearing', 15000);
`, [wdJournalId, aliceId, accAliceId]);
await cli.query(`
  UPDATE withdrawal_requests SET status = 'paid' WHERE id = $1;
`, [wdId]);
await cli.query('COMMIT;');

console.log('[WITHDRAWAL STEP 3: PAID]');
const wdStep3 = await cli.query('SELECT id, user_id, amount_cents, status, approval_id FROM withdrawal_requests WHERE id = $1', [wdId]);
console.table(wdStep3.rows);

// 4. PRINT EVERY ENTRY OF EVERY JOURNAL IN FULL (NO "...")
console.log('--- ALL REPLAY JOURNAL ENTRIES (NO TRUNCATION) ---');
const allEntriesRes = await cli.query(`
  SELECT 
    je.journal_id,
    j.kind,
    j.reference,
    je.bucket,
    je.amount_cents,
    COALESCE(je.user_id, 'SYSTEM') as user_id,
    COALESCE(je.account_id, 'SYSTEM') as account_id
  FROM journal_entries je
  JOIN journals j ON je.journal_id = j.id
  WHERE j.id LIKE 'j-%-' || $1
  ORDER BY j.created_at ASC, je.id ASC;
`, [runId]);
console.table(allEntriesRes.rows);

// 5. PER-JOURNAL SUMS (VERIFY EVERY JOURNAL SUMS TO 0)
console.log('--- PER-JOURNAL SUMS (MUST BE EXACTLY 0) ---');
const perJournalSums = await cli.query(`
  SELECT 
    je.journal_id,
    j.kind,
    SUM(je.amount_cents) as journal_sum_cents,
    COUNT(*) as entry_count
  FROM journal_entries je
  JOIN journals j ON je.journal_id = j.id
  WHERE j.id LIKE 'j-%-' || $1
  GROUP BY je.journal_id, j.kind
  ORDER BY je.journal_id ASC;
`, [runId]);
console.table(perJournalSums.rows);

for (const row of perJournalSums.rows) {
  assert.equal(Number(row.journal_sum_cents), 0, `Journal ${row.journal_id} does not sum to 0`);
  assert.ok(Number(row.entry_count) >= 2, `Journal ${row.journal_id} has < 2 entries`);
}
console.log('[PASS] All journals sum to 0 and have >= 2 entries!');

// 6. SYSTEM BUCKET TOTALS
console.log('--- SYSTEM BUCKET TOTALS ---');
const systemBuckets = await cli.query(`
  SELECT 
    bucket,
    SUM(amount_cents) as total_amount_cents
  FROM journal_entries
  WHERE journal_id LIKE 'j-%-' || $1
    AND bucket LIKE 'system:%'
  GROUP BY bucket
  ORDER BY bucket ASC;
`, [runId]);
console.table(systemBuckets.rows);

// 7. FINAL ACCOUNT BALANCES
console.log('--- FINAL ACCOUNT BALANCES FOR ALICE (AFTER WITHDRAWAL) ---');
const postWithdrawalAcc = await cli.query('SELECT * FROM accounts WHERE id = $1', [accAliceId]);
console.table(postWithdrawalAcc.rows);

// 8. RECONCILIATION INVARIANT
console.log('--- INVARIANT RECONCILIATION CHECK ---');
const recCheck = await cli.query(`
  SELECT * FROM account_ledger_reconciliation WHERE account_id = $1;
`, [accAliceId]);
console.table(recCheck.rows);
assert.equal(Number(recCheck.rows[0].cash_discrepancy), 0);
assert.equal(Number(recCheck.rows[0].balance_cents), 100250);

console.log('=== REPLAY COMPLETED AND VERIFIED SUCCESSFULLY ===');
cli.release();
await adminPool.end();
await appPool.end();
process.exit(0);
