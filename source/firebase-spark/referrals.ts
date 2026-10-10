import {doc,getDoc,runTransaction,serverTimestamp,type Firestore} from 'firebase/firestore';
import {diagnostic} from '../lib/diagnostics';
import {ReferralServiceError,type ReferralSummary,type ReferralTransport} from '../lib/referrals';
const errorCode=(error:unknown)=>typeof (error as {code?:unknown})?.code==='string'?(error as {code:string}).code:'unknown';
/** The immutable identity remains usable when only the statistics service is unavailable. */
export function referralTransport(db:Firestore,backend?: (path:string,init:RequestInit)=>Promise<Response>):ReferralTransport{return {async load(uid){
 if(backend){const response=await backend('/api/referrals',{});if(!response.ok)throw new ReferralServiceError(response.status===401?'unauthenticated':response.status===403?'permission-denied':'unavailable','backend');return response.json()}
 const identity=doc(db,'orinReferralIdentities',uid);let code:string;
 try{
  let record=await getDoc(identity);
  if(!record.exists()){
   const bytes=crypto.getRandomValues(new Uint8Array(6)),generated='ORIN-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
   await runTransaction(db,async tx=>{const old=await tx.get(identity);if(old.exists())return;const claim=doc(db,'orinReferralCodes',generated),taken=await tx.get(claim);if(taken.exists())throw new Error('Referral code collision; retry');tx.set(identity,{code:generated,createdAt:serverTimestamp()});tx.set(claim,{uid})});record=await getDoc(identity);
  }
  code=record.data()?.code;if(typeof code!=='string'||!/^ORIN-[A-F0-9]{12}$/.test(code))throw new ReferralServiceError('invalid-data','identity');
 }catch(error){const reason=errorCode(error);diagnostic('referral','identity_failed',{code:reason});throw new ReferralServiceError(reason,'identity')}
 const base:ReferralSummary={code,invited:null,successful:null,totalRewardCents:null,rewards:[],referrals:[],terms:null,rewardsActive:false,summaryState:'pending'};
 try{
  const view=(await getDoc(doc(db,'orinReferralViews',uid))).data();
  if(!view)return base;
  return {...base,invited:view.invited??null,successful:view.successful??null,totalRewardCents:view.totalRewardCents??null,rewards:view.rewards??[],referrals:view.referrals??[],terms:view.terms??null,rewardsActive:view.rewardsActive===true,summaryState:'ready'};
 }catch(error){diagnostic('referral','summary_failed',{code:errorCode(error)});return {...base,summaryState:'unavailable'}}
}}}
export async function attributeReferral(db:Firestore,uid:string,code:string){if(!/^ORIN-[A-F0-9]{12}$/.test(code))return;const r=doc(db,'orinReferralAttributions',uid);await runTransaction(db,async tx=>{if((await tx.get(r)).exists())return;tx.set(r,{code,status:'pending',createdAt:serverTimestamp()})})}
