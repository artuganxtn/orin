var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/db.ts
import pg from "pg";
async function withTx(fn, maxRetries = 5) {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("SET client_encoding TO 'UTF8'").catch(() => {
      });
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      client.release();
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
      });
      client.release(err);
      if ((err.code === "40001" || err.code === "40P01") && attempt < maxRetries) {
        attempt++;
        const backoffMs = Math.floor(Math.random() * 50) * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw err;
    }
  }
}
var Pool, connectionString, isLocal, pool;
var init_db = __esm({
  "src/db.ts"() {
    ({ Pool } = pg);
    connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    if (!connectionString.includes("client_encoding")) {
      connectionString += (connectionString.includes("?") ? "&" : "?") + "client_encoding=UTF8";
    }
    isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
    pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 8
    });
    pool.on("error", (err, _client) => {
      console.error("Unexpected error on idle PostgreSQL client", err);
    });
  }
});

// src/telegram.ts
var telegram_exports = {};
__export(telegram_exports, {
  DEFAULT_TELEGRAM_BOT_TOKEN: () => DEFAULT_TELEGRAM_BOT_TOKEN,
  DEFAULT_TELEGRAM_CHANNEL_ID: () => DEFAULT_TELEGRAM_CHANNEL_ID,
  escapeHtml: () => escapeHtml,
  formatTurkeyTime: () => formatTurkeyTime,
  getTelegramBotToken: () => getTelegramBotToken,
  getTelegramChannelId: () => getTelegramChannelId,
  processTelegramOutboxOnce: () => processTelegramOutboxOnce,
  renderMessageTemplate: () => renderMessageTemplate,
  sendTelegramApiRequest: () => sendTelegramApiRequest
});
function escapeHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function formatTurkeyTime(timeMs) {
  return new Date(timeMs).toLocaleString("en-US", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
function renderMessageTemplate(kind, c, slotName = "\u0635\u0641\u0642\u0629 \u0645\u0639\u062A\u0645\u062F\u0629") {
  const codeEsc = escapeHtml(c.code);
  const titleEsc = escapeHtml(c.title || slotName);
  const slotNameEsc = escapeHtml(slotName);
  const assetEsc = escapeHtml(c.asset);
  const dirText = c.direction === "BUY" ? "\u{1F7E2} \u0634\u0631\u0627\u0621 \u0635\u0639\u0648\u062F (BUY)" : "\u{1F534} \u0628\u064A\u0639 \u0647\u0628\u0648\u0637 (SELL)";
  const dirTextEsc = escapeHtml(dirText);
  const durationStr = c.durationSec < 60 ? `${c.durationSec} \u062B\u0627\u0646\u064A\u0629` : `${Math.round(c.durationSec / 60)} \u062F\u0642\u064A\u0642\u0629`;
  const pctNum = Number(c.settlementBps) / 100;
  const pctText = (pctNum % 1 === 0 ? pctNum.toFixed(0) : pctNum * 10 % 1 === 0 ? pctNum.toFixed(1) : pctNum.toFixed(2)) + "%";
  const startTimeStr = formatTurkeyTime(c.opensAtMs);
  const endTimeStr = formatTurkeyTime(c.closesAtMs);
  if (kind === "ended_slot") {
    const text2 = `\u26D4 <b>\u0627\u0646\u062A\u0647\u0649 \u0645\u0648\u0639\u062F \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0641\u064A \u0627\u0644\u0635\u0641\u0642\u0629</b> \u26D4
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CC} <b>\u0627\u0633\u0645 \u0627\u0644\u0635\u0641\u0642\u0629:</b> ${titleEsc}
\u{1F4CA} <b>\u0627\u0644\u0623\u0635\u0644:</b> ${assetEsc}
\u{1F511} <b>\u0643\u0648\u062F \u0627\u0644\u0635\u0641\u0642\u0629:</b> <code>${codeEsc}</code>
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u062A\u0645 \u0625\u063A\u0644\u0627\u0642 \u0628\u0627\u0628 \u0627\u0644\u0627\u0646\u0636\u0645\u0627\u0645 \u0644\u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u0642\u0629 \u0631\u0633\u0645\u064A\u0627\u064B. \u062A\u0627\u0628\u0639 \u0627\u0644\u0642\u0646\u0627\u0629 \u0644\u0644\u0635\u0641\u0642\u0629 \u0627\u0644\u0642\u0627\u062F\u0645\u0629.`;
    return { text: text2 };
  }
  if (kind === "admin_preview") {
    const text2 = `\u{1F4CB} <b>\u0645\u0639\u0627\u064A\u0646\u0629 \u0635\u0641\u0642\u0629 \u0644\u0644\u062A\u0623\u0643\u064A\u062F \u0642\u0628\u0644 \u0627\u0644\u0646\u0634\u0631</b> \u{1F4CB}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CC} <b>\u0627\u0644\u0641\u062A\u0631\u0629:</b> ${slotNameEsc}
\u{1F4CA} <b>\u0627\u0644\u0623\u0635\u0644:</b> ${assetEsc}
\u{1F3AF} <b>\u0627\u0644\u0627\u062A\u062C\u0627\u0647:</b> ${dirTextEsc}
\u23F1\uFE0F <b>\u0627\u0644\u0645\u062F\u0629:</b> ${durationStr}
\u{1F4C8} <b>\u0627\u0644\u0646\u0633\u0628\u0629:</b> ${pctText}
\u23F0 <b>\u0627\u0644\u062A\u0648\u0642\u064A\u062A (UTC+03:00 GMT+3):</b> ${startTimeStr} - ${endTimeStr}
\u{1F511} <b>\u0627\u0644\u0643\u0648\u062F \u0627\u0644\u0645\u0642\u062A\u0631\u062D:</b>
<code>${codeEsc}</code>
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u064A\u0631\u062C\u0649 \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0627\u0644\u0645\u0646\u0627\u0633\u0628:`;
    const reply_markup = {
      inline_keyboard: [[
        { text: "\u2705 \u0645\u0648\u0627\u0641\u0642\u0629 \u0648\u0646\u0634\u0631", callback_data: `appr:${c.id}` },
        { text: "\u274C \u0625\u0644\u063A\u0627\u0621", callback_data: `skip:${c.id}` }
      ]]
    };
    return { text: text2, reply_markup };
  }
  const badgeHeader = kind === "agent_slot" ? `\u{1F916} <b>\u0625\u0634\u0627\u0631\u0629 \u062A\u062F\u0627\u0648\u0644 \u062A\u0644\u0642\u0627\u0626\u064A\u0629 \u0645\u0646 \u0648\u0643\u064A\u0644 ORIN \u0627\u0644\u0630\u0643\u064A</b> \u{1F916}` : kind === "wakil_slot" ? `\u{1F451} <b>\u0625\u0634\u0627\u0631\u0629 \u062A\u062F\u0627\u0648\u0644 \u062E\u0627\u0635\u0629 - \u0635\u0641\u0642\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0645\u0639\u062A\u0645\u062F</b> \u{1F451}
\u{1F512} <i>(\u0645\u062E\u0635\u0635\u0629 \u0644\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0645\u0639\u062A\u0645\u062F\u064A\u0646 - \u0645\u0636\u0627\u0639\u0641\u0629 \u0627\u0644\u0631\u0635\u064A\u062F \u0641\u064A 20 \u064A\u0648\u0645\u0627\u064B)</i>` : `\u{1F680} <b>\u0625\u0634\u0627\u0631\u0629 \u062A\u062F\u0627\u0648\u0644 \u0645\u0639\u062A\u0645\u062F\u0629 \u0645\u0646 \u0625\u062F\u0627\u0631\u0629 ORIN</b> \u{1F680}`;
  const text = `${badgeHeader}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CC} <b>\u0627\u0644\u0635\u0641\u0642\u0629:</b> ${titleEsc}
\u{1F4CA} <b>\u0627\u0644\u0623\u0635\u0644 \u0627\u0644\u0645\u0627\u0644\u064A:</b> ${assetEsc}
\u{1F3AF} <b>\u0646\u0648\u0639 \u0627\u0644\u0635\u0641\u0642\u0629:</b> ${dirTextEsc}
\u23F1\uFE0F <b>\u0645\u062F\u0629 \u0627\u0644\u0635\u0641\u0642\u0629:</b> ${durationStr}
\u{1F4C8} <b>\u0646\u0633\u0628\u0629 \u0627\u0644\u0623\u0631\u0628\u0627\u062D \u0627\u0644\u0645\u0642\u0641\u0644\u0629:</b> ${pctText}
\u23F0 <b>\u0641\u062A\u0631\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629 (UTC+03:00 GMT+3):</b> ${startTimeStr} - ${endTimeStr}
\u{1F511} <b>\u0643\u0648\u062F \u0627\u0644\u062F\u062E\u0648\u0644 \u0641\u064A \u0627\u0644\u0635\u0641\u0642\u0629:</b>
<code>${codeEsc}</code>
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`;
  return { text };
}
function getTelegramBotToken() {
  const envToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (envToken.startsWith("8435789146:")) return envToken;
  return DEFAULT_TELEGRAM_BOT_TOKEN;
}
function getTelegramChannelId() {
  const prodChat = (process.env.TELEGRAM_CHANNEL_ID || "").trim();
  if (prodChat === "-1003753942964" || prodChat === "@orin_op") {
    return prodChat;
  }
  return DEFAULT_TELEGRAM_CHANNEL_ID;
}
async function sendTelegramApiRequest(methodName, bodyData, telegramBaseUrl = "https://api.telegram.org") {
  const token = getTelegramBotToken();
  const url = `${telegramBaseUrl}/bot${token}/${methodName}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData)
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429) {
      return {
        ok: false,
        status: 429,
        retry_after: Number(json.parameters?.retry_after || json.retry_after || 5),
        description: json.description || "Rate limited"
      };
    }
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        status: res.status,
        description: json.description || `Telegram API error HTTP ${res.status}`
      };
    }
    return { ok: true, status: 200, result: json.result };
  } catch (err) {
    return { ok: false, status: 500, description: err.message };
  }
}
async function processTelegramOutboxOnce(telegramBaseUrl = "https://api.telegram.org") {
  const autoPost = process.env.TELEGRAM_AUTO_POST_ENABLED !== "false";
  if (!autoPost) {
    console.log("[TELEGRAM_OUTBOX] Kill switch active (TELEGRAM_AUTO_POST_ENABLED=false), skipping outbox.");
    return { processed: 0, errors: 0 };
  }
  return await withTx(async (client) => {
    const rowsRes = await client.query(
      `SELECT * FROM telegram_outbox
       WHERE (status = 'pending' OR (status = 'failed' AND attempts < 10)) AND next_attempt_at <= NOW()
       ORDER BY created_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED`
    );
    let processed = 0;
    let errors = 0;
    for (const row of rowsRes.rows) {
      const payload = row.payload || {};
      const method = payload.method || "sendMessage";
      const body = payload.body || {};
      if (row.kind === "channel_post" || row.kind === "channel_code" || !body.chat_id || body.chat_id === "@channel" || body.chat_id === "@testchannel") {
        body.chat_id = getTelegramChannelId();
      }
      const res = await sendTelegramApiRequest(method, body, telegramBaseUrl);
      if (res.ok) {
        const msgId = String(res.result?.message_id || "");
        await client.query(
          `UPDATE telegram_outbox
           SET status = 'sent', attempts = attempts + 1, message_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [msgId, row.id]
        );
        if (row.kind === "channel_post") {
          await client.query(
            `UPDATE scheduled_runs SET telegram_message_id = $1, updated_at = NOW() WHERE contract_id = $2`,
            [msgId, row.contract_id]
          );
        }
        processed++;
        console.log(`[TELEGRAM_OUTBOX_SUCCESS] Outbox ID ${row.id} (${row.kind}) sent message_id ${msgId}`);
      } else {
        errors++;
        const nextDelaySec = res.status === 429 ? res.retry_after || 5 : Math.pow(2, Math.min(row.attempts + 1, 6)) * 5;
        const attempts = row.attempts + 1;
        const newStatus = attempts >= 5 ? "failed" : "pending";
        await client.query(
          `UPDATE telegram_outbox
           SET attempts = $1, status = $2, last_error = $3, next_attempt_at = NOW() + ($4 || ' seconds')::interval, updated_at = NOW()
           WHERE id = $5`,
          [attempts, newStatus, res.description, `${nextDelaySec}`, row.id]
        );
        console.log(`[TELEGRAM_OUTBOX_ERROR] Outbox ID ${row.id} attempt ${attempts} failed: ${res.description}. Next attempt in ${nextDelaySec}s`);
      }
    }
    return { processed, errors };
  });
}
var DEFAULT_TELEGRAM_BOT_TOKEN, DEFAULT_TELEGRAM_CHANNEL_ID;
var init_telegram = __esm({
  "src/telegram.ts"() {
    init_db();
    DEFAULT_TELEGRAM_BOT_TOKEN = "8435789146:AAGDwXQ3NcBf0CMdsAo0ZeL4Pn28RyS_4sM";
    DEFAULT_TELEGRAM_CHANNEL_ID = "-1003753942964";
  }
});

// src/scheduler.ts
init_db();
init_telegram();
import { randomUUID, randomBytes, createHash } from "node:crypto";
function computeSlotTargetTime(slotTimeStr, tz, dateStr) {
  const [hours, minutes] = slotTimeStr.split(":").map(Number);
  const [year, month, day] = dateStr.split("-").map(Number);
  const offsetHours = tz === "Europe/Istanbul" ? 3 : 0;
  const targetUtcMs = Date.UTC(year, month - 1, day, hours - offsetHours, minutes, 0, 0);
  return targetUtcMs;
}
function getCurrentDateStrInTz(nowMs, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(nowMs));
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}
async function processSchedulerSlotsOnce(nowMs = Date.now()) {
  return await withTx(async (client) => {
    const slotsRes = await client.query(
      `SELECT * FROM trade_slots WHERE enabled = TRUE FOR UPDATE SKIP LOCKED`
    );
    let runsCreated = 0;
    let missed = 0;
    for (const slot of slotsRes.rows) {
      const days = Array.isArray(slot.days_of_week) ? slot.days_of_week : [0, 1, 2, 3, 4, 5, 6];
      const runDate = getCurrentDateStrInTz(nowMs, slot.timezone || "Europe/Istanbul");
      const targetTimeMs = computeSlotTargetTime(slot.local_time, slot.timezone || "Europe/Istanbul", runDate);
      const [y, m, d] = runDate.split("-").map(Number);
      const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (!days.includes(dayOfWeek)) continue;
      if (slot.id === "slot-1645" && runDate === "2026-10-16") {
        continue;
      }
      const runCheck = await client.query(
        `SELECT id, status FROM scheduled_runs WHERE slot_id = $1 AND run_date = $2`,
        [slot.id, runDate]
      );
      if (runCheck.rowCount > 0) continue;
      const windowStartMs = targetTimeMs;
      const windowGraceEndMs = targetTimeMs + Number(slot.closes_after_min || 60) * 60 * 1e3;
      if (nowMs < windowStartMs) {
        continue;
      }
      if (nowMs > windowGraceEndMs) {
        const runId = "run-" + randomUUID();
        await client.query(
          `INSERT INTO scheduled_runs (id, slot_id, run_date, status, created_at, updated_at)
           VALUES ($1, $2, $3, 'missed', NOW(), NOW())
           ON CONFLICT (slot_id, run_date) DO NOTHING`,
          [runId, slot.id, runDate]
        );
        const auditPayload = JSON.stringify({ slotId: slot.id, runDate, targetTimeMs, nowMs, reason: "grace_period_exceeded" });
        await client.query(
          `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
           VALUES ('scheduler', 'TRADE_SLOT_MISSED', $1, $2::jsonb, $3)
           ON CONFLICT DO NOTHING`,
          [slot.id + "-" + runDate, auditPayload, createHash("sha256").update(auditPayload).digest("hex")]
        );
        missed++;
        console.log(`[SCHEDULER_MISSED] Slot ${slot.id} missed for ${runDate} (Target: ${new Date(targetTimeMs).toISOString()})`);
        continue;
      }
      await executeSlot(slot, client, nowMs, runDate);
      runsCreated++;
      console.log(`[SCHEDULER_RUN] Slot ${slot.id} executed for ${runDate} (Mode: ${slot.mode})`);
    }
    return { runsCreated, missed };
  });
}
var SCHEDULE_29_DAYS = [
  { d: 1, s1: { name: "\u0627\u0642\u062A\u0646\u0627\u0635 \u0642\u0645\u0629 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 - \u062C\u0644\u0633\u0629 \u0644\u0646\u062F\u0646", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 118 }, s2: { name: "\u0632\u062E\u0645 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0641\u0648\u0631\u064A - \u0627\u0641\u062A\u062A\u0627\u062D \u0646\u064A\u0648\u064A\u0648\u0631\u0643", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 122 }, s3: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0645\u0627\u0633\u064A\u0629 - \u0627\u0642\u062A\u0646\u0627\u0635 \u0633\u064A\u0648\u0644\u0629 \u0648\u0648\u0644 \u0633\u062A\u0631\u064A\u062A", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 109 } },
  { d: 2, s1: { name: "\u0627\u0631\u062A\u062F\u0627\u062F \u0627\u0644\u064A\u0648\u0631\u0648 \u0645\u0642\u0627\u0628\u0644 \u0627\u0644\u062F\u0648\u0644\u0627\u0631", asset: "EURUSD", dir: "SELL", dur: 120, bps: 112 }, s2: { name: "\u0627\u062E\u062A\u0631\u0627\u0642 \u0645\u0642\u0627\u0648\u0645\u0629 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 \u0627\u0644\u0633\u0631\u064A\u0639\u0629", asset: "ETHUSD", dir: "BUY", dur: 90, bps: 128 }, s3: { name: "\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0627\u0633\u062A\u0631\u0627\u062A\u064A\u062C\u064A - \u0642\u0645\u0629 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0645\u0633\u0627\u0626\u064A\u0629", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 109 } },
  { d: 3, s1: { name: "\u0645\u0648\u062C\u0629 \u0635\u0639\u0648\u062F \u0627\u0644\u0630\u0647\u0628 - \u062A\u062F\u0627\u0648\u0644\u0627\u062A \u0627\u0644\u0645\u0633\u0627\u0621", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 125 }, s2: { name: "\u0641\u0631\u0635\u0629 \u0633\u0648\u0644\u0627\u0646\u0627 \u0627\u0644\u0633\u0631\u064A\u0639\u0629 - \u0632\u062E\u0645 \u0627\u0644\u0633\u064A\u0648\u0644\u0629", asset: "SOLUSD", dir: "BUY", dur: 60, bps: 115 }, s3: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u062D\u0635\u0631\u064A\u0629 - \u0627\u062E\u062A\u0631\u0627\u0642 \u0633\u0648\u0644\u0627\u0646\u0627 \u0627\u0644\u0644\u064A\u0644\u064A", asset: "SOLUSD", dir: "BUY", dur: 90, bps: 108 } },
  { d: 4, s1: { name: "\u062A\u062F\u0627\u0648\u0644 \u0643\u0633\u0631 \u0627\u062A\u062C\u0627\u0647 \u0627\u0644\u062C\u0646\u064A\u0647 \u0627\u0644\u0625\u0633\u062A\u0631\u0644\u064A\u0646\u064A", asset: "GBPUSD", dir: "BUY", dur: 120, bps: 120 }, s2: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0645\u0633\u0627\u0626\u064A\u0629 - \u062D\u0631\u0643\u0629 \u0627\u0644\u062D\u064A\u062A\u0627\u0646", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 120 }, s3: { name: "\u0632\u062E\u0645 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 \u0627\u0644\u062D\u0635\u0631\u064A - \u062A\u062F\u0627\u0648\u0644\u0627\u062A \u0627\u0644\u0648\u0643\u064A\u0644", asset: "ETHUSD", dir: "BUY", dur: 60, bps: 108 } },
  { d: 5, s1: { name: "\u0636\u063A\u0637 \u0634\u0631\u0627\u0621 \u0627\u0644\u0630\u0647\u0628 - \u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0648\u0631\u0648\u0628\u064A\u0629", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 110 }, s2: { name: "\u0627\u0646\u062F\u0641\u0627\u0639 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 \u0627\u0644\u0644\u062D\u0638\u064A - \u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0645\u0631\u064A\u0643\u064A\u0629", asset: "ETHUSD", dir: "BUY", dur: 90, bps: 130 }, s3: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0645\u0639\u062A\u0645\u062F - \u0645\u0648\u062C\u0629 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0635\u0627\u0639\u062F\u0629", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 108 } },
  { d: 6, s1: { name: "\u0627\u0646\u0639\u0643\u0627\u0633 \u0627\u0644\u064A\u0648\u0631\u0648 \u0627\u0644\u0644\u062D\u0638\u064A - \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0646\u0645\u0637", asset: "EURUSD", dir: "BUY", dur: 60, bps: 122 }, s2: { name: "\u0627\u0633\u062A\u0642\u0631\u0627\u0631 \u0627\u0644\u0630\u0647\u0628 \u0641\u0648\u0642 \u0627\u0644\u062F\u0639\u0645 \u0627\u0644\u0631\u0626\u064A\u0633\u064A", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 118 }, s3: { name: "\u0627\u0642\u062A\u0646\u0627\u0635 \u0642\u0627\u0639 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 - \u062C\u0644\u0633\u0629 \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0644\u064A\u0644\u064A\u0629", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 108 } },
  { d: 7, s1: { name: "\u062A\u0623\u0643\u064A\u062F \u0627\u062A\u062C\u0627\u0647 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0635\u0627\u0639\u062F", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 115 }, s2: { name: "\u0627\u0642\u062A\u0646\u0627\u0635 \u0642\u0627\u0639 \u0627\u0644\u062C\u0646\u064A\u0647 \u0627\u0644\u0625\u0633\u062A\u0631\u0644\u064A\u0646\u064A", asset: "GBPUSD", dir: "BUY", dur: 120, bps: 125 }, s3: { name: "\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u062C\u0646\u064A\u0647 \u0627\u0644\u0625\u0633\u062A\u0631\u0644\u064A\u0646\u064A - \u0641\u0631\u0635\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0645\u0639\u062A\u0645\u062F", asset: "GBPUSD", dir: "BUY", dur: 120, bps: 108 } },
  { d: 8, s1: { name: "\u0632\u062E\u0645 \u0627\u0644\u0630\u0647\u0628 \u0645\u0639 \u0627\u0641\u062A\u062A\u0627\u062D \u0623\u0633\u0648\u0627\u0642 \u0627\u0644\u0633\u0644\u0639", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 128 }, s2: { name: "\u0645\u0648\u062C\u0629 \u0635\u0639\u0648\u062F \u0633\u0648\u0644\u0627\u0646\u0627 - \u062A\u062D\u0631\u0643 \u0627\u0644\u0632\u062E\u0645", asset: "SOLUSD", dir: "BUY", dur: 60, bps: 113 }, s3: { name: "\u0627\u0646\u0641\u062C\u0627\u0631 \u0633\u064A\u0648\u0644\u0629 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 - \u0635\u0641\u0642\u0629 \u0627\u0644\u0648\u0643\u064A\u0644", asset: "ETHUSD", dir: "BUY", dur: 90, bps: 108 } },
  { d: 9, s1: { name: "\u062A\u0623\u0643\u064A\u062F \u0643\u0633\u0631 \u0627\u062A\u062C\u0627\u0647 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645", asset: "ETHUSD", dir: "BUY", dur: 90, bps: 114 }, s2: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0641\u0648\u0631\u064A\u0629 - \u0627\u0631\u062A\u062F\u0627\u062F \u0627\u0644\u062F\u0639\u0645", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 126 }, s3: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0645\u0644\u0643\u064A\u0629 - \u0643\u0628\u0627\u0631 \u0627\u0644\u0645\u0633\u062A\u062B\u0645\u0631\u064A\u0646 \u0648\u0627\u0644\u0648\u0643\u0644\u0627\u0621", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 108 } },
  { d: 10, s1: { name: "\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0644\u062D\u0638\u064A - \u0633\u064A\u0648\u0644\u0629 \u0627\u0644\u0645\u0633\u0627\u0621", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 121 }, s2: { name: "\u0627\u062E\u062A\u0631\u0627\u0642 \u0627\u0644\u064A\u0648\u0631\u0648 \u0645\u0642\u0627\u0628\u0644 \u0627\u0644\u062F\u0648\u0644\u0627\u0631", asset: "EURUSD", dir: "BUY", dur: 120, bps: 120 }, s3: { name: "\u0627\u062E\u062A\u0631\u0627\u0642 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u062D\u0627\u0633\u0645 - \u0635\u0641\u0642\u0629 \u0627\u0644\u0648\u0643\u064A\u0644", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 108 } },
  { d: 11, s1: { name: "\u0641\u0631\u0635\u0629 \u0627\u0644\u062C\u0646\u064A\u0647 \u0627\u0644\u0625\u0633\u062A\u0631\u0644\u064A\u0646\u064A - \u0643\u0633\u0631 \u0627\u0644\u0642\u0646\u0627\u0629", asset: "GBPUSD", dir: "SELL", dur: 60, bps: 116 }, s2: { name: "\u0627\u0646\u062F\u0641\u0627\u0639 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 - \u0632\u062E\u0645 \u0627\u0644\u0633\u064A\u0648\u0644\u0629 \u0627\u0644\u0623\u0645\u0631\u064A\u0643\u064A\u0629", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 124 }, s3: { name: "\u0632\u062E\u0645 \u0633\u0648\u0644\u0627\u0646\u0627 \u0627\u0644\u0644\u064A\u0644\u064A - \u0645\u062D\u0641\u0638\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0645\u0639\u062A\u0645\u062F", asset: "SOLUSD", dir: "BUY", dur: 60, bps: 108 } },
  { d: 12, s1: { name: "\u0635\u0639\u0648\u062F \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0641\u0648\u0631\u064A \u0646\u062D\u0648 \u0627\u0644\u0647\u062F\u0641 \u0627\u0644\u0623\u0648\u0644", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 124 }, s2: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 - \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0627\u062A\u062C\u0627\u0647 \u0627\u0644\u0635\u0627\u0639\u062F", asset: "ETHUSD", dir: "BUY", dur: 90, bps: 117 }, s3: { name: "\u0627\u0631\u062A\u062F\u0627\u062F \u0627\u0644\u064A\u0648\u0631\u0648 \u0627\u0644\u0645\u0633\u0627\u0626\u064A - \u0641\u0631\u0635\u0629 \u0627\u0644\u0648\u0643\u064A\u0644", asset: "EURUSD", dir: "BUY", dur: 120, bps: 108 } },
  { d: 13, s1: { name: "\u0632\u062E\u0645 \u0633\u0648\u0644\u0627\u0646\u0627 - \u0627\u062E\u062A\u0631\u0627\u0642 \u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0645\u0642\u0627\u0648\u0645\u0629", asset: "SOLUSD", dir: "BUY", dur: 60, bps: 109 }, s2: { name: "\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0622\u0645\u0646 - \u0627\u0641\u062A\u062A\u0627\u062D \u0627\u0644\u0645\u0633\u0627\u0621", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 131 }, s3: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u062E\u0627\u0635\u0629 - \u0627\u0631\u062A\u062F\u0627\u062F \u0627\u0644\u062F\u0639\u0645 \u0627\u0644\u0644\u064A\u0644\u064A", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 108 } },
  { d: 14, s1: { name: "\u0627\u0631\u062A\u062F\u0627\u062F \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0645\u0646 \u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0637\u0644\u0628", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 126 }, s2: { name: "\u0645\u0648\u062C\u0629 \u0627\u0644\u064A\u0648\u0631\u0648 \u0627\u0644\u0647\u0627\u0628\u0637\u0629 - \u062C\u0646\u064A \u0623\u0631\u0628\u0627\u062D", asset: "EURUSD", dir: "SELL", dur: 120, bps: 115 }, s3: { name: "\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u062D\u0635\u0631\u064A - \u0632\u062E\u0645 \u0633\u064A\u0648\u0644\u0629 \u0627\u0644\u062D\u064A\u062A\u0627\u0646", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 108 } },
  { d: 15, s1: { name: "\u062A\u0623\u0643\u064A\u062F \u0634\u0631\u0627\u0621 \u0627\u0644\u0630\u0647\u0628 - \u062B\u0628\u0627\u062A \u0623\u0639\u0644\u0649 \u0627\u0644\u0645\u062A\u0648\u0633\u0637", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 118 }, s2: { name: "\u0641\u0631\u0635\u0629 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 \u0627\u0644\u0633\u0631\u064A\u0639\u0629 - \u062E\u062A\u0627\u0645 \u0627\u0644\u062C\u0644\u0633\u0629", asset: "ETHUSD", dir: "BUY", dur: 60, bps: 123 }, s3: { name: "\u0627\u062E\u062A\u0631\u0627\u0642 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 \u0627\u0644\u0635\u0627\u0639\u062F - \u062C\u0644\u0633\u0629 \u0627\u0644\u0648\u0643\u0644\u0627\u0621", asset: "ETHUSD", dir: "BUY", dur: 90, bps: 108 } },
  { d: 16, s1: { name: "\u0643\u0633\u0631 \u0646\u0637\u0627\u0642 \u0627\u0644\u062C\u0646\u064A\u0647 \u0627\u0644\u0625\u0633\u062A\u0631\u0644\u064A\u0646\u064A \u0627\u0644\u0639\u0631\u0636\u064A", asset: "GBPUSD", dir: "BUY", dur: 120, bps: 113 }, s2: { name: "\u0632\u062E\u0645 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0645\u0633\u0627\u0626\u064A - \u0627\u062E\u062A\u0631\u0627\u0642 \u0627\u0644\u0642\u0645\u0629", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 128 }, s3: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u062C\u0646\u064A\u0647 \u0627\u0644\u0625\u0633\u062A\u0631\u0644\u064A\u0646\u064A - \u0643\u0633\u0631 \u0627\u0644\u0642\u0645\u0629 \u0644\u0644\u0648\u0643\u064A\u0644", asset: "GBPUSD", dir: "BUY", dur: 120, bps: 108 } },
  { d: 17, s1: { name: "\u0635\u0639\u0648\u062F \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0644\u062D\u0638\u064A - \u062A\u0641\u0627\u0639\u0644 \u0645\u0639 \u0627\u0644\u0623\u062E\u0628\u0627\u0631", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 122 }, s2: { name: "\u0627\u0631\u062A\u062F\u0627\u062F \u0633\u0648\u0644\u0627\u0646\u0627 \u0627\u0644\u0625\u064A\u062C\u0627\u0628\u064A - \u0627\u062A\u062C\u0627\u0647 \u0635\u0627\u0639\u062F", asset: "SOLUSD", dir: "BUY", dur: 60, bps: 119 }, s3: { name: "\u0645\u0648\u062C\u0629 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0645\u0627\u0633\u064A\u0629 - \u0635\u0641\u0642\u0629 \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0645\u0639\u062A\u0645\u062F\u064A\u0646", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 108 } },
  { d: 18, s1: { name: "\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 \u0627\u0644\u0641\u0648\u0631\u064A - \u0632\u062E\u0645 \u0642\u0648\u064A", asset: "ETHUSD", dir: "BUY", dur: 90, bps: 111 }, s2: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0630\u0647\u0628\u064A\u0629 - \u0627\u0633\u062A\u0645\u0631\u0627\u0631 \u0627\u0644\u0627\u062A\u062C\u0627\u0647", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 130 }, s3: { name: "\u0627\u0642\u062A\u0646\u0627\u0635 \u0633\u0648\u0644\u0627\u0646\u0627 \u0627\u0644\u062D\u0635\u0631\u064A - \u062C\u0644\u0633\u0629 \u062E\u062A\u0627\u0645 \u0627\u0644\u0645\u0633\u0627\u0621", asset: "SOLUSD", dir: "BUY", dur: 60, bps: 108 } },
  { d: 19, s1: { name: "\u0627\u0633\u062A\u0642\u0631\u0627\u0631 \u0627\u0644\u064A\u0648\u0631\u0648 \u0645\u0642\u0627\u0628\u0644 \u0627\u0644\u062F\u0648\u0644\u0627\u0631 \u0627\u0644\u0623\u0645\u0631\u064A\u0643\u064A", asset: "EURUSD", dir: "BUY", dur: 120, bps: 125 }, s2: { name: "\u0641\u0631\u0635\u0629 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0645\u0633\u0627\u0626\u064A\u0629 - \u0632\u062E\u0645 \u0627\u0644\u0634\u0631\u0627\u0621", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 116 }, s3: { name: "\u0632\u062E\u0645 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0645\u0624\u0633\u0633\u064A - \u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u062E\u0627\u0635", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 108 } },
  { d: 20, s1: { name: "\u062A\u0623\u0643\u064A\u062F \u0627\u062E\u062A\u0631\u0627\u0642 \u0627\u0644\u0630\u0647\u0628 \u0644\u0645\u0633\u062A\u0648\u064A\u0627\u062A \u062C\u062F\u064A\u062F\u0629", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 119 }, s2: { name: "\u0645\u0648\u062C\u0629 \u0627\u0644\u062C\u0646\u064A\u0647 \u0627\u0644\u0625\u0633\u062A\u0631\u0644\u064A\u0646\u064A - \u062D\u0631\u0643\u0629 \u0633\u064A\u0648\u0644\u0629 \u0639\u0627\u0644\u064A\u0629", asset: "GBPUSD", dir: "BUY", dur: 90, bps: 122 }, s3: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u062E\u062A\u0627\u0645\u064A\u0629 - \u0627\u0643\u062A\u0645\u0627\u0644 \u0645\u0636\u0627\u0639\u0641\u0629 \u0627\u0644\u0631\u0635\u064A\u062F \u0641\u064A 20 \u064A\u0648\u0645\u0627\u064B", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 108 } },
  { d: 21, s1: { name: "\u0627\u0646\u062F\u0641\u0627\u0639 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 \u0627\u0644\u0633\u0631\u064A\u0639 - \u0633\u064A\u0648\u0644\u0629 \u0627\u0644\u0639\u0635\u0631", asset: "ETHUSD", dir: "BUY", dur: 60, bps: 115 }, s2: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0627\u0633\u062A\u0631\u0627\u062A\u064A\u062C\u064A\u0629 - \u062A\u062F\u0627\u0648\u0644\u0627\u062A \u0627\u0644\u0644\u064A\u0644", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 126 }, s3: { name: "\u062F\u0648\u0631\u0629 \u0627\u0644\u0646\u0645\u0648 \u0627\u0644\u0645\u062A\u0642\u062F\u0645 - \u0635\u0641\u0642\u0629 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 \u0644\u0644\u0648\u0643\u064A\u0644", asset: "ETHUSD", dir: "BUY", dur: 90, bps: 108 } },
  { d: 22, s1: { name: "\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0622\u0645\u0646 - \u0646\u0645\u0648\u0630\u062C \u0643\u0633\u0631 \u0642\u0627\u0639", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 127 }, s2: { name: "\u0627\u0646\u0639\u0643\u0627\u0633 \u0633\u0648\u0644\u0627\u0646\u0627 - \u062A\u0623\u0643\u064A\u062F \u0634\u0645\u0639\u0629 \u0627\u0644\u0627\u0628\u062A\u0644\u0627\u0639", asset: "SOLUSD", dir: "BUY", dur: 90, bps: 114 }, s3: { name: "\u0627\u0633\u062A\u0645\u0631\u0627\u0631 \u0645\u0636\u0627\u0639\u0641\u0629 \u0627\u0644\u0645\u062D\u0641\u0638\u0629 - \u0632\u062E\u0645 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0644\u064A\u0644\u064A", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 108 } },
  { d: 23, s1: { name: "\u0627\u0631\u062A\u062F\u0627\u062F \u0627\u0644\u064A\u0648\u0631\u0648 \u0646\u062D\u0648 \u0645\u0633\u062A\u0648\u064A\u0627\u062A \u0627\u0644\u0645\u0642\u0627\u0648\u0645\u0629", asset: "EURUSD", dir: "BUY", dur: 120, bps: 114 }, s2: { name: "\u0632\u062E\u0645 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0641\u0648\u0631\u064A - \u0627\u0633\u062A\u0647\u062F\u0627\u0641 \u0642\u0645\u0629 \u0627\u0644\u064A\u0648\u0645", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 127 }, s3: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0641\u0648\u0631\u064A\u0629 - \u0627\u0642\u062A\u0646\u0627\u0635 \u0627\u0644\u0648\u0643\u064A\u0644", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 108 } },
  { d: 24, s1: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u062C\u0646\u064A\u0647 \u0627\u0644\u0625\u0633\u062A\u0631\u0644\u064A\u0646\u064A - \u0643\u0633\u0631 \u062A\u0631\u064A\u0646\u062F \u0635\u0627\u0639\u062F", asset: "GBPUSD", dir: "BUY", dur: 60, bps: 123 }, s2: { name: "\u062A\u062D\u0631\u0643 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0644\u062D\u0638\u064A - \u0633\u064A\u0648\u0644\u0629 \u062D\u064A\u062A\u0627\u0646", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 118 }, s3: { name: "\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u064A\u0648\u0631\u0648 \u0627\u0644\u062D\u0635\u0631\u064A - \u0627\u0631\u062A\u062F\u0627\u062F \u062F\u0639\u0645 \u0642\u0648\u064A \u0644\u0644\u0648\u0643\u0644\u0627\u0621", asset: "EURUSD", dir: "BUY", dur: 120, bps: 108 } },
  { d: 25, s1: { name: "\u0635\u0639\u0648\u062F \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 \u0627\u0644\u0627\u0633\u062A\u062B\u0645\u0627\u0631\u064A - \u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0648\u0644\u0649", asset: "ETHUSD", dir: "BUY", dur: 90, bps: 112 }, s2: { name: "\u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u062D\u0627\u0633\u0645 - \u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0645\u0633\u0627\u0626\u064A\u0629", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 129 }, s3: { name: "\u0632\u062E\u0645 \u0633\u0648\u0644\u0627\u0646\u0627 \u0627\u0644\u0645\u0627\u0633\u064A - \u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0644\u064A\u0644\u064A\u0629 \u0644\u0644\u0648\u0643\u064A\u0644", asset: "SOLUSD", dir: "BUY", dur: 60, bps: 108 } },
  { d: 26, s1: { name: "\u0627\u062E\u062A\u0631\u0627\u0642 \u0633\u0648\u0644\u0627\u0646\u0627 \u0627\u0644\u0633\u0631\u064A\u0639 \u0646\u062D\u0648 \u0645\u0633\u062A\u0648\u064A\u0627\u062A \u0639\u0644\u064A\u0627", asset: "SOLUSD", dir: "BUY", dur: 60, bps: 120 }, s2: { name: "\u0641\u0631\u0635\u0629 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0645\u0624\u0643\u062F\u0629 - \u0627\u0631\u062A\u062F\u0627\u062F \u0642\u0648\u064A", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 121 }, s3: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0645\u0644\u0643\u064A\u0629 - \u0643\u0633\u0631 \u0645\u0633\u062A\u0648\u064A\u0627\u062A \u0627\u0644\u0645\u0642\u0627\u0648\u0645\u0629 \u0644\u0644\u0648\u0643\u064A\u0644", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 108 } },
  { d: 27, s1: { name: "\u062A\u0623\u0643\u064A\u062F \u0634\u0631\u0627\u0621 \u0627\u0644\u064A\u0648\u0631\u0648 - \u0627\u0641\u062A\u062A\u0627\u062D \u0627\u0644\u0623\u0633\u0648\u0627\u0642", asset: "EURUSD", dir: "BUY", dur: 120, bps: 116 }, s2: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u0645\u0645\u064A\u0632\u0629 - \u0627\u0633\u062A\u0642\u0631\u0627\u0631 \u0627\u0644\u0623\u0633\u0639\u0627\u0631", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 125 }, s3: { name: "\u0627\u062E\u062A\u0631\u0627\u0642 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 \u0627\u0644\u0645\u0639\u062A\u0645\u062F - \u062A\u062F\u0627\u0648\u0644 \u0627\u0644\u0648\u0643\u0644\u0627\u0621", asset: "ETHUSD", dir: "BUY", dur: 90, bps: 108 } },
  { d: 28, s1: { name: "\u0645\u0648\u062C\u0629 \u0627\u0644\u062C\u0646\u064A\u0647 \u0627\u0644\u0625\u0633\u062A\u0631\u0644\u064A\u0646\u064A \u0627\u0644\u0635\u0627\u0639\u062F\u0629", asset: "GBPUSD", dir: "BUY", dur: 90, bps: 124 }, s2: { name: "\u0627\u0646\u062F\u0641\u0627\u0639 \u0627\u0644\u0625\u064A\u062B\u064A\u0631\u064A\u0648\u0645 - \u062A\u0623\u0643\u064A\u062F \u0643\u0633\u0631 \u062E\u0637 \u0627\u0644\u0627\u062A\u062C\u0627\u0647", asset: "ETHUSD", dir: "BUY", dur: 60, bps: 117 }, s3: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u0627\u0633\u062A\u0631\u0627\u062A\u064A\u062C\u064A\u0629 - \u0633\u064A\u0648\u0644\u0629 \u0627\u0644\u0645\u0633\u0627\u0621 \u0644\u0644\u0648\u0643\u064A\u0644", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 108 } },
  { d: 29, s1: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0628\u064A\u062A\u0643\u0648\u064A\u0646 \u0627\u0644\u062E\u062A\u0627\u0645\u064A\u0629 - \u062E\u062A\u0627\u0645 \u062F\u0648\u0631\u0629 \u0627\u0644\u062A\u062F\u0627\u0648\u0644", asset: "BTCUSD", dir: "BUY", dur: 60, bps: 118 }, s2: { name: "\u0635\u0641\u0642\u0629 \u0627\u0644\u0630\u0647\u0628 \u0627\u0644\u062E\u062A\u0627\u0645\u064A\u0629 - \u0627\u0643\u062A\u0645\u0627\u0644 \u0645\u0636\u0627\u0639\u0641\u0629 \u0627\u0644\u0631\u0635\u064A\u062F", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 123 }, s3: { name: "\u0627\u0644\u0635\u0641\u0642\u0629 \u0627\u0644\u0643\u0628\u0631\u0649 \u0644\u0644\u0648\u0643\u064A\u0644 - \u062A\u062A\u0648\u064A\u062C \u062F\u0648\u0631\u0629 \u0627\u0644\u0623\u0631\u0628\u0627\u062D \u0627\u0644\u0627\u0633\u062A\u062B\u0646\u0627\u0626\u064A\u0629", asset: "XAUUSD", dir: "BUY", dur: 180, bps: 108 } }
];
function get29DaySlotPlan(runDate, slotId) {
  const cycleStart = (/* @__PURE__ */ new Date("2026-10-16T00:00:00Z")).getTime();
  const currentMs = (/* @__PURE__ */ new Date(runDate + "T00:00:00Z")).getTime();
  const diffDays = Math.floor((currentMs - cycleStart) / 864e5);
  const dayIndex = (diffDays % 29 + 29) % 29 + 1;
  const plan = SCHEDULE_29_DAYS[dayIndex - 1] || SCHEDULE_29_DAYS[0];
  let session = plan.s1;
  if (slotId.includes("1830") || slotId.includes("session2") || slotId.includes("second")) {
    session = plan.s2;
  } else if (slotId.includes("2030") || slotId.includes("session3") || slotId.includes("third") || slotId.includes("wakil")) {
    session = plan.s3;
  }
  return { dayIndex, session };
}
async function executeSlot(slot, client, nowMs, runDate) {
  const { session } = get29DaySlotPlan(runDate, slot.id);
  const tradeAsset = session.asset || slot.asset || "BTCUSD";
  const tradeDirection = session.dir || slot.direction || "BUY";
  const tradeDuration = Number(session.dur || slot.duration_sec || 60);
  const tradeBps = Number(session.bps || slot.settlement_bps || 118);
  const tradeTitle = session.name || slot.name || "\u0635\u0641\u0642\u0629 \u0645\u0639\u062A\u0645\u062F\u0629";
  const slotEligibility = slot.eligibility || (slot.id === "slot-2030" ? "advanced" : "all");
  const contractId = "contract-auto-" + randomUUID();
  const code = "ORIN-" + randomBytes(6).toString("hex").toUpperCase();
  const opensAtMs = nowMs + Number(slot.opens_offset_min || 0) * 60 * 1e3;
  const closesAtMs = opensAtMs + Number(slot.closes_after_min || 60) * 60 * 1e3;
  const hashVal = createHash("sha256").update(code + ":" + tradeAsset + ":" + tradeDirection + ":" + tradeBps).digest("hex");
  const initialStatus = "active";
  const runStatus = "published";
  await client.query(
    `UPDATE trade_slots
     SET name = $1, asset = $2, direction = $3, duration_sec = $4, settlement_bps = $5, updated_at = NOW()
     WHERE id = $6`,
    [tradeTitle, tradeAsset, tradeDirection, tradeDuration, tradeBps, slot.id]
  );
  await client.query(
    `INSERT INTO profiles (id, email, display_name, role)
     VALUES ('scheduler', 'scheduler@orin.internal', 'ORIN Scheduler Engine', 'admin')
     ON CONFLICT (id) DO NOTHING`
  );
  await client.query(
    `INSERT INTO contracts (id, code, title, asset, direction, duration_sec, settlement_bps, status, opens_at, closes_at, eligibility, hash, admin_id, created_at, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TO_TIMESTAMP($9/1000.0), TO_TIMESTAMP($10/1000.0), $11, $12, 'scheduler', NOW(), NOW())`,
    [contractId, code, tradeTitle, tradeAsset, tradeDirection, tradeDuration, tradeBps, initialStatus, opensAtMs, closesAtMs, slotEligibility, hashVal]
  );
  const runId = "run-" + randomUUID();
  await client.query(
    `INSERT INTO scheduled_runs (id, slot_id, run_date, status, contract_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (slot_id, run_date) DO UPDATE SET contract_id = EXCLUDED.contract_id, status = EXCLUDED.status, updated_at = NOW()`,
    [runId, slot.id, runDate, runStatus, contractId]
  );
  const cInfo = {
    id: contractId,
    code,
    title: tradeTitle,
    asset: tradeAsset,
    direction: tradeDirection,
    durationSec: tradeDuration,
    settlementBps: tradeBps,
    opensAtMs,
    closesAtMs
  };
  const templateKind = slotEligibility === "advanced" || slot.id.includes("wakil") || slot.id.includes("2030") ? "wakil_slot" : "regular_slot";
  const tpl = renderMessageTemplate(templateKind, cInfo, tradeTitle);
  const channelId = getTelegramChannelId();
  const outboxPayload = JSON.stringify({
    method: "sendMessage",
    body: {
      chat_id: channelId,
      text: tpl.text,
      parse_mode: "HTML",
      reply_markup: tpl.reply_markup
    }
  });
  await client.query(
    `INSERT INTO telegram_outbox (id, kind, contract_id, payload, status, created_at, updated_at)
     VALUES ($1, 'channel_post', $2, $3::jsonb, 'pending', NOW(), NOW())
     ON CONFLICT (kind, contract_id) DO NOTHING`,
    ["outbox-post-" + contractId, contractId, outboxPayload]
  );
  const codePayload = JSON.stringify({
    method: "sendMessage",
    body: {
      chat_id: channelId,
      text: `<code>${code}</code>`,
      parse_mode: "HTML"
    }
  });
  await client.query(
    `INSERT INTO telegram_outbox (id, kind, contract_id, payload, status, created_at, updated_at)
     VALUES ($1, 'channel_code', $2, $3::jsonb, 'pending', NOW() + INTERVAL '1 second', NOW() + INTERVAL '1 second')
     ON CONFLICT (kind, contract_id) DO NOTHING`,
    ["outbox-code-" + contractId, contractId, codePayload]
  );
  return { code, contractId, runId, isAuto: true };
}
async function triggerSlotRunDirectly(slotId, force = true) {
  const result = await withTx(async (client) => {
    const slotRes = await client.query("SELECT * FROM trade_slots WHERE id = $1", [slotId]);
    if (slotRes.rowCount === 0) {
      throw new Error("Trade slot not found");
    }
    const slot = slotRes.rows[0];
    const nowMs = Date.now();
    const runDate = getCurrentDateStrInTz(nowMs, slot.timezone || "Europe/Istanbul");
    return await executeSlot(slot, client, nowMs, force ? `${runDate}-${Date.now().toString(36)}` : runDate);
  });
  let outboxProcessed = 0;
  try {
    const { processTelegramOutboxOnce: processTelegramOutboxOnce2 } = await Promise.resolve().then(() => (init_telegram(), telegram_exports));
    const outboxRes = await processTelegramOutboxOnce2();
    outboxProcessed = outboxRes.processed;
  } catch (err) {
    console.error("[TRIGGER_SLOT_OUTBOX_ERROR]", err?.message || err);
  }
  return { ok: true, ...result, outboxProcessed };
}
export {
  SCHEDULE_29_DAYS,
  computeSlotTargetTime,
  get29DaySlotPlan,
  getCurrentDateStrInTz,
  processSchedulerSlotsOnce,
  triggerSlotRunDirectly
};
//# sourceMappingURL=scheduler.js.map
