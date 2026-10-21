// src/firebase-admin-init.ts
import { initializeApp, getApps, cert } from "firebase-admin/app";
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
  return initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "orin-99951" });
}
var adminApp = getAdminApp();
var realAdminAuth = getAuth(adminApp);
var adminAuth = new Proxy(realAdminAuth, {
  get(target, prop, receiver) {
    if (process.env.NODE_ENV === "test" && globalThis.__adminAuthMock?.[prop]) {
      return globalThis.__adminAuthMock[prop];
    }
    return Reflect.get(target, prop, receiver);
  }
});

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

// src/auth-middleware.ts
function reject(req, res, status, reason, body, code) {
  console.warn(JSON.stringify({ evt: "auth_reject", reason, status, method: req.method, path: req.path, ...code ? { code } : {} }));
  return res.status(status).json(body);
}
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reject(req, res, 401, "no_bearer", { error: "\u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629." });
  }
  const token = authHeader.slice(7);
  let uid;
  let email;
  let name = "\u0645\u0633\u062A\u062E\u062F\u0645 ORIN";
  let verified = true;
  let tokenIatMs = Date.now();
  try {
    if (process.env.NODE_ENV === "test" && token.startsWith("test-token-")) {
      const parts = token.split(":");
      uid = parts[0].replace("test-token-", "");
      email = parts[1] || `${uid}@orin.top`;
      name = parts[3] || uid;
      verified = parts[5] === "false" ? false : true;
      if (parts[4]) {
        tokenIatMs = Number(parts[4]);
      } else if (req.headers["x-test-token-iat"]) {
        tokenIatMs = Number(req.headers["x-test-token-iat"]);
      }
    } else {
      const decoded = await adminAuth.verifyIdToken(token, false);
      uid = decoded.uid;
      email = decoded.email || `${uid}@orin.top`;
      name = typeof decoded.name === "string" ? decoded.name : "\u0645\u0633\u062A\u062E\u062F\u0645 ORIN";
      verified = decoded.email_verified === true;
      tokenIatMs = (decoded.iat || decoded.auth_time || Math.floor(Date.now() / 1e3)) * 1e3;
    }
  } catch (err) {
    const code = String(err?.code || "unknown");
    if (code.startsWith("auth/")) {
      return reject(req, res, 401, code === "auth/id-token-expired" ? "token_expired" : "token_invalid", { error: "\u0627\u0646\u062A\u0647\u062A \u062C\u0644\u0633\u0629 \u0627\u0644\u062F\u062E\u0648\u0644. \u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u062C\u062F\u062F\u064B\u0627." }, code);
    }
    return reject(req, res, 503, "verify_unavailable", { error: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0645\u0624\u0642\u062A\u064B\u0627. \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.", code: "auth_backend_unavailable" }, code);
  }
  let role = "user";
  let isDisabled = false;
  let isBlocked = false;
  let blockReason = "";
  let validAfterMs = 0;
  let profileEmailVerified = false;
  try {
    await withTx(async (client) => {
      await client.query(
        `INSERT INTO profiles (id, email, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
        [uid, email, name]
      );
      const accRes = await client.query(
        "SELECT id FROM accounts WHERE user_id = $1 AND type = 'real'",
        [uid]
      );
      if (accRes.rowCount === 0) {
        const accId = `acc-${uid.slice(0, 16)}`;
        const accNum = `${Math.floor(1e11 + Math.random() * 899999999999)}`;
        await client.query(
          `INSERT INTO accounts (id, user_id, account_number, type, currency, status)
           VALUES ($1, $2, $3, 'real', 'USD', 'active')
           ON CONFLICT DO NOTHING`,
          [accId, uid, accNum]
        );
      }
      const queryRes = await client.query(
        `SELECT
           p.role AS profile_role,
           p.disabled AS profile_disabled,
           s.roles AS staff_roles,
           s.status AS staff_status,
           a.status AS access_status,
           a.reason AS access_reason,
           (SELECT MAX(valid_after) FROM session_revocations WHERE user_id = p.id) AS valid_after
         FROM profiles p
         LEFT JOIN staff s ON p.id = s.user_id
         LEFT JOIN access_status a ON p.id = a.user_id
         WHERE p.id = $1`,
        [uid]
      );
      profileEmailVerified = true;
      try {
        await client.query("SAVEPOINT sp_ev");
        const evCheck = await client.query(`SELECT email_verified FROM profiles WHERE id = $1`, [uid]);
        if (evCheck.rowCount && evCheck.rows[0].email_verified !== void 0) {
          profileEmailVerified = evCheck.rows[0].email_verified === true;
        }
        await client.query("RELEASE SAVEPOINT sp_ev");
      } catch (evErr) {
        await client.query("ROLLBACK TO SAVEPOINT sp_ev").catch(() => {
        });
        if (evErr?.code !== "42703") throw evErr;
        profileEmailVerified = true;
      }
      if (queryRes.rowCount && queryRes.rowCount > 0) {
        const row = queryRes.rows[0];
        isDisabled = row.profile_disabled === true;
        if (row.access_status && row.access_status !== "active") {
          isBlocked = true;
          blockReason = row.access_reason || "\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u062D\u0638\u0648\u0631.";
        }
        const ADMIN_EMAILS = ["khtaub7341@gmail.com", "khtaub99@gmail.com", "mm@mm.mm"];
        const isOwner = ADMIN_EMAILS.some((a) => a.toLowerCase() === email.toLowerCase().trim());
        if (isOwner) {
          await client.query("UPDATE profiles SET role = 'admin' WHERE id = $1", [uid]);
          await client.query(
            `INSERT INTO staff (user_id, roles, status, valid_after, created_at)
             VALUES ($1, '["super_admin"]'::jsonb, 'active', NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE SET roles = '["super_admin"]'::jsonb, status = 'active'`,
            [uid]
          );
        }
        const isProfileAdmin = row.profile_role === "admin" || isOwner;
        const isStaffAdmin = row.staff_status === "active" && Array.isArray(row.staff_roles) && row.staff_roles.includes("admin");
        role = isProfileAdmin || isStaffAdmin || isOwner ? "admin" : "user";
        if (row.valid_after) {
          validAfterMs = new Date(row.valid_after).getTime();
        }
      }
    });
  } catch (err) {
    return reject(req, res, 503, "db_error", { error: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0645\u0624\u0642\u062A\u064B\u0627. \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.", code: "auth_backend_unavailable" }, String(err?.code || "unknown"));
  }
  if (isDisabled) {
    return reject(req, res, 403, "account_disabled", { error: "\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0648\u0642\u0648\u0641." });
  }
  if (isBlocked) {
    return reject(req, res, 403, "access_blocked", { error: blockReason });
  }
  const tokenIatSec = Math.floor(tokenIatMs / 1e3);
  const validAfterSec = Math.floor(validAfterMs / 1e3);
  if (validAfterSec > 0 && tokenIatSec < validAfterSec) {
    return reject(req, res, 401, "session_revoked", { error: "\u0627\u0646\u062A\u0647\u062A \u0627\u0644\u062C\u0644\u0633\u0629. \u0623\u0639\u062F \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644." });
  }
  const isExemptPath = req.path.startsWith("/security/logout") || req.path.startsWith("/identity/") || req.path.startsWith("/email/unsubscribe");
  if (!verified && !profileEmailVerified && !isExemptPath) {
    return reject(req, res, 403, "email_unverified", {
      error: "\u064A\u0631\u062C\u0649 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A \u0623\u0648\u0644\u0627\u064B. / Email verification required.",
      code: "email_unverified"
    });
  }
  req.user = { id: uid, email, name, verified, role };
  next();
}
export {
  authMiddleware
};
//# sourceMappingURL=auth-middleware.js.map
