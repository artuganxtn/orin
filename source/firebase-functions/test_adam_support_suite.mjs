import assert from 'node:assert/strict';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import path from 'node:path';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.PGCLIENTENCODING = 'UTF-8';
const adminConnStr = 'postgres://postgres:password@localhost:5433/postgres?client_encoding=UTF8';
const appPassword = 'test_adam_suite_password_2026';
process.env.ORIN_APP_PASSWORD = appPassword;
const appConnStr = `postgres://orin_app:${appPassword}@localhost:5433/postgres?client_encoding=UTF8`;
process.env.DATABASE_URL = appConnStr;

console.log('=== STARTING ADAM SUPPORT AI & REPLIES TEST SUITE ===');

// 1. Start Embedded PostgreSQL
const ep = new EmbeddedPostgres({ port: 5433, databaseDir: './.pgdata', persistent: true });
await ep.start().catch(() => {});

// 2. Run Migrations as admin and seed initial test accounts
const { runMigrations } = await import('./lib/migrate.js');
const migrationsDir = path.resolve(process.cwd(), '../migrations');
await runMigrations(adminConnStr, migrationsDir);
console.log('[PASS] Migrations 001-015 applied successfully.');

const adminPool = new pg.Pool({ connectionString: adminConnStr });
const adminClient = await adminPool.connect();
await adminClient.query(`
  INSERT INTO profiles (id, email, display_name, role)
  VALUES ('usr-adam-test-a', 'usera@orin.test', 'User A', 'user'),
         ('usr-adam-test-b', 'userb@orin.test', 'User B', 'user'),
         ('usr-rate-limit-test', 'rate@orin.test', 'Rate User', 'user')
  ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id, display_name = EXCLUDED.display_name;

  INSERT INTO accounts (id, user_id, account_number, type, currency, balance_cents, bonus_cents, bonus_profit_cents)
  VALUES ('acc-adam-a', 'usr-adam-test-a', '1001001001', 'real', 'USD', 125000, 0, 0),
         ('acc-adam-b', 'usr-adam-test-b', '2002002002', 'real', 'USD', 850000, 0, 0)
  ON CONFLICT (id) DO UPDATE SET balance_cents = EXCLUDED.balance_cents;

  DELETE FROM docs WHERE collection IN ('support_threads', 'support_tickets', 'orinBotRates');
  DELETE FROM support_assistant_replies WHERE thread_id IN ('usr-adam-test-a', 'usr-adam-test-b');
`);
adminClient.release();
await adminPool.end();
console.log('[PASS] Seeded test profiles and real accounts for User A ($1,250.00) and User B ($8,500.00).');

// 3. Connect as orin_app for all test operations
const pool = new pg.Pool({ connectionString: appConnStr });
const client = await pool.connect();
const roleRes = await client.query('SELECT current_user');
assert.equal(roleRes.rows[0].current_user, 'orin_app');
console.log('[PASS] Connected to PostgreSQL as role orin_app.');

// 4. Import application modules
const { supportAssistantReply, mapStatusToHumanText, escalateSupportTicket } = await import('./lib/support.js');
const { sendSupportMessage, getSupportMessages } = await import('./lib/client-services.js');
const { app } = await import('./lib/index.js');

// 5. Test users
const userA = { id: 'usr-adam-test-a', email: 'usera@orin.test', role: 'user' };
const userB = { id: 'usr-adam-test-b', email: 'userb@orin.test', role: 'user' };

// ===================================================================
// TEST 1: 5-TURN CONVERSATION WITH MOCKED PROVIDER
// ===================================================================
console.log('\n--- TEST 1: 5-Turn Conversation with Mocked Provider ---');

const providerCalls = [];
const mockFetch = async (url, options) => {
  const body = JSON.parse(options.body);
  providerCalls.push({ url, body });
  const turnIndex = providerCalls.length;
  const replyText = `Contextual reply for turn ${turnIndex}: your request is understood and history length is ${body.contents?.length ?? 0}.`;

  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ text: replyText }]
        }
      }]
    })
  };
};

process.env.ORIN_SUPPORT_AI_API_KEY = 'test-mock-api-key-2026';

const turns = [
  'مرحباً، أنا مستخدم جديد في منصة أورين',
  'كم رصيد حسابي المتاح للتداول؟',
  'ما هي حالة توثيق الهوية KYC لحسابي؟',
  'هل يمكنني السحب الآن وما هي شروط السحب؟',
  'ما هي مواعيد صفقات اليوم؟'
];

globalThis.fetch = mockFetch;

const replies = [];
for (let i = 0; i < turns.length; i++) {
  const msgId = `msg-turn-${i + 1}-${Date.now()}`;
  const data = await sendSupportMessage(userA, { id: msgId, text: turns[i], locale: 'ar' });
  const lastAsst = data.messages.filter(m => m.kind === 'assistant').at(-1);
  assert.ok(lastAsst, 'Assistant reply must be present in messages');
  replies.push(lastAsst.text);
  console.log(`[Turn ${i + 1}] Sent: "${turns[i]}" -> Reply: "${lastAsst.text}"`);
}

// 1a. Assert 5 different replies
assert.equal(replies.length, 5);
const uniqueReplies = new Set(replies);
assert.equal(uniqueReplies.size, 5, 'All 5 turns must produce different, context-aware replies');

// 1b. Assert conversation history reached the provider
const lastCall = providerCalls[providerCalls.length - 1];
assert.ok(lastCall.body.contents.length >= 8, 'Provider must receive previous conversation history in contents');
const systemInstruction = lastCall.body.system_instruction?.parts?.[0]?.text || '';
assert.ok(systemInstruction.includes('DO NOT greet'), 'Subsequent turns must forbid re-greeting in system prompt');

// 1c. Assert statuses are mapped: NO "unsubmitted" in system instruction or reply
assert.ok(!systemInstruction.includes('unsubmitted'), 'Raw status "unsubmitted" must NEVER leak into system prompt');
assert.ok(!replies.some(r => r.includes('unsubmitted')), 'Raw status "unsubmitted" must NEVER leak into replies');
console.log('[PASS] 5-turn conversation yielded 5 distinct replies with full history passed to provider!');

// ===================================================================
// TEST 2: CONCURRENT TRIGGERS STORE EXACTLY ONE REPLY (IDEMPOTENCY)
// ===================================================================
console.log('\n--- TEST 2: Two Concurrent Triggers Store Exactly One Reply ---');

const testMsgId = 'msg-concurrent-' + randomUUID();
// Run 2 concurrent triggers simultaneously for the exact same messageId
const [reply1, reply2] = await Promise.all([
  supportAssistantReply(userA, { message: 'هل يمكنني إيداع USDT؟', messageId: testMsgId, locale: 'ar' }, mockFetch),
  supportAssistantReply(userA, { message: 'هل يمكنني إيداع USDT؟', messageId: testMsgId, locale: 'ar' }, mockFetch)
]);

assert.equal(reply1.ok, true);
assert.equal(reply2.ok, true);
assert.equal(reply1.reply, reply2.reply, 'Concurrent triggers must return the identical reply');

// Verify DB stores exactly 1 record in support_assistant_replies
const dbIdempCheck = await client.query(
  'SELECT COUNT(*)::INT as count FROM support_assistant_replies WHERE thread_id = $1 AND in_reply_to = $2',
  [userA.id, testMsgId]
);
assert.equal(dbIdempCheck.rows[0].count, 1, 'Database must enforce exactly 1 reply per in_reply_to');

// Verify support_threads doc contains exactly 1 reply for this in_reply_to
const threadRes = await client.query("SELECT data FROM docs WHERE collection = 'support_threads' AND id = $1", [userA.id]);
const threadMsgs = threadRes.rows[0].data.messages;
const matchingReplies = threadMsgs.filter(m => m.assistant?.inReplyTo === testMsgId);
assert.equal(matchingReplies.length, 1, 'Thread must contain exactly 1 reply for inReplyTo');
console.log('[PASS] Concurrency idempotency verified: exactly 1 reply stored across simultaneous calls!');

// ===================================================================
// TEST 3: PROVIDER FAILURE STORES SYSTEM_NOTICE, NOT GREETING
// ===================================================================
console.log('\n--- TEST 3: Provider Failure Stores System Notice, Not Greeting ---');

const failingFetch = async () => {
  throw new Error('Provider 503 service unavailable or timeout');
};

const failMsgId1 = 'msg-fail-1-' + randomUUID();
const failRes1 = await supportAssistantReply(userA, { message: 'رسالة أثناء انقطاع مزود الذكاء الاصطناعي', messageId: failMsgId1, locale: 'ar' }, failingFetch);

assert.equal(failRes1.ok, true);
assert.equal(failRes1.kind, 'system_notice', 'Failure must be flagged as system_notice');
assert.ok(!failRes1.reply.includes('أنا Adam مساعدك الذكي'), 'Failure must NOT return canned greeting');
assert.ok(failRes1.reply.includes('لا أستطيع الإجابة حالياً') || failRes1.reply.includes('حفظ رسالتك'), 'Failure must return honest short notice');

// Test: Never store the same fallback twice in a row
const failMsgId2 = 'msg-fail-2-' + randomUUID();
const failRes2 = await supportAssistantReply(userA, { message: 'رسالة ثانية أثناء الانقطاع', messageId: failMsgId2, locale: 'ar' }, failingFetch);
assert.equal(failRes2.reply, '', 'Second failure in a row must stay silent, never duplicate fallback');
console.log('[PASS] Provider failure stores honest system_notice, no canned greeting, and never duplicates fallback!');

// ===================================================================
// TEST 4: OPEN TICKET SUPPRESSES BOT REPLIES & RESOLVING RE-ENABLES
// ===================================================================
console.log('\n--- TEST 4: Open Ticket Suppresses Bot & Resolving Re-enables ---');

// Escalate ticket
const escResult = await escalateSupportTicket(userA, 'msg-esc-1');
assert.equal(escResult.ok, true);
assert.equal(escResult.ticket.status, 'open');

// Now send a message while ticket is open
const ticketMsgId = 'msg-during-ticket-' + randomUUID();
const silentRes = await supportAssistantReply(userA, { message: 'هل هناك رد على التذكرة؟', messageId: ticketMsgId, locale: 'ar' }, mockFetch);

assert.equal(silentRes.ok, true);
assert.equal(silentRes.status, 'handoff');
assert.equal(silentRes.reply, '', 'Bot must remain silent while ticket is open');

// Resolve the ticket
await client.query(
  `UPDATE docs SET data = jsonb_set(data, '{status}', '"resolved"') WHERE collection = 'support_tickets' AND id = $1`,
  [escResult.ticket.id]
);

// Now send a message after ticket is resolved -> Bot must reply!
const postResolveMsgId = 'msg-post-resolve-' + randomUUID();
const reEnabledRes = await supportAssistantReply(userA, { message: 'شكراً، هل يمكنك مساعدتي الآن؟', messageId: postResolveMsgId, locale: 'ar' }, mockFetch);
assert.equal(reEnabledRes.ok, true);
assert.ok(reEnabledRes.reply.length > 0, 'Bot must be re-enabled after ticket is resolved');
console.log('[PASS] Open ticket properly suppresses bot, and resolving ticket re-enables bot replies!');

// ===================================================================
// TEST 5: USER ISOLATION (USER A NEVER SEES USER B DATA)
// ===================================================================
console.log('\n--- TEST 5: User Isolation (Cross-User Privacy) ---');

let capturedUserAPrompt = '';
let capturedUserBPrompt = '';

const inspectFetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  const sysText = body.system_instruction?.parts?.[0]?.text || '';
  if (sysText.includes('$1250.00')) capturedUserAPrompt = sysText;
  if (sysText.includes('$8500.00')) capturedUserBPrompt = sysText;
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'Privacy verified' }] } }] })
  };
};

await supportAssistantReply(userA, { message: 'كم رصيدي؟', messageId: 'iso-a', locale: 'ar' }, inspectFetch);
await supportAssistantReply(userB, { message: 'كم رصيدي؟', messageId: 'iso-b', locale: 'ar' }, inspectFetch);

assert.ok(capturedUserAPrompt.includes('1250.00'), 'User A prompt must contain User A balance');
assert.ok(!capturedUserAPrompt.includes('8500.00'), 'User A prompt must NEVER contain User B balance');

assert.ok(capturedUserBPrompt.includes('8500.00'), 'User B prompt must contain User B balance');
assert.ok(!capturedUserBPrompt.includes('1250.00'), 'User B prompt must NEVER contain User A balance');
console.log('[PASS] User isolation verified: each user strictly receives their own data only!');

// ===================================================================
// TEST 6: RATE LIMITING (20 MSGS / HOUR PER USER)
// ===================================================================
console.log('\n--- TEST 6: Rate Limiting Enforcement (20 msgs/hr) ---');

const rateUser = { id: 'usr-rate-limit-test', email: 'rate@orin.test', role: 'user' };

let rateLimitedTriggered = false;
for (let i = 1; i <= 21; i++) {
  const res = await supportAssistantReply(rateUser, { message: `Rate test msg ${i}`, messageId: `msg-rate-${i}` }, mockFetch);
  if (!res.ok && res.code === 'rate_limited') {
    rateLimitedTriggered = true;
    assert.equal(i, 21, 'Rate limit must trigger on the 21st message');
    break;
  }
}
assert.equal(rateLimitedTriggered, true, 'Rate limit must reject message exceeding 20/hr');
console.log('[PASS] Rate limit verified: exactly 20 messages permitted, 21st rejected!');

// ===================================================================
// TEST 7: STATUS MAPPING COVERAGE
// ===================================================================
console.log('\n--- TEST 7: Status Mapping Coverage ---');
assert.equal(mapStatusToHumanText('unsubmitted', 'ar'), 'غير مقدّم بعد');
assert.equal(mapStatusToHumanText('unsubmitted', 'en'), 'Not submitted yet');
assert.equal(mapStatusToHumanText('pending', 'ar'), 'قيد المراجعة والتدقيق');
assert.equal(mapStatusToHumanText('pending', 'en'), 'Under review');
assert.equal(mapStatusToHumanText('verified', 'ar'), 'مكتمَل وموثّق معتمد ✅');
assert.equal(mapStatusToHumanText('verified', 'en'), 'Verified ✅');
assert.equal(mapStatusToHumanText('rejected', 'ar'), 'مرفوض - يرجى إعادة الرفع');
assert.equal(mapStatusToHumanText('rejected', 'en'), 'Rejected - please re-upload');
console.log('[PASS] Status mapping function verified in Arabic and English.');

// ===================================================================
// TEST 8: SUPERTEST HTTP ROUTES
// ===================================================================
console.log('\n--- TEST 8: Supertest HTTP Routes ---');

// Authenticated test token for user A
const tokenA = 'test-token-usr-adam-test-a:usera@orin.test:User A:true';

// 8a. GET /api/support/assistant
const capRes = await request(app)
  .get('/api/support/assistant')
  .set('Authorization', `Bearer ${tokenA}`);
assert.equal(capRes.status, 200);
assert.equal(capRes.body.available, true);
console.log('[PASS] GET /api/support/assistant returned 200 OK.');

// 8b. POST /api/support/messages (triggers server-side assistant reply)
const sendRes = await request(app)
  .post('/api/support/messages')
  .set('Authorization', `Bearer ${tokenA}`)
  .send({ text: 'رسالة عبر واجهة التطبيق' });
assert.equal(sendRes.status, 200);
assert.ok(sendRes.body.messages.length >= 1);
console.log('[PASS] POST /api/support/messages returned 200 OK.');

// 8c. GET /api/support/messages
const getRes = await request(app)
  .get('/api/support/messages')
  .set('Authorization', `Bearer ${tokenA}`);
assert.equal(getRes.status, 200);
assert.ok(getRes.body.messages.length >= 1);
console.log('[PASS] GET /api/support/messages returned 200 OK.');

// 8d. POST /api/support/escalate
const escRouteRes = await request(app)
  .post('/api/support/escalate')
  .set('Authorization', `Bearer ${tokenA}`)
  .send({ messageId: 'msg-http-esc-1' });
assert.equal(escRouteRes.status, 200);
assert.equal(escRouteRes.body.ok, true);
assert.ok(escRouteRes.body.ticket.id.startsWith('spt-'));
console.log('[PASS] POST /api/support/escalate returned 200 OK.');

// Cleanup
client.release();
await pool.end();
const { pool: appDbPool } = await import('./lib/db.js');
await appDbPool.end().catch(() => {});
await ep.stop().catch(() => {});

console.log('\n==================================================');
console.log('✔ ALL ADAM SUPPORT TESTS PASSED PERFECTLY!');
console.log('==================================================\n');
process.exit(0);
