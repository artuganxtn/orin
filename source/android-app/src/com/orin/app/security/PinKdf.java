package com.orin.app.security;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
public final class PinKdf {
    public static final int ITERATIONS = 600000;
    private PinKdf() {}
    public static boolean valid(char[] pin) {
        if (pin == null || pin.length < 6 || pin.length > 12) return false;
        for (char digit : pin) if (digit < '0' || digit > '9') return false;
        return true;
    }
    public static byte[] derive(char[] pin, byte[] salt) throws GeneralSecurityException {
        if (!valid(pin) || salt == null || salt.length != 32) {
            if(pin != null) Arrays.fill(pin, '\0');
            throw new GeneralSecurityException("Invalid PIN input");
        }
        PBEKeySpec spec = new PBEKeySpec(pin, salt, ITERATIONS, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        finally { spec.clearPassword(); Arrays.fill(pin, '\0'); }
    }
    public static boolean matches(byte[] expected, byte[] actual) { return MessageDigest.isEqual(expected, actual); }
}
