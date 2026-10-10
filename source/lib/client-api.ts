import {ensureFreshSecurityAccess} from './account-security-client';
type Runtime={token:(force?:boolean)=>Promise<string|null>;onUnauthorized:()=>void;request?:(path:string,init:RequestInit)=>Promise<Response>};
let runtime:Runtime|null=null;
export function configureFirebaseTransport(value:Runtime){runtime=value}
export const firebaseMode=()=>runtime!==null;
export const sparkMode=()=>!!runtime?.request;
export const signInUrl=(path='/')=>runtime?`/login?next=${encodeURIComponent(path)}`:`/signin-with-chatgpt?return_to=${encodeURIComponent(path)}`;
export const signOutUrl=()=>runtime?'/logout':'/signout-with-chatgpt?return_to=%2F';
export async function apiFetch(path:string,init:RequestInit={}){
 if(!path.startsWith('/api/')||path.includes('://')||path.includes('\\'))throw new Error('Invalid API destination');
 const headers=new Headers(init.headers),session=await ensureFreshSecurityAccess();
 if(session)headers.set('X-Orin-Session',session);
 init={...init,headers};
 if(runtime?.request){
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return Response.json({error:'أنت غير متصل. تحقق من الإنترنت ثم أعد المحاولة. / You are offline. Reconnect and retry.'},{status:503});
  const result=runtime.request(path,init);
  if(!init.method||init.method==='GET'){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([result,new Promise<Response>(resolve=>{timer=setTimeout(()=>resolve(Response.json({error:'تعذر الاتصال بالخدمة. أعد المحاولة. / Unable to connect. Please retry.'},{status:503})),18000)})])}finally{if(timer)clearTimeout(timer)}}
  return result;
 }
 if(runtime){
  const token=await runtime.token();
  if(token)headers.set('Authorization',`Bearer ${token}`);
 }
 let result=await fetch(path,{...init,headers});
 if(result.status===401&&runtime&&!path.startsWith('/api/control/')){
  const refreshedToken=await runtime.token(true).catch(()=>null);
  if(refreshedToken){
   headers.set('Authorization',`Bearer ${refreshedToken}`);
   result=await fetch(path,{...init,headers});
  }
  if(result.status===401&&!path.startsWith('/api/security/state'))runtime.onUnauthorized();
 }
 return result;
}
