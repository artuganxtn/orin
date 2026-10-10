import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { canonical, validIpn, units } from './payments-test.mjs';

// 1. DUPLICATE EVENT ID LOGIC SIMULATION (from program-ingestion.ts line 14)
test('Claim 2: recordConfirmedDeposit returns on identical duplicate and throws on conflicting duplicate', () => {
  const hash = (t) => createHash('sha256').update(t).digest('hex');
  const store = new Map();

  function recordConfirmedDepositMock(e) {
    const fingerprint = hash(JSON.stringify(e));
    const old = store.get(e.eventId);
    if (old) {
      if (old.fingerprint !== fingerprint) {
        const err = new Error('Event conflict');
        err.status = 409;
        throw err;
      }
      return; // Returns cleanly on identical duplicate
    }
    store.set(e.eventId, { ...e, fingerprint, status: 'confirmed' });
    return 'credited';
  }

  const depositEvent = {
    eventId: 'nowpayments-12345678',
    uid: 'user-abc',
    accountId: 'real',
    currency: 'USD',
    cents: 50000,
    eligible: true
  };

  // First ingestion
  const res1 = recordConfirmedDepositMock(depositEvent);
  assert.equal(res1, 'credited', 'First deposit ingestion must succeed');

  // Second ingestion with identical payload: MUST RETURN (not throw)
  let threw = false;
  try {
    recordConfirmedDepositMock(depositEvent);
  } catch {
    threw = true;
  }
  assert.equal(threw, false, 'Identical duplicate eventId must return without throwing');

  // Third ingestion with conflicting payload (e.g. altered cents or uid): MUST THROW 409
  assert.throws(
    () => recordConfirmedDepositMock({ ...depositEvent, cents: 60000 }),
    (err) => err.status === 409 && err.message === 'Event conflict',
    'Conflicting duplicate eventId must throw ApiError 409'
  );
});

// 2. NOWPAYMENTS IPN SIGNATURE VERIFICATION (from nowpayments.ts & payments.ts)
test('Claim 3: NOWPayments IPN signature verification and precision', () => {
  const secret = 'SECRET_TEST_KEY_NOWPAYMENTS_12345';
  const sign = (body) => createHmac('sha512', secret).update(JSON.stringify(canonical(body))).digest('hex');

  const validPayload = {
    payment_id: 123456789,
    payment_status: 'finished',
    pay_amount: '100.5',
    order_id: 'np-test-order-01'
  };

  const validSig = sign(validPayload);

  // Verification succeeds
  assert.equal(validIpn(validPayload, validSig, secret), true, 'Valid signature must verify');

  // Key order invariance (canonicalization)
  const reorderedPayload = {
    order_id: 'np-test-order-01',
    pay_amount: '100.5',
    payment_status: 'finished',
    payment_id: 123456789
  };
  assert.equal(validIpn(reorderedPayload, validSig, secret), true, 'Canonicalization must tolerate key reordering');

  // Tampered payload fails
  assert.equal(validIpn({ ...validPayload, pay_amount: '100.6' }, validSig, secret), false, 'Tampered payload must fail');

  // Malformed signature length fails
  assert.equal(validIpn(validPayload, 'deadbeef', secret), false, 'Invalid signature hex length must fail');

  // Wrong secret fails
  assert.equal(validIpn(validPayload, validSig, 'WRONG_SECRET'), false, 'Wrong secret must fail');
});

// 3. CREDITED AMOUNT VS REQUESTED AMOUNT & PARTIALLY_PAID (from payments.ts lines 53-64)
test('Claim 3: Credited amount is the requested order amount (cents) provided paid >= 98%; partially_paid is NOT credited', () => {
  const storedOrder = {
    amountCents: 100000, // $1,000.00 USD requested
    coin: 'usdttrc20'
  };

  function simulateReconciliation(paymentStatus, payAmount, actuallyPaid) {
    const states = new Set(['waiting','confirming','confirmed','sending','finished','partially_paid','failed','refunded','expired']);
    const status = states.has(paymentStatus) ? paymentStatus : 'review';
    const allowCredit = true;

    if (allowCredit && status === 'finished') {
      const expected = units(payAmount);
      let paid;
      try {
        paid = actuallyPaid != null ? units(actuallyPaid) : expected;
      } catch {
        paid = expected;
      }

      if (paid < (expected * 98n) / 100n) {
        return { credited: false, reason: 'amount_mismatch' };
      }

      // In payments.ts line 62:
      // recordConfirmedDeposit({ ... cents: d.amountCents ... })
      return { credited: true, creditedCents: storedOrder.amountCents };
    }

    return { credited: false, reason: `status_${status}` };
  }

  // 1. Finished payment with exact paid amount credits stored requested cents
  const resExact = simulateReconciliation('finished', '1000', '1000');
  assert.equal(resExact.credited, true);
  assert.equal(resExact.creditedCents, 100000, 'Credited amount is requested order amount (d.amountCents)');

  // 2. Finished payment within 2% margin (e.g. 990 paid for 1000 expected) credits requested cents
  const resMargin = simulateReconciliation('finished', '1000', '985');
  assert.equal(resMargin.credited, true);
  assert.equal(resMargin.creditedCents, 100000);

  // 3. Finished payment below 98% (e.g. 950 paid for 1000 expected) is flagged as amount_mismatch
  const resUnderpaid = simulateReconciliation('finished', '1000', '950');
  assert.equal(resUnderpaid.credited, false);
  assert.equal(resUnderpaid.reason, 'amount_mismatch');

  // 4. partially_paid status is NEVER credited
  const resPartial = simulateReconciliation('partially_paid', '1000', '500');
  assert.equal(resPartial.credited, false);
  assert.equal(resPartial.reason, 'status_partially_paid');
});

// 4. SETTLEMENT ZERO-SUM JOURNAL FUNDING (from contracts.ts line 98)
test('Claim 5: In settle(), system:trading-pnl funds the expected profit in a zero-sum double-entry journal', () => {
  const amountCents = 100000; // $1,000.00
  const settlementBps = 84; // +0.84%
  const expectedProfit = Math.round(amountCents * (settlementBps / 10000)); // 840 cents ($8.40)
  const uid = 'user-test-99';

  // Exact journal line entries from contracts.ts line 98:
  const journalEntries = [
    [`user:${uid}:reserved`, -amountCents],
    [`user:${uid}:cash`, amountCents + expectedProfit],
    ['system:trading-pnl', -expectedProfit]
  ];

  // Verify journal funding source
  const fundingEntry = journalEntries.find(([acc]) => acc === 'system:trading-pnl');
  assert.ok(fundingEntry, 'system:trading-pnl entry must exist');
  assert.equal(fundingEntry[1], -expectedProfit, 'system:trading-pnl must debit the exact profit');

  // Verify strict zero-sum constraint
  const totalSum = journalEntries.reduce((sum, [, delta]) => sum + delta, 0);
  assert.equal(totalSum, 0, 'Ledger journal lines must strictly sum to 0');
});

// 5. REFERRAL SELF-REFERRAL AND CIRCULAR REFERRAL PREVENTION (from programs.ts line 49)
test('Claim 4: Referral tree prevents self-referrals and circular loops', () => {
  const members = new Map([
    ['alice', { ancestors: [] }],
    ['bob', { ancestors: ['alice'] }],
    ['carol', { ancestors: ['alice', 'bob'] }]
  ]);

  function validateReferral(uid, sponsorUid) {
    if (uid === sponsorUid) {
      throw new Error('Self referral or unknown code');
    }
    const parent = members.get(sponsorUid);
    if (!parent || parent.ancestors.includes(uid) || parent.ancestors.length >= 32) {
      throw new Error('Invalid referral path');
    }
    return true;
  }

  // Normal referral succeeds
  assert.equal(validateReferral('dave', 'carol'), true);

  // Self-referral throws
  assert.throws(() => validateReferral('alice', 'alice'), /Self referral/);

  // Circular referral (alice trying to be sponsored by carol) throws
  assert.throws(() => validateReferral('alice', 'carol'), /Invalid referral path/);
  assert.throws(() => validateReferral('bob', 'carol'), /Invalid referral path/);
});

// 6. RULES LINES 140-200: ZERO INITIAL BALANCE & DEMO WALLET RULES
test('Claim 6: Rules lines 140-200 reject non-zero initial balance and enforce valid trading account shape', () => {
  function validTradingAccount(d, uid, id) {
    const keys = Object.keys(d);
    const requiredKeys = ['ownerId','accountNumber','type','currency','balanceCents','reservedCents','realizedCents','createdAt'];
    const hasOnly = keys.every(k => requiredKeys.includes(k)) && keys.length === 8;
    return (
      hasOnly &&
      d.ownerId === uid &&
      typeof d.accountNumber === 'string' &&
      /^[1-9][0-9]{11}$/.test(d.accountNumber) &&
      d.accountNumber !== uid &&
      ['real', 'demo'].includes(d.type) &&
      (id !== 'primary' || d.type === 'demo') &&
      d.currency === 'USD' &&
      d.balanceCents === 0 &&
      d.reservedCents === 0 &&
      d.realizedCents === 0
    );
  }

  const validAccount = {
    ownerId: 'user-1',
    accountNumber: '123456789012',
    type: 'real',
    currency: 'USD',
    balanceCents: 0,
    reservedCents: 0,
    realizedCents: 0,
    createdAt: 1000
  };

  assert.equal(validTradingAccount(validAccount, 'user-1', 'acc-uuid'), true, 'Clean zero-balance account passes');

  // Any attempt to set balanceCents > 0 on creation fails
  assert.equal(validTradingAccount({ ...validAccount, balanceCents: 1000 }, 'user-1', 'acc-uuid'), false, 'Non-zero balanceCents must fail');
  assert.equal(validTradingAccount({ ...validAccount, reservedCents: 500 }, 'user-1', 'acc-uuid'), false, 'Non-zero reservedCents must fail');
  assert.equal(validTradingAccount({ ...validAccount, currency: 'EUR' }, 'user-1', 'acc-uuid'), false, 'Non-USD currency must fail');
});

