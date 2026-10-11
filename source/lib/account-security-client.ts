import {isNativeSecurityAvailable,nativeDeviceInfo,readNativeSession,storeNativeSession,clearNativeSession,storeNativeTrustedDevice,readNativeTrustedDevice,clearNativeTrustedDevice} from './native-security';
import {APP_VERSION} from './account-validation';

export type SecurityDevice={platform:string;manufacturer?:string;model?:string;osVersion?:string;appVersion:string;label?:string};
export type SecuritySession={sessionId:string;accessToken:string;refreshToken:string;expiresAt:number;accessExpiresAt?:number;uid:string};
export type SecurityChallenge={requiresSecondFactor:true;challengeId:string};
export type SecurityStepAction='totp.enroll'|'totp.disable'|'recovery.regenerate'|'passkey.add'|'passkey.delete'|'trusted.add'|'trusted.delete'|'password.change'|'withdrawal.destination'|'withdrawal.submit';
type Runtime={base?:string;token:(force?:boolean)=>Promise<string|null>;uid:()=>string|null;exchangeToken:(token:string)=>Promise<void>;onRevoked:()=>void;reauthenticate:(password:string)=>Promise<string>};
let runtime:Runtime|null=null,session:SecuritySession|null=null,refreshing:Promise<void>|null=null,sessionReadyAt=0,pendingPrimaryToken:string|null=null;
const SESSION_KEY='orin-security-session-v1';
const TRUST_KEY='orin-trusted-device-v1';
export class AccountSecurityError extends Error{constructor(public code:string,message:string,public status=503){super(message);this.name='AccountSecurityError'}}
function isValidSecurityEndpoint(base:string){
 if(!base || base==='') return true;
 if(/^https:\/\/europe-west1-orin-99951\.cloudfunctions\.net\/orinSecurity$/.test(base))return true;
 if(/^https:\/\/[a-z0-9-]+\.onrender\.com(\/.*)?$/i.test(base))return true;
 if(base==='https://orin-trader.top'||base.startsWith('https://orin-trader.top/'))return true;
 if(typeof import.meta!=='undefined'&&(import.meta as any).env?.VITE_ORIN_SECURITY_API_URL===base)return true;
 if(typeof import.meta!=='undefined'&&(import.meta as any).env?.DEV&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(base))return true;
 return false;
}
export function configureAccountSecurity(value:Runtime){
 if(value.base&&!isValidSecurityEndpoint(value.base))throw new Error('Unapproved ORIN security endpoint');
 runtime=value;
}
export const securityBackendConfigured=()=>!!runtime?.base;
export const getSecurityAccessToken=()=>session&&session.uid===runtime?.uid()?session.accessToken:null;
export const getSecuritySessionId=()=>session&&session.uid===runtime?.uid()?session.sessionId:null;
export const securityCurrentUid=()=>runtime?.uid()??null;
export async function securityDevice():Promise<SecurityDevice>{
 if(isNativeSecurityAvailable()){
  try{const device=await nativeDeviceInfo();return {...device,platform:'Android',label:[device.manufacturer,device.model].filter(Boolean).join(' ')||'Android'};}
  catch{return {platform:'Android',appVersion:APP_VERSION,label:'Android device'};}
 }
 const ua=navigator.userAgent,platform=/iPhone|iPad/.test(ua)?'iOS':/Android/.test(ua)?'Android':'Web';
 return {platform,appVersion:APP_VERSION,label:platform==='Web'?'Web browser':`${platform} browser`};
}
async function persist(value:SecuritySession){session=value;try{localStorage.setItem(SESSION_KEY,JSON.stringify(value))}catch{}}
async function restore(uid:string){
 try{const value=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');if(value&&value.uid===uid&&typeof value.sessionId==='string'&&typeof value.accessToken==='string'&&typeof value.refreshToken==='string'&&typeof value.expiresAt==='number')session=value;}catch{/* Missing storage is not an authenticated session. */}
}
export async function clearSecuritySession(){const uid=session?.uid??runtime?.uid();session=null;sessionReadyAt=0;try{localStorage.removeItem(SESSION_KEY)}catch{}dispatchEvent(new Event('orin-security-session-cleared'))}
export async function securityRequest<T=Record<string,unknown>>(path:string,body?:unknown,options:{anonymous?:boolean;freshIdentity?:boolean;identityToken?:string}={}):Promise<T>{
 if(!runtime?.base)throw new AccountSecurityError('backend-required','خادم أمان ORIN الموثوق لم يُنشر أو يُربط بعد. / ORIN security backend has not been connected.');
 if(!/^[-a-z0-9/]+$/.test(path))throw new Error('Invalid security path');
 if(!options.anonymous&&session?.accessExpiresAt&&session.accessExpiresAt<Date.now()+30000)await refreshSecuritySession();
 const token=options.identityToken??await runtime.token(options.freshIdentity);if(!token&&!path.startsWith('passkeys/login/'))throw new AccountSecurityError('sign-in-required','سجّل الدخول للمتابعة. / Sign in to continue.',401);
 const headers:Record<string,string>={'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})};
 if(!options.anonymous&&getSecurityAccessToken())headers['X-Orin-Session']=getSecurityAccessToken()!;
 let lastError:any=null;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(new DOMException('Timeout','TimeoutError')),60000);
   let response:Response;
   try{
    response=await fetch(runtime.base+'/api/security/'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',redirect:'follow',signal:controller.signal});
   }finally{
    clearTimeout(timer);
   }
   if(!response.headers.get('content-type')?.includes('application/json'))throw new AccountSecurityError('backend-required','خادم الأمان غير متاح في هذا العنوان. / Security backend unavailable.');
   const raw:unknown=await response.json();if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AccountSecurityError('invalid-response','استجابة أمان غير صالحة. / Invalid security response.');const result=raw as Record<string,unknown>;
   if(!response.ok){
    const code=typeof result.code==='string'?result.code:'security-request-failed';
    if(!options.anonymous&&(['session-revoked','invalid-session','session-expired'].includes(code)||(response.status===401&&['state','refresh','sessions','events'].includes(path)))){await clearSecuritySession();runtime.onRevoked()};
    throw new AccountSecurityError(code,typeof result.error==='string'?result.error:'تعذرت العملية الأمنية. / Security operation failed.',response.status);
   }
   if(path==='session/revoke'&&(body as any)?.sessionId===session?.sessionId){await clearSecuritySession();runtime.onRevoked()}
   return result as T;
  }catch(err){
   lastError=err;
   if(err instanceof AccountSecurityError&&err.code!=='network'&&err.code!=='backend-required')throw err;
   console.warn(`ORIN_DIAGNOSTIC securityRequest ${path} attempt ${attempt+1} failed:`,(err as Error)?.message||err);
   if(attempt<2)await new Promise(r=>setTimeout(r,1500*(attempt+1)));
  }
 }
 const reason=(lastError as Error)?.message||'Timeout';
 throw new AccountSecurityError('network',`تعذر الاتصال بخادم الأمان. أعد المحاولة.`);
}
async function acceptBundle(bundle:any){
 let uid=runtime?.uid();if(!uid&&typeof bundle.customToken==='string'){try{uid=JSON.parse(atob(bundle.customToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).uid}catch{}}if(!uid||typeof bundle.sessionId!=='string'||typeof bundle.accessToken!=='string'||typeof bundle.refreshToken!=='string'||typeof bundle.expiresAt!=='number')throw new AccountSecurityError('invalid-response','استجابة جلسة غير صالحة. / Invalid session response.');
 await persist({uid,sessionId:bundle.sessionId,accessToken:bundle.accessToken,refreshToken:bundle.refreshToken,expiresAt:bundle.expiresAt,accessExpiresAt:bundle.accessExpiresAt});
 sessionReadyAt=Date.now();
 try{if(typeof bundle.customToken!=='string')throw new AccountSecurityError('invalid-response','Missing Firebase session proof');let currentSid='';try{const token=await runtime!.token();if(token)currentSid=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sid??''}catch{}if(currentSid!==bundle.sessionId)await runtime!.exchangeToken(bundle.customToken);if(runtime!.uid()!==uid)throw new AccountSecurityError('identity-mismatch','Session identity mismatch',401)}catch(error){await clearSecuritySession();throw error}
 dispatchEvent(new Event('orin-security-session-ready'));
}
export async function refreshSecuritySession(){
 if(refreshing)return refreshing;
 refreshing=(async()=>{if(!session)throw new AccountSecurityError('sign-in-required','Sign in required',401);const result=await securityRequest('refresh',{sessionId:session.sessionId,refreshToken:session.refreshToken},{anonymous:true});await acceptBundle(result)})().finally(()=>{refreshing=null});return refreshing;
}
export async function ensureSecuritySession():Promise<SecurityChallenge|null>{
 if(!securityBackendConfigured())return null;
 const uid=runtime?.uid();if(!uid)throw new AccountSecurityError('sign-in-required','Sign in required',401);
 if(session?.uid!==uid){session=null;await restore(uid)}
 if(session){try{if(Date.now()-sessionReadyAt>60000)await refreshSecuritySession();return null}catch(error){if(error instanceof AccountSecurityError&&error.status>=500)throw error;await clearSecuritySession()}}
 const trustedDevice=await readTrustedDevice();
 const result=await securityRequest<any>('login',{device:await securityDevice(),...(trustedDevice?{trustedDevice:{id:trustedDevice.id,deviceToken:trustedDevice.deviceToken}}:{})},{anonymous:true,freshIdentity:true,...(pendingPrimaryToken?{identityToken:pendingPrimaryToken}:{})});pendingPrimaryToken=null;
 if(result.requiresSecondFactor===true&&typeof result.challengeId==='string')return result as SecurityChallenge;
 await acceptBundle(result);await proveTrustedDevice();return null;
}
export async function completeSecurityLogin(challengeId:string,code:string,recovery=false){await acceptBundle(await securityRequest('login/complete',{challengeId,...(recovery?{recoveryCode:code}:{otp:code})},{anonymous:true}));await proveTrustedDevice()}
export async function reauthenticateForSecurityLogin(password:string){if(!runtime)throw new Error('Sign in required');pendingPrimaryToken=await runtime.reauthenticate(password)}
export async function securityReauthenticate(password:string){if(!runtime)throw new Error('Sign in required');return runtime.reauthenticate(password)}
export async function securityStepUp(action:SecurityStepAction,proof:{otp?:string;recoveryCode?:string;password?:string}={}){
 let freshFirebaseToken:string|null=null;if(proof.password){freshFirebaseToken=await runtime!.reauthenticate(proof.password)}
 return securityRequest<{stepUpToken:string;expiresAt:number}>('step-up',{action,...(freshFirebaseToken?{freshFirebaseToken}:{}),...(proof.otp?{otp:proof.otp}:{}),...(proof.recoveryCode?{recoveryCode:proof.recoveryCode}:{})},{freshIdentity:true});
}
export async function endCurrentSecuritySession(){try{if(session)await securityRequest('logout',{})}finally{await clearSecuritySession()}}

export const supportsPasskeys=()=>typeof window!=='undefined'&&window.isSecureContext&&!!window.PublicKeyCredential&&!!navigator.credentials&&!/\bwv\b|ORINAndroid\//.test(navigator.userAgent);
function buffer(value:string){const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0)).buffer}
function base64(value:ArrayBuffer){let text='';for(const b of new Uint8Array(value))text+=String.fromCharCode(b);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
export async function createSecurityPasskey(stepUpToken:string,label:string){
 if(!supportsPasskeys())throw new AccountSecurityError('passkeys-unsupported','استخدم متصفحًا يدعم Passkeys على رابط ORIN الرسمي. / Use a compatible browser on the official ORIN site.');
 const result=await securityRequest<any>('passkeys/options',{stepUpToken,name:label});
 const options=result.options??result.publicKey??result;
 const credential=await navigator.credentials.create({publicKey:{...options,challenge:buffer(options.challenge),user:{...options.user,id:buffer(options.user.id)},excludeCredentials:options.excludeCredentials?.map((c:any)=>({...c,id:buffer(c.id)}))}}) as PublicKeyCredential|null;
 if(!credential)throw new AccountSecurityError('passkey-cancelled','تم إلغاء إنشاء المفتاح. / Passkey creation cancelled.');
 const response=credential.response as AuthenticatorAttestationResponse;
 return securityRequest('passkeys/verify',{challengeId:result.challengeId,response:{id:credential.id,rawId:base64(credential.rawId),type:credential.type,response:{clientDataJSON:base64(response.clientDataJSON),attestationObject:base64(response.attestationObject),transports:response.getTransports?.()??[]},clientExtensionResults:credential.getClientExtensionResults()}});
}

export async function passkeyStepUp(action:SecurityStepAction){
 if(!supportsPasskeys())throw new AccountSecurityError('passkeys-unsupported','Passkeys are unavailable in this browser.');
 const result=await securityRequest<any>('passkeys/auth/options',{action}),options=result.options;
 const credential=await navigator.credentials.get({publicKey:{...options,challenge:buffer(options.challenge),allowCredentials:options.allowCredentials?.map((c:any)=>({...c,id:buffer(c.id)}))}}) as PublicKeyCredential|null;
 if(!credential)throw new AccountSecurityError('passkey-cancelled','Passkey verification cancelled.');
 const response=credential.response as AuthenticatorAssertionResponse;
 return securityRequest<{stepUpToken:string;expiresAt:number}>('passkeys/auth/verify',{challengeId:result.challengeId,response:{id:credential.id,rawId:base64(credential.rawId),type:credential.type,response:{clientDataJSON:base64(response.clientDataJSON),authenticatorData:base64(response.authenticatorData),signature:base64(response.signature),userHandle:response.userHandle?base64(response.userHandle):null},clientExtensionResults:credential.getClientExtensionResults()}});
}

export async function saveTrustedDevice(value:{id:string;deviceToken:string;expiresAt:number}){
 const uid=runtime?.uid();if(!uid)throw new Error('Sign in required');
 localStorage.setItem(TRUST_KEY+uid,JSON.stringify({...value,uid}));
 await proveTrustedDevice();
}
export async function forgetTrustedDevice(id:string){
 const uid=runtime?.uid();if(!uid)return;
 const value=await readTrustedDevice();if(value?.id!==id)return;
 localStorage.removeItem(TRUST_KEY+uid);
}
async function readTrustedDevice(){const uid=runtime?.uid();if(!uid)return null;try{const value=JSON.parse(localStorage.getItem(TRUST_KEY+uid)||'null');return value&&value.uid===uid&&value.expiresAt>Date.now()?value:null}catch{return null}}
export async function proveTrustedDevice(){const value=await readTrustedDevice();if(!value)return;try{await securityRequest('trusted/prove',{id:value.id,deviceToken:value.deviceToken})}catch(error){if(error instanceof AccountSecurityError&&error.status<500)await forgetTrustedDevice(value.id)}}

export async function loginWithPasskey(){
 if(!supportsPasskeys())throw new AccountSecurityError('passkeys-unsupported','Passkeys are unavailable in this browser.');
 const result=await securityRequest<any>('passkeys/login/options',{}, {anonymous:true}),options=result.options;
 const credential=await navigator.credentials.get({publicKey:{...options,challenge:buffer(options.challenge)}}) as PublicKeyCredential|null;
 if(!credential)throw new AccountSecurityError('passkey-cancelled','Passkey sign-in cancelled.');
 const response=credential.response as AuthenticatorAssertionResponse;
 const bundle=await securityRequest('passkeys/login/verify',{challengeId:result.challengeId,device:await securityDevice(),response:{id:credential.id,rawId:base64(credential.rawId),type:credential.type,response:{clientDataJSON:base64(response.clientDataJSON),authenticatorData:base64(response.authenticatorData),signature:base64(response.signature),userHandle:response.userHandle?base64(response.userHandle):null},clientExtensionResults:credential.getClientExtensionResults()}},{anonymous:true});
 await acceptBundle(bundle);await proveTrustedDevice();
}

export async function ensureFreshSecurityAccess(){if(!securityBackendConfigured())return null;if(!session){try{await ensureSecuritySession();}catch{}}if(session&&(!session.accessExpiresAt||session.accessExpiresAt<Date.now()+60000)){try{await refreshSecuritySession();}catch{}}return getSecurityAccessToken();}
