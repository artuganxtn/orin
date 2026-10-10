import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import process from 'node:process';
import fs from 'node:fs';

const envFile = '.env';
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const app = getApps()[0] ?? initializeApp({ credential: cert(sa) });
const db = getFirestore(app);

async function check() {
  const errors = await db.collection('orinSupportErrors').orderBy('createdAt', 'desc').limit(5).get();
  errors.forEach(e => console.log('ERROR LOG:', e.id, JSON.stringify(e.data())));
}

check().catch(console.error);
