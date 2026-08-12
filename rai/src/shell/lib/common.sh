#!/usr/bin/env bash
# =============================================================================
#  rai/lib/common.sh — общие функции и настройки для всех команд RAI
#  Подключается через:  . "$RAI_HOME/lib/common.sh"
# =============================================================================

# ---- Цвета -------------------------------------------------------------------
if [ -t 1 ]; then
  C_B='\033[1;34m'; C_G='\033[1;32m'; C_R='\033[1;31m'
  C_Y='\033[1;33m'; C_C='\033[1;36m'; C_D='\033[2m'; C_N='\033[0m'
else
  C_B=''; C_G=''; C_R=''; C_Y=''; C_C=''; C_D=''; C_N=''
fi

log()  { echo -e "${C_B}==>${C_N} $*"; }
ok()   { echo -e "${C_G} OK ${C_N} $*"; }
warn() { echo -e "${C_Y}WARN${C_N} $*"; }
err()  { echo -e "${C_R}FAIL${C_N} $*" >&2; }
die()  { err "$*"; exit 1; }
step() { echo; echo -e "${C_C}── $* ────────────────────────────${C_N}"; }

# ---- Пути --------------------------------------------------------------------
export RAI_HOME="${RAI_HOME:-$HOME/rai}"
export RAI_PROJECTS="${RAI_PROJECTS:-$HOME/projects}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# ---- Где мы находимся: termux / proot / linux --------------------------------
# termux — терминал Android (есть /data/data/com.termux/files/usr)
# proot  — гостевой Ubuntu/Debian внутри proot-distro
# linux  — обычный Linux/ПК
rai_env() {
  # Termux: свой префикс и нет гостевой ОС
  if [ -d /data/data/com.termux/files/usr ]; then
    if [ "${PREFIX:-}" = "/data/data/com.termux/files/usr" ] || [ ! -f /etc/os-release ]; then
      echo "termux"; return
    fi
  fi

  if [ -f /etc/os-release ]; then
    # гостевой Linux поверх Android: proot-distro, свой rootfs, chroot — не важно
    if grep -qai 'android' /proc/version 2>/dev/null \
       || grep -qa 'proot' /proc/1/cmdline 2>/dev/null \
       || [ -d /data/data/com.termux/files ] \
       || [ -n "${PROOT_NO_SECCOMP:-}${PROOT_TMP_DIR:-}" ]; then
      echo "proot"; return
    fi
    echo "linux"; return
  fi
  echo "unknown"
}

# Гостевой Linux (proot / rootfs / chroot / обычный Linux) — то есть НЕ Termux
rai_is_guest() { [ "$(rai_env)" != "termux" ]; }

rai_env_name() {
  case "$(rai_env)" in
    termux) echo "Termux (Android)" ;;
    proot)  echo "$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") (гостевой rootfs на Android)" ;;
    linux)  echo "Linux: $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")" ;;
    *)      echo "неизвестно" ;;
  esac
}

# Требовать конкретную среду. rai_require_env <termux|guest> <название команды>
rai_require_env() {
  local want="$1" cmd="${2:-эта команда}" cur; cur="$(rai_env)"
  case "$want" in
    termux)
      [ "$cur" = "termux" ] && return 0
      err "$cmd запускается В TERMUX, а вы внутри: $(rai_env_name)"
      echo
      echo "  Выйдите из proot-distro:"
      echo -e "      ${C_B}exit${C_N}"
      echo "  и повторите команду уже в Termux."
      return 1 ;;
    guest)
      [ "$cur" = "termux" ] || return 0
      err "$cmd запускается ВНУТРИ Linux-образа, а вы в Termux."
      echo
      echo "  Войдите в свой образ и повторите команду там, например:"
      echo -e "      ${C_B}proot-distro login ubuntu --shared-tmp --bind \$HOME/shared:/root/shared${C_N}"
      echo -e "      ${C_D}или ваш скрипт запуска rootfs${C_N}"
      echo
      echo -e "  ${C_D}Образа ещё нет?  rai install termux  (поставит Ubuntu автоматически)${C_N}"
      return 1 ;;
  esac
}

# ---- Java: находим и экспортируем -------------------------------------------
rai_setup_java() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
    export PATH="$JAVA_HOME/bin:$PATH"; return 0
  fi
  local p
  for p in /usr/lib/jvm/java-17-openjdk-arm64 \
           /usr/lib/jvm/java-17-openjdk-aarch64 \
           /usr/lib/jvm/java-17-openjdk*; do
    [ -x "$p/bin/javac" ] && { export JAVA_HOME="$p"; export PATH="$p/bin:$PATH"; return 0; }
  done
  if command -v javac >/dev/null 2>&1; then
    p="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
    [ -x "$p/bin/javac" ] && { export JAVA_HOME="$p"; export PATH="$p/bin:$PATH"; return 0; }
  fi
  return 1
}

# В proot мало энтропии — JVM иначе виснет на /dev/random
export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom ${JAVA_TOOL_OPTIONS:-}"
export GRADLE_OPTS="-Dorg.gradle.daemon=false -Dfile.encoding=UTF-8 ${GRADLE_OPTS:-}"
export TMPDIR="${TMPDIR:-$HOME/tmp}"; mkdir -p "$TMPDIR" 2>/dev/null || true

# ---- Определение состояния SDK ----------------------------------------------
# Возвращает самую свежую версию build-tools
rai_newest_bt() {
  ls "$ANDROID_HOME/build-tools" 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -1
}

# Все установленные build-tools, через пробел
rai_all_bt() {
  ls "$ANDROID_HOME/build-tools" 2>/dev/null | grep -E '^[0-9]' | sort -V | tr '\n' ' '
}

# Проверка: бинарник — нативный ARM?
rai_is_arm() {
  local f="$1"
  [ -f "$f" ] || return 1
  file -b "$f" 2>/dev/null | grep -q 'aarch64'
}

# Максимальный compileSdk, который потянет установленный SDK
rai_max_sdk() {
  local bt; bt="$(rai_newest_bt)"
  [ -n "$bt" ] && echo "${bt%%.*}" || echo "0"
}

rai_project_path() {
  local p="${1:-}"
  [ -z "$p" ] && { echo "$PWD"; return; }
  case "$p" in
    /*) echo "$p" ;;
    ~*) eval echo "$p" ;;
    *)  if [ -d "$RAI_PROJECTS/$p" ]; then echo "$RAI_PROJECTS/$p"
        else echo "$PWD/$p"; fi ;;
  esac
}

rai_is_project() {
  [ -f "$1/settings.gradle.kts" ] || [ -f "$1/settings.gradle" ]
}
