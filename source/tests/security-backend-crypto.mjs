// firebase-functions/src/account-security-crypto.ts
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
var opaque = () => randomBytes(32).toString("base64url");
var digest = (value) => createHash("sha256").update(value).digest("hex");
function equal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function masterKey(value) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, "base64").length !== 32) throw new Error("ORIN_SECURITY_MASTER_KEY must be a 32-byte base64 secret");
  return Buffer.from(value, "base64");
}
function seal(secret, key, uid) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`ORIN:TOTP:v1:${uid}`));
  return ["v1", iv.toString("base64url"), Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]).toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
function unseal(value, key, uid) {
  const [version, iv, data, tag] = value.split(".");
  if (version !== "v1") throw new Error("Unsupported secret version");
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  cipher.setAAD(Buffer.from(`ORIN:TOTP:v1:${uid}`));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString("utf8");
}
var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = value << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[value << 5 - bits & 31];
  return out;
}
function decode32(value) {
  let bits = 0, n = 0, bytes = [];
  for (const c of value) {
    const x = alphabet.indexOf(c);
    if (x < 0) throw new Error("Invalid base32");
    n = n << 5 | x;
    bits += 5;
    if (bits >= 8) {
      bytes.push(n >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
var newTotpSecret = () => base32(randomBytes(20));
function hotp(secret, counter, digits = 6) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", decode32(secret)).update(b).digest(), offset = h[h.length - 1] & 15;
  return String((h.readUInt32BE(offset) & 2147483647) % 10 ** digits).padStart(digits, "0");
}
function verifyTotp(secret, code, now, lastStep = -1) {
  if (!/^\d{6}$/.test(code)) return null;
  const center = Math.floor(now / 3e4);
  for (const step of [center, center - 1, center + 1]) if (step > lastStep && equal(hotp(secret, step), code)) return step;
  return null;
}
function newRecoveryCodes() {
  return Array.from({ length: 10 }, () => randomBytes(12).toString("hex").match(/.{1,6}/g).join("-"));
}
var recoveryHash = (code) => digest("ORIN:recovery:" + code.trim().toLowerCase().replace(/[-\s]/g, ""));
var recoveryFormat = (code) => typeof code === "string" && /^[a-fA-F0-9\s-]{24,40}$/.test(code) && code.replace(/[-\s]/g, "").length === 24;
var failureDelay = (failures) => failures < 3 ? 0 : Math.min(15 * 6e4, 1e3 * 2 ** Math.min(20, failures - 3));
function safeDevice(value) {
  const clean = (v, n = 100) => typeof v === "string" ? v.replace(/[\x00-\x1f<>]/g, "").slice(0, n) : "";
  return { platform: ["Android", "iOS", "Web"].includes(value?.platform) ? value.platform : "Other", label: clean(value?.label) || "ORIN", manufacturer: clean(value?.manufacturer), model: clean(value?.model), osVersion: clean(value?.osVersion, 40), appVersion: clean(value?.appVersion, 30) };
}
export {
  base32,
  decode32,
  digest,
  equal,
  failureDelay,
  hotp,
  masterKey,
  newRecoveryCodes,
  newTotpSecret,
  opaque,
  recoveryFormat,
  recoveryHash,
  safeDevice,
  seal,
  unseal,
  verifyTotp
};
