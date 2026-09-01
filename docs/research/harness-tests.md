# harness-tests

## findings

# JS test-harness system in tools/ — findings

## 1. How the harnesses load app code

There is **no jsdom, no bundler, no package.json, no npm anywhere** (`tools/check_carglyph.js:24` explicitly says "The DOM here is a stub, not jsdom"). Every harness is a plain Node script run as `node tools/check_X.js`. Three loading models exist:

**Model A — parse-only of the built file** (`tools/check_syntax.js`, 99 lines):
- Targets BOTH `src/dist/index.html` and `src/tauri-overlay.html` (`check_syntax.js:27`). If dist is not built it prints "not built, skipped (run tools/merge_overlay.py)" and continues (`:46-50`) — deliberate, so "no dist" ≠ "dist is fine".
- Regex-extracts every inline `<script>` block (`:58`), skips `src=` and non-JS `type=` (`:63-65`), and compiles each with `new vm.Script(...)` — **parse only, never executed** (`:70-76`). `type=module` bodies are wrapped in `(async function(){...})` so top-level `import`/`await` parse under the script goal (`:74-75`).
- Translates V8's snippet line number back to a file line via `whereIs()` (`:37-42`, `:80-87`).
- Rationale in the header comment (`:1-18`): every other harness lifts named functions, so a broken string literal BETWEEN functions passes all of them; this parses the exact file Tauri embeds. Exit 1 on any failure (`:99`).

**Model B — verbatim function extraction + `new Function` sandbox** (the dominant pattern; `tools/check_laps.js` is the clean example):
- Reads the SOURCE overlay, never dist: `REL = 'src/tauri-overlay.html'` (`check_laps.js:25`), with `ROOT = process.env.RDM_ROOT || path.join(__dirname,'..')` (`:24`) for worktrees.
- `grabFrom(src, name)` (`:27-38`): regex `^        (?:function NAME\s*\(|window\.NAME = function)` — **the 8-space indent is part of the contract** (all gp functions sit at exactly that indent inside the IIFE) — then a brace-count walk to the matching `}`. `window.X = function` is rewritten to `function X`.
- Wanted functions for check_laps: `['gpTrackLapRows','gpLapTrackSummary','gpSesMode']` (`:40`), concatenated after a *prelude* that supplies the ambient state the functions close over: `var gp = { sessions: [], sessFilter: null, sesMode: null };` plus a contract-mirror stub of `gpSesDay` (`:45-51`).
- Compiled once with `new Function(prelude + parts + 'return {…, setSessions, setFilter, setMode}')()` (`:53-60`) — the returned closure API is the test surface.
- Assertions are hand-rolled `ok(name, cond, detail)` counters (`:62-66`), feeding fabricated in-memory session metadata (5 sessions at 2 tracks, `:74-89`) through behavioural checks (cross-recording lap ranking, untimed-lap skip without renumbering `lapIdx`, gap vs track best, day-counting, `gpSesMode` precedence, empty-library). Final line `'\nN passed, M failed'`, `process.exit(fail?1:0)` (`:164-165`).

**Model C — whole-chain against a fixture** (`tools/check_mallala.js`, 679 lines — the closest existing thing to a golden-recording test):
- Extraction is Model B scaled up: `grab()` (`:25-32`), `varBlock()` for object/array literals `GP_VBO_ROLE`, `GP_PLACES` (`:33-42`), `constOf()` regex `var NAME = (0x…|number)` for **27 tuning constants** extracted from the app so the harness cannot drift from them (`:43-58`), and `GP_DRIFT_STAR_W` via `eval` of the literal (`:59`).
- 60+ functions pulled (`FNS`, `:61-74`): the whole chain `gpVboParse → gpChanFix* → gpComputeG → gpSplitRows → gpFindCorners → gpDrift*`.
- Sandbox wiring (`:76-96`): `new Function(...ARGN, code)` called with `gp = {}`, a `window` stub whose `localStorage` is `{getItem:()=>null,setItem:()=>{}}`, `GP_DT = 1/25`, `GP_TRACE_HZ = 25`, `gpActiveTrack: () => fakeTrack` (Mallala with its real derived start/finish `{lat:-34.4161627, lon:138.5030594, heading:155.7, half_width_m:15, derived:true}`, `:81-84`), `gpAllChans: () => libChans`, plus three source-level stubs `gpRowsPack/gpEsc/gpSesUid` (`:86-90`).
- Fixture ingestion **through the app's own importer** (`:98-120`): `API.gpVboParse(fs.readFileSync(VBO,'utf8'), basename)`; then — critical detail — the parsed float channel values (`rows[].cv`) are re-encoded to u16 with the fitted `meta.chanDefs` scale/offset **exactly as saving does** (`:101-112`), because a loaded session carries u16 and every reader decodes with those defs; `gp.trace`, `gp.traceChanIds`, `gp.traceChanDefs` set; `gpComputeG(gp.trace)`; `gpDriftForget()`; `gp.traceLaps = API.gpSplitRows(gp.trace)` (`:108-120`).
- Then ~65 checks against the generator's answer sheet (`truth.json`, `:99`): round-trip/hemisphere, lap cutting on the real gate, gyro scale/bias fit vs planted 1.008/0.42, corner coverage & per-lap stability, link units, per-corner angle vs planted within the engine's own confidence bar, steadiness ranking vs the generator's hidden `wob`, spin gating, and refusal when the yaw channel is removed (`:661-676`).

**Model C′ — vm context over a dist slice** (`tools/check_import.js`): slices `_processRdmBytes … importRdm` out of the **built dist** by landmark regexes (`:42-49`), runs it with `vm.createContext`/`vm.runInContext` (`:110-111`) against a fully stubbed environment (fetch, toasts, confirmAsync, DOM-render no-ops, `:87-109`), builds real binary `.rdm` bundles in-memory (`buildRdm`, `:55-77` — documents the RDM1 header format), and asserts on the recorded narration/requests. Exits 0 with a skip message when dist is unbuilt (`:31-34`).

## 2. Fixture generators

**`tools/make_fixture.js`** (212 lines) → writes `src/dist/fixture.rdmsession` at a **hard-coded absolute path** `C:\Users\ruuva\workspace\rdm7-desktop\src\dist\fixture.rdmsession` (`:206`). 5 laps of Winton, position integrated from a corner-limited speed profile at 25 Hz (`:39-84`), per-lap line offsets (`:120-121`), 2 CAN channels (RPM from gearing, throttle from implied accel, `:92-104,152-159`) with self-describing `chanDefs` in meta (`:172-175`), one planted stale sample (0xFFFF) per lap (`:188`). Format = the app's own `.rdmsession` (`format:'rdm-session', version:1`, base64 typed arrays, `:193-205`). Current size on disk: **226,395 bytes** (~12,000 samples, ~8 min). Lives in `src/dist/` which is entirely gitignored; purpose is manual import into a running Studio, and `check_sessions`/others rebuild their own data instead.

**`tools/make_drift_fixture.js`** (663 lines) → writes three files, default basename `mallala-drift` in the **repo root** (`:55`, argv[2] overrides):
- `mallala-drift.vbo` — 1,120,494 bytes: a text VBO, 6 laps of the real Mallala centreline lifted from `GP_SHAPES` inside `src/tauri-overlay.html` at generation time (`:58-63`), 25 Hz, with the VBO traps deliberately present (lat/lon in **minutes**, longitude **positive west**, HHMMSS.SS clock, `[channel units]` aligned to the LAST N columns, `:594-614`); 5 channels (Yaw rate, Steering, Throttle, Brake, RPM), gyro corrupted with 1.008 scale, 0.42 deg/s zero, noise; deliberately **no slip-angle column** (`:44-47`).
- `mallala-drift.truth.json` — 10,177 bytes: the answer sheet — `circuit, lengthM, startFinishS, firstBoardLapCharacter:1, characters[{character,name,wob,commit}], brokeLink{character,betweenCorners}, laps, corners[{corner,sMid,len,sign,peakTurn,lat,lon,pts[3],bestLap,per[lap]{held,…}}]` (`:618-641`).
- `mallala-drift.rates.json` — 170,241 bytes: per-sample truth `{courseRate[], beta[]}` (`:644-646`).
- All three are **gitignored** (`.gitignore` tail): "Generated test fixtures — rebuild with tools/make_drift_fixture.js. Nearly a megabyte of synthetic drive that any checkout can regenerate **byte-identically from a fixed seed**" (deterministic LCG in both generators, e.g. `check_drift.js:93-95` pattern; drift fixture uses seeded noise).

## 3. check_all.js orchestration and CI

`tools/check_all.js` (66 lines): zero config — `fs.readdirSync(__dirname)` filtered to `^check_.*\.js$` excluding itself, sorted (`:21-23`); each run via `spawnSync(process.execPath, [file])` (`:34`); the LAST output line is the summary and must match `failed|FAILED` for a non-zero exit to count as FAIL — otherwise the row is printed **DEAD** with the first `/^\s*(?:[A-Za-z]*Error): /m` line (`:38-52`). Exists because check_autotrack was DEAD for two commits after an app-side rename (`:3-7`). Exit 1 if any harness non-zero (`:61-64`).

Current state (ran it): **34 harnesses, all pass, ~23 s wall** on node **v22.14.0**. Invocation is plain `node tools/check_all.js` (documented in `docs/HUD_OVERLAY_PLAN_2026-08.md:219`: "python tools/merge_overlay.py → node tools/check_all.js (all 33+ green) → …").

**CI does NOT run the harnesses.** `.github/workflows/`:
- `frontend-merge-check.yml` — on push/PR touching frontend files: `python tools/merge_overlay.py`, then an **inline node one-liner** that extracts each `<script>` from `src/dist/index.html` and runs `node --check` per block (`:40-55`), then `node --check src/transport.js` (`:58`). It duplicates check_syntax's job rather than calling it; ubuntu-latest, whatever node the runner ships.
- `release.yml`, `cargo-audit.yml` — no node harness invocations (grep confirms).
- No git hooks (`.git/hooks/` has only samples), no package.json.

## 4. check_mallala.js — real or synthetic?

**Synthetic.** It pins nothing from a real drive: the fixture is `make_drift_fixture.js` output, and every expectation comes from the fixture's own `.truth.json` written at generation time (the harness header `check_mallala.js:1-16` is explicit; realism comes only from the centreline being the app's real OSM survey). It requires `mallala-drift.vbo` + `.truth.json` beside it (`:21,99`) — gitignored but present on this machine (Aug 11).

The two harnesses that DO pin real data:
- **`tools/check_laptime.js`** — a **real** VBO: `C:/Users/ruuva/Downloads/rdm-test/donington/Donington - Lotus Evora GTE - Driver1.vbo` (env `DONINGTON_VBO` overrides, `:23-24`; **outside the repo**; it is the RaceRender demo dataset per memory). Pins: lap count vs the file's own `[session data]` header (7 laps), fastest within ±20 ms of the declared 1:08.21 (`:159-161`), a quantisation tell (`:165-167`), and per-lap times vs a hard-coded **Circuit Tools 3** array `CT=[70.12, 69.24, 69.61, 68.49, 73.10, 68.213, 86.70]` within ±30 ms for the 6 flying laps (lap 7 excluded with a documented gate-offset reason, `:172-197`), plus ≥7 corners with ≥1 found by heading (`:236-240`). Missing file → `process.exit(2)` (`:70-74`), which check_all reports as failure/DEAD.
- **`tools/check_breaks.js`** — synthetic cases first, then (if present) the **real 22 Aug ring**: `%USERPROFILE%\Documents\RDM sessions\puck-ring-2026-08-22.jsonl.gz` (`:23-25`), gunzipped JSONL, asserting **exactly 168,105 samples and exactly 6 breaks at pinned indices** (e.g. the lost fix at 84,115), answers established by hand in `docs/IN_THE_CAR_2026-08-22.md` (`:311-330`). Gracefully **skips** the real section with a console note when the file is absent (`:313-315`) — unlike check_laptime it still passes. It also lifts the Leaflet `_strand` drawing method by landmark regex and runs it against a recording canvas ctx (`:245-256`) — precedent for testing render code headlessly.

So: the golden-recording idea half-exists — check_breaks' ring section is a golden test over a real session with skip-if-absent semantics; check_laptime is a golden test with fail-if-absent semantics; neither file is committed.

## 5. Headless entry points: raw stored session → lap times / corners / drift

Canonical order is `window.gpSessionLoad` (`src/tauri-overlay.html:11836-11960`); the chain, all in `src/tauri-overlay.html`:
1. **Read at rest**: `gpStore.meta(id)` + `gpStore.rows(id)` (store object `:10247-10299`) → `gpRowsUnpack(pk)` (`:10364-10386`) → rows `{lat,lon,kph,hdg,t,g:0,can,gyroz}`.
2. **State**: `gp.trace = rows`; `gp.traceChanIds = meta.chanIds`; `gp.traceChanDefs = meta.chanDefs` (`:11865,11886,11890`); track library `gpTracksReady()` (`:9698`, reads localStorage `rdm7_tracks_v1`, `GP_TRACKS_LS` at `:8992`) and `gp.tracks.active` from `meta.trackId`/`meta.noTrack` (`:11860-11864`); clear `gp.ghostFence` (`:11875`).
3. **Derived g**: `gpComputeG(gp.trace)` (`:20592`).
4. **Laps**: `gpSplitLaps()` (`:21644-21702`) — clears every derived cache incl. `gpDriftForget()` (`:22166-22172`), runs `gpOrientGates` (`:21383`) then `gp.traceLaps = gpSplitRows(gp.trace)` (`:21436`), sets `gp.lapsFrom`, auto-picks `gp.cmpLap` = fastest unflagged. Or `gpSplitLapsAuto()` (`:21906`) when a track rescue is allowed (`:11919-11920` chooses between them by `meta.noTrack`).
5. **Lap times**: `gpSpanSecs(rows, lap)` (`:21301`) / `gpSecs(rows,i,j)` (`:24071`) over `gpCleanRuns()` (`:21625`); the persisted numbers are built by `gpSessionMeta(rows,id)` (`:11430-11508` — `lapTimesS`, `bestLapS`, `lapsBy`, and per-corner fingerprints via `gpFindCorners` on the best lap `:11458-11466`).
6. **Corners**: `gpFindCorners(rows, from, to)` (`:24292`) per lap.
7. **Drift summary**: `gpDriftSource()` (`:22178`) → `gpDriftAngle()` (`:22219`) → `gpDriftCorners()` (`:22872`) → `gpDriftBoard()` (`:23183`, memoized on `gp.driftBoardKey` `:23189-23191`) → `gpDriftBest()` (`:23271`). All caches reset by `gpDriftForget()`.

The working headless recipe for this whole chain is **`check_mallala.js:76-121`** (sandbox args + stubs + storage-parity u16 re-encode); for a `.rdmsession` file the entry is `gpSessionFileParse(text)` (`:10511`) → pk → `gpRowsUnpack` → same chain (exactly what `check_ac_session.js` does); for a VBO, `gpVboParse(text, fileName)` (`:10808`, returns `{meta{chanIds,chanDefs,…}, pk, rows, gates, note}` at `:11112`).

## 6. Session data at rest and export/import tooling

**IndexedDB** (all in the Tauri webview origin):
- `rdm7_sessions_db` v1 — stores `"meta"` (keyPath `id`) and `"data"` (packed samples keyed by same id) — `src/tauri-overlay.html:10248-10259`. This is where every recording lives.
- `rdm7_desktop_db` v2 — stores `image_data`, `font_data`, `track_data` — `src/transport.js:73-82` (LocalTransport's virtual-dash assets).
- `rdm7_images_db` v1 — store `image_data` — `src/tauri-overlay.html:42021-42028` (editor image cache).
- localStorage: `rdm7_tracks_v1` (hand-placed gates — treat as real data per memory), `rdm7_local_active` (transport.js), drift prefs `GP_DRIFT_SRC_LS`, etc.

**Export tooling exists, three formats** (all desktop-side, `src/tauri-overlay.html`):
- `window.gpSessionExportFile(id)` (`:11140-11149`) → `gpSessionFileBuild(meta, pk)` (`:10487-10509`) → **`.rdmsession`**: single JSON document `{format:"rdm-session", version:1, meta:{…minus id}, data:{n, lat,lon,kph,hdg,t base64-LE, nch?, can?, gyro?}}` — **plain JSON + base64, NOT compressed**; reads the store directly so the session need not be open.
- `window.gpSessionExportCsv(id)` (`:11132`) → `gpCsvBuild()` (`:10428`) and `window.gpSessionExportVbo(id)` (`:11125`) → `gpVboBuild()` (`:10616`) — both require the session loaded (`gpNeedsLoaded` `:11118-11123`).
- Import: `window.gpSessionImport(input)` (`:11237-11298`) — content-sniffs VBO vs rdmsession (`:11248-11250`), builds a track from embedded `[laptiming]` gates via `gpTrackFromVbo` (`:11196`), dedupes on `meta.startT` via `gpSessionPrior` (`:11693`), `gpStore.put`, then `gpSessionLoad`.
- **`.rdm` is a different thing**: the binary layout bundle (magic `RDM1`, u16 version, u16 entry count, flavour byte; entries u8 type/u8 nameLen/name/u32 len/data; types 0 layout, 1 image, 2 font, 3 channel setup — documented in `check_import.js:51-77`), handled by `_processRdmBytes` (overlay-extracted body, ADR-0048). Not a session format.

## 7. Repo hygiene

- `.git` = **106 MB**; `git count-objects -vH`: 1,985 loose objects, 100.97 MiB, **zero packs** (never gc'd locally). Working tree 2.5 GB, of which `src-tauri/target` (gitignored) is 2.3 GB. 112 tracked files.
- **No git-lfs**: no `.gitattributes`, `git lfs ls-files` empty.
- Largest tracked files now: `src/tauri-overlay.html` 2,640,994 B; `src/build/index.wasm` 2,066,556 B and `src/build/index.js` 374,884 B (**still tracked despite matching `.gitignore` entries** — committed before the ignore); `src/firmware-base.html` 1,772,778 B; `src-tauri/icons/icon.icns` 271,068 B.
- History weight (uncompressed blob totals across all revs): `src/tauri-overlay.html` **197 revisions, 207.7 MB**; `src/firmware-base.html` 31 revs, 48.2 MB; retired `src/index.html` 41 revs, 32.5 MB; `src/build/index.wasm` 10 revs, 19.9 MB; `Cargo.lock` 72 revs, 10.3 MB. I.e. the repo's size is already dominated by re-committing a 2.2-2.6 MB HTML file ~200 times; a one-time ~1-3 MB immutable golden recording would be comparatively small, but the repo's explicit precedent (`.gitignore` comment) is regenerate-don't-commit for anything regenerable — a REAL session is not regenerable, which is the distinction a plan should lean on.

## data_shapes

## Packed sample block (IDB "data" store value; gpRowsPack, src/tauri-overlay.html:10322-10362)
```js
pk = { v: 1, n,                       // sample count
  lat: Int32Array,  // deg * 1e7
  lon: Int32Array,  // deg * 1e7
  kph: Uint16Array, // km/h * 100
  hdg: Uint16Array, // deg * 100
  t:   Uint32Array, // ms (iTOW-ish); GP_NO_T = 4294967295 = "no timestamp" (:10310)
  nch?, can?: Uint16Array(n*nch),     // sample-major; GP_CHAN_STALE = 0xFFFF = null (:10320)
  gyro?: Int16Array                   // deg/s * 50; -32768 = "IMU had nothing" (:10337-10354)
}
// g is NOT stored; gpComputeG recomputes (:10308)
```

## In-memory row (gpRowsUnpack, :10380-10383)
```js
{ lat, lon, kph, hdg, t|undefined, g: 0, can: [num|null]*nch | null, gyroz: num|undefined }
```

## Session meta (IDB "meta" store row; gpSessionMeta, :11467-11507)
```js
{ id: "ses_<base36>", name, trackId|null, trackName|null, trial,
  recordedAt, dated: "gps"|"download", savedAt,
  startT,                      // first sample's t — the dedupe identity (:11481)
  device, samples, durationS,
  lapCount, bestLapS, lapTimesS: [s...], lapsBy: "gate"|"stops"|null,
  corners: [{lat, lon, kph, s}],      // best lap fingerprint
  chanIds: ["..."]|null, chanDefs: [{id,name,unit,decimals,scale,offset}]|null,
  car: "", driver: "", noTrack? }
```

## .rdmsession file (gpSessionFileBuild, :10487-10509; GP_SESFILE_FMT=:10485)
```json
{ "format": "rdm-session", "version": 1,
  "meta": { /* meta above, minus id — receiver mints its own */ },
  "data": { "n": N, "lat": "<b64 LE Int32>", "lon": "...", "kph": "...", "hdg": "...", "t": "...",
            "nch": 2, "can": "<b64 LE Uint16>", "gyro": "<b64 LE Int16>" } }
```
Uncompressed JSON. Parser validates byteLength === n*bytes before viewing (:10519-10523).

## Drift fixture truth (make_drift_fixture.js:618-641)
```json
{ "circuit": "Mallala", "lengthM": 2557.x, "startFinishS": ..., "firstBoardLapCharacter": 1,
  "characters": [{ "character": i, "name": "...", "wob": num, "commit": num }],
  "brokeLink": { "character": i, "betweenCorners": [a, b] } | null,
  "laps": [...],
  "corners": [{ "corner": n, "sMid", "len", "sign", "peakTurn", "lat", "lon",
                "pts": [[lat,lon]x3], "bestLap": k, "per": [{ "held": deg, ... } per character] }] }
```
Plus `.rates.json`: `{ "courseRate": [deg/s per sample], "beta": [deg per sample] }` (:644-646).

## .rdm layout bundle (binary; check_import.js:51-77)
```
header: "RDM1" | u16 version | u16 entryCount | u8 flavour@8 | reserved to 16
entry:  u8 type (0 layout,1 image,2 font,3 channel setup) | u8 nameLen | name | u32 dataLen | data
```

## check_all summary contract (check_all.js:36-39)
Last stdout line of each harness must match one of: `"N passed, M failed"` or `"passed all N checks"` / `"FAILED n of m"`. Non-zero exit whose last line doesn't match `/failed|FAILED/` renders as DEAD with the first `Error:` line.

## Function-extraction contract (grabFrom/grab, e.g. check_laps.js:27-38, check_mallala.js:25-47)
```js
new RegExp('^        (?:function NAME\\s*\\(|window\\.NAME = function)', 'm')  // exactly 8 spaces
// then brace-count from the first '{'; constants: /var NAME = (0x..|[-0-9.]+)/
// object literals: varBlock() bracket-walk; GP_DRIFT_STAR_W via eval of the matched literal
```

## Sandbox argument list check_mallala uses to run the full chain (check_mallala.js:91-96)
```js
ARGN = ['gp','window','GP_DT','GP_TRACE_HZ','gpActiveTrack','gpAllChans', ...27 GP_* consts]
// gp = {}; window.localStorage stubbed; GP_DT = 1/25; gpActiveTrack -> fake Mallala track
// + source stubs: gpRowsPack, gpEsc, gpSesUid (:86-90)
```

## Real-fixture paths (not in repo)
- `C:/Users/ruuva/Downloads/rdm-test/donington/Donington - Lotus Evora GTE - Driver1.vbo` (check_laptime.js:23-24, env `DONINGTON_VBO`)
- `%USERPROFILE%/Documents/RDM sessions/puck-ring-2026-08-22.jsonl.gz` — gzipped JSONL, one row object per line, 168,105 rows (check_breaks.js:23-25, argv[2] override)

## gotchas

- **check_all green is machine-dependent today.** check_laptime `process.exit(2)`s if the Donington VBO is absent (check_laptime.js:70-74) and check_mallala throws (DEAD) if `mallala-drift.truth.json` is absent (check_mallala.js:99) — so a fresh clone fails check_all until you run `node tools/make_drift_fixture.js` AND have the Donington file. check_breaks is the polite model: real-data section skips with a note when the file is missing (check_breaks.js:313-315) yet still passes. A golden-recording plan must pick one of these two semantics deliberately.
- **The 8-space-indent extraction contract**: every Model-B harness regexes `^        function NAME(` — reformatting the overlay, renaming a function, or moving one out of the IIFE breaks extraction. The failure mode is a throw at harness startup, which check_all surfaces as DEAD (that is check_all's whole reason to exist, check_all.js:3-7). Extracted functions also silently capture NOTHING — any helper not in the FNS list must be stubbed or the sandbox throws ReferenceError at call time, not build time.
- **Harnesses test the overlay, check_syntax/check_import test dist.** Model-B harnesses read `src/tauri-overlay.html` directly, so they pass without a merge; anything the merge itself mangles is only caught by check_syntax (both files) and check_import (dist landmarks). Both skip politely when dist is unbuilt.
- **Storage parity trap for feeding real sessions**: `gpVboParse` returns float channel values in `rows[].cv`; a stored session holds u16 + scale/offset. check_mallala.js:101-112 re-encodes floats→u16 with `meta.chanDefs` before building `gp.trace` — skip that and every channel-fix/decode test runs over already-decoded values. Feeding from a `.rdmsession`/IDB pk avoids the issue (gpRowsUnpack is the storage decode).
- **check_laptime passes GP constants positionally** (`build(0.1, 20, 300, 6, 0.6, 25, 1.5, …)`, check_laptime.js:67) — duplicated literals that can drift from the app's values; check_mallala/check_drift extract them with `constOf` instead. Copy the latter pattern.
- **CI runs none of this.** frontend-merge-check.yml re-implements the syntax check inline instead of calling tools/check_syntax.js; adding check_all to CI would today require the fixture-regeneration step plus the two real files (or the skip semantics).
- **`gp` state hygiene between runs**: gpSplitLaps clears a long list of memoized caches (delta/strip/sectors/chan/drift, tauri-overlay.html:21653-21671) and gpDriftForget (:22166) clears the drift set; a headless harness that mutates `gp.trace` mid-run must do the same or read stale boards (check_mallala restores state manually after its spin-bend section, :607-658).
- **Exports are not equivalent**: `.rdmsession` reads the store and works unopened; CSV/VBO build from loaded rows only (gpNeedsLoaded :11118). VBO export is lossy (10 Hz text heritage, no scale field) — the repo's own ADR-0028 note says "Fidelity in, portability out"; a golden recording should be `.rdmsession` (or the raw pk), not VBO.
- **Import dedupe can bite a test harness**: `gpSessionPrior` matches on `meta.startT` (:11693-11698); importing the same golden twice updates in place rather than adding — fine for the app, surprising in a test that expects two sessions.
- **make_fixture.js writes to a hard-coded absolute path** (make_fixture.js:206) — not portable, unlike make_drift_fixture's argv/ROOT-relative default.
- **src/build/index.wasm + index.js are tracked despite .gitignore entries** — .gitignore does not untrack; 10 wasm revisions already cost ~20 MB of history. Any new large-binary policy should note this precedent.
- **Committing goldens**: repo history is already 200+ MB of uncompressed overlay revisions with no LFS; an immutable real session (~2-3 MB as .rdmsession, more for a 92-min session: 138k samples × 16 B ≈ 2.2 MB packed before base64 +33%) committed ONCE is materially different from the tauri-overlay pattern (re-committed per change), but the .gitignore comment establishes "regenerable → don't commit"; a real recording is NOT regenerable, which is the argument for committing (or LFS/external download) — the plan should address this head-on.
- Per user memory: heredocs eat backslashes (why check_syntax exists — never write JS via bash heredoc), and `rdm7_tracks_v1` localStorage plus the sessions IDB are real user data — any tooling that seeds or clears stores must back up first and clear stores, not deleteDatabase.

## open_questions

- Whether the Donington VBO (RaceRender demo data) can be redistributed/committed as a repo fixture — licensing not stated anywhere in the repo; only the local path and the memory note identify its origin.
- Whether any automation outside the repo (scheduled task, external script) runs check_all — no CI workflow, no git hooks, no package.json script does; I checked .github/workflows/*, .git/hooks/, and docs. The only documented invocation is manual (docs/HUD_OVERLAY_PLAN_2026-08.md:219).
- Exact byte-determinism of make_drift_fixture.js across Node versions (the .gitignore claims byte-identical regeneration from a fixed seed; the LCG is deterministic but float formatting via toFixed should be stable — not verified across Node majors).
- I sampled 6 of the 34 harnesses in depth (syntax, laps, laptime, mallala, drift header, import, breaks) plus grep-level confirmation that all 34 use the same new Function/vm extraction family and none use jsdom; per-harness quirks of the remaining ~28 (notably the 98 KB check_autotrack.js and 79 KB check_hud.js) were not read line-by-line.
- Remote/packed size of the GitHub repo (local .git is all loose objects, 106 MB; the server-side packed size will be smaller but was not measured — no network calls made).