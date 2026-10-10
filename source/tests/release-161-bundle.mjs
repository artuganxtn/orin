// lib/support.ts
function mergeSupportMessages(older, latest) {
  return [...new Map([...older, ...latest].map((message2) => [message2.id, message2])).values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
function supportAgentOnline(connection, capability, handoffRequested = false) {
  return connection === "connected" && capability?.available === true && capability.reason === "ready" && !handoffRequested;
}
function supportText(value) {
  const text = value.trim();
  if (!text || text.length > 2e3) throw new Error("Message must contain 1\u20132000 characters");
  return text;
}
function assistantResult(value) {
  if (!value || typeof value !== "object" || !["answered", "pending", "handoff", "unavailable"].includes(String(value.status))) throw new Error("Invalid support response");
  return value;
}
async function readSupportAssistantResponse(response, options = {}) {
  if (!response.ok) throw new Error("\u062E\u062F\u0645\u0629 \u0627\u0644\u0631\u062F \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u062D\u0627\u0644\u064A\u064B\u0627. / Support reply is currently unavailable.");
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return assistantResult(await response.json());
  if (!response.body) throw new Error("Empty support stream");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", bytes = 0, textLength = 0, completed = null;
  const aborted = () => {
    void reader.cancel().catch(() => {
    });
  };
  options.signal?.addEventListener("abort", aborted, { once: true });
  const frame = (value) => {
    let event = "message";
    const data = [];
    for (const line of value.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const raw = JSON.parse(data.join("\n"));
    if (!raw || typeof raw !== "object") throw new Error("Invalid support stream event");
    const payload = raw;
    if (event === "status" && ["reading", "generating", "saving"].includes(String(payload.phase))) options.onStatus?.(payload.phase);
    else if (event === "delta") {
      if (typeof payload.text !== "string" || (textLength += payload.text.length) > 2e3) throw new Error("Support reply exceeded limit");
      options.onChunk?.(payload.text);
    } else if (event === "complete") completed = assistantResult(payload);
    else if (event === "error") throw new Error(typeof payload.error === "string" && payload.error.length < 300 ? payload.error : "\u062A\u0639\u0630\u0631 \u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0631\u062F. / Reply interrupted.");
  };
  try {
    for (; ; ) {
      if (options.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
      const { done, value } = await reader.read();
      if (value) {
        bytes += value.length;
        if (bytes > 131072) throw new Error("Support stream exceeded limit");
        buffer += decoder.decode(value, { stream: true });
      }
      if (done) buffer += decoder.decode();
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        frame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (completed) return completed;
      if (done) {
        if (buffer.trim()) frame(buffer);
        break;
      }
    }
    if (options.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    if (!completed) throw new Error("\u0627\u0646\u0642\u0637\u0639 \u0627\u0644\u0631\u062F \u0642\u0628\u0644 \u0627\u0643\u062A\u0645\u0627\u0644\u0647. / Reply ended before completion.");
    return completed;
  } finally {
    options.signal?.removeEventListener("abort", aborted);
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}

// firebase-spark/support.ts
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAfter, Timestamp } from "firebase/firestore";

// lib/diagnostics.ts
var records = [];
function diagnostic(area, event, detail = {}) {
  const entry = { at: (/* @__PURE__ */ new Date()).toISOString(), area, event, detail };
  records.push(entry);
  if (records.length > 80) records.shift();
  console.warn("ORIN_DIAGNOSTIC " + JSON.stringify(entry));
}

// firebase-spark/support.ts
var message = (s) => {
  const d = s.data();
  return { id: s.id, text: d.text, kind: d.kind, senderId: d.senderId, createdAt: d.createdAt?.toMillis?.() ?? 0, pendingWrite: s.metadata?.hasPendingWrites === true, ...d.kind === "assistant" && d.assistant ? { assistant: { knowledgeVersion: d.assistant.knowledgeVersion, citationIds: d.assistant.citationIds, inReplyTo: d.assistant.inReplyTo } } : {} };
};
function supportTransport(db, actor = () => "", assistantRequest) {
  const thread = (uid) => doc(db, "orinSupportConversations", uid), messages = (uid) => collection(thread(uid), "messages");
  return {
    async assistantCapability() {
      if (!assistantRequest) return { available: false, reason: "security_backend_required", knowledgeVersion: "", requiredServices: ["Trusted ORIN API with enforced sessions and MFA", "Self-hosted inference service"] };
      const r = await assistantRequest("/api/support/assistant", { method: "GET", signal: AbortSignal.timeout(18e3) });
      if (!r.ok) throw new Error("Assistant unavailable");
      return await r.json();
    },
    async askAssistant(messageId, options = {}) {
      if (!assistantRequest) return { status: "unavailable" };
      const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 55e3);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      try {
        const r = await assistantRequest("/api/support/assistant", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ messageId }), signal: controller.signal });
        return await readSupportAssistantResponse(r, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
      }
    },
    watchThreads(receive, fail) {
      return onSnapshot(query(collection(db, "orinSupportConversations"), orderBy("updatedAt", "desc"), limit(50)), (rows) => receive(rows.docs.map((s) => ({ id: s.id, updatedAt: s.data().updatedAt?.toMillis?.() ?? 0, handoffRequested: s.data().handoffRequested === true }))), fail);
    },
    async reply(uid, id, body) {
      const text = supportText(body), senderId = actor();
      if (!senderId) throw new Error("Sign in required");
      await runTransaction(db, async (tx) => {
        const r = doc(messages(uid), id), [old, c] = await Promise.all([tx.get(r), tx.get(thread(uid))]);
        if (!c.exists()) throw new Error("Conversation not found");
        if (old.exists()) {
          if (old.data().text !== text || old.data().senderId !== senderId) throw new Error("Message ID conflict");
          return;
        }
        const now = serverTimestamp();
        tx.set(r, { id, text, kind: "staff", senderId, createdAt: now });
        tx.update(thread(uid), { updatedAt: now, lastMessageId: id });
      });
    },
    watch(uid, receive, connection) {
      let rows = [], handoffRequested = false, failed = false;
      const emit = () => receive({ messages: rows, handoffRequested, hasOlder: rows.length === 50 });
      const fail = (e) => {
        failed = true;
        diagnostic("support", "subscription_failed", { code: e.code });
        connection(navigator.onLine ? "unavailable" : "offline");
      };
      const offThread = onSnapshot(thread(uid), (s) => {
        handoffRequested = s.data()?.handoffRequested === true;
        emit();
      }, fail);
      const offMessages = onSnapshot(query(messages(uid), orderBy("createdAt", "desc"), limit(50)), { includeMetadataChanges: true }, (s) => {
        rows = s.docs.map(message).reverse();
        connection(!navigator.onLine ? "offline" : s.metadata.fromCache ? "connecting" : "connected");
        emit();
      }, fail);
      return () => {
        offThread();
        offMessages();
      };
    },
    async send(uid, id, body) {
      const text = supportText(body);
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid message ID");
      await runTransaction(db, async (tx) => {
        const r = doc(messages(uid), id), [old, c] = await Promise.all([tx.get(r), tx.get(thread(uid))]);
        if (old.exists()) {
          if (old.data().text !== text || old.data().senderId !== uid) throw new Error("Message ID conflict");
          return;
        }
        const now = serverTimestamp();
        tx.set(r, { id, text, kind: "customer", senderId: uid, createdAt: now });
        if (c.exists()) tx.update(thread(uid), { updatedAt: now, lastCustomerAt: now, lastMessageId: id });
        else tx.set(thread(uid), { ownerId: uid, createdAt: now, updatedAt: now, lastCustomerAt: now, lastMessageId: id, handoffRequested: false });
      });
    },
    async handoff(uid, messageId) {
      if (!assistantRequest || !uid) throw new Error("\u0631\u0628\u0637 \u062E\u062F\u0645\u0629 \u0627\u0644\u0645\u062A\u0627\u0628\u0639\u0629 \u0644\u0645 \u064A\u0643\u062A\u0645\u0644 \u0628\u0639\u062F. / Support ticket service has not been connected.");
      const response = await assistantRequest("/api/support/escalate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(messageId ? { messageId } : {}), signal: AbortSignal.timeout(15e3) });
      if (!response.ok) throw new Error("\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u0637\u0644\u0628 \u0627\u0644\u0645\u062A\u0627\u0628\u0639\u0629. / Could not create a support ticket.");
      const result = await response.json();
      if (!result.ticket || typeof result.ticket.id !== "string" || typeof result.ticket.createdAt !== "number" || !Number.isFinite(result.ticket.createdAt) || result.ticket.createdAt <= 0 || !["open", "in_progress", "waiting", "resolved", "closed"].includes(result.ticket.status)) throw new Error("\u0644\u0645 \u0646\u062A\u0644\u0642 \u0631\u0642\u0645 \u0637\u0644\u0628 \u0645\u062A\u0627\u0628\u0639\u0629 \u0635\u0627\u0644\u062D\u064B\u0627. / No valid support ticket was returned.");
      return { ticket: result.ticket };
    },
    async older(uid, before) {
      const rows = await getDocs(query(messages(uid), orderBy("createdAt", "desc"), startAfter(Timestamp.fromMillis(before)), limit(50)));
      return rows.docs.map(message).reverse();
    }
  };
}

// app/balance-accounts.tsx
import { useCallback as useCallback2, useEffect as useEffect2, useRef as useRef2, useState as useState2 } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown, Eye, EyeOff, Coins, Plus, X, Settings2 } from "lucide-react";

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
var storeNativeSession = (value) => request("storeSession", { value });
var clearNativeSession = (uid) => request("clearSession", { uid });

// lib/account-security-client.ts
var runtime = null;
var session = null;
var refreshing = null;
var sessionReadyAt = 0;
var SESSION_KEY = "orin-security-session-v1";
var AccountSecurityError = class extends Error {
  constructor(code, message2, status = 503) {
    super(message2);
    this.code = code;
    this.status = status;
    this.name = "AccountSecurityError";
  }
};
var securityBackendConfigured = () => !!runtime?.base;
var getSecurityAccessToken = () => session && session.uid === runtime?.uid() ? session.accessToken : null;
async function persist(value) {
  session = value;
  if (isNativeSecurityAvailable()) await storeNativeSession(value);
  else try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
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
async function ensureFreshSecurityAccess() {
  if (!securityBackendConfigured() || !session) return getSecurityAccessToken();
  if (!session.accessExpiresAt || session.accessExpiresAt < Date.now() + 6e4) await refreshSecuritySession();
  return getSecurityAccessToken();
}

// lib/client-api.ts
var runtime2 = null;
async function apiFetch(path, init = {}) {
  if (!path.startsWith("/api/") || path.includes("://") || path.includes("\\")) throw new Error("Invalid API destination");
  const headers = new Headers(init.headers), session2 = await ensureFreshSecurityAccess();
  if (session2) headers.set("X-Orin-Session", session2);
  init = { ...init, headers };
  if (runtime2?.request) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Response.json({ error: "\u0623\u0646\u062A \u063A\u064A\u0631 \u0645\u062A\u0635\u0644. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0625\u0646\u062A\u0631\u0646\u062A \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629. / You are offline. Reconnect and retry." }, { status: 503 });
    const result2 = runtime2.request(path, init).then((response) => {
      if (response.status === 401 && !path.startsWith("/api/control/")) runtime2?.onUnauthorized();
      return response;
    });
    if (!init.method || init.method === "GET") {
      let timer;
      try {
        return await Promise.race([result2, new Promise((resolve) => {
          timer = setTimeout(() => resolve(Response.json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u062E\u062F\u0645\u0629. \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629. / Unable to connect. Please retry." }, { status: 503 })), 18e3);
        })]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return result2;
  }
  if (runtime2) {
    if (!path.startsWith("/api/") || path.includes("://")) throw new Error("Invalid API destination");
    const token = await runtime2.token();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const result = await fetch(path, { ...init, headers });
  if (result.status === 401 && runtime2 && !path.startsWith("/api/control/")) runtime2.onUnauthorized();
  return result;
}

// lib/trading-accounts.ts
var activeTradingAccount = (directory) => directory?.accounts.find((account) => account.id === directory.activeId) ?? null;
var maskedAccountNumber = (number) => `\u2022\u2022\u2022\u2022 ${number.slice(-4)}`;

// lib/display-text.ts
function displayText(value) {
  return value.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 1632)).replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 1776)).replace(/محاكاة|محاكي/g, "\u062A\u062C\u0631\u064A\u0628\u064A");
}

// app/orin-settings.tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// lib/translations.ts
var EN = {
  "ORIN \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629": "ORIN home",
  "\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A": "Notifications",
  "\u062C\u0627\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A": "Loading account",
  "\u062A\u062D\u062F\u064A\u062B": "Refresh",
  "\u0622\u062E\u0631 \u0645\u0632\u0627\u0645\u0646\u0629 \u0644\u0645 \u062A\u0646\u062C\u062D. \u0642\u062F \u062A\u062A\u0623\u062E\u0631 \u062D\u0627\u0644\u0629 \u0627\u0644\u062A\u0633\u0648\u064A\u0629:": "Last sync failed. Settlement status may be delayed:",
  "\u0623\u0642\u0633\u0627\u0645 ORIN": "ORIN sections",
  "\u0641\u062A\u062D \u0627\u0644\u062A\u062F\u0627\u0648\u0644 \u0648\u0627\u0644\u062F\u0639\u0648\u0627\u062A": "Open trading and invitations",
  "\u0639\u0642\u062F": "contracts",
  "\u062F\u0642\u064A\u0642\u0629 \xB7": "min \xB7",
  "\u0646\u0633\u062E \u0643\u0648\u062F \u0627\u0644\u062F\u0639\u0648\u0629": "Copy invitation code",
  "\u062F\u0639\u0648\u0627\u062A\u0643 \u062A\u0638\u0647\u0631 \u0647\u0646\u0627": "Your invitations appear here",
  "\u0623\u062F\u062E\u0644 \u0643\u0648\u062F \u0627\u0644\u062F\u0639\u0648\u0629 \u0623\u0648 \u0627\u0646\u062A\u0638\u0631 \u0646\u0634\u0631 \u0639\u0642\u062F \u0645\u062A\u0627\u062D \u0644\u0641\u0626\u0629 \u062D\u0633\u0627\u0628\u0643.": "Enter an invitation code or wait for a contract available to your account tier.",
  "\u062D\u0633\u0627\u0628 \u062A\u062C\u0631\u064A\u0628\u064A \xB7 USD": "Demo account \xB7 USD",
  "\u0631\u0635\u064A\u062F \u0627\u0641\u062A\u0631\u0627\u0636\u064A \u063A\u064A\u0631 \u0642\u0627\u0628\u0644 \u0644\u0644\u0633\u062D\u0628 \u0623\u0648 \u0627\u0644\u062A\u062D\u0648\u064A\u0644": "Virtual balance; cannot be withdrawn or transferred",
  "\u0645\u062D\u062C\u0648\u0632": "Reserved",
  "\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0627\u0641\u062A\u062A\u0627\u062D\u064A": "Opening balance",
  "\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0645\u062D\u0641\u0638\u0629": "Wallet details",
  "\u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0648\u0627\u0644\u0633\u062D\u0628 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u064A\u0646": "Deposits and withdrawals unavailable",
  "\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u064A\u0633\u062A\u062E\u062F\u0645 \u0631\u0635\u064A\u062F \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A. \u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u0646\u0627\u0648\u064A\u0646 \u0625\u064A\u062F\u0627\u0639 \u0623\u0648 \u0648\u0633\u0627\u0626\u0644 \u062F\u0641\u0639 \u0645\u062A\u0635\u0644\u0629.": "This account uses virtual funds. No deposit addresses or payment services are connected.",
  "\u0642\u064A\u0648\u062F \u0645\u062A\u0648\u0627\u0632\u0646\u0629 \u0644\u0643\u0644 \u062D\u0631\u0643\u0629": "Balanced entries for every transaction",
  "\u0644\u0643\u0644 \u062D\u0631\u0643\u0629 \u0642\u064A\u062F \u0645\u062D\u0627\u0633\u0628\u064A\u060C \u0648\u0644\u0643\u0644 \u062A\u0633\u0648\u064A\u0629 \u0625\u064A\u0635\u0627\u0644 \u0642\u0627\u0628\u0644 \u0644\u0644\u062A\u0646\u0632\u064A\u0644.": "Every transaction is recorded and every settlement has a downloadable receipt.",
  "\u0627\u0644\u0639\u0642\u0648\u062F \u0648\u0627\u0644\u0645\u0631\u0627\u0643\u0632": "Contracts & positions",
  "\u0645\u0634\u0627\u0631\u0643\u0629": "positions",
  "\u0627\u0644\u0639\u0642\u062F": "Contract",
  "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A": "Virtual amount",
  "\u0627\u0644\u0628\u062F\u0627\u064A\u0629": "Start",
  "\u0627\u0644\u062D\u0627\u0644\u0629": "Status",
  "\u0627\u0644\u0646\u062A\u064A\u062C\u0629": "Result",
  "\u0627\u0644\u0625\u064A\u0635\u0627\u0644": "Receipt",
  "\u062F\u0642\u064A\u0642\u0629": "min",
  "\u062A\u0645\u062A \u0627\u0644\u062A\u0633\u0648\u064A\u0629": "Settled",
  "\u0639\u0631\u0636": "View",
  "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0634\u0627\u0631\u0643\u0627\u062A \u0628\u0639\u062F": "No positions yet",
  "\u0628\u0639\u062F \u062A\u0623\u0643\u064A\u062F \u0623\u0648\u0644 \u0645\u0634\u0627\u0631\u0643\u0629\u060C \u0633\u062A\u062C\u062F \u062A\u0641\u0627\u0635\u064A\u0644\u0647\u0627 \u0648\u0646\u062A\u064A\u062C\u062A\u0647\u0627 \u0647\u0646\u0627.": "After your first confirmation, the position details and result will appear here.",
  "\u0633\u062C\u0644 \u0627\u0644\u062D\u0631\u0643\u0627\u062A": "Transaction history",
  "\u0627\u0644\u0642\u064A\u0645\u0629 \u0627\u0644\u0645\u0648\u062C\u0628\u0629 \u0645\u062F\u064A\u0646\u060C \u0648\u0627\u0644\u0633\u0627\u0644\u0628\u0629 \u062F\u0627\u0626\u0646. \u0645\u062C\u0645\u0648\u0639 \u0642\u064A\u0648\u062F \u0643\u0644 \u062D\u0631\u0643\u0629 \u064A\u0633\u0627\u0648\u064A \u0635\u0641\u0631\u064B\u0627.": "Positive entries are debits; negative entries are credits. Every journal balances to zero.",
  "\u0627\u0644\u0639\u0645\u0644\u064A\u0629": "Transaction",
  "\u0627\u0644\u062D\u0633\u0627\u0628": "Account",
  "\u0645\u062F\u064A\u0646": "Debit",
  "\u062F\u0627\u0626\u0646": "Credit",
  "\u0648\u0642\u062A \u0627\u0644\u0627\u0633\u062A\u062D\u0642\u0627\u0642": "Maturity time",
  "\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D": "Available balance",
  "\u0627\u0644\u0645\u0628\u0627\u0644\u063A \u0627\u0644\u0645\u062D\u062C\u0648\u0632\u0629": "Reserved amounts",
  "\u0645\u0642\u0627\u0628\u0644 \u0631\u0623\u0633 \u0627\u0644\u0645\u0627\u0644 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A": "Virtual capital offset",
  "\u0645\u0642\u0627\u0628\u0644 \u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A": "Virtual P/L offset",
  "\u0631\u0635\u064A\u062F \u0627\u0641\u062A\u062A\u0627\u062D\u064A \u0627\u0641\u062A\u0631\u0627\u0636\u064A": "Opening virtual balance",
  "\u062D\u062C\u0632 \u0644\u0644\u0645\u0634\u0627\u0631\u0643\u0629": "Contract allocation",
  "\u062A\u0633\u0648\u064A\u0629 \u0639\u0642\u062F \u062F\u0627\u062E\u0644\u064A": "Internal settlement",
  "\u062D\u0633\u0627\u0628\u064A": "My account",
  "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0639\u0642\u0648\u062F": "Contract administration",
  "\u062A\u064F\u0642\u0641\u0644 \u0627\u0644\u0634\u0631\u0648\u0637 \u0639\u0646\u062F \u0627\u0644\u0646\u0634\u0631. \u062A\u0638\u0647\u0631 \u0646\u0633\u0628\u0629 \u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0644\u0644\u0639\u0645\u064A\u0644 \u0642\u0628\u0644 \u0627\u0644\u062A\u0623\u0643\u064A\u062F.": "Terms are locked on publication. The settlement rate is shown before confirmation.",
  "\u0625\u0646\u0634\u0627\u0621 \u0639\u0642\u062F \u062F\u0627\u062E\u0644\u064A": "Create internal contract",
  "\u0623\u0631\u0635\u062F\u0629 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629": "Virtual balances",
  "\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0639\u0642\u062F": "Contract title",
  "\u0627\u0644\u0623\u0635\u0644 / \u0627\u0644\u062A\u0635\u0646\u064A\u0641 \u0627\u0644\u0645\u0631\u062C\u0639\u064A": "Asset / market reference",
  "\u0627\u0644\u0623\u0635\u0644 \u0627\u0644\u0645\u0631\u062C\u0639\u064A": "Reference asset",
  "\u0627\u0644\u0627\u062A\u062C\u0627\u0647": "Direction",
  "BUY \xB7 \u0634\u0631\u0627\u0621": "BUY",
  "SELL \xB7 \u0628\u064A\u0639": "SELL",
  "\u0627\u0644\u0645\u062F\u0629 \u0628\u0639\u062F \u0645\u0634\u0627\u0631\u0643\u0629 \u0627\u0644\u0639\u0645\u064A\u0644": "Duration after participation",
  "\u062F\u0642\u064A\u0642\u0629 \u0648\u0627\u062D\u062F\u0629": "1 minute",
  "\u062F\u0642\u064A\u0642\u062A\u0627\u0646": "2 minutes",
  "3 \u062F\u0642\u0627\u0626\u0642": "3 minutes",
  "4 \u062F\u0642\u0627\u0626\u0642": "4 minutes",
  "5 \u062F\u0642\u0627\u0626\u0642": "5 minutes",
  "\u0645\u062F\u0629 \u0627\u0644\u0639\u0642\u062F": "Contract duration",
  "\u0646\u0633\u0628\u0629 \u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0627\u0644\u062F\u0627\u062E\u0644\u064A\u0629 %": "Internal settlement %",
  "\u0645\u0648\u062C\u0628\u0629 \u0644\u0644\u0631\u0628\u062D \u0623\u0648 \u0633\u0627\u0644\u0628\u0629 \u0644\u0644\u062E\u0633\u0627\u0631\u0629 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629.": "Positive for a virtual gain or negative for a virtual loss.",
  "\u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u0627\u0644\u0645\u0624\u0647\u0644\u0629": "Eligible accounts",
  "\u0641\u0626\u0629 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u0627\u0644\u0645\u0624\u0647\u0644\u0629": "Eligible account tier",
  "\u062C\u0645\u064A\u0639 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A": "All accounts",
  "\u0642\u064A\u0627\u0633\u064A": "Standard",
  "\u0645\u062A\u0642\u062F\u0645": "Advanced",
  "\u0641\u062A\u062D \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629": "Participation opens",
  "\u0641\u0627\u0631\u063A = \u0639\u0646\u062F \u0627\u0644\u0646\u0634\u0631 \xB7 \u062A\u0648\u0642\u064A\u062A \u062C\u0647\u0627\u0632\u0643": "Empty = publication time \xB7 device time",
  "\u0622\u062E\u0631 \u0645\u0648\u0639\u062F \u0644\u0644\u0645\u0634\u0627\u0631\u0643\u0629": "Participation closes",
  "\u0641\u0627\u0631\u063A = \u0628\u0639\u062F 24 \u0633\u0627\u0639\u0629 \u0645\u0646 \u0641\u062A\u062D\u0647\u0627": "Empty = 24 hours after opening",
  "\u0645\u062B\u0627\u0644 \u0639\u0644\u0649 \u0645\u0628\u0644\u063A \u0627\u0641\u062A\u0631\u0627\u0636\u064A \u0642\u062F\u0631\u0647 1,000 \u062F\u0648\u0644\u0627\u0631": "Example on a $1,000 virtual allocation",
  "\u0647\u0630\u0647 \u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u0639\u0642\u062F \u0627\u0644\u0645\u0642\u0641\u0644\u0629\u060C \u0648\u0644\u064A\u0633\u062A \u0639\u0627\u0626\u062F \u062A\u0646\u0641\u064A\u0630 \u0633\u0648\u0642\u064A.": "This is the locked internal result, independent of any market execution.",
  "\u062C\u0627\u0631 \u0627\u0644\u062D\u0641\u0638\u2026": "Saving\u2026",
  "\u0646\u0634\u0631 \u0627\u0644\u0639\u0642\u062F \u0648\u0642\u0641\u0644 \u0627\u0644\u0634\u0631\u0648\u0637": "Publish & lock terms",
  "\u0645\u0646 \u0627\u0644\u0646\u0634\u0631 \u0625\u0644\u0649 \u0627\u0644\u0625\u064A\u0635\u0627\u0644": "From publication to receipt",
  "\u0634\u0631\u0648\u0637 \u0645\u0642\u0641\u0644\u0629": "Locked terms",
  "\u0627\u0644\u0632\u0648\u062C \u0648\u0627\u0644\u0627\u062A\u062C\u0627\u0647 \u0648\u0627\u0644\u0645\u062F\u0629 \u0648\u0627\u0644\u0646\u0633\u0628\u0629 \u0648\u0627\u0644\u0623\u0647\u0644\u064A\u0629 \u062A\u064F\u062D\u0641\u0638 \u0642\u0628\u0644 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629.": "Pair, direction, duration, rate and eligibility are saved before participation.",
  "\u0628\u0635\u0645\u0629 SHA-256": "SHA-256 hash",
  "\u0645\u0631\u062C\u0639 \u0644\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u062A\u0637\u0627\u0628\u0642 \u0627\u0644\u0634\u0631\u0648\u0637 \u0648\u0627\u0644\u0625\u064A\u0635\u0627\u0644.": "Verifies the integrity of contract terms and receipts.",
  "\u0625\u0634\u0639\u0627\u0631\u0627\u062A \u062F\u0627\u062E\u0644 \u0627\u0644\u0645\u0646\u0635\u0629": "In-app notifications",
  "\u062A\u0638\u0647\u0631 \u0627\u0644\u062F\u0639\u0648\u0629 \u0644\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u0627\u0644\u0645\u0624\u0647\u0644\u0629\u060C \u0648\u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0644\u0635\u0627\u062D\u0628 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629.": "Eligible accounts receive invitations; participants receive their result.",
  "\u062A\u0633\u0648\u064A\u0629 \u0645\u062A\u0648\u0627\u0632\u0646\u0629": "Balanced settlement",
  "\u062D\u062C\u0632 \u0627\u0644\u0631\u0635\u064A\u062F \u062B\u0645 \u0625\u0639\u0627\u062F\u0629 \u0623\u0635\u0644 \u0627\u0644\u0645\u0628\u0644\u063A \u0648\u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629.": "Allocate the virtual balance, then return the principal and result.",
  "\u0627\u0644\u0639\u0642\u062F \u0645\u0646\u0634\u0648\u0631": "Contract published",
  "\u0646\u0633\u062E \u0627\u0644\u0643\u0648\u062F": "Copy code",
  "\u062A\u062C\u0631\u0628\u0629 \u0643\u0639\u0645\u064A\u0644": "View as client",
  "\u0641\u0626\u0629 \u0627\u0644\u062D\u0633\u0627\u0628": "Account tier",
  "\u062A\u062D\u062F\u062F \u0627\u0644\u062F\u0639\u0648\u0627\u062A \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u0644\u062D\u0633\u0627\u0628\u0643. \u0627\u0644\u062A\u063A\u064A\u064A\u0631 \u0645\u062A\u0627\u062D \u0644\u0644\u0645\u062F\u064A\u0631 \u0641\u0642\u0637.": "Determines invitation eligibility. Only the administrator can change the tier.",
  "\u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0629": "Published contracts",
  "\u0627\u0644\u0646\u0634\u0631 \u0646\u0647\u0627\u0626\u064A\u061B \u0644\u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u0634\u0631\u0648\u0637 \u0623\u0646\u0634\u0626 \u0639\u0642\u062F\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627.": "Published terms are final. Create a new contract to change the terms.",
  "\u0633\u062C\u0644 \u0627\u0644\u062A\u062F\u0642\u064A\u0642": "Audit log",
  "\u0627\u0644\u0643\u0648\u062F": "Code",
  "\u0627\u0644\u062A\u0633\u0648\u064A\u0629": "Settlement",
  "\u0627\u0644\u0623\u0647\u0644\u064A\u0629": "Eligibility",
  "\u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0627\u062A": "Participants",
  "\u0627\u0644\u0625\u063A\u0644\u0627\u0642": "Closing",
  "\u0644\u0645 \u064A\u064F\u0646\u0634\u0631 \u0623\u064A \u0639\u0642\u062F \u0628\u0639\u062F": "No contracts published yet",
  "\u0623\u0646\u0634\u0626 \u0639\u0642\u062F\u0643 \u0627\u0644\u0623\u0648\u0644 \u0645\u0646 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0623\u0639\u0644\u0627\u0647.": "Create your first contract using the form above.",
  "\u0623\u0648\u0631\u064A\u0646": "ORIN",
  "\u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0644\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628. \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u060C \u0648\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u0648\u0627\u0628\u0629 \u0623\u0645\u0648\u0627\u0644 \u0623\u0648 \u0639\u0646\u0627\u0648\u064A\u0646 \u0625\u064A\u062F\u0627\u0639 \u0645\u062A\u0635\u0644\u0629.": "is unavailable for this account. Balances are virtual; no payment gateway or deposit addresses are connected.",
  "\u062A\u0641\u0627\u0635\u064A\u0644 \u0646\u0648\u0639 \u0627\u0644\u062D\u0633\u0627\u0628": "Account type details",
  "\u062F\u0639\u0648\u0627\u062A \u0645\u0624\u0647\u0644\u0629 \u0648\u0646\u062A\u0627\u0626\u062C \u0645\u0634\u0627\u0631\u0643\u0627\u062A\u0643 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629.": "Eligible invitations and your virtual settlement results.",
  "\u0641\u062A\u062D \u0627\u0644\u0639\u0642\u062F": "Open contract",
  "\u0644\u0627 \u062A\u0648\u062C\u062F \u0625\u0634\u0639\u0627\u0631\u0627\u062A": "No notifications",
  "\u0633\u062A\u0638\u0647\u0631 \u0627\u0644\u062F\u0639\u0648\u0627\u062A \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u0648\u0646\u062A\u0627\u0626\u062C \u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0647\u0646\u0627.": "New invitations and settlement results will appear here.",
  "\u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u0647\u0627\u062A\u0641 \u062E\u0627\u0631\u062C \u0627\u0644\u0645\u0646\u0635\u0629 \u063A\u064A\u0631 \u0645\u0631\u0628\u0648\u0637\u0629 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0646\u0633\u062E\u0629.": "Background phone notifications are not connected.",
  "\u0627\u0642\u0631\u0623 \u0637\u0628\u064A\u0639\u0629 \u0627\u0644\u0645\u0646\u062A\u062C \u0642\u0628\u0644 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629.": "Review how this product works before participating.",
  "\u062C\u0645\u064A\u0639 \u0627\u0644\u0623\u0631\u0635\u062F\u0629 \u0648\u0627\u0644\u0645\u0628\u0627\u0644\u063A \u0648\u0627\u0644\u0646\u062A\u0627\u0626\u062C \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629\u060C \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u0633\u062D\u0628\u0647\u0627 \u0623\u0648 \u0627\u0633\u062A\u0628\u062F\u0627\u0644\u0647\u0627 \u0628\u0623\u0645\u0648\u0627\u0644.": "All balances, amounts and results are virtual. They cannot be withdrawn or exchanged for money.",
  "\u0627\u0644\u0639\u0642\u062F \u062F\u0627\u062E\u0644\u064A: \u064A\u062D\u062F\u062F \u0627\u0644\u0645\u062F\u064A\u0631 \u0646\u0633\u0628\u0629 \u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0648\u064A\u0642\u0641\u0644\u0647\u0627 \u0642\u0628\u0644 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629. \u062A\u0638\u0647\u0631 \u0644\u0643 \u0627\u0644\u0646\u0633\u0628\u0629 \u0642\u0628\u0644 \u0627\u0644\u062A\u0623\u0643\u064A\u062F.": "Contracts are internal. The administrator sets and locks the settlement rate before participation; you see the rate before confirming.",
  "\u0644\u0627 \u062A\u064F\u0646\u0641\u0651\u0630 \u0623\u0648\u0627\u0645\u0631 \u0641\u064A MT5 \u0623\u0648 \u0628\u0648\u0631\u0635\u0629. \u0627\u0644\u0634\u0627\u0631\u062A \u0645\u0631\u062C\u0639 \u0633\u0648\u0642 \u0645\u0646 TradingView \u0648\u0644\u0627 \u064A\u0645\u062B\u0644 \u062A\u0646\u0641\u064A\u0630\u064B\u0627 \u0644\u0639\u0645\u0644\u064A\u0627\u062A \u062D\u0633\u0627\u0628\u0643.": "No orders execute on MT5 or an exchange. TradingView is a market reference and does not represent execution of your account activity.",
  "\u0642\u062F \u062A\u062A\u0623\u062E\u0631 \u0628\u0639\u0636 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0633\u0648\u0642 \u0628\u062D\u0633\u0628 \u0627\u0644\u0645\u0635\u062F\u0631. \u0623\u0633\u0639\u0627\u0631 \u0627\u0644\u0633\u0648\u0642 \u0644\u0627 \u062A\u063A\u064A\u0651\u0631 \u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0627\u0644\u062F\u0627\u062E\u0644\u064A\u0629.": "Market data may be delayed depending on the source. Market prices do not change internal settlement.",
  "\u0646\u062D\u0641\u0638 \u0645\u0639\u0631\u0651\u0641 \u062D\u0633\u0627\u0628 ChatGPT \u0627\u0644\u062E\u0627\u0635 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0648\u0642\u0639\u060C \u0648\u0627\u0633\u0645 \u0627\u0644\u0639\u0631\u0636\u060C \u0648\u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0627\u062A \u0648\u0627\u0644\u0642\u064A\u0648\u062F \u0648\u0633\u062C\u0644\u0627\u062A \u0627\u0644\u062A\u062F\u0642\u064A\u0642 \u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062A\u062C\u0631\u0628\u0629. \u0644\u0627 \u0646\u0637\u0644\u0628 \u0645\u0641\u0627\u062A\u064A\u062D \u0645\u062D\u0627\u0641\u0638 \u0623\u0648 \u0628\u064A\u0627\u0646\u0627\u062A \u062F\u0641\u0639. \u0623\u062F\u0648\u0627\u062A TradingView \u0627\u0644\u062E\u0627\u0631\u062C\u064A\u0629 \u062A\u0633\u062A\u0642\u0628\u0644 \u0637\u0644\u0628\u0627\u062A \u0639\u0631\u0636 \u0627\u0644\u0634\u0627\u0631\u062A \u062F\u0648\u0646 \u0623\u0631\u0635\u062F\u0629 \u062D\u0633\u0627\u0628\u0643 \u0623\u0648 \u0634\u0631\u0648\u0637 \u0639\u0642\u0648\u062F\u0643\u061B \u0648\u062A\u064F\u062D\u0641\u0638 \u062A\u0641\u0636\u064A\u0644\u0627\u062A \u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u0627\u0644\u0634\u0627\u0631\u062A \u0641\u064A \u062D\u0633\u0627\u0628\u0643 \u0644\u0644\u0645\u0632\u0627\u0645\u0646\u0629\u060C \u0645\u0639 \u0646\u0633\u062E\u0629 \u0645\u0646 \u062A\u0641\u0636\u064A\u0644\u0627\u062A \u0627\u0644\u0639\u0631\u0636 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643. \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0627\u0644\u062A\u064A \u062A\u062F\u062E\u0644\u0647\u0627 \u063A\u064A\u0631 \u0645\u0648\u062B\u0651\u0642\u0629 \u0645\u0627 \u0644\u0645 \u0646\u064F\u0634\u0631 \u0625\u0644\u0649 \u062E\u0644\u0627\u0641 \u0630\u0644\u0643.": "We store your site-specific ChatGPT identity, display name, positions, ledger and audit records to operate this experience. We do not request wallet keys or payment details. TradingView receives chart requests without your balances or contract terms. Account and chart preferences are saved to your account for synchronization, with a display preference cache on your device. Contact details you enter are unverified unless stated otherwise.",
  "\u062A\u062A\u0645 \u0627\u0644\u0645\u0639\u0627\u0644\u062C\u0629 \u0639\u0646\u062F \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0645\u0624\u0642\u062A \u0623\u062B\u0646\u0627\u0621 \u0641\u062A\u062D \u0627\u0644\u0645\u0646\u0635\u0629\u060C \u0623\u0648 \u0639\u0646\u062F \u0623\u0648\u0644 \u0645\u0632\u0627\u0645\u0646\u0629 \u0644\u0627\u062D\u0642\u0629 \u0625\u0646 \u0643\u0627\u0646\u062A \u0645\u063A\u0644\u0642\u0629\u060C \u0645\u0639 \u0627\u0644\u0627\u062D\u062A\u0641\u0627\u0638 \u0628\u0648\u0642\u062A \u0627\u0644\u0627\u0633\u062A\u062D\u0642\u0627\u0642 \u0648\u0648\u0642\u062A \u0627\u0644\u0645\u0639\u0627\u0644\u062C\u0629 \u0643\u0644\u0651\u064D \u0639\u0644\u0649 \u062D\u062F\u0629.": "Settlement is processed at timer expiry while the app is open, or on the next sync if closed. Maturity and actual processing times are recorded separately.",
  "\u0623\u0641\u0647\u0645 \u0623\u0646 \u0647\u0630\u0627 \u062D\u0633\u0627\u0628 \u062A\u062C\u0631\u064A\u0628\u064A \u0628\u0631\u0635\u064A\u062F \u063A\u064A\u0631 \u0642\u0627\u0628\u0644 \u0644\u0644\u0633\u062D\u0628 \u0648\u062A\u0633\u0648\u064A\u0629 \u062F\u0627\u062E\u0644\u064A\u0629 \u0645\u062D\u062F\u062F\u0629 \u0645\u0633\u0628\u0642\u064B\u0627.": "I understand that this demo account has a nonwithdrawable balance and predetermined internal settlement.",
  "\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0648\u0627\u0644\u0645\u062A\u0627\u0628\u0639\u0629": "Agree & continue",
  "\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0639\u0642\u062F \u0627\u0644\u062F\u0627\u062E\u0644\u064A": "Confirm internal contract",
  "\xB7 \u0631\u0635\u064A\u062F \u0627\u0641\u062A\u0631\u0627\u0636\u064A \u0641\u0642\u0637": "\xB7 Virtual balance only",
  "\u0627\u0644\u0623\u0635\u0644 \u0627\u0644\u0645\u0631\u062C\u0639\u064A \u0648\u0627\u0644\u0627\u062A\u062C\u0627\u0647": "Reference asset & direction",
  "\u0645\u062F\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629": "Position duration",
  "\u0646\u0633\u0628\u0629 \u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0627\u0644\u0645\u0642\u0641\u0644\u0629": "Locked settlement rate",
  "\u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u0646\u0647\u0627\u0626\u064A\u0629 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629": "Final virtual result",
  "\u0627\u0644\u0634\u0631\u0648\u0637 \u0645\u0642\u0641\u0644\u0629 \u0645\u0646\u0630": "Terms locked at",
  "\u0631\u0627\u062C\u0639\u062A \u0627\u0644\u0646\u0633\u0628\u0629 \u0648\u0627\u0644\u0634\u0631\u0648\u0637. \u0623\u0641\u0647\u0645 \u0623\u0646 \u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u062F\u0627\u062E\u0644\u064A\u0629 \u0648\u0645\u062D\u062F\u062F\u0629 \u0645\u0633\u0628\u0642\u064B\u0627 \u0648\u0644\u0627 \u062A\u0646\u062A\u062C \u0639\u0646 \u062A\u0646\u0641\u064A\u0630 \u0641\u064A \u0627\u0644\u0633\u0648\u0642.": "I have reviewed the rate and terms. I understand that settlement is internal and predetermined, and does not result from market execution.",
  "\u062A\u0623\u0643\u064A\u062F \u0648\u0628\u062F\u0621 \u0627\u0644\u0645\u0624\u0642\u062A": "Confirm & start timer",
  "\u0625\u064A\u0635\u0627\u0644 \u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629": "Virtual settlement receipt",
  "\u0648\u062B\u064A\u0642\u0629 \u0627\u062E\u062A\u0628\u0627\u0631 \u2014 \u0644\u0627 \u062A\u0645\u062B\u0644 \u062A\u062D\u0648\u064A\u0644 \u0623\u0645\u0648\u0627\u0644 \u062D\u0642\u064A\u0642\u064A\u0629.": "Test receipt \u2014 does not represent a real money transfer.",
  "\u0623\u062D\u062F\u0627\u062B \u0627\u0644\u062E\u0627\u062F\u0645 \u0648\u0628\u0635\u0645\u0627\u062A\u0647\u0627. \u0644\u0627 \u062A\u062A\u0648\u0641\u0631 \u0639\u0645\u0644\u064A\u0627\u062A \u062A\u0639\u062F\u064A\u0644 \u0623\u0648 \u062D\u0630\u0641 \u0645\u0646 \u0627\u0644\u0645\u0646\u0635\u0629.": "Server events and their hashes. These records cannot be edited or deleted through the platform.",
  "\u0627\u0644\u0641\u0627\u0639\u0644:": "Actor:",
  "\u062D\u0633\u0627\u0628\u0643": "Your account",
  "\xB7 \u062A\u0633\u0648\u064A\u0629 \u062F\u0627\u062E\u0644\u064A\u0629": "\xB7 Internal settlement",
  "\u0643\u0648\u062F \u0627\u0644\u0639\u0642\u062F": "Contract code",
  "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u062E\u0635\u0635": "Allocated amount",
  "\u0627\u0644\u0646\u0633\u0628\u0629 \u0627\u0644\u0645\u0642\u0641\u0644\u0629": "Locked rate",
  "\u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629": "Virtual result",
  "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u0639\u0627\u062F \u0644\u0644\u0645\u062D\u0641\u0638\u0629": "Returned to wallet",
  "\u0627\u0644\u0645\u062F\u0629": "Duration",
  "\u0628\u062F\u0627\u064A\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629": "Position started",
  "\u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0645\u062F\u0629 / \u0627\u0644\u0627\u0633\u062A\u062D\u0642\u0627\u0642": "Maturity / expiry",
  "\u0648\u0642\u062A \u0627\u0644\u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0641\u0639\u0644\u064A\u0629": "Actual processing time",
  "\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0639\u0642\u062F": "Contract ID",
  "\u0628\u0635\u0645\u0629 \u0634\u0631\u0648\u0637 \u0627\u0644\u0639\u0642\u062F": "Contract terms hash",
  "\u0628\u0635\u0645\u0629 \u0627\u0644\u0625\u064A\u0635\u0627\u0644 SHA-256": "Receipt SHA-256 hash",
  "\u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u0625\u064A\u0635\u0627\u0644": "Download receipt",
  "\u0637\u0628\u0627\u0639\u0629": "Print",
  "\u0645\u062C\u062F\u0648\u0644": "Scheduled",
  "\u0627\u0646\u062A\u0647\u062A \u0627\u0644\u062F\u0639\u0648\u0629": "Invitation closed",
  "\u0645\u062A\u0627\u062D \u0644\u0644\u0645\u0634\u0627\u0631\u0643\u0629": "Open for participation",
  "\u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628 \u0627\u0641\u062A\u0631\u0627\u0636\u064A": "Virtual account created",
  "\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u0627\u0644\u0634\u0631\u0648\u0637": "Terms accepted",
  "\u062D\u062C\u0632 \u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A": "Virtual funds allocated",
  "\u062A\u0633\u0648\u064A\u0629 \u0627\u0644\u0639\u0642\u062F": "Contract settlement",
  "\u062A\u063A\u064A\u064A\u0631 \u0641\u0626\u0629 \u0627\u0644\u062D\u0633\u0627\u0628": "Account tier changed",
  "\u0628\u062F\u0623 \u0627\u0644\u0639\u0642\u062F \u0648\u062D\u064F\u062C\u0632 \u0627\u0644\u0645\u0628\u0644\u063A \u0645\u0646 \u0631\u0635\u064A\u062F \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A.": "Contract started and virtual funds allocated.",
  "\u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A \u062C\u0627\u0647\u0632.": "Your practice account is ready.",
  "\u0623\u062F\u062E\u0644 \u0645\u0628\u0644\u063A\u064B\u0627 \u0635\u062D\u064A\u062D\u064B\u0627 \u0628\u0645\u0646\u0632\u0644\u062A\u064A\u0646 \u0639\u0634\u0631\u064A\u062A\u064A\u0646.": "Enter a valid amount with at most two decimal places.",
  "\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644": "Connection unavailable",
  "\u062A\u0639\u0630\u0631 \u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u0639\u0645\u0644\u064A\u0629": "Unable to complete the action"
};

// lib/locales.ts
var APP_LOCALES = ["ar", "en", "tr", "de"];
var isLocale = (v) => typeof v === "string" && APP_LOCALES.includes(v);
var CATALOG = {
  "Your account & privacy": ["Hesab\u0131n\u0131z ve gizlili\u011Finiz", "Ihr Konto und Datenschutz"],
  "Personal details and contact information": ["Ki\u015Fisel bilgiler ve ileti\u015Fim", "Pers\xF6nliche Daten und Kontakt"],
  "Your ORIN experience": ["ORIN deneyiminiz", "Ihr ORIN-Erlebnis"],
  "Sounds and alerts that matter to you": ["Sizin i\xE7in \xF6nemli sesler ve uyar\u0131lar", "Ihre T\xF6ne und Benachrichtigungen"],
  "Symbols, intervals and indicators": ["Varl\u0131klar, aral\u0131klar ve g\xF6stergeler", "Symbole, Zeitintervalle und Indikatoren"],
  "Accounts & transactions": ["Hesaplar ve i\u015Flemler", "Konten und Transaktionen"],
  "ORIN programs": ["ORIN programlar\u0131", "ORIN-Programme"],
  "Here to help": ["Yard\u0131m i\xE7in buraday\u0131z", "Wir helfen Ihnen"],
  "Colors and details, made for you.": ["Size uygun renkler ve ayr\u0131nt\u0131lar.", "Farben und Details nach Ihrem Geschmack."],
  "Choose what you hear and see.": ["Ne duyup g\xF6rece\u011Finizi se\xE7in.", "W\xE4hlen Sie, was Sie h\xF6ren und sehen."],
  "Your market preferences in one place.": ["Piyasa tercihleriniz tek yerde.", "Ihre Markteinstellungen an einem Ort."],
  "Review how your account is protected.": ["Hesab\u0131n\u0131z\u0131n korumas\u0131n\u0131 inceleyin.", "Pr\xFCfen Sie den Schutz Ihres Kontos."],
  "Last 24 hours \xB7 15-minute intervals": ["Son 24 saat \xB7 15 dakikal\u0131k aral\u0131klar", "Letzte 24 Stunden \xB7 15-Minuten-Intervalle"],
  "History temporarily unavailable": ["Ge\xE7mi\u015F ge\xE7ici olarak kullan\u0131lam\u0131yor", "Kursverlauf vor\xFCbergehend nicht verf\xFCgbar"],
  "Loading price history\u2026": ["Fiyat ge\xE7mi\u015Fi y\xFCkleniyor\u2026", "Kursverlauf wird geladen\u2026"],
  "Last available history": ["Son mevcut ge\xE7mi\u015F", "Letzter verf\xFCgbarer Verlauf"],
  "Language": ["Dil", "Sprache"],
  "App language": ["Uygulama dili", "App-Sprache"],
  "Choose your language": ["Dilinizi se\xE7in", "Sprache ausw\xE4hlen"],
  "Your language, your ORIN": ["Sizin diliniz, sizin ORIN\u2019iniz", "Ihre Sprache, Ihr ORIN"],
  "Changes apply immediately and sync to your account.": ["De\u011Fi\u015Fiklikler hemen uygulan\u0131r ve hesab\u0131n\u0131zla e\u015Fitlenir.", "\xC4nderungen werden sofort \xFCbernommen und mit Ihrem Konto synchronisiert."],
  "Search languages": ["Dil ara", "Sprachen suchen"],
  "No matching language": ["E\u015Fle\u015Fen dil yok", "Keine passende Sprache"],
  "Selected": ["Se\xE7ildi", "Ausgew\xE4hlt"],
  "Regional preferences": ["B\xF6lgesel tercihler", "Regionale Einstellungen"],
  "Preview": ["\xD6nizleme", "Vorschau"],
  "Language saved": ["Dil kaydedildi", "Sprache gespeichert"],
  "Font size": ["Yaz\u0131 boyutu", "Schriftgr\xF6\xDFe"],
  "Small": ["K\xFC\xE7\xFCk", "Klein"],
  "Default": ["Standart", "Standard"],
  "Large": ["B\xFCy\xFCk", "Gro\xDF"],
  "Number format": ["Say\u0131 bi\xE7imi", "Zahlenformat"],
  "Latin digits in all languages": ["T\xFCm dillerde Latin rakamlar\u0131", "Lateinische Ziffern in allen Sprachen"],
  "Reference currency": ["Referans para birimi", "Referenzw\xE4hrung"],
  "Time zone": ["Saat dilimi", "Zeitzone"],
  "Balances and settlement are in USD.": ["Bakiyeler ve hesap mutabakat\u0131 USD cinsindedir.", "Guthaben und Abrechnungen werden in USD gef\xFChrt."],
  "Saved preference; balances and settlement remain USD until FX conversion is connected.": ["Tercih kaydedilir; d\xF6viz d\xF6n\xFC\u015F\xFCm\xFC ba\u011Flanana kadar bakiyeler ve mutabakat USD olarak kal\u0131r.", "Die Einstellung wird gespeichert; Guthaben und Abrechnungen bleiben bis zur Anbindung der W\xE4hrungsumrechnung in USD."],
  "Appearance": ["G\xF6r\xFCn\xFCm", "Darstellung"],
  "Choose appearance": ["G\xF6r\xFCn\xFCm\xFC se\xE7in", "Darstellung ausw\xE4hlen"],
  "Light": ["A\xE7\u0131k", "Hell"],
  "Dark": ["Koyu", "Dunkel"],
  "System": ["Sistem", "System"],
  "Reduce motion": ["Hareketi azalt", "Bewegung reduzieren"],
  "Home": ["Ana sayfa", "Startseite"],
  "Markets": ["Piyasalar", "M\xE4rkte"],
  "Positions": ["Pozisyonlar", "Positionen"],
  "Settings": ["Ayarlar", "Einstellungen"],
  "Profile": ["Profil", "Profil"],
  "Account": ["Hesap", "Konto"],
  "Accounts": ["Hesaplar", "Konten"],
  "Support": ["Destek", "Support"],
  "Help & support": ["Yard\u0131m ve destek", "Hilfe und Support"],
  "Notifications": ["Bildirimler", "Benachrichtigungen"],
  "All notifications": ["T\xFCm bildirimler", "Alle Benachrichtigungen"],
  "All": ["T\xFCm\xFC", "Alle"],
  "Trading": ["\u0130\u015Flemler", "Handel"],
  "Security": ["G\xFCvenlik", "Sicherheit"],
  "Account updates in one place.": ["Hesap g\xFCncellemeleri tek yerde.", "Alle Kontomeldungen an einem Ort."],
  "No notifications": ["Bildirim yok", "Keine Benachrichtigungen"],
  "No notifications yet": ["Hen\xFCz bildirim yok", "Noch keine Benachrichtigungen"],
  "Mark all as read": ["T\xFCm\xFCn\xFC okundu i\u015Faretle", "Alle als gelesen markieren"],
  "Read": ["Okundu", "Gelesen"],
  "Unread": ["Okunmad\u0131", "Ungelesen"],
  "Today": ["Bug\xFCn", "Heute"],
  "Yesterday": ["D\xFCn", "Gestern"],
  "Last 7 days": ["Son 7 g\xFCn", "Letzte 7 Tage"],
  "Earlier": ["Daha \xF6nce", "Fr\xFCher"],
  "Deposit": ["Para yat\u0131r", "Einzahlen"],
  "Withdrawal": ["Para \xE7ekme", "Auszahlung"],
  "Withdraw": ["Para \xE7ek", "Auszahlen"],
  "Recent transactions": ["Son i\u015Flemler", "Letzte Transaktionen"],
  "Transactions": ["\u0130\u015Flemler", "Transaktionen"],
  "Account statement": ["Hesap \xF6zeti", "Kontoauszug"],
  "Export PDF": ["PDF d\u0131\u015Fa aktar", "PDF exportieren"],
  "Balance": ["Bakiye", "Guthaben"],
  "Total balance": ["Toplam bakiye", "Gesamtguthaben"],
  "Available balance": ["Kullan\u0131labilir bakiye", "Verf\xFCgbares Guthaben"],
  "Available for trading": ["\u0130\u015Flem yap\u0131labilir bakiye", "F\xFCr den Handel verf\xFCgbar"],
  "Hide balances": ["Bakiyeleri gizle", "Guthaben ausblenden"],
  "Show balance": ["Bakiyeyi g\xF6ster", "Guthaben anzeigen"],
  "Hide balance": ["Bakiyeyi gizle", "Guthaben ausblenden"],
  "Real account": ["Ger\xE7ek hesap", "Echtkonto"],
  "Demo account": ["Demo hesap", "Demokonto"],
  "Real account \xB7 USD": ["Ger\xE7ek hesap \xB7 USD", "Echtkonto \xB7 USD"],
  "Demo account \xB7 USD": ["Demo hesap \xB7 USD", "Demokonto \xB7 USD"],
  "Trade": ["\u0130\u015Flem yap", "Handeln"],
  "Buy": ["Al", "Kaufen"],
  "Sell": ["Sat", "Verkaufen"],
  "Price": ["Fiyat", "Kurs"],
  "Last 24 hours": ["Son 24 saat", "Letzte 24 Stunden"],
  "24h high": ["24 saatin en y\xFCkse\u011Fi", "24-Stunden-Hoch"],
  "24h low": ["24 saatin en d\xFC\u015F\xFC\u011F\xFC", "24-Stunden-Tief"],
  "24h volume": ["24 saatlik hacim", "24-Stunden-Volumen"],
  "High \xB7 24h": ["En y\xFCksek \xB7 24 saat", "Hoch \xB7 24 Std."],
  "Low \xB7 24h": ["En d\xFC\u015F\xFCk \xB7 24 saat", "Tief \xB7 24 Std."],
  "Volume \xB7 24h": ["Hacim \xB7 24 saat", "Volumen \xB7 24 Std."],
  "Volume": ["Hacim", "Volumen"],
  "High": ["En y\xFCksek", "Hoch"],
  "Low": ["En d\xFC\u015F\xFCk", "Tief"],
  "Select asset": ["Varl\u0131k se\xE7", "Verm\xF6genswert ausw\xE4hlen"],
  "Search markets": ["Piyasalarda ara", "M\xE4rkte durchsuchen"],
  "Favorites": ["Favoriler", "Favoriten"],
  "All markets": ["T\xFCm piyasalar", "Alle M\xE4rkte"],
  "Crypto": ["Kripto", "Krypto"],
  "Forex": ["D\xF6viz", "Devisen"],
  "Metals": ["Metaller", "Metalle"],
  "Indices": ["Endeksler", "Indizes"],
  "Back to markets": ["Piyasalara d\xF6n", "Zur\xFCck zu den M\xE4rkten"],
  "Create account": ["Hesap olu\u015Ftur", "Konto erstellen"],
  "Create your account": ["Hesab\u0131n\u0131z\u0131 olu\u015Fturun", "Konto erstellen"],
  "Sign in": ["Giri\u015F yap", "Anmelden"],
  "Sign out": ["\xC7\u0131k\u0131\u015F yap", "Abmelden"],
  "Welcome back": ["Tekrar ho\u015F geldiniz", "Willkommen zur\xFCck"],
  "Welcome to ORIN": ["ORIN\u2019e ho\u015F geldiniz", "Willkommen bei ORIN"],
  "Start your journey with ORIN.": ["ORIN ile yolculu\u011Funuza ba\u015Flay\u0131n.", "Starten Sie Ihre Reise mit ORIN."],
  "Sign in to your ORIN account.": ["ORIN hesab\u0131n\u0131za giri\u015F yap\u0131n.", "Melden Sie sich bei Ihrem ORIN-Konto an."],
  "Name": ["Ad", "Name"],
  "Your name": ["Ad\u0131n\u0131z", "Ihr Name"],
  "Email": ["E-posta", "E-Mail"],
  "Email address": ["E-posta adresi", "E-Mail-Adresse"],
  "Password": ["\u015Eifre", "Passwort"],
  "Confirm password": ["\u015Eifreyi onayla", "Passwort best\xE4tigen"],
  "Show password": ["\u015Eifreyi g\xF6ster", "Passwort anzeigen"],
  "Hide password": ["\u015Eifreyi gizle", "Passwort ausblenden"],
  "Forgot password?": ["\u015Eifrenizi mi unuttunuz?", "Passwort vergessen?"],
  "Reset password": ["\u015Eifreyi s\u0131f\u0131rla", "Passwort zur\xFCcksetzen"],
  "We will send a secure link to your email.": ["E-posta adresinize g\xFCvenli bir ba\u011Flant\u0131 g\xF6nderece\u011Fiz.", "Wir senden einen sicheren Link an Ihre E-Mail-Adresse."],
  "If this email is registered, a reset email will arrive. Check your spam folder too.": ["Bu e-posta kay\u0131tl\u0131ysa s\u0131f\u0131rlama e-postas\u0131 g\xF6nderilir. Spam klas\xF6r\xFCn\xFC de kontrol edin.", "Falls diese E-Mail-Adresse registriert ist, erhalten Sie eine E-Mail zum Zur\xFCcksetzen. Pr\xFCfen Sie auch den Spamordner."],
  "Verification code": ["Do\u011Frulama kodu", "Best\xE4tigungscode"],
  "Enter verification code": ["Do\u011Frulama kodunu girin", "Best\xE4tigungscode eingeben"],
  "Send": ["G\xF6nder", "Senden"],
  "Sending\u2026": ["G\xF6nderiliyor\u2026", "Wird gesendet\u2026"],
  "Invitation code (optional)": ["Davet kodu (iste\u011Fe ba\u011Fl\u0131)", "Einladungscode (optional)"],
  "Referral code (optional)": ["Referans kodu (iste\u011Fe ba\u011Fl\u0131)", "Empfehlungscode (optional)"],
  "Enter your invitation code": ["Davet kodunuzu girin", "Einladungscode eingeben"],
  "Already have an account?": ["Zaten hesab\u0131n\u0131z var m\u0131?", "Sie haben bereits ein Konto?"],
  "Don\u2019t have an account?": ["Hesab\u0131n\u0131z yok mu?", "Noch kein Konto?"],
  "Or": ["Veya", "Oder"],
  "Continue": ["Devam et", "Weiter"],
  "Back": ["Geri", "Zur\xFCck"],
  "Next": ["\u0130leri", "Weiter"],
  "Skip": ["Atla", "\xDCberspringen"],
  "Get started": ["Ba\u015Fla", "Loslegen"],
  "Close": ["Kapat", "Schlie\xDFen"],
  "Cancel": ["\u0130ptal", "Abbrechen"],
  "Confirm": ["Onayla", "Best\xE4tigen"],
  "Save": ["Kaydet", "Speichern"],
  "Save changes": ["De\u011Fi\u015Fiklikleri kaydet", "\xC4nderungen speichern"],
  "Saving\u2026": ["Kaydediliyor\u2026", "Wird gespeichert\u2026"],
  "Search": ["Ara", "Suchen"],
  "Loading": ["Y\xFCkleniyor", "Wird geladen"],
  "Loading data\u2026": ["Veriler y\xFCkleniyor\u2026", "Daten werden geladen\u2026"],
  "Retry": ["Tekrar dene", "Erneut versuchen"],
  "Open": ["A\xE7", "\xD6ffnen"],
  "Details": ["Ayr\u0131nt\u0131lar", "Details"],
  "Too short": ["\xC7ok k\u0131sa", "Zu kurz"],
  "Weak": ["Zay\u0131f", "Schwach"],
  "Fair": ["Orta", "Mittel"],
  "Good": ["\u0130yi", "Gut"],
  "Strong": ["G\xFC\xE7l\xFC", "Stark"],
  "Enter a valid email first.": ["\xD6nce ge\xE7erli bir e-posta adresi girin.", "Geben Sie zun\xE4chst eine g\xFCltige E-Mail-Adresse ein."],
  "Enter a valid email.": ["Ge\xE7erli bir e-posta adresi girin.", "Geben Sie eine g\xFCltige E-Mail-Adresse ein."],
  "Connect to the internet first.": ["\xD6nce internete ba\u011Flan\u0131n.", "Stellen Sie zun\xE4chst eine Internetverbindung her."],
  "The passwords do not match.": ["\u015Eifreler e\u015Fle\u015Fmiyor.", "Die Passw\xF6rter stimmen nicht \xFCberein."],
  "Enter a name of at least 2 characters and a password of at least 8.": ["En az 2 karakterli bir ad ve en az 8 karakterli bir \u015Fifre girin.", "Geben Sie einen Namen mit mindestens 2 und ein Passwort mit mindestens 8 Zeichen ein."],
  "Too many requests. Please wait before requesting another code.": ["\xC7ok fazla istek. Yeni kod istemeden \xF6nce bekleyin.", "Zu viele Anfragen. Warten Sie, bevor Sie einen neuen Code anfordern."],
  "The code is incorrect or expired. Request another code if needed.": ["Kod yanl\u0131\u015F veya s\xFCresi dolmu\u015F. Gerekirse yeni kod isteyin.", "Der Code ist falsch oder abgelaufen. Fordern Sie bei Bedarf einen neuen an."],
  "This email is already registered. Sign in or reset your password.": ["Bu e-posta zaten kay\u0131tl\u0131. Giri\u015F yap\u0131n veya \u015Fifrenizi s\u0131f\u0131rlay\u0131n.", "Diese E-Mail-Adresse ist bereits registriert. Melden Sie sich an oder setzen Sie Ihr Passwort zur\xFCck."],
  "Email verification codes are currently unavailable. Please try later.": ["E-posta do\u011Frulama kodlar\u0131 \u015Fu anda kullan\u0131lam\u0131yor. Daha sonra deneyin.", "E-Mail-Best\xE4tigungscodes sind derzeit nicht verf\xFCgbar. Versuchen Sie es sp\xE4ter erneut."],
  "A 6-digit code was sent to your email. It expires in 10 minutes. Check your spam folder too.": ["E-postan\u0131za 6 haneli kod g\xF6nderildi. 10 dakika ge\xE7erlidir. Spam klas\xF6r\xFCn\xFC de kontrol edin.", "Ein sechsstelliger Code wurde an Ihre E-Mail-Adresse gesendet. Er ist 10 Minuten g\xFCltig. Pr\xFCfen Sie auch den Spamordner."],
  "Send and enter a valid email code before creating your account.": ["Hesap olu\u015Fturmadan \xF6nce e-posta kodunu isteyin ve ge\xE7erli kodu girin.", "Fordern Sie vor der Kontoerstellung einen E-Mail-Code an und geben Sie ihn ein."],
  "Check your invitation code: ORIN- followed by 12 hexadecimal characters.": ["Davet kodunu kontrol edin: ORIN- ard\u0131ndan 12 onalt\u0131l\u0131k karakter.", "Pr\xFCfen Sie den Einladungscode: ORIN- gefolgt von 12 hexadezimalen Zeichen."],
  "Code verification is currently unavailable. A verification link will be sent after account creation.": ["Kod do\u011Frulamas\u0131 \u015Fu anda kullan\u0131lam\u0131yor. Hesap olu\u015Fturulduktan sonra do\u011Frulama ba\u011Flant\u0131s\u0131 g\xF6nderilir.", "Die Codebest\xE4tigung ist derzeit nicht verf\xFCgbar. Nach der Kontoerstellung erhalten Sie einen Best\xE4tigungslink."],
  "Sign-in did not complete. Try your email and password; if the account was not created, request a new code.": ["Giri\u015F tamamlanamad\u0131. E-posta ve \u015Fifrenizi deneyin; hesap olu\u015Fturulmad\u0131ysa yeni kod isteyin.", "Die Anmeldung wurde nicht abgeschlossen. Versuchen Sie es mit E-Mail und Passwort; falls das Konto nicht erstellt wurde, fordern Sie einen neuen Code an."],
  "Account & settings": ["Hesap ve ayarlar", "Konto und Einstellungen"],
  "Make ORIN feel like you.": ["ORIN\u2019i kendinize g\xF6re uyarlay\u0131n.", "Gestalten Sie ORIN nach Ihren W\xFCnschen."],
  "Your personal account": ["Ki\u015Fisel hesab\u0131n\u0131z", "Ihr pers\xF6nliches Konto"],
  "Personal account": ["Ki\u015Fisel hesap", "Pers\xF6nliches Konto"],
  "Standard": ["Standart", "Standard"],
  "Advanced": ["Geli\u015Fmi\u015F", "Erweitert"],
  "Synced to your account": ["Hesab\u0131n\u0131zla e\u015Fitlendi", "Mit Ihrem Konto synchronisiert"],
  "Syncing\u2026": ["E\u015Fitleniyor\u2026", "Wird synchronisiert\u2026"],
  "This device only \xB7 Sign in to sync": ["Yaln\u0131zca bu cihaz \xB7 E\u015Fitlemek i\xE7in giri\u015F yap\u0131n", "Nur auf diesem Ger\xE4t \xB7 Zum Synchronisieren anmelden"],
  "Sync unavailable": ["E\u015Fitleme kullan\u0131lam\u0131yor", "Synchronisierung nicht verf\xFCgbar"],
  "Retry sync": ["E\u015Fitlemeyi tekrar dene", "Synchronisierung erneut versuchen"],
  "Account & profile": ["Hesap ve profil", "Konto und Profil"],
  "Select or create an account from the balance card": ["Bakiye kart\u0131ndan hesap se\xE7in veya olu\u015Fturun", "Konto \xFCber die Guthabenkarte ausw\xE4hlen oder erstellen"],
  "Privacy & data": ["Gizlilik ve veriler", "Datenschutz und Daten"],
  "Terms & policies": ["Ko\u015Fullar ve politikalar", "Bedingungen und Richtlinien"],
  "About ORIN": ["ORIN hakk\u0131nda", "\xDCber ORIN"],
  "Referral program": ["Davet program\u0131", "Empfehlungsprogramm"],
  "Invite a friend": ["Arkada\u015F\u0131n\u0131 davet et", "Freund einladen"],
  "Referral tree": ["Davet a\u011Fac\u0131", "Empfehlungsbaum"],
  "Badges & achievements": ["Rozetler ve ba\u015Far\u0131lar", "Abzeichen und Erfolge"],
  "Welcome bonus $100": ["100 $ ho\u015F geldin bonusu", "100 $ Willkommensbonus"],
  "Agency program": ["Temsilcilik program\u0131", "Partnerprogramm"],
  "Chart & markets": ["Grafik ve piyasalar", "Chart und M\xE4rkte"],
  "Documents": ["Belgeler", "Dokumente"],
  "Your profile": ["Profiliniz", "Ihr Profil"],
  "Appearance & language": ["G\xF6r\xFCn\xFCm ve dil", "Darstellung und Sprache"],
  "Security center": ["G\xFCvenlik merkezi", "Sicherheitscenter"],
  "Notification preferences": ["Bildirim tercihleri", "Benachrichtigungseinstellungen"],
  "Chart settings": ["Grafik ayarlar\u0131", "Chart-Einstellungen"],
  "Data & privacy": ["Veriler ve gizlilik", "Daten und Datenschutz"],
  "Your details and account settings, together.": ["Bilgileriniz ve hesap ayarlar\u0131n\u0131z bir arada.", "Ihre Angaben und Kontoeinstellungen an einem Ort."],
  "Your ORIN account": ["ORIN hesab\u0131n\u0131z", "Ihr ORIN-Konto"],
  "ORIN account": ["ORIN hesab\u0131", "ORIN-Konto"],
  "Admin": ["Y\xF6netici", "Administrator"],
  "Administration": ["Y\xF6netim", "Verwaltung"],
  "ORIN Control Center": ["ORIN Y\xF6netim Merkezi", "ORIN-Verwaltungszentrale"],
  "Customers, permissions and operations": ["M\xFC\u015Fteriler, yetkiler ve i\u015Flemler", "Kunden, Berechtigungen und Vorg\xE4nge"],
  "Select a trading account on Home": ["Ana sayfadan i\u015Flem hesab\u0131 se\xE7in", "Handelskonto auf der Startseite ausw\xE4hlen"],
  "Closure requested": ["Kapatma talep edildi", "Schlie\xDFung beantragt"],
  "Personal details": ["Ki\u015Fisel bilgiler", "Pers\xF6nliche Angaben"],
  "Keep your account details accurate.": ["Hesap bilgilerinizi g\xFCncel tutun.", "Halten Sie Ihre Kontodaten aktuell."],
  "Full name": ["Ad ve soyad", "Vollst\xE4ndiger Name"],
  "The email you use to sign in.": ["Giri\u015F i\xE7in kulland\u0131\u011F\u0131n\u0131z e-posta.", "Die E-Mail-Adresse f\xFCr Ihre Anmeldung."],
  "Phone number": ["Telefon numaras\u0131", "Telefonnummer"],
  "Contact number; not verified.": ["\u0130leti\u015Fim numaras\u0131; do\u011Frulanmam\u0131\u015F.", "Kontaktnummer; nicht best\xE4tigt."],
  "Country": ["\xDClke", "Land"],
  "Choose country": ["\xDClke se\xE7in", "Land ausw\xE4hlen"],
  "Your details are saved": ["Bilgileriniz kaydedildi", "Ihre Angaben wurden gespeichert"],
  "You have unsaved changes": ["Kaydedilmemi\u015F de\u011Fi\u015Fiklikler var", "Sie haben ungespeicherte \xC4nderungen"],
  "Your current details": ["G\xFCncel bilgileriniz", "Ihre aktuellen Angaben"],
  "Security & privacy": ["G\xFCvenlik ve gizlilik", "Sicherheit und Datenschutz"],
  "Account security": ["Hesap g\xFCvenli\u011Fi", "Kontosicherheit"],
  "My data & privacy": ["Verilerim ve gizlilik", "Meine Daten und Datenschutz"],
  "Download your data and manage privacy requests": ["Verilerinizi indirin ve gizlilik taleplerini y\xF6netin", "Daten herunterladen und Datenschutzanfragen verwalten"],
  "Identity verification is not currently available.": ["Kimlik do\u011Frulama \u015Fu anda kullan\u0131lam\u0131yor.", "Die Identit\xE4tspr\xFCfung ist derzeit nicht verf\xFCgbar."],
  "Account management": ["Hesap y\xF6netimi", "Kontoverwaltung"],
  "Closure request under review": ["Kapatma talebi inceleniyor", "Schlie\xDFungsantrag wird gepr\xFCft"],
  "Request account closure": ["Hesap kapatma talebi", "Kontoschlie\xDFung beantragen"],
  "Confirm closure request": ["Kapatma talebini onayla", "Schlie\xDFungsantrag best\xE4tigen"],
  "This records a request for review and retains financial records. It does not immediately delete data. Settle active contracts first.": ["\u0130nceleme i\xE7in talep kaydedilir ve mali kay\u0131tlar korunur. Veriler hemen silinmez. \xD6nce aktif s\xF6zle\u015Fmeleri tamamlay\u0131n.", "Es wird ein Antrag zur Pr\xFCfung gespeichert; Finanzunterlagen bleiben erhalten. Daten werden nicht sofort gel\xF6scht. Schlie\xDFen Sie zuerst aktive Vertr\xE4ge ab."],
  "Password and email verification": ["\u015Eifre ve e-posta do\u011Frulamas\u0131", "Passwort und E-Mail-Best\xE4tigung"],
  "Privacy policy": ["Gizlilik politikas\u0131", "Datenschutzerkl\xE4rung"],
  "Terms & privacy": ["Ko\u015Fullar ve gizlilik", "Bedingungen und Datenschutz"],
  "You are offline. Reconnect to save changes and sync your account.": ["\xC7evrimd\u0131\u015F\u0131s\u0131n\u0131z. De\u011Fi\u015Fiklikleri kaydetmek ve hesab\u0131n\u0131z\u0131 e\u015Fitlemek i\xE7in yeniden ba\u011Flan\u0131n.", "Sie sind offline. Verbinden Sie sich erneut, um \xC4nderungen zu speichern und Ihr Konto zu synchronisieren."],
  "Wait for account sync or sign in.": ["Hesab\u0131n e\u015Fitlenmesini bekleyin veya giri\u015F yap\u0131n.", "Warten Sie auf die Kontosynchronisierung oder melden Sie sich an."],
  "Unable to create account statement.": ["Hesap \xF6zeti olu\u015Fturulamad\u0131.", "Kontoauszug konnte nicht erstellt werden."],
  "Funding and withdrawals await service activation": ["Para yat\u0131rma ve \xE7ekme hizmet aktivasyonunu bekliyor", "Ein- und Auszahlungen warten auf die Freischaltung"],
  "Deposit and withdrawal services are not connected to this account yet.": ["Para yat\u0131rma ve \xE7ekme hizmetleri hen\xFCz bu hesaba ba\u011Flanmad\u0131.", "Ein- und Auszahlungen sind f\xFCr dieses Konto noch nicht angebunden."],
  "Demo balance is not withdrawable": ["Demo bakiye \xE7ekilemez", "Demoguthaben kann nicht ausgezahlt werden"],
  "Demo funds cannot be withdrawn or converted into real funds.": ["Demo para \xE7ekilemez veya ger\xE7ek paraya d\xF6n\xFC\u015Ft\xFCr\xFClemez.", "Demoguthaben kann weder ausgezahlt noch in Echtgeld umgewandelt werden."],
  "Password strength": ["\u015Eifre g\xFCc\xFC", "Passwortst\xE4rke"],
  "At least 8 characters.": ["En az 8 karakter.", "Mindestens 8 Zeichen."],
  "Re-enter password": ["\u015Eifreyi tekrar girin", "Passwort erneut eingeben"],
  "Hide confirmation": ["Onay \u015Fifresini gizle", "Best\xE4tigung ausblenden"],
  "Show confirmation": ["Onay \u015Fifresini g\xF6ster", "Best\xE4tigung anzeigen"],
  "Please wait\u2026": ["L\xFCtfen bekleyin\u2026", "Bitte warten\u2026"],
  "Send reset link": ["S\u0131f\u0131rlama ba\u011Flant\u0131s\u0131 g\xF6nder", "Link zum Zur\xFCcksetzen senden"],
  "New to ORIN? Create account": ["ORIN\u2019de yeni misiniz? Hesap olu\u015Fturun", "Neu bei ORIN? Konto erstellen"],
  "Already have an account? Sign in": ["Zaten hesab\u0131n\u0131z var m\u0131? Giri\u015F yap\u0131n", "Sie haben bereits ein Konto? Anmelden"],
  "Chart type": ["Grafik t\xFCr\xFC", "Chart-Typ"],
  "Candles": ["Mumlar", "Kerzen"],
  "Line": ["\xC7izgi", "Linie"],
  "Area": ["Alan", "Fl\xE4che"],
  "Default symbol": ["Varsay\u0131lan sembol", "Standardsymbol"],
  "Default timeframe": ["Varsay\u0131lan zaman aral\u0131\u011F\u0131", "Standardzeitraum"],
  "Chart theme": ["Grafik temas\u0131", "Chart-Design"],
  "Follows ORIN appearance": ["ORIN g\xF6r\xFCn\xFCm\xFCn\xFC izler", "Folgt der ORIN-Darstellung"],
  "Grid": ["Izgara", "Raster"],
  "Available in chart; managed by provider": ["Grafikte kullan\u0131labilir; sa\u011Flay\u0131c\u0131 y\xF6netir", "Im Chart verf\xFCgbar; vom Anbieter verwaltet"],
  "Current price line": ["G\xFCncel fiyat \xE7izgisi", "Aktuelle Kurslinie"],
  "Save drawings": ["\xC7izimleri kaydet", "Zeichnungen speichern"],
  "Requires an integration with a drawing API": ["\xC7izim API entegrasyonu gerektirir", "Erfordert die Anbindung einer Zeichen-API"],
  "Allowed indicators": ["\u0130zin verilen g\xF6stergeler", "Erlaubte Indikatoren"],
  "No indicators enabled by the administrator.": ["Y\xF6netici hi\xE7bir g\xF6stergeyi etkinle\u015Ftirmedi.", "Der Administrator hat keine Indikatoren aktiviert."],
  "Reset chart": ["Grafi\u011Fi s\u0131f\u0131rla", "Chart zur\xFCcksetzen"],
  "Only supported TradingView options are applied. Provider attribution remains visible.": ["Yaln\u0131zca desteklenen TradingView se\xE7enekleri uygulan\u0131r. Sa\u011Flay\u0131c\u0131 bilgisi g\xF6r\xFCn\xFCr kal\u0131r.", "Nur unterst\xFCtzte TradingView-Optionen werden angewendet. Der Anbieterhinweis bleibt sichtbar."],
  "Admin chart settings": ["Y\xF6netici grafik ayarlar\u0131", "Administrative Chart-Einstellungen"],
  "Devices": ["Cihazlar", "Ger\xE4te"],
  "Privacy": ["Gizlilik", "Datenschutz"],
  "Referral center": ["Davet merkezi", "Empfehlungscenter"],
  "Agent center": ["Temsilci merkezi", "Partnercenter"],
  "Two-factor authentication": ["\u0130ki fakt\xF6rl\xFC kimlik do\u011Frulama", "Zwei-Faktor-Authentifizierung"],
  "Authenticator setup": ["Kimlik do\u011Frulay\u0131c\u0131 kurulumu", "Authentifizierungs-App einrichten"],
  "User management": ["Kullan\u0131c\u0131 y\xF6netimi", "Benutzerverwaltung"],
  "Rewards, bonus & agency": ["\xD6d\xFCller, bonus ve temsilcilik", "Pr\xE4mien, Bonus und Partnerprogramm"],
  "Contracts & invitations": ["S\xF6zle\u015Fmeler ve davetler", "Vertr\xE4ge und Einladungen"],
  "Market settings": ["Piyasa ayarlar\u0131", "Markteinstellungen"],
  "Notification administration": ["Bildirim y\xF6netimi", "Benachrichtigungsverwaltung"],
  "Server-enforced settings shared across devices.": ["Sunucuda uygulanan ayarlar cihazlar aras\u0131nda payla\u015F\u0131l\u0131r.", "Serverseitig durchgesetzte Einstellungen f\xFCr alle Ger\xE4te."],
  "In-app notifications": ["Uygulama i\xE7i bildirimler", "In-App-Benachrichtigungen"],
  "Notification center": ["Bildirim merkezi", "Benachrichtigungscenter"],
  "Delivery channels": ["\u0130letim kanallar\u0131", "Versandkan\xE4le"],
  "Delivery service not connected": ["\u0130letim hizmeti ba\u011Fl\u0131 de\u011Fil", "Versanddienst nicht angebunden"],
  "Events": ["Olaylar", "Ereignisse"],
  "Preference saved for when this service is connected": ["Tercih, hizmet ba\u011Fland\u0131\u011F\u0131nda kullan\u0131lmak \xFCzere kaydedildi", "Einstellung f\xFCr die sp\xE4tere Anbindung dieses Dienstes gespeichert"],
  "ORIN account security": ["ORIN hesap g\xFCvenli\u011Fi", "Sicherheit des ORIN-Kontos"],
  "Sign in with ChatGPT": ["ChatGPT ile giri\u015F yap", "Mit ChatGPT anmelden"],
  "ORIN does not store a password. Authentication methods are managed by your identity provider.": ["ORIN \u015Fifrenizi saklamaz. Kimlik do\u011Frulama y\xF6ntemleri kimlik sa\u011Flay\u0131c\u0131n\u0131z taraf\u0131ndan y\xF6netilir.", "ORIN speichert kein Passwort. Die Anmeldeverfahren werden von Ihrem Identit\xE4tsanbieter verwaltet."],
  "Change Password": ["\u015Eifreyi de\u011Fi\u015Ftir", "Passwort \xE4ndern"],
  "Two-Factor Authentication": ["\u0130ki fakt\xF6rl\xFC kimlik do\u011Frulama", "Zwei-Faktor-Authentifizierung"],
  "Biometric Login": ["Biyometrik giri\u015F", "Biometrische Anmeldung"],
  "Active Sessions": ["Aktif oturumlar", "Aktive Sitzungen"],
  "Trusted Devices": ["G\xFCvenilen cihazlar", "Vertrauensw\xFCrdige Ger\xE4te"],
  "Login history": ["Giri\u015F ge\xE7mi\u015Fi", "Anmeldeverlauf"],
  "Sign Out All Devices": ["T\xFCm cihazlardan \xE7\u0131k\u0131\u015F yap", "Von allen Ger\xE4ten abmelden"],
  "Not manageable from ORIN with the current identity integration": ["Mevcut kimlik entegrasyonunda ORIN \xFCzerinden y\xF6netilemez", "Mit der aktuellen Identit\xE4tsanbindung nicht \xFCber ORIN verwaltbar"],
  "Not connected": ["Ba\u011Fl\u0131 de\u011Fil", "Nicht verbunden"],
  "Security Alerts": ["G\xFCvenlik uyar\u0131lar\u0131", "Sicherheitsmeldungen"],
  "Sign out of this session": ["Bu oturumdan \xE7\u0131k\u0131\u015F yap", "Diese Sitzung abmelden"],
  "Authentication is managed by the identity provider": ["Kimlik do\u011Frulamas\u0131n\u0131 kimlik sa\u011Flay\u0131c\u0131s\u0131 y\xF6netir", "Die Authentifizierung wird vom Identit\xE4tsanbieter verwaltet"],
  "Two-factor authentication is not connected in this release. No recovery codes have been issued.": ["Bu s\xFCr\xFCmde iki fakt\xF6rl\xFC kimlik do\u011Frulama ba\u011Fl\u0131 de\u011Fildir. Kurtarma kodu verilmemi\u015Ftir.", "Die Zwei-Faktor-Authentifizierung ist in dieser Version nicht angebunden. Es wurden keine Wiederherstellungscodes ausgegeben."],
  "ORIN does not have a separate authenticator enrollment in this release. Use your sign-in provider\u2019s security settings.": ["Bu s\xFCr\xFCmde ORIN i\xE7in ayr\u0131 kimlik do\u011Frulay\u0131c\u0131 kayd\u0131 yoktur. Giri\u015F sa\u011Flay\u0131c\u0131n\u0131z\u0131n g\xFCvenlik ayarlar\u0131n\u0131 kullan\u0131n.", "Diese Version bietet keine separate Authentifizierungs-App-Einrichtung f\xFCr ORIN. Nutzen Sie die Sicherheitseinstellungen Ihres Anmeldeanbieters."],
  "Your identity provider manages devices and sessions. Session records are not currently available to ORIN.": ["Cihazlar\u0131 ve oturumlar\u0131 kimlik sa\u011Flay\u0131c\u0131n\u0131z y\xF6netir. Oturum kay\u0131tlar\u0131 \u015Fu anda ORIN\u2019de kullan\u0131lamaz.", "Ger\xE4te und Sitzungen werden von Ihrem Identit\xE4tsanbieter verwaltet. Sitzungsdaten stehen ORIN derzeit nicht zur Verf\xFCgung."],
  "BTC/USD candles use Coinbase Exchange; other assets use TradingView. Delays vary by source and market.": ["BTC/USD mumlar\u0131 Coinbase Exchange\u2019i, di\u011Fer varl\u0131klar TradingView\u2019\u0131 kullan\u0131r. Gecikme kayna\u011Fa ve piyasaya g\xF6re de\u011Fi\u015Fir.", "BTC/USD-Kerzen stammen von Coinbase Exchange; andere Werte von TradingView. Verz\xF6gerungen variieren je nach Quelle und Markt."],
  "Internal contracts are independent of the market. Locked settlement terms are shown before participation and do not represent an exchange execution.": ["\u0130\xE7 s\xF6zle\u015Fmeler piyasadan ba\u011F\u0131ms\u0131zd\u0131r. Sabit mutabakat ko\u015Fullar\u0131 kat\u0131l\u0131mdan \xF6nce g\xF6sterilir ve borsa i\u015Flemi anlam\u0131na gelmez.", "Interne Vertr\xE4ge sind vom Markt unabh\xE4ngig. Festgelegte Abrechnungsbedingungen werden vor der Teilnahme angezeigt und stellen keine B\xF6rsenausf\xFChrung dar."],
  "The current widget does not expose the last quote time, drawing storage or background price alerts to ORIN. Changing symbol or interval reinitializes the chart.": ["Mevcut bile\u015Fen ORIN\u2019e son fiyat zaman\u0131n\u0131, \xE7izim kayd\u0131n\u0131 veya arka plan fiyat uyar\u0131lar\u0131n\u0131 sunmaz. Sembol veya aral\u0131k de\u011Fi\u015Fince grafik yeniden ba\u015Flat\u0131l\u0131r.", "Das aktuelle Widget stellt ORIN weder die letzte Kurszeit noch Zeichnungsspeicherung oder Hintergrund-Kursalarme bereit. Ein Symbol- oder Intervallwechsel initialisiert den Chart neu."],
  "Markets.": ["Piyasalar.", "M\xE4rkte."],
  "Your perspective.": ["Sizin bak\u0131\u015F\u0131n\u0131z.", "Ihre Perspektive."],
  "From crypto to gold. Choose what matters to you and see the bigger picture.": ["Kriptodan alt\u0131na. Sizin i\xE7in \xF6nemli olan\u0131 se\xE7in ve b\xFCy\xFCk resmi g\xF6r\xFCn.", "Von Krypto bis Gold. W\xE4hlen Sie, was Ihnen wichtig ist, und behalten Sie den \xDCberblick."],
  "Explore markets": ["Piyasalar\u0131 ke\u015Ffet", "M\xE4rkte entdecken"],
  "Every account.": ["Her hesap.", "Jedes Konto."],
  "In its place.": ["Kendi yerinde.", "An seinem Platz."],
  "Your accounts and activity together, with a clear separation between real and demo accounts.": ["Hesaplar\u0131n\u0131z ve i\u015Flemleriniz bir arada; ger\xE7ek ve demo hesaplar a\xE7\u0131k\xE7a ayr\u0131l\u0131r.", "Konten und Aktivit\xE4ten an einem Ort, mit klarer Trennung zwischen Echt- und Demokonten."],
  "Your workspace": ["\xC7al\u0131\u015Fma alan\u0131n\u0131z", "Ihr Arbeitsbereich"],
  "Start your journey.": ["Yolculu\u011Funuza ba\u015Flay\u0131n.", "Starten Sie Ihre Reise."],
  "Stay connected.": ["Ba\u011Flant\u0131da kal\u0131n.", "Bleiben Sie in Verbindung."],
  "Your settings within reach and a direct way to contact the ORIN team inside the app.": ["Ayarlar\u0131n\u0131z elinizin alt\u0131nda; ORIN ekibine uygulamadan do\u011Frudan ula\u015F\u0131n.", "Ihre Einstellungen griffbereit und ein direkter Kontakt zum ORIN-Team in der App."],
  "You\u2019re with ORIN": ["ORIN yan\u0131n\u0131zda", "Sie sind bei ORIN"],
  "Introduction steps": ["Tan\u0131t\u0131m ad\u0131mlar\u0131", "Einf\xFChrungsschritte"],
  "Step ": ["Ad\u0131m ", "Schritt "],
  "Conversation in your space": ["Kendi alan\u0131n\u0131zda sohbet", "Gespr\xE4ch in Ihrem Bereich"],
  "Your account. Your settings.": ["Hesab\u0131n\u0131z. Ayarlar\u0131n\u0131z.", "Ihr Konto. Ihre Einstellungen."],
  "Already a member?": ["Zaten \xFCye misiniz?", "Bereits Mitglied?"],
  "Notifications unavailable": ["Bildirimler kullan\u0131lam\u0131yor", "Benachrichtigungen nicht verf\xFCgbar"],
  "You\u2019re all caught up": ["T\xFCm bildirimleri g\xF6rd\xFCn\xFCz", "Sie sind auf dem neuesten Stand"],
  "Open your notification center for account updates.": ["Hesap g\xFCncellemeleri i\xE7in bildirim merkezini a\xE7\u0131n.", "\xD6ffnen Sie das Benachrichtigungscenter f\xFCr Kontomeldungen."],
  "Your account updates, together.": ["Hesap g\xFCncellemeleriniz bir arada.", "Ihre Kontomeldungen an einem Ort."],
  "Loading notifications": ["Bildirimler y\xFCkleniyor", "Benachrichtigungen werden geladen"],
  "Sign in to see your notifications": ["Bildirimlerinizi g\xF6rmek i\xE7in giri\u015F yap\u0131n", "Melden Sie sich an, um Benachrichtigungen zu sehen"],
  "Unable to connect": ["Ba\u011Flant\u0131 kurulamad\u0131", "Verbindung nicht m\xF6glich"],
  "Notification unavailable": ["Bildirim kullan\u0131lam\u0131yor", "Benachrichtigung nicht verf\xFCgbar"],
  "It may have expired or be unavailable to this account.": ["S\xFCresi dolmu\u015F veya bu hesap i\xE7in kullan\u0131lam\u0131yor olabilir.", "Sie ist m\xF6glicherweise abgelaufen oder f\xFCr dieses Konto nicht verf\xFCgbar."],
  "Could not save the draft on this device.": ["Taslak bu cihaza kaydedilemedi.", "Der Entwurf konnte auf diesem Ger\xE4t nicht gespeichert werden."],
  "The message did not reach the service. Your draft is saved.": ["Mesaj hizmete ula\u015Fmad\u0131. Tasla\u011F\u0131n\u0131z kaydedildi.", "Die Nachricht hat den Dienst nicht erreicht. Ihr Entwurf wurde gespeichert."],
  "Connected to service": ["Hizmete ba\u011Fl\u0131", "Mit dem Dienst verbunden"],
  "Offline \xB7 messages saved on your device": ["\xC7evrimd\u0131\u015F\u0131 \xB7 mesajlar cihaz\u0131n\u0131zda kay\u0131tl\u0131", "Offline \xB7 Nachrichten auf Ihrem Ger\xE4t gespeichert"],
  "Connecting to service\u2026": ["Hizmete ba\u011Flan\u0131l\u0131yor\u2026", "Verbindung zum Dienst wird hergestellt\u2026"],
  "Service unavailable \xB7 drafts saved": ["Hizmet kullan\u0131lam\u0131yor \xB7 taslaklar kaydedildi", "Dienst nicht verf\xFCgbar \xB7 Entw\xFCrfe gespeichert"],
  "ORIN Support": ["ORIN Destek", "ORIN-Support"],
  "We are here to help": ["Size yard\u0131mc\u0131 olmak i\xE7in buraday\u0131z", "Wir sind f\xFCr Sie da"],
  "Conversation options": ["Sohbet se\xE7enekleri", "Gespr\xE4chsoptionen"],
  "Do not share passwords or verification codes.": ["\u015Eifrelerinizi veya do\u011Frulama kodlar\u0131n\u0131z\u0131 payla\u015Fmay\u0131n.", "Teilen Sie keine Passw\xF6rter oder Best\xE4tigungscodes."],
  "Could not request follow-up.": ["Takip talebi g\xF6nderilemedi.", "Eine R\xFCckmeldung konnte nicht angefordert werden."],
  "Follow-up requested": ["Takip talep edildi", "R\xFCckmeldung angefordert"],
  "Request a support agent": ["Destek temsilcisi iste", "Supportmitarbeiter anfordern"],
  "ORIN support team": ["ORIN destek ekibi", "ORIN-Supportteam"],
  "Conversation history": ["Sohbet ge\xE7mi\u015Fi", "Gespr\xE4chsverlauf"],
  "Older messages are currently unavailable.": ["Eski mesajlar \u015Fu anda kullan\u0131lam\u0131yor.", "\xC4ltere Nachrichten sind derzeit nicht verf\xFCgbar."],
  "Earlier messages": ["\xD6nceki mesajlar", "Fr\xFChere Nachrichten"],
  "How can we help today?": ["Bug\xFCn nas\u0131l yard\u0131mc\u0131 olabiliriz?", "Wie k\xF6nnen wir Ihnen heute helfen?"],
  "Choose a topic or write to the ORIN team.": ["Bir konu se\xE7in veya ORIN ekibine yaz\u0131n.", "W\xE4hlen Sie ein Thema oder schreiben Sie dem ORIN-Team."],
  "I need help with: ": ["\u015Eu konuda yard\u0131ma ihtiyac\u0131m var: ", "Ich ben\xF6tige Hilfe zu: "],
  "ORIN team": ["ORIN ekibi", "ORIN-Team"],
  "Sent": ["G\xF6nderildi", "Gesendet"],
  "Not sent": ["G\xF6nderilmedi", "Nicht gesendet"],
  "Queued": ["S\u0131rada", "In der Warteschlange"],
  "Send again": ["Tekrar g\xF6nder", "Erneut senden"],
  "Discard draft": ["Tasla\u011F\u0131 sil", "Entwurf verwerfen"],
  "Your message": ["Mesaj\u0131n\u0131z", "Ihre Nachricht"],
  "Write a message\u2026": ["Mesaj yaz\u0131n\u2026", "Nachricht schreiben\u2026"],
  "Send message": ["Mesaj g\xF6nder", "Nachricht senden"],
  "Markets.\nYour perspective.": ["Piyasalar.\nSizin bak\u0131\u015F\u0131n\u0131z.", "M\xE4rkte.\nIhre Perspektive."],
  "Every account.\nIn its place.": ["Her hesap.\nKendi yerinde.", "Jedes Konto.\nAn seinem Platz."],
  "Start your journey.\nStay connected.": ["Yolculu\u011Funuza ba\u015Flay\u0131n.\nBa\u011Flant\u0131da kal\u0131n.", "Starten Sie Ihre Reise.\nBleiben Sie in Verbindung."]
};
function translate(locale, ar, en) {
  if (locale === "ar") return ar;
  const english = en ?? EN[ar] ?? ar;
  if (locale === "en") return english;
  return CATALOG[english]?.[locale === "tr" ? 0 : 1] ?? english;
}

// lib/market-symbols.ts
var MARKET_SYMBOLS = [
  { pair: "BTC-USD", label: "BTC/USD", name: "Bitcoin", tv: "BITSTAMP:BTCUSD", category: "crypto" },
  { pair: "ETH-USD", label: "ETH/USD", name: "Ethereum", tv: "BITSTAMP:ETHUSD", category: "crypto" },
  { pair: "XRP-USD", label: "XRP/USD", name: "XRP", tv: "BITSTAMP:XRPUSD", category: "crypto" },
  { pair: "SOL-USD", label: "SOL/USD", name: "Solana", tv: "COINBASE:SOLUSD", category: "crypto" },
  { pair: "BNB-USDT", label: "BNB/USDT", name: "BNB", tv: "BINANCE:BNBUSDT", category: "crypto" },
  { pair: "DOGE-USD", label: "DOGE/USD", name: "Dogecoin", tv: "COINBASE:DOGEUSD", category: "crypto" },
  { pair: "TON-USDT", label: "TON/USDT", name: "Toncoin", tv: "OKX:TONUSDT", category: "crypto" },
  { pair: "ADA-USD", label: "ADA/USD", name: "Cardano", tv: "COINBASE:ADAUSD", category: "crypto" },
  { pair: "EUR-USD", label: "EUR/USD", name: "\u0627\u0644\u064A\u0648\u0631\u0648 / \u0627\u0644\u062F\u0648\u0644\u0627\u0631", tv: "FX:EURUSD", category: "forex" },
  { pair: "GBP-USD", label: "GBP/USD", name: "\u0627\u0644\u062C\u0646\u064A\u0647 / \u0627\u0644\u062F\u0648\u0644\u0627\u0631", tv: "FX:GBPUSD", category: "forex" },
  { pair: "XAU-USD", label: "XAU/USD", name: "\u0627\u0644\u0630\u0647\u0628 / \u0627\u0644\u062F\u0648\u0644\u0627\u0631", tv: "OANDA:XAUUSD", category: "metals" },
  { pair: "XAG-USD", label: "XAG/USD", name: "\u0627\u0644\u0641\u0636\u0629 / \u0627\u0644\u062F\u0648\u0644\u0627\u0631", tv: "OANDA:XAGUSD", category: "metals" },
  { pair: "SPX-USD", label: "S&P 500", name: "S&P 500", tv: "FOREXCOM:SPXUSD", category: "indices" },
  { pair: "NDX-USD", label: "Nasdaq 100", name: "Nasdaq 100", tv: "FOREXCOM:NSXUSD", category: "indices" }
];

// lib/preferences.ts
var TIMEFRAMES = ["1", "5", "15", "60", "240", "D"];
var CHART_TYPES = ["1", "2", "3"];
var INDICATORS = ["MA", "EMA", "RSI", "MACD", "BB"];
var NOTICE_EVENTS = ["opportunity", "contract_started", "contract_ended", "settlement", "deposit", "withdrawal", "referral", "agent", "support", "security", "announcement", "reminder"];
var CAPABILITIES = Object.freeze({ provider: "tradingview-widget", indicators: true, drawings: false, saveDrawings: false, priceAlerts: false, quoteTelemetry: false, inPlaceUpdates: false, crosshairControl: false, priceLineControl: false, push: false, email: false, sms: false, password: false, totp: false, passkeys: false, biometrics: false, recoveryCodes: false, sessionManagement: false });
var DEFAULT_CONFIGURATION = { defaultSymbol: "BTC-USD", enabledSymbols: MARKET_SYMBOLS.map((s) => s.pair), defaultTimeframe: "15", enabledTimeframes: [...TIMEFRAMES], defaultChartType: "1", enabledChartTypes: [...CHART_TYPES], allowedIndicators: [...INDICATORS], allowedDrawingTools: [], volume: false, gridDefault: true, crosshairDefault: true, fullscreen: true, alerts: false, favorites: true };
var DEFAULT_PREFERENCES = { hideBalance: false, notifications: true, reduceMotion: false, notificationSounds: false, opportunitySound: true, securitySound: true, vibration: false, marketingNotifications: false, chartLocale: "ar", theme: "light", fontSize: "normal", numberFormat: "latin", referenceCurrency: "USD", timezone: "Etc/UTC", chartPair: "BTC-USD", chartInterval: "15", chartStyle: "1", grid: true, crosshair: true, priceLine: true, saveDrawings: false, indicators: [], favorites: [], notificationEvents: Object.fromEntries(NOTICE_EVENTS.map((k) => [k, true])), notificationChannels: { push: false, email: false, sms: false } };
var PREFERENCES_KEY = "orin-preferences-v2";
var includes = (all, v) => typeof v === "string" && all.includes(v);
function validTimezone(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
function parsePreferences(value, c = DEFAULT_CONFIGURATION) {
  const p = value && typeof value === "object" ? value : {};
  const list = (v, allowed) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && allowed.includes(x)))] : [];
  return { ...DEFAULT_PREFERENCES, hideBalance: p.hideBalance === true, notifications: p.notifications !== false, notificationSounds: p.notificationSounds === true, opportunitySound: p.opportunitySound !== false, securitySound: p.securitySound !== false, vibration: p.vibration === true, marketingNotifications: p.marketingNotifications === true, reduceMotion: p.reduceMotion === true, chartLocale: isLocale(p.chartLocale) ? p.chartLocale : "ar", theme: includes(["light", "dark", "system"], p.theme) ? p.theme : DEFAULT_PREFERENCES.theme, fontSize: includes(["small", "normal", "large"], p.fontSize) ? p.fontSize : "normal", numberFormat: "latin", referenceCurrency: includes(["USD", "EUR", "GBP"], p.referenceCurrency) ? p.referenceCurrency : "USD", timezone: validTimezone(p.timezone) ? p.timezone : "Etc/UTC", chartPair: includes(c.enabledSymbols, p.chartPair) ? p.chartPair : c.defaultSymbol, chartInterval: includes(c.enabledTimeframes, p.chartInterval) ? p.chartInterval : c.defaultTimeframe, chartStyle: includes(c.enabledChartTypes, p.chartStyle) ? p.chartStyle : c.defaultChartType, grid: typeof p.grid === "boolean" ? p.grid : c.gridDefault, crosshair: true, priceLine: true, saveDrawings: false, indicators: list(p.indicators, c.allowedIndicators), favorites: c.favorites ? list(p.favorites, c.enabledSymbols) : [], notificationEvents: Object.fromEntries(NOTICE_EVENTS.map((k) => [k, k === "security" || p.notificationEvents?.[k] !== false])), notificationChannels: { push: false, email: false, sms: false } };
}

// app/orin-settings.tsx
import { jsx } from "react/jsx-runtime";
var OrinContext = createContext(null);
function OrinSettingsProvider({ children, initialSettings, onSettingsChange }) {
  const [marketReady, setMarketReady] = useState(!!initialSettings);
  const [prefs, setPrefs] = useState(parsePreferences(initialSettings?.preferences ?? DEFAULT_PREFERENCES)), [configuration, setConfiguration] = useState(initialSettings?.configuration ?? DEFAULT_CONFIGURATION), [settings, setSettings] = useState(initialSettings ?? null), [status, setStatus] = useState(initialSettings ? "synced" : "loading"), [error, setError] = useState(""), [theme, setTheme] = useState(() => initialSettings?.preferences.theme === "dark" ? "dark" : "light");
  useEffect(() => {
    if (settings) onSettingsChange?.(settings);
  }, [settings, onSettingsChange]);
  const prefsRef = useRef(prefs), configRef = useRef(configuration), settingsRef = useRef(settings), saving = useRef(false), generation = useRef(0);
  const apply = useCallback((input) => {
    const p = { ...input, numberFormat: "latin" };
    prefsRef.current = p;
    setPrefs(p);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(p));
      dispatchEvent(new Event("orin-ui-change"));
    } catch {
    }
  }, []);
  const receive = useCallback((s) => {
    settingsRef.current = s;
    setSettings(s);
    setMarketReady(true);
    configRef.current = s.configuration;
    setConfiguration(s.configuration);
    apply(s.preferences);
    setStatus("synced");
    setError("");
  }, [apply]);
  const reload = useCallback(async () => {
    if (saving.current) return;
    const seq = ++generation.current;
    try {
      const [configResponse, response] = await Promise.all([apiFetch("/api/markets/configuration", { cache: "no-store" }), apiFetch("/api/settings", { cache: "no-store" })]);
      const data = await response.json();
      if (seq !== generation.current || saving.current) return;
      if (configResponse.ok) {
        const configData = await configResponse.json();
        configRef.current = configData.configuration;
        setConfiguration(configData.configuration);
        setMarketReady(true);
      }
      if (response.status === 401) {
        settingsRef.current = null;
        setSettings(null);
        setStatus("guest");
        setError(configResponse.ok ? "" : "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0633\u0648\u0642 / Market configuration unavailable");
        apply(parsePreferences(prefsRef.current, configRef.current));
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "Settings unavailable");
      receive(data);
    } catch (e) {
      if (seq !== generation.current) return;
      setStatus("error");
      setError(e instanceof Error ? e.message : "Settings unavailable");
    }
  }, [apply, receive]);
  useEffect(() => {
    if (initialSettings) apply(initialSettings.preferences);
    else {
      try {
        apply(parsePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "{}")));
      } catch {
      }
      void reload();
    }
    const interval = setInterval(() => {
      if (!document.hidden && navigator.onLine) void reload();
    }, 6e4);
    const focus = () => {
      if (!document.hidden && navigator.onLine) void reload();
    };
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("focus", focus);
    return () => {
      generation.current++;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("focus", focus);
    };
  }, [apply, reload]);
  useEffect(() => {
    const storage = (event) => {
      if (event.key !== PREFERENCES_KEY || !event.newValue || settingsRef.current) return;
      try {
        const next = parsePreferences(JSON.parse(event.newValue), configRef.current);
        prefsRef.current = next;
        setPrefs(next);
      } catch {
      }
    };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const resolved = prefs.theme === "system" ? media.matches ? "dark" : "light" : prefs.theme;
      setTheme(resolved);
      const root = document.documentElement;
      root.dataset.theme = resolved;
      root.dataset.fontSize = prefs.fontSize;
      root.dataset.reduceMotion = String(prefs.reduceMotion);
      root.lang = prefs.chartLocale;
      root.dir = prefs.chartLocale === "ar" ? "rtl" : "ltr";
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [prefs.theme, prefs.chartLocale, prefs.fontSize, prefs.reduceMotion]);
  const save = async (body) => {
    if (saving.current || !settingsRef.current) {
      toast.info(translate(prefsRef.current.chartLocale, "\u0627\u0646\u062A\u0638\u0631 \u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u062D\u0633\u0627\u0628 \u0623\u0648 \u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644.", "Wait for account sync or sign in."));
      return false;
    }
    saving.current = true;
    generation.current++;
    setStatus("saving");
    setError("");
    try {
      const response = await apiFetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: settingsRef.current.revision, ...body }) }), data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Save failed");
      receive(data);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setStatus("error");
      setError(msg);
      toast.error(msg);
      return false;
    } finally {
      saving.current = false;
    }
  };
  const change = async (patch) => {
    if (status === "guest") {
      apply(parsePreferences({ ...prefsRef.current, ...patch }, configRef.current));
      return true;
    }
    const previous = prefsRef.current;
    apply(parsePreferences({ ...previous, ...patch }, configRef.current));
    const ok = await save({ preferences: patch });
    if (!ok) apply(previous);
    return ok;
  };
  const saveProfile = (profile, close = false) => save({ ...!close ? { profile } : {}, ...close ? { closeAccount: true } : {} });
  const saveConfiguration = async (c, revision) => {
    if (!settingsRef.current?.isAdmin || saving.current) return false;
    saving.current = true;
    generation.current++;
    setStatus("saving");
    try {
      const response = await apiFetch("/api/markets/configuration", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, configuration: c }) }), data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Save failed");
      configRef.current = data.configuration;
      setConfiguration(data.configuration);
      apply(parsePreferences(prefsRef.current, data.configuration));
      setSettings((old) => old ? { ...old, configuration: data.configuration, configurationRevision: data.configurationRevision } : old);
      if (settingsRef.current) settingsRef.current = { ...settingsRef.current, configuration: data.configuration, configurationRevision: data.configurationRevision };
      setStatus("synced");
      setError("");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setStatus("error");
      setError(msg);
      toast.error(msg);
      return false;
    } finally {
      saving.current = false;
    }
  };
  const t = (ar, en) => displayText(translate(prefs.chartLocale, ar, en));
  const number = (n, digits = 2) => new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  return /* @__PURE__ */ jsx(OrinContext.Provider, { value: { prefs, configuration, settings, status, error, marketReady, theme, t, change, saveProfile, saveConfiguration, reload, number }, children });
}
function useOrin() {
  const c = useContext(OrinContext);
  if (!c) throw new Error("OrinSettingsProvider is required");
  return c;
}

// app/balance-accounts.tsx
import { Fragment, jsx as jsx2, jsxs } from "react/jsx-runtime";
async function requestAccounts(method = "GET", input) {
  let timer;
  try {
    const response = await Promise.race([
      apiFetch("/api/trading-accounts", input ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("\u0627\u0646\u062A\u0647\u062A \u0645\u0647\u0644\u0629 \u0627\u0644\u0627\u062A\u0635\u0627\u0644. \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629\u061B \u0644\u0646 \u064A\u062A\u0643\u0631\u0631 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062D\u0633\u0627\u0628. / Connection timed out. Retry safely.")), 18e3);
      })
    ]);
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 403 ? "\u0645\u064A\u0632\u0629 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0628\u0639\u062F \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645. / Accounts are not available for this user yet." : data.error);
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function BalanceAccounts({ state, onHideBalance, onDirectoryChange, onAdjustDemo }) {
  const { prefs, t, number } = useOrin();
  const [directory, setDirectory] = useState2(state?.accountDirectory ?? null);
  const [open, setOpen] = useState2(false), [creating, setCreating] = useState2(false);
  const [kind, setKind] = useState2("real"), [busy, setBusy] = useState2(false), [error, setError] = useState2("");
  const ticket = useRef2(0), busyRef = useRef2(false), requestId = useRef2(null);
  const onChange = useRef2(onDirectoryChange);
  onChange.current = onDirectoryChange;
  const active = activeTradingAccount(directory), uid = state?.user.id;
  const label = (type) => type === "real" ? t("\u062D\u0633\u0627\u0628 \u062D\u0642\u064A\u0642\u064A", "Real account") : t("\u062D\u0633\u0627\u0628 \u062A\u062C\u0631\u064A\u0628\u064A", "Demo account");
  const save = useCallback2((next, phase = "confirmed") => {
    setDirectory(next);
    onChange.current?.(next, phase);
  }, []);
  const run = useCallback2(async (method = "GET", input) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const current = ++ticket.current;
    try {
      const next = await requestAccounts(method, input);
      if (current !== ticket.current) return null;
      save(next);
      return next;
    } catch (e) {
      if (current === ticket.current) setError(e instanceof Error ? e.message : "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A. / Accounts unavailable.");
      return null;
    } finally {
      if (current === ticket.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [save]);
  useEffect2(() => {
    if (state?.accountDirectory) setDirectory(state.accountDirectory);
  }, [state?.accountDirectory]);
  useEffect2(() => {
    if (uid) void run();
    return () => {
      ticket.current++;
      busyRef.current = false;
    };
  }, [uid, run]);
  const openList = (value) => {
    setOpen(value);
    if (value) {
      setCreating(false);
      void run();
    }
  };
  const balance = active ? active.balanceCents + active.reservedCents : state ? state.balanceCents + state.reservedCents : null;
  const realized = active?.realizedCents ?? state?.realizedCents;
  const create = async () => {
    if (!requestId.current) requestId.current = crypto.randomUUID();
    const next = await run("POST", { id: requestId.current, type: kind });
    if (next) {
      requestId.current = null;
      setCreating(false);
    }
  };
  const select = async (id) => {
    if (!directory || busyRef.current) return;
    if (directory.activeId === id) {
      setOpen(false);
      return;
    }
    const previous = directory;
    save({ ...directory, activeId: id }, "optimistic");
    setOpen(false);
    if (!await run("PATCH", { id })) {
      save(previous, "rollback");
      setOpen(true);
    }
  };
  const available = active?.balanceCents ?? state?.balanceCents;
  return /* @__PURE__ */ jsxs("section", { className: "balance-hero balance-hero-v3", children: [
    /* @__PURE__ */ jsx2("img", { src: "/brand/orin-mark.png", alt: "" }),
    /* @__PURE__ */ jsxs(Popover.Root, { open, onOpenChange: openList, modal: true, children: [
      /* @__PURE__ */ jsx2(Popover.Trigger, { asChild: true, children: /* @__PURE__ */ jsxs("button", { type: "button", className: "orin-account-strip", disabled: !uid, "aria-label": t("\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u062D\u0633\u0627\u0628", "Select account"), children: [
        active ? /* @__PURE__ */ jsx2(Fragment, { children: /* @__PURE__ */ jsxs("span", { className: "account-strip-copy", children: [
          /* @__PURE__ */ jsx2("b", { children: /* @__PURE__ */ jsx2("span", { className: "account-mode-badge " + active.type, children: active.type === "real" ? t("\u062D\u0642\u064A\u0642\u064A", "Real") : t("\u062A\u062C\u0631\u064A\u0628\u064A", "Demo") }) }),
          /* @__PURE__ */ jsxs("small", { children: [
            /* @__PURE__ */ jsx2("bdi", { children: active.currency }),
            " ",
            /* @__PURE__ */ jsx2("bdi", { className: "num", children: maskedAccountNumber(active.accountNumber) })
          ] })
        ] }) }) : /* @__PURE__ */ jsx2("span", { children: t("\u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A", "Accounts") }),
        /* @__PURE__ */ jsx2(ChevronDown, { size: 15, "aria-hidden": "true" })
      ] }) }),
      /* @__PURE__ */ jsx2(Popover.Portal, { children: /* @__PURE__ */ jsxs(Popover.Content, { className: "orin-accounts-menu", side: "bottom", align: "start", sideOffset: 6, collisionPadding: 12, dir: prefs.chartLocale === "ar" ? "rtl" : "ltr", "aria-label": t("\u062D\u0633\u0627\u0628\u0627\u062A\u064A", "My accounts"), children: [
        /* @__PURE__ */ jsxs("div", { className: "orin-accounts-heading", children: [
          /* @__PURE__ */ jsx2("strong", { children: t("\u062D\u0633\u0627\u0628\u0627\u062A\u064A", "My accounts") }),
          /* @__PURE__ */ jsx2(Popover.Close, { className: "orin-accounts-close", "aria-label": t("\u0625\u063A\u0644\u0627\u0642", "Close"), children: /* @__PURE__ */ jsx2(X, { size: 18 }) })
        ] }),
        /* @__PURE__ */ jsx2("div", { className: "orin-accounts-list", role: "group", "aria-label": t("\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0646\u0634\u0637", "Choose active account"), "aria-busy": busy, children: directory?.accounts.map((account) => /* @__PURE__ */ jsxs("button", { className: "orin-account-option", type: "button", "aria-pressed": directory.activeId === account.id, disabled: busy, onClick: () => void select(account.id), children: [
          /* @__PURE__ */ jsx2("span", { className: "orin-account-check", "aria-hidden": "true", children: directory.activeId === account.id && /* @__PURE__ */ jsx2(Check, { size: 18 }) }),
          /* @__PURE__ */ jsxs("span", { className: "orin-account-identity", children: [
            /* @__PURE__ */ jsx2("b", { children: label(account.type) }),
            /* @__PURE__ */ jsxs("bdi", { className: "num", children: [
              account.accountNumber,
              " \xB7 ",
              account.currency
            ] })
          ] }),
          /* @__PURE__ */ jsx2("bdi", { className: "orin-account-amount num", children: prefs.hideBalance ? "\u2022\u2022\u2022\u2022\u2022\u2022" : `${number((account.balanceCents + account.reservedCents) / 100)} ${account.currency}` })
        ] }, account.id)) }),
        error && /* @__PURE__ */ jsxs("div", { className: "orin-account-error", role: "alert", children: [
          /* @__PURE__ */ jsx2("p", { children: error }),
          /* @__PURE__ */ jsx2("button", { type: "button", disabled: busy, onClick: () => void run(), children: t("\u0625\u0639\u0627\u062F\u0629 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A", "Reload accounts") })
        ] }),
        busy && /* @__PURE__ */ jsx2("p", { className: "orin-account-status", role: "status", children: t("\u062C\u0627\u0631 \u062D\u0641\u0638 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u0623\u0648 \u062A\u062D\u062F\u064A\u062B\u0647\u0627\u2026", "Saving or updating accounts\u2026") }),
        !creating ? /* @__PURE__ */ jsxs("button", { type: "button", className: "orin-account-add", disabled: busy || !directory, onClick: () => {
          setCreating(true);
          setError("");
        }, children: [
          /* @__PURE__ */ jsx2(Plus, { size: 17 }),
          t("\u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628 \u062C\u062F\u064A\u062F", "Create new account")
        ] }) : /* @__PURE__ */ jsxs("form", { className: "orin-account-create", onSubmit: (e) => {
          e.preventDefault();
          void create();
        }, children: [
          /* @__PURE__ */ jsxs("fieldset", { disabled: busy, children: [
            /* @__PURE__ */ jsx2("legend", { children: t("\u0646\u0648\u0639 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062C\u062F\u064A\u062F", "New account type") }),
            ["real", "demo"].map((type) => /* @__PURE__ */ jsxs("label", { children: [
              /* @__PURE__ */ jsx2("input", { type: "radio", name: "orin-new-account-kind", value: type, checked: kind === type, onChange: () => {
                setKind(type);
                requestId.current = null;
              } }),
              label(type)
            ] }, type))
          ] }),
          /* @__PURE__ */ jsxs("p", { children: [
            t("\u0627\u0644\u0639\u0645\u0644\u0629", "Currency"),
            ": ",
            /* @__PURE__ */ jsx2("bdi", { children: "USD" })
          ] }),
          kind === "real" && /* @__PURE__ */ jsx2("small", { children: t("\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u0627 \u064A\u0641\u0639\u0651\u0644 \u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0623\u0648 \u0627\u0644\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u062D\u0627\u0644\u064A\u064B\u0627.", "Creating an account does not currently enable real deposits or trading.") }),
          /* @__PURE__ */ jsxs("div", { className: "orin-account-create-actions", children: [
            /* @__PURE__ */ jsx2("button", { type: "submit", disabled: busy, children: t("\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062D\u0633\u0627\u0628", "Create account") }),
            /* @__PURE__ */ jsx2("button", { type: "button", disabled: busy, onClick: () => setCreating(false), children: t("\u0625\u0644\u063A\u0627\u0621", "Cancel") })
          ] })
        ] })
      ] }) })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "balance-top", children: [
      /* @__PURE__ */ jsx2("span", { children: t("\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0631\u0635\u064A\u062F", "Total balance") }),
      /* @__PURE__ */ jsx2("button", { "aria-label": prefs.hideBalance ? t("\u0625\u0638\u0647\u0627\u0631 \u0627\u0644\u0631\u0635\u064A\u062F", "Show balance") : t("\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u0631\u0635\u064A\u062F", "Hide balance"), onClick: onHideBalance, children: prefs.hideBalance ? /* @__PURE__ */ jsx2(EyeOff, {}) : /* @__PURE__ */ jsx2(Eye, {}) })
    ] }),
    /* @__PURE__ */ jsx2("strong", { className: "balance-total num", children: prefs.hideBalance ? "\u2022\u2022\u2022\u2022\u2022\u2022" : balance === null ? "$ \u2014" : `$${number(balance / 100)}` }),
    /* @__PURE__ */ jsxs("div", { className: "balance-bottom", children: [
      /* @__PURE__ */ jsx2("span", { className: `num ${(realized ?? 0) < 0 ? "loss" : "gain"}`, children: prefs.hideBalance ? "\u2022\u2022\u2022\u2022" : realized === void 0 ? "\u2014" : `${realized >= 0 ? "+" : ""}${number(realized / 100)} USD` }),
      /* @__PURE__ */ jsx2("small", { children: t("\u0635\u0627\u0641\u064A \u0627\u0644\u0646\u062A\u0627\u0626\u062C", "Net results") })
    ] }),
    /* @__PURE__ */ jsx2("div", { className: "balance-brand-caption", "aria-hidden": "true", children: "Trade Beyond Limits" }),
    /* @__PURE__ */ jsxs("div", { className: "balance-available" + (active?.type === "demo" ? " demo-balance-available" : ""), children: [
      /* @__PURE__ */ jsx2(Coins, { size: 23 }),
      /* @__PURE__ */ jsxs("span", { children: [
        /* @__PURE__ */ jsx2("small", { children: t("\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D", "Available balance") }),
        /* @__PURE__ */ jsx2("bdi", { className: "num", children: prefs.hideBalance ? "\u2022\u2022\u2022\u2022\u2022\u2022" : available === void 0 ? "$ \u2014" : `$${number(available / 100)}` })
      ] }),
      active?.type === "demo" && /* @__PURE__ */ jsxs("button", { type: "button", className: "demo-adjust-button", onClick: onAdjustDemo, children: [
        /* @__PURE__ */ jsx2(Settings2, { size: 16 }),
        t("\u0636\u0628\u0637 \u0627\u0644\u0631\u0635\u064A\u062F", "Set balance")
      ] })
    ] })
  ] });
}
export {
  BalanceAccounts,
  CAPABILITIES,
  DEFAULT_CONFIGURATION,
  DEFAULT_PREFERENCES,
  OrinSettingsProvider,
  mergeSupportMessages,
  readSupportAssistantResponse,
  supportAgentOnline,
  supportTransport
};
