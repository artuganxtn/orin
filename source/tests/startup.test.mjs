import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStartupController,STARTUP_TIMEOUT_MS} from '../firebase-app/startup-controller.ts';
function clock(){let now=0,id=0;const tasks=new Map();return {set:(fn,ms)=>{const key=++id;tasks.set(key,{fn,at:now+ms});return key},clear:key=>tasks.delete(key),advance(ms){now+=ms;for(const [key,value] of [...tasks])if(value.at<=now){tasks.delete(key);value.fn()}},count:()=>tasks.size}}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('cold start keeps a single complete surface until all required initialization resolves',async()=>{
 const c=clock(),states=[],gate=createStartupController(s=>states.push(s),c),ticket=gate.begin();
 let auth,settings,data;const a=new Promise(r=>auth=r),b=new Promise(r=>settings=r),d=new Promise(r=>data=r);
 void Promise.all([a,b,d]).then(([user,prefs,lab])=>ticket.ready({user,prefs,lab}));
 auth('signed-in');await flush();settings({theme:'dark',chartLocale:'en'});await flush();assert.deepEqual(states,[{phase:'starting'}]);
 data({balance:0});await flush();assert.equal(states.at(-1).phase,'ready');assert.equal(states.at(-1).data.prefs.theme,'dark');assert.equal(c.count(),0);
});
test('signed-out startup can finish immediately without an artificial splash delay',()=>{const states=[],c=clock(),g=createStartupController(s=>states.push(s),c);g.begin().ready({user:null});assert.deepEqual(states.map(s=>s.phase),['starting','ready']);assert.equal(c.count(),0)});
test('warm ready state is not hidden again when time advances or a late initializer fires',()=>{const c=clock(),states=[],g=createStartupController(s=>states.push(s),c),ticket=g.begin();ticket.ready({user:'saved-session'});c.advance(30000);ticket.ready({user:null});ticket.fail(new Error('late'));assert.equal(states.length,2);assert.equal(states.at(-1).data.user,'saved-session')});
test('slow but healthy startup completes before the fixed deadline',()=>{const c=clock(),states=[],g=createStartupController(s=>states.push(s),c),ticket=g.begin();c.advance(STARTUP_TIMEOUT_MS-1);assert.equal(states.at(-1).phase,'starting');ticket.ready({user:'returning'});c.advance(1);assert.equal(states.at(-1).phase,'ready')});
test('timeout exits splash, rejects late data and allows an explicit clean retry',()=>{const c=clock(),states=[],g=createStartupController(s=>states.push(s),c),old=g.begin();c.advance(STARTUP_TIMEOUT_MS);assert.equal(states.at(-1).phase,'error');assert.equal(old.ready('stale'),false);const fresh=g.begin();fresh.ready('fresh');assert.equal(states.at(-1).data,'fresh');assert.equal(c.count(),0)});
test('offline cold start and loss of network during initialization cannot hang',()=>{const c=clock(),states=[],g=createStartupController(s=>states.push(s),c);const off=g.begin(false);assert.equal(states.at(-1).phase,'offline');assert.equal(off.ready('unexpected'),false);assert.equal(c.count(),0);const connected=g.begin();connected.fail(undefined,true);c.advance(30000);assert.equal(states.at(-1).phase,'offline')});
test('sign-out/retry and unmount ignore stale account initialization results',()=>{const c=clock(),states=[],g=createStartupController(s=>states.push(s),c),old=g.begin(),next=g.begin();assert.equal(old.ready('account A'),false);next.ready(null);assert.equal(states.at(-1).data,null);const final=g.begin();g.dispose();final.ready('account B');c.advance(30000);assert.equal(states.at(-1).phase,'starting');assert.equal(c.count(),0)});
test('first HTML paint has branded splash and a bounded no-JavaScript-module fallback',()=>{const html=readFileSync(new URL('../firebase-app/index.html',import.meta.url),'utf8');assert.match(html,/id="orin-static-launch"/);assert.match(html,/setTimeout\(showFailure,12000\)/);assert.match(html,/navigator.onLine===false/);assert.doesNotMatch(html,/<header|<footer|orin-skeleton|جار تحميل ORIN/);assert.match(html,/prefers-color-scheme: dark/)});
