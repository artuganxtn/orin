# ORIN 1.5.0 — implementation and verification checkpoint

This is the original ORIN project, package `com.orin.app`, versionCode 8. Updates must use the existing signing key; never generate a replacement. No production Hosting, Firestore rules, billing, financial service, or AI activation has been performed.

## Customer changes

- Replaced the navigable market-overview iframe (whose `largeChartUrl` pointed to the application root) with React market rows and `/markets/{PAIR}` routes. History carries symbol/name/pair/market/available price; market filters remain mounted when opening details. Central SPA history handles ordinary internal anchors, authentication redirects and route aliases. Separate settings/legal/admin screens retain the customer workspace state.
- Market requests validate JSON and record actual HTTP/content-type/endpoint failures. AbortController deadlines work without the newer `AbortSignal.timeout` API. Failed native candles can use the official TradingView widget, preserving source attribution. Widget initialization is scoped to its own host/config, with cleanup, timeout, retry, offline/reconnect, source-validated messages and a local render boundary. A frame load does not certify live quotes; this limitation is visible in diagnostics.
- Branded introduction and onboarding precede authentication, with skip, sign-in/create-account and remembered completion. Authenticated users continue to the app.
- The balance shortcut now opens “دعوة صديق”. Real, immutable referral identities are separate from financial eligibility. Clipboard and sharing use bounded native Android actions when available. Attribution is captured without granting rewards. Counts/rewards/terms are server-owned and unavailable data is shown honestly.
- In-app support supports persisted messages, explicit queued/sending/failed/sent states, timestamps, reconnect, older history preserved across live refreshes, account-scoped outboxes and human follow-up. A separate staff conversation panel sends customer-visible replies. Internal ticket notes remain private. The transport and server-only assistant message type are ready for a future AI adapter; no AI response is fabricated.

## Activation boundary

The shipped Spark application uses Firestore for chat and public referral identity records. The new rules are **candidates**, not deployed. Until the owner approves deployment against a fresh export of the live rules, these new services can report unavailable and messages remain explicitly unsent. This is not a claim of active production support or rewards. Financial program activation still requires the already documented trusted backend and approved terms; Spark billing is unchanged.

`firebase-spark/engagement.rules.fragment` is the focused non-financial rules addition. Full source candidates are in `firebase-spark/firestore.rules` and `firebase-control/firestore.rules`. Do not replace live rules blindly. Export, merge, run the regression and authorization tests, review and deploy only the approved candidate. The rules require enabled accounts; staff messages require authorized, verified staff; clients cannot write assistant messages, financial summaries, rewards, or immutable ticket notes.

The existing trusted program backend adopts pre-existing referral identities and immutable signup attribution when enrollment is later enabled. `/api/referrals` is allowlisted in the optional program transport. It is not enabled in the production APK.

## Verification outcome

- 51 existing customer/startup/market/program regression results passed.
- 44 Control Center regression results passed.
- 8 new engagement authorization and persistence tests passed.
- 7 new navigation/network/deadline/cache/history/outbox tests passed.
- 1 referral identity-adoption test passed; the 9 existing program tests also passed on the final backend change.
- Total: 111 unique automated results passed (reruns are not double-counted).
- TypeScript, web build, server build and signed APK build passed.
- Android runtime acceptance is **blocked before application-route results**. The emulator booted but System UI showed an ANR; installs repeatedly timed out, and the harness session became unavailable before instrumentation results. No application route or physical-device test is claimed passed. See the separate Android test report.

## Android test setup

The local test harness is `../android-test/harness.py`. Commands are JSON files under `../android-test/requests`; results are recorded under `../android-test/results`. It launches an isolated local Android emulator and Firebase demo emulators in the same process network namespace. The source contains an Android instrumentation runner under `android-app/tests`; its test plan exercises onboarding, registration, asset routing, document preservation, bounded chart loading, chat send/receive/handoff, referral identity/copy/share and state preservation.

The QA APK has package `com.orin.qa`, uses `--mode android-qa` with Firebase emulators, and allows local test cleartext traffic. **Never deliver this APK as the customer release.** The release package remains `com.orin.app`, uses the production Firebase configuration, refuses mixed content, and contains no QA account or emulator endpoints. Test staff replies are restricted to the local `demo-orin-auth` project and the exact QA message.

Temporary SDK, AVD and WebView files now live under `/tmp/orin150-android-runtime` to avoid repeatedly syncing large VM images. Their official Google download URLs and hashes are preserved in the small JSON metadata under `../android-test`. API 30 image includes obsolete WebView 83; official WebView 124 and its Trichrome library were extracted from the verified Google API 35 system image for the test runtime. No KVM is available; earlier attempts hit slow boot, System UI ANRs and disk pressure. These are test-environment failures, not proof that the customer app passed Android validation.

## Release artifacts

Only use `deliverables/ORIN-Android-1.5.0.apk` from this source tree after final build and aapt/certificate verification. The QA directory has a similarly named APK; do not confuse them. Final delivery must include a verification report that states actual Android/provider coverage and any outstanding activation requirements. Exclude signing material, dependencies, SDK images, emulator state, raw tokens and temporary native test APKs from the review archive.

Final review APK SHA-256: `33b6def69240b46fb59fb7380ebba42b1c7bbed1415cb8da362edfddc0f4ef9f`. Acceptance is incomplete. Official WebView 124 was eventually installed and selected, but no successful application-route run was obtained. New production chat/referral rules remain undeployed.
