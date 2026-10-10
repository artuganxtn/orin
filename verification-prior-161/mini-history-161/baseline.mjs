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
var providers = ["Bitstamp", "Kraken", "Coinbase Exchange"];
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
  if (sorted.length < 2) throw new Error("Insufficient closed history");
  return { pair, source, points: sorted, windowEnd };
}
function exchangeHistoryEnd(pair, source, raw) {
  const rows = rowsFor(pair, source, raw), latest = Math.max(...rows.map((r) => Array.isArray(r) ? Number(r[0]) * 1e3 : NaN));
  if (!Number.isFinite(latest)) throw new Error("Missing exchange time");
  return latest + (source === "Bitstamp" ? MINI_INTERVAL : 0);
}
var MiniHistoryLoader = class {
  constructor(request = fetch, now = Date.now) {
    this.request = request;
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
      if (d?.pair === pair && providers.includes(d.source) && Number.isFinite(d.receivedAt) && this.now() - d.receivedAt >= 0 && this.now() - d.receivedAt < MINI_WINDOW && Number.isFinite(d.windowEnd) && Array.isArray(d.points) && d.points.length >= 2 && d.points.length <= 96 && d.points.every((p, i) => Number.isFinite(p.at) && Number.isFinite(p.price) && p.price > 0 && p.at >= d.windowEnd - MINI_WINDOW && p.at < d.windowEnd && (!i || p.at > d.points[i - 1].at))) {
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
    const promise = Promise.any(providers.map((source) => this.load(pair, source))).then((data) => {
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
    const url = source === "Bitstamp" ? `https://www.bitstamp.net/api/v2/ohlc/${pair.replace("-", "").toLowerCase()}/?step=900&limit=96&exclude_current_candle=true` : source === "Kraken" ? `https://api.kraken.com/0/public/OHLC?pair=${krakenPairs[pair]}&assetVersion=1&interval=15` : `https://api.exchange.coinbase.com/products/${pair}/candles?granularity=900`;
    const work = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12e3);
      try {
        const response = await this.request(url, { signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const raw = await response.json(), end = exchangeHistoryEnd(pair, source, raw), serverTime = Date.parse(response.headers?.get("date") ?? "");
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
    })();
    this.pending.set(key, work);
    return work;
  }
};
var miniHistory = new MiniHistoryLoader();
function miniHistorySegments(points) {
  const segments = [];
  for (const p of points) {
    const last = segments.at(-1);
    if (!last || p.at - last[last.length - 1].at > MINI_INTERVAL * 1.5) segments.push([p]);
    else last.push(p);
  }
  return segments.filter((s) => s.length >= 2);
}
export {
  MINI_INTERVAL,
  MINI_WINDOW,
  MiniHistoryLoader,
  decodeMiniHistory,
  exchangeHistoryEnd,
  miniHistory,
  miniHistorySegments
};
