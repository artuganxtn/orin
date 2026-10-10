# ORIN native device security — 1.6.0 implementation

This document describes implemented code, not a claim that it passed a physical-device acceptance test.

## Scope and boundary

`MainActivity` hosts bundled assets at `https://orin-99951.web.app`. It creates `NativeSecurity` before loading or restoring the WebView. Native views obscure financial content and the WebView becomes `INVISIBLE` while covered. Normal app screens permit screenshots as requested in 1.6.2. Native PIN dialogs still use Android `FLAG_SECURE`; Android 13+ recents screenshots remain explicitly disabled, and the app covers the WebView on pause.

A local PIN/biometric unlock protects the app display and local session credentials. It is not server 2FA, a refresh-token revocation mechanism, or authorization for a real withdrawal. Backend sensitive actions still require their own step-up policy.

## Account binding and bridge

The signed-in application must call `bindNativeAccount(uid)` before rendering any account data. In a native build, bridge initialization failure is blocking. Existing native account bindings are gated before any JavaScript runs. A fresh binding always requires a native PIN enrollment. Switching an unlocked account to another UID requires that account's own enrolled PIN (or new enrollment); switching while locked is rejected.

The narrow prompt bridge is injected with `evaluateJavascript` into the main frame. A random, per-document nonce remains in a closure. Native validates that nonce, the requesting URL, and current top-level owned HTTPS URL. No `addJavascriptInterface` is exported to frames. A cross-origin chart iframe cannot read the nonce or invoke the bridge. Mainframe navigation invalidates the previous capability. Same-origin application JavaScript is trusted code; XSS within this owned bundle remains inside that trust boundary and must be prevented by the web layer.

No PIN values ever enter JavaScript or a prompt request. Setup, verification, change and biometric enrollment are native UI. Basic device info includes manufacturer/model, Android version, app version; it does not collect serial, IMEI, MAC, advertising ID or GPS. This metadata is not proof of device trust.

`lib/native-security.ts` exposes actual status and native session-storage methods. Credentials are available only to the currently bound, unlocked account. Mutations while covered/locked are denied. Backend session access/refresh tokens and backend-issued trusted-device credentials are AES-GCM encrypted at rest. Trusted-device records survive session logout but never bypass native account binding/unlock; the backend must still verify their token, expiry and revocation. Deleting a local record does not substitute for server-side removal of trust. Session credentials are cleared on local signout; biometric protection supplements the display/credential gate, while PIN verification remains independent of device biometrics.

## Storage and PIN

`SecureState` stores one authenticated AES-256-GCM envelope in private app preferences. Its non-exportable master key is generated in Android Keystore. Each encryption obtains a new random GCM IV and binds fixed application/version AAD. Backup is disabled. Existing ciphertext that cannot be opened causes a blocking security screen: no automatic key regeneration/reset/unlock occurs. The status `hardwareBacked` reflects the actual key implementation; ORIN does not claim hardware backing on devices that provide software Keystore.

Each UID has a distinct 32-byte random PIN salt and PBKDF2-HMAC-SHA256 verifier (600,000 iterations, 256-bit result), inside the encrypted envelope. PINs are 6–12 numeric digits; Android/Arabic digit input is normalized natively. The verifier comparison uses `MessageDigest.isEqual`. Temporary character/key buffers are cleared, with the usual limits of managed-runtime memory. No PIN, secret, OTP, token, biometric or credential is logged.

The fifth failed PIN starts a 30-second penalty; subsequent failed attempts double it up to 15 minutes. The failure is committed before checking the PIN so process termination does not erase an attempt. The penalty is persisted with boot identity and monotonic time. A reboot restarts the outstanding full penalty, never clears it. PIN/timeout/biometric changes require native PIN reauthentication.

There is no offline PIN recovery bypass. A forgotten PIN requires a verified account-recovery/sign-in process outside this local gate; such a reset is not implemented by erasing the stored verifier automatically.

## Lifecycle rules

Default timeout is 300 seconds. Permitted settings are 0, 60, 300 and 900 seconds. Every `onPause` synchronously covers the app and writes the monotonic absence time plus Android boot count. `onResume` evaluates elapsed time before revealing the WebView. Under-threshold return restores the existing surface. At the threshold or later, a native lock is mandatory. A reboot, clock monotonic inconsistency, unavailable boot identity, or abrupt process death without a pause checkpoint fails closed.

A successful PIN or biometric result arriving while backgrounded does not unlock the app, erase the absence checkpoint, or resolve pending account binding. The user must authenticate in the foreground. Back is intercepted while covered/locked or verifying. The manifest exposes no custom deep-link financial destination; notification or external-navigation intent handling cannot remove this native gate.

## Biometrics

Android 9/API 28+ uses the platform `BiometricPrompt` with a `CryptoObject`. Android 11+ explicitly requests `BIOMETRIC_STRONG`; Android 9/10 CryptoObject authorization requires a strong Keystore-capable biometric. On Android 8, or without compatible enrolled biometrics, ORIN uses its PIN.

Enrollment first verifies the ORIN PIN. A per-UID AES-GCM key is generated in Android Keystore with user authentication required per operation (`duration=0` / legacy `-1`), and invalidation on biometric enrollment changes. Successful system biometric authorization encrypts a random credential. Unlock must perform the protected decrypt operation and compare its digest; a UI success callback without cryptographic proof never unlocks. No biometric templates, images or face data are stored by ORIN. Cancellation, invalidated keys, system lockout, unavailable sensors and failed proof retain PIN protection.

## Verification completed here

- All native Java compiled against Android SDK 35, minimum runtime API 26.
- Host-JVM tests execute real `LockPolicy` and `PinKdf`: 29 assertions cover exact timeout boundaries, process death, reboot, unknown boot identity, monotonic reversal, persistent penalty behavior, PIN constraints, PBKDF verification/salting and input-buffer clearing.
- These are not Android runtime, hardware Keystore or biometric tests.

## Mandatory physical-device acceptance gate — NOT RUN

No Android device/emulator was attached in this workspace. The release must not be described as fully validated until these checks are executed on compatible physical hardware:

1. Upgrade a logged-in previous ORIN installation; no financial information appears before first native PIN enrollment. Cancel enrollment, press Back, rotate, reopen, and attempt a notification route: enrollment stays required.
2. Select each timeout. Background until just before/exactly at/after its boundary. Check Android Home, screen-off, app switcher, full-screen external activity, document picker and share sheet. Confirm financial views never flash or appear in recents/accessibility while locked.
3. Kill the app process after a committed pause below/above its timeout, force-stop while foregrounded, reboot, change wall time/timezone and reopen. Expected policy above must hold.
4. Fail PIN five or more times. Kill/restart/reboot during penalty. Verify the timer cannot be cleared by clock changes and correct PIN remains rate-limited until allowed.
5. Background during the PBKDF or system biometric result. Return beyond threshold. Verify the asynchronous result did not clear the cover or checkpoint.
6. Enroll supported strong biometrics; successfully decrypt protected credential. Cancel, fail, reach biometric lockout, remove/add biometrics in system settings, then use ORIN PIN fallback and re-enroll.
7. Switch accounts with distinct PINs. Neither account's PIN, session credential, settings nor biometric key should unlock/read the other. Sign out clears the current encrypted backend token record.
8. Try top-level reload/navigation while PIN dialogs open; previous-page async results must not be emitted to a new document. Try prompt calls from a cross-origin iframe and calls without the nonce; all rejected.
9. Inspect app private storage with an authorized debug/test build. Verify no plaintext PIN/token and tampering with ciphertext leads to blocking failure. Do not log or export real user credentials during inspection.
10. On Android 8 verify native PIN fallback; on current Android check strong biometric prompt, keyboard/accessibility, RTL layout and standard Back gesture. Complete backend session revocation/2FA/step-up tests independently.

Official references used: Android BiometricPrompt/CryptoObject API, Android biometric-auth guide, SystemClock.elapsedRealtime, Settings.Global.BOOT_COUNT, Android secure-sensitive-activities guidance.
