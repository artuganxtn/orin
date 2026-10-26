import {useEffect,useRef} from 'react';
import {Check,ChevronDown,Globe2} from 'lucide-react';
import {LANGUAGES,localeDirection,translate,type AppLocale} from '../lib/locales';
import {setUi,useUi} from './ui';
import './language-selector.css';

/** Uses the existing locale catalog. No language is offered without app support. */
export function LanguageSelector({value,onChange,disabled=false}:{value:AppLocale;onChange:(locale:AppLocale)=>void;disabled?:boolean}){
 const menu=useRef<HTMLDetailsElement>(null),trigger=useRef<HTMLElement>(null);
 const selected=LANGUAGES.find(language=>language.code===value)??LANGUAGES[1];
 const label=translate(value,'لغة التطبيق','App language');
 useEffect(()=>{
  const close=(event:Event)=>{
   if(!menu.current?.open)return;
   if(event.type==='keydown'){
    if((event as KeyboardEvent).key!=='Escape')return;
    if(menu.current.contains(document.activeElement))trigger.current?.focus();
   }else if(menu.current.contains(event.target as Node))return;
   menu.current.open=false;
  };
  document.addEventListener('pointerdown',close);
  document.addEventListener('keydown',close);
  return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close)};
 },[]);
 return <details className="orin-entry-language" ref={menu} dir={localeDirection(value)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))event.currentTarget.open=false}}>
  <summary ref={trigger} aria-label={label+': '+selected.native} aria-disabled={disabled||undefined} onClick={event=>{if(disabled)event.preventDefault()}}>
   <Globe2 size={23} aria-hidden="true"/><span lang={selected.code} dir={localeDirection(selected.code)}>{selected.native}</span><ChevronDown size={16} aria-hidden="true"/>
  </summary>
  <div className="orin-entry-language-options" role="group" aria-label={label}>
   {LANGUAGES.map(language=><button key={language.code} type="button" disabled={disabled} aria-pressed={language.code===value} onClick={()=>{onChange(language.code);if(menu.current)menu.current.open=false;trigger.current?.focus()}}>
    <span className="orin-entry-language-check" aria-hidden="true">{language.code===value&&<Check size={18}/>}</span><span lang={language.code} dir={localeDirection(language.code)}>{language.native}</span>
   </button>)}
  </div>
 </details>;
}

/** Pre-auth choice is persisted by the original preferences store. */
export function EntryLanguageSelector(){
 const {prefs}=useUi();
 return <LanguageSelector value={prefs.chartLocale} onChange={chartLocale=>setUi({chartLocale})}/>;
}
