#!/usr/bin/env bash
# =============================================================================
#  rai version — управление версиями
#
#  Различаются ДВЕ версии, их часто путают:
#
#   1. Версия RAI       — самого инструмента. Меняется перед релизом RAI.
#                         Хранится в файле `rai` (RAI_VERSION).
#
#   2. Версия ПРИЛОЖЕНИЯ — вашего APK. Меняется перед публикацией приложения.
#                         Хранится в app/build.gradle.kts:
#                           versionCode — целое, растёт на 1 (для Google Play)
#                           versionName — строка для пользователя ("1.4.2")
#
#  Команды:
#     rai version                     показать обе версии
#     rai version --set 1.1           задать версию RAI (перед релизом RAI)
#     rai version --bump patch|minor|major   поднять версию RAI
#     rai version app <проект>        версия приложения
#     rai version app <проект> --bump patch|minor|major
#     rai version app <проект> --set 2.0.0
# =============================================================================
. "${RAI_HOME:-$HOME/rai}/lib/common.sh"

# Версия RAI живёт в bin/rai.js (основная логика на JS)
RAI_FILE="$RAI_HOME/bin/rai.js"

cur_rai_version() {
  grep -oP "(?<=^const VERSION = ')[^']+" "$RAI_FILE" 2>/dev/null || echo "0.0"
}

# semver: bump <версия> <patch|minor|major>
_bump() {
  local v="$1" what="$2" a b c
  IFS='.' read -r a b c <<< "$v"
  a="${a:-0}"; b="${b:-0}"; c="${c:-0}"
  case "$what" in
    major) a=$((a+1)); b=0; c=0 ;;
    minor) b=$((b+1)); c=0 ;;
    patch|*) c=$((c+1)) ;;
  esac
  echo "$a.$b.$c"
}

# --------------------------------------------------------- версия RAI
set_rai_version() {
  local new="$1" old
  old="$(cur_rai_version)"
  [[ "$new" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || die "Формат версии: 1.2 или 1.2.3"

  sed -i "s|^const VERSION = '[^']*';|const VERSION = '$new';|" "$RAI_FILE"
  [ "$(cur_rai_version)" = "$new" ] || die "Не удалось записать версию"

  ok "Версия RAI: $old → $new"
  echo
  echo "  Манифест целостности устарел. Соберите релиз:"
  echo -e "      ${C_B}bash \$RAI_HOME/sh/release.sh${C_N}"
}

# --------------------------------------------------------- версия приложения
app_version() {
  local PROJ GF code name
  PROJ="$(rai_project_path "${1:-}")"
  rai_is_project "$PROJ" || die "Не Gradle-проект: $PROJ"
  GF="$PROJ/app/build.gradle.kts"
  [ -f "$GF" ] || die "Нет $GF"

  shift 2>/dev/null || true
  local action="" value=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --set)   action="set";  value="${2:-}"; shift ;;
      --bump)  action="bump"; value="${2:-patch}"; shift ;;
      --code)  action="code"; value="${2:-}"; shift ;;
    esac
    shift
  done

  code="$(grep -oP '(?<=versionCode = )\d+' "$GF" | head -1)"
  name="$(grep -oP '(?<=versionName = ")[^"]+' "$GF" | head -1)"

  case "$action" in
    "")
      step "Версия приложения $(basename "$PROJ")"
      echo "  versionCode : ${code:-?}   ${C_D}(целое, для Google Play)${C_N}"
      echo "  versionName : ${name:-?}   ${C_D}(видит пользователь)${C_N}"
      echo
      echo "  Поднять:  rai version app $(basename "$PROJ") --bump patch"
      ;;
    set|bump)
      local newname newcode
      if [ "$action" = "bump" ]; then
        newname="$(_bump "${name:-0.0.0}" "$value")"
      else
        [ -n "$value" ] || die "Укажите версию: --set 1.2.3"
        newname="$value"
      fi
      newcode=$(( ${code:-0} + 1 ))
      sed -i "s|versionCode = ${code:-0}|versionCode = $newcode|" "$GF"
      sed -i "s|versionName = \"${name:-}\"|versionName = \"$newname\"|" "$GF"
      ok "versionCode: ${code:-0} → $newcode"
      ok "versionName: ${name:-?} → $newname"
      echo
      echo "  Собрать релиз:  rai build $(basename "$PROJ") release"
      ;;
    code)
      [ -n "$value" ] || die "Укажите число: --code 42"
      sed -i "s|versionCode = ${code:-0}|versionCode = $value|" "$GF"
      ok "versionCode: ${code:-0} → $value"
      ;;
  esac
}

# --------------------------------------------------------- показать всё
show_all() {
  step "Версии"
  echo "  RAI          : $(cur_rai_version)"
  if [ -f "$RAI_HOME/.rai-manifest" ]; then
    local mv fp
    mv="$(grep -oP '(?<=^# version: ).*' "$RAI_HOME/.rai-manifest" 2>/dev/null)"
    fp="$(bash "$RAI_HOME/lib/integrity.sh" --fingerprint 2>/dev/null)"
    echo "  в манифесте  : ${mv:-?}"
    echo "  отпечаток    : ${fp:-?}"
    if [ "$mv" != "$(cur_rai_version)" ]; then
      echo
      warn "версия в файле и в манифесте расходятся — пересоберите: bash \$RAI_HOME/sh/release.sh"
    fi
  else
    echo "  манифест     : отсутствует (сборка не из релиза)"
  fi

  local n=0
  for d in "$RAI_PROJECTS"/*/; do
    rai_is_project "${d%/}" || continue
    [ "$n" -eq 0 ] && { echo; echo "  Проекты:"; }
    n=1
    local gf c v
    gf="${d}app/build.gradle.kts"
    c="$(grep -oP '(?<=versionCode = )\d+' "$gf" 2>/dev/null | head -1)"
    v="$(grep -oP '(?<=versionName = ")[^"]+' "$gf" 2>/dev/null | head -1)"
    printf "    %-20s %s (code %s)\n" "$(basename "${d%/}")" "${v:-?}" "${c:-?}"
  done
}

case "${1:-show}" in
  --set)          shift; set_rai_version "${1:-}" ;;
  --bump)         shift; set_rai_version "$(_bump "$(cur_rai_version)" "${1:-patch}")" ;;
  app|project)    shift; app_version "$@" ;;
  show|"")        show_all ;;
  -h|--help)
cat <<'EOF'
rai version                          показать версии RAI и проектов
rai version --set 1.1                задать версию RAI
rai version --bump patch|minor|major поднять версию RAI

rai version app MyApp                версия приложения
rai version app MyApp --bump patch   1.0.0 → 1.0.1, versionCode +1
rai version app MyApp --set 2.0.0    задать явно
rai version app MyApp --code 42      задать только versionCode

Версия RAI  — инструмента, меняется перед релизом RAI.
Версия app  — вашего APK, меняется перед публикацией приложения.
EOF
  ;;
  *)              show_all ;;
esac
