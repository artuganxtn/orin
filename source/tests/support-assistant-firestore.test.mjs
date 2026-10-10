import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {supportAssistantReply,supportAssistantCapability,supportEscalate,runSupportTool,reviewedSupportKnowledge,db,ref,FieldValue} from '../firebase-functions/lib/support-assistant-test.mjs';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Emulator required; never run against production');
Object.assign(process.env,{ORIN_SUPPORT_AI_ENABLED:'true',ORIN_SUPPORT_AI_ENDPOINT:'https://inference.example.test/v1/chat/completions',ORIN_SUPPORT_AI_ALLOWED_ORIGINS:'https://inference.example.test',ORIN_SUPPORT_AI_MODEL:'orin-model'});
let inferCount=0,inferError=false,beforeAnswer=async()=>{};const answer={text:'The orange badge identifies a demo account.',handoff:false,scope:'application',citationIds:['accounts']};
globalThis.fetch=async url=>{if(String(url).endsWith('/models'))return Response.json({data:[{id:'orin-model'}]});inferCount++;await beforeAnswer();if(inferError)throw new Error('Provider unavailable');return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})};
async function seed(name){await ref('orinSupportConfiguration','current').set({enabled:true,provider:'openai-compatible',model:'orin-model',maxTokensPerReply:700,dailyTokenBudget:1000000,systemInstructions:''});const u={id:'support-160-'+name,email:name+'@example.test',verified:true,name,authTime:Date.now()/1000};await ref('users',u.id).set({uid:u.id,email:u.email,disabled:false});await ref('sparkTradingAccounts',u.id).collection('accounts').doc('primary').set({ownerId:u.id,type:'demo',balanceCents:999999});const id=randomUUID(),thread=ref('orinSupportConversations',u.id),at=FieldValue.serverTimestamp();await thread.set({ownerId:u.id,createdAt:at,updatedAt:at,lastCustomerAt:at,lastMessageId:id,handoffRequested:false});await thread.collection('messages').doc(id).set({id,text:'What is the orange badge?',kind:'customer',senderId:u.id,createdAt:at});return {u,id,thread};}
test('unsecured access fails closed and cross-customer message access is rejected',async()=>{
 const a=await seed('security'),b=await seed('other');assert.equal((await supportAssistantCapability(a.u)).available,false);await assert.rejects(supportAssistantReply(a.u,{messageId:a.id}),e=>e.status===503);await assert.rejects(supportAssistantReply(b.u,{messageId:a.id},true),e=>e.status===404);assert.equal(inferCount,0);
});
test('actual Firestore reply persists once, is labelled assistant, has source metadata and does not change money',async()=>{
 const {u,id,thread}=await seed('persist');const result=await supportAssistantReply(u,{messageId:id},true);assert.equal(result.status,'answered');const replay=await supportAssistantReply(u,{messageId:id},true);assert.equal(replay.replyId,result.replyId);assert.equal(inferCount,1);const record=(await thread.collection('messages').doc(result.replyId).get()).data();assert.equal(record.kind,'assistant');assert.deepEqual(record.assistant.citationIds,['accounts']);assert.equal(record.assistant.inReplyTo,id);assert.equal((await ref('sparkTradingAccounts',u.id).collection('accounts').doc('primary').get()).data().balanceCents,999999);assert.equal((await thread.collection('messages').get()).size,2);
});
test('model outage leaves the customer message retryable without manufacturing an AI reply',async()=>{
 const {u,id,thread}=await seed('outage');inferError=true;try{assert.equal((await supportAssistantReply(u,{messageId:id},true)).status,'unavailable')}finally{inferError=false}assert.equal((await thread.get()).data().handoffRequested,false);const messages=await thread.collection('messages').get();assert.equal(messages.size,1);assert.equal(messages.docs[0].data().kind,'customer');const job=(await ref('orinSupportAssistantJobs',u.id).collection('messages').doc(id).get()).data();assert.equal(job.reason,'assistant_failed');assert(!JSON.stringify(job).includes('What is'));
});
test('human takeover during inference wins and no late AI message is inserted',async()=>{
 const {u,id,thread}=await seed('takeover');beforeAnswer=async()=>{await thread.update({handoffRequested:true})};try{assert.equal((await supportAssistantReply(u,{messageId:id},true)).status,'handoff')}finally{beforeAnswer=async()=>{}}assert.equal((await thread.collection('messages').get()).size,1);
});
test('disabled model is reported unavailable and cannot fabricate replies',async()=>{
 const {u,id,thread}=await seed('disabled');process.env.ORIN_SUPPORT_AI_ENABLED='false';try{assert.equal((await supportAssistantCapability(u,true)).available,false);assert.equal((await supportAssistantReply(u,{messageId:id},true)).status,'unavailable')}finally{process.env.ORIN_SUPPORT_AI_ENABLED='true'}assert.equal((await thread.collection('messages').get()).size,1);
});
test('concurrent replay makes at most one inference and saved reply',async()=>{
 const {u,id,thread}=await seed('concurrent'),initial=inferCount;
 const values=await Promise.all([supportAssistantReply(u,{messageId:id},true),supportAssistantReply(u,{messageId:id},true)]);
 assert(values.every(v=>v.status==='pending'||v.status==='answered'));assert(values.some(v=>v.status==='answered'));assert.equal(inferCount-initial,1);assert.equal((await thread.collection('messages').get()).size,2);
});
test('server rate limiting rejects a rapid new request but keeps the original customer message',async()=>{
 const {u,id,thread}=await seed('limit');await supportAssistantReply(u,{messageId:id},true);const initial=inferCount,next=randomUUID(),at=FieldValue.serverTimestamp();
 await thread.collection('messages').doc(next).set({id:next,text:'One more question',kind:'customer',senderId:u.id,createdAt:at});await thread.update({lastMessageId:next,lastCustomerAt:at});
 await assert.rejects(supportAssistantReply(u,{messageId:next},true),e=>e.status===429);assert.equal(inferCount,initial);assert.equal((await thread.collection('messages').doc(next).get()).exists,true);
});
test('tools are strictly user scoped, omit payment destinations/authentication secrets and never mutate financial records',async()=>{
 const {u}=await seed('tools'),other=await seed('tools-other');await ref('orinDeposits','own-deposit').set({uid:u.id,status:'waiting',amountCents:500,createdAt:Date.now(),address:'SECRET_DESTINATION',password:'DO_NOT_SEND'});await ref('orinDeposits','other-deposit').set({uid:other.u.id,status:'finished',amountCents:1000,createdAt:Date.now()});
 const own=await runSupportTool(u,'getDepositStatus','own-deposit'),cross=await runSupportTool(u,'getDepositStatus','other-deposit');assert.equal(own.data.record.amountCents,500);assert.equal(cross.data.record,null);assert(!JSON.stringify(own).includes('SECRET'));assert(!JSON.stringify(own).includes('DO_NOT_SEND'));assert.equal((await ref('orinDeposits','own-deposit').get()).data().status,'waiting');
 const unknown=await runSupportTool(u,'changeBalance');assert.equal(unknown.state,'unavailable');
});
test('reviewed published knowledge is retrievable, drafts and unreviewed content are excluded',async()=>{
 await ref('orinSupportKnowledge','approved').set({title:'Deposits guide',content:'Verified app information.',status:'published',reviewed:true,revision:2});await ref('orinSupportKnowledge','draft').set({title:'Draft',content:'DO_NOT_USE_DRAFT',status:'draft',reviewed:true});await ref('orinSupportKnowledge','unreviewed').set({title:'Pending',content:'DO_NOT_USE_UNREVIEWED',status:'published',reviewed:false});
 const result=await reviewedSupportKnowledge('Deposits');assert(result.documents.some(d=>d.id==='kb-approved'));assert(!JSON.stringify(result).includes('DO_NOT_USE'));assert(result.version.includes('kb-approved:2'));
});
test('escalation creates a real compatible ticket once, persists redacted context and preserves original chat',async()=>{
 const {u,id,thread}=await seed('ticket');await thread.collection('messages').doc(id).update({text:'My password is HiddenSecret and recovery a1b2c3-d4e5f6-a7b8c9-d0e1f2'});
 const first=await supportEscalate(u,{messageId:id},true),again=await supportEscalate(u,{messageId:id},true);assert.equal(first.ticket.id,again.ticket.id);const ticket=(await ref('orinControlTickets',first.ticket.id).get()).data();assert.equal(ticket.uid,u.id);assert.equal(ticket.source,'orin-ai');assert.equal(ticket.status,'open');assert(!ticket.description.includes('HiddenSecret'));assert(!ticket.description.includes('a1b2c3-d4e5f6'));assert.equal((await thread.get()).data().handoffRequested,true);assert.equal((await thread.collection('messages').doc(id).get()).exists,true);
});
test('daily budget blocks real inference, debits no money and permits explicit staff escalation',async()=>{
 const {u,id}=await seed('budget');await ref('orinSupportConfiguration','current').update({dailyTokenBudget:1000});const before=inferCount,r=await supportAssistantReply(u,{messageId:id},true);assert.equal(r.status,'unavailable');assert((await supportEscalate(u,{messageId:id},true)).ticket.id);assert.equal(inferCount,before);assert.equal((await ref('sparkTradingAccounts',u.id).collection('accounts').doc('primary').get()).data().balanceCents,999999);assert.equal((await ref('orinSupportAssistantJobs',u.id).collection('messages').doc(id).get()).data().reason,'daily_budget_exhausted');
});
test('expired crashed job settles its old reservation conservatively before a new lease',async()=>{
 const {u,id}=await seed('crash'),day=new Date().toISOString().slice(0,10),usage=ref('orinSupportUsage',day),prior=(await usage.get()).data()??{};
 await usage.set({reservedTokens:(prior.reservedTokens??0)+200,budgetDebitedTokens:prior.budgetDebitedTokens??0},{merge:true});await ref('orinSupportAssistantJobs',u.id).collection('messages').doc(id).set({state:'processing',lease:'crashed',leaseUntil:Date.now()-1000,reservedTokens:200,usageDay:day});
 assert.equal((await supportAssistantReply(u,{messageId:id},true)).status,'answered');const after=(await usage.get()).data();assert.equal(after.reservedTokens,prior.reservedTokens??0);assert.equal(after.budgetDebitedTokens,(prior.budgetDebitedTokens??0)+200+130);
});
test('an actually revoked ORIN session during inference prevents saved answer and final delta; tools deny subsequent reads',async()=>{
 const {u,id,thread}=await seed('session'),sid='test-session-revoke';u.securitySessionId=sid;await ref('orinAccountSecurity',u.id).set({epoch:3});await ref('orinSecuritySessions',sid).set({uid:u.id,epoch:3,status:'active',expiresAtMs:Date.now()+60000});
 const previous=process.env.ORIN_ACCOUNT_SECURITY_ENABLED;process.env.ORIN_ACCOUNT_SECURITY_ENABLED='true';const events=[];beforeAnswer=async()=>{await ref('orinSecuritySessions',sid).update({status:'revoked'})};
 try{const result=await supportAssistantReply(u,{messageId:id},true,{onChunk:event=>events.push(event)});assert.equal(result.status,'unavailable');assert.equal((await thread.collection('messages').get()).size,1);assert(!events.some(e=>e.type==='delta'));assert.equal((await runSupportTool(u,'getAccountStatus')).state,'unavailable');}finally{beforeAnswer=async()=>{};if(previous===undefined)delete process.env.ORIN_ACCOUNT_SECURITY_ENABLED;else process.env.ORIN_ACCOUNT_SECURITY_ENABLED=previous;}
});
test('same-message retry after model recovery succeeds once without human takeover or losing original message',async()=>{
 const {u,id,thread}=await seed('recovery');inferError=true;try{assert.equal((await supportAssistantReply(u,{messageId:id},true)).status,'unavailable')}finally{inferError=false}
 const job=ref('orinSupportAssistantJobs',u.id).collection('messages').doc(id);await job.update({retryAt:Date.now()-1});await ref('orinSupportAssistantLimits',u.id).update({lastAt:Date.now()-4000});
 const retry=await supportAssistantReply(u,{messageId:id},true);assert.equal(retry.status,'answered');assert.equal((await supportAssistantReply(u,{messageId:id},true)).replyId,retry.replyId);assert.equal((await thread.get()).data().handoffRequested,false);assert.equal((await thread.collection('messages').get()).size,2);
});
