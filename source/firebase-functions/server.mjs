import { app, validateProductionEnv } from './lib/index.js';

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

const port = Number(process.env.PORT) || 10000;

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[ORIN Server] Express backend running at http://0.0.0.0:${port}`);
  console.log(`[ORIN Server] Ready for production traffic, webhooks, and ledger operations.`);
});


server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

export default server;
