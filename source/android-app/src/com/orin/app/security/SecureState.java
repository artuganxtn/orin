package com.orin.app.security;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;
/** One AES-GCM envelope. Failure to decrypt existing state never silently resets protection. */
final class SecureState {
    private static final String ALIAS = "orin.security.state.v1";
    private static final byte[] AAD = "com.orin.app/security/v1".getBytes(StandardCharsets.UTF_8);
    private final SharedPreferences prefs;
    private final SecretKey key;
    final boolean hardwareBacked;
    SecureState(Context context) throws Exception {
        prefs = context.getSharedPreferences("orin-security-v1", Context.MODE_PRIVATE);
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        boolean existing = prefs.contains("sealed");
        if (!store.containsAlias(ALIAS)) {
            if (existing) throw new SecurityException("Security key is unavailable");
            KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        key = (SecretKey)store.getKey(ALIAS, null);
        KeyInfo info = (KeyInfo)SecretKeyFactory.getInstance("AES", "AndroidKeyStore").getKeySpec(key, KeyInfo.class);
        hardwareBacked = info.isInsideSecureHardware();
    }
    JSONObject read() throws Exception {
        String raw = prefs.getString("sealed", null);
        if (raw == null) return new JSONObject().put("version", 1).put("accounts", new JSONObject());
        JSONObject envelope = new JSONObject(raw);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, decode(envelope.getString("iv")))); cipher.updateAAD(AAD);
        byte[] plain = cipher.doFinal(decode(envelope.getString("data")));
        try { return new JSONObject(new String(plain, StandardCharsets.UTF_8)); }
        finally { java.util.Arrays.fill(plain, (byte)0); }
    }
    void write(JSONObject state) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(AAD);
        byte[] plain = state.toString().getBytes(StandardCharsets.UTF_8);
        try {
            JSONObject envelope = new JSONObject().put("iv", encode(cipher.getIV())).put("data", encode(cipher.doFinal(plain)));
            if (!prefs.edit().putString("sealed", envelope.toString()).commit()) throw new SecurityException("Security state was not persisted");
        } finally { java.util.Arrays.fill(plain, (byte)0); }
    }
    static String encode(byte[] value) { return Base64.encodeToString(value, Base64.NO_WRAP); }
    static byte[] decode(String value) { return Base64.decode(value, Base64.NO_WRAP); }
}
