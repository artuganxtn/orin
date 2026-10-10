# ORIN Control Center — review checkpoint, 2026-10-04

This is an extension of the current ORIN project. It is a review build, not a production activation or a claim of 100% completion. The stable website, published rules, Firebase billing and customer balances were not changed during this work. No real notification was sent. Existing customer styles, navigation, logo and chart presentation were retained; market ordering now follows the administrative configuration. Program amounts in the customer UI follow configured amounts and existing grant snapshots.

## Delivered implementation

- `/admin` loads the isolated, lazy-loaded Control Center instead of the old broad-role dashboard. The backend determines staff access; an old `users.role=admin` is insufficient.
- 21 modules: Dashboard, Users, KYC, Accounts, Wallets, Deposits, Withdrawals, Approvals, Trading, Markets, Bonus, Referrals, Team, Agencies, Badges, Notifications, Content, Configuration, Security, Staff and Audit.
- Eight roles and 28 permissions in `lib/control-center.ts`. Separate Finance maker and Finance Approver; Super Admin cannot approve their own financial request. Support cannot read balances or private KYC documents. A permission matrix is included in the UI and the standalone permissions HTML.
- Server authorization, current staff status, verified email, revocation cutoff and recent authentication checks. High-risk operations require authentication within five minutes.
- Reasons, request IDs, transaction idempotency, optimistic revisions and central append-only audit records. Client rules deny writes to staff, audit, programs, protected configuration, payments and approval records.
- Real and demo accounts have independent unique 12-digit numbers and zero starting funds when created by the administrator. Changing an existing account number/type is not exposed.
- Balance adjustments are bounded by an explicitly configured limit, require two people, check reserved funds and current balance, and post a balanced ledger. A stale proposal cannot overwrite a changed balance. Proposer permissions are rechecked at approval.
- Referral payout: Pending → Qualified → Approved → Paid/Rejected, trusted evidence and distinct verified customer fingerprints, amount snapshot, two-person cash posting and no duplicate payout. Team payouts use finalized eligible net revenue and the historical L1–L6 configuration revision, with the relevant cap. Customer deposits are not used as the reward basis.
- Program configuration history is immutable. Changing entitlement settings requires a new terms version. Existing bonus grants retain their initial deposit threshold, eligible assets, amount, duration, profit cap and terms. Unspecified business terms remain unset. Defaults remain $100 welcome bonus, $80 qualified referral and $500 qualifying deposit.
- KYC request transitions and private document endpoint with document/request/user binding, recent authentication, read audit, no public URL or Firebase download token, exact private storage path and safe file types. The bucket must have uniform access and public access prevention enforced.
- Content drafts, plain-text previews, versioned publishing and app consumption for help/FAQ/terms/privacy/banner. No arbitrary HTML execution. Operational configuration is projected into a client-readable document without the private adjustment limit or secrets.
- Notification drafts, audience selection, scheduling and in-app delivery worker. Concurrent workers use leases and deterministic recipient IDs; retries do not duplicate delivery. Disabled/revoked publishers stop delivery. Push is explicitly unavailable.
- Staff invitations are registry records, accepted by the matching verified email after ordinary registration/sign-in. No invitation email is sent by this implementation. No shared staff password is generated. One role per staff member; only Super Admin assigns roles; self-role edits and removing the last Super Admin are blocked.
- CSV export is restricted to the current page and permitted fields, audited and protected against spreadsheet formula injection. Exact search by name, email, UID or account number; status filters and paginated tables. A global user search is included.
- Markets use the supported symbol registry, source identifiers, enabled state and configured order. No price-write or executed-trade-rewrite operation exists.

## Validation completed

- TypeScript check passes.
- Vite Spark web build and Firebase Functions build pass.
- 51 existing regression tests pass (36 application/program/rules tests + 15 chart/startup tests).
- 29 new Control Center tests pass, including every role/permission pair, unauthorized module reads, sensitive-field redaction, financial idempotency and dual approval, account restrictions, KYC, content publishing, notifications, historical rewards, market order, authenticated JSON transport and the existing owner profile loading under hardened rules.
- 3 additional tests pass against the minimal candidate derived from the last exported production rules.
- Total: 83 automated tests. Emulator tests are isolated from the production project. They do not validate a real payment, trading or KYC provider.
- No live browser screenshot or physical Android test was performed for this checkpoint. The earlier browser environment refused local previews; no alternate browser or bypass was used. The supplied standalone HTML renders the actual Control Center component with clearly marked isolated review fixtures and no network access.

## Remaining before daily production use

1. Provision and authorize the trusted backend. Production is still on the previously observed Spark setup; no billing upgrade was performed. Do not simply enable a frontend URL before deploying and validating the server/rules.
2. Integrate actual payment and broker providers. The payment queue can record a reviewed instruction, but a provider-specific worker, signature-verified callbacks, withdrawal reservations/settlement/reversals and reconciliation are not implemented. No transaction can be marked completed by a raw admin edit. The real execution feed is also unconnected.
3. Connect the KYC intake/provider and dedicated private bucket. An admin-reviewed KYC request does not itself create the uniqueness fingerprint needed for financial eligibility. Only the trusted provider ingestion boundary does that. Real document transfer has not been tested.
4. Supply and approve the business rules currently left blank: eligibility, activity periods, bonus expiry, eligible assets, profit limits, agency conditions and badge conditions. Do not substitute sample test values.
5. Bootstrap an actual Super Admin via owner IAM/ADC after hardened rules are live. The script is prepared but was not run against production; no production Super Admin was created in this session.
6. Complete operational integrations: provider price-health telemetry, suspicious-login/event ingestion, historical dashboard analytics, bulk/date-range report jobs, automatic evaluation of additional achievement criteria and Push delivery. Current dashboard counts refresh each minute; security shows recorded server events, and exports cover one current page. They are not represented as a complete monitoring/reporting service.
7. Perform visual, keyboard, mobile viewport and real device review with the supplied preview; then test a staging deployment with every role and real provider test environments before promoting.
8. Build the next APK with the original private signing key. The old SDK/signing symlinks target a scratch directory that is no longer present. They were not replaced, and no new key or APK was generated. The previous 1.3.1 APK is not an APK for this Control Center checkpoint. The current source's minimum-version notice applies after clients receive this integration; it cannot retrofit a check into an older distributed APK.

## Safe activation order

Read `firebase-control/DEPLOYMENT.md`. Do not delete `system/control-center` to roll back: doing so reopens legacy administrative authorization. There are no production secrets in this source or review package.
