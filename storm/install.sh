#!/usr/bin/env bash
# ==============================================================================
# ⚡ STORM BUILD CLI — One-Click Automatic Installer
# Supports: Termux (Android ARM64/ARMv7), Linux (x86_64/ARM64/AArch64), macOS (Intel/Apple Silicon)
# Includes: Multi-mirror download, integrity check, anti-corruption & ARM64 AAPT2 support.
# ==============================================================================

set -e

# ANSI Colors
RED='\033[91m'
GREEN='\033[92m'
YELLOW='\033[93m'
BLUE='\033[94m'
CYAN='\033[96m'
BOLD='\033[1m'
RESET='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "  ╔════════════════════════════════════════════════════════════════╗"
echo "  ║             ⚡ STORM BUILD CLI — INSTALLER ⚡                  ║"
echo "  ║        Custom Android Build System without Gradle              ║"
echo "  ╚════════════════════════════════════════════════════════════════╝"
echo -e "${RESET}"

# 1. Detect Environment & Architecture
ARCH=$(uname -m)
OS_NAME=$(uname -s)
IS_TERMUX=false

if [ -n "$PREFIX" ] && [[ "$PREFIX" == *"com.termux"* ]]; then
    IS_TERMUX=true
elif [ -d "/data/data/com.termux/files/usr" ]; then
    IS_TERMUX=true
fi

echo -e "${BOLD}[1/5] Detecting System Environment...${RESET}"
echo -e "  • Architecture: ${GREEN}${ARCH}${RESET}"
if [ "$IS_TERMUX" = true ]; then
    echo -e "  • Environment:  ${CYAN}Termux on Android (ARM/AArch64)${RESET}"
else
    echo -e "  • Environment:  ${GREEN}${OS_NAME} (${ARCH})${RESET}"
fi

# 2. Install System Packages if in Termux or Debian/Ubuntu
echo -e "\n${BOLD}[2/5] Checking and Installing System Packages...${RESET}"
if [ "$IS_TERMUX" = true ]; then
    echo "  -> Updating Termux packages and installing dependencies..."
    pkg update -y || true
    pkg install -y git python openjdk-17 aapt apksigner ecj curl tar zip unzip || true
elif command -v apt-get &>/dev/null; then
    echo "  -> Detected Debian/Ubuntu/Linux with apt-get..."
    if [ "$EUID" -eq 0 ]; then
        apt-get update -y || true
        apt-get install -y python3 python3-pip openjdk-17-jdk-headless aapt zipalign zip unzip curl tar || true
    else
        sudo apt-get update -y || true
        sudo apt-get install -y python3 python3-pip openjdk-17-jdk-headless aapt zipalign zip unzip curl tar || true
    fi
elif command -v brew &>/dev/null; then
    echo "  -> Detected macOS with Homebrew."
    brew install openjdk android-commandlinetools || true
else
    echo "  -> Non-apt/Non-Termux system. Skipping package manager auto-install."
fi

# 3. Create Tools Directory
STORM_DIR="$HOME/.storm"
TOOLS_DIR="$STORM_DIR/tools"
mkdir -p "$TOOLS_DIR"

# Helper: Get file size in MB
get_size_mb() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo "0"
        return
    fi
    local bytes
    bytes=$(wc -c < "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
    awk -v b="$bytes" 'BEGIN { printf "%.1f", b / 1048576 }'
}

# Helper: Verify JAR integrity and minimum size
verify_jar() {
    local file="$1"
    local min_bytes="$2"
    if [ ! -f "$file" ]; then
        return 1
    fi
    local bytes
    bytes=$(wc -c < "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
    if [ "$bytes" -lt "$min_bytes" ]; then
        return 1
    fi
    if command -v unzip &>/dev/null; then
        if ! unzip -t -q "$file" 2>/dev/null; then
            return 1
        fi
    fi
    return 0
}

# Helper: Verify binary executable
verify_binary() {
    local file="$1"
    local min_bytes="$2"
    if [ ! -f "$file" ] || [ ! -x "$file" ]; then
        return 1
    fi
    local bytes
    bytes=$(wc -c < "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
    if [ "$bytes" -lt "$min_bytes" ]; then
        return 1
    fi
    return 0
}

# Helper: Robust Multi-Mirror Downloader with Retries & Validation
download_with_mirrors() {
    local dest="$1"
    local min_bytes="$2"
    local desc="$3"
    local is_binary="$4"
    shift 4
    local mirrors=("$@")

    if [ "$is_binary" = "true" ]; then
        if verify_binary "$dest" "$min_bytes"; then
            local sz
            sz=$(get_size_mb "$dest")
            echo -e "  • ${GREEN}✔ ${desc} already verified (${sz} MB)${RESET}"
            return 0
        fi
    else
        if verify_jar "$dest" "$min_bytes"; then
            local sz
            sz=$(get_size_mb "$dest")
            echo -e "  • ${GREEN}✔ ${desc} already verified (${sz} MB)${RESET}"
            return 0
        fi
    fi

    # Remove incomplete or corrupted file
    rm -f "$dest" "${dest}.tmp"
    mkdir -p "$(dirname "$dest")"

    local total_mirrors=${#mirrors[@]}
    local m_idx=1

    for url in "${mirrors[@]}"; do
        echo -e "  • Downloading ${CYAN}${desc}${RESET} (Mirror ${m_idx}/${total_mirrors})..."
        for attempt in 1 2 3; do
            if curl -L -f --connect-timeout 10 --max-time 120 --retry 2 \
                 -H "User-Agent: Mozilla/5.0 (Linux; Android; StormBuildCLI/1.0)" \
                 -o "${dest}.tmp" "$url" 2>/dev/null; then
                
                if [[ "$url" == *.tar.gz ]] || [[ "$url" == *.tgz ]]; then
                    tar -xzf "${dest}.tmp" -C "$(dirname "$dest")" aapt2 2>/dev/null || \
                    tar -xzf "${dest}.tmp" -C "$(dirname "$dest")" 2>/dev/null || true
                    rm -f "${dest}.tmp"
                    if [ -f "$dest" ]; then
                        chmod +x "$dest"
                        local sz
                        sz=$(get_size_mb "$dest")
                        echo -e "    ${GREEN}✔ Extracted and verified ${desc} (${sz} MB)${RESET}"
                        return 0
                    fi
                elif [ "$is_binary" = "true" ]; then
                    chmod +x "${dest}.tmp"
                    if verify_binary "${dest}.tmp" "$min_bytes"; then
                        mv "${dest}.tmp" "$dest"
                        chmod +x "$dest"
                        local sz
                        sz=$(get_size_mb "$dest")
                        echo -e "    ${GREEN}✔ Downloaded and verified ${desc} (${sz} MB)${RESET}"
                        return 0
                    fi
                else
                    if verify_jar "${dest}.tmp" "$min_bytes"; then
                        mv "${dest}.tmp" "$dest"
                        local sz
                        sz=$(get_size_mb "$dest")
                        echo -e "    ${GREEN}✔ Downloaded and verified ${desc} (${sz} MB)${RESET}"
                        return 0
                    fi
                fi
                rm -f "${dest}.tmp"
            fi
            sleep 1
        done
        m_idx=$((m_idx + 1))
    done

    echo -e "    ${YELLOW}[WARN] Could not auto-download ${desc}. (Check VPN or Internet)${RESET}"
    return 1
}

# 4. Download Cross-Platform Java SDK Tools with Multiple Mirrors
echo -e "\n${BOLD}[3/5] Downloading & Verifying SDK Tools (with Fallback Mirrors)...${RESET}"

# A. aapt2 (if not in PATH or system)
if ! command -v aapt2 &>/dev/null && ! command -v aapt &>/dev/null; then
    AAPT2_DEST="$TOOLS_DIR/aapt2"
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
        AAPT2_MIRRORS=(
            "https://github.com/lzhiyong/android-sdk-tools/releases/download/34.0.5/aapt2-linux-arm64.tar.gz"
            "https://raw.githubusercontent.com/skylot/jadx/master/jadx-core/src/test/resources/samples/aapt2"
        )
    else
        AAPT2_MIRRORS=(
            "https://github.com/lzhiyong/android-sdk-tools/releases/download/34.0.5/aapt2-linux-x86_64.tar.gz"
        )
    fi
    download_with_mirrors "$AAPT2_DEST" 500000 "aapt2 binary ($ARCH)" "true" "${AAPT2_MIRRORS[@]}" || true
else
    echo -e "  • ${GREEN}✔ aapt / aapt2 already available in system PATH.${RESET}"
fi

# B. android.jar (API 34) — Min size ~10MB
ANDROID_JAR_DEST="$TOOLS_DIR/android-34.jar"
if [ "$IS_TERMUX" = true ]; then
    mkdir -p "$PREFIX/share/java"
    ANDROID_JAR_DEST="$PREFIX/share/java/android.jar"
fi

ANDROID_MIRRORS=(
    "https://github.com/Sable/android-platforms/raw/master/android-34/android.jar"
    "https://raw.githubusercontent.com/skylot/jadx/master/jadx-core/src/test/resources/samples/android-34.jar"
    "https://github.com/anggrayudi/android-platforms/raw/master/android-34/android.jar"
)
download_with_mirrors "$ANDROID_JAR_DEST" 10000000 "android.jar (API 34)" "false" "${ANDROID_MIRRORS[@]}" || true

# C. r8.jar (Dexer & Shrinker) — Min size ~15MB
R8_DEST="$TOOLS_DIR/r8.jar"
R8_MIRRORS=(
    "https://storage.googleapis.com/r8-releases/raw/main/r8.jar"
    "https://repo1.maven.org/maven2/com/android/tools/r8/8.2.33/r8-8.2.33.jar"
    "https://maven.google.com/com/android/tools/r8/8.2.33/r8-8.2.33.jar"
)
download_with_mirrors "$R8_DEST" 15000000 "r8.jar (Dexer/R8)" "false" "${R8_MIRRORS[@]}" || true

# D. apksigner (v1 + v2 + v3 Scheme)
if ! command -v apksigner &>/dev/null; then
    APKSIGNER_DEST="$TOOLS_DIR/apksigner.jar"
    APKSIGNER_MIRRORS=(
        "https://repo1.maven.org/maven2/com/android/tools/build/apksigner/8.2.2/apksigner-8.2.2.jar"
        "https://maven.google.com/com/android/tools/build/apksigner/8.2.2/apksigner-8.2.2.jar"
    )
    download_with_mirrors "$APKSIGNER_DEST" 1000000 "apksigner.jar (v2/v3 Scheme)" "false" "${APKSIGNER_MIRRORS[@]}" || true
else
    echo -e "  • ${GREEN}✔ apksigner already available in system PATH.${RESET}"
fi

# E. bundletool.jar (AAB Builder) — Min size ~15MB
BT_DEST="$TOOLS_DIR/bundletool.jar"
BT_MIRRORS=(
    "https://github.com/google/bundletool/releases/download/1.17.0/bundletool-all-1.17.0.jar"
    "https://repo1.maven.org/maven2/com/android/tools/build/bundletool/1.17.0/bundletool-1.17.0-all.jar"
    "https://maven.google.com/com/android/tools/build/bundletool/1.17.0/bundletool-1.17.0-all.jar"
)
download_with_mirrors "$BT_DEST" 15000000 "bundletool.jar (AAB Builder)" "false" "${BT_MIRRORS[@]}" || true

# 5. Install Storm CLI Executable to Global PATH
echo -e "\n${BOLD}[4/5] Installing Storm CLI to system PATH...${RESET}"

INSTALL_DIR=""
if [ "$IS_TERMUX" = true ]; then
    INSTALL_DIR="$PREFIX/bin"
elif [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
else
    INSTALL_DIR="$HOME/.local/bin"
    mkdir -p "$INSTALL_DIR"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$STORM_DIR/core"
mkdir -p "$CORE_DIR"
cp -r "$SCRIPT_DIR/storm_engine" "$CORE_DIR/"
cp "$SCRIPT_DIR/storm.py" "$CORE_DIR/"

# Create global wrapper script
WRAPPER_FILE="$INSTALL_DIR/storm"
cat << 'EOF' > "$WRAPPER_FILE"
#!/usr/bin/env bash
python3 "$HOME/.storm/core/storm.py" "$@"
EOF
chmod +x "$WRAPPER_FILE"

echo -e "  • Installed ${GREEN}storm${RESET} executable into: ${CYAN}${WRAPPER_FILE}${RESET}"

if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    SHELL_RC="$HOME/.bashrc"
    [ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"
    echo "export PATH=\"\$PATH:$INSTALL_DIR\"" >> "$SHELL_RC"
    echo -e "  • Added ${INSTALL_DIR} to ${SHELL_RC}"
fi

# 6. Run Diagnosis
echo -e "\n${BOLD}[5/5] Verifying Toolchain Diagnosis...${RESET}"
python3 "$SCRIPT_DIR/storm.py" doctor || true

echo -e "\n${GREEN}${BOLD}════════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}🎉 Storm Build CLI has been installed and verified!${RESET}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════════${RESET}"
echo -e "\nYou can now use ${CYAN}${BOLD}storm${RESET} from ANY directory:\n"
echo -e "  ${BOLD}storm doctor${RESET}                                   # Check toolchain"
echo -e "  ${BOLD}storm init MyApp -t yandex-ads${RESET}                 # Create project (storm.m + app/)"
echo -e "  ${BOLD}cd MyApp && storm deps fetch && storm build apk${RESET}  # Build APK"
echo -e "  ${BOLD}storm plugin set 2026.2.0 && storm update${RESET}       # Pin / install a newer Storm plugin"
echo -e "  ${BOLD}storm build aab --release --r8${RESET}                  # Build AAB for Google Play / RuStore"
echo ""
echo -e "${YELLOW}Next:${RESET}  storm init MyApp && cd MyApp && storm build apk"
echo -e "${YELLOW}Chat:${RESET}           ${CYAN}https://t.me/wfllive_chat_base${RESET}"
echo -e "${YELLOW}Docs:${RESET}           ${CYAN}https://wfllive.github.io/Storm-Build/${RESET}"
echo -e "${YELLOW}Support Storm:${RESET}  ${CYAN}https://boosty.to/wfllive/donate${RESET}"
echo ""
