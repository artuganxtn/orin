import { existsSync } from 'node:fs';
import { runMigrations } from './src/migrate.ts';

const ownerUrl = process.env.OWNER_DATABASE_URL;
if (!ownerUrl) {
  throw new Error('OWNER_DATABASE_URL environment variable is required');
}

const appPassword = process.env.ORIN_APP_PASSWORD;
if (!appPassword) {
  throw new Error('ORIN_APP_PASSWORD environment variable is required');
}

const migrationsDir = existsSync('./migrations') ? './migrations' : '../migrations';

await runMigrations(ownerUrl, migrationsDir);
