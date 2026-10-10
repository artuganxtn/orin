package com.orin.app.security;
/** Pure time policy. Never use a user-adjustable wall clock to release a lock. */
public final class LockPolicy {
    private LockPolicy() {}
    public static int timeout(int seconds) {
        if (seconds != 0 && seconds != 60 && seconds != 300 && seconds != 900) throw new IllegalArgumentException("Invalid lock timeout");
        return seconds;
    }
    public static boolean mustLock(boolean alreadyLocked, boolean coldStart, boolean wasForeground,
            long pausedAt, int savedBoot, int currentBoot, long elapsedNow, int timeoutSeconds) {
        if (alreadyLocked) return true;
        if (coldStart && wasForeground) return true; // abrupt death / no trustworthy pause checkpoint
        if (pausedAt < 0) return coldStart;
        if (savedBoot < 0 || currentBoot < 0 || savedBoot != currentBoot || elapsedNow < pausedAt) return true;
        return elapsedNow - pausedAt >= timeout(timeoutSeconds) * 1000L;
    }
    public static long failureDelayMillis(int failures) {
        if (failures < 5) return 0;
        return Math.min(900000L, 30000L << Math.min(5, failures - 5));
    }
    public static long remainingDelay(int savedBoot, int currentBoot, long retryAt, long now, long originalDelay) {
        if (originalDelay <= 0) return 0;
        // A reboot cannot clear a PIN penalty: restart its complete delay.
        if (savedBoot < 0 || currentBoot < 0 || savedBoot != currentBoot || now < 0) return originalDelay;
        return Math.max(0, retryAt - now);
    }
}
