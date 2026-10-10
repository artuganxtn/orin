// firebase-functions/src/account-security-ip.ts
import { isIP } from "node:net";
function resolveObservedIP(req, env = process.env) {
  const raw = req.socket?.remoteAddress, peer = typeof raw === "string" && isIP(raw) ? raw : null;
  if (!peer) return { ip: null, transportIP: null, ipSource: "unavailable" };
  const peers = (env.ORIN_TRUSTED_PROXY_IPS ?? "").split(",").map((v) => v.trim()).filter((v) => isIP(v)), hops = Number(env.ORIN_TRUSTED_PROXY_HOPS);
  if (peers.includes(peer) && Number.isSafeInteger(hops) && hops >= 1 && hops <= 5) {
    const header = req.get?.("x-forwarded-for"), parts = typeof header === "string" && header.length <= 1024 ? header.split(",").map((v) => v.trim()) : [];
    if (parts.length >= hops && parts.every((v) => isIP(v))) return { ip: parts[parts.length - hops], transportIP: peer, ipSource: "trusted-proxy" };
  }
  if (env.ORIN_DIRECT_CLIENT_IP === "true" && !req.get?.("x-forwarded-for")) return { ip: peer, transportIP: peer, ipSource: "direct" };
  return { ip: null, transportIP: peer, ipSource: "unavailable" };
}
export {
  resolveObservedIP
};
