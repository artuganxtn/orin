'use client';
import {WorkspaceVisibility} from './workspace-visibility';
import {createContext,useContext,useEffect,useId,useRef,useState,type ReactNode,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,X} from 'lucide-react';
import {useOrin} from './orin-settings';
const Context=createContext<{open:boolean;onOpenChange:(open:boolean)=>void}>({open:false,onOpenChange:()=>{}});
export function FullPage({open,onOpenChange,children}:{open:boolean;onOpenChange:(open:boolean)=>void;children:ReactNode}){const visible=useContext(WorkspaceVisibility);return <Context.Provider value={{open:open&&visible,onOpenChange}}>{children}</Context.Provider>}
export function FullPageContent({children,className='',dir,pageClassName='',navTitle,navActions,closeButton=false}:{children:ReactNode;className?:string;dir?:'rtl'|'ltr';side?:string;style?:CSSProperties;pageClassName?:string;navTitle?:ReactNode;navActions?:ReactNode;closeButton?:boolean}){
 const {open,onOpenChange}=useContext(Context),{t,prefs}=useOrin();const [ready,setReady]=useState(false);const el=useRef<HTMLElement>(null);const id=useId();
 useEffect(()=>setReady(true),[]);
 useEffect(()=>{if(!open||!ready)return;const focus=document.activeElement as HTMLElement|null;const shell=document.querySelector<HTMLElement>('.app-shell');const overflow=document.body.style.overflow;document.body.style.overflow='hidden';if(shell)shell.inert=true;el.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>{document.body.style.overflow=overflow;if(shell)shell.inert=false;focus?.focus()}},[open,ready]);
 if(!open||!ready)return null;
 return createPortal(<section ref={el} className={'orin-full-page '+pageClassName} dir={dir??(prefs.chartLocale==='ar'?'rtl':'ltr')} aria-label={t('صفحة ORIN','ORIN page')} data-page-id={id}><div className="orin-page-inner"><nav className="orin-page-nav"><button onClick={()=>onOpenChange(false)} aria-label={closeButton?t('إغلاق','Close'):t('رجوع','Back')}>{closeButton?<X strokeWidth={1.6}/>:prefs.chartLocale==='ar'?<ArrowRight/>:<ArrowLeft/>}</button>{navTitle??<><span>ORIN</span><img src="/brand/orin-mark.png" alt="" width="30" height="30"/></>}{navActions}</nav><div className={'orin-page-content '+className.replace(/\b(popup|settings-dialog|admin-settings-dialog|chart-tools-dialog|favorites-dialog)\b/g,'')}>{children}</div></div></section>,document.body);
}
export function FullPageHeader({children}:{children:ReactNode;style?:CSSProperties}){return <header className="orin-page-heading">{children}</header>}
export function FullPageTitle({children}:{children:ReactNode;className?:string}){return <h1 tabIndex={-1}>{children}</h1>}
export function FullPageDescription({children}:{children:ReactNode;className?:string}){return <p>{children}</p>}
