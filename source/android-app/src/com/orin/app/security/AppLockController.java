package com.orin.app.security;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ScrollView;
import java.util.Locale;
import java.util.UUID;

/**
 * Native privacy gate after more than fifteen minutes outside ORIN.
 * Authentication is performed only by Android; this class stores no biometric/PIN data.
 * This is independent of server authentication and the existing ORIN security bridge.
 */
public final class AppLockController {
    private static final long ABSENCE_LIMIT_MS = 15L * 60L * 1000L;
    private static final int CONFIRM_DEVICE_REQUEST = 16215;
    private static final String PROCESS_TOKEN = UUID.randomUUID().toString();
    // SharedPreferences may update its memory cache even when the disk write fails.
    private static boolean persistenceFailed;
    private static final String SAVED_PROCESS = "orin.deviceGate.process";
    private static final String SAVED_CREDENTIAL = "orin.deviceGate.credential";
    private final Activity activity;
    private final WebView web;
    private final SharedPreferences preferences;
    private final KeyguardManager keyguard;
    private final Runnable onReady;
    private final LinearLayout cover;
    private final ScrollView overlay;
    private final TextView explanation;
    private final Button unlockButton, credentialButton, settingsButton;
    private final boolean arabic;
    private boolean resumed, destroyed, locked, covered = true, storageFailure;
    private boolean authenticating, credentialInFlight, suppressAutomaticPrompt;
    private boolean pendingSuccess;
    private long pendingSuccessAt;
    private int attempt;
    private long pausedAt = -1;
    private CancellationSignal cancellation;

    public AppLockController(Activity activity, WebView web, FrameLayout root,
            boolean dark, Bundle savedState, Runnable onReady) {
        this.activity = activity;
        this.web = web;
        this.onReady = onReady;
        this.preferences = activity.getSharedPreferences("orin_system_app_lock_v1", Context.MODE_PRIVATE);
        this.keyguard = (KeyguardManager) activity.getSystemService(Context.KEYGUARD_SERVICE);
        this.arabic = "ar".equals(Locale.getDefault().getLanguage());
        this.storageFailure = persistenceFailed;
        this.locked = storageFailure || preferences.getBoolean("locked", false);
        if (preferences.getBoolean("initialized", false)) {
            String phase = preferences.getString("phase", "unknown");
            boolean sameProcess = PROCESS_TOKEN.equals(preferences.getString("process", ""));
            // A new process with no completed background checkpoint cannot prove absence duration.
            if (!sameProcess && !"background".equals(phase)) locked = true;
            if (("background".equals(phase) || "paused".equals(phase)) && absenceExpired()) locked = true;
            if ("paused".equals(phase) && sameProcess) pausedAt = preferences.getLong("leftAt", -1);
        }
        // Preserve only an outstanding Android credential UI across same-process recreation.
        credentialInFlight = savedState != null
            && PROCESS_TOKEN.equals(savedState.getString(SAVED_PROCESS))
            && savedState.getBoolean(SAVED_CREDENTIAL, false);
        authenticating = credentialInFlight;

        overlay = new ScrollView(activity);
        overlay.setFillViewport(true);
        overlay.setBackgroundColor(dark ? Color.rgb(6,17,31) : Color.rgb(237,244,255));
        cover = new LinearLayout(activity);
        cover.setOrientation(LinearLayout.VERTICAL);
        cover.setGravity(Gravity.CENTER);
        cover.setPadding(dp(28), dp(28), dp(28), dp(28));
        cover.setBackgroundColor(dark ? Color.rgb(6,17,31) : Color.rgb(237,244,255));
        cover.setClickable(true);
        cover.setFocusable(true);
        cover.setFocusableInTouchMode(true);
        TextView title = new TextView(activity);
        title.setText("ORIN");
        title.setTextSize(28);
        title.setGravity(Gravity.CENTER);
        title.setTextColor(dark ? Color.WHITE : Color.rgb(6,17,31));
        cover.addView(title, new LinearLayout.LayoutParams(-1, -2));
        explanation = new TextView(activity);
        explanation.setTextSize(16);
        explanation.setGravity(Gravity.CENTER);
        explanation.setTextColor(dark ? Color.WHITE : Color.rgb(6,17,31));
        LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(-1, -2);
        textParams.topMargin = dp(22);
        cover.addView(explanation, textParams);
        unlockButton = addButton(text("فتح بقفل الجهاز", "Unlock with device security"));
        unlockButton.setOnClickListener(view -> authenticate());
        credentialButton = addButton(text("استخدام رمز قفل الجهاز", "Use device PIN, pattern or password"));
        credentialButton.setOnClickListener(view -> {
            if (resumed && locked && !authenticating) launchDeviceCredential();
        });
        settingsButton = addButton(text("إعداد قفل الشاشة في Android", "Set up Android screen lock"));
        settingsButton.setOnClickListener(view -> {
            // Only opens Android's settings after an explicit tap; it never changes them.
            try { activity.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS)); }
            catch (Exception unavailable) {
                setExplanation(text("افتح إعدادات Android ثم الأمان وقفل الشاشة.",
                    "Open Android Settings, then Security and Screen lock."));
            }
        });
        overlay.addView(cover, new ScrollView.LayoutParams(-1, -1));
        root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
        showCover();
        updateCover(null);
        if (locked) persistLocked();
    }

    private int dp(int n) { return (int) (n * activity.getResources().getDisplayMetrics().density + .5f); }
    private String text(String ar, String en) { return arabic ? ar : en; }
    private Button addButton(String label) {
        Button button = new Button(activity);
        button.setText(label);
        button.setAllCaps(false);
        button.setFilterTouchesWhenObscured(true);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(14);
        cover.addView(button, params);
        return button;
    }
    private int bootCount() {
        try { return Settings.Global.getInt(activity.getContentResolver(), Settings.Global.BOOT_COUNT); }
        catch (Exception unavailable) { return -1; }
    }
    private boolean secureDevice() {
        try { return keyguard != null && keyguard.isDeviceSecure(); }
        catch (Exception unavailable) { return false; }
    }
    private boolean absenceExpired() {
        long leftAt = preferences.getLong("leftAt", -1);
        long now = SystemClock.elapsedRealtime();
        int previousBoot = preferences.getInt("boot", -1), currentBoot = bootCount();
        return leftAt < 0 || previousBoot < 0 || currentBoot < 0 || previousBoot != currentBoot
            || now < leftAt || now - leftAt > ABSENCE_LIMIT_MS;
    }
    private boolean commit(SharedPreferences.Editor editor) {
        boolean written;
        try { written = editor.commit(); } catch (RuntimeException failure) { written = false; }
        if (!written) { persistenceFailed = true; storageFailure = true; locked = true; }
        return written;
    }
    private void persistLocked() {
        commit(preferences.edit().putBoolean("initialized", true).putBoolean("locked", true));
    }
    private void requireLockIfExpired() {
        if (!locked && "background".equals(preferences.getString("phase", "")) && absenceExpired()) {
            locked = true;
            persistLocked();
            showCover();
        }
    }
    private void showCover() {
        covered = true;
        web.setVisibility(View.INVISIBLE);
        web.setEnabled(false);
        web.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        overlay.setVisibility(View.VISIBLE);
        overlay.bringToFront();
        cover.requestFocus();
    }
    private void revealContent() {
        if (!resumed || locked || destroyed || storageFailure) return;
        covered = false;
        overlay.setVisibility(View.GONE);
        web.setEnabled(true);
        web.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
        web.setVisibility(View.VISIBLE);
        onReady.run();
    }
    private void setExplanation(String message) { explanation.setText(message); }
    private void updateCover(String detail) {
        boolean secure = secureDevice();
        if (storageFailure) {
            setExplanation(text("تعذر حفظ حالة الحماية. أغلق التطبيق وافتحه مجددًا؛ لم يُفتح المحتوى.",
                "The lock state could not be saved. Close and reopen ORIN; content remains locked."));
        } else if (!secure && locked) {
            setExplanation(text("يلزم إعداد قفل شاشة آمن في Android أولًا. لا يمكن تأمين الفتح بالبصمة دون قفل الجهاز.",
                "Set up a secure Android screen lock first. ORIN cannot verify you without device security."));
        } else {
            setExplanation(detail != null ? detail : text(
                "للعودة إلى ORIN بعد غيابك، أكّد هويتك ببصمة Android أو رمز قفل الجهاز.",
                "To return to ORIN after being away, verify with Android biometrics or your device screen lock."));
        }
        unlockButton.setEnabled(locked && secure && !authenticating && !storageFailure);
        credentialButton.setVisibility(locked && secure ? View.VISIBLE : View.GONE);
        credentialButton.setEnabled(locked && secure && !authenticating && !storageFailure);
        settingsButton.setVisibility(locked && !secure ? View.VISIBLE : View.GONE);
    }

    /** Cover immediately, but do not start an active-use/inactivity timer. */
    public void onPause() {
        resumed = false;
        showCover();
        if (locked) { persistLocked(); return; }
        pausedAt = SystemClock.elapsedRealtime();
        commit(preferences.edit().putBoolean("initialized", true).putBoolean("locked", false)
            .putString("process", PROCESS_TOKEN).putString("phase", "paused")
            .putLong("leftAt", pausedAt).putInt("boot", bootCount()));
    }
    /** Only a genuinely stopped activity starts the fifteen-minute background checkpoint. */
    public void onStop(boolean changingConfigurations) {
        if (changingConfigurations || locked || authenticating) return;
        long leftAt = pausedAt >= 0 ? pausedAt : SystemClock.elapsedRealtime();
        commit(preferences.edit().putBoolean("initialized", true).putBoolean("locked", false)
            .putString("process", PROCESS_TOKEN).putString("phase", "background")
            .putLong("leftAt", leftAt).putInt("boot", bootCount()));
    }
    public void onResume() {
        if (destroyed) return;
        resumed = true;
        requireLockIfExpired();
        if (pendingSuccess) {
            long now = SystemClock.elapsedRealtime();
            // This success exists only in RAM in this process; it cannot survive a reboot.
            boolean fresh = now >= pendingSuccessAt && now - pendingSuccessAt <= ABSENCE_LIMIT_MS;
            pendingSuccess = false;
            if (fresh && secureDevice()) finishUnlock();
        }
        if (!locked && !storageFailure) {
            if (commit(preferences.edit().putBoolean("initialized", true).putBoolean("locked", false)
                    .putString("process", PROCESS_TOKEN).putString("phase", "foreground")
                    .remove("leftAt").remove("boot"))) { pausedAt = -1; revealContent(); }
        }
        if (locked) {
            persistLocked();
            showCover();
            updateCover(null);
            if (suppressAutomaticPrompt) suppressAutomaticPrompt = false;
            else cover.post(() -> { if (resumed && locked && !destroyed) authenticate(); });
        }
    }
    public void onSaveInstanceState(Bundle state) {
        state.putString(SAVED_PROCESS, PROCESS_TOKEN);
        state.putBoolean(SAVED_CREDENTIAL, credentialInFlight);
    }
    /** External picker results must not disclose/export content after an expired absence. */
    public boolean requiresAuthentication() { requireLockIfExpired(); return locked || storageFailure; }
    public boolean blocksInteraction() { return requiresAuthentication() || !resumed || covered; }
    public boolean interceptBack() {
        if (!requiresAuthentication()) return false;
        activity.moveTaskToBack(true);
        return true;
    }

    private void authenticate() {
        if (!resumed || destroyed || !locked || authenticating || storageFailure) return;
        if (!secureDevice()) { updateCover(null); return; }
        if (Build.VERSION.SDK_INT < 28) { launchDeviceCredential(); return; }
        startBiometricPrompt();
    }
    @android.annotation.TargetApi(28)
    private void startBiometricPrompt() {
        final int currentAttempt = ++attempt;
        authenticating = true;
        credentialInFlight = false;
        cancellation = new CancellationSignal();
        updateCover(null);
        try {
            BiometricPrompt.Builder builder = new BiometricPrompt.Builder(activity)
                .setTitle(text("فتح ORIN", "Unlock ORIN"))
                .setSubtitle(text("استخدم حماية قفل شاشة Android", "Use Android device security"));
            if (Build.VERSION.SDK_INT >= 30) {
                builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG
                    | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            } else if (Build.VERSION.SDK_INT >= 29) {
                builder.setDeviceCredentialAllowed(true);
            } else {
                builder.setNegativeButton(text("رمز قفل الجهاز", "Device screen lock"),
                    activity.getMainExecutor(), (dialog, which) -> {
                        if (destroyed || currentAttempt != attempt) return;
                        authenticating = false;
                        cancellation = null;
                        launchDeviceCredential();
                    });
            }
            builder.build().authenticate(cancellation, activity.getMainExecutor(),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        if (destroyed || currentAttempt != attempt) return;
                        authenticating = false;
                        cancellation = null;
                        acceptSystemSuccess();
                    }
                    @Override public void onAuthenticationFailed() {
                        if (!destroyed && currentAttempt == attempt) updateCover(text(
                            "لم يتم التعرّف على البصمة. حاول مجددًا من نافذة Android.",
                            "Biometric not recognized. Try again in the Android prompt."));
                    }
                    @Override public void onAuthenticationError(int code, CharSequence message) {
                        if (destroyed || currentAttempt != attempt) return;
                        authenticating = false;
                        cancellation = null;
                        suppressAutomaticPrompt = true;
                        updateCover(text("لم يُفتح التطبيق. أعد المحاولة أو استخدم رمز قفل الجهاز.",
                            "ORIN remains locked. Retry or use your device screen lock."));
                    }
                });
        } catch (Exception unavailable) {
            authenticating = false;
            cancellation = null;
            updateCover(text("البصمة غير متاحة الآن. استخدم رمز قفل شاشة Android.",
                "Biometrics are unavailable. Use your Android device screen lock."));
        }
    }
    @SuppressWarnings("deprecation")
    private void launchDeviceCredential() {
        if (!resumed || destroyed || !locked || authenticating || storageFailure) return;
        if (!secureDevice()) { updateCover(null); return; }
        try {
            Intent intent = keyguard.createConfirmDeviceCredentialIntent(text("فتح ORIN", "Unlock ORIN"),
                text("أكّد هويتك باستخدام قفل شاشة Android", "Verify using your Android device screen lock"));
            if (intent == null) { updateCover(null); return; }
            ++attempt;
            authenticating = true;
            credentialInFlight = true;
            updateCover(null);
            activity.startActivityForResult(intent, CONFIRM_DEVICE_REQUEST);
        } catch (Exception unavailable) {
            authenticating = false;
            credentialInFlight = false;
            updateCover(text("تعذر فتح التحقق من Android. يبقى التطبيق مقفلًا.",
                "Android verification could not open. ORIN remains locked."));
        }
    }
    public boolean onActivityResult(int requestCode, int resultCode) {
        if (requestCode != CONFIRM_DEVICE_REQUEST) return false;
        if (!credentialInFlight || destroyed) return true;
        credentialInFlight = false;
        authenticating = false;
        if (resultCode == Activity.RESULT_OK && secureDevice()) acceptSystemSuccess();
        else {
            suppressAutomaticPrompt = true;
            updateCover(text("أُلغي التحقق. المحتوى ما زال مقفلًا.",
                "Verification was cancelled. Content remains locked."));
        }
        return true;
    }
    private void acceptSystemSuccess() {
        if (!locked || destroyed) return;
        if (!secureDevice()) { updateCover(null); return; }
        if (resumed) finishUnlock();
        else {
            // A system credential Activity normally reports before this Activity resumes.
            // Never reveal content offscreen or retain a success beyond the absence window.
            pendingSuccess = true;
            pendingSuccessAt = SystemClock.elapsedRealtime();
        }
    }
    private void finishUnlock() {
        if (!resumed || destroyed || storageFailure) return;
        if (!secureDevice()) { updateCover(null); return; }
        if (!commit(preferences.edit().putBoolean("initialized", true).putBoolean("locked", false)
                .putString("process", PROCESS_TOKEN).putString("phase", "foreground")
                .remove("leftAt").remove("boot"))) { updateCover(null); return; }
        locked = false;
        pendingSuccess = false;
        suppressAutomaticPrompt = false;
        pausedAt = -1;
        revealContent();
    }
    public void onDestroy() {
        destroyed = true;
        ++attempt;
        if (cancellation != null) cancellation.cancel();
        cancellation = null;
    }
}
