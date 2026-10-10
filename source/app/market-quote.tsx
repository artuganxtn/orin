'use client';
import {useCallback,useContext,useEffect,useId,useMemo,useState,useSyncExternalStore} from 'react';
import {quoteStream,type QuoteFeed} from '@/lib/quote-stream';
import {sparklineGeometry} from '@/lib/sparkline';
import {miniHistory,miniHistorySegments,MINI_WINDOW,MINI_INTERVAL,type MiniHistory} from '@/lib/mini-history';
import {hasNativeFeed} from '@/lib/live-market';
import {marketSymbol} from '@/lib/market-symbols';
import {useOrin} from './orin-settings';
import {MarketPreviewContext} from './live-market';

const inactive:QuoteFeed={pair:'',data:null,status:'loading',streaming:false};
export function useMarketQuote(pair:string|null):QuoteFeed{
 const preview=useContext(MarketPreviewContext);
 const subscribe=useCallback((listener:()=>void)=>pair&&!preview?quoteStream().subscribe(pair,listener):()=>{},[pair,preview]);
 const snapshot=useCallback(()=>pair&&!preview?quoteStream().getSnapshot(pair):inactive,[pair,preview]);
 const feed=useSyncExternalStore(subscribe,snapshot,()=>inactive);
 if(pair&&preview){const data=preview(pair,'D');return {pair,status:'ready',streaming:false,data:{...data,asOf:Date.parse(data.tradeTime)}}}
 return feed;
}
// Keep frequent quote renders below the chart's component boundary.
export function LiveAssetQuote({pair,compact=false,headerExternal=false}:{pair:string;compact?:boolean;headerExternal?:boolean}){
 const feed=useMarketQuote(pair);return <AssetQuote pair={pair} feed={feed} compact={compact} headerExternal={headerExternal}/>;
}
export function LiveQuoteSparkline({pair}:{pair:string}){
 const feed=useMarketQuote(pair);return <QuoteSparkline feed={feed} pair={pair}/>;
}
export function AssetQuote({pair,feed,compact=false,headerExternal=false}:{pair:string;feed:QuoteFeed;compact?:boolean;headerExternal?:boolean}){
 const {t,number,prefs}=useOrin(),data=feed.pair===pair?feed.data:null;
 const [base,quote]=pair.split('-'),digits=data&&data.price<1?5:2;
 const stale=!!data&&(Date.now()-data.fetchedAt>90000||feed.status==='delayed'||feed.status==='unavailable'||feed.status==='offline');
 const range=data&&data.high>data.low?Math.max(0,Math.min(100,(data.price-data.low)/(data.high-data.low)*100)):50;
 const value=(n:number|undefined,precision=digits)=>n===undefined?<span className={'quote-empty'+(!data&&feed.status==='loading'?' quote-placeholder':'')}>{feed.status==='loading'?'…':'—'}</span>:number(n,precision);
 return <div className={'market-native-summary asset-quote'+(compact?' compact':'')} aria-busy={!data&&feed.status==='loading'}>
  {!headerExternal&&<div className="asset-quote-heading"><div className="asset-quote-identity"><span>{marketSymbol(pair).name}</span><small dir="ltr">{base} · {quote}</small></div>{!compact&&<QuoteSparkline feed={feed} pair={pair}/>}</div>}
  <div className="native-price"><strong className="num" dir="ltr">{value(data?.price)} <small>{quote}</small></strong><span dir="ltr" className={!data?'quote-neutral':data.change<0?'loss':'gain'}>{data?`${data.change>=0?'+':''}${number(data.price-data.open,digits)} (${data.change>=0?'+':''}${number(data.change)}%)`:value(undefined)} <small>{t('آخر 24 ساعة','24h change')}</small></span></div>
  {!compact&&<><dl>{[[t('أعلى · 24 ساعة','24h high'),data?.high,quote],[t('أدنى · 24 ساعة','24h low'),data?.low,quote],[t('الحجم · 24 ساعة','24h volume'),data?.volume,base]].map(([label,n,unit],index)=><div key={String(label)}><dt>{label}</dt><dd dir="ltr">{value(typeof n==='number'?n:undefined,index===2?2:digits)} <small>{unit}</small></dd></div>)}</dl>{data&&!headerExternal&&<div className="quote-day-range"><div className="quote-range-track" aria-hidden="true"><i style={{left:`${range}%`}}/></div><div><span>{t('نطاق آخر 24 ساعة','24h range')}</span><span>{t('الافتتاح','Open')} <b dir="ltr">{number(data.open,digits)} {quote}</b></span></div></div>}</>}
  <div className={'quote-feed-status'+(stale?' quote-stale':'')} role="status"><span><i aria-hidden="true"/>{feed.status==='offline'?t('غير متصل · آخر بيانات متاحة','Offline · last available quote'):!data?feed.status==='loading'?t('جار الاتصال بالسوق…','Connecting to market…'):t('بيانات السوق غير متاحة مؤقتًا','Market data temporarily unavailable'):stale?t('آخر سعر متاح','Last available price'):feed.streaming?t('مباشر','Live'):t('السعر المرجعي','Reference price')}{data&&<><time dateTime={new Date(data.asOf).toISOString()} dir="ltr">{new Date(data.asOf).toLocaleTimeString('en-GB',{timeZone:prefs.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><small dir="ltr">{data.source}</small></>}</span></div>
 </div>;
}

export function QuoteSparkline({feed,pair=feed.pair}:{feed:QuoteFeed;pair?:string}){
 const {t,number}=useOrin(),id=useId().replace(/:/g,'');
 const preview=useContext(MarketPreviewContext);
 const [history,setHistory]=useState<MiniHistory|null>(()=>miniHistory.peekAvailable(pair));
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
  let active=true;
  setHistory(miniHistory.peekAvailable(pair));setFailed(false);
  // Test fixtures are explicitly supplied; production never synthesizes a price path.
  if(preview){const data=preview(pair,'15');setHistory({pair,source:'Coinbase Exchange',points:data.candles.map(c=>({at:c.time,price:c.close})),windowEnd:(data.candles[data.candles.length-1]?.time??Date.now())+15*60*1000});return}
  if(!hasNativeFeed(pair)){setFailed(true);return}
  let timer:ReturnType<typeof setTimeout>|undefined,loading=false,failures=0,nextDelay=MINI_INTERVAL;
  const load=()=>{
   if(timer)clearTimeout(timer);if(!active||loading)return;
   if(navigator.onLine===false){setFailed(true);return}if(document.hidden)return;loading=true;
   // Retry transient failures quickly; a successful historical ribbon stays still for 15 minutes.
   void Promise.resolve().then(()=>miniHistory.loadAvailable(pair)).then(value=>{if(active){setHistory(value);setFailed(false);failures=0;nextDelay=Math.max(1000,MINI_INTERVAL-(Date.now()-(value.receivedAt??Date.now())))}},()=>{if(active){setFailed(true);failures++}}).finally(()=>{loading=false;if(active&&!document.hidden&&navigator.onLine!==false)timer=setTimeout(load,failures?Math.min(60000,2000*2**Math.min(failures-1,5)):nextDelay)});
  };
  load();window.addEventListener('online',load);window.addEventListener('offline',load);document.addEventListener('visibilitychange',load);
  return()=>{active=false;if(timer)clearTimeout(timer);window.removeEventListener('online',load);window.removeEventListener('offline',load);document.removeEventListener('visibilitychange',load)};
 },[pair,preview]);
 const current=history?.pair===pair&&(preview||Date.now()-(history.receivedAt??history.windowEnd)<MINI_WINDOW)?history:null;
 const shapes=useMemo(()=>{
  if(!current)return [];
  const points=current.points,prices=points.map(p=>p.price);
  const bounds={width:320,height:84,start:current.windowEnd-MINI_WINDOW,end:current.windowEnd,min:Math.min(...prices),max:Math.max(...prices)};
  return miniHistorySegments(points).map(segment=>sparklineGeometry(segment,bounds)).filter(Boolean);
 },[current]);
 const label=t('آخر 24 ساعة · فواصل 15 دقيقة','Last 24 hours · 15-minute intervals');
 return <div className="quote-sparkline quote-sparkline-history"><div className="quote-sparkline-plot" role="img" aria-label={label}>
 {shapes.length?<svg viewBox="0 0 320 84" preserveAspectRatio="none" aria-hidden="true"><defs>
  <linearGradient id={id+'-fill'} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#20b792" stopOpacity=".22"/><stop offset="100%" stopColor="#20b792" stopOpacity="0"/></linearGradient>
  <linearGradient id={id+'-line'} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#b2e6d9"/><stop offset="28%" stopColor="#21b994"/><stop offset="100%" stopColor="#16ac89"/></linearGradient>
 </defs>{shapes.map((geometry,i)=><g key={i}><path d={geometry!.area} fill={'url(#'+id+'-fill)'}/><path d={geometry!.path} fill="none" stroke={'url(#'+id+'-line)'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/></g>)}</svg>:<span className="sparkline-wait">{failed?t('السجل غير متاح مؤقتًا','History temporarily unavailable'):t('جار تحميل سجل الأسعار…','Loading price history…')}</span>}
 </div>{feed.data&&<b className={'sparkline-change '+(feed.data.change<0?'loss':'gain')} dir="ltr" title={t('التغير خلال آخر 24 ساعة','Change over the last 24 hours')}>{feed.data.change>=0?'+':''}{number(feed.data.change)}%</b>}
 <small className="sparkline-period">{label}{current&&<> · <span dir="ltr">{current.source}</span>{failed&&<> · {t('آخر سجل متاح','Last available history')}</>}</>}</small></div>;
}
