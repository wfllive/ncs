package com.storm.engine.crash;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Process;
import android.provider.MediaStore;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class CrashHandler implements Thread.UncaughtExceptionHandler {
    public static final String TAG = "StormCrash";
    public static final String LOG_NAME = "storm_crash_log.txt";

    private static Context appContext;
    private static boolean initialized = false;
    private final Thread.UncaughtExceptionHandler defaultHandler;

    /** Install the process-wide handler as early as possible (even before Context is ready). */
    public static synchronized void installEarly() {
        if (initialized) return;
        Thread.setDefaultUncaughtExceptionHandler(new CrashHandler());
        initialized = true;
    }

    public static synchronized void init(Context context) {
        installEarly();
        if (context == null) return;
        Context app = context.getApplicationContext();
        appContext = app != null ? app : context;
    }

    private CrashHandler() {
        this.defaultHandler = Thread.getDefaultUncaughtExceptionHandler();
    }

    @Override
    public void uncaughtException(Thread thread, Throwable throwable) {
        String report = "storm crash: unknown";
        try {
            report = buildCrashReport(thread, throwable);
            Log.e(TAG, report);
            System.err.println(report);
            writeCrashToFile(report);
        } catch (Throwable ignored) {}

        try {
            if (appContext != null) {
                Intent intent = new Intent(appContext, CrashActivity.class);
                intent.putExtra("crash_info", report);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                appContext.startActivity(intent);
                try { Thread.sleep(400); } catch (InterruptedException ignored) {}
            }
        } catch (Throwable ignored) {}

        try {
            Process.killProcess(Process.myPid());
            System.exit(10);
        } catch (Throwable e) {
            if (defaultHandler != null) {
                defaultHandler.uncaughtException(thread, throwable);
            }
        }
    }

    private void writeCrashToFile(String report) {
        byte[] data;
        try {
            data = report.getBytes("UTF-8");
        } catch (Throwable e) {
            data = report.getBytes();
        }

        if (appContext != null) {
            writeBytes(new File(appContext.getFilesDir(), LOG_NAME), data);
            writeBytes(new File(appContext.getCacheDir(), LOG_NAME), data);
            try {
                File ext = appContext.getExternalFilesDir(null);
                if (ext != null) writeBytes(new File(ext, LOG_NAME), data);
            } catch (Throwable ignored) {}
            try {
                File extCache = appContext.getExternalCacheDir();
                if (extCache != null) writeBytes(new File(extCache, LOG_NAME), data);
            } catch (Throwable ignored) {}
            writeViaMediaStore(data);
        }

        try {
            File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (downloadDir != null) writeBytes(new File(downloadDir, LOG_NAME), data);
        } catch (Throwable ignored) {}

        try {
            writeBytes(new File("/sdcard/Download/" + LOG_NAME), data);
        } catch (Throwable ignored) {}
        try {
            writeBytes(new File("/storage/emulated/0/Download/" + LOG_NAME), data);
        } catch (Throwable ignored) {}
    }

    private void writeBytes(File file, byte[] data) {
        if (file == null) return;
        FileOutputStream fos = null;
        try {
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            fos = new FileOutputStream(file);
            fos.write(data);
            fos.flush();
        } catch (Throwable ignored) {
        } finally {
            if (fos != null) {
                try { fos.close(); } catch (Throwable ignored) {}
            }
        }
    }

    private void writeViaMediaStore(byte[] data) {
        if (appContext == null || Build.VERSION.SDK_INT < 29) return;
        OutputStream os = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, LOG_NAME);
            values.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = appContext.getContentResolver().insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return;
            os = appContext.getContentResolver().openOutputStream(uri);
            if (os != null) {
                os.write(data);
                os.flush();
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            appContext.getContentResolver().update(uri, values, null, null);
        } catch (Throwable ignored) {
        } finally {
            if (os != null) {
                try { os.close(); } catch (Throwable ignored) {}
            }
        }
    }

    private String buildCrashReport(Thread thread, Throwable throwable) {
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        if (throwable != null) throwable.printStackTrace(pw);
        String stackTrace = sw.toString();

        StringBuilder sb = new StringBuilder();
        sb.append("STORM ENGINE CRASH REPORT\n");
        sb.append("===========================================\n\n");
        sb.append("Time: ").append(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date())).append("\n");
        sb.append("Device: ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL)
                .append(" (").append(Build.PRODUCT).append(")\n");
        sb.append("Android: ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
        sb.append("Package: ").append(appContext != null ? appContext.getPackageName() : "unknown").append("\n");
        sb.append("Thread: ").append(thread != null ? thread.getName() : "?").append("\n\n");
        sb.append("EXCEPTION:\n");
        sb.append("-------------------------------------------\n");
        if (throwable != null) {
            sb.append(throwable.getClass().getName()).append(": ").append(throwable.getMessage()).append("\n\n");
        }
        sb.append("STACKTRACE:\n");
        sb.append("-------------------------------------------\n");
        sb.append(stackTrace);
        sb.append("\n\nLOG LOCATIONS:\n");
        sb.append("- app filesDir/storm_crash_log.txt\n");
        sb.append("- app externalFilesDir/storm_crash_log.txt\n");
        sb.append("- Downloads/storm_crash_log.txt (if permitted)\n");
        return sb.toString();
    }
}
