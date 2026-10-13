import { build } from 'esbuild';

await build({
  entryPoints: [
    'src/index.ts',
    'src/payments.ts',
    'src/nowpayments.ts',
    'src/programs.ts',
    'src/program-ingestion.ts',
    'src/contracts.ts',
    'src/withdrawals.ts',
    'src/kyc.ts',
    'src/auth-middleware.ts',
    'src/otp.ts',
    'src/mail/transport.ts',
    'src/mail/templates.ts',
    'src/support.ts',
    'src/telegram.ts',
    'src/scheduler.ts',
    'src/db.ts',
    'src/email-registration-http.ts',
    'src/migrate.ts'
  ],
  outdir: 'lib',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true
});
