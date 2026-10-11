import { sendOtpEmail, sendWelcomeEmail, getSmtpConfig } from './src/email-service.ts';
import fs from 'node:fs';
import path from 'node:path';

// Automatically load .env if available
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  } else {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const [key, ...rest] = trimmed.split('=');
          const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
          if (!process.env[key.trim()]) process.env[key.trim()] = val;
        }
      }
    }
  }
} catch (e) {
  console.warn('Could not load .env file:', e);
}

const targetEmail = process.argv[2] || 'Khtaub7341@gmail.com';
const config = getSmtpConfig();

console.log('==============================================');
console.log('ORIN Titan SMTP Test Dispatcher');
console.log('==============================================');
console.log('SMTP Host:', config.host);
console.log('SMTP Port:', config.port, `(SSL: ${config.secure})`);
console.log('SMTP User:', config.user);
console.log('SMTP From:', config.from);
console.log('Target Email:', targetEmail);
console.log('Password set:', config.pass ? 'YES (Length: ' + config.pass.length + ')' : 'NO (Empty in .env)');
console.log('----------------------------------------------');

if (!config.pass) {
  console.error('\n[ERROR] SMTP_PASS is empty in source/firebase-functions/.env!');
  console.error('Please open source/firebase-functions/.env and set your Titan password:');
  console.error('SMTP_PASS=your_titan_email_password\n');
  process.exit(1);
}

async function run() {
  try {
    console.log(`\n[1/2] Sending OTP Verification Email template to ${targetEmail}...`);
    const mockCode = '849201';
    await sendOtpEmail(targetEmail, mockCode, 'test-challenge-' + Date.now());
    console.log(`✓ [SUCCESS] OTP email sent successfully! Code: ${mockCode}`);

    console.log(`\n[2/2] Sending Welcome Email template to ${targetEmail}...`);
    await sendWelcomeEmail(targetEmail, 'Khtaub');
    console.log(`✓ [SUCCESS] Welcome email sent successfully!`);

    console.log('\n==============================================');
    console.log('All email templates delivered via Titan SMTP to ' + targetEmail);
    console.log('==============================================');
  } catch (err) {
    console.error('\n✗ [FAILED] Error sending emails via Titan SMTP:');
    console.error(err.message || err);
    if (err.code === 'EAUTH') {
      console.error('\n>> Authentication failed: Check your Titan email username & password.');
    }
    process.exit(1);
  }
}

run();
