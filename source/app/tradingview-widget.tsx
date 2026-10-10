'use client';
import {ChartBoundary} from './chart-boundary';
import {diagnostic} from '@/lib/diagnostics';
import {memo,useEffect,useRef,useState} from 'react';
import {RefreshCw,WifiOff} from 'lucide-react';
import {useOrin} from './orin-settings';
// Official public embeds own market data and attribution. No internal financial data is passed.
const SCRIPTS={advanced:'embed-widget-advanced-chart.js',markets:'embed-widget-market-overview.js'} as const;
type Props={kind:keyof typeof SCRIPTS;config:Record<string,unknown>;height:number;title:string};
function Widget({kind,config,height,title}:Props){
 const {t}=useOrin();const host=useRef<HTMLDivElement>(null),[status,setStatus]=useState<'loading'|'embedded'|'error'>('loading'),[revision,setRevision]=useState(0),[offline,setOffline]=useState(!navigator.onLine);
 const serialized=JSON.stringify(config);
 useEffect(()=>{const online=()=>{setOffline(false);setRevision(x=>x+1)},off=()=>{setOffline(true);diagnostic('chart','offline',{symbol:String(config.symbol??'markets')})};window.addEventListener('online',online);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',online);window.removeEventListener('offline',off)}},[config.symbol]);
 useEffect(()=>{
  const root=host.current;if(!root)return;setStatus('loading');if(!navigator.onLine){setStatus('error');return;}
  const container=document.createElement('div');container.className='tradingview-widget-container';container.style.height='100%';container.style.width='100%';
  const target=document.createElement('div');target.className='tradingview-widget-container__widget';target.style.height='100%';target.style.width='100%';container.appendChild(target);root.replaceChildren(container);
  const script=document.createElement('script');script.src=`https://s3.tradingview.com/external-embedding/${SCRIPTS[kind]}`;script.async=true;script.type='text/javascript';script.textContent=serialized;
  let alive=true,loaded=false,ready=false;const frames=new Set<HTMLIFrameElement>();
  const failed=(reason:string)=>{if(!alive)return;setStatus('error');diagnostic('chart',reason,{provider:'TradingView',symbol:String(JSON.parse(serialized).symbol??'markets'),online:navigator.onLine})};
  const done=()=>{loaded=true;if(alive)setStatus('embedded')};
  const inspect=()=>{container.querySelectorAll('iframe').forEach(frame=>{if(frames.has(frame))return;frames.add(frame);frame.title=title;frame.addEventListener('load',done,{once:true})})};
  // Capture precedes the embed script's message handler; verify both origin and frame identity.
  const message=(event:MessageEvent)=>{if(!alive)return;const frame=[...frames].find(f=>f.contentWindow===event.source);if(!frame)return;let origin:string;try{origin=new URL(frame.src).origin}catch{return}if(event.origin!==origin)return;let data=event.data;try{if(typeof data==='string')data=JSON.parse(data)}catch{return}if(data?.name==='tv-widget-ready'){ready=true;done()}if(data?.name==='tv-widget-no-data')failed('symbol_unavailable')};
  window.addEventListener('message',message,true);
  const observer=new MutationObserver(inspect);observer.observe(container,{childList:true,subtree:true});script.onerror=()=>failed('script_failed');container.appendChild(script);inspect();
  const timeout=window.setTimeout(()=>{if(!alive)return;if(!loaded)failed('frame_timeout');else if(!ready){diagnostic('chart','data_confirmation_unavailable',{symbol:String(JSON.parse(serialized).symbol??'markets')})}},15000);
  return()=>{alive=false;clearTimeout(timeout);observer.disconnect();window.removeEventListener('message',message,true);script.onerror=null;for(const f of frames)f.removeEventListener('load',done);root.replaceChildren()};
 },[kind,serialized,revision,title]);
 return <section className={`tv-embed tv-${kind}`} aria-label={title} data-chart-status={offline?'offline':status}>
  {offline&&<div className="market-offline" role="status"><WifiOff size={14}/><span>{t('الجهاز غير متصل. ستتم إعادة المحاولة عند عودة الإنترنت.','Offline. Reconnecting when internet returns.')}</span></div>}
  <div className="tv-frame" style={{height}}><div ref={host} className="tv-host"/>{status==='loading'&&<div className="tv-loading" role="status"><span/>{t('جار تحميل الشارت…','Loading chart…')}</div>}{status==='error'&&<div className="tv-error" role="alert"><WifiOff/><strong>{t('تعذر تحميل الشارت','Chart unavailable')}</strong><p>{t('تحقق من الاتصال ثم أعد المحاولة.','Check your connection and try again.')}</p><button onClick={()=>setRevision(x=>x+1)}><RefreshCw size={16}/>{t('إعادة المحاولة','Retry')}</button></div>}</div>
 </section>;
}
export const TradingViewWidget=memo(Widget);
const STUDIES:Record<string,string>={MA:'MASimple@tv-basicstudies',EMA:'MAExp@tv-basicstudies',RSI:'RSI@tv-basicstudies',MACD:'MACD@tv-basicstudies',BB:'BB@tv-basicstudies'};
export function TradingViewChart({symbol,interval,locale,style,height=330,overview=false}:{symbol:string;interval?:string;locale?:string;style?:string;height?:number;overview?:boolean}){
 const {prefs,theme,configuration}=useOrin();
 return <ChartBoundary resetKey={symbol}><TradingViewWidget kind="advanced" height={height} title={`TradingView ${symbol}`} config={{autosize:true,symbol,interval:interval??prefs.chartInterval,timezone:prefs.timezone,theme,style:style??prefs.chartStyle,locale:locale??prefs.chartLocale,allow_symbol_change:false,hide_top_toolbar:true,hide_side_toolbar:true,hide_legend:true,hide_volume:overview||!configuration.volume,withdateranges:false,save_image:false,calendar:false,details:false,hotlist:false,backgroundColor:theme==='dark'?'#0B192A':'#ffffff',gridColor:prefs.grid?(theme==='dark'?'rgba(148,170,200,0.08)':'rgba(222,231,244,0.45)'):'rgba(0,0,0,0)',studies:overview?[]:prefs.indicators.filter(k=>configuration.allowedIndicators.includes(k)).map(k=>STUDIES[k]),support_host:'https://www.tradingview.com'}}/></ChartBoundary>;
}
