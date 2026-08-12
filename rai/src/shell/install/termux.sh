#!/usr/bin/env bash
# =============================================================================
#  00-termux-prepare.sh
#  Запускать В TERMUX (НЕ внутри ubuntu!) — до первого входа в proot-distro.
#  Готовит Termux, ставит ubuntu и настраивает доступ к общей папке.
# =============================================================================
set -e

GREEN='\033[1;32m'; BLUE='\033[1;34m'; RED='\033[1;31m'; NC='\033[0m'
log(){ echo -e "${BLUE}==>${NC} $*"; }

# 0. Проверка, что мы в Termux
if [ -f "${RAI_HOME:-$HOME/rai}/lib/common.sh" ]; then
  . "${RAI_HOME:-$HOME/rai}/lib/common.sh"
  rai_require_env termux "rai install termux" || exit 1
else
  [ -d /data/data/com.termux/files/usr ] || {
    echo "Это не Termux. Скрипт запускать в Termux."; exit 1; }
fi

# 1. Проверка архитектуры телефона
ARCH=$(uname -m)
log "Архитектура Termux: $ARCH"
case "$ARCH" in
  aarch64) echo -e "${GREEN}OK — 64-битный ARM, всё поддерживается.${NC}" ;;
  armv7l|armv8l|arm)
     echo -e "${RED}У вас 32-битный Termux!${NC}"
     echo "Android SDK (aapt2) существует только под 64 бита."
     echo "Решение: удалите Termux и поставьте 64-битную сборку с F-Droid/GitHub"
     echo "(на 64-битной прошивке Termux сам ставится как aarch64)."
     exit 1 ;;
  *) echo "Необычная архитектура: $ARCH" ;;
esac

# 2. Обновление и пакеты
log "Обновляю Termux…"
yes | pkg update -y || true
yes | pkg upgrade -y || true

log "Ставлю proot-distro и утилиты…"
pkg install -y proot-distro wget curl git tar unzip openssl

# 3. Разрешение на доступ к памяти телефона (для копирования APK)
if [ ! -d "$HOME/storage" ]; then
  log "Запрашиваю доступ к хранилищу (нажмите «Разрешить»)…"
  termux-setup-storage || true
  sleep 3
fi

# 4. Держим CPU включённым во время долгой сборки
log "Включаю wake-lock (чтобы сборка не засыпала)…"
termux-wake-lock 2>/dev/null || echo "  (termux-wake-lock недоступен — не критично)"

# 5. Установка Ubuntu
if proot-distro list 2>/dev/null | grep -q "ubuntu.*installed" || [ -d "$PREFIX/var/lib/proot-distro/installed-rootfs/ubuntu" ]; then
  log "Ubuntu уже установлена"
else
  log "Устанавливаю Ubuntu (несколько минут)…"
  proot-distro install ubuntu
fi

# 6. Общая папка Termux <-> Ubuntu
SHARED="$HOME/shared"
mkdir -p "$SHARED"
log "Общая папка Termux: $SHARED"

# 7. Копируем скрипты внутрь Ubuntu, если они лежат рядом
ROOTFS="$PREFIX/var/lib/proot-distro/installed-rootfs/ubuntu"
RAI_SRC="${RAI_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
if [ -d "$ROOTFS/root" ] && [ -f "$RAI_SRC/rai" ]; then
  log "Копирую RAI внутрь Ubuntu…"
  rm -rf "$ROOTFS/root/rai"
  mkdir -p "$ROOTFS/root/rai"
  cp -rf "$RAI_SRC"/. "$ROOTFS/root/rai/" 2>/dev/null || true
  rm -rf "$ROOTFS/root/rai/.git" 2>/dev/null || true
  chmod +x "$ROOTFS/root/rai/rai" "$ROOTFS/root/rai/setup.sh" 2>/dev/null || true
  # автоматически регистрируем команду rai при первом входе
  mkdir -p "$ROOTFS/root"
  if ! grep -q 'rai/setup.sh' "$ROOTFS/root/.bashrc" 2>/dev/null; then
    cat >> "$ROOTFS/root/.bashrc" <<'BRC'

# первичная настройка RAI (один раз)
if [ -f "$HOME/rai/setup.sh" ] && [ ! -e "$HOME/.rai-configured" ]; then
    bash "$HOME/rai/setup.sh" --quiet && touch "$HOME/.rai-configured"
fi
case ":$PATH:" in *":$HOME/bin:"*) ;; *) export PATH="$HOME/bin:$PATH" ;; esac
if [ -t 1 ] && [ ! -f "$HOME/.rai-no-welcome" ]; then
    command -v rai >/dev/null 2>&1 && rai welcome
fi
BRC
  fi
  ok "RAI установлен в ubuntu:/root/rai (команда rai настроится сама)"
fi

echo
echo -e "${GREEN}=========== TERMUX ГОТОВ ===========${NC}"
echo
echo "Вход в Ubuntu с пробросом папки (ВАЖНО — используйте именно эту команду):"
echo
echo "  proot-distro login ubuntu --shared-tmp --bind $SHARED:/root/shared"
echo
echo "Внутри Ubuntu выполните:"
echo "  rai install sdk       # нативный ARM SDK"
echo "  rai new MyApp --modern"
echo "  rai build MyApp"
echo
echo "Совет: добавьте алиас, чтобы не печатать длинную команду:"
echo "  echo \"alias ub='proot-distro login ubuntu --shared-tmp --bind $SHARED:/root/shared'\" >> ~/.bashrc"
