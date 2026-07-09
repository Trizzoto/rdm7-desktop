#!/usr/bin/env python3
"""Refresh src/firmware-base.html from the firmware repo and rebuild dist.

Usage:  python tools/sync_firmware.py [path-to-RDM-7_Dash]

Copies RDM-7_Dash/main/web/index.html verbatim into src/firmware-base.html,
records the firmware commit in src/firmware-base.commit, then runs
tools/merge_overlay.py. If the merge fails, the base was still updated —
fix the overlay anchors and rerun merge_overlay.py (that failure is the
drift detector, see ADR-0007).
"""
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FW = ROOT.parent / "RDM-7_Dash"


def main():
    fw = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FW
    src = fw / "main" / "web" / "index.html"
    if not src.exists():
        print(f"sync_firmware: {src} not found", file=sys.stderr)
        sys.exit(1)

    dest = ROOT / "src" / "firmware-base.html"
    dest.write_bytes(src.read_bytes())

    try:
        sha = subprocess.check_output(
            ["git", "-C", str(fw), "rev-parse", "HEAD"], text=True
        ).strip()
        dirty = subprocess.run(
            ["git", "-C", str(fw), "diff", "--quiet", "--", "main/web/index.html"]
        ).returncode != 0
    except Exception:
        sha, dirty = "unknown", False

    stamp = f"{sha}{' (dirty)' if dirty else ''}  synced {date.today().isoformat()}\n"
    (ROOT / "src" / "firmware-base.commit").write_text(stamp, encoding="utf-8")

    print(f"sync_firmware: base updated from {src}")
    print(f"sync_firmware: firmware commit {stamp.strip()}")

    merge = ROOT / "tools" / "merge_overlay.py"
    sys.exit(subprocess.run([sys.executable, str(merge)]).returncode)


if __name__ == "__main__":
    main()
