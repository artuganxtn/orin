'use client';
import {useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {Settings2,X,ShieldCheck} from 'lucide-react';
import type {TradingAccount} from '@/lib/trading-accounts';
import {parseUsdAmount} from '@/lib/demo-wallet';
import {demoWalletRequest} from '@/lib/demo-wallet-client';
import {useOrin} from './orin-settings';
export function DemoBalanceDialog({account,open,onOpenChange,onSaved}:{account:TradingAccount;open:boolean;onOpenChange:(value:boolean)=>void;onSaved:()=>Promise<void>}){
 const {t,prefs}=useOrin(),[amount,setAmount]=useState('1000'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef<{key:string;id:string}|null>(null),submitting=useRef(false);
 async function submit(){
  if(account.type!=='demo'||submitting.current)return;
  let cents:number;try{cents=parseUsdAmount(amount)}catch(e){setError((e as Error).message);return}
  const key=account.id+':'+cents;if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
  submitting.current=true;setBusy(true);setError('');
  try{await demoWalletRequest(account.id,{requestId:request.current.id,kind:'reset',amountCents:cents});await onSaved();request.current=null;onOpenChange(false)}catch(e){setError((e as Error).message)}finally{submitting.current=false;setBusy(false)}
 }
 if(account.type!=='demo')return null;
 return <Dialog.Root open={open} onOpenChange={v=>{if(!busy)onOpenChange(v)}}><Dialog.Portal><Dialog.Overlay className="demo-sheet-overlay"/><Dialog.Content className="demo-balance-sheet" dir={prefs.chartLocale==='ar'?'rtl':'ltr'} onEscapeKeyDown={e=>{if(busy)e.preventDefault()}} onPointerDownOutside={e=>{if(busy)e.preventDefault()}}>
  <div className="demo-sheet-title"><span className="account-mode-badge demo">{t('تجريبي','Demo')}</span><Dialog.Close aria-label={t('إغلاق','Close')} disabled={busy}><X size={21}/></Dialog.Close></div>
  <Dialog.Title>{t('ضبط الرصيد التجريبي','Adjust demo balance')}</Dialog.Title><Dialog.Description>{t('حدّد إجمالي الرصيد الافتراضي لحسابك. سيُضاف إلى محفظة العقود الآجلة ويصبح رصيد الدائمة صفرًا.','Set your total virtual balance. It is placed in Futures and the Perpetual balance becomes zero.')}</Dialog.Description>
  <form onSubmit={e=>{e.preventDefault();void submit()}}><div className="demo-amount-row"><label>{t('المبلغ','Amount')}<input autoFocus inputMode="decimal" dir="ltr" value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)} aria-label={t('المبلغ التجريبي','Demo amount')}/></label><label>{t('العملة','Currency')}<select value="USD" disabled aria-label={t('العملة','Currency')}><option>USD</option></select></label></div>
  <p className="demo-separation-note"><ShieldCheck size={17}/>{t('أموال افتراضية فقط؛ لا تؤثر في رصيدك الحقيقي.','Virtual funds only; your real balance is unaffected.')}</p>
  {account.reservedCents>0&&<p role="status">{t('أغلق المراكز المحجوزة أولًا.','Close reserved positions first.')}</p>}{error&&<p className="orin-account-error" role="alert">{error}</p>}
  <button className="btn-primary full" disabled={busy||account.reservedCents>0}><Settings2 size={18}/>{t(busy?'جار الحفظ…':'ضبط الرصيد',busy?'Saving…':'Set balance')}</button></form>
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
