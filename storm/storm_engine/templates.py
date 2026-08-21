"""
Template Manager for Storm Build 2026.
Scaffolds starter projects for Minimal Apps, Yandex Ads SDK (v8.x API), and Native Games.
Includes Universal Debug Crash Handler for all templates (API 21 to 36+).
"""

from pathlib import Path

from .config import DEFAULT_CONFIG
from .crash_handler import CRASH_HANDLER_JAVA, CRASH_ACTIVITY_JAVA, CRASH_APPLICATION_JAVA
from .manifest import render_storm_m

CRASH_HANDLER_SRC = CRASH_HANDLER_JAVA
CRASH_ACTIVITY_SRC = CRASH_ACTIVITY_JAVA
CRASH_APPLICATION_SRC = CRASH_APPLICATION_JAVA


def _manifest(name: str, package: str, **overrides) -> str:
    data = dict(DEFAULT_CONFIG)
    data.update(
        {
            "name": name,
            "package": package,
            "r8": False,
            "src_dirs": ["app/src"],
            "res_dirs": ["app/res"],
            "assets_dirs": ["app/assets"],
            "jni_dirs": ["app/jniLibs"],
            "manifest": "app/AndroidManifest.xml",
            "proguard_rules": ["app/proguard-rules.pro"],
        }
    )
    data.update(overrides)
    return render_storm_m(data)


TEMPLATE_MINIMAL = {
    "storm.m": _manifest(
        "MyStormApp",
        "com.example.stormapp",
        repositories=[
            "https://repo1.maven.org/maven2/",
            "https://maven.google.com/",
        ],
        dependencies=[],
    ),
    "app/AndroidManifest.xml": """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.stormapp"
    android:versionCode="1"
    android:versionName="1.0.0">

    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:theme="@android:style/Theme.DeviceDefault.Light">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
""",
    "app/res/values/strings.xml": """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">My Storm App</string>
    <string name="welcome_text">Built without Gradle on Storm Build CLI!</string>
</resources>
""",
    "app/res/values/styles.xml": """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="android:Theme.DeviceDefault.Light.NoActionBar">
    </style>
</resources>
""",
    "app/res/layout/activity_main.xml": """<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center"
    android:padding="24dp">

    <TextView
        android:id="@+id/title_view"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:textSize="22sp"
        android:textStyle="bold"
        android:text="@string/welcome_text" />

    <Button
        android:id="@+id/click_button"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="20dp"
        android:text="Click Me!" />
</LinearLayout>
""",
    "app/src/com/example/stormapp/MainActivity.java": """package com.example.stormapp;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import com.storm.engine.crash.CrashHandler;

public class MainActivity extends Activity {
    private int counter = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Universal Debug Crash Handler (API 21 - 36+)
        CrashHandler.init(this);

        setContentView(R.layout.activity_main);

        final TextView titleView = findViewById(R.id.title_view);
        Button btn = findViewById(R.id.click_button);

        btn.setOnClickListener(v -> {
            counter++;
            titleView.setText("Clicked: " + counter + " times!");
            Toast.makeText(MainActivity.this, "Awesome! Count = " + counter, Toast.LENGTH_SHORT).show();
        });
    }
}
""",
    "app/src/com/storm/engine/crash/CrashHandler.java": CRASH_HANDLER_SRC,
    "app/src/com/storm/engine/crash/CrashActivity.java": CRASH_ACTIVITY_SRC,
    "app/src/com/storm/engine/crash/CrashApplication.java": CRASH_APPLICATION_SRC,
    "app/proguard-rules.pro": """# ProGuard / R8 Rules
-dontobfuscate
-keep class com.example.stormapp.** { *; }
-keep class com.storm.engine.crash.** { *; }
"""
}


TEMPLATE_YANDEX_ADS = {
    "storm.m": _manifest(
        "YandexAdsApp",
        "com.example.yandexads",
        compile_sdk=35,
        repositories=[
            "https://repo1.maven.org/maven2/",
            "https://maven.google.com/",
            "https://dl.google.com/dl/android/maven2/",
            "https://maven.yandex.ru/artifactory/libs-release/",
        ],
        dependencies=["com.yandex.android:mobileads:8.2.0"],
    ),
    "app/AndroidManifest.xml": """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.yandexads"
    android:versionCode="1"
    android:versionName="1.0.0">

    <!-- Permissions required by Yandex Mobile Ads SDK -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="com.google.android.gms.permission.AD_ID" />

    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:theme="@android:style/Theme.DeviceDefault.Light"
        android:allowBackup="true"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true">

        <!-- Google Play Services / AdMob Application ID (Required by Google Ads components) -->
        <meta-data
            android:name="com.google.android.gms.ads.APPLICATION_ID"
            android:value="ca-app-pub-3940256099942544~3347511713" />

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="keyboard|keyboardHidden|orientation|screenLayout|uiMode|screenSize|smallestScreenSize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

    </application>
</manifest>
""",
    "app/res/values/strings.xml": """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Yandex Ads Demo</string>
    <string name="title_ads">Storm Engine + Yandex Ads SDK</string>
    <string name="btn_show_interstitial">Show Interstitial Ad</string>
    <string name="btn_show_rewarded">Show Rewarded Ad</string>
</resources>
""",
    "app/res/layout/activity_main.xml": """<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center_horizontal"
    android:padding="20dp">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="@string/title_ads"
        android:textSize="20sp"
        android:textStyle="bold"
        android:layout_marginTop="20dp"
        android:layout_marginBottom="24dp" />

    <Button
        android:id="@+id/btn_interstitial"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="@string/btn_show_interstitial" />

    <Button
        android:id="@+id/btn_rewarded"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="12dp"
        android:text="@string/btn_show_rewarded" />

    <!-- Container where BannerAdView will be attached -->
    <FrameLayout
        android:id="@+id/banner_container"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="32dp" />

</LinearLayout>
""",
    "app/src/com/example/yandexads/MainActivity.java": """package com.example.yandexads;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.Toast;

import com.storm.engine.crash.CrashHandler;
import com.yandex.mobile.ads.common.YandexAds;
import com.yandex.mobile.ads.common.InitializationListener;
import com.yandex.mobile.ads.banner.BannerAdView;
import com.yandex.mobile.ads.banner.BannerAdSize;
import com.yandex.mobile.ads.common.AdRequest;

public class MainActivity extends Activity {
    private BannerAdView bannerAdView;
    private static final String DEMO_BANNER_ID = "demo-banner-yandex";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Universal Debug Crash Handler (API 21 - 36+)
        CrashHandler.init(this);

        setContentView(R.layout.activity_main);

        // 1. Initialize Yandex Mobile Ads SDK (v8.x API)
        YandexAds.initialize(this, new InitializationListener() {
            @Override
            public void onInitializationCompleted() {
                // Run UI modifications on Main UI Thread
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(MainActivity.this, "Yandex Ads Initialized!", Toast.LENGTH_SHORT).show();
                        loadBannerAd();
                    }
                });
            }
        });

        Button btnInterstitial = findViewById(R.id.btn_interstitial);
        if (btnInterstitial != null) {
            btnInterstitial.setOnClickListener(v -> {
                Toast.makeText(MainActivity.this, "Loading Interstitial Ad...", Toast.LENGTH_SHORT).show();
            });
        }

        Button btnRewarded = findViewById(R.id.btn_rewarded);
        if (btnRewarded != null) {
            btnRewarded.setOnClickListener(v -> {
                Toast.makeText(MainActivity.this, "Loading Rewarded Ad...", Toast.LENGTH_SHORT).show();
            });
        }
    }

    private void loadBannerAd() {
        try {
            FrameLayout container = findViewById(R.id.banner_container);
            if (container == null) return;

            bannerAdView = new BannerAdView(this);
            bannerAdView.setAdSize(BannerAdSize.sticky(this, 320));
            container.addView(bannerAdView);

            AdRequest adRequest = new AdRequest.Builder(DEMO_BANNER_ID).build();
            bannerAdView.loadAd(adRequest);
        } catch (Exception e) {
            Toast.makeText(this, "Ad load notice: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (bannerAdView != null) {
            bannerAdView.destroy();
        }
        super.onDestroy();
    }
}
""",
    "app/src/com/storm/engine/crash/CrashHandler.java": CRASH_HANDLER_SRC,
    "app/src/com/storm/engine/crash/CrashActivity.java": CRASH_ACTIVITY_SRC,
    "app/src/com/storm/engine/crash/CrashApplication.java": CRASH_APPLICATION_SRC,
    "app/proguard-rules.pro": """# Android Core Component Keep Rules (Activities, Applications, Providers, Services)
-keep public class * extends android.app.Activity { *; }
-keep public class * extends android.app.Application { *; }
-keep public class * extends android.app.Service { *; }
-keep public class * extends android.content.BroadcastReceiver { *; }
-keep public class * extends android.content.ContentProvider { *; }
-keep public class * extends android.view.View { *; }

# Keep Attributes & Annotations
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions,SourceFile,LineNumberTable
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep Yandex Mobile Ads SDK & Submodules
-keep class com.yandex.mobile.ads.** { *; }
-dontwarn com.yandex.mobile.ads.**

# Keep AppMetrica Analytics
-keep class io.appmetrica.analytics.** { *; }
-dontwarn io.appmetrica.analytics.**

# Keep Varioqub Experiments
-keep class com.yandex.varioqub.** { *; }
-dontwarn com.yandex.varioqub.**

# Keep Storm Crash Handler
-keep class com.storm.engine.crash.** { *; }

# Keep AndroidX & Lifecycle
-keep class androidx.** { *; }
-dontwarn androidx.**

# Keep Google Play Services
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# Keep Kotlin Stdlib & Coroutines
-keep class kotlin.** { *; }
-keep class kotlinx.** { *; }
-dontwarn kotlin.**
-dontwarn kotlinx.**

# Keep OkHttp & Okio (Network stack)
-keep class okhttp3.** { *; }
-keep class okio.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**

# General warnings suppression for optional mediation libraries
-dontwarn javax.annotation.**
-dontwarn javax.inject.**
-dontwarn org.checkerframework.**
"""
}


TEMPLATE_NATIVE_GAME = {
    "storm.m": _manifest(
        "StormGame",
        "com.example.stormgame",
        repositories=[
            "https://repo1.maven.org/maven2/",
            "https://maven.google.com/",
        ],
        dependencies=[],
    ),
    "app/AndroidManifest.xml": """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.stormgame"
    android:versionCode="1"
    android:versionName="1.0.0">

    <uses-feature android:glEsVersion="0x00030000" android:required="true" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <application
        android:label="Storm Game"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen"
        android:hasCode="true">
        <activity
            android:name=".GameActivity"
            android:screenOrientation="landscape"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
""",
    "app/res/values/strings.xml": """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Storm Game Engine</string>
</resources>
""",
    "app/assets/game.cfg": """# Storm Game Engine Configuration
fps_limit=60
render_api=vulkan_opengles
width=1920
height=1080
audio_channels=2
""",
    "app/src/com/example/stormgame/GameActivity.java": """package com.example.stormgame;

import android.app.Activity;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Toast;

import com.storm.engine.crash.CrashHandler;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

public class GameActivity extends Activity {
    private GLSurfaceView glView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CrashHandler.init(this);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);

        glView = new GLSurfaceView(this);
        glView.setEGLContextClientVersion(2);
        glView.setRenderer(new GameRenderer());
        setContentView(glView);

        Toast.makeText(this, "Storm Game Engine Running!", Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onResume() {
        super.onResume();
        glView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        glView.onPause();
    }

    static class GameRenderer implements GLSurfaceView.Renderer {
        private float red = 0.1f;

        @Override
        public void onSurfaceCreated(GL10 gl, EGLConfig config) {
            gl.glClearColor(0.08f, 0.12f, 0.18f, 1.0f);
        }

        @Override
        public void onSurfaceChanged(GL10 gl, int width, int height) {
            gl.glViewport(0, 0, width, height);
        }

        @Override
        public void onDrawFrame(GL10 gl) {
            gl.glClear(GL10.GL_COLOR_BUFFER_BIT | GL10.GL_DEPTH_BUFFER_BIT);
        }
    }
}
""",
    "app/src/com/storm/engine/crash/CrashHandler.java": CRASH_HANDLER_SRC,
    "app/src/com/storm/engine/crash/CrashActivity.java": CRASH_ACTIVITY_SRC,
    "app/proguard-rules.pro": """# Native Game Proguard Rules
-keep class com.example.stormgame.** { *; }
-keep class com.storm.engine.crash.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}
"""
}

TEMPLATES = {
    "minimal": TEMPLATE_MINIMAL,
    "yandex-ads": TEMPLATE_YANDEX_ADS,
    "native-game": TEMPLATE_NATIVE_GAME
}


def create_project_from_template(template_name: str, target_dir: Path, package_name: str = None, app_name: str = None) -> bool:
    """Instantiate a template into a target directory."""
    if template_name not in TEMPLATES:
        print(f"[ERROR] Unknown template '{template_name}'. Available: {list(TEMPLATES.keys())}")
        return False

    template_data = TEMPLATES[template_name]
    target_dir.mkdir(parents=True, exist_ok=True)

    for rel_path, content in template_data.items():
        dest_path = target_dir / rel_path

        if package_name and "/com/example/" in rel_path:
            pkg_path = package_name.replace(".", "/")
            new_rel = rel_path.replace("app/src/com/example/stormapp", f"app/src/{pkg_path}")
            new_rel = new_rel.replace("app/src/com/example/yandexads", f"app/src/{pkg_path}")
            new_rel = new_rel.replace("app/src/com/example/stormgame", f"app/src/{pkg_path}")
            dest_path = target_dir / new_rel

            content = content.replace("package com.example.stormapp;", f"package {package_name};")
            content = content.replace("package com.example.yandexads;", f"package {package_name};")
            content = content.replace("package com.example.stormgame;", f"package {package_name};")

        if package_name:
            content = content.replace("com.example.stormapp", package_name)
            content = content.replace("com.example.yandexads", package_name)
            content = content.replace("com.example.stormgame", package_name)

        if app_name:
            content = content.replace("MyStormApp", app_name)
            content = content.replace("YandexAdsApp", app_name)
            content = content.replace("StormGame", app_name)
            content = content.replace("My Storm App", app_name)

        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "w", encoding="utf-8") as f:
            f.write(content)

    for extra in ("app/assets", "app/jniLibs", "app/res/mipmap-xxxhdpi"):
        (target_dir / extra).mkdir(parents=True, exist_ok=True)

    from .icons import ensure_launcher_icon
    ensure_launcher_icon(target_dir, [target_dir / "app" / "res"])
    return True
