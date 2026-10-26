# ORIN external read-only integration

This source implements the **ORIN side**, usable by a future Vino backend or another authorized server. No Vino backend was supplied, connected, deployed or verified. No actual API key was created. The feature is disabled unless an operator explicitly configures and enables it. It never changes balances, payments, trades, account access or customer identity.

## Activation prerequisites (operator work, not performed)

1. Review and apply additive migration `migrations/029_integration_readonly.sql` through the normal deployment process. The identical `firebase-functions/migrations/029_integration_readonly.sql` copy supports backend-local migration loading; the normal server prefers the root migration directory. It creates only integration key, rate-limit and audit tables. It neither deletes history nor creates keys.
2. Configure **server-only** environment values:
   - `ORIN_INTEGRATION_ENABLED=true` only when ready to enable this boundary.
   - `ORIN_INTEGRATION_TENANT_ID`: a fixed deployment namespace, 3–64 lowercase letters/digits/`_`/`-`; first character must be a letter/digit.
   - `ORIN_INTEGRATION_AUDIT_SECRET`: a separate high-entropy secret of at least 32 characters in the server secret manager. Do not reuse a customer password or an integration key.
   - `ORIN_INTEGRATION_FIREBASE_TENANT_ID`: optional, only if this ORIN deployment already uses Firebase Authentication multi-tenancy. The exact tenant verifier is then required. Otherwise tenant-issued Firebase tokens are rejected.
3. Use the existing ORIN Firebase project/service account; token audience/project, expiry, revocation and optional Firebase tenant are verified by Firebase Admin. Custom ORIN session revocation is compared to the original sign-in `auth_time`, not the refreshed token's `iat`: refreshing a revoked session does not restore access. Do not configure the auth emulator. The integration rejects emulator mode and has no test-token or email-allowlist bypass.
4. An administrator must have an **active database staff row**, permissions `configuration.manage` and `staff.manage`, and a genuine sign-in after the last staff validity change. Key creation/revocation additionally requires sign-in within five minutes. Legacy profile `role=admin` or a special email address does not substitute for this check.
5. Establish a trusted **customer identity link** between the external service and ORIN before allowing customer data access. The external backend must obtain the authentic signed-in customer's existing ORIN Firebase ID token through an approved first-party authentication/session exchange and forward it securely. An email supplied in chat, an arbitrary `uid`, a transaction number, a Vino login on its own, or the integration key alone is never sufficient. This repository does **not** invent or implement a cross-product OAuth/session exchange. That separate backend work and its security review are prerequisites, not a working connect flow in this delivery.

The deployment namespace binds each key to this ORIN deployment. This is not a general multi-tenant database isolation layer: do not point unrelated tenants at a shared ORIN customer database without designing and implementing tenant membership isolation first. Firebase multi-tenancy, if used, must also be configured explicitly as above.

## Administration

The existing admin **Configuration** page includes a read-only integration section without replacing ORIN branding, layout, balance card or existing configuration controls. It reports whether the backend boundary is enabled; it does not claim an external service is connected.

- `GET /api/integration-admin/status`: activation prerequisites/status, available scopes, explicit external-identity-link requirement.
- `GET /api/integration-admin/keys`: up to 100 metadata rows; never secret hashes or raw secrets.
- `POST /api/integration-admin/keys`: `{ "label": "backend-name", "scopes": ["account:read", "transactions:read"], "expiresAt": "ISO-8601 timestamp" }`. Expiry must be in the future and no more than 90 days away. The raw secret appears in this response **once**. Database storage is a SHA-256 hash of the high-entropy secret. Labels must not contain customer details.
- `POST /api/integration-admin/keys/{id}/revoke`: idempotent revocation. A revoked/expired key fails new authentication checks immediately. An already-authorized in-flight read may complete. Rotation means creating a narrowly scoped replacement, updating the trusted backend secret manager, then revoking the old key; there is no recover-secret endpoint.

These are future, deliberately invoked administrator actions, not startup or migration side effects. None was invoked during this work. The admin UI holds a returned secret only in component memory, hides it after one minute/on page hiding, and never writes it to localStorage/sessionStorage or logs. Store it in the external **backend** secret manager, not the APK, browser bundle, URLs, client storage, chat or analytics. Do not automatically retry key creation after an uncertain network response: inspect metadata and revoke an orphaned key before creating a replacement.

## Customer lookups

The external backend supplies both headers over HTTPS:

- `X-Orin-Integration-Key`: backend secret (not supplied by the customer).
- `Authorization: Bearer <authentic current ORIN Firebase ID token>`: from the securely linked signed-in ORIN session. Never ask the customer to paste this token, passwords, OTPs, recovery codes or API keys into chat.

`POST /api/integration/v1/lookup` accepts exactly `{ "kind": "account" | "email" | "transaction", "value": "exact identifier" }`. POST keeps customer identifiers out of query strings/access-log URLs. Unknown fields (including `uid`, `ownerId`, tenant or role overrides) are rejected.

| Lookup | Required key scope | Matching | Ownership rule |
| --- | --- | --- | --- |
| account | `account:read` | Exact ORIN account ID or account number | `accounts.user_id = verified Firebase uid` |
| email | `account:read` | Exact normalized email | Same verified owner filter; email is not authorization |
| transaction | `transactions:read` | Exact deposit ID/provider payment ID, withdrawal ID/transaction hash, or position ID | Every union branch is filtered by verified owner UID |

An unknown identifier and another customer's identifier return the same `404 record_unavailable`. There is no customer-wide list/search/export endpoint. Email lookup returns at most 20 of the **same owner's** accounts; a transaction lookup returns at most five matching records. Record identifiers are locators only.

Optional `balance:read` and `kyc:status` augment account/email lookups and require `account:read`. Balances are integer-cent decimal **strings**, separated into cash/reserved/bonus/bonus profit and real trading/withdrawal pockets; they are not an eligibility or payout quote. KYC is only a verified boolean, never an image or identity-document data. Transaction data is an allowlist of type, ID, amount, currency/coin, status/time and deposit credited flag; no destination address, customer profile blob or provider credentials are returned.

`GET /api/integration/v1/policy` requires a valid customer session plus `policy:read`. Its policy is read from the same runtime financial-policy helper as ORIN, including whether the prospective migration is active; it is not hard-coded promotional copy.

The customer API cannot call `/api/control/user` or reuse its broader administrative projection. Passwords, pending OTPs, KYC documents, security tokens, arbitrary `docs` payloads and other users' data are excluded by explicit SELECT fields and response construction.

## Separate staff lookup

`POST /api/integration-admin/lookup` accepts the same exact lookup body, but is for trusted, authenticated **staff tools**, not a chatbot. It requires an active staff record with `users.read` and `accounts.read`; transaction lookups additionally require `finance.read` and `trading.read`. Balance and KYC fields depend independently on `wallet.read` and `kyc.read`. It uses the same minimal projection, not the broad existing control-center record. Ambiguous or unavailable matches return `record_unavailable`. An API key cannot grant staff access or bypass these permissions. Do not give staff session credentials to a customer-facing bot.

## Rate limits, audit and deployment controls

- Customer boundary: 90 requests/minute per source IP, then 120 per key and 30 per key/customer for lookups. Staff management and lookup limits are separate; key creation is limited to five/minute per staff member. Distributed counters live in PostgreSQL, not per-process memory.
- Accepted/denied data lookups, policy reads and key create/revoke events are audited with a keyed pseudonym, opaque key ID and fixed action/outcome strings, not emails, account/transaction identifiers, bodies, raw keys or tokens. Authentication/scope rejection logs contain fixed reason/status codes only.
- No-store headers are applied. Customer scope decisions and active staff RBAC are independent. Missing configuration or schema fails this new module closed without changing old APIs.
- Configure the trusted reverse proxy correctly; existing `trust proxy` settings determine source IP. At the edge, enforce TLS, request-size limits, trusted-source routing as appropriate and redaction of Authorization, `X-Orin-Integration-Key`, all request/response bodies and sensitive headers. Do not enable body tracing/APM capture for these routes. Rate/audit table retention should be managed by the operator without deleting customer history.

## Source review / verification status

Only source text was read and edited. **No application, build, TypeScript compiler, test suite, server, database, migration, browser or emulator was run. No live request, actual key creation or deployment occurred.** Runtime success has not been established.

Manual review cases traced in the implementation, not executed:

1. Disabled/missing configuration → reject new customer API; unrelated original routes remain unchanged.
2. API key without a real Firebase session; fake/expired/revoked token; restricted/disabled profile; wrong Firebase tenant → deny.
3. Valid owner A session plus B email/account/transaction → uniform 404, never B's data.
4. Missing scope, expired/revoked key or different deployment-tenant key → deny.
5. Legacy profile-admin/email allowlist without active staff row → no key management or staff lookup.
6. Active staff without required permission or stale sign-in → deny management; API key cannot elevate.
7. Each response field manually compared against allowlists; no pending OTP/password/document/token field used.
8. Duplicate revoke is safe; lost creation response is not automatically retried; secret never fetched again.
9. Concurrent rate counters are atomic in PostgreSQL; customer middleware calls `next()` on success and handles failures.
10. UI close/navigation/page-hide clears ephemeral secret; preview does not make integration requests or create keys.

These cases still require the operator's authorized deployment-environment testing before production enablement.
