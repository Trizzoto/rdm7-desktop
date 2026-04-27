#!/usr/bin/env python3
"""
check_widget_codegen.py — CI / pre-commit safety net.

Runs the widget-schema validator AND the codegen in --check mode against the
firmware HTML files. Exits 0 only when:
  1. schema/widgets.schema.json is well-formed (validator passes), and
  2. main/web/index.html and data/web/index.html match what codegen would emit
     from the current schema.

Usage:
    python tools/check_widget_codegen.py
    python tools/check_widget_codegen.py src/index.html ...   # custom files

Exit codes:
    0 = OK
    1 = drift detected (schema and HTML out of sync)
    2 = configuration / setup error

Vendored from RDM-7_Dash @ 95ae13c, with DEFAULT_TARGETS adapted for the
desktop layout (src/index.html instead of main/web/index.html +
data/web/index.html). The rest of the file is byte-identical to firmware.
See docs/WIDGET_SCHEMA_SYNC.md.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Reuse the existing tools as importable modules.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import codegen_widget_defs  # noqa: E402
import validate_widget_schema  # noqa: E402


DEFAULT_TARGETS = [
    "src/index.html",
]


def main() -> int:
    args = sys.argv[1:]
    targets = args if args else DEFAULT_TARGETS

    # Step 1: validate schema.
    rc = validate_widget_schema.main()
    if rc != 0:
        print("check_widget_codegen: schema validation failed.", file=sys.stderr)
        return rc

    # Step 2: drift check on each target.
    repo_root = HERE.parent
    rel_targets = [str((repo_root / t).resolve()) for t in targets]

    rc = codegen_widget_defs.main(["--check", *rel_targets])
    if rc == 0:
        print("check_widget_codegen: OK (schema + codegen output in sync)")
        return 0

    if rc == 1:
        print(
            "check_widget_codegen: DRIFT — schema and committed HTML are out of sync.\n"
            "  Run: python tools/codegen_widget_defs.py "
            + " ".join(targets),
            file=sys.stderr,
        )
        return 1

    return rc


if __name__ == "__main__":
    sys.exit(main())
