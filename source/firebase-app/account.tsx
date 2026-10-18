import React,{useEffect,useState,type FormEvent} from 'react';
import {KeyRound,Mail,LockKeyhole,UserRound,Eye,EyeOff,Gift,ShieldCheck,CheckCircle2} from 'lucide-react';
import {initializeApp} from 'firebase/app';
import {getAuth,signInWithEmailAndPassword,signInWithCustomToken,type User} from 'firebase/auth';

import {ensureAccountProfile} from '../firebase-web/account-service';
import {firebaseConfig} from '../firebase-web/config';
import {securityBackendConfigured,supportsPasskeys,loginWithPasskey,AccountSecurityError,ensureSecuritySession} from '../lib/account-security-client';
import {useUi,readUi} from './ui';
import {passwordStrength,EMAIL_RETURN_ORIGIN,validEmail} from '../lib/account-validation';
import {apiFetch} from '../lib/client-api';
import {AppDownloadCard} from '../app/app-download-card';

export const app=initializeApp((import.meta.env.DEV||import.meta.env.MODE==='android-qa')&&import.meta.env.VITE_FIREBASE_EMULATORS==='true'?{...firebaseConfig,projectId:'demo-orin-auth',apiKey:'fake-api-key'}:firebaseConfig);
export const auth=getAuth(app),db=null;auth.languageCode='ar';
export {navigateTo as to} from '../lib/navigation';
import {navigateTo as to} from '../lib/navigation';

export const fail=(e:unknown)=>{
 const code=(e as {code?:string})?.code??'';
 const ar=readUi().chartLocale!=='en';
 const messages:Record<string,[string,string]>={
  'auth/email-already-in-use':['هذا البريد مسجّل بالفعل. سجّل الدخول أو استعد كلمة المرور.','This email is already registered. Sign in or reset your password.'],
  'email-already-exists':['هذا البريد مسجّل بالفعل. سجّل الدخول أو استعد كلمة المرور.','This email is already registered. Sign in or reset your password.'],
  'auth/invalid-credential':['البريد أو كلمة المرور غير صحيحة.','The email or password is incorrect.'],
  'auth/wrong-password':['كلمة المرور غير صحيحة.','The password is incorrect.'],
  'code-invalid':['رمز التحقق غير صحيح. تحقق من البريد وأعد المحاولة.','Invalid verification code. Check email and try again.'],
  'code-expired':['انتهت صلاحية الرمز. أعد إرسال رمز جديد.','Code expired. Resend a new code.'],
  'code-locked':['تم تجاوز عدد المحاولات. أعد طلب رمز جديد.','Too many failed attempts. Request a new code.'],
  'cooldown-active':['انتظر 60 ثانية قبل طلب رمز جديد.','Please wait 60 seconds before requesting a new code.'],
  'auth/weak-password':['استخدم كلمة مرور أقوى من 8 أحرف على الأقل.','Use a stronger password with at least 8 characters.'],
  'auth/invalid-email':['أدخل بريدًا إلكترونيًا صحيحًا.','Enter a valid email address.'],
  'auth/too-many-requests':['محاولات كثيرة. حاول مجددًا بعد قليل.','Too many attempts. Please try again later.'],
  'auth/network-request-failed':['تعذر الاتصال. تحقق من الإنترنت.','Unable to connect. Check your internet connection.'],
  'auth/user-disabled':['الوصول إلى الحساب موقوف. تواصل مع الإدارة.','Account access is disabled. Contact administrator.'],
  'email_unverified':['يرجى تأكيد البريد الإلكتروني بالرمز قبل المتابعة.','Please verify your email address before continuing.'],
  'delivery-unavailable':['تعذر إرسال رمز التحقق إلى بريدك الإلكتروني حاليًا. يرجى التواصل مع الدعم أو المحاولة لاحقًا.','Verification email could not be delivered right now. Please contact support or try again later.'],
  'service-unavailable':['خدمة التسجيل غير متاحة مؤقتًا. يرجى المحاولة بعد قليل.','Registration service is temporarily unavailable. Please try again shortly.']
 };
 return messages[code]?.[ar?0:1]??(ar?'تعذرت العملية. حاول مجددًا.':'The action could not be completed. Please retry.');
};

export type Profile={uid:string;email:string;displayName:string;role:'user'|'admin';disabled:boolean;createdAt?:{toDate:()=>Date};updatedAt?:unknown};
export const ensureProfile=(user:User)=>ensureAccountProfile(db,user);

const invitation=()=>{try{return sessionStorage.getItem('orin-referral-code')||localStorage.getItem('orin-referral-code')||''}catch{return ''}};

export function AuthForm({path,done}:{path:string;done:()=>void}){
 const {t}=useUi();
 const mode=path==='/register'?'register':path==='/forgot-password'?'reset':'login';
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[name,setName]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false),[show,setShow]=useState(false),[showConfirmation,setShowConfirmation]=useState(false);
 const [referral,setReferral]=useState(invitation),[notice,setNotice]=useState('');

 // OTP Step state for signup & password reset flows
 const [otpStep,setOtpStep]=useState(false);
 const [challengeId,setChallengeId]=useState('');
 const [otpCode,setOtpCode]=useState('');
 const [cooldown,setCooldown]=useState(0);
 const [attemptsLeft,setAttemptsLeft]=useState<number | null>(null);

 const lock=React.useRef(false),version=React.useRef(0);

 useEffect(()=>{
  version.current++;
  setError('');
  setNotice('');
  setSent(false);
  setPassword('');
  setConfirmation('');
  setShow(false);
  setShowConfirmation(false);
  setOtpStep(false);
  setOtpCode('');
  setChallengeId('');
  setAttemptsLeft(null);
  return()=>{version.current++};
 },[mode]);

 useEffect(()=>{
  if(cooldown<=0)return;
  const timer=setInterval(()=>setCooldown(c=>Math.max(0,c-1)),1000);
  return()=>clearInterval(timer);
 },[cooldown]);

 const maskEmail=(str:string)=>{
  return str.replace(/^(.{1,2})(.*)(@.*)$/,(_,a,b,c)=>a+'***'+c);
 };

 async function sendSignupOtp(){
  const normalizedEmail=email.trim().toLowerCase();
  if(!validEmail(normalizedEmail)){setError(t('أدخل بريدًا صحيحًا.','Enter a valid email.'));return;}
  if(password.length<8||name.trim().length<2){setError(t('أدخل اسمًا من حرفين وكلمة مرور من 8 أحرف على الأقل.','Enter a name of at least 2 characters and a password of at least 8.'));return;}
  if(password!==confirmation){setError(t('تأكيد كلمة المرور غير مطابق.','The passwords do not match.'));return;}

  lock.current=true;setBusy(true);setError('');
  try{
   const res=await apiFetch('/api/identity/send-code',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:normalizedEmail,name:name.trim(),password})
   });
   const data = (await res.json()) as any;
   if(!res.ok){
    throw {code:data?.code||'service-unavailable'};
   }
   if (data.token) {
    await signInWithCustomToken(auth, data.token);
    void ensureSecuritySession().catch(()=>{});
    setPassword('');setConfirmation('');
    done();
    return;
   }
   setChallengeId(data.challengeId);
   setOtpStep(true);
   setCooldown(data.retryAfter||60);
  }catch(e){
   setError(fail(e));
  }finally{
   lock.current=false;setBusy(false);
  }
 }

 async function verifySignupOtp(e:FormEvent){
  e.preventDefault();
  if(lock.current)return;
  if(otpCode.trim().length!==6){setError(t('أدخل كود التحقق المكون من 6 أرقام.','Enter 6-digit verification code.'));return;}

  const normalizedEmail=email.trim().toLowerCase();
  lock.current=true;setBusy(true);setError('');

  try{
   const res=await apiFetch('/api/identity/register',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
     email:normalizedEmail,
     name:name.trim(),
     password,
     code:otpCode.trim(),
     challengeId
    })
   });
   const data = (await res.json()) as any;
   if(!res.ok){
    throw {code:data?.code||'code-invalid'};
   }

   await signInWithCustomToken(auth,data.token);
   void ensureSecuritySession().catch(()=>{});
   setPassword('');setConfirmation('');
   done();
  }catch(e){
   setError(fail(e));
  }finally{
   lock.current=false;setBusy(false);
  }
 }

 async function sendResetOtp(){
  const normalizedEmail=email.trim().toLowerCase();
  if(!validEmail(normalizedEmail)){setError(t('أدخل بريدًا صحيحًا.','Enter a valid email.'));return;}

  lock.current=true;setBusy(true);setError('');
  try{
   const res=await apiFetch('/api/auth/reset/start',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:normalizedEmail})
   });
   const retryHeader=res.headers.get('Retry-After');
   const data = (await res.json()) as any;
   setNotice(data.message||t('أرسلنا رمز الاستعادة إلى بريدك.','Reset code sent to your email.'));
   setOtpStep(true);
   setAttemptsLeft(null);
   setCooldown(retryHeader?Math.max(1,parseInt(retryHeader,10)):60);
  }catch(e){
   setError(fail(e));
  }finally{
   lock.current=false;setBusy(false);
  }
 }

 async function confirmResetOtp(e:FormEvent){
  e.preventDefault();
  if(lock.current)return;
  if(otpCode.trim().length!==6){setError(t('أدخل كود التحقق المكون من 6 أرقام.','Enter 6-digit verification code.'));return;}
  if(password.length<8){setError(t('أدخل كلمة مرور جديدة من 8 أحرف على الأقل.','Enter a new password of at least 8 characters.'));return;}
  if(password!==confirmation){setError(t('تأكيد كلمة المرور غير مطابق.','The passwords do not match.'));return;}

  const normalizedEmail=email.trim().toLowerCase();
  lock.current=true;setBusy(true);setError('');

  try{
   const res=await apiFetch('/api/auth/reset/confirm',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
     email:normalizedEmail,
     code:otpCode.trim(),
     newPassword:password
    })
   });
   const data = (await res.json()) as any;
   if(!res.ok){
    if(data?.attemptsLeft!==undefined){
     setAttemptsLeft(Number(data.attemptsLeft));
    }
    throw {code:data?.code||'code-invalid',message:data?.error};
   }
   setSent(true);
   setOtpStep(false);
   setPassword('');setConfirmation('');setOtpCode('');setAttemptsLeft(null);
  }catch(e){
   setError(fail(e));
  }finally{
   lock.current=false;setBusy(false);
  }
 }

 async function submit(e:FormEvent){
  e.preventDefault();
  if(lock.current)return;
  if(!navigator.onLine){setError(t('اتصل بالإنترنت أولًا.','Connect to the internet first.'));return;}

  if(mode==='register'){
   if(!otpStep){
    await sendSignupOtp();
   }else{
    await verifySignupOtp(e);
   }
   return;
  }

  if(mode==='reset'){
   if(!otpStep){
    await sendResetOtp();
   }else{
    await confirmResetOtp(e);
   }
   return;
  }

  const normalizedEmail=email.trim().toLowerCase();
  lock.current=true;setBusy(true);setError('');
  try{
   await signInWithEmailAndPassword(auth,normalizedEmail,password);
   void ensureSecuritySession().catch(()=>{});
   setPassword('');
   done();
  }catch(e){
   setError(fail(e));
  }finally{
   lock.current=false;setBusy(false);
  }
 }

 const strength=passwordStrength(password),strengthLabels=[t('قصيرة جدًا','Too short'),t('ضعيفة','Weak'),t('مقبولة','Fair'),t('جيدة','Good'),t('قوية','Strong')];

 return <section className="auth orin-auth-card auth-release-154">
  <div className="auth-heading orin-auth-hero">
   <div className="auth-hero-art" aria-hidden="true"><img src="/brand/orin-mark.png" alt=""/></div>
   <span className="auth-eyebrow">ORIN</span>
   <h1>{otpStep?(mode==='reset'?t('رمز تعيين كلمة المرور','Reset Password Code'):t('تأكيد البريد الإلكتروني','Verify Email')):mode==='register'?t('إنشاء حساب جديد','Create your account'):mode==='reset'?t('استعادة كلمة المرور','Reset password'):t('تسجيل الدخول','Welcome back')}</h1>
   <p>{otpStep?t('أدخل الكود المكون من 6 أرقام المرسل لبريدك.','Enter 6-digit code sent to your email.'):mode==='register'?t('ابدأ رحلتك مع ORIN.','Start your journey with ORIN.'):mode==='reset'?t('سنرسل لك رمز التأكيد لإعادة تعيين كلمة المرور.','We will send a secure link to your email.'):t('مرحبًا بعودتك إلى ORIN.','Sign in to your ORIN account.')}</p>
  </div>

  <form className="card form" onSubmit={submit} aria-busy={busy}>
   {error&&<div className="message error" role="alert">{error}</div>}
   {sent?<div className="message" role="status" style={{display:'flex',flexDirection:'column',gap:'10px',alignItems:'center',textAlign:'center'}}>
    <CheckCircle2 size={32} style={{color:'#10b981'}}/>
    <b>{t('تم تعيين كلمة المرور بنجاح!','Password reset completed successfully!')}</b>
    <p>{t('يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.','You can now sign in with your new password.')}</p>
    <button className="primary" type="button" onClick={()=>to('/login')}>{t('الانتقال لتسجيل الدخول','Go to Sign In')}</button>
   </div>:<>

    {otpStep ? (
     <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
      <div style={{background:'var(--orin-surface-soft,#f0f6ff)',padding:'12px 16px',borderRadius:'14px',fontSize:'13px',display:'flex',alignItems:'center',gap:'10px'}}>
       <ShieldCheck size={20} style={{color:'#0788ff',flex:'none'}}/>
       <span>{t('تم إرسال رمز التحقق إلى:','Verification code sent to:')} <b dir="ltr">{maskEmail(email)}</b></span>
      </div>

      <label>{t('رمز التحقق (6 أرقام)','Verification Code (6 digits)')}
       <span className="auth-input">
        <KeyRound aria-hidden="true"/>
        <input
         type="text"
         inputMode="numeric"
         pattern="[0-9]*"
         maxLength={6}
         placeholder="000000"
         dir="ltr"
         value={otpCode}
         onChange={e=>setOtpCode(e.target.value.replace(/\D/g,''))}
         required
         disabled={busy}
         style={{fontSize:'22px',letterSpacing:'6px',fontWeight:700,textAlign:'center'}}
        />
       </span>
      </label>

      {attemptsLeft!==null && (
       <div style={{fontSize:'12.5px',color:'#e11d48',fontWeight:600,textAlign:'center'}}>
        {t(`المحاولات المتبقية: ${attemptsLeft}`,`Remaining attempts: ${attemptsLeft}`)}
       </div>
      )}

      {mode==='reset' && (
       <>
        <label>{t('كلمة المرور الجديدة','New Password')}
         <span className="password-field auth-input">
          <LockKeyhole aria-hidden="true"/>
          <input
           type={show?'text':'password'}
           dir="ltr"
           placeholder="••••••••"
           autoComplete="new-password"
           value={password}
           onChange={e=>setPassword(e.target.value)}
           minLength={8}
           maxLength={128}
           required
           disabled={busy}
          />
          <button type="button" aria-label={show?t('إخفاء','Hide'):t('إظهار','Show')} onClick={()=>setShow(v=>!v)}>
           {show?<EyeOff/>:<Eye/>}
          </button>
         </span>
         <meter min={0} max={4} value={strength} aria-label={t('قوة كلمة المرور','Password strength')}/>
         <small aria-live="polite">{password?strengthLabels[strength]:t('8 أحرف على الأقل.','At least 8 characters.')}</small>
        </label>

        <label>{t('تأكيد كلمة المرور الجديدة','Confirm New Password')}
         <span className="password-field auth-input">
          <LockKeyhole aria-hidden="true"/>
          <input
           type={showConfirmation?'text':'password'}
           dir="ltr"
           placeholder={t('أعد إدخال كلمة المرور','Re-enter password')}
           autoComplete="new-password"
           value={confirmation}
           onChange={e=>setConfirmation(e.target.value)}
           minLength={8}
           maxLength={128}
           required
           disabled={busy}
          />
          <button type="button" aria-label={showConfirmation?t('إخفاء','Hide'):t('إظهار','Show')} onClick={()=>setShowConfirmation(v=>!v)}>
           {showConfirmation?<EyeOff/>:<Eye/>}
          </button>
         </span>
        </label>
       </>
      )}

      <button className="primary" disabled={busy||otpCode.length!==6||(mode==='reset'&&(!password||password!==confirmation))}>
       {busy?t('جار التأكيد…','Confirming…'):mode==='reset'?t('تغيير كلمة المرور','Reset Password'):t('تأكيد وإنشاء الحساب','Verify & Create Account')}
      </button>

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:'6px',fontSize:'13px'}}>
       <button
        type="button"
        disabled={busy||cooldown>0}
        onClick={()=>void (mode==='reset'?sendResetOtp():sendSignupOtp())}
        style={{border:0,background:'none',color:cooldown>0?'#94a3b8':'#0788ff',cursor:cooldown>0?'not-allowed':'pointer',fontWeight:600}}
       >
        {cooldown>0?t(`إعادة الإرسال بعد ${cooldown}ث`,`Resend in ${cooldown}s`):t('إعادة إرسال الرمز','Resend Code')}
       </button>

       <button
        type="button"
        onClick={()=>{setOtpStep(false);setOtpCode('');}}
        style={{border:0,background:'none',color:'#64748b',cursor:'pointer'}}
       >
        {t('تغيير البريد','Change Email')}
       </button>
      </div>
     </div>
    ) : (
     <>
      {mode==='register'&&<label>{t('الاسم','Name')}<span className="auth-input"><UserRound aria-hidden="true"/><input autoComplete="name" placeholder={t('اسمك','Your name')} value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={100} disabled={busy}/></span></label>}
      <label>{t('البريد الإلكتروني','Email')}<span className="auth-input"><Mail aria-hidden="true"/><input type="email" inputMode="email" autoCapitalize="none" dir="ltr" placeholder="name@example.com" autoComplete="email" value={email} onChange={e=>{version.current++;setEmail(e.target.value);setNotice('')}} required maxLength={254} disabled={busy}/></span></label>
      {notice&&<div className="message" role="status">{notice}</div>}
      {mode!=='reset'&&<label>{t('كلمة المرور','Password')}<span className="password-field auth-input"><LockKeyhole aria-hidden="true"/><input type={show?'text':'password'} dir="ltr" placeholder="••••••••" autoComplete={mode==='register'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={mode==='register'?8:1} maxLength={128} required disabled={busy}/><button type="button" aria-label={show?t('إخفاء كلمة المرور','Hide password'):t('إظهار كلمة المرور','Show password')} aria-pressed={show} onClick={()=>setShow(v=>!v)}>{show?<EyeOff aria-hidden="true"/>:<Eye aria-hidden="true"/>}</button></span>{mode==='register'&&<><meter min={0} max={4} value={strength} aria-label={t('قوة كلمة المرور','Password strength')}/><small aria-live="polite">{password?strengthLabels[strength]:t('8 أحرف على الأقل.','At least 8 characters.')}</small></>}</label>}
      {mode==='register'&&<><label>{t('تأكيد كلمة المرور','Confirm password')}<span className="password-field auth-input"><LockKeyhole aria-hidden="true"/><input type={showConfirmation?'text':'password'} dir="ltr" placeholder={t('أعد إدخال كلمة المرور','Re-enter password')} autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required minLength={8} maxLength={128} disabled={busy}/><button type="button" aria-label={showConfirmation?t('إخفاء تأكيد كلمة المرور','Hide confirmation'):t('إظهار تأكيد كلمة المرور','Show confirmation')} aria-pressed={showConfirmation} onClick={()=>setShowConfirmation(v=>!v)}>{showConfirmation?<EyeOff/>:<Eye/>}</button></span></label><label>{t('كود الدعوة (اختياري)','Invitation code (optional)')}<span className="auth-input"><Gift aria-hidden="true"/><input dir="ltr" autoCapitalize="characters" spellCheck={false} autoComplete="off" maxLength={17} placeholder="ORIN-XXXXXXXXXXXX" value={referral} onChange={e=>setReferral(e.target.value.trim().toUpperCase())} disabled={busy}/></span></label></>}
      <button className="primary" disabled={busy}>{busy?t('جار التنفيذ…','Please wait…'):mode==='register'?t('المتابعة لإرسال الرمز','Continue to Send Code'):mode==='reset'?t('إرسال كود الاستعادة','Send Reset Code'):t('دخول','Sign in')}</button>
     </>
    )}
   </>}

   {mode==='login'&&securityBackendConfigured()&&supportsPasskeys()&&(
    <button
     type="button"
     className="passkey-btn"
     disabled={busy}
     onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await loginWithPasskey();done()}catch(e){setError(e instanceof AccountSecurityError?e.message:t('تعذر الدخول بمفتاح المرور.','Passkey sign-in was not completed.'))}finally{lock.current=false;setBusy(false)}}}
     style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:'8px',height:'42px',minHeight:'42px',maxHeight:'42px',padding:'0 16px',borderRadius:'12px',border:'1px solid #d5e2f5',background:'#f8fbff',color:'#0788ff',fontSize:'13.5px',fontWeight:600,cursor:'pointer',width:'100%',boxSizing:'border-box'}}
    >
     <KeyRound size={16} style={{flexShrink:0}}/>
     <span>{t('الدخول بمفتاح مرور','Sign in with passkey')}</span>
    </button>
   )}
   {mode==='login'&&<a href="/forgot-password" onClick={e=>{e.preventDefault();to('/forgot-password')}}>{t('نسيت كلمة المرور؟','Forgot password?')}</a>}
   <a className="auth-switch" href={mode==='login'?'/register':'/login'} onClick={e=>{e.preventDefault();to(mode==='login'?'/register':'/login')}}>{mode==='login'?t('ليس لديك حساب؟ إنشاء حساب','New to ORIN? Create account'):t('لديك حساب؟ تسجيل الدخول','Already have an account? Sign in')}</a>
   <AppDownloadCard compact/>
  </form>
 </section>;
}
