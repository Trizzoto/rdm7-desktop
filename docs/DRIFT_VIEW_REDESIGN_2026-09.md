# Drift view redesign (2026-09-02)

A design for the Drift view in the GPS & Lap Timing workspace — the angle
lane, corner playback, a live readout and a hero that reads like the posters.
Written as a handoff: everything here was measured against the code on
2026-09-02 and is enough to implement from cold. Nothing below is built.

Scope is `#gpWorkspace` only, and inside it `gpRenderDrift` and what it draws.
The lap-timer shell change that landed the same day (three bands, four
sections, Drift kept top level — `tools/check_shell.js` pins it) is assumed.

---

## 1. What the view is now

**Layout** (`src/tauri-overlay.html` ~4528, CSS ~3320): `.gpb-driftwrap` is a
flex row. Left, `.gpb-driftmap` — the map, sticky, full height. Right,
`.gpb-drift` — a 460 px column (540 px at ≥1700 px) that `gpRenderDrift`
fills by `innerHTML` in this order:

1. a bar: map colour mode (Lap / Speed / Angle) and "Lap N of M"
2. the rated corner: an `h4` (10.5 px) with the unit name, then stars +
   score, then `held N°` at 40 px, then six tiles, then four part-bars, then a
   sentence about your best lap here, then (if linked) a members table
3. "Every corner, lap N" table — Turn / Angle / Comm / °·s / Stars / Best
4. the laps table — swatch / Lap / Time / Angle / °·s / Stars
5. "How this is rated" — two paragraphs of prose
6. the angle source line and the channel picker

**Playback**: the dock (`#gpDock`) is the transport, shared with Analyse. It
carries an angle slot (`data-dv='dangle'`, written by `gpUpdateDock`). The
right column is static — nothing in it moves with the playhead. The map draws
the car with its angle (`gpDrawCar`) and colours the line by angle when that
mode is picked.

**What the engine already provides** (all of it in the overlay; none of it
needs changing):

| Function | Returns | Used for |
|---|---|---|
| `gpDriftAngle()` | `{beta:Float32Array, ok:Uint8Array, conf:Float32Array, src, direct, rho, rhoOk, legs, scale, bias, anchors, worst, weak}` — one signed angle per sample, with an error bar; `direct` when a sensor measured the angle outright (then `conf` is 1 everywhere) | the lane, the live readout |
| `gpDriftSegments()` | `[{from,to,…}]` sample ranges where the car was sideways past `GP_DRIFT_ON` for ≥ `GP_DRIFT_HOLD_S` | shading on the lane |
| `gpDriftBoard()` | `{refLap, corners[{n,lat,lon}], units[{i,members,linked,n0,n1,name,lat,lon}], link, cells[lap][unit] → read or null, best[unit] → lap index, lapAvg[lap] → {stars,n} or null, bestKph[unit]}` | everything the tables show |
| a **read** (`gpDriftCornerRead`) | `{from,to,apex, secs, kph, entryKph, exitKph, lowKph, switches, angle:{peak,held,secs,area,conf,rough,direct,soft} or null, settle, commit, metres, spun, rating:{parts:{angle,commit,steady,speed},score,stars,ver} or null, members?}` | hero, tiles, sparklines |
| `gpAngleScale()` / `gpAngleColour(v)` | the map's angle scale and its amber/blue ramp for v in −1..1 | so the lane matches the map |
| `gpIdxSecondsBefore(idx, secs)` | a sample index `secs` earlier, walked not computed | corner run-up |
| `gpLapRange()` | `{from,to}` of the lap or run being read | every x-axis |
| `gpSecs(rows,i,j)`, `gpStep(rows,i)` | elapsed seconds; one sample's worth of time | the lane's x mapping |
| constants | `GP_DRIFT_ON`=10, `GP_DRIFT_OFF`=5, `GP_DRIFT_STAR_DEG`=40, `GP_DRIFT_ROUGH`=8, `GP_DRIFT_MIN_KPH`=25, `GP_DRIFT_SPIN`=100, `GP_CORNER_RUNUP`=2.0 s | marks and labels |

`gpRunWord()` / `gpRunWord(true)` return "lap"/"run" — a drift recording may
be split by stops rather than a line. Use it in every label that says lap.

## 2. What is wrong with it

1. **The angle is never drawn.** The engine has a signed angle with an error
   bar on every sample, and the view prints three of them as numbers. There
   is no picture of the drift building, holding and dropping — which is the
   one picture a drifter wants. (The posters proved it: the angle trace with
   its band was the strongest of the sixteen.)
2. **Nothing moves during playback.** Press play and the column sits still.
   The only live number is the dock's small angle slot. You cannot watch a
   corner and see where you are in it.
3. **Playback is lap-shaped, not corner-shaped.** A drifter replays one
   corner ten times. There is no "play this corner", no loop, no next/previous
   corner. You scrub by hand.
4. **The rated corner is buried.** Its name is a 10.5 px uppercase `h4`; the
   stars sit in a 460 px sidebar beside a map that has nothing to say until
   you zoom it. The hierarchy is the reverse of the poster's.
5. **The tables are numbers only.** A corner row says `36° · 100% · 154 · ★★★★½`
   and nothing about the shape of the drift — early, late, caught twice.
6. **A quarter of the column is a manual.** "How this is rated" is two
   paragraphs, always open, above the fold on a laptop.

## 3. The design

### 3.1 Layout

Keep the two columns — the map on the left IS the analysis on this screen —
but give the left column a second row and the right column a hierarchy.

```
┌─ page head ────────────────────────────────────────────────────────────────┐
│ MALLALA MOTOR SPORT PARK   Best 1:28.5   Lap 4 of 5 · 3.6★ over 7 corners   │
├─ left column (sticky) ─────────────────────────┬─ right column (scrolls) ───┤
│                                                │ TURN 2                     │
│   MAP  (angle colouring by default)            │ Lap 4 of 5                 │
│   line coloured by angle, car with angle,      │ ‹ prev  ▶ play corner  ⟲  next ›│
│   unit badges, selected unit red               │ ★★★★½ 4.5 of 5    36° held ±3│
│                                                │ NOW 31° ● · in Turn 2 · 96 km/h│
│                                                │ [Widest 48°][Sideways 5.1 s][74 m]│
├─ ANGLE LANE (132 px, sticky with the map) ─────┤ [°·s 154][Steady 5°/s][In at 116]│
│  +40 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ 40° full marks│ Angle ████████░ 91          │
│   T1   [T2 ★4.5]  T3    T4   T5–6    T8  T9–10 │ Committed ██████████ 100    │
│  ╭──╮ ╭────╮ ╭╮  ╭──╮  ╭─────╮  ╭─╮  ╭───╮     │ Steady ██████░░░ 64         │
│ ─┼──┼─┼────┼─┼┼──┼──┼──┼─────┼──┼─┼──┼───┼─ 0° │ Speed █████████░ 97         │
│  ╰──╯ ╰────╯ ╰╯  ╰──╯  ╰─────╯  ╰─╯  ╰───╯     │ Your best here: lap 3, 4.5★ │
│  −40 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │ ───────────────────────────│
│        ▲ playhead                               │ EVERY CORNER, LAP 4        │
└────────────────────────────────────────────────┤ Turn  shape   angle  ★  best│
                                                 │ T1   ▁▃▆▇▆▃▁  33°  4.0  L3 │
[ dock: transport, scrub, angle, speed ]         │ T2   ▁▅███▅▁  36°  4.5  L4 │
                                                 │ …                          │
                                                 │ LAPS                       │
                                                 │ How this is rated ▸        │
```

- Left column: `.gpb-driftmap` already is `flex-direction: column` with
  `.gp-viewer` at `flex: 1`. Add the lane canvas after the viewer. The
  column stays `position: sticky; height: 100%`, so the lane scrolls with the
  map, not with the readout.
- Right column: widen to **500 px** (560 at ≥1700). The tables need the room
  once they carry a sparkline column.

### 3.2 The angle lane — `#gpDriftLane`, drawn by `gpDrawDriftLane()`

The centrepiece. One canvas, DPR-aware, exactly the way `gpDrawNav` is built.

**Axes.** X is **time from the start of the lap** being read (`gpLapRange()`),
in seconds — not sample index, so a 10 Hz import and a 25 Hz puck recording
plot identically. Y is the **signed** angle, symmetric about zero so a
left-hand and a right-hand drift read as mirror images.

**Scale.** `yMax = clamp(max(GP_DRIFT_STAR_DEG * 1.15, p95(|β| on this lap) * 1.1), 46, 100)`.
The 40° line must always be inside the plot, and a session that never went
past 20° must not draw its drifts as a flat line.

**Marks, back to front:**

| Mark | Style |
|---|---|
| drift segments (`gpDriftSegments()` clipped to the lap) | x-range fill `rgba(210,35,42,0.07)` |
| ±`GP_DRIFT_ON` (10°) | hairline `var(--gpb-div-lt)` |
| 0° | 2 px `var(--gpb-ink)` |
| ±`GP_DRIFT_STAR_DEG` (40°) | 1.5 px dashed `var(--gpb-red)`, label **"40° · full marks"** in 10 px Barlow Condensed, right-aligned, above the top line only |
| confidence band | fill between β−conf and β+conf where `ok`, `rgba(29,31,32,0.12)`; **omitted when `d.direct`** (a measured angle has no band) |
| the angle line | 2 px, coloured per segment by `gpAngleColour(β / gpAngleScale())` so it matches the map; grey `rgba(29,31,32,0.30)` and 1 px where `!ok`; dashed where `conf > GP_DRIFT_ROUGH` |
| unit brackets | one per unit that has a cell on this lap: a bracket along the top edge from x(cell.from) to x(cell.to), label `unit.name` + `★` + stars.toFixed(1) (or `—` unrated, `spin` if `spun`), 10 px Barlow Condensed 600. Selected unit (`gp.driftUnit`) in `var(--gpb-red)`, others `var(--gpb-muted)`. Linked units carry the existing `.gpb-dlink-mark` glyph |
| playhead | 1.5 px `var(--gpb-red)` vertical line, 5 px dot at (x(playIdx), y(β[playIdx])) — dot only when `ok[playIdx]` |

**The picture is static; only the cursor moves.** Everything above the
playhead row is drawn once into an offscreen canvas and blitted, exactly as
`gpDrawNav` does. Cache key:

```
[gp.sessionId, r.from, r.to, wDev, hDev, gp.driftKey, gp.driftSegKey,
 gp.selLap, gp.driftUnit, gpAngleScale()].join("|")
```

**Hazard, learned the hard way on the nav strip:** anything the per-frame path
reads — `plotX`, `plotW`, the x-mapping array, `yMax` — must be computed
**outside** the cache branch, or a cached frame reads them undefined, every
coordinate goes NaN, and the canvas discards NaN in silence: the strip keeps
its picture and quietly stops showing the cursor. Store the mapping on
`gp._dlane = {xs: Float32Array(seconds per sample), plotX, plotW, yMax, key}`
and rebuild it only when the key changes.

**Factor the data out so it can be tested headless.** `gpDriftLaneData(r)` →
`{secs: Float32Array, yMax, segs:[{a,b}], brackets:[{unit, a, b, label, on, spun, rated}]}`
with no canvas in it. `gpDrawDriftLane` draws from that. The harness lifts
`gpDriftLaneData` through `tools/golden_lib.js` and checks it against the
drift fixture (§6).

**Interaction** (bind once, `cv._bound`, like `gpNavBind`):

- `mousedown` → `gpPlayStop()`, set `gp.playIdx` to the sample at that x
  (binary search `gp._dlane.secs`), `gpDrawPlayhead()`; drag continues to
  scrub; `mouseup` ends. Cursor `col-resize` over the plot.
- click on a bracket label → `gpDriftCornerPick(unit.i)`.
- double-click anywhere in a bracket's x-range → `gpDriftCornerPlay(unit.i)`.
- hover → a 1 px `var(--gpb-n400)` guide line and a small tag `31°` at the
  guide; drawn in the per-frame path, never cached.

### 3.3 The hero

Replace the `h4` + `.gpb-dhero` block with:

```html
<div class="gpb-dhead">
  <div class="nm">Turn 2</div>                              <!-- 20 px Barlow Cond 700, uppercase -->
  <div class="sub">Lap 4 of 5 · corners 5–6 driven as one</div>
  <div class="gpb-dtools">
    <button data-gp-dprev  title="Previous corner  [">‹</button>
    <button data-gp-dplay  title="Play this corner  Enter">▶ Play corner</button>
    <button data-gp-dloop  title="Loop it" class="on?">⟲</button>
    <button data-gp-dnext  title="Next corner  ]">›</button>
  </div>
</div>
<div class="gpb-dhero">  … stars + score  |  N° held ±c  (unchanged) … </div>
<div class="gpb-dlive">
  <span class="k">Now</span>
  <b data-dv="dang">—</b><i class="sw" data-dv="dsw"></i>
  <span data-dv="dwhere">—</span>
  <span data-dv="dspd">—</span>
</div>
```

Then the six tiles, the four part-bars, the "your best here" line and the
link-members table exactly as they are. The unrated states (no read / rough /
spun) keep their current sentences, shown in place of `.gpb-dhero`; the
`.gpb-dhead` and `.gpb-dlive` are always shown, so the corner can still be
played and watched even when it cannot be rated.

### 3.4 Corner playback

The transport stays the dock — one transport, one place. What is added is a
**stop point** the ticker respects, and three ways to set it.

```js
window.gpDriftCornerPlay = function (ci, loop) {
    var b = gpDriftBoard(); if (!b) return;
    var cell = (b.cells[gp.selLap] || [])[ci]; if (!cell) return;
    var r = gpLapRange();
    var start = Math.max(r.from, gpIdxSecondsBefore(cell.from, GP_CORNER_RUNUP));
    var stop  = Math.min(r.to,   gpIdxSecondsAfter(cell.to, 1.0));   // new helper, mirror of Before
    gpPlayStop();
    gp.driftUnit = ci;
    gp.playIdx = start;
    gp.playStopAt = stop;
    gp.playLoopFrom = loop ? start : null;
    gpRenderDrift();                 // the head names the corner being played
    window.gpPlayToggle();
};
```

**The ticker change** — one clause in `gpPlayResumeTicker`'s interval, after
`gp.playIdx = pos ? pos.i : rr.from;`:

```js
if (gp.playStopAt !== null && gp.playStopAt !== undefined && gp.playIdx >= gp.playStopAt) {
    if (gp.playLoopFrom !== null && gp.playLoopFrom !== undefined) {
        gp.playIdx = gp.playLoopFrom; gp._playIdxSet = gp.playIdx; gpPlayAnchor();
    } else {
        gp.playIdx = gp.playStopAt; gpDrawPlayhead(); gpPlayStop(); return;
    }
}
```

and `gpPlayStop()` clears both (`gp.playStopAt = gp.playLoopFrom = null`) so
the next plain Play runs free. `gpScrubTo` and `gpTransport` clear them too —
a deliberate move outranks a stop point, the same rule the video follows.

**Video:** while `gp.playStopAt` is set, skip the ticker's video handover
(`&& !gp.playStopAt` on that `if`). The video's own clock has no stop point,
and drift with synced footage is rare enough that the ticker driving the
picture for a five-second corner is fine.

**Keys** (in the drift view only, in the existing key handler near
`gpPlayToggle`'s `" " / "k"` case): `[` previous corner, `]` next corner,
`Enter` play this corner, `Shift+Enter` loop it. Check none collide with the
handler's existing bindings before assigning — `J`/`L` are the rate keys.

Previous / next: `gpDriftCornerPick(gp.driftUnit ∓ 1)`, clamped, buttons
disabled at the ends. `gpDriftCornerPick` already frames the corner on the
map and parks the playhead at its apex — keep that; corner PLAY starts from
the run-up instead.

### 3.5 The live readout — `gpDriftLive()`

Called from `gpDrawPlayhead` immediately after `gpUpdateDock()`; returns at
once unless `gp.view === "drift"`. Writes the `.gpb-dlive` slots and redraws
the lane's cursor. Never rebuilds anything.

- `dang`: `|β[i]|°` with `±conf` when not direct; `—` when `!ok[i]`;
  `rough` when `conf > GP_DRIFT_ROUGH` — the same three states the dock's
  angle slot already uses, so the two never disagree.
- `dsw`: a 10 px square coloured `gpAngleColour(β/scale)` — the side the
  car is sideways is shown by the map's own colour, **not** by a word. Nothing
  in the code asserts which sign is left and which is right on the puck's
  gyro; naming a side would be a guess wearing a label (see §8).
- `dwhere`: the unit whose cell on this lap contains `i` → its name; else
  "between corners". Cheap: units are few, cells carry from/to.
- `dspd`: `Math.round(gpSpdN(rows[i].kph)) + gpSpdU()`.
- then `gpDrawDriftLane()` — cached, so this is a blit and a cursor.

`gpRenderDrift` stores the slot elements on `gp._dliveEls` after its
`innerHTML` so the 20 Hz path does no `querySelector`. Do **not** test
visibility with `offsetParent === null` in this path — it forces layout and
was measured to cost more than the work it skipped.

### 3.6 The corner table with sparklines

Add a **shape** column after Turn: a `<canvas class="gpb-dspark" width=84 height=20>`
per row, drawn after the `innerHTML` (the same pass that binds rows).

- `|β|` over `[cell.from, cell.to]`, filled `rgba(210,35,42,0.30)` under a
  1.2 px `var(--gpb-red)` line; a hairline at 40° so the eye has the standard.
- rough → the line in `var(--gpb-n400)`, dashed; spun → red line to the top
  edge and the word `spin` in 9 px; no read → empty cell.
- selected row (`.hot`) unchanged.

Eight rows × ~150 samples is nothing; draw them straight, no cache.

### 3.7 Smaller things

- **"How this is rated"** becomes a disclosure: `How this is rated ▸` toggling
  `gp.driftHowOpen`, default closed. The angle-source line and channel picker
  stay visible below it — those are controls, not a manual.
- **Map colouring defaults to angle** in Drift when `gpDriftAngle()` exists.
  In `gpEffectiveMapMode`'s drift branch, an unset / `pace` mode resolves to
  `angle` rather than `speed`. Lap and Speed stay selectable.
- **Page head, drift line.** In `gpRenderCtx` when `view === "drift"` and the
  board exists, append to the meta: `· lap N of M · 3.6★ over 7 corners`
  (from `b.lapAvg[gp.selLap]`). The head is the one place a lap-level number
  belongs; the hero is about the corner.
- **Unit badges on the map.** Verify `gpDrawCornerBadges` draws in the drift
  dock (`gpDockViewer("drift")`); if it does not, draw the units' `lat/lon`
  with their `n0` (and `n0–n1` when linked), selected one in the `.l2` style.
- **Sizes.** Corner name 20 px; `held` value 44 px; tiles' values 18 px;
  stars 19 px in the hero, 9 px in tables (unchanged).

## 4. DOM and CSS

New elements, all inside `#gpWorkspace`:

| Element | Where |
|---|---|
| `<canvas id="gpDriftLane" class="gpb-dlane">` | `.gpb-driftmap`, after `.gp-viewer` |
| `.gpb-dhead` (`.nm`, `.sub`, `.gpb-dtools`) | top of `#gpDrift` |
| `.gpb-dlive` (`.k`, `[data-dv]`, `.sw`) | under `.gpb-dhero` |
| `canvas.gpb-dspark` | corner table cells |
| `.gpb-dhow` | the disclosure |

**Check every new class name before using it.** The shell change reused
`.gpb-phead` without looking; it was already the Analyse panel header, the
page head inherited `display:flex` from it and laid its rows out sideways.
Run, for each name:

```bash
grep -c "gpb-dlane\|gpb-dhead\|gpb-dlive\|gpb-dtools\|gpb-dspark\|gpb-dhow" src/tauri-overlay.html
```

Expect 0 before you add them (verified 0 on 2026-09-02). Also state
`display` explicitly on any new block that is a flex item of `.ws` or
`.gpb-driftmap`.

CSS lives with the other `gpb-d*` rules (~3320–3610). Square corners, the
`--gpb-*` tokens, Barlow Condensed for every label, red spent on: the
selected unit, the 40° line, the playhead, the stars. Nothing else.

## 5. Invariants — what re-renders and what updates

| Event | Do | Never |
|---|---|---|
| lap / corner picked, source changed | `gpRenderDrift()` (innerHTML), then the lane cache goes stale by key | — |
| playhead moves (ticker, scrub, keys, lane drag) | `gpDrawPlayhead` → `gpUpdateDock` → `gpDriftLive` (slot writes + cached lane blit) | rebuild the column, `gpRenderDock`, `querySelector` per tick |
| corner play reaches its stop | `gpPlayStop()` | roll over into the next lap — `gpPlayRollOver` only runs when there is no stop point |
| view leaves Drift | `gpSetView` already calls `gpPlayStop()`; also clear `playStopAt/LoopFrom` | leave a stop point armed for Analyse's transport |

Existing rules that apply here, from the workspace's own history:

- `gp.playIdx` is set to `gpLapRange().from`, never `0`, when chosen programmatically.
- A re-rendered column loses its bindings; `gpDriftBind(el)` runs after every `innerHTML`.
- The dock is marked in place — never rebuilt to refresh a number.
- Escape: the workspace's capture-phase handler runs first; anything the lane opens (a hover tag is not a popover, so nothing) would have to claim it in `gpEscapeCaught`.

## 6. Verification

**Headless — `tools/check_driftview.js`**, in the house style (lift verbatim
through `tools/golden_lib.js` / `tools/hype/drift.js`'s wider sandbox):

1. `gpDriftLaneData` on the drift fixture (`mallala-drift.vbo` with the
   Mallala track from `tools/fixtures/fixtures.json`, lap 4): 8 brackets, of
   which 7 rated and one (Turn 7) unrated with `spun === false`; `yMax ≥ 46`;
   every bracket `a < b` and inside `[0, secs[r.to]]`; segments all inside
   the lap.
2. Source checks: `gpDrawDriftLane` assigns `plotX`/`plotW` before its cache
   `if`; `gpDrawPlayhead` calls `gpDriftLive`; the ticker contains the
   `playStopAt` clause; `gpPlayStop` clears it; every `onclick`/`data-gp-d*`
   handler `gpRenderDrift` emits is `window.`-exported; none of the six new
   class names appears more than in its own rules, markup and JS.
3. `gpIdxSecondsAfter` is the mirror of `gpIdxSecondsBefore` on a 10 Hz and a
   25 Hz row set (walks, does not compute).

**In the built app** — the preview at `src/dist` reaches its own storage,
not the Tauri app's. Seed the Mallala track and import the drift VBO:

```js
// in the page, before _gpOpen()
localStorage.setItem('rdm7_tracks_v1', JSON.stringify({active: 'trk_ms3w2j4912a',
  tracks: [ /* the "track" object for mallala-2026-08-23 in tools/fixtures/fixtures.json */ ]}));
// then: copy mallala-drift.vbo into src/dist/, fetch it, and drive #gpSesFile:
const f = new File([await (await fetch('_drift.vbo')).text()], 'mallala-drift.vbo');
const dt = new DataTransfer(); dt.items.add(f);
const inp = document.getElementById('gpSesFile'); inp.files = dt.files;
inp.dispatchEvent(new Event('change', {bubbles: true}));
```

(Check the `rdm7_tracks_v1` shape against `gpTracksSave` first; do not guess
it.) Then, with the recording open in Drift:

- the lane shows 8 brackets; the selected one is red; the 40° line is inside
  the plot; the band is visible around the line on a derived angle
- press play: the `Now` slots change every tick; the lane cursor moves; the
  column does not flash (no innerHTML — watch with a MutationObserver on
  `#gpDrift`, expect zero childList mutations during 3 s of play)
- **Play corner** on Turn 2: playhead lands 2 s before the corner, plays,
  stops ~1 s after; **loop** runs it again; a scrub mid-loop cancels the
  loop
- `[` / `]` move the selection and re-frame the map; the head's name changes
- drag on the lane scrubs; the dock scrub follows
- at 1024 px wide nothing in the right column overflows

Screenshots from the preview time out on the real app; the browser pane's
screenshot works on the `desktop-dist` server and is what was used for the
shell change.

## 7. Build order — each step shippable

1. **The lane, read-only.** `gpDriftLaneData` + `gpDrawDriftLane` + the cache
   + `gpDriftLive` called from `gpDrawPlayhead`. No new controls. Already
   the biggest improvement.
2. **The hero and corner playback.** `.gpb-dhead`, the transport buttons, the
   ticker's stop point, `gpIdxSecondsAfter`, keys.
3. **Sparklines, the disclosure, lane interaction.** Drag-to-scrub, bracket
   click, double-click to play.
4. **Defaults and the page head.** Angle colouring by default, the drift meta
   line, badge check.
5. **`tools/check_driftview.js`.** Then add it to `tools/check_all.js`.

## 8. Decisions only he can make

- **Which sign is which side?** The engine's β is signed and the map colours
  the sign amber/blue, but nothing names left and right. If the puck's gyro
  convention is known (positive = clockwise from above = the car's nose
  rotating right?), the readout can say "31° left"; until then it says
  `31°` with the swatch.
- **Time or distance on the lane's x-axis?** Time is specified — it needs
  nothing precomputed and reads naturally beside the dock's clock. Distance
  would line up with the map better for comparing laps. Could be a toggle
  later; not in this pass.
- **Ghost laps on the lane?** Drawing the other laps' angle faintly under
  the selected one would let you see whether Turn 2 is always late. Cheap to
  add once the lane exists; left out of the first pass so the lane stays
  readable.
