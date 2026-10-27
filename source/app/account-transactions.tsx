'use client';
import {Fragment,useEffect,useRef,useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,ArrowLeftRight,Download,FileText,ChevronDown,RefreshCw,Wallet} from 'lucide-react';
import type {LabState} from '@/lib/contracts';
import {statementSnapshot,transactionDetails,transactionLabel,transactionStatus,type StatementSnapshot,type AccountTransaction} from '@/lib/account-transactions';
import {activeTradingAccount} from '@/lib/trading-accounts';
import {useOrin} from './orin-settings';
import {FullPage,FullPageContent} from './full-page';
import {useNavigation} from './orin-navigation';
import {WithdrawalReceiptView,type WithdrawalReceiptData} from './withdrawal-receipt';
import './recent-transactions.css';

export async function saveStatement(snapshot:StatementSnapshot,ar:boolean){
 const {downloadStatement}=await import('@/lib/statement-pdf');await downloadStatement(snapshot,ar);
}

// Both views use the existing account-scoped statement source, never sample transactions.
function useAccountStatement(state:LabState|null,enabled:boolean){
 const {t}=useOrin(),account=activeTradingAccount(state?.accountDirectory);
 const [result,setResult]=useState<{userId:string;snapshot:StatementSnapshot}|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const stateRef=useRef(state),ticket=useRef(0);stateRef.current=state;
 useEffect(()=>{
  setResult(null);setError('');
  if(!enabled||!state||!account)return;
  let disposed=false,inFlight=false;const version=++ticket.current,userId=state.user.id,accountId=account.id;
  const read=async()=>{
   if(disposed||inFlight||document.hidden)return;
   const current=stateRef.current;
   if(!current||current.user.id!==userId||activeTradingAccount(current.accountDirectory)?.id!==accountId)return;
   inFlight=true;
   try{
    const snapshot=await statementSnapshot(current);
    const latest=stateRef.current;
    if(!disposed&&ticket.current===version&&latest?.user.id===userId&&activeTradingAccount(latest?.accountDirectory)?.id===accountId){setResult({userId,snapshot});setError('')}
   }catch{if(!disposed)setError(t('تعذر الوصول إلى سجل الحساب.','Account activity is unavailable.'))}
   finally{inFlight=false}
  };
  void read();const timer=setInterval(()=>void read(),30000);
  window.addEventListener('online',read);document.addEventListener('visibilitychange',read);
  return()=>{disposed=true;clearInterval(timer);window.removeEventListener('online',read);document.removeEventListener('visibilitychange',read)};
 },[enabled,state?.user.id,account?.id,state?.ledger?.length,revision]);
 const snapshot=enabled&&result&&state&&account&&result.userId===state.user.id&&result.snapshot.account.id===account.id?result.snapshot:null;
 return {account,snapshot,error,retry:()=>setRevision(value=>value+1)};
}

function TransactionFilters({value,onChange}:{value:string;onChange:(value:string)=>void}){
 const {t}=useOrin();
 return <div className="activity-filters" role="group" aria-label={t('تصفية المعاملات','Filter transactions')}>{[['all',t('الكل','All')],['deposit',t('إيداع','Deposits')],['withdrawal',t('سحب','Withdrawals')]].map(([key,label])=><button type="button" key={key} aria-pressed={value===key} onClick={()=>onChange(key)}>{label}</button>)}</div>;
}
export function extractWithdrawalReceiptData(row: AccountTransaction): WithdrawalReceiptData {
 const w = row.withdrawal;
 const rawCents = Math.abs(w?.amountCents ?? row.amountCents ?? 0);
 const rawAmount = rawCents / 100;
 const fee = w?.feeCents !== undefined && Number.isFinite(w.feeCents) ? w.feeCents / 100 : Math.round(rawAmount * 5) / 100;
 const net = w?.netAmountCents !== undefined && Number.isFinite(w.netAmountCents) ? w.netAmountCents / 100 : Math.max(0, Math.round((rawAmount - fee) * 100) / 100);
 const cleanId = w?.id || row.id.replace(/^(jnl-)/, '');

 return {
  id: cleanId,
  accountId: w?.accountId || row.accountId,
  amount: rawAmount,
  fee: fee,
  netAmount: net,
  address: w?.address || '',
  coin: w?.coin || 'USDT',
  currency: w?.currency || row.currency || 'USD',
  network: 'BNB Smart Chain · BEP20',
  createdAt: w?.createdAt || row.createdAt,
  status: w?.status || (row.status === 'recorded' ? 'review' : row.status),
  txHash: w?.txHash || null,
 };
}

const isWithdrawalTx = (row: AccountTransaction) =>
 row.kind === 'withdrawal' || Boolean(row.withdrawal) || row.id.startsWith('wd-') || row.id.startsWith('jnl-wd-');

function TransactionAmounts({row}:{row:AccountTransaction}){
 const {t,prefs,number}=useOrin();
 const cash=(value:number|null|undefined)=>value==null||!Number.isFinite(value)?t('غير متاح','Not provided'):prefs.hideBalance?'••••':`${number(value/100)} ${row.currency}`;
 const rawCents = Math.abs(row.withdrawal?.amountCents ?? row.amountCents ?? 0);
 const feeCents = row.withdrawal?.feeCents ?? Math.round(rawCents * 0.05);
 const netCents = row.withdrawal?.netAmountCents ?? Math.max(0, rawCents - feeCents);
 return <dl className="transaction-figures">
  <div><dt>{t('المبلغ','Amount')}</dt><dd dir="auto">{cash(rawCents)}</dd></div>
  {row.kind==='withdrawal'&&<>
    <div><dt>{t('الرسوم','Fee')}</dt><dd dir="auto">{cash(feeCents)}</dd></div>
    <div><dt>{t('الصافي','Net amount')}</dt><dd dir="auto">{cash(netCents)}</dd></div>
  </>}
 </dl>;
}
function TransactionDetails({row,onWithdrawal}:{row:AccountTransaction;onWithdrawal?:()=>void}){
 const {t,prefs,number}=useOrin();
 return <section className="transaction-detail">
  <h3>{t('تفاصيل المعاملة','Transaction details')}</h3><TransactionAmounts row={row}/>
  <dl>{transactionDetails(row,prefs.chartLocale==='ar').map(([label,value])=><div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}</dl>
  {onWithdrawal&&<button type="button" className="transaction-receipt-link" onClick={onWithdrawal}><FileText size={16}/>{t('عرض إيصال السحب الكامل','View full withdrawal receipt')}</button>}
  {row.entries.length>0&&<details><summary>{t('القيود المحاسبية','Ledger entries')}</summary>{row.entries.map(entry=><div className="transaction-entry" key={entry.id}><bdi>{entry.account}</bdi><bdi>{prefs.hideBalance?'••••':number(entry.amount_cents/100)} USD</bdi></div>)}</details>}
 </section>;
}
function TransactionRow({row,selected,onSelect}:{row:AccountTransaction;selected:boolean;onSelect:()=>void}){
 const {t,prefs,number}=useOrin(),ar=prefs.chartLocale==='ar',Icon=row.kind==='deposit'?ArrowDownLeft:row.kind==='withdrawal'?ArrowUpRight:ArrowLeftRight;
 const statusTone=['paid','completed','credited','finished'].includes(row.status)?'complete':['failed','rejected','expired'].includes(row.status)?'failed':['requested','approved','review','waiting','creating','confirming','confirmed','sending','partially_paid'].includes(row.status)?'pending':'recorded';
 const date=Number.isFinite(row.createdAt)?new Date(row.createdAt).toLocaleString(prefs.chartLocale+'-u-nu-latn',{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):t('التاريخ غير متاح','Date unavailable');
 return <button type="button" className={'transaction-row'+(row.kind==='withdrawal'?' transaction-row-withdrawal':'')} onClick={onSelect} aria-expanded={selected}>
  <span className={'transaction-icon '+row.kind} aria-hidden="true">{row.kind==='withdrawal'?<><Wallet/><ArrowUpRight className="withdrawal-direction"/></>:<Icon/>}</span>
  <span className="transaction-copy"><b>{transactionLabel(row.kind,ar)}</b><small>{date}</small><em className={'transaction-state '+statusTone}>{transactionStatus(row.status,ar)}</em></span>
  <span className="transaction-amount" dir="ltr"><b>{prefs.hideBalance?'••••':row.amountCents===null?'—':`${row.amountCents>0&&(!row.deposit||row.status==='credited')?'+':''}${number(row.amountCents/100)}`}</b><small>{row.currency}</small></span>
  <ChevronDown size={16} className="transaction-chevron" aria-label={t('التفاصيل','Details')}/>
 </button>;
}
function ActivityError({message,retry}:{message:string;retry:()=>void}){
 const {t}=useOrin();
 return <div className="activity-notice" role="alert"><span>{message}</span><button type="button" onClick={retry}><RefreshCw size={14}/>{t('إعادة المحاولة','Retry')}</button></div>;
}
function ActivityCoverage({snapshot}:{snapshot:StatementSnapshot|null}){
 const {t}=useOrin();
 return snapshot?.paymentCoverage==='unavailable'?<p className="activity-notice">{t('سجل مزود الدفع غير متصل حاليًا. تُعرض الحركات المحاسبية المتاحة فقط.','Payment provider history is currently unavailable. Only available ledger activity is shown.')}</p>:null;
}

export function RecentTransactions({state,onViewAll}:{state:LabState|null;onViewAll:()=>void}){
 const {t}=useOrin(),navigation=useNavigation(),{account,snapshot,error,retry}=useAccountStatement(state,navigation.path==='/positions');
 const [filter,setFilter]=useState('all'),[selected,setSelected]=useState<string|null>(null),[selectedWd,setSelectedWd]=useState<{userId:string;accountId:string;data:WithdrawalReceiptData}|null>(null);
 useEffect(()=>{setSelected(null);setSelectedWd(null)},[account?.id,state?.user.id]);
 const rows=(snapshot?.transactions.filter(row=>filter==='all'||row.kind===filter)??[]).slice(0,5);
 const openWithdrawal=(row:AccountTransaction)=>{
  if(!state||!account)return;
  setSelectedWd({userId:state.user.id,accountId:account.id,data:extractWithdrawalReceiptData(row)});
 };
 return <section className="positions-recent" aria-labelledby="positions-recent-title">
  <header><div><h2 id="positions-recent-title">{t('المعاملات الأخيرة','Recent transactions')}</h2><p>{t('آخر الحركات المسجّلة في الحساب المحدد','Latest recorded activity in the selected account')}</p></div><button type="button" onClick={onViewAll}>{t('عرض الكل','View all')}</button></header>
  <TransactionFilters value={filter} onChange={value=>{setFilter(value);setSelected(null)}}/>
  {error&&<ActivityError message={error} retry={retry}/>}<ActivityCoverage snapshot={snapshot}/>
  {!snapshot&&!error?<p className="recent-transactions-empty" role="status">{!state?t('جار تحميل الحساب…','Loading account…'):!account?t('لا يوجد حساب محدد.','No account selected.'):t('جار قراءة السجل…','Reading account activity…')}</p>:snapshot&&<div className="activity-list">{rows.length?rows.map(row=><Fragment key={row.id}><TransactionRow row={row} selected={selected===row.id} onSelect={()=>{if(isWithdrawalTx(row)){openWithdrawal(row)}else{setSelected(selected===row.id?null:row.id)}}}/>{selected===row.id&&<TransactionDetails row={row} onWithdrawal={isWithdrawalTx(row)?()=>openWithdrawal(row):undefined}/>}</Fragment>):<p className="recent-transactions-empty">{t('لا توجد معاملات متاحة لهذا الفلتر. ستظهر الحركات هنا عند تسجيلها.','No available transactions for this filter. Activity will appear here when recorded.')}</p>}</div>}
  {selectedWd&&selectedWd.userId===state?.user.id&&selectedWd.accountId===account?.id&&<WithdrawalReceiptView withdrawal={selectedWd.data} onClose={()=>setSelectedWd(null)}/>}
 </section>;
}

export function AccountTransactions({state}:{state:LabState|null}){
 const nav=useNavigation(),{t,prefs}=useOrin(),open=nav.path==='/activity';
 const {account,snapshot:visible,error,retry}=useAccountStatement(state,open);
 const [exportError,setExportError]=useState(''),[busy,setBusy]=useState(false),[filter,setFilter]=useState('all'),[selected,setSelected]=useState<string|null>(null),[selectedWd,setSelectedWd]=useState<{userId:string;accountId:string;data:WithdrawalReceiptData}|null>(null);
 const exporting=useRef(false);
 useEffect(()=>{setSelected(null);setSelectedWd(null);setExportError('')},[open,account?.id,state?.user.id]);
 const rows=visible?.transactions.filter(row=>filter==='all'||row.kind===filter)??[];
 const exportPdf=async()=>{if(!visible||exporting.current)return;exporting.current=true;setBusy(true);setExportError('');try{await saveStatement(visible,prefs.chartLocale==='ar')}catch{setExportError(t('تعذر إنشاء كشف PDF. تحقق من المساحة المتاحة وحاول مجددًا.','Could not create the PDF. Check available storage and try again.'))}finally{exporting.current=false;setBusy(false)}};
 const openWithdrawal=(row:AccountTransaction)=>{
  if(!state||!account)return;
  setSelectedWd({userId:state.user.id,accountId:account.id,data:extractWithdrawalReceiptData(row)});
 };
 return <FullPage open={open} onOpenChange={value=>{if(!value){setSelectedWd(null);nav.back('/positions')}}}><FullPageContent pageClassName="orin-activity-screen" navTitle={<strong>{t('المعاملات','Transactions')}</strong>}>
  <header className="activity-heading"><span className="activity-mark"><ArrowLeftRight/></span><div><h1>{t('المعاملات الأخيرة','Recent transactions')}</h1><p>{account?t(account.type==='real'?'حساب حقيقي':'حساب تجريبي',account.type==='real'?'Real account':'Demo account'):t('الحساب','Account')} <bdi>{account?.accountNumber} · USD</bdi></p></div></header>
  <button type="button" className="statement-export" onClick={()=>void exportPdf()} disabled={!visible||busy}><span><FileText/><span><b>{t('كشف الحساب','Account statement')}</b><small>{t('ملف PDF بهوية ORIN','ORIN-branded PDF')}</small></span></span><Download size={21}/></button>
  <TransactionFilters value={filter} onChange={value=>{setFilter(value);setSelected(null)}}/>
  {error&&<ActivityError message={error} retry={retry}/>} {exportError&&<p className="activity-notice" role="alert">{exportError}</p>}
  <ActivityCoverage snapshot={visible}/>
  {!visible&&!error?<div className="activity-skeleton" role="status">{state&&!account?t('لا يوجد حساب محدد.','No account selected.'):t('جار قراءة السجل…','Reading account activity…')}</div>:visible&&<>
   <div className="activity-list">{rows.length?rows.map(row=><Fragment key={row.id}><TransactionRow row={row} selected={row.id===selected} onSelect={()=>{if(isWithdrawalTx(row)){openWithdrawal(row)}else{setSelected(selected===row.id?null:row.id)}}}/>{row.id===selected&&<TransactionDetails row={row} onWithdrawal={isWithdrawalTx(row)?()=>openWithdrawal(row):undefined}/>}</Fragment>):<div className="activity-empty"><ArrowLeftRight/><h2>{t('لا توجد معاملات متاحة','No available transactions')}</h2><p>{t('ستظهر هنا تفاصيل الإيداع والسحب والحركات المسجّلة في هذا الحساب.','Deposits, withdrawals and recorded activity for this account will appear here.')}</p></div>}</div>
   <p className="activity-coverage">{t('يعرض هذا القسم السجل المتاح حاليًا. التوقيت المعروض هو التوقيت المحلي لجهازك.','This view contains currently available records. Displayed times match your local device timezone.')}</p>
  </>}
  {selectedWd&&selectedWd.userId===state?.user.id&&selectedWd.accountId===account?.id&&<WithdrawalReceiptView withdrawal={selectedWd.data} onClose={()=>setSelectedWd(null)}/>}
 </FullPageContent></FullPage>;
}
