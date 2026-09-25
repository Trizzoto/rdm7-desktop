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
# The checkout is named differently on different machines.
FW_CANDIDATES = [ROOT.parent / "RDM-7_Dash", ROOT.parent / "RDM-7 Dash"]
DEFAULT_FW = next((p for p in FW_CANDIDATES if p.exists()), FW_CANDIDATES[0])
# The firmware tree sits at the repo root, or under Software/ since the repo
# was split into Documentation/Hardware/Software.
FW_EDITOR = Path("main") / "web" / "index.html"


def main():
    fw = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FW
    src = next((p for p in (fw / FW_EDITOR, fw / "Software" / FW_EDITOR)
                if p.exists()), None)
    if src is None:
        print(f"sync_firmware: {FW_EDITOR} not found under {fw} or "
              f"{fw / 'Software'}", file=sys.stderr)
        sys.exit(1)

    dest = ROOT / "src" / "firmware-base.html"
    dest.write_bytes(src.read_bytes())

    try:
        sha = subprocess.check_output(
            ["git", "-C", str(src.parent), "rev-parse", "HEAD"], text=True
        ).strip()
        dirty = subprocess.run(
            ["git", "-C", str(src.parent), "diff", "--quiet", "--", src.name]
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
