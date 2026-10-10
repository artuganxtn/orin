# Handoff notice — ORIN 1.6.2 / build20

Read `../START-HERE-AR.txt` at the package root first. This file contains historical notes; the dated current release and handoff guide take precedence. No production activation or physical-device acceptance is implied by an old release note.

---

# Current release: ORIN 1.5.3 / versionCode 11

Use `docs/RELEASE-1.5.3-AR.txt` for current validation and remaining blockers.
The original signing certificate and production WebView shell are unchanged.
The legacy notes below describe earlier checkpoints; they do not certify current Android runtime acceptance.

# ORIN Android — Spark 1.2.0

Signed universal APK (`com.orin.app`) for Android 8+. The original tested
Firebase Spark web bundle is included inside the APK, with the existing ORIN
launcher icons. It does not depend on the expiring Firebase preview URL.

Firebase Authentication and Firestore continue using `orin-99951`. The APK
loads its bundled content under the project's owned HTTPS origin; remote
Firebase SDK requests use normal TLS. Account creation, login, password reset,
profile/preferences, and authorized admin operations use the existing SDK and
server-enforced Firestore rules. Internet access is required for these services.
No Firebase credentials or admin keys are embedded.

Android back, persistent web storage, keyboard resizing and system insets are
handled by the native shell. Direct file/content URL access, cleartext traffic, WebView
debugging, third-party cookies, backups and JavaScript/native bridges are disabled.
Certificate errors are never bypassed. External HTTPS links open outside the app.
The system document picker grants access only to the image the user selects;
JSON/CSV exports use the system save dialog. No broad storage/media permission
is requested. Android 12+ uses the branded platform splash screen.
Version code is 3. The release uses the same signing certificate as 1.0.0 and 1.1.0, so
install it as an update without uninstalling the previous version.

## Build

1. `npm run build:firebase-spark`
2. Download the official Google Android SDK archives to `.android-build/`:
   - `https://dl.google.com/android/repository/platform-35_r02.zip`
     SHA1 `0bb560a90a7a2cbd0dd8348224d518b638fe7949`; extract under `platform/`.
   - `https://dl.google.com/android/repository/build-tools_r35_linux.zip`
     SHA1 `2cfaa0bbb2336e9ec18ed3ecea84fa2e2af607bc`; extract under `tools/`.
   These checksums were verified against Google's repository XML when downloaded.
3. Java 17 including the `jdk.compiler` module must be installed.
4. `python3 android-app/build.py`

The build requires the original private release key under `android-app/signing/`
and fails if it is absent. Restore and reuse the authorized signing backup;
never generate a replacement key, commit it, or put it inside the APK. Increment
the manifest versionCode for each distributed update. The current review source
is 1.4.0-preview / versionCode 7; an APK for this checkpoint has not been built
because the pinned SDK is not available. Older version descriptions above refer
to the historical 1.2.0 package, not a newly built APK.

## Verification and scope

The build verifies APK signature/alignment, archive integrity, and exact equality
of every bundled asset with the tested Spark build. `build/verification.json`
records the result and SHA256. No Android device/emulator is attached here, so an
on-device launch and production sign-in test remain to be done on the user's phone.

This release contains the Spark feature scope already explained to the owner.
Financial publication/reservation/settlement and server push/scheduling are not
provided without a trusted backend. No Blaze upgrade, billing changes, or live
Hosting replacement is performed. It is a sideload test release, not a Play Store
publication. Original app source and Cloud Functions source are preserved.

References: Android Developers — Load in-app content; apksigner; zipalign.
