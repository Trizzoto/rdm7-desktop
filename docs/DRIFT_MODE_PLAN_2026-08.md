# Drift mode — plan (2026-08)

**Status: REDESIGNED 2026-08-10.** The first cut shipped runs-and-courses: a
run was a burst of driving, and you scored it by drawing clips and zones on the
map. That is how a drift *event* is judged, and it turned out to be the wrong
shape for how a drifter *practises*. On a circuit you do laps, you drift every
corner of the lap, and the only question you ever ask afterwards is **"was turn
three better that time?"**

So the unit of judgement is now the **corner-on-a-lap**, and each one is rated
**out of five stars**. Courses, clips and zones are gone.

What replaced them:

- **Laps, not runs.** Drift shares `selLap`/`cmpLap` with Analyse and Corners,
  so playback, ghosts, the scrubber, framing and the legend all work unchanged
  and switching views keeps your place.
- **Corners found once, mapped everywhere.** One reference lap supplies the
  corner set; every other lap is matched onto it by position under the same
  40 m rule `gpCompareLaps` uses. Finding them per lap would renumber the
  whole track whenever one lap missed one, and silently compare turn 4 against
  turn 3.
- **A rating out of five**, from four measured parts — angle held, how much of
  the corner it was held for, how steady it was, and speed. Three are graded
  against a fixed standard printed on screen; only speed is graded against your
  own best there.
- **Best lap per corner**, named in the table. Different laps win different
  corners, which is the entire point.

Verified by `node tools/check_drift.js` (80 checks: the angle engine and the
star arithmetic) and `node tools/check_mallala.js` (35 checks: the whole chain,
against six laps of synthetic Mallala drifting whose planted angle is known
corner by corner and lap by lap). Driven end to end in the app through the VBO
import path.

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
gate-split laps, and Corners ranks where the TIME went. Drift ranks where the
ANGLE went, corner by corner, and its glance is a corner-by-lap table. The
Corners view is the template: a full-page view borrowing the map singleton,
`gp.trace` and the coach-ops memoisation pattern.

It uses the ordinary lap selection — `selLap`, `cmpLap`, `shownLaps` — rather
than owning its own. That was the single biggest simplification of the
redesign: playback, the scrubber, ghosts, framing, the legend and the dock all
worked on laps already, so pointing Drift at laps deleted the branches instead
of rewriting them. Only the corner selection (`gp.driftCorner`) is Drift's own.

### Corners, not runs

- Corners are detected **once**, on one reference lap, with the shipped
  `gpFindCorners` — the same detector the Corners view uses.
- The reference lap is the first lap whose corner count is the **modal** count
  for the session. Not the fastest lap: a drifter's fastest lap is meaningless
  and may be the one they gave up on. Ties go to the higher count, because a
  corner nobody assessed is worse than one assessed on fewer laps.
- Every other lap is mapped onto that set by position, boundary by boundary,
  rejecting anything more than 40 m from what the lap actually drove — the
  middle of `gpCompareLaps`, not its output. A lap that went off, pitted, or
  never reached a corner has **no reading** for it, and that null travels all
  the way to the table as an em-dash.
- Corner identity is therefore stable: "turn 3" is the same tarmac on every
  lap. `gpCompareLaps`'s own `n` is NOT stable — it counts only corners that
  survived matching, so a lap that dropped turn 3 renumbers everything after
  it. That trap is why the corner set is built here rather than borrowed.

### The rating: five stars, four measured parts

| Part | Weight | Measured | Full marks |
|---|---|---|---|
| **Angle** | 40% | mean angle held while above the drift threshold | 40° held |
| **Committed** | 25% | fraction of the corner spent above the threshold | all of it |
| **Steady** | 20% | RMS of the angle against a 0.6 s rolling mean of itself | no wander |
| **Speed** | 15% | mean speed through the corner | your own best there |

Three of the four are graded against a **fixed standard**, printed on screen
beside the stars. Grading everything on your own best would hand five stars to
the best of a bad night, and — worse — would silently restate every old score
the moment a better lap arrived. Only speed has no fixed bar, because what is
fast through a corner depends entirely on the corner.

Half stars, because five whole ones cannot separate a good corner from a very
good one and ten would imply a precision the angle does not have.

Two refusals are load-bearing:

- **No angle source, no stars at all.** Not a rating out of the three parts
  that survive — a drift rated without the angle rates everything except the
  thing being judged.
- **A corner nobody drifted is UNRATED, not nought-star.** This one only showed
  up against the fixture: a car driven round on the grip scored full marks for
  *steadiness* and for *speed*, the two things easiest to score by not trying,
  and landed above a corner somebody nearly held.

Style is never machine-scored. The community fight over Wally is the
cautionary tale, and the facts table is the product — the stars are the glance,
the four parts are shown underneath, and the standard is written out in words.

### Panels (each one fact per column, plain words)

| Panel | Draws | Interaction |
|---|---|---|
| Laps | one row per lap: When · Time · Rated (n of N) · Best angle · Stars | click selects; tick to draw on the map |
| Corners | one row per corner of the selected lap: Turn · Angle · Comm · Wob · Stars · Best lap | click selects and frames it |
| Corner | tiles (in/slowest/out, angle held/widest/sideways for), the stars, the four parts as bars, and the difference against your best lap there | glance |
| Map | every ticked lap; selected lap coloured by Lap / Speed / Angle; numbered corner badges; switch marks | tick, colour mode, scrub |


### Courses, clips and zones — retired 2026-08-10

The first cut let you draw a clip (a point the car should get to) and a zone (a
stretch it should ride), and scored a run against them out of a shrinking
denominator. It worked, it was verified, and it is gone.

Why: a clip is a **place on the track**, and a corner is a **stretch of
driving**. Practising is corner-shaped — you do not ask "did I hit the clip on
run 4", you ask "was turn three better that time". Keeping both would have
meant two scoring systems that could disagree about the same drift.

`courses:[]` is deleted from the track record on load rather than migrated:
there is no honest way to turn a clip into a corner. The idea is not wrong, it
is just an EVENT feature rather than a practice one — if grassroots event
scoring is ever built, this doc's git history has the whole design.


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

From the first cut, all still load-bearing and all in ADR-0028:

1. **An anchor is a car going STRAIGHT, not a car whose angle is steady.**
   A car holding 40° through a long corner has ρ = 0 there too, so anchoring on
   ρ ≈ 0 zeroes the angle in the middle of the very drift being measured.
2. **A gap in the recording poisons several samples either side, not one.**
   The course rate is a central difference over ±3 samples, so a car heading
   south before a gap and north after it reads as an enormous turn that never
   happened.
3. **A flat error bar on open ends is wrong in both directions.** It now grows
   with distance from the anchor.
4. **Least squares is the wrong fit for the gyro scale** — it assumes the
   regressor is exact, and the regressor is course-over-ground differentiated
   over a quarter of a second. A lagged instrument fixes it.
5. **One channel resolver, not two.** Name/unit/decode come from the channel
   library first, the recording's own definitions second.

From the corner redesign:

6. **"Wobble" must measure wander, not the shape of the drift.** Measured as
   the spread of the angle around the corner's own mean — which is what the
   segment machinery does — a drift's natural rise and fall dominates
   everything else, and a perfectly smooth 30° drift scored the same 9° of
   "wobble" as a ragged one. Worse, the corner that was barely drifted came
   out the *steadiest on the lap*, purely because it had less shape to it. It
   is now the RMS of the angle against a 0.6 s rolling mean of itself: the
   envelope survives that, the wander does not.
7. **A corner driven on the grip is not a nought-star drift.** Rating it gave
   full marks for steadiness and for speed — the two parts easiest to score by
   not trying — and put a corner nobody drifted above one somebody nearly
   held. Under the drift-hold floor it is now unrated, and says so.
8. **Quote the typical error, not the worst.** One leg that failed to close
   made a session that is ±1° almost everywhere announce itself as "±40°",
   which reads as "this tool cannot measure angle" when it means "this tool
   knows which corner it could not measure". Both numbers are now shown.
9. **Fixture realism is load-bearing, again.** Three separate "app bugs" found
   during this work were all bugs in the synthetic drive:
   - a lateral offset keyed on lap index **teleported the car sideways** at
     every start/finish crossing — an impossible turn rate the engine
     correctly read as a 90° misclosure;
   - restarting the integration at each lap boundary put the car a metre
     **behind** where the previous lap left it, which is a reversed heading;
   - a speed ceiling taken straight from the simplified survey's curvature
     asked the car to take a kink at **22 km/h**, below the floor where course
     over ground stops being a direction at all.
   Each one presented as the app being wrong about a real corner. None was.
10. **The driver's character must change at the TIMING LINE**, not at distance
    zero. The app cuts laps at the line, which is partway round the circuit, so
    a fixture that changes character at s=0 gives every measured lap half of
    one character and half of the next — and the corner-to-corner comparison
    then compares nothing.

### Known limit: a flick the angle cannot close

At Mallala's final complex — a right–left–right where the planted drifts
overlap and the angle swings through ±80° in a couple of seconds — the angle
engine's closure fails and the corner reads **rough** on every lap. That is the
honest answer (there is no straight inside the flick to close against), the
view greys it out and says why, and it is never rated. But it is a real
limitation of closure-on-grip rather than a property of that corner, and a
transition-aware anchor is the obvious next thing to try. Deliberately NOT
papered over: the harness asserts that a rough corner is never rated.


## 4. Build phases

### Cut 1 — the view, on today's data, Studio-only — **DONE, then redesigned**

Shipped as runs + gap/gate segmentation + the angle engine + honest empty
frames. The angle engine, the switch detection, the channel picker and the
honesty ladder all survive the redesign untouched; the run segmentation and the
scorecard do not. See "Courses, clips and zones — retired" above.

### Cut 2 — courses and points — **DONE, then retired**

Clips, zones, per-element points with a shrinking denominator, personal-best
comparison, scoring-version stamp. Retired 2026-08-10 in favour of per-corner
ratings. `GP_DRIFT_SCORE_VER` went 1 → 2 at the same time, which is exactly
what that constant exists for: no run keeps a score it earned under different
rules.

### Cut 2b — corners, lap by lap, out of five — **DONE 2026-08-10**

The current design. Corner set from one reference lap mapped onto all of them;
four-part rating; best lap per corner; the map showing every ticked lap with
numbered corner badges. Verified by `check_drift.js` (80) and
`check_mallala.js` (35, whole chain against a known-angle six-lap fixture).

Not built: a trend strip across sessions (best stars per corner over the year).
It wants more than one session's worth of laps to mean anything, and the
per-session board is the thing that had to be right first.


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
   is still the right moment to land it.
2. Trace v2 CAN sniffing is compile-only — bench verification is a prerequisite
   for cut 3, not part of it.
3. Any target car with a steering signal wider than 16 bits? (v2 slots are u16.)
4. **The flick that will not close** (see the known limit above). Worth trying:
   an anchor that accepts "the angle passed through zero on its way to the
   other side" as a closure point, which is what a transition physically IS.
5. **Is 40° the right bar for five stars?** It is defensible and it is printed
   on screen, but it is one number chosen from the D1/FD literature rather than
   from this user's own driving. Revisit once there is a season of real
   sessions to look at — and bump `GP_DRIFT_SCORE_VER` when it moves.
6. Should the corner set be pickable rather than the modal-count lap? Automatic
   and deterministic is right for now; a session where the driver goes off on
   the reference lap would want an override.
