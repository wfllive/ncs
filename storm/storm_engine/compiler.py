"""
Java and Kotlin compiler for Storm Build.

Java: javac or ecj → 1.8 bytecode.
Kotlin: kotlinc if any .kt files exist. kotlinc is found on PATH or
downloaded into ~/.storm/tools/kotlinc. kotlin-stdlib from that install
is added to the dex classpath (no -include-runtime — that is for JVM fat jars).
"""

import os
import subprocess
from pathlib import Path
from typing import List, Optional, Dict

from .env import Colors


def collect_sources(src_dirs: List[Path], gen_dir: Optional[Path], ext: str) -> List[str]:
    seen: Dict[str, str] = {}
    roots = list(src_dirs)
    if gen_dir is not None and gen_dir.exists():
        roots.append(gen_dir)
    for sdir in roots:
        if not sdir.exists():
            continue
        for root, _, files in os.walk(str(sdir)):
            for f in files:
                if f.endswith(ext):
                    full = os.path.join(root, f)
                    rel = os.path.relpath(full, str(sdir))
                    seen.setdefault(rel, full)
    return list(seen.values())


class Compiler:
    def __init__(
        self,
        javac_path: Optional[str] = "javac",
        compiler_type: str = "javac",
        kotlinc_path: Optional[str] = None,
        kotlin_stdlib_jars: Optional[List[Path]] = None,
    ):
        self.javac_path = javac_path or "javac"
        self.compiler_type = compiler_type
        self.kotlinc_path = kotlinc_path
        self.kotlin_stdlib_jars = list(kotlin_stdlib_jars or [])
        self.extra_jars: List[Path] = []

    def compile(
        self,
        src_dirs: List[Path],
        gen_dir: Path,
        classpath_jars: List[Path],
        android_jar: Path,
        out_dir: Path,
        java_version: str = "1.8",
    ) -> bool:
        out_dir.mkdir(parents=True, exist_ok=True)
        java_files = collect_sources(src_dirs, gen_dir, ".java")
        kt_files = collect_sources(src_dirs, None, ".kt")

        cp_elements = [str(android_jar)] + [str(j) for j in classpath_jars if j.exists()]
        cp_str = os.pathsep.join(cp_elements)

        if kt_files:
            if not self.kotlinc_path:
                print(f"{Colors.RED}[ERROR] Found {len(kt_files)} .kt file(s) but kotlinc is missing.{Colors.RESET}")
                print("        Install Kotlin (pkg install kotlin) or run: storm setup --kotlin")
                return False
            if not self._compile_kotlin(kt_files, java_files, cp_str, out_dir):
                return False
            self.extra_jars = [p for p in self.kotlin_stdlib_jars if p.exists()]
            for jar in self.extra_jars:
                if str(jar) not in cp_elements:
                    cp_elements.append(str(jar))
            cp_str = os.pathsep.join(cp_elements)

        if not java_files and not kt_files:
            print("[WARN] No .java or .kt files found to compile.")
            return True

        if not java_files:
            return True

        src_list = out_dir.parent / "javac_sources.txt"
        with open(src_list, "w", encoding="utf-8") as f:
            for p in java_files:
                f.write(p.replace("\\", "/") + "\n")

        if self.compiler_type == "ecj":
            cmd = [
                self.javac_path,
                "-source", "1.8",
                "-target", "1.8",
                "-encoding", "UTF-8",
                "-cp", cp_str + os.pathsep + str(out_dir),
                "-d", str(out_dir),
                f"@{src_list}",
            ]
        else:
            cmd = [
                self.javac_path,
                "-source", "1.8",
                "-target", "1.8",
                "-encoding", "UTF-8",
                "-bootclasspath", str(android_jar),
                "-cp", cp_str + os.pathsep + str(out_dir),
                "-d", str(out_dir),
                f"@{src_list}",
            ]

        print(f"  [JAVAC] Compiling {len(java_files)} Java file(s) ({self.compiler_type}, target 1.8)...")
        try:
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if result.returncode != 0:
                fallback_cmd = [
                    self.javac_path,
                    "-source", "1.8",
                    "-target", "1.8",
                    "-encoding", "UTF-8",
                    "-cp", cp_str + os.pathsep + str(out_dir),
                    "-d", str(out_dir),
                ] + java_files
                fb_res = subprocess.run(fallback_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                if fb_res.returncode == 0:
                    return True
                print(f"[ERROR] Java compilation failed:\\n{result.stderr}\\n{fb_res.stderr}")
                return False
            return True
        except Exception as e:
            print(f"[ERROR] Could not invoke compiler {self.javac_path}: {e}")
            return False

    def _compile_kotlin(self, kt_files: List[str], java_files: List[str], cp_str: str, out_dir: Path) -> bool:
        """kotlinc .kt (+ .java stubs so Kotlin can see Java types)."""
        argfile = out_dir.parent / "kotlinc.args"
        args = [
            "-jvm-target", "1.8",
            "-classpath", cp_str,
            "-d", str(out_dir),
        ]
        args.extend(kt_files)
        # Java sources as stubs (kotlinc does not emit .class for them).
        args.extend(java_files)
        with open(argfile, "w", encoding="utf-8") as f:
            for item in args:
                f.write(item.replace("\\", "/") + "\n")

        print(f"  [KOTLIN] Compiling {len(kt_files)} .kt file(s) (jvm-target 1.8)...")
        cmd = [self.kotlinc_path, f"@{argfile}"]
        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res.returncode != 0:
                # Some Termux kotlinc builds ignore @argfile.
                res = subprocess.run(
                    [self.kotlinc_path, "-jvm-target", "1.8", "-classpath", cp_str, "-d", str(out_dir)]
                    + kt_files + java_files,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                )
            if res.returncode != 0:
                print(f"[ERROR] Kotlin compilation failed:\\n{res.stderr or res.stdout}")
                return False
            return True
        except Exception as e:
            print(f"[ERROR] Could not invoke kotlinc: {e}")
            return False
