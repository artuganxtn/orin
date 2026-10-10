import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTransactions,accountLedger,transactionDetails,sparklinePath,validChallenge,codeDigest,emailRegistration,configurePayments,statementSnapshot,safeDestination} from './release-154-bundle.mjs';
const account={id:'real-1',accountNumber:'00009514',type:'real',currency:'USD',balanceCents:0,reservedCents:0,realizedCents:0,createdAt:0};
const state={user:{id:'u',name:'Test'},accountDirectory:{activeId:'real-1',accounts:[account]},ledger:[]};
const row=(overrides={})=>({id:'a',accountId:'real-1',journal_id:'journal',account:'cash',amount_cents:10000,kind:'deposit',effective_at:1000,...overrides});
const deposit={id:'np-order',accountId:'real-1',amountCents:10000,coin:'btc',status:'finished',paymentId:'1234',address:'bc1qexample',payAmount:'0.001',extraId:null,credited:true,createdAt:1000};
test('account boundaries exclude other accounts and untagged legacy journals from real accounts',()=>{
 const s={...state,ledger:[row(),row({id:'other',accountId:'real-2'}),row({id:'legacy',accountId:undefined})]};
 assert.equal(accountLedger(s,account).length,1);assert.equal(buildTransactions(s,account,[{...deposit,accountId:'real-2'}]).length,1);
 assert.deepEqual(accountLedger(s,{...account,id:'primary',type:'demo'}).map(x=>x.id),['legacy']);assert.deepEqual(accountLedger(s,{...account,id:'primary',type:'real'}),[]);
});
test('deposit plus balanced accounting legs produces one transaction, not a double count or zero',()=>{
 const s={...state,ledger:[row({journal_id:'deposit-nowpayments-1234'}),row({id:'b',journal_id:'deposit-nowpayments-1234',account:'payment-clearing',amount_cents:-10000})]};
 const list=buildTransactions(s,account,[deposit]);assert.equal(list.length,1);assert.equal(list[0].amountCents,10000);assert.equal(list[0].entries.length,2);
});
test('withdrawals show the customer cash direction and duplicate entries do not inflate money',()=>{
 const entry=row({amount_cents:-7500,kind:'withdrawal'}),s={...state,ledger:[entry,entry,row({id:'b',account:'payment-clearing',amount_cents:7500,kind:'withdrawal'})]};
 assert.equal(buildTransactions(s,account,[])[0].amountCents,-7500);
 const unknown=buildTransactions({...state,ledger:[row({account:'bonus-profit'})]},account,[])[0];assert.equal(unknown.amountCents,null);
});
test('missing payment service is explicitly incomplete, never a complete empty payment history',async()=>{
 configurePayments({token:async()=>null});const snapshot=await statementSnapshot(state);assert.equal(snapshot.paymentCoverage,'unavailable');assert.deepEqual(snapshot.transactions,[]);
 const details=transactionDetails(buildTransactions(state,account,[deposit])[0],false);assert.ok(details.some(([k,v])=>k==='Fees'&&v==='Not provided by service'));
});
test('activity navigation stays in app and rejects external or malformed routes',()=>{assert.equal(safeDestination('/activity'),'/activity');assert.equal(safeDestination('https://evil.test/activity'),'/notifications')});
test('sparkline never invents data, supports flat markets and uses real timestamp spacing',()=>{
 assert.equal(sparklinePath([]),null);assert.equal(sparklinePath([{at:1,price:10}]),null);
 assert.match(sparklinePath([{at:0,price:10},{at:1,price:10}]),/^M 4\.00 28\.00 C .+ 156\.00 28\.00$/);
 const path=sparklinePath([{at:0,price:10},{at:2,price:20},{at:10,price:15}]);assert.match(path,/34\.40 8\.00 C/);assert.match(path,/156\.00 28\.00$/);
});
const secret='server-only-secret-32-characters-minimum',challenge='a'.repeat(48),email='owner@example.test',code='000123';
test('code is bound to its email and challenge, expires, locks and cannot be replayed',()=>{
 const valid={email,digest:codeDigest(secret,challenge,email,code),delivery:'sent',expiresAtMs:600001,attempts:0,used:false};
 assert.equal(validChallenge(valid,challenge,email,code,secret,1),'ok');
 assert.equal(validChallenge(valid,challenge,'other@example.test',code,secret,1),'invalid');
 assert.equal(validChallenge(valid,'b'.repeat(48),email,code,secret,1),'invalid');
 assert.equal(validChallenge(valid,challenge,email,'000124',secret,1),'invalid');
 assert.equal(validChallenge(valid,challenge,email,code,secret,600001),'expired');
 assert.equal(validChallenge({...valid,attempts:5},challenge,email,code,secret,1),'locked');
 assert.equal(validChallenge({...valid,used:true},challenge,email,code,secret,1),'used');
});
// Transactional fake commits only after a successful callback, matching Firestore rollback semantics.
function database(){const data=new Map();let queue=Promise.resolve();const reference=path=>({path,async update(value){data.set(path,{...data.get(path),...value})}});return {data,collection:name=>({doc:id=>reference(name+'/'+id)}),runTransaction(callback){const job=queue.then(async()=>{const staging=new Map([...data].map(([k,v])=>[k,structuredClone(v)]));const get=async ref=>({exists:staging.has(ref.path),data:()=>staging.get(ref.path)});const result=await callback({get,getAll:async(...refs)=>Promise.all(refs.map(get)),set:(ref,value)=>staging.set(ref.path,value),create:(ref,value)=>{if(staging.has(ref.path))throw Error('Exists');staging.set(ref.path,value)},update:(ref,value)=>staging.set(ref.path,{...staging.get(ref.path),...value})});data.clear();staging.forEach((v,k)=>data.set(k,v));return result});queue=job.catch(()=>{});return job}}}
function service(){const db=database(),messages=[],users=[];let time=10000000;const api=emailRegistration(db,{async createUser(input){users.push(input);return{uid:'new-user'}},async createCustomToken(uid){return 'test-token-'+uid}},secret,async input=>{messages.push(input)},()=>time);return{db,messages,users,api,advance:n=>time+=n}}
test('mail is sent once, normalized and limited; concurrent verification creates only one verified account',async()=>{
 const x=service(),sent=await x.api.send({email:' Owner@Example.test '},'client');assert.equal(x.messages.length,1);assert.equal(x.messages[0].to,email);
 await assert.rejects(x.api.send({email},'client'),e=>e.code==='too-many-requests');
 const input={email,name:'ORIN Owner',password:'correct-horse-1234',challengeId:sent.challengeId,code:x.messages[0].code};
 const outcomes=await Promise.allSettled([x.api.register(input),x.api.register(input)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(x.users.length,1);assert.equal(x.users[0].emailVerified,true);
 assert.ok(!JSON.stringify([...x.db.data]).includes('correct-horse-1234'));
});
test('wrong-code attempts persist despite request failure and lock on the fifth attempt',async()=>{
 const x=service(),sent=await x.api.send({email},'client'),actual=x.messages[0].code;
 const input={email,name:'Test',password:'password1234',challengeId:sent.challengeId,code:actual==='111111'?'222222':'111111'};
 for(let i=0;i<5;i++)await assert.rejects(x.api.register(input));
 const saved=x.db.data.get('orinEmailChallenges/'+sent.challengeId);assert.equal(saved.attempts,5);
 await assert.rejects(x.api.register({...input,code:actual}),e=>e.code==='code-locked');assert.equal(x.users.length,0);
});
test('failed mail never returns success or verifies a user',async()=>{
 const db=database(),api=emailRegistration(db,{},secret,async()=>{throw Error('Provider unavailable')});
 await assert.rejects(api.send({email},'client'),e=>e.code==='delivery-unavailable');
 const challenge=[...db.data].find(([k])=>k.startsWith('orinEmailChallenges/'))[1];assert.equal(challenge.delivery,'failed');assert.equal(challenge.digest,'');
});
