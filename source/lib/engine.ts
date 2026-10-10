import { ensureInvariants } from "./invariants.ts";
import { ASSETS, resultCents, type Contract, type LabState, type Position, type Receipt, type Notice, type AuditEvent, type LedgerRow } from "./contracts.ts";

export interface Statement {bind(...values:unknown[]):Statement;first<T=Record<string,unknown>>():Promise<T|null>;all<T=Record<string,unknown>>():Promise<{results:T[]}>;run():Promise<unknown>;}
export interface Database {prepare(sql:string):Statement;batch(statements:Statement[]):Promise<unknown[]>;}
export interface Identity {id:string;name:string;}
export class AppError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
export const INITIAL_CENTS=1_000_000;
export async function sha256(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,"0")).join("");}
const account=(id:string,kind="cash")=>`user:${id}:${kind}`;
const stmt=(db:Database,sql:string,...values:unknown[])=>db.prepare(sql).bind(...values);
async function event(db:Database,id:string,actor:string,action:string,reference:string,data:unknown,now:number){const payload=JSON.stringify(data);return stmt(db,"INSERT OR IGNORE INTO audit_events(id,actor_id,action,reference,payload,payload_hash,created_at) VALUES(?,?,?,?,?,?,?)",id,actor,action,reference,payload,await sha256(payload),now);}
function postEntries(db:Database,id:string,entries:[string,number][]){return entries.filter(([,n])=>n!==0).map(([acct,n],i)=>stmt(db,"INSERT OR IGNORE INTO ledger_entries(id,journal_id,account,amount_cents) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM journals WHERE id=? AND status='pending')",`${id}:${i}`,id,acct,n,id));}
function finalize(db:Database,id:string){return stmt(db,"UPDATE journals SET status='posted' WHERE id=? AND status='pending'",id);}
async function adminCheck(db:Database,user:Identity){const owner=await stmt(db,"SELECT value FROM settings WHERE key='owner'").first<{value:string}>();if(owner?.value!==user.id)throw new AppError("هذه العملية متاحة لمدير مساحة العمل فقط.",403);}

export async function bootstrap(db:Database,user:Identity,now=Date.now()){
  await ensureInvariants(db);
  const id=`fund:${user.id}`;
  await db.batch([
    stmt(db,"INSERT OR IGNORE INTO lab_users(id,name,tier,created_at,seen_at) VALUES(?,?,'standard',?,0)",user.id,user.name.slice(0,100),now),
    stmt(db,"INSERT OR IGNORE INTO settings(key,value) VALUES('owner',?)",user.id),
    stmt(db,"INSERT OR IGNORE INTO journals(id,kind,user_id,reference,effective_at,created_at,status) VALUES(?,'test_funding',?,'INITIAL-VIRTUAL-CAPITAL',?,?,'pending')",id,user.id,now,now),
    ...postEntries(db,id,[[account(user.id),INITIAL_CENTS],["system:virtual-capital",-INITIAL_CENTS]]),finalize(db,id),
    await event(db,id,user.id,"TEST_ACCOUNT_CREATED",user.id,{virtual:true,initialCents:INITIAL_CENTS},now),
  ]);
}

export async function publishContract(db:Database,user:Identity,input:Record<string,unknown>,now=Date.now()){
  await adminCheck(db,user);
  const title=String(input.title??"").trim();
  const asset=String(input.asset??""),direction=String(input.direction??"");
  const duration=Number(input.durationSec),bps=Number(input.settlementBps),opensAt=Number(input.opensAt),closesAt=Number(input.closesAt);
  const eligibility=String(input.eligibility??"all");
  if(!title||title.length>80)throw new AppError("أدخل عنوانًا من 1 إلى 80 حرفًا.");
  if(!Object.hasOwn(ASSETS,asset)||!["BUY","SELL"].includes(direction))throw new AppError("الأصل أو الاتجاه غير صالح.");
  if(!Number.isInteger(duration)||duration<60||duration>300)throw new AppError("المدة بين 60 و300 ثانية.");
  if(!Number.isInteger(bps)||bps < -1000||bps > 1000)throw new AppError("نسبة التسوية الداخلية بين ‎-10% و‎+10%، بمنزلتين عشريتين.");
  if(!["all","standard","advanced"].includes(eligibility))throw new AppError("فئة الأهلية غير صالحة.");
  if(!Number.isSafeInteger(opensAt)||!Number.isSafeInteger(closesAt)||opensAt<now-60_000||closesAt<=Math.max(now,opensAt)||closesAt-opensAt>30*86400_000)throw new AppError("حدد نافذة مشاركة صحيحة لا تتجاوز 30 يومًا.");
  const id=crypto.randomUUID(),code=`LAB-${crypto.randomUUID().replaceAll('-','').slice(0,10).toUpperCase()}`;
  const terms={version:1,mode:"virtual-test-only",id,code,title,asset,direction,durationSec:duration,settlementBps:bps,eligibility,opensAt,closesAt,publishedAt:now,adminId:user.id};
  const canonical=JSON.stringify(terms),hash=await sha256(canonical);
  await db.batch([
    stmt(db,"INSERT INTO contracts(id,code,title,asset,direction,duration_sec,settlement_bps,eligibility,opens_at,closes_at,published_at,admin_id,canonical,hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",id,code,title,asset,direction,duration,bps,eligibility,opensAt,closesAt,now,user.id,canonical,hash),
    await event(db,`publish:${id}`,user.id,"CONTRACT_PUBLISHED_AND_LOCKED",id,{terms,sha256:hash},now),
    stmt(db,"INSERT INTO notifications(id,user_id,eligibility,title,message,contract_id,created_at) VALUES(?,NULL,?,?,?,?,?)",`publish:${id}`,eligibility,"دعوة جديدة من ORIN",`${title} · الكود ${code} · تسوية داخلية محددة مسبقًا`,id,now),
  ]);
  return {id,code,hash};
}

export async function acceptTerms(db:Database,user:Identity,now=Date.now()){
  await db.batch([stmt(db,"UPDATE lab_users SET accepted_at=? WHERE id=? AND accepted_at IS NULL",now,user.id),await event(db,`accept:${user.id}`,user.id,"TEST_TERMS_ACCEPTED",user.id,{version:1,virtualBalances:true,internalLockedSettlement:true,noMarketExecution:true},now)]);
}

export async function joinContract(db:Database,user:Identity,input:Record<string,unknown>,now=Date.now()){
  const code=String(input.code??"").trim().toUpperCase(),amount=Number(input.amountCents);
  if(!Number.isSafeInteger(amount)||amount<100||amount>100_000_000)throw new AppError("المبلغ الافتراضي يجب أن يكون بين 1 و1,000,000 دولار وبمنزلتين عشريتين.");
  if(input.confirmed!==true)throw new AppError("راجع شروط التسوية المقفلة وأكد أن الرصيد افتراضي.");
  const closure=await stmt(db,"SELECT profile FROM account_preferences WHERE user_id=?",user.id).first<{profile:string}>();
  if(closure&&JSON.parse(closure.profile).closureStatus==='requested')throw new AppError("الحساب بانتظار الإغلاق. المشاركة متوقفة / Closure requested. New participation is disabled.",403);
  const profile=await stmt(db,"SELECT tier,accepted_at FROM lab_users WHERE id=?",user.id).first<{tier:string;accepted_at:number|null}>();
  if(!profile?.accepted_at)throw new AppError("يجب قبول شروط الحساب التجريبي أولًا.",403);
  const contract=await stmt(db,"SELECT * FROM contracts WHERE code=?",code).first<Contract>();
  if(!contract)throw new AppError("كود الدعوة غير موجود.",404);
  if(contract.eligibility!=="all"&&contract.eligibility!==profile.tier)throw new AppError("حسابك غير مؤهل لهذا العقد.",403);
  if(await sha256(contract.canonical)!==contract.hash)throw new AppError("تعذر التحقق من سلامة شروط العقد.",409);
  if(input.contractHash!==contract.hash)throw new AppError("راجع تفاصيل العقد الحالية قبل التأكيد.",409);
  const id=await sha256(`position:${user.id}:${contract.id}`);
  const existing=await stmt(db,"SELECT * FROM positions WHERE id=?",id).first<Position>();
  if(existing){if(existing.amount_cents!==amount)throw new AppError("سبق الاشتراك في هذا العقد بمبلغ مختلف.",409);return {id,reused:true};}
  if(now<contract.opens_at||now>=contract.closes_at)throw new AppError("العقد خارج نافذة المشاركة.",409);
  const pnl=resultCents(amount,contract.settlement_bps),endsAt=now+contract.duration_sec*1000,jid=`allocate:${id}`;
  const auditPayload=JSON.stringify({contractId:contract.id,contractHash:contract.hash,amountCents:amount,startedAt:now,endsAt,internalSettlement:true});
  const auditHash=await sha256(auditPayload);
  await db.batch([
    stmt(db,`INSERT OR IGNORE INTO positions(id,user_id,contract_id,amount_cents,result_cents,started_at,ends_at,status)
      SELECT ?,?,?,?,?,?,?,'active' WHERE COALESCE((SELECT json_extract(profile,'$.closureStatus') FROM account_preferences WHERE user_id=?),'open')='open' AND ? <= (SELECT COALESCE(SUM(e.amount_cents),0) FROM ledger_entries e JOIN journals j ON j.id=e.journal_id WHERE e.account=? AND j.status='posted')`,id,user.id,contract.id,amount,pnl,now,endsAt,user.id,amount,account(user.id)),
    stmt(db,"INSERT OR IGNORE INTO journals(id,kind,user_id,reference,effective_at,created_at,status) SELECT ?,'allocation',?,?,?,?,'pending' WHERE EXISTS(SELECT 1 FROM positions WHERE id=?)",jid,user.id,id,now,now,id),
    stmt(db,"INSERT OR IGNORE INTO ledger_entries(id,journal_id,account,amount_cents) SELECT ?,?,?,-p.amount_cents FROM positions p JOIN journals j ON j.id=? WHERE p.id=? AND j.status='pending'",`${jid}:0`,jid,account(user.id),jid,id),
    stmt(db,"INSERT OR IGNORE INTO ledger_entries(id,journal_id,account,amount_cents) SELECT ?,?,?,p.amount_cents FROM positions p JOIN journals j ON j.id=? WHERE p.id=? AND j.status='pending'",`${jid}:1`,jid,account(user.id,"reserved"),jid,id),
    finalize(db,jid),
    stmt(db,"INSERT OR IGNORE INTO notifications(id,user_id,eligibility,title,message,contract_id,created_at) SELECT ?,?,'all',?,?,?,? WHERE EXISTS(SELECT 1 FROM positions WHERE id=? AND started_at=?)",`start:${id}`,user.id,"بدأ العقد الداخلي",`${contract.title} · ${contract.duration_sec/60} دقيقة · رصيد افتراضي`,contract.id,now,id,now),
    stmt(db,"INSERT OR IGNORE INTO audit_events(id,actor_id,action,reference,payload,payload_hash,created_at) SELECT ?,?,'VIRTUAL_AMOUNT_ALLOCATED',?,?,?,? WHERE EXISTS(SELECT 1 FROM positions WHERE id=? AND amount_cents=? AND started_at=?)",`join:${id}`,user.id,id,auditPayload,auditHash,now,id,amount,now),
  ]);
  const saved=await stmt(db,"SELECT * FROM positions WHERE id=?",id).first<Position>();
  if(!saved)throw new AppError("الرصيد الافتراضي المتاح غير كافٍ.",409);
  if(saved.amount_cents!==amount)throw new AppError("سبق الاشتراك في هذا العقد بمبلغ مختلف.",409);
  return {id,reused:false};
}

export async function settleDue(db:Database,now=Date.now(),userId?:string){
  const due=await stmt(db,`SELECT p.* FROM positions p WHERE status='active' AND ends_at<=? ${userId?'AND user_id=?':''} ORDER BY ends_at LIMIT 100`,...([now,...(userId?[userId]:[])])).all<Position>();
  for(const p of due.results){
    const c=await stmt(db,"SELECT * FROM contracts WHERE id=?",p.contract_id).first<Contract>();
    if(!c||await sha256(c.canonical)!==c.hash)throw new AppError("تعذر التحقق من عقد مستحق للتسوية.",409);
    const expected=resultCents(p.amount_cents,c.settlement_bps);
    if(expected!==p.result_cents)throw new AppError("تعارض في حساب التسوية.",409);
    const jid=`settle:${p.id}`;
    const receipt={version:1,mode:"virtual-test-only",receiptId:`R-${p.id.slice(0,12).toUpperCase()}`,contractId:c.id,contractCode:c.code,contractHash:c.hash,positionId:p.id,asset:c.asset,direction:c.direction,amountCents:p.amount_cents,durationSec:c.duration_sec,lockedSettlementBps:c.settlement_bps,startedAt:p.started_at,endsAt:p.ends_at,effectiveAt:p.ends_at,processedAt:now,resultCents:expected,returnedCents:p.amount_cents+expected,settlement:"internal-contract-not-market-execution"};
    const payload=JSON.stringify(receipt),receiptHash=await sha256(payload);
    await db.batch([
      stmt(db,"INSERT OR IGNORE INTO journals(id,kind,user_id,reference,effective_at,created_at,status) VALUES(?,'settlement',?,?,?,?,'pending')",jid,p.user_id,p.id,p.ends_at,now),
      ...postEntries(db,jid,[[account(p.user_id,"reserved"),-p.amount_cents],[account(p.user_id),p.amount_cents+expected],["system:virtual-pnl",-expected]]),
      finalize(db,jid),
      stmt(db,"UPDATE positions SET status='settled',settled_at=? WHERE id=? AND status='active'",now,p.id),
      stmt(db,"INSERT OR IGNORE INTO receipts(id,position_id,user_id,payload,hash,created_at) VALUES(?,?,?,?,?,?)",`receipt:${p.id}`,p.id,p.user_id,payload,receiptHash,now),
      await event(db,jid,"settlement-engine","CONTRACT_SETTLED",p.id,{contractId:c.id,contractHash:c.hash,resultCents:expected,effectiveAt:p.ends_at,processedAt:now,receiptHash},now),
      stmt(db,"INSERT OR IGNORE INTO notifications(id,user_id,eligibility,title,message,contract_id,created_at) VALUES(?,?,'all',?,?,?,?)",`end:${p.id}`,p.user_id,"انتهت مدة العقد",`${c.title} · اكتملت مدة المشاركة`,c.id,p.ends_at),
      stmt(db,"INSERT OR IGNORE INTO notifications(id,user_id,eligibility,title,message,contract_id,created_at) VALUES(?,?,'all',?,?,?,?)",jid,p.user_id,"اكتملت التسوية الافتراضية",`${c.title} · النتيجة ${expected>=0?'+':''}${(expected/100).toFixed(2)} دولار افتراضي`,c.id,now),
    ]);
  }
  return {processed:due.results.length};
}

export async function getState(db:Database,user:Identity,now=Date.now()):Promise<LabState>{
  await bootstrap(db,user,now);
  const owner=await stmt(db,"SELECT value FROM settings WHERE key='owner'").first<{value:string}>();
  const isAdmin=owner?.value===user.id;
  const profile=await stmt(db,"SELECT id,name,tier,accepted_at,seen_at FROM lab_users WHERE id=?",user.id).first<LabState['user']>();
  if(!profile)throw new AppError("تعذر تحميل الحساب.",503);
  const [cs,ps,notices,rs,entries,audits,balances,realized]=await Promise.all([
    stmt(db,`SELECT c.*,(SELECT COUNT(*) FROM positions p WHERE p.contract_id=c.id) participants FROM contracts c ${isAdmin?'':"WHERE eligibility='all' OR eligibility=?"} ORDER BY published_at DESC LIMIT 100`,...(isAdmin?[]:[profile.tier])).all<Contract>(),
    stmt(db,"SELECT * FROM positions WHERE user_id=? ORDER BY started_at DESC LIMIT 100",user.id).all<Position>(),
    stmt(db,"SELECT * FROM notifications WHERE (user_id=? OR (user_id IS NULL AND (eligibility='all' OR eligibility=?))) AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 50",user.id,profile.tier,now).all<Notice>(),
    stmt(db,"SELECT id,position_id,payload,hash,created_at FROM receipts WHERE user_id=? ORDER BY created_at DESC LIMIT 100",user.id).all<Receipt>(),
    stmt(db,"SELECT e.*,j.kind,j.effective_at FROM ledger_entries e JOIN journals j ON j.id=e.journal_id WHERE j.user_id=? AND j.status='posted' ORDER BY j.effective_at DESC,e.id LIMIT 300",user.id).all<LedgerRow>(),
    isAdmin?stmt(db,"SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100").all<AuditEvent>():Promise.resolve({results:[] as AuditEvent[]}),
    stmt(db,"SELECT e.account,SUM(e.amount_cents) balance FROM ledger_entries e JOIN journals j ON j.id=e.journal_id WHERE j.status='posted' AND e.account IN (?,?) GROUP BY e.account",account(user.id),account(user.id,"reserved")).all<{account:string;balance:number}>(),
    stmt(db,"SELECT COALESCE(SUM(result_cents),0) total FROM positions WHERE user_id=? AND status='settled'",user.id).first<{total:number}>(),
  ]);
  const mapped=new Map(cs.results.map(c=>[c.id,c]));
  const preferenceRow=await stmt(db,"SELECT preferences,profile FROM account_preferences WHERE user_id=?",user.id).first<{preferences:string;profile:string}>();
  const preferences=preferenceRow?JSON.parse(preferenceRow.preferences):{};
  const accountProfile=preferenceRow?JSON.parse(preferenceRow.profile):{};
  if(accountProfile.displayName)profile.name=accountProfile.displayName;
  const visibleNotices=notices.results.filter(n=>{if(n.id.startsWith('campaign:'))return preferences.marketingNotifications===true&&preferences.notificationEvents?.announcement!==false;const kind=n.id.startsWith('start:')?'contract_started':n.id.startsWith('end:')?'contract_ended':n.id.startsWith('settle:')?'settlement':'opportunity';return preferences.notificationEvents?.[kind]!==false;});
  // Preserve the contract of an existing position even when its eligibility is later outside the profile.
  for(const p of ps.results)if(!mapped.has(p.contract_id)){const c=await stmt(db,"SELECT * FROM contracts WHERE id=?",p.contract_id).first<Contract>();if(c)mapped.set(c.id,c);}
  return {serverTime:now,user:profile,isAdmin,balanceCents:balances.results.find(x=>x.account===account(user.id))?.balance??0,reservedCents:balances.results.find(x=>x.account===account(user.id,"reserved"))?.balance??0,realizedCents:realized?.total??0,contracts:cs.results,positions:ps.results.map(p=>({...p,contract:mapped.get(p.contract_id)!})),notifications:visibleNotices,receipts:rs.results,ledger:entries.results,audit:audits.results};
}

export async function performAction(db:Database,user:Identity,body:Record<string,unknown>,now=Date.now()){
  await bootstrap(db,user,now);
  // Mutations trigger overdue settlement before allocation. GET remains read-only after initialization.
  await settleDue(db,now,user.id);
  let result:unknown={ok:true};
  switch(body.action){
    case "accept":await acceptTerms(db,user,now);break;
    case "publish":result=await publishContract(db,user,body,now);break;
    case "join":result=await joinContract(db,user,body,now);break;
    case "settle":break;
    case "read":await stmt(db,"UPDATE lab_users SET seen_at=? WHERE id=?",now,user.id).run();break;
    case "tier":await adminCheck(db,user);if(!["standard","advanced"].includes(String(body.tier)))throw new AppError("فئة غير صالحة.");await db.batch([stmt(db,"UPDATE lab_users SET tier=? WHERE id=?",body.tier,user.id),await event(db,crypto.randomUUID(),user.id,"TEST_TIER_CHANGED",user.id,{tier:body.tier},now)]);break;
    default:throw new AppError("عملية غير مدعومة.");
  }
  return {result,state:await getState(db,user,now)};
}

export async function verifyInvitation(db:Database,user:Identity,code:unknown,now=Date.now()){
 await bootstrap(db,user,now);
 if(typeof code!=='string'||!/^LAB-[A-F0-9]{10}$/.test(code.trim().toUpperCase()))throw new AppError('كود الدعوة غير صالح / Invalid invitation code.');
 const profile=await stmt(db,'SELECT tier FROM lab_users WHERE id=?',user.id).first<{tier:string}>();
 const contract=await stmt(db,'SELECT * FROM contracts WHERE code=?',code.trim().toUpperCase()).first<Contract>();
 if(!contract||contract.eligibility!=='all'&&contract.eligibility!==profile?.tier)throw new AppError('لا توجد دعوة متاحة لحسابك بهذا الكود / Invitation is unavailable for this account.',404);
 if(await sha256(contract.canonical)!==contract.hash)throw new AppError('تعذر التحقق من شروط العقد / Contract integrity check failed.',409);
 return {contract,serverTime:now};
}
