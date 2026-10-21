// src/kyc.ts
import { randomUUID, createHmac, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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

// src/program-ingestion.ts
import { createHash } from "node:crypto";
var ApiError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var hash = (text) => createHash("sha256").update(text).digest("hex");
var key = (s) => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(s)) throw new ApiError("Invalid trusted event id");
  return s;
};
async function recordVerifiedCustomer(uid, customerKey, eventId, idNumberLast4) {
  key(uid);
  key(eventId);
  if (!/^[a-f0-9]{64}$/.test(customerKey)) throw new ApiError("Use an irreversible provider customer fingerprint");
  return withTx(async (client) => {
    const fingerprint = hash(JSON.stringify({ uid, customerKey }));
    const evRes = await client.query("SELECT fingerprint FROM trusted_events WHERE event_id = $1", [eventId]);
    if (evRes.rows.length > 0) {
      if (evRes.rows[0].fingerprint !== fingerprint) throw new ApiError("Event conflict", 409);
      return;
    }
    const regRes = await client.query("SELECT user_id FROM customer_registry WHERE customer_key = $1", [customerKey]);
    if (regRes.rows.length > 0 && regRes.rows[0].user_id !== uid) {
      throw new ApiError("Duplicate customer", 409);
    }
    const vcRes = await client.query("SELECT customer_key FROM verified_customers WHERE user_id = $1", [uid]);
    if (vcRes.rows.length > 0 && vcRes.rows[0].customer_key !== customerKey) {
      throw new ApiError("Verification identity changed; review required", 409);
    }
    await client.query(
      `INSERT INTO customer_registry (customer_key, user_id)
       VALUES ($1, $2)
       ON CONFLICT (customer_key) DO NOTHING`,
      [customerKey, uid]
    );
    const last4 = idNumberLast4 ?? customerKey.slice(-4);
    await client.query(
      `INSERT INTO verified_customers (user_id, customer_key, id_number_last4, verified, revoked, event_id)
       VALUES ($1, $2, $3, true, false, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         customer_key = EXCLUDED.customer_key,
         id_number_last4 = EXCLUDED.id_number_last4,
         verified = true,
         revoked = false,
         event_id = EXCLUDED.event_id`,
      [uid, customerKey, last4, eventId]
    );
    const mRes = await client.query("SELECT badges FROM program_members WHERE user_id = $1", [uid]);
    if (mRes.rows.length > 0) {
      const currentBadges = Array.isArray(mRes.rows[0].badges) ? mRes.rows[0].badges : JSON.parse(mRes.rows[0].badges || "[]");
      if (!currentBadges.includes("verified")) {
        currentBadges.push("verified");
        await client.query(
          "UPDATE program_members SET badges = $1::jsonb WHERE user_id = $2",
          [JSON.stringify(currentBadges), uid]
        );
      }
    }
    await client.query(
      `INSERT INTO trusted_events (event_id, user_id, type, fingerprint, status)
       VALUES ($1, $2, 'verification', $3, 'confirmed')
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, uid, fingerprint]
    );
    const payload = JSON.stringify({ eventId });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ('provider', 'CUSTOMER_VERIFIED', $1, $2::jsonb, $3)
       ON CONFLICT (action, reference) DO NOTHING`,
      [uid, payload, hash(payload)]
    );
  });
}

// src/kyc.ts
var KycError = class extends Error {
  constructor(message, status = 400, code = "kyc_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
};
async function requireVerifiedKyc(user, client) {
  const res = await client.query(
    "SELECT verified, revoked FROM verified_customers WHERE user_id = $1",
    [user.id]
  );
  if (!res.rowCount || !res.rows[0].verified || res.rows[0].revoked) {
    throw new KycError("\u062A\u0648\u062B\u064A\u0642 \u0627\u0644\u0647\u0648\u064A\u0629 (KYC) \u0645\u0637\u0644\u0648\u0628 \u0644\u0625\u062A\u0645\u0627\u0645 \u0647\u0630\u0647 \u0627\u0644\u0639\u0645\u0644\u064A\u0629. / Identity verification (KYC) is required for this action.", 403, "kyc_required");
  }
}
function getKycFilesKey() {
  const raw = process.env.KYC_FILES_KEY || "orin-kyc-files-key-32-bytes-2026!";
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const buf = Buffer.alloc(32);
  Buffer.from(raw, "utf8").copy(buf);
  return buf;
}
function computeCustomerKey(country, documentType, idNumber) {
  const normCountry = String(country ?? "").trim().toUpperCase();
  const normType = String(documentType ?? "").trim().toLowerCase();
  const normIdNumber = String(idNumber ?? "").replace(/[\s\-\.]+/g, "").toUpperCase();
  if (!normCountry || !normType || !normIdNumber) {
    throw new KycError("Missing or incomplete KYC fields (country, documentType, idNumber) for customerKey generation", 400);
  }
  const secret = process.env.KYC_HMAC_SECRET;
  if (!secret) {
    throw new KycError("KYC_HMAC_SECRET configuration required", 500);
  }
  return createHmac("sha256", secret).update(`${normCountry}:${normType}:${normIdNumber}`).digest("hex");
}
function idLast4(idNumber) {
  const normIdNumber = String(idNumber ?? "").replace(/[\s\-\.]+/g, "").toUpperCase();
  return normIdNumber.slice(-4);
}
function encryptAesGcm(plainText, keyBuffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return {
    encrypted,
    iv: iv.toString("hex"),
    tag
  };
}
async function submitKyc(user, input) {
  const country = String(input.country || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new KycError("\u0631\u0645\u0632 \u0627\u0644\u062F\u0648\u0644\u0629 \u064A\u062C\u0628 \u0623\u0646 \u064A\u062A\u0643\u0648\u0646 \u0645\u0646 \u062D\u0631\u0641\u064A\u0646 (ISO-2).", 400);
  }
  const documentType = String(input.documentType || "").trim().toLowerCase();
  if (!["passport", "id_card", "driver_license"].includes(documentType)) {
    throw new KycError("\u0646\u0648\u0639 \u0627\u0644\u0648\u062B\u064A\u0642\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.", 400);
  }
  const idNumber = String(input.idNumber || "").trim();
  if (!idNumber || idNumber.length < 4 || idNumber.length > 50) {
    throw new KycError("\u0631\u0642\u0645 \u0627\u0644\u0647\u0648\u064A\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.", 400);
  }
  const customerKey = computeCustomerKey(country, documentType, idNumber);
  const last4 = idLast4(idNumber);
  const encKey = getKycFilesKey();
  const fullNameStr = (input.fullName || "").trim() || "User";
  const encName = encryptAesGcm(fullNameStr, encKey);
  const encId = encryptAesGcm(idNumber, encKey);
  const docImage = input.documentImage || "placeholder_document_data";
  const encImage = encryptAesGcm(docImage, encKey);
  const kycReqId = "kyc-req-" + randomUUID();
  const kycFileId = "kyc-file-" + randomUUID();
  return await withTx(async (client) => {
    const verifiedCheck = await client.query("SELECT verified, revoked FROM verified_customers WHERE user_id = $1", [user.id]);
    if (verifiedCheck.rowCount && verifiedCheck.rows[0].verified && !verifiedCheck.rows[0].revoked) {
      throw new KycError("\u062A\u0645 \u062A\u0648\u062B\u064A\u0642 \u062D\u0633\u0627\u0628\u0643 \u0628\u0646\u062C\u0627\u062D \u0645\u0633\u0628\u0642\u064B\u0627. / Your identity is already verified.", 409, "already_verified");
    }
    const pendingCheck = await client.query("SELECT status FROM kyc_files WHERE user_id = $1 AND status IN ('review', 'pending')", [user.id]);
    if (pendingCheck.rowCount > 0) {
      throw new KycError("\u0637\u0644\u0628 \u062A\u0648\u062B\u064A\u0642 \u0627\u0644\u0647\u0648\u064A\u0629 \u0627\u0644\u062E\u0627\u0635 \u0628\u0643 \u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u062D\u0627\u0644\u064A\u064B\u0627. / Your KYC verification request is currently under review.", 409, "kyc_pending");
    }
    const existing = await client.query("SELECT user_id FROM customer_registry WHERE customer_key = $1", [customerKey]);
    if (existing.rowCount && existing.rows[0].user_id !== user.id) {
      throw new KycError("\u0648\u062B\u064A\u0642\u0629 \u0627\u0644\u0647\u0648\u064A\u0629 \u0647\u0630\u0647 \u0645\u0633\u062C\u0644\u0629 \u0628\u0627\u0644\u0641\u0639\u0644 \u0644\u062D\u0633\u0627\u0628 \u0622\u062E\u0631. / This ID document is already registered to another account.", 409, "duplicate_document");
    }
    await client.query(
      `INSERT INTO customer_registry (customer_key, user_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET customer_key = EXCLUDED.customer_key`,
      [customerKey, user.id]
    );
    await client.query(
      `INSERT INTO kyc_requests (id, user_id, customer_key, status, reason)
       VALUES ($1, $2, $3, 'pending', 'User KYC verification request')
       ON CONFLICT (id) DO NOTHING`,
      [kycReqId, user.id, customerKey]
    );
    await client.query(`
      ALTER TABLE kyc_files
        ADD COLUMN IF NOT EXISTS full_name_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS full_name_iv TEXT,
        ADD COLUMN IF NOT EXISTS full_name_tag TEXT
    `).catch(() => {
    });
    await client.query(
      `INSERT INTO kyc_files (
         id, user_id, country, document_type,
         id_number_encrypted, id_number_iv, id_number_tag,
         document_image_encrypted, document_image_iv, document_image_tag,
         full_name_encrypted, full_name_iv, full_name_tag,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'review')`,
      [
        kycFileId,
        user.id,
        country,
        documentType,
        encId.encrypted,
        encId.iv,
        encId.tag,
        encImage.encrypted,
        encImage.iv,
        encImage.tag,
        encName.encrypted,
        encName.iv,
        encName.tag
      ]
    );
    if (input.fullName && input.fullName.trim()) {
      await client.query(
        `UPDATE profiles SET display_name = $1, updated_at = NOW() WHERE id = $2`,
        [input.fullName.trim(), user.id]
      );
    }
    return {
      ok: true,
      requestId: kycReqId,
      status: "pending",
      idNumberLast4: last4,
      customerKey
    };
  });
}
async function getKycStatus(user) {
  return await withTx(async (client) => {
    const vRes = await client.query(
      "SELECT customer_key, id_number_last4, verified, revoked FROM verified_customers WHERE user_id = $1",
      [user.id]
    );
    if (vRes.rowCount && vRes.rows[0].verified && !vRes.rows[0].revoked) {
      const pRes = await client.query("SELECT display_name FROM profiles WHERE id = $1", [user.id]);
      const kycFileRes = await client.query("SELECT country, document_type FROM kyc_files WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [user.id]);
      const kycFile = kycFileRes.rows[0];
      return {
        exists: true,
        status: "verified",
        verified: true,
        idNumberLast4: vRes.rows[0].id_number_last4,
        customerKey: vRes.rows[0].customer_key,
        request: {
          fullName: pRes.rows[0]?.display_name || "Verified User",
          documentType: kycFile?.document_type || "passport",
          idNumber: `\u2022\u2022\u2022\u2022 ${vRes.rows[0].id_number_last4}`,
          country: kycFile?.country || "US",
          status: "verified"
        }
      };
    }
    const fileRes = await client.query(
      "SELECT id, country, document_type, status, created_at, updated_at FROM kyc_files WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [user.id]
    );
    if (fileRes.rowCount) {
      const row = fileRes.rows[0];
      const statusMap = { pending: "pending", review: "pending", approved: "verified", verified: "verified", rejected: "rejected" };
      const mappedStatus = statusMap[row.status] || "pending";
      const pRes = await client.query("SELECT display_name FROM profiles WHERE id = $1", [user.id]);
      return {
        exists: true,
        status: mappedStatus,
        verified: mappedStatus === "verified",
        request: {
          fullName: pRes.rows[0]?.display_name || "User",
          documentType: row.document_type || "passport",
          idNumber: "\u2022\u2022\u2022\u2022",
          country: row.country || "US",
          status: mappedStatus,
          createdAt: new Date(row.created_at).getTime(),
          updatedAt: new Date(row.updated_at).getTime()
        }
      };
    }
    return {
      exists: false,
      status: "unverified",
      verified: false
    };
  });
}
async function verifyKycCustomer(admin, input) {
  const target = input.userId;
  return await withTx(async (client) => {
    let customerKey = input.customerKey;
    let last4 = "0000";
    if (!customerKey) {
      if (input.country && input.documentType && input.idNumber) {
        customerKey = computeCustomerKey(input.country, input.documentType, input.idNumber);
        last4 = idLast4(input.idNumber);
      } else {
        const kycReq = await client.query(
          "SELECT customer_key FROM kyc_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
          [target]
        );
        if (kycReq.rowCount === 0) {
          throw new KycError("\u0637\u0644\u0628 \u0627\u0644\u0647\u0648\u064A\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0644\u0644\u0645\u0633\u062A\u062E\u062F\u0645.", 404);
        }
        customerKey = kycReq.rows[0].customer_key;
      }
    }
    const eventId = "kyc-admin-" + randomUUID();
    await recordVerifiedCustomer(target, customerKey, eventId, last4);
    await client.query(
      `UPDATE kyc_requests
       SET status = 'approved', reviewer_id = $1, reviewed_at = NOW()
       WHERE user_id = $2 AND status = 'pending'`,
      [admin.id, target]
    );
    await client.query(
      `UPDATE kyc_files
       SET status = 'verified', updated_at = NOW()
       WHERE user_id = $1 AND status = 'review'`,
      [target]
    );
    return {
      ok: true,
      verified: true,
      userId: target,
      customerKey,
      idNumberLast4: last4
    };
  });
}
async function listKycFiles(_staff) {
  return await withTx(async (client) => {
    const res = await client.query(
      `SELECT id, user_id, country, document_type, status, created_at, updated_at
       FROM kyc_files ORDER BY created_at DESC LIMIT 100`
    );
    const files = res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      country: r.country,
      documentType: r.document_type,
      status: r.status,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime()
    }));
    return { files };
  });
}
function decryptAesGcm(encryptedHex, ivHex, tagHex, keyBuffer) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyBuffer, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    throw new KycError("Decryption failed for document data", 500);
  }
}
async function readKycFile(staff, fileId, reason) {
  if (!reason || reason.trim().length < 5) {
    throw new KycError("\u0633\u0628\u0628 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0648\u062B\u064A\u0642\u0629 \u0627\u0644\u0647\u0648\u064A\u0629 \u0645\u0637\u0644\u0648\u0628 \u0628\u062D\u062F \u0623\u062F\u0646\u0649 5 \u0623\u062D\u0631\u0641.", 400);
  }
  return await withTx(async (client) => {
    const res = await client.query(
      `SELECT k.id, k.user_id, k.country, k.document_type, k.status, k.created_at, k.updated_at,
              k.id_number_encrypted, k.id_number_iv, k.id_number_tag,
              k.document_image_encrypted, k.document_image_iv, k.document_image_tag,
              k.full_name_encrypted, k.full_name_iv, k.full_name_tag,
              p.display_name AS full_name, p.email
       FROM kyc_files k
       LEFT JOIN profiles p ON k.user_id = p.id
       WHERE k.id = $1 OR k.user_id = $1`,
      [fileId]
    );
    if (res.rowCount === 0) {
      throw new KycError("\u0645\u0644\u0641 \u0627\u0644\u0647\u0648\u064A\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.", 404);
    }
    const row = res.rows[0];
    const encKey = getKycFilesKey();
    let idNumber = "\u2022\u2022\u2022\u2022";
    let fullName = row.full_name || "User";
    let documentImage = null;
    if (row.full_name_encrypted && row.full_name_iv && row.full_name_tag) {
      fullName = decryptAesGcm(row.full_name_encrypted, row.full_name_iv, row.full_name_tag, encKey);
    }
    if (row.id_number_encrypted && row.id_number_iv && row.id_number_tag) {
      idNumber = decryptAesGcm(row.id_number_encrypted, row.id_number_iv, row.id_number_tag, encKey);
    }
    if (row.document_image_encrypted && row.document_image_iv && row.document_image_tag) {
      documentImage = decryptAesGcm(row.document_image_encrypted, row.document_image_iv, row.document_image_tag, encKey);
    }
    await client.query(
      `INSERT INTO kyc_access_log (staff_id, kyc_file_id, action, reason)
       VALUES ($1, $2, 'read_detail', $3)`,
      [staff.id, row.id, reason.trim()]
    );
    return {
      id: row.id,
      userId: row.user_id,
      fullName,
      email: row.email || "",
      country: row.country,
      documentType: row.document_type,
      idNumber,
      documentImage,
      status: row.status,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      accessLogged: true
    };
  });
}
export {
  KycError,
  computeCustomerKey,
  decryptAesGcm,
  getKycFilesKey,
  getKycStatus,
  idLast4,
  listKycFiles,
  readKycFile,
  requireVerifiedKyc,
  submitKyc,
  verifyKycCustomer
};
//# sourceMappingURL=kyc.js.map
