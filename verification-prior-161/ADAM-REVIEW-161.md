# ORIN Adam 1.6.1 independent review

Review date: 2026-10-06. Scope: account-scoped support tools, provider boundary, assistant job/idempotency, escalation, administration and client event transport. The reviewer did not edit production source, access provider credentials, mutate a hosted service, or test a physical device. This is a source-review checkpoint, not deployment certification.

## Confirmed implementation boundaries

- The model receives reviewed application knowledge, redacted recent conversation and explicit read-only results. It is not given a database client, arbitrary document path, URL executor, customer identifier argument, financial mutation or security mutation tool.
- All seven read tools take their account scope from authenticated `Identity`. A requested deposit/withdrawal document must match that identity's UID. Sensitive payment destinations, security secrets and session IPs are excluded from tool projections.
- The HTTP handler verifies Firebase identity plus the enforced ORIN session before assistant routes. Each tool rechecks the account/session, and the final message write rechecks it in the persistence transaction. Failed/revoked sessions do not authorize a final response.
- A job is identified by authenticated user plus original message ID. Ownership, customer kind and sender are verified. An existing answer is replayed by ID; active work uses a lease; final writes use lease ownership. A human handoff or newer message wins over a late answer.
- Per-user rate limits and a transactionally reserved daily token budget bound inference. A reclaimed crashed reservation is conservatively charged as unmeasured and removed from reserved usage. Model/token usage is not a financial account ledger.
- Escalation creates an actual compatible support ticket with redacted conversation excerpts and one active ticket mapping per customer. No model output can approve a payment or alter the wallet.
- AI configuration/knowledge mutations require the relevant staff permission, recent authentication, a live session check in the transaction, request idempotency and revision checks. Admin reads also check the live session; conversation-view auditing rechecks it before returning redacted text. Knowledge edits return to draft; explicit review of the saved revision is required for publishing.
- Gemini uses its fixed official endpoint and a server-only header credential bound to `orinApi` as a Secret Manager secret. The alternative provider uses an exact configured HTTPS origin and rejects redirects.
- Upstream SSE is buffered. The client receives real progress events, then one validated, persisted answer. This is **not** token-by-token client text streaming. Final text is emitted only if the saved reply belongs to that worker.

## Findings corrected during this review

| Finding | Source checkpoint |
| --- | --- |
| Recovery codes in ORIN's 4-by-6 hexadecimal format could reach the provider | Exact recovery-code patterns and natural-language password labels are now redacted; tests added. |
| Withdrawal tool asserted NOWPayments without a provider-backed record | Withdrawal projection now returns no unproven provider. |
| Session query filtered an arbitrary first page and could report a false zero | Query selects active records and returns an unknown total when truncated, with an observed count. |
| Unexpected account type was presented as demo | Tool only includes supported, owned account types. |
| Admin mutation could commit after individual session revocation | Transaction now calls the shared session/account check before permission and writes. |
| Crashed job reclaim lost its outstanding usage reservation | Reclaim now settles the old reservation conservatively before replacing the lease. |
| Overlapping worker could emit text that was not the persisted answer | Final delta requires the saved reply ID to equal that worker's response ID. |
| Latest-five financial results could be mistaken for a complete ledger | Results explicitly identify the limited scope. Arbitrary older references are not automatically looked up from natural-language chat. |
| Deployment's original index manifest omitted new ordered support lookups | Root added a merged 21-index `firebase-security-161.indexes.json`, selected by `firebase.security-161.json`. The reviewer verified both required `(uid ASC, createdAt DESC)` indexes and the existing deposit-account index are present. |

## Runtime and deployment limits

1. Root's recorded `gemini-generation-161.json` demonstrates a real `generateContent` HTTP 200 using `gemini-3.5-flash-lite`, an Arabic ORIN reply and real usage metadata. That particular artifact is a minimal knowledge-only request, not proof of authenticated production end-to-end chat or the complete SSE helper. Provider fixture tests must not be represented as live-model calls.
2. The available Firebase CLI configuration had no authenticated user/token, and no Google Cloud credential context was available to this reviewer. Existing live API/security probes were HTTP 404. A working Gemini key alone does not deploy or activate `orinApi`, `orinSecurity`, strict rules, or session state.
3. The new `firebase.security-161.json` now selects a manifest containing the deposit/withdrawal support indexes. Their presence in source does not establish that production indexes have been deployed and finished building; Firestore emulators do not prove production composite-index availability.
4. Cloud Functions production deployment requires the project's supported billing plan and deployment permissions. Secret Manager binding, server environment configuration, activation marker, strict rules, indexes and authenticated application routing must be deployed together and then tested through the hosted API.
5. No real Android device, production staff account workflow, native lock transition, or real payment execution was tested by this reviewer. The assistant deliberately has no payment execution capability.
6. Source grounding and output validation reduce hallucination/injection risk but do not prove that every possible model sentence is factually entailed. The application must keep authoritative actions and financial state in authenticated backend workflows.

## Evidence interpretation

The reviewer read `adam-assistant-tests-161.txt`: **22 tests passed, zero failed** (8 provider protocol tests and 14 Firestore backend tests). The assertions include actual revoked-session state during inference (no saved answer or final text delta), own/cross-user financial lookup, immutable money state, knowledge review status, real ticket persistence, budgets, idempotency, stale-lease recovery and successful same-message retry after a provider outage. These runs use fixture inference transport: they demonstrate protocol and persistence behavior, not live provider availability. They test server logic with the Admin SDK and do not establish client Firestore-rule enforcement or deployed index readiness.

The reviewer read `support-admin-tests.txt`: **7 tests passed, zero failed** in a real Firestore emulator. They cover role enforcement, endpoint/secret injection and bounds, missing provider activation refusal, knowledge approval/revision, command idempotency, revoked-session mutation denial, redacted/audited conversation views, resolved-ticket resume requirements and pagination beyond 50 records. This is local backend evidence, not hosted or physical-device acceptance.

Official documentation verified during review:

- https://ai.google.dev/api/generate-content — current request schema includes top-level `store`; `store:false` is supported and should not be removed based on older API assumptions.
- https://firebase.google.com/docs/functions/get-started — emulation and production deployment have different project-plan requirements.
- https://firebase.google.com/docs/functions/config-env — secrets must be explicitly bound to the consuming function.

No additional concrete cross-user or financial authorization bypass was found in the final scoped source checkpoint. Outstanding deployment/device evidence remains mandatory before describing the application as fully live.

## Root live verification added after source review

The root agent subsequently executed the actual HTTP handler using isolated Firebase Auth/Firestore emulators and real Gemini. `adam-live-http-161.json` records9/9PASS: authenticated capability, Arabic answer, English continuation, Turkish answer, withdrawal lookup without invented transaction, unauthenticated/password-only/cross-user rejection and real stored escalation ticket. `gemini-adapter-161.json` records actual native provider SSE/structured-output validation; `adam-identity-live-161.json` confirms honest automated identity when asked. These checks do not establish production deployment, physical Android acceptance, or incremental customer-token streaming.
