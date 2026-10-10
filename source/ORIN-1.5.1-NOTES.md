# ORIN 1.5.1 — UI complete, live activation blocked

The 2026-10-05 user request explicitly authorizes activation. Do not ask for the same permission again merely because an older checkpoint said owner approval was outstanding. The blockers now are deployment access, a valid application test login, and an identified/configured payment provider. Existing integrity, identity and financial authorization checks still apply.

## Delivered source changes

- The public TradingView embed uses its documented `hide_legend: true` option. Series/price/indicator legend text is hidden inside the widget while provider attribution remains. Native charts also omit their visual indicator legend, retaining indicator calculations and controls.
- The selected symbol/name is displayed as an application-owned faded backdrop outside the chart canvas. Asset selection and navigation remain unchanged.
- An accessible floating support launcher is mounted outside the inert application shell, above bottom navigation and account pages. It is hidden in the chat itself, when the workspace is inactive, with the software keyboard, and in chart fullscreen. It opens the existing internal conversation.
- Onboarding is redesigned as three dark ORIN scenes with teal accents, account/market/support illustrations, progress controls and create-account/sign-in actions. The existing remembered-completion key is preserved. Illustrations are decorative and contain no fabricated account balance or live price.
- Referral identity and summary failures are separated. A code is shown only after actual authenticated Firestore persistence. Failure to read statistics preserves the verified code, shows statistics unavailable, and logs the real error. Identity permission failures still fail explicitly; no fake/local code is created. Reconnect retries and contact-support actions are present.
- Native packaging uses the current Vite manifest to exclude stale hashed chunks copied from previous builds.

## Verified findings and remaining work

`firebase projects:list --non-interactive --json` failed with "Failed to authenticate". The CLI has no authenticated deployment account or application-default service credential. The supplied test login was read privately and tested once against the project's Firebase Auth endpoint; it returned HTTP400 / INVALID_LOGIN_CREDENTIALS. Secrets were not logged, packaged or used for other services. The configured Functions health endpoint returned HTTP404. No payment provider credentials or deposit/payout adapter are configured in this project.

Therefore no production rules, Hosting, backend, balances, financial flags, billing or AI were changed. Deposits/withdrawals remain unavailable. Existing real/demo account distinctions remain truthful. The user requested a final activated app; this requirement is not satisfied and the APK must not be represented as fully activated or fully accepted.

To continue: connect authorized Firebase deployment access and a valid test identity; identify the payment processor and provision its protected server-side configuration. Export current rules, merge the tested referral/chat addition, deploy the exact reviewed rules, and validate with the test user. Implement and verify the chosen provider's deposit confirmations, payout lifecycle and reconciliation before enabling real funding. Never replace provider confirmation with a client assertion or an arbitrary enabled flag. Do not put payment secrets in the APK.

13 focused automated results passed: 8 existing engagement/rules tests, 3 new referral partial-failure/identity-authorization tests, and 2 existing account/reference UI tests. TypeScript, web, server and signed APK builds passed. Android UI acceptance is not claimed: the previous software-emulator attempt failed with System UI ANR and installation timeouts; no stable Android runtime has since been verified. The instrumentation source is updated for the new onboarding and launcher, but a test plan is not evidence of execution.

Build identity: com.orin.app, versionName1.5.1, versionCode9, existing signing key. APK SHA256 and current evidence are in the companion verification report. Keep signing material and the private input file out of all shared deliverables.

Official widget option: https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart
Firebase deployment authentication: https://firebase.google.com/docs/cli
Current Functions provisioning requirements: https://firebase.google.com/docs/functions/get-started
