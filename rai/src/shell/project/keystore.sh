#!/usr/bin/env bash
# =============================================================================
#  rai keystore — управление ключом подписи релизных APK
#
#    rai keystore create [проект]   создать release-ключ
#    rai keystore info   [проект]   показать сведения о ключе
#    rai keystore verify <apk>      проверить подпись готового APK
#
#  Ключ создаётся ЛОКАЛЬНО и остаётся только у вас.
#  RAI никуда его не отправляет и не хранит копий.
#
#  ВАЖНО: потеря ключа = невозможность обновить приложение в Google Play.
#  Сделайте резервную копию .jks и пароля в надёжном месте.
# =============================================================================
set -uo pipefail
. "${RAI_HOME:-$HOME/rai}/lib/common.sh"

ACTION="${1:-help}"; shift 2>/dev/null || true

KS_DIR="${RAI_KEYSTORES:-$HOME/.rai/keystores}"
mkdir -p "$KS_DIR" 2>/dev/null
chmod 700 "$KS_DIR" 2>/dev/null

rai_setup_java || die "JDK не найден → rai fix java"
KEYTOOL="$JAVA_HOME/bin/keytool"
[ -x "$KEYTOOL" ] || die "keytool не найден в $JAVA_HOME/bin"

find_apksigner() {
  local bt; bt="$(rai_newest_bt)"
  [ -n "$bt" ] && [ -f "$ANDROID_HOME/build-tools/$bt/apksigner" ] \
    && { echo "$ANDROID_HOME/build-tools/$bt/apksigner"; return 0; }
  command -v apksigner 2>/dev/null && return 0
  return 1
}

# --------------------------------------------------------------- create
ks_create() {
  local PROJ NAME KS PROPS
  PROJ="$(rai_project_path "${1:-}")"
  NAME="$(basename "$PROJ")"
  KS="$KS_DIR/$NAME-release.jks"

  if [ -f "$KS" ]; then
    warn "Ключ уже существует: $KS"
    read -rp "  Создать заново? СТАРЫЙ БУДЕТ ПОТЕРЯН [y/N] " a
    [[ "$a" =~ ^[yY]$ ]] || { log "Отменено"; return 0; }
    mv -f "$KS" "$KS.old.$(date +%s)"
  fi

  step "Создание ключа подписи для $NAME"
  cat <<'EOF'
  Ключ подписывает релизные APK. Требования Google Play:
    • срок действия — минимум до 2033 года (ставим 30 лет)
    • алгоритм RSA 2048+
    • ключ нельзя менять после первой публикации

EOF

  local ALIAS PASS PASS2 CN ORG CITY CC
  read -rp "  Псевдоним ключа [release]: " ALIAS; ALIAS="${ALIAS:-release}"

  while :; do
    read -rsp "  Пароль (мин. 6 символов): " PASS; echo
    [ "${#PASS}" -ge 6 ] || { warn "слишком короткий"; continue; }
    read -rsp "  Повторите пароль: " PASS2; echo
    [ "$PASS" = "$PASS2" ] && break
    warn "пароли не совпадают"
  done

  read -rp "  Имя/организация [$NAME]: " CN;   CN="${CN:-$NAME}"
  read -rp "  Компания [Unknown]: "     ORG;  ORG="${ORG:-Unknown}"
  read -rp "  Город [Unknown]: "        CITY; CITY="${CITY:-Unknown}"
  read -rp "  Код страны (2 буквы) [GE]: " CC; CC="${CC:-GE}"

  log "Генерирую RSA 2048, срок 30 лет…"
  if ! "$KEYTOOL" -genkeypair -v \
        -keystore "$KS" \
        -alias "$ALIAS" \
        -keyalg RSA -keysize 2048 -validity 10950 \
        -storepass "$PASS" -keypass "$PASS" \
        -dname "CN=$CN, O=$ORG, L=$CITY, C=$CC" >/dev/null 2>&1; then
    die "keytool не смог создать ключ"
  fi
  chmod 600 "$KS"
  ok "Ключ создан: $KS"

  local SHA256_FP
  SHA256_FP="$("$KEYTOOL" -list -v -keystore "$KS" -alias "$ALIAS" -storepass "$PASS" 2>/dev/null | grep -oP '(?<=SHA256:\s)[A-Fa-f0-9:]+' | head -1 || true)"

  # keystore.properties — рядом с проектом, но НЕ в git
  PROPS="$PROJ/keystore.properties"
  cat > "$PROPS" <<EOF
# Учётные данные подписи. НЕ добавлять в git!
storeFile=$KS
storePassword=$PASS
keyAlias=$ALIAS
keyPassword=$PASS
expectedSha256=$SHA256_FP
EOF
  chmod 600 "$PROPS"
  ok "Настройки: $PROPS"

  for GI in "$PROJ/.gitignore"; do
    touch "$GI"
    grep -q '^keystore.properties$' "$GI" 2>/dev/null || {
      printf '\n# подпись — секреты\nkeystore.properties\n*.jks\n*.keystore\n' >> "$GI"
      ok ".gitignore дополнен"
    }
  done

  echo
  echo -e "${C_Y}СОХРАНИТЕ РЕЗЕРВНУЮ КОПИЮ:${C_N}"
  echo "    $KS"
  echo "  и пароль. Без них обновить приложение в Google Play будет НЕЛЬЗЯ."
  echo
  echo "Отпечаток ключа:"
  "$KEYTOOL" -list -v -keystore "$KS" -alias "$ALIAS" -storepass "$PASS" 2>/dev/null \
    | grep -E 'SHA1:|SHA256:|Valid from' | sed 's/^/    /'
  echo
  echo -e "Теперь: ${C_B}rai build $NAME release${C_N}"
}

# --------------------------------------------------------------- info
ks_info() {
  local PROJ NAME KS PROPS
  PROJ="$(rai_project_path "${1:-}")"
  NAME="$(basename "$PROJ")"
  PROPS="$PROJ/keystore.properties"

  if [ -f "$PROPS" ]; then
    KS="$(grep -oP '(?<=^storeFile=).*' "$PROPS")"
    local AL PW
    AL="$(grep -oP '(?<=^keyAlias=).*' "$PROPS")"
    PW="$(grep -oP '(?<=^storePassword=).*' "$PROPS")"
    step "Ключ проекта $NAME"
    echo "  файл    : $KS"
    echo "  алиас   : $AL"
    if [ -f "$KS" ]; then
      "$KEYTOOL" -list -v -keystore "$KS" -alias "$AL" -storepass "$PW" 2>/dev/null \
        | grep -E 'Valid from|SHA1:|SHA256:|Signature algorithm' | sed 's/^/  /'
    else
      err "файл ключа не найден!"
    fi
  else
    warn "У проекта $NAME нет ключа"
    echo "  Создать:  rai keystore create $NAME"
  fi

  echo
  step "Все ключи в $KS_DIR"
  local found=0
  for k in "$KS_DIR"/*.jks; do
    [ -f "$k" ] || continue
    found=1
    printf "  %-34s %s\n" "$(basename "$k")" "$(du -h "$k" | cut -f1)"
  done
  [ "$found" -eq 0 ] && echo "  (пусто)"
}

# --------------------------------------------------------------- verify
ks_verify() {
  local APK="${1:-}" AS
  [ -n "$APK" ] || die "Укажите APK: rai keystore verify app-release.apk"
  [ -f "$APK" ] || die "Файл не найден: $APK"

  AS="$(find_apksigner)" || die "apksigner не найден → rai install sdk"

  step "Проверка подписи"
  echo "  $APK"
  echo
  if "$AS" verify --verbose --print-certs "$APK" 2>&1 | sed 's/^/  /'; then
    echo
    ok "Подпись действительна"
  else
    echo
    err "APK не подписан или подпись повреждена"
    echo "  Debug-сборка не годится для публикации — соберите release."
    return 1
  fi
}

case "$ACTION" in
  create|new|gen)  ks_create "$@" ;;
  info|list|show)  ks_info "$@" ;;
  verify|check)    ks_verify "$@" ;;
  *)
cat <<'EOF'
rai keystore <команда>

  create [проект]   создать release-ключ (RSA 2048, 30 лет)
  info   [проект]   сведения о ключе и отпечатки
  verify <apk>      проверить подпись готового APK

Ключи хранятся в ~/.rai/keystores (права 700).
Пароли — в keystore.properties проекта (600, добавлен в .gitignore).

ВАЖНО: сделайте резервную копию .jks и пароля.
Потеря ключа = невозможность обновить приложение в Google Play.
EOF
  ;;
esac
