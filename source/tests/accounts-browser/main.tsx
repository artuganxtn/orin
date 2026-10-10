import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BalanceAccounts} from '../../app/balance-accounts';
import {OrinSettingsProvider} from '../../app/orin-settings';
import {DEFAULT_PREFERENCES,DEFAULT_CONFIGURATION,CAPABILITIES} from '../../lib/preferences';
import {configureFirebaseTransport} from '../../lib/client-api';
import '../../app/globals.css';import '../../app/reference.css';import '../../app/quality.css';import '../../app/settings-system.css';import '../../app/orin-identity.css';import '../../app/reference-release.css';
const params=new URLSearchParams(location.search),language=params.get('lang')==='en'?'en':'ar',theme=params.get('theme')==='dark'?'dark':'light';
const preferences={...DEFAULT_PREFERENCES,chartLocale:language,theme};
let directory={accounts:[{id:'primary',accountNumber:'123456781060',type:'demo',currency:'USD',balanceCents:123450,reservedCents:0,realizedCents:50},{id:'test-real',accountNumber:'234567892221',type:'real',currency:'USD',balanceCents:0,reservedCents:0,realizedCents:0}],activeId:'primary'};
configureFirebaseTransport({token:async()=>null,onUnauthorized:()=>{},request:async(path,init)=>{
 if(path==='/api/trading-accounts'){
 const body=init.body?JSON.parse(String(init.body)):{};
 if(init.method==='PATCH')directory={...directory,activeId:body.id};
 if(init.method==='POST'&&!directory.accounts.some(a=>a.id===body.id))directory={...directory,accounts:[...directory.accounts,{id:body.id,accountNumber:String(345678900000+directory.accounts.length),type:body.type,currency:'USD',balanceCents:0,reservedCents:0,realizedCents:0}]};
 return Response.json(directory);
 }
 return Response.json({});
}});
const settings={preferences,profile:{displayName:'QA',phone:'',country:'',closureStatus:'open'},revision:0,configuration:DEFAULT_CONFIGURATION,configurationRevision:0,isAdmin:false,email:'qa@example.test',clientId:'test-only',updatedAt:0,capabilities:CAPABILITIES};
function Fixture(){const [state,setState]=useState({user:{id:'qa'},balanceCents:123450,reservedCents:0,realizedCents:50,accountDirectory:directory});return <OrinSettingsProvider initialSettings={settings as any}><div className="reference-shell" style={{width:'min(100%,390px)',margin:'auto'}}><div className="reference-home" style={{padding:17}}><BalanceAccounts state={state as any} onDirectoryChange={accountDirectory=>setState(old=>({...old,accountDirectory} as any))} onHideBalance={()=>{}} onTerms={()=>{}}/></div></div></OrinSettingsProvider>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
