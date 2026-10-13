import { app, validateProductionEnv } from './lib/index.js';
import path from 'node:path';
import fs from 'node:fs';

// Automatically load .env if available
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch {
  // Ignore if .env is missing
}

// Fail startup if required environment variables are missing in production
validateProductionEnv();

// Run all migrations to keep production schema up-to-date
if (process.env.DATABASE_URL) {
  try {
    const { runMigrations } = await import('./lib/migrate.js');
    const candidates = [
      path.resolve(process.cwd(), '../migrations'),
      path.resolve(process.cwd(), 'migrations'),
      path.resolve(process.cwd(), 'source/migrations'),
      path.resolve(import.meta.dirname, '../migrations')
    ];
    const migDir = candidates.find(p => fs.existsSync(p));
    if (migDir) {
      console.log(`[ORIN Server] Running migrations from ${migDir}...`);
      await runMigrations(process.env.DATABASE_URL, migDir);
      console.log('[ORIN Server] Migrations verified and applied.');
    } else {
      console.warn('[ORIN Server] Warning: migrations directory not found in candidates:', candidates);
    }
  } catch (migErr) {
    console.error('[ORIN Server] Migration error on startup:', migErr?.message || migErr);
  }
}

const port = Number(process.env.PORT) || 10000;

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[ORIN Server] Express backend running at http://0.0.0.0:${port}`);
  console.log(`[ORIN Server] Ready for production traffic, webhooks, and ledger operations.`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

export default server;
