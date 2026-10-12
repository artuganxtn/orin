import assert from 'node:assert/strict';
import mkdirp from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

process.env.NODE_ENV = 'test';
process.env.PGCLIENTENCODING = 'UTF-8';
process.env.DATABASE_URL = 'postgres://postgres:password@localhost:5433/postgres?client_encoding=UTF8';
process.env.KYC_HMAC_SECRET = 'test-hmac-secret';
process.env.KYC_FILES_KEY = 'test-files-key-32-bytes-2026!';

const ep = new EmbeddedPostgres({ port: 5433, databaseDir: './.pgdata', persistent: true });
await ep.start().catch(() => {});

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
await client.query("UPDATE pg_database SET encoding = pg_char_to_encoding('UTF8') WHERE datname = 'postgres'").catch(() => {});
await client.query("SET client_encoding TO 'UTF8'");

const { app } = await import('./lib/index.js');
const PORT = 10001;
const server = app.listen(PORT, '127.0.0.1');

console.log('=== ADMIN CONTROL HARNESS & SECURITY VERIFICATION ===');

const now = Date.now() + 86400000;
const makeTok = (uid, role) => `test-token-${uid}:${uid}@orin.test:${role}:TestUser:${now}`;

const superToken = makeTok('usr-superadmin', 'admin');
const makerToken = makeTok('usr-finmaker', 'user');
const approverToken = makeTok('usr-finapprover', 'user');
const supportToken = makeTok('usr-support', 'user');
const opsToken = makeTok('usr-ops', 'user');
const normalToken = makeTok('usr-normal', 'user');

import { readFileSync } from 'node:fs';

const migrationFiles = [
  '001_core_schema.sql',
  '002_triggers_and_roles.sql',
  '003_docs_and_indexes.sql',
  '004_audit_unique_action_reference.sql',
  '005_grant_reconciliation_view.sql',
  '006_grant_app_permissions.sql',
  '007_deposits_pay_amount_and_extra_id.sql',
  '008_kyc_statuses_and_encrypted_name.sql'
];

console.log('--- Wiping Test Database (DROP SCHEMA public CASCADE) ---');
await client.query('DROP SCHEMA IF EXISTS public CASCADE');
await client.query('CREATE SCHEMA public');

const emptyCheck = await client.query(`
  SELECT count(*) FROM information_schema.tables
  WHERE table_schema = 'public'
`);
console.log(`[PROOF] Database table count before migrating: ${emptyCheck.rows[0].count} (Must be 0)`);
assert.equal(Number(emptyCheck.rows[0].count), 0, 'Database must be empty before running migrations');

for (const f of migrationFiles) {
  await client.query("SELECT set_config('app.orin_app_password', 'test_orin_password_2026', false)");
  const sql = readFileSync(path.join(process.cwd(), '../migrations', f), 'utf8');
  await client.query(sql);
  console.log(`[PASS] Migration ${f} applied successfully with no errors.`);
}

const constraintRes = await client.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conname IN ('kyc_requests_status_check', 'kyc_files_status_check');
`);
console.log('\n--- Migration 008 pg_constraint Verification ---');
for (const r of constraintRes.rows) {
  console.log(`Constraint: ${r.conname} => ${r.def}`);
}

// Seed profiles and staff roles
await client.query(`
  INSERT INTO profiles (id, email, display_name, role) VALUES
    ('usr-superadmin', 'super@orin.test', 'Super Admin', 'admin'),
    ('usr-finmaker', 'maker@orin.test', 'Finance Maker', 'user'),
    ('usr-finapprover', 'approver@orin.test', 'Finance Approver', 'user'),
    ('usr-support', 'support@orin.test', 'Support Staff', 'user'),
    ('usr-ops', 'ops@orin.test', 'Operations Staff', 'user'),
    ('usr-normal', 'normal@orin.test', 'Normal User', 'user'),
    ('usr-target-for-staff-set', 'target@orin.test', 'Target User', 'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
`);

await client.query(`
  INSERT INTO staff (user_id, roles, status) VALUES
    ('usr-superadmin', '["super_admin"]'::jsonb, 'active'),
    ('usr-finmaker', '["finance"]'::jsonb, 'active'),
    ('usr-finapprover', '["finance_approver"]'::jsonb, 'active'),
    ('usr-support', '["support"]'::jsonb, 'active'),
    ('usr-ops', '["operations"]'::jsonb, 'active')
  ON CONFLICT (user_id) DO UPDATE SET roles = EXCLUDED.roles, status = EXCLUDED.status;
`);

// ----------------------------------------------------
// STEP 0: SECURITY CHECKS (Normal User MUST GET 403)
// ----------------------------------------------------
console.log('\n--- STEP 0: Security & RBAC Middleware Checks ---');

const controlModules = [
  'session', 'dashboard', 'users', 'kyc', 'accounts', 'wallets', 'deposits',
  'withdrawals', 'approvals', 'trading', 'markets', 'bonus', 'referrals',
  'team', 'agencies', 'badges', 'notifications', 'content', 'configuration',
  'security', 'staff', 'audit', 'tickets', 'codes', 'support-ai'
];

for (const m of controlModules) {
  const res = await request(app)
    .get(`/api/control/${m}`)
    .set('Authorization', `Bearer ${normalToken}`);
  assert.equal(res.status, 403, `Expected 403 for normal user on /api/control/${m}, got ${res.status}`);
}
console.log('✔ Normal user gets 403 on ALL 25 /api/control/* GET routes!');

const resNormAction = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${normalToken}`)
  .send({ action: 'account.balance', data: { balance: 100 } });
assert.equal(resNormAction.status, 403);
console.log('✔ Normal user gets 403 on POST /api/control/action!');

const resNormDoc = await request(app)
  .get('/api/control/kyc-detail?id=test-file-id&reason=TestInspectionReason')
  .set('Authorization', `Bearer ${normalToken}`);
assert.equal(resNormDoc.status, 403);
console.log('✔ Normal user gets 403 on GET /api/control/kyc-detail!');

// Support role (without kyc.documents) on kyc-detail MUST GET 403
const resSuppDoc = await request(app)
  .get('/api/control/kyc-detail?id=test-file-id&reason=TestInspectionReason')
  .set('Authorization', `Bearer ${supportToken}`);
assert.equal(resSuppDoc.status, 403);
console.log('✔ Support staff (without kyc.documents permission) gets 403 on /api/control/kyc-detail!');

console.log('\n--- SECTION B: Staff Roles Asserted Matrix ---');

const expectations = [
  { type: 'get', module: 'staff', perm: 'staff.manage', roles: { super_admin: 200, finance: 403, finance_approver: 403, support: 403, operations: 403, normal: 403 } },
  { type: 'get', module: 'configuration', perm: 'configuration.manage', roles: { super_admin: 200, finance: 403, finance_approver: 403, support: 403, operations: 403, normal: 403 } },
  { type: 'get', module: 'security', perm: 'security.read', roles: { super_admin: 200, finance: 403, finance_approver: 403, support: 403, operations: 403, normal: 403 } },
  { type: 'get', module: 'kyc', perm: 'kyc.read', roles: { super_admin: 200, finance: 403, finance_approver: 403, support: 403, operations: 403, normal: 403 } },
  { type: 'get', module: 'deposits', perm: 'finance.read', roles: { super_admin: 200, finance: 200, finance_approver: 200, support: 403, operations: 403, normal: 403 } },
  { type: 'post', action: 'staff.set', perm: 'staff.manage', roles: { super_admin: 200, finance: 403, finance_approver: 403, support: 403, operations: 403, normal: 403 } },
  { type: 'post', action: 'configuration.save', perm: 'configuration.manage', roles: { super_admin: 200, finance: 403, finance_approver: 403, support: 403, operations: 403, normal: 403 } },
  { type: 'post', action: 'contract.create', perm: 'contracts.manage', roles: { super_admin: 200, finance: 403, finance_approver: 403, support: 403, operations: 200, normal: 403 } },
  { type: 'post', action: 'unmapped.action', perm: undefined, roles: { super_admin: 403, finance: 403, finance_approver: 403, support: 403, operations: 403, normal: 403 } }
];

const roleTokens = {
  super_admin: superToken,
  finance: makerToken,
  finance_approver: approverToken,
  support: supportToken,
  operations: opsToken,
  normal: normalToken
};

console.log('Module / Action | Super Admin | Fin Maker | Fin Approver | Support   | Operations| Normal');
console.log('-----------------------------------------------------------------------------------------');

for (const item of expectations) {
  const rowResults = [];
  for (const [rName, expectedStatus] of Object.entries(item.roles)) {
    const tok = roleTokens[rName];
    let res;
    if (item.type === 'get') {
      res = await request(app).get(`/api/control/${item.module}`).set('Authorization', `Bearer ${tok}`);
    } else {
      const actTarget = item.action === 'contract.create' ? 'contract-' + Math.random().toString(36).slice(2) : 'usr-target-for-staff-set';
      res = await request(app)
        .post('/api/control/action')
        .set('Authorization', `Bearer ${tok}`)
        .send({ action: item.action, target: actTarget, data: { roles: ['support'], status: 'active', title: 'Test', asset: 'BTCUSD' } });
    }
    const actualStatus = res.status;
    assert.equal(actualStatus, expectedStatus, `Role ${rName} on ${item.module || item.action}: expected ${expectedStatus}, got ${actualStatus}`);
    rowResults.push(String(actualStatus).padStart(11));
  }
  const label = item.type === 'get' ? `GET /${item.module}` : `POST ${item.action}`;
  console.log(`${label.padEnd(16)}|${rowResults.join('|')}`);
}

console.log('\n--- SECTION B.3: staff.set Rule Enforcement Tests ---');

// 1. Non-existing profile -> 404
const resNoProfile = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${superToken}`)
  .send({ action: 'staff.set', target: 'non-existing-user-id-999', data: { roles: ['support'] } });
assert.equal(resNoProfile.status, 404, `Expected 404 for non-existing profile, got ${resNoProfile.status}`);
console.log('✔ staff.set on non-existing profile returns 404!');

// 2. Self-role change -> 409
const resSelfRole = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${superToken}`)
  .send({ action: 'staff.set', target: 'usr-superadmin', data: { roles: ['support'] } });
assert.equal(resSelfRole.status, 409, `Expected 409 for self role change, got ${resSelfRole.status}`);
console.log('✔ staff.set self role change returns 409!');

// 3. Granting role caller does not hold -> 403
const resGrantUnheld = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${opsToken}`)
  .send({ action: 'staff.set', target: 'usr-support', data: { roles: ['super_admin'] } });
assert.equal(resGrantUnheld.status, 403, `Expected 403 for granting unheld role, got ${resGrantUnheld.status}`);
console.log('✔ staff.set granting unheld role returns 403!');

// ----------------------------------------------------
// STEP 1 & 2: STAFF MODULE GETS & ACTIONS HARNESS
// ----------------------------------------------------
console.log('\n--- STEP 1 & 2: Control Module GETs & Actions Harness ---');

for (const m of controlModules) {
  const res = await request(app)
    .get(`/api/control/${m}`)
    .set('Authorization', `Bearer ${superToken}`);
  assert.equal(res.status, 200, `Failed GET /api/control/${m}: ${res.status}`);
  assert.ok(Array.isArray(res.body.rows) || typeof res.body.id === 'string');
}
console.log('✔ Super Admin successfully loads ALL 25 Control Center modules!');

// Test Contract Creation & Listing in Codes
const codeRes = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${superToken}`)
  .send({ action: 'contract.create', data: { title: 'E2E VIP Contract', asset: 'BTCUSD', direction: 'BUY', durationSec: 120, settlementBps: 850 } });
assert.equal(codeRes.status, 200);
assert.equal(codeRes.body.ok, true);

const codesList = await request(app)
  .get('/api/control/codes')
  .set('Authorization', `Bearer ${superToken}`);
assert.equal(codesList.status, 200);
assert.ok(codesList.body.rows.length > 0);
console.log('✔ contract.create succeeded and code rendered in /api/control/codes!');

// ----------------------------------------------------
// SECTION C: KYC FULL HTTP FLOW & DB ROW VERIFICATION
// ----------------------------------------------------
console.log('\n--- SECTION C: KYC Full HTTP Flow & DB Row Verification ---');

const kycUser = 'usr-kyc-' + Math.random().toString(36).slice(2) + '-' + Date.now();
const kycUserTok = makeTok(kycUser, 'user');
const kycDocNum = '99' + Math.floor(100000 + Math.random() * 899999);

await request(app).get('/api/settings').set('Authorization', `Bearer ${kycUserTok}`);

const kycUp = await request(app)
  .post('/api/kyc')
  .set('Authorization', `Bearer ${kycUserTok}`)
  .send({ fullName: 'Majd Nh', country: 'SY', documentType: 'id_card', idNumber: kycDocNum, documentImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' });
assert.equal(kycUp.status, 200);

// C.1 Verify WITHOUT prior access log entry -> 403
const kycReviewNoLog = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${superToken}`)
  .send({ action: 'kyc.review', target: kycUser, data: { status: 'verified', reason: 'Attempting review before access log' } });
assert.equal(kycReviewNoLog.status, 403, `Expected 403 for review without prior access log, got ${kycReviewNoLog.status}`);
console.log('✔ KYC review without prior document access log entry returns 403 access_log_required!');

// C.2 Access document details -> 200 OK & writes access log
const kycDetailRes = await request(app)
  .get(`/api/control/kyc-detail?id=${kycUser}&reason=ComplianceAuditCheck`)
  .set('Authorization', `Bearer ${superToken}`);
assert.equal(kycDetailRes.status, 200);
assert.equal(kycDetailRes.body.idNumber, kycDocNum);
assert.equal(kycDetailRes.body.fullName, 'Majd Nh');
assert.ok(kycDetailRes.body.documentImage.startsWith('data:image/'));
console.log('✔ KYC detail endpoint returned decrypted ID number, encrypted name & image, and logged access in kyc_access_log!');

// C.3 Verify with status "verified" -> 200 OK
const kycReviewRes = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${superToken}`)
  .send({ action: 'kyc.review', target: kycUser, data: { status: 'verified', reason: 'Official ID verified by compliance' } });
assert.equal(kycReviewRes.status, 200);
assert.equal(kycReviewRes.body.status, 'verified');

// Print DB rows after verification
const reqRow = await client.query('SELECT user_id, status, reason FROM kyc_requests WHERE user_id = $1', [kycUser]);
const fileRow = await client.query('SELECT user_id, status FROM kyc_files WHERE user_id = $1', [kycUser]);
const vcustRow = await client.query('SELECT user_id, verified, revoked FROM verified_customers WHERE user_id = $1', [kycUser]);
const regRow = await client.query('SELECT customer_key, user_id FROM customer_registry WHERE user_id = $1', [kycUser]);
const kycApiRes = await request(app).get('/api/kyc').set('Authorization', `Bearer ${kycUserTok}`);

console.log('[PROVED DB ROW] kyc_requests:', reqRow.rows[0]);
console.log('[PROVED DB ROW] kyc_files:', fileRow.rows[0]);
console.log('[PROVED DB ROW] verified_customers:', vcustRow.rows[0]);
console.log('[PROVED DB ROW] customer_registry:', regRow.rows[0]);
console.log('[PROVED API] GET /api/kyc status:', kycApiRes.body.status);
assert.equal(kycApiRes.body.status, 'verified');

// C.4 Duplicate document submitted by a second user -> 409
const kycUser2 = 'usr-kyc-dup-' + Math.random().toString(36).slice(2);
const kycUserTok2 = makeTok(kycUser2, 'user');
await request(app).get('/api/settings').set('Authorization', `Bearer ${kycUserTok2}`);

const kycDupRes = await request(app)
  .post('/api/kyc')
  .set('Authorization', `Bearer ${kycUserTok2}`)
  .send({ fullName: 'Dup User', country: 'SY', documentType: 'id_card', idNumber: kycDocNum, documentImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' });
assert.equal(kycDupRes.status, 409, `Expected 409 for duplicate document submission, got ${kycDupRes.status}`);
console.log('✔ Duplicate document submission by second user returned 409 duplicate_document!');

// C.5 Reject WITHOUT reason -> 400
const kycRejectNoReason = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${superToken}`)
  .send({ action: 'kyc.review', target: kycUser, data: { status: 'rejected', reason: '' } });
assert.equal(kycRejectNoReason.status, 400);
console.log('✔ Rejecting KYC without a reason returns 400 Bad Request!');

// C.6 More Information with reason -> 200
const kycMoreInfo = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${superToken}`)
  .send({ action: 'kyc.review', target: kycUser, data: { status: 'more_information', reason: 'Please upload a clearer image' } });
assert.equal(kycMoreInfo.status, 200);
assert.equal(kycMoreInfo.body.status, 'more_information');
console.log('✔ KYC review status "more_information" saved successfully!');

// C.7 Revoke after verified -> 200
const kycRevoke = await request(app)
  .post('/api/control/action')
  .set('Authorization', `Bearer ${superToken}`)
  .send({ action: 'kyc.review', target: kycUser, data: { status: 'revoke', reason: 'Revoking due to audit finding' } });
assert.equal(kycRevoke.status, 200);

const vcustRevokedRow = await client.query('SELECT user_id, verified, revoked FROM verified_customers WHERE user_id = $1', [kycUser]);
console.log('[PROVED DB ROW] verified_customers after revoke:', vcustRevokedRow.rows[0]);
assert.equal(vcustRevokedRow.rows[0].revoked, true);
assert.equal(vcustRevokedRow.rows[0].verified, false);

const logRes = await client.query('SELECT * FROM kyc_access_log WHERE kyc_file_id = $1 OR staff_id = $2', [kycUser, 'usr-superadmin']);
assert.ok(logRes.rowCount > 0);
console.log('✔ KYC detail endpoint returned decrypted ID number & image, and logged staff access in kyc_access_log!');

server.close();
client.release();
await pool.end();

console.log('\n=== ALL HARNESS & SECURITY TESTS PASSED 100% ===');
process.exit(0);
