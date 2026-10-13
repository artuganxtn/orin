import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

export function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0];
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (sa) {
    try {
      const creds = typeof sa === 'string' ? JSON.parse(sa) : sa;
      return initializeApp({
        credential: cert(creds),
        projectId: creds.project_id || 'orin-99951'
      });
    } catch (e) {
      console.warn('Could not parse FIREBASE_SERVICE_ACCOUNT JSON:', e);
    }
  }
  return initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'orin-99951' });
}

export const adminApp: App = getAdminApp();
const realAdminAuth: Auth = getAuth(adminApp);
export const adminAuth: Auth = new Proxy(realAdminAuth, {
  get(target, prop, receiver) {
    if (process.env.NODE_ENV === 'test' && (globalThis as any).__adminAuthMock?.[prop]) {
      return (globalThis as any).__adminAuthMock[prop];
    }
    return Reflect.get(target, prop, receiver);
  }
}) as Auth;
