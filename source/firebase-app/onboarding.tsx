import {useState} from 'react';
import {ArrowLeft,ArrowRight,ChevronLeft,ChevronRight} from 'lucide-react';
import {useUi} from './ui';
import {to} from './account';
import {EntryLanguageSelector} from './language-selector';
import './onboarding.css';

const KEY='orin-onboarding-v2';
export function onboardingSeen(){
  try{
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('intro') || sp.has('onboarding')) return false;
    }
    return localStorage.getItem(KEY)==='complete';
  }catch{
    return false;
  }
}

export function Onboarding({onDone}:{onDone:()=>void}){
 const {t,prefs}=useUi(),[step,setStep]=useState(0),rtl=prefs.chartLocale==='ar';
 const pages=[
  {
    id:'welcome',
    title:'ORIN',
    taglinePrimary:'Trade Smarter',
    taglineSecondary:'Live Better',
    body:t('تداول بذكاء، عِش أفضل','Trade Smarter\nLive Better'),
    art:null
  },
  {
    id:'markets',
    title:t('تداول بذكاء','Trade Smarter'),
    body:t('منصة متكاملة تمنحك أدوات احترافية لتداول أسهل وأفضل.','An integrated platform giving you professional tools for easier and better trading.'),
    art:'/onboarding/markets.svg'
  },
  {
    id:'security',
    title:t('أمان في كل خطوة','Security at Every Step'),
    body:t('نحمي بياناتك وأصولك بأعلى معايير الأمان والخصوصية.','We protect your data and assets with the highest standards of security and privacy.'),
    art:'/onboarding/security.svg'
  },
  {
    id:'connected',
    title:t('فرص عالمية','Global Opportunities'),
    body:t('الوصول إلى الأسواق العالمية في مكان واحد.','Access global markets in one place.'),
    art:'/onboarding/world.svg'
  }
 ];
 const page=pages[step],last=step===pages.length-1;
 const finish=(path:string)=>{try{localStorage.setItem(KEY,'complete')}catch{}onDone();to(path,true)};
 return <main className="orin-intro" dir={rtl?'rtl':'ltr'}>
  <div className="orin-intro-decoration" aria-hidden="true"/>
  <header className="orin-intro-header">
   <EntryLanguageSelector/>
   <div className="orin-intro-header-actions">
    {step>0&&step<pages.length-1&&<button type="button" className="orin-intro-back" onClick={()=>setStep(current=>Math.min(pages.length-1,current+1))} aria-label={t('التالي','Next')}>{rtl?<ChevronLeft size={21} aria-hidden="true"/>:<ChevronRight size={21} aria-hidden="true"/>}</button>}
    {step===0&&<button type="button" className="orin-intro-skip" onClick={()=>finish('/login')}>{t('تخطي','Skip')}</button>}
   </div>
  </header>
  <section className={'orin-intro-scene orin-intro-scene-'+page.id} key={page.id} aria-live="polite" aria-atomic="true" aria-labelledby={'orin-intro-title-'+page.id}>
   {step===0?<div className="orin-intro-brand">
    <img src="/brand/orin-mark.png" width={180} height={180} alt="ORIN"/>
    <h1 id={'orin-intro-title-'+page.id} dir="ltr">ORIN</h1>
    <div className="orin-intro-tagline" dir="ltr">
      <span>{page.taglinePrimary}</span>
      <span>{page.taglineSecondary}</span>
    </div>
    <span className="orin-intro-line" aria-hidden="true"/>
   </div>:<>
    <div className="orin-intro-art" aria-hidden="true"><img src={page.art!} width={360} height={360} alt="" draggable={false}/></div>
    <div className="orin-intro-copy"><h1 id={'orin-intro-title-'+page.id}>{page.title}</h1><p>{page.body}</p></div>
   </>}
  </section>
  <footer className="orin-intro-footer">
   <nav className="orin-intro-dots" aria-label={t('خطوات المقدمة','Introduction steps')} dir="ltr">{pages.map((item,index)=><button key={item.id} type="button" aria-label={t('الخطوة ','Step ')+(index+1)} aria-current={index===step?'step':undefined} onClick={()=>setStep(index)}><span/></button>)}</nav>
   {last?<div className="orin-intro-account-actions"><button type="button" className="orin-intro-create" onClick={()=>finish('/register')}>{t('إنشاء حساب','Create account')}</button><button type="button" className="orin-intro-signin" onClick={()=>finish('/login')}>{t('تسجيل الدخول','Sign in')}</button></div>:<div className="orin-intro-next-row"><button type="button" className="orin-intro-next" aria-label={t('التالي','Next')} onClick={()=>setStep(current=>Math.min(pages.length-1,current+1))}>{rtl?<ArrowLeft size={29} aria-hidden="true"/>:<ArrowRight size={29} aria-hidden="true"/>}</button></div>}
  </footer>
 </main>;
}

