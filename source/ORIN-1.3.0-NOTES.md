# ORIN 1.3.0 preview — continue the existing project

This is a review build copied from 1.2.1, not a replacement project or a live deployment.
Firebase project: orin-99951. Keep the existing Android Java/WebView shell and signing key.
Do not deploy Hosting or change the Spark plan until the owner has reviewed the preview.

## Implemented in the preview build

- Same navigation, charts placement and balance-card structure; a smaller opposite-side ring.
- New transparent 3D ring, launcher/adaptive assets and a short SVG/CSS formation animation.
- Theme-aware startup, login and app; native system-bar appearance follows saved settings.
- Latin digits and display normalization for legacy notification text; only real/demo account labels.
- Stable existing account numbers, active-account scoped balances/positions/receipts/ledger; stale responses guarded.
- Native BTC/USD candle view using the existing Coinbase Exchange data integration, with real quote validation,
  sorted/deduplicated OHLC, 4h aggregation, timestamps and honest error/empty/offline states.
  TradingView remains for the other supported assets, indicators and chart styles, with Latin digits.
- Reordered settings with version inside About. Additional program pages use existing theme tokens.
- Referral code/link/QR/share, tree, explicit reward states, exact agreed L1–L6 table, agency, badges, bonus
  breakdown and first qualifying $500 deposit progress. These are inactive on Spark without a trusted backend.

## Server source and boundaries

`firebase-functions/src/programs.ts` contains authenticated user/admin actions, configuration, ledger reads,
transactional idempotency, unique codes, immutable referral ancestry, agency grants and evidence-based badges.
`program-ingestion.ts` is NOT an HTTP endpoint. Only signed, finalized provider adapters may call it.
The owner has not supplied payment/broker/KYC providers. No live adapters, trading execution, withdrawal engine,
chargeback/reversal workflow or production fraud monitoring are claimed to exist.
The source prepares bounded program mechanics; it is not a complete, production-ready financial platform.

All new program collections inherit deny-all client rules, including for administrators.
Only Admin SDK transactions can change cash/bonus/profits/rewards, verification, roles and evidence.
No financial data was written to production during this update.

$100 principal stays nonwithdrawable; verified net profit is separate. Separate deposits below $500 are
not accumulated to unlock profits. A single eligible confirmed deposit >= $500 unlocks eligible bonus profit.
Deposits remain customer cash. The $80 direct referral reward requires independent verified customers,
trusted qualification evidence and an explicit reviewed payment, with exactly-once posting.
Team rewards use finalized eligible net ORIN revenue and the agreed level cap, never deposits.
Test-only dates, terms and limits occur solely in emulator fixtures, not production defaults.

Duration, eligible assets, profit cap, trading terms, qualification, activity period/criteria, agency and
advanced badge criteria remain unset. The entire program refuses activation until required terms are approved.

## Future activation — do not do this automatically

1. Approve eligibility, activity period, bonus duration/assets/profit limits and trading terms with the owner.
2. Provision a trusted backend without silently changing billing; current Firebase project is Spark.
3. Connect verified KYC/customer fingerprinting, payment confirmation/reversal, broker settlement and fraud review.
4. Maintain private server evidence, active-team aggregates and finalized period revenue snapshots.
5. Deploy tested function/indexes in an isolated environment; validate auth, CORS, replay protection and provider signatures.
6. Only then set VITE_ORIN_PROGRAM_API_URL to the allowlisted ORIN function URL at build time.
   The preview APK has NO such URL and returns an explicit inactive status for program actions.
7. Review preview and medium Android device results before promoting web Hosting or a stable APK.

## Validation

36 tests passed: existing auth/accounts/rules/UI plus account scoping, Latin digits, tier progress, quote parsing,
transactional claims, first qualifying deposit, duplicate customers, referral status transitions, exactly-once
payments, agency permissions, evidence-gated badges, revenue caps, balanced ledgers and owned-account history.
8 security checks also passed against the exact currently published Firestore rules snapshot.
TypeScript, web build, backend build and signed Android build passed. APK payload/signature verified.
No connected Android device/emulator was available. Live market provider access was blocked in this execution
network. Browser access to the local preview was unavailable in this session; no live UI screenshot is claimed.
The HTML preview runs local fixture accounts at $0, with outbound requests blocked and no production credentials.
It is an interactive review aid, not a live financial service or an end-to-end test result.

Reproduce: Java 21 on PATH, then scripts/test-release-130.sh. Android compilation uses the existing Java/SDK
configuration. Assert existing private signing/orin-release.p12 and store-password.txt before build; never generate
a replacement key. scripts/build-release-preview.mjs generates the standalone review artifact.
