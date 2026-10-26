import { LEGACY_FINANCIAL_POLICY, SIGNAL_FINANCIAL_POLICY, proportionalCents, type AccountPolicyProgress, type ActiveFinancialPolicy } from '../../lib/financial-policy.ts';
import type { ContractWalletState } from './wallet-ledger.ts';

export type PolicyClient = { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type PolicyRuntime = { activatedAt: number | null; staged?: boolean };
export type PolicyLedger = AccountPolicyProgress & { version: 'signal-doubling-v1'; activatedAt: number; earlyFeeRemainderUnits: number };

/** Same clock authority as the activation record, after the account lock. */
export async function policyTimestamp(client: PolicyClient): Promise<number> {
  const result = await client.query('SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS now_ms');
  const timestamp = Number(result.rows[0]?.now_ms);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('Financial event time unavailable');
  return timestamp;
}

/** An absent migration preserves legacy behavior; malformed activation fails closed. */
export async function readPolicyRuntime(client: PolicyClient): Promise<PolicyRuntime> {
  const r = await client.query("SELECT data FROM docs WHERE collection = 'financial_policy_configuration' AND id = 'current'");
  const config = r.rows[0]?.data;
  if (!config) return { activatedAt: null };
  if (config.status === 'staged' && config.activatedAt === null) return { activatedAt: null, staged: true };
  if (config.version !== 'signal-doubling-v1' || config.doublingScope !== 'account_aggregate'
    || config.existingFundsTreatment !== 'grandfathered' || config.status !== 'active' || config.clientReleaseConfirmed !== true
    || !Number.isSafeInteger(config.activatedAt) || config.activatedAt <= 0) {
    throw new Error('Financial policy configuration requires operator review');
  }
  return { activatedAt: config.activatedAt };
}

export async function getActiveFinancialPolicy(client?: PolicyClient): Promise<ActiveFinancialPolicy> {
  if (!client) {
    const { withTx } = await import('./db.ts');
    return withTx(tx => getActiveFinancialPolicy(tx));
  }
  return policyDescription(await readPolicyRuntime(client));
}

export function policyDescription(runtime: PolicyRuntime): ActiveFinancialPolicy {
  return runtime.activatedAt === null
    ? { ...LEGACY_FINANCIAL_POLICY, rolloutStatus: runtime.staged ? 'staged' : 'legacy' }
    : { ...SIGNAL_FINANCIAL_POLICY, activatedAt: runtime.activatedAt, rolloutStatus: 'active' };
}

/** The caller must hold accounts FOR UPDATE before mutating this wallet metadata. */
export function policyLedger(state: ContractWalletState, runtime: PolicyRuntime): PolicyLedger | null {
  const old = state.signalPolicy as PolicyLedger | undefined;
  if (runtime.activatedAt === null) {
    if (old) throw new Error('Cannot deactivate a funded financial policy without reconciliation');
    return null;
  }
  if (old && (old.version !== 'signal-doubling-v1' || old.activatedAt !== runtime.activatedAt)) throw new Error('Financial policy cutover mismatch');
  const data = old ? { ...old, earlyFeeRemainderUnits: old.earlyFeeRemainderUnits ?? 0 } : {
    version: 'signal-doubling-v1' as const, activatedAt: runtime.activatedAt,
    eligiblePrincipalCents: 0, netSignalProfitCents: 0, firstEligibleDepositAt: null,
    permanentlyExemptAt: null, policyTradingCents: 0, policySpotCents: 0, policyReservedCents: 0,
    earlyFeeRemainderUnits: 0,
  };
  for (const key of ['eligiblePrincipalCents', 'policyTradingCents', 'policySpotCents', 'policyReservedCents'] as const) {
    if (!Number.isSafeInteger(data[key]) || data[key] < 0) throw new Error('Financial policy amounts require reconciliation');
  }
  if (!Number.isInteger(data.earlyFeeRemainderUnits) || data.earlyFeeRemainderUnits < 0 || data.earlyFeeRemainderUnits > 4) throw new Error('Invalid early-transfer fee remainder');
  if (!Number.isSafeInteger(data.netSignalProfitCents)
    || data.policyTradingCents > state.wallet.perpetualCents || data.policySpotCents > state.wallet.futuresCents) {
    throw new Error('Wallet cohort mismatch requires reconciliation');
  }
  for (const timestamp of [data.firstEligibleDepositAt, data.permanentlyExemptAt]) {
    if (timestamp !== null && (!Number.isSafeInteger(timestamp) || timestamp < runtime.activatedAt)) throw new Error('Invalid financial policy event time');
  }
  if ((data.eligiblePrincipalCents > 0 && data.firstEligibleDepositAt === null)
    || (data.permanentlyExemptAt !== null && (data.firstEligibleDepositAt === null || data.permanentlyExemptAt < data.firstEligibleDepositAt))) {
    throw new Error('Financial policy eligibility history requires reconciliation');
  }
  state.signalPolicy = data;
  return data;
}

export function cohortAmount(amountCents: number, state: ContractWalletState, policy: PolicyLedger | null, pocket: 'trading' | 'spot') {
  const total = pocket === 'trading' ? state.wallet.perpetualCents : state.wallet.futuresCents;
  const cohort = policy ? (pocket === 'trading' ? policy.policyTradingCents : policy.policySpotCents) : 0;
  return proportionalCents(amountCents, cohort, total);
}

export function recordEligibleDeposit(policy: PolicyLedger, amountCents: number, confirmedAt: number) {
  const principal = policy.eligiblePrincipalCents + amountCents;
  if (!Number.isSafeInteger(principal)) throw new Error('Eligible principal exceeds supported range');
  policy.eligiblePrincipalCents = principal;
  policy.policyTradingCents += amountCents;
  policy.firstEligibleDepositAt ??= confirmedAt;
  // Never reset the permanent exemption, even when a later deposit raises capital.
}

export function recordSignalResult(policy: PolicyLedger, profitCents: number, settledAt: number) {
  if (policy.firstEligibleDepositAt === null || settledAt < policy.firstEligibleDepositAt) return;
  const profit = policy.netSignalProfitCents + profitCents;
  if (!Number.isSafeInteger(profit)) throw new Error('Signal profit exceeds supported range');
  policy.netSignalProfitCents = profit;
  if (policy.permanentlyExemptAt === null && policy.eligiblePrincipalCents > 0 && profit >= policy.eligiblePrincipalCents) {
    policy.permanentlyExemptAt = settledAt;
    // Uncollected sub-cent fees are waived too; never collect them later.
    policy.earlyFeeRemainderUnits = 0;
  }
}

export async function savePolicyEvidence(client: PolicyClient, collection: string, id: string, ownerId: string, data: unknown) {
  await client.query(`INSERT INTO docs (collection, id, owner_id, data, updated_at)
    VALUES ($1, $2, $3, $4::jsonb, NOW())`, [collection, id, ownerId, JSON.stringify(data)]);
}

/** Call before a non-deposit cash adjustment, under the account row lock.
 * Positive adjustments are grandfathered cash, never eligible deposits/profit.
 * Negative adjustments retain the original spot-first cash spending order and
 * proportionally reduce only the affected pocket's new/old cohort balances.
 */
export async function prepareCashAdjustment(client: PolicyClient, account: any, deltaCents: number) {
  if (account.type !== 'real') return;
  const runtime = await readPolicyRuntime(client);
  if (runtime.activatedAt === null) return;
  const { loadContractWallet, saveContractWallet } = await import('./wallet-ledger.ts');
  const total = Number(account.balance_cents);
  if (!Number.isSafeInteger(deltaCents) || !Number.isSafeInteger(total + deltaCents) || total + deltaCents < 0) throw new Error('Cash adjustment exceeds available funds');
  const { state } = await loadContractWallet(client, account.id, account.user_id, total, true);
  const policy = policyLedger(state, runtime)!;
  if (deltaCents < 0) {
    const spotDebit = Math.min(-deltaCents, state.wallet.futuresCents);
    const tradingDebit = -deltaCents - spotDebit;
    if (spotDebit) policy.policySpotCents -= cohortAmount(spotDebit, state, policy, 'spot');
    if (tradingDebit) policy.policyTradingCents -= cohortAmount(tradingDebit, state, policy, 'trading');
    state.wallet.perpetualCents -= tradingDebit;
  }
  state.wallet.futuresCents = total + deltaCents - state.wallet.perpetualCents;
  await saveContractWallet(client, account.id, account.user_id, state);
}
