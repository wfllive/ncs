"""
Terminal progress for Storm Build 2026.
TTY: live bar on one line (stderr). Pipes/tests: quiet except summaries.
"""

import os
import shutil
import sys
from typing import Optional

from .env import Colors


def _term_width() -> int:
    try:
        return max(40, min(shutil.get_terminal_size((80, 24)).columns, 100))
    except Exception:
        return 80


def _supports_unicode() -> bool:
    enc = (getattr(sys.stderr, "encoding", None) or "utf-8").lower()
    return "utf" in enc


def render_bar(current: int, total: Optional[int], width: int = 22) -> str:
    """Return a [████░░░░] or [####----] bar."""
    width = max(8, width)
    if _supports_unicode():
        fill, empty = "█", "░"
    else:
        fill, empty = "#", "-"

    if total and total > 0:
        ratio = max(0.0, min(1.0, float(current) / float(total)))
    else:
        # Indeterminate: a moving block based on count.
        ratio = ((current % (width + 1)) / float(width)) if current else 0.0

    filled = int(round(ratio * width))
    filled = max(0, min(width, filled))
    return f"[{fill * filled}{empty * (width - filled)}]"


def shorten(text: str, max_len: int) -> str:
    text = (text or "").replace("\n", " ").strip()
    if max_len < 8 or len(text) <= max_len:
        return text
    keep = max_len - 1
    return "…" + text[-keep:]


class ProgressBar:
    """Single-line live progress. Safe to use from unit tests (no TTY)."""

    def __init__(self, title: str = ""):
        self.title = title
        self.tty = hasattr(sys.stderr, "isatty") and sys.stderr.isatty() and not os.environ.get("STORM_NO_PROGRESS")
        self._last_len = 0
        self._printed = False

    def update(
        self,
        current: int,
        total: Optional[int],
        label: str = "",
        cache: int = 0,
        downloaded: int = 0,
        status: str = "",
    ):
        width = _term_width()
        bar_w = 18 if width < 70 else 24
        bar = render_bar(current, total, bar_w)

        if total and total > 0:
            pct = int(round(100.0 * min(current, total) / total))
            counts = f"{min(current, total)}/{total}"
            head = f"{bar} {pct:3d}%  {counts}"
        else:
            head = f"{bar}  {current} libs"

        extra = status or f"cache {cache}  ↓ {downloaded}"
        room = width - 2 - len(head) - 3
        name = shorten(label, max(12, room - len(extra) - 3)) if room > 20 else ""

        if name:
            line = f"  {head}  {name}"
        else:
            line = f"  {head}  {extra}"

        if len(line) > width:
            line = line[: width - 1]

        if self.tty:
            pad = max(0, self._last_len - len(line))
            sys.stderr.write("\r" + line + (" " * pad))
            sys.stderr.flush()
            self._last_len = len(line)
            self._printed = True
        # Non-TTY: stay quiet so logs/tests stay readable.

    def finish(self, summary: str = ""):
        if self.tty and self._printed:
            sys.stderr.write("\r" + " " * max(self._last_len, _term_width() - 1) + "\r")
            sys.stderr.flush()
            self._printed = False
            self._last_len = 0
        if summary:
            print(summary)


def print_step(index: int, total: int, title: str, subtitle: str = ""):
    """Pretty pipeline step header."""
    print()
    print(f"{Colors.BOLD}{Colors.CYAN}[{index}/{total}]{Colors.RESET} {Colors.BOLD}{title}{Colors.RESET}")
    if subtitle:
        print(f"         {Colors.CYAN}{subtitle}{Colors.RESET}")
