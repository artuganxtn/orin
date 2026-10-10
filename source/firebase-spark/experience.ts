import {collection,doc,getDoc,getDocs,query,limit,orderBy,startAfter,runTransaction,serverTimestamp,setDoc,type Firestore,type QueryDocumentSnapshot} from 'firebase/firestore';
import type {User} from 'firebase/auth';
export const DEFAULT_APP_CONFIG={maintenance:false,messageAr:'نعمل على تحسين ORIN. حاول بعد قليل.',messageEn:'ORIN is being updated. Please try again shortly.',welcomeAr:'',welcomeEn:'',supportEmail:''};
const ms=(v:any)=>v?.toMillis?.()??0;
const problem=(message:string,status=400)=>Object.assign(new Error(message),{status});
export function experienceApi(db:Firestore){
 return async(u:User,path:string,method:string,input:Record<string,any>)=>{
  const userRef=doc(db,'users',u.uid),self=(await getDoc(userRef)).data();
  if(!self||self.disabled)throw problem('الوصول إلى الحساب غير متاح.',403);
  const admin=u.emailVerified&&(self.role==='admin'||u.email==='khtaub7341@gmail.com');
  const requireAdmin=()=>{if(!admin)throw problem('هذه الصفحة للإدارة فقط.',403)};
  if(path==='profile'&&method==='GET'){
   const [avatar,request]=await Promise.all([getDoc(doc(db,'sparkAvatars',u.uid)),getDoc(doc(db,'sparkAccountRequests',u.uid))]);
   return {photo:avatar.data()?.photo??'',createdAt:ms(self.createdAt),deletionRequested:request.exists(),emailVerified:u.emailVerified};
  }
  if(path==='avatar'&&method==='POST'){
   if(typeof input.photo!=='string'||input.photo.length>60000||(input.photo!==''&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.photo)))throw problem('اختر صورة صالحة بحجم صغير.');
   await setDoc(doc(db,'sparkAvatars',u.uid),{photo:input.photo,updatedAt:serverTimestamp()});return {photo:input.photo};
  }
  if(path==='deletion-request'&&method==='POST'){
   if(input.confirmed!==true)throw problem('أكّد الطلب أولًا.');
   await runTransaction(db,async tx=>{const r=doc(db,'sparkAccountRequests',u.uid),profileRef=doc(db,'sparkProfiles',u.uid);const [old,p]=await Promise.all([tx.get(r),tx.get(profileRef)]);if(old.exists())return;if(!p.exists())throw problem('أعد تحميل الحساب أولًا.');const data=p.data();tx.update(profileRef,{profile:{...data.profile,closureStatus:'requested'},revision:data.revision+1,updatedAt:serverTimestamp()});tx.set(r,{uid:u.uid,type:'deletion',status:'requested',createdAt:serverTimestamp()});});
   return {requested:true};
  }
  if(path==='configuration'){
   const r=doc(db,'sparkConfiguration','app');
   if(method==='GET'){const s=(await getDoc(r)).data();let published:any=null;try{published=(await getDoc(doc(db,'orinPublicConfiguration','current'))).data()}catch{}return {configuration:{...DEFAULT_APP_CONFIG,...s?.configuration,...published},revision:published?.revision??s?.revision??0};}
   requireAdmin();if(method!=='PATCH'||!input.configuration)throw problem('طلب غير صالح.');
   const c=input.configuration;if(Object.keys(c).some(k=>!Object.hasOwn(DEFAULT_APP_CONFIG,k))||Object.keys(c).length!==6||typeof c.maintenance!=='boolean')throw problem('إعدادات غير صالحة.');
   for(const k of ['messageAr','messageEn','welcomeAr','welcomeEn','supportEmail'])if(typeof c[k]!=='string'||c[k].length>300)throw problem('راجع طول النص.');
   if(c.supportEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.supportEmail))throw problem('بريد الدعم غير صالح.');
   await runTransaction(db,async tx=>{const s=(await tx.get(r)).data();if((s?.revision??0)!==input.revision)throw problem('تغيرت الإعدادات. أعد التحميل.',409);tx.set(r,{configuration:c,revision:input.revision+1,updatedAt:serverTimestamp()});});return {configuration:c,revision:input.revision+1};
  }
  if(path==='admin/users'&&method==='GET'){
   requireAdmin();const users:any[]=[];let cursor:QueryDocumentSnapshot|undefined;
   for(let i=0;i<10;i++){const page=await getDocs(query(collection(db,'users'),orderBy('createdAt','desc'),...(cursor?[startAfter(cursor)]:[]),limit(100)));users.push(...page.docs.map(d=>({...d.data(),createdAt:ms(d.data().createdAt),updatedAt:ms(d.data().updatedAt)})));cursor=page.docs[page.docs.length-1];if(page.size<100)return {users,truncated:false};}return {users,truncated:true};
  }
  if(path==='admin/user'&&method==='PATCH'){
   requireAdmin();const {uid,displayName,role,disabled,updatedAt}=input;
   if(typeof uid!=='string'||uid===u.uid||uid.includes('/')||typeof displayName!=='string'||!displayName.trim()||displayName.length>100||!['user','admin'].includes(role)||typeof disabled!=='boolean')throw problem('راجع بيانات المستخدم.');
   await runTransaction(db,async tx=>{const r=doc(db,'users',uid),s=await tx.get(r);if(!s.exists())throw problem('الحساب غير موجود.',404);const before=s.data();if(ms(before.updatedAt)!==updatedAt)throw problem('تغير الحساب. حدّث القائمة.',409);if(before.email==='khtaub7341@gmail.com')throw problem('لا يمكن تعديل حساب المالك.',403);
    const after={displayName:displayName.trim(),role,disabled};tx.update(r,{...after,updatedAt:serverTimestamp()});tx.set(doc(collection(db,'sparkAdminEvents')),{actorId:u.uid,subjectId:uid,action:'user_updated',before:{displayName:before.displayName,role:before.role,disabled:before.disabled},after,createdAt:serverTimestamp()});});return {saved:true};
  }
  if(path==='admin/audit'&&method==='GET'){requireAdmin();return {events:(await getDocs(query(collection(db,'sparkAdminEvents'),orderBy('createdAt','desc'),limit(100)))).docs.map(d=>({...d.data(),id:d.id,createdAt:ms(d.data().createdAt)}))};}
  if(path==='admin/requests'&&method==='GET'){requireAdmin();return {requests:(await getDocs(query(collection(db,'sparkAccountRequests'),orderBy('createdAt','desc'),limit(100)))).docs.map(d=>({...d.data(),createdAt:ms(d.data().createdAt)}))};}
  throw problem('المسار غير متاح.',404);
 };
}
