# Разработка RAI

Всё, что нужно знать, если вы правите код RAI, а не собираете им приложения.
Про выпуск релиза — [PUBLISHING.md](PUBLISHING.md).

---

## Идея

RAI — это **JS-проект**, который сборщик превращает в **один исполняемый `.sh`**.
Пользователь получает единственный файл: ни npm, ни архивов, ни зависимостей.

```
исходники (JS + shell)  →  scripts/build.js  →  rai-3.0.0.sh
```

---

## Структура

```
rai/
├── CHANGELOG.md          ← ЕДИНСТВЕННОЕ место, где задаётся версия
├── package.json          подтягивается за CHANGELOG автоматически
├── version.json          генерируется сборкой
│
├── src/
│   ├── index.js          точка входа: RAI_HOME, версия, обработка ошибок
│   ├── commands.js       разбор команд и справка
│   ├── env.js            среда, Java, архитектура ELF
│   ├── state.js          состояние: SDK, проекты
│   ├── projects.js       список проектов, разбор APK
│   ├── update.js         проверка и установка обновлений
│   ├── run.js            запуск shell-модулей
│   ├── ui.js             оформление вывода
│   │
│   └── shell/            ← SHELL-МОДУЛИ, обычные .sh файлы
│       ├── index.js      список MODULES + загрузчик
│       ├── lib/          common · sources · sdk · integrity · report · version
│       ├── install/      bootstrap · sdk · rootfs · termux
│       ├── project/      new · prepare · keystore · build-debug · build-release
│       └── doctor/       preflight · full · fixes/{java-home,licenses,abi-conflict}
│
├── scripts/build.js      сборщик
│
└── build/                ← результат, в .gitignore
    ├── debug/rai-debug.sh
    └── release/{rai-3.0.0.sh, .sha256, version.json}
```

Shell-модули — **настоящие `.sh` файлы**. Подсветка синтаксиса, `bash -n`
и `shellcheck` работают как обычно, никаких экранированных строк внутри JS.

---

## Запуск и сборка

```bash
npm start -- status          # запуск из исходников, без сборки
node src/index.js help

npm run build:debug          # build/debug/rai-debug.sh
npm run build:release        # build/release/rai-3.0.0.sh
npm run build                # обе сразу
npm run clean                # удалить build/
```

### Разница между debug и release

| | debug | release |
|---|---|---|
| Имя файла | `rai-debug.sh` | `rai-<версия>.sh` |
| Комментарии в JS | сохранены | вырезаны |
| При запуске | печатает `[debug] RAI v… · путь` | молча |
| Каталог распаковки | `~/.rai/<версия>-debug` | `~/.rai/<версия>` |
| `RAI_DEBUG` | `=1`, показывает стек ошибок | не задан |
| Назначение | проверить, что всё работает | раздавать людям |

Обе сборки живут рядом и не мешают друг другу.

---

## Что делает сборщик

Четыре шага, каждый с проверкой:

| # | Шаг | Что именно |
|---|---|---|
| 1 | Проверка исходников | `node --check`, корректность путей `require`, `bash -n` для **всего** shell-кода, пробный `npm start` |
| 2 | JS-бандл | модули склеиваются вместе с содержимым всех `.sh` |
| 3 | Генерация | `.sh` с двумя base64-нагрузками и заголовком |
| 4 | Проверка результата | синтаксис `.sh`, самопроверка целостности, запуск `-v`, `help`, `sources` |

```
── 4/4  Проверка результата ────────────────
 OK  синтаксис .sh
 OK  самопроверка целостности
 OK  запуск: RAI v3.0.0
 OK  команды доступны
 OK  shell-модули порождаются из JS
 OK  version.json (v3.0.0) — в build/release/ и в корне
```

Сборка **не завершится**, если хоть один файл не проходит проверку —
нерабочая версия не уйдёт пользователям.

---

## Как устроен готовый `.sh`

```
#!/usr/bin/env bash
# заголовок: версия, дата сборки, отпечаток, SHA-256
...функции: _verify, _extract, _need_node, _do_install...
case "$1" in --verify|--install|--info|--uninstall|--update) ... esac
exec node "$RAI_HOME/bin/rai.js" "$@"

#RAI_JS_START
<base64: весь JS-код>
#RAI_JS_END
#RAI_SH_START
<base64: 20 shell-модулей>
#RAI_SH_END
```

При первом запуске распаковывается в `~/.rai/<версия>`, дальше работает оттуда.
Повторный запуск сверяет `.stamp` и заново не распаковывает.

Shell-модули материализуются в `~/.rai/work/<хеш>` — каталог привязан к
содержимому, правка исходников создаёт новый, старые копии не используются.

| Когда | Откуда берётся shell-код |
|---|---|
| разработка (`npm start`) | читается с диска из `src/shell/` |
| сборка | `scripts/build.js` встраивает содержимое в бандл |
| готовый `.sh` | из встроенной таблицы, разворачивается в `~/.rai/work/<хеш>` |

---

## Добавить shell-модуль

1. создать файл, например `src/shell/lib/new-thing.sh`
2. добавить путь в массив `MODULES` в `src/shell/index.js`
3. вызывать через `run.sh('lib/new-thing.sh', [args])`

Сборщик сам проверит синтаксис и встроит его.

---

## Добавить команду

Всё в `src/commands.js`, функция `dispatch`:

```js
case 'мояКоманда':  return run.sh('lib/my-thing.sh', args);
```

И строку в `usage()`, чтобы она попала в `rai help`.

---

## Зачем нужен `index.js`

Точка входа из `package.json` (`main` и `bin`). Делает три вещи:

1. **Определяет `RAI_HOME`** — при `npm start` от пути файла,
   в собранном `.sh` из окружения.
2. **Определяет версию и режим** — из `package.json` либо из константы в бандле.
3. **Ловит ошибки** — падение превращается в понятное сообщение,
   в debug-сборке дополнительно показывается стек.

---

## Целостность и защита

В `.sh` встроен SHA-256 полезной нагрузки. Проверено практикой: подмена
адреса репозитория SDK внутри base64 —

```
✘ Содержимое изменено — это не официальная сборка
код возврата: 1
```

Что важно понимать:

- **Обфускация и компиляция не защищают.** Проверялось: base64 в bash
  вскрывается одной командой, `strings` по Go-бинарнику с `-ldflags="-s -w"`
  находит и ключи, и URL.
- Работает только **обнаружение**, а не сокрытие. Цель — не спрятать код
  (он и так под MIT), а иметь возможность сказать «это не моя сборка».

Список источников загрузки зафиксирован в `src/shell/lib/sources.sh`.
Его правка меняет отпечаток и видна в `rai verify` и `rai report`.

---

## Переменные окружения

Полезны при отладке и в тестах.

| Переменная | Назначение |
|---|---|
| `RAI_HOME` | каталог установленного кода |
| `RAI_PROJECTS` | где лежат проекты (по умолчанию `~/projects`) |
| `ANDROID_HOME` | каталог SDK |
| `RAI_WORK` | каталог развёрнутых shell-модулей |
| `RAI_REPO` | репозиторий для обновлений, например `wfllive-official/rai` |
| `RAI_BRANCH` | ветка для запасного манифеста |
| `RAI_RAW_BASE` | база `raw.githubusercontent.com` |
| `RAI_MANIFEST_URL` | прямой адрес `version.json` |
| `RAI_DL_BASE` | база для скачивания файла релиза |
| `RAI_NO_UPDATE_CHECK=1` | не проверять обновления |
| `RAI_UPDATE_TTL` | период проверки в мс (по умолчанию сутки) |
| `RAI_NO_AUTOINSTALL=1` | не устанавливать себя при первом запуске |
| `RAI_QUIET=1` | короткий вывод |
| `RAI_DEBUG=1` | стек ошибок |
| `RAI_YES=1` | не задавать вопросов |
| `RAI_SRC_SDK_REPO` · `RAI_SRC_GOOGLE_REPO` · `RAI_SRC_GRADLE_DIST` · `RAI_SRC_UBUNTU_BASE` | подмена источников загрузки |

---

## Технические заметки

Собраны из практики, чтобы не наступать на те же грабли.

### Android SDK на ARM

- Google публикует build-tools **только под x86_64** → `error=8, Exec format error`.
- Нативные ARM-сборки: [HomuHomu833/android-sdk-custom](https://github.com/HomuHomu833/android-sdk-custom),
  лицензия MIT, собраны из AOSP. Актуальный релиз 37.0.0.
- Варианты libc: 37.0.0 и 36.0.2 есть в musl/gnu/android; 36.0.0 и 35.0.2 — только musl.
- `platforms;android-XX` архитектурно-независимы, качаются напрямую у Google.
- Лицензии SDK — это файлы с SHA-1 хэшем, пишутся напрямую, `sdkmanager` не нужен.
- `yes | sdkmanager` зависает → нужно `< /dev/null`.

### Совместимость версий

| Профиль | AGP | Gradle | Kotlin | compileSdk |
|---|---|---|---|---|
| STABLE | 8.13.2 | 8.14.5 | 2.2.21 | 35 |
| MODERN | 9.3.1 | 9.6.1 | 2.4.10 | 37 |

- **AGP 9 содержит встроенный Kotlin** — плагин `org.jetbrains.kotlin.android`
  применять нельзя, сборка падает. Compose-плагин
  `org.jetbrains.kotlin.plugin.compose` остаётся.
- `ndk.abiFilters` + `splits.abi` вместе → конфликт. Нужен только `abiFilters`.
- `kotlinOptions { jvmTarget }` устарел →
  `kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }`.
- Compose BOM 2026.06.01 требует `minCompileSdk=35`;
  `core-ktx 1.17.0+` и `activity-compose 1.11.0+` — compileSdk 36.

### proot и rootfs

- `/tmp` после распаковки имеет чужого владельца → apt выдаёт обманчивое
  `repository is not signed`. Фикс: `chmod 1777 /tmp /var/tmp`.
- apt роняет права до `_apt` → списки пустые. Фикс: `APT::Sandbox::User "root"`.
- В ubuntu-base нет `gpgv` → первый заход с `--allow-unauthenticated`,
  затем обязательно повторный `apt update`.
- У root в Ubuntu `.profile` не подключает `.bashrc` → login-оболочка
  теряет переменные.
- JVM виснет на `/dev/random` → `securerandom.source=file:/dev/./urandom`.
- Команда `file` в Termux обычно отсутствует → архитектуру ELF читаем
  байтом `e_machine` (183 = aarch64, 62 = x86_64).
- bash кэширует пути команд → после переустановки нужен `hash -r`.

### Обновления через GitHub

- API без токена — лимит 60 запросов в час, ответ ~200 мс.
- `raw.githubusercontent.com` — без лимита, ~120 мс, кэш CDN 5 минут.
- `github.com/<repo>/releases/latest/download/<file>` отдаёт 302 на
  актуальный тег. Значит `version.json` можно класть **в релиз**,
  коммитить в ветку не обязательно.
