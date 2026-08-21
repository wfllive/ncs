"""
Project Configuration Manager for Storm Build CLI.

Primary file:  storm.m     (human-readable project manifest)
Legacy file:   storm.json  (still loaded if storm.m is absent)
Lock file:     storm.lock  (generated, never rewritten here)
"""

from pathlib import Path
from typing import Dict, List, Optional, Any

from .manifest import (
    CONFIG_NAME,
    find_project_config,
    load_manifest_file,
    write_manifest_file,
)


DEFAULT_CONFIG: Dict[str, Any] = {
    "name": "MyStormApp",
    "package": "com.example.stormapp",
    "version_code": 1,
    "version_name": "1.0.0",
    "min_sdk": 21,
    "target_sdk": 34,
    "compile_sdk": 34,
    "r8": False,
    "src_dirs": ["app/src"],
    "res_dirs": ["app/res"],
    "assets_dirs": ["app/assets"],
    "jni_dirs": ["app/jniLibs"],
    "manifest": "app/AndroidManifest.xml",
    "repositories": [
        "https://repo1.maven.org/maven2/",
        "https://repo.maven.apache.org/maven2/",
        "https://maven.google.com/",
        "https://dl.google.com/dl/android/maven2/",
        "https://maven.yandex.ru/repository/public/",
        "https://maven.yandex.ru/artifactory/libs-release/",
    ],
    "dependencies": [],
    "proguard_rules": ["app/proguard-rules.pro"],
    "plugin_version": "2026.2.0",
    "plugin_source": "https://github.com/wfllive/Storm-Engine-Studio",
    "plugin_auto_update": True,
    "flavors": {},
    "active_flavor": "",
    "signing": {
        "debug": {
            "keystore": "debug.keystore",
            "alias": "androiddebugkey",
            "storepass": "android",
            "keypass": "android",
        }
    },
}


class ProjectConfig:
    def __init__(self, config_path: Optional[str] = None):
        if config_path:
            self.path = Path(config_path).resolve()
        else:
            found = find_project_config()
            self.path = found.resolve() if found else (Path.cwd() / CONFIG_NAME).resolve()
        self.root_dir = self.path.parent
        self.data: Dict[str, Any] = {}
        self.load()

    def load(self):
        """Load configuration from storm.m / storm.json, or fall back to defaults."""
        if self.path.exists():
            self.data = load_manifest_file(self.path, DEFAULT_CONFIG)
        else:
            self.data = DEFAULT_CONFIG.copy()

    def save(self):
        """Save configuration back to storm.m (or storm.json if that was the source)."""
        write_manifest_file(self.path, self.data)

    @property
    def name(self) -> str:
        return self.data.get("name", "StormApp")

    @property
    def package(self) -> str:
        return self.data.get("package", "com.example.stormapp")

    @property
    def version_code(self) -> int:
        return int(self.data.get("version_code", 1))

    @property
    def version_name(self) -> str:
        return str(self.data.get("version_name", "1.0.0"))

    @property
    def min_sdk(self) -> int:
        return int(self.data.get("min_sdk", 21))

    @property
    def target_sdk(self) -> int:
        return int(self.data.get("target_sdk", 34))

    @property
    def compile_sdk(self) -> int:
        return int(self.data.get("compile_sdk", 34))

    @property
    def use_r8(self) -> bool:
        """R8 shrinking is OFF unless the project explicitly sets r8 true."""
        return bool(self.data.get("r8", False))

    @property
    def plugin_version(self) -> str:
        return str(self.data.get("plugin_version") or DEFAULT_CONFIG["plugin_version"])

    @property
    def plugin_source(self) -> str:
        return str(self.data.get("plugin_source") or DEFAULT_CONFIG["plugin_source"])

    @property
    def plugin_auto_update(self) -> bool:
        return bool(self.data.get("plugin_auto_update", True))

    @property
    def manifest_path(self) -> Path:
        p = self.data.get("manifest", "app/AndroidManifest.xml")
        return self.root_dir / p

    @property
    def src_dirs(self) -> List[Path]:
        return [self.root_dir / d for d in self.data.get("src_dirs", ["app/src"])]

    @property
    def res_dirs(self) -> List[Path]:
        return [self.root_dir / d for d in self.data.get("res_dirs", ["app/res"])]

    @property
    def assets_dirs(self) -> List[Path]:
        return [self.root_dir / d for d in self.data.get("assets_dirs", ["app/assets"])]

    @property
    def jni_dirs(self) -> List[Path]:
        return [self.root_dir / d for d in self.data.get("jni_dirs", ["app/jniLibs"])]

    @property
    def repositories(self) -> List[str]:
        return self.data.get("repositories", DEFAULT_CONFIG["repositories"])

    @property
    def dependencies(self) -> List[str]:
        return list(self.data.get("dependencies", []))

    @property
    def proguard_rules(self) -> List[Path]:
        files = self.data.get("proguard_rules", ["app/proguard-rules.pro"])
        return [self.root_dir / f for f in files if (self.root_dir / f).exists()]

    @property
    def signing(self) -> Dict[str, Any]:
        return self.data.get("signing", DEFAULT_CONFIG["signing"])

    def add_dependency(self, dep: str):
        deps = self.data.setdefault("dependencies", [])
        if dep not in deps:
            deps.append(dep)
            self.save()

    def set_plugin_version(self, version: str):
        self.data["plugin_version"] = str(version).lstrip("vV")
        self.save()

    @property
    def flavors(self) -> Dict[str, Any]:
        raw = self.data.get("flavors") or {}
        return raw if isinstance(raw, dict) else {}

    @property
    def active_flavor(self) -> str:
        return str(self.data.get("active_flavor") or "")

    def apply_flavor(self, name: str):
        """Merge a product flavor into this in-memory config. Does not save."""
        name = (name or "").strip()
        if not name:
            return
        flavors = self.flavors
        if name not in flavors:
            known = ", ".join(sorted(flavors)) or "(none)"
            raise ValueError(f"Unknown flavor '{name}'. Defined: {known}")
        spec = flavors[name] or {}
        self.data["active_flavor"] = name

        override = str(spec.get("package") or "").strip()
        suffix = str(spec.get("suffix") or spec.get("applicationIdSuffix") or "").strip()
        if override:
            self.data["package"] = override
        elif suffix:
            if not suffix.startswith("."):
                suffix = "." + suffix
            self.data["package"] = self.package + suffix

        vsuf = str(spec.get("versionSuffix") or spec.get("version_suffix") or "").strip()
        if vsuf:
            self.data["version_name"] = str(self.version_name) + vsuf

        def _extend(key: str, extra):
            base = list(self.data.get(key) or [])
            for item in extra or []:
                text = str(item).strip()
                if text and text not in base:
                    base.append(text)
            self.data[key] = base

        _extend("src_dirs", spec.get("src") or spec.get("src_dirs"))
        _extend("res_dirs", spec.get("res") or spec.get("res_dirs"))
        _extend("assets_dirs", spec.get("assets") or spec.get("assets_dirs"))
        _extend("jni_dirs", spec.get("jni") or spec.get("jni_dirs"))
        _extend("dependencies", spec.get("dependencies"))
