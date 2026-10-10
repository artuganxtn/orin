# ORIN1.6.1 mini-history repair

The tiny chart remains separate from the main TradingView/candle implementation and its preferences. No fabricated market points or USDT→USD substitution.

Confirmed implementation defects repaired:
- Mini loader depended on Promise.any, and segment rendering on Array.at, without compatible implementations on all WebViews allowed by Android minSdk26. The mini now needs neither; root also repairs global compatibility.
- A first successful provider response with merely2points could win the race and remain cached15minutes, drawing a barely visible fraction of a day. We now require at least72actual closed samples spanning18hours; ordinary active USD pairs return96.
- A synchronous transport failure could settle before registration in the pending map, poisoning later retries. Request execution is now deferred until pending registration exists.
- Abort-only timeouts could remain unresolved for a transport/body that failed to react to abort. A real rejecting timeout now bounds both response and body to12seconds.
- After a full failure the UI waited60seconds before another attempt. It now automatically retries after2s,4s,8s up to60s, pauses while hidden/offline, and resumes on network/visibility changes. A valid curve is held for15minutes independently from live price ticks.
- The selected symbol is now explicit rather than derived from a possibly delayed ticker snapshot.

Network evidence from this execution environment,2026-10-06:
- Bitstamp BTC/USD: HTTP200, CORS*,96closed candles,6.712s.
- Kraken BTC/USD: HTTP200, CORS matching https://orin-99951.web.app,96closed candles after decoding,7.314s.
- Gemini BTC/USD: HTTP200, CORS matching ORIN,4.981s. Added as an independently documented exact-USD fallback for supported pairs. Millisecond timestamps and OHLC order normalized; newest row conservatively omitted as potentially open.
- Coinbase candle request: HTTP403 here. Existing independent sources are retained;403 is not assumed to reproduce on the user's network.
- Bitfinex returned403 here and was not added.

No CSP/connect-src limitation, serviceworker, blocked external-host allowlist, cleartext request or local-asset interception of these HTTPS providers was found in the app source/packagedHTML. Android has INTERNET permission and uses the owned HTTPS origin. The original decoder successfully decoded Bitstamp/Kraken responses obtained here; there is no evidence justifying a claim that those live payloads were malformed.

Visual: mini-only320×84plot, wider available line, soft green gradient and shape-preserving cubic curves through real turning points. Missing intervals remain gaps. This is a static24hour historical ribbon; no fast ticker animation.

Validation:6new focused tests,21existing release158/159 regressions; fullTypeScript check. Test fixtures are captured actual public responses. Simulated outages are used only in tests. Files provider-probe.json,alternate-probe.json,baseline-decode.json hold direct evidence. real-btc-history-preview.svg is generated from the captured Bitstamp prices, not a rising decorative trajectory.

No own-origin market relay was deployed, and no physicalAndroid network test is claimed. An internet path unable to reach every supported public provider still requires a reachable deployed market-data backend; the app does not silently fabricate data in that case.

Official provider references:
https://www.bitstamp.net/api/
https://docs.kraken.com/api/docs/rest-api/get-ohlc-data
https://developer.gemini.com/rest/market-data
