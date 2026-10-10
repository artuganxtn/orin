import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,serverTimestamp,query,collection,getDocs,limit,deleteDoc} from 'firebase/firestore';
import {createSparkApi} from './adapter-test.mjs';
const env=await initializeTestEnvironment({projectId:'demo-orin-auth',firestore:{rules:readFileSync(new URL('./firestore.rules',import.meta.url),'utf8')}});
after(()=>env.cleanup());
const token=(uid,email=uid+'@example.test',emailVerified=true)=>({uid,email,emailVerified});
const actor=u=>{const db=env.authenticatedContext(u.uid,{email:u.email,email_verified:u.emailVerified}).firestore();return {u,db,api:createSparkApi(db,async()=>u)}};
const admin=actor(token('spark-owner','khtaub7341@gmail.com')),alice=actor(token('spark-alice')),bob=actor(token('spark-bob'));
async function register(a){await setDoc(doc(a.db,'users',a.u.uid),{uid:a.u.uid,email:a.u.email,displayName:a.u.uid,role:'user',disabled:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()})}
async function call(a,path,body,method='POST'){const r=await a.api(path,body===undefined?{}:{method,body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
async function ok(a,path,body,method){const r=await call(a,path,body,method);assert.equal(r.status,200,JSON.stringify(r));return r.data}
async function prefs(a,patch){const s=await ok(a,'/api/settings');return ok(a,'/api/settings',{revision:s.revision,preferences:patch},'PATCH')}

test('Spark boots the original app data with real Firebase profile and no fabricated funding',async()=>{
 await Promise.all([register(admin),register(alice),register(bob)]);await updateDoc(doc(admin.db,'users',admin.u.uid),{role:'admin',updatedAt:serverTimestamp()});
 for(const a of [admin,alice,bob]){const d=await ok(a,'/api/lab');assert.equal(d.user.id,a.u.uid);assert.equal(d.balanceCents,0);assert.equal(d.initialCents,0);assert.equal(d.financialOperations,false)}
 assert.equal((await ok(admin,'/api/settings')).isAdmin,true);assert.equal((await ok(alice,'/api/settings')).isAdmin,false);
});
test('preferences and profile persist; revisions, fields and mandatory security notices are enforced',async()=>{
 let s=await ok(alice,'/api/settings');const old=s.revision;s=await ok(alice,'/api/settings',{revision:s.revision,preferences:{theme:'dark',notificationSounds:true,marketingNotifications:true},profile:{displayName:'Alice ORIN',country:'GB'}},'PATCH');assert.equal(s.preferences.theme,'dark');assert.equal(s.profile.country,'GB');
 assert.equal((await call(alice,'/api/settings',{revision:old,preferences:{theme:'light'}},'PATCH')).status,409);
 assert.equal((await call(alice,'/api/settings',{revision:s.revision,preferences:{notificationEvents:{security:false}}},'PATCH')).status,409);
 const fresh=actor(alice.u);assert.equal((await ok(fresh,'/api/settings')).preferences.theme,'dark');
 const r=doc(alice.db,'sparkProfiles',alice.u.uid);await assertFails(updateDoc(r,{balanceCents:9000000,revision:s.revision+1,updatedAt:serverTimestamp()}));await assertFails(updateDoc(r,{tier:'advanced',revision:s.revision+1,updatedAt:serverTimestamp()}));await assertFails(updateDoc(r,{'preferences.notificationEvents.security':false,revision:s.revision+1,updatedAt:serverTimestamp()}));await assertFails(updateDoc(r,{'profile.role':'admin',revision:s.revision+1,updatedAt:serverTimestamp()}));
 await assertFails(getDoc(doc(bob.db,'sparkProfiles',alice.u.uid)));await assertFails(getDocs(query(collection(alice.db,'sparkProfiles'),limit(100))));
});
test('admin configuration is protected by backend rules, including forged local UI role',async()=>{
 const c=await ok(admin,'/api/markets/configuration');assert.equal((await call(alice,'/api/markets/configuration',{revision:c.configurationRevision,configuration:c.configuration},'PATCH')).status,403);
 const saved=await ok(admin,'/api/markets/configuration',{revision:c.configurationRevision,configuration:{...c.configuration,defaultSymbol:'XAU-USD'}},'PATCH');assert.equal(saved.configuration.defaultSymbol,'XAU-USD');
 const fake=actor(token(alice.u.uid,alice.u.email));await assertFails(updateDoc(doc(fake.db,'users',fake.u.uid),{role:'admin',updatedAt:serverTimestamp()}));await assertFails(setDoc(doc(fake.db,'sparkConfiguration','markets'),{configuration:c.configuration,revision:2,updatedAt:serverTimestamp()}));
 const unverified=actor(token(admin.u.uid,admin.u.email,false));await assertFails(getDocs(query(collection(unverified.db,'users'),limit(50))));await assertFails(getDocs(query(collection(unverified.db,'sparkCampaigns'),limit(50))));
 await assertFails(updateDoc(doc(admin.db,'users',admin.u.uid),{disabled:true,updatedAt:serverTimestamp()}));
});
test('financial records are read-only, including for administrators; requests cannot manufacture funds',async()=>{
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'orinAccounts',alice.u.uid),{id:alice.u.uid,tier:'standard',balanceCents:12345,reservedCents:5000,realizedCents:345});await setDoc(doc(db,'orinPositions','historical-position'),{id:'historical-position',user_id:alice.u.uid,status:'active',contract:{id:'old'}});await setDoc(doc(db,'orinContracts','old'),{id:'old',code:'LAB-123456789A',canonical:'locked-original-terms',hash:createHash('sha256').update('locked-original-terms').digest('hex'),eligibility:'all'})});
 const fresh=actor(alice.u),state=await ok(fresh,'/api/lab');assert.equal(state.balanceCents,12345);assert.equal(state.positions.length,1);assert.equal((await ok(fresh,'/api/invitations/verify',{code:'LAB-123456789A'})).contract.id,'old');assert.equal((await ok(actor(bob.u),'/api/lab')).contracts.length,1);
 for(const a of [fresh,admin]){for(const action of ['publish','join','settle'])assert.equal((await call(a,'/api/lab',{action,amountCents:100})).status,409);await assertFails(setDoc(doc(a.db,'orinAccounts',alice.u.uid),{balanceCents:99999999}));await assertFails(setDoc(doc(a.db,'orinContracts','forged'),{id:'forged'}));await assertFails(deleteDoc(doc(a.db,'orinPositions','historical-position')))}
 await assertFails(getDoc(doc(bob.db,'orinAccounts',alice.u.uid)));await assertFails(getDoc(doc(bob.db,'orinPositions','historical-position')));
 const s=await ok(fresh,'/api/settings');assert.equal((await call(fresh,'/api/settings',{revision:s.revision,closeAccount:true},'PATCH')).status,403);assert.equal((await getDoc(doc(alice.db,'orinAccounts',alice.u.uid))).data().balanceCents,12345);
});
test('announcements require admin, preview confirmation and consent; audience metadata stays private',async()=>{
 const draft={action:'draft',title:'ORIN test',message:'Private recipient message',image:'',audience:{country:'GB',tier:'all',users:[]},language:'all',deepLink:'/notifications',startsAt:Date.now()-1000,expiresAt:Date.now()+86400000};
 assert.equal((await call(alice,'/api/admin/notifications',draft)).status,403);
 const {campaign:c}=await ok(admin,'/api/admin/notifications',draft),preview=await ok(admin,'/api/admin/notifications',{action:'preview',id:c.id});assert.equal(preview.recipientCount,1);
 assert.equal((await call(admin,'/api/admin/notifications',{action:'send',id:c.id,revision:c.revision,expectedRecipients:1,confirmed:false})).status,409);
 await ok(admin,'/api/admin/notifications',{action:'send',id:c.id,revision:c.revision,expectedRecipients:1,confirmed:true});assert.equal((await call(admin,'/api/admin/notifications',{action:'send',id:c.id,revision:c.revision,expectedRecipients:1,confirmed:true})).status,409);
 const fresh=actor(alice.u);let inbox=await ok(fresh,'/api/notifications');assert.equal(inbox.unreadCount,1);assert.equal(inbox.items[0].title,'ORIN test');assert.equal((await ok(bob,'/api/notifications')).unreadCount,0);
 await assertFails(getDoc(doc(alice.db,'sparkCampaigns',c.id)));await assertFails(getDoc(doc(bob.db,'sparkAnnouncements',c.id)));await assertFails(getDoc(doc(bob.db,'sparkProfiles',alice.u.uid,'inbox',c.id)));
 await assertFails(updateDoc(doc(alice.db,'sparkProfiles',alice.u.uid,'inbox',c.id),{title:'forged'}));await assertFails(updateDoc(doc(admin.db,'sparkAnnouncements',c.id),{message:'changed after send'}));
 inbox=await ok(fresh,'/api/notifications',{id:c.id});assert.equal(inbox.unreadCount,0);assert.equal((await ok(actor(alice.u),'/api/notifications')).unreadCount,0);
});
test('confirmed announcement send is atomic for a larger audience and does not expose recipient IDs',async()=>{
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();const base=(await getDoc(doc(db,'sparkProfiles',alice.u.uid))).data();for(let i=0;i<25;i++){const uid='spark-audience-'+i;await setDoc(doc(db,'users',uid),{uid,email:uid+'@example.test',displayName:uid,role:'user',disabled:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await setDoc(doc(db,'sparkProfiles',uid),{...base,uid})}});
 const {campaign:c}=await ok(admin,'/api/admin/notifications',{action:'draft',title:'Batch check',message:'Confirmed audience',image:'',audience:{country:'GB',tier:'all',users:[]},language:'all',deepLink:'/settings/security',startsAt:Date.now()-1000,expiresAt:Date.now()+86400000});const preview=await ok(admin,'/api/admin/notifications',{action:'preview',id:c.id});assert.equal(preview.recipientCount,26);await ok(admin,'/api/admin/notifications',{action:'send',id:c.id,revision:c.revision,expectedRecipients:26,confirmed:true});const recipient=actor(token('spark-audience-24'));const inbox=await ok(recipient,'/api/notifications');assert.equal(inbox.items[0].deep_link,'/settings/security');assert.equal(Object.hasOwn(inbox.items[0],'recipientIds'),false);await assertFails(getDoc(doc(recipient.db,'sparkCampaigns',c.id)));
});
test('disabled users and unverified admins lose backend access; roles cannot be self granted',async()=>{
 await updateDoc(doc(admin.db,'users',bob.u.uid),{role:'admin',updatedAt:serverTimestamp()});const promoted=actor(bob.u);await assertSucceeds(getDocs(query(collection(promoted.db,'users'),limit(50))));await assertFails(updateDoc(doc(promoted.db,'users',admin.u.uid),{disabled:true,updatedAt:serverTimestamp()}));await updateDoc(doc(admin.db,'users',bob.u.uid),{disabled:true,updatedAt:serverTimestamp()});await assertFails(getDoc(doc(bob.db,'sparkProfiles',bob.u.uid)));await assertFails(getDocs(query(collection(bob.db,'users'),limit(50))));assert.equal((await call(actor(bob.u),'/api/settings')).status,403);
 const anon=createSparkApi(env.unauthenticatedContext().firestore(),async()=>null);assert.equal((await anon('/api/lab')).status,401);await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'sparkProfiles',alice.u.uid)));
});

test('1.1 avatar privacy, limits, app configuration and deletion requests preserve existing accounts',async()=>{
 const member=actor(token('release-member'));await register(member);await ok(member,'/api/settings');for(const theme of ['light','dark','system']){const updated=await prefs(member,{theme,chartLocale:'en',reduceMotion:true,fontSize:'large'});assert.equal(updated.preferences.theme,theme);assert.equal((await ok(actor(member.u),'/api/settings')).preferences.chartLocale,'en')}
 const photo='data:image/jpeg;base64,/9j/AAAA';await ok(member,'/api/experience/avatar',{photo});assert.equal((await ok(member,'/api/experience/profile')).photo,photo);
 await assertFails(getDoc(doc(alice.db,'sparkAvatars',member.u.uid)));await assertFails(setDoc(doc(member.db,'sparkAvatars',member.u.uid),{photo:'data:image/svg+xml,<script>',updatedAt:serverTimestamp()}));
 assert.equal((await call(member,'/api/experience/avatar',{photo:'data:image/jpeg;base64,'+'A'.repeat(60000)})).status,400);
 const c=await ok(admin,'/api/experience/configuration');assert.equal(c.configuration.maintenance,false);
 assert.equal((await call(member,'/api/experience/configuration',{configuration:c.configuration,revision:c.revision},'PATCH')).status,403);
 const updated=await ok(admin,'/api/experience/configuration',{configuration:{...c.configuration,welcomeAr:'أهلًا بك',maintenance:true},revision:c.revision},'PATCH');assert.equal(updated.configuration.maintenance,true);
 await assertFails(setDoc(doc(member.db,'sparkConfiguration','app'),{configuration:c.configuration,revision:2,updatedAt:serverTimestamp()}));
 assert.equal((await call(member,'/api/experience/deletion-request',{confirmed:false})).status,400);
 await ok(member,'/api/experience/deletion-request',{confirmed:true});await ok(member,'/api/experience/deletion-request',{confirmed:true});
 const request=(await getDoc(doc(member.db,'sparkAccountRequests',member.u.uid))).data();assert.equal(request.status,'requested');assert.equal((await getDoc(doc(member.db,'sparkProfiles',member.u.uid))).data().profile.closureStatus,'requested');
 await assertFails(getDoc(doc(alice.db,'sparkAccountRequests',member.u.uid)));await assertFails(deleteDoc(doc(member.db,'users',member.u.uid)));await assertFails(updateDoc(doc(member.db,'sparkAccountRequests',member.u.uid),{status:'completed'}));
 const s=await ok(actor(alice.u),'/api/settings');assert.equal((await call(actor(alice.u),'/api/experience/deletion-request',{confirmed:true})).status,403);assert.equal(s.profile.closureStatus,'open');
});
test('1.1 admin changes create immutable, backend-validated audit events and reject stale edits',async()=>{
 const target=actor(token('release-managed'));await register(target);await ok(target,'/api/settings');const data=await ok(admin,'/api/experience/admin/users'),u=data.users.find(u=>u.uid===target.u.uid);
 assert.equal((await call(alice,'/api/experience/admin/user',{...u,role:'admin'},'PATCH')).status,403);
 await ok(admin,'/api/experience/admin/user',{...u,displayName:'Managed member',role:'admin'},'PATCH');assert.equal((await getDoc(doc(target.db,'users',target.u.uid))).data().role,'admin');
 assert.equal((await call(admin,'/api/experience/admin/user',{...u,role:'user'},'PATCH')).status,409);
 const events=(await ok(admin,'/api/experience/admin/audit')).events;const event=events.find(e=>e.subjectId===target.u.uid);assert.equal(event.before.role,'user');assert.equal(event.after.role,'admin');
 await assertFails(getDoc(doc(alice.db,'sparkAdminEvents',event.id)));await assertFails(updateDoc(doc(admin.db,'sparkAdminEvents',event.id),{action:'forged'}));
 await assertFails(setDoc(doc(admin.db,'sparkAdminEvents','forged-audit'),{actorId:admin.u.uid,subjectId:target.u.uid,action:'user_updated',before:event.before,after:event.after,createdAt:serverTimestamp()}));
});
test('1.1 archives are private and reversible, and unread counts exclude archived notifications',async()=>{
 const fresh=actor(alice.u);const inbox=await ok(fresh,'/api/notifications');const item=inbox.items.find(n=>!n.read_at);assert.ok(item);
 await ok(fresh,'/api/notifications',{action:'archive',id:item.id});assert.equal((await ok(fresh,'/api/notifications')).items.some(n=>n.id===item.id),false);
 const archive=await ok(fresh,'/api/notifications?archived=true');assert.equal(archive.items.some(n=>n.id===item.id),true);assert.equal((await ok(fresh,'/api/notifications?id='+item.id)).items[0].id,item.id);
 await assertFails(updateDoc(doc(bob.db,'sparkProfiles',alice.u.uid,'inbox',item.id),{archivedAt:serverTimestamp()}));
 await ok(fresh,'/api/notifications',{action:'restore',id:item.id});assert.equal((await ok(fresh,'/api/notifications')).items.some(n=>n.id===item.id),true);
});
