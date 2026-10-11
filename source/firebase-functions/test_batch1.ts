import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const { Pool } = pg;

console.log('=== BATCH 1 TEST SUITE (Postgres Migration) ===');

// 1. Start Embedded Postgres
const ep = new EmbeddedPostgres({
  port: 5433,
  databaseDir: './.pgdata',
  persistent: true
});

try {
  await ep.start();
} catch (e) {
  // If already running
}
console.log('Embedded PostgreSQL active on 127.0.0.1:5433');

process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5433/postgres';

// Dynamic import of ported modules after DATABASE_URL is set
const { paymentService } = await import('./src/payments.ts');
const { NowPayments, validIpn, canonical, units } = await import('./src/nowpayments.ts');
const { programAction, programSummary, adminPrograms, accountActivity } = await import('./src/programs.ts');
const { recordVerifiedCustomer, recordConfirmedDeposit, recordFinalBonusProfit } = await import('./src/program-ingestion.ts');
const { pool, withTx } = await import('./src/db.ts');

// 2. Deploy FRESH schema on Embedded Postgres
console.log('\n--- Deploying FRESH Schema ---');
const adminClient = await pool.connect();

const m1 = readFileSync('../migrations/001_core_schema.sql', 'utf8');
const m2 = readFileSync('../migrations/002_triggers_and_roles.sql', 'utf8');
const m3 = readFileSync('../migrations/003_docs_and_indexes.sql', 'utf8');
const m4 = readFileSync('../migrations/004_audit_unique_action_reference.sql', 'utf8');
const m5 = readFileSync('../migrations/005_grant_reconciliation_view.sql', 'utf8');

// Wipe clean
await adminClient.query(`
  DROP VIEW IF EXISTS account_ledger_reconciliation CASCADE;
  DROP TABLE IF EXISTS journal_entries CASCADE;
  DROP TABLE IF EXISTS journals CASCADE;
  DROP TABLE IF EXISTS withdrawal_requests CASCADE;
  DROP TABLE IF EXISTS approvals CASCADE;
  DROP TABLE IF EXISTS audit CASCADE;
  DROP TABLE IF EXISTS activity_payments CASCADE;
  DROP TABLE IF EXISTS eligible_revenue CASCADE;
  DROP TABLE IF EXISTS bonus_claims CASCADE;
  DROP TABLE IF EXISTS qualified_deposits CASCADE;
  DROP TABLE IF EXISTS program_evidence CASCADE;
  DROP TABLE IF EXISTS commands CASCADE;
  DROP TABLE IF EXISTS referral_attributions CASCADE;
  DROP TABLE IF EXISTS referral_codes CASCADE;
  DROP TABLE IF EXISTS referral_rewards CASCADE;
  DROP TABLE IF EXISTS program_members CASCADE;
  DROP TABLE IF EXISTS kyc_requests CASCADE;
  DROP TABLE IF EXISTS kyc_access_log CASCADE;
  DROP TABLE IF EXISTS kyc_files CASCADE;
  DROP TABLE IF EXISTS verified_customers CASCADE;
  DROP TABLE IF EXISTS customer_registry CASCADE;
  DROP TABLE IF EXISTS docs CASCADE;
  DROP TABLE IF EXISTS program_configuration_history CASCADE;
  DROP TABLE IF EXISTS program_configuration CASCADE;
  DROP TABLE IF EXISTS control_configuration CASCADE;
  DROP TABLE IF EXISTS deposit_rate_limits CASCADE;
  DROP TABLE IF EXISTS payment_ids CASCADE;
  DROP TABLE IF EXISTS payment_reviews CASCADE;
  DROP TABLE IF EXISTS deposits CASCADE;
  DROP TABLE IF EXISTS trusted_events CASCADE;
  DROP TABLE IF EXISTS receipts CASCADE;
  DROP TABLE IF EXISTS positions CASCADE;
  DROP TABLE IF EXISTS contract_revocation_state CASCADE;
  DROP TABLE IF EXISTS contracts CASCADE;
  DROP TABLE IF EXISTS bonus_wallets CASCADE;
  DROP TABLE IF EXISTS session_revocations CASCADE;
  DROP TABLE IF EXISTS access_status CASCADE;
  DROP TABLE IF EXISTS staff CASCADE;
  DROP TABLE IF EXISTS accounts CASCADE;
  DROP TABLE IF EXISTS profiles CASCADE;
  DROP TABLE IF EXISTS schema_migrations CASCADE;
`);

// Run migrations
await adminClient.query('SET app.orin_app_password = \'test_pass\'');
await adminClient.query(m1);
await adminClient.query(m2);
await adminClient.query(m3);
await adminClient.query(m4);
await adminClient.query(m5);

console.log('[PASS] FRESH Database schema deployed successfully.');

// Seed baseline profiles, accounts, and config
const alice = { id: 'usr-alice', email: 'alice@orin.test', name: 'Alice Trader', verified: true, role: 'user' };
const bob = { id: 'usr-bob', email: 'bob@orin.test', name: 'Bob Referrer', verified: true, role: 'user' };
const adminUser = { id: 'usr-admin', email: 'admin@orin.test', name: 'Admin Staff', verified: true, role: 'admin' };

await adminClient.query(`
  INSERT INTO profiles (id, email, display_name, role) VALUES
    ('usr-alice', 'alice@orin.test', 'Alice Trader', 'user'),
    ('usr-bob', 'bob@orin.test', 'Bob Referrer', 'user'),
    ('usr-admin', 'admin@orin.test', 'Admin Staff', 'admin');

  INSERT INTO accounts (id, user_id, account_number, type, currency, balance_cents) VALUES
    ('acc-alice-real', 'usr-alice', '100000000001', 'real', 'USD', 0),
    ('acc-bob-real', 'usr-bob', '100000000002', 'real', 'USD', 0);
`);

// Setup program config
const config = {
  enabled: true,
  termsVersion: 'v1.0',
  referralCriteria: 'Standard',
  activeTeamCriteria: 'Active',
  activityPeriod: 'Monthly',
  bonusDurationDays: 30,
  eligibleAssets: ['BTC-USD'],
  bonusProfitLimitCents: 20000,
  bonusAmountCents: 10000, // $100
  referralAmountCents: 8000, // $80
  firstDepositCents: 50000, // $500
  bonusTradingTerms: 'Standard',
  agencyCriteria: 'Standard',
  badgeCriteria: { elite: 'Elite trader' },
  requireKyc: true,
  levels: [
    { level: 1, direct: 1, active: 1, bps: 500, capCents: 5000 },
    { level: 2, direct: 2, active: 2, bps: 700, capCents: 10000 },
    { level: 3, direct: 3, active: 3, bps: 900, capCents: 20000 },
    { level: 4, direct: 4, active: 4, bps: 1100, capCents: 40000 },
    { level: 5, direct: 5, active: 5, bps: 1300, capCents: 80000 },
    { level: 6, direct: 6, active: 6, bps: 1500, capCents: 160000 }
  ],
  revision: 0
};

await adminClient.query(
  "INSERT INTO program_configuration (key, config, revision) VALUES ('current', $1::jsonb, 0)",
  [JSON.stringify(config)]
);

adminClient.release();

// --- TEST 1: NOWPayments Deposit credited once when webhook sent twice ---
console.log('\n--- 1. NOWPayments Webhook: Credited Once on Duplicate Webhook ---');
const secret = 'TEST-IPN-SECRET-2026';
let serial = 100000;
const providerPayments = new Map();

const mockProvider = {
  async create(orderId: string, amountCents: number, coin: string) {
    const p = {
      payment_id: String(++serial),
      order_id: orderId,
      price_amount: amountCents / 100,
      price_currency: 'usd',
      pay_currency: coin,
      pay_amount: '100',
      actually_paid: '100',
      payment_status: 'waiting',
      pay_address: '0x1234567890abcdef1234567890abcdef12345678',
      payin_extra_id: null
    };
    providerPayments.set(p.payment_id, p);
    return p;
  },
  async get(id: string) {
    return structuredClone(providerPayments.get(id));
  }
};

const service = paymentService(mockProvider, secret);
const sign = (body: any) => createHmac('sha512', secret).update(JSON.stringify(canonical(body))).digest('hex');

// Create deposit request for Alice ($1,000 = 100,000 cents)
const depItem = await service.create(alice, {
  accountId: 'acc-alice-real',
  requestId: 'req-dep-1',
  amountCents: 100000,
  coin: 'usdttrc20'
});

assert.equal(depItem.status, 'waiting');
assert.equal(depItem.credited, false);

// Simulate payment provider status finished
const currentProv = providerPayments.get(depItem.paymentId!);
currentProv.payment_status = 'finished';
currentProv.actually_paid = '100';

const webhookPayload = {
  order_id: depItem.id,
  payment_id: depItem.paymentId,
  payment_status: 'finished'
};
const sig = sign(webhookPayload);

// Send webhook TWICE concurrently
const [wh1, wh2] = await Promise.all([
  service.webhook(webhookPayload, sig),
  service.webhook(webhookPayload, sig)
]);

assert.equal(wh1.ok, true);
assert.equal(wh2.ok, true);

// Verify Alice's balance was credited exactly once ($1,000)
const chkClient = await pool.connect();
const aliceAcc = await chkClient.query("SELECT balance_cents FROM accounts WHERE id = 'acc-alice-real'");
assert.equal(aliceAcc.rows[0].balance_cents, '100000');
console.log('[PASS] Deposit credited exactly once on duplicate webhook! Balance = 100,000 cents ($1,000).');

// --- TEST 2: Underpaid goes to review + payment_reviews row ---
console.log('\n--- 2. Underpaid Deposit Routed to Review ---');
const depUnderpaid = await service.create(alice, {
  accountId: 'acc-alice-real',
  requestId: 'req-dep-underpaid',
  amountCents: 100000,
  coin: 'usdttrc20'
});

const underpaidProv = providerPayments.get(depUnderpaid.paymentId!);
underpaidProv.payment_status = 'finished';
underpaidProv.actually_paid = '50'; // 50% paid -> underpaid!

const underpaidPayload = {
  order_id: depUnderpaid.id,
  payment_id: depUnderpaid.paymentId,
  payment_status: 'finished'
};
await service.webhook(underpaidPayload, sign(underpaidPayload));

const depStatus = await chkClient.query('SELECT status, credited, review_reason FROM deposits WHERE id = $1', [depUnderpaid.id]);
assert.equal(depStatus.rows[0].status, 'review');
assert.equal(depStatus.rows[0].credited, false);
assert.equal(depStatus.rows[0].review_reason, 'amount_mismatch');

const revRow = await chkClient.query('SELECT * FROM payment_reviews WHERE deposit_id = $1', [depUnderpaid.id]);
assert.equal(revRow.rows.length, 1);
assert.equal(revRow.rows[0].reason, 'amount_mismatch');
console.log('[PASS] Underpaid deposit routed to review and payment_reviews record created!');

// --- TEST 3: Referral reward qualified and paid once ---
console.log('\n--- 3. Referral Reward Flow ---');
// Enroll Bob (referrer)
const bobEnroll = await programAction(bob, { action: 'enroll', requestId: 'enroll-bob' });
assert.match(bobEnroll.member!.code, /^ORIN-[A-F0-9]{12}$/);

// Enroll Alice with Bob's code
await programAction(alice, { action: 'enroll', referralCode: bobEnroll.member!.code, requestId: 'enroll-alice' });

// Verify KYC for Alice and Bob
await recordVerifiedCustomer(bob.id, '67a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0455', 'kyc-bob', '1111');
await recordVerifiedCustomer(alice.id, '77a2ce4cc4ab8bcc48e2162914d5c85f59f9159f6cd050969ad76a7e7dcb0499', 'kyc-alice', '2222');

// Create evidence for Alice's referral qualification
await chkClient.query(`
  INSERT INTO program_evidence (id, user_id, kind, metadata)
  VALUES ('ev-alice-qual', 'usr-alice', 'referral_qualified', '{"termsVersion":"v1.0"}'::jsonb);
`);

// Admin qualifies referral
await adminPrograms(adminUser, {
  action: 'referral',
  uid: alice.id,
  status: 'qualified',
  evidenceId: 'ev-alice-qual',
  requestId: 'qual-alice-ref'
});

// Admin pays referral reward to Bob's real account twice concurrently
const payCmd = {
  action: 'referral',
  uid: alice.id,
  status: 'paid',
  accountId: 'acc-bob-real',
  requestId: 'pay-alice-ref'
};

await adminPrograms(adminUser, payCmd);

// Repeated call should reject or be idempotent
await assert.rejects(async () => {
  await adminPrograms(adminUser, payCmd);
}, /Reward already paid/);

const bobAcc = await chkClient.query("SELECT balance_cents FROM accounts WHERE id = 'acc-bob-real'");
assert.equal(bobAcc.rows[0].balance_cents, '8000'); // $80 credited
console.log('[PASS] Referral reward paid exactly once! Bob balance = 8,000 cents ($80).');

// --- TEST 4: Bonus Claim, Profit, and Unlock Flow ---
console.log('\n--- 4. Bonus Claim + Profit + Qualifying Deposit Unlock Flow ---');
// 4a. Alice claims bonus on real account
await programAction(alice, { action: 'claim_bonus', accountId: 'acc-alice-real', requestId: 'claim-bonus-alice' });

const aliceBonusAcc = await chkClient.query("SELECT balance_cents, bonus_cents, bonus_profit_cents FROM accounts WHERE id = 'acc-alice-real'");
assert.equal(aliceBonusAcc.rows[0].bonus_cents, '10000'); // $100 bonus principal
assert.equal(aliceBonusAcc.rows[0].bonus_profit_cents, '0');
console.log('[PASS] Bonus claimed: Alice bonus_cents = 10,000 cents.');

// 4b. Record trading profit on bonus position ($150 = 15,000 cents)
await recordFinalBonusProfit({
  eventId: 'trade-profit-alice-1',
  uid: alice.id,
  accountId: 'acc-alice-real',
  asset: 'BTC-USD',
  profitCents: 15000,
  closedAt: Date.now()
});

const aliceProfitAcc = await chkClient.query("SELECT balance_cents, bonus_cents, bonus_profit_cents FROM accounts WHERE id = 'acc-alice-real'");
assert.equal(aliceProfitAcc.rows[0].bonus_profit_cents, '15000');
console.log('[PASS] Bonus profit recorded: bonus_profit_cents = 15,000 cents.');

// 4c. Qualifying deposit unlocks bonus profit into cash ($500 deposit >= $500 requirement)
await recordConfirmedDeposit({
  eventId: 'qual-dep-alice-500',
  uid: alice.id,
  accountId: 'acc-alice-real',
  currency: 'USD',
  cents: 50000,
  eligible: true
});

const aliceUnlockedAcc = await chkClient.query("SELECT balance_cents, bonus_cents, bonus_profit_cents FROM accounts WHERE id = 'acc-alice-real'");
// Balance before unlock: 100,000 (test 1) + 50,000 (qual dep) + 15,000 (unlocked profit) = 165,000 cents ($1,650)
assert.equal(aliceUnlockedAcc.rows[0].balance_cents, '165000');
assert.equal(aliceUnlockedAcc.rows[0].bonus_profit_cents, '0'); // Fully unlocked into cash!
console.log('[PASS] Qualifying deposit unlocked bonus profit! Cash balance = 165,000 cents ($1,650), bonus_profit_cents = 0.');

// --- TEST 5: Every journal entry sums to 0 ---
console.log('\n--- 5. Verify Every Journal Entry Sums to 0 ---');
const unbalancedJournals = await chkClient.query(`
  SELECT journal_id, SUM(amount_cents) AS total_sum
  FROM journal_entries
  GROUP BY journal_id
  HAVING SUM(amount_cents) <> 0;
`);
assert.equal(unbalancedJournals.rows.length, 0, 'Every journal must sum to exactly 0!');
console.log('[PASS] All journal entry groups sum to exactly 0 (0 unbalanced journals found).');

// --- TEST 6: Invariant View (0 Mismatch Rows) ---
console.log('\n--- 6. Invariant Reconciliation View ---');
const mismatchRows = await chkClient.query(`
  SELECT * FROM account_ledger_reconciliation
  WHERE cash_discrepancy <> 0
     OR reserved_discrepancy <> 0
     OR bonus_discrepancy <> 0
     OR bonus_reserved_discrepancy <> 0
     OR bonus_profit_discrepancy <> 0;
`);
console.log('Invariant Mismatch Count:', mismatchRows.rows.length);
assert.equal(mismatchRows.rows.length, 0, 'Invariant view must return 0 mismatch rows!');
console.log('[PASS] INVARIANT VERIFIED: 0 mismatch rows across all accounts and ledger buckets.');

chkClient.release();
await pool.end();
await ep.stop();
console.log('\n=== ALL BATCH 1 TESTS PASSED SUCCESSFULLY ===');
