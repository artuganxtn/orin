import {diagnostic} from './diagnostics';
import {hasNativeFeed} from './live-market';
import {decodeQuote,loadQuote,type MarketQuote} from './market-quote';

type Provider='coinbase'|'kraken';
export type QuotePoint={at:number;price:number};
export type QuoteFeed={history?:readonly QuotePoint[];pair:string;data:MarketQuote|null;status:'loading'|'ready'|'delayed'|'offline'|'unavailable';streaming:boolean};
type Listener=()=>void;
type Row={feed:QuoteFeed;listeners:Set<Listener>;started:number;streamAt:number;attempt:number;next:number;pending:boolean;version:number;saved:number};
const URLS={coinbase:'wss://ws-feed.exchange.coinbase.com',kraken:'wss://ws.kraken.com/v2'};
const CACHE_KEY='orin-public-quotes-v1';
const EMPTY=(pair:string):QuoteFeed=>({pair,data:null,status:'loading',streaming:false});

/** Full, same-exchange snapshots only. USD is never substituted with USDT. */
export function decodeStream(provider:Provider,raw:Record<string,unknown>,now=Date.now()):MarketQuote{
 const pair=provider==='coinbase'?String(raw.product_id):String(raw.symbol).replace('/','-');
 if(!hasNativeFeed(pair))throw new Error('Unsupported stream symbol');
 const asOf=Date.parse(String(provider==='coinbase'?raw.time:raw.timestamp));
 if(!Number.isFinite(asOf)||now-asOf>120000||asOf>now+60000)throw new Error('Stale stream snapshot');
 const open=provider==='coinbase'?raw.open_24h:typeof raw.last==='number'&&typeof raw.change==='number'?raw.last-raw.change:NaN;
 const quote=decodeQuote(pair,{last:provider==='coinbase'?raw.price:raw.last,open,
  high:provider==='coinbase'?raw.high_24h:raw.high,low:provider==='coinbase'?raw.low_24h:raw.low,
  volume:provider==='coinbase'?raw.volume_24h:raw.volume},'coinbase',now);
 return {...quote,asOf,source:provider==='coinbase'?'Coinbase Exchange':'Kraken'};
}

/** One socket for every visible consumer; no chart or navigation state is touched. */
export class QuoteStream {
 private rows=new Map<string,Row>();
 private socket:WebSocket|null=null;
 private provider:Provider='coinbase';
 private subscribed=new Set<string>();
 private received=new Set<string>();
 private connectedAt=0;private lastMessage=0;private nextConnect=0;private failures=0;
 private timer:ReturnType<typeof setInterval>|undefined;
 private flush:ReturnType<typeof setTimeout>|undefined;
 private shutdown:ReturnType<typeof setTimeout>|undefined;
 private dirty=new Set<Row>();
 private active=false;private visible=true;private online=true;
 constructor(private options:{socket?:(url:string)=>WebSocket;load?:(pair:string)=>Promise<MarketQuote>;storage?:Storage;now?:()=>number}={}){}
 private now=()=>this.options.now?.()??Date.now();
 private row(pair:string){
  let row=this.rows.get(pair);if(row)return row;
  let data:MarketQuote|null=null;
  try{
   const value=JSON.parse(this.options.storage?.getItem(CACHE_KEY)??'{}')[pair] as MarketQuote|undefined;
   if(value&&value.pair===pair&&['Coinbase Exchange','Bitstamp','Kraken'].includes(value.source)&&this.now()-value.fetchedAt<600000&&value.fetchedAt<=this.now()&&value.asOf<=value.fetchedAt+60000&&value.fetchedAt-value.asOf<120000){
    const checked=decodeQuote(pair,{last:value.price,open:value.open,high:value.high,low:value.low,volume:value.volume},'coinbase',value.fetchedAt);
    data={...checked,source:value.source,asOf:value.asOf};
   }
  }catch{/* Storage is an optional public quote cache, never a dependency. */}
  row={feed:{...EMPTY(pair),data,status:data?'delayed':'loading'},listeners:new Set(),started:this.now(),streamAt:0,attempt:0,next:0,pending:false,version:0,saved:0};
  this.rows.set(pair,row);return row;
 }
 getSnapshot=(pair:string)=>this.row(pair).feed;
 subscribe=(pair:string,listener:Listener)=>{
  if(!hasNativeFeed(pair))return()=>{};
  const row=this.row(pair);row.listeners.add(listener);row.started=this.now();
  if(this.shutdown){clearTimeout(this.shutdown);this.shutdown=undefined}
  this.start();this.sync();this.tick();
  return()=>{row.listeners.delete(listener);this.sync();if(!this.pairs().length)this.shutdown=setTimeout(()=>this.stop(),750)};
 };
 private pairs=()=>[...this.rows].filter(([,r])=>r.listeners.size).map(([pair])=>pair);
 private set(row:Row,feed:QuoteFeed){
  if(row.feed.data===feed.data&&row.feed.status===feed.status&&row.feed.streaming===feed.streaming)return;
  row.feed=feed;this.dirty.add(row);
  // Limit React work during a burst; the newest valid quote always wins.
  this.flush??=setTimeout(()=>{this.flush=undefined;const dirty=[...this.dirty];this.dirty.clear();dirty.forEach(r=>r.listeners.forEach(f=>f()))},150);
 }
 private persist(row:Row){
  if(this.now()-row.saved<5000)return;row.saved=this.now();
  try{const data=Object.fromEntries([...this.rows].filter(([,r])=>r.feed.data).map(([p,r])=>[p,r.feed.data]));this.options.storage?.setItem(CACHE_KEY,JSON.stringify(data))}catch{}
 }
 private accept(row:Row,data:MarketQuote,stream:boolean){
  const old=row.feed.data;
  if(old?.source===data.source&&old.asOf>data.asOf)return;
  if(stream)row.streamAt=this.now();
  row.attempt=0;row.next=this.now()+15000;
  const previous=old?.source===data.source ? row.feed.history??[] : [];
  const history=previous.filter(p=>p.at>=data.asOf-300000&&p.at<data.asOf);
  if(history.length&&data.asOf-history[history.length-1].at>90000)history.length=0;
  history.push({at:data.asOf,price:data.price});
  this.set(row,{pair:data.pair,data,history:history.slice(-120),status:this.online?'ready':'offline',streaming:stream&&this.online});this.persist(row);
 }
 private start(){
  if(this.active)return;this.active=true;
  if(typeof window!=='undefined'){
   this.online=navigator.onLine!==false;this.visible=!document.hidden;
   window.addEventListener('online',this.resume);window.addEventListener('offline',this.offline);document.addEventListener('visibilitychange',this.visibility);
  }
  if(!this.online)for(const row of this.rows.values())this.set(row,{...row.feed,status:'offline',streaming:false});
  this.timer=setInterval(()=>this.tick(),1000);
 }
 private resume=()=>this.setEnvironment(true,this.visible);
 private offline=()=>this.setEnvironment(false,this.visible);
 private visibility=()=>this.setEnvironment(this.online,!document.hidden);
 // Also used by lifecycle tests, without touching navigator or a real server.
 setEnvironment(online:boolean,visible:boolean){
  const wasRunning=this.online&&this.visible;this.online=online;this.visible=visible;
  if(!online||!visible){this.close();for(const row of this.rows.values())this.set(row,{...row.feed,status:online?'delayed':'offline',streaming:false})}
  else if(!wasRunning){this.nextConnect=0;for(const row of this.rows.values()){row.next=0;row.started=this.now()}}
  this.tick();
 }
 private sync(){
  if(this.socket?.readyState!==1)return;
  const wanted=new Set(this.pairs()),add=[...wanted].filter(p=>!this.subscribed.has(p)),remove=[...this.subscribed].filter(p=>!wanted.has(p));
  const send=(method:'subscribe'|'unsubscribe',pairs:string[])=>{
   if(!pairs.length)return;
   const body=this.provider==='coinbase'?{type:method,product_ids:pairs,channels:['ticker','heartbeat']}:
    {method,params:{channel:'ticker',symbol:pairs.map(p=>p.replace('-','/')),...(method==='subscribe'?{snapshot:true}:{})}};
   this.socket?.send(JSON.stringify(body));
  };
  try{send('unsubscribe',remove);send('subscribe',add);remove.forEach(p=>this.received.delete(p));this.subscribed=wanted;add.forEach(p=>{this.row(p).started=this.now()})}catch{this.fail('subscribe_failed')}
 }
 private connect(){
  const provider=this.provider;let socket:WebSocket;
  try{socket=(this.options.socket??(url=>new WebSocket(url)))(URLS[provider])}catch{this.fail('socket_unavailable');return}
  this.socket=socket;this.connectedAt=this.now();this.lastMessage=this.now();
  socket.onopen=()=>{if(this.socket===socket)this.sync()};
  socket.onmessage=event=>{
   if(this.socket!==socket||!this.online||!this.visible)return;
   try{
    const raw=JSON.parse(String(event.data));this.lastMessage=this.now();
    if(raw.type==='error'||raw.success===false){this.fail('subscription_rejected');return}
    const updates=provider==='coinbase'?(raw.type==='ticker'?[raw]:[]):raw.channel==='ticker'&&Array.isArray(raw.data)?raw.data:[];
    for(const item of updates){
     const data=decodeStream(provider,item,this.now()),row=this.rows.get(data.pair);
     if(!row?.listeners.size)continue;
     this.received.add(data.pair);this.failures=0;this.accept(row,data,true);
    }
   }catch(error){diagnostic('market','stream_invalid',{provider,error:(error as Error).message})}
  };
  socket.onerror=()=>{if(this.socket===socket)this.fail('socket_error')};
  socket.onclose=event=>{if(this.socket===socket)this.fail('socket_closed_'+event.code)};
 }
 private close(){
  const socket=this.socket;this.socket=null;this.subscribed.clear();this.received.clear();
  if(socket){socket.onopen=null;socket.onmessage=null;socket.onerror=null;socket.onclose=null;socket.close()}
  for(const row of this.rows.values()){row.streamAt=0;if(row.feed.streaming)this.set(row,{...row.feed,status:'delayed',streaming:false})}
 }
 private fail(reason:string){
  diagnostic('market','stream_disconnected',{provider:this.provider,reason});this.close();
  for(const row of this.rows.values())if(row.listeners.size)this.set(row,{...row.feed,status:row.feed.data?'delayed':'loading',streaming:false});
  this.provider=this.provider==='coinbase'?'kraken':'coinbase';
  this.failures++;this.nextConnect=this.now()+(this.failures===1?250:Math.min(30000,1000*2**Math.min(this.failures-2,5)));
 }
 private snapshot(pair:string,row:Row){
  if(row.pending||this.now()<row.next)return;row.pending=true;const version=++row.version,started=this.now();
  void (this.options.load??loadQuote)(pair).then(data=>{
   if(!this.active||!this.online||!this.visible||version!==row.version||!row.listeners.size)return;
   if(data.pair!==pair)throw new Error('Snapshot symbol mismatch');
   // A REST response that started earlier cannot overwrite a streaming quote.
   if(row.streamAt>=started&&row.streamAt>0)return;
   this.accept(row,data,false);
  }).catch(()=>{
   if(!this.active||version!==row.version||!row.listeners.size||row.streamAt>=started&&row.streamAt>0)return;
   row.attempt++;row.next=this.now()+Math.min(30000,2000*2**Math.min(row.attempt-1,4));
   if(this.active&&row.listeners.size)this.set(row,{...row.feed,status:!this.online?'offline':row.feed.data?'delayed':'unavailable',streaming:false});
  }).finally(()=>{row.pending=false});
 }
 private tick(){
  if(!this.active||!this.pairs().length||!this.online||!this.visible)return;
  const now=this.now();
  if(this.socket&&(this.socket.readyState===0&&now-this.connectedAt>4500||now-this.lastMessage>20000||[...this.subscribed].some(p=>!this.received.has(p)&&now-this.row(p).started>6000)))this.fail('snapshot_timeout');
  if(!this.socket&&now>=this.nextConnect)this.connect();
  for(const pair of this.pairs()){
   const row=this.row(pair),data=row.feed.data,live=!!row.streamAt&&now-row.streamAt<15000;
   if(!live)this.snapshot(pair,row);
   if(data&&now-data.fetchedAt>45000)this.set(row,{...row.feed,status:'delayed',streaming:false});
   else if(!data&&now-row.started>6500)this.set(row,{...row.feed,status:'unavailable',streaming:false});
  }
 }
 stop(){
  this.active=false;this.close();if(this.timer)clearInterval(this.timer);if(this.flush)clearTimeout(this.flush);if(this.shutdown)clearTimeout(this.shutdown);
  this.timer=undefined;this.flush=undefined;this.shutdown=undefined;this.dirty.clear();
  for(const row of this.rows.values())row.version++;
  if(typeof window!=='undefined'){window.removeEventListener('online',this.resume);window.removeEventListener('offline',this.offline);document.removeEventListener('visibilitychange',this.visibility)}
 }
}
let shared:QuoteStream|undefined;
export function quoteStream(){
 if(!shared){let storage:Storage|undefined;try{storage=globalThis.localStorage}catch{}shared=new QuoteStream({storage})}
 return shared;
}
