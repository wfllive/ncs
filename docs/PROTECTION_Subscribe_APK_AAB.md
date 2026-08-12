# Руководство по подписи релизов (APK/AAB) и защите от мод (Anti-Mod Protection)

Настоящее руководство описывает полную систему создания ключей цифровой подписи и комплексно настроенную защиту от моддинга, взлома и распаковки как для самого конструктора **NovaCompose Studio** (`ru.wfllive.nova`), так и для проектов, создаваемых внутри него.

---

## 1. Подпись релиза NovaCompose Studio (`ru.wfllive.nova`)

По умолчанию в режиме разработки Gradle использует отладочный ключ `debug.keystore`. В релизной сборке для публикации в Google Play, RuStore или распространения APK необходим собственный **4096-битный RSA ключ релиза**.

### Быстрый способ: Использование генератора ключа

В проект встроен автоматический интерактивный CLI-инструмент:

```bash
npm run generate-key
# или
npm run keystore
```

#### Что делает генератор:
1. Создает **4096-битный RSA ключ** с алгоритмом подписи `SHA256withRSA` и сроком действия 30 лет (10950 дней).
2. Сохраняет ключ в файл `release.keystore` в корне проекта.
3. Автоматически извлекает SHA-256 отпечаток ключа (например, `AA:BB:CC:DD:...`).
4. Формирует конфиденциальный файл `keystore.properties`:
   ```properties
   storeFile=release.keystore
   storePassword=Ваш_Пароль
   keyAlias=release
   keyPassword=Ваш_Пароль
   expectedSha256=AA:BB:CC:DD:...
   ```
5. Проверяет `.gitignore` и заносит `keystore.properties`, `*.keystore` и `*.jks` в список исключений, гарантируя, что секретные ключи не попадут в Git.

---

### Ручной способ: Создание ключа через `keytool`

Если вы хотите создать ключ вручную в терминале:

```bash
keytool -genkeypair -v \
  -keystore release.keystore \
  -alias release \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10950 \
  -dname "CN=NovaCompose, O=Wfllive, L=Moscow, C=RU"
```

После создания извлеките SHA-256 отпечаток:

```bash
keytool -list -v -keystore release.keystore -alias release
```

И создайте файл `keystore.properties` рядом с `android/` или в корне проекта:

```properties
storeFile=release.keystore
storePassword=ВАШ_ПАРОЛЬ
keyAlias=release
keyPassword=ВАШ_ПАРОЛЬ
expectedSha256=ВАШ_SHA256_ОТПЕЧАТОК
```

---

### Сборка релизного APK и AAB

После создания `keystore.properties` Gradle автоматически переключается на подпись ключом релиза.

#### Сборка Релизного APK:
```bash
cd android
./gradlew assembleRelease
```
*Результат:* `android/app/build/outputs/apk/release/app-release.apk`

#### Сборка Android App Bundle (AAB для Google Play / RuStore):
```bash
cd android
./gradlew bundleRelease
```
*Результат:* `android/app/build/outputs/bundle/release/app-release.aab`

---

### Сборка в CI/CD и EAS Build

Для сборки на серверах CI/CD или в EAS без хранения `keystore.properties` в репозитории используются переменные окружения:

- `KEYSTORE_FILE` — путь к файлу ключа
- `KEYSTORE_PASSWORD` — пароль хранилища
- `KEY_ALIAS` — псевдоним ключа
- `KEY_PASSWORD` — пароль ключа
- `EXPECTED_SIGNATURE_SHA256` — SHA-256 отпечаток для защиты от мод

---

## 2. Комплексная защита от мод и распаковки (Anti-Mod Protection)

Моддеры обычно распаковывают APK, изменяют ресурсы/DEX-код (например, через Lucky Patcher или APK Editor) и переподписывают файл своим тестовым ключом. NovaCompose Studio содержит многоуровневую систему защиты.

### 1. Проверка цифровой подписи в Runtime (Signature Integrity Guard)

В нативной части Android на Kotlin реализован модуль `SecurityUtils.kt` и Native Module `SecurityModule`:

- При запуске приложение считывает SHA-256 отпечаток сертификата установленного APK.
- В релизной сборке (`!BuildConfig.DEBUG`) отпечаток сравнивается с `expectedSha256` из `keystore.properties` (передается через `BuildConfig.EXPECTED_SIGNATURE_SHA256`).
- **Если подпись не совпадает** (APK модифицирован или переподписан моддером), модуль фиксирует ошибку целостности `isTampered = true`.
- В TypeScript-слое (`src/utils/security.ts`) функция `checkSecurityOnBoot()` показывает предупреждение и блокирует работу модифицированного приложения.

### 2. Защита от динамического анализа и отладки (Anti-Debugging & Anti-Frida)

- **Детекция отладчика:** Проверяется `Debug.isDebuggerConnected()` и флаги отладки `FLAG_DEBUGGABLE`.
- **Детекция Frida / Xposed:** Модуль анализирует наличие бинарных файлов Frida (`/data/local/tmp/frida-server`) и перехвата процессов через `/proc/self/maps`.
- **Проверка Package Name:** Гарантируется совпадение имени пакета `ru.wfllive.nova`.

### 3. Обфускация и минимизация R8 / ProGuard

В `android/app/proguard-rules.pro` настроены строгие правила обфускации:
- Включено сжатие ресурсов (`shrinkResources true`) и кода (`minifyEnabled true`).
- Классы, методы и переменные переименовываются.
- Удаляются отладочные логи (`Log.d`, `Log.v`, `Log.i`) в релизной сборке.
- Скрываются имена исходных файлов (`-renamesourcefileattribute SourceFile`).
- Код React Native JavaScript компилируется в байткод **Hermes**, предотвращая чтение исходного кода в assets.

---

## 3. Защита и подпись проектов, создаваемых внутри Конструктора

Приложения, создаваемые пользователями в NovaCompose Studio, также подлежат защите и подписи.

### Создание ключа подписи для создаваемого проекта:

В терминале NovaCompose Studio выполните:

```bash
rai keystore create <ИмяПроекта>
```

Скрипт:
1. Создаст 30-летний RSA 2048/4096 ключ в защищенной директории `~/.rai/keystores/`.
2. Извлечет SHA-256 отпечаток ключа.
3. Создаст `keystore.properties` внутри проекта.
4. Включит V1, V2 и V3 схемы цифровой подписи Android.

### Проверка подписи готового APK:

```bash
rai keystore verify app-release.apk
```

---

## 4. Особенности публикации в Google Play и RuStore

### Google Play App Signing

Если в Google Play включена функция **Google Play App Signing**:
1. Вы подписываете и загружаете AAB/APK своим **Upload Key** (ключом загрузки).
2. Google Play переподписывает приложение своим **App Signing Key**.
3. В этом случае для защиты от мод в `expectedSha256` указывается **SHA-256 отпечаток из Google Play Console** (раздел *Release -> App integrity*), а не локального Upload-ключа.

### RuStore

В RuStore приложение публикуется с вашей прямой подписью из `.jks`/`.keystore` файла. В `expectedSha256` указывается SHA-256 вашего локального ключа релиза.

---

## 5. Главные правила безопасности

1. **Никогда не теряйте файл ключа (`release.keystore`) и пароли.** Потеря ключа означает невозможность выпустить обновление приложения в магазинах.
2. **Создайте резервную копию** `.keystore` файла и `keystore.properties` в надежном зашифрованном хранилище.
3. **Не коммитьте секреты в Git.** Файлы `*.keystore`, `*.jks` и `keystore.properties` должны находиться в `.gitignore`.
