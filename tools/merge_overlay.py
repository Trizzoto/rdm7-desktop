#!/usr/bin/env python3
"""Build the desktop editor frontend by merging the Tauri overlay onto the
firmware-canonical editor HTML (ADR-0007, RDM-7_Dash/docs/adr/0007).

    src/firmware-base.html   verbatim copy of RDM-7_Dash/main/web/index.html
                             (refresh with tools/sync_firmware.py)
  + src/tauri-overlay.html   desktop-only delta as anchored blocks
  = src/dist/index.html      what the Tauri webview actually loads

Also copies the static frontend assets (transport.js, rdm_logo_data.js,
favicon, WASM build) into src/dist/ so frontendDist is self-contained.

Runs as Tauri's beforeDevCommand/beforeBuildCommand. Exits non-zero with a
loud message when an overlay anchor no longer matches the base — that is the
drift detector working, not a tool bug: re-anchor the block against the new
firmware HTML.

Overlay block format (see src/tauri-overlay.html):

    ##[ block <name> ]##
    ##[ anchor ]##
    <one or more lines matched verbatim (incl. indentation) against the base>
    ##[ insert-after | insert-before | replace-with ]##
    <content lines>
    ##[ end ]##

The anchor line-sequence must occur EXACTLY ONCE in the base file.
Lines outside blocks that start with '#!' are comments and ignored.
"""
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "src" / "firmware-base.html"
OVERLAY = ROOT / "src" / "tauri-overlay.html"
DIST = ROOT / "src" / "dist"

# Static assets copied verbatim into dist (relative to src/)
ASSETS = ["transport.js", "rdm_logo_data.js", "favicon.ico", "dash_default_layout.jpg", "rdm_logo.png"]
ASSET_DIRS = ["build", "leaflet"]

DIRECTIVE = re.compile(r"^##\[\s*(.+?)\s*\]##\s*$")
OPS = ("insert-after", "insert-before", "replace-with")


class Block:
    def __init__(self, name, lineno):
        self.name = name
        self.lineno = lineno
        self.anchor = []
        self.op = None
        self.content = []


def parse_overlay(text):
    blocks = []
    cur = None
    section = None
    for n, line in enumerate(text.split("\n"), 1):
        m = DIRECTIVE.match(line)
        if not m:
            if cur is None:
                if line.strip() and not line.startswith("#!"):
                    fail(f"overlay line {n}: content outside a block: {line!r}")
                continue
            if section == "anchor":
                cur.anchor.append(line)
            elif section == "content":
                cur.content.append(line)
            else:
                fail(f"overlay line {n}: content before an anchor/op directive in block '{cur.name}'")
            continue

        d = m.group(1)
        if d.startswith("block "):
            if cur is not None:
                fail(f"overlay line {n}: block '{cur.name}' not closed before new block")
            cur = Block(d[6:].strip(), n)
            section = None
        elif d == "anchor":
            require(cur, n, d)
            section = "anchor"
        elif d in OPS:
            require(cur, n, d)
            if not cur.anchor:
                fail(f"overlay line {n}: op before anchor in block '{cur.name}'")
            cur.op = d
            section = "content"
        elif d == "end":
            require(cur, n, d)
            if cur.op is None:
                fail(f"overlay line {n}: block '{cur.name}' has no operation")
            # Trailing blank lines in a section are almost always authoring
            # accidents; strip one trailing empty line from content.
            while cur.anchor and cur.anchor[-1] == "":
                cur.anchor.pop()
            blocks.append(cur)
            cur = None
            section = None
        else:
            fail(f"overlay line {n}: unknown directive {d!r}")
    if cur is not None:
        fail(f"overlay: block '{cur.name}' never closed with ##[ end ]##")
    return blocks


def require(cur, n, d):
    if cur is None:
        fail(f"overlay line {n}: directive '{d}' outside a block")


def find_anchor(base_lines, anchor):
    hits = []
    la = len(anchor)
    for i in range(len(base_lines) - la + 1):
        if base_lines[i:i + la] == anchor:
            hits.append(i)
    return hits


def fail(msg):
    print(f"merge_overlay: ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    if not BASE.exists():
        fail(f"{BASE} missing — run tools/sync_firmware.py first")
    if not OVERLAY.exists():
        fail(f"{OVERLAY} missing")

    base_lines = BASE.read_text(encoding="utf-8").split("\n")
    blocks = parse_overlay(OVERLAY.read_text(encoding="utf-8"))

    added = 0
    for b in blocks:
        hits = find_anchor(base_lines, b.anchor)
        if len(hits) != 1:
            preview = b.anchor[0][:90]
            fail(
                f"block '{b.name}' (overlay line {b.lineno}): anchor matched "
                f"{len(hits)} times (need exactly 1). First anchor line: {preview!r}\n"
                f"  The firmware HTML has drifted — re-anchor this block."
            )
        i = hits[0]
        la = len(b.anchor)
        if b.op == "insert-after":
            base_lines[i + la:i + la] = b.content
        elif b.op == "insert-before":
            base_lines[i:i] = b.content
        else:  # replace-with
            base_lines[i:i + la] = b.content
        added += len(b.content)

    merged = "\n".join(base_lines)

    # Single-source the app version: tauri.conf.json is the authority.
    try:
        version = json.loads(
            (ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8")
        )["version"]
    except Exception as e:
        fail(f"cannot read version from src-tauri/tauri.conf.json: {e}")
    merged = merged.replace("__RDM7_DESKTOP_VERSION__", version)

    DIST.mkdir(parents=True, exist_ok=True)
    out = DIST / "index.html"
    out.write_text(merged, encoding="utf-8", newline="\n")

    for a in ASSETS:
        src = ROOT / "src" / a
        if src.exists():
            shutil.copy2(src, DIST / a)
        else:
            print(f"merge_overlay: warning: asset {a} missing, skipped")
    for d in ASSET_DIRS:
        src = ROOT / "src" / d
        if src.is_dir():
            shutil.copytree(src, DIST / d, dirs_exist_ok=True)
        else:
            print(f"merge_overlay: warning: asset dir {d}/ missing, skipped")

    print(
        f"merge_overlay: OK — {len(blocks)} blocks, +{added} lines "
        f"-> {out.relative_to(ROOT)} ({out.stat().st_size:,} bytes)"
    )


if __name__ == "__main__":
    main()
