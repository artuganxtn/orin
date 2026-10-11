import type { AccountDirectory } from '../lib/trading-accounts';

export function newAccountNumber() {
  let digits = '';
  while (digits.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(24))) {
      if (byte >= 250 || (!digits.length && byte % 10 === 0)) continue;
      digits += String(byte % 10);
      if (digits.length === 12) break;
    }
  }
  return digits;
}

export function tradingAccountsApi(db: any) {
  return async (uid: string, method = 'GET', input: Record<string, unknown> = {}): Promise<AccountDirectory> => {
    return { accounts: [], activeId: '' };
  };
}
