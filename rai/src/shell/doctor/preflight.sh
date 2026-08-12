#!/usr/bin/env bash
# =============================================================================
#  rai/doctor/preflight.sh — быстрая проверка ПЕРЕД сборкой (2-3 секунды)
#
#  Ловит ошибки на этапе конфигурации, не тратя минуты на запуск Gradle.
#  Запускается автоматически из `rai build`. Отключить: rai build --skip-check
#
#  Коды возврата:
#     0 — можно собирать
#     1 — есть блокирующие проблемы
# =============================================================================
set -uo pipefail
. "${RAI_HOME:-$HOME/rai}/lib/common.sh"

PROJ="$(rai_project_path "${1:-}")"
PROBLEMS=0
FIXES=()

p_ok(){   echo -e "  ${C_G}✔${C_N} $*"; }
p_bad(){  echo -e "  ${C_R}✘${C_N} $*"; PROBLEMS=$((PROBLEMS+1)); }
p_warn(){ echo -e "  ${C_Y}!${C_N} $*"; }

echo -e "${C_C}Проверка перед сборкой${C_N}  ${C_D}$PROJ${C_N}"

# ---- 1. Окружение ------------------------------------------------------------
if rai_setup_java; then
  p_ok "Java 17 ($(basename "$JAVA_HOME"))"
else
  p_bad "JDK не найден"
  FIXES+=("rai fix java")
fi

BT="$(rai_newest_bt)"
if [ -n "$BT" ]; then
  if rai_is_arm "$ANDROID_HOME/build-tools/$BT/aapt2"; then
    p_ok "SDK build-tools: $(rai_all_bt)(нативный ARM)"
  else
    p_bad "aapt2 не ARM — сборка упадёт"
    FIXES+=("rai install sdk")
  fi
else
  p_bad "build-tools не установлены"
  FIXES+=("rai install sdk")
fi

# ---- 2. Проект существует ----------------------------------------------------
if ! rai_is_project "$PROJ"; then
  p_bad "Это не Gradle-проект: нет settings.gradle.kts"
  echo
  echo -e "${C_R}Проверка не пройдена${C_N}  —  создать проект: ${C_B}rai new MyApp${C_N}"
  exit 1
fi
p_ok "Проект найден"

# ---- 2.5 Gradle Wrapper ------------------------------------------------------
# Без gradlew сборка падает с невнятным "./gradlew: No such file or directory".
# Проверяем -s: неудачная загрузка оставляет пустой файл.
WRAP_JAR="$PROJ/gradle/wrapper/gradle-wrapper.jar"
MISSING=""
[ -s "$PROJ/gradlew" ] || MISSING="gradlew"
[ -s "$WRAP_JAR" ]     || MISSING="${MISSING:+$MISSING, }gradle/wrapper/gradle-wrapper.jar"

if [ -n "$MISSING" ]; then
  p_bad "Gradle Wrapper неполный: нет $MISSING"
  echo "       Обычно это оборванная загрузка при создании проекта."
  FIXES+=("rai prepare $(basename "$PROJ")")
else
  p_ok "Gradle Wrapper на месте"
fi

GF="$PROJ/app/build.gradle.kts"
[ -f "$GF" ] || GF="$(find "$PROJ" -maxdepth 2 -name 'build.gradle.kts' -path '*/app/*' | head -1)"

# ---- 3. Конфликт abiFilters + splits.abi (частая ошибка) --------------------
if [ -f "$GF" ]; then
  HAS_ABIF=0; HAS_SPLITS=0
  grep -qE '(^|[[:space:];{])abiFilters' "$GF" && HAS_ABIF=1
  grep -qE '(^|[[:space:]])splits[[:space:]]*\{' "$GF" && HAS_SPLITS=1
  if [ "$HAS_ABIF" -eq 1 ] && [ "$HAS_SPLITS" -eq 1 ]; then
    if grep -A12 -E '(^|[[:space:]])splits[[:space:]]*\{' "$GF" | grep -qE '(^|[[:space:];{])abi[[:space:]]*\{'; then
      p_bad "Конфликт: ndk.abiFilters вместе со splits.abi"
      echo "       AGP: 'Conflicting configuration ... cannot be present when splits abi filters are set'"
      FIXES+=("rai fix abi $PROJ")
    fi
  elif [ "$HAS_ABIF" -eq 1 ]; then
    ABIS="$(grep -o 'abiFilters[^\n]*' "$GF" | grep -oE '"[a-z0-9_-]+"' | tr -d '"' | sort -u | tr '\n' ' ')"
    p_ok "ABI: ${ABIS:-arm64-v8a}"
  else
    p_warn "ABI не ограничен — APK соберётся под все архитектуры"
  fi

  # ---- 3b. AGP 9+ вместе с плагином kotlin.android --------------------------
  RB=""
  for c in "$PROJ/build.gradle.kts"; do [ -f "$c" ] && RB="$c"; done
  AGPMAJ="$(grep -oP '(?<=com\.android\.application"\) version ")[0-9]+' ${RB:+"$RB"} 2>/dev/null | head -1)"
  if [ -n "$AGPMAJ" ] && [ "$AGPMAJ" -ge 9 ]; then
    if grep -q 'org.jetbrains.kotlin.android' "$GF" ${RB:+"$RB"} 2>/dev/null; then
      p_bad "AGP $AGPMAJ: плагин kotlin.android лишний (Kotlin встроен)"
      echo "       Gradle: \"The 'org.jetbrains.kotlin.android' plugin is no longer required\""
      FIXES+=("rai fix abi $PROJ")
    else
      p_ok "AGP $AGPMAJ: встроенный Kotlin (плагин не применён)"
    fi
  fi

  # ---- 4. compileSdk против установленных build-tools -----------------------
  CSDK="$(grep -oP '(?<=compileSdk\s=\s)\d+' "$GF" | head -1)"
  MAXSDK="$(rai_max_sdk)"
  if [ -n "$CSDK" ] && [ "$MAXSDK" -gt 0 ]; then
    if [ "$CSDK" -le "$MAXSDK" ]; then
      p_ok "compileSdk $CSDK (доступно до $MAXSDK)"
    else
      p_bad "compileSdk $CSDK, но build-tools только до $MAXSDK"
      FIXES+=("rai install sdk")
    fi
  fi

  # ---- 5. buildToolsVersion реально существует ------------------------------
  BTV="$(grep -oP '(?<=buildToolsVersion = ")[^"]+' "$GF" | head -1)"
  if [ -n "$BTV" ] && [ ! -d "$ANDROID_HOME/build-tools/$BTV" ]; then
    p_bad "buildToolsVersion \"$BTV\" не установлен (есть: $(rai_all_bt))"
    FIXES+=("rai install sdk")
  fi

  # ---- 6. Устаревший DSL (не блокирует) -------------------------------------
  grep -vE '^\s*//' "$GF" | grep -qE '(^|[[:space:]])kotlinOptions[[:space:]]*\{' && \
    p_warn "kotlinOptions устарел → rai fix abi (заменит на compilerOptions)"
fi

# ---- 7. Платформа под compileSdk --------------------------------------------
if [ -n "${CSDK:-}" ]; then
  if ls -d "$ANDROID_HOME/platforms/android-$CSDK"* >/dev/null 2>&1; then
    p_ok "platform android-$CSDK установлена"
  else
    p_bad "нет platforms;android-$CSDK (есть: $(ls "$ANDROID_HOME/platforms" 2>/dev/null | tr '\n' ' '))"
    FIXES+=("rai install sdk")
  fi
fi

# ---- 8. local.properties -----------------------------------------------------
if [ -f "$PROJ/local.properties" ]; then
  SDKDIR="$(grep -oP '(?<=^sdk.dir=).*' "$PROJ/local.properties" | head -1)"
  if [ -n "$SDKDIR" ] && [ ! -d "$SDKDIR" ]; then
    p_bad "local.properties указывает на несуществующий $SDKDIR"
    FIXES+=("echo \"sdk.dir=$ANDROID_HOME\" > $PROJ/local.properties")
  fi
else
  p_warn "нет local.properties — создаю"
  echo "sdk.dir=$ANDROID_HOME" > "$PROJ/local.properties"
fi

# ---- 9. Ресурсы системы ------------------------------------------------------
AVAIL_KB="$(df -k "$HOME" | awk 'NR==2{print $4}')"
[ "${AVAIL_KB:-0}" -lt 3000000 ] && p_warn "мало места: $((AVAIL_KB/1024)) МБ"
MEM_AV="$(free -m 2>/dev/null | awk '/Mem:/{print $7}')"
[ "${MEM_AV:-9999}" -lt 900 ] && p_warn "мало свободной RAM: ${MEM_AV}МБ — уменьшите -Xmx"

# ---- Итог --------------------------------------------------------------------
echo
if [ "$PROBLEMS" -eq 0 ]; then
  if [ "${RAI_PREFLIGHT_QUIET:-0}" = "1" ]; then
    echo -e "${C_G}Проверка пройдена${C_N}"
  else
    echo -e "${C_G}Проверка пройдена${C_N} — запускаю сборку"
  fi
  exit 0
fi

echo -e "${C_R}Проверка не пройдена: проблем — $PROBLEMS${C_N}"
if [ "${#FIXES[@]}" -gt 0 ]; then
  echo
  echo "Как исправить:"
  printf '%s\n' "${FIXES[@]}" | awk '!seen[$0]++' | sed 's/^/    /'
fi
echo
echo -e "${C_D}Пропустить проверку: rai build --skip-check${C_N}"
exit 1
