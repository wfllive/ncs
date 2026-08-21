"""
Environment and Toolchain Detection for Storm Build CLI
Supports x86_64, aarch64 (ARM 64-bit), Termux (Android), macOS, Linux, Windows.
Includes robust multi-mirror downloader with validation, integrity checking, and automated AAPT2 setup for ARM64/x86_64.
"""

import os
import sys
import shutil
import zipfile
import tarfile
import platform
import subprocess
import urllib.request
from pathlib import Path
import tempfile
from typing import Dict, Optional, Tuple, List

# ANSI Colors for rich CLI output
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    RESET = '\033[0m'

    @classmethod
    def disable(cls):
        cls.HEADER = ''
        cls.BLUE = ''
        cls.CYAN = ''
        cls.GREEN = ''
        cls.YELLOW = ''
        cls.RED = ''
        cls.BOLD = ''
        cls.UNDERLINE = ''
        cls.RESET = ''


def is_termux() -> bool:
    """Check if running inside Termux environment on Android."""
    prefix = os.environ.get("PREFIX", "")
    if "com.termux" in prefix:
        return True
    if os.path.exists("/data/data/com.termux/files/usr"):
        return True
    return False


def get_arch() -> str:
    """Get normalized CPU architecture."""
    machine = platform.machine().lower()
    if machine in ("aarch64", "arm64", "armv8l", "armv8b"):
        return "aarch64"
    if machine in ("arm", "armv7l", "armv7b", "armv6l"):
        return "armv7"
    if machine in ("x86_64", "amd64", "x64"):
        return "x86_64"
    if machine in ("i386", "i686", "x86"):
        return "x86"
    return machine


def get_os() -> str:
    """Get host OS name."""
    if is_termux():
        return "Termux (Android)"
    return platform.system()


def is_valid_jar(file_path: Path, min_size_mb: float = 1.0) -> bool:
    """Check if file exists, meets minimum size, and is a valid uncorrupted ZIP/JAR."""
    if not file_path.exists():
        return False
    size_mb = file_path.stat().st_size / (1024 * 1024)
    if size_mb < min_size_mb:
        return False
    try:
        with zipfile.ZipFile(str(file_path), 'r') as zf:
            return zf.testzip() is None
    except Exception:
        return False


def is_executable_file(path: Path) -> bool:
    """Check if file exists and is executable."""
    return path.exists() and path.is_file() and os.access(str(path), os.X_OK)


def android_platform_mirrors(api: int) -> List[str]:
    """Public mirrors that host android.jar for a given API level."""
    return [
        f"https://github.com/Sable/android-platforms/raw/master/android-{api}/android.jar",
        f"https://cdn.jsdelivr.net/gh/Sable/android-platforms@master/android-{api}/android.jar",
        f"https://github.com/anggrayudi/android-platforms/raw/master/android-{api}/android.jar",
        f"https://raw.githubusercontent.com/skylot/jadx/master/jadx-core/src/test/resources/samples/android-{api}.jar",
    ]


def _fetch_url_to_file(url: str, dest: Path, timeout: int) -> bool:
    """Download URL to dest via urllib, then curl if SSL/timeout fails."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()
    headers = {"User-Agent": "Mozilla/5.0 (Linux; Android; StormBuildCLI/2026)"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as response, open(dest, "wb") as out_file:
            shutil.copyfileobj(response, out_file)
        return dest.exists() and dest.stat().st_size > 0
    except Exception:
        if dest.exists():
            dest.unlink()
    curl = shutil.which("curl")
    if not curl:
        return False
    try:
        res = subprocess.run(
            [
                curl, "-fsSL",
                "--connect-timeout", "20",
                "--max-time", str(timeout),
                "-A", headers["User-Agent"],
                "-o", str(dest),
                url,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout + 15,
        )
        return res.returncode == 0 and dest.exists() and dest.stat().st_size > 0
    except Exception:
        if dest.exists():
            dest.unlink()
        return False


def download_with_mirrors(
    dest_path: Path,
    mirrors: List[str],
    description: str,
    min_size_mb: float = 1.0,
    is_binary: bool = False,
    timeout: int = 90,
) -> bool:
    """Download a tool file from a list of mirrors with retry and validation."""
    if not is_binary and is_valid_jar(dest_path, min_size_mb):
        sz = dest_path.stat().st_size / (1024 * 1024)
        print(f"  • {Colors.GREEN}✔ {description} already installed and verified ({sz:.1f} MB){Colors.RESET}")
        return True
    elif is_binary and is_executable_file(dest_path) and dest_path.stat().st_size > (min_size_mb * 1024 * 1024):
        sz = dest_path.stat().st_size / (1024 * 1024)
        print(f"  • {Colors.GREEN}✔ {description} binary already installed ({sz:.1f} MB){Colors.RESET}")
        return True

    if dest_path.exists():
        dest_path.unlink()

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = dest_path.with_suffix(".tmp")

    for idx, url in enumerate(mirrors, 1):
        print(f"  • Downloading {description} (Mirror {idx}/{len(mirrors)})...")
        for attempt in range(1, 4):
            fetched = _fetch_url_to_file(url, temp_path, timeout)
            if fetched:
                if not is_binary:
                    valid = is_valid_jar(temp_path, min_size_mb)
                else:
                    if url.endswith(".tar.gz") or url.endswith(".tgz"):
                        try:
                            with tarfile.open(str(temp_path), "r:gz") as tar:
                                for member in tar.getmembers():
                                    if member.name.endswith("aapt2") or member.name.endswith("aapt"):
                                        f = tar.extractfile(member)
                                        if f:
                                            with open(dest_path, "wb") as out_b:
                                                shutil.copyfileobj(f, out_b)
                                            dest_path.chmod(0o755)
                                            temp_path.unlink()
                                            return True
                        except Exception:
                            pass
                    valid = temp_path.stat().st_size > (min_size_mb * 1024 * 1024)

                if valid:
                    if dest_path.exists():
                        dest_path.unlink()
                    temp_path.rename(dest_path)
                    if is_binary:
                        dest_path.chmod(0o755)
                    sz = dest_path.stat().st_size / (1024 * 1024)
                    print(f"    {Colors.GREEN}✔ Successfully downloaded and verified {description} ({sz:.1f} MB){Colors.RESET}")
                    return True
                if temp_path.exists():
                    temp_path.unlink()
            elif temp_path.exists():
                temp_path.unlink()
            if attempt < 3:
                import time
                time.sleep(1)

    print(f"    {Colors.YELLOW}[WARN] Could not download {description} automatically.{Colors.RESET}")
    return False


def aapt2_include_unsupported(stderr: str) -> bool:
    """True when aapt2 cannot parse android.jar resource tables (API 35+)."""
    text = stderr or ""
    return (
        "RES_TABLE_TYPE_TYPE" in text
        or "Failed to load resources table" in text
        or "failed to load include path" in text.lower()
    )


def extract_aapt2_binary(archive: Path, dest: Path) -> bool:
    """Pull the aapt2 executable out of a zip/tar of Android build-tools."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        if zipfile.is_zipfile(str(archive)):
            with zipfile.ZipFile(str(archive), "r") as zf:
                candidates = [
                    n for n in zf.namelist()
                    if not n.endswith("/") and n.rstrip("/").split("/")[-1] in ("aapt2", "aapt2.exe")
                ]
                if not candidates:
                    return False
                name = sorted(candidates, key=lambda n: (n.count("/"), len(n)))[0]
                with zf.open(name) as src, open(dest, "wb") as out:
                    shutil.copyfileobj(src, out)
        elif tarfile.is_tarfile(str(archive)):
            extracted = False
            with tarfile.open(str(archive), "r:*") as tar:
                for member in tar.getmembers():
                    base = member.name.rstrip("/").split("/")[-1]
                    if member.isfile() and base in ("aapt2", "aapt2.exe"):
                        f = tar.extractfile(member)
                        if f:
                            with open(dest, "wb") as out:
                                shutil.copyfileobj(f, out)
                            extracted = True
                            break
            if not extracted:
                return False
        else:
            return False
    except Exception:
        if dest.exists():
            dest.unlink()
        return False

    if not dest.exists() or dest.stat().st_size < 100_000:
        if dest.exists():
            dest.unlink()
        return False
    dest.chmod(0o755)
    return True


class Toolchain:
    def __init__(self, project_dir: Optional[str] = None, tools_dir: Optional[str] = None):
        self.project_dir = Path(project_dir or ".").resolve()
        self.arch = get_arch()
        self.os = get_os()
        self.is_termux = is_termux()
        self.tools_dir = Path(tools_dir).resolve() if tools_dir else (Path.home() / ".storm" / "tools")
        self.tools_dir.mkdir(parents=True, exist_ok=True)

    def find_executable(self, name: str, env_var: Optional[str] = None) -> Optional[str]:
        """Find an executable in env var, tools dir, SDK, Termux, or PATH."""
        if env_var and os.environ.get(env_var):
            path = os.environ[env_var]
            if os.path.exists(path) and os.access(path, os.X_OK):
                return path

        # Check local tools dir ~/.storm/tools/<name>
        local_tool = self.tools_dir / name
        if is_executable_file(local_tool):
            return str(local_tool)

        # Check project tools/
        proj_tool = self.project_dir / "tools" / name
        if is_executable_file(proj_tool):
            return str(proj_tool)

        # Check standard PATH
        path = shutil.which(name)
        if path:
            return path

        # Check Termux specific paths
        if self.is_termux:
            termux_bin = f"/data/data/com.termux/files/usr/bin/{name}"
            if os.path.exists(termux_bin):
                return termux_bin

        # Common Linux system paths
        for sys_path in [f"/usr/bin/{name}", f"/usr/local/bin/{name}", f"/bin/{name}"]:
            if os.path.exists(sys_path) and os.access(sys_path, os.X_OK):
                return sys_path

        # Check Android SDK build-tools
        sdk_root = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
        if sdk_root and os.path.exists(sdk_root):
            build_tools_dir = Path(sdk_root) / "build-tools"
            if build_tools_dir.exists():
                versions = sorted(build_tools_dir.iterdir(), reverse=True)
                for ver in versions:
                    tool_path = ver / name
                    if tool_path.exists() and os.access(str(tool_path), os.X_OK):
                        return str(tool_path)
                    tool_exe = ver / f"{name}.exe"
                    if tool_exe.exists():
                        return str(tool_exe)
                    tool_bat = ver / f"{name}.bat"
                    if tool_bat.exists():
                        return str(tool_bat)

        return None

    def find_jar_tool(self, jar_name: str) -> Optional[str]:
        """Find a standalone Java tool JAR (like r8.jar, bundletool.jar, apksigner.jar)."""
        local_jar = self.tools_dir / jar_name
        if is_valid_jar(local_jar, min_size_mb=0.1):
            return str(local_jar)

        proj_jar = self.project_dir / "tools" / jar_name
        if is_valid_jar(proj_jar, min_size_mb=0.1):
            return str(proj_jar)

        sdk_root = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
        if sdk_root and os.path.exists(sdk_root):
            build_tools_dir = Path(sdk_root) / "build-tools"
            if build_tools_dir.exists():
                versions = sorted(build_tools_dir.iterdir(), reverse=True)
                for ver in versions:
                    lib_jar = ver / "lib" / jar_name
                    if is_valid_jar(lib_jar, min_size_mb=0.1):
                        return str(lib_jar)

        if self.is_termux:
            termux_jar = Path(f"/data/data/com.termux/files/usr/share/java/{jar_name}")
            if is_valid_jar(termux_jar, min_size_mb=0.1):
                return str(termux_jar)

        return None

    def find_android_jar_exact(self, target_api: int = 34) -> Optional[str]:
        """Find android.jar that matches this API level only (no silent fallback)."""
        env_jar = os.environ.get("ANDROID_JAR")
        if env_jar:
            jar_p = Path(env_jar)
            marker = f"android-{target_api}"
            if is_valid_jar(jar_p, min_size_mb=1.0) and (marker in jar_p.name or marker in jar_p.as_posix()):
                return str(jar_p)

        sdk_root = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
        if sdk_root and os.path.exists(sdk_root):
            target_jar = Path(sdk_root) / "platforms" / f"android-{target_api}" / "android.jar"
            if is_valid_jar(target_jar, min_size_mb=1.0):
                return str(target_jar)

        local_jar = self.tools_dir / f"android-{target_api}.jar"
        if is_valid_jar(local_jar, min_size_mb=1.0):
            return str(local_jar)
        return None

    def find_android_jar(self, target_api: int = 34) -> Optional[str]:
        """Find android.jar: exact API first, then any installed platform."""
        exact = self.find_android_jar_exact(target_api)
        if exact:
            return exact

        if os.environ.get("ANDROID_JAR"):
            jar_p = Path(os.environ["ANDROID_JAR"])
            if is_valid_jar(jar_p, min_size_mb=1.0):
                return str(jar_p)

        sdk_root = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
        if sdk_root and os.path.exists(sdk_root):
            platforms_dir = Path(sdk_root) / "platforms"
            if platforms_dir.exists():
                available = sorted(platforms_dir.glob("android-*/android.jar"), reverse=True)
                for av in available:
                    if is_valid_jar(av, min_size_mb=1.0):
                        return str(av)

        if self.is_termux:
            termux_android = Path("/data/data/com.termux/files/usr/share/java/android.jar")
            if is_valid_jar(termux_android, min_size_mb=1.0):
                return str(termux_android)

        for jar in sorted(self.tools_dir.glob("android-*.jar"), reverse=True):
            if is_valid_jar(jar, min_size_mb=1.0):
                return str(jar)

        return None

    def download_android_jar(self, api: int) -> Optional[str]:
        """Download android.jar for API into ~/.storm/tools/android-{api}.jar."""
        dest = self.tools_dir / f"android-{api}.jar"
        ok = download_with_mirrors(
            dest,
            android_platform_mirrors(api),
            f"android.jar (API {api})",
            min_size_mb=5.0,
            timeout=120,
        )
        if ok and is_valid_jar(dest, min_size_mb=5.0):
            return str(dest)
        return None

    def ensure_android_jar(self, api: int, download: bool = True) -> Optional[str]:
        """Return android.jar for this API, downloading it during build if missing."""
        found = self.find_android_jar_exact(api)
        if found:
            print(f"  {Colors.GREEN}[SDK] android.jar API {api} ready: {found}{Colors.RESET}")
            return found

        if download:
            print(f"  {Colors.CYAN}[SDK] android.jar API {api} not installed — downloading to {self.tools_dir} ...{Colors.RESET}")
            downloaded = self.download_android_jar(api)
            if downloaded:
                return downloaded
            print(f"  {Colors.YELLOW}[SDK] Download of API {api} failed.{Colors.RESET}")

        fallback = self.find_android_jar(api)
        if fallback:
            print(f"  {Colors.YELLOW}[SDK] Using fallback {fallback} (requested API {api}). "
                  f"New Android APIs will not compile.{Colors.RESET}")
            return fallback
        return None

    def aapt2_can_include(self, aapt2: str, jar: Path) -> bool:
        """Return True if this aapt2 can use jar as `aapt2 link -I`."""
        if not aapt2 or not jar or not Path(jar).exists():
            return False
        tmp = Path(tempfile.mkdtemp(prefix="storm-aapt2-"))
        try:
            man = tmp / "AndroidManifest.xml"
            man.write_text(
                '<?xml version="1.0" encoding="utf-8"?>'
                '<manifest xmlns:android="http://schemas.android.com/apk/res/android" '
                'package="com.storm.probe"><application/></manifest>',
                encoding="utf-8",
            )
            out = tmp / "probe.apk"
            res = subprocess.run(
                [aapt2, "link", "-I", str(jar), "--manifest", str(man), "-o", str(out)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=40,
            )
            err = (res.stderr or "") + (res.stdout or "")
            if aapt2_include_unsupported(err):
                return False
            return res.returncode == 0 and out.exists()
        except Exception:
            return False
        finally:
            shutil.rmtree(str(tmp), ignore_errors=True)

    def modern_aapt2_mirrors(self) -> List[str]:
        if self.arch in ("aarch64", "arm64"):
            return [
                "https://github.com/lzhiyong/android-sdk-tools/releases/download/35.0.2/android-sdk-tools-static-aarch64.zip",
            ]
        if self.arch == "x86_64":
            return [
                "https://github.com/lzhiyong/android-sdk-tools/releases/download/35.0.2/android-sdk-tools-static-x86_64.zip",
            ]
        if self.arch in ("armv7", "arm", "x86"):
            name = "arm" if self.arch.startswith("arm") else "x86"
            return [
                f"https://github.com/lzhiyong/android-sdk-tools/releases/download/35.0.2/android-sdk-tools-static-{name}.zip",
            ]
        return []

    def ensure_modern_aapt2(self) -> Optional[str]:
        """Install statically-linked aapt2 35.0.2 that can read API 35+ android.jar."""
        dest = self.tools_dir / "aapt2"
        stamp = self.tools_dir / ".aapt2-35"
        if is_executable_file(dest) and stamp.exists() and dest.stat().st_size > 500_000:
            return str(dest)

        mirrors = self.modern_aapt2_mirrors()
        if not mirrors:
            return str(dest) if is_executable_file(dest) else None

        archive = self.tools_dir / "aapt2-35-tools.zip"
        print(f"  {Colors.CYAN}[SDK] Downloading aapt2 35+ (needed for android.jar API 35+) ...{Colors.RESET}")
        if not download_with_mirrors(
            archive, mirrors, "aapt2 35.0.2 (static build-tools)", min_size_mb=5.0, is_binary=True, timeout=120
        ):
            return str(dest) if is_executable_file(dest) else None

        if not extract_aapt2_binary(archive, dest):
            print(f"  {Colors.YELLOW}[SDK] Could not extract aapt2 from the downloaded archive.{Colors.RESET}")
            return str(dest) if is_executable_file(dest) else None
        try:
            stamp.write_text("35.0.2\n", encoding="utf-8")
            archive.unlink()
        except Exception:
            pass
        print(f"  {Colors.GREEN}[SDK] aapt2 35+ installed: {dest}{Colors.RESET}")
        return str(dest)

    def resolve_platform_jars(self, aapt2: Optional[str], compile_jar: Path, needed_api: int) -> Tuple[Optional[str], Path, Path]:
        """Pick aapt2 + link jar + javac jar. API 35+ needs newer aapt2 or a 34 link jar."""
        javac_jar = compile_jar
        link_jar = compile_jar
        chosen_aapt = aapt2

        if needed_api >= 35 and aapt2 and not self.aapt2_can_include(aapt2, compile_jar):
            print(f"  {Colors.YELLOW}[AAPT2] {aapt2} cannot read resource table in {compile_jar.name} "
                  f"(API 35+ format). Upgrading aapt2...{Colors.RESET}")
            modern = self.ensure_modern_aapt2()
            if modern and self.aapt2_can_include(modern, compile_jar):
                chosen_aapt = modern
                print(f"  {Colors.GREEN}[AAPT2] Using {modern} for API {needed_api}{Colors.RESET}")
            else:
                fb_api = 34
                fb = self.ensure_android_jar(fb_api, download=True)
                if fb and chosen_aapt and self.aapt2_can_include(chosen_aapt, Path(fb)):
                    link_jar = Path(fb)
                    print(f"  {Colors.YELLOW}[AAPT2] Linking resources with android-{fb_api}.jar; "
                          f"javac/D8 still use {compile_jar.name}. "
                          f"targetSdk={needed_api} is written into the manifest.{Colors.RESET}")
                elif fb:
                    link_jar = Path(fb)
                    print(f"  {Colors.YELLOW}[AAPT2] Will try linking with {link_jar.name}.{Colors.RESET}")

        return chosen_aapt, link_jar, javac_jar

    def get_java_compiler(self) -> Tuple[Optional[str], str]:
        """Find Java compiler: javac or ecj (Eclipse compiler for Termux)."""
        javac = self.find_executable("javac", "JAVAC")
        if javac:
            return javac, "javac"
        ecj = self.find_executable("ecj", "ECJ")
        if ecj:
            return ecj, "ecj"
        return None, "none"

    def get_aapt2(self) -> Optional[str]:
        """Find aapt2 or aapt binary."""
        aapt2 = self.find_executable("aapt2", "AAPT2")
        if aapt2:
            return aapt2
        aapt = self.find_executable("aapt", "AAPT")
        if aapt:
            return aapt
        return None

    def get_dexer(self) -> Tuple[Optional[str], str]:
        """Find a dexer. Prefer tools that can run real D8 (not R8.main).

        Termux/AOSP ship an `r8` wrapper that *always* starts R8.main. If we
        pick that first, a default `storm build apk` (D8 mode) still shrinks
        and dies on missing Play Services annotation classes.
        """
        d8_bin = self.find_executable("d8", "D8")
        if d8_bin:
            return d8_bin, "d8"

        r8_jar = self.find_jar_tool("r8.jar")
        if r8_jar:
            return r8_jar, "r8.jar"

        d8_jar = self.find_jar_tool("d8.jar")
        if d8_jar:
            return d8_jar, "d8.jar"

        r8_bin = self.find_executable("r8", "R8")
        if r8_bin:
            return r8_bin, "r8"

        dx_bin = self.find_executable("dx", "DX")
        if dx_bin:
            return dx_bin, "dx"

        return None, "none"

    KOTLIN_VERSION = "1.9.24"

    def find_kotlinc(self) -> Optional[str]:
        """kotlinc on PATH, Termux, or ~/.storm/tools/kotlinc/bin/kotlinc."""
        found = self.find_executable("kotlinc", "KOTLINC")
        if found:
            return found
        home_bin = self.tools_dir / "kotlinc" / "bin" / "kotlinc"
        if is_executable_file(home_bin):
            return str(home_bin)
        bat = self.tools_dir / "kotlinc" / "bin" / "kotlinc.bat"
        if bat.exists():
            return str(bat)
        return None

    def kotlin_stdlib_jars(self) -> List[Path]:
        """stdlib jars that must be on the DEX classpath when the app has .kt sources."""
        jars: List[Path] = []
        roots = [self.tools_dir / "kotlinc" / "lib"]
        kotlinc = self.find_kotlinc()
        if kotlinc:
            roots.append(Path(kotlinc).resolve().parent.parent / "lib")
        names = (
            "kotlin-stdlib.jar",
            "kotlin-stdlib-jdk7.jar",
            "kotlin-stdlib-jdk8.jar",
            "kotlin-stdlib-common.jar",
        )
        seen = set()
        for root in roots:
            if not root.exists():
                continue
            for name in names:
                p = root / name
                if p.exists() and p.resolve() not in seen:
                    seen.add(p.resolve())
                    jars.append(p)
        return jars

    def ensure_kotlinc(self, download: bool = True) -> Optional[str]:
        """Return kotlinc, downloading the official compiler zip if needed."""
        found = self.find_kotlinc()
        if found:
            return found
        if not download:
            return None
        dest_dir = self.tools_dir / "kotlinc"
        archive = self.tools_dir / f"kotlin-compiler-{self.KOTLIN_VERSION}.zip"
        url = (
            f"https://github.com/JetBrains/kotlin/releases/download/"
            f"v{self.KOTLIN_VERSION}/kotlin-compiler-{self.KOTLIN_VERSION}.zip"
        )
        print(f"  {Colors.CYAN}[KOTLIN] kotlinc not found — downloading {self.KOTLIN_VERSION} ...{Colors.RESET}")
        if not download_with_mirrors(
            archive, [url], f"kotlin-compiler {self.KOTLIN_VERSION}", min_size_mb=20.0, timeout=180
        ):
            return None
        try:
            if dest_dir.exists():
                shutil.rmtree(str(dest_dir))
            with zipfile.ZipFile(str(archive), "r") as zf:
                zf.extractall(str(self.tools_dir))
        except Exception as exc:
            print(f"  {Colors.RED}[KOTLIN] Could not unpack compiler: {exc}{Colors.RESET}")
            return None
        bin_path = dest_dir / "bin" / "kotlinc"
        if bin_path.exists():
            bin_path.chmod(0o755)
            print(f"  {Colors.GREEN}[KOTLIN] kotlinc ready: {bin_path}{Colors.RESET}")
            return str(bin_path)
        return self.find_kotlinc()

    def get_zipalign(self) -> Optional[str]:
        """Find zipalign binary."""
        return self.find_executable("zipalign", "ZIPALIGN")

    def get_apksigner(self) -> Tuple[Optional[str], str]:
        """Find apksigner binary or apksigner.jar or keytool."""
        apksigner_bin = self.find_executable("apksigner", "APKSIGNER")
        if apksigner_bin:
            return apksigner_bin, "apksigner"

        apksigner_jar = self.find_jar_tool("apksigner.jar")
        if apksigner_jar:
            return apksigner_jar, "apksigner.jar"

        jarsigner_bin = self.find_executable("jarsigner", "JARSIGNER")
        if jarsigner_bin:
            return jarsigner_bin, "jarsigner"

        return None, "none"

    def get_bundletool(self) -> Optional[str]:
        """Find bundletool jar or binary for AAB building."""
        bin_tool = self.find_executable("bundletool", "BUNDLETOOL")
        if bin_tool:
            return bin_tool
        jar_tool = self.find_jar_tool("bundletool.jar")
        if jar_tool:
            return jar_tool
        return None

    def setup_tools(self, target_api: int = 34) -> bool:
        """Download missing cross-platform tools with multiple mirrors & validation."""
        self.tools_dir.mkdir(parents=True, exist_ok=True)
        print(f"\n{Colors.BOLD}{Colors.BLUE}=== Setting up Storm Cross-Platform Toolchain ({self.arch}) ==={Colors.RESET}\n")

        # 1. AAPT2 binary for ARM64 / x86_64 Linux
        if not self.get_aapt2():
            aapt2_dest = self.tools_dir / "aapt2"
            print(f"  • Setting up AAPT2 for {self.arch}...")
            
            # If on Linux and apt is available, try installing aapt package
            if shutil.which("apt-get"):
                try:
                    subprocess.run(["apt-get", "update", "-qq"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    subprocess.run(["apt-get", "install", "-y", "-qq", "aapt"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except Exception:
                    pass

            if not self.get_aapt2():
                # Download standalone AAPT2 binary for ARM64 or x86_64
                if self.arch in ("aarch64", "arm64"):
                    aapt2_mirrors = [
                        "https://github.com/lzhiyong/android-sdk-tools/releases/download/34.0.5/aapt2-linux-arm64.tar.gz",
                        "https://raw.githubusercontent.com/skylot/jadx/master/jadx-core/src/test/resources/samples/aapt2"
                    ]
                else:
                    aapt2_mirrors = [
                        "https://github.com/lzhiyong/android-sdk-tools/releases/download/34.0.5/aapt2-linux-x86_64.tar.gz"
                    ]
                download_with_mirrors(aapt2_dest, aapt2_mirrors, f"aapt2 binary ({self.arch})", min_size_mb=0.5, is_binary=True)
        else:
            print(f"  • {Colors.GREEN}✔ aapt2 / aapt found: {self.get_aapt2()}{Colors.RESET}")

        # 2. android.jar (API target) — always versioned in ~/.storm/tools so 34 and 37 can coexist
        installed = self.ensure_android_jar(target_api, download=True)
        if installed and self.is_termux:
            termux_dir = Path("/data/data/com.termux/files/usr/share/java")
            try:
                termux_dir.mkdir(parents=True, exist_ok=True)
                termux_jar = termux_dir / "android.jar"
                if Path(installed).resolve() != termux_jar.resolve():
                    shutil.copy2(installed, termux_jar)
            except Exception:
                pass

        # 3. r8.jar
        r8_dest = self.tools_dir / "r8.jar"
        r8_mirrors = [
            "https://storage.googleapis.com/r8-releases/raw/main/r8.jar",
            "https://repo1.maven.org/maven2/com/android/tools/r8/8.2.33/r8-8.2.33.jar",
            "https://maven.google.com/com/android/tools/r8/8.2.33/r8-8.2.33.jar"
        ]
        download_with_mirrors(r8_dest, r8_mirrors, "r8.jar (Dexer & Shrinker)", min_size_mb=10.0)

        # 4. apksigner (if not found in system)
        if not self.get_apksigner()[0] or self.get_apksigner()[1] == "jarsigner":
            if shutil.which("apt-get"):
                try:
                    subprocess.run(["apt-get", "install", "-y", "-qq", "apksigner"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except Exception:
                    pass

            if not self.get_apksigner()[0] or self.get_apksigner()[1] == "jarsigner":
                apksigner_dest = self.tools_dir / "apksigner.jar"
                apksigner_mirrors = [
                    "https://repo1.maven.org/maven2/com/android/tools/build/apksigner/8.2.2/apksigner-8.2.2.jar",
                    "https://maven.google.com/com/android/tools/build/apksigner/8.2.2/apksigner-8.2.2.jar"
                ]
                download_with_mirrors(apksigner_dest, apksigner_mirrors, "apksigner.jar (v2/v3 Signature)", min_size_mb=1.0)
        else:
            print(f"  • {Colors.GREEN}✔ apksigner found: {self.get_apksigner()[0]}{Colors.RESET}")

        # 5. bundletool.jar
        bt_dest = self.tools_dir / "bundletool.jar"
        bt_mirrors = [
            "https://github.com/google/bundletool/releases/download/1.17.0/bundletool-all-1.17.0.jar",
            "https://repo1.maven.org/maven2/com/android/tools/build/bundletool/1.17.0/bundletool-1.17.0-all.jar",
            "https://maven.google.com/com/android/tools/build/bundletool/1.17.0/bundletool-1.17.0-all.jar"
        ]
        download_with_mirrors(bt_dest, bt_mirrors, "bundletool.jar (AAB Builder)", min_size_mb=10.0)

        return True

    def run_doctor(self) -> Dict[str, any]:
        """Run complete environment inspection and generate diagnosis."""
        report = {
            "os": self.os,
            "arch": self.arch,
            "is_termux": self.is_termux,
            "java_runtime": self.find_executable("java"),
            "java_compiler": self.get_java_compiler(),
            "aapt2": self.get_aapt2(),
            "dexer": self.get_dexer(),
            "zipalign": self.get_zipalign(),
            "zipalign_fallback": True,
            "apksigner": self.get_apksigner(),
            "bundletool": self.get_bundletool(),
            "android_jar": self.find_android_jar(),
        }
        return report
