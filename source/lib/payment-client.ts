import {inactivePayments,type PaymentReadiness,type DepositView} from './payments';
import {ensureFreshSecurityAccess} from './account-security-client';
type Runtime={base?:string;token:()=>Promise<string|null>};
let runtime:Runtime|null=null;
function isValidPaymentsEndpoint(base:string){
 if(base==='https://europe-west1-orin-99951.cloudfunctions.net/orinPayments')return true;
 if(/^https:\/\/[a-z0-9-]+\.onrender\.com(\/.*)?$/i.test(base))return true;
 if(typeof import.meta!=='undefined'&&(import.meta as any).env?.VITE_ORIN_PAYMENTS_API_URL===base)return true;
 return false;
}
export function configurePayments(value:Runtime){
 if(value.base&&!isValidPaymentsEndpoint(value.base))throw new Error('Unapproved ORIN payments endpoint');
 runtime=value;
}
async function request<T>(path:string,body?:unknown):Promise<T>{
 if(!runtime?.base)throw new Error('ربط خادم الدفع لم يكتمل بعد. / Payment service setup is incomplete.');
 if(typeof navigator!=='undefined'&&!navigator.onLine)throw new Error('تحقق من اتصال الإنترنت. / Check your internet connection.');
 const session=await ensureFreshSecurityAccess(),token=await runtime.token();if(!token)throw new Error('سجّل الدخول للمتابعة. / Sign in to continue.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 try{
  const headers=new Headers({Authorization:'Bearer '+token,'Content-Type':'application/json'});if(session)headers.set('X-Orin-Session',session);
  const response=await fetch(runtime.base+'/api/payments/'+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',signal:controller.signal,redirect:'error'});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('خدمة الدفع غير متاحة حاليًا. / Payment service unavailable.');
  const result=await response.json();if(!result||typeof result!=='object')throw new Error('Invalid payment response');if(!response.ok)throw new Error('error' in result&&typeof result.error==='string'?result.error:'Payment request failed');return result as T;
 }finally{clearTimeout(timer)}
}
export const paymentReadiness=():Promise<PaymentReadiness>=>runtime?.base?request('readiness'):Promise.resolve(inactivePayments);
export const createDeposit=(body:unknown)=>request<DepositView>('deposits',body);
export const refreshDeposit=(id:string)=>request<DepositView>('deposits/'+encodeURIComponent(id)+'?refresh=true');
export const listDeposits=(accountId:string)=>runtime?.base?request<{items:DepositView[]}>('deposits?accountId='+encodeURIComponent(accountId)):Promise.resolve({items:[] as DepositView[]});

export const paymentHistoryConfigured=()=>!!runtime?.base;
