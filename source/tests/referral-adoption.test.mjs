import test from 'node:test';import assert from 'node:assert/strict';import {programAction,db} from '../firebase-functions/program-test.mjs';
const uid='adoption150',parent='adoption-parent150',code='ORIN-150000000001',parentCode='ORIN-150000000002';const user={id:uid,email:'adoption@test.invalid',name:'QA',verified:true};
test('activation adopts the existing public code and immutable signup attribution',async()=>{
 await db.doc('users/'+uid).set({uid,email:user.email,displayName:user.name,role:'user',disabled:false});
 await db.doc('orinProgramConfiguration/current').set({enabled:true,termsVersion:'QA-1',referralCriteria:'QA',activeTeamCriteria:'QA',activityPeriod:'QA',bonusDurationDays:30,eligibleAssets:['BTC-USD'],bonusProfitLimitCents:100000,bonusTradingTerms:'QA',agencyCriteria:'QA',revision:1});
 await db.doc('orinReferralIdentities/'+uid).set({code});await db.doc('orinReferralCodes/'+code).set({uid});await db.doc('orinReferralCodes/'+parentCode).set({uid:parent});await db.doc('orinReferralAttributions/'+uid).set({code:parentCode,status:'pending'});
 await db.doc('orinProgramMembers/'+parent).set({uid:parent,code:parentCode,referralId:parentCode,ancestors:[],directCount:0,teamCount:0});
 await assert.rejects(programAction(user,{action:'enroll',requestId:crypto.randomUUID(),referralCode:'ORIN-000000000000'}),/already recorded/);
 const result=await programAction(user,{action:'enroll',requestId:crypto.randomUUID()});assert.equal(result.member.code,code);assert.equal((await db.doc('orinProgramMembers/'+uid).get()).data().parentUid,parent);assert.equal((await db.doc('orinProgramMembers/'+parent).get()).data().directCount,1);
});
