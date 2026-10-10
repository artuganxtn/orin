import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {sparklineGeometry,noticeAppearance,notificationGroups,notificationTime} from './release-155-bundle.mjs';
import {NotificationList,OrinSettingsProvider,DEFAULT_PREFERENCES,DEFAULT_CONFIGURATION,CAPABILITIES} from '../firebase-app/reference-test.mjs';
test('smoothing cannot create price extremes between received ticks',()=>{
 for(const prices of [[10,11,11.2,19,20],[9,8,7,4,1],[5,9,2,8,3],[8,8,8,8]]){
  const history=prices.map((price,i)=>({at:i*i*1700,price})),original=JSON.stringify(history),g=sparklineGeometry(history);
  assert.ok(g);assert.equal(JSON.stringify(history),original);
  for(const s of g.segments)for(let i=0;i<=100;i++){
   const t=i/100,u=1-t,y=u*u*u*s.start.y+3*u*u*t*s.c1.y+3*u*t*t*s.c2.y+t*t*t*s.end.y;
   assert.ok(y>=Math.min(s.start.y,s.end.y)-1e-9&&y<=Math.max(s.start.y,s.end.y)+1e-9);
  }
 }
});
test('smoothing keeps time spacing, last received price, and flat markets without synthetic history',()=>{
 assert.equal(sparklineGeometry([]),null);assert.equal(sparklineGeometry([{at:0,price:0},{at:NaN,price:2}]),null);
 assert.equal(sparklineGeometry([{at:1,price:2},{at:1,price:4}]),null);
 const g=sparklineGeometry([{at:10,price:15},{at:0,price:10},{at:2,price:19},{at:2,price:20}]);
 assert.deepEqual(g.points,[{x:4,y:48},{x:34.400000000000006,y:8},{x:156,y:28}]);assert.deepEqual(g.last,{x:156,y:28});
 const flat=sparklineGeometry([{at:0,price:10},{at:1,price:10},{at:5,price:10}]);
 assert.ok(flat.segments.every(s=>[s.start,s.c1,s.c2,s.end].every(p=>p.y===28)));
});
const now=Date.UTC(2026,9,5,12),day=86400000;
const notice=(id,category,overrides={})=>({id,category,created_at:now-1000,title:'Account update',message:'Received account message',deep_link:'/notifications',read_at:null,contract_id:null,image:null,...overrides});
test('four visible filters retain financial, support and announcement notices',()=>{
 const deposit=notice('deposit:1','financial',{title:'إيداع',deep_link:'/deposit'}),withdrawal=notice('w:1','financial',{title:'طلب سحب',deep_link:'/withdraw'}),trade=notice('settle:1','financial',{contract_id:'c'}),support=notice('support:1','support'),security=notice('security:1','security'),announcement=notice('a','announcement');
 assert.deepEqual(noticeAppearance(deposit),{filter:'account',icon:'deposit'});assert.deepEqual(noticeAppearance(withdrawal),{filter:'account',icon:'withdrawal'});
 const rows=[deposit,withdrawal,trade,support,security,announcement],group=filter=>notificationGroups(rows,filter,now).flatMap(g=>g.items).map(n=>n.id).sort();
 assert.equal(group('all').length,6);assert.deepEqual(group('trading'),['settle:1']);assert.deepEqual(group('security'),['security:1']);assert.deepEqual(group('account'),['a','deposit:1','support:1','w:1']);
});
test('notification dates preserve older history, sort newest first and tolerate invalid dates',()=>{
 const groups=notificationGroups([notice('old','security',{created_at:now-8*day}),notice('invalid','security',{created_at:NaN}),notice('boundary','security',{created_at:now-7*day}),notice('new','security')],'all',now);
 assert.deepEqual(groups.map(g=>[g.id,g.items.map(n=>n.id)]),[['recent',['new','boundary']],['earlier',['old']]]);
 assert.equal(notificationTime(now+1000,now,'en','UTC'),'Now');assert.equal(notificationTime(now-2*3600000,now,'en','UTC'),'2 hours ago');assert.ok(notificationTime(now-8*day,now,'ar','UTC'));
});
test('notification cards render actual messages and accessible filter/read states in both languages',()=>{
 for(const chartLocale of ['ar','en']){
  const initialSettings={preferences:{...DEFAULT_PREFERENCES,chartLocale},profile:{displayName:'Test',phone:'',country:'',closureStatus:'open'},revision:0,configuration:DEFAULT_CONFIGURATION,configurationRevision:0,isAdmin:false,email:'test@example.test',clientId:'test',updatedAt:0,capabilities:CAPABILITIES};
  const render=items=>renderToStaticMarkup(React.createElement(OrinSettingsProvider,{initialSettings},React.createElement(NotificationList,{items,total:items.length,filter:'all',onFilter(){},onOpen(){},onMore(){}})));
  const out=render([notice('a','security',{message:'My actual account message'})]);
  assert.equal((out.match(/aria-pressed=/g)||[]).length,4);assert.equal((out.match(/aria-pressed="true"/g)||[]).length,1);assert.match(out,/My actual account message/);assert.match(out,/is-unread/);assert.doesNotMatch(out,/USDT 500|Standard/);
  const empty=render([]);assert.match(empty,/notice-empty/);assert.doesNotMatch(empty,/notice-card-content/);
 }
});
