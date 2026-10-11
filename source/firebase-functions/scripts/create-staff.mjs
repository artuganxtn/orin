// NOT RUN — requires DATABASE_URL set in environment pointing to the live database.
//
// Usage:
//   DATABASE_URL=<postgresql-url> node scripts/create-staff.mjs \
//     <UID1> <email1> "Staff Name 1" \
//     <UID2> <email2> "Staff Name 2"
//
// Staff 1 (maker):   roles = admin, finance, operations, kyc_reviewer
// Staff 2 (checker): roles = admin, finance_approver, operations, kyc_reviewer

import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

const ROLES_MAKER   = JSON.stringify(['admin', 'finance',          'operations', 'kyc_reviewer']);
const ROLES_CHECKER = JSON.stringify(['admin', 'finance_approver', 'operations', 'kyc_reviewer']);

const SQL_PROFILE = `+""+
  INSERT INTO profiles (id, email, display_name, role)
  VALUES (, , , 'admin')
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        role         = 'admin',
        updated_at   = NOW()`+""+;

const SQL_STAFF = `+""+
  INSERT INTO staff (user_id, roles, status, valid_after, created_at)
  VALUES (, ::jsonb, 'active', NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET roles       = EXCLUDED.roles,
        status      = 'active',
        valid_after = NOW()`+""+;

async function createStaff(uid, email, name, roles) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SQL_PROFILE, [uid, email, name]);
    await client.query(SQL_STAFF,   [uid, roles]);
    await client.query('COMMIT');
    console.log(`+""+[OK] Created staff:  <> roles=`+""+);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const args = process.argv.slice(2);
if (args.length < 6) {
  console.error('Usage: node create-staff.mjs UID1 email1 "Name 1" UID2 email2 "Name 2"');
  process.exit(1);
}
const [uid1, email1, name1, uid2, email2, name2] = args;
if (uid1 === uid2) {
  console.error('[ERROR] UID1 and UID2 must be different (two-person rule).');
  process.exit(1);
}
await createStaff(uid1, email1, name1, ROLES_MAKER);
await createStaff(uid2, email2, name2, ROLES_CHECKER);
const res = await pool.query(
  `+""+SELECT s.user_id, p.email, p.display_name, s.roles, s.status, s.valid_after, s.created_at
   FROM staff s JOIN profiles p ON s.user_id = p.id
   WHERE s.user_id = ANY() ORDER BY s.created_at`+""+,
  [[uid1, uid2]]
);
console.log('\nStaff rows written:');
console.table(res.rows);
await pool.end();
