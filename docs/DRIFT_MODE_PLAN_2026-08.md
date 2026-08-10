# Drift mode — plan (2026-08)

**Status: BUILT 2026-08-10.** Cuts 1 and 2, plus the whole Studio side of cut 3,
shipped together in `src/tauri-overlay.html`. The decisions are recorded in
**ADR-0028 "Angle waits for its sensor"**; this doc is kept as the reasoning
behind them and the roadmap for what is left. Verified by
`node tools/check_drift.js` (56 checks against a known-angle drive) and driven
end to end in the app through the VBO import path.

Two things changed on the way from plan to build, both noted in the ADR:
- **Course authoring lives in the Drift view, not Tracks** — you draw a clip
  and immediately see it scored against the run you just did.
- **Scoring shipped in cut 1**, not held back to cut 2; the honest-denominator
  rule made it safe to ship before an angle sensor exists.

Companion docs: `LAP_ANALYSIS_REDESIGN_2026-07.md` (the lap-timing side this
builds on), `../../rdm-gps-node/docs/TRACE_V2_CAN_CHANNELS.md` (the CAN
ride-along path), RDM-7_Dash ADRs 0011/0012/0013/0024/0025/0027/0028.

## 1. What the user pointed at

"Wallee in Formula Drift" is **Wally**, Race Data Labs' roof-mounted "Robot Drift
Judge". For the 2026 season Formula DRIFT adopted their Universal Drift Scoring
Method: **~80% of a PRO qualifying score (line + angle) is machine-generated from
telemetry; the remaining 20% (style) stays with the three human judges.** D1GP has
done the objective version for years with DOSS ("D1 Original Scoring System"):
speed, angle, and angle stability scored per course section, originally off a
Racelogic DriftBox. The precedents worth stealing:

| System | How it gets angle | Accuracy claim | What it scores |
|---|---|---|---|
| Wally / UDSM (FD 2026) | unpublished (cm-class positioning) | unpublished | line + angle machine-scored; style human |
| DOSS (D1GP) | DriftBox-class in-car telemetry | — | speed, angle, transition sharpness, angle stability, per section |
| Racelogic DriftBox | 10 Hz GPS course-over-ground + internal yaw gyro | 1° | run = >5° drift at >25 km/h; speed/angle/g + a score |
| VBOX 3i dual antenna | second antenna gives true body heading | 0.04–0.2° RMS | measured slip angle outright |
| DriftMeter (phone app) | EKF: phone gyro + GPS COG | ±0.5° claimed | 50% max angle / 30% entry speed / 20% duration |

## 2. The physics fact that shapes everything

Drift angle is **where the car points minus where the car travels**. The trace's
`hdg` is course over ground — where the car travels. A car circling at 40° of slip
lays down the *identical* GPS trace as one gripping round the same arc. No filter
recovers what was never observed, so a GPS-only "angle" would be exactly the
fabrication ADR-0011 forbids. Every tier of this plan is a different way of
obtaining the missing half — body heading — and every number waits for its sensor.

### What the hardware audit found (rdm-gps-node, with file:line evidence)

- **The puck already has the sensor.** A 6-axis IMU (ST LSM6DSO32X fitted; DSV32X
  specified — rev A BOM bug E5, one firmware serves both). Gyro Z is calibrated
  vehicle yaw rate: mounting rotation applied, stationary bias subtracted, sampled
  in the GNSS fix callback so it is **phase-locked to the 25 Hz fixes**, broadcast
  on CAN as `GpsGyroZ` (0.01 °/s).
- **The flash trace does not record it.** `trace_sample_t` is 12 bytes:
  lat/lon/speed/heading. Attitude graphs are a node change, not a Studio one
  (ADR-0012 said this already).
- **The puck cannot sniff its own broadcasts.** `TWAI_MODE_NORMAL` — no
  self-reception — so its 0x405/0x406 IMU frames can never ride the v2 CAN-channel
  slots. Getting puck yaw into the recording means widening the record.
- **An external car's yaw/steering CAN frame CAN ride along today** (v2 channels,
  ≤16-bit signals) — firmware implemented 2026-07-30, **compile-clean but never
  bench-verified against a live bus**. The GT86 family broadcasts everything wanted
  on the stock bus and the dash already knows the decode: yaw rate + steering on
  `0x0D0`, lateral/long g, four wheel speeds on `0x0D4`
  (`ecu_presets.c:736`, `preset_picker.c:393-401`).

### The sensor ladder

| Tier | Body-heading source | Angle shown? | Error class |
|---|---|---|---|
| 0 — today's trace | none | **no — honest empty frame** | — |
| 0i — imported log with a gyro/angle column (DriftBox, RaceBox, VBOX) | the logger's instrument | yes — derived or passed through, source labelled | ~1–2° |
| 1 — car CAN yaw via v2 channels | ECU chassis sensor | yes — derived, "from the car" | ±2–3°, self-calibrated |
| 2 — puck gyro Z recorded (v3 trace) | LSM6DSO32X | yes — derived, **works on any car** | ±2° typical |
| 3 — dual-antenna GNSS | second antenna | **measured** outright | 0.04–0.2° RMS (future hardware) |

Tier 0 still earns its keep: line, speed, and lateral g are measured path geometry,
and line repeatability is arguably the most coachable practice-day metric.

## 3. The design

### A seventh view: **Drift**

Not an Analyse mode. Analyse's model is one lap against one reference over
gate-split laps; drifting's unit is the **run**, its glance is a ranked run table,
its map default is all runs overlaid. The Corners view is the template: a
full-page view borrowing the map singleton, `gp.trace`, and the coach-ops
memoisation pattern. Cost is known: `gpSetView` whitelist + button, branches at
the ~8 string-dispatch sites (gpSetView, gpBuildRail, gpRenderInspector,
gpDrawTrace, poll-rate, map-pan, keyboard, boot), one wrap div, CSS scoped under
`#gpWorkspace`. One law inherited from ADR-0025: one run against one reference,
never N-way.

### Runs, not laps

- **No course drawn:** a run is a burst of movement. The trace records nothing
  below 8 km/h, so practice runs arrive naturally bracketed; a >10 s hole in `t`
  splits runs. The view is useful the first time it opens.
- **Course drawn:** entry line → end line, using the shipped point-to-point trial
  machinery unchanged (ADR-0013: "a finish line is a thing you add, not a mode you
  pick"). Spans are `{from,to}` shaped like `gp.traceLaps`, so playback, `gpSecs`,
  ghosts, and framing work day one — and the puck beeps at the entry line
  trackside because it's an ordinary two-gate track.

### Panels (each one fact per column, plain words)

| Panel | Draws | Interaction |
|---|---|---|
| Runs | one ruled row per run, newest first: When · Entry · Lowest · Exit · Time · Switches · Angle | click selects; pin one as the shadow run |
| Map | all ticked runs in the 8 lap colours; shadow run dashed; selected run coloured by mode; transition dots T1/T2/T3 | tick/untick, colour mode, scrub with ghost dot |
| Run tiles | Entry speed · Exit speed · Time in course · Switches · Strongest cornering · Widest angle | glance |
| Switches | one row per direction change: Where · Speed in · Speed out | click jumps playback there |
| Channels | the existing graph rack; Angle and Steering sit as honest empty frames until backed | scrub, toggle lanes |

"Entry / Lowest / Exit" is the practice-day glance: Lowest is the "did the drift
die mid-course" number. Map reuses `gpTraceCv`/`gpDrawTrace` wholesale — never
decimated, never displaced (ADR-0027). Line repeatability in v1 is the overlay
itself: eight runs ticked on one map.

### Transition ("switch") detection — tier 0, honest

Sign flips of the derived lateral-g series with hysteresis (hold the new sign
above a small g floor, speed ≥ the existing 8 km/h gate). This is measured path
geometry — the car verifiably swapped turning direction — so it's honest without
body attitude. UI word: "moments the car swapped from turning one way to the
other." With a yaw channel it upgrades to the full state machine below.

### The angle engine (one implementation, fed by tiers 0i/1/2)

Offline, two-pass, treating grip driving as the calibration lab:

1. **ρ = r_body − r_path** per sample — yaw-rate channel minus the existing
   verified course-rate derivation. In grip ρ ≈ 0; in a drift ρ is the rate of
   change of drift angle.
2. **Calibrate from grip (pass 1):** fit per-session gyro bias (near-straights)
   and scale (regression of r_body vs r_path on grip corners). Kills the sleeper
   dominant term — ±1% scale error is 2–6° over a ten-second drift. Also
   self-calibrates unknown-spec ECU sensors.
3. **Anchor** at the last low-load grip moment (|glat| < 0.3 g), integrate ρ.
4. **Closure:** each segment ends back in grip where β must return to ~0. The
   misclosure IS the segment's measured error — redistribute it (surveyor's
   traverse) and **display ± max(|m|/2, 1°)**. |m| > 8° greys the row out. The
   error bar on screen is a measurement of this run, not a datasheet claim.

Budget: ±2° typical for drifts up to ~15 s — DriftBox-class, against angles of
interest of 20–60°. Validity floor 25 km/h (COG noise blows up ~1/v below;
DriftBox's own run definition). Verification per the ADR-0012 discipline:
synthetic drift trace with known slip + closure-on-grip-only regression +
one real imported log.

State machine (only with a yaw channel), plain UI words: Grip → Entering
(|ρ| ≥ 15 °/s or |β| ≥ 3°) → Drifting (|β| ≥ 10° held 0.5 s) → Straightening
(|β| < 5° for 0.5 s). All event times interpolated between samples via `gpSecs`,
displayed to 0.1 s. Steering (when present) cross-checks: opposite lock —
steering sign against path curvature — is *directly measured* drift confirmation
grip can never produce.

**Naming repair that ships with any yaw channel:** the current "Yaw rate" lane is
course rate. When a body-yaw channel exists show both as **Turning (path)** and
**Turning (car)** — the divergence is the whole signal; never let one impersonate
the other.

### Courses: scored shapes beside the gates

Stored on the `rdm7_tracks_v1` track record as `courses:[]` — versioned JSON
normalised on load, the same way `outline` already lives there. **Studio-side
only**; `gpTrackSend` keeps whitelisting only start/finish/sectors (verify).
Authoring lives in Tracks, next to gate placement. Two element shapes only, both
provable from a single-point path:

| Shape | FD equivalent | Stored as | Scored on |
|---|---|---|---|
| Clip | inner clipping point | `{lat, lon, radius_m, max_points}` | closest the path came, in metres |
| Zone | outside zone / touch-and-go | `{points:[…], band_m, max_points}` | % of zone length covered while inside the band |

No polygons — an outside zone in real judging is a wall-side line the car should
ride. The editor **refuses** shapes tighter than 2 m: the M9N is metre-class, and
the tool must not pretend otherwise.

### Scoring: measured points, honest denominator, style never machine-scored

| Criterion | Scoreable? | How |
|---|---|---|
| Line | yes, today | per-element points from path geometry, every point pointable-at on the map |
| Speed | yes, today | entry speed vs the course's target (defaults to best recorded, author can override) |
| Angle | only when a sensor backs it | angle held / biggest angle / wobble deduction per drift span |
| Style | **never by the machine** | a labelled human-entry field, or absent |

Rules that keep it honest: **never renormalise around a missing sensor** — a run
with no angle source reads "46 of 60 measured", the denominator shrinks visibly.
Every scorecard carries a **scoring version**; old runs keep the score they earned
under the rules they ran under. No blended mystery number — the community fight
over Wally is the cautionary tale, and the facts table is the product.
The reference is always **your own best run on this course** — dashed ghost,
per-element difference table — never another driver.

### The honesty ladder (proposed ADR-0011 A4 widening, lands with cut 1)

| Word | Meaning | Shown as |
|---|---|---|
| Measured | a sensor reported it | plain number |
| Derived | exact arithmetic on measured values (ADR-0012: "derived, not recorded, and that is legitimate") | plain number |
| Estimated | a model with error | error bar shown, the word "estimated", never in a ranked column without its ± |

Absent sensors get the ADR-0012 empty-frame treatment with a plain sentence:
"Needs a yaw signal: from the car, from the puck's motion sensor once it's
recorded, or from an imported log that carries one."

## 3a. What the build taught (not in the original plan)

Three things only showed up once there was a ground-truth harness to run
against. All three are load-bearing, and all three are in ADR-0028:

1. **An anchor is a car going STRAIGHT, not a car whose angle is steady.**
   A car holding 40° through a long corner has ρ = 0 there too, so anchoring on
   ρ ≈ 0 zeroes the angle in the middle of the very drift being measured. The
   harness read a 38° corner as 29° and split one drift into three. The anchor
   now also requires the path not to be turning and the load to be low.
2. **A gap in the recording poisons several samples either side, not one.**
   The course rate is a central difference over ±3 samples, so a car heading
   south before a gap and north after it reads as an enormous turn that never
   happened. Blank the rate across that window, anchor outside it. Before this,
   a run beside a 95 s gap claimed ±16° when its own driving was worth ±1.
3. **A flat error bar on open ends is wrong in both directions** — it called
   two seconds of run-in as doubtful as a minute of it, and made every
   recording's first and last run inherit the worst case. It now grows with
   distance from the anchor.
4. **Least squares is the wrong fit for the gyro scale.** It assumes the
   regressor is exact, and the regressor is course-over-ground differentiated
   over a quarter of a second — the noisiest thing in the room. With an
   ordinary 0.3° of heading noise the slope came back 0.964 for a gyro that
   was truly 1.008, putting a 38° corner on screen as 41°. A lagged instrument
   fixes it (1.0042). The harness had been giving the synthetic receiver a
   *perfect* heading, which is why it passed while the code was 4.5% out —
   fixture realism is load-bearing, not decoration.
5. **One channel resolver, not two.** Name/unit/decode for a channel id come
   from the channel library first, the recording's own definitions second.
   Reading only the second meant every puck-recorded channel reached the Drift
   view as raw CAN counts while the graph rack drew it correctly.

## 4. Build phases

### Cut 1 — ships on today's data, Studio-only, no firmware change — **DONE**

1. Seventh view **Drift**: button, whitelist, ~8 dispatch branches, wrap div,
   scoped CSS.
2. Run segmentation: gap-based; gate-based when a course has entry/end lines
   (existing trial spans).
3. Runs table + run tiles + switches table (lateral-g flip detection), memoised
   on the `gp.coach` pattern, cleared in `gpSplitLaps`.
4. Map reuse: runs overlaid, shadow dash, ghost playback; disabled **Angle** map
   mode with its unlock sentence.
5. The angle engine, activated by any yaw/angle channel — which today means VBO
   imports (DriftBox/RaceBox/VBOX columns already flow through `gpVboParse` into
   `rows.can` with zero import changes). Explicit "use this column as Angle/Yaw"
   picker against `chanDefs` — require °/s or °, ask once, store, never guess.
6. Angle + Steering as honest empty frames everywhere else.
7. ADR: the A4 widening of ADR-0011 with the measured/derived/estimated ladder.

No composite score in cut 1. A drifter with only the puck gets entry/lowest/exit,
switches, line overlay, and ghost replay the first day; a drifter who owns a
DriftBox gets the angle column by dragging in the file they already have.

### Cut 2 — courses and points (still Studio-only) — **DONE**

Clips + zones authoring **in the Drift view** (not Tracks — see the status
note), `courses:[]` on the track record, per-element points with the visible
shrinking denominator, personal-best comparison table, scoring-version stamp.
Not built: the trend strip (best-score-per-session over time) — it wants more
than one session's worth of runs to mean anything.

### Cut 3 — car CAN yaw/steering — **Studio side DONE; needs the bus proved**

The angle engine consumes any yaw-rate channel in the trace, so the moment
trace v2's CAN sniffing is bench-verified against a real bus, a GT86's `0x0D0`
yaw channel lights up the Angle lane, tiles, map mode and score with no Studio
change at all. Still to build on top: counter-steer lag, opposite-lock
confirmation (steering sign against path curvature — a directly measured drift
confirmation grip can never produce), rear-vs-front wheel overspeed. With
measured angle plus user-entered car length and puck position, rear-of-car
projection becomes honest geometry — zones could finally say "the back of the
car" like judges do.

### Cut 4 — puck gyro in the recording — **DONE 2026-08-10**

Built, on the reasoning that nothing is released yet so there is no installed
base to migrate. `trace_sample_t` is 14 bytes: the four original fields
untouched, plus `int16_t gyro_z_2cdps`. Sector magic RDMV → RDMW.

Three decisions worth keeping:

- **0.02 °/s per LSB, not the CAN frame's centi-deg/s.** An int16 of cdps
  stops at ±327.67 °/s and a hard flick goes past it — the Mallala fixture
  measured 339. Clipping there corrupts the angle at the exact instant the
  switch happens. The same two bytes at 2 cdps cover the whole ±500 dps the
  part is configured for.
- **`TRACE_GYRO_NONE` (−32768), never zero.** Zero is an ordinary reading
  meaning "going straight"; a fixed-width record cannot fall silent the way
  the CAN frames do, so it says so instead.
- **The reader asks for the width, never assumes it.** `trace.read` now
  declares `fix_bytes`; failing that Studio derives it from `record_bytes`
  minus the channel tail (which travels in a separate blob), and failing both
  assumes 12 — an older node. A page whose length disagrees is refused with a
  plain sentence rather than decoded into plausible nonsense.

Ring cost: 366 → 313 min with no channels (−14%); at the twelve-channel cap
only −5%. **Flashing it discards whatever session is on the puck** — the
magic bump means init finds no matching sector.

Studio needed no change to the angle engine at all; the gyro joins
`gpDriftChans` as a virtual source ranked LAST, so any recording that already
had a car-bus yaw channel keeps choosing it.

### Cut 4 (original plan text, for the reasoning)

Most grassroots drift cars are old chassis with no useful CAN — this is the tier
that works on *every* car and makes Drift a reason to buy the puck. Recommended
route: **v3 record, +2 bytes** — `[12 B fix][i16 gyroZ 0.01°/s][ch0..chN]`, magic
RDMV→RDMW — not TWAI self-reception (burns channel slots, ties the puck's own
gyro to bus health; the gyro is already sampled fix-phase-locked in `main.c`).
+17% flash at 25 Hz; re-run ADR-0012's storage arithmetic. Log gyro Z only; X/Y
stay live-only.

### Later, named but not promised

Locked shared courses with hashes + steward replay (grassroots event scoring);
per-run export in GPS time (broadcast overlay sync); tandem proximity — needs two
cars on RTK-class hardware (ZED-F9P generation, what FD's own fan telemetry
uses). GPS time-of-week is already a shared clock across cars, so two pucks give
lead-vs-chase *replay* before RTK gives measured *proximity*.

## 5. Open questions

1. Has ADR-0011 been formally widened per STUDIO_SHELL_PLAN §7 A4? This feature
   is the right moment to land it.
2. `gpTrackSend` whitelist — confirm strictly start/finish/sectors before hanging
   `courses:[]` on the track record.
3. Trace v2 CAN sniffing is compile-only — bench verification is a prerequisite
   for cut 3, not part of it.
4. Any target car with a steering signal wider than 16 bits? (v2 slots are u16.)
5. Composite score: deliberately out. Revisit only if users ask, and then with
   the formula printed on the panel.
