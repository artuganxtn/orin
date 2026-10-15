import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const mode = process.argv[2] || 'render';

let outDir = 'firebase-dist';
const env = { ...process.env };

if (mode === 'spark') {
  outDir = 'firebase-spark-dist';
  env.VITE_FIREBASE_SPARK = 'true';
} else if (mode === 'security') {
  outDir = 'firebase-security-dist';
  env.VITE_FIREBASE_SPARK = 'true';
  env.VITE_ORIN_PROGRAM_API_URL = env.VITE_ORIN_PROGRAM_API_URL || 'https://firebase-functions-pc5h.onrender.com';
  env.VITE_ORIN_SECURITY_API_URL = env.VITE_ORIN_SECURITY_API_URL || 'https://firebase-functions-pc5h.onrender.com';
} else if (mode === 'render') {
  outDir = 'firebase-dist';
} else if (mode === 'server') {
  console.log('Building server in firebase-functions...');
  execSync('npm --prefix firebase-functions run build', { cwd: root, stdio: 'inherit', env });
  process.exit(0);
}

console.log(`Building full UI (${mode}) into ${outDir}...`);
execSync(`npx vite build --config firebase-app/vite.config.mts --outDir ../${outDir}`, {
  cwd: root,
  stdio: 'inherit',
  env
});
