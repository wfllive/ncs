"""
AndroidManifest.xml and Resource Merger for Storm Build 2026.
Merges permissions, components, providers, queries, and placeholders from AAR libraries.
Always injects CrashApplication (wrapping a user Application if present) so
Yandex Ads / AppMetrica / AndroidX Startup ContentProvider crashes are caught.
"""

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Optional, Set, Tuple

ANDROID_NS = "http://schemas.android.com/apk/res/android"
TOOLS_NS = "http://schemas.android.com/tools"

ET.register_namespace("android", ANDROID_NS)
ET.register_namespace("tools", TOOLS_NS)

CRASH_APP = "com.storm.engine.crash.CrashApplication"
CRASH_ACT = "com.storm.engine.crash.CrashActivity"


def _an(name: str) -> str:
    return f"{{{ANDROID_NS}}}{name}"


def _tn(name: str) -> str:
    return f"{{{TOOLS_NS}}}{name}"


class ManifestMerger:
    def __init__(self, main_manifest_path: str, package_name: Optional[str] = None):
        self.main_path = Path(main_manifest_path)
        self.package_name = package_name
        self.tree: Optional[ET.ElementTree] = None
        self.root: Optional[ET.Element] = None
        self.permissions: Set[str] = set()
        self.components: Set[Tuple[str, str]] = set()
        self.user_application_class: Optional[str] = None
        self.load_main()

    def _fqcn(self, name: Optional[str]) -> Optional[str]:
        if not name:
            return None
        if name.startswith("."):
            return f"{self.package_name}{name}"
        if "." not in name and self.package_name:
            return f"{self.package_name}.{name}"
        return name

    def load_main(self):
        if not self.main_path.exists():
            self.root = ET.Element("manifest", {
                _an("versionCode"): "1",
                _an("versionName"): "1.0.0",
                "package": self.package_name or "com.example.stormapp"
            })
            ET.SubElement(self.root, "application", {
                _an("allowBackup"): "true",
                _an("label"): "StormApp",
                _an("supportsRtl"): "true",
                _an("usesCleartextTraffic"): "true"
            })
            self.tree = ET.ElementTree(self.root)
        else:
            with open(self.main_path, "r", encoding="utf-8") as f:
                content = f.read()
            if self.package_name:
                content = content.replace("${applicationId}", self.package_name)
                content = content.replace("${packageName}", self.package_name)

            self.tree = ET.ElementTree(ET.fromstring(content))
            self.root = self.tree.getroot()
            if self.package_name:
                self.root.set("package", self.package_name)
            else:
                self.package_name = self.root.get("package", "com.example.stormapp")

        for perm in self.root.findall("uses-permission"):
            name = perm.get(_an("name"))
            if name:
                self.permissions.add(name)

        app = self.root.find("application")
        if app is None:
            app = ET.SubElement(self.root, "application")

        existing = app.get(_an("name"))
        fq = self._fqcn(existing)
        if fq and CRASH_APP not in fq:
            self.user_application_class = fq

        # Always own the Application class so the crash handler is first.
        app.set(_an("name"), CRASH_APP)
        app.set(_an("usesCleartextTraffic"), "true")
        app.set(_an("extractNativeLibs"), "true")
        app.set(_an("requestLegacyExternalStorage"), "true")
        if not app.get(_an("hardwareAccelerated")):
            app.set(_an("hardwareAccelerated"), "true")
        if not app.get(_an("icon")):
            app.set(_an("icon"), "@mipmap/ic_launcher")
        if not app.get(_an("roundIcon")):
            app.set(_an("roundIcon"), "@mipmap/ic_launcher")

    def main_dex_keep_classes(self) -> List[str]:
        """Classes that must stay in classes.dex (Application, providers, launchers)."""
        keep = [CRASH_APP, CRASH_ACT, "com.storm.engine.crash.CrashHandler"]
        if self.user_application_class:
            keep.append(self.user_application_class)
        app = self.root.find("application") if self.root is not None else None
        if app is None:
            return keep
        for tag in ("activity", "service", "receiver", "provider"):
            for el in app.findall(tag):
                name = self._fqcn(el.get(_an("name")))
                if name:
                    keep.append(name)
        return keep

    def ensure_uses_sdk(self, min_sdk: int, target_sdk: int):
        """Write <uses-sdk> so Play/RuStore and aapt dump see the real target."""
        if self.root is None:
            return
        uses = self.root.find("uses-sdk")
        if uses is None:
            uses = ET.Element("uses-sdk")
            app = self.root.find("application")
            if app is not None:
                self.root.insert(list(self.root).index(app), uses)
            else:
                self.root.insert(0, uses)
        uses.set(_an("minSdkVersion"), str(int(min_sdk)))
        uses.set(_an("targetSdkVersion"), str(int(target_sdk)))

    def _ensure_crash_activity(self, app: ET.Element):
        for act in app.findall("activity"):
            if act.get(_an("name")) == CRASH_ACT:
                return
        crash_el = ET.Element("activity", {
            _an("name"): CRASH_ACT,
            _an("process"): ":crash",
            _an("exported"): "false",
            _an("theme"): "@android:style/Theme.DeviceDefault.NoActionBar",
            _an("excludeFromRecents"): "true",
        })
        app.append(crash_el)
        self.components.add(("activity", CRASH_ACT))

    def _merge_provider(self, main_app: ET.Element, incoming: ET.Element) -> bool:
        """Merge meta-data of androidx.startup.InitializationProvider instead of dropping it."""
        in_name = incoming.get(_an("name"))
        if not in_name:
            return False
        for existing in main_app.findall("provider"):
            if existing.get(_an("name")) != in_name:
                continue
            seen = {md.get(_an("name")) for md in existing.findall("meta-data")}
            for md in incoming.findall("meta-data"):
                md_name = md.get(_an("name"))
                if md_name and md_name not in seen:
                    existing.append(md)
                    seen.add(md_name)
            return True
        return False

    def merge_aar_manifest(self, aar_manifest_path: str):
        """Merge components from an AAR AndroidManifest.xml into the main manifest."""
        aar_path = Path(aar_manifest_path)
        if not aar_path.exists():
            return

        try:
            with open(aar_path, "r", encoding="utf-8") as f:
                content = f.read()
            if self.package_name:
                content = content.replace("${applicationId}", self.package_name)
                content = content.replace("${packageName}", self.package_name)

            aar_tree = ET.ElementTree(ET.fromstring(content))
            aar_root = aar_tree.getroot()

            for perm in aar_root.findall("uses-permission"):
                name = perm.get(_an("name"))
                if name and name not in self.permissions:
                    self.permissions.add(name)
                    self.root.insert(0, ET.Element("uses-permission", perm.attrib))

            for feat in aar_root.findall("uses-feature"):
                name = feat.get(_an("name")) or feat.get(_an("glEsVersion")) or ""
                key = ("uses-feature", name)
                if name and key not in self.components:
                    self.components.add(key)
                    self.root.insert(0, ET.Element("uses-feature", feat.attrib))

            # Package visibility (Android 11+) — required by ad SDKs
            main_queries = self.root.find("queries")
            aar_queries = aar_root.find("queries")
            if aar_queries is not None:
                if main_queries is None:
                    main_queries = ET.Element("queries")
                    self.root.append(main_queries)
                for child in list(aar_queries):
                    main_queries.append(child)

            main_app = self.root.find("application")
            if main_app is None:
                main_app = ET.SubElement(self.root, "application", {
                    _an("name"): CRASH_APP,
                    _an("usesCleartextTraffic"): "true",
                    _an("extractNativeLibs"): "true",
                })

            self._ensure_crash_activity(main_app)

            aar_app = aar_root.find("application")
            if aar_app is not None:
                # Never adopt a library Application class; we wrap the user's.
                for comp in list(aar_app):
                    tools_node = comp.get(_tn("node")) or ""
                    if tools_node.lower() == "remove":
                        continue

                    name = comp.get(_an("name"))
                    if comp.tag == "provider" and name and (comp.tag, name) in self.components:
                        self._merge_provider(main_app, comp)
                        continue

                    key = (comp.tag, name) if name else (comp.tag, str(comp.attrib))
                    if key not in self.components:
                        self.components.add(key)
                        main_app.append(comp)

        except Exception as e:
            print(f"[WARN] Error merging manifest {aar_manifest_path}: {e}")

    def save(self, output_path: str, min_sdk: Optional[int] = None, target_sdk: Optional[int] = None) -> str:
        """Write merged manifest to destination with forced package name."""
        if self.package_name:
            self.root.set("package", self.package_name)

        if min_sdk is not None and target_sdk is not None:
            self.ensure_uses_sdk(min_sdk, target_sdk)

        main_app = self.root.find("application")
        if main_app is not None:
            main_app.set(_an("name"), CRASH_APP)
            main_app.set(_an("extractNativeLibs"), "true")
            self._ensure_crash_activity(main_app)

        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        self.tree.write(str(out), encoding="utf-8", xml_declaration=True)
        return str(out)
