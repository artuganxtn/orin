/**
 * Public, read-only description of the policy that this release actually uses.
 * IMPORTANT: storage names are historical: perpetual = trading, futures = cash
 * available for withdrawal. Do not rename or swap persisted wallet fields.
 */
export const DEPOSIT_MIN_CENTS = 10_000;
export const DEPOSIT_MAX_CENTS = 1_500_000;

export const LEGACY_FINANCIAL_POLICY = {
  version: 'legacy-29-day-v1',
  depositMinCents: DEPOSIT_MIN_CENTS,
  depositMaxCents: DEPOSIT_MAX_CENTS,
  depositCreditPocket: 'futures',
  tradingPocket: 'perpetual',
  withdrawablePocket: 'futures',
  spotToTradingFeeRate: 0,
  tradingToSpot: { basis: 'elapsed_days', days: 29, beforeFeeRate: 0.2, afterFeeRate: 0 },
  externalWithdrawalFeeRate: 0.05,
  activatedAt: null as number | null,
  automaticSpotFundingForTrades: true,
} as const;

export const SIGNAL_FINANCIAL_POLICY = {
  ...LEGACY_FINANCIAL_POLICY,
  version: 'signal-doubling-v1',
  depositCreditPocket: 'perpetual',
  automaticSpotFundingForTrades: false,
  tradingToSpot: { basis: 'actual_capital_doubling', beforeFeeRate: 0.2, afterFeeRate: 0 },
  doublingScope: 'account_aggregate_new_confirmed_deposits',
  qualifyingProfit: 'account_net_realized_nonbonus_official_signal_profit_after_first_eligible_deposit',
  exemption: 'permanent_account_including_future_deposits',
  existingFundsTreatment: 'grandfathered_original_fee_rule_until_account_exemption',
  legacyTradingToSpot: LEGACY_FINANCIAL_POLICY.tradingToSpot,
} as const;

export type ActiveFinancialPolicy = (typeof LEGACY_FINANCIAL_POLICY | typeof SIGNAL_FINANCIAL_POLICY) & { rolloutStatus?: 'legacy' | 'staged' | 'active' };
export type AccountPolicyProgress = {
  eligiblePrincipalCents: number;
  netSignalProfitCents: number;
  firstEligibleDepositAt: number | null;
  permanentlyExemptAt: number | null;
  policyTradingCents: number;
  policySpotCents: number;
  policyReservedCents: number;
  earlyFeeRemainderUnits?: number;
};

export function isNewDepositAmount(amountCents: unknown): amountCents is number {
  return typeof amountCents === 'number' && Number.isSafeInteger(amountCents)
    && amountCents >= DEPOSIT_MIN_CENTS && amountCents <= DEPOSIT_MAX_CENTS;
}

/** Shared integer-cent arithmetic; callers supply the authoritative active rate. */
export function transferAmounts(amountCents: number, feeRate: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0
    || !Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1) {
    throw new Error('Invalid transfer amount or fee rate');
  }
  const feeCents = Math.round(amountCents * feeRate);
  return { amountCents, feeRate, feeCents, netAmountCents: amountCents - feeCents };
}

/** Exact cents, deterministic remainder stays with the grandfathered cohort. */
export function proportionalCents(amountCents: number, cohortCents: number, totalCents: number): number {
  if (![amountCents, cohortCents, totalCents].every(Number.isSafeInteger)
    || cohortCents < 0 || totalCents < 0 || cohortCents > totalCents) throw new Error('Invalid cohort allocation');
  if (!totalCents) {
    if (amountCents !== 0) throw new Error('Cannot allocate from an empty wallet');
    return 0;
  }
  return Number(BigInt(amountCents) * BigInt(cohortCents) / BigInt(totalCents));
}

/** New-cohort 20% fee: carry fifths of a cent, never fractional currency.
 * This prevents splitting an exit into 1-cent transfers to erase its fee. */
export function newPolicyTransferFee(amountCents: number, remainderUnits: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !Number.isInteger(remainderUnits) || remainderUnits < 0 || remainderUnits > 4) throw new Error('Invalid fee remainder');
  const units = BigInt(amountCents) + BigInt(remainderUnits);
  return { feeCents: Number(units / 5n), remainderUnits: Number(units % 5n) };
}
