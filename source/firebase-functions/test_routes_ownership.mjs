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
const pool = new Pool({ connectionString: appUrl });

console.log('=== TESTING ROUTE READ OWNERSHIP & 404 ON FOREIGN RESOURCES ===');

const runId = Date.now().toString(36);
const aliceId = 'usr-route-alice-' + runId;
const bobId = 'usr-route-bob-' + runId;
const adminUrl = 'postgres://postgres:password@localhost:5433/postgres';
const adminPool = new Pool({ connectionString: adminUrl });

const adminCli = await adminPool.connect();
await adminCli.query(`
  INSERT INTO profiles (id, email, display_name) VALUES
  ($1, $2, 'Alice Owner'),
  ($3, $4, 'Bob Intruder');
`, [aliceId, `${aliceId}@orin.test`, bobId, `${bobId}@orin.test`]);

const alAccNum = '1' + Math.floor(10000000000 + Math.random() * 90000000000);
const bobAccNum = '2' + Math.floor(10000000000 + Math.random() * 90000000000);

await adminCli.query(`
  INSERT INTO accounts (id, user_id, account_number, type, balance_cents) VALUES
  ('acc-al-' || $1, $1, $3, 'real', 0),
  ('acc-bob-' || $2, $2, $4, 'real', 0);
`, [aliceId, bobId, alAccNum, bobAccNum]);

await adminCli.query('BEGIN;');
await adminCli.query(`
  INSERT INTO journals (id, kind, reference) VALUES
  ('j-own-al-' || $1, 'deposit', 'seed-al'),
  ('j-own-bob-' || $2, 'deposit', 'seed-bob');
`, [aliceId, bobId]);

await adminCli.query(`
  INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
  ('j-own-al-' || $1, $1, 'acc-al-' || $1, 'cash', 1000),
  ('j-own-al-' || $1, NULL, NULL, 'system:payment-clearing', -1000),
  ('j-own-bob-' || $2, $2, 'acc-bob-' || $2, 'cash', 1000),
  ('j-own-bob-' || $2, NULL, NULL, 'system:payment-clearing', -1000);
`, [aliceId, bobId]);
await adminCli.query('COMMIT;');

await adminCli.query(`
  INSERT INTO contracts (id, code, title, asset, direction, duration_sec, settlement_bps, opens_at, closes_at, hash, canonical, admin_id)
  VALUES ('cnt-own-' || $1, 'LAB-OWN-' || $1, 'Own Contract', 'BTCUSD', 'BUY', 60, 100, NOW() - interval '1 hour', NOW() + interval '1 hour', 'h1', '{}', $1);
`, [aliceId]);

await adminCli.query(`
  INSERT INTO positions (id, user_id, contract_id, account_id, amount_cents, result_cents, started_at, ends_at)
  VALUES ('pos-alice-' || $1, $1, 'cnt-own-' || $1, 'acc-al-' || $1, 1000, 10, NOW(), NOW() + interval '60 seconds');
`, [aliceId]);

await adminCli.query(`
  INSERT INTO receipts (id, position_id, user_id, payload, hash)
  VALUES ('rec-alice-' || $1, 'pos-alice-' || $1, $1, '{"test":true}', 'rh1');
`, [aliceId]);

await adminCli.query(`
  INSERT INTO docs (collection, id, owner_id, data)
  VALUES ('demo_wallets', $1, $1, '{"balance_cents": 1000000}');
`, [aliceId]);

await adminCli.query(`
  INSERT INTO withdrawal_requests (id, user_id, account_id, amount_cents, currency, coin, address, status)
  VALUES ('wd-alice-' || $1, $1, 'acc-al-' || $1, 500, 'USD', 'USDT_TRC20', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'requested');
`, [aliceId]);
adminCli.release();

const cli = await pool.connect();

// Helper to simulate route read: returns 200 row or throws 404
function enforceFound(row, resourceName) {
  if (!row) {
    const err = new Error(`${resourceName} not found`);
    err.statusCode = 404;
    throw err;
  }
  return { status: 200, data: row };
}

// 1. Read position route: GET /api/lab/positions/:id
async function readPosition(requestingUser, posId) {
  const res = await cli.query(
    'SELECT * FROM positions WHERE id = $1 AND user_id = $2',
    [posId, requestingUser.id]
  );
  return enforceFound(res.rows[0], 'Position');
}

// 2. Read receipt route: GET /api/lab/receipts/:id
async function readReceipt(requestingUser, recId) {
  const res = await cli.query(
    'SELECT * FROM receipts WHERE id = $1 AND user_id = $2',
    [recId, requestingUser.id]
  );
  return enforceFound(res.rows[0], 'Receipt');
}

// 3. Read demo wallet in docs: GET /api/accounts/demo
async function readDemoWallet(requestingUser) {
  const res = await cli.query(
    'SELECT * FROM docs WHERE collection = $1 AND owner_id = $2',
    ['demo_wallets', requestingUser.id]
  );
  return enforceFound(res.rows[0], 'DemoWallet');
}

// 4. Read withdrawal request route: GET /api/withdrawals/:id
async function readWithdrawal(requestingUser, wdId) {
  const res = await cli.query(
    'SELECT * FROM withdrawal_requests WHERE id = $1 AND user_id = $2',
    [wdId, requestingUser.id]
  );
  return enforceFound(res.rows[0], 'Withdrawal');
}

const alice = { id: aliceId };
const bob = { id: bobId };
const alicePosId = 'pos-alice-' + aliceId;
const aliceRecId = 'rec-alice-' + aliceId;
const aliceWdId = 'wd-alice-' + aliceId;

// Test A: Alice reads own position -> 200 OK
const aPos = await readPosition(alice, alicePosId);
assert.equal(aPos.status, 200);
console.log('[PASS] Alice reads own position: 200 OK');

// Test B: Bob attempts to read Alice's position -> 404 Not Found (not 403, preventing enumeration)
await assert.rejects(async () => {
  await readPosition(bob, alicePosId);
}, (err) => err.statusCode === 404);
console.log('[PASS] Bob reading Alice position rejected with 404 Not Found!');

// Test C: Alice reads own receipt -> 200 OK
const aRec = await readReceipt(alice, aliceRecId);
assert.equal(aRec.status, 200);
console.log('[PASS] Alice reads own receipt: 200 OK');

// Test D: Bob attempts to read Alice's receipt -> 404 Not Found
await assert.rejects(async () => {
  await readReceipt(bob, aliceRecId);
}, (err) => err.statusCode === 404);
console.log('[PASS] Bob reading Alice receipt rejected with 404 Not Found!');

// Test E: Alice reads own demo wallet from docs -> 200 OK
const aDemo = await readDemoWallet(alice);
assert.equal(aDemo.status, 200);
console.log('[PASS] Alice reads own demo wallet in docs: 200 OK');

// Test F: Bob attempts to read Alice's demo wallet -> 404 Not Found
await assert.rejects(async () => {
  await readDemoWallet(bob);
}, (err) => err.statusCode === 404);
console.log('[PASS] Bob reading non-existent/foreign demo wallet rejected with 404 Not Found!');

// Test G: Alice reads own withdrawal -> 200 OK
const aWd = await readWithdrawal(alice, aliceWdId);
assert.equal(aWd.status, 200);
console.log('[PASS] Alice reads own withdrawal request: 200 OK');

// Test H: Bob attempts to read Alice's withdrawal -> 404 Not Found
await assert.rejects(async () => {
  await readWithdrawal(bob, aliceWdId);
}, (err) => err.statusCode === 404);
console.log('[PASS] Bob reading Alice withdrawal rejected with 404 Not Found!');

console.log('=== ALL READ OWNERSHIP & 404 TESTS PASSED ===');

cli.release();
await adminPool.end();
await pool.end();
process.exit(0);
