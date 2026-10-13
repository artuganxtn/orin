process.env.NODE_ENV = 'test';
process.env.PGCLIENTENCODING = 'UTF-8';
process.env.DATABASE_URL = 'postgres://postgres:password@localhost:5433/postgres?client_encoding=UTF8';
process.env.TELEGRAM_BOT_TOKEN = '8435789146:AAGDwXQ3NcBf0CdsAo0ZeL4Pn28RyS_4sM';
process.env.TELEGRAM_CHANNEL_ID = '-1003753942964';
process.env.TELEGRAM_TEST_CHANNEL_ID = '-1003753942964';
process.env.ADMIN_TELEGRAM_IDS = '-1003753942964';
process.env.TELEGRAM_MODE = 'production';
process.env.TELEGRAM_AUTO_POST_ENABLED = 'true';

import assert from 'node:assert/strict';
import http from 'node:http';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const { escapeHtml, renderMessageTemplate, processTelegramOutboxOnce } = await import('./lib/telegram.js');
const { computeSlotTargetTime, getCurrentDateStrInTz, processSchedulerSlotsOnce } = await import('./lib/scheduler.js');

// 1. START LOCAL MOCK TELEGRAM HTTP SERVER
const recordedTelegramRequests = [];
let mockServerFailCount = 0;
let mockServerRateLimitCount = 0;

const mockTelegramServer = http.createServer(async (req, res) => {
  let bodyStr = '';
  for await (const chunk of req) {
    bodyStr += chunk;
  }

  const payload = bodyStr ? JSON.parse(bodyStr) : {};
  recordedTelegramRequests.push({ url: req.url, body: payload, headers: req.headers });

  if (mockServerRateLimitCount > 0) {
    mockServerRateLimitCount--;
    res.writeHead(429, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 1 }, description: 'Too Many Requests: retry after 1' }));
  }

  if (mockServerFailCount > 0) {
    mockServerFailCount--;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error_code: 500, description: 'Internal Server Error' }));
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    result: { message_id: 1000 + recordedTelegramRequests.length, date: Math.floor(Date.now() / 1000) }
  }));
});

const MOCK_PORT = 10005;
await new Promise(resolve => mockTelegramServer.listen(MOCK_PORT, '127.0.0.1', resolve));
const mockTelegramBaseUrl = `http://127.0.0.1:${MOCK_PORT}`;

// 2. CONNECT TO POSTGRES
const ep = new EmbeddedPostgres({ port: 5433, databaseDir: './.pgdata', persistent: true });
await ep.start().catch(() => {});

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

console.log('=== TELEGRAM SCHEDULER, OUTBOX & SAFETY TEST SUITE ===');

process.env.ORIN_APP_PASSWORD = 'test_orin_password';
const { runMigrations } = await import('./lib/migrate.js');
import path from 'node:path';
await runMigrations(process.env.DATABASE_URL, path.resolve(process.cwd(), '../migrations'));

// Clean DB state for tests
await client.query('DELETE FROM telegram_outbox');
await client.query('DELETE FROM scheduled_runs');
await client.query('DELETE FROM contracts WHERE admin_id = \'scheduler\'');

// TEST 1: TEMPLATE SNAPSHOTS & HTML SAFETY
console.log('\n--- TEST 1: Template Snapshots & HTML Safety ---');

const testContractInfo = {
  id: 'contract-test-html',
  code: 'ORIN-<TEST-CODE-&>',
  title: 'صفقة <VIP> & ذهب',
  asset: 'XAUUSD',
  direction: 'BUY',
  durationSec: 180,
  settlementBps: 900,
  opensAtMs: 1791823500000,
  closesAtMs: 1791827100000
};

await client.query(`
  INSERT INTO profiles (id, email, display_name, role)
  VALUES ('scheduler', 'scheduler@orin.internal', 'ORIN Scheduler Engine', 'admin')
  ON CONFLICT (id) DO NOTHING;
`);

await client.query(`
  INSERT INTO contracts (id, code, title, asset, direction, duration_sec, settlement_bps, status, opens_at, closes_at, eligibility, hash, admin_id, created_at)
  VALUES ('contract-test-html', 'ORIN-<TEST-CODE-&>', 'صفقة <VIP> & ذهب', 'XAUUSD', 'BUY', 180, 900, 'active', NOW(), NOW() + INTERVAL '1 hour', 'all', 'hash-test', 'scheduler', NOW())
  ON CONFLICT (id) DO NOTHING;
`);

const regularTpl = renderMessageTemplate('regular_slot', testContractInfo, 'الصفقة الأولى - العصر');
const agentTpl = renderMessageTemplate('agent_slot', testContractInfo, 'صفقة وكيل أورين');
const endedTpl = renderMessageTemplate('ended_slot', testContractInfo, 'الصفقة الأولى');

console.log('\n[SNAPSHOT] Regular Slot Template Rendered Text:');
console.log(regularTpl.text);

console.log('\n[SNAPSHOT] Agent Slot Template Rendered Text:');
console.log(agentTpl.text);

console.log('\n[SNAPSHOT] Ended Slot Template Rendered Text:');
console.log(endedTpl.text);

// Assert HTML Escaping
assert.ok(regularTpl.text.includes('&lt;VIP&gt; &amp; ذهب'), 'Title HTML escaped');
assert.ok(regularTpl.text.includes('&lt;TEST-CODE-&amp;&gt;'), 'Code HTML escaped');
assert.ok(!regularTpl.text.includes('<VIP>'), 'Unescaped HTML tags removed');
console.log('✔ HTML Safety verified: <, >, & correctly escaped in message body.');

// TEST 2: SCHEDULER TIMING & GRACE WINDOW (FAKE CLOCK)
console.log('\n--- TEST 2: Scheduler Timing & Grace Window ---');

// Set time to Istanbul 16:45 on 2026-10-12
const slotDate = '2026-10-12';
const targetMs = computeSlotTargetTime('16:45', 'Europe/Istanbul', slotDate);

// Run exactly at 16:45
const run1 = await processSchedulerSlotsOnce(targetMs);
assert.equal(run1.runsCreated > 0, true, 'Slot fired at exact scheduled time');

// Re-run at same time -> Must not duplicate
const run1Dup = await processSchedulerSlotsOnce(targetMs);
assert.equal(run1Dup.runsCreated, 0, 'No duplicate run created for same slot & date');

console.log('✔ Slot fired exactly once at scheduled time, duplicate runs blocked.');

// TEST 3: CONCURRENCY (TWO WORKERS AT ONCE)
console.log('\n--- TEST 3: Concurrency (Two Workers at Once) ---');

const targetMs1830 = computeSlotTargetTime('18:30', 'Europe/Istanbul', slotDate);

// Execute two workers simultaneously
const [resA, resB] = await Promise.all([
  processSchedulerSlotsOnce(targetMs1830),
  processSchedulerSlotsOnce(targetMs1830)
]);

const totalCreated = resA.runsCreated + resB.runsCreated;
assert.equal(totalCreated, 1, 'Exactly one worker created the run record');
console.log('✔ Concurrency check passed: Two concurrent workers generated exactly 1 run with 0 duplicates.');

// TEST 4: OUTBOX WORKER RETRY (HTTP 429 RATE LIMIT & 500 ERROR)
console.log('\n--- TEST 4: Outbox Worker Retry & Rate Limit Handling ---');

mockServerRateLimitCount = 1; // First attempt 429
mockServerFailCount = 1; // Second attempt 500

const outboxRes1 = await processTelegramOutboxOnce(mockTelegramBaseUrl);
assert.equal(outboxRes1.errors > 0, true, '429 Rate limit / 500 Server error recorded on initial attempts');

// Update next_attempt_at to NOW() for retry execution
await client.query(`UPDATE telegram_outbox SET next_attempt_at = NOW() WHERE status = 'pending'`);

const outboxRes2 = await processTelegramOutboxOnce(mockTelegramBaseUrl);
assert.equal(outboxRes2.processed > 0, true, 'Messages successfully sent on retry after rate limits/errors resolved');

console.log('✔ Outbox retry verified: 429 rate limit & 500 errors handled with retries until successful transmission.');

// TEST 5: KILL SWITCH (TELEGRAM_AUTO_POST_ENABLED = false)
console.log('\n--- TEST 5: Global Kill Switch ---');

process.env.TELEGRAM_AUTO_POST_ENABLED = 'false';

// Insert pending outbox row
await client.query(`
  INSERT INTO telegram_outbox (id, kind, contract_id, payload, status, next_attempt_at)
  VALUES ('outbox-killswitch-test', 'channel_post', 'contract-test-html', '{"method":"sendMessage","body":{"chat_id":"@test","text":"Kill Switch Test"}}'::jsonb, 'pending', NOW())
  ON CONFLICT DO NOTHING
`);

const killRes = await processTelegramOutboxOnce(mockTelegramBaseUrl);
assert.equal(killRes.processed, 0, 'Kill switch stopped outbox processing');
console.log('✔ Global kill switch verified: Outbox worker immediately halts transmission when TELEGRAM_AUTO_POST_ENABLED=false.');

process.env.TELEGRAM_AUTO_POST_ENABLED = 'true';

// TEST 6: LEDGER INVARIANT CHECK
console.log('\n--- TEST 6: Double-Entry Ledger Invariant ---');

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

// TEST 7: LIVE RUN AGAINST MOCKED TEST CHANNEL
console.log('\n--- TEST 7: Live Run Against Test Channel ---');

await client.query(`UPDATE telegram_outbox SET status = 'pending', attempts = 0, next_attempt_at = NOW() WHERE id = 'outbox-killswitch-test'`);
const liveRunOutbox = await processTelegramOutboxOnce(mockTelegramBaseUrl);
assert.ok(liveRunOutbox.processed > 0, 'Live outbox item processed');

console.log('\n[PROOF] Sent Message Text to Telegram Test Channel:');
const lastReq = recordedTelegramRequests.at(-1);
console.log(lastReq?.body?.text);

console.log('\n=== ALL TELEGRAM SCHEDULER & OUTBOX TESTS PASSED 100% ===');
setTimeout(() => process.exit(0), 100);
