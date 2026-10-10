import {diagnostic} from './diagnostics';
import type {Candle,MarketData} from './contracts';
export const NATIVE_PAIRS=['BTC-USD','ETH-USD','XRP-USD','SOL-USD','DOGE-USD','ADA-USD'] as const;
export function hasNativeFeed(pair:string){return (NATIVE_PAIRS as readonly string[]).includes(pair)}
const intervals:Record<string,number>={'1':60,'5':300,'15':900,'60':3600,'240':3600,'D':86400};
export function decodeMarket(pair:string,frame:string,ticker:any,stats:any,raw:unknown,now=Date.now()):MarketData{
 const price=Number(ticker.price),open=Number(stats.open),high=Number(stats.high),low=Number(stats.low),volume=Number(stats.volume),trade=Date.parse(ticker.time);
 if(![price,open,high,low,volume,trade].every(Number.isFinite)||price<=0||open<=0||high<low||low<=0||volume<0||trade<0||trade>now+60000)throw new Error('Invalid quote');
 if(!Array.isArray(raw))throw new Error('Invalid candles');
 const map=new Map<number,Candle>();for(const c of raw){if(!Array.isArray(c)||c.length<6||!c.every(Number.isFinite)||c[0]*1000>now+60000||Math.min(...c.slice(1,5))<=0||c[2]<Math.max(c[1],c[3],c[4])||c[1]>Math.min(c[3],c[4])||c[5]<0)throw new Error('Invalid candle');map.set(c[0],{time:c[0]*1000,low:c[1],high:c[2],open:c[3],close:c[4],volume:c[5]})}
 let candles=[...map.values()].sort((a,b)=>a.time-b.time);
 if(frame==='240'){const grouped=new Map<number,Candle>();for(const c of candles){const time=Math.floor(c.time/14400000)*14400000,old=grouped.get(time);grouped.set(time,old?{...old,high:Math.max(old.high,c.high),low:Math.min(old.low,c.low),close:c.close,volume:(old.volume??0)+(c.volume??0)}:{...c,time})}candles=[...grouped.values()]}
 return {pair,price,open,high,low,volume,change:(price/open-1)*100,candles:candles.slice(-300),fetchedAt:now,tradeTime:ticker.time,source:'Coinbase Exchange'};
}
const cache=new Map<string,{expires:number,promise:Promise<MarketData>}>();
export function loadMarket(pair:string,frame:string):Promise<MarketData>{
 if(!hasNativeFeed(pair)||!Object.hasOwn(intervals,frame))return Promise.reject(new Error('Unsupported feed'));
 const id=pair+':'+frame,old=cache.get(id);if(old&&old.expires>Date.now())return old.promise;
 const read=async(path:string)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  let status=0;
  try{const res=await fetch('https://api.exchange.coinbase.com/products/'+pair+path,{signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}});status=res.status;
   if(!res.ok)throw new Error('HTTP '+res.status);
   if(!res.headers.get('content-type')?.includes('application/json'))throw new Error('Expected JSON; received '+(res.headers.get('content-type')??'unknown content type'));
   return await res.json();
  }catch(error){diagnostic('market','request_failed',{provider:'Coinbase Exchange',pair,frame,endpoint:path.split('?')[0],status,error:(error as Error).message,online:navigator.onLine});throw error}finally{clearTimeout(timer)}
 };
 const promise=Promise.all([read('/ticker'),read('/stats'),read('/candles?granularity='+intervals[frame])]).then(([t,s,c])=>decodeMarket(pair,frame,t,s,c)).catch(e=>{cache.delete(id);throw e});cache.set(id,{expires:Date.now()+25000,promise});return promise;
}
