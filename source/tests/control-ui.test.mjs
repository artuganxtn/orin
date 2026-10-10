import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ControlCenter,controlCsv,createProgramTransport,ROLES,PERMISSIONS,permissionsFor} from './control-ui-bundle.mjs';
const session=role=>({available:true,uid:'test',roles:[role],permissions:permissionsFor([role]),capabilities:{},reauthSeconds:300});
test('role-aware navigation renders only authorized modules',()=>{const html=renderToStaticMarkup(React.createElement(ControlCenter,{initialSession:session('support'),initialData:{stats:[],activity:[]}}));assert(html.includes('المستخدمون'));assert(!html.includes('إعدادات التطبيق'));assert(!html.includes('الموافقات المالية'));assert(!html.includes('الموظفون والصلاحيات'))});
test('admin view includes all modules and disconnected-provider states, with Latin numerals',()=>{const html=renderToStaticMarkup(React.createElement(ControlCenter,{initialSession:session('super_admin'),initialData:{stats:[{id:'users',count:1234}],activity:[],asOf:Date.now()},preview:true}));assert(html.includes('1,234'));assert(html.includes('غير مفعّل'));assert(html.includes('الموافقات المالية'));assert(html.includes('بيانات توضيحية'));assert(!/[٠-٩]/.test(html))});
test('unconnected session has no working financial forms',()=>{const html=renderToStaticMarkup(React.createElement(ControlCenter,{initialSession:{available:false,roles:[],permissions:[],capabilities:{}},initialData:{}}));assert(html.includes('ربط الخادم الإداري مطلوب'));assert(!html.includes('اقتراح تسوية'))});
test('content is escaped and CSV formula injection is neutralized',()=>{const html=renderToStaticMarkup(React.createElement(ControlCenter,{path:'/admin/content',initialSession:session('super_admin'),initialData:{rows:[{id:'one',titleAr:'<script>alert(1)</script>',status:'draft',revision:1}]}}));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));const csv=controlCsv([{name:' =HYPERLINK("bad")',other:'@SUM(1)',id:'-1'}],['name','other','id']);assert(csv.includes("' =HYPERLINK"));assert(csv.includes("'@SUM"));assert(csv.includes("'-1"))});

test('control transport sends authenticated JSON only to the approved backend',async()=>{const original=globalThis.fetch;let called;globalThis.fetch=async(url,init)=>{called={url,init};return Response.json({ok:true})};try{const transport=createProgramTransport('https://europe-west1-orin-99951.cloudfunctions.net/orinApi',async()=>'test-token');await transport('/api/control/action',{method:'POST',body:'{}'});assert.equal(called.init.headers.get('Content-Type'),'application/json');assert.equal(called.init.headers.get('Authorization'),'Bearer test-token');await assert.rejects(transport('/api/not-allowed',{}));assert.throws(()=>createProgramTransport('https://not-orin.invalid',async()=>'token'))}finally{globalThis.fetch=original}});

test('support ticket screen has creation, priority and assignment filters; auditor remains read-only',()=>{
 const r={id:'ticket-1',uid:'customer-1',title:'<script>unsafe</script>',status:'open',priority:'urgent',assigneeId:'',dueAt:Date.now()-10000,revision:1};
 const support=renderToStaticMarkup(React.createElement(ControlCenter,{path:'/admin/tickets',initialSession:session('support'),initialData:{rows:[r]}}));
 assert(support.includes('تذكرة جديدة'));assert(support.includes('مسندة إليّ'));assert(support.includes('كل الأولويات'));assert(support.includes('متأخرة'));assert(support.includes('&lt;script&gt;'));assert(!support.includes('<script>'));
 const auditor=renderToStaticMarkup(React.createElement(ControlCenter,{path:'/admin/tickets',initialSession:session('auditor'),initialData:{rows:[r]}}));
 assert(!auditor.includes('تذكرة جديدة'));assert(auditor.includes('تصدير الصفحة'));
});
test('audit screen renders calendar and exact-match filters; dashboard handles unavailable counts',()=>{
 const audit=renderToStaticMarkup(React.createElement(ControlCenter,{path:'/admin/audit',initialSession:session('auditor'),initialData:{rows:[]}}));
 assert(audit.includes('من تاريخ'));assert(audit.includes('إلى تاريخ'));assert(audit.includes('العملية بالضبط'));assert(audit.includes('تطبيق الفلاتر'));
 const dash=renderToStaticMarkup(React.createElement(ControlCenter,{initialSession:session('support'),initialData:{queues:[{id:'tickets',module:'tickets',label:'تذاكر دعم مفتوحة',count:null}],stats:[]}}));
 assert(dash.includes('غير متاح'));assert(dash.includes('قائمة المتابعة'));
});
test('audit dates include the whole selected local day; invalid dates and resolved overdue tickets are excluded',async()=>{
 const {auditDateBoundary,ticketOverdue}=await import('./control-ui-bundle.mjs');
 const start=Number(auditDateBoundary('2026-10-04')),end=Number(auditDateBoundary('2026-10-04',true));
 assert.equal(new Date(start).getHours(),0);assert.equal(new Date(end).getHours(),23);assert.equal(new Date(end).getMilliseconds(),999);
 assert.equal(auditDateBoundary('2026-02-31'),'');assert.equal(auditDateBoundary(''), '');
 assert(ticketOverdue({status:'open',dueAt:10},20));assert(!ticketOverdue({status:'resolved',dueAt:10},20));assert(!ticketOverdue({status:'open',dueAt:null},20));
});
test('offline preview actually saves ticket and note fixtures, enforces role changes, and never calls fetch',async()=>{
 const {createReviewTransport}=await import('./control-ui-bundle.mjs');const previous=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Preview must stay offline')};
 try{
 const s={...session('support'),uid:'review-support'},rows={tickets:[],users:[{id:'customer'}],staff:[{id:'review-support',status:'active',roles:['support']}],audit:[],accounts:[],kyc:[],deposits:[],withdrawals:[],approvals:[]};
 const request=createReviewTransport(s,rows),post=async(input)=>(await request('/api/control/action',{method:'POST',body:JSON.stringify(input)}));
 const created=await post({action:'ticket.create',requestId:'create-1',target:'preview-ticket',revision:0,reason:'Review',data:{uid:'customer',title:'Preview',description:'Sample',priority:'high',category:'technical',dueAt:null}});assert(created.ok);
 const note={action:'ticket.note',requestId:'note-1',target:'preview-ticket',revision:1,reason:'Review',data:{body:'Internal preview note'}};
 assert((await post(note)).ok);assert((await post(note)).ok);
 const result=await(await request('/api/control/tickets?ticket=preview-ticket')).json();assert.equal(result.notes.length,1);assert.equal(result.ticket.revision,2);
 const list=await(await request('/api/control/tickets?priority=low')).json();assert.equal(list.rows.length,0);
 const auditor=createReviewTransport(session('auditor'),rows);assert.equal((await auditor('/api/control/action',{method:'POST',body:JSON.stringify({...note,requestId:'denied'})})).status,403);
 const finance=createReviewTransport(session('finance'),rows);assert.equal((await finance('/api/control/tickets')).status,403);
 }finally{globalThis.fetch=previous}
});
