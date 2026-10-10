# ORIN account MVP

This Firebase Hosting target contains the priority account flow: email/password registration, login, logout, password reset, verified-email owner bootstrap, persistent Firestore profiles, user/admin roles and `/admin` user management. It reuses the approved ORIN mark, font and light palette. The existing trading application remains in `app/`; it has not been replaced or migrated. This initial Firebase deployment is the account/admin version, not a port of the virtual ledger or market workspace.

## Deploy

From the repository root, run `npm run build:firebase`, then `npm run deploy:firebase` after Firebase CLI sign-in. The target project and Hosting site are `orin-99951`. With explicit user approval, the default Firestore database has been created in Europe `eur3`. Production rules from `firestore.rules` have been published successfully through Firebase Console.

Firebase Email/Password is enabled and the ORIN Web app has been registered. The SDK configuration is public configuration, not an admin key. There is no service-account key in the client or repository.

## Security

- New records must have role `user`, matching authenticated UID/email, `disabled: false`, server timestamps and validated fields.
- User profiles are private. Only a verified, active admin can list users; queries are capped at 100.
- Users can change only their own display name. They cannot assign roles, change immutable identity fields, enable/disable accounts, or write another user's profile.
- A verified project-owner email, specified only in backend Firestore rules, may bootstrap its own admin role. Being the first registrant does not grant admin access. No administrator password is shipped.
- Admins can edit other app users, change user/admin roles and suspend ORIN access. They cannot disable/demote the protected project-owner profile or modify themselves.
- Suspending access blocks app functionality through backend rules; it does not delete or disable the Firebase Authentication identity. Firebase-wide session revocation and Auth deletion require a later trusted Admin SDK backend.
- Password-reset responses avoid confirming whether an address exists. Firebase sends reset/verification emails; no email-service credentials are used by this app.
- No Firestore production data is seeded by the tests. Emulator tests use an isolated `demo-orin-auth` project.

## Android

The first target is responsive web with a standalone PWA manifest for Android. No APK, Android signing key or Play Store release is produced in this task. An existing native Android project was not present in the available checkout. iPhone work is deferred.

## Scope deferred

Trading/ledger migration, push notifications, advanced account auditing, MFA, global Auth user deletion/revocation, native APK packaging and cosmetic improvements are deferred. Do not represent these as part of the current account MVP.

## Verified in this session

Production static build and TypeScript pass. Four emulator tests pass, covering real email/password account creation, profile persistence, concurrent initialization, sign-out/sign-in, password recovery and replacement, private profile access, self-escalation rejection, verified owner bootstrap, administrator management and suspended-admin denial.

The project owner successfully deployed the archive through their own Firebase Cloud Shell. Hosting is live at https://orin-99951.web.app/ and production Firestore rules are published. After an initial upload failure, the owner retried with `FIREBASE_HOSTING_UPLOAD_CONCURRENCY=1` and the CLI reported `Deploy complete!`.

Live browser checks confirmed that login, registration and password-recovery pages render and anonymous access to `/admin` displays the login form. Actual production registration, email verification and authenticated admin operations still require the owner's account test; emulator coverage does not replace that check. No production account or password was created by the assistant. Local Firebase CLI credentials remain unavailable; deployment success came from the owner's Cloud Shell.
