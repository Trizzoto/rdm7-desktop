# Brief 5 — two-lap comparison video

Covers `STUDIO_IDEAS_2026-08.md` item **6**. No ADR.
Research: `../research/moments-analysis.md`, `../research/export-pipeline.md`.
Do this **last**: it wants the queue (brief 6) and the multi-decoder plumbing habits from
brief 4.

## What we are building

Best lap and a reference, side by side or one inset in the other, with the delta running.
Both from the same day, or today's lap against last month's.

## The three things that make this tractable

### 1. The fast export path never touches the `<video>` element

There is one `<video id="gpVideo">` (`tauri-overlay.html:4284`) and one `gp.video` state
object, and both are singletons. That looked like the blocker, and it is not: the fast
path reads raw sample bytes through `gp.video.reader` and feeds a `VideoDecoder`
(`gpExportFast`, `32085-32304`). The element is only used by the *slow* path, which
records it in real time.

The reader is also **stateless** — a path reader calls `read_file_range(path, offset,
len)` with an explicit offset (`28107-28115`, `lib.rs:322-345`); a file reader slices a
Blob (`28084-28096`). Neither carries a cursor, so two concurrent readers over the same
file, or over two different files, are safe.

So: **two decoders, one encoder, one muxer.** Nothing about `gpMp4Build` (`32035-32068`)
is per-source; it takes accumulated `{chunks, durs, sync}` arrays.

### 2. The alignment already exists, and it is monotonic

`gpDeltaSeries()` (`18656-18682`) walks the selected lap and, for every sample, finds the
nearest sample on the reference lap by GPS distance, through a forward-only sliding window
(`lo = max(ref.from, j - 25)`, `hi = min(ref.to, j + 120)`). Its comment says why: *"Both
laps run the same way round, so the match only moves forward."*

It computes `best` — the matched reference index — and then **throws it away**, keeping
only the time difference. Return it. `gpDeltaSeries` becomes
`{ delta: Float32Array, match: Int32Array }`, cached on the same `selLap:cmpLap` key
(`gp.deltaKey`, `8424`). Every existing caller reads `.delta`.

That match array is exactly the frame pairing a comparison video needs, and because it is
monotonically non-decreasing, **decoder B is demand-driven by decoder A**: for each output
frame, advance B until its timestamp reaches the target, then hold. B repeats a frame when
the reference lap is slower there and skips frames when it is quicker — which is a
truthful picture of the two laps, and needs no second pump or second backpressure loop.

### 3. Cross-session comparison is already built

*"Compare against another day"* works today, and the mechanism is the useful part.
`gpGhostShow(li)` (`33617-33645`) appends the other session's chosen lap into the *same*
`gp.trace` behind `gp.ghostFence`, registered as one extra lap tagged `ghost`. The design
comment (`33583-33590`) states the intent: *"The whole comparison stack — delta, coach,
phases, lanes — works on ONE rows array holding two index ranges… Every surface then
works unchanged."*

So `gpDeltaSeries` already deltas across days. There is **one** gap, and it is precise:

**`gpVideoTimeFor(i)` is wrong for a ghost index.** It goes through `gpSampleUtc(i)`
(`28253-28259`) = `meta.recordedAt + (rows[i].t − rows[0].t)`, where `meta` is the
*current* session's and `rows[0]` is the *current* session's first sample. A ghost sample
carries the other day's clock (noted at `15847`), so that arithmetic is nonsense for it.

The fix is small and fully determined by `gpGhostShow`, which pushes the **same row
objects** (not copies) starting at `base = gp.ghostFence`:

```js
function gpGhostVideoTimeFor(i) {          // i >= gp.ghostFence
    var src = gp.ghostSrc;                 // { sesId, rows, laps, meta, cur }  (8497, 33711)
    var lap = src.laps[src.cur];
    var k   = lap.from + (i - gp.ghostFence);
    var utc = src.meta.recordedAt + (src.rows[k].t - src.rows[0].t);
    return (utc - ghostT0 - ghostOffsetMs) / 1000;
}
```

`ghostT0` / `ghostOffsetMs` come from the ghost session's own meta video link —
`videoAnchorMs`, `videoSrc`, `videoOffsetMs` (`28406-28428`) — resolved the same three
ways `gpVideoBegin` resolves them (`log` > `cam` > `start`, `28290-28347`). If the ghost
session has no linked video, the comparison is data-only: fall back to the delta bar and
one picture rather than refusing.

## The design

```
gpCompareExport(plan):
  A = { reader, range [t0a,t1a], snapshot of the current session }
  B = { reader, range [t0b,t1b], snapshot of the ghost/reference session }
  one VideoEncoder, configured for the composed output size
  for each frame of A in order:
      idxA    = gpIndexForVideoTime(frameA.timestamp/1e6)
      idxB    = match[idxA - selLap.from]
      targetB = videoTimeFor(idxB)              // ghost-aware
      pull B forward until B.timestamp >= targetB, else hold the last frame
      compose(frameA, frameB) -> canvas
      HUD + delta bar
      encode
```

**Layouts.** Two, and the choice matters more than it looks:

- **Side by side** — each source scaled to half the output width. Works for landscape
  footage. Two portrait iPhone videos side by side make an absurdly wide frame, so
  compute the output size from the sources and refuse or letterbox rather than emitting
  a 2160×1920 file.
- **Inset** — A full frame, B in a corner at ~30%, delta bar across the bottom. This is
  the one that works for portrait footage and the one that reads better on a phone.

Default to inset. Offer both.

**The HUD is called twice, not forked.** `gpHudRender(g, W, H, i)` scales everything by
`S = min(min(W,H)/720, W/700)` (`30374`), so it renders correctly into a sub-rectangle:
`g.save(); g.translate(x, y); gpHudRender(g, subW, subH, i); g.restore();`. No new
renderer, no new code path, `check_hud.js` stays green.

But `gpHudData(i)` reads closure state, so lap B's HUD must be rendered **inside lap B's
state**. That is exactly `gpWithSnapshot` from brief 6 — this is the second caller that
needs it, and the reason it is worth building as a named, tested primitive rather than
inlining it into the export loop.

**The delta bar** is drawn by the comparison compositor, after both HUD calls, from
`match`/`delta` at `idxA`. Not a HUD widget: `hudDelta` already exists and means something
else (this lap against the session reference).

**Audio: lap A only.** `gpCopyAudio` for A's range (`32309-32368`). Two overlaid audio
tracks would need mixing and re-encoding, which throws away the byte-for-byte AAC copy
that makes the fast path fast. Sound stays unconditional (`30844-30853`).

## Traps

- **Two hardware decoders may not be available.** `hardwareAcceleration:
  "prefer-hardware"` is already tried and dropped when unsupported (`tryHw`,
  `32144-32151`) — make sure that fallback is per-decoder, so B falling back to software
  does not take A with it. Expect this to be slower than a single export and say so in the
  dialog rather than looking hung.
- **The two laps can be different lengths.** Output duration is A's. B runs out (hold the
  last frame) or has slack left (ignored). Never stretch time to fit — the delta *is* the
  difference.
- **`gpGhostShow` pushes shared row objects**, and `gp.trace.length = gp.ghostFence`
  removes them. An export holding indices past the fence must snapshot (brief 6) or a
  re-split mid-export walks the array out from under it. `gpSplitLaps` drops the fence
  unconditionally (`21648-21650`).
- **`gpDeltaSeries` returns null** when `selLap < 0`, `cmpLap < 0`, or they are equal
  (`18657`). Gate the whole feature on a real reference being chosen.
- **`gpGhostCaches()`** (`33591-33605`) exists because index-keyed caches served the old
  rows when a swapped ghost landed on the same lap index. A `match` array cached on
  `selLap:cmpLap` inherits that bug — clear it there too, alongside `gp.delta`.
- **The 40 m rejection** in the corner matcher (`gpNearestIndex`, `24512-24539`) has no
  equivalent in `gpDeltaSeries`, which always takes the nearest sample in its window even
  if that is 200 m away. Two laps on different lines are fine; a ghost from a *different
  track* would pair nonsense. Check track identity before offering the comparison.
- **`gp.video.t0 === null` blocks export** (`30864-30868`) — for both videos now.
- **Fast path only.** A two-source comparison cannot be recorded in real time from one
  element. When `gpFastAvailable()` is false, refuse with the reason and offer
  `gpVideoConvert` (`28479-28492`).

## Tests

Extend `tools/check_export.js` and `tools/check_videot0.js`:

- `gpDeltaSeries` returns a `match` array that is monotonically non-decreasing, in range,
  and the same length as `delta`; every existing caller still reads `.delta` unchanged.
- Frame pairing: a slower reference repeats frames and never rewinds; a quicker one skips
  and never overshoots.
- `gpGhostVideoTimeFor` against a hand-built `gp.ghostSrc` — index at the fence maps to
  the ghost lap's first sample; the last index maps to its last; a ghost session with no
  video link returns null rather than a wrong number.
- Two laps of different lengths produce an output the length of A.
- Composed output dimensions are even (H.264, `30835-30841`) in both layouts and at both
  source orientations.
- `tools/check_hud.js` unchanged and green — the HUD was called twice, not forked.
