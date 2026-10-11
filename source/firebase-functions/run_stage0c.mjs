import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  db,
  ref,
  publish,
  join,
  settle,
  paymentService,
  controlAction,
  programAction,
  adminPrograms,
  hash,
  canonical,
  computeCustomerKey
} from './test-balance-bundle.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('ERROR: FIRESTORE_EMULATOR_HOST is not set!');
  process.exit(1);
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
      pay_amount: '1000',
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

const adminUser = { id: 'admin-super-uid', email: 'superadmin@orin.test', verified: true, name: 'Super Admin' };
const financeMaker = { id: 'admin-maker-uid', email: 'maker@orin.test', verified: true, name: 'Finance Maker' };
const financeChecker = { id: 'admin-checker-uid', email: 'checker@orin.test', verified: true, name: 'Finance Checker' };

const userA = { id: 'usr-alice-100', email: 'alice@orin.test', name: 'Alice Trader' };
const userB = { id: 'usr-bob-200', email: 'bob@orin.test', name: 'Bob Friend' };

async function setupSystem() {
  const now = Date.now();
  for (const staff of [adminUser, financeMaker, financeChecker]) {
    await db.doc(`users/${staff.id}`).set({ uid: staff.id, email: staff.email, displayName: staff.name, role: 'admin', disabled: false, createdAt: now, updatedAt: now });
  }
  await db.doc(`orinStaff/${adminUser.id}`).set({ roles: ['super_admin'], email: adminUser.email, status: 'active', validAfter: now });
  await db.doc(`orinStaff/${financeMaker.id}`).set({ roles: ['finance'], email: financeMaker.email, status: 'active', validAfter: now });
  await db.doc(`orinStaff/${financeChecker.id}`).set({ roles: ['finance', 'finance_approver'], email: financeChecker.email, status: 'active', validAfter: now });

  const progConfig = {
    enabled: true, termsVersion: 'v1.0', bonusAmountCents: 10000, referralAmountCents: 8000,
    firstDepositCents: 100000, requireKyc: true, bonusDurationDays: 30, bonusProfitLimitCents: 20000,
    eligibleAssets: ['BTCUSD', 'ETHUSD'], referralCriteria: 'Standard terms', activeTeamCriteria: 'Active team terms',
    activityPeriod: 'monthly', bonusTradingTerms: 'Trading terms', agencyCriteria: 'Agency terms', badgeCriteria: {},
    levels: [
      { level: 1, direct: 3, active: 3, bps: 75, capCents: 2000 },
      { level: 2, direct: 5, active: 15, bps: 125, capCents: 6000 },
      { level: 3, direct: 8, active: 40, bps: 175, capCents: 15000 },
      { level: 4, direct: 10, active: 120, bps: 225, capCents: 35000 },
      { level: 5, direct: 15, active: 300, bps: 275, capCents: 75000 },
      { level: 6, direct: 25, active: 700, bps: 325, capCents: 150000 }
    ],
    revision: 1
  };
  await db.doc('orinProgramConfiguration/current').set(progConfig);
  await db.doc('orinProgramConfigurationHistory/1').set(progConfig);
  await db.doc('orinControlConfiguration/current').set({
    maintenance: false, tradingEnabled: true, depositsEnabled: true, withdrawalsEnabled: true,
    referralsEnabled: true, bonusEnabled: true, maxAdjustmentCents: 5000000, updatedAt: now
  });
  await db.doc('orinConfiguration/markets').set({
    configuration: { defaultSymbol: 'BTC-USD', enabledSymbols: ['BTC-USD'] }, revision: 1, updatedAt: now
  });
}

async function createRealAccount(user) {
  const now = Date.now();
  await db.doc(`users/${user.id}`).set({ uid: user.id, email: user.email, displayName: user.name, role: 'user', disabled: false, createdAt: now, updatedAt: now });
  await db.doc(`orinAccounts/${user.id}`).set({ id: user.id, tier: 'standard', balanceCents: 0, reservedCents: 0, realizedCents: 0, revision: 1, updated_at: now });

  // Use real admin account.create action:
  const res = await controlAction(adminUser, {
    action: 'account.create', target: user.id, requestId: 'create-acc-' + user.id, reason: 'Real onboarding account',
    data: { type: 'real' }
  });
  const accountId = res.accountId;
  await db.doc(`sparkAccountSelections/${user.id}`).set({ accountId, updatedAt: now });
  return accountId;
}

async function main() {
  await setupSystem();
  const aliceAccId = await createRealAccount(userA);
  const bobAccId = await createRealAccount(userB);

  // 1. DEPOSIT Alice $1000
  const depAlice = await pService.create(userA, { accountId: aliceAccId, requestId: 'req-dep-alice-1', amountCents: 100000, coin: 'usdttrc20' });
  const ipnPaymentA = await mockProvider.get(depAlice.paymentId);
  ipnPaymentA.payment_status = 'finished'; ipnPaymentA.actually_paid = '1000'; ipnPaymentA.pay_amount = '1000';
  providerPayments.set(ipnPaymentA.payment_id, ipnPaymentA);
  const ipnA = { payment_id: ipnPaymentA.payment_id, payment_status: 'finished', order_id: depAlice.id, pay_amount: '1000', actually_paid: '1000' };
  const sigA = createHmac('sha512', secret).update(JSON.stringify(canonical(ipnA))).digest('hex');
  await pService.webhook(ipnA, sigA);

  // 2. JOIN 60s Contract ($100 = 10000 cents)
  const nowContract = Date.now();
  const pub = await publish(adminUser, {
    title: 'BTC 60s Standard', asset: 'BTCUSD', direction: 'BUY', durationSec: 60, settlementBps: 500,
    opensAt: nowContract, closesAt: nowContract + 86400000, eligibility: 'all'
  }, nowContract);
  const joinRes = await join(userA, {
    accountId: aliceAccId, amountCents: 10000, code: pub.code, contractHash: pub.hash, confirmed: true
  }, nowContract);

  // 3. SETTLE 60s Contract (+5% = +500 cents profit)
  await settle(userA, nowContract + 70000);

  // 4. KYC VERIFY Alice (via real normalized HMAC, no customerKey in request!)
  await db.doc(`orinKycRequests/kyc-${userA.id}`).set({
    id: `kyc-${userA.id}`, uid: userA.id, fullName: userA.name, documentType: 'passport',
    idNumber: 'P 1234 5678', country: 'sa', documentImage: 'data:image/jpeg;base64,data',
    documentIds: ['doc-real-1'], status: 'review', reason: '', reviewedBy: '',
    userEmail: userA.email, userDisplayName: userA.name, revision: 0, createdAt: Date.now(), updatedAt: Date.now()
  });
  await controlAction(financeMaker, {
    requestId: 'req-kyc-verify-alice', action: 'customer.verify', target: userA.id,
    reason: 'Verified National Passport ID', data: {} // No customerKey!
  });

  // 5. FINANCE ADJUSTMENT: CREDIT (+5000 cents)
  const propCredit = await controlAction(financeMaker, {
    requestId: 'req-fin-prop-credit-1', action: 'finance.propose', target: userA.id, reason: 'Adjustment credit promo',
    data: { uid: userA.id, accountId: aliceAccId, deltaCents: 5000, reference: 'ref-fin-credit-1' }
  });
  await controlAction(financeChecker, {
    requestId: 'req-fin-app-credit-1', action: 'finance.approve', target: propCredit.approvalId,
    reason: 'Approved credit promo', data: {}
  });

  // Adjust deposit timestamp so debit is permitted (>20 days)
  const depLedgerSnap = await db.collection('orinProgramLedger').where('uid', '==', userA.id).where('kind', '==', 'deposit').get();
  for (const d of depLedgerSnap.docs) {
    await d.ref.update({ createdAt: Date.now() - 25 * 86400000 });
  }

  // 6. FINANCE ADJUSTMENT: DEBIT (-1000 cents)
  const propDebit = await controlAction(financeMaker, {
    requestId: 'req-fin-prop-debit-1', action: 'finance.propose', target: userA.id, reason: 'Maintenance fee debit',
    data: { uid: userA.id, accountId: aliceAccId, deltaCents: -1000, reference: 'ref-fin-debit-1' }
  });
  await controlAction(financeChecker, {
    requestId: 'req-fin-app-debit-1', action: 'finance.approve', target: propDebit.approvalId,
    reason: 'Approved fee debit', data: {}
  });

  // 7. REFERRAL: KYC Bob, Enroll Alice & Bob, Deposit Bob, Propose & Approve Reward (+8000 cents)
  await db.doc(`orinKycRequests/kyc-${userB.id}`).set({
    id: `kyc-${userB.id}`, uid: userB.id, fullName: userB.name, documentType: 'id_card',
    idNumber: 'B 9876 5432', country: 'SA', documentImage: 'data:image/jpeg;base64,data',
    documentIds: ['doc-real-2'], status: 'review', reason: '', reviewedBy: '',
    userEmail: userB.email, userDisplayName: userB.name, revision: 0, createdAt: Date.now(), updatedAt: Date.now()
  });
  await controlAction(financeMaker, {
    requestId: 'req-kyc-verify-bob', action: 'customer.verify', target: userB.id,
    reason: 'Verified Bob ID Card', data: {}
  });
  const enrollAlice = await programAction(userA, { action: 'enroll', requestId: 'enroll-alice' });
  await programAction(userB, { action: 'enroll', referralCode: enrollAlice.member.code, requestId: 'enroll-bob' });

  const depBob = await pService.create(userB, { accountId: bobAccId, requestId: 'req-dep-bob-1', amountCents: 100000, coin: 'usdtbsc' });
  const ipnPaymentB = await mockProvider.get(depBob.paymentId);
  ipnPaymentB.payment_status = 'finished'; ipnPaymentB.actually_paid = '1000'; ipnPaymentB.pay_amount = '1000';
  providerPayments.set(ipnPaymentB.payment_id, ipnPaymentB);
  const ipnB = { payment_id: ipnPaymentB.payment_id, payment_status: 'finished', order_id: depBob.id, pay_amount: '1000', actually_paid: '1000' };
  const sigB = createHmac('sha512', secret).update(JSON.stringify(canonical(ipnB))).digest('hex');
  await pService.webhook(ipnB, sigB);

  const rewProp = await controlAction(financeMaker, {
    requestId: 'req-reward-prop-1', action: 'reward.propose', target: userA.id, reason: 'Referral reward for Alice',
    data: { rewardKind: 'referral', rewardId: userB.id, accountId: aliceAccId, reference: 'ref-reward-' + userB.id }
  });
  await controlAction(financeChecker, {
    requestId: 'req-reward-app-1', action: 'finance.approve', target: rewProp.approvalId,
    reason: 'Approved referral payout', data: {}
  });

  // 8. TEAM ACTIVITY REWARD (+2000 cents)
  const periodId = '2026-10';
  await db.doc(`orinEligibleRevenue/${userA.id}_${periodId}`).set({
    id: `${userA.id}_${periodId}`, uid: userA.id, periodId: periodId, netRevenueCents: 200000,
    direct: 5, activeTeam: 20, finalized: true, termsVersion: 'v1.0', configurationRevision: 1, createdAt: Date.now()
  });
  const teamProp = await controlAction(financeMaker, {
    requestId: 'req-team-prop-1', action: 'reward.propose', target: userA.id, reason: 'Team activity reward for Alice',
    data: { rewardKind: 'team', rewardId: `${userA.id}_${periodId}`, accountId: aliceAccId, reference: 'ref-team-' + userA.id }
  });
  await controlAction(financeChecker, {
    requestId: 'req-team-app-1', action: 'finance.approve', target: teamProp.approvalId,
    reason: 'Approved team activity reward', data: {}
  });

  // 9. BONUS CLAIM (10000 cents non-withdrawable bonus)
  await programAction(userA, { action: 'claim_bonus', accountId: aliceAccId, requestId: 'claim-bonus-alice' });

  // 10. BONUS TRADE & SETTLE (amount 5000, profit 250)
  const nowBonus = Date.now();
  const bonusPub = await publish(adminUser, {
    title: 'BTC 60s Bonus', asset: 'BTCUSD', direction: 'BUY', durationSec: 60, settlementBps: 500,
    opensAt: nowBonus, closesAt: nowBonus + 86400000, eligibility: 'all'
  }, nowBonus);
  await join(userA, {
    accountId: aliceAccId, amountCents: 5000, code: bonusPub.code, contractHash: bonusPub.hash, useBonus: true, confirmed: true
  }, nowBonus);
  await settle(userA, nowBonus + 70000);

  // 11. INVARIANT CALCULATION
  const accAliceSnap = await db.doc(`sparkTradingAccounts/${userA.id}/accounts/${aliceAccId}`).get();
  const accAlice = accAliceSnap.data();

  const journalsAlice = await db.collection('orinJournals').where('user_id', '==', userA.id).get();
  const ledgerAlice = await db.collection('orinProgramLedger').where('uid', '==', userA.id).get();

  const fs = await import('fs');
  const allData = {
    account: accAlice,
    journals: journalsAlice.docs.map(d => d.data()),
    ledger: ledgerAlice.docs.map(d => d.data())
  };
  fs.writeFileSync('stage0c_data.json', JSON.stringify(allData, null, 2));

  console.log('=== STAGE 0c SMOKE FLOW COMPLETED ===');
  console.log('Alice Balance Cents:', accAlice.balanceCents);
  console.log('Alice Reserved Cents:', accAlice.reservedCents);
  console.log('Alice Realized Cents:', accAlice.realizedCents);
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
