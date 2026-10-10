import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
const {StartupScreen,Frame}=await import('../firebase-app/startup-test.mjs');
let prefs={};Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify(prefs)}});
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
test('actual splash markup stays complete in both languages and appearance modes, without frame/footer/skeleton',()=>{
 for(const theme of ['light','dark','system'])for(const chartLocale of ['ar','en']){prefs={theme,chartLocale};const out=render(StartupScreen,{});assert.match(out,/ORIN/);assert.match(out,/data-startup-state="starting"/);assert.doesNotMatch(out,/<header|<footer|orin-skeleton|جار تحميل ORIN|Loading ORIN|<button/);const error=render(StartupScreen,{state:'error'});assert.match(error,/role="alert"/);assert.match(error,chartLocale==='ar'?/إعادة المحاولة/:/Try again/);const off=render(StartupScreen,{state:'offline'});assert.match(off,chartLocale==='ar'?/أنت غير متصل/:/You’re offline/)}
});
test('account header has one brand and one collapsed options menu, with no floating footer',()=>{
 for(const chartLocale of ['ar','en']){prefs={chartLocale,theme:'system'};const out=render(Frame,{children:React.createElement('p',null,'content ready')});assert.equal((out.match(/<summary /g)||[]).length,1);assert.equal((out.match(/class="brand"/g)||[]).length,1);assert.match(out,/<option value="system" selected=""/);assert.doesNotMatch(out,/<footer|<details[^>]+open/);assert.match(out,/content ready/)}
});
