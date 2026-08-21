#!/usr/bin/env bash
# =============================================================================
#  ncs new — создаёт Java + XML проект Android
#
#  Использование: ncs new MyApp com.example.myapp
# =============================================================================
set -euo pipefail

if [ -t 1 ]; then
  B='\033[1;36m'; G='\033[1;32m'; NC='\033[0m'
else
  B=''; G=''; NC=''
fi
log() { echo -e "${B}==>${NC} $*"; }
ok()  { echo -e "  ${G}✓${NC} $*"; }

APP_NAME="${1:-MyApp}"
PKG="${2:-com.example.$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]')}"
PKG_PATH="$(echo "$PKG" | tr '.' '/')"
PROJECTS_DIR="${NCS_PROJECTS:-$HOME/projects}"
ROOT="$PROJECTS_DIR/$APP_NAME"

MIN_SDK=24
TARGET_SDK=35
COMPILE_SDK=35

[ -d "$ROOT" ] && { echo "Каталог $ROOT уже существует!"; exit 1; }

log "Создаю Java+XML проект: $APP_NAME ($PKG)"

# Структура каталогов
mkdir -p \
  "$ROOT/app/src/main/java/$PKG_PATH" \
  "$ROOT/app/src/main/res/layout" \
  "$ROOT/app/src/main/res/values" \
  "$ROOT/app/src/main/res/drawable" \
  "$ROOT/app/src/main/res/mipmap-hdpi" \
  "$ROOT/app/src/main/res/mipmap-mdpi" \
  "$ROOT/app/src/main/res/mipmap-xhdpi" \
  "$ROOT/app/src/main/res/mipmap-xxhdpi" \
  "$ROOT/app/src/main/res/mipmap-xxxhdpi" \
  "$ROOT/app/libs" \
  "$ROOT/build"

# ------------------------------------------------------------------ ncs-project.toml
cat > "$ROOT/ncs-project.toml" <<TOMLEOF
# Конфигурация проекта NCS Build
name = "$APP_NAME"
package = "$PKG"
min_sdk = $MIN_SDK
target_sdk = $TARGET_SDK
compile_sdk = $COMPILE_SDK
version_code = 1
version_name = "1.0"
main_activity = ".MainActivity"
language = "java"
ui = "xml"
TOMLEOF

# ------------------------------------------------------------------ AndroidManifest.xml
cat > "$ROOT/app/src/main/AndroidManifest.xml" <<XMLEOF
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.App">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:theme="@style/Theme.App">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

    </application>

</manifest>
XMLEOF

# ------------------------------------------------------------------ MainActivity.java
cat > "$ROOT/app/src/main/java/$PKG_PATH/MainActivity.java" <<JAVAEOF
package $PKG;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Главная активность приложения $APP_NAME.
 * Собрано через NCS Build без Gradle.
 */
public class MainActivity extends Activity {

    private int counter = 0;
    private TextView counterText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        counterText = findViewById(R.id.counter_text);
        Button plusButton = findViewById(R.id.button_plus);
        Button resetButton = findViewById(R.id.button_reset);

        plusButton.setOnClickListener(v -> {
            counter++;
            updateCounter();
        });

        resetButton.setOnClickListener(v -> {
            counter = 0;
            updateCounter();
            Toast.makeText(this, "Сброшено", Toast.LENGTH_SHORT).show();
        });

        updateCounter();
    }

    private void updateCounter() {
        counterText.setText("Нажато: " + counter);
    }
}
JAVAEOF

# ------------------------------------------------------------------ layout/activity_main.xml
cat > "$ROOT/app/src/main/res/layout/activity_main.xml" <<XMLEOF
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center"
    android:padding="24dp"
    android:background="@color/background">

    <TextView
        android:id="@+id/title_text"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="$APP_NAME"
        android:textSize="28sp"
        android:textStyle="bold"
        android:textColor="@color/primary"
        android:layout_marginBottom="32dp" />

    <android.widget.CardView xmlns:app="http://schemas.android.com/apk/res-auto"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        app:cardCornerRadius="12dp"
        app:cardElevation="4dp"
        android:layout_marginBottom="24dp">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:padding="16dp">

            <TextView
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="Собрано через NCS Build 🚀"
                android:textSize="16sp"
                android:textColor="@color/on_surface" />

            <TextView
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="Java + XML Views без Gradle"
                android:textSize="14sp"
                android:textColor="@color/on_surface_variant"
                android:layout_marginTop="4dp" />

        </LinearLayout>

    </android.widget.CardView>

    <TextView
        android:id="@+id/counter_text"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Нажато: 0"
        android:textSize="24sp"
        android:textStyle="bold"
        android:layout_marginBottom="24dp" />

    <LinearLayout
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:gap="12dp">

        <Button
            android:id="@+id/button_plus"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="+1"
            android:textSize="16sp"
            android:minWidth="120dp" />

        <Button
            android:id="@+id/button_reset"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Сброс"
            style="?android:attr/buttonBarButtonStyle"
            android:textSize="16sp"
            android:minWidth="120dp" />

    </LinearLayout>

</LinearLayout>
XMLEOF

# ------------------------------------------------------------------ values/colors.xml
cat > "$ROOT/app/src/main/res/values/colors.xml" <<XMLEOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="primary">#6200EE</color>
    <color name="primary_variant">#3700B3</color>
    <color name="secondary">#03DAC6</color>
    <color name="background">#FFFFFF</color>
    <color name="surface">#FFFFFF</color>
    <color name="on_primary">#FFFFFF</color>
    <color name="on_surface">#1C1B1F</color>
    <color name="on_surface_variant">#49454F</color>
    <color name="error">#B3261E</color>
</resources>
XMLEOF

# ------------------------------------------------------------------ values/strings.xml
cat > "$ROOT/app/src/main/res/values/strings.xml" <<XMLEOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">$APP_NAME</string>
</resources>
XMLEOF

# ------------------------------------------------------------------ values/themes.xml
cat > "$ROOT/app/src/main/res/values/themes.xml" <<XMLEOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.App" parent="android:Theme.Material.Light.NoActionBar">
        <item name="android:colorPrimary">@color/primary</item>
        <item name="android:colorPrimaryDark">@color/primary_variant</item>
        <item name="android:colorAccent">@color/secondary</item>
        <item name="android:windowBackground">@color/background</item>
        <item name="android:statusBarColor">@color/primary_variant</item>
    </style>
</resources>
XMLEOF

# ------------------------------------------------------------------ .gitignore
cat > "$ROOT/.gitignore" <<EOF
build/
*.iml
.idea/
local.properties
*.apk
*.aab
*.keystore
*.jks
EOF

# ------------------------------------------------------------------ proguard-rules.pro
cat > "$ROOT/app/proguard-rules.pro" <<EOF
# Правила R8 для release
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Application
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
}
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
EOF

# ------------------------------------------------------------------ README
cat > "$ROOT/README.md" <<EOF
# $APP_NAME

Проект Android на Java + XML Views, собранный через NCS Build (без Gradle).

## Сборка
\`\`\`bash
ncs build debug      # debug APK
ncs build release    # release APK
ncs install          # собрать и установить
ncs run              # собрать, установить и запустить
ncs clean            # очистка
\`\`\`

## Структура
\`\`\`
app/src/main/
├── AndroidManifest.xml
├── java/$PKG_PATH/
│   └── MainActivity.java    # исходный код
└── res/
    ├── layout/              # XML разметки
    ├── values/              # строки, цвета, темы
    └── drawable/            # изображения
\`\`\`
EOF

echo
echo -e "${G}=========== ПРОЕКТ СОЗДАН ===========${NC}"
echo "  Путь    : $ROOT"
echo "  Package : $PKG"
echo "  Язык    : Java + XML Views"
echo "  Сборка  : ncs build debug"
echo
