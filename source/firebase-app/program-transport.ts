import {ensureFreshSecurityAccess} from '../lib/account-security-client';
/** Optional trusted backend. Unset in Spark builds until the owner provisions the service. */
function isValidProgramBackend(base:string){
 if(base==='https://europe-west1-orin-99951.cloudfunctions.net/orinApi')return true;
 if(/^https:\/\/[a-z0-9-]+\.onrender\.com(\/.*)?$/i.test(base))return true;
 if(typeof import.meta!=='undefined'&&(import.meta as any).env?.VITE_ORIN_PROGRAM_API_URL===base)return true;
 return false;
}
export function createProgramTransport(base:string|undefined,token:()=>Promise<string|null>){
 if(!base)return undefined;
 if(!isValidProgramBackend(base))throw new Error('Unapproved ORIN program backend');
 return async(path:string,init:RequestInit={})=>{if(!path.startsWith('/api/'))throw new Error('Invalid program route');const session=await ensureFreshSecurityAccess(),idToken=await token();if(!idToken)return Response.json({error:'Session expired'},{status:401});const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+idToken);if(session)headers.set('X-Orin-Session',session);if(init.body)headers.set('Content-Type','application/json');return fetch(base+path,{...init,headers,credentials:'omit',redirect:'error',signal:init.signal??AbortSignal.timeout(path==='/api/support/assistant'?55000:15000)})};
}
