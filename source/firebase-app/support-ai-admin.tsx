import React,{useEffect,useRef,useState} from 'react';
import {Bot,BookOpen,MessagesSquare,Activity,ShieldCheck,Save,Plus,ArrowLeft,FileCheck,PauseCircle,AlertCircle,ChevronLeft,Clock,Send} from 'lucide-react';
import {type ControlSession,type Permission} from '../lib/control-center';
import {SUPPORT_AI_DEFAULTS,SUPPORTED_GEMINI_MODELS,type SupportAIConfig} from '../lib/support-ai-control';
import {TICKET_STATUSES,TICKET_PRIORITIES} from '../lib/control-workflow';
import './support-ai-admin.css';
type Row=Record<string,any>;
type Props={initialData:Row|null;session:ControlSession;read:(path:string,options?:RequestInit)=>Promise<any>;reauthenticate?:()=>Promise<void>;navigate:(module:string)=>void};
type Knowledge=Row&{id:string;title:string;content:string;status:string;reviewed:boolean;revision:number};
const time=(v:unknown)=>typeof v==='number'?new Date(v).toLocaleString('ar',{dateStyle:'medium',timeStyle:'short'}):'—';
const number=(v:unknown)=>typeof v==='number'?v.toLocaleString('en-US'):'—';
const runtimeLabel:Record<string,string>={'disabled':'معطّل من الإعدادات','not-configured':'يلزم إعداد المزوّد على الخادم','configured-unverified':'الإعداد محفوظ؛ لم يُتحقق من الاتصال هنا','invalid-configuration':'إعداد الخادم غير صالح','ready':'المزوّد والنموذج متاحان','unreachable':'لم ينجح التحقق من المزوّد'};
export function SupportAIAdmin({initialData,session,read,reauthenticate,navigate}:Props){
 const [overview,setOverview]=useState<Row>(initialData??{}),[tab,setTab]=useState('overview'),[rows,setRows]=useState<Row[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[draft,setDraft]=useState<SupportAIConfig>({...SUPPORT_AI_DEFAULTS,...initialData?.config}),[reason,setReason]=useState(''),[knowledge,setKnowledge]=useState<Knowledge|null>(null),[reviewed,setReviewed]=useState(false),[thread,setThread]=useState<Row|null>(null),[messages,setMessages]=useState<Row[]>([]),[messagesCursor,setMessagesCursor]=useState<string|null>(null);
 const [activeTicket,setActiveTicket]=useState<Row|null>(null),[ticketDetail,setTicketDetail]=useState<{ticket?:Row;notes?:Row[]}|null>(null),[ticketNoteText,setTicketNoteText]=useState(''),[ticketStatusDraft,setTicketStatusDraft]=useState(''),[ticketPriorityDraft,setTicketPriorityDraft]=useState('');
 const sequence=useRef(0),command=useRef<{fingerprint:string;id:string}|null>(null),dirty=useRef(false);
 const can=(permission:Permission)=>session.permissions.includes(permission);
 useEffect(()=>{if(initialData){setOverview(initialData);if(!dirty.current)setDraft({...SUPPORT_AI_DEFAULTS,...initialData.config})}},[initialData]);
 async function load(section:string,next?:string){
  const seq=++sequence.current;setLoading(true);setError('');
  try{const q=new URLSearchParams({section,...(next?{cursor:next}:{})}),result=await read('/api/control/support-ai?'+q);if(seq!==sequence.current)return;if(section==='overview'){setOverview(result);setDraft({...SUPPORT_AI_DEFAULTS,...result.config});dirty.current=false}else{setRows(next?previous=>[...previous,...result.rows]:result.rows??[]);setCursor(result.nextCursor??null)}}catch(e){if(seq===sequence.current)setError((e as Error).message)}finally{if(seq===sequence.current)setLoading(false)}
 }
 function choose(value:string){if(busy)return;setTab(value);setRows([]);setCursor(null);setThread(null);setMessages([]);setMessagesCursor(null);setKnowledge(null);setActiveTicket(null);setTicketDetail(null);setTicketNoteText('');setReason('');setNotice('');void load(value)}
 async function action(name:string,target:string,revision:number,data:Row){
  const payload={action:name,target,revision,data,reason:reason.trim()};
  if(payload.reason.length<3){setError('اكتب سببًا واضحًا للعملية يظهر في سجل التدقيق.');return false}
  setBusy(true);setError('');setNotice('');
  const fingerprint=JSON.stringify(payload);if(command.current?.fingerprint!==fingerprint)command.current={fingerprint,id:crypto.randomUUID()};
  try{await read('/api/control/action',{method:'POST',body:JSON.stringify({...payload,requestId:command.current.id})});command.current=null;setNotice('حُفظ التغيير الفعلي على الخادم وسُجّل في التدقيق.');setReason('');return true}catch(e){setError((e as Error).message);return false}finally{setBusy(false)}
 }
 const tabs=[['overview','التشغيل',Bot],['knowledge','قاعدة المعرفة',BookOpen],...(can('tickets.read')?([['conversations','المحادثات',MessagesSquare],['tickets','التصعيد',FileCheck]] as const):[]),['usage','الاستخدام',Activity],['errors','الأخطاء',AlertCircle]] as const;
 const reasonField=<label className="sai-wide">سبب التغيير<textarea value={reason} onChange={e=>setReason(e.target.value)} required minLength={3} maxLength={1000} rows={2} placeholder="مرجع المراجعة أو سبب التغيير"/></label>;
 return <section className="sai-admin" aria-label="إدارة الدعم الذكي">
  <div className="sai-intro"><span className="sai-icon"><Bot size={26}/></span><div><h2>ORIN AI Support</h2><p>معرفة معتمدة، صلاحيات محددة، ومتابعة واضحة لكل محادثة.</p></div><span className="sai-protected"><ShieldCheck size={15}/>سجل تدقيق</span></div>
  <nav className="sai-tabs" aria-label="أقسام الدعم الذكي">{tabs.map(([key,label,Icon])=><button type="button" disabled={busy} aria-current={tab===key?'page':undefined} className={tab===key?'active':''} key={key} onClick={()=>choose(key)}><Icon size={16}/>{label}</button>)}</nav>
  {error&&<div className="occ-error" role="alert">{error}{reauthenticate&&<button onClick={()=>void reauthenticate().catch(e=>setError((e as Error).message))}>إعادة التحقق من الهوية</button>}</div>}{notice&&<div className="occ-message" role="status">{notice}</div>}
  {loading&&<p role="status" className="sai-muted">جارٍ قراءة سجلات الخادم…</p>}
  {tab==='overview'&&<>
   <div className="sai-stats"><article><span>الحالة التشغيلية</span><strong className="sai-state">{runtimeLabel[overview.runtime?.status]??'لم تُقرأ الحالة'}</strong><small>{overview.runtime?.checkedAt?'تحقق فعلي من توفر النموذج: '+time(overview.runtime.checkedAt):'وجود إعداد لا يثبت نجاح إجابة من النموذج.'}</small></article><article><span>مصادر المعرفة المنشورة</span><strong>{number(overview.publishedKnowledge)}</strong><small>مراجعة ومعتمدة فقط</small></article><article><span>استخدام اليوم · UTC</span><strong>{number(overview.usage?.totalTokens)}</strong><small>{overview.usage?'Tokens بحسب قياس المزوّد':'لا يوجد استخدام مسجل اليوم'}</small></article></div>
   <section className="sai-panel"><div className="sai-panel-head"><h3>المزوّد وحدود التشغيل</h3><span>الإصدار {overview.config?.revision??0}</span></div>
    <p className="sai-note">مفاتيح المزوّد ووجهته تُضبط على الخادم فقط. {overview.runtime?.credentialPresent?'يوجد اعتماد للمزوّد في بيئة الخادم.':'لم يؤكد الخادم وجود اعتماد للمزوّد.'} {overview.runtime?.operatorEnabled?'مفتاح التشغيل العام مسموح من الخادم.':'التشغيل العام غير مسموح في بيئة الخادم الحالية.'}</p>
    <form onSubmit={async e=>{e.preventDefault();const data=Object.fromEntries(Object.keys(SUPPORT_AI_DEFAULTS).map(key=>[key,draft[key as keyof SupportAIConfig]]));if(await action('support.ai.configure','current',overview.config?.revision??0,data))await load('overview')}}>
     <fieldset disabled={!can('support.ai.configure')||busy} className="sai-form">
      <label className="sai-switch sai-wide"><input type="checkbox" checked={draft.enabled} onChange={e=>{dirty.current=true;setDraft({...draft,enabled:e.target.checked})}}/><span>السماح بإجابات ORIN AI للمستخدمين</span></label>
      <label>المزوّد<select value={draft.provider} onChange={e=>{dirty.current=true;setDraft({...draft,provider:e.target.value as SupportAIConfig['provider'],model:e.target.value==='gemini'?SUPPORT_AI_DEFAULTS.model:''})}}><option value="gemini">Google Gemini</option><option value="openai-compatible">مزوّد متوافق مع OpenAI</option></select></label>
      <label>النموذج{draft.provider==='gemini'?<select value={draft.model} onChange={e=>{dirty.current=true;setDraft({...draft,model:e.target.value})}}>{SUPPORTED_GEMINI_MODELS.map(model=><option value={model} key={model}>{model}</option>)}</select>:<input dir="ltr" value={draft.model} required maxLength={160} onChange={e=>{dirty.current=true;setDraft({...draft,model:e.target.value})}} placeholder="اسم النموذج المعتمد على الخادم"/>}</label>
      <label>حد الرموز للرد<input type="number" min={128} max={2048} step={1} value={draft.maxTokensPerReply} onChange={e=>{dirty.current=true;setDraft({...draft,maxTokensPerReply:Number(e.target.value)})}}/></label>
      <label>ميزانية الرموز اليومية<input type="number" min={1000} max={1000000} step={1} value={draft.dailyTokenBudget} onChange={e=>{dirty.current=true;setDraft({...draft,dailyTokenBudget:Number(e.target.value)})}}/></label>
      <label className="sai-wide">توجيهات أسلوب الدعم<textarea rows={5} maxLength={1500} value={draft.systemInstructions} onChange={e=>{dirty.current=true;setDraft({...draft,systemInstructions:e.target.value})}} placeholder="مثال: استخدم لغة واضحة وخطوات قصيرة، وحوّل الحالات غير المؤكدة إلى فريق الدعم."/><small>توجيهات أسلوبية فقط؛ لا تُغيّر قواعد الأمان أو صلاحيات الأدوات أو نطاق الحساب.</small></label>
      {can('support.ai.configure')&&reasonField}{can('support.ai.configure')&&<button className="occ-primary" type="submit"><Save size={16}/>{busy?'جارٍ التحقق…':'حفظ الإعدادات'}</button>}
     </fieldset>
    </form>
   </section><aside className="sai-policy"><ShieldCheck size={22}/><div><h3>قواعد ثابتة لا يغيّرها المسؤول</h3><p>الإجابات عن ORIN فقط. الوصول إلى بيانات المستخدم نفسه. لا تنفيذ للإيداع أو السحب أو تعديل الرصيد أو الأمان. لا طلب لكلمات المرور أو PIN أو رموز التحقق.</p></div></aside>
  </>}
  {tab==='knowledge'&&<section className="sai-panel"><div className="sai-panel-head"><h3>قاعدة المعرفة المعتمدة</h3>{can('support.knowledge.manage')&&<button className="occ-primary" onClick={()=>{setKnowledge({id:'',title:'',content:'',status:'draft',reviewed:false,revision:0});setReviewed(false);setReason('')}}><Plus size={15}/>مصدر جديد</button>}</div><p className="sai-muted">كل تعديل يعيد المصدر إلى مسودة. لا يستخدمه المساعد حتى يراجعه مخوّل ويعتمده للنشر.</p>
   {knowledge?<form onSubmit={async e=>{e.preventDefault();if(await action('support.knowledge.save',knowledge.id,knowledge.revision,{title:knowledge.title,content:knowledge.content})){setKnowledge(null);await load('knowledge')}}}>
    <fieldset disabled={busy} className="sai-form"><label>معرّف المصدر<input value={knowledge.id} readOnly={knowledge.revision>0} required pattern="[a-z0-9_-]{1,80}" maxLength={80} dir="ltr" onChange={e=>setKnowledge({...knowledge,id:e.target.value})}/></label><label>العنوان<input value={knowledge.title} readOnly={!can('support.knowledge.manage')} required maxLength={120} onChange={e=>setKnowledge({...knowledge,title:e.target.value})}/></label><label className="sai-wide">المحتوى<textarea value={knowledge.content} readOnly={!can('support.knowledge.manage')} required rows={10} maxLength={4000} onChange={e=>{setReviewed(false);setKnowledge({...knowledge,content:e.target.value})}}/></label>{reasonField}
     {can('support.knowledge.manage')&&<button type="submit" className="occ-primary"><Save size={15}/>حفظ مسودة</button>}<button type="button" onClick={()=>setKnowledge(null)}>إغلاق</button>
     {knowledge.revision>0&&can('support.knowledge.publish')&&<div className="sai-review sai-wide"><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>راجعت النسخة المحفوظة رقم {knowledge.revision} وأؤكد دقة معلوماتها.</label><p>لحفظ نص معدل استخدم «حفظ مسودة» أولًا، ثم افتح النسخة الجديدة لمراجعتها.</p><button type="button" disabled={!reviewed||knowledge.title!==rows.find(r=>r.id===knowledge.id)?.title||knowledge.content!==rows.find(r=>r.id===knowledge.id)?.content} onClick={async()=>{if(await action('support.knowledge.publish',knowledge.id,knowledge.revision,{reviewed:true,previewRevision:knowledge.revision})){setKnowledge(null);await load('knowledge')}}}><FileCheck size={15}/>اعتماد ونشر</button>{knowledge.status==='published'&&<button type="button" onClick={async()=>{if(await action('support.knowledge.unpublish',knowledge.id,knowledge.revision,{previewRevision:knowledge.revision})){setKnowledge(null);await load('knowledge')}}}><PauseCircle size={15}/>سحب من المعرفة المنشورة</button>}</div>}
    </fieldset></form>:<div className="sai-records">{rows.map(row=><button key={row.id} onClick={()=>{setKnowledge(row as Knowledge);setReviewed(false);setReason('')}}><span><strong>{row.title}</strong><small dir="ltr">{row.id} · v{row.revision}</small></span><span className={'sai-badge '+(row.status==='published'&&row.reviewed?'is-green':'')}>{row.status==='published'&&row.reviewed?'معتمد ومنشور':'مسودة'}</span></button>)}{!rows.length&&!loading&&<p className="sai-muted">لا توجد مصادر إدارية بعد. المصادر الأساسية المراجعة تبقى خاضعة لضوابط المساعد.</p>}</div>}
  </section>}
  {tab==='conversations'&&<section className="sai-panel"><div className="sai-panel-head"><h3>محادثات العملاء</h3>{can('tickets.manage')&&<button onClick={()=>navigate('tickets')}>فتح مركز الردود <ArrowLeft size={15}/></button>}</div>{thread?<><button onClick={()=>{setThread(null);setMessages([])}}>العودة للقائمة</button><p className="sai-muted"><bdi>{thread.ownerId??thread.id}</bdi> · {thread.handoffRequested?'بانتظار متابعة بشرية':'محادثة'} · {messages.length} رسالة معروضة</p>{messagesCursor&&<button disabled={loading} onClick={async()=>{setLoading(true);try{const d=await read('/api/control/support-ai?section=conversations&thread='+encodeURIComponent(thread.id)+'&messagesCursor='+encodeURIComponent(messagesCursor));setMessages(previous=>[...d.rows,...previous]);setMessagesCursor(d.nextMessagesCursor??null)}catch(e){setError((e as Error).message)}finally{setLoading(false)}}}>رسائل أقدم</button>}{thread.handoffRequested&&can('tickets.manage')&&<div className="sai-review">{reasonField}<p>استئناف المساعد يتطلب حل تذكرة التصعيد المرتبطة، ويترك سجل تدقيق.</p><button disabled={busy} onClick={async()=>{if(await action('support.ai.resume',thread.id,0,{}))setThread({...thread,handoffRequested:false})}}>استئناف الردود الآلية بعد حل التذكرة</button></div>}<div className="sai-messages">{messages.map(row=><article key={row.id} className={row.kind==='customer'?'customer':''}><header>{row.kind==='customer'?'العميل':row.kind==='assistant'?'ORIN AI':'فريق الدعم'}<time>{time(row.createdAt)}</time></header><p>{row.text}</p></article>)}</div></>:<div className="sai-records">{rows.map(row=><button key={row.id} onClick={async()=>{setLoading(true);setError('');try{const detail=await read('/api/control/support-ai?section=conversations&thread='+encodeURIComponent(row.id));setThread(detail.thread);setMessages(detail.rows);setMessagesCursor(detail.nextMessagesCursor??null)}catch(e){setError((e as Error).message)}finally{setLoading(false)}}}><span><strong dir="ltr">{row.ownerId??row.id}</strong><small>{time(row.updatedAt)}</small></span><span className="sai-badge">{row.handoffRequested?'متابعة بشرية':'محادثة'}</span></button>)}{!rows.length&&!loading&&<p className="sai-muted">لا توجد محادثات مسجلة.</p>}</div>}</section>}
  {tab==='tickets'&&<section className="sai-panel">
    <div className="sai-panel-head">
      <h3>التذاكر المصعّدة من المساعد</h3>
      <button onClick={()=>navigate('tickets')}>إدارة التذاكر العامة <ArrowLeft size={15}/></button>
    </div>
    {activeTicket ? (
      <div className="sai-ticket-detail-view">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
          <button onClick={()=>{setActiveTicket(null);setTicketDetail(null);setTicketNoteText('');setNotice('');setError('');}}>
            <ArrowLeft size={15}/> العودة لقائمة التذاكر
          </button>
          <div style={{display:'flex',gap:'8px'}}>
            <button type="button" onClick={async ()=>{
              setLoading(true);
              try {
                const detail = await read('/api/control/support-ai?section=conversations&thread='+encodeURIComponent(activeTicket.conversationId || activeTicket.uid));
                setThread(detail.thread);
                setMessages(detail.rows);
                setMessagesCursor(detail.nextMessagesCursor??null);
                setTab('conversations');
              } catch(e) {
                setError((e as Error).message);
              } finally {
                setLoading(false);
              }
            }}>
              <MessagesSquare size={15}/> محادثة العميل
            </button>
            <button type="button" onClick={()=>navigate('tickets')}>
              فتح في مركز التذاكر <ChevronLeft size={15}/>
            </button>
          </div>
        </div>

        <div style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'16px',padding:'20px',marginBottom:'20px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:'12px',marginBottom:'12px'}}>
            <div>
              <h3 style={{margin:'0 0 6px',fontSize:'18px',color:'#0f172a'}}>{activeTicket.title}</h3>
              <p style={{margin:0,fontSize:'13px',color:'#64748b'}}>
                معرّف التذكرة: <bdi dir="ltr">{activeTicket.id}</bdi> · معرّف العميل: <bdi dir="ltr">{activeTicket.uid}</bdi>
              </p>
            </div>
            <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
              <span className={'sai-badge ' + (['resolved','closed'].includes(activeTicket.status)?'is-green':'')}>
                {TICKET_STATUSES[activeTicket.status as keyof typeof TICKET_STATUSES] || activeTicket.status}
              </span>
              <span className="sai-badge" style={{background:['urgent','high'].includes(activeTicket.priority)?'#fee2e2':'#f1f5f9',color:['urgent','high'].includes(activeTicket.priority)?'#991b1b':'#475569'}}>
                {TICKET_PRIORITIES[activeTicket.priority as keyof typeof TICKET_PRIORITIES] || activeTicket.priority}
              </span>
            </div>
          </div>

          <div style={{background:'#ffffff',border:'1px solid #edf2f7',borderRadius:'12px',padding:'14px',margin:'12px 0'}}>
            <strong style={{fontSize:'13px',color:'#334155'}}>تفاصيل الطلب / رسالة التصعيد:</strong>
            <p style={{margin:'6px 0 0',fontSize:'13.5px',lineHeight:'1.7',color:'#1e293b',whiteSpace:'pre-wrap'}}>
              {activeTicket.description || activeTicket.message || 'تم تحويل هذه التذكرة آلياً من المساعد الذكي لمتابعة فريق الدعم البشري.'}
            </p>
          </div>

          <div style={{display:'flex',gap:'20px',fontSize:'12px',color:'#64748b',flexWrap:'wrap'}}>
            <span>تاريخ الإنشاء: {time(activeTicket.createdAt)}</span>
            <span>آخر تحديث: {time(activeTicket.updatedAt)}</span>
            {activeTicket.category && <span>النوع: {activeTicket.category}</span>}
          </div>
        </div>

        {can('tickets.manage') && !['resolved','closed'].includes(activeTicket.status) && (
          <div className="sai-review sai-wide" style={{marginBottom:'20px',border:'1px solid #bbf7d0',background:'#f0fdf4'}}>
            <h4 style={{margin:'0 0 6px',color:'#166534',fontSize:'15px',display:'flex',alignItems:'center',gap:'8px'}}>
              <FileCheck size={18}/> حل التذكرة واستئناف المساعد الذكي
            </h4>
            <p style={{margin:'0 0 12px',color:'#15803d',fontSize:'13px'}}>
              سيقوم هذا الإجراء بتعيين حالة التذكرة إلى «تم الحل» واستئناف المحادثة الآلية للعميل في ORIN فورًا.
            </p>
            {reasonField}
            <button
              type="button"
              className="occ-primary"
              disabled={busy}
              onClick={async ()=>{
                if (!reason.trim() || reason.trim().length < 3) {
                  setError('يرجى كتابة سبب العملية (3 أحرف على الأقل) لسجل التدقيق.');
                  return;
                }
                const ok = await action('ticket.update', activeTicket.id, activeTicket.revision||0, { status: 'resolved' });
                if (ok) {
                  await action('support.ai.resume', activeTicket.conversationId || activeTicket.uid, 0, {});
                  setActiveTicket(prev => prev ? ({ ...prev, status: 'resolved' }) : null);
                  await load('tickets');
                }
              }}
            >
              <FileCheck size={15}/> حل التذكرة واستئناف المساعد الآن
            </button>
          </div>
        )}

        {can('tickets.manage') && (
          <form onSubmit={async e=>{
            e.preventDefault();
            if (await action('ticket.update', activeTicket.id, activeTicket.revision||0, { status: ticketStatusDraft, priority: ticketPriorityDraft })) {
              setActiveTicket(prev => prev ? ({ ...prev, status: ticketStatusDraft, priority: ticketPriorityDraft }) : null);
              await load('tickets');
            }
          }} style={{marginBottom:'24px'}}>
            <fieldset disabled={busy} className="sai-form">
              <label>حالة التذكرة
                <select value={ticketStatusDraft} onChange={e=>setTicketStatusDraft(e.target.value)}>
                  {Object.entries(TICKET_STATUSES).map(([k, v])=><option key={k} value={k}>{v} ({k})</option>)}
                </select>
              </label>
              <label>الأولوية
                <select value={ticketPriorityDraft} onChange={e=>setTicketPriorityDraft(e.target.value)}>
                  {Object.entries(TICKET_PRIORITIES).map(([k, v])=><option key={k} value={k}>{v} ({k})</option>)}
                </select>
              </label>
              {reasonField}
              <button type="submit" className="occ-primary"><Save size={15}/> حفظ التغييرات</button>
            </fieldset>
          </form>
        )}

        <div style={{borderTop:'1px solid #e2e8f0',paddingTop:'20px'}}>
          <h4 style={{margin:'0 0 12px',fontSize:'15px',color:'#0f172a'}}>الملاحظات الداخلية ({ticketDetail?.notes?.length ?? 0})</h4>
          <div style={{display:'grid',gap:'10px',marginBottom:'18px'}}>
            {ticketDetail?.notes?.map((n:any)=>(
              <div key={n.id} style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'12px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:'11.5px',color:'#64748b',marginBottom:'5px'}}>
                  <strong style={{color:'#334155'}}><bdi>{n.authorId}</bdi></strong>
                  <time>{time(n.createdAt)}</time>
                </div>
                <p style={{margin:0,fontSize:'13px',color:'#1e293b',whiteSpace:'pre-wrap'}}>{n.body}</p>
              </div>
            ))}
            {!ticketDetail?.notes?.length && <p className="sai-muted">لا توجد ملاحظات داخلية مسجلة لهذه التذكرة بعد.</p>}
          </div>

          {can('tickets.manage') && (
            <form onSubmit={async e=>{
              e.preventDefault();
              if (!ticketNoteText.trim()) return;
              if (await action('ticket.note', activeTicket.id, 0, { body: ticketNoteText.trim() })) {
                setTicketNoteText('');
                try {
                  const updated = await read('/api/control/tickets?ticket=' + encodeURIComponent(activeTicket.id));
                  if (updated) setTicketDetail(updated);
                } catch {}
              }
            }}>
              <fieldset disabled={busy} className="sai-form">
                <label className="sai-wide">إضافة ملاحظة داخلية جديدة
                  <textarea rows={2} maxLength={2000} value={ticketNoteText} onChange={e=>setTicketNoteText(e.target.value)} required placeholder="ملاحظة للموظفين فقط..."/>
                </label>
                {reasonField}
                <button type="submit" className="occ-primary"><Plus size={15}/> إضافة الملاحظة</button>
              </fieldset>
            </form>
          )}
        </div>
      </div>
    ) : (
      <div className="sai-records">
        {rows.map(row=>(
          <button
            key={row.id}
            type="button"
            className="sai-ticket-card-btn"
            onClick={async ()=>{
              setActiveTicket(row);
              setTicketStatusDraft(row.status || 'open');
              setTicketPriorityDraft(row.priority || 'normal');
              setTicketDetail(null);
              setLoading(true);
              try {
                const res = await read('/api/control/tickets?ticket=' + encodeURIComponent(row.id));
                if (res?.ticket) {
                  setActiveTicket(res.ticket);
                  setTicketStatusDraft(res.ticket.status || 'open');
                  setTicketPriorityDraft(res.ticket.priority || 'normal');
                  setTicketDetail(res);
                }
              } catch(e) {
                setError((e as Error).message);
              } finally {
                setLoading(false);
              }
            }}
          >
            <div style={{display:'grid',gap:'6px',textAlign:'right'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
                <strong style={{fontSize:'14.5px',color:'#0f172a'}}>{row.title}</strong>
                <span className={'sai-badge ' + (['resolved','closed'].includes(row.status)?'is-green':'')}>
                  {TICKET_STATUSES[row.status as keyof typeof TICKET_STATUSES] || row.status}
                </span>
                <span className="sai-badge" style={{background:['urgent','high'].includes(row.priority)?'#fee2e2':'#f1f5f9',color:['urgent','high'].includes(row.priority)?'#991b1b':'#475569'}}>
                  {TICKET_PRIORITIES[row.priority as keyof typeof TICKET_PRIORITIES] || row.priority}
                </span>
              </div>
              <p style={{margin:0,fontSize:'12.5px',color:'#64748b'}}>
                العميل: <bdi dir="ltr">{row.uid}</bdi> · {time(row.updatedAt)}
              </p>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'6px',color:'#0284c7',fontSize:'13px',fontWeight:600}}>
              <span>إدارة ومتابعة</span>
              <ArrowLeft size={15}/>
            </div>
          </button>
        ))}
        {!rows.length&&!loading&&<p className="sai-muted">لا توجد تذاكر تصعيد مسجلة.</p>}
      </div>
    )}
  </section>}
  {tab==='usage'&&<section className="sai-panel"><h3>الاستخدام · آخر 30 يومًا مسجلًا</h3><p className="sai-muted">الأيام بتوقيت UTC. الحجز يحمي الميزانية أثناء الطلبات المتزامنة؛ الفشل بعد بدء الاستدلال قد يُحتسب تحفظيًا.</p><div className="occ-table-scroll"><table className="sai-table"><thead><tr><th>اليوم</th><th>الطلبات</th><th>رموز الإدخال</th><th>رموز الإخراج</th><th>الإجمالي المقاس</th><th>المحتسب على الميزانية</th><th>غير المقاس</th><th>المحجوز</th><th>الفشل</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}>{[row.id,row.requests,row.inputTokens,row.outputTokens,row.totalTokens,row.budgetDebitedTokens,row.unmeasuredTokens,row.reservedTokens,row.failures].map((v,i)=><td key={i}><bdi>{typeof v==='string'?v:number(v)}</bdi></td>)}</tr>)}</tbody></table></div>{!rows.length&&!loading&&<p className="sai-muted">لا يوجد استخدام فعلي مسجل.</p>}</section>}
  {tab==='errors'&&<section className="sai-panel"><h3>آخر أخطاء الخدمة</h3><p className="sai-muted">رموز تشخيصية فقط؛ لا تُعرض أسرار أو نصوص محادثات ضمن سجل الأخطاء.</p><div className="sai-records">{rows.map(row=><article key={row.id}><strong dir="ltr">{row.code}</strong><p dir="ltr">{row.provider} · {row.model}</p><small>{time(row.createdAt)}</small></article>)}{!rows.length&&!loading&&<p className="sai-muted">لا توجد أخطاء مسجلة.</p>}</div></section>}
  {cursor&&!knowledge&&!thread&&!activeTicket&&<button disabled={loading} onClick={()=>void load(tab,cursor)}>عرض المزيد</button>}
 </section>;
}
