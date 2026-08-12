#!/usr/bin/env bash
# =============================================================================
#  rai install base — первичная подготовка свежего Ubuntu-образа
#
#  Запускать ПЕРВЫМ, сразу после входа в proot-distro:
#      proot-distro login ubuntu --shared-tmp --bind $HOME/shared:/root/shared
#      rai install base
#
#  Что делает:
#    1. чинит DNS (в proot часто пустой resolv.conf — apt «висит»)
#    2. выбирает рабочее зеркало (ports.ubuntu.com для ARM)
#    3. apt update + upgrade
#    4. ставит JDK 17 и все инструменты сборки
#    5. патчит java.security (иначе JVM виснет на /dev/random)
#    6. настраивает локаль UTF-8, часовой пояс, swap-подсказки
#    7. создаёт ~/projects, ~/tmp, ~/shared
# =============================================================================
set -uo pipefail
. "${RAI_HOME:-$HOME/rai}/lib/common.sh"
. "${RAI_HOME:-$HOME/rai}/lib/sources.sh" 2>/dev/null || true

rai_require_env guest "rai install base" || exit 1

SKIP_UPGRADE=0
for a in "$@"; do
  case "$a" in
    --no-upgrade) SKIP_UPGRADE=1 ;;
  esac
done

export DEBIAN_FRONTEND=noninteractive
STEPS=7

echo -e "${C_C}Подготовка Ubuntu для сборки Android${C_N}"
echo -e "${C_D}$(rai_env_name) · $(uname -m)${C_N}"

# ============================================================ 0. голый rootfs?
# В свежераспакованном образе может не быть ни curl, ни wget, ни ca-certificates.
net_check() {
  if command -v curl >/dev/null 2>&1; then
    curl -sfI --max-time 10 "${RAI_SRC_UBUNTU_PORTS%/*}" >/dev/null 2>&1 && return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q --spider --timeout=10 "${RAI_SRC_UBUNTU_PORTS%/*}" 2>/dev/null && return 0
  fi
  # ни curl, ни wget — пробуем средствами bash
  if (exec 3<>/dev/tcp/ports.ubuntu.com/80) 2>/dev/null; then
    exec 3>&- 2>/dev/null; return 0
  fi
  return 1
}

# ============================================================ 0.5 права на /tmp
# После распаковки rootfs /tmp часто имеет чужого владельца и права 755.
# Тогда apt не может создать временные файлы:
#   "Couldn't create temporary file /tmp/apt.conf.XXXX for passing config to apt-key"
#   "The repository ... is not signed"
for d in /tmp /var/tmp; do
  mkdir -p "$d" 2>/dev/null
  if [ ! -w "$d" ] || [ "$(stat -c '%a' "$d" 2>/dev/null)" != "1777" ]; then
    chmod 1777 "$d" 2>/dev/null && chown 0:0 "$d" 2>/dev/null
    FIXED_TMP=1
  fi
done
[ "${FIXED_TMP:-0}" = "1" ] && ok "исправлены права на /tmp и /var/tmp (нужно для apt)"

# ============================================================ 1. DNS
step "1/$STEPS  Сеть и DNS"
if net_check; then
  ok "сеть работает"
else
  warn "нет доступа к сети — чиню resolv.conf"
  # в proot/chroot /etc/resolv.conf часто пуст или указывает на недоступный DNS
  [ -f /etc/resolv.conf ] && cp -n /etc/resolv.conf /etc/resolv.conf.bak 2>/dev/null
  # в proot это может быть симлинк в никуда
  rm -f /etc/resolv.conf 2>/dev/null
  cat > /etc/resolv.conf <<'EOF'
nameserver 8.8.8.8
nameserver 1.1.1.1
nameserver 8.8.4.4
EOF
  if net_check; then
    ok "DNS исправлен"
  else
    err "Сеть недоступна даже после правки DNS."
    echo
    echo "  Проверьте:"
    echo "    • интернет на устройстве"
    echo "    • запущен ли образ с доступом к сети"
    echo "    • cat /etc/resolv.conf"
    exit 1
  fi
fi

# --- apt-песочница в rootfs ---------------------------------------------------
# apt роняет привилегии до пользователя _apt, а после распаковки rootfs у него
# нет доступа к /var/lib/apt/lists и /var/cache/apt. Симптомы: списки пакетов
# остаются пустыми, "Unable to locate package curl", ошибки про подписи.
# Стандартное решение для контейнеров/chroot — отключить sandbox.
mkdir -p /etc/apt/apt.conf.d
if [ ! -f /etc/apt/apt.conf.d/99rai-sandbox ]; then
  cat > /etc/apt/apt.conf.d/99rai-sandbox <<'EOF'
APT::Sandbox::User "root";
Acquire::Retries "3";
EOF
  ok "отключена apt-песочница (нужно в rootfs)"
fi
chown -R root:root /var/lib/apt /var/cache/apt 2>/dev/null || true
chmod -R u+rwX /var/lib/apt /var/cache/apt 2>/dev/null || true

# --- голый ubuntu-base: нет gpgv, apt не проверит подписи --------------------
# Симптом: "gpgv ... required for verification" / "repository is not signed".
# Решение: первый apt-get выполняем с --allow-unauthenticated, ставим gpgv,
# дальше проверка подписей работает штатно.
BOOTSTRAP_APT=""
if ! command -v gpgv >/dev/null 2>&1; then
  warn "gpgv отсутствует (голый ubuntu-base) — apt не может проверить подписи"
  BOOTSTRAP_APT="-o Acquire::AllowInsecureRepositories=true
                 -o Acquire::AllowDowngradeToInsecureRepositories=true
                 -o APT::Get::AllowUnauthenticated=true"
  apt-get $BOOTSTRAP_APT update -y >/dev/null 2>&1 || true
  if apt-get $BOOTSTRAP_APT install -y --no-install-recommends \
       gpgv gnupg ca-certificates >/dev/null 2>&1; then
    ok "gpgv и сертификаты установлены — подписи снова проверяются"
    update-ca-certificates >/dev/null 2>&1 || true
    # ОБЯЗАТЕЛЬНО: без повторного update списки пакетов остаются пустыми
    # и дальше будет "E: Unable to locate package curl"
    apt-get update -y >/dev/null 2>&1 || true
  else
    warn "gpgv поставить не удалось — продолжу без проверки подписей"
    APT_INSECURE="$BOOTSTRAP_APT"
  fi
fi

# минимальный набор, без которого не сделать ничего остального
if ! command -v curl >/dev/null 2>&1; then
  warn "curl отсутствует — ставлю"
  apt-get ${APT_INSECURE:-} update -y >/dev/null 2>&1 || true
  if ! apt-get ${APT_INSECURE:-} install -y --no-install-recommends \
         curl ca-certificates >/dev/null 2>&1; then
    # вторая попытка после обновления списков
    apt-get ${APT_INSECURE:-} update -y >/dev/null 2>&1
    apt-get ${APT_INSECURE:-} install -y --no-install-recommends \
      curl ca-certificates >/dev/null 2>&1 \
      || die "Не удалось поставить curl.
  Проверьте: cat /etc/apt/sources.list ; apt-get update"
  fi
  ok "curl установлен"
  update-ca-certificates >/dev/null 2>&1 || true
fi

# ============================================================ 2. зеркала
step "2/$STEPS  Репозитории apt"
. /etc/os-release 2>/dev/null || true
CODENAME="${VERSION_CODENAME:-noble}"
ARCH="$(dpkg --print-architecture 2>/dev/null || echo arm64)"
ok "Ubuntu $CODENAME ($ARCH)"

# для arm64 нужен ports.ubuntu.com, а не archive.ubuntu.com
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "armhf" ]; then
  SRC_OK=0
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
    [ -f "$f" ] && grep -q 'ports.ubuntu.com' "$f" 2>/dev/null && SRC_OK=1
  done
  if [ "$SRC_OK" -eq 1 ]; then
    ok "зеркало ports.ubuntu.com уже настроено"
  else
    warn "исправляю зеркало на ports.ubuntu.com (нужно для ARM)"
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
      [ -f "$f" ] || continue
      cp -n "$f" "$f.bak" 2>/dev/null || true
      sed -i 's|http://archive.ubuntu.com/ubuntu|$RAI_SRC_UBUNTU_PORTS|g;
              s|http://security.ubuntu.com/ubuntu|$RAI_SRC_UBUNTU_PORTS|g' "$f"
    done
    ok "зеркало исправлено"
  fi
fi

# ============================================================ 3. apt update
step "3/$STEPS  Обновление списка пакетов"
log "apt update…"
if apt-get update -y 2>&1 | tail -3; then
  ok "списки обновлены"
else
  warn "apt update завершился с ошибками — продолжаю"
fi

if [ "$SKIP_UPGRADE" -eq 0 ]; then
  log "apt upgrade (можно пропустить: rai install base --no-upgrade)…"
  apt-get upgrade -y >/dev/null 2>&1 && ok "система обновлена" \
    || warn "upgrade частично не прошёл"
else
  log "upgrade пропущен"
fi

# ============================================================ 4. пакеты
step "4/$STEPS  Инструменты сборки"
AVAIL_MB=$(( $(df -k / | awk 'NR==2{print $4}') / 1024 ))
echo "    свободно на / : ${AVAIL_MB} МБ"
if [ "$AVAIL_MB" -lt 1200 ]; then
  err "Мало места: нужно минимум ~1.2 ГБ (JDK ~400 МБ, SDK ~1 ГБ сверху)"
  echo "  Освободите место или разверните образ на другом разделе."
  exit 1
fi
# nodejs — для интерактивного меню (rai без аргументов)
PKGS="openjdk-17-jdk-headless
curl wget git unzip zip tar xz-utils
file ca-certificates gnupg
nano less procps psmisc
python3 python3-pip
nodejs
build-essential
locales tzdata"

log "Устанавливаю $(echo "$PKGS" | wc -w) пакетов…"
FAILED=""
for p in $PKGS; do
  if dpkg -s "$p" >/dev/null 2>&1; then
    continue
  fi
  PLOG="$(apt-get install -y --no-install-recommends "$p" 2>&1)"
  if [ $? -eq 0 ] && dpkg -s "$p" >/dev/null 2>&1; then
    echo -e "    ${C_G}+${C_N} $p"
  else
    FAILED="$FAILED $p"
    echo -e "    ${C_R}✘${C_N} $p"
    case "$PLOG" in
      *"No space left"*)  err "Закончилось место на диске"; exit 1 ;;
      *"mounted proc"*)   HINT_PROC=1 ;;
      *"/dev/pts"*)       HINT_PTS=1 ;;
    esac
  fi
done
if [ -n "$FAILED" ]; then
  warn "не установились:$FAILED"
  if [ "${HINT_PROC:-0}" = "1" ] || [ "${HINT_PTS:-0}" = "1" ]; then
    echo
    err "Образ запущен без /proc или /dev/pts — JDK не сможет настроиться."
    echo "  Входите в образ через start.sh (он биндит всё нужное):"
    echo -e "      ${C_B}~/ubuntu/start.sh${C_N}"
    echo "  Если запускаете вручную, добавьте:"
    echo "      --bind=/proc --bind=/dev --bind=/sys"
    exit 1
  fi
  echo "  Повторить: apt-get install -y$FAILED"
else
  ok "все пакеты на месте"
fi

if ! command -v javac >/dev/null 2>&1; then
  err "javac не найден — без JDK сборка невозможна"
  echo "  Попробуйте вручную: apt-get install -y openjdk-17-jdk-headless"
  exit 1
fi

# ============================================================ 5. Java
step "5/$STEPS  Настройка Java"
rai_setup_java || die "JDK не определился"
ok "JAVA_HOME=$JAVA_HOME"
ok "$(java -version 2>&1 | grep -v Picked | head -1)"

# главная причина зависаний в proot — блокирующий /dev/random
PATCHED=0
for SEC in "$JAVA_HOME/conf/security/java.security" "$JAVA_HOME/lib/security/java.security"; do
  [ -f "$SEC" ] || continue
  if grep -q '^securerandom.source=file:/dev/random' "$SEC" 2>/dev/null; then
    cp -n "$SEC" "$SEC.bak" 2>/dev/null || true
    sed -i 's|^securerandom.source=.*|securerandom.source=file:/dev/./urandom|;
            s|^securerandom.strongAlgorithms=NativePRNGBlocking.*|securerandom.strongAlgorithms=NativePRNG:SUN|' "$SEC"
    PATCHED=1
  fi
done
[ "$PATCHED" -eq 1 ] && ok "java.security пропатчен (защита от зависания)" \
                     || ok "java.security уже в порядке"

ENT="$(cat /proc/sys/kernel/random/entropy_avail 2>/dev/null || echo '?')"
echo "    энтропия: $ENT ${C_D}(в proot обычно мало — потому и патчим)${C_N}"

# ============================================================ 6. локаль
step "6/$STEPS  Локаль и время"
if ! locale -a 2>/dev/null | grep -qi 'en_US.utf8\|C.utf8'; then
  echo "en_US.UTF-8 UTF-8" >> /etc/locale.gen 2>/dev/null || true
  locale-gen >/dev/null 2>&1 || true
fi
grep -q 'LANG=' /etc/default/locale 2>/dev/null || \
  echo 'LANG=C.UTF-8' > /etc/default/locale 2>/dev/null || true
ok "UTF-8 (важно для кириллицы в ресурсах)"

TZ_GUESS="${TZ:-}"
[ -z "$TZ_GUESS" ] && [ -f /etc/timezone ] && TZ_GUESS="$(cat /etc/timezone)"
ok "часовой пояс: ${TZ_GUESS:-UTC}"

# ============================================================ 7. каталоги
step "7/$STEPS  Каталоги и окружение"
mkdir -p "$HOME/projects" "$HOME/tmp" "$HOME/bin" "$HOME/shared" "$HOME/.gradle"
ok "~/projects ~/tmp ~/bin ~/shared"

MARK="# >>> rai-base >>>"
for F in "$HOME/.bashrc" "$HOME/.profile"; do
  touch "$F"
  grep -q "$MARK" "$F" 2>/dev/null && sed -i "/$MARK/,/# <<< rai-base <<</d" "$F"
  cat >> "$F" <<EOF

$MARK
export JAVA_HOME="$JAVA_HOME"
export PATH="\$JAVA_HOME/bin:\$HOME/bin:\$PATH"
export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom"
export LANG=\${LANG:-C.UTF-8}
export TMPDIR="\$HOME/tmp"; mkdir -p "\$TMPDIR" 2>/dev/null
# <<< rai-base <<<
EOF
done
ok "переменные окружения"

MEM="$(free -m 2>/dev/null | awk '/Mem:/{print $2}')"
DISK="$(df -h "$HOME" | awk 'NR==2{print $4}')"
echo "    RAM: ${MEM}МБ · свободно на диске: $DISK"
[ "${MEM:-9999}" -lt 3000 ] && \
  warn "мало RAM — после установки SDK уменьшите org.gradle.jvmargs до -Xmx1024m"

echo
echo -e "${C_G}════════════ БАЗА ГОТОВА ════════════${C_N}"
cat <<EOF

  Java  : $(java -version 2>&1 | grep -v Picked | head -1)
  Ubuntu: $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")

Дальше:

    source ~/.bashrc
    rai install sdk          нативный ARM Android SDK
    rai new MyApp com.example.myapp --modern
    rai prepare MyApp
    rai build MyApp
EOF
