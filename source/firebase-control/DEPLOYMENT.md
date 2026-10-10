# Control Center activation runbook

For the 1.4.0 administration extension, read `../ORIN-ADMIN-1.4.0-NOTES.md`.
Deploy and wait for the indexes in `firestore.indexes.json` in the isolated
staging project before testing ticket filters, overdue counts and audit filters.
The new ticket collections and their notes remain server-only under the existing
deny-by-default rules. No production deployment has been performed.

No command in this document was executed against production during this review. Do not upgrade Firebase billing or replace stable hosting without the owner's reviewed activation decision.

1. Back up the active Firestore data and export the *current* deployed rules through the owner's authorized console/IAM session. The included `exported-production.rules` is only the last observed snapshot, not proof that production has not changed since it was captured.
2. Compare the new export with `production-rules-base.sha256`. Reconcile differences before proceeding. `production-rules.patch` is a minimal review patch against the snapshot. `firestore.production-candidate.rules` applies that patch only. `firestore.rules` additionally contains the current project source's previously prepared compatibility rules. Do not blindly replace current rules with either file; review the exact diff and rerun the corresponding tests.
3. On an isolated Firebase test project, build/deploy the trusted server, reviewed rules and indexes. Configure the project-specific API origin allowlist and the frontend's explicitly approved program transport URL. The source transport accepts only the existing ORIN Functions origin; a different trusted host requires a reviewed configuration change, not unrestricted runtime URLs.
4. Keep `orinControlIntegrations/current` absent or false until each provider adapter has passed its integration tests. This collection is server-only and has no Control Center mutation. Never turn a flag on merely to make an unavailable feature look operational. Keep financial feature flags off and `maxAdjustmentCents` null until policy approval.
5. KYC storage must be a dedicated private bucket, with uniform bucket-level access and public access prevention enforced, no public IAM grant, no download tokens and no public signed URLs. `storage.rules` denies client reads/writes. Do not apply this ruleset indiscriminately to an existing bucket serving other application assets. A provider upload/intake service must establish the document metadata and integrity before reviewers can access documents.
6. Run `scripts/test-control-center.sh`, `scripts/test-refinement-131.sh`, and the rules suite against the reviewed candidate. Emulator tests alone are not a payment/provider certification. Stage provider callbacks, retries, cancellations and reconciliation separately.
7. Deploy the reviewed hardened Firestore rules before creating the activation marker. The rules preserve legacy behavior while the marker is absent, then block legacy admin/owner client privilege paths when it exists. The bootstrap script verifies the actual active rules hash matches a reviewed rules file; it aborts otherwise.
8. The project owner signs in using local application-default IAM credentials in a protected environment. Use a real existing Firebase Auth UID whose email is verified, active and matches the ORIN user profile. Do not paste credentials or private keys into chat, a browser form, the repository or the APK.

Run first as a dry run, using the confirmed existing identity:

```sh
node firebase-functions/scripts/bootstrap-control-admin.mjs --project=orin-99951 --uid=CONFIRMED_EXISTING_UID --email=CONFIRMED_VERIFIED_EMAIL
```

After successful identity and active-rules verification, the same owner can execute the one-time transaction with `--apply=true`. It creates `orinStaff/{uid}`, the activation marker with the Super Admin count, and the bootstrap audit record. It does not create a password. A second bootstrap is refused; further staff changes use the audited API. No production invocation was made in this session.

9. Build a review frontend with `VITE_ORIN_PROGRAM_API_URL` set only after that service exists and passes staging checks. Use the normal verified-email login, open `/admin`, and create separate Finance/Finance Approver test identities. Verify their permissions, current-session revocation, owner recovery and customer startup before promoting any stable deployment.
10. Activate only reviewed functions and operational limits. `orinControlNotificationWorker` requires Cloud Scheduler/Functions provisioning and stays functionally disabled until the trusted scheduler capability is set. It delivers in-app notifications only. Push, email and SMS are not claimed.
11. Keep the original APK signing key outside the project archive. Restore the authorized signing backup and Android SDK, update the manifest/version constant together, and test on an actual medium-performance device. No replacement signing key is acceptable.

## Server data contracts

- `orinStaff/{uid}`: verified email binding, one supported role, `status`, `revision`, optional millisecond `validAfter`.
- `orinControlConfiguration/current`: operational toggles and nullable private adjustment limit. Only `orinPublicConfiguration/current` is client-readable.
- `orinKycRequests/{id}`: `uid`, `status`, integer `revision`, bounded `documentIds`, and a trusted `evidenceComplete` flag. `orinKycDocuments/{id}` binds request, user, exact `kyc/{uid}/{requestId}/{documentId}` path and storage generation. No frontend upload API is present yet.
- `orinControlDeposits` / `orinControlWithdrawals`: provider-ingested `uid`, `accountId`, currency, integer cents, provider reference, status, revision and timestamp. No client creation/completion API. Approved requests create a payment outbox instruction awaiting a provider-specific implementation.
- `orinReferralRewards`: immutable amount/terms snapshot; qualification evidence linked to distinct verified customer fingerprints. `orinEligibleRevenue`: finalized eligible *net revenue*, direct/active counts, terms version and exact configuration revision. Never derive these from browser-supplied totals or customer deposits.
- `orinExecutedTrades`: trusted execution-adapter records. Old internal demo contracts are not shown as executed real trades.
- `orinControlAudit` and financial ledger: client-immutable. Backend uses create-only audit entries. Retention/export controls and independent tamper-evident archival can be added by the project owner; they are not represented as existing integrations.

## Rollback

Keep financial operations disabled, preserve the activation marker, staff data, audit records and immutable financial history, and restore only a compatible reviewed application/backend pair. Deleting the marker or restoring old permissive rules would reopen the retired administration path. The pre-change source archive is for review/recovery, not an instruction to overwrite live financial data.
