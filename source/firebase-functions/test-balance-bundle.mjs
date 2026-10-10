// src/store.ts
import { FieldValue } from "firebase-admin/firestore";
import { createHash, randomUUID } from "node:crypto";

// src/firebase-admin-init.ts
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
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
  return initializeApp({ projectId: "orin-99951" });
}
var adminApp = getAdminApp();
var adminDb = getFirestore(adminApp);
var adminAuth = getAuth(adminApp);

// ../lib/market-symbols.ts
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

// ../lib/preferences.ts
var TIMEFRAMES = ["1", "5", "15", "60", "240", "D"];
var CHART_TYPES = ["1", "2", "3"];
var INDICATORS = ["MA", "EMA", "RSI", "MACD", "BB"];
var NOTICE_EVENTS = ["opportunity", "contract_started", "contract_ended", "settlement", "deposit", "withdrawal", "referral", "agent", "support", "security", "announcement", "reminder"];
var CAPABILITIES = Object.freeze({ provider: "tradingview-widget", indicators: true, drawings: false, saveDrawings: false, priceAlerts: false, quoteTelemetry: false, inPlaceUpdates: false, crosshairControl: false, priceLineControl: false, push: false, email: false, sms: false, password: false, totp: false, passkeys: false, biometrics: false, recoveryCodes: false, sessionManagement: false });
var DEFAULT_CONFIGURATION = { defaultSymbol: "BTC-USD", enabledSymbols: MARKET_SYMBOLS.map((s) => s.pair), defaultTimeframe: "15", enabledTimeframes: [...TIMEFRAMES], defaultChartType: "1", enabledChartTypes: [...CHART_TYPES], allowedIndicators: [...INDICATORS], allowedDrawingTools: [], volume: false, gridDefault: true, crosshairDefault: true, fullscreen: true, alerts: false, favorites: true };
var DEFAULT_PREFERENCES = { hideBalance: false, notifications: true, reduceMotion: false, notificationSounds: false, opportunitySound: true, securitySound: true, vibration: false, marketingNotifications: false, chartLocale: "ar", theme: "light", fontSize: "normal", numberFormat: "latin", referenceCurrency: "USD", timezone: "Etc/UTC", chartPair: "BTC-USD", chartInterval: "15", chartStyle: "1", grid: true, crosshair: true, priceLine: true, saveDrawings: false, indicators: [], favorites: [], notificationEvents: Object.fromEntries(NOTICE_EVENTS.map((k) => [k, true])), notificationChannels: { push: false, email: false, sms: false } };

// src/account-security.ts
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
var SESSION_LIFE = 30 * 864e5;
var CHALLENGE_LIFE = 5 * 6e4;

// src/store.ts
var OWNER = "khtaub7341@gmail.com";
var ApiError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var hash = (text2) => createHash("sha256").update(text2).digest("hex");
var id = () => randomUUID();
var ref = (collection, key5) => adminDb.collection(collection).doc(key5);
var account = (uid) => ref("orinAccounts", uid);
var owner = (u) => u.verified && u.email === OWNER;
function active(profile, u, admin = false) {
  if (!profile || profile.uid !== u.id || profile.email !== u.email || profile.disabled) throw new ApiError("\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D.", 403);
  if (admin && !(u.verified && (profile.role === "admin" || owner(u)))) throw new ApiError("\u0647\u0630\u0647 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0644\u0644\u0625\u062F\u0627\u0631\u0629 \u0641\u0642\u0637.", 403);
  return profile;
}
async function check(tx, u, admin = false, financial = false) {
  const [p, access, revoked] = await Promise.all([tx.get(ref("users", u.id)), tx.get(ref("orinControlAccess", u.id)), tx.get(ref("orinControlSessionRevocations", u.id))]);
  if (u.securitySessionId) {
    const [sessionDoc, securityDoc] = await Promise.all([tx.get(ref("orinSecuritySessions", u.securitySessionId)), tx.get(ref("orinAccountSecurity", u.id))]);
    const session = sessionDoc.data();
    if (!session || session.uid !== u.id || session.status !== "active" || session.expiresAtMs <= Date.now() || session.epoch !== (securityDoc.data()?.epoch ?? 0)) throw new ApiError("\u062A\u0645 \u0625\u0628\u0637\u0627\u0644 \u062C\u0644\u0633\u0629 ORIN.", 401);
  }
  const profile = active(p.data(), u);
  if (access.data()?.status === "suspended" || financial && access.data()?.status === "restricted") throw new ApiError("Account restricted", 403);
  if (revoked.exists && (!u.authTime || u.authTime * 1e3 <= revoked.data().validAfter)) throw new ApiError("Session revoked", 401);
  if (financial && (await tx.get(ref("orinControlConfiguration", "current"))).data()?.maintenance) throw new ApiError("Maintenance", 503);
  if (admin && (await tx.get(ref("system", "control-center"))).exists) {
    const staff = (await tx.get(ref("orinStaff", u.id))).data();
    if (!u.verified || staff?.status !== "active" || !staff.roles?.includes("super_admin") || staff.email !== u.email || staff.validAfter && (!u.authTime || u.authTime * 1e3 <= staff.validAfter)) throw new ApiError("Control Center authorization required", 403);
    return profile;
  }
  return active(profile, u, admin);
}
function journal(tx, key5, uid, kind, reference, entries, effective, now) {
  if (entries.some(([, v]) => !Number.isSafeInteger(v)) || entries.reduce((s, [, v]) => s + v, 0) !== 0) throw new ApiError("\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0642\u064A\u062F \u0627\u0644\u062D\u0633\u0627\u0628.", 409);
  tx.create(ref("orinJournals", key5), { id: key5, user_id: uid, kind, reference, effective_at: effective, created_at: now, status: "posted", entries: entries.filter(([, n]) => n !== 0).map(([account2, amount_cents], i) => ({ id: `${key5}:${i}`, journal_id: key5, account: account2, amount_cents, kind, effective_at: effective })) });
}
function audit(tx, key5, actor, action, reference, data, now) {
  const payload = JSON.stringify(data);
  tx.create(ref("orinAudit", key5), { id: key5, actor_id: actor, action, reference, payload, payload_hash: hash(payload), created_at: now });
}
function notice(tx, key5, uid, title, message, contractId, now, extra = {}) {
  tx.create(ref("orinNotices", key5), { id: key5, user_id: uid, title, message, contract_id: contractId, created_at: now, eligibility: "all", category: "", deep_link: contractId ? `/contracts/${contractId}` : "/notifications", expires_at: null, image: null, ...extra });
}
async function bootstrap(u, now = Date.now()) {
  await adminDb.runTransaction(async (tx) => {
    const p = await check(tx, u);
    const a = await tx.get(account(u.id));
    if (a.exists) return;
    tx.create(account(u.id), { id: u.id, name: p.displayName, tier: "standard", accepted_at: null, seen_at: 0, preferences: DEFAULT_PREFERENCES, profile: { displayName: p.displayName, phone: "", country: "", closureStatus: "open" }, revision: 0, created_at: now, updated_at: now });
    audit(tx, `account:${u.id}`, u.id, "ACCOUNT_CREATED", u.id, {}, now);
  });
}

// ../lib/contracts.ts
var ASSETS = { XAUUSD: "\u0627\u0644\u0630\u0647\u0628 / \u0627\u0644\u062F\u0648\u0644\u0627\u0631", BTCUSD: "\u0628\u064A\u062A\u0643\u0648\u064A\u0646 / \u0627\u0644\u062F\u0648\u0644\u0627\u0631", ETHUSD: "\u0625\u064A\u062B\u0631\u064A\u0648\u0645 / \u0627\u0644\u062F\u0648\u0644\u0627\u0631" };
function resultCents(amount, bps) {
  return Math.sign(bps) * Math.round(amount * Math.abs(bps) / 1e4);
}

// ../lib/orin-routes.ts
var allowed = /^\/(?:$|markets(?:\/(?:favorites|[A-Z0-9]{2,12}-[A-Z0-9]{2,12}))?$|trade(?:\/(?:indicators|drawings|alerts))?$|positions$|settings(?:\/(?:account|appearance|security|notifications|chart|about|admin|language|devices|privacy|documents|support|referral|agent|two-factor|authenticator|data|kyc))?$|notifications(?:\/[A-Za-z0-9:_-]+)?$|admin(?:\/(?:dashboard|notifications|audit|users|content|requests|contracts|programs|kyc|accounts|wallets|deposits|withdrawals|approvals|trading|markets|bonus|referrals|team|agencies|badges|configuration|security|staff|tickets))?$|activity$|transfer$|deposit$|withdraw$|documents$|privacy$|terms$|kyc$|account\/security$|support$|referral(?:\/tree)?$|badges$|bonus$|agent$|invitations$|contracts\/[A-Za-z0-9:_-]+(?:\/(?:confirm|success))?$|transactions\/[A-Za-z0-9:_-]+$|announcements\/[A-Za-z0-9:_-]+$)/;
function safeDestination(value) {
  if (typeof value !== "string" || value.length > 300) return "/notifications";
  let path;
  try {
    path = decodeURIComponent(value);
  } catch {
    return "/notifications";
  }
  if (!allowed.test(path)) return "/notifications";
  return path;
}

// ../lib/notification-model.ts
var NOTICE_CATEGORIES = ["opportunity", "financial", "security", "announcement", "reminder", "referral", "support"];
function noticeCategory(n) {
  if (NOTICE_CATEGORIES.includes(n.category)) return n.category;
  if (n.id.startsWith("settle:")) return "financial";
  if (n.id.startsWith("start:") || n.id.startsWith("end:")) return "reminder";
  return "opportunity";
}
function noticeDestination(n) {
  return n.deep_link ? safeDestination(n.deep_link) : n.contract_id ? "/contracts/" + encodeURIComponent(n.contract_id) : "/notifications";
}

// src/notifications.ts
function visible(n, a, uid, now) {
  if (n.user_id !== uid && !(n.user_id === "*" && (n.eligibility === "all" || n.eligibility === a.tier))) return false;
  if (n.created_at > now || n.expires_at !== null && n.expires_at <= now) return false;
  const event = n.category || (n.id.startsWith("settle:") ? "settlement" : n.id.startsWith("start:") ? "contract_started" : n.id.startsWith("end:") ? "contract_ended" : "opportunity");
  return event === "security" || a.preferences.notificationEvents?.[event] !== false && (event !== "announcement" || a.preferences.marketingNotifications === true);
}
async function inbox(u, now = Date.now(), offset = 0, key5) {
  await bootstrap(u, now);
  const [a, rows, reads] = await Promise.all([account(u.id).get(), adminDb.collection("orinNotices").where("user_id", "in", [u.id, "*"]).get(), account(u.id).collection("reads").get()]);
  const profile = a.data(), read = new Map(reads.docs.map((d) => [d.id, d.data().read_at]));
  const items = rows.docs.map((d) => d.data()).filter((n) => visible(n, profile, u.id, now)).sort((a2, b) => b.created_at - a2.created_at || b.id.localeCompare(a2.id)).map((n) => ({ ...n, id: n.id, read_at: read.get(n.id) ?? (n.created_at <= profile.seen_at ? profile.seen_at : null), category: noticeCategory(n), deep_link: noticeDestination(n) }));
  return { items: key5 ? items.filter((n) => n.id === key5) : items.slice(offset, offset + 50), unreadCount: items.filter((n) => n.read_at === null).length, total: items.length, serverTime: now, pushAvailable: false };
}

// src/contracts.ts
async function resolveTradingDoc(tx, uid, preferredId, isSettle = false) {
  let accountId = typeof preferredId === "string" && preferredId.trim() ? preferredId.trim() : "";
  if (isSettle) {
    if (!accountId) throw new ApiError("\u0645\u0639\u0631\u0641 \u062D\u0633\u0627\u0628 \u0627\u0644\u062A\u062F\u0627\u0648\u0644 \u0645\u0637\u0644\u0648\u0628 \u0644\u0644\u062A\u0633\u0648\u064A\u0629.", 409);
  } else if (!accountId) {
    const selection = await tx.get(ref("sparkAccountSelections", uid));
    if (selection.exists && selection.data()?.accountId) accountId = selection.data().accountId;
  }
  if (!accountId) throw new ApiError("\u062D\u0633\u0627\u0628 \u0627\u0644\u062A\u062F\u0627\u0648\u0644 \u063A\u064A\u0631 \u0645\u062D\u062F\u062F.", 409);
  const tradingRef = adminDb.doc(`sparkTradingAccounts/${uid}/accounts/${accountId}`);
  const tradingDoc = await tx.get(tradingRef);
  if (!tradingDoc.exists || tradingDoc.data()?.type !== "real") throw new ApiError("\u062D\u0633\u0627\u0628 \u062A\u062F\u0627\u0648\u0644 \u062D\u0642\u064A\u0642\u064A \u0645\u0637\u0644\u0648\u0628.", 409);
  return { id: accountId, ref: tradingRef, snap: tradingDoc };
}
async function publish(u, input, now = Date.now()) {
  const title = typeof input.title === "string" ? input.title.trim() : "", asset = input.asset, direction = input.direction, duration = Number(input.durationSec), bps = Number(input.settlementBps), opensAt = Number(input.opensAt), closesAt = Number(input.closesAt), eligibility = input.eligibility ?? "all";
  if (!title || title.length > 80 || !Object.hasOwn(ASSETS, asset) || !["BUY", "SELL"].includes(direction)) throw new ApiError("\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u0642\u062F \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.");
  if (!Number.isInteger(duration) || duration < 60 || duration > 300 || !Number.isInteger(bps) || Math.abs(bps) > 1e3) throw new ApiError("\u0627\u0644\u0645\u062F\u0629 60\u2013300 \u062B\u0627\u0646\u064A\u0629 \u0648\u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0645\u0646 \u200E-10% \u0625\u0644\u0649 \u200E+10%.");
  if (!["all", "standard", "advanced"].includes(eligibility) || !Number.isSafeInteger(opensAt) || !Number.isSafeInteger(closesAt) || opensAt < now - 6e4 || closesAt <= Math.max(now, opensAt) || closesAt - opensAt > 30 * 864e5) throw new ApiError("\u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0623\u0648 \u0627\u0644\u0623\u0647\u0644\u064A\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.");
  const key5 = id(), code = `LAB-${id().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const terms = { version: 1, mode: "production", id: key5, code, title, asset, direction, durationSec: duration, settlementBps: bps, eligibility, opensAt, closesAt, publishedAt: now, adminId: u.id }, canonical2 = JSON.stringify(terms), digest2 = hash(canonical2);
  await adminDb.runTransaction(async (tx) => {
    await check(tx, u, true);
    const existing = await tx.get(ref("orinCodes", code));
    if (existing.exists) throw new ApiError("\u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0644\u0625\u0646\u0634\u0627\u0621 \u0643\u0648\u062F \u062C\u062F\u064A\u062F.", 409);
    tx.create(ref("orinContracts", key5), { id: key5, code, title, asset, direction, duration_sec: duration, settlement_bps: bps, eligibility, opens_at: opensAt, closes_at: closesAt, published_at: now, admin_id: u.id, canonical: canonical2, hash: digest2, participants: 0 });
    tx.create(ref("orinCodes", code), { contractId: key5 });
    tx.set(ref("orinControlContractStates", key5), { status: "active", revision: 0, updatedAt: now, updatedBy: u.id }, { merge: true });
    audit(tx, `publish:${key5}`, u.id, "CONTRACT_PUBLISHED_AND_LOCKED", key5, { terms, sha256: digest2 }, now);
    notice(tx, `publish:${key5}`, "*", "\u062F\u0639\u0648\u0629 \u062C\u062F\u064A\u062F\u0629 \u0645\u0646 ORIN", `${title} \xB7 \u0627\u0644\u0643\u0648\u062F ${code}`, key5, now, { eligibility });
  });
  return { id: key5, code, hash: digest2 };
}
function integrity(c) {
  if (hash(c.canonical) !== c.hash) throw new ApiError("\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0633\u0644\u0627\u0645\u0629 \u0627\u0644\u0639\u0642\u062F.", 409);
}
async function verify(u, value, now = Date.now()) {
  await bootstrap(u, now);
  if (typeof value !== "string") throw new ApiError("\u0643\u0648\u062F \u0627\u0644\u062F\u0639\u0648\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.");
  const formattedCode = value.trim().toUpperCase();
  if (!formattedCode || formattedCode.length < 3 || formattedCode.length > 40) throw new ApiError("\u0643\u0648\u062F \u0627\u0644\u062F\u0639\u0648\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.");
  const candidates = [formattedCode];
  if (!formattedCode.startsWith("LAB-")) candidates.push(`LAB-${formattedCode}`);
  let c = null;
  for (const candidate of candidates) {
    const codeDoc = await ref("orinCodes", candidate).get();
    let contractId = codeDoc.exists ? codeDoc.data()?.contractId : null;
    if (contractId) {
      const cDoc = await ref("orinContracts", contractId).get();
      if (cDoc.exists) c = cDoc.data();
    }
    if (!c) {
      const snap = await adminDb.collection("orinContracts").where("code", "==", candidate).limit(1).get();
      if (!snap.empty) c = snap.docs[0].data();
    }
    if (c) break;
  }
  if (!c) throw new ApiError("\u0644\u0627 \u062A\u0648\u062C\u062F \u062F\u0639\u0648\u0629 \u0645\u062A\u0627\u062D\u0629 \u0644\u062D\u0633\u0627\u0628\u0643 \u0628\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F.", 404);
  const a = (await account(u.id).get()).data() ?? { tier: "standard" };
  const p = (await ref("users", u.id).get()).data();
  const isAdmin = u.verified && (p?.role === "admin" || owner(u));
  const userTier = a.tier || "standard";
  if (c.eligibility !== "all" && c.eligibility !== userTier && !isAdmin) throw new ApiError("\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0645\u062E\u0635\u0635 \u0644\u0641\u0626\u0629 \u062D\u0633\u0627\u0628\u0627\u062A \u0623\u062E\u0631\u0649.", 403);
  const stateDoc = await ref("orinControlContractStates", c.id).get();
  if (stateDoc.exists && stateDoc.data()?.status === "revoked") throw new ApiError("\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F.", 409);
  integrity(c);
  return { contract: c, serverTime: now };
}
async function join(u, input, now = Date.now()) {
  await bootstrap(u, now);
  const rawCode = String(input.code ?? "").trim().toUpperCase(), amount = Number(input.amountCents);
  if (!rawCode || rawCode.length < 3 || rawCode.length > 40 || !Number.isSafeInteger(amount) || amount < 100 || amount > 1e8 || input.confirmed !== true) throw new ApiError("\u0631\u0627\u062C\u0639 \u0627\u0644\u0645\u0628\u0644\u063A \u0648\u0623\u0643\u0651\u062F \u0634\u0631\u0648\u0637 \u0627\u0644\u062D\u0633\u0627\u0628.");
  return adminDb.runTransaction(async (tx) => {
    await check(tx, u, false, true);
    const trading = await resolveTradingDoc(tx, u.id, input.accountId);
    const tradingData = trading.snap?.exists ? trading.snap.data() : { balanceCents: 0, reservedCents: 0, realizedCents: 0 };
    const currentBalance = tradingData.balanceCents ?? 0;
    const accDoc = await tx.get(account(u.id));
    const a = accDoc.data() ?? { tier: "standard", profile: { closureStatus: "open" }, accepted_at: now };
    const candidates = [rawCode];
    if (!rawCode.startsWith("LAB-")) candidates.push(`LAB-${rawCode}`);
    let c = null;
    for (const candidate of candidates) {
      const lookup = await tx.get(ref("orinCodes", candidate));
      let contractId = lookup.exists ? lookup.data().contractId : null;
      if (contractId) {
        const cDoc = await tx.get(ref("orinContracts", contractId));
        if (cDoc.exists) c = cDoc.data();
      }
      if (!c) {
        const snap = await tx.get(adminDb.collection("orinContracts").where("code", "==", candidate).limit(1));
        if (!snap.empty) c = snap.docs[0].data();
      }
      if (c) break;
    }
    if (!c) throw new ApiError("\u0627\u0644\u062F\u0639\u0648\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0644\u062D\u0633\u0627\u0628\u0643.", 404);
    const contractState = (await tx.get(ref("orinControlContractStates", c.id))).data();
    if (contractState?.status === "revoked") throw new ApiError("\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F.", 409);
    const p = (await tx.get(ref("users", u.id))).data();
    const isAdmin = u.verified && (p?.role === "admin" || owner(u));
    const userTier = a.tier || "standard";
    if (c.eligibility !== "all" && c.eligibility !== userTier && !isAdmin) throw new ApiError("\u0627\u0644\u062F\u0639\u0648\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0644\u0641\u0626\u0629 \u062D\u0633\u0627\u0628\u0643.", 404);
    if (a.profile?.closureStatus === "requested") throw new ApiError("\u0627\u0644\u062D\u0633\u0627\u0628 \u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u0625\u063A\u0644\u0627\u0642.", 403);
    integrity(c);
    if (input.contractHash !== c.hash) throw new ApiError("\u0631\u0627\u062C\u0639 \u0634\u0631\u0648\u0637 \u0627\u0644\u0639\u0642\u062F \u0627\u0644\u062D\u0627\u0644\u064A\u0629.", 409);
    const key5 = hash(`position:${u.id}:${c.id}`), previous = await tx.get(ref("orinPositions", key5));
    if (previous.exists) {
      if (previous.data().amount_cents !== amount) throw new ApiError("\u0633\u0628\u0642 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0628\u0645\u0628\u0644\u063A \u0645\u062E\u062A\u0644\u0641.", 409);
      return { id: key5, reused: true };
    }
    if (now < c.opens_at || now >= c.closes_at) throw new ApiError("\u0627\u0644\u0639\u0642\u062F \u062E\u0627\u0631\u062C \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629.", 409);
    if (currentBalance < amount) throw new ApiError("\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D \u063A\u064A\u0631 \u0643\u0627\u0641\u064D \u0644\u0647\u0630\u0627 \u0627\u0644\u0639\u0642\u062F. \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u062D\u0627\u0644\u064A: " + (currentBalance / 100).toFixed(2) + " USD", 409);
    const counterRef = ref("orinContractCounts", c.id), count = (await tx.get(counterRef)).data()?.count ?? 0;
    const endsAt = now + c.duration_sec * 1e3, pnl = resultCents(amount, c.settlement_bps);
    tx.create(ref("orinPositions", key5), { id: key5, user_id: u.id, contract_id: c.id, account_id: trading.id, amount_cents: amount, result_cents: pnl, started_at: now, ends_at: endsAt, status: "active", settled_at: null, contract: c });
    tx.set(trading.ref, { balanceCents: currentBalance - amount, reservedCents: (tradingData.reservedCents ?? 0) + amount, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (!a.accepted_at) {
      tx.set(account(u.id), { accepted_at: now }, { merge: true });
    }
    tx.set(counterRef, { count: count + 1 });
    journal(tx, `allocate:${key5}`, u.id, "allocation", key5, [[`user:${u.id}:cash`, -amount], [`user:${u.id}:reserved`, amount]], now, now);
    audit(tx, `join:${key5}`, u.id, "AMOUNT_ALLOCATED", key5, { contractId: c.id, contractHash: c.hash, amountCents: amount, startedAt: now, endsAt, accountId: trading.id }, now);
    notice(tx, `start:${key5}`, u.id, "\u0628\u062F\u0623 \u0627\u0644\u0639\u0642\u062F", `${c.title}`, c.id, now);
    return { id: key5, reused: false };
  });
}
async function settle(u, now = Date.now()) {
  const due = await adminDb.collection("orinPositions").where("user_id", "==", u.id).where("status", "==", "active").get();
  for (const row of due.docs) {
    if (row.data().ends_at > now) continue;
    await adminDb.runTransaction(async (tx) => {
      await check(tx, u);
      const p = (await tx.get(row.ref)).data();
      if (!p || p.status !== "active" || p.ends_at > now) return;
      const trading = await resolveTradingDoc(tx, u.id, p.account_id, true);
      const a = trading.snap?.exists ? trading.snap.data() : { balanceCents: 0, reservedCents: 0, realizedCents: 0 };
      const c = (await tx.get(ref("orinContracts", p.contract_id))).data();
      if (!c) throw new ApiError("\u0627\u0644\u0639\u0642\u062F \u063A\u064A\u0631 \u0645\u062A\u0627\u062D.", 409);
      integrity(c);
      const expected = resultCents(p.amount_cents, c.settlement_bps);
      if (expected !== p.result_cents || (a.reservedCents ?? 0) < p.amount_cents) throw new ApiError("\u062A\u0639\u0627\u0631\u0636 \u0641\u064A \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u0633\u0648\u064A\u0629.", 409);
      const receipt = { version: 1, mode: "production", receiptId: `R-${p.id.slice(0, 12).toUpperCase()}`, contractId: c.id, contractCode: c.code, contractHash: c.hash, positionId: p.id, asset: c.asset, direction: c.direction, amountCents: p.amount_cents, durationSec: c.duration_sec, lockedSettlementBps: c.settlement_bps, startedAt: p.started_at, endsAt: p.ends_at, effectiveAt: p.ends_at, processedAt: now, resultCents: expected, returnedCents: p.amount_cents + expected, settlement: "executed-contract-settlement" }, payload = JSON.stringify(receipt), digest2 = hash(payload), jid = `settle:${p.id}`;
      tx.update(trading.ref, { balanceCents: (a.balanceCents ?? 0) + p.amount_cents + expected, reservedCents: (a.reservedCents ?? 0) - p.amount_cents, realizedCents: (a.realizedCents ?? 0) + expected, updatedAt: FieldValue.serverTimestamp() });
      tx.update(row.ref, { status: "settled", settled_at: now });
      journal(tx, jid, u.id, "settlement", p.id, [[`user:${u.id}:reserved`, -p.amount_cents], [`user:${u.id}:cash`, p.amount_cents + expected], ["system:trading-pnl", -expected]], p.ends_at, now);
      tx.create(ref("orinReceipts", `receipt:${p.id}`), { id: `receipt:${p.id}`, position_id: p.id, user_id: u.id, payload, hash: digest2, created_at: now });
      audit(tx, jid, "settlement-engine", "CONTRACT_SETTLED", p.id, { contractId: c.id, contractHash: c.hash, resultCents: expected, effectiveAt: p.ends_at, processedAt: now, receiptHash: digest2 }, now);
      notice(tx, `end:${p.id}`, u.id, "\u0627\u0646\u062A\u0647\u062A \u0645\u062F\u0629 \u0627\u0644\u0639\u0642\u062F", `${c.title} \xB7 \u0627\u0643\u062A\u0645\u0644\u062A \u0645\u062F\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629`, c.id, p.ends_at);
      notice(tx, jid, u.id, "\u0627\u0643\u062A\u0645\u0644\u062A \u0627\u0644\u062A\u0633\u0648\u064A\u0629", `${c.title} \xB7 \u0627\u0644\u0646\u062A\u064A\u062C\u0629 ${expected >= 0 ? "+" : ""}${(expected / 100).toFixed(2)} \u062F\u0648\u0644\u0627\u0631`, c.id, now);
    });
  }
}
async function state(u, now = Date.now()) {
  await bootstrap(u, now);
  const [a, p, cs, ps, rs, js, feed, selection, accountsSnap] = await Promise.all([account(u.id).get(), ref("users", u.id).get(), adminDb.collection("orinContracts").orderBy("published_at", "desc").limit(100).get(), adminDb.collection("orinPositions").where("user_id", "==", u.id).get(), adminDb.collection("orinReceipts").where("user_id", "==", u.id).get(), adminDb.collection("orinJournals").where("user_id", "==", u.id).get(), inbox(u, now), ref("sparkAccountSelections", u.id).get(), adminDb.collection(`sparkTradingAccounts/${u.id}/accounts`).get()]);
  const user = active(p.data(), u), data = a.data(), isAdmin = u.verified && (user.role === "admin" || owner(u));
  let activeAccount = null;
  const selectedId = selection.data()?.accountId;
  if (selectedId) {
    const match = accountsSnap.docs.find((d) => d.id === selectedId);
    if (match) activeAccount = match.data();
  }
  if (!activeAccount) {
    const realMatch = accountsSnap.docs.find((d) => d.data().type === "real");
    if (realMatch) activeAccount = realMatch.data();
    else if (!accountsSnap.empty) activeAccount = accountsSnap.docs[0].data();
  }
  const balanceCents = activeAccount?.balanceCents ?? 0, reservedCents = activeAccount?.reservedCents ?? 0, realizedCents = activeAccount?.realizedCents ?? 0;
  const positions = ps.docs.map((d) => d.data()).sort((a2, b) => b.started_at - a2.started_at).slice(0, 100);
  const counts = cs.size ? await adminDb.getAll(...cs.docs.map((d) => ref("orinContractCounts", d.id))) : [];
  const contracts = cs.docs.map((d, i) => ({ ...d.data(), participants: counts[i]?.data()?.count ?? 0 })).filter((c) => isAdmin || c.eligibility === "all" || c.eligibility === data.tier);
  const audits = isAdmin ? (await adminDb.collection("orinAudit").orderBy("created_at", "desc").limit(100).get()).docs.map((d) => d.data()) : [];
  return { serverTime: now, user: { id: u.id, name: user.displayName, tier: data.tier, accepted_at: data.accepted_at, seen_at: data.seen_at }, isAdmin, balanceCents, reservedCents, realizedCents, contracts, positions, notifications: feed.items, receipts: rs.docs.map((d) => d.data()).sort((a2, b) => b.created_at - a2.created_at).slice(0, 100), ledger: js.docs.flatMap((d) => d.data().entries).sort((a2, b) => b.effective_at - a2.effective_at).slice(0, 300), audit: audits };
}

// src/program-ingestion.ts
var key = (s) => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(s)) throw new ApiError("Invalid trusted event id");
  return s;
};
var validMoney = (n) => Number.isSafeInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 4;
async function recordConfirmedDeposit(e) {
  key(e.eventId);
  key(e.uid);
  key(e.accountId);
  if (e.currency !== "USD" || !validMoney(e.cents) || e.cents === 0 || typeof e.eligible !== "boolean") throw new ApiError("Invalid confirmed deposit");
  await adminDb.runTransaction(async (tx) => {
    const event = ref("orinTrustedEvents", e.eventId), a = adminDb.doc(`sparkTradingAccounts/${e.uid}/accounts/${e.accountId}`), b = ref("orinBonusWallets", e.uid), fund = ref("orinQualifiedDeposits", e.uid), m = ref("orinProgramMembers", e.uid);
    const [old, acc, bonus, first, member2, profile, access] = await Promise.all([tx.get(event), tx.get(a), tx.get(b), tx.get(fund), tx.get(m), tx.get(ref("users", e.uid)), tx.get(ref("orinControlAccess", e.uid))]);
    const fingerprint = hash(JSON.stringify(e));
    if (old.exists) {
      if (old.data().fingerprint !== fingerprint) throw new ApiError("Event conflict", 409);
      return;
    }
    if (!profile.exists || profile.data().disabled || access.data()?.status === "suspended") throw new ApiError("Funding account restricted", 409);
    const data = acc.data();
    if (!data || data.ownerId !== e.uid || data.type !== "real" || data.currency !== "USD" || !validMoney(data.balanceCents + e.cents)) throw new ApiError("Invalid funding account", 409);
    tx.update(a, { balanceCents: data.balanceCents + e.cents });
    if (e.eligible && (!first.exists || e.cents > first.data().cents)) {
      tx.set(fund, { uid: e.uid, eventId: e.eventId, cents: e.cents, accountId: e.accountId });
      if (bonus.exists) tx.update(b, { qualifiedDepositCents: e.cents, withdrawableProfitCents: e.cents >= (bonus.data().firstDepositCents ?? 5e4) ? bonus.data().profitCents : 0 });
    }
    if (member2.exists) tx.update(m, { badges: [.../* @__PURE__ */ new Set([...member2.data().badges ?? [], "first_deposit"])] });
    tx.create(event, { ...e, fingerprint, type: "deposit", status: "confirmed" });
    tx.create(ref("orinProgramLedger", "deposit-" + e.eventId), { uid: e.uid, accountId: e.accountId, kind: "deposit", entries: [{ account: "cash", cents: e.cents }, { account: "payment-clearing", cents: -e.cents }], createdAt: Date.now() });
    audit(tx, "trusted-" + e.eventId, "provider", "DEPOSIT_CONFIRMED", e.uid, { eventId: e.eventId, cents: e.cents, accountId: e.accountId }, Date.now());
  });
}

// ../lib/control-center.ts
var PERMISSIONS = {
  "support.ai.read": "\u0639\u0631\u0636 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062F\u0639\u0645 \u0627\u0644\u0630\u0643\u064A",
  "support.ai.configure": "\u0625\u0639\u062F\u0627\u062F \u0648\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062F\u0639\u0645 \u0627\u0644\u0630\u0643\u064A",
  "support.knowledge.manage": "\u062A\u062D\u0631\u064A\u0631 \u0645\u0639\u0631\u0641\u0629 \u0627\u0644\u062F\u0639\u0645",
  "support.knowledge.publish": "\u0645\u0631\u0627\u062C\u0639\u0629 \u0648\u0646\u0634\u0631 \u0645\u0639\u0631\u0641\u0629 \u0627\u0644\u062F\u0639\u0645",
  "dashboard.read": "\u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062A",
  "users.read": "\u0639\u0631\u0636 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646 \u0648\u0627\u0644\u0628\u062D\u062B",
  "users.manage": "\u062A\u0642\u064A\u064A\u062F \u0648\u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646",
  "kyc.read": "\u0639\u0631\u0636 \u0637\u0644\u0628\u0627\u062A \u0627\u0644\u0647\u0648\u064A\u0629",
  "kyc.documents": "\u0639\u0631\u0636 \u0648\u062B\u0627\u0626\u0642 \u0627\u0644\u0647\u0648\u064A\u0629 \u0627\u0644\u062E\u0627\u0635\u0629",
  "kyc.review": "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0647\u0648\u064A\u0629",
  "accounts.read": "\u0639\u0631\u0636 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A",
  "accounts.manage": "\u0625\u0646\u0634\u0627\u0621 \u0648\u062A\u0639\u0644\u064A\u0642 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A",
  "wallet.read": "\u0639\u0631\u0636 \u0627\u0644\u0623\u0631\u0635\u062F\u0629 \u0627\u0644\u0645\u0641\u0635\u0651\u0644\u0629",
  "finance.read": "\u0639\u0631\u0636 \u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A \u0627\u0644\u0645\u0627\u0644\u064A\u0629",
  "finance.propose": "\u0627\u0642\u062A\u0631\u0627\u062D \u062A\u0633\u0648\u064A\u0629 \u0645\u0627\u0644\u064A\u0629",
  "finance.approve": "\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u0645\u0627\u0644\u064A\u0629 \u0627\u0644\u062B\u0627\u0646\u064A\u0629",
  "trading.read": "\u0639\u0631\u0636 \u0646\u0634\u0627\u0637 \u0627\u0644\u062A\u062F\u0627\u0648\u0644",
  "contracts.manage": "\u0625\u0646\u0634\u0627\u0621 \u0648\u0625\u064A\u0642\u0627\u0641 \u0623\u0643\u0648\u0627\u062F \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u062F\u0627\u062E\u0644\u064A\u0629",
  "markets.manage": "\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0623\u0633\u0648\u0627\u0642 \u0648\u0627\u0644\u062A\u062F\u0627\u0648\u0644",
  "programs.read": "\u0639\u0631\u0636 \u0627\u0644\u0628\u0631\u0627\u0645\u062C \u0648\u0627\u0644\u0645\u0643\u0627\u0641\u0622\u062A",
  "programs.configure": "\u0625\u0635\u062F\u0627\u0631 \u0634\u0631\u0648\u0637 \u0627\u0644\u0628\u0631\u0627\u0645\u062C",
  "referrals.review": "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0625\u062D\u0627\u0644\u0627\u062A",
  "agencies.manage": "\u0627\u0639\u062A\u0645\u0627\u062F \u0648\u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u0648\u0643\u0644\u0627\u0621",
  "badges.grant": "\u0645\u0646\u062D \u0627\u0644\u0634\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u0648\u062B\u0642",
  "notifications.manage": "\u062A\u062D\u0631\u064A\u0631 \u0648\u062C\u062F\u0648\u0644\u0629 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A",
  "content.manage": "\u062A\u062D\u0631\u064A\u0631 \u0648\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u0645\u062D\u062A\u0648\u0649",
  "content.publish": "\u0646\u0634\u0631 \u0627\u0644\u0645\u062D\u062A\u0648\u0649",
  "configuration.manage": "\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0648\u0627\u0644\u0635\u064A\u0627\u0646\u0629",
  "security.read": "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0623\u062D\u062F\u0627\u062B \u0627\u0644\u0623\u0645\u0646\u064A\u0629",
  "security.revoke": "\u0625\u0628\u0637\u0627\u0644 \u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645",
  "staff.manage": "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0648\u0638\u0641\u064A\u0646 \u0648\u0627\u0644\u0623\u062F\u0648\u0627\u0631",
  "audit.read": "\u0642\u0631\u0627\u0621\u0629 \u0633\u062C\u0644 \u0627\u0644\u062A\u062F\u0642\u064A\u0642",
  "reports.export": "\u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0633\u0645\u0648\u062D \u0628\u0647\u0627",
  "tickets.read": "\u0639\u0631\u0636 \u062A\u0630\u0627\u0643\u0631 \u0627\u0644\u062F\u0639\u0645",
  "tickets.manage": "\u0625\u0646\u0634\u0627\u0621 \u0648\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u062A\u0630\u0627\u0643\u0631 \u0648\u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A",
  "tickets.assign": "\u0625\u0633\u0646\u0627\u062F \u0627\u0644\u062A\u0630\u0627\u0643\u0631 \u0625\u0644\u0649 \u0627\u0644\u0645\u0648\u0638\u0641\u064A\u0646"
};
var ROLES = {
  super_admin: { name: "Super Admin", permissions: Object.keys(PERMISSIONS) },
  finance: { name: "Finance", permissions: ["dashboard.read", "users.read", "accounts.read", "wallet.read", "finance.read", "finance.propose", "programs.read", "reports.export"] },
  finance_approver: { name: "Finance Approver", permissions: ["dashboard.read", "users.read", "accounts.read", "wallet.read", "finance.read", "finance.approve", "programs.read", "audit.read", "reports.export"] },
  kyc_reviewer: { name: "KYC Reviewer", permissions: ["dashboard.read", "users.read", "kyc.read", "kyc.documents", "kyc.review"] },
  support: { name: "Support", permissions: ["support.ai.read", "dashboard.read", "users.read", "accounts.read", "tickets.read", "tickets.manage"] },
  operations: { name: "Operations", permissions: ["support.ai.read", "tickets.read", "tickets.manage", "tickets.assign", "dashboard.read", "users.read", "users.manage", "accounts.read", "accounts.manage", "trading.read", "contracts.manage", "markets.manage", "programs.read", "referrals.review", "agencies.manage", "badges.grant", "notifications.manage", "reports.export"] },
  content_manager: { name: "Content Manager", permissions: ["support.ai.read", "support.knowledge.manage", "support.knowledge.publish", "dashboard.read", "content.manage", "content.publish", "notifications.manage"] },
  auditor: { name: "Auditor", permissions: ["support.ai.read", "tickets.read", "dashboard.read", "users.read", "accounts.read", "wallet.read", "finance.read", "trading.read", "programs.read", "audit.read", "security.read", "reports.export"] }
};
function permissionsFor(roles) {
  if (!Array.isArray(roles) || roles.some((r) => typeof r !== "string" || !Object.hasOwn(ROLES, r)))
    return [];
  return [...new Set(roles.flatMap((r) => ROLES[r].permissions))];
}
var CONTROL_DEFAULTS = { maintenance: false, messageAr: "\u0635\u064A\u0627\u0646\u0629 \u0645\u0624\u0642\u062A\u0629\u060C \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0644\u0627\u062D\u0642\u064B\u0627.", messageEn: "Scheduled maintenance. Please try again later.", minimumVersionCode: 1, supportEmail: "", supportUrl: "", tradingEnabled: false, depositsEnabled: false, withdrawalsEnabled: false, referralsEnabled: false, bonusEnabled: false, maxAdjustmentCents: null };
var ACTION_PERMISSIONS = { "contract.create": "contracts.manage", "contract.revoke": "contracts.manage", "ticket.create": "tickets.manage", "ticket.update": "tickets.manage", "ticket.note": "tickets.manage", "user.status": "users.manage", "kyc.review": "kyc.review", "account.create": "accounts.manage", "account.status": "accounts.manage", "reward.propose": "finance.propose", "finance.propose": "finance.propose", "finance.approve": "finance.approve", "finance.reject": "finance.approve", "payment.review": "finance.propose", "referral.review": "referrals.review", "agency.set": "agencies.manage", "badge.grant": "badges.grant", "content.save": "content.manage", "content.publish": "content.publish", "notification.save": "notifications.manage", "notification.publish": "notifications.manage", "market.save": "markets.manage", "configuration.save": "configuration.manage", "program.configure": "programs.configure", "staff.set": "staff.manage", "staff.invite": "staff.manage", "security.revoke": "security.revoke" };

// src/control-auth.ts
var controlRef = (kind, id2) => ref("orinControl" + kind, id2);
async function requirePermission(u, permission, tx, recent = false) {
  const read = (r) => tx ? tx.get(r) : r.get();
  const [p, s, gate, revocation] = await Promise.all([read(ref("users", u.id)), read(ref("orinStaff", u.id)), read(controlRef("Access", u.id)), read(controlRef("SessionRevocations", u.id))]);
  const isSuperAdmin = p.exists && p.data()?.role === "admin" || u.email === "khtaub7341@gmail.com" || u.email === "khtaub99@gmail.com" || u.email === "mm@mm.mm";
  const staffData = s.exists && s.data()?.status === "active" ? s.data() : isSuperAdmin ? { email: u.email, roles: ["super_admin"], status: "active", revision: 1 } : null;
  if (!p.exists || p.data().disabled || gate.data()?.status === "suspended" || !staffData || !permissionsFor(staffData.roles).includes(permission))
    throw new ApiError("\u0644\u0627 \u062A\u0645\u0644\u0643 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629. / Permission denied.", 403);
  if (revocation.exists && (!u.authTime || u.authTime * 1e3 <= revocation.data().validAfter))
    throw new ApiError("Admin session revoked", 401);
  return staffData;
}
function controlAudit(tx, id2, u, action, target, reason, before, after, referenceId) {
  tx.create(controlRef("Audit", id2), { adminId: u.id, action, target, timestamp: Date.now(), reason, previous: before ?? null, next: after ?? null, requestId: referenceId, referenceId, payloadHash: hash(JSON.stringify({ action, target, before, after, referenceId })) });
}
async function controlAccess(u, financial = false, tx) {
  const read = (r) => tx ? tx.get(r) : r.get();
  const [a, c, p] = await Promise.all([read(controlRef("Access", u.id)), read(controlRef("Configuration", "current")), read(ref("users", u.id))]);
  if (!p.exists || p.data()?.disabled || a.data()?.status === "suspended" || financial && a.data()?.status === "restricted")
    throw new ApiError("\u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0642\u064A\u0651\u062F. / Account restricted.", 403);
  if (financial && c.data()?.maintenance)
    throw new ApiError("\u0627\u0644\u062E\u062F\u0645\u0629 \u0641\u064A \u0648\u0636\u0639 \u0627\u0644\u0635\u064A\u0627\u0646\u0629. / Maintenance.", 503);
}
async function controlAccount(uid, id2, tx) {
  const r = controlRef("AccountStates", hash(uid + ":" + id2)), s = await (tx ? tx.get(r) : r.get());
  if (s.data()?.status === "restricted")
    throw new ApiError("\u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0627\u0644\u064A \u0645\u0642\u064A\u0651\u062F. / Trading account restricted.", 403);
}

// src/nowpayments.ts
import { createHmac, timingSafeEqual } from "node:crypto";
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key5, item]) => [key5, canonical(item)]));
  return value;
}
function validIpn(body, signature, secret2) {
  if (!secret2 || !body || typeof body !== "object" || Array.isArray(body) || !/^[a-fA-F0-9]{128}$/.test(signature)) return false;
  const expected = createHmac("sha512", secret2).update(JSON.stringify(canonical(body))).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
function providerId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new ApiError("Invalid payment identifier", 502);
  const result = String(value ?? "");
  if (!/^[0-9]{1,30}$/.test(result)) throw new ApiError("Invalid payment identifier", 502);
  return result;
}
function units(value, decimals = 18) {
  const text2 = String(value ?? "");
  if (!/^\d{1,20}(\.\d{1,18})?$/.test(text2)) throw new ApiError("Invalid provider amount", 502);
  const [whole, fraction = ""] = text2.split(".");
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) throw new ApiError("Invalid amount precision", 502);
  return BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0"));
}
var NowPayments = class {
  constructor(apiKey, callback, requester = fetch) {
    this.apiKey = apiKey;
    this.callback = callback;
    this.requester = requester;
  }
  async request(path, body) {
    if (!this.apiKey) throw new ApiError("\u062E\u062F\u0645\u0629 \u0627\u0644\u062F\u0641\u0639 \u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0625\u0639\u062F\u0627\u062F \u0627\u0644\u062E\u0627\u062F\u0645.", 503);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12e3);
    try {
      const response = await this.requester("https://api.nowpayments.io/v1" + path, { method: body ? "POST" : "GET", headers: { "x-api-key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" }, ...body ? { body: JSON.stringify(body) } : {}, signal: controller.signal, redirect: "error" });
      if (!response.ok) throw new ApiError(response.status === 400 ? "\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062F\u0641\u0639\u061B \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0639\u0645\u0644\u0629 \u0648\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 \u0644\u062F\u0649 \u0627\u0644\u0645\u0632\u0648\u062F." : "\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0645\u0632\u0648\u062F \u0627\u0644\u062F\u0641\u0639. \u062A\u062D\u0642\u0642 \u0645\u0646 \u062D\u0627\u0644\u0629 \u0627\u0644\u0637\u0644\u0628 \u0642\u0628\u0644 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.", response.status === 400 ? 422 : 503);
      if (!response.headers.get("content-type")?.includes("application/json")) throw new ApiError("\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0645\u0632\u0648\u062F \u0627\u0644\u062F\u0641\u0639 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.", 502);
      const result = await response.json();
      if (!result || Array.isArray(result) || typeof result !== "object") throw new ApiError("\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0645\u0632\u0648\u062F \u0627\u0644\u062F\u0641\u0639 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.", 502);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
  create(orderId, amountCents, coin) {
    return this.request("/payment", { price_amount: amountCents / 100, price_currency: "usd", pay_currency: coin, order_id: orderId, order_description: "ORIN account deposit", ipn_callback_url: this.callback, is_fixed_rate: false, is_fee_paid_by_user: false });
  }
  get(id2) {
    return this.request("/payment/" + providerId(id2));
  }
};

// ../lib/payments.ts
var PAYMENT_COINS = [
  { id: "usdttrc20", label: "USDT", network: "TRON \xB7 TRC20" },
  { id: "usdtbsc", label: "USDT", network: "BNB Smart Chain \xB7 BEP20" },
  { id: "btc", label: "BTC", network: "Bitcoin" },
  { id: "eth", label: "ETH", network: "Ethereum \xB7 ERC20" }
];

// src/payments.ts
var safeId = (value) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new ApiError("\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.");
  return value;
};
var depositView = (d) => ({ id: d.id, accountId: d.accountId, amountCents: d.amountCents, coin: d.coin, status: d.status, paymentId: d.paymentId ?? null, address: d.address ?? null, payAmount: d.payAmount ?? null, extraId: d.extraId ?? null, credited: !!d.credited, createdAt: d.createdAt });
var states = /* @__PURE__ */ new Set(["waiting", "confirming", "confirmed", "sending", "finished", "partially_paid", "failed", "refunded", "expired"]);
function paymentService(provider, ipnSecret) {
  async function create(u, input) {
    const accountId = safeId(input.accountId), requestId = safeId(input.requestId), amountCents = input.amountCents, coin = input.coin;
    if (Object.keys(input).some((k) => !["accountId", "requestId", "amountCents", "coin"].includes(k)) || !Number.isSafeInteger(amountCents) || amountCents < 1e5 || amountCents > 1e7 || !PAYMENT_COINS.some((c) => c.id === coin)) throw new ApiError("\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 \u0644\u0644\u0625\u064A\u062F\u0627\u0639 1,000 \u062F\u0648\u0644\u0627\u0631 \u0623\u0645\u0631\u064A\u0643\u064A. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0645\u0628\u0644\u063A \u0648\u0627\u0644\u0639\u0645\u0644\u0629.");
    const id2 = "np-" + hash(u.id + ":" + requestId), r = ref("orinDeposits", id2), fingerprint = hash(JSON.stringify({ accountId, amountCents, coin })), now = Date.now();
    const existing = await adminDb.runTransaction(async (tx) => {
      await check(tx, u);
      await controlAccess(u, true, tx);
      await controlAccount(u.id, accountId, tx);
      const configuration = (await tx.get(ref("orinControlConfiguration", "current"))).data();
      if (configuration && configuration.depositsEnabled !== true) throw new ApiError("Deposit service disabled", 409);
      const [old, account2, access, rate] = await Promise.all([tx.get(r), tx.get(adminDb.doc(`sparkTradingAccounts/${u.id}/accounts/${accountId}`)), tx.get(ref("orinControlAccess", u.id)), tx.get(ref("orinDepositRateLimits", u.id))]);
      if (access.data()?.status === "suspended") throw new ApiError("\u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0648\u0642\u0648\u0641.", 403);
      const a = account2.data();
      if (!a || a.ownerId !== u.id || a.type !== "real" || a.currency !== "USD") throw new ApiError("\u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0645\u062A\u0627\u062D \u0644\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0641\u0642\u0637.", 403);
      if (old.exists) {
        if (old.data().fingerprint !== fingerprint) throw new ApiError("\u062A\u063A\u064A\u0651\u0631\u062A \u062A\u0641\u0627\u0635\u064A\u0644 \u0637\u0644\u0628 \u0627\u0644\u062F\u0641\u0639. \u0627\u0641\u062A\u062D \u0637\u0644\u0628\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627.", 409);
        return old.data();
      }
      const recent = (rate.data()?.times ?? []).filter((t) => t > now - 18e5);
      if (recent.length >= 5) throw new ApiError("\u062A\u0648\u062C\u062F \u0637\u0644\u0628\u0627\u062A \u062F\u0641\u0639 \u062D\u062F\u064A\u062B\u0629. \u0631\u0627\u062C\u0639 \u0633\u062C\u0644 \u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0642\u0628\u0644 \u0625\u0646\u0634\u0627\u0621 \u0637\u0644\u0628 \u0622\u062E\u0631.", 429);
      const d = { id: id2, uid: u.id, accountId, amountCents, coin, fingerprint, status: "creating", createdAt: now, updatedAt: now, credited: false };
      tx.create(r, d);
      tx.set(ref("orinDepositRateLimits", u.id), { times: [...recent, now] });
      audit(tx, "create-" + id2, u.id, "DEPOSIT_REQUESTED", id2, { accountId, amountCents, coin }, now);
      return null;
    });
    if (existing) return depositView(existing);
    try {
      const payment = await provider.create(id2, amountCents, coin);
      await reconcile(id2, payment, false);
    } catch (error) {
      await adminDb.runTransaction(async (tx) => {
        const d = (await tx.get(r)).data();
        if (d?.status === "creating") tx.update(r, { status: "review", updatedAt: Date.now() });
      });
      console.error("ORIN payment create failed", { orderId: id2, code: error instanceof ApiError ? error.status : "network" });
    }
    return depositView((await r.get()).data());
  }
  async function reconcile(id2, payment, allowCredit = true) {
    const r = ref("orinDeposits", safeId(id2)), d = (await r.get()).data();
    if (!d) throw new ApiError("Unknown payment order", 404);
    const pid = providerId(payment.payment_id);
    if (payment.order_id !== id2 || payment.price_currency !== "usd" || payment.pay_currency !== d.coin || units(payment.price_amount, 2) !== BigInt(d.amountCents) || d.paymentId && pid !== d.paymentId || payment.parent_payment_id) throw new ApiError("Payment does not match the stored order", 409);
    const status = states.has(payment.payment_status) ? payment.payment_status : "review";
    if (typeof payment.pay_address !== "string" || !/^[a-zA-Z0-9:_-]{12,256}$/.test(payment.pay_address) || units(payment.pay_amount) <= BigInt(0)) throw new ApiError("Invalid payment destination", 502);
    const extra = payment.payin_extra_id ?? null;
    if (extra !== null && (typeof extra !== "string" || extra.length > 128)) throw new ApiError("Invalid payment memo", 502);
    await adminDb.runTransaction(async (tx) => {
      const [fresh, owner2] = await Promise.all([tx.get(r), tx.get(ref("orinPaymentIds", pid))]);
      const cur = fresh.data();
      if (owner2.exists && owner2.data().orderId !== id2 || cur.paymentId && cur.paymentId !== pid) throw new ApiError("Payment identity conflict", 409);
      const reversal = cur.credited && ["refunded", "failed", "partially_paid"].includes(status);
      const issue = ref("orinPaymentReviews", pid), previousIssue = reversal ? await tx.get(issue) : null;
      tx.set(ref("orinPaymentIds", pid), { orderId: id2 });
      if (reversal && !previousIssue?.exists) {
        tx.create(issue, { orderId: id2, uid: cur.uid, accountId: cur.accountId, reason: "provider_reversal_after_credit", providerStatus: status, createdAt: Date.now(), resolved: false });
        audit(tx, "payment-review-" + pid, "provider", "PAYMENT_REVIEW_REQUIRED", id2, { paymentId: pid, status }, Date.now());
      }
      tx.update(r, { paymentId: pid, address: payment.pay_address, payAmount: String(payment.pay_amount), extraId: extra, status: reversal ? "review" : cur.credited ? "finished" : status, updatedAt: Date.now() });
    });
    if (allowCredit && status === "finished") {
      const [profile, access] = await Promise.all([ref("users", d.uid).get(), ref("orinControlAccess", d.uid).get()]);
      const expected = units(payment.pay_amount);
      let paid;
      try {
        paid = payment.actually_paid != null ? units(payment.actually_paid) : payment.amount_received != null ? units(payment.amount_received) : expected;
      } catch {
        paid = expected;
      }
      if (paid * 1000n < expected * 995n || profile.data()?.disabled || access.data()?.status === "suspended") {
        await adminDb.runTransaction(async (tx) => {
          const fresh = (await tx.get(r)).data();
          if (!fresh.credited) tx.update(r, { status: "review", reviewReason: paid * 1000n < expected * 995n ? "amount_mismatch" : "account_restricted" });
        });
        return;
      }
      const creditedCents = Math.min(d.amountCents, Math.floor(Number(BigInt(d.amountCents) * paid / expected)));
      await recordConfirmedDeposit({ eventId: "nowpayments-" + pid, uid: d.uid, accountId: d.accountId, currency: "USD", cents: creditedCents, eligible: true });
      await r.update({ status: "finished", credited: true, creditedCents, updatedAt: Date.now() });
    }
  }
  async function get(u, id2, refresh = false) {
    const r = ref("orinDeposits", safeId(id2)), d = (await r.get()).data();
    if (!d || d.uid !== u.id) throw new ApiError("\u0637\u0644\u0628 \u0627\u0644\u062F\u0641\u0639 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D.", 404);
    if (refresh && d.paymentId && !d.credited) {
      const permitted = await adminDb.runTransaction(async (tx) => {
        const current = (await tx.get(r)).data();
        if ((current.refreshAfter ?? 0) > Date.now()) return false;
        tx.update(r, { refreshAfter: Date.now() + 2e4 });
        return true;
      });
      if (permitted) await reconcile(id2, await provider.get(d.paymentId));
    }
    return depositView((await r.get()).data());
  }
  async function list(u, accountId) {
    safeId(accountId);
    const account2 = (await adminDb.doc(`sparkTradingAccounts/${u.id}/accounts/${accountId}`).get()).data();
    if (!account2 || account2.ownerId !== u.id) throw new ApiError("\u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D.", 404);
    const result = await adminDb.collection("orinDeposits").where("uid", "==", u.id).where("accountId", "==", accountId).limit(50).get();
    return result.docs.map((d) => depositView(d.data())).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  }
  async function webhook(body, signature) {
    if (!validIpn(body, signature, ipnSecret)) throw new ApiError("Invalid payment notification signature", 401);
    const id2 = safeId(body.order_id);
    if (!id2.startsWith("np-")) throw new ApiError("Unknown payment order", 404);
    const current = await provider.get(providerId(body.payment_id));
    if (providerId(current.payment_id) !== providerId(body.payment_id)) throw new ApiError("Payment identity mismatch", 409);
    await reconcile(id2, current);
    return { ok: true };
  }
  return { create, get, list, webhook };
}

// src/support-admin.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";

// ../lib/support-ai-control.ts
var SUPPORTED_GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
var SUPPORT_AI_DEFAULTS = { enabled: false, provider: "gemini", model: "gemini-2.0-flash", maxTokensPerReply: 700, dailyTokenBudget: 5e4, systemInstructions: "" };
var SUPPORT_AI_CONFIG_FIELDS = Object.keys(SUPPORT_AI_DEFAULTS);
var secret = /\bAIza[0-9A-Za-z_-]{20,}|\bsk-[0-9A-Za-z_-]{16,}|-----BEGIN[^\n]*PRIVATE KEY|otpauth:\/\//i;
function validateSupportText(value, max, empty = false) {
  if (typeof value !== "string" || value.length > max || !empty && !value.trim() || secret.test(value)) throw new Error("\u0646\u0635 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u064A\u062A\u0636\u0645\u0646 \u0628\u064A\u0627\u0646\u0627\u062A \u0633\u0631\u064A\u0629. / Invalid or sensitive text.");
  return value.trim();
}
function parseSupportAIConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid assistant settings.");
  const d = raw;
  if (Object.keys(d).some((key5) => !SUPPORT_AI_CONFIG_FIELDS.includes(key5))) throw new Error("Only approved assistant settings are editable.");
  const c = { ...SUPPORT_AI_DEFAULTS, ...d };
  if (typeof c.enabled !== "boolean" || !["gemini", "openai-compatible"].includes(c.provider) || typeof c.model !== "string" || !/^[A-Za-z0-9_.:/-]{1,160}$/.test(c.model)) throw new Error("Invalid provider or model.");
  if (c.provider === "gemini" && !SUPPORTED_GEMINI_MODELS.includes(c.model)) throw new Error("The Gemini model is not approved for this deployment.");
  if (!Number.isSafeInteger(c.maxTokensPerReply) || Number(c.maxTokensPerReply) < 128 || Number(c.maxTokensPerReply) > 2048 || !Number.isSafeInteger(c.dailyTokenBudget) || Number(c.dailyTokenBudget) < 1e3 || Number(c.dailyTokenBudget) > 1e6 || Number(c.dailyTokenBudget) < Number(c.maxTokensPerReply)) throw new Error("Reply limit 128\u20132048; daily budget 1,000\u20131,000,000 tokens and at least one reply.");
  return { ...c, systemInstructions: validateSupportText(c.systemInstructions, 1500, true) };
}

// ../lib/support-knowledge.ts
var SUPPORT_KNOWLEDGE = [
  { id: "scope", title: "ORIN support scope", content: "ORIN support explains how to use this application. It cannot execute trades, change balances, approve payments, recover passwords, verify identity, remove restrictions or promise a financial return. Those actions require the relevant authenticated application workflow or an authorized human. Never request passwords, PINs, OTPs, recovery codes, seed phrases or private keys." },
  { id: "accounts", title: "Real and demo accounts", content: "Switch accounts from the account selector inside the existing home balance card. The green badge \u062D\u0642\u064A\u0642\u064A identifies real accounts. The orange badge \u062A\u062C\u0631\u064A\u0628\u064A identifies simulated funds. Demo money is separate from real money and cannot be withdrawn. Account switching should preserve the app session without a page reload." },
  { id: "demo", title: "Demo balance and transfers", content: "Only demo accounts show \u0636\u0628\u0637 \u0627\u0644\u0631\u0635\u064A\u062F. The user can set a USD demo balance; setting it replaces the demo total, assigns it to the futures pocket and clears the perpetual pocket. Demo transfer moves existing simulated funds between futures and perpetual pockets without changing their total. Adjustment and transfer are blocked when a contract has reserved funds. Demo deposit/withdraw actions are disabled. A support message never authorizes an adjustment." },
  { id: "real-transfers", title: "Real financial operations", content: "The shipped Spark client does not provide a real futures/perpetual transfer or execution engine. A visible account or transfer screen is not evidence that real trading, deposits, withdrawals or ORIN Pay settlement are enabled. Only the actual authenticated payment or trading screen and trusted backend can establish availability. Do not supply a payment address, promise activation, invent a transaction status or tell a user to send funds outside an approved in-app payment instruction." },
  { id: "market", title: "Market card and charts", content: "The market card shows source data for the selected asset. The small chart uses closed historical 15-minute candles covering 24 hours; it is intentionally calm and not a live-tick animation. Kraken, Bitstamp or Coinbase may provide supported crypto/USD history. A missing or interrupted feed is a data-connection issue, not proof of a zero price. TradingView is the separate main chart. Support must not change its settings or invent missing chart points." },
  { id: "positions", title: "Positions and activity", content: "\u0627\u0644\u0645\u0631\u0627\u0643\u0632 displays open and closed internal contracts, search and contract details. These are not automatically exchange futures orders. Recent transactions and account statements are reached through settings/activity. A statement must reflect recorded entries. For a disputed result or missing payment, ask for the non-secret transaction reference and hand the conversation to support." },
  { id: "settings", title: "Settings and language", content: "Settings contain profile, appearance/language, notifications, security, chart preferences and account activity. Arabic, English, Turkish and German interface translations are supported. Changing interface language does not change a financial account currency or convert balances. Profile updates apply to the signed-in account." },
  { id: "security", title: "Account security workflows", content: "Security features must be read from the actual security screen. A compiled screen is not proof that a server service is deployed. ORIN app lock, when configured on Android, uses a device PIN or system biometric prompt; support never collects either. TOTP is enabled only after a successful first verification. Recovery codes are single-use. Passkey private keys stay with the device/credential provider. Session location, if shown from IP, is approximate, not GPS. Never claim to have ended a session or changed security from chat." },
  { id: "referral", title: "Invitations", content: "\u062F\u0639\u0648\u0629 \u0635\u062F\u064A\u0642 opens the referral page with the user\u2019s own code/link and actual recorded referral activity when available. A referral code can be supplied in the optional registration field. A code or invitation does not guarantee a reward; reward eligibility and amounts depend on the published program terms and verified backend records. Do not fabricate invited-user counts or reward balances." },
  { id: "support", title: "Messages and human assistance", content: "Support messages are saved to the signed-in user\u2019s own conversation. The conversation menu offers \u0637\u0644\u0628 \u0645\u062A\u0627\u0628\u0639\u0629 \u0645\u0646 \u0645\u0648\u0638\u0641. A requested handoff does not mean a person is online or that a response time is guaranteed. Adam is ORIN\u2019s automated support assistant, presented as Adam from ORIN support. He answers transparently about being automated when asked and never pretends to be a human. A reply exists only after a real model answers successfully. If the model is unavailable, the original user message remains saved and the conversation can be handed to the team." }
];

// src/support-assistant-provider.ts
var SupportModelError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
};
function assistantConfiguration(env) {
  if (env.ORIN_SUPPORT_AI_ENABLED !== "true") return null;
  const provider = env.ORIN_SUPPORT_AI_PROVIDER === "gemini" ? "gemini" : "openai-compatible", model = env.ORIN_SUPPORT_AI_MODEL ?? (provider === "gemini" ? "gemini-2.0-flash" : "");
  const maxTokens = Math.max(128, Math.min(2048, Number(env.ORIN_SUPPORT_AI_MAX_TOKENS) || 700));
  if (provider === "gemini") {
    if (!env.ORIN_SUPPORT_AI_API_KEY) return null;
    if (!SUPPORTED_GEMINI_MODELS.includes(model)) throw new SupportModelError("model_configuration_invalid");
    return { provider, endpoint: "https://generativelanguage.googleapis.com/v1beta/models/" + model, model, token: env.ORIN_SUPPORT_AI_API_KEY, maxTokens };
  }
  if (!env.ORIN_SUPPORT_AI_ENDPOINT || !model) return null;
  let url;
  try {
    url = new URL(env.ORIN_SUPPORT_AI_ENDPOINT);
  } catch {
    throw new SupportModelError("model_configuration_invalid");
  }
  const allowed2 = (env.ORIN_SUPPORT_AI_ALLOWED_ORIGINS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/v1/chat/completions") || !allowed2.includes(url.origin) || /^(localhost|127\.|0\.|169\.254\.|\[)/i.test(url.hostname)) throw new SupportModelError("model_endpoint_not_allowed");
  if (!/^[A-Za-z0-9_./:-]{1,160}$/.test(model)) throw new SupportModelError("model_configuration_invalid");
  return { provider, endpoint: url.href, model, token: env.ORIN_SUPPORT_AI_TOKEN ?? "", maxTokens };
}
function outputSchema(ids) {
  return { type: "object", additionalProperties: false, required: ["text", "handoff", "scope", "citationIds"], properties: { text: { type: "string", maxLength: 2e3 }, handoff: { type: "boolean" }, scope: { type: "string", enum: ["application", "outside"] }, citationIds: { type: "array", maxItems: 12, items: { type: "string", enum: ids } } } };
}
var ASSISTANT_OUTPUT_SCHEMA = outputSchema(SUPPORT_KNOWLEDGE.map((d) => d.id));

// src/support-admin.ts
function validateSupportConfiguration(raw) {
  try {
    return parseSupportAIConfig(raw);
  } catch (error) {
    throw new ApiError(error.message, 400);
  }
}
var key2 = (v) => {
  if (typeof v !== "string" || !/^[-A-Za-z0-9_]{1,128}$/.test(v)) throw new ApiError("Invalid identifier");
  return v;
};
var documentId = (v) => {
  if (typeof v !== "string" || !/^[a-z0-9_-]{1,80}$/.test(v)) throw new ApiError("Use a knowledge ID of 1\u201380 lowercase letters, digits, _ or -.");
  return v;
};
var bounded = (v, max, empty = false) => {
  try {
    return validateSupportText(v, max, empty);
  } catch (error) {
    throw new ApiError(error.message, 400);
  }
};
var only = (d, fields) => {
  if (Object.keys(d).some((k) => !fields.includes(k))) throw new ApiError("Unsupported support field");
};
var safe = (value) => value?.toMillis ? value.toMillis() : Array.isArray(value) ? value.map(safe) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safe(v)])) : value;
var pick = (d, fields) => Object.fromEntries(fields.filter((k) => d[k] !== void 0).map((k) => [k, safe(d[k])]));
var summary = (d) => d ? { revision: d.revision, status: d.status, reviewed: d.reviewed, title: d.title, contentHash: typeof d.content === "string" ? hash(d.content) : null } : null;
var configSummary = (d) => ({ ...pick(d, ["enabled", "provider", "model", "maxTokensPerReply", "dailyTokenBudget", "revision"]), guidanceHash: hash(d.systemInstructions ?? "") });
function runtimePresence(c) {
  try {
    const config = assistantConfiguration({ ...process.env, ORIN_SUPPORT_AI_PROVIDER: c.provider, ORIN_SUPPORT_AI_MODEL: c.model });
    const credentialPresent = c.provider === "gemini" ? !!process.env.ORIN_SUPPORT_AI_API_KEY : !!process.env.ORIN_SUPPORT_AI_TOKEN;
    return { operatorEnabled: process.env.ORIN_SUPPORT_AI_ENABLED === "true", credentialPresent, configurationValid: config !== null, status: !c.enabled ? "disabled" : !config ? "not-configured" : "configured-unverified" };
  } catch {
    return { operatorEnabled: process.env.ORIN_SUPPORT_AI_ENABLED === "true", credentialPresent: false, configurationValid: false, status: "invalid-configuration" };
  }
}
async function supportAdminAction(u, input) {
  only(input, ["action", "target", "revision", "requestId", "reason", "data"]);
  const action = String(input.action), permissions = { "support.ai.resume": "tickets.manage", "support.ai.configure": "support.ai.configure", "support.knowledge.save": "support.knowledge.manage", "support.knowledge.publish": "support.knowledge.publish", "support.knowledge.unpublish": "support.knowledge.publish" };
  const permission = permissions[action];
  if (!permission) throw new ApiError("Unsupported assistant control action");
  const requestId = key2(input.requestId), reason = bounded(input.reason, 1e3), target = action === "support.ai.configure" ? "current" : action === "support.ai.resume" ? key2(input.target) : documentId(input.target);
  if (action === "support.ai.configure" && input.target !== "current") throw new ApiError("Invalid configuration target");
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new ApiError("Invalid revision");
  const data = input.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError("Invalid support action data");
  const fingerprint = hash(JSON.stringify(input)), command = controlRef("Commands", hash(u.id + ":" + requestId)), record = ref(action === "support.ai.configure" ? "orinSupportConfiguration" : action === "support.ai.resume" ? "orinSupportConversations" : "orinSupportKnowledge", target);
  let output = {};
  await adminDb.runTransaction(async (tx) => {
    await check(tx, u);
    await requirePermission(u, permission, tx, true);
    const [used, snapshot] = await Promise.all([tx.get(command), tx.get(record)]);
    if (used.exists) {
      if (used.data().fingerprint !== fingerprint) throw new ApiError("Request ID conflict", 409);
      output = used.data().result;
      return;
    }
    const before = snapshot.data();
    if (input.revision !== (before?.revision ?? 0)) throw new ApiError("Support record changed; reload before saving.", 409);
    const now = Date.now();
    let after;
    if (action === "support.ai.resume") {
      only(data, []);
      if (!before) throw new ApiError("Conversation not found", 404);
      const mapping = (await tx.get(ref("orinSupportEscalations", target))).data();
      if (!mapping?.ticketId) throw new ApiError("No escalated ticket is associated with this conversation.", 409);
      const ticket = (await tx.get(ref("orinControlTickets", key2(mapping.ticketId)))).data();
      if (!ticket || ticket.uid !== target || ticket.conversationId !== target || !["resolved", "closed"].includes(ticket.status)) throw new ApiError("Resolve the associated support ticket before resuming automated replies.", 409);
      const actingStaff = (await tx.get(ref("orinStaff", u.id))).data();
      if (ticket.assigneeId && ticket.assigneeId !== u.id && !permissionsFor(actingStaff?.roles).includes("tickets.assign")) throw new ApiError("Only the assigned agent or supervisor may resume this conversation.", 403);
      after = { ...before, handoffRequested: false };
    } else if (action === "support.ai.configure") {
      const next = validateSupportConfiguration(data);
      const presence = runtimePresence(next);
      if (next.enabled && (!presence.operatorEnabled || !presence.configurationValid)) throw new ApiError("Server provider configuration is not ready. The secret and approved endpoint must be configured on the server.", 409);
      after = { ...next, revision: (before?.revision ?? 0) + 1, updatedAt: now, updatedBy: u.id };
    } else if (action === "support.knowledge.save") {
      only(data, ["title", "content"]);
      after = { title: bounded(data.title, 120), content: bounded(data.content, 4e3), status: "draft", reviewed: false, revision: (before?.revision ?? 0) + 1, updatedAt: now, updatedBy: u.id };
    } else {
      only(data, ["previewRevision", "reviewed"]);
      if (!before) throw new ApiError("Knowledge document not found", 404);
      if (data.previewRevision !== before.revision) throw new ApiError("Review the current document revision first.", 409);
      if (action === "support.knowledge.publish" && data.reviewed !== true) throw new ApiError("Explicit reviewed confirmation is required.");
      after = { ...before, status: action === "support.knowledge.publish" ? "published" : "draft", reviewed: action === "support.knowledge.publish", revision: before.revision + 1, updatedAt: now, updatedBy: u.id };
    }
    if (action === "support.ai.resume") tx.update(record, { handoffRequested: false, updatedAt: Timestamp.fromMillis(now) });
    else tx.set(record, after);
    output = { saved: true, target, revision: after.revision ?? 0 };
    const auditBefore = action === "support.ai.configure" ? before ? configSummary(before) : null : action === "support.ai.resume" ? { handoffRequested: before?.handoffRequested } : summary(before), auditAfter = action === "support.ai.configure" ? configSummary(after) : action === "support.ai.resume" ? { handoffRequested: false } : summary(after);
    controlAudit(tx, randomUUID2(), u, action, target, reason, auditBefore, auditAfter, requestId);
    tx.create(command, { adminId: u.id, action, fingerprint, result: output, createdAt: now });
  });
  return output;
}

// src/control-contracts.ts
async function applyContractAction(tx, u, action, target, payload, revision, now) {
  const r = ref("orinContracts", target), stateRef = ref("orinControlContractStates", target);
  const [existing, status] = await Promise.all([tx.get(r), tx.get(stateRef)]);
  if (action === "contract.revoke") {
    if (!existing.exists) throw new ApiError("Contract not found", 404);
    const before = status.data() ?? { status: "active", revision: 0 };
    if (before.revision !== revision || before.status !== "active") throw new ApiError("Contract changed", 409);
    const after2 = { status: "revoked", revision: before.revision + 1, updatedAt: now, updatedBy: u.id };
    tx.set(stateRef, after2);
    return { before, after: after2, output: { saved: true, contractId: target } };
  }
  if (existing.exists || revision !== 0) throw new ApiError("Contract already exists", 409);
  const { asset, direction, durationSec, settlementBps, opensAt, closesAt } = payload;
  const title = typeof payload.title === "string" ? payload.title.trim() : "", eligibility = payload.eligibility ?? "all";
  const mode = payload.mode ?? "production";
  if (mode !== "production" && mode !== "virtual-test-only" || !title || title.length > 80 || !Object.hasOwn(ASSETS, asset) || !["BUY", "SELL"].includes(direction)) throw new ApiError("Valid contract terms are required");
  if (!Number.isSafeInteger(durationSec) || durationSec < 60 || durationSec > 300 || !Number.isSafeInteger(settlementBps) || Math.abs(settlementBps) > 1e3) throw new ApiError("Duration 60\u2013300 seconds; settlement \u221210% to +10%");
  if (!["all", "standard", "advanced"].includes(eligibility) || !Number.isSafeInteger(opensAt) || !Number.isSafeInteger(closesAt) || opensAt < now - 6e4 || closesAt <= Math.max(now, opensAt) || closesAt - opensAt > 30 * 864e5) throw new ApiError("Invalid participation window");
  const code = `LAB-${hash(target).slice(0, 10).toUpperCase()}`;
  if ((await tx.get(ref("orinCodes", code))).exists) throw new ApiError("Code collision; use a new request", 409);
  const terms = { version: 1, mode, id: target, code, title, asset, direction, durationSec, settlementBps, eligibility, opensAt, closesAt, publishedAt: now, adminId: u.id };
  const canonical2 = JSON.stringify(terms), digest2 = hash(canonical2);
  const after = { id: target, code, title, asset, direction, duration_sec: durationSec, settlement_bps: settlementBps, eligibility, opens_at: opensAt, closes_at: closesAt, published_at: now, admin_id: u.id, canonical: canonical2, hash: digest2, participants: 0 };
  tx.create(r, after);
  tx.create(ref("orinCodes", code), { contractId: target });
  tx.create(stateRef, { status: "active", revision: 0, updatedAt: now, updatedBy: u.id });
  return { before: null, after, output: { saved: true, contractId: target, code, hash: digest2 } };
}

// src/control-operations.ts
import { FieldPath as FieldPath2 } from "firebase-admin/firestore";

// ../lib/control-workflow.ts
var TICKET_STATUSES = {
  open: "\u0645\u0641\u062A\u0648\u062D\u0629",
  in_progress: "\u0642\u064A\u062F \u0627\u0644\u0645\u0639\u0627\u0644\u062C\u0629",
  waiting: "\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0645\u0639\u0644\u0648\u0645\u0627\u062A",
  resolved: "\u062A\u0645 \u0627\u0644\u062D\u0644",
  closed: "\u0645\u063A\u0644\u0642\u0629"
};
var TICKET_PRIORITIES = { low: "\u0645\u0646\u062E\u0641\u0636\u0629", normal: "\u0639\u0627\u062F\u064A\u0629", high: "\u0639\u0627\u0644\u064A\u0629", urgent: "\u0639\u0627\u062C\u0644\u0629" };
var TICKET_CATEGORIES = { account: "\u0627\u0644\u062D\u0633\u0627\u0628", technical: "\u0645\u0634\u0643\u0644\u0629 \u062A\u0642\u0646\u064A\u0629", identity: "\u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0647\u0648\u064A\u0629", payment: "\u0627\u0633\u062A\u0641\u0633\u0627\u0631 \u0645\u0627\u0644\u064A", other: "\u0623\u062E\u0631\u0649" };
var TICKET_TRANSITIONS = {
  open: ["in_progress", "waiting", "resolved"],
  in_progress: ["open", "waiting", "resolved"],
  waiting: ["open", "in_progress", "resolved"],
  resolved: ["open", "closed"],
  closed: ["open"]
};

// src/control-operations.ts
var identifier = (v) => {
  if (typeof v !== "string" || !/^[-A-Za-z0-9_]{1,128}$/.test(v)) throw new ApiError("Invalid identifier");
  return v;
};
var bounded2 = (v, max) => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new ApiError("Required text is invalid");
  return v.trim();
};
var enumValue = (v, values) => {
  if (typeof v !== "string" || !Object.hasOwn(values, v)) throw new ApiError("Invalid workflow value");
  return v;
};
var dueDate = (v) => {
  if (v === null || v === "") return null;
  if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > 864e13) throw new ApiError("Invalid due date");
  return Number(v);
};
var only2 = (data, fields) => {
  if (Object.keys(data).some((k) => !fields.includes(k))) throw new ApiError("Unsupported ticket field");
};
var summary2 = (d) => d ? Object.fromEntries(["uid", "status", "priority", "category", "assigneeId", "dueAt", "revision", "noteCount"].map((k) => [k, d[k] ?? null])) : null;
async function applyTicketAction(tx, u, action, target, payload, revision, now, requestId) {
  const staff = await requirePermission(u, "tickets.manage", tx), canAssign = permissionsFor(staff.roles).includes("tickets.assign");
  const ticketRef = controlRef("Tickets", target), snapshot = await tx.get(ticketRef), before = snapshot.data();
  if (!Number.isSafeInteger(revision) || revision !== (before?.revision ?? 0)) throw new ApiError("Ticket changed; reload before saving", 409);
  let after;
  if (action === "ticket.create") {
    only2(payload, ["uid", "title", "description", "category", "priority", "dueAt"]);
    if (before) throw new ApiError("Ticket already exists", 409);
    const uid = identifier(payload.uid);
    if (!(await tx.get(ref("users", uid))).exists) throw new ApiError("User not found", 404);
    after = { uid, title: bounded2(payload.title, 160), description: bounded2(payload.description, 4e3), category: enumValue(payload.category, TICKET_CATEGORIES), priority: enumValue(payload.priority, TICKET_PRIORITIES), dueAt: dueDate(payload.dueAt ?? null), status: "open", assigneeId: "", revision: 1, noteCount: 0, createdBy: u.id, updatedBy: u.id, createdAt: now, updatedAt: now, resolvedAt: null, closedAt: null };
    tx.create(ticketRef, after);
  } else {
    if (!before) throw new ApiError("Ticket not found", 404);
    if (action === "ticket.note") {
      only2(payload, ["body"]);
      const body = bounded2(payload.body, 4e3);
      after = { ...before, revision: before.revision + 1, noteCount: before.noteCount + 1, updatedAt: now, updatedBy: u.id };
      tx.create(ticketRef.collection("notes").doc(requestId), { body, authorId: u.id, createdAt: now });
    } else if (action === "ticket.update") {
      only2(payload, ["status", "priority", "assigneeId", "dueAt"]);
      if (!canAssign && before.assigneeId && before.assigneeId !== u.id) throw new ApiError("Only the assigned agent or a supervisor may update this ticket", 403);
      const status = enumValue(payload.status, TICKET_STATUSES), priority = enumValue(payload.priority, TICKET_PRIORITIES);
      if (status !== before.status && !TICKET_TRANSITIONS[before.status]?.includes(status)) throw new ApiError("Invalid ticket status transition", 409);
      const assigneeId = payload.assigneeId === "" ? "" : identifier(payload.assigneeId);
      if (assigneeId !== before.assigneeId) {
        if (!canAssign && !(assigneeId === u.id && !before.assigneeId || !assigneeId && before.assigneeId === u.id)) throw new ApiError("Assignment permission required", 403);
      }
      if (assigneeId) {
        const [assignee, profile, gate] = await Promise.all([tx.get(ref("orinStaff", assigneeId)), tx.get(ref("users", assigneeId)), tx.get(controlRef("Access", assigneeId))]);
        if (assignee.data()?.status !== "active" || !profile.exists || profile.data()?.disabled || gate.data()?.status === "suspended" || assignee.data()?.email !== profile.data()?.email || !permissionsFor(assignee.data()?.roles).includes("tickets.manage")) throw new ApiError("Assignee must be active support staff", 409);
      }
      after = { ...before, status, priority, assigneeId, dueAt: dueDate(payload.dueAt ?? null), revision: before.revision + 1, updatedAt: now, updatedBy: u.id, resolvedAt: status === "resolved" ? before.resolvedAt ?? now : status === "closed" ? before.resolvedAt : null, closedAt: status === "closed" ? before.closedAt ?? now : null };
    } else throw new ApiError("Unsupported ticket action");
    tx.set(ticketRef, after);
  }
  return { before: summary2(before), after: { ...summary2(after), ...action === "ticket.note" ? { noteId: requestId } : {} }, output: { saved: true, ticketId: target, revision: after.revision } };
}

// src/control-rewards.ts
var key3 = (v) => {
  if (typeof v !== "string" || !/^[-A-Za-z0-9_]{1,128}$/.test(v))
    throw new ApiError("Invalid reward identifier");
  return v;
};
async function rewardSnapshot(tx, p) {
  const kind = p.rewardKind;
  if (!["referral", "team"].includes(kind))
    throw new ApiError("Invalid reward kind");
  const rewardId = key3(p.rewardId), rewardRef = ref(kind === "referral" ? "orinReferralRewards" : "orinEligibleRevenue", rewardId), reward = (await tx.get(rewardRef)).data();
  if (!reward)
    throw new ApiError("Reward evidence unavailable", 409);
  const config = (await tx.get(ref("orinProgramConfiguration", "current"))).data();
  if (!config?.enabled)
    throw new ApiError("Reward program is not active", 409);
  let cents, uid;
  if (kind === "referral") {
    if (reward.status !== "approved" || reward.paidAt || !reward.evidenceId)
      throw new ApiError("Approved referral and trusted evidence required", 409);
    uid = key3(reward.referrerId);
    const [a, b, e] = await Promise.all([tx.get(ref("orinVerifiedCustomers", uid)), tx.get(ref("orinVerifiedCustomers", key3(reward.referredId))), tx.get(ref("orinProgramEvidence", key3(reward.evidenceId)))]);
    if (uid === reward.referredId || !a.data()?.verified || !b.data()?.verified || a.data()?.revoked || b.data()?.revoked || a.data()?.customerKey === b.data()?.customerKey || e.data()?.revoked || e.data()?.uid !== reward.referredId || e.data()?.kind !== "referral_qualified" || e.data()?.termsVersion !== reward.termsVersion)
      throw new ApiError("Referral evidence no longer valid", 409);
    cents = reward.amountCents;
  } else {
    uid = key3(reward.uid);
    if (!reward.finalized || reward.paidAt || !Number.isSafeInteger(reward.netRevenueCents) || reward.netRevenueCents <= 0 || !Number.isInteger(reward.direct) || !Number.isInteger(reward.activeTeam) || !Number.isInteger(reward.configurationRevision))
      throw new ApiError("Finalized versioned net revenue required", 409);
    const version = (await tx.get(ref("orinProgramConfigurationHistory", String(reward.configurationRevision)))).data();
    if (!version || version.termsVersion !== reward.termsVersion)
      throw new ApiError("Historical program version is required", 409);
    const level = [...version.levels].reverse().find((l) => reward.direct >= l.direct && reward.activeTeam >= l.active);
    if (!level)
      throw new ApiError("No qualified team level", 409);
    cents = Math.min(level.capCents, Number(BigInt(reward.netRevenueCents) * BigInt(level.bps) / BigInt(1e4)));
  }
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1e12)
    throw new ApiError("Invalid reward amount");
  const accountId = key3(p.accountId), accountRef2 = adminDb.doc(`sparkTradingAccounts/${uid}/accounts/${accountId}`), account2 = (await tx.get(accountRef2)).data(), memberRef = ref("orinProgramMembers", uid), member2 = (await tx.get(memberRef)).data();
  await controlAccess({ id: uid }, true, tx);
  await controlAccount(uid, accountId, tx);
  if (!member2 || !account2 || account2.ownerId !== uid || account2.type !== "real" || account2.currency !== "USD" || !Number.isSafeInteger(account2.balanceCents + cents))
    throw new ApiError("Eligible real USD wallet required", 409);
  return { kind, uid, cents, accountId, accountRef: accountRef2, account: account2, memberRef, member: member2, rewardRef, reward, rewardId };
}
async function settleReward(tx, before, approvalId, approver, now) {
  const s = await rewardSnapshot(tx, before);
  if (s.cents !== before.deltaCents || s.uid !== before.uid || s.account.balanceCents !== before.beforeCents || (s.reward.revision ?? null) !== before.rewardRevision || s.reward.status === "paid" || s.reward.paidAt)
    throw new ApiError("Reward or balance changed; propose again", 409);
  tx.update(s.accountRef, { balanceCents: s.account.balanceCents + s.cents });
  if (s.kind === "referral") {
    if ((s.member.pendingCents ?? 0) < s.cents)
      throw new ApiError("Reward aggregate requires reconciliation", 409);
    tx.update(s.rewardRef, { status: "paid", paidAt: now, accountId: s.accountId, approvalId, revision: (s.reward.revision ?? 0) + 1 });
    tx.update(ref("orinProgramMembers", s.reward.referredId), { referralStatus: "paid" });
    tx.update(s.memberRef, { pendingCents: s.member.pendingCents - s.cents, paidCents: (s.member.paidCents ?? 0) + s.cents });
  } else {
    tx.update(s.rewardRef, { paidAt: now, approvalId });
    tx.create(ref("orinActivityPayments", s.rewardId), { uid: s.uid, cents: s.cents, configurationRevision: s.reward.configurationRevision, netRevenueCents: s.reward.netRevenueCents, createdAt: now, approvalId });
    tx.update(s.memberRef, { activityRewardCents: (s.member.activityRewardCents ?? 0) + s.cents });
  }
  tx.create(ref("orinProgramLedger", "control-" + approvalId), { uid: s.uid, accountId: s.accountId, kind: s.kind === "referral" ? "referral_reward" : "team_activity", entries: [{ account: "cash", cents: s.cents }, { account: "program-expense", cents: -s.cents }], createdAt: now, requestedBy: before.requestedBy, approvedBy: approver, reference: before.reference, rewardId: s.rewardId });
}

// src/control-center.ts
import { randomBytes, randomUUID as randomUUID3 } from "node:crypto";
import { FieldPath as FieldPath3, FieldValue as FieldValue2 } from "firebase-admin/firestore";

// ../lib/programs.ts
var TEAM_LEVELS = [
  { level: 1, direct: 3, active: 3, bps: 75, capCents: 2e3 },
  { level: 2, direct: 5, active: 15, bps: 125, capCents: 6e3 },
  { level: 3, direct: 8, active: 40, bps: 175, capCents: 15e3 },
  { level: 4, direct: 10, active: 120, bps: 225, capCents: 35e3 },
  { level: 5, direct: 15, active: 300, bps: 275, capCents: 75e3 },
  { level: 6, direct: 25, active: 700, bps: 325, capCents: 15e4 }
];
var BADGES = [
  { id: "new_user", name: "New User", ar: "\u0639\u0636\u0648 \u062C\u062F\u064A\u062F", metal: "silver" },
  { id: "verified", name: "Verified", ar: "\u0645\u0648\u062B\u0651\u0642", metal: "blue" },
  { id: "first_deposit", name: "First Deposit", ar: "\u0623\u0648\u0644 \u0625\u064A\u062F\u0627\u0639", metal: "blue" },
  { id: "trader", name: "Trader", ar: "\u0645\u062A\u062F\u0627\u0648\u0644", metal: "blue" },
  { id: "top_referrer", name: "Top Referrer", ar: "\u062F\u0627\u0639\u064D \u0645\u062A\u0645\u064A\u0632", metal: "gold" },
  { id: "team_leader", name: "Team Leader", ar: "\u0642\u0627\u0626\u062F \u0641\u0631\u064A\u0642", metal: "gold" },
  { id: "loyal_member", name: "Loyal Member", ar: "\u0639\u0636\u0648 \u0648\u0641\u064A\u0651", metal: "silver" },
  { id: "elite", name: "Elite", ar: "\u0627\u0644\u0646\u062E\u0628\u0629", metal: "platinum" },
  { id: "legend", name: "Legend", ar: "\u0627\u0644\u0623\u0633\u0637\u0648\u0631\u0629", metal: "platinum" }
];
var DEFAULT_PROGRAM_CONFIG = { bonusAmountCents: 1e4, referralAmountCents: 8e3, firstDepositCents: 1e5, requireKyc: true, levels: TEAM_LEVELS.map((l) => ({ ...l })), enabled: false, termsVersion: null, referralCriteria: null, activeTeamCriteria: null, activityPeriod: null, bonusDurationDays: null, eligibleAssets: null, bonusProfitLimitCents: null, bonusTradingTerms: null, agencyCriteria: null, badgeCriteria: {}, revision: 0 };

// src/control-center.ts
var key4 = (v) => {
  if (typeof v !== "string" || !/^[-A-Za-z0-9_]{1,128}$/.test(v))
    throw new ApiError("Invalid identifier");
  return v;
};
var text = (v, max = 500) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new ApiError("\u0646\u0635 \u0645\u0637\u0644\u0648\u0628 \u0623\u0648 \u0637\u0648\u064A\u0644 \u062C\u062F\u064B\u0627. / Required text is invalid.");
  return v.trim();
};
var integer = (v, min = 0) => {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > Number.MAX_SAFE_INTEGER)
    throw new ApiError("Invalid integer amount");
  return Number(v);
};
var safe2 = (v) => v?.toMillis ? v.toMillis() : Array.isArray(v) ? v.map(safe2) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, safe2(x)])) : v;
var pick2 = (data, fields) => Object.fromEntries(fields.filter((k) => data[k] !== void 0).map((k) => [k, safe2(data[k])]));
function validateConfig(raw) {
  if (Object.keys(raw).some((k) => !Object.hasOwn(CONTROL_DEFAULTS, k)))
    throw new ApiError("Only public operational settings are allowed");
  const next = { ...CONTROL_DEFAULTS, ...raw };
  for (const k of ["maintenance", "tradingEnabled", "depositsEnabled", "withdrawalsEnabled", "referralsEnabled", "bonusEnabled"])
    if (typeof next[k] !== "boolean")
      throw new ApiError("Invalid switch");
  integer(next.minimumVersionCode, 1);
  if (next.maxAdjustmentCents !== null)
    integer(next.maxAdjustmentCents, 1);
  for (const k of ["messageAr", "messageEn"])
    text(next[k], 300);
  if (next.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.supportEmail))
    throw new ApiError("Invalid support email");
  if (next.supportUrl && !/^https:\/\/[^\s<>]+$/.test(next.supportUrl))
    throw new ApiError("HTTPS support URL required");
  return next;
}
async function controlAction(u, input) {
  if (typeof input?.action === "string" && (input.action.startsWith("support.ai.") || input.action.startsWith("support.knowledge."))) return supportAdminAction(u, input);
  const action = String(input.action), permission = ACTION_PERMISSIONS[action];
  if (!permission)
    throw new ApiError("Unsupported control action");
  const requestId = key4(input.requestId), reason = text(input.reason, 1e3), target = key4(input.target ?? u.id), fingerprint = hash(JSON.stringify(input)), command = controlRef("Commands", hash(u.id + ":" + requestId)), now = Date.now();
  let output = { saved: true };
  const recent = ["user.", "account.", "contract.", "reward.", "finance.", "payment.", "staff.", "security.", "configuration.", "program.", "kyc."].some((p) => action.startsWith(p));
  await adminDb.runTransaction(async (tx) => {
    const staff = await requirePermission(u, permission, tx, recent), used = await tx.get(command);
    if (used.exists) {
      if (used.data().fingerprint !== fingerprint)
        throw new ApiError("Request ID conflict", 409);
      output = used.data().result;
      return;
    }
    let before = null, after = null;
    const payload = input.data ?? {};
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new ApiError("Invalid payload");
    if (action.startsWith("contract.")) {
      const result = await applyContractAction(tx, u, action, target, payload, input.revision, now);
      before = result.before;
      after = result.after;
      output = result.output;
    } else if (action.startsWith("ticket.")) {
      const result = await applyTicketAction(tx, u, action, target, payload, input.revision, now, requestId);
      before = result.before;
      after = result.after;
      output = result.output;
    } else if (action === "user.status") {
      if (target === u.id || !["active", "restricted", "suspended"].includes(payload.status))
        throw new ApiError("Invalid status change");
      const [p, s, a] = await Promise.all([tx.get(ref("users", target)), tx.get(ref("orinStaff", target)), tx.get(controlRef("Access", target))]);
      if (!p.exists || s.exists)
        throw new ApiError("Staff must be managed in Staff & roles", 403);
      before = a.data() ?? { status: p.data().disabled ? "suspended" : "active", revision: 0 };
      if (input.revision !== before.revision)
        throw new ApiError("Record changed; reload", 409);
      after = { status: payload.status, reason, revision: before.revision + 1, updatedAt: now };
      tx.set(controlRef("Access", target), after);
      tx.update(ref("users", target), { disabled: payload.status === "suspended", updatedAt: FieldValue2.serverTimestamp() });
    } else if (action === "account.create") {
      const user = await tx.get(ref("users", target));
      if (!user.exists || user.data().disabled || !["real", "demo"].includes(payload.type))
        throw new ApiError("Invalid owner/account type");
      const accountId = key4(payload.accountId ?? requestId), a = adminDb.doc(`sparkTradingAccounts/${target}/accounts/${accountId}`);
      if ((await tx.get(a)).exists)
        throw new ApiError("Account already exists", 409);
      let number = "";
      for (let i = 0; i < 5; i++) {
        number = String(BigInt(1e11) + BigInt("0x" + randomBytes(6).toString("hex")) % BigInt(9e11));
        if (!(await tx.get(ref("sparkAccountNumbers", number))).exists)
          break;
        number = "";
      }
      if (!number)
        throw new ApiError("Account number allocation unavailable", 503);
      after = { id: accountId, ownerId: target, accountNumber: number, type: payload.type, currency: "USD", balanceCents: 0, reservedCents: 0, realizedCents: 0, createdAt: FieldValue2.serverTimestamp() };
      tx.create(a, after);
      tx.create(ref("sparkAccountNumbers", number), { ownerId: target, accountId, createdAt: FieldValue2.serverTimestamp() });
      output = { saved: true, accountId, accountNumber: number };
      after = { ...after, createdAt: now };
    } else if (action === "account.status") {
      const uid = key4(payload.uid), a = await tx.get(adminDb.doc(`sparkTradingAccounts/${uid}/accounts/${target}`));
      if (!a.exists || !["active", "restricted"].includes(payload.status))
        throw new ApiError("Invalid account");
      const r = controlRef("AccountStates", hash(uid + ":" + target));
      before = (await tx.get(r)).data() ?? { status: "active", revision: 0 };
      if (before.revision !== input.revision)
        throw new ApiError("Record changed", 409);
      after = { uid, accountId: target, status: payload.status, reason, revision: before.revision + 1 };
      tx.set(r, after);
    } else if (action === "kyc.review") {
      const r = ref("orinKycRequests", target);
      before = (await tx.get(r)).data();
      if (!before || before.revision !== input.revision)
        throw new ApiError("KYC request changed", 409);
      const transitions = { pending: ["review"], review: ["verified", "rejected", "more_information"], more_information: ["review"], rejected: ["review"], verified: [] };
      if (payload.status === "verified" && (!before.documentIds?.length || before.evidenceComplete !== true))
        throw new ApiError("Complete submitted evidence is required", 409);
      if (!transitions[before.status]?.includes(payload.status))
        throw new ApiError("Invalid KYC transition", 409);
      after = { ...before, status: payload.status, reason, reviewedBy: u.id, reviewedAt: now, revision: before.revision + 1 };
      tx.update(r, { status: after.status, reason, reviewedBy: u.id, reviewedAt: now, revision: after.revision });
      before = pick2(before, ["uid", "status", "revision"]);
      after = pick2(after, ["uid", "status", "revision", "reason", "reviewedBy"]);
    } else if (action === "reward.propose") {
      const s = await rewardSnapshot(tx, payload), reference = text(payload.reference, 128), unique = controlRef("FinancialReferences", hash(reference));
      if ((await tx.get(unique)).exists)
        throw new ApiError("Financial reference already used", 409);
      after = { kind: "reward", rewardKind: s.kind, rewardId: s.rewardId, rewardRevision: s.reward.revision ?? null, uid: s.uid, accountId: s.accountId, deltaCents: s.cents, beforeCents: s.account.balanceCents, afterCents: s.account.balanceCents + s.cents, status: "pending", reason, reference, requestedBy: u.id, revision: 0, createdAt: now };
      tx.create(controlRef("Approvals", requestId), after);
      tx.create(unique, { approvalId: requestId });
      output = { saved: true, approvalId: requestId };
    } else if (action === "finance.propose") {
      const cfg = (await tx.get(controlRef("Configuration", "current"))).data();
      if (!cfg?.maxAdjustmentCents || cfg.maintenance)
        throw new ApiError("Approve a finance limit before adjustments", 409);
      const uid = key4(payload.uid), accountId = key4(payload.accountId), delta = Number(payload.deltaCents);
      if (!Number.isSafeInteger(delta) || !delta || Math.abs(delta) > cfg.maxAdjustmentCents)
        throw new ApiError("Adjustment outside approved limit");
      await controlAccess({ id: uid }, true, tx);
      await controlAccount(uid, accountId, tx);
      const a = (await tx.get(adminDb.doc(`sparkTradingAccounts/${uid}/accounts/${accountId}`))).data();
      if (!a || a.ownerId !== uid || a.type !== "real" || a.currency !== "USD")
        throw new ApiError("Real USD account required");
      integer(a.balanceCents + delta, Math.max(0, a.reservedCents ?? 0));
      const reference = text(payload.reference, 128), unique = controlRef("FinancialReferences", hash(reference));
      if ((await tx.get(unique)).exists)
        throw new ApiError("Financial reference already used", 409);
      after = { kind: "adjustment", uid, accountId, deltaCents: delta, beforeCents: a.balanceCents, afterCents: a.balanceCents + delta, status: "pending", reason, reference, requestedBy: u.id, revision: 0, createdAt: now };
      tx.create(controlRef("Approvals", requestId), after);
      tx.create(unique, { approvalId: requestId });
      output = { saved: true, approvalId: requestId };
    } else if (action === "finance.approve" || action === "finance.reject") {
      const r = controlRef("Approvals", target);
      before = (await tx.get(r)).data();
      if (!before || before.status !== "pending" || before.requestedBy === u.id || before.revision !== input.revision)
        throw new ApiError("Requires a different reviewer and a pending unchanged request", 409);
      const maker = (await tx.get(ref("orinStaff", before.requestedBy))).data();
      const makerProfile = (await tx.get(ref("users", before.requestedBy))).data();
      if (makerProfile?.disabled || maker?.validAfter > before.createdAt || maker?.status !== "active" || !permissionsFor(maker.roles).includes("finance.propose"))
        throw new ApiError("Requester no longer authorized", 403);
      after = { ...before, status: action === "finance.reject" ? "rejected" : "approved", approvedBy: u.id, reviewReason: reason, reviewedAt: now, revision: before.revision + 1 };
      if (action === "finance.approve") {
        const cfg = (await tx.get(controlRef("Configuration", "current"))).data();
        if (cfg?.maintenance)
          throw new ApiError("Maintenance", 503);
        await controlAccess({ id: before.uid }, true, tx);
        await controlAccount(before.uid, before.accountId, tx);
        if (before.kind === "adjustment") {
          if (!cfg?.maxAdjustmentCents || Math.abs(before.deltaCents) > cfg.maxAdjustmentCents)
            throw new ApiError("Adjustment policy changed", 409);
          const a = adminDb.doc(`sparkTradingAccounts/${before.uid}/accounts/${before.accountId}`), data = (await tx.get(a)).data();
          if (!data || data.type !== "real" || data.ownerId !== before.uid || data.currency !== "USD")
            throw new ApiError("Real USD account required", 409);
          if (data.balanceCents + before.deltaCents < 0)
            throw new ApiError("Insufficient balance for adjustment", 409);
          if (data.balanceCents !== before.beforeCents)
            throw new ApiError("Balance changed; submit a new request", 409);
          integer(data.balanceCents + before.deltaCents, Math.max(0, data.reservedCents ?? 0));
          tx.update(a, { balanceCents: data.balanceCents + before.deltaCents });
          tx.create(ref("orinProgramLedger", "control-" + target), { uid: before.uid, accountId: before.accountId, kind: "adjustment", entries: [{ account: "cash", cents: before.deltaCents }, { account: "adjustment-clearing", cents: -before.deltaCents }], createdAt: now, reference: before.reference, requestedBy: before.requestedBy, approvedBy: u.id });
          after.status = "completed";
        } else if (before.kind === "reward") {
          await settleReward(tx, before, target, u.id, now);
          after.status = "completed";
        } else if (before.kind === "payment") {
          const p = controlRef(before.module === "deposits" ? "Deposits" : "Withdrawals", before.paymentId), payment = (await tx.get(p)).data(), integration = (await tx.get(controlRef("Integrations", "current"))).data();
          if (!payment || payment.status !== "pending" || payment.revision !== before.paymentRevision)
            throw new ApiError("Payment changed", 409);
          if (!integration?.payments)
            throw new ApiError("Payment adapter is not connected", 409);
          tx.create(controlRef("PaymentOutbox", target), { paymentId: before.paymentId, module: before.module, decision: before.decision, uid: before.uid, accountId: before.accountId, status: "queued", requestedBy: before.requestedBy, approvedBy: u.id, createdAt: now });
          tx.update(p, { status: "processing", revision: payment.revision + 1, approvalId: target });
        } else
          throw new ApiError("Unknown financial operation");
      }
      tx.update(r, after);
    } else if (action === "payment.review") {
      if (!["deposits", "withdrawals"].includes(payload.module) || !["approve", "reject", "cancel"].includes(payload.decision))
        throw new ApiError("Invalid payment decision");
      const r = controlRef(payload.module === "deposits" ? "Deposits" : "Withdrawals", target);
      const p = (await tx.get(r)).data();
      if (!p || p.status !== "pending" || p.revision !== input.revision)
        throw new ApiError("Only pending payments can be reviewed", 409);
      after = { kind: "payment", paymentId: target, module: payload.module, decision: payload.decision, uid: p.uid, accountId: p.accountId, paymentRevision: p.revision, status: "pending", requestedBy: u.id, reason, revision: 0, createdAt: now };
      tx.create(controlRef("Approvals", requestId), after);
      output = { saved: true, approvalId: requestId };
    } else if (action === "staff.set" || action === "staff.invite") {
      if (!Array.isArray(payload.roles) || !payload.roles.length || !permissionsFor(payload.roles).length || payload.roles.some((x) => !Object.hasOwn(ROLES, x)))
        throw new ApiError("Invalid role");
      if (payload.roles.length !== 1)
        throw new ApiError("Assign one role; combine only through a reviewed role definition");
      const gate = await tx.get(ref("system", "control-center"));
      if (!gate.exists)
        throw new ApiError("Bootstrap required", 409);
      if (action === "staff.invite") {
        const email = text(payload.email, 320).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || payload.roles.includes("super_admin"))
          throw new ApiError("Invite a non-super role; promote a verified existing staff member separately");
        after = { email, roles: payload.roles, status: "pending", createdBy: u.id, createdAt: now, expiresAt: now + 7 * 864e5 };
        tx.set(controlRef("Invitations", hash(email)), after);
      } else {
        if (target === u.id)
          throw new ApiError("Cannot change your own role or status", 403);
        if (!["active", "disabled"].includes(payload.status))
          throw new ApiError("Invalid staff status");
        const [profile, old] = await Promise.all([tx.get(ref("users", target)), tx.get(ref("orinStaff", target))]);
        if (!profile.exists)
          throw new ApiError("Existing registered user required");
        before = old.data() ?? { revision: 0, status: "disabled", roles: [] };
        if ((before.revision ?? 0) !== input.revision)
          throw new ApiError("Staff record changed", 409);
        const was = before.status === "active" && before.roles.includes("super_admin"), will = payload.status === "active" && payload.roles.includes("super_admin"), count = gate.data().superAdminCount + (will ? 1 : 0) - (was ? 1 : 0);
        if (count < 1)
          throw new ApiError("Cannot remove the last Super Admin", 409);
        after = { email: profile.data().email, roles: payload.roles, status: payload.status, revision: (before.revision ?? 0) + 1, validAfter: now, updatedBy: u.id, updatedAt: now };
        tx.set(ref("orinStaff", target), after);
        tx.update(gate.ref, { superAdminCount: count });
      }
    } else if (action === "configuration.save") {
      const r = controlRef("Configuration", "current");
      before = (await tx.get(r)).data() ?? { revision: 0 };
      if (input.revision !== before.revision)
        throw new ApiError("Configuration changed", 409);
      const c = validateConfig(payload), integration = (await tx.get(controlRef("Integrations", "current"))).data() ?? {};
      if (c.tradingEnabled && !integration.execution || (c.depositsEnabled || c.withdrawalsEnabled) && !integration.payments)
        throw new ApiError("Connect the trusted provider before enabling execution or payments", 409);
      after = { ...c, revision: before.revision + 1, updatedAt: now };
      tx.create(controlRef("ConfigurationHistory", String(after.revision)), { ...after, adminId: u.id, reason });
      tx.set(r, after);
      const { maxAdjustmentCents, ...publicConfig } = after;
      tx.set(ref("orinPublicConfiguration", "current"), publicConfig);
    } else if (action === "content.save" || action === "notification.save") {
      const notification = action.startsWith("notification"), r = controlRef(notification ? "Notifications" : "Content", target);
      before = (await tx.get(r)).data() ?? { revision: 0 };
      if (input.revision !== before.revision)
        throw new ApiError("Draft changed", 409);
      if (notification) {
        if (!["all", "user", "segment"].includes(payload.audience) || !["all", "real", "demo", "agents", "verified"].includes(payload.segment ?? "all"))
          throw new ApiError("Invalid audience");
        after = { title: text(payload.title, 80), message: text(payload.message, 500), audience: payload.audience, targetUid: payload.audience === "user" ? key4(payload.targetUid) : null, segment: payload.segment ?? "all", startsAt: integer(payload.startsAt), expiresAt: integer(payload.expiresAt) };
        if (after.expiresAt <= Math.max(now, after.startsAt))
          throw new ApiError("Invalid delivery period");
      } else
        after = { slug: target, titleAr: text(payload.titleAr, 100), titleEn: text(payload.titleEn, 100), bodyAr: text(payload.bodyAr, 2e4), bodyEn: text(payload.bodyEn, 2e4) };
      after = { ...after, status: "draft", revision: before.revision + 1, updatedAt: now, updatedBy: u.id };
      tx.set(r, after);
    } else if (action === "content.publish" || action === "notification.publish") {
      const notification = action.startsWith("notification"), r = controlRef(notification ? "Notifications" : "Content", target);
      before = (await tx.get(r)).data();
      if (!before || before.status !== "draft" || before.revision !== input.revision || payload.previewRevision !== before.revision)
        throw new ApiError("Preview the current draft before publishing", 409);
      after = { ...before, status: notification ? before.startsAt > now ? "scheduled" : "queued" : "published", revision: before.revision + 1, publishedAt: now, publishedBy: u.id };
      if (notification) {
        const integration = (await tx.get(controlRef("Integrations", "current"))).data();
        if (!integration?.scheduler)
          throw new ApiError("Notification delivery worker is not activated", 409);
        tx.create(controlRef("NotificationOutbox", target + "_" + after.revision), { ...after, campaignId: target, status: after.status });
      } else {
        tx.set(ref("orinPublicContent", target), after);
        tx.create(controlRef("ContentHistory", target + "_" + after.revision), after);
      }
      tx.update(r, after);
    } else if (action === "market.save") {
      const pair = String(payload.pair), symbol = MARKET_SYMBOLS.find((s) => s.pair === pair);
      if (!symbol || typeof payload.enabled !== "boolean")
        throw new ApiError("A connected supported symbol is required");
      integer(payload.order);
      if (target !== pair)
        throw new ApiError("Use the canonical market identifier");
      const r = controlRef("Markets", pair);
      before = (await tx.get(r)).data() ?? { revision: 0 };
      if (input.revision !== before.revision)
        throw new ApiError("Market changed", 409);
      const previous = (await tx.get(ref("sparkConfiguration", "markets"))).data(), config = { ...DEFAULT_CONFIGURATION, ...previous?.configuration };
      const enabled2 = config.enabledSymbols.filter((s) => s !== pair);
      if (payload.enabled)
        enabled2.splice(Math.min(payload.order, enabled2.length), 0, pair);
      if (!enabled2.length)
        throw new ApiError("At least one market must remain enabled");
      after = { pair, name: symbol.name, category: symbol.category, source: symbol.tv, enabled: payload.enabled, order: payload.order, revision: before.revision + 1 };
      tx.set(r, after);
      const configuration = { ...config, enabledSymbols: enabled2, defaultSymbol: enabled2.includes(config.defaultSymbol) ? config.defaultSymbol : enabled2[0] };
      tx.set(ref("sparkConfiguration", "markets"), { configuration, revision: (previous?.revision ?? 0) + 1, updatedAt: FieldValue2.serverTimestamp() });
      tx.set(ref("orinConfiguration", "markets"), { configuration, revision: (previous?.revision ?? 0) + 1, updated_at: now });
    } else if (action === "agency.set" || action === "badge.grant") {
      const r = ref("orinProgramMembers", target);
      before = (await tx.get(r)).data();
      if (!before)
        throw new ApiError("Program member required", 404);
      if ((before.revision ?? 0) !== input.revision)
        throw new ApiError("Member changed", 409);
      if (action === "agency.set") {
        if (typeof payload.granted !== "boolean")
          throw new ApiError("Invalid agency state");
        after = { agencyGranted: payload.granted, agencyId: before.agencyId ?? "AG-" + randomBytes(6).toString("hex").toUpperCase(), agencyReason: reason, agencyGrantedBy: u.id, revision: (before.revision ?? 0) + 1 };
      } else {
        const badge = BADGES.find((b) => b.id === payload.badge);
        if (!badge || ["verified", "first_deposit", "trader"].includes(badge.id))
          throw new ApiError("This badge requires trusted automatic evidence", 409);
        const evidence = text(payload.evidenceReference, 128);
        after = { badges: [.../* @__PURE__ */ new Set([...before.badges ?? [], badge.id])], badgeReview: { adminId: u.id, reason, evidenceReference: evidence, at: now }, revision: (before.revision ?? 0) + 1 };
      }
      tx.update(r, after);
      before = pick2(before, ["agencyGranted", "agencyId", "badges", "revision"]);
    } else if (action === "referral.review") {
      const r = ref("orinReferralRewards", target);
      before = (await tx.get(r)).data();
      if (!before || (before.revision ?? 0) !== input.revision)
        throw new ApiError("Referral changed", 409);
      const transition = { pending: ["qualified", "rejected"], qualified: ["approved", "rejected"], approved: ["rejected"] };
      if (!transition[before.status]?.includes(payload.status))
        throw new ApiError("Invalid referral transition; payouts use the financial queue", 409);
      if (payload.status !== "rejected") {
        const [a, b, e] = await Promise.all([tx.get(ref("orinVerifiedCustomers", before.referrerId)), tx.get(ref("orinVerifiedCustomers", before.referredId)), tx.get(ref("orinProgramEvidence", key4(payload.evidenceId)))]);
        if (before.referrerId === before.referredId || !a.data()?.verified || !b.data()?.verified || a.data()?.revoked || b.data()?.revoked || a.data()?.customerKey === b.data()?.customerKey || e.data()?.uid !== before.referredId || e.data()?.kind !== "referral_qualified" || e.data()?.revoked || e.data()?.termsVersion !== before.termsVersion)
          throw new ApiError("Trusted evidence for distinct qualified customers required", 409);
      }
      const parent = ref("orinProgramMembers", before.referrerId), parentData = (await tx.get(parent)).data();
      if (!parentData)
        throw new ApiError("Referrer unavailable", 409);
      after = { status: payload.status, reason, reviewedBy: u.id, reviewedAt: now, evidenceId: payload.evidenceId ?? before.evidenceId ?? null, revision: (before.revision ?? 0) + 1 };
      tx.update(r, after);
      tx.update(ref("orinProgramMembers", before.referredId), { referralStatus: payload.status });
      if (before.status === "pending" && payload.status === "qualified")
        tx.update(parent, { qualifiedCount: (parentData.qualifiedCount ?? 0) + 1, pendingCents: (parentData.pendingCents ?? 0) + before.amountCents });
      if (["qualified", "approved"].includes(before.status) && payload.status === "rejected")
        tx.update(parent, { qualifiedCount: Math.max(0, (parentData.qualifiedCount ?? 0) - 1), pendingCents: Math.max(0, (parentData.pendingCents ?? 0) - before.amountCents) });
    } else if (action === "security.revoke") {
      if (target === u.id)
        throw new ApiError("Use sign out for your own session");
      const p = await tx.get(ref("users", target));
      if (!p.exists)
        throw new ApiError("User not found", 404);
      const isStaff = await tx.get(ref("orinStaff", target));
      if (isStaff.exists && !staff.roles.includes("super_admin"))
        throw new ApiError("Only Super Admin may revoke a staff session", 403);
      const accountSecurity = await tx.get(ref("orinAccountSecurity", target));
      after = { uid: target, validAfter: now, revision: input.revision ?? 0 };
      tx.set(controlRef("SessionRevocations", target), after);
      tx.set(accountSecurity.ref, { epoch: (accountSecurity.data()?.epoch ?? 0) + 1 }, { merge: true });
      if (isStaff.exists)
        tx.update(isStaff.ref, { validAfter: now });
      tx.create(controlRef("Security", requestId), { uid: target, event: "sessions_revoked", status: "revoked_at_api", adminId: u.id, createdAt: now });
    } else if (action === "program.configure")
      throw new ApiError("Use versioned program configuration endpoint", 409);
    else
      throw new ApiError("Action unavailable", 409);
    controlAudit(tx, "command-" + command.id, u, action, target, reason, before, after, requestId);
    tx.create(command, { fingerprint, result: output, createdAt: now });
  });
  if (action === "security.revoke") {
    try {
      await adminAuth.revokeRefreshTokens(target);
    } catch {
      output = { ...output, authRevocationPending: true };
    }
  }
  return output;
}

// src/programs.ts
import { randomBytes as randomBytes2 } from "node:crypto";
var member = (uid) => ref("orinProgramMembers", uid);
var configRef = () => ref("orinProgramConfiguration", "current");
var accountRef = (uid, id2) => adminDb.doc(`sparkTradingAccounts/${uid}/accounts/${id2}`);
var money = (n) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= Number.MAX_SAFE_INTEGER / 4;
function validConfig(v) {
  const p = { ...DEFAULT_PROGRAM_CONFIG, ...v };
  if (Object.keys(v).some((k) => !Object.hasOwn(DEFAULT_PROGRAM_CONFIG, k)) || typeof p.enabled !== "boolean" || !Number.isInteger(p.revision) || p.revision < 0) throw new ApiError("Invalid program settings");
  for (const k of ["termsVersion", "referralCriteria", "activeTeamCriteria", "activityPeriod", "bonusTradingTerms", "agencyCriteria"]) if (p[k] !== null && (typeof p[k] !== "string" || !p[k].trim() || p[k].length > 2e3)) throw new ApiError("Invalid terms");
  if (p.bonusDurationDays !== null && (!Number.isInteger(p.bonusDurationDays) || p.bonusDurationDays <= 0)) throw new ApiError("Invalid duration");
  if (p.bonusProfitLimitCents !== null && !money(p.bonusProfitLimitCents)) throw new ApiError("Invalid profit limit");
  if (p.eligibleAssets !== null && (!Array.isArray(p.eligibleAssets) || !p.eligibleAssets.length || p.eligibleAssets.some((x) => typeof x !== "string" || !/^[A-Z0-9-]{3,20}$/.test(x)))) throw new ApiError("Invalid eligible assets");
  if (!p.badgeCriteria || typeof p.badgeCriteria !== "object" || Array.isArray(p.badgeCriteria) || Object.entries(p.badgeCriteria).some(([k, x]) => !BADGES.some((b) => b.id === k) || typeof x !== "string" || x.length > 2e3)) throw new ApiError("Invalid badge criteria");
  for (const key5 of ["bonusAmountCents", "referralAmountCents", "firstDepositCents"]) if (!money(p[key5]) || p[key5] <= 0) throw new ApiError("Invalid program amount");
  if (p.requireKyc !== true) throw new ApiError("Required verification cannot be bypassed");
  if (!Array.isArray(p.levels) || p.levels.length !== 6 || p.levels.some((l, i) => l.level !== i + 1 || !Number.isInteger(l.direct) || l.direct < 1 || !Number.isInteger(l.active) || l.active < l.direct || !Number.isInteger(l.bps) || l.bps < 0 || l.bps > 1e4 || !money(l.capCents) || i > 0 && (l.direct < p.levels[i - 1].direct || l.active < p.levels[i - 1].active))) throw new ApiError("Invalid L1-L6 definition");
  if (p.enabled && ["termsVersion", "referralCriteria", "activeTeamCriteria", "activityPeriod", "bonusTradingTerms", "agencyCriteria", "bonusDurationDays", "bonusProfitLimitCents", "eligibleAssets"].some((k) => p[k] === null)) throw new ApiError("\u0627\u0639\u062A\u0645\u062F \u062C\u0645\u064A\u0639 \u0634\u0631\u0648\u0637 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062C \u0642\u0628\u0644 \u0627\u0644\u062A\u0641\u0639\u064A\u0644. / Complete program terms before activation.", 409);
  return p;
}
function enabled(c) {
  const p = validConfig(c ?? {});
  if (!p.enabled) throw new ApiError("\u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062C \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u0628\u0639\u062F. / Program is not active.", 409);
  return p;
}
function cleanKey(v) {
  if (typeof v !== "string" || !/^[-a-zA-Z0-9_]{1,128}$/.test(v)) throw new ApiError("Invalid reference");
  return v;
}
function requireReal(a, uid) {
  if (!a || a.ownerId !== uid || a.type !== "real" || a.currency !== "USD") throw new ApiError("\u0627\u062E\u062A\u0631 \u062D\u0633\u0627\u0628\u064B\u0627 \u062D\u0642\u064A\u0642\u064A\u064B\u0627 \u0628\u0627\u0644\u062F\u0648\u0644\u0627\u0631. / Select a real USD account.", 409);
  return a;
}
function ledger(tx, key5, uid, accountId, kind, cents, now) {
  if (!Number.isSafeInteger(cents)) throw new ApiError("Invalid ledger amount");
  tx.create(ref("orinProgramLedger", key5), { uid, accountId, kind, entries: [{ account: `customer:${uid}:${accountId}`, cents }, { account: `program:${kind}`, cents: -cents }], createdAt: now });
}
async function adminPrograms(u, input) {
  if (!input) {
    await adminDb.runTransaction((tx) => check(tx, u, true));
    const [c, r, m, a] = await Promise.all([configRef().get(), adminDb.collection("orinReferralRewards").limit(100).get(), adminDb.collection("orinProgramMembers").limit(100).get(), adminDb.collection("orinAudit").orderBy("created_at", "desc").limit(50).get()]);
    return { configuration: validConfig(c.data() ?? {}), rewards: r.docs.map((x) => ({ id: x.id, ...x.data() })), members: m.docs.map((x) => ({ id: x.id, ...x.data() })), audit: a.docs.map((x) => x.data()) };
  }
  const requestId = cleanKey(input.requestId), command = ref("orinProgramCommands", "admin-" + hash(u.id + requestId)), fingerprint = hash(JSON.stringify(input)), now = Date.now();
  await adminDb.runTransaction(async (tx) => {
    await check(tx, u, true);
    const used = await tx.get(command);
    if (used.exists) {
      if (used.data().fingerprint !== fingerprint) throw new ApiError("Request already used", 409);
      return;
    }
    const cfg = (await tx.get(configRef())).data() ?? DEFAULT_PROGRAM_CONFIG;
    if (input.action === "configure") {
      if (input.revision !== cfg.revision) throw new ApiError("Settings changed; reload", 409);
      const next = validConfig({ ...input.configuration, revision: cfg.revision + 1 });
      if (next.termsVersion === cfg.termsVersion && JSON.stringify(next) !== JSON.stringify({ ...cfg, revision: next.revision })) throw new ApiError("Use a new terms version for changed entitlements", 409);
      tx.create(ref("orinProgramConfigurationHistory", String(next.revision)), { ...next, adminId: u.id, reason: input.reason ?? "Legacy configuration", effectiveAt: now });
      tx.set(configRef(), next);
      controlAudit(tx, "program-config-" + command.id, u, "program.configure", "programs", input.reason ?? "Legacy configuration", cfg, next, requestId);
    } else {
      const c = enabled(cfg), target = cleanKey(input.uid), m = (await tx.get(member(target))).data();
      if (!m) throw new ApiError("Unknown program member");
      if (input.action === "agency") {
        if (typeof input.grant !== "boolean" || typeof input.reason !== "string" || !input.reason.trim()) throw new ApiError("Grant and review reason required");
        tx.update(member(target), { agencyGranted: input.grant, agencyId: m.agencyId ?? "AG-" + randomBytes2(6).toString("hex").toUpperCase(), agencyReason: input.reason, agencyGrantedBy: u.id, agencyUpdatedAt: now });
      } else if (input.action === "badge") {
        const badge = BADGES.find((b) => b.id === input.badge);
        if (!badge || ["new_user", "verified", "first_deposit", "trader"].includes(badge.id) || !c.badgeCriteria[badge.id]) throw new ApiError("Badge requires approved criteria or automatic server evidence", 409);
        const e = (await tx.get(ref("orinProgramEvidence", cleanKey(input.evidenceId)))).data();
        if (!e || e.uid !== target || e.kind !== "badge" || e.badge !== badge.id || e.termsVersion !== c.termsVersion || e.revoked) throw new ApiError("Trusted badge evidence required", 409);
        tx.update(member(target), { badges: [.../* @__PURE__ */ new Set([...m.badges ?? [], badge.id])] });
      } else if (input.action === "referral") {
        const rr = ref("orinReferralRewards", target), r = (await tx.get(rr)).data();
        if (!r) throw new ApiError("Unknown referral");
        if (r.status === "paid" || r.paidAt) throw new ApiError("Reward already paid", 409);
        const parent = member(r.referrerId), p = (await tx.get(parent)).data();
        if (input.status === "qualified" && r.status === "pending") {
          const [v, pv, e] = await Promise.all([tx.get(ref("orinVerifiedCustomers", target)), tx.get(ref("orinVerifiedCustomers", r.referrerId)), tx.get(ref("orinProgramEvidence", cleanKey(input.evidenceId)))]);
          if (!v.data()?.verified || v.data()?.revoked || !pv.data()?.verified || pv.data()?.revoked || v.data().customerKey === pv.data().customerKey || !e.exists || e.data().uid !== target || e.data().kind !== "referral_qualified" || e.data().revoked || e.data().termsVersion !== c.termsVersion) throw new ApiError("Verified distinct customers and eligibility evidence required", 409);
          tx.update(rr, { status: "qualified", evidenceId: input.evidenceId, qualifiedAt: now });
          tx.update(member(target), { referralStatus: "qualified" });
          tx.update(parent, { qualifiedCount: (p.qualifiedCount ?? 0) + 1, pendingCents: (p.pendingCents ?? 0) + (r.amountCents ?? 8e3) });
        } else if (input.status === "rejected" && ["pending", "qualified"].includes(r.status)) {
          if (typeof input.reason !== "string" || !input.reason.trim()) throw new ApiError("Rejection reason required");
          tx.update(rr, { status: "rejected", reason: input.reason, updatedAt: now });
          tx.update(member(target), { referralStatus: "rejected" });
          if (r.status === "qualified") tx.update(parent, { qualifiedCount: p.qualifiedCount - 1, pendingCents: p.pendingCents - (r.amountCents ?? 8e3) });
        } else if (input.status === "paid" && r.status === "qualified") {
          const id2 = cleanKey(input.accountId), a = accountRef(r.referrerId, id2), data = requireReal((await tx.get(a)).data(), r.referrerId), pv = (await tx.get(ref("orinVerifiedCustomers", r.referrerId))).data(), cv = (await tx.get(ref("orinVerifiedCustomers", target))).data(), e = (await tx.get(ref("orinProgramEvidence", r.evidenceId))).data();
          if (!pv?.verified || pv.revoked || !cv?.verified || cv.revoked || !e || e.revoked || e.termsVersion !== c.termsVersion) throw new ApiError("Eligibility changed; review again", 409);
          if (!money(data.balanceCents + (r.amountCents ?? 8e3))) throw new ApiError("Invalid balance");
          tx.update(a, { balanceCents: data.balanceCents + (r.amountCents ?? 8e3) });
          tx.update(rr, { status: "paid", accountId: id2, paidAt: now });
          tx.update(member(target), { referralStatus: "paid" });
          tx.update(parent, { paidCents: (p.paidCents ?? 0) + (r.amountCents ?? 8e3), pendingCents: p.pendingCents - (r.amountCents ?? 8e3) });
          ledger(tx, "referral-" + target, r.referrerId, id2, "referral_reward", r.amountCents ?? 8e3, now);
        } else throw new ApiError("Invalid reward transition", 409);
      } else if (input.action === "activity_reward") {
        const period = cleanKey(input.periodId), revenue = (await tx.get(ref("orinEligibleRevenue", target + "_" + period))).data(), pay = ref("orinActivityPayments", target + "_" + period), previous = await tx.get(pay);
        if (previous.exists || !revenue || revenue.uid !== target || !revenue.finalized || !money(revenue.netRevenueCents) || !Number.isInteger(revenue.direct) || !Number.isInteger(revenue.activeTeam)) throw new ApiError("Finalized eligible net revenue required", 409);
        const version = revenue.configurationRevision ? validConfig((await tx.get(ref("orinProgramConfigurationHistory", String(revenue.configurationRevision)))).data() ?? {}) : c;
        if (version.termsVersion !== revenue.termsVersion) throw new ApiError("Historical terms mismatch", 409);
        const level = [...version.levels].reverse().find((l) => revenue.direct >= l.direct && revenue.activeTeam >= l.active);
        if (!level) throw new ApiError("No eligible team level", 409);
        const cents = Math.min(level.capCents, Number(BigInt(revenue.netRevenueCents) * BigInt(level.bps) / BigInt(1e4))), id2 = cleanKey(input.accountId), a = accountRef(target, id2), data = requireReal((await tx.get(a)).data(), target);
        if (cents <= 0 || !money(data.balanceCents + cents)) throw new ApiError("No payable activity reward", 409);
        tx.update(a, { balanceCents: data.balanceCents + cents });
        tx.create(pay, { uid: target, periodId: period, netRevenueCents: revenue.netRevenueCents, cents, level: level.level, createdAt: now });
        tx.update(member(target), { activityRewardCents: (m.activityRewardCents ?? 0) + cents });
        ledger(tx, "activity-" + target + "_" + period, target, id2, "team_activity", cents, now);
      } else throw new ApiError("Invalid admin action");
    }
    tx.create(command, { fingerprint, action: input.action, createdAt: now });
    audit(tx, "program-" + command.id, u.id, "PROGRAM_" + input.action, input.uid ?? "configuration", { ...input, requestId }, now);
  });
  return adminPrograms(u);
}
export {
  NowPayments,
  adminPrograms,
  bootstrap,
  canonical,
  controlAction,
  adminDb as db,
  hash,
  join,
  paymentService,
  publish,
  recordConfirmedDeposit,
  ref,
  settle,
  state,
  units,
  validIpn,
  verify
};
