import {doc,getDoc,runTransaction,serverTimestamp,updateDoc,type Firestore} from 'firebase/firestore';
import type {User} from 'firebase/auth';
const ADMIN_EMAILS = ['khtaub7341@gmail.com', 'khtaub99@gmail.com', 'mm@mm.mm'];
export async function ensureAccountProfile(db:Firestore,user:User){
 const ref=doc(db,'users',user.uid);
 const isOwner = ADMIN_EMAILS.includes(user.email?.toLowerCase().trim() ?? '');
 const snapshot=await runTransaction(db,async transaction=>{
  const snapshot=await transaction.get(ref);
  if(!snapshot.exists()){
   transaction.set(ref,{uid:user.uid,email:user.email,displayName:user.displayName||'مستخدم ORIN',role:isOwner?'admin':'user',disabled:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  } else if(isOwner && snapshot.data()?.role !== 'admin') {
   transaction.update(ref,{role:'admin',updatedAt:serverTimestamp()});
  }
  return snapshot;
 });
 if(isOwner && snapshot.data()?.role!=='admin'){try{await updateDoc(ref,{role:'admin',updatedAt:serverTimestamp()})}catch{}}
}

