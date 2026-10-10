import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const target = process.argv[2] || 'security';

const envMap = {
  security: {
    VITE_FIREBASE_SPARK: 'true',
    VITE_ORIN_PROGRAM_API_URL: process.env.VITE_ORIN_PROGRAM_API_URL || (process.env.RENDER_BACKEND_URL || 'https://firebase-functions-pc5h.onrender.com') + '/orinApi',
    VITE_ORIN_SECURITY_API_URL: process.env.VITE_ORIN_SECURITY_API_URL || (process.env.RENDER_BACKEND_URL || 'https://firebase-functions-pc5h.onrender.com') + '/orinSecurity',
    VITE_ORIN_PAYMENTS_API_URL: process.env.VITE_ORIN_PAYMENTS_API_URL || (process.env.RENDER_BACKEND_URL || 'https://firebase-functions-pc5h.onrender.com') + '/orinPayments',
    VITE_ORIN_IDENTITY_API_URL: process.env.VITE_ORIN_IDENTITY_API_URL || (process.env.RENDER_BACKEND_URL || 'https://firebase-functions-pc5h.onrender.com') + '/orinIdentity',
    outDir: '../firebase-security-dist'
  },
  control: {
    VITE_FIREBASE_SPARK: 'true',
    VITE_ORIN_PROGRAM_API_URL: 'https://europe-west1-orin-99951.cloudfunctions.net/orinApi',
    VITE_ORIN_SECURITY_API_URL: 'https://europe-west1-orin-99951.cloudfunctions.net/orinSecurity',
    VITE_ORIN_PAYMENTS_API_URL: 'https://europe-west1-orin-99951.cloudfunctions.net/orinPayments',
    VITE_ORIN_IDENTITY_API_URL: 'https://europe-west1-orin-99951.cloudfunctions.net/orinIdentity',
    outDir: '../firebase-control-dist'
  },
  spark: {
    VITE_FIREBASE_SPARK: 'true',
    outDir: '../firebase-spark-dist'
  },
  render: {
    VITE_FIREBASE_SPARK: 'true',
    VITE_ORIN_PROGRAM_API_URL: (process.env.RENDER_BACKEND_URL || 'https://firebase-functions-pc5h.onrender.com') + '/orinApi',
    VITE_ORIN_SECURITY_API_URL: (process.env.RENDER_BACKEND_URL || 'https://firebase-functions-pc5h.onrender.com') + '/orinSecurity',
    VITE_ORIN_PAYMENTS_API_URL: (process.env.RENDER_BACKEND_URL || 'https://firebase-functions-pc5h.onrender.com') + '/orinPayments',
    VITE_ORIN_IDENTITY_API_URL: (process.env.RENDER_BACKEND_URL || 'https://firebase-functions-pc5h.onrender.com') + '/orinIdentity',
    outDir: '../firebase-security-dist'
  },
  original: {
    outDir: '../firebase-app-dist'
  }
};

const config = envMap[target] || envMap.security;

const env = {
  ...process.env,
  ...(config.VITE_FIREBASE_SPARK ? { VITE_FIREBASE_SPARK: config.VITE_FIREBASE_SPARK } : {}),
  ...(config.VITE_ORIN_PROGRAM_API_URL ? { VITE_ORIN_PROGRAM_API_URL: config.VITE_ORIN_PROGRAM_API_URL } : {}),
  ...(config.VITE_ORIN_SECURITY_API_URL ? { VITE_ORIN_SECURITY_API_URL: config.VITE_ORIN_SECURITY_API_URL } : {}),
  ...(config.VITE_ORIN_PAYMENTS_API_URL ? { VITE_ORIN_PAYMENTS_API_URL: config.VITE_ORIN_PAYMENTS_API_URL } : {}),
  ...(config.VITE_ORIN_IDENTITY_API_URL ? { VITE_ORIN_IDENTITY_API_URL: config.VITE_ORIN_IDENTITY_API_URL } : {})
};

const root = resolve(import.meta.dirname, '..');
const viteCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['vite', 'build', '--config', 'firebase-app/vite.config.mts', '--outDir', config.outDir];

console.log(`[build-dist] Building target: ${target} -> ${config.outDir}`);
const res = spawnSync(viteCmd, args, { cwd: root, env, stdio: 'inherit', shell: true });

if (res.error) {
  console.error('[build-dist] Error spawning build:', res.error);
  process.exit(1);
}

process.exit(res.status ?? 0);
