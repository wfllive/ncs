# Сборка Jetpack Compose проектов

## Debug APK

```bash
./gradlew assembleDebug
```

Результат: `app/build/outputs/apk/debug/app-debug.apk`.

## Release APK

```bash
./gradlew assembleRelease
```

Для публикации укажите keystore и переменные паролей в настройках проекта.

## Android App Bundle

```bash
./gradlew bundleRelease
```

Результат: `app/build/outputs/bundle/release/app-release.aab`.

## Проверки

```bash
./gradlew testDebugUnitTest
./gradlew lintDebug
```

Проект использует Gradle Kotlin DSL, Kotlin 2.3.21, Compose Compiler plugin и Material 3.
