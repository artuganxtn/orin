import pg from 'pg';
const pool = new pg.Pool({
  connectionString: process.env.OWNER_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const res = await pool.query(`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_name IN ('program_members', 'referral_rewards', 'bonus_wallets', 'deposits', 'payment_reviews')
  ORDER BY table_name, ordinal_position;
`);
console.table(res.rows);
await pool.end();
