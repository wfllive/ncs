# RAI — vendored (исходники в этом репозитории)

RAI (Rapid Android on ARM) больше **не зависит от GitHub-репозитория**:
полные исходники лежат здесь, в `rai/`, и приложение запускает их локально.

## Структура

```
rai/
├── src/                  ← исходники CLI (Node.js, без зависимостей)
│   ├── index.js          ← точка входа
│   ├── commands.js       ← команды (build, install, status, …)
│   ├── run.js            ← запуск shell-модулей
│   ├── state.js          ← состояние/диагностика
│   ├── ui.js, env.js, projects.js, update.js
│   └── shell/            ← shell-модули (install/base, install/sdk, project/*, …)
├── scripts/build.js      ← сборщик бандла (node scripts/build.js release)
├── rai.sh                ← собранный бандл (установочный артефакт)
├── rai.sh.sha256         ← его SHA-256
├── version.json          ← метаданные релиза (версия, sha256)
└── package.json / README.md / LICENSE / NOTICE / …
```

## Как это запускается в приложении

1. `rai.sh` — самодостаточный бандл: первый запуск `bash rai.sh` распаковывает
   CLI в `~/.rai/<версия>/bin/rai.js` и создаёт команду `rai` в `PATH`.
   Скачиваний с GitHub при этом нет — весь код внутри файла.
2. Конфиг-плагин `plugins/with-rai-bundle.js` кладёт `rai.sh` в assets модуля
   `apt-manager`: `modules/apt-manager/android/src/main/assets/rai/rai.sh`.
   Папка `modules/` не перегенерируется `expo prebuild` (в отличие от `android/`),
   поэтому копия не пропадает даже при `expo prebuild --clean`.
3. Нативный модуль `apt-manager` (`seedRaiBundle`) копирует его в rootfs:
   `/root/rai/rai.sh` (assets библиотечного модуля сливаются в APK при сборке).
4. Страница «Установка RAI» выполняет `bash /root/rai/rai.sh`, затем
   `rai install base`, `rai install sdk`, `rai status` — всё локально.

## Откуда что скачивается (после удаления GitHub-репо RAI)

| Что | Источник | Зависит от wfllive-official/rai? |
|---|---|---|
| CLI / бандл RAI | встроен в APK (эта папка) | нет |
| Android SDK (ARM) | `RAI_SRC_SDK_DL` (по умолчанию github.com/HomuHomu833/android-sdk-custom) | **нет** |
| Ubuntu packages | ports.ubuntu.com | нет |
| Gradle | services.gradle.org / gradle/gradle | нет |

Все адреса — в `src/shell/lib/sources.sh`, каждую можно переопределить
переменной окружения (например, `RAI_SRC_SDK_REPO`, `RAI_SRC_SDK_DL`).

## Как править и пересобрать

```bash
# правим src/…, затем:
cd rai
node scripts/build.js release        # → build/release/rai.sh (новый отпечаток)
cp build/release/rai.sh rai.sh
cp build/release/rai.sh.sha256 rai.sh.sha256
# обновить version.json (sha256, published)
# копия для APK обновится сама при следующем expo prebuild; можно и вручную:
cp rai.sh ../modules/apt-manager/android/src/main/assets/rai/rai.sh
```

Запуск из исходников (без бандла):

```bash
node src/index.js <команда>     # RAI_HOME вычисляется от src/
# или в rootfs: /usr/local/bin/rai → node /root/rai/src/index.js
```

`rai update` и проверка обновлений обращаются к GitHub и после удаления
репозитория работать не будут (внутри приложения проверки пропускаются —
вывод не TTY). Обновление RAI = правка `src/` + пересборка бандла здесь.
