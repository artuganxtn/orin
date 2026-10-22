'use client';
import {AccountTransfer} from './account-transfer';
import {PositionsPanel} from './positions-panel';
import type {AccountDirectory} from '@/lib/trading-accounts';
import {AccountTransactions,saveStatement} from './account-transactions';
import {statementSnapshot} from '@/lib/account-transactions';
import {FundingPanel} from './funding-panel';
import {SupportLauncher} from './support-launcher';
import {WorkspaceVisibility} from './workspace-visibility';
import {displayText} from '../lib/display-text';
import {scopeAccountState} from '@/lib/account-scope';
import {activeTradingAccount} from '@/lib/trading-accounts';
import {firebaseMode,sparkMode,signInUrl,signOutUrl} from '@/lib/client-api';
import {apiFetch} from '@/lib/client-api';
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {StartupBrand} from './startup-brand';
import {haptic} from '@/lib/feedback';
import {Headphones,Home,Settings,BriefcaseBusiness,Activity,ChartNoAxesCombined,UserRound,Layers3,ArrowDownUp,Bell,BookOpen,Check,CheckCheck,CheckCircle2,ChevronDown,ClipboardList,Clock3,Copy,Download,FileCheck2,FileText,FlaskConical,Globe2,Info,KeyRound,Landmark,LockKeyhole,LogIn,Plus,Radio,RefreshCw,Share2,ShieldCheck,Timer,Wallet,WifiOff,X} from "lucide-react";
import {Tabs,TabsList,TabsTrigger,TabsContent} from "@/components/ui/tabs";
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from "@/components/ui/select";
import {FullPage as Dialog,FullPageContent as DialogContent,FullPageHeader as DialogHeader,FullPageTitle as DialogTitle,FullPageDescription as DialogDescription} from "./full-page";
import {FullPage as Sheet,FullPageContent as SheetContent,FullPageHeader as SheetHeader,FullPageTitle as SheetTitle,FullPageDescription as SheetDescription} from "./full-page";
import {Checkbox} from "@/components/ui/checkbox";
import {Progress} from "@/components/ui/progress";
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from "@/components/ui/table";
import {Toaster} from "@/components/ui/sonner";
import {toast} from "sonner";
import {OrinSettingsProvider,useOrin} from "./orin-settings";
import {OrinNavigation,useSection,useNavigation} from './orin-navigation';
import {NotificationCenter,NotificationBadgeBridge,NotificationProvider} from './notification-center';
import {SecondaryPages} from './secondary-pages';
import {AccountSettings} from "./account-settings";
import {DEFAULT_PREFERENCES,PREFERENCES_KEY,parsePreferences,type Preferences,type SettingsState} from "@/lib/preferences";
import {MARKET_SYMBOLS} from "@/lib/market-symbols";
import {ReferenceHome,ReferenceMarkets,ReferenceTrade} from "./reference-views";
import {ASSETS,money,percent,resultCents,type Asset,type Contract,type LabState,type MarketData,type Position,type Receipt} from "@/lib/contracts";

const previewContract:Contract={id:'preview',code:'',title:'معاينة الشارت',asset:'XAUUSD',direction:'BUY',duration_sec:60,settlement_bps:84,eligibility:'all',opens_at:0,closes_at:0,published_at:0,admin_id:'',canonical:'',hash:''};
const labels:Record<string,string>={all:'جميع الحسابات',standard:'قياسي',advanced:'متقدم'};
const actionLabels:Record<string,string>={
  ACCOUNT_CREATED:'إنشاء الحساب',
  TERMS_ACCEPTED:'الموافقة على الشروط',
  CONTRACT_PUBLISHED_AND_LOCKED:'نشر العقد وقفل الشروط',
  AMOUNT_ALLOCATED:'حجز مبلغ التداول',
  CONTRACT_SETTLED:'تسوية العقد',
  TIER_CHANGED:'تغيير فئة الحساب',
  TEST_ACCOUNT_CREATED:'إنشاء الحساب',
  TEST_TERMS_ACCEPTED:'الموافقة على الشروط',
  VIRTUAL_AMOUNT_ALLOCATED:'حجز مبلغ التداول',
  TEST_TIER_CHANGED:'تغيير فئة الحساب'
};
const journalLabels:Record<string,string>={deposit:'إيداع مؤكد',referral_reward:'مكافأة إحالة',team_activity:'مكافأة نشاط الفريق',nonwithdrawable_bonus:'بونص تداول غير قابل للسحب',bonus_profit:'أرباح بونص',test_funding:'رصيد افتتاحي',allocation:'حجز للمشاركة',settlement:'تسوية العقد'};
const date=(n:number)=>new Date(n).toLocaleString('ar-SY-u-nu-latn',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const remaining=(ms:number)=>`${String(Math.floor(Math.max(0,ms)/60000)).padStart(2,'0')}:${String(Math.floor(Math.max(0,ms)/1000)%60).padStart(2,'0')}`;
function download(name:string,content:string,type='application/json'){const a=document.createElement('a');a.href='data:'+type+';charset=utf-8,'+encodeURIComponent(content);a.download=name;a.click();}
async function copy(value:string){try{await navigator.clipboard.writeText(value);toast.success('تم النسخ');}catch{toast.info('تعذر النسخ التلقائي. يمكنك تحديد النص ونسخه.');}}
function Choice({value,onChange,items,label}:{value:string;onChange:(v:string)=>void;items:[string,string][];label:string}){const {t,prefs}=useOrin();return <Select value={value} onValueChange={onChange} dir={prefs.chartLocale==='ar'?'rtl':'ltr'}><SelectTrigger className="select-trigger" aria-label={label}><SelectValue/></SelectTrigger><SelectContent className="select-content">{items.map(([v,l])=><SelectItem key={v} value={v}>{t(l)}</SelectItem>)}</SelectContent></Select>}
function Empty({title,detail,children}:{title:string;detail:string;children?:React.ReactNode}){return <div className="empty-state"><ClipboardList/><h3>{title}</h3><p>{detail}</p>{children}</div>}
function Status({contract,now}:{contract:Contract;now:number}){const {t}=useOrin();return <span className={`chip ${now<contract.opens_at?'chip-blue':now>=contract.closes_at?'':'chip-green'}`}>{t(now<contract.opens_at?'مجدول':now>=contract.closes_at?'انتهت الدعوة':'متاح للمشاركة')}</span>}

export default function OrinApp({active=true,initialSettings,initialState,onSettingsChange,onStateChange}:{active?:boolean;initialSettings?:SettingsState;initialState?:LabState;onSettingsChange?:(settings:SettingsState)=>void;onStateChange?:(state:LabState)=>void}={}){return <WorkspaceVisibility.Provider value={active}><OrinSettingsProvider initialSettings={initialSettings} onSettingsChange={onSettingsChange}><OrinNavigation><NotificationProvider><TradingWorkspace initialState={initialState} onStateChange={onStateChange}/></NotificationProvider></OrinNavigation></OrinSettingsProvider></WorkspaceVisibility.Provider>;}
function TradingWorkspace({initialState,onStateChange}:{initialState?:LabState;onStateChange?:(state:LabState)=>void}){
 const {prefs,change,configuration,settings:accountSettings,t,number}=useOrin();
 const date=(n:number)=>new Date(n).toLocaleString(prefs.chartLocale+'-u-nu-latn',{timeZone:prefs.timezone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const money=(cents:number)=>number(cents/100);
 const fmtDur=(sec:number)=>{const s=Math.round(Number(sec)||60);if(s<60)return `${s} ${t('ثانية','sec')}`;return `${Math.round(s/60)} ${t('دقيقة','min')}`;};
 const [state,setState]=useState<LabState|null>(initialState??null),[error,setError]=useState(''),[syncError,setSyncError]=useState(''),[authNeeded,setAuthNeeded]=useState(false),[busy,setBusy]=useState(false);
 const [tab,setTab]=useSection();const navigation=useNavigation();const [asset,setAsset]=useState<Asset>('BTCUSD'),[code,setCode]=useState(''),[selectedId,setSelectedId]=useState<string|null>(null),[amount,setAmount]=useState('1000');
 const [offset,setOffset]=useState(initialState?initialState.serverTime-Date.now():0),[now,setNow]=useState(initialState?.serverTime??0),[notifyOpen,setNotifyOpen]=useState(false),[agreed,setAgreed]=useState(false),[confirmed,setConfirmed]=useState(false),[receipt,setReceiptState]=useState<Receipt|null>(null);
 const [title,setTitle]=useState('صفقة VIP معتمدة - بيتكوين'),[adminAsset,setAdminAsset]=useState('BTCUSD'),[direction,setDirection]=useState('BUY'),[duration,setDuration]=useState('300'),[pct,setPct]=useState('85'),[eligibility,setEligibility]=useState('all'),[openAt,setOpenAt]=useState(''),[closeAt,setCloseAt]=useState(''),[published,setPublished]=useState<Contract|null>(null);
 const [resolvedContract,setResolvedContract]=useState<Contract|null>(null),[detailsOpen,setDetailsOpen]=useState(false);
 const [marketPair,setMarketPair]=useState(prefs.chartPair),[homePair,setHomePair]=useState(prefs.chartPair);
 const routePair=navigation.path.startsWith('/markets/')?navigation.path.split('/')[2]:null;
 const [detailPairState, setDetailPairState] = useState<string | null>(null);
 const detailPair=detailPairState || (MARKET_SYMBOLS.some(s=>s.pair===routePair)?routePair!:marketPair);
 const setDetailPair=(pair:string)=>setDetailPairState(pair);
 const openAsset=(pair:string,price?:number)=>{const symbol=MARKET_SYMBOLS.find(s=>s.pair===pair);if(!symbol||!configuration.enabledSymbols.includes(pair))return;setMarketPair(pair);setOrderMode('invited');navigation.navigate('/markets/'+pair,false,{asset:{symbol:symbol.tv,name:symbol.name,market:symbol.category,pair:symbol.pair,price:price??null}})};
 const [orderMode,setOrderMode]=useState('invited');
 const joinOpen=navigation.path.endsWith('/confirm')&&!!(state?.contracts.find(c=>c.id===navigation.path.split('/')[2])??(resolvedContract?.id===navigation.path.split('/')[2]?resolvedContract:null));const setJoinOpen=(v:boolean)=>v&&selectedId?navigation.navigate('/contracts/'+selectedId+'/confirm'):navigation.back('/trade');
 const auditOpen=navigation.path==='/admin/audit';const setAuditOpen=(v:boolean)=>v?navigation.navigate('/admin/audit'):navigation.back('/admin');
 const setReceipt=(r:Receipt|null)=>{setReceiptState(r);r?navigation.navigate('/transactions/'+r.id):navigation.back('/positions')};
 const termsOpen=false;const setTermsOpen=(_v:boolean)=>{};
 const funding=navigation.path==='/deposit'?'إيداع':navigation.path==='/withdraw'?'سحب':null;const setFunding=(v:string|null)=>v?navigation.navigate(v==='إيداع'?'/deposit':'/withdraw'):navigation.back('/');
 const prefsRef=useRef(prefs);prefsRef.current=prefs;
 useEffect(()=>{const pair=prefs.chartPair;setMarketPair(pair);setHomePair(pair);if(['BTC-USD','ETH-USD','XAU-USD'].includes(pair))setAsset(pair.replace('-','') as Asset);},[prefs.chartPair]);
 useEffect(()=>{const url=new URL(window.location.href),symbol=url.searchParams.get('tvwidgetsymbol'),match=MARKET_SYMBOLS.find(s=>s.tv===symbol&&configuration.enabledSymbols.includes(s.pair));if(match){setMarketPair(match.pair);setOrderMode('invited');navigation.navigate('/markets/'+match.pair,true);}else if(symbol){url.searchParams.delete('tvwidgetsymbol');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash)}},[configuration.enabledSymbols]);
 const updatePreferences=(changes:Partial<Preferences>)=>{void change(changes);};
 const sequence=useRef(0),applied=useRef(0),loaded=useRef(false),lastSettle=useRef(''),lastNotice=useRef<number|null>(null),stateRef=useRef<LabState|null>(initialState??null);
 const selectionPending=useRef(false),accountSnapshots=useRef(new Map<string,LabState>());
 const receive=useCallback((data:LabState,seq:number)=>{
  if(seq<applied.current||selectionPending.current)return;
  applied.current=seq;
  let finalData=data;
  if(data.accountDirectory?.accounts?.length){
    const real=data.accountDirectory.accounts.find((a: any)=>a.type==='real');
    const cur=data.accountDirectory.accounts.find((a: any)=>a.id===(data.accountDirectory?.activeId??''));
    if(real&&(!cur||cur.type==='demo'||data.accountDirectory.activeId==='primary')){
      finalData=scopeAccountState(data,{...data.accountDirectory,activeId:real.id});
    }
  }
  setState(finalData);stateRef.current=finalData;setOffset(finalData.serverTime-Date.now());setError('');setSyncError('');setAuthNeeded(false);
  if(lastNotice.current!==null){const fresh=(finalData.notifications ?? []).filter(n=>n.created_at>lastNotice.current!);if(fresh.length&&prefsRef.current.notifications)toast.info(displayText(fresh[0].title),{description:displayText(fresh[0].message)});}
  lastNotice.current=Math.max(lastNotice.current??0,...(finalData.notifications ?? []).map(n=>n.created_at));
 },[]);
 const refresh=useCallback(async()=>{const seq=++sequence.current;try{const res=await apiFetch('/api/lab',{cache:'no-store'});if(!res.headers.get('content-type')?.includes('application/json'))throw new Error('تعذر الاتصال بالخدمة.');const data=(await res.json().catch(()=>({}))) as LabState & {error?:string};if(!res.ok){if(res.status===401)setAuthNeeded(true);throw new Error(data.error || 'تعذر تحميل بيانات العقد');}receive(data,seq);}catch(e){setError(e instanceof Error?e.message:'تعذر الاتصال');}},[receive]);
 const accountsChanged=(accountDirectory:AccountDirectory,phase:'optimistic'|'confirmed'|'rollback'='confirmed')=>{
  selectionPending.current=phase==='optimistic';applied.current=++sequence.current;
  setState(previous=>{if(!previous)return previous;const oldId=previous.accountDirectory?.activeId??'primary';accountSnapshots.current.set(oldId,previous);const base=accountSnapshots.current.get(accountDirectory.activeId)??previous;return scopeAccountState(base,accountDirectory)});
  if(accountDirectory.activeId!==stateRef.current?.accountDirectory?.activeId){setSelectedId(null);setResolvedContract(null);setReceiptState(null);setAmount('1000')}
  if(phase==='confirmed')void refresh();
 };
 const mutate=useCallback(async(body:Record<string,unknown>,silent=false)=>{const seq=++sequence.current;if(!silent)setBusy(true);try{const res=await apiFetch('/api/lab',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!res.headers.get('content-type')?.includes('application/json'))throw new Error('تعذر تنفيذ العملية (استجابة غير صالحة)');const data=(await res.json().catch(()=>({}))) as {error?:string;state?:LabState;result?:Record<string,unknown>};if(!res.ok)throw new Error(data.error??'تعذر تنفيذ العملية');if(data.state)receive(data.state,seq);return data as {result:Record<string,unknown>;state:LabState};}catch(e){const message=e instanceof Error?e.message:'تعذر تنفيذ العملية';if(silent)setSyncError(message);else toast.error(message);throw e;}finally{if(!silent)setBusy(false);}},[receive]);
 useEffect(()=>{if(initialState)receive(initialState,0);else void refresh();},[refresh,receive]);
 useEffect(()=>{stateRef.current=state;if(state)onStateChange?.(state)},[state,onStateChange]);
 useEffect(()=>{setNow(Date.now()+offset);const tick=setInterval(()=>setNow(Date.now()+offset),1000);return()=>clearInterval(tick);},[offset]);
  useEffect(()=>{if(!state)return;if(!loaded.current){loaded.current=true;void mutate({action:'settle'},true).catch(()=>{});}const tick=setInterval(()=>void mutate({action:'settle'},true).catch(()=>{}),8000);return()=>clearInterval(tick);},[!!state,mutate]);
  useEffect(()=>{const due=state?.positions.filter(p=>p.status==='active'&&p.ends_at<=now).map(p=>p.id).join(',');if(due&&due!==lastSettle.current){lastSettle.current=due;void mutate({action:'settle'},true).catch(()=>{lastSettle.current='';});}},[now,state?.positions,mutate]);
 const active=state?.positions.find(p=>p.status==='active');
 const selected=navigation.path.startsWith('/contracts/')&&navigation.path.split('/')[2]!==selectedId?null:state?.contracts.find(c=>c.id===selectedId)??(resolvedContract?.id===selectedId?resolvedContract:null);
 const current=active?.contract??selected??{...previewContract,asset};
 const progress=active?Math.max(0,Math.min(1,(now-active.started_at)/(active.ends_at-active.started_at))):0;
 const unread=state?.notifications.filter(n=>n.created_at>state.user.seen_at).length??0;
 const chooseContract=(c:Contract)=>{setResolvedContract(c);setSelectedId(c.id);setCode(c.code);setAsset(c.asset);setOrderMode('invited');navigation.navigate('/contracts/'+c.id);setDetailsOpen(true);};
 const lookup=async(overrideCode?:string)=>{const cStr=(overrideCode??code).trim().toUpperCase();if(busy||!cStr)return;setBusy(true);try{const response=await apiFetch('/api/invitations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:cStr})}),data=await response.json() as {contract:Contract;serverTime:number;error?:string};if(!response.ok)throw new Error(data.error??t('تعذر التحقق من الدعوة','Unable to verify invitation'));setOffset(data.serverTime-Date.now());chooseContract(data.contract);let newPair: any=data.contract.asset;if(!newPair.includes('-')){if(newPair==='BNB')newPair='BNB-USDT';else if(newPair==='TON')newPair='TON-USDT';else newPair=`${newPair}-USD`;}if(MARKET_SYMBOLS.some(s=>s.pair===newPair)){setMarketPair(newPair);setHomePair(newPair);void updatePreferences({chartPair:newPair});}setTab('demo');navigation.navigate('/contracts/'+data.contract.id);setDetailsOpen(true);}catch(e){toast.error(e instanceof Error?e.message:t('تعذر التحقق من الدعوة','Unable to verify invitation'));}finally{setBusy(false);}};
 const executeCode=async(providedCode?:string,targetAmount?:string)=>{const cStr=(providedCode??code).trim().toUpperCase();if(!cStr){toast.error(t('يرجى إدخال كود الصفقة أولاً','Please enter a trade signal code first'));return;}if(busy)return;setBusy(true);try{const response=await apiFetch('/api/invitations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:cStr})}),data=await response.json() as {contract:Contract;serverTime:number;error?:string};if(!response.ok)throw new Error(data.error??t('تعذر التحقق من كود الصفقة','Unable to verify signal code'));setOffset(data.serverTime-Date.now());const c=data.contract;setResolvedContract(c);setSelectedId(c.id);setCode(c.code);setAsset(c.asset);setOrderMode('invited');let newPair: any=c.asset;if(!newPair.includes('-')){if(newPair==='BNB')newPair='BNB-USDT';else if(newPair==='TON')newPair='TON-USDT';else newPair=`${newPair}-USD`;}if(MARKET_SYMBOLS.some(s=>s.pair===newPair)){setMarketPair(newPair);setHomePair(newPair);void updatePreferences({chartPair:newPair});}const rawAmt=targetAmount??amount;let val=Number(rawAmt);if(!Number.isFinite(val)||val<1){val=1000;setAmount('1000');}const balCents=state?.balanceCents??0;if(balCents>0&&Math.round(val*100)>balCents){val=Math.max(1,Math.floor(balCents/100));setAmount(String(val));}await mutate({action:'join',code:c.code,amountCents:Math.round(val*100),contractHash:c.hash,confirmed:true});haptic('success',prefs);setTab('demo');navigation.navigate('/contracts/'+c.id+'/success');toast.success(t(`🚀 تم دخول الصفقة (${c.asset} ${c.direction}) وتفعيل المؤقت بنجاح!`,`🚀 Trade (${c.asset} ${c.direction}) executed successfully!`));}catch(e){toast.error(e instanceof Error?e.message:t('تعذر تنفيذ الصفقة','Unable to execute trade'));setTab('demo');}finally{setBusy(false);}};
  const startJoin=()=>{if(!selected)return;if(accountSettings?.profile.closureStatus==='requested'){toast.error(t('المشاركة متوقفة بعد طلب إغلاق الحساب.','New participation is disabled after a closure request.'));return;}setConfirmed(false);setJoinOpen(true);};
 const join=async()=>{if(!selected)return;const value=Number(amount);if(!Number.isFinite(value)||value<1||Math.abs(value*100-Math.round(value*100))>.0001){toast.error('أدخل مبلغًا صحيحًا بمنزلتين عشريتين.');return;}try{await mutate({action:'join',code:selected.code,amountCents:Math.round(value*100),contractHash:selected.hash,confirmed});haptic('success',prefs);navigation.navigate('/contracts/'+selected.id+'/success');}catch{}};
 const formatChannelMessage=(c:Contract)=>{
  const dirText=c.direction==='BUY'?'🟢 شراء صعود (BUY)':'🔴 بيع هبوط (SELL)';
  return `🚀 إشارة تداول معتمدة من إدارة ORIN 🚀\n`+
         `━━━━━━━━━━━━━━━━━━━━\n`+
         `📊 الأصل المالي: ${c.asset}\n`+
         `🎯 نوع الصفقة: ${dirText}\n`+
         `⏱️ مدة الصفقة: ${c.duration_sec < 60 ? `${c.duration_sec} ثانية` : `${Math.round(c.duration_sec / 60)} دقيقة`}\n`+
         `📈 نسبة الأرباح المقفلة: ${percent(c.settlement_bps)}\n`+
         `🔑 كود الدخول في الصفقة:\n`+
         `👉 ${c.code} 👈\n`+
         `━━━━━━━━━━━━━━━━━━━━\n`+
         `⚠️ طريقة الاستخدام:\n`+
         `1. افتح تطبيق ORIN\n`+
         `2. ادخل كود الصفقة أعلاه في بوابة الصفقات المعتمدة\n`+
         `3. حدد المبلغ واضغط «تأكيد الدخول» فوراً!`;
 };
 const publish=async(event:React.FormEvent)=>{event.preventDefault();const opens=openAt?new Date(openAt).getTime():Date.now()+offset,closes=closeAt?new Date(closeAt).getTime():opens+86400_000;try{const data=await mutate({action:'publish',title,asset:adminAsset,direction,durationSec:Number(duration),settlementBps:Math.round(Number(pct)*100),eligibility,opensAt:opens,closesAt:closes});const c=data.state.contracts.find(c=>c.id===data.result.id);if(c)setPublished(c);toast.success('تم إنشاء الصفقة وتوليد كود الدخول بنجاح! يمكنك الآن نسخه ومشاركته بالقنوات الخاصة.');}catch{}};
 const showNotifications=()=>navigation.navigate('/notifications');
 const accept=async()=>{try{await mutate({action:'accept'});setTermsOpen(false);toast.success('الحساب جاهز.');}catch{}};
 const statementBusy=useRef(false);
 const exportStatement=async()=>{if(!state||statementBusy.current)return;statementBusy.current=true;try{const {statementSnapshot}=await import('@/lib/account-transactions');const {downloadStatement}=await import('@/lib/statement-pdf');await downloadStatement(await statementSnapshot(state),prefs.chartLocale==='ar')}catch{toast.error(t('تعذر إنشاء كشف الحساب.','Unable to create account statement.'))}finally{statementBusy.current=false}};
 const exportLedger=()=>{if(!state)return;const account=activeTradingAccount(state.accountDirectory),mode=account?.type==='real'?'REAL':'DEMO_NONWITHDRAWABLE',escape=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';const lines=['mode,account_number,currency,journal_id,ledger_account,debit_cents,credit_cents,effective_at',...state.ledger.map(e=>[mode,account?.accountNumber??'',account?.currency??'USD',e.journal_id,e.account,Math.max(0,e.amount_cents),Math.max(0,-e.amount_cents),new Date(e.effective_at).toISOString()].map(escape).join(','))];download('orin-account-ledger.csv','\uFEFF'+lines.join('\n'),'text/csv;charset=utf-8');};
 useEffect(()=>{type Context={registerTool:(tool:unknown,options:{signal:AbortSignal})=>void|Promise<void>};const context=(document as Document&{modelContext?:Context}).modelContext;if(!context)return;const lifecycle=new AbortController();const tools=[{name:'read_virtual_contract_workspace',description:'Read production balance, locked contract invitations, and positions.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>{const s=stateRef.current;if(!s)throw new Error('Workspace not loaded');return {mode:'production',balanceCents:s.balanceCents,contracts:s.contracts.map(c=>({id:c.id,code:c.code,asset:c.asset,settlementBps:c.settlement_bps,hash:c.hash})),positions:s.positions.map(p=>({id:p.id,status:p.status,endsAt:p.ends_at}))};}},{name:'stage_virtual_invitation',description:'Select an existing contract invitation and open its details. Does not allocate funds or join.',inputSchema:{type:'object',properties:{code:{type:'string'}},required:['code'],additionalProperties:false},annotations:{readOnlyHint:false},execute:(input:unknown)=>{const value=(input as {code?:unknown})?.code;if(typeof value!=='string')throw new Error('Code is required');const c=stateRef.current?.contracts.find(c=>c.code===value.trim().toUpperCase());if(!c)throw new Error('Invitation not found');setSelectedId(c.id);setCode(c.code);setAsset(c.asset);setOrderMode('invited');setTab('demo');return {staged:true,contractId:c.id,requiresUserConfirmation:true};}}];for(const tool of tools){try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}return()=>lifecycle.abort();},[]);

 useEffect(()=>{if(navigation.path.startsWith('/contracts/')){const id=decodeURIComponent(navigation.path.split('/')[2]);const c=state?.contracts.find(c=>c.id===id)??(resolvedContract?.id===id?resolvedContract:null);if(c){setResolvedContract(c);setSelectedId(c.id);setCode(c.code);setAsset(c.asset);setOrderMode('invited');setDetailsOpen(navigation.path.split('/').length===3)}else setDetailsOpen(false)}else setDetailsOpen(false)},[navigation.path,state?.contracts]);
 useEffect(()=>{if(navigation.path.startsWith('/transactions/'))setReceiptState(state?.receipts.find(r=>r.id===decodeURIComponent(navigation.path.split('/')[2]))??null);else setReceiptState(null)},[navigation.path,state?.receipts]);
 const history=state?.positions.filter(p=>p.status==='settled')??[];
 const rows=state?.positions??[];
 return <div className={`app-shell reference-shell ${tab==='demo'?'trade-mode':''} ${tab==='admin'?'admin-mode':''}`}>
  <Dialog open={((navigation.path.startsWith('/contracts/')&&!selected)||(navigation.path.startsWith('/transactions/')&&!receipt))} onOpenChange={v=>{if(!v)navigation.back('/')}}><DialogContent><DialogHeader><DialogTitle>{t(authNeeded?'تسجيل الدخول':state?'التفاصيل غير متاحة':'تحميل التفاصيل',authNeeded?'Sign in':state?'Details unavailable':'Loading details')}</DialogTitle><DialogDescription>{t(authNeeded?'سجّل الدخول للمتابعة إلى الصفحة المطلوبة.':state?'قد يكون هذا العنصر غير متاح لهذا الحساب.':'جار التحقق من بيانات الحساب.',authNeeded?'Sign in to continue to your destination.':state?'This item may be unavailable to this account.':'Checking account data.')}</DialogDescription></DialogHeader>{authNeeded?<a className="btn-primary" href={signInUrl(navigation.path)}>{t('تسجيل الدخول','Sign in')}</a>:error?<button className="btn-outline" onClick={()=>void refresh()}>{t('إعادة المحاولة','Retry')}</button>:!state?<span className="orin-loader"/>:null}</DialogContent></Dialog>
  {!firebaseMode()&&<StartupBrand/>}<NotificationCenter/><SecondaryPages state={state}/><Toaster position="top-center" dir={prefs.chartLocale==='ar'?'rtl':'ltr'} richColors/>
  <SupportLauncher/><header className="topbar reference-topbar"><button className="brand" aria-label={t("ORIN الرئيسية")} onClick={()=>setTab('home')}><img src="/brand/orin-mark.png" alt="" width="44" height="44"/><strong>ORIN</strong></button><div className="home-account-actions">{state?.isAdmin&&<button className="round-btn admin-shortcut" aria-label={t("لوحة الإدارة","Admin Dashboard")} onClick={()=>navigation.navigate("/admin")} title={t("لوحة الإدارة","Admin")}><ShieldCheck size={20} className="gain"/></button>}<button className="round-btn notification-trigger" aria-label={t("الإشعارات")} onClick={showNotifications}><Bell/><NotificationBadgeBridge/></button><button className="round-btn profile-shortcut" aria-label={t('الملف الشخصي','Profile')} onClick={()=>navigation.navigate('/settings/account')}><UserRound/></button></div></header>
  {!state&&!error&&<div className="loading-bar" role="status" aria-label={t("جار تحميل البيانات")}/>}
  <main className="main">
   <AccountTransactions state={state}/>
   <Dialog open={navigation.path==='/transfer'} onOpenChange={v=>{if(!v)navigation.back('/')}}><DialogContent><DialogHeader><DialogTitle>{t('تحويل','Transfer')}</DialogTitle><DialogDescription>{t('بين محافظ حساب ORIN','Between your ORIN account wallets')}</DialogDescription></DialogHeader><AccountTransfer key={state?.accountDirectory?.activeId??'primary'} account={activeTradingAccount(state?.accountDirectory)} onSaved={refresh}/></DialogContent></Dialog>
   {error&&!authNeeded&&<div className="error-banner"><WifiOff size={17}/><span>{error}</span><button className="text-action" onClick={()=>void refresh()}>{t("تحديث")}</button></div>}
   {syncError&&<div className="error-banner"><Info size={17}/><span>{t("آخر مزامنة لم تنجح. قد تتأخر حالة التسوية:")}{syncError}</span></div>}
   <Tabs value={tab} onValueChange={setTab} dir={prefs.chartLocale==='ar'?'rtl':'ltr'} className="workspace-tabs">
     <TabsList className="workspace-nav reference-nav" aria-label={t("أقسام ORIN")}>
        <TabsTrigger value="home" onClick={() => { navigation.navigate('/'); setTab('home'); }}><Home/><span>{t('الرئيسية','Home')}</span></TabsTrigger>
        <TabsTrigger value="real" onClick={() => { navigation.navigate('/markets'); setTab('real'); }}><ChartNoAxesCombined/><span>{t('الأسواق','Markets')}</span></TabsTrigger>
        <TabsTrigger value="demo" className="center-orin" aria-label={t("فتح التداول والدعوات")} onClick={() => { navigation.navigate('/trade'); setTab('demo'); }}><span className="center-orin-mark"><img src="/brand/orin-mark.png" alt=""/></span></TabsTrigger>
        <TabsTrigger value="wallet" onClick={() => { navigation.navigate('/positions'); setTab('wallet'); }}><BriefcaseBusiness/><span>{t('المراكز','Positions')}</span></TabsTrigger>
        <TabsTrigger value="account" onClick={() => { navigation.navigate('/settings'); setTab('account'); }}><Settings/><span>{t('الإعدادات','Settings')}</span></TabsTrigger>
        {state?.isAdmin && <TabsTrigger value="admin" onClick={() => { navigation.navigate('/admin'); setTab('admin'); }}><ShieldCheck/><span>{t('الإدارة','Admin')}</span></TabsTrigger>}
      </TabsList>
      <TabsContent value="home"><ReferenceHome state={state} prefs={prefs} selectedPair={homePair} onPairChange={setHomePair} onAccountsChange={accountsChanged} onTransfer={()=>navigation.navigate('/transfer')} onHideBalance={()=>updatePreferences({hideBalance:!prefs.hideBalance})} onNavigate={v=>{if(v==='demo')setOrderMode('invited');setTab(v);}} onInvite={()=>navigation.navigate('/referral')} onFunding={kind=>navigation.navigate(kind==='deposit'?'/deposit':'/withdraw')} onTerms={()=>setTermsOpen(true)} code={code} setCode={setCode} amount={amount} setAmount={setAmount} onExecuteCode={(c,a)=>void executeCode(c,a)} onLookupCode={c=>{if(c)setCode(c);void lookup(c);}} busy={busy} activePosition={active} now={now} progress={progress}/></TabsContent>
      <TabsContent value="demo">{routePair&&(!MARKET_SYMBOLS.some(s=>s.pair===routePair)||!configuration.enabledSymbols.includes(routePair))?<div className="orin-empty"><h2>{t('هذا الأصل غير متاح','This asset is unavailable')}</h2><button className="btn-outline" onClick={()=>navigation.navigate('/markets')}>{t('العودة للأسواق','Back to markets')}</button></div>:<ReferenceTrade key={state?.accountDirectory?.activeId??'primary'} state={state} current={current} selected={selected} active={active} now={now} progress={progress} code={code} setCode={setCode} amount={amount} setAmount={setAmount} lookup={lookup} onExecuteCode={(c,a)=>void executeCode(c,a)} startJoin={startJoin} onTransfer={()=>navigation.navigate('/transfer')} onBack={() => { if (routePair) { navigation.navigate('/markets'); setTab('real'); } else { navigation.navigate('/'); setTab('home'); } }} onNotifications={showNotifications} prefs={prefs} referencePair={detailPair} setReferencePair={pair=>{setMarketPair(pair);if(routePair)navigation.navigate('/markets/'+pair,true)}} mode={orderMode} setMode={setOrderMode} busy={busy} onAsset={a=>{setAsset(a);setSelectedId(null);}}/>}
      {(() => {
        const userEnteredContracts = (state?.contracts ?? []).filter(c =>
          (state?.positions ?? []).some(p => p.contract?.id === c.id || p.contract?.code === c.code)
        );
        return (
          <>
            <div className="section-heading"><div><h2>{t('عقودك المدخلة','Your Entered Trades')}</h2><p>{t('الصفقات والعقود التي انضممت إليها فقط','Only contracts you have entered')}</p></div><span className="chip">{userEnteredContracts.length}{t("عقد")}</span></div>
            {userEnteredContracts.length ? <div className="contract-list">{userEnteredContracts.map(c=><article className="contract-card" key={c.id}><div className="contract-row"><span className="num">{c.asset}</span><Status contract={c} now={now}/></div><div className="contract-title">{displayText(c.title??'')}</div><div className="contract-row"><span className="muted">{fmtDur(c.duration_sec)} · {c.direction}</span><span className={`num ${c.settlement_bps<0?'loss':'gain'}`}>{percent(c.settlement_bps)}</span></div><div className="contract-code"><span className="mono small">{c.code}</span><button className="copy-small" aria-label={t("نسخ كود الدعوة")} onClick={()=>void copy(c.code)}><Copy/></button></div></article>)}</div> : <div className="panel"><Empty title={t("لا توجد صفقات مدخلة مسبقًا","No entered trades")} detail={t("أدخل كود الصفقة للانضمام والبدء.","Enter a signal code to join.")}/></div>}
          </>
        );
      })()}
     </TabsContent>
     <TabsContent value="real" forceMount hidden={tab!=='real'}><ReferenceMarkets prefs={prefs} active={tab==='real'} onSelect={openAsset}/></TabsContent>
     <TabsContent value="wallet"><PositionsPanel key={state?.accountDirectory?.activeId??'primary'} state={state} now={now} onReceipt={setReceipt} onDetails={p=>chooseContract(p.contract)} onMarkets={()=>navigation.navigate('/markets')} onActivity={()=>navigation.navigate('/activity')}/></TabsContent>
     <TabsContent value="account"><AccountSettings state={state} prefs={prefs} onChange={updatePreferences} onTerms={()=>{}} onAdmin={()=>setTab("admin")} onLedger={()=>void exportStatement()} onNotifications={showNotifications}/></TabsContent>
     {state?.isAdmin&&<TabsContent value="admin"><div className="admin-title"><button className="btn-outline" onClick={()=>setTab('account')}>{t("حسابي")}</button><h1>{t("إدارة العقود وتوليد الأكواد")}</h1>{firebaseMode()&&<a className="btn-outline" href="/admin/users">{t('إدارة المستخدمين','User management')}</a>}</div><div className="test-banner"><ShieldCheck/><span>{t('تُقفل الشروط عند النشر ويتم توليد كود مخصص لإرساله للمستخدمين عبر القنوات الخاصة.','Terms lock upon publication and generate a secure code for VIP private channel dispatch.')}</span></div><div className="admin-grid"><section className="panel panel-pad"><div className="panel-head"><h2>{t("إنشاء صفقة معتمدة")}</h2><span className="chip">{t("توليد كود")}</span></div><form onSubmit={publish}><div className="form-grid"><div className="field span-two"><label htmlFor="contract-title">{t("عنوان الصفقة")}</label><input id="contract-title" value={title} onChange={e=>setTitle(e.target.value)} maxLength={80} required/></div><div className="field"><label>{t("الأصل المالي")}</label><Choice value={adminAsset} onChange={setAdminAsset} items={Object.entries(ASSETS).map(([k,v])=>[k,`${v} · ${k}`])} label={t("الأصل المرجعي")}/></div><div className="field"><label>{t("اتجاه الصفقة")}</label><Choice value={direction} onChange={setDirection} items={[["BUY","BUY · شراء (صعود)"],["SELL","SELL · بيع (هبوط)"]]} label={t("الاتجاه")}/></div><div className="field"><label>{t("مدة الصفقة")}</label><Choice value={duration} onChange={setDuration} items={[["60","دقيقة واحدة"],["120","دقيقتان"],["180","3 دقائق"],["300","5 دقائق"],["600","10 دقائق"],["900","15 دقيقة"],["1800","30 دقيقة"]]} label={t("مدة العقد")}/></div><div className="field"><label htmlFor="settlement-percent">{t("نسبة أرباح الصفقة المقفلة %")}</label><input id="settlement-percent" value={pct} onChange={e=>setPct(e.target.value)} type="number" step="0.1" min="-100" max="1000" dir="ltr" required/><div className="option-chips" style={{marginTop:8}}>{['15','35','50','75','85','90'].map(p=><button key={p} type="button" className={pct===p?'selected':''} onClick={()=>setPct(p)}>+{p}%</button>)}</div><span className="field-hint">{t("موجبة للربح المحقق للعميل (+85% تعني ربح 850$ لكل 1000$).")}</span></div><div className="field span-two"><label>{t("الحسابات المؤهلة")}</label><Choice value={eligibility} onChange={setEligibility} items={Object.entries(labels)} label={t("فئة الحسابات المؤهلة")}/></div><div className="field"><label htmlFor="window-start">{t("فتح المشاركة")}</label><input id="window-start" type="datetime-local" value={openAt} onChange={e=>setOpenAt(e.target.value)}/><span className="field-hint">{t("فارغ = عند النشر · توقيت جهازك")}</span></div><div className="field"><label htmlFor="window-end">{t("آخر موعد للمشاركة")}</label><input id="window-end" type="datetime-local" value={closeAt} onChange={e=>setCloseAt(e.target.value)}/><span className="field-hint">{t("فارغ = بعد 24 ساعة من فتحها")}</span></div></div><div className="settlement-box"><p>{t("مثال على مبلغ افتراضي قدره 1,000 دولار")}</p><div className={`settlement-value ${Number(pct)<0?'loss':'gain'}`} dir="ltr">{Number.isFinite(Number(pct))?`${Number(pct)>=0?'+':''}${money(resultCents(100000,Math.round(Number(pct)*100)))}`:'—'} USD</div><p>{t("إجمالي المسترجع للمحفظة:")} <b className="num gain">{Number.isFinite(Number(pct))?money(100000+resultCents(100000,Math.round(Number(pct)*100))):'—'} USD</b></p></div><button className="btn-primary full" type="submit" disabled={busy}><LockKeyhole/> {t(busy?'جار الحفظ وتوليد الكود…':'نشر الصفقة وتوليد كود الدخول')}</button></form></section><aside><section className="panel panel-pad"><h2 style={{marginBottom:20}}>{t("من النشر إلى الإيصال")}</h2><div className="security-list"><div className="security-item"><LockKeyhole/><div>{t("شروط مقفلة")}<p>{t("الزوج والاتجاه والمدة والنسبة والأهلية تُحفظ قبل المشاركة.")}</p></div></div><div className="security-item"><FileCheck2/><div>{t("بصمة SHA-256")}<p>{t("مرجع للتحقق من تطابق الشروط والإيصال.")}</p></div></div><div className="security-item"><Bell/><div>{t("إشعارات داخل المنصة")}<p>{t("تظهر الدعوة للحسابات المؤهلة، والنتيجة لصاحب المشاركة.")}</p></div></div><div className="security-item"><ArrowDownUp/><div>{t("تسوية متوازنة")}<p>{t("حجز الرصيد ثم إعادة أصل المبلغ والنتيجة الافتراضية.")}</p></div></div></div></section>{published&&<section className="panel panel-pad admin-published-card" style={{marginTop:16}}><div className="panel-head"><div className="admin-pub-title"><CheckCircle2 size={22} className="gain"/><h2>{t("تم إنشاء الصفقة وتوليد الكود")}</h2></div><span className="chip chip-green">{t("جاهز للنشر")}</span></div><p className="published-title-line"><b>{published.title}</b> · <span className="num">{published.asset} · {published.direction}</span> · <b className="num gain">{percent(published.settlement_bps)}</b></p><div className="generated-code-display"><span className="code-label">{t("كود الصفقة المعتمد للعملاء:")}</span><div className="code-box-hero"><strong className="mono code-big">{published.code}</strong><button className="btn-copy-code" type="button" onClick={()=>void copy(published.code)}><Copy size={16}/> {t("نسخ الكود")}</button></div></div><div className="channel-share-box"><div className="channel-share-header"><Share2 size={16}/><b>{t("مشاركة الصفقة عبر القنوات الخاصة (Telegram / WhatsApp)")}</b></div><pre className="channel-msg-preview">{formatChannelMessage(published)}</pre><div className="channel-share-buttons"><button className="btn-primary" type="button" onClick={()=>void copy(formatChannelMessage(published))}><ClipboardList size={16}/> {t("نسخ الرسالة الجاهزة للقناة")}</button><button className="btn-outline btn-telegram" type="button" onClick={()=>window.open('https://t.me/share/url?url='+encodeURIComponent(published.code)+'&text='+encodeURIComponent(formatChannelMessage(published)),'_blank')}>{t("إرسال عبر Telegram")}</button></div></div></section>}</aside></div></TabsContent>}</Tabs>
   <footer className="footer"><span className="footer-brand" onClick={() => { navigation.navigate('/'); setTab('home'); }} style={{ cursor: 'pointer' }}><b>ORIN</b>{t("أورين")}</span><div className="btn-row"><span>{t('حساب حقيقي · USD','Real account · USD')}</span></div></footer>
   </main>
   {(() => {
     if (!navigation.path.endsWith('/success')) return null;
     const sId = navigation.path.split('/')[2];
     const pos = state?.positions.find(p => p.contract.id === sId);
     const c = state?.contracts.find(item => item.id === sId) ?? pos?.contract ?? resolvedContract;
     if (!c) return null;
     return (
       <TradeSuccessModal
         open={true}
         contract={c}
         position={pos}
         now={now}
         onClose={() => {
           navigation.navigate('/trade');
           setTab('demo');
         }}
         onGoHome={() => {
           navigation.navigate('/');
           setTab('home');
         }}
       />
     );
   })()}
  <Dialog open={detailsOpen} onOpenChange={v=>{if(!v){setDetailsOpen(false);navigation.back('/trade')}}}><DialogContent className="popup" dir={prefs.chartLocale==='ar'?'rtl':'ltr'}><DialogHeader><DialogTitle>{t('تفاصيل العقد','Contract details')}</DialogTitle><DialogDescription>{displayText(selected?.title??'')} · {t('عقد تداول مقفل الشروط','Locked-terms trading contract')}</DialogDescription></DialogHeader>{selected&&<><div className="details-grid"><div><small>{t('الأصل والاتجاه','Asset & direction')}</small><b className="num">{selected.asset} · {selected.direction}</b></div><div><small>{t('المدة بعد التأكيد','Duration after confirmation')}</small><b>{fmtDur(selected.duration_sec)}</b></div><div><small>{t('النسبة المقفلة مسبقًا','Pre-locked settlement')}</small><b className="num">{percent(selected.settlement_bps)}</b></div><div><small>{t('آخر وقت للمشاركة','Join before')}</small><b>{date(selected.closes_at)}</b></div></div><label className="account-form">{t('مبلغ التداول (USD)','Trading amount (USD)')}<input type="number" min="1" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><p className="settings-footnote">{t('التسوية ثابتة وفق الشروط المقفلة، ومستقلة عن الشارت. راجع النتيجة قبل التأكيد.','Settlement follows locked terms and is independent of the chart. Review the result before confirming.')}</p><button className="btn-primary full" disabled={busy||now<selected.opens_at||now>=selected.closes_at||!!active} onClick={()=>{setDetailsOpen(false);startJoin();}}>{t('مراجعة وتأكيد','Review & confirm')}</button></>}</DialogContent></Dialog>
   <Dialog open={!!funding} onOpenChange={v=>{if(!v)setFunding(null);}}><DialogContent className="popup"><DialogHeader><DialogTitle>{funding}</DialogTitle><DialogDescription>{t('حساب حقيقي · USD','Real account · USD')}</DialogDescription></DialogHeader>{funding&&<FundingPanel key={((activeTradingAccount(state?.accountDirectory)?.type==='real'?activeTradingAccount(state?.accountDirectory):state?.accountDirectory?.accounts.find(a=>a.type==='real'))?.id??'none')+':'+funding} account={(activeTradingAccount(state?.accountDirectory)?.type==='real'?activeTradingAccount(state?.accountDirectory):state?.accountDirectory?.accounts.find(a=>a.type==='real'))??activeTradingAccount(state?.accountDirectory)} kind={funding==='إيداع'?'deposit':'withdraw'} onBalanceChange={()=>void refresh()}/>}</DialogContent></Dialog>
   <Sheet open={notifyOpen} onOpenChange={setNotifyOpen}><SheetContent side="left" style={{width:'min(420px,100%)'}} dir="rtl"><SheetHeader style={{paddingTop:50}}><SheetTitle>{t("الإشعارات")}</SheetTitle><SheetDescription>{t('دعوات مؤهلة ونتائج تسوياتك المعتمدة.','Eligible invitations and approved settlement results.')}</SheetDescription></SheetHeader><div className="drawer-body">{state?.notifications.length?state.notifications.map(n=><div className="notice-item" key={n.id}><h3>{displayText(n.title??'')}</h3><p>{displayText(n.message??'')}</p><small>{date(n.created_at)}</small>{n.contract_id&&<button className="text-action" style={{display:'block',marginTop:10}} onClick={()=>{const c=state.contracts.find(c=>c.id===n.contract_id);if(c)chooseContract(c);setNotifyOpen(false);}}>{t("فتح العقد")}</button>}</div>):<Empty title={t("لا توجد إشعارات")} detail={t("ستظهر الدعوات الجديدة ونتائج التسوية هنا.")}/>}<p className="small muted">{t("إشعارات الهاتف خارج المنصة غير مربوطة في هذه النسخة.")}</p></div></SheetContent></Sheet>
  <Dialog open={joinOpen} onOpenChange={setJoinOpen}><DialogContent className="popup"><DialogHeader><DialogTitle className="popup-title">{t("تأكيد عقد التداول","Confirm trading contract")}</DialogTitle><DialogDescription className="popup-description">{displayText(selected?.title??'')}{t(" · تنفيذ وفق الشروط المعتمدة"," · Settled per confirmed terms")}</DialogDescription></DialogHeader>{selected&&<><div className="details-grid"><div><small>{t("الأصل المرجعي والاتجاه")}</small><span className="num">{selected.asset} · {selected.direction}</span></div><div><small>{t("مدة المشاركة")}</small><span>{fmtDur(selected.duration_sec)}</span></div><div><small>{t("مبلغ التداول","Trading amount")}</small><span className="num">{money(Math.round(Number(amount)*100))} USD</span></div><div><small>{t("نسبة التسوية المقفلة")}</small><span className="num">{percent(selected.settlement_bps)}</span></div><div><small>{t("النتيجة النهائية للتسوية","Final settlement outcome")}</small><span className="num">{money(resultCents(Math.round(Number(amount)*100),selected.settlement_bps))} USD</span></div><div><small>{t("الشروط مقفلة منذ")}</small><span>{date(selected.published_at)}</span></div></div><label className="agreement"><Checkbox checked={confirmed} onCheckedChange={v=>setConfirmed(v===true)}/><span>{t("راجعت النسبة والشروط. أفهم أن التسوية محددة مسبقًا ومقفلة رقميًا.")}</span></label><button className="btn-primary full" disabled={!confirmed||busy} onClick={()=>void join()}><Timer/>{t("تأكيد وبدء المؤقت")}</button></>}</DialogContent></Dialog>
  <Dialog open={!!receipt} onOpenChange={v=>{if(!v)setReceipt(null);}}><DialogContent className="popup"><DialogHeader><DialogTitle className="popup-title">{t("إيصال التسوية المعتمد","Settlement receipt")}</DialogTitle><DialogDescription className="popup-description">{t("إيصال تسوية موثّق ومشفر بالبصمة الرقمية.","Verified settlement receipt with cryptographic hash.")}</DialogDescription></DialogHeader>{receipt&&<ReceiptView receipt={receipt}/>}</DialogContent></Dialog>
  <Sheet open={auditOpen} onOpenChange={setAuditOpen}><SheetContent side="left" style={{width:'min(550px,100%)',maxWidth:550}} dir="rtl"><SheetHeader style={{paddingTop:50}}><SheetTitle>{t("سجل التدقيق")}</SheetTitle><SheetDescription>{t("أحداث الخادم وبصماتها. لا تتوفر عمليات تعديل أو حذف من المنصة.")}</SheetDescription></SheetHeader><div className="drawer-body audit-list">{state?.audit.map(a=><div className="audit-item" key={a.id}><div className="audit-top"><strong>{t(actionLabels[a.action]??a.action)}</strong><span>{date(a.created_at)}</span></div><p>{t("الفاعل:")}<span className="mono">{a.actor_id==='settlement-engine'?'Settlement Engine':a.actor_id===state.user.id?'حسابك':a.actor_id.slice(0,15)}</span></p><div className="hash-box">{a.payload_hash}</div></div>)}</div></SheetContent></Sheet>
 </div>;
}

function ReceiptView({receipt}:{receipt:Receipt}){
 const {t,prefs,number}=useOrin();const money=(c:number)=>number(c/100);const date=(n:number)=>new Date(n).toLocaleString(prefs.chartLocale+'-u-nu-latn',{timeZone:prefs.timezone});
 const r=JSON.parse(receipt.payload) as {receiptId:string;contractCode:string;asset:string;direction:string;amountCents:number;resultCents:number;returnedCents:number;durationSec:number;lockedSettlementBps:number;startedAt:number;endsAt:number;processedAt:number;contractHash:string;contractId:string;};
 return <><div className="receipt-title"><FileCheck2/><div><h3 className="mono">{r.receiptId}</h3><p className="small muted">{r.asset} · {r.direction}{t(" · تسوية معتمدة"," · Confirmed settlement")}</p></div></div><div className="details-grid"><div><small>{t("كود العقد")}</small><span className="mono small">{r.contractCode}</span></div><div><small>{t("المبلغ المخصص")}</small><span className="num">{money(r.amountCents)} USD</span></div><div><small>{t("النسبة المقفلة")}</small><span className="num">{percent(r.lockedSettlementBps)}</span></div><div><small>{t("نتيجة التسوية","Settlement outcome")}</small><span className={`num ${r.resultCents<0?'loss':'gain'}`}>{money(r.resultCents)} USD</span></div><div><small>{t("المبلغ المعاد للمحفظة")}</small><span className="num">{money(r.returnedCents)} USD</span></div><div><small>{t("المدة")}</small><span>{r.durationSec < 60 ? `${r.durationSec} ${t('ثانية','sec')}` : `${Math.round(r.durationSec / 60)} ${t('دقيقة','min')}`}</span></div><div><small>{t("بداية المشاركة")}</small><span>{date(r.startedAt)}</span></div><div><small>{t("انتهاء المدة / الاستحقاق")}</small><span>{date(r.endsAt)}</span></div><div><small>{t("وقت المعالجة الفعلية")}</small><span>{date(r.processedAt)}</span></div></div><p className="small muted">{t("معرّف العقد")}</p><div className="hash-box">{r.contractId}</div><p className="small muted paper-hash">{t("بصمة شروط العقد")}</p><div className="hash-box">{r.contractHash}</div><p className="small muted paper-hash">{t("بصمة الإيصال SHA-256")}</p><div className="hash-box">{receipt.hash}</div><div className="btn-row no-print"><button className="btn-primary" onClick={()=>download(`${r.receiptId}.json`,JSON.stringify({receipt:JSON.parse(receipt.payload),sha256:receipt.hash},null,2))}><Download/>{t("تنزيل الإيصال")}</button><button className="btn-outline" onClick={()=>window.print()}>{t("طباعة")}</button></div></>;
}

function TradeSuccessModal({
  open,
  contract,
  position,
  now,
  onClose
, onGoHome}: {
  open: boolean;
  contract: any;
  position?: any;
  now: number;
  onClose: () => void;
  onGoHome?: () => void;
}) {
  const { t, number } = useOrin();
  if (!open || !contract) return null;

  const rawAsset = String(contract.asset || 'GBPUSD').replace(/[^a-zA-Z0-9]/g, '');
  const isBuy = contract.direction === 'BUY';
  const amountStr = position?.amount_cents ? number(position.amount_cents / 100) : '1,000';

  const durSec = Number(contract.duration_sec || 120);
  const startedAt = position?.started_at
    ? (typeof position.started_at === 'number' ? position.started_at : new Date(position.started_at).getTime())
    : (now - 1000);
  const endsAt = position?.ends_at
    ? (typeof position.ends_at === 'number' ? position.ends_at : new Date(position.ends_at).getTime())
    : (startedAt + durSec * 1000);

  const remainingSec = Math.max(0, Math.floor((endsAt - now) / 1000));
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss = String(remainingSec % 60).padStart(2, '0');
  const progressRatio = Math.max(0, Math.min(1, (now - startedAt) / Math.max(1, endsAt - startedAt)));
  const progressPercent = Math.round(progressRatio * 100);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(6, 17, 31, 0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        boxSizing: 'border-box'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        dir="rtl"
        style={{
          width: '100%',
          maxWidth: '380px',
          background: '#ffffff',
          borderRadius: '24px',
          padding: '24px 20px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxSizing: 'border-box'
        }}
      >
        {/* Close Button X */}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('إغلاق', 'Close')}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            border: 0,
            background: 'none',
            color: '#64748b',
            cursor: 'pointer',
            padding: '4px',
            display: 'grid',
            placeItems: 'center'
          }}
        >
          <X size={20} />
        </button>

        {/* Center Blue Circle Checkmark */}
        <div
          style={{
            width: '58px',
            height: '58px',
            borderRadius: '50%',
            border: '2.5px solid #0788ff',
            background: '#eef6ff',
            display: 'grid',
            placeItems: 'center',
            margin: '4px 0 12px'
          }}
        >
          <Check size={30} color="#0788ff" strokeWidth={3} />
        </div>

        {/* Title & Subtitle */}
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#06111f', textAlign: 'center' }}>
          {t('تم تأكيد المشاركة', 'Participation Confirmed')}
        </h2>
        <p style={{ margin: '4px 0 16px', fontSize: '13.5px', color: '#64748b', textAlign: 'center' }}>
          {t('بدأ توقيت الصفقة', 'Trade timer started')}
        </p>

        {/* Strip matching Image 3: [● نشطة] [GBPUSD] [شراء] */}
        <div
          style={{
            width: '100%',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
            marginBottom: '14px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#166534' }}>
              {t('نشطة', 'Active')}
            </span>
          </div>

          <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', letterSpacing: '0.5px' }} dir="ltr">
            {rawAsset}
          </div>

          <span
            style={{
              padding: '4px 12px',
              borderRadius: '8px',
              fontSize: '12.5px',
              fontWeight: 700,
              background: isBuy ? '#dcfce7' : '#fee2e2',
              color: isBuy ? '#15803d' : '#dc2626'
            }}
          >
            {isBuy ? t('شراء', 'BUY') : t('بيع', 'SELL')}
          </span>
        </div>

        {/* Info Rows */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
            <span style={{ color: '#64748b' }}>{t('المبلغ', 'Amount')}</span>
            <b style={{ color: '#0f172a', fontWeight: 700 }} dir="ltr">
              {amountStr} USD
            </b>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
            <span style={{ color: '#64748b' }}>{t('الوقت المتبقي', 'Time Remaining')}</span>
            <b style={{ color: '#0f172a', fontWeight: 700, fontFamily: 'monospace', fontSize: '15px' }} dir="ltr">
              {mm}:{ss}
            </b>
          </div>
        </div>

        {/* Progress Bar */}
        <div
          style={{
            width: '100%',
            height: '6px',
            background: '#e2e8f0',
            borderRadius: '999px',
            overflow: 'hidden',
            marginBottom: '20px'
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPercent}%`,
              background: '#0788ff',
              borderRadius: '999px',
              transition: 'width 0.4s ease'
            }}
          />
        </div>

        {/* Action Button */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: '100%',
              height: '48px',
              borderRadius: '14px',
              border: 0,
              background: '#0788ff',
              color: '#ffffff',
              fontSize: '15px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(7, 136, 255, 0.3)'
            }}
          >
            {t('متابعة الصفقة', 'Track Trade')}
          </button>
          <button
            type="button"
            onClick={onGoHome ?? onClose}
            style={{
              width: '100%',
              height: '42px',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              background: 'transparent',
              color: '#64748b',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {t('العودة للرئيسية', 'Return to Homepage')}
          </button>
        </div>
      </div>
    </div>
  );
}
