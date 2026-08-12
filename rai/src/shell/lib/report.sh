#!/usr/bin/env bash
# =============================================================================
#  rai report — отчёт для обращения в поддержку
#
#  ЗАЧЕМ: чтобы автор оригинала не разбирал проблемы чужих модификаций.
#  Отчёт в первой же строке отвечает на вопрос «это оригинал или мод?».
#
#  Без отчёта обращения не принимаются — так вопрос закрывается за секунды,
#  а не за переписку на три дня.
#
#     rai report              вывести на экран
#     rai report --save       сохранить в файл
# =============================================================================
. "${RAI_HOME:-$HOME/rai}/lib/common.sh"
. "${RAI_HOME:-$HOME/rai}/lib/sources.sh" 2>/dev/null || true

SAVE=0; [ "${1:-}" = "--save" ] && SAVE=1

_report() {
echo "===================== RAI SUPPORT REPORT ====================="
echo "создан: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# ---------- 1. ГЛАВНОЕ: подлинность ----------
echo "--- ПОДЛИННОСТЬ СБОРКИ ---"
local st="unknown" fp=""
if [ -f "$RAI_HOME/lib/integrity.sh" ]; then
  fp="$(bash "$RAI_HOME/lib/integrity.sh" --fingerprint 2>/dev/null)"
  if bash "$RAI_HOME/lib/integrity.sh" --quiet 2>/dev/null; then
    st="ОРИГИНАЛ"
  else
    case $? in
      2) st="БЕЗ МАНИФЕСТА (сборка не из официального релиза)" ;;
      *) st="ИЗМЕНЁН" ;;
    esac
  fi
fi
echo "статус     : $st"
echo "отпечаток  : ${fp:-неизвестен}"
echo "версия     : $(grep -oP '(?<=^# version: ).*' "$RAI_HOME/.rai-manifest" 2>/dev/null || echo '?')"
echo "собрано    : $(grep -oP '(?<=^# created: ).*' "$RAI_HOME/.rai-manifest" 2>/dev/null || echo '?')"
echo "каталог    : $RAI_HOME"

if [ "$st" = "ИЗМЕНЁН" ]; then
  echo
  echo "ИЗМЕНЁННЫЕ ФАЙЛЫ:"
  bash "$RAI_HOME/lib/integrity.sh" 2>/dev/null \
    | grep -E '^\s+(изменён|отсутствует|лишний)\s' | sed 's/^ */  /'
fi
echo

# ---------- 2. Источники загрузки ----------
echo "--- ИСТОЧНИКИ ЗАГРУЗКИ ---"
if command -v rai_sources_show >/dev/null 2>&1; then
  rai_sources_show
  local ext
  ext="$(rai_sources_audit 2>/dev/null)"
  if [ -n "$ext" ]; then
    echo "  ВНИМАНИЕ: посторонние домены в скриптах:"
    echo "$ext" | sed 's/^/    - /'
  fi
  # переопределения через окружение
  local ov=""
  for v in RAI_SRC_SDK_REPO RAI_SRC_GOOGLE_REPO RAI_SRC_GRADLE_DIST RAI_SRC_UBUNTU_BASE; do
    [ -n "${!v:-}" ] && env | grep -q "^$v=" && ov="$ov $v"
  done
  [ -n "$ov" ] && echo "  переопределения через окружение:$ov"
else
  echo "  (реестр источников недоступен)"
fi
echo

# ---------- 3. Окружение ----------
echo "--- ОКРУЖЕНИЕ ---"
echo "среда      : $(rai_env_name 2>/dev/null)"
echo "архитектура: $(uname -m)"
echo "ядро       : $(uname -r)"
echo "ОС         : $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
echo "RAM        : $(free -m 2>/dev/null | awk '/Mem:/{print $2" МБ (свободно "$7" МБ)"}')"
echo "диск       : $(df -h "$HOME" 2>/dev/null | awk 'NR==2{print $4" свободно из "$2}')"
echo "локаль     : ${LANG:-не задана}"
echo

# ---------- 4. Инструменты ----------
echo "--- ИНСТРУМЕНТЫ ---"
if rai_setup_java 2>/dev/null; then
  echo "java       : $(java -version 2>&1 | grep -v Picked | head -1)"
  echo "JAVA_HOME  : $JAVA_HOME"
else
  echo "java       : НЕ НАЙДЕНА"
fi
echo "ANDROID_HOME: $ANDROID_HOME"
echo "build-tools : $(rai_all_bt 2>/dev/null)"
echo "platforms   : $(ls "$ANDROID_HOME/platforms" 2>/dev/null | tr '\n' ' ')"
local bt; bt="$(rai_newest_bt 2>/dev/null)"
if [ -n "$bt" ]; then
  echo "aapt2 тип   : $(file -b "$ANDROID_HOME/build-tools/$bt/aapt2" 2>/dev/null | cut -c1-60)"
  echo "aapt2 версия: $("$ANDROID_HOME/build-tools/$bt/aapt2" version 2>/dev/null | head -1)"
fi
echo

# ---------- 5. Проект ----------
local PROJ="${RAI_REPORT_PROJECT:-}"
if [ -n "$PROJ" ] && rai_is_project "$PROJ"; then
  echo "--- ПРОЕКТ $(basename "$PROJ") ---"
  local gf="$PROJ/app/build.gradle.kts"
  echo "AGP        : $(grep -oP '(?<=com\.android\.application"\) version ")[^"]+' "$PROJ/build.gradle.kts" 2>/dev/null | head -1)"
  echo "Gradle     : $(grep -oP '(?<=gradle-)[0-9.]+(?=-bin)' "$PROJ/gradle/wrapper/gradle-wrapper.properties" 2>/dev/null)"
  echo "compileSdk : $(grep -oP '(?<=compileSdk = )\d+' "$gf" 2>/dev/null | head -1)"
  echo "buildTools : $(grep -oP '(?<=buildToolsVersion = ")[^"]+' "$gf" 2>/dev/null | head -1)"
  echo "ABI        : $(grep -o 'abiFilters[^\n]*' "$gf" 2>/dev/null | grep -oE '"[a-z0-9_-]+"' | tr -d '"' | tr '\n' ' ')"
  echo "подпись    : $([ -f "$PROJ/keystore.properties" ] && echo "настроена" || echo "нет (только debug)")"
  echo
fi

# ---------- 6. Итог ----------
echo "--- ЗАКЛЮЧЕНИЕ ---"
case "$st" in
  ОРИГИНАЛ)
    echo "Сборка официальная. Обращение принимается."
    ;;
  ИЗМЕНЁН)
    echo "ВНИМАНИЕ: файлы RAI изменены относительно официального релиза."
    echo "Автор оригинала за такие сборки ответственности не несёт."
    echo "Перед обращением восстановите оригинал:"
    echo "  1) скачайте архив официального релиза"
    echo "  2) распакуйте поверх"
    echo "  3) bash ~/rai/setup.sh"
    echo "  4) повторите ошибку и приложите новый отчёт"
    ;;
  *)
    echo "Манифест отсутствует: сборка не из официального релиза"
    echo "(копия из исходников, форк или ручная сборка)."
    echo "Для поддержки установите официальный релиз."
    ;;
esac
echo "=============================================================="
}

if [ "$SAVE" -eq 1 ]; then
  OUT="$HOME/rai-report-$(date +%Y%m%d-%H%M%S).txt"
  _report > "$OUT" 2>&1
  ok "Отчёт сохранён: $OUT"
  echo
  echo "Приложите этот файл к обращению."
else
  _report
fi
