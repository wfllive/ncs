# `PROOT_SETUP.md`

```markdown
# 🐧 Linux в Android-приложении через proot

Полная инструкция по сборке, установке и использованию proot для запуска
полноценного Linux (Ubuntu arm64) внутри Android-приложения.

---

## 📋 Оглавление

1. [Обзор архитектуры](#обзор-архитектуры)
2. [Что в комплекте](#что-в-комплекте)
3. [Требования](#требования)
4. [Сборка proot](#сборка-proot)
5. [Структура файлов](#структура-файлов)
6. [Как это работает](#как-это-работает)
7. [Troubleshooting](#troubleshooting)
8. [Часто задаваемые вопросы](#часто-задаваемые-вопросы)
9. [Для разработчиков](#для-разработчиков)

---

## Обзор архитектуры

### Проблема

На Android 10+ приватные данные приложения лежат на `noexec`-разделе.
Любой бинарник, извлечённый в `filesDir`, нельзя запустить через `execve()`.
На Huawei/EMUI/HarmonyOS ограничения ещё жёстче — SELinux блокирует exec
даже из `code_cache` и `cacheDir`.

### Решение

```
┌─────────────────────────────────────────────────────────┐
│                    Android App                          │
│                                                         │
│  nativeLibraryDir (ЕДИНСТВЕННОЕ exec-разрешённое место) │
│    ├── libproot.so           ← главный бинарь proot     │
│    └── libproot-loader.so    ← ELF-loader (static)      │
│                                                         │
│  filesDir                                               │
│    └── proot/rootfs/         ← Ubuntu arm64 rootfs       │
│         ├── bin/bash                                     │
│         ├── usr/bin/...                                  │
│         ├── lib/...                                      │
│         └── etc/...                                      │
│                                                         │
│  filesDir/proot-tmp/         ← PROOT_TMP_DIR             │
│                                                         │
│  Runtime:                                               │
│    PROOT_LOADER  → nativeLibraryDir/libproot-loader.so  │
│    PROOT_TMP_DIR → filesDir/proot-tmp                   │
│    PROOT_NO_SECCOMP → 1                                 │
└─────────────────────────────────────────────────────────┘
```

### Почему именно так

| Проблема | Решение |
|---|---|
| `filesDir` = noexec | proot лежит в `nativeLibraryDir` (exec разрешён) |
| Termux proot зависит от `libandroid-shmem.so` | Собираем свой proot без этой зависимости |
| `libtalloc.so.2` — нестандартное имя для Android | Линкуем talloc статически |
| SELinux блокирует exec ELF из tmp | Отдельный loader в `nativeLibraryDir` |
| `RUNPATH` указывает на Termux | Удаляем через `patchelf --remove-rpath` |

---

## Что в комплекте

### Бинарники (в `jniLibs/arm64-v8a/`)

| Файл | Описание | Тип |
|---|---|---|
| `libproot.so` | Главный proot (314 KB) | Dynamic ELF, bionic-only |
| `libproot-loader.so` | Loader для proot (18 KB) | Static ELF |

### DT_NEEDED у `libproot.so` (только системные Android библиотеки)

```
libc.so      ← bionic C library (всегда есть)
libdl.so     ← dynamic linker interface (всегда есть)
libm.so      ← math library (всегда есть)
liblog.so    ← Android logging (всегда есть)
```

**Никаких** `libandroid-shmem.so`, `libtalloc.so`, `libutil.so`.

### Исходники / скрипты

| Файл | Назначение |
|---|---|
| `scripts/build-proot-termux.sh` | Сборка proot + loader в Termux |
| `ProotEnvironment.kt` | Kotlin-объект для запуска proot |
| `TermuxTerminalModule.kt` | Expo-модуль с API для JS |
| `TerminalEnvironment.kt` | Выбор shell (proot vs host) |
| `TermuxTerminalView.kt` | Нативная view терминала |

---

## Требования

### Для сборки proot (в Termux на телефоне)

```bash
pkg install -y git make wget curl file patchelf clang binutils
```

### Для сборки приложения

- Node.js + npm
- Expo CLI / EAS
- Android SDK (compileSdk 36, minSdk 24)

### Поддерживаемые устройства

- **CPU**: arm64-v8a (aarch64)
- **Android**: 7.0+ (API 24+)
- **Проверено на**: Huawei/EMUI, HarmonyOS, Samsung, Pixel

---

## Сборка proot

### Быстрый старт (5 минут)

```bash
# 1. Откройте Termux на телефоне
# 2. Перейдите в проект
cd ~/skpro

# 3. Установите зависимости (один раз)
pkg install -y git make wget curl file patchelf clang binutils

# 4. Сделайте скрипт исполняемым (один раз)
chmod +x scripts/build-proot-termux.sh

# 5. Соберите
./scripts/build-proot-termux.sh
```

### Что происходит при сборке

```
Шаг 1: Скачивается talloc 2.4.2 (663 KB)
        → собирается libtalloc.a (статическая библиотека)

Шаг 2: Клонируется github.com/termux/proot
        → это форк proot с Android-патчами (ptrace, seccomp, fake_id0)

Шаг 3: Из GNUmakefile удаляются:
        -landroid-shmem  (Termux-only, SIGSEGV в чужом приложении)
        -ltalloc          (заменяем на статическую libtalloc.a)
        -lutil            (нет в bionic)
        → добавляется: libtalloc.a -lc -ldl -lm -llog

Шаг 4: Компиляция через Termux clang
        → результат: proot (314 KB) + loader (18 KB)

Шаг 5: patchelf --remove-rpath (убирает Termux-путь)

Шаг 6: Копирование в jniLibs/arm64-v8a/
        libproot.so
        libproot-loader.so
```

### Ожидаемый результат

```
═════════════════════════════════════════════════════════
  ✓ Built proot + loader for arm64-v8a
-rwxr-xr-x  314552  libproot.so
-rwxr-xr-x   18232  libproot-loader.so
═════════════════════════════════════════════════════════
```

### Верификация

```bash
# Проверить зависимости (должны быть ТОЛЬКО bionic)
readelf -d modules/termux-terminal/android/src/main/jniLibs/arm64-v8a/libproot.so | grep NEEDED

# Ожидаемый результат:
#   [libc.so]
#   [libdl.so]
#   [libm.so]
#   [liblog.so]

# Проверить, что RUNPATH удалён
readelf -d modules/termux-terminal/android/src/main/jniLibs/arm64-v8a/libproot.so | grep RUNPATH
# (пусто = ок)

# Проверить loader
file modules/termux-terminal/android/src/main/jniLibs/arm64-v8a/libproot-loader.so
# ELF 64-bit LSB executable, ARM aarch64, statically linked
```

### Пересборка

Если нужно пересобрать (обновился proot, новая версия talloc, и т.д.):

```bash
# Удалить кеш proot (talloc можно оставить)
rm -rf ~/.cache/build-proot-termux/proot

# Пересобрать
./scripts/build-proot-termux.sh
```

Для полной чистой пересборки:

```bash
rm -rf ~/.cache/build-proot-termux
./scripts/build-proot-termux.sh
```

---

## Структура файлов

```
project/
├── scripts/
│   └── build-proot-termux.sh          ← сборка proot (САМЫЙ ВАЖНЫЙ ФАЙЛ)
│
├── modules/termux-terminal/
│   └── android/
│       ├── build.gradle                ← packaging: useLegacyPackaging, keepDebugSymbols
│       └── src/main/
│           ├── jniLibs/arm64-v8a/
│           │   ├── libproot.so         ← proot binary (git-ignored, но есть в сборке)
│           │   └── libproot-loader.so  ← loader ELF
│           │
│           └── java/expo/modules/termuxterminal/
│               ├── ProotEnvironment.kt     ← запуск proot, env, диагностика
│               ├── TermuxTerminalModule.kt ← Expo API (execute, diagnose, etc)
│               ├── TerminalEnvironment.kt  ← выбор shell (proot vs host)
│               └── TermuxTerminalView.kt   ← нативная view терминала
│
├── PROOT_SETUP.md                      ← эта документация
└── ...
```

---

## Как это работает

### Runtime: запуск proot из приложения

```kotlin
// ProotEnvironment.kt упрощённо:

// 1. Находим бинарники
val proot  = File(nativeLibraryDir, "libproot.so")
val loader = File(nativeLibraryDir, "libproot-loader.so")
val rootfs = File(filesDir, "proot/rootfs")

// 2. Находим exec-разрешённую tmp-директорию
val tmpDir = findExecTmpDir(context) // пробует filesDir, rootfs/tmp, cacheDir, codeCacheDir

// 3. Формируем env
env["PROOT_LOADER"]     = loader.absolutePath  // ← ключевой момент!
env["PROOT_TMP_DIR"]    = tmpDir.absolutePath
env["PROOT_NO_SECCOMP"] = "1"

// 4. Формируем argv
// proot -r /rootfs -b /dev -b /proc -b /sys -b /sdcard:/sdcard --link2symlink -0 -w /root /bin/bash --login

// 5. Запускаем через ProcessBuilder / TerminalSession
```

### Порядок выбора shell в приложении

```
1. Есть ли rootfs + proot?
   → ДА → запускаем proot (полный Linux, apt, node, npm)
   → НЕТ → fallback:

2. Есть ли bootstrap shell в filesDir/usr/bin/bash?
   → ДА → используем его
   → НЕТ:

3. Есть ли Termux shell?
   → ДА → используем его
   → НЕТ:

4. /system/bin/sh (всегда работает, но минимальный)
```

### Диагностика

В приложении есть кнопка диагностики, которая запускает `ProotEnvironment.runSmokeTest()`:

```
=== proot --version ===
exit=0
proot v5.1.107.86-dirty

=== PROOT_LOADER: /data/.../lib/arm64/libproot-loader.so ===

=== proot probes ===
### A full-flags + /bin/true (exit=0)    ← ОК
### B full-flags + /bin/sh echo (exit=0) ← ОК, печатает "OK"
### C NO link2symlink + /bin/true (exit=0)
```

---

## Troubleshooting

### Проблема: `Segmentation fault` / exit 139

**Причина**: proot зависит от `libandroid-shmem.so` (Termux-only библиотека).

**Решение**: пересоберите через `build-proot-termux.sh` — он убирает эту зависимость.

**Проверка**:
```bash
readelf -d libproot.so | grep NEEDED
# НЕ должно быть libandroid-shmem.so или libtalloc.so
```

---

### Проблема: `execve("/usr/bin/bash"): Permission denied`

**Причина**: SELinux блокирует exec ELF из `PROOT_TMP_DIR` (обычно `code_cache`).

**Решение**: используйте внешний loader через `PROOT_LOADER`:
```kotlin
env["PROOT_LOADER"] = "$nativeLibraryDir/libproot-loader.so"
```

**Проверка**: `libproot-loader.so` должен существовать в `nativeLibraryDir`.

---

### Проблема: `can't create temporary file: No such file or directory`

**Причина**: `PROOT_TMP_DIR` не создан.

**Решение**:
```kotlin
File(codeCacheDir, "proot").mkdirs()
// или
File(filesDir, "proot-tmp").mkdirs()
```

---

### Проблема: proot vanilla (proot-me v5.3.0) exit 255

**Причина**: vanilla proot не имеет Android-патчей (ptrace, seccomp, bionic).

**Решение**: использовать только `termux/proot` форк (уже в нашем скрипте).

---

### Проблема: `unable to find library -lc` при сборке

**Причина**: используется флаг `-static`, а bionic не имеет статической libc.

**Решение**: собирать динамически, но только с bionic deps. Наш скрипт делает это правильно.

---

### Проблема: apt ошибки при установке пакетов

**Типичные ошибки**:
```
Errors were encountered while processing:
  ca-certificates
  npm
  libwww-perl
```

**Причина**: post-install скрипты пакетов пытаются делать вещи,
которые под proot не всегда работают (symlinks, update-ca-certificates).

**Решение**:
```bash
# Починить прерванные установки
dpkg --configure -a

# Переустановить проблемные пакеты
apt-get install -f -y

# Если ca-certificates не ставится:
mkdir -p /etc/ssl/certs
apt-get download ca-certificates
dpkg-deb -x ca-certificates_*.deb /
rm ca-certificates_*.deb
```

**Альтернатива для Node.js** — установка из официального tarball:
```bash
curl -L https://nodejs.org/dist/v20.11.1/node-v20.11.1-linux-arm64.tar.xz \
  | tar -xJ --strip-components=1 -C /usr/local
```

---

### Проблема: `RUNPATH` указывает на Termux

**Симптом**: `readelf -d` показывает Termux-путь в RUNPATH.

**Решение**:
```bash
patchelf --remove-rpath libproot.so
```

Наш build-скрипт делает это автоматически.

---

## Часто задаваемые вопросы

### Почему не использовать Termux proot напрямую?

Termux proot зависит от `libandroid-shmem.so` и `libtalloc.so.2`, которые:
1. Работают только в контексте UID/SELinux-домена Termux
2. В чужом приложении вызывают SIGSEGV (exit 139)
3. `libtalloc.so.2` — нестандартное имя, Android packaging его может потерять

### Почему не static proot?

Android bionic (`libc.so`) не имеет статической версии. Флаг `-static` приводит к
`unable to find library -lc`. Вместо этого мы линкуем динамически, но только с
системными библиотеками, которые гарантированно есть на каждом Android-устройстве.

### Почему нужен отдельный loader?

proot при первом `execve()` гостевого бинарника извлекает встроенный loader ELF
во временную папку и выполняет его. На строгих устройствах (Huawei/EMUI) SELinux
запрещает `execve()` любых новых ELF из директорий app data. Единственное
исключение — `nativeLibraryDir`. Поэтому loader кладётся туда заранее как
`libproot-loader.so`, а переменная `PROOT_LOADER` указывает proot на него.

### Можно ли использовать armhf rootfs?

Нет. Наш proot — 64-bit aarch64. Он может запускать только arm64 гостевые бинарники.
Rootfs должен быть `arm64` / `aarch64`.

### Работает ли apt внутри proot?

Да! `apt update`, `apt install` работают. Некоторые post-install скрипты пакетов
могут падать (ca-certificates, man-db), но сами бинарники устанавливаются корректно.
Используйте `dpkg --configure -a` для починки.

### Как обновить proot?

```bash
rm -rf ~/.cache/build-proot-termux/proot
./scripts/build-proot-termux.sh
# Затем пересобрать приложение
```

---

## Для разработчиков

### Kotlin API (ProotEnvironment)

```kotlin
// Проверка готовности
ProotEnvironment.isReady(context)         // proot + rootfs на месте?
ProotEnvironment.isProotBinaryAvailable() // libproot.so есть?
ProotEnvironment.isLoaderAvailable()      // libproot-loader.so есть?
ProotEnvironment.isRootfsInstalled()      // rootfs/bin/ существует?

// Архитектура
ProotEnvironment.prootArch(context)  // 64 или 32
ProotEnvironment.rootfsArch(context) // 64 или 32

// Интерактивная сессия (для TerminalSession)
val config = ProotEnvironment.build(context, workDir = "/root")
// config.prootPath = путь к libproot.so
// config.args      = ["proot", "-r", "/rootfs", ..., "/bin/bash", "--login"]
// config.env       = ["PROOT_LOADER=...", "PROOT_TMP_DIR=...", ...]
// config.cwd       = рабочая директория

// Фоновая команда
val proc = ProotEnvironment.buildCommandProcess(context, "node --version")
// proc.program = путь к libproot.so
// proc.argv    = ["-r", "/rootfs", ..., "/bin/bash", "-lc", "node --version"]
// proc.env     = Map<String, String>

// Диагностика
ProotEnvironment.runSmokeTest(context) // → String с полным отчётом
ProotEnvironment.inspectRootfs(context) // → String со снимком rootfs
ProotEnvironment.ensureRootfsExecutable(context) // → String, чинит +x биты
```

### JS API (через Expo module)

```javascript
import { TermuxTerminalModule } from './modules/termux-terminal';

// Статус
const status = await TermuxTerminalModule.getProotStatus();
// { prootBinary: true, rootfsInstalled: true, ready: true, ... }

// Диагностика
const diag = await TermuxTerminalModule.diagnoseProot();
// { ok: true, output: "...", prootExists: true, ... }

// Выполнить команду (внутри proot если rootfs есть)
const result = await TermuxTerminalModule.execute("node --version");
// { success: true, exitCode: 0, output: "v20.11.1\n" }

// Проверить наличие команды
const check = await TermuxTerminalModule.checkCommand("node");
// { exists: true, path: "/usr/bin/node" }

// Установить Node.js
const install = await TermuxTerminalModule.installNode();
// { success: true, output: "...", version: "v20.11.1" }
```

### build.gradle — критичные настройки

```gradle
packaging {
  jniLibs {
    useLegacyPackaging = true              // извлекать .so как реальные файлы
    keepDebugSymbols += [
      "**/libproot.so",                    // не strip'ить
      "**/libproot-loader.so",             // не strip'ить
    ]
  }
}

ndk {
  abiFilters "arm64-v8a"                   // только arm64
}
```

### Ключевые переменные окружения

| Переменная | Значение | Зачем |
|---|---|---|
| `PROOT_LOADER` | `nativeLibraryDir/libproot-loader.so` | Обход SELinux exec-запрета |
| `PROOT_TMP_DIR` | `filesDir/proot-tmp` | Временные файлы proot |
| `PROOT_NO_SECCOMP` | `1` | Отключение seccomp (compat) |
| `TMPDIR` | = PROOT_TMP_DIR | Стандартная tmp для утилит |
| `TERM` | `xterm-256color` | Цветной терминал |
| `HOME` | `/root` | Домашняя директория гостя |
| `PATH` | `/usr/local/sbin:...:/sbin:/bin` | Стандартный Linux PATH |

---

## История решения

Путь от идеи до рабочего решения:

1. ❌ Vanilla proot-me static aarch64 → exit 255 (нет Android-патчей)
2. ❌ Termux armhf proot → `64-bit program` ошибка (host shell 64-bit)
3. ❌ Termux aarch64 proot (dynamic) → SIGSEGV 139 (libandroid-shmem)
4. ❌ Скачать готовый static proot → 404 / нет рабочих URL
5. ❌ Собрать через Android NDK → NDK только x86_64, нельзя на телефоне
6. ✅ Собрать через Termux clang + static talloc + без android-shmem → РАБОТАЕТ
7. ❌ execve("Permission denied") → SELinux блокирует exec ELF из tmp
8. ✅ Отдельный loader в nativeLibraryDir + PROOT_LOADER → ФИНАЛЬНОЕ РЕШЕНИЕ

---

## Лицензия

- proot: GPL v2+ (github.com/termux/proot)
- talloc: LGPL v3+ (samba.org)
- Этот скрипт сборки и Kotlin-код: MIT
```

---

## Как сохранить

```bash
cd ~/skpro
nano PROOT_SETUP.md
```

Вставь весь текст выше → `Ctrl+O` → `Enter` → `Ctrl+X`.

```bash
git add PROOT_SETUP.md
git commit -m "add proot setup documentation"
git push
```

Готово. Теперь у тебя полная документация, которая:
- объясняет **почему** каждое решение было принято
- даёт **пошаговую инструкцию** сборки
- содержит **troubleshooting** для всех проблем, которые мы встретили
- описывает **API** для Kotlin и JS
- и даже содержит **историю** всех попыток

Если через полгода что-то сломается — этого файла достаточно, чтобы восстановить всё с нуля.