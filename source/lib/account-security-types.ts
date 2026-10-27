/** Server-reported security state. Absence/unavailability never means enabled. */
export type SecurityDevice={platform:'Android'|'iOS'|'Web'|'Other';label:string;manufacturer?:string;model?:string;osVersion?:string;appVersion?:string};
export type SecuritySession={id:string;device:SecurityDevice;createdAt:number;lastActiveAt:number;expiresAt:number;ip:string|null;ipSource:'direct'|'trusted-proxy'|'unavailable';approximateLocation:null;current:boolean;status:'active'|'revoked'};
export type SecurityPasskey={id:string;name:string;createdAt:number;lastUsedAt:number|null};
export type SecurityTrustedDevice={id:string;name:string;createdAt:number;lastUsedAt:number;current:boolean};
export type SecurityEvent={id:string;action:string;createdAt:number;sessionId:string|null;ip:string|null;details:Record<string,string|number|boolean|null>};
export type SecurityState={available:boolean;totp?:{enabled:boolean};recoveryCodes?:{remaining:number};sessions?:SecuritySession[];passkeys?:SecurityPasskey[];trustedDevices?:SecurityTrustedDevice[];events?:SecurityEvent[];capabilities?:{passkeys:boolean;geoIP:false}};
export type SecuritySessionBundle={sessionId:string;accessToken:string;refreshToken:string;customToken:string;expiresAt:number;accessExpiresAt:number};
export type SecurityLoginChallenge={challengeId:string;requiresSecondFactor:true;methods:('totp'|'recovery'|'passkey')[]};
export type SecurityAction='totp.enroll'|'totp.disable'|'recovery.regenerate'|'passkey.add'|'passkey.delete'|'trusted.add'|'trusted.delete'|'password.change'|'withdrawal.destination'|'withdrawal.submit';
