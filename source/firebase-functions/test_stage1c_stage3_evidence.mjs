import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { runMigrations } from './src/migrate.ts';

const { Pool } = pg;

console.log('=== STARTING TEST SUITE: STAGE 1c & STAGE 3 COMPLETE EVIDENCE ===');

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

// 1. Run migrations using migration runner
console.log('--- 1. RUNNING MIGRATIONS VIA RUNNER ---');
await runMigrations(adminUrl, '../migrations');

// Dynamically import db and contracts now that process.env.DATABASE_URL is set
const { pool, withTx } = await import('./src/db.ts');
const { publish, join, settle, state, hash } = await import('./src/contracts.ts');

const runSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 2. LEDGER FIX 1 TEST:
// Test: In ONE transaction, insert a journal then run direct UPDATE of balance_cents as postgres superuser -> MUST FAIL
console.log('--- 2. TESTING FIX 1: DIRECT UPDATE IN SAME TRANSACTION MUST FAIL ---');
const adminPool = new Pool({ connectionString: adminUrl });
const adminCli = await adminPool.connect();

const fix1User = 'usr-fix1-' + runSuffix;
const fix1Acc = 'acc-fix1-' + runSuffix;
const fix1Journal = 'j-fix1-' + runSuffix;
const fix1Num = '8' + Math.floor(10000000000 + Math.random() * 90000000000);

await adminCli.query(`
  INSERT INTO profiles (id, email, display_name) VALUES ($1, $2, 'Fix1 User');
`, [fix1User, `${fix1User}@orin.test`]);
await adminCli.query(`
  INSERT INTO accounts (id, user_id, account_number, balance_cents) VALUES ($1, $2, $3, 0);
`, [fix1Acc, fix1User, fix1Num]);

await assert.rejects(async () => {
  await adminCli.query(`
    BEGIN;
    INSERT INTO journals (id, kind, reference) VALUES ('${fix1Journal}', 'deposit', 'ref-fix1');
    INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
    ('${fix1Journal}', '${fix1User}', '${fix1Acc}', 'cash', 1000),
    ('${fix1Journal}', NULL, NULL, 'system:payment-clearing', -1000);
    -- Direct update in SAME transaction right after journal entry:
    UPDATE accounts SET balance_cents = balance_cents + 500 WHERE id = '${fix1Acc}';
    COMMIT;
  `);
}, /Direct update of balance columns on accounts is prohibited/);
await adminCli.query('ROLLBACK;').catch(() => {});
console.log('[PASS] Fix 1 Verified: Direct UPDATE right after journal in same transaction failed with trigger exception!');

adminCli.release();

// Helper to assert invariant
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
  console.log(`[INVARIANT] ${stepName}: Mismatches = ${res.rows.length}`);
  assert.equal(res.rows.length, 0, `Invariant failed at ${stepName}`);
}

// All subsequent operations connect as orin_app!
console.log('--- 3. TESTING CONTRACTS.TS CONNECTED EXCLUSIVELY AS orin_app ---');

// Setup trader and contract
const adminUser = { id: 'admin-1', verified: true, role: 'admin' };
const traderAlice = { id: 'usr-alice-' + runSuffix, verified: true, role: 'user' };
const traderBonus = { id: 'usr-bonus-' + runSuffix, verified: true, role: 'user' };
const accAliceId = 'acc-alice-' + runSuffix;
const accBonusId = 'acc-bonus-' + runSuffix;
const accAliceNum = '1' + Math.floor(10000000000 + Math.random() * 90000000000);
const accBonusNum = '2' + Math.floor(10000000000 + Math.random() * 90000000000);

const seedCli = await adminPool.connect();
await seedCli.query(`
  INSERT INTO profiles (id, email, display_name, role) VALUES ('admin-1', 'admin1@orin.test', 'Admin One', 'admin')
  ON CONFLICT DO NOTHING;
`);
await seedCli.query(`
  INSERT INTO profiles (id, email, display_name, role) VALUES ($1, $2, 'Alice Test', 'user');
`, [traderAlice.id, `${traderAlice.id}@orin.test`]);
await seedCli.query(`
  INSERT INTO profiles (id, email, display_name, role) VALUES ($1, $2, 'Bonus Test', 'user');
`, [traderBonus.id, `${traderBonus.id}@orin.test`]);

await seedCli.query(`
  INSERT INTO accounts (id, user_id, account_number, type, balance_cents, bonus_cents) VALUES ($1, $2, $3, 'real', 0, 0);
`, [accAliceId, traderAlice.id, accAliceNum]);
await seedCli.query(`
  INSERT INTO accounts (id, user_id, account_number, type, balance_cents, bonus_cents) VALUES ($1, $2, $3, 'real', 0, 0);
`, [accBonusId, traderBonus.id, accBonusNum]);

await seedCli.query('BEGIN;');
await seedCli.query(`
  INSERT INTO journals (id, kind, reference) VALUES ($1, 'deposit', 'seed-alice');
`, [`j-seed-alice-${runSuffix}`]);

await seedCli.query(`
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ($1, $2, $3, 'cash', 10000),
  ($1, NULL, NULL, 'system:payment-clearing', -10000);
`, [`j-seed-alice-${runSuffix}`, traderAlice.id, accAliceId]);

await seedCli.query(`
  INSERT INTO journals (id, kind, reference) VALUES ($1, 'nonwithdrawable_bonus', 'seed-bonus');
`, [`j-seed-bonus-${runSuffix}`]);

await seedCli.query(`
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ($1, $2, $3, 'bonus', 10000),
  ($1, NULL, NULL, 'system:program-grant', -10000);
`, [`j-seed-bonus-${runSuffix}`, traderBonus.id, accBonusId]);
await seedCli.query('COMMIT;');
seedCli.release();

await assertInvariant('After initial funding');

// Publish contracts
const now = Date.now();

// Win contract (+500 bps)
const winContract = await publish(adminUser, {
  title: 'Win 60s Contract',
  asset: 'BTCUSD',
  direction: 'BUY',
  durationSec: 60,
  settlementBps: 500, // +5%
  opensAt: now - 5000,
  closesAt: now + 3600000,
  eligibility: 'all'
}, now);

// Loss contract (-500 bps)
const lossContract = await publish(adminUser, {
  title: 'Loss 60s Contract',
  asset: 'ETHUSD',
  direction: 'SELL',
  durationSec: 60,
  settlementBps: -500, // -5%
  opensAt: now - 5000,
  closesAt: now + 3600000,
  eligibility: 'all'
}, now);

// Boundary contract
const boundaryContract = await publish(adminUser, {
  title: 'Boundary Contract',
  asset: 'BTCUSD',
  direction: 'BUY',
  durationSec: 60,
  settlementBps: 200,
  opensAt: now - 10000,
  closesAt: now + 1000,
  eligibility: 'all'
}, now);

await assertInvariant('After contracts published');

// TEST 4: 50 concurrent join() calls for full balance
console.log('--- 4. 50 CONCURRENT join() CALLS CONNECTED AS orin_app ---');
const concContracts = await Promise.all(
  Array.from({ length: 50 }, (_, i) =>
    publish(adminUser, {
      title: `Conc Contract ${i}`,
      asset: 'BTCUSD',
      direction: 'BUY',
      durationSec: 60,
      settlementBps: 500,
      opensAt: now - 5000,
      closesAt: now + 3600000,
      eligibility: 'all'
    }, now)
  )
);

const joinPromises = concContracts.map(c =>
  join(traderAlice, {
    code: c.code,
    amountCents: 10000,
    confirmed: true,
    contractHash: c.hash
  }, now)
);

const joinResults = await Promise.allSettled(joinPromises);

let successCount = 0;
let successfulContract = null;
const errorGroups = {};

for (let i = 0; i < joinResults.length; i++) {
  const res = joinResults[i];
  if (res.status === 'fulfilled' && res.value.reused === false) {
    successCount++;
    successfulContract = concContracts[i];
  } else if (res.status === 'rejected') {
    const msg = res.reason.message;
    errorGroups[msg] = (errorGroups[msg] || 0) + 1;
  }
}

console.log('50 Concurrent join() Outcomes:');
console.log(`Success count: ${successCount}`);
console.log('Failures grouped by error message:');
console.table(errorGroups);

assert.equal(successCount, 1);
assert.equal(errorGroups['الرصيد المتاح غير كافٍ لهذا العقد.'], 49);
console.log('[PASS] Exactly 1 succeeded; 49 failed with insufficient balance!');
await assertInvariant('After 50 concurrent joins');

// TEST 5: Amount <= 0 rejected
console.log('--- 5. TESTING AMOUNT <= 0 REJECTED ---');
await assert.rejects(async () => {
  await join(traderAlice, { code: winContract.code, amountCents: 0, confirmed: true }, now);
}, /راجع المبلغ وأكّد شروط الحساب/);

await assert.rejects(async () => {
  await join(traderAlice, { code: winContract.code, amountCents: -500, confirmed: true }, now);
}, /راجع المبلغ وأكّد شروط الحساب/);
console.log('[PASS] Amount <= 0 correctly rejected!');

// TEST 6: Join at exact expiry boundary (now == closes_at) rejected
console.log('--- 6. TESTING JOIN AT EXACT EXPIRY BOUNDARY ---');
const expiryTime = now + 1000;
await assert.rejects(async () => {
  await join(traderAlice, { code: boundaryContract.code, amountCents: 100, confirmed: true }, expiryTime);
}, /العقد خارج نافذة المشاركة/);
console.log('[PASS] Join at exact expiry boundary rejected!');

// TEST 7: Same idempotency key twice -> returns { id, reused: true } and exactly one position row
console.log('--- 7. TESTING SAME IDEMPOTENCY KEY TWICE ---');
const reuseRes = await join(traderAlice, {
  code: successfulContract.code,
  amountCents: 10000,
  confirmed: true,
  contractHash: successfulContract.hash
}, now);
console.log('Second join with identical terms returned:', reuseRes);
assert.equal(reuseRes.reused, true);

const posCli = await pool.connect();
const posCountRes = await posCli.query(
  'SELECT count(*) FROM positions WHERE user_id = $1',
  [traderAlice.id]
);
posCli.release();
assert.equal(Number(posCountRes.rows[0].count), 1);
console.log('[PASS] Reused position returned without creating duplicate position row! (Total positions = 1)');
await assertInvariant('After idempotency test');

// TEST 8: Two CONCURRENT settle() calls on separate connections
console.log('--- 8. TWO CONCURRENT settle() CALLS ON SEPARATE CONNECTIONS ---');
const settleTime = now + 65000;
const [settleA, settleB] = await Promise.all([
  settle(traderAlice, settleTime),
  settle(traderAlice, settleTime)
]);
console.log('Concurrent Settle A result:', settleA);
console.log('Concurrent Settle B result:', settleB);

const oneGotResults = (settleA.length === 1 && settleB.length === 0) || (settleA.length === 0 && settleB.length === 1);
assert.ok(oneGotResults, 'Exactly one concurrent settle call must process the position, the other gets []');
console.log('[PASS] Concurrent settlement idempotency verified: one settled, one returned []!');
await assertInvariant('After settle concurrency');

// TEST 9: Attempt to drive reserved_cents below 0 rejected by CHECK constraint
console.log('--- 9. ATTEMPT TO DRIVE reserved_cents BELOW 0 REJECTED BY CHECK ---');
await assert.rejects(async () => {
  await withTx(async (client) => {
    // Attempt an unbalanced deduction directly on reserved bucket beyond existing reserved
    const badJournal = 'j-bad-reserved-' + runSuffix;
    await client.query(`
      INSERT INTO journals (id, kind, reference) VALUES ($1, 'allocation', 'ref-bad');
    `, [badJournal]);
    await client.query(`
      INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
      ($1, $2, $3, 'reserved', -99999),
      ($1, $2, $3, 'cash', 99999);
    `, [badJournal, traderAlice.id, accAliceId]);
  });
}, /check constraint "accounts_reserved_cents_check"/);
console.log('[PASS] Attempt to drive reserved_cents below 0 rejected by accounts_reserved_cents_check!');
await assertInvariant('After reserved_cents check');

// TEST 10: Bonus-account join + settle with profit
console.log('--- 10. BONUS ACCOUNT JOIN + SETTLE WITH PROFIT ---');
const bonusJoin = await join(traderBonus, {
  code: winContract.code,
  amountCents: 5000,
  confirmed: true,
  useBonus: true
}, now);
console.log('Bonus Join Result:', bonusJoin);
await assertInvariant('After bonus join');

const bonusSettle = await settle(traderBonus, settleTime);
console.log('Bonus Settle Result:', bonusSettle);

// Check bonus entries in journal_entries:
const bCli = await pool.connect();
const bEntries = await bCli.query(`
  SELECT je.bucket, je.amount_cents, je.user_id
  FROM journal_entries je
  JOIN journals j ON je.journal_id = j.id
  WHERE j.kind = 'bonus_settlement' AND j.reference = $1
`, [bonusJoin.id]);
console.log('Bonus Settlement Journal Entries:');
console.table(bEntries.rows);
bCli.release();

const hasBonusProfit = bEntries.rows.some(r => r.bucket === 'bonus_profit' && Number(r.amount_cents) === 250);
const hasSystemPayout = bEntries.rows.some(r => r.bucket === 'system:program-payout' && Number(r.amount_cents) === -250);
assert.ok(hasBonusProfit, 'Must credit bonus_profit bucket');
assert.ok(hasSystemPayout, 'Must have counter entry system:program-payout');
console.log('[PASS] Bonus profit landed in bonus_profit bucket with system:program-payout counter-entry!');
await assertInvariant('After bonus settle');

// TEST 11: Loss settlement (negative PnL)
console.log('--- 11. LOSS SETTLEMENT (NEGATIVE PnL) ---');
// Fund Alice with 10,000 cents for loss contract
const fundLossCli = await adminPool.connect();
const lossFundJournal = 'j-loss-fund-' + runSuffix;
await fundLossCli.query('BEGIN;');
await fundLossCli.query(`
  INSERT INTO journals (id, kind, reference) VALUES ($1, 'deposit', 'loss-fund');
`, [lossFundJournal]);
await fundLossCli.query(`
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ($1, $2, $3, 'cash', 10000),
  ($1, NULL, NULL, 'system:payment-clearing', -10000);
`, [lossFundJournal, traderAlice.id, accAliceId]);
await fundLossCli.query('COMMIT;');
fundLossCli.release();

const lossJoin = await join(traderAlice, {
  code: lossContract.code,
  amountCents: 10000,
  confirmed: true
}, now);
console.log('Loss Contract Joined:', lossJoin);

const lossSettle = await settle(traderAlice, settleTime);
console.log('Loss Settlement Run:', lossSettle);
assert.equal(lossSettle[0].resultCents, -500);

const lossCli = await pool.connect();
const lossEntries = await lossCli.query(`
  SELECT je.bucket, je.amount_cents, je.user_id
  FROM journal_entries je
  WHERE je.journal_id = $1
`, [`settle:${lossJoin.id}`]);
lossCli.release();
console.log('Loss Settlement Journal Entries:');
console.table(lossEntries.rows);

const hasLossCash = lossEntries.rows.some(r => r.bucket === 'cash' && Number(r.amount_cents) === 9500);
const hasTradingPnlCounter = lossEntries.rows.some(r => r.bucket === 'system:trading-pnl' && Number(r.amount_cents) === 500);
assert.ok(hasLossCash, 'Cash returned must be 9500 (10000 - 500 loss)');
assert.ok(hasTradingPnlCounter, 'system:trading-pnl must be +500 (counter-entry)');
console.log('[PASS] Loss settlement correctly debited loss and posted +500 to system:trading-pnl!');
await assertInvariant('After loss settlement');

// AUDIT TABLE ROWS RAW OUTPUT
console.log('--- 12. AUDIT TABLE ROWS (SELECT * FROM audit ORDER BY created_at) ---');
const auditCli = await pool.connect();
const auditRows = await auditCli.query('SELECT * FROM audit ORDER BY created_at ASC');
auditCli.release();
console.table(auditRows.rows);

console.log('=== ALL REAL POSTGRESQL STAGE 1c & STAGE 3 TESTS PASSED ===');
await adminPool.end();
await pool.end();
process.exit(0);
