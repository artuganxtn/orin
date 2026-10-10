import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDocFromServer,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-orin-security-rules',firestore:{rules:readFileSync(new URL('../firebase-security-160.rules',import.meta.url),'utf8')}});
after(()=>env.cleanup());
const uid='security-alice',sid='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',sid2='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const claims={email:'alice@example.test',email_verified:true,sid:sid,security_epoch:0};
const actor=(who=uid,extra=claims)=>env.authenticatedContext(who,extra).firestore();
const adminWrite=async(path,data)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data));
const session=(id,patch={})=>adminWrite('orinSecuritySessions/'+id,{uid,status:'active',expiresAtMs:Date.now()+3600000,epoch:0,...patch});
test('prepare server-owned profile and independent active sessions',async()=>{
 await adminWrite('users/'+uid,{uid,email:'alice@example.test',displayName:'Alice',role:'user',disabled:false});
 await adminWrite('orinAccounts/'+uid,{balanceCents:500000,reservedCents:0});
 await adminWrite('orinAccountSecurity/'+uid,{epoch:0,totpEnabled:true});
 await session(sid);await session(sid2);
 assert.equal((await getDocFromServer(doc(actor(),'orinAccounts',uid))).data().balanceCents,500000);
});
test('password-only Firebase token cannot read profile or money, even project owner claim',async()=>{
 for(const extra of [{email:'alice@example.test',email_verified:true},{email:'khtaub7341@gmail.com',email_verified:true}]){
  const db=actor(uid,extra);
  await assertFails(getDocFromServer(doc(db,'users',uid)));
  await assertFails(getDocFromServer(doc(db,'orinAccounts',uid)));
 }
});
test('missing, malformed, expired and foreign session grants are rejected',async()=>{
 for(const bad of ['missing-valid-identifier-12345','../../orinAccounts',''])await assertFails(getDocFromServer(doc(actor(uid,{...claims,sid:bad}),'orinAccounts',uid)));
 await session('expired-session-identifier',{expiresAtMs:Date.now()-60000});
 await session('foreign-session-identifier',{uid:'security-bob'});
 for(const bad of ['expired-session-identifier','foreign-session-identifier'])await assertFails(getDocFromServer(doc(actor(uid,{...claims,sid:bad}),'orinAccounts',uid)));
});
test('revoking one session denies its same Firebase token; other session keeps access',async()=>{
 const old=actor();await assertSucceeds(getDocFromServer(doc(old,'orinAccounts',uid)));
 await session(sid,{status:'revoked'});
 await assertFails(getDocFromServer(doc(old,'orinAccounts',uid)));
 await assertSucceeds(getDocFromServer(doc(actor(uid,{...claims,sid:sid2}),'orinAccounts',uid)));
 await session(sid);
});
test('epoch change invalidates every old session and old token, new epoch succeeds',async()=>{
 await adminWrite('orinAccountSecurity/'+uid,{epoch:1,totpEnabled:true});
 for(const id of [sid,sid2])await assertFails(getDocFromServer(doc(actor(uid,{...claims,sid:id}),'orinAccounts',uid)));
 await session(sid,{epoch:1});
 await assertFails(getDocFromServer(doc(actor(),'orinAccounts',uid)));
 await assertSucceeds(getDocFromServer(doc(actor(uid,{...claims,security_epoch:1}),'orinAccounts',uid)));
 await adminWrite('orinAccountSecurity/'+uid,{epoch:0,totpEnabled:true});await session(sid);
});
test('clients cannot forge, read secrets, reactivate or erase security state',async()=>{
 const db=actor();
 for(const path of ['orinSecuritySessions/'+sid,'orinAccountSecurity/'+uid,'orinSecurityChallenges/challenge','orinSecurityAudit/event','system/account-security']){
  await assertFails(getDocFromServer(doc(db,path)));
  await assertFails(setDoc(doc(db,path),{uid,status:'active',epoch:0}));
  await assertFails(deleteDoc(doc(db,path)));
 }
});
test('active session does not weaken cross-owner or real ledger write protection',async()=>{
 const db=actor();
 await assertFails(getDocFromServer(doc(db,'orinAccounts','security-bob')));
 await assertFails(updateDoc(doc(db,'orinAccounts',uid),{balanceCents:999999}));
 await assertFails(setDoc(doc(db,'orinJournals','forged-entry'),{user_id:uid,amount:1000000}));
});
test('disabled profile cannot regain financial access with active session',async()=>{
 await adminWrite('users/'+uid,{uid,email:'alice@example.test',displayName:'Alice',role:'user',disabled:true});
 await assertFails(getDocFromServer(doc(actor(),'orinAccounts',uid)));
});
