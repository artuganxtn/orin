import pg from 'pg';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { Pool } = pg;

export async function runMigrations(connectionString: string, migrationsDir: string) {
  const appPassword = process.env.ORIN_APP_PASSWORD || process.env.ORIN_SECURITY_MASTER_KEY || 'orin_app_secure_default_pass_2026';

  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  try {
    // 1. Set app.orin_app_password session variable
    await client.query(`SELECT set_config('app.orin_app_password', $1, false)`, [appPassword]);

    // 2. Create schema_migrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Read migration files
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => parseInt(a.split('_')[0], 10) - parseInt(b.split('_')[0], 10));

    const appliedRes = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(appliedRes.rows.map((r: any) => r.version));

    let appliedCount = 0;
    for (const file of files) {
      const version = parseInt(file.split('_')[0], 10);
      if (appliedSet.has(version)) {
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      console.log(`Applying migration ${file}...`);
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.orin_app_password', $1, true)`, [appPassword]);
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW())',
        [version, file]
      );
      await client.query('COMMIT');
      appliedCount++;
      console.log(`Migration ${file} applied successfully.`);
    }

    console.log(`Migration runner complete. Applied: ${appliedCount} migrations.`);

    // 4. Verify role orin_app exists
    const roleRes = await client.query("SELECT rolname FROM pg_roles WHERE rolname = 'orin_app'");
    if (roleRes.rows.length === 0) {
      throw new Error("Post-migration check failed: role 'orin_app' does not exist");
    }
  } finally {
    client.release();
    await pool.end();
  }
}
