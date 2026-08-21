package com.storm.engine.crash;

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
