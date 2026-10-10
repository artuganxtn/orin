import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  publish,
  join,
  settle,
  state,
  recordConfirmedDeposit,
  paymentService,
  controlAction,
  NowPayments,
  validIpn,
  canonical,
  units,
  db,
  hash,
  ref
} from '../firebase-functions/test-balance-bundle.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Local Firebase emulator required');
}

// Staff roles for Control Center two-person approval
const staffMaker = {
  id: 'staff-maker',
  email: 'maker@example.test',
  name: 'Finance Maker',
  verified: true,
  authTime: Math.floor(Date.now() / 1000)
};
const staffChecker = {
  id: 'staff-checker',
  email: 'checker@example.test',
  name: 'Finance Checker',
  verified: true,
  authTime: Math.floor(Date.now() / 1000)
};
const adminUser = {
  id: 'admin-contracts',
  email: 'khtaub7341@gmail.com', // OWNER email so owner(u) passes
  name: 'Admin',
  verified: true,
  authTime: Math.floor(Date.now() / 1000)
};

const secret = 'LOCAL-TEST-IPN-SECRET-512';
let serial = 800000;
const providerPayments = new Map();
const mockProvider = {
  async create(orderId, amountCents, coin) {
    const value = {
      payment_id: String(++serial),
      order_id: orderId,
      price_amount: amountCents / 100,
      price_currency: 'usd',
      pay_currency: coin,
      pay_amount: '50',
      actually_paid: '0',
      payment_status: 'waiting',
      pay_address: 'TTestAddress123456789012345678',
      payin_extra_id: null
    };
    providerPayments.set(value.payment_id, value);
    return value;
  },
  async get(id) {
    return structuredClone(providerPayments.get(String(id)));
  }
};
const service = paymentService(mockProvider, secret);
const sign = (body) => createHmac('sha512', secret).update(JSON.stringify(canonical(body))).digest('hex');

async function getSparkAccount(uid, accountId = 'real') {
  const snap = await db.doc(`sparkTradingAccounts/${uid}/accounts/${accountId}`).get();
  return snap.data();
}

async function getOrinAccount(uid) {
  const snap = await db.doc(`orinAccounts/${uid}`).get();
  return snap.data();
}

async function getLedgerSumForUser(uid, accountId = 'real') {
  // 1. orinProgramLedger entries
  const progRows = await db.collection('orinProgramLedger')
    .where('uid', '==', uid)
    .where('accountId', '==', accountId)
    .get();
  let progCents = 0;
  for (const doc of progRows.docs) {
    const d = doc.data();
    for (const e of d.entries || []) {
      if (e.account === 'cash' || e.account === `customer:${uid}:${accountId}`) {
        progCents += e.cents;
      }
    }
  }

  // 2. orinJournals entries
  const journalRows = await db.collection('orinJournals')
    .where('user_id', '==', uid)
    .get();
  let journalCents = 0;
  for (const doc of journalRows.docs) {
    const d = doc.data();
    for (const e of d.entries || []) {
      if (e.account === `user:${uid}:cash` || e.account === `user:${uid}:reserved`) {
        journalCents += e.amount_cents;
      }
    }
  }

  return progCents + journalCents;
}

before(async () => {
  // Bootstrap staff & control center config
  for (const u of [staffMaker, staffChecker, adminUser]) {
    await db.doc(`users/${u.id}`).set({
      uid: u.id,
      email: u.email,
      displayName: u.name,
      disabled: false,
      role: 'admin'
    });
  }
  await db.doc(`orinStaff/${staffMaker.id}`).set({
    email: staffMaker.email,
    roles: ['finance'],
    status: 'active',
    validAfter: 0,
    revision: 0
  });
  await db.doc(`orinStaff/${staffChecker.id}`).set({
    email: staffChecker.email,
    roles: ['finance_approver'],
    status: 'active',
    validAfter: 0,
    revision: 0
  });
  await db.doc(`orinStaff/${adminUser.id}`).set({
    email: adminUser.email,
    roles: ['super_admin'],
    status: 'active',
    validAfter: 0,
    revision: 0
  });
  await db.doc('system/control-center').set({ enabled: true, superAdminCount: 1 });
  await db.doc('orinControlConfiguration/current').set({
    maintenance: false,
    maxAdjustmentCents: 500000,
    depositsEnabled: true,
    revision: 0
  });
  await db.doc('orinProgramConfiguration/current').set({
    enabled: true,
    termsVersion: 'TEST-V1',
    revision: 1
  });
});

// CASE 1: deposit 1000 -> join 500 -> settle +50 (one balance doc, correct at every step)
test('Case 1: deposit 1000 -> join 500 -> settle +50 maintains one balance doc, correct at every step', async () => {
  const u = {
    id: 'user-case-1',
    email: 'case1@example.test',
    name: 'Case 1 User',
    verified: true,
    authTime: Math.floor(Date.now() / 1000)
  };
  const now = Date.now();

  // Setup user and initial spark trading account
  await db.doc(`users/${u.id}`).set({
    uid: u.id,
    email: u.email,
    displayName: u.name,
    disabled: false,
    role: 'user'
  });
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).set({
    ownerId: u.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0,
    realizedCents: 0
  });
  await db.doc(`sparkAccountSelections/${u.id}`).set({ accountId: 'real' });
  await db.doc(`orinAccounts/${u.id}`).set({
    id: u.id,
    tier: 'standard',
    profile: { closureStatus: 'open' },
    accepted_at: now
  });

  // STEP 1: Deposit $1,000 (100,000 integer cents)
  await recordConfirmedDeposit({
    eventId: 'dep-case-1-1000',
    uid: u.id,
    accountId: 'real',
    currency: 'USD',
    cents: 100000,
    eligible: true
  });

  // Verification Step 1:
  const sparkAfterDep = await getSparkAccount(u.id);
  assert.equal(sparkAfterDep.balanceCents, 100000, 'Step 1: spark balance must be 100,000 cents');
  assert.equal(sparkAfterDep.reservedCents, 0, 'Step 1: spark reserved must be 0 cents');

  const orinAfterDep = await getOrinAccount(u.id);
  assert.equal(orinAfterDep.balanceCents, undefined, 'Step 1: orinAccounts must NOT dual-write balance');

  let ledgerSum = await getLedgerSumForUser(u.id);
  assert.equal(sparkAfterDep.balanceCents + sparkAfterDep.reservedCents, ledgerSum, 'Step 1: invariant balance + reserved == sum of ledger entries');

  // STEP 2: Join $500 (50,000 integer cents)
  // Publish contract with +10.00% (+1000 bps) settlement
  // On 50,000 cents, +10% yields exactly +50.00 USD (+5,000 cents)
  const published = await publish(adminUser, {
    title: 'Case 1 Contract',
    asset: 'BTCUSD',
    direction: 'BUY',
    durationSec: 60,
    settlementBps: 1000,
    eligibility: 'all',
    opensAt: now - 1000,
    closesAt: now + 3600000
  }, now);

  const joinResult = await join(u, {
    code: published.code,
    amountCents: 50000,
    contractHash: published.hash,
    confirmed: true,
    accountId: 'real'
  }, now + 100);
  assert.equal(joinResult.reused, false);

  // Verification Step 2:
  const sparkAfterJoin = await getSparkAccount(u.id);
  assert.equal(sparkAfterJoin.balanceCents, 50000, 'Step 2: spark balance must be 50,000 cents');
  assert.equal(sparkAfterJoin.reservedCents, 50000, 'Step 2: spark reserved must be 50,000 cents');

  const orinAfterJoin = await getOrinAccount(u.id);
  assert.equal(orinAfterJoin.balanceCents, undefined, 'Step 2: orinAccounts must NOT store balance');

  ledgerSum = await getLedgerSumForUser(u.id);
  assert.equal(sparkAfterJoin.balanceCents + sparkAfterJoin.reservedCents, ledgerSum, 'Step 2: invariant balance + reserved == sum of ledger entries');

  // STEP 3: Settle +50 (+5,000 integer cents)
  await settle(u, now + 65000);

  // Verification Step 3:
  const sparkAfterSettle = await getSparkAccount(u.id);
  assert.equal(sparkAfterSettle.balanceCents, 105000, 'Step 3: spark balance must be 105,000 cents');
  assert.equal(sparkAfterSettle.reservedCents, 0, 'Step 3: spark reserved must be 0 cents');
  assert.equal(sparkAfterSettle.realizedCents, 5000, 'Step 3: spark realized PnL must be +5,000 cents');

  const orinAfterSettle = await getOrinAccount(u.id);
  assert.equal(orinAfterSettle.balanceCents, undefined, 'Step 3: orinAccounts must NOT store balance');

  ledgerSum = await getLedgerSumForUser(u.id);
  assert.equal(sparkAfterSettle.balanceCents + sparkAfterSettle.reservedCents, ledgerSum, 'Step 3: invariant balance + reserved == sum of ledger entries');
});

// CASE 2: referral payout and admin adjust change the same doc contracts read
test('Case 2: referral payout and admin adjust change the same doc contracts read', async () => {
  const u = {
    id: 'user-case-2',
    email: 'case2@example.test',
    name: 'Case 2 User',
    verified: true,
    authTime: Math.floor(Date.now() / 1000)
  };
  const friend = {
    id: 'friend-case-2',
    email: 'friend2@example.test',
    name: 'Friend 2',
    verified: true
  };
  const now = Date.now();

  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, displayName: u.name, disabled: false, role: 'user' });
  await db.doc(`users/${friend.id}`).set({ uid: friend.id, email: friend.email, displayName: friend.name, disabled: false, role: 'user' });
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).set({
    ownerId: u.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0
  });
  await db.doc(`sparkAccountSelections/${u.id}`).set({ accountId: 'real' });
  await db.doc(`orinAccounts/${u.id}`).set({
    id: u.id,
    tier: 'standard',
    profile: { closureStatus: 'open' },
    preferences: { notificationEvents: {} },
    accepted_at: now
  });

  // 1. Referral Payout of $80 (+8,000 cents)
  await db.doc(`orinVerifiedCustomers/${u.id}`).set({ verified: true, revoked: false, customerKey: hash(u.id) });
  await db.doc(`orinVerifiedCustomers/${friend.id}`).set({ verified: true, revoked: false, customerKey: hash(friend.id) });
  await db.doc(`orinProgramMembers/${u.id}`).set({ uid: u.id, pendingCents: 8000, paidCents: 0 });
  await db.doc(`orinProgramMembers/${friend.id}`).set({ uid: friend.id, referralStatus: 'approved' });
  await db.doc('orinProgramEvidence/ev-case-2').set({
    uid: friend.id,
    kind: 'referral_qualified',
    termsVersion: 'TEST-V1',
    revoked: false
  });
  await db.doc('orinReferralRewards/rew-case-2').set({
    referrerId: u.id,
    referredId: friend.id,
    status: 'approved',
    amountCents: 8000,
    termsVersion: 'TEST-V1',
    evidenceId: 'ev-case-2',
    revision: 0
  });

  const refProp = await controlAction(staffMaker, {
    requestId: crypto.randomUUID(),
    reason: 'Referral reward payout',
    action: 'reward.propose',
    target: u.id,
    data: {
      rewardKind: 'referral',
      rewardId: 'rew-case-2',
      accountId: 'real',
      reference: 'ref-payout-case-2'
    },
    revision: 0
  });
  await controlAction(staffChecker, {
    requestId: crypto.randomUUID(),
    reason: 'Approve referral reward',
    action: 'finance.approve',
    target: refProp.approvalId,
    revision: 0
  });

  // Verify referral payout credited to spark doc
  const sparkAfterReward = await getSparkAccount(u.id);
  assert.equal(sparkAfterReward.balanceCents, 8000);

  // 2. Admin Adjust of +$20 (+2,000 cents)
  const adjProp = await controlAction(staffMaker, {
    requestId: crypto.randomUUID(),
    reason: 'Admin adjustment proposal',
    action: 'finance.propose',
    target: u.id,
    data: {
      uid: u.id,
      accountId: 'real',
      deltaCents: 2000,
      reference: 'adj-case-2'
    },
    revision: 0
  });
  await controlAction(staffChecker, {
    requestId: crypto.randomUUID(),
    reason: 'Approve admin adjustment',
    action: 'finance.approve',
    target: adjProp.approvalId,
    revision: 0
  });

  // Verify balance is now exactly 8,000 + 2,000 = 10,000 cents ($100)
  const sparkAfterAdj = await getSparkAccount(u.id);
  assert.equal(sparkAfterAdj.balanceCents, 10000);

  // 3. Contracts join for full 10,000 cents
  // Proves contracts.ts reads the SAME doc that referral payout and admin adjust changed!
  const published = await publish(adminUser, {
    title: 'Case 2 Contract',
    asset: 'ETHUSD',
    direction: 'BUY',
    durationSec: 60,
    settlementBps: 500,
    eligibility: 'all',
    opensAt: now - 1000,
    closesAt: now + 3600000
  }, now);

  const joinRes = await join(u, {
    code: published.code,
    amountCents: 10000,
    contractHash: published.hash,
    confirmed: true,
    accountId: 'real'
  }, now + 200);
  assert.equal(joinRes.reused, false);

  const sparkAfterJoin = await getSparkAccount(u.id);
  assert.equal(sparkAfterJoin.balanceCents, 0);
  assert.equal(sparkAfterJoin.reservedCents, 10000);

  // Confirm state() also reads from sparkTradingAccounts
  const userState = await state(u, now + 300);
  assert.equal(userState.balanceCents, 0);
  assert.equal(userState.reservedCents, 10000);
});

// CASE 3: 50 concurrent joins of the full balance -> exactly 1 succeeds
test('Case 3: 50 concurrent joins of the full balance -> exactly 1 succeeds', async () => {
  const u = {
    id: 'user-case-3',
    email: 'case3@example.test',
    name: 'Case 3 User',
    verified: true,
    authTime: Math.floor(Date.now() / 1000)
  };
  const now = Date.now();

  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, displayName: u.name, disabled: false, role: 'user' });
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).set({
    ownerId: u.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0
  });
  await db.doc(`sparkAccountSelections/${u.id}`).set({ accountId: 'real' });
  await db.doc(`orinAccounts/${u.id}`).set({
    id: u.id,
    tier: 'standard',
    profile: { closureStatus: 'open' },
    accepted_at: now
  });

  // Fund user 3 with $500 (50,000 cents)
  await recordConfirmedDeposit({
    eventId: 'dep-case-3-500',
    uid: u.id,
    accountId: 'real',
    currency: 'USD',
    cents: 50000,
    eligible: true
  });

  // Publish 50 distinct contracts
  const contracts = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      publish(adminUser, {
        title: `Concurrent Contract ${i + 1}`,
        asset: 'BTCUSD',
        direction: 'BUY',
        durationSec: 60,
        settlementBps: 100,
        eligibility: 'all',
        opensAt: now - 1000,
        closesAt: now + 3600000
      }, now + i)
    )
  );

  // Attempt 50 concurrent joins each for the full balance (50,000 cents)
  const results = await Promise.allSettled(
    contracts.map((c) =>
      join(u, {
        code: c.code,
        amountCents: 50000,
        contractHash: c.hash,
        confirmed: true,
        accountId: 'real'
      }, now + 1000)
    )
  );

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly 1 concurrent join must succeed');
  assert.equal(rejected.length, 49, 'Exactly 49 concurrent joins must fail');

  // Verify all rejections failed with insufficient balance (409) or transaction contention abort
  for (const r of rejected) {
    const isInsufficient = r.reason.status === 409 && /الرصيد المتاح غير كافٍ/.test(r.reason.message);
    const isContention = r.reason.code === 10 || /contention|aborted/i.test(r.reason.message || '');
    assert(isInsufficient || isContention, `Rejected join reason must be 409 insufficient balance or contention abort: ${r.reason}`);
  }

  // Account balance must now be 0, reserved 50,000
  const spark = await getSparkAccount(u.id);
  assert.equal(spark.balanceCents, 0);
  assert.equal(spark.reservedCents, 50000);
});

// CASE 4: same IPN 10x -> credited once
test('Case 4: same IPN 10x -> credited once', async () => {
  const u = {
    id: 'user-case-4',
    email: 'case4@example.test',
    name: 'Case 4 User',
    verified: true,
    authTime: Math.floor(Date.now() / 1000)
  };

  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, displayName: u.name, disabled: false, role: 'user' });
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).set({
    ownerId: u.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0
  });

  // Create deposit order
  const deposit = await service.create(u, {
    accountId: 'real',
    requestId: 'case-4-deposit-req',
    amountCents: 100000,
    coin: 'usdttrc20'
  });

  const paymentObj = providerPayments.get(deposit.paymentId);
  Object.assign(paymentObj, {
    payment_status: 'finished',
    actually_paid: '50'
  });

  const ipnBody = {
    order_id: deposit.id,
    payment_id: deposit.paymentId,
    payment_status: 'finished'
  };
  const signature = sign(ipnBody);

  // Send the same IPN notification 10x concurrently
  await Promise.all(
    Array.from({ length: 10 }, () => service.webhook(ipnBody, signature))
  );

  // Check balance: credited exactly once (100,000 cents, not 1,000,000)
  const spark = await getSparkAccount(u.id);
  assert.equal(spark.balanceCents, 100000, 'Same IPN 10x must credit funds exactly once');

  // Check ledger entries count in orinProgramLedger
  const ledgerSnap = await db.collection('orinProgramLedger')
    .where('uid', '==', u.id)
    .where('kind', '==', 'deposit')
    .get();
  assert.equal(ledgerSnap.size, 1, 'Only one deposit ledger entry created');
});

// CASE 5: 98% underpayment -> not credited in full
test('Case 5: 98% underpayment -> not credited in full', async () => {
  const u = {
    id: 'user-case-5',
    email: 'case5@example.test',
    name: 'Case 5 User',
    verified: true,
    authTime: Math.floor(Date.now() / 1000)
  };

  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, displayName: u.name, disabled: false, role: 'user' });
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).set({
    ownerId: u.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0
  });

  const deposit = await service.create(u, {
    accountId: 'real',
    requestId: 'case-5-underpay-req',
    amountCents: 100000,
    coin: 'usdttrc20'
  });

  // Customer underpays by 98% (paid 1 USDT instead of 50 expected)
  const paymentObj = providerPayments.get(deposit.paymentId);
  Object.assign(paymentObj, {
    payment_status: 'finished',
    actually_paid: '1'
  });

  const ipnBody = {
    order_id: deposit.id,
    payment_id: deposit.paymentId,
    payment_status: 'finished'
  };
  await service.webhook(ipnBody, sign(ipnBody));

  // Verify status is held in review and NOT credited in full
  const depDoc = (await db.doc(`orinDeposits/${deposit.id}`).get()).data();
  assert.equal(depDoc.status, 'review');
  assert.equal(depDoc.credited, false);
  assert.equal(depDoc.reviewReason, 'amount_mismatch');

  // Verify wallet balance remained 0
  const spark = await getSparkAccount(u.id);
  assert.equal(spark.balanceCents, 0, '98% underpayment must NOT credit wallet');
});

// CASE 6: admin adjust below zero -> rejected
test('Case 6: admin adjust below zero -> rejected', async () => {
  const u = {
    id: 'user-case-6',
    email: 'case6@example.test',
    name: 'Case 6 User',
    verified: true,
    authTime: Math.floor(Date.now() / 1000)
  };

  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, displayName: u.name, disabled: false, role: 'user' });
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).set({
    ownerId: u.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0
  });

  await recordConfirmedDeposit({
    eventId: 'dep-case-6-100',
    uid: u.id,
    accountId: 'real',
    currency: 'USD',
    cents: 10000,
    eligible: true
  });

  // Propose adjustment that would put balance below zero (delta: -20,000 cents on 10,000 balance)
  await assert.rejects(
    controlAction(staffMaker, {
      requestId: crypto.randomUUID(),
      reason: 'Propose sub-zero balance',
      action: 'finance.propose',
      target: u.id,
      data: {
        uid: u.id,
        accountId: 'real',
        deltaCents: -20000,
        reference: 'below-zero-ref'
      },
      revision: 0
    }),
    /Invalid integer amount/
  );

  // Verify balance remained 10,000 cents
  const spark = await getSparkAccount(u.id);
  assert.equal(spark.balanceCents, 10000, 'Balance must remain unchanged after rejected adjustment');
});

// CASE 7: invariant: balance + reserved == sum of ledger entries per user
test('Case 7: invariant: balance + reserved == sum of ledger entries per user across all accounts', async () => {
  const userIds = ['user-case-1', 'user-case-2', 'user-case-3', 'user-case-4', 'user-case-5', 'user-case-6'];

  for (const uid of userIds) {
    const spark = await getSparkAccount(uid);
    assert(spark, `Account for ${uid} must exist`);

    const balanceCents = spark.balanceCents ?? 0;
    const reservedCents = spark.reservedCents ?? 0;
    const ledgerSum = await getLedgerSumForUser(uid);

    assert(
      Number.isSafeInteger(balanceCents),
      `balanceCents for ${uid} must be a safe integer`
    );
    assert(
      Number.isSafeInteger(reservedCents),
      `reservedCents for ${uid} must be a safe integer`
    );
    assert(
      Number.isSafeInteger(ledgerSum),
      `ledgerSum for ${uid} must be a safe integer`
    );

    assert.equal(
      balanceCents + reservedCents,
      ledgerSum,
      `Invariant violation for ${uid}: balance (${balanceCents}) + reserved (${reservedCents}) != sum of ledger entries (${ledgerSum})`
    );
  }
});

// CASE 8: resolveTradingDoc join requires type=='real' else 409; settle uses p.account_id and throws if missing
test('Case 8: resolveTradingDoc enforces real account for join and p.account_id for settle', async () => {
  const u1 = { id: 'user-case-8-join', email: 'c8join@example.test', name: 'C8 Join', verified: true, authTime: Math.floor(Date.now() / 1000) };
  await db.doc(`users/${u1.id}`).set({ uid: u1.id, email: u1.email, role: 'user' });
  await db.doc(`orinAccounts/${u1.id}`).set({ id: u1.id, tier: 'standard', preferences: { notificationEvents: {} } });
  await db.doc(`sparkTradingAccounts/${u1.id}/accounts/demo-only`).set({ ownerId: u1.id, type: 'demo', balanceCents: 50000, reservedCents: 0 });
  await db.doc(`sparkAccountSelections/${u1.id}`).set({ accountId: 'demo-only' });

  const published = await publish(adminUser, {
    title: 'C8 Contract',
    asset: 'BTCUSD',
    direction: 'BUY',
    durationSec: 60,
    settlementBps: 100,
    opensAt: Date.now() - 5000,
    closesAt: Date.now() + 60000
  });

  // Join without real account must throw 409 (no fallback)
  await assert.rejects(
    join(u1, { code: published.code, amountCents: 1000, confirmed: true, contractHash: published.hash }),
    (err) => err.status === 409 || err.message.includes('409')
  );

  // Settle without p.account_id must throw 409
  const u2 = { id: 'user-case-8-settle', email: 'c8settle@example.test', name: 'C8 Settle', verified: true, authTime: Math.floor(Date.now() / 1000) };
  await db.doc(`users/${u2.id}`).set({ uid: u2.id, email: u2.email, role: 'user' });
  await db.doc(`orinAccounts/${u2.id}`).set({ id: u2.id, tier: 'standard', preferences: { notificationEvents: {} } });
  await db.doc(`sparkTradingAccounts/${u2.id}/accounts/real-acc`).set({ ownerId: u2.id, type: 'real', balanceCents: 50000, reservedCents: 50000 });
  await db.doc(`sparkAccountSelections/${u2.id}`).set({ accountId: 'real-acc' });

  const posId = 'pos-c8-missing-acc-id';
  await db.doc(`orinPositions/${posId}`).set({
    id: posId,
    user_id: u2.id,
    contract_id: published.id,
    amount_cents: 1000,
    result_cents: 10,
    started_at: Date.now() - 70000,
    ends_at: Date.now() - 1000,
    status: 'active'
    // p.account_id missing!
  });

  await assert.rejects(
    settle(u2, Date.now()),
    (err) => err.status === 409 || err.message.includes('409')
  );
});

// CASE 9: payments.ts tolerance 0.5% - exactly 98% rejected; 99.9% credited; 100% credited; overpay credited requested
test('Case 9: payments.ts 0.5% tolerance and min(requested, actual paid) credit', async () => {
  const u = { id: 'user-case-9', email: 'c9@example.test', name: 'C9 User', verified: true, authTime: Math.floor(Date.now() / 1000) };
  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, role: 'user' });
  await db.doc(`orinControlAccess/${u.id}`).set({ status: 'active' });
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).set({
    ownerId: u.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0
  });

  // 98% underpayment -> status 'review', not credited
  const dep98 = await service.create(u, { accountId: 'real', requestId: 'req-c9-98', amountCents: 100000, coin: 'usdttrc20' });
  const pay98 = await mockProvider.get(dep98.paymentId);
  pay98.payment_status = 'finished';
  pay98.pay_amount = '50';
  pay98.actually_paid = '49'; // 49 / 50 = 98%
  providerPayments.set(pay98.payment_id, pay98);

  const ipn98 = { payment_id: pay98.payment_id, payment_status: 'finished', order_id: dep98.id, pay_amount: '50', actually_paid: '49' };
  await service.webhook(ipn98, sign(ipn98));

  const depDoc98 = (await db.doc(`orinDeposits/${dep98.id}`).get()).data();
  assert.equal(depDoc98.status, 'review', '98% underpayment must go to review');
  assert.equal(depDoc98.credited, false, '98% underpayment must NOT be credited');

  // 99.9% payment -> credited min(requested, actual) = 99,900 cents
  const dep999 = await service.create(u, { accountId: 'real', requestId: 'req-c9-999', amountCents: 100000, coin: 'usdttrc20' });
  const pay999 = await mockProvider.get(dep999.paymentId);
  pay999.payment_status = 'finished';
  pay999.pay_amount = '50';
  pay999.actually_paid = '49.95'; // 49.95 / 50 = 99.9%
  providerPayments.set(pay999.payment_id, pay999);

  const ipn999 = { payment_id: pay999.payment_id, payment_status: 'finished', order_id: dep999.id, pay_amount: '50', actually_paid: '49.95' };
  await service.webhook(ipn999, sign(ipn999));

  const depDoc999 = (await db.doc(`orinDeposits/${dep999.id}`).get()).data();
  assert.equal(depDoc999.status, 'finished');
  assert.equal(depDoc999.credited, true);
  const spark999 = await getSparkAccount(u.id);
  assert.equal(spark999.balanceCents, 99900, '99.9% payment must credit min(requested, actual) = 99,900 cents');

  // 100% payment -> credited 100,000 cents
  const dep100 = await service.create(u, { accountId: 'real', requestId: 'req-c9-100', amountCents: 100000, coin: 'usdttrc20' });
  const pay100 = await mockProvider.get(dep100.paymentId);
  pay100.payment_status = 'finished';
  pay100.pay_amount = '50';
  pay100.actually_paid = '50';
  providerPayments.set(pay100.payment_id, pay100);

  const ipn100 = { payment_id: pay100.payment_id, payment_status: 'finished', order_id: dep100.id, pay_amount: '50', actually_paid: '50' };
  await service.webhook(ipn100, sign(ipn100));

  const spark100 = await getSparkAccount(u.id);
  assert.equal(spark100.balanceCents, 99900 + 100000, '100% payment must credit 100,000 cents');

  // Overpay 105% -> credited requested amount 100,000 cents
  const dep105 = await service.create(u, { accountId: 'real', requestId: 'req-c9-105', amountCents: 100000, coin: 'usdttrc20' });
  const pay105 = await mockProvider.get(dep105.paymentId);
  pay105.payment_status = 'finished';
  pay105.pay_amount = '50';
  pay105.actually_paid = '52.5'; // 105%
  providerPayments.set(pay105.payment_id, pay105);

  const ipn105 = { payment_id: pay105.payment_id, payment_status: 'finished', order_id: dep105.id, pay_amount: '50', actually_paid: '52.5' };
  await service.webhook(ipn105, sign(ipn105));

  const spark105 = await getSparkAccount(u.id);
  assert.equal(spark105.balanceCents, 99900 + 100000 + 100000, 'Overpay must credit requested amount 100,000 cents');
});

// CASE 10: Finance approve re-checks balance+delta>=0: balance 6000, propose -5000, user joins 3000, approve -> rejected
test('Case 10: Finance approve re-checks balance+delta>=0 (balance 6000, propose -5000, join 3000, approve rejected)', async () => {
  const u = { id: 'user-case-10', email: 'c10@example.test', name: 'C10 User', verified: true, authTime: Math.floor(Date.now() / 1000) };
  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, role: 'user' });
  await db.doc(`orinAccounts/${u.id}`).set({ id: u.id, tier: 'standard', preferences: { notificationEvents: {} } });
  await db.doc(`orinControlAccess/${u.id}`).set({ status: 'active' });
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).set({
    ownerId: u.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 6000,
    reservedCents: 0
  });
  await db.doc(`sparkAccountSelections/${u.id}`).set({ accountId: 'real' });

  // 1. Propose -5000 (at propose time, 6000 - 5000 = 1000 >= 0, succeeds)
  const propRes = await controlAction(staffMaker, {
    requestId: 'req-c10-prop',
    reason: 'Propose -5000 deduction',
    action: 'finance.propose',
    target: u.id,
    data: { uid: u.id, accountId: 'real', deltaCents: -5000, reference: 'ref-c10-prop' },
    revision: 0
  });

  // 2. User joins a contract for 3000 -> balance becomes 3000, reserved becomes 3000
  const pub = await publish(adminUser, {
    title: 'C10 Join Contract',
    asset: 'ETHUSD',
    direction: 'BUY',
    durationSec: 60,
    settlementBps: 100,
    opensAt: Date.now() - 5000,
    closesAt: Date.now() + 60000
  });
  await join(u, { code: pub.code, amountCents: 3000, confirmed: true, contractHash: pub.hash });

  const sparkAfterJoin = await getSparkAccount(u.id);
  assert.equal(sparkAfterJoin.balanceCents, 3000, 'Balance after join must be 3000 cents');

  // 3. Approve adjustment: at approve time, 3000 + (-5000) = -2000 < 0! Must be rejected!
  await assert.rejects(
    controlAction(staffChecker, {
      requestId: 'req-c10-app',
      reason: 'Approve -5000 deduction',
      action: 'finance.approve',
      target: propRes.approvalId,
      revision: 0
    }),
    (err) => err.status === 409 || err.message.includes('409') || /Balance|Insufficient|negative/i.test(err.message)
  );
});

// CASE 11: Reward payout: paying same reward through both paths fails on second
test('Case 11: Reward payout guards on status transition so paying same reward twice fails on second attempt', async () => {
  const referrer = { id: 'user-c11-ref1', email: 'c11ref1@example.test', name: 'C11 Referrer', verified: true, authTime: Math.floor(Date.now() / 1000) };
  const referred = { id: 'user-c11-ref2', email: 'c11ref2@example.test', name: 'C11 Referred', verified: true, authTime: Math.floor(Date.now() / 1000) };

  await db.doc(`users/${referrer.id}`).set({ uid: referrer.id, email: referrer.email, role: 'user' });
  await db.doc(`users/${referred.id}`).set({ uid: referred.id, email: referred.email, role: 'user' });
  await db.doc(`orinVerifiedCustomers/${referrer.id}`).set({ verified: true, customerKey: 'key-c11-1' });
  await db.doc(`orinVerifiedCustomers/${referred.id}`).set({ verified: true, customerKey: 'key-c11-2' });
  await db.doc(`sparkTradingAccounts/${referrer.id}/accounts/real`).set({
    ownerId: referrer.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0
  });
  await db.doc(`orinProgramMembers/${referrer.id}`).set({ pendingCents: 5000, paidCents: 0 });
  await db.doc(`orinProgramMembers/${referred.id}`).set({ referralStatus: 'approved' });

  const evId = 'ev-c11-qualified';
  await db.doc(`orinProgramEvidence/${evId}`).set({ uid: referred.id, kind: 'referral_qualified', termsVersion: 1, revoked: false });

  const rewId = 'rew-c11-dup';
  await db.doc(`orinReferralRewards/${rewId}`).set({
    id: rewId,
    referrerId: referrer.id,
    referredId: referred.id,
    status: 'approved',
    amountCents: 5000,
    termsVersion: 1,
    evidenceId: evId,
    revision: 0
  });

  // Payout 1 via Finance Approval
  const propRes = await controlAction(staffMaker, {
    requestId: 'req-c11-prop-rew',
    reason: 'Propose reward payout',
    action: 'reward.propose',
    data: { rewardKind: 'referral', rewardId: rewId, accountId: 'real', reference: 'ref-c11-payout' },
    revision: 0
  });

  await controlAction(staffChecker, {
    requestId: 'req-c11-app-rew',
    reason: 'Approve reward payout',
    action: 'finance.approve',
    target: propRes.approvalId,
    revision: 0
  });

  const rewDoc = (await db.doc(`orinReferralRewards/${rewId}`).get()).data();
  assert.equal(rewDoc.status, 'paid', 'Reward status must be paid');

  // Second payout attempt must fail
  await assert.rejects(
    controlAction(staffMaker, {
      requestId: 'req-c11-prop-rew-2',
      reason: 'Propose reward second time',
      action: 'reward.propose',
      data: { rewardKind: 'referral', rewardId: rewId, accountId: 'real', reference: 'ref-c11-payout-2' },
      revision: 0
    }),
    (err) => err.status === 409 || err.message.includes('409')
  );
});

// CASE 12: store.ts bootstrap does not write balance fields to orinAccounts
test('Case 12: store.ts bootstrap does not write balance fields to orinAccounts', async () => {
  const u = { id: 'user-case-12', email: 'c12@example.test', name: 'C12 User', verified: true, authTime: Math.floor(Date.now() / 1000) };
  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, displayName: u.name, role: 'user' });

  // Call state which bootstraps the account
  const s = await state(u);
  assert.ok(s, 'state must succeed');

  const accDoc = (await db.doc(`orinAccounts/${u.id}`).get()).data();
  assert.ok(accDoc, 'orinAccounts doc must exist');
  assert.equal(accDoc.balanceCents, undefined, 'balanceCents must NOT exist in orinAccounts');
  assert.equal(accDoc.reservedCents, undefined, 'reservedCents must NOT exist in orinAccounts');
  assert.equal(accDoc.realizedCents, undefined, 'realizedCents must NOT exist in orinAccounts');
});

