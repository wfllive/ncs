#!/usr/bin/env bash
# =============================================================================
#  src/shell/project/build-release.sh — сборка RELEASE APK (подпись + R8)
#
#  Отдельный скрипт, делает ровно одно: собирает релиз для публикации.
#  Вызывается из JS (src/run.js). Модуль встраивается в сборку.
#
#      bash project/build-release.sh /root/projects/MyApp
#      bash project/build-release.sh /root/projects/MyApp --bundle   # AAB для Google Play
#
#  Отличия от debug:
#      • подпись вашим release-ключом (keystore.properties)
#      • R8: сжатие и обфускация кода, удаление лишних ресурсов
#      • isDebuggable = false
# =============================================================================
set -uo pipefail

PROJ="${1:?Укажите путь к проекту}"
shift 2>/dev/null || true

BUNDLE=0; EXTRA=()
for a in "$@"; do
  case "$a" in
    --bundle|--aab) BUNDLE=1 ;;
    *) EXTRA+=("$a") ;;
  esac
done

G='\033[1;32m'; B='\033[1;34m'; Y='\033[1;33m'; R='\033[1;31m'; D='\033[2m'; N='\033[0m'
log(){ echo -e "${B}==>${N} $*"; }
ok(){  echo -e "${G} OK ${N} $*"; }
warn(){ echo -e "${Y}WARN${N} $*"; }
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

BT="$(ls "$SDK/build-tools" 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -1)"
[ -n "$BT" ] || die "SDK не установлен"
AAPT2="$SDK/build-tools/$BT/aapt2"
APKSIGNER="$SDK/build-tools/$BT/apksigner"

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

# ---- ключ подписи ------------------------------------------------------------
SIGNED=1
if [ ! -f keystore.properties ]; then
  SIGNED=0
  warn "Ключ подписи не настроен — APK будет НЕподписанным"
  echo "  Такой файл нельзя установить и опубликовать."
  echo -e "  Создать:  ${B}rai keystore create $(basename "$PROJ")${N}"
  echo
  if [ -t 0 ]; then
    read -rp "  Продолжить без подписи? [y/N] " a
    [[ "$a" =~ ^[yY]$ ]] || exit 1
  else
    die "Прервано: нет ключа подписи"
  fi
else
  KS="$(grep -oP '(?<=^storeFile=).*' keystore.properties 2>/dev/null)"
  [ -n "$KS" ] && [ ! -f "$KS" ] && die "Файл ключа не найден: $KS
  Восстановите из резервной копии или создайте новый."
  ok "ключ подписи на месте"
fi

# ---- версия ------------------------------------------------------------------
GF="app/build.gradle.kts"
VCODE="$(grep -oP '(?<=versionCode = )\d+' "$GF" 2>/dev/null | head -1)"
VNAME="$(grep -oP '(?<=versionName = ")[^"]+' "$GF" 2>/dev/null | head -1)"

echo
echo -e "${B}СБОРКА RELEASE${N}  ${D}$(basename "$PROJ")${N}"
echo -e "${D}версия ${VNAME:-?} (code ${VCODE:-?}) · build-tools $BT${N}"
echo -e "${D}Google Play требует, чтобы versionCode рос при каждой публикации.${N}"
echo

TASK="assembleRelease"; [ "$BUNDLE" -eq 1 ] && TASK="bundleRelease"
LOG="$TMPDIR/build-release-$(basename "$PROJ").log"
log "./gradlew $TASK  ${D}(R8 — дольше debug)${N}"

set +e
./gradlew "$TASK" --no-daemon --console=plain --warning-mode=none \
  ${GRADLE_ARGS:-} ${EXTRA[@]+"${EXTRA[@]}"} 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
set -e

if [ "$RC" -ne 0 ]; then
  echo
  echo -e "${R}Сборка не удалась.${N} Лог: $LOG"
  echo
  sed -n '/^\* What went wrong:/,/^\* Try:/p' "$LOG" | grep -v '^\* Try:' | head -20
  grep -E '^e: ' "$LOG" | head -10
  if grep -q "no longer required for Kotlin support" "$LOG"; then
    echo -e "\n${Y}AGP 9 + лишний плагин kotlin.android${N} → rai fix abi"
  elif grep -qE "Conflicting configuration.*abiFilters" "$LOG"; then
    echo -e "\n${Y}Конфликт abiFilters и splits.abi${N} → rai fix abi"
  elif grep -qiE "keystore|SigningConfig|password"; then
    echo -e "\n${Y}Проблема с ключом подписи${N} → rai keystore info $(basename "$PROJ")"
  fi
  exit "$RC"
fi

echo
ok "Сборка завершена"

# ---- проверка подписи --------------------------------------------------------
echo
echo "Результат:"
FOUND=0
while read -r f; do
  [ -n "$f" ] || continue
  FOUND=1
  echo -e "   ${G}$f${N}   $(du -h "$f" | cut -f1)"
  case "$f" in
    *.apk)
      if [ -x "$APKSIGNER" ]; then
        if "$APKSIGNER" verify "$f" >/dev/null 2>&1; then
          echo -e "      подпись: ${G}действительна${N}"
          "$APKSIGNER" verify --print-certs "$f" 2>/dev/null \
            | grep -iE 'certificate DN' | head -1 | sed 's/^/      /'
        else
          echo -e "      подпись: ${R}ОТСУТСТВУЕТ${N} — публиковать нельзя"
        fi
      fi
      libs="$(unzip -l "$f" 2>/dev/null | grep -oE 'lib/[^/]+' | sed 's|lib/||' | sort -u | tr '\n' ' ')"
      [ -n "$libs" ] && echo "      ABI: $libs"
      ;;
  esac
done < <(find . \( -path '*/build/outputs/apk/release/*' -name '*.apk' \
                -o -path '*/build/outputs/bundle/*' -name '*.aab' \) 2>/dev/null)
[ "$FOUND" -eq 1 ] || warn "выходные файлы не найдены"

# ---- mapping.txt -------------------------------------------------------------
MAP="$(find . -name 'mapping.txt' -path '*release*' 2>/dev/null | head -1)"
if [ -n "$MAP" ]; then
  echo
  echo -e "${Y}Сохраните файл деобфускации:${N}"
  echo "   $MAP"
  echo -e "${D}   Без него стек-трейсы крашей из релиза нечитаемы.${N}"
  echo -e "${D}   Рекомендуется: ~/releases/$(basename "$PROJ")/${VNAME:-1.0}/${N}"
fi

if [ "$SIGNED" -eq 0 ]; then
  echo
  warn "APK не подписан — только для локальной проверки"
fi

echo
echo -e "${D}Перед публикацией: versionCode больше предыдущего, APK проверен на устройстве.${N}"
