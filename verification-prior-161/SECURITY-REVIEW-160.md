# ORIN 1.6 security review checkpoint

Scope: independent source review of Android application lock, account-security service, client security/login flow, strict Firestore candidate and existing backend entry points. Production code was not edited by the reviewer. This is not real-device acceptance or a deployment certificate. The implementation was still changing during review.

## Architectural release limits

1. **Firebase Auth has its own credential mutation API.** ORIN TOTP, session rules and ORIN step-up grants protect ORIN resources, but cannot by themselves prevent a freshly password-authenticated caller from using Firebase Auth `accounts:update` directly to change their password. Removing the application's direct `updatePassword` UI path does not remove the provider API. End-to-end provider-level MFA/password-change enforcement requires a supported provider policy or an authentication authority that owns this operation. Do not claim complete enforcement of this requirement with only custom application MFA.
2. **Wrong-password audit events are not captured by the ORIN service.** Password verification currently occurs directly at Firebase. ORIN can authoritatively log its own second-factor and passkey failures, but must not manufacture provider password-failure history. Provider audit integration or a suitable authentication gateway is needed for complete events.
3. **Reliable client IP needs verified ingress configuration.** The raw TCP peer behind Cloud Functions may be a proxy. The revised service must not present that peer as the customer's IP or collapse all customers into an unknown/proxy-IP rate-limit bucket. IP-derived city/country also needs a verified local GeoIP database or a service. No GPS location should be substituted.
4. **Runtime proof is outstanding.** No physical Android device was used by this reviewer. Code inspection and emulator/unit tests do not prove device biometric prompts, foreground/background transitions, process recreation, notification/deep-link handling or browser passkey interoperability on real hardware.

## Concrete issues identified and assigned

| Issue | Owner / checkpoint |
| --- | --- |
| Protected non-security APIs accepted a plain Firebase password ID token, bypassing custom MFA and individual revocation | Root added `store.identity` session guard and transport header propagation; strict Firestore candidate also requires server-owned session and epoch. |
| Client security endpoint pointed at `orinApi` rather than `orinSecurity`; error enums and event names differed | UI/backend agents aligned endpoint, explicit session errors and canonical event labels. |
| Trusted-device token was discarded and proof had no policy effect | UI now stores scoped proof; backend implements remembered-device primary-login policy and revokes sessions derived from removed trust. |
| Firebase provider revocation/password reset could be bypassed by minting a fresh custom token from an old ORIN refresh credential | Backend now binds sessions to the provider revocation baseline and rejects a changed baseline. |
| An outstanding password-before-MFA challenge survived a provider password reset | Backend now preserves and checks the primary proof's provider baseline at challenge completion. |
| Credential enrollment/final passkey writes could finish after concurrent session revocation | Backend added transaction-time active-session/epoch checks to protected final writes. |
| PIN KDF callback completed in background and could erase absence checkpoint | Native unlock now checks foreground state before clearing checkpoint/uncovering. Root had independently identified this issue. |
| Immediate access-token rotation invalidates legitimate in-flight requests | Rechecked revised code: prior access hash is accepted for at most 30 seconds, capped by its original expiry, while active-session/epoch/provider checks still apply. The UI now polls state and refreshes near access expiry. Executable overlap tests remain owned by the backend agent. |
| Existing admin `security.revoke` used only the older cutoff/provider revoke and did not immediately invalidate strict Firestore session state | Rechecked root's change: admin revocation reads the security profile before writes and increments its epoch in the same Firestore transaction. This takes effect even if the later provider revoke call fails. |

## Final bootstrap and passkey source check

- Anonymous passkey endpoints are callable without an existing Firebase user; successful custom-token exchange is verified against the expected account before authenticated bootstrap proceeds.
- Registration and authenticated bootstrap create/read the user profile only after the native/backend gate completes. The strict rule candidate requires the server-owned session and matching epoch before protected reads.
- Restored sessions go through server refresh when loaded from persistent storage. Provider-cutoff, session-state and epoch checks apply. A rejected restore does not authorize protected data.
- Passkey authentication requires authenticator user verification, expected challenge, expected origin and relying-party ID. Credential revocation/counter is checked again in the final transaction. Private keys are not sent to the service.
- No additional concrete authorization bypass was identified in this final scoped check. This statement is limited to source review of the implementation checkpoint, not a guarantee of complete security or hardware interoperability.

## Reviewer validation limits

The review used source evidence and official provider documentation. Other agents own executable tests and should report their exact results independently. No production credentials, customer data or real-money transaction was used by this reviewer. This note must not be presented as proof of full deployment or device acceptance.

Official references checked:

- https://firebase.google.com/docs/reference/rest/auth#section-change-password — password update accepts a Firebase ID token through the provider API.
- https://firebase.google.com/docs/auth/admin/manage-sessions — provider password resets revoke Firebase tokens; the provider exposes its revocation cutoff through `tokensValidAfterTime`.
