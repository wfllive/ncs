#!/usr/bin/env bash
# =============================================================================
#  src/shell/project/build-debug.sh — сборка DEBUG APK
#
#  Отдельный скрипт, делает ровно одно: собирает отладочную сборку.
#  Вызывается из JS (src/run.js). Модуль встраивается в сборку.
#
#      bash project/build-debug.sh /root/projects/MyApp
#
#  Переменные:
#      ANDROID_HOME   путь к SDK        (по умолчанию ~/android-sdk)
#      GRADLE_ARGS    доп. флаги Gradle
# =============================================================================
set -uo pipefail

PROJ="${1:?Укажите путь к проекту}"
shift 2>/dev/null || true
EXTRA=("$@")

G='\033[1;32m'; B='\033[1;34m'; Y='\033[1;33m'; R='\033[1;31m'; D='\033[2m'; N='\033[0m'
log(){ echo -e "${B}==>${N} $*"; }
ok(){  echo -e "${G} OK ${N} $*"; }
die(){ echo -e "${R}FAIL${N} $*" >&2; exit 1; }

SDK="${ANDROID_HOME:-$HOME/android-sdk}"
cd "$PROJ" || die "Нет каталога: $PROJ"
[ -f settings.gradle.kts ] || [ -f settings.gradle ] || die "Не Gradle-проект: $PROJ"

# ---- окружение ---------------------------------------------------------------
JAVA_HOME="${JAVA_HOME:-}"
if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then
  JAVA_HOME=""
  # 1) стандартные пути JDK 17
  for p in /usr/lib/jvm/java-17-openjdk-arm64 /usr/lib/jvm/java-17-openjdk* \
           /usr/lib/jvm/java-17-* ; do
    [ -x "$p/bin/javac" ] && { JAVA_HOME="$p"; break; }
  done
  # 2) раскрутка симлинка javac
  if [ -z "$JAVA_HOME" ] && command -v javac >/dev/null 2>&1; then
    JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  fi
  # 3) любой JDK в /usr/lib/jvm
  if [ -z "$JAVA_HOME" ]; then
    for p in /usr/lib/jvm/*/; do
      [ -x "${p}bin/javac" ] && { JAVA_HOME="${p%/}"; break; }
    done
  fi
fi
[ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/javac" ] || die "JDK не найден → rai install base"
export JAVA_HOME="${JAVA_HOME:-}" ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
export PATH="$JAVA_HOME/bin:$SDK/platform-tools:$PATH"
export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom ${JAVA_TOOL_OPTIONS:-}"
export TMPDIR="${TMPDIR:-$HOME/tmp}"; mkdir -p "$TMPDIR"

# ---- aapt2 из самой свежей build-tools --------------------------------------
BT="$(ls "$SDK/build-tools" 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -1)"
[ -n "$BT" ] || die "SDK не установлен (нет build-tools)"
AAPT2="$SDK/build-tools/$BT/aapt2"
[ -f "$AAPT2" ] || die "Нет aapt2 в build-tools/$BT"

grep -q 'aapt2FromMavenOverride' gradle.properties 2>/dev/null || \
  echo "android.aapt2FromMavenOverride=$AAPT2" >> gradle.properties

[ -f local.properties ] || echo "sdk.dir=$SDK" > local.properties
chmod +x gradlew 2>/dev/null

# ---- Gradle Wrapper на месте? -----------------------------------------------
# Иначе получаем "./gradlew: No such file or directory" — непонятно, что чинить.
if [ ! -s gradlew ] || [ ! -s gradle/wrapper/gradle-wrapper.jar ]; then
  echo
  echo -e "${R}Gradle Wrapper отсутствует${N} — собрать нельзя."
  [ -s gradlew ]                          || echo "  нет: gradlew"
  [ -s gradle/wrapper/gradle-wrapper.jar ] || echo "  нет: gradle/wrapper/gradle-wrapper.jar"
  echo
  echo -e "  Докачать:  ${B}rai prepare $(basename "$PROJ")${N}"
  exit 1
fi

echo
echo -e "${B}СБОРКА DEBUG${N}  ${D}$(basename "$PROJ")${N}"
echo -e "${D}build-tools $BT · $(basename "$JAVA_HOME")${N}"
echo

# ---- сборка ------------------------------------------------------------------
LOG="$TMPDIR/build-debug-$(basename "$PROJ").log"
log "./gradlew assembleDebug"

set +e
./gradlew assembleDebug --no-daemon --console=plain --warning-mode=none \
  ${GRADLE_ARGS:-} ${EXTRA[@]+"${EXTRA[@]}"} 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
set -e

if [ "$RC" -ne 0 ]; then
  echo
  echo -e "${R}Сборка не удалась.${N} Лог: $LOG"
  echo
  sed -n '/^\* What went wrong:/,/^\* Try:/p' "$LOG" | grep -v '^\* Try:' | head -20
  grep -E '^e: ' "$LOG" | head -10

  # типовые причины — сразу подсказка
  if grep -q "no longer required for Kotlin support" "$LOG"; then
    echo -e "\n${Y}AGP 9 + лишний плагин kotlin.android${N} → rai fix abi"
  elif grep -qE "Conflicting configuration.*abiFilters" "$LOG"; then
    echo -e "\n${Y}Конфликт abiFilters и splits.abi${N} → rai fix abi"
  elif grep -qE "Exec format error|AAPT2 .*Daemon" "$LOG"; then
    echo -e "\n${Y}aapt2 не для этой архитектуры${N} → rai install sdk"
  fi
  exit "$RC"
fi

echo
ok "Сборка завершена"

# ---- результат ---------------------------------------------------------------
echo
echo "APK:"
find . -path '*/build/outputs/apk/debug/*' -name '*.apk' 2>/dev/null | while read -r apk; do
  echo -e "   ${G}$apk${N}   $(du -h "$apk" | cut -f1)"
  libs="$(unzip -l "$apk" 2>/dev/null | grep -oE 'lib/[^/]+' | sed 's|lib/||' | sort -u | tr '\n' ' ')"
  [ -n "$libs" ] && echo "      ABI: $libs" \
                 || echo -e "      ${D}нет нативных .so (чистый Kotlin)${N}"
done

cat <<EOF

${D}Debug-сборка: подписана отладочным ключом, applicationId с суффиксом .debug.
Для публикации нужна release-сборка.${N}
EOF
