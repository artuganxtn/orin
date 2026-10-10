# ORIN 1.6.1 — Adam deployment and acceptance

This release includes the 1.6.0 account-security implementation and the Adam support integration. It has NOT been deployed to production. The downloadable APK intentionally retains the current Spark login path so unavailable security endpoints do not lock existing users out. It includes the native lock and UI/market fixes. It does not silently enable an unconfigured AI service. The security migration web bundle is a separate deployment candidate, not the currently hosted app.

## Server activation prerequisites

1. Authenticate Firebase CLI to the owner's `orin-99951` project and provision a Functions-capable deployment (Firebase Blaze or an equivalent reviewed trusted backend). No authenticated deployment account was available in this workspace.
2. Follow `SECURITY-DEPLOYMENT-160.md` first. Resolve the provider-level password-only account-update/MFA and failed-login audit gaps, coordinated session migration and strict rules. Enabling UI status or only setting the environment flag is not acceptance.
3. Set `ORIN_ACCOUNT_SECURITY_ENABLED=true`, `ORIN_SUPPORT_AI_ENABLED=true`, `ORIN_SUPPORT_AI_PROVIDER=gemini`, `ORIN_SUPPORT_AI_MODEL=gemini-3.5-flash-lite` in server environment configuration. Follow the security guide for WebAuthn RP/origin and trusted ingress settings.
4. Use `scripts/configure-support-secret.sh` to enter the provider credential without terminal echo. It writes only a temporary0600 file outside the repository and uploads to Secret Manager `ORIN_SUPPORT_AI_API_KEY`. The `orinApi` function is bound to this secret. Rotate with the same script and redeploy the function; no client source/APK key change is needed. This script was supplied, not executed against production.
5. Configure the security master key with the existing guide. Never reuse the AI credential as an encryption key. Never commit either key or APK signing material.
6. Build the functions and security web candidate, then deploy with `firebase.security-161.json`, which references `firebase-security-161.indexes.json`. This manifest merges21 existing/support indexes, including customer-owned deposits/withdrawals ordered by creation time. Wait for indexes to be ready. Strict rules/default-deny must cover support configuration, KB, usage, errors, jobs and tickets; client-created assistant messages remain forbidden.
7. Only after coordinated migration set the server-owned activation marker as described by the security guide. Do not activate the marker against old client rules or deploy the strict candidate abruptly to current users.
8. In Control Center → Support / AI Support, configure the provider, approved model, budgets and instructions. Knowledge edits become drafts and require review before publishing. Operator guidance cannot grant broader permissions. Health shows actual provider readiness, not proof of a completed support request.

## Required acceptance before public release

Use a real Android device to exercise PIN/background/restart/biometrics, open support, submit a real ORIN question through the deployed authenticated API, verify persistence and UI history, switch languages, test service outage→same-message retry, inspect an owned transaction and deny another user's data, then escalate and verify the actual admin ticket. Check physical-device chart history and account switching separately. Do not test by moving customer funds.

The provider sends real SSE to the backend. The client gets real progress plus one validated persisted reply. Word-by-word client text streaming remains intentionally unimplemented pending a reviewed incremental-output validation strategy; do not describe this as completed token streaming.

The exposed test credential was used only for ORIN development/verification and remains unrevoked as requested until the owner tests. No public release was made. The owner must revoke that exposed key in the provider console and configure a new production secret before publishing to customers. A Gemini API key grants inference access, not Google Cloud IAM permission to delete/revoke itself. The current workspace has no authenticated Google Cloud key-management session. Removing a local secret copy is not provider revocation.

## Evidence

- `adam-live-http-161.json`: actual ORIN HTTP handler + isolated Auth/Firestore + real Gemini,9 scenarios pass. No production customer data.
- `adam-assistant-tests-161.txt`:22 provider-protocol and Firestore scenarios; mocks exist only inside tests.
- `support-admin-tests.txt`:7 permission/audit/knowledge/administration scenarios.
- `support-ui-161.txt`:12 client/balance/runtime compatibility scenarios.
- `mini-history-161/`:6 focused+21 regression cases and actual public historical-feed responses.
- `chart-preservation-161.json`: main TradingView configuration, live-market implementation, symbol map and preferences unchanged.
- `ADAM-REVIEW-161.md`, security review and earlier security test evidence.

The database material in this handoff is source/schema/rules/indexes/migrations and isolated test records, NOT a dump of production customer data. Private signing keys and server credentials are excluded.
