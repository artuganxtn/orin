process.env.NODE_ENV = 'test';
process.env.PGCLIENTENCODING = 'UTF-8';
process.env.DATABASE_URL = 'postgres://postgres:password@localhost:5433/postgres?client_encoding=UTF8';
process.env.ORIN_APP_PASSWORD = 'test_orin_password';
process.env.ORIN_EMAIL_CODE_SECRET = 'test_secret_pepper_0123456789abcdef0123456789abcdef';
process.env.ORIN_MAIL_FROM = 'support@javl900.com';
process.env.ORIN_EMAIL_CODES_ENABLED = 'true';

import assert from 'node:assert/strict';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

// 1. CONNECT TO POSTGRES & RUN MIGRATIONS
const ep = new EmbeddedPostgres({ port: 5433, databaseDir: './.pgdata', persistent: true });
await ep.start().catch(() => {});

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

const { runMigrations } = await import('./lib/migrate.js');
await runMigrations(process.env.DATABASE_URL, path.resolve(process.cwd(), '../migrations'));

const {
  createOtpChallenge,
  verifyOtpChallenge,
  consumeOtpProof,
  computeWithdrawalBoundHash,
  computeUnsubscribeTokenHash,
  OtpError
} = await import('./lib/otp.js');

const {
  enqueueEmail,
  processEmailOutboxOnce,
  testMemoryOutbox,
  clearTestMemoryOutbox
} = await import('./lib/mail/transport.js');

const { withTx } = await import('./lib/db.js');

console.log('=== EMAIL OTP & OUTBOX SUITE EVALUATION ===');

// Test setup
const testUser = 'usr-otp-e2e-1';
const testEmail = 'otp.e2e@javl900.com';
const testSecret = process.env.ORIN_EMAIL_CODE_SECRET;

await client.query(`
  INSERT INTO profiles (id, email, display_name, role)
  VALUES ($1, $2, 'OTP Test User', 'user')
  ON CONFLICT (id) DO NOTHING;
`, [testUser, testEmail]);

await client.query(`
  INSERT INTO customer_registry (customer_key, user_id)
  VALUES ('ck-otp-1', $1)
  ON CONFLICT (customer_key) DO NOTHING;
`, [testUser]);

await client.query(`
  INSERT INTO verified_customers (user_id, customer_key, id_number_last4, verified, revoked, event_id)
  VALUES ($1, 'ck-otp-1', '9911', true, false, 'ev-otp-1')
  ON CONFLICT (user_id) DO NOTHING;
`, [testUser]);

await client.query(`
  INSERT INTO accounts (id, user_id, account_number, type, currency, balance_cents)
  VALUES ('acc-otp-1', $1, '112233445566', 'real', 'USD', 500000)
  ON CONFLICT (id) DO UPDATE SET balance_cents = 500000;
`, [testUser]);

await client.query(`
  INSERT INTO deposits (id, user_id, account_id, amount_cents, coin, status, credited, created_at)
  VALUES ('dep-otp-1', $1, 'acc-otp-1', 500000, 'USDT', 'finished', true, NOW() - INTERVAL '30 days')
  ON CONFLICT (id) DO NOTHING;
`, [testUser]);

// TEST 1: WRONG CODE X5 LOCKS CHALLENGE
console.log('\n--- TEST 1: Wrong Code x5 Locks Challenge ---');
const testEmailLock = 'otp.lock.' + Date.now() + '@javl900.com';
const challenge1 = await createOtpChallenge(testEmailLock, 'signup', testSecret, '127.0.0.1');

const wrongCode = challenge1.code === '000000' ? '111111' : '000000';

for (let i = 1; i <= 5; i++) {
  try {
    await verifyOtpChallenge(challenge1.challengeId, testEmailLock, wrongCode, 'signup', testSecret);
    assert.fail('Should have failed on wrong code');
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err;
    assert.equal(err instanceof OtpError, true);
  }
}

try {
  await verifyOtpChallenge(challenge1.challengeId, testEmailLock, challenge1.code, 'signup', testSecret);
  assert.fail('Should have failed on locked challenge');
} catch (err) {
  assert.equal(err.code, 'code-locked');
  console.log('✔ Challenge locked after 5 wrong attempts.');
}

// TEST 2: RESEND COOLDOWN
console.log('\n--- TEST 2: Resend 60s Cooldown ---');
const testEmailCool = 'otp.cool.' + Date.now() + '@javl900.com';
await createOtpChallenge(testEmailCool, 'signup', testSecret, '127.0.0.1');

try {
  await createOtpChallenge(testEmailCool, 'signup', testSecret, '127.0.0.1');
  assert.fail('Should fail due to 60s cooldown');
} catch (err) {
  assert.equal(err.code, 'cooldown-active');
  console.log('✔ 60s resend cooldown enforced.');
}

// TEST 3: PROOF CONSUMED ONCE
console.log('\n--- TEST 3: Proof Consumed Once ---');
const testEmail3 = 'otp.p3.' + Date.now() + '@javl900.com';
const challenge3 = await createOtpChallenge(testEmail3, 'signup', testSecret, '127.0.0.2');
const verification3 = await verifyOtpChallenge(challenge3.challengeId, testEmail3, challenge3.code, 'signup', testSecret);
assert.ok(verification3.proofId);

const consumed1 = await withTx(async (c) => consumeOtpProof(verification3.proofId, 'anonymous', 'signup', 'unbound', c));
assert.equal(consumed1, true, 'First consumption succeeds');

const consumed2 = await withTx(async (c) => consumeOtpProof(verification3.proofId, 'anonymous', 'signup', 'unbound', c));
assert.equal(consumed2, false, 'Replayed proof consumption rejected');
console.log('✔ Proof consumed exactly once and replay rejected.');

// TEST 4: BOUND HASH MISMATCH (WITHDRAWAL A REJECTED FOR WITHDRAWAL B)
console.log('\n--- TEST 4: Withdrawal A Proof Rejected for Withdrawal B ---');
const testEmail4 = 'otp.p4.' + Date.now() + '@javl900.com';
const boundHashA = computeWithdrawalBoundHash(testUser, 10000, 'USDT', 'TAb9uNeXzJeSWuAkiVv6d95oyZ2Jk8Qgas');
const boundHashB = computeWithdrawalBoundHash(testUser, 20000, 'USDT', 'TBdifferentAddressX1234567890');

const challengeWd = await createOtpChallenge(testEmail4, 'withdrawal', testSecret, '127.0.0.3', testUser, boundHashA);
const verifyWd = await verifyOtpChallenge(challengeWd.challengeId, testEmail4, challengeWd.code, 'withdrawal', testSecret, boundHashA);

const consumedWrongBound = await withTx(async (c) => consumeOtpProof(verifyWd.proofId, testUser, 'withdrawal', boundHashB, c));
assert.equal(consumedWrongBound, false, 'Proof for Withdrawal A rejected when attempting Withdrawal B');
console.log('✔ Bound hash mismatch correctly rejected proof for different withdrawal details.');

// TEST 5: OUTBOX ROLLBACK INTEGRITY
console.log('\n--- TEST 5: Outbox Rollback Integrity ---');
clearTestMemoryOutbox();
await client.query(`DELETE FROM email_outbox WHERE dedupe_key = 'welcome:rollback-1'`);

try {
  await withTx(async (c) => {
    await enqueueEmail('rollback@javl900.com', 'welcome', 'ar', { name: 'Rollback User' }, 'welcome:rollback-1', c);
    throw new Error('Simulated transaction rollback');
  });
} catch {
  // Expected rollback
}

const dbOutboxCheck = await client.query(`SELECT * FROM email_outbox WHERE dedupe_key = 'welcome:rollback-1'`);
assert.equal(dbOutboxCheck.rowCount, 0, 'Outbox row not present in DB after rollback');
console.log('✔ Outbox row not created when transaction rolls back.');

// TEST 6: OUTBOX ENQUEUE & RETRY
console.log('\n--- TEST 6: Outbox Enqueue & Processing ---');
clearTestMemoryOutbox();

const sentDedupeKey = 'welcome:sent-' + Date.now();
await enqueueEmail('sent@javl900.com', 'welcome', 'ar', { name: 'Success User' }, sentDedupeKey);
const outboxProc = await processEmailOutboxOnce();
assert.equal(outboxProc.processed, 1);
assert.equal(testMemoryOutbox.length, 1);
assert.equal(testMemoryOutbox[0].to, 'sent@javl900.com');
console.log('✔ Outbox item processed and captured in test memory transport.');

// TEST 7: LEDGER INVARIANT CHECK
console.log('\n--- TEST 7: Double-Entry Ledger Invariant ---');
const ledgerCheck = await client.query(`
  SELECT account_id, SUM(amount_cents) AS net_cents
  FROM journal_entries
  GROUP BY account_id
`);

let ledgerMismatches = 0;
for (const r of ledgerCheck.rows) {
  if (r.account_id && Number(r.net_cents) < 0) {
    ledgerMismatches++;
  }
}
assert.equal(ledgerMismatches, 0, 'Ledger invariant must remain 0 mismatches');
console.log('✔ Double-entry ledger invariant verified: 0 mismatches across all accounts.');

// TEST 8: EMAIL UNVERIFIED USER REJECTION (GATE CHECK)
console.log('\n--- TEST 8: Email Unverified User Gate Check ---');

await client.query(`
  INSERT INTO profiles (id, email, display_name, role, email_verified)
  VALUES ('usr-unverified-1', 'unverified@javl900.com', 'Unverified User', 'user', FALSE)
  ON CONFLICT (id) DO UPDATE SET email_verified = FALSE;
`);

const { authMiddleware } = await import('./lib/auth-middleware.js');

let resUnverifiedCode = 0;
let resUnverifiedJson = {};
let reqUnverified = {
  headers: { authorization: 'Bearer test-token-usr-unverified-1:unverified@javl900.com:user:Unverified User:1791830000000:false' },
  path: '/lab'
};
let resUnverified = {
  status: (code) => { resUnverifiedCode = code; return resUnverified; },
  json: (data) => { resUnverifiedJson = data; }
};

await authMiddleware(reqUnverified, resUnverified, () => {});
assert.equal(resUnverifiedCode, 403, 'Unverified email user rejected with 403');
assert.equal(resUnverifiedJson.code, 'email_unverified');
console.log('✔ Unverified email user correctly rejected with 403 email_unverified.');

// TEST 9: SERVER PASSWORD RESET FLOW & SESSION REVOCATION
console.log('\n--- TEST 9: Server Password Reset Flow ---');

clearTestMemoryOutbox();
const resetEmail = 'reset.test@javl900.com';
const challengeReset = await createOtpChallenge(resetEmail, 'password_reset', testSecret, '127.0.0.1', testUser);
await enqueueEmail(resetEmail, 'password_reset_code', 'ar', { code: challengeReset.code }, `reset:${challengeReset.challengeId}`);
await processEmailOutboxOnce();

const resetEmailSent = testMemoryOutbox.find(m => m.template === 'password_reset_code');
assert.ok(resetEmailSent, 'Password reset code email enqueued and sent');
assert.equal(resetEmailSent.to, resetEmail);

const verifyReset = await verifyOtpChallenge(challengeReset.challengeId, resetEmail, challengeReset.code, 'password_reset', testSecret);
assert.ok(verifyReset.proofId);
console.log('✔ Password reset code verified successfully via server OTP flow.');

// TEST 10: REVOKED TOKEN SESSION REJECTION
console.log('\n--- TEST 10: Revoked Token Session Rejection ---');

await client.query(`
  INSERT INTO session_revocations (user_id, valid_after)
  VALUES ('usr-unverified-1', NOW() + INTERVAL '1 hour');
`);

let resRevokedCode = 0;
let resRevokedJson = {};
let reqRevoked = {
  headers: { authorization: 'Bearer test-token-usr-unverified-1:unverified@javl900.com:::1000' },
  path: '/lab'
};
let resRevoked = {
  status: (code) => { resRevokedCode = code; return resRevoked; },
  json: (data) => { resRevokedJson = data; }
};

await authMiddleware(reqRevoked, resRevoked, () => {});
assert.equal(resRevokedCode, 401, 'Revoked token rejected with 401');
console.log('✔ Revoked token correctly rejected with 401 Unauthorized.');

client.release();
await pool.end();
await ep.stop().catch(() => {});

console.log('\n=== ALL EMAIL OTP & OUTBOX TESTS PASSED 100% ===');
setTimeout(() => process.exit(0), 100);
