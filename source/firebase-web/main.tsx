import React,{useEffect,useState,type FormEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {Home,Users,Settings,ShieldCheck,LogOut,RefreshCw,UserRound,Mail,LockKeyhole,KeyRound} from 'lucide-react';
import {initializeApp} from 'firebase/app';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut,signInWithCustomToken,reload,type User} from 'firebase/auth';

import {firebaseConfig} from './config';
import {configureFirebaseTransport,signInUrl,apiFetch} from '../lib/client-api';
import {configureAccountSecurity,AccountSecurityError} from '../lib/account-security-client';
import './style.css';

const app=initializeApp(import.meta.env.VITE_FIREBASE_EMULATORS==='true'?{...firebaseConfig,projectId:'demo-orin-auth',apiKey:'fake-api-key'}:firebaseConfig);
const auth=getAuth(app);auth.languageCode='ar';

configureFirebaseTransport({token:async(force=false)=>{if(import.meta.env.VITE_E2E==='true'||(typeof window!=='undefined'&&window.location.search.includes('e2e=true')))return 'test-token-usr-auth-smoke-1:http-test-1@example.test';const u=auth.currentUser;if(!u)return null;return u.getIdToken(force)},onUnauthorized:()=>{if(location.pathname!=='/login')to('/login')},request:typeof window!=='undefined'&&(window as any).__ORIN_SPARK_REQUEST__?(path,init)=>(window as any).__ORIN_SPARK_REQUEST__(path,init):undefined});
configureAccountSecurity({base:import.meta.env.VITE_ORIN_SECURITY_API_URL,uid:()=>auth.currentUser?.uid??''});

function to(path:string){history.pushState(null,'',path);dispatchEvent(new PopStateEvent('popstate'))}
const fail=(e:unknown)=>{const code=(e as {code?:string})?.code??'';const messages:Record<string,[string,string]>={'auth/invalid-credential':['البريد أو كلمة المرور غير صحيحة.','Invalid email or password.'],'auth/wrong-password':['كلمة المرور غير صحيحة.','Wrong password.'],'auth/invalid-email':['أدخل بريدًا صحيحًا.','Invalid email.'],'code-invalid':['رمز التحقق غير صحيح.','Invalid verification code.']};return messages[code]?.[0]??'تعذرت العملية. حاول مجددًا.';};
const nextPath=()=>{try{const params=new URLSearchParams(location.search);return params.get('next')||params.get('return_to')||'/'}catch{return '/'}};

type Profile={uid:string;email:string;displayName:string;role:'user'|'admin';disabled:boolean};
async function fetchProfile():Promise<Profile>{
 const res=await apiFetch('/api/settings');if(!res.ok)throw new Error('تعذر تحميل بيانات الحساب.');
 const data=await res.json();
 return {
  uid: auth.currentUser?.uid || '',
  email: auth.currentUser?.email || '',
  displayName: data.profile?.displayName || auth.currentUser?.displayName || 'مستخدم ORIN',
  role: data.systemRole || 'user',
  disabled: data.disabled === true
 };
}

function App(){
 const [path,setPath]=useState(location.pathname),[user,setUser]=useState<User|null>(null),[profile,setProfile]=useState<Profile|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{const pop=()=>{setPath(location.pathname);setNotice('');setError('')};addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop)},[]);
 useEffect(()=>{let active=true,version=0;const stop=onAuthStateChanged(auth,u=>{const current=++version;setUser(u);setProfile(null);setError('');setReady(!u);if(!u)return;void fetchProfile().then(p=>{if(!active||current!==version)return;setProfile(p);setReady(true)}).catch(e=>{if(active&&current===version){setError(fail(e));setReady(true)}})});return()=>{active=false;version++;stop()}},[]);
 const logout=async()=>{try{await signOut(auth);setProfile(null);to('/login')}catch(e){setError(fail(e))}};
 const authed=user&&profile&&!profile.disabled;
 return <div className="shell"><header className="topbar"><a href="/" onClick={e=>{e.preventDefault();to('/')}} className="brand"><img src="/brand/orin-mark.png" alt=""/><b>ORIN</b></a><span>حسابك بأمان</span>{user&&<button className="icon" onClick={()=>void logout()} aria-label="تسجيل الخروج"><LogOut size={20}/></button>}</header><main>
 {error&&<div className="message error" role="alert">{error}{user&&!profile&&<button onClick={()=>location.reload()}>إعادة المحاولة</button>}</div>}{notice&&<div className="message" role="status">{notice}</div>}
 {!ready?<div className="empty" role="status"><span className="loader"/>جار تحميل حسابك…</div>:!user?<AuthForm path={path} done={()=>to(path==='/admin'?'/admin':nextPath())}/>:profile?.disabled?<section className="card empty"><ShieldCheck/><h1>الوصول إلى الحساب موقوف</h1><p>تواصل مع إدارة ORIN لمراجعة حالة حسابك.</p><button className="primary" onClick={()=>void logout()}>تسجيل الخروج</button></section>:!profile?<section className="card empty"><h1>تعذر تحميل بيانات الحساب</h1><button className="primary" onClick={()=>location.reload()}>إعادة المحاولة</button></section>:<>
 {path==='/admin'?(profile.role==='admin'?<Admin current={profile}/>:<section className="card empty"><ShieldCheck/><h1>هذه الصفحة للإدارة فقط</h1><p>لا يملك حسابك الحالي صلاحية إدارة المستخدمين.</p><button className="primary" onClick={()=>to('/')}>العودة لحسابي</button></section>):path==='/settings'?<ProfileEditor user={user} profile={profile}/>:<><section className="hero"><span>مرحبًا بك في ORIN</span><h1>{profile.displayName}</h1><p dir="ltr">{profile.email}</p><div className="hero-bottom"><span>{profile.role==='admin'?'حساب إدارة':'حساب مستخدم'}</span><span>الحساب نشط ✓</span></div></section><div className="quick"><button onClick={()=>to('/settings')}><UserRound/><span>بيانات الحساب</span></button><button onClick={()=>to('/settings')}><ShieldCheck/><span>الأمان</span></button>{profile.role==='admin'&&<button onClick={()=>to('/admin')}><Users/><span>إدارة المستخدمين</span></button>}</div><section className="card"><h2>حساب ORIN</h2><dl><div><dt>البريد</dt><dd dir="ltr">{profile.email}</dd></div><div><dt>الصلاحية</dt><dd>{profile.role==='admin'?'مدير':'مستخدم'}</dd></div></dl></section></>}
 </>}
 </main>{authed&&<nav className="bottom" aria-label="أقسام ORIN"><button aria-current={path==='/'?'page':undefined} onClick={()=>to('/')}><Home/><span>الرئيسية</span></button>{profile.role==='admin'&&<button aria-current={path==='/admin'?'page':undefined} onClick={()=>to('/admin')}><Users/><span>الإدارة</span></button>}<button aria-current={path==='/settings'?'page':undefined} onClick={()=>to('/settings')}><Settings/><span>الإعدادات</span></button></nav>}<footer>ORIN · حسابك وبياناتك</footer></div>
}

function AuthForm({path,done}:{path:string;done:()=>void}){
 const mode=path==='/register'?'register':path==='/forgot-password'?'reset':'login';
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false);
 const [otpStep,setOtpStep]=useState(false),[challengeId,setChallengeId]=useState(''),[code,setCode]=useState('');

 useEffect(()=>{setError('');setSent(false);setPassword('');setOtpStep(false);setCode('');setChallengeId('')},[mode]);

 async function submit(e:FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{
   if(mode==='reset'){
    if(!otpStep){
     const res=await apiFetch('/api/auth/reset/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim()})});
     setSent(true);setOtpStep(true);
    }else{
     const res=await apiFetch('/api/auth/reset/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim(),challengeId,code:code.trim(),newPassword:password})});
     const data=await res.json();
     if(!res.ok)throw new Error(data.error||'تعذر تعديل كلمة المرور');
     to('/login');
    }
   }else if(mode==='register'){
    if(!otpStep){
     const res=await apiFetch('/api/identity/send-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim(),name:name.trim()})});
     const data=await res.json();
     if(!res.ok)throw new Error(data.error||'تعذر إرسال كود التحقق');
     setChallengeId(data.challengeId);
     setOtpStep(true);
     if(data.fallbackCode)setCode(data.fallbackCode);
    }else{
     const res=await apiFetch('/api/identity/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim(),name:name.trim(),password,code:code.trim(),challengeId})});
     const data=await res.json();
     if(!res.ok)throw new Error(data.error||'كود التحقق غير صحيح');
     await signInWithCustomToken(auth,data.token);
     setPassword('');done();
    }
   }else{
    await signInWithEmailAndPassword(auth,email.trim(),password);
    setPassword('');done();
   }
  }catch(e:any){setError(e.message||fail(e))}finally{setBusy(false)}
 }

 return <section className="auth"><div className="auth-heading"><img src="/brand/orin-mark.png" alt="ORIN"/><h1>{otpStep?'تأكيد الكود المرسل لبريدك':mode==='register'?'إنشاء حساب':mode==='reset'?'استعادة كلمة المرور':'تسجيل الدخول'}</h1><p>{otpStep?'أدخل الكود المكون من 6 أرقام للبريد.':mode==='register'?'أنشئ حسابك وابدأ مع ORIN.':mode==='reset'?'سنرسل لك رمز التأكيد لإعادة تعيين كلمة المرور.':'مرحبًا بعودتك إلى ORIN.'}</p></div><form className="card form" onSubmit={submit}>{error&&<div className="message error" role="alert">{error}</div>}{otpStep?<><label>رمز التحقق (6 أرقام)<input type="text" inputMode="numeric" maxLength={6} dir="ltr" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} required/></label>{mode==='reset'&&<label>كلمة المرور الجديدة<input type="password" dir="ltr" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required/></label>}<button className="primary" disabled={busy||code.length!==6}>{busy?'جار التحقق…':'تأكيد ومتابعة'}</button></>:<>{mode==='register'&&<label>الاسم<input autoComplete="name" value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={100}/></label>}<label>البريد الإلكتروني<input type="email" dir="ltr" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={320}/></label>{mode!=='reset'&&<label>كلمة المرور<input type="password" dir="ltr" autoComplete={mode==='register'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={mode==='register'?8:1} required/><small>{mode==='register'?'8 أحرف على الأقل. استخدم كلمة مرور خاصة بهذا الحساب.':''}</small></label>}<button className="primary" disabled={busy}>{busy?'جار التنفيذ…':mode==='register'?'إرسال كود التأكيد':mode==='reset'?'إرسال كود الاستعادة':'دخول'}</button></>}{mode==='login'&&<a href="/forgot-password" onClick={e=>{e.preventDefault();to('/forgot-password')}}>نسيت كلمة المرور؟</a>}<a href={mode==='login'?'/register':'/login'} onClick={e=>{e.preventDefault();to(mode==='login'?'/register':'/login')}}>{mode==='login'?'ليس لديك حساب؟ إنشاء حساب':'العودة لتسجيل الدخول'}</a></form></section>
}

function ProfileEditor({user,profile}:{user:User;profile:Profile}){
 const [name,setName]=useState(profile.displayName),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 return <><h1>إعدادات الحساب</h1><form className="card form" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await apiFetch('/api/settings',{method:'POST',body:JSON.stringify({profile:{displayName:name.trim()}})});setMessage('حُفظت بياناتك.')}catch(e:any){setMessage(e.message||'تعذر حفظ البيانات.')}finally{setBusy(false)}}}><label>الاسم<input value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={100}/></label><label>البريد<input value={profile.email} readOnly dir="ltr"/></label><button className="primary" disabled={busy}>حفظ البيانات</button>{message&&<p role="status">{message}</p>}</form></>
}

function Admin({current}:{current:Profile}){
 const [users,setUsers]=useState<Profile[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(''),[edit,setEdit]=useState<Profile|null>(null);
 async function load(){setBusy(true);try{const data=await apiFetch('/api/admin/users');setUsers(data.users||[]);setError('')}catch(e:any){setError(e.message||'تعذر تحميل المستخدمين.')}finally{setBusy(false)}}useEffect(()=>{void load()},[]);
 const save=async()=>{if(!edit)return;setBusy(true);try{await apiFetch('/api/admin/users/'+edit.uid,{method:'PATCH',body:JSON.stringify({displayName:edit.displayName.trim(),role:edit.role,disabled:edit.disabled})});setEdit(null);await load()}catch(e:any){setError(e.message||'تعذر تعديل المستخدم.')}finally{setBusy(false)}};
 return <><div className="heading"><div><span className="eyebrow">ORIN ADMIN</span><h1>إدارة المستخدمين</h1></div><button className="icon" aria-label="تحديث المستخدمين" disabled={busy} onClick={()=>void load()}><RefreshCw size={20}/></button></div><p>إدارة بيانات الحساب وصلاحيات الوصول إلى ORIN.</p>{error&&<div className="message error" role="alert">{error}</div>}<label className="search">بحث في النتائج المعروضة<input placeholder="الاسم أو البريد الإلكتروني" value={search} onChange={e=>setSearch(e.target.value)}/></label>{busy&&<p role="status">جار التحميل…</p>}<div className="users">{users.filter(u=>(u.displayName+' '+u.email).toLowerCase().includes(search.toLowerCase())).map(u=><article className="card user" key={u.uid}><div><h2>{u.displayName}</h2><p dir="ltr">{u.email}</p><small>{u.role==='admin'?'مدير':'مستخدم'} · {u.disabled?'الوصول موقوف':'نشط'}</small></div><button className="secondary" disabled={u.uid===current.uid||busy} onClick={()=>setEdit({...u})}>{u.uid===current.uid?'حسابك':'إدارة'}</button></article>)}</div>{!busy&&!users.length&&!error&&<div className="card empty">لا يوجد مستخدمون بعد.</div>}{edit&&<section className="card form" aria-label="تأكيد تعديل المستخدم"><h2>تعديل {edit.email}</h2><label>الاسم<input value={edit.displayName} onChange={e=>setEdit({...edit,displayName:e.target.value})} maxLength={100}/></label><label>الصلاحية<select value={edit.role} onChange={e=>setEdit({...edit,role:e.target.value as Profile['role']})}><option value="user">user — مستخدم</option><option value="admin">admin — مدير</option></select></label><label className="check"><input type="checkbox" checked={edit.disabled} onChange={e=>setEdit({...edit,disabled:e.target.checked})}/>إيقاف الوصول إلى ORIN</label><p>صلاحية المدير تسمح بإدارة مستخدمي التطبيق. إيقاف الوصول يمنع استخدام حساب ORIN، ولا يحذف حساب Firebase.</p><div className="actions"><button className="primary" disabled={busy||!edit.displayName.trim()} onClick={()=>void save()}>تأكيد وحفظ</button><button className="secondary" disabled={busy} onClick={()=>setEdit(null)}>إلغاء</button></div></section>}</>
}

createRoot(document.getElementById('root')!).render(<App/>);
