'use client';
import {useState} from 'react';
import {Check, Globe2, Search, Type, Clock3, Wallet} from 'lucide-react';
import {LANGUAGES, type AppLocale} from '../lib/locales';
import {useOrin} from './orin-settings';
import type {Preferences} from '../lib/preferences';

export function LanguageOptions({value,query='',disabled=false,onChange}:{value:AppLocale;query?:string;disabled?:boolean;onChange:(v:AppLocale)=>void}) {
 const languages=LANGUAGES.filter(l=>[l.native,l.english,l.region,l.code].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <div className="orin-language-options" role="radiogroup" aria-label="Language">{languages.map(l=><label key={l.code} className={value===l.code?'is-selected':''}>
  <input type="radio" name="app-language" value={l.code} checked={value===l.code} disabled={disabled} onChange={()=>onChange(l.code)}/>
  <span className="language-monogram" aria-hidden="true">{l.code.toUpperCase()}</span><span className="language-name"><strong lang={l.code} dir={l.code==='ar'?'rtl':'ltr'}>{l.native}</strong><small dir="auto">{l.region}</small></span><span className="language-check" aria-hidden="true">{value===l.code&&<Check size={16}/>}</span>
 </label>)}</div>;
}
export function LanguageSettings({compact=false}:{compact?:boolean}={}) {
 const {prefs,change,t,status}=useOrin(),[query,setQuery]=useState(''),[notice,setNotice]=useState('');
 const busy=status==='saving'||status==='loading';
 const choose=async(chartLocale:AppLocale)=>{if(chartLocale===prefs.chartLocale)return;setNotice('');if(await change({chartLocale}))setNotice('saved');};
 return <section className="orin-language-settings">
  {!compact&&<><div className="language-intro"><span><Globe2 size={28}/></span><div><h2>{t('لغتك، تجربتك في ORIN','Your language, your ORIN')}</h2><p>{t('تُطبق التغييرات مباشرة وتُزامن مع حسابك.','Changes apply immediately and sync to your account.')}</p></div></div>
  <label className="language-search"><Search size={18}/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('ابحث عن لغة','Search languages')} aria-label={t('ابحث عن لغة','Search languages')}/></label></>}
  <LanguageOptions value={prefs.chartLocale} query={compact?'':query} disabled={busy} onChange={v=>void choose(v)}/>
  {!compact&&!LANGUAGES.some(l=>[l.native,l.english,l.region,l.code].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))&&<p className="language-empty">{t('لا توجد لغة مطابقة','No matching language')}</p>}
  <p className="language-saved" role="status" aria-live="polite">{notice==='saved'&&t('تم حفظ اللغة','Language saved')}</p>
  {!compact&&<><h3 className="settings-section-label">{t('التفضيلات الإقليمية','Regional preferences')}</h3>
  <div className="language-regional">
   <label><Type/><span>{t('حجم الخط','Font size')}</span><select disabled={busy} value={prefs.fontSize} onChange={e=>void change({fontSize:e.target.value as Preferences['fontSize']})}>{(['small','normal','large'] as const).map((v,i)=><option key={v} value={v}>{[t('صغير','Small'),t('متوسط','Default'),t('كبير','Large')][i]}</option>)}</select></label>
   <label><Clock3/><span>{t('المنطقة الزمنية','Time zone')}</span><select disabled={busy} value={prefs.timezone} onChange={e=>void change({timezone:e.target.value})}>{Array.from(new Set([prefs.timezone,Intl.DateTimeFormat().resolvedOptions().timeZone,'Etc/UTC','Europe/Istanbul','Europe/Berlin','Europe/Vienna','Europe/Zurich','Asia/Riyadh','Asia/Dubai','Asia/Damascus','Europe/London','America/New_York'])).map(z=><option key={z} value={z}>{z.replaceAll('_',' ')}</option>)}</select></label>
   <label><Wallet/><span>{t('العملة المرجعية','Reference currency')}</span><select disabled={busy} value={prefs.referenceCurrency} onChange={e=>void change({referenceCurrency:e.target.value as Preferences['referenceCurrency']})}>{['USD','EUR','GBP'].map(c=><option key={c}>{c}</option>)}</select></label>
  </div>
  <div className="language-preview"><span>{t('تنسيق الأرقام','Number format')}<small>{t('أرقام إنجليزية في جميع اللغات','Latin digits in all languages')}</small></span><bdi>1,234.56</bdi></div>
  <p className="language-footnote">{t('الأرصدة والتسوية بالدولار الأمريكي.','Balances and settlement are in USD.')}</p></>}
 </section>;
}
