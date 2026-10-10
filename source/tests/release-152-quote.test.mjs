import test from 'node:test';
import assert from 'node:assert/strict';
import {loadQuote,decodeQuote} from './release-152-quote-bundle.mjs';
const stats={last:'100',open:'95',high:'102',low:'93',volume:'1234.56'};
test('quote statistics load without requesting chart history',async()=>{
 const calls=[];globalThis.fetch=async url=>{calls.push(url);return Response.json(stats)};
 const data=await loadQuote('BTC-USD');assert.equal(data.price,100);assert.equal(data.volume,1234.56);assert.equal(data.source,'Coinbase Exchange');assert.equal(calls.length,2);assert.equal(calls[0],'https://api.exchange.coinbase.com/products/BTC-USD/stats');
});
test('blocked primary feed falls back to an exact USD ticker, using rolling 24h open',async()=>{
 const calls=[];globalThis.fetch=async url=>{calls.push(url);return url.includes('coinbase')?new Response('Unavailable',{headers:{'Content-Type':'text/html'}}):Response.json({...stats,last:'101',open:'70',open_24:'95',timestamp:String(Math.floor(Date.now()/1000))})};
 const data=await loadQuote('ETH-USD');assert.equal(data.open,95);assert.equal(data.source,'Bitstamp');assert.equal(data.price,101);assert.equal(calls[1],'https://www.bitstamp.net/api/v2/ticker/ethusd/');assert.equal(data.pair,'ETH-USD');
});
test('simultaneous home/detail consumers share quote request independent of interval',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(stats)};const a=loadQuote('XRP-USD'),b=loadQuote('XRP-USD');assert.equal(a,b);await Promise.all([a,b]);assert.equal(calls,2);
});
test('both feed failures surface honestly and a retry recovers',async()=>{
 globalThis.fetch=async()=>new Response('Unavailable',{status:503});await assert.rejects(loadQuote('SOL-USD'));
 globalThis.fetch=async()=>Response.json(stats);assert.equal((await loadQuote('SOL-USD')).price,100);
});
test('each quote provider times out without infinite loading',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;globalThis.fetch=(_url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))};
 const promise=loadQuote('ADA-USD');const rejection=assert.rejects(promise,{name:'AggregateError'});assert.equal(calls,2);t.mock.timers.tick(5000);await rejection;t.mock.timers.reset();
});
test('missing, negative, nonfinite and stale values cannot masquerade as real prices',()=>{
 for(const value of ['',null,undefined,'NaN',-1])assert.throws(()=>decodeQuote('BTC-USD',{...stats,last:value},'coinbase'));
 assert.throws(()=>decodeQuote('BTC-USD',{...stats,open_24:'95',timestamp:'10'},'bitstamp'));
 assert.throws(()=>decodeQuote('BTC-USD',{...stats,low:'104'},'coinbase'));
});
test('unsupported pairs cannot silently reuse BTC or replace USD with USDT',async()=>{
 await assert.rejects(loadQuote('BNB-USDT'),/Unsupported/);await assert.rejects(loadQuote('XAU-USD'),/Unsupported/);
});
