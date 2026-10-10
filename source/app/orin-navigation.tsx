'use client';
import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {useOrin} from './orin-settings';
import {firebaseMode} from '@/lib/client-api';
import {navigateTo} from '@/lib/navigation';
import {haptic} from '@/lib/feedback';
import {safeDestination,sectionForPath,SECTION_ROUTES} from '@/lib/orin-routes';
type Nav={path:string;navigate:(path:string,replace?:boolean,state?:Record<string,unknown>)=>void;back:(fallback?:string)=>void};
const Context=createContext<Nav|null>(null);
export const OrinNavigationContext=Context;
export function OrinNavigation({children}:{children:ReactNode}){
 const [path,setPath]=useState(()=>typeof window==='undefined'||!firebaseMode()?'/':safeDestination(location.pathname));
 useEffect(()=>{const sync=()=>{setPath(safeDestination(location.pathname));requestAnimationFrame(()=>window.scrollTo(0,Number(history.state?.orinScroll??0)))};sync();addEventListener('popstate',sync);return()=>removeEventListener('popstate',sync)},[]);
 const navigate=useCallback((requested:string,replace=false,state:Record<string,unknown>={})=>navigateTo(safeDestination(requested),replace,state),[]);
 const back=useCallback((fallback='/')=>{if(Number(history.state?.orinDepth??0)>0)history.back();else navigate(fallback,true)},[navigate]);
 return <Context.Provider value={{path,navigate,back}}>{children}</Context.Provider>;
}
export function useNavigation(){const value=useContext(Context);if(!value)throw new Error('OrinNavigation required');return value;}
export function useSection(){const n=useNavigation(),{prefs}=useOrin();return [sectionForPath(n.path),(v:string)=>{haptic('selection',prefs);n.navigate(SECTION_ROUTES[v]??'/')}] as const;}
export function useRoutePanel<T extends string>(base:string,keys:readonly T[]){const n=useNavigation();const tail=n.path.startsWith(base+'/')?n.path.slice(base.length+1):'';const panel=keys.includes(tail as T)?tail as T:null;return [panel,(v:T|null)=>v?n.navigate(base+'/'+v):n.back(base)] as const;}
