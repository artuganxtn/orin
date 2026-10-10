// lib/native-security.ts
var isNativeSecurityAvailable = () => typeof window !== "undefined" && typeof window.orinNativeSecurity === "function";
function request(action, args = {}) {
  return new Promise((resolve, reject) => {
    if (!isNativeSecurityAvailable()) {
      reject(new Error("Native security is unavailable on this device."));
      return;
    }
    const id = crypto.randomUUID();
    const onResult = (event) => {
      const result = event.detail;
      if (!result || result.id !== id) return;
      window.removeEventListener("orin:native-security-result", onResult);
      result.ok ? resolve(result.data) : reject(new Error(result.error || "Native security request failed."));
    };
    window.addEventListener("orin:native-security-result", onResult);
    try {
      const reply = JSON.parse(window.orinNativeSecurity(action, { ...args, id }) || "{}");
      if (!reply.pending) {
        window.removeEventListener("orin:native-security-result", onResult);
        reply.ok ? resolve(reply.data) : reject(new Error(reply.error || "Native request rejected."));
      }
    } catch (error) {
      window.removeEventListener("orin:native-security-result", onResult);
      reject(error);
    }
  });
}
var nativeDeviceInfo = () => request("device");
var storeNativeSession = (value) => request("storeSession", { value });
var readNativeSession = (uid) => request("readSession", { uid });
var clearNativeSession = (uid) => request("clearSession", { uid });
var storeNativeTrustedDevice = (value) => request("storeTrustedDevice", { value });
var readNativeTrustedDevice = (uid) => request("readTrustedDevice", { uid });
var clearNativeTrustedDevice = (uid) => request("clearTrustedDevice", { uid });

// lib/account-validation.ts
var APP_VERSION = "1.6.0";

// lib/account-security-client.ts
var runtime = null;
var session = null;
var refreshing = null;
var sessionReadyAt = 0;
var pendingPrimaryToken = null;
var SESSION_KEY = "orin-security-session-v1";
var AccountSecurityError = class extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "AccountSecurityError";
  }
};
function configureAccountSecurity(value) {
  if (value.base && !/^https:\/\/europe-west1-orin-99951\.cloudfunctions\.net\/orinSecurity$/.test(value.base) && !(import.meta.env?.DEV && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(value.base))) throw new Error("Unapproved ORIN security endpoint");
  runtime = value;
}
var securityBackendConfigured = () => !!runtime?.base;
var getSecurityAccessToken = () => session && session.uid === runtime?.uid() ? session.accessToken : null;
var getSecuritySessionId = () => session && session.uid === runtime?.uid() ? session.sessionId : null;
var securityCurrentUid = () => runtime?.uid() ?? null;
async function securityDevice() {
  if (isNativeSecurityAvailable()) {
    const device = await nativeDeviceInfo();
    return { ...device, platform: "Android", label: [device.manufacturer, device.model].filter(Boolean).join(" ") || "Android" };
  }
  const ua = navigator.userAgent, platform = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : "Web";
  return { platform, appVersion: APP_VERSION, label: platform === "Web" ? "Web browser" : `${platform} browser` };
}
async function persist(value) {
  session = value;
  if (isNativeSecurityAvailable()) await storeNativeSession(value);
  else try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
  }
}
async function restore(uid) {
  try {
    const value = isNativeSecurityAvailable() ? await readNativeSession(uid) : JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (value && value.uid === uid && typeof value.sessionId === "string" && typeof value.accessToken === "string" && typeof value.refreshToken === "string" && typeof value.expiresAt === "number") session = value;
  } catch {
  }
}
async function clearSecuritySession() {
  const uid = session?.uid ?? runtime?.uid();
  session = null;
  sessionReadyAt = 0;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
  }
  if (uid && isNativeSecurityAvailable()) await clearNativeSession(uid).catch(() => {
  });
  dispatchEvent(new Event("orin-security-session-cleared"));
}
async function securityRequest(path, body, options = {}) {
  if (!runtime?.base) throw new AccountSecurityError("backend-required", "\u062E\u0627\u062F\u0645 \u0623\u0645\u0627\u0646 ORIN \u0627\u0644\u0645\u0648\u062B\u0648\u0642 \u0644\u0645 \u064A\u064F\u0646\u0634\u0631 \u0623\u0648 \u064A\u064F\u0631\u0628\u0637 \u0628\u0639\u062F. / ORIN security backend has not been connected.");
  if (!/^[-a-z0-9/]+$/.test(path)) throw new Error("Invalid security path");
  if (!options.anonymous && session?.accessExpiresAt && session.accessExpiresAt < Date.now() + 3e4) await refreshSecuritySession();
  const token = options.identityToken ?? await runtime.token(options.freshIdentity);
  if (!token && !path.startsWith("passkeys/login/")) throw new AccountSecurityError("sign-in-required", "\u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629. / Sign in to continue.", 401);
  const headers = { "Content-Type": "application/json", ...token ? { Authorization: "Bearer " + token } : {} };
  if (!options.anonymous && getSecurityAccessToken()) headers["X-Orin-Session"] = getSecurityAccessToken();
  let response;
  try {
    response = await fetch(runtime.base + "/api/security/" + path, { method: body === void 0 ? "GET" : "POST", headers, ...body === void 0 ? {} : { body: JSON.stringify(body) }, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(2e4) });
  } catch {
    throw new AccountSecurityError("network", "\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u062E\u0627\u062F\u0645 \u0627\u0644\u0623\u0645\u0627\u0646. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0634\u0628\u0643\u0629. / Cannot reach the security server.");
  }
  if (!response.headers.get("content-type")?.includes("application/json")) throw new AccountSecurityError("backend-required", "\u062E\u0627\u062F\u0645 \u0627\u0644\u0623\u0645\u0627\u0646 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0639\u0646\u0648\u0627\u0646. / Security backend unavailable.");
  const raw = await response.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AccountSecurityError("invalid-response", "\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0623\u0645\u0627\u0646 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629. / Invalid security response.");
  const result = raw;
  if (!response.ok) {
    const code = typeof result.code === "string" ? result.code : "security-request-failed";
    if (!options.anonymous && (["session-revoked", "invalid-session", "session-expired"].includes(code) || response.status === 401 && ["state", "refresh", "sessions", "events"].includes(path))) {
      await clearSecuritySession();
      runtime.onRevoked();
    }
    ;
    throw new AccountSecurityError(code, typeof result.error === "string" ? result.error : "\u062A\u0639\u0630\u0631\u062A \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u0623\u0645\u0646\u064A\u0629. / Security operation failed.", response.status);
  }
  if (path === "session/revoke" && body?.sessionId === session?.sessionId) {
    await clearSecuritySession();
    runtime.onRevoked();
  }
  return result;
}
async function acceptBundle(bundle) {
  let uid = runtime?.uid();
  if (!uid && typeof bundle.customToken === "string") {
    try {
      uid = JSON.parse(atob(bundle.customToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).uid;
    } catch {
    }
  }
  if (!uid || typeof bundle.sessionId !== "string" || typeof bundle.accessToken !== "string" || typeof bundle.refreshToken !== "string" || typeof bundle.expiresAt !== "number") throw new AccountSecurityError("invalid-response", "\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u062C\u0644\u0633\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629. / Invalid session response.");
  await persist({ uid, sessionId: bundle.sessionId, accessToken: bundle.accessToken, refreshToken: bundle.refreshToken, expiresAt: bundle.expiresAt, accessExpiresAt: bundle.accessExpiresAt });
  sessionReadyAt = Date.now();
  try {
    if (typeof bundle.customToken !== "string") throw new AccountSecurityError("invalid-response", "Missing Firebase session proof");
    let currentSid = "";
    try {
      const token = await runtime.token();
      if (token) currentSid = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sid ?? "";
    } catch {
    }
    if (currentSid !== bundle.sessionId) await runtime.exchangeToken(bundle.customToken);
    if (runtime.uid() !== uid) throw new AccountSecurityError("identity-mismatch", "Session identity mismatch", 401);
  } catch (error) {
    await clearSecuritySession();
    throw error;
  }
  dispatchEvent(new Event("orin-security-session-ready"));
}
async function refreshSecuritySession() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!session) throw new AccountSecurityError("sign-in-required", "Sign in required", 401);
    const result = await securityRequest("refresh", { sessionId: session.sessionId, refreshToken: session.refreshToken }, { anonymous: true });
    await acceptBundle(result);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
async function ensureSecuritySession() {
  if (!securityBackendConfigured()) return null;
  const uid = runtime?.uid();
  if (!uid) throw new AccountSecurityError("sign-in-required", "Sign in required", 401);
  if (session?.uid !== uid) {
    session = null;
    await restore(uid);
  }
  if (session) {
    try {
      if (Date.now() - sessionReadyAt > 6e4) await refreshSecuritySession();
      return null;
    } catch (error) {
      if (error instanceof AccountSecurityError && error.status >= 500) throw error;
      await clearSecuritySession();
    }
  }
  const trustedDevice = await readTrustedDevice();
  const result = await securityRequest("login", { device: await securityDevice(), ...trustedDevice ? { trustedDevice: { id: trustedDevice.id, deviceToken: trustedDevice.deviceToken } } : {} }, { anonymous: true, freshIdentity: true, ...pendingPrimaryToken ? { identityToken: pendingPrimaryToken } : {} });
  pendingPrimaryToken = null;
  if (result.requiresSecondFactor === true && typeof result.challengeId === "string") return result;
  await acceptBundle(result);
  await proveTrustedDevice();
  return null;
}
async function completeSecurityLogin(challengeId, code, recovery = false) {
  await acceptBundle(await securityRequest("login/complete", { challengeId, ...recovery ? { recoveryCode: code } : { otp: code } }, { anonymous: true }));
  await proveTrustedDevice();
}
async function reauthenticateForSecurityLogin(password) {
  if (!runtime) throw new Error("Sign in required");
  pendingPrimaryToken = await runtime.reauthenticate(password);
}
async function securityReauthenticate(password) {
  if (!runtime) throw new Error("Sign in required");
  return runtime.reauthenticate(password);
}
async function securityStepUp(action, proof = {}) {
  let freshFirebaseToken = null;
  if (proof.password) {
    freshFirebaseToken = await runtime.reauthenticate(proof.password);
  }
  return securityRequest("step-up", { action, ...freshFirebaseToken ? { freshFirebaseToken } : {}, ...proof.otp ? { otp: proof.otp } : {}, ...proof.recoveryCode ? { recoveryCode: proof.recoveryCode } : {} }, { freshIdentity: true });
}
async function endCurrentSecuritySession() {
  try {
    if (session) await securityRequest("logout", {});
  } finally {
    await clearSecuritySession();
  }
}
var supportsPasskeys = () => typeof window !== "undefined" && window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials && !/\bwv\b|ORINAndroid\//.test(navigator.userAgent);
function buffer(value) {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}
function base64(value) {
  let text = "";
  for (const b of new Uint8Array(value)) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function createSecurityPasskey(stepUpToken, label) {
  if (!supportsPasskeys()) throw new AccountSecurityError("passkeys-unsupported", "\u0627\u0633\u062A\u062E\u062F\u0645 \u0645\u062A\u0635\u0641\u062D\u064B\u0627 \u064A\u062F\u0639\u0645 Passkeys \u0639\u0644\u0649 \u0631\u0627\u0628\u0637 ORIN \u0627\u0644\u0631\u0633\u0645\u064A. / Use a compatible browser on the official ORIN site.");
  const result = await securityRequest("passkeys/options", { stepUpToken, name: label });
  const options = result.options ?? result.publicKey ?? result;
  const credential = await navigator.credentials.create({ publicKey: { ...options, challenge: buffer(options.challenge), user: { ...options.user, id: buffer(options.user.id) }, excludeCredentials: options.excludeCredentials?.map((c) => ({ ...c, id: buffer(c.id) })) } });
  if (!credential) throw new AccountSecurityError("passkey-cancelled", "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0645\u0641\u062A\u0627\u062D. / Passkey creation cancelled.");
  const response = credential.response;
  return securityRequest("passkeys/verify", { challengeId: result.challengeId, response: { id: credential.id, rawId: base64(credential.rawId), type: credential.type, response: { clientDataJSON: base64(response.clientDataJSON), attestationObject: base64(response.attestationObject), transports: response.getTransports?.() ?? [] }, clientExtensionResults: credential.getClientExtensionResults() } });
}
async function passkeyStepUp(action) {
  if (!supportsPasskeys()) throw new AccountSecurityError("passkeys-unsupported", "Passkeys are unavailable in this browser.");
  const result = await securityRequest("passkeys/auth/options", { action }), options = result.options;
  const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: buffer(options.challenge), allowCredentials: options.allowCredentials?.map((c) => ({ ...c, id: buffer(c.id) })) } });
  if (!credential) throw new AccountSecurityError("passkey-cancelled", "Passkey verification cancelled.");
  const response = credential.response;
  return securityRequest("passkeys/auth/verify", { challengeId: result.challengeId, response: { id: credential.id, rawId: base64(credential.rawId), type: credential.type, response: { clientDataJSON: base64(response.clientDataJSON), authenticatorData: base64(response.authenticatorData), signature: base64(response.signature), userHandle: response.userHandle ? base64(response.userHandle) : null }, clientExtensionResults: credential.getClientExtensionResults() } });
}
var TRUST_KEY = "orin-trusted-device-v1:";
async function saveTrustedDevice(value) {
  const uid = runtime?.uid();
  if (!uid) throw new Error("Sign in required");
  if (isNativeSecurityAvailable()) await storeNativeTrustedDevice({ uid, ...value });
  else localStorage.setItem(TRUST_KEY + uid, JSON.stringify({ ...value, uid }));
  await proveTrustedDevice();
}
async function forgetTrustedDevice(id) {
  const uid = runtime?.uid();
  if (!uid) return;
  const value = await readTrustedDevice();
  if (value?.id !== id) return;
  if (isNativeSecurityAvailable()) await clearNativeTrustedDevice(uid);
  else localStorage.removeItem(TRUST_KEY + uid);
}
async function readTrustedDevice() {
  const uid = runtime?.uid();
  if (!uid) return null;
  try {
    const value = isNativeSecurityAvailable() ? await readNativeTrustedDevice(uid) : JSON.parse(localStorage.getItem(TRUST_KEY + uid) || "null");
    return value && value.uid === uid && value.expiresAt > Date.now() ? value : null;
  } catch {
    return null;
  }
}
async function proveTrustedDevice() {
  const value = await readTrustedDevice();
  if (!value) return;
  try {
    await securityRequest("trusted/prove", { id: value.id, deviceToken: value.deviceToken });
  } catch (error) {
    if (error instanceof AccountSecurityError && error.status < 500) await forgetTrustedDevice(value.id);
  }
}
async function loginWithPasskey() {
  if (!supportsPasskeys()) throw new AccountSecurityError("passkeys-unsupported", "Passkeys are unavailable in this browser.");
  const result = await securityRequest("passkeys/login/options", {}, { anonymous: true }), options = result.options;
  const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: buffer(options.challenge) } });
  if (!credential) throw new AccountSecurityError("passkey-cancelled", "Passkey sign-in cancelled.");
  const response = credential.response;
  const bundle = await securityRequest("passkeys/login/verify", { challengeId: result.challengeId, device: await securityDevice(), response: { id: credential.id, rawId: base64(credential.rawId), type: credential.type, response: { clientDataJSON: base64(response.clientDataJSON), authenticatorData: base64(response.authenticatorData), signature: base64(response.signature), userHandle: response.userHandle ? base64(response.userHandle) : null }, clientExtensionResults: credential.getClientExtensionResults() } }, { anonymous: true });
  await acceptBundle(bundle);
  await proveTrustedDevice();
}
async function ensureFreshSecurityAccess() {
  if (!securityBackendConfigured() || !session) return getSecurityAccessToken();
  if (!session.accessExpiresAt || session.accessExpiresAt < Date.now() + 6e4) await refreshSecuritySession();
  return getSecurityAccessToken();
}
export {
  AccountSecurityError,
  clearSecuritySession,
  completeSecurityLogin,
  configureAccountSecurity,
  createSecurityPasskey,
  endCurrentSecuritySession,
  ensureFreshSecurityAccess,
  ensureSecuritySession,
  forgetTrustedDevice,
  getSecurityAccessToken,
  getSecuritySessionId,
  loginWithPasskey,
  passkeyStepUp,
  proveTrustedDevice,
  reauthenticateForSecurityLogin,
  refreshSecuritySession,
  saveTrustedDevice,
  securityBackendConfigured,
  securityCurrentUid,
  securityDevice,
  securityReauthenticate,
  securityRequest,
  securityStepUp,
  supportsPasskeys
};
