#!/usr/bin/env bash
# =============================================================================
#  rai fix abi
#
#  ЛЕЧИТ:
#    Conflicting configuration : 'arm64-v8a' in ndk abiFilters
#    cannot be present when splits abi filters are set : arm64-v8a
#
#  ПРИЧИНА (моя ошибка в шаблоне):
#    В build.gradle.kts были заданы ОБА способа ограничения ABI сразу:
#       ndk { abiFilters += "arm64-v8a" }     <- фильтр внутри одного APK
#       splits { abi { include("arm64-v8a") }} <- разбиение на НЕСКОЛЬКО APK
#    AGP считает это противоречием и падает ещё на конфигурации проекта.
#
#  ЧТО ПРАВИЛЬНО:
#    Нужен ОДИН APK только под arm64-v8a  ->  оставляем ndk.abiFilters,
#    блок splits.abi удаляем. splits нужен, когда вы хотите отдельный APK
#    на каждую архитектуру (arm64, armeabi-v7a, x86...) — это не наш случай.
#
#  Заодно убирает предупреждение:
#    'jvmTarget: String' is deprecated
#
#  Использование:
#     rai fix abi ~/projects/MyApp
# =============================================================================
set -euo pipefail

BLUE='\033[1;34m'; GREEN='\033[1;32m'; RED='\033[1;31m'; YEL='\033[1;33m'; NC='\033[0m'
log(){ echo -e "${BLUE}==>${NC} $*"; }
ok(){ echo -e "${GREEN} OK ${NC} $*"; }
warn(){ echo -e "${YEL}WARN${NC} $*"; }
die(){ echo -e "${RED}FAIL${NC} $*"; exit 1; }

PROJ="${1:-$PWD}"
GF="$PROJ/app/build.gradle.kts"
[ -f "$GF" ] || GF="$PROJ/build.gradle.kts"
[ -f "$GF" ] || die "Не нашёл build.gradle.kts в $PROJ"

log "Файл: $GF"
cp -f "$GF" "$GF.bak"
ok "Бэкап: $(basename "$GF").bak"

python3 - "$GF" <<'PYEOF'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
orig = s

def find_block(text, header_regex):
    """Находит блок вида `header { ... }` со сбалансированными скобками."""
    m = re.search(header_regex, text)
    if not m:
        return None
    i = text.index('{', m.start())
    depth = 0
    for j in range(i, len(text)):
        if text[j] == '{':
            depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                return (m.start(), j + 1)
    return None

changed = []

# --- 1. Удаляем блок splits { ... } целиком --------------------------------
blk = find_block(s, r'(?m)^\s*splits\s*\{')
if blk:
    a, b = blk
    # прихватываем комментарий-заголовок над блоком, если он наш
    line_start = s.rfind('\n', 0, a) + 1
    prefix = s[:line_start]
    cm = re.search(r'(?m)^[ \t]*//[^\n]*\n\Z', prefix)
    if cm and ('APK' in cm.group(0) or 'arm64' in cm.group(0) or 'universal' in cm.group(0)):
        line_start = cm.start()
    # съедаем перевод строки после блока
    end = b
    while end < len(s) and s[end] in ' \t':
        end += 1
    if end < len(s) and s[end] == '\n':
        end += 1
    s = s[:line_start] + s[end:]
    changed.append("удалён блок splits { abi { ... } }")

# --- 2. Гарантируем наличие ndk.abiFilters ----------------------------------
if 'abiFilters' not in s:
    dc = find_block(s, r'(?m)^\s*defaultConfig\s*\{')
    if dc:
        a, b = dc
        insert = (
            '\n        // ===== ТОЛЬКО arm64-v8a =====\n'
            '        ndk {\n'
            '            abiFilters.clear()\n'
            '            abiFilters += "arm64-v8a"\n'
            '        }\n'
        )
        s = s[:b-1] + insert + s[b-1:]
        changed.append("добавлен ndk { abiFilters += \"arm64-v8a\" }")

# --- 3. kotlinOptions { jvmTarget = "17" } -> современный DSL ---------------
ko = find_block(s, r'(?m)^\s*kotlinOptions\s*\{')
if ko:
    a, b = ko
    body = s[a:b]
    m = re.search(r'jvmTarget\s*=\s*"(\d+)"', body)
    if m:
        ver = m.group(1)
        line_start = s.rfind('\n', 0, a) + 1
        indent = re.match(r'[ \t]*', s[line_start:a] or '    ').group(0) or '    '
        new = (f'{indent}// современный DSL вместо устаревшего kotlinOptions\n'
               f'{indent}kotlin {{\n'
               f'{indent}    compilerOptions {{\n'
               f'{indent}        jvmTarget.set('
               f'org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_{ver})\n'
               f'{indent}    }}\n'
               f'{indent}}}')
        s = s[:line_start] + new + s[b:]
        changed.append(f"kotlinOptions -> kotlin.compilerOptions (JVM_{ver})")

if s != orig:
    open(p, 'w', encoding='utf-8').write(s)
    for c in changed:
        print(f"    + {c}")
else:
    print("    (изменений не потребовалось)")
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

echo
log "Проверяю результат:"
if grep -qE '^\s*splits\s*\{' "$GF"; then
  warn "блок splits всё ещё присутствует — проверьте вручную"
  grep -nE '^\s*splits\s*\{' "$GF"
else
  ok "splits.abi удалён"
fi

if grep -q 'abiFilters' "$GF"; then
  ok "ndk.abiFilters на месте:"
  grep -n 'abiFilters' "$GF" | sed 's/^/      /'
else
  warn "abiFilters не найден!"
fi

if grep -qE '^\s*kotlinOptions\s*\{' "$GF"; then
  warn "kotlinOptions ещё есть (не критично, лишь предупреждение при сборке)"
else
  ok "kotlinOptions заменён на современный DSL"
fi

echo
echo -e "${GREEN}================ ГОТОВО ================${NC}"
cat <<EOF

Пересоберите:

    rai build $PROJ

Что означала ошибка:

Два блока делают РАЗНЫЕ вещи, и AGP запрещает их вместе:

  ndk { abiFilters }  - один APK, внутри только выбранные ABI  <- нужно нам
  splits { abi }      - НЕСКОЛЬКО APK, по одному на каждую ABI

В шаблоне по ошибке оказались оба. Оставлен только abiFilters.
Результат тот же: один APK исключительно под arm64-v8a.

Откат, если что-то пошло не так:
    mv $GF.bak $GF
EOF
