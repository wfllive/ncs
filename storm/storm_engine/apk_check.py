"""Lightweight post-build APK sanity check (no extra binaries required)."""

import re
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .env import Colors


def parse_badging_sdk(text: str) -> Dict[str, Optional[int]]:
    """Extract min/target SDK from `aapt dump badging` / `aapt2 dump badging`."""
    min_sdk: Optional[int] = None
    target_sdk: Optional[int] = None
    for raw in (text or "").splitlines():
        line = raw.strip()
        m_t = re.match(r"targetSdkVersion:'?(\d+)'?", line)
        m_min = re.match(r"(?:sdkVersion|minSdkVersion):'?(\d+)'?", line)
        if m_t:
            target_sdk = int(m_t.group(1))
        elif m_min:
            min_sdk = int(m_min.group(1))
    return {"min_sdk": min_sdk, "target_sdk": target_sdk}


def read_apk_sdk(apk_path: Path, aapt2: Optional[str] = None) -> Dict[str, Optional[int]]:
    """Read minSdk/targetSdk from the built APK. Prefer the aapt2 that linked it."""
    candidates: List[str] = []
    if aapt2:
        candidates.append(aapt2)
    for name in ("aapt2", "aapt"):
        found = shutil.which(name)
        if found and found not in candidates:
            candidates.append(found)
    home_aapt = Path.home() / ".storm" / "tools" / "aapt2"
    if home_aapt.exists() and str(home_aapt) not in candidates:
        candidates.append(str(home_aapt))

    for binary in candidates:
        for args in (
            [binary, "dump", "badging", str(apk_path)],
            [binary, "dump", "badging", "--include-meta-data", str(apk_path)],
        ):
            try:
                res = subprocess.run(
                    args,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=25,
                )
                parsed = parse_badging_sdk((res.stdout or "") + "\n" + (res.stderr or ""))
                if parsed["min_sdk"] is not None or parsed["target_sdk"] is not None:
                    return parsed
            except Exception:
                continue
    return {"min_sdk": None, "target_sdk": None}


def verify_apk(
    apk_path: Path,
    package: str = "",
    has_yandex: bool = False,
    aapt2: Optional[str] = None,
    min_sdk: Optional[int] = None,
    target_sdk: Optional[int] = None,
) -> Tuple[bool, List[str]]:
    """Return (ok, messages). Warnings do not fail the build unless the APK is broken."""
    notes: List[str] = []
    fatal = False
    if not apk_path.exists() or apk_path.stat().st_size < 1000:
        return False, ["APK missing or too small"]

    try:
        import zipfile
        with zipfile.ZipFile(str(apk_path), "r") as z:
            names = z.namelist()
            if z.testzip() is not None:
                return False, ["APK zip is corrupted"]
    except Exception as e:
        return False, [f"Cannot open APK: {e}"]

    if "AndroidManifest.xml" not in names:
        notes.append("missing AndroidManifest.xml")
        fatal = True
    if "resources.arsc" not in names:
        notes.append("missing resources.arsc")
        fatal = True
    dex = [n for n in names if n.startswith("classes") and n.endswith(".dex")]
    if not dex:
        notes.append("no classes*.dex")
        fatal = True
    else:
        notes.append(f"{len(dex)} DEX file(s)")

    icon = any("ic_launcher" in n for n in names)
    if icon:
        notes.append("launcher icon present")
    else:
        notes.append("no ic_launcher (home screen will show default robot)")

    signed = (
        any(n.startswith("META-INF/") and (n.endswith(".RSA") or n.endswith(".DSA") or n.endswith(".EC")) for n in names)
        or any(n.startswith("META-INF/") and n.endswith(".SF") for n in names)
    )
    if signed:
        notes.append("v1 signature block found")
    else:
        notes.append("no META-INF/*.RSA (ok if signed with v2/v3 only)")

    sdk = read_apk_sdk(apk_path, aapt2=aapt2)
    apk_min, apk_target = sdk.get("min_sdk"), sdk.get("target_sdk")
    if apk_min is not None or apk_target is not None:
        notes.append(f"APK minSdk={apk_min}  targetSdk={apk_target}")
        if min_sdk is not None and apk_min is not None and apk_min != int(min_sdk):
            notes.append(f"WARNING: APK minSdk={apk_min} != storm.m min_sdk={min_sdk}")
        if target_sdk is not None and apk_target is not None and apk_target != int(target_sdk):
            notes.append(f"WARNING: APK targetSdk={apk_target} != storm.m target_sdk={target_sdk}")
        if target_sdk is not None and apk_target is None:
            notes.append(
                "WARNING: dump did not show targetSdkVersion — "
                "do not trust /usr/bin/aapt; use ~/.storm/tools/aapt2 dump badging"
            )
    elif target_sdk is not None:
        notes.append(
            f"declared targetSdk={target_sdk} (could not dump APK; "
            f"run: ~/.storm/tools/aapt2 dump badging {apk_path})"
        )

    blob = b""
    try:
        import zipfile
        with zipfile.ZipFile(str(apk_path), "r") as z:
            for n in names:
                if n.endswith(".dex") or n.endswith(".xml"):
                    blob += z.read(n)
    except Exception:
        pass

    if b"CrashApplication" in blob:
        notes.append("CrashApplication in DEX")
    else:
        notes.append("CrashApplication string not found in DEX")

    if has_yandex:
        if b"CoroutineExceptionHandler" in blob or b"kotlinx/coroutines" in blob:
            notes.append("kotlinx.coroutines present")
        else:
            notes.append("WARNING: kotlinx.coroutines not found — Yandex Ads may crash on start")
        if b"YandexAds" in blob or b"yandex/mobile/ads" in blob:
            notes.append("Yandex Ads classes present")
        else:
            notes.append("WARNING: Yandex Ads classes not found in DEX")

    ok = not fatal
    return ok, notes


def print_apk_report(
    apk_path: Path,
    package: str = "",
    has_yandex: bool = False,
    aapt2: Optional[str] = None,
    min_sdk: Optional[int] = None,
    target_sdk: Optional[int] = None,
) -> bool:
    ok, notes = verify_apk(
        apk_path, package, has_yandex, aapt2=aapt2, min_sdk=min_sdk, target_sdk=target_sdk
    )
    print(f"\n  {Colors.BOLD}[CHECK] APK sanity{Colors.RESET}")
    for n in notes:
        warn = n.startswith("WARNING") or n.startswith("missing") or n.startswith("no classes")
        color = Colors.YELLOW if warn else Colors.GREEN
        if n.startswith("missing AndroidManifest") or n.startswith("no classes") or n.startswith("APK missing"):
            color = Colors.RED
        print(f"    {color}• {n}{Colors.RESET}")
    if not ok:
        print(f"  {Colors.RED}[CHECK] APK is not installable.{Colors.RESET}")
    return ok
