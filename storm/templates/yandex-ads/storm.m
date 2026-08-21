# ─────────────────────────────────────────────────────────────
#  storm.m  ·  Storm Build project
#  Edit this file.  storm.lock is generated — do not format it.
#  Bump  plugin.storm  to install a newer Storm (new features).
# ─────────────────────────────────────────────────────────────

plugin {
    storm      2026.2.0
    source     https://github.com/wfllive/Storm-Engine-Studio
    auto       true
}

project {
    name       YandexAdsApp
    package    com.example.yandexads
    version    1.0.0
    code       1
}

sdk {
    min        21
    target     34
    compile    35
}

app {
    src        app/src
    res        app/res
    assets     app/assets
    jni        app/jniLibs
    manifest   app/AndroidManifest.xml
    proguard   app/proguard-rules.pro
}

build {
    r8         false
}

repositories {
    https://repo1.maven.org/maven2/
    https://maven.google.com/
    https://dl.google.com/dl/android/maven2/
    https://maven.yandex.ru/artifactory/libs-release/
}

dependencies {
    implementation  com.yandex.android:mobileads:8.2.0
}

signing {
    debug {
        keystore   debug.keystore
        alias      androiddebugkey
        storepass  android
        keypass    android
    }
}
