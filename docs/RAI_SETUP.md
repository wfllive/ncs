# Первый запуск: Ubuntu → RAI → проекты

После установки Ubuntu (rootfs) приложение открывает страницу **«Установка RAI»**,
которая выполняет скрипт установки из README RAI.

> **RAI вендорен в этот репозиторий** — папка `rai/` (исходники + собранный
> бандл `rai.sh`). GitHub-репозиторий RAI для работы не нужен: бандл лежит в
> assets модуля `apt-manager` (`modules/apt-manager/android/src/main/assets/rai/rai.sh`),
> нативный модуль копирует его в rootfs (`/root/rai/rai.sh`), и установка
> запускается локально. Место выбрано так, чтобы `expo prebuild --clean` его
> не трогал (prebuild пересоздаёт только `android/`, а не `modules/`).

## Что выполняется (по шагам)

Ускоренный профиль под проекты **Java + XML с кастомной сборкой (без Gradle)**:

```
1. apt update                   ← БЕЗ полного «apt upgrade» (экономия минут)
2. apt install -y --no-install-recommends curl wget zip unzip ca-certificates python3
3. bash /root/rai/rai.sh        ← локальный бандл из APK, GitHub не нужен
4. rai install base --no-upgrade← JDK 17 + настройки proot (без повторного upgrade)
5. rai install sdk              ← нативный ARM Android SDK
6. Storm Build                  ← бандл из APK → /root/storm-bundle.zip,
                                   распаковка в /root/storm + лаунчер в PATH
7. rai status                   ← проверка: Java + build-tools + platforms
8. touch /root/.rai-setup.done  ← маркер готовности
```

Что убрано относительно старого профиля и почему:

- **`apt upgrade -y`** — самый долгий шаг (сотни пакетов). Для сборки он не
  нужен, достаточно `apt update`;
- **Node.js** — проекты больше не используют npm/Vite (они на Java + XML),
  поэтому и сам `node`, и `npm install` при создании проекта удалены;
- `rai install base` вызывается с **`--no-upgrade`**, чтобы не повторять
  полный апгрейд внутри.

Сборка проектов идёт кастомным сборщиком **Storm Build** (вендорен в `storm/`,
бандл зашит в assets APK как `storm/storm-bundle.zip`, нативный модуль
`seedStormBundle` копирует его в rootfs — как бандл RAI).

После успешного `rai status` приложение переходит на главный экран со списком
проектов. Если установку прервали (приложение закрыли) — при следующем запуске
готовые шаги пропускаются, установка продолжается с места обрыва.

## Откуда берётся RAI

- Исходники и бандл: `rai/` в корне репозитория (см. `rai/README.md` — как
  править и пересобирать).
- Конфиг-плагин `plugins/with-rai-bundle.js` кладёт `rai/rai.sh` в assets
  модуля `apt-manager` при `expo prebuild`:
  `modules/apt-manager/android/src/main/assets/rai/rai.sh` (это место prebuild
  не перегенерирует).
- Нативный модуль `apt-manager` (`seedRaiBundle`) при первом запуске копирует
  бандл в rootfs: `/root/rai/rai.sh`.
- Страница установки запускает `bash /root/rai/rai.sh` — первый запуск сам
  ставит CLI в `~/.rai/<версия>` и лаунчер `rai` в `PATH`.

`rai install sdk` качает нативный ARM SDK из
`github.com/HomuHomu833/android-sdk-custom` (а не из репозитория RAI), адреса
всех источников — в `rai/src/shell/lib/sources.sh`, каждую можно переопределить
переменной окружения.

## Фоновый режим

- Во время установки и сборки работает **foreground service**
  (`BackgroundWorkService`) с уведомлением «Compose Studio — …» и wakelock'ом:
  можно свернуть приложение или заблокировать экран — процесс не убьют.
- Каждый шаг идемпотентен и проверяется при старте.
- Управление: `src/utils/background.ts` (start/update/stop), нативно —
  `AptManagerModule` + `BackgroundWorkService.kt`.

## Разрешение «Память»

Для сохранения собранных APK в `/sdcard/Download` (и видимости `/sdcard` внутри
proot) приложение просит:

- **Android 11+ (API 30+)**: «All files access» (`MANAGE_EXTERNAL_STORAGE`) —
  открывается системная страница разрешения;
- **Android 10 и ниже**: классический runtime-диалог
  (`READ/WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_*` на 13+).

Кнопка «Разрешить доступ» — на странице установки RAI и в разделе
«Настройки → Память и фон».

## Права и служба в манифесте

- `modules/apt-manager/android/src/main/AndroidManifest.xml`:
  `MANAGE_EXTERNAL_STORAGE`, `READ_MEDIA_*`, `POST_NOTIFICATIONS`,
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `WAKE_LOCK`,
  `<service android:name=".BackgroundWorkService" … foregroundServiceType="dataSync">`.
- Манифест приложения (`android/app/src/main/AndroidManifest.xml`) дополнен
  теми же permissions через сборку.

## Перезапуск приложения

`App.tsx` при старте проверяет:

1. rootfs установлен? нет → страница установки Ubuntu;
2. маркер `/root/.rai-setup.done` (или полный `rai status`)? да → сразу список
   проектов; нет → страница установки RAI (незавершённые шаги пропустятся).
