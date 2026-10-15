export type WalletPocket='futures'|'perpetual';
export type DemoWallet={ownerId:string;accountId:string;currency:'USD';futuresCents:number;perpetualCents:number;version:number;lastOperationId:string;updatedAt:number};
export type DemoChallengeInfo = {
  earliestDepositAt: number | null;
  elapsedDays: number;
  lockRemainingDays: number;
  isBefore29Days: boolean;
  transferFeeRate: number;
  withdrawalFeeRate: number;
};
export type DemoOperation = {
  id: string;
  ownerId?: string;
  accountId?: string;
  currency?: 'USD';
  kind: 'reset' | 'transfer';
  from: WalletPocket | 'reset';
  to: WalletPocket;
  amountCents: number;
  feeCents?: number;
  feeRate?: number;
  netAmountCents?: number;
  beforeFuturesCents?: number;
  beforePerpetualCents?: number;
  afterFuturesCents: number;
  afterPerpetualCents: number;
  version?: number;
  createdAt: number;
};
export type DemoWalletView = {
  wallet: DemoWallet | null;
  operations: DemoOperation[];
  challenge?: DemoChallengeInfo;
};
export const DEMO_LIMIT_CENTS=100_000_000;
export function parseUsdAmount(value:string){
 const text=value.trim().replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace('٫','.');
 if(!/^\d{1,7}(\.\d{1,2})?$/.test(text))throw new Error('أدخل مبلغًا صحيحًا بمنزلتين عشريتين كحد أقصى. / Enter a valid amount with up to two decimal places.');
 const [whole,fraction='']=text.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents<0||cents>DEMO_LIMIT_CENTS)throw new Error('المبلغ يجب أن يكون بين 0 و1,000,000 USD. / Amount must be between 0 and 1,000,000 USD.');
 return cents;
}
export function demoMovement(wallet:Pick<DemoWallet,'futuresCents'|'perpetualCents'>|null,kind:'reset'|'transfer',amountCents:number,from:WalletPocket='futures'){
 if(!Number.isSafeInteger(amountCents)||amountCents<0||amountCents>DEMO_LIMIT_CENTS)throw new Error('المبلغ غير صالح. / Invalid amount.');
 if(kind==='reset')return {futuresCents:amountCents,perpetualCents:0};
 if(kind!=='transfer'||!['futures','perpetual'].includes(from)||!wallet||amountCents===0)throw new Error('اضبط الرصيد التجريبي أولًا واختر مبلغ تحويل موجبًا. / Set demo funds first and enter a positive transfer amount.');
 if(wallet[from==='futures'?'futuresCents':'perpetualCents']<amountCents)throw new Error('الرصيد المتاح غير كافٍ. / Insufficient available balance.');
 return {futuresCents:wallet.futuresCents+(from==='futures'?-amountCents:amountCents),perpetualCents:wallet.perpetualCents+(from==='perpetual'?-amountCents:amountCents)};
}
