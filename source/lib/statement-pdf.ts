import {jsPDF} from 'jspdf';
import {transactionLabel,transactionStatus,transactionDetails,type StatementSnapshot} from './account-transactions';

type Assets={regular:string;medium:string;logo:Uint8Array};
const navy='#101942',blue='#087EFF',muted='#70819B',line='#DCE8F4',ice='#F0F7FF';
const amount=(n:number)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100)+' USD';
const utc=(n:number)=>new Date(n).toISOString().slice(0,19).replace('T',' ')+' UTC';

/** The same generator is used by the app and the rendered PDF regression fixture. */
export function buildStatementPdf(snapshot:StatementSnapshot,assets:Assets,ar=true){
 const pdf=new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
 pdf.addFileToVFS('ORIN-Regular.ttf',assets.regular);pdf.addFont('ORIN-Regular.ttf','ORIN','normal');
 pdf.addFileToVFS('ORIN-Medium.ttf',assets.medium);pdf.addFont('ORIN-Medium.ttf','ORIN','bold');
 pdf.setProperties({title:'ORIN - Account Statement',subject:'Available account activity',author:'ORIN',creator:'ORIN 1.5.4'});
 const t=(a:string,b:string)=>ar?a:b;
 function text(value:string,x:number,y:number,size=10,color=navy,bold=false,align:'left'|'right'='left'){
  pdf.setFont('ORIN',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);pdf.setR2L(false);pdf.text(value,x,y,{align});
 }
 function localized(value:string,y:number,size=10,color=navy,bold=false){text(value,ar?191:19,y,size,color,bold,ar?'right':'left')}
 function header(){
  pdf.setFillColor(ice);pdf.rect(0,0,210,46,'F');pdf.setFillColor(blue);pdf.rect(0,0,210,2,'F');
  pdf.addImage(assets.logo,'PNG',17,11,18,18);text('ORIN',40,24,25,navy,true);text('TRADE BEYOND LIMITS',40,32,8,muted);
  text(t('كشف الحساب','ACCOUNT STATEMENT'),191,20,15,navy,true,'right');text('USD',191,31,10,blue,true,'right');
 }
 let y=58;header();
 function newPage(){pdf.addPage();header();y=59}
 function room(height:number){if(y+height>272)newPage()}
 function paragraph(value:string,size=9,color=muted){
  pdf.setFont('ORIN','normal');pdf.setFontSize(size);const lines=pdf.splitTextToSize(value,170) as string[];
  for(const row of lines){room(6);localized(row,y,size,color);y+=6}
 }
 localized(t('بيانات الحساب','ACCOUNT DETAILS'),y,14,navy,true);y+=10;
 const meta:[string,string][]=[
  [t('صاحب الحساب','Account holder'),snapshot.owner||'—'],
  [t('رقم الحساب','Account number'),snapshot.account.accountNumber],
  [t('نوع الحساب','Account type'),snapshot.account.type==='real'?t('حقيقي','Real'):t('تجريبي - غير قابل للسحب','Demo - non-withdrawable')],
  [t('أُنشئ الكشف في','Statement generated'),utc(snapshot.generatedAt)],
 ];
 for(const [label,value] of meta){room(18);localized(label,y,8,muted);y+=6;pdf.setFont('ORIN','bold');pdf.setFontSize(11);for(const part of pdf.splitTextToSize(value,170)){room(7);localized(part,y,11,navy,true);y+=7}y+=3}
 const start=snapshot.transactions.length?Math.min(...snapshot.transactions.map(r=>r.createdAt)):null;
 paragraph(t('نطاق الكشف: السجل المتاح حاليًا. قد لا يشمل جميع حركات الحساب.','Coverage: currently available records. This statement may not include all account activity.'));
 if(start){text(utc(start)+'  /  '+utc(Math.max(...snapshot.transactions.map(r=>r.createdAt))),19,y,8,muted);y+=8}
 if(snapshot.paymentCoverage==='unavailable')paragraph(t('لم يتصل سجل مزود الدفع؛ لا يُعد غياب طلبات الدفع تأكيدًا لعدم وجودها.','Payment-provider history was unavailable. Missing payment requests do not prove there were none.'),9,'#9A652C');
 y+=3;room(32);
 for(const [i,label,n] of [[0,t('الرصيد المتاح','Available balance'),snapshot.account.balanceCents],[1,t('الرصيد المحجوز','Reserved balance'),snapshot.account.reservedCents]] as const){
  const x=19+i*88;pdf.setFillColor(ice);pdf.roundedRect(x,y,84,25,3,3,'F');text(label,x+78,y+8,9,muted,false,'right');text(amount(n),x+6,y+18,15,navy,true);
 }y+=37;
 localized(t('تفاصيل الحركات','TRANSACTION DETAILS'),y,14,navy,true);y+=10;
 if(!snapshot.transactions.length){paragraph(t('لا توجد حركات متاحة في السجل الحالي لهذا الحساب.','No activity is available in the current records for this account.'),11,navy);y+=6}
 for(const [index,row] of snapshot.transactions.entries()){
  room(43);pdf.setFillColor(ice);pdf.roundedRect(19,y-4,172,17,2,2,'F');
  text(String(index+1).padStart(2,'0'),25,y+3,10,blue,true);
  text(transactionLabel(row.kind,ar),ar?185:38,y+3,11,navy,true,ar?'right':'left');
  text(row.amountCents===null?'—':amount(row.amountCents),25,y+10,10,navy,true);
  text(transactionStatus(row.status,ar),185,y+10,8,muted,false,'right');y+=22;
  const fields=transactionDetails(row,ar).filter(([label])=>!['Type','Status','Account number','Account type','Currency','نوع المعاملة','الحالة','رقم الحساب','نوع الحساب','العملة'].includes(label));
  for(const [label,value] of fields){
   room(16);localized(label,y,8,muted);y+=5;
   pdf.setFont('ORIN','normal');pdf.setFontSize(9);const valueLines=pdf.splitTextToSize(value,170) as string[];
   for(const lineValue of valueLines){room(6);localized(lineValue,y,9,navy);y+=5}
   y+=3;
  }
  if(row.deposit){paragraph(t('مبلغ الطلب لا يعني إضافة الرصيد؛ يُعتمد حقل الترحيل وحالة المعاملة.','A requested amount is not a balance credit. Refer to the credit field and transaction status.'),8)}
  y+=4;pdf.setDrawColor(line);pdf.line(19,y,191,y);y+=10;
 }
 // Preserve accounting legs separately so reserved movements and clearing entries are not conflated.
 if(snapshot.ledger.length){
  newPage();localized(t('ملحق القيود المحاسبية','LEDGER APPENDIX'),y,14,navy,true);y+=10;
  paragraph(t('كل قيد معروض كما ورد من سجل الحساب؛ لم تُحسب أرصدة افتتاحية أو ختامية من سجل قد يكون جزئيًا.','Entries are reproduced from the account ledger. Opening and closing balances are not inferred from potentially partial history.'));
  for(const row of snapshot.ledger){room(29);for(const [value,size,color] of [[row.account,8,navy],[row.journal_id,7,muted]] as const){pdf.setFont('ORIN','normal');pdf.setFontSize(size);for(const part of pdf.splitTextToSize(value,170)){room(6);text(part,19,y,size,color);y+=6}}text(utc(row.effective_at),19,y,8,muted);text(amount(row.amount_cents),191,y,9,navy,true,'right');y+=9;pdf.setDrawColor(line);pdf.line(19,y,191,y);y+=6}
 }
 const pages=pdf.getNumberOfPages();
 for(let page=1;page<=pages;page++){pdf.setPage(page);pdf.setDrawColor(line);pdf.line(19,279,191,279);text('ORIN  /  '+snapshot.account.accountNumber,19,286,8,muted);text(`${page} / ${pages}`,191,286,8,muted,false,'right');text(t('كشف معلوماتي صادر من التطبيق','Informational statement generated by the app'),ar?191:19,292,7,muted,false,ar?'right':'left')}
 return pdf;
}
async function loadAssets():Promise<Assets>{
 const files=await Promise.all(['/fonts/ibm-plex-arabic-400.ttf','/fonts/ibm-plex-arabic-600.ttf','/brand/orin-mark.png'].map(async path=>{const r=await fetch(path,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Statement asset unavailable');return new Uint8Array(await r.arrayBuffer())}));
 const base64=(bytes:Uint8Array)=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value)};
 return {regular:base64(files[0]),medium:base64(files[1]),logo:files[2]};
}
export async function downloadStatement(snapshot:StatementSnapshot,ar=true){
 const pdf=buildStatementPdf(snapshot,await loadAssets(),ar),link=document.createElement('a');
 link.href=pdf.output('datauristring');link.download=`ORIN-statement-${snapshot.account.accountNumber}-${new Date(snapshot.generatedAt).toISOString().slice(0,10)}.pdf`;
 document.body.appendChild(link);link.click();link.remove();
}
