# moments-analysis

## findings

# Auto-highlights raw material — analysis features inventory

All line refs are `src/tauri-overlay.html` (the GPS workspace IIFE) unless stated. Everything below is desktop-first code; nothing here touches `firmware-base.html`.

## 1. Moments

**Block header/comment:** `tauri-overlay.html:13444-13458` ("Moments — the bits worth watching again"). Deliberately a SHORT list; every entry is a real measurement with its number attached.

**Object shape** (built in `add()` at 13494-13497):
```js
{ icon: "⚡", name: "Top speed", i: <sample index>, value: "184 km/h", why: "The fastest the car went all session." }
```
- `i` is a **single sample index** into `gp.trace` — NOT a time range. The UI shows one timestamp per moment.
- `value` and `why` are preformatted display strings (unit conversion already applied via `gpSpdN`/`gpSpdU`).

**Moment types**, all detected inside `gpMoments()` (13470-13588), each with a gate threshold:
| icon | name | source signal | gate | line |
|---|---|---|---|---|
| ⚡ | Top speed | `rows[i].kph` max | > 30 kph | 13499-13502 |
| ▼ | Hardest braking | `-rows[i].g` max (long. g negative under brakes) | > 0.35 g | 13506-13508 |
| ◐ | Highest cornering | `Math.abs(ch.glat[i])` from `gpChannels()` | > 0.4 g | 13510-13514 |
| ↻ | Biggest slide | `Math.abs(drift.beta[i])` where `drift.ok[i]`, from `gpDriftAngle()` | ≥ 12° | 13518-13522 |
| ▶ | Best launch | speed GAIN over a ~4 s window (`W = round(4/0.04)` samples), start must be < 25 kph | gain > 40 kph | 13526-13538 — the only windowed one; `add()` gets `bFrom` (window start), the range end `bi` exists locally but is not stored |
| ↪ | Nearly lost it | `rows[i].gyroz` (puck gyro) or `ch.yaw[i]` fallback, kph ≥ 15 | ≥ 90 °/s | 13543-13555 |
| ⚑ | Fastest lap/run | fastest non-ghost lap via `gpSpanSecs`, only when `gp.lapsFrom === "gate"` | — | 13557-13572; `i` = `gp.traceLaps[bl].from` (lap START index), value formatted `m:ss.mmm` |

**Dedup:** 13574-13584 — sorted by `i`, two finds with the same name within `GP_MOMENT_GAP_S = 4` s (13459, converted at hardcoded 0.04 s/sample: `gap = 4/0.04`) keep the first.

**Storage:** **recomputed each load, never persisted.** Memoised in-memory only: `gp.momentsKey`/`gp.momentsCache` (13473-13475, 13585-13586), key = `rows.length + ":" + traceLaps.length + ":" + ghostFence + ":" + gp.spdUnit`. Not written to `gpStore` (IndexedDB `rdm7_sessions_db`, defined 10247-10248); session meta carries no moments field (meta shape at 11467-11507).

**UI:** panel type `{ id: "moments", label: "Moments" }` registered in `GP_PTYPES` at 14201; rendered by `gpPanelMomentsHtml()` (13616-13639) via the panel switch at 16333 (`p.type === "moments"`). Each moment is a `<button class='gpb-moment'>` with icon/name/value/timestamp; timestamp from `gpMomentWhen(i)` (13461-13468) = `m:ss` into the recording (`(rows[i].t - rows[0].t)/1000`, fallback `i*0.04`). The panel also hosts the **"Save share card…"** button (13627-13629). CSS: `#gpWorkspace .gpb-moment` 3822-3840.

**Click → jump:** `window.gpMomentGo(n)` (13590-13614): if `m.i` outside `gpLapRange()`, widens to whole session via `gpLapAnalyse(-1)`; sets `gp.playIdx = m.i`; `gpPlayStop(); gpSyncScrub(); gpDrawPlayhead(); gpDrawTrace();` then **`gpVideoFollowSeek(true)`** (13607) — so clicking a moment already seeks the linked video to it — plus `gpVideoDrawOverlay()`, optional `gp.map.panTo(gpDrawnAt(m.i))`, `gpRenderGridSoft(); gpRenderInspector()`.

## 2. Corner detection and per-corner scoring

### Grip-lap corner detector (shared)
`gpFindCorners(rows, from, to)` — 24292-24469. Returns array of `{ entry, apex, exit, byHeading? }` (all sample indices), sorted by entry (24467). Two passes:
- **Speed-minimum pass** (24311-24387): smooth 0.24 s window, local minima with ≥ `max(10, peak*0.12)` kph drop on BOTH sides; corners claimed by ENTRY index (`entry < from || entry >= to` → skip, 24376); corners clipped by the recording's edge are dropped (24385). Uses `gpCornerScan` (24273) to reach past lap ends and `gpHz` (24264) so 10 Hz imports get the same detector shape.
- **Heading-rate pass** (24389-24466) for sweepers the speed trace can't see: turn rate ≥ `GP_TURN_DPS = 6` °/s (24246) held `GP_TURN_MIN_S = 0.6` s (24247) through `GP_TURN_MIN_DEG = 25`° total (24248); apexes within `GP_TURN_SAME_S = 1.5` s of a speed-corner are the same corner (24249, `claimed()` 24431). These get `byHeading: true` (24465).

`gpCornerPhases(rows, c)` — 24475-24506. Returns `{ bounds: [entry, brakingEnd, apexStart, apexEnd, exit], names: ["Braking","Entry","Apex","Exit"], apexIdx, minKph, brakeIdx, coast_s, exitKph }`. Thresholds `GP_COAST_G = 0.05`, `GP_BRAKE_G = 0.15` (24061-24062; `GP_BRAKE_G` is also the tail-light rule — shared on purpose, 26935).

### Lap-vs-reference corner comparison ("ops")
`gpCompareLaps(rows, sel, ref)` — 24545-24626. Corners detected on the REFERENCE lap, boundaries mapped onto the analysed lap by GPS position (`gpNearestIndex` 24512-24539, 40 m rejection at 24569). Output element ("op") shape (24614-24623):
```js
{ n, entry, apex, exit,            // reference-lap indices
  selEntry, selApex, selExit,      // analysed-lap indices
  phases: [{name, ref_s, sel_s, delta_s} x4],
  total_s, clipped, brakeLater_m, minKph_d, exitKph_d, coast_d }
```
Cached by `gpCoachOps()` (20216-20225) keyed on `(gp.selLap, gp.cmpLap)` in `gp.coach`. Insight chaining (`gpCoachInsights` 20256-20328) produces `{kind: "chain"|"corner"|"straight", total_s, focus, a, b, ...}`; `gpPrescribe(op)` (24633-24667) turns the worst phase into coaching text; `gpTopOpportunities(ops, n)` (24671-24677).

**Corners view:** `gpCornerOps()` 23924-23940 (auto-picks closest challenger when no selLap), `gpRenderCorners()` 23963+, `gpCornerPick(n)` 23948-23961 (fits map bounds to `o.selEntry..o.selExit`).

### Drift corners-per-lap, out of 5
Doc: `docs/DRIFT_MODE_PLAN_2026-08.md`. Version stamp `GP_DRIFT_SCORE_VER = 4` (22055).
- `gpDriftRefLap()` 22845-22864: reference lap = first lap whose corner count equals the modal count.
- `gpDriftCorners()` 22872-22919: returns `{ refLap, corners: [{n, entry, apex, exit, lat, lon}], per: per[lapIdx][c] = {from, to, apex} | null }` (null = that lap did not drive that corner; same 40 m rule). Cached `gp.driftCorn`/`driftCornKey`.
- `gpDriftCornerRead(span)` 22927-23013: `{ from, to, apex, secs, kph, entryKph, exitKph, lowKph, switches, angle, settle, commit, metres }` — `angle` from `gpDriftStats` is `{ peak, held, secs, area, conf, rough, direct, soft }` (22815-22817); `settle` = RMS of sideslip-rate residual against a 1.2 s rolling mean of itself (22973-23012).
- `gpDriftSpun(span)` 23029-23061: spin gate, `{why: "over"|"dropped", deg, at, conf}` or null. `GP_DRIFT_SPIN = 100`°, `GP_DRIFT_SPIN_DROP = 45`° (22033, 22038).
- **`gpDriftStars(read, bestKph)` 23074-23111** — the out-of-5 rating: returns `{ parts: {angle, commit, steady, speed}, score /*0..1*/, stars /*half-star 0..5: Math.round(s*10)/2*/, ver }`. Weights `GP_DRIFT_STAR_W = { angle: .45, commit: .25, steady: .20, speed: .10 }` (22054); full marks: `GP_DRIFT_STAR_DEG = 40`° held (22012), `GP_DRIFT_STAR_SETTLE = 14` °/s (22023). Returns **null** (unrated, not 0) for: no angle / rough angle (23075), spin (23083), sideways < `GP_DRIFT_HOLD_S = 0.5` s (23089, 21992).
- **`gpDriftBoard()` 23183-23265** — the one thing the view reads: `{ refLap, corners, units, link, cells, best, lapAvg, bestKph }`. `units` from `gpDriftLinkMap`/`gpDriftUnits` (23137-23181; linked complexes rated as one unit — a unit is `{i, members, linked, n0, n1, name /*"Turn 3"|"Turns 3–5"*/, lat, lon}`); `cells[lap][unit]` = read with `.spun` and `.rating` attached (23221-23240); `best[unit]` = owning lap index (23243-23250); `lapAvg[lap]` = `{stars, n}` mean (23255-23259). Cached at `gp.driftBoard`/`driftBoardKey` (state at 8507).
- `gpDriftBest()` 23271-23288: best drift lap = highest `lapAvg.stars` (fallback: most corner speed, always ranked below any rated lap).
- Stars glyphs: `gpStarsHtml(v)` 23292-23301.

## 3. Best lap / ideal lap / delta

### Lap set + lap times
- Laps live in `gp.traceLaps` — spans over the single `gp.trace` rows array. Span shape from `gpSplitRows` (21436): `{ from, to, tFrom, tTo }` (21460, 21517 — `tFrom/tTo` are interpolated gate-crossing instants in ms), plus `flag: null|"jump"|"gap"|"slow"` + `flagM`/`flagMs` (21594-21617) and `ghost: true` for cross-session ghost laps (33584-33615).
- `gpSplitLaps()` 21644-21702 rebuilds them and clears every derived cache; `gp.lapsFrom = "gate" | "stops" | null` (21683, 21934). Fallback run-splitting at stops: `gpMoveRuns` 21838-21867 (`GP_RUN_STOP_KPH=8`, `GP_RUN_STOP_S=5`, `GP_RUN_MIN_S=8`, 21834-21836).
- A lap's time = `gpSpanSecs(gp.trace, lap)` (21301-21305): `(tTo - tFrom)/1000` when interpolated ends exist, else `gpSecs(rows, from, to)`.

### Best lap
- **Live/derived:** the comparison reference auto-picks the fastest non-flagged lap on split — 21688-21701 (`gp.cmpLap = bi`); rail's best = min over `!l.flag` (15828-15832); clean laps = `gpCleanRuns()` 21625-21627 (`!ghost && !flag`).
- **Persisted:** session meta (built in `gpSessionMeta`, 11467-11507) carries `lapCount`, `bestLapS`, `lapTimesS[]` (rounded ms), `lapsBy` ("gate"/"stops"/null), and `corners` — a fingerprint of the best lap's corners `[{lat, lon, kph, s}]` from `gpFindCorners` (11449-11466). Healed on every reopen at 11989-12044 (never demoting gate laps when the library lost the track, 12000-12001; re-derives `meta.corners` at 12025-12031) and written through `gpStore.putMeta` (12043). Meta store = IndexedDB `rdm7_sessions_db` / `meta` object store (10247-10263). History views read only these meta fields (`gpHistoryFor` 11516+, "who timed this lap": `lapTimesS`/0.04 memory note).

### Ideal lap
There is **no ideal-lap trace** — the ideal is a NUMBER: sum of session-best sector times.
- `gpSessionSectors()` 17519-17536: `gp.sectors = { per /*[lap]→[sector s]|null*/, best /*[sector s]*/, owner /*[lap idx]*/ }`, cached on `gp.secKey`.
- Ideal computed as `S.best.reduce((a,b)=>a+b)` at 12599 (Analyse rail, shown as row "Ideal lap" 12600-12605), 12728-12729 (tag), and in `gpSplitsStats()` at 17620-17621 (splits report; also "on the table" = `best − ideal`, 17932-17934). Purple sector chips: `gpSectorChips` 17541-17565.

### Delta trace
- `gpDeltaSeries()` 18656-18682: `Float32Array(sel.to - sel.from + 1)` of cumulative seconds (positive = analysed lap behind). Matches by GPS position with a forward-sliding window (lo = j−25, hi = j+120, 18671), `out[i] = gpSecs(sel.from..sel.from+i) − gpSecs(ref.from..best)`. Cached `gp.delta`/`gp.deltaKey` = `selLap:cmpLap` (8424). Drawn as the strip lane under speed (comment 18649-18655); re-zeroed at zoom edges à la Circuit Tools (18684-18694). Read at the playhead by `gpTcUpdate` (`dser[gp.playIdx - r.from]`, 27640-27646) and by the HUD lap-time/delta widget.
- "Where the other laps are at this moment" (map ghosts): 26368-26510 — same-moment-into-lap positioning, separate from the delta series.

## 4. Share card (precedent for generated summary media)

Block 13748-13916.
- **Data:** `gpShareStats()` 13760-13791 → `{ track, when, car, driver, laps, best, topKph, maxLat, maxAngle, durS }` — all from the same functions the screen uses (`gpCurSessionMeta`, `gpChannels`, `gpDriftAngle`, `gpSpanSecs`; best only when `gp.lapsFrom === "gate"`, 13777).
- **Render:** `window.gpShareCard()` 13799-13916. Offscreen `document.createElement("canvas")`, fixed 1200×675 at S=2 scale (13805-13809), dark ground `#0c0d0e`. Left: driven path in **Mercator** (both axes in radians — the degree/radian mismatch bug is documented 13816-13819), drawn segment-by-segment coloured by `gpSpeedColour(kph/topK)` (13841-13848), samples < 5 kph skipped. Header: track/date/car/driver (13850-13858). Right: up to 6 stat cards with red accent bar `#d2232a` (13860-13889): Best lap, Top speed, Max cornering (>0.2 g only), Max angle (≥12° only), lap count, Time out. Bottom: speed colour scale legend + "RDM Studio" mark (13891-13904).
- **Export path:** `cv.toBlob(... "image/png")` → `<a download="rdm-<track-slug>.png">` + `a.click()` + `URL.revokeObjectURL` (13906-13915), toast "Share card saved.". **Note: unlike video export, it does NOT use the Tauri save dialog** — compare `gpSaveVideoBlob(blob, name)` (31220-31244), which prefers `RDM.saveFileDialog` + `RDM.writeFile` under Tauri and falls back to the `<a download>` browser path. `gpSaveVideoBlob` is the better save precedent for new generated media.

## 5. Lap → video time mapping

All in the video sync layer, 28189-28290:
- `gpSampleUtc(i)` 28253-28259: UTC ms of sample i = `meta.recordedAt + (rows[i].t − rows[0].t)` (fallback `i*40`). Needs `gpCurSessionMeta()` (28242-28247, with the `gp.sessionMeta` stash fallback closed by `check_videot0.js`).
- **`gpVideoTimeFor(i)`** 28262-28267: seconds into the video = `(gpSampleUtc(i) − v.t0 − v.offsetMs)/1000`; **returns null while unsynced** (`!gp.video || v.t0 === null`).
- **`gpIndexForVideoTime(ct)`** 28271-28288: inverse, binary search over sample timestamps, clamped to `[0, ghostFence)`.
- So for lap L: video start = `gpVideoTimeFor(gp.traceLaps[L].from)`, end = `gpVideoTimeFor(gp.traceLaps[L].to)`. This is EXACTLY what the export already does: `gpExportPlan(opt)` 30818-30854 with `opt.range === "lap"` maps `gpLapRange()` endpoints through `gpVideoTimeFor` and clamps into `[0, duration]` (30826-30833); refuses spans < 0.2 s (30834).
- Coverage/overlap: `gpVideoCover()` 28355-28369 → `{from, to, lapFrom, lapTo, frac}` (fraction of analysed lap the footage covers); `v.noOverlap` set by `gpVideoAutoAlign` 28165-28181 when session and footage don't overlap at all (falls back to start-together).
- `gp.video` object shape (built in `gpVideoBegin`, 28613-28622): `{ name, url, blob, path, reader, size, t0 /*UTC ms of first frame*/, fileT0, src: "log"|"cam"|"start", autoT0, autoTz, offsetMs, follow, probing, tzHours?, noOverlap?, dead? }`. Sync priority (comment 28290-28302): `log` (meta.videoAnchorMs, e.g. VBOX avisynctime) > `cam` (file creation clock via `gpVideoProbeT0` 28118-28132 / `gpMp4CreationInfo`, timezone-snapped by `gpVideoTzFix` 28189-28221) > `start` (assume started together). `gpVideoSyncSet(which)` 28325-28347 applies one and returns success.

**Not all sessions have video.** Video is opt-in per session: linked via `meta.videoPath` / `meta.videoSrc` / `meta.videoOffsetMs` on the session meta (`gpVideoLinked` 28402-28404, `gpVideoLink` 28406-28418, `gpVideoLinkSync` 28422-28428), re-attached on open by `gpVideoRelink(meta)` 28433-28450 (Tauri-only; silently drops a moved file). **Branching when there is none:** `gp.video` is simply null — `gpVideoTimeFor`/`gpVideoFollowSeek`/`gpVideoDriveTick` all early-return on `!gp.video`; `gpPlayToggle` computes `vt = gp.video && gp.video.follow ? gpVideoTimeFor(...) : null` (27749) and falls through to the index ticker; the video panel shows "Open a video…" (`gpVideoHtml` 33535-33552). Export refuses with a toast when no video or `t0 === null` (30859-30868).

## 6. Playback of a time range (commit 19014ef "video beside the lap")

The analysed range is always `gpLapRange()` (21944-1949): the selected lap's span, or `{from: 0, to: end−1}` for the whole session. Selecting: `window.gpLapAnalyse(i)` 14611-14619 → `window.gpSelectLap(i)` 27905-27935 (holds your place across laps via `gpSameSpot`, calls `gpPlayStop`); reference: `gpCompareLap` 27936-27940.

**Who drives the replay** (doc table `VIDEO_HUD_EXPORT_2026-08.md:576-585`, pinned by `tools/check_transport.js`):
- `window.gpPlayToggle()` 27729-27758: if `gp.video.follow` and the playhead maps inside the footage (`vt >= −0.25 && vt < duration − 0.05`), the **video element is the transport**: `el.currentTime = vt; el.playbackRate = gp.playRate; el.play()`. Otherwise `gpPlayResumeTicker()`.
- `gpPlayResumeTicker()` 27826-27896: 50 ms setInterval, position derived from wall clock × `gp.playRate` in SECONDS (never sample counts); hands over to the video mid-play the tick the playhead walks into coverage (27879-27891); at the lap's end calls `gpPlayRollOver()`.
- `gpPlayRollOver()` 27792-27814: rolls into the next non-ghost lap (updates `gp.selLap`, `gp.playIdx = laps[i].from`) or widens to the whole session; `gpPlayLapRolled()` 27819-27824 re-renders.
- `gpVideoDriveStart()` 28911-28928 + `gpVideoDriveTick()` 28859-28905: per-video-frame loop (`requestVideoFrameCallback`) that maps `el.currentTime` back to `gp.playIdx` via `gpIndexForVideoTime`, clamped to `gpLapRange()`, rolling over at the lap line the same way.
- `gpVideoFollowSeek(force)` 28977-28993: seeks the element to `gpVideoTimeFor(gp.playIdx)` — only when paused unless `force` (a deliberate transport move passes true: `gpTransport` 27672-27683, `gpScrubTo` 27691-27699, `gpMomentGo` 13607, coach jump 17835).
- Element events wired in `gpVideoBind()` 33476-33533: `play` starts the drive loop and kills the ticker; `pause` stops the replay only while following; `ended` hands back to the ticker if the lap isn't finished (33528-33531).
- `gpDrawPlayhead()` 27545-27594 is the single funnel every playhead move goes through (video seek + overlay + strip + dock + map marker/car).
- Playback rates `GP_RATES = [1, 2, 4, 10]` (27685); `gpPlayStop()` 27721-27727 pauses the element too.

## 7. Existing highlight/reel/segment concepts

- **`docs/STUDIO_IDEAS_2026-08.md` §5 "Auto-highlights" (lines 48-53):** "Moments, best lap, corner scoring and a fast exporter all exist. 'Make me a forty-second reel of this session' — best lap, biggest slide, latest brake — is mostly assembly of parts that are already built, and it is the feature that gets the app shared." Related: §6 (55-58) two-lap comparison video ("the exporter already does the hard parts"), §7 (60-63) background exports ("a 40-second export currently owns the app"), §3 (33-39) golden-recording regression tests.
- **The only segment-cutting exporter today:** `gpExportPlan` `range: "lap"` (30818-30854) — one contiguous span per export, chosen in the dialog (`gpVideoExport` 30856-30880, `gpExportDlgDraw` 30882+, "Lap N / just the part being analysed" vs "The whole video"). No multi-segment concatenation exists anywhere. Export pipeline: fast path = own MP4 demux (`gpFmp4Scan`), WebCodecs decode → `gpHudRender` per frame → `VideoEncoder` → `gpMp4Build` mux, audio copied byte-for-byte (`gpCopyAudio`, sound unconditional per `gpExportPlan` `audio: true` 30852); slow fallback = captureStream + MediaRecorder; save via `gpSaveVideoBlob` (31220). Entry `gpExportRunNow(p, waited)` 31001. Full description: `docs/VIDEO_HUD_EXPORT_2026-08.md` (whole file; "The export" section, and the IPC byte-transfer table at 536-545).
- **Moments panel** is the in-app "list of the bits worth watching again" (Q1) — single points, not ranges.
- **Drift segments** `gpDriftSegments()` (referenced 23145) are contiguous sideways runs `{from, to}` used for link detection — the closest thing to a segment list in the analysis engine.
- Harnesses relevant to any reel work: `tools/check_export.js` (93 checks), `check_transport.js` (18), `check_videot0.js` (23), `check_hud.js` (223) — listed in `docs/VIDEO_HUD_EXPORT_2026-08.md:4-7`.

## data_shapes

## Moment (in-memory only, gpMoments() → array; tauri-overlay.html:13494-13497)
```js
{ icon: "↻", name: "Biggest slide", i: 18342 /* single sample index */, value: "47°", why: "The largest angle between where the car pointed and where it went." }
```
Cache: `gp.momentsKey` (string), `gp.momentsCache` (array) — key `rows.length+":"+laps+":"+ghostFence+":"+spdUnit` (13473-13474). `GP_MOMENT_GAP_S = 4` (13459).

## Lap span (gp.traceLaps[], gpSplitRows 21436/21460/21517)
```js
{ from: 1200, to: 4800,            // sample indices into gp.trace
  tFrom: 1723456789012, tTo: ...,  // interpolated gate-crossing UTC-ish ms (gate laps only)
  flag: null | "jump" | "gap" | "slow", flagM: 0, flagMs: 0,   // 21594-21617
  ghost: true }                     // only on cross-session ghost laps (33584+)
```
`gp.lapsFrom = "gate" | "stops" | null` (21683/21934). Lap seconds: `gpSpanSecs(rows, span)` 21301-21305.

## Trace row (gpRowsUnpack, 10380-10383)
```js
rows[i] = { lat, lon, kph, hdg, t /*ms|undefined*/, g /*long. g, negative braking*/, can: [..]|null, gyroz /*°/s|undefined*/, brk? /*break-before-sample flag*/ }
```

## Session meta (gpSessionMeta 11467-11507; store: IndexedDB "rdm7_sessions_db"/"meta", keyPath "id", 10247-10258)
```js
{ id, name, trackId, trackName, trial, recordedAt, dated /*"gps"|...*/, savedAt, startT, device,
  samples, durationS, lapCount, bestLapS, lapTimesS: [123.456, ...], lapsBy: "gate"|"stops"|null,
  corners: [{lat, lon, kph, s}],   // best lap's corner fingerprint
  chanIds, chanDefs, car, driver,
  // video link (added by gpVideoLink 28406-28418):
  videoPath, videoSrc: "log"|"cam"|"start", videoOffsetMs, videoAnchorMs? /* log's own figure */ }
```
Healed on reopen at 11989-12044.

## Coach op (gpCompareLaps 24614-24623)
```js
{ n, entry, apex, exit, selEntry, selApex, selExit,
  phases: [{ name: "Braking"|"Entry"|"Apex"|"Exit", ref_s, sel_s, delta_s }],
  total_s, clipped, brakeLater_m, minKph_d, exitKph_d, coast_d }
```
Cache `gp.coach = { sel, cmp, ops, insights? }` (20218-20223, 20326).

## Drift board (gpDriftBoard 23261-23262)
```js
{ refLap, corners: [{n, entry, apex, exit, lat, lon}],
  units: [{i, members, linked, n0, n1, name, lat, lon}], link: [bool],
  cells[lap][unit]: { from, to, apex, secs, kph, entryKph, exitKph, lowKph, switches,
                      angle: {peak, held, secs, area, conf, rough, direct, soft}|null,
                      settle, commit, metres,
                      spun: {why:"over"|"dropped", deg, at, conf}|null,
                      rating: { parts: {angle, commit, steady, speed}, score, stars /*0..5 halves*/, ver } | null,
                      members? } | null,
  best: [lapIdx per unit], lapAvg: [{stars, n}|null], bestKph: [kph per unit] }
```
Constants: `GP_DRIFT_SCORE_VER=4` (22055), `GP_DRIFT_STAR_W={angle:.45,commit:.25,steady:.20,speed:.10}` (22054), `GP_DRIFT_STAR_DEG=40` (22012), `GP_DRIFT_STAR_SETTLE=14` (22023), `GP_DRIFT_ON=10` (21990), `GP_DRIFT_HOLD_S=0.5` (21992), `GP_DRIFT_SPIN=100` (22033), `GP_DRIFT_SPIN_DROP=45` (22038).

## Delta / sectors
`gpDeltaSeries()` → `Float32Array(sel.to−sel.from+1)` cumulative seconds, cached `gp.delta`/`gp.deltaKey = selLap+":"+cmpLap` (18656-18681, state 8424).
`gpSessionSectors()` → `gp.sectors = { per: [lap]→[secs]|null, best: [secs], owner: [lapIdx] }` (17526-17534). Ideal = `S.best.reduce(+)` (12599, 17620-17621).

## gp.video (gpVideoBegin 28613-28622)
```js
{ name, url, blob: bool, path: string|null, reader /*{size, read(off,len)}*/, size,
  t0: /* UTC ms of first video frame */ | null, fileT0 /* log anchor, do not overrule */,
  src: "log"|"cam"|"start", autoT0, autoTz, offsetMs, follow, probing,
  tzHours?, noOverlap?, dead?, driving?, _driving? }
```
Mapping: `videoSecs = (gpSampleUtc(i) − t0 − offsetMs)/1000` (`gpVideoTimeFor` 28262-28267); inverse `gpIndexForVideoTime(ct)` 28271-28288.

## Export plan (gpExportPlan 30852-30853)
```js
{ t0, t1, secs, W, H, bps, mime, audio: true }   // t0/t1 = seconds into the video; range "lap" maps gpLapRange() through gpVideoTimeFor
```
Options object `gp.exp = { range: "lap"|"all", quality: "high"|"max", maxH: 0|1080 }` (30874).

## Share card save path (gpShareCard 13906-13915)
`canvas.toBlob("image/png")` → `<a download="rdm-<slug>.png">.click()`. Video precedent `gpSaveVideoBlob(blob, name)` (31220-31244): Tauri `RDM.saveFileDialog(name, [{name:"Video", extensions:[ext]}])` + `RDM.writeFile(path, Uint8Array)`, browser `<a download>` fallback.

## gotchas

- **Moments are single sample indices, not ranges.** A reel needs ranges; only "Best launch" even computes one internally (13526-13538) and it discards the end index. The fastest-lap moment's `i` is the lap's `from`, and the lap span is recoverable from `gp.traceLaps` — but slide/brake/corner moments would need a windowing rule that does not exist yet.
- **Moments dedup key is name+proximity (13580-13583), and detection is gated per type** — a session can legitimately produce zero moments; `gpPanelMomentsHtml` has explicit empty copy (13620-13623). Any auto-reel must handle the empty and the no-gate (`gp.lapsFrom !== "gate"`) cases: fastest-lap moment and share-card best time both vanish for stop-split runs (13566, 13777) — deliberately, see the "11 laps" road-drive incident (11975-11988, memory: lap 0.000 sentinel / Mount Barker).
- **Sample rate is NOT constant.** `gpMoments`/`gpMomentWhen` still hardcode 0.04 s (13465, 13527, 13579) but `gpFindCorners` converts windows via `gpHz` (24301) precisely because VBO imports are 10 Hz. Time math for a reel must go through `rows[i].t` / `gpSecs`, not sample counts — the playback ticker was rewritten for exactly this bug (27830-27846).
- **`gpVideoTimeFor` returns null while unsynced (`t0 === null`)**, and t0 can be null transiently right after open (sessions list race — closed via `gp.sessionMeta` stash, 28223-28247, `check_videot0.js`). Export refuses `t0 === null` with a toast (30864-30868); anything assembling video ranges must do the same.
- **`v.offsetMs` and `v.noOverlap` matter:** the mapping is `t0 + offsetMs`; `noOverlap` means the alignment is a start-together guess (28165-28181) — a reel cut on it would show the wrong footage confidently.
- **The video element is a singleton** (`#gpVideo`, GP_PTYPES `solo: true` 14197) and the transport handover logic assumes ONE playhead (`check_transport.js` pins it). A reel player that seeks repeatedly must respect `gpVideoFollowSeek`'s force semantics (28988: deliberate moves pass `force=true`) or the seek is ignored during playback.
- **Everything derived from lap indices is cache-keyed on (selLap, cmpLap) and invalidated by re-split** (21652-21667). Ghost laps (cross-session reference) share the same `gp.trace` array past `gp.ghostFence`; all extreme-scans stop at the fence (`end = gp.ghostFence !== null ? gp.ghostFence : rows.length` — 13477, 13763, 22875, 23187). Skip `l.ghost` and respect the fence in any new scan.
- **Flagged laps (`l.flag`) are excluded from best-lap picks everywhere** (21696, 15832, 21894, gpCleanRuns 21625) — a reel's "best lap" must use the same rule or it will disagree with every screen.
- **Corner comparison requires a reference lap** (`gpCoachOps` returns null unless selLap≥0, cmpLap≥0, sel≠cmp — 20217); `gpCornerOps` auto-picks a challenger (23924-23939) — a session with one timed lap has NO corner deltas.
- **Drift rating returns null, not zero, for unratable corners** (spin/grip/no-angle, 23074-23089) and the whole score stands on an uncalibrated gyro (STUDIO_IDEAS §1: ±50° phantoms on real Mallala data). ADR-0011 ("what is shown is measured") runs through everything: the HUD refuses rough angles, Moments' slide entry gates on `drift.ok`, spins are unrated. An auto-reel captioning "47° slide" must go through the same gates.
- **Share card saves via `<a download>`; video export saves via `gpSaveVideoBlob`** (OS dialog + `RDM.writeFile` under Tauri). Under Tauri, `<a download>` works but bypasses the native save dialog; new media should copy `gpSaveVideoBlob`.
- **One HUD renderer rule** (`VIDEO_HUD_EXPORT_2026-08.md:23-41`): any burned-in reel graphics must go through `gpHudRender(ctx, W, H, i)` / `gpHudData(i)` at export size — do not fork a preview renderer. Scale is `S = min(min(W,H)/720, W/700)`.
- **Export owns the app while it runs** (STUDIO_IDEAS §7) and the fast path holds the demux reader on `gp.video.reader` — it must outlive the probe (28614-28617). Multi-segment output would need `gpMp4Build` to accept concatenated sample runs and audio cut at AAC frame boundaries — audio today is copied byte-for-byte for the whole span only.
- **Frontend is BUILT** (ADR-0007): edit `src/tauri-overlay.html` only, rebuild with `python tools/merge_overlay.py`; never report or edit dist. JS with escapes goes through Edit/Write, never bash heredocs (memory: heredocs eat backslashes); `tools/check_syntax.js` is the net.
- **`gpShareLapText` and `gpLapTime` both format lap times** (13793-13797, 33748) — mind which one a new surface uses; sector delta formatting is `gpSecDelta` (17634-17637, positive = time LOST — the sign convention everywhere).

## open_questions

- `gpDriftSegments()` (used at 23145 for link detection) was not read in full — its exact output element shape beyond `{from, to}` (switch indices?) is unverified; it sits in the drift block ~22640-22800.
- `gpMp4Build`'s exact input contract (whether it could take multiple discontiguous sample runs for a stitched reel) was not read — only the doc's description (`VIDEO_HUD_EXPORT_2026-08.md`, "The export"). The mux/demux code lives in the `gpMp4*` block below 31000; anyone planning multi-segment output must read `gpMp4Build` and `gpCopyAudio` directly.
- `gpVideoProbeT0`'s underlying `gpMp4CreationInfo` (creationdate vs mvhd preference — memory says creationdate beats mvhd) was located (28117-28132) but the parser itself not read.
- Whether the Rust side (`src-tauri/src/lib.rs`) has any commands relevant beyond `read_file_range` / `video_allow` / `write_binary_file` (referenced at 28111, 28437, and the doc's IPC table) was not surveyed — lib.rs was not opened; nothing in the frontend suggested other video-related commands.
- `gpRenderCorners`' full HTML (23999+) and the corner badges on the map (`gpDrawCornerBadges`, 23952) were not read past the A/B strip; only their entry points are anchored.
- I did not find any existing multi-segment/"clip list" data structure anywhere in the overlay (searched `highlight|reel|segment`); confident none exists, but the drift-segments array is the nearest analogue.