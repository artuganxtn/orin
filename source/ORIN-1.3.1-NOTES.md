# ORIN 1.3.1-preview — visual and chart refinement

Continue the same existing project, package com.orin.app, Android versionCode 6. Backup 1.3.0 was made before editing.
No stable Hosting, rules, billing or production account/financial data changed. Existing signing certificate retained.

## Changed
- Home no longer renders Symbol Overview with the duplicated asset name and TradingView date-range tabs.
- Home, Trade and market chart cards share app-owned timeframe controls. BTC/USD, ETH/USD, XRP/USD,
  SOL/USD, DOGE/USD and ADA/USD use public Coinbase Exchange ticker/stats/candles.
- Other assets retain official TradingView advanced charts, with top/sidebar/legend/date controls hidden
  by supported widget options. Attribution retained. ORIN does not pretend it receives their price telemetry.
- Native candles/line/area, High/Low/24h volume, MA9, EMA9, RSI14, MACD12/26/9 and BB20/2.
  Zoom, earlier/later bars, current-price line, OHLC crosshair, daily dates, user timezone and temporary trend line.
  4h candles aggregate actual hourly buckets; no candles are interpolated for missing trades.
- Loading/empty/offline/error/retry and quote timestamp/staleness. No fabricated production market fallback.
  Direct feed quotes refresh every 30 seconds, not a claim of exchange streaming execution.
- Restored original simple broad ring shape with richer layered blues; updated launcher/adaptive/web assets.
- Removed the ribbon animation and the forced 1900ms gate. Short restrained reveal during real initialization.
- Balance artwork placed in an explicit opposite grid column, with stronger blue gradients and restrained depth.
- Achievement grid: consistent cards, distinct icons, separate text/status and readable two-column mobile layout.
- Removed unused synthetic-candle generators and remaining user-facing simulation terminology.
  Existing demo funds remain explicitly demo/nonwithdrawable; no conversion into real money.
- New-account form defaults to real, without modifying any existing immutable type, number or balance.
- Real-account funding/wallet/privacy text no longer falsely describes it as a demo account.
  CSV ledger export now identifies the actual account type and number.
- Android update build now refuses to generate a replacement signing key if the original is missing.

## Verification
51 automated checks passed: 36 existing auth/account/security/program/UI tests, 5 chart/feed/indicator
checks (including rendering both languages/themes/styles), and 10 startup/UI/controller checks.
TypeScript and web build passed. APK signature/alignment and exact bundled web assets verified.
No connected Android device/emulator is available. Live market connectivity and device gestures were not
verified here. Local browser review is blocked by the available browser's URL policy; no screenshot is claimed.
The HTML review uses actual app components with clearly labeled illustrative quotes and zero-value fixture
accounts, and blocks all network requests. Fixture code is under tests/ and excluded from the production build.
The review file is an inspection aid, not evidence of live financial execution.

## Financial activation remains incomplete — do not hide it
Read ORIN-1.3.0-NOTES.md for existing server-authoritative program mechanics and exact eligibility boundaries.
Still required: the owner's selected regulated broker/execution integration, payment and reversal provider,
KYC/customer uniqueness provider, trusted backend provisioning, approved terms/settings and production UAT.
Current Spark app has no deployed program API URL; financial actions remain disabled. No automatic billing upgrade.
No real order execution/withdrawal adapter is claimed. Do not say the application is 100% complete.
Account type alone must never enable trading, payouts or funding. Existing legacy demo records stay distinct.

## Reproduce
Java 21 on PATH: scripts/test-refinement-131.sh. npm run build:firebase-spark.
Android build uses the existing SDK/JDK17 and original private signing files: python3 android-app/build.py.
Review HTML: node scripts/build-release-preview.mjs. Keep credentials and signing outside distribution archives.

## Source documentation used
https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles
https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart
