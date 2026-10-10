import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,updateDoc,deleteDoc,collection,query,limit,writeBatch,serverTimestamp} from 'firebase/firestore';
import {createSparkApi} from './adapter-test.mjs';
const env=await initializeTestEnvironment({projectId:'demo-orin-auth',firestore:{rules:readFileSync(process.env.ORIN_RULES_PATH || new URL('./firestore.rules',import.meta.url),'utf8')}});
after(()=>env.cleanup());
function actor(uid){const u={uid,email:uid+'@example.test',emailVerified:true};const db=env.authenticatedContext(uid,{email:u.email,email_verified:true}).firestore();return {uid,db,api:createSparkApi(db,async()=>u)}}
const alice=actor('accounts-alice'),bob=actor('accounts-bob');
const acct=(a,id)=>doc(a.db,'sparkTradingAccounts',a.uid,'accounts',id);
const req=async(a,method='GET',input)=>{const r=await a.api('/api/trading-accounts',input?{method,body:JSON.stringify(input)}:{method});return {status:r.status,data:await r.json()}};
async function ok(a,method,input){const r=await req(a,method,input);assert.equal(r.status,200,JSON.stringify(r));return r.data;}
let primary,demo,real;
test('concurrent initialization creates one durable default number, independent of Firebase UID',async()=>{
 for(const a of [alice,bob])await setDoc(doc(a.db,'users',a.uid),{uid:a.uid,email:a.uid+'@example.test',displayName:a.uid,role:'user',disabled:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
 const [one,two,three]=await Promise.all([ok(alice),ok(actor(alice.uid)),ok(bob)]);
 assert.equal(one.accounts.length,1);assert.equal(two.accounts.length,1);assert.equal(one.accounts[0].accountNumber,two.accounts[0].accountNumber);assert.notEqual(one.accounts[0].accountNumber,three.accounts[0].accountNumber);
 primary=one.accounts[0];assert.equal(primary.type,'demo');assert.equal(one.activeId,'primary');assert.match(primary.accountNumber,/^[1-9][0-9]{11}$/);assert.notEqual(primary.accountNumber,alice.uid);
});
test('both types get independent zero balances and unique immutable numbers; retry is idempotent',async()=>{
 const id=crypto.randomUUID();const [one,two]=await Promise.all([ok(alice,'POST',{id,type:'demo'}),ok(actor(alice.uid),'POST',{id,type:'demo'})]);
 assert.equal(one.accounts.length,2);assert.equal(two.accounts.length,2);demo=one.accounts.find(a=>a.id===id);assert.equal(demo.accountNumber,two.accounts.find(a=>a.id===id).accountNumber);
 const next=await ok(alice,'POST',{id:crypto.randomUUID(),type:'real'});real=next.accounts.find(a=>a.type==='real');
 assert.equal(new Set(next.accounts.map(a=>a.accountNumber)).size,3);assert.equal(real.currency,'USD');assert.equal(real.balanceCents,0);assert.equal(real.reservedCents,0);assert.equal(real.realizedCents,0);
 assert.equal((await req(alice,'POST',{id,type:'real'})).status,409);
 for(const a of [demo,real])for(const patch of [{accountNumber:'999999999999'},{type:a.type==='real'?'demo':'real'},{balanceCents:99999},{ownerId:bob.uid}])await assertFails(updateDoc(acct(alice,a.id),patch));
 await assertFails(deleteDoc(acct(alice,real.id)));
});
test('switching persists in a fresh session; legacy money appears only on the original demo account',async()=>{
 await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'orinAccounts',alice.uid),{tier:'standard',balanceCents:123450,reservedCents:5000,realizedCents:3450}));
 const selected=await ok(alice,'PATCH',{id:real.id});assert.equal(selected.activeId,real.id);
 const fresh=await ok(actor(alice.uid));assert.equal(fresh.activeId,real.id);assert.equal(fresh.accounts.find(a=>a.id===real.id).balanceCents,0);assert.equal(fresh.accounts.find(a=>a.id===demo.id).balanceCents,0);
 assert.equal(fresh.accounts.find(a=>a.id==='primary').balanceCents,123450);assert.equal(fresh.accounts.find(a=>a.id==='primary').accountNumber,primary.accountNumber);
 const labResponse=await actor(alice.uid).api('/api/lab');assert.equal(labResponse.status,200);const lab=await labResponse.json();assert.equal(lab.accountDirectory.activeId,real.id);assert.equal(lab.financialOperations,false);
 assert.equal((await req(alice,'PATCH',{id:crypto.randomUUID()})).status,404);assert.equal((await ok(actor(alice.uid))).activeId,real.id);
});
test('cross-user records, numbers, lists and selections are inaccessible',async()=>{
 await assertFails(getDoc(doc(bob.db,'sparkTradingAccounts',alice.uid,'accounts',real.id)));
 await assertFails(getDocs(query(collection(bob.db,'sparkTradingAccounts',alice.uid,'accounts'),limit(100))));
 await assertFails(getDoc(doc(bob.db,'sparkAccountNumbers',real.accountNumber)));
 await assertFails(getDocs(query(collection(alice.db,'sparkAccountNumbers'),limit(100))));
 await assertFails(getDoc(doc(bob.db,'sparkAccountSelections',alice.uid)));
 await assertFails(setDoc(doc(bob.db,'sparkAccountSelections',bob.uid),{accountId:real.id,updatedAt:serverTimestamp()}));
 assert.equal((await req(bob,'PATCH',{id:real.id})).status,404);
 assert.equal((await ok(bob)).accounts.length,1);
});
test('rules reject duplicated numbers, orphan claims, fabricated balances and unsupported types directly',async()=>{
 async function direct(a,number,patch={}){const id=crypto.randomUUID(),batch=writeBatch(a.db);batch.set(acct(a,id),{ownerId:a.uid,accountNumber:number,type:'demo',currency:'USD',balanceCents:0,reservedCents:0,realizedCents:0,createdAt:serverTimestamp(),...patch});batch.set(doc(a.db,'sparkAccountNumbers',number),{ownerId:a.uid,accountId:id});return batch.commit();}
 await assertFails(direct(bob,real.accountNumber));await assertFails(direct(alice,real.accountNumber));
 await assertFails(setDoc(doc(alice.db,'sparkAccountNumbers','999000111222'),{ownerId:alice.uid,accountId:crypto.randomUUID()}));
 for(const patch of [{balanceCents:10000},{reservedCents:1},{realizedCents:1},{type:'standard'},{currency:'EUR'},{ownerId:bob.uid}])await assertFails(direct(alice,String(900000000000+Math.floor(Math.random()*10000000000)),patch));
 const r=await ok(alice);assert.equal(r.accounts.length,3);
});
test('invalid requests cannot change type, currency, user ownership or balances through the API',async()=>{
 for(const input of [{id:crypto.randomUUID(),type:'unknown'},{id:'primary',type:'real'},{id:'../other',type:'demo'},{id:crypto.randomUUID(),type:'demo',balanceCents:100},{id:crypto.randomUUID(),type:'demo',ownerId:bob.uid}])assert.equal((await req(alice,'POST',input)).status,400);
 const anon=createSparkApi(env.unauthenticatedContext().firestore(),async()=>null);assert.equal((await anon('/api/trading-accounts')).status,401);
});
test('disabled users cannot read, create or switch any accounts, even with a warm client',async()=>{
 await env.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore(),'users',bob.uid),{disabled:true}));
 await assertFails(getDoc(acct(bob,'primary')));await assertFails(setDoc(doc(bob.db,'sparkAccountSelections',bob.uid),{accountId:'primary',updatedAt:serverTimestamp()}));
 assert.equal((await req(actor(bob.uid),'POST',{id:crypto.randomUUID(),type:'demo'})).status,403);
});
