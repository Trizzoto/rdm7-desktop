# session-quality

## findings

# Data-quality signals in RDM Studio — full inventory

All line refs are `src/tauri-overlay.html` (the GPS workspace IIFE) unless stated. Everything below was read from current code on branch `analyse-video-playback`.

## 1. GNSS gaps / trace clock breaks

**Detector: `gpMarkBreaks(rows)` — 24163-24188.** Sets three per-sample fields on every row: `brk` (no driven line joins this sample to the previous), `brkTime` (the clock across the step is also wrong — the kind that invents a lap time), `brkM` (step length in metres). Design comment 24103-24134 distinguishes the two failure kinds measured on the 22 Aug Mallala ring: (a) fix lost mid-sector, node kept the flash page open, reader dated both sides 40 ms apart → smooth trace, ~13 s missing, clock lies (`brk`+`brkTime`); (b) clock honest but samples missing across a pause (`brk` only). Test: step distance vs Doppler speed budget `d > v*dt*GP_BREAK_SLACK + GP_BREAK_FLOOR_M` → brkTime break (24173-24174); else `dt > nom*GP_BREAK_QUIET_K && d > GP_BREAK_QUIET_M` → quiet break (24175-24176). Constants 24135-24147: `GP_BREAK_SLACK=1.6`, `GP_BREAK_FLOOR_M=12`, `GP_BREAK_QUIET_M=25`, `GP_BREAK_QUIET_K=2.5`, `GP_BREAK_MAX_FRAC=0.02` (if >2% of steps are "impossible" the whole marking is reverted — treated as an import without a usable speed channel, 24179-24186), `GP_BREAK_AXIS_M=1e6`. `gpNominalStep` (24152-24158) medians the recording's own cadence so 10 Hz VBOs and 25 Hz puck rings both work.

**Single call site: inside `gpComputeG` at 20598** ("every path that produces samples — download, open, import, live — computes g over them", 20594-20597). So breaks exist in memory on every loaded trace but are **never persisted** — recomputed from rows on `gpSessionLoad` (gpComputeG call 11909).

**Aggregator: `gpRunBreakM(rows, from, to, timeOnly)` — 24192-24200** (worst break in a span, metres; `timeOnly` filters to brkTime).

**Run grading: `gpGradeRuns(rows, runs)` — 21588-21619.** Sets `run.flag` = `"jump"` (any brkTime break inside, `flagM` = metres, 21602-21603), `"gap"` (`gpRunGapMs` 21574-21583 worst t-gap > `GP_RUN_GAP_MS=2000` ms, mirrors LAP_MAX_FIX_GAP_MS in lap_core.c, 21589), or `"slow"` (> 1.35× best clean run, 21617). Rationale comment 21548-21572 (Mount Barker data). Words: `gpRunFlagWhy` 21630-21642. `gpCleanRuns()` 21625-21627 filters `!ghost && !flag` and is the single source for best-lap/reference/session-card numbers ("Everything that reports a best… reads THIS", 21622-21624).

**Consumers of `brk` (each a place the app already refuses to fabricate):** map trace layer skips the segment (25195-25201, "the straight bar… was the absence of one"); longitudinal g zeroed across breaks (20623); gate-crossing interpolation refused across a break (`gpGateHits` 21321-21333); track-outline extraction refuses a range with a break (10226-10231); drift anchor stepping skips (22433); smoothing axis charges `GP_BREAK_AXIS_M` (24741-24748); `gpStep` clamps any dt > `GP_MAX_STEP_S=0.5` back to GP_DT (24089-24093); ghost/best-lap/track-shape pickers skip flagged runs (12565, 12620, 21694-21696, 21890-21894, 33703-33709).

**The fabricated-clock mechanism itself** (why brkTime exists): download decodes `t_marks` = `[[index, itow_ms],…]` per page; between marks t is synthesized at flat +40 ms (21010-21020, 21059-21062). The ring is sector-granular: `trace.read` answers empty tail indices with count 0, and `gpTraceDownload` steps over holes via `findNext` (GAP_PROBE=512 coarse scan + binary narrow, 20926-20968) instead of stopping — full rationale comment 20906-20925. A local `holes` counter is incremented (20926, 20965) **but never displayed or stored** — free signal for a health panel.

**Harness:** `tools/check_breaks.js` — extracts `gpMarkBreaks`/`gpGradeRuns`/etc. verbatim from the overlay and runs synthetic cases plus the real 168k-sample 22 Aug ring (header lines 1-56).

## 2. Dropped / quiet CAN channels

**`GP_CHAN_STALE = 0xFFFF`** (10320) is the wire/storage marker for "channel had gone quiet at this sample"; decoded to `null` at download (21027) and in `gpRowsUnpack` (10377).

**Detector: `gpChanQuiet()` — 18528-18555.** Full O(n·m) scan of `gp.trace[i].can[c]`, returns `quiet[]` boolean per column ("live if a value anywhere, however rarely it speaks"). Self-validating cache: keyed on the rows array identity + `rows.length : t0 : tN : ids.join(",")` in `gp._quietFor/_quietKey/_quiet` (18538-18540) so a changed recording can never show the previous one's answer. Rationale comment 18512-18527 (22 Aug Falcon: 12 channels, 8103 samples, all quiet — puck in a different car).

**Display: `gpLaneRowsAll()` 18557-18648.** For each CAN column builds a lane; if quiet: `lane.quiet = true`, `absent()` true, `absentSay` = per-lane "Nothing arrived on this id during this recording." — or, when *every* column is quiet, one sentence on lane 0 only: "No CAN arrived at all during this recording — not one frame on any of these N channels… Nothing here is a scaling problem." (18619-18630). Quiet outranks the unknown-id "raw counts" annotation (18599-18612). Graph renders the quiet lane empty at 19363.

**Export admission counters:** VBO export holds last value for stale samples and counts `gaps` (held) and `leading` (zero-before-first-report), 10674-10695; written as header NOTEs 10728-10731 ("N channel sample(s) held their previous value while the source was quiet"). CSV leaves stale cells blank instead (10443-10445).

**Live-side "fresh but flat":** `gp.chanLive` state slot declared 8438 (`dashId -> {value, fresh}`, polled while the Setup channel list is visible) — freshness is live-only, not per-session. (The "10 channels arrive fresh but flat zero" fact is in memory `bus-only-populates-core-channels`, no session-time detector exists.)

**Harness:** `tools/check_chanquiet.js` (header 1-24 states the five pinned behaviours: live-if-anywhere, quiet draws empty, "not decoded" never survives on quiet, whole-quiet-bus said once, cache follows the recording).

## 3. Video sync anchors and error metrics

**Log anchor (import):** VBO import computes `videoAnchorMs` — position of sample 0 in the footage — from the `avisynctime` column: only if all rows are one video file (`aviFile` check 10978-10981), takes `dif[i] = aviMs[i] - (ms[i]-t0)` over all samples, requires the **spread ≤ 1000 ms** (`dif[last]-dif[0] <= 1000`, 10986-10988; "if the difference is not near-constant the column is not a video clock, and we say nothing") and stores the **median** (10989). Stored in meta as `videoAnchorMs` (11074); import note text 11109-11111. That spread test is the only "closure error"-style metric on video sync; it is pass/fail at import and not stored.

**Sync-source model:** `gp.video.src` ∈ `log | cam | start`, best-available (`gpVideoSources` 28303-28310, labels/tooltips `GP_VSRC_LBL`/`GP_VSRC_TIP` 28312-28317). `gpVideoSyncSet(which)` 28325-28347 returns success/refusal (refusals were silent once — see `tools/check_videot0.js` header 1-31 for both real failure routes). `gpVideoBegin` seeds `fileT0 = recordedAt - videoAnchorMs` when the log anchor exists (28611-28622); camera-clock fallback applies `gpVideoTzFix` (28643-28658).

**`gpVideoTzFix(camMs, sessionMs, tzKnown)` 28189-28221:** snaps whole-GNSS-week errors (≥52 weeks, remainder ≤ 1 day) and then whole-quarter-hour timezone errors (k×900000 ms ± 120000 ms) — the 316-week repair path.

**Persisted link (meta):** `meta.videoPath`, `meta.videoSrc`, `meta.videoOffsetMs` written by `gpVideoLink` 28406-28418, kept current by `gpVideoLinkSync` 28422-28428, restored by `gpVideoRelink` 28433-28450 (silently drops the link if the file moved, with a toast). `videoAnchorMs` is the only other video field in meta. **There is no multi-anchor store** — one anchor + one manual nudge (`offsetMs`).

**Coverage & decode health (verdict-ish):** `gpVideoCover()` 28355-28369 returns `{from,to,lapFrom,lapTo,frac}` — how much of the analysed lap the footage reaches; `gpVideoGoto` 28374-28387. `gpVideoWatch()` 28463-28477 counts compositor-presented frames via requestVideoFrameCallback; <15 frames in 3 s while playing sets `v.dead = true` (the "picture will not decode here" state rendered by `gpPanelVideoHtml`, 16090); `gpVideoConvert` 28479-28492 + `gpHaveFfmpeg` 28496-28505 offer the Main@4.0 re-encode.

**Drift-engine anchors/closure (the actual "anchor count + closure error" machinery, non-video):** `gpDriftAngle` output `{…, legs, scale, bias, fitN, weak, anchors: isl.length, worst, sigma}` 22623-22626; per-leg misclosure redistributed as a Brownian bridge, `conf[]` per sample (22500, 22553-22583); calibration `weak` when the scale can't be fitted from straight driving (22327-22343). Surfaced: slip-lane note "Worked out from X, to about ±N°" (18287-18299), Drift source line quoting typical ± and worst ± and the weak-scale sentence (23692-23717), per-corner refusals `soft`/`rough`/unclosed/spun texts (23470-23492; `soft: d.anchors === 0 && !d.direct` set at 22817).

## 4. Lap sentinel / flags byte

**Rule of the dash lap API** (comment 33736-33745): times are float seconds, **0 is the firmware "unset" sentinel — never render as 0.000**; `lap_delta` is *omitted* (not zeroed) while invalid; `fix`/`track_name` omitted rather than nulled. `gpLapTime` 33748-33753 renders `—` for `n <= 0`; `gpLapDelta` 33754-33758.

**Flags byte reconstruction:** `gpLapFlagsByte(lap)` 38649-38657 packs bit0 `has_track`, bit1 `timing.armed`, bit2 `"lap_delta" in timing`, bit3 `point_to_point` — "the same three booleans + one presence check the firmware packs" (main.c broadcast). `gpLapFlagsHex` 38658-38661, `gpLapBit` 38689-38694. Displayed in the Setup CAN frame-map reference `GP_FRAMES`: Lap frame off 0x7 (base 0x400 → 0x407) with byte 7 = "Lap flags" bits [Track loaded / Timing a lap / Delta valid / Time trial] (38810-38825); same byte repeated on Sector 0x8 (38837-38840) and Delta 0x9 (38854-38857). u16 centisecond sentinel: `gpCsFromS` 38637-38641 (`0xFFFF` = no time yet; delta frame has **no** sentinel — validity rides on the flags bit alone, 38643-38646).

**For recorded sessions** the "is this lap real" question is answered by `gpGradeRuns` flags + `meta.lapsBy` (see §1, §6) — there is no stored per-lap flags byte. The "divide lapTimesS by 0.04" stop-cut tell (memory `who-timed-this-lap`) exists only as a human diagnostic; the code's answer is `lapsBy: "gate" | "stops" | null` (11488-11491).

## 5. Counters carried in trace / session / live status

**`trace.info` reply (puck):** `{recording, capacity_samples, used_samples, session, wrapped, dropped, sample_hz, page_samples, n_channels, record_bytes}` — `../rdm-gps-node/docs/USB_RPC.md:70`, serialised in `../rdm-gps-node/main/net/serial_rpc.c:933-938`; `wrapped` = ring overwrote oldest data (`trace_log.h:138`). Held in `gp.traceInfo` while connected. Displayed **only** in the ready card: "Ring wrapped — oldest laps overwritten" (16926-16927), "Dropped N — gaps in the trace" tone bad (16928-16929), recorded/free minutes (16922-16925). **Not persisted:** `gpSessionMeta` copies none of it, and `gpSessionLoad` overwrites `gp.traceInfo = { used_samples: rows.length }` (11876).

**Live status cards `GP_CARDS` 8654-8782** (Monitor view, host `#gpStage`, built `gpBuildStage` 8905-8921, updated 1 Hz `gpUpdateStage` 8923-8949 with per-row tone + per-card lamp `gpCardHealth`): Fix card — sats tone ≥8 ok / ≥4 warn (8659-8660), PDOP ≤2/≤5 (8661-8662), hacc_mm ≤1500/≤5000 (8663-8665), vacc, SBAS `diff` tri-state (8682-8689), UTC; Motion — sacc_mm_s ≤100/≤300 (8705-8707, note 8710: lap-time error tracks speed accuracy, not hacc); Satellite receiver — `link`, `configured`, `ubx` count+rate, `ck_err` (corrupted), `fr_err` (incomplete), `rx_overflow` (data lost), `rx_recover` (restarts), `sentinel_reboots` (self-restarts, warn) 8719-8757; CAN output — `can_tx` count+rate, bitrate, base id (8772-8781). `GP_FIX_TYPES` 8644-8647.

**Per-sample fix quality: none.** The packed row is `{lat, lon, kph, hdg, t, can[], gyroz}` only (`gpRowsPack` 10322-10362; puck record is 12 or 14 bytes, 20974-20991). VBO export states it outright: "sats is a fixed placeholder — not logged per sample", "height is always 0" (10724-10725).

**Receiver noise estimate:** `gpSmoothNoise(rows, kap)` 24767-24795 measures this recording's GPS position noise sigma (perpendicular offsets on the straightest half; recovers injected sigma within 8% from 0.15-1.5 m); cached as `gp.pathSigma` (24901). In-memory only, never displayed.

**Session meta counters:** `samples`, `durationS` (11483-11484); the split-rejection diagnostic `diag.rejectedMinTime` (21544) and gate diagnostics `{nearestM, samplesInBand, hits, startUsable, startWrongWay, finishUsable, finishWrongWay}` (`gpGateHits` 21307-21337 returns nearestM/samplesInBand; `gpSplitRows` diag 21447-21471) are computed on demand for `gpNoLapsWhy`, not stored.

**CAN error counters per session: none.** Live-only bus health exists in the dash CAN-analyzer workspace (`_caLinkInfo` 6495-6517: "linked · bus quiet", sim on, bus read failing…).

## 6. The session store

**IndexedDB `rdm7_sessions_db` v1** (gpStore IIFE 10247-10300): store `meta` (keyPath `id`, small rows the list renders from) + store `data` (packed samples keyed by same id). API: `list() / meta(id) / rows(id) / put(meta, packed) / putMeta(meta) / remove(id)`. Rename-without-rewriting rationale 10296.

**Packed sample shape** `gpRowsPack` 10322-10362 / `gpRowsUnpack` 10364-10386 — see data_shapes.

**Meta schema** — see data_shapes. Two writers: `gpSessionMeta(rows, id)` 11430-11508 (download; `dated: "gps"|"download"` via `gpTraceAnchor` 11323-11365 + `gpSampleDate` 11373-11387 with week-snap and leap-second residual logic; identity `startT` 11481; **clean runs only** feed `lapTimesS` 11449-11452) and the VBO importer 11049-11082 (`dated: "gps"|"file"`, adds `circuit`, `videoAnchorMs`, per-file `chanDefs` with `vbo:`-prefixed ids). Video link fields §3. `noTrack` marker set by `gpSessionTrack`.

**Save path:** `gpSessionSave` 11700-11708 → `gpSessionSaveNow` 11710-11734 (dedup by `gpSessionPrior` on startT; user-typed name/car/driver survive re-download 11715-11723). Downloads are stint-split first: `gpStints` 11778-11789 cuts at clock gaps > `GP_STINT_GAP_S=600` s, keeps stints ≥ `GP_STINT_MIN_S=20` s, `gpSaveStints` 11793-11833 saves each as its own session.

**Derived stats cached in meta and healed:** on every `gpSessionLoad` the card is recomputed from `gpCleanRuns()` and written back when changed — `lapCount/bestLapS/lapTimesS/lapsBy/corners` plus track adoption, with the "demoted" guard that refuses to downgrade gate-timed laps when the track library is missing (11943-12044; in-list mirror 12032-12043). Week-error repair `gpHealFutureDates` 11652-11665 runs on every `gpSessionsRefresh` 11667-11674 (walks `recordedAt` back whole weeks when it postdates `savedAt`, rewrites the baked-in name date).

**In-memory derived caches** (all cleared in `gpSplitLaps` 21652-21671 when the lap set changes): `gp.coach, delta/deltaKey, stripCache, stripZoom, sectors/secKey, scaleCache, rate/rateKey, lineOff/lineKey, chan/chanKey, shownLaps`, drift caches via `gpDriftForget`. Path smoothing cache `gp.path/pathKey/pathSigma` keyed on rows length+t0+tN (24800-24901); quiet cache §2.

**Other stores:** transport.js `rdm7_desktop_db` v2, stores `image_data/font_data/track_data` (transport.js 72-97); overlay `rdm7_images_db` (editor image cache, 42020-42032). localStorage: `rdm7_tracks_v1` (track library incl. gates/sectors/outlines, 8992), `rdm7_gp_grid`/`rdm7_gp_grids`/`rdm7_gp_dock` (Analyse mosaic, 14193), `rdm7_gp_nodeseen`/`rdm7_gp_autodl` (per-node ring bookmark for auto-download, 21142-21172), `rdm7_units` 8551, lane prefs `rdm7_gp_laneshow/chanfix/laner/lanew` 18245/18357/18891-18907, chan lists `rdm7_gp_logchans/devchans/mychans/dashchans` 36450-36804, map prefs `rdm7_gp_mapmode/ground/groundsrc/labels/licensed/plotmode/tiles` 8443-8483, `rdm7_gp_driftsrc` 22150, `rdm7_gp_playcam` 26114, `rdm7_gp_caricon/carpng` 26747-26748, `rdm7_timefmt` 38388, `rdm7_camera` 38531. `.rdmsession` export = meta + packed b64 (`gpSessionFileBuild`, download at 11145).

## 7. Views (ADR-0024/25/26) and where a health card mounts

**`window.gpSetView(v)` 35454+** — `KNOWN = ["sessions","monitor","session","corners","drift","tracks","setup"]` (35455; 7 views now, Drift added post-ADR-0024). Topbar buttons 4221-4227. Per-view containers (toggled 35515-35530):
- **sessions** → `#gpSessionsWrap`, rendered by `gpRenderSessions()` 13222-13430. Table columns incl. "Data" badge cell (13325). Highlighted-row actions block 13353-13362.
- **monitor (Live)** → `#gpStage` card grid (`gpBuildStage` 8905 / `gpUpdateStage` 8923) + rail (`#gpRail` with `#gpReadyCard`, 12826-12843) + `#gpInspector`.
- **session (Analyse)** → `#gpGrid` mosaic (`gpRenderGrid` 16343; singletons parked in `#gpHold` 16354-16363), `#gpDock` transport, `#gpCtx` header (`gpRenderCtx` 12695-12743 — session name + Best/Ideal/Spread tags + "GPS 25 Hz + N CAN channels" line). Rail and `#gpInspector` hidden (35496-35513).
- **corners** → `#gpCornersWrap` / `#gpCornersMapCell` (markup 4352-4353) + `#gpInspector`.
- **drift** → `#gpDriftWrap` (35521-35522).
- **tracks** → tall map viewer + `#gpInspector` (`gpRenderTrackInspector`, 36392).
- **setup** → `#gpSetupWrap` + `#gpInspector` showing device identity with its own `#gpReadyCard` mount (36410-36422).

**Panel registry for Analyse: `GP_PTYPES` 14194-14212** — `map, graph, video` (solo singletons), `times, report, corners, moments, grip, splits, history`. Render switch 16328-16339 (`gpPanelTimesHtml` 15820, `gpPanelReportHtml` 15982, `gpPanelCornersHtml` 16003, `gpPanelMomentsHtml` 13616, `gpPanelGripHtml` 13656, `gpPanelHistoryHtml` 16072, `gpPanelVideoHtml` 16090). Presets `GP_PRESETS` 14247-14266. **A new "Data health" panel = one GP_PTYPES entry + one branch in that switch**; grid layout persists in `rdm7_gp_grid`.

**Natural session-level mounts:** (a) a new panel type as above (the per-session surface in Analyse); (b) the Sessions view highlighted-row block at 13353 or a table cell next to the existing Data badge (13325); (c) a tag in the `#gpCtx` header next to Best/Ideal/Spread (12722-12735).

**Strong precedent for the card itself: the Ready card** — `gpReadyRows()` 16820-16971 (fact rows `{k,v,tone,sub,fix,wait,pin}` each with its own verdict + one fix button), `gpReadyVerdict()` 16978-16988 (worst-wins; wait ranks between ok and bad; pinned rows outside the vote), `gpReadyCardHtml()` 16997-17032 (one-line banner, collapsed shows only wrong+pinned rows), `gpRenderReady` 17041-17046 into `#gpReadyCard` (mounted in session rail 12831 and Setup inspector 36412). It is pre-drive/live-only (renders empty without a connected `dev.traceRead`).

## Existing verdict-ish UI about data quality (inventory)

- Run flag chips in Lap times panel: row class `off`, one-word chip `.gpb-why` — "no fix" / "jumped" / "off the pace" — full sentence as tooltip (15873-15896); flagged runs can't be REF (15892-15896); laps panel elsewhere at 15967-15968.
- Sessions table: `*` on non-GPS-dated rows "the node had no fix when this was downloaded" (13316-13317); rail variant 12456-12458 (`.undated` amber, CSS 1409); unsaved-recording warning banner (13261-13264); Data badge GPS vs GPS+CAN (13325); history table asterisk 13128.
- `gpNoLapsWhy()` 21737-21800+: the full no-laps diagnosis (line too far / clipped / wrong-way crossings with counts, uses `gpSplitRows` diag); gate auto-turn note `gp.gateNote` (21677, spoken via `gpSplitLapsAuto` 21906-21918).
- Quiet-lane sentences and unknown-id "counts" annotation on graph lanes (18599-18630).
- Drift measurement honesty: source line with typical ± and worst ± and weak-scale sentence (23697-23717); slip-lane "to about ±N°" note (18294-18299); per-corner refusal texts incl. `soft` no-anchor case (23470-23492).
- Video: sync-source pill + tooltips (28312-28317), coverage (28355), dead-decode detection + "Make a playable copy" (28463-28492), link-dropped toast (28448).
- Ready card rows incl. `wrapped`/`dropped`/Angle-not-recorded (12-byte fix) checks (16886-16963).
- Live: GP_CARDS tones/lamps (§5), Setup connection hint prose incl. zero-sats-vs-few-sats reasoning (39906-39945).
- Empty-download message `gpEmptyDownloadMsg` (20842); download hole-stepping is silent (holes counter unused).
- CAN analyzer (dash workspace, not #gpWorkspace): link chip states incl. "bus quiet", "device simulator on", virtual-ECU warning (6495-6529).

## Relevant test harnesses (tools/*.js, all extract functions verbatim from the overlay)
`check_breaks.js` (gpMarkBreaks/gpGradeRuns vs synthetic + real ring), `check_chanquiet.js` (gpChanQuiet + lane copy rules), `check_gpsclock.js` (gpTraceAnchor week + leap-second logic, real offsets -18.4/-0.8 s), `check_videot0.js` (video t0 restore/refusal routes), `check_runsplit.js` (start/finish pairing — finish pairs with LAST start), `check_laptime.js` (interpolated crossings beat sample-period quantisation), plus check_laps/check_sessions/check_autodl for laps/store/auto-download.

## data_shapes

## Session meta (IndexedDB `rdm7_sessions_db`.`meta`, keyPath `id`) — writer `gpSessionMeta` 11467-11507:
```js
{ id: "ses_<base36>",            // gpSesUid 11403
  name, trackId, trackName, trial,
  recordedAt,                    // ms UTC (healed by gpHealFutureDates 11652)
  dated: "gps"|"download"|"file",// import uses "file" (11048)
  savedAt, startT,               // startT = first sample t; dedup identity (11481)
  device, samples, durationS,
  lapCount, bestLapS, lapTimesS: [s,…],   // CLEAN runs only (11449)
  lapsBy: "gate"|"stops"|null,   // which question the numbers answer (11488-11491)
  corners: [{lat, lon, kph, s}], // best lap fingerprint (11460-11465)
  chanIds: ["…"]|null, chanDefs: [{id,name,unit,decimals,scale,offset,signed}]|null,
  car: "", driver: "",
  // optional: circuit (import 11069), videoAnchorMs (import 11074),
  // videoPath, videoSrc:"log"|"cam"|"start", videoOffsetMs (28406-28428),
  // noTrack (deliberate no-track marker, 11861-11862, 11919) }
```
## Packed samples (`data` store) — gpRowsPack 10322-10362:
```js
{ v:1, n, lat:Int32Array(×1e7), lon:Int32Array(×1e7), kph:Uint16Array(×100),
  hdg:Uint16Array(×100), t:Uint32Array (GP_NO_T=4294967295 = no timestamp),
  nch?, can?:Uint16Array(n*nch, sample-major, GP_CHAN_STALE=0xFFFF = quiet),
  gyro?:Int16Array(×50, -32768 = no IMU reading) }
```
## In-memory row (gpRowsUnpack 10380-10383 + gpComputeG/gpMarkBreaks):
```js
{ lat, lon, kph, hdg, t|undefined, g, can:[num|null]|null, gyroz|undefined,
  brk:bool, brkTime:bool, brkM:number }   // brk* recomputed, never stored
```
## Run/lap object (gpSplitRows 21459-21461 + gpGradeRuns 21594-21604):
```js
{ from, to,               // sample indices
  tFrom, tTo,             // interpolated crossing instants (ms)
  flag: null|"jump"|"gap"|"slow", flagMs, flagM, ghost? }
```
## trace.info reply (puck; ../rdm-gps-node/docs/USB_RPC.md:70, serial_rpc.c:933-938):
```
{ recording, capacity_samples, used_samples, session, wrapped, dropped,
  sample_hz, page_samples, n_channels, record_bytes }
```
trace.read page: `{count, data(b64, fix_bytes stride 12|14), chan_data(b64 u16), t_marks:[[idx,itow_ms],…], fix_bytes?}` (20959-21063).
## gp.video state (not stored; 28613-28622):
```js
{ name, url, blob, path, reader, size, t0, fileT0, src:"log"|"cam"|"start",
  autoT0, autoTz, offsetMs, follow, probing, tzHours?, dead?, noOverlap? }
```
## gpDriftAngle output (22623-22626):
```js
{ beta, ok, conf, src, direct, rho, rhoOk, legs,
  scale, bias, fitN, weak, anchors, worst, sigma }
// per-corner: soft = anchors===0 && !direct (22817)
```
## Ready-card row (16823-16825): `{k, v, tone:"ok"|"warn"|"bad"|"rec"|null, sub, fix:{label,call}|null, wait, pin}`; verdict worst-wins 16978-16988.
## Lap flags byte (gpLapFlagsByte 38649-38657): bit0 has_track, bit1 timing.armed, bit2 lap_delta present, bit3 point_to_point; times u16 cs with 0xFFFF sentinel (gpCsFromS 38637-38641); float-seconds 0 = unset (33739-33740).
## Live status keys read by GP_CARDS (gp.status): fix, fix_type, sats, pdop_1e2, hacc_mm, vacc_mm, diff, utc, lat_1e7/lon_1e7/alt_mm, gspeed_mm_s, head_1e5, sacc_mm_s, headacc_1e5, link, configured, ubx, ck_err, fr_err, rx_overflow, rx_recover, sentinel_reboots, can_tx, itow_ms, can_flags, imu{ax_mg…gz_cdps}.
## localStorage: rdm7_tracks_v1 (track library: {tracks:[{id,name,start_finish,finish,sectors,min_lap_time_s,outline,…}], active}), rdm7_gp_grid/grids/dock, rdm7_gp_nodeseen ({nodeKey:{session,used,at}}), rdm7_gp_autodl, rdm7_units, rdm7_gp_laneshow/chanfix/laner/lanew, rdm7_gp_logchans/devchans/mychans/dashchans, rdm7_gp_mapmode/ground/groundsrc/labels/licensed/plotmode/tiles, rdm7_gp_driftsrc, rdm7_gp_playcam, rdm7_gp_caricon/carpng, rdm7_timefmt, rdm7_camera.

## gotchas

- **Report/edit against source, not dist**: dist/index.html is generated; the GPS workspace is one IIFE in tauri-overlay.html; CSS must stay scoped `#gpWorkspace`, tokens `--gpb-*`; new overlay blocks need anchors that match firmware-base exactly once (merge_overlay.py header lines 10-15 of tauri-overlay.html).
- **brk/brkTime/flag are volatile.** They are recomputed by `gpComputeG` → `gpMarkBreaks` (only call site 20598) and `gpSplitLaps` → `gpGradeRuns` each load. Nothing quality-related is persisted in meta except the *clean-run* numbers. A health panel can compute everything from a loaded trace, but a health *badge on the Sessions list* requires new meta fields written by the §6 heal block (11943-12044) — and must mirror into the in-memory `gp.sessions` row too (pattern at 12032-12043), and be tolerated absent on old metas.
- **`gp.traceInfo.dropped`/`wrapped` are lost at save.** They exist only while the puck is attached; `gpSessionLoad` fakes `gp.traceInfo = {used_samples: rows.length}` (11876). To surface them post-hoc they must be copied into meta in `gpSessionMeta` at download time. Same for the download's `holes` counter (20926/20965) — currently counted and discarded.
- **`gpChanQuiet` cache is self-validating but O(n·m)** — reuse it (18528), don't rescan; its key covers the live buffer's sliding array.
- **`gpMarkBreaks` self-reverts** above GP_BREAK_MAX_FRAC (2%) — a "breaks: 0" answer can mean "test not applicable to this import", not "no holes" (24179-24186). The return value (hit count) is currently ignored by the caller.
- **Meta objects are shared identity**: edit the object from `gpCurSessionMeta()` (28242-28247; falls back to `gp.sessionMeta` during the list-race — see check_videot0.js) and write with `gpStore.putMeta`; a fresh object would fork the list from the store.
- **`gpStore.list()` deserialises every meta** for the rail/Sessions table — keep new meta fields small (no per-sample arrays in meta; big data goes in the `data` store).
- **recordedAt is rewritten by heals** (gpHealFutureDates weekly walk-back 11652-11665; the 2026-08-29 repair). Reload-first before writing stored meta (memory `video-sync-and-week-error`); don't key caches on recordedAt.
- **Analyse rendering rules (ADR-0025/26)**: new panel = GP_PTYPES entry + branch at 16330-16339; singletons (`gpViewer`,`gpStrip`,`gpNav`,`gpVideoTile`) are re-parented via hidden `#gpHold` (16354-16363) — a plain innerHTML rebuild kills Leaflet/canvases; re-binds get orphaned on rebuild (gpVideoBind lesson); never rebuild the dock mid-drag (`gpUpdateDock` writes `data-dv` slots); `gpRenderGridSoft` exists for value-only refreshes.
- **Ready card only renders with a connected node** (`dev && dev.traceRead`, 17045) — a session health card must not inherit that guard.
- **Sample rate is data-carried, not constant**: use `gpHz`/`gpSecs`/`gpStep` (24264-24271, 24089-24093), never ×0.04; lap durations come from interpolated `tFrom/tTo` (21301-21305), so durations ≠ index count × dt.
- **`gpSpanSecs`/lap numbers must come from `gpCleanRuns()`** (21622-21627) or the panel re-introduces the exact untrustworthy-board problem the flags fixed.
- **Ghost fence**: any reader spanning the trace must stop at `gp.ghostFence` (e.g. 15854, 28275) or it reads another day's appended samples.
- **`window.confirm` is broken under Tauri** (always-truthy promise) — use `gpConfirm` (8824-8846).
- **Heredocs eat backslashes** (memory): write JS via Edit/Write tools; `tools/check_syntax.js` is the net. The check_*.js harnesses extract functions by exact `^        function name(` indentation — renaming/moving those functions breaks the harnesses.
- **Firmware truth for lap flags**: gpLapFlagsByte mirrors main.c's packing; if the firmware byte changes, 38649 and the three GP_FRAMES bit tables (0x7/0x8/0x9) must move together.

## open_questions

- **Per-sample fix quality does not exist anywhere in a recording** — confirmed the 12/14-byte puck record and gpRowsPack carry no sats/hdop/fix-type; only live gp.status has them. A health panel can therefore only report *live-at-download* fix stats if gpSessionMeta starts snapshotting gp.status, which nothing does today. (Looked: gpRowsPack 10322, download decode 20974-21063, rdm-gps-node trace_log.h.)
- **Puck-side CAN TX loss has no counter** (memory `puck-drops-a-third-of-its-can-frames`); I found no per-session CAN-error field in either repo's RPC surface beyond the dash-side live monitor. Did not exhaustively read rdm-gps-node's can driver for new counters.
- **`t_marks` emission rules on the node** (exactly when a mark is written vs a silently reused page clock — the root of mid-sector fabricated time) were read only from the Studio-side comment (21010-21016) and the gpMarkBreaks design note; `../rdm-gps-node/main/storage/trace_log.c` was only grepped, not read end-to-end.
- **Exact render location of the video "will not decode" copy**: `v.dead` is set in gpVideoWatch (28474) and consumed by `gpPanelVideoHtml` (16090); I did not read the full panel HTML to quote the string or the Make-a-playable-copy button markup.
- **`gpCardHealth`** (live lamp grading, ~8945) was seen invoked but its body not read.
- **check_laps.js / check_sessions.js / check_autodl.js / check_gpsclock full assertions** not read beyond headers; cited only what their headers state.
- ADR-0024 says six views; the code now has seven (`drift` added, KNOWN list 35455). Reported the code's list.