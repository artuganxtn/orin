import {collection,doc,getDoc,getDocs,limit,orderBy,query,runTransaction,serverTimestamp,type Firestore} from 'firebase/firestore';
import {demoMovement,type DemoWallet,type DemoWalletView,type DemoOperation,type WalletPocket} from '../lib/demo-wallet';
class DemoError extends Error{constructor(message:string,public status=400){super(message)}}
const valid=(id:unknown):id is string=>typeof id==='string'&&(id==='primary'||/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id));
export const demoRef=(db:Firestore,uid:string,id:string)=>doc(db,'orinDemoWallets',uid,'accounts',id);
export async function readDemoWallet(db:Firestore,uid:string,id:string):Promise<DemoWallet|null>{const s=await getDoc(demoRef(db,uid,id));return s.exists()?{...s.data(),updatedAt:s.data().updatedAt?.toMillis?.()??0} as DemoWallet:null}
export function demoWalletApi(db:Firestore){return async(uid:string,method:string,input:Record<string,unknown>):Promise<DemoWalletView>=>{
 const accountId=input.accountId;if(!valid(accountId))throw new DemoError('الحساب غير صالح. / Invalid account.');
 const accountRef=doc(db,'sparkTradingAccounts',uid,'accounts',accountId),walletRef=demoRef(db,uid,accountId);
 const requireDemo=(d:Record<string,unknown>|undefined)=>{if(d?.ownerId!==uid||d?.type!=='demo')throw new DemoError('هذه العملية خاصة بالحساب التجريبي فقط. / Demo account required.',403)};
 const account=await getDoc(accountRef);requireDemo(account.data());
 if(method==='POST'){
  if(Object.keys(input).some(k=>!['accountId','requestId','kind','amountCents','currency','from'].includes(k))||input.currency!=='USD'||!valid(input.requestId)||input.requestId==='primary'||!['reset','transfer'].includes(String(input.kind)))throw new DemoError('طلب غير صالح. / Invalid request.');
  const {requestId,kind,amountCents}=input as {requestId:string;kind:'reset'|'transfer';amountCents:number};
  const from:WalletPocket=kind==='reset'?'futures':input.from as WalletPocket;
  const operationRef=doc(walletRef,'operations',requestId);
  for(let attempt=0;attempt<3;attempt++){try{await runTransaction(db,async tx=>{
   const [a,w,op,legacy]=await Promise.all([tx.get(accountRef),tx.get(walletRef),tx.get(operationRef),tx.get(doc(db,'orinAccounts',uid))]);requireDemo(a.data());
   if(op.exists()){
    const d=op.data();if(d.kind!==kind||d.amountCents!==amountCents||d.from!==(kind==='reset'?'reset':from)||d.currency!==input.currency)throw new DemoError('معرّف الطلب مستخدم لعملية أخرى. / Request identifier already used.',409);return;
   }
   // Legacy contract engine can reserve primary demo funds; never override active collateral.
   if(Number(a.data()?.reservedCents??0)!==0||(accountId==='primary'&&Number(legacy.data()?.reservedCents??0)!==0))throw new DemoError('أغلق المراكز التجريبية المحجوزة قبل ضبط الرصيد أو تحويله. / Close reserved demo positions first.',409);
   const before=w.exists()?w.data() as DemoWallet:null;let next;try{next=demoMovement(before,kind,amountCents,from)}catch(e){throw new DemoError((e as Error).message)}const version=(before?.version??0)+1;
   tx.set(walletRef,{ownerId:uid,accountId,currency:'USD',...next,version,lastOperationId:requestId,updatedAt:serverTimestamp()});
   tx.set(operationRef,{ownerId:uid,accountId,currency:'USD',kind,from:kind==='reset'?'reset':from,to:kind==='reset'?'futures':from==='futures'?'perpetual':'futures',amountCents,beforeFuturesCents:before?.futuresCents??0,beforePerpetualCents:before?.perpetualCents??0,afterFuturesCents:next.futuresCents,afterPerpetualCents:next.perpetualCents,version,createdAt:serverTimestamp()});
  });break;}catch(error){if(attempt<2&&(error as {code?:string}).code==='permission-denied')continue;throw error}}
 }else if(method!=='GET')throw new DemoError('طريقة غير متاحة. / Method unavailable.',405);
 const [wallet,ops]=await Promise.all([readDemoWallet(db,uid,accountId),getDocs(query(collection(walletRef,'operations'),orderBy('createdAt','desc'),limit(20)))]);
 return {wallet,operations:ops.docs.map(d=>({id:d.id,...d.data(),createdAt:d.data().createdAt?.toMillis?.()??0}) as DemoOperation)};
}}
