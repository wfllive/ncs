# Сборка проектов Java + XML — Storm Build (без Gradle)

Каждый сгенерированный проект собирается **кастомным сборщиком
[Storm Build](https://github.com/wfllive/Storm-Build)**, который вендорен в
этом репозитории (папка `storm/`) и зашит в APK конструктора (установка
офлайн). Пайплайн: `aapt2 → javac → d8/R8 → zipalign → apksigner`, плюс
**AAB** для магазинов, **Maven-зависимости** и слияние манифестов.

`build.sh` в корне проекта — тонкая обёртка над `storm`:

## Задачи

```bash
bash build.sh            # = debug: storm build apk --d8
bash build.sh release    # storm build apk --release --r8 (нужен ключ)
bash build.sh aab        # storm build aab --release --r8 (Google Play / RuStore)
bash build.sh keystore   # storm keygen — создаёт и прописывает ключ в storm.m
bash build.sh clean      # storm clean
DRY_RUN=1 bash build.sh  # прогон без SDK (используется в тестах)
```

## Ключ подписи

```bash
bash build.sh keystore   # один раз: release.keystore + блок в storm.m
bash build.sh release    # подписанный релиз
```

> Перед публикацией смените пароли (`storm.m → signing release`) и сохраните
> `release.keystore` — без него обновления не установить.

## Зависимости (экран «Пакеты» или терминал)

```bash
storm deps add androidx.appcompat:appcompat:1.6.1
storm deps fetch          # сборка делает это автоматически
```

## Где что берётся

- **инструменты сборки ставит сам `storm setup`** в `~/.storm/tools`:
  aapt2 (статический бинарник под архитектуру), `android.jar`, `r8.jar`,
  `bundletool.jar`. Gradle и отдельный Android SDK не требуются;
- если на устройстве уже есть `ANDROID_HOME`/`~/android-sdk` (например, от
  прежней установки), Storm использует его — повторных скачиваний нет;
- JDK 17 (`javac`, `keytool`, `jarsigner`) и python3 ставит установщик через
  `apt` (шаг «JDK 17, python3, утилиты»);
- `storm.m` — манифест проекта (пакет, версии, пути, подпись, зависимости);
  `plugin.auto false` — обновления плагина без сети не предпринимаются;
- если точного `android.jar` под `compile` нет, Storm попробует докачать его
  в `~/.storm/tools`, иначе возьмёт любую доступную платформу.

## Артефакты

`build/outputs/<имя>-debug|release.apk|.aab` + копия в
`/sdcard/Download/NovaJava/<проект>/apk/`.

## Тесты пайплайна (на компьютере, без телефона)

```bash
npm test    # генератор проектов + build.sh (синтаксис, DRY_RUN) + превью + вендорный движок
```
