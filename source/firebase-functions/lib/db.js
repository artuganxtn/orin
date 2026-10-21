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
function getPool() {
  return pool;
}
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
export {
  getPool,
  pool,
  withTx
};
//# sourceMappingURL=db.js.map
