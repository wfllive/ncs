#!/usr/bin/env bash
# =============================================================================
#  rai verify — контроль целостности файлов RAI
#
#  ЧЕСТНО О ВОЗМОЖНОСТЯХ:
#  Это shell-скрипты на устройстве пользователя. Скрыть их содержимое или
#  запретить правку технически НЕЛЬЗЯ — у кого есть файл, у того есть и код.
#  Обфускация (shc, base64, xor) вскрывается одной командой и даёт лишь
#  ложное чувство защиты.
#
#  ЧТО РЕАЛЬНО РАБОТАЕТ и сделано здесь:
#    • ОБНАРУЖЕНИЕ изменений — SHA-256 манифест всех файлов
#    • ОТПЕЧАТОК версии — одна строка, которую можно попросить у пользователя
#    • ЧЁТКИЙ ОТВЕТ на «у меня сломалось»: официальная сборка или изменённая
#
#  Смысл: снять с вас ответственность за чужие правки, а не помешать им.
#
#  Команды:
#     rai verify              проверить целостность
#     rai verify --manifest   создать манифест (для мейнтейнера, перед релизом)
#     rai verify --fingerprint только отпечаток одной строкой
# =============================================================================
. "${RAI_HOME:-$HOME/rai}/lib/common.sh"

MANIFEST="$RAI_HOME/.rai-manifest"

# Список файлов, входящих в проверку
_int_files() {
  find "$RAI_HOME" -type f \
    \( -name '*.sh' -o -name 'rai' -o -name '*.md' -o -name '*.js' \) \
    ! -name '.rai-manifest' \
    -printf '%P\n' 2>/dev/null | sort
}

_hash_of() {  # SHA-256 одного файла
  sha256sum "$RAI_HOME/$1" 2>/dev/null | awk '{print $1}'
}

# --------------------------------------------------------- создать манифест
int_create() {
  step "Создание манифеста целостности"
  local n=0
  {
    echo "# RAI integrity manifest"
    echo "# version: ${RAI_VERSION:-1.0}"
    echo "# created: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    while IFS= read -r f; do
      printf '%s  %s\n' "$(_hash_of "$f")" "$f"
      n=$((n+1))
    done < <(_int_files)
  } > "$MANIFEST"
  chmod 444 "$MANIFEST" 2>/dev/null
  ok "Файлов: $(grep -cv '^#' "$MANIFEST")"
  ok "Манифест: $MANIFEST"
  echo
  echo "  Отпечаток сборки: $(int_fingerprint)"
  echo
  echo -e "  ${C_D}Включите .rai-manifest в релизный архив.${C_N}"
}

# --------------------------------------------------------- отпечаток
int_fingerprint() {
  if [ -f "$MANIFEST" ]; then
    grep -v '^#' "$MANIFEST" | sha256sum | cut -c1-16
  else
    _int_files | while IFS= read -r f; do _hash_of "$f"; done \
      | sha256sum | cut -c1-16
  fi
}

# --------------------------------------------------------- проверка
int_verify() {
  local quiet="${1:-}"

  if [ ! -f "$MANIFEST" ]; then
    [ "$quiet" = "--quiet" ] && return 2
    warn "Манифест отсутствует — целостность проверить нельзя"
    echo "  Такое бывает у сборки из исходников или у изменённой копии."
    echo "  Официальные релизы содержат .rai-manifest."
    echo
    echo "  Текущий отпечаток: $(int_fingerprint)"
    return 2
  fi

  local changed=() missing=() extra=() total=0
  while read -r want file; do
    case "$want" in '#'*) continue;; esac
    [ -n "$file" ] || continue
    total=$((total+1))
    if [ ! -f "$RAI_HOME/$file" ]; then
      missing+=("$file"); continue
    fi
    [ "$(_hash_of "$file")" = "$want" ] || changed+=("$file")
  done < "$MANIFEST"

  # файлы, которых нет в манифесте
  while IFS= read -r f; do
    grep -q "  $f\$" "$MANIFEST" || extra+=("$f")
  done < <(_int_files)

  local bad=$(( ${#changed[@]} + ${#missing[@]} ))

  if [ "$quiet" = "--quiet" ]; then
    [ "$bad" -eq 0 ] && return 0 || return 1
  fi

  step "Проверка целостности RAI"
  echo "  каталог  : $RAI_HOME"
  echo "  версия   : $(grep -oP '(?<=^# version: ).*' "$MANIFEST" 2>/dev/null)"
  echo "  собрано  : $(grep -oP '(?<=^# created: ).*' "$MANIFEST" 2>/dev/null)"
  echo "  файлов   : $total"
  echo "  отпечаток: $(int_fingerprint)"
  echo

  if [ "$bad" -eq 0 ] && [ "${#extra[@]}" -eq 0 ]; then
    echo -e "  ${C_G}✔ Официальная сборка, изменений нет${C_N}"
    return 0
  fi

  for f in "${changed[@]}"; do echo -e "  ${C_Y}изменён${C_N}     $f"; done
  for f in "${missing[@]}"; do echo -e "  ${C_R}отсутствует${C_N} $f"; done
  for f in "${extra[@]}";   do echo -e "  ${C_D}лишний${C_N}      $f"; done

  echo
  if [ "$bad" -gt 0 ]; then
    echo -e "  ${C_Y}Сборка изменена относительно официальной.${C_N}"
    echo
    echo "  Это нормально, если правки ваши. Но учтите:"
    echo "    • о проблемах изменённой сборки сообщать бесполезно"
    echo "    • перед обращением в поддержку восстановите оригинал"
    echo
    echo "  Восстановить:"
    echo -e "      ${C_B}скачайте архив заново и запустите bash setup.sh${C_N}"
    return 1
  fi
  echo -e "  ${C_D}Есть посторонние файлы, но официальные не тронуты.${C_N}"
  return 0
}

case "${1:-verify}" in
  --manifest|manifest|create) int_create ;;
  --fingerprint|fingerprint)  int_fingerprint ;;
  --quiet)                    int_verify --quiet ;;
  *)                          int_verify ;;
esac
