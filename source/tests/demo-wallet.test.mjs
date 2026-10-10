import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp} from 'firebase/firestore';
import {createSparkApi} from '../firebase-spark/adapter-test.mjs';
const env=await initializeTestEnvironment({projectId:'demo-orin-159',firestore:{rules:readFileSync(process.env.ORIN_RULES_PATH || new URL('../firebase-spark/firestore.rules',import.meta.url),'utf8')}});
after(()=>env.cleanup());
function actor(uid){const u={uid,email:uid+'@example.test',emailVerified:true};const db=env.authenticatedContext(uid,{email:u.email,email_verified:true}).firestore();return {uid,db,api:createSparkApi(db,async()=>u)}}
const a=actor('demo-wallet-alice'),b=actor('demo-wallet-bob');let demo,real;
const wallet=(id,who=a)=>doc(who.db,'orinDemoWallets',a.uid,'accounts',id);
async function request(who,path,body){const r=await who.api(path,body?{method:'POST',body:JSON.stringify(body)}:{});return {status:r.status,data:await r.json()}}
async function op(id,kind,amountCents,from='futures',requestId=crypto.randomUUID(),who=a){return request(who,'/api/demo-wallet',{accountId:id,kind,amountCents,from,requestId,currency:'USD'})}
test('setup isolated real and demo accounts',async()=>{
 for(const who of [a,b])await setDoc(doc(who.db,'users',who.uid),{uid:who.uid,email:who.uid+'@example.test',displayName:who.uid,role:'user',disabled:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
 await request(a,'/api/trading-accounts');
 demo=crypto.randomUUID();real=crypto.randomUUID();
 for(const [id,type] of [[demo,'demo'],[real,'real']])assert.equal((await request(a,'/api/trading-accounts',{id,type})).status,200);
 await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'orinAccounts',a.uid),{balanceCents:12345,reservedCents:0,realizedCents:0,tier:'standard'});await updateDoc(doc(c.firestore(),'sparkTradingAccounts',a.uid,'accounts',real),{balanceCents:67890})});
});
test('reset persists separately and leaves every real/legacy balance untouched',async()=>{
 const r=await op(demo,'reset',100000);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.wallet.futuresCents,100000);assert.equal(r.data.wallet.perpetualCents,0);assert.equal(r.data.operations.length,1);
 assert.equal((await getDoc(doc(a.db,'orinAccounts',a.uid))).data().balanceCents,12345);
 assert.equal((await getDoc(doc(a.db,'sparkTradingAccounts',a.uid,'accounts',real))).data().balanceCents,67890);
 const dir=(await request(actor(a.uid),'/api/trading-accounts')).data;assert.equal(dir.accounts.find(x=>x.id===demo).balanceCents,100000);assert.equal(dir.accounts.find(x=>x.id===real).balanceCents,67890);
});
test('transfer is atomic, exactly once, conserves total and survives a fresh session',async()=>{
 const id=crypto.randomUUID();const [x,y]=await Promise.all([op(demo,'transfer',25000,'futures',id),op(demo,'transfer',25000,'futures',id,actor(a.uid))]);
 assert.equal(x.status,200,JSON.stringify(x));assert.equal(y.status,200,JSON.stringify(y));const fresh=(await request(actor(a.uid),'/api/demo-wallet?accountId='+demo)).data;assert.equal(fresh.wallet.futuresCents,75000);assert.equal(fresh.wallet.perpetualCents,25000);assert.equal(fresh.operations.filter(o=>o.id===id).length,1);
 assert.equal((await op(demo,'transfer',26000,'futures',id)).status,409);
 assert.equal((await op(demo,'transfer',25000,'perpetual')).status,200);
});
test('concurrent overspend admits only one transfer and no negative balance',async()=>{
 const r=await Promise.all([op(demo,'transfer',70000),op(demo,'transfer',70000)]);assert.deepEqual(r.map(v=>v.status).sort(),[200,400]);const d=(await getDoc(wallet(demo))).data();assert.equal(d.futuresCents+d.perpetualCents,100000);assert.equal(d.futuresCents,30000);
});
test('real account, another owner, unsupported currency and malformed money rejected',async()=>{
 assert.equal((await op(real,'reset',100000)).status,403);assert.equal((await op(demo,'reset',100000,'futures',crypto.randomUUID(),b)).status,403);
 for(const cents of [-1,0.5,100000001,'100',null])assert.notEqual((await op(demo,'reset',cents)).status,200);
 assert.notEqual((await request(a,'/api/demo-wallet',{accountId:demo,kind:'reset',amountCents:100,currency:'EUR',requestId:crypto.randomUUID()})).status,200);
 await assertFails(getDoc(wallet(demo,b)));
 await assertFails(setDoc(wallet(real),{ownerId:a.uid,accountId:real,currency:'USD',futuresCents:100000,perpetualCents:0,version:1,lastOperationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));
});
test('security rules reject unaudited writes, invalid conservation, replay, immutable log edits and cross-account ledger writes',async()=>{
 const d=(await getDoc(wallet(demo))).data();await assertFails(updateDoc(wallet(demo),{futuresCents:999999}));await assertFails(deleteDoc(wallet(demo)));
 const id=crypto.randomUUID(),opRef=doc(wallet(demo),'operations',id),batch=writeBatch(a.db);
 batch.set(wallet(demo),{...d,version:d.version+1,perpetualCents:d.perpetualCents+500,lastOperationId:id,updatedAt:serverTimestamp()});
 batch.set(opRef,{ownerId:a.uid,accountId:demo,currency:'USD',kind:'transfer',from:'futures',to:'perpetual',amountCents:500,beforeFuturesCents:d.futuresCents,beforePerpetualCents:d.perpetualCents,afterFuturesCents:d.futuresCents,afterPerpetualCents:d.perpetualCents+500,version:d.version+1,createdAt:serverTimestamp()});await assertFails(batch.commit());
 const previous=(await request(a,'/api/demo-wallet?accountId='+demo)).data.operations[0];await assertFails(updateDoc(doc(wallet(demo),'operations',previous.id),{amountCents:1}));await assertFails(deleteDoc(doc(wallet(demo),'operations',previous.id)));
 for(const collection of ['orinProgramLedger','orinJournals','orinDeposits'])await assertFails(setDoc(doc(a.db,collection,'demo-write-test'),{uid:a.uid,amountCents:100000}));
});
test('primary reset cannot modify reserved legacy collateral and cannot overwrite legacy funds',async()=>{
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'orinAccounts',a.uid),{reservedCents:100}));assert.equal((await op('primary','reset',100000)).status,409);
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'orinAccounts',a.uid),{reservedCents:0}));assert.equal((await op('primary','reset',200000)).status,200);
 assert.equal((await getDoc(doc(a.db,'orinAccounts',a.uid))).data().balanceCents,12345);
});
test('non-primary demo collateral is protected in both API and direct database requests',async()=>{
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'sparkTradingAccounts',a.uid,'accounts',demo),{reservedCents:5000}));assert.equal((await op(demo,'reset',100000)).status,409);assert.equal((await op(demo,'transfer',1)).status,409);
 const d=(await getDoc(wallet(demo))).data(),id=crypto.randomUUID(),batch=writeBatch(a.db);batch.set(wallet(demo),{...d,futuresCents:100,perpetualCents:0,version:d.version+1,lastOperationId:id,updatedAt:serverTimestamp()});batch.set(doc(wallet(demo),'operations',id),{ownerId:a.uid,accountId:demo,currency:'USD',kind:'reset',from:'reset',to:'futures',amountCents:100,beforeFuturesCents:d.futuresCents,beforePerpetualCents:d.perpetualCents,afterFuturesCents:100,afterPerpetualCents:0,version:d.version+1,createdAt:serverTimestamp()});await assertFails(batch.commit());
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'sparkTradingAccounts',a.uid,'accounts',demo),{reservedCents:0}));
});
