# Brief 2 — golden-recording regression tests

Covers `STUDIO_IDEAS_2026-08.md` item **3**. Owns **ADR-0050**.
Research: `../research/harness-tests.md`.

## What we are building

Two or three **real** recordings, committed to the repo, each with a hand-checked answer
sheet naming its lap times, best lap, corner counts and angle summary. A new
`tools/check_golden.js` runs them through the app's own chain on every
`node tools/check_all.js` and fails loudly when any of those numbers move.

Then CI actually runs the harnesses, which today it does not.

## Why this shape

His argument, verbatim: *"Every harness here is synthetic, and synthetic data is exactly
where the drift engine looks perfect… This is the test that would have caught the slip
angle before he did."*

That is precisely right and the code proves it. `tools/check_mallala.js` is 679 lines and
**entirely synthetic** — its fixture comes from `tools/make_drift_fixture.js` and every
expectation comes from the `.truth.json` written at generation time. It asserts the
engine recovers a *planted* 1.008 scale and 0.42 °/s bias, which it does, beautifully.
The 23 Aug Mallala session then produced +54° then −48° inside one corner. A generator
cannot plant the fault it doesn't know about.

**The idea half-exists already, badly.** Two harnesses do pin real data, and they
disagree about what to do when it's missing:

- `tools/check_laptime.js` reads a real Donington VBO from
  `C:/Users/ruuva/Downloads/rdm-test/` and `process.exit(2)` if it's absent — which
  `check_all.js` reports as a failure on every other machine.
- `tools/check_breaks.js` reads the real 22 Aug ring from `Documents/RDM sessions/` and
  **silently skips** with a console note if it's absent — so it passes while testing
  nothing.

Neither file is in the repo. So the two best tests in the suite either die or quietly
don't run everywhere except this one PC, and CI runs neither.

**Committing the data is the only option where the test actually runs.** Confirmed with
him 2026-09-01. The repo's `.gitignore` comment says regenerate-don't-commit, and that
rule is right for `make_fixture.js` output — but **a real drive is not regenerable**, and
that is the distinction to lean on. The cost is small in context: `.git` is already
101 MB, dominated by re-committing a 2.2–2.6 MB `tauri-overlay.html` across 197
revisions (207 MB of blob history from that one file). A few immutable megabytes that
are written once and never touched again are cheap by comparison — and unlike the HTML,
they never produce a second revision.

## What already exists

- **`tools/check_all.js`** (66 lines) — zero config, `readdirSync` filtered to
  `^check_.*\.js$`, each spawned as its own node process. The last output line must match
  `failed|FAILED`; anything else with a non-zero exit is printed **DEAD** with its first
  error line. That mechanism exists because `check_autotrack` was dead for two commits
  after an app-side rename. 34 harnesses, ~23 s, all green today on node v22.14.0.
- **The headless recipe** — `tools/check_mallala.js:76-121` is the working one: `grab()`
  functions out of the source overlay by exact 8-space indent, `new Function(...ARGN,
  code)` with `gp = {}`, a `window` stub whose `localStorage` returns null,
  `gpActiveTrack: () => fakeTrack`, and — the critical detail — **re-encoding parsed
  float channel values back to u16 through the fitted `chanDefs` scale/offset exactly as
  saving does** (`:101-112`), because a loaded session carries u16 and every reader
  decodes with those defs. Skip that and the harness tests a code path that never runs.
- **Loaders for every format we'd commit**: `gpVboParse(text, fileName)` (`10808`) for a
  VBO, `gpSessionFileParse(text)` (`10511`) → `gpRowsUnpack` for a `.rdmsession`.
  `tools/check_ac_session.js` already does the `.rdmsession` route end to end.
- **The chain to run**: `gpRowsUnpack` → `gpComputeG` → `gpSplitLaps`/`gpSplitRows` →
  `gpSpanSecs` over `gpCleanRuns()` → `gpFindCorners` → `gpDriftSource` →
  `gpDriftAngle` → `gpDriftCorners` → `gpDriftBoard` → `gpDriftBest`.
  Full ordering in `../research/harness-tests.md` §5.
- **`zlib` is built into node** and `check_breaks.js:23-25` already gunzips a `.gz`
  fixture. No dependency needed, and none is available — there is no `package.json`.

## The recordings

Commit to a new **`tools/fixtures/`**, gzipped, each beside a `.expected.json`.

| Fixture | Source | Size | What it pins that nothing else does |
|---|---|---|---|
| `mallala-2026-08-23.rdmsession.gz` | Studio IndexedDB — export via `gpSessionExportFile(id)` (`11140-11149`) | 25,720 samples; ~250–400 KB gz | **The slip-angle failure.** This is the session item 3 exists for. Its angle summary is the number that must never silently move again. |
| `mallala-ring-2026-08-22.jsonl.gz` | `Documents/RDM sessions/` — commit as-is | 4.36 MB | 168,105 samples, **exactly 6 breaks at pinned indices** (the lost fix at 84,115), answers established by hand in `IN_THE_CAR_2026-08-22.md:311-330`. Real GNSS dropouts, which no generator makes convincingly. |
| `donington-driver1.vbo.gz` | RaceRender demo dataset | 619 KB raw → **165 KB gz** | **Third-party timing truth.** Lap times checkable against Circuit Tools 3's own answers — the only fixture where the expected numbers do not come from us. |

Commit each in the form its existing harness already reads, gzipped. Converting the ring
to `.rdmsession` risks moving the sample count that `check_breaks` pins exactly, for no
benefit.

**Flag before committing Donington:** the file's own `[comments]` block carries
`(c) Racelogic`. It is a publicly distributed sample dataset, but that is a licence
question, not a technical one — put it to him before it goes in. If the answer is no,
keep Donington on the external path with a proper skip-with-note (never `exit(2)`), and
commit only his own two recordings. The feature still works; it just loses the
independent check.

## File-level plan

### 1. `tools/fixtures/` + the answer sheets

`<name>.expected.json`, one per recording:

```json
{
  "recording": "mallala-2026-08-23",
  "blessedOn": "2026-09-…", "blessedBy": "…",
  "samples": 25720, "hz": 25,
  "laps": { "by": "gate", "count": 8,
            "timesS": [ … ], "bestS": …, "bestLap": … },
  "corners": { "perLap": [ … ], "onBestLap": … },
  "angle": { "src": "…", "weak": false, "scale": …, "bias": …, "fitN": …,
             "anchors": …, "typicalDeg": …, "worstDeg": …, "peakDeg": … },
  "breaks": { "count": …, "atIndices": [ … ] }
}
```

### 2. `tools/make_expected.js`

Runs the chain and **prints** an answer sheet; `--bless <name>` writes it. Never runs
automatically. An answer sheet that regenerates itself on demand tests nothing — the
value is entirely in a human having looked at these numbers once and said yes.

`--bless` on an existing sheet must print a field-by-field diff first and refuse a
silent overwrite. Re-blessing is a normal event (an intended engine improvement moves
these numbers), and it should read like a decision in the commit log.

### 3. `tools/check_golden.js`

Model C, one sandbox per fixture, using the `check_mallala.js:76-121` recipe. Tolerances,
tightest first — the whole point is that it fails loudly:

| Field | Tolerance |
|---|---|
| Sample count, lap count, `lapsBy`, break count and indices, corner counts | **exact** |
| Lap times | ±1 ms (they are interpolated crossings, `gpSpanSecs` `21301-21305` — deterministic but float) |
| `scale`, `bias`, `fitN`, `anchors`, `weak` | exact on `weak`; ±0.001 on the fitted floats |
| Angle peak / typical ± / worst ± | ±0.5° |
| Donington vs Circuit Tools 3 | ±30 ms on the 6 flying laps — the tolerance `check_laptime.js:172-197` already uses and justifies |

Print every field's actual-vs-expected on failure, not just a count. A golden test whose
failure message is `3 failed` costs more than it saves.

### 4. Retire the external paths

- `check_laptime.js:23-24, 70-74` — read the committed fixture; drop `exit(2)`. Keep the
  `DONINGTON_VBO` env override for working against a different file.
- `check_breaks.js:23-25, 313-315` — read the committed fixture; the skip branch becomes
  unreachable and goes.

### 5. CI runs the harnesses

`.github/workflows/frontend-merge-check.yml` currently runs `merge_overlay.py` and then
an **inline node one-liner** that re-implements `check_syntax.js`'s job per `<script>`
block (`:40-55`). Replace that duplication with the real thing:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: '22' }
- run: python tools/merge_overlay.py
- run: node tools/check_all.js
```

Pin node 22 — the harnesses are developed on v22.14.0 and the runner's default drifts.
This step is the reason committing the data pays for itself; without it the fixtures are
just files.

## Traps

- **The u16 re-encode is not optional.** `check_mallala.js:101-112`. A harness that feeds
  parsed floats straight in tests a path the app never takes.
- **`gpMarkBreaks` self-reverts above 2%** of steps (`GP_BREAK_MAX_FRAC`, `24179-24186`).
  If a golden fixture ever trips that, "0 breaks" means "test not applicable" — assert on
  the hit count, not on the absence of marks.
- **`check_all.js` reads only the last line.** A golden harness must end with
  `N passed, M failed` and exit non-zero, or a real failure prints as DEAD and reads like
  tooling noise.
- **Harnesses lift by exact 8-space indent.** Renaming or re-indenting any function in
  the chain breaks this silently.
- **Fixtures are immutable.** Never regenerate one to make a test pass. If a recording
  needs replacing, that is a new file with a new name and a new answer sheet.
- **`src/dist/` is gitignored** — `tools/fixtures/` must not live under it. That is where
  `make_fixture.js` writes today (hard-coded absolute path, `make_fixture.js:206`), and
  it is the wrong precedent to follow here.

## ADR-0050 — *A real drive is the only fixture a synthetic one cannot replace*

Worth an ADR because it is a deliberate exception to a rule written down in this repo's
own `.gitignore`, and because the reason is not obvious a year later. Record: that
`check_mallala.js` recovers a planted 1.008 scale perfectly while the 23 Aug Mallala
session produced +54°/−48° inside one corner; that a generator cannot plant the fault it
does not know about; that the repo's history is already 207 MB of one HTML file's
revisions, so immutable write-once fixtures are cheap; and that the answer sheets are
blessed by hand, never regenerated, because a self-regenerating expectation is not a test.
