# Brief 1 — "Can I trust this recording?"

Covers `STUDIO_IDEAS_2026-08.md` items **2** and **1**. Owns **ADR-0049**.
Research: `../research/session-quality.md`, `../research/drift-calibration.md`.

## What we are building

One panel, in Analyse, that answers *"can I trust this recording?"* with a plain verdict
and — underneath it — only the facts that are wrong. A badge on the Sessions list carries
the same verdict so a bad recording is visible before you open it.

Every number it shows already exists. This is plumbing, plus one verdict function, plus
the honesty to show the fit that the drift engine has been keeping to itself.

## Why this shape

The motivating incident is in `STUDIO_IDEAS_2026-08.md` §1–2: the 23 Aug Mallala session
produced **+54° then −48° of slip angle inside one corner, wearing a confident ±2.1°**,
on footage showing the car tracking the racing line. Finding that took a day of
bisection. Every signal needed to suspect it was already computed and sitting in four
different places, mostly invisible.

**Item 1 folds in here rather than becoming a wizard.** `gpDriftAngle()`
(`src/tauri-overlay.html:22219-22629`) already self-calibrates from ordinary driving:
it regresses the GPS-derived course rate against the smoothed body rate the *inverse*
way round (`rp` on `rb`, then inverted — the naive direction biased a true 1.008 scale
to 0.964, turning a 38° corner into 41°; comment at `22292-22312`), masks out samples
where the car is holding an angle (a steady drift has β̇≈0 and dominated the fit at
0.936 against a true 1.008 on a real Mallala lap; `22345-22377`), and refuses a fitted
scale outside 0.8–1.25 outright as wrong-units or mirrored mounting (`22331-22336`).
It returns `scale`, `bias`, `fitN`, `weak`, `anchors`, `worst`, `sigma` at `22623-22626`
and shows almost none of it. Confirmed with him 2026-09-01: **explain the fit, don't add
a wizard.**

**The precedent to copy is the Ready card**, not a new invention. `gpReadyRows()`
(`16820-16971`) builds `{k, v, tone, sub, fix, wait, pin}` rows each carrying its own
verdict and optionally its own fix button; `gpReadyVerdict()` (`16978-16988`) is
worst-wins with pinned rows outside the vote; `gpReadyCardHtml()` (`16997-17032`) shows
one line, and expanded shows only what is wrong. Its own comment says why: *"Nine rows
of mostly-fine was a panel you had to read to learn nothing."* Same shape, same
reasoning, different subject — and **not the same function**: the Ready card only
renders with a connected node (`dev && dev.traceRead`, `17045`), which is exactly the
guard a session-health card must not inherit.

## What already exists — the signal inventory

Everything below is computed today. Nothing in this list needs deriving.

| Signal | Where | State |
|---|---|---|
| GNSS gaps, and gaps that also break the clock | `gpMarkBreaks(rows)` `24163-24188` sets `brk` / `brkTime` / `brkM` per sample; aggregate `gpRunBreakM` `24192-24200` | In memory on every load (single call site `gpComputeG:20598`); **never persisted** |
| Quiet CAN channels | `gpChanQuiet()` `18528-18555`, self-validating cache | Shown as per-lane sentences `18599-18630`; no session-level roll-up |
| Drift fit quality | `gpDriftAngle()` → `scale`, `bias`, `fitN`, `weak` `22623-22626` | Only `weak` leaks out, as prose at `23692-23717` |
| Anchor count and worst leg error | same call → `anchors`, `worst`, `sigma` | Partly in the slip-lane note `18287-18299` |
| Lap timing provenance | `meta.lapsBy` = `"gate"` / `"stops"` / `null` (`11488-11491`) | Persisted; drives the card wording, not a verdict |
| Why there are no laps | `gpNoLapsWhy()` `21737-21800` — line too far, clipped, wrong-way crossings with counts | On demand only |
| Run flags | `gpGradeRuns` → `flag: "jump" / "gap" / "slow"` (`21594-21617`) | One-word chips in Lap times `15873-15896` |
| GPS position noise | `gpSmoothNoise(rows, kap)` `24767-24795`, cached `gp.pathSigma` | **Computed and never displayed** |
| Video coverage of the lap | `gpVideoCover()` `28355-28369` → `{from,to,lapFrom,lapTo,frac}` | Used by the video panel only |
| Video decode health | `gpVideoWatch()` `28463-28477` sets `v.dead` | Rendered at `16090` |
| Ring wrapped / dropped samples | puck `trace.info` → `gp.traceInfo.wrapped` / `.dropped` | **Lost at save** — `gpSessionLoad` overwrites `gp.traceInfo = {used_samples: rows.length}` at `11876` |
| Download hole count | local `holes` counter in `gpTraceDownload` `20926` / `20965` | **Counted and discarded** |

Three of those are free wins nobody has ever seen: `pathSigma`, the `holes` counter, and
the full drift fit.

## File-level plan

All edits are in `src/tauri-overlay.html` unless stated.

### 1. `gpHealth()` — the facts

New function next to the Moments block (it is the same kind of thing: a pass over
derived signals, memoised on a key). Returns `{ rows: [...], verdict: {tone, n} }` with
rows in the Ready card's shape `{k, v, tone, sub, fix, wait, pin}`.

Memoise exactly like `gpMoments()` does (`13470-13476`): key on
`rows.length + ":" + traceLaps.length + ":" + ghostFence`, cached in
`gp.healthKey` / `gp.healthCache`. Do **not** key on `recordedAt` — it is rewritten by
`gpHealFutureDates` (`11652-11665`).

Rows to build, each with its own tone:

- **Fix** — `gpRunBreakM` over the analysed range. `bad` when any `brkTime` break exists
  ("a lap time was invented across it"), `warn` for `brk` alone. Say the metres and where.
  Guard: `gpMarkBreaks` self-reverts above `GP_BREAK_MAX_FRAC` (2%) and returns nothing
  (`24179-24186`) — so "no breaks" can mean "the test did not apply to this import".
  Say that case differently; do not report it as clean.
- **Position noise** — `gpSmoothNoise` sigma in metres, first time it has ever been shown.
- **Timing** — from `gp.lapsFrom`. `"gate"` is ok; `"stops"` is `warn` with the
  `gpNoLapsWhy()` sentence as `sub`; `null` is `bad`. This is the road-drive-advertising-
  eleven-laps failure (`ses_mt2j3ra92fr`) said out loud.
- **Flagged runs** — count of `gp.traceLaps.filter(l => l.flag)`, worst flag as `sub`.
- **Channels** — `gpChanQuiet()` roll-up: *"3 of 12 channels said nothing"*, and the
  whole-bus case as its own sentence (the 22 Aug Falcon: 12 channels, 8103 samples, all
  quiet — puck in a different car).
- **Angle** — the item-1 row, and the important one. Draw from the single
  `gpDriftAngle()` return:
  - `weak` → `bad`, *"scale could not be fitted — not enough grip driving in this
    recording"*, `sub` naming what would fix it (*"a few corners driven on the limit
    without sliding"*).
  - `fitN` below a floor → `warn` with the sample count.
  - `scale` outside ~0.95–1.05 → `warn`, showing the number, because a real 1.008 is
    fine and a real 1.24 that survived the refusal band is a mounting problem.
  - `anchors === 0` → `warn`, *"nothing to close the legs against"* (this is the
    per-corner `soft` condition, `22817`).
  - `worst` above the typical `sigma` by a wide margin → `warn`, and this is the row
    that would have caught Mallala.
  Show `scale`/`bias`/`fitN` as the expanded detail even when the row is `ok`. That is
  the whole of item 1's value: the number becomes visible before it becomes a mystery.
- **Video** — only when `gpVideoLinked(meta)`. `frac` from `gpVideoCover()` below ~0.9 →
  `warn`; `v.dead` → `bad` with the existing *"Make a playable copy"* fix button
  (`gpVideoConvert` `28479-28492`) reused as the row's `fix`.
- **Download** — `wrapped` / `dropped` / `holes`, but only once those are persisted
  (step 3). Absent on every old session; render nothing rather than "0".

Verdict: copy `gpReadyVerdict`'s worst-wins shape (`16978-16988`) rather than importing
it — the Ready card's `wait` tone has no meaning for a finished recording, and sharing
the function would drag that concept in.

### 2. The panel

- `GP_PTYPES` at `14194-14212` — add `{ id: "health", label: "Can I trust this?" }`.
  Not `solo` (it hosts no singleton element).
- Render switch at `16330-16339` — add `else if (p.type === "health") h2 +=
  gpPanelHealthHtml();`, following `gpPanelMomentsHtml`'s shape at `13616-13639`.
- `gpPanelHealthHtml()` — one verdict line, then only the rows that are `bad`/`warn`,
  with a disclosure that shows everything checked. Reuse the `.gp-rows` / `.gp-row`
  classes the history panel already uses; add `#gpWorkspace`-scoped CSS only for the
  verdict banner if the Ready card's classes don't transfer.
- Consider adding it to a `GP_PRESETS` entry (`14247-14266`) so it appears without
  being hunted for.

### 3. Persist what is lost at save

Two small additions to `gpSessionMeta(rows, id)` (`11430-11508`), which is where a
download's facts are frozen:

- `ring: { wrapped, dropped, holes }` — from `gp.traceInfo` plus the `holes` counter,
  which needs returning from `gpTraceDownload` instead of being dropped at `20965`.
- `health: { tone, n }` — the verdict only, so the Sessions list can badge without
  loading rows.

`health` must **also** be recomputed in the heal block at `11943-12044`, which already
rewrites `lapCount` / `bestLapS` / `corners` when re-splitting changes the answer, and
must mirror into the in-memory `gp.sessions` row the same way (`12032-12043`) — the
list reads `gp.sessions`, not the store.

Keep both objects tiny. `gpStore.list()` deserialises every meta for the rail and the
Sessions table.

### 4. The Sessions badge

`gpRenderSessions()` `13222-13430` — one cell beside the existing Data badge at `13325`,
tinted by `meta.health.tone`, absent when the field is (every session saved before this
lands). Do not compute it on the fly there: the whole point of storing the verdict is
that the list stays metadata-only.

## Traps

- **`brk` / `brkTime` / `flag` are volatile.** Recomputed on every load, never stored.
  The panel can derive everything from a loaded trace; the *badge* cannot, which is why
  step 3 exists.
- **`gpChanQuiet` is O(n·m) with a self-validating cache** (`18528-18540`). Call it,
  never re-scan.
- **Meta objects are shared identity.** Edit the object from `gpCurSessionMeta()`
  (`28242-28247`) and write with `gpStore.putMeta`. A fresh object forks the list from
  the store.
- **Reload before writing stored meta** (memory: the 316-week video-date repair). A
  heal may have rewritten `recordedAt` underneath you.
- **The Analyse mosaic re-parents singletons through `#gpHold`** (`16354-16363`). A new
  non-solo panel is safe, but a plain `innerHTML` rebuild anywhere near the map or the
  rack kills Leaflet and the canvases. `gpRenderGridSoft` exists for value-only refreshes.
- **Plain language, ruled rows.** No `weak`, no `fitN`, no `σ` on screen — "the scale
  could not be fitted", "measured from 4,100 samples", "typically ±1.4°". One fact per
  column.

## Tests

New `tools/check_health.js`, Model B (verbatim extraction + `new Function` sandbox — copy
`tools/check_laps.js`'s structure). Pin:

- Worst-wins verdict, and that a `pin`ned row cannot set it.
- Each row's tone at its threshold and one step either side.
- **`brk` absent because `gpMarkBreaks` self-reverted reads differently from `brk`
  absent because the trace is clean** — this is the one that will regress.
- The `weak` fit, `anchors === 0`, and out-of-band `scale` cases each produce their
  own row, using a stubbed `gpDriftAngle` return.
- An old meta with no `health` / `ring` fields renders the panel and badges nothing.
- Once brief 2 lands: the 23 Aug Mallala recording produces a **non-ok** angle row.
  That is the regression test this whole feature exists for.

## ADR-0049 — *A recording says how much to trust it*

Worth an ADR because two decisions here will be questioned again: that the verdict is
**worst-wins over rows that each carry their own tone** (rather than a score), and that
**item 1 became transparency rather than a calibration wizard**. Record the measured
numbers — 0.964 vs 1.008 from the naive regression, 0.936 from an unmasked drift lap,
and the +54°/−48° corner that closed perfectly at both anchors — because they are the
evidence that a wizard would not have caught it.

## Item 1b, deferred — the mounting-axis routine

Not in scope. Written down so it isn't re-derived:

- The gap the per-session fit cannot close is **mounting**: the 0.8–1.25 refusal band
  falls back to `scale = 1` rather than saying "this puck is in sideways".
- The firmware already has the pieces: `imu_cal_t` carries `dir[3]` (board→vehicle axis
  map) and `gyro_bias_cdps[3]`; `imu_cal_valid` has the handedness check;
  `imu_cal_acc_finish` is a written stationary-bias estimator that refuses if the unit
  moves. All in `../rdm-gps-node/main/imu/`.
- Only yaw reaches the trace today: `trace_sample_t.gyro_z_2cdps`, 2 centi-deg/s per LSB
  (`../rdm-gps-node/main/storage/trace_log.h:88-94`) — deliberately coarse because a
  hard drift transition hits 339°/s and would clip at ±327°/s at 1 cdps.
- Recording roll and pitch is **pre-authorised**, not risky: the struct comment at
  `trace_log.h:73-79` says *"Yaw only, not the full six axes… If either changes, this
  struct grows again and the magic bumps again — that is what the magic is for."*
- But it is a firmware change in `rdm-gps-node`, with a magic version bump — so read
  `../RDM-7_Dash/docs/STUDIO_SHELL_PLAN_2026-07.md` §2.0 for which repo owns the UI
  before scoping it.
