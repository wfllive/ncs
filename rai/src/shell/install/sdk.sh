#!/usr/bin/env bash
# =============================================================================
#  rai install sdk [версия] [--libc musl|gnu|android]
#
#  Универсальный установщик нативного ARM Android SDK.
#  НИЧЕГО НЕ ЗАШИТО: версии берутся из GitHub API, имена платформ — из
#  официального repository2-3.xml Google. Поэтому build-tools 38, 39, 40…
#  установятся этим же скриптом без единой правки.
#
#  Примеры:
#     rai install sdk              последняя версия (сейчас 37.0.0)
#     rai install sdk 36.0.2       конкретная версия
#     rai install sdk --libc gnu   другая реализация libc
#     rai install sdk --list       что вообще доступно
# =============================================================================
set -uo pipefail
. "${RAI_HOME:-$HOME/rai}/lib/common.sh"
. "${RAI_HOME:-$HOME/rai}/lib/sdk.sh"

VERSION=""; LIBC="musl"; DO_LIST=0; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --list|-l)  DO_LIST=1 ;;
    --libc)     LIBC="${2:-musl}"; shift ;;
    --libc=*)   LIBC="${1#*=}" ;;
    --force|-f) FORCE=1 ;;
    -*)         warn "неизвестный флаг: $1" ;;
    *)          VERSION="$1" ;;
  esac
  shift
done

# ---- Список доступных версий -------------------------------------------------
if [ "$DO_LIST" -eq 1 ]; then
  step "Доступные сборки Android SDK для ARM"
  echo
  echo "  ВЕРСИЯ     ДАТА         LIBC                   СТАТУС"
  echo "  ---------- ------------ ---------------------- ----------"
  local_bt="$(rai_all_bt)"
  latest="$(rai_sdk_latest)"
  rai_sdk_available | while read -r v d libcs; do
    mark=""
    echo " $local_bt " | grep -q " $v " && mark="${C_G}установлен${C_N}"
    [ "$v" = "$latest" ] && mark="${mark:+$mark, }${C_C}последний${C_N}"
    printf "  %-10s %-12s %-22s %b\n" "$v" "$d" "$libcs" "${mark:-—}"
  done
  echo
  echo -e "  ${C_D}Установлено сейчас: ${local_bt:-ничего}${C_N}"
  echo -e "  ${C_D}Максимальный API у Google: $(rai_platform_latest_api 2>/dev/null || echo '?')${C_N}"
  echo
  echo "  Установить:  rai install sdk [версия] [--libc musl|gnu|android]"
  exit 0
fi

rai_require_env guest "rai install sdk" || exit 1
[ "$(uname -m)" = "aarch64" ] || warn "Архитектура $(uname -m), а не aarch64 — бинарники могут не запуститься"

# ---- Определяем версию -------------------------------------------------------
if [ -z "$VERSION" ]; then
  log "Определяю последнюю доступную версию…"
  VERSION="$(rai_sdk_latest)"
  [ -n "$VERSION" ] || die "Не удалось получить список версий.
Проверьте сеть или укажите версию явно:  rai install sdk 37.0.0"
  ok "Последняя версия: $VERSION"
fi

if ! rai_sdk_has "$VERSION"; then
  err "Версия $VERSION не найдена."
  echo "Доступные:"; rai_sdk_available | sed 's/^/    /'
  exit 1
fi

if ! rai_sdk_has "$VERSION" "$LIBC"; then
  AVL="$(rai_sdk_libcs "$VERSION")"
  warn "Для $VERSION нет варианта '$LIBC'. Доступно: $AVL"
  LIBC="$(echo "$AVL" | cut -d, -f1)"
  log "Использую: $LIBC"
fi

API="${VERSION%%.*}"

# ---- Уже установлено? --------------------------------------------------------
BT_DIR="$ANDROID_HOME/build-tools/$VERSION"
if [ -d "$BT_DIR" ] && [ "$FORCE" -eq 0 ] && rai_is_arm "$BT_DIR/aapt2"; then
  ok "build-tools $VERSION уже установлены (нативный ARM)"
  log "Переустановить: rai install sdk $VERSION --force"
  SKIP_SDK=1
else
  SKIP_SDK=0
fi

step "Установка Android SDK $VERSION ($LIBC, API $API)"

# ---- Зависимости -------------------------------------------------------------
NEED=""
for c in curl tar unzip file; do command -v "$c" >/dev/null || NEED="$NEED $c"; done
command -v xz >/dev/null || NEED="$NEED xz-utils"
command -v javac >/dev/null || NEED="$NEED openjdk-17-jdk-headless"
if [ -n "$NEED" ]; then
  log "Доустанавливаю:$NEED"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null 2>&1
  apt-get install -y --no-install-recommends $NEED >/dev/null 2>&1 || \
    warn "часть пакетов не поставилась"
fi

if ! rai_setup_java; then
  err "JDK не найден."
  echo
  echo "  Похоже, база Ubuntu ещё не подготовлена. Выполните сначала:"
  echo -e "      ${C_B}rai install base${C_N}"
  exit 1
fi
ok "Java: $(java -version 2>&1 | grep -v Picked | head -1)"

# защита от зависания JVM в proot
for SEC in "$JAVA_HOME/conf/security/java.security" "$JAVA_HOME/lib/security/java.security"; do
  [ -f "$SEC" ] && grep -q '^securerandom.source=file:/dev/random' "$SEC" 2>/dev/null && {
    cp -n "$SEC" "$SEC.bak" 2>/dev/null
    sed -i 's|^securerandom.source=.*|securerandom.source=file:/dev/./urandom|' "$SEC"
    ok "java.security пропатчен (защита от зависания)"; }
done

# ---- Скачивание SDK ----------------------------------------------------------
if [ "$SKIP_SDK" -eq 0 ]; then
  ASSET="android-sdk-aarch64-linux-${LIBC}.tar.xz"
  URL="$RAI_SRC_SDK_DL/$VERSION/$ASSET"
  log "Скачиваю $ASSET (~150 МБ)…"
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  curl -fL --retry 3 --progress-bar -o "$TMP/sdk.tar.xz" "$URL" \
    || die "Не удалось скачать: $URL"

  log "Распаковываю…"
  tar -xf "$TMP/sdk.tar.xz" -C "$TMP" || die "Архив повреждён"
  SRC="$TMP/android-sdk"
  [ -d "$SRC" ] || SRC="$(find "$TMP" -maxdepth 2 -type d -name 'android-sdk' | head -1)"
  [ -d "$SRC" ] || die "Неожиданная структура архива"

  mkdir -p "$ANDROID_HOME"

  for d in "$SRC"/build-tools/*/; do
    [ -d "$d" ] || continue
    v="$(basename "$d")"; tgt="$ANDROID_HOME/build-tools/$v"
    [ -d "$tgt" ] && { rm -rf "$tgt.bak"; mv "$tgt" "$tgt.bak"; }
    mkdir -p "$tgt"; cp -rf "$d". "$tgt"/; chmod -R +x "$tgt" 2>/dev/null
    ok "build-tools $v"
  done

  if [ -d "$SRC/platform-tools" ]; then
    [ -d "$ANDROID_HOME/platform-tools" ] && {
      rm -rf "$ANDROID_HOME/platform-tools.bak"
      mv "$ANDROID_HOME/platform-tools" "$ANDROID_HOME/platform-tools.bak"; }
    cp -rf "$SRC/platform-tools" "$ANDROID_HOME/"
    chmod -R +x "$ANDROID_HOME/platform-tools" 2>/dev/null
    ok "platform-tools (adb, fastboot)"
  fi

  if [ -d "$SRC/cmdline-tools" ]; then
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    [ -d "$ANDROID_HOME/cmdline-tools/latest" ] && {
      rm -rf "$ANDROID_HOME/cmdline-tools/latest.bak"
      mv "$ANDROID_HOME/cmdline-tools/latest" "$ANDROID_HOME/cmdline-tools/latest.bak"; }
    cp -rf "$SRC/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
    chmod -R +x "$ANDROID_HOME/cmdline-tools/latest/bin" 2>/dev/null
    ok "cmdline-tools"
  fi

  [ -d "$SRC/licenses" ] && cp -rf "$SRC/licenses" "$ANDROID_HOME/"
  rm -rf "$TMP"; trap - EXIT
fi

# ---- Лицензии ----------------------------------------------------------------
rai_write_licenses
ok "Лицензии приняты (без sdkmanager)"

# ---- Платформа ---------------------------------------------------------------
log "Проверяю platform android-$API…"
case "$(rai_install_platform "$API" 2>/dev/null)" in
  installed) ok "platform android-$API установлена" ;;
  already)   ok "platform android-$API уже была" ;;
  *)         warn "platform android-$API не установилась — попробуйте: rai install platform $API" ;;
esac

# ---- Проверка ----------------------------------------------------------------
step "Проверка"
BT="$(rai_newest_bt)"
FAIL=0
for b in aapt2 aapt zipalign aidl; do
  f="$ANDROID_HOME/build-tools/$BT/$b"
  [ -f "$f" ] || continue
  if rai_is_arm "$f"; then
    echo -e "  ${C_G}✔${C_N} $b — ARM aarch64"
  else
    echo -e "  ${C_R}✘${C_N} $b — $(file -b "$f" | cut -c1-50)"; FAIL=1
  fi
done

if V="$("$ANDROID_HOME/build-tools/$BT/aapt2" version 2>/dev/null)"; then
  ok "aapt2 работает: $V"
else
  [ "$(uname -m)" = "aarch64" ] && { err "aapt2 не запускается"; FAIL=1; } \
    || warn "aapt2 не запустился (вы не на aarch64 — это ожидаемо)"
fi

mkdir -p "$HOME/bin"
cp -f "$ANDROID_HOME/build-tools/$BT/aapt2" "$HOME/bin/aapt2" 2>/dev/null && chmod +x "$HOME/bin/aapt2"

# ---- gradle.properties + окружение -------------------------------------------
GP="$HOME/.gradle/gradle.properties"; mkdir -p "$HOME/.gradle"; touch "$GP"
setp(){ grep -q "^$1=" "$GP" && sed -i "s|^$1=.*|$1=$2|" "$GP" || echo "$1=$2" >> "$GP"; }
setp "android.aapt2FromMavenOverride" "$ANDROID_HOME/build-tools/$BT/aapt2"
setp "org.gradle.java.home" "$JAVA_HOME"
setp "org.gradle.jvmargs" "-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8"
setp "org.gradle.daemon" "false"
setp "org.gradle.parallel" "false"
setp "org.gradle.caching" "true"
setp "org.gradle.vfs.watch" "false"
setp "kotlin.compiler.execution.strategy" "in-process"
setp "kotlin.incremental" "false"
setp "android.useAndroidX" "true"
setp "android.nonTransitiveRClass" "true"
setp "android.suppressUnsupportedCompileSdk" "$API,$((API+1)),$((API+2))"
ok "gradle.properties настроен"

MARK="# >>> rai-env >>>"
for F in "$HOME/.bashrc" "$HOME/.profile"; do
  touch "$F"
  grep -q "$MARK" "$F" 2>/dev/null && sed -i "/$MARK/,/# <<< rai-env <<</d" "$F"
  cat >> "$F" <<EOF

$MARK
export JAVA_HOME="$JAVA_HOME"
export ANDROID_HOME="$ANDROID_HOME"
export ANDROID_SDK_ROOT="\$ANDROID_HOME"
export PATH="\$JAVA_HOME/bin:\$HOME/bin:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/build-tools/$BT:\$PATH"
export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom"
export TMPDIR="\$HOME/tmp"; mkdir -p "\$TMPDIR" 2>/dev/null
# <<< rai-env <<<
EOF
done
ok "Переменные окружения обновлены"

echo
if [ "$FAIL" -eq 0 ]; then
  echo -e "${C_G}════════════════ ГОТОВО ════════════════${C_N}"
else
  echo -e "${C_Y}═══════ ГОТОВО С ЗАМЕЧАНИЯМИ ═══════${C_N}"
fi
cat <<EOF

  build-tools : $(rai_all_bt)
  platforms   : $(ls "$ANDROID_HOME/platforms" 2>/dev/null | tr '\n' ' ')
  compileSdk  : до $(rai_max_sdk)

Дальше:
    source ~/.bashrc
    rai new MyApp com.example.myapp --modern
    rai build MyApp

Обновление в будущем — та же команда:
    rai install sdk --list      посмотреть, что появилось
    rai install sdk             поставить последнюю
EOF
