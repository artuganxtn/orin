import type {AccountDirectory} from './trading-accounts';
export const ASSETS={XAUUSD:"الذهب / الدولار",BTCUSD:"بيتكوين / الدولار",ETHUSD:"إيثريوم / الدولار"} as const;
export type Asset=keyof typeof ASSETS;
export type Direction="BUY"|"SELL";
export type Tier="all"|"standard"|"advanced";
export interface Contract {id:string;code:string;title:string;asset:Asset;direction:Direction;duration_sec:number;settlement_bps:number;eligibility:Tier;opens_at:number;closes_at:number;published_at:number;admin_id:string;canonical:string;hash:string;participants?:number;}
export interface Position {id:string;user_id:string;contract_id:string;amount_cents:number;result_cents:number;started_at:number;ends_at:number;status:"active"|"settled";settled_at:number|null;contract:Contract;}
export interface Notice {id:string;title:string;message:string;contract_id:string|null;created_at:number;}
export interface Receipt {id:string;position_id:string;payload:string;hash:string;created_at:number;}
export interface AuditEvent {id:string;actor_id:string;action:string;reference:string;payload:string;payload_hash:string;created_at:number;}
export interface LedgerRow {id:string;journal_id:string;account:string;amount_cents:number;kind:string;effective_at:number;}
export interface LabState {activityUnavailable?:boolean;accountDirectory?:AccountDirectory|null;serverTime:number;user:{id:string;name:string;tier:string;accepted_at:number|null;seen_at:number};isAdmin:boolean;balanceCents:number;reservedCents:number;realizedCents:number;contracts:Contract[];positions:Position[];notifications:Notice[];receipts:Receipt[];ledger:LedgerRow[];audit:AuditEvent[];}
export interface Candle {time:number;open:number;high:number;low:number;close:number;volume?:number;}
export interface MarketData {pair:string;price:number;open:number;high:number;low:number;volume:number;change:number;candles:Candle[];fetchedAt:number;tradeTime:string;source:string;}
export const money=(cents:number)=>new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);
export const percent=(bps:number)=>`${bps>=0?"+":""}${(bps/100).toFixed(2)}%`;
export function resultCents(amount:number,bps:number){return Math.sign(bps)*Math.round(amount*Math.abs(bps)/10000);}
