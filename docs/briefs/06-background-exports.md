# Brief 6 — background exports

Covers `STUDIO_IDEAS_2026-08.md` item **7**. Owns **ADR-0052**.
Research: `../research/export-pipeline.md`.

## What we are building

Export jobs queue and run while you carry on analysing. A 40-second export stops owning
the app.

## The finding that changes the scope

**This is not a Worker rewrite. It is a modal, a state snapshot, and a queue.**

That is the opposite of the expected answer, so here is the evidence.

**The fast path already runs in the background.** Decode and encode are already
off-main-thread inside Chromium. Backpressure is driven by the codecs' own `dequeue`
events with a 250 ms backstop, *explicitly not timers*, because timers clamp to 1 s in an
unfocused window (`tauri-overlay.html:32226-32254`). That was done deliberately, and it
worked: **31.2 s of 1080×1920 footage exported in ~18 s in a throttled, hidden pane**
(`VIDEO_HUD_EXPORT_2026-08.md:443-444`). The engine does not need moving.

**Three things stop you from using the app during an export, and none of them is the
thread:**

1. **A full-screen modal.** Both the options dialog and the progress dialog are
   `.gp-expdlg` — `position: fixed; inset: 0; z-index: 17000` (CSS `1732-1763`). Every
   pointer event in the app is blocked for the duration. There is no Escape handler; the
   only control is Stop.
2. **Shared mutable state, read live, every frame.** `gpHudRender` reads `gp.trace`,
   `gp.selLap`, `gp.cam.hud`, `gp.ghostFence` and the tile cache out of closure scope as
   it paints. Re-select a lap or nudge a widget mid-export and the output file changes
   halfway through. The modal currently prevents this by construction — remove the modal
   without fixing this and you have traded a blocked UI for corrupted exports.
3. **The slow path needs the visible `<video>` element.** It records the playing element
   through `captureStream` in real time and dies when the window is hidden — a 6 s stall
   watchdog aborts it with an explanatory toast (`31188-31196`).

**And a Worker would be actively worse.** CSP permits it — there is no `worker-src`, so
it falls back to `default-src`, which carries `'self'`, `blob:` and `data:`
(`src-tauri/tauri.conf.json:25`) — and with no bundler it would ship as a plain file
added to `ASSETS` in `tools/merge_overlay.py:44`, like `transport.js`. But `gpHudRender`
would have to be forked or ported, and everything it leans on is document-scoped:

- **Fonts drive layout, not just glyphs.** `GP_HUD_MONO`/`GP_HUD_SANS` (`29205-29206`)
  are Sora and JetBrains Mono, loaded by a Google Fonts `@import` in
  `src/firmware-base.html:10`. `measureText` on the speed number feeds the gear's x
  position (`30437-30443`). A worker's OffscreenCanvas does not see document fonts, so
  the geometry moves, not just the typeface. (Only Barlow is self-hosted, in `src/fonts/`.)
- `HTMLImageElement` does not exist in a worker — the logo (`29368-29391`) and the map
  tile cache (`29287-29314`) both use `new Image()`, and a tile's `onload` reaches back
  into the DOM to nudge the preview (`29306-29309`).
- `localStorage["rdm7_camera"]` is the overlay layout's only home (`38531-38558`).
- `__TAURI_INTERNALS__.invoke` is main-thread, so `read_file_range` — the entire source
  of video bytes — would need proxying back anyway.

Porting all that buys nothing the dequeue-event backpressure hasn't already delivered,
and it breaks the one rule this subsystem has: **`gpHudRender` is not to be forked** —
tile, editor and export call the one function and `check_hud.js` pins pixel identity at
two sizes (`VIDEO_HUD_EXPORT_2026-08.md:23-30`).

## The design

### 1. A job holds a snapshot, and borrows the app's state one frame at a time

The job object captures, at enqueue time, everything the frame loop reads:

```js
{ id, plan,                    // gpExportPlan output: t0, t1, W, H, bps, mime, audio
  reader, videoT0, offsetMs,   // gp.video.reader is already captured at 32087 — keep that
  dest,                        // save path, chosen up front (see 4)
  snap: { trace, traceLaps, selLap, cmpLap, ghostFence,
          traceChanIds, traceChanDefs, sessionMeta, tracksActive,
          cam: <deep clone of gp.cam>, spdUnit, drift, delta },
  state: "queued"|"running"|"done"|"failed"|"cancelled", frames, err }
```

`gpHudRender` and `gpHudData` are **not** refactored to take a context. They stay exactly
as they are. Instead, wrap each frame:

```js
gpWithSnapshot(job.snap, function () {
    g.drawImage(frame, …);
    gpHudRender(g, p.W, p.H, idx);
});
```

`gpWithSnapshot` saves the live `gp.*` fields the HUD reads, assigns the snapshot's,
calls the function, and restores in a `finally`. Synchronous, symmetrical, small, and
testable on its own — and it leaves the pixel-identity contract untouched. The export
borrows the app's state for the length of one frame and gives it back.

The one field that must be reference-captured rather than cloned is `trace` — it is
hundreds of thousands of rows and is *replaced* by `gpSessionLoad`, never mutated in
place, so holding the old array is both cheap and correct. `cam` is small and must be
deep-cloned, because the overlay designer edits it in place.

**Pre-warm map tiles before the job starts** if `gp.cam.hudMapStyle` is `sat`/`satdim`.
Tiles arrive asynchronously through `new Image()` and a cache; a tile that isn't there
yet draws nothing. Today the modal makes that unlikely; a queued job started minutes
later would export frames with a blank ground. (The default `night` style is pure
gradients and needs nothing.)

### 2. Un-modal the progress, keep the options modal

- The **options dialog** stays `.gp-expdlg`. It is a decision the user is making, briefly.
- The **progress dialog** (`gpExportProgress`, `32370-32395`) becomes a non-modal status
  strip — one row per job, showing name, progress bar, and Cancel. Mount it in the dock
  (`#gpDock`, shown in Analyse and Drift, toggled at `gpSetView` `35526-35527`) or as a
  fixed corner strip that is not `inset: 0`. Keep the existing ≥120 ms throttle on
  updates and the comment that goes with it: *"the bar is not the job."*

### 3. A queue, one job at a time

FIFO, single active job. Two concurrent WebCodecs pipelines contend for the same hardware
encoder and both get slower — the queue is not a thread pool, it is a way of not making
the user wait to press the button again.

The **slow path stays foreground and modal.** It cannot be otherwise: it records the
playing element in real time, needs it unmuted, and dies hidden. When a queued job falls
back to the slow path (`giveUp()`, `31013-31025`), it raises the modal for its turn and
keeps the existing "keep the window on top" warning (`30925-30929`). Say this in the UI
rather than discovering it: a job that will need the foreground should be marked at
enqueue time, where `gpFastAvailable()` (`32080-32083`) already knows the answer.

### 4. Ask for the destination up front

Today the save dialog appears when the export finishes (`gpSaveVideoBlob`,
`31220-31244`). In a queue the user is not watching, and a finished job would sit holding
its whole MP4 in memory waiting for someone to answer a dialog. Move
`RDM.saveFileDialog` to enqueue time and write the file the moment the job completes.

This matters for memory: the save is one buffer end to end — `Blob` → `arrayBuffer()` →
raw IPC body → `std::fs::write` (`src-tauri/src/lib.rs:198-214`, no streaming, no temp
file). One finished export transiently holds ~3 copies. A queue of them holding blobs
would not be acceptable, and writing on completion is the whole fix.

### 5. Yield while the app is being used

The per-frame main-thread work — `drawImage` + `gpHudRender` + `encode()` — runs inside
the `VideoDecoder.output` callback. At ~1.7× realtime that is a meaningful share of the
main thread, and an un-modaled export that makes the UI sluggish has only moved the
problem.

Add a visibility-aware cap: when `document.visibilityState === "visible"`, hold the
composite to a budget and let the queue drain; when hidden, run flat out. Implement it
through the **existing dequeue-event backpressure** at `32226-32254`, by lowering the
queue-depth threshold — **never with `setTimeout`**, which clamps to 1 s unfocused. That
lesson is already in the code; don't relearn it.

**Measure this before shipping.** The honest state of it: throughput is known
(31.2 s in ~18 s, hidden and throttled) but per-frame main-thread occupancy with the app
visible has never been measured. Instrument the composite callback, export a real lap
while scrubbing the rack, and pick the cap from the number rather than from taste.

## Traps

- **`gp.video.t0 === null` blocks export** with a toast (`30864-30868`). Any new entry
  point must gate the same way — restore paths that could leave `t0` null were closed
  once already (`VIDEO_HUD_EXPORT_2026-08.md:587-596`) and `check_videot0.js` pins it.
- **Never a `Vec<u8>` on a Tauri command.** If a streaming/chunked save gets added, use
  `ipc::Response` / `ipc::Request` raw bodies (commit `5dfa9ac`).
- **`read_file_range` refuses reads over 8 MB** (`lib.rs:322-345`). The audio copy shipped
  broken once against that cap (`32331-32343`).
- **Sound is deliberately not a setting** (`gpExportPlan` returns `audio: true`
  unconditionally, `30844-30853`). It has been re-fought twice. A queue UI must not grow
  a Sound checkbox.
- **Even dimensions are required** by H.264 (`30835-30841`).
- **Cancelling** must tear down decoder, encoder and the reader loop — `isCancelled` is
  already threaded through `gpExportFast(p, ui, isCancelled)`; keep it, and make the
  queue's Cancel call it rather than inventing a second path.
- **`gp.trace` is replaced, not mutated** — verify that holds before relying on the
  reference capture. If any code path ever mutates rows in place, the snapshot must copy.

## Tests

Extend `tools/check_export.js` (93 checks today):

- `gpWithSnapshot` restores **every** field it touched, including on a thrown exception.
- A job's frames are identical whether or not `gp.selLap` / `gp.cam.hud` are changed
  between frames — the corruption case the modal used to prevent. This is the check that
  justifies the whole design.
- Queue ordering; a cancelled job stops without disturbing the next; a failed job does
  not stall the queue.
- A job marked slow-path-required is flagged at enqueue, not at run time.
- `tools/check_hud.js` stays green untouched — pixel identity proves the renderer wasn't
  forked.

## ADR-0052 — *An export is a snapshot, not a worker*

Worth an ADR precisely because the obvious answer is wrong and someone will propose it
again. Record: that decode and encode are already off-main-thread; that the fast path
already survives a hidden window on dequeue-event backpressure, measured at 31.2 s in
~18 s; that the real blockers were a modal and shared mutable state; that a worker would
have forked `gpHudRender` and lost document fonts, whose `measureText` drives layout and
not just glyphs; and that the slow path is foreground-only by nature and stays that way.
