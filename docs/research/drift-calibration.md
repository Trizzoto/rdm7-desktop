# drift-calibration

## findings

# Drift/slip-angle engine — research report

All line refs are `src/tauri-overlay.html` unless another path is given. Node firmware refs are `../rdm-gps-node`.

## 1. Where the drift engine gets yaw-rate / gyro data

Three sources, unified behind one "source" abstraction:

**a) The puck's own gyro, recorded in the trace ("puck:gyroz")**
- Firmware record: `trace_sample_t` in `../rdm-gps-node/main/storage/trace_log.h:88-94` — 14-byte fix: `lat_1e7 (i32)`, `lon_1e7 (i32)`, `speed_kph_1e2 (u16)`, `heading_1e2 (u16)`, `gyro_z_2cdps (i16)`. Gyro LSB is **0.02 °/s** (`TRACE_GYRO_LSB_CDPS 2`, line 97; deliberately NOT centi-deg/s — ±327 °/s clips a real 339 °/s flick, so 0.02 °/s LSB gives ±500+ °/s headroom, lines 81-87). `TRACE_GYRO_NONE = -32768` means "IMU had nothing" (line 105) — never zero.
- What's stored is **vehicle-frame yaw** (bias removed, mounting rotation applied): `main.c:111-119` calls `imu_read()` → `imu_sample(NULL, out)` which runs `imu_cal_apply` (`main/imu/lsm6dsv32x.c:302-311`, `main/imu/imu_cal.c:64-76`). One SPI burst shared between the trace and the CAN gyro frame so both carry the same instant (`main.c:103-110`).
- Studio download decode: overlay:20974-21063. Fix width is **asked, never assumed** (`fix_bytes`, falls back to `record_bytes - nchan*2`, else 12; 20986-20991). Gyro unpack at 21049-21052: `graw = dv.getInt16(o + 12, true)`; `gz = graw === -32768 ? undefined : -graw * 0.02`. **Negated**: node Z-gyro is right-hand-rule positive (CCW), Studio's hdg-derived course rate is compass positive (CW); unflipped, the calibration mask matched nothing (comment 21038-21048, confirmed rb/rp = −0.97 on two real recordings). Result lands in `rows[i].gyroz` in **deg/s, + = right-hand yaw**.
- Presence test: `gpHaveGyro()` overlay:22077-22080 (`rows[0].gyroz !== undefined`). A 12-byte (fw 0.1.0) puck silently has no gyro — warning surface at 16935-16960.
- Live status path: `gpLiveAppend` overlay:40098-40135 sets `gyroz: s.imu.gz_cdps / 100` (40119) from `gps.status` RPC (`../rdm-gps-node/main/net/serial_rpc.c:281-302` — vehicle frame). **Note: NOT negated here, unlike the download path** — see Gotchas.

**b) A CAN yaw-rate / slip-angle channel logged beside the fix (v2 channels)**
- On-wire: sample-major u16 columns after the fix, `TRACE_CHAN_STALE 0xFFFF` = quiet (`trace_log.h:107-128`; decode overlay:20998-21028, stale→null).
- Column meaning: `gp.traceChanIds` + `gp.traceChanDefs`, snapshotted at download (20884, 20898-20899) or restored from session meta (11886-11890). Value decode `gpChanValue` 18500-18504 (0xFFFF→null; signed: `raw > 32767 → raw - 65536`; then `raw*scale+offset`), defs from `gpChanDef` 18464-18493 (scale/offset/`is_signed`/`known` from the channel library `decode`).
- Candidates: `gpDriftChans()` 22082-22106 — CAN columns first (via `gpDriftCanChans` 22108-22119, resolved by `gpChanDefsFor` — the SAME resolver the rack uses), then the puck gyro appended **last** as a virtual entry `{idx:-1, id:"puck:gyroz", unit:"deg/s"}` with its own getter (22097-22103), so an existing car-bus channel choice never silently changes.

**c) An imported log's own column (VBO etc.)** — the importer fits per-column scale/offset into u16 and writes `chanDefs` with ids `vbo:<stamp>_<ci>` carrying name+unit (10993-11017, 11075-11081); `gpDriftGuess` then classifies by **unit**.

**Source selection**: `gpDriftSource()` 22178-22211 — user pref from localStorage `rdm7_gp_driftsrc` (22150), keyed per session id (`gpDriftSrcKey` 22157, value `"yawrate|<id>"` / `"angle|<id>"` / `"none"`, set by `gpDriftSrcSet` 22158-22164); otherwise first channel `gpDriftGuess` (22124-22148) accepts: unit `deg/s|dps` → `"yawrate"` (rejecting names /steer|wheel|shaft|engine|prop/), unit `deg` + name /slip|drift|sideslip|beta/ or \bangle\b → `"angle"`. **No unit means no guess** (22136). Picker UI `gpDriftSourceLine` 23692-23736.

The puck also **broadcasts** gyro live on CAN: frame map entry `off 0x6 "Gyro"`, i16 ×0.01 °/s, "Gyro Z … yaw rate, zeroed by the gyro trim" (38805-38809); plan doc says puck cannot sniff its own 0x405/0x406 frames (TWAI_MODE_NORMAL) so puck yaw had to be widened into the record (docs/DRIFT_MODE_PLAN_2026-08.md:106-108).

## 2. Slip/drift angle end-to-end — `gpDriftAngle()` overlay:22219-22629

β = body heading − course over ground; dβ/dt = (body yaw rate − course rate) exactly (22213-22218). Cached on `gp.drift` keyed `rows.length:end:src.kind:src.id` (22225-22226).

**Direct angle channel** (`src.kind === "angle"`, 22234-22257): pass-through clamped ±180°, `ok=1, conf=1` where finite, ≥`GP_DRIFT_MIN_KPH` (25 km/h, 21986) and inside the ghost fence; rate `drho` = differenced over the same ±3-sample window as the path rate for equal bandwidth (22244-22251). Output has `direct:true, scale:1, bias:0, worst:1`.

**Yaw-rate integration path**:
1. `rp = ch.yaw` — GPS course rate from `gpChannels()` (22261; see §6).
2. `rb` — body rate smoothed with a **7-sample mean (W=3)** to match rp's bandwidth (22263-22281).
3. **Calibration against grip driving** (`fit`, 22313-22337): needs ≥200 masked samples and variance ≥9 in both rates, else `{scale:1, bias:mean-diff, weak:true}`. The fit regresses **rp ON rb and inverts** — inverse regression, because least squares with the noisy course rate as regressor biases the slope (measured: 0.964 for a true 1.008 → a 38° corner shown as 41°; 22292-22312). A fitted scale outside **0.8–1.25** is refused (wrong units / wrong signal / mirrored mounting) → weak (22331-22336).
4. **Mask pass 1** (22339-22343): `|rb − rp| < 8` °/s, ≥25 km/h. **Mask pass 2** (22345-22377): a leaky integrator (`TAU=6` s) of the residual rate tracks "is the car sideways"; samples with `|d1|<5` and `|bh|<6°` only — because a car HOLDING 40° has β̇≈0 and passes mask 1 with the biggest rates in the session (measured at Mallala: 0.936 for a true 1.008). Refit; if nothing survives, take scale 1 and say weak (22373-22377).
5. `rho[i] = (rb−bias)/scale − rp` — the **sideslip rate** (22379-22380).
6. **Anchors** = provably straight: `|rho|<3`, `|rp|<4` °/s, `|glat|<0.3` g, ≥25 km/h, held ≥0.2 s (HOLD = max(2, round(0.2/GP_DT)), 22398-22412). NOT "rho≈0" (that zeroes a held drift — it read 38° as 29°; 22382-22397).
7. **Breaks**: any inter-sample gap >2 s or a `rows[i].brk` teleport zeroes rho for ±(W+1) samples and inserts anchors either side (22427-22441; brk flags set at 24166-24181).
8. **Integration**: trapezoid using `gpStep(rows, i-1)` (real timestamps, holes capped; 22443-22455).
9. **Closure**: between anchor pair (aa,bb), misclosure `mis = cum[bb]−cum[aa]` is spread linearly over the leg (surveyor's traverse; 22530-22538). Per-leg conf `cf = max(|mis|/2, 1)`.
10. **The ± (confidence)**: `sigma` = 68th-percentile |rho| within ±6 samples of anchors, floor 0.05 (22520-22528). Inside a leg the bar is `max(cf, sigma·sqrt(TC·span·u(1−u)))` — a Brownian bridge with `TC=1.0` s (22562-22572; motivated by a +54°/−48° swing that closed perfectly wearing ±2.1°, 22541-22548). Open ends grow as `sigma·sqrt(t)` uncapped (22495-22507, 22574-22585). No anchors at all → mean-removed integration, everything `conf = GP_DRIFT_ROUGH+1 = 9` (22470-22486).
11. `rho` is kept raw (NOT the derivative of the closed β; differs by a per-leg constant) with `rhoOk` gated at `GP_DRIFT_RHO_MIN_KPH = 8` (22028, 22589-22622).

**Output**: `{beta, ok, conf, src, direct:false, rho, rhoOk, legs[], scale, bias, fitN, weak, anchors, worst, sigma}` (22623-22626).

**The "full at 3°, gone by 8°" weighting**: `gpSteerTrust(d, i)` 26885-26892 — `clamp01((GP_DRIFT_ROUGH − conf[i]) / (GP_DRIFT_ROUGH − GP_STEER_TRUST_CONF))` with `GP_STEER_TRUST_CONF = 3` (26825) and `GP_DRIFT_ROUGH = 8` (21999). direct → 1. Consumed by `gpSteerAt` 26844-26877 (counter-steer term of the car-marker wheels: `wheels = atan(GP_STEER_WHEELBASE·yaw/v) − β·w`). Other conf consumers: segments `rough` when conf > 8 (22764); stars refuse rough (23075); HUD prints ± / "rough" (30496-30528); typical-vs-worst sentence 23697-23717.

## 3. Existing scale factors / sign conventions / mounting / calibration constants

- **Sign flip at ingestion**: download negates gyro (−graw·0.02, 21052) to compass-positive; pack/unpack round-trips ×50 / ÷50 keeping −32768 (10353-10354, 10383).
- **Per-session self-calibration**: `cal.scale` (bounds 0.8–1.25) and `cal.bias` fitted inside `gpDriftAngle` (above) — this is the only scale/bias correction in Studio; nothing persists it.
- **Node-side static calibration** (per puck, stored in node NVS, NOT per car in Studio):
  - Mounting: `imu_cal_t { uint8 dir[3]; int16 gyro_bias_cdps[3] }` (`config_store.h:44`, `imu_cal.h`); a signed axis permutation with det=+1 enforced (`imu_cal.c:33-62`); applied per sample before recording/broadcast (`imu_cal_apply` `imu_cal.c:64-76` — bias subtracted from gyro first, then rotated).
  - Studio UI: Setup → "mounting, gyro zero, timezone" 38237-38481. `GP_DIRS` 38243-38247, `gpMountSet` 38285-38305 (Y derived by cross product `gpDeriveY` 38262-38269), saved via `nodeConfigSet` (transport.js:1422 → RPC `node.config.set`). Gyro zero: `gpGyroZero` 38346-38370 → RPC `imu.calibrate` (transport.js:1426; serial_rpc.c:421-456): node averages ~2 s stationary; refusal thresholds in `imu_cal.h:85-95` — min 30 samples, per-axis spread ≤300 cdps, accel magnitude 900–1100 mg, bias cap ±5000 cdps (50 °/s). Result `gyro_bias_cdps[3]` shown at 38445, 38465-38470.
- **Hardcoded vehicle constants**: `GP_STEER_WHEELBASE = 2.6` m "a nominal saloon" (26823), `GP_STEER_LOCK = 38°` (26824) — the only vehicle-geometry constants in the app; used only for the marker's wheel illustration, not for the angle.
- **Thresholds** (all at 21983-22057): `GP_DRIFT_MIN_KPH 25`, `GP_DRIFT_ON 10`, `GP_DRIFT_OFF 5`, `GP_DRIFT_HOLD_S 0.5`, `GP_DRIFT_SETTLE_S 0.4`, `GP_DRIFT_SWITCH_G 0.25`, `GP_DRIFT_ROUGH 8`, `GP_DRIFT_STAR_DEG 40`, `GP_DRIFT_STAR_SETTLE 14`, `GP_DRIFT_RHO_MIN_KPH 8`, `GP_DRIFT_SPIN 100`, `GP_DRIFT_SPIN_DROP 45`, `GP_DRIFT_STAR_W {angle:.45, commit:.25, steady:.20, speed:.10}`, `GP_DRIFT_SCORE_VER 4`.

## 4. "Car" / vehicle concept

There is **no car profile object anywhere**. What exists:
- **Session metadata field**: `car: "", driver: ""` created empty by `gpSessionMeta` (11506, comment "stage 6 fills these in" — the only stage-6 reference in the repo). Free text, trimmed to **24 chars**, edited inline in the Sessions rail and Analyse header (`field("data-gp-ses-car","car")` 12510-12521, 13440-13441; inputs at 12481, 13357), persisted via `gpStore.putMeta` (12517). Read by: search haystack (12923), leaderboard/summary rows (12636, 12973, 13038, 13131-13132, 13320-13321, 15930), share card (13787, 13857), VBO export header `"Vehicle : "` (10721), VBO import `pick("Vehicle") || facts.vehicle` (11065), and carried across re-download/re-import so typed values survive (11722-11723, 11271-11272).
- **Car icon** (map glyph only, global not per-session): `GP_CARS` (26617), localStorage `rdm7_gp_caricon` / `rdm7_gp_carpng` (26747-26748), `gpCarById` (26761).
- **Per-puck config** on the node (mounting, gyro bias, tz, record_on_boot) — travels with the hardware, not the car.
- **Session store**: IndexedDB `rdm7_sessions_db`, object stores `meta` (keyPath id) and `data` (10247-10299). Full meta shape at 11467-11507 (see data_shapes).
- Per-session drift-source pref in localStorage `rdm7_gp_driftsrc` keyed by session id (22150-22157) — the closest existing "per-recording sensor setting" pattern a per-car calibration could mirror.

## 5. Drift scoring chain (corners-per-lap out of 5)

`gpDriftSource` (22178) → `gpDriftAngle` (22219) → segment/switch layer: `gpDriftSegments` 22693-22771 (state machine on |β| with ON/OFF hysteresis, 0.5 s hold, 0.4 s settle, <0.5 s merge; per-seg peak/held/spread/conf/rough/switches), `gpDriftSwitches` 22650-22686 (sign change of β, or of glat with no source) → corner layer: `gpDriftRefLap` 22845-22864 (modal corner count, first such lap), `gpDriftCorners` 22872-22920 (corners from `gpFindCorners` 24292 + `gpCornerPhases` 24475 on the ref lap, mapped to every lap by `gpNearestIndex` 24512 with the 40 m reject) → `gpDriftLinkMap` 23137-23159 (pair linked when ≥half the laps drove both in one segment) + `gpDriftUnits` 23163-23181 → per-cell read `gpDriftCornerRead` 22927-23014 (wraps `gpDriftStats` 22774-22819: peak/held/secs/area °·s (BMW Schwimmwinkelbetragsintegral)/conf; adds `metres` sideways, `commit` = secs-at-angle/secs, `settle` = RMS of rho residual vs a ±1.2 s rolling mean of itself, only at angle, no grip fallback) → `gpDriftSpun` 23029-23062 (>100° while valid, or last valid angle >45° when speed dropped through 25 km/h and never came back) → `gpDriftStars` 23074-23111 (refuses: no angle, rough, spun, <0.5 s at angle; parts = angle held/40°, commit, 1−settle/14, entryKph/best-entry; weighted 45/25/20/10; half-stars; stamped `ver: GP_DRIFT_SCORE_VER`) → `gpDriftBoard` 23183-23265 (two passes — best entry speed per unit first; cells, per-unit best lap, lapAvg means) → UI `gpRenderDrift` 23401+ (`gpStarsHtml` 23292, `gpDriftPartsHtml` 23385, refusal sentences 23470-23489, source line 23692), `gpDriftBest` 23271-23288. Map angle colouring: `gpEffectiveMapMode` 20768-20777, `gpAngleScale` 20785-20794 (95th pct of |β|, clamp 12–90), `gpAngleColour` 20795-20806. Video HUD slip tile 30486-30534 (prints ±conf, or "rough"). Caches cleared by `gpDriftForget` 22166-22172; debug hook `window.__gpDrift` 30727.

## 6. GPS course/heading and sample rate

- Heading itself is **recorded** (GNSS course over ground): puck fix `heading_1e2` u16 ×0.01° (trace_log.h:92; unpack 21058 `hdg`).
- Course **rate**: `gpChannels()` 18126-18161 — central difference of `rows.hdg` over **±3 samples (W=3, 0.24 s at 25 Hz)**, unwrapped across the 359→0 seam, divided by real elapsed `gpSecs`; forced to 0 below **8 km/h** (heading is receiver noise at rest — a parked puck peaked 524 °/s unguarded) and where implied |glat| > 3 g (bad fix). Also yields `glat = (kph/3.6)·(w·π/180)/9.81`. Cached `gp.chan = {yaw: Float32Array, glat: Float32Array}` keyed on `trace.length:selLap`.
- Sample rate: **25 Hz nominal** — `GP_TRACE_HZ = 25`, `GP_DT = 0.04 s` (20586-20587) — but never assumed for time: `gpSecs` 24071-24077 uses per-row `t` stamps (GPS iTOW ms via `t_marks`, 21010-21020, +40 ms between marks), `gpStep` 24091-24094 caps a single step at `GP_MAX_STEP_S = 0.5` (the node skips idle under 8 km/h — `TRACE_IDLE_KPH_X100 800`, trace_log.h:246). `gpHz`/`gpFindCorners` re-derive rate for 10 Hz imports (24296-24302).

## 7. In-memory session/trace model — see data_shapes.

## 8. Docs vs code

`docs/DRIFT_MODE_PLAN_2026-08.md`:
- Sensor ladder tiers 0/0i/1/2/3 (118-124); ADR-0011 rule "no angle from GPS position alone" (89-94, 201) — code obeys (`gpDriftAngle` returns null with no source; pending lane frames 18212-18213).
- **Stale**: §2 audit says "the flash trace does not record it / 12 bytes" (103-105) — superseded by its own Cut 4 (DONE 2026-08-10, 431-457; 14-byte record shipped).
- **Stale**: rating table says Steady = "RMS of the angle against a 0.6 s rolling mean of itself" (200, and lesson 6 at 301-308). Code has moved one derivative up: settle is the RMS of the **sideslip rate** residual against a ±1.2 s rolling mean of the rate, standard 14 °/s (22957-23012, `GP_DRIFT_STAR_SETTLE` 22023) — the doc's own measure was found envelope-dominated (code comment 22960-22967).
- **Contradicted**: lesson 4 says the least-squares problem is fixed by "a lagged instrument" (293-295). Code says the lagged instrument was tried and rejected (decorrelates in fast corners) and uses inverse regression instead (22308-22312).
- **Stale**: "SCORE_VER 2 → 3" (407); code is at **4** (22055).

`docs/DRIFT_METRICS_RESEARCH_2026-08.md` (2026-08-11 menu, "nothing here is built" — much since built):
- Its top-3 build order (§7, 216-224): expose rho — DONE (`out.rho`, `rhoOk`, 8 km/h gate 22615-22622); spin flag gating the rating — DONE (`gpDriftSpun` 23029, consumed 23083, restated two-branch rule from §4:129 implemented exactly); settledness replacing wobble — DONE (settle in `gpDriftCornerRead`; the old spread survives only as a non-rated shape descriptor, 22748-22755).
- Metric 16 description of the calibration (regress path rate ON body rate and invert, 0.8–1.25 refusal, 200 samples, variance ≥9) matches code exactly.
- **Not built** from its list: the measurement-health panel (fitted scale/bias/fitN/anchors/refused-fraction — only the ±typical/±worst/weak sentence exists, 23697-23717), session totals/histogram, initiation/transition-agility/bobbles/two-stage metrics, live score.
- Its overlay line numbers (16818, 16965, 17102…) predate later edits — do not trust them; the current anchors are the ones in this report.

## data_shapes

## Trace row (in-memory, `gp.trace[i]`) — built at download overlay:21054-21061, live 40105-40120
```js
{ lat: dv.getInt32(o,true)/1e7,        // deg
  lon: dv.getInt32(o+4,true)/1e7,      // deg
  kph: dv.getUint16(o+8,true)/100,     // km/h
  hdg: dv.getUint16(o+10,true)/100,    // deg course-over-ground, 0=N, clockwise
  t:   tcur,                           // absolute ms (GPS iTOW-derived); undefined pre-timestamp
  g:   0,                              // longitudinal g, filled by gpComputeG (20592)
  can: [u16|null,...] | null,          // length === gp.traceChanIds.length; null = TRACE_CHAN_STALE
  gyroz: -graw*0.02 | undefined,       // deg/s, compass-positive (NEGATED from wire); undefined = TRACE_GYRO_NONE
  brk/brkTime/brkM }                   // teleport/pause break flags (24166-24181)
```

## Packed store record (IndexedDB `rdm7_sessions_db`.data) — gpRowsPack 10322-10360
```js
{ v:1, n, lat: Int32Array /*×1e7*/, lon: Int32Array, kph: Uint16Array /*×100*/,
  hdg: Uint16Array /*×100*/, t: Uint32Array /*GP_NO_T=4294967295 = no stamp*/,
  nch?, can?: Uint16Array /*n×nch sample-major, 0xFFFF=GP_CHAN_STALE*/,
  gyro?: Int16Array /*deg/s ×50, -32768 = none; key-absence = pre-gyro recording*/ }
```

## Session meta (IndexedDB `rdm7_sessions_db`.meta) — gpSessionMeta 11467-11507
```js
{ id: "ses_<base36>", name, trackId, trackName, trial, recordedAt, dated:"gps"|"download",
  savedAt, startT /*identity: first-sample abs ms or null*/, device, samples, durationS,
  lapCount, bestLapS, lapTimesS:[s...], lapsBy:"gate"|"stops"|null,
  corners:[{lat,lon,kph,s}...] /*best lap fingerprint*/,
  chanIds:[id...]|null, chanDefs:[{id,name,unit,decimals,scale,offset,(is_signed via decode)}...]|null,
  car:"", driver:"" }              // free text ≤24 chars, "stage 6 fills these in" (11506)
```

## Drift-angle result (`gp.drift`) — 22623-22626 (direct variant 22252-22254)
```js
{ beta: Float32Array /*deg ±180*/, ok: Uint8Array, conf: Float32Array /*± deg*/,
  src: {kind:"yawrate"|"angle", id, name, unit, guessed, get(i)}, direct: bool,
  rho: Float32Array /*sideslip rate deg/s, raw per-leg-uncorrected*/, rhoOk: Uint8Array,
  legs: [{from,to,mis,secs,conf,sigma,wander}...],
  scale, bias, fitN, weak, anchors, worst, sigma }
```

## Drift board (`gp.driftBoard`) — 23261-23262
```js
{ refLap, corners:[{n,entry,apex,exit,lat,lon}], units:[{i,members,linked,n0,n1,name,lat,lon}],
  link:[bool], cells[lap][unit]: {from,to,apex,secs,kph,entryKph,exitKph,lowKph,switches,
    angle:{peak,held,secs,area,conf,rough,direct,soft}|null, settle, commit, metres,
    spun:{why:"over"|"dropped",deg,at,conf}|null,
    rating:{parts:{angle,commit,steady,speed},score,stars,ver}|null, members?},
  best:[lapIdx per unit], lapAvg:[{stars,n}|null], bestKph:[kph per unit] }
```

## Node config (RPC node.config.get → `gp.node`) — serial_rpc.c:313-319, config_store.h:44,52,60
```js
{ mounting: {x:"forward",y:"right",z:"up"}, gyro_bias_cdps: [i16,i16,i16] /*centi-deg/s*/,
  tz_offset_min, record_on_boot, ... }
```
Firmware: `imu_cal_t { uint8_t dir[3]; int16_t gyro_bias_cdps[3]; }`; `imu_cal_apply` (imu_cal.c:64-76) does `g_unbiased = g_in - bias` then signed permutation.

## Storage keys
- IndexedDB `rdm7_sessions_db` (stores `meta`, `data`) — 10248
- localStorage: `rdm7_gp_driftsrc` (per-session-id drift source pref, 22150), `rdm7_gp_logchans` / `rdm7_gp_devchans` (36450-36451), `rdm7_gp_caricon` / `rdm7_gp_carpng` (26747-26748), `rdm7_timefmt` (38388)

## gotchas

- **Live vs download gyro sign mismatch**: download negates (`-graw*0.02`, overlay:21052) to convert right-hand-rule → compass-positive; the live path does NOT (`s.imu.gz_cdps / 100`, overlay:40119) even though its comment claims "the live rack and the live Drift view read one thing" (40115-40116). Both are vehicle-frame off the node (serial_rpc.c:283). Any per-car calibration touching sign must reconcile this — and it may be a live bug already.
- **The calibration fit refuses to fix sign/mounting**: scale outside 0.8–1.25 → `{scale:1, weak:true}` (22331-22336). A mirrored/mis-mounted gyro is deliberately NOT auto-corrected — a per-car calibration feature is exactly where that refusal would be revisited, and the comment there names "mirrored mounting" as a case.
- **Bias is applied twice by design**: node subtracts the stationary bias before recording (imu_cal_apply); Studio's fit estimates residual bias per session anyway. A stored per-car bias would be a third layer — decide where it composes.
- **Sign convention throughout Studio**: + yaw = rightward/clockwise (compass). CAN yaw channels come through `gpChanValue` un-negated — a car-bus sensor with the opposite convention currently just fails the fit as weak. The academic β sign is opposite to Studio's (research doc §4, line 145).
- **Caches**: `gpDriftAngle` and everything downstream memoise on keys of `rows.length:ghostFence:src.kind:src.id` only (22225, 22657, 22698, 22876, 23189). A new calibration input (per-car scale/sign) MUST either enter these keys or call `gpDriftForget()` (22166-22172), like `gpDriftSrcSet` does (22162).
- **`GP_DRIFT_SCORE_VER` (22055, currently 4)** must bump if anything changes a number a corner already earned — every rating is stamped with it.
- **Test harnesses extract app code verbatim by regex**: `tools/check_drift.js` and `tools/check_mallala.js` grab functions matching `^        function NAME(` (8-space indent) and constants matching `var NAME = <number>` from tauri-overlay.html. New engine functions/constants must follow those exact formatting conventions or the harness fails to find them; the WANT list in check_drift.js names every drift function under test.
- **The unit decides, never the name** (`gpDriftGuess` 22121-22148): no unit → no auto-pick; a calibration UI must not bypass this honesty rule (a radian channel read as degrees is ×57 wrong with nothing visibly odd).
- **Time is never index×40 ms**: the node skips idle and drops samples; all accumulation uses `gpStep` (capped 0.5 s) and spans use `gpSecs` (24064-24094). The angle engine additionally hard-breaks and re-anchors at gaps >2 s and `brk` teleports (22427-22441).
- **`fix_bytes` is asked, never assumed** (20974-20991): 12-byte pucks exist and silently carry no gyro; hard error if `bin.length !== cnt*fixB` (20992-20996).
- **`can` column invariant**: candidates require `rows[0].can.length === traceChanIds.length` (22087); the puck gyro is a virtual candidate (`idx:-1`, own getter) precisely because it is outside that invariant (22089-22103).
- **Appending order is load-bearing** (22089-22096): puck gyro joins candidates LAST so an existing car-bus channel auto-pick never silently changes source. A per-car default source must preserve this.
- **Session `car` field is free text ≤24 chars** (12516) with no id — using it as a calibration key means typo-sensitivity; the per-session drift-source pref (`rdm7_gp_driftsrc` keyed by session id, "current" for unsaved) is the existing pattern for per-recording prefs.
- **ADR-0011 honesty rule pervades**: no angle without a sensor, refusals are worded UI states (23372-23380, 23470-23489), rough (conf > `GP_DRIFT_ROUGH` 8) greys/refuses ratings, HUD prints "rough" instead of a number (30521-30528). A calibration feature that widens confidence must feed the same `conf` array, not add a parallel one.
- **Frontend is built**: all edits go in `src/tauri-overlay.html` (the whole GPS workspace is one IIFE, `gp`/`GP_` prefixes, CSS under `#gpWorkspace`); never `src/dist/`.

## open_questions

- Whether the Drift view actually computes an angle in live mode (gp.liveMode) — live rows do carry `gyroz` so `gpHaveGyro()` is true and the engine would run with the un-negated sign; I did not trace whether the drift view is reachable while live, so the severity of the 40119 sign mismatch (bug vs dead path) is unconfirmed. Looked at gpLiveAppend (40098-40135) and the view gating at 18101/23403 only.
- Where "stage 6" (the plan whose stage fills `car`/`driver`, 11506) is written down — the phrase appears nowhere else in rdm7-desktop; possibly in an older revision of LAP_ANALYSIS_REDESIGN_2026-07.md or a session transcript. Searched the repo docs and overlay.
- Exact CAN base id for the puck's broadcast frames (the frame map lists offsets 0x1..0x9; docs/DRIFT_MODE_PLAN mentions "0x405/0x406 IMU frames" and MEMORY says lap = 0x407, implying base 0x400) — I did not read `frame_id()`/`rdm_gps.h` in the node repo to confirm the base or whether it is configurable.
- Whether `gp.node` (mounting/bias shown in Setup) is refreshed anywhere other than attach + `gpNodeSave`/`gpRecBootSet` responses — only found the getter wiring at overlay:40292 and did not trace the attach flow.
- The full VBO/AC importer paths for a log carrying a *direct slip-angle* column (kind "angle") — I verified the generic per-column def fitting (10993-11017) and gpDriftGuess classification, but not whether any importer special-cases known drift-box column names.