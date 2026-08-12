#!/usr/bin/env bash
# =============================================================================
#  rai install rootfs — скачать и развернуть Ubuntu rootfs БЕЗ proot-distro
#
#  Использование:
#      rai install rootfs
#      rai install rootfs --release 24.04
#      rai install rootfs --dir ~/ubuntu
#      rai install rootfs --arch armhf
#      rai install rootfs --list
# =============================================================================

set -uo pipefail

. "${RAI_HOME:-$HOME/rai}/lib/common.sh"
. "${RAI_HOME:-$HOME/rai}/lib/sources.sh"

BASE_URL="$RAI_SRC_UBUNTU_BASE"

RELEASE=""
DEST=""
DO_LIST=0
ARCH_REQ=""

while [ $# -gt 0 ]; do
  case "$1" in
    --list|-l)    DO_LIST=1 ;;
    --release|-r) RELEASE="${2:-}"; shift ;;
    --release=*)  RELEASE="${1#*=}" ;;
    --dir|-d)     DEST="${2:-}"; shift ;;
    --dir=*)      DEST="${1#*=}" ;;
    --arch)       ARCH_REQ="${2:-}"; shift ;;
    --arch=*)     ARCH_REQ="${1#*=}" ;;
    -*)           warn "неизвестный флаг: $1" ;;
    *)            RELEASE="$1" ;;
  esac
  shift
done

# --- какие релизы доступны ----------------------------------------------------
list_releases() {
  curl -fsSL --max-time 30 "$BASE_URL/" 2>/dev/null \
    | grep -oE 'href="[0-9]{2}\.[0-9]{2}(\.[0-9]+)?/"' \
    | grep -oE '[0-9]{2}\.[0-9]{2}(\.[0-9]+)?' \
    | awk -F. '{print $1"."$2}' \
    | sort -Vu
}

# --- точное имя архива для релиза --------------------------------------------
resolve_tarball() {  # resolve_tarball <release> <arch>
  local rel="$1" arch="$2" page f
  page="$(curl -fsSL --max-time 30 "$BASE_URL/$rel/release/" 2>/dev/null)" || return 1
  f="$(printf '%s' "$page" \
       | grep -oE "ubuntu-base-[0-9.]+-base-${arch}\.tar\.gz" \
       | sort -Vu | tail -1)"
  [ -n "$f" ] || return 1
  printf '%s\n' "$BASE_URL/$rel/release/$f"
}

# --- определить архитектуру ---------------------------------------------------
detect_arch() {
  if [ -n "$ARCH_REQ" ]; then
    printf '%s\n' "$ARCH_REQ"
    return 0
  fi

  if [ "$(rai_env)" = "termux" ] && command -v dpkg >/dev/null 2>&1; then
    case "$(dpkg --print-architecture 2>/dev/null)" in
      aarch64) printf '%s\n' "arm64" ;;
      arm)     printf '%s\n' "armhf" ;;
      x86_64)  printf '%s\n' "amd64" ;;
      *) die "Неподдерживаемая архитектура Termux: $(dpkg --print-architecture 2>/dev/null)" ;;
    esac
    return 0
  fi

  case "$(uname -m)" in
    aarch64|arm64) printf '%s\n' "arm64" ;;
    armv7l|armv8l) printf '%s\n' "armhf" ;;
    x86_64)        printf '%s\n' "amd64" ;;
    *) die "Неподдерживаемая архитектура: $(uname -m)" ;;
  esac
}

# --- чем распаковывать --------------------------------------------------------
detect_extractors() {
  HAVE_BSDTAR=0
  HAVE_TAR=0

  command -v bsdtar >/dev/null 2>&1 && HAVE_BSDTAR=1
  command -v tar    >/dev/null 2>&1 && HAVE_TAR=1

  if [ "$HAVE_BSDTAR" -eq 0 ] && [ "$(rai_env)" = "termux" ]; then
    pkg install -y libarchive >/dev/null 2>&1 || true
    command -v bsdtar >/dev/null 2>&1 && HAVE_BSDTAR=1
  fi

  [ "$HAVE_BSDTAR" -eq 1 ] || [ "$HAVE_TAR" -eq 1 ] || die "Нужен tar или bsdtar"
}

# --- post-fix путей loader/merged-/usr ---------------------------------------
fix_loader_paths() {  # fix_loader_paths <dest> <arch>
  local d="$1" arch="$2"

  [ -e "$d/bin" ]  || ln -s usr/bin  "$d/bin"  2>/dev/null || true
  [ -e "$d/sbin" ] || ln -s usr/sbin "$d/sbin" 2>/dev/null || true

  case "$arch" in
    arm64)
      [ -e "$d/lib" ] || mkdir -p "$d/lib"
      [ -e "$d/lib/ld-linux-aarch64.so.1" ] || {
        [ -e "$d/usr/lib/ld-linux-aarch64.so.1" ] \
          && ln -s ../usr/lib/ld-linux-aarch64.so.1 "$d/lib/ld-linux-aarch64.so.1" 2>/dev/null || true
      }
      [ -e "$d/lib/aarch64-linux-gnu" ] || {
        [ -d "$d/usr/lib/aarch64-linux-gnu" ] \
          && ln -s ../usr/lib/aarch64-linux-gnu "$d/lib/aarch64-linux-gnu" 2>/dev/null || true
      }
      ;;
    armhf)
      [ -e "$d/lib" ] || mkdir -p "$d/lib"
      [ -e "$d/lib/ld-linux-armhf.so.3" ] || {
        [ -e "$d/usr/lib/ld-linux-armhf.so.3" ] \
          && ln -s ../usr/lib/ld-linux-armhf.so.3 "$d/lib/ld-linux-armhf.so.3" 2>/dev/null || true
      }
      [ -e "$d/lib/arm-linux-gnueabihf" ] || {
        [ -d "$d/usr/lib/arm-linux-gnueabihf" ] \
          && ln -s ../usr/lib/arm-linux-gnueabihf "$d/lib/arm-linux-gnueabihf" 2>/dev/null || true
      }
      ;;
    amd64)
      [ -e "$d/lib64" ] || mkdir -p "$d/lib64"
      [ -e "$d/lib64/ld-linux-x86-64.so.2" ] || {
        [ -e "$d/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2" ] \
          && ln -s ../usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 "$d/lib64/ld-linux-x86-64.so.2" 2>/dev/null || true
      }
      ;;
  esac
}

# --- запись start.sh ----------------------------------------------------------
write_start_scripts() {  # write_start_scripts <dest> <proot_bin> <shared_host>
  local d="$1" proot_bin="$2" shared_host="$3"
  local host_env_bin
  host_env_bin="$(command -v env || true)"
  [ -n "$host_env_bin" ] || host_env_bin="/data/data/com.termux/files/usr/bin/env"

  cat > "$d/../$(basename "$d")-start.sh" <<EOF 2>/dev/null || true
#!/usr/bin/env bash
exec "\$(dirname "\$0")/$(basename "$d")/start.sh" "\$@"
EOF
  chmod +x "$d/../$(basename "$d")-start.sh" 2>/dev/null || true

  cat > "$d/start.sh" <<EOF
#!/usr/bin/env bash
# Вход в образ. Создан 'rai install rootfs'.
ROOTFS="\$(cd "\$(dirname "\$0")" && pwd)"
PROOT="\$(command -v proot || echo "$proot_bin")"
HOST_ENV="\$(command -v env || echo "$host_env_bin")"

[ -x "\$PROOT" ] || { echo "proot не найден"; exit 1; }
[ -x "\$HOST_ENV" ] || { echo "env не найден"; exit 1; }

printf 'nameserver 8.8.8.8\\nnameserver 1.1.1.1\\n' > "\$ROOTFS/etc/resolv.conf" 2>/dev/null

exec "\$HOST_ENV" -i \\
  HOME=/root \\
  TERM="\${TERM:-xterm-256color}" \\
  LANG=C.UTF-8 \\
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/bin \\
  "\$PROOT" \\
    --root-id \\
    --link2symlink \\
    --kill-on-exit \\
    --rootfs="\$ROOTFS" \\
    --cwd=/root \\
    --bind=/dev \\
    --bind=/dev/pts \\
    --bind=/proc \\
    --bind=/sys \\
    --bind=/dev/urandom:/dev/random \\
    --bind="$shared_host:/root/shared" \\
    \${TMPDIR:+--bind="\$TMPDIR:/tmp"} \\
    /bin/bash --login "\$@"
EOF

  chmod +x "$d/start.sh"
}

# --- быстрая проверка ---------------------------------------------------------
smoke_test_rootfs() {  # smoke_test_rootfs <dest> <proot_bin>
  local d="$1" p="$2"
  [ -n "$p" ] || return 1
  "$p" --rootfs="$d" --cwd=/ /bin/sh -c 'exit 0' >/dev/null 2>&1
}

# --- распаковка rootfs --------------------------------------------------------
extract_rootfs() {  # extract_rootfs <archive> <dest> <tmpdir> <proot_bin>
  local archive="$1" dest="$2" tmpdir="$3" proot_bin="$4"
  local ok=0

  rm -f "$tmpdir/extract.err" "$tmpdir/extract.proot.err"

  if [ "${HAVE_BSDTAR:-0}" -eq 1 ]; then
    if bsdtar -xpf "$archive" -C "$dest" 2>"$tmpdir/extract.err"; then
      ok=1
    fi
  fi

  if [ "$ok" -eq 0 ] && [ "${HAVE_TAR:-0}" -eq 1 ]; then
    rm -rf "$dest"
    mkdir -p "$dest"
    if tar -xzf "$archive" -C "$dest" 2>"$tmpdir/extract.err"; then
      ok=1
    fi
  fi

  if [ "$ok" -eq 1 ]; then
    return 0
  fi

  if grep -qiE 'Cannot hard link|Permission denied' "$tmpdir/extract.err" 2>/dev/null; then
    warn "Обычная распаковка упёрлась в hard links — повторяю через proot"
    rm -rf "$dest"
    mkdir -p "$dest"

    [ -n "$proot_bin" ] || return 1

    "$proot_bin" --link2symlink -0 tar -xzf "$archive" -C "$dest" \
      --delay-directory-restore --preserve-permissions 2>"$tmpdir/extract.proot.err" \
      && return 0

    cat "$tmpdir/extract.proot.err" >&2
    return 1
  fi

  cat "$tmpdir/extract.err" >&2
  return 1
}

# --- список релизов -----------------------------------------------------------
if [ "$DO_LIST" -eq 1 ]; then
  step "Доступные Ubuntu Base"
  echo
  echo "  РЕЛИЗ    АРХИВ                                      ТИП"
  echo "  -------- ------------------------------------------ ----------------"
  latest="$(list_releases | grep -E '^[0-9]{2}\.04$' | tail -1)"
  for r in $(list_releases | tail -5); do
    u="$(resolve_tarball "$r" "arm64" 2>/dev/null || true)"
    tag=""
    case "$r" in *.04) tag="LTS" ;; esac
    [ "$r" = "$latest" ] && tag="$tag, по умолчанию"
    printf "  %-8s %-42s %s\n" "$r" "$(basename "${u:-нет arm64}")" "$tag"
  done
  echo
  echo "  Установить:  rai install rootfs --release 24.04"
  exit 0
fi

ARCH="$(detect_arch)"

# --- релиз --------------------------------------------------------------------
if [ -z "$RELEASE" ]; then
  log "Определяю последний LTS…"
  RELEASE="$(list_releases | grep -E '^[0-9]{2}\.04$' | tail -1)"
  [ -n "$RELEASE" ] || RELEASE="24.04"
fi
ok "Релиз: Ubuntu $RELEASE ($ARCH)"

DEST="${DEST:-$HOME/ubuntu}"
DEST="$(eval echo "$DEST")"

if [ -d "$DEST" ] && [ -f "$DEST/etc/os-release" ]; then
  warn "В $DEST уже есть образ"
  read -rp "  Перезаписать? Всё содержимое будет удалено [y/N] " a
  [[ "$a" =~ ^[yY]$ ]] || exit 0
  rm -rf "$DEST"
fi

# --- зависимости --------------------------------------------------------------
command -v curl >/dev/null 2>&1 || die "Нужен curl"
detect_extractors

if [ "${HAVE_BSDTAR:-0}" -eq 1 ]; then
  ok "Распаковщик: bsdtar"
else
  ok "Распаковщик: tar"
fi

PROOT_BIN="$(command -v proot || true)"
if [ -z "$PROOT_BIN" ]; then
  warn "proot не найден"
  if [ "$(rai_env)" = "termux" ]; then
    log "Ставлю proot…"
    pkg install -y proot >/dev/null 2>&1 && PROOT_BIN="$(command -v proot || true)"
  else
    log "Ставлю proot…"
    apt-get install -y proot >/dev/null 2>&1 && PROOT_BIN="$(command -v proot || true)"
  fi
  [ -n "$PROOT_BIN" ] && ok "proot установлен" \
    || warn "proot не поставился — вход в образ вручную"
fi

# --- скачивание ---------------------------------------------------------------
step "Загрузка Ubuntu Base $RELEASE ($ARCH)"
URL="$(resolve_tarball "$RELEASE" "$ARCH")" \
  || die "Не нашёл архив для $RELEASE/$ARCH. Список: rai install rootfs --list"

log "$(basename "$URL")  (~30-40 МБ)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fL --retry 3 --progress-bar -o "$TMP/rootfs.tar.gz" "$URL" \
  || die "Загрузка не удалась"

ok "Скачано: $(du -h "$TMP/rootfs.tar.gz" | cut -f1)"

# --- распаковка ---------------------------------------------------------------
step "Распаковка в $DEST"
mkdir -p "$DEST"

extract_rootfs "$TMP/rootfs.tar.gz" "$DEST" "$TMP" "$PROOT_BIN" \
  || die "Распаковка не удалась"

[ -f "$DEST/etc/os-release" ] || die "После распаковки нет $DEST/etc/os-release"
ok "$(. "$DEST/etc/os-release" && echo "$PRETTY_NAME")"

# --- post-fix путей -----------------------------------------------------------
fix_loader_paths "$DEST" "$ARCH"
ok "пути loader/merged-/usr"

# --- базовая настройка образа -------------------------------------------------
step "Настройка образа"

printf 'nameserver 8.8.8.8\nnameserver 1.1.1.1\n' > "$DEST/etc/resolv.conf"
ok "DNS"

for d in tmp var/tmp; do
  mkdir -p "$DEST/$d" 2>/dev/null
  chmod 1777 "$DEST/$d" 2>/dev/null
done
ok "права на /tmp"

echo "rai" > "$DEST/etc/hostname"
grep -q '127.0.0.1' "$DEST/etc/hosts" 2>/dev/null || \
  printf '127.0.0.1 localhost\n127.0.0.1 rai\n' > "$DEST/etc/hosts"
ok "hosts"

if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "armhf" ]; then
  for f in "$DEST/etc/apt/sources.list" "$DEST/etc/apt/sources.list.d/ubuntu.sources"; do
    [ -f "$f" ] || continue
    sed -i "s|http://archive.ubuntu.com/ubuntu|$RAI_SRC_UBUNTU_PORTS|g;
            s|http://security.ubuntu.com/ubuntu|$RAI_SRC_UBUNTU_PORTS|g" "$f"
  done

  if [ ! -s "$DEST/etc/apt/sources.list" ] && \
     [ ! -f "$DEST/etc/apt/sources.list.d/ubuntu.sources" ]; then
    CN="$(. "$DEST/etc/os-release" && echo "${VERSION_CODENAME:-noble}")"
    mkdir -p "$DEST/etc/apt"
    cat > "$DEST/etc/apt/sources.list" <<EOF
deb $RAI_SRC_UBUNTU_PORTS $CN main restricted universe multiverse
deb $RAI_SRC_UBUNTU_PORTS $CN-updates main restricted universe multiverse
deb $RAI_SRC_UBUNTU_PORTS $CN-security main restricted universe multiverse
EOF
  fi
  ok "репозитории ports.ubuntu.com"
fi

mkdir -p "$DEST/usr/sbin"
printf '#!/bin/sh\nexit 0\n' > "$DEST/usr/sbin/policy-rc.d"
chmod +x "$DEST/usr/sbin/policy-rc.d" 2>/dev/null

# --- копируем RAI внутрь ------------------------------------------------------
RAI_SRC="${RAI_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
if [ -f "$RAI_SRC/rai" ]; then
  mkdir -p "$DEST/root/rai"
  cp -rf "$RAI_SRC"/. "$DEST/root/rai/" 2>/dev/null
  rm -rf "$DEST/root/rai/.git" 2>/dev/null
  chmod +x "$DEST/root/rai/rai" "$DEST/root/rai/setup.sh" 2>/dev/null

  touch "$DEST/root/.bashrc"
  if ! grep -q 'rai/setup.sh' "$DEST/root/.bashrc" 2>/dev/null; then
    cat >> "$DEST/root/.bashrc" <<'BRC'

# первичная настройка RAI (один раз)
if [ -f "$HOME/rai/setup.sh" ] && [ ! -e "$HOME/.rai-configured" ]; then
    bash "$HOME/rai/setup.sh" --quiet && touch "$HOME/.rai-configured"
fi
case ":$PATH:" in *":$HOME/bin:"*) ;; *) export PATH="$HOME/bin:$PATH" ;; esac
if [ -t 1 ] && [ -z "$RAI_NO_WELCOME" ] && [ ! -f "$HOME/.rai-no-welcome" ]; then
    command -v rai >/dev/null 2>&1 && rai welcome
fi
BRC
  fi

  ok "RAI скопирован в $DEST/root/rai"
fi

mkdir -p "$DEST/root/projects" "$DEST/root/tmp" "$DEST/root/shared"

# --- скрипт запуска -----------------------------------------------------------
SHARED_HOST="$HOME/shared"
mkdir -p "$SHARED_HOST"

write_start_scripts "$DEST" "$PROOT_BIN" "$SHARED_HOST"
ok "скрипт запуска: $DEST/start.sh"

# --- тест ---------------------------------------------------------------------
if smoke_test_rootfs "$DEST" "$PROOT_BIN"; then
  ok "проверка запуска rootfs"
else
  warn "Быстрая проверка запуска не прошла"
  warn "Если ваш Termux 32-битный, попробуйте:"
  warn "  rai install rootfs --arch armhf --release 24.04"
fi

rm -rf "$TMP"
trap - EXIT

echo
echo -e "${C_G}════════════ ОБРАЗ ГОТОВ ════════════${C_N}"
cat <<EOF

  Расположение : $DEST
  Общая папка  : $SHARED_HOST  ->  /root/shared внутри образа
  RAI внутри   : /root/rai

Войти в образ:

    $DEST/start.sh

Уже внутри образа:

    rai install base
    rai install sdk
    rai new MyApp --modern
    rai build MyApp

Совет — короткий алиас:

    echo "alias ub='$DEST/start.sh'" >> ~/.bashrc
EOF