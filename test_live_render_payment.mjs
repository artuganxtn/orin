import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';

const envContent = fs.readFileSync('source/firebase-functions/.env', 'utf-8');
const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT=(.*)/);
const sa = JSON.parse(match[1]);
const app = initializeApp({ credential: cert(sa) });
const auth = getAuth(app);

async function run() {
  const uid = '3TUR4cCDJBSYi7aQFZBOG9TLc7x2';
  const customToken = await auth.createCustomToken(uid);
  
  // Read web config
  const webConfig = JSON.parse(fs.readFileSync('source/public/firebase-config.json', 'utf-8').catch?.(() => '{}') || fs.readFileSync('source/firebase-app/firebase-config.json', 'utf-8'));
  const apiKey = webConfig.apiKey;
  console.log('Firebase Web API Key:', apiKey);

  const signRes = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const signData = await signRes.json();
  const idToken = signData.idToken;
  console.log('Got ID Token. Length:', idToken ? idToken.length : 'none');

  // Test readiness
  const readRes = await fetch('https://firebase-functions-pc5h.onrender.com/orinPayments/api/payments/readiness', {
    headers: { 'Authorization': 'Bearer ' + idToken }
  });
  console.log('Readiness status:', readRes.status, await readRes.text());

  // Test create deposit
  const depRes = await fetch('https://firebase-functions-pc5h.onrender.com/orinPayments/api/payments/deposits', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: '90952ffb-ad8f-4015-8c6f-cd4bf71fdb76',
      amountCents: 100000,
      coin: 'usdttrc20',
      requestId: 'test-req-' + Date.now()
    })
  });
  console.log('Deposit status:', depRes.status, await depRes.text());
}
run().catch(console.error);
