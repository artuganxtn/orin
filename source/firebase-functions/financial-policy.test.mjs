// Source-only regression cases. Not executed for this delivery, per user request.
// Pure arithmetic/state functions only: no database, provider, server or app startup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isNewDepositAmount, newPolicyTransferFee, proportionalCents } from '../lib/financial-policy.ts';
import { policyLedger, recordEligibleDeposit, recordSignalResult } from './src/financial-policy.ts';

function ledger() {
  const wallet = { wallet: { ownerId: 'source-case', accountId: 'source-account', currency: 'USD', perpetualCents: 1_000_000, futuresCents: 0, version: 1, updatedAt: 1000 }, operations: [] };
  return policyLedger(wallet, { activatedAt: 1000 });
}

test('new-deposit bounds are inclusive and whole cents only', () => {
  assert.equal(isNewDepositAmount(9999), false);
  assert.equal(isNewDepositAmount(10000), true);
  assert.equal(isNewDepositAmount(1500000), true);
  assert.equal(isNewDepositAmount(1500001), false);
  assert.equal(isNewDepositAmount(10000.5), false);
  assert.equal(isNewDepositAmount(NaN), false);
});

test('100 plus 100 aggregates; profits between deposits are retained', () => {
  const state = ledger();
  recordEligibleDeposit(state, 10000, 1100);
  recordSignalResult(state, 7000, 1200);
  recordEligibleDeposit(state, 10000, 1300);
  assert.equal(state.eligiblePrincipalCents, 20000);
  assert.equal(state.netSignalProfitCents, 7000);
  assert.equal(state.permanentlyExemptAt, null);
  recordSignalResult(state, 13000, 1400);
  assert.equal(state.permanentlyExemptAt, 1400);
});

test('history excluded, losses netted, waiver permanent after deposits and losses', () => {
  const state = ledger();
  recordSignalResult(state, 999999, 1050);
  recordEligibleDeposit(state, 20000, 1100);
  recordSignalResult(state, 15000, 1200);
  recordSignalResult(state, -5000, 1300);
  assert.equal(state.netSignalProfitCents, 10000);
  recordSignalResult(state, 10000, 1400);
  recordEligibleDeposit(state, 10000, 1500);
  recordSignalResult(state, -50000, 1600);
  assert.equal(state.permanentlyExemptAt, 1400);
  assert.equal(state.eligiblePrincipalCents, 30000);
});

test('five one-cent exits accrue one cent; quotes can be discarded without mutation', () => {
  let remainder = 0, total = 0;
  const quote = newPolicyTransferFee(1, remainder);
  assert.equal(remainder, 0);
  assert.deepEqual(quote, { feeCents: 0, remainderUnits: 1 });
  for (let i = 0; i < 5; i++) {
    const next = newPolicyTransferFee(1, remainder);
    total += next.feeCents;
    remainder = next.remainderUnits;
  }
  assert.equal(total, 1);
  assert.equal(remainder, 0);
});

test('qualification discards unpaid fractions permanently', () => {
  const state = ledger();
  recordEligibleDeposit(state, 10000, 1100);
  state.earlyFeeRemainderUnits = 4;
  recordSignalResult(state, 10000, 1200);
  assert.equal(state.earlyFeeRemainderUnits, 0);
  recordEligibleDeposit(state, 10000, 1300);
  assert.equal(state.permanentlyExemptAt, 1200);
});

test('proportional cohort rounding never changes the total cents', () => {
  assert.equal(proportionalCents(101, 40, 100), 40);
  assert.equal(proportionalCents(-11, 40, 100), -4);
  assert.equal(40 + (101 - 40), 101);
  assert.throws(() => newPolicyTransferFee(1, 5));
  assert.throws(() => proportionalCents(1, 2, 1));
});
