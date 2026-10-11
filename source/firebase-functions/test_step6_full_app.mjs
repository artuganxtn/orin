import request from 'supertest';
import assert from 'node:assert/strict';
import EmbeddedPostgres from 'embedded-postgres';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://postgres:password@localhost:5433/postgres';

// Start embedded Postgres on port 5433
const ep = new EmbeddedPostgres({
  port: 5433,
  databaseDir: './.pgdata',
  persistent: true
});
await ep.start().catch(() => {});

// Import express app
const { app } = await import('./lib/index.js');

console.log('=== STEP 6: VERIFYING WEB HOME APP & BACKEND APIS ===');

// 1. Load /
const htmlRes = await request(app).get('/');
assert.equal(htmlRes.status, 200);
assert.match(htmlRes.text, /<!DOCTYPE html>/i);
assert.match(htmlRes.text, /assets\/index-[a-zA-Z0-9_-]+\.js/);
console.log('✔ GET / returned 200 index.html referencing new Vite entry chunk index-*.js');

const runId = Date.now().toString(36);
const uid = 'usr-step6-' + runId;
const testToken = `test-token-${uid}:${uid}@orin.test:user:Step6User`;

// 2. Test GET /api/settings
const settingsRes = await request(app)
  .get('/api/settings')
  .set('Authorization', `Bearer ${testToken}`);

assert.equal(settingsRes.status, 200);
assert.equal(typeof settingsRes.body.configuration, 'object');
assert.equal(typeof settingsRes.body.preferences, 'object');
assert.equal(typeof settingsRes.body.profile, 'object');
console.log('✔ GET /api/settings returned 200:', JSON.stringify({
  email: settingsRes.body.email,
  clientId: settingsRes.body.clientId,
  isAdmin: settingsRes.body.isAdmin,
  profile: settingsRes.body.profile
}));

// 3. Test GET /api/trading-accounts
const accountsRes = await request(app)
  .get('/api/trading-accounts')
  .set('Authorization', `Bearer ${testToken}`);

assert.equal(accountsRes.status, 200);
assert.ok(Array.isArray(accountsRes.body.accounts));
assert.ok(typeof accountsRes.body.activeId === 'string');
console.log('✔ GET /api/trading-accounts returned 200:', JSON.stringify(accountsRes.body));

// 4. Test GET /api/payments/deposits
const depositsRes = await request(app)
  .get(`/api/payments/deposits?accountId=${accountsRes.body.activeId}`)
  .set('Authorization', `Bearer ${testToken}`);

assert.equal(depositsRes.status, 200);
assert.ok(Array.isArray(depositsRes.body.items));
console.log('✔ GET /api/payments/deposits returned 200:', JSON.stringify(depositsRes.body));

// 5. Test GET /api/withdrawals
const withdrawalsRes = await request(app)
  .get('/api/withdrawals')
  .set('Authorization', `Bearer ${testToken}`);

assert.equal(withdrawalsRes.status, 200);
assert.ok(Array.isArray(withdrawalsRes.body.items));
console.log('✔ GET /api/withdrawals returned 200:', JSON.stringify(withdrawalsRes.body));

// 6. Test GET /api/notifications
const notificationsRes = await request(app)
  .get('/api/notifications')
  .set('Authorization', `Bearer ${testToken}`);

assert.equal(notificationsRes.status, 200);
assert.ok(Array.isArray(notificationsRes.body.items));
console.log('✔ GET /api/notifications returned 200:', JSON.stringify({
  unread: notificationsRes.body.unread,
  itemsCount: notificationsRes.body.items.length
}));

console.log('\n=== ALL STEP 6 TESTS PASSED SUCCESSFULLY ===');
process.exit(0);
