# Первый запуск: Ubuntu → среда сборки (Storm Build) → проекты

После установки Ubuntu (rootfs) приложение открывает страницу **«Установка
среды»**, которая готовит всё для кастомной сборки без Gradle. **RAI в этом
процессе больше не участвует** — весь пайплайн обеспечивает вендоренный
сборщик [Storm Build](https://github.com/wfllive/Storm-Build).

> **Storm вендорен в этот репозиторий** — папка `storm/` (исходники движка и
> шаблоны). Плагин `plugins/with-storm-bundle.js` при `expo prebuild` пакует
> его в `modules/apt-manager/android/src/main/assets/storm/storm-bundle.zip`;
> нативный модуль копирует архив в rootfs (`/root/storm-bundle.zip`), и
> установка запускается локально — без GitHub.

## Что выполняется (по шагам)

```
1. apt update                   ← БЕЗ полного «apt upgrade» (экономия минут)
2. apt install -y --no-install-recommends openjdk-17-jdk-headless python3
                                 curl wget zip unzip ca-certificates
3. Storm Build                  ← бандл из APK → /root/storm-bundle.zip,
                                   распаковка в /root/storm + лаунчер в PATH
4. storm setup --api 34         ← сам качает aapt2, android.jar, r8.jar,
                                   bundletool.jar в ~/.storm/tools
5. Проверка окружения           ← Java + aapt2 + платформа
6. touch /root/.storm-setup.done← маркер готовности
```

Что убрано и почему:

- **`apt upgrade -y`** — самый долгий шаг (сотни пакетов), для сборки не нужен;
- **Node.js** — проекты на Java + XML, npm/Vite больше не используются;
- **RAI** (`rai install base/sdk/status`) — его роль (JDK, SDK, инструменты)
  теперь выполняют один вызов `apt` и `storm setup`;
- отдельный **Android SDK** — не требуется: aapt2/android.jar/r8/bundletool
  Storm кладёт в `~/.storm/tools`. Если старый SDK уже стоит
  (`~/android-sdk`), он используется без повторных скачиваний.

После успешной проверки приложение переходит на главный экран со списком
проектов. Если установку прервали (приложение закрыли) — при следующем запуске
готовые шаги пропускаются, установка продолжается с места обрыва.

## Откуда берётся Storm

- Исходники: `storm/` в корне репозитория (движок `storm_engine/`, шаблоны
  `templates/`).
- Конфиг-плагин `plugins/with-storm-bundle.js` при `expo prebuild` собирает
  `storm-bundle.zip` и кладёт его в assets модуля `apt-manager` (это место
  prebuild не перегенерирует).
- Нативный модуль `apt-manager` (`seedStormBundle`) при установке копирует
  архив в rootfs: `/root/storm-bundle.zip`.
- Шаг установки распаковывает его в `/root/storm` и ставит лаунчер
  `/usr/local/bin/storm`.

Зеркала, откуда `storm setup` качает инструменты, описаны в
`storm/storm_engine/env.py` (android.jar, aapt2, r8.jar, bundletool.jar).

## Фоновый режим

- Во время установки и сборки работает **foreground service**
  (`BackgroundWorkService`) с уведомлением и wakelock'ом: можно свернуть
  приложение или заблокировать экран — процесс не убьют.
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

Кнопка «Разрешить доступ» — на странице установки среды и в разделе
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
2. живой зонд среды (JDK + aapt2 + android.jar)? да → сразу список проектов;
   нет → страница установки среды (незавершённые шаги пропустятся).
