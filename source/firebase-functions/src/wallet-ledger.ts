/**
 * Single source of truth for the real-account wallet split.
 *
 *   accounts.balance_cents (ledger cash, excludes reserved/in-trade money)
 *        = perpetualCents  (العقود الدائمة — trading only, NEVER withdrawable)
 *        + futuresCents    (العقود الآجلة — withdrawable)
 *
 * perpetualCents is the only independently stored value. futuresCents is ALWAYS
 * derived as (balance_cents - perpetualCents) so it can never drift from the ledger.
 */

export interface ContractWalletState {
  wallet: {
    ownerId: string;
    accountId: string;
    currency: 'USD';
    futuresCents: number;
    perpetualCents: number;
    version: number;
    updatedAt: number;
    [k: string]: unknown;
  };
  operations: any[];
  [k: string]: unknown;
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/** Load (optionally FOR UPDATE) and normalize the contract wallet for a real account. */
export async function loadContractWallet(
  client: Queryable,
  accountId: string,
  ownerId: string,
  balanceCents: number | string | bigint,
  lock = true
): Promise<{ state: ContractWalletState; existed: boolean }> {
  const res = await client.query(
    `SELECT data FROM docs WHERE collection = 'contract_wallets' AND id = $1${lock ? ' FOR UPDATE' : ''}`,
    [accountId]
  );
  const raw = res.rows[0]?.data;
  const existed = !!raw?.wallet;
  const state: ContractWalletState = existed
    ? { ...raw, operations: Array.isArray(raw.operations) ? raw.operations : [] }
    : {
        wallet: {
          ownerId,
          accountId,
          currency: 'USD',
          futuresCents: 0,
          perpetualCents: 0,
          version: 1,
          updatedAt: Date.now()
        },
        operations: []
      };
  normalizeWallet(state, balanceCents);
  return { state, existed };
}

/** Clamp perpetual into [0, total] and derive futures = total - perpetual. */
export function normalizeWallet(state: ContractWalletState, balanceCents: number | string | bigint) {
  const total = Math.max(0, Number(balanceCents) || 0);
  const perp = Math.min(total, Math.max(0, Math.trunc(Number(state.wallet.perpetualCents) || 0)));
  state.wallet.perpetualCents = perp;
  state.wallet.futuresCents = total - perp;
  return state;
}

/** Persist the wallet document (upsert) and bump its version. */
export async function saveContractWallet(client: Queryable, accountId: string, ownerId: string, state: ContractWalletState) {
  state.wallet.version = (Number(state.wallet.version) || 1) + 1;
  state.wallet.updatedAt = Date.now();
  if (state.operations.length > 50) state.operations.length = 50;
  await client.query(
    `INSERT INTO docs (collection, id, owner_id, data, updated_at)
     VALUES ('contract_wallets', $1, $2, $3, NOW())
     ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [accountId, ownerId, JSON.stringify(state)]
  );
}

/** Read current balance_cents for an account (inside the caller's transaction). */
export async function readBalanceCents(client: Queryable, accountId: string): Promise<number> {
  const r = await client.query('SELECT balance_cents FROM accounts WHERE id = $1', [accountId]);
  return Number(r.rows[0]?.balance_cents || 0);
}

/** 29-day early-transfer window, measured from the first credited deposit. */
export async function challengeInfo(client: Queryable, userId: string, now = Date.now()) {
  const depRes = await client.query(
    `SELECT MIN(created_at) AS earliest_deposit
     FROM deposits
     WHERE user_id = $1 AND (status = 'finished' OR credited = true)`,
    [userId]
  );
  const earliest = depRes.rows[0]?.earliest_deposit;
  const earliestMs = earliest ? new Date(earliest).getTime() : null;
  const elapsedDays = earliestMs ? Math.max(0, Math.floor((now - earliestMs) / 86400000)) : 0;
  const lockRemainingDays = earliestMs ? Math.max(0, 29 - elapsedDays) : 29;
  const isBefore29Days = lockRemainingDays > 0;
  return {
    earliestDepositAt: earliestMs,
    elapsedDays,
    lockRemainingDays,
    isBefore29Days,
    transferFeeRate: isBefore29Days ? EARLY_TRANSFER_FEE_RATE : 0,
    withdrawalFeeRate: WITHDRAWAL_FEE_RATE
  };
}

export const EARLY_TRANSFER_FEE_RATE = 0.2;
export const WITHDRAWAL_FEE_RATE = 0.05;
