import React,{useEffect,useState,type FormEvent} from 'react';
import {KeyRound,Mail,LockKeyhole,UserRound,Eye,EyeOff,Gift} from 'lucide-react';
import {initializeApp} from 'firebase/app';
import {getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,sendPasswordResetEmail,sendEmailVerification,signInWithCustomToken,updateProfile,type User} from 'firebase/auth';
import {getFirestore,doc,updateDoc,serverTimestamp} from 'firebase/firestore';

import {ensureAccountProfile} from '../firebase-web/account-service';
import {firebaseConfig} from '../firebase-web/config';
import {securityBackendConfigured,supportsPasskeys,loginWithPasskey,AccountSecurityError,ensureSecuritySession} from '../lib/account-security-client';
import {useUi,readUi} from './ui';
import {passwordStrength,EMAIL_RETURN_ORIGIN,validEmail} from '../lib/account-validation';
export const app=initializeApp((import.meta.env.DEV||import.meta.env.MODE==='android-qa')&&import.meta.env.VITE_FIREBASE_EMULATORS==='true'?{...firebaseConfig,projectId:'demo-orin-auth',apiKey:'fake-api-key'}:firebaseConfig);export const auth=getAuth(app),db=getFirestore(app);auth.languageCode='ar';
export {navigateTo as to} from '../lib/navigation';
import {navigateTo as to} from '../lib/navigation';

export const fail=(e:unknown)=>{const code=(e as {code?:string})?.code??'';const ar=readUi().chartLocale!=='en';const messages:Record<string,[string,string]>={
'auth/email-already-in-use':['هذا البريد مسجّل بالفعل. سجّل الدخول أو استعد كلمة المرور.','This email is already registered. Sign in or reset your password.'],
'auth/invalid-credential':['البريد أو كلمة المرور غير صحيحة.','The email or password is incorrect.'],
'auth/wrong-password':['كلمة المرور غير صحيحة.','The password is incorrect.'],
'auth/weak-password':['استخدم كلمة مرور أقوى من 8 أحرف على الأقل.','Use a stronger password with at least 8 characters.'],
'auth/invalid-email':['أدخل بريدًا إلكترونيًا صحيحًا.','Enter a valid email address.'],
'auth/too-many-requests':['محاولات كثيرة. حاول مجددًا بعد قليل.','Too many attempts. Please try again later.'],
'auth/network-request-failed':['تعذر الاتصال. تحقق من الإنترنت.','Unable to connect. Check your internet connection.'],
'auth/requires-recent-login':['سجّل الدخول مجددًا لتأكيد هويتك.','Sign in again to confirm your identity.'],
'auth/user-disabled':['الوصول إلى الحساب موقوف. تواصل مع الإدارة.','Account access is disabled. Contact the administrator.'],
'permission-denied':['ليست لديك صلاحية لهذه العملية.','You do not have permission for this action.'],
'unavailable':['الخدمة غير متاحة مؤقتًا. أعد المحاولة.','The service is temporarily unavailable. Please retry.']};return messages[code]?.[ar?0:1]??(ar?'تعذرت العملية. حاول مجددًا.':'The action could not be completed. Please retry.');};
export type Profile={uid:string;email:string;displayName:string;role:'user'|'admin';disabled:boolean;createdAt?:{toDate:()=>Date};updatedAt?:unknown};
export const ensureProfile=(user:User)=>ensureAccountProfile(db,user);

const invitation=()=>{try{return sessionStorage.getItem('orin-referral-code')??''}catch{return ''}};
export function AuthForm({path,done}:{path:string;done:()=>void}){
 const {t}=useUi();const mode=path==='/register'?'register':path==='/forgot-password'?'reset':'login';
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[name,setName]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false),[show,setShow]=useState(false),[showConfirmation,setShowConfirmation]=useState(false);
 const [referral,setReferral]=useState(invitation),[notice,setNotice]=useState('');
 const lock=React.useRef(false),version=React.useRef(0);
 useEffect(()=>{version.current++;setError('');setNotice('');setSent(false);setPassword('');setConfirmation('');setShow(false);setShowConfirmation(false);return()=>{version.current++}},[mode]);
 async function submit(e:FormEvent){
  e.preventDefault();if(lock.current)return;
  if(!navigator.onLine){setError(t('اتصل بالإنترنت أولًا.','Connect to the internet first.'));return}
  if(!validEmail(email)){setError(t('أدخل بريدًا صحيحًا.','Enter a valid email.'));return}
  const normalizedEmail=email.trim().toLowerCase(),normalizedReferral=referral.trim().toUpperCase();
  if(mode==='register'){
   if(password.length<8||name.trim().length<2){setError(t('أدخل اسمًا من حرفين وكلمة مرور من 8 أحرف على الأقل.','Enter a name of at least 2 characters and a password of at least 8.'));return}
   if(password!==confirmation){setError(t('تأكيد كلمة المرور غير مطابق.','The passwords do not match.'));return}
   if(normalizedReferral&&!/^ORIN-[A-F0-9]{12}$/.test(normalizedReferral)){setError(t('تحقق من كود الدعوة؛ يتكون من ORIN- ثم 12 حرفًا أو رقمًا.','Check your invitation code: ORIN- followed by 12 hexadecimal characters.'));return}
  }
  lock.current=true;setBusy(true);setError('');
  try{
   if(mode==='reset'){try{await sendPasswordResetEmail(auth,normalizedEmail,{url:EMAIL_RETURN_ORIGIN+'/login'})}catch(e){if((e as {code?:string}).code!=='auth/user-not-found')throw e}setSent(true)}
   else if(mode==='register'){
    try{if(normalizedReferral){sessionStorage.setItem('orin-referral-code',normalizedReferral);sessionStorage.setItem('orin-referral-email',normalizedEmail)}else{sessionStorage.removeItem('orin-referral-code');sessionStorage.removeItem('orin-referral-email')}}catch{}
    const result=await createUserWithEmailAndPassword(auth,normalizedEmail,password);
    await updateProfile(result.user,{displayName:name.trim()});
    void ensureSecuritySession().catch(()=>{});
    try{await sendEmailVerification(result.user,{url:EMAIL_RETURN_ORIGIN+'/login'})}catch(err){console.warn('ORIN verification link delivery unavailable',err)}
    setPassword('');setConfirmation('');done();
   }else{await signInWithEmailAndPassword(auth,normalizedEmail,password);void ensureSecuritySession().catch(()=>{});setPassword('');done()}
  }catch(e){setError(fail(e));if(mode==='register'&&!auth.currentUser){try{sessionStorage.removeItem('orin-referral-code');sessionStorage.removeItem('orin-referral-email')}catch{}}}finally{lock.current=false;setBusy(false)}
 }
 const strength=passwordStrength(password),strengthLabels=[t('قصيرة جدًا','Too short'),t('ضعيفة','Weak'),t('مقبولة','Fair'),t('جيدة','Good'),t('قوية','Strong')];
 return <section className="auth orin-auth-card auth-release-154">
  <div className="auth-heading orin-auth-hero"><div className="auth-hero-art" aria-hidden="true"><img src="/brand/orin-mark.png" alt=""/></div><span className="auth-eyebrow">ORIN</span><h1>{mode==='register'?t('إنشاء حساب جديد','Create your account'):mode==='reset'?t('استعادة كلمة المرور','Reset password'):t('تسجيل الدخول','Welcome back')}</h1><p>{mode==='register'?t('ابدأ رحلتك مع ORIN.','Start your journey with ORIN.'):mode==='reset'?t('سنرسل رابطًا آمنًا إلى بريدك.','We will send a secure link to your email.'):t('مرحبًا بعودتك إلى ORIN.','Sign in to your ORIN account.')}</p></div>
  <form className="card form" onSubmit={submit} aria-busy={busy}>
   {error&&<div className="message error" role="alert">{error}</div>}
   {sent?<div className="message" role="status">{t('إذا كان البريد مسجّلًا، فستصلك رسالة الاستعادة. تحقق من الرسائل غير المرغوبة أيضًا.','If this email is registered, a reset email will arrive. Check your spam folder too.')}</div>:<>
    {mode==='register'&&<label>{t('الاسم','Name')}<span className="auth-input"><UserRound aria-hidden="true"/><input autoComplete="name" placeholder={t('اسمك','Your name')} value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={100} disabled={busy}/></span></label>}
    <label>{t('البريد الإلكتروني','Email')}<span className="auth-input"><Mail aria-hidden="true"/><input type="email" inputMode="email" autoCapitalize="none" dir="ltr" placeholder="name@example.com" autoComplete="email" value={email} onChange={e=>{version.current++;setEmail(e.target.value);setNotice('')}} required maxLength={254} disabled={busy}/></span></label>
    {notice&&<div className="message" role="status">{notice}</div>}
    {mode!=='reset'&&<label>{t('كلمة المرور','Password')}<span className="password-field auth-input"><LockKeyhole aria-hidden="true"/><input type={show?'text':'password'} dir="ltr" placeholder="••••••••" autoComplete={mode==='register'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={mode==='register'?8:1} maxLength={128} required disabled={busy}/><button type="button" aria-label={show?t('إخفاء كلمة المرور','Hide password'):t('إظهار كلمة المرور','Show password')} aria-pressed={show} onClick={()=>setShow(v=>!v)}>{show?<EyeOff aria-hidden="true"/>:<Eye aria-hidden="true"/>}</button></span>{mode==='register'&&<><meter min={0} max={4} value={strength} aria-label={t('قوة كلمة المرور','Password strength')}/><small aria-live="polite">{password?strengthLabels[strength]:t('8 أحرف على الأقل.','At least 8 characters.')}</small></>}</label>}
    {mode==='register'&&<><label>{t('تأكيد كلمة المرور','Confirm password')}<span className="password-field auth-input"><LockKeyhole aria-hidden="true"/><input type={showConfirmation?'text':'password'} dir="ltr" placeholder={t('أعد إدخال كلمة المرور','Re-enter password')} autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required minLength={8} maxLength={128} disabled={busy}/><button type="button" aria-label={showConfirmation?t('إخفاء تأكيد كلمة المرور','Hide confirmation'):t('إظهار تأكيد كلمة المرور','Show confirmation')} aria-pressed={showConfirmation} onClick={()=>setShowConfirmation(v=>!v)}>{showConfirmation?<EyeOff/>:<Eye/>}</button></span></label><label>{t('كود الدعوة (اختياري)','Invitation code (optional)')}<span className="auth-input"><Gift aria-hidden="true"/><input dir="ltr" autoCapitalize="characters" spellCheck={false} autoComplete="off" maxLength={17} placeholder="ORIN-XXXXXXXXXXXX" value={referral} onChange={e=>setReferral(e.target.value.trim().toUpperCase())} disabled={busy}/></span></label></>}
    <button className="primary" disabled={busy}>{busy?t('جار التنفيذ…','Please wait…'):mode==='register'?t('إنشاء الحساب','Create account'):mode==='reset'?t('إرسال رابط الاستعادة','Send reset link'):t('دخول','Sign in')}</button>
   </>}
   {mode==='login'&&securityBackendConfigured()&&supportsPasskeys()&&<button type="button" className="secondary" disabled={busy} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await loginWithPasskey();done()}catch(e){setError(e instanceof AccountSecurityError?e.message:t('تعذر الدخول بمفتاح المرور.','Passkey sign-in was not completed.'))}finally{lock.current=false;setBusy(false)}}}><KeyRound size={18}/>{t('الدخول بمفتاح مرور','Sign in with passkey')}</button>}
   {mode==='login'&&<a href="/forgot-password" onClick={e=>{e.preventDefault();to('/forgot-password')}}>{t('نسيت كلمة المرور؟','Forgot password?')}</a>}
   <a className="auth-switch" href={mode==='login'?'/register':'/login'} onClick={e=>{e.preventDefault();to(mode==='login'?'/register':'/login')}}>{mode==='login'?t('ليس لديك حساب؟ إنشاء حساب','New to ORIN? Create account'):t('لديك حساب؟ تسجيل الدخول','Already have an account? Sign in')}</a>
  </form>
 </section>;
}
