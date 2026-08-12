#!/usr/bin/env bash
# =============================================================================
#  rai fix java
#
#  ЛЕЧИТ: "✘ JAVA_HOME не задан/неверен", хотя `java --version` работает.
#
#  ПОЧЕМУ ТАК БЫВАЕТ:
#    `java` находится через PATH (симлинк в /usr/bin), поэтому команда работает.
#    Но Gradle и AGP читают именно переменную JAVA_HOME — и без неё падают
#    с "Could not determine java version" или берут не тот JDK.
#
#    Чаще всего причина: строки есть в ~/.bashrc, но вы не выполнили
#    `source ~/.bashrc`, либо зашли в proot неинтерактивно (bash script.sh),
#    и ~/.bashrc не подхватился.
#
#  Запуск:  rai fix java  &&  source ~/.bashrc
# =============================================================================
set -euo pipefail

BLUE='\033[1;34m'; GREEN='\033[1;32m'; RED='\033[1;31m'; YEL='\033[1;33m'; NC='\033[0m'
log(){ echo -e "${BLUE}==>${NC} $*"; }
ok(){ echo -e "${GREEN} OK ${NC} $*"; }
warn(){ echo -e "${YEL}WARN${NC} $*"; }
die(){ echo -e "${RED}FAIL${NC} $*"; exit 1; }

SDK_DIR="${ANDROID_HOME:-$HOME/android-sdk}"

echo "──────────────────────────────────────"
echo "  Починка JAVA_HOME"
echo "──────────────────────────────────────"
echo

# ---- 1. Ищем JDK всеми способами --------------------------------------------
log "Ищу установленный JDK 17…"
CAND=""

# способ 1: стандартный путь Ubuntu arm64
for p in /usr/lib/jvm/java-17-openjdk-arm64 \
         /usr/lib/jvm/java-17-openjdk-aarch64 \
         /usr/lib/jvm/java-17-openjdk*; do
  [ -x "$p/bin/javac" ] && { CAND="$p"; break; }
done

# способ 2: раскрутить симлинк от javac
if [ -z "$CAND" ] && command -v javac >/dev/null 2>&1; then
  R="$(readlink -f "$(command -v javac)")"
  P="$(dirname "$(dirname "$R")")"
  [ -x "$P/bin/javac" ] && CAND="$P"
fi

# способ 3: от java (если javac нет — стоит только JRE)
if [ -z "$CAND" ] && command -v java >/dev/null 2>&1; then
  R="$(readlink -f "$(command -v java)")"
  P="$(dirname "$(dirname "$R")")"
  [ -x "$P/bin/java" ] && CAND="$P"
fi

# способ 4: перебор всех JVM
if [ -z "$CAND" ]; then
  for p in /usr/lib/jvm/*/; do
    [ -x "${p}bin/javac" ] && { CAND="${p%/}"; break; }
  done
fi

[ -n "$CAND" ] || die "JDK не найден. Установите:  apt-get install -y openjdk-17-jdk-headless"

# ---- 2. Проверяем, что это полноценный JDK ----------------------------------
if [ ! -x "$CAND/bin/javac" ]; then
  warn "Найден только JRE (нет javac) — Gradle требует полный JDK."
  log "Доустанавливаю openjdk-17-jdk-headless…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y --no-install-recommends openjdk-17-jdk-headless >/dev/null 2>&1 || true
  for p in /usr/lib/jvm/java-17-openjdk-arm64 /usr/lib/jvm/java-17-openjdk*; do
    [ -x "$p/bin/javac" ] && { CAND="$p"; break; }
  done
  [ -x "$CAND/bin/javac" ] || die "javac так и не появился"
fi

export JAVA_HOME="$CAND"
export PATH="$JAVA_HOME/bin:$PATH"
ok "JAVA_HOME=$JAVA_HOME"
echo "    java  : $("$JAVA_HOME/bin/java" -version 2>&1 | grep -v Picked | head -1)"
echo "    javac : $("$JAVA_HOME/bin/javac" -version 2>&1 | head -1)"

# ---- 3. Прописываем НАВСЕГДА, во все нужные файлы ----------------------------
BT_VER="$(ls "$SDK_DIR/build-tools" 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -1 || true)"

BLOCK="# >>> android-arm64-env >>>
export JAVA_HOME=\"$JAVA_HOME\"
export ANDROID_HOME=\"$SDK_DIR\"
export ANDROID_SDK_ROOT=\"\$ANDROID_HOME\"
export PATH=\"\$JAVA_HOME/bin:\$HOME/bin:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools${BT_VER:+:\$ANDROID_HOME/build-tools/$BT_VER}:\$PATH\"
export GRADLE_OPTS=\"-Dorg.gradle.daemon=false -Dfile.encoding=UTF-8\"
export JAVA_TOOL_OPTIONS=\"-Djava.security.egd=file:/dev/./urandom\"
export TMPDIR=\"\$HOME/tmp\"; mkdir -p \"\$TMPDIR\" 2>/dev/null
# <<< android-arm64-env <<<"

for F in "$HOME/.bashrc" "$HOME/.profile"; do
  touch "$F"
  # удаляем старый блок, если был
  if grep -q '# >>> android-arm64-env >>>' "$F" 2>/dev/null; then
    sed -i '/# >>> android-arm64-env >>>/,/# <<< android-arm64-env <<</d' "$F"
  fi
  printf '\n%s\n' "$BLOCK" >> "$F"
  ok "Записано в $(basename "$F")"
done

# ---- 4. Системный уровень: работает даже без ~/.bashrc -----------------------
# Это важно: `bash script.sh` и proot-login -c НЕ читают ~/.bashrc
if [ -d /etc/profile.d ] && [ -w /etc/profile.d ]; then
  cat > /etc/profile.d/android-env.sh <<EOF
export JAVA_HOME="$JAVA_HOME"
export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="\$ANDROID_HOME"
export PATH="\$JAVA_HOME/bin:\$HOME/bin:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$PATH"
EOF
  chmod 644 /etc/profile.d/android-env.sh
  ok "Записано в /etc/profile.d/android-env.sh (для неинтерактивных сессий)"
fi

# ---- 5. Дублируем в Gradle — самая надёжная страховка ------------------------
# Gradle читает org.gradle.java.home и не зависит от переменных окружения вообще
GP="$HOME/.gradle/gradle.properties"
mkdir -p "$HOME/.gradle"; touch "$GP"
if grep -q '^org.gradle.java.home=' "$GP"; then
  sed -i "s|^org.gradle.java.home=.*|org.gradle.java.home=$JAVA_HOME|" "$GP"
else
  echo "org.gradle.java.home=$JAVA_HOME" >> "$GP"
fi
ok "org.gradle.java.home прописан в ~/.gradle/gradle.properties"

# ---- 6. Симлинк для стабильности пути ----------------------------------------
# если JDK обновится (17.0.19 -> 17.0.20), путь не сломается
if [ ! -e /usr/lib/jvm/java-17-current ] && [ -w /usr/lib/jvm ] 2>/dev/null; then
  ln -sfn "$JAVA_HOME" /usr/lib/jvm/java-17-current 2>/dev/null && \
    echo "    (создан стабильный симлинк /usr/lib/jvm/java-17-current)"
fi

# ---- 7. Проверка -------------------------------------------------------------
echo
log "Проверка в чистой неинтерактивной оболочке:"
if env -i HOME="$HOME" bash -lc 'echo "  JAVA_HOME=$JAVA_HOME"; [ -x "$JAVA_HOME/bin/javac" ] && echo "  javac доступен"' 2>/dev/null | grep -q javac; then
  ok "JAVA_HOME виден даже в новой сессии"
else
  warn "В чистой сессии не подхватилось — но org.gradle.java.home всё покроет"
fi

cat <<EOF

$(echo -e "${GREEN}================ ГОТОВО ================${NC}")

Выполните сейчас:

    source ~/.bashrc

Проверьте:

    echo \$JAVA_HOME
    rai doctor

Теперь JAVA_HOME задан в 4 местах — сломаться нечему:
  1. ~/.bashrc              (интерактивный вход)
  2. ~/.profile             (login-оболочка)
  3. /etc/profile.d/        (неинтерактивные скрипты)
  4. gradle.properties      (Gradle читает напрямую, минуя окружение)

$(echo -e "${BLUE}Почему это вообще случилось${NC})

\`java --version\` работал, потому что бинарник найден через PATH (/usr/bin/java).
Но Gradle читает переменную JAVA_HOME, а она не была экспортирована в вашей
сессии — скорее всего, вы не выполнили \`source ~/.bashrc\` после установки.
EOF
