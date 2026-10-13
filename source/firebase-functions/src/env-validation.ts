export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const missing: string[] = [];

  // Database URL
  if (!process.env.DATABASE_URL?.trim()) {
    missing.push('DATABASE_URL');
  }

  // KYC Secrets
  if (!process.env.KYC_HMAC_SECRET?.trim()) {
    missing.push('KYC_HMAC_SECRET');
  }
  if (!process.env.KYC_FILES_KEY?.trim()) {
    missing.push('KYC_FILES_KEY');
  }

  // Firebase Admin SDK credentials
  const hasFirebaseProject = !!(process.env.FIREBASE_PROJECT?.trim() || process.env.GCLOUD_PROJECT?.trim());
  const hasServiceAccount = !!process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!hasFirebaseProject && !hasServiceAccount) {
    missing.push('FIREBASE_PROJECT (or FIREBASE_SERVICE_ACCOUNT)');
  }

  // Mandatory Mail & OTP secrets in production
  const pepper = (process.env.ORIN_EMAIL_CODE_SECRET || '').trim();
  if (!pepper || pepper.length < 32) {
    missing.push('ORIN_EMAIL_CODE_SECRET (min 32 characters)');
  }
  const mailKey = (process.env.ORIN_MAIL_API_KEY || process.env.SMTP_PASS || process.env.TITAN_PASSWORD || '').trim();
  if (!mailKey) {
    missing.push('ORIN_MAIL_API_KEY (or SMTP_PASS / TITAN_PASSWORD)');
  }
  const mailFrom = (process.env.ORIN_MAIL_FROM || process.env.SMTP_USER || '').trim();
  if (!mailFrom) {
    missing.push('ORIN_MAIL_FROM (or SMTP_USER)');
  }

  if (missing.length > 0) {
    const message = [
      '',
      '========================================================================',
      '[FATAL CONFIGURATION ERROR] Missing required environment variables in production:',
      ...missing.map(v => `  ❌ ${v}`),
      '',
      'Server startup aborted. Please define these variables in your environment.',
      '========================================================================',
      ''
    ].join('\n');
    console.error(message);
    throw new Error(`Production startup aborted. Missing required variables: ${missing.join(', ')}`);
  }
}
