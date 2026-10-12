export type SupportMessage={id:string;text:string;kind:'customer'|'staff'|'assistant';senderId:string;createdAt:number;pendingWrite?:boolean;assistant?:{knowledgeVersion:string;citationIds:string[];inReplyTo:string}};
export type SupportTicket={id:string;status:'open'|'in_progress'|'waiting'|'resolved'|'closed';createdAt:number};
export type SupportAssistantCapability={available:boolean;reason:'ready'|'security_backend_required'|'model_not_configured'|'model_configuration_invalid'|'model_unreachable';knowledgeVersion:string;requiredServices:string[];activeTicket?:SupportTicket|null};
export type SupportAssistantResult={status:'answered'|'pending'|'handoff'|'unavailable';replyId?:string;handoff?:boolean;ticket?:SupportTicket};
export type SupportAssistantPhase='reading'|'generating'|'saving';
export type SupportAssistantOptions={onChunk?:(text:string)=>void;onStatus?:(phase:SupportAssistantPhase)=>void;signal?:AbortSignal};
export type SupportSnapshot={messages:SupportMessage[];handoffRequested:boolean;hasOlder:boolean};
/** Preserve paginated history when the live subscription refreshes its latest window. */
export function mergeSupportMessages(older:SupportMessage[],latest:SupportMessage[]):SupportMessage[]{
 return [...new Map([...older,...latest].map(message=>[message.id,message])).values()].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
}
export type SupportConnection='connecting'|'connected'|'offline'|'unavailable';
export function supportAgentOnline(connection:SupportConnection,capability:SupportAssistantCapability|null,handoffRequested=false){return connection==='connected'&&capability?.available===true&&capability.reason==='ready'&&!handoffRequested}
/** The trusted server controls replies and escalation; credentials never reach this adapter. */
export interface SupportAgent {reply(input:{conversationId:string;messages:SupportMessage[]}):Promise<{text:string;handoff:boolean}>}
export interface SupportTransport {
 watch(uid:string,receive:(value:SupportSnapshot)=>void,connection:(state:SupportConnection)=>void):()=>void;
 send(uid:string,id:string,text:string):Promise<void>;
 handoff(uid:string,messageId?:string):Promise<{ticket:SupportTicket}>;
 older(uid:string,before:number):Promise<SupportMessage[]>;
 watchThreads?:(receive:(rows:{id:string;updatedAt:number;handoffRequested:boolean}[])=>void,fail:()=>void)=>()=>void;
 reply?:(uid:string,id:string,text:string)=>Promise<void>;
 assistantCapability?:()=>Promise<SupportAssistantCapability>;
 askAssistant?:(messageId:string,options?:SupportAssistantOptions)=>Promise<SupportAssistantResult>;
}
export function supportText(value:string){const text=value.trim();if(!text||text.length>2000)throw new Error('Message must contain 1–2000 characters');return text}
export type PendingMessage={id:string;text:string;createdAt:number;state:'queued'|'sending'|'failed'};
export function readOutbox(uid:string):PendingMessage[]{try{return JSON.parse(localStorage.getItem('orin-support-outbox:'+uid)??'[]').filter((m:PendingMessage)=>typeof m.id==='string'&&typeof m.text==='string'&&m.text.length<=2000).slice(-50).map((m:PendingMessage)=>({...m,state:'queued'}))}catch{return []}}
export function saveOutbox(uid:string,messages:PendingMessage[]){localStorage.setItem('orin-support-outbox:'+uid,JSON.stringify(messages.slice(-50)))}
function assistantResult(value:unknown):SupportAssistantResult{if(!value||typeof value!=='object')throw new Error('Invalid support response');const st=String((value as {status?:unknown}).status||'ready');if(!['answered','pending','handoff','unavailable','ready','ok'].includes(st))throw new Error('Invalid support response');return value as SupportAssistantResult}
/** Reads genuine server events; never simulates word-by-word output from a final string. */
export async function readSupportAssistantResponse(response:Response,options:SupportAssistantOptions={}):Promise<SupportAssistantResult>{
 if(!response.ok)throw new Error('خدمة الرد غير متاحة حاليًا. / Support reply is currently unavailable.');
 if(!response.headers.get('content-type')?.includes('text/event-stream'))return assistantResult(await response.json());
 if(!response.body)throw new Error('Empty support stream');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,textLength=0,completed:SupportAssistantResult|null=null;
 const aborted=()=>{void reader.cancel().catch(()=>{})};options.signal?.addEventListener('abort',aborted,{once:true});
 const frame=(value:string)=>{let event='message';const data:string[]=[];for(const line of value.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data.push(line.slice(5).trimStart())}if(!data.length)return;const raw:unknown=JSON.parse(data.join('\n'));if(!raw||typeof raw!=='object')throw new Error('Invalid support stream event');const payload=raw as Record<string,unknown>;
  if(event==='status'&&['reading','generating','saving'].includes(String(payload.phase)))options.onStatus?.(payload.phase as SupportAssistantPhase);
  else if(event==='delta'){if(typeof payload.text!=='string'||(textLength+=payload.text.length)>2000)throw new Error('Support reply exceeded limit');options.onChunk?.(payload.text)}
  else if(event==='complete')completed=assistantResult(payload);
  else if(event==='error')throw new Error(typeof payload.error==='string'&&payload.error.length<300?payload.error:'تعذر إكمال الرد. / Reply interrupted.');
 };
 try{for(;;){if(options.signal?.aborted)throw new DOMException('Request aborted','AbortError');const {done,value}=await reader.read();if(value){bytes+=value.length;if(bytes>131072)throw new Error('Support stream exceeded limit');buffer+=decoder.decode(value,{stream:true})}if(done)buffer+=decoder.decode();buffer=buffer.replace(/\r\n/g,'\n');let boundary:number;while((boundary=buffer.indexOf('\n\n'))!==-1){frame(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2)}if(completed)return completed;if(done){if(buffer.trim())frame(buffer);break}}if(options.signal?.aborted)throw new DOMException('Request aborted','AbortError');if(!completed)throw new Error('انقطع الرد قبل اكتماله. / Reply ended before completion.');return completed;
 }finally{options.signal?.removeEventListener('abort',aborted);await reader.cancel().catch(()=>{});reader.releaseLock()}
}
