# Brief 4 — auto-highlights

Covers `STUDIO_IDEAS_2026-08.md` item **5**. No ADR.
Research: `../research/moments-analysis.md`, `../research/export-pipeline.md`.
Wants brief 6 (background exports) first, but degrades cleanly without it.

## What we are building

*"Make me a forty-second reel of this session."* Best lap, biggest slide, latest brake —
picked from the Moments that already exist, cut together into one MP4 with the HUD burned
in and a caption on each cut.

## Why it is mostly assembly

Everything that finds the interesting five seconds is built. `gpMoments()`
(`tauri-overlay.html:13470-13588`) is a memoised pass over signals already derived for the
lanes, producing seven kinds of find, each gated on a real threshold:

| | | gate | line |
|---|---|---|---|
| ⚡ | Top speed | > 30 kph | `13499-13502` |
| ▼ | Hardest braking | > 0.35 g | `13506-13508` |
| ◐ | Highest cornering | > 0.4 g | `13510-13514` |
| ↻ | Biggest slide | ≥ 12° | `13518-13522` |
| ▶ | Best launch | speed gain > 40 kph over ~4 s from under 25 kph | `13526-13538` |
| ↪ | Nearly lost it | ≥ 90 °/s yaw at ≥ 15 kph | `13543-13555` |
| ⚑ | Fastest lap | gate-timed only | `13557-13572` |

And the exporter already does the hard parts: a hand-written MP4 demuxer and muxer, a
WebCodecs decode→composite→encode loop, AAC copied byte-for-byte rather than re-encoded,
and dequeue-event backpressure that survives a hidden window.

**The gap is that Moments are points and a reel needs ranges, and that the exporter takes
exactly one range.**

## The two real problems

### 1. A moment is a single sample index

Every moment carries `i` — one index, not a span (`13494-13497`). The panel only ever
needs a timestamp to seek to. A reel needs `{from, to}`.

Add a `span` to each moment at detection time. Per-type roll, because the shapes differ:
a braking event is mostly *before* the peak, a slide is centred on it, a launch is a
window that is already known and thrown away.

| Moment | Span |
|---|---|
| Top speed | peak −4 s … +2 s |
| Hardest braking | peak −3 s … +3 s (the corner it was for is the point) |
| Highest cornering | apex −3 s … +3 s |
| Biggest slide | walk out from the peak while `drift.ok[i]` and `abs(beta) ≥ 8°`, then ±1.5 s |
| Best launch | **`bFrom` … `bi`** — the window is computed at `13526-13538` and `bi` is discarded locally. Recover it. |
| Nearly lost it | peak −2 s … +4 s (the recovery is the interesting half) |
| Fastest lap | the whole lap span from `gp.traceLaps[bl]` |

Use `gpHz`/`gpSecs`/`gpStep` (`24264-24271`, `24089-24093`) to convert seconds to indices.
`gpMoments` currently converts its dedup gap at a hardcoded `4/0.04` (`13574-13584`) —
that is a 25 Hz assumption sitting in a function a 10 Hz VBO also runs through. Fix it
while you are in there.

Adding `span` is backward compatible: `gpMomentGo(n)` (`13590-13614`) keeps using `m.i`.

### 2. The exporter takes one contiguous range

`gpExportPlan(opt)` (`30818-30854`) returns a single `{t0, t1}` in video seconds and the
fast path decodes exactly that.

**The muxer does not care.** `gpMp4Build(video, audio)` (`32035-32068`) takes track
objects that are just accumulated arrays — `{chunks, durs, sync, durTicks, entry}`
(`32286-32291`). Nothing in it is per-range. So:

**One encoder, N decoder passes.** Configure one `VideoEncoder` up front (same source
video, so codec, dimensions and bitrate are constant across segments), then for each
segment create a `VideoDecoder`, decode from the keyframe at or before the segment start,
discard pre-range frames exactly as `32175` already does, composite, encode, `close()`
the decoder, and move on. The encoder's output accumulates into one track and
`gpMp4Build` is used unchanged.

Two things must be rewritten per frame:

- **Output timestamps are cumulative, not source `cts`.** Keep a running output clock and
  advance it by each frame's duration. The muxer's reorder check (monotonic output
  timestamps or bail to the slow path, `32276-32277`) then still holds.
- **Force a keyframe at every segment start.** The loop already forces one every 2 s
  (`32190-32192`); add the segment boundary as a second trigger.

### Audio across cuts — the fiddly bit

`gpCopyAudio(reader, at, p)` (`32309-32368`) copies whole AAC frames for one range.
Concatenating N of those into one track works, but AAC frames are ~23 ms and video frames
~33 ms, so a segment's audio and video durations never match exactly.

Do **not** let that accumulate. Per segment: copy the whole AAC frames covering the range,
then absorb the ≤1-frame difference into that segment's contribution to the audio track's
`durs` so the accumulated audio duration tracks the accumulated video duration. Each cut
resets the error; nothing drifts across eight segments.

Sound is not optional and must not become a setting — `gpExportPlan` returns
`audio: true` unconditionally (`30844-30853`) and that has been re-fought twice. If the
source is not AAC the existing behaviour applies: no audio, and a toast saying why
(`31043-31045`).

## The reel builder

`gpReelPlan(opts)` — pure, testable, no rendering:

1. Take `gpMoments()`, now with spans.
2. Drop any moment whose span falls outside the footage — `gpVideoTimeFor(i)`
   (`28262-28267`) returns null while unsynced, and `gpVideoCover()` (`28355-28369`) says
   how much of the lap the footage even reaches.
3. Merge overlapping spans, keeping the higher-priority moment's caption. (Moments already
   dedup same-name finds within `GP_MOMENT_GAP_S`; different names can still collide.)
4. Fit a duration budget (default 40 s, offer 20/40/60). The fastest lap is a whole lap and
   will not fit — either exclude it from a short reel or take a signature stretch of it,
   but say which in the UI rather than silently truncating.
5. **Order chronologically**, not by drama. The HUD shows lap number and lap time; a reel
   that jumps around in time makes those read as errors.
6. Return `[{from, to, t0, t1, caption, why}]` with `t0`/`t1` already in video seconds.

Captions are drawn by the reel compositor **after** `gpHudRender` returns, on the same
context — the export loop's own drawing, not the HUD's. `gpHudRender` is not forked, not
extended, and `check_hud.js` stays green untouched.

## UI

- A "Make a highlights reel…" button on the Moments panel, beside the existing
  "Save share card…" (`13627-13629`).
- A dialog that lists the chosen segments with their captions, each removable, showing the
  running total against the budget. The reel is a claim about the session, and the driver
  should see the claim before it is made.
- Start hands one job to the queue from brief 6. Without that queue it runs foreground
  and modal exactly as today — which is why this brief does not block on brief 6.

## Traps

- **`gp.video.t0 === null` blocks export** (`30864-30868`). Same gate here.
- **Moments are recomputed, never persisted** — memoised on
  `rows.length : traceLaps.length : ghostFence : spdUnit` (`13473-13475`). Adding `span`
  must not change that key's meaning.
- **`gpCleanRuns()`** (`21625-21627`) for anything lap-shaped, or the reel advertises a
  lap timed across a dropout.
- **Fastest-lap moment only exists when `gp.lapsFrom === "gate"`** (`13557`). A stop-split
  road drive has runs, not laps — the reel must not caption one as "Fastest lap".
- **`read_file_range` caps at 8 MB** (`lib.rs:322-345`) — the audio copy shipped broken
  against that once.
- **Save with `gpSaveVideoBlob`** (`31220-31244`), which uses `RDM.saveFileDialog` +
  `RDM.writeFile` under Tauri. Not the `<a download>` path the share card uses
  (`13906-13915`) — that is the older and worse precedent, and under the queue the
  destination is chosen at enqueue time anyway.
- **Slow-path fallback.** A multi-segment reel cannot be recorded in real time from the
  playing element without seeking between segments and re-syncing each time. When
  `gpFastAvailable()` (`32080-32083`) is false, refuse the reel with a clear reason
  rather than half-building it. Offer the existing "Make a playable copy" re-encode
  (`gpVideoConvert` `28479-28492`), which is the actual fix for a file WebCodecs won't take.

## Tests

Extend `tools/check_export.js`:

- Every moment type produces a span inside the trace, ordered `from < to`, at both 25 Hz
  and 10 Hz.
- Overlapping spans merge; the higher-priority caption survives.
- The budget fitter never exceeds its budget and never emits a zero-length segment.
- Multi-segment muxing: output timestamps are monotonic across cuts; a keyframe exists at
  every segment start; `durTicks` equals the sum of the segments.
- Audio: accumulated audio duration tracks accumulated video duration to within one AAC
  frame **at the end**, not just per segment — that is the check that catches drift.
- Chronological ordering holds when moments are found out of order.
