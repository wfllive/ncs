#!/usr/bin/env bash
# =============================================================================
#  rai new
#  Создаёт готовый проект Jetpack Compose, заточенный под сборку на arm64
#  и выпуск APK ТОЛЬКО под arm64-v8a.
#
#  Использование:
#     bash rai new [ИмяПроекта] [package.name]
#  Пример:
#     bash rai new MyConstructor com.example.constructor
# =============================================================================
set -euo pipefail

# Адреса загрузки. Без этого при set -u скрипт падал на
# "RAI_SRC_GRADLE_RAW: unbound variable" уже после создания файлов проекта —
# оставался проект без gradlew.
. "${RAI_HOME:-$HOME/rai}/lib/sources.sh" 2>/dev/null || true
: "${RAI_SRC_GRADLE_RAW:=https://raw.githubusercontent.com/gradle/gradle}"

MODE="stable"
ARGS=()
for a in "$@"; do
  case "$a" in
    --modern) MODE="modern" ;;
    --stable) MODE="stable" ;;
    *) ARGS+=("$a") ;;
  esac
done
set -- "${ARGS[@]:-}"

APP_NAME="${1:-MyApp}"
PKG="${2:-com.example.$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]')}"
PKG_PATH="$(echo "$PKG" | tr '.' '/')"
ROOT="$HOME/projects/$APP_NAME"

# --- два профиля версий ---
MIN_SDK="24"
if [ "$MODE" = "modern" ]; then
    # Требует build-tools 36/37 -> сначала: rai install sdk
    GRADLE_VER="9.6.1"
    AGP_VER="9.3.1"
    KOTLIN_VER="2.4.10"
    COMPOSE_BOM="2026.06.01"
    COMPILE_SDK="37"
    TARGET_SDK="37"
    BUILD_TOOLS="37.0.0"
    CORE_KTX="1.18.0"
    ACTIVITY_COMPOSE="1.12.0"
    LIFECYCLE="2.10.0"
    # AGP 9+: Kotlin встроен, плагин kotlin.android применять НЕЛЬЗЯ
    # (иначе: "The 'org.jetbrains.kotlin.android' plugin is no longer required")
    KOTLIN_PLUGIN_ROOT=""
    KOTLIN_PLUGIN_APP=""
    # android.defaults.buildfeatures.buildconfig удалён в AGP 9.0 —
    # его наличие даёт WARNING "The option ... was removed in version 9.0".
    # buildConfig и так включён явно в buildFeatures {}.
    BUILDCONFIG_DEFAULT=""
else
    # Нативный ARM, без эмуляции. Максимум для build-tools 35.
    GRADLE_VER="8.14.5"
    AGP_VER="8.13.2"
    KOTLIN_VER="2.2.21"
    COMPOSE_BOM="2026.06.01"
    COMPILE_SDK="35"
    TARGET_SDK="35"
    BUILD_TOOLS="35.0.0"
    CORE_KTX="1.16.0"
    ACTIVITY_COMPOSE="1.10.1"
    LIFECYCLE="2.9.4"
    # AGP 8.x: Kotlin-плагин обязателен
    KOTLIN_PLUGIN_ROOT="    id(\"org.jetbrains.kotlin.android\") version \"$KOTLIN_VER\" apply false"
    KOTLIN_PLUGIN_APP="    id(\"org.jetbrains.kotlin.android\")"
    # в AGP 8.x опция ещё поддерживается
    BUILDCONFIG_DEFAULT="android.defaults.buildfeatures.buildconfig=false"
fi

SDK_DIR="${ANDROID_HOME:-$HOME/android-sdk}"
AAPT2_BIN="${AAPT2_BIN:-$HOME/bin/aapt2}"

GREEN='\033[1;32m'; BLUE='\033[1;34m'; NC='\033[0m'
RED='\033[1;31m'; YELLOW='\033[1;33m'; DIM='\033[2m'
log(){ echo -e "${BLUE}==>${NC} $*"; }

[ -d "$ROOT" ] && { echo "Каталог $ROOT уже существует. Удалите или выберите другое имя."; exit 1; }

EXTRA_ROOT_NOTE=""
log "Профиль: $MODE  (AGP $AGP_VER / Gradle $GRADLE_VER / compileSdk $COMPILE_SDK)"
if [ "$MODE" = "modern" ]; then
  if [ ! -f "$SDK_DIR/build-tools/$BUILD_TOOLS/aapt2" ]; then
    echo -e "${YELLOW}Нет build-tools $BUILD_TOOLS${NC} — профиль --modern без них не соберётся."
    echo "  Установить:  rai install sdk"
    echo "  Или создать проект на стабильных версиях:  rai new $APP_NAME --stable"
    echo
    if [ "${RAI_YES:-0}" = "1" ]; then
      c="y"
    elif [ -t 0 ]; then
      read -rp "  Всё равно создать проект? [y/N] " c
    else
      c="n"
    fi
    case "$c" in
      y|Y|д|Д|да|ДА|Да) ;;
      *) exit 1 ;;
    esac
  fi
fi
log "Создаю проект $APP_NAME ($PKG) в $ROOT"
mkdir -p "$ROOT/app/src/main/java/$PKG_PATH" \
         "$ROOT/app/src/main/res/values" \
         "$ROOT/app/src/main/res/xml" \
         "$ROOT/gradle/wrapper"

# ------------------------------------------------------------------ settings
cat > "$ROOT/settings.gradle.kts" <<EOF
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\\\.android.*")
                includeGroupByRegex("com\\\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "$APP_NAME"
include(":app")
EOF

# ------------------------------------------------------------------ root build
{
  echo "plugins {"
  echo "    id(\"com.android.application\") version \"$AGP_VER\" apply false"
  [ -n "$KOTLIN_PLUGIN_ROOT" ] && echo "$KOTLIN_PLUGIN_ROOT"
  echo "    id(\"org.jetbrains.kotlin.plugin.compose\") version \"$KOTLIN_VER\" apply false"
  echo "}"
} > "$ROOT/build.gradle.kts"

# ------------------------------------------------------------------ app build
{
  # ВАЖНО: import идёт до plugins — так требует Kotlin DSL.
  # Без него java.util.Properties не разрешается: внутри build.gradle.kts
  # идентификатор java занят расширением Gradle (JavaPluginExtension),
  # и получаем "Unresolved reference 'util'".
  echo "import java.util.Properties"
  echo ""
  echo "plugins {"
  echo "    id(\"com.android.application\")"
  [ -n "$KOTLIN_PLUGIN_APP" ] && echo "$KOTLIN_PLUGIN_APP"
  echo "    id(\"org.jetbrains.kotlin.plugin.compose\")"
  echo "}"
} > "$ROOT/app/build.gradle.kts"

cat >> "$ROOT/app/build.gradle.kts" <<EOF

android {
    namespace = "$PKG"
    compileSdk = $COMPILE_SDK
    buildToolsVersion = "$BUILD_TOOLS"

    defaultConfig {
        applicationId = "$PKG"
        minSdk = $MIN_SDK
        targetSdk = $TARGET_SDK
        versionCode = 1
        versionName = "1.0"

        // ===== ТОЛЬКО arm64-v8a =====
        // Один APK, в котором есть нативные библиотеки исключительно для arm64-v8a.
        // ВАЖНО: нельзя одновременно задавать ndk.abiFilters и splits.abi —
        // AGP падает с "Conflicting configuration ... in ndk abiFilters
        // cannot be present when splits abi filters are set".
        // splits.abi нужен только для НЕСКОЛЬКИХ APK (по одному на ABI).
        // Нам нужен один — поэтому используем abiFilters.
        ndk {
            abiFilters.clear()
            abiFilters += "arm64-v8a"
        }
    }

    // ===== Подпись релиза =====
    // Ключ и пароли берутся из keystore.properties (создать: rai keystore create).
    // Файл в .gitignore — секреты не попадают в репозиторий.
    signingConfigs {
        create("release") {
            val propsFile = rootProject.file("keystore.properties")
            if (propsFile.exists()) {
                val props = Properties()
                propsFile.inputStream().use { props.load(it) }
                storeFile = file(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
                // современные схемы подписи
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = false
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            // подписываем, только если ключ реально настроен
            signingConfig = if (rootProject.file("keystore.properties").exists())
                signingConfigs.getByName("release") else null

            isMinifyEnabled = true          // R8: сжатие и обфускация кода
            isShrinkResources = true        // выбросить неиспользуемые ресурсы
            isDebuggable = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // современный DSL вместо устаревшего kotlinOptions { jvmTarget }
    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
        jniLibs {
            // на всякий случай выкидываем чужие ABI из зависимостей
            excludes += listOf(
                "**/x86/**", "**/x86_64/**", "**/armeabi-v7a/**", "**/armeabi/**"
            )
        }
    }
    lint {
        abortOnError = false        // на телефоне lint часто мешает
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:$CORE_KTX")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:$LIFECYCLE")
    implementation("androidx.activity:activity-compose:$ACTIVITY_COMPOSE")

    implementation(platform("androidx.compose:compose-bom:$COMPOSE_BOM"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
EOF

cat > "$ROOT/app/proguard-rules.pro" <<'EOF'
# ===== Правила R8 для release-сборки =====

# Compose
-keep class androidx.compose.runtime.** { *; }
-dontwarn androidx.compose.**

# Kotlin
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlin.Metadata { public <methods>; }

# Точки входа Android
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Application
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver

# Убрать логи из релиза
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}

# Понятные стек-трейсы при краше (mapping.txt сохраняется в build/outputs/mapping)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
EOF

# ------------------------------------------------------------------ gradle.properties
cat > "$ROOT/gradle.properties" <<EOF
# ===== КРИТИЧНО для ARM: свой aarch64 aapt2 вместо x86_64 из Maven =====
android.aapt2FromMavenOverride=$AAPT2_BIN

# ===== Память/стабильность внутри proot =====
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8
org.gradle.daemon=false
org.gradle.parallel=false
org.gradle.caching=true
org.gradle.configureondemand=false
org.gradle.vfs.watch=false
org.gradle.workers.max=2

# ===== Kotlin: компилировать в том же процессе (без отдельного демона) =====
kotlin.compiler.execution.strategy=in-process
kotlin.incremental=false
kotlin.daemon.jvmargs=-Xmx1536m

# ===== Android =====
android.useAndroidX=true
android.nonTransitiveRClass=true
android.enableJetifier=false
$BUILDCONFIG_DEFAULT
android.suppressUnsupportedCompileSdk=$COMPILE_SDK,$((COMPILE_SDK+1))
# отключаем NDK-проверки, если NDK не установлен
android.native.buildOutput=quiet
EOF

# ------------------------------------------------------------------ local.properties
cat > "$ROOT/local.properties" <<EOF
sdk.dir=$SDK_DIR
EOF

# ------------------------------------------------------------------ wrapper
cat > "$ROOT/gradle/wrapper/gradle-wrapper.properties" <<EOF
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-$GRADLE_VER-bin.zip
networkTimeout=120000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
EOF

# ------------------------------------------------------------------ Manifest
cat > "$ROOT/app/src/main/AndroidManifest.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.App">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:label="@string/app_name"
            android:theme="@style/Theme.App">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
EOF

# ------------------------------------------------------------------ res
cat > "$ROOT/app/src/main/res/values/strings.xml" <<EOF
<resources>
    <string name="app_name">$APP_NAME</string>
</resources>
EOF

cat > "$ROOT/app/src/main/res/values/themes.xml" <<'EOF'
<resources>
    <style name="Theme.App" parent="android:Theme.Material.Light.NoActionBar" />
</resources>
EOF

# ------------------------------------------------------------------ Kotlin
cat > "$ROOT/app/src/main/java/$PKG_PATH/MainActivity.kt" <<EOF
package $PKG

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            AppTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainScreen()
                }
            }
        }
    }
}

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (dark) darkColorScheme() else lightColorScheme(),
        content = content
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen() {
    var counter by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("$APP_NAME") }) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Jetpack Compose работает 🎉",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )

            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    InfoRow("ABI устройства", Build.SUPPORTED_ABIS.joinToString(", "))
                    InfoRow("Основной ABI", Build.SUPPORTED_ABIS.firstOrNull() ?: "?")
                    InfoRow("Android SDK", Build.VERSION.SDK_INT.toString())
                    InfoRow("Устройство", "\${Build.MANUFACTURER} \${Build.MODEL}")
                }
            }

            Text("Нажато: \$counter", style = MaterialTheme.typography.titleLarge)

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = { counter++ }) { Text("+1") }
                OutlinedButton(onClick = { counter = 0 }) { Text("Сброс") }
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace)
    }
}

@Preview(showBackground = true)
@Composable
fun MainScreenPreview() {
    AppTheme { MainScreen() }
}
EOF

# ------------------------------------------------------------------ .gitignore
cat > "$ROOT/.gitignore" <<'EOF'
*.iml
.gradle/
local.properties
.idea/
build/
captures/
.externalNativeBuild/
.cxx/
*.apk
*.aab
*.keystore
*.jks
keystore.properties
EOF

# ------------------------------------------------------------------ wrapper jar
log "Генерирую Gradle Wrapper (нужен интернет, ~150 МБ при первом запуске)…"
cd "$ROOT"
if command -v gradle >/dev/null 2>&1; then
    gradle wrapper --gradle-version "$GRADLE_VER" --distribution-type bin >/dev/null 2>&1 \
      && log "wrapper создан локально" || true
fi

# Скачивание во временный файл: curl -o оставляет пустышку при ошибке,
# а пустой gradlew выглядит как «всё хорошо» и ломает сборку позже.
_fetch() {  # _fetch <куда> <url1> [url2...]
    local dest="$1"; shift
    local tmp url
    tmp="$(mktemp)" || return 1
    for url in "$@"; do
        if curl -fL --retry 3 --max-time 120 -o "$tmp" "$url" 2>/dev/null \
           && [ -s "$tmp" ]; then
            mkdir -p "$(dirname "$dest")"
            mv -f "$tmp" "$dest"
            # mktemp создаёт файл с правами 600 — возвращаем нормальные
            chmod 644 "$dest" 2>/dev/null || true
            return 0
        fi
    done
    rm -f "$tmp"
    return 1
}

WRAPPER_JAR="$ROOT/gradle/wrapper/gradle-wrapper.jar"
if [ ! -s "$WRAPPER_JAR" ]; then
    log "Скачиваю gradle-wrapper.jar…"
    _fetch "$WRAPPER_JAR" \
      "$RAI_SRC_GRADLE_RAW/v${GRADLE_VER}/gradle/wrapper/gradle-wrapper.jar" \
      "https://github.com/gradle/gradle/raw/v${GRADLE_VER}/gradle/wrapper/gradle-wrapper.jar" \
      || true
fi

if [ ! -s "$ROOT/gradlew" ]; then
    log "Скачиваю gradlew…"
    _fetch "$ROOT/gradlew" \
      "$RAI_SRC_GRADLE_RAW/v${GRADLE_VER}/gradlew" \
      "https://github.com/gradle/gradle/raw/v${GRADLE_VER}/gradlew" \
      || true
fi
chmod +x "$ROOT/gradlew" 2>/dev/null || true

# ------------------------------------------------------------------ проверка
# Проект без gradlew собрать нельзя. Лучше сказать об этом здесь,
# чем показать "No such file or directory" при rai build.
WRAPPER_OK=1
[ -s "$ROOT/gradlew" ]     || WRAPPER_OK=0
[ -s "$WRAPPER_JAR" ]      || WRAPPER_OK=0

if [ "$WRAPPER_OK" -eq 0 ]; then
    echo
    echo -e "${RED}Gradle Wrapper не скачался${NC} — файлы проекта созданы, собрать пока нельзя."
    echo
    [ -s "$ROOT/gradlew" ]  || echo "  нет: gradlew"
    [ -s "$WRAPPER_JAR" ]   || echo "  нет: gradle/wrapper/gradle-wrapper.jar"
    echo
    echo "  Обычно это временная проблема с сетью. Докачать:"
    echo -e "      ${BLUE}rai prepare $APP_NAME${NC}"
    echo
    echo -e "  ${DIM}Проверить доступность вручную:${NC}"
    echo "      curl -I $RAI_SRC_GRADLE_RAW/v${GRADLE_VER}/gradlew"
    exit 1
fi

echo
echo -e "${GREEN}=========== ПРОЕКТ СОЗДАН ===========${NC}"
echo "Путь        : $ROOT"
echo "Package     : $PKG"
echo "ABI         : arm64-v8a (только)"
echo "AGP/Kotlin  : $AGP_VER / $KOTLIN_VER, Gradle $GRADLE_VER"
echo
echo "Сборка:"
echo "  cd $ROOT"
echo "  ./gradlew assembleDebug --no-daemon"
echo
echo "Или через RAI (с проверкой перед сборкой):"
echo "  rai build $ROOT"
