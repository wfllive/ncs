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

- `ANDROID_HOME` (или `~/android-sdk`) — SDK от `rai install sdk`:
  `build-tools/*` (aapt2, d8, zipalign, apksigner) и `platforms/*`;
- JDK 17 — от `rai install base --no-upgrade`;
- `storm.m` — манифест проекта (пакет, версии, пути, подпись, зависимости);
  `plugin.auto false` — обновления плагина без сети не предпринимаются;
- если точного `android.jar` под `compile` нет, Storm попробует докачать его
  в `~/.storm/tools`, иначе возьмёт любую установленную платформу.

## Артефакты

`build/outputs/<имя>-debug|release.apk|.aab` + копия в
`/sdcard/Download/NovaJava/<проект>/apk/`.

## Тесты пайплайна (на компьютере, без телефона)

```bash
npm test    # генератор проектов + build.sh (синтаксис, DRY_RUN) + превью + вендорный движок
```
