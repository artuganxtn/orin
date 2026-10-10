# ORIN original application on Firebase

This target compiles the existing ORIN app components and original Light/Dark styles from `app/`, not the standalone account dashboard in `firebase-web/main.tsx`. `firebase-app/account.tsx` reuses the tested authentication and user-administration forms only. All app API requests go to the current Firebase Hosting origin with a Firebase ID token. There is no proxy to ChatGPT Sites, Cloudflare or the old D1 backend.

## Deployment topology

- Existing project and Hosting site: `orin-99951`.
- Firebase Authentication: email/password, verification and password recovery.
- Existing Firestore `users` profiles and roles are preserved. `/admin/users` manages them under the existing backend rules.
- `orinApi`: Cloud Functions v2, Node 22, europe-west1, zero minimum instances, maximum two instances; these settings reduce idle work but are not a hard spending cap.
- Hosting rewrites `/api/**` to `orinApi`, then all app routes to `index.html`.
- New server-owned Firestore collections use `orin` prefixes. Firestore rules deny all direct client reads/writes to these app records, including administrators. Every API request verifies the Firebase ID token and active profile; transactions recheck permissions.

Build with `npm run build:firebase-original`. Deploy with `npm run deploy:firebase-original`, or use the self-contained `ORIN-Original-Firebase.zip` package. Deploying Functions requires the project owner to link billing and enable Blaze. No billing upgrade, production account change or Firebase deployment has been performed by this migration work yet.

## Preserved behavior

Original home, markets/TradingView, contract invitation/trade screens, wallet, settings, dark appearance, full-page navigation, notifications, in-app campaigns, original assets and audio files are included. Firebase auth opens these original screens after login. Admin user management is under Settings → Administration → User management.

Internal contracts remain explicitly virtual-only. Initial virtual capital is created atomically once per Firebase UID. Publishing locks and hashes terms. Joining validates consent, eligibility, timing, amount and balance in a transaction. Duplicate joins and settlements are idempotent. Every journal is balanced and created atomically with its account movement, position, audit and receipt. Market prices do not determine internal settlement. Expired contracts settle on the user's next mutating request, as in the previous application; no unattended scheduler has been added.

The prior D1 database is not modified or automatically imported. A Firebase UID is a different identity from the previous ChatGPT account; historical D1 records need a separate, owner-reviewed data migration if required. Existing Firebase email/password accounts remain valid.

## Validation

Production client and Functions builds and TypeScript checks pass. Eleven emulator checks pass: real Firebase registration/login/password recovery; anonymous/forged/unverified-admin denial; verified owner bootstrap; direct database tampering denied; concurrent duplicate allocation and overspend rejection; idempotent balanced settlement; preference persistence/stale revision rejection; campaign confirmation/consent/idempotency; per-user notice reads; disabled-account denial; unchanged Light stylesheet/logo bytes and Dark text contrast.

## Remaining capabilities

Push/APNs, native Android APK, iOS, real-money funding, external broker execution, KYC, MFA, global session revocation and scheduled background jobs remain outside this release, as stated in the original UI. Campaigns are sent explicitly with confirmation and are currently capped at 200 recipients per send (at most 1,000 account records inspected). Large or unattended campaigns need a background delivery design. Read-only account history is currently fetched per account before applying the UI's recent-history limits; production scale requires pagination/index planning.

An additional HTTP emulator smoke test passes through Hosting → Functions → Firebase Auth → Firestore, including anonymous denial and a full-page app route. The emulator used installed Node 24; deployment targets Node 22, and the bundle is compiled for Node 22.
