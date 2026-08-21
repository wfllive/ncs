"""
Command Line Interface (CLI) for Storm Build Toolchain.
"""

import sys
import os
import shutil
import argparse
import getpass
from pathlib import Path
from typing import Optional

from . import __version__ as VERSION
from .env import Toolchain, Colors, get_arch, get_os, is_termux
from .config import ProjectConfig
from .manifest import CONFIG_NAME, find_project_config
from .packager import Packager
from .plugin import (
    effective_version,
    install_plugin,
    latest_remote_version,
    print_plugin_status,
    sync_plugin,
)
from .templates import TEMPLATES, create_project_from_template
from .deps import DependencyManager
from .signer import Signer
from .zipalign import align_apk, verify_alignment

DONATE_URL = "https://boosty.to/wfllive/donate"
DOCS_URL = "https://wfllive.github.io/Storm-Build/"
CHAT_URL = "https://t.me/wfllive_chat_base"


def print_donate():
    print(f"  💬 Chat / help:   {Colors.CYAN}{CHAT_URL}{Colors.RESET}")
    print(f"  📘 Docs:          {Colors.CYAN}{DOCS_URL}{Colors.RESET}")
    print(f"  ❤  Support Storm: {Colors.CYAN}{DONATE_URL}{Colors.RESET}")


def load_project_config(required: bool = True) -> Optional[ProjectConfig]:
    """Load storm.m (or legacy storm.json) from this directory or a parent."""
    found = find_project_config()
    if not found:
        if required:
            print(
                f"{Colors.RED}[ERROR] {CONFIG_NAME} not found. "
                f"Run this inside a Storm project (`storm init`).{Colors.RESET}"
            )
        return None
    return ProjectConfig(str(found))


def _sync_from_config(cfg: ProjectConfig):
    sync_plugin(
        cfg.plugin_version,
        source=cfg.plugin_source,
        auto=cfg.plugin_auto_update,
        reexec=True,
    )


def print_banner():
    banner = f"""{Colors.CYAN}{Colors.BOLD}
  ⚡ STORM BUILD 2026  v{VERSION} ⚡
  Custom Android APK & AAB Builder without Gradle
  Architecture: {get_arch()} | Platform: {get_os()}
{Colors.RESET}"""
    print(banner)
    print_donate()
    print()


def cmd_doctor(args):
    """Diagnose toolchain, architecture, and required dependencies."""
    tc = Toolchain()
    rep = tc.run_doctor()

    print(f"\n{Colors.BOLD}=== System & Toolchain Diagnosis ==={Colors.RESET}\n")
    print(f"  🖥️  Operating System:    {Colors.GREEN if not rep['is_termux'] else Colors.CYAN}{rep['os']}{Colors.RESET}")
    print(f"  ⚙️  CPU Architecture:    {Colors.GREEN}{rep['arch']}{Colors.RESET}")
    print(f"  📱 Termux Environment:  {'Yes (Android CLI)' if rep['is_termux'] else 'No (Standard OS)'}")
    print("-" * 50)
    
    # Java Runtime
    if rep['java_runtime']:
        print(f"  ☕ Java Runtime:        {Colors.GREEN}✔ {rep['java_runtime']}{Colors.RESET}")
    else:
        print(f"  ☕ Java Runtime:        {Colors.RED}✘ Not found{Colors.RESET}")

    # Java Compiler
    comp_path, comp_type = rep['java_compiler']
    if comp_path:
        print(f"  🔨 Java Compiler:       {Colors.GREEN}✔ {comp_type} ({comp_path}){Colors.RESET}")
    else:
        print(f"  🔨 Java Compiler:       {Colors.RED}✘ Neither javac nor ecj found{Colors.RESET}")

    # Android.jar
    if rep['android_jar']:
        print(f"  📦 Android Platform:    {Colors.GREEN}✔ {rep['android_jar']}{Colors.RESET}")
    else:
        print(f"  📦 Android Platform:    {Colors.RED}✘ android.jar not found{Colors.RESET}")
    tools_dir = Path.home() / ".storm" / "tools"
    installed = sorted(tools_dir.glob("android-*.jar")) if tools_dir.exists() else []
    if installed:
        names = ", ".join(p.name for p in installed)
        print(f"  📚 Cached platforms:    {names}  ({tools_dir})")

    # AAPT2
    if rep['aapt2']:
        print(f"  🎨 AAPT2 (Resources):   {Colors.GREEN}✔ {rep['aapt2']}{Colors.RESET}")
    else:
        print(f"  🎨 AAPT2 (Resources):   {Colors.RED}✘ Not found{Colors.RESET}")

    # Dexer
    dex_path, dex_type = rep['dexer']
    if dex_path:
        print(f"  ⚡ Dexer / R8:          {Colors.GREEN}✔ {dex_type} ({dex_path}){Colors.RESET}")
    else:
        print(f"  ⚡ Dexer / R8:          {Colors.RED}✘ Not found (d8, r8, or d8.jar required){Colors.RESET}")

    # ZipAlign
    if rep['zipalign']:
        print(f"  📐 ZipAlign Binary:     {Colors.GREEN}✔ {rep['zipalign']}{Colors.RESET}")
    else:
        print(f"  📐 ZipAlign Binary:     {Colors.YELLOW}✔ Built-in Pure-Python ZipAligner (Active){Colors.RESET}")

    # Apksigner
    sig_path, sig_type = rep['apksigner']
    if sig_path:
        print(f"  🔏 APK Signer:          {Colors.GREEN}✔ {sig_type} ({sig_path}){Colors.RESET}")
    else:
        print(f"  🔏 APK Signer:          {Colors.RED}✘ apksigner / jarsigner not found{Colors.RESET}")

    # BundleTool
    if rep['bundletool']:
        print(f"  📦 BundleTool (.aab):   {Colors.GREEN}✔ {rep['bundletool']}{Colors.RESET}")
    else:
        print(f"  📦 BundleTool (.aab):   {Colors.YELLOW}✘ Not configured (needed only for .aab bundles){Colors.RESET}")

    print("\n" + "=" * 50)
    cfg = load_project_config(required=False)
    print(f"  🔌 Storm plugin:        {Colors.GREEN}{effective_version()}{Colors.RESET}")
    if cfg:
        print(f"  📄 Project manifest:    {cfg.path.name}  (plugin {cfg.plugin_version})")
    if rep['is_termux'] or rep['arch'] in ('aarch64', 'arm64', 'armv7'):
        print(f"\n{Colors.BOLD}{Colors.CYAN}💡 Tips for Termux / ARM64:{Colors.RESET}")
        print("  1. Install native packages:  pkg install openjdk-17 aapt apksigner ecj python")
        print("  2. Place android.jar in:     $PREFIX/share/java/android.jar  OR  export ANDROID_JAR=/path/to/android.jar")
        print("  3. Download JAR tools:       Place r8.jar / bundletool.jar into ~/.storm/tools/")
    else:
        print(f"\n{Colors.BOLD}{Colors.CYAN}💡 Tips for Linux / macOS / Windows:{Colors.RESET}")
        print("  1. Ensure ANDROID_HOME or ANDROID_SDK_ROOT is set in environment.")
        print("  2. Ensure JDK 17+ is installed (javac in PATH).")
    print()
    print_donate()


def cmd_init(args):
    """Create a new project from template."""
    proj_dir = Path(args.name).resolve()
    if proj_dir.exists() and any(proj_dir.iterdir()):
        print(f"{Colors.RED}[ERROR] Directory '{args.name}' already exists and is not empty.{Colors.RESET}")
        return 1

    template = args.template or "minimal"
    package = args.package or f"com.example.{args.name.lower().replace('-', '_').replace(' ', '_')}"
    app_name = args.name

    print(f"Creating project '{app_name}' from template '{template}'...")
    if create_project_from_template(template, proj_dir, package, app_name):
        print(f"\n{Colors.GREEN}✔ Project initialized successfully at: {proj_dir}{Colors.RESET}")
        print(f"\n  layout   {CONFIG_NAME}   app/src   app/res   app/assets   app/jniLibs")
        print(f"\nNext steps:")
        print(f"  cd {args.name}")
        print(f"  storm build apk")
        print()
        print_donate()
        return 0
    return 1


def cmd_templates(args):
    """List available templates."""
    print(f"\n{Colors.BOLD}Available Project Templates:{Colors.RESET}\n")
    print(f"  1. {Colors.CYAN}minimal{Colors.RESET}     - Standard Android Java application without external dependencies.")
    print(f"  2. {Colors.CYAN}yandex-ads{Colors.RESET}  - Complete integration of Yandex Mobile Ads SDK (Banner, Interstitial, Proguard).")
    print(f"  3. {Colors.CYAN}native-game{Colors.RESET} - OpenGL ES C++/Java Game engine starter with assets and multi-ABI support.")
    print()


def cmd_deps(args):
    """Manage dependencies."""
    config = load_project_config(required=True)
    if not config:
        return 1
    _sync_from_config(config)
    if args.deps_action == "add":
        if not args.dependency:
            print(f"{Colors.RED}[ERROR] Please specify maven coordinate or file to add.{Colors.RESET}")
            return 1
        config.add_dependency(args.dependency)
        print(f"{Colors.GREEN}✔ Added dependency '{args.dependency}' to {config.path.name}.{Colors.RESET}")
        return 0
    elif args.deps_action == "fetch":
        print(f"Fetching dependencies for '{config.name}'...")
        mgr = DependencyManager(str(config.root_dir), config.repositories)
        mgr.prepare_all_dependencies(config.dependencies, resolve=True, refresh=True)
        print(f"{Colors.GREEN}✔ All dependencies downloaded and cached in ~/.storm/cache ({mgr.lock_path().name} updated).{Colors.RESET}")
        return 0
    return 0


def cmd_build(args):
    """Build APK or AAB."""
    config = load_project_config(required=True)
    if not config:
        return 1
    _sync_from_config(config)

    toolchain = Toolchain(str(config.root_dir))
    packager = Packager(config, toolchain)

    flavor_name = getattr(args, "flavor", None)
    if flavor_name:
        try:
            config.apply_flavor(flavor_name)
        except ValueError as exc:
            print(f"{Colors.RED}[ERROR] {exc}{Colors.RESET}")
            return 1
        print(f"  [FLAVOR] {flavor_name}  package={config.package}  version={config.version_name}")

    if args.clean:
        packager.clean()

    packager.refresh_deps = bool(getattr(args, "refresh_deps", False))

    # Determine R8 usage: flag override > config default
    use_r8 = config.use_r8
    if getattr(args, 'r8', False):
        use_r8 = True
    elif getattr(args, 'd8', False):
        use_r8 = False

    if args.target == "apk":
        res = packager.build_apk(release=args.release, use_r8=use_r8)
        return 0 if res else 1
    elif args.target == "aab":
        res = packager.build_aab(release=args.release, use_r8=use_r8)
        return 0 if res else 1
    else:
        print(f"{Colors.RED}[ERROR] Unknown build target '{args.target}'. Use 'apk' or 'aab'.{Colors.RESET}")
        return 1


def cmd_zipalign(args):
    """Pure-Python ZipAlign CLI tool."""
    src = args.input
    dst = args.output
    align = args.align or 4
    print(f"Aligning {src} -> {dst} (alignment={align})...")
    align_apk(src, dst, alignment=align, page_align_so=True)
    is_ok, misaligned = verify_alignment(dst, alignment=align)
    if is_ok:
        print(f"{Colors.GREEN}✔ Zip alignment successful and verified.{Colors.RESET}")
        return 0
    else:
        print(f"{Colors.RED}✘ Alignment check failed: {misaligned}{Colors.RESET}")
        return 1


def cmd_setup(args):
    """Download essential cross-platform tools (android.jar, r8.jar, bundletool.jar) and configure toolchain."""
    tc = Toolchain()
    tc.setup_tools(target_api=args.api)
    if getattr(args, "kotlin", False):
        tc.ensure_kotlinc(download=True)
    print(f"\n{Colors.GREEN}✔ Setup completed. Running doctor...{Colors.RESET}")
    cmd_doctor(args)
    return 0


def cmd_logcat(args):
    """View real-time Android logcat filtered for errors and crashes."""
    import subprocess
    adb = shutil.which("adb") or "/data/data/com.termux/files/usr/bin/adb"
    if not os.path.exists(adb) and not shutil.which("adb"):
        print(f"{Colors.RED}[ERROR] adb command not found. Install adb or connect your device.{Colors.RESET}")
        return 1

    print(f"\n{Colors.CYAN}📱 Streaming Android Logcat (Errors & Crashes)... Press Ctrl+C to stop.{Colors.RESET}\n")
    pkg = args.package
    if not pkg:
        cfg = load_project_config(required=False)
        if cfg:
            pkg = cfg.package

    filter_expr = f"{pkg}:V" if pkg else "*:E"
    cmd = ["adb", "logcat", "-v", "color", "*:E", "AndroidRuntime:E", "ActivityManager:E", "System.err:W"]
    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        print("\nLogcat stopped.")
    return 0


def _ask(label: str, default: Optional[str] = None, required: bool = True) -> str:
    hint = f" [{default}]" if default else ""
    while True:
        try:
            raw = input(f"  {label}{hint}: ").strip()
        except EOFError:
            raw = ""
        if not raw and default is not None:
            raw = default
        if raw or not required:
            return raw
        print(f"  {Colors.RED}обязательное поле{Colors.RESET}")


def _ask_secret(label: str) -> str:
    while True:
        try:
            first = getpass.getpass(f"  {label}: ")
            again = getpass.getpass(f"  {label} (ещё раз): ")
        except EOFError:
            print(f"{Colors.RED}[ERROR] Нужен интерактивный терминал (или флаги --alias --storepass ...).{Colors.RESET}")
            return ""
        if len(first) < 6:
            print(f"  {Colors.RED}минимум 6 символов{Colors.RESET}")
            continue
        if first != again:
            print(f"  {Colors.RED}пароли не совпали{Colors.RESET}")
            continue
        return first


def build_certificate_dname(cn: str, org: str, country: str, ou: str = "", city: str = "", state: str = "") -> str:
    """RFC 2253-style DN for keytool -dname. CN, O, C are required."""
    cn, org, country = cn.strip(), org.strip(), country.strip().upper()
    if not cn or not org or len(country) != 2:
        raise ValueError("CN, O and 2-letter C are required")
    parts = [f"CN={cn}"]
    if ou.strip():
        parts.append(f"OU={ou.strip()}")
    parts.append(f"O={org}")
    if city.strip():
        parts.append(f"L={city.strip()}")
    if state.strip():
        parts.append(f"ST={state.strip()}")
    parts.append(f"C={country}")
    return ",".join(parts)


def cmd_keygen(args):
    """Create a release keystore. Alias, passwords and certificate fields are required."""
    cfg = load_project_config(required=True)
    if not cfg:
        return 1

    print(f"\n{Colors.BOLD}=== Release keystore ==={Colors.RESET}")
    print("  Это ключ для Google Play / RuStore. Потеряли файл или пароль — обновления в сторе нельзя.")
    print("  Пустые значения не принимаются (кроме необязательных OU / город / регион).\n")

    interactive = sys.stdin.isatty() and not bool(getattr(args, "yes", False))

    ks_name = args.keystore
    alias = args.alias
    storepass = args.storepass
    keypass = args.keypass
    dname = args.dname

    if interactive:
        if not ks_name:
            ks_name = _ask("Файл keystore", "release.keystore")
        if not alias:
            alias = _ask("Alias ключа (например upload или myapp)")
        if not storepass:
            storepass = _ask_secret("Пароль хранилища (storepass)")
            if not storepass:
                return 1
        if not keypass:
            same = _ask("Пароль ключа тот же, что у хранилища? (yes/no)", "yes", required=True).lower()
            if same in ("y", "yes", "д", "да"):
                keypass = storepass
            else:
                keypass = _ask_secret("Пароль ключа (keypass)")
                if not keypass:
                    return 1
        if not dname:
            print("  Сертификат (как в keytool -dname):")
            cn = _ask("  CN  — имя / приложение", cfg.name)
            ou = _ask("  OU  — подразделение (можно пусто)", "", required=False)
            org = _ask("  O   — организация / автор")
            city = _ask("  L   — город (можно пусто)", "", required=False)
            state = _ask("  ST  — регион (можно пусто)", "", required=False)
            country = _ask("  C   — страна, 2 буквы", "RU")
            try:
                dname = build_certificate_dname(cn, org, country, ou, city, state)
            except ValueError as exc:
                print(f"{Colors.RED}[ERROR] {exc}{Colors.RESET}")
                return 1
        validity_raw = _ask("Срок действия, дней", "10000")
        try:
            validity = max(1, int(validity_raw))
        except ValueError:
            print(f"{Colors.RED}[ERROR] Срок должен быть числом дней.{Colors.RESET}")
            return 1
    else:
        missing = [n for n, v in (
            ("--keystore", ks_name),
            ("--alias", alias),
            ("--storepass", storepass),
            ("--keypass", keypass or storepass),
            ("--dname", dname),
        ) if not v]
        if missing:
            print(f"{Colors.RED}[ERROR] Неинтерактивный режим: укажите {', '.join(missing)}.{Colors.RESET}")
            print("        Либо запустите `storm keygen` в терминале — мастер спросит сам.")
            return 1
        keypass = keypass or storepass
        validity = int(getattr(args, "validity", 10000) or 10000)

    if not alias or not storepass or not keypass or not dname or not ks_name:
        print(f"{Colors.RED}[ERROR] alias, пароли, dname и файл keystore обязательны.{Colors.RESET}")
        return 1
    if len(storepass) < 6 or len(keypass) < 6:
        print(f"{Colors.RED}[ERROR] Пароли короче 6 символов keytool не примет.{Colors.RESET}")
        return 1

    ks_path = Path(ks_name)
    if not ks_path.is_absolute():
        ks_path = cfg.root_dir / ks_path

    print(f"\n  файл     {ks_path}")
    print(f"  alias    {alias}")
    print(f"  dname    {dname}")
    print(f"  срок     {validity} дней")
    if interactive:
        ok = _ask("Создать ключ? (yes/no)", "yes").lower()
        if ok not in ("y", "yes", "д", "да"):
            print("Отменено.")
            return 1

    toolchain = Toolchain(str(cfg.root_dir))
    signer = Signer(keytool_path=toolchain.find_executable("keytool") or "keytool")

    if args.use_existing:
        if not ks_path.exists():
            print(f"{Colors.RED}[ERROR] Файл не найден: {ks_path}{Colors.RESET}")
            return 1
        print(f"Регистрирую существующий {ks_path.name} в {cfg.path.name} ...")
    else:
        if not signer.create_release_keystore(ks_path, alias, storepass, keypass, dname, validity_days=validity):
            return 1

    stored_path = ks_path.name if ks_path.parent == cfg.root_dir else str(ks_path)
    signing = cfg.data.setdefault("signing", {})
    signing["release"] = {
        "keystore": stored_path,
        "alias": alias,
        "storepass": storepass,
        "keypass": keypass,
    }
    cfg.save()
    print(f"{Colors.GREEN}✔ {cfg.path.name} signing.release → {stored_path}  alias={alias}{Colors.RESET}")
    print("  Debug-сборки по-прежнему идут с debug.keystore.")
    print("  Релиз:  storm build apk --release")
    print(f"  {Colors.YELLOW}Пароли записаны в {cfg.path.name} открытым текстом — не коммитьте этот файл в публичный репозиторий.{Colors.RESET}")
    return 0


def cmd_clean(args):
    """Remove build directory."""
    cfg = load_project_config(required=False)
    build_dir = (cfg.root_dir / "build") if cfg else Path("build")
    if build_dir.exists():
        shutil.rmtree(str(build_dir))
        print(f"{Colors.GREEN}✔ Cleaned {build_dir}.{Colors.RESET}")
    else:
        print("Build directory already clean.")
    return 0


def cmd_plugin(args):
    """Show or change the Storm plugin version pinned in storm.m."""
    cfg = load_project_config(required=False)
    required = cfg.plugin_version if cfg else None
    source = cfg.plugin_source if cfg else None

    action = getattr(args, "plugin_action", None) or "status"
    if action in (None, "status"):
        print_plugin_status(required, source)
        return 0

    if action == "set":
        version = getattr(args, "version", None)
        if not version:
            print(f"{Colors.RED}[ERROR] Usage: storm plugin set <version>{Colors.RESET}")
            return 1
        if not cfg:
            return 1
        cfg.set_plugin_version(version)
        print(f"{Colors.GREEN}✔ {cfg.path.name} plugin.storm → {version}{Colors.RESET}")
        print("  Run `storm update` (or the next build) to install it.")
        return 0

    if action == "update":
        return cmd_update(args)

    print(f"{Colors.RED}[ERROR] Unknown plugin action '{action}'.{Colors.RESET}")
    return 1


def cmd_update(args):
    """Install the Storm plugin version from storm.m (or --version / --latest)."""
    cfg = load_project_config(required=False)
    source = getattr(args, "source", None) or (cfg.plugin_source if cfg else None)
    target = getattr(args, "version", None)
    want_latest = bool(getattr(args, "latest", False))

    if want_latest or (not target and not cfg):
        remote = latest_remote_version(source)
        if not remote:
            print(f"{Colors.RED}[ERROR] Could not resolve the latest Storm version.{Colors.RESET}")
            return 1
        target = remote
        print(f"  [PLUGIN] latest on GitHub: {target}")
    elif not target and cfg:
        target = cfg.plugin_version

    if not target:
        print(f"{Colors.RED}[ERROR] No plugin version given. Use --version or edit storm.m.{Colors.RESET}")
        return 1

    if cfg and getattr(args, "pin", False):
        cfg.set_plugin_version(target)
        print(f"  [PLUGIN] pinned {target} in {cfg.path.name}")

    dest = install_plugin(target, source)
    if dest is None:
        return 1
    print(f"  running was {effective_version()}  →  now {target}")
    print("  New features from this plugin are available on the next command.")
    return 0


def main():
    parser = argparse.ArgumentParser(
        prog="storm",
        description="Storm Build: Custom Android APK & AAB Build CLI without Gradle (supports x86_64, aarch64, Termux)"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # doctor
    subparsers.add_parser("doctor", help="Check system architecture, tools, and dependencies")

    # setup
    setup_p = subparsers.add_parser("setup", help="Download toolchain (android.jar, r8, bundletool). Build also fetches android.jar for compile/target SDK automatically")
    setup_p.add_argument("--api", type=int, default=34, help="Android API level (default: 34)")
    setup_p.add_argument("--kotlin", action="store_true", help="Also download kotlinc into ~/.storm/tools")

    # logcat
    log_p = subparsers.add_parser("logcat", help="Stream Android error and crash logs from connected device")
    log_p.add_argument("-p", "--package", help="Filter by package name")

    # init
    init_p = subparsers.add_parser("init", help="Create a new project from template")
    init_p.add_argument("name", help="Project name / directory")
    init_p.add_argument("-t", "--template", default="minimal", help="Template: minimal, yandex-ads, native-game")
    init_p.add_argument("-p", "--package", help="Android package name (e.g. com.example.app)")

    # templates
    subparsers.add_parser("templates", help="List available project templates")

    # deps
    deps_p = subparsers.add_parser("deps", help="Dependency management")
    deps_p.add_argument("deps_action", choices=["add", "fetch"], help="Action: add or fetch")
    deps_p.add_argument("dependency", nargs="?", help="Maven coordinate or path (e.g. com.yandex.android:mobileads:7.4.0)")

    # build
    build_p = subparsers.add_parser("build", help="Build APK or AAB package")
    build_p.add_argument("target", choices=["apk", "aab"], default="apk", nargs="?", help="Target: apk or aab")
    build_p.add_argument("--release", action="store_true", help="Build release signed package")
    build_p.add_argument("--r8", action="store_true", help="Force R8 code optimizer & ProGuard rules (Default for deps)")
    build_p.add_argument("--d8", action="store_true", help="Force D8 raw dexer without code shrinking")
    build_p.add_argument("--clean", action="store_true", help="Clean build/ folder before building")
    build_p.add_argument("--refresh-deps", action="store_true", help="Ignore storm.lock and re-resolve/download dependencies")
    build_p.add_argument("--flavor", help="Product flavor from storm.m flavors { } (e.g. free, pro)")

    # zipalign
    zip_p = subparsers.add_parser("zipalign", help="Pure-Python ZipAlign tool")
    zip_p.add_argument("input", help="Input APK/ZIP")
    zip_p.add_argument("output", help="Output APK/ZIP")
    zip_p.add_argument("-a", "--align", type=int, default=4, help="Alignment in bytes (default: 4)")

    # keygen
    key_p = subparsers.add_parser("keygen", help="Create a release keystore or register an existing .jks/.keystore")
    key_p.add_argument("--keystore", help="Keystore path (asked interactively if omitted)")
    key_p.add_argument("--alias", help="Key alias — required (asked if omitted)")
    key_p.add_argument("--storepass", help="Keystore password — required (asked if omitted, hidden)")
    key_p.add_argument("--keypass", help="Key password — required (asked if omitted)")
    key_p.add_argument("--dname", help="Full DN, e.g. CN=MyApp,O=MyCompany,C=RU (or answer CN/O/C prompts)")
    key_p.add_argument("--validity", type=int, default=10000, help="Certificate validity in days (default: 10000)")
    key_p.add_argument("--yes", action="store_true", help="Non-interactive: all of --keystore --alias --storepass --keypass --dname must be set")
    key_p.add_argument("--use-existing", action="store_true", help="Do not create a key — only write storm.m from an existing file")

    # plugin / update
    plugin_p = subparsers.add_parser("plugin", help="Show or pin the Storm plugin version from storm.m")
    plugin_p.add_argument("plugin_action", nargs="?", default="status", choices=["status", "set", "update"], help="status (default), set <version>, update")
    plugin_p.add_argument("version", nargs="?", help="Plugin version (for set / update)")
    plugin_p.add_argument("--source", help="GitHub repo URL to download the plugin from")
    plugin_p.add_argument("--latest", action="store_true", help="Resolve the newest published version")
    plugin_p.add_argument("--pin", action="store_true", help="Write the installed version back into storm.m")

    upd_p = subparsers.add_parser("update", help="Download the Storm plugin version pinned in storm.m")
    upd_p.add_argument("--version", help="Install this version instead of the pin in storm.m")
    upd_p.add_argument("--source", help="GitHub repo URL (default: plugin.source in storm.m)")
    upd_p.add_argument("--latest", action="store_true", help="Install the newest published version")
    upd_p.add_argument("--pin", action="store_true", help="Write the installed version back into storm.m")

    # clean
    subparsers.add_parser("clean", help="Remove build directory")

    if len(sys.argv) == 1:
        print_banner()
        parser.print_help()
        sys.exit(0)

    args = parser.parse_args()

    if args.command == "doctor":
        sys.exit(cmd_doctor(args))
    elif args.command == "setup":
        sys.exit(cmd_setup(args))
    elif args.command == "logcat":
        sys.exit(cmd_logcat(args))
    elif args.command == "init":
        sys.exit(cmd_init(args))
    elif args.command == "templates":
        sys.exit(cmd_templates(args))
    elif args.command == "deps":
        sys.exit(cmd_deps(args))
    elif args.command == "build":
        sys.exit(cmd_build(args))
    elif args.command == "zipalign":
        sys.exit(cmd_zipalign(args))
    elif args.command == "keygen":
        sys.exit(cmd_keygen(args))
    elif args.command == "plugin":
        sys.exit(cmd_plugin(args))
    elif args.command == "update":
        sys.exit(cmd_update(args))
    elif args.command == "clean":
        sys.exit(cmd_clean(args))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
