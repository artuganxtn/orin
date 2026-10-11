import pg from 'pg';
import assert from 'node:assert/strict';

const ownerUrl = process.env.OWNER_DATABASE_URL;
if (!ownerUrl) throw new Error('OWNER_DATABASE_URL required');

const appPassword = process.env.ORIN_APP_PASSWORD;
if (!appPassword) throw new Error('ORIN_APP_PASSWORD required');

// Build APP_DATABASE_URL in memory from owner URL
const u = new URL(ownerUrl);
u.username = 'orin_app';
u.password = appPassword;
u.searchParams.set('sslmode', 'require');
const appUrl = u.toString();

// Set DATABASE_URL so db.ts connects as orin_app
process.env.DATABASE_URL = appUrl;

const { pool, withTx } = await import('./src/db.ts');
const { publish, join, settle, state, hash } = await import('./src/contracts.ts');

const runSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

console.log('=== RUNNING TESTS ON RENDER POSTGRES AS orin_app ===');

// Helper to check invariant
async function checkInvariant(stepName: string) {
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
  if (res.rows.length > 0) {
    console.error('INVARIANT FAILED on Render DB:', res.rows);
    process.exit(1);
  }
}

// 1. Check initial empty database invariant
await checkInvariant('Initial Empty Render DB');

// 2. Privilege Tests as orin_app:
console.log('\n--- 1. PRIVILEGE ENFORCEMENT AS orin_app ---');
const appCli = await pool.connect();

// Direct UPDATE accounts SET balance_cents must fail
await assert.rejects(async () => {
  await appCli.query('UPDATE accounts SET balance_cents = balance_cents + 100;');
}, (err: any) => {
  return /permission denied for (table|column)|Direct update of balance columns on accounts is prohibited/i.test(err.message);
});
console.log('[PASS] Direct UPDATE accounts SET balance_cents failed with permission denied');

// DELETE FROM journal_entries must fail
await assert.rejects(async () => {
  await appCli.query('DELETE FROM journal_entries;');
}, (err: any) => {
  return err.code === '42501' || /permission denied|append-only/i.test(err.message);
});
console.log('[PASS] DELETE FROM journal_entries failed with permission denied');

appCli.release();

// 3. Full Flow Test:
console.log('\n--- 2. FULL FLOW TEST AS orin_app (deposit, join, settle, bonus, withdrawal) ---');
const adminUser = { id: 'admin-render-' + runSuffix, verified: true, role: 'admin' };
const alice = { id: 'usr-alice-' + runSuffix, verified: true, role: 'user' };
const accAliceId = 'acc-alice-' + runSuffix;
const accAliceNum = '8' + Math.floor(10000000000 + Math.random() * 90000000000);

// Setup profiles and accounts as orin_app (has INSERT permission on profiles and accounts)
await withTx(async (client) => {
  await client.query(`
    INSERT INTO profiles (id, email, display_name, role, tier) VALUES
    ($1, $2, 'Admin Render', 'admin', 'vip'),
    ($3, $4, 'Alice Render', 'user', 'standard'),
    ('admin-checker-uid', 'checker@orin.test', 'Finance Checker', 'admin', 'vip')
    ON CONFLICT (id) DO NOTHING;
  `, [adminUser.id, `${adminUser.id}@orin.test`, alice.id, `${alice.id}@orin.test`]);

  await client.query(`
    INSERT INTO accounts (id, user_id, account_number, type, balance_cents, bonus_cents) VALUES
    ($1, $2, $3, 'real', 0, 0);
  `, [accAliceId, alice.id, accAliceNum]);

  // Deposit $1,000 (100,000 cents) via ledger
  const depJid = 'j-dep-' + runSuffix;
  await client.query(`INSERT INTO journals (id, kind, reference) VALUES ($1, 'deposit', 'render-dep');`, [depJid]);
  await client.query(`
    INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
    ($1, $2, $3, 'cash', 100000),
    ($1, NULL, NULL, 'system:payment-clearing', -100000);
  `, [depJid, alice.id, accAliceId]);

  // Bonus wallet with $200 (20,000 cents) grant
  await client.query(`
    INSERT INTO bonus_wallets (user_id, account_id, profit_limit_cents, first_deposit_cents, claimed, claimed_at, expires_at, eligible_assets)
    VALUES ($1, $2, 20000, 50000, true, NOW(), NOW() + INTERVAL '7 days', '["BTCUSD", "ETHUSD"]'::jsonb);
  `, [alice.id, accAliceId]);

  const bonusJid = 'j-bonus-' + runSuffix;
  await client.query(`INSERT INTO journals (id, kind, reference) VALUES ($1, 'nonwithdrawable_bonus', 'render-bonus');`, [bonusJid]);
  await client.query(`
    INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
    ($1, $2, $3, 'bonus', 20000),
    ($1, NULL, NULL, 'system:program-grant', -20000);
  `, [bonusJid, alice.id, accAliceId]);
});

await checkInvariant('After Deposit & Bonus Funding');

const now = Date.now();

// Cash trade: Win contract (+500 bps = +5%)
const winContract = await publish(adminUser, {
  title: 'Win 60s Contract',
  asset: 'BTCUSD',
  direction: 'BUY',
  durationSec: 60,
  settlementBps: 500,
  opensAt: now - 5000,
  closesAt: now + 3600000,
  eligibility: 'all'
}, now);

const cashJoin = await join(alice, {
  code: winContract.code,
  amountCents: 10000,
  confirmed: true
}, now);
console.log('Cash trade joined:', cashJoin.id);

// Settle cash trade
const settleTime = now + 65000;
const cashSettle = await settle(alice, settleTime);
console.log('Cash trade settled:', cashSettle);
assert.equal(cashSettle[0].resultCents, 500);

await checkInvariant('After Cash Trade Settlement');

// Bonus trade: Loss contract (-500 bps = -5%)
const lossContract = await publish(adminUser, {
  title: 'Loss 60s Contract',
  asset: 'BTCUSD',
  direction: 'SELL',
  durationSec: 60,
  settlementBps: -500,
  opensAt: now - 5000,
  closesAt: now + 3600000,
  eligibility: 'all'
}, now);

const bonusJoin = await join(alice, {
  code: lossContract.code,
  amountCents: 5000,
  confirmed: true,
  useBonus: true
}, now);
console.log('Bonus trade joined:', bonusJoin.id);

const bonusSettle = await settle(alice, settleTime);
console.log('Bonus trade settled (loss):', bonusSettle);
assert.equal(bonusSettle[0].resultCents, -250);

await checkInvariant('After Bonus Loss Settlement');

// Withdrawal flow: requested -> approved -> paid
const wdId = 'wd-' + runSuffix;
const apprId = 'appr-' + runSuffix;
const wdJid = 'j-wd-' + runSuffix;

await withTx(async (client) => {
  await client.query(`
    INSERT INTO withdrawal_requests (id, user_id, account_id, amount_cents, currency, coin, address, status)
    VALUES ($1, $2, $3, 15000, 'USD', 'USDT', 'TXrenderaddress', 'requested');
  `, [wdId, alice.id, accAliceId]);

  await client.query(`
    INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, approved_by, approved_at)
    VALUES ($1, 'withdrawal', $2, $3, -15000, 100500, 85500, 'approved', 'Client withdrawal', $4, $5, 'admin-checker-uid', NOW());
  `, [apprId, alice.id, accAliceId, wdId, adminUser.id]);

  await client.query(`
    UPDATE withdrawal_requests SET status = 'approved', approval_id = $1 WHERE id = $2;
  `, [apprId, wdId]);

  await client.query(`INSERT INTO journals (id, kind, reference) VALUES ($1, 'withdrawal', $2);`, [wdJid, wdId]);
  await client.query(`
    INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents) VALUES
    ($1, $2, $3, 'cash', -15000),
    ($1, NULL, NULL, 'system:payout-clearing', 15000);
  `, [wdJid, alice.id, accAliceId]);

  await client.query(`
    UPDATE withdrawal_requests SET status = 'paid', tx_hash = '0xrenderpayouttx', updated_at = NOW() WHERE id = $1;
  `, [wdId]);
});
console.log('Withdrawal requested -> approved -> paid successfully!');

await checkInvariant('After Withdrawal Flow');

// 4. 50 Concurrent join() Calls:
console.log('\n--- 3. 50 CONCURRENT join() TEST ON RENDER POSTGRES ---');
// Alice's current balance is 85,500 cents
// Publish 50 contracts
const concContracts = await Promise.all(
  Array.from({ length: 50 }, (_, i) =>
    publish(adminUser, {
      title: `Conc Contract ${i} ${runSuffix}`,
      asset: 'BTCUSD',
      direction: 'BUY',
      durationSec: 60,
      settlementBps: 100,
      opensAt: now - 5000,
      closesAt: now + 3600000,
      eligibility: 'all'
    }, now)
  )
);

// All 50 concurrent join calls try to allocate 85,500 cents (full remaining balance)
const joinPromises = concContracts.map(c =>
  join(alice, {
    code: c.code,
    amountCents: 85500,
    confirmed: true,
    contractHash: c.hash
  }, now)
);

const joinResults = await Promise.allSettled(joinPromises);

let successCount = 0;
const errorGroups: Record<string, number> = {};

for (const res of joinResults) {
  if (res.status === 'fulfilled' && res.value.reused === false) {
    successCount++;
  } else if (res.status === 'rejected') {
    const msg = res.reason.message;
    errorGroups[msg] = (errorGroups[msg] || 0) + 1;
  }
}

console.log(`50 Concurrent join() Outcomes on Render:`);
console.log(`Success count: ${successCount}`);
console.log('Failures grouped by error message:');
console.table(errorGroups);

assert.equal(successCount, 1, 'Exactly 1 concurrent join must succeed');
assert.equal(errorGroups['الرصيد المتاح غير كافٍ لهذا العقد.'], 49, '49 must fail with insufficient balance');
console.log('[PASS] Exactly 1 succeeded; 49 rejected with insufficient balance!');

await checkInvariant('After 50 Concurrent Joins');

// 5. Clean Up Test Data on Render using owner connection:
console.log('\n--- 4. CLEANING UP TEST DATA ON RENDER ---');
const ownerPool = new pg.Pool({ connectionString: ownerUrl, ssl: { rejectUnauthorized: false } });
const ownerCli = await ownerPool.connect();

try {
  await ownerCli.query(`
    TRUNCATE TABLE
      audit,
      receipts,
      positions,
      contracts,
      contract_revocation_state,
      withdrawal_requests,
      approvals,
      financial_references,
      bonus_wallets,
      bonus_claims,
      journal_entries,
      journals,
      accounts,
      profiles
    CASCADE;
  `);

  console.log('Cleaned up test data on Render via TRUNCATE CASCADE:');
  console.log('Removed all test rows from profiles, accounts, journals, journal_entries, contracts, positions, receipts, bonus_wallets, approvals, withdrawal_requests, audit.');
} finally {
  ownerCli.release();
  await ownerPool.end();
}

// 6. Invariant check after cleanup:
await checkInvariant('Final Render DB After Clean Up');

console.log('\n=== ALL RENDER POSTGRES TESTS PASSED SUCCESSFULLY ===');
await pool.end();
process.exit(0);
