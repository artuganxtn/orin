'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import QRCode from 'qrcode';
import {Copy,LockKeyhole,RefreshCw,Clock3,Info,ArrowLeft,ArrowRight,ChevronDown,ChevronLeft,ChevronRight,ScanLine,Wallet,MessageCircleMore,ArrowDownLeft,Check,CircleCheck,CircleAlert} from 'lucide-react';
import {createDeposit,listDeposits,paymentReadiness,refreshDeposit} from '@/lib/payment-client';
import {PAYMENT_COINS,type PaymentCoin,type PaymentReadiness,type DepositView,type DepositStatus} from '@/lib/payments';
import type {TradingAccount} from '@/lib/trading-accounts';
import {useOrin} from './orin-settings';
import {useNavigation} from './orin-navigation';
import './funding-panel.css';

const statuses:Record<DepositStatus,[string,string]>={creating:['جار إنشاء طلب الدفع','Creating payment'],waiting:['بانتظار التحويل','Awaiting transfer'],confirming:['جار تأكيد الشبكة','Network confirmation'],confirmed:['تأكد التحويل؛ جار المعالجة','Confirmed; processing'],sending:['جار التسوية','Settling'],finished:['اكتمل الدفع','Payment completed'],partially_paid:['وصل مبلغ جزئي','Partially paid'],failed:['فشل الدفع','Payment failed'],refunded:['أُعيد المبلغ','Refunded'],expired:['انتهت صلاحية الطلب','Payment expired'],review:['الطلب قيد المراجعة','Payment under review']};
const tone=(s:DepositStatus,credited=false)=>credited||s==='finished'?'ok':['failed','expired','refunded'].includes(s)?'bad':'wait';
const COIN_NAMES:Record<string,string>={USDT:'Tether',BTC:'Bitcoin',ETH:'Ethereum'};
const splitNetwork=(network:string,label:string)=>{const [name,std]=network.split(' · ');return [name,std??label] as const;};

/** Brand-coloured network/coin marks drawn locally (no external image requests). */
function Mark({kind,size=40}:{kind:string;size?:number}){
 const s={width:size,height:size};
 if(kind==='usdttrc20'||kind==='TRON')return <span className="fp-mark" style={{...s,background:'#ef0027'}}><svg viewBox="0 0 24 24" width={size*.56} height={size*.56} fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round"><path d="M3.5 4.5 20 7.6 11.2 20.5Z"/><path d="M3.5 4.5 11.2 20.5 13 9.6 20 7.6M13 9.6 3.5 4.5"/></svg></span>;
 if(kind==='usdtbsc')return <span className="fp-mark" style={{...s,background:'#f3ba2f'}}><svg viewBox="0 0 24 24" width={size*.58} height={size*.58} fill="#fff"><path d="M12 3.2 14.6 5.8 12 8.4 9.4 5.8ZM6.3 8.9 8.9 11.5 6.3 14.1 3.7 11.5ZM17.7 8.9 20.3 11.5 17.7 14.1 15.1 11.5ZM12 9.1 14.6 11.7 12 14.3 9.4 11.7ZM12 14.9 14.6 17.5 12 20.1 9.4 17.5Z"/></svg></span>;
 if(kind==='eth'||kind==='ETH')return <span className="fp-mark" style={{...s,background:'#eef0fb'}}><svg viewBox="0 0 24 24" width={size*.55} height={size*.55}><path d="M12 2 5.8 12.2 12 15.9l6.2-3.7Z" fill="#627eea"/><path d="M12 17.1 5.8 13.4 12 22l6.2-8.6Z" fill="#8a9ff0"/></svg></span>;
 if(kind==='btc'||kind==='BTC')return <span className="fp-mark" style={{...s,background:'#f7931a',fontSize:size*.5}}>₿</span>;
 return <span className="fp-mark" style={{...s,background:'#26a17b',fontSize:size*.52}}>₮</span>;
}

function Hero({children,className=''}:{children:ReactNode;className?:string}){return <section className={'fp-hero '+className}><img className="fp-hero-swirl" src="/brand/orin-mark.png" alt=""/>{children}</section>}

export function FundingPanel({account,kind,onBalanceChange}:{account:TradingAccount|null;kind:'deposit'|'withdraw';onBalanceChange:()=>void}){
 const {t,number,prefs}=useOrin(),nav=useNavigation();
 const rtl=prefs.chartLocale==='ar',Fwd=rtl?ArrowLeft:ArrowRight,Chev=rtl?ChevronLeft:ChevronRight;
 const [ready,setReady]=useState<PaymentReadiness|null>(null),[items,setItems]=useState<DepositView[]>([]),[selected,setSelected]=useState<DepositView|null>(null),[amount,setAmount]=useState(''),[coin,setCoin]=useState<PaymentCoin>('usdttrc20'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState('');
 const [qr,setQr]=useState('');
 const [wNet,setWNet]=useState<PaymentCoin>('usdttrc20'),[wAmount,setWAmount]=useState(''),[wAddress,setWAddress]=useState(''),[wNotice,setWNotice]=useState('');
 const requestId=useRef<string|null>(null),mounted=useRef(true),submitting=useRef(false);
 const load=useCallback(async()=>{if(account?.type!=='real')return;try{const state=await paymentReadiness();if(!mounted.current)return;setReady(state);const history=await listDeposits(account.id);if(mounted.current)setItems(history.items)}catch(e){if(mounted.current)setError((e as Error).message)}},[account?.id,account?.type]);
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false}},[load]);
 useEffect(()=>{if(!selected||selected.credited||['finished','failed','expired'].includes(selected.status))return;const timer=setInterval(()=>{if(!busy&&mounted.current)void refresh(selected)},12000);return()=>clearInterval(timer);},[selected,busy]);
 useEffect(()=>{let live=true;setQr('');if(selected?.address)QRCode.toDataURL(selected.address,{margin:1,width:440,errorCorrectionLevel:'M',color:{dark:'#0b1a3d',light:'#ffffff'}}).then(url=>{if(live)setQr(url)}).catch(()=>{});return()=>{live=false}},[selected?.address]);

 async function submit(){
  if(!account||!ready?.deposits||submitting.current)return;
  if(!/^\d{1,6}(\.\d{1,2})?$/.test(amount)||Number(amount)<1000||Number(amount)>100000){setError(t('الحد الأدنى للإيداع هو 1,000 دولار أمريكي. أدخل مبلغًا صالحًا.','Minimum deposit is $1,000 USD. Enter a valid amount.'));return}
  submitting.current=true;setBusy(true);setError('');
  // Retain the same request identifier after an uncertain network result.
  requestId.current??=crypto.randomUUID();
  try{const item=await createDeposit({accountId:account.id,amountCents:Math.round(Number(amount)*100),coin,requestId:requestId.current});if(mounted.current){setSelected(item);setItems(old=>[item,...old.filter(x=>x.id!==item.id)]);requestId.current=null;}}
  catch(e){if(mounted.current)setError((e as Error).message)}finally{submitting.current=false;if(mounted.current)setBusy(false)}
 }
 async function refresh(item:DepositView){if(busy)return;setBusy(true);setError('');try{const result=await refreshDeposit(item.id);if(mounted.current){setSelected(result);setItems(old=>old.map(x=>x.id===result.id?result:x));if(result.credited)onBalanceChange()}}catch(e){if(mounted.current)setError((e as Error).message)}finally{if(mounted.current)setBusy(false)}}
 const copy=async(value:string,key:string)=>{try{await navigator.clipboard.writeText(value);setCopied(key);setTimeout(()=>{if(mounted.current)setCopied(c=>c===key?'':c)},1800)}catch{setError(t('حدد النص وانسخه يدويًا.','Select the text and copy it manually.'))}};
 const date=(n:number)=>new Date(n).toLocaleDateString(prefs.chartLocale+'-u-nu-latn',{timeZone:prefs.timezone,year:'numeric',month:'long',day:'numeric'});
 const time=(n:number)=>new Date(n).toLocaleTimeString(prefs.chartLocale+'-u-nu-latn',{timeZone:prefs.timezone,hour:'2-digit',minute:'2-digit'});
 const Header=({title,sub}:{title:string;sub:string})=><header className="fp-head"><h1>{title}</h1><p>{sub}</p></header>;
 const Note=({children,kind:k='warn'}:{children:ReactNode;kind?:'warn'|'info'})=><p className={'fp-note '+k}><Info size={18}/><span>{children}</span></p>;
 const ErrorBox=()=>error?<p className="fp-error" role="alert"><CircleAlert size={17}/><span>{error}</span></p>:null;

 if(!account||account.type!=='real')return <section className="fp"><Header title={kind==='deposit'?t('الإيداع','Deposit'):t('سحب الأموال','Withdraw funds')} sub={t('حساب حقيقي · USD','Real account · USD')}/><div className="fp-card fp-empty"><LockKeyhole/><p>{t('الإيداع والسحب متاحان للحساب الحقيقي فقط. الرصيد التجريبي غير قابل للسحب.','Deposits and withdrawals require a real account. Demo funds cannot be withdrawn.')}</p></div></section>;

 const finishedDeposits=items.filter(x=>x.status==='finished'||x.credited);
 const latestDeposit=finishedDeposits[0];
 const elapsedDays=latestDeposit?Math.floor((Date.now()-latestDeposit.createdAt)/86400000):0;
 const lockRemainingDays=latestDeposit?Math.max(0,20-elapsedDays):20;

 const loading=!ready&&<div className="fp-card fp-empty"><span className="orin-loader"/><p>{error?t('تعذر التحقق من الخدمة.','Unable to check service.'):t('جار التحقق من خدمة الدفع…','Checking payment service…')}</p>{error&&(error.includes('جلسة')||error.includes('session')?<button className="fp-btn primary" onClick={()=>nav.navigate('/login')}>{t('تسجيل الدخول لتنشيط الجلسة','Sign in to refresh session')}</button>:<button className="fp-btn outline" onClick={()=>{setError('');void load()}}><RefreshCw size={16}/>{t('إعادة المحاولة','Retry')}</button>)}</div>;

 /* ───────────── Withdrawal ───────────── */
 if(kind==='withdraw'){
  const net=PAYMENT_COINS.find(c=>c.id===wNet)!;
  const requestWithdrawal=()=>{
   setError('');setWNotice('');
   if(!/^\d{1,7}(\.\d{1,2})?$/.test(wAmount)||Number(wAmount)<=0){setError(t('أدخل مبلغ سحب صالحًا.','Enter a valid withdrawal amount.'));return}
   if(wAddress.trim().length<20){setError(t('أدخل عنوان محفظة صالحًا.','Enter a valid wallet address.'));return}
   if(lockRemainingDays>0){setError(latestDeposit?t(`لا يمكن السحب قبل مرور 20 يومًا من تاريخ الإيداع. متبقي ${lockRemainingDays} يومًا.`,`Withdrawals open 20 days after deposit. ${lockRemainingDays} days remaining.`):t('لا يمكن السحب إلا بعد مرور 20 يومًا من تاريخ أول إيداع مؤكد.','Withdrawals open 20 days after your first confirmed deposit.'));return}
   setWNotice(t('تم تجهيز طلب السحب. أكمل التحقق مع فريق الدعم لتنفيذ التحويل.','Your withdrawal request is ready. Complete verification with support to process the transfer.'));
  };
  return <section className="fp">
   <Header title={t('سحب الأموال','Withdraw funds')} sub={t('حساب حقيقي · USD','Real account · USD')}/>
   <Hero className="fp-hero-pay"><div className="fp-pay-brand"><span className="fp-pay-icon"><Wallet size={26}/></span><div><b>ORIN Pay</b><small>{t('سحب العملات الرقمية','Crypto withdrawal')}</small></div></div></Hero>
   {loading||<>
    <div className="fp-card">
     <h2 className="fp-card-title">{t('تفاصيل السحب','Withdrawal details')}</h2>
     <label className="fp-label">{t('شبكة التحويل','Network')}</label>
     <div className="fp-select"><Mark kind={wNet} size={28}/><b dir="ltr">{net.label} · {net.network}</b><ChevronDown size={18}/><select aria-label={t('شبكة التحويل','Network')} value={wNet} onChange={e=>setWNet(e.target.value as PaymentCoin)}>{PAYMENT_COINS.map(c=><option key={c.id} value={c.id}>{c.label} · {c.network}</option>)}</select></div>
     <label className="fp-label" htmlFor="fp-w-amount">{t('مبلغ السحب','Withdrawal amount')}</label>
     <div className="fp-input"><input id="fp-w-amount" inputMode="decimal" dir="ltr" placeholder={t('أدخل المبلغ','Enter amount')} value={wAmount} onChange={e=>setWAmount(e.target.value)}/><span className="fp-suffix">{net.label}</span></div>
     <label className="fp-label" htmlFor="fp-w-address">{t('عنوان المحفظة','Wallet address')}</label>
     <div className="fp-input"><input id="fp-w-address" dir="ltr" autoComplete="off" spellCheck={false} placeholder={t('أدخل عنوان محفظتك','Enter your wallet address')} value={wAddress} onChange={e=>setWAddress(e.target.value.trim())}/><span className="fp-suffix icon"><ScanLine size={20}/></span></div>
     <Note kind="info">{t('تأكد من تطابق عنوان المحفظة مع الشبكة المختارة','Make sure the wallet address matches the selected network')}</Note>
    </div>
    {lockRemainingDays>0&&<p className="fp-note warn"><LockKeyhole size={17}/><span><b>{t('فترة الحجز 20 يومًا','20-day holding period')}</b> · {latestDeposit?t(`متبقي ${lockRemainingDays} يومًا لإتاحة السحب.`,`${lockRemainingDays} days until withdrawals open.`):t('يتاح السحب بعد 20 يومًا من أول إيداع مؤكد.','Withdrawals open 20 days after your first confirmed deposit.')}</span></p>}
    <ErrorBox/>
    {wNotice&&<p className="fp-success" role="status"><CircleCheck size={17}/><span>{wNotice}</span></p>}
    <button className="fp-btn primary big" onClick={requestWithdrawal}><span className="fp-btn-ring"><Fwd size={16}/></span>{t('طلب السحب','Request withdrawal')}</button>
    <button className="fp-btn outline big" onClick={()=>nav.navigate('/support')}><MessageCircleMore size={20}/>{t('التواصل مع الدعم','Contact support')}</button>
    <p className="fp-foot">{t('تخضع الطلبات لشروط السحب المعتمدة','Requests are subject to the approved withdrawal terms')}</p>
   </>}
  </section>;
 }

 /* ───────────── Deposit ───────────── */
 const network=PAYMENT_COINS.find(x=>x.id===(selected?.coin??coin))!;
 const [netName,netStd]=splitNetwork(network.network,network.label);
 const title=t('إيداع ','Deposit ')+network.label;
 const history=items.length>0&&<div className="fp-history"><h3>{t('آخر الإيداعات','Recent deposits')}</h3>{items.map(item=><button key={item.id} disabled={busy} className={selected?.id===item.id?'active':''} onClick={()=>{setSelected(item);setCopied('');setError('')}}><span className="fp-history-main"><b dir="ltr">{number(item.amountCents/100)} USD</b><small dir="ltr">{new Date(item.createdAt).toLocaleDateString('en-CA')}</small></span><span className={'fp-dot-status '+tone(item.status,item.credited)}><i/>{t(...statuses[item.status])}</span><Chev size={18} className="fp-history-chev"/></button>)}</div>;

 if(!ready)return <section className="fp"><Header title={title} sub={t('إيداع العملات الرقمية','Crypto deposit')}/>{loading}</section>;
 if(!ready.deposits)return <section className="fp"><Header title={title} sub={t('إيداع العملات الرقمية','Crypto deposit')}/><div className="fp-card fp-empty"><LockKeyhole/><p>{t('استقبال الإيداعات بانتظار اكتمال ربط الخادم وتأكيد المدفوعات. ستظهر بيانات التحويل بعد التفعيل.','Deposits await server connection and payment confirmation setup. Transfer details will appear after activation.')}</p></div></section>;

 // Step 2 — awaiting transfer: address + QR.
 if(selected&&selected.address&&selected.status==='waiting'){
  const payAmount=selected.payAmount??(network.label==='USDT'?(selected.amountCents/100).toFixed(2):null);
  return <section className="fp">
   <Header title={title} sub={t('تفاصيل التحويل','Transfer details')}/>
   <Hero>
    <div className="fp-hero-row"><div><small>{t('المبلغ المطلوب','Amount to send')}</small><strong dir="ltr">{payAmount??'—'} <em>{network.label}</em></strong></div><span className="fp-pill wait"><Clock3 size={16}/>{t(...statuses[selected.status])}</span></div>
    <div className="fp-hero-split"><span className="fp-hero-coin"><Mark kind={network.label} size={34}/><b>{network.label}</b></span><i/><span className="fp-hero-net"><Mark kind={selected.coin} size={34}/><span className="fp-chip" dir="ltr">{network.network}</span></span></div>
   </Hero>
   <div className="fp-card">
    <h2 className="fp-card-title">{t('رمز الإيداع','Deposit code')}</h2><p className="fp-card-sub" dir="ltr">{t('شبكة ','Network ')}{network.network}</p>
    <div className="fp-qr"><span className="c tl"/><span className="c tr"/><span className="c bl"/><span className="c br"/>{qr?<img src={qr} alt={t('رمز QR لعنوان الإيداع','Deposit address QR code')}/>:<span className="orin-loader"/>}</div>
    <p className="fp-qr-cap">{t('امسح الرمز من محفظتك','Scan from your wallet')}</p>
    <hr/>
    <label className="fp-label">{t('عنوان الإيداع','Deposit address')}</label>
    <div className="fp-address" dir="ltr" onClick={e=>{const r=document.createRange();r.selectNodeContents(e.currentTarget);const s=getSelection();s?.removeAllRanges();s?.addRange(r)}}>{selected.address}</div>
    {selected.extraId&&<><label className="fp-label">{t('المذكرة المطلوبة','Required memo')}</label><div className="fp-address" dir="ltr">{selected.extraId}</div></>}
    <button className="fp-btn primary" onClick={()=>void copy(selected.address!,'address')}>{copied==='address'?<Check size={18}/>:<Copy size={18}/>}{copied==='address'?t('تم النسخ','Copied'):t('نسخ عنوان الإيداع','Copy deposit address')}</button>
   </div>
   <Note>{t(`أرسل ${network.label} عبر شبكة ${netStd} فقط. أرسل المبلغ المحدد؛ رسوم محفظتك قد تكون إضافية.`,`Send ${network.label} on ${netStd} only. Send the exact amount; your wallet may charge extra fees.`)}</Note>
   <ErrorBox/>
   <div className="fp-actions"><button className="fp-btn outline" disabled={busy} onClick={()=>void refresh(selected)}><RefreshCw size={16} className={busy?'fp-spin':''}/>{t('تحديث حالة الدفع','Refresh status')}</button><button className="fp-btn outline" disabled={busy} onClick={()=>setSelected(null)}>{t('العودة إلى الإيداعات','Back to deposits')}</button></div>
   {history}
  </section>;
 }

 // Transaction details (any other state).
 if(selected){
  const st=tone(selected.status,selected.credited),addr=selected.address;
  const rows:[string,ReactNode][]= [
   [t('رقم الطلب','Request ID'),<span className="fp-copyable" dir="ltr">{(selected.paymentId??selected.id).slice(-12).toUpperCase()}<button aria-label={t('نسخ','Copy')} onClick={()=>void copy(selected.paymentId??selected.id,'id')}>{copied==='id'?<Check size={15}/>:<Copy size={15}/>}</button></span>],
   [t('الشبكة','Network'),<span className="fp-inline-net" dir="ltr"><Mark kind={selected.coin} size={22}/>{network.network}</span>],
  ];
  return <section className="fp fp-receipt-wrap">
   <div className="fp-receipt-top"><h1>{t('تفاصيل المعاملة','Transaction details')}</h1></div>
   <article className="fp-receipt">
    <div className="fp-receipt-head"><span className="fp-receipt-icon"><ArrowDownLeft size={26}/></span><small>{title}</small><strong dir="ltr">{number(selected.amountCents/100)} <em>USD</em></strong><span className={'fp-pill '+st}>{st==='ok'?<CircleCheck size={15}/>:st==='bad'?<CircleAlert size={15}/>:<Clock3 size={15}/>}{t(...statuses[selected.status])}</span>{selected.credited&&<p>{t('أضيف المبلغ إلى حسابك الحقيقي.','The deposit was credited to your real account.')}</p>}{['creating','review','partially_paid'].includes(selected.status)&&<p>{t('راجع حالة هذا الطلب قبل إنشاء إيداع آخر.','Check this request before creating another deposit.')}</p>}</div>
    <div className="fp-receipt-cut"/>
    <div className="fp-receipt-body">
     <h3>{t('تفاصيل التحويل','Transfer details')}</h3>
     <dl>
      {rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      <hr/>
      <div><dt>{t('التاريخ','Date')}</dt><dd>{date(selected.createdAt)}</dd></div>
      <div><dt>{t('الوقت','Time')}</dt><dd dir="ltr">{time(selected.createdAt)}</dd></div>
      <div><dt>{t('عنوان الإيداع','Deposit address')}</dt><dd>{addr?<span className="fp-copyable" dir="ltr">{addr.slice(0,1)+'•'.repeat(12)+addr.slice(-3)}<button aria-label={t('نسخ','Copy')} onClick={()=>void copy(addr,'addr')}>{copied==='addr'?<Check size={15}/>:<Copy size={15}/>}</button></span>:<span className="fp-muted">{t('لم يصدر بعد','Not issued yet')}</span>}</dd></div>
      <hr/>
      <div><dt>{t('المبلغ المطلوب','Amount due')}</dt><dd dir="ltr">{selected.payAmount?`${selected.payAmount} ${network.label}`:'—'}</dd></div>
     </dl>
     <div className="fp-net-row"><span>{t('مبلغ الإيداع','Deposit amount')}</span><b dir="ltr">{number(selected.amountCents/100)} USD</b></div>
    </div>
   </article>
   <ErrorBox/>
   <button className="fp-help" onClick={()=>nav.navigate('/support')}><MessageCircleMore size={19}/>{t('تحتاج مساعدة؟','Need help?')}</button>
   <div className="fp-actions">{!selected.credited&&!['finished','failed','expired','refunded'].includes(selected.status)&&<button className="fp-btn outline" disabled={busy} onClick={()=>void refresh(selected)}><RefreshCw size={16} className={busy?'fp-spin':''}/>{t('تحديث حالة الدفع','Refresh status')}</button>}</div>
   <button className="fp-btn primary big" disabled={busy} onClick={()=>setSelected(null)}><Fwd size={18} className="fp-flip"/>{t('العودة إلى الإيداعات','Back to deposits')}</button>
  </section>;
 }

 // Step 1 — choose network and amount.
 return <section className="fp">
  <Header title={title} sub={t('اختر شبكة الإيداع','Choose the deposit network')}/>
  <ol className="fp-steps"><li className="on"><span>1</span>{t('اختيار الشبكة','Network')}</li><li className="line"/><li><span>2</span>{t('عنوان الإيداع','Address')}</li></ol>
  <Hero className="fp-hero-coin-card"><small>{t('عملة الإيداع','Deposit currency')}</small><div className="fp-hero-asset"><Mark kind={network.label} size={58}/><div><strong>{network.label}</strong><span>{COIN_NAMES[network.label]??network.label}</span></div></div></Hero>
  <form className="fp-card" onSubmit={e=>{e.preventDefault();void submit()}}>
   <h2 className="fp-card-title">{t('شبكة التحويل','Transfer network')}</h2><p className="fp-card-sub">{t('اختر الشبكة المستخدمة في محفظتك','Choose the network used by your wallet')}</p>
   <div className="fp-options" role="radiogroup" aria-label={t('شبكة التحويل','Transfer network')}>{PAYMENT_COINS.map(c=>{const [name,std]=splitNetwork(c.network,c.label),on=coin===c.id;return <button type="button" role="radio" aria-checked={on} key={c.id} disabled={busy||requestId.current!==null} className={'fp-option'+(on?' on':'')} onClick={()=>setCoin(c.id)}><Mark kind={c.id} size={46}/><span className="fp-option-text"><b dir="ltr">{name}</b><span className="fp-chip" dir="ltr">{c.label} · {std}</span></span><span className="fp-radio"><i/>{on&&<small>{t('تم الاختيار','Selected')}</small>}</span></button>})}</div>
   <label className="fp-label" htmlFor="fp-d-amount">{t('مبلغ الإيداع · USD','Deposit amount · USD')}</label>
   <div className="fp-input"><input id="fp-d-amount" inputMode="decimal" dir="ltr" value={amount} disabled={busy||requestId.current!==null} onChange={e=>setAmount(e.target.value)} placeholder="1000.00" required/><span className="fp-suffix">USD</span></div>
   <div className="fp-quick">{['1000','2500','5000','10000'].map(v=><button type="button" key={v} className={amount===v?'on':''} disabled={busy||requestId.current!==null} onClick={()=>setAmount(v)} dir="ltr">${Number(v).toLocaleString('en-US')}</button>)}</div>
   <p className="fp-card-sub">{t('الحد الأدنى للإيداع 1,000$. لا يُضاف الرصيد حتى يؤكد المزود اكتمال الدفع.','Minimum $1,000. Funds are credited after the provider confirms payment.')}</p>
  </form>
  <Note>{t(`يجب أن تتطابق شبكة الإرسال مع شبكة الإيداع (${netName}).`,`Your sending network must match the deposit network (${netName}).`)}</Note>
  <ErrorBox/>
  <button className="fp-btn primary big" disabled={busy||!amount} onClick={()=>void submit()}>{busy?<><RefreshCw size={18} className="fp-spin"/>{t('جار إنشاء الطلب…','Creating request…')}</>:<>{t('متابعة إلى عنوان الإيداع','Continue to deposit address')}<Fwd size={19}/></>}</button>
  <p className="fp-foot">{t('سيظهر عنوان الإيداع ورمز QR في الخطوة التالية','The deposit address and QR code appear in the next step')}</p>
  {history}
 </section>;
}
