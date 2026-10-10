export function passwordStrength(password:string){
 if(!password)return 0;
 let score=password.length>=8?1:0;
 if(password.length>=12)score++;
 if(/[a-z]/i.test(password)&&/\d/.test(password))score++;
 if(/[^a-z0-9]/i.test(password))score++;
 return Math.min(4,score);
}
export const validEmail=(value:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())&&value.trim().length<=320;
export const APP_VERSION='1.6.2';
export const EMAIL_RETURN_ORIGIN='https://orin-99951.web.app';

// Matches the current AndroidManifest versionCode; update both when distributing a new APK.
export const APP_BUILD_CODE=20;
