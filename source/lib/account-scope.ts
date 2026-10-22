import type {LabState} from './contracts';
import {activeTradingAccount,type AccountDirectory} from './trading-accounts';
/** Untagged legacy positions belong exclusively to the original primary demo. */
export function scopeAccountState(state:LabState,directory:AccountDirectory):LabState {
 const a=activeTradingAccount(directory);if(!a)return {...state,accountDirectory:directory};
 const matches=(row:unknown)=>{const r=row as {accountId?:string;account_id?:string};return (r.accountId??r.account_id??'primary')===a.id};
 const positions=(state.positions ?? []).filter(matches),ids=new Set(positions.map(p=>p.id));
 return {...state,...(a.id==='primary'?{}:{initialCents:0}),accountDirectory:directory,balanceCents:a.balanceCents,perpetualCents:a.type==='real'?(state.perpetualCents??0):a.balanceCents,futuresCents:a.type==='real'?(state.futuresCents??a.balanceCents):0,reservedCents:a.reservedCents,realizedCents:a.realizedCents,dailyProfitCents:a.dailyProfitCents??state.dailyProfitCents,positions,receipts:(state.receipts ?? []).filter(r=>ids.has(r.position_id)),ledger:(state.ledger ?? []).filter(matches)};
}
