# Brief 3 — one layout format for the dash and the overlay

Covers `STUDIO_IDEAS_2026-08.md` item **4**. Owns **ADR-0051**.
Research: `../research/layout-formats.md`.
**This is the only one of the eight that touches the firmware repo.** Read
`../../RDM-7_Dash/docs/STUDIO_SHELL_PLAN_2026-07.md` §2.0 before starting.

## What we are building

A `.rdm` bundle that carries **both** placements — the dash's and the video overlay's —
so one file is "design once, use on the dash and on your videos", and one file is worth
twice as much on the Marketplace.

Plus the repair the existing dash→overlay importer needs: it predates the overlay's own
widget vocabulary and still collapses every dash widget into one of two types.

## The decision, stated up front

**One file, two placements. Not one placement rendered twice.**

The temptation is to make the two surfaces share geometry. They cannot, and the code
already knows it. The dash is the WASM renderer at a fixed 800×480 with absolute
centre-origin pixels (`ORIGIN_X=400`/`ORIGIN_Y=240`, `firmware-base.html:6337-6340`).
The overlay is hand-rolled 2D canvas at any aspect ratio, laid out by an **algorithmic
flow** in `S` units where `S = min(min(W,H)/720, W/700)`, and stored only as *nudges from
that flow* — `{dx, dy, k}` per widget, with an entry deleted entirely when it is back at
factory (`gpHudEdSet`, `tauri-overlay.html:32452-32464`). That relativity is deliberate
and load-bearing: it survives aspect changes and it survives the default layout being
re-tuned (`HUD_OVERLAY_PLAN_2026-08.md:139-144`).

And the existing converter already refuses geometry, for a better reason than either:
*"Copying the geometry would give a HUD that covers the footage"* (`32539-32544`). A dash
layout fills its screen because that is all the screen is for. An overlay that filled the
frame would hide the driving.

So the shared thing is the **widget list** — type, binding, range, label, unit, colour —
and each surface keeps its own placement. That is what "one layout format" means here,
and it is worth being explicit about in the ADR, because "why doesn't the overlay just
use the dash's x/y" is exactly the question someone asks a year later.

## What already exists

**The vocabulary is already shared — by hand.** `GP_HUD_MADE` (`29828-29842`) lists 13
user-instantiable overlay types whose **id strings and display names are the dash's,
duplicated literally**, with a comment saying so (`29809-29819`: *"Everything below them
is the DASH's widget set… What carries across is the vocabulary, not the code"*). The
**icons are genuinely shared**: `gpHudDashIcon(type)` returns `PALETTE_ICONS[t]` — the
dash editor's own icon object, reachable because both live in the merged `dist`
(`32716-32721`).

**Half the converter exists.** `gpHudDashPlan` (`32598-32642`), driven by
`gpHudEdImportDash` (`32644-32680`), already solves the hard part — the two-namespace
problem. Dash widgets bind `w.signal` (a registry name); overlay widgets bind a recording
**channel id**. `gpHudMatchChan` (`32575-32597`) matches exact-normalised, then
containment, then all-words-of-the-shorter-in-the-longer, and **reports what it could not
match rather than inventing it** (measured 10 of 26 across on his real layout).

**But it collapses.** `32621-32625` dedupes per signal, prefers a bar/rpm_bar/meter, and
then emits only `"bar"` or `"value"`. It was written before the 13-type vocabulary
existed and never caught up. A `meter` imports as a bar; an `arc` imports as a bar; a
`shift_light` imports as a bar.

**The container is ready for this.** `.rdm` is `RDM1` + a 16-byte header (magic, version,
entry count, **flavour byte**: 1 = layout, 2 = dashboard) + typed entries (0 = layout
JSON, 1 = image, 2 = font, 3 = channels.json) — spec comment at
`firmware-base.html:18432-18460`. Crucially the parse loop (`18693-18704`) is an
`if / else if` chain **with no else**, and the format comment states the intent outright:
*"older importers skip unknown types gracefully."*

**There is no overlay export at all today.** The overlay layout only ever lives in
`localStorage["rdm7_camera"]`, per PC. It cannot leave the machine.

## File-level plan

### 1. New `.rdm` entry type 4 — the overlay placement

Backward compatible by construction: every existing reader, and the firmware, skips it.

Payload is JSON, and it is **the `gp.cam.hud` object plus the visibility siblings**, not
a new schema:

```json
{ "v": 1,
  "w":   { "hudSpeed": { "dx": 40, "dy": -12, "k": 1.25 }, "w3": {…} },
  "z":   ["hudSpeed", "hudMap", "w3"],
  "lock": { "hudMap": 1 },
  "add": [ /* made widgets */ ],
  "seq": 7,
  "off": ["hudTacho"],          /* widgets switched off — gp.cam.hudX === false */
  "mapStyle": "satdim" }
```

`off` and `mapStyle` are flattened in from `gp.cam` because they are **siblings of**
`hud`, not members of it (`gpHudOn` `30030-30034`, `gpHudMapStyle` `29243-29248`) —
absent means on, which is why they must be listed as exceptions rather than as a full
state dump.

**Do not put this in the layout JSON.** Dash layouts have a hard 32 KB ceiling
(`RDM_LAYOUT_MAX_BYTES`, `_checkLayoutSize` `6352`, enforced at `17098-17110`), and
spending the dash's budget on data the dash cannot use is how that ceiling turns into a
bug report.

### 2. Firmware repo — parse and ignore

In `../RDM-7_Dash/main/web/index.html`, the entry loop (mirrored here at
`firmware-base.html:18693-18704`) gains one branch:

```js
} else if (entryType === 4) { overlayData = data; /* video overlay — desktop only */ }
```

…and nothing else. The firmware has no HUD. Extend the format comment at `18432-18460`
in the same commit — that block is the format's only specification.

Then `python tools/sync_firmware.py` to pull it back into `src/firmware-base.html`.

### 3. Desktop overlay — consume it

`_processRdmBytes` (`tauri-overlay.html:42876`) is a **verbatim copy** of the firmware's
`importRdm` body, differing only by anchored blocks — this is exactly the fragility
ADR-0048 was written about (the firmware added a third `file.name` and the desktop
import broke for two releases). So:

- Re-anchor `import-rdm-head` (`42851`) / `import-rdm-tail` (`42887`) against the new
  firmware HTML. If the merge fails, that is the drift detector doing its job.
- Add a **new anchored block** that consumes `overlayData` after the layout is installed:
  parse, then write through the existing setters — `gpCamPut("hud", obj)`
  (`38563-38567`) and `gpCamSet(key, bool)` for the `off` list. Never write
  `localStorage["rdm7_camera"]` directly: `gpCamLoad` (`38532-38558`) rebuilds `gp.cam`
  **key by key**, and a key it doesn't name is silently dropped on the next load. That
  trap is flagged in `HUD_OVERLAY_PLAN_2026-08.md:135-137` and it has already bitten once.
- Prompt before overwriting. An overlay layout is hand-tuned work; a bundle import
  should offer it, not impose it. Use `gpConfirm` (`8824-8846`) — `window.confirm`
  is broken under Tauri.

### 4. Export from the overlay side

`exportRdm(flavour)` (`firmware-base.html:18472-18645`) is firmware code and stays that
way. Add the type-4 entry from the **desktop** side instead, in the `export-rdm-native`
block (`tauri-overlay.html:42823`), which already wraps the export for Tauri's save
dialog. It appends one entry and bumps the entry count — the container is
append-friendly by design.

Also add the reverse entry point the overlay has never had: a "Save this overlay…"
action in `gpHudEdOpen`'s chrome that writes a `.rdm` carrying **only** a type-4 entry
plus an empty type-0 layout. Save with `RDM.saveFileDialog` + `RDM.writeFile`, following
`gpSaveVideoBlob` (`31220-31244`) — not the `<a download>` path the share card uses
(`13906-13915`), which is the older and worse precedent.

### 5. Fix the dash→overlay type mapping

`gpHudDashPlan` (`32598-32642`): stop collapsing. Map 1:1 for every type in both
`WIDGET_DEFS` and `GP_HUD_MADE` — `panel, text, bar, rpm_bar, meter, shift_light,
warning, indicator, banner, track_map, shape_panel, line, arc`. Keep the existing
exclusions and keep saying why on screen: `toggle`/`button` are pressable and meaningless
on video, `image` needs the device image store, `pathbar`/`anim` are device chrome
(`VIDEO_HUD_EXPORT_2026-08.md:231-232`).

Range keys normalise to the overlay's `lo`/`hi` from `bar_min`/`bar_max`, `min`/`max`,
`rpm_max`, `signal_min`/`signal_max`, `range_min`/`range_max` — the importer already
handles three of those at `32633-32638`.

Colours convert dash int `0xRRGGBB` → CSS string. **Not RGB565**: 565 is the wire
format applied by `convertWidgetColors` in `buildFirmwarePayload` (`12101`); the layout
JSON in a `.rdm` is the firmware payload, so read it back through
`firmwareToWebFormat` (`7788+`) rather than converting by hand.

Keep `gpHudDashPlan` a **plan** that is reported before it is applied. The importer's
best property is that it tells you what it could not match instead of inventing a gauge
the recording cannot feed (`VIDEO_HUD_EXPORT_2026-08.md:272-290`). Widening the type map
must not quietly widen that.

### 6. Not in scope — overlay → dash

Deliberately out. It needs S-units → 800×480 centre-origin pixels, plus expansion of the
dozens of `WIDGET_DEFS` keys a made widget doesn't carry (a made widget has ~10 flat
keys; a dash `meter` has 40+ needle/tick/shadow fields), plus the whole
recording-channel → dash-channel adoption flow, which is its own planned piece of work
in `LAYOUTS_FROM_RECORDINGS_2026-08.md:120-130` and must stay an explicit
review-then-write with the signed flag riding along. Say so in the ADR so it isn't read
as an oversight.

## Traps

- **`gpCamLoad` is a selective, key-by-key copy** (`38532-38558`). Any new persisted key
  must be named there or it evaporates on reload. Already flagged as a real trap in
  `HUD_OVERLAY_PLAN_2026-08.md:288-290`.
- **Absent means factory, per key AND per field** (`32452-32464`). Round-tripping must
  not materialise `{dx:0, dy:0, k:1}` entries — an empty config has to render
  byte-identically, and `check_hudedit.js` pins that.
- **Made-widget ids come from a counter, never from list length** (`seq`, `32499`), and
  are never reused. An import that renumbers breaks `w`, `z` and `lock` all at once.
- **32 KB layout ceiling** — see step 1.
- **Never edit `src/firmware-base.html`.** Step 2 is a firmware-repo edit followed by
  `tools/sync_firmware.py`. (From a worktree, `sync_firmware.py` needs the explicit repo
  path.)
- **A failed merge after the sync is the point.** `import-rdm-head`/`-tail` anchors
  breaking means the firmware moved under them — re-anchor, don't route around.
- **The Marketplace is link-out only** — `openMarketplace()` (`21780-21783`) opens a URL
  and there is no upload/download code anywhere. This brief makes the *file* worth
  sharing; it does not build sharing.

## Tests

- Extend `tools/check_import.js` (Model C′, builds real `.rdm` bytes in-memory —
  `buildRdm` at `:55-77`): a bundle with a type-4 entry imports its layout unchanged; a
  bundle with an **unknown** type 5 still imports cleanly (the graceful-skip contract);
  a type-4 entry with malformed JSON does not abort the layout install.
- Extend `tools/check_hudedit.js` (111 checks): overlay layout → type-4 JSON → back
  reproduces `gp.cam.hud` **and** the `off`/`mapStyle` siblings exactly; a factory
  layout round-trips to a payload with no `w` entries.
- New checks in the same harness for the widened `gpHudDashPlan`: each of the 13 shared
  types maps to itself; each excluded type is reported, not silently dropped; an
  unmatched signal still lands in `missed`.
- `tools/check_hud.js` must stay green untouched — pixel identity at two sizes is the
  contract that says the renderer wasn't forked.

## ADR-0051 — *One layout file, drawn two ways*

The decision that will be questioned: **the file is shared, the placement is not.**
Record the three reasons — the renderers differ in kind (WASM 800×480 absolute vs 2D
canvas any-aspect S-unit flow), the overlay's relativity is what makes it survive aspect
changes and default re-tuning, and a dash layout copied 1:1 onto video covers the
footage. Record the container decision too: a new entry type rather than a new key in
the layout JSON, because the layout JSON has a 32 KB ceiling the dash needs and the
container's unknown-type skip is already a documented contract. And note explicitly that
overlay→dash is unbuilt on purpose, with a pointer to
`LAYOUTS_FROM_RECORDINGS_2026-08.md`.
