'use client';
import {Fragment,useEffect,useRef,useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,ArrowLeftRight,Download,FileText,ChevronDown} from 'lucide-react';
import type {LabState} from '@/lib/contracts';
import {statementSnapshot,transactionDetails,transactionLabel,transactionStatus,type StatementSnapshot,type AccountTransaction} from '@/lib/account-transactions';
import {activeTradingAccount} from '@/lib/trading-accounts';
import {useOrin} from './orin-settings';
import {FullPage,FullPageContent} from './full-page';
import {useNavigation} from './orin-navigation';
import {WithdrawalReceiptView, type WithdrawalReceiptData} from './withdrawal-receipt';

export async function saveStatement(snapshot:StatementSnapshot,ar:boolean){
 const {downloadStatement}=await import('@/lib/statement-pdf');await downloadStatement(snapshot,ar);
}
export function AccountTransactions({state}:{state:LabState|null}){
 const nav=useNavigation(),{t,prefs,number}=useOrin(),open=nav.path==='/activity',account=activeTradingAccount(state?.accountDirectory);
 const [snapshot,setSnapshot]=useState<StatementSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[filter,setFilter]=useState('all'),[selected,setSelected]=useState<string|null>(null);
 const [selectedWd,setSelectedWd]=useState<WithdrawalReceiptData|null>(null);
 const ticket=useRef(0),exporting=useRef(false),stateRef=useRef(state);stateRef.current=state;
 useEffect(()=>{
  if(!open||!state||!account){setSnapshot(null);return}
  let disposed=false,inFlight=false;const version=++ticket.current;setSnapshot(null);setSelected(null);setSelectedWd(null);setError('');
  const read=async()=>{if(inFlight||disposed||document.hidden)return;const current=stateRef.current;if(!current||activeTradingAccount(current.accountDirectory)?.id!==account.id)return;inFlight=true;try{const result=await statementSnapshot(current);if(!disposed&&ticket.current===version){setSnapshot(result);setError('')}}catch{if(!disposed)setError(t('تعذر الوصول إلى سجل الحساب.','Account activity is unavailable.'))}finally{inFlight=false}};
  void read();const timer=setInterval(()=>void read(),30000);window.addEventListener('online',read);document.addEventListener('visibilitychange',read);
  return()=>{disposed=true;clearInterval(timer);window.removeEventListener('online',read);document.removeEventListener('visibilitychange',read)};
 },[open,state?.user.id,account?.id]);
 const visible=snapshot?.account.id===account?.id?snapshot:null;
 const rows=visible?.transactions.filter(r=>filter==='all'||r.kind===filter)??[];
 const exportPdf=async()=>{if(!visible||exporting.current)return;exporting.current=true;setBusy(true);try{await saveStatement(visible,prefs.chartLocale==='ar')}catch{setError(t('تعذر إنشاء كشف PDF. تحقق من المساحة المتاحة وحاول مجددًا.','Could not create the PDF. Check available storage and try again.'))}finally{exporting.current=false;setBusy(false)}};

 const openWithdrawal=(row:AccountTransaction)=>{
  const w=row.withdrawal;
  const rawAmt=w?(w.amountCents/100):(Math.abs(row.amountCents||0)/100);
  const rawFee=w?(w.feeCents/100):Math.round(rawAmt*0.05*100)/100;
  const rawNet=w?(w.netAmountCents/100):Math.max(0,rawAmt-rawFee);
  setSelectedWd({
    id:w?.id||(row.id.startsWith('jnl-')?row.id.replace(/^jnl-/,''):row.id),
    amount:rawAmt,
    fee:rawFee,
    netAmount:rawNet,
    address:w?.address||'',
    coin:w?.coin||'usdtbsc',
    createdAt:w?.createdAt||row.createdAt,
    status:w?.status||(row.status==='recorded'?'requested':row.status),
    txHash:w?.txHash||null,
  });
 };

 return <FullPage open={open} onOpenChange={v=>{if(!v){setSelectedWd(null);nav.back('/')}}}><FullPageContent pageClassName="orin-activity-screen" navTitle={<strong>{t('المعاملات','Transactions')}</strong>}>
 <header className="activity-heading"><span className="activity-mark"><ArrowLeftRight/></span><div><h1>{t('المعاملات الأخيرة','Recent transactions')}</h1><p>{account?t(account.type==='real'?'حساب حقيقي':'حساب تجريبي',account.type==='real'?'Real account':'Demo account'):t('الحساب','Account')} <bdi>{account?.accountNumber} · USD</bdi></p></div></header>
 <button className="statement-export" onClick={()=>void exportPdf()} disabled={!visible||busy}><span><FileText/><span><b>{t('كشف الحساب','Account statement')}</b><small>{t('ملف PDF بهوية ORIN','ORIN-branded PDF')}</small></span></span><Download size={21}/></button>
 <div className="activity-filters" role="group" aria-label={t('تصفية المعاملات','Filter transactions')}>{[['all',t('الكل','All')],['deposit',t('إيداع','Deposits')],['withdrawal',t('سحب','Withdrawals')]].map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>{setFilter(key);setSelected(null)}}>{label}</button>)}</div>
 {error&&<p className="activity-notice" role="alert">{error}</p>}
 {!visible&&!error?<div className="activity-skeleton" role="status">{t('جار قراءة السجل…','Reading account activity…')}</div>:<>
 {visible?.paymentCoverage==='unavailable'&&<p className="activity-notice">{t('سجل مزود الدفع غير متصل حاليًا. تُعرض الحركات المحاسبية المتاحة فقط.','Payment provider history is currently unavailable. Only available ledger activity is shown.')}</p>}
 <div className="activity-list">{rows.length?rows.map(row=><Fragment key={row.id}>
  <TransactionRow
    row={row}
    selected={row.id===selected}
    onSelect={()=>{
      if(row.kind==='withdrawal'){
        openWithdrawal(row);
      } else {
        setSelected(selected===row.id?null:row.id);
      }
    }}
    hide={prefs.hideBalance}
  />
  {row.id===selected&&<section className="transaction-detail">
    <h2>{t('تفاصيل المعاملة','Transaction details')}</h2>
    <dl>{transactionDetails(row,prefs.chartLocale==='ar').map(([label,value])=><div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}</dl>
    {row.kind==='withdrawal'&&<button type="button" className="statement-export" style={{marginTop:'12px',width:'100%'}} onClick={()=>openWithdrawal(row)}>
      <span><FileText/><span><b>{t('عرض إيصال السحب الكامل','View full withdrawal receipt')}</b><small>{t('تفاصيل التحويل والشبكة والعنوان','Transfer, network, and address details')}</small></span></span>
      <ChevronDown size={18} style={{transform:'rotate(-90deg)'}}/>
    </button>}
    {row.entries.length>0&&<details><summary>{t('القيود المحاسبية','Ledger entries')}</summary>{row.entries.map(row=><div className="transaction-entry" key={row.id}><bdi>{row.account}</bdi><bdi>{prefs.hideBalance?'••••':number(row.amount_cents/100)} USD</bdi></div>)}</details>}
  </section>}
 </Fragment>):<div className="activity-empty"><ArrowLeftRight/><h2>{t('لا توجد معاملات متاحة','No available transactions')}</h2><p>{t('ستظهر هنا تفاصيل الإيداع والسحب والحركات المسجّلة في هذا الحساب.','Deposits, withdrawals and recorded activity for this account will appear here.')}</p></div>}</div>
 
 <p className="activity-coverage">{t('يعرض هذا القسم السجل المتاح حاليًا. التوقيت المعروض هو التوقيت المحلي لجهازك.','This view contains currently available records. Displayed times match your local device timezone.')}</p>
 </>}
 {selectedWd&&<WithdrawalReceiptView withdrawal={selectedWd} onClose={()=>setSelectedWd(null)}/>}
 </FullPageContent></FullPage>;
}
function TransactionRow({row,selected,onSelect,hide}:{row:AccountTransaction;selected:boolean;onSelect:()=>void;hide:boolean}){
 const {t,prefs,number}=useOrin(),ar=prefs.chartLocale==='ar',Icon=row.kind==='deposit'?ArrowDownLeft:row.kind==='withdrawal'?ArrowUpRight:ArrowLeftRight;
 return <button className="transaction-row" onClick={onSelect} aria-expanded={selected}><span className={'transaction-icon '+row.kind}><Icon/></span><span className="transaction-copy"><b>{transactionLabel(row.kind,ar)}</b><small>{new Date(row.createdAt).toLocaleString(ar?'ar-u-nu-latn':'en-GB',{timeZone:typeof Intl!=='undefined'?Intl.DateTimeFormat().resolvedOptions().timeZone:prefs.timezone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small><em>{transactionStatus(row.status,ar)}</em></span><span className="transaction-amount" dir="ltr"><b>{hide?'••••':row.amountCents===null?'—':`${row.amountCents>0&&(!row.deposit||row.status==='credited')?'+':''}${number(row.amountCents/100)}`}</b><small>{row.currency}</small></span><ChevronDown size={16} aria-label={t('التفاصيل','Details')}/></button>;
}
