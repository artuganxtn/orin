'use client';
import {useEffect,useState} from 'react';
import {useOrin} from './orin-settings';
export function StartupBrand(){const [show,setShow]=useState(false),{prefs}=useOrin();useEffect(()=>{if(prefs.reduceMotion||matchMedia('(prefers-reduced-motion: reduce)').matches||!matchMedia('(display-mode: standalone)').matches)return;setShow(true);const timer=setTimeout(()=>setShow(false),650);return()=>clearTimeout(timer)},[]);return show?<div className="orin-startup" aria-hidden="true"><img src="/brand/orin-mark.png" alt=""/><strong>ORIN</strong></div>:null}
