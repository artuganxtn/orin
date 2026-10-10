// lib/diagnostics.ts
var records = [];
function diagnostic(area, event, detail = {}) {
  const entry = { at: (/* @__PURE__ */ new Date()).toISOString(), area, event, detail };
  records.push(entry);
  if (records.length > 80) records.shift();
  console.warn("ORIN_DIAGNOSTIC " + JSON.stringify(entry));
}

// lib/live-market.ts
var NATIVE_PAIRS = ["BTC-USD", "ETH-USD", "XRP-USD", "SOL-USD", "DOGE-USD", "ADA-USD"];
function hasNativeFeed(pair) {
  return NATIVE_PAIRS.includes(pair);
}

// lib/mini-history.ts
var MINI_INTERVAL = 15 * 60 * 1e3;
var MINI_WINDOW = 24 * 60 * 60 * 1e3;
var providers = ["Bitstamp", "Kraken", "Gemini", "Coinbase Exchange"];
var MINI_TIMEOUT = 12e3;
function firstAvailable(tasks) {
  return new Promise((resolve, reject) => {
    let remaining = tasks.length;
    const errors = [];
    if (!remaining) {
      reject(new Error("No history provider"));
      return;
    }
    tasks.forEach((task) => Promise.resolve(task).then(resolve, (error) => {
      errors.push(error);
      if (--remaining === 0) reject(Object.assign(new Error("All history providers unavailable"), { causes: errors }));
    }));
  });
}
var providerList = (pair) => providers.filter((source) => source !== "Gemini" || pair !== "ADA-USD");
var krakenPairs = { "BTC-USD": "XXBTZUSD", "ETH-USD": "XETHZUSD", "XRP-USD": "XXRPZUSD", "SOL-USD": "SOLUSD", "DOGE-USD": "XDGUSD", "ADA-USD": "ADAUSD" };
function rowsFor(pair, source, raw) {
  let rows = raw;
  if (source === "Kraken") {
    const d = raw;
    if (!Array.isArray(d?.error) || d.error.length) throw new Error("Kraken history rejected");
    rows = d.result?.[pair.replace("-", "/")] ?? d.result?.[krakenPairs[pair]];
  } else if (source === "Bitstamp") {
    const d = raw;
    if (d?.data?.pair?.replace("/", "-") !== pair) throw new Error("History pair mismatch");
    rows = d.data.ohlc?.map((value) => {
      const r = value;
      return [r.timestamp, r.low, r.high, r.open, r.close, r.volume];
    });
  }
  if (!Array.isArray(rows)) throw new Error("Invalid history response");
  if (source === "Gemini") return rows.map((value) => {
    if (!Array.isArray(value) || value.length < 6) throw new Error("Invalid Gemini candle");
    return [Number(value[0]) / 1e3, value[3], value[2], value[1], value[4], value[5]];
  });
  return rows;
}
function decodeMiniHistory(pair, source, raw, now = Date.now()) {
  if (!hasNativeFeed(pair)) throw new Error("Unsupported mini-chart pair");
  const windowEnd = Math.floor(now / MINI_INTERVAL) * MINI_INTERVAL, points = /* @__PURE__ */ new Map();
  for (const row of rowsFor(pair, source, raw)) {
    if (!Array.isArray(row) || row.length < (source === "Kraken" ? 8 : 6)) throw new Error("Invalid history candle");
    const at = Number(row[0]) * 1e3, close = Number(row[4]), low = Number(row[source === "Kraken" ? 3 : 1]), high = Number(row[2]), open = Number(row[source === "Kraken" ? 1 : 3]);
    if (![at, close, low, high, open].every(Number.isFinite) || at % MINI_INTERVAL !== 0 || Math.min(close, low, open) <= 0 || high < Math.max(low, open, close) || low > Math.min(open, close)) throw new Error("Invalid history values");
    if (at >= windowEnd - MINI_WINDOW && at < windowEnd) points.set(at, { at, price: close });
  }
  const sorted = [...points.values()].sort((a, b) => a.at - b.at);
  if (sorted.length < 72 || sorted[sorted.length - 1].at - sorted[0].at < MINI_WINDOW * 0.75) throw new Error("Insufficient full-day history");
  return { pair, source, points: sorted, windowEnd };
}
function exchangeHistoryEnd(pair, source, raw) {
  const rows = rowsFor(pair, source, raw), latest = Math.max(...rows.map((r) => Array.isArray(r) ? Number(r[0]) * 1e3 : NaN));
  if (!Number.isFinite(latest)) throw new Error("Missing exchange time");
  return latest + (source === "Bitstamp" ? MINI_INTERVAL : 0);
}
var MiniHistoryLoader = class {
  constructor(request2 = fetch, now = Date.now) {
    this.request = request2;
    this.now = now;
    this.cache = /* @__PURE__ */ new Map();
    this.pending = /* @__PURE__ */ new Map();
    this.available = /* @__PURE__ */ new Map();
    this.preferred = /* @__PURE__ */ new Map();
  }
  peek(pair, source) {
    const row = this.cache.get(pair + "|" + source);
    return row && this.now() - (row.receivedAt ?? row.windowEnd) < MINI_WINDOW ? row : null;
  }
  peekAvailable(pair) {
    const cached = this.peek(pair, this.preferred.get(pair) ?? "Bitstamp");
    if (cached) return cached;
    try {
      const d = JSON.parse(globalThis.localStorage?.getItem("orin-mini-v2:" + pair) ?? "null");
      if (d?.pair === pair && providers.includes(d.source) && Number.isFinite(d.receivedAt) && this.now() - d.receivedAt >= 0 && this.now() - d.receivedAt < MINI_WINDOW && Number.isFinite(d.windowEnd) && Array.isArray(d.points) && d.points.length >= 72 && d.points.length <= 96 && d.points.every((p, i) => Number.isFinite(p.at) && Number.isFinite(p.price) && p.price > 0 && p.at % MINI_INTERVAL === 0 && p.at >= d.windowEnd - MINI_WINDOW && p.at < d.windowEnd && (!i || p.at > d.points[i - 1].at))) {
        this.cache.set(pair + "|" + d.source, d);
        this.preferred.set(pair, d.source);
        return d;
      }
    } catch {
    }
    return null;
  }
  loadAvailable(pair) {
    const old = this.peekAvailable(pair);
    if (old && this.now() - (old.receivedAt ?? old.windowEnd) < MINI_INTERVAL) return Promise.resolve(old);
    const running = this.available.get(pair);
    if (running) return running;
    const promise = firstAvailable(providerList(pair).map((source) => this.load(pair, source))).then((data) => {
      this.preferred.set(pair, data.source);
      try {
        globalThis.localStorage?.setItem("orin-mini-v2:" + pair, JSON.stringify(data));
      } catch {
      }
      return data;
    }).finally(() => this.available.delete(pair));
    this.available.set(pair, promise);
    return promise;
  }
  load(pair, source) {
    if (!hasNativeFeed(pair)) return Promise.reject(new Error("Unsupported mini-chart pair"));
    const key = pair + "|" + source, old = this.peek(pair, source);
    if (old && this.now() - (old.receivedAt ?? old.windowEnd) < MINI_INTERVAL) return Promise.resolve(old);
    const running = this.pending.get(key);
    if (running) return running;
    const url = source === "Gemini" ? `https://api.gemini.com/v2/candles/${pair.replace("-", "").toLowerCase()}/15m` : source === "Bitstamp" ? `https://www.bitstamp.net/api/v2/ohlc/${pair.replace("-", "").toLowerCase()}/?step=900&limit=96&exclude_current_candle=true` : source === "Kraken" ? `https://api.kraken.com/0/public/OHLC?pair=${krakenPairs[pair]}&assetVersion=1&interval=15` : `https://api.exchange.coinbase.com/products/${pair}/candles?granularity=900`;
    const work = Promise.resolve().then(async () => {
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("History request timed out"));
        }, MINI_TIMEOUT);
      });
      try {
        const response = await Promise.race([this.request(url, { signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" } }), timeout]);
        if (!response.ok) throw new Error("HTTP " + response.status);
        const raw = await Promise.race([response.json(), timeout]), end = exchangeHistoryEnd(pair, source, raw), serverTime = Date.parse(response.headers?.get("date") ?? "");
        if (Number.isFinite(serverTime) && serverTime - end > MINI_INTERVAL * 2) throw new Error("Stale exchange history");
        const data = { ...decodeMiniHistory(pair, source, raw, end), receivedAt: this.now() };
        this.cache.set(key, data);
        return data;
      } catch (error) {
        diagnostic("market", "mini_history_failed", { pair, provider: source, error: error.message });
        throw error;
      } finally {
        clearTimeout(timer);
        this.pending.delete(key);
      }
    });
    this.pending.set(key, work);
    return work;
  }
};
var miniHistory = new MiniHistoryLoader();
function miniHistorySegments(points) {
  const segments = [];
  for (const p of points) {
    const last = segments[segments.length - 1];
    if (!last || p.at - last[last.length - 1].at > MINI_INTERVAL * 1.5) segments.push([p]);
    else last.push(p);
  }
  return segments.filter((s) => s.length >= 2);
}

// lib/sparkline.ts
function sparklineGeometry(history2, bounds) {
  const rows = [...new Map(history2.filter((p) => Number.isFinite(p.at) && Number.isFinite(p.price) && p.price > 0).map((p) => [p.at, p])).values()].sort((a, b) => a.at - b.at);
  if (rows.length < 2) return null;
  const first = bounds?.start ?? rows[0].at, last = bounds?.end ?? rows[rows.length - 1].at, prices = rows.map((p) => p.price), min = bounds?.min ?? Math.min(...prices), range = (bounds?.max ?? Math.max(...prices)) - min;
  const width = bounds?.width ?? 160, height = bounds?.height ?? 56;
  const points = rows.map((p) => ({ x: 4 + (p.at - first) / (last - first) * (width - 8), y: range ? height - 8 - (p.price - min) / range * (height - 16) : height / 2 }));
  const widths = points.slice(1).map((p, i) => p.x - points[i].x), slopes = widths.map((h, i) => (points[i + 1].y - points[i].y) / h);
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes[i - 1];
    const a = slopes[i - 1], b = slopes[i];
    if (a === 0 || b === 0 || Math.sign(a) !== Math.sign(b)) return 0;
    const w1 = 2 * widths[i] + widths[i - 1], w2 = widths[i] + 2 * widths[i - 1];
    return Math.sign(a) * Math.min(Math.abs((w1 + w2) / (w1 / a + w2 / b)), 3 * Math.min(Math.abs(a), Math.abs(b)));
  });
  const segments = widths.map((h, i) => ({ start: points[i], c1: { x: points[i].x + h / 3, y: points[i].y + tangents[i] * h / 3 }, c2: { x: points[i + 1].x - h / 3, y: points[i + 1].y - tangents[i + 1] * h / 3 }, end: points[i + 1] }));
  const xy = (p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  const path = `M ${xy(points[0])} ` + segments.map((s) => `C ${xy(s.c1)} ${xy(s.c2)} ${xy(s.end)}`).join(" ");
  return { path, area: path + ` L ${points[points.length - 1].x.toFixed(2)} ${height - 1} L ${points[0].x.toFixed(2)} ${height - 1} Z`, points, segments, last: points[points.length - 1] };
}

// app/language-settings.tsx
import { useState as useState2 } from "react";
import { Check, Globe2, Search, Type, Clock3, Wallet } from "lucide-react";

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
var LANGUAGES = [
  { code: "ar", native: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", english: "Arabic", region: "\u0627\u0644\u0639\u0627\u0644\u0645 \u0627\u0644\u0639\u0631\u0628\u064A" },
  { code: "en", native: "English", english: "English", region: "International" },
  { code: "tr", native: "T\xFCrk\xE7e", english: "Turkish", region: "T\xFCrkiye" },
  { code: "de", native: "Deutsch", english: "German", region: "Deutschland \xB7 \xD6sterreich \xB7 Schweiz" }
];
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

// lib/display-text.ts
function displayText(value) {
  return value.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 1632)).replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 1776)).replace(/محاكاة|محاكي/g, "\u062A\u062C\u0631\u064A\u0628\u064A");
}

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
var nativeSecurityStatus = () => request("status");
var configureNativePin = () => request("configurePin");
var setNativeLockTimeout = (seconds) => request("timeout", { seconds });
var enableNativeBiometrics = () => request("enableBiometrics");
var disableNativeBiometrics = () => request("disableBiometrics");
var lockNativeApp = () => request("lock");
var storeNativeSession = (value) => request("storeSession", { value });
var clearNativeSession = (uid) => request("clearSession", { uid });
var storeNativeTrustedDevice = (value) => request("storeTrustedDevice", { value });
var readNativeTrustedDevice = (uid) => request("readTrustedDevice", { uid });
var clearNativeTrustedDevice = (uid) => request("clearTrustedDevice", { uid });

// lib/account-validation.ts
var APP_VERSION = "1.6.1";

// lib/account-security-client.ts
var runtime = null;
var session = null;
var refreshing = null;
var sessionReadyAt = 0;
var SESSION_KEY = "orin-security-session-v1";
var AccountSecurityError = class extends Error {
  constructor(code, message, status = 503) {
    super(message);
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
async function securityStepUp(action, proof = {}) {
  let freshFirebaseToken = null;
  if (proof.password) {
    freshFirebaseToken = await runtime.reauthenticate(proof.password);
  }
  return securityRequest("step-up", { action, ...freshFirebaseToken ? { freshFirebaseToken } : {}, ...proof.otp ? { otp: proof.otp } : {}, ...proof.recoveryCode ? { recoveryCode: proof.recoveryCode } : {} }, { freshIdentity: true });
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
async function ensureFreshSecurityAccess() {
  if (!securityBackendConfigured() || !session) return getSecurityAccessToken();
  if (!session.accessExpiresAt || session.accessExpiresAt < Date.now() + 6e4) await refreshSecuritySession();
  return getSecurityAccessToken();
}

// lib/client-api.ts
var runtime2 = null;
function configureFirebaseTransport(value) {
  runtime2 = value;
}
var firebaseMode = () => runtime2 !== null;
var signOutUrl = () => runtime2 ? "/logout" : "/signout-with-chatgpt?return_to=%2F";
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

// app/orin-settings.tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
  const list = (v, allowed2) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && allowed2.includes(x)))] : [];
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

// app/language-settings.tsx
import { jsx as jsx2, jsxs } from "react/jsx-runtime";
function LanguageOptions({ value, query = "", disabled = false, onChange }) {
  const languages = LANGUAGES.filter((l) => [l.native, l.english, l.region, l.code].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return /* @__PURE__ */ jsx2("div", { className: "orin-language-options", role: "radiogroup", "aria-label": "Language", children: languages.map((l) => /* @__PURE__ */ jsxs("label", { className: value === l.code ? "is-selected" : "", children: [
    /* @__PURE__ */ jsx2("input", { type: "radio", name: "app-language", value: l.code, checked: value === l.code, disabled, onChange: () => onChange(l.code) }),
    /* @__PURE__ */ jsx2("span", { className: "language-monogram", "aria-hidden": "true", children: l.code.toUpperCase() }),
    /* @__PURE__ */ jsxs("span", { className: "language-name", children: [
      /* @__PURE__ */ jsx2("strong", { lang: l.code, dir: l.code === "ar" ? "rtl" : "ltr", children: l.native }),
      /* @__PURE__ */ jsx2("small", { dir: "auto", children: l.region })
    ] }),
    /* @__PURE__ */ jsx2("span", { className: "language-check", "aria-hidden": "true", children: value === l.code && /* @__PURE__ */ jsx2(Check, { size: 16 }) })
  ] }, l.code)) });
}
function LanguageSettings() {
  const { prefs, change, t, status } = useOrin(), [query, setQuery] = useState2(""), [notice, setNotice] = useState2("");
  const busy = status === "saving" || status === "loading";
  const choose = async (chartLocale) => {
    if (chartLocale === prefs.chartLocale) return;
    setNotice("");
    if (await change({ chartLocale })) setNotice("saved");
  };
  return /* @__PURE__ */ jsxs("section", { className: "orin-language-settings", children: [
    /* @__PURE__ */ jsxs("div", { className: "language-intro", children: [
      /* @__PURE__ */ jsx2("span", { children: /* @__PURE__ */ jsx2(Globe2, { size: 28 }) }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx2("h2", { children: t("\u0644\u063A\u062A\u0643\u060C \u062A\u062C\u0631\u0628\u062A\u0643 \u0641\u064A ORIN", "Your language, your ORIN") }),
        /* @__PURE__ */ jsx2("p", { children: t("\u062A\u064F\u0637\u0628\u0642 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0645\u0628\u0627\u0634\u0631\u0629 \u0648\u062A\u064F\u0632\u0627\u0645\u0646 \u0645\u0639 \u062D\u0633\u0627\u0628\u0643.", "Changes apply immediately and sync to your account.") })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("label", { className: "language-search", children: [
      /* @__PURE__ */ jsx2(Search, { size: 18 }),
      /* @__PURE__ */ jsx2("input", { type: "search", value: query, onChange: (e) => setQuery(e.target.value), placeholder: t("\u0627\u0628\u062D\u062B \u0639\u0646 \u0644\u063A\u0629", "Search languages"), "aria-label": t("\u0627\u0628\u062D\u062B \u0639\u0646 \u0644\u063A\u0629", "Search languages") })
    ] }),
    /* @__PURE__ */ jsx2(LanguageOptions, { value: prefs.chartLocale, query, disabled: busy, onChange: (v) => void choose(v) }),
    !LANGUAGES.some((l) => [l.native, l.english, l.region, l.code].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && /* @__PURE__ */ jsx2("p", { className: "language-empty", children: t("\u0644\u0627 \u062A\u0648\u062C\u062F \u0644\u063A\u0629 \u0645\u0637\u0627\u0628\u0642\u0629", "No matching language") }),
    /* @__PURE__ */ jsx2("p", { className: "language-saved", role: "status", "aria-live": "polite", children: notice === "saved" && t("\u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u0644\u063A\u0629", "Language saved") }),
    /* @__PURE__ */ jsx2("h3", { className: "settings-section-label", children: t("\u0627\u0644\u062A\u0641\u0636\u064A\u0644\u0627\u062A \u0627\u0644\u0625\u0642\u0644\u064A\u0645\u064A\u0629", "Regional preferences") }),
    /* @__PURE__ */ jsxs("div", { className: "language-regional", children: [
      /* @__PURE__ */ jsxs("label", { children: [
        /* @__PURE__ */ jsx2(Type, {}),
        /* @__PURE__ */ jsx2("span", { children: t("\u062D\u062C\u0645 \u0627\u0644\u062E\u0637", "Font size") }),
        /* @__PURE__ */ jsx2("select", { disabled: busy, value: prefs.fontSize, onChange: (e) => void change({ fontSize: e.target.value }), children: ["small", "normal", "large"].map((v, i) => /* @__PURE__ */ jsx2("option", { value: v, children: [t("\u0635\u063A\u064A\u0631", "Small"), t("\u0645\u062A\u0648\u0633\u0637", "Default"), t("\u0643\u0628\u064A\u0631", "Large")][i] }, v)) })
      ] }),
      /* @__PURE__ */ jsxs("label", { children: [
        /* @__PURE__ */ jsx2(Clock3, {}),
        /* @__PURE__ */ jsx2("span", { children: t("\u0627\u0644\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0632\u0645\u0646\u064A\u0629", "Time zone") }),
        /* @__PURE__ */ jsx2("select", { disabled: busy, value: prefs.timezone, onChange: (e) => void change({ timezone: e.target.value }), children: Array.from(/* @__PURE__ */ new Set([prefs.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, "Etc/UTC", "Europe/Istanbul", "Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Asia/Riyadh", "Asia/Dubai", "Asia/Damascus", "Europe/London", "America/New_York"])).map((z) => /* @__PURE__ */ jsx2("option", { value: z, children: z.replaceAll("_", " ") }, z)) })
      ] }),
      /* @__PURE__ */ jsxs("label", { children: [
        /* @__PURE__ */ jsx2(Wallet, {}),
        /* @__PURE__ */ jsx2("span", { children: t("\u0627\u0644\u0639\u0645\u0644\u0629 \u0627\u0644\u0645\u0631\u062C\u0639\u064A\u0629", "Reference currency") }),
        /* @__PURE__ */ jsx2("select", { disabled: busy, value: prefs.referenceCurrency, onChange: (e) => void change({ referenceCurrency: e.target.value }), children: ["USD", "EUR", "GBP"].map((c) => /* @__PURE__ */ jsx2("option", { children: c }, c)) })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "language-preview", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        t("\u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u0623\u0631\u0642\u0627\u0645", "Number format"),
        /* @__PURE__ */ jsx2("small", { children: t("\u0623\u0631\u0642\u0627\u0645 \u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629 \u0641\u064A \u062C\u0645\u064A\u0639 \u0627\u0644\u0644\u063A\u0627\u062A", "Latin digits in all languages") })
      ] }),
      /* @__PURE__ */ jsx2("bdi", { children: "1,234.56" })
    ] }),
    /* @__PURE__ */ jsx2("p", { className: "language-footnote", children: t("\u0627\u0644\u0623\u0631\u0635\u062F\u0629 \u0648\u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0628\u0627\u0644\u062F\u0648\u0644\u0627\u0631 \u0627\u0644\u0623\u0645\u0631\u064A\u0643\u064A.", "Balances and settlement are in USD.") })
  ] });
}

// app/security-center.tsx
import { useCallback as useCallback2, useEffect as useEffect2, useRef as useRef2, useState as useState3 } from "react";
import { ShieldCheck, LockKeyhole, Fingerprint, Smartphone, KeyRound, ClipboardList, ChevronLeft, Check as Check2, Copy, LogOut, Monitor, ShieldAlert, Plus, Trash2, LoaderCircle } from "lucide-react";
import QRCode from "qrcode";

// components/ui/dialog.tsx
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

// lib/utils.ts
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// components/ui/button.tsx
import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { jsx as jsx3 } from "react/jsx-runtime";
var buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

// components/ui/dialog.tsx
import { jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
function Dialog({
  ...props
}) {
  return /* @__PURE__ */ jsx4(DialogPrimitive.Root, { "data-slot": "dialog", ...props });
}
function DialogPortal({
  ...props
}) {
  return /* @__PURE__ */ jsx4(DialogPrimitive.Portal, { "data-slot": "dialog-portal", ...props });
}
function DialogOverlay({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx4(
    DialogPrimitive.Overlay,
    {
      "data-slot": "dialog-overlay",
      className: cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      ),
      ...props
    }
  );
}
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}) {
  return /* @__PURE__ */ jsxs2(DialogPortal, { "data-slot": "dialog-portal", children: [
    /* @__PURE__ */ jsx4(DialogOverlay, {}),
    /* @__PURE__ */ jsxs2(
      DialogPrimitive.Content,
      {
        "data-slot": "dialog-content",
        className: cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          className
        ),
        ...props,
        children: [
          children,
          showCloseButton && /* @__PURE__ */ jsxs2(
            DialogPrimitive.Close,
            {
              "data-slot": "dialog-close",
              className: "absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
              children: [
                /* @__PURE__ */ jsx4(XIcon, {}),
                /* @__PURE__ */ jsx4("span", { className: "sr-only", children: "Close" })
              ]
            }
          )
        ]
      }
    )
  ] });
}
function DialogHeader({ className, ...props }) {
  return /* @__PURE__ */ jsx4(
    "div",
    {
      "data-slot": "dialog-header",
      className: cn("flex flex-col gap-2 text-center sm:text-left", className),
      ...props
    }
  );
}
function DialogTitle({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx4(
    DialogPrimitive.Title,
    {
      "data-slot": "dialog-title",
      className: cn("text-lg leading-none font-semibold", className),
      ...props
    }
  );
}
function DialogDescription({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx4(
    DialogPrimitive.Description,
    {
      "data-slot": "dialog-description",
      className: cn("text-sm text-muted-foreground", className),
      ...props
    }
  );
}

// app/security-center.tsx
import { Fragment, jsx as jsx5, jsxs as jsxs3 } from "react/jsx-runtime";
var identity = (ar) => ar;
var EVENTS = { "LOGIN_SUCCESS": ["\u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644 \u0646\u0627\u062C\u062D", "Successful sign-in"], "LOGIN_FAILED": ["\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0641\u0627\u0634\u0644\u0629", "Failed sign-in"], "NEW_DEVICE": ["\u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F", "New device"], "PASSWORD_CHANGED": ["\u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631", "Password changed"], "TOTP_ENABLED": ["\u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629", "Two-factor enabled"], "TOTP_DISABLED": ["\u062A\u0639\u0637\u064A\u0644 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629", "Two-factor disabled"], "TOTP_ENROLLMENT_FAILED": ["\u0641\u0634\u0644 \u0627\u0644\u062A\u062D\u0642\u0642 \u0623\u062B\u0646\u0627\u0621 \u0625\u0639\u062F\u0627\u062F \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629", "Authenticator setup verification failed"], "PASSKEY_ADDED": ["\u0625\u0636\u0627\u0641\u0629 \u0645\u0641\u062A\u0627\u062D \u0645\u0631\u0648\u0631", "Passkey added"], "PASSKEY_REMOVED": ["\u062D\u0630\u0641 \u0645\u0641\u062A\u0627\u062D \u0645\u0631\u0648\u0631", "Passkey removed"], "RECOVERY_CODES_CREATED": ["\u0625\u0646\u0634\u0627\u0621 \u0631\u0645\u0648\u0632 \u0627\u0633\u062A\u0631\u062F\u0627\u062F", "Recovery codes generated"], "SESSION_REVOKED": ["\u0625\u0628\u0637\u0627\u0644 \u062C\u0644\u0633\u0629", "Session revoked"], "TRUSTED_DEVICE_ADDED": ["\u0625\u0636\u0627\u0641\u0629 \u062C\u0647\u0627\u0632 \u0645\u0648\u062B\u0648\u0642", "Trusted device added"], "TRUSTED_DEVICE_REMOVED": ["\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u062B\u0642\u0629", "Device trust removed"], "STEP_UP_FAILED": ["\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0627\u0644\u0625\u0636\u0627\u0641\u064A", "Step-up verification failed"], "login.success": ["\u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644 \u0646\u0627\u062C\u062D", "Successful sign-in"], "login.failed": ["\u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644 \u0641\u0627\u0634\u0644\u0629", "Failed sign-in"], "device.new": ["\u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F", "New device"], "password.changed": ["\u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631", "Password changed"], "totp.enabled": ["\u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629", "Two-factor enabled"], "totp.disabled": ["\u062A\u0639\u0637\u064A\u0644 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629", "Two-factor disabled"], "passkey.added": ["\u0625\u0636\u0627\u0641\u0629 \u0645\u0641\u062A\u0627\u062D \u0645\u0631\u0648\u0631", "Passkey added"], "passkey.deleted": ["\u062D\u0630\u0641 \u0645\u0641\u062A\u0627\u062D \u0645\u0631\u0648\u0631", "Passkey removed"], "recovery.regenerated": ["\u0625\u0646\u0634\u0627\u0621 \u0631\u0645\u0648\u0632 \u0627\u0633\u062A\u0631\u062F\u0627\u062F", "Recovery codes generated"], "session.revoked": ["\u0625\u0646\u0647\u0627\u0621 \u062C\u0644\u0633\u0629", "Session ended"], "trusted.added": ["\u0625\u0636\u0627\u0641\u0629 \u062C\u0647\u0627\u0632 \u0645\u0648\u062B\u0648\u0642", "Trusted device added"], "trusted.deleted": ["\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u062B\u0642\u0629 \u0645\u0646 \u062C\u0647\u0627\u0632", "Device trust removed"], "session.logout": ["\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062E\u0631\u0648\u062C", "Signed out"] };
function SecurityCenter({ t = identity, initialPanel = "overview", onPassword }) {
  const [panel, setPanel] = useState3(initialPanel), [state, setState] = useState3(null), [loading, setLoading] = useState3(true), [error, setError] = useState3(""), [busy, setBusy] = useState3(false), [message, setMessage] = useState3("");
  const [native, setNative] = useState3(null), [enroll, setEnroll] = useState3(null), [otp, setOtp] = useState3(""), [codes, setCodes] = useState3(null), [savedCodes, setSavedCodes] = useState3(false), [passkeyName, setPasskeyName] = useState3("");
  const [step, setStep] = useState3(null), [password, setPassword] = useState3(""), [stepCode, setStepCode] = useState3(""), [recovery, setRecovery] = useState3(false), [stepError, setStepError] = useState3("");
  const alive = useRef2(true), mutex = useRef2(false);
  const fmt = (date) => date ? new Intl.DateTimeFormat(document.documentElement.lang || "ar", { dateStyle: "medium", timeStyle: "short" }).format(date) : t("\u0644\u0645 \u064A\u064F\u0633\u062A\u062E\u062F\u0645 \u0628\u0639\u062F", "Not used yet");
  const read = useCallback2(async () => {
    if (!securityBackendConfigured()) {
      if (alive.current) {
        setState(null);
        setLoading(false);
      }
      return;
    }
    try {
      const result = await securityRequest("state");
      if (alive.current) {
        setState(result);
        setError("");
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);
  const readNative = useCallback2(async () => {
    if (!isNativeSecurityAvailable()) return;
    try {
      const result = await nativeSecurityStatus();
      if (alive.current) setNative(result);
    } catch (e) {
      if (alive.current) setError(e.message);
    }
  }, []);
  useEffect2(() => {
    alive.current = true;
    void read();
    void readNative();
    const sync = () => {
      void read();
      void readNative();
    };
    addEventListener("orin-native-security-change", sync);
    addEventListener("orin-security-session-ready", sync);
    return () => {
      alive.current = false;
      removeEventListener("orin-native-security-change", sync);
      removeEventListener("orin-security-session-ready", sync);
    };
  }, [read, readNative]);
  const run = async (action, success = "") => {
    if (mutex.current) return;
    mutex.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      if (alive.current) {
        setMessage(success);
        await read();
        await readNative();
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      mutex.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const requireStep = (action, label, actionRun) => {
    setPassword("");
    setStepCode("");
    setRecovery(false);
    setStepError("");
    setStep({ action, label, run: actionRun });
  };
  const finishStep = async (usePasskey = false) => {
    if (!step || mutex.current) return;
    mutex.current = true;
    setBusy(true);
    setStepError("");
    try {
      const result = usePasskey ? await passkeyStepUp(step.action) : await securityStepUp(step.action, state?.totp.enabled ? recovery ? { recoveryCode: stepCode } : { otp: stepCode } : { password });
      setPassword("");
      setStepCode("");
      await step.run(result.stepUpToken);
      setStep(null);
      await read();
    } catch (e) {
      setStepError(e.message);
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  };
  const beginTotp = () => requireStep("totp.enroll", t("\u062A\u0623\u0643\u064A\u062F \u0647\u0648\u064A\u062A\u0643 \u0644\u0625\u0639\u062F\u0627\u062F \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629", "Verify identity to set up authentication"), async (stepUpToken) => {
    const r = await securityRequest("totp/enroll", { stepUpToken });
    const qr = await QRCode.toDataURL(r.otpauthUri, { margin: 2, width: 240, errorCorrectionLevel: "M" });
    setEnroll({ ...r, qr });
    setOtp("");
    setPanel("totp");
  });
  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(t("\u062A\u0645 \u0627\u0644\u0646\u0633\u062E. \u0627\u062D\u062A\u0641\u0638 \u0628\u0647 \u0641\u064A \u0645\u0643\u0627\u0646 \u0622\u0645\u0646.", "Copied. Keep it somewhere safe."));
    } catch {
      setError(t("\u062A\u0639\u0630\u0631 \u0627\u0644\u0646\u0633\u062E\u061B \u064A\u0645\u0643\u0646\u0643 \u062A\u062D\u062F\u064A\u062F \u0627\u0644\u0646\u0635 \u0648\u0646\u0633\u062E\u0647.", "Could not copy; select and copy the text."));
    }
  };
  const headings = { overview: t("\u062D\u0645\u0627\u064A\u0629 \u062D\u0633\u0627\u0628\u0643", "Protect your account"), sessions: t("\u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0646\u0634\u0637\u0629", "Active sessions"), totp: t("\u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629", "Two-factor authentication"), passkeys: t("\u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0645\u0631\u0648\u0631", "Passkeys"), trusted: t("\u0627\u0644\u0623\u062C\u0647\u0632\u0629 \u0627\u0644\u0645\u0648\u062B\u0648\u0642\u0629", "Trusted devices"), events: t("\u0633\u062C\u0644 \u0627\u0644\u0623\u0645\u0627\u0646", "Security activity"), lock: t("\u0642\u0641\u0644 ORIN", "ORIN app lock") };
  const pending = t("\u062C\u0627\u0631 \u0627\u0644\u062A\u062D\u0642\u0642\u2026", "Checking\u2026"), unavailable = t("\u064A\u062D\u062A\u0627\u062C \u062E\u0627\u062F\u0645 \u0627\u0644\u0623\u0645\u0627\u0646", "Security backend required");
  return /* @__PURE__ */ jsxs3("div", { className: "security-center", "aria-busy": busy, children: [
    /* @__PURE__ */ jsxs3("div", { className: "security-center-top", children: [
      panel !== "overview" && /* @__PURE__ */ jsx5("button", { type: "button", className: "security-back", onClick: () => {
        setPanel("overview");
        setEnroll(null);
        setOtp("");
      }, "aria-label": t("\u0627\u0644\u0639\u0648\u062F\u0629", "Back"), children: /* @__PURE__ */ jsx5(ChevronLeft, {}) }),
      /* @__PURE__ */ jsx5("span", { className: "security-emblem", children: /* @__PURE__ */ jsx5(ShieldCheck, {}) }),
      /* @__PURE__ */ jsxs3("div", { children: [
        /* @__PURE__ */ jsx5("h2", { children: headings[panel] }),
        /* @__PURE__ */ jsx5("p", { children: t("\u062D\u0645\u0627\u064A\u0629 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646\u0647\u0627\u060C \u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u062D\u0633\u0627\u0628\u0643 \u0648\u062C\u0647\u0627\u0632\u0643.", "Protection tied to your account and this device.") })
      ] })
    ] }),
    message && /* @__PURE__ */ jsxs3("p", { className: "security-notice", role: "status", children: [
      /* @__PURE__ */ jsx5(Check2, { size: 18 }),
      message
    ] }),
    error && /* @__PURE__ */ jsx5("p", { className: "security-error", role: "alert", children: error }),
    !securityBackendConfigured() && /* @__PURE__ */ jsxs3("section", { className: "security-service-note", children: [
      /* @__PURE__ */ jsx5(ShieldAlert, {}),
      /* @__PURE__ */ jsxs3("div", { children: [
        /* @__PURE__ */ jsx5("b", { children: t("\u062E\u0627\u062F\u0645 \u0627\u0644\u0623\u0645\u0627\u0646 \u064A\u062D\u062A\u0627\u062C \u0627\u0644\u0631\u0628\u0637 \u0648\u0627\u0644\u0646\u0634\u0631", "Security backend needs deployment") }),
        /* @__PURE__ */ jsx5("p", { children: t("\u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0648TOTP \u0648\u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0645\u0631\u0648\u0631 \u062A\u062D\u062A\u0627\u062C \u062E\u062F\u0645\u0629 ORIN Security \u0639\u0644\u0649 \u062E\u0627\u062F\u0645 \u0645\u0648\u062B\u0648\u0642. \u0644\u0646 \u062A\u064F\u0639\u0631\u0636 \u0643\u0645\u0641\u0639\u0651\u0644\u0629 \u0642\u0628\u0644 \u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0627\u0644\u062E\u062F\u0645\u0629. \u0642\u0641\u0644 Android \u0645\u0633\u062A\u0642\u0644 \u0648\u064A\u0645\u0643\u0646 \u0625\u0639\u062F\u0627\u062F\u0647 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632.", "Sessions, TOTP and passkeys require the trusted ORIN Security backend. They are not marked enabled without a server response. Android app lock can be configured independently.") })
      ] })
    ] }),
    panel === "overview" && /* @__PURE__ */ jsxs3(Fragment, { children: [
      /* @__PURE__ */ jsxs3("div", { className: "security-feature-grid", children: [
        /* @__PURE__ */ jsxs3("button", { type: "button", onClick: () => setPanel("lock"), children: [
          /* @__PURE__ */ jsx5(LockKeyhole, {}),
          /* @__PURE__ */ jsx5("strong", { children: t("\u0642\u0641\u0644 \u0627\u0644\u062A\u0637\u0628\u064A\u0642", "App lock") }),
          /* @__PURE__ */ jsx5("span", { className: native?.configured ? "secure-state" : "neutral-state", children: native ? native.configured ? t("\u0645\u0641\u0639\u0651\u0644 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632", "Enabled on this device") : t("\u064A\u062D\u062A\u0627\u062C \u0625\u0639\u062F\u0627\u062F PIN", "Set up a PIN") : t("\u0645\u062A\u0627\u062D \u0641\u064A \u062A\u0637\u0628\u064A\u0642 Android", "Available in Android app") })
        ] }),
        /* @__PURE__ */ jsxs3("button", { type: "button", onClick: () => setPanel("totp"), children: [
          /* @__PURE__ */ jsx5(ShieldCheck, {}),
          /* @__PURE__ */ jsx5("strong", { children: t("\u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629", "Two-factor") }),
          /* @__PURE__ */ jsx5("span", { className: state?.totp.enabled ? "secure-state" : "neutral-state", children: loading ? pending : state ? state.totp.enabled ? t("\u0645\u0641\u0639\u0651\u0644\u0629", "Enabled") : t("\u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644\u0629", "Not enabled") : unavailable })
        ] }),
        /* @__PURE__ */ jsxs3("button", { type: "button", onClick: () => setPanel("passkeys"), children: [
          /* @__PURE__ */ jsx5(KeyRound, {}),
          /* @__PURE__ */ jsx5("strong", { children: "Passkeys" }),
          /* @__PURE__ */ jsx5("span", { children: loading ? pending : state ? `${state.passkeys.length} ${t("\u0645\u0641\u062A\u0627\u062D", "keys")}` : unavailable })
        ] }),
        /* @__PURE__ */ jsxs3("button", { type: "button", onClick: () => setPanel("lock"), children: [
          /* @__PURE__ */ jsx5(Fingerprint, {}),
          /* @__PURE__ */ jsx5("strong", { children: t("\u0627\u0644\u0642\u064A\u0627\u0633\u0627\u062A \u0627\u0644\u062D\u064A\u0648\u064A\u0629", "Biometrics") }),
          /* @__PURE__ */ jsx5("span", { children: native ? native.biometricEnabled ? t("\u0645\u0641\u0639\u0651\u0644\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632", "Enabled on this device") : native.biometricAvailable ? t("\u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644\u0629", "Not enabled") : t("\u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632", "Not available on this device") : t("\u062A\u062D\u062A\u0627\u062C \u062A\u0637\u0628\u064A\u0642 Android", "Requires Android app") })
        ] })
      ] }),
      /* @__PURE__ */ jsxs3("section", { className: "security-list", children: [
        /* @__PURE__ */ jsxs3("button", { type: "button", onClick: () => setPanel("sessions"), children: [
          /* @__PURE__ */ jsx5(Smartphone, {}),
          /* @__PURE__ */ jsxs3("span", { children: [
            /* @__PURE__ */ jsx5("b", { children: t("\u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0646\u0634\u0637\u0629", "Active sessions") }),
            /* @__PURE__ */ jsx5("small", { children: t("\u0627\u0644\u0623\u062C\u0647\u0632\u0629 \u0627\u0644\u062A\u064A \u064A\u0645\u0643\u0646\u0647\u0627 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u062D\u0633\u0627\u0628\u0643", "Devices that can access your account") })
          ] }),
          /* @__PURE__ */ jsx5("strong", { children: state ? state.sessions.filter((s) => s.status === "active").length : "\u2014" })
        ] }),
        /* @__PURE__ */ jsxs3("button", { type: "button", onClick: () => setPanel("trusted"), children: [
          /* @__PURE__ */ jsx5(ShieldCheck, {}),
          /* @__PURE__ */ jsxs3("span", { children: [
            /* @__PURE__ */ jsx5("b", { children: t("\u0627\u0644\u0623\u062C\u0647\u0632\u0629 \u0627\u0644\u0645\u0648\u062B\u0648\u0642\u0629", "Trusted devices") }),
            /* @__PURE__ */ jsx5("small", { children: t("\u062B\u0642\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0625\u0644\u063A\u0627\u0621 \u0648\u0645\u062B\u0628\u062A\u0629 \u0628\u0631\u0645\u0632 \u0627\u0644\u062C\u0647\u0627\u0632", "Revocable trust verified by a device credential") })
          ] }),
          /* @__PURE__ */ jsx5("strong", { children: state?.trustedDevices.length ?? "\u2014" })
        ] }),
        /* @__PURE__ */ jsxs3("button", { type: "button", onClick: () => setPanel("totp"), children: [
          /* @__PURE__ */ jsx5(KeyRound, {}),
          /* @__PURE__ */ jsxs3("span", { children: [
            /* @__PURE__ */ jsx5("b", { children: t("\u0631\u0645\u0648\u0632 \u0627\u0644\u0627\u0633\u062A\u0631\u062F\u0627\u062F", "Recovery codes") }),
            /* @__PURE__ */ jsx5("small", { children: state ? state.recoveryCodes.remaining ? `${state.recoveryCodes.remaining} ${t("\u0631\u0645\u0648\u0632 \u063A\u064A\u0631 \u0645\u0633\u062A\u062E\u062F\u0645\u0629", "unused codes")}` : t("\u062A\u062D\u062A\u0627\u062C \u0625\u0646\u0634\u0627\u0621", "Need to be generated") : unavailable })
          ] }),
          /* @__PURE__ */ jsx5(ChevronLeft, {})
        ] }),
        /* @__PURE__ */ jsxs3("button", { type: "button", onClick: () => setPanel("events"), children: [
          /* @__PURE__ */ jsx5(ClipboardList, {}),
          /* @__PURE__ */ jsxs3("span", { children: [
            /* @__PURE__ */ jsx5("b", { children: t("\u0633\u062C\u0644 \u0627\u0644\u0623\u0645\u0627\u0646", "Security activity") }),
            /* @__PURE__ */ jsx5("small", { children: t("\u0639\u0645\u0644\u064A\u0627\u062A \u0627\u0644\u062F\u062E\u0648\u0644 \u0648\u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0627\u0644\u0623\u0645\u0646\u064A\u0629", "Sign-ins and security changes") })
          ] }),
          /* @__PURE__ */ jsx5(ChevronLeft, {})
        ] }),
        onPassword && /* @__PURE__ */ jsxs3("button", { type: "button", onClick: onPassword, children: [
          /* @__PURE__ */ jsx5(LockKeyhole, {}),
          /* @__PURE__ */ jsxs3("span", { children: [
            /* @__PURE__ */ jsx5("b", { children: t("\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0648\u0627\u0644\u0628\u0631\u064A\u062F", "Password & email") }),
            /* @__PURE__ */ jsx5("small", { children: t("\u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0648\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0628\u0631\u064A\u062F", "Change your password and verify email") })
          ] }),
          /* @__PURE__ */ jsx5(ChevronLeft, {})
        ] })
      ] })
    ] }),
    panel === "lock" && /* @__PURE__ */ jsxs3("section", { className: "security-card", children: [
      /* @__PURE__ */ jsxs3("h3", { children: [
        /* @__PURE__ */ jsx5(LockKeyhole, {}),
        t("\u0642\u0641\u0644 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632", "Lock this device")
      ] }),
      /* @__PURE__ */ jsx5("p", { children: t("\u064A\u0628\u062F\u0623 \u062D\u0633\u0627\u0628 \u0627\u0644\u063A\u064A\u0627\u0628 \u0639\u0646\u062F \u0627\u0646\u062A\u0642\u0627\u0644 ORIN \u0644\u0644\u062E\u0644\u0641\u064A\u0629. \u0628\u0639\u062F \u0627\u0644\u0645\u0647\u0644\u0629 \u062A\u064F\u062D\u062C\u0628 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u062D\u062A\u0649 \u0641\u062A\u062D \u0627\u0644\u0642\u0641\u0644 \u0628\u0640PIN \u0623\u0648 \u0642\u064A\u0627\u0633\u0627\u062A \u0627\u0644\u0646\u0638\u0627\u0645 \u0627\u0644\u062D\u064A\u0648\u064A\u0629.", "Absence is measured when ORIN moves to the background. After the timeout, information stays hidden until unlocked using the PIN or system biometrics.") }),
      native ? /* @__PURE__ */ jsxs3(Fragment, { children: [
        /* @__PURE__ */ jsxs3("label", { children: [
          t("\u0627\u0644\u0642\u0641\u0644 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A", "Auto-lock"),
          /* @__PURE__ */ jsx5("select", { value: native.timeoutSeconds, disabled: busy || !native.configured, onChange: (e) => void run(() => setNativeLockTimeout(Number(e.target.value))), children: [[0, t("\u0641\u0648\u0631\u064B\u0627", "Immediately")], [60, t("\u0628\u0639\u062F \u062F\u0642\u064A\u0642\u0629", "After 1 minute")], [300, t("\u0628\u0639\u062F 5 \u062F\u0642\u0627\u0626\u0642", "After 5 minutes")], [900, t("\u0628\u0639\u062F 15 \u062F\u0642\u064A\u0642\u0629", "After 15 minutes")]].map(([v, l]) => /* @__PURE__ */ jsx5("option", { value: v, children: l }, v)) })
        ] }),
        /* @__PURE__ */ jsxs3("button", { className: "btn-outline full", type: "button", disabled: busy, onClick: () => void run(configureNativePin), children: [
          /* @__PURE__ */ jsx5(KeyRound, { size: 18 }),
          native.configured ? t("\u062A\u063A\u064A\u064A\u0631 PIN \u0627\u0644\u062E\u0627\u0635 \u0628\u0640ORIN", "Change ORIN PIN") : t("\u0625\u0639\u062F\u0627\u062F PIN \u0627\u0644\u062E\u0627\u0635 \u0628\u0640ORIN", "Set up ORIN PIN")
        ] }),
        /* @__PURE__ */ jsxs3("div", { className: "security-inline", children: [
          /* @__PURE__ */ jsxs3("span", { children: [
            /* @__PURE__ */ jsx5("b", { children: t("\u0627\u0644\u0628\u0635\u0645\u0629 \u0623\u0648 \u0641\u062A\u062D \u0627\u0644\u0648\u062C\u0647", "Fingerprint or face unlock") }),
            /* @__PURE__ */ jsx5("small", { children: native.biometricAvailable ? t("\u0627\u0644\u062A\u062D\u0642\u0642 \u0639\u0628\u0631 \u0646\u0638\u0627\u0645 Android", "Verified by Android") : t("\u0644\u0627 \u062A\u0648\u062C\u062F \u0642\u064A\u0627\u0633\u0627\u062A \u062D\u064A\u0648\u064A\u0629 \u0642\u0648\u064A\u0629 \u0645\u062A\u0627\u062D\u0629 \u0623\u0648 \u0645\u0633\u062C\u0644\u0629", "No enrolled strong biometrics available") })
          ] }),
          /* @__PURE__ */ jsx5("button", { className: "btn-outline", type: "button", disabled: busy || !native.configured || !native.biometricAvailable && !native.biometricEnabled, onClick: () => void run(native.biometricEnabled ? disableNativeBiometrics : enableNativeBiometrics), children: native.biometricEnabled ? t("\u062A\u0639\u0637\u064A\u0644", "Disable") : t("\u062A\u0641\u0639\u064A\u0644", "Enable") })
        ] }),
        /* @__PURE__ */ jsxs3("button", { className: "btn-primary full", type: "button", disabled: busy || !native.configured, onClick: () => void run(lockNativeApp), children: [
          /* @__PURE__ */ jsx5(LockKeyhole, { size: 18 }),
          t("\u0642\u0641\u0644 \u0627\u0644\u0622\u0646", "Lock now")
        ] }),
        /* @__PURE__ */ jsx5("p", { className: "security-footnote", children: t("\u0644\u0627 \u062A\u0635\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0628\u0635\u0645\u0629 \u0623\u0648 \u0627\u0644\u0648\u062C\u0647 \u0625\u0644\u0649 ORIN. \u0625\u062F\u062E\u0627\u0644 PIN \u064A\u062A\u0645 \u0641\u064A \u0648\u0627\u062C\u0647\u0629 Android \u0627\u0644\u0645\u062D\u0645\u064A\u0629\u060C \u0648\u0644\u0627 \u064A\u064F\u062E\u0632\u0646 \u0643\u0646\u0635 \u0635\u0631\u064A\u062D.", "ORIN never receives fingerprint or face data. PIN entry uses a protected Android screen and is never stored as plain text.") })
      ] }) : /* @__PURE__ */ jsx5("p", { className: "security-empty", children: t("\u0642\u0641\u0644 PIN \u0648\u0627\u0644\u0642\u064A\u0627\u0633\u0627\u062A \u0627\u0644\u062D\u064A\u0648\u064A\u0629 \u0645\u062A\u0627\u062D\u0627\u0646 \u0641\u064A \u0646\u0633\u062E\u0629 Android \u0627\u0644\u0623\u0635\u0644\u064A\u0629. \u0627\u0633\u062A\u062E\u062F\u0645 Passkeys \u0641\u064A \u0645\u062A\u0635\u0641\u062D \u0645\u062F\u0639\u0648\u0645.", "PIN and biometric app lock are available in the native Android build. Use passkeys in a supported browser.") })
    ] }),
    panel === "totp" && /* @__PURE__ */ jsxs3(Fragment, { children: [
      /* @__PURE__ */ jsxs3("section", { className: "security-card", children: [
        /* @__PURE__ */ jsxs3("h3", { children: [
          /* @__PURE__ */ jsx5(ShieldCheck, {}),
          t("\u062A\u0637\u0628\u064A\u0642 Authenticator", "Authenticator app")
        ] }),
        /* @__PURE__ */ jsx5("p", { children: t("\u0627\u0633\u062A\u062E\u062F\u0645 \u062A\u0637\u0628\u064A\u0642\u064B\u0627 \u0645\u062A\u0648\u0627\u0641\u0642\u064B\u0627 \u0645\u0639 TOTP. \u0644\u0627 \u062A\u064F\u0641\u0639\u0651\u0644 \u0627\u0644\u062D\u0645\u0627\u064A\u0629 \u062D\u062A\u0649 \u0646\u062A\u062D\u0642\u0642 \u0645\u0646 \u0623\u0648\u0644 \u0631\u0645\u0632 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645.", "Use a TOTP-compatible authenticator. Protection is enabled only after the server verifies the first code.") }),
        enroll ? /* @__PURE__ */ jsxs3("form", { onSubmit: (e) => {
          e.preventDefault();
          void run(async () => {
            const result = await securityRequest("totp/verify", { enrollmentId: enroll.enrollmentId, otp });
            setEnroll(null);
            setOtp("");
            setCodes(result.recoveryCodes);
            setSavedCodes(false);
          }, t("\u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629.", "Two-factor authentication is enabled."));
        }, children: [
          /* @__PURE__ */ jsx5("img", { className: "security-qr", src: enroll.qr, alt: t("\u0631\u0645\u0632 \u0625\u0639\u062F\u0627\u062F \u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629", "Authenticator setup QR code") }),
          /* @__PURE__ */ jsx5("p", { children: t("\u0627\u0645\u0633\u062D \u0627\u0644\u0631\u0645\u0632 \u0623\u0648 \u0623\u062F\u062E\u0644 \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u064A\u062F\u0648\u064A\u064B\u0627 \u062F\u0627\u062E\u0644 \u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629.", "Scan the QR code or enter the setup key manually in your authenticator.") }),
          /* @__PURE__ */ jsx5("code", { className: "security-secret", dir: "ltr", children: enroll.secret }),
          /* @__PURE__ */ jsxs3("button", { type: "button", className: "security-text-button", onClick: () => void copy(enroll.secret), children: [
            /* @__PURE__ */ jsx5(Copy, { size: 15 }),
            t("\u0646\u0633\u062E \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0625\u0639\u062F\u0627\u062F", "Copy setup key")
          ] }),
          /* @__PURE__ */ jsxs3("label", { children: [
            t("\u0631\u0645\u0632 \u0645\u0643\u0648\u0651\u0646 \u0645\u0646 6 \u0623\u0631\u0642\u0627\u0645", "6-digit code"),
            /* @__PURE__ */ jsx5("input", { inputMode: "numeric", autoComplete: "one-time-code", pattern: "[0-9]{6}", maxLength: 6, value: otp, required: true, onChange: (e) => setOtp(e.target.value.replace(/[^0-9]/g, "")) })
          ] }),
          /* @__PURE__ */ jsx5("button", { type: "submit", disabled: busy || otp.length !== 6, className: "btn-primary full", children: t("\u062A\u062D\u0642\u0642 \u0648\u062A\u0641\u0639\u064A\u0644", "Verify & enable") }),
          /* @__PURE__ */ jsx5("button", { type: "button", className: "security-text-button", disabled: busy, onClick: () => {
            setEnroll(null);
            setOtp("");
          }, children: t("\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0625\u0639\u062F\u0627\u062F", "Cancel setup") })
        ] }) : state?.totp.enabled ? /* @__PURE__ */ jsxs3(Fragment, { children: [
          /* @__PURE__ */ jsx5("span", { className: "secure-state", children: t("\u0645\u0641\u0639\u0651\u0644\u0629 \u0628\u0639\u062F \u0627\u0644\u062A\u062D\u0642\u0642", "Verified and enabled") }),
          /* @__PURE__ */ jsx5("button", { type: "button", className: "btn-outline full danger", disabled: busy, onClick: () => requireStep("totp.disable", t("\u062A\u0623\u0643\u064A\u062F \u062A\u0639\u0637\u064A\u0644 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629", "Confirm two-factor disable"), async (stepUpToken) => {
            await securityRequest("totp/disable", { stepUpToken });
            setMessage(t("\u062A\u0645 \u062A\u0639\u0637\u064A\u0644 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629.", "Two-factor authentication disabled."));
          }), children: t("\u062A\u0639\u0637\u064A\u0644 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629", "Disable two-factor") })
        ] }) : /* @__PURE__ */ jsx5("button", { type: "button", className: "btn-primary full", disabled: busy || !state, onClick: beginTotp, children: t("\u0625\u0639\u062F\u0627\u062F \u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629", "Set up authenticator") })
      ] }),
      /* @__PURE__ */ jsxs3("section", { className: "security-card", children: [
        /* @__PURE__ */ jsxs3("h3", { children: [
          /* @__PURE__ */ jsx5(KeyRound, {}),
          t("\u0631\u0645\u0648\u0632 \u0627\u0644\u0627\u0633\u062A\u0631\u062F\u0627\u062F", "Recovery codes")
        ] }),
        /* @__PURE__ */ jsx5("p", { children: state ? `${state.recoveryCodes.remaining} ${t("\u0631\u0645\u0648\u0632 \u0645\u062A\u0628\u0642\u064A\u0629. \u0643\u0644 \u0631\u0645\u0632 \u064A\u064F\u0633\u062A\u062E\u062F\u0645 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u0641\u0642\u0637.", "codes remaining. Each code works once.")}` : unavailable }),
        /* @__PURE__ */ jsx5("button", { type: "button", className: "btn-outline full", disabled: busy || !state?.totp.enabled, onClick: () => requireStep("recovery.regenerate", t("\u0625\u0646\u0634\u0627\u0621 \u0631\u0645\u0648\u0632 \u0648\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0645\u062C\u0645\u0648\u0639\u0629 \u0627\u0644\u0642\u062F\u064A\u0645\u0629", "Replace all recovery codes"), async (stepUpToken) => {
          const r = await securityRequest("recovery/regenerate", { stepUpToken });
          setCodes(r.recoveryCodes);
          setSavedCodes(false);
        }), children: t("\u0625\u0646\u0634\u0627\u0621 \u0645\u062C\u0645\u0648\u0639\u0629 \u062C\u062F\u064A\u062F\u0629", "Generate new codes") })
      ] })
    ] }),
    panel === "sessions" && /* @__PURE__ */ jsxs3(Fragment, { children: [
      /* @__PURE__ */ jsx5("p", { className: "security-footnote", children: t("\u0639\u0646\u0648\u0627\u0646 IP \u0643\u0645\u0627 \u064A\u0631\u0627\u0647 \u0627\u0644\u062E\u0627\u062F\u0645. \u0644\u0627 \u062A\u064F\u0633\u062A\u062E\u062F\u0645 \u0628\u064A\u0627\u0646\u0627\u062A GPS. \u0644\u0627 \u064A\u062A\u0648\u0641\u0631 \u0645\u0635\u062F\u0631 GeoIP \u0645\u062D\u0644\u064A \u0645\u0648\u062B\u0648\u0642 \u062D\u0627\u0644\u064A\u064B\u0627\u060C \u0644\u0630\u0627 \u0644\u0627 \u0646\u0639\u0631\u0636 \u0645\u062F\u064A\u0646\u0629 \u062A\u062E\u0645\u064A\u0646\u064A\u0629.", "IP addresses are observed by the server. GPS is not used. No reliable GeoIP database is configured, so a guessed city is not shown.") }),
      /* @__PURE__ */ jsx5("div", { className: "security-records", children: state?.sessions.filter((s) => s.status === "active").map((s) => /* @__PURE__ */ jsxs3("article", { className: "security-record", children: [
        /* @__PURE__ */ jsxs3("div", { className: "security-record-heading", children: [
          s.device.platform === "Web" ? /* @__PURE__ */ jsx5(Monitor, {}) : /* @__PURE__ */ jsx5(Smartphone, {}),
          /* @__PURE__ */ jsxs3("div", { children: [
            /* @__PURE__ */ jsx5("h3", { children: s.device.label || [s.device.manufacturer, s.device.model].filter(Boolean).join(" ") || s.device.platform }),
            /* @__PURE__ */ jsxs3("small", { children: [
              s.device.platform,
              s.device.osVersion ? " \xB7 " + s.device.osVersion : "",
              s.device.appVersion ? " \xB7 ORIN " + s.device.appVersion : ""
            ] })
          ] }),
          s.current && /* @__PURE__ */ jsx5("span", { className: "secure-state", children: t("\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632", "This device") })
        ] }),
        /* @__PURE__ */ jsxs3("dl", { children: [
          /* @__PURE__ */ jsxs3("div", { children: [
            /* @__PURE__ */ jsx5("dt", { children: t("\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644", "Signed in") }),
            /* @__PURE__ */ jsx5("dd", { children: fmt(s.createdAt) })
          ] }),
          /* @__PURE__ */ jsxs3("div", { children: [
            /* @__PURE__ */ jsx5("dt", { children: t("\u0622\u062E\u0631 \u0646\u0634\u0627\u0637", "Last activity") }),
            /* @__PURE__ */ jsx5("dd", { children: fmt(s.lastActiveAt) })
          ] }),
          /* @__PURE__ */ jsxs3("div", { children: [
            /* @__PURE__ */ jsx5("dt", { children: "IP" }),
            /* @__PURE__ */ jsx5("dd", { dir: "ltr", children: s.ip ?? t("\u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631", "Unavailable") })
          ] })
        ] }),
        /* @__PURE__ */ jsxs3("button", { type: "button", className: "security-text-button danger", disabled: busy, onClick: () => void run(() => securityRequest("session/revoke", { sessionId: s.id }), t("\u0623\u064F\u0628\u0637\u0644\u062A \u0627\u0644\u062C\u0644\u0633\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645.", "The server session was revoked.")), children: [
          /* @__PURE__ */ jsx5(LogOut, { size: 16 }),
          t("\u0625\u0646\u0647\u0627\u0621 \u0627\u0644\u062C\u0644\u0633\u0629", "End session")
        ] })
      ] }, s.id)) }),
      state && state.sessions.filter((s) => s.status === "active" && !s.current).length > 0 && /* @__PURE__ */ jsx5("button", { type: "button", className: "btn-outline full danger", disabled: busy, onClick: () => void run(() => securityRequest("logout-others", {}), t("\u0623\u064F\u0628\u0637\u0644\u062A \u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0623\u062C\u0647\u0632\u0629 \u0627\u0644\u0623\u062E\u0631\u0649.", "Other device sessions revoked.")), children: t("\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062E\u0631\u0648\u062C \u0645\u0646 \u062C\u0645\u064A\u0639 \u0627\u0644\u0623\u062C\u0647\u0632\u0629 \u0627\u0644\u0623\u062E\u0631\u0649", "Sign out all other devices") })
    ] }),
    panel === "passkeys" && /* @__PURE__ */ jsxs3(Fragment, { children: [
      /* @__PURE__ */ jsxs3("section", { className: "security-card", children: [
        /* @__PURE__ */ jsxs3("h3", { children: [
          /* @__PURE__ */ jsx5(KeyRound, {}),
          "Passkeys"
        ] }),
        /* @__PURE__ */ jsx5("p", { children: t("\u064A\u0628\u0642\u0649 \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u0627\u0635 \u062F\u0627\u062E\u0644 \u062C\u0647\u0627\u0632\u0643 \u0623\u0648 \u0645\u0632\u0648\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F. \u064A\u062D\u062A\u0641\u0638 ORIN \u0628\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0639\u0627\u0645 \u0644\u0644\u062A\u062D\u0642\u0642 \u0641\u0642\u0637.", "The private key stays with your device or credential provider. ORIN keeps only the public verification data.") }),
        !supportsPasskeys() && /* @__PURE__ */ jsx5("p", { className: "security-service-note", children: t("\u0647\u0630\u0627 \u0627\u0644\u0639\u0631\u0636 \u0644\u0627 \u064A\u062F\u0639\u0645 \u0625\u0646\u0634\u0627\u0621 Passkeys. \u0627\u0641\u062A\u062D \u0631\u0627\u0628\u0637 ORIN \u0627\u0644\u0631\u0633\u0645\u064A \u0641\u064A Chrome \u0623\u0648 \u0645\u062A\u0635\u0641\u062D \u0645\u062A\u0648\u0627\u0641\u0642.", "This view cannot create passkeys. Open the official ORIN site in Chrome or a compatible browser.") }),
        /* @__PURE__ */ jsxs3("label", { children: [
          t("\u0627\u0633\u0645 \u0627\u0644\u0645\u0641\u062A\u0627\u062D", "Passkey name"),
          /* @__PURE__ */ jsx5("input", { maxLength: 60, value: passkeyName, onChange: (e) => setPasskeyName(e.target.value), placeholder: t("\u062C\u0647\u0627\u0632\u064A \u0627\u0644\u0634\u062E\u0635\u064A", "My personal device") })
        ] }),
        /* @__PURE__ */ jsxs3("button", { type: "button", className: "btn-primary full", disabled: busy || !state?.capabilities.passkeys || !supportsPasskeys(), onClick: () => requireStep("passkey.add", t("\u0625\u0636\u0627\u0641\u0629 \u0645\u0641\u062A\u0627\u062D \u0645\u0631\u0648\u0631", "Add a passkey"), async (token) => {
          await createSecurityPasskey(token, passkeyName || t("\u0645\u0641\u062A\u0627\u062D ORIN", "ORIN passkey"));
          setPasskeyName("");
          setMessage(t("\u0623\u064F\u0636\u064A\u0641 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0645\u0631\u0648\u0631 \u0628\u0639\u062F \u062A\u062D\u0642\u0642 \u0627\u0644\u062E\u0627\u062F\u0645.", "Passkey added after server verification."));
        }), children: [
          /* @__PURE__ */ jsx5(Plus, { size: 18 }),
          t("\u0625\u0636\u0627\u0641\u0629 \u0645\u0641\u062A\u0627\u062D \u0645\u0631\u0648\u0631", "Add passkey")
        ] })
      ] }),
      state?.passkeys.map((p) => /* @__PURE__ */ jsxs3("article", { className: "security-record", children: [
        /* @__PURE__ */ jsx5("h3", { children: p.name }),
        /* @__PURE__ */ jsxs3("p", { children: [
          t("\u0623\u0636\u064A\u0641", "Added"),
          ": ",
          fmt(p.createdAt)
        ] }),
        /* @__PURE__ */ jsxs3("small", { children: [
          t("\u0622\u062E\u0631 \u0627\u0633\u062A\u062E\u062F\u0627\u0645", "Last used"),
          ": ",
          fmt(p.lastUsedAt)
        ] }),
        /* @__PURE__ */ jsxs3("button", { type: "button", className: "security-text-button danger", disabled: busy, onClick: () => requireStep("passkey.delete", t("\u062D\u0630\u0641 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0645\u0631\u0648\u0631", "Delete passkey"), async (stepUpToken) => {
          await securityRequest("passkeys/delete", { id: p.id, stepUpToken });
        }), children: [
          /* @__PURE__ */ jsx5(Trash2, { size: 16 }),
          t("\u062D\u0630\u0641", "Delete")
        ] })
      ] }, p.id))
    ] }),
    panel === "trusted" && /* @__PURE__ */ jsxs3(Fragment, { children: [
      /* @__PURE__ */ jsxs3("section", { className: "security-card", children: [
        /* @__PURE__ */ jsxs3("h3", { children: [
          /* @__PURE__ */ jsx5(ShieldCheck, {}),
          t("\u0627\u0644\u062B\u0642\u0629 \u0628\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632", "Trust this device")
        ] }),
        /* @__PURE__ */ jsx5("p", { children: t("\u0639\u0646\u062F \u0645\u0648\u0627\u0641\u0642\u062A\u0643 \u064A\u0645\u0643\u0646 \u062A\u0630\u0643\u0631 \u0627\u0644\u062F\u062E\u0648\u0644 \u0644\u0645\u062F\u0629 \u062A\u0635\u0644 \u0625\u0644\u0649 30 \u064A\u0648\u0645\u064B\u0627 \u0628\u0639\u062F \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631. \u062A\u0628\u0642\u0649 \u0627\u0644\u0625\u062C\u0631\u0627\u0621\u0627\u062A \u0627\u0644\u062D\u0633\u0627\u0633\u0629 \u0628\u062D\u0627\u062C\u0629 \u0625\u0644\u0649 \u062A\u062D\u0642\u0642 \u0625\u0636\u0627\u0641\u064A. \u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u062B\u0642\u0629 \u062A\u0644\u063A\u064A \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u0648\u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u062A\u064A \u0627\u0639\u062A\u0645\u062F\u062A \u0639\u0644\u064A\u0647\u060C \u0648\u062A\u0639\u064A\u062F \u0637\u0644\u0628 \u0631\u0645\u0632 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629.", "With your consent, this device can be remembered for up to 30 days after password sign-in. Sensitive actions still require step-up. Removing trust revokes its credential and derived sessions, and requires the authenticator code again.") }),
        /* @__PURE__ */ jsx5("button", { type: "button", className: "btn-primary full", disabled: busy || !state || state.trustedDevices.some((d) => d.current), onClick: () => requireStep("trusted.add", t("\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062B\u0642\u0629 \u0628\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632", "Confirm device trust"), async (stepUpToken) => {
          const result = await securityRequest("trusted/add", { stepUpToken, name: t("\u062C\u0647\u0627\u0632\u064A \u0627\u0644\u0634\u062E\u0635\u064A", "My personal device") });
          await saveTrustedDevice(result);
        }), children: state?.trustedDevices.some((d) => d.current) ? t("\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0645\u0648\u062B\u0648\u0642", "This device is trusted") : t("\u062A\u0648\u062B\u064A\u0642 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632", "Trust this device") })
      ] }),
      state?.trustedDevices.map((d) => /* @__PURE__ */ jsxs3("article", { className: "security-record", children: [
        /* @__PURE__ */ jsxs3("div", { className: "security-record-heading", children: [
          /* @__PURE__ */ jsx5(Smartphone, {}),
          /* @__PURE__ */ jsx5("h3", { children: d.name }),
          d.current && /* @__PURE__ */ jsx5("span", { className: "secure-state", children: t("\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632", "This device") })
        ] }),
        /* @__PURE__ */ jsxs3("p", { children: [
          t("\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0625\u0636\u0627\u0641\u0629", "Added"),
          ": ",
          fmt(d.createdAt)
        ] }),
        /* @__PURE__ */ jsxs3("small", { children: [
          t("\u0622\u062E\u0631 \u0627\u0633\u062A\u062E\u062F\u0627\u0645", "Last used"),
          ": ",
          fmt(d.lastUsedAt)
        ] }),
        /* @__PURE__ */ jsxs3("button", { type: "button", className: "security-text-button danger", disabled: busy, onClick: () => requireStep("trusted.delete", t("\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u062B\u0642\u0629 \u0645\u0646 \u0627\u0644\u062C\u0647\u0627\u0632", "Remove device trust"), async (stepUpToken) => {
          await securityRequest("trusted/delete", { id: d.id, stepUpToken });
          await forgetTrustedDevice(d.id);
        }), children: [
          /* @__PURE__ */ jsx5(Trash2, { size: 16 }),
          t("\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u062B\u0642\u0629", "Remove trust")
        ] })
      ] }, d.id))
    ] }),
    panel === "events" && /* @__PURE__ */ jsxs3("div", { className: "security-records", children: [
      state?.events.length === 0 && /* @__PURE__ */ jsx5("p", { className: "security-empty", children: t("\u0644\u0627 \u064A\u0648\u062C\u062F \u0646\u0634\u0627\u0637 \u0623\u0645\u0646\u064A \u0645\u0633\u062C\u0651\u0644 \u0628\u0639\u062F.", "No recorded security activity yet.") }),
      state?.events.map((e) => /* @__PURE__ */ jsxs3("article", { className: "security-record", children: [
        /* @__PURE__ */ jsxs3("div", { className: "security-record-heading", children: [
          /* @__PURE__ */ jsx5(ShieldCheck, {}),
          /* @__PURE__ */ jsx5("h3", { children: EVENTS[e.action] ? t(...EVENTS[e.action]) : e.action })
        ] }),
        /* @__PURE__ */ jsx5("time", { dateTime: new Date(e.createdAt).toISOString(), children: fmt(e.createdAt) }),
        e.ip && /* @__PURE__ */ jsxs3("p", { dir: "ltr", children: [
          "IP \xB7 ",
          e.ip
        ] })
      ] }, e.id))
    ] }),
    loading && securityBackendConfigured() && /* @__PURE__ */ jsxs3("p", { className: "security-loading", role: "status", children: [
      /* @__PURE__ */ jsx5(LoaderCircle, { className: "spin" }),
      pending
    ] }),
    /* @__PURE__ */ jsx5(Dialog, { open: !!step, onOpenChange: (open) => {
      if (!open && !busy) {
        setStep(null);
        setPassword("");
        setStepCode("");
        setStepError("");
      }
    }, children: /* @__PURE__ */ jsxs3(DialogContent, { className: "security-modal", children: [
      /* @__PURE__ */ jsxs3(DialogHeader, { children: [
        /* @__PURE__ */ jsx5(DialogTitle, { children: step?.label }),
        /* @__PURE__ */ jsx5(DialogDescription, { children: t("\u062A\u062D\u0642\u0642 \u0625\u0636\u0627\u0641\u064A \u0642\u0628\u0644 \u062A\u0646\u0641\u064A\u0630 \u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645.", "Additional verification before the server performs this action.") })
      ] }),
      /* @__PURE__ */ jsxs3("form", { onSubmit: (e) => {
        e.preventDefault();
        void finishStep();
      }, children: [
        stepError && /* @__PURE__ */ jsx5("p", { className: "security-error", role: "alert", children: stepError }),
        state?.totp.enabled ? /* @__PURE__ */ jsxs3(Fragment, { children: [
          /* @__PURE__ */ jsxs3("label", { children: [
            recovery ? t("\u0631\u0645\u0632 \u0627\u0644\u0627\u0633\u062A\u0631\u062F\u0627\u062F", "Recovery code") : t("\u0631\u0645\u0632 \u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629", "Authenticator code"),
            /* @__PURE__ */ jsx5("input", { autoFocus: true, autoComplete: "one-time-code", inputMode: recovery ? "text" : "numeric", required: true, value: stepCode, onChange: (e) => setStepCode(e.target.value), maxLength: recovery ? 40 : 6, disabled: busy })
          ] }),
          /* @__PURE__ */ jsx5("button", { className: "security-text-button", type: "button", disabled: busy, onClick: () => {
            setRecovery(!recovery);
            setStepCode("");
          }, children: recovery ? t("\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629", "Use authenticator") : t("\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0631\u0645\u0632 \u0627\u0633\u062A\u0631\u062F\u0627\u062F", "Use recovery code") })
        ] }) : /* @__PURE__ */ jsxs3("label", { children: [
          t("\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062D\u0627\u0644\u064A\u0629", "Current password"),
          /* @__PURE__ */ jsx5("input", { autoFocus: true, type: "password", autoComplete: "current-password", required: true, value: password, onChange: (e) => setPassword(e.target.value), disabled: busy })
        ] }),
        /* @__PURE__ */ jsx5("button", { className: "btn-primary full", disabled: busy, type: "submit", children: busy ? t("\u062C\u0627\u0631 \u0627\u0644\u062A\u062D\u0642\u0642\u2026", "Verifying\u2026") : t("\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0647\u0648\u064A\u0629", "Verify identity") }),
        !!state?.passkeys.length && supportsPasskeys() && /* @__PURE__ */ jsxs3("button", { className: "btn-outline full", type: "button", disabled: busy, onClick: () => void finishStep(true), children: [
          /* @__PURE__ */ jsx5(KeyRound, { size: 18 }),
          t("\u0627\u0633\u062A\u062E\u062F\u0627\u0645 Passkey", "Use passkey")
        ] })
      ] })
    ] }) }),
    /* @__PURE__ */ jsx5(Dialog, { open: !!codes, onOpenChange: (open) => {
      if (!open && savedCodes) {
        setCodes(null);
        setSavedCodes(false);
      }
    }, children: /* @__PURE__ */ jsxs3(DialogContent, { className: "security-modal", onInteractOutside: (e) => {
      if (!savedCodes) e.preventDefault();
    }, onEscapeKeyDown: (e) => {
      if (!savedCodes) e.preventDefault();
    }, children: [
      /* @__PURE__ */ jsxs3(DialogHeader, { children: [
        /* @__PURE__ */ jsx5(DialogTitle, { children: t("\u0627\u062D\u0641\u0638 \u0631\u0645\u0648\u0632 \u0627\u0644\u0627\u0633\u062A\u0631\u062F\u0627\u062F", "Save your recovery codes") }),
        /* @__PURE__ */ jsx5(DialogDescription, { children: t("\u062A\u064F\u0639\u0631\u0636 \u0647\u0630\u0647 \u0627\u0644\u0631\u0645\u0648\u0632 \u0627\u0644\u0622\u0646 \u0641\u0642\u0637. \u0643\u0644 \u0631\u0645\u0632 \u0635\u0627\u0644\u062D \u0644\u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629. \u0627\u062D\u062A\u0641\u0638 \u0628\u0647\u0627 \u062E\u0627\u0631\u062C \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632.", "These codes are shown only now. Each works once. Store them separately from this device.") })
      ] }),
      /* @__PURE__ */ jsx5("div", { className: "security-recovery-grid", dir: "ltr", children: codes?.map((c) => /* @__PURE__ */ jsx5("code", { children: c }, c)) }),
      /* @__PURE__ */ jsxs3("button", { className: "btn-outline full", type: "button", onClick: () => void copy(codes?.join("\n") ?? ""), children: [
        /* @__PURE__ */ jsx5(Copy, { size: 17 }),
        t("\u0646\u0633\u062E \u0627\u0644\u0631\u0645\u0648\u0632", "Copy codes")
      ] }),
      /* @__PURE__ */ jsxs3("label", { className: "security-checkbox", children: [
        /* @__PURE__ */ jsx5("input", { type: "checkbox", checked: savedCodes, onChange: (e) => setSavedCodes(e.target.checked) }),
        t("\u062D\u0641\u0638\u062A \u0627\u0644\u0631\u0645\u0648\u0632 \u0641\u064A \u0645\u0643\u0627\u0646 \u0622\u0645\u0646", "I saved the codes securely")
      ] }),
      /* @__PURE__ */ jsx5("button", { type: "button", disabled: !savedCodes, className: "btn-primary full", onClick: () => {
        setCodes(null);
        setSavedCodes(false);
      }, children: t("\u062A\u0645", "Done") })
    ] }) })
  ] });
}

// app/account-settings.tsx
import { Bell, Check as Check4, ChevronLeft as ChevronLeft3, ChartCandlestick, Download, EyeOff, Globe2 as Globe23, Info, LockKeyhole as LockKeyhole4, ShieldCheck as ShieldCheck4, SlidersHorizontal, UserRound as UserRound3, Wallet as Wallet3, ClipboardList as ClipboardList2, Palette, Sun, Moon, Monitor as Monitor2, ChevronRight as ChevronRight2, LogOut as LogOut2, RefreshCw, Headphones, Gift, BadgeCheck, ShieldAlert as ShieldAlert2, ExternalLink } from "lucide-react";

// app/workspace-visibility.ts
import { createContext as createContext2 } from "react";
var WorkspaceVisibility = createContext2(true);

// app/full-page.tsx
import { createContext as createContext3, useContext as useContext2, useEffect as useEffect3, useId, useRef as useRef3, useState as useState4 } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, X as X2 } from "lucide-react";
import { Fragment as Fragment2, jsx as jsx6, jsxs as jsxs4 } from "react/jsx-runtime";
var Context = createContext3({ open: false, onOpenChange: () => {
} });
function FullPage({ open, onOpenChange, children }) {
  const visible = useContext2(WorkspaceVisibility);
  return /* @__PURE__ */ jsx6(Context.Provider, { value: { open: open && visible, onOpenChange }, children });
}
function FullPageContent({ children, className = "", dir, pageClassName = "", navTitle, navActions, closeButton = false }) {
  const { open, onOpenChange } = useContext2(Context), { t, prefs } = useOrin();
  const [ready, setReady] = useState4(false);
  const el = useRef3(null);
  const id = useId();
  useEffect3(() => setReady(true), []);
  useEffect3(() => {
    if (!open || !ready) return;
    const focus = document.activeElement;
    const shell = document.querySelector(".app-shell");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (shell) shell.inert = true;
    el.current?.querySelector("button")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (shell) shell.inert = false;
      focus?.focus();
    };
  }, [open, ready]);
  if (!open || !ready) return null;
  return createPortal(/* @__PURE__ */ jsx6("section", { ref: el, className: "orin-full-page " + pageClassName, dir: dir ?? (prefs.chartLocale === "ar" ? "rtl" : "ltr"), "aria-label": t("\u0635\u0641\u062D\u0629 ORIN", "ORIN page"), "data-page-id": id, children: /* @__PURE__ */ jsxs4("div", { className: "orin-page-inner", children: [
    /* @__PURE__ */ jsxs4("nav", { className: "orin-page-nav", children: [
      /* @__PURE__ */ jsx6("button", { onClick: () => onOpenChange(false), "aria-label": closeButton ? t("\u0625\u063A\u0644\u0627\u0642", "Close") : t("\u0631\u062C\u0648\u0639", "Back"), children: closeButton ? /* @__PURE__ */ jsx6(X2, { strokeWidth: 1.6 }) : prefs.chartLocale === "ar" ? /* @__PURE__ */ jsx6(ArrowRight, {}) : /* @__PURE__ */ jsx6(ArrowLeft, {}) }),
      navTitle ?? /* @__PURE__ */ jsxs4(Fragment2, { children: [
        /* @__PURE__ */ jsx6("span", { children: "ORIN" }),
        /* @__PURE__ */ jsx6("img", { src: "/brand/orin-mark.png", alt: "", width: "30", height: "30" })
      ] }),
      navActions
    ] }),
    /* @__PURE__ */ jsx6("div", { className: "orin-page-content " + className.replace(/\b(popup|settings-dialog|admin-settings-dialog|chart-tools-dialog|favorites-dialog)\b/g, ""), children })
  ] }) }), document.body);
}
function FullPageHeader({ children }) {
  return /* @__PURE__ */ jsx6("header", { className: "orin-page-heading", children });
}
function FullPageTitle({ children }) {
  return /* @__PURE__ */ jsx6("h1", { tabIndex: -1, children });
}
function FullPageDescription({ children }) {
  return /* @__PURE__ */ jsx6("p", { children });
}

// app/orin-navigation.tsx
import { createContext as createContext4, useCallback as useCallback3, useContext as useContext3, useEffect as useEffect4, useState as useState5 } from "react";

// lib/orin-routes.ts
var allowed = /^\/(?:$|markets(?:\/(?:favorites|[A-Z0-9]{2,12}-[A-Z0-9]{2,12}))?$|trade(?:\/(?:indicators|drawings|alerts))?$|positions$|settings(?:\/(?:account|appearance|security|notifications|chart|about|admin|language|devices|privacy|documents|support|referral|agent|two-factor|authenticator|data))?$|notifications(?:\/[A-Za-z0-9:_-]+)?$|admin(?:\/(?:dashboard|notifications|audit|users|content|requests|contracts|programs|kyc|accounts|wallets|deposits|withdrawals|approvals|trading|markets|bonus|referrals|team|agencies|badges|configuration|security|staff|tickets))?$|activity$|transfer$|deposit$|withdraw$|documents$|privacy$|terms$|account\/security$|support$|referral(?:\/tree)?$|badges$|bonus$|agent$|invitations$|contracts\/[A-Za-z0-9:_-]+(?:\/(?:confirm|success))?$|transactions\/[A-Za-z0-9:_-]+$|announcements\/[A-Za-z0-9:_-]+$)/;
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

// app/orin-navigation.tsx
import { jsx as jsx7 } from "react/jsx-runtime";
var Context2 = createContext4(null);
var OrinNavigationContext = Context2;
function useNavigation() {
  const value = useContext3(Context2);
  if (!value) throw new Error("OrinNavigation required");
  return value;
}
function useRoutePanel(base, keys) {
  const n = useNavigation();
  const tail = n.path.startsWith(base + "/") ? n.path.slice(base.length + 1) : "";
  const panel = keys.includes(tail) ? tail : null;
  return [panel, (v) => v ? n.navigate(base + "/" + v) : n.back(base)];
}

// app/sound-preferences.tsx
import { Volume2, Vibrate, Megaphone, ShieldCheck as ShieldCheck2, Play } from "lucide-react";
import { useEffect as useEffect5, useRef as useRef4 } from "react";
import { Fragment as Fragment3, jsx as jsx8, jsxs as jsxs5 } from "react/jsx-runtime";
function SoundPreferences() {
  const { prefs, t, change, status } = useOrin();
  const current = useRef4(null);
  const busy = status === "loading" || status === "saving";
  useEffect5(() => () => {
    current.current?.pause();
  }, []);
  const play = async (name) => {
    current.current?.pause();
    const audio = new Audio("/audio/" + name + ".wav");
    audio.volume = 0.35;
    current.current = audio;
    try {
      await audio.play();
    } catch {
    }
  };
  return /* @__PURE__ */ jsxs5(Fragment3, { children: [
    /* @__PURE__ */ jsxs5("section", { className: "settings-group", children: [
      /* @__PURE__ */ jsx8(SettingsRow, { icon: /* @__PURE__ */ jsx8(Volume2, {}), title: t("\u0623\u0635\u0648\u0627\u062A \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A", "Notification sounds"), detail: t("\u062A\u0641\u0636\u064A\u0644 \u0645\u062D\u0641\u0648\u0638 \u0644\u0644\u062A\u0637\u0628\u064A\u0642\u0627\u062A \u0627\u0644\u062F\u0627\u0639\u0645\u0629 \u0644\u0635\u0648\u062A \u0627\u0644\u0646\u0638\u0627\u0645.", "Saved for clients supporting system notification sounds."), children: /* @__PURE__ */ jsx8(SettingsToggle, { label: "Notification sounds", value: prefs.notificationSounds, disabled: busy, onChange: (v) => void change({ notificationSounds: v }) }) }),
      /* @__PURE__ */ jsx8(SettingsRow, { icon: /* @__PURE__ */ jsx8(Volume2, {}), title: t("\u0635\u0648\u062A \u0627\u0644\u0641\u0631\u0635", "Opportunity sound"), children: /* @__PURE__ */ jsx8(SettingsToggle, { label: "Opportunity sound", value: prefs.opportunitySound, disabled: busy || !prefs.notificationSounds, onChange: (v) => void change({ opportunitySound: v }) }) }),
      /* @__PURE__ */ jsx8(SettingsRow, { icon: /* @__PURE__ */ jsx8(ShieldCheck2, {}), title: t("\u0635\u0648\u062A \u0627\u0644\u0623\u0645\u0627\u0646", "Security sound"), detail: t("\u0643\u062A\u0645 \u0627\u0644\u0635\u0648\u062A \u0644\u0627 \u064A\u0648\u0642\u0641 \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u0623\u0645\u0627\u0646 \u062F\u0627\u062E\u0644 \u0627\u0644\u062D\u0633\u0627\u0628.", "Muting sound does not disable account security notices."), children: /* @__PURE__ */ jsx8(SettingsToggle, { label: "Security sound", value: prefs.securitySound, disabled: busy || !prefs.notificationSounds, onChange: (v) => void change({ securitySound: v }) }) }),
      /* @__PURE__ */ jsx8(SettingsRow, { icon: /* @__PURE__ */ jsx8(Vibrate, {}), title: t("\u0627\u0644\u0627\u0647\u062A\u0632\u0627\u0632", "Vibration"), children: /* @__PURE__ */ jsx8(SettingsToggle, { label: "Vibration", value: prefs.vibration, disabled: busy, onChange: (v) => void change({ vibration: v }) }) }),
      /* @__PURE__ */ jsx8(SettingsRow, { icon: /* @__PURE__ */ jsx8(Megaphone, {}), title: t("\u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u0633\u0648\u064A\u0642\u064A\u0629", "Marketing announcements"), detail: t("\u0627\u062E\u062A\u064A\u0627\u0631\u064A\u061B \u0644\u0627 \u064A\u0624\u062B\u0631 \u0639\u0644\u0649 \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0623\u0645\u0627\u0646 \u0627\u0644\u062D\u0633\u0627\u0628.", "Optional; account security notices are unaffected."), children: /* @__PURE__ */ jsx8(SettingsToggle, { label: "Marketing announcements", value: prefs.marketingNotifications, disabled: busy, onChange: (v) => void change({ marketingNotifications: v }) }) })
    ] }),
    /* @__PURE__ */ jsx8("h3", { className: "settings-section-label", children: t("\u0627\u0633\u062A\u0645\u0639 \u0625\u0644\u0649 \u0647\u0648\u064A\u0629 ORIN", "Listen to ORIN") }),
    /* @__PURE__ */ jsx8("div", { className: "orin-audio-list", children: [["standard", "ORIN Standard"], ["opportunity", "ORIN Opportunity"], ["security", "ORIN Security"], ["sonic-logo", "ORIN Sonic Logo"]].map(([file, title]) => /* @__PURE__ */ jsxs5("button", { onClick: () => void play(file), children: [
      /* @__PURE__ */ jsx8(Play, { size: 16 }),
      title
    ] }, file)) }),
    /* @__PURE__ */ jsx8("p", { className: "settings-footnote", children: t("\u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u0635\u0648\u062A\u064A\u0629 \u062A\u0639\u0645\u0644 \u0639\u0646\u062F \u0627\u0644\u0636\u063A\u0637 \u0641\u0642\u0637. \u0644\u0627 \u064A\u0634\u063A\u0651\u0644 \u0627\u0644\u0645\u0648\u0642\u0639 \u0623\u0635\u0648\u0627\u062A\u064B\u0627 \u062A\u0644\u0642\u0627\u0626\u064A\u0629 \u0644\u0623\u0646\u0647 \u0644\u0627 \u064A\u0633\u062A\u0637\u064A\u0639 \u0642\u0631\u0627\u0621\u0629 \u0648\u0636\u0639 \u0627\u0644\u0635\u0627\u0645\u062A \u0623\u0648 \u0639\u062F\u0645 \u0627\u0644\u0625\u0632\u0639\u0627\u062C. \u0627\u0644\u0627\u0647\u062A\u0632\u0627\u0632 \u0645\u062A\u0627\u062D \u062D\u064A\u062B \u062A\u062F\u0639\u0645\u0647 \u0627\u0644\u0645\u0646\u0635\u0629\u060C \u0645\u0639 \u0627\u062D\u062A\u0631\u0627\u0645 \u062A\u0642\u0644\u064A\u0644 \u0627\u0644\u062D\u0631\u0643\u0629.", "Sound previews play only on your tap. The website does not autoplay sounds because it cannot read Silent or Do Not Disturb modes. Haptics are available where the platform supports them, with reduced motion respected.") })
  ] });
}

// components/ui/switch.tsx
import { Switch as SwitchPrimitive } from "radix-ui";
import { jsx as jsx9 } from "react/jsx-runtime";
function Switch({
  className,
  size = "default",
  ...props
}) {
  return /* @__PURE__ */ jsx9(
    SwitchPrimitive.Root,
    {
      "data-slot": "switch",
      "data-size": size,
      className: cn(
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80",
        className
      ),
      ...props,
      children: /* @__PURE__ */ jsx9(
        SwitchPrimitive.Thumb,
        {
          "data-slot": "switch-thumb",
          className: cn(
            "pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground"
          )
        }
      )
    }
  );
}

// components/ui/select.tsx
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { jsx as jsx10, jsxs as jsxs6 } from "react/jsx-runtime";
function Select({
  ...props
}) {
  return /* @__PURE__ */ jsx10(SelectPrimitive.Root, { "data-slot": "select", ...props });
}
function SelectValue({
  ...props
}) {
  return /* @__PURE__ */ jsx10(SelectPrimitive.Value, { "data-slot": "select-value", ...props });
}
function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}) {
  return /* @__PURE__ */ jsxs6(
    SelectPrimitive.Trigger,
    {
      "data-slot": "select-trigger",
      "data-size": size,
      className: cn(
        "flex w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      ),
      ...props,
      children: [
        children,
        /* @__PURE__ */ jsx10(SelectPrimitive.Icon, { asChild: true, children: /* @__PURE__ */ jsx10(ChevronDownIcon, { className: "size-4 opacity-50" }) })
      ]
    }
  );
}
function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}) {
  return /* @__PURE__ */ jsx10(SelectPrimitive.Portal, { children: /* @__PURE__ */ jsxs6(
    SelectPrimitive.Content,
    {
      "data-slot": "select-content",
      className: cn(
        "relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      ),
      position,
      align,
      ...props,
      children: [
        /* @__PURE__ */ jsx10(SelectScrollUpButton, {}),
        /* @__PURE__ */ jsx10(
          SelectPrimitive.Viewport,
          {
            className: cn(
              "p-1",
              position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
            ),
            children
          }
        ),
        /* @__PURE__ */ jsx10(SelectScrollDownButton, {})
      ]
    }
  ) });
}
function SelectItem({
  className,
  children,
  ...props
}) {
  return /* @__PURE__ */ jsxs6(
    SelectPrimitive.Item,
    {
      "data-slot": "select-item",
      className: cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      ),
      ...props,
      children: [
        /* @__PURE__ */ jsx10(
          "span",
          {
            "data-slot": "select-item-indicator",
            className: "absolute right-2 flex size-3.5 items-center justify-center",
            children: /* @__PURE__ */ jsx10(SelectPrimitive.ItemIndicator, { children: /* @__PURE__ */ jsx10(CheckIcon, { className: "size-4" }) })
          }
        ),
        /* @__PURE__ */ jsx10(SelectPrimitive.ItemText, { children })
      ]
    }
  );
}
function SelectScrollUpButton({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx10(
    SelectPrimitive.ScrollUpButton,
    {
      "data-slot": "select-scroll-up-button",
      className: cn(
        "flex cursor-default items-center justify-center py-1",
        className
      ),
      ...props,
      children: /* @__PURE__ */ jsx10(ChevronUpIcon, { className: "size-4" })
    }
  );
}
function SelectScrollDownButton({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx10(
    SelectPrimitive.ScrollDownButton,
    {
      "data-slot": "select-scroll-down-button",
      className: cn(
        "flex cursor-default items-center justify-center py-1",
        className
      ),
      ...props,
      children: /* @__PURE__ */ jsx10(ChevronDownIcon, { className: "size-4" })
    }
  );
}

// app/admin-chart-settings.tsx
import { useState as useState6 } from "react";
import { LockKeyhole as LockKeyhole2, Save, Settings2 } from "lucide-react";
import { toast as toast2 } from "sonner";
import { jsx as jsx11, jsxs as jsxs7 } from "react/jsx-runtime";
function AdminChartSettings() {
  const { settings, configuration, status, saveConfiguration, t } = useOrin();
  const [draft, setDraft] = useState6(structuredClone(configuration)), [revision, setRevision] = useState6(settings?.configurationRevision ?? 0);
  if (!settings?.isAdmin) return /* @__PURE__ */ jsx11("p", { children: t("\u0645\u062A\u0627\u062D \u0644\u0644\u0645\u062F\u064A\u0631 \u0641\u0642\u0637.", "Administrator access required.") });
  const busy = status === "saving";
  const update = (patch) => setDraft((old) => ({ ...old, ...patch }));
  const toggle = (key, value) => {
    let next = draft[key].includes(value) ? draft[key].filter((x) => x !== value) : [...draft[key], value];
    if (key !== "allowedIndicators" && !next.length) {
      toast2.info(t("\u064A\u062C\u0628 \u0625\u0628\u0642\u0627\u0621 \u062E\u064A\u0627\u0631 \u0648\u0627\u062D\u062F \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644.", "Keep at least one option enabled."));
      return;
    }
    const patch = { [key]: next };
    if (key === "enabledSymbols" && !next.includes(draft.defaultSymbol)) patch.defaultSymbol = next[0];
    if (key === "enabledTimeframes" && !next.includes(draft.defaultTimeframe)) patch.defaultTimeframe = next[0];
    if (key === "enabledChartTypes" && !next.includes(draft.defaultChartType)) patch.defaultChartType = next[0];
    update(patch);
  };
  const chips = (key, options) => /* @__PURE__ */ jsx11("div", { className: "admin-options", children: options.map(([value, label]) => /* @__PURE__ */ jsxs7("label", { children: [
    /* @__PURE__ */ jsx11("input", { type: "checkbox", checked: draft[key].includes(value), disabled: busy, onChange: () => toggle(key, value) }),
    /* @__PURE__ */ jsx11("span", { children: label })
  ] }, value)) });
  return /* @__PURE__ */ jsxs7("form", { className: "admin-chart-form", onSubmit: async (e) => {
    e.preventDefault();
    if (await saveConfiguration(draft, revision)) {
      setRevision(revision + 1);
      toast2.success(t("\u0646\u064F\u0634\u0631\u062A \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0633\u0648\u0642. \u062A\u0635\u0644 \u0644\u0644\u0623\u062C\u0647\u0632\u0629 \u0639\u0646\u062F \u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629.", "Market configuration saved. Devices receive it on sync."));
    }
  }, children: [
    /* @__PURE__ */ jsxs7("div", { className: "config-revision", children: [
      /* @__PURE__ */ jsx11("span", { children: "Markets / Chart Settings" }),
      /* @__PURE__ */ jsxs7("b", { children: [
        "v",
        revision
      ] })
    ] }),
    settings.configurationRevision !== revision && /* @__PURE__ */ jsx11("p", { className: "settings-error", children: t("\u062A\u063A\u064A\u0631 \u0627\u0644\u0625\u0635\u062F\u0627\u0631 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645. \u0623\u063A\u0644\u0642 \u0647\u0630\u0647 \u0627\u0644\u0644\u0648\u062D\u0629 \u0648\u0623\u0639\u062F \u0641\u062A\u062D\u0647\u0627 \u0642\u0628\u0644 \u0627\u0644\u062D\u0641\u0638.", "The server version changed. Reopen this panel before saving.") }),
    /* @__PURE__ */ jsx11("h3", { children: t("\u0627\u0644\u0623\u0635\u0648\u0644 \u0627\u0644\u0645\u062A\u0627\u062D\u0629", "Enabled symbols") }),
    chips("enabledSymbols", MARKET_SYMBOLS.map((s) => [s.pair, s.label])),
    /* @__PURE__ */ jsx11(SettingsRow, { icon: /* @__PURE__ */ jsx11(Settings2, {}), title: t("\u0627\u0644\u0623\u0635\u0644 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A", "Default symbol"), children: /* @__PURE__ */ jsx11(SettingsSelect, { value: draft.defaultSymbol, label: "Admin default symbol", items: MARKET_SYMBOLS.filter((s) => draft.enabledSymbols.includes(s.pair)).map((s) => [s.pair, s.label]), disabled: busy, onChange: (v) => update({ defaultSymbol: v }) }) }),
    /* @__PURE__ */ jsx11("h3", { children: t("\u0627\u0644\u0641\u0648\u0627\u0635\u0644 \u0627\u0644\u0632\u0645\u0646\u064A\u0629", "Enabled timeframes") }),
    chips("enabledTimeframes", TIMEFRAMES.map((k) => [k, FRAME_NAMES[k]])),
    /* @__PURE__ */ jsx11(SettingsRow, { icon: /* @__PURE__ */ jsx11(Settings2, {}), title: t("\u0627\u0644\u0641\u0627\u0635\u0644 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A", "Default timeframe"), children: /* @__PURE__ */ jsx11(SettingsSelect, { value: draft.defaultTimeframe, label: "Admin default timeframe", items: draft.enabledTimeframes.map((k) => [k, FRAME_NAMES[k]]), disabled: busy, onChange: (v) => update({ defaultTimeframe: v }) }) }),
    /* @__PURE__ */ jsx11("h3", { children: t("\u0623\u0646\u0648\u0627\u0639 \u0627\u0644\u0631\u0633\u0645", "Chart types") }),
    chips("enabledChartTypes", CHART_TYPES.map((k) => [k, k === "1" ? "Candles" : k === "2" ? "Line" : "Area"])),
    /* @__PURE__ */ jsx11(SettingsRow, { icon: /* @__PURE__ */ jsx11(Settings2, {}), title: t("\u0627\u0644\u0646\u0648\u0639 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A", "Default chart type"), children: /* @__PURE__ */ jsx11(SettingsSelect, { value: draft.defaultChartType, label: "Admin default chart type", items: draft.enabledChartTypes.map((k) => [k, k === "1" ? "Candles" : k === "2" ? "Line" : "Area"]), disabled: busy, onChange: (v) => update({ defaultChartType: v }) }) }),
    /* @__PURE__ */ jsx11("h3", { children: t("\u0627\u0644\u0645\u0624\u0634\u0631\u0627\u062A \u0627\u0644\u0645\u0633\u0645\u0648\u062D\u0629", "Allowed indicators") }),
    chips("allowedIndicators", INDICATORS.map((k) => [k, INDICATOR_NAMES[k]])),
    /* @__PURE__ */ jsx11("h3", { children: t("\u062E\u064A\u0627\u0631\u0627\u062A \u0627\u0644\u0639\u0631\u0636", "Display options") }),
    /* @__PURE__ */ jsxs7("section", { className: "settings-group", children: [
      [["volume", t("\u0627\u0644\u062D\u062C\u0645", "Volume")], ["gridDefault", t("\u0627\u0644\u0634\u0628\u0643\u0629 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u064B\u0627", "Grid default")], ["fullscreen", t("\u0645\u0644\u0621 \u0627\u0644\u0634\u0627\u0634\u0629", "Fullscreen")], ["favorites", t("\u0627\u0644\u0645\u0641\u0636\u0644\u0629", "Favorites")]].map(([key, label]) => /* @__PURE__ */ jsx11(SettingsRow, { icon: /* @__PURE__ */ jsx11(Settings2, {}), title: label, children: /* @__PURE__ */ jsx11(SettingsToggle, { label, value: draft[key], disabled: busy, onChange: (v) => update({ [key]: v }) }) }, key)),
      /* @__PURE__ */ jsx11(SettingsRow, { icon: /* @__PURE__ */ jsx11(LockKeyhole2, {}), title: "Crosshair", detail: t("\u0645\u0641\u0639\u0651\u0644\u061B \u0644\u0627 \u062A\u0648\u062C\u062F \u0648\u0627\u062C\u0647\u0629 \u062A\u062D\u0643\u0645 \u0645\u062F\u0639\u0648\u0645\u0629", "Enabled; no supported control API"), children: /* @__PURE__ */ jsx11(SettingsToggle, { label: "Admin crosshair", value: true, disabled: true, onChange: () => {
      } }) }),
      /* @__PURE__ */ jsx11(SettingsRow, { icon: /* @__PURE__ */ jsx11(LockKeyhole2, {}), title: t("\u062A\u0646\u0628\u064A\u0647\u0627\u062A \u0627\u0644\u0623\u0633\u0639\u0627\u0631", "Price alerts"), detail: t("\u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u062F\u0648\u0646 \u062A\u062F\u0641\u0642 \u0623\u0633\u0639\u0627\u0631 \u0644\u0644\u062E\u0627\u062F\u0645", "Requires a server-side market data feed"), children: /* @__PURE__ */ jsx11(SettingsToggle, { label: "Admin alerts", value: false, disabled: true, onChange: () => {
      } }) })
    ] }),
    /* @__PURE__ */ jsx11("h3", { children: t("\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0631\u0633\u0645", "Drawing tools") }),
    /* @__PURE__ */ jsx11("div", { className: "option-chips disabled", children: ["Trend Line", "Horizontal Line", "Vertical Line", "Fibonacci", "Rectangle", "Text", "Delete Drawings"].map((k) => /* @__PURE__ */ jsx11("span", { className: "quiet-badge", children: k }, k)) }),
    /* @__PURE__ */ jsx11("p", { className: "settings-footnote", children: t("\u0644\u0648\u062D\u0629 \u0631\u0633\u0645 ORIN \u0648\u062D\u0641\u0638 \u0627\u0644\u0631\u0633\u0648\u0645\u0627\u062A \u064A\u062D\u062A\u0627\u062C\u0627\u0646 \u0645\u0643\u062A\u0628\u0629 \u0645\u0631\u062E\u0651\u0635\u0629 \u062A\u062F\u0639\u0645 Drawing API. \u0644\u0627 \u062A\u064F\u0641\u0639\u0651\u0644 \u0647\u0630\u0647 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0641\u064A \u0627\u0644\u062A\u0643\u0627\u0645\u0644 \u0627\u0644\u062D\u0627\u0644\u064A.", "An ORIN drawing panel and drawing storage require a licensed integration with a drawing API. These tools are not enabled in the current integration.") }),
    /* @__PURE__ */ jsxs7("button", { className: "btn-primary full", type: "submit", disabled: busy || settings.configurationRevision !== revision, children: [
      /* @__PURE__ */ jsx11(Save, { size: 17 }),
      t("\u062D\u0641\u0638 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0639\u0627\u0645\u0629", "Save market configuration")
    ] }),
    /* @__PURE__ */ jsx11("p", { className: "settings-footnote", children: t("\u062D\u0641\u0638 \u0645\u0648\u062B\u0651\u0642 \u0641\u064A \u0633\u062C\u0644 \u0627\u0644\u062A\u062F\u0642\u064A\u0642. \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0639\u0631\u0636 \u0644\u0627 \u062A\u0639\u062F\u0651\u0644 \u0634\u0631\u0648\u0637 \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u0645\u0642\u0641\u0644\u0629.", "Changes are audited. Display settings do not modify locked contract terms.") })
  ] });
}

// app/account-extras.tsx
import { useEffect as useEffect6, useRef as useRef5, useState as useState7 } from "react";
import { UserRound } from "lucide-react";
import { Fragment as Fragment4, jsx as jsx12, jsxs as jsxs8 } from "react/jsx-runtime";
async function call(path, body) {
  const r = await apiFetch("/api/experience/" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}
function ProfileExtras() {
  const { t, prefs } = useOrin(), [data, setData] = useState7(null), [busy, setBusy] = useState7(false), [error, setError] = useState7(""), [saved, setSaved] = useState7(false);
  const input = useRef5(null);
  useEffect6(() => {
    let active = true;
    call("profile").then((d) => {
      if (active) setData(d);
    }).catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, []);
  const upload = async (file) => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    let url = "";
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error(t("\u0627\u062E\u062A\u0631 \u0635\u0648\u0631\u0629 JPG \u0623\u0648 PNG \u0623\u0648 WebP \u0628\u062D\u062C\u0645 \u0623\u0642\u0644 \u0645\u0646 5 \u0645\u064A\u063A\u0627\u0628\u0627\u064A\u062A.", "Choose a JPG, PNG or WebP image under 5 MB."));
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = 192;
      const ctx = canvas.getContext("2d");
      const size = Math.min(image.width, image.height);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 192, 192);
      ctx.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 192, 192);
      const photo = canvas.toDataURL("image/jpeg", 0.76);
      if (photo.length > 6e4) throw new Error(t("\u0627\u0644\u0635\u0648\u0631\u0629 \u0643\u0628\u064A\u0631\u0629. \u0627\u062E\u062A\u0631 \u0635\u0648\u0631\u0629 \u0623\u0628\u0633\u0637.", "The image is too large. Choose a simpler image."));
      await call("avatar", { photo });
      setData((d) => d ? { ...d, photo } : null);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0627\u0644\u0635\u0648\u0631\u0629.", "Unable to save image."));
    } finally {
      if (url) URL.revokeObjectURL(url);
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return /* @__PURE__ */ jsxs8("section", { className: "profile-extras", children: [
    /* @__PURE__ */ jsx12("div", { className: "profile-photo", children: data?.photo ? /* @__PURE__ */ jsx12("img", { src: data.photo, alt: t("\u0635\u0648\u0631\u062A\u0643 \u0627\u0644\u0634\u062E\u0635\u064A\u0629", "Your profile photo") }) : /* @__PURE__ */ jsx12(UserRound, {}) }),
    /* @__PURE__ */ jsxs8("div", { children: [
      /* @__PURE__ */ jsx12("button", { className: "btn-outline", disabled: busy || !data, onClick: () => input.current?.click(), children: busy ? t("\u062C\u0627\u0631 \u062D\u0641\u0638 \u0627\u0644\u0635\u0648\u0631\u0629\u2026", "Saving photo\u2026") : t("\u0627\u062E\u062A\u064A\u0627\u0631 \u0635\u0648\u0631\u0629", "Choose photo") }),
      /* @__PURE__ */ jsx12("input", { ref: input, type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true, onChange: (e) => void upload(e.target.files?.[0]) }),
      data?.photo && /* @__PURE__ */ jsx12("button", { className: "text-button", disabled: busy, onClick: async () => {
        setBusy(true);
        try {
          await call("avatar", { photo: "" });
          setData((d) => d ? { ...d, photo: "" } : null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "");
        } finally {
          setBusy(false);
        }
      }, children: t("\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u0635\u0648\u0631\u0629", "Remove photo") }),
      data?.createdAt && /* @__PURE__ */ jsxs8("p", { children: [
        t("\u0639\u0636\u0648 \u0645\u0646\u0630", "Member since"),
        " ",
        new Intl.DateTimeFormat(prefs.chartLocale + "-u-nu-latn", { dateStyle: "medium" }).format(data.createdAt)
      ] }),
      /* @__PURE__ */ jsx12("small", { children: t("\u062A\u064F\u062D\u0641\u0638 \u0635\u0648\u0631\u0629 \u0645\u0635\u063A\u0651\u0631\u0629 \u062E\u0627\u0635\u0629 \u0628\u062D\u0633\u0627\u0628\u0643.", "A small image is stored privately with your account.") })
    ] }),
    error && /* @__PURE__ */ jsx12("p", { className: "settings-error", role: "alert", children: error }),
    saved && /* @__PURE__ */ jsx12("p", { role: "status", children: t("\u062D\u064F\u0641\u0638\u062A \u0627\u0644\u0635\u0648\u0631\u0629.", "Photo saved.") })
  ] });
}
function DataControls() {
  const { settings, t, reload } = useOrin(), [confirm, setConfirm] = useState7(false), [requested, setRequested] = useState7(false), [busy, setBusy] = useState7(false), [error, setError] = useState7("");
  useEffect6(() => {
    void call("profile").then((d) => setRequested(d.deletionRequested)).catch(() => {
    });
  }, []);
  const exportData = async () => {
    setBusy(true);
    setError("");
    try {
      const profile = await call("profile");
      const value = JSON.stringify({ exportedAt: (/* @__PURE__ */ new Date()).toISOString(), version: APP_VERSION, email: settings?.email, profile: settings?.profile, preferences: settings?.preferences, createdAt: profile.createdAt, photo: profile.photo, deletionRequested: profile.deletionRequested }, null, 2);
      const link = document.createElement("a");
      link.href = "data:application/json;charset=utf-8," + encodeURIComponent(value);
      link.download = "ORIN-my-data.json";
      link.click();
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ jsxs8("div", { className: "about-data", children: [
    /* @__PURE__ */ jsx12("h3", { children: t("\u0628\u064A\u0627\u0646\u0627\u062A\u0643 \u0648\u062E\u0635\u0648\u0635\u064A\u062A\u0643", "Your data & privacy") }),
    /* @__PURE__ */ jsx12("p", { children: t("\u0646\u0632\u0651\u0644 \u0646\u0633\u062E\u0629 \u0645\u0646 \u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0644\u0641\u0643 \u0648\u0625\u0639\u062F\u0627\u062F\u0627\u062A\u0643 \u0627\u0644\u062D\u0627\u0644\u064A\u0629.", "Download your current profile and preferences.") }),
    /* @__PURE__ */ jsx12("button", { className: "btn-outline full", disabled: busy || !settings, onClick: () => void exportData(), children: t("\u062A\u0646\u0632\u064A\u0644 \u0628\u064A\u0627\u0646\u0627\u062A\u064A", "Download my data") }),
    /* @__PURE__ */ jsx12("h3", { children: t("\u0637\u0644\u0628 \u062D\u0630\u0641 \u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A", "Request account and data deletion") }),
    /* @__PURE__ */ jsx12("p", { children: t("\u0633\u064A\u064F\u0633\u062C\u0651\u0644 \u0637\u0644\u0628 \u0645\u0631\u0627\u062C\u0639\u0629 \u0644\u0644\u0625\u062F\u0627\u0631\u0629 \u0648\u062A\u064F\u0648\u0642\u0641 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0627\u062A \u0627\u0644\u062C\u062F\u064A\u062F\u0629. \u0644\u0646 \u062A\u064F\u062D\u0630\u0641 \u0628\u064A\u0627\u0646\u0627\u062A\u0643 \u0641\u0648\u0631\u064B\u0627\u060C \u0648\u0642\u062F \u062A\u062A\u0637\u0644\u0628 \u0627\u0644\u0633\u062C\u0644\u0627\u062A \u0627\u0644\u0645\u0627\u0644\u064A\u0629 \u0627\u0644\u0645\u0648\u062C\u0648\u062F\u0629 \u0645\u0631\u0627\u062C\u0639\u0629 \u0642\u0628\u0644 \u0627\u0644\u062D\u0630\u0641.", "A request will be recorded for administrator review and new participation will stop. Data is not deleted immediately; existing financial records may require review first.") }),
    requested ? /* @__PURE__ */ jsx12("p", { role: "status", children: t("\u0637\u0644\u0628\u0643 \u0645\u0633\u062C\u0651\u0644 \u0648\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629.", "Your request is recorded and pending review.") }) : /* @__PURE__ */ jsxs8(Fragment4, { children: [
      /* @__PURE__ */ jsxs8("label", { className: "check", children: [
        /* @__PURE__ */ jsx12("input", { type: "checkbox", checked: confirm, disabled: busy, onChange: (e) => setConfirm(e.target.checked) }),
        t("\u0623\u0641\u0647\u0645 \u0623\u0646 \u0647\u0630\u0627 \u0637\u0644\u0628 \u0645\u0631\u0627\u062C\u0639\u0629 \u0648\u0644\u064A\u0633 \u062D\u0630\u0641\u064B\u0627 \u0641\u0648\u0631\u064A\u064B\u0627.", "I understand this is a review request, not immediate deletion.")
      ] }),
      /* @__PURE__ */ jsx12("button", { className: "btn-outline full text-danger", disabled: !confirm || busy, onClick: async () => {
        setBusy(true);
        setError("");
        try {
          await call("deletion-request", { confirmed: true });
          setRequested(true);
          await reload();
        } catch (e) {
          setError(e instanceof Error ? e.message : "");
        } finally {
          setBusy(false);
        }
      }, children: t("\u062A\u0623\u0643\u064A\u062F \u0637\u0644\u0628 \u0627\u0644\u062D\u0630\u0641", "Confirm deletion request") })
    ] }),
    error && /* @__PURE__ */ jsx12("p", { className: "settings-error", role: "alert", children: error }),
    /* @__PURE__ */ jsx12("a", { href: "/privacy", children: t("\u0633\u064A\u0627\u0633\u0629 \u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629", "Privacy policy") }),
    /* @__PURE__ */ jsx12("a", { href: "/terms", children: t("\u0634\u0631\u0648\u0637 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645", "Terms of use") })
  ] });
}

// app/profile-settings.tsx
import { useEffect as useEffect7, useRef as useRef6, useState as useState8 } from "react";
import { UserRound as UserRound2, Mail, Phone, Globe2 as Globe22, Wallet as Wallet2, ShieldCheck as ShieldCheck3, ChevronLeft as ChevronLeft2, ChevronRight, Check as Check3, Save as Save2, LockKeyhole as LockKeyhole3 } from "lucide-react";

// lib/trading-accounts.ts
var activeTradingAccount = (directory) => directory?.accounts.find((account) => account.id === directory.activeId) ?? null;
var maskedAccountNumber = (number) => `\u2022\u2022\u2022\u2022 ${number.slice(-4)}`;

// app/profile-settings.tsx
import { Fragment as Fragment5, jsx as jsx13, jsxs as jsxs9 } from "react/jsx-runtime";
var COUNTRIES = ["AE", "SA", "SY", "IQ", "JO", "LB", "KW", "QA", "BH", "OM", "EG", "PS", "YE", "TR", "MA", "DZ", "TN", "LY", "SD", "US", "GB", "CA", "AU", "DE", "FR", "IT", "ES", "NL", "SE", "CH", "IN", "PK", "ID", "MY", "SG", "JP", "KR", "BR", "MX", "ZA"];
function ProfileSettings({ state, onSecurity, onPrivacy }) {
  const { settings, prefs, t, status, error, saveProfile } = useOrin(), profile = settings?.profile;
  const [draft, setDraft] = useState8(profile ?? {}), [dirty, setDirty] = useState8(false), [saved, setSaved] = useState8(false), [closing, setClosing] = useState8(false);
  const identity2 = useRef6(settings?.clientId), busy = status === "saving" || status === "loading", account = activeTradingAccount(state?.accountDirectory), Chevron = prefs.chartLocale === "ar" ? ChevronLeft2 : ChevronRight;
  useEffect7(() => {
    if (identity2.current !== settings?.clientId) {
      identity2.current = settings?.clientId;
      setDraft(profile ?? {});
      setDirty(false);
      setSaved(false);
      setClosing(false);
    } else if (!dirty) setDraft(profile ?? {});
  }, [settings?.clientId, profile, dirty]);
  const edit = (patch) => {
    setDraft((old) => ({ ...old, ...patch }));
    setDirty(true);
    setSaved(false);
  };
  return /* @__PURE__ */ jsxs9("div", { className: "profile-settings-v4", children: [
    /* @__PURE__ */ jsxs9("section", { className: "profile-identity-card", children: [
      /* @__PURE__ */ jsxs9("div", { className: "profile-identity-heading", children: [
        /* @__PURE__ */ jsxs9("span", { children: [
          /* @__PURE__ */ jsx13("h2", { children: profile?.displayName || state?.user.name || t("\u062D\u0633\u0627\u0628\u0643 \u0641\u064A ORIN", "Your ORIN account") }),
          /* @__PURE__ */ jsx13("p", { dir: "ltr", children: settings?.email || "\u2014" })
        ] }),
        /* @__PURE__ */ jsx13("span", { className: "profile-member-badge", children: settings?.isAdmin || state?.isAdmin ? t("\u0645\u0633\u0624\u0648\u0644", "Admin") : t("\u062D\u0633\u0627\u0628 \u0634\u062E\u0635\u064A", "Personal account") })
      ] }),
      firebaseMode() ? /* @__PURE__ */ jsx13(ProfileExtras, {}) : /* @__PURE__ */ jsx13("div", { className: "profile-local-avatar", children: /* @__PURE__ */ jsx13(UserRound2, { size: 30 }) })
    ] }),
    /* @__PURE__ */ jsxs9("section", { className: "profile-account-summary", children: [
      /* @__PURE__ */ jsx13("span", { className: "profile-section-icon", children: /* @__PURE__ */ jsx13(Wallet2, { size: 21 }) }),
      /* @__PURE__ */ jsxs9("div", { children: [
        /* @__PURE__ */ jsx13("strong", { children: account ? t(account.type === "real" ? "\u062D\u0633\u0627\u0628 \u062D\u0642\u064A\u0642\u064A" : "\u062D\u0633\u0627\u0628 \u062A\u062C\u0631\u064A\u0628\u064A", account.type === "real" ? "Real account" : "Demo account") : t("\u062D\u0633\u0627\u0628 ORIN", "ORIN account") }),
        /* @__PURE__ */ jsx13("small", { children: account ? /* @__PURE__ */ jsxs9("bdi", { children: [
          account.currency,
          " \xB7 ",
          maskedAccountNumber(account.accountNumber)
        ] }) : t("\u0627\u062E\u062A\u0631 \u062D\u0633\u0627\u0628 \u0627\u0644\u062A\u062F\u0627\u0648\u0644 \u0645\u0646 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629", "Select a trading account on Home") })
      ] }),
      /* @__PURE__ */ jsx13("span", { className: "profile-status-pill", children: profile?.closureStatus === "requested" ? t("\u0637\u0644\u0628 \u0625\u063A\u0644\u0627\u0642", "Closure requested") : t("\u0645\u0641\u062A\u0648\u062D", "Open") })
    ] }),
    /* @__PURE__ */ jsxs9("form", { className: "profile-details-card", "aria-busy": busy, onSubmit: async (e) => {
      e.preventDefault();
      if (busy || !dirty) return;
      if (await saveProfile({ displayName: draft.displayName?.trim(), phone: draft.phone?.trim(), country: draft.country })) {
        setDirty(false);
        setSaved(true);
      }
    }, children: [
      /* @__PURE__ */ jsxs9("div", { className: "profile-section-heading", children: [
        /* @__PURE__ */ jsx13("span", { className: "profile-section-icon", children: /* @__PURE__ */ jsx13(UserRound2, { size: 20 }) }),
        /* @__PURE__ */ jsxs9("div", { children: [
          /* @__PURE__ */ jsx13("h2", { children: t("\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0634\u062E\u0635\u064A\u0629", "Personal details") }),
          /* @__PURE__ */ jsx13("p", { children: t("\u0627\u062D\u062A\u0641\u0638 \u0628\u0628\u064A\u0627\u0646\u0627\u062A \u062D\u0633\u0627\u0628\u0643 \u0635\u062D\u064A\u062D\u0629.", "Keep your account details accurate.") })
        ] })
      ] }),
      /* @__PURE__ */ jsxs9("label", { children: [
        t("\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644", "Full name"),
        /* @__PURE__ */ jsxs9("span", { className: "profile-input", children: [
          /* @__PURE__ */ jsx13(UserRound2, { size: 19, "aria-hidden": "true" }),
          /* @__PURE__ */ jsx13("input", { autoComplete: "name", value: draft.displayName ?? "", minLength: 2, maxLength: 100, required: true, disabled: !settings || busy, onChange: (e) => edit({ displayName: e.target.value }) })
        ] })
      ] }),
      /* @__PURE__ */ jsxs9("label", { children: [
        t("\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A", "Email address"),
        /* @__PURE__ */ jsxs9("span", { className: "profile-input is-readonly", children: [
          /* @__PURE__ */ jsx13(Mail, { size: 19, "aria-hidden": "true" }),
          /* @__PURE__ */ jsx13("input", { type: "email", dir: "ltr", value: settings?.email ?? "", readOnly: true, autoComplete: "email" }),
          /* @__PURE__ */ jsx13(LockKeyhole3, { size: 15, "aria-hidden": "true" })
        ] }),
        /* @__PURE__ */ jsx13("small", { children: t("\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0644\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644.", "The email you use to sign in.") })
      ] }),
      /* @__PURE__ */ jsxs9("div", { className: "profile-contact-grid", children: [
        /* @__PURE__ */ jsxs9("label", { children: [
          t("\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641", "Phone number"),
          /* @__PURE__ */ jsxs9("span", { className: "profile-input", children: [
            /* @__PURE__ */ jsx13(Phone, { size: 18, "aria-hidden": "true" }),
            /* @__PURE__ */ jsx13("input", { type: "tel", inputMode: "tel", autoComplete: "tel", dir: "ltr", placeholder: "+\u2026", value: draft.phone ?? "", maxLength: 24, disabled: !settings || busy, onChange: (e) => edit({ phone: e.target.value }) })
          ] }),
          /* @__PURE__ */ jsx13("small", { children: t("\u0631\u0642\u0645 \u0644\u0644\u062A\u0648\u0627\u0635\u0644\u061B \u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646\u0647.", "Contact number; not verified.") })
        ] }),
        /* @__PURE__ */ jsxs9("label", { children: [
          t("\u0627\u0644\u062F\u0648\u0644\u0629", "Country"),
          /* @__PURE__ */ jsxs9("span", { className: "profile-input", children: [
            /* @__PURE__ */ jsx13(Globe22, { size: 19, "aria-hidden": "true" }),
            /* @__PURE__ */ jsxs9("select", { autoComplete: "country", value: draft.country ?? "", disabled: !settings || busy, onChange: (e) => edit({ country: e.target.value }), children: [
              /* @__PURE__ */ jsx13("option", { value: "", children: t("\u0627\u062E\u062A\u0631 \u0627\u0644\u062F\u0648\u0644\u0629", "Choose country") }),
              [.../* @__PURE__ */ new Set([...COUNTRIES, ...draft.country ? [draft.country] : []])].filter((code) => /^[A-Z]{2}$/.test(code)).map((code) => /* @__PURE__ */ jsx13("option", { value: code, children: new Intl.DisplayNames([prefs.chartLocale], { type: "region" }).of(code) }, code))
            ] })
          ] })
        ] })
      ] }),
      error && /* @__PURE__ */ jsx13("p", { className: "profile-form-error", role: "alert", children: error }),
      /* @__PURE__ */ jsxs9("div", { className: "profile-save-row", children: [
        /* @__PURE__ */ jsx13("p", { role: "status", children: saved ? /* @__PURE__ */ jsxs9(Fragment5, { children: [
          /* @__PURE__ */ jsx13(Check3, { size: 15 }),
          t("\u062D\u064F\u0641\u0638\u062A \u0628\u064A\u0627\u0646\u0627\u062A\u0643", "Your details are saved")
        ] }) : dirty ? t("\u0644\u062F\u064A\u0643 \u062A\u063A\u064A\u064A\u0631\u0627\u062A \u063A\u064A\u0631 \u0645\u062D\u0641\u0648\u0638\u0629", "You have unsaved changes") : t("\u0628\u064A\u0627\u0646\u0627\u062A\u0643 \u0627\u0644\u062D\u0627\u0644\u064A\u0629", "Your current details") }),
        /* @__PURE__ */ jsxs9("button", { className: "btn-primary", type: "submit", disabled: !settings || busy || !dirty, children: [
          /* @__PURE__ */ jsx13(Save2, { size: 17 }),
          busy ? t("\u062C\u0627\u0631 \u0627\u0644\u062D\u0641\u0638\u2026", "Saving\u2026") : t("\u062D\u0641\u0638 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A", "Save changes")
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs9("section", { className: "profile-protection-card", children: [
      /* @__PURE__ */ jsx13("h2", { children: t("\u0627\u0644\u0623\u0645\u0627\u0646 \u0648\u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629", "Security & privacy") }),
      /* @__PURE__ */ jsxs9("button", { type: "button", onClick: onSecurity, children: [
        /* @__PURE__ */ jsx13("span", { className: "profile-section-icon", children: /* @__PURE__ */ jsx13(ShieldCheck3, { size: 21 }) }),
        /* @__PURE__ */ jsxs9("span", { children: [
          /* @__PURE__ */ jsx13("strong", { children: t("\u0623\u0645\u0627\u0646 \u0627\u0644\u062D\u0633\u0627\u0628", "Account security") }),
          /* @__PURE__ */ jsx13("small", { children: t("\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0648\u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0628\u0631\u064A\u062F", "Password and email verification") })
        ] }),
        /* @__PURE__ */ jsx13(Chevron, { size: 17 })
      ] }),
      /* @__PURE__ */ jsxs9("button", { type: "button", onClick: onPrivacy, children: [
        /* @__PURE__ */ jsx13("span", { className: "profile-section-icon", children: /* @__PURE__ */ jsx13(LockKeyhole3, { size: 20 }) }),
        /* @__PURE__ */ jsxs9("span", { children: [
          /* @__PURE__ */ jsx13("strong", { children: t("\u0628\u064A\u0627\u0646\u0627\u062A\u064A \u0648\u062E\u0635\u0648\u0635\u064A\u062A\u064A", "My data & privacy") }),
          /* @__PURE__ */ jsx13("small", { children: t("\u062A\u0646\u0632\u064A\u0644 \u0628\u064A\u0627\u0646\u0627\u062A\u0643 \u0648\u0625\u062F\u0627\u0631\u0629 \u0637\u0644\u0628\u0627\u062A \u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629", "Download your data and manage privacy requests") })
        ] }),
        /* @__PURE__ */ jsx13(Chevron, { size: 17 })
      ] }),
      /* @__PURE__ */ jsx13("p", { className: "profile-verification-note", children: t("\u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0647\u0648\u064A\u0629: \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u062D\u0627\u0644\u064A\u064B\u0627.", "Identity verification is not currently available.") })
    ] }),
    /* @__PURE__ */ jsxs9("details", { className: "profile-advanced", children: [
      /* @__PURE__ */ jsx13("summary", { children: t("\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u062D\u0633\u0627\u0628", "Account management") }),
      /* @__PURE__ */ jsx13("button", { className: "text-danger", type: "button", disabled: !settings || busy || profile?.closureStatus === "requested", onClick: () => setClosing(!closing), children: profile?.closureStatus === "requested" ? t("\u0637\u0644\u0628 \u0627\u0644\u0625\u063A\u0644\u0627\u0642 \u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629", "Closure request under review") : t("\u0637\u0644\u0628 \u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u062D\u0633\u0627\u0628", "Request account closure") }),
      closing && /* @__PURE__ */ jsxs9("div", { className: "closure-confirm", children: [
        /* @__PURE__ */ jsx13("p", { children: t("\u064A\u064F\u0633\u062C\u0651\u0644 \u0627\u0644\u0637\u0644\u0628 \u0644\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0648\u062A\u064F\u062D\u0641\u0638 \u0627\u0644\u0633\u062C\u0644\u0627\u062A \u0627\u0644\u0645\u0627\u0644\u064A\u0629. \u0644\u0627 \u064A\u0624\u062F\u064A \u0625\u0644\u0649 \u062D\u0630\u0641 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0641\u0648\u0631\u064B\u0627. \u0623\u0643\u0645\u0644 \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u0646\u0634\u0637\u0629 \u0623\u0648\u0644\u064B\u0627.", "This records a request for review and retains financial records. It does not immediately delete data. Settle active contracts first.") }),
        /* @__PURE__ */ jsx13("button", { className: "btn-outline full", type: "button", disabled: busy, onClick: async () => {
          if (await saveProfile({}, true)) setClosing(false);
        }, children: t("\u062A\u0623\u0643\u064A\u062F \u0637\u0644\u0628 \u0627\u0644\u0625\u063A\u0644\u0627\u0642", "Confirm closure request") })
      ] })
    ] })
  ] });
}

// app/account-settings.tsx
import { Fragment as Fragment6, jsx as jsx14, jsxs as jsxs10 } from "react/jsx-runtime";
function SettingsToggle({ value, onChange, label, disabled = false }) {
  return /* @__PURE__ */ jsx14(Switch, { checked: value, onCheckedChange: onChange, "aria-label": label, className: `settings-switch ${value ? "on" : ""}`, disabled });
}
function SettingsRow({ icon, title, detail, children, onClick }) {
  const { prefs } = useOrin();
  const content = /* @__PURE__ */ jsxs10(Fragment6, { children: [
    /* @__PURE__ */ jsx14("span", { className: "setting-icon", children: icon }),
    /* @__PURE__ */ jsxs10("span", { className: "setting-copy", children: [
      /* @__PURE__ */ jsx14("b", { children: title }),
      detail && /* @__PURE__ */ jsx14("small", { children: detail })
    ] }),
    children ?? (prefs.chartLocale === "ar" ? /* @__PURE__ */ jsx14(ChevronLeft3, { className: "setting-chevron" }) : /* @__PURE__ */ jsx14(ChevronRight2, { className: "setting-chevron" }))
  ] });
  return onClick ? /* @__PURE__ */ jsx14("button", { className: "settings-row", onClick, children: content }) : /* @__PURE__ */ jsx14("div", { className: "settings-row", children: content });
}
function SettingsSelect({ value, label, items, onChange, disabled = false }) {
  return /* @__PURE__ */ jsxs10(Select, { value, onValueChange: onChange, disabled, children: [
    /* @__PURE__ */ jsx14(SelectTrigger, { className: "settings-native-select", "aria-label": label, children: /* @__PURE__ */ jsx14(SelectValue, {}) }),
    /* @__PURE__ */ jsx14(SelectContent, { children: items.map(([v, t]) => /* @__PURE__ */ jsx14(SelectItem, { value: v, children: t }, v)) })
  ] });
}
var EVENT_NAMES = { opportunity: ["\u0641\u0631\u0635\u0629 \u062C\u062F\u064A\u062F\u0629", "New opportunity"], contract_started: ["\u0639\u0642\u062F \u0628\u062F\u0623", "Contract started"], contract_ended: ["\u0639\u0642\u062F \u0627\u0646\u062A\u0647\u0649", "Contract ended"], settlement: ["\u0646\u062A\u064A\u062C\u0629 \u062A\u0633\u0648\u064A\u0629", "Settlement result"], deposit: ["\u0625\u064A\u062F\u0627\u0639", "Deposit"], withdrawal: ["\u0633\u062D\u0628", "Withdrawal"], referral: ["\u0625\u062D\u0627\u0644\u0629 \u0646\u0627\u062C\u062D\u0629", "Successful referral"], agent: ["\u062A\u0631\u0642\u064A\u0629 Agent", "Agent upgrade"], support: ["\u0627\u0644\u062F\u0639\u0645", "Support"], security: ["\u062A\u0646\u0628\u064A\u0647\u0627\u062A \u0627\u0644\u0623\u0645\u0627\u0646", "Security alerts"], announcement: ["\u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A", "Announcements"], reminder: ["\u0627\u0644\u062A\u0630\u0643\u064A\u0631\u0627\u062A", "Reminders"] };
var FRAME_NAMES = { "1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", "D": "1D" };
var INDICATOR_NAMES = { MA: "Moving Average", EMA: "EMA", RSI: "RSI", MACD: "MACD", BB: "Bollinger Bands" };
function ChartPreferences() {
  const { prefs, configuration: c, change, t, status } = useOrin();
  const busy = status === "saving" || status === "loading";
  return /* @__PURE__ */ jsxs10(Fragment6, { children: [
    /* @__PURE__ */ jsxs10("section", { className: "settings-group", children: [
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(ChartCandlestick, {}), title: t("\u0646\u0648\u0639 \u0627\u0644\u0634\u0627\u0631\u062A", "Chart type"), children: /* @__PURE__ */ jsx14(SettingsSelect, { label: t("\u0646\u0648\u0639 \u0627\u0644\u0634\u0627\u0631\u062A", "Chart type"), value: prefs.chartStyle, items: c.enabledChartTypes.map((k) => [k, k === "1" ? t("\u0634\u0645\u0648\u0639", "Candles") : k === "2" ? t("\u062E\u0637\u064A", "Line") : t("\u0645\u0633\u0627\u062D\u0629", "Area")]), disabled: busy, onChange: (v) => void change({ chartStyle: v }) }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Globe23, {}), title: t("\u0627\u0644\u0623\u0635\u0644 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A", "Default symbol"), children: /* @__PURE__ */ jsx14(SettingsSelect, { label: t("\u0627\u0644\u0623\u0635\u0644 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A", "Default symbol"), value: prefs.chartPair, items: MARKET_SYMBOLS.filter((s) => c.enabledSymbols.includes(s.pair)).map((s) => [s.pair, s.label]), disabled: busy, onChange: (v) => void change({ chartPair: v }) }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(SlidersHorizontal, {}), title: t("\u0627\u0644\u0641\u0627\u0635\u0644 \u0627\u0644\u0632\u0645\u0646\u064A", "Default timeframe"), children: /* @__PURE__ */ jsx14(SettingsSelect, { label: t("\u0627\u0644\u0641\u0627\u0635\u0644 \u0627\u0644\u0632\u0645\u0646\u064A", "Default timeframe"), value: prefs.chartInterval, items: c.enabledTimeframes.map((k) => [k, FRAME_NAMES[k]]), disabled: busy, onChange: (v) => void change({ chartInterval: v }) }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Palette, {}), title: t("\u0645\u0638\u0647\u0631 \u0627\u0644\u0634\u0627\u0631\u062A", "Chart theme"), detail: t("\u064A\u062A\u0628\u0639 \u0645\u0638\u0647\u0631 ORIN", "Follows ORIN appearance"), children: /* @__PURE__ */ jsx14("span", { className: "quiet-badge", children: prefs.theme === "system" ? t("\u0627\u0644\u0646\u0638\u0627\u0645", "System") : prefs.theme === "dark" ? t("\u062F\u0627\u0643\u0646", "Dark") : t("\u0641\u0627\u062A\u062D", "Light") }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(SlidersHorizontal, {}), title: t("\u062E\u0637\u0648\u0637 \u0627\u0644\u0634\u0628\u0643\u0629", "Grid"), children: /* @__PURE__ */ jsx14(SettingsToggle, { label: "Grid", value: prefs.grid, disabled: busy, onChange: (v) => void change({ grid: v }) }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Info, {}), title: "Crosshair", detail: t("\u0645\u062A\u0627\u062D \u062F\u0627\u062E\u0644 \u0627\u0644\u0634\u0627\u0631\u062A\u061B \u0627\u0644\u062A\u062D\u0643\u0645 \u0628\u0647 \u0645\u0646 \u0627\u0644\u0645\u0632\u0648\u062F", "Available in chart; managed by provider"), children: /* @__PURE__ */ jsx14(SettingsToggle, { label: "Crosshair", value: true, disabled: true, onChange: () => {
      } }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Info, {}), title: t("\u062E\u0637 \u0627\u0644\u0633\u0639\u0631 \u0627\u0644\u062D\u0627\u0644\u064A", "Current price line"), detail: t("\u0645\u062A\u0627\u062D \u062F\u0627\u062E\u0644 \u0627\u0644\u0634\u0627\u0631\u062A\u061B \u0627\u0644\u062A\u062D\u0643\u0645 \u0628\u0647 \u0645\u0646 \u0627\u0644\u0645\u0632\u0648\u062F", "Available in chart; managed by provider"), children: /* @__PURE__ */ jsx14(SettingsToggle, { label: "Price line", value: true, disabled: true, onChange: () => {
      } }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(LockKeyhole4, {}), title: t("\u062D\u0641\u0638 \u0627\u0644\u0631\u0633\u0648\u0645\u0627\u062A", "Save drawings"), detail: t("\u064A\u062A\u0637\u0644\u0628 \u062A\u0643\u0627\u0645\u0644\u064B\u0627 \u064A\u062F\u0639\u0645 Drawing API", "Requires an integration with a drawing API"), children: /* @__PURE__ */ jsx14(SettingsToggle, { label: "Save drawings", value: false, disabled: true, onChange: () => {
      } }) })
    ] }),
    /* @__PURE__ */ jsx14("h3", { className: "settings-section-label", children: t("\u0627\u0644\u0645\u0624\u0634\u0631\u0627\u062A \u0627\u0644\u0645\u0633\u0645\u0648\u062D\u0629", "Allowed indicators") }),
    /* @__PURE__ */ jsxs10("div", { className: "option-chips", children: [
      c.allowedIndicators.map((k) => /* @__PURE__ */ jsxs10("button", { disabled: busy, "aria-pressed": prefs.indicators.includes(k), className: prefs.indicators.includes(k) ? "selected" : "", onClick: () => void change({ indicators: prefs.indicators.includes(k) ? prefs.indicators.filter((x) => x !== k) : [...prefs.indicators, k] }), children: [
        prefs.indicators.includes(k) && /* @__PURE__ */ jsx14(Check4, { size: 14 }),
        " ",
        INDICATOR_NAMES[k]
      ] }, k)),
      !c.allowedIndicators.length && /* @__PURE__ */ jsx14("p", { children: t("\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0624\u0634\u0631\u0627\u062A \u0645\u0641\u0639\u0644\u0629 \u0645\u0646 \u0627\u0644\u0625\u062F\u0627\u0631\u0629.", "No indicators enabled by the administrator.") })
    ] }),
    /* @__PURE__ */ jsxs10("button", { className: "btn-outline full settings-reset", disabled: busy, onClick: () => void change({ chartPair: c.defaultSymbol, chartInterval: c.defaultTimeframe, chartStyle: c.defaultChartType, grid: c.gridDefault, indicators: [] }), children: [
      /* @__PURE__ */ jsx14(RefreshCw, { size: 16 }),
      t("\u0625\u0639\u0627\u062F\u0629 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0634\u0627\u0631\u062A", "Reset chart")
    ] }),
    /* @__PURE__ */ jsx14("p", { className: "settings-footnote", children: t("\u062A\u064F\u0637\u0628\u0651\u0642 \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u064A \u064A\u0633\u0645\u062D \u0628\u0647\u0627 \u062A\u0643\u0627\u0645\u0644 TradingView. \u064A\u0638\u0644 \u0634\u0639\u0627\u0631 \u0627\u0644\u0645\u0635\u062F\u0631 \u0638\u0627\u0647\u0631\u064B\u0627.", "Only supported TradingView options are applied. Provider attribution remains visible.") })
  ] });
}
function AppearanceSettings() {
  const { prefs, t, change, status } = useOrin();
  const busy = status === "saving" || status === "loading";
  return /* @__PURE__ */ jsxs10(Fragment6, { children: [
    /* @__PURE__ */ jsx14("h3", { className: "settings-section-label", children: t("\u0627\u062E\u062A\u0631 \u0627\u0644\u0645\u0638\u0647\u0631", "Choose appearance") }),
    /* @__PURE__ */ jsx14("div", { className: "theme-picker", children: [["light", Sun, t("\u0641\u0627\u062A\u062D", "Light")], ["dark", Moon, t("\u062F\u0627\u0643\u0646", "Dark")], ["system", Monitor2, t("\u0627\u0644\u0646\u0638\u0627\u0645", "System")]].map(([v, Icon, label]) => /* @__PURE__ */ jsxs10("button", { className: prefs.theme === v ? "selected" : "", "aria-pressed": prefs.theme === v, disabled: busy, onClick: () => void change({ theme: v }), children: [
      /* @__PURE__ */ jsx14("span", { className: `theme-preview ${v}`, children: /* @__PURE__ */ jsx14(Icon, {}) }),
      label,
      prefs.theme === v && /* @__PURE__ */ jsx14(Check4, { size: 15 })
    ] }, v)) }),
    /* @__PURE__ */ jsxs10("section", { className: "settings-group", children: [
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Globe23, {}), title: t("\u0644\u063A\u0629 \u0627\u0644\u062A\u0637\u0628\u064A\u0642", "App language"), children: /* @__PURE__ */ jsx14(SettingsSelect, { value: prefs.chartLocale, label: "Language", items: [["ar", "\u0627\u0644\u0639\u0631\u0628\u064A\u0629"], ["en", "English"], ["tr", "T\xFCrk\xE7e"], ["de", "Deutsch"]], disabled: busy, onChange: (v) => void change({ chartLocale: v }) }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Palette, {}), title: t("\u062D\u062C\u0645 \u0627\u0644\u062E\u0637", "Font size"), children: /* @__PURE__ */ jsx14(SettingsSelect, { value: prefs.fontSize, label: "Font size", items: [["small", t("\u0635\u063A\u064A\u0631", "Small")], ["normal", t("\u0645\u062A\u0648\u0633\u0637", "Default")], ["large", t("\u0643\u0628\u064A\u0631", "Large")]], disabled: busy, onChange: (v) => void change({ fontSize: v }) }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(SlidersHorizontal, {}), title: t("\u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u0623\u0631\u0642\u0627\u0645", "Number format"), detail: t("\u0623\u0631\u0642\u0627\u0645 \u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629 \u0641\u064A \u062C\u0645\u064A\u0639 \u0627\u0644\u0644\u063A\u0627\u062A", "Latin digits in all languages"), children: /* @__PURE__ */ jsx14("span", { className: "num", children: "1,234.56" }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Wallet3, {}), title: t("\u0627\u0644\u0639\u0645\u0644\u0629 \u0627\u0644\u0645\u0631\u062C\u0639\u064A\u0629", "Reference currency"), detail: t("\u062A\u0641\u0636\u064A\u0644 \u0645\u062D\u0641\u0648\u0638\u061B \u0627\u0644\u0623\u0631\u0635\u062F\u0629 \u0648\u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u062A\u0628\u0642\u0649 USD \u062D\u062A\u0649 \u062A\u0648\u0635\u064A\u0644 \u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u0639\u0645\u0644\u0627\u062A.", "Saved preference; balances and settlement remain USD until FX conversion is connected."), children: /* @__PURE__ */ jsx14(SettingsSelect, { value: prefs.referenceCurrency, label: "Reference currency", items: [["USD", "USD"], ["EUR", "EUR"], ["GBP", "GBP"]], disabled: busy, onChange: (v) => void change({ referenceCurrency: v }) }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Globe23, {}), title: t("\u0627\u0644\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0632\u0645\u0646\u064A\u0629", "Time zone"), children: /* @__PURE__ */ jsx14(SettingsSelect, { value: prefs.timezone, label: "Time zone", items: Array.from(/* @__PURE__ */ new Set([prefs.timezone, "Etc/UTC", Intl.DateTimeFormat().resolvedOptions().timeZone, "Asia/Damascus", "Asia/Riyadh", "Asia/Dubai", "Europe/London", "Europe/Paris", "America/New_York", "Asia/Tokyo"])).map((v) => [v, v.replaceAll("_", " ")]), disabled: busy, onChange: (v) => void change({ timezone: v }) }) }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Monitor2, {}), title: t("\u062A\u0642\u0644\u064A\u0644 \u0627\u0644\u062D\u0631\u0643\u0629", "Reduce motion"), children: /* @__PURE__ */ jsx14(SettingsToggle, { label: "Reduce motion", value: prefs.reduceMotion, disabled: busy, onChange: (v) => void change({ reduceMotion: v }) }) })
    ] })
  ] });
}
function AccountSettings({ state, onTerms, onAdmin, onLedger, onNotifications }) {
  const { prefs, settings, status, error, t, change, reload } = useOrin();
  const [panel, setPanel] = useRoutePanel("/settings", ["account", "appearance", "security", "notifications", "chart", "about", "admin", "language", "devices", "privacy", "documents", "support", "referral", "agent", "two-factor", "authenticator", "data"]);
  const navigation = useNavigation();
  const busy = status === "saving" || status === "loading";
  const titles = { account: t("\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A", "Your profile"), appearance: t("\u0627\u0644\u0645\u0638\u0647\u0631", "Appearance"), security: t("\u0645\u0631\u0643\u0632 \u0627\u0644\u0623\u0645\u0627\u0646", "Security center"), notifications: t("\u062A\u0641\u0636\u064A\u0644\u0627\u062A \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A", "Notification preferences"), chart: t("\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0634\u0627\u0631\u062A", "Chart settings"), about: t("\u062D\u0648\u0644 ORIN", "About ORIN"), admin: t("\u0625\u062F\u0627\u0631\u0629 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0634\u0627\u0631\u062A", "Admin chart settings"), language: t("\u0627\u0644\u0644\u063A\u0629", "Language"), devices: t("\u0627\u0644\u0623\u062C\u0647\u0632\u0629", "Devices"), privacy: t("\u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629", "Privacy"), documents: t("\u0627\u0644\u0645\u0633\u062A\u0646\u062F\u0627\u062A", "Documents"), support: t("\u0627\u0644\u062F\u0639\u0645", "Support"), referral: t("\u0645\u0631\u0643\u0632 \u0627\u0644\u0625\u062D\u0627\u0644\u0627\u062A", "Referral center"), agent: t("\u0645\u0631\u0643\u0632 \u0627\u0644\u0648\u0643\u0644\u0627\u0621", "Agent center"), "two-factor": t("\u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629", "Two-factor authentication"), data: t("\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0648\u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629", "Data & privacy"), authenticator: t("\u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629", "Authenticator setup") };
  const profile = settings?.profile;
  const activeAccount = state?.accountDirectory?.accounts.find((a) => a.id === state.accountDirectory?.activeId);
  const tier = state?.user.tier === "advanced" ? t("\u0645\u062A\u0642\u062F\u0645", "Advanced") : t("\u0642\u064A\u0627\u0633\u064A", "Standard");
  const syncText = status === "saving" ? t("\u062C\u0627\u0631 \u0627\u0644\u062D\u0641\u0638\u2026", "Saving\u2026") : status === "loading" ? t("\u062C\u0627\u0631 \u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629\u2026", "Syncing\u2026") : status === "synced" ? t("\u0645\u062A\u0632\u0627\u0645\u0646 \u0645\u0639 \u062D\u0633\u0627\u0628\u0643", "Synced to your account") : status === "guest" ? t("\u062A\u0641\u0636\u064A\u0644\u0627\u062A \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \xB7 \u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0644\u0644\u0645\u0632\u0627\u0645\u0646\u0629", "This device only \xB7 Sign in to sync") : t("\u062A\u0639\u0630\u0631\u062A \u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629", "Sync unavailable");
  return /* @__PURE__ */ jsxs10("div", { className: "settings-page settings-refresh", dir: prefs.chartLocale === "ar" ? "rtl" : "ltr", children: [
    /* @__PURE__ */ jsxs10("div", { className: "settings-heading", children: [
      /* @__PURE__ */ jsxs10("span", { className: "eyebrow", children: [
        /* @__PURE__ */ jsx14("img", { src: "/brand/orin-mark.png", alt: "", width: "22", height: "22" }),
        " YOUR ORIN"
      ] }),
      /* @__PURE__ */ jsx14("h1", { children: t("\u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A", "Account & settings") }),
      /* @__PURE__ */ jsx14("p", { children: t("\u062A\u062C\u0631\u0628\u0629 \u0645\u0635\u0645\u0645\u0629 \u0639\u0644\u0649 \u0637\u0631\u064A\u0642\u062A\u0643.", "Make ORIN feel like you.") })
    ] }),
    /* @__PURE__ */ jsxs10("button", { className: "settings-profile", onClick: () => setPanel("account"), children: [
      /* @__PURE__ */ jsx14("span", { className: "settings-avatar", children: /* @__PURE__ */ jsx14(UserRound3, {}) }),
      /* @__PURE__ */ jsxs10("span", { children: [
        /* @__PURE__ */ jsx14("strong", { children: profile?.displayName || state?.user.name || t("\u0645\u0631\u062D\u0628\u064B\u0627 \u0628\u0643 \u0641\u064A ORIN", "Welcome to ORIN") }),
        /* @__PURE__ */ jsx14("small", { children: settings?.email ?? t("\u062D\u0633\u0627\u0628\u0643 \u0627\u0644\u0634\u062E\u0635\u064A", "Your personal account") }),
        /* @__PURE__ */ jsxs10("span", { className: "profile-badges", children: [
          /* @__PURE__ */ jsx14("b", { children: activeAccount?.type === "real" ? t("\u062D\u0633\u0627\u0628 \u062D\u0642\u064A\u0642\u064A", "Real account") : activeAccount?.type === "demo" ? t("\u062D\u0633\u0627\u0628 \u062A\u062C\u0631\u064A\u0628\u064A", "Demo account") : t("\u062D\u0633\u0627\u0628\u0643 \u0627\u0644\u0634\u062E\u0635\u064A", "Your personal account") }),
          /* @__PURE__ */ jsx14("i", { children: tier })
        ] })
      ] }),
      prefs.chartLocale === "ar" ? /* @__PURE__ */ jsx14(ChevronLeft3, {}) : /* @__PURE__ */ jsx14(ChevronRight2, {})
    ] }),
    /* @__PURE__ */ jsxs10("div", { className: `settings-sync ${status}`, role: "status", children: [
      /* @__PURE__ */ jsx14("span", {}),
      syncText,
      status === "error" && /* @__PURE__ */ jsx14("button", { onClick: () => void reload(), "aria-label": t("\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629", "Retry sync"), children: /* @__PURE__ */ jsx14(RefreshCw, { size: 15 }) })
    ] }),
    error && /* @__PURE__ */ jsx14("p", { className: "settings-error", children: error }),
    /* @__PURE__ */ jsxs10("div", { className: "settings-shortcuts", children: [
      /* @__PURE__ */ jsxs10("button", { onClick: () => setPanel("appearance"), children: [
        /* @__PURE__ */ jsx14("span", { children: /* @__PURE__ */ jsx14(Palette, {}) }),
        /* @__PURE__ */ jsx14("b", { children: t("\u0627\u0644\u0645\u0638\u0647\u0631", "Appearance") }),
        /* @__PURE__ */ jsx14("small", { children: prefs.theme === "dark" ? t("\u062F\u0627\u0643\u0646", "Dark") : prefs.theme === "system" ? t("\u0627\u0644\u0646\u0638\u0627\u0645", "System") : t("\u0641\u0627\u062A\u062D", "Light") })
      ] }),
      /* @__PURE__ */ jsxs10("button", { onClick: () => setPanel("language"), children: [
        /* @__PURE__ */ jsx14("span", { children: /* @__PURE__ */ jsx14(Globe23, {}) }),
        /* @__PURE__ */ jsx14("b", { children: t("\u0627\u0644\u0644\u063A\u0629", "Language") }),
        /* @__PURE__ */ jsx14("small", { children: { ar: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", en: "English", tr: "T\xFCrk\xE7e", de: "Deutsch" }[prefs.chartLocale] })
      ] })
    ] }),
    /* @__PURE__ */ jsx14("h2", { className: "settings-section-label", children: t("\u062D\u0633\u0627\u0628\u0643 \u0648\u062E\u0635\u0648\u0635\u064A\u062A\u0643", "Your account & privacy") }),
    /* @__PURE__ */ jsxs10("section", { className: "settings-group", children: [
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(UserRound3, {}), title: t("\u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A", "Account & profile"), detail: t("\u0628\u064A\u0627\u0646\u0627\u062A\u0643 \u0627\u0644\u0634\u062E\u0635\u064A\u0629 \u0648\u0637\u0631\u0642 \u0627\u0644\u062A\u0648\u0627\u0635\u0644", "Personal details and contact information"), onClick: () => setPanel("account") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(ShieldCheck4, {}), title: t("\u0627\u0644\u0623\u0645\u0627\u0646", "Security"), detail: t("\u0642\u0641\u0644 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0648\u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0648\u0627\u0644\u062C\u0644\u0633\u0627\u062A", "App lock, authentication and sessions"), onClick: () => setPanel("security") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(LockKeyhole4, {}), title: t("\u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629 \u0648\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A", "Privacy & data"), onClick: () => setPanel("data") })
    ] }),
    /* @__PURE__ */ jsx14("h2", { className: "settings-section-label", children: t("\u062A\u062C\u0631\u0628\u062A\u0643 \u0641\u064A ORIN", "Your ORIN experience") }),
    /* @__PURE__ */ jsxs10("section", { className: "settings-group", children: [
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Bell, {}), title: t("\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A", "Notifications"), detail: t("\u0627\u0644\u0623\u0635\u0648\u0627\u062A \u0648\u0627\u0644\u062A\u0646\u0628\u064A\u0647\u0627\u062A \u0627\u0644\u062A\u064A \u062A\u0647\u0645\u0643", "Sounds and alerts that matter to you"), onClick: () => setPanel("notifications") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(ChartCandlestick, {}), title: t("\u0627\u0644\u0634\u0627\u0631\u062A \u0648\u0627\u0644\u0623\u0633\u0648\u0627\u0642", "Chart & markets"), detail: t("\u0627\u0644\u0623\u0635\u0648\u0644 \u0648\u0627\u0644\u0641\u0648\u0627\u0635\u0644 \u0648\u0627\u0644\u0645\u0624\u0634\u0631\u0627\u062A", "Symbols, intervals and indicators"), onClick: () => setPanel("chart") })
    ] }),
    /* @__PURE__ */ jsx14("h2", { className: "settings-section-label", children: t("\u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u0648\u0627\u0644\u0645\u0639\u0627\u0645\u0644\u0627\u062A", "Accounts & transactions") }),
    /* @__PURE__ */ jsxs10("section", { className: "settings-group", children: [
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Wallet3, {}), title: t("\u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A", "Accounts"), detail: t("\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u062D\u0633\u0627\u0628 \u0623\u0648 \u0625\u0646\u0634\u0627\u0624\u0647 \u0645\u0646 \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0631\u0635\u064A\u062F", "Select or create an account from the balance card"), onClick: () => navigation.navigate("/") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(ClipboardList2, {}), title: t("\u0627\u0644\u0645\u0639\u0627\u0645\u0644\u0627\u062A \u0627\u0644\u0623\u062E\u064A\u0631\u0629", "Recent transactions"), onClick: () => navigation.navigate("/activity") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Download, {}), title: t("\u0643\u0634\u0641 \u062D\u0631\u0643\u0627\u062A \u0627\u0644\u062D\u0633\u0627\u0628", "Account statement"), detail: "PDF", onClick: onLedger }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(ClipboardList2, {}), title: t("\u0627\u0644\u0645\u0633\u062A\u0646\u062F\u0627\u062A", "Documents"), onClick: () => navigation.navigate("/documents") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(EyeOff, {}), title: t("\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u0623\u0631\u0635\u062F\u0629", "Hide balances"), children: /* @__PURE__ */ jsx14(SettingsToggle, { label: t("\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u0623\u0631\u0635\u062F\u0629", "Hide balances"), value: prefs.hideBalance, disabled: busy, onChange: (hideBalance) => void change({ hideBalance }) }) })
    ] }),
    /* @__PURE__ */ jsx14("h2", { className: "settings-section-label", children: t("\u0628\u0631\u0627\u0645\u062C ORIN", "ORIN programs") }),
    /* @__PURE__ */ jsxs10("section", { className: "settings-group", children: [
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Gift, {}), title: t("\u062F\u0639\u0648\u0629 \u0635\u062F\u064A\u0642", "Referral program"), onClick: () => navigation.navigate("/referral") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Globe23, {}), title: t("\u0634\u062C\u0631\u0629 \u0627\u0644\u0625\u062D\u0627\u0644\u0627\u062A", "Referral tree"), onClick: () => navigation.navigate("/referral/tree") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(BadgeCheck, {}), title: t("\u0627\u0644\u0634\u0627\u0631\u0627\u062A \u0648\u0627\u0644\u0625\u0646\u062C\u0627\u0632\u0627\u062A", "Badges & achievements"), onClick: () => navigation.navigate("/badges") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Wallet3, {}), title: t("\u0628\u0648\u0646\u0635 \u0627\u0644\u062A\u0631\u062D\u064A\u0628 $100", "Welcome bonus $100"), onClick: () => navigation.navigate("/bonus") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(UserRound3, {}), title: t("\u0628\u0631\u0646\u0627\u0645\u062C \u0627\u0644\u0648\u0643\u0627\u0644\u0629", "Agency program"), onClick: () => navigation.navigate("/agent") })
    ] }),
    /* @__PURE__ */ jsx14("h2", { className: "settings-section-label", children: t("\u0646\u062D\u0646 \u0647\u0646\u0627 \u0644\u0645\u0633\u0627\u0639\u062F\u062A\u0643", "Here to help") }),
    /* @__PURE__ */ jsxs10("section", { className: "settings-group", children: [
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Headphones, {}), title: t("\u0627\u0644\u0645\u0633\u0627\u0639\u062F\u0629 \u0648\u0627\u0644\u062F\u0639\u0645", "Help & support"), onClick: () => navigation.navigate("/support") }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(ClipboardList2, {}), title: t("\u0627\u0644\u0634\u0631\u0648\u0637 \u0648\u0627\u0644\u0633\u064A\u0627\u0633\u0627\u062A", "Terms & policies"), onClick: onTerms }),
      /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Info, {}), title: t("\u062D\u0648\u0644 ORIN", "About ORIN"), detail: APP_VERSION, onClick: () => setPanel("about") })
    ] }),
    settings?.controlAvailable && /* @__PURE__ */ jsx14("section", { className: "settings-group", children: /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(ShieldCheck4, {}), title: t("\u0645\u0631\u0643\u0632 \u0625\u062F\u0627\u0631\u0629 ORIN", "ORIN Control Center"), detail: t("\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0648\u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A \u0648\u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A", "Customers, permissions and operations"), onClick: () => navigation.navigate("/admin") }) }),
    state?.isAdmin && /* @__PURE__ */ jsxs10(Fragment6, { children: [
      /* @__PURE__ */ jsx14("h2", { className: "settings-section-label", children: t("\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0625\u062F\u0627\u0631\u0629", "Administration") }),
      /* @__PURE__ */ jsxs10("section", { className: "settings-group", children: [
        /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(UserRound3, {}), title: t("\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646", "User management"), onClick: () => location.assign("/admin/users") }),
        /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Wallet3, {}), title: t("\u0627\u0644\u0645\u0643\u0627\u0641\u0622\u062A \u0648\u0627\u0644\u0628\u0648\u0646\u0635 \u0648\u0627\u0644\u0648\u0643\u0627\u0644\u0629", "Rewards, bonus & agency"), onClick: () => navigation.navigate("/admin/programs") }),
        /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(ClipboardList2, {}), title: t("\u0627\u0644\u0639\u0642\u0648\u062F \u0648\u0627\u0644\u062F\u0639\u0648\u0627\u062A", "Contracts & invitations"), onClick: onAdmin }),
        /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(SlidersHorizontal, {}), title: t("\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0623\u0633\u0648\u0627\u0642", "Market settings"), onClick: () => setPanel("admin") }),
        /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Bell, {}), title: t("\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A", "Notification administration"), onClick: () => navigation.navigate("/admin/notifications") })
      ] })
    ] }),
    settings && /* @__PURE__ */ jsxs10("a", { className: "settings-row settings-signout", href: signOutUrl(), children: [
      /* @__PURE__ */ jsx14(LogOut2, {}),
      /* @__PURE__ */ jsx14("strong", { children: t("\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062E\u0631\u0648\u062C", "Sign out") })
    ] }),
    /* @__PURE__ */ jsx14(FullPage, { open: panel !== null, onOpenChange: (open) => {
      if (!open)
        setPanel(null);
    }, children: /* @__PURE__ */ jsxs10(FullPageContent, { pageClassName: "orin-settings-screen" + (panel === "account" ? " orin-profile-screen" : ""), className: `popup settings-dialog ${panel === "admin" ? "admin-settings-dialog" : ""}`, dir: prefs.chartLocale === "ar" ? "rtl" : "ltr", children: [
      /* @__PURE__ */ jsxs10(FullPageHeader, { children: [
        /* @__PURE__ */ jsx14(FullPageTitle, { children: panel && titles[panel] }),
        /* @__PURE__ */ jsx14(FullPageDescription, { children: panel === "admin" ? t("\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0639\u0627\u0645\u0629 \u062A\u062A\u062D\u0642\u0642 \u0645\u0646\u0647\u0627 \u0627\u0644\u0645\u0646\u0635\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645.", "Server-enforced settings shared across devices.") : panel === "account" ? t("\u0628\u064A\u0627\u0646\u0627\u062A\u0643 \u0648\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u062D\u0633\u0627\u0628\u0643 \u0641\u064A \u0645\u0643\u0627\u0646 \u0648\u0627\u062D\u062F.", "Your details and account settings, together.") : syncText })
      ] }),
      panel && ["appearance", "notifications", "chart", "security"].includes(panel) && /* @__PURE__ */ jsxs10("div", { className: "settings-panel-intro", children: [
        /* @__PURE__ */ jsx14("span", { children: panel === "appearance" ? /* @__PURE__ */ jsx14(Palette, {}) : panel === "notifications" ? /* @__PURE__ */ jsx14(Bell, {}) : panel === "chart" ? /* @__PURE__ */ jsx14(ChartCandlestick, {}) : /* @__PURE__ */ jsx14(ShieldCheck4, {}) }),
        /* @__PURE__ */ jsxs10("div", { children: [
          /* @__PURE__ */ jsx14("b", { children: titles[panel] }),
          /* @__PURE__ */ jsx14("p", { children: panel === "appearance" ? t("\u0623\u0644\u0648\u0627\u0646 \u0648\u062A\u0641\u0627\u0635\u064A\u0644 \u062A\u0646\u0627\u0633\u0628\u0643.", "Colors and details, made for you.") : panel === "notifications" ? t("\u0627\u062E\u062A\u0631 \u0645\u0627 \u062A\u0631\u064A\u062F \u0633\u0645\u0627\u0639\u0647 \u0648\u0631\u0624\u064A\u062A\u0647.", "Choose what you hear and see.") : panel === "chart" ? t("\u062A\u0641\u0636\u064A\u0644\u0627\u062A\u0643 \u0644\u0644\u0623\u0633\u0648\u0627\u0642 \u0641\u064A \u0645\u0643\u0627\u0646 \u0648\u0627\u062D\u062F.", "Your market preferences in one place.") : t("\u0631\u0627\u062C\u0639 \u0637\u0631\u0642 \u062D\u0645\u0627\u064A\u0629 \u062D\u0633\u0627\u0628\u0643.", "Review how your account is protected.") })
        ] })
      ] }),
      panel === "account" && /* @__PURE__ */ jsx14(ProfileSettings, { state, onSecurity: () => setPanel("security"), onPrivacy: () => setPanel("data") }),
      panel === "language" && /* @__PURE__ */ jsx14(LanguageSettings, {}),
      panel === "appearance" && /* @__PURE__ */ jsx14(AppearanceSettings, {}),
      panel === "data" && /* @__PURE__ */ jsx14(DataControls, {}),
      panel === "chart" && /* @__PURE__ */ jsx14(ChartPreferences, {}),
      panel === "notifications" && /* @__PURE__ */ jsxs10(Fragment6, { children: [
        /* @__PURE__ */ jsx14(SoundPreferences, {}),
        /* @__PURE__ */ jsxs10("section", { className: "settings-group", children: [
          /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Bell, {}), title: t("\u062A\u0646\u0628\u064A\u0647\u0627\u062A \u062F\u0627\u062E\u0644 \u0627\u0644\u062A\u0637\u0628\u064A\u0642", "In-app notifications"), children: /* @__PURE__ */ jsx14(SettingsToggle, { label: "In-app notifications", value: prefs.notifications, disabled: busy, onChange: (v) => void change({ notifications: v }) }) }),
          /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Bell, {}), title: t("\u0645\u0631\u0643\u0632 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A", "Notification center"), onClick: () => {
            setPanel(null);
            onNotifications();
          } })
        ] }),
        /* @__PURE__ */ jsx14("h3", { className: "settings-section-label", children: t("\u0642\u0646\u0648\u0627\u062A \u0627\u0644\u0625\u0631\u0633\u0627\u0644", "Delivery channels") }),
        /* @__PURE__ */ jsx14("section", { className: "settings-group", children: ["Push", "Email", "SMS"].map((channel) => /* @__PURE__ */ jsx14(SettingsRow, { icon: /* @__PURE__ */ jsx14(Bell, {}), title: channel, detail: t("\u062E\u062F\u0645\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644 \u063A\u064A\u0631 \u0645\u062A\u0635\u0644\u0629", "Delivery service not connected"), children: /* @__PURE__ */ jsx14(SettingsToggle, { label: channel, value: false, disabled: true, onChange: () => {
        } }) }, channel)) }),
        /* @__PURE__ */ jsx14("h3", { className: "settings-section-label", children: t("\u0627\u0644\u0623\u062D\u062F\u0627\u062B", "Events") }),
        /* @__PURE__ */ jsx14("section", { className: "settings-group", children: NOTICE_EVENTS.map((k) => /* @__PURE__ */ jsx14(SettingsRow, { icon: k === "security" ? /* @__PURE__ */ jsx14(ShieldAlert2, {}) : /* @__PURE__ */ jsx14(Bell, {}), title: t(...EVENT_NAMES[k]), detail: ["opportunity", "contract_started", "contract_ended", "settlement"].includes(k) ? void 0 : t("\u062A\u0641\u0636\u064A\u0644 \u0645\u062D\u0641\u0648\u0638 \u0644\u0644\u062E\u062F\u0645\u0629 \u0639\u0646\u062F \u062A\u0641\u0639\u064A\u0644\u0647\u0627", "Preference saved for when this service is connected"), children: /* @__PURE__ */ jsx14(SettingsToggle, { label: EVENT_NAMES[k][1], value: prefs.notificationEvents[k], disabled: busy || k === "security", onChange: (v) => void change({ notificationEvents: { ...prefs.notificationEvents, [k]: v } }) }) }, k)) })
      ] }),
      panel === "security" && /* @__PURE__ */ jsx14(SecurityCenter, { t, onPassword: () => navigation.navigate("/account/security") }),
      panel === "two-factor" && /* @__PURE__ */ jsx14(SecurityCenter, { t, initialPanel: "totp" }),
      panel === "authenticator" && /* @__PURE__ */ jsx14(SecurityCenter, { t, initialPanel: "totp" }),
      panel === "devices" && /* @__PURE__ */ jsx14(SecurityCenter, { t, initialPanel: "sessions" }),
      panel === "admin" && /* @__PURE__ */ jsx14(AdminChartSettings, {}),
      panel === "about" && /* @__PURE__ */ jsxs10("div", { className: "about-data", children: [
        /* @__PURE__ */ jsxs10("h2", { children: [
          "ORIN ",
          APP_VERSION
        ] }),
        /* @__PURE__ */ jsx14("a", { href: "/privacy", children: t("\u0633\u064A\u0627\u0633\u0629 \u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629", "Privacy policy") }),
        /* @__PURE__ */ jsx14("img", { src: "/brand/orin-mark.png", alt: "ORIN" }),
        /* @__PURE__ */ jsx14("p", { children: t("\u0627\u0644\u0634\u0627\u0631\u062A \u064A\u0633\u062A\u062E\u062F\u0645 Coinbase Exchange \u0644\u0634\u0645\u0648\u0639 BTC/USD \u0648TradingView \u0644\u0644\u0623\u0635\u0648\u0644 \u0627\u0644\u0623\u062E\u0631\u0649. \u0642\u062F \u062A\u062E\u062A\u0644\u0641 \u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u0623\u062E\u064A\u0631 \u0628\u062D\u0633\u0628 \u0627\u0644\u0645\u0635\u062F\u0631 \u0648\u0627\u0644\u0633\u0648\u0642.", "BTC/USD candles use Coinbase Exchange; other assets use TradingView. Delays vary by source and market.") }),
        /* @__PURE__ */ jsx14("p", { children: t("\u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u062F\u0627\u062E\u0644\u064A\u0629 \u0645\u0633\u062A\u0642\u0644\u0629 \u0639\u0646 \u0627\u0644\u0633\u0648\u0642. \u062A\u0638\u0647\u0631 \u0646\u0633\u0628\u0629 \u0627\u0644\u062A\u0633\u0648\u064A\u0629 \u0627\u0644\u0645\u0642\u0641\u0644\u0629 \u0642\u0628\u0644 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629\u060C \u0648\u0644\u0627 \u062A\u0645\u062B\u0644 \u062A\u0646\u0641\u064A\u0630\u064B\u0627 \u0644\u0623\u0645\u0631 \u0641\u064A \u0628\u0648\u0631\u0635\u0629.", "Internal contracts are independent of the market. Locked settlement terms are shown before participation and do not represent an exchange execution.") }),
        /* @__PURE__ */ jsx14("p", { children: t("\u062A\u0643\u0627\u0645\u0644 Widget \u0627\u0644\u062D\u0627\u0644\u064A \u0644\u0627 \u064A\u062A\u064A\u062D \u0648\u0642\u062A \u0622\u062E\u0631 \u0633\u0639\u0631 \u0644\u0640 ORIN\u060C \u0623\u0648 \u062D\u0641\u0638 \u0627\u0644\u0631\u0633\u0648\u0645\u0627\u062A\u060C \u0623\u0648 \u062A\u0646\u0628\u064A\u0647\u0627\u062A \u0623\u0633\u0639\u0627\u0631 \u062E\u0644\u0641\u064A\u0629. \u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u0631\u0645\u0632 \u0623\u0648 \u0627\u0644\u0641\u0627\u0635\u0644 \u064A\u0639\u064A\u062F \u062A\u0647\u064A\u0626\u0629 \u0627\u0644\u0634\u0627\u0631\u062A.", "The current widget does not expose the last quote time, drawing storage or background price alerts to ORIN. Changing symbol or interval reinitializes the chart.") }),
        /* @__PURE__ */ jsxs10("a", { href: "https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/", target: "_blank", rel: "noopener noreferrer", children: [
          "TradingView ",
          /* @__PURE__ */ jsx14(ExternalLink, { size: 14 })
        ] })
      ] })
    ] }) })
  ] });
}

// app/market-quote.tsx
import { useCallback as useCallback4, useContext as useContext5, useEffect as useEffect10, useId as useId3, useMemo as useMemo2, useState as useState11, useSyncExternalStore } from "react";

// app/chart-boundary.tsx
import { Component } from "react";
import { jsx as jsx15, jsxs as jsxs11 } from "react/jsx-runtime";

// app/live-market.tsx
import { createContext as createContext5, useContext as useContext4, useEffect as useEffect9, useState as useState10 } from "react";
import { WifiOff, RefreshCw as RefreshCw2 } from "lucide-react";

// app/candle-chart.tsx
import { useEffect as useEffect8, useId as useId2, useMemo, useRef as useRef7, useState as useState9 } from "react";
import { Fragment as Fragment7, jsx as jsx16, jsxs as jsxs12 } from "react/jsx-runtime";

// app/live-market.tsx
import { Fragment as Fragment8, jsx as jsx17, jsxs as jsxs13 } from "react/jsx-runtime";
var MarketPreviewContext = createContext5(null);

// app/market-quote.tsx
import { Fragment as Fragment9, jsx as jsx18, jsxs as jsxs14 } from "react/jsx-runtime";
function QuoteSparkline({ feed, pair = feed.pair }) {
  const { t, number } = useOrin(), id = useId3().replace(/:/g, "");
  const preview = useContext5(MarketPreviewContext);
  const [history2, setHistory] = useState11(() => miniHistory.peekAvailable(pair));
  const [failed, setFailed] = useState11(false);
  useEffect10(() => {
    let active = true;
    setHistory(miniHistory.peekAvailable(pair));
    setFailed(false);
    if (preview) {
      const data = preview(pair, "15");
      setHistory({ pair, source: "Coinbase Exchange", points: data.candles.map((c) => ({ at: c.time, price: c.close })), windowEnd: (data.candles[data.candles.length - 1]?.time ?? Date.now()) + 15 * 60 * 1e3 });
      return;
    }
    if (!hasNativeFeed(pair)) {
      setFailed(true);
      return;
    }
    let timer, loading = false, failures = 0;
    const load = () => {
      if (timer) clearTimeout(timer);
      if (!active || loading) return;
      if (navigator.onLine === false) {
        setFailed(true);
        return;
      }
      if (document.hidden) return;
      loading = true;
      void Promise.resolve().then(() => miniHistory.loadAvailable(pair)).then((value) => {
        if (active) {
          setHistory(value);
          setFailed(false);
          failures = 0;
        }
      }, () => {
        if (active) {
          setFailed(true);
          failures++;
        }
      }).finally(() => {
        loading = false;
        if (active && !document.hidden && navigator.onLine !== false) timer = setTimeout(load, failures ? Math.min(6e4, 2e3 * 2 ** Math.min(failures - 1, 5)) : MINI_INTERVAL);
      });
    };
    load();
    window.addEventListener("online", load);
    window.addEventListener("offline", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", load);
      window.removeEventListener("offline", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [pair, preview]);
  const current = history2?.pair === pair && (preview || Date.now() - (history2.receivedAt ?? history2.windowEnd) < MINI_WINDOW) ? history2 : null;
  const shapes = useMemo2(() => {
    if (!current) return [];
    const points = current.points, prices = points.map((p) => p.price);
    const bounds = { width: 320, height: 84, start: current.windowEnd - MINI_WINDOW, end: current.windowEnd, min: Math.min(...prices), max: Math.max(...prices) };
    return miniHistorySegments(points).map((segment) => sparklineGeometry(segment, bounds)).filter(Boolean);
  }, [current]);
  const label = t("\u0622\u062E\u0631 24 \u0633\u0627\u0639\u0629 \xB7 \u0641\u0648\u0627\u0635\u0644 15 \u062F\u0642\u064A\u0642\u0629", "Last 24 hours \xB7 15-minute intervals");
  return /* @__PURE__ */ jsxs14("div", { className: "quote-sparkline quote-sparkline-history", children: [
    /* @__PURE__ */ jsx18("div", { className: "quote-sparkline-plot", role: "img", "aria-label": label, children: shapes.length ? /* @__PURE__ */ jsxs14("svg", { viewBox: "0 0 320 84", preserveAspectRatio: "none", "aria-hidden": "true", children: [
      /* @__PURE__ */ jsxs14("defs", { children: [
        /* @__PURE__ */ jsxs14("linearGradient", { id: id + "-fill", x1: "0", y1: "0", x2: "0", y2: "1", children: [
          /* @__PURE__ */ jsx18("stop", { offset: "0%", stopColor: "#20b792", stopOpacity: ".22" }),
          /* @__PURE__ */ jsx18("stop", { offset: "100%", stopColor: "#20b792", stopOpacity: "0" })
        ] }),
        /* @__PURE__ */ jsxs14("linearGradient", { id: id + "-line", x1: "0", y1: "0", x2: "1", y2: "0", children: [
          /* @__PURE__ */ jsx18("stop", { offset: "0%", stopColor: "#b2e6d9" }),
          /* @__PURE__ */ jsx18("stop", { offset: "28%", stopColor: "#21b994" }),
          /* @__PURE__ */ jsx18("stop", { offset: "100%", stopColor: "#16ac89" })
        ] })
      ] }),
      shapes.map((geometry, i) => /* @__PURE__ */ jsxs14("g", { children: [
        /* @__PURE__ */ jsx18("path", { d: geometry.area, fill: "url(#" + id + "-fill)" }),
        /* @__PURE__ */ jsx18("path", { d: geometry.path, fill: "none", stroke: "url(#" + id + "-line)", strokeWidth: "2.4", strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" })
      ] }, i))
    ] }) : /* @__PURE__ */ jsx18("span", { className: "sparkline-wait", children: failed ? t("\u0627\u0644\u0633\u062C\u0644 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0645\u0624\u0642\u062A\u064B\u0627", "History temporarily unavailable") : t("\u062C\u0627\u0631 \u062A\u062D\u0645\u064A\u0644 \u0633\u062C\u0644 \u0627\u0644\u0623\u0633\u0639\u0627\u0631\u2026", "Loading price history\u2026") }) }),
    feed.data && /* @__PURE__ */ jsxs14("b", { className: "sparkline-change " + (feed.data.change < 0 ? "loss" : "gain"), dir: "ltr", title: t("\u0627\u0644\u062A\u063A\u064A\u0631 \u062E\u0644\u0627\u0644 \u0622\u062E\u0631 24 \u0633\u0627\u0639\u0629", "Change over the last 24 hours"), children: [
      feed.data.change >= 0 ? "+" : "",
      number(feed.data.change),
      "%"
    ] }),
    /* @__PURE__ */ jsxs14("small", { className: "sparkline-period", children: [
      label,
      current && /* @__PURE__ */ jsxs14(Fragment9, { children: [
        " \xB7 ",
        /* @__PURE__ */ jsx18("span", { dir: "ltr", children: current.source }),
        failed && /* @__PURE__ */ jsxs14(Fragment9, { children: [
          " \xB7 ",
          t("\u0622\u062E\u0631 \u0633\u062C\u0644 \u0645\u062A\u0627\u062D", "Last available history")
        ] })
      ] })
    ] })
  ] });
}

// app/balance-accounts.tsx
import { useCallback as useCallback5, useEffect as useEffect11, useRef as useRef8, useState as useState12 } from "react";
import { Popover } from "radix-ui";
import { Check as Check5, ChevronDown, Eye, EyeOff as EyeOff2, Coins, Plus as Plus2, X as X3, Settings2 as Settings22 } from "lucide-react";
import { Fragment as Fragment10, jsx as jsx19, jsxs as jsxs15 } from "react/jsx-runtime";
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
  const [directory, setDirectory] = useState12(state?.accountDirectory ?? null);
  const [open, setOpen] = useState12(false), [creating, setCreating] = useState12(false);
  const [kind, setKind] = useState12("real"), [busy, setBusy] = useState12(false), [error, setError] = useState12("");
  const ticket = useRef8(0), busyRef = useRef8(false), requestId = useRef8(null);
  const onChange = useRef8(onDirectoryChange);
  onChange.current = onDirectoryChange;
  const active = activeTradingAccount(directory), uid = state?.user.id;
  const label = (type) => type === "real" ? t("\u062D\u0633\u0627\u0628 \u062D\u0642\u064A\u0642\u064A", "Real account") : t("\u062D\u0633\u0627\u0628 \u062A\u062C\u0631\u064A\u0628\u064A", "Demo account");
  const save = useCallback5((next, phase = "confirmed") => {
    setDirectory(next);
    onChange.current?.(next, phase);
  }, []);
  const run = useCallback5(async (method = "GET", input) => {
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
  useEffect11(() => {
    if (state?.accountDirectory) setDirectory(state.accountDirectory);
  }, [state?.accountDirectory]);
  useEffect11(() => {
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
  return /* @__PURE__ */ jsxs15("section", { className: "balance-hero balance-hero-v3", children: [
    /* @__PURE__ */ jsx19("img", { src: "/brand/orin-mark.png", alt: "" }),
    /* @__PURE__ */ jsxs15(Popover.Root, { open, onOpenChange: openList, modal: true, children: [
      /* @__PURE__ */ jsx19(Popover.Trigger, { asChild: true, children: /* @__PURE__ */ jsxs15("button", { type: "button", className: "orin-account-strip", disabled: !uid, "aria-label": t("\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u062D\u0633\u0627\u0628", "Select account"), children: [
        active ? /* @__PURE__ */ jsx19(Fragment10, { children: /* @__PURE__ */ jsxs15("span", { className: "account-strip-copy", children: [
          /* @__PURE__ */ jsx19("b", { children: /* @__PURE__ */ jsx19("span", { className: "account-mode-badge " + active.type, children: active.type === "real" ? t("\u062D\u0642\u064A\u0642\u064A", "Real") : t("\u062A\u062C\u0631\u064A\u0628\u064A", "Demo") }) }),
          /* @__PURE__ */ jsxs15("small", { children: [
            /* @__PURE__ */ jsx19("bdi", { children: active.currency }),
            " ",
            /* @__PURE__ */ jsx19("bdi", { className: "num", children: maskedAccountNumber(active.accountNumber) })
          ] })
        ] }) }) : /* @__PURE__ */ jsx19("span", { children: t("\u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A", "Accounts") }),
        /* @__PURE__ */ jsx19(ChevronDown, { size: 15, "aria-hidden": "true" })
      ] }) }),
      /* @__PURE__ */ jsx19(Popover.Portal, { children: /* @__PURE__ */ jsxs15(Popover.Content, { className: "orin-accounts-menu", side: "bottom", align: "start", sideOffset: 6, collisionPadding: 12, dir: prefs.chartLocale === "ar" ? "rtl" : "ltr", "aria-label": t("\u062D\u0633\u0627\u0628\u0627\u062A\u064A", "My accounts"), children: [
        /* @__PURE__ */ jsxs15("div", { className: "orin-accounts-heading", children: [
          /* @__PURE__ */ jsx19("strong", { children: t("\u062D\u0633\u0627\u0628\u0627\u062A\u064A", "My accounts") }),
          /* @__PURE__ */ jsx19(Popover.Close, { className: "orin-accounts-close", "aria-label": t("\u0625\u063A\u0644\u0627\u0642", "Close"), children: /* @__PURE__ */ jsx19(X3, { size: 18 }) })
        ] }),
        /* @__PURE__ */ jsx19("div", { className: "orin-accounts-list", role: "group", "aria-label": t("\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0646\u0634\u0637", "Choose active account"), "aria-busy": busy, children: directory?.accounts.map((account) => /* @__PURE__ */ jsxs15("button", { className: "orin-account-option", type: "button", "aria-pressed": directory.activeId === account.id, disabled: busy, onClick: () => void select(account.id), children: [
          /* @__PURE__ */ jsx19("span", { className: "orin-account-check", "aria-hidden": "true", children: directory.activeId === account.id && /* @__PURE__ */ jsx19(Check5, { size: 18 }) }),
          /* @__PURE__ */ jsxs15("span", { className: "orin-account-identity", children: [
            /* @__PURE__ */ jsx19("b", { children: label(account.type) }),
            /* @__PURE__ */ jsxs15("bdi", { className: "num", children: [
              account.accountNumber,
              " \xB7 ",
              account.currency
            ] })
          ] }),
          /* @__PURE__ */ jsx19("bdi", { className: "orin-account-amount num", children: prefs.hideBalance ? "\u2022\u2022\u2022\u2022\u2022\u2022" : `${number((account.balanceCents + account.reservedCents) / 100)} ${account.currency}` })
        ] }, account.id)) }),
        error && /* @__PURE__ */ jsxs15("div", { className: "orin-account-error", role: "alert", children: [
          /* @__PURE__ */ jsx19("p", { children: error }),
          /* @__PURE__ */ jsx19("button", { type: "button", disabled: busy, onClick: () => void run(), children: t("\u0625\u0639\u0627\u062F\u0629 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A", "Reload accounts") })
        ] }),
        busy && /* @__PURE__ */ jsx19("p", { className: "orin-account-status", role: "status", children: t("\u062C\u0627\u0631 \u062D\u0641\u0638 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u0623\u0648 \u062A\u062D\u062F\u064A\u062B\u0647\u0627\u2026", "Saving or updating accounts\u2026") }),
        !creating ? /* @__PURE__ */ jsxs15("button", { type: "button", className: "orin-account-add", disabled: busy || !directory, onClick: () => {
          setCreating(true);
          setError("");
        }, children: [
          /* @__PURE__ */ jsx19(Plus2, { size: 17 }),
          t("\u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628 \u062C\u062F\u064A\u062F", "Create new account")
        ] }) : /* @__PURE__ */ jsxs15("form", { className: "orin-account-create", onSubmit: (e) => {
          e.preventDefault();
          void create();
        }, children: [
          /* @__PURE__ */ jsxs15("fieldset", { disabled: busy, children: [
            /* @__PURE__ */ jsx19("legend", { children: t("\u0646\u0648\u0639 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062C\u062F\u064A\u062F", "New account type") }),
            ["real", "demo"].map((type) => /* @__PURE__ */ jsxs15("label", { children: [
              /* @__PURE__ */ jsx19("input", { type: "radio", name: "orin-new-account-kind", value: type, checked: kind === type, onChange: () => {
                setKind(type);
                requestId.current = null;
              } }),
              label(type)
            ] }, type))
          ] }),
          /* @__PURE__ */ jsxs15("p", { children: [
            t("\u0627\u0644\u0639\u0645\u0644\u0629", "Currency"),
            ": ",
            /* @__PURE__ */ jsx19("bdi", { children: "USD" })
          ] }),
          kind === "real" && /* @__PURE__ */ jsx19("small", { children: t("\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u0627 \u064A\u0641\u0639\u0651\u0644 \u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0623\u0648 \u0627\u0644\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u062D\u0627\u0644\u064A\u064B\u0627.", "Creating an account does not currently enable real deposits or trading.") }),
          /* @__PURE__ */ jsxs15("div", { className: "orin-account-create-actions", children: [
            /* @__PURE__ */ jsx19("button", { type: "submit", disabled: busy, children: t("\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062D\u0633\u0627\u0628", "Create account") }),
            /* @__PURE__ */ jsx19("button", { type: "button", disabled: busy, onClick: () => setCreating(false), children: t("\u0625\u0644\u063A\u0627\u0621", "Cancel") })
          ] })
        ] })
      ] }) })
    ] }),
    /* @__PURE__ */ jsxs15("div", { className: "balance-top", children: [
      /* @__PURE__ */ jsx19("span", { children: t("\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0631\u0635\u064A\u062F", "Total balance") }),
      /* @__PURE__ */ jsx19("button", { "aria-label": prefs.hideBalance ? t("\u0625\u0638\u0647\u0627\u0631 \u0627\u0644\u0631\u0635\u064A\u062F", "Show balance") : t("\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u0631\u0635\u064A\u062F", "Hide balance"), onClick: onHideBalance, children: prefs.hideBalance ? /* @__PURE__ */ jsx19(EyeOff2, {}) : /* @__PURE__ */ jsx19(Eye, {}) })
    ] }),
    /* @__PURE__ */ jsx19("strong", { className: "balance-total num", children: prefs.hideBalance ? "\u2022\u2022\u2022\u2022\u2022\u2022" : balance === null ? "$ \u2014" : `$${number(balance / 100)}` }),
    /* @__PURE__ */ jsxs15("div", { className: "balance-bottom", children: [
      /* @__PURE__ */ jsx19("span", { className: `num ${(realized ?? 0) < 0 ? "loss" : "gain"}`, children: prefs.hideBalance ? "\u2022\u2022\u2022\u2022" : realized === void 0 ? "\u2014" : `${realized >= 0 ? "+" : ""}${number(realized / 100)} USD` }),
      /* @__PURE__ */ jsx19("small", { children: t("\u0635\u0627\u0641\u064A \u0627\u0644\u0646\u062A\u0627\u0626\u062C", "Net results") })
    ] }),
    /* @__PURE__ */ jsx19("div", { className: "balance-brand-caption", "aria-hidden": "true", children: "Trade Beyond Limits" }),
    /* @__PURE__ */ jsxs15("div", { className: "balance-available" + (active?.type === "demo" ? " demo-balance-available" : ""), children: [
      /* @__PURE__ */ jsx19(Coins, { size: 23 }),
      /* @__PURE__ */ jsxs15("span", { children: [
        /* @__PURE__ */ jsx19("small", { children: t("\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D", "Available balance") }),
        /* @__PURE__ */ jsx19("bdi", { className: "num", children: prefs.hideBalance ? "\u2022\u2022\u2022\u2022\u2022\u2022" : available === void 0 ? "$ \u2014" : `$${number(available / 100)}` })
      ] }),
      active?.type === "demo" && /* @__PURE__ */ jsxs15("button", { type: "button", className: "demo-adjust-button", onClick: onAdjustDemo, children: [
        /* @__PURE__ */ jsx19(Settings22, { size: 16 }),
        t("\u0636\u0628\u0637 \u0627\u0644\u0631\u0635\u064A\u062F", "Set balance")
      ] })
    ] })
  ] });
}

// app/demo-balance-dialog.tsx
import { useRef as useRef9, useState as useState13 } from "react";
import { Dialog as Dialog2 } from "radix-ui";
import { Settings2 as Settings23, X as X4, ShieldCheck as ShieldCheck5 } from "lucide-react";

// lib/demo-wallet.ts
var DEMO_LIMIT_CENTS = 1e8;
function parseUsdAmount(value) {
  const text = value.trim().replace(/[٠-٩]/g, (c) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(c))).replace("\u066B", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) throw new Error("\u0623\u062F\u062E\u0644 \u0645\u0628\u0644\u063A\u064B\u0627 \u0635\u062D\u064A\u062D\u064B\u0627 \u0628\u0645\u0646\u0632\u0644\u062A\u064A\u0646 \u0639\u0634\u0631\u064A\u062A\u064A\u0646 \u0643\u062D\u062F \u0623\u0642\u0635\u0649. / Enter a valid amount with up to two decimal places.");
  const [whole, fraction = ""] = text.split("."), cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > DEMO_LIMIT_CENTS) throw new Error("\u0627\u0644\u0645\u0628\u0644\u063A \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0628\u064A\u0646 0 \u06481,000,000 USD. / Amount must be between 0 and 1,000,000 USD.");
  return cents;
}
function demoMovement(wallet, kind, amountCents, from = "futures") {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > DEMO_LIMIT_CENTS) throw new Error("\u0627\u0644\u0645\u0628\u0644\u063A \u063A\u064A\u0631 \u0635\u0627\u0644\u062D. / Invalid amount.");
  if (kind === "reset") return { futuresCents: amountCents, perpetualCents: 0 };
  if (kind !== "transfer" || !["futures", "perpetual"].includes(from) || !wallet || amountCents === 0) throw new Error("\u0627\u0636\u0628\u0637 \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A \u0623\u0648\u0644\u064B\u0627 \u0648\u0627\u062E\u062A\u0631 \u0645\u0628\u0644\u063A \u062A\u062D\u0648\u064A\u0644 \u0645\u0648\u062C\u0628\u064B\u0627. / Set demo funds first and enter a positive transfer amount.");
  if (wallet[from === "futures" ? "futuresCents" : "perpetualCents"] < amountCents) throw new Error("\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D \u063A\u064A\u0631 \u0643\u0627\u0641\u064D. / Insufficient available balance.");
  return { futuresCents: wallet.futuresCents + (from === "futures" ? -amountCents : amountCents), perpetualCents: wallet.perpetualCents + (from === "perpetual" ? -amountCents : amountCents) };
}

// lib/demo-wallet-client.ts
async function demoWalletRequest(accountId, operation) {
  const response = await apiFetch("/api/demo-wallet" + (operation ? "" : "?accountId=" + encodeURIComponent(accountId)), operation ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, currency: "USD", ...operation }) } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 403 ? "\u062A\u0639\u0630\u0631 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u062D\u0641\u0638\u0629 \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A\u0629. \u064A\u0644\u0632\u0645 \u0646\u0634\u0631 \u0642\u0648\u0627\u0639\u062F \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631 \u0648\u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0635\u0644\u0627\u062D\u064A\u0629 \u0627\u0644\u062D\u0633\u0627\u0628. / Demo wallet access unavailable. Deploy this release\u2019s rules and check account access." : data.error ?? "\u062A\u0639\u0630\u0631 \u0625\u062A\u0645\u0627\u0645 \u0627\u0644\u0639\u0645\u0644\u064A\u0629. / Unable to complete operation.");
  return data;
}

// app/demo-balance-dialog.tsx
import { jsx as jsx20, jsxs as jsxs16 } from "react/jsx-runtime";
function DemoBalanceDialog({ account, open, onOpenChange, onSaved }) {
  const { t, prefs } = useOrin(), [amount, setAmount] = useState13("1000"), [busy, setBusy] = useState13(false), [error, setError] = useState13("");
  const request2 = useRef9(null), submitting = useRef9(false);
  async function submit() {
    if (account.type !== "demo" || submitting.current) return;
    let cents;
    try {
      cents = parseUsdAmount(amount);
    } catch (e) {
      setError(e.message);
      return;
    }
    const key = account.id + ":" + cents;
    if (request2.current?.key !== key) request2.current = { key, id: crypto.randomUUID() };
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await demoWalletRequest(account.id, { requestId: request2.current.id, kind: "reset", amountCents: cents });
      await onSaved();
      request2.current = null;
      onOpenChange(false);
    } catch (e) {
      setError(e.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (account.type !== "demo") return null;
  return /* @__PURE__ */ jsx20(Dialog2.Root, { open, onOpenChange: (v) => {
    if (!busy) onOpenChange(v);
  }, children: /* @__PURE__ */ jsxs16(Dialog2.Portal, { children: [
    /* @__PURE__ */ jsx20(Dialog2.Overlay, { className: "demo-sheet-overlay" }),
    /* @__PURE__ */ jsxs16(Dialog2.Content, { className: "demo-balance-sheet", dir: prefs.chartLocale === "ar" ? "rtl" : "ltr", onEscapeKeyDown: (e) => {
      if (busy) e.preventDefault();
    }, onPointerDownOutside: (e) => {
      if (busy) e.preventDefault();
    }, children: [
      /* @__PURE__ */ jsxs16("div", { className: "demo-sheet-title", children: [
        /* @__PURE__ */ jsx20("span", { className: "account-mode-badge demo", children: t("\u062A\u062C\u0631\u064A\u0628\u064A", "Demo") }),
        /* @__PURE__ */ jsx20(Dialog2.Close, { "aria-label": t("\u0625\u063A\u0644\u0627\u0642", "Close"), disabled: busy, children: /* @__PURE__ */ jsx20(X4, { size: 21 }) })
      ] }),
      /* @__PURE__ */ jsx20(Dialog2.Title, { children: t("\u0636\u0628\u0637 \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A", "Adjust demo balance") }),
      /* @__PURE__ */ jsx20(Dialog2.Description, { children: t("\u062D\u062F\u0651\u062F \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A \u0644\u062D\u0633\u0627\u0628\u0643. \u0633\u064A\u064F\u0636\u0627\u0641 \u0625\u0644\u0649 \u0645\u062D\u0641\u0638\u0629 \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u0622\u062C\u0644\u0629 \u0648\u064A\u0635\u0628\u062D \u0631\u0635\u064A\u062F \u0627\u0644\u062F\u0627\u0626\u0645\u0629 \u0635\u0641\u0631\u064B\u0627.", "Set your total virtual balance. It is placed in Futures and the Perpetual balance becomes zero.") }),
      /* @__PURE__ */ jsxs16("form", { onSubmit: (e) => {
        e.preventDefault();
        void submit();
      }, children: [
        /* @__PURE__ */ jsxs16("div", { className: "demo-amount-row", children: [
          /* @__PURE__ */ jsxs16("label", { children: [
            t("\u0627\u0644\u0645\u0628\u0644\u063A", "Amount"),
            /* @__PURE__ */ jsx20("input", { autoFocus: true, inputMode: "decimal", dir: "ltr", value: amount, disabled: busy, onChange: (e) => setAmount(e.target.value), "aria-label": t("\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A", "Demo amount") })
          ] }),
          /* @__PURE__ */ jsxs16("label", { children: [
            t("\u0627\u0644\u0639\u0645\u0644\u0629", "Currency"),
            /* @__PURE__ */ jsx20("select", { value: "USD", disabled: true, "aria-label": t("\u0627\u0644\u0639\u0645\u0644\u0629", "Currency"), children: /* @__PURE__ */ jsx20("option", { children: "USD" }) })
          ] })
        ] }),
        /* @__PURE__ */ jsxs16("p", { className: "demo-separation-note", children: [
          /* @__PURE__ */ jsx20(ShieldCheck5, { size: 17 }),
          t("\u0623\u0645\u0648\u0627\u0644 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629 \u0641\u0642\u0637\u061B \u0644\u0627 \u062A\u0624\u062B\u0631 \u0641\u064A \u0631\u0635\u064A\u062F\u0643 \u0627\u0644\u062D\u0642\u064A\u0642\u064A.", "Virtual funds only; your real balance is unaffected.")
        ] }),
        account.reservedCents > 0 && /* @__PURE__ */ jsx20("p", { role: "status", children: t("\u0623\u063A\u0644\u0642 \u0627\u0644\u0645\u0631\u0627\u0643\u0632 \u0627\u0644\u0645\u062D\u062C\u0648\u0632\u0629 \u0623\u0648\u0644\u064B\u0627.", "Close reserved positions first.") }),
        error && /* @__PURE__ */ jsx20("p", { className: "orin-account-error", role: "alert", children: error }),
        /* @__PURE__ */ jsxs16("button", { className: "btn-primary full", disabled: busy || account.reservedCents > 0, children: [
          /* @__PURE__ */ jsx20(Settings23, { size: 18 }),
          t(busy ? "\u062C\u0627\u0631 \u0627\u0644\u062D\u0641\u0638\u2026" : "\u0636\u0628\u0637 \u0627\u0644\u0631\u0635\u064A\u062F", busy ? "Saving\u2026" : "Set balance")
        ] })
      ] })
    ] })
  ] }) });
}

// app/positions-panel.tsx
import { useMemo as useMemo3, useState as useState14 } from "react";
import { ArrowDownLeft, ArrowUpRight, BriefcaseBusiness, Clock3 as Clock32, FileText, Search as Search2 } from "lucide-react";
import { jsx as jsx21, jsxs as jsxs17 } from "react/jsx-runtime";
function PositionsPanel({ state, now, onReceipt, onDetails, onMarkets, onActivity }) {
  const { t, prefs, number } = useOrin(), [tab, setTab] = useState14("active"), [search, setSearch] = useState14("");
  const account = activeTradingAccount(state?.accountDirectory), positions = state?.positions ?? [], counts = { active: positions.filter((p) => p.status === "active").length, settled: positions.filter((p) => p.status === "settled").length };
  const rows = useMemo3(() => positions.filter((p) => p.status === tab && [p.contract.asset, p.contract.code, p.contract.title].some((v) => v?.toLowerCase().includes(search.toLowerCase().trim()))).sort((a, b) => b.started_at - a.started_at), [positions, tab, search]);
  const cash = (c) => prefs.hideBalance ? "\u2022\u2022\u2022\u2022" : number(c / 100), date = (n) => new Date(n).toLocaleString(prefs.chartLocale + "-u-nu-latn", { timeZone: prefs.timezone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return /* @__PURE__ */ jsxs17("section", { className: "positions-hub", children: [
    /* @__PURE__ */ jsxs17("div", { className: "positions-heading", children: [
      /* @__PURE__ */ jsxs17("div", { children: [
        /* @__PURE__ */ jsx21("span", { className: "eyebrow", children: "ORIN PORTFOLIO" }),
        /* @__PURE__ */ jsx21("h1", { children: t("\u0627\u0644\u0645\u0631\u0627\u0643\u0632", "Positions") }),
        /* @__PURE__ */ jsx21("p", { children: t("\u062A\u0627\u0628\u0639 \u0645\u0631\u0627\u0643\u0632\u0643 \u0648\u062A\u0633\u0648\u064A\u0627\u062A\u0643 \u0641\u064A \u062D\u0633\u0627\u0628 \u0648\u0627\u062D\u062F.", "Track your positions and settlements in one place.") })
      ] }),
      account && /* @__PURE__ */ jsx21("span", { className: "account-mode-badge " + account.type, children: account.type === "real" ? t("\u062D\u0642\u064A\u0642\u064A", "Real") : t("\u062A\u062C\u0631\u064A\u0628\u064A", "Demo") })
    ] }),
    /* @__PURE__ */ jsx21("div", { className: "positions-overview", children: [[t("\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D", "Available"), state?.balanceCents], [t("\u0627\u0644\u0645\u062D\u062C\u0648\u0632", "Reserved"), state?.reservedCents], [t("\u0627\u0644\u0646\u062A\u0627\u0626\u062C \u0627\u0644\u0645\u062D\u0642\u0642\u0629", "Realized results"), state?.realizedCents]].map(([label, value], i) => /* @__PURE__ */ jsxs17("div", { children: [
      /* @__PURE__ */ jsx21("small", { children: label }),
      /* @__PURE__ */ jsxs17("strong", { className: i === 2 && typeof value === "number" ? value < 0 ? "loss" : "gain" : "", dir: "ltr", children: [
        typeof value === "number" ? cash(value) : "\u2014",
        " ",
        /* @__PURE__ */ jsx21("span", { children: "USD" })
      ] })
    ] }, String(label))) }),
    /* @__PURE__ */ jsxs17("div", { className: "positions-controls", children: [
      /* @__PURE__ */ jsx21("div", { className: "positions-tabs", role: "group", "aria-label": t("\u062D\u0627\u0644\u0629 \u0627\u0644\u0645\u0631\u0627\u0643\u0632", "Position status"), children: ["active", "settled"].map((v) => /* @__PURE__ */ jsxs17("button", { "aria-pressed": tab === v, onClick: () => setTab(v), children: [
        v === "active" ? t("\u0627\u0644\u0645\u0641\u062A\u0648\u062D\u0629", "Open") : t("\u0627\u0644\u0645\u063A\u0644\u0642\u0629", "Closed"),
        " ",
        /* @__PURE__ */ jsx21("span", { children: counts[v] })
      ] }, v)) }),
      /* @__PURE__ */ jsxs17("label", { className: "positions-search", children: [
        /* @__PURE__ */ jsx21(Search2, { size: 17 }),
        /* @__PURE__ */ jsx21("input", { value: search, onChange: (e) => setSearch(e.target.value), placeholder: t("\u0628\u062D\u062B \u0628\u0627\u0644\u0623\u0635\u0644 \u0623\u0648 \u0627\u0644\u0643\u0648\u062F", "Search asset or code"), "aria-label": t("\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0645\u0631\u0627\u0643\u0632", "Search positions") })
      ] })
    ] }),
    !state ? /* @__PURE__ */ jsx21("div", { className: "workflow-empty", role: "status", children: t("\u062C\u0627\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0645\u0631\u0627\u0643\u0632\u2026", "Loading positions\u2026") }) : !rows.length ? /* @__PURE__ */ jsxs17("div", { className: "positions-empty", children: [
      /* @__PURE__ */ jsx21("span", { className: "workflow-icon", children: /* @__PURE__ */ jsx21(BriefcaseBusiness, {}) }),
      /* @__PURE__ */ jsx21("h2", { children: search ? t("\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u062A\u0627\u0626\u062C", "No results") : tab === "active" ? t("\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0631\u0627\u0643\u0632 \u0645\u0641\u062A\u0648\u062D\u0629", "No open positions") : t("\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0631\u0627\u0643\u0632 \u0645\u063A\u0644\u0642\u0629", "No closed positions") }),
      /* @__PURE__ */ jsx21("p", { children: search ? t("\u062C\u0631\u0651\u0628 \u0623\u0635\u0644\u064B\u0627 \u0623\u0648 \u0643\u0648\u062F\u064B\u0627 \u0622\u062E\u0631.", "Try another asset or code.") : t("\u0633\u062A\u0638\u0647\u0631 \u0647\u0646\u0627 \u062A\u0641\u0627\u0635\u064A\u0644 \u0645\u0631\u0627\u0643\u0632 \u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0639\u0646\u062F \u062A\u0648\u0641\u0631\u0647\u0627.", "Position details for this account will appear here when available.") }),
      /* @__PURE__ */ jsx21("button", { className: "btn-outline", onClick: onMarkets, children: t("\u0627\u0633\u062A\u0643\u0634\u0627\u0641 \u0627\u0644\u0623\u0633\u0648\u0627\u0642", "Explore markets") })
    ] }) : /* @__PURE__ */ jsx21("div", { className: "position-cards", children: rows.map((p) => {
      const receipt = state.receipts.find((r) => r.position_id === p.id), closed = p.status === "settled", secs = Math.max(0, Math.ceil((p.ends_at - now) / 1e3));
      return /* @__PURE__ */ jsxs17("article", { className: "position-card", children: [
        /* @__PURE__ */ jsxs17("header", { children: [
          /* @__PURE__ */ jsx21("span", { className: "position-direction " + (p.contract.direction === "BUY" ? "gain" : "loss"), children: p.contract.direction === "BUY" ? /* @__PURE__ */ jsx21(ArrowUpRight, {}) : /* @__PURE__ */ jsx21(ArrowDownLeft, {}) }),
          /* @__PURE__ */ jsxs17("div", { children: [
            /* @__PURE__ */ jsx21("h3", { dir: "ltr", children: p.contract.asset }),
            /* @__PURE__ */ jsxs17("small", { children: [
              t(p.contract.direction === "BUY" ? "\u0634\u0631\u0627\u0621" : "\u0628\u064A\u0639", p.contract.direction === "BUY" ? "Buy" : "Sell"),
              " \xB7 ",
              t("\u0639\u0642\u062F \u062F\u0627\u062E\u0644\u064A", "Internal contract")
            ] })
          ] }),
          /* @__PURE__ */ jsx21("span", { className: "chip " + (closed ? "chip-green" : "chip-blue"), children: closed ? t("\u062A\u0645\u062A \u0627\u0644\u062A\u0633\u0648\u064A\u0629", "Settled") : secs === 0 ? t("\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062A\u0633\u0648\u064A\u0629", "Awaiting settlement") : t("\u0645\u0641\u062A\u0648\u062D", "Open") })
        ] }),
        /* @__PURE__ */ jsxs17("dl", { children: [
          /* @__PURE__ */ jsxs17("div", { children: [
            /* @__PURE__ */ jsx21("dt", { children: t("\u0642\u064A\u0645\u0629 \u0627\u0644\u0645\u0631\u0643\u0632", "Position amount") }),
            /* @__PURE__ */ jsxs17("dd", { dir: "ltr", children: [
              cash(p.amount_cents),
              " USD"
            ] })
          ] }),
          /* @__PURE__ */ jsxs17("div", { children: [
            /* @__PURE__ */ jsx21("dt", { children: closed ? t("\u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u0645\u062D\u0642\u0642\u0629", "Realized result") : t("\u0627\u0644\u0645\u062F\u0629", "Duration") }),
            /* @__PURE__ */ jsx21("dd", { className: closed ? p.result_cents < 0 ? "loss" : "gain" : "", dir: "ltr", children: closed ? (prefs.hideBalance ? "\u2022\u2022\u2022\u2022" : (p.result_cents >= 0 ? "+" : "") + cash(p.result_cents)) + " USD" : p.contract.duration_sec / 60 + " " + t("\u062F\u0642\u064A\u0642\u0629", "min") })
          ] })
        ] }),
        /* @__PURE__ */ jsxs17("div", { className: "position-timing", children: [
          /* @__PURE__ */ jsx21(Clock32, { size: 15 }),
          /* @__PURE__ */ jsx21("span", { children: closed ? date(p.settled_at ?? p.ends_at) : date(p.started_at) }),
          !closed && secs > 0 && /* @__PURE__ */ jsxs17("bdi", { children: [
            Math.floor(secs / 60),
            ":",
            String(secs % 60).padStart(2, "0")
          ] })
        ] }),
        /* @__PURE__ */ jsxs17("footer", { children: [
          /* @__PURE__ */ jsx21("button", { onClick: () => onDetails(p), children: t("\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0639\u0642\u062F", "Contract details") }),
          receipt && /* @__PURE__ */ jsxs17("button", { onClick: () => onReceipt(receipt), children: [
            /* @__PURE__ */ jsx21(FileText, { size: 16 }),
            t("\u0627\u0644\u0625\u064A\u0635\u0627\u0644", "Receipt")
          ] })
        ] })
      ] }, p.id);
    }) }),
    /* @__PURE__ */ jsxs17("button", { className: "positions-activity btn-outline", onClick: onActivity, children: [
      /* @__PURE__ */ jsx21(FileText, { size: 18 }),
      t("\u0627\u0644\u0645\u0639\u0627\u0645\u0644\u0627\u062A \u0648\u0643\u0634\u0641 \u0627\u0644\u062D\u0633\u0627\u0628", "Transactions & statement")
    ] })
  ] });
}

// app/account-transfer.tsx
import { useEffect as useEffect12, useRef as useRef10, useState as useState15 } from "react";
import { ArrowDownUp, ArrowLeftRight, CheckCircle2, Clock3 as Clock33, LockKeyhole as LockKeyhole5, Wallet as Wallet4 } from "lucide-react";
import { Fragment as Fragment11, jsx as jsx22, jsxs as jsxs18 } from "react/jsx-runtime";
function AccountTransfer({ account, onSaved }) {
  const { t, number, prefs } = useOrin(), [view, setView] = useState15(null), [from, setFrom] = useState15("futures"), [amount, setAmount] = useState15(""), [error, setError] = useState15(""), [busy, setBusy] = useState15(false), [review, setReview] = useState15(false), [done, setDone] = useState15(null), [loading, setLoading] = useState15(true);
  const alive = useRef10(true), inFlight = useRef10(false), request2 = useRef10(null);
  const demo = account?.type === "demo", to = from === "futures" ? "perpetual" : "futures";
  const label = (p) => p === "futures" ? t("\u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u0622\u062C\u0644\u0629", "Futures") : t("\u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u062F\u0627\u0626\u0645\u0629", "Perpetual");
  const money = (n) => prefs.hideBalance ? "\u2022\u2022\u2022\u2022" : number(n / 100);
  const available = view?.wallet?.[from === "futures" ? "futuresCents" : "perpetualCents"] ?? 0;
  useEffect12(() => {
    alive.current = true;
    if (!demo || !account) {
      setLoading(false);
      return () => {
        alive.current = false;
      };
    }
    demoWalletRequest(account.id).then((v) => {
      if (alive.current) setView(v);
    }, (e) => {
      if (alive.current) setError(e.message);
    }).finally(() => {
      if (alive.current) setLoading(false);
    });
    return () => {
      alive.current = false;
    };
  }, [account?.id, demo]);
  function validate() {
    try {
      const cents = parseUsdAmount(amount);
      if (cents <= 0 || cents > available) throw new Error(t("\u0623\u062F\u062E\u0644 \u0645\u0628\u0644\u063A\u064B\u0627 \u0645\u0648\u062C\u0628\u064B\u0627 \u0636\u0645\u0646 \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D.", "Enter a positive amount within your available balance."));
      setError("");
      return cents;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }
  async function submit() {
    const cents = validate();
    if (cents === null || !demo || !account || inFlight.current) return;
    const key = account.id + ":" + from + ":" + cents;
    if (request2.current?.key !== key) request2.current = { key, id: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    const id = request2.current.id;
    try {
      const next = await demoWalletRequest(account.id, { requestId: id, kind: "transfer", amountCents: cents, from });
      if (alive.current) {
        setView(next);
        setDone(id);
        setAmount("");
        setReview(false);
        request2.current = null;
      }
      await onSaved();
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return /* @__PURE__ */ jsxs18("section", { className: "account-transfer", children: [
    /* @__PURE__ */ jsxs18("div", { className: "transfer-intro", children: [
      /* @__PURE__ */ jsx22("span", { className: "workflow-icon", children: /* @__PURE__ */ jsx22(ArrowLeftRight, {}) }),
      /* @__PURE__ */ jsxs18("div", { children: [
        /* @__PURE__ */ jsx22("h2", { children: t("\u062A\u062D\u0648\u064A\u0644 \u0628\u064A\u0646 \u0627\u0644\u0645\u062D\u0627\u0641\u0638", "Transfer between wallets") }),
        /* @__PURE__ */ jsx22("p", { children: t("\u0627\u0646\u0642\u0644 \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D \u0628\u064A\u0646 \u0627\u0644\u0622\u062C\u0644\u0629 \u0648\u0627\u0644\u062F\u0627\u0626\u0645\u0629 \u062F\u0627\u062E\u0644 \u0627\u0644\u062D\u0633\u0627\u0628 \u0646\u0641\u0633\u0647.", "Move available funds between Futures and Perpetual within the same account.") })
      ] })
    ] }),
    /* @__PURE__ */ jsxs18("div", { className: "workflow-account", children: [
      /* @__PURE__ */ jsxs18("span", { children: [
        account ? t(account.type === "demo" ? "\u062D\u0633\u0627\u0628 \u062A\u062C\u0631\u064A\u0628\u064A" : "\u062D\u0633\u0627\u0628 \u062D\u0642\u064A\u0642\u064A", account.type === "demo" ? "Demo account" : "Real account") : t("\u0627\u062E\u062A\u0631 \u062D\u0633\u0627\u0628\u064B\u0627 \u0623\u0648\u0644\u064B\u0627", "Select an account first"),
        " ",
        /* @__PURE__ */ jsxs18("bdi", { children: [
          "\u2022\u2022\u2022\u2022 ",
          account?.accountNumber.slice(-4)
        ] })
      ] }),
      account && /* @__PURE__ */ jsx22("span", { className: "account-mode-badge " + account.type, children: demo ? t("\u062A\u062C\u0631\u064A\u0628\u064A", "Demo") : t("\u062D\u0642\u064A\u0642\u064A", "Real") })
    ] }),
    !demo ? /* @__PURE__ */ jsxs18("div", { className: "transfer-unavailable", children: [
      /* @__PURE__ */ jsx22(LockKeyhole5, {}),
      /* @__PURE__ */ jsx22("h3", { children: t("\u0627\u0644\u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0628\u0639\u062F", "Real transfers are not available yet") }),
      /* @__PURE__ */ jsx22("p", { children: t("\u0633\u062A\u062A\u0648\u0641\u0631 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0639\u0646\u062F \u062A\u0641\u0639\u064A\u0644 \u0645\u062D\u0627\u0641\u0638 \u0627\u0644\u0622\u062C\u0644\u0629 \u0648\u0627\u0644\u062F\u0627\u0626\u0645\u0629 \u0644\u0644\u062D\u0633\u0627\u0628. \u0644\u0645 \u064A\u064F\u062E\u0635\u0645 \u0623\u064A \u0631\u0635\u064A\u062F.", "Transfers become available when Futures and Perpetual wallets are enabled for this account. No balance has been debited.") })
    ] }) : /* @__PURE__ */ jsxs18(Fragment11, { children: [
      /* @__PURE__ */ jsxs18("div", { className: "transfer-pockets", children: [
        /* @__PURE__ */ jsxs18("div", { children: [
          /* @__PURE__ */ jsx22("span", { children: t("\u0645\u0646", "From") }),
          /* @__PURE__ */ jsxs18("select", { value: from, onChange: (e) => {
            setFrom(e.target.value);
            setReview(false);
            setDone(null);
          }, disabled: busy, "aria-label": t("\u0627\u0644\u0645\u062D\u0641\u0638\u0629 \u0627\u0644\u0645\u0631\u0633\u0644\u0629", "Source wallet"), children: [
            /* @__PURE__ */ jsx22("option", { value: "futures", children: label("futures") }),
            /* @__PURE__ */ jsx22("option", { value: "perpetual", children: label("perpetual") })
          ] }),
          /* @__PURE__ */ jsxs18("small", { children: [
            t("\u0645\u062A\u0627\u062D", "Available"),
            " ",
            /* @__PURE__ */ jsxs18("bdi", { children: [
              loading ? "\u2026" : money(available),
              " USD"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsx22("button", { className: "transfer-swap", type: "button", "aria-label": t("\u0639\u0643\u0633 \u0627\u062A\u062C\u0627\u0647 \u0627\u0644\u062A\u062D\u0648\u064A\u0644", "Reverse transfer direction"), disabled: busy, onClick: () => {
          setFrom(to);
          setReview(false);
          setDone(null);
        }, children: /* @__PURE__ */ jsx22(ArrowDownUp, { size: 21 }) }),
        /* @__PURE__ */ jsxs18("div", { children: [
          /* @__PURE__ */ jsx22("span", { children: t("\u0625\u0644\u0649", "To") }),
          /* @__PURE__ */ jsx22("strong", { children: label(to) }),
          /* @__PURE__ */ jsxs18("small", { children: [
            t("\u0627\u0644\u0631\u0635\u064A\u062F", "Balance"),
            " ",
            /* @__PURE__ */ jsxs18("bdi", { children: [
              loading ? "\u2026" : money(view?.wallet?.[to === "futures" ? "futuresCents" : "perpetualCents"] ?? 0),
              " USD"
            ] })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs18("form", { onSubmit: (e) => {
        e.preventDefault();
        if (review) void submit();
        else if (validate() !== null) setReview(true);
      }, children: [
        /* @__PURE__ */ jsxs18("label", { className: "transfer-amount-label", children: [
          t("\u0645\u0628\u0644\u063A \u0627\u0644\u062A\u062D\u0648\u064A\u0644", "Transfer amount"),
          /* @__PURE__ */ jsxs18("div", { className: "transfer-amount", children: [
            /* @__PURE__ */ jsx22("input", { inputMode: "decimal", dir: "ltr", placeholder: "0.00", value: amount, disabled: busy, onChange: (e) => {
              setAmount(e.target.value);
              setReview(false);
              setDone(null);
            }, "aria-label": t("\u0645\u0628\u0644\u063A \u0627\u0644\u062A\u062D\u0648\u064A\u0644", "Transfer amount") }),
            /* @__PURE__ */ jsx22("b", { children: "USD" })
          ] })
        ] }),
        /* @__PURE__ */ jsx22("div", { className: "transfer-presets", children: [25, 50, 75, 100].map((p) => /* @__PURE__ */ jsx22("button", { type: "button", disabled: busy || !available, onClick: () => {
          setAmount((Math.floor(available * p / 100) / 100).toFixed(2));
          setReview(false);
          setDone(null);
        }, children: p === 100 ? t("\u0627\u0644\u0643\u0644", "Max") : p + "%" }, p)) }),
        /* @__PURE__ */ jsxs18("div", { className: "transfer-meta", children: [
          /* @__PURE__ */ jsx22("span", { children: t("\u0631\u0633\u0648\u0645 \u0627\u0644\u062A\u062D\u0648\u064A\u0644", "Transfer fee") }),
          /* @__PURE__ */ jsx22("bdi", { children: "0.00 USD" }),
          /* @__PURE__ */ jsx22("span", { children: t("\u0646\u0648\u0639 \u0627\u0644\u0631\u0635\u064A\u062F", "Balance type") }),
          /* @__PURE__ */ jsx22("b", { children: t("\u0627\u0641\u062A\u0631\u0627\u0636\u064A \u063A\u064A\u0631 \u0642\u0627\u0628\u0644 \u0644\u0644\u0633\u062D\u0628", "Virtual \xB7 non-withdrawable") })
        ] }),
        review && /* @__PURE__ */ jsxs18("div", { className: "transfer-review", role: "status", children: [
          /* @__PURE__ */ jsx22("h3", { children: t("\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062A\u062D\u0648\u064A\u0644", "Review transfer") }),
          /* @__PURE__ */ jsxs18("bdi", { children: [
            number(parseUsdAmount(amount) / 100),
            " USD"
          ] }),
          /* @__PURE__ */ jsxs18("p", { children: [
            label(from),
            " \u2190 ",
            label(to)
          ] }),
          /* @__PURE__ */ jsx22("small", { children: t("\u0644\u0646 \u064A\u062A\u063A\u064A\u0631 \u0625\u062C\u0645\u0627\u0644\u064A \u0631\u0635\u064A\u062F \u0627\u0644\u062D\u0633\u0627\u0628.", "Your account total will remain unchanged.") })
        ] }),
        error && /* @__PURE__ */ jsx22("p", { role: "alert", className: "orin-account-error", children: error }),
        done && /* @__PURE__ */ jsxs18("div", { className: "transfer-success", role: "status", children: [
          /* @__PURE__ */ jsx22(CheckCircle2, {}),
          /* @__PURE__ */ jsxs18("div", { children: [
            /* @__PURE__ */ jsx22("b", { children: t("\u0627\u0643\u062A\u0645\u0644 \u0627\u0644\u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A", "Demo transfer completed") }),
            /* @__PURE__ */ jsxs18("small", { children: [
              t("\u0631\u0642\u0645 \u0627\u0644\u0639\u0645\u0644\u064A\u0629", "Reference"),
              " ",
              /* @__PURE__ */ jsx22("bdi", { children: done })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsx22("button", { className: "btn-primary full", disabled: busy || loading || !view?.wallet || account.reservedCents > 0 || available <= 0, children: t(busy ? "\u062C\u0627\u0631 \u0627\u0644\u062A\u062D\u0648\u064A\u0644\u2026" : review ? "\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062A\u062D\u0648\u064A\u0644" : "\u0645\u062A\u0627\u0628\u0639\u0629", busy ? "Transferring\u2026" : review ? "Confirm transfer" : "Continue") }),
        !loading && !view?.wallet && !error && /* @__PURE__ */ jsx22("p", { className: "settings-footnote", children: t("\u0627\u0636\u0628\u0637 \u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A \u0645\u0646 \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u062D\u0633\u0627\u0628 \u0623\u0648\u0644\u064B\u0627.", "Set your demo balance on the account card first.") }),
        account.reservedCents > 0 && /* @__PURE__ */ jsx22("p", { children: t("\u0623\u063A\u0644\u0642 \u0627\u0644\u0645\u0631\u0627\u0643\u0632 \u0627\u0644\u0645\u062D\u062C\u0648\u0632\u0629 \u0642\u0628\u0644 \u0627\u0644\u062A\u062D\u0648\u064A\u0644.", "Close reserved positions before transferring.") })
      ] }),
      /* @__PURE__ */ jsxs18("div", { className: "workflow-history-title", children: [
        /* @__PURE__ */ jsx22(Clock33, { size: 18 }),
        /* @__PURE__ */ jsx22("h3", { children: t("\u0622\u062E\u0631 \u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A\u0629", "Recent demo activity") })
      ] }),
      /* @__PURE__ */ jsx22("div", { className: "transfer-history", children: view?.operations.length ? view.operations.map((o) => /* @__PURE__ */ jsxs18("article", { children: [
        /* @__PURE__ */ jsx22("span", { className: "workflow-icon", children: o.kind === "reset" ? /* @__PURE__ */ jsx22(Wallet4, { size: 18 }) : /* @__PURE__ */ jsx22(ArrowLeftRight, { size: 18 }) }),
        /* @__PURE__ */ jsxs18("div", { children: [
          /* @__PURE__ */ jsx22("b", { children: o.kind === "reset" ? t("\u0636\u0628\u0637 \u0627\u0644\u0631\u0635\u064A\u062F", "Balance adjustment") : label(o.from) + " \u2190 " + label(o.to) }),
          /* @__PURE__ */ jsx22("small", { children: /* @__PURE__ */ jsx22("time", { dateTime: new Date(o.createdAt).toISOString(), children: new Date(o.createdAt).toLocaleString(prefs.chartLocale + "-u-nu-latn", { timeZone: prefs.timezone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }) }),
          /* @__PURE__ */ jsxs18("details", { children: [
            /* @__PURE__ */ jsx22("summary", { children: t("\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0639\u0645\u0644\u064A\u0629", "Operation details") }),
            /* @__PURE__ */ jsx22("small", { children: /* @__PURE__ */ jsx22("bdi", { children: o.id }) }),
            /* @__PURE__ */ jsxs18("small", { children: [
              t("\u0627\u0644\u0631\u0635\u064A\u062F \u0628\u0639\u062F \u0627\u0644\u0639\u0645\u0644\u064A\u0629", "Balance after operation"),
              ": ",
              /* @__PURE__ */ jsxs18("bdi", { children: [
                money(o.afterFuturesCents + o.afterPerpetualCents),
                " USD"
              ] })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs18("bdi", { children: [
          money(o.amountCents),
          " USD"
        ] })
      ] }, o.id)) : /* @__PURE__ */ jsx22("p", { className: "workflow-empty", children: t(loading ? "\u062C\u0627\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0633\u062C\u0644\u2026" : "\u0644\u0627 \u062A\u0648\u062C\u062F \u062A\u062D\u0648\u064A\u0644\u0627\u062A \u0628\u0639\u062F", loading ? "Loading history\u2026" : "No transfers yet") }) })
    ] })
  ] });
}
export {
  AccountSettings,
  AccountTransfer,
  AppearanceSettings,
  BalanceAccounts,
  CAPABILITIES,
  ChartPreferences,
  DEFAULT_CONFIGURATION,
  DEFAULT_PREFERENCES,
  DemoBalanceDialog,
  LanguageSettings,
  MINI_INTERVAL,
  MINI_TIMEOUT,
  MINI_WINDOW,
  MiniHistoryLoader,
  OrinNavigationContext,
  OrinSettingsProvider,
  PositionsPanel,
  ProfileSettings,
  QuoteSparkline,
  SoundPreferences,
  configureFirebaseTransport,
  decodeMiniHistory,
  demoMovement,
  exchangeHistoryEnd,
  miniHistory,
  miniHistorySegments,
  parseUsdAmount,
  safeDestination,
  sparklineGeometry
};
