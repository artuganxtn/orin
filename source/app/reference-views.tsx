'use client';
import {DemoBalanceDialog} from './demo-balance-dialog';
import {activeTradingAccount} from '@/lib/trading-accounts';
import {apiFetch} from '@/lib/client-api';
import {ArrowLeftRight} from 'lucide-react';
import {AssetBackdrop} from './asset-backdrop';
import {useLiveMarket,NativeCandles} from './live-market';
import {LiveAssetQuote,LiveQuoteSparkline,useMarketQuote} from './market-quote';
import {hasNativeFeed} from '@/lib/live-market';
import {useRoutePanel,useNavigation} from './orin-navigation';
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpFromLine,Bell,ChartNoAxesCombined,ChevronDown,Eye,EyeOff,Info,LockKeyhole,Maximize2,Minimize2,MoreHorizontal,Pencil,RefreshCw,Search,SlidersHorizontal,Star,Users,Wallet,Check,CheckCircle2,KeyRound,ClipboardList,Timer,ShieldCheck,ShieldAlert,Clock} from 'lucide-react';
import {FullPage as Dialog,FullPageContent as DialogContent,FullPageHeader as DialogHeader,FullPageTitle as DialogTitle,FullPageDescription as DialogDescription} from './full-page';
import {Select,SelectTrigger,SelectContent,SelectItem} from '@/components/ui/select';
import {SuccessRing} from './reference-charts';
import {MARKET_SYMBOLS,marketSymbol} from '@/lib/market-symbols';
import {percent,type LabState,type Contract,type Position,type Asset} from '@/lib/contracts';
import type {Preferences} from '@/lib/preferences';
import {useOrin} from './orin-settings';
import {FRAME_NAMES,INDICATOR_NAMES} from './account-settings';
import {SymbolSelector} from './symbol-selector';
import {InvitationActions} from './invitation-scanner';
import {sparkMode} from '@/lib/client-api';
import {BalanceAccounts} from './balance-accounts';
import type {AccountDirectory} from '@/lib/trading-accounts';
import {HomeNotificationPreview} from './notification-center';
const TradingViewChart=lazy(()=>import('./tradingview-widget').then(m=>({default:m.TradingViewChart})));

import {CoinIcon, AssetIcon} from './asset-icons';
export {CoinIcon, AssetIcon};
const remaining=(ms:number)=>`${String(Math.floor(Math.max(0,ms)/60000)).padStart(2,'0')}:${String(Math.floor(Math.max(0,ms)/1000)%60).padStart(2,'0')}`;
function ChartLoading(){const {error,reload,t}=useOrin();return <div className="chart-skeleton" role="status">{error?<><p>{t('تعذر تحميل إعدادات السوق.','Market configuration is unavailable.')}</p><button className="btn-outline" onClick={()=>void reload()}>{t('إعادة المحاولة','Retry')}</button></>:t('جار تجهيز الشارت…','Preparing chart…')}</div>;}
function useFavorites(){const {prefs,change,configuration,status,marketReady}=useOrin();return {favorites:prefs.favorites,enabled:configuration.favorites,busy:!marketReady||status==='saving'||status==='loading',toggle:(pair:string)=>{if(configuration.favorites)void change({favorites:prefs.favorites.includes(pair)?prefs.favorites.filter(s=>s!==pair):[...prefs.favorites,pair]});}};}
function ResilientCandles({feed,pair,retry,drawing=false,revision=0}:{feed:ReturnType<typeof useLiveMarket>;pair:string;retry:()=>void;drawing?:boolean;revision?:number}){
 const [fallback,setFallback]=useState(false);
 useEffect(()=>setFallback(false),[pair]);useEffect(()=>{if(feed.status==='error')setFallback(true)},[feed.status,pair]);
 if(fallback)return <Suspense fallback={<ChartLoading/>}><TradingViewChart symbol={marketSymbol(pair).tv}/></Suspense>;
 return <NativeCandles feed={feed} retry={retry} drawing={drawing} revision={revision}/>;
}
function MarketPanel({pair,compact=false,headerExternal=false}:{pair:string;compact?:boolean;headerExternal?:boolean}){
 const {prefs,change,configuration:c,t}=useOrin(),[revision,setRevision]=useState(0),native=hasNativeFeed(pair),root=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(!compact);
 useEffect(()=>{if(!compact||!root.current)return;if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'120px'});observer.observe(root.current);return()=>observer.disconnect()},[compact]);
 const feed=useLiveMarket(native&&visible?pair:null,prefs.chartInterval,revision);
 return <div ref={root} className="orin-market-panel">{native&&<LiveAssetQuote pair={pair} compact={compact} headerExternal={headerExternal}/>}<div className="trade-timeframes home-timeframes" role="group" aria-label={t('الفاصل الزمني','Timeframe')}>{c.enabledTimeframes.map(frame=><button key={frame} aria-pressed={prefs.chartInterval===frame} className={prefs.chartInterval===frame?'active':''} onClick={()=>void change({chartInterval:frame as Preferences['chartInterval']})}>{FRAME_NAMES[frame]}</button>)}</div>{native?<ResilientCandles feed={feed} pair={pair} retry={()=>setRevision(x=>x+1)} revision={revision}/>:<Suspense fallback={<ChartLoading/>}><TradingViewChart symbol={marketSymbol(pair).tv} height={compact?260:300}/></Suspense>}</div>;
}
function HomeKycBanner() {
  const { t } = useOrin();
  const { navigate } = useNavigation();
  const [kycStatus, setKycStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void apiFetch('/api/kyc')
      .then(res => res.ok ? res.json() : null)
      .then((data: any) => {
        if (active && data) setKycStatus(data.status);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (kycStatus === 'verified') return null;

  const isReview = kycStatus === 'review' || kycStatus === 'pending';
  const isRejected = kycStatus === 'rejected';

  return (
    <section className="kyc-overview-card home-kyc-banner" style={{ margin: '12px 0', padding: '16px', background: 'var(--orin-surface)', border: '1px solid var(--orin-line)', borderRadius: '16px' }}>
      <div className="kyc-overview-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div className="kyc-overview-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isReview ? (
            <Clock size={28} style={{ color: '#f59e0b', flex: 'none' }} />
          ) : isRejected ? (
            <ShieldAlert size={28} style={{ color: '#ff4d5e', flex: 'none' }} />
          ) : (
            <ShieldCheck size={28} style={{ color: '#0788ff', flex: 'none' }} />
          )}
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
              {isReview
                ? t('طلب التوثيق قيد المراجعة', 'KYC Request Under Review')
                : isRejected
                ? t('تم رفض طلب التوثيق', 'KYC Request Rejected')
                : t('أكمل تأكيد هويتك', 'Complete Identity Verification')}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--orin-muted)' }}>
              {isReview
                ? t('تم استلام وثائقك وهي قيد المراجعة من قبل فريق الامتثال.', 'Your documents were received and are under review by compliance.')
                : isRejected
                ? t('يرجى مراجعة سبب الرفض وإعادة تقديم وثيقة صالحة.', 'Please review rejection reason and re-submit a valid document.')
                : t('استكمل بيانات حسابك لإتمام الإيداع والتداول والسحب.', 'Complete your account details for deposits, trading, and withdrawals.')}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-primary kyc-action-btn"
          style={{
            padding: '8px 18px',
            fontSize: '13px',
            borderRadius: '10px',
            background: isReview ? '#f59e0b' : isRejected ? '#ff4d5e' : '#0788ff'
          }}
          onClick={() => navigate('/settings/kyc')}
        >
          {isReview ? t('متابعة حالة التوثيق', 'Check Status') : isRejected ? t('إعادة التقديم', 'Re-submit') : t('تحقق الآن', 'Verify Now')}
        </button>
      </div>
    </section>
  );
}

export function ReferenceHome({state,prefs,selectedPair,onPairChange,onHideBalance,onNavigate,onInvite,onFunding,onTerms,onAccountsChange,onTransfer,code='',setCode,amount='1000',setAmount,onExecuteCode,onLookupCode,busy=false,activePosition,now=Date.now(),progress=0}:{state:LabState|null;prefs:Preferences;selectedPair?:string;onPairChange?:(pair:string)=>void;onHideBalance:()=>void;onNavigate:(tab:string)=>void;onInvite:()=>void;onFunding:(kind:'deposit'|'withdraw')=>void;onTerms:()=>void;onTransfer?:()=>void;onAccountsChange?:(directory:AccountDirectory,phase?:'optimistic'|'confirmed'|'rollback')=>void;code?:string;setCode?:(s:string)=>void;amount?:string;setAmount?:(s:string)=>void;onExecuteCode?:(code:string,amount?:string)=>void;onLookupCode?:(code:string)=>void;busy?:boolean;activePosition?:Position;now?:number;progress?:number}){
 const {configuration,t,number,marketReady}=useOrin();const [localPair,setLocalPair]=useState(prefs.chartPair);const chosenPair=selectedPair??localPair,setPair=(value:string)=>{setLocalPair(value);onPairChange?.(value)};useEffect(()=>setLocalPair(prefs.chartPair),[prefs.chartPair]);const pair=configuration.enabledSymbols.includes(chosenPair)?chosenPair:configuration.defaultSymbol,symbol=marketSymbol(pair);
 const account=activeTradingAccount(state?.accountDirectory);
 const reloadAccounts=async()=>{const r=await apiFetch('/api/trading-accounts');if(!r.ok)throw new Error(t('تعذر قراءة الرصيد المحفوظ.','Unable to read saved balance.'));onAccountsChange?.(await r.json(),'confirmed')};
 const settled=state?.positions.filter(p=>p.status==='settled')??[],win=settled.length?100*settled.filter(p=>p.result_cents>0).length/settled.length:null;
 return <div className="reference-home">
  <BalanceAccounts state={state} onHideBalance={onHideBalance} onTerms={onTerms} onDirectoryChange={onAccountsChange}/>
  <HomeKycBanner/>
  <div className="quick-actions">
    <button type="button" onClick={()=>{
      const realAcc = state?.accountDirectory?.accounts.find(a=>a.type==='real');
      if(realAcc && state?.accountDirectory && state.accountDirectory.activeId !== realAcc.id){
        onAccountsChange?.({...state.accountDirectory, activeId: realAcc.id}, 'confirmed');
      }
      onFunding('deposit');
    }}><span><Wallet/></span>{t('إيداع','Deposit')}</button>
    <button type="button" onClick={()=>{
      const realAcc = state?.accountDirectory?.accounts.find(a=>a.type==='real');
      if(realAcc && state?.accountDirectory && state.accountDirectory.activeId !== realAcc.id){
        onAccountsChange?.({...state.accountDirectory, activeId: realAcc.id}, 'confirmed');
      }
      onFunding('withdraw');
    }}><span><ArrowUpFromLine/></span>{t('سحب','Withdraw')}</button>
    <button type="button" onClick={onTransfer}><span><ArrowLeftRight/></span>{t('تحويل','Transfer')}</button>
    <button type="button" onClick={onInvite}><span><Users/></span>{t('دعوة صديق','Invite a friend')}</button>
  </div>
  {activePosition&&(
   <div className="home-active-trade-card">
    <div className="home-active-top">
     <div className="live-status-pill"><span className="live-pulsing-dot"/><b>{t('صفقة تداول قيد التنفيذ الآن','Trade Active & In Progress')}</b></div>
     <div className="live-timer-badge"><Timer size={14}/><span className="num">{remaining(activePosition.ends_at-now)}</span></div>
    </div>
    <div className="home-active-meta">
     <div className="active-asset-tag"><CoinIcon symbol={activePosition.contract.asset} size={24}/><span><b>{activePosition.contract.asset}</b> · <small className={activePosition.contract.direction==='BUY'?'gain':'loss'}>{activePosition.contract.direction}</small></span></div>
     <div className="active-return-tag"><span>{t('الربح المقفل:','Locked Return:')}</span><strong className={`num ${activePosition.result_cents>=0?'gain':'loss'}`}>{activePosition.result_cents>=0?'+':''}{number(activePosition.result_cents/100)} USD</strong></div>
    </div>
    <div className="tracker-progress-wrap"><progress value={progress} max="1"/></div>
    <button className="btn-view-active-trade" onClick={()=>onNavigate('demo')}>{t('متابعة تفاصيل الصفقة والشارت المباشر','View Trade & Live Chart')} <ArrowLeft size={15}/></button>
   </div>
  )}
  <section className="home-market-card live-home-card"><AssetBackdrop pair={pair}/><div className="home-market-header home-quote-heading"><div className="home-quote-symbol"><CoinIcon symbol={pair.split('-')[0]}/><span><b className="num">{symbol.label}</b><small>{symbol.name}</small></span></div><Select value={pair} onValueChange={setPair}><SelectTrigger className="pair-select" aria-label={t('اختيار الأصل','Select symbol')}><ChevronDown size={17}/></SelectTrigger><SelectContent>{MARKET_SYMBOLS.filter(s=>configuration.enabledSymbols.includes(s.pair)).sort((a,b)=>configuration.enabledSymbols.indexOf(a.pair)-configuration.enabledSymbols.indexOf(b.pair)).map(s=><SelectItem key={s.pair} value={s.pair}>{s.label}</SelectItem>)}</SelectContent></Select>{marketReady&&hasNativeFeed(pair)&&<LiveQuoteSparkline pair={pair}/>}</div><Suspense fallback={<ChartLoading/>}>{marketReady?<MarketPanel pair={pair} headerExternal/>:<ChartLoading/>}</Suspense></section>
  <div className="performance-heading"><h2>{t('نظرة على الأداء','Performance overview')}</h2><button onClick={()=>onNavigate('wallet')}>{t('عرض الكل','See all')}</button></div><div className="performance-grid"><section><span>{t('إجمالي النتائج','Total results')} <Info size={12}/></span><strong className="num">{prefs.hideBalance?'••••':state?`${state.realizedCents>=0?'$':'-$'}${number(Math.abs(state.realizedCents)/100)}`:'—'}</strong><small>{t('تسويات الحساب','Account settlements')}</small><ChartNoAxesCombined className="performance-icon"/></section><section><span>{t('نسبة العقود الرابحة','Profitable contracts')}</span><strong className="num">{win===null?'—':`${number(win,1)}%`}</strong><small>{settled.length?t(`${settled.length} عقد مكتمل`,`${settled.length} settled contracts`):t('لا توجد تسويات بعد','No settlements yet')}</small><SuccessRing value={win}/></section></div>
  <HomeNotificationPreview/>
  <section className="orin-bot-card"><img src="/brand/orin-mark.png" alt=""/><span className="orin-coming-soon">{t('قريبًا','Coming soon')}</span><h2>{t('ذكاء ORIN بين يديك','Your ORIN advantage')}</h2><p>{t('مساحة للتداول الآلي، بهوية ORIN.','A home for automated trading, built around ORIN.')}</p><button type="button" disabled>{t('تفعيل البوت غير متاح','Bot activation unavailable')}</button><small>{t('غير متصل حاليًا. لن تُنفّذ صفقات أو تُخصم أموال.','Not connected yet. No trades or charges will be made.')}</small></section>
 </div>;
}
function MarketRow({symbol,active,onSelect}:{symbol:typeof MARKET_SYMBOLS[number];active:boolean;onSelect:(price?:number)=>void}){
 const {t,number}=useOrin(),feed=useMarketQuote(active&&hasNativeFeed(symbol.pair)?symbol.pair:null);
 return <button className="orin-market-row" onClick={()=>onSelect(feed.data?.price)} aria-label={t('فتح ','Open ')+symbol.label} data-pair={symbol.pair}><CoinIcon symbol={symbol.pair.split('-')[0]}/><span><b dir="ltr">{symbol.label}</b><small>{symbol.name}</small></span><span className="market-row-price">{feed.data?<><b dir="ltr">{number(feed.data.price,feed.data.price<1?5:2)}</b><small dir="ltr" className={feed.data.change<0?'loss':'gain'}>{number(feed.data.change)}%</small></>:<small>{t('عرض الشارت','View chart')}</small>}</span><ArrowLeft size={16}/></button>
}
export function ReferenceMarkets({onSelect,prefs,active=true}:{onSelect:(pair:string,price?:number)=>void;prefs:Preferences;active?:boolean}){
 const {configuration,theme,t,marketReady}=useOrin(),{favorites,toggle,enabled,busy}=useFavorites();const [category,setCategory]=useState('crypto'),[search,setSearch]=useState(''),[view,setView]=useState<'list'|'charts'>('list');
 const nav=useNavigation();const edit=nav.path==='/markets/favorites';const setEdit=(v:boolean)=>v?nav.navigate('/markets/favorites'):nav.back('/markets');
 const symbols=MARKET_SYMBOLS.filter(s=>configuration.enabledSymbols.includes(s.pair)).sort((a,b)=>configuration.enabledSymbols.indexOf(a.pair)-configuration.enabledSymbols.indexOf(b.pair));
 const filtered=symbols.filter(s=>category==='favorites'?enabled&&favorites.includes(s.pair):s.category===category).filter(s=>`${s.label} ${s.name}`.toLowerCase().includes(search.toLowerCase()));
 return <div className="reference-markets"><div className="market-categories">{[...(enabled?[['favorites',t('المفضلة','Favorites')]]:[]),['crypto',t('كريبتو','Crypto')],['forex',t('فوركس','Forex')],['metals',t('معادن','Metals')],['indices',t('مؤشرات','Indices')]].map(([key,label])=><button className={category===key?'active':''} key={key} onClick={()=>setCategory(key)}>{label}</button>)}</div><div className="market-search"><Search size={19}/><input placeholder={t('ابحث عن أصل…','Search assets…')} aria-label={t('البحث عن أصل','Search assets')} value={search} onChange={e=>setSearch(e.target.value)}/>{enabled&&<button onClick={()=>setEdit(true)} aria-label={t('إدارة المفضلة','Manage favorites')}><SlidersHorizontal size={21}/></button>}</div>
 <div className="market-view-switch" role="group" aria-label={t('عرض الأسواق','Market view')}><button aria-pressed={view==='list'} onClick={()=>setView('list')}>{t('قائمة الأسعار','Prices')}</button><button aria-pressed={view==='charts'} onClick={()=>setView('charts')}>{t('الأسعار والمنحنيات','Price charts')}</button><span>{t('أصول','Assets')} · {filtered.length}</span></div>
 {!marketReady?<ChartLoading/>:filtered.length?<><div className="market-open-select"><label htmlFor="open-market">{t('فتح الشارت','Open chart')}</label><select id="open-market" value="" onChange={e=>{if(e.target.value)onSelect(e.target.value)}}><option value="" disabled>{t('اختر الأصل','Select symbol')}</option>{filtered.map(s=><option key={s.pair} value={s.pair}>{s.label}</option>)}</select></div>{view==='charts'?<div className="market-chart-list">{filtered.map(s=><section className="market-chart-card" key={s.pair}><button className="market-card-open" onClick={()=>onSelect(s.pair)}><CoinIcon symbol={s.pair.split('-')[0]}/><b className="num">{s.label}</b><span>{t('فتح الشارت','Open chart')}</span><ArrowLeft size={16}/></button><Suspense fallback={<ChartLoading/>}><MarketPanel pair={s.pair} compact/></Suspense></section>)}</div>:<div className="orin-market-rows">{filtered.map(symbol=><MarketRow key={symbol.pair} symbol={symbol} active={active} onSelect={price=>onSelect(symbol.pair,price)}/>)}</div>}</>:<div className="no-assets">{category==='favorites'?t('أضف أصولًا من زر إدارة المفضلة.','Add assets using Manage favorites.'):t('لا توجد نتائج مطابقة.','No matching assets.')}</div>}
 <p className="markets-note">{t('توفّر الأسعار وتأخيرها بحسب السوق ومصدر البيانات.','Quote availability and delay depend on the market and data provider.')}</p>
 <Dialog open={edit} onOpenChange={setEdit}><DialogContent className="popup favorites-dialog"><DialogHeader><DialogTitle>{t('قائمة المفضلة','Favorites')}</DialogTitle><DialogDescription>{t('أصولك المفضلة تتزامن مع حسابك عند تسجيل الدخول.','Favorites sync across devices when you sign in.')}</DialogDescription></DialogHeader><div className="favorite-manager">{symbols.map(s=><button key={s.pair} disabled={busy} aria-pressed={favorites.includes(s.pair)} onClick={()=>toggle(s.pair)}><CoinIcon symbol={s.pair.split('-')[0]}/><span><b className="num">{s.label}</b><small>{s.name}</small></span><Star className={favorites.includes(s.pair)?'saved':''}/></button>)}</div></DialogContent></Dialog>
 </div>;
}
interface TradeProps{state:LabState|null;current:Contract;selected:Contract|null;active?:Position;now:number;progress:number;code:string;setCode:(s:string)=>void;amount:string;setAmount:(s:string)=>void;lookup:()=>void;onExecuteCode?:(code:string,amount?:string)=>void;startJoin:()=>void;onBack:()=>void;onNotifications:()=>void;referencePair:string;setReferencePair:(s:string)=>void;mode:string;setMode:(s:string)=>void;busy:boolean;onAsset:(asset:Asset)=>void;prefs:Preferences;}
export function ReferenceTrade(p:TradeProps){
 const {prefs,configuration:c,change,t,number,settings,status,marketReady}=useOrin(),{favorites,toggle,enabled,busy}=useFavorites();const stage=useRef<HTMLDivElement>(null);const [full,setFull]=useState(false),[options,setOptions]=useState(false),[reset,setReset]=useState(0);
 useEffect(()=>{if(!full)return;const old=document.body.style.overflow;document.body.style.overflow='hidden';const previousFocus=document.activeElement as HTMLElement|null;stage.current?.querySelector<HTMLButtonElement>('button')?.focus();const escape=(e:KeyboardEvent)=>{if(document.querySelector('[data-slot=dialog-content]'))return;if(e.key==='Escape')setFull(false);if(e.key==='Tab'){const nodes=Array.from(stage.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],iframe')??[]).filter(el=>el.getBoundingClientRect().width>0);const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',escape);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',escape);previousFocus?.focus();};},[full]);
 useEffect(()=>{if(!c.fullscreen)setFull(false);},[c.fullscreen]);
 const invited=p.mode==='invited',requestedPair=invited?p.current.asset.replace('USD','-USD'):p.referencePair,pair=c.enabledSymbols.includes(requestedPair)?requestedPair:c.defaultSymbol,symbol=marketSymbol(pair),asset=pair.split('-')[0],locked=p.active?.contract??p.selected;
 const native=hasNativeFeed(pair),feed=useLiveMarket(native?pair:null,prefs.chartInterval,reset);
 const [drawing,setDrawing]=useState(false);useEffect(()=>setDrawing(false),[pair]);
 const [panel,setPanel]=useRoutePanel('/trade',['indicators','drawings','alerts'] as const);
 const canJoin=!sparkMode()&&!!p.selected&&!p.active&&!p.busy&&settings?.profile.closureStatus!=='requested'&&p.now>=p.selected.opens_at&&p.now<p.selected.closes_at&&!p.state?.positions.some(row=>row.contract_id===p.selected!.id);
 const selectPair=(value:string)=>{if(invited&&['BTC-USD','ETH-USD','XAU-USD'].includes(value))p.onAsset(value.replace('-','') as Asset);else{p.setReferencePair(value);p.setMode('market');}void change({chartPair:value});};
 return <div className="reference-trade"><AssetBackdrop pair={pair}/><div className="trade-titlebar"><button aria-label={t('العودة','Back')} onClick={p.onBack}><ArrowLeft/></button><SymbolSelector onSelect={selectPair} disabled={invited&&!!locked}><CoinIcon symbol={asset}/><span className="num">{symbol.label}</span><ChevronDown size={17}/></SymbolSelector>{enabled&&<button aria-label={t('المفضلة','Favorite')} disabled={busy} aria-pressed={favorites.includes(pair)} className={favorites.includes(pair)?'selected-star':''} onClick={()=>toggle(pair)}><Star/></button>}<button aria-label={t('تفاصيل العرض','Chart information')} onClick={()=>setOptions(!options)}><MoreHorizontal/></button></div>
  {options&&<div className="trade-options">{native?t('شموع مرجعية من Coinbase Exchange. مصدر بيانات البطاقة ووقت تحديثها موضحان أسفل السعر.','Reference candles from Coinbase Exchange. The card shows its quote source and update time below the price.'):t('المصدر TradingView. قد تتأخر الأسعار. وقت آخر سعر غير متاح عبر هذا التكامل لـ ORIN. تتحقق الأداة من اتصالها بالسوق؛ ORIN يستطيع اكتشاف انقطاع شبكة الجهاز فقط.','Source: TradingView. Quotes may be delayed. The last quote timestamp is not exposed to ORIN. The widget manages its market connection; ORIN can detect device network loss only.')}</div>}
  {pair!==requestedPair&&invited&&<p className="execution-note">{t('أصل العقد غير مفعّل في قائمة الشارت الحالية. الرمز الظاهر مرجع آخر ولا يغيّر العقد.','The contract asset is disabled in the chart list. The displayed reference symbol does not change your contract.')}</p>}
  <div className="trade-price-summary">{!marketReady?<ChartLoading/>:native?<LiveAssetQuote pair={pair}/>:null}</div>
  <div ref={stage} className={`chart-stage ${full?'is-fullscreen':''}`} role={full?'dialog':undefined} aria-modal={full?true:undefined} aria-label={full?`${symbol.label} chart`:undefined}>
   {full&&<div className="fullscreen-heading"><b>{symbol.label}</b><span>Market Reference</span><button aria-label={t('إغلاق التكبير','Exit fullscreen')} onClick={()=>setFull(false)}><Minimize2/></button></div>}
   <div className="trade-timeframes">{c.enabledTimeframes.map(f=><button key={f} disabled={busy} className={prefs.chartInterval===f?'active':''} onClick={()=>void change({chartInterval:f as Preferences['chartInterval']})}>{FRAME_NAMES[f]}</button>)}{c.fullscreen&&<button aria-label={t('تكبير الشارت','Fullscreen chart')} onClick={()=>setFull(!full)}>{full?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button>}</div>
   {native&&drawing&&<p className="native-draw-hint">{t('المس نقطتين لرسم خط اتجاه. الرسم مؤقت لهذا العرض.','Tap two points to draw a trend line. Drawing is temporary for this view.')}</p>}
   <div className="detail-chart tradingview-detail"><Suspense fallback={<ChartLoading/>}>{marketReady?native?<ResilientCandles feed={feed} pair={pair} retry={()=>setReset(x=>x+1)} drawing={drawing} revision={reset}/>:<TradingViewChart key={reset} symbol={symbol.tv}/>:<ChartLoading/>}</Suspense></div>
   <div className="chart-tool-row"><button onClick={()=>setPanel('indicators')}><SlidersHorizontal/>{t('المؤشرات','Indicators')}{prefs.indicators.length>0&&<i>{prefs.indicators.length}</i>}</button><button aria-pressed={native?drawing:undefined} onClick={()=>native?setDrawing(x=>!x):setPanel('drawings')}><Pencil/>{t('رسم وتحليل','Draw')}</button><button onClick={()=>setPanel('alerts')}><Bell/>{t('التنبيهات','Alerts')}</button><button onClick={()=>setReset(x=>x+1)}><RefreshCw/>{t('إعادة العرض','Reset view')}</button></div>
  </div>
  <div className="order-modes" role="tablist" aria-label={t('نوع الأمر','Order type')}>
   {[['market',t('سوق','Market')],['limit',t('أمر محدد','Limit')],['invited',t('دعائي','Invited')]].map(([v,label])=><button role="tab" aria-selected={p.mode===v} className={p.mode===v?'active':''} onClick={()=>p.setMode(v)} key={v}>{label}</button>)}
  </div>
  {invited&&<div className="invite-inline">
   <label htmlFor="invite-code">{t('كود الدعوة','Invitation code')}</label>
   <div>
    <input id="invite-code" placeholder="LAB-XXXXXXXXXX" value={p.code} onChange={e=>p.setCode(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==='Enter'){if(p.onExecuteCode&&p.code.trim())p.onExecuteCode(p.code,p.amount);else p.lookup();}}} maxLength={30} autoCapitalize="characters" spellCheck={false}/>
    <button onClick={()=>{if(p.onExecuteCode&&p.code.trim())p.onExecuteCode(p.code,p.amount);else p.lookup();}} disabled={!p.state||!p.code.trim()||p.busy}>{p.busy?t('جارِ التحقق…','Verifying…'):t('تحقق','Verify')}</button>
   </div>
   <InvitationActions onCode={p.setCode}/>
   {locked&&<span className="locked-inline"><LockKeyhole size={14}/>{t('التسوية المقفلة','Locked settlement')} <b className="num">{percent(locked.settlement_bps)}</b> · {locked.duration_sec/60} {t('دقيقة','min')}</span>}
  </div>}
  {p.active&&invited&&<div className="active-ticket">
   <div><span>{t('المركز نشط','Position active')}</span><strong className="num">{remaining(p.active.ends_at-p.now)}</strong></div>
   <div><span>{t('نتيجة العقد عند اكتماله','Result at maturity')}</span><b className={`num ${p.active.result_cents>=0?'gain':'loss'}`}>{p.active.result_cents>=0?'+':''}{number(p.active.result_cents/100)} USD</b></div>
   <progress value={p.progress} max="1"/>
   <small>{t('تسوية داخلية مقفلة؛ لا تتغير مع الشارت.','Locked internal settlement; independent of the chart.')}</small>
  </div>}
  <label className="amount-label" htmlFor="trade-amount">{t('المبلغ','Amount')} <span className="num">(USD)</span></label>
  <div className="trade-amount">
   <button aria-label={t('إعادة تعيين المبلغ','Reset amount')} onClick={()=>p.setAmount('1000')} disabled={!!p.active&&invited}><RefreshCw size={16}/></button>
   <input id="trade-amount" type="number" step="0.01" min="1" value={p.active&&invited?(p.active.amount_cents/100):p.amount} onChange={e=>p.setAmount(e.target.value)} disabled={!!p.active&&invited}/>
  </div>
  <div className="amount-percent">
   {[100,75,50,25].map(n=><button key={n} disabled={!p.state||(!!p.active&&invited)} onClick={()=>p.setAmount((Math.floor((p.state?.balanceCents??0)*n/100)/100).toFixed(2))}>{n}%</button>)}
  </div>
  <div className="trade-totals">
   <div><span>{t('الرسوم','Fees')}</span><b className="num">{invited&&!sparkMode()?`${number(0)} USD`:'—'}</b></div>
   <div><span>{t('الإجمالي','Total')}</span><b className="num">{Number.isFinite(Number(p.amount))?number(Number(p.amount)):'—'} USD</b></div>
  </div>
  {(!invited||sparkMode())&&<div className="execution-note"><LockKeyhole size={14}/>{sparkMode()?t('عرض السوق فقط. التداول وحجز الأرصدة غير مفعلين في هذه النسخة.','Market view only. Trading and balance allocation are unavailable in this release.'):t('تنفيذ أوامر السوق غير متصل. استخدم «دعائي» للعقود الداخلية.','Market execution is not connected. Use Invited for internal contracts.')}</div>}
  <button className="btn-primary full" disabled={!invited||!canJoin} onClick={p.startJoin} style={{minHeight:'52px',fontSize:'16px',borderRadius:'16px',marginTop:'10px'}}>
   {t('تأكيد الدخول في الصفقة','Confirm Trade Entry')}
  </button>
  <p className="trade-disclosure">{invited?t('حساب تجريبي · النتيجة وفق شروط العقد، لا حركة السوق.','Demo account · Settlement follows the contract terms, not market movement.'):'Market Reference · '+t('للقراءة فقط','View only')}</p>
  <Dialog open={panel!==null} onOpenChange={v=>{if(!v)setPanel(null)}}><DialogContent className="popup chart-tools-dialog" dir={prefs.chartLocale==='ar'?'rtl':'ltr'}><DialogHeader><DialogTitle>{panel==='indicators'?t('المؤشرات','Indicators'):panel==='drawings'?t('رسم وتحليل','Drawing & analysis'):t('تنبيهات الأسعار','Price alerts')}</DialogTitle><DialogDescription>{panel==='indicators'?t('اختر من المؤشرات التي فعّلتها الإدارة.','Choose from the indicators enabled by your administrator.'):t('حالة التكامل الحالي','Current integration capability')}</DialogDescription></DialogHeader>{panel==='indicators'?<div className="indicator-list">{c.allowedIndicators.map(k=><button key={k} disabled={status==='saving'||status==='loading'} aria-pressed={prefs.indicators.includes(k)} onClick={()=>void change({indicators:prefs.indicators.includes(k)?prefs.indicators.filter(x=>x!==k):[...prefs.indicators,k]})}><span><b>{INDICATOR_NAMES[k]}</b><small>{native?({MA:'9',EMA:'9',RSI:'14',MACD:'12 / 26 / 9',BB:'20 / 2'} as Record<string,string>)[k]:t('إعدادات المؤشر','Indicator parameters')}</small></span>{prefs.indicators.includes(k)?<Check/>:<span className="empty-check"/>}</button>)}{!c.allowedIndicators.length&&<p>{t('لا توجد مؤشرات مفعّلة.','No indicators enabled.')}</p>}</div>:<div className="capability-message"><LockKeyhole/><p>{panel==='drawings'?t('لوحة رسم ORIN وحفظ الرسومات غير متصلين. يحتاجان تكاملًا يدعم أدوات الرسم عبر API لمعالجة الرسومات وحفظها.','An ORIN drawing panel and drawing storage are not connected. They require an integration with a drawing API.'):t('تنبيهات الأسعار غير متاحة في هذا التكامل؛ تحتاج بيانات أسعار تصل إلى الخادم وخدمة Push متصلة. إشعارات العقود متاحة في مركز الإشعارات.','Price alerts require a server-side price feed and a connected push service. Contract notifications are available in the notification center.')}</p>{panel==='alerts'&&<button className="btn-outline full" onClick={()=>{setPanel(null);p.onNotifications();}}>{t('إشعارات العقود','Contract notifications')}</button>}</div>}</DialogContent></Dialog>
 </div>;
}
