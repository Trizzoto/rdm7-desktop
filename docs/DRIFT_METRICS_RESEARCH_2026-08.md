<!-- Produced by a 12-agent research workflow on 2026-08-11: four parallel
     literature sweeps (Formula DRIFT/UDSM, D1GP/DOSS, drift video games,
     consumer telemetry products, vehicle-dynamics papers), two feasibility
     passes over this repo and the puck firmware, then three INDEPENDENT
     reviewers — honesty, coaching, computability — voting on every candidate.
     78 candidates in, 2-of-3 to survive. Vote counts are kept in the text.
     Nothing here is built. This is the menu, not the plan. -->

# The Ultimate Stats to Track for Drifting
### Research brief for RDM Studio — 11 August 2026

Three reviewers (honesty, coaching, computability) voted independently on 78 candidates. A metric reaches the shortlist only if **at least 2 of 3 kept it**. Vote counts are given for every metric in this document.

One bookkeeping note before the table: the honesty reviewer voted "keep" on the *not-measurable* entries meaning **keep them in the document as named anti-goals**, while the other two voted "cut" meaning **don't build them**. Those 1/3 scores are not real disagreements — all three agree those things must never be drawn. They are collected in *Deliberately not measured* below.

---

## 1. The shortlist

Twenty-five metrics that earn screen space, ranked by value delivered per unit of work.

| # · Metric · kept by | What it is | Why it matters | Tier | Precedent |
|---|---|---|---|---|
| **1 · Sideslip rate (how fast the angle is changing) — 3/3** | Body yaw rate minus path yaw rate, in degrees per second. Already computed as `rho` inside `gpDriftAngle` (overlay:16965) and thrown away at :17102. Exposing it is `out.rho = rho`. | Needs no anchors and no leg closure, so it survives a recording where the angle itself is rough. Settledness, initiation rate, transition agility, bobbles, two-stage initiation and the live score all hang off it. | **Have it now** (retiered from derivable-today by the computability reviewer) | Inagaki/Kshiro/Yamamoto AVEC 1995 uses this axis for the standard stability criterion |
| **2 · Drift angle — 3/3** | Where the car points minus where it is going, wrapped to ±180°, at 25 Hz. `gpDriftAngle`, overlay:16818. | The quantity the whole feature exists to produce. Everything else is a lens on it. | Have it now | Race Data Labs UDSM v1 defines it identically; Racelogic DriftBox manual p.8 |
| **3 · Error bar on every angle sample — 3/3** | Half the observed closure error of the leg between two straight-running anchors, spread linearly in time; 0.4°/s growth on open ends, capped at 8°, stamped 9° when there is no anchor at all. | Nobody in the market publishes a per-sample confidence. DriftBox states a flat 1°, DriftMeter a flat ±0.5°, UDSM publishes nothing. This is the differentiator, and it makes every downstream number defensible. | Have it now | DriftBox datasheet: 1° on drift angle vs 0.1° on heading — the subtraction is what costs you |
| **4 · Over-rotation and spin flag — 3/3** | Angle above 100° while the angle lane is valid, **or** the last valid angle before speed fell through the 25 km/h floor exceeded 45°. Softer band flags at 90° and 120°. | The only live correctness bug in the current product: with no spin concept, a half-spin is the session's biggest peak angle and scores full marks on the rating's 45%-weighted angle term. | Worth new maths | DriftBox manual p.16 publishes the two-branch rule; GT7 nulls a section above 90°; Damgam AC app ×0 past 120° |
| **5 · Settledness — 3/3** | Root-mean-square of the sideslip rate over the samples that were at angle, in °/s. | The most skill-diagnostic single number this sensor set can produce. Two drivers both at 40°: one holding it, one riding it. Immune to gyro bias (it is a spread about a mean), needs no closure. | Worth new maths | 2026 FD Judging Regs: "once at angle, the vehicle should remain settled and in control until the next transition" |
| **6 · Mean held angle — 3/3** | Plain average of the angle over the samples above the 10° threshold. `gpDriftStats.angle.held`, overlay:17288. | Formula DRIFT's entire 40-point Angle metric under another name, and the number a driver can target next run. | Have it now | UDSM v1 "Average Drift Angle"; 2026 FD Judging Regs §3.1(2); published field values 36° and 49° at PowerPark |
| **7 · Refusal, and the refused fraction of the session — 3/3** | No angle without a yaw source; no rating on a rough leg or a corner that never held 0.5 s; one plain sentence naming the fix (`gpDriftAngleWhy`, overlay:17755). Plus the part that is **not** built: what percentage of this session could not be analysed, and why. | Competitors refuse too — Racelogic will not output drift angle without DriftBox hardware — but nobody reports the refusal as a measurement. "Do one lap with a clean straight and I can rate this" is an instruction, not an apology. | Have it now (statistic is a trivial pass over `d.ok`/`d.conf`) | Racelogic Video VBOX manual; D1 2025 rules §11.2)③ suspends competition on instrument failure rather than synthesising a score |
| **8 · Two turning lanes, side by side — 3/3** | "Turning (path)" from course-over-ground, ±3-sample central difference (`ch.yaw`, overlay:14168). "Turning (car)" from the puck gyro at 0.02 °/s per LSB, ±500 dps headroom. | The honesty position rendered as UI instead of argued in a doc: one is where the car went, the other is where it pointed, the gap between them is the drift. Two lanes, two export columns, neither impersonating the other. | Have it now | Racelogic sells the YAW03 as a standalone module precisely because path rate is not body rate |
| **9 · Entry, exit and minimum speed — 3/3** | Ground speed at the threshold crossings and the lowest speed inside the drift. overlay:17250-17252. | Doppler ground speed is the best-measured channel in the record, and entry speed is the fact drivers most reliably misremember. Grading the rating on **entry** rather than mean speed is correct: mean speed goes *up* when a driver fails to commit. | Have it now | DriftMeter: entry speed is 30% of its published score |
| **10 · Commitment — 3/3** | Seconds at angle divided by seconds in the corner, capped at 1. overlay:17429. | Separates "drifted the corner" from "slid a bit on the way in", and points at a specific fix: initiate earlier, or stop straightening for the exit. | Have it now | FIA Drifting Guidelines §7.2; D1 2025 rules §11.3 (a sector not completed scores zero) |
| **11 · Transition agility — 3/3** | Per direction change: seconds from threshold on one side to threshold on the other; peak turn rate during the swing (take this from **raw** gyro, not the smoothed rate); and speed out ÷ speed in. | Fast swing **with speed kept** is what separates a competitive driver from a tidy one. The speed-kept term stops a driver gaming swing time by lifting. `gpDriftSwitches` already gives the event and both speeds — only the timing is missing. | Worth new maths | Stanford MARTY: figure-eight at ~50 km/h through ±40° of sideslip in about one second |
| **12 · Initiation rate and time to angle — 3/3** | Peak turn rate on the build, plus elapsed seconds from the 5° crossing to 90% of the held angle. | Directly practisable ("flick harder, get to angle sooner"). Paired with settledness it separates the driver who commits then settles from the one fighting the car from the first metre. **Take the peak off raw gyro** — the smoothed rate has a ~0.24 s window and flattens exactly the sub-0.5 s flick this measures. | Worth new maths | D1 Appendix-B §2-1)(2) penalises lack of quickness in the swing; UDSM lists "Angle Rate" as out of scope for its machine judge |
| **13 · Correction count (bobbles) — 3/3** | Sign reversals of the sideslip rate above a magnitude threshold while at angle, debounced ≥0.3 s. | The most legible thing you can draw on a map: *here is where you were fighting it*. Needs no CAN channel, which makes it the right smoothness metric for a puck-only car. | Worth new maths | Nakayama et al. SAE 1999-01-0892 (reversal-rate construction); UDSM leaves bobbles to human judges |
| **14 · Held-state triple — 3/3** | The mean angle, turn rate and speed the driver actually settled on during the held part of each drift. | A far better "what did you do here" than peak angle, and comparable corner to corner and run to run. The turn-rate term earns its place: at the same angle and speed it separates a tight rotating drift from a wide lazy one. | Worth new maths (near-free once the held window exists) | Hindiyeh & Gerdes equilibrium state vector, ASME DSCC 2009 |
| **15 · Anchors per lap, worst closure error, rough flag — 3/3** | Anchors are provably-straight islands: turn rate under 3 °/s, path rate under 4 °/s, cornering under 0.3 g, held 0.2 s, above 25 km/h. Legs close between them. | The provenance ledger for every angle in the session, and actionable at a different level than the per-sample bar: it tells the driver whether **the track layout** limited the analysis, which is a different fact from "uncertain". | Have it now | — |
| **16 · Gyro scale and bias, with a weak-fit flag — 3/3** | Fitted against provably-gripping driving, refitted with a 6-second leaky sideways mask, regressing path rate **on** body rate and inverting; any correction outside 0.8–1.25 is refused and says so. overlay:16869-16963. | An instrument that reports its own calibration is the strongest honesty claim available here. The fit needs 200+ masked samples and variance ≥9 in both rates, so a session with no hard cornering returns *weak* rather than a wrong number. The regression direction is a real trap: least-squares the obvious way round returned 0.964 for a true 1.008 — a 38° corner on screen as 41°. | Have it now (report scale, bias, sample count, weak flag) | DriftBox manual p.43 ships a manual 30-second re-zero for the same problem |
| **17 · Time at angle — 3/3** | Seconds above 10°, accumulated by elapsed time rather than sample count. | Actionable alone ("sideways for 1.2 s of a 4 s corner") and the base for commitment and the session histogram. | Have it now | DriftMeter: duration is 20% of its score; BMW makes it one of three star inputs |
| **18 · Degree-seconds — 3/3** | Area under the angle trace, counted only from 10° up, in °·s. | The only *accumulated* drift quantity any manufacturer publishes, and the natural currency for a session total and a personal best. Weight-free — nobody had to choose a coefficient. Best used at session scope: per corner it is just held angle × seconds, both already shown. | Have it now | BMW M Drift Analyser defines session drift performance as exactly this integral |
| **19 · Session totals and the time-at-angle histogram — 3/3** | Whole-session degree-seconds, seconds at angle, drift count, transition count, plus seconds spent above 10/20/30/40/50°. | Named as missing today — everything is per-span or per-lap. A shift in histogram shape (more seconds above 40°, fewer between 10 and 20) is the clearest "did I get better today" picture this data can draw. `gpDriftStats` already accepts any `{from,to}`, so a whole-session call needs no new machinery. | Worth new maths (near-free) | BMW M Drift Analyser session view |
| **20 · Run-to-run repeatability versus distance — 3/3** | Resample the angle and the turn rate onto a common course-distance axis; report RMS difference and correlation per corner and per run pair. | Repeatability is what actually wins events and almost nothing in the consumer market measures it. **The turn-rate version needs no closure and no anchors** — so it keeps working on exactly the sessions where the angle is refused. `gpArcLength` (:18380) and `gpSameSpotIn` (:19646) already exist. | Worth new maths | FD's two-run qualifying rewards consistency directly |
| **21 · Lap-over-lap angle delta — 3/3** | This lap's angle minus the comparison lap's, aligned by position. | Turns "you lost 0.3 s here" into "you straightened 8° early here", which names the fix. Ship as one feature with #20 — same alignment machinery, one is the trace and one is the ranking. **Must carry the combined error bar**: two ±3° legs differenced is ±4.2°, and without that a driver reads an 8° delta that is entirely closure error. | Worth new maths | — |
| **22 · Five-star corner rating — 3/3** | Angle 45% (40° held = full marks) + commitment 25% + steadiness 20% (10° of wander scores nothing) + entry speed 10%, graded against your own best at that corner. Version-stamped `GP_DRIFT_SCORE_VER = 3`. | Same shape as DriftMeter's 50/30/20 and BMW's three-input stars, plus a steadiness term, and uniquely versioned so a retune is visible rather than silently rewriting history. Two conditions: it must consume the spin flag first, and its steadiness term should move to settledness (#5). | Have it now, gated on #4 | DriftMeter 50/30/20 out of 100; BMW stars from duration, length and average angle |
| **23 · Two-stage initiation — 3/3** | A flick that crosses the entry threshold but fails to hold, followed within about a second by a second flick that succeeds. | A named −5 deduction in D1 and completely invisible today, because the two flicks merge into one drift. Cheaper than it looks: `gpDriftSegments` already finds and **discards** the failed first attempt at its hold-check branch — recording it instead of dropping it is the whole implementation. | Worth new maths | D1 2019 scoring table 二度振り −5; 2025 rules §11.3)①b |
| **24 · Counter-steer configuration — 3/3** | Boolean per sample: are the front wheels turned toward the outside of the corner? sign(steering) × sign(yaw rate) < 0. | The binary that separates "the car was sideways" from "the driver was drifting". There is no GPS or IMU substitute — this is the single highest-value CAN channel by a wide margin. | **Needs CAN** — steering angle | GT86/BRZ carry yaw rate + steering on 0x0D0; Voser/Hindiyeh/Gerdes VSD 48(S1), 2010 |
| **25 · Directly measured body heading — 3/3** | True heading from the carrier-phase baseline between two GNSS antennas, differenced against Doppler course. | The architectural alternative and the ceiling everything else is measured against. It does not merely improve the angle: it **deletes** every rough leg, every no-anchor refusal, and every "this track has no straights" limitation at once. | **Needs new hardware** — second antenna + moving-base receiver | VBOX 3i Dual Antenna <0.1° RMS at 1.0 m separation, <0.04° at 2.5 m, 100 Hz; u-blox ZED-F9H 0.4° static / 0.3° dynamic at 8-10 Hz |

**Also passed the 2-of-3 gate** and appear in the sections below: peak drift angle (3/3, paired only), transitions with speeds (3/3), drift detection thresholds (3/3), corner identification (3/3), best-at-this-corner board (3/3), longitudinal g trace (3/3), drift-under (3/3), speed bleed (3/3), steady-state residual (3/3), body-frame accelerations (3/3), cross-track deviation (3/3), sector decomposition (3/3), live score (3/3), staleness decay (3/3), wrong-direction guard (3/3), and the remaining CAN and hardware items (3/3 each). Narrower survivors at 2/3: sideways distance, angle-RMS wobble, path-derived cornering g, slip velocity, path curvature, yaw acceleration, phase portraits, g-g envelope, rear slip angle, zone fill, gate-windowed mean angle, D1 composite, off-course, front slip angle (degrees only), clutch-kick/RPM context, RTK, optical validation.

---

## 2. The live accumulating score

All three reviewers kept it (3/3), on one non-negotiable condition: **no measured attitude means no score at all** — not a degraded one, and never one built from speed alone. Extend that refusal to *rough* legs too: the error bar can reach 9°, which is wider than any sweet-spot band the score would be paying on.

Label it **entertainment**, version it the way the star rating is versioned, and keep it visibly separate from the rating. And be accurate about what it is: in Studio this is a **playback-accumulating** score. A genuinely live one belongs on the dash, which already receives the puck's yaw rate over CAN.

### What it accumulates

| Layer | Rule | Why this shape |
|---|---|---|
| **Rate** | Points per second only while angle ≥ 12° **and** speed ≥ 25 km/h. Drive the rate off **slip velocity** — speed × sin(angle), in m/s — not off degrees. | Slip velocity saturates naturally, so the score does not go silly at 90–120° the way a degree-linear rate does. It is also the term one shipped multiplayer scorer uses for exactly this reason (assettoserver Lua). The 25 km/h floor matches `GP_DRIFT_MIN_KPH`, so the score physically cannot outlive the angle lane. |
| **Ramp-in** | First second pays at reduced rate: multiplier `min(1, seconds_in_drift)`. | Kills flick-spam without a hard rule. |
| **Duration bonus** | Keeps growing past ~3 s held. | Rewards one long slide over ten tidy flicks — the genre is unanimous on this. |
| **Exit** | Rate stops at 6°, not 12°. | Schmitt-trigger hysteresis so sensor noise cannot chatter the score on and off. |

### The combo multiplier

Grows while sliding, proportional to angle and speed, capped at ×5. Decays **quadratically** while not sliding: −0.1 × t_off² per second, with a 1–2 second grace window. A brief straight between corners costs almost nothing; a genuine stop collapses it. This is the Damgam/Real Drift shape and it is the right one.

### The pot — where the tension actually comes from

The number on screen is **provisional**. It banks to the session total only on a clean exit, and is discarded below a minimum (VDrift uses 5 points, which stops sensor noise littering the log). The risk of losing a large pot is what makes the number feel live — not the arithmetic.

### What breaks it

| Break | Severity | Reason |
|---|---|---|
| No attitude source | **No score at all** | The honesty rule. Not a degraded score. |
| Rough or unanchored leg (bar ≥ 8°) | **Void the pot** | A precise-looking number built on a ±9° channel is a laundered lie. |
| Spin (angle > 100°, or > 45° at the moment speed fell through 25 km/h) | **Void** | Every system in the survey treats over-rotation as failure, not achievement. |
| Wrong direction — course-over-ground reversed against the run's mean heading | **Soft penalty**, not a cancel | Stops farming one good piece of road. The field's design lesson: soft penalties survived, hard cancels got patched out (the AC app moved from cancelling to quarter points). |
| Repeating the same trick signature | **Decaying weight** | A naive angle × speed × time integral is maximised by one repeated skidpan circle, and drivers will find that in an afternoon. |

**Not a break, deliberately:** impact detection. The node stops writing below 8 km/h, so a crash that stops the car manufactures exactly the speed-step signature a detector would look for, and a fix dropout produces the same trace. No labelled crash data exists to tune a threshold against. One false positive wiping a big pot is the most infuriating failure this product can produce. Two of three reviewers cut it outright — revisit once the accelerometer is logged.

### Defensible multipliers

Angle sweet-spot band; the ×5 combo cap; staleness decay; a doubling ladder of named milestones for discrete feedback; and — if CAN ever lands — a brake/handbrake **fractional** multiplier (×0.5 while either is applied) and a traction-control cap. That last one is the only published example in the whole survey of a score penalising **assistance** rather than only rewarding magnitude.

### Omit rather than approximate

Wall proximity, tandem proximity and clipping-point line scoring. These are world-knowledge terms this hardware cannot supply. Their absence is why the score cannot feel like Real Drift; say so in the design doc rather than faking them from a track outline.

---

## 3. Already free — computed today, could surface immediately

Everything here exists in `tauri-overlay.html` and needs wiring, not maths.

| Item | State | Work |
|---|---|---|
| Drift angle, error bar, peak/held/degree-seconds/seconds/metres/commitment | Built | Already on screen |
| Transitions with speeds either side, entry/exit/minimum speed, path-derived cornering g, longitudinal g trace | Built | Rename the cornering lane (see below) |
| Drift detection (10° in, 5° out, 0.5 s hold, 0.4 s settle, 0.5 s merge, 25 km/h floor) | Built | Print the thresholds so the driver knows what counted |
| Five-star rating, best-at-this-corner board, corner identification and lap mapping (modal reference lap, 40 m reject, half-the-laps link rule) | Built | Gate the rating on the spin flag first |
| Gyro scale and bias fit, weak flag, anchors, closure errors, rough flag | Built but not reported | Add a measurement-health panel: fitted scale, bias, sample count, weak flag, anchors per lap, worst leg |
| **Sideslip rate** | Computed at :16965, discarded at :17102 | `out.rho = rho`, plus a hard 8 km/h gate (below that the path rate is forced to zero and the rate degenerates into raw body yaw rate) |
| **Refused fraction of the session** | Not built | One pass over `d.ok` and `d.conf` |
| **Session totals and histogram** | Not built | `gpDriftStats` already takes any `{from,to}` — call it once for the whole session |
| **Held-state triple** | Not built | Three means over a window that already exists |

**Three naming fixes that cost nothing and prevent a quiet fabrication:**

1. The lateral-load fallback for transitions must **not** wear the word "transition". Sign changes of path-derived cornering load are changes of *path direction* — a gripping car through a chicane scores them. Call it "direction changes (path)", keep it out of every drift count and every score, and never let it imply the car was sideways.
2. "Lateral g" should read **"Cornering (path)"**. The number a driver expects from "lateral g" is the body accelerometer figure, which includes gravity from camber and roll and differs substantially mid-drift.
3. Two different numbers are currently both called wobble: the rolling-mean version at :17440 (correct) and the whole-segment-mean version still live at :17228 (discredited — the drift's own rise and fall dominated it, which made a barely-drifted corner score as the steadiest on the lap). Consolidate or rename.

**One correction to the sideslip-rate claim before it ships:** it is *not* full 25 Hz. The body rate is a 7-sample mean against a ±3-sample central difference, so the effective window is about 0.24 s, roughly 2 Hz. And it is not bias-free — it consumes the fitted scale and bias, so it must travel with the weak-fit flag. What it genuinely is free of is anchors and closure, which is the claim that matters.

---

## 4. Worth new maths — derivable today, not yet built

| Metric | Kept by | Note |
|---|---|---|
| Over-rotation / spin classification | 3/3 | Highest-priority correctness gap. The published second branch (45° below 10 km/h) **cannot fire as written** — the angle lane is never valid below 25 km/h. Restate it as: >100° while valid, or the last valid angle before dropping through the floor exceeded 45°. The spin flag itself needs a confidence, because >100° is exactly where anchors are furthest away. |
| Settledness (RMS sideslip rate at angle) | 3/3 | The gate "while at angle" still consumes the angle, so it is not by itself a rough-session fallback. Give it a path-geometry gate (cornering ≥ 0.3 g, speed ≥ 25 km/h) and it survives a session with no straights — which is the whole point. |
| Initiation rate, time to angle | 3/3 | Peak off **raw** gyro; time-to-angle off the angle, with the bar. |
| Transition agility | 3/3 | Quote swing time to a tenth of a second at most — the endpoints inherit the angle bar. |
| Correction count | 3/3 | Debounce ≥0.3 s and threshold well above the filter's own ringing; the smoothed rate cannot resolve corrections faster than ~2 Hz. At 25 Hz an unfiltered sign-reversal count is a noise counter. |
| Two-stage initiation | 3/3 | Record the flick `gpDriftSegments` already discards. |
| Drift-under (the slide washing wide instead of rotating) | 3/3 | Smooth curvature over ≥0.5 s before calling "radius growing" — a ±3-sample difference of course-over-ground is far too noisy to call a trend on, and the failure mode is a false deduction. |
| Speed bleed while at angle | 3/3 | Near-zero bleed at a big angle is the mark of a genuinely sustained drift. Needs a path-geometry window to survive a refused angle. |
| Steady-state residual and sustained fraction | 3/3 | **Rename it.** You are measuring that the state stopped changing, not that the car is sitting on a saddle point of a model nobody fitted. The three normalising scales determine the answer — publish and version them like the rating. Bring all three terms to the same bandwidth first (they arrive at 25 Hz, ~0.2 s and ~0.24 s respectively). |
| Session totals + histogram | 3/3 | Bin no finer than the error bar. 5° bins on a ±8° channel is false detail. Totals must visibly exclude or mark refused and rough spans. |
| Repeatability vs distance, lap-over-lap angle delta | 3/3 each | Ship together. Carry the combined bar on the delta. |
| Cross-track deviation from your own reference lap | 3/3 | The honest form of "line". Relative accuracy between two of the driver's own laps is far better than the 1–2 m absolute figure. Present as metres-against-own-reference, never as clip proximity; use a visibly larger tolerance across sessions than within one. |
| Sector decomposition with zero-on-straighten | 3/3 | The harshest rule in the survey and the most behaviour-changing: continuity becomes the practice objective instead of peak angle. Ship as a mode, not the default. Gate the zeroing on leg confidence — "we can't score this sector" and "this sector scored zero" are different statements and the driver deserves the right one. |
| Live score, staleness decay, wrong-direction guard | 3/3 each | Section 2. The wrong-direction guard is lower priority than it looks: the Drift view will not open without a start/finish line and laps, so the exploit is not reachable until a no-lap mode ships. |
| Body-frame accelerations by rotation | 3/3 | Replaces the path-derived cornering lane as the driver-facing g. Carries a lesson the product needs: lateral g in a sustained drift is *lower* than the same car's grip-limited cornering g, so angle-chasing has a measurable price. Still not what an accelerometer reads — no gravity, camber or gradient term. |
| Slip velocity; path curvature; yaw acceleration; phase portraits; g-g envelope | 2/3 each | The coaching reviewer cut all five as restatements of lanes already shown. Keep them **internal**: slip velocity as the live score's rate term, curvature as the input to drift-under, yaw acceleration and the phase planes behind a debug view. Normalise any g-g fill against the session's own observed maximum and state which envelope it was computed against. |
| Rear slip angle, in degrees | 2/3 | Only with user-entered wheelbase and weight distribution, only in degrees, never as a saturation percentage. A 10% error in the axle distance is roughly half a degree at 60 °/s and 15 m/s. Mind the sign convention — the academic beta is the opposite one from Studio's. |
| Zone fill at ~5 m tolerance; gate-windowed mean angle; D1-style speed × angle composite; off-course at 1–2 m | 2/3 each | All buildable, all with a caveat. Zone fill re-opens the courses/clips surface retired on 2026-08-10 — sequence it as its own decision, and remember the swept shape needs car length, width **and** the puck's offset (an uncorrected offset biases it by up to a metre, the same order as the whole tolerance). Off-course must publish a **compound** tolerance: GNSS error + the outline's own lateral accuracy + the car's half-width. |

---

## 5. Needs a sensor

### Needs CAN — and the sniffer has never been proven on a live bus

The v2 CAN channel path is compile-clean but has never been verified against a real car (`TRACE_V2_CAN_CHANNELS.md:3-8`). **Bench-verifying it is the highest-leverage unblocking task on this list.** Channel values are stored once per fix, so 25 Hz exactly, with twelve slots available.

| Metric | Kept by | Channel |
|---|---|---|
| Counter-steer configuration | 3/3 | Steering angle |
| Counter-steer magnitude and lock margin | 3/3 | Steering angle. Take maximum lock from the **session's own observed maximum** rather than a typed-in figure, and define the whole metric at the steering wheel — that removes the steering-ratio parameter, and with it Ackermann and variable-rack non-linearity. |
| Steering reversal rate | 3/3 | Steering angle. Catches sawing at the wheel that sits below the yaw noise floor, which the vehicle-state correction count cannot see. Threshold at the steering wheel, ~2°. (Steering entropy also survived 2/3, but the coaching reviewer's objection stands: it needs a per-driver baseline and outputs a number no driver acts on.) |
| Counter-steer timing — leading or chasing | 3/3 | Steering angle. Smooth the steering with the **same ±3 window** the sideslip rate carries; a mismatched filter puts a fixed phase error straight into the lead/chase verdict, which is the entire output. Alignment is quantised to 40 ms while the lag of interest is 100–300 ms, so report with a ±1-sample bar and refuse to call anything inside one sample. |
| Throttle / on-power fraction at angle | 3/3 | Throttle or pedal position. Name which the car actually publishes — pedal position and torque request are different quantities. The honest empty lane frame already exists at overlay:14248. |
| Brake and handbrake, as a fractional multiplier | 3/3 | Brake pressure/switch, handbrake state. Do **not** infer from longitudinal g — that conflates braking with engine braking and with the drag of the slide itself. With no channel, omit the term. Handbrake state is frequently absent on the older cars this targets; design for that as the normal case. |
| Rear wheel slip ratio | 3/3 | Four wheel speeds (six of twelve slots with yaw and steering) plus a user-entered rolling radius. A 1% radius error is a 1% floor on slip ratio — fine for drift-magnitude slip, so do not draw it below ~10%. |
| ESC yaw rate and lateral g as a cross-check | 3/3 | Chassis ESC channels. Two independent yaw measurements let the error bar be **measured** rather than argued. Watch two failure modes: production ESC yaw sensors are filtered and commonly clip around 75–100 °/s, which is inside the range a drift reaches; and ESC lateral g is body-frame with gravity in it, so it is not apples-to-apples against the path-derived lane. |
| Traction-control / drift-mode level as a rating cap | 3/3 | ESC/TC state — rarely broadcast in a generically decodable form, so treat it as a design idea first. BMW's version: TC level 10 caps at 3 stars, levels 7–4 at 4 stars, levels 3–0 unlock all 5. |
| Front slip angle, in degrees | 2/3 | Steering angle plus geometry. Ship the **angle only**; the saturation margin was rejected by all three (see below). |
| Gear and RPM as context | 2/3 | Log them; do not build a clutch-kick detector — see below. |

### Needs new hardware

| Item | Kept by | Part |
|---|---|---|
| **Accelerometer and roll/pitch in the recording** | 3/3 — **retiered to needs-node-firmware by two reviewers** | Not a new part. The LSM6DSO32X is already fitted, already read, already broadcast — `trace_log` stores gyro Z alone by explicit choice. The trace decoder reads a 14-byte fix (overlay:16286-16289), so the 12-byte figure in `DRIFT_MODE_PLAN_2026-08.md` is stale and the precedent for another record-format bump exists in-tree. This is a struct growth plus a magic bump, and it is the cheapest large win on the whole list: true body-frame g, camber and gradient correction, a defensible impact detector, air-time, and a mounting-integrity check. |
| Dual-antenna heading | 3/3 | Second GNSS antenna + moving-base receiver (ZED-F9H rover with an F9P base). Deletes the anchors, the closure, the two-pass calibration and every rough refusal at once. |
| Tandem proximity and mimic | 3/3 | A second puck plus a synchronised link. The one proximity metric that can be made honest here: two pucks at the same place and time share most of their GNSS error, so relative separation is far better than each unit's absolute 1–2 m — comfortably inside a 7.5 m threshold, where 1.5 m is not. The link is only needed for **live** use; post-session tandem analysis needs a second puck and nothing else, since both recordings carry GNSS time. Carry the rulebooks' asymmetry: the chase car's angle should be matched or bettered, never mimicked downward. |
| RTK centimetre position | 2/3 | RTK receiver + correction service + surveyed course. Unlocks the *line* half of professional judging. The coaching reviewer's objection is worth weighing: it buys **absolute** accuracy that a coaching product does not need, since comparing a driver against their own reference lap is a relative problem. Spend the hardware budget on the second antenna first. |
| Optical ground-speed reference | 2/3 | Kistler Correvit S-Motion. Not a product feature — a **one-off validation session**, and the only way the per-sample error bar becomes a measured claim rather than an argued one. It also caps any accuracy Studio can print: the reference instrument itself guarantees only ±0.2° (typical ±0.1°) at 500 Hz. |

---

## 6. Deliberately not measured

This section matters more than the shortlist. Every item here is something the data *looks* able to produce and cannot.

### Cut by the reviewers

| Item | Kept by | Why it was cut |
|---|---|---|
| **Divergence rate / "difficulty" doubling time** | **0/3 — unanimous** | It requires identifying "unforced portions of a drift", and with no steering or throttle channel there are none: the driver is on the controls throughout, so a growing angle error cannot be separated into *the car diverged* and *the driver asked for more angle*. The fit is closed-loop and already contains the corrections. Worse, the proposed use is backwards — a sloppy driver raises both the RMS rate and the fitted growth rate, so dividing one by the other flatters exactly the driver it should penalise. And fitting an exponential to a sub-second excursion of a signal smoothed to 0.24 s with a ±1–8° per-sample bar gives an uncertainty larger than the estimate. The honest difficulty summary is the held-state triple plus the observed correction burden. |
| Impact detection from a speed step | 1/3 | The node stops writing below 8 km/h, so a crash that stops the car manufactures the exact signature. No labelled crash data exists. If it is ever built, output the observation — "speed fell 22 km/h in 160 ms with a 190 °/s yaw transient" — never the label "impact". |
| Wall and barrier proximity | 1/3 | The 1.5 m threshold that gives it meaning is inside standalone GNSS error, the puck has no ranging sensor of any kind, and unlike RTK or a second antenna there is no plausible path on this product. Name the resulting gap in feel; do not leave it on a roadmap it will never leave. |
| Weight transfer, suspension state, tyre temperature | 1/3 (kept as documentation only) | `dFz = m·a_y·h/t` is a **static model**, not a channel, and it is the most plausible-looking fabrication available here because the formula is familiar and every term looks obtainable. The physics belongs in the doc. It must never become a UI number. |
| Front-tyre **saturation margin** (as distinct from the angle) | 0/3 | "The reserve before the front saturates" needs a peak-slip figure from a tyre curve that moves with load, temperature, pressure and wear, and that no user can supply meaningfully. Steering lock margin is the measurable, instantly legible stand-in for the same "ran out of authority" story. |
| Clutch-kick **detection** | 2/3 for the raw channels, 0/3 for the label | RPM and gear are measured; "clutch kick" is an inference — the same discontinuity comes from wheelspin, a downshift or a missed shift. Report "RPM rose 1,800 in 120 ms with no gear change" and let the driver name the technique. This is the honesty rule applied to a **categorical label** rather than a number, which is a case worth writing into the rule explicitly. |

### The named anti-goals

| Item | Why never |
|---|---|
| **Drift angle from GPS position alone** | The line. Course-over-ground contains no information about where the car is pointing — that is the physical premise of the whole feature. A car circling at 40° of slip lays down the identical GPS trace as one gripping the same arc; no filter recovers what was never observed. Two commercial vendors independently refuse it, and Formula DRIFT bolted an attitude-measuring unit to the roof **despite already having centimetre position**. |
| Style, flow, degree of difficulty as a judged score | Every system in the survey — including the newest fully automated one — declines to machine-score aesthetics. Ship the measurement, never the judgement: "angle steadiness, 2.3 °/s RMS", and let the driver interpret it. Note that parts of UDSM's own out-of-scope list (angle rate, bobbles) **are** measurable here — those cross back over as measurements and are kept above. |
| Understeer gradient during a drift | Defined only where tyre cornering stiffness is defined, and a drift is by construction outside that range — the rear is saturated, so the rear stiffness term is meaningless exactly where the number would be printed. The sub-limit warm-up version is legitimate but it is a **setup** number, needs steering angle, and must never be plotted on a drift run. |
| Friction coefficient, tyre saturation percentage, friction-circle utilisation | Every form needs a tyre curve or a surface-friction estimate nothing on the car measured. "Percentage of grip used" is the most seductive fabricated number in motorsport software because it looks like a measurement. The honest substitutes are already kept: slip angles in degrees, and envelopes normalised against the session's own observed maximum. |
| Model-derived saddle location and unstable eigenvalue | Needs mass, inertia, wheelbase, CG position, tyre curves and surface friction — and unlike the geometry-only cases, these are not credibly user-suppliable with stateable error. Draw the measured trajectory in the phase plane; **overlay no computed equilibria**. Put that in the code comment, not just the doc — the temptation to overlay a model saddle is the whole risk. |
| Field-relative score normalisation | A single car cannot produce a field maximum, so FD's denominator is unavailable by construction. Studio already picks its own absolute standard — 40° held for full marks — and printing that standard on screen is the honest answer. Record the rejection rather than omitting it quietly. |
| Zone fill at 200 mm; per-wheel tyre-off at one inch | A 25.4 mm threshold is well inside standalone GNSS noise. Studio can honestly do the **angle** half of UDSM today and cannot do the **line** half. Say so rather than approximating it. |

### Two claims in the survey that needed correcting

- The sideslip rate is often described as "exact at full 25 Hz". It is neither: ~0.24 s effective window (~2 Hz), and it carries the fitted scale and bias. It **is** free of anchors and closure, which is the property that matters — so it is honest where the angle is *rough*, but there is no rate at all where the angle is *refused*, and the copy must not promise otherwise.
- Settledness, speed bleed and the UDSM-style windowed mean are each described as surviving a refused angle. All three gate on the angle. Give them path-geometry gates or state plainly which of the two problems they actually rescue.

---

## 7. Build these three, in this order

**1. Expose the sideslip rate.** `out.rho = rho` plus an 8 km/h hard gate — one line and a guard, and it unlocks settledness, initiation rate, transition agility, bobbles, two-stage initiation and the live score, none of which need anchors or closure.

**2. Ship the over-rotation and spin flag, and gate the rating on it.** This is the only live correctness bug: today a half-spin is the session's biggest peak angle and scores full marks on the rating's 45%-weighted angle term — the worst possible failure for a number that headlines the product.

**3. Replace the wobble term with settledness (RMS sideslip rate at angle), with a path-geometry fallback gate.** It is the most skill-diagnostic scalar this sensor set can produce, it needs no closure, and it retires the two different numbers currently both called "wobble".

Then, in the same breath: a measurement-health panel (fitted gyro scale, bias, sample count, weak flag, anchors per lap, worst leg, and **what fraction of the session was refused and why**) — a trivial pass over data already computed, and the thing no competitor can print. And bench-verify the CAN sniffer against a live bus, because a single steering channel unlocks nine metrics and turns "the car was sideways" into "the driver was drifting".
