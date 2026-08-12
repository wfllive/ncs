# RAI — Rapid Android on ARM

**Сборка Android-приложений прямо на телефоне.** Без компьютера, без облака.
Termux → Linux-образ → готовый APK под `arm64-v8a`.

![версия](https://img.shields.io/github/v/release/wfllive-official/rai?label=версия)
![лицензия](https://img.shields.io/badge/лицензия-MIT-green)
![архитектура](https://img.shields.io/badge/ARM-aarch64-orange)

---

## Содержание

- [Зачем это нужно](#зачем-это-нужно)
- [Что потребуется](#что-потребуется)
- [Установка](#установка)
- [Первое приложение за 5 минут](#первое-приложение-за-5-минут)
- [Команды](#команды)
- [Обновление](#обновление)
- [Удаление](#удаление)
- [Если что-то пошло не так](#если-что-то-пошло-не-так)
- [Подлинность сборки](#подлинность-сборки)
- [Лицензия и сторонние компоненты](#лицензия-и-сторонние-компоненты)
- [Контакты](#контакты)

---

## Зачем это нужно

Android SDK от Google собран **только под x86_64**. На телефоне (aarch64) его
инструменты просто не запускаются:

```
error=8, Exec format error
AAPT2 aapt2-x.x.x-linux Daemon #0: Daemon startup failed
```

RAI решает это за вас:

| | |
|---|---|
| Нативный ARM SDK | ставит сборки `aapt2`, `d8`, `apksigner`, `zipalign` под aarch64 |
| Совместимость версий | подбирает связку AGP · Gradle · Kotlin · compileSdk, которая реально собирается |
| Проверка до сборки | типовые ошибки видны за 2 секунды, а не через 2 минуты работы Gradle |
| Только arm64-v8a | APK без лишних ABI — меньше вес, меньше поводов для ошибок |
| Один файл | ни npm, ни архивов, ни git |

---

## Что потребуется

| | |
|---|---|
| Устройство | Android с **64-битным** процессором (`aarch64`) |
| Свободно | от 6 ГБ (JDK ~400 МБ, SDK ~1 ГБ, Gradle и кэш — остальное) |
| ОЗУ | от 3 ГБ комфортно, на 2 ГБ работает с уменьшенным `-Xmx` |
| Приложения | [Termux](https://f-droid.org/packages/com.termux/) с F-Droid или GitHub |
| Интернет | для первичной загрузки компонентов |

> **Termux из Google Play не годится** — он давно не обновляется.
> Ставьте с [F-Droid](https://f-droid.org/packages/com.termux/) или
> [GitHub-релизов Termux](https://github.com/termux/termux-app/releases).

Проверить архитектуру:

```bash
uname -m       # должно быть aarch64
```

Если видите `armv7l` — процессор 32-битный, Android SDK под него не существует.

---

## Установка

Три шага: подготовить Termux → развернуть Linux-образ → работать внутри него.

### Шаг 1. Termux

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs curl proot-distro
termux-setup-storage
```

`nodejs` обязателен — на нём работает сам RAI.

### Шаг 2. Скачать RAI

Возьмите последний файл со страницы
[**Releases**](https://github.com/wfllive-official/rai/releases/latest)
или командой:

```bash
curl -LO https://github.com/wfllive-official/rai/releases/latest/download/rai.sh
bash rai.sh
```

**Первый запуск сам себя устанавливает** — отдельная команда не нужна:

```
==> Первый запуск RAI — выполняю установку
 OK  команда: /data/data/com.termux/files/usr/bin/rai

── RAI ─────────────────────────────────────
  среда      : Termux (Android)
  архитектура: aarch64
```

Дальше работаете короткой командой `rai`.
Скачанный `.sh` **можно удалить** — команда продолжит работать.
Лучше сохраните его: он нужен для `--update` и `--uninstall`.

### Шаг 3. Linux-образ

Собирать APK нужно внутри полноценного Linux — там есть JDK и apt.
Два способа, выбирайте любой.

#### Способ A — через proot-distro (проще)

```bash
rai install termux
```

Команда поставит `proot-distro`, скачает Ubuntu, настроит общую папку
и подскажет, как войти:

```bash
proot-distro login ubuntu --shared-tmp --bind $HOME/shared:/root/shared
```

#### Способ B — свой rootfs (без proot-distro)

```bash
rai install rootfs                  # последняя Ubuntu LTS, arm64
rai install rootfs --list           # какие версии доступны
rai install rootfs --release 22.04  # конкретная версия
```

Появится `~/ubuntu/start.sh` — это и есть вход в образ.
Совет, чтобы не печатать длинное:

```bash
echo "alias ub='~/ubuntu/start.sh'" >> ~/.bashrc
```

### Шаг 4. Внутри образа

Вы теперь в Ubuntu. Поставьте RAI и здесь — образ это отдельная система:

```bash
apt-get update && apt-get install -y curl nodejs
curl -LO https://github.com/wfllive-official/rai/releases/latest/download/rai.sh
bash rai.sh
```

Файл можно не качать заново, а положить в общую папку — она видна
из Termux как `~/shared`, а изнутри образа как `/root/shared`.

Затем один раз подготовьте систему:

```bash
rai install base      # apt, JDK 17, утилиты, локаль, настройки JVM
rai install sdk       # нативный ARM Android SDK, последняя версия
```

`rai install base` заодно чинит типичные болячки proot: пустой DNS,
права на `/tmp`, зависание JVM на `/dev/random`, песочницу apt.

Проверьте, что всё встало:

```bash
rai status
```

```
── RAI ─────────────────────────────────────
  среда      : Ubuntu 24.04.4 LTS (гостевой образ на Android)
  архитектура: aarch64
── Компоненты ──────────────────────────────
  Java        : 17.0.19
  build-tools : 37.0.0  нативный ARM
  platforms   : android-37
```

---

## Первое приложение за 5 минут

```bash
rai new MyApp com.example.myapp     # проект Jetpack Compose
rai build MyApp                     # debug APK
rai apk MyApp                       # где лежит и какие ABI внутри
```

Готовый файл — `~/projects/MyApp/app/build/outputs/apk/debug/`.
Скопируйте его в общую папку и установите с телефона:

```bash
cp ~/projects/MyApp/app/build/outputs/apk/debug/*.apk /root/shared/
```

Из Termux он виден в `~/shared`, оттуда — в файловом менеджере телефона.

### Релизная сборка для публикации

```bash
rai keystore create MyApp     # ключ RSA 2048 на 30 лет, остаётся только у вас
rai build MyApp release       # подпись + R8/минификация
rai build MyApp bundle        # AAB для Google Play
```

> **Сохраните `.jks` и пароль в надёжном месте.** Потеря ключа означает,
> что обновить приложение в Google Play будет невозможно.

### Два профиля версий

```bash
rai new MyApp                 # STABLE  — AGP 8.13.2, Gradle 8.14.5, compileSdk 35
rai new MyApp --modern        # MODERN  — AGP 9.3.1,  Gradle 9.6.1,  compileSdk 37
```

`--modern` требует установленных build-tools 37 — их ставит `rai install sdk`.
Если сомневаетесь, начинайте со `stable`: она собирается на любом наборе.

---

## Команды

```
СБОРКА APK
  rai build <проект>              debug APK
  rai build <проект> release      release APK (подпись + R8)
  rai build <проект> bundle       AAB для Google Play
  rai clean <проект>              очистить артефакты

ПРОЕКТЫ
  rai new <Имя> [пакет] [--modern]   создать проект Compose
  rai prepare <проект>            починить конфиг и скачать зависимости
  rai list                        все проекты таблицей
  rai apk <проект>                собранные APK, их ABI и подпись

ПОДПИСЬ И ВЕРСИИ
  rai keystore create <проект>    создать ключ подписи
  rai keystore info <проект>      сведения о ключе
  rai keystore verify <apk>       проверить подпись файла
  rai version app <проект> --bump patch|minor|major

УСТАНОВКА
  rai install base                система: apt, JDK 17, утилиты
  rai install sdk                 нативный ARM Android SDK
  rai install sdk 36.0.2          конкретная версия
  rai sdk --list                  какие версии SDK доступны
  rai install rootfs              скачать Ubuntu-образ
  rai install termux              подготовить Termux + proot-distro

ДИАГНОСТИКА
  rai status                      состояние и следующий шаг
  rai check <проект>              быстрая проверка перед сборкой
  rai doctor                      полная диагностика системы
  rai fix abi <проект>            починить build.gradle.kts
  rai fix java                    настроить JAVA_HOME
  rai fix licenses                принять лицензии SDK
  rai report --save               отчёт для поддержки

САМ RAI
  rai update                      обновиться
  rai update --check              только проверить
  rai verify                      подлинность сборки
  rai sources                     откуда качаются компоненты
  rai uninstall                   как удалить
  rai help                        справка
```

Флаги самого файла `.sh`:

| Команда | Что делает |
|---|---|
| `bash rai.sh` | запуск; при первом разе — установка |
| `bash rai.sh --update` | обновить до версии этого файла |
| `bash rai.sh --reinstall` | переустановить принудительно |
| `bash rai.sh --uninstall` | удалить с подтверждением |
| `bash rai.sh --verify` | проверить подлинность |
| `bash rai.sh --info` | версия, отпечаток, каталог |

---

## Обновление

```bash
rai update
```

RAI читает манифест `version.json`, скачивает свежий файл,
**дважды проверяет подлинность** и ставит:

```
== Обновление RAI ==
  установлено : ваша версия
  репозиторий : wfllive-official/rai

  Доступна более свежая версия  от 2026-08-10
  - исправлена ошибка подписи
  - ускорена проверка проекта

==> Скачиваю...
 OK  контрольная сумма совпала
 OK  подлинность подтверждена
 OK  Обновлено
```

Только посмотреть, не устанавливая: `rai update --check`

О новых версиях RAI напоминает сам — не чаще раза в сутки, молча при
отсутствии сети и никогда в скриптах и пайпах.
Отключить совсем:

```bash
export RAI_NO_UPDATE_CHECK=1
```

---

## Удаление

```bash
bash rai.sh --uninstall
```

Показывает список и спрашивает подтверждение:

```
Удаление RAI

  Будет удалено:
    • код RAI        /root/.rai/<версия>
    • рабочие файлы  /root/.rai/work
    • команда        /usr/local/bin/rai

  НЕ будет тронуто:
    • ваши проекты   /root/projects
    • Android SDK    /root/android-sdk
    • ключи подписи  /root/.rai/keystores

  Удалить RAI? [да/нет]
```

Принимает `да`/`нет` и `y`/`n`. Любой другой ответ — отмена.
Без вопросов: `--uninstall -y`.

Проекты, SDK и ключи остаются на месте всегда.

---

## Если что-то пошло не так

Первым делом:

```bash
rai doctor
```

Диагностика проверяет архитектуру, память, диск, Java, SDK, **архитектуру
самих бинарников SDK**, Gradle и доступность сети — и подсказывает лечение.

### Частые ситуации

<details>
<summary><b>bash: /usr/local/bin/rai: No such file or directory</b></summary>

Оболочка помнит старый путь к команде:

```bash
hash -r
rai
```

Либо просто откройте новый терминал. Установщик вызывает `hash -r` сам,
но в некоторых оболочках это не наследуется.
</details>

<details>
<summary><b>error=8, Exec format error / AAPT2 Daemon startup failed</b></summary>

Gradle взял aapt2 от Google — он под x86_64.

```bash
rai install sdk       # поставить нативный ARM SDK
rai prepare <проект>  # прописать его в проект
```
</details>

<details>
<summary><b>Conflicting configuration: 'arm64-v8a' in ndk abiFilters cannot be present when splits abi filters are set</b></summary>

В `build.gradle.kts` одновременно заданы `ndk.abiFilters` и `splits.abi`.

```bash
rai fix abi <проект>
```
</details>

<details>
<summary><b>The 'org.jetbrains.kotlin.android' plugin is no longer required since AGP 9.0</b></summary>

У AGP 9 поддержка Kotlin встроена, отдельный плагин ломает сборку.

```bash
rai fix abi <проект>      # уберёт лишний плагин
```
</details>

<details>
<summary><b>apt: repository is not signed / Unable to locate package curl</b></summary>

Болезнь свежераспакованного образа: чужой владелец `/tmp` и песочница apt.
Лечится подготовкой:

```bash
rai install base
```

Вручную, если RAI ещё не запускается:

```bash
chmod 1777 /tmp /var/tmp
echo 'APT::Sandbox::User "root";' > /etc/apt/apt.conf.d/99rai
apt-get update -o Acquire::AllowInsecureRepositories=true
apt-get install -y --allow-unauthenticated gpgv ca-certificates curl nodejs
apt-get update
```
</details>

<details>
<summary><b>Сборка виснет на «Starting a Gradle Daemon» или на лицензиях</b></summary>

В proot мало энтропии — JVM ждёт `/dev/random`, а `sdkmanager` ждёт ввод.

```bash
rai fix java
rai fix licenses
```
</details>

<details>
<summary><b>Не хватает памяти при сборке</b></summary>

Уменьшите heap в `~/.gradle/gradle.properties`:

```properties
org.gradle.jvmargs=-Xmx1024m -Dfile.encoding=UTF-8
org.gradle.daemon=false
```

И держите телефон разбуженным: `termux-wake-lock` в Termux.
</details>

Не помогло — соберите отчёт и приложите его к обращению:

```bash
rai report --save
```

---

## Подлинность сборки

Внутрь `.sh` зашит SHA-256 всей полезной нагрузки. Любое изменение видно:

```bash
rai verify
```

```
RAI (release)
  собрано   : 2026-07-28T12:54:00Z
  отпечаток : 3d704cf965a052d1
  SHA-256   : 47af381d74419cd3ad04dfa661672ec4...

✔ Подлинная сборка, содержимое не изменено
```

У изменённого файла:

```
✘ Содержимое изменено — это не официальная сборка
```

**Зачем это вам.** RAI под MIT — форки и модификации разрешены. Но если
кто-то выложил свою переделку и она не работает, вопросы приходят к автору
оригинала. Поэтому:

- поддержка оказывается **только официальным сборкам**;
- отпечаток каждой версии публикуется на её странице релиза;
- `rai report` сразу пишет, официальная сборка или нет;
- список адресов загрузки открыт (`rai sources`), его подмена меняет отпечаток.

Скачивайте только со
[страницы релизов этого репозитория](https://github.com/wfllive-official/rai/releases)
и сверяйте контрольную сумму:

```bash
sha256sum rai.sh
```

---

## Лицензия и сторонние компоненты

RAI распространяется под лицензией **MIT** — см. [LICENSE](LICENSE).
Можно использовать, изменять, распространять, в том числе коммерчески.
Единственное требование — сохранить текст лицензии и указание авторства.
Программа поставляется «как есть», без гарантий.

Своего чужого кода в RAI нет: зависимостей npm ноль. Во время работы
он **скачивает** сторонние компоненты — их лицензии перечислены в
[NOTICE](NOTICE):

| Компонент | Лицензия |
|---|---|
| [android-sdk-custom](https://github.com/HomuHomu833/android-sdk-custom) — нативный ARM SDK | MIT (сборка из AOSP, Apache 2.0) |
| Android SDK Platforms (Google) | Android SDK License Agreement |
| [Gradle](https://services.gradle.org/distributions/) | Apache 2.0 |
| [Ubuntu Base](https://cdimage.ubuntu.com/ubuntu-base/releases/) | GPL / LGPL / MIT / BSD |
| Termux packages | лицензии исходных проектов |

Полный список адресов загрузки в любой момент:

```bash
rai sources
```

---

## Контакты

**Автор:** wfllive-official

| | |
|---|---|
| Связь с автором | [vk.com/meteolive](https://vk.com/meteolive) |
| Ошибки и предложения | [Issues](https://github.com/wfllive-official/rai/issues) |
| Скачать | [Releases](https://github.com/wfllive-official/rai/releases) |

**Прежде чем писать об ошибке**, приложите вывод двух команд — без них
разобраться невозможно:

```bash
rai verify
rai report --save
```

Поддержка оказывается только официальным сборкам с подтверждённым
отпечатком. Для форков и модификаций обращайтесь к их авторам.

---

## Для разработчиков RAI

RAI — это JS-проект, который собирается в один исполняемый `.sh`.
Устройство проекта, сборка и правила выпуска версий описаны отдельно:

- [DEVELOPMENT.md](DEVELOPMENT.md) — структура, сборщик, добавление модулей
- [PUBLISHING.md](PUBLISHING.md) — выпуск релиза через веб-интерфейс GitHub
- [CHANGELOG.md](CHANGELOG.md) — история версий
