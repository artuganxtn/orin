// WebView updates are independent of Android OS updates. Feature-detect runtime APIs.
// Vite transpiles syntax, not newer built-ins. In particular Array.at is absent
// in Chrome90, our supported build target, and some WebViews lack Promise.any.
if(!Array.prototype.at)Object.defineProperty(Array.prototype,'at',{configurable:true,writable:true,value:function(this:unknown[],index:number){
 if(this==null)throw new TypeError('Array.at called on null');
 const object=Object(this),length=Math.min(Math.max(Math.trunc(Number(object.length))||0,0),Number.MAX_SAFE_INTEGER),n=Number(index),integer=Number.isNaN(n)?0:Math.trunc(n),position=integer>=0?integer:length+integer;
 return position<0||position>=length?undefined:object[position];
}});
if(!Promise.any)Object.defineProperty(Promise,'any',{configurable:true,writable:true,value:function<T>(values:Iterable<T|PromiseLike<T>>){
 return new Promise<T>((resolve,reject)=>{
  const errors:unknown[]=[];let remaining=1,index=0;
  const fail=()=>{const error=typeof AggregateError==='function'?new AggregateError(errors,'All promises were rejected'):Object.assign(new Error('All promises were rejected'),{name:'AggregateError',errors});reject(error)};
  try{for(const value of values){const position=index++;remaining++;Promise.resolve(value).then(resolve,error=>{errors[position]=error;if(--remaining===0)fail()})}if(--remaining===0)fail()}catch(error){reject(error)}
 });
}});
if(!Object.hasOwn)Object.hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
if(!AbortSignal.timeout)AbortSignal.timeout=(ms:number)=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('Request timed out','TimeoutError')),ms);return controller.signal};
if(!crypto.randomUUID)crypto.randomUUID=()=>{const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const s=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`};
if(!Response.json)Response.json=(data,init)=>new Response(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json',...Object.fromEntries(new Headers(init?.headers))}});
