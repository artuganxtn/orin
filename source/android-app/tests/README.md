# Handoff notice — ORIN 1.6.2 / build20

Read `../START-HERE-AR.txt` at the package root first. This file contains historical notes; the dated current release and handoff guide take precedence. No production activation or physical-device acceptance is implied by an old release note.

---

# Android runtime acceptance — ORIN 1.5.1

The instrumentation runner operates the actual Android WebView with native touch and Back events. It records screenshots and checks that `performance.timeOrigin` is preserved across navigation. It is a separate, test-only APK targeting `com.orin.qa`, never the production package.

Run the Node/Firebase checks with Java 21 and `scripts/test-release-150.sh`. Existing regression gates remain `scripts/test-refinement-131.sh` and `scripts/test-control-center.sh`.

For Android QA:

1. Use an Android emulator with a current Android System WebView and a reachable local Firebase demo project. Hardware acceleration is strongly preferable. Record Android and WebView versions before execution.
2. Build test assets using `VITE_FIREBASE_SPARK=true VITE_FIREBASE_EMULATORS=true vite build --mode android-qa --config firebase-app/vite.config.mts --outDir ../android-qa-dist`. This mode is explicitly guarded. Normal release builds eliminate emulator configuration.
3. Use a separate copy of the native shell under package `com.orin.qa`, with only that test shell permitting HTTP and mixed content for localhost. Point its `firebase-spark-dist` to the QA output, then build it. Do not alter the production manifest, Java source, output or signing policy. Preserve the existing signing key.
4. Start Auth (9099) and Firestore (8080) for `demo-orin-auth`, using a copy of the candidate control rules. Start `firebase-functions/qa-support-worker.mjs` in that same isolated namespace. It refuses a non-demo project. Reverse both ports with ADB.
5. Compile the runner with `python3 android-app/tests/build.py`, install the QA app and runner, then execute `adb shell am instrument -w -e plan plan.json com.orin.tests/com.orin.tests.OrinInstrumentation`.
6. Retrieve `adb exec-out run-as com.orin.tests cat files/results.json` and files in `files/screens`. Inspect each screenshot. An ADB exit code alone is not a pass: inspect assertion results and the instrumentation failure count.

`plan.json` exercises onboarding, registration, BTC loading, ETH navigation and state preservation, gold symbol, support send/receive/handoff, referral code/copy/share and document preservation. Provider availability checks may fail in restricted networks and must be reported separately. Full release acceptance also needs actual network disconnection/reconnection, relaunch with onboarding remembered, upgrade with the original signature, and the exact production APK on a stable Android runtime. Those additional cases are not claimed passed by the plan alone.

No Firebase emulator credentials or test-only native settings may appear in the production APK. The current 1.5.1 review report records the actual runtime outcome; do not infer success from runner source or build success.
