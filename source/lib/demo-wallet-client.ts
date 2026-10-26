import {apiFetch} from './client-api';
import type {DemoWalletView,WalletPocket,TransferQuote} from './demo-wallet';
export async function demoWalletRequest(accountId:string,operation?:{requestId:string;kind:'reset'|'transfer'|'quote';amountCents:number;from?:WalletPocket;confirmedQuote?:TransferQuote}):Promise<DemoWalletView>{
 const response=await apiFetch('/api/demo-wallet'+(operation?'':'?accountId='+encodeURIComponent(accountId)),operation?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId,currency:'USD',...operation})}:{});
 const data=await response.json() as DemoWalletView & {error?:string};if(!response.ok)throw Object.assign(new Error(data.error??'تعذر إتمام العملية. / Unable to complete operation.'),{status:response.status});return data;
}
