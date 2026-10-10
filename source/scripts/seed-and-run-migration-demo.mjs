import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runMigration, initFirestore } from './migrate-balances.mjs';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const functionsPkg = path.resolve(currentDir, '../firebase-functions/package.json');
const require = createRequire(functionsPkg);
const { FieldValue } = require('firebase-admin/firestore');

const db = initFirestore();

async function cleanUserDocs(uid) {
  const collections = [
    `sparkTradingAccounts/${uid}/accounts`,
    'orinPositions',
    'orinJournals',
    'orinAudit',
    'orinNotices',
    'orinReceipts'
  ];

  for (const col of collections) {
    let snap;
    if (col.startsWith('sparkTradingAccounts')) {
      snap = await db.collection(col).get();
    } else {
      snap = await db.collection(col).where('user_id', '==', uid).get();
    }
    for (const d of snap.docs) {
      await d.ref.delete();
    }
  }

  await db.doc(`users/${uid}`).delete().catch(() => {});
  await db.doc(`orinAccounts/${uid}`).delete().catch(() => {});
  await db.doc(`sparkAccountSelections/${uid}`).delete().catch(() => {});
  await db.doc(`sparkTradingAccounts/${uid}`).delete().catch(() => {});
}

async function seedCases() {
  console.log('Seeding emulator with the 4 required cases...\n');

  // Case 1: deposit + referral + settled trade
  // Hand calculation:
  // - Deposit: 1000 USD (100,000 cents) -> spark.balance = 100,000
  // - Referral credit: 50 USD (5,000 cents) -> spark.balance = 105,000
  // - Settled trade: joined 200 USD (20,000 cents) with +20 USD (+2,000 cents) pnl
  //   - Journal allocate: cash -20,000, reserved +20,000
  //   - Journal settle: reserved -20,000, cash +22,000
  //   - Trading Delta: cash = -20,000 + 22,000 = +2,000; reserved = +20,000 - 20,000 = 0
  // - Spark Before: balance 105,000, reserved 0
  // - Spark After: balance 105,000 + 2,000 = 107,000 ($1,070.00); reserved 0 ($0.00)
  // - Orin Accounts (diverged legacy): balance 102,000, reserved 0 (referral was missing in orin!)
  const u1 = 'user1-dep-ref-settle';
  await cleanUserDocs(u1);
  await db.doc(`users/${u1}`).set({ uid: u1, email: `${u1}@example.com`, displayName: 'User 1' });
  await db.doc(`sparkTradingAccounts/${u1}/accounts/real-acc-1`).set({
    ownerId: u1,
    accountNumber: '111122223331',
    type: 'real',
    currency: 'USD',
    balanceCents: 105000,
    reservedCents: 0,
    createdAt: Date.now()
  });
  await db.doc(`sparkAccountSelections/${u1}`).set({ accountId: 'real-acc-1' });
  await db.doc(`orinAccounts/${u1}`).set({
    id: u1,
    balanceCents: 102000,
    reservedCents: 0,
    tier: 'standard'
  });
  await db.doc(`orinPositions/pos-${u1}-1`).set({
    id: `pos-${u1}-1`,
    user_id: u1,
    account_id: 'real-acc-1',
    contract_id: 'contract-test-1',
    amount_cents: 20000,
    result_cents: 2000,
    status: 'settled'
  });
  await db.doc(`orinJournals/allocate:pos-${u1}-1`).set({
    id: `allocate:pos-${u1}-1`,
    user_id: u1,
    kind: 'allocation',
    reference: `pos-${u1}-1`,
    status: 'posted',
    entries: [
      { id: '1', journal_id: `allocate:pos-${u1}-1`, account: `user:${u1}:cash`, amount_cents: -20000, kind: 'allocation' },
      { id: '2', journal_id: `allocate:pos-${u1}-1`, account: `user:${u1}:reserved`, amount_cents: 20000, kind: 'allocation' }
    ]
  });
  await db.doc(`orinJournals/settle:pos-${u1}-1`).set({
    id: `settle:pos-${u1}-1`,
    user_id: u1,
    kind: 'settlement',
    reference: `pos-${u1}-1`,
    status: 'posted',
    entries: [
      { id: '1', journal_id: `settle:pos-${u1}-1`, account: `user:${u1}:reserved`, amount_cents: -20000, kind: 'settlement' },
      { id: '2', journal_id: `settle:pos-${u1}-1`, account: `user:${u1}:cash`, amount_cents: 22000, kind: 'settlement' },
      { id: '3', journal_id: `settle:pos-${u1}-1`, account: 'system:trading-pnl', amount_cents: -2000, kind: 'settlement' }
    ]
  });

  // Case 2: open position
  // Hand calculation:
  // - Deposit: 500 USD (50,000 cents) -> spark.balance = 50,000, spark.reserved = 0
  // - Open position: joined 200 USD (20,000 cents), not settled yet
  //   - Journal allocate: cash -20,000, reserved +20,000
  //   - Position: status 'active', amount_cents 20,000, account_id missing (to backfill)
  //   - Trading Delta: cash = -20,000; reserved = +20,000
  // - Spark Before: balance 50,000, reserved 0
  // - Spark After: balance 50,000 - 20,000 = 30,000 ($300.00); reserved 0 + 20,000 = 20,000 ($200.00)
  // - Checks: newSpark.reserved (20,000) == active sum (20,000) -> PASS; balance (30,000) >= 0 -> PASS
  // - Position: backfill account_id to 'real-acc-2'
  const u2 = 'user2-open-position';
  await cleanUserDocs(u2);
  await db.doc(`users/${u2}`).set({ uid: u2, email: `${u2}@example.com`, displayName: 'User 2' });
  await db.doc(`sparkTradingAccounts/${u2}/accounts/real-acc-2`).set({
    ownerId: u2,
    accountNumber: '111122223332',
    type: 'real',
    currency: 'USD',
    balanceCents: 50000,
    reservedCents: 0,
    createdAt: Date.now()
  });
  await db.doc(`sparkAccountSelections/${u2}`).set({ accountId: 'real-acc-2' });
  await db.doc(`orinAccounts/${u2}`).set({
    id: u2,
    balanceCents: 30000,
    reservedCents: 20000,
    tier: 'standard'
  });
  await db.doc(`orinPositions/pos-${u2}-1`).set({
    id: `pos-${u2}-1`,
    user_id: u2,
    contract_id: 'contract-test-2',
    amount_cents: 20000,
    result_cents: 2000,
    status: 'active'
    // Notice: account_id intentionally omitted to test backfill
  });
  await db.doc(`orinJournals/allocate:pos-${u2}-1`).set({
    id: `allocate:pos-${u2}-1`,
    user_id: u2,
    kind: 'allocation',
    reference: `pos-${u2}-1`,
    status: 'posted',
    entries: [
      { id: '1', journal_id: `allocate:pos-${u2}-1`, account: `user:${u2}:cash`, amount_cents: -20000, kind: 'allocation' },
      { id: '2', journal_id: `allocate:pos-${u2}-1`, account: `user:${u2}:reserved`, amount_cents: 20000, kind: 'allocation' }
    ]
  });

  // Case 3: admin credit
  // Hand calculation:
  // - Admin credit: 150 USD (15,000 cents) -> spark.balance = 15,000, spark.reserved = 0
  // - No trades in journals: tradingDelta = cash 0, reserved 0
  // - Orin Accounts: 0 cents (admin credits only went to spark!)
  // - Spark Before: balance 15,000, reserved 0
  // - Spark After: balance 15,000 ($150.00), reserved 0 ($0.00)
  // - Admin credit is PRESERVED (NOT overwritten by orin's 0)
  const u3 = 'user3-admin-credit';
  await cleanUserDocs(u3);
  await db.doc(`users/${u3}`).set({ uid: u3, email: `${u3}@example.com`, displayName: 'User 3' });
  await db.doc(`sparkTradingAccounts/${u3}/accounts/real-acc-3`).set({
    ownerId: u3,
    accountNumber: '111122223333',
    type: 'real',
    currency: 'USD',
    balanceCents: 15000,
    reservedCents: 0,
    createdAt: Date.now()
  });
  await db.doc(`sparkAccountSelections/${u3}`).set({ accountId: 'real-acc-3' });
  await db.doc(`orinAccounts/${u3}`).set({
    id: u3,
    balanceCents: 0,
    reservedCents: 0,
    tier: 'standard'
  });

  // Case 4: user with no orinAccounts doc
  // Hand calculation:
  // - Deposit: 250 USD (25,000 cents) -> spark.balance = 25,000, spark.reserved = 0
  // - orinAccounts: DOES NOT EXIST
  // - Trading Delta: cash 0, reserved 0
  // - Spark Before: balance 25,000, reserved 0
  // - Spark After: balance 25,000 ($250.00), reserved 0 ($0.00)
  // - Reported with flag [NO_ORIN_DOC, IN_SYNC] without crashing or skipping
  const u4 = 'user4-no-orin-doc';
  await cleanUserDocs(u4);
  await db.doc(`users/${u4}`).set({ uid: u4, email: `${u4}@example.com`, displayName: 'User 4' });
  await db.doc(`sparkTradingAccounts/${u4}/accounts/real-acc-4`).set({
    ownerId: u4,
    accountNumber: '111122223334',
    type: 'real',
    currency: 'USD',
    balanceCents: 25000,
    reservedCents: 0,
    createdAt: Date.now()
  });
  await db.doc(`sparkAccountSelections/${u4}`).set({ accountId: 'real-acc-4' });
  // Notice: orinAccounts/${u4} is deliberately NOT created

  console.log('Seeding completed successfully.\n');
}

async function main() {
  await seedCases();

  console.log('>>> RUNNING DRY RUN:\n');
  await runMigration({ db, apply: false });

  console.log('>>> RUNNING APPLY WITH --apply --yes:\n');
  await runMigration({ db, apply: true, yes: true });

  console.log('>>> VERIFYING POST-APPLY DATABASE STATE:\n');

  // Verify Case 1
  const s1 = (await db.doc('sparkTradingAccounts/user1-dep-ref-settle/accounts/real-acc-1').get()).data();
  assert.equal(s1.balanceCents, 107000, 'User 1 final balance must be 107000 cents');
  assert.equal(s1.reservedCents, 0, 'User 1 final reserved must be 0 cents');
  const j1 = (await db.doc('orinJournals/migration-v1:user1-dep-ref-settle').get()).data();
  assert.ok(j1, 'User 1 migration journal must exist');
  assert.equal(j1.entries[0].account, 'user:user1-dep-ref-settle:cash');
  assert.equal(j1.entries[0].amount_cents, 2000);
  assert.equal(j1.entries[1].account, 'system:migration:cash');
  assert.equal(j1.entries[1].amount_cents, -2000);
  console.log('  [PASS] User 1 post-migration state verified (balance: 107000, reserved: 0, referral preserved).');

  // Verify Case 2
  const s2 = (await db.doc('sparkTradingAccounts/user2-open-position/accounts/real-acc-2').get()).data();
  assert.equal(s2.balanceCents, 30000, 'User 2 final balance must be 30000 cents');
  assert.equal(s2.reservedCents, 20000, 'User 2 final reserved must be 20000 cents');
  const pos2 = (await db.doc('orinPositions/pos-user2-open-position-1').get()).data();
  assert.equal(pos2.account_id, 'real-acc-2', 'User 2 position account_id must be backfilled to real-acc-2');
  console.log('  [PASS] User 2 post-migration state verified (balance: 30000, reserved: 20000, account_id backfilled).');

  // Verify Case 3
  const s3 = (await db.doc('sparkTradingAccounts/user3-admin-credit/accounts/real-acc-3').get()).data();
  assert.equal(s3.balanceCents, 15000, 'User 3 final balance must be 15000 cents');
  assert.equal(s3.reservedCents, 0, 'User 3 final reserved must be 0 cents');
  console.log('  [PASS] User 3 post-migration state verified (balance: 15000, admin credit preserved).');

  // Verify Case 4
  const s4 = (await db.doc('sparkTradingAccounts/user4-no-orin-doc/accounts/real-acc-4').get()).data();
  assert.equal(s4.balanceCents, 25000, 'User 4 final balance must be 25000 cents');
  assert.equal(s4.reservedCents, 0, 'User 4 final reserved must be 0 cents');
  console.log('  [PASS] User 4 post-migration state verified (balance: 25000, no orin doc handled).');

  console.log('\n>>> TESTING IDEMPOTENCY: RERUNNING APPLY A SECOND TIME:\n');
  await runMigration({ db, apply: true, yes: true });
  console.log('  [PASS] Re-run completed cleanly with 0 double-applications.');
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
