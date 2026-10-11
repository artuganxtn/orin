'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Copy,LockKeyhole,RefreshCw,Check} from 'lucide-react';
import {createDeposit,listDeposits,paymentReadiness,refreshDeposit} from '@/lib/payment-client';
import {PAYMENT_COINS,type PaymentCoin,type PaymentReadiness,type DepositView,type DepositStatus} from '@/lib/payments';
import type {TradingAccount} from '@/lib/trading-accounts';
import {useOrin} from './orin-settings';
import {useNavigation} from './orin-navigation';
import {apiFetch} from '@/lib/client-api';
const statuses:Record<DepositStatus,[string,string]>={creating:['جار إنشاء طلب الدفع','Creating payment'],waiting:['بانتظار التحويل','Awaiting transfer'],confirming:['جار تأكيد الشبكة','Network confirmation'],confirmed:['تأكد التحويل؛ جار المعالجة','Confirmed; processing'],sending:['جار التسوية','Settling'],finished:['اكتمل الدفع','Payment completed'],partially_paid:['وصل مبلغ جزئي','Partially paid'],failed:['فشل الدفع','Payment failed'],refunded:['أُعيد المبلغ','Refunded'],expired:['انتهت صلاحية الطلب','Payment expired'],review:['الطلب قيد المراجعة','Payment under review']};
export function FundingPanel({account,kind,onBalanceChange}:{account:TradingAccount|null;kind:'deposit'|'withdraw';onBalanceChange:()=>void}){
 const {t,number}=useOrin(),nav=useNavigation();
 const [ready,setReady]=useState<PaymentReadiness|null>(null),[items,setItems]=useState<DepositView[]>([]),[selected,setSelected]=useState<DepositView|null>(null),[amount,setAmount]=useState(''),[coin,setCoin]=useState<PaymentCoin>('usdttrc20'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
 const [withdrawAmount,setWithdrawAmount]=useState(''),[withdrawCoin,setWithdrawCoin]=useState<PaymentCoin>('usdttrc20'),[withdrawAddress,setWithdrawAddress]=useState(''),[withdrawSuccess,setWithdrawSuccess]=useState(false),[withdrawSubmitting,setWithdrawSubmitting]=useState(false);
 const requestId=useRef<string|null>(null),mounted=useRef(true),submitting=useRef(false);
 const load=useCallback(async()=>{if(account?.type!=='real')return;try{const state=await paymentReadiness();if(!mounted.current)return;setReady(state);const history=await listDeposits(account.id);if(mounted.current)setItems(history.items)}catch(e){if(mounted.current)setError((e as Error).message)}},[account?.id,account?.type]);
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false}},[load]);
 useEffect(()=>{if(!selected||selected.credited||['finished','failed','expired'].includes(selected.status))return;const timer=setInterval(()=>{if(!busy&&mounted.current)void refresh(selected)},12000);return()=>clearInterval(timer);},[selected,busy]);
 async function submit(){
  if(!account||!ready?.deposits||submitting.current)return;
  if(!/^\d{1,6}(\.\d{1,2})?$/.test(amount)||Number(amount)<1000||Number(amount)>100000){setError(t('الحد الأدنى للإيداع هو 1,000 دولار أمريكي. أدخل مبلغًا صالحًا.','Minimum deposit is $1,000 USD. Enter a valid amount.'));return}
  submitting.current=true;setBusy(true);setError('');
  // Retain the same request identifier after an uncertain network result.
  requestId.current??=crypto.randomUUID();
  try{const item=await createDeposit({accountId:account.id,amountCents:Math.round(Number(amount)*100),coin,requestId:requestId.current});if(mounted.current){setSelected(item);setItems(old=>[item,...old.filter(x=>x.id!==item.id)]);requestId.current=null;}}
  catch(e){if(mounted.current)setError((e as Error).message)}finally{submitting.current=false;if(mounted.current)setBusy(false)}
 }
 async function submitWithdrawal(){
  if(!account||withdrawSubmitting)return;
  const num=Number(withdrawAmount);
  if(!withdrawAmount||Number.isNaN(num)||num<=0){setError(t('أدخل مبلغًا صالحًا للسحب.','Enter a valid withdrawal amount.'));return}
  if(!withdrawAddress.trim()){setError(t('أدخل عنوان المحفظة المستلمة.','Enter destination wallet address.'));return}
  const availableBal=(account.balanceCents??0)/100;
  if(num>availableBal){setError(t(`المبلغ المطلوب يتجاوز الرصيد المتاح ($${number(availableBal)}).`,`Requested amount exceeds available balance ($${number(availableBal)}).`));return}
  setWithdrawSubmitting(true);setError('');
  try{
   const res=await apiFetch('/api/withdrawals',{method:'POST',body:JSON.stringify({accountId:account.id,amountCents:Math.round(num*100),coin:withdrawCoin,address:withdrawAddress.trim()})});
   const json=await res.json();
   if(!res.ok)throw new Error(json.error||'Failed to submit withdrawal');
   setWithdrawSuccess(true);
  }catch(e){setError((e as Error).message||t('تعذر إرسال طلب السحب.','Failed to submit withdrawal request.'))}
  finally{setWithdrawSubmitting(false)}
 }
 async function refresh(item:DepositView){if(busy)return;setBusy(true);setError('');try{const result=await refreshDeposit(item.id);if(mounted.current){setSelected(result);setItems(old=>old.map(x=>x.id===result.id?result:x));if(result.credited)onBalanceChange()}}catch(e){if(mounted.current)setError((e as Error).message)}finally{if(mounted.current)setBusy(false)}}
 if(!account||account.type!=='real')return <div className="funding-message"><LockKeyhole/><p>{t('الإيداع والسحب متاحان للحساب الحقيقي فقط. الرصيد التجريبي غير قابل للسحب.','Deposits and withdrawals require a real account. Demo funds cannot be withdrawn.')}</p></div>;
 const network=PAYMENT_COINS.find(x=>x.id===(selected?.coin??coin));
 return <section className="orin-funding"><div className="funding-provider"><b>ORIN Pay</b><span>{kind==='deposit'?t('إيداع العملات الرقمية','Crypto deposit'):t('سحب العملات الرقمية','Crypto withdrawal')}</span></div>
  {error&&<p className="funding-error" role="alert">{error}</p>}
  {kind==='withdraw'?(
   withdrawSuccess?(
    <div className="funding-message">
     <Check size={28} className="gain"/>
     <p><b>{t('تم تسجيل طلب السحب بنجاح','Withdrawal request submitted')}</b></p>
     <p>{t('طلبك قيد المراجعة اليدوية من قِبل الإدارة. لن يتغير رصيدك حتى يتم التدقيق والاعتماد.','Your request is under manual review by the administration. Your balance is unaffected until reviewed.')}</p>
     <button className="btn-outline" onClick={()=>{setWithdrawSuccess(false);setWithdrawAmount('');setWithdrawAddress('');}}>{t('طلب سحب جديد','New withdrawal request')}</button>
    </div>
   ):(
    <form onSubmit={e=>{e.preventDefault();void submitWithdrawal()}}>
     <label>{t('مبلغ السحب · USD','Withdrawal amount · USD')}
      <input inputMode="decimal" dir="ltr" value={withdrawAmount} disabled={withdrawSubmitting} onChange={e=>setWithdrawAmount(e.target.value)} placeholder="0.00" required/>
     </label>
     <label>{t('العملة والشبكة','Currency and network')}
      <select value={withdrawCoin} disabled={withdrawSubmitting} onChange={e=>setWithdrawCoin(e.target.value as PaymentCoin)}>
       {PAYMENT_COINS.map(c=><option key={c.id} value={c.id}>{c.label} — {c.network}</option>)}
      </select>
     </label>
     <label>{t('عنوان المحفظة المستلمة','Destination wallet address')}
      <input dir="ltr" value={withdrawAddress} disabled={withdrawSubmitting} onChange={e=>setWithdrawAddress(e.target.value)} placeholder="T... / 0x... / bc1..." required/>
     </label>
     <p className="field-hint">{t('عمليات السحب تتم يدويًا بعد المراجعة والتدقيق الإداري. لن يُخصم الرصيد تلقائيًا.','Withdrawals are processed manually following admin audit. Balance will not change automatically.')}</p>
     <button className="btn-primary" disabled={withdrawSubmitting||!withdrawAmount||!withdrawAddress}>{withdrawSubmitting?t('جار إرسال الطلب…','Submitting request…'):t('إرسال طلب السحب','Submit withdrawal request')}</button>
    </form>
   )
  ):!ready?<div className="funding-message"><p>{error?t('تعذر التحقق من الخدمة.','Unable to check service.'):t('جار التحقق من خدمة الدفع…','Checking payment service…')}</p>{error&&(error.includes('جلسة')||error.includes('session')?<button className="btn-primary" onClick={()=>nav.navigate('/login')}>{t('تسجيل الدخول لتنشيط الجلسة','Sign in to refresh session')}</button>:<button className="btn-outline" onClick={()=>{setError('');void load()}}>{t('إعادة المحاولة','Retry')}</button>)}</div>:!ready.deposits?<div className="funding-message"><LockKeyhole/><p>{t('استقبال الإيداعات بانتظار اكتمال ربط الخادم وتأكيد المدفوعات. ستظهر بيانات التحويل بعد التفعيل.','Deposits await server connection and payment confirmation setup. Transfer details will appear after activation.')}</p></div>:selected?<>
   <div className="funding-details"><strong>{number(selected.amountCents/100)} USD</strong><span>{network?.label} · {network?.network}</span><b>{t(...statuses[selected.status])}</b>{selected.credited&&<p>{t('أضيف المبلغ إلى حسابك الحقيقي.','The deposit was credited to your real account.')}</p>}
   {selected.address&&selected.status==='waiting'&&<><p>{t('أرسل المبلغ المحدد فقط، وباستخدام الشبكة الموضحة. رسوم محفظتك قد تكون إضافية.','Send the exact amount on the specified network. Your wallet may charge additional fees.')}</p><label>{t('المبلغ المطلوب','Amount to send')}<input readOnly dir="ltr" value={`${selected.payAmount} ${network?.label}`} onFocus={e=>e.currentTarget.select()}/></label><label>{t('عنوان الإيداع','Deposit address')}<input readOnly dir="ltr" value={selected.address} onFocus={e=>e.currentTarget.select()}/></label>{selected.extraId&&<label>{t('المذكرة المطلوبة','Required memo')}<input readOnly dir="ltr" value={selected.extraId} onFocus={e=>e.currentTarget.select()}/></label>}<button className="btn-outline" onClick={async()=>{try{await navigator.clipboard.writeText(selected.address!);setCopied(true)}catch{setError(t('حدد العنوان وانسخه يدويًا.','Select the address and copy it manually.'))}}}><Copy size={15}/>{copied?t('تم النسخ','Copied'):t('نسخ العنوان','Copy address')}</button></>}
   {['creating','review','partially_paid'].includes(selected.status)&&<p>{t('راجع حالة هذا الطلب قبل إنشاء إيداع آخر. تواصل مع الدعم عند الحاجة.','Check this request before creating another deposit. Contact support if needed.')}</p>}
   <small dir="ltr">{selected.paymentId??selected.id}</small></div><button className="btn-outline" disabled={busy} onClick={()=>void refresh(selected)}><RefreshCw size={15}/>{t('تحديث حالة الدفع','Refresh payment status')}</button><button className="btn-outline" disabled={busy} onClick={()=>setSelected(null)}>{t('العودة إلى الإيداعات','Back to deposits')}</button>
  </>:<form onSubmit={e=>{e.preventDefault();void submit()}}><label>{t('مبلغ الإيداع · USD (الحد الأدنى 1,000$)','Deposit amount · USD (Min $1,000)')}<input inputMode="decimal" dir="ltr" value={amount} disabled={busy||requestId.current!==null} onChange={e=>setAmount(e.target.value)} placeholder="1000.00" required/></label><label>{t('العملة والشبكة','Currency and network')}<select value={coin} disabled={busy||requestId.current!==null} onChange={e=>setCoin(e.target.value as PaymentCoin)}>{PAYMENT_COINS.map(c=><option key={c.id} value={c.id}>{c.label} — {c.network}</option>)}</select></label><p>{t('ستظهر بيانات الدفع بعد إنشاء الطلب. لا يُضاف الرصيد حتى يؤكد المزود اكتمال الدفع.','Payment details appear after creating the request. Funds are credited after the provider confirms completion.')}</p><button className="btn-primary" disabled={busy||!amount}>{busy?t('جار إنشاء الطلب…','Creating request…'):t('إنشاء طلب إيداع','Create deposit request')}</button></form>}
  {kind==='deposit'&&items.length>0&&<div className="funding-history"><h3>{t('آخر الإيداعات','Recent deposits')}</h3>{items.map(item=><button key={item.id} disabled={busy} onClick={()=>{setSelected(item);setCopied(false)}}><b dir="ltr">{number(item.amountCents/100)} USD</b><span>{t(...statuses[item.status])}</span><small>{new Date(item.createdAt).toLocaleDateString()}</small></button>)}</div>}
  <button className="btn-outline" onClick={()=>nav.navigate('/support')}>{t('التواصل مع الدعم','Contact support')}</button>
 </section>;
}
