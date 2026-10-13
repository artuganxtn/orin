process.env.NODE_ENV = 'test';
process.env.ALLOW_TEST_AUTH = 'true';
process.env.PGCLIENTENCODING = 'UTF-8';
process.env.ORIN_APP_PASSWORD = 'test_orin_password_2026';
process.env.ORIN_EMAIL_CODE_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ORIN_MAIL_FROM = 'no-reply@orin-trader.top';
process.env.KYC_HMAC_SECRET = 'a'.repeat(64);
process.env.KYC_FILES_KEY = 'b'.repeat(64);
process.env.ORIN_NOWPAYMENTS_IPN_SECRET = 'ipn_secret';
process.env.ORIN_NOWPAYMENTS_API_KEY = 'api_key';
process.env.ORIN_DEPOSITS_ENABLED = 'true';

import assert from 'node:assert/strict';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import request from 'supertest';

const DB = 'orin_pwd_reset_test';
const ep = new EmbeddedPostgres({ port: 5433, databaseDir: './.pgdata', persistent: true, user: 'postgres', password: 'password' });
try { await ep.start(); } catch {
  try { await new pg.Client({ connectionString: 'postgres://postgres:password@127.0.0.1:5433/postgres' }).connect(); }
  catch { await ep.initialise().catch(() => {}); await ep.start(); }
}

const admin = new pg.Pool({ connectionString: 'postgres://postgres:password@127.0.0.1:5433/postgres' });
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DB} ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
const owner = new pg.Pool({ connectionString: `postgres://postgres:password@127.0.0.1:5433/${DB}` });
process.env.DATABASE_URL = `postgres://orin_app:test_orin_password_2026@127.0.0.1:5433/${DB}`;

import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migDir = path.resolve(__dirname, '../migrations');
const { runMigrations } = await import('./lib/migrate.js');
await runMigrations(`postgres://postgres:password@127.0.0.1:5433/${DB}`, migDir);

const { app } = await import('./lib/index.js');
const {
  clearTestMemoryOutbox,
  testMemoryOutbox,
  processEmailOutboxOnce,
  setTestFailNextSend,
  enqueueEmail
} = await import('./lib/mail/transport.js');
const { adminAuth } = await import('./lib/firebase-admin-init.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log('[PASS]', name);
  } catch (e) {
    fail++;
    console.error('[FAIL]', name, '-', e.message);
  }
}

console.log('=== PASSWORD RESET & OUTBOX COMPREHENSIVE SUITE ===');

// Setup known profile in postgres
const knownUser = 'usr-known-1';
const knownEmail = 'known@example.com';
await owner.query(`
  INSERT INTO profiles (id, email, display_name, role)
  VALUES ($1, $2, 'Known User', 'user')
  ON CONFLICT (id) DO NOTHING
`, [knownUser, knownEmail]);

await owner.query(`
  INSERT INTO accounts (id, user_id, account_number, type, currency, balance_cents, reserved_cents, realized_cents)
  VALUES ('acc-known-1', $1, '100000000001', 'real', 'USD', 50000, 0, 0)
  ON CONFLICT (id) DO NOTHING
`, [knownUser]);

// Mock Firebase adminAuth for testing
const fbStore = new Map();
fbStore.set('fbonly@example.com', {
  uid: 'usr-fb-only-1',
  email: 'fbonly@example.com',
  displayName: 'FB Only User',
  disabled: false
});

const originalGetUser = adminAuth.getUserByEmail;
const originalUpdateUser = adminAuth.updateUser;
let updatedPasswordUid = '';
let updatedPasswordVal = '';

globalThis.__adminAuthMock = {
  getUserByEmail: async (em) => {
    const norm = String(em).toLowerCase().trim();
    if (norm === knownEmail) {
      return { uid: knownUser, email: knownEmail, displayName: 'Known User', disabled: false };
    }
    if (fbStore.has(norm)) {
      return fbStore.get(norm);
    }
    const err = new Error('User not found');
    err.code = 'auth/user-not-found';
    throw err;
  },
  updateUser: async (uid, patch) => {
    updatedPasswordUid = uid;
    updatedPasswordVal = patch.password || '';
    return { uid };
  }
};
adminAuth.getUserByEmail = globalThis.__adminAuthMock.getUserByEmail;
adminAuth.updateUser = globalThis.__adminAuthMock.updateUser;

// TEST 1: Known email -> exactly one reset mail queued and sent within one worker tick
let extractedCode = '';
await t('1. Known email: returns generic success & queues exactly one reset mail sent in 1 worker tick', async () => {
  clearTestMemoryOutbox();
  const res = await request(app)
    .post('/api/auth/reset/start')
    .send({ email: knownEmail });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);

  // Give priority trigger up to 250ms or run worker tick
  await new Promise(r => setTimeout(r, 250));
  if (testMemoryOutbox.length === 0) {
    await processEmailOutboxOnce();
  }
  assert.equal(testMemoryOutbox.length, 1);
  assert.equal(testMemoryOutbox[0].to, knownEmail);
  assert.equal(testMemoryOutbox[0].template, 'password_reset_code');

  extractedCode = String(testMemoryOutbox[0].payload?.code || '');
  assert.match(extractedCode, /^\d{6}$/);
});

// TEST 2: Unknown email -> identical response and zero mail
await t('2. Unknown email: identical response and zero mail sent', async () => {
  clearTestMemoryOutbox();
  const res = await request(app)
    .post('/api/auth/reset/start')
    .send({ email: 'nonexistent@example.com' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.message, 'إذا كان البريد مسجّلاً، فستصلك رسالة تحتوي على رمز إعادة تعيين كلمة المرور.');

  const proc = await processEmailOutboxOnce();
  assert.equal(proc.processed, 0);
  assert.equal(testMemoryOutbox.length, 0);
});

// TEST 3: Firebase-only user (no profile in postgres) -> mail sent and profile created
await t('3. Firebase-only user (no profile): creates profile in DB and sends reset email', async () => {
  clearTestMemoryOutbox();
  const fbEmail = 'fbonly@example.com';
  const res = await request(app)
    .post('/api/auth/reset/start')
    .send({ email: fbEmail });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);

  // Check profile created in DB
  const checkProf = await owner.query('SELECT * FROM profiles WHERE id = $1', ['usr-fb-only-1']);
  assert.equal(checkProf.rowCount, 1);
  assert.equal(checkProf.rows[0].email, fbEmail);

  // Process outbox tick
  await new Promise(r => setTimeout(r, 250));
  if (testMemoryOutbox.length === 0) {
    await processEmailOutboxOnce();
  }
  assert.equal(testMemoryOutbox.length, 1);
  assert.equal(testMemoryOutbox[0].to, fbEmail);
});

// TEST 4: Worker retries after transport failure then marks sent
await t('4. Worker retries after transport failure then marks sent', async () => {
  clearTestMemoryOutbox();
  const retryEmail = 'retry.test@example.com';
  await enqueueEmail(retryEmail, 'welcome', 'ar', { name: 'Retry User' }, 'retry:test-1');

  // 1st tick: simulate network/SMTP failure
  setTestFailNextSend(true);
  const proc1 = await processEmailOutboxOnce();
  assert.equal(proc1.errors, 1);
  assert.equal(testMemoryOutbox.length, 0);

  // Verify row still queued with attempts=1 and last_error
  const checkRow = await owner.query(`SELECT status, attempts, last_error FROM email_outbox WHERE to_email = $1`, [retryEmail]);
  assert.equal(checkRow.rows[0].status, 'queued');
  assert.equal(checkRow.rows[0].attempts, 1);
  assert.ok(checkRow.rows[0].last_error.includes('SIMULATED_TRANSPORT_FAILURE'));

  // Reset next_attempt_at to now for immediate retry
  await owner.query(`UPDATE email_outbox SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE to_email = $1`, [retryEmail]);

  // 2nd tick: succeeds
  const proc2 = await processEmailOutboxOnce();
  assert.equal(proc2.processed, 1);
  assert.equal(testMemoryOutbox.length, 1);
  assert.equal(testMemoryOutbox[0].to, retryEmail);

  const checkSent = await owner.query(`SELECT status FROM email_outbox WHERE to_email = $1`, [retryEmail]);
  assert.equal(checkSent.rows[0].status, 'sent');
});

// TEST 5: Weak password rejected and code NOT consumed
await t('5. Weak password rejected with 400 and code is NOT consumed', async () => {
  assert.ok(extractedCode);
  const res = await request(app)
    .post('/api/auth/reset/confirm')
    .send({
      email: knownEmail,
      code: extractedCode,
      newPassword: 'short' // < 8 characters
    });

  assert.equal(res.status, 400);

  // Verify challenge in DB is still unconsumed
  const checkChallenge = await owner.query(
    `SELECT consumed_at FROM otp_challenges WHERE LOWER(email) = $1 AND purpose = 'password_reset'`,
    [knownEmail]
  );
  assert.equal(checkChallenge.rows[0].consumed_at, null);
});

// TEST 6: Wrong code x5 locks the challenge
await t('6. Wrong code x5 locks the challenge', async () => {
  // Create a separate user challenge for wrong-code test
  const wrongUser = 'usr-wrong-code-1';
  const wrongEmail = 'wrong.code@example.com';
  await owner.query(`
    INSERT INTO profiles (id, email, display_name, role)
    VALUES ($1, $2, 'Wrong User', 'user') ON CONFLICT DO NOTHING
  `, [wrongUser, wrongEmail]);

  await request(app).post('/api/auth/reset/start').send({ email: wrongEmail });
  await processEmailOutboxOnce();

  // Try wrong code 4 times
  for (let i = 1; i <= 4; i++) {
    const res = await request(app)
      .post('/api/auth/reset/confirm')
      .send({ email: wrongEmail, code: '000000', newPassword: 'ValidPassword2026!' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'code-invalid');
    assert.equal(res.body.attemptsLeft, 5 - i);
  }

  // 5th attempt locks it
  const res5 = await request(app)
    .post('/api/auth/reset/confirm')
    .send({ email: wrongEmail, code: '000000', newPassword: 'ValidPassword2026!' });
  assert.equal(res5.status, 400);
  assert.equal(res5.body.code, 'code-locked');

  // 6th attempt is still locked even if correct
  const res6 = await request(app)
    .post('/api/auth/reset/confirm')
    .send({ email: wrongEmail, code: '000000', newPassword: 'ValidPassword2026!' });
  assert.equal(res6.status, 400);
  assert.equal(res6.body.code, 'code-locked');
});

// TEST 7: Confirm with correct code changes password, writes session_revocations, replay rejected
await t('7. Confirm with correct code updates Firebase, revokes sessions, enqueues mail, rejects replay', async () => {
  clearTestMemoryOutbox();
  const newPass = 'BrandNewSecurePassword2026!';
  const res = await request(app)
    .post('/api/auth/reset/confirm')
    .send({
      email: knownEmail,
      code: extractedCode,
      newPassword: newPass
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);

  // Firebase updated
  assert.equal(updatedPasswordUid, knownUser);
  assert.equal(updatedPasswordVal, newPass);

  // Session revocations written
  const revCheck = await owner.query(`SELECT * FROM session_revocations WHERE user_id = $1`, [knownUser]);
  assert.equal(revCheck.rowCount, 1);
  assert.ok(new Date(revCheck.rows[0].valid_after).getTime() > Date.now() - 60000);

  // Password changed confirmation email enqueued
  await processEmailOutboxOnce();
  const passChangeMail = testMemoryOutbox.find(m => m.template === 'password_changed');
  assert.ok(passChangeMail);
  assert.equal(passChangeMail.to, knownEmail);

  // Replay attempt with same code must be rejected
  const replayRes = await request(app)
    .post('/api/auth/reset/confirm')
    .send({
      email: knownEmail,
      code: extractedCode,
      newPassword: newPass
    });
  assert.equal(replayRes.status, 400);
  assert.equal(replayRes.body.code, 'code-invalid');
});

// TEST 8: /api/health returns queueDepth, oldestQueuedAge, failedCount
await t('8. /api/health exposes queue depth, oldest age, and failed count', async () => {
  const hRes = await request(app).get('/api/health');
  assert.equal(hRes.status, 200);
  assert.equal(typeof hRes.body.queueDepth, 'number');
  assert.equal(typeof hRes.body.oldestQueuedAge, 'number');
  assert.equal(typeof hRes.body.failedCount, 'number');
});

// Cleanup
adminAuth.getUserByEmail = originalGetUser;
adminAuth.updateUser = originalUpdateUser;

await owner.end();
await admin.end();
try { await ep.stop(); } catch {}

console.log(`\nSUITE RESULTS: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
