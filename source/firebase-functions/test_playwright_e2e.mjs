import assert from 'node:assert/strict';
import mkdirp from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import request from 'supertest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

process.env.NODE_ENV = 'test';
process.env.PGCLIENTENCODING = 'UTF-8';
process.env.DATABASE_URL = 'postgres://postgres:password@localhost:5433/postgres?client_encoding=UTF8';

// 1. Start embedded Postgres
const ep = new EmbeddedPostgres({
  port: 5433,
  databaseDir: './.pgdata',
  persistent: true
});
await ep.start().catch(() => {});

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
await client.query("UPDATE pg_database SET encoding = pg_char_to_encoding('UTF8') WHERE datname = 'postgres'").catch(() => {});
await client.query("SET client_encoding TO 'UTF8'");

// Import express app
const { app } = await import('./lib/index.js');

const PORT = 10000;
const server = app.listen(PORT, '127.0.0.1');

console.log('=== PLAYWRIGHT E2E & HTTP SHAPE TESTS ===');

// Directory outside source for screenshots
const screenshotDir = path.resolve(process.cwd(), '../../playwright-screenshots');
if (!mkdirp.existsSync(screenshotDir)) {
  mkdirp.mkdirSync(screenshotDir, { recursive: true });
}

// ----------------------------------------------------
// 1. RECREATE HTTP SHAPE TESTS
// ----------------------------------------------------
console.log('\n--- 1. Testing HTTP Endpoint Shapes ---');

const testUid = 'usr-e2e-' + Date.now().toString(36);
const testToken = `test-token-${testUid}:${testUid}@orin.test:user:E2EUser:${Date.now()}`;
const adminUid = 'usr-admin-' + Date.now().toString(36);
const adminToken = `test-token-${adminUid}:${adminUid}@orin.test:admin:E2EAdmin:${Date.now()}`;

// Seed test user and verified customer for admin/test
await client.query(`
  INSERT INTO profiles (id, email, display_name, role)
  VALUES ($1, $2, 'E2E User', 'user')
  ON CONFLICT (id) DO NOTHING;
`, [testUid, `${testUid}@orin.test`]);

await client.query(`
  INSERT INTO profiles (id, email, display_name, role)
  VALUES ($1, $2, 'E2E Admin', 'admin')
  ON CONFLICT (id) DO UPDATE SET role = 'admin';
`, [adminUid, `${adminUid}@orin.test`]);

await client.query(`
  INSERT INTO customer_registry (customer_key, user_id)
  VALUES ('ck-' || $1, $1) ON CONFLICT DO NOTHING;
`, [testUid]);

await client.query(`
  INSERT INTO verified_customers (user_id, customer_key, id_number_last4, verified, revoked, event_id)
  VALUES ($1::varchar, 'ck-' || $1::varchar, '9514', true, false, 'ev-1') ON CONFLICT DO NOTHING;
`, [testUid]);

// Test /api/settings shape
const settingsRes = await request(app)
  .get('/api/settings')
  .set('Authorization', `Bearer ${testToken}`);
assert.equal(settingsRes.status, 200);
assert.equal(typeof settingsRes.body.preferences, 'object');
assert.equal(typeof settingsRes.body.profile, 'object');
assert.equal(typeof settingsRes.body.capabilities, 'object');
assert.equal(settingsRes.body.capabilities.kyc, true);
assert.equal(settingsRes.body.capabilities.deposits, true);
assert.equal(settingsRes.body.capabilities.withdrawals, true);
assert.equal(settingsRes.body.capabilities.transfer, true);
assert.equal(settingsRes.body.capabilities.referrals, true);
console.log('✔ GET /api/settings returned valid shape with true capabilities for kyc, deposits, withdrawals, transfer, referrals');

// Test /api/trading-accounts shape
const accountsRes = await request(app)
  .get('/api/trading-accounts')
  .set('Authorization', `Bearer ${testToken}`);
assert.equal(accountsRes.status, 200);
assert.ok(Array.isArray(accountsRes.body.accounts));
assert.ok(typeof accountsRes.body.activeId === 'string');
console.log('✔ GET /api/trading-accounts returned valid directory shape');

// Test /api/lab (GET) shape
const labRes = await request(app)
  .get('/api/lab')
  .set('Authorization', `Bearer ${testToken}`);
assert.equal(labRes.status, 200);
assert.ok(Array.isArray(labRes.body.contracts));
assert.ok(Array.isArray(labRes.body.positions));
console.log('✔ GET /api/lab returned valid LabState shape');

// Test /api/payments/deposits shape
const depositsRes = await request(app)
  .get(`/api/payments/deposits?accountId=${accountsRes.body.activeId}`)
  .set('Authorization', `Bearer ${testToken}`);
assert.equal(depositsRes.status, 200);
assert.ok(Array.isArray(depositsRes.body.items));
console.log('✔ GET /api/payments/deposits returned valid DepositView array shape');

// Test /api/kyc shape
const kycRes = await request(app)
  .get('/api/kyc')
  .set('Authorization', `Bearer ${testToken}`);
assert.equal(kycRes.status, 200);
assert.equal(kycRes.body.status, 'verified');
assert.equal(typeof kycRes.body.request, 'object');
console.log('✔ GET /api/kyc returned valid KycData shape');

// Test /api/referrals shape
const refRes = await request(app)
  .get('/api/referrals')
  .set('Authorization', `Bearer ${testToken}`);
assert.equal(refRes.status, 200);
assert.ok(typeof refRes.body.code === 'string');
assert.ok(Array.isArray(refRes.body.rewards));
assert.ok(Array.isArray(refRes.body.referrals));
console.log('✔ GET /api/referrals returned valid ReferralSummary shape with arrays defaulting to []');

// Test /api/programs shape
const progRes = await request(app)
  .get('/api/programs')
  .set('Authorization', `Bearer ${testToken}`);
assert.equal(progRes.status, 200);
assert.equal(progRes.body.available, true);
console.log('✔ GET /api/programs returned valid ProgramSummary shape');

// ----------------------------------------------------
// 2. PLAYWRIGHT E2E BROWSER RENDERING & SCREENSHOTS
// ----------------------------------------------------
console.log('\n--- 2. Playwright E2E Browser Page Rendering ---');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') {
    console.log('Browser console error:', msg.text());
    consoleErrors.push(msg.text());
  }
});
page.on('pageerror', err => {
  console.log('Browser page error:', err.message);
  consoleErrors.push(err.message);
});

// Set mock auth header and tokens in local storage
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.evaluate((tok) => {
  localStorage.setItem('orin-preferences-v2', JSON.stringify({ chartLocale: 'ar', theme: 'light' }));
}, testToken);

const pagesToTest = [
  { name: 'home', path: '/', selector: 'body' },
  { name: 'deposit', path: '/deposit', selector: 'body' },
  { name: 'withdraw', path: '/withdraw', selector: 'body' },
  { name: 'kyc', path: '/settings/kyc', selector: 'body' },
  { name: 'referrals', path: '/referral', selector: 'body' },
  { name: 'support', path: '/support', selector: 'body' },
  { name: 'settings', path: '/settings', selector: 'body' }
];

const savedScreenshots = [];

for (const p of pagesToTest) {
  console.log(`Rendering page: ${p.name} (${p.path})...`);
  await page.goto(`http://127.0.0.1:${PORT}${p.path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const shotPath = path.join(screenshotDir, `${p.name}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });
  savedScreenshots.push(shotPath);
  console.log(`✔ Saved screenshot: ${shotPath}`);
}

await browser.close();
server.close();
client.release();
await pool.end();

// Fail if any console errors occurred
assert.equal(consoleErrors.length, 0, `Expected 0 console errors, found ${consoleErrors.length}`);
console.log('✔ Zero console errors during Playwright browser rendering across all pages!');

console.log('\nSaved Screenshots List:');
savedScreenshots.forEach(s => console.log('  -', s));

console.log('\n=== ALL PLAYWRIGHT E2E & HTTP SHAPE TESTS PASSED SUCCESSFULLY ===');
process.exit(0);
