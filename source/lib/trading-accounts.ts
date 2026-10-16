export type TradingAccountType = 'real' | 'demo';
export interface TradingAccount {
  id: string;
  accountNumber: string;
  type: TradingAccountType;
  currency: 'USD';
  balanceCents: number;
  reservedCents: number;
  realizedCents: number;
  dailyProfitCents?: number;
  createdAt: number;
}
export interface AccountDirectory {
  accounts: TradingAccount[];
  activeId: string;
}
export const activeTradingAccount = (directory?: AccountDirectory | null) =>
  directory?.accounts.find(account => account.id === directory.activeId) ?? null;
export const maskedAccountNumber = (number: string) => `•••• ${number.slice(-4)}`;
