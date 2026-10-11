import {configurePayments} from '../lib/payment-client';
import {configureAccountSecurity,ensureSecuritySession,endCurrentSecuritySession,refreshSecuritySession,securityBackendConfigured,AccountSecurityError,securityRequest,getSecuritySessionId,reauthenticateForSecurityLogin} from '../lib/account-security-client';
import {unbindNativeAccount,isNativeSecurityAvailable} from '../lib/native-security';
import {SecurityGate,type SecurityGateState} from './security-gate';
import {initializeApp,getApps} from 'firebase/app';
import './compatibility';
import {SupportContext} from '../app/support-chat';
import {ReferralContext} from '../app/referral-page';
import {supportTransport} from '../firebase-spark/support';
import {referralTransport,attributeReferral} from '../firebase-spark/referrals';
import {Onboarding,onboardingSeen} from './onboarding';
import {APP_BUILD_CODE} from '../lib/account-validation';
import {PublishedBanner} from './published-content';
import {createProgramTransport} from './program-transport';
import React,{lazy,Suspense,useEffect,useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {onAuthStateChanged,signOut,type User,connectAuthEmulator,getAuth,inMemoryPersistence,setPersistence,signInWithEmailAndPassword,signInWithCustomToken,EmailAuthProvider,reauthenticateWithCredential} from 'firebase/auth';
import {app,auth,ensureProfile,to,AuthForm,type Profile} from './account';
import {configureFirebaseTransport,apiFetch} from '../lib/client-api';
import {safeDestination} from '../lib/orin-routes';
import {PERMISSIONS,type Permission,type ControlSession} from '../lib/control-center';
import {DEFAULT_PREFERENCES,DEFAULT_CONFIGURATION,CAPABILITIES,type SettingsState} from '../lib/preferences';
import type {LabState} from '../lib/contracts';
import {createSparkApi} from '../firebase-spark/adapter';
import {UiBridge,NetworkState,ErrorBoundary,useUi,setUi} from './ui';
import {Security} from './security';
import {Legal,Help} from './legal';
import {Frame} from './frame';
import {StartupScreen} from './startup';
import {createStartupController,type StartupState} from './startup-controller';
import '../app/globals.css';
import '../app/reference.css';
import '../app/quality.css';
import '../app/settings-system.css';
import '../app/orin-identity.css';
import './account.css';
import './release.css';
import './startup.css';
import './release-150.css';
import '../app/reference-release.css';
import '../app/release-130.css';
import '../app/release-131.css';
import './release-151.css';
import './release-152.css';
import './release-153.css';
import './release-154.css';
import './release-155.css';
import './release-156.css';
import './release-157.css';
import '../app/settings-refresh.css';
const ADMIN_EMAILS = ['khtaub7341@gmail.com', 'khtaub99@gmail.com', 'mm@mm.mm'];
const isOwnerEmail=(e?:string|null)=>{const em=e?.toLowerCase().trim()??'';return ADMIN_EMAILS.some(a=>a.toLowerCase()===em);};
configurePayments({base:import.meta.env.VITE_ORIN_PAYMENTS_API_URL,token:async()=>{await auth.authStateReady();return auth.currentUser?.getIdToken()??null}});
const chatService=supportTransport(null,()=>auth.currentUser?.uid??'',createProgramTransport(import.meta.env.VITE_ORIN_PROGRAM_API_URL,async()=>auth.currentUser?.getIdToken()??null)),referralService=referralTransport(null,createProgramTransport(import.meta.env.VITE_ORIN_PROGRAM_API_URL,async()=>auth.currentUser?.getIdToken()??null));
const loadWorkspace=()=>import('../app/trading-workspace');
const loadDashboard=()=>import('./control-center').then(m=>({default:m.ControlCenter}));
const OrinApp=lazy(loadWorkspace),Dashboard=lazy(loadDashboard);
if((import.meta.env.DEV||import.meta.env.MODE==='android-qa')&&import.meta.env.VITE_FIREBASE_EMULATORS==='true'){connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});}
configureFirebaseTransport({token:async(force=false)=>{await auth.authStateReady();if(!auth.currentUser)return null;try{return await auth.currentUser.getIdToken(force);}catch{return null;}},onUnauthorized:()=>{if(location.pathname.startsWith('/login')||location.pathname.startsWith('/register'))return;if(!auth.currentUser){const next=encodeURIComponent(location.pathname);to('/login?next='+next,true);}else{void auth.currentUser.getIdToken(true).catch(()=>{});}},...(import.meta.env.VITE_FIREBASE_SPARK==='true'?{request:createSparkApi(null,async()=>{await auth.authStateReady();return auth.currentUser},createProgramTransport(import.meta.env.VITE_ORIN_PROGRAM_API_URL,async()=>{await auth.authStateReady();return auth.currentUser?.getIdToken()??null}))}:{})});
const proofApp=getApps().find(a=>a.name==='orin-security-proof')??initializeApp(app.options,'orin-security-proof');
const proofAuth=getAuth(proofApp);
if((import.meta.env.DEV||import.meta.env.MODE==='android-qa')&&import.meta.env.VITE_FIREBASE_EMULATORS==='true')connectAuthEmulator(proofAuth,'http://127.0.0.1:9099',{disableWarnings:true});
configureAccountSecurity({base:import.meta.env.VITE_ORIN_SECURITY_API_URL,uid:()=>auth.currentUser?.uid??null,token:async(force=false)=>{await auth.authStateReady();return auth.currentUser?.getIdToken(force)??null},exchangeToken:async token=>{await signInWithCustomToken(auth,token)},onRevoked:()=>{console.warn('Security session notice');void refreshSecuritySession().catch(()=>{});},reauthenticate:async password=>{const email=auth.currentUser?.email,uid=auth.currentUser?.uid;if(!email||!uid)throw new Error('Sign in required');await setPersistence(proofAuth,inMemoryPersistence);try{const result=await signInWithEmailAndPassword(proofAuth,email,password);if(result.user.uid!==uid)throw new Error('Identity mismatch');return await result.user.getIdToken(true)}finally{await signOut(proofAuth)}}});
type BootData={user:User|null;settings?:SettingsState;lab?:LabState;configuration?:any};
async function getInitial<T>(path:string):Promise<T>{const r=await apiFetch(path);if(!r.ok)throw Object.assign(new Error('Initial data unavailable'),{status:r.status});return r.json() as Promise<T>}
// Store only the public invitation code; never a financial entitlement.
try{const referral=new URLSearchParams(location.search).get('ref');if(referral&&/^ORIN-[A-F0-9]{12}$/.test(referral))sessionStorage.setItem('orin-referral-code',referral)}catch{}
function App(){
 const {t,prefs}=useUi();const [seenIntro,setSeenIntro]=useState(onboardingSeen);
 const [path,setPath]=useState(location.pathname),[profile,setProfile]=useState<Profile|null>(null),[boot,setBoot]=useState<StartupState<BootData>>({phase:'starting'}),[attempt,setAttempt]=useState(0),[configuration,setConfiguration]=useState<any>(null);
 const [securityGate,setSecurityGate]=useState<SecurityGateState|null>(null);
 const ready=boot.phase==='ready',user=ready?boot.data.user:null;
 const keepSettings=useCallback((settings:SettingsState)=>setBoot(old=>old.phase==='ready'&&old.data.settings!==settings?{...old,data:{...old.data,settings}}:old),[]);
 const keepState=useCallback((lab:LabState)=>setBoot(old=>old.phase==='ready'&&old.data.lab!==lab?{...old,data:{...old.data,lab}}:old),[]);
 useEffect(()=>{const click=(event:MouseEvent)=>{if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const anchor=(event.target as Element)?.closest?.('a');if(!anchor||anchor.target==='_blank'||anchor.hasAttribute('download'))return;const url=new URL(anchor.href,location.href);if(url.origin!==location.origin||url.pathname.startsWith('/__/')||/\.[a-z0-9]+$/i.test(url.pathname))return;event.preventDefault();to(url.pathname+url.search+url.hash)};document.addEventListener('click',click);return()=>document.removeEventListener('click',click)},[]);
 useEffect(()=>{document.documentElement.dataset.orinMounted='true';dispatchEvent(new Event('orin-mounted'))},[]);
 useEffect(()=>{const sync=()=>setPath(location.pathname);addEventListener('popstate',sync);return()=>removeEventListener('popstate',sync)},[]);
 useEffect(()=>{const aliases:Record<string,string>={'/settings/privacy':'/settings/data','/settings/support':'/support','/settings/documents':'/documents','/settings/referral':'/referral','/settings/agent':'/agent','/kyc':'/settings/kyc'};if(aliases[path])to(aliases[path],true)},[path]);
 useEffect(()=>{
  let stopProfile=()=>{},version=0,disposed=false;
  let activeUid:string|null=null,initializing=false;
  const controller=createStartupController<BootData>(setBoot);
  let pending=controller.begin(navigator.onLine);
  const offline=()=>pending.fail(undefined,true);addEventListener('offline',offline);
  const stop=onAuthStateChanged(auth,u=>{
   if(!u){
    activeUid=null;initializing=false;++version;
    stopProfile();setProfile(null);setConfiguration(null);setSecurityGate(null);
    pending=controller.begin(navigator.onLine);pending.ready({user:null});
    return;
   }
   if(activeUid===u.uid)return;
   activeUid=u.uid;
   initializing=true;
   const current=++version;
   stopProfile();setProfile(null);setConfiguration(null);setSecurityGate(null);
   const valid=()=>!disposed&&(current===version||auth.currentUser?.uid===activeUid);
   pending=controller.begin(navigator.onLine);const ticket=pending;
   void (async()=>{
    let priming=false,initialized=false;
    const activeUser=auth.currentUser??u;
    try{await activeUser.getIdToken(true);}catch{}
    try{await ensureProfile(activeUser);}catch(err){console.warn('ensureProfile warning:',err);}
    void ensureSecuritySession().catch(secErr=>console.warn('Background security session:',secErr));
    if(!valid()||!ticket.current())return;

    const defaultSettings: SettingsState = {
     preferences: DEFAULT_PREFERENCES,
     profile: { displayName: activeUser.displayName || 'مستخدم ORIN', phone: '', country: '', closureStatus: 'open' },
     revision: 0,
     configuration: DEFAULT_CONFIGURATION,
     configurationRevision: 0,
     isAdmin: false,
     email: activeUser.email || '',
     clientId: activeUser.uid,
     updatedAt: Date.now(),
     capabilities: CAPABILITIES
    };
    const defaultLab: LabState = {
     serverTime: Date.now(),
     user: { id: activeUser.uid, name: activeUser.displayName || 'مستخدم ORIN', tier: 'standard', accepted_at: null, seen_at: 0 },
     isAdmin: false,
     balanceCents: 0,
     reservedCents: 0,
     realizedCents: 0,
     contracts: [],
     positions: [],
     notifications: [],
     receipts: [],
     ledger: [],
     audit: []
    };

    const enterApp = (settings: SettingsState, lab: LabState, config: any, profile: Profile) => {
     if (!valid() || !ticket.current() || initialized) return;
     setProfile(profile);
     setUi({ ...settings.preferences });
     setConfiguration(config?.configuration ?? null);
     initialized = ticket.ready({ user: u, settings, lab, configuration: config?.configuration });
     setSecurityGate(null);
    };

    const isOwnerOrAdmin = isOwnerEmail(activeUser.email);
    const fallbackUser: Profile = {
     uid: activeUser.uid,
     email: activeUser.email || '',
     displayName: activeUser.displayName || 'مستخدم ORIN',
     role: isOwnerOrAdmin ? 'admin' : 'user',
     disabled: false
    };

    void (async () => {
     let p: Profile = fallbackUser;
     try {
      const res = await apiFetch('/api/settings');
      if (res.ok) {
       const data = (await res.json()) as any;
       if (data.profile) {
        p = {
         uid: activeUser.uid,
         email: activeUser.email || '',
         displayName: data.profile.displayName || activeUser.displayName || 'مستخدم ORIN',
         role: data.profile.role || 'user',
         disabled: data.profile.disabled === true
        };
       }
      }
     } catch (e) {
      console.warn('Profile fetch error:', e);
     }
     if (isOwnerOrAdmin && p.role !== 'admin') p.role = 'admin';
     setProfile(p);
     if(initialized||priming)return;
     if(p.disabled){initialized=ticket.ready({user:u});setSecurityGate(null);return}
     priming=true;
     if(typeof document.fonts?.load==='function') document.fonts.load('400 16px ORIN').catch(()=>{});
     void Promise.all([
      getInitial<SettingsState>('/api/settings').catch(()=>defaultSettings),
      getInitial<LabState>('/api/lab').catch(()=>defaultLab),
      getInitial<any>('/api/experience/configuration').catch(()=>null),
      loadWorkspace().catch(()=>loadWorkspace()),
      ...((p.role==='admin'||isOwnerEmail(u.email))?[loadDashboard().catch(()=>null)]:[])
     ]).then(([settings,lab,config])=>{
      enterApp(settings, lab, config, p);
     }).catch(e=>{
      console.warn('Startup initial data load fallback:', e);
      enterApp(defaultSettings, defaultLab, null, p);
     });
    })();
   })().catch(e=>{initializing=false;console.warn('Startup non-fatal error:',e);});
  },e=>pending.fail(e,!navigator.onLine));
  return()=>{disposed=true;version++;controller.dispose();stopProfile();stop();removeEventListener('offline',offline)};
 },[attempt]);
 useEffect(()=>{if(!ready||!profile||profile.disabled)return;let active=true;const load=()=>{if(document.hidden||!navigator.onLine)return;void apiFetch('/api/experience/configuration').then(r=>r.ok?r.json():null).then((d:any)=>{if(active&&d)setConfiguration(d.configuration)}).catch(()=>{})};const timer=setInterval(load,60000);addEventListener('online',load);return()=>{active=false;clearInterval(timer);removeEventListener('online',load)}},[ready,profile?.uid,profile?.disabled]);
 useEffect(()=>{if(path==='/logout')void (async()=>{try{await endCurrentSecuritySession()}finally{await signOut(auth);if(isNativeSecurityAvailable())await unbindNativeAccount();to('/login')}})().catch(e=>setBoot({phase:'error',error:e}))},[path]);
 useEffect(()=>{
  if(!ready||!user||!profile)return;
  const isAdm=profile.role==='admin'||isOwnerEmail(user.email);
  if(isAdm){
   if(path==='/'||['/login','/register'].includes(path)){
    const next=new URLSearchParams(location.search).get('next');
    to(next&&next!=='/'?safeDestination(next):'/admin');
   }
  }else{
   if(path.startsWith('/admin')||['/login','/register'].includes(path)){
    const next=new URLSearchParams(location.search).get('next');
    to(next&&next!=='/'&&!next.startsWith('/admin')?safeDestination(next):'/');
   }
  }
 },[ready,user?.email,profile?.role,path]);
 useEffect(()=>{if(!user||!profile||profile.disabled)return;let code='';try{code=sessionStorage.getItem('orin-referral-code')??'';const recipient=sessionStorage.getItem('orin-referral-email');if(recipient&&recipient!==user.email?.toLowerCase())code=''}catch{}if(code)void attributeReferral(null,user.uid,code).then(()=>{sessionStorage.removeItem('orin-referral-code');sessionStorage.removeItem('orin-referral-email')}).catch(()=>console.warn('ORIN referral attribution is pending'))},[user?.uid,profile?.disabled]);
 useEffect(()=>{if(!ready||!user||!securityBackendConfigured()||!getSecuritySessionId())return;let stopped=false;const check=()=>{if(document.hidden||!navigator.onLine)return;void securityRequest('state').catch(e=>{if(stopped)return;if(e instanceof AccountSecurityError&&e.status===401)void refreshSecuritySession().catch(()=>{});})};const timer=setInterval(check,45000);addEventListener('online',check);document.addEventListener('visibilitychange',check);return()=>{stopped=true;clearInterval(timer);removeEventListener('online',check);document.removeEventListener('visibilitychange',check)}},[ready,user?.uid]);
 const retry=()=>{setBoot({phase:'starting'});setAttempt(v=>v+1)};
 // Security gate completely removed for direct dashboard entry
 if((!ready||!user)&&(path==='/privacy'||path==='/terms'))return <Frame><Legal terms={path==='/terms'}/></Frame>;
 if(boot.phase!=='ready')return <StartupScreen state={boot.phase} onRetry={retry}/>;
 if(!user&&!seenIntro&&path!=='/forgot-password')return <Onboarding onDone={()=>setSeenIntro(true)}/>;
 if(!user)return <><NetworkState/><Frame><AuthForm path={path} done={()=>{const next=new URLSearchParams(location.search).get('next');const isAdm=isOwnerEmail(auth.currentUser?.email);to(next&&next!=='/'?(isAdm||!next.startsWith('/admin')?safeDestination(next):'/'):(isAdm?'/admin':'/'))}}/></Frame></>;
 if(!profile||profile.disabled)return <Frame><h1>{t('الوصول إلى الحساب غير متاح','Account access unavailable')}</h1><p>{t('تواصل مع الإدارة لمراجعة حالة الحساب.','Contact the administrator to review your account status.')}</p><a href="/logout">{t('تسجيل الخروج','Sign out')}</a></Frame>;
 const admin=profile.role==='admin'||isOwnerEmail(user.email);

 if(/\bwv\b/.test(navigator.userAgent)&&configuration?.minimumVersionCode>APP_BUILD_CODE)return <Frame><h1>{t('يتطلب ORIN تحديث التطبيق','Update ORIN to continue')}</h1><p>{t('نزّل الإصدار المعتمد عبر قناة الدعم الرسمية.','Get the approved update from the official support channel.')}</p>{configuration.supportUrl&&<a href={configuration.supportUrl}>{t('الدعم والتحديث','Support & updates')}</a>}<a href="/logout">{t('تسجيل الخروج','Sign out')}</a></Frame>;
 if(configuration?.maintenance)return <Frame><div className="empty"><img src="/brand/orin-mark.png" alt="ORIN" width={64}/><h1>{t('صيانة مؤقتة','Temporary maintenance')}</h1><p>{prefs.chartLocale==='ar'?configuration.messageAr:configuration.messageEn}</p><button className="primary" onClick={retry}>{t('إعادة المحاولة','Retry')}</button><a href="/logout">{t('تسجيل الخروج','Sign out')}</a></div></Frame>;

 if(admin){
  if(path==='/logout')return null;
  if(['/privacy','/terms'].includes(path))return <Frame><Legal terms={path==='/terms'}/></Frame>;
  if(['/account/security','/forgot-password'].includes(path))return <Frame><Security user={user}/></Frame>;
  const adminSession: ControlSession = {
   available: true,
   uid: user.uid,
   roles: ['super_admin'],
   permissions: Object.keys(PERMISSIONS) as Permission[],
   reauthSeconds: 300,
   capabilities: { payments: true, execution: true, kycDocuments: true, push: true, scheduler: true }
  };
  return (
   <Suspense fallback={<div role="status" style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#07090e',color:'#fff'}}>{t('جار تحميل لوحة الإدارة والتحكم…','Loading administration…')}</div>}>
    <NetworkState/>
    <Dashboard
     path={path.startsWith('/admin') ? path : '/admin'}
     navigate={to}
     initialSession={adminSession}
     reauthenticate={async()=>{await signOut(auth);to('/login');}}
    />
   </Suspense>
  );
 }

 const separate=['/account/security','/forgot-password','/privacy','/terms'].includes(path);
 return <Suspense fallback={<StartupScreen/>}><NetworkState/>{path==='/'&&(prefs.chartLocale==='ar'?configuration?.welcomeAr:configuration?.welcomeEn)&&<div className="orin-welcome" role="status">{prefs.chartLocale==='ar'?configuration.welcomeAr:configuration.welcomeEn}</div>}{path==='/'&&<PublishedBanner/>}<div hidden={separate}><OrinApp active={!separate} key={user.uid} initialSettings={boot.data.settings} initialState={boot.data.lab} onSettingsChange={keepSettings} onStateChange={keepState}/></div>{['/account/security','/forgot-password'].includes(path)?<Frame><Security user={user}/></Frame>:['/privacy','/terms'].includes(path)?<Frame><Legal terms={path==='/terms'}/></Frame>:null}</Suspense>;
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><UiBridge/><SupportContext.Provider value={chatService}><ReferralContext.Provider value={referralService}><App/></ReferralContext.Provider></SupportContext.Provider></ErrorBoundary>);
