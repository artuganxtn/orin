import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderEmailTemplate } from '../firebase-functions/lib/mail/templates.js';

const outputDir = resolve(process.cwd(), '../email-previews');
mkdirSync(outputDir, { recursive: true });

const templates = [
  'signup_code',
  'password_reset_code',
  'welcome',
  'login_new_device',
  'password_changed',
  'withdrawal_code',
  'withdrawal_requested',
  'withdrawal_approved',
  'withdrawal_paid',
  'deposit_confirmed',
  'kyc_approved',
  'kyc_rejected',
  'daily_reminder'
];

const mockPayloads = {
  signup_code: { code: '849201' },
  password_reset_code: { code: '401928' },
  welcome: { name: 'Khtab Malked' },
  login_new_device: { ip: '185.220.101.5', revokeLink: 'https://orin-trader.top/settings/security?revoke=token123' },
  password_changed: {},
  withdrawal_code: { code: '592018', amountUsd: '1,500.00', coin: 'USDT (TRC20)', address: 'TAb9uNeXzJeSWuAkiVv6d95oyZ2Jk8Qgas', isNewAddress: true },
  withdrawal_requested: { amountUsd: '1,500.00', coin: 'USDT TRC20' },
  withdrawal_approved: { amountUsd: '1,500.00' },
  withdrawal_paid: { amountUsd: '1,500.00', txHash: '0x9f8b7c6a5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a' },
  deposit_confirmed: { amountUsd: '2,500.00' },
  kyc_approved: {},
  kyc_rejected: { reason: 'الصورة غير واضحة والجزء العليوي مقصوص' },
  daily_reminder: { balanceUsd: '3,450.00', openPositions: 1, kycStatus: 'Verified', unsubscribeToken: 'unsub-token-xyz-123' }
};

console.log('=== RENDERING EMAIL TEMPLATE PREVIEWS ===');
const generatedPaths = [];

for (const tpl of templates) {
  for (const locale of ['ar', 'en']) {
    const payload = mockPayloads[tpl] || {};
    const rendered = renderEmailTemplate(tpl, locale, payload);
    const fileName = `${tpl}_${locale}.html`;
    const filePath = resolve(outputDir, fileName);

    writeFileSync(filePath, rendered.html, 'utf8');
    generatedPaths.push(filePath);
    console.log(`[PREVIEW GENERATED] ${fileName} -> ${filePath}`);
  }
}

console.log(`\nSuccessfully rendered ${generatedPaths.length} email template HTML files outside source at:`);
console.log(outputDir);
