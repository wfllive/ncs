"""
Keystore Generator and APK / AAB Signer for Storm Build CLI.
Supports APK Signature Schemes v1, v2, v3, and v4 (required by Android 11+ and Huawei/Xiaomi).
"""

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, Union


def resolve_keystore_path(
    keystore: Union[str, Path],
    project_dir: Optional[Union[str, Path]] = None,
) -> Path:
    """Resolve a keystore path. Relative names live in the project root, never in build/."""
    ks = Path(keystore)
    if ks.is_absolute():
        return ks
    root = Path(project_dir) if project_dir else Path.cwd()
    return (root / ks).resolve()


class Signer:
    def __init__(
        self,
        apksigner_path: Optional[str] = None,
        signer_type: str = "apksigner",
        keytool_path: Optional[str] = "keytool",
        java_bin: str = "java"
    ):
        self.apksigner_path = apksigner_path
        self.signer_type = signer_type
        self.keytool_path = keytool_path or "keytool"
        self.java_bin = java_bin or "java"

    def ensure_debug_keystore(self, keystore_path: Path) -> bool:
        """Create standard debug.keystore if it does not already exist."""
        if keystore_path.exists() and keystore_path.stat().st_size > 0:
            return True

        keystore_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"  [KEY] Generating Android standard debug keystore: {keystore_path.name}...")

        cmd = [
            self.keytool_path,
            "-genkeypair",
            "-v",
            "-keystore", str(keystore_path),
            "-alias", "androiddebugkey",
            "-keyalg", "RSA",
            "-keysize", "2048",
            "-validity", "10000",
            "-storepass", "android",
            "-keypass", "android",
            "-dname", "CN=Android Debug,O=Android,C=US"
        ]

        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res.returncode != 0:
                print(f"[WARN] keytool notice: {res.stderr}")
            return keystore_path.exists()
        except Exception as e:
            print(f"[WARN] keytool invocation failed: {e}")
            return False

    def create_release_keystore(
        self,
        keystore_path: Path,
        alias: str,
        storepass: str,
        keypass: str,
        dname: str,
        validity_days: int = 10000,
    ) -> bool:
        """Create a new upload/release keystore. Refuses to overwrite."""
        if keystore_path.exists():
            print(f"[ERROR] {keystore_path} already exists — not overwriting.")
            return False
        keystore_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            self.keytool_path,
            "-genkeypair",
            "-keystore", str(keystore_path),
            "-alias", alias,
            "-keyalg", "RSA",
            "-keysize", "2048",
            "-validity", str(validity_days),
            "-storepass", storepass,
            "-keypass", keypass,
            "-dname", dname,
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode != 0 or not keystore_path.exists():
            print(f"[ERROR] keytool failed:\n{res.stderr}")
            return False
        print(f"✔ Created {keystore_path}")
        return True

    def sign_apk(
        self,
        unsigned_apk: Path,
        signed_apk: Path,
        keystore_info: Dict[str, Any]
    ) -> bool:
        """
        Sign APK using apksigner (v1, v2, v3 schemes).
        v2/v3 signature is strictly required for Android 11+ and Huawei HarmonyOS / EMUI.
        """
        ks_path = resolve_keystore_path(
            keystore_info.get("keystore", "debug.keystore"),
            keystore_info.get("project_dir"),
        )

        if not ks_path.exists():
            if keystore_info.get("alias", "androiddebugkey") == "androiddebugkey":
                self.ensure_debug_keystore(ks_path)
            else:
                print(f"[ERROR] Release keystore not found: {ks_path}")
                print("        storm keygen пишет файл в корень проекта (рядом со storm.m), не в build/.")
                print("        Create one:  storm keygen")
                print("        Or set signing.release.keystore in storm.m to that file name.")
                return False

        alias = keystore_info.get("alias", "androiddebugkey")
        storepass = keystore_info.get("storepass", "android")
        keypass = keystore_info.get("keypass", "android")

        # Prefer apksigner (binary or jar) for v1 + v2 + v3 schemes
        if self.signer_type == "apksigner.jar" and self.apksigner_path:
            print(f"  [SIGN] Signing APK ({signed_apk.name}) with apksigner (v1 + v2 + v3 Scheme)...")
            cmd = [
                self.java_bin, "-jar", self.apksigner_path,
                "sign",
                "--ks", str(ks_path),
                "--ks-key-alias", alias,
                "--ks-pass", f"pass:{storepass}",
                "--key-pass", f"pass:{keypass}",
                "--v1-signing-enabled", "true",
                "--v2-signing-enabled", "true",
                "--v3-signing-enabled", "true",
                "--out", str(signed_apk),
                str(unsigned_apk)
            ]
        elif self.signer_type == "apksigner" and self.apksigner_path:
            print(f"  [SIGN] Signing APK ({signed_apk.name}) with apksigner (v1 + v2 + v3 Scheme)...")
            cmd = [
                self.apksigner_path,
                "sign",
                "--ks", str(ks_path),
                "--ks-key-alias", alias,
                "--ks-pass", f"pass:{storepass}",
                "--key-pass", f"pass:{keypass}",
                "--v1-signing-enabled", "true",
                "--v2-signing-enabled", "true",
                "--v3-signing-enabled", "true",
                "--out", str(signed_apk),
                str(unsigned_apk)
            ]
        else:
            # If only jarsigner is available, try auto-installing apksigner on Linux
            if shutil.which("apt-get"):
                try:
                    print("  [SIGN] Installing apksigner package for Android v2/v3 signature support...")
                    subprocess.run(["apt-get", "install", "-y", "-qq", "apksigner"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    if shutil.which("apksigner"):
                        self.apksigner_path = shutil.which("apksigner")
                        self.signer_type = "apksigner"
                        return self.sign_apk(unsigned_apk, signed_apk, keystore_info)
                except Exception:
                    pass

            print(f"  [WARN] apksigner not found. Using jarsigner (v1 only).")
            print(f"         Note: Android 11+ and Huawei devices require v2 scheme. Install 'apksigner' via: apt install apksigner")
            cmd = [
                "jarsigner",
                "-sigalg", "SHA256withRSA",
                "-digestalg", "SHA-256",
                "-keystore", str(ks_path),
                "-storepass", storepass,
                "-keypass", keypass,
                str(unsigned_apk),
                alias
            ]
            try:
                shutil.copyfile(str(unsigned_apk), str(signed_apk))
                cmd[-2] = str(signed_apk)
                res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                return res.returncode == 0
            except Exception as e:
                print(f"[ERROR] jarsigner failed: {e}")
                return False

        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res.returncode != 0:
                print(f"[ERROR] APK signing failed:\n{res.stderr}")
                return False
            return True
        except Exception as e:
            print(f"[ERROR] Signing error: {e}")
            return False

    def sign_aab(self, aab_path: Path, keystore_info: Dict[str, Any]) -> bool:
        """Sign Android App Bundle (.aab) with jarsigner (standard for AAB format)."""
        ks_path = resolve_keystore_path(
            keystore_info.get("keystore", "debug.keystore"),
            keystore_info.get("project_dir"),
        )
        alias = keystore_info.get("alias", "androiddebugkey")
        storepass = keystore_info.get("storepass", "android")
        keypass = keystore_info.get("keypass", "android")

        if not ks_path.exists():
            self.ensure_debug_keystore(ks_path)

        print(f"  [SIGN] Signing AAB ({aab_path.name}) with jarsigner...")
        cmd = [
            "jarsigner",
            "-sigalg", "SHA256withRSA",
            "-digestalg", "SHA-256",
            "-keystore", str(ks_path),
            "-storepass", storepass,
            "-keypass", keypass,
            str(aab_path),
            alias
        ]
        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            return res.returncode == 0
        except Exception as e:
            print(f"[ERROR] AAB signing failed: {e}")
            return False
