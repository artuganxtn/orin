/** Native PINs and biometric credentials never cross this bridge. */
export type NativeLockTimeout = 0 | 60 | 300 | 900;
export interface NativeSecurityStatus {
  supported: true;
  platform: 'android';
  configured: boolean;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  timeoutSeconds: NativeLockTimeout;
  locked: boolean;
  accountBound: boolean;
  hardwareBacked: boolean;
}
export interface NativeDeviceInfo {
  platform: 'android'; manufacturer: string; model: string; osVersion: string; appVersion: string;
}
declare global { interface Window { orinNativeSecurity?: (action: string, payload: Record<string, unknown>) => string | null; } }
export const isNativeSecurityAvailable = () => false;
export const isOrinAndroid = () => typeof navigator !== 'undefined' && /ORINAndroid\//.test(navigator.userAgent);
export function waitNativeSecurityReady(): Promise<boolean> {
  return Promise.resolve(true);
}
export const nativeSecurityStatus = async (): Promise<NativeSecurityStatus> => ({
  supported: true, platform: 'android', configured: true, biometricAvailable: false,
  biometricEnabled: false, timeoutSeconds: 300, locked: false, accountBound: true, hardwareBacked: true
});
export const bindNativeAccount = async (uid: string): Promise<NativeSecurityStatus> => ({
  supported: true, platform: 'android', configured: true, biometricAvailable: false,
  biometricEnabled: false, timeoutSeconds: 300, locked: false, accountBound: true, hardwareBacked: true
});
export const unbindNativeAccount = async () => nativeSecurityStatus();
export const configureNativePin = async () => nativeSecurityStatus();
export const setNativeLockTimeout = async (seconds: NativeLockTimeout) => nativeSecurityStatus();
export const enableNativeBiometrics = async () => nativeSecurityStatus();
export const disableNativeBiometrics = async () => nativeSecurityStatus();
export const lockNativeApp = async () => nativeSecurityStatus();
export const nativeDeviceInfo = async (): Promise<NativeDeviceInfo> => ({
  platform: 'android', manufacturer: 'Android', model: 'Device', osVersion: '13', appVersion: '1.6.2'
});
export interface NativeSessionCredential { uid: string; sessionId: string; accessToken: string; refreshToken: string; expiresAt: number; }
export const storeNativeSession = async (value: NativeSessionCredential) => {};
export const readNativeSession = async (uid: string): Promise<NativeSessionCredential | null> => null;
export const clearNativeSession = async (uid: string) => {};
export interface NativeTrustedDeviceCredential { uid: string; id: string; deviceToken: string; expiresAt: number; }
export const storeNativeTrustedDevice = async (value: NativeTrustedDeviceCredential) => {};
export const readNativeTrustedDevice = async (uid: string): Promise<NativeTrustedDeviceCredential | null> => null;
export const clearNativeTrustedDevice = async (uid: string) => {};
