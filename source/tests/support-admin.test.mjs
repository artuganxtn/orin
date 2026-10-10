import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {readSupportAdmin,supportAdminAction,validateSupportConfiguration,SUPPORT_AI_DEFAULTS,db} from '../firebase-functions/lib/support-admin-test.mjs';
const make=(id)=>({id:'sai-'+id,email:id+'@support.test',name:id,verified:true,authTime:Math.floor(Date.now()/1000)});
const admin=make('admin'),support=make('support'),content=make('content'),customer=make('customer'),auditor=make('auditor');
const action=(u,a,target,data,revision=0,requestId=crypto.randomUUID())=>supportAdminAction(u,{action:a,target,data,revision,requestId,reason:'Isolated support security verification'});
before(async()=>{
 assert.equal(process.env.GCLOUD_PROJECT,'demo-orin-support-admin-160');assert(process.env.FIRESTORE_EMULATOR_HOST);
 process.env.ORIN_SUPPORT_AI_ENABLED='false';
 for(const u of [admin,support,content,customer,auditor])await db.doc('users/'+u.id).set({uid:u.id,email:u.email,displayName:u.name,disabled:false});
 for(const [u,role]of[[admin,'super_admin'],[support,'support'],[content,'content_manager'],[auditor,'auditor']])await db.doc('orinStaff/'+u.id).set({email:u.email,roles:[role],status:'active',revision:0});
});
test('support read/configure/knowledge roles enforce server permissions',async()=>{
 await assert.rejects(readSupportAdmin(customer),e=>e.status===403);
 assert.equal((await readSupportAdmin(support)).section,'overview');
 await assert.rejects(readSupportAdmin(content,{section:'conversations'}),e=>e.status===403);
 await assert.rejects(action(support,'support.ai.configure','current',SUPPORT_AI_DEFAULTS),e=>e.status===403);
 await assert.rejects(action(auditor,'support.knowledge.save','denied',{title:'Title',content:'Body'}),e=>e.status===403);
 await assert.rejects(action({...admin,authTime:1},'support.ai.configure','current',SUPPORT_AI_DEFAULTS),e=>e.status===401);
});
test('configuration rejects injected endpoints/secrets and out-of-range budgets, not activating a missing provider',async()=>{
 for(const data of [{...SUPPORT_AI_DEFAULTS,endpoint:'https://attacker.example/v1/chat/completions'},{...SUPPORT_AI_DEFAULTS,apiKey:'secret'},{...SUPPORT_AI_DEFAULTS,model:'invented-gemini'},{...SUPPORT_AI_DEFAULTS,maxTokensPerReply:2049},{...SUPPORT_AI_DEFAULTS,dailyTokenBudget:1000001},{...SUPPORT_AI_DEFAULTS,systemInstructions:'sk-'+('x'.repeat(32))}])assert.throws(()=>validateSupportConfiguration(data));
 await assert.rejects(action(admin,'support.ai.configure','current',{...SUPPORT_AI_DEFAULTS,enabled:true}),e=>e.status===409);
 assert.equal((await db.doc('orinSupportConfiguration/current').get()).exists,false);
 const result=await action(admin,'support.ai.configure','current',{...SUPPORT_AI_DEFAULTS,systemInstructions:'Use brief application instructions.'});assert.equal(result.revision,1);
 const status=await readSupportAdmin(admin);assert.equal(status.runtime.status,'disabled');assert(!JSON.stringify(status).includes('API_KEY'));assert(!('endpoint'in status.config));assert(!('token'in status.runtime));
 const audit=(await db.collection('orinControlAudit').where('action','==','support.ai.configure').get()).docs[0].data();assert(!JSON.stringify(audit).includes('Use brief application instructions.'));assert(audit.next.guidanceHash);
});
test('knowledge edits reset approval; publishing needs reviewed current revision',async()=>{
 const created=await action(content,'support.knowledge.save','account-help',{title:'Account help',content:'ORIN PIN protects this device.'});assert.equal(created.revision,1);
 await assert.rejects(action(content,'support.knowledge.publish','account-help',{previewRevision:1,reviewed:false},1));
 await action(content,'support.knowledge.publish','account-help',{previewRevision:1,reviewed:true},1);
 assert.equal((await db.doc('orinSupportKnowledge/account-help').get()).data().reviewed,true);
 await assert.rejects(action(content,'support.knowledge.save','account-help',{title:'Changed',content:'New text'},1),e=>e.status===409);
 await action(content,'support.knowledge.save','account-help',{title:'Changed',content:'New reviewed source required.'},2);
 const doc=(await db.doc('orinSupportKnowledge/account-help').get()).data();assert.equal(doc.status,'draft');assert.equal(doc.reviewed,false);
 await assert.rejects(action(content,'support.knowledge.save','invalid/id',{title:'Title',content:'Text'}));
 await assert.rejects(action(content,'support.knowledge.save','invalid-fields',{title:'Title',content:'Text',reviewed:true}));
});
test('idempotent retries commit one record revision and audit, payload reuse conflicts',async()=>{
 const requestId=crypto.randomUUID(),data={title:'Idempotent support record',content:'Reviewed documentation remains read only.'};
 const out=await Promise.all([action(content,'support.knowledge.save','same-operation',data,0,requestId),action(content,'support.knowledge.save','same-operation',data,0,requestId)]);assert.equal(out[0].revision,1);assert.equal(out[1].revision,1);
 assert.equal((await db.collection('orinControlAudit').where('requestId','==',requestId).get()).size,1);
 await assert.rejects(action(content,'support.knowledge.save','same-operation',{...data,content:'Changed'},1,requestId),e=>e.status===409);
});
test('revoked custom session cannot commit administrative change',async()=>{
 const sessionId='sai-revoked-session';await db.doc('orinSecuritySessions/'+sessionId).set({uid:admin.id,status:'revoked',expiresAtMs:Date.now()+60000,epoch:0});
 await assert.rejects(action({...admin,securitySessionId:sessionId},'support.knowledge.save','revocation-denied',{title:'Denied',content:'Must never persist.'}),e=>e.status===401);
 assert.equal((await db.doc('orinSupportKnowledge/revocation-denied').get()).exists,false);
});
test('conversation reads redact credentials and audit views; resume requires resolved matching escalation',async()=>{
 const conversation='sai-customer';await db.doc('orinSupportConversations/'+conversation).set({ownerId:conversation,handoffRequested:true,updatedAt:new Date(),lastMessageId:'m1'});
 await db.doc('orinSupportConversations/'+conversation+'/messages/m1').set({kind:'customer',senderId:conversation,text:'My API key is sk-'+('x'.repeat(32)),createdAt:new Date()});
 const result=await readSupportAdmin(support,{section:'conversations',thread:conversation});assert(!result.rows[0].text.includes('x'.repeat(32)));
 assert.equal((await db.collection('orinControlAudit').where('action','==','support.ai.conversation.read').get()).size,1);
 await assert.rejects(action(support,'support.ai.resume',conversation,{}),e=>e.status===409);
 await db.doc('orinSupportEscalations/'+conversation).set({ticketId:'sai-ticket',createdAt:Date.now()});await db.doc('orinControlTickets/sai-ticket').set({uid:conversation,conversationId:conversation,source:'orin-ai',status:'open',assigneeId:support.id});
 await assert.rejects(action(support,'support.ai.resume',conversation,{}),e=>e.status===409);
 await db.doc('orinControlTickets/sai-ticket').update({status:'resolved'});await action(support,'support.ai.resume',conversation,{});
 assert.equal((await db.doc('orinSupportConversations/'+conversation).get()).data().handoffRequested,false);
});
test('knowledge and escalated-ticket cursors are scoped and cover more than 50 rows',async()=>{
 const batch=db.batch();for(let i=0;i<53;i++)batch.set(db.doc('orinControlTickets/sai-page-'+String(i).padStart(3,'0')),{uid:customer.id,conversationId:customer.id,source:'orin-ai',status:'open'});await batch.commit();
 const a=await readSupportAdmin(support,{section:'tickets'}),b=await readSupportAdmin(support,{section:'tickets',cursor:a.nextCursor});assert.equal(a.rows.length,50);assert(b.rows.length>=3);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.id)).size,a.rows.length+b.rows.length);
 await assert.rejects(readSupportAdmin(content,{section:'knowledge',cursor:a.nextCursor}),/cursor/);
});
