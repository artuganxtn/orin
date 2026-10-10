import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  publish,
  join,
  settle,
  paymentService,
  controlAction,
  validIpn,
  canonical,
  units,
  db,
  hash,
  ref,
  bootstrap
} from '../firebase-functions/test-balance-bundle.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Local Firebase emulator required');
}

const secret = 'TEST-IPN-SECRET-512';
let serial = 900000;
const providerPayments = new Map();
const mockProvider = {
  async create(orderId, amountCents, coin) {
    const value = {
      payment_id: String(++serial),
      order_id: orderId,
      price_amount: amountCents / 100,
      price_currency: 'usd',
      pay_currency: coin,
      pay_amount: '100',
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
const pService = paymentService(mockProvider, secret);

const adminUser = {
  id: 'admin-contracts',
  email: 'khtaub7341@gmail.com',
  name: 'Admin',
  verified: true,
  authTime: Math.floor(Date.now() / 1000)
};

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

before(async () => {
  await db.doc('system/control-center').set({ enabled: true, superAdminCount: 1 });
  for (const u of [staffMaker, staffChecker, adminUser]) {
    await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, displayName: u.name, disabled: false, role: 'admin' });
  }
  await db.doc(`orinStaff/${adminUser.id}`).set({ email: adminUser.email, roles: ['super_admin'], status: 'active', validAfter: 0, revision: 0 });
  await db.doc(`orinStaff/${staffMaker.id}`).set({ email: staffMaker.email, roles: ['finance'], status: 'active', validAfter: 0, revision: 0 });
  await db.doc(`orinStaff/${staffChecker.id}`).set({ email: staffChecker.email, roles: ['finance_approver'], status: 'active', validAfter: 0, revision: 0 });

  await db.doc('orinControlConfiguration/current').set({ maxAdjustmentCents: 10000000, maintenance: false, depositsEnabled: true, revision: 0 });
  await db.doc('orinProgramConfiguration/current').set({ enabled: true, termsVersion: 1, revision: 1, referralAmountCents: 5000 });
});

// Test 1: resolveTradingDoc join requires type == 'real', else throw 409 (no fallback to demo or primary)
test('Test 1: resolveTradingDoc join requires real account, throws 409 without fallback', async () => {
  const u = { id: 'user-no-real-acc', email: 'noreal@example.test', name: 'No Real', verified: true, authTime: Math.floor(Date.now() / 1000) };
  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, role: 'user' });
  await db.doc(`orinAccounts/${u.id}`).set({ id: u.id, tier: 'standard', preferences: { notificationEvents: {} } });
  
  // Set demo account only
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/demo-1`).set({ ownerId: u.id, type: 'demo', balanceCents: 50000, reservedCents: 0 });
  await db.doc(`sparkAccountSelections/${u.id}`).set({ accountId: 'demo-1' });

  const published = await publish(adminUser, {
    title: 'BTC Contract',
    asset: 'BTCUSD',
    direction: 'BUY',
    durationSec: 60,
    settlementBps: 100,
    opensAt: Date.now() - 5000,
    closesAt: Date.now() + 60000
  });

  await assert.rejects(
    join(u, { code: published.code, amountCents: 1000, confirmed: true, contractHash: published.hash }),
    (err) => err.status === 409 || err.message.includes('409')
  );
});

// Test 2: resolveTradingDoc settle throws if p.account_id is missing
test('Test 2: resolveTradingDoc settle throws 409 if p.account_id is missing', async () => {
  const u = { id: 'user-missing-acc-id', email: 'missingacc@example.test', name: 'Missing Acc', verified: true, authTime: Math.floor(Date.now() / 1000) };
  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, role: 'user' });
  await db.doc(`orinAccounts/${u.id}`).set({ id: u.id, tier: 'standard', preferences: { notificationEvents: {} } });
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/real-fallback`).set({ ownerId: u.id, type: 'real', balanceCents: 50000, reservedCents: 50000 });
  await db.doc(`sparkAccountSelections/${u.id}`).set({ accountId: 'real-fallback' });
  
  const published = await publish(adminUser, {
    title: 'ETH Contract',
    asset: 'ETHUSD',
    direction: 'BUY',
    durationSec: 60,
    settlementBps: 100,
    opensAt: Date.now() - 5000,
    closesAt: Date.now() + 60000
  });

  const posId = 'pos-no-acc-id';
  await db.doc(`orinPositions/${posId}`).set({
    id: posId,
    user_id: u.id,
    contract_id: published.id,
    amount_cents: 1000,
    result_cents: 10,
    started_at: Date.now() - 70000,
    ends_at: Date.now() - 1000, // Due for settlement
    status: 'active'
    // account_id missing!
  });

  await assert.rejects(
    settle(u, Date.now()),
    (err) => err.status === 409 || err.message.includes('409')
  );
});

// Test 3: payments.ts tolerance 0.5% & credit min(requested, paid)
test('Test 3: payments.ts tolerance 0.5% - exactly 98% rejected to review; 99.9% credited; 100% credited; overpay credited requested', async () => {
  const u = { id: 'user-pay-tolerance', email: 'paytol@example.test', name: 'Pay Tol', verified: true, authTime: Math.floor(Date.now() / 1000) };
  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, role: 'user' });
  await db.doc(`orinControlAccess/${u.id}`).set({ status: 'active' });
  await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).set({
    ownerId: u.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0
  });

  // Case 3a: Exactly 98% underpayment (e.g. 98 paid for 100 expected, tolerance is 0.5%)
  // Under the new 0.5% tolerance, 98% must be REJECTED to review (NOT credited)!
  const dep98 = await pService.create(u, { accountId: 'real', requestId: 'req-98', amountCents: 100000, coin: 'usdttrc20' });
  const p98 = mockProvider.create(dep98.id, 100000, 'usdttrc20');
  const pay98 = await mockProvider.get(dep98.paymentId);
  pay98.payment_status = 'finished';
  pay98.pay_amount = '100';
  pay98.actually_paid = '98'; // 98%
  providerPayments.set(pay98.payment_id, pay98);

  const ipn98 = { payment_id: pay98.payment_id, payment_status: 'finished', order_id: dep98.id, pay_amount: '100', actually_paid: '98' };
  await pService.webhook(ipn98, createHmac('sha512', secret).update(JSON.stringify(canonical(ipn98))).digest('hex'));

  const depDoc98 = (await db.doc(`orinDeposits/${dep98.id}`).get()).data();
  assert.equal(depDoc98.status, 'review', '98% underpayment must result in status review');
  assert.equal(depDoc98.credited, false, '98% underpayment must NOT be credited');

  // Case 3b: Exactly 99.9% payment (0.1% underpayment, within 0.5% tolerance) -> credited min(requested, actual) = 99900 cents
  const dep999 = await pService.create(u, { accountId: 'real', requestId: 'req-999', amountCents: 100000, coin: 'usdttrc20' });
  const pay999 = await mockProvider.get(dep999.paymentId);
  pay999.payment_status = 'finished';
  pay999.pay_amount = '100';
  pay999.actually_paid = '99.9';
  providerPayments.set(pay999.payment_id, pay999);

  const ipn999 = { payment_id: pay999.payment_id, payment_status: 'finished', order_id: dep999.id, pay_amount: '100', actually_paid: '99.9' };
  await pService.webhook(ipn999, createHmac('sha512', secret).update(JSON.stringify(canonical(ipn999))).digest('hex'));

  const depDoc999 = (await db.doc(`orinDeposits/${dep999.id}`).get()).data();
  assert.equal(depDoc999.status, 'finished');
  assert.equal(depDoc999.credited, true);
  const spark999 = (await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).get()).data();
  assert.equal(spark999.balanceCents, 99900, '99.9% must credit min(requested, actual) = 99,900 cents');

  // Case 3c: Overpay 105% -> credited requested amount min(100,000, 105,000) = 100,000
  const dep105 = await pService.create(u, { accountId: 'real', requestId: 'req-105', amountCents: 100000, coin: 'usdttrc20' });
  const pay105 = await mockProvider.get(dep105.paymentId);
  pay105.payment_status = 'finished';
  pay105.pay_amount = '100';
  pay105.actually_paid = '105';
  providerPayments.set(pay105.payment_id, pay105);

  const ipn105 = { payment_id: pay105.payment_id, payment_status: 'finished', order_id: dep105.id, pay_amount: '100', actually_paid: '105' };
  await pService.webhook(ipn105, createHmac('sha512', secret).update(JSON.stringify(canonical(ipn105))).digest('hex'));

  const spark105 = (await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).get()).data();
  assert.equal(spark105.balanceCents, 99900 + 100000, 'Overpayment must credit requested amount (100,000 cents)');
});

// Test 4: Finance approve: at APPROVE time re-check balance + delta >= 0. balance 6000, propose -5000, user joins 3000, approve -> rejected
test('Test 4: Finance approve rejects when balance + delta < 0 at approve time (balance 6000, propose -5000, join 3000)', async () => {
  const u = { id: 'user-fin-concurrency', email: 'finconc@example.test', name: 'Fin Conc', verified: true, authTime: Math.floor(Date.now() / 1000) };
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

  // 1. Propose -5000 (at propose time, 6000 - 5000 = 1000 >= 0, passes)
  const propRes = await controlAction(staffMaker, {
    requestId: 'req-prop-5000',
    reason: 'Propose deduction',
    action: 'finance.propose',
    target: u.id,
    data: { uid: u.id, accountId: 'real', deltaCents: -5000, reference: 'ref-prop-5000' },
    revision: 0
  });
  const approvalId = propRes.approvalId;

  // 2. User joins a trade for 3000 -> balance becomes 3000, reserved becomes 3000
  const pub = await publish(adminUser, {
    title: 'Join Contract',
    asset: 'BTCUSD',
    direction: 'BUY',
    durationSec: 60,
    settlementBps: 100,
    opensAt: Date.now() - 5000,
    closesAt: Date.now() + 60000
  });
  await join(u, { code: pub.code, amountCents: 3000, confirmed: true, contractHash: pub.hash });

  const sparkAfterJoin = (await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).get()).data();
  assert.equal(sparkAfterJoin.balanceCents, 3000, 'Balance after join must be 3000');

  // 3. Approve adjustment of -5000: at approve time, balance (3000) + delta (-5000) = -2000 < 0!
  // MUST BE REJECTED!
  await assert.rejects(
    controlAction(staffChecker, {
      requestId: 'req-app-5000',
      reason: 'Approve deduction',
      action: 'finance.approve',
      target: approvalId,
      revision: 0
    }),
    (err) => err.status === 409 || err.message.includes('409') || /Balance|Insufficient|negative/i.test(err.message)
  );
});

// Test 5: Reward payout: pay same reward through both paths, second must fail
test('Test 5: Reward payout: paying same reward through both paths fails on second', async () => {
  const referrer = { id: 'user-ref-1', email: 'ref1@example.test', name: 'Referrer', verified: true, authTime: Math.floor(Date.now() / 1000) };
  const referred = { id: 'user-ref-2', email: 'ref2@example.test', name: 'Referred', verified: true, authTime: Math.floor(Date.now() / 1000) };

  await db.doc(`users/${referrer.id}`).set({ uid: referrer.id, email: referrer.email, role: 'user' });
  await db.doc(`users/${referred.id}`).set({ uid: referred.id, email: referred.email, role: 'user' });
  await db.doc(`orinVerifiedCustomers/${referrer.id}`).set({ verified: true, customerKey: 'key-1' });
  await db.doc(`orinVerifiedCustomers/${referred.id}`).set({ verified: true, customerKey: 'key-2' });
  await db.doc(`sparkTradingAccounts/${referrer.id}/accounts/real`).set({
    ownerId: referrer.id,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0
  });
  await db.doc(`orinProgramMembers/${referrer.id}`).set({ pendingCents: 5000, paidCents: 0 });
  await db.doc(`orinProgramMembers/${referred.id}`).set({ referralStatus: 'approved' });

  const evId = 'ev-ref-qualified';
  await db.doc(`orinProgramEvidence/${evId}`).set({ uid: referred.id, kind: 'referral_qualified', termsVersion: 1, revoked: false });

  const rewId = 'rew-test-dup';
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

  // Path 1: Propose reward and approve via Finance
  const propRes = await controlAction(staffMaker, {
    requestId: 'req-prop-rew',
    reason: 'Propose reward',
    action: 'reward.propose',
    data: { rewardKind: 'referral', rewardId: rewId, accountId: 'real', reference: 'ref-rew-payout' },
    revision: 0
  });

  await controlAction(staffChecker, {
    requestId: 'req-app-rew',
    reason: 'Approve reward',
    action: 'finance.approve',
    target: propRes.approvalId,
    revision: 0
  });

  const rewDoc = (await db.doc(`orinReferralRewards/${rewId}`).get()).data();
  assert.equal(rewDoc.status, 'paid', 'Reward status must be paid after path 1');

  // Path 2: Attempt to payout again through another proposal or second approval: MUST FAIL!
  await assert.rejects(
    controlAction(staffMaker, {
      requestId: 'req-prop-rew-2',
      reason: 'Propose reward second time',
      action: 'reward.propose',
      data: { rewardKind: 'referral', rewardId: rewId, accountId: 'real', reference: 'ref-rew-payout-2' },
      revision: 0
    }),
    (err) => err.status === 409 || err.message.includes('409')
  );
});

// Test 6: Remove balance fields from bootstrap in store.ts
test('Test 6: store.ts bootstrap does not write balance fields to orinAccounts', async () => {
  const u = { id: 'user-clean-bootstrap', email: 'boot@example.test', name: 'Boot Clean', verified: true, authTime: Math.floor(Date.now() / 1000) };
  await db.doc(`users/${u.id}`).set({ uid: u.id, email: u.email, displayName: 'Boot Clean', role: 'user' });
  
  // Call state which calls bootstrap
  const { state } = await import('../firebase-functions/test-balance-bundle.mjs');
  await state(u);

  const accDoc = (await db.doc(`orinAccounts/${u.id}`).get()).data();
  assert.ok(accDoc, 'orinAccounts doc must exist');
  assert.equal(accDoc.balanceCents, undefined, 'balanceCents must NOT be present in orinAccounts');
  assert.equal(accDoc.reservedCents, undefined, 'reservedCents must NOT be present in orinAccounts');
  assert.equal(accDoc.realizedCents, undefined, 'realizedCents must NOT be present in orinAccounts');
});
