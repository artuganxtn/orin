// src/db.ts
import pg from "pg";
var { Pool } = pg;
var connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}
if (!connectionString.includes("client_encoding")) {
  connectionString += (connectionString.includes("?") ? "&" : "?") + "client_encoding=UTF8";
}
var isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
var pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 8
});
pool.on("error", (err, _client) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});
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

// src/telegram.ts
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
var DEFAULT_TELEGRAM_BOT_TOKEN = "8435789146:AAGDwXQ3NcBf0CMdsAo0ZeL4Pn28RyS_4sM";
var DEFAULT_TELEGRAM_CHANNEL_ID = "-1003753942964";
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
export {
  DEFAULT_TELEGRAM_BOT_TOKEN,
  DEFAULT_TELEGRAM_CHANNEL_ID,
  escapeHtml,
  formatTurkeyTime,
  getTelegramBotToken,
  getTelegramChannelId,
  processTelegramOutboxOnce,
  renderMessageTemplate,
  sendTelegramApiRequest
};
//# sourceMappingURL=telegram.js.map
