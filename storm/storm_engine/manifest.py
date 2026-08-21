"""
storm.m — human-readable Storm project manifest.

A small indented DSL (not JSON).  storm.lock stays a generated JSON lockfile
and is never rewritten by this module.

Example
-------
    plugin {
        storm     2026.2.0
    }

    project {
        name      MyStormApp
        package   com.example.stormapp
        version   1.0.0
        code      1
    }

    sdk {
        min       21
        target    34
        compile   34
    }

    app {
        src       app/src
        res       app/res
        assets    app/assets
        jni       app/jniLibs
        manifest  app/AndroidManifest.xml
        proguard  app/proguard-rules.pro
    }
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

CONFIG_NAME = "storm.m"
LEGACY_CONFIG_NAME = "storm.json"
LOCKFILE_NAME = "storm.lock"

_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_DEP_PREFIXES = ("implementation", "api", "compile", "runtime", "provided")

# Keys that may appear more than once and become a list.
_LIST_KEYS = {
    "src",
    "res",
    "assets",
    "jni",
    "proguard",
    "src_dirs",
    "res_dirs",
    "assets_dirs",
    "jni_dirs",
    "proguard_rules",
    "repositories",
    "dependencies",
}


class ManifestError(ValueError):
    """Raised when storm.m cannot be parsed."""


def find_project_config(start: Optional[Union[str, Path]] = None, max_depth: int = 10) -> Optional[Path]:
    """Walk upwards from *start* (cwd by default) looking for storm.m, then storm.json."""
    cur = Path(start or Path.cwd()).resolve()
    if cur.is_file():
        cur = cur.parent
    for _ in range(max_depth):
        modern = cur / CONFIG_NAME
        if modern.is_file():
            return modern
        legacy = cur / LEGACY_CONFIG_NAME
        if legacy.is_file():
            return legacy
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def _strip_comment(line: str) -> str:
    out: List[str] = []
    in_str = False
    quote = ""
    i = 0
    while i < len(line):
        ch = line[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < len(line):
                out.append(line[i + 1])
                i += 2
                continue
            if ch == quote:
                in_str = False
            i += 1
            continue
        if ch in ('"', "'"):
            in_str = True
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == "#":
            break
        out.append(ch)
        i += 1
    return "".join(out).rstrip()


def _tokenize(text: str) -> List[Tuple[str, Any, int]]:
    """Return a list of (kind, value, line_no). kinds: ident, string, lbrace, rbrace."""
    tokens: List[Tuple[str, Any, int]] = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = _strip_comment(raw).strip()
        if not line:
            continue
        i = 0
        n = len(line)
        while i < n:
            ch = line[i]
            if ch.isspace():
                i += 1
                continue
            if ch == "{":
                tokens.append(("lbrace", "{", lineno))
                i += 1
                continue
            if ch == "}":
                tokens.append(("rbrace", "}", lineno))
                i += 1
                continue
            if ch in ('"', "'"):
                quote = ch
                i += 1
                buf: List[str] = []
                while i < n:
                    c = line[i]
                    if c == "\\" and i + 1 < n:
                        buf.append(line[i + 1])
                        i += 2
                        continue
                    if c == quote:
                        i += 1
                        break
                    buf.append(c)
                    i += 1
                tokens.append(("string", "".join(buf), lineno))
                continue
            j = i
            while j < n and (not line[j].isspace()) and line[j] not in "{}":
                j += 1
            tokens.append(("ident", line[i:j], lineno))
            i = j
        tokens.append(("eol", None, lineno))
    return tokens


def _coerce(raw: str) -> Any:
    low = raw.lower()
    if low in ("true", "yes", "on"):
        return True
    if low in ("false", "no", "off"):
        return False
    if re.fullmatch(r"-?\d+", raw):
        try:
            return int(raw)
        except ValueError:
            return raw
    return raw


def _is_key(tok: str) -> bool:
    return bool(_KEY_RE.match(tok))


def _parse_block(tokens: List[Tuple[str, Any, int]], idx: int) -> Tuple[Any, int]:
    mapping: Dict[str, Any] = {}
    items: List[Any] = []

    def store(key: str, value: Any):
        if key in mapping:
            existing = mapping[key]
            if isinstance(existing, list):
                existing.append(value)
            else:
                mapping[key] = [existing, value]
        elif key in _LIST_KEYS and not isinstance(value, (list, dict)):
            mapping[key] = [value]
        else:
            mapping[key] = value

    n = len(tokens)
    while idx < n:
        kind, val, lineno = tokens[idx]
        if kind == "eol":
            idx += 1
            continue
        if kind == "rbrace":
            idx += 1
            break
        if kind == "lbrace":
            raise ManifestError(f"line {lineno}: unexpected '{{'")

        # Look ahead, skipping EOLs, for a following '{' (nested block).
        look = idx + 1
        while look < n and tokens[look][0] == "eol":
            look += 1
        if look < n and tokens[look][0] == "lbrace":
            if not _is_key(str(val)):
                raise ManifestError(f"line {lineno}: invalid block name '{val}'")
            child, idx = _parse_block(tokens, look + 1)
            store(str(val), child)
            continue

        # Collect remaining tokens on this logical line as the value.
        line_vals: List[Any] = []
        idx += 1
        while idx < n and tokens[idx][0] not in ("eol", "rbrace", "lbrace"):
            vk, vv, _ = tokens[idx]
            if vk == "string":
                line_vals.append(vv)
            else:
                line_vals.append(_coerce(str(vv)))
            idx += 1

        if line_vals:
            if _is_key(str(val)):
                value: Any = line_vals[0] if len(line_vals) == 1 else " ".join(str(x) for x in line_vals)
                store(str(val), value)
            else:
                items.append(_coerce(str(val)))
                items.extend(line_vals)
        else:
            items.append(val if kind == "string" else _coerce(str(val)))

    if mapping and not items:
        return mapping, idx
    if items and not mapping:
        return items, idx
    if mapping and items:
        mapping["_items"] = items
        return mapping, idx
    return mapping, idx


def parse_storm_m(text: str) -> Dict[str, Any]:
    """Parse storm.m source into a nested dict (pretty AST)."""
    tokens = _tokenize(text)
    wrapped = [("lbrace", "{", 0)] + tokens + [("rbrace", "}", 0)]
    ast, idx = _parse_block(wrapped, 1)
    if not isinstance(ast, dict):
        raise ManifestError("storm.m root must be a set of named blocks")
    return ast


def _as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _flatten_deps(block: Any) -> List[str]:
    out: List[str] = []
    if block is None:
        return out
    if isinstance(block, list):
        for item in block:
            if item is None:
                continue
            if isinstance(item, (dict, list)):
                out.extend(_flatten_deps(item))
                continue
            text = str(item).strip()
            if text:
                out.append(text)
        return out
    if isinstance(block, dict):
        for key, val in block.items():
            if key == "_items":
                out.extend(_flatten_deps(val))
                continue
            for item in _as_list(val):
                text = str(item).strip()
                if not text:
                    continue
                if key in _DEP_PREFIXES:
                    out.append(text)
                elif _is_key(key) and ":" in text:
                    out.append(text)
                elif key not in _DEP_PREFIXES:
                    # unknown key — treat "key value" as a single coordinate if it looks like one
                    if ":" in text:
                        out.append(text)
        return out
    text = str(block).strip()
    return [text] if text else out


def _flatten_repos(block: Any) -> List[str]:
    out: List[str] = []
    if block is None:
        return out
    if isinstance(block, list):
        for item in block:
            if isinstance(item, (dict, list)):
                out.extend(_flatten_repos(item))
            else:
                text = str(item).strip()
                if text:
                    out.append(text)
        return out
    if isinstance(block, dict):
        for key, val in block.items():
            if key == "_items":
                out.extend(_flatten_repos(val))
                continue
            for item in _as_list(val):
                text = str(item).strip()
                if text:
                    out.append(text)
        return out
    text = str(block).strip()
    return [text] if text else out


def ast_to_config(ast: Dict[str, Any], defaults: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Normalize a pretty AST into the internal ProjectConfig dict."""
    data: Dict[str, Any] = dict(defaults or {})

    # Flat legacy keys (also accepted at the root of storm.m).
    for key in (
        "name",
        "package",
        "version_code",
        "version_name",
        "min_sdk",
        "target_sdk",
        "compile_sdk",
        "r8",
        "manifest",
        "plugin_version",
        "plugin_source",
        "plugin_auto_update",
    ):
        if key in ast:
            data[key] = ast[key]
    for key in ("src_dirs", "res_dirs", "assets_dirs", "jni_dirs", "proguard_rules", "repositories", "dependencies"):
        if key in ast:
            data[key] = _as_list(ast[key])
    if "signing" in ast and isinstance(ast["signing"], dict):
        data["signing"] = ast["signing"]

    plugin = ast.get("plugin") or {}
    if isinstance(plugin, dict):
        if "storm" in plugin:
            data["plugin_version"] = str(plugin["storm"])
        if "version" in plugin and "plugin_version" not in data:
            data["plugin_version"] = str(plugin["version"])
        if "source" in plugin:
            data["plugin_source"] = str(plugin["source"])
        if "auto" in plugin:
            data["plugin_auto_update"] = bool(plugin["auto"])
        if "auto_update" in plugin:
            data["plugin_auto_update"] = bool(plugin["auto_update"])
    elif isinstance(plugin, (str, int, float)):
        data["plugin_version"] = str(plugin)

    project = ast.get("project") or {}
    if isinstance(project, dict):
        if "name" in project:
            data["name"] = project["name"]
        if "package" in project:
            data["package"] = project["package"]
        if "version" in project:
            data["version_name"] = str(project["version"])
        if "version_name" in project:
            data["version_name"] = str(project["version_name"])
        if "code" in project:
            data["version_code"] = int(project["code"])
        if "version_code" in project:
            data["version_code"] = int(project["version_code"])

    sdk = ast.get("sdk") or {}
    if isinstance(sdk, dict):
        if "min" in sdk:
            data["min_sdk"] = int(sdk["min"])
        if "min_sdk" in sdk:
            data["min_sdk"] = int(sdk["min_sdk"])
        if "target" in sdk:
            data["target_sdk"] = int(sdk["target"])
        if "target_sdk" in sdk:
            data["target_sdk"] = int(sdk["target_sdk"])
        if "compile" in sdk:
            data["compile_sdk"] = int(sdk["compile"])
        if "compile_sdk" in sdk:
            data["compile_sdk"] = int(sdk["compile_sdk"])

    app = ast.get("app") or {}
    if isinstance(app, dict):
        if "src" in app:
            data["src_dirs"] = [str(x) for x in _as_list(app["src"])]
        if "res" in app:
            data["res_dirs"] = [str(x) for x in _as_list(app["res"])]
        if "assets" in app:
            data["assets_dirs"] = [str(x) for x in _as_list(app["assets"])]
        if "jni" in app:
            data["jni_dirs"] = [str(x) for x in _as_list(app["jni"])]
        if "manifest" in app:
            data["manifest"] = str(app["manifest"])
        if "proguard" in app:
            data["proguard_rules"] = [str(x) for x in _as_list(app["proguard"])]

    build = ast.get("build") or {}
    if isinstance(build, dict) and "r8" in build:
        data["r8"] = bool(build["r8"])

    if "repositories" in ast:
        data["repositories"] = _flatten_repos(ast["repositories"])
    if "dependencies" in ast:
        data["dependencies"] = _flatten_deps(ast["dependencies"])

    flavors_ast = ast.get("flavors")
    if isinstance(flavors_ast, dict):
        cleaned = {}
        for fname, block in flavors_ast.items():
            if not fname or str(fname).startswith("_"):
                continue
            if not isinstance(block, dict):
                continue
            cleaned[str(fname)] = {
                "suffix": str(block.get("suffix") or block.get("applicationIdSuffix") or ""),
                "versionSuffix": str(block.get("versionSuffix") or block.get("version_suffix") or ""),
                "package": str(block.get("package") or ""),
                "src": [str(x) for x in _as_list(block.get("src") or block.get("src_dirs"))],
                "res": [str(x) for x in _as_list(block.get("res") or block.get("res_dirs"))],
                "assets": [str(x) for x in _as_list(block.get("assets") or block.get("assets_dirs"))],
                "jni": [str(x) for x in _as_list(block.get("jni") or block.get("jni_dirs"))],
                "dependencies": _flatten_deps(block.get("dependencies")),
            }
        data["flavors"] = cleaned


    signing = ast.get("signing")
    if isinstance(signing, dict):
        clean: Dict[str, Any] = {}
        for flavor, block in signing.items():
            if isinstance(block, dict):
                clean[flavor] = dict(block)
        if clean:
            data["signing"] = clean

    return data


def load_manifest_file(path: Union[str, Path], defaults: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Load storm.m or legacy storm.json into the internal config dict."""
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if p.suffix.lower() == ".json" or p.name == LEGACY_CONFIG_NAME:
        raw = json.loads(text)
        if not isinstance(raw, dict):
            raise ManifestError("storm.json root must be an object")
        data = dict(defaults or {})
        data.update(raw)
        return data
    return ast_to_config(parse_storm_m(text), defaults)


def _fmt_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    text = str(value)
    if not text or any(ch.isspace() for ch in text) or text[:1] in "#{}'\"":
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return text


def _pad_block(keys_values: List[Tuple[str, Any]], indent: int = 4) -> List[str]:
    if not keys_values:
        return []
    width = max(len(k) for k, _ in keys_values)
    width = max(width, 9)
    pad = " " * indent
    lines = []
    for key, val in keys_values:
        lines.append(f"{pad}{key.ljust(width)}  {_fmt_value(val)}")
    return lines


def render_storm_m(data: Dict[str, Any]) -> str:
    """Render the internal config dict as a pretty storm.m document."""
    plugin_ver = data.get("plugin_version") or "2026.2.0"
    plugin_src = data.get("plugin_source") or "https://github.com/wfllive/Storm-Engine-Studio"
    plugin_auto = data.get("plugin_auto_update", True)

    src_dirs = _as_list(data.get("src_dirs") or ["app/src"])
    res_dirs = _as_list(data.get("res_dirs") or ["app/res"])
    assets_dirs = _as_list(data.get("assets_dirs") or ["app/assets"])
    jni_dirs = _as_list(data.get("jni_dirs") or ["app/jniLibs"])
    proguard = _as_list(data.get("proguard_rules") or ["app/proguard-rules.pro"])
    repos = _as_list(data.get("repositories") or [])
    deps = _as_list(data.get("dependencies") or [])
    signing = data.get("signing") or {}

    lines: List[str] = [
        "# ─────────────────────────────────────────────────────────────",
        "#  storm.m  ·  Storm Build project",
        "#  Edit this file.  storm.lock is generated — do not format it.",
        "#  Bump  plugin.storm  to install a newer Storm (new features).",
        "#  Chat:    https://t.me/wfllive_chat_base",
        "#  Support: https://boosty.to/wfllive/donate",
        "# ─────────────────────────────────────────────────────────────",
        "",
        "plugin {",
    ]
    plugin_kv: List[Tuple[str, Any]] = [("storm", plugin_ver)]
    if plugin_src:
        plugin_kv.append(("source", plugin_src))
    plugin_kv.append(("auto", bool(plugin_auto)))
    lines.extend(_pad_block(plugin_kv))
    lines.append("}")
    lines.append("")
    lines.append("project {")
    lines.extend(
        _pad_block(
            [
                ("name", data.get("name", "MyStormApp")),
                ("package", data.get("package", "com.example.stormapp")),
                ("version", data.get("version_name", "1.0.0")),
                ("code", int(data.get("version_code", 1))),
            ]
        )
    )
    lines.append("}")
    lines.append("")
    lines.append("sdk {")
    lines.extend(
        _pad_block(
            [
                ("min", int(data.get("min_sdk", 21))),
                ("target", int(data.get("target_sdk", 34))),
                ("compile", int(data.get("compile_sdk", 34))),
            ]
        )
    )
    lines.append("}")
    lines.append("")
    lines.append("app {")
    app_kv: List[Tuple[str, Any]] = []
    for d in src_dirs:
        app_kv.append(("src", d))
    for d in res_dirs:
        app_kv.append(("res", d))
    for d in assets_dirs:
        app_kv.append(("assets", d))
    for d in jni_dirs:
        app_kv.append(("jni", d))
    app_kv.append(("manifest", data.get("manifest", "app/AndroidManifest.xml")))
    for d in proguard:
        app_kv.append(("proguard", d))
    lines.extend(_pad_block(app_kv))
    lines.append("}")
    lines.append("")
    lines.append("build {")
    lines.extend(_pad_block([("r8", bool(data.get("r8", False)))]))
    lines.append("}")
    lines.append("")
    lines.append("repositories {")
    if repos:
        for url in repos:
            lines.append(f"    {_fmt_value(url)}")
    else:
        lines.append("    https://repo1.maven.org/maven2/")
        lines.append("    https://maven.google.com/")
    lines.append("}")
    lines.append("")
    lines.append("dependencies {")
    if deps:
        width = len("implementation")
        for dep in deps:
            lines.append(f"    {'implementation'.ljust(width)}  {_fmt_value(dep)}")
    else:
        lines.append("    # implementation  com.yandex.android:mobileads:8.2.0")
    lines.append("}")
    lines.append("")
    flavors = data.get("flavors") or {}
    if isinstance(flavors, dict) and flavors:
        lines.append("flavors {")
        for i, (fname, block) in enumerate(flavors.items()):
            if not isinstance(block, dict):
                continue
            if i:
                lines.append("")
            lines.append(f"    {fname} {{")
            kv = []
            if block.get("suffix"):
                kv.append(("suffix", block["suffix"]))
            if block.get("versionSuffix"):
                kv.append(("versionSuffix", block["versionSuffix"]))
            if block.get("package"):
                kv.append(("package", block["package"]))
            for d in block.get("src") or []:
                kv.append(("src", d))
            for d in block.get("res") or []:
                kv.append(("res", d))
            for d in block.get("assets") or []:
                kv.append(("assets", d))
            for d in block.get("jni") or []:
                kv.append(("jni", d))
            if kv:
                width = max(len(k) for k, _ in kv)
                width = max(width, 9)
                for key, val in kv:
                    lines.append(f"        {key.ljust(width)}  {_fmt_value(val)}")
            extra_deps = block.get("dependencies") or []
            if extra_deps:
                lines.append("        dependencies {")
                for dep in extra_deps:
                    lines.append(f"            implementation  {_fmt_value(dep)}")
                lines.append("        }")
            lines.append("    }")
        lines.append("}")
        lines.append("")

    lines.append("signing {")
    if signing:
        flavors = list(signing.items())
    else:
        flavors = [
            (
                "debug",
                {
                    "keystore": "debug.keystore",
                    "alias": "androiddebugkey",
                    "storepass": "android",
                    "keypass": "android",
                },
            )
        ]
    for i, (flavor, block) in enumerate(flavors):
        if not isinstance(block, dict):
            continue
        if i:
            lines.append("")
        lines.append(f"    {flavor} {{")
        kv = []
        for key in ("keystore", "alias", "storepass", "keypass"):
            if key in block:
                kv.append((key, block[key]))
        for key, val in block.items():
            if key not in ("keystore", "alias", "storepass", "keypass"):
                kv.append((key, val))
        # indent 8 inside signing.flavor
        if kv:
            width = max(len(k) for k, _ in kv)
            width = max(width, 9)
            for key, val in kv:
                lines.append(f"        {key.ljust(width)}  {_fmt_value(val)}")
        lines.append("    }")
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def write_manifest_file(path: Union[str, Path], data: Dict[str, Any]):
    """Write config back.  .json keeps JSON; everything else is storm.m."""
    p = Path(path)
    if p.suffix.lower() == ".json":
        p.write_text(json.dumps(data, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")
        return
    p.write_text(render_storm_m(data), encoding="utf-8")
