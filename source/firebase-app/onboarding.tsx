import {useState} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,ChartNoAxesCombined,Headphones,Layers3,ShieldCheck,Wallet} from 'lucide-react';
import {useUi} from './ui';
import {to} from './account';
const KEY='orin-onboarding-v1';
export function onboardingSeen(){try{return localStorage.getItem(KEY)==='complete'}catch{return false}}
export function Onboarding({onDone}:{onDone:()=>void}){
 const {t,prefs}=useUi(),[step,setStep]=useState(0),rtl=prefs.chartLocale==='ar';
 const pages=[
  {tag:'A CLEARER PERSPECTIVE',title:t('الأسواق،\nبمنظورك أنت.','Markets.\nYour perspective.'),body:t('من العملات إلى الذهب. اختر الأصل الذي يهمك، وشاهد الصورة بوضوح.','From crypto to gold. Choose what matters to you and see the bigger picture.'),label:t('تابع الأسواق','Explore markets'),Icon:ChartNoAxesCombined},
  {tag:'YOUR SPACE. YOUR PACE.',title:t('كل حساب،\nفي مكانه.','Every account.\nIn its place.'),body:t('مساحة تجمع حساباتك وسجل نشاطك، مع فصل واضح بين الحساب الحقيقي والتجريبي.','Your accounts and activity together, with a clear separation between real and demo accounts.'),label:t('مساحتك الخاصة','Your workspace'),Icon:Wallet},
  {tag:'CONNECTED WITH ORIN',title:t('ابدأ رحلتك.\nابقَ على تواصل.','Start your journey.\nStay connected.'),body:t('إعداداتك تحت يدك، وطريق مباشر للتواصل مع فريق ORIN من داخل التطبيق.','Your settings within reach and a direct way to contact the ORIN team inside the app.'),label:t('أنت في ORIN','You’re with ORIN'),Icon:Headphones}
 ];const page=pages[step],last=step===pages.length-1;
 const finish=(path:string)=>{try{localStorage.setItem(KEY,'complete')}catch{}onDone();to(path,true)};
 return <main className="orin-onboarding orin-onboarding-v2" dir={rtl?'rtl':'ltr'}>
  <header className="intro-header"><span className="intro-brand"><img src="/brand/orin-mark.png" alt=""/><b>ORIN</b></span><button className="intro-skip" onClick={()=>finish('/login')}>{t('تخطي','Skip')}{rtl?<ArrowLeft size={15}/>:<ArrowRight size={15}/>}</button></header>
  <div className="intro-steps" aria-label={t('خطوات المقدمة','Introduction steps')}>{pages.map((p,i)=><button key={p.tag} aria-label={t('الخطوة ','Step ')+(i+1)} aria-current={i===step?'step':undefined} data-complete={i<step} onClick={()=>setStep(i)}/>)}</div>
  <section className="intro-scene" key={step} aria-live="polite">
   <div className={'intro-visual visual-'+step} aria-hidden="true"><div className="intro-glow"/><span className="intro-bigword">ORIN</span>
    {step===0?<><div className="intro-market-orbit"><img src="/brand/orin-mark.png" alt=""/></div><div className="intro-glass-chart"><span>BTC / USD<ArrowUpRight size={16}/></span><svg viewBox="0 0 300 110" fill="none"><path d="M0 94H300M0 56H300M0 18H300" stroke="currentColor" opacity=".12"/><path d="M6 89L38 75L64 84L94 50L128 63L159 37L190 50L224 19L252 31L294 7" stroke="#73e9e4" strokeWidth="3" strokeLinejoin="round"/><path d="M6 89L38 75L64 84L94 50L128 63L159 37L190 50L224 19L252 31L294 7V110H6Z" fill="#53dbdb" fillOpacity=".08"/></svg><small>CRYPTO · FOREX · GOLD</small></div><span className="intro-chip">XAU / USD</span></>:step===1?<><div className="intro-account-card back"><Layers3/><span>ORIN DEMO</span><b>•••• ••••</b></div><div className="intro-account-card front"><img src="/brand/orin-mark.png" alt=""/><span>ORIN ACCOUNT</span><b>USD</b><small>•••• ••••</small><ShieldCheck size={23}/></div></>:<><div className="intro-connect-ring"><img src="/brand/orin-mark.png" alt=""/></div><div className="intro-contact-card"><span><Headphones/></span><div><b>ORIN Support</b><small>{t('المحادثة، داخل مساحتك','Conversation in your space')}</small></div></div><div className="intro-security-pill"><ShieldCheck size={17}/>{t('حسابك. إعداداتك.','Your account. Your settings.')}</div></>}
   </div>
   <div className="intro-copy"><small>{page.tag}</small><h1>{page.title}</h1><p>{page.body}</p><span className="intro-feature"><page.Icon size={15}/>{page.label}</span></div>
  </section>
  <footer className="intro-footer"><button className="intro-primary" onClick={()=>last?finish('/register'):setStep(v=>v+1)}>{last?t('إنشاء حساب','Create account'):t('متابعة','Continue')}{rtl?<ArrowLeft size={20}/>:<ArrowRight size={20}/>}</button><button className="intro-login" onClick={()=>finish('/login')}>{t('لديك حساب؟','Already a member?')} <b>{t('تسجيل الدخول','Sign in')}</b></button></footer>
 </main>;
}
