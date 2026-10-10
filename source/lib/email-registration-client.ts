const defaultApproved='https://europe-west1-orin-99951.cloudfunctions.net/orinIdentity';
function isValidIdentityEndpoint(base:string){
 if(base===defaultApproved)return true;
 if(/^https:\/\/[a-z0-9-]+\.onrender\.com(\/.*)?$/i.test(base))return true;
 if(typeof import.meta!=='undefined'&&(import.meta as any).env?.VITE_ORIN_IDENTITY_API_URL===base)return true;
 return false;
}
export class EmailRegistrationError extends Error{constructor(public code:string){super(code)}}
export function emailRegistrationClient(base:string|undefined){
 if(base&&!isValidIdentityEndpoint(base))throw new Error('Unapproved identity endpoint');
 async function request<T>(path:string,input:unknown):Promise<T>{
  if(!base)throw new EmailRegistrationError('service-unavailable');
  const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(20000),credentials:'omit',redirect:'error'});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new EmailRegistrationError('service-unavailable');
  const result=await response.json();if(!result||typeof result!=='object')throw new EmailRegistrationError('service-unavailable');if(!response.ok)throw new EmailRegistrationError('code' in result&&typeof result.code==='string'?result.code:'service-unavailable');return result as T;
 }
 return {configured:!!base,send:(email:string)=>request<{challengeId:string;expiresIn:number;retryAfter:number}>('/send-code',{email}),register:(input:{email:string;name:string;password:string;code:string;challengeId:string})=>request<{token:string}>('/register',input)};
}
