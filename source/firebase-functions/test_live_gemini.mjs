import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import process from 'node:process';
import fs from 'node:fs';

const envFile = '.env';
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!saJson) {
  console.error("FIREBASE_SERVICE_ACCOUNT not found in environment");
  process.exit(1);
}

const sa = JSON.parse(saJson);
const app = getApps()[0] ?? initializeApp({ credential: cert(sa) });
const auth = getAuth(app);

async function testGemini() {
  const email = 'test-gemini-live@orin.internal';
  const password = 'Password123!Secure';
  const apiKey = 'AIzaSyAGi8Ky9SrzrQEzJdIgXSe8G36J_OarSQA';
  const renderBase = 'https://firebase-functions-pc5h.onrender.com';

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    await auth.updateUser(userRecord.uid, { password });
  } catch {
    userRecord = await auth.createUser({ email, password, emailVerified: true });
  }

  const { getFirestore } = await import('firebase-admin/firestore');
  const firestore = getFirestore();
  await firestore.collection('users').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email: userRecord.email,
    displayName: 'Gemini Tester',
    role: 'user',
    disabled: false
  }, { merge: true });

  console.log("Signing in with password to get authentic primary ID token...");
  const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const authData = await authRes.json();
  const primaryIdToken = authData.idToken;
  console.log("Primary password token acquired:", !!primaryIdToken);

  console.log("Calling Render Live /api/security/login...");
  const loginRes = await fetch(`${renderBase}/api/security/login`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + primaryIdToken,
      'Content-Type': 'application/json',
      'Origin': 'https://orin-99951.web.app'
    },
    body: JSON.stringify({
      device: { platform: 'Web', appVersion: '1.6.2', label: 'Live Test' }
    })
  });

  console.log("Security Login Status:", loginRes.status);
  const bundle = await loginRes.json();
  console.log("Security Bundle:", bundle);

  if (!bundle.customToken) {
    console.error("Failed to acquire session bundle from Render security service");
    return;
  }

  // Sign in with the session custom token
  const sessionAuthRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: bundle.customToken, returnSecureToken: true })
  });
  const sessionData = await sessionAuthRes.json();
  const sessionIdToken = sessionData.idToken;
  console.log("Session ID Token acquired:", !!sessionIdToken);

  console.log("\nCalling Render Live /orinApi/api/support/assistant capability...");
  const capRes = await fetch(`${renderBase}/orinApi/api/support/assistant`, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + sessionIdToken,
      'X-Orin-Session': bundle.accessToken,
      'Origin': 'https://orin-99951.web.app'
    }
  });

  console.log("Capability Status:", capRes.status);
  const capData = await capRes.json();
  console.log("Capability Response:", JSON.stringify(capData, null, 2));

  if (capData.available) {
    console.log("\nTesting Live Gemini AI Response via Render Backend...");
    const { randomUUID } = await import('node:crypto');
    const { FieldValue } = await import('firebase-admin/firestore');
    
    const messageId = randomUUID();
    const thread = firestore.collection('orinSupportConversations').doc(userRecord.uid);
    const at = FieldValue.serverTimestamp();
    const old = await thread.get();
    if (!old.exists) {
      await thread.set({ ownerId: userRecord.uid, createdAt: at, updatedAt: at, lastCustomerAt: at, lastMessageId: messageId, handoffRequested: false });
    } else {
      await thread.update({ updatedAt: at, lastCustomerAt: at, lastMessageId: messageId });
    }
    await thread.collection('messages').doc(messageId).set({
      id: messageId,
      text: 'مرحبا، كيف يمكنني إيداع الأموال في حسابي وما هي العملات المدعومة؟',
      kind: 'customer',
      senderId: userRecord.uid,
      createdAt: at
    });

    console.log("Customer message created. Sending POST to /api/support/assistant...");
    const askRes = await fetch(`${renderBase}/orinApi/api/support/assistant`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + sessionIdToken,
        'X-Orin-Session': bundle.accessToken,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Origin': 'https://orin-99951.web.app'
      },
      body: JSON.stringify({ messageId })
    });

    console.log("Ask Assistant Status:", askRes.status);
    const streamText = await askRes.text();
    console.log("Stream Events received:\n", streamText);

    // Verify response in Firestore
    const messages = await thread.collection('messages').orderBy('createdAt', 'desc').limit(2).get();
    messages.forEach(doc => {
      const d = doc.data();
      console.log(`[${d.kind}] ${d.text}`);
    });
  }
}

testGemini().catch(console.error);
