#!/usr/bin/env bash
# =============================================================================
#  rai/lib/sources.sh — ЕДИНЫЙ реестр источников загрузки
#
#  ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ:
#  Первое, что меняют в модификациях — URL: подменяют репозиторий SDK,
#  зеркало Ubuntu, ссылку на Gradle. Потом такая сборка ломается, а вопросы
#  прилетают автору оригинала.
#
#  Все адреса собраны здесь. Любая правка меняет хеш этого файла, и
#  `rai verify` / `rai report` сразу показывают:
#      изменён  lib/sources.sh   ← источники загрузки подменены
#
#  Значения можно переопределить переменными окружения — легально и видно
#  в отчёте (строка "переопределения"), без правки файла.
# =============================================================================

# --- Android SDK (нативные ARM-сборки) ---------------------------------------
RAI_SRC_SDK_REPO="${RAI_SRC_SDK_REPO:-HomuHomu833/android-sdk-custom}"
RAI_SRC_SDK_API="${RAI_SRC_SDK_API:-https://api.github.com/repos/$RAI_SRC_SDK_REPO/releases}"
RAI_SRC_SDK_DL="${RAI_SRC_SDK_DL:-https://github.com/$RAI_SRC_SDK_REPO/releases/download}"

# --- Google: платформы, build-tools, cmdline-tools ---------------------------
RAI_SRC_GOOGLE_REPO="${RAI_SRC_GOOGLE_REPO:-https://dl.google.com/android/repository}"
RAI_SRC_GOOGLE_XML="${RAI_SRC_GOOGLE_XML:-$RAI_SRC_GOOGLE_REPO/repository2-3.xml}"

# --- Gradle -------------------------------------------------------------------
RAI_SRC_GRADLE_DIST="${RAI_SRC_GRADLE_DIST:-https://services.gradle.org/distributions}"
RAI_SRC_GRADLE_RAW="${RAI_SRC_GRADLE_RAW:-https://raw.githubusercontent.com/gradle/gradle}"

# --- Ubuntu -------------------------------------------------------------------
RAI_SRC_UBUNTU_BASE="${RAI_SRC_UBUNTU_BASE:-https://cdimage.ubuntu.com/ubuntu-base/releases}"
RAI_SRC_UBUNTU_PORTS="${RAI_SRC_UBUNTU_PORTS:-http://ports.ubuntu.com/ubuntu-ports}"
RAI_SRC_UBUNTU_PKG="${RAI_SRC_UBUNTU_PKG:-https://packages.ubuntu.com}"

# --- Termux -------------------------------------------------------------------
RAI_SRC_TERMUX_PKG="${RAI_SRC_TERMUX_PKG:-https://packages.termux.dev/apt/termux-main}"

# --- Проверка сети ------------------------------------------------------------
RAI_SRC_NETCHECK="${RAI_SRC_NETCHECK:-https://dl.google.com}"

# Список доменов, которые RAI вообще имеет право использовать.
# Отчёт покажет, если появился посторонний.
RAI_ALLOWED_HOSTS="dl.google.com
api.github.com
github.com
raw.githubusercontent.com
services.gradle.org
cdimage.ubuntu.com
ports.ubuntu.com
archive.ubuntu.com
security.ubuntu.com
packages.ubuntu.com
packages.termux.dev
schemas.android.com
kotl.in
developer.android.com
docs.gradle.org
help.gradle.org"

# Показать текущие источники и отметить переопределённые
rai_sources_show() {
  local overridden=0
  printf '  %-22s %s\n' "SDK (репозиторий)" "$RAI_SRC_SDK_REPO"
  printf '  %-22s %s\n' "Google SDK"        "$RAI_SRC_GOOGLE_REPO"
  printf '  %-22s %s\n' "Gradle"            "$RAI_SRC_GRADLE_DIST"
  printf '  %-22s %s\n' "Ubuntu Base"       "$RAI_SRC_UBUNTU_BASE"
  for v in RAI_SRC_SDK_REPO RAI_SRC_GOOGLE_REPO RAI_SRC_GRADLE_DIST \
           RAI_SRC_UBUNTU_BASE RAI_SRC_UBUNTU_PORTS; do
    if [ -n "$(eval echo "\${${v}_OVERRIDDEN:-}")" ]; then overridden=1; fi
  done
  return 0
}

# Найти в файлах RAI ссылки на посторонние домены
rai_sources_audit() {
  local found=0 h
  while IFS= read -r url; do
    h="$(echo "$url" | sed -E 's|https?://([^/]+).*|\1|')"
    [ -n "$h" ] || continue
    if ! echo "$RAI_ALLOWED_HOSTS" | grep -qx "$h"; then
      echo "$h"; found=1
    fi
  done < <(grep -rhoE '(curl|wget)[^|;]*https?://[a-zA-Z0-9._-]+' \
             --include='*.sh' "$RAI_HOME" "$RAI_HOME/rai" 2>/dev/null \
           | grep -oE 'https?://[a-zA-Z0-9._-]+' | sort -u)
  return $found
}
