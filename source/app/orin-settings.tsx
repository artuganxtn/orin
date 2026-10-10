'use client';
import {displayText} from '../lib/display-text';
import {apiFetch} from '@/lib/client-api';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {toast} from 'sonner';
import {translate} from '@/lib/locales';
import {DEFAULT_CONFIGURATION,DEFAULT_PREFERENCES,PREFERENCES_KEY,parsePreferences,type Preferences,type SettingsState,type MarketConfiguration,type AccountProfile} from '@/lib/preferences';

type SyncStatus='loading'|'guest'|'synced'|'saving'|'error';
type Context={prefs:Preferences;configuration:MarketConfiguration;settings:SettingsState|null;status:SyncStatus;error:string;marketReady:boolean;theme:'light'|'dark';t:(ar:string,en?:string)=>string;change:(patch:Partial<Preferences>)=>Promise<boolean>;saveProfile:(patch:Partial<AccountProfile>,close?:boolean)=>Promise<boolean>;saveConfiguration:(c:MarketConfiguration,revision:number)=>Promise<boolean>;reload:()=>Promise<void>;number:(n:number,digits?:number)=>string};
const OrinContext=createContext<Context|null>(null);
export function OrinSettingsProvider({children,initialSettings,onSettingsChange}:{children:ReactNode;initialSettings?:SettingsState;onSettingsChange?:(settings:SettingsState)=>void}){
 const [marketReady,setMarketReady]=useState(!!initialSettings);
 const [prefs,setPrefs]=useState(parsePreferences(initialSettings?.preferences??DEFAULT_PREFERENCES)),[configuration,setConfiguration]=useState(initialSettings?.configuration??DEFAULT_CONFIGURATION),[settings,setSettings]=useState<SettingsState|null>(initialSettings??null),[status,setStatus]=useState<SyncStatus>(initialSettings?'synced':'loading'),[error,setError]=useState(''),[theme,setTheme]=useState<'light'|'dark'>(()=>initialSettings?.preferences.theme==='dark'?'dark':'light');
 useEffect(()=>{if(settings)onSettingsChange?.(settings)},[settings,onSettingsChange]);
 const prefsRef=useRef(prefs),configRef=useRef(configuration),settingsRef=useRef(settings),saving=useRef(false),generation=useRef(0);
 const apply=useCallback((input:Preferences)=>{const p={...input,numberFormat:'latin' as const};prefsRef.current=p;setPrefs(p);try{localStorage.setItem(PREFERENCES_KEY,JSON.stringify(p));dispatchEvent(new Event('orin-ui-change'));}catch{}},[]);
 const receive=useCallback((s:SettingsState)=>{settingsRef.current=s;setSettings(s);setMarketReady(true);configRef.current=s.configuration;setConfiguration(s.configuration);apply(s.preferences);setStatus('synced');setError('');},[apply]);
 const reload=useCallback(async()=>{
  if(saving.current)return;const seq=++generation.current;
  try{const [configResponse,response]=await Promise.all([apiFetch('/api/markets/configuration',{cache:'no-store'}),apiFetch('/api/settings',{cache:'no-store'})]);const data=await response.json() as SettingsState & {error?:string};if(seq!==generation.current||saving.current)return;
   if(configResponse.ok){const configData=await configResponse.json() as {configuration:MarketConfiguration};configRef.current=configData.configuration;setConfiguration(configData.configuration);setMarketReady(true);}
   if(response.status===401){settingsRef.current=null;setSettings(null);setStatus('guest');setError(configResponse.ok?'':'تعذر تحميل إعدادات السوق / Market configuration unavailable');apply(parsePreferences(prefsRef.current,configRef.current));return;}
   if(!response.ok)throw new Error(data.error??'Settings unavailable');receive(data as SettingsState);
  }catch(e){if(seq!==generation.current)return;setStatus('error');setError(e instanceof Error?e.message:'Settings unavailable');}
 },[apply,receive]);
 useEffect(()=>{if(initialSettings)apply(initialSettings.preferences);else{try{apply(parsePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY)??'{}')));}catch{}void reload();}const interval=setInterval(()=>{if(!document.hidden&&navigator.onLine)void reload();},60000);const focus=()=>{if(!document.hidden&&navigator.onLine)void reload();};document.addEventListener('visibilitychange',focus);window.addEventListener('focus',focus);return()=>{generation.current++;clearInterval(interval);document.removeEventListener('visibilitychange',focus);window.removeEventListener('focus',focus);};},[apply,reload]);
 useEffect(()=>{const storage=(event:StorageEvent)=>{if(event.key!==PREFERENCES_KEY||!event.newValue||settingsRef.current)return;try{const next=parsePreferences(JSON.parse(event.newValue),configRef.current);prefsRef.current=next;setPrefs(next);}catch{}};window.addEventListener('storage',storage);return()=>window.removeEventListener('storage',storage);},[]);
 useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const update=()=>{const resolved=prefs.theme==='system'?(media.matches?'dark':'light'):prefs.theme;setTheme(resolved);const root=document.documentElement;root.dataset.theme=resolved;root.dataset.fontSize=prefs.fontSize;root.dataset.reduceMotion=String(prefs.reduceMotion);root.lang=prefs.chartLocale;root.dir=prefs.chartLocale==='ar'?'rtl':'ltr';};update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[prefs.theme,prefs.chartLocale,prefs.fontSize,prefs.reduceMotion]);
 const save=async(body:Record<string,unknown>)=>{
  if(saving.current||!settingsRef.current){toast.info(translate(prefsRef.current.chartLocale,'انتظر مزامنة الحساب أو سجّل الدخول.','Wait for account sync or sign in.'));return false;}
  saving.current=true;generation.current++;setStatus('saving');setError('');
  try{const response=await apiFetch('/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:settingsRef.current.revision,...body})}),data=await response.json() as SettingsState & {error?:string};if(!response.ok)throw new Error(data.error??'Save failed');receive(data);return true;}catch(e){const msg=e instanceof Error?e.message:'Save failed';setStatus('error');setError(msg);toast.error(msg);return false;}finally{saving.current=false;}
 };
 const change=async(patch:Partial<Preferences>)=>{if(status==='guest'){apply(parsePreferences({...prefsRef.current,...patch},configRef.current));return true;}const previous=prefsRef.current;apply(parsePreferences({...previous,...patch},configRef.current));const ok=await save({preferences:patch});if(!ok)apply(previous);return ok;};
 const saveProfile=(profile:Partial<AccountProfile>,close=false)=>save({...(!close?{profile}:{}),...(close?{closeAccount:true}:{})});
 const saveConfiguration=async(c:MarketConfiguration,revision:number)=>{
  if(!settingsRef.current?.isAdmin||saving.current)return false;saving.current=true;generation.current++;setStatus('saving');
  try{const response=await apiFetch('/api/markets/configuration',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,configuration:c})}),data=await response.json() as SettingsState & {error?:string};if(!response.ok)throw new Error(data.error??'Save failed');configRef.current=data.configuration;setConfiguration(data.configuration);apply(parsePreferences(prefsRef.current,data.configuration));setSettings(old=>old?{...old,configuration:data.configuration,configurationRevision:data.configurationRevision}:old);if(settingsRef.current)settingsRef.current={...settingsRef.current,configuration:data.configuration,configurationRevision:data.configurationRevision};setStatus('synced');setError('');return true;}catch(e){const msg=e instanceof Error?e.message:'Save failed';setStatus('error');setError(msg);toast.error(msg);return false;}finally{saving.current=false;}
 };
 const t=(ar:string,en?:string)=>displayText(translate(prefs.chartLocale,ar,en));
 const number=(n:number,digits=2)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n);
 return <OrinContext.Provider value={{prefs,configuration,settings,status,error,marketReady,theme,t,change,saveProfile,saveConfiguration,reload,number}}>{children}</OrinContext.Provider>;
}
export function useOrin(){const c=useContext(OrinContext);if(!c)throw new Error('OrinSettingsProvider is required');return c;}
