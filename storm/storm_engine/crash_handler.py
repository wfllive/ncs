"""
Universal Debug Crash Handler, CrashActivity, and CrashApplication for Storm Build 2026.
Supports Android API 21 to API 36+ (Lollipop to Android 16).

Why apps used to die silently:
 - Yandex Ads / AppMetrica / AndroidX Startup run inside ContentProviders
   BEFORE any Activity.onCreate(). A handler installed in Activity is too late.
 - Writing only to /sdcard/Download fails on Android 10+ (scoped storage),
   so users never saw a txt file.
 - Starting CrashActivity in another process during bindApplication often fails.

This handler:
 - Installs in Application.attachBaseContext() BEFORE super / providers
 - Writes the log FIRST to several locations (app files + Downloads via MediaStore)
 - Then tries to show CrashActivity
"""

import shutil
from pathlib import Path
from typing import List, Optional

CRASH_HANDLER_JAVA = r"""package com.storm.engine.crash;

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
"""

CRASH_ACTIVITY_JAVA = r"""package com.storm.engine.crash;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;

public class CrashActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String crashInfo = getIntent() != null ? getIntent().getStringExtra("crash_info") : null;
        if (crashInfo == null || crashInfo.length() == 0) {
            crashInfo = readSavedLog();
        }
        if (crashInfo == null || crashInfo.length() == 0) {
            crashInfo = "No crash information available.\n"
                    + "Look for storm_crash_log.txt in:\n"
                    + " - Android/data/" + getPackageName() + "/files/\n"
                    + " - app internal filesDir\n"
                    + " - Downloads/";
        }
        final String report = crashInfo;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#121214"));
        root.setPadding(32, 48, 32, 32);

        TextView title = new TextView(this);
        title.setText("Application Crash Debugger");
        title.setTextColor(Color.parseColor("#FF5252"));
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setPadding(0, 0, 0, 16);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Uncaught exception. Log also saved as storm_crash_log.txt");
        subtitle.setTextColor(Color.parseColor("#AAAAAA"));
        subtitle.setTextSize(13);
        subtitle.setPadding(0, 0, 0, 24);
        root.addView(subtitle);

        LinearLayout btnLayout = new LinearLayout(this);
        btnLayout.setOrientation(LinearLayout.HORIZONTAL);
        btnLayout.setPadding(0, 0, 0, 24);

        Button copyBtn = new Button(this);
        copyBtn.setText("Copy Error Log");
        copyBtn.setBackgroundColor(Color.parseColor("#1E88E5"));
        copyBtn.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f
        );
        btnParams.setMargins(0, 0, 12, 0);
        copyBtn.setLayoutParams(btnParams);
        copyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("Crash Log", report);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(clip);
                    Toast.makeText(CrashActivity.this, "Crash log copied", Toast.LENGTH_SHORT).show();
                }
            }
        });
        btnLayout.addView(copyBtn);

        Button restartBtn = new Button(this);
        restartBtn.setText("Restart App");
        restartBtn.setBackgroundColor(Color.parseColor("#37474F"));
        restartBtn.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams restartParams = new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f
        );
        restartBtn.setLayoutParams(restartParams);
        restartBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    startActivity(launchIntent);
                }
                finish();
            }
        });
        btnLayout.addView(restartBtn);
        root.addView(btnLayout);

        ScrollView verticalScroll = new ScrollView(this);
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.0f
        );
        verticalScroll.setLayoutParams(scrollParams);
        verticalScroll.setBackgroundColor(Color.parseColor("#1E1E24"));
        verticalScroll.setPadding(24, 24, 24, 24);

        HorizontalScrollView horizontalScroll = new HorizontalScrollView(this);
        TextView logText = new TextView(this);
        logText.setText(report);
        logText.setTextColor(Color.parseColor("#ECEFF1"));
        logText.setTextSize(12);
        logText.setTypeface(Typeface.MONOSPACE);
        logText.setTextIsSelectable(true);

        horizontalScroll.addView(logText);
        verticalScroll.addView(horizontalScroll);
        root.addView(verticalScroll);

        setContentView(root);
    }

    private String readSavedLog() {
        File[] candidates = new File[] {
            new File(getFilesDir(), CrashHandler.LOG_NAME),
            new File(getCacheDir(), CrashHandler.LOG_NAME)
        };
        for (File f : candidates) {
            if (f != null && f.exists()) {
                FileInputStream in = null;
                try {
                    in = new FileInputStream(f);
                    byte[] buf = new byte[(int) f.length()];
                    int n = in.read(buf);
                    if (n > 0) return new String(buf, 0, n, "UTF-8");
                } catch (Throwable ignored) {
                } finally {
                    if (in != null) try { in.close(); } catch (Throwable ignored) {}
                }
            }
        }
        return null;
    }
}
"""


def crash_application_source(parent_class: str = "android.app.Application") -> str:
    """Generate CrashApplication that optionally wraps the project's Application class."""
    parent = parent_class or "android.app.Application"
    if parent.startswith("."):
        parent = parent.lstrip(".")
    return f"""package com.storm.engine.crash;

import android.content.Context;

public class CrashApplication extends {parent} {{
    @Override
    protected void attachBaseContext(Context base) {{
        // Handler MUST be installed before super() so ContentProviders
        // (Yandex Ads, AppMetrica, AndroidX Startup) are covered.
        CrashHandler.installEarly();
        super.attachBaseContext(base);
        installMultidex(base);
        CrashHandler.init(base);
    }}

    private static void installMultidex(Context base) {{
        // API 21+ loads all classesN.dex natively. On some OEM builds
        // (older Huawei) androidx.multidex still helps if the AAR is present.
        try {{
            Class<?> md = Class.forName("androidx.multidex.MultiDex");
            md.getMethod("install", Context.class).invoke(null, base);
        }} catch (Throwable ignored) {{}}
    }}

    @Override
    public void onCreate() {{
        CrashHandler.init(this);
        super.onCreate();
    }}
}}
"""


CRASH_APPLICATION_JAVA = crash_application_source("android.app.Application")


def _write_text(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def generate_crash_handler_sources(
    gen_dir: Path,
    src_dirs: List[Path],
    user_application: Optional[str] = None,
):
    """Install the 2026 crash handler into gen/ and upgrade stale copies in src/."""
    crash_dir = gen_dir / "com" / "storm" / "engine" / "crash"
    crash_dir.mkdir(parents=True, exist_ok=True)

    # Existing projects still have the old handler (no file log, init only in
    # Activity.onCreate). Upgrade those copies so the next build actually
    # produces storm_crash_log.txt.
    for sdir in src_dirs:
        src_crash = sdir / "com" / "storm" / "engine" / "crash"
        handler = src_crash / "CrashHandler.java"
        if handler.exists():
            old = handler.read_text(encoding="utf-8", errors="ignore")
            if "installEarly" not in old or "storm_crash_log.txt" not in old:
                _write_text(handler, CRASH_HANDLER_JAVA)
                _write_text(src_crash / "CrashActivity.java", CRASH_ACTIVITY_JAVA)
                print("  [CRASH] Upgraded src/ crash handler to Storm Build 2026 (writes storm_crash_log.txt)")

    _write_text(crash_dir / "CrashHandler.java", CRASH_HANDLER_JAVA)
    _write_text(crash_dir / "CrashActivity.java", CRASH_ACTIVITY_JAVA)

    parent = "android.app.Application"
    if user_application:
        ua = user_application.strip()
        if ua and "CrashApplication" not in ua:
            parent = ua
    _write_text(crash_dir / "CrashApplication.java", crash_application_source(parent))

    # If src already has CrashApplication, replace it with the wrapping one
    # so a custom Application still gets the early handler.
    for sdir in src_dirs:
        src_app = sdir / "com" / "storm" / "engine" / "crash" / "CrashApplication.java"
        if src_app.exists():
            _write_text(src_app, crash_application_source(parent))
