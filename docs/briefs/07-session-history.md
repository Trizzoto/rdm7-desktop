# Brief 7 — session history that fills in

Covers `STUDIO_IDEAS_2026-08.md` item **8**. No ADR.
Research: `../research/session-quality.md`, `../research/harness-tests.md`.

## What we are building

*"Am I quicker here than I was in March?"* — answered, for a library that has been
accumulating sessions the trend cannot see.

## The finding that reframes this

**The feature is written. It is starving, not missing.**

`gpHistoryFor(trackId)` (`tauri-overlay.html:11516-11521`), `gpHistSpark`
(`11549-11567`), `gpCornerTrend` (`11527-11539`) and `gpHistoryHtml` (`11569-…`) all
exist and are good: an SVG sparkline of best lap per session oldest-to-newest with this
one marked, personal best and which day it was set, this session's gap to it, and a
consistency figure — this session's lap spread against the median spread of every other
session at the track — then per-corner deltas against **the previous visit** rather than
the PB day, because *"since last time"* is the question and a PB can be years stale. It
has a panel (`GP_PTYPES` `14211`) and a renderer (`gpPanelHistoryHtml` `16072`).

It shows nothing because `gpHistoryFor` filters on
`s.trackId === trackId && bestLapS !== null`, and **most saved sessions carry
`trackId: null`.**

Why they do:

- `gpSessionMeta` (`11430-11508`) assigns `trackId` **once, at save time**, from
  `gpActiveTrack()` — whatever happened to be selected in the library — and only if
  `gpNearTrack(rows, trk)` passes, which requires the car to have come within **300 m**
  of that track's timing line (`gpNearTrack` `11418-11427`). That guard is right and was
  hard-won: a 48.7 km road drive round the hills was filed as *"Mount Barker Raceway —
  21 Aug 2026"* having never come within 1,369 m of the line, and the History trend
  counted it as a day at Mount Barker.
- So every session saved before its track was added to the library, every `.rdmsession`
  imported from another PC, and every sim stint from `ac_record.py` carries `trackId:
  null` — all of them recognised, timed and analysed perfectly well, and all invisible to
  the trend.
- There **is** an adoption heal, and it is thorough — `11972-12010` borrows the active
  track when a session has none and has timed laps, writes it to the meta, and mirrors it
  into the in-memory `gp.sessions` row because *"the trend reads gp.sessions, not the
  store"*. But it only runs **when you open the session**. A library of thirty recordings
  where twenty-five have not been opened since the track was added still trends five.

So item 8 is two things: **fill in the data**, and **give the question a home that
doesn't require a session to be open.**

## File-level plan

### 1. The back-fill sweep

`gpHistoryBackfill()` — walks the library once, offered from the Tracks view and from the
Sessions view, with a progress line and a Cancel.

For each meta from `gpStore.list()` where `!m.trackId && !m.noTrack`:

1. **Cheap reject first.** `gpStore.rows(id)` gives the packed block — `lat`/`lon` as
   `Int32Array` scaled ×1e7 (`gpRowsPack` `10322-10362`). Compute a bounding box straight
   off the typed arrays without unpacking, and drop any track whose `start_finish` falls
   outside it plus a margin. Most sessions eliminate every track in one pass over
   integers.
2. **Confirm survivors.** `gpRowsUnpack(pk)` (`10364-10386`), then the existing test —
   `gpGateHits(rows, trk.start_finish, 0, rows.length - 1).nearestM <= 300`. Reuse
   `gpNearTrack` itself rather than reimplementing the threshold; `GP_AT_TRACK_M` is local
   to it today and should be lifted out.
3. **On a match, produce the numbers the trend needs** — the same chain the heal block
   runs: `gpComputeG` → `gpSplitRows` against that track → `gpCleanRuns()` →
   `lapTimesS` / `bestLapS` / `lapsBy`, and `gpFindCorners` on the best lap for the
   `corners` fingerprint (`11458-11466`). Write with `gpStore.putMeta` **and** mirror into
   the `gp.sessions` row, exactly as `12032-12043` does.
4. **A session that matches nothing is marked, not re-swept.** Set `m.noTrack = true` —
   the existing "deliberate no" marker (`11861-11862`) — or the sweep re-reads every road
   drive in the library every time it runs. Distinguish it in the UI from a user's own
   "not at a track" answer if that matters; if it doesn't, say so.

Rules the sweep must obey:

- **Never overwrite a non-null `trackId`.** It fills gaps; it does not second-guess.
- **Never demote.** The heal block's `demoted` guard (`11997-12001`) exists because
  re-splitting a gate-timed session against a missing track once cost a recording its
  whole lap table, including a 2:16.091 best. The sweep must carry the same guard.
- **Idempotent.** Running it twice changes nothing the second time.
- **Cancellable, and it yields.** Unpacking and re-splitting thirty recordings of 25,000
  to 170,000 samples is not a frame's work. Yield between sessions and show which one it
  is on.

### 2. Stop the problem recurring

Two small additions to `gpSessionMeta` (`11430-11508`) so future sweeps need no rows at
all:

- `bbox: [latMin, lonMin, latMax, lonMax]` — four numbers, computed at save.
- `trackTried: <track-library revision or timestamp>` — so a session skipped when the
  library held three tracks gets reconsidered once it holds four, without re-reading
  everything every time.

Keep both tiny: `gpStore.list()` deserialises every meta for the rail and the Sessions
table.

### 3. Give the question a home

Today history only renders inside an open session — `gpHistoryHtml` returns `""` with no
current session meta (`11570`). But *"am I quicker here than in March"* is asked
**between** track days, when nothing is open.

Add it to the **Tracks view inspector** (`gpRenderTrackInspector`, ~`36392`), which
already renders for a selected track and is the natural place: pick Mallala, see every
day you have been there. `gpHistoryFor(trackId)` already takes a track id and needs no
current session; `gpHistSpark(hist, curId)` takes the "this one" id as a parameter and
tolerates `null`.

That is a genuinely small change — a second caller for functions that already take the
right arguments — and it is most of the perceived value of item 8.

Keep the Analyse panel as it is. In-session it answers *"where does today sit"*, which is
a different question from *"how has this track gone"*, and both are worth having.

## What is deliberately not changing

- **The 300 m rule stays.** It is what stops a road drive being filed as a track day.
- **`bestLapS !== null` stays in the filter.** A stop-split recording has runs, not lap
  times (`lapsBy: "stops"`), and putting it on a lap-time trend is the exact
  untrustworthy-board problem the run flags fixed.
- **The trend's content stays.** Sparkline, PB, gap, consistency, corner deltas against
  the previous visit — all already written and all right.

## Traps

- **Meta objects are shared identity.** Edit the object from the list, write with
  `gpStore.putMeta`, and mirror into `gp.sessions`. A fresh object forks the list from the
  store; a store-only write does not appear until reload — both already documented at
  `12036-12040`.
- **`recordedAt` is rewritten by `gpHealFutureDates`** (`11652-11665`, the whole-week
  walk-back from the 316-week repair). Reload before writing stored meta, and never key a
  cache on it.
- **`gpStore.list()` is a full deserialise** of every meta. Do not add per-sample arrays
  to meta — big data belongs in the `data` store.
- **The 40 m corner-matching rule** in `gpCornerTrend` (`11527-11539`) is the same rule
  and the same reasoning as lap-to-lap matching: *track position is the only name a corner
  keeps across sessions*. Don't loosen it to make more corners match.
- **`rdm7_tracks_v1` is his hand-placed gates** — real data. The sweep reads it and must
  never write it.
- **`window.confirm` is broken under Tauri** — use `gpConfirm` (`8824-8846`) for the
  "sweep N recordings?" prompt.

## Tests

New `tools/check_history.js`, Model B — `gpHistoryFor`, `gpCornerTrend`, `gpHistSpark`
and the sweep's matcher all lift cleanly:

- `gpHistoryFor` sorts oldest-to-newest, excludes other tracks, excludes `bestLapS: null`.
- Sparkline geometry with 2 sessions, with identical times (`hi === lo`), and with
  identical timestamps (`t1 === t0`) — both degenerate branches exist at `11555-11556`.
- Consistency median with an even and an odd number of other sessions.
- `gpCornerTrend` matches at 39 m and refuses at 41 m.
- **Sweep**: fills a null `trackId`; never overwrites a set one; never demotes a
  gate-timed session whose track is missing from the library; marks a no-match session so
  a second run does no work; is idempotent.
- The bbox reject eliminates a track outside the box without ever unpacking rows.
