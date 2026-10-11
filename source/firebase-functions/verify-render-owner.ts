import pg from 'pg';

const ownerUrl = process.env.OWNER_DATABASE_URL;
if (!ownerUrl) throw new Error('OWNER_DATABASE_URL required');

const pool = new pg.Pool({
  connectionString: ownerUrl,
  ssl: { rejectUnauthorized: false }
});

const client = await pool.connect();

try {
  console.log('--- 1. TABLES IN SCHEMA public ---');
  const tablesRes = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  console.table(tablesRes.rows);

  console.log('\n--- 2. TRIGGERS ON accounts AND journal_entries ---');
  const triggersRes = await client.query(`
    SELECT event_object_table AS table_name, trigger_name, event_manipulation AS event, action_timing AS timing
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table IN ('accounts', 'journal_entries')
    ORDER BY event_object_table, trigger_name;
  `);
  console.table(triggersRes.rows);

  console.log('\n--- 3. ROLE orin_app CHECK ---');
  const roleRes = await client.query(`
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin
    FROM pg_roles
    WHERE rolname = 'orin_app';
  `);
  console.table(roleRes.rows);

  console.log('\n--- 4. orin_app PRIVILEGES ---');
  const privRes = await client.query(`
    SELECT
      has_column_privilege('orin_app', 'accounts', 'balance_cents', 'UPDATE') AS accounts_balance_cents_update,
      has_column_privilege('orin_app', 'accounts', 'reserved_cents', 'UPDATE') AS accounts_reserved_cents_update,
      has_table_privilege('orin_app', 'journal_entries', 'DELETE') AS journal_entries_delete,
      has_table_privilege('orin_app', 'journal_entries', 'UPDATE') AS journal_entries_update,
      has_table_privilege('orin_app', 'journals', 'DELETE') AS journals_delete,
      has_table_privilege('orin_app', 'audit', 'DELETE') AS audit_delete;
  `);
  console.table(privRes.rows);

} finally {
  client.release();
  await pool.end();
}
