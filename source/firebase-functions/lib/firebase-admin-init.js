// src/firebase-admin-init.ts
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (sa) {
    try {
      const creds = typeof sa === "string" ? JSON.parse(sa) : sa;
      return initializeApp({
        credential: cert(creds),
        projectId: creds.project_id || "orin-99951"
      });
    } catch (e) {
      console.warn("Could not parse FIREBASE_SERVICE_ACCOUNT JSON:", e);
    }
  }
  return initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "orin-99951" });
}
var adminApp = getAdminApp();
var realAdminAuth = getAuth(adminApp);
var adminAuth = new Proxy(realAdminAuth, {
  get(target, prop, receiver) {
    if (process.env.NODE_ENV === "test" && globalThis.__adminAuthMock?.[prop]) {
      return globalThis.__adminAuthMock[prop];
    }
    return Reflect.get(target, prop, receiver);
  }
});
export {
  adminApp,
  adminAuth,
  getAdminApp
};
//# sourceMappingURL=firebase-admin-init.js.map
