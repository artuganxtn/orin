declare global {interface Window {orinNativeReferral?:boolean}}
export async function copyReferral(value:string){
 if(window.orinNativeReferral&&window.prompt('ORIN_COPY_REFERRAL:'+value)==='ok')return;
 await navigator.clipboard.writeText(value);
}
export async function shareReferral(url:string){
 if(window.orinNativeReferral&&window.prompt('ORIN_SHARE_REFERRAL:'+url)==='ok')return;
 if(navigator.share)await navigator.share({title:'ORIN',url});else await copyReferral(url);
}
