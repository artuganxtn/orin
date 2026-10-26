export const PAYMENT_COINS=[
 {id:'usdttrc20',label:'USDT',network:'TRON · TRC20'},
 {id:'usdtbsc',label:'USDT',network:'BNB Smart Chain · BEP20'},
 {id:'btc',label:'BTC',network:'Bitcoin'},
 {id:'eth',label:'ETH',network:'Ethereum · ERC20'},
] as const;
export type PaymentCoin=typeof PAYMENT_COINS[number]['id'];
export type DepositStatus='creating'|'waiting'|'confirming'|'confirmed'|'sending'|'finished'|'partially_paid'|'failed'|'refunded'|'expired'|'review';
export interface DepositView {id:string;accountId:string;amountCents:number;coin:PaymentCoin;status:DepositStatus;paymentId:string|null;address:string|null;payAmount:string|null;extraId:string|null;credited:boolean;createdAt:number;creditJournalId?:string;creditedCents?:number;}
export interface PaymentReadiness {provider:string;deposits:boolean;withdrawals:boolean;coins:typeof PAYMENT_COINS;reason?:string;}
export const inactivePayments:PaymentReadiness={provider:'ORIN Pay',deposits:false,withdrawals:false,coins:PAYMENT_COINS,reason:'backend_required'};
