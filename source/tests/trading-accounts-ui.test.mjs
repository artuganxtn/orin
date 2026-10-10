import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const {BalanceAccounts,OrinSettingsProvider,DEFAULT_PREFERENCES,DEFAULT_CONFIGURATION,CAPABILITIES,activeTradingAccount}=await import('../firebase-app/reference-test.mjs');
const accounts=[{id:'primary',accountNumber:'123456781060',type:'demo',currency:'USD',balanceCents:100050,reservedCents:10000,realizedCents:2050},{id:'second',accountNumber:'234567892221',type:'real',currency:'USD',balanceCents:9876,reservedCents:0,realizedCents:-20}];
const directory=activeId=>({accounts,activeId});
function render(activeId,locale='ar',hideBalance=false){const prefs={...DEFAULT_PREFERENCES,chartLocale:locale,hideBalance};const settings={preferences:prefs,profile:{displayName:'Test',phone:'',country:'',closureStatus:'open'},revision:0,configuration:DEFAULT_CONFIGURATION,configurationRevision:0,isAdmin:false,email:'test@example.test',clientId:'private-firebase-uid',updatedAt:0,capabilities:CAPABILITIES};return renderToStaticMarkup(React.createElement(OrinSettingsProvider,{initialSettings:settings},React.createElement(BalanceAccounts,{state:{user:{id:'private-firebase-uid'},balanceCents:100050,reservedCents:10000,realizedCents:2050,accountDirectory:directory(activeId)},onHideBalance:()=>{},onTerms:()=>{}})))}
test('balance card switches type, masked number and exact account balance without leaking Firebase UID',()=>{
 for(const locale of ['ar','en']){const demo=render('primary',locale),real=render('second',locale);assert.match(demo,/•••• 1060/);assert.match(demo,/\$1,100\.50/);assert.match(demo,locale==='ar'?/حساب تجريبي/:/Demo account/);assert.match(real,/•••• 2221/);assert.match(real,/\$98\.76/);assert.match(real,locale==='ar'?/حساب حقيقي/:/Real account/);assert.doesNotMatch(real,/1,100\.50|private-firebase-uid|123456781060|234567892221/);assert.doesNotMatch(real,/محاكاة/);}
});
test('privacy hides all amount values in the balance card; unknown selection never borrows another account',()=>{const hidden=render('second','en',true);assert.doesNotMatch(hidden,/98\.76|0\.20/);assert.match(hidden,/••••••/);assert.equal(activeTradingAccount(directory('unknown')),null);});
