# ORIN 1.5.2 — asset card update and staged NOWPayments deposit integration

The user's 2026-10-05 request selects NOWPayments and authorizes payment integration. Do not ask again which gateway to use. The connected NOWPayments dashboard is available, has a payout wallet and existing masked API/IPN keys. No key was revealed, copied, regenerated or stored by this work; no wallet, payment, payout, callback or account setting was changed.

## Current blocker — real account access

The Firebase console at project `orin-99951` reports: **The project does not exist or you do not have permission to list apps in the project**. The Google session is for a different account from the owner email recorded in source. Ask the user to switch to the project's owner or an authorized deployer using the shared browser. Do not create a replacement project, change owner identifiers, weaken rules, upgrade billing or claim activation to bypass this blocker.

## Card changes

- Price and 24h statistics now load independently of chart candles and selected chart interval. Previously `Promise.all(ticker, stats, candles)` discarded the entire quote whenever the candle request failed.
- `lib/market-quote.ts` loads Coinbase's 24h statistics, validates values, shares requests, uses a bounded deadline and falls back to an exact USD Bitstamp ticker. Bitstamp's `open_24` is used, never its midnight `open`. Every snapshot retains its own exchange/source; USD is not replaced with USDT.
- The card shows asset name, price/currency, absolute and percentage 24h change, high/low in USD, base-asset volume, 24h range, opening price, source and update time. Loading/error/stale/offline states are local to the card, and unavailable data is never fabricated. A pair switch cannot show BTC units under ETH.
- App card styling and symbol selection are retained. `app/tradingview-widget.tsx`, `app/candle-chart.tsx` and `lib/live-market.ts` are byte-identical to 1.5.1.
- Direct server probes of BOTH public quote providers returned HTTP200 HTML instead of JSON in this environment. This is not evidence of correct device delivery. No live quote or Android UI pass is claimed. Before commercial publication confirm market-data provider permissions for the intended distribution (Bitstamp documents a commercial data license).

## Payment implementation — NOT deployed or activated

- Separate server-only `orinPayments` function and `VITE_ORIN_PAYMENTS_API_URL` transport, isolated from program/bonus activation. This build leaves the URL unset and keeps deposits unavailable.
- Server Secret Manager parameters: `ORIN_NOWPAYMENTS_API_KEY`, `ORIN_NOWPAYMENTS_IPN_SECRET`. No secrets belong in Vite variables, source ZIPs or APKs.
- Direct payment creation for USDT TRC20, USDT BEP20, BTC and ETH; real USD account ownership and verified email required; durable request idempotency, bounded creation rate and no automatic repost after uncertain response.
- IPN verifies canonical HMAC-SHA512 in constant time, then independently queries the provider. Order, currency, exact decimal amount and payment ID must match. Only an exact fully paid `finished` payment credits cash through the existing idempotent balanced ledger. Partial payments, overpayments and restricted accounts go to review. User redirects/assertions never credit funds.
- Duplicate callbacks cannot credit twice. Provider reversals after credit create a durable review/audit instead of silently rewriting cash. Manual status refresh has a server cooldown.
- Client form, payment network/address/amount, copy/select, status refresh and last 20 deposits are implemented; composite index is included in the Control Center index candidate. Financial collections remain server-only under default-deny rules.
- Confirmed deposit balance refresh invalidates the old Spark lab cache. The trusted deposit boundary checks disabled/suspended accounts inside the credit transaction.
- **Withdrawals remain inactive and the provider payout worker is not implemented.** No payout request or funds transfer was executed. Future payout work must preserve existing two-person approval, balance reservation, exact network/address, provider confirmation and reconciliation. Do not set `withdrawals:true` to bypass this.
- This implementation is a staging candidate, not full financial production acceptance. Deployment/credential configuration, live/sandbox provider acceptance, production indexes and Android acceptance remain.

## Verification

31 unique automated results passed: 7 quote adapter tests, 12 payment/emulator tests, 3 reference/UI tests, 9 existing financial-program regressions. Provider responses in tests are fixtures; no real money was sent. TypeScript, web build, server build and signed Android packaging passed. Signing v2/v3 and alignment, exact 88 bundled web assets, no signing secrets and original certificate verified. No physical/emulated Android UI acceptance was performed this turn.

APK: `com.orin.app`, version `1.5.2`, versionCode `10`, original signing certificate. SHA256 `46e96b4b0561d76b95b8fa5d54e457872f533492a71788347c4ca9d3361d7d2a`, 4,035,588 bytes.

## Continue after owner login

1. Verify the correct Firebase project and deployment authority; restore a secure CLI/Cloud Shell deployment path without reading passwords or session tokens. Check actual billing/hosting readiness; don't silently incur new charges.
2. Store the existing provider API/IPN secrets securely in the server secret store. Do not regenerate shared merchant keys without a concrete need. Do not ask for credentials in chat.
3. Export current live Firestore rules/indexes. Merge the focused chat/referral additions and required deposit index. Do not blindly replace live rules.
4. Deploy the payment function with deposits disabled first; validate callback authenticity, provider failures, actual account ownership, reconciliation, under/overpay and duplicate delivery against the provider. No real transfers without the required user action.
5. Implement and verify the remaining payout lifecycle. Expose actual readiness in all wallet views, then enable only tested server capabilities, set the public app endpoint and rebuild with the original signing key and a NEW versionCode.
6. Verify upgrade, card data and chart, real/demo separation, deposit lifecycle, support/referral and withdrawals on Android before calling the app final/fully activated.

Official references:
- https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-stats
- https://www.bitstamp.net/api/
- https://nowpayments.zendesk.com/hc/en-us/articles/21345824322717-API-and-endpoint-description
- https://nowpayments.zendesk.com/hc/en-us/articles/21395546303389-IPN-and-how-to-setup

All prior 1.5.1 limitations (chat/referral rule activation, general trusted backend, production Android acceptance) remain unless separately verified. No production deployment, financial transaction, rules change or billing change occurred in this update.
