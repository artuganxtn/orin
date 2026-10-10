# ORIN: internal contracts with virtual balances

## Latest local identity/navigation implementation

See `docs/ORIN-DESIGN-SYSTEM.md` for the additive Dark Mode, navigation, notifications and audio conventions, and `docs/ORIN-IMPLEMENTATION-STATUS.md` for the precise implemented/integration boundary. This revision adds migration `0003_orin_notification_identity.sql`, a server-owned inbox and confirmed in-app admin campaigns. It does not activate Firebase/APNs, native apps or unattended campaign scheduling. Production build, TypeScript and 34 tests pass. Original Light stylesheet/primary-mark hashes pass; full screenshot regression remains unverified because browser policy blocked the baseline capture. Publication remains blocked as described below.

This application is an explicitly disclosed training environment. It cannot receive cryptocurrency, transfer money, execute orders at a broker, or pay withdrawable returns. `XAUUSD`, `BTCUSD`, and `ETHUSD` on internal contracts are reference classifications. Internal settlement is independent of external market prices. The client sees locked settlement terms before participation. The home, market watchlist and order charts now use official TradingView embeds. No synthetic candles or calculated market prices are shown. Market prices never determine internal settlement.

## Implemented

- Private Site access and per-user identity through the platform's authenticated headers. No application login passwords. The first authenticated visitor to this owner-private Site initializes its administrator. Keep the Site private until administrator assignment and visitor access are reviewed for a wider audience.
- Server-side administrator authorization, eligibility, consent, timing, amount and balance checks.
- Published immutable contract terms, canonical JSON, SHA-256 hash, administrator ID, unique invitation code and timestamps.
- Separate participation window and participant-specific 60–300 second duration.
- Integer-cent calculations and basis-point settlement rates. Test limits are ±10% and amounts from $1 to $1,000,000, subject to available virtual balance.
- Atomic allocation with double-entry accounting; database journal validation enforces balance and nonnegative user accounts.
- Idempotent settlement with locked-result verification, a receipt, audit event and in-app result notification.
- Append-only audit and ledger entries protected by database triggers. These are application/database safeguards, not an independent external notarization or protection against the infrastructure owner.
- Per-user records, balance derived from posted ledger entries, CSV ledger export and printable/downloadable JSON settlement receipts.
- In-app notifications to eligible accounts, surfaced through polling. External mobile/web push is not connected. No claim of delivery when the app is closed.
- Official TradingView Symbol Overview, Advanced Chart and Market Overview widgets with provider-owned prices, candles, volume, drawing tools and attribution. BTC/ETH/XRP/SOL/BNB/DOGE/TON/ADA, forex, gold/silver and reference indices are allowlisted. Availability and data delay depend on each market/source. The old Coinbase API remains available as a bounded read-only endpoint; the main UI no longer relies on it.

## Settlement trigger in this staging deployment

The server owns all validation and settlement. The UI requests settlement at expiry and every eight seconds while open. Every modifying request also processes the signed-in user's overdue positions before acting. If the app is closed, overdue positions settle at the next request. Receipts distinguish contractual effective time from actual processing time. There is no always-running external scheduler or durable queue configured. Unattended background settlement and mobile push require a separate runtime/provider integration before claiming those capabilities.

## API

- `GET /api/lab`: returns the authenticated user's contracts, positions, receipts, posted journal entries and notifications. Administrators also receive audit events. Initializes a virtual-only account if needed.
- `POST /api/lab`: actions `accept`, `publish`, `join`, `settle`, `read`, and administrator-only `tier`. Requests require JSON and enforce same-origin when an Origin header is present. No mutation route updates/deletes a published contract.
- `GET /api/market?pair=BTC-USD&frame=15m` or `&range=1D`: fixed allowlisted public market-data sources and validated intervals; never executes orders.
- WebMCP `read_virtual_contract_workspace` and `stage_virtual_invitation`: feature-detected browser helpers. The staging helper only opens the existing contract details and cannot allocate balances or confirm participation.

## Database and tests

Drizzle schema and versioned migrations live in `db/schema.ts` and `drizzle/`. Compound append-only and balanced-journal triggers in `lib/invariants.ts` are installed atomically through D1 prepared statements before any account bootstrap. Initialization fails closed if a trigger cannot be installed. This preserves each compound SQL statement intact instead of relying on the hosting migration runner to split it. Cloudflare D1 queries are prepared and parameters are bound; related mutations run as a transactional D1 batch.

Run `node --experimental-strip-types tests/engine.test.mjs` and `node --experimental-strip-types tests/settings.test.mjs` with Node 24. The tests use SQLite and the actual migration files to exercise consent, permissions, locked terms, positive/negative/zero outcomes, exact cents, eligibility, timing, concurrent allocation, repeated requests, duplicate settlement, offline processing timestamps, per-user isolation, and database-enforced invariants.

This is a responsive web implementation. Native Android/iOS binaries are not part of this first staging release. No user money, payment secrets, wallet private keys, customer email list or device push tokens are collected.

## Visual identity

ORIN / أورين uses the user's blue/cyan and white reference, a generated transparent brand ring at `public/brand/orin-mark.png`, and locally hosted IBM Plex Sans Arabic (license bundled in `public/fonts/OFL.txt`). Account type, eligibility tier and administrator role are shown separately. Mobile navigation and all account disclosures remain available. UI redesign does not alter virtual ledger or settlement behavior.

The mobile composition follows the supplied three-screen reference: a blue balance hero with ring artwork, four quick actions, area-chart card and performance cards; a categorized market watchlist; and a candlestick/order screen with green/red direction buttons. Five-item bottom navigation has the central ORIN circle. The invited-contract tab shares the order screen with read-only Market/Limit views. Official TradingView indicators, fullscreen, account-synced favorites and symbol search are ORIN controls; custom drawing tools are not connected; monetary actions retain the existing server authorization and confirmation. Deposit/withdraw shortcuts explain that actual funding is unavailable. If TradingView cannot load, the UI shows a loading/error state with retry, never a synthetic price replacement. Internal locked results are displayed separately from the reference chart.

## October 2026 account and chart settings

The implementation uses the official TradingView Advanced Chart **Widget**, not the separately licensed Advanced Charts library. Only supported embed options are supplied. Required attribution and the in-chart TradingView logo remain visible. No account balances, invitation codes, user identifiers or settlement rates are passed to the chart provider.

### Implemented

- `GET/PATCH /api/settings`: authenticated account profile and preference synchronization. Separate `account_preferences` and `chart_preferences` tables; revision-based compare-and-swap protects cross-device edits. All profile/settings writes are audited without storing phone/email content in the audit payload.
- `GET/PATCH /api/markets/configuration`: public read-only display configuration and administrator-only writes. Separate singleton `market_configuration`, strict field/enum allowlists, default-symbol/timeframe/type validation, server enforcement, compare-and-swap and append-only audit. Clients refresh configuration every 20 seconds while visible, and on focus. Charts wait for a successful configuration load.
- Preferences for Arabic/English, RTL/LTR, light/dark/system, font size, number formatting, timezone, balance visibility, reduced motion, chart symbol/type/timeframe/grid, indicators and favorites. USD remains the actual virtual ledger denomination. Reference currency is stored as a preference, without invented FX conversion.
- Personal display name, phone and country are stored. Sign-in email and Client ID come from the authenticated identity and cannot be edited through the profile endpoint. Phone is explicitly unverified; KYC is explicitly not connected. Practice account type, eligibility tier and administrator role remain distinct.
- A confirmed account-closure request is durable and audited, preserves records and receipts, rejects active contracts, and prevents new allocation. This is a request workflow, not immediate data deletion.
- Per-event notification preferences are stored and enforced for the in-app feed. Invitation publication, contract start/end and settlement notices use real server events. Push/email/SMS controls are visibly unavailable because no delivery service is configured. Preferences for future deposit/withdrawal/referral/agent/support/security services do not imply those services exist.
- Clean TradingView candlesticks with official `hide_legend`, `hide_volume`, hidden top/side toolbars, custom ORIN timeframes, candle/line/area choices, soft grid, theme, timezone, and allowed MA/EMA/RSI/MACD/Bollinger studies. Current quote/axes, navigation and provider crosshair remain available inside the chart.
- Lazy-loaded chart module plus viewport-lazy embed creation. Timer ticks and unchanged preference/configuration polling do not recreate the widget. Fullscreen expands the existing chart element instead of mounting another chart. Device network loss is shown as unavailable; no synthetic replacement data is generated.
- ORIN symbol picker with search and favorites, constrained by the administrator's enabled symbols. Favorites synchronize through the authenticated backend.
- `POST /api/invitations/verify`: server-side eligibility and contract-integrity verification without allocation; code → details → amount → consent/confirmation → active internal contract. Clipboard paste and feature-detected QR scanning are provided. QR frames stay on-device; camera tracks stop on dismissal. Browsers without the QR API show an unavailable scanner.

### Explicit integration limits

- The public widget does **not** expose a market-data/quote API. ORIN cannot independently display or validate a last-tick timestamp, retain a numeric last-known quote outside the widget, calculate price alerts, or verify a healthy provider feed merely from iframe load. The provider chart controls its quote display and market connection; ORIN only detects device connectivity and embed loading errors. No fake “live” heartbeat is shown.
- Changing symbol/timeframe/theme/indicators recreates the public widget. In-place chart updates, a custom drawing API and cross-device drawing persistence require another approved integration and its data feed. No unsupported cross-origin manipulation or required-branding removal is implemented.
- Crosshair/price-line on/off, custom candle interaction tooltips, custom drawing tools, saved drawings and server-side price alerts are not connected. Their capability flags are false or their controls are read-only; the backend rejects unsupported activation.
- ORIN uses platform ChatGPT sign-in. App-owned passwords, TOTP, passkeys, biometric enrollment, recovery codes, trusted-device/session management and sign-out-all are not connected. The security center states this accurately and provides the real platform sign-out path for the current session. No fake security enrollment or login-history records are shown.
- Native Android/iOS applications, background push, KYC, external market execution and real-money funding remain outside this staging build. No Firebase project has been selected, configured or connected.

### Verification

- TypeScript check and production build pass.
- 14 financial-engine tests plus 11 settings/invitation tests pass. Tests cover isolation, admin permissions, unsupported capabilities, stale revisions, configuration/preference races, audit hashes, closure restrictions, notification filtering and invitation eligibility, along with the existing integer-cent ledger/settlement invariants.
- Local Cloudflare D1 smoke test passes with all migrations, settings persistence, configuration changes, immutable contracts, balanced settlement and retry safety.
- Browser checks: real BTC and XAU charts, hidden legend/OHLC/volume, rendered EMA, symbol search, allowed timeframes, fullscreen, Arabic/English direction, light/dark themes and saved device preferences after reload. Initial mobile settings layout inspected at 320px and 390px. Authenticated backend behavior is verified by the engine and D1 tests; the local browser has no platform sign-in identity and no authentication bypass was introduced.

### Publication status

This revision is **local and not deployed**. After the user's explicit permission to retry, automatic approval review again rejected elevated execution of the installed Sites source/publishing helper because its executable resides under `/root/.codex`. The previous ordinary execution attempt failed to connect to the source Git proxy. No manual push or alternate deployment bypass was used. The previous private Site deployment remains live. The source archive includes the new migration; it must be deployed through the authorized Sites workflow once that execution restriction is resolved.
