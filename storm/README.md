# ⚡ Storm Engine Studio — Storm Build 2026

**Документация:** [wfllive.github.io/Storm-Build](https://wfllive.github.io/Storm-Build/) · **Чат (вопросы и баги):** [t.me/wfllive_chat_base](https://t.me/wfllive_chat_base) · **Донат:** [boosty.to/wfllive/donate](https://boosty.to/wfllive/donate)

**Storm Build 2026** — это легковесный, быстрый и полностью автономный инструмент для создания и сборки Android-приложений (**APK** и **AAB**) **без Gradle**.

Он специально разработан для:
- Разработчиков собственных движков и кастомных пайплайнов.
- Работы в мобильных терминалах вроде **Termux (Android)** на архитектурах **ARM64 / AArch64**.
- Сборки на серверах, Raspberry Pi, macOS (Apple Silicon / Intel), Linux x86_64 и Windows.
- Простой интеграции сторонних AAR-библиотек (включая **Yandex Mobile Ads SDK**, **AdMob**, **AndroidX** и др.).

---

## 🌟 Основные возможности

* **Полный отказ от Gradle**: сборка быстрее в 5-10 раз, минимальное потребление RAM (не требует Gradle Daemon на 2+ ГБ).
* **Поддержка ARM64 / AArch64 и Termux**:
  - Автоматическое определение среды Termux.
  - Поддержка компиляторов `javac` и `ecj` (Eclipse Compiler for Java).
  - Встроенный кроссплатформенный **Pure-Python ZipAligner** (выравнивание 4 байта и 16 КБ для `.so` без бинарных зависимостей).
* **Сборка APK и AAB**:
  - `APK` — готовые установочные пакеты (Debug / Release) с подписью v1/v2/v3.
  - `AAB` — Android App Bundle (Proto format + BundleTool) для публикации в Google Play и RuStore.
* **Поддержка R8 и D8**:
  - Минификация, обфускация, tree-shaking и поддержка правил ProGuard (`proguard-rules.pro` и `proguard.txt` из AAR).
* **Менеджер зависимостей Maven & AAR**:
  - Загрузка библиотек из Maven Central, Google Maven, Yandex Maven.
  - Автоматическая распаковка `.aar`, извлечение `classes.jar`, `res/`, нативных библиотек `jni/` и манифестов.
* **Автоматическое слияние манифестов (Manifest Merger)**:
  - Бесшовное объединение разрешений, сервисов, активностей и подстановка `${applicationId}`.
* **Готовые шаблоны проектов**:
  - `minimal` — чистое Java-приложение.
  - `yandex-ads` — готовый проект с интеграцией Yandex Mobile Ads SDK 8.x (баннеры, межстраничная реклама).
  - `native-game` — шаблон 2D/3D игры на OpenGL ES с поддержкой C++/Java и ресурсов.
* **Не падает на старте с Yandex Ads / AndroidX** (исправления 2026):
  - Полный резолв POM: parent, `dependencyManagement`, BOM, version ranges.
  - Debug-сборка через D8 (R8 больше не вырезает ContentProvider'ы SDK по умолчанию).
  - APK пересобирается с нуля (без «дописывания» zip, из‑за которого процесс умирал без стека).
  - `CrashApplication` ставится до провайдеров; лог пишется в `storm_crash_log.txt`.

---

## 🚀 Быстрый старт и Установка

### ⚡ Автоматическая установка (Termux, Linux, macOS)

Для первой установки достаточно запустить интерактивный скрипт-установщик:

```bash
# Клонирование и автоматическая установка
git clone https://github.com/wfllive/Storm-Build.git
cd Storm-Build
bash install.sh
```

**Что делает установщик:**
1. Определяет вашу архитектуру (**ARM64/AArch64** или **x86_64**) и среду (Termux / Linux / macOS).
2. В Termux автоматически ставит пакеты `pkg install openjdk-17 aapt apksigner ecj python`.
3. Скачивает платформенный `android.jar` (API 34), `r8.jar` и `bundletool.jar` в `~/.storm/tools/`. При смене `compile_sdk` / `target_sdk` на 35–37 `storm build apk` сам докачает нужный `android-{api}.jar` туда же.
4. Устанавливает команду `storm` глобально в ваш `$PATH` (`/data/data/com.termux/files/usr/bin` или `~/.local/bin`), после чего команду `storm` можно вызывать из любой папки!

Либо вы можете в любой момент выполнить:
```bash
storm setup
```

---

### 1. Диагностика окружения
Проверьте доступность инструментов в вашей системе:
```bash
storm doctor
```

### 2. Создание нового проекта из шаблона
```bash
# Доступные шаблоны: minimal, yandex-ads, native-game
./storm init MyAdsApp -t yandex-ads -p com.example.myadsapp
cd MyAdsApp
```

### 3. Загрузка зависимостей
```bash
../storm deps fetch
```

### 4. Сборка пакетов

```bash
# Сборка Debug APK (D8, все классы SDK на месте — так и нужно для Yandex Ads):
../storm build apk --d8

# Сборка Release APK с оптимизацией R8 (только если debug уже открывается):
../storm build apk --release --r8

# Сборка AAB для Google Play / RuStore:
../storm build aab --release --r8
```

Готовые файлы сохраняются в `build/outputs/`.

---

## 📋 Команды CLI

Полные примеры — на [странице документации](https://wfllive.github.io/Storm-Build/#cli). Кратко:

```bash
storm                              # справка
storm doctor                       # что установлено
storm setup --api 35               # докачать android.jar / r8 / bundletool
storm templates                    # minimal | yandex-ads | native-game

storm init MyAds -t yandex-ads -p ru.example.ads
cd MyAds

storm deps add androidx.appcompat:appcompat:1.6.1
storm deps fetch                   # иначе fetch сделает сам build

storm setup --kotlin               # kotlinc в ~/.storm/tools (или сам при .kt)
storm build apk --flavor free      # flavors { free { suffix .free  src app/srcFree } }

storm build apk                    # debug, r8 из storm.m
storm build apk --d8               # без сжатия
storm build apk --release --r8     # стор, после живого debug
storm build aab --release
storm build apk --clean --refresh-deps

storm keygen                       # спросит alias, пароли, CN/O/C — обязательно
storm plugin                       # running vs pin
storm plugin set 2026.2.0
storm update
storm logcat                       # adb, пакет из storm.m
storm zipalign in.apk out.apk
storm clean
```

`build` / `deps` / `plugin` / `keygen` / `clean` — только в папке с `storm.m`.

---

## 📁 Структура проекта

`storm init` создаёт такой каркас. В корне — манифест и lock, исходники живут в `app/`:

```
MyAdsApp/
├── storm.m                 # манифест проекта (редактируете вы)
├── storm.lock              # снимок Maven-графа (генерирует Storm, формат JSON без изменений)
└── app/
    ├── AndroidManifest.xml
    ├── proguard-rules.pro
    ├── src/                # Java
    ├── res/                # layout, values, mipmap
    ├── assets/
    └── jniLibs/            # .so по ABI
```

---

## 🛠️ Пример конфигурации `storm.m`

Человекочитаемый манифест. `storm.lock` Storm пишет сам — его руками не форматируйте.

Блок `plugin.storm` — версия движка. Если в новой версии Storm появились функции, которых нет у вас, поменяйте номер и выполните `storm update` (или просто `storm build` — при `plugin.auto true` он подтянет плагин сам).

```
# storm.m  ·  Storm Build project

plugin {
    storm     2026.2.0
    source    https://github.com/wfllive/Storm-Engine-Studio
    auto      true
}

project {
    name      YandexAdsApp
    package   com.example.yandexads
    version   1.0.0
    code      1
}

sdk {
    min       21
    target    34
    compile   34
}

app {
    src       app/src
    res       app/res
    assets    app/assets
    jni       app/jniLibs
    manifest  app/AndroidManifest.xml
    proguard  app/proguard-rules.pro
}

build {
    r8        false
}

repositories {
    https://repo1.maven.org/maven2/
    https://maven.google.com/
    https://maven.yandex.ru/artifactory/libs-release/
}

dependencies {
    implementation  com.yandex.android:mobileads:8.2.0
}
```

Старый `storm.json` по-прежнему читается, если `storm.m` нет. Новые проекты создаются только с `storm.m`.

---

## 📚 Дополнительная документация

* 🌐 [Сайт документации (GitHub Pages)](https://wfllive.github.io/Storm-Build/) — сравнение со Gradle, storm.m, команды.
* 📱 [Руководство по Termux и ARM64](docs/TERMUX_GUIDE.md) — подробная настройка на смартфонах без Root.
* 🚀 [Руководство по Yandex Mobile Ads SDK](docs/YANDEX_ADS_GUIDE.md) — подключение рекламы, разрешения и ProGuard.
* ⚙️ [Архитектура и ARM64](docs/ARCHITECTURE_AARCH64.md) — как устроена поддержка AArch64 и ZipAlign без Google x86 бинарников.
* 📦 [Сборка AAB для Google Play](docs/AAB_GOOGLE_PLAY.md) — генерация App Bundle без Gradle.

---

## 💬 Вопросы и проблемы

Чат: **https://t.me/wfllive_chat_base**

## 💜 Поддержать

Storm бесплатный (MIT). Если собираете на нём приложения — донат помогает развивать Termux, резолвер AAR и документацию:

**https://boosty.to/wfllive/donate**

---

## 📄 Лицензия

MIT License.
