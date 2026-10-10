import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {deleteApp} from 'firebase/app';
const {AuthForm,app}=await import('../firebase-app/account-test.mjs');
test('actual auth forms render Arabic and English labels, password controls, validation and recovery state',async()=>{
 let preference='{}';Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>preference}});
 const render=path=>renderToStaticMarkup(React.createElement(AuthForm,{path,done:()=>{}}));
 const login=render('/login');assert.match(login,/تسجيل الدخول/);assert.match(login,/type="password"/);assert.match(login,/aria-pressed="false"/);assert.match(login,/autocomplete="email"/i);
 const register=render('/register');assert.match(register,/<meter/);assert.match(register,/minLength="8"|minlength="8"/);assert.match(register,/autocomplete="new-password"/i);
 const reset=render('/forgot-password');assert.doesNotMatch(reset,/type="password"/);assert.match(reset,/إرسال رابط الاستعادة/);
 preference=JSON.stringify({chartLocale:'en',theme:'dark'});assert.match(render('/login'),/Sign in/);assert.match(render('/register'),/Create account/);await deleteApp(app);
});
