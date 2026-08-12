#!/usr/bin/env bash
# =============================================================================
#  rai doctor — диагностика окружения. Запускать при любой странной ошибке.
# =============================================================================
GREEN='\033[1;32m'; RED='\033[1;31m'; YEL='\033[1;33m'; BLUE='\033[1;34m'; NC='\033[0m'
pass(){ echo -e "  ${GREEN}✔${NC} $*"; }
fail(){ echo -e "  ${RED}✘${NC} $*"; ERRORS=$((ERRORS+1)); }
warn(){ echo -e "  ${YEL}!${NC} $*"; }
sect(){ echo -e "\n${BLUE}── $* ─────────────────────────${NC}"; }
ERRORS=0

SDK_DIR="${ANDROID_HOME:-$HOME/android-sdk}"

sect "Целостность RAI"
if [ -f "${RAI_HOME:-$HOME/rai}/lib/integrity.sh" ]; then
  bash "${RAI_HOME:-$HOME/rai}/lib/integrity.sh" 2>/dev/null | sed -n '3,$p' | sed 's/^/ /'
else
  echo "  (модуль проверки отсутствует)"
fi

sect "Система"
echo "  uname -m : $(uname -m)"
[ "$(uname -m)" = "aarch64" ] && pass "aarch64" || fail "не aarch64 — SDK работать не будет"
echo "  ОС       : $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
echo "  RAM      : $(free -h 2>/dev/null | awk '/Mem:/{print $2" всего, "$7" доступно"}')"
echo "  Диск $HOME: $(df -h "$HOME" | awk 'NR==2{print $4" свободно из "$2}')"
AVAIL_KB=$(df -k "$HOME" | awk 'NR==2{print $4}')
[ "$AVAIL_KB" -gt 6000000 ] && pass "места достаточно (>6 ГБ)" || warn "мало места (<6 ГБ) — Gradle+SDK требуют ~8 ГБ"
MEM_MB=$(free -m 2>/dev/null | awk '/Mem:/{print $2}')
[ "${MEM_MB:-0}" -ge 3000 ] && pass "RAM ${MEM_MB}MB" || warn "RAM ${MEM_MB}MB — уменьшите -Xmx в gradle.properties до 1024m"

sect "Java"
if command -v java >/dev/null; then
  V=$(java -version 2>&1 | head -1)
  echo "  $V"
  echo "$V" | grep -q '"17' && pass "Java 17" || warn "не 17 — AGP 8.x требует именно JDK 17 (21 тоже ок для AGP 8.5+)"
else fail "java не найдена"; fi
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
  pass "JAVA_HOME=$JAVA_HOME"
else
  # java может работать через PATH, а JAVA_HOME быть не задан — ищем реальный JDK
  DETECTED=""
  for p in /usr/lib/jvm/java-17-openjdk-arm64 /usr/lib/jvm/java-17-openjdk*; do
    [ -x "$p/bin/javac" ] && { DETECTED="$p"; break; }
  done
  if [ -z "$DETECTED" ] && command -v javac >/dev/null 2>&1; then
    DETECTED="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  fi
  # Gradle может брать JDK из gradle.properties — это тоже валидно
  GJH="$(grep -oP '(?<=^org.gradle.java.home=).*' "$HOME/.gradle/gradle.properties" 2>/dev/null || true)"
  if [ -n "$GJH" ] && [ -x "$GJH/bin/javac" ]; then
    warn "JAVA_HOME не задан в сессии, но org.gradle.java.home=$GJH — Gradle соберётся"
    echo "     чтобы убрать предупреждение:  rai fix java && source ~/.bashrc"
  elif [ -n "$DETECTED" ]; then
    fail "JAVA_HOME не задан (хотя JDK есть: $DETECTED)"
    echo "     Причина: не выполнен 'source ~/.bashrc'."
    echo "     Лечение:  rai fix java && source ~/.bashrc"
    echo "     Разово:   export JAVA_HOME=$DETECTED"
  else
    fail "JAVA_HOME не задан и JDK не найден"
    echo "     Лечение:  apt-get install -y openjdk-17-jdk-headless && rai fix java"
  fi
fi
if command -v javac >/dev/null 2>&1; then
  pass "javac есть ($(javac -version 2>&1 | head -1))"
else
  fail "javac НЕ найден — стоит только JRE. Gradle требует полный JDK:
     apt-get install -y openjdk-17-jdk-headless"
fi

sect "Android SDK"
[ -d "$SDK_DIR" ] && pass "ANDROID_HOME=$SDK_DIR" || fail "SDK не найден в $SDK_DIR"
[ -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ] && pass "cmdline-tools" || fail "нет cmdline-tools"
echo "  platforms  : $(ls "$SDK_DIR/platforms" 2>/dev/null | tr '\n' ' ')"
echo "  build-tools: $(ls "$SDK_DIR/build-tools" 2>/dev/null | tr '\n' ' ')"
ls "$SDK_DIR/platforms" >/dev/null 2>&1 && pass "platform установлен" || fail "нет platforms;android-XX"

sect "Архитектура бинарников (главная причина ошибок)"
for b in "$SDK_DIR"/build-tools/*/aapt2 "$SDK_DIR"/build-tools/*/aapt \
         "$SDK_DIR"/build-tools/*/zipalign "$SDK_DIR"/build-tools/*/aidl \
         "$SDK_DIR"/platform-tools/adb "$HOME/bin/aapt2"; do
  [ -f "$b" ] || continue
  case "$b" in *.bak) continue;; esac
  I=$(file -b "$b" 2>/dev/null)
  N=$(echo "$b" | sed "s|$HOME|~|")
  case "$I" in
    *aarch64*) pass "$N → ARM aarch64 (нативно)" ;;
    *"shell script"*|*"ASCII text"*)
        if grep -q 'qemu' "$b" 2>/dev/null; then
          if "$b" version >/dev/null 2>&1; then pass "$N → qemu-обёртка, работает"
          else fail "$N → qemu-обёртка, но НЕ запускается"; fi
        else pass "$N → скрипт-обёртка (норма для d8/apksigner)"; fi ;;
    *x86-64*|*x86_64*) fail "$N → x86-64 без обёртки (НЕ ЗАПУСТИТСЯ). Запустите rai install sdk" ;;
    *) warn "$N → $I" ;;
  esac
done

if [ -x "$HOME/bin/aapt2" ]; then
  if OUT=$("$HOME/bin/aapt2" version 2>&1); then pass "aapt2 запускается: $OUT"
  else fail "aapt2 не запускается: $OUT"; fi
fi

sect "Режим SDK"
NEWEST_BT="$(ls "$SDK_DIR/build-tools" 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -1)"
if [ -n "$NEWEST_BT" ]; then
  BTA="$(file -b "$SDK_DIR/build-tools/$NEWEST_BT/aapt2" 2>/dev/null)"
  case "$BTA" in
    *aarch64*) pass "НАТИВНЫЙ ARM, build-tools $NEWEST_BT (без эмуляции)"
               case "$NEWEST_BT" in
                 3[6-9].*|[4-9][0-9].*) pass "поддерживается compileSdk ${NEWEST_BT%%.*}" ;;
                 *) echo "  потолок compileSdk ${NEWEST_BT%%.*}; для 37: rai install sdk" ;;
               esac ;;
    *) warn "build-tools $NEWEST_BT не ARM — запустите rai install sdk" ;;
  esac
fi
if [ -d "$HOME/x86-sysroot" ]; then
  warn "остался x86-sysroot от qemu-режима — можно удалить: rm -rf ~/x86-sysroot"
fi

sect "Gradle"
GP="$HOME/.gradle/gradle.properties"
if [ -f "$GP" ]; then
  pass "глобальный gradle.properties есть"
  grep -q "aapt2FromMavenOverride" "$GP" && pass "aapt2FromMavenOverride задан" || warn "нет aapt2FromMavenOverride в $GP"
  grep -q "org.gradle.daemon=false" "$GP" && pass "daemon выключен" || warn "включите org.gradle.daemon=false (в proot демон часто виснет)"
else warn "нет $GP"; fi

JARS=$(find "$HOME/.gradle/caches" -name 'aapt2-*-linux.jar' 2>/dev/null | wc -l)
echo "  aapt2 jar-ов в кэше: $JARS"
if [ "$JARS" -gt 0 ]; then
  for j in $(find "$HOME/.gradle/caches" -name 'aapt2-*-linux.jar' 2>/dev/null); do
    tmp=$(mktemp -d); (cd "$tmp" && "$JAVA_HOME/bin/jar" -xf "$j" aapt2 2>/dev/null)
    if [ -f "$tmp/aapt2" ]; then
      I=$(file -b "$tmp/aapt2")
      case "$I" in
        *aarch64*) pass "$(basename "$j"): внутри ARM" ;;
        *) warn "$(basename "$j"): внутри $I → запустите rai build, он пропатчит" ;;
      esac
    fi
    rm -rf "$tmp"
  done
fi

sect "Сеть"
for h in dl.google.com repo1.maven.org services.gradle.org; do
  if curl -sfI --max-time 8 "https://$h" >/dev/null 2>&1; then pass "$h доступен"; else fail "$h недоступен"; fi
done

sect "Итог"
if [ "$ERRORS" -eq 0 ]; then
  echo -e "${GREEN}Проблем не обнаружено. Можно собирать.${NC}"
else
  echo -e "${RED}Найдено проблем: $ERRORS${NC}  — см. отметки ✘ выше."
fi
