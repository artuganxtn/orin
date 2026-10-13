process.env.NODE_ENV = 'test';
process.env.ALLOW_TEST_AUTH = 'true';
process.env.PGCLIENTENCODING = 'UTF-8';
process.env.ORIN_APP_PASSWORD = 'test_orin_password_2026';
process.env.KYC_HMAC_SECRET = 'a'.repeat(64);
process.env.KYC_FILES_KEY = 'b'.repeat(64);
process.env.ORIN_NOWPAYMENTS_IPN_SECRET = 'ipn_secret';
process.env.ORIN_NOWPAYMENTS_API_KEY = 'api_key';
process.env.ORIN_DEPOSITS_ENABLED = 'true';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import request from 'supertest';

const DB = 'orin_auth_gate';
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

const { runMigrations } = await import('./lib/migrate.js');
const migDir = path.resolve(process.cwd(), '../migrations');
const pre = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
for (const f of fs.readdirSync(migDir)) if (f < '013') fs.copyFileSync(path.join(migDir, f), path.join(pre, f));
await runMigrations(`postgres://postgres:password@127.0.0.1:5433/${DB}`, pre);

const { app } = await import('./lib/index.js');

const warns = [];
const origWarn = console.warn;
console.warn = (...a) => { warns.push(a.map(String).join(' ')); };

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
}
const tok = (uid, email, role, name, iatMs, verified = true) =>
  `test-token-${uid}:${email}:${role}:${name}:${iatMs}:${verified ? 'true' : 'false'}`;
const get = (p, token) => request(app).get(p).set('Authorization', `Bearer ${token}`);
const post = (p, token, body) => request(app).post(p).set('Authorization', `Bearer ${token}`).send(body);
const now = Date.now();

const adminTok = tok('usr-gate-admin', 'khtaub99@gmail.com', 'admin', 'Admin', now);
const userTok = tok('usr-gate-user', 'gate.user@example.com', 'user', 'User', now);

console.log('--- PHASE A: migration 013 NOT applied (column missing) ---');
for (const [label, tk] of [['admin', adminTok], ['user', userTok]]) {
  await t(`pre-013 ${label} GET /api/settings 200`, async () => assert.equal((await get('/api/settings', tk)).status, 200));
  await t(`pre-013 ${label} GET /api/lab 200`, async () => { const r = await get('/api/lab', tk); assert.ok(r.status < 400, 'status ' + r.status); });
  await t(`pre-013 ${label} POST /api/lab 200`, async () => assert.equal((await post('/api/lab', tk, { action: 'accept' })).status, 200));
}
await owner.query(`INSERT INTO profiles (id,email,display_name,role) VALUES ('usr-gate-legacy','legacy@example.com','Legacy','user') ON CONFLICT DO NOTHING`);

console.log('--- PHASE B: apply 013 ---');
await runMigrations(`postgres://postgres:password@127.0.0.1:5433/${DB}`, migDir);
const col = await owner.query(`SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='email_verified'`);
assert.equal(col.rowCount, 1);

for (const [label, tk] of [['admin', adminTok], ['user', userTok]]) {
  await t(`${label} GET /api/settings 200`, async () => assert.equal((await get('/api/settings', tk)).status, 200));
  await t(`${label} POST /api/lab 200`, async () => assert.equal((await post('/api/lab', tk, { action: 'accept' })).status, 200));
}
await t('admin settings isAdmin true', async () => assert.equal((await get('/api/settings', adminTok)).body.isAdmin, true));
await t('existing backfilled user (unverified token) 200', async () => {
  const r = await get('/api/settings', tok('usr-gate-legacy', 'legacy@example.com', 'user', 'Legacy', now, false));
  assert.equal(r.status, 200);
});
await t('new unverified signup 403 email_unverified', async () => {
  const r = await get('/api/settings', tok('usr-gate-new', 'new.signup@example.com', 'user', 'New', now, false));
  assert.equal(r.status, 403); assert.equal(r.body.code, 'email_unverified');
});

console.log('--- PHASE C: revocation ---');
const va = new Date(now + 5 * 60_000);
await owner.query(`INSERT INTO session_revocations (user_id,valid_after,updated_at) VALUES ('usr-gate-user',$1,NOW()) ON CONFLICT (user_id) DO UPDATE SET valid_after=$1`, [va]);
await t('token before revocation 401', async () => {
  const r = await get('/api/settings', tok('usr-gate-user', 'gate.user@example.com', 'user', 'User', va.getTime() - 60_000));
  assert.equal(r.status, 401);
});
await t('token after revocation 200', async () => {
  const r = await get('/api/settings', tok('usr-gate-user', 'gate.user@example.com', 'user', 'User', va.getTime() + 10_000));
  assert.equal(r.status, 200);
});

console.log('--- PHASE D: disabled / other ---');
await owner.query(`UPDATE profiles SET disabled=true WHERE id='usr-gate-legacy'`);
await t('disabled user 403', async () => {
  assert.equal((await get('/api/settings', tok('usr-gate-legacy', 'legacy@example.com', 'user', 'Legacy', now))).status, 403);
});
await t('no Authorization 401', async () => assert.equal((await request(app).get('/api/settings')).status, 401));
await t('no X-Orin-Session header accepted (200)', async () => assert.equal((await get('/api/settings', adminTok)).status, 200));

await t('DB failure -> 503 (not 401)', async () => {
  await owner.query(`REVOKE SELECT ON session_revocations FROM orin_app`);
  try {
    const r = await get('/api/settings', tok('usr-gate-admin', 'khtaub99@gmail.com', 'admin', 'Admin', now));
    assert.equal(r.status, 503);
  } finally { await owner.query(`GRANT SELECT ON session_revocations TO orin_app`); }
});

await t('logs: structured reasons, no token leaked', async () => {
  const joined = warns.join('\n');
  for (const r of ['session_revoked', 'email_unverified', 'account_disabled', 'no_bearer', 'db_error']) assert.ok(joined.includes(`"reason":"${r}"`), 'missing ' + r);
  assert.ok(!joined.includes('test-token-'), 'token leaked');
});

console.warn = origWarn;
console.log(`RESULT pass=${pass} fail=${fail}`);
await owner.end(); await admin.end();
try { await ep.stop(); } catch {}
process.exit(fail ? 1 : 0);

