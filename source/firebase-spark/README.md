# ORIN original interface — Firebase Spark

## Release 1.1.0 update (2026-10-03)

The current release package is `ORIN-Update-1.1.0.zip`, with the full updated
source, compiled public assets and a preview-only deployment script. Its channel
is `orin-1-1-review`. It deliberately contains no top-level live publish script.
The historical instructions below describe the 1.0 package, not this update.

`/admin` now opens the responsive dashboard; `/admin/contracts` preserves the
original contract workspace, and `/settings/admin` preserves chart configuration.
New functionality includes account security, password visibility and strength,
private compact avatars, account-data export and deletion requests, reversible
inbox archive, admin configuration and bounded user statistics, and atomic
admin user-change audit records. The latter cover the new dashboard only, not
all changes made from older clients or Firebase Console. Deletion requests are
queued for manual review; they do not erase Auth or Firestore records themselves.
Maintenance is an application presentation state, not a backend access kill switch.

New rules were emulator-tested but are not yet deployed. The preview script
publishes those additive rules to the shared Firebase backend before publishing
the new preview. New avatar/configuration/request/audit writes need those rules.
Existing live Hosting and the previous preview are not replaced.

The Android 1.1.0 APK bundles this exact web build and uses the previous signing
key. Signature, alignment and embedded bytes pass verification. No physical
Android device or emulator was available for an on-device test. All 16 release
tests, TypeScript and the production build passed. Visual inspection of the new
authenticated pages, production end-to-end tests, and real-device performance
remain pending. See `ORIN-Update-1.1.0-Report.html` in the release package.

Cloud Functions source remains intact and undeployed. Finance, push/scheduling,
full coordinated account erasure and global session revocation have not been
moved to the client. No billing or Analytics changes were made.

## Historical 1.0 scope

Current delivery target: existing Firebase project/site `orin-99951`, Spark, no billing account and no Cloud Functions deployment. This target imports the original `app/trading-workspace.tsx`, chart, navigation, settings, original logos, fonts and stylesheet files. It does not replace ORIN with the standalone account MVP.

## What works without Functions

- Firebase email/password registration, sign-in/sign-out, password recovery and email verification.
- Firestore user profiles, verified owner bootstrap, user/admin roles, private user listing and admin user management. `/admin` opens the original administration screen; `/admin/users` manages users.
- Backend Security Rules enforce authorization. A suspended ORIN profile loses access to app data. This suspends ORIN access; it does not disable the Firebase Auth identity or revoke all its tokens.
- Original home, market chart, navigation, appearance, language, chart preferences, notification sound/vibration preferences and original brand assets.
- Persisted account preferences/profile and closure requests, with revision conflict checks and immutable security fields. Existing reserved funds block closure requests.
- Admin market configuration under backend rules.
- In-app announcement drafts, audience preview, explicit send confirmation, atomic publication, cancellation, per-user inbox/read states, badges and deep links. Audiences support country, account tier, language and specified user IDs, plus opt-in. At most 1,000 accounts inspected and 200 recipients per publication. No autonomous scheduling or push delivery is claimed.
- Existing server-owned financial records, when present in Firestore, remain read-only. Existing eligible invitation codes can be inspected and their stored terms hash checked. No D1 data is deleted or automatically imported.

## Exact impact of removing the dependency on `orinApi`

| Previous route / operation | Spark behavior |
| --- | --- |
| GET `/api/lab` and original app state | Reads Firebase data directly; does not create a virtual balance. Accounts without existing financial data show zero, not a fabricated 10,000 USD. |
| `bootstrap`: virtual funding, balanced opening journal and financial audit | Not executed. Existing data is retained. |
| POST `/api/lab`: `publish` | Not executed: locked-contract publishing and its journal/audit/notice pipeline require the trusted backend. Original form is retained with an explanatory notice. |
| POST `/api/lab`: `join` | Not executed: no balance reservations or positions are created in a client. |
| POST `/api/lab`: `settle` | Not executed: no P&L, journals, receipts, financial audit or settlement notices are generated. Automatic settlement polling is omitted only in Spark mode. |
| POST `/api/lab`: `accept`, `read`, `tier` | Firestore operations with field validation, ownership and admin checks in Security Rules. |
| POST `/api/invitations/verify` | Read-only lookup of eligible existing contracts and hash check; participation remains unavailable. |
| GET/PATCH `/api/settings` | Firestore preferences/profile records; revision and data checks in Security Rules. |
| GET/PATCH `/api/markets/configuration` | Firestore configuration; admin-only writes. |
| `/api/notifications` | Firestore inbox and immutable published announcements; user-owned read state. |
| `/api/admin/notifications` | Firestore drafts and confirmed in-app publication; atomic pointers and immutable announcement content. Recipient lists are private to admins. |

FCM/push delivery, APNs, automatic scheduled sending, MFA, global Auth revocation/deletion, real-money funding/withdrawal and native APK were not implemented in the previous release. They have not been removed by this Spark target. The full previous Cloud Functions source remains preserved in `firebase-functions/` for later use; it is not deployed by any Spark script.

## Files and security

`firebase.spark.json` has only static Hosting and Firestore configuration. No Function rewrites, paid services, external backend proxy or third-party hosting are introduced. Existing `/users` rules remain intact. New `spark*` collections have specific rules and default denial. Financial collections never allow client writes, including admins.

Display preferences are cached briefly to reduce repeated Spark reads. Persisted data and access control live in Firestore. Marketing opt-out hides announcement delivery in the app; the app does not send external messages. Inbox aggregates are computed from actual Firestore records. Existing inbox fetching is per-user; very large inboxes will need pagination/count optimization. The plan's usage quotas still apply.

## Build and verification

`npm run build:firebase-spark` and `npx tsc --noEmit`.

Security/auth tests: `firebase-spark/spark.test.mjs`, `firebase-web/auth-smoke.test.mjs`, `tests/theme.test.mjs`, in isolated Firebase Auth and Firestore emulators using project `demo-orin-auth`. Covers real registration/login/logout/reset, preferences, revision conflicts, forged admin roles, disabled profiles, cross-account access, immutable finance records, atomic announcement publication and read-state synchronization. Light styles and primary logo are checked byte-for-byte against the approved baseline. No test accounts or campaigns are created in production.

Local authenticated UI screenshots are not verified: this environment's Cloud Browser blocks localhost. Live/preview end-to-end UI verification remains a deployment gate.

## Review before live replacement

The packaged `preview.sh` deploys the tested Firestore rules and a Firebase Hosting preview channel `spark-review`. It does not deploy the live channel. Preview channels share the project's Authentication and Firestore; test with designated accounts and avoid real marketing sends.

Open the returned temporary Firebase URL and check registration/login/logout/recovery, original home/markets, saved appearance and `/admin/users` with the verified owner. After review, `publish.sh` clones that exact preview channel to the existing live site. The hostname remains `orin-99951.web.app`. Do not run the older Blaze archive or deploy Cloud Functions.

At packaging time, no new production deployment or production rule update has been made. Local Firebase CLI is unauthenticated and browser Cloud Shell reports Site Unavailable. The project remains Spark. The owner can deploy this package through their already-authorized phone Cloud Shell.
