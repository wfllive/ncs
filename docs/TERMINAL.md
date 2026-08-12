# Терминал (Termux engine) — переделка по образцу AndroidIDE

Терминал в приложении полностью переделан. Использован тот же движок, что и в
[AndroidIDE](https://github.com/AndroidIDEOfficial/AndroidIDE) / Termux
(`terminal-emulator` + `terminal-view`), но вокруг него построена правильная обёртка,
которой раньше не хватало.

## Что было не так раньше

- Нативный `TerminalView` подключался «голым», без строки специальных клавиш.
- Клиенты (`TerminalViewClient` / `TerminalSessionClient`) были заглушками:
  `readControlKey()/readAltKey()` всегда возвращали `false`, не было обработки
  `Ctrl+C`, `Tab`, стрелок, `Esc`.
- `getTerminalCursorStyle()` возвращал `null`, не было clipboard / bell.
- Сессия жёстко запускала `/system/bin/sh` с хрупким копированием бинарников.
- Не было связи JS ↔ сессия (нельзя послать текст/клавишу, получить код выхода).

## Что сделано

Движок (`com.termux.terminal`, `com.termux.view`) оставлен — он идентичен движку AndroidIDE.
Добавлено/переписано:

- **ExtraKeys** — строка спец-клавиш из AndroidIDE/Termux (`ESC / TAB / CTRL / ALT / ←↑→↓ /
  HOME / END / PGUP / PGDN / BKSP / DEL`, свайп вверх по клавише даёт popup, например `-` → `|`).
  Портованы `ExtraKeysView`, `ExtraKeysInfo`, `ExtraKeyButton`, `SpecialButton(State)`,
  `ExtraKeysConstants`, `TerminalExtraKeys`, `BellHandler`.
- **Правильный `TerminalViewClient`**: модификаторы читаются из строки ExtraKeys
  (`readControlKey/readAltKey/readShiftKey/readFnKey`), ввод в char-based режиме,
  масштаб шрифта жестом (pinch), показ клавиатуры по тапу.
- **Правильный `TerminalSessionClient`**: курсор (block), bell (вибро), copy/paste в системный
  буфер, события смены заголовка и завершения сессии (с кодом выхода).
- **Нормальная сессия** (`TerminalEnvironment.kt`): запуск `bash --login` из bootstrap
  (`files/usr/bin/bash`), фолбэк на `files/usr/bin/sh` → Termux (`/data/data/com.termux`) →
  `/system/bin/sh`; корректное окружение (`HOME`, `PREFIX`, `PATH`, `TMPDIR`, `TERM`,
  `LANG`, `LD_LIBRARY_PATH`, `BOOTCLASSPATH`, ...).
- **JS-мост**: события (`started`/`title`/`exit`) и методы через ref
  (`writeText`, `sendKey`, `restart`, `toggleKeyboard`), пропсы (`fontSize`,
  `workingDirectory`, `initialCommand`, `extraKeys`).

## Использование в JS

```jsx
import { TerminalView } from '../modules/termux-terminal/src/index';

const ref = useRef(null);

<TerminalView
  ref={ref}
  style={{ flex: 1 }}
  fontSize={13}
  extraKeys={EXTRA_KEYS}                 // опционально, свой layout
  onTerminalEvent={(e) => {
    const ev = e.nativeEvent;            // {type:'started'|'title'|'exit', ...}
  }}
/>;

ref.current.run('ls -la');               // выполнить команду
ref.current.sendKey('ENTER');
ref.current.toggleKeyboard();
ref.current.restart();
```

Готовый экран: `src/screens/TerminalScreen.tsx` (кнопки A−/A+, клавиатура, рестарт).

## Пересборка

Терминал — нативный модуль, поэтому изменения требуют **dev-сборки**:

```bash
npm install
npm run pr      # expo prebuild --platform android
npm run bd      # eas build --platform android --profile development
```

После установки новой dev-сборки на устройство терминал подхватится автоматически.

## ⚠️ «Permission denied» и выбор shell (Android 10+ / Huawei)

На Android 10+ раздел с данными приложения смонтирован как `noexec`, а SELinux
запрещает запуск файлов из `<filesDir>/usr/bin` (поэтому на Huawei и др. бывает
`exec(".../files/usr/bin/bash"): Permission denied`). Обычное приложение не может
это обойти — так устроен Android. Termux/AndroidIDE решают это, исполняя shell из
своей native-lib директории / при низком `targetSdk`.

Чтобы терминал **всегда** работал, `TerminalEnvironment` реально проверяет каждый
shell на запуск (`sh -c true`) и берёт первый рабочий по приоритету:

1. `files/usr/bin/bash` (bootstrap)
2. `files/usr/bin/sh`
3. `/data/data/com.termux/files/usr/bin/bash` (если установлен Termux)
4. `/system/bin/sh` — системный shell, запускается всегда (mksh)

Если видите в шапке `sh · pid …` — это значит, что на устройстве сработал фолбэк
на системный shell (bootstrap исполнить нельзя). Такой терминал полностью рабочий
(ввод, Ctrl+C, стрелки, ExtraKeys), но без пакетов `pkg`/`node`.

## 🐧 Полноценный Linux с apt через proot

Чтобы `apt`/`dpkg`/пакеты реально работали **без Termux и без root**, используется
**proot + Linux rootfs**:

- `proot` (хост-бинарник) упаковывается как нативная библиотека `libproot.so` в `jniLibs`
  → извлекается в **исполняемую** `nativeLibraryDir` (обходит noexec данных приложения).
- proot через свой `loader` (`libloader.so`) запускает бинарники гостевого rootfs прямо
  из данных приложения (не через `execve` ядра), поэтому noexec им не мешает.
- rootfs (Debian/Ubuntu с `apt`) скачивается в рантайме в `files/proot/rootfs/`.

### Шаги

1. **Положить бинарники proot** (на ПК, в корне проекта):
   ```bash
   npm run proot
   # или со своими URL:
   node scripts/setup-proot.js --proot <URL> --loader <URL> --abi arm64-v8a
   ```
   Скрипт кладёт `libproot.so` и `libloader.so` в
   `modules/termux-terminal/android/src/main/jniLibs/arm64-v8a/`.
   По умолчанию берётся статический proot из Termux (`ZhymabekRoman/proot-static`,
   armhf, работает и на arm64). Если устройство строго 64-битное — укажите aarch64-static
   proot + подходящий loader (URL-кандидаты в шапке скрипта).

2. **Пересобрать dev-client:**
   ```bash
   npm run pr && npm run bd
   ```
   (В `app.json` подключён плагин `with-extract-native-libs.js` → `extractNativeLibs="true"`,
   чтобы `libproot.so` извлекался реальным исполняемым файлом.)

3. **В приложении:** Terminal → кнопка **«Установить Linux»** (скачает rootfs, ~30-200 МБ).
   После этого терминал сам перезапустится **внутрь Linux** (в шапке будет `Linux (proot)`),
   и будут работать `apt update`, `apt install ...`, `bash`, и т.д.

### Если что-то не так (смотреть logcat, тег `TermuxProot`)

- `dpkg: error creating new backup file '/var/lib/dpkg/status-old': Permission denied`
  → Ubuntu 24.04 (dpkg 1.22) делает бэкап status через `link(2)`, а на Android-ядрах/f2fs
  прямой `link(2)` от приложения часто возвращает EPERM. Решение — как в Termux proot-distro:
  включён `--link2symlink` (proot эмулирует link в userspace), поэтому link(2) работает.
- `dpkg: unable to stat './usr/bin/gunzip': Operation not permitted` при `apt upgrade`
  (пакет gzip) → сломанные цепочки эмуляции hard-ссылок (`.proot.l2s.*` / `.l2s.*`) от
  прерванного апгрейда. Лечится автоматически: перед каждой командой apt/dpkg rootfs
  очищается от `.l2s.*`-мусора, а hard-ссылки в `/usr/bin` (gzip, perl, …) разрываются в
  обычные файлы — апгрейд таких пакетов больше не падает.
- `/usr/bin/deb-systemd-helper: =head1: not found` при apt upgrade → сломан `/usr/bin/perl`
  (perl-base — это тоже пакет с хардлинками, и прерванный апгрейд мог его повредить).
  Подготовка проверяет perl и при поломке переустанавливает perl-base; а
  `deb-systemd-helper`/`deb-systemd-invoke` заменяются безвредными заглушками (в proot нет
  systemd), поэтому postinst-скрипты десятков пакетов проходят мгновенно.
- Кнопка «Починить apt/dpkg» в интерфейсе убрана: подготовка выполняется автоматически
  при установке rootfs и перед каждой командой apt/dpkg.
- proot падает по seccomp → уже выставлен `PROOT_NO_SECCOMP=1`.
- «loader not found» → не скачался/не тот `libloader.so`; без него гостевые бинарники не запустятся.
- 64-бит-only устройство не запускает armhf proot → возьмите aarch64-static proot.

> ⚠️ Я не могу протестировать proot-бинарники и rootfs в этой среде (нет устройства/загрузки),
> поэтому первый запуск, вероятно, потребует итерации по logcat. Код написан с подробным
> логированием именно для этого.


## apt/dpkg: самовосстановление (proot, как в Termux proot-distro)

Ubuntu в proot теперь «чинится» автоматически, как это делает Termux proot-distro:

- **При установке rootfs** сразу пишутся proot-совместимые настройки apt/dpkg
  (`/etc/apt/apt.conf.d/00proot`: `APT::Sandbox::User "root"`, `--force-confdef/--force-confold`,
  без HTTP-pipelining), `policy-rc.d` (exit 101 — сервисы не стартуют в контейнере),
  создаются обязательные каталоги (`/var/lib/dpkg/updates`, `/var/cache/apt/archives/partial`,
  `/run/lock`, ...).
- **Сразу после распаковки rootfs** установщик сам запускает полную подготовку внутри
  Ubuntu (этап «Настройка apt/dpkg…»): разрыв hard-ссылок (gzip/perl), очистка `.l2s.*`,
  `dpkg --configure -a`, `apt-get update`, `apt-get -f install -y`. Поэтому после установки
  `apt update && apt upgrade` работают сразу, без ручной «Починки».
- **Перед первой командой apt/dpkg** (и по кнопке **«Починить apt/dpkg»** в терминале)
  внутри rootfs выполняется идемпотентный скрипт:
  1. создаёт каталоги и выставляет права/владельца (`chown -R root:root` для
     `/var/lib/dpkg`, `/var/lib/apt`, `/var/cache/apt`, `/tmp`, ...);
  2. чистит «зависшие» lock-файлы apt/dpkg (только если apt/dpkg не запущены);
  3. запускает `dpkg --configure -a --force-confold --force-confdef`;
  4. запускает `apt-get -f install -y`.

  Это лечит типичный сценарий: прерванный `apt upgrade` → при следующей установке
  `E: Sub-process /usr/bin/dpkg returned an error code (1)`.
- `TMPDIR` гостя теперь указывает на `/tmp` внутри rootfs (как в proot-distro), а не на
  путь в data приложения — раньше временные файлы dpkg/postinst могли не создаваться.
- В окружение добавлено `DEBIAN_FRONTEND=noninteractive` — apt/dpkg не зависают на
  вопросах debconf.

## Ввод с клавиатуры

- Режим ввода приведён к стандартному Termux: `InputType.TYPE_NULL`
  (`shouldEnforceCharBasedInput() = false`). Клавиатуры шлют символы по одному
  (key events / commitText) — как в Termux, а не копят их в буфере IME.
- Дополнительно `TerminalView` теперь сам обрабатывает IME composing
  (`setComposingText`): текст композиции сразу уходит в терминал (только дельта),
  поэтому символы видны мгновенно и не «проявляются» только после пробела
  (баг клавиатур Samsung/Gboard с предиктивным вводом).
