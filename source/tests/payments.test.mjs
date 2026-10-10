import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {paymentService,validIpn,canonical,units,NowPayments,db} from '../firebase-functions/payments-test.mjs';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Local emulator required');
const u={id:'payments-owner',email:'payments-owner@example.test',name:'Test',verified:true},other={...u,id:'payments-other',email:'payments-other@example.test'},secret='LOCAL-TEST-IPN-NOT-A-PROVIDER-SECRET';
let serial=900000,posts=0;const payments=new Map();
const provider={async create(orderId,amountCents,coin){posts++;const value={payment_id:String(++serial),order_id:orderId,price_amount:amountCents/100,price_currency:'usd',pay_currency:coin,pay_amount:'50',actually_paid:'0',payment_status:'waiting',pay_address:'TESTONLYADDRESSNEVERSENDMONEY',payin_extra_id:null};payments.set(value.payment_id,value);return value},async get(id){return structuredClone(payments.get(id))}};
const service=paymentService(provider,secret);
const command=(extra={})=>({accountId:'real',requestId:crypto.randomUUID(),amountCents:5000,coin:'usdttrc20',...extra});
const sign=body=>createHmac('sha512',secret).update(JSON.stringify(canonical(body))).digest('hex');
async function signal(item,status,paid='50',extra={}){const payment=payments.get(item.paymentId);Object.assign(payment,{payment_status:status,actually_paid:paid},extra);const body={order_id:item.id,payment_id:item.paymentId,payment_status:status};return service.webhook(body,sign(body))}
before(async()=>{for(const actor of [u,other]){await db.doc('users/'+actor.id).set({uid:actor.id,email:actor.email,displayName:'Test',disabled:false,role:'user'});await db.doc(`sparkTradingAccounts/${actor.id}/accounts/real`).set({ownerId:actor.id,type:'real',currency:'USD',balanceCents:0,reservedCents:0});await db.doc(`sparkTradingAccounts/${actor.id}/accounts/demo`).set({ownerId:actor.id,type:'demo',currency:'USD',balanceCents:0})}});
after(()=>db.terminate());
const cash=async()=> (await db.doc(`sparkTradingAccounts/${u.id}/accounts/real`).get()).data().balanceCents;
const resetRate=()=>db.doc('orinDepositRateLimits/'+u.id).delete();
test('signature validation binds the complete payload and tolerates key reordering',()=>{
 const body={b:2,a:{z:'3',q:4}};assert(validIpn(body,sign(body),secret));assert(validIpn({a:{q:4,z:'3'},b:2},sign(body),secret));assert(!validIpn({...body,b:3},sign(body),secret));assert(!validIpn(body,'00',secret));assert(!validIpn(body,sign(body),'wrong'));assert(!validIpn(body,sign(body),''));
});
test('decimal comparison never rounds an underpayment up to the requested amount',()=>{assert(units('49.999999999999999999')<units('50'));assert.equal(units('50.00',2),5000n);assert.throws(()=>units('50.001',2));assert.throws(()=>units(null));assert.throws(()=>units(-1))});
test('same deposit request is created once, concurrent retries and payload conflicts are safe',async()=>{
 const cmd=command(),beforePosts=posts;const [a,b]=await Promise.all([service.create(u,cmd),service.create(u,cmd)]);assert.equal(a.id,b.id);assert.equal(posts,beforePosts+1);assert.equal(await cash(),0);await assert.rejects(service.create(u,{...cmd,amountCents:6000}),e=>e.status===409);
});
test('demo, missing, unverified and cross-account requests are rejected',async()=>{
 await assert.rejects(service.create(u,command({accountId:'demo'})),e=>e.status===403);await assert.rejects(service.create(u,command({accountId:'missing'})),e=>e.status===403);await assert.rejects(service.create({...u,verified:false},command()),e=>e.status===403);
 const item=await service.create(u,command());await assert.rejects(service.get(other,item.id),e=>e.status===404);
});
test('forged notification does not contact provider or credit funds',async()=>{
 const item=await service.create(u,command());let reads=0;const guarded=paymentService({...provider,get:async()=>{reads++;throw Error('must not run')}},secret);
 await assert.rejects(guarded.webhook({payment_id:item.paymentId,order_id:item.id},'0'.repeat(128)),e=>e.status===401);assert.equal(reads,0);assert.equal(await cash(),0);
});
test('only authoritative finished payment credits cash; retries never double credit',async()=>{
 const item=await service.create(u,command());await signal(item,'confirming');assert.equal(await cash(),0);
 await Promise.all([signal(item,'finished'),signal(item,'finished')]);assert.equal(await cash(),5000);await signal(item,'finished');assert.equal(await cash(),5000);assert((await service.get(u,item.id)).credited);
 const ledger=(await db.doc('orinProgramLedger/deposit-nowpayments-'+item.paymentId).get()).data();assert.equal(ledger.entries.reduce((s,x)=>s+x.cents,0),0);
});
test('partial, underpaid, overpaid and failed payments do not auto-credit',async()=>{
 await resetRate();for(const [status,paid] of [['partially_paid','25'],['finished','49.999999999999999999'],['finished','51'],['failed','50']]){const item=await service.create(u,command());await signal(item,status,paid);assert(!(await service.get(u,item.id)).credited)}assert.equal(await cash(),5000);
});
test('wrong currency, amount, order and payment ID cannot be attached to another deposit',async()=>{
 await resetRate();const item=await service.create(u,command());const original=structuredClone(payments.get(item.paymentId));
 for(const extra of [{price_currency:'eur'},{pay_currency:'usdtbsc'},{price_amount:'50.01'},{order_id:'np-unknown'},{payment_id:'999991'}]){payments.set(item.paymentId,{...original,...extra,payment_status:'finished',actually_paid:'50'});const body={order_id:item.id,payment_id:item.paymentId};await assert.rejects(service.webhook(body,sign(body)));}assert.equal(await cash(),5000);
});
test('lost create response remains under review; retry never creates another payment',async()=>{
 let calls=0;const failing=paymentService({...provider,create:async()=>{calls++;throw new Error('Lost response')}},secret);const cmd=command(),a=await failing.create(u,cmd),b=await failing.create(u,cmd);assert.equal(a.status,'review');assert.equal(a.id,b.id);assert.equal(calls,1);assert.equal(await cash(),5000);
});
test('suspended account is held for review without ledger mutation',async()=>{
 const item=await service.create(u,command());await db.doc('orinControlAccess/'+u.id).set({status:'suspended'});await signal(item,'finished');assert.equal((await service.get(u,item.id)).status,'review');assert.equal(await cash(),5000);await assert.rejects(service.create(u,command()),e=>e.status===403);await db.doc('orinControlAccess/'+u.id).delete();
});
test('provider adapter sends only order metadata, uses server key and fixed callback',async()=>{
 let request;const api=new NowPayments('LOCAL-TEST-KEY','https://callback.example.test',async(url,init)=>{request={url,init};return Response.json({payment_id:'123'})});await api.create('np-order',5000,'usdtbsc');assert.equal(request.url,'https://api.nowpayments.io/v1/payment');assert.equal(request.init.headers['x-api-key'],'LOCAL-TEST-KEY');const body=JSON.parse(request.init.body);assert.equal(body.price_currency,'usd');assert.equal(body.pay_currency,'usdtbsc');assert.equal(body.ipn_callback_url,'https://callback.example.test');assert(!('uid' in body));assert(!('email' in body));assert.equal(request.init.redirect,'error');
});
test('provider reversal after credit creates a durable review without silently rewriting cash',async()=>{
 await resetRate();const item=await service.create(u,command());await signal(item,'finished');const balance=await cash();await signal(item,'refunded');await signal(item,'refunded');assert.equal((await service.get(u,item.id)).status,'review');assert.equal(await cash(),balance);const issue=(await db.doc('orinPaymentReviews/'+item.paymentId).get()).data();assert.equal(issue.reason,'provider_reversal_after_credit');assert.equal(issue.resolved,false);
});

test('user freeze and financial account freeze prevent a new provider payment request',async()=>{
 await resetRate();const count=posts;
 await db.doc('orinControlAccess/'+u.id).set({status:'restricted'});
 await assert.rejects(service.create(u,command()),e=>e.status===403);
 await db.doc('orinControlAccess/'+u.id).delete();
 const {createHash}=await import('node:crypto'),id=createHash('sha256').update(u.id+':real').digest('hex');
 await db.doc('orinControlAccountStates/'+id).set({status:'restricted'});
 await assert.rejects(service.create(u,command()),e=>e.status===403);
 await db.doc('orinControlAccountStates/'+id).delete();assert.equal(posts,count);
});
