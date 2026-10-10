/** Explicit live-provider acceptance in isolated Firebase emulators.
 * Reads credential through server environment/a private key file, never logs it.
 * No production Firebase customer data or wallets are accessed or mutated.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||!String(process.env.GCLOUD_PROJECT).startsWith('demo-'))throw new Error('Isolated emulator project required');
if(process.env.ORIN_SUPPORT_AI_KEY_FILE)process.env.ORIN_SUPPORT_AI_API_KEY=readFileSync(process.env.ORIN_SUPPORT_AI_KEY_FILE,'utf8').trim();
if(!process.env.ORIN_SUPPORT_AI_API_KEY)throw new Error('Server provider credential required');
Object.assign(process.env,{ORIN_ACCOUNT_SECURITY_ENABLED:'true',ORIN_SECURITY_MASTER_KEY:randomBytes(32).toString('base64'),ORIN_SUPPORT_AI_ENABLED:'true',ORIN_SUPPORT_AI_PROVIDER:'gemini',ORIN_SUPPORT_AI_MODEL:'gemini-3.5-flash-lite',FUNCTIONS_EMULATOR:'true'});
const {handle,login,db,auth,ref,FieldValue}=await import('../firebase-functions/lib/adam-live-test.mjs');
const results=[],responses=[];
const server=createServer(async(incoming,outgoing)=>{
 const chunks=[];for await(const c of incoming)chunks.push(c);
 const url=new URL(incoming.url,'http://localhost');
 const req={path:url.pathname,method:incoming.method,query:Object.fromEntries(url.searchParams),body:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{},get:name=>incoming.headers[name.toLowerCase()],is:type=>String(incoming.headers['content-type']??'').includes(type)};
 outgoing.set=(k,v)=>outgoing.setHeader(k,v);outgoing.status=code=>{outgoing.statusCode=code;return outgoing};outgoing.json=data=>{outgoing.setHeader('Content-Type','application/json');outgoing.end(JSON.stringify(data))};outgoing.send=data=>outgoing.end(data);
 try{await handle(req,outgoing)}catch{outgoing.statusCode=500;outgoing.end('Local harness failure')}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
async function record(name,fn){try{await fn();results.push({name,status:'PASS'});console.log('PASS',name)}catch(error){results.push({name,status:'FAIL',reason:String(error?.message??'failure').replaceAll(process.env.ORIN_SUPPORT_AI_API_KEY,'[REDACTED]').slice(0,300)});console.log('FAIL',name)}}
async function rest(action,body){const r=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:'+action+'?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('Emulator auth rejected');return r.json()}
async function actor(label){const uid='adam-live-'+label+'-'+randomBytes(4).toString('hex'),email=uid+'@example.test',password='Emulator-Only-943!';await auth.createUser({uid,email,password,emailVerified:true});await ref('users',uid).set({uid,email,displayName:'Local acceptance tester',disabled:false});const primary=await rest('signInWithPassword',{email,password,returnSecureToken:true}),bundle=await login(primary.idToken,{device:{platform:'Web',appVersion:'1.6.1',label:'Local HTTP acceptance'}},{ip:'127.0.0.1',ipSource:'direct'}),session=await rest('signInWithCustomToken',{token:bundle.customToken,returnSecureToken:true});await ref('sparkTradingAccounts',uid).collection('accounts').doc('demo').set({ownerId:uid,type:'demo',currency:'USD',accountNumber:'000000009514',balanceCents:100000,reservedCents:0});return {uid,primary:primary.idToken,headers:{Authorization:'Bearer '+session.idToken,'X-Orin-Session':bundle.accessToken,'Content-Type':'application/json'}}}
async function message(user,text){const id=randomUUID(),thread=ref('orinSupportConversations',user.uid),at=FieldValue.serverTimestamp(),old=await thread.get();if(!old.exists)await thread.set({ownerId:user.uid,createdAt:at,updatedAt:at,lastCustomerAt:at,lastMessageId:id,handoffRequested:false});else await thread.update({updatedAt:at,lastCustomerAt:at,lastMessageId:id});await thread.collection('messages').doc(id).set({id,text,kind:'customer',senderId:user.uid,createdAt:at});return id}
async function ask(user,text){const id=await message(user,text),response=await fetch(base+'/api/support/assistant',{method:'POST',headers:{...user.headers,Accept:'text/event-stream'},body:JSON.stringify({messageId:id})});assert.equal(response.status,200);const body=await response.text(),events=body.split('\n\n').filter(Boolean).map(block=>JSON.parse(block.split('\n').find(line=>line.startsWith('data: ')).slice(6)));const completed=events.find(v=>v.status==='answered');assert.ok(completed,'No persisted assistant completion: '+JSON.stringify(events).slice(0,200));const saved=(await ref('orinSupportConversations',user.uid).collection('messages').doc(completed.replyId).get()).data();assert.equal(saved.kind,'assistant');assert.ok(saved.text.length>5);responses.push({question:text,answer:saved.text,citations:saved.assistant?.citationIds,events:events.map(v=>v.type??v.status)});return {id,completed,saved}}
try{
 await ref('system','account-security').set({enabled:true,rulesVersion:160});
 await ref('orinSupportConfiguration','current').set({enabled:true,provider:'gemini',model:'gemini-3.5-flash-lite',maxTokensPerReply:700,dailyTokenBudget:1000000,systemInstructions:''});
 const a=await actor('a'),b=await actor('b');
 await record('Unauthenticated HTTP request rejected',async()=>{assert.equal((await fetch(base+'/api/support/assistant')).status,401)});
 await record('Password-only token cannot bypass ORIN session',async()=>{assert.equal((await fetch(base+'/api/support/assistant',{headers:{Authorization:'Bearer '+a.primary}})).status,401)});
 await record('Live Gemini capability through authenticated ORIN HTTP backend',async()=>{const r=await fetch(base+'/api/support/assistant',{headers:a.headers});assert.equal(r.status,200);const capability=await r.json();assert.equal(capability.available,true,JSON.stringify(capability))});
 await record('Arabic ORIN answer through backend, real provider, durable history',async()=>{await ask(a,'ما الفرق بين شارة الحساب الحقيقي والتجريبي في ORIN؟')});
 await new Promise(r=>setTimeout(r,3200));
 await record('Conversation follow-up and English language switch',async()=>{const r=await ask(a,'Please answer in English: can I withdraw the demo balance we just discussed?');assert.match(r.saved.text,/[A-Za-z]{5}/)});
 await new Promise(r=>setTimeout(r,3200));
 await record('Turkish ORIN technical support',async()=>{const r=await ask(a,'Türkçe cevap ver: ORIN küçük grafik geçmişi görünmüyorsa ne yapmalıyım?');assert.ok(r.saved.text.length>20)});
 await new Promise(r=>setTimeout(r,3200));
 await record('Withdrawal question uses server-owned data without inventing a transaction',async()=>{await ask(a,'أين عملية السحب الخاصة بي؟ افحص حالتها ولا تخمن.');assert.equal((await ref('sparkTradingAccounts',a.uid).collection('accounts').doc('demo').get()).data().balanceCents,100000)});
 await record('Another user cannot request this conversation message',async()=>{const id=await message(a,'سؤال خاص بالحساب');const r=await fetch(base+'/api/support/assistant',{method:'POST',headers:b.headers,body:JSON.stringify({messageId:id})});assert.equal(r.status,404)});
 await record('Human escalation persists an actual support ticket',async()=>{const r=await fetch(base+'/api/support/escalate',{method:'POST',headers:a.headers,body:'{}'});assert.equal(r.status,200);const d=await r.json();assert.ok(d.ticket?.id);const ticket=await ref('orinControlTickets',d.ticket.id).get();assert.ok(ticket.exists);assert.equal(ticket.data().uid,a.uid)});
}finally{
 const report={mode:'Local HTTP backend + Firebase Auth/Firestore emulators + real Gemini provider',productionDeployment:false,physicalAndroid:false,model:process.env.ORIN_SUPPORT_AI_MODEL,results,responses};const reportPath=process.env.ORIN_ADAM_TEST_REPORT??'../verification/adam-live-http-161.json';writeFileSync(reportPath,JSON.stringify(report,null,2));server.close();await db.terminate();delete process.env.ORIN_SUPPORT_AI_API_KEY;
}
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
