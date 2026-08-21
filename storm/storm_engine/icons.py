"""Ensure a launcher icon exists so the APK is not the default Android robot."""

import shutil
from pathlib import Path
from typing import Optional

from .env import Colors

_BUNDLED = Path(__file__).resolve().parent / "assets" / "ic_launcher.png"


def project_has_launcher_icon(res_dirs) -> bool:
    for rdir in res_dirs:
        if not rdir.exists():
            continue
        for p in rdir.rglob("ic_launcher.png"):
            if p.is_file() and p.stat().st_size > 0:
                return True
        for p in rdir.rglob("ic_launcher.webp"):
            if p.is_file() and p.stat().st_size > 0:
                return True
    return False


def ensure_launcher_icon(project_root: Path, res_dirs=None) -> Optional[Path]:
    """Copy the bundled Storm icon into res/mipmap-xxxhdpi/ if the project has none."""
    if res_dirs:
        res_dirs = list(res_dirs)
    elif (project_root / "app" / "res").exists() or (project_root / "app").exists():
        res_dirs = [project_root / "app" / "res"]
    else:
        res_dirs = [project_root / "res"]
    if project_has_launcher_icon(res_dirs):
        return None
    dest_dir = Path(res_dirs[0]) / "mipmap-xxxhdpi"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "ic_launcher.png"
    src = _BUNDLED
    if not src.exists():
        # Fall back to any template copy in the repo.
        repo = Path(__file__).resolve().parents[1]
        for cand in list(repo.glob("templates/*/app/res/mipmap-xxxhdpi/ic_launcher.png")) + list(
            repo.glob("templates/*/res/mipmap-xxxhdpi/ic_launcher.png")
        ):
            src = cand
            break
    if not src.exists():
        print(f"  {Colors.YELLOW}[ICON] No bundled launcher icon found.{Colors.RESET}")
        return None
    shutil.copyfile(str(src), str(dest))
    print(f"  [ICON] Installed default launcher icon → {dest.relative_to(project_root)}")
    return dest
