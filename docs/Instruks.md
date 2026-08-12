# ИНСТРУКЦИЯ — что делать после скачивания проекта

Эта инструкция для тех, кто скачал этот репозиторий (архивом или `git clone`)
и хочет собрать и запустить приложение-конструктор **Compose Studio / React Studio**,
а затем собрать в нём свои APK на телефоне.

---

## 1. Что это за проект

**Конструктор Android-приложений**, который сам живёт на Android:

```
APK конструктора (React Native / Expo dev-build)
  └── proot-окружение Ubuntu arm64 (устанавливается при первом запуске)
        └── RAI (вендорен в папке rai/ этого репозитория)
              ├── rai install base   → apt, JDK 17, утилиты
              ├── rai install sdk    → нативный ARM Android SDK
              └── rai build <проект> → Gradle-сборка APK прямо на телефоне
```

Ключевое: **всё работает на самом телефоне** (процессор arm64/aarch64).
Компьютер нужен только один раз — чтобы собрать и установить APK конструктора.

---

## 2. Требования

| Что | Требование |
|---|---|
| Телефон | Android 7+ (API 24), процессор **arm64-v8a / aarch64** (`uname -m` → `aarch64`) |
| ОЗУ | от 3 ГБ (комфортно 6+) |
| Свободно на диске | от 6 ГБ (Ubuntu ~1 ГБ, SDK ~1 ГБ, Gradle + кэш) |
| Компьютер (для сборки конструктора) | Node.js 18+, npm или yarn |
| Интернет | при первом запуске (rootfs, apt, SDK, Gradle) |

> **RAI не требует GitHub**: он вендорен в `rai/` и зашит в APK
> (`assets/rai/rai.sh`). Android SDK качается из `HomuHomu833/android-sdk-custom`.

---

## 3. Сборка APK конструктора (на компьютере)

### Вариант A — локальная сборка (телефон по USB)

```bash
# 1. Установите зависимости
npm install          # или: yarn

# 2. Подключите телефон по USB, включите «Отладку по USB»
#    и убедитесь, что adb видит устройство:
adb devices          # → должен появиться серийный номер

# 3. Соберите и установите development-сборку
npx expo run:android
```

После сборки приложение автоматически установится на телефон.

### Вариант B — облачная сборка (EAS, без USB)

```bash
npm install
npm run bd           # eas build --platform android --profile development
```

Потребуется аккаунт Expo/EAS (`npx eas-cli login`). Готовый APK EAS пришлёт
ссылкой — скачайте и установите на телефон.

### Вариант C — архив проекта для GitHub Actions

```bash
npm run bdg          # создаёт _bdg_upload/project.zip + build-target.txt
```

Это для площадок, которые собирают проект из ZIP (например, свой builder-repo
на GitHub Actions). Скрипт сам подскажет дальнейшие шаги.

### Вариант D — облачная сборка через GitHub Actions (без телефона)

В репозитории готов workflow `.github/workflows/build-android.yml`. Он собирает
React + Vite + Android WebView проект в облаке (Ubuntu + JDK 17 + Android SDK)
и выкладывает готовый APK/AAB как артефакт:

1. **Положите сгенерированный проект в репозиторий** — например в папку `my-app/`
   (npm + `vite` + `android/` + `build-android.sh`, как создаёт конструктор).
   Можно просто перетащить папку проекта в репо через «Add file → Upload files».
2. Откройте вкладку **Actions → «Build Android (APK / AAB)» → Run workflow**.
3. Заполните:
   - **project_dir** — папка проекта (пусто = корень репозитория);
   - **target** — `debug` (быстрый APK), `release` (подписанный APK) или `aab` (для Google Play);
   - **upload** — загрузить артефакт.
4. После завершения — **Artifacts → build-<target>** → скачайте APK/AAB и установите на телефон.

Подпись release/AAB: добавьте в **Settings → Secrets and variables → Actions**
`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`.
Без них release/AAB соберётся, но будет неподписанным (для AAB это не подойдёт
для Google Play — нужен ключ).

> Если меняли нативный код (Kotlin, манифесты, модули `modules/`), пересоберите
> `npx expo prebuild --platform android` перед сборкой — конфиг-плагины
> (`plugins/with-rai-bundle.js` и др.) применятся автоматически.

---

## 4. Первый запуск на телефоне

1. Откройте установленный **Compose Studio**.
2. **Установка Ubuntu** — страница «Подготовка рабочей среды»:
   скачивает и распаковывает arm64 rootfs. Занимает несколько минут,
   **можно свернуть приложение** — установка идёт в фоне (уведомление).
3. **Установка RAI** — следующая страница выполняет по шагам:
   `apt update && apt upgrade` → утилиты → Node.js 24 →
   локальный `bash /root/rai/rai.sh` (из APK, без GitHub) →
   `rai install base` → `rai install sdk` → `rai status`.
   Прогресс виден в журнале; при обрыве установка продолжится с того же шага.
4. На этом же экране можно сразу выдать разрешения:
   - **Память** — «All files access» (нужно для сохранения APK в `/sdcard/Download`);
   - **Уведомления** — статус фоновых установок/сборок.
5. После успешного `rai status` откроется **список проектов** (главный экран).

---

## 5. Создание и сборка первого приложения

1. На главном экране — **«Новый проект»**: имя и Application ID
   (например `MyApp`, `com.example.myapp`).
2. Проект создаётся в `/root/projects/<имя>` внутри Ubuntu; вкладка
   **«Редактор»** — Kotlin-код экрана (сохраняется на диск как есть).
3. Слева — **«Файлы проекта»**: все файлы проекта (экраны, тему, Gradle,
   манифест, строки).
4. Вкладка **«Дизайн»** — предпросмотр активного экрана из кода.
5. Вкладка **«Сборка»** → задача **Android APK** → тип **Debug / Release / AAB**:
   - `npm install` → Vite-сборка → `cd android && ./gradlew assembleDebug | assembleRelease | bundleRelease`;
   - сборка **идёт в фоне** — можно свернуть приложение;
   - готовый APK/AAB копируется в **`/sdcard/Download/`**
     (и в `android/app/build/outputs/apk/<variant>/` или `bundle/release/`).
   - **AAB** (`bundleRelease`) — для загрузки в Google Play.
6. Кнопка **«Установить APK»** на экране сборки — установка с подтверждением
   «разрешить установку из этого источника» (Android спросит один раз).

Готово — установленное приложение запускается обычным значком.

---

## 6. Где что лежит

| Путь в репозитории | Что это |
|---|---|
| `src/` | JS/RN код конструктора (экраны, редактор, сборка, хранилище) |
| `modules/apt-manager/` | нативный модуль: rootfs, разрешения, фоновая служба, RAI bundle |
| `modules/termux-terminal/` | нативный терминал + proot-движок |
| `android/` | нативная обёртка (Expo prebuild) |
| `rai/` | **вендоренные исходники RAI** + собранный `rai.sh` |
| `modules/apt-manager/android/src/main/assets/rai/` | копия `rai.sh` внутри APK (переживает `expo prebuild --clean`) |
| `plugins/` | config-плагины Expo (native libs, RAI bundle) |
| `web/`, `src/ide/` | код-редактор (CodeMirror) внутри приложения |
| `scripts/` | сборщики и тесты (`build-editor.mjs`, `bdg.js`, …) |
| `react-android-project/` | пример структуры генерируемого проекта (справка) |

Внутри телефона:

| Путь (внутри proot Ubuntu) | Что это |
|---|---|
| `/root/projects/` | создаваемые проекты |
| `/root/android-sdk/` | Android SDK (build-tools, platforms) |
| `/root/rai/rai.sh` | бандл RAI, засеянный из APK |
| `/root/.rai-setup.done` | маркер «среда готова» |

---

## 7. Как обновить RAI (после правок в `rai/src/`)

```bash
cd rai
node scripts/build.js release     # пересборка бандла → build/release/rai.sh
cp build/release/rai.sh rai.sh
cp build/release/rai.sh.sha256 rai.sh.sha256
# обновить version.json (sha256, published)
cd ..
# копия для APK обновится при следующем prebuild, или вручную:
cp rai/rai.sh modules/apt-manager/android/src/main/assets/rai/rai.sh
```

Адреса источников (SDK, Gradle, Ubuntu) — в `rai/src/shell/lib/sources.sh`,
каждый переопределяется переменной окружения (`RAI_SRC_SDK_REPO`, …).

---

## 8. Полезные команды (в корне репозитория)

```bash
npm install            # зависимости
npm run android        # локальная сборка на телефон (expo run:android)
npm run bd             # облачная EAS-сборка development build
npm run bdg            # ZIP проекта для GitHub Actions builder
npm test               # проверка пайплайна генерации проектов
npm run test:ide       # тесты редактора и анализатора
npm run test:preview   # тесты предпросмотра
npm run editor         # пересборка встроенного редактора (CodeMirror)
```

---

## 9. Частые проблемы

| Симптом | Решение |
|---|---|
| «Termux из Google Play не годится» (в доках RAI) | Это про standalone-Termux, нам он не нужен — конструктор ставит своё proot-окружение сам |
| `aapt2: Exec format error` | Процессор не arm64 (32-битный) — RAI требует aarch64 |
| Установка RAI упала на шаге | Нажмите «Повторить» — готовые шаги пропускаются, установка продолжится |
| Сборка APK «висит» | Это нормально (первая сборка Gradle долгая). Можно свернуть — фоновая служба держит процесс |
| APK не появляется в `/sdcard/Download` | Выдайте разрешение «Память» (Настройки → Память и фон) |
| Не хватает места | Освободите 6+ ГБ; кэш Gradle можно очистить из проекта (Build → Очистить) |
| Хочется полностью сбросить среду | Удалите данные приложения (Настройки Android → Приложения → Compose Studio → Очистить хранилище) — Ubuntu поставится заново |
