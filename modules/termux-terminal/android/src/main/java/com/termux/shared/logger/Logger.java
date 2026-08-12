package com.termux.shared.logger;

import android.util.Log;

/**
 * Minimal Logger stub replacing {@code com.termux.shared.logger.Logger} from termux-shared.
 * Delegates to {@link android.util.Log}. Signatures match the subset used by the vendored
 * terminal / extra-keys code.
 */
public final class Logger {

    private Logger() {}

    private static String tag(String tag) {
        return (tag == null || tag.isEmpty()) ? "TermuxTerminal" : tag;
    }

    public static void logError(String tag, String message) {
        Log.e(tag(tag), message == null ? "" : message);
    }

    public static void logWarn(String tag, String message) {
        Log.w(tag(tag), message == null ? "" : message);
    }

    public static void logInfo(String tag, String message) {
        Log.i(tag(tag), message == null ? "" : message);
    }

    public static void logDebug(String tag, String message) {
        Log.d(tag(tag), message == null ? "" : message);
    }

    public static void logVerbose(String tag, String message) {
        Log.v(tag(tag), message == null ? "" : message);
    }

    public static void logStackTraceWithMessage(String tag, String message, Throwable throwable) {
        Log.e(tag(tag), message == null ? "" : message, throwable);
    }

    public static void logStackTrace(String tag, Throwable throwable) {
        Log.e(tag(tag), "", throwable);
    }
}
