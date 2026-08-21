#!/usr/bin/env bash
# =============================================================================
#  NCS Fast Install — минимальная быстрая установка окружения
#  Устанавливает ТОЛЬКО необходимое:
#   - openjdk-17-jdk-headless (без Recommends/Suggests)
#   - базовые утилиты curl/unzip/zip
#   - Android SDK cmdline-tools + build-tools 35.0.0 + platform android-35
#   - CLI ncs в ~/.ncs/bin
#
#  Правки для proot/Ubuntu 24.04 (noble):
#   - корректно обрабатывает deb822-формат sources (ubuntu.sources)
#   - на arm64/armhf гарантированно использует ports.ubuntu.com,
#     отключает дублирующие записи в sources.list
#   - чинит locks / half-configured dpkg ПЕРЕД установкой
#   - выставляет JAVA_TOOL_OPTIONS и прописывает urandom в java.security
#     ДО установки JDK (чтобы ca-certificates-java.postinst не вис)
#   - отключает apt sandbox, сервис-старты в chroot (policy-rc.d)
#   - идемпотентен: повторный запуск чинит битое состояние и продолжает
# =============================================================================
set -uo pipefail
# set -e НЕ включаем намеренно: после apt install ловим exit-код сами, чтобы
# дать dpkg --configure второй шанс.

if [ -t 1 ]; then
  B='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; NC='\033[0m'
else
  B=''; G=''; Y=''; R=''; NC=''
fi
log()  { echo -e "${B}[fast]${NC} $*"; }
ok()   { echo -e "  ${G}✓${NC} $*"; }
warn() { echo -e "  ${Y}⚠${NC} $*"; }
die()  { echo -e "  ${R}✗${NC} $*"; exit 1; }

NCS_HOME="${NCS_HOME:-$HOME/.ncs}"
SDK_DIR="$NCS_HOME/sdk"
CACHE_DIR="$NCS_HOME/cache"
TMP_DIR="$NCS_HOME/tmp"

mkdir -p "$NCS_HOME" "$SDK_DIR" "$CACHE_DIR" "$TMP_DIR"

export DEBIAN_FRONTEND=noninteractive

# ------------------------------------------------------------------ 0. Починка dpkg/apt
# В proot часто остаются lock-файлы после неудачных попыток.
log "Проверка и починка dpkg/apt..."
for lf in /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/cache/apt/archives/lock /var/lib/apt/lists/lock; do
  [ -f "$lf" ] && rm -f "$lf" 2>/dev/null || true
done

# /tmp права — без этого apt падает с "Couldn't create temporary file"
for d in /tmp /var/tmp; do
  mkdir -p "$d" 2>/dev/null
  chmod 1777 "$d" 2>/dev/null || true
done

# Force dpkg to keep existing configs, don't prompt
export DEBCONF_NONINTERACTIVE_SEEN=true
export DEBIAN_PRIORITY=critical
export DEBIAN_FRONTEND=noninteractive

# Запрещаем старт сервисов внутри chroot/proot (чтобы postinst скрипты не висели)
if [ ! -f /usr/sbin/policy-rc.d ] || ! grep -q 'ncs-fast' /usr/sbin/policy-rc.d 2>/dev/null; then
  cat > /usr/sbin/policy-rc.d <<'EOF'
#!/bin/sh
# ncs-fast: запрещаем старт сервисов в chroot/proot
exit 101
EOF
  chmod +x /usr/sbin/policy-rc.d 2>/dev/null || true
fi

# Конфиг apt без Recommends/Suggests; отключаем sandbox и Pty
cat > /etc/apt/apt.conf.d/99ncs-fast <<'EOF'
APT::Install-Recommends "false";
APT::Install-Suggests "false";
APT::Get::Assume-Yes "true";
APT::Get::allow-unauthenticated "false";
Acquire::Retries "3";
Acquire::http::Pipeline-Depth "5";
Acquire::http::No-Cache "false";
Acquire::Queue-Mode "access";
Dpkg::Use-Pty "0";
APT::Sandbox::User "";
Dir::Cache::pkgcache "";
Dir::Cache::srcpkgcache "";
Dpkg::Options {"--force-confdef"; "--force-confold"; "--force-unsafe-io";};
EOF
ok "apt.conf настроен"

# DNS
if ! grep -q "^nameserver" /etc/resolv.conf 2>/dev/null; then
  printf 'nameserver 8.8.8.8\nnameserver 1.1.1.1\nnameserver 8.8.4.4\n' > /etc/resolv.conf
  ok "DNS настроен"
fi

# ------------------------------------------------------------------ 2. Зеркала и дедупликация
ARCH="$(dpkg --print-architecture 2>/dev/null || echo arm64)"
CODENAME="$(. /etc/os-release 2>/dev/null && echo "${VERSION_CODENAME:-noble}")"

if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "armhf" ]; then
  PORTS_URI="http://ports.ubuntu.com/ubuntu-ports"
  ARCHIVE_URI="http://archive.ubuntu.com/ubuntu"
  SECURITY_URI="http://security.ubuntu.com/ubuntu"

  # 2.1 Если есть deb822 файл ubuntu.sources — убедимся что он использует ports,
  #     а не archive/security (которые для amd64). Заменяем URI на ports.
  UBUNTU_SOURCES="/etc/apt/sources.list.d/ubuntu.sources"
  if [ -f "$UBUNTU_SOURCES" ]; then
    cp -n "$UBUNTU_SOURCES" "${UBUNTU_SOURCES}.bak-ncs" 2>/dev/null || true
    sed -i \
      -e "s|^URIs:\s*${ARCHIVE_URI}|URIs: ${PORTS_URI}|g" \
      -e "s|^URIs:\s*${SECURITY_URI}|URIs: ${PORTS_URI}|g" \
      -e "s|http://archive.ubuntu.com/ubuntu|${PORTS_URI}|g" \
      -e "s|http://security.ubuntu.com/ubuntu|${PORTS_URI}|g" \
      "$UBUNTU_SOURCES" 2>/dev/null || true
  fi

  # 2.2 Если есть proot-distro/patched sources с archive.ubuntu.com — меняем на ports
  if [ -f /etc/apt/sources.list ]; then
    cp -n /etc/apt/sources.list /etc/apt/sources.list.bak-ncs 2>/dev/null || true
    sed -i \
      -e "s|http://archive.ubuntu.com/ubuntu|${PORTS_URI}|g" \
      -e "s|http://security.ubuntu.com/ubuntu|${PORTS_URI}|g" \
      /etc/apt/sources.list 2>/dev/null || true
  fi

  # 2.3 Проверяем: есть ли ports.ubuntu.com в любом из sources?
  HAVE_PORTS=0
  if grep -rshE '^URIs:\s*.*ports\.ubuntu\.com|^deb\s+.*ports\.ubuntu\.com' \
       /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list 2>/dev/null \
     | grep -q .; then
    HAVE_PORTS=1
  fi

  if [ "$HAVE_PORTS" = "0" ]; then
    # Ни один источник не указывает на ports — пишем минимальный sources.list
    cat > /etc/apt/sources.list <<EOF
deb ${PORTS_URI} ${CODENAME} main restricted universe multiverse
deb ${PORTS_URI} ${CODENAME}-updates main restricted universe multiverse
deb ${PORTS_URI} ${CODENAME}-security main restricted universe multiverse
EOF
    ok "добавлено зеркало ports.ubuntu.com для $CODENAME ($ARCH)"
  else
    ok "зеркало ports.ubuntu.com уже есть в sources"
  fi

  # 2.4 Дедупликация: если активен ubuntu.sources (deb822), закомментируем ВСЕ
  #     deb/deb-src строки в /etc/apt/sources.list чтобы не было "Target Packages
  #     is configured multiple times". Это самая частая причина падения apt
  #     после повторного запуска.
  if [ -f "$UBUNTU_SOURCES" ] && [ -f /etc/apt/sources.list ] && [ -s /etc/apt/sources.list ]; then
    # Комментируем любые активные deb/deb-src строки в sources.list, если
    # ubuntu.sources существует (он и так содержит нужные компоненты).
    sed -i -E '/^[[:space:]]*deb(-src)?[[:space:]]/s/^/# /' /etc/apt/sources.list 2>/dev/null || true
  fi

  # 2.5 Удаляем/комментируем пустые или дублирующие .list файлы в sources.list.d,
  #     оставшиеся от прошлых неудачных попыток.
  for f in /etc/apt/sources.list.d/*.list; do
    [ -f "$f" ] || continue
    if grep -qE '^[[:space:]]*deb' "$f" 2>/dev/null; then
      if [ -f "$UBUNTU_SOURCES" ] && grep -q 'ports.ubuntu.com' "$UBUNTU_SOURCES" 2>/dev/null; then
        sed -i -E '/^[[:space:]]*deb(-src)?[[:space:]]/s/^/# /' "$f" 2>/dev/null || true
      fi
    fi
  done
else
  # amd64 — ничего особенного, только дедупликация при наличии обоих форматов
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ] && [ -s /etc/apt/sources.list ]; then
    sed -i -E '/^[[:space:]]*deb(-src)?[[:space:]]/s/^/# /' /etc/apt/sources.list 2>/dev/null || true
  fi
fi

# ------------------------------------------------------------------ 3. Обновление списков
log "Обновление списков пакетов..."
# Несколько попыток apt-get update (в proot сеть иногда поднимается с задержкой)
UPDATE_OK=0
for _ in 1 2 3; do
  set +e
  apt-get update -qq 2>&1 | { grep -vE '^W: (Target Packages|Target Translations|Target Sources).*configured multiple times|^W: .*is configured multiple times' || true; } | tail -5
  RC=${PIPESTATUS[0]}
  set -e
  if [ "$RC" = "0" ]; then UPDATE_OK=1; break; fi
  sleep 2
done
[ "$UPDATE_OK" = "1" ] || warn "apt update с предупреждениями — продолжаю"
ok "списки обновлены"

# ------------------------------------------------------------------ 4. Сначала гарантируем наличие perl/debconf/ca-certificates
# ВАЖНО: ca-certificates.postinst — это Perl-скрипт, и если dpkg --configure -a
# запустить ДО установки perl/debconf, он пытается выполнить /usr/share/debconf/frontend
# через /bin/sh и падает с "use: not found" / "Syntax error: ( unexpected)".
# Поэтому сначала ставим минимальный bootstrap-комплект, потом конфигурим битые пакеты.
log "Первичная установка perl/debconf/ca-certificates..."
for _ in 1 2; do
  set +e
  apt-get install -y --no-install-recommends \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" \
    -o Dpkg::Options::="--force-unsafe-io" \
    perl-base perl debconf debconf-i18n liblocale-gettext-perl ca-certificates 2>&1 \
    | { grep -vE '^Progress|^Setting up|^Selecting|^Preparing|^Unpacking|^Configuring|^Adding|^Created|^Processing|^Use |^Downloaded|^Get:[0-9]+|^Fetched|^[0-9]+ upgraded|^[0-9]+ newly' || true; } \
    | tail -10
  RC=${PIPESTATUS[0]}
  set -e
  if command -v perl >/dev/null 2>&1; then break; fi
  sleep 2
done

# Теперь, когда perl/debconf есть, можно чинить half-configured пакеты
(dpkg --configure -a 2>&1 || true) | tail -5
(apt-get install -f -y 2>&1 || true) | tail -5
(dpkg --configure -a 2>&1 || true) | tail -5
ok "dpkg/apt в согласованном состоянии"

# ------------------------------------------------------------------ 5. Предварительная настройка Java-окружения
# ca-certificates-java.postinst при установке JRE дёргает java-keytool — в proot
# он часто виснет на /dev/random или падает. Ставим JAVA_TOOL_OPTIONS ЗАРАНЕЕ
# и патчим java.security сразу после распаковки JRE.
export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom -Xmx256m"

patch_java_security() {
  for cand in /usr/lib/jvm/java-17-openjdk-*/conf/security/java.security \
              /usr/lib/jvm/java-17-openjdk-*/lib/security/java.security; do
    for SEC in $cand; do
      [ -f "$SEC" ] || continue
      if grep -q '^securerandom.source=file:/dev/random' "$SEC" 2>/dev/null; then
        sed -i 's|^securerandom.source=.*|securerandom.source=file:/dev/./urandom|' "$SEC" 2>/dev/null || true
      fi
      if ! grep -q 'securerandom.source=file:/dev/./urandom' "$SEC" 2>/dev/null; then
        echo 'securerandom.source=file:/dev/./urandom' >> "$SEC" 2>/dev/null || true
      fi
    done
  done
}
patch_java_security
# Фоновый патчер на время установки
(
  for _ in $(seq 1 30); do
    sleep 2
    patch_java_security 2>/dev/null || true
  done
) &
PATCHER_PID=$!
trap "kill $PATCHER_PID 2>/dev/null || true" EXIT

# ------------------------------------------------------------------ 6. Установка минимальных пакетов
log "Установка минимального набора инструментов..."
PKGS=(openjdk-17-jdk-headless ca-certificates-java curl wget unzip zip xz-utils procps)

INSTALL_OK=0
for _ in 1 2; do
  set +e
  apt-get install -y --no-install-recommends \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" \
    -o Dpkg::Options::="--force-unsafe-io" \
    "${PKGS[@]}" 2>&1 \
    | { grep -vE '^Progress|^Setting up|^Selecting|^Preparing|^Unpacking|^Configuring|^Adding|^Created|^Processing|^Use |^Downloaded|^Get:[0-9]+|^Fetched|^[0-9]+ upgraded|^[0-9]+ newly' || true; } \
    | tail -30
  RC=${PIPESTATUS[0]}
  set -e
  patch_java_security 2>/dev/null || true
  (dpkg --configure -a >/dev/null 2>&1 || true)
  (apt-get install -f -y >/dev/null 2>&1 || true)
  patch_java_security 2>/dev/null || true
  if [ "$RC" = "0" ] && command -v javac >/dev/null 2>&1; then
    INSTALL_OK=1
    break
  fi
  warn "первый проход install не удался (rc=$RC), пробую ещё раз..."
  sleep 2
done

kill $PATCHER_PID 2>/dev/null || true
wait 2>/dev/null || true
patch_java_security 2>/dev/null || true

if [ "$INSTALL_OK" != "1" ] || ! command -v javac >/dev/null 2>&1; then
  die "Не удалось установить JDK 17. Попробуйте вручную:
    apt-get update
    apt-get install -y openjdk-17-jdk-headless ca-certificates-java"
fi

# ------------------------------------------------------------------ 6. JAVA_HOME
patch_java_security
JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(which javac)")")")"
echo "$JAVA_HOME" > "$NCS_HOME/JAVA_HOME"
ok "JDK 17 установлен: $JAVA_HOME"

# Убираем policy-rc.d
[ -f /usr/sbin/policy-rc.d ] && grep -q 'ncs-fast' /usr/sbin/policy-rc.d && rm -f /usr/sbin/policy-rc.d 2>/dev/null || true

# ------------------------------------------------------------------ 7. Android SDK
log "Настройка Android SDK..."
mkdir -p "$SDK_DIR/cmdline-tools" "$SDK_DIR/build-tools" "$SDK_DIR/platforms" "$SDK_DIR/platform-tools"

CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
CMDLINE_TOOLS_ZIP="$CACHE_DIR/cmdline-tools.zip"

if [ ! -d "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  log "Скачивание command-line tools..."
  curl -fL --retry 3 -o "$CMDLINE_TOOLS_ZIP" "$CMDLINE_TOOLS_URL"
  unzip -qo "$CMDLINE_TOOLS_ZIP" -d "$SDK_DIR/cmdline-tools/"
  mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
  rm -f "$CMDLINE_TOOLS_ZIP"
  ok "command-line tools установлены"
else
  ok "command-line tools уже есть"
fi

export PATH="$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools:$PATH"
export ANDROID_SDK_ROOT="$SDK_DIR"

(yes 2>/dev/null | sdkmanager --licenses >/dev/null 2>&1 || true)

BT_VER="${NCS_BUILD_TOOLS:-35.0.0}"
PLAT_VER="${NCS_PLATFORM:-android-35}"

if [ ! -f "$SDK_DIR/build-tools/$BT_VER/aapt2" ]; then
  log "Скачивание build-tools $BT_VER..."
  sdkmanager --install "build-tools;$BT_VER" 2>&1 | tail -3
  ok "build-tools $BT_VER установлен"
else
  ok "build-tools $BT_VER уже есть"
fi

if [ ! -f "$SDK_DIR/platforms/$PLAT_VER/android.jar" ]; then
  log "Скачивание platform $PLAT_VER..."
  sdkmanager --install "platforms;$PLAT_VER" 2>&1 | tail -3
  ok "platform $PLAT_VER установлен"
else
  ok "platform $PLAT_VER уже есть"
fi

# ------------------------------------------------------------------ 8. Устанавливаем CLI ncs
log "Установка ncs CLI..."
cat > "$NCS_HOME/bin/ncs" <<NCSEOF
#!/usr/bin/env bash
export JAVA_HOME="\$(cat "\$HOME/.ncs/JAVA_HOME" 2>/dev/null || echo "$JAVA_HOME")"
export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="\$JAVA_HOME/bin:$SDK_DIR/build-tools/$BT_VER:$SDK_DIR/platform-tools:$NCS_HOME/bin:\$PATH"
export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom"
exec bash "\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)/ncs-build.sh" "\$@"
NCSEOF
chmod +x "$NCS_HOME/bin/ncs"

MARK="# >>> ncs-fast >>>"
for F in "$HOME/.bashrc" "$HOME/.profile"; do
  touch "$F"
  grep -q "$MARK" "$F" 2>/dev/null && sed -i "/$MARK/,/# <<< ncs-fast <<</d" "$F"
  cat >> "$F" <<EOF

$MARK
export NCS_HOME="$NCS_HOME"
export JAVA_HOME="\$(cat "$NCS_HOME/JAVA_HOME" 2>/dev/null)"
export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="\$NCS_HOME/bin:\$JAVA_HOME/bin:\$PATH"
export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom"
export LANG=C.UTF-8
# <<< ncs-fast <<<
EOF
done
ok "ncs добавлен в PATH (.bashrc/.profile)"

# Копируем соседние скрипты туда же (ncs-build.sh, new-project.sh)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for f in ncs-build.sh new-project.sh; do
  [ -f "$SCRIPT_DIR/$f" ] && cp "$SCRIPT_DIR/$f" "$NCS_HOME/bin/$f"
done
chmod +x "$NCS_HOME/bin/"*.sh 2>/dev/null || true
mkdir -p "$HOME/projects"

echo
echo -e "${G}════════════ УСТАНОВКА ЗАВЕРШЕНА ════════════${NC}"
echo
echo "  JAVA_HOME     : $JAVA_HOME"
echo "  ANDROID_HOME  : $SDK_DIR"
echo "  ncs           : $NCS_HOME/bin/ncs"
echo "  Размер        : $(du -sh "$NCS_HOME" 2>/dev/null | cut -f1)"
echo
echo "  Использование:"
echo "    source ~/.bashrc"
echo "    ncs new MyApp com.example.myapp"
echo "    ncs build debug"
echo
