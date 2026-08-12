#!/data/data/com.termux/files/usr/bin/bash
# build-proot-termux.sh
# ---------------------
# Builds proot + separate loader ELF, both aarch64, bionic-only.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
JNI_DIR="$ROOT_DIR/modules/termux-terminal/android/src/main/jniLibs/arm64-v8a"
CACHE="$HOME/.cache/build-proot-termux"
PROOT_SRC="$CACHE/proot"

TALLOC_VER="2.4.2"
TALLOC_URL="https://download.samba.org/pub/talloc/talloc-${TALLOC_VER}.tar.gz"
TALLOC_SRC="$CACHE/talloc-${TALLOC_VER}"
TALLOC_BUILD="$CACHE/talloc-build"

mkdir -p "$CACHE" "$JNI_DIR"

# ─────────────────────────────────────────────────────────────
# 1) Build libtalloc.a
# ─────────────────────────────────────────────────────────────
if [ ! -f "$TALLOC_BUILD/libtalloc.a" ]; then
  echo "==> Fetch libtalloc ${TALLOC_VER}"
  cd "$CACHE"
  if [ ! -f "talloc-${TALLOC_VER}.tar.gz" ]; then
    wget -q --show-progress "$TALLOC_URL" -O "talloc-${TALLOC_VER}.tar.gz"
  fi
  rm -rf "$TALLOC_SRC" "$TALLOC_BUILD"
  tar -xzf "talloc-${TALLOC_VER}.tar.gz"
  mkdir -p "$TALLOC_BUILD"

  echo "==> Build libtalloc.a"
  cd "$TALLOC_SRC"
  cp talloc.c talloc.h "$TALLOC_BUILD/"

  cat > "$TALLOC_BUILD/replace.h" <<'EOF'
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>
#include <limits.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/param.h>
#ifndef MIN
#define MIN(a,b) (((a) < (b)) ? (a) : (b))
#endif
#ifndef MAX
#define MAX(a,b) (((a) > (b)) ? (a) : (b))
#endif
#ifndef _PUBLIC_
#define _PUBLIC_
#endif
#ifndef _DEPRECATED_
#define _DEPRECATED_
#endif
#ifndef _PRIVATE_
#define _PRIVATE_ static
#endif
#ifndef PRINTF_ATTRIBUTE
#define PRINTF_ATTRIBUTE(a,b)
#endif
#ifndef HAVE_VA_COPY
#define HAVE_VA_COPY 1
#endif
EOF

  cd "$TALLOC_BUILD"

  TALLOC_MAJOR="$(echo "$TALLOC_VER" | cut -d. -f1)"
  TALLOC_MINOR="$(echo "$TALLOC_VER" | cut -d. -f2)"
  TALLOC_RELEASE="$(echo "$TALLOC_VER" | cut -d. -f3)"

  clang -O2 -fPIC -DHAVE_VA_COPY -D_GNU_SOURCE \
        -DTALLOC_BUILD_VERSION_MAJOR="$TALLOC_MAJOR" \
        -DTALLOC_BUILD_VERSION_MINOR="$TALLOC_MINOR" \
        -DTALLOC_BUILD_VERSION_RELEASE="$TALLOC_RELEASE" \
        -I. -include replace.h \
        -c talloc.c -o talloc.o

  ar rcs libtalloc.a talloc.o
  ranlib libtalloc.a
  echo "==> Built: $TALLOC_BUILD/libtalloc.a"
fi

# ─────────────────────────────────────────────────────────────
# 2) Clone termux/proot
# ─────────────────────────────────────────────────────────────
if [ ! -d "$PROOT_SRC/.git" ]; then
  echo "==> Clone termux/proot"
  git clone --depth 1 https://github.com/termux/proot.git "$PROOT_SRC"
fi

cd "$PROOT_SRC/src"
make -s clean || true

# ─────────────────────────────────────────────────────────────
# 3) Patch Makefile
# ─────────────────────────────────────────────────────────────
MK="$PROOT_SRC/src/GNUmakefile"
cp -f "$MK" "$MK.bak"

echo "==> Patch GNUmakefile"

sed -i \
  -e 's/-landroid-shmem//g' \
  -e 's/-ltalloc//g' \
  -e 's/-lutil//g' \
  "$MK"

INJECT="LDFLAGS += ${TALLOC_BUILD}/libtalloc.a -lc -ldl -lm -llog"
{
  echo ""
  echo "# --- injected by build-proot-termux.sh ---"
  echo "$INJECT"
  echo "# ------------------------------------------"
} >> "$MK"

# ─────────────────────────────────────────────────────────────
# 4) Build proot
# ─────────────────────────────────────────────────────────────
echo "==> Build proot"

export CC="clang"
export CFLAGS="-O2 -fPIE -DANDROID \
  -I${TALLOC_BUILD} \
  -Wno-error -Wno-deprecated-declarations -Wno-unused-variable \
  -Wno-unused-but-set-variable -Wno-sign-compare -Wno-misleading-indentation \
  -Wno-inline-asm -Wno-unused-parameter -Wno-unused-result -Wno-sizeof-array-argument"

make -s proot V=1

BIN="$PROOT_SRC/src/proot"
[ -f "$BIN" ] || { echo "!! proot not built"; exit 1; }

# ─────────────────────────────────────────────────────────────
# 5) Find loader ELF that make produced
# ─────────────────────────────────────────────────────────────
echo "==> Looking for loader ELF built by make"

# The termux/proot Makefile builds:
#   src/loader/loader        (native aarch64 loader ELF)
#   src/loader/loader-m32    (32-bit loader ELF, for 32-on-64 case)
# Then it wraps them into .o files and links into proot.
# We want the raw loader ELF as a separate file.

LOADER_SRC="$PROOT_SRC/src/loader/loader"
LOADER_M32_SRC="$PROOT_SRC/src/loader/loader-m32"

if [ ! -f "$LOADER_SRC" ]; then
  echo "==> loader ELF not found, building explicit target"
  # Try common targets
  make -C "$PROOT_SRC/src" loader/loader V=1 || \
  make -C "$PROOT_SRC/src" loader V=1 || true
fi

if [ ! -f "$LOADER_SRC" ]; then
  echo "!! Still no loader ELF. Listing loader dir:"
  ls -la "$PROOT_SRC/src/loader/" || true
  echo "!! We will proceed without external loader (embedded loader will be used)."
  HAVE_LOADER=0
else
  HAVE_LOADER=1
  echo "==> loader: $LOADER_SRC"
  file "$LOADER_SRC"
fi

# ─────────────────────────────────────────────────────────────
# 6) Inspect proot
# ─────────────────────────────────────────────────────────────
echo ""
echo "==> Verify proot"
file "$BIN"
readelf -d "$BIN" | grep -E 'NEEDED|RUNPATH|RPATH' || true

# ─────────────────────────────────────────────────────────────
# 7) Install
# ─────────────────────────────────────────────────────────────
echo ""
echo "==> Install proot"
cp -f "$BIN" "$JNI_DIR/libproot.so"
chmod 755 "$JNI_DIR/libproot.so"
patchelf --remove-rpath "$JNI_DIR/libproot.so" || true

if [ "$HAVE_LOADER" = "1" ]; then
  echo "==> Install loader as libproot-loader.so"
  cp -f "$LOADER_SRC" "$JNI_DIR/libproot-loader.so"
  chmod 755 "$JNI_DIR/libproot-loader.so"
  patchelf --remove-rpath "$JNI_DIR/libproot-loader.so" 2>/dev/null || true
else
  rm -f "$JNI_DIR/libproot-loader.so"
fi

# Clean anything else
for f in libloader.so libtalloc.so libtalloc.so.2 libandroid-shmem.so; do
  rm -f "$JNI_DIR/$f"
done

echo ""
echo "═════════════════════════════════════════════════════════"
echo "  ✓ Built proot + loader for arm64-v8a"
ls -la "$JNI_DIR"
echo "═════════════════════════════════════════════════════════"