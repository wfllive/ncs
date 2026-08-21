"""
Storm plugin version manager.

storm.m pin:

    plugin {
        storm     2026.2.0
        source    https://github.com/wfllive/Storm-Engine-Studio
        auto      true
    }

If the pin is newer than the running Storm (missing features, bugfixes),
`storm update` / auto-sync downloads that version into ~/.storm/plugins
and refreshes ~/.storm/core so the next command (or a re-exec) uses it.

storm.lock is not touched.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import List, Optional, Tuple

from . import __version__ as BUNDLED_VERSION
from .env import Colors

PLUGIN_HOME = Path.home() / ".storm" / "plugins"
CORE_DIR = Path.home() / ".storm" / "core"
DEFAULT_SOURCE = "https://github.com/wfllive/Storm-Engine-Studio"
FALLBACK_SOURCES = (
    "https://github.com/wfllive/Storm-Engine-Studio",
    "https://github.com/wfllive/Storm-Build",
)
USER_AGENT = "StormBuildCLI/2026 (+https://github.com/wfllive/Storm-Build)"


def parse_semver(v: str) -> Tuple[int, ...]:
    parts = [int(p) for p in re.findall(r"\d+", v or "")]
    return tuple(parts) if parts else (0,)


def compare_versions(a: str, b: str) -> int:
    """Return 1 if a>b, -1 if a<b, 0 if equal (numeric components only)."""
    pa, pb = parse_semver(a), parse_semver(b)
    n = max(len(pa), len(pb))
    pa = pa + (0,) * (n - len(pa))
    pb = pb + (0,) * (n - len(pb))
    if pa > pb:
        return 1
    if pa < pb:
        return -1
    return 0


def running_version() -> str:
    return str(BUNDLED_VERSION)


def installed_plugin_version() -> Optional[str]:
    current = PLUGIN_HOME / "current"
    if current.is_file():
        text = current.read_text(encoding="utf-8").strip()
        if text:
            return text
    marker = CORE_DIR / "VERSION"
    if marker.is_file():
        text = marker.read_text(encoding="utf-8").strip()
        if text:
            return text
    return None


def effective_version() -> str:
    return installed_plugin_version() or running_version()


def needs_update(required: Optional[str]) -> bool:
    if not required:
        return False
    return compare_versions(str(required), effective_version()) > 0


def _http_get(url: str, dest: Path, timeout: int = 90) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as out:
            shutil.copyfileobj(resp, out)
        return dest.exists() and dest.stat().st_size > 64
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return False


def _http_text(url: str, timeout: int = 30) -> Optional[str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None


def _normalize_source(source: Optional[str]) -> str:
    src = (source or DEFAULT_SOURCE).strip().rstrip("/")
    if src.endswith(".git"):
        src = src[:-4]
    return src or DEFAULT_SOURCE


def _repo_slug(source: str) -> Optional[str]:
    m = re.search(r"github\.com[:/]+([^/]+)/([^/]+)", source)
    if not m:
        return None
    return f"{m.group(1)}/{m.group(2).replace('.git', '')}"


def latest_remote_version(source: Optional[str] = None) -> Optional[str]:
    """Best-effort latest tag/release from GitHub."""
    slug = _repo_slug(_normalize_source(source))
    if not slug:
        return None
    body = _http_text(f"https://api.github.com/repos/{slug}/releases/latest")
    if body:
        m = re.search(r'"tag_name"\s*:\s*"([^"]+)"', body)
        if m:
            return m.group(1).lstrip("vV")
    body = _http_text(f"https://api.github.com/repos/{slug}/tags?per_page=5")
    if body:
        m = re.search(r'"name"\s*:\s*"([^"]+)"', body)
        if m:
            return m.group(1).lstrip("vV")
    return None


def _candidate_zip_urls(source: str, version: str) -> List[str]:
    src = _normalize_source(source)
    slug = _repo_slug(src)
    urls: List[str] = []
    tags = [version, f"v{version}", f"V{version}"]
    if slug:
        for tag in tags:
            urls.append(f"https://codeload.github.com/{slug}/zip/refs/tags/{tag}")
            urls.append(f"https://github.com/{slug}/archive/refs/tags/{tag}.zip")
        urls.append(f"https://codeload.github.com/{slug}/zip/refs/heads/main")
        urls.append(f"https://github.com/{slug}/archive/refs/heads/main.zip")
    return urls


def _find_engine_root(extracted: Path) -> Optional[Path]:
    """Locate a directory that contains storm_engine/ (handles nested zip layouts)."""
    if (extracted / "storm_engine" / "__init__.py").is_file():
        return extracted
    for child in extracted.iterdir():
        if child.is_dir() and (child / "storm_engine" / "__init__.py").is_file():
            return child
        # arena dump / one extra nesting level
        if child.is_dir():
            for grand in child.iterdir():
                if grand.is_dir() and (grand / "storm_engine" / "__init__.py").is_file():
                    return grand
    matches = list(extracted.rglob("storm_engine/__init__.py"))
    if matches:
        return matches[0].parent.parent
    return None


def _copy_engine(src_root: Path, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    engine_src = src_root / "storm_engine"
    engine_dst = dest / "storm_engine"
    if engine_dst.exists():
        shutil.rmtree(str(engine_dst))
    shutil.copytree(str(engine_src), str(engine_dst))
    for name in ("storm.py", "storm", "setup.py"):
        src = src_root / name
        if src.is_file():
            shutil.copy2(str(src), str(dest / name))


def install_plugin(version: str, source: Optional[str] = None) -> Optional[Path]:
    """Download *version* of Storm into ~/.storm/plugins/<version> and refresh core."""
    version = str(version).lstrip("vV")
    sources = []
    if source:
        sources.append(_normalize_source(source))
    for s in FALLBACK_SOURCES:
        if s not in sources:
            sources.append(s)

    PLUGIN_HOME.mkdir(parents=True, exist_ok=True)
    dest = PLUGIN_HOME / version

    with tempfile.TemporaryDirectory(prefix="storm-plugin-") as tmp:
        tmp_path = Path(tmp)
        archive = tmp_path / "plugin.zip"
        extracted = tmp_path / "src"
        extracted.mkdir()
        downloaded = False
        last_url = ""
        for src in sources:
            for url in _candidate_zip_urls(src, version):
                last_url = url
                print(f"  ↓  plugin {version}  ←  {url}")
                if _http_get(url, archive):
                    try:
                        with zipfile.ZipFile(str(archive), "r") as zf:
                            zf.extractall(str(extracted))
                        downloaded = True
                        break
                    except zipfile.BadZipFile:
                        archive.unlink(missing_ok=True)
                        continue
            if downloaded:
                break
        if not downloaded:
            print(f"{Colors.RED}[PLUGIN] Could not download Storm {version}.{Colors.RESET}")
            if last_url:
                print(f"         last tried: {last_url}")
            print("         Check the network, or set plugin.source in storm.m")
            return None

        engine_root = _find_engine_root(extracted)
        if engine_root is None:
            print(f"{Colors.RED}[PLUGIN] Archive has no storm_engine/ package.{Colors.RESET}")
            return None

        if dest.exists():
            shutil.rmtree(str(dest))
        _copy_engine(engine_root, dest)
        (dest / "VERSION").write_text(version + "\n", encoding="utf-8")

    (PLUGIN_HOME / "current").write_text(version + "\n", encoding="utf-8")

    # Keep the globally installed CLI in sync (install.sh copies here).
    try:
        _copy_engine(dest, CORE_DIR)
        (CORE_DIR / "VERSION").write_text(version + "\n", encoding="utf-8")
    except OSError as exc:
        print(f"  {Colors.YELLOW}[PLUGIN] Installed to {dest}, but could not refresh {CORE_DIR}: {exc}{Colors.RESET}")

    print(f"{Colors.GREEN}✔ Storm plugin {version} installed → {dest}{Colors.RESET}")
    return dest


def plugin_launcher(version: str) -> Optional[Path]:
    dest = PLUGIN_HOME / version / "storm.py"
    if dest.is_file():
        return dest
    core = CORE_DIR / "storm.py"
    if core.is_file():
        return core
    return None


def reexec_plugin(version: str) -> bool:
    """Replace the current process with the installed plugin, if available."""
    launcher = plugin_launcher(version)
    if not launcher:
        return False
    # Avoid infinite re-exec loops.
    if os.environ.get("STORM_PLUGIN_ACTIVE") == version:
        return False
    env = os.environ.copy()
    env["STORM_PLUGIN_ACTIVE"] = version
    print(f"  [PLUGIN] Switching to Storm {version}")
    os.execve(sys.executable, [sys.executable, str(launcher), *sys.argv[1:]], env)
    return True  # unreachable


def sync_plugin(required: Optional[str], source: Optional[str] = None, auto: bool = True, reexec: bool = True) -> bool:
    """
    Ensure the running Storm is at least *required*.
    Returns True if the current process is good to continue.
    """
    if not required:
        return True
    required = str(required).lstrip("vV")
    if not needs_update(required):
        return True

    current = effective_version()
    print(f"{Colors.CYAN}[PLUGIN] storm.m asks for Storm {required}  (running {current}){Colors.RESET}")
    print("         New features / fixes live in the newer plugin.")

    # Already downloaded earlier?
    if (PLUGIN_HOME / required / "storm_engine" / "__init__.py").is_file():
        (PLUGIN_HOME / "current").write_text(required + "\n", encoding="utf-8")
        if reexec:
            reexec_plugin(required)
        return True

    if not auto:
        print(f"         Run:  {Colors.BOLD}storm update{Colors.RESET}")
        return True

    installed = install_plugin(required, source)
    if installed is None:
        print(f"{Colors.YELLOW}[PLUGIN] Continuing with Storm {current}.{Colors.RESET}")
        return False
    if reexec:
        reexec_plugin(required)
    return True


def print_plugin_status(required: Optional[str] = None, source: Optional[str] = None):
    current = effective_version()
    bundled = running_version()
    pinned = (required or "—").lstrip("vV") if required else "—"
    print(f"\n{Colors.BOLD}Storm plugin{Colors.RESET}")
    print(f"  running     {current}")
    print(f"  bundled     {bundled}")
    print(f"  storm.m     {pinned}")
    inst = installed_plugin_version()
    if inst:
        print(f"  ~/.storm    {inst}  ({PLUGIN_HOME / inst})")
    src = _normalize_source(source)
    print(f"  source      {src}")
    if required and needs_update(required):
        print(f"  {Colors.YELLOW}status      outdated — run `storm update`{Colors.RESET}")
    else:
        print(f"  {Colors.GREEN}status      up to date{Colors.RESET}")
    print()
