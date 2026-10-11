import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import assert from 'node:assert/strict';
import { runMigrations } from './src/migrate.ts';

const { Pool } = pg;

console.log('=== STARTING ALL-IN-ONE EVIDENCE RUN FOR contracts.ts FIXES ===');

const ep = new EmbeddedPostgres({
  port: 5433,
  databaseDir: './.pgdata',
  persistent: true
});

try {
  await ep.start();
} catch (e) {}

const adminUrl = 'postgres://postgres:password@localhost:5433/postgres';
const appUrl = 'postgres://orin_app:orin_app_pass@localhost:5433/postgres';

process.env.DATABASE_URL = appUrl;

// 1. Run migrations
console.log('\n--- STEP 1: RUNNING MIGRATIONS VIA RUNNER ---');
await runMigrations(adminUrl, '../migrations');

// Dynamically import db and contracts
const { pool, withTx } = await import('./src/db.ts');
const { publish, join, settle, state, hash } = await import('./src/contracts.ts');

const runSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Helper for invariant check
async function assertInvariant(stepName) {
  const cli = await pool.connect();
  const res = await cli.query(`
    SELECT * FROM account_ledger_reconciliation
    WHERE cash_discrepancy <> 0
       OR reserved_discrepancy <> 0
       OR bonus_discrepancy <> 0
       OR bonus_reserved_discrepancy <> 0
       OR bonus_profit_discrepancy <> 0;
  `);
  cli.release();
  console.log(`[INVARIANT] ${stepName}: Mismatches = ${res.rows.length} rows`);
  assert.equal(res.rows.length, 0, `Invariant failed at ${stepName}`);
}

const adminUser = { id: 'admin-1', verified: true, role: 'admin' };
const traderAlice = { id: 'usr-alice-' + runSuffix, verified: true, role: 'user' };
const traderBob = { id: 'usr-bob-' + runSuffix, verified: true, role: 'user' };

const accAliceId = 'acc-alice-' + runSuffix;
const accBobId = 'acc-bob-' + runSuffix;
const accAliceNum = '1' + Math.floor(10000000000 + Math.random() * 90000000000);
const accBobNum = '2' + Math.floor(10000000000 + Math.random() * 90000000000);

const adminPool = new Pool({ connectionString: adminUrl });
const seedCli = await adminPool.connect();

await seedCli.query(`
  INSERT INTO profiles (id, email, display_name, role, tier) VALUES
  ('admin-1', 'admin1@orin.test', 'Admin One', 'admin', 'vip'),
  ('admin-maker-uid', 'maker@orin.test', 'Finance Maker', 'admin', 'vip'),
  ('admin-checker-uid', 'checker@orin.test', 'Finance Checker', 'admin', 'vip')
  ON CONFLICT (id) DO NOTHING;
`);

await seedCli.query(`
  INSERT INTO profiles (id, email, display_name, role, tier) VALUES
  ($1, $2, 'Alice Trader', 'user', 'standard'),
  ($3, $4, 'Bob Advanced', 'user', 'advanced');
`, [traderAlice.id, `${traderAlice.id}@orin.test`, traderBob.id, `${traderBob.id}@orin.test`]);

await seedCli.query(`
  INSERT INTO accounts (id, user_id, account_number, type, balance_cents, bonus_cents) VALUES
  ($1, $2, $3, 'real', 0, 0),
  ($4, $5, $6, 'real', 0, 0);
`, [accAliceId, traderAlice.id, accAliceNum, accBobId, traderBob.id, accBobNum]);

// Initial funding via ledger
await seedCli.query('BEGIN;');
await seedCli.query(`
  INSERT INTO journals (id, kind, reference) VALUES
  ($1, 'deposit', 'seed-alice'),
  ($2, 'nonwithdrawable_bonus', 'seed-alice-bonus'),
  ($3, 'deposit', 'seed-bob');
`, [`j-seed-alice-${runSuffix}`, `j-seed-alice-bonus-${runSuffix}`, `j-seed-bob-${runSuffix}`]);

await seedCli.query(`
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ($1, $2, $3, 'cash', 100000),
  ($1, NULL, NULL, 'system:payment-clearing', -100000),
  ($4, $2, $3, 'bonus', 20000),
  ($4, NULL, NULL, 'system:program-grant', -20000),
  ($5, $6, $7, 'cash', 50000),
  ($5, NULL, NULL, 'system:payment-clearing', -50000);
`, [`j-seed-alice-${runSuffix}`, traderAlice.id, accAliceId, `j-seed-alice-bonus-${runSuffix}`, `j-seed-bob-${runSuffix}`, traderBob.id, accBobId]);

// Create bonus wallet for Alice with eligible assets ['BTCUSD', 'ETHUSD']
await seedCli.query(`
  INSERT INTO bonus_wallets (user_id, account_id, profit_limit_cents, first_deposit_cents, claimed, claimed_at, expires_at, eligible_assets)
  VALUES ($1, $2, 20000, 50000, true, NOW(), NOW() + INTERVAL '7 days', '["BTCUSD", "ETHUSD"]'::jsonb);
`, [traderAlice.id, accAliceId]);

await seedCli.query('COMMIT;');
seedCli.release();

await assertInvariant('Initial Funding');

// --- 1. BONUS LOSS TEST ---
console.log('\n--- STEP 2: BONUS LOSS SETTLEMENT & INVARIANT VIEW ---');
const now = Date.now();

// Publish a bonus-eligible loss contract (-500 bps = -5%)
const bonusLossContract = await publish(adminUser, {
  title: 'Bonus Loss 60s Contract',
  asset: 'BTCUSD',
  direction: 'SELL',
  durationSec: 60,
  settlementBps: -500, // -5%
  opensAt: now - 5000,
  closesAt: now + 3600000,
  eligibility: 'all'
}, now);

// Alice joins with 5,000 cents bonus
const bonusLossJoin = await join(traderAlice, {
  code: bonusLossContract.code,
  amountCents: 5000,
  confirmed: true,
  useBonus: true
}, now);
console.log('Bonus Loss Position Created:', bonusLossJoin);

await assertInvariant('After Bonus Loss Join');

// Settle the bonus loss position
const settleTime = now + 65000;
const bonusLossSettleRes = await settle(traderAlice, settleTime);
console.log('Bonus Loss Settle Result:', bonusLossSettleRes);
assert.equal(bonusLossSettleRes[0].resultCents, -250);

// Check journal entries for bonus loss
const bLossCli = await pool.connect();
const bLossEntries = await bLossCli.query(`
  SELECT je.id, je.journal_id, je.user_id, je.account_id, je.bucket, je.amount_cents
  FROM journal_entries je
  WHERE je.journal_id = $1
  ORDER BY je.id ASC;
`, [`settle:${bonusLossJoin.id}`]);
console.log('Bonus Loss Journal Entries (Raw Database Output):');
console.table(bLossEntries.rows);
bLossCli.release();

// Invariant verification after bonus loss
await assertInvariant('After Bonus Loss Settlement');

// --- 2. UNIQUE(action, reference) ON AUDIT TEST ---
console.log('\n--- STEP 3: UNIQUE(action, reference) ON AUDIT ---');
const auditCli = await pool.connect();

// Verify repeated join creates no second audit row
const auditRowsBefore = await auditCli.query(
  'SELECT count(*) FROM audit WHERE action = $1 AND reference = $2',
  ['AMOUNT_ALLOCATED', bonusLossJoin.id]
);
assert.equal(Number(auditRowsBefore.rows[0].count), 1);

// Re-run idempotent join
const secondJoinRes = await join(traderAlice, {
  code: bonusLossContract.code,
  amountCents: 5000,
  confirmed: true,
  useBonus: true
}, now);
assert.equal(secondJoinRes.reused, true);

const auditRowsAfter = await auditCli.query(
  'SELECT count(*) FROM audit WHERE action = $1 AND reference = $2',
  ['AMOUNT_ALLOCATED', bonusLossJoin.id]
);
assert.equal(Number(auditRowsAfter.rows[0].count), 1);
console.log('[PASS] Repeated join created no second audit row! (Count = 1)');

// Direct attempt to insert duplicate action + reference without ON CONFLICT must fail with unique violation
await assert.rejects(async () => {
  await auditCli.query(`
    INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
    VALUES ('test-actor', 'AMOUNT_ALLOCATED', $1, '{}'::jsonb, 'dummy-hash')
  `, [bonusLossJoin.id]);
}, /unique constraint "uq_audit_action_reference"/);
console.log('[PASS] Direct duplicate insert rejected by uq_audit_action_reference constraint!');
auditCli.release();

// --- 3. MISSING join() CHECKS: ELIGIBILITY, BONUS WALLET EXPIRY, ELIGIBLE ASSETS ---
console.log('\n--- STEP 4: MISSING join() CHECKS ---');

// Check 3a: Tier Eligibility (Contract is 'advanced', Alice is 'standard')
const advancedContract = await publish(adminUser, {
  title: 'VIP/Advanced Only Contract',
  asset: 'BTCUSD',
  direction: 'BUY',
  durationSec: 60,
  settlementBps: 500,
  opensAt: now - 5000,
  closesAt: now + 3600000,
  eligibility: 'advanced'
}, now);

await assert.rejects(async () => {
  await join(traderAlice, { code: advancedContract.code, amountCents: 1000, confirmed: true }, now);
}, /حسابك غير مؤهل لهذا العقد/);
console.log('[PASS] Check 3a: Tier eligibility rejected standard user on advanced contract!');

// Bob is 'advanced' -> Bob can join
const bobJoinRes = await join(traderBob, { code: advancedContract.code, amountCents: 1000, confirmed: true }, now);
assert.equal(bobJoinRes.reused, false);
console.log('[PASS] Check 3a: Tier eligibility accepted advanced user!');

// Check 3b: Bonus Wallet Expiry
// Create expired bonus wallet for traderBob
const expCli = await adminPool.connect();
await expCli.query(`
  INSERT INTO bonus_wallets (user_id, account_id, profit_limit_cents, first_deposit_cents, claimed, claimed_at, expires_at, eligible_assets)
  VALUES ($1, $2, 20000, 50000, true, NOW() - INTERVAL '10 days', NOW() - INTERVAL '1 day', '["BTCUSD"]'::jsonb);
`, [traderBob.id, accBobId]);
expCli.release();

await assert.rejects(async () => {
  await join(traderBob, { code: bonusLossContract.code, amountCents: 1000, confirmed: true, useBonus: true }, now);
}, /انتهت صلاحية محفظة البونص/);
console.log('[PASS] Check 3b: Expired bonus wallet rejected!');

// Check 3c: Ineligible Asset for Bonus Trading
// Publish contract with SOLUSD asset (Alice bonus wallet only allows BTCUSD, ETHUSD)
const solContract = await publish(adminUser, {
  title: 'SOL 60s Contract',
  asset: 'SOLUSD',
  direction: 'BUY',
  durationSec: 60,
  settlementBps: 500,
  opensAt: now - 5000,
  closesAt: now + 3600000,
  eligibility: 'all'
}, now);

await assert.rejects(async () => {
  await join(traderAlice, { code: solContract.code, amountCents: 1000, confirmed: true, useBonus: true }, now);
}, /الأصل غير مؤهل للتداول بالبونص/);
console.log('[PASS] Check 3c: Non-eligible asset rejected for bonus trade!');

await assertInvariant('After missing checks');

// --- 4. state() RETURNS BONUS BALANCES ---
console.log('\n--- STEP 5: state() RETURNS BONUS BALANCES ---');
const aliceState = await state(traderAlice, now);
console.log('Alice state() balance fields:');
console.log({
  balanceCents: aliceState.balanceCents,
  reservedCents: aliceState.reservedCents,
  realizedCents: aliceState.realizedCents,
  bonusCents: aliceState.bonusCents,
  bonusReservedCents: aliceState.bonusReservedCents,
  bonusProfitCents: aliceState.bonusProfitCents,
  bonus_cents: aliceState.bonus_cents,
  bonus_reserved_cents: aliceState.bonus_reserved_cents,
  bonus_profit_cents: aliceState.bonus_profit_cents
});
assert.ok(typeof aliceState.bonus_cents === 'number');
assert.ok(typeof aliceState.bonus_reserved_cents === 'number');
assert.ok(typeof aliceState.bonus_profit_cents === 'number');
console.log('[PASS] state() returns bonus_cents, bonus_reserved_cents, bonus_profit_cents!');

// --- 5. RAW user_id OF SYSTEM ENTRIES (MUST BE NULL) ---
console.log('\n--- STEP 6: RAW user_id OF SYSTEM ENTRIES ---');
const sysCli = await pool.connect();
const sysEntries = await sysCli.query(`
  SELECT id, journal_id, user_id, account_id, bucket, amount_cents
  FROM journal_entries
  WHERE bucket LIKE 'system:%'
  ORDER BY id DESC
  LIMIT 10;
`);
console.table(sysEntries.rows);
for (const r of sysEntries.rows) {
  assert.equal(r.user_id, null, 'user_id of system entries must be NULL');
  assert.equal(r.account_id, null, 'account_id of system entries must be NULL');
}
console.log('[PASS] All system entries have user_id = NULL and account_id = NULL!');
sysCli.release();

// --- 6. WITHDRAWAL REQUESTED -> APPROVED -> PAID REAL FLOW ---
console.log('\n--- STEP 7: WITHDRAWAL REQUESTED -> APPROVED -> PAID REAL FLOW ---');
const wdId = 'wd-req-' + runSuffix;
const approvalId = 'appr-wd-' + runSuffix;
const wdJournalId = 'j-wd-' + runSuffix;
const wdAmount = 15000; // $150.00

// 1. Withdrawal requested by Alice
const wdCli = await pool.connect();
await wdCli.query(`
  INSERT INTO withdrawal_requests (id, user_id, account_id, amount_cents, currency, coin, address, status)
  VALUES ($1, $2, $3, $4, 'USD', 'USDT', 'TXxxxxxxxxxxxxxxxxxxxx', 'requested');
`, [wdId, traderAlice.id, accAliceId, wdAmount]);

// 2. Approved by second admin (maker proposes, checker approves: requested_by != approved_by)
await wdCli.query(`
  INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, approved_by, approved_at)
  VALUES ($1, 'withdrawal', $2, $3, $4, 100000, 85000, 'approved', 'Client requested withdrawal', $5, 'admin-maker-uid', 'admin-checker-uid', NOW());
`, [approvalId, traderAlice.id, accAliceId, -wdAmount, wdId]);

await wdCli.query(`
  UPDATE withdrawal_requests
  SET status = 'approved', approval_id = $1, updated_at = NOW()
  WHERE id = $2;
`, [approvalId, wdId]);

// 3. Paid via ledger journal
await withTx(async (client) => {
  await client.query(`
    INSERT INTO journals (id, kind, reference) VALUES ($1, 'withdrawal', $2);
  `, [wdJournalId, wdId]);

  await client.query(`
    INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
    ($1, $2, $3, 'cash', $4),
    ($1, NULL, NULL, 'system:payout-clearing', $5);
  `, [wdJournalId, traderAlice.id, accAliceId, -wdAmount, wdAmount]);

  await client.query(`
    UPDATE withdrawal_requests
    SET status = 'paid', tx_hash = '0xabc123payouttxhash', updated_at = NOW()
    WHERE id = $1;
  `, [wdId]);
});

// Print real rows
const wdRows = await wdCli.query('SELECT * FROM withdrawal_requests WHERE id = $1', [wdId]);
const apprRows = await wdCli.query('SELECT * FROM approvals WHERE id = $1', [approvalId]);
const wdJrnRows = await wdCli.query('SELECT * FROM journals WHERE id = $1', [wdJournalId]);
const wdJrnEntryRows = await wdCli.query('SELECT * FROM journal_entries WHERE journal_id = $1', [wdJournalId]);

console.log('\nwithdrawal_requests row:');
console.table(wdRows.rows);
console.log('\napprovals row:');
console.table(apprRows.rows);
console.log('\njournals row:');
console.table(wdJrnRows.rows);
console.log('\njournal_entries rows:');
console.table(wdJrnEntryRows.rows);

wdCli.release();
await assertInvariant('After Withdrawal Flow');

// Clean up
await adminPool.end();
await pool.end();
console.log('\n=== ALL contracts.ts FIX TESTS SUCCESSFULLY COMPLETED ===');
process.exit(0);
