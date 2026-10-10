'use client';
import {useContext,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {MessageCircleMore} from 'lucide-react';
import {WorkspaceVisibility} from './workspace-visibility';
import {useNavigation} from './orin-navigation';
import {useOrin} from './orin-settings';
export function SupportLauncher(){
 const visible=useContext(WorkspaceVisibility),{path,navigate}=useNavigation(),{t}=useOrin();
 const [ready,setReady]=useState(false),[keyboard,setKeyboard]=useState(false);
 useEffect(()=>{setReady(true);const viewport=window.visualViewport;const update=()=>setKeyboard(!!viewport&&window.innerHeight-viewport.height>150);viewport?.addEventListener('resize',update);update();return()=>viewport?.removeEventListener('resize',update)},[]);
 if(!ready||!visible||path==='/support'||keyboard)return null;
 return createPortal(<button type="button" className="orin-support-fab orin-support-fab-v3" aria-label={t('فتح محادثة دعم ORIN','Open ORIN support chat')} onClick={()=>navigate('/support')}><span className="support-fab-icon"><MessageCircleMore size={29} strokeWidth={1.8}/></span></button>,document.body);
}
