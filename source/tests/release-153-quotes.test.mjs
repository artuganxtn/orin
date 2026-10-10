import test from 'node:test';
import assert from 'node:assert/strict';
import {QuoteStream,decodeStream} from './release-153-stream-bundle.mjs';
import {loadQuote} from './release-152-quote-bundle.mjs';
const BASE=Date.now();
const quote=(pair='BTC-USD',price=100)=>({pair,price,open:95,high:105,low:90,volume:123,change:(price/95-1)*100,fetchedAt:Date.now(),asOf:Date.now(),source:'Coinbase Exchange'});
const tick=(pair='BTC-USD',price=101,time=Date.now())=>({type:'ticker',product_id:pair,price:String(price),open_24h:'95',high_24h:'105',low_24h:'90',volume_24h:'123',time:new Date(time).toISOString()});
class Socket{
 readyState=0;sent=[];closed=false;
 send(body){this.sent.push(JSON.parse(body))} close(){this.closed=true;this.readyState=3}
 open(){this.readyState=1;this.onopen?.({})} receive(data){this.onmessage?.({data:JSON.stringify(data)})}
}
function setup(t,load=async p=>quote(p),storage){
 t.mock.timers.enable({apis:['setInterval','setTimeout','Date'],now:BASE});
 const sockets=[];const store=new QuoteStream({socket:url=>{const s=new Socket();s.url=url;sockets.push(s);return s},load,storage});
 t.after(()=>{store.stop();t.mock.timers.reset()});return {store,sockets,advance:ms=>t.mock.timers.tick(ms)};
}
const flush=()=>new Promise(setImmediate);
test('all cards share one connection, a new asset subscribes without replacing the existing chart or feed',async t=>{
 const {store,sockets}=setup(t);let a=0,b=0;const off=store.subscribe('BTC-USD',()=>a++);store.subscribe('BTC-USD',()=>b++);store.subscribe('ETH-USD',()=>{});
 assert.equal(sockets.length,1);sockets[0].open();assert.deepEqual(sockets[0].sent[0].product_ids,['BTC-USD','ETH-USD']);sockets[0].receive(tick());assert.equal(store.getSnapshot('BTC-USD').data.price,101);assert.equal(store.getSnapshot('ETH-USD').data,null);
 off();assert.equal(sockets[0].sent.length,1);await flush();assert.equal(store.getSnapshot('BTC-USD').data.price,101);
});
test('late REST results and out-of-order stream events cannot replace a newer price',async t=>{
 let resolve;const {store,sockets,advance}=setup(t,()=>new Promise(r=>resolve=r));store.subscribe('BTC-USD',()=>{});sockets[0].open();advance(500);sockets[0].receive(tick());sockets[0].receive(tick('BTC-USD',88,Date.now()-1000));resolve(quote('BTC-USD',90));await flush();assert.equal(store.getSnapshot('BTC-USD').data.price,101);
});
test('stream failure uses the alternate USD provider automatically and reconnects after offline',async t=>{
 const {store,sockets,advance}=setup(t);store.subscribe('BTC-USD',()=>{});sockets[0].onerror();advance(1000);assert.match(sockets[1].url,/kraken/);sockets[1].open();assert.deepEqual(sockets[1].sent[0].params.symbol,['BTC/USD']);
 sockets[1].receive({channel:'ticker',data:[{symbol:'BTC/USD',last:101,change:6,high:105,low:90,volume:321,timestamp:new Date(Date.now()).toISOString()}]});
 assert.equal(store.getSnapshot('BTC-USD').data.open,95);assert.equal(store.getSnapshot('BTC-USD').data.source,'Kraken');store.setEnvironment(false,true);assert.equal(store.getSnapshot('BTC-USD').status,'offline');assert.equal(store.getSnapshot('BTC-USD').data.price,101);store.setEnvironment(true,true);assert.equal(sockets.length,3);
});
test('hanging websocket expires, HTTP failures retry automatically, no infinite loading',async t=>{
 let calls=0;const {store,sockets,advance}=setup(t,async()=>{calls++;throw Error('Offline provider')});store.subscribe('BTC-USD',()=>{});await flush();assert.equal(store.getSnapshot('BTC-USD').status,'unavailable');advance(2000);await flush();assert.ok(calls>=2);advance(5000);advance(1000);await flush();assert.ok(sockets.length>=2);assert.ok(sockets[0].closed);
});
test('heartbeat-only socket cannot masquerade as a working ticker',async t=>{
 const {store,sockets,advance}=setup(t);store.subscribe('BTC-USD',()=>{});sockets[0].open();for(let i=0;i<8;i++){sockets[0].receive({type:'heartbeat'});advance(1000)}assert.ok(sockets[0].closed);assert.ok(sockets.length>=2);
});
test('background pause retains quote, resume resubscribes, final unmount cleans up',async t=>{
 const {store,sockets,advance}=setup(t);const off=store.subscribe('ETH-USD',()=>{});sockets[0].open();sockets[0].receive(tick('ETH-USD'));store.setEnvironment(true,false);assert.ok(sockets[0].closed);advance(60000);assert.equal(sockets.length,1);assert.equal(store.getSnapshot('ETH-USD').data.price,101);store.setEnvironment(true,true);assert.equal(sockets.length,2);off();advance(1000);assert.ok(sockets[1].closed);
});
test('cached quote renders immediately with honest delayed status; wrong pair and expired cache rejected',t=>{
 const value={...quote(),price:103,asOf:BASE,fetchedAt:BASE};const storage={getItem:()=>JSON.stringify({'BTC-USD':value,'ETH-USD':value}),setItem(){}};const {store}=setup(t,async p=>quote(p),storage);assert.equal(store.getSnapshot('BTC-USD').data.price,103);assert.equal(store.getSnapshot('BTC-USD').status,'delayed');assert.equal(store.getSnapshot('ETH-USD').data,null);
});
test('a slow REST source cannot hold up a valid secondary USD quote',async()=>{
 const original=globalThis.fetch;let abort=false;globalThis.fetch=(url,{signal})=>url.includes('coinbase')?new Promise((_,reject)=>signal.addEventListener('abort',()=>{abort=true;reject(new Error('Aborted'))})):Promise.resolve(Response.json({last:'100',open_24:'95',high:'102',low:'93',volume:'10',timestamp:String(Math.floor(Date.now()/1000))}));
 try{const data=await loadQuote('ADA-USD');assert.equal(data.source,'Bitstamp');assert.equal(data.price,100);assert.equal(abort,true)}finally{globalThis.fetch=original}
});
test('malformed, stale and unsupported symbols never become displayed market data',()=>{
 assert.throws(()=>decodeStream('coinbase',tick('BTC-USDT')));assert.throws(()=>decodeStream('coinbase',tick('BTC-USD',100,Date.now()-180000)));assert.throws(()=>decodeStream('coinbase',{...tick(),volume_24h:undefined}));assert.throws(()=>decodeStream('kraken',{symbol:'BTC/USD',last:100,high:110,low:90,volume:5,timestamp:new Date().toISOString()}));
});
test('opening an asset while already offline has a bounded honest state and no request',t=>{
 let requests=0;const {store,sockets}=setup(t,async p=>{requests++;return quote(p)});store.setEnvironment(false,true);store.subscribe('BTC-USD',()=>{});assert.equal(store.getSnapshot('BTC-USD').status,'offline');assert.equal(sockets.length,0);assert.equal(requests,0);
});
test('a failing background snapshot cannot downgrade a valid streaming price',async t=>{
 let reject;const {store,sockets,advance}=setup(t,()=>new Promise((_,r)=>reject=r));store.subscribe('BTC-USD',()=>{});sockets[0].open();advance(100);sockets[0].receive(tick());reject(Error('Snapshot timed out'));await flush();assert.equal(store.getSnapshot('BTC-USD').status,'ready');assert.equal(store.getSnapshot('BTC-USD').streaming,true);
});
