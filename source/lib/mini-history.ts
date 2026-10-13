import {hasNativeFeed} from './live-market';
import {diagnostic} from './diagnostics';
import type {QuotePoint} from './quote-stream';
export const MINI_INTERVAL=15*60*1000;
export const MINI_WINDOW=24*60*60*1000;
export type MiniProvider='Coinbase Exchange'|'Kraken'|'Bitstamp'|'Gemini'|'Internal';
export type MiniHistory={pair:string;source:MiniProvider;points:QuotePoint[];windowEnd:number;receivedAt?:number};
const providers:MiniProvider[]=['Internal','Bitstamp','Kraken','Gemini','Coinbase Exchange'];
export const MINI_TIMEOUT=12000;
/** Avoid Promise.any: supported Android OS versions can carry older WebViews. */
function firstAvailable<T>(tasks:Promise<T>[]):Promise<T>{return new Promise((resolve,reject)=>{let remaining=tasks.length;const errors:unknown[]=[];if(!remaining){reject(new Error('No history provider'));return}tasks.forEach(task=>Promise.resolve(task).then(resolve,error=>{errors.push(error);if(--remaining===0)reject(Object.assign(new Error('All history providers unavailable'),{causes:errors}))}))})}
const providerList=(pair:string)=>providers.filter(source=>source!=='Gemini'||pair!=='ADA-USD');
const krakenPairs:Record<string,string>={'BTC-USD':'XXBTZUSD','ETH-USD':'XETHZUSD','XRP-USD':'XXRPZUSD','SOL-USD':'SOLUSD','DOGE-USD':'XDGUSD','ADA-USD':'ADAUSD'};
function rowsFor(pair:string,source:MiniProvider,raw:unknown):unknown[]{
 let rows:unknown=raw;
 if(source==='Kraken'){
  const d=raw as {error?:unknown[];result?:Record<string,unknown>};
  if(!Array.isArray(d?.error)||d.error.length)throw new Error('Kraken history rejected');
  rows=d.result?.[pair.replace('-','/')]??d.result?.[krakenPairs[pair]];
 }else if(source==='Bitstamp'){
  const d=raw as {data?:{pair?:string;ohlc?:unknown[]}};
  if(d?.data?.pair?.replace('/','-')!==pair)throw new Error('History pair mismatch');
  rows=d.data.ohlc?.map(value=>{const r=value as Record<string,unknown>;return [r.timestamp,r.low,r.high,r.open,r.close,r.volume]});
 }
 if(!Array.isArray(rows))throw new Error('Invalid history response');
 // Gemini timestamps are milliseconds and OHLC order differs from Coinbase.
 if(source==='Gemini')return rows.map(value=>{if(!Array.isArray(value)||value.length<6)throw new Error('Invalid Gemini candle');return [Number(value[0])/1000,value[3],value[2],value[1],value[4],value[5]]});
 return rows;
}
/** Only closed candles; input prices, not an invented decorative path. */
export function decodeMiniHistory(pair:string,source:MiniProvider,raw:unknown,now=Date.now()):MiniHistory{
 if(!hasNativeFeed(pair))throw new Error('Unsupported mini-chart pair');
 const windowEnd=Math.floor(now/MINI_INTERVAL)*MINI_INTERVAL,points=new Map<number,QuotePoint>();
 for(const row of rowsFor(pair,source,raw)){
  if(!Array.isArray(row)||row.length<(source==='Kraken'?8:6))throw new Error('Invalid history candle');
  const at=Number(row[0])*1000,close=Number(row[4]),low=Number(row[source==='Kraken'?3:1]),high=Number(row[2]),open=Number(row[source==='Kraken'?1:3]);
  if(![at,close,low,high,open].every(Number.isFinite)||at%MINI_INTERVAL!==0||Math.min(close,low,open)<=0||high<Math.max(low,open,close)||low>Math.min(open,close))throw new Error('Invalid history values');
  if(at>=windowEnd-MINI_WINDOW&&at<windowEnd)points.set(at,{at,price:close});
 }
 const sorted=[...points.values()].sort((a,b)=>a.at-b.at);
 if(sorted.length<72||sorted[sorted.length-1].at-sorted[0].at<MINI_WINDOW*0.75)throw new Error('Insufficient full-day history');
 return {pair,source,points:sorted,windowEnd};
}
/** Device clock never defines the requested historical window. Latest exchange candle anchors it. */
export function exchangeHistoryEnd(pair:string,source:MiniProvider,raw:unknown){
 const rows=rowsFor(pair,source,raw),latest=Math.max(...rows.map(r=>Array.isArray(r)?Number(r[0])*1000:NaN));
 if(!Number.isFinite(latest))throw new Error('Missing exchange time');
 // Only Bitstamp explicitly excludes its open candle. Conservatively omit the newest row elsewhere.
 return latest+(source==='Bitstamp'?MINI_INTERVAL:0);
}
export class MiniHistoryLoader{
 private cache=new Map<string,MiniHistory>();
 private pending=new Map<string,Promise<MiniHistory>>();
 private available=new Map<string,Promise<MiniHistory>>();
 private preferred=new Map<string,MiniProvider>();
 constructor(private request:typeof fetch=fetch,private now:()=>number=Date.now){}
 peek(pair:string,source:MiniProvider){const row=this.cache.get(pair+'|'+source);return row&&this.now()-(row.receivedAt??row.windowEnd)<MINI_WINDOW?row:null}
 peekAvailable(pair:string){
  const cached=this.peek(pair,this.preferred.get(pair)??'Bitstamp');if(cached)return cached;
  try{
   const d=JSON.parse(globalThis.localStorage?.getItem('orin-mini-v2:'+pair)??'null') as MiniHistory|null;
   if(d?.pair===pair&&providers.includes(d.source)&&Number.isFinite(d.receivedAt)&&this.now()-d.receivedAt!>=0&&this.now()-d.receivedAt!<MINI_WINDOW&&Number.isFinite(d.windowEnd)&&Array.isArray(d.points)&&d.points.length>=72&&d.points.length<=96&&d.points.every((p,i)=>Number.isFinite(p.at)&&Number.isFinite(p.price)&&p.price>0&&p.at%MINI_INTERVAL===0&&p.at>=d.windowEnd-MINI_WINDOW&&p.at<d.windowEnd&&(!i||p.at>d.points[i-1].at))){this.cache.set(pair+'|'+d.source,d);this.preferred.set(pair,d.source);return d}
  }catch{}return null;
 }
 loadAvailable(pair:string):Promise<MiniHistory>{
  const old=this.peekAvailable(pair);if(old&&this.now()-(old.receivedAt??old.windowEnd)<MINI_INTERVAL)return Promise.resolve(old);
  const running=this.available.get(pair);if(running)return running;
  // Independent providers race; one unavailable service cannot hold up the whole chart.
  const promise=firstAvailable(providerList(pair).map(source=>this.load(pair,source))).then(data=>{
   this.preferred.set(pair,data.source);try{globalThis.localStorage?.setItem('orin-mini-v2:'+pair,JSON.stringify(data))}catch{}return data;
  }).finally(()=>this.available.delete(pair));this.available.set(pair,promise);return promise;
 }
 load(pair:string,source:MiniProvider):Promise<MiniHistory>{
  if(!hasNativeFeed(pair))return Promise.reject(new Error('Unsupported mini-chart pair'));
  const key=pair+'|'+source,old=this.peek(pair,source);
  if(old&&this.now()-(old.receivedAt??old.windowEnd)<MINI_INTERVAL)return Promise.resolve(old);
  const running=this.pending.get(key);if(running)return running;
  if(source==='Internal'){
   const work=Promise.resolve().then(async()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('History request timed out'))},MINI_TIMEOUT)});
    try{
     const response=await Promise.race([this.request(`/api/market/candles?pair=${encodeURIComponent(pair)}`,{signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}}),timeout]);
     if(!response.ok)throw new Error('HTTP '+response.status);
     const json=await Promise.race([response.json(),timeout]) as any;
     if(!json||!Array.isArray(json.points)||json.points.length<72)throw new Error('Insufficient internal history');
     const data:MiniHistory={pair,source:'Internal',points:json.points,windowEnd:Number(json.windowEnd)||Math.floor(this.now()/MINI_INTERVAL)*MINI_INTERVAL,receivedAt:this.now()};
     this.cache.set(key,data);return data;
    }catch(error){diagnostic('market','mini_history_failed',{pair,provider:source,error:(error as Error).message});throw error}
    finally{clearTimeout(timer!);this.pending.delete(key)}
   });this.pending.set(key,work);return work;
  }
  const url=source==='Gemini'?`https://api.gemini.com/v2/candles/${pair.replace('-','').toLowerCase()}/15m`:source==='Bitstamp'?`https://www.bitstamp.net/api/v2/ohlc/${pair.replace('-','').toLowerCase()}/?step=900&limit=96&exclude_current_candle=true`:source==='Kraken'?`https://api.kraken.com/0/public/OHLC?pair=${krakenPairs[pair]}&assetVersion=1&interval=15`:`https://api.exchange.coinbase.com/products/${pair}/candles?granularity=900`;
  // Defer execution so synchronous transport failures cannot leave a rejected promise stuck in pending.
  const work=Promise.resolve().then(async()=>{
   const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
   const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('History request timed out'))},MINI_TIMEOUT)});
   try{
    const response=await Promise.race([this.request(url,{signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}}),timeout]);
    if(!response.ok)throw new Error('HTTP '+response.status);
    const raw=await Promise.race([response.json(),timeout]),end=exchangeHistoryEnd(pair,source,raw),serverTime=Date.parse(response.headers?.get('date')??'');
    if(Number.isFinite(serverTime)&&serverTime-end>MINI_INTERVAL*2)throw new Error('Stale exchange history');
    const data={...decodeMiniHistory(pair,source,raw,end),receivedAt:this.now()};this.cache.set(key,data);return data;
   }catch(error){diagnostic('market','mini_history_failed',{pair,provider:source,error:(error as Error).message});throw error}
   finally{clearTimeout(timer!);this.pending.delete(key)}
  });this.pending.set(key,work);return work;
 }
}
export const miniHistory=new MiniHistoryLoader();
export function miniHistorySegments(points:readonly QuotePoint[]):QuotePoint[][]{
 const segments:QuotePoint[][]=[];
 for(const p of points){const last=segments[segments.length-1];if(!last||p.at-last[last.length-1].at>MINI_INTERVAL*1.5)segments.push([p]);else last.push(p)}
 return segments.filter(s=>s.length>=2);
}
