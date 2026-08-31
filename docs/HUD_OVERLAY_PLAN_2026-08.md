# The overlay grows up: a fine line, the real mark, and a designer

2026-08-31. **Status: BUILT** (2026-08-31, all three parts).
The reference doc is `VIDEO_HUD_EXPORT_2026-08.md`; this one is kept for the
reasoning and for the As-built record at the bottom.
Written by a planning pass and implemented by a second one (he switches the
model between the two on purpose). Line numbers below are from
`src/tauri-overlay.html` as it stood before the work, on the
`analyse-video-playback` branch, uncommitted — they have all moved since.

Three asks, in his words:

1. *"the smaller constant line like whats on the analyse gps page. thats a
   perfect line you should do that on the minimap"*
2. *"use our actual rdm logo at the top and write studio after"*
3. *"integrate a way for us to customise the overlay. use the same dash
   customisation layout. but its for overlay instead of the dash"*

---

## Part A — the minimap route becomes the analyse line

**Where:** `gpHudMinimap`, the `win.nBack > 0` trail block (~line 28822).

**What "the perfect line" actually is** (read out of `gpDrawTrace`): every lap
on the analyse map is a strand of `width 2.4` over a dark casing of
`GP_LAP_CASE = 1.8` px each side at `caseAlpha 0.45`, one constant colour, no
taper, no ramp. The neutral whole-recording colour is
`GP_TRACE_WHOLE = "#f2f2f3"`. The Tracks view draws the same idea flat:
`2.6 / #f2f2f3 / alpha 0.72`, no casing.

**The change:** replace the behind-only trail (6·S keyline + 3·S core at
alpha 0.4) with **one constant line through the whole window** — behind *and*
ahead of the car, `trace(0, win.pts.length - 1)`:

- casing stroke: `(2.4 + 2 × 1.8) · S = 6 · S`, night `rgba(10,6,24,0.55)`,
  day `rgba(8,10,12,0.5)`
- core stroke: `2.4 · S`, `#f2f2f3` at `0.85`, both styles
- caps/joins stay round; the outline, gate, car, wedge and readout are untouched

**What this is NOT:** the fat road is not coming back. It went 16·S tube →
9·S line → gone, each asked off in turn; what he pointed at this time is the
analyse map's *fine constant neutral* line — no speed colouring, no angle
colouring, no width changes, ever. "Constant" is the load-bearing word.

**Harness:** rewrite the `check_hud.js` section "the road ahead is gone — the
ground is the road" as **"the route is one fine constant line"**:
- a core stroke exists at `2.4·S` width in `#f2f2f3`-at-0.85 (the stub records
  lineWidth per stroke — extend it if it only records colour)
- the stroked path reaches **past** `win.nBack` (the ahead half is drawn) —
  assert on the lineTo count of the core pass
- keep, verbatim: no stroke carries the angle ramp (`gpAngleColour`), no
  stroke carries a speed colour (`rgb(N,0,0)` family)

**Doc:** the "There is no painted road ahead" paragraph in
`docs/VIDEO_HUD_EXPORT_2026-08.md` gets its sequel — the route line returned
in the analyse map's own form, at his request, and only in that form.

---

## Part B — the mark becomes the logo

**Where:** `gpHudRender`, the `hudMark` block (~line 29168) — today a
right-aligned `fillText("RDM STUDIO", W − M, M + 12·S)` at alpha 0.34.

**The asset is `rdm_logo.png`** — the official transparent 600-px master,
already shipped beside `index.html` and already in `src/dist/` (the suite
topbar `RDM_LOGO_IMG` at line ~4210 uses the same file). **Do not** touch
`rdm_logo_data.js`: `_RDM_LOGO_RDMIMG_B64` is the RDMIMG *device* format, not
a PNG, and will not feed an `Image`.

**Loader:** a lazy module-level `Image` (`_gpHudLogo`, `src = "rdm_logo.png"`,
`.ok` on load). Same-origin, so no taint on either dev origin.
- The tile may draw one text-fallback frame before load; it self-corrects.
- **The export must not race it:** `gpExportRunNow` awaits a
  `gpHudLogoReady()` promise (cap 1.5 s, then text fallback) before the first
  frame, so frame 0 of every export is deterministic.

**Draw:** a right-aligned cluster ending at `W − M`, top `M`: the logo at
height `22·S` (width from the image's natural ratio), a `7·S` gap, then
**"Studio"** in `600 15·S GP_HUD_SANS` — logo at `globalAlpha 0.9`, text
`rgba(245,247,250,0.75)`, text baseline sitting on the logo's optical centre
line. Compute total width first (logoW + gap + textW), start at
`W − M − total`. Popover label becomes "RDM Studio mark"; the key stays
`hudMark` so saved settings carry over.

**Harness:** the stub must record `drawImage` args (it already does for map
tiles). Assert: image + the word "Studio" when `.ok`; the old text path when
not; the cluster's right edge ≤ `W − M`; "Studio" drawn to the *right* of the
image's x.

(Noted, not in scope: the share card at ~13740 still writes `fillText("RDM
Studio")` — swap it to the same cluster later if he wants the set matching.)

---

## Part C — the overlay designer

### Shape

The Design workspace's three-panel language, but the subject is the HUD over
a real frame of his own footage:

- **left** — the widget list (`GP_HUD_WIDGETS`, one row each: name + eye).
  The set is fixed — instruments aren't instantiable, there is no "add a
  second tacho" — so the palette and the Layers list collapse into one list,
  which is also where selection lives.
- **centre** — a canvas: the linked video's current frame as ground (the
  element is already CORS-clean, `drawImage` works), else dark + faint grid;
  `gpHudRender` over it with real `gpHudData(gp.playIdx)`; the editor draws
  the dashed selection box and handles ON TOP — the renderer stays pure.
- **right** — Properties: Visible; Size (50–200 %); Position as two plain
  steppers (→ and ↓ — no "dx/dy" jargon on labels); Minimap additionally gets
  the ground picker (same four, bound to the same `hudMapStyle` store);
  "Reset this widget". Top bar: frame preset (**Footage** when linked /
  Landscape 1920×1080 / Portrait 1080×1920 — portrait is his real footage,
  it must be one click), **Reset all**, **Done**.

Visual parity by reusing the designer's own global classes — `.sidebar`,
`.sidebar-header`, `.sidebar-file-btn` are in the merged dist. The editor
itself is a fixed full-screen div `#gpHudEd` inside `#gpWorkspace`; any NEW
css is scoped under `#gpHudEd` (the ADR-0024 discipline).

### The store

```js
gp.cam.hud = { v: 1, w: { hudSpeed: { dx: 0, dy: 0, k: 1 }, /* … */ } }
```

- `dx`/`dy` — offset **in S units** from the widget's *computed default*
  position; `k` — uniform scale 0.5–2 about the widget's centre.
- **Absent means factory**, per key and per field — the same philosophy as
  `gpHudOn` (a widget added later must not come up displaced or hidden).
- Persist via the existing `gpCamPut("hud", …)` into `rdm7_camera`.
- ⚠ `gpCamLoad` (~35823) copies keys **selectively** — it must gain
  `if (s && s.hud) out.hud = s.hud;` or the layout is silently dropped on
  every load. This is the trap in this part.

Offsets are relative to the flow, not absolute anchors, deliberately: the
default layout is algorithmic (speed's width feeds gear's x, the grip circle
stacks on the minimap, `W/700` is derived from the widest row), and absolute
positions would freeze all of that intelligence at whatever aspect the editor
happened to show. A drag stores "how far from where it belongs", which
survives portrait/landscape and future default tuning.

### The renderer refactor (behaviour-change zero, first)

Wrap each widget block in `gpHudRender` with a placer:

```js
gpHudPlace(g, key, cx, cy, rect, opt, function () { /* existing code, untouched */ })
```

- `save()` → `translate(dx·S, dy·S)` → scale `k` about the widget's centre →
  run the existing absolute-coordinate drawing code verbatim → `restore()`.
- When `opt.rects` is passed, push `{key, x, y, w, h}` (post-override) — this
  one array serves the editor's hit-testing, the selection outline, and the
  harness.
- Flow positions (the running `x`, the tacho width, the grip stacking) are
  computed from **untransformed** defaults — moving the speed cluster does
  not re-flow the tacho. Predictable beats clever; say so in a comment.
- **An empty/absent config must render byte-identical to today.** The
  existing 720p-vs-1440p pixel-identity check already guards the geometry;
  add a call-log equality check (render with no config vs `{v:1,w:{}}`) so
  the refactor is *proven* a no-op before the editor exists.

### Interactions

Pointer events on the canvas: hit-test topmost rect; drag → `Δ/S` into
`dx/dy` (shift = axis lock); arrows nudge `1·S`, shift `10·S`; the Size
slider (or wheel over the selection) drives `k`. Eye toggles the existing
`gpCamSet` boolean. Esc closes — with `stopPropagation` while the editor is
open, so it cannot resurrect the swallowed-Escape bug fixed in 0313832.

### Entry points

- `gpHudPop` (~30731) gains **"Customise overlay…"** after the widget rows,
  before "Minimap ground".
- The export dialog gains a small link of the same name.
- Exported as `window.gpHudEd` — the overlay is an IIFE; nothing is reachable
  from CDP or the harness unless deliberately put on `window`.

### What v1 is not

No multi-instance widgets, no free-text widget, no extra-channel panels
(the Mallala ECU channels are tempting — v2 candidates, listed here so they
aren't relitigated), no undo stack beyond per-widget and whole-layout Reset.

### Harness

New `tools/check_hudedit.js`:
- store round-trip through a fake localStorage, including the `gpCamLoad`
  carry (the ⚠ above gets its own check)
- rect math under `dx/dy/k` at 720p AND 4K — the same S-units offset lands at
  the same *proportional* place (S-invariance)
- empty-config identity (the call-log equality)
- hit-test picks the topmost of two overlapping rects; nudge math; reset
  clears to factory

`check_hud.js`: `env()` grows a `cam` plumb-through; all 97 existing checks
keep passing with defaults untouched — that is the point of absent-means-
factory.

---

## Order of work

1. **A** — line + harness + doc para. Merge, `check_all`, live export, LOOK.
2. **B** — logo + export preload + harness. One export proves A+B together.
3. **C** — in three strictly separate passes: (i) placer refactor + rects +
   identity checks (the app must look *exactly* the same at the end of this
   pass); (ii) the editor UI; (iii) polish, docs, memory.
   Live proof: open the editor over CDP, drag the speed cluster +40·S right,
   export → the cluster moved in the FOOTAGE; Reset all, export → matches the
   pre-refactor picture.

## The ritual (unchanged, mandatory, every part)

`python tools/merge_overlay.py` → `node tools/check_all.js` (all 33+ green) →
reload the running dev app → export Mallala `ses_mtdnct186rr` **Lap 2, with
sound** → ffmpeg-extract frames and **look at the picture** (sizes and
durations have lied here before) → confirm the save dialog is native
(`{stubbed: false}`) → **never commit** — his WIP is on this branch.

## Traps already paid for once

- Heredocs eat backslashes — Write/Edit or a `.py` patch script, never a
  bash heredoc into JS; `check_syntax.js` is the net.
- The ctx stub parses `"700 82px"` fonts — the px is not the first token.
- `_RDM_LOGO_RDMIMG_B64` is not a PNG.
- `gpCamLoad`'s selective copy drops unknown keys (Part C's ⚠).
- One `gpHudRender`, forever — an editor-only renderer is how the preview
  and the export start disagreeing again.
- `__TAURI_INTERNALS__.invoke` is not writable; a probe counter reading zero
  may be measuring itself.

## Decisions taken (veto here, before implementation)

- **The whole window gets the line, ahead included** — that is what "like the
  analyse page" means; the ahead half returns only in this fine constant
  neutral form. If he wants behind-only after seeing it, it is a one-argument
  change (`trace(0, win.nBack)`).
- **Logo top-right**, where the mark already lives — and movable in Part C
  anyway, so the placement argument is self-liquidating.
- **Offsets relative to the flow defaults**, not absolute anchors (reasons
  above).
- **Fixed widget set in v1**; custom text and ECU-channel panels are v2.


---

# As built

All three parts shipped the same day the plan was written. What the plan got
right, and what reality corrected:

**Part A — the route line.** As planned: `GP_TRACE_WHOLE` at 0.85, 2.4·S over a
`GP_LAP_CASE` casing, through the whole window. Verified in a real Lap 2
export — it traces the Mallala hairpin exactly. The one surprise was in the
harness, not the code: `check_hud.js` turned out to contain **three
byte-identical copies** of one section and a duplicated road-ahead block, left
by an earlier patch script that spliced backwards (`s[:start] + new + s[end:]`
with `end < start`). 96 duplicated lines removed. It had been passing 97
checks partly by running the same ones repeatedly.

**Part B — the mark.** As planned. The `naturalWidth/naturalHeight` sizing and
the right-edge anchoring both went in, and the export's `gpHudLogoReady()`
wait is on the path. Two harness gaps that the first draft of the checks
missed, both closed: the wait was tested in isolation but nothing proved the
EXPORT actually called it, and a never-settling wait made the harness *hang*
rather than fail — it now has a 5 s sentinel, and a deferred-load fixture that
exercises the queue rather than the early return.

**Part C — the designer.** Built as planned. Corrections reality supplied:

- The plan assumed a wide window. The dev instance is **540 px** wide, where
  two 232 px rails left **74 px for the picture**. Now stacks under 900 px.
- Selecting a widget grew the properties rail, which shrank the stage *under
  the cursor mid-drag*: a 60 px drag arrived as **270**. Fixed twice over —
  fixed-height rails, and the drag measured against the rect cached at
  pointerdown.
- The frame needed COVER, not a stretch, on the non-footage presets.
- The "Footage" preset had to be re-decided every draw; deciding it once at
  open left it dead, because the video is still loading then.
- A widget dragged off the picture needed saying so in the list.
- `window.__gpHudEd()` added, matching `__gpHud` / `__gpMap`.

**The ⚠ in the plan was real.** `gpCamLoad` would have dropped the layout on
every reload. It has its own check now, and the round trip was confirmed live
across a real page reload.

**The identity claim was proved twice**, not once: call-for-call in the
harness, and pixel-for-pixel in the running app — the same 1216×1616 frame of
the real session before and after the refactor, **0 differing subpixels**.

**One thing damaged and repaired.** A probe script of mine wrote
`hudMapStyle: "sat"` over his `"satdim"` while comparing grounds — his
setting, not test state. Found by that very pixel diff (the only difference
between before and after was ground brightness), identified by re-rendering
both and matching, and restored. The lesson is the one already in memory:
`rdm7_camera` is real data, so read it before writing it. The final export was
run with his own settings back in place: `satdim`, delta off, layout empty.

**Not done, still v2:** custom text, ECU-channel panels, multi-instance
widgets, an undo stack beyond per-widget and whole-layout Reset.
