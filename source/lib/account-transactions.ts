import type {LabState,LedgerRow} from './contracts';
import type {DepositView} from './payments';
import {PAYMENT_COINS} from './payments';
import {activeTradingAccount,type TradingAccount} from './trading-accounts';
import {listDeposits,paymentHistoryConfigured} from './payment-client';

function optionalCents(value: unknown): number | undefined {
 const n = value === null || value === undefined || value === '' ? NaN : Number(value);
 return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

export type WithdrawalTransactionView = {
  id: string;
  accountId: string;
  amountCents: number;
  feeCents?: number;
  netAmountCents?: number;
  coin: string;
  currency: string;
  address: string;
  status: string;
  txHash?: string | null;
  createdAt: number;
  updatedAt?: number;
};

export type AccountTransaction={
 id:string;kind:string;status:string;amountCents:number|null;currency:string;
 createdAt:number;accountId:string;accountNumber:string;accountType:'real'|'demo';
 entries:LedgerRow[];deposit?:DepositView;withdrawal?:WithdrawalTransactionView;
};
export type StatementSnapshot={
 account:TradingAccount;owner:string;generatedAt:number;transactions:AccountTransaction[];
 ledger:LedgerRow[];paymentCoverage:'recent'|'unavailable'|'not-applicable';
};
export const transactionNames:Record<string,[string,string]>={deposit:['إيداع','Deposit'],withdrawal:['سحب','Withdrawal'],allocation:['حجز للتداول','Trading allocation'],settlement:['تسوية','Settlement'],early_exit_fee:['رسوم خروج مبكر','Early exit fee'],withdrawal_fee:['رسوم السحب','Withdrawal fee'],fee:['رسوم','Fee'],wallet_transfer:['تحويل محفظة','Wallet transfer'],transfer:['تحويل','Transfer'],initial:['رصيد افتتاحي تجريبي','Demo opening balance'],initialization:['رصيد افتتاحي تجريبي','Demo opening balance'],seed:['رصيد افتتاحي تجريبي','Demo opening balance'],referral:['مكافأة إحالة','Referral reward'],bonus_profit:['ربح المكافأة','Bonus profit'],bonus_allocation:['حجز بونص للتداول','Bonus trading allocation'],bonus_settlement:['تسوية بونص','Bonus settlement'],bonus_profit_unlock:['تحرير أرباح البونص','Bonus profit unlock'],bonus_expired:['انتهاء صلاحية البونص','Bonus expired'],test_funding:['رصيد افتتاحي تجريبي','Demo opening balance'],referral_reward:['مكافأة إحالة','Referral reward'],team_activity:['مكافأة نشاط الفريق','Team activity reward'],nonwithdrawable_bonus:['مكافأة تداول غير قابلة للسحب','Non-withdrawable trading bonus'],adjustment:['تسوية محاسبية','Adjustment']};
export const transactionStatuses:Record<string,[string,string]>={recorded:['مسجّلة','Recorded'],creating:['جار إنشاء الطلب','Creating'],waiting:['بانتظار الدفع','Awaiting payment'],confirming:['بانتظار تأكيد الشبكة','Confirming'],confirmed:['أكدتها الشبكة','Network confirmed'],sending:['قيد المعالجة','Processing'],finished:['اكتملت لدى المزود','Provider completed'],credited:['أضيفت للرصيد','Credited'],partially_paid:['مدفوعة جزئيًا','Partially paid'],failed:['فشلت','Failed'],refunded:['أعيد المبلغ','Refunded'],expired:['انتهت صلاحيتها','Expired'],review:['قيد المراجعة','Under review'],requested:['قيد المراجعة','Under review'],approved:['معتمد','Approved'],paid:['مكتمل (مدفوع)','Completed (Paid)'],rejected:['مرفوض','Rejected']};
export function transactionLabel(kind:string,ar=true){return transactionNames[kind]?.[ar?0:1]??kind;}
export function transactionStatus(status:string,ar=true){return transactionStatuses[status]?.[ar?0:1]??status;}

// Scope by an explicit account tag. Legacy untagged entries belong only to primary demo.
export function accountLedger(state:LabState,account:TradingAccount){
 return (state.ledger ?? []).filter(row=>{const r=row as LedgerRow&{accountId?:string;account_id?:string};return (r.accountId??r.account_id??(account.type==='demo'?'primary':null))===account.id});
}
export function buildTransactions(state:LabState,account:TradingAccount,deposits:DepositView[],withdrawals:WithdrawalTransactionView[]=[]):AccountTransaction[]{
 const items:AccountTransaction[]=(deposits ?? []).filter(d=>d.accountId===account.id&&Number.isSafeInteger(d.amountCents)&&d.amountCents>0&&Number.isFinite(d.createdAt)).map(d=>({id:d.id,kind:'deposit',status:d.credited&&d.status==='finished'?'credited':d.status,amountCents:d.credited&&Number.isSafeInteger(d.creditedCents)&&Number(d.creditedCents)>0?Number(d.creditedCents):d.amountCents,currency:'USD',createdAt:d.createdAt,accountId:account.id,accountNumber:account.accountNumber,accountType:account.type,entries:[],deposit:d}));

 const wItems:AccountTransaction[]=(withdrawals ?? []).filter(w=>w.accountId===account.id&&Number.isSafeInteger(w.amountCents)&&w.amountCents>0&&Number.isFinite(w.createdAt)).map(w=>({id:w.id,kind:'withdrawal',status:w.status,amountCents:-w.amountCents,currency:w.currency||'USD',createdAt:w.createdAt,accountId:account.id,accountNumber:account.accountNumber,accountType:account.type,entries:[],withdrawal:w}));
 items.push(...wItems);

 const journals=new Map<string,LedgerRow[]>();
 for(const row of accountLedger(state,account)){if(!Number.isSafeInteger(row.amount_cents)||!Number.isFinite(row.effective_at))continue;const rows=journals.get(row.journal_id)??[];if(!rows.some(r=>r.id===row.id))rows.push(row);journals.set(row.journal_id,rows)}
 for(const [id,entries] of journals){
  const payment=items.find(t=>t.deposit&&(t.deposit.creditJournalId===id||(t.deposit.paymentId&&id==='deposit-nowpayments-'+t.deposit.paymentId)));
  if(payment){payment.entries=entries;continue}
  const cleanJnlId=id.replace(/^(jnl-wd-|jnl-|j-wd-|j-)/,'').replace(/^(wd-)/,'');
  const withdrawal=items.find(t=>t.withdrawal&&(
    t.withdrawal.id.replace(/^(wd-)/,'')===cleanJnlId||
    id==='jnl-wd-'+t.withdrawal.id||
    id==='jnl-'+t.withdrawal.id||
    id==='j-wd-'+t.withdrawal.id||
    id===t.withdrawal.id||
    (entries[0] as any)?.reference===t.withdrawal.id||
    (entries[0] as any)?.reference?.replace(/^(wd-)/,'')===cleanJnlId
  ));
  if(withdrawal){withdrawal.entries.push(...entries);continue}
  // Use the customer leg, never the sum of a balanced journal or its clearing leg.
  const cash=(entries ?? []).filter(r=>r.account==='cash'||r.account===`user:${state.user.id}:cash`||r.account===`customer:${state.user.id}:${account.id}`);
  const amount=cash.length?cash.reduce((n,r)=>n+r.amount_cents,0):null;
  // A cash journal alone cannot prove payout status, network, fees or net amount.
  items.push({id,kind:entries[0].kind,status:'recorded',amountCents:amount!==null&&Number.isSafeInteger(amount)?amount:null,currency:account.currency,createdAt:Math.min(...entries.map(r=>r.effective_at)),accountId:account.id,accountNumber:account.accountNumber,accountType:account.type,entries});
 }
 return items.sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
}
export async function statementSnapshot(state:LabState):Promise<StatementSnapshot>{
 const account=activeTradingAccount(state.accountDirectory);if(!account)throw new Error('Account unavailable');
 let deposits:DepositView[]=[],withdrawals:WithdrawalTransactionView[]=[],paymentCoverage:StatementSnapshot['paymentCoverage']=account.type==='demo'?'not-applicable':'unavailable';
 if(account.type==='real'){
   if(paymentHistoryConfigured()){
     try{const result=await listDeposits(account.id);deposits=result.items;paymentCoverage='recent'}catch{/* Preserve ledger while declaring incomplete payment coverage. */}
   }
   try{
     const {apiFetch}=await import('./client-api');
     const wRes=await apiFetch('/api/withdrawals');
     if(wRes.ok){
       const wData=await wRes.json();
       withdrawals=(wData.items||[]).map((w:any)=>({
         id:w.id,
         accountId:w.account_id||w.accountId,
         amountCents:Number(w.amount_cents||w.amountCents||0),
         feeCents:optionalCents(w.fee_cents??w.feeCents),
         netAmountCents:optionalCents(w.net_amount_cents??w.netAmountCents),
         coin:w.coin||'',
         currency:w.currency||'USD',
         address:w.address||'',
         status:w.status||'recorded',
         txHash:w.tx_hash||w.txHash||null,
         createdAt:w.created_at?new Date(w.created_at).getTime():Number(w.createdAt),
         updatedAt:w.updated_at?new Date(w.updated_at).getTime():undefined,
       }));
     }
   }catch{/* Preserve statement even if withdrawals fetch fails */}
 }
 return {account:{...account},owner:state.user.name,generatedAt:Date.now(),transactions:buildTransactions(state,account,deposits,withdrawals),ledger:accountLedger(state,account),paymentCoverage};
}
export function transactionDetails(row:AccountTransaction,ar=true):[string,string][] {
 const d=row.deposit,w=row.withdrawal,coin=d?PAYMENT_COINS.find(c=>c.id===d.coin):null;
 const text=(a:string,b:string)=>ar?a:b;
 const rows:[string,string][]=[
  [text('مرجع المعاملة','Transaction reference'),row.id],
  [text('نوع المعاملة','Type'),transactionLabel(row.kind,ar)],
  [text('الحالة','Status'),transactionStatus(row.status,ar)],
  [text('رقم الحساب','Account number'),row.accountNumber],
  [text('نوع الحساب','Account type'),row.accountType==='real'?text('حقيقي','Real'):text('تجريبي - غير قابل للسحب','Demo - non-withdrawable')],
  [text('العملة','Currency'),row.currency],
  [text('التاريخ والتوقيت','Date and time'),new Intl.DateTimeFormat(ar?'ar-u-nu-latn':'en-GB',{timeZone:typeof Intl!=='undefined'?Intl.DateTimeFormat().resolvedOptions().timeZone:'UTC',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date(row.createdAt))],
 ];
 if(d)rows.push(
  [text('مزود الدفع','Payment provider'),'ORIN Pay'],
  [text('مرجع المزود','Provider reference'),d.paymentId??'—'],
  [text('عملة الدفع','Payment currency'),coin?.label??d.coin],
  [text('الشبكة','Network'),coin?.network??'—'],
  [text('عنوان الإيداع','Deposit address'),d.address??'—'],
  [text('الوسم / المذكرة','Tag / memo'),d.extraId??'—'],
  [text('المبلغ المطلوب بالعملة الرقمية','Requested crypto amount'),d.payAmount??'—'],
  [text('الرسوم','Fees'),text('غير متاحة من الخدمة','Not provided by service')],
  [text('معرّف التحويل على الشبكة','Blockchain transaction ID'),text('غير متاح من الخدمة','Not provided by service')],
  [text('الترحيل إلى الرصيد','Balance credit'),d.credited?text('تم الترحيل','Credited'):text('لم يُرحّل بعد','Not credited')],
 );
 if(w){
  const coinObj=PAYMENT_COINS.find(c=>c.id.toLowerCase()===w.coin.toLowerCase());
  rows.push(
   [text('العملة والشبكة','Coin & Network'),coinObj?`${coinObj.label} · ${coinObj.network}`:w.coin||text('غير متاحة من الخدمة','Not provided by service')],
   [text('عنوان المحفظة المستلمة','Recipient address'),w.address||'—'],
   [text('مبلغ السحب المطلوب','Requested withdrawal'),`${(w.amountCents/100).toFixed(2)} USD`],
   [text('رسوم السحب','Withdrawal fee'),w.feeCents!==undefined?`${(w.feeCents/100).toFixed(2)} ${w.currency}`:text('غير متاحة من الخدمة','Not provided by service')],
   [text('صافي المبلغ المستلم','Net amount'),w.netAmountCents!==undefined?`${(w.netAmountCents/100).toFixed(2)} ${w.currency}`:text('غير متاح من الخدمة','Not provided by service')],
   [text('رمز المعاملة / إثبات السحب (TxID)','Transaction Hash / Proof (TxID)'),w.txHash||text('لم توفره الخدمة؛ الموافقة وحدها ليست إثبات دفع','Not provided; approval alone is not proof of payment')],
   [text('قيود الرصيد','Balance entries'),row.entries.length?text('راجع القيود المرتبطة بهذه المعاملة','See the linked ledger entries'):text('غير متاحة في هذا العرض','Not available in this view')]
  );
 }
 return rows;
}

