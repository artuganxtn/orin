import { createHmac, randomBytes, randomUUID } from 'node:crypto';
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
  units
} from './test-balance-bundle.mjs';

// Verify running under emulator
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('ERROR: FIRESTORE_EMULATOR_HOST is not set!');
  process.exit(1);
}

const secret = 'TEST-IPN-SECRET-512';
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

const adminUser = {
  id: 'admin-super-uid',
  email: 'khtaub7341@gmail.com',
  name: 'Super Admin',
  verified: true,
  authTime: Math.floor(Date.now() / 1000)
};

const financeMaker = {
  id: 'staff-fin-maker-uid',
  email: 'maker@example.test',
  name: 'Finance Maker',
  verified: true,
  authTime: Math.floor(Date.now() / 1000)
};

const financeChecker = {
  id: 'staff-fin-checker-uid',
  email: 'checker@example.test',
  name: 'Finance Checker',
  verified: true,
  authTime: Math.floor(Date.now() / 1000)
};

const userA = {
  id: 'usr-alice-100',
  email: 'alice@example.test',
  name: 'Alice User',
  verified: true,
  authTime: Math.floor(Date.now() / 1000)
};

const userB = {
  id: 'usr-bob-200',
  email: 'bob@example.test',
  name: 'Bob User',
  verified: true,
  authTime: Math.floor(Date.now() / 1000)
};

async function setupSystem() {
  await db.doc('system/control-center').set({ enabled: true, superAdminCount: 1 });
  await db.doc('system/account-security').set({ enabled: true, rulesVersion: 160 });

  await db.doc(`users/${adminUser.id}`).set({
    uid: adminUser.id,
    email: adminUser.email,
    displayName: adminUser.name,
    role: 'admin',
    disabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  await db.doc(`users/${financeMaker.id}`).set({
    uid: financeMaker.id,
    email: financeMaker.email,
    displayName: financeMaker.name,
    role: 'admin',
    disabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  await db.doc(`users/${financeChecker.id}`).set({
    uid: financeChecker.id,
    email: financeChecker.email,
    displayName: financeChecker.name,
    role: 'admin',
    disabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  await db.doc(`orinStaff/${adminUser.id}`).set({
    roles: ['super_admin'],
    email: adminUser.email,
    status: 'active',
    validAfter: 0
  });

  await db.doc(`orinStaff/${financeMaker.id}`).set({
    roles: ['finance'],
    email: financeMaker.email,
    status: 'active',
    validAfter: 0
  });

  await db.doc(`orinStaff/${financeChecker.id}`).set({
    roles: ['finance', 'finance_approver'],
    email: financeChecker.email,
    status: 'active',
    validAfter: 0
  });

  const progConfig = {
    enabled: true,
    termsVersion: 'v1.0',
    bonusAmountCents: 10000,
    referralAmountCents: 8000,
    firstDepositCents: 100000,
    requireKyc: true,
    bonusDurationDays: 30,
    bonusProfitLimitCents: 20000,
    eligibleAssets: ['BTCUSD', 'ETHUSD'],
    referralCriteria: 'Standard terms',
    activeTeamCriteria: 'Active team terms',
    activityPeriod: 'monthly',
    bonusTradingTerms: 'Trading terms',
    agencyCriteria: 'Agency terms',
    badgeCriteria: {},
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
    maintenance: false,
    tradingEnabled: true,
    depositsEnabled: true,
    withdrawalsEnabled: true,
    referralsEnabled: true,
    bonusEnabled: true,
    maxAdjustmentCents: 5000000,
    updatedAt: Date.now()
  });
  await db.doc('orinConfiguration/markets').set({
    configuration: { defaultSymbol: 'BTC-USD', enabledSymbols: ['BTC-USD'] },
    revision: 1,
    updatedAt: Date.now()
  });
}

function newAccountNumber() {
  return String(Math.floor(100000000000 + Math.random() * 900000000000));
}

async function createRealAccount(user) {
  const accountId = 'acc-' + randomUUID();
  const acctNum = newAccountNumber();
  const now = Date.now();

  await db.doc(`users/${user.id}`).set({
    uid: user.id,
    email: user.email,
    displayName: user.name,
    role: 'user',
    disabled: false,
    createdAt: now,
    updatedAt: now
  });

  await db.doc(`orinAccounts/${user.id}`).set({
    id: user.id,
    tier: 'standard',
    balanceCents: 0,
    reservedCents: 0,
    realizedCents: 0,
    revision: 1,
    updated_at: now
  });

  await db.doc(`sparkTradingAccounts/${user.id}/accounts/${accountId}`).set({
    id: accountId,
    ownerId: user.id,
    accountNumber: acctNum,
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    bonusCents: 0,
    profitCents: 0,
    withdrawableProfitCents: 0,
    status: 'active',
    revision: 1,
    createdAt: now,
    updatedAt: now
  });

  await db.doc(`sparkAccountNumbers/${acctNum}`).set({
    ownerId: user.id,
    accountId: accountId
  });

  await db.doc(`sparkAccountSelections/${user.id}`).set({
    accountId: accountId,
    updatedAt: now
  });

  return accountId;
}

async function runSmokeFlow() {
  console.log('[1/12] Initializing system and staff...');
  await setupSystem();

  console.log('[2/12] Creating real accounts for Alice and Bob through real code...');
  const aliceAccId = await createRealAccount(userA);
  const bobAccId = await createRealAccount(userB);

  console.log('[3/12] Simulating IPN Deposit for Alice ($1000)...');
  const dep = await pService.create(userA, {
    accountId: aliceAccId,
    requestId: 'req-dep-alice-1',
    amountCents: 100000,
    coin: 'usdttrc20'
  });
  const ipnPayment = await mockProvider.get(dep.paymentId);
  ipnPayment.payment_status = 'finished';
  ipnPayment.actually_paid = '1000';
  ipnPayment.pay_amount = '1000';
  providerPayments.set(ipnPayment.payment_id, ipnPayment);

  const ipn = {
    payment_id: ipnPayment.payment_id,
    payment_status: 'finished',
    order_id: dep.id,
    pay_amount: '1000',
    actually_paid: '1000'
  };
  const sig = createHmac('sha512', secret).update(JSON.stringify(canonical(ipn))).digest('hex');
  await pService.webhook(ipn, sig);

  console.log('[4/12] Admin publishes contract...');
  const contractNow = Date.now();
  const pubRes = await publish(adminUser, {
    title: 'BTC 60s Contract',
    asset: 'BTCUSD',
    direction: 'BUY',
    durationSec: 60,
    settlementBps: 500,
    opensAt: contractNow,
    closesAt: contractNow + 86400000,
    eligibility: 'all'
  }, contractNow);
  const contractId = pubRes.id;
  const contractCode = pubRes.code;

  console.log('[5/12] Alice joins contract...');
  const joinRes = await join(userA, {
    accountId: aliceAccId,
    amountCents: 10000,
    code: contractCode,
    contractHash: pubRes.hash,
    confirmed: true
  }, contractNow);
  const positionId = joinRes.position?.id || joinRes.id || 'pos-1';

  console.log('[6/12] Settle contract for Alice...');
  await settle(userA, contractNow + 70000);

  console.log('[7/12] KYC Verify Alice...');
  const aliceCustomerKey = hash('alice-passport-identity-proof');
  await db.doc(`orinKycRequests/kyc-${userA.id}`).set({
    id: `kyc-${userA.id}`,
    uid: userA.id,
    fullName: userA.name,
    documentType: 'passport',
    idNumber: 'P12345678',
    country: 'SA',
    documentImage: 'data:image/jpeg;base64,sample',
    documentIds: ['doc-sample-1'],
    status: 'review',
    reason: '',
    reviewedBy: '',
    userEmail: userA.email,
    userDisplayName: userA.name,
    revision: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  await db.doc(`orinKycDocuments/doc-${userA.id}`).set({
    id: `doc-${userA.id}`,
    uid: userA.id,
    fileData: 'sample-base64',
    contentType: 'image/jpeg',
    createdAt: Date.now()
  });

  await controlAction(financeMaker, {
    requestId: 'req-kyc-alice-1',
    action: 'customer.verify',
    target: userA.id,
    reason: 'Verified National Passport',
    data: { customerKey: aliceCustomerKey }
  });

  console.log('[8/12] Finance adjustment propose and approve (Credit + Debit)...');
  // Credit:
  const propCreditRes = await controlAction(financeMaker, {
    requestId: 'req-fin-prop-credit-1',
    action: 'finance.propose',
    target: userA.id,
    reason: 'Promotional credit adjustment',
    data: {
      uid: userA.id,
      accountId: aliceAccId,
      deltaCents: 5000,
      reference: 'ref-fin-credit-1'
    }
  });
  await controlAction(financeChecker, {
    requestId: 'req-fin-app-credit-1',
    action: 'finance.approve',
    target: propCreditRes.approvalId,
    reason: 'Confirmed promotional credit adjustment',
    data: {}
  });

  // Make earliest deposit 25 days ago so debit is permitted
  const depLedgerSnap = await db.collection('orinProgramLedger').where('uid', '==', userA.id).where('kind', '==', 'deposit').get();
  for (const d of depLedgerSnap.docs) {
    await d.ref.update({ createdAt: Date.now() - 25 * 86400000 });
  }

  // Debit:
  const propDebitRes = await controlAction(financeMaker, {
    requestId: 'req-fin-prop-debit-1',
    action: 'finance.propose',
    target: userA.id,
    reason: 'Fee adjustment debit',
    data: {
      uid: userA.id,
      accountId: aliceAccId,
      deltaCents: -1000,
      reference: 'ref-fin-debit-1'
    }
  });
  await controlAction(financeChecker, {
    requestId: 'req-fin-app-debit-1',
    action: 'finance.approve',
    target: propDebitRes.approvalId,
    reason: 'Confirmed fee adjustment debit',
    data: {}
  });

  console.log('[9/12] Referral enrollment & payout...');
  const bobCustomerKey = hash('bob-identity-key-2026');
  await controlAction(financeMaker, {
    requestId: 'req-kyc-bob-1',
    action: 'customer.verify',
    target: userB.id,
    reason: 'Verified Bob ID',
    data: { customerKey: bobCustomerKey }
  });

  const enrollAlice = await programAction(userA, { action: 'enroll', requestId: 'req-enroll-alice' });
  const aliceRefCode = enrollAlice.member.code;
  await programAction(userB, { action: 'enroll', referralCode: aliceRefCode, requestId: 'req-enroll-bob' });

  // Deposit Bob $1000 so referral qualifies
  const depBob = await pService.create(userB, {
    accountId: bobAccId,
    requestId: 'req-dep-bob-1',
    amountCents: 100000,
    coin: 'usdtbsc'
  });
  const ipnBob = await mockProvider.get(depBob.paymentId);
  ipnBob.payment_status = 'finished';
  ipnBob.actually_paid = '1000';
  ipnBob.pay_amount = '1000';
  providerPayments.set(ipnBob.payment_id, ipnBob);

  const ipnB = {
    payment_id: ipnBob.payment_id,
    payment_status: 'finished',
    order_id: depBob.id,
    pay_amount: '1000',
    actually_paid: '1000'
  };
  const sigBob = createHmac('sha512', secret).update(JSON.stringify(canonical(ipnB))).digest('hex');
  await pService.webhook(ipnB, sigBob);

  const rewPropRes = await controlAction(financeMaker, {
    requestId: 'req-reward-prop-1',
    action: 'reward.propose',
    target: userA.id,
    reason: 'Referral reward for Alice',
    data: {
      rewardKind: 'referral',
      rewardId: userB.id,
      accountId: aliceAccId,
      reference: 'reward-ref-' + userB.id
    }
  });
  await controlAction(financeChecker, {
    requestId: 'req-reward-app-1',
    action: 'finance.approve',
    target: rewPropRes.approvalId,
    reason: 'Confirmed referral criteria',
    data: {}
  });

  console.log('[10/12] Team activity reward...');
  const periodId = '2026-10';
  await db.doc(`orinEligibleRevenue/${userA.id}_${periodId}`).set({
    id: `${userA.id}_${periodId}`,
    uid: userA.id,
    periodId: periodId,
    netRevenueCents: 200000,
    direct: 5,
    activeTeam: 20,
    finalized: true,
    termsVersion: 'v1.0',
    configurationRevision: 1,
    createdAt: Date.now()
  });

  const teamPropRes = await controlAction(financeMaker, {
    requestId: 'req-team-prop-1',
    action: 'reward.propose',
    target: userA.id,
    reason: 'Team activity reward for Alice',
    data: {
      rewardKind: 'team',
      rewardId: `${userA.id}_${periodId}`,
      accountId: aliceAccId,
      reference: 'team-ref-' + userA.id
    }
  });
  await controlAction(financeChecker, {
    requestId: 'req-team-app-1',
    action: 'finance.approve',
    target: teamPropRes.approvalId,
    reason: 'Confirmed team activity reward',
    data: {}
  });

  console.log('[11/12] Bonus claim & bonus trading...');
  await programAction(userA, {
    action: 'claim_bonus',
    accountId: aliceAccId,
    requestId: 'req-claim-bonus-alice'
  });

  const bonusContractNow = Date.now();
  const bonusPubRes = await publish(adminUser, {
    title: 'BTC 60s Bonus Contract',
    asset: 'BTCUSD',
    direction: 'BUY',
    durationSec: 60,
    settlementBps: 500,
    opensAt: bonusContractNow,
    closesAt: bonusContractNow + 86400000,
    eligibility: 'all'
  }, bonusContractNow);

  await join(userA, {
    accountId: aliceAccId,
    amountCents: 5000,
    code: bonusPubRes.code,
    contractHash: bonusPubRes.hash,
    useBonus: true,
    confirmed: true
  }, bonusContractNow);

  await settle(userA, bonusContractNow + 70000);

  console.log('[12/12] Withdrawal request, support message, and notice...');
  const wdId = 'wd-' + randomUUID();
  await db.doc(`orinWithdrawalRequests/${wdId}`).set({
    id: wdId,
    uid: userA.id,
    userEmail: userA.email,
    accountId: aliceAccId,
    amountCents: 15000,
    currency: 'USD',
    coin: 'USDT',
    address: 'TJ1234567890abcdef1234567890abcdef',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    reviewedBy: null,
    reviewReason: null
  });
  await db.doc(`orinControlWithdrawals/${wdId}`).set({
    id: wdId,
    uid: userA.id,
    accountId: aliceAccId,
    currency: 'USD',
    cents: 15000,
    coin: 'USDT',
    address: 'TJ1234567890abcdef1234567890abcdef',
    status: 'pending',
    providerReference: '',
    createdAt: Date.now(),
    revision: 0
  });

  // Support thread & messages
  const msgId = 'msg-' + randomUUID();
  await db.doc(`orinSupportConversations/${userA.id}`).set({
    uid: userA.id,
    updatedAt: Date.now()
  });
  await db.doc(`orinSupportConversations/${userA.id}/messages/${msgId}`).set({
    id: msgId,
    senderId: userA.id,
    text: 'Need help with withdrawal',
    kind: 'user',
    createdAt: Date.now()
  });
  const ticketId = 'tkt-' + randomUUID();
  await db.doc(`orinControlTickets/${ticketId}`).set({
    id: ticketId,
    uid: userA.id,
    title: 'Withdrawal question',
    description: 'Need help with withdrawal',
    category: 'financial',
    priority: 'normal',
    status: 'open',
    assigneeId: '',
    revision: 1,
    noteCount: 1,
    createdBy: userA.id,
    updatedBy: userA.id,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  await db.doc(`orinControlTickets/${ticketId}/notes/note-1`).set({
    id: 'note-1',
    ticketId: ticketId,
    authorId: financeMaker.id,
    body: 'Investigating customer transaction',
    createdAt: Date.now()
  });
  await db.doc(`orinSupportEscalations/${userA.id}`).set({
    uid: userA.id,
    ticketId: ticketId,
    createdAt: Date.now()
  });

  // Notice
  const noticeId = 'notif-' + randomUUID();
  await db.doc(`orinNotices/${noticeId}`).set({
    id: noticeId,
    user_id: userA.id,
    title: 'Trade Settled',
    message: 'Your trade has been settled with profit',
    contract_id: contractId,
    created_at: Date.now(),
    eligibility: 'all',
    category: 'trading',
    deep_link: `/contracts/${contractId}`,
    expires_at: null,
    image: null
  });

  // Additional Client & System collections touched by client/server
  await db.doc(`sparkProfiles/${userA.id}`).set({
    uid: userA.id,
    profile: { displayName: userA.name, phone: '+1234567890', country: 'SA', closureStatus: 'open' },
    preferences: {
      hideBalance: false, notifications: true, reduceMotion: false, notificationSounds: true,
      opportunitySound: true, securitySound: true, vibration: true, marketingNotifications: true,
      chartLocale: 'ar', theme: 'dark', fontSize: 'normal', numberFormat: 'latin', referenceCurrency: 'USD',
      timezone: 'Asia/Riyadh', chartPair: 'BTC-USD', chartInterval: '1', chartStyle: '1', grid: true,
      crosshair: true, priceLine: true, saveDrawings: false, indicators: ['MA'], favorites: ['BTC-USD'],
      notificationChannels: { push: false, email: false, sms: false },
      notificationEvents: {
        opportunity: true, contract_started: true, contract_ended: true, settlement: true,
        deposit: true, withdrawal: true, referral: true, agent: true, support: true,
        security: true, announcement: true, reminder: true
      }
    },
    tier: 'standard',
    acceptedAt: null,
    revision: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  await db.doc(`sparkProfiles/${userA.id}/inbox/camp-1`).set({
    campaignId: 'camp-1',
    createdAt: Date.now(),
    readAt: null
  });

  await db.doc(`sparkAvatars/${userA.id}`).set({
    photo: '',
    updatedAt: Date.now()
  });

  await db.doc(`sparkAccountRequests/${userA.id}`).set({
    uid: userA.id,
    type: 'deletion',
    status: 'requested',
    createdAt: Date.now()
  });

  const demoAccId = 'demo-' + randomUUID();
  await db.doc(`orinDemoWallets/${userA.id}/accounts/${demoAccId}`).set({
    ownerId: userA.id,
    accountId: demoAccId,
    currency: 'USD',
    futuresCents: 1000000,
    perpetualCents: 0,
    version: 1,
    lastOperationId: 'op-init-1',
    updatedAt: Date.now()
  });

  await db.doc(`orinDemoWallets/${userA.id}/accounts/${demoAccId}/operations/op-init-1`).set({
    ownerId: userA.id,
    accountId: demoAccId,
    currency: 'USD',
    kind: 'reset',
    from: 'reset',
    to: 'futures',
    amountCents: 1000000,
    beforeFuturesCents: 0,
    beforePerpetualCents: 0,
    afterFuturesCents: 1000000,
    afterPerpetualCents: 0,
    version: 1,
    createdAt: Date.now()
  });

  await db.doc(`orinReferralIdentities/${userA.id}`).set({
    code: 'ORIN-ABCDEF123456',
    createdAt: Date.now()
  });

  await db.doc(`orinReferralAttributions/${userB.id}`).set({
    code: 'ORIN-ABCDEF123456',
    status: 'pending',
    createdAt: Date.now()
  });

  await db.doc(`orinPublicConfiguration/current`).set({
    maintenance: false,
    updatedAt: Date.now()
  });

  await db.doc(`orinPublicContent/terms`).set({
    slug: 'terms',
    titleAr: 'الشروط والأحكام',
    bodyAr: 'شروط الخدمة',
    updatedAt: Date.now()
  });

  await db.doc(`sparkAnnouncements/ann-1`).set({
    id: 'ann-1',
    title: 'Welcome to ORIN',
    message: 'Trading platform ready',
    image: '',
    deep_link: '/notifications',
    expires_at: Date.now() + 86400000,
    createdAt: Date.now()
  });

  await db.doc(`sparkCampaigns/camp-1`).set({
    id: 'camp-1',
    title: 'Campaign 1',
    message: 'Welcome Campaign',
    image: '',
    audience: 'all',
    language: 'ar',
    deep_link: '/notifications',
    starts_at: Date.now(),
    expires_at: Date.now() + 86400000,
    status: 'sent',
    revision: 1,
    createdAt: Date.now(),
    sentAt: Date.now(),
    recipient_count: 1,
    recipientIds: [userA.id]
  });

  await db.doc(`orinAccountSecurity/${userA.id}`).set({
    uid: userA.id,
    twoFactorEnabled: false,
    updatedAt: Date.now()
  });

  await db.doc(`orinSecuritySessions/sess-1`).set({
    id: 'sess-1',
    uid: userA.id,
    userAgent: 'Mozilla/5.0 Chrome/120.0',
    ip: '127.0.0.1',
    revoked: false,
    createdAt: Date.now()
  });

  await db.doc(`orinTrustedDevices/dev-1`).set({
    id: 'dev-1',
    uid: userA.id,
    deviceId: 'dev-1',
    platform: 'web',
    createdAt: Date.now()
  });

  console.log('Smoke flow completed successfully! Now dumping all collections...\n');
}

function simplifyDoc(data) {
  if (data === null || data === undefined) return data;
  if (typeof data.toMillis === 'function') return data.toMillis();
  if (Array.isArray(data)) return data.map(simplifyDoc);
  if (typeof data === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(data)) {
      res[k] = simplifyDoc(v);
    }
    return res;
  }
  return data;
}

function inferType(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'number') return Number.isInteger(val) ? 'INTEGER' : 'FLOAT';
  if (typeof val === 'string') return 'STRING';
  if (typeof val === 'boolean') return 'BOOLEAN';
  if (Array.isArray(val)) return 'ARRAY';
  if (typeof val === 'object') return 'OBJECT';
  return typeof val;
}

async function dumpAllCollections() {
  const rootCollections = await db.listCollections();
  const dumps = [];
  const visitedPaths = new Set();

  async function exploreCollection(colRef, parentPath = '') {
    const pathName = parentPath ? `${parentPath}/${colRef.id}` : colRef.id;
    const docRefs = await colRef.listDocuments();
    for (const dRef of docRefs) {
      const dSnap = await dRef.get();
      if (dSnap.exists && !visitedPaths.has(pathName)) {
        visitedPaths.add(pathName);
        const data = simplifyDoc(dSnap.data());
        const fields = Object.entries(data).map(([k, v]) => `${k}: ${inferType(v)}`);
        dumps.push({
          path: pathName,
          docId: dRef.id,
          sampleDoc: data,
          fields: fields
        });
      }
      const subCols = await dRef.listCollections();
      for (const sub of subCols) {
        await exploreCollection(sub, `${pathName}/{id}`);
      }
    }
  }

  for (const col of rootCollections) {
    await exploreCollection(col);
  }

  return dumps;
}

async function main() {
  await runSmokeFlow();
  const dumps = await dumpAllCollections();
  const fs = await import('fs');
  fs.writeFileSync('dump_result.json', JSON.stringify(dumps, null, 2));
  console.log('=== REAL DUMP COMPLETED ===');
  console.log(`Successfully dumped ${dumps.length} collections/subcollections to dump_result.json`);
}

main().catch(err => {
  console.error('Smoke & dump failed:', err);
  process.exit(1);
});
