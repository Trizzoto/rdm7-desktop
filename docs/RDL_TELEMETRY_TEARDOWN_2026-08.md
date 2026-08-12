# What Race Data Labs actually records — a teardown

**Source:** the public RDL dashboard, Royal Drift Series Rd2 Tianjin (event 96),
read 12 August 2026 via `data.racedatalabs.com/api/v1/…`. The API needs no auth.
Everything below is measured off their own payloads, not off their marketing.

This is the company behind **Wally**, the roof-mounted judge Formula DRIFT
adopted for 2026 — the precedent `DRIFT_MODE_PLAN_2026-08.md` §1 names but had
only published descriptions of. Now there is data.

---

## 1. The record

One run = 5 Hz samples, flat 200 ms, no gaps. A 19.4 s qualifying run is 98
samples. Nine fields:

| Field | Meaning | Notes |
|---|---|---|
| `t` | timestamp | ISO, ms resolution |
| `s` | ground speed, kph | integer — 1 kph quantised |
| `h` | **true body heading**, deg | string, 0.1° |
| `gh` | **course over ground**, deg | string, 0.1° |
| `a` | drift angle, deg | signed; exactly `gh − h`, verified sample by sample |
| `ar` | angle rate, deg/s | **unsigned** magnitude, smoothed |
| `ac` | longitudinal acceleration, m/s² | tracks d(speed)/dt on the same grid |
| `hea` | heading accuracy | inferred 0.1° — median 2.0°, min 0.4°, max 18.1° |
| `hoa` | horizontal accuracy | inferred 0.1 m — median 0.1 m, p90 0.4 m, max 2.5 m |

**There is no lat/lon in the telemetry.** Position ships separately as
`car_body_multipolygon`: 98 polygons for 98 samples — the car's footprint
rectangle, rotated to `h`, one per sample. They publish the derived footprint
and keep the raw track.

`hea`/`hoa` are present on 80 of 98 samples; both go null together, including at
the peak-angle sample. The scaling is inferred, but a system that scores zone
fill to 0.1% cannot be running 25 m of horizontal error, so 0.1 m is the only
reading that hangs together. A 2.0° median heading accuracy is F9R-class
IMU-fused, not dual-antenna (which would be nearer 0.3°).

### The car is a first-class record

```
length 4515   width 1810   wheelbase 2550   wheelbase_front_offset 928
front_track 1870   rear_track 1870   front_tyre 265   rear_tyre 265
device_front_offset 2508   device_centre_offset 0
```

That last pair is the GPS antenna's position on the car. It is what lets them
turn one antenna fix plus `h` into the footprint of the whole car — and the
dashboard exposes **Car body / Body drift / Wheelbase drift** as three ways of
projecting it.

### Scoring

Event-level weights, served with every run: **line 50, angle 20, speed 10,
style 20.** Style is the 20 that stays with human judges.

Line is scored as *percentage of each zone's area swept by the car body* — not
hit/miss. Fifteen zones at Tianjin (`1-1`…`3-3` plus `TG1`…`TG4`), each 0–100%,
averaged to one outer-zone score.

Tandem adds two chase-only numbers and one shared channel:

| Number | Example |
|---|---|
| `p` — car-to-car proximity, m, per sample on a common clock | avg 4.7 m |
| Proximity score | 21/100 |
| Line/angle mimic score | 72/100 |

Proximity scoring is harsh: 4.7 m average earns 21/100. Chase scores across the
Top 4 ran 4, 21 and 30 out of 100 — so the scale is steep and most of it lives
inside a few metres.

---

## 2. How ours compares

| | RDL / Wally | RDM Studio |
|---|---|---|
| Sample rate | 5 Hz published | **25 Hz** |
| Body heading | **measured** (fused, ~2°) | derived from puck gyro Z, tier 2 |
| Angle rate | unsigned, smoothed | **signed** (`rho`), raw available |
| Per-sample accuracy | **recorded** (`hea`/`hoa`) | not recorded at all |
| Angle confidence | none published | **per-sample error bar** from leg closure |
| Car body | full geometry + antenna offset | antenna point only |
| Line scoring | zone area % swept | retired 2026-08-10 |
| Unit of judgement | the run | **the corner on a lap** |
| Proximity / mimic | shipped | named, not built |
| Refusal when unmeasurable | not published | shipped, with the reason named |

### Where we are genuinely ahead

**Rate.** 25 Hz against 5 Hz is not a vanity number here. A hard flick is
0.3–0.5 s; at 5 Hz that is two or three samples, which is why their `ar` is
smoothed and capped-looking. Transition agility (#11) and initiation rate (#12)
in the research brief are *not computable* on their published record. On ours
they are.

**Signed angle rate.** Theirs is a magnitude. Sign reversals are what make
correction-count / bobbles (#13) possible, and that metric is free for us.

**The error bar.** They publish receiver accuracy; nobody publishes a
confidence on the *drift angle*. We do. They largely don't need one — see below
— but for anyone without their hardware it is the differentiator the research
brief already identified.

**The practice framing.** Their whole model is event-shaped: runs, zones,
judges, brackets. There is no lap, no corner identity, no "was turn three
better that time". That is the question our redesign is built around and theirs
cannot answer.

### The architectural point worth sitting with

Our anchors, legs, closure error, gyro-scale fitting and rough-leg refusal —
all of `gpDriftAngle`'s complexity — exist **only because we do not measure body
heading.** RDL spent hardware to delete that entire problem class. Their `hea`
is a receiver output; our error bar is a reconstruction.

That is not an argument against what we built. It is the argument for tier 3
(dual antenna) in the sensor ladder, and it prices it: what a second antenna
buys is not "better angle", it is the deletion of every rough leg, every
no-anchor refusal, and every no-straights-on-this-track limitation at once.

---

## 3. What is worth taking

Ranked by value per unit of work.

### 1. Record GNSS accuracy per fix — cheapest real win

We record no accuracy at all. `trace_sample_t` is 14 bytes: lat, lon, speed,
heading, gyro Z. Adding `u16 h_acc` (cm) and `u16 head_acc` (0.01°) makes it 18
and gives every sample a *measured* quality stamp instead of an inferred one.

Why it matters beyond honesty: it lets the angle engine **weight** samples
rather than treat every fix as equal, and it lets a refusal say "your accuracy
degraded here" instead of "the leg would not close". Their median 0.1 m is also
the first hard number for what good looks like on this kind of course.

Node change, not Studio (`rdm-gps-node`), magic bump RDMW → RDMX. Storage: 14 →
18 bytes is about −22% ring minutes at 25 Hz with no channels; worth re-running
ADR-0012's arithmetic before committing to both fields — `h_acc` alone may be
the better trade.

### 2. Car geometry + antenna offset

Their parameter set is the one to copy verbatim: length, width, wheelbase,
front offset, both track widths, both tyre widths, and the device's offset from
the front and from the centreline. Studio-side config, no firmware change.

We already have what makes it honest — tier 2 gives us body heading, and
without it the rotated rectangle would be a fabrication. It turns "distance
travelled sideways" into the car's swept area rather than the antenna's path,
and it is the prerequisite for ever saying "the back of the car" the way judges
do. `DRIFT_MODE_PLAN` §4 Cut 3 anticipated exactly this; RDL confirm the
parameter list.

### 3. Mimic is our #20 wearing a different hat

Their chase "line/angle mimic score" is resample-onto-common-course-distance
then RMS-difference — the same machinery as run-to-run repeatability (#20) in
the research brief. Build #20 for the single-car practice case and mimic falls
out of it if a second car ever arrives. Worth knowing before #20 is designed, so
the alignment code is written to take two traces rather than two laps.

### 4. Proximity may be cheaper than we assumed

`DRIFT_MODE_PLAN` §4 says tandem proximity "needs two cars on RTK-class
hardware". Their data suggests that is too pessimistic. Proximity is a
*relative* measurement over a very short baseline — two cars metres apart share
almost all of their ionospheric and ephemeris error, so common-mode cancellation
makes car-to-car distance far better than either car's absolute accuracy. GPS
time-of-week already gives us the shared clock.

This does not make it free, and it should be tested before it is promised. But
"needs RTK" is probably the wrong reason to have it parked.

### 5. Two cautions, not features

**Their speed score saturates.** Both Top-4 drivers scored 100/100 on speed
with maxima of 130 and 126 kph. A term that gives everyone full marks is not
discriminating anything. Our 10% weight on entry speed against your own best is
the better construction — this is evidence for it, not against.

**Their angle scale is compressed.** 34.7° average → 58/100; 37.5° → 62/100.
That implies roughly linear to ~60° average, which is a much higher bar than our
40°-held-for-full-marks. Open question 5 in `DRIFT_MODE_PLAN` asks whether 40°
is right; this is a real external data point, though for *event* angle averaged
over a whole run rather than held angle in a corner — the two are not the same
number and should not be swapped without care.

---

## 4. What they do that we should not copy

**Publishing at 5 Hz.** Whatever they compute on, the record a customer can see
is 5 Hz and unsigned. Our whole honesty position is that the user sees what the
instrument saw.

**Machine-scoring line without publishing the method.** The community fight over
Wally is in `DRIFT_MODE_PLAN` §3 already. Their zone percentages are precise to
0.1% with no stated tolerance, on a system whose own heading accuracy hits 18°
at its worst. Precision that outruns accuracy is the thing our error bar exists
to prevent.

**Scoring style at all.** They don't — style is the 20 points left to humans.
That is the one judgement call they got right and it matches ours.
