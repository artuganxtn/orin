import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {programAction,programSummary,adminPrograms,accountActivity,recordVerifiedCustomer,recordConfirmedDeposit,recordFinalBonusProfit,db,hash} from '../firebase-functions/program-test.mjs';
const actor=id=>({id:'program-'+id,email:id+'@example.test',verified:true,name:id});
const alice=actor('alice'),bob=actor('bob'),carol=actor('carol'),admin=actor('admin');
const command=(extra)=>({requestId:crypto.randomUUID(),...extra});
const config={enabled:true,termsVersion:'TEST-ONLY-v1',referralCriteria:'TEST-ONLY eligibility',activeTeamCriteria:'TEST-ONLY activity',activityPeriod:'TEST-ONLY period',bonusDurationDays:30,eligibleAssets:['BTC-USD'],bonusProfitLimitCents:100000,bonusTradingTerms:'TEST-ONLY terms, never production defaults',agencyCriteria:'TEST-ONLY agency',badgeCriteria:{elite:'TEST-ONLY criteria'},revision:0};
before(async()=>{for(const u of [alice,bob,carol,admin]){await db.doc('users/'+u.id).set({uid:u.id,email:u.email,displayName:u.name,disabled:false,role:u===admin?'admin':'user'});await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).set({ownerId:u.id,type:'real',currency:'USD',balanceCents:0,reservedCents:0,realizedCents:0,accountNumber:'900000000001'});await db.doc(`sparkTradingAccounts/${u.id}/accounts/demo`).set({ownerId:u.id,type:'demo',currency:'USD',balanceCents:0})}});
let first,second;
test('programs fail closed; client cannot activate; activation needs complete approved terms',async()=>{
 await assert.rejects(programAction(alice,command({action:'enroll'})),/not active/);
 await assert.rejects(adminPrograms(alice,command({action:'configure',revision:0,configuration:config})),e=>e.status===403);
 await assert.rejects(adminPrograms(admin,command({action:'configure',revision:0,configuration:{...config,bonusDurationDays:null}})),e=>e.status===409);
 await adminPrograms(admin,command({action:'configure',revision:0,configuration:config}));
});
test('enrollment has durable independent codes, bounded immutable lineage and rejects code reuse/self referral',async()=>{
 const cmd=command({action:'enroll'});first=await programAction(alice,cmd);const again=await programAction(alice,cmd);assert.equal(first.member.code,again.member.code);assert.notEqual(first.member.code,alice.id);assert.match(first.member.code,/^ORIN-[A-F0-9]{12}$/);
 second=await programAction(bob,command({action:'enroll',referralCode:first.member.code}));assert.notEqual(first.member.code,second.member.code);assert.equal((await programSummary(alice)).tree[0].id,second.member.referralId);
 await assert.rejects(programAction(alice,command({action:'enroll',referralCode:first.member.code})),/Already enrolled/);
 await db.doc('orinReferralCodes/ORIN-000000000000').set({uid:carol.id});await assert.rejects(programAction(carol,command({action:'enroll',referralCode:'ORIN-000000000000'})),/Self referral/);
});
test('KYC uniqueness and claimed bonus prevent duplicate clients, repeat claims and demo funding',async()=>{
 await assert.rejects(programAction(alice,command({action:'claim_bonus',accountId:'real'})),/verification/);
 await recordVerifiedCustomer(alice.id,hash('customer-alice'),'kyc-alice');await recordVerifiedCustomer(bob.id,hash('customer-bob'),'kyc-bob');
 await assert.rejects(recordVerifiedCustomer(carol.id,hash('customer-alice'),'kyc-carol-duplicate'),/Duplicate/);
 await assert.rejects(programAction(alice,command({action:'claim_bonus',accountId:'demo'})),/real USD/);
 const cmd=command({action:'claim_bonus',accountId:'real'});await Promise.all([programAction(alice,cmd),programAction(alice,cmd)]);
 const view=await programSummary(alice);assert.equal(view.bonus.bonusCents,10000);assert.equal(view.bonus.cashCents,0);assert.equal(view.bonus.withdrawableProfitCents,0);
 await assert.rejects(programAction(alice,command({action:'claim_bonus',accountId:'real'})),/already claimed/);
});
test('bonus profits remain locked; two $250 deposits do not unlock; one $500 confirmed deposit does',async()=>{
 await recordFinalBonusProfit({eventId:'profit-alice',uid:alice.id,accountId:'real',asset:'BTC-USD',profitCents:75000,closedAt:Date.now()});
 for(const eventId of ['deposit250-a','deposit250-b'])await recordConfirmedDeposit({eventId,uid:alice.id,accountId:'real',currency:'USD',cents:25000,eligible:true});
 let view=await programSummary(alice);assert.equal(view.bonus.cashCents,50000);assert.equal(view.bonus.profitCents,75000);assert.equal(view.bonus.withdrawableProfitCents,0);
 const event={eventId:'deposit500',uid:alice.id,accountId:'real',currency:'USD',cents:50000,eligible:true};await Promise.all([recordConfirmedDeposit(event),recordConfirmedDeposit(event)]);
 view=await programSummary(alice);assert.equal(view.bonus.cashCents,100000);assert.equal(view.bonus.withdrawableProfitCents,75000);assert.equal(view.bonus.bonusCents,10000);
 await assert.rejects(recordConfirmedDeposit({...event,cents:60000}),/conflict/);
 await assert.rejects(recordFinalBonusProfit({eventId:'bad-profit',uid:alice.id,accountId:'real',asset:'XAU-USD',profitCents:100,closedAt:Date.now()}),/eligible/);
});
test('$80 rewards need trusted eligibility; pending cannot be paid; repeated paid requests cannot double credit',async()=>{
 await assert.rejects(adminPrograms(admin,command({action:'referral',uid:bob.id,status:'paid',accountId:'real'})),/transition/);
 await assert.rejects(adminPrograms(admin,command({action:'referral',uid:bob.id,status:'qualified',evidenceId:'missing'})),/evidence/);
 await db.doc('orinProgramEvidence/bob-qualified').set({uid:bob.id,kind:'referral_qualified',termsVersion:config.termsVersion,revoked:false});
 await adminPrograms(admin,command({action:'referral',uid:bob.id,status:'qualified',evidenceId:'bob-qualified'}));
 const cmd=command({action:'referral',uid:bob.id,status:'paid',accountId:'real'});await Promise.all([adminPrograms(admin,cmd),adminPrograms(admin,cmd)]);
 assert.equal((await programSummary(alice)).bonus.cashCents,108000);assert.equal((await programSummary(alice)).member.paidCents,8000);
 await assert.rejects(adminPrograms(admin,command({action:'referral',uid:bob.id,status:'paid',accountId:'real'})),/transition/);
});
test('agency is admin-only and badges require backend evidence',async()=>{
 await assert.rejects(programAction(alice,command({action:'agency',grant:true})),/Invalid/);
 await assert.rejects(adminPrograms(alice,command({action:'agency',uid:alice.id,grant:true,reason:'client'})),e=>e.status===403);
 await adminPrograms(admin,command({action:'agency',uid:alice.id,grant:true,reason:'TEST-ONLY approved review'}));assert.equal((await programSummary(alice)).member.agencyGranted,true);
 await assert.rejects(adminPrograms(admin,command({action:'badge',uid:alice.id,badge:'elite',evidenceId:'missing'})),/evidence/);
 await db.doc('orinProgramEvidence/elite-approved').set({uid:alice.id,kind:'badge',badge:'elite',termsVersion:config.termsVersion,revoked:false});
 await adminPrograms(admin,command({action:'badge',uid:alice.id,badge:'elite',evidenceId:'elite-approved'}));assert((await programSummary(alice)).member.badges.includes('elite'));
});
test('team rewards use eligible net revenue and the level cap, not customer deposits',async()=>{
 const input={action:'activity_reward',uid:alice.id,periodId:'test-period',accountId:'real'};await assert.rejects(adminPrograms(admin,command(input)),/revenue/);
 await db.doc('orinEligibleRevenue/'+alice.id+'_test-period').set({uid:alice.id,termsVersion:config.termsVersion,finalized:true,netRevenueCents:1000000,direct:3,activeTeam:3});
 await adminPrograms(admin,command(input));assert.equal((await programSummary(alice)).member.activityRewardCents,2000);assert.equal((await programSummary(alice)).bonus.cashCents,110000);
 await assert.rejects(adminPrograms(admin,command(input)),/revenue/);
});
test('all recorded financial entries balance to zero and financial mutations have audit records',async()=>{
 const journals=await db.collection('orinProgramLedger').get();assert(journals.size>=7);for(const j of journals.docs)assert.equal(j.data().entries.reduce((sum,e)=>sum+e.cents,0),0);assert((await db.collection('orinAudit').get()).size>=12);
});

test('account history returns only owned real-account records and keeps bonus principal separate',async()=>{const rows=await accountActivity(alice,'real');assert(rows.ledger.length>0);assert(rows.ledger.every(x=>x.accountId==='real'));assert(rows.ledger.some(x=>x.kind==='nonwithdrawable_bonus'));await assert.rejects(accountActivity(bob,'nonexistent'));await assert.rejects(accountActivity(alice,'demo'));});
