"""
D8 and R8 Dexing & Minification Engine for Storm Build 2026.
Puts the full argument list into an @argfile so Yandex + AndroidX classpaths
fit under ARG_MAX on Termux.

Important: Termux / AOSP `r8` is a wrapper that always starts R8.main.
A default debug build must call com.android.tools.r8.D8, otherwise Play
Services annotation classes (errorprone, SideEffectFree, …) abort the build.
"""

import os
import subprocess
from pathlib import Path
from typing import List, Optional

D8_MAIN = "com.android.tools.r8.D8"
R8_MAIN = "com.android.tools.r8.R8"


class Dexer:
    def __init__(self, dexer_path: Optional[str] = None, dexer_type: str = "d8", java_bin: str = "java"):
        self.dexer_path = dexer_path
        self.dexer_type = dexer_type
        self.java_bin = java_bin or "java"

    def find_r8_jar(self) -> Optional[str]:
        """Locate r8.jar so we can pick D8 vs R8 by main class."""
        if self.dexer_type in ("r8.jar", "d8.jar") and self.dexer_path and os.path.exists(self.dexer_path):
            return self.dexer_path
        candidates: List[Path] = []
        if self.dexer_path:
            p = Path(self.dexer_path)
            candidates.extend(
                [
                    p.parent / "r8.jar",
                    p.parent / "lib" / "r8.jar",
                    p.parent.parent / "share" / "java" / "r8.jar",
                ]
            )
        home = Path.home() / ".storm" / "tools"
        candidates.extend([home / "r8.jar", home / "d8.jar"])
        prefix = os.environ.get("PREFIX", "")
        if prefix:
            candidates.append(Path(prefix) / "share" / "java" / "r8.jar")
        candidates.append(Path("/data/data/com.termux/files/usr/share/java/r8.jar"))
        for cand in candidates:
            try:
                if cand.is_file() and cand.stat().st_size > 1000:
                    return str(cand)
            except OSError:
                continue
        return None

    def _launcher(self, is_r8: bool) -> List[str]:
        main = R8_MAIN if is_r8 else D8_MAIN
        jar = self.find_r8_jar()
        if jar:
            return [self.java_bin, "-cp", jar, main]
        if self.dexer_type == "r8" and self.dexer_path:
            # Wrapper always starts R8.main. --d8 exists on R8 2+ / 3.x.
            if is_r8:
                return [self.dexer_path]
            return [self.dexer_path, "--d8"]
        if self.dexer_path and os.path.exists(self.dexer_path):
            return [self.dexer_path]
        return ["d8"]

    def dex(
        self,
        classes_dir: Path,
        library_jars: List[Path],
        android_jar: Path,
        out_dir: Path,
        min_sdk: int = 21,
        use_r8: bool = False,
        proguard_rules: Optional[List[Path]] = None,
        release: bool = False,
        main_dex_list: Optional[Path] = None,
    ) -> bool:
        out_dir.mkdir(parents=True, exist_ok=True)

        class_files: List[str] = []
        if classes_dir.exists():
            for root, _, files in os.walk(str(classes_dir)):
                for f in files:
                    if f.endswith(".class"):
                        class_files.append(os.path.join(root, f))

        jar_files = [str(j) for j in library_jars if j.exists()]

        if not class_files and not jar_files:
            print("[ERROR] No class files or JARs to dex.")
            return False

        is_r8 = use_r8
        launcher = self._launcher(is_r8)
        flags: List[str] = ["--min-api", str(min_sdk), "--lib", str(android_jar), "--output", str(out_dir)]
        if release:
            flags.append("--release")
        if is_r8 and proguard_rules:
            for rule_file in proguard_rules:
                if rule_file.exists():
                    flags.extend(["--pg-conf", str(rule_file)])

        inputs = class_files + jar_files
        how = " ".join(launcher[-2:]) if len(launcher) >= 2 else launcher[0]
        print(f"  [{'R8' if is_r8 else 'D8'}] Dexing {len(class_files)} classes + {len(jar_files)} libs (Min API: {min_sdk})...")
        print(f"  [{'R8' if is_r8 else 'D8'}] launcher: {how}")

        argfile = out_dir / "d8.args"
        with open(argfile, "w", encoding="utf-8") as f:
            for item in flags + inputs:
                f.write(item + "\n")

        result = subprocess.run(
            launcher + [f"@{argfile}"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        if result.returncode != 0:
            # Termux system d8 may not accept @file — retry in chunks of jars.
            print("  [D8] argfile not accepted, merging libraries then retrying...")
            merged = self._merge_jars(library_jars, out_dir / "merged-libs.jar")
            compact_inputs = class_files + ([str(merged)] if merged else jar_files)
            result = subprocess.run(
                launcher + flags + compact_inputs,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )

        # Safety net: an `r8` wrapper started R8.main despite D8 mode.
        if result.returncode != 0 and (not is_r8) and self._looks_like_r8_missing_class(result.stderr):
            print("  [D8] R8.main rejected missing annotation classes — retrying with com.android.tools.r8.D8")
            jar = self.find_r8_jar()
            if jar:
                d8_launcher = [self.java_bin, "-cp", jar, D8_MAIN]
                result = subprocess.run(
                    d8_launcher + flags + (class_files + ([str(out_dir / "merged-libs.jar")] if (out_dir / "merged-libs.jar").exists() else jar_files)),
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                )

        if result.returncode != 0:
            print(f"[ERROR] Dexing failed:\n{result.stderr}")
            return False

        dex_count = len(list(out_dir.glob("classes*.dex")))
        print(f"  [D8] Produced {dex_count} DEX file(s).")
        return True

    @staticmethod
    def _looks_like_r8_missing_class(stderr: Optional[str]) -> bool:
        text = stderr or ""
        return "Missing class " in text and ("com.android.tools.r8.R8" in text or "CompilationFailedException" in text)

    def _merge_jars(self, jars: List[Path], dest: Path) -> Optional[Path]:
        """Pack library jars into one archive so the D8 command line stays short."""
        import zipfile
        seen = set()
        try:
            with zipfile.ZipFile(str(dest), "w") as out:
                for jar in jars:
                    if not jar.exists():
                        continue
                    try:
                        with zipfile.ZipFile(str(jar), "r") as src:
                            for item in src.infolist():
                                name = item.filename
                                if not name or name.endswith("/") or name in seen:
                                    continue
                                seen.add(name)
                                out.writestr(item, src.read(name))
                    except Exception:
                        continue
            if dest.exists() and dest.stat().st_size > 0:
                print(f"  [D8] Merged {len(jars)} jars → {dest.name} ({len(seen)} entries)")
                return dest
        except Exception as e:
            print(f"  [D8] Could not merge jars: {e}")
        return None
