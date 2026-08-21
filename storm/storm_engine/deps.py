"""
Advanced Maven Dependency Resolver and AAR/JAR Unpacker for Storm Build 2026.

Fixes the "app dies instantly with Yandex Ads / AndroidX" class of bugs:
 - Resolves parent POM + dependencyManagement + BOM imports
   (androidx.fragment without a version is no longer silently dropped)
 - Resolves Maven version ranges via maven-metadata.xml
 - Fetches transitives during prepare (build no longer depends on a prior
   `storm deps fetch` that the user may have skipped)
 - Packages only artifacts resolved for THIS project (no cache pollution)
 - Discovers library R packages from classes.jar (AAPT2 --extra-packages)
 - Collects META-INF/services for ServiceLoader-based SDKs
"""

import json
import os
import re
import ssl
import shutil
import subprocess
import zipfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Dict, Set, Optional, Tuple, Any

from .progress import ProgressBar

LOCKFILE_NAME = "storm.lock"


def normalize_version(v: str) -> str:
    """Normalize Maven version ranges like [1.6.1], [8.3.0,9.0.0), [2.5.1] into clean version."""
    if not v:
        return ""
    v = v.strip()
    if (v.startswith('[') and v.endswith(']')) or (v.startswith('(') and v.endswith(')')):
        inner = v[1:-1].strip()
        if ',' in inner:
            parts = [p.strip() for p in inner.split(',') if p.strip()]
            v = parts[0] if parts else ""
        else:
            v = inner
    elif v.startswith('[') or v.startswith('('):
        parts = [p.strip('[]() ') for p in v.split(',') if p.strip('[]() ')]
        v = parts[0] if parts else v.strip('[]()')
    return v.strip('[]() ')


def is_prerelease(v: str) -> bool:
    lower = (v or "").lower()
    return any(tag in lower for tag in ("alpha", "beta", "rc", "snapshot", "-dev", ".m1", ".m2", "-ea"))


def parse_semver(v: str) -> Tuple[int, ...]:
    """Extract numeric components for semantic version comparison."""
    parts = []
    for piece in re.findall(r'\d+', v or ""):
        parts.append(int(piece))
    return tuple(parts) if parts else (0,)


def version_sort_key(v: str) -> Tuple[int, Tuple[int, ...]]:
    """Stable releases outrank alphas: 2.5.1 > 2.12.0-alpha01."""
    return (0 if is_prerelease(v) else 1, parse_semver(v))


def is_higher_version(v1: str, v2: str) -> bool:
    """Return True if v1 is newer/higher than v2. Prefers stable over alpha."""
    return version_sort_key(v1) > version_sort_key(v2)


PLATFORM_SUFFIXES = ("-android", "-jvm")


def artifact_family_key(group: str, artifact: str) -> str:
    """Collapse AndroidX/Kotlin platform splits: tracing + tracing-android → one family."""
    base = artifact or ""
    for suf in PLATFORM_SUFFIXES:
        if base.endswith(suf):
            base = base[: -len(suf)]
            break
    return f"{group}:{base}"


def artifact_rank(info: Dict[str, str]) -> Tuple:
    """Higher is better: stable version, then -android/-jvm implementation artifact."""
    art = info.get("artifact") or ""
    plat = 1 if any(art.endswith(s) for s in PLATFORM_SUFFIXES) else 0
    return (version_sort_key(info.get("version") or "0"), plat)


def parse_artifact_and_version(filename: str) -> Tuple[str, str]:
    """Extract (artifact, version) from filename like 'core-1.13.1.aar'."""
    stem = Path(filename).stem
    m = re.match(r'^(.*?)-(\d+.*)$', stem)
    if m:
        return m.group(1), m.group(2)
    return stem, "0.0.0"


def _pom_ns(root: ET.Element) -> str:
    if "}" in root.tag:
        return root.tag.split("}")[0] + "}"
    return ""


def _text(el: Optional[ET.Element]) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def version_in_range(version: str, range_spec: str) -> bool:
    """Check whether version satisfies a Maven range like [8.3.0,9.0.0)."""
    spec = (range_spec or "").strip()
    if not spec:
        return True
    if not spec[0] in "[(" and "," not in spec:
        return version == normalize_version(spec)

    lower_inc = spec.startswith("[")
    upper_inc = spec.endswith("]")
    inner = spec.strip("[]()")
    parts = [p.strip() for p in inner.split(",")]
    lower = parts[0] if parts else ""
    upper = parts[1] if len(parts) > 1 else ""

    if lower:
        if lower_inc:
            if parse_semver(version) < parse_semver(lower):
                return False
        else:
            if parse_semver(version) <= parse_semver(lower):
                return False
    if upper:
        if upper_inc:
            if parse_semver(version) > parse_semver(upper):
                return False
        else:
            if parse_semver(version) >= parse_semver(upper):
                return False
    return True


class DependencyManager:
    def __init__(self, project_dir: str, repositories: Optional[List[str]] = None, cache_dir: Optional[str] = None):
        self.project_dir = Path(project_dir).resolve()
        if cache_dir:
            self.cache_dir = Path(cache_dir).resolve()
        else:
            self.cache_dir = Path.home() / ".storm" / "cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.libs_dir = self.project_dir / "libs"
        self.libs_dir.mkdir(parents=True, exist_ok=True)
        self.exploded_dir = self.project_dir / "build" / "exploded"

        self.repositories = repositories or [
            "https://repo1.maven.org/maven2/",
            "https://repo.maven.apache.org/maven2/",
            "https://maven.google.com/",
            "https://dl.google.com/dl/android/maven2/",
            "https://maven.yandex.ru/repository/public/",
            "https://maven.yandex.ru/artifactory/libs-release/",
        ]
        self._last_error = ""
        self.resolved_artifacts: Dict[str, Dict[str, str]] = {}
        self._visited_deps: Set[str] = set()
        self._metadata_cache: Dict[str, List[str]] = {}
        self._pom_cache: Dict[str, Path] = {}
        self._fetch_stats = {"cache": 0, "download": 0}
        self.offline = False
        self._progress: Optional[ProgressBar] = None

    def _tick(self, label: str, total: Optional[int] = None, status: str = ""):
        if not self._progress:
            return
        n = self._fetch_stats["cache"] + self._fetch_stats["download"]
        self._progress.update(
            current=n,
            total=total,
            label=label,
            cache=self._fetch_stats["cache"],
            downloaded=self._fetch_stats["download"],
            status=status,
        )

    def parse_coordinate(self, coord: str) -> Optional[Dict[str, str]]:
        """Parse 'group:artifact:version' or 'group:artifact:version@aar' with range normalization."""
        coord = coord.strip()
        if not coord or coord.startswith("#"):
            return None

        ext = "aar"
        if "@" in coord:
            coord, ext = coord.split("@", 1)

        parts = coord.split(":")
        if len(parts) != 3:
            return None

        raw_v = parts[2].strip()
        is_range = raw_v[:1] in "[(" or "," in raw_v
        clean_v = normalize_version(raw_v)
        return {
            "group": parts[0].strip(),
            "artifact": parts[1].strip(),
            "version": clean_v,
            "version_spec": raw_v,
            "ext": ext,
            "is_range": is_range,
        }

    def download_file(self, url: str, dest_path: Path) -> bool:
        """Download file with timeout and validation."""
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Linux; Android; StormBuildCLI/2026)"}
            )
            with urllib.request.urlopen(req, timeout=90) as response, open(dest_path, 'wb') as out_file:
                shutil.copyfileobj(response, out_file)
            if dest_path.stat().st_size <= 0:
                dest_path.unlink()
                return False
            return True
        except Exception:
            if dest_path.exists():
                dest_path.unlink()
            return False

    def _repo_urls(self) -> List[str]:
        urls = []
        for base in self.repositories:
            if not base.endswith("/"):
                base += "/"
            urls.append(base)
        return urls

    def fetch_maven_metadata_versions(self, group: str, artifact: str) -> List[str]:
        """Return available versions from maven-metadata.xml (cached)."""
        key = f"{group}:{artifact}"
        if key in self._metadata_cache:
            return self._metadata_cache[key]

        group_path = group.replace(".", "/")
        meta_path = self.cache_dir / f"{artifact}-{group.replace('.', '_')}-maven-metadata.xml"
        versions: List[str] = []

        if not meta_path.exists():
            for base_url in self._repo_urls():
                url = f"{base_url}{group_path}/{artifact}/maven-metadata.xml"
                if self.download_file(url, meta_path):
                    break

        if meta_path.exists():
            try:
                tree = ET.parse(str(meta_path))
                root = tree.getroot()
                for ver in root.findall(".//version"):
                    if ver.text:
                        versions.append(ver.text.strip())
            except Exception:
                pass

        self._metadata_cache[key] = versions
        return versions

    def resolve_version_spec(self, group: str, artifact: str, version_spec: str) -> str:
        """Pick a concrete version for a Maven version or version range."""
        spec = (version_spec or "").strip()
        if not spec or spec[:1] not in "[(" and "," not in spec:
            return normalize_version(spec)

        available = self.fetch_maven_metadata_versions(group, artifact)
        matching = [v for v in available if version_in_range(v, spec)]
        stable = [v for v in matching if not is_prerelease(v)]
        pool = stable or matching
        if pool:
            best = pool[0]
            for v in pool[1:]:
                if is_higher_version(v, best):
                    best = v
            return best
        return normalize_version(spec)

    def extract_pom_properties(self, pom_path: Path) -> Dict[str, str]:
        """Extract properties and project variables from POM XML."""
        props: Dict[str, str] = {}
        if not pom_path.exists():
            return props

        try:
            tree = ET.parse(str(pom_path))
            root = tree.getroot()
            ns = _pom_ns(root)

            g_el = root.find(f"{ns}groupId")
            if g_el is None:
                parent = root.find(f"{ns}parent")
                if parent is not None:
                    g_el = parent.find(f"{ns}groupId")
            if g_el is not None and g_el.text:
                props["project.groupId"] = g_el.text.strip()
                props["groupId"] = g_el.text.strip()

            a_el = root.find(f"{ns}artifactId")
            if a_el is not None and a_el.text:
                props["project.artifactId"] = a_el.text.strip()
                props["artifactId"] = a_el.text.strip()

            v_el = root.find(f"{ns}version")
            if v_el is None:
                parent = root.find(f"{ns}parent")
                if parent is not None:
                    v_el = parent.find(f"{ns}version")
            if v_el is not None and v_el.text:
                props["project.version"] = v_el.text.strip()
                props["version"] = v_el.text.strip()

            properties_el = root.find(f"{ns}properties")
            if properties_el is not None:
                for child in properties_el:
                    tag = child.tag.split("}")[-1]
                    if child.text:
                        props[tag] = child.text.strip()

        except Exception:
            pass

        return props

    def resolve_property_string(self, text: str, properties: Dict[str, str]) -> str:
        """Replace all ${property.name} occurrences in text."""
        if not text or "${" not in text:
            return text

        def replacer(match):
            prop_key = match.group(1).strip()
            return properties.get(prop_key, match.group(0))

        result = text
        for _ in range(5):
            if "${" not in result:
                break
            result = re.sub(r"\$\{([^}]+)\}", replacer, result)

        return result

    def _ensure_pom(self, group: str, artifact: str, version: str) -> Optional[Path]:
        """Download a POM into the cache if needed."""
        key = f"{group}:{artifact}:{version}"
        if key in self._pom_cache and self._pom_cache[key].exists():
            return self._pom_cache[key]

        pom_file = self.cache_dir / f"{artifact}-{version}.pom"
        if not pom_file.exists():
            group_path = group.replace(".", "/")
            for base_url in self._repo_urls():
                pom_url = f"{base_url}{group_path}/{artifact}/{version}/{artifact}-{version}.pom"
                if self.download_file(pom_url, pom_file):
                    break
        if pom_file.exists():
            self._pom_cache[key] = pom_file
            return pom_file
        return None

    def _parent_coords(self, pom_path: Path) -> Optional[Tuple[str, str, str]]:
        try:
            tree = ET.parse(str(pom_path))
            root = tree.getroot()
            ns = _pom_ns(root)
            parent = root.find(f"{ns}parent")
            if parent is None:
                return None
            g = _text(parent.find(f"{ns}groupId"))
            a = _text(parent.find(f"{ns}artifactId"))
            v = normalize_version(_text(parent.find(f"{ns}version")))
            if g and a and v:
                return g, a, v
        except Exception:
            return None
        return None

    def load_pom_context(self, pom_path: Path, depth: int = 0) -> Tuple[Dict[str, str], Dict[str, Dict[str, str]]]:
        """
        Load properties + dependencyManagement, walking parent POMs and imported BOMs.
        Returns (properties, dep_management keyed by group:artifact).
        """
        props: Dict[str, str] = {}
        dep_mgmt: Dict[str, Dict[str, str]] = {}
        if not pom_path.exists() or depth > 8:
            return props, dep_mgmt

        parent = self._parent_coords(pom_path)
        if parent:
            pg, pa, pv = parent
            parent_pom = self._ensure_pom(pg, pa, pv)
            if parent_pom is not None:
                p_props, p_mgmt = self.load_pom_context(parent_pom, depth + 1)
                props.update(p_props)
                dep_mgmt.update(p_mgmt)

        child_props = self.extract_pom_properties(pom_path)
        props.update(child_props)

        try:
            tree = ET.parse(str(pom_path))
            root = tree.getroot()
            ns = _pom_ns(root)
            dm_el = root.find(f"{ns}dependencyManagement")
            if dm_el is None:
                return props, dep_mgmt
            deps_el = dm_el.find(f"{ns}dependencies")
            if deps_el is None:
                return props, dep_mgmt

            imports: List[Tuple[str, str, str]] = []
            for dep in deps_el.findall(f"{ns}dependency"):
                g = self.resolve_property_string(_text(dep.find(f"{ns}groupId")), props)
                a = self.resolve_property_string(_text(dep.find(f"{ns}artifactId")), props)
                v_raw = self.resolve_property_string(_text(dep.find(f"{ns}version")), props)
                scope = _text(dep.find(f"{ns}scope")) or "compile"
                typ = _text(dep.find(f"{ns}type")) or "jar"
                if not g or not a:
                    continue
                if scope == "import" or typ == "pom":
                    v = normalize_version(v_raw)
                    if v and "${" not in v:
                        imports.append((g, a, v))
                    continue
                if v_raw and "${" not in v_raw:
                    dep_mgmt[f"{g}:{a}"] = {
                        "group": g,
                        "artifact": a,
                        "version": normalize_version(v_raw),
                        "version_spec": v_raw,
                        "ext": typ if typ != "pom" else "aar",
                    }

            for ig, ia, iv in imports:
                bom = self._ensure_pom(ig, ia, iv)
                if bom is not None:
                    b_props, b_mgmt = self.load_pom_context(bom, depth + 1)
                    for k, val in b_props.items():
                        props.setdefault(k, val)
                    for k, val in b_mgmt.items():
                        dep_mgmt.setdefault(k, val)
        except Exception:
            pass

        return props, dep_mgmt

    def parse_pom_dependencies(
        self,
        pom_path: Path,
        properties: Dict[str, str],
        dep_management: Optional[Dict[str, Dict[str, str]]] = None,
    ) -> List[Dict[str, str]]:
        """Parse all non-test dependencies from POM, filling versions from dependencyManagement."""
        deps_list: List[Dict[str, str]] = []
        if not pom_path.exists():
            return deps_list

        dep_management = dep_management or {}

        try:
            tree = ET.parse(str(pom_path))
            root = tree.getroot()
            ns = _pom_ns(root)

            deps_el = root.find(f"{ns}dependencies")
            if deps_el is None:
                return deps_list

            for dep in deps_el.findall(f"{ns}dependency"):
                scope_el = dep.find(f"{ns}scope")
                scope = scope_el.text.strip() if (scope_el is not None and scope_el.text) else "compile"
                if scope in ("test", "provided", "system", "import"):
                    continue

                optional_el = dep.find(f"{ns}optional")
                if optional_el is not None and optional_el.text and optional_el.text.strip().lower() == "true":
                    continue

                g_el = dep.find(f"{ns}groupId")
                a_el = dep.find(f"{ns}artifactId")
                v_el = dep.find(f"{ns}version")
                type_el = dep.find(f"{ns}type")
                ext = type_el.text.strip() if (type_el is not None and type_el.text) else ""

                if g_el is None or a_el is None:
                    continue

                g = self.resolve_property_string(g_el.text.strip() if g_el.text else "", properties)
                a = self.resolve_property_string(a_el.text.strip() if a_el.text else "", properties)
                v_raw = self.resolve_property_string(v_el.text.strip() if (v_el is not None and v_el.text) else "", properties)

                managed = dep_management.get(f"{g}:{a}")
                if (not v_raw or "${" in v_raw) and managed:
                    v_raw = managed.get("version_spec") or managed.get("version") or ""
                    if not ext:
                        ext = managed.get("ext") or ""

                v = normalize_version(v_raw)
                if not ext:
                    ext = "aar"

                if g and a and v and "${" not in v:
                    deps_list.append({
                        "group": g,
                        "artifact": a,
                        "version": v,
                        "version_spec": v_raw,
                        "ext": ext
                    })
        except Exception:
            pass

        return deps_list

    def _cached_artifact(self, artifact: str, version: str) -> Optional[Path]:
        for ext in ("aar", "jar"):
            p = self.cache_dir / f"{artifact}-{version}.{ext}"
            if p.exists() and p.stat().st_size > 0:
                return p
        return None

    def lock_path(self) -> Path:
        return self.project_dir / LOCKFILE_NAME

    def load_lock(self, dependency_list: List[str]) -> Optional[List[Dict[str, str]]]:
        """Return locked artifacts if storm.lock matches storm.m dependencies and every file is cached."""
        path = self.lock_path()
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
        if list(data.get("dependencies") or []) != list(dependency_list):
            return None
        artifacts = data.get("artifacts") or []
        if not artifacts:
            return None
        for item in artifacts:
            if not self._cached_artifact(item.get("artifact", ""), item.get("version", "")):
                return None
        return artifacts

    def save_lock(self, dependency_list: List[str]):
        artifacts = []
        for key in sorted(self.resolved_artifacts.keys()):
            info = self.resolved_artifacts[key]
            if not info.get("artifact") or not info.get("version"):
                continue
            if not self._cached_artifact(info["artifact"], info["version"]):
                continue
            artifacts.append({
                "group": info.get("group", ""),
                "artifact": info["artifact"],
                "version": info["version"],
                "ext": info.get("ext") or "aar",
            })
        payload = {
            "dependencies": list(dependency_list),
            "artifacts": artifacts,
        }
        try:
            self.lock_path().write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        except Exception as e:
            print(f"  [WARN] Could not write {LOCKFILE_NAME}: {e}")

    def fetch_maven_artifact(self, coord_str: str, resolve_transitives: bool = True, depth: int = 0) -> Optional[Path]:
        """Download artifact (.aar or .jar) and its POM dependencies recursively with conflict resolution."""
        if depth > 12:
            return None

        parsed = self.parse_coordinate(coord_str)
        if not parsed:
            return None

        group = parsed["group"]
        artifact = parsed["artifact"]
        version_spec = parsed.get("version_spec") or parsed["version"]
        version = self.resolve_version_spec(group, artifact, version_spec)
        parsed["version"] = version
        art_key = f"{group}:{artifact}"
        previous = dict(self.resolved_artifacts[art_key]) if art_key in self.resolved_artifacts else None

        if previous and not is_higher_version(version, previous["version"]):
            return self._cached_artifact(artifact, previous["version"])

        self.resolved_artifacts[art_key] = {
            "group": group,
            "artifact": artifact,
            "version": version,
            "ext": parsed.get("ext") or "aar",
        }

        dep_key = f"{group}:{artifact}:{version}"
        if dep_key in self._visited_deps:
            return self._cached_artifact(artifact, version)

        self._visited_deps.add(dep_key)
        group_path = group.replace(".", "/")

        cached_aar = self.cache_dir / f"{artifact}-{version}.aar"
        cached_jar = self.cache_dir / f"{artifact}-{version}.jar"
        pom_file = self.cache_dir / f"{artifact}-{version}.pom"

        coord_label = f"{group}:{artifact}:{version}"
        downloaded = None
        if cached_aar.exists() and cached_aar.stat().st_size > 0:
            downloaded = cached_aar
            self._fetch_stats["cache"] += 1
            self._tick(coord_label, status="cache")
        elif cached_jar.exists() and cached_jar.stat().st_size > 0:
            downloaded = cached_jar
            self._fetch_stats["cache"] += 1
            self._tick(coord_label, status="cache")
        else:
            self._tick(coord_label, status="download")
            print(f"  ↓  {coord_label}")
            errors = []
            for base_url in self._repo_urls():
                aar_url = f"{base_url}{group_path}/{artifact}/{version}/{artifact}-{version}.aar"
                if self.download_file(aar_url, cached_aar):
                    downloaded = cached_aar
                    break
                if self._last_error and "404" not in self._last_error:
                    errors.append(f"{base_url} → {self._last_error}")
                jar_url = f"{base_url}{group_path}/{artifact}/{version}/{artifact}-{version}.jar"
                if self.download_file(jar_url, cached_jar):
                    downloaded = cached_jar
                    break
                if self._last_error and "404" not in self._last_error:
                    errors.append(f"{base_url} → {self._last_error}")
            if downloaded:
                size_mb = downloaded.stat().st_size / (1024 * 1024)
                print(f"     ✔  {downloaded.name}  ({size_mb:.2f} MB)")
                self._fetch_stats["download"] += 1
            else:
                print(f"     ✘  failed to download {coord_label}")
                for err in errors[:4]:
                    print(f"        {err}")
                if not errors:
                    print("        no repository returned the file (check version / network / SSL)")
            self._tick(coord_label, status="download")

        if downloaded:
            self.resolved_artifacts[art_key]["ext"] = downloaded.suffix.lstrip(".")
        else:
            if previous:
                self.resolved_artifacts[art_key] = previous
            elif art_key in self.resolved_artifacts:
                del self.resolved_artifacts[art_key]
            if depth == 0:
                return None
            return self._cached_artifact(previous["artifact"], previous["version"]) if previous else None

        if resolve_transitives:
            if not pom_file.exists():
                for base_url in self._repo_urls():
                    pom_url = f"{base_url}{group_path}/{artifact}/{version}/{artifact}-{version}.pom"
                    if self.download_file(pom_url, pom_file):
                        break

            if pom_file.exists():
                props, dep_mgmt = self.load_pom_context(pom_file)
                sub_deps = self.parse_pom_dependencies(pom_file, props, dep_mgmt)
                for sdep in sub_deps:
                    spec = sdep.get("version_spec") or sdep["version"]
                    scoord = f"{sdep['group']}:{sdep['artifact']}:{spec}"
                    self.fetch_maven_artifact(scoord, resolve_transitives=True, depth=depth + 1)

        return downloaded

    def explode_aar(self, aar_path: Path, target_dir: Path, force: bool = False):
        """Unpack AAR archive into target directory."""
        if target_dir.exists() and not force:
            # Re-extract if the archive is newer than the exploded folder.
            try:
                if target_dir.stat().st_mtime >= aar_path.stat().st_mtime:
                    return
            except Exception:
                return
        if target_dir.exists():
            shutil.rmtree(str(target_dir), ignore_errors=True)
        target_dir.mkdir(parents=True, exist_ok=True)
        try:
            with zipfile.ZipFile(str(aar_path), 'r') as z:
                z.extractall(str(target_dir))
        except Exception as e:
            print(f"[WARN] Failed to unpack {aar_path.name}: {e}")

    def extract_r_packages_from_jar(self, jar_path: Path) -> List[str]:
        """Find library R classes inside classes.jar for AAPT2 --extra-packages."""
        packages: List[str] = []
        if not jar_path.exists():
            return packages
        try:
            with zipfile.ZipFile(str(jar_path), "r") as z:
                for name in z.namelist():
                    if name.endswith("/R.class") and not name.endswith("/R$styleable.class"):
                        pkg = name[: -len("/R.class")].replace("/", ".")
                        if pkg and pkg not in packages:
                            packages.append(pkg)
        except Exception:
            pass
        return packages

    def _collect_from_exploded(
        self,
        exp_dir: Path,
        all_jars: List[Path],
        all_res_dirs: List[Path],
        all_manifests: List[Path],
        all_proguard_rules: List[Path],
        all_jni_dirs: List[Path],
        all_assets_dirs: List[Path],
        extra_packages: List[str],
        service_dirs: List[Path],
    ):
        cls_jar = exp_dir / "classes.jar"
        if cls_jar.exists() and cls_jar not in all_jars:
            all_jars.append(cls_jar)
            for pkg in self.extract_r_packages_from_jar(cls_jar):
                if pkg not in extra_packages:
                    extra_packages.append(pkg)

        internal_libs = exp_dir / "libs"
        if internal_libs.exists():
            for ij in internal_libs.glob("*.jar"):
                if ij not in all_jars:
                    all_jars.append(ij)

        res_dir = exp_dir / "res"
        if res_dir.exists() and any(res_dir.iterdir()):
            all_res_dirs.append(res_dir)

        man = exp_dir / "AndroidManifest.xml"
        if man.exists():
            all_manifests.append(man)
            try:
                tree = ET.parse(str(man))
                pkg = tree.getroot().get("package")
                if pkg and pkg not in extra_packages:
                    extra_packages.append(pkg)
            except Exception:
                pass

        for pg_name in ["proguard.txt", "consumer-rules.pro", "proguard-rules.pro", "r8-rules.pro"]:
            pg = exp_dir / pg_name
            if pg.exists() and pg not in all_proguard_rules:
                all_proguard_rules.append(pg)

        jni_dir = exp_dir / "jni"
        if jni_dir.exists():
            all_jni_dirs.append(jni_dir)

        ast_dir = exp_dir / "assets"
        if ast_dir.exists():
            all_assets_dirs.append(ast_dir)

        for svc in (
            exp_dir / "META-INF" / "services",
            exp_dir / "classes.jar.services",
        ):
            if svc.exists() and svc not in service_dirs:
                service_dirs.append(svc)

    def collapse_resolved_families(self):
        """Keep one winner per AndroidX/Kotlin family (tracing vs tracing-android).

        Prefer the artifact that actually contains the classes (larger file,
        *-jvm / *-android) so we do not keep the empty kotlinx-coroutines-core
        stub and drop kotlinx-coroutines-core-jvm.
        """
        best: Dict[str, Dict[str, str]] = {}
        best_rank: Dict[str, Tuple] = {}
        for info in self.resolved_artifacts.values():
            fam = artifact_family_key(info.get("group", ""), info.get("artifact", ""))
            cached = self._cached_artifact(info.get("artifact", ""), info.get("version", ""))
            size = cached.stat().st_size if cached else 0
            rank = (size, artifact_rank(info))
            if fam not in best or rank > best_rank[fam]:
                best[fam] = info
                best_rank[fam] = rank
        collapsed: Dict[str, Dict[str, str]] = {}
        for info in best.values():
            collapsed[f"{info.get('group')}:{info.get('artifact')}"] = info
        dropped = len(self.resolved_artifacts) - len(collapsed)
        self.resolved_artifacts = collapsed
        if dropped > 0:
            print(f"  [DEPS] Dropped {dropped} duplicate platform split(s) (tracing / *-jvm / *-android)")

    def ensure_kotlin_runtime(self):
        """Yandex Ads ContentProviders need kotlinx-coroutines on the classpath."""
        required = (
            "kotlinx-coroutines-core-jvm",
            "kotlinx-coroutines-android",
            "kotlin-stdlib",
            "kotlin-stdlib-jdk8",
        )
        have = {info.get("artifact") for info in self.resolved_artifacts.values()}
        for name in required:
            if name in have:
                continue
            # family may already have the non-jvm stub
            family_hit = any(
                artifact_family_key(info.get("group", ""), info.get("artifact", "")).endswith(":" + name.replace("-jvm", "").replace("-android", ""))
                and (info.get("artifact") or "").endswith(("-jvm", "-android"))
                for info in self.resolved_artifacts.values()
            )
            if family_hit and name.endswith(("-jvm", "-android")):
                # still force the -jvm/-android file from cache
                pass
            best: Optional[Path] = None
            best_ver = "0"
            if not self.cache_dir.exists():
                continue
            for p in list(self.cache_dir.glob(f"{name}-*.jar")) + list(self.cache_dir.glob(f"{name}-*.aar")):
                art, ver = parse_artifact_and_version(p.name)
                if art != name:
                    continue
                if is_prerelease(ver):
                    continue
                if best is None or is_higher_version(ver, best_ver):
                    best, best_ver = p, ver
            if best is None:
                continue
            group = "org.jetbrains.kotlinx" if name.startswith("kotlinx-") else "org.jetbrains.kotlin"
            key = f"{group}:{name}"
            self.resolved_artifacts[key] = {
                "group": group,
                "artifact": name,
                "version": best_ver,
                "ext": best.suffix.lstrip("."),
            }
            print(f"  [DEPS] Restored required runtime {name}:{best_ver}")

    def dedupe_jars_by_class(self, jars: List[Path]) -> List[Path]:
        """If two JARs define the same class, keep the one from the newer artifact."""
        if len(jars) < 2:
            return jars

        class_owner: Dict[str, Tuple[Tuple, Path]] = {}
        jar_classes: Dict[Path, Set[str]] = {}
        for jar in jars:
            names: Set[str] = set()
            try:
                with zipfile.ZipFile(str(jar), "r") as z:
                    for n in z.namelist():
                        if n.endswith(".class") and not n.endswith("/"):
                            names.add(n)
            except Exception:
                continue
            jar_classes[jar] = names
            art, ver = parse_artifact_and_version(jar.parent.name if jar.name == "classes.jar" else jar.name)
            rank = (version_sort_key(ver), 1 if any(art.endswith(s) for s in PLATFORM_SUFFIXES) else 0)
            for cls in names:
                prev = class_owner.get(cls)
                if prev is None or rank > prev[0]:
                    class_owner[cls] = (rank, jar)

        winners: List[Path] = []
        skipped = 0
        for jar in jars:
            names = jar_classes.get(jar) or set()
            if not names:
                winners.append(jar)
                continue
            keep = {c for c in names if class_owner.get(c, (None, None))[1] == jar}
            if not keep:
                skipped += 1
                continue
            if keep == names:
                winners.append(jar)
                continue
            # Partial overlap: write a stripped jar with only winning classes.
            out = self.exploded_dir / "_deduped"
            out.mkdir(parents=True, exist_ok=True)
            dest = out / f"{jar.parent.name if jar.name == 'classes.jar' else jar.stem}-unique.jar"
            try:
                with zipfile.ZipFile(str(jar), "r") as src, zipfile.ZipFile(str(dest), "w") as dst:
                    for item in src.infolist():
                        if item.filename.endswith(".class") and item.filename not in keep:
                            continue
                        dst.writestr(item, src.read(item.filename))
                winners.append(dest)
                skipped += 1
            except Exception:
                winners.append(jar)
        if skipped:
            print(f"  [DEPS] Removed duplicate classes from {skipped} library JAR(s)")
        return winners

    def prepare_all_dependencies(
        self,
        dependency_list: List[str],
        resolve: bool = True,
        refresh: bool = False,
    ) -> Dict[str, Any]:
        """
        Processes dependencies strictly scoped to the project.
        If dependency_list is empty, NO cached AARs are unpacked.

        After the first successful resolve a storm.lock is written. Later builds
        reuse it (no network, no full unpack). refresh=True ignores the lock.
        """
        all_jars: List[Path] = []
        all_res_dirs: List[Path] = []
        all_manifests: List[Path] = []
        all_proguard_rules: List[Path] = []
        all_jni_dirs: List[Path] = []
        all_assets_dirs: List[Path] = []
        extra_packages: List[str] = []
        service_dirs: List[Path] = []

        fetch_ok = True
        missing_declared: List[str] = []
        locked = None
        if dependency_list and resolve and not refresh:
            locked = self.load_lock(dependency_list)

        if locked:
            print(f"  [CACHE] {len(locked)} artifacts from {LOCKFILE_NAME} — skip download")
            for item in locked:
                key = f"{item.get('group')}:{item.get('artifact')}"
                self.resolved_artifacts[key] = item
        elif dependency_list and resolve:
            print("  Resolving Maven graph (first time or storm.m dependencies changed)...")
            for dep in dependency_list:
                parsed = self.parse_coordinate(dep)
                if parsed:
                    got = self.fetch_maven_artifact(dep, resolve_transitives=True)
                    if got is None:
                        fetch_ok = False
                        missing_declared.append(dep)
                else:
                    print(f"  [LOCAL] {dep}")
            if fetch_ok and self.resolved_artifacts:
                self.save_lock(dependency_list)
            print(f"  [DEPS] Done: {self._fetch_stats['cache']} from cache, "
                  f"{self._fetch_stats['download']} downloaded.")
            if not fetch_ok:
                print("  [ERROR] Declared Maven dependencies were not downloaded.")
                print("          Check internet, or install ca-certificates / curl, then retry:")
                print("            storm build apk --refresh-deps")
                for miss in missing_declared:
                    print(f"          missing: {miss}")

        if self.resolved_artifacts:
            self.collapse_resolved_families()
            self.ensure_kotlin_runtime()

        self.exploded_dir.mkdir(parents=True, exist_ok=True)
        wanted_stems: Set[str] = set()
        if self.resolved_artifacts:
            for info in self.resolved_artifacts.values():
                wanted_stems.add(f"{info['artifact']}-{info['version']}")
            for child in list(self.exploded_dir.iterdir()):
                if child.is_dir() and child.name not in wanted_stems and not child.name.startswith("_"):
                    shutil.rmtree(str(child), ignore_errors=True)

        selected_files: List[Path] = []

        if self.resolved_artifacts:
            for art_key, info in self.resolved_artifacts.items():
                found = self._cached_artifact(info["artifact"], info["version"])
                if found:
                    selected_files.append(found)

        if dependency_list and not selected_files:
            # Offline / unit-test fallback: highest version per artifact name.
            best_by_artifact: Dict[str, Path] = {}
            if self.cache_dir.exists():
                for cached in list(self.cache_dir.glob("*.aar")) + list(self.cache_dir.glob("*.jar")):
                    art, ver = parse_artifact_and_version(cached.name)
                    if art not in best_by_artifact:
                        best_by_artifact[art] = cached
                    else:
                        _, existing_ver = parse_artifact_and_version(best_by_artifact[art].name)
                        if is_higher_version(ver, existing_ver):
                            best_by_artifact[art] = cached
            selected_files.extend(best_by_artifact.values())

        unpack_bar = ProgressBar("unpack") if selected_files else None
        for idx, path in enumerate(selected_files, 1):
            if unpack_bar:
                unpack_bar.update(idx, len(selected_files), path.name, status="unpack")
            if path.suffix.lower() == ".aar":
                exp_dir = self.exploded_dir / path.stem
                self.explode_aar(path, exp_dir)
            elif path.suffix.lower() == ".jar" and path not in all_jars:
                all_jars.append(path)
                for pkg in self.extract_r_packages_from_jar(path):
                    if pkg not in extra_packages:
                        extra_packages.append(pkg)
        if unpack_bar:
            unpack_bar.finish()

        if self.libs_dir.exists():
            for aar in self.libs_dir.glob("*.aar"):
                exp_dir = self.exploded_dir / aar.stem
                self.explode_aar(aar, exp_dir)
            for jar in self.libs_dir.glob("*.jar"):
                if jar not in all_jars:
                    all_jars.append(jar)

        if self.exploded_dir.exists():
            for exp_dir in sorted(self.exploded_dir.iterdir()):
                if not exp_dir.is_dir():
                    continue
                self._collect_from_exploded(
                    exp_dir, all_jars, all_res_dirs, all_manifests,
                    all_proguard_rules, all_jni_dirs, all_assets_dirs,
                    extra_packages, service_dirs,
                )

        # Harvest META-INF/services from plain JARs (kotlin, okhttp, etc.)
        services_out = self.exploded_dir / "_merged_services"
        if all_jars:
            merged_svc: Dict[str, List[str]] = {}
            for jar in all_jars:
                try:
                    with zipfile.ZipFile(str(jar), "r") as z:
                        for name in z.namelist():
                            if name.startswith("META-INF/services/") and not name.endswith("/"):
                                key = name.split("/")[-1]
                                try:
                                    text = z.read(name).decode("utf-8", errors="ignore")
                                except Exception:
                                    continue
                                merged_svc.setdefault(key, [])
                                for line in text.splitlines():
                                    line = line.strip()
                                    if line and not line.startswith("#") and line not in merged_svc[key]:
                                        merged_svc[key].append(line)
                except Exception:
                    pass
            if merged_svc:
                services_out.mkdir(parents=True, exist_ok=True)
                for key, lines in merged_svc.items():
                    with open(services_out / key, "w", encoding="utf-8") as f:
                        f.write("\n".join(lines) + "\n")
                if services_out not in service_dirs:
                    service_dirs.append(services_out)

        all_jars = self.dedupe_jars_by_class(all_jars)

        print(f"  [DEPS] {len(all_jars)} jars, {len(all_res_dirs)} res dirs, "
              f"{len(all_manifests)} manifests, {len(extra_packages)} R packages")

        if resolve and dependency_list and not all_jars and not all_manifests:
            fetch_ok = False

        return {
            "ok": fetch_ok,
            "jars": all_jars,
            "res_dirs": all_res_dirs,
            "manifests": all_manifests,
            "proguard_rules": all_proguard_rules,
            "jni_dirs": all_jni_dirs,
            "assets_dirs": all_assets_dirs,
            "extra_packages": extra_packages,
            "service_dirs": service_dirs,
            "resolved": dict(self.resolved_artifacts),
        }
