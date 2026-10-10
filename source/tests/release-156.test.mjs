import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {advanceSparkline,SPARKLINE_REFRESH_MS} from './release-156-bundle.mjs';
import {ProfileSettings,OrinSettingsProvider,DEFAULT_PREFERENCES,DEFAULT_CONFIGURATION,CAPABILITIES} from '../firebase-app/reference-test.mjs';
const feed=(last=100,pair='BTC-USD',source='Coinbase Exchange')=>({pair,status:'ready',streaming:true,data:{pair,source,price:last},history:[{at:last-1,price:last-1},{at:last,price:last}]});
test('mini chart waits 30 seconds without delaying or mutating the live quote',()=>{
 const first=advanceSparkline(null,feed(),1000);assert.equal(SPARKLINE_REFRESH_MS,30000);
 for(let i=1;i<30000;i+=197){const quote=feed(100+i),before=JSON.stringify(quote);assert.equal(advanceSparkline(first,quote,1000+i),first);assert.equal(JSON.stringify(quote),before);assert.equal(quote.data.price,100+i)}
 const second=advanceSparkline(first,feed(999),31000);assert.equal(second.history.at(-1).price,999);assert.equal(second.previous,first.history);assert.equal(advanceSparkline(second,feed(1000),31001),second);
});
test('mini chart initializes promptly and never carries another asset or provider into a transition',()=>{
 let frame=advanceSparkline(null,{...feed(),history:[]},0);frame=advanceSparkline(frame,feed(),10);assert.equal(frame.history.length,2);
 for(const quote of [feed(200,'ETH-USD'),feed(300,'ETH-USD','Kraken')]){frame=advanceSparkline(frame,quote,11);assert.equal(frame.history.at(-1).price,quote.data.price);assert.deepEqual(frame.previous,[])}
 frame=advanceSparkline(frame,{...feed(300,'ETH-USD','Kraken'),history:[{at:1000,price:200}]},12);assert.equal(frame.history.length,1);assert.deepEqual(frame.previous,[]);
});
test('unchanged or older market ticks cannot restart the mini-chart animation',()=>{
 const frame=advanceSparkline(null,feed(),0);assert.equal(advanceSparkline(frame,feed(),30000),frame);assert.equal(advanceSparkline(frame,feed(90),40000),frame);
});
test('profile shows the selected account truthfully and preserves readonly email and privacy actions',()=>{
 for(const chartLocale of ['en','ar'])for(const type of ['real','demo']){
  const settings={preferences:{...DEFAULT_PREFERENCES,chartLocale},profile:{displayName:'Profile Owner',phone:'+123456789',country:'TR',closureStatus:'open'},revision:0,configuration:DEFAULT_CONFIGURATION,configurationRevision:0,isAdmin:false,email:'owner@example.test',clientId:'test',updatedAt:0,capabilities:CAPABILITIES};
  const account={id:'chosen',type,currency:'USD',accountNumber:'00009514',balanceCents:0,reservedCents:0,realizedCents:0,createdAt:0};
  const state={user:{name:'Profile Owner'},accountDirectory:{accounts:[account],activeId:'chosen'}};
  const html=renderToStaticMarkup(React.createElement(OrinSettingsProvider,{initialSettings:settings},React.createElement(ProfileSettings,{state,onSecurity(){},onPrivacy(){}})));
  assert.match(html,/Profile Owner/);assert.match(html,/owner@example\.test/);assert.match(html,/readOnly=""/);assert.match(html,/•••• 9514/);assert.doesNotMatch(html,/00009514/);
  assert.ok(html.includes(chartLocale==='ar'?(type==='real'?'حساب حقيقي':'حساب تجريبي'):(type==='real'?'Real account':'Demo account')));
  assert.match(html,/<details class="profile-advanced"/);assert.match(html,/type="submit" disabled=""/);
 }
});
