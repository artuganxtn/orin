'use client';
import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {Clock3,LoaderCircle,MessageCircleMore,MoreHorizontal,Send,UserRound,UsersRound,Wallet,ArrowUpFromLine,ChartNoAxesCombined,ArrowUpRight,CheckCheck} from 'lucide-react';
import {readOutbox,saveOutbox,mergeSupportMessages,supportAgentOnline,type SupportMessage,type PendingMessage,type SupportConnection,type SupportSnapshot,type SupportTransport,type SupportAssistantCapability,type SupportAssistantPhase,type SupportTicket} from '@/lib/support';
import {useNavigation} from './orin-navigation';
import {useOrin} from './orin-settings';
import {FullPage,FullPageContent} from './full-page';
import './support-chat.css';
export const SupportContext=createContext<SupportTransport|null>(null);
export function SupportChat(){const {settings}=useOrin();return <SupportSession key={settings?.clientId??''} uid={settings?.clientId??''}/>}
/** A support-person silhouette, not a photograph or a claim about a specific employee. */
function AdamAvatar({small=false}:{small?:boolean}){return <span className={'adam-avatar'+(small?' small':'')} aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="25" r="10" fill="currentColor" opacity=".95"/><path d="M14 54c1-12 9-18 18-18s17 6 18 18" fill="currentColor" opacity=".95"/><path d="M15 29v-4c0-10 7-17 17-17s17 7 17 17v4M49 34v4c0 5-4 8-10 8" stroke="#82e8ff" strokeWidth="3.4" strokeLinecap="round"/><rect x="10" y="23" width="8" height="15" rx="4" fill="#82e8ff"/><rect x="46" y="23" width="8" height="15" rx="4" fill="#82e8ff"/><rect x="33" y="43" width="10" height="5" rx="2.5" fill="#82e8ff"/></svg></span>}
function SupportSession({uid}:{uid:string}){
 const transport=useContext(SupportContext),{path,back}=useNavigation(),{t,prefs}=useOrin(),open=path==='/support'||path.startsWith('/support/');
 const [snapshot,setSnapshot]=useState<SupportSnapshot>({messages:[],handoffRequested:false,hasOlder:false});
 const [connection,setConnection]=useState<SupportConnection>('connecting'),[pending,setPending]=useState<PendingMessage[]>(()=>uid?readOutbox(uid):[]);
 const [text,setText]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0),[assistant,setAssistant]=useState<SupportAssistantCapability|null>(null);
 const [assistantBusy,setAssistantBusy]=useState(false),[assistantNote,setAssistantNote]=useState(''),[phase,setPhase]=useState<SupportAssistantPhase>('reading'),[streamText,setStreamText]=useState(''),[streamFor,setStreamFor]=useState(''),[retryReply,setRetryReply]=useState('');
 const [ticket,setTicket]=useState<SupportTicket|null>(null),[escalating,setEscalating]=useState(false),[older,setOlder]=useState(false),[olderMessages,setOlderMessages]=useState<SupportMessage[]>([]),[moreOlder,setMoreOlder]=useState<boolean|null>(null),[sending,setSending]=useState(false);
 const merged=mergeSupportMessages(olderMessages,snapshot.messages),messages=Array.from(new Map(merged.map(m=>[m.id,m])).values()),online=supportAgentOnline(connection,assistant,snapshot.handoffRequested);
 const lastSend=useRef(0),bottom=useRef<HTMLDivElement>(null),list=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null),menu=useRef<HTMLDetailsElement>(null),nearBottom=useRef(true),alive=useRef(true),replyController=useRef<AbortController|null>(null),assistantRef=useRef(assistant),handoffRef=useRef(snapshot.handoffRequested),sendLock=useRef(false);
 assistantRef.current=assistant;handoffRef.current=snapshot.handoffRequested;
 const time=(date:number)=>date?new Date(date).toLocaleTimeString(prefs.chartLocale,{timeZone:prefs.timezone,hour:'2-digit',minute:'2-digit'}):'…';
 const day=(date:number)=>new Date(date).toLocaleDateString(prefs.chartLocale,{timeZone:prefs.timezone,day:'numeric',month:'long',year:'numeric'});
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;replyController.current?.abort()}},[]);
 useEffect(()=>{if(!open){replyController.current?.abort();return}if(!uid||!transport?.assistantCapability)return;let active=true;const load=()=>{if(!navigator.onLine)return;void transport.assistantCapability!().then(value=>{if(active){setAssistant(value);setTicket(value.activeTicket??null)}}).catch(()=>{if(active)setAssistant(null)})};load();const timer=setInterval(load,60000);addEventListener('online',load);return()=>{active=false;clearInterval(timer);removeEventListener('online',load)}},[open,uid,transport,revision]);
 useEffect(()=>{
  if(!open)return;if(!uid||!transport){setConnection('unavailable');return}
  let active=true,retry:ReturnType<typeof setTimeout>|undefined;setConnection(navigator.onLine?'connecting':'offline');
  const timer=setTimeout(()=>{if(active){setConnection(navigator.onLine?'unavailable':'offline');if(navigator.onLine&&!retry)retry=setTimeout(()=>{if(active)setRevision(v=>v+1)},30000)}},12000);
  const stop=transport.watch(uid,value=>{if(active)setSnapshot(value);if(assistantBusy&&value.messages.some(m=>m.kind==='assistant'||m.kind==='system_notice'))setAssistantBusy(false)},state=>{if(!active)return;if(state!=='connecting')clearTimeout(timer);setConnection(state);if(state==='unavailable'&&!retry)retry=setTimeout(()=>{if(active)setRevision(v=>v+1)},30000);if(state==='connected'&&retry){clearTimeout(retry);retry=undefined}});
  const onOnline=()=>setRevision(v=>v+1),offline=()=>setConnection('offline');addEventListener('online',onOnline);addEventListener('offline',offline);
  return()=>{active=false;clearTimeout(timer);if(retry)clearTimeout(retry);stop();removeEventListener('online',onOnline);removeEventListener('offline',offline)};
 },[open,uid,transport,revision,assistantBusy]);
 useEffect(()=>{if(!uid)return;try{saveOutbox(uid,pending)}catch{setError(t('تعذر حفظ المسودة على الجهاز.','Could not save the draft on this device.'))}},[pending,uid]);
 useEffect(()=>{setPending(old=>old.filter(p=>!snapshot.messages.some(m=>m.id===p.id&&!m.pendingWrite)));if(streamFor&&snapshot.messages.some(m=>m.assistant?.inReplyTo===streamFor)){setStreamText('');setStreamFor('');setRetryReply('')}},[snapshot.messages,streamFor]);
 useEffect(()=>{if(nearBottom.current)bottom.current?.scrollIntoView({block:'nearest'})},[snapshot.messages.length,pending.length,streamText,assistantBusy,open]);
 async function requestReply(messageId:string){
  if(!transport?.askAssistant||replyController.current||handoffRef.current)return;
  const controller=new AbortController();replyController.current=controller;setAssistantBusy(true);setAssistantNote('');setRetryReply('');setStreamFor(messageId);setStreamText('');setPhase('reading');
  try{
   let capability=assistantRef.current;if(!capability?.available&&transport.assistantCapability){capability=await transport.assistantCapability();if(alive.current)setAssistant(capability)}
   if(!alive.current||controller.signal.aborted)return;
   if(!capability?.available||capability.reason!=='ready'){setAssistantNote(t('Adam غير متاح الآن. رسالتك محفوظة ويمكنك طلب متابعة من الفريق.','Adam is not available right now. Your message is saved; you can request team follow-up.'));setRetryReply(messageId);return}
   const result=await transport.askAssistant(messageId,{signal:controller.signal,onStatus:value=>{if(alive.current&&!controller.signal.aborted)setPhase(value)},onChunk:chunk=>{if(alive.current&&!controller.signal.aborted)setStreamText(value=>value+chunk)}});
   if(!alive.current||controller.signal.aborted)return;
   if(result.ticket)setTicket(result.ticket);
   if(result.reply&&alive.current){
     const replyId = result.messageId || ('asst-' + messageId);
     setSnapshot(old => ({
       ...old,
       messages: old.messages.some(m => m.id === replyId || (m.assistant?.inReplyTo === messageId && m.kind === 'assistant'))
         ? old.messages
         : [...old.messages, {
             id: replyId,
             text: result.reply || '',
             kind: ((result.kind || 'assistant') as any),
             senderId: 'assistant',
             createdAt: Date.now(),
             assistant: { inReplyTo: messageId }
           }]
     }));
   }
   if(result.status==='unavailable'){setAssistantNote(t('لم يكتمل الرد. رسالتك محفوظة للمتابعة.','The reply could not be completed. Your message is saved for follow-up.'));setRetryReply(messageId);setAssistant(old=>old?{...old,available:false,reason:'model_unreachable'}:null)}
   else if(result.status==='pending'){setAssistantNote(t('ما زال الرد قيد التجهيز. يمكنك متابعته بعد قليل.','Your reply is still being prepared. You can check again shortly.'));setRetryReply(messageId)}
   else if(result.status==='handoff'||result.handoff)setAssistantNote(t('تم إرسال طلب متابعة إلى فريق دعم ORIN.','A follow-up request was sent to the ORIN support team.'));
  }catch(e){if(alive.current){setStreamText('');setRetryReply(messageId);if(!controller.signal.aborted)setAssistantNote(t('انقطع الرد. رسالتك محفوظة؛ يمكنك المحاولة مجددًا.','The reply was interrupted. Your message is saved; you can try again.'))}}
  finally{if(replyController.current===controller)replyController.current=null;if(alive.current)setAssistantBusy(false)}
 }
 useEffect(()=>{
  const row=pending.find(p=>p.state==='queued');if(!open||!transport||!uid||connection!=='connected'||!row||sendLock.current)return;
  sendLock.current=true;setSending(true);setPending(old=>old.map(p=>p.id===row.id?{...p,state:'sending'}:p));
  void new Promise<void>(resolve=>setTimeout(resolve,Math.max(0,1100-(Date.now()-lastSend.current)))).then(async()=>{
    try{
      await transport.send(uid,row.id,row.text);
      if(alive.current)setAssistantBusy(true);
    }catch{
      if(alive.current){
        setPending(old=>old.map(p=>p.id===row.id?{...p,state:'failed'}:p));
        setError(t('لم تصل الرسالة إلى الخدمة. مسودتك محفوظة.','The message did not reach the service. Your draft is saved.'));
      }
    }
  }).finally(()=>{lastSend.current=Date.now();sendLock.current=false;if(alive.current)setSending(false)});
 },[connection,open,uid,transport,sending,pending.find(p=>p.state==='queued')?.id]);
 const submit=()=>{const value=text.trim();if(!value||value.length>2000||pending.length>=50)return;nearBottom.current=true;setPending(old=>[...old,{id:crypto.randomUUID(),text:value,createdAt:Date.now(),state:'queued'}]);setText('');setError('');input.current?.focus()};
 async function escalate(){if(!transport||!uid||escalating)return;setEscalating(true);setError('');if(menu.current)menu.current.open=false;try{const last=messages.filter(m=>m.kind==='customer').at(-1);const result=await transport.handoff(uid,last?.id);if(alive.current){setTicket(result.ticket);setSnapshot(value=>({...value,handoffRequested:true}));setAssistantNote('');setRetryReply('');replyController.current?.abort()}}catch(e){if(alive.current)setError((e as Error).message||t('تعذر إرسال طلب المتابعة.','Could not request follow-up.'))}finally{if(alive.current)setEscalating(false)}}
 const status=online?t('متصل الآن','Online now'):connection==='offline'?t('لا يوجد اتصال بالإنترنت','No internet connection'):connection==='connecting'?t('جار الاتصال…','Connecting…'):snapshot.handoffRequested?t('طلبك لدى فريق الدعم','Your request is with the support team'):t('يمكنك ترك رسالة للفريق','Leave a message for the team');
 const topics=[{ar:'إيداع الأموال',en:'Deposit',Icon:Wallet},{ar:'سحب الأموال',en:'Withdrawal',Icon:ArrowUpFromLine},{ar:'مشكلة في التداول',en:'Trading',Icon:ChartNoAxesCombined},{ar:'المحفظة والحساب',en:'Wallet & account',Icon:UserRound}];
 const visibleStream=streamText&&!messages.some(m=>m.assistant?.inReplyTo===streamFor);
 return <FullPage open={open} onOpenChange={v=>{if(!v)back('/')}}><FullPageContent className="support-page support-page-v3 support-page-adam" pageClassName="orin-support-screen"
  navTitle={<div className="support-brand"><img src="/brand/orin-mark.png" width="40" height="40" alt=""/><div><h1>{t('دعم ORIN','ORIN Support')}</h1><p>{t('نحن هنا لمساعدتك','We are here to help')}</p></div></div>}
  navActions={<details className="support-menu" ref={menu}><summary aria-label={t('خيارات المحادثة','Conversation options')}><MoreHorizontal/></summary><div><p>{t('لا تُرسل كلمات مرور أو رموز تحقق.','Do not share passwords or verification codes.')}</p><button type="button" disabled={escalating||connection!=='connected'} onClick={()=>void escalate()}>{ticket?t('عرض طلب المتابعة','Check follow-up request'):t('التحدث إلى الفريق','Speak to the team')}</button></div></details>}>
  <div className={'support-team adam-team '+(online?'available':'')}><AdamAvatar/><div><strong>{'Adam'}</strong><span className="adam-team-name">{t('فريق دعم ORIN','ORIN support team')}</span><p className="support-status" role="status"><i aria-hidden="true"/>{status}</p></div><button className="adam-escalate" type="button" disabled={escalating||connection!=='connected'} onClick={()=>void escalate()} aria-label={t('طلب متابعة من فريق الدعم','Request team follow-up')}><UsersRound size={18}/><span>{escalating?t('جار الإرسال…','Sending…'):t('متابعة مع الفريق','Team follow-up')}</span></button></div>
  {ticket&&<section className="adam-ticket" role="status"><CheckCheck size={17}/><span><b>{t('طلب متابعة','Support request')} <bdi>#{ticket.id.slice(-8).toUpperCase()}</bdi></b><small>{ticket.status==='resolved'||ticket.status==='closed'?t('تمت المعالجة','Resolved'):ticket.status==='waiting'?t('بانتظار ردك','Waiting for your reply'):ticket.status==='in_progress'?t('قيد المتابعة','In progress'):t('تم استلام طلبك','Request received')}</small></span><time dateTime={new Date(ticket.createdAt).toISOString()}>{time(ticket.createdAt)}</time></section>}
  <div className="support-messages" ref={list} role="log" aria-live="polite" aria-label={t('سجل المحادثة','Conversation history')} onScroll={()=>{const el=list.current;if(el)nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<90}}>
   {(moreOlder??snapshot.hasOlder)&&<button className="support-older" disabled={older} onClick={async()=>{if(!transport||!messages.length)return;setOlder(true);const height=list.current?.scrollHeight??0;try{const rows=await transport.older(uid,messages[0].createdAt);setOlderMessages(old=>mergeSupportMessages(rows,old));setMoreOlder(rows.length===50);requestAnimationFrame(()=>{if(list.current)list.current.scrollTop+=list.current.scrollHeight-height})}catch{setError(t('الرسائل السابقة غير متاحة حاليًا.','Older messages are currently unavailable.'))}finally{setOlder(false)}}}>{t('الرسائل السابقة','Earlier messages')}</button>}
   {!messages.length&&!pending.length&&<section className="support-welcome adam-welcome"><div className="adam-welcome-intro"><AdamAvatar/><div><span>{t('أهلًا بك في ORIN','Welcome to ORIN')}</span><h2>{t('كيف أساعدك اليوم؟','How can I help today?')}</h2><p>{t('أنا Adam. اسألني عن حسابك وميزات ORIN.','I’m Adam. Ask me about your account and ORIN features.')}</p></div></div><div className="support-topics">{topics.map(({ar,en,Icon})=><button type="button" key={en} onClick={()=>{setText(t('أريد المساعدة في: ','I need help with: ')+t(ar,en));input.current?.focus()}}><Icon size={18}/>{t(ar,en)}<ArrowUpRight size={14}/></button>)}</div></section>}
   {messages.map((m,index)=><div className="support-message-row" key={m.id}>{(!index||day(messages[index-1].createdAt)!==day(m.createdAt))&&m.createdAt>0&&<div className="support-date">{day(m.createdAt)}</div>}{m.kind==='system_notice'?(<div className="adam-message-line system-notice" style={{display:'flex',justifyContent:'center',margin:'14px 0',width:'100%'}}><article className="support-bubble system-notice" style={{background:'#fef3c7',border:'1px solid #fde68a',color:'#92400e',maxWidth:'90%',margin:'0 auto',textAlign:'center',borderRadius:'14px',padding:'12px 16px',boxShadow:'0 2px 8px rgba(245,158,11,0.08)'}}><p style={{margin:0,fontSize:'13px',lineHeight:1.6,fontWeight:500}}>{m.text}</p><button type="button" onClick={()=>void escalate()} style={{marginTop:'10px',border:0,background:'#d97706',color:'#fff',padding:'7px 14px',borderRadius:'8px',fontWeight:600,fontSize:'12px',cursor:'pointer'}}>{t('متابعة مع فريق الدعم','Request team follow-up')}</button></article></div>):(<div className={'adam-message-line '+m.kind}>{m.kind!=='customer'&&<AdamAvatar small/>}<article className={'support-bubble '+m.kind}>{m.kind!=='customer'&&<b>{m.kind==='assistant'?'Adam':t('فريق دعم ORIN','ORIN support team')}</b>}<p>{m.text}</p><small><time dateTime={m.createdAt?new Date(m.createdAt).toISOString():undefined}>{time(m.createdAt)}</time>{m.kind==='customer'&&<span className="support-delivery" role="img" aria-label={m.pendingWrite?t('جار الإرسال','Sending'):t('تم التسليم للخدمة','Delivered to support service')} title={m.pendingWrite?t('جار الإرسال','Sending'):t('تم التسليم للخدمة','Delivered to support service')}>{m.pendingWrite?<Clock3 size={13}/>:<CheckCheck size={15}/>}</span>}</small></article></div>)}</div>)}
   {pending.filter(m=>!messages.some(sent=>sent.id===m.id)).map(m=><div className="adam-message-line customer" key={m.id}><article className="support-bubble customer pending"><p>{m.text}</p><small><time dateTime={new Date(m.createdAt).toISOString()}>{time(m.createdAt)}</time><span className="support-delivery" role="img" aria-label={m.state==='failed'?t('لم تُرسل','Not sent'):t('جار الإرسال','Sending')} title={m.state==='failed'?t('لم تُرسل','Not sent'):t('جار الإرسال','Sending')}>{m.state==='failed'?<span aria-hidden="true">!</span>:m.state==='sending'?<LoaderCircle className="support-sending" size={13}/>:<Clock3 size={13}/>}</span></small>{m.state==='failed'&&<button type="button" className="support-send-again" onClick={()=>{setError('');setPending(old=>old.map(p=>p.id===m.id?{...p,state:'queued'}:p))}}>{t('إرسال مجددًا','Send again')}</button>}</article></div>)}
   {visibleStream&&<div className="adam-message-line assistant"><AdamAvatar small/><article className="support-bubble assistant"><b>{'Adam'}</b><p>{streamText}</p><small>{t('جار مزامنة المحادثة…','Syncing conversation…')}</small></article></div>}
   {assistantBusy&&!visibleStream&&<div className="adam-typing" role="status"><AdamAvatar small/><span><b>{phase==='reading'?t('Adam يقرأ رسالتك','Adam is reading your message'):phase==='saving'?t('جار حفظ الرد','Saving reply'):t('Adam يكتب…','Adam is typing…')}</b><i aria-hidden="true"><em/><em/><em/></i></span></div>}
   <div ref={bottom}/>
  </div>
  {assistantNote&&<div className="adam-reply-note" role="status"><p>{assistantNote}</p>{retryReply&&!snapshot.handoffRequested&&!assistantBusy&&<button type="button" disabled={connection!=='connected'} onClick={()=>void requestReply(retryReply)}>{t('المحاولة مجددًا','Try again')}</button>}</div>}
  {error&&<p role="alert" className="support-inline-error">{error}</p>}
  <form className="support-composer" onSubmit={e=>{e.preventDefault();submit()}}>
    <textarea
      ref={input}
      aria-label={t('رسالتك','Your message')}
      placeholder={t('اكتب رسالتك لAdam…','Write to Adam…')}
      value={text}
      maxLength={2000}
      onChange={e=>{
        setText(e.target.value);
        if (input.current) {
          input.current.style.height = 'auto';
          input.current.style.height = Math.min(input.current.scrollHeight, 120) + 'px';
        }
      }}
      onKeyDown={e=>{
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submit();
        }
      }}
      rows={1}
    />
    <button type="submit" disabled={!text.trim()||pending.length>=50} aria-label={t('إرسال الرسالة','Send message')}><Send size={22}/></button>
  </form>
  <p className="adam-privacy-note">{t('لأمانك، لا تشارك كلمة المرور أو رموز التحقق.','For your security, never share passwords or verification codes.')}</p>
 </FullPageContent></FullPage>;
}
