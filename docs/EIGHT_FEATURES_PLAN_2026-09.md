# The eight features — the plan

2026-09-01. `STUDIO_IDEAS_2026-08.md` listed eight things worth building next, ranked,
with the argument for each. All eight were greenlit. This file is the plan across them:
what order, what depends on what, which ADR numbers are claimed, and the rules that
apply to every one of them. The per-feature implementation briefs are in `briefs/`, one
file each, and each is written to be handed over on its own.

Research behind the briefs is in `research/` — six code surveys, `file:line` anchored.

## What changed from the ranking

**Item 1 (a calibration run, per car) is folded into item 2 (the trust panel).** His own
question on item 1 was *"is this necessary, can we just get it from normal driving?"* and
the code already answers it: `gpDriftAngle()` (`src/tauri-overlay.html:22219-22629`)
fits gyro scale and bias from ordinary grip driving on **every** session, by inverse
regression, refusing samples where the car is holding an angle, and refusing outright a
fitted scale outside 0.8–1.25. It computes `scale`, `bias`, `fitN`, `weak`, `anchors`,
`worst` and `sigma` (`22623-22626`) and then shows almost none of it.

So the gap is not that the number isn't measured. The gap is that when the number is
bad, nothing says so. The Mallala failure that motivated item 1 — **+54° then −48°
inside one corner, wearing ±2.1°** — was not a scale error; the leg closed perfectly at
both anchors and was wrong in the middle, which no calibration wizard would have caught
either. Confirmed with him 2026-09-01: surface the fit, don't add a wizard.

What a wizard *would* still buy is **mounting-axis sanity** — is Z really vertical, is
the sign right, is the puck bolted in rotated — because the 0.8–1.25 refusal band papers
that over by falling back to `scale = 1` rather than diagnosing it. The firmware already
has the concept (`imu_cal_t.dir[3]`, `imu_cal_valid`'s handedness check, and a written
stationary-bias estimator `imu_cal_acc_finish` in `../rdm-gps-node/main/imu/`). That is
**item 1b**, deferred: smaller, later, and a firmware change rather than a desktop one.
`briefs/01-trust-panel.md` says exactly what it would take when it comes up.

**Item 3's pinned recordings get committed to the repo.** Confirmed 2026-09-01. See
`briefs/02-golden-recordings.md` for why that beats the repo's usual
regenerate-don't-commit rule in this one case.

## Where it got to (2026-09-01)

All eight built. Every one of them turned out to be smaller than the brief
expected, because the thing was already there and not being said.

| Feature | State | The commit |
|---|---|---|
| 2 · Trust panel (+ item 1) | **built** | `8549dce` |
| 3 · Golden recordings | **built** | `0ff76ff` |
| 8 · Session history | **built** | `c036b18` |
| 4 · One layout format | **built** | `e8f9dad` + `RDM-7_Dash c27c3b0` |
| 7 · Background exports | **built** | `e39dba9` |
| 5 · Auto-highlights | **built** | `26535a5` |
| 6 · Two-lap comparison | **built** | `da9f6af` + `c499dfd` |

**All eight are built.** Item 6 landed last, and its merge — the reference
decoder pulled along by the analysed one — is where the interesting bug was: if
the next reference frame is already past the target, the held one is final, and
waiting for a better one stalls both pumps. Measured against two real decoders
in the browser, the version that waited composed ONE frame of forty. That is
the one class of thing the harnesses cannot reach — node has no WebCodecs — so
the concurrency and the merge were proved in Chromium instead.

Still unproven, and only provable with a camera: the full comparison pipeline
against two real files with rotation and HEVC.

**The 23 Aug Mallala session is now a fixture** (`3fea0aa`) — exported out of
IndexedDB through the app's own writer, 25,720 samples, 353 KB gzipped, carrying
the track it was timed against so its lap is reproducible from the file alone.
It pins the failure in five numbers: peak 54.3°, the fit NOT refused (152
anchors, scale 0.974), typical ±1.21° against worst ±10.24°, and the 136.091 s
lap. Confident nearly everywhere and far less certain somewhere is exactly what
the trust panel's angle row watches for, and now a real recording holds it still.

**The Donington VBO is in too** (`eb0e4be`), on his instruction — the licence
question was his to answer and he answered it. It goes in byte for byte, only
gzipped, `(c) Racelogic` notice and all, with the attribution recorded beside it
in `fixtures.json`. It earns its place twice over: its lap times are checkable
against **Circuit Tools 3** — a different program, written by different people,
from the same raw file, agreeing to within 3 ms on all six flying laps — which
is the only thing here that can catch us being consistently and confidently
wrong. And at 10 Hz it is the only committed recording that is not 25 Hz, so it
catches anything reading a cadence off a constant rather than off the data.

**Nothing is outstanding.** All three wanted recordings are committed: 4.7 MB of
immutable fixture against a repo whose history is already 207 MB of one HTML
file's revisions.

## Order, and why

Nothing here is blocked on anything else, so the order is about de-risking and about
proving the handoff pattern before betting the hard items on it.

| # | Brief | Why here |
|---|---|---|
| 1 | `02-golden-recordings.md` | **Go first.** Self-contained, no UI, and it is the safety net every later item leans on — items 4, 5, 6 and 7 all change code that `check_all.js` already covers. Also the cheapest way to find out whether "research → Opus builds" works, because a harness is either green or it isn't. |
| 2 | `01-trust-panel.md` | Foundational and self-contained: one new panel type, one new verdict function, numbers that all already exist. Answers the question that cost a day of bisection. |
| 3 | `07-session-history.md` | Low risk, high "worth opening between track days" value, and the smallest of the eight — most of it is already written and unreachable. |
| 4 | `03-one-layout-format.md` | Foundational for the Marketplace story and the only item that touches the firmware repo. Start it before the video items so its ADR is settled while they are being built. |
| 5 | `06-background-exports.md` | Architecturally the riskiest, and items 5 and 6 both want it. Scope and land it before they pile more onto the export path. |
| 6 | `04-auto-highlights.md` | Assembly of parts that exist. Wants the background exporter (a reel is several exports) but degrades to foreground cleanly. |
| 7 | `05-two-lap-comparison.md` | Last, because it is the only one that puts a second decoder on the export path and it wants both the queue (item 7) and the segment plumbing (item 5). |

Item 1b (mounting-axis routine) sits after all of these, or never.

## ADRs — written 2026-09-01

All five are in `../RDM-7_Dash/docs/adr/` and indexed in that directory's `README.md`.
0049–0052 were written as **Proposed** and their code has since landed; 0053 was
written after the fact, as **Accepted**. Read the ADR before changing the area it
covers — the brief was the plan, the ADR is the reasoning that outlives it.

| ADR | Brief | The assertion it makes |
|---|---|---|
| [0049](../../RDM-7_Dash/docs/adr/0049-a-recording-says-how-much-to-trust-it.md) | `01-trust-panel.md` | A recording says how much to trust it |
| [0050](../../RDM-7_Dash/docs/adr/0050-a-real-drive-cannot-be-generated.md) | `02-golden-recordings.md` | A real drive is the only fixture a synthetic one cannot replace |
| [0051](../../RDM-7_Dash/docs/adr/0051-one-layout-file-drawn-two-ways.md) | `03-one-layout-format.md` | One layout file, drawn two ways |
| [0052](../../RDM-7_Dash/docs/adr/0052-an-export-is-a-snapshot-not-a-worker.md) | `06-background-exports.md` | An export is a snapshot, not a worker |
| [0053](../../RDM-7_Dash/docs/adr/0053-a-circuit-can-be-built-from-the-drive-that-proves-it.md) | — written after the fact | A circuit can be built from the drive that proves it |

The next free number is **0054** (0029 was skipped and stays skipped). Numbers get
claimed by code comments before the file exists, so re-grep both repos before taking one:

```bash
grep -rn "ADR-00" docs src/tauri-overlay.html ../RDM-7_Dash/docs ../RDM-7_Dash/main
```

Items 5, 6 and 8 get no ADR. They are assembly and completion of decisions already on
record (ADR-0025/0026 for the Analyse mosaic, and the HUD/export invariants in
`VIDEO_HUD_EXPORT_2026-08.md`), and nothing in them is the kind of choice future-me
would come back and question.

Format is `# ADR NNNN — short imperative title`, then Status, Context, `## The problem
we were solving`, `## Options considered`, `## Decision`, `## Consequences` (Good/Bad/
Neutral), `## References`. Titles are assertions, not topic labels. Read 0044–0048 for
tone before writing: dense, reasoned, present tense, one decision per file.

## Rules that apply to all eight

These are the ones that have already cost time in this repo. They are repeated in each
brief where they bite, but they hold everywhere.

**Never edit `src/dist/` or `src/firmware-base.html`.** The frontend is built (ADR-0007):
`firmware-base.html` + `tauri-overlay.html` → `dist/index.html` via
`python tools/merge_overlay.py`. Desktop-only work goes in `tauri-overlay.html`
(the GPS workspace is one giant IIFE inside the `suite-home-keypad` block). Editor
features shared with the device go in `../RDM-7_Dash/main/web/index.html` and come back
through `tools/sync_firmware.py`. A failed merge means an anchor stopped matching — that
is the drift detector working; re-anchor the block, don't work around it.

**A new static file must be added to `ASSETS` in `tools/merge_overlay.py:44`.** There is
no bundler. `dist/` is populated by an explicit list (`transport.js`, `rdm_logo_data.js`,
`favicon.ico`, `dash_default_layout.jpg`, `rdm_logo.png`) plus `ASSET_DIRS`
(`build`, `leaflet`, `fonts`). A file not on one of those lists does not exist at runtime.

**CSS stays scoped to `#gpWorkspace`** and uses the `--gpb-*` tokens (ADR-0014/0024).

**Write JS with Edit/Write, never a heredoc.** Heredocs eat backslashes and have shipped
broken JS from this repo twice. `node tools/check_syntax.js` is the net — it parses both
`src/tauri-overlay.html` and the built `dist/index.html`, which is the only check that
catches a broken string literal *between* two functions.

**The harnesses lift functions by exact indentation.** `grabFrom()` matches
`^        function NAME\s*\(` or `^        window.NAME = function` — eight spaces, part
of the contract. Renaming or re-indenting a function breaks its harness silently, which
is what `check_all.js` prints as **DEAD** rather than FAIL.

**Verify with `python tools/merge_overlay.py && node tools/check_all.js`.** 34 harnesses,
~23 s, all green today. A red or DEAD row is the deliverable being wrong.

**Sample rate is data-carried.** Use `gpHz` / `gpSecs` / `gpStep` (`24264-24271`,
`24089-24093`), never `× 0.04`. A 10 Hz VBO and a 25 Hz puck ring both load.

**Stop at `gp.ghostFence`.** Any reader that spans the whole trace and doesn't will read
another day's appended samples.

**Lap numbers come from `gpCleanRuns()`** (`21625-21627`), not from `gp.traceLaps`
directly, or the untrustworthy-board problem the run flags fixed comes straight back.

**`window.confirm` is broken under Tauri** (always-truthy promise). Use `gpConfirm`
(`8824-8846`).

**Never put `Vec<u8>` on a Tauri command,** in either direction. Serde-JSON turns a
128 MB read into ~380 MB of text and 49.6 s of frozen UI. Use `tauri::ipc::Response`
out and `tauri::ipc::Request` with an `InvokeBody::Raw` body in (commit `5dfa9ac`,
`src-tauri/src/lib.rs:170-239`).

**`gpHudRender` is not to be forked.** The video tile, the overlay designer and the
export all call the one function, and `tools/check_hud.js` pins pixel-identity at two
sizes. A feature that needs different output feeds it a different sample index or
different data — it does not get its own copy.
