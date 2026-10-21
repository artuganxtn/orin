// src/nowpayments.ts
import { createHmac, timingSafeEqual } from "node:crypto";
var ApiError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function validIpn(body, signature, secret) {
  if (!secret || !body || typeof body !== "object" || Array.isArray(body) || !/^[a-fA-F0-9]{128}$/.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(JSON.stringify(canonical(body))).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
function providerId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new ApiError("Invalid payment identifier", 502);
  const result = String(value ?? "");
  if (!/^[0-9]{1,30}$/.test(result)) throw new ApiError("Invalid payment identifier", 502);
  return result;
}
function units(value, decimals = 18) {
  const text = String(value ?? "");
  if (!/^\d{1,20}(\.\d{1,18})?$/.test(text)) throw new ApiError("Invalid provider amount", 502);
  const [whole, fraction = ""] = text.split(".");
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
  get(id) {
    return this.request("/payment/" + providerId(id));
  }
};
export {
  ApiError,
  NowPayments,
  canonical,
  providerId,
  units,
  validIpn
};
//# sourceMappingURL=nowpayments.js.map
