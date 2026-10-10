import {diagnostic} from './diagnostics';
import {hasNativeFeed} from './live-market';

/** A ticker is independent of chart history and chart interval. Never mix exchanges in one snapshot. */
export interface MarketQuote {
 pair:string; price:number; open:number; high:number; low:number; volume:number;
 change:number; fetchedAt:number; asOf:number; source:string;
}
function numeric(value:unknown){
 if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()==='')throw new Error('Missing quote field');
 const n=Number(value);if(!Number.isFinite(n))throw new Error('Invalid quote field');return n;
}
export function decodeQuote(pair:string,raw:Record<string,unknown>,provider:'coinbase'|'bitstamp',now=Date.now()):MarketQuote {
 const price=numeric(raw.last),open=numeric(provider==='bitstamp'?raw.open_24:raw.open);
 const high=numeric(raw.high),low=numeric(raw.low),volume=numeric(raw.volume);
 const asOf=provider==='bitstamp'?numeric(raw.timestamp)*1000:now;
 if(price<=0||open<=0||low<=0||high<low||volume<0||asOf<=0||asOf>now+60000||now-asOf>120000)throw new Error('Invalid or stale quote');
 return {pair,price,open,high,low,volume,change:(price/open-1)*100,fetchedAt:now,asOf,source:provider==='bitstamp'?'Bitstamp':'Coinbase Exchange'};
}
const cache=new Map<string,{expires:number;promise:Promise<MarketQuote>}>();
async function request(pair:string,provider:'coinbase'|'bitstamp',controller:AbortController){
 const url=provider==='coinbase'?`https://api.exchange.coinbase.com/products/${pair}/stats`:`https://www.bitstamp.net/api/v2/ticker/${pair.replace('-','').toLowerCase()}/`;
 const timer=setTimeout(()=>controller.abort(),5000);let status=0;
 try{
  const response=await fetch(url,{signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}});status=response.status;
  if(!response.ok)throw new Error(`HTTP ${status}`);
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Expected JSON quote');
  return decodeQuote(pair,await response.json(),provider);
 }catch(error){diagnostic('market','quote_failed',{provider,pair,status,error:(error as Error).message,online:typeof navigator==='undefined'||navigator.onLine!==false});throw error}
 finally{clearTimeout(timer)}
}
export function loadQuote(pair:string):Promise<MarketQuote>{
 if(!hasNativeFeed(pair))return Promise.reject(new Error('Unsupported quote pair'));
 const old=cache.get(pair);if(old&&old.expires>Date.now())return old.promise;
 // Independent public snapshots race. A blocked exchange must not delay the other.
 const controllers=[new AbortController(),new AbortController()];
 const promise=Promise.any([request(pair,'coinbase',controllers[0]),request(pair,'bitstamp',controllers[1])])
  .catch(error=>{if(cache.get(pair)?.promise===promise)cache.delete(pair);throw error})
  .finally(()=>controllers.forEach(c=>c.abort()));
 cache.set(pair,{expires:Date.now()+5000,promise});return promise;
}
