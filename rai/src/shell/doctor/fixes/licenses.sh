#!/usr/bin/env bash
# =============================================================================
#  rai fix licenses
#
#  ЛЕЧИТ: "==> Принимаю лицензии SDK…" висит и ничего не происходит.
#
#  ДВЕ РЕАЛЬНЫЕ ПРИЧИНЫ (не в самих лицензиях):
#
#  1) Java SecureRandom блокируется на /dev/random.
#     В proot энтропии почти нет, JVM ждёт её бесконечно.
#     Лечится: securerandom.source=file:/dev/./urandom
#
#  2) sdkmanager ждёт ввод "y" в интерактивном режиме, а `yes |` не всегда
#     доходит через proot-пайп. Процесс замирает на чтении stdin.
#     Лечится: записываем файлы лицензий НАПРЯМУЮ — sdkmanager не нужен.
#
#  Лицензия — это просто файл с SHA1-хэшем. Никакой магии.
#  Хэши взяты из официального SDK.
#
#  Запуск:  rai fix licenses
# =============================================================================
set -euo pipefail

BLUE='\033[1;34m'; GREEN='\033[1;32m'; RED='\033[1;31m'; YEL='\033[1;33m'; NC='\033[0m'
log(){ echo -e "${BLUE}==>${NC} $*"; }
ok(){ echo -e "${GREEN} OK ${NC} $*"; }
warn(){ echo -e "${YEL}WARN${NC} $*"; }

SDK_DIR="${ANDROID_HOME:-$HOME/android-sdk}"

echo "─────────────────────────────────────────────"
echo " Починка зависшего 'Принимаю лицензии SDK…'"
echo "─────────────────────────────────────────────"
echo

# ---- 0. Убить зависшие процессы ---------------------------------------------
log "Снимаю зависшие sdkmanager / java…"
pkill -f sdkmanager 2>/dev/null && echo "    убит sdkmanager" || echo "    sdkmanager не запущен"
pkill -f 'java.*sdklib' 2>/dev/null || true
pkill -f 'GradleDaemon' 2>/dev/null && echo "    убит Gradle daemon" || true
sleep 1
ok "Процессы очищены"

# ---- 1. ПРИЧИНА №1: энтропия -------------------------------------------------
log "Чиню Java SecureRandom (главная причина зависания)…"

ENTROPY="$(cat /proc/sys/kernel/random/entropy_avail 2>/dev/null || echo '?')"
echo "    энтропии в системе: $ENTROPY  (норма >1000; в proot обычно мало)"

JH="${JAVA_HOME:-}"
if [ -z "$JH" ] || [ ! -x "$JH/bin/java" ]; then
  JH="/usr/lib/jvm/java-17-openjdk-arm64"
  [ -d "$JH" ] || JH="$(dirname "$(dirname "$(readlink -f "$(command -v javac 2>/dev/null || command -v java)")")")"
fi

PATCHED=0
for SEC in "$JH/conf/security/java.security" "$JH/lib/security/java.security"; do
  [ -f "$SEC" ] || continue
  cp -n "$SEC" "$SEC.bak" 2>/dev/null || true
  sed -i \
    -e 's|^securerandom.source=.*|securerandom.source=file:/dev/./urandom|' \
    -e 's|^securerandom.strongAlgorithms=NativePRNGBlocking.*|securerandom.strongAlgorithms=NativePRNG:SUN|' \
    "$SEC"
  grep -q 'urandom' "$SEC" && { echo "    пропатчен: $SEC"; PATCHED=1; }
done

if [ "$PATCHED" -eq 1 ]; then
  ok "SecureRandom больше не блокируется"
else
  warn "java.security не найден — добавлю флаг через переменную окружения"
fi

# страховка через переменную окружения
BRC="$HOME/.bashrc"
if ! grep -q 'java.security.egd' "$BRC" 2>/dev/null; then
  cat >> "$BRC" <<'EOF'

# фикс зависания JVM на нехватке энтропии в proot
export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom ${JAVA_TOOL_OPTIONS:-}"
EOF
  ok "JAVA_TOOL_OPTIONS добавлен в ~/.bashrc"
fi
export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom ${JAVA_TOOL_OPTIONS:-}"

# ---- 2. ПРИЧИНА №2: пишем лицензии напрямую ---------------------------------
log "Записываю лицензии напрямую (без sdkmanager)…"
LIC="$SDK_DIR/licenses"
mkdir -p "$LIC"

write_lic(){ printf '\n%s\n' "$2" > "$LIC/$1"; echo "    + $1"; }

write_lic android-sdk-license              "24333f8a63b6825ea9c5514f83c2829b004d1fee"
write_lic android-sdk-preview-license      "84831b9409646a918e30573bab4c9c91346d8abd"
write_lic android-sdk-arm-dbt-license      "859f317696f67ef3d7f30a50a5560e7834b43903"
write_lic android-googletv-license         "601085b94cd77f0b54ff86406957099ebe79c4d6"
write_lic android-googlexr-license         "ceff83576aac4f7f37cb98fe189e9fb3c49d3b81"
write_lic google-gdk-license               "33b6a2b64607f11b759f320ef9dff4ae5c47d97a"
write_lic mips-android-sysimage-license    "e9acab5b5fbb560a72cfaecce8946896ff6aab9d"

ok "Лицензии приняты — sdkmanager для этого больше не нужен"

# ---- 3. Проверка -------------------------------------------------------------
echo
log "Проверяю, что JVM больше не виснет…"
if timeout 25 java -XshowSettings:properties -version >/dev/null 2>&1; then
  ok "JVM стартует нормально"
else
  warn "JVM всё ещё медленная — см. раздел 'если не помогло' ниже"
fi

if [ -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  log "Проверяю sdkmanager (тайм-аут 60 сек)…"
  if timeout 60 "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --list_installed >/dev/null 2>&1; then
    ok "sdkmanager отвечает"
  else
    warn "sdkmanager всё ещё тормозит — но это уже не мешает: лицензии записаны,
     а скрипт 07 ставит SDK без sdkmanager вообще."
  fi
fi

cat <<EOF

$(echo -e "${GREEN}================== ГОТОВО ==================${NC}")

Выполните:  source ~/.bashrc

$(echo -e "${BLUE}Что дальше${NC})

Самый надёжный путь — вообще обойти sdkmanager. Скрипт 07 качает
готовый SDK архивом, и лицензии там уже внутри:

    rai install sdk

$(echo -e "${YEL}Если sdkmanager всё же нужен — запускайте так:${NC})

    export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom"
    sdkmanager --sdk_root="$SDK_DIR" --install "platforms;android-37.0" < /dev/null

Ключевое: $(echo -e "${BLUE}< /dev/null${NC}") — sdkmanager не будет ждать ввод.
Никогда не используйте 'yes | sdkmanager' в proot: пайп часто зависает.

$(echo -e "${YEL}Если не помогло${NC})

1. Не хватает памяти — JVM молча свопится:
       free -h
   При RAM < 3 ГБ:  export JAVA_OPTS="-Xmx512m"

2. Проверьте, что процесс реально жив, а не ждёт сеть:
       top -b -n1 | head -15

3. Установите haveged (генератор энтропии):
       apt-get install -y haveged && haveged -w 1024 -F &

4. Проблема с DNS/сетью в proot (выглядит как зависание):
       echo "nameserver 8.8.8.8" > /etc/resolv.conf
       curl -sI https://dl.google.com | head -1

5. Полностью пропустить sdkmanager:
       rai install sdk
EOF
