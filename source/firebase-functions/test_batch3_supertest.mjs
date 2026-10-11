import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import pg from 'pg';

console.log('=== BATCH 3 SUPERTEST OVER REAL HTTP ===\n');

// 1. Start Embedded Postgres
const pgPath = join(process.cwd(), '.pgdata');
let port = 5433;
const ep = new EmbeddedPostgres({
  port,
  databaseDir: pgPath,
  persistent: true
});

try {
  await ep.initialise();
} catch (e) {}
try {
  await ep.start();
  console.log(`Embedded PostgreSQL running on port ${port}`);
} catch (e) {
  console.log(`PostgreSQL already listening on port ${port}`);
}

process.env.DATABASE_URL = `postgresql://postgres:password@localhost:${port}/postgres`;
process.env.ALLOW_TEST_AUTH = 'true';
process.env.KYC_HMAC_SECRET = 'TEST-KYC-HMAC-SECRET-1234567890';
process.env.ORIN_NOWPAYMENTS_IPN_SECRET = 'TEST-IPN-SECRET-2026';
process.env.ORIN_NOWPAYMENTS_API_KEY = 'TEST-API-KEY';
process.env.ORIN_DEPOSITS_ENABLED = 'true';
process.env.TEST_MODE = 'true';

// 2. Deploy FRESH schema
const { Client, Pool } = pg;
const adminClient = new Client({ connectionString: process.env.DATABASE_URL });
await adminClient.connect();

const migrationsDir = existsSync('./migrations') ? './migrations' : '../migrations';
const m1 = readFileSync(join(migrationsDir, '001_core_schema.sql'), 'utf8');
const m2 = readFileSync(join(migrationsDir, '002_triggers_and_roles.sql'), 'utf8');
const m3 = readFileSync(join(migrationsDir, '003_docs_and_indexes.sql'), 'utf8');
const m4 = readFileSync(join(migrationsDir, '004_audit_unique_action_reference.sql'), 'utf8');
const m5 = readFileSync(join(migrationsDir, '005_grant_reconciliation_view.sql'), 'utf8');

await adminClient.query(`
  DROP VIEW IF EXISTS account_ledger_reconciliation CASCADE;
  DROP TABLE IF EXISTS journal_entries CASCADE;
  DROP TABLE IF EXISTS journals CASCADE;
  DROP TABLE IF EXISTS positions CASCADE;
  DROP TABLE IF EXISTS receipts CASCADE;
  DROP TABLE IF EXISTS contract_revocation_state CASCADE;
  DROP TABLE IF EXISTS contracts CASCADE;
  DROP TABLE IF EXISTS payment_reviews CASCADE;
  DROP TABLE IF EXISTS payment_ids CASCADE;
  DROP TABLE IF EXISTS deposits CASCADE;
  DROP TABLE IF EXISTS qualified_deposits CASCADE;
  DROP TABLE IF EXISTS bonus_wallets CASCADE;
  DROP TABLE IF EXISTS bonus_claims CASCADE;
  DROP TABLE IF EXISTS eligible_revenue CASCADE;
  DROP TABLE IF EXISTS program_evidence CASCADE;
  DROP TABLE IF EXISTS referral_attributions CASCADE;
  DROP TABLE IF EXISTS referral_codes CASCADE;
  DROP TABLE IF EXISTS referral_rewards CASCADE;
  DROP TABLE IF EXISTS program_members CASCADE;
  DROP TABLE IF EXISTS withdrawal_requests CASCADE;
  DROP TABLE IF EXISTS approvals CASCADE;
  DROP TABLE IF EXISTS verified_customers CASCADE;
  DROP TABLE IF EXISTS customer_registry CASCADE;
  DROP TABLE IF EXISTS kyc_files CASCADE;
  DROP TABLE IF EXISTS kyc_access_log CASCADE;
  DROP TABLE IF EXISTS kyc_requests CASCADE;
  DROP TABLE IF EXISTS staff CASCADE;
  DROP TABLE IF EXISTS access_status CASCADE;
  DROP TABLE IF EXISTS session_revocations CASCADE;
  DROP TABLE IF EXISTS trusted_events CASCADE;
  DROP TABLE IF EXISTS program_configuration_history CASCADE;
  DROP TABLE IF EXISTS program_configuration CASCADE;
  DROP TABLE IF EXISTS commands CASCADE;
  DROP TABLE IF EXISTS docs CASCADE;
  DROP TABLE IF EXISTS audit CASCADE;
  DROP TABLE IF EXISTS accounts CASCADE;
  DROP TABLE IF EXISTS profiles CASCADE;
`);

await adminClient.query("SET app.orin_app_password = 'test_pass'");
await adminClient.query(m1);
await adminClient.query(m2);
await adminClient.query(m3);
await adminClient.query(m4);
await adminClient.query(m5);

console.log('[PASS] Fresh PostgreSQL schema deployed successfully.\n');

// Import Supertest and App
const request = (await import('supertest')).default;
const { app } = await import('./src/index.ts');
const { canonical } = await import('./src/nowpayments.ts');
const { publish } = await import('./src/contracts.ts');

const tokenA = 'test-token-userA:usera@orin.top:user:UserA';
const tokenB = 'test-token-userB:userb@orin.top:user:UserB';
const tokenAdmin1 = 'test-token-admin1:admin1@orin.top:admin:Admin1';
const tokenAdmin2 = 'test-token-admin2:admin2@orin.top:admin:Admin2';

// Seed admin profiles
await adminClient.query(`
  INSERT INTO profiles (id, email, display_name, role) VALUES
    ('admin1', 'admin1@orin.top', 'Admin One', 'admin'),
    ('admin2', 'admin2@orin.top', 'Admin Two', 'admin')
  ON CONFLICT (id) DO NOTHING;
`);

// Seed program config in docs
const programConfig = {
  enabled: true,
  termsVersion: 'v1.0',
  eligibleAssets: ['BTC-USD'],
  bonusProfitLimitCents: 20000,
  bonusAmountCents: 10000,
  referralAmountCents: 8000,
  firstDepositCents: 50000,
  levels: []
};
await adminClient.query(
  "INSERT INTO docs (collection, id, data, updated_at) VALUES ('system', 'program_config', $1::jsonb, NOW())",
  [JSON.stringify(programConfig)]
);
await adminClient.query(
  "INSERT INTO program_configuration (key, config, revision) VALUES ('current', $1::jsonb, 0)",
  [JSON.stringify(programConfig)]
);

// --- 1. Login Token & Create Account ---
console.log('--- 1. Login Token & Create Account ---');
const resLoginA = await request(app)
  .get('/api/settings')
  .set('Authorization', `Bearer ${tokenA}`);

assert.equal(resLoginA.status, 200);
assert.equal(resLoginA.body.clientId, 'userA');
console.log('[PASS] User A logged in; settings returned successfully.');

const profA = await adminClient.query("SELECT * FROM profiles WHERE id = 'userA'");
assert.equal(profA.rowCount, 1);
const accA = await adminClient.query("SELECT * FROM accounts WHERE user_id = 'userA' AND type = 'real'");
assert.equal(accA.rowCount, 1);
assert.equal(accA.rows[0].balance_cents, '0');
const accAId = accA.rows[0].id;
console.log(`[PASS] Profiles & Accounts row created automatically on first request. Account ID: ${accAId}, Balance: 0.`);

// --- 2. NOWPayments Deposit Webhook ---
console.log('\n--- 2. NOWPayments Deposit Webhook ---');
const depId = 'np-' + createHmac('sha256', 'seed').update('supertest-dep-1').digest('hex');
const payId = '555123456789';
const depAmountCents = 100000; // $1,000

// Insert waiting deposit
await adminClient.query(
  `INSERT INTO deposits (id, user_id, account_id, amount_cents, coin, provider, payment_id, status)
   VALUES ($1, 'userA', $2, $3, 'usdttrc20', 'nowpayments', $4, 'waiting')`,
  [depId, accAId, depAmountCents, payId]
);
await adminClient.query(
  `INSERT INTO payment_ids (payment_id, deposit_id) VALUES ($1, $2)`,
  [payId, depId]
);

const secret = process.env.ORIN_NOWPAYMENTS_IPN_SECRET;
const webhookBody = {
  order_id: depId,
  payment_id: payId,
  payment_status: 'finished',
  price_amount: 1000,
  price_currency: 'usd',
  pay_currency: 'usdttrc20',
  pay_amount: '100',
  actually_paid: '100',
  pay_address: '0x1234567890abcdef1234567890abcdef12345678'
};
const sign = (b) => createHmac('sha512', secret).update(JSON.stringify(canonical(b))).digest('hex');
const sig = sign(webhookBody);

const resWebhook1 = await request(app)
  .post('/api/payments/nowpayments/ipn')
  .set('x-nowpayments-sig', sig)
  .send(webhookBody);

console.log('resWebhook1 status:', resWebhook1.status, 'body:', resWebhook1.body);
assert.equal(resWebhook1.status, 200);
assert.equal(resWebhook1.body.ok, true);

// Send duplicate webhook
const resWebhook2 = await request(app)
  .post('/api/payments/nowpayments/ipn')
  .set('x-nowpayments-sig', sig)
  .send(webhookBody);

assert.equal(resWebhook2.status, 200);
assert.equal(resWebhook2.body.ok, true);

const depRow = await adminClient.query("SELECT * FROM deposits WHERE id = $1", [depId]);
console.log('Deposit row after webhook:', depRow.rows[0]);
const jRes = await adminClient.query("SELECT * FROM journals");
console.log('Journals after webhook:', jRes.rows);
const jeRes = await adminClient.query("SELECT * FROM journal_entries");
console.log('Journal entries after webhook:', jeRes.rows);
const accAfterDep = await adminClient.query("SELECT * FROM accounts WHERE id = $1", [accAId]);
console.log('Account row after webhook:', accAfterDep.rows[0]);
assert.equal(accAfterDep.rows[0].balance_cents, '100000');
console.log('[PASS] Deposit credited exactly once on duplicate webhook! User A Balance: 100,000 cents ($1,000).');

// --- 3. Join Contract ---
console.log('\n--- 3. Join Contract Flow ---');
const adminIdentity = { id: 'admin1', email: 'admin1@orin.top', role: 'admin' };
const contractNow = Date.now();
const pubContract = await publish(adminIdentity, {
  title: 'BTCUSD Supertest Contract',
  asset: 'BTC-USD',
  direction: 'BUY',
  durationSec: 120,
  settlementBps: 500, // +5%
  opensAt: contractNow - 10000,
  closesAt: contractNow + 600000,
  eligibility: 'all'
});

const contractId = pubContract.id;

const resJoin = await request(app)
  .post('/api/lab')
  .set('Authorization', `Bearer ${tokenA}`)
  .send({
    action: 'join',
    contractId: contractId,
    amountCents: 20000,
    confirmed: true
  });

assert.equal(resJoin.status, 200);
assert.equal(typeof resJoin.body.id, 'string');

const accAfterJoin = await adminClient.query("SELECT balance_cents, reserved_cents FROM accounts WHERE id = $1", [accAId]);
assert.equal(accAfterJoin.rows[0].balance_cents, '80000');
assert.equal(accAfterJoin.rows[0].reserved_cents, '20000');
console.log('[PASS] Join contract succeeded! Cash: 80,000 cents, Reserved: 20,000 cents.');

// --- 4. Settle Contract ---
console.log('\n--- 4. Settle Contract Flow ---');
const resSettle = await request(app)
  .post('/api/lab')
  .set('Authorization', `Bearer ${tokenA}`)
  .send({
    action: 'settle',
    now: contractNow + 200000
  });

assert.equal(resSettle.status, 200);
assert.equal(Array.isArray(resSettle.body), true);
assert.equal(resSettle.body[0].resultCents, 1000); // 20000 * 500 / 10000 = +1000 cents

const accAfterSettle = await adminClient.query("SELECT balance_cents, reserved_cents FROM accounts WHERE id = $1", [accAId]);
assert.equal(accAfterSettle.rows[0].balance_cents, '101000');
assert.equal(accAfterSettle.rows[0].reserved_cents, '0');
console.log('[PASS] Contract settled with profit! Cash: 101,000 cents ($1,010), Reserved: 0.');

// --- 5. Withdraw Request ---
console.log('\n--- 5. Withdraw Request Flow ---');
const resWithdraw = await request(app)
  .post('/api/withdrawals')
  .set('Authorization', `Bearer ${tokenA}`)
  .send({
    amountCents: 25000, // $250
    coin: 'USDT',
    address: '0xUserAWithdrawalAddressTrc20'
  });

assert.equal(resWithdraw.status, 200);
assert.equal(resWithdraw.body.ok, true);
assert.equal(resWithdraw.body.status, 'requested');
const withdrawalId = resWithdraw.body.id;
console.log(`[PASS] Withdrawal requested: ID = ${withdrawalId}, Amount = 25,000 cents, Status = requested.`);

// --- 6. Admin 2-Man Approval & Payout ---
console.log('\n--- 6. Admin 2-Man Approval & Payout Flow ---');

// Admin 1 proposes approval
const resPropose = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${tokenAdmin1}`)
  .send({
    action: 'withdrawal.propose',
    data: {
      withdrawalId: withdrawalId,
      reason: 'Verified account balance and AML checks'
    }
  });

assert.equal(resPropose.status, 200);
assert.equal(resPropose.body.ok, true);
const approvalId = resPropose.body.approvalId;
console.log(`[PASS] Admin 1 proposed approval: Approval ID = ${approvalId}.`);

// Admin 1 attempts self-approval (must fail with 403)
const resSelfApprove = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${tokenAdmin1}`)
  .send({
    action: 'withdrawal.approve',
    data: { approvalId }
  });

assert.equal(resSelfApprove.status, 403);
console.log('[PASS] Self-approval blocked! chk_approvals_no_self_approval verified.');

// Admin 2 approves
const resApprove = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${tokenAdmin2}`)
  .send({
    action: 'withdrawal.approve',
    data: { approvalId }
  });

assert.equal(resApprove.status, 200);
assert.equal(resApprove.body.ok, true);
assert.equal(resApprove.body.status, 'approved');
console.log('[PASS] Admin 2 approved withdrawal!');

// Admin marks paid with tx_hash
const payoutTx = '0xsupertestpayouttxhash999888';
const resPay = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${tokenAdmin2}`)
  .send({
    action: 'withdrawal.pay',
    data: {
      withdrawalId: withdrawalId,
      txHash: payoutTx
    }
  });

assert.equal(resPay.status, 200);
assert.equal(resPay.body.ok, true);
assert.equal(resPay.body.status, 'paid');
assert.equal(resPay.body.txHash, payoutTx);

const accAfterPay = await adminClient.query("SELECT balance_cents FROM accounts WHERE id = $1", [accAId]);
assert.equal(accAfterPay.rows[0].balance_cents, '76000'); // 101000 - 25000 = 76000
console.log(`[PASS] Withdrawal paid with tx_hash! User A final balance: 76,000 cents ($760).`);

// --- 7. User B Isolation (404 on User A's Data) ---
console.log("\n--- 7. User B Isolation (404 on User A's Data) ---");

// User B attempts to access User A's withdrawal
const resUserBAccess = await request(app)
  .get(`/api/withdrawals/${withdrawalId}`)
  .set('Authorization', `Bearer ${tokenB}`);

assert.equal(resUserBAccess.status, 404);
console.log(`[PASS] User B received 404 accessing User A's withdrawal ID ${withdrawalId}. User data isolation verified!`);

// User B's own withdrawals list is empty
const resUserBList = await request(app)
  .get('/api/withdrawals')
  .set('Authorization', `Bearer ${tokenB}`);

assert.equal(resUserBList.status, 200);
assert.equal(resUserBList.body.items.length, 0);
console.log("[PASS] User B withdrawals list contains 0 items.");

// --- 8. Unported Route Returns 501 ---
console.log('\n--- 8. Unported Routes Return 501 ---');
const res501 = await request(app)
  .get('/api/some-unimplemented-feature')
  .set('Authorization', `Bearer ${tokenA}`);

assert.equal(res501.status, 501);
console.log('[PASS] Unimplemented route correctly returns 501 Not Implemented.');

// --- 9. Check All Journals Sum to 0 ---
console.log('\n--- 9. Verify Every Journal Entry Sums to 0 ---');
const journalsCheck = await adminClient.query(`
  SELECT journal_id, SUM(amount_cents) as total
  FROM journal_entries
  GROUP BY journal_id
  HAVING SUM(amount_cents) <> 0;
`);
assert.equal(journalsCheck.rowCount, 0);
console.log('[PASS] All journal entry groups sum to exactly 0 (0 unbalanced journals found).');

// --- 10. Check Invariant Reconciliation View ---
console.log('\n--- 10. Invariant Reconciliation View ---');
const invRes = await adminClient.query(`
  SELECT * FROM account_ledger_reconciliation
  WHERE cash_discrepancy <> 0
     OR reserved_discrepancy <> 0
     OR bonus_discrepancy <> 0
     OR bonus_reserved_discrepancy <> 0
     OR bonus_profit_discrepancy <> 0;
`);
console.log('Invariant Mismatch Count:', invRes.rowCount);
assert.equal(invRes.rowCount, 0, 'Invariant view must return exactly 0 rows!');
console.log('[PASS] INVARIANT VERIFIED: 0 mismatch rows across all accounts and ledger buckets.');

console.log('\n=== ALL BATCH 3 SUPERTEST END-TO-END TESTS PASSED SUCCESSFULLY ===\n');

await adminClient.end();
process.exit(0);
