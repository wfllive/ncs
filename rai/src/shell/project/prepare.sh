#!/usr/bin/env bash
# =============================================================================
#  rai prepare [проект] — подготовить проект к сборке
#
#    1. чинит известные конфликты в build.gradle.kts
#    2. подгоняет compileSdk/buildToolsVersion под установленный SDK
#    3. дописывает недостающие настройки (aapt2 override, local.properties)
#    4. доустанавливает нужную platform
#    5. скачивает Gradle wrapper и зависимости заранее
#    6. прогоняет финальную проверку
#
#  Флаги:
#     --no-download    только исправления, без загрузки
#     --offline-ready  прогреть кэш для сборки без сети
# =============================================================================
set -uo pipefail
. "${RAI_HOME:-$HOME/rai}/lib/common.sh"
. "${RAI_HOME:-$HOME/rai}/lib/sources.sh" 2>/dev/null || true
. "${RAI_HOME:-$HOME/rai}/lib/sdk.sh"

rai_require_env guest "rai prepare" || exit 1

DOWNLOAD=1; OFFLINE_READY=0; PROJ_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-download)   DOWNLOAD=0 ;;
    --offline-ready) OFFLINE_READY=1 ;;
    -*) warn "неизвестный флаг: $1" ;;
    *)  PROJ_ARG="$1" ;;
  esac
  shift
done

PROJ="$(rai_project_path "$PROJ_ARG")"
rai_is_project "$PROJ" || die "Не Gradle-проект: $PROJ
Создать: rai new $(basename "$PROJ")"

GF="$PROJ/app/build.gradle.kts"
[ -f "$GF" ] || GF="$(find "$PROJ" -maxdepth 3 -path '*/app/build.gradle.kts' | head -1)"
[ -f "$GF" ] || die "Не найден app/build.gradle.kts"

CHANGES=0
note(){ echo -e "    ${C_G}+${C_N} $*"; CHANGES=$((CHANGES+1)); }

echo -e "${C_C}Подготовка проекта${C_N}  ${C_D}$PROJ${C_N}"

# ==================================================== 0. Gradle Wrapper
# Делается ПЕРВЫМ и не зависит от SDK: если new.sh оборвался на загрузке,
# проект остаётся без gradlew, и чинить его надо до всех прочих проверок.
cd "$PROJ"
step "1/7  Gradle Wrapper"

# Проверяем -s, а не -f: неудачный curl -o оставляет пустой файл,
# который выглядит существующим, но ломает сборку.
if [ ! -s "gradlew" ] || [ ! -s "gradle/wrapper/gradle-wrapper.jar" ]; then
  # версия из wrapper.properties; grep -oP есть не везде, потому sed
  GV="$(sed -n 's/.*gradle-\([0-9][0-9.]*\)-bin\.zip.*/\1/p' \
        gradle/wrapper/gradle-wrapper.properties 2>/dev/null | head -1)"
  GV="${GV:-8.14.5}"
  log "Восстанавливаю Gradle wrapper $GV…"
  mkdir -p gradle/wrapper

  _get() {  # _get <куда> <url1> <url2>
    local dest="$1" tmp url; shift
    tmp="$(mktemp)" || return 1
    for url in "$@"; do
      if curl -fsSL --retry 3 --max-time 120 -o "$tmp" "$url" 2>/dev/null \
         && [ -s "$tmp" ]; then
        mv -f "$tmp" "$dest"; chmod 644 "$dest" 2>/dev/null || true; return 0
      fi
    done
    rm -f "$tmp"; return 1
  }

  _get gradle/wrapper/gradle-wrapper.jar \
    "$RAI_SRC_GRADLE_RAW/v$GV/gradle/wrapper/gradle-wrapper.jar" \
    "https://github.com/gradle/gradle/raw/v$GV/gradle/wrapper/gradle-wrapper.jar" \
    || warn "gradle-wrapper.jar не скачался"

  _get gradlew \
    "$RAI_SRC_GRADLE_RAW/v$GV/gradlew" \
    "https://github.com/gradle/gradle/raw/v$GV/gradlew" \
    || warn "gradlew не скачался"

  if [ -s gradlew ] && [ -s gradle/wrapper/gradle-wrapper.jar ]; then
    chmod +x gradlew; note "wrapper восстановлен"
  fi
fi
chmod +x gradlew 2>/dev/null

if [ ! -s "gradlew" ] || [ ! -s "gradle/wrapper/gradle-wrapper.jar" ]; then
  err "Gradle wrapper отсутствует — сборка невозможна"
  echo "      Проверьте сеть и повторите:  rai prepare $(basename "$PROJ")"
  exit 1
fi


ok "Gradle Wrapper на месте"

# ============================================================ 1. окружение
step "2/7  Окружение"
rai_setup_java || die "JDK не найден → rai fix java"
ok "Java: $(basename "$JAVA_HOME")"

BT="$(rai_newest_bt)"
[ -n "$BT" ] || die "SDK не установлен → rai install sdk"
if rai_is_arm "$ANDROID_HOME/build-tools/$BT/aapt2"; then
  ok "SDK: $(rai_all_bt)(нативный ARM)"
else
  die "aapt2 не ARM → rai install sdk"
fi
MAXSDK="$(rai_max_sdk)"

# ============================================================ 2. конфликты
step "3/7  Исправление известных конфликтов"
cp -f "$GF" "$GF.bak"

python3 - "$GF" <<'PYEOF'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read(); orig = s

def block(text, hdr):
    m = re.search(hdr, text)
    if not m: return None
    i = text.index('{', m.start()); d = 0
    for j in range(i, len(text)):
        if text[j] == '{': d += 1
        elif text[j] == '}':
            d -= 1
            if d == 0: return (m.start(), j+1)
    return None

out = []

b = block(s, r'(?m)^\s*splits\s*\{')
if b and 'abiFilters' in s:
    a, e = b
    ls = s.rfind('\n', 0, a) + 1
    pre = s[:ls]
    cm = re.search(r'(?m)^[ \t]*//[^\n]*\n\Z', pre)
    if cm and any(k in cm.group(0) for k in ('APK','arm64','universal')):
        ls = cm.start()
    while e < len(s) and s[e] in ' \t': e += 1
    if e < len(s) and s[e] == '\n': e += 1
    s = s[:ls] + s[e:]
    out.append("удалён splits { abi } (конфликтует с abiFilters)")

if 'abiFilters' not in s:
    dc = block(s, r'(?m)^\s*defaultConfig\s*\{')
    if dc:
        a, e = dc
        s = s[:e-1] + ('\n        // ===== ТОЛЬКО arm64-v8a =====\n'
                       '        ndk {\n'
                       '            abiFilters.clear()\n'
                       '            abiFilters += "arm64-v8a"\n'
                       '        }\n') + s[e-1:]
        out.append('добавлен ndk.abiFilters = arm64-v8a')

ko = block(s, r'(?m)^\s*kotlinOptions\s*\{')
if ko:
    a, e = ko
    m = re.search(r'jvmTarget\s*=\s*"(\d+)"', s[a:e])
    if m:
        v = m.group(1)
        ls = s.rfind('\n', 0, a) + 1
        ind = re.match(r'[ \t]*', s[ls:a]).group(0) or '    '
        s = s[:ls] + (f'{ind}kotlin {{\n{ind}    compilerOptions {{\n'
                      f'{ind}        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_{v})\n'
                      f'{ind}    }}\n{ind}}}') + s[e:]
        out.append(f'kotlinOptions -> compilerOptions (JVM_{v})')

if s != orig:
    open(p, 'w', encoding='utf-8').write(s)
for o in out:
    print(f"    + {o}")
if not out:
    print("    (конфликтов не найдено)")
PYEOF


# --- AGP 9+: убрать плагин kotlin.android (Kotlin встроен) -------------------
# Симптом: "The 'org.jetbrains.kotlin.android' plugin is no longer required
#           for Kotlin support since AGP 9.0"
AGP_VER_DETECTED=""
for RB in "$(dirname "$(dirname "$GF")")/build.gradle.kts" "$PROJ/build.gradle.kts"; do
  [ -f "$RB" ] || continue
  V="$(grep -oP '(?<=com\.android\.application"\) version ")[0-9]+' "$RB" 2>/dev/null | head -1)"
  [ -n "$V" ] && { AGP_VER_DETECTED="$V"; ROOT_BUILD="$RB"; break; }
done

if [ -n "$AGP_VER_DETECTED" ] && [ "$AGP_VER_DETECTED" -ge 9 ]; then
  REMOVED=0
  for F in "$GF" ${ROOT_BUILD:+"$ROOT_BUILD"}; do
    [ -f "$F" ] || continue
    if grep -q 'org.jetbrains.kotlin.android' "$F"; then
      cp -n "$F" "$F.bak" 2>/dev/null || true
      sed -i '/id("org\.jetbrains\.kotlin\.android")/d; /id("kotlin-android")/d; /kotlin("android")/d' "$F"
      REMOVED=1
    fi
  done
  [ "$REMOVED" = "1" ] && echo "    + удалён плагин kotlin.android (AGP $AGP_VER_DETECTED: Kotlin встроен)"
fi

# ============================================================ 3. версии SDK
step "4/7  Согласование версий с установленным SDK"
CSDK="$(grep -oP '(?<=compileSdk = )\d+' "$GF" | head -1)"
BTV="$(grep -oP '(?<=buildToolsVersion = ")[^"]+' "$GF" | head -1)"

if [ -n "$CSDK" ] && [ "$CSDK" -gt "$MAXSDK" ]; then
  warn "compileSdk $CSDK > доступного $MAXSDK"
  read -rp "    Понизить до $MAXSDK? [Y/n] " a
  if [[ ! "$a" =~ ^[nN]$ ]]; then
    sed -i "s/compileSdk = $CSDK/compileSdk = $MAXSDK/" "$GF"
    sed -i "s/targetSdk = $CSDK/targetSdk = $MAXSDK/" "$GF"
    note "compileSdk/targetSdk: $CSDK -> $MAXSDK"
    CSDK="$MAXSDK"
  else
    echo "    Оставлено. Поднять SDK: rai install sdk"
  fi
else
  ok "compileSdk ${CSDK:-?} (доступно до $MAXSDK)"
fi

if [ -n "$BTV" ] && [ ! -d "$ANDROID_HOME/build-tools/$BTV" ]; then
  warn "buildToolsVersion \"$BTV\" не установлен"
  sed -i "s|buildToolsVersion = \"$BTV\"|buildToolsVersion = \"$BT\"|" "$GF"
  note "buildToolsVersion: $BTV -> $BT"
elif [ -n "$BTV" ]; then
  ok "buildToolsVersion $BTV"
fi

# ============================================================ 4. platform
step "5/7  Платформа и настройки проекта"
if [ -n "$CSDK" ]; then
  if ls -d "$ANDROID_HOME/platforms/android-$CSDK"* >/dev/null 2>&1; then
    ok "platform android-$CSDK на месте"
  else
    log "Ставлю platform android-$CSDK…"
    case "$(rai_install_platform "$CSDK" 2>/dev/null)" in
      installed) note "platform android-$CSDK установлена" ;;
      already)   ok "уже была" ;;
      *)         warn "не установилась — сборка может упасть" ;;
    esac
  fi
fi

echo "sdk.dir=$ANDROID_HOME" > "$PROJ/local.properties"
ok "local.properties"

GP="$PROJ/gradle.properties"; touch "$GP"
setp(){ grep -q "^$1=" "$GP" && sed -i "s|^$1=.*|$1=$2|" "$GP" || { echo "$1=$2" >> "$GP"; note "$1"; }; }
setp "android.aapt2FromMavenOverride" "$ANDROID_HOME/build-tools/$BT/aapt2"
setp "org.gradle.jvmargs" "-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8"
setp "org.gradle.daemon" "false"
setp "org.gradle.parallel" "false"
setp "org.gradle.caching" "true"
setp "kotlin.compiler.execution.strategy" "in-process"
setp "android.useAndroidX" "true"
setp "android.suppressUnsupportedCompileSdk" "${CSDK:-35},$(( ${CSDK:-35} + 1 ))"
ok "gradle.properties"

# ============================================================ 5. зависимости
step "6/7  Загрузка зависимостей"
cd "$PROJ"

if [ "$DOWNLOAD" -eq 1 ]; then
  log "Скачиваю Gradle и зависимости (первый раз — до 20-40 минут)…"
  echo -e "    ${C_D}дальше сборки будут быстрыми${C_N}"
  LOG="$TMPDIR/prepare-$(basename "$PROJ").log"

  if ./gradlew --no-daemon --console=plain \
       :app:dependencies --configuration debugRuntimeClasspath \
       > "$LOG" 2>&1; then
    ok "Зависимости загружены"
  else
    if grep -qiE 'Could not resolve|Could not find|UnknownHost|Connect' "$LOG"; then
      warn "Часть зависимостей не скачалась — проверьте сеть"
      grep -iE 'Could not (resolve|find)' "$LOG" | head -5 | sed 's/^/      /'
    else
      warn "Задача dependencies отработала с ошибкой (не критично)"
      grep -E '^(e:|FAILURE|> )' "$LOG" | head -5 | sed 's/^/      /'
    fi
  fi

  if [ "$OFFLINE_READY" -eq 1 ]; then
    log "Прогреваю кэш для offline-сборки…"
    ./gradlew --no-daemon --console=plain :app:assembleDebug --dry-run >>"$LOG" 2>&1 \
      && ok "кэш прогрет — можно собирать с --offline" \
      || warn "прогрев не завершился"
  fi
else
  log "Загрузка пропущена (--no-download)"
fi

# ============================================================ 6. проверка
step "7/7  Финальная проверка"
if RAI_PREFLIGHT_QUIET=1 bash "$RAI_HOME/doctor/preflight.sh" "$PROJ"; then
  echo
  echo -e "${C_G}════════════ ПРОЕКТ ГОТОВ ════════════${C_N}"
  echo
  echo "  Исправлений внесено : $CHANGES"
  echo "  compileSdk          : ${CSDK:-?}"
  echo "  build-tools         : $BT"
  [ -f "$GF.bak" ] && echo "  Бэкап               : $(basename "$GF").bak"
  echo
  echo "  Собрать:  rai build $(basename "$PROJ")"
else
  echo
  echo -e "${C_Y}Остались замечания — см. выше${C_N}"
  exit 1
fi
