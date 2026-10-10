# ORIN 1.5.4

See `ORIN-1.5.4-Status.txt` in the delivery for the exact activation and verification status.

This update fixes available-balance navigation, removes the floating support label, adds the home profile shortcut, recent transactions and an Arabic ORIN PDF statement, adds a real session-price sparkline, and extends registration with invitation code, password confirmation and a gated server email-code flow.

The statement consumes only the selected account's currently available ledger plus up to 20 payment requests from the existing provider endpoint. Its coverage is explicitly partial; it is not a complete all-time audited statement. Missing provider fees or blockchain IDs are not invented. No withdrawal API or fake money flows were added.

Email OTP requires separate backend deployment and verified mail sender; `firebase-functions/EMAIL-REGISTRATION.md` documents activation. The production APK does not pretend this service is active.

Build: `npm ci`, `bash scripts/test-release-154.sh`, `npm run build:firebase-spark`, `npm --prefix firebase-functions ci`, `npm --prefix firebase-functions run build`, `python3 android-app/build.py`. Android SDK and the existing private signing backup are required and intentionally excluded. Do not regenerate the update signing key.

The original chart files and main navigation component remain byte-identical to 1.5.3. This release is not yet accepted on a physical Android device: the emulator booted, but both APK installation attempts timed out before instrumentation could run.
