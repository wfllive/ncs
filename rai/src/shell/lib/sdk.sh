#!/usr/bin/env bash
# =============================================================================
#  rai/lib/sdk.sh — динамическое обнаружение SDK
#
#  ПРИНЦИП: никаких зашитых версий. Всё узнаём на лету:
#    • список ARM-сборок  -> GitHub API репозитория android-sdk-custom
#    • имя zip платформы  -> официальный repository2-3.xml от Google
#  Поэтому build-tools 38, 39, 40… заработают без правки скриптов.
# =============================================================================

RAI_CACHE="${RAI_CACHE:-$HOME/.cache/rai}"
mkdir -p "$RAI_CACHE" 2>/dev/null || true

. "${RAI_HOME:-$HOME/rai}/lib/sources.sh"
SDK_REPO="$RAI_SRC_SDK_REPO"
GOOGLE_REPO_XML="$RAI_SRC_GOOGLE_XML"
CACHE_TTL="${RAI_CACHE_TTL:-21600}"   # 6 часов

# --- кэшированная загрузка ----------------------------------------------------
_rai_fetch() {  # _rai_fetch <url> <cache-file>
  local url="$1" cf="$RAI_CACHE/$2"
  if [ -f "$cf" ]; then
    local age=$(( $(date +%s) - $(stat -c %Y "$cf" 2>/dev/null || echo 0) ))
    [ "$age" -lt "$CACHE_TTL" ] && { cat "$cf"; return 0; }
  fi
  if curl -fsSL --retry 2 --max-time 45 "$url" -o "$cf.tmp" 2>/dev/null; then
    mv -f "$cf.tmp" "$cf"; cat "$cf"; return 0
  fi
  rm -f "$cf.tmp"
  [ -f "$cf" ] && { cat "$cf"; return 0; }   # офлайн — отдаём старый кэш
  return 1
}

rai_cache_clear() { rm -f "$RAI_CACHE"/*.json "$RAI_CACHE"/*.xml 2>/dev/null; }

# --- список доступных ARM-сборок SDK -----------------------------------------
# Вывод: "<версия> <дата> <libc,libc,...>"
rai_sdk_available() {
  local json
  json="$(_rai_fetch "$RAI_SRC_SDK_API?per_page=30" \
          "sdk-releases.json")" || return 1
  printf '%s' "$json" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
if isinstance(d,dict): sys.exit(1)
rows=[]
for r in d:
    if r.get("draft") or r.get("prerelease"): continue
    libcs=sorted({a["name"].split("aarch64-linux-")[1].replace(".tar.xz","")
                  for a in r.get("assets",[]) if "aarch64-linux-" in a["name"]})
    if libcs:
        rows.append((r["tag_name"], r.get("published_at","")[:10], ",".join(libcs)))
def key(t):
    try: return [int(x) for x in t[0].split(".")]
    except Exception: return [0]
for t in sorted(rows, key=key, reverse=True):
    print(*t)
'
}

# Самая свежая версия SDK
rai_sdk_latest() { rai_sdk_available 2>/dev/null | head -1 | awk '{print $1}'; }

# Есть ли такая версия и такой libc?
rai_sdk_has() {  # rai_sdk_has <версия> [libc]
  local v="$1" libc="${2:-}" line
  line="$(rai_sdk_available 2>/dev/null | awk -v v="$v" '$1==v')"
  [ -n "$line" ] || return 1
  [ -z "$libc" ] && return 0
  echo "$line" | awk '{print $3}' | tr ',' '\n' | grep -qx "$libc"
}

# Список libc для версии
rai_sdk_libcs() { rai_sdk_available 2>/dev/null | awk -v v="$1" '$1==v{print $3}'; }

# --- резолв платформы через официальный XML Google ----------------------------
# rai_platform_zip 37  ->  platform-37.0_r02.zip
# Работает для ЛЮБОГО будущего API: имя берётся из репозитория, не угадывается.
rai_platform_zip() {
  local api="$1" xml
  xml="$(_rai_fetch "$GOOGLE_REPO_XML" "google-repo.xml")" || return 1
  printf '%s' "$xml" | python3 -c '
import sys,re,xml.etree.ElementTree as ET
api=sys.argv[1]
try: root=ET.fromstring(sys.stdin.read())
except Exception: sys.exit(1)
cands=[]
for p in root.iter():
    if not p.tag.endswith("remotePackage"): continue
    path=p.get("path","")
    if not path.startswith("platforms;android-"): continue
    name=path.split("platforms;android-")[1]
    base=name.split("-")[0]
    if base.split(".")[0]!=api: continue
    if not re.match(r"^[0-9.]+$", base): continue      # без CANARY/кодовых имён
    if "beta" in name or "ext" in name: continue        # стабильные
    for a in p.iter("archive"):
        u=a.find(".//url")
        if u is not None and u.text:
            try: ver=[int(x) for x in base.split(".")]
            except Exception: ver=[0]
            rev=int(re.search(r"_r(\d+)", u.text).group(1)) if re.search(r"_r(\d+)", u.text) else 0
            cands.append((ver,rev,name,u.text)); break
if not cands: sys.exit(1)
cands.sort(reverse=True)
print(cands[0][2], cands[0][3])
' "$api" 2>/dev/null
}

# Максимальный стабильный API, доступный у Google
rai_platform_latest_api() {
  local xml; xml="$(_rai_fetch "$GOOGLE_REPO_XML" "google-repo.xml")" || return 1
  printf '%s' "$xml" | grep -oP '(?<=platforms;android-)[0-9]+(?=[."<])' \
    | sort -n | uniq | tail -1
}

# --- установка платформы прямой загрузкой (надёжнее sdkmanager в proot) -------
rai_install_platform() {  # rai_install_platform <api>
  local api="$1" info name zip dest tmp
  dest="$ANDROID_HOME/platforms/android-$api"
  [ -d "$dest" ] && { echo "already"; return 0; }

  info="$(rai_platform_zip "$api")" || return 1
  name="$(echo "$info" | awk '{print $1}')"
  zip="$(echo "$info"  | awk '{print $2}')"
  [ -n "$zip" ] || return 1

  tmp="$(mktemp -d)"
  if ! curl -fL --retry 3 --progress-bar \
        -o "$tmp/p.zip" "$RAI_SRC_GOOGLE_REPO/$zip"; then
    rm -rf "$tmp"; return 1
  fi
  unzip -q "$tmp/p.zip" -d "$tmp" || { rm -rf "$tmp"; return 1; }
  local src; src="$(find "$tmp" -maxdepth 1 -type d -name 'android-*' | head -1)"
  [ -n "$src" ] || { rm -rf "$tmp"; return 1; }
  mkdir -p "$ANDROID_HOME/platforms"
  mv "$src" "$dest" || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  echo "installed"
}

# --- лицензии без sdkmanager --------------------------------------------------
rai_write_licenses() {
  local L="$ANDROID_HOME/licenses"; mkdir -p "$L"
  _w(){ printf '\n%s\n' "$2" > "$L/$1"; }
  _w android-sdk-license           "24333f8a63b6825ea9c5514f83c2829b004d1fee"
  _w android-sdk-preview-license   "84831b9409646a918e30573bab4c9c91346d8abd"
  _w android-sdk-arm-dbt-license   "859f317696f67ef3d7f30a50a5560e7834b43903"
  _w android-googletv-license      "601085b94cd77f0b54ff86406957099ebe79c4d6"
  _w android-googlexr-license      "ceff83576aac4f7f37cb98fe189e9fb3c49d3b81"
  _w google-gdk-license            "33b6a2b64607f11b759f320ef9dff4ae5c47d97a"
  _w mips-android-sysimage-license "e9acab5b5fbb560a72cfaecce8946896ff6aab9d"
}
