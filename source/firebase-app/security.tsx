import {useEffect,useRef,useState} from 'react';
import {signOut,type User} from 'firebase/auth';
import {auth,fail,to} from './account';
import {passwordStrength} from '../lib/account-validation';
import {securityBackendConfigured,securityRequest,clearSecuritySession} from '../lib/account-security-client';
import type {SecurityState} from '../lib/account-security-types';
import {useUi} from './ui';
import {apiFetch} from '../lib/client-api';

export function Security({user}:{user:User}){
 const {t}=useUi(),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[visible,setVisible]=useState(false),[security,setSecurity]=useState<SecurityState|null>(null);
 const [resetStep,setResetStep]=useState(false),[challengeId,setChallengeId]=useState(''),[otpCode,setOtpCode]=useState('');
 const lock=useRef(false);

 useEffect(()=>{let alive=true;if(securityBackendConfigured())void securityRequest<SecurityState>('state').then(s=>{if(alive)setSecurity(s)}).catch(e=>{if(alive)setError((e as Error).message)});return()=>{alive=false}},[]);

 const startReset=async()=>{
  if(lock.current)return;
  lock.current=true;setBusy(true);setError('');setMessage('');
  try{
   const res=await apiFetch('/api/auth/reset/start',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:user.email})
   });
   const data=await res.json();
   setResetStep(true);
   setMessage(data.message||t('أرسلنا رمز التحديد إلى بريدك.','Verification code sent to your email.'));
  }catch(e){
   setError(fail(e));
  }finally{
   lock.current=false;setBusy(false);
  }
 };

 const confirmReset=async(e:React.FormEvent)=>{
  e.preventDefault();
  if(next.length<8||next!==confirm){setError(t('استخدم 8 أحرف على الأقل وتأكد من تطابق كلمة المرور.','Use at least 8 characters and matching passwords.'));return;}
  if(otpCode.trim().length!==6){setError(t('أدخل رمز التحقق المكون من 6 أرقام.','Enter 6-digit verification code.'));return;}

  lock.current=true;setBusy(true);setError('');
  try{
   const res=await apiFetch('/api/auth/reset/confirm',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
     email:user.email,
     challengeId,
     code:otpCode.trim(),
     newPassword:next
    })
   });
   const data=await res.json();
   if(!res.ok){
    throw new Error(data.error||fail({code:data.code}));
   }
   await clearSecuritySession();
   await signOut(auth);
   to('/login');
  }catch(e){
   setError((e as Error).message||fail(e));
  }finally{
   lock.current=false;setBusy(false);
  }
 };

 return <>
  <h1>{t('كلمة المرور والبريد','Password & email')}</h1>
  <section className="card form">
   <p dir="ltr">{user.email}</p>
   <strong>{t('البريد مؤكّد','Email verified')}</strong>
   {!resetStep ? (
    <button className="secondary" disabled={busy} onClick={()=>void startReset()}>
     {busy?t('جار الإرسال…','Sending…'):t('طلب رمز إعادة تعيين كلمة المرور','Request Password Reset Code')}
    </button>
   ) : (
    <form onSubmit={confirmReset} style={{display:'flex',flexDirection:'column',gap:'12px',marginTop:'12px'}}>
     <label>{t('رمز التحقق المرسل لبريدك','Verification Code Sent to Email')}
      <input
       type="text"
       inputMode="numeric"
       maxLength={6}
       placeholder="000000"
       dir="ltr"
       value={otpCode}
       onChange={e=>setOtpCode(e.target.value.replace(/\D/g,''))}
       required
       disabled={busy}
      />
     </label>
     <label>{t('كلمة المرور الجديدة','New Password')}
      <input type={visible?'text':'password'} dir="ltr" minLength={8} maxLength={128} value={next} required disabled={busy} onChange={e=>setNext(e.target.value)}/>
     </label>
     <meter min={0} max={4} value={passwordStrength(next)} aria-label={t('قوة كلمة المرور','Password strength')}/>
     <label>{t('تأكيد كلمة المرور الجديدة','Confirm New Password')}
      <input type={visible?'text':'password'} dir="ltr" minLength={8} maxLength={128} value={confirm} required disabled={busy} onChange={e=>setConfirm(e.target.value)}/>
     </label>
     <button className="primary" disabled={busy||otpCode.length!==6||!next}>{busy?t('جار الحفظ…','Saving…'):t('تأكيد وتغيير كلمة المرور','Confirm & Change Password')}</button>
    </form>
   )}
  </section>

  {message&&<div className="message" role="status">{message}</div>}
  {error&&<div className="message error" role="alert">{error}</div>}
  <a href="/settings/security">{t('العودة إلى مركز الأمان','Back to security center')}</a>
 </>;
}
