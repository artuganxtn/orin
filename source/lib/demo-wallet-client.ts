import {apiFetch} from './client-api';
import type {DemoWalletView,WalletPocket} from './demo-wallet';
export async function demoWalletRequest(accountId:string,operation?:{requestId:string;kind:'reset'|'transfer';amountCents:number;from?:WalletPocket}):Promise<DemoWalletView>{
 const response=await apiFetch('/api/demo-wallet'+(operation?'':'?accountId='+encodeURIComponent(accountId)),operation?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId,currency:'USD',...operation})}:{});
 const data=await response.json() as DemoWalletView & {error?:string};if(!response.ok)throw new Error(response.status===403?'تعذر الوصول إلى المحفظة التجريبية. يلزم نشر قواعد هذا الإصدار والتحقق من صلاحية الحساب. / Demo wallet access unavailable. Deploy this release’s rules and check account access.':data.error??'تعذر إتمام العملية. / Unable to complete operation.');return data;
}
