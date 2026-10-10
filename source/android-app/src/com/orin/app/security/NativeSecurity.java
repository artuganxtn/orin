package com.orin.app.security;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.SystemClock;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JsPromptResult;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Native-only application privacy gate. This is not backend authorization or 2FA. */
public final class NativeSecurity {
    private final Activity activity;
    private final WebView web;
    private final FrameLayout root;
    private final ExecutorService cryptoWorker = Executors.newSingleThreadExecutor();
    private final SecureRandom random = new SecureRandom();
    private SecureState store;
    private JSONObject state;
    private LinearLayout cover;
    private TextView message;
    private Button pinButton, bioButton;
    private boolean fatal, locked, covered, resumed, destroyed, busy;
    private AlertDialog pinDialog;
    private CancellationSignal biometricCancellation;
    private String nonce = "";
    private String pendingBindId, pendingBindNonce;
    private final java.util.List<android.util.Pair<String, String>> pendingBinds = new java.util.ArrayList<>();
    private void notifyPendingBinds(boolean ok, String error) {
        if (pendingBindId != null) {
            send(pendingBindId, pendingBindNonce, ok, ok ? safeStatus() : null, error);
            pendingBindId = null; pendingBindNonce = null;
        }
        for (android.util.Pair<String, String> p : pendingBinds) {
            send(p.first, p.second, ok, ok ? safeStatus() : null, error);
        }
        pendingBinds.clear();
    }

    public NativeSecurity(Activity activity, WebView web, FrameLayout root) {
        this.activity = activity; this.web = web; this.root = root;
        // Ordinary ORIN screens allow user screenshots. PIN dialogs retain FLAG_SECURE;
        // onPause still covers financial content and Android 13+ excludes recents captures.
        if (Build.VERSION.SDK_INT >= 33) activity.setRecentsScreenshotEnabled(false);
        try {
            store = new SecureState(activity); state = store.read();
            if (state.optInt("version") != 1) throw new SecurityException("Unknown security state");
            if (bound()) {
                locked = false;
                state.put("locked", false); persist();
            }
        } catch (Exception error) { /* ignore */ }
    }
    private String uid() { return state == null ? "" : state.optString("uid", ""); }
    private boolean bound() { return !uid().isEmpty(); }
    private JSONObject account() throws Exception {
        JSONObject accounts = state.getJSONObject("accounts");
        JSONObject account = accounts.optJSONObject(uid());
        if (account == null) { account = new JSONObject().put("timeout", 300); accounts.put(uid(), account); }
        return account;
    }
    private boolean configured() { return true; }
    private int timeout() { return 300; }
    private int boot() { try { return Settings.Global.getInt(activity.getContentResolver(), Settings.Global.BOOT_COUNT); } catch (Exception e) { return -1; } }
    private void persist() throws Exception { store.write(state); }
    private int dp(int n) { return (int)(n * activity.getResources().getDisplayMetrics().density + .5f); }
    private void failClosed() {
        fatal = false; locked = false;
    }
    private Button button(String label) {
        Button button = new Button(activity); button.setText(label); button.setTextColor(Color.WHITE); button.setTextSize(16);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(Color.rgb(0,112,245)); bg.setCornerRadius(dp(18)); button.setBackground(bg);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(54)); p.topMargin = dp(16); button.setLayoutParams(p);
        button.setFilterTouchesWhenObscured(true); return button;
    }
    private void showCover() {
        covered = false;
    }
    private void hideCover() {
        covered = false;
    }
    public boolean interceptBack() { return false; }
    public boolean isLocked() { return false; }
    public void onPause() {
        resumed = false;
    }
    public void onResume() {
        resumed = true;
        locked = false;
        covered = false;
    }
    public void onDestroy() {
        destroyed = true; if (biometricCancellation != null) biometricCancellation.cancel();
        if (pinDialog != null) pinDialog.dismiss(); notifyPendingBinds(false, "Destroyed"); cryptoWorker.shutdown();
    }
    public void invalidateBridge() { nonce = ""; }
    public void publishBridge() {
        nonce = UUID.randomUUID().toString() + UUID.randomUUID().toString();
        // evaluateJavascript executes in the top-level frame. Nonce stays in a closure,
        // never a public property and never through addJavascriptInterface to iframes.
        String script = "(()=>{if(window!==window.top)return;const nonce=" + JSONObject.quote(nonce) + ";"
            + "Object.defineProperty(window,'orinNativeSecurity',{configurable:true,value:(action,payload)=>window.prompt('ORIN_SECURITY:'+nonce,JSON.stringify({action,...payload}))});"
            + "window.dispatchEvent(new Event('orin:native-security-ready'));})()";
        web.evaluateJavascript(script, null);
    }
    public boolean handlePrompt(String url, String messageText, String value, JsPromptResult result) {
        if (messageText == null || !messageText.startsWith("ORIN_SECURITY:")) return false;
        if (fatal || nonce.isEmpty() || !messageText.equals("ORIN_SECURITY:" + nonce) || !trusted(url) || !trusted(web.getUrl())
            || value == null || value.length() > 32768) { result.cancel(); return true; }
        try {
            JSONObject payload = new JSONObject(value); String action = payload.getString("action"), id = payload.getString("id");
            if (!id.matches("[a-fA-F0-9-]{36}")) throw new SecurityException("Invalid request");
            if ("status".equals(action)) { immediate(result, status()); return true; }
            if ("device".equals(action)) { immediate(result, device()); return true; }
            if ("bind".equals(action)) {
                String next = payload.getString("uid"); if (!next.matches("[a-zA-Z0-9:_-]{1,128}")) throw new SecurityException("Invalid account");
                state.put("uid", next); locked = false; state.put("locked", false).put("foreground", true); persist();
                immediate(result, status());
                return true;
            }
            if (!bound()) throw new SecurityException("No authenticated account is bound");
            if ("readSession".equals(action) || "clearSession".equals(action)) {
                if (!uid().equals(payload.getString("uid"))) throw new SecurityException("Account mismatch");
                if ("readSession".equals(action)) immediate(result, account().opt("session"));
                else { account().remove("session"); persist(); immediate(result, JSONObject.NULL); }
                return true;
            }
            if ("readTrustedDevice".equals(action) || "clearTrustedDevice".equals(action)) {
                if (!uid().equals(payload.getString("uid"))) throw new SecurityException("Account mismatch");
                if ("readTrustedDevice".equals(action)) immediate(result, account().opt("trustedDevice"));
                else { account().remove("trustedDevice"); persist(); immediate(result, JSONObject.NULL); }
                return true;
            }
            if ("storeTrustedDevice".equals(action)) {
                JSONObject valueObject = payload.getJSONObject("value");
                if (!uid().equals(valueObject.getString("uid")) || valueObject.getString("deviceToken").length() > 12000
                    || valueObject.getString("id").length() > 256 || valueObject.getDouble("expiresAt") <= 0)
                    throw new SecurityException("Invalid trusted-device credential");
                account().put("trustedDevice", valueObject); persist(); immediate(result, JSONObject.NULL); return true;
            }
            if ("storeSession".equals(action)) {
                JSONObject valueObject = payload.getJSONObject("value");
                if (!uid().equals(valueObject.getString("uid")) || valueObject.getString("accessToken").length() > 12000
                    || valueObject.getString("refreshToken").length() > 12000 || valueObject.getString("sessionId").length() > 256
                    || valueObject.getDouble("expiresAt") <= 0) throw new SecurityException("Invalid credential");
                account().put("session", valueObject); persist(); immediate(result, JSONObject.NULL); return true;
            }
            if (busy) throw new SecurityException("Security verification is in progress");
            if ("unbind".equals(action)) {
                account().remove("session"); state.remove("uid"); state.put("locked", false).put("foreground", false); persist(); locked = false; hideCover(); immediate(result, status()); return true;
            }
            if ("lock".equals(action)) { locked = true; state.put("locked", true); persist(); showCover(); immediate(result, status()); return true; }
            final String expectedNonce = nonce;
            Runnable reply = () -> send(id, expectedNonce, true, safeStatus(), null);
            if ("configurePin".equals(action)) {
                result.confirm("{\"pending\":true}"); verifyPin("تأكيد PIN الحالي", () -> showPinSetup(reply, () -> send(id, expectedNonce, false, null, "Cancelled")), () -> send(id, expectedNonce, false, null, "Cancelled")); return true;
            }
            if ("timeout".equals(action)) {
                final int seconds = LockPolicy.timeout(payload.getInt("seconds")); result.confirm("{\"pending\":true}");
                verifyPin("تأكيد إعداد القفل", () -> { try { account().put("timeout", seconds); persist(); reply.run(); } catch (Exception e) { failClosed(); } }, () -> send(id, expectedNonce, false, null, "Cancelled")); return true;
            }
            if ("enableBiometrics".equals(action) || "disableBiometrics".equals(action)) {
                final boolean enable = action.equals("enableBiometrics");
                if (enable && !biometricAvailable()) throw new SecurityException("Strong biometrics are unavailable; use your ORIN PIN");
                result.confirm("{\"pending\":true}");
                verifyPin("تأكيد PIN الخاص بـ ORIN", () -> { if (enable) biometric(true, reply); else { try { clearBiometric(); persist(); reply.run(); } catch (Exception e) { failClosed(); } } }, () -> send(id, expectedNonce, false, null, "Cancelled")); return true;
            }
            throw new SecurityException("Unsupported security operation");
        } catch (Exception error) {
            try { result.confirm(new JSONObject().put("ok",false).put("error",error instanceof SecurityException || error instanceof IllegalArgumentException ? error.getMessage() : "Security request failed").toString()); }
            catch (Exception ignored) { result.cancel(); }
            return true;
        }
    }
    private boolean trusted(String value) {
        if (value == null) return false;
        android.net.Uri u = android.net.Uri.parse(value);
        return "https".equals(u.getScheme()) && "orin-99951.web.app".equals(u.getHost()) && (u.getPort() == -1 || u.getPort() == 443);
    }
    private void immediate(JsPromptResult result, Object data) throws Exception { result.confirm(new JSONObject().put("ok",true).put("data",data == null ? JSONObject.NULL : data).toString()); }
    private void send(String id, String expectedNonce, boolean ok, Object data, String error) {
        if (destroyed || !nonce.equals(expectedNonce) || !trusted(web.getUrl())) return;
        try {
            JSONObject payload = new JSONObject().put("id",id).put("ok",ok).put("data",data == null ? JSONObject.NULL : data).put("error",error);
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('orin:native-security-result',{detail:" + payload.toString() + "}))", null);
        } catch (Exception ignored) { /* Never log credential payloads. */ }
    }
    private JSONObject safeStatus() { try { return status(); } catch (Exception e) { return new JSONObject(); } }
    private JSONObject status() throws Exception {
        return new JSONObject().put("supported",true).put("platform","android").put("configured",configured())
            .put("biometricAvailable",biometricAvailable()).put("biometricEnabled",biometricEnabled()).put("timeoutSeconds",timeout())
            .put("locked",locked || fatal).put("accountBound",bound()).put("hardwareBacked",store != null && store.hardwareBacked);
    }
    private JSONObject device() throws Exception {
        return new JSONObject().put("platform","android").put("manufacturer",Build.MANUFACTURER).put("model",Build.MODEL)
            .put("osVersion",Build.VERSION.RELEASE).put("appVersion",activity.getPackageManager().getPackageInfo(activity.getPackageName(),0).versionName);
    }
    private void unlock() {
        if (fatal || !configured()) return;
        try {
            // A KDF/system biometric result can arrive after Home/lock-screen. It
            // must never erase the persisted absence checkpoint or unlock offscreen.
            if(!resumed){locked=true;state.put("locked",true);persist();showCover();return;}
            locked = false; state.put("locked",false).put("foreground",true).remove("pausedAt"); persist(); hideCover();
            notifyPendingBinds(true, null);
        } catch (Exception e) { failClosed(); }
    }
    private EditText pinInput(String hint) {
        EditText field = new EditText(activity); field.setHint(hint); field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        field.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING | android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        field.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(12)});
        field.setFilterTouchesWhenObscured(true); field.setTextDirection(View.TEXT_DIRECTION_LTR); return field;
    }
    private LinearLayout form() { LinearLayout form = new LinearLayout(activity); form.setOrientation(1); form.setPadding(dp(24),dp(16),dp(24),dp(8)); return form; }
    private char[] takePin(EditText field) {
        char[] pin = new char[field.length()]; android.text.TextUtils.getChars(field.getText(),0,field.length(),pin,0); field.getText().clear();
        for (int i=0;i<pin.length;i++) { if (pin[i]>='٠'&&pin[i]<='٩') pin[i]=(char)('0'+pin[i]-'٠'); else if(pin[i]>='۰'&&pin[i]<='۹') pin[i]=(char)('0'+pin[i]-'۰'); }
        return pin;
    }
    private void protectDialog(AlertDialog dialog) {
        dialog.setCanceledOnTouchOutside(false);
        if (dialog.getWindow()!=null) dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
    private void showPinSetup(Runnable complete) { if (complete != null) complete.run(); }
    private void showPinSetup(Runnable complete, Runnable cancelled) { if (complete != null) complete.run(); }
    private void verifyPin(String title, Runnable success) { if (success != null) success.run(); }
    private void verifyPin(String title, Runnable success, Runnable cancelled) { if (success != null) success.run(); }
    private boolean biometricAvailable() {
        if(Build.VERSION.SDK_INT<28)return false;
        try{
            if(Build.VERSION.SDK_INT>=30)return activity.getSystemService(BiometricManager.class).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)==BiometricManager.BIOMETRIC_SUCCESS;
            if(Build.VERSION.SDK_INT>=29)return activity.getSystemService(BiometricManager.class).canAuthenticate()==BiometricManager.BIOMETRIC_SUCCESS;
            FingerprintManager fp=activity.getSystemService(FingerprintManager.class);return fp!=null&&fp.isHardwareDetected()&&fp.hasEnrolledFingerprints();
        }catch(Exception e){return false;}
    }
    private String biometricAlias() throws Exception {
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(uid().getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder();for(byte b:hash)hex.append(String.format(java.util.Locale.ROOT,"%02x",b));return "orin.biometric."+hex;
    }
    private boolean biometricEnabled() {
        try{
            if(!bound()||!account().has("bioData"))return false;
            KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);if(!keys.containsAlias(biometricAlias()))return false;
            // Keystore aliases may still exist after biometric enrollment invalidates
            // their authorization. Check usability without claiming authentication.
            Cipher check=Cipher.getInstance("AES/GCM/NoPadding");
            check.init(Cipher.DECRYPT_MODE,(SecretKey)keys.getKey(biometricAlias(),null),new GCMParameterSpec(128,SecureState.decode(account().getString("bioIV"))));
            return true;
        }catch(Exception e){return false;}
    }
    private void clearBiometric() throws Exception {
        KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);keys.deleteEntry(biometricAlias());
        account().remove("bioData");account().remove("bioIV");account().remove("bioProof");
    }
    private void biometric(boolean enroll, Runnable complete) {
        if(busy||fatal||!configured()||!biometricAvailable())return;
        busy=true;
        try{
            final Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); final byte[] credential;
            if(enroll){
                clearBiometric();persist();
                KeyGenerator generator=KeyGenerator.getInstance("AES","AndroidKeyStore");
                KeyGenParameterSpec.Builder spec=new KeyGenParameterSpec.Builder(biometricAlias(),KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
                if(Build.VERSION.SDK_INT>=30)spec.setUserAuthenticationParameters(0,KeyProperties.AUTH_BIOMETRIC_STRONG);
                else spec.setUserAuthenticationValidityDurationSeconds(-1);
                generator.init(spec.build());SecretKey key=generator.generateKey();cipher.init(Cipher.ENCRYPT_MODE,key);
                credential=new byte[32];random.nextBytes(credential);
            }else{
                KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);SecretKey key=(SecretKey)keys.getKey(biometricAlias(),null);
                cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,SecureState.decode(account().getString("bioIV"))));credential=null;
            }
            final boolean[] finalized={false};
            BiometricPrompt.Builder builder=new BiometricPrompt.Builder(activity).setTitle(enroll?"تفعيل البصمة في ORIN":"فتح ORIN")
                .setSubtitle("التحقق عبر نظام الجهاز؛ لا يخزن ORIN بيانات البصمة أو الوجه")
                .setNegativeButton("استخدام PIN",activity.getMainExecutor(),(d,w)->{if(finalized[0])return;finalized[0]=true;busy=false;biometricCancellation=null;if(credential!=null)Arrays.fill(credential,(byte)0);if(enroll){if(complete!=null)complete.run();}else verifyPin("فتح ORIN",()->unlock());});
            if(Build.VERSION.SDK_INT>=30)builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            biometricCancellation=new CancellationSignal();
            builder.build().authenticate(new BiometricPrompt.CryptoObject(cipher),biometricCancellation,activity.getMainExecutor(),new BiometricPrompt.AuthenticationCallback(){
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result){
                    if(finalized[0]||destroyed)return;finalized[0]=true;
                    try{
                        Cipher unlocked=result.getCryptoObject()==null?null:result.getCryptoObject().getCipher();if(unlocked==null)throw new SecurityException("Missing cryptographic proof");
                        if(enroll){byte[] encrypted=unlocked.doFinal(credential);account().put("bioData",SecureState.encode(encrypted)).put("bioIV",SecureState.encode(unlocked.getIV())).put("bioProof",SecureState.encode(MessageDigest.getInstance("SHA-256").digest(credential)));persist();if(complete!=null)complete.run();}
                        else{byte[] recovered=unlocked.doFinal(SecureState.decode(account().getString("bioData")));byte[] proof=MessageDigest.getInstance("SHA-256").digest(recovered);Arrays.fill(recovered,(byte)0);boolean valid=MessageDigest.isEqual(proof,SecureState.decode(account().getString("bioProof")));Arrays.fill(proof,(byte)0);if(!valid)throw new SecurityException("Credential mismatch");unlock();}
                    }catch(Exception e){try{clearBiometric();persist();}catch(Exception ignored){failClosed();}message.setText("تعذر فتح المفتاح الآمن. استخدم PIN وأعد تفعيل البصمة.");if(enroll&&complete!=null)complete.run();}
                    finally{busy=false;if(credential!=null)Arrays.fill(credential,(byte)0);biometricCancellation=null;}
                }
                @Override public void onAuthenticationError(int code,CharSequence error){if(finalized[0])return;finalized[0]=true;busy=false;if(credential!=null)Arrays.fill(credential,(byte)0);biometricCancellation=null;if(enroll&&complete!=null)complete.run();}
                @Override public void onAuthenticationFailed(){if(message!=null)message.setText("لم ينجح التحقق. يمكنك المحاولة أو استخدام PIN.");}
            });
        }catch(Exception e){busy=false;try{clearBiometric();persist();}catch(Exception ignored){failClosed();}if(message!=null)message.setText("القياسات الحيوية غير متاحة الآن. استخدم PIN.");if(complete!=null)complete.run();}
    }
}
