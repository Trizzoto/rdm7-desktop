# export-pipeline

## findings

# Video export pipeline — end to end

All frontend anchors are in `C:\Users\ruuva\workspace\rdm7-desktop\src\tauri-overlay.html` (abbrev. `overlay`) unless noted. Rust is `C:\Users\ruuva\workspace\rdm7-desktop\src-tauri\src\lib.rs` (abbrev. `lib.rs`). Doc: `C:\Users\ruuva\workspace\rdm7-desktop\docs\VIDEO_HUD_EXPORT_2026-08.md` (abbrev. `doc`).

## 1. The full export flow

**Entry UI.** Button `#gpBtnVExport` ("Export video") on the video tile, `onclick="gpVideoExport()"` — overlay:4289-4290. (The separate `#gpExportBtn` at overlay:4240 / `gpExportPop` overlay:16744-16794 is the *data* export popover — VBO/CSV/.rdmsession — not video.) `window.gpVideoExport` overlay:30856-30880 gates on: a video open (`gp.video`), a trace loaded (`gp.trace`), sync established (`gp.video.t0 !== null`), and `gpExportMime()` non-null; then builds the options dialog `#gpExpDlg` via `gpExportDlgDraw()` overlay:30882-30956. Options held in `gp.exp` (in-memory only, defaults `{ range:"lap", quality:"high", maxH:0, audio:"on" }` overlay:30874). Start → `gpExportRun(p)` overlay:30995 → `gpExportRunNow` overlay:31001-31051: first awaits `gpHudLogoReady()` (≤1.5 s, overlay:31006-31008, 29398-29405), then picks **fast** (`gpFastAvailable()` overlay:32080-32083: WebCodecs `VideoDecoder`+`VideoEncoder`+`VideoFrame` exist AND `gp.video.reader` exists) or **slow** path. Any fast-path failure falls back to slow via `giveUp()` overlay:31013-31025 with toast "Recording this one in real time…".

**Fast path — `gpExportFast(p, ui, isCancelled)` overlay:32085-32304.**
- **Demuxer (hand-written, in-repo):** `gpMp4Demux(reader)` overlay:31513-31616 walks ISO-BMFF boxes (`gpBoxes` overlay:31365-31378, `gpFindMoov` overlay:31387-31425, `gpTrackSamples` overlay:31429-31511 flattening stts/ctts/stsc/stsz/stco/co64/stss/stsd). Fragmented MP4 rebuilt via `gpFmp4Defaults` overlay:31655-31667, `gpFmp4Scan` overlay:31692-31744 (64 KB `gpWindowReader` overlay:31671-31690, all three tfhd base-offset cases in `gpMoofTraf` overlay:31747-31826). tkhd rotation read by `gpTkhdRotation` overlay:31622-31632 and honoured in the composite (overlay:32176-32186). Codec strings from the file: `gpAvcCodec` overlay:31855-31859, `gpHevcCodec` overlay:31833-31851 (HEVC = most iPhone footage). Frame size forced onto the decoder via `codedWidth/codedHeight` from VisualSampleEntry bytes 32/34 (overlay:31589-31592, 32140-32143).
- **Source frames:** NOT `<video>` seeks. Raw sample bytes read through `gp.video.reader` in ≤4 MB contiguous runs (`pump` overlay:32208-32258), wrapped as `EncodedVideoChunk` (type from stss sync table, timestamp = cts µs) and fed to `VideoDecoder` (overlay:32216-32224). Decode starts at the keyframe at/before `p.t0` (overlay:32102-32103); pre-range frames decoded then discarded (overlay:32175).
- **Reader abstraction** `{size, read(off,len)}`: `gpVideoSrcFile` overlay:28084-28096 (File/Blob slice + FileReader, browser path) and `gpVideoSrcPath` overlay:28107-28115 (Tauri `read_file_range` command, 8 MB/read cap — lib.rs:322-345). Reader is stored on `gp.video.reader` at open (overlay:28613-28618).
- **Composite:** `VideoDecoder.output` callback (overlay:32171-32203): `g.drawImage(frame, …)` onto a `document.createElement("canvas")` sized `p.W × p.H` with `{alpha:false}` 2D context (overlay:32166-32168); rotation applied for tkhd 90/180/270; then `idx = gpIndexForVideoTime(frame.timestamp/1e6)` and `gpHudRender(g, p.W, p.H, idx)` (overlay:32188-32189); a `new VideoFrame(cv, {timestamp,duration})` is encoded (overlay:32193-32195). Keyframe forced every 2 s (overlay:32190-32192).
- **Encoder:** `new VideoEncoder` overlay:32153-32165; config overlay:32129-32134: `codec: p.H>1200 ? "avc1.640033" : "avc1.640028"` (H.264 High L5.1/L4.0), `bitrate = min(80e6, plan bps × min(2, fps/30))` where plan `bps = min(80e6, W·H·30·bpp)`, `bpp` from `GP_EXPORT_BPP = { high: 0.20, max: 0.45 }` overlay:30816, `framerate` = the file's measured fps (overlay:32127), `avc:{format:"avc"}`, `latencyMode:"quality"`, `hardwareAcceleration:"prefer-hardware"` tried and dropped if unsupported (`tryHw` overlay:32144-32151, applied 32260-32263). Backpressure: pump waits while `decodeQueueSize/encodeQueueSize ≥ 8`, on the codecs' **`dequeue` events** with a 250 ms backstop timer — explicitly not timers, because timers clamp to 1 s in unfocused windows (overlay:32226-32254; doc:553-554).
- **Muxer (hand-written, in-repo):** `gpMp4Build(video, audio)` overlay:32035-32068 — `ftyp isom/iso2/avc1/mp41`, mdat first so offsets are known, then moov; movie timescale 1000, video track timescale 90000 (overlay:32279); tracks via `gpTrakBox` overlay:31976-32020, run-length stts `gpStts` overlay:31964-31974, `avc1` entry around the encoder's own avcC (`gpAvc1Entry` overlay:32023-32033, avcC captured from `meta.decoderConfig.description` overlay:32155-32156). Reorder check: monotonic output timestamps or bail to slow path (overlay:32276-32277). Output is a `Blob([...], {type:"video/mp4"})` overlay:32068. Debug handles `window.__gpMux/__gpDemux/__gpAvc1` overlay:32075-32077.
- **Save:** `gpSaveVideoBlob(blob, name)` overlay:31220-31244 — under Tauri: `RDM.saveFileDialog` (transport.js:2337-2353, `plugin:dialog|save`) then `blob.arrayBuffer()` → `RDM.writeFile(path, Uint8Array)`; in a browser: `<a download>`. Filename `gpExportName` overlay:30962-30968 (`rdm-<track>-lapN.mp4`).
- **The Vec<u8>-as-JSON wire issue (commit 5dfa9ac):** Tauri serialises `Vec<u8>` returns and `data: Vec<u8>` args with serde_json — a 128 MB read became ~380 MB of JSON text (49.6 s); a 20 MB write took 11.4 s. Fixed both directions: `read_binary_file` lib.rs:170-183 and `read_file_range` lib.rs:322-345 return `tauri::ipc::Response::new(bytes)` (arrives in JS as ArrayBuffer); `write_binary_file` lib.rs:185-214 takes `tauri::ipc::Request`, bytes as `InvokeBody::Raw` request body, destination path in a percent-encoded ASCII `x-path` header (decoder `percent_decode` lib.rs:217-239). JS side: `RDM.writeFile` transport.js:2395-2399 passes the `Uint8Array` as the invoke *payload* with `{headers:{'x-path': encodeURIComponent(path)}}` via `_tauriInvoke(cmd, args, options)` transport.js:63-68; `RDM.readFile` transport.js:2407-2410 wraps the ArrayBuffer. Numbers: doc:536-545 (128 MB read 49.6 s → 3.1 s; 20 MB write 11.4 s → 0.55 s).

**Slow path — `gpExportSlow(p)` overlay:31053-31210** (fallback only): a `p.W×p.H` canvas + `canvas.captureStream(0)` + manual `track.requestFrame()` per presented frame; `MediaRecorder(stream, {mimeType, videoBitsPerSecond: p.bps})` overlay:31089; mime from `GP_EXPORT_MIMES` overlay:30793-30810 (MP4 avc1+mp4a preferred, WebM vp9/vp8 fallback). Frames come from the **playing `<video>` element in real time** via `el.requestVideoFrameCallback` carrying `mediaTime` (`pump` overlay:31159-31181; rAF fallback 31173-31179); each `frame(mediaTime)` overlay:31146-31157 does `drawImage(el)` + `gpHudRender` at `gpIndexForVideoTime(mediaTime)`. Prelude `gpExportSlowPrepared` overlay:30977-30993 runs `gpUntaintVideo` overlay:31284-31323 (re-reads the file into a Blob via `RDM.readFile` only if the canvas is tainted; capped 300 MB `GP_UNTAINT_MAX` overlay:31280, 30 s load timeout) — normally unnecessary because path videos are loaded with `crossOrigin="anonymous"` (`gpVideoSetSrc` overlay:28569-28596; rationale 28550-28568).

## 2. What blocks the UI today

- The frame loop is **not** a while-loop and not rAF (fast path): it is an awaited promise chain on the **main thread** (`pump`→`wait`→`pump`, overlay:32208-32258), with the per-frame composite (`drawImage` + `gpHudRender` + `encode`) running inside the `VideoDecoder.output` callback on the main thread. Decode/encode themselves are off-main-thread inside Chromium; the main thread does IPC reads, HUD painting, and muxing.
- **A modal covers everything:** both the options dialog and the progress dialog use class `.gp-expdlg` — `position: fixed; inset: 0; z-index: 17000` (CSS overlay:1732-1763). All pointer input to the app is blocked for the duration; the only control is the Stop button (`gpExportProgress` overlay:32370-32395). No Escape handler; the dialog is removed only by its own buttons/`ui.close()`.
- So the user **cannot navigate** anywhere in the app during an export. There is no background mode.
- Window minimised/hidden: the **fast path keeps running** (dequeue-event backpressure was added precisely because timer clamping made a hidden export "mostly sleeping" — overlay:32226-32233; doc measured 31.2 s of footage in ~18 s in a throttled hidden pane, doc:443-444). The **slow path dies hidden**: no painting → no frames → 6 s stall watchdog aborts with an explanatory toast (overlay:31188-31196, 31108-31113); the dialog warns to keep the window on top (overlay:30925-30929).
- The historically frozen step — the save — was main-thread JSON serialisation of the byte array, fixed in 5dfa9ac (see §1). The remaining single-buffer `blob.arrayBuffer()` at overlay:31240 still materialises the whole MP4 in one ArrayBuffer before the IPC.

## 3. Time model

- `gp.video.t0` = **UTC ms of the video's first frame**; `gp.video.offsetMs` = manual nudge. Sample→video: `gpVideoTimeFor(i)` overlay:28262-28267 = `(gpSampleUtc(i) − t0 − offsetMs)/1000`; `gpSampleUtc(i)` overlay:28253-28259 = `meta.recordedAt + (rows[i].t − rows[0].t)` (40 ms/idx fallback). Video→sample: `gpIndexForVideoTime(ct)` overlay:28271-28288, binary search over row timestamps, clamped to `gp.ghostFence`.
- **Three sync sources**, `gpVideoSyncSet(which)` overlay:28325-28347: `"log"` (`meta.videoAnchorMs`, the logger's own figure → `t0 = recordedAt − videoAnchorMs`), `"cam"` (mp4 creation time probed by `gpVideoProbeT0` overlay:28118-28132 from the moov via the reader, timezone-snapped by `gpVideoTzFix`), `"start"` (`t0 = recordedAt`). Set at open in `gpVideoBegin` overlay:28600-28708. Drag-to-sync recomputes `offsetMs` at overlay:28937.
- **Per-session persistence:** on the session meta — `meta.videoPath`, `meta.videoSrc`, `meta.videoOffsetMs` — written by `gpVideoLink` overlay:28406-28418 and kept current by `gpVideoLinkSync` overlay:28422-28428 (`gpStore.putMeta`); restored on session open by `gpVideoRelink` overlay:28433-28450 → `gpVideoBegin(..., restore)` which replays `src` + `offsetMs` after the probe (overlay:28663-28686). Camera defaults (mute/follow/auto/HUD toggles + HUD layout `hud`) are per-PC in `localStorage["rdm7_camera"]` (`GP_CAM_LS`/`gpCamLoad`/`gpCamPut` overlay:38531-38567).
- **Export range:** exactly **one contiguous `[t0,t1]` in video seconds**, chosen in `gpExportPlan(opt)` overlay:30818-30854: `range:"lap"` → `gpLapRange()` overlay:21944-21949 (selected lap from `gp.traceLaps[gp.selLap]`, else whole trace to ghostFence) mapped through `gpVideoTimeFor` and clamped to `[0, el.duration]`; `range:"all"` → `[0, duration]`. Minimum span 0.2 s. Dimensions forced even (H.264, overlay:30835-30841); optional `maxH:1080` downscale.
- Fast path backs `t0` up to the previous keyframe for the decoder but discards out-of-range frames; last-frame duration taken from the source sample table, not an fps average (overlay:32104-32112; doc:513-514).

## 4. Audio

- **Fast path: copied, not re-encoded.** `gpCopyAudio(reader, at, p)` overlay:32309-32368 — AAC (`mp4a` entry) only; samples byte-for-byte in 4 MB windows walking the interleave (`read_file_range` caps a read at 8 MB — overlay:32331-2343, 64 MB total cap); the **sample description is rebuilt** as an ISO version-0 `mp4a` entry with the `esds` lifted out of QuickTime's `wave` atom (`gpAudioEntryIso` overlay:31923-31960, `gpFindEsds` overlay:31908-31922) — verbatim QuickTime v1 entries play SILENT in strict ISO demuxers (doc:484-507). Non-AAC (e.g. `lpcm`) → no audio, toast says why ("the camera did not record AAC", overlay:31043-31045).
- **Slow path: re-encoded** by MediaRecorder — `el.captureStream()` audio tracks added to the canvas stream (overlay:31078-31085); the element must be **unmuted** during recording (a muted element captures silence — overlay:31066-31086; restored on all exits).
- **Not a setting:** `gpExportPlan` returns `audio: true` unconditionally; the dialog has no Sound row (overlay:30844-30853, 30911; doc:463-467).

## 5. Feasibility facts for off-main-thread export

- **CSP** (`src-tauri/tauri.conf.json:25`): `default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob: http://* https://*; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' http://* https://* ws://* wss://*; img-src ...; media-src ... http://asset.localhost ...`. **No `worker-src`** → falls back to `script-src` (absent) → `default-src`, which includes `'self'`, `blob:` and `data:` — so both same-origin worker files and `blob:` workers are CSP-legal. `dangerousDisableAssetCspModification: true` (tauri.conf.json:26). Note: no bundler exists (CLAUDE.md), so a worker would be a plain shipped file (like `transport.js`) or an inline-string→Blob URL.
- **No Worker / OffscreenCanvas / worker-WebCodecs anywhere today**: zero hits in `src/tauri-overlay.html`, `src/transport.js`, `src/firmware-base.html`; the only hit in `src/build/index.js` is an unused emscripten property name `offscreenCanvas` (line 4658).
- **`gpHudRender` dependencies** (overlay:30355-30708). Its own contract says "Nothing below reads the DOM, the video or the playhead" (overlay:30347-30350), and `gpHudData(i)` overlay:29117-29169 is pure closure-state (gp.trace rows, `gpDriftAngle()` overlay:22219, `gpChannels()` overlay:18126, `gpHudChans()` overlay:29054, `gpDeltaSeries()` overlay:18656, `gpLapRange`). But worker-hostile edges exist:
  - **Fonts:** `GP_HUD_MONO = "'JetBrains Mono', ui-monospace, monospace"`, `GP_HUD_SANS = "'Sora', …"` (overlay:29205-29206), loaded via a document-level Google Fonts `@import` in the firmware base (`src/firmware-base.html:10`, weights Sora 400-700 / JetBrains Mono 400-600). A worker's OffscreenCanvas does not see document fonts — `measureText` drives layout (speed number width feeds gear x, overlay:30437-30443), so wrong fonts change geometry, not just glyphs.
  - **Images:** logo `gpHudLogoLoad` overlay:29368-29391 uses `new Image()` with `src="rdm_logo.png"` (same-origin, cannot taint) and export-side await `gpHudLogoReady` overlay:29398-29405; **map tiles** `gpHudTile` overlay:29287-29314 uses `new Image()` with `crossOrigin="anonymous"` per URL, session cache `GP_HUD_TILE_CACHE` (max 400 ≈ 25 MB), and its `onload` nudges the DOM preview via `gpVideoDrawOverlay` + `setTimeout`. `HTMLImageElement` does not exist in a worker (would need `createImageBitmap`/`fetch`). Tiles are drawn by `gpHudTiles` overlay:29316-29356 (hand-rolled web-mercator math; sources `GP_WORLD_IMAGERY` overlay:34225, `GP_IMAGERY` overlay:34282-…, chooser `gpImageryFor` overlay:34424). Satellite grounds only load when `gp.cam.hudMapStyle` is `sat`/`satdim` (`gpHudMapStyle` overlay:29243-29248); the default `night` ground is pure gradients.
  - **The minimap line** (`gpHudMinimap` overlay:29407-…): pure canvas — the "analyse map's own constant line" recipe, `GP_TRACE_WHOLE` (overlay:25020) over a `GP_LAP_CASE` casing (overlay:29511-29536); track outline/start-finish from `gpTrackById(meta.trackId)` (track library state) and `gpCurSessionMeta()` overlay:28242-28247 (reads `gp.sessions`/`gp.sessionMeta`).
  - **localStorage:** widget on/off, layout nudges (`hud.w`), layer order (`hud.z`), map style all come from `gp.cam` ← `gpCamLoad()` reading `localStorage["rdm7_camera"]` (overlay:38532-38558) — unavailable in a worker; would need to be snapshotted and passed in.
  - Misc: the export's composite canvas is `document.createElement("canvas")` (overlay:31055, 32166) —直接 OffscreenCanvas-able; `gpHudRR` hand-rolls roundRect for old webviews (overlay:29171-29184); everything else is 2D-context ops on the passed `g`.
- The reader (`gpVideoSrcPath`) is invoke-based; `__TAURI_INTERNALS__.invoke` is not available in workers by default — reads would have to be proxied through the main thread or via fetch to the asset protocol.

## 6. Progress reporting

Direct DOM writes only, no events: `gpExportProgress(onCancel, title)` overlay:32370-32395 builds `#gpExpProg` (`.gp-expdlg` full-screen modal) and returns `{tick(frac, frames), close()}`; `tick` sets `bar.style.width` and `stat.textContent`, throttled to ≥120 ms between updates ("the bar is not the job", overlay:32387). Called per composited frame from the fast path (overlay:32197) and slow path (overlay:31156). Completion/failure is toasts (`showToast`, e.g. overlay:31037-31048, 31123-31124). No Tauri events, no taskbar progress, nothing survives the modal.

## 7. Rust side — the save command

`write_binary_file` lib.rs:198-214: **one big buffer, no streaming, no temp file** — the entire MP4 arrives as `InvokeBody::Raw` in memory and is written with a single `std::fs::write(&path, bytes)` (lib.rs:213). Path from the percent-encoded `x-path` header (lib.rs:200-206, decoder lib.rs:217-239). Companions: `read_binary_file` lib.rs:179-183 (whole-file `std::fs::read` → `ipc::Response`), `read_file_range` lib.rs:322-345 (seek+read loop, 8 MB cap, `ipc::Response`), `video_allow` lib.rs:253-263 (per-file asset-protocol scope grant, returns size — the scope ships empty, tauri.conf.json:27-30), `video_have_ffmpeg` lib.rs:266-275 and `video_convert` lib.rs:290-316 (system ffmpeg re-encode to `libx264 main@4.0 -crf 20 -c:a copy +faststart`, blocking, writes `"<stem> (playable).mp4"` beside the source). All registered in the invoke handler at lib.rs:2044-2049.

## 8. Performance numbers (doc + commit)

`docs/VIDEO_HUD_EXPORT_2026-08.md` "The export" section (438-482) is the architecture statement; measured figures:
- Fast path: **31.2 s of 1080×1920 footage exported in ~18 s in a throttled hidden pane** (doc:443-444).
- IPC (doc:538-541 + commit 5dfa9ac message): `read_binary_file` 128 MB — 49.6 s before → **3.1 s** after; `write_binary_file` 20 MB — 11.4 s before → **0.55 s** after; the 128 MB clip serialised to ~380 MB of JSON before.
- `gpUntaintVideo` as the old normal path: **49.6 s hang on a 128 MB clip** (doc:532-534).
- End-to-end verification: 69.5 s of 1216×1616 `hvc1` iPhone footage → H.264 MP4, exact source duration, stereo 48 kHz AAC correlating 0.949 at zero lag (doc:603-607). Muxer/demuxer cross-checked in node and against every real video file on the machine (doc:609-613).
- Harnesses (doc:3-7): `tools/check_hud.js` (223 checks), `check_export.js` (93), `check_untaint.js` (30), `check_videot0.js` (23), `check_transport.js` (18), `check_carglyph.js` (156), `check_hudedit.js` (111). Known not-done (doc:615-623): `sidx`/`mfra` ignored; slip-angle instrument chain untrustworthy on real recordings.

## data_shapes

## gp.video (created in gpVideoBegin, overlay:28613-28622)
```js
gp.video = { name, url, blob: !!blob, path: path||null,
             reader: probeSrc||null,          // {size, read(off,len)->Promise<ArrayBuffer>}
             size: (probeSrc&&probeSrc.size)||0,
             t0: /* UTC ms of frame 0, or null */, fileT0, // non-null = log anchor, do not overrule
             src: "log"|"cam"|"start", autoT0, autoTz, offsetMs: 0,
             follow, probing: true };
```

## Reader (overlay:28084-28115)
```js
function gpVideoSrcPath(path, size) { return { size,
  read: (off,len) => gpTauriCall("read_file_range",{path,offset:off,len})
        .then(bytes => new Uint8Array(bytes).buffer) }; }
```

## Export plan (gpExportPlan, overlay:30852-30853)
```js
{ t0, t1, secs: t1-t0, W, H, bps, mime: gpExportMime(), audio: true }
// bps = min(80e6, W*H*30*bpp); GP_EXPORT_BPP = { high: 0.20, max: 0.45 } (overlay:30816)
// gp.exp = { range:"lap"|"all", quality:"high"|"max", maxH:0|1080, audio:"on" } (overlay:30874)
```

## Fast-path result (overlay:32293-32295)
```js
{ blob: /* Blob video/mp4 */, frames: wrote, sound: !!aTrack }
```

## Muxer track objects (fed to gpMp4Build, overlay:32286-32291 / 32348-32350)
```js
vTrack = { id:1, video:true, timescale:90000, width:p.W, height:p.H,
           chunks:[Uint8Array], durs:[ticks], sync:[frameIdx], durTicks, entry: gpAvc1Entry(...) };
aTrack = { id:2, video:false, timescale:ts, chunks, durs, sync:null, entry: isoEntry, durTicks };
```

## Demux table per track (gpTrackSamples, overlay:31509-31510)
```js
{ n, sizes:Uint32Array, offsets:Float64Array, dts:Float64Array, cts:Float64Array,
  sync:Uint8Array|null, dur, stsd:[start,end] }
// track: { id, rot, timescale, kind, tab, entry:{type,bytes}, avcC, hvcC, w, h }
```

## Session-meta video link fields (gpVideoLink, overlay:28410-28412; persisted via gpStore.putMeta)
```js
meta.videoPath = v.path; meta.videoSrc = v.src||"start"; meta.videoOffsetMs = v.offsetMs||0;
// plus meta.videoAnchorMs (log anchor), meta.recordedAt, meta.dated === "gps"
```

## Per-PC camera/HUD store — localStorage["rdm7_camera"] (GP_CAM_LS, overlay:38531-38558)
```js
{ auto, follow, overlay, muted, hudSpeed:false /* per-widget off flags */, hudMapStyle,
  hud: { v:1, w: { hudSpeed:{dx,dy,k}, ... }, z:[keys], lock:{key:1}, add:[{id:"wN",type,chan,...}], seq } }
```

## Rust IPC (post-5dfa9ac, lib.rs)
```rust
#[tauri::command] async fn read_binary_file(path: String) -> Result<tauri::ipc::Response, String>   // lib.rs:180
#[tauri::command] async fn write_binary_file(request: tauri::ipc::Request<'_>) -> Result<(), String> // lib.rs:199
//   body: InvokeBody::Raw(bytes); header "x-path": percent-encoded destination
#[tauri::command] async fn read_file_range(path, offset: u64, len: u64) -> Result<ipc::Response, String> // lib.rs:323, MAX 8 MiB
#[tauri::command] async fn video_allow(app, path) -> Result<u64, String>   // lib.rs:254, asset-scope grant, returns size
```
JS caller (transport.js:2395-2399):
```js
async writeFile(path, data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  return _tauriInvoke('write_binary_file', u8, { headers: { 'x-path': encodeURIComponent(path) } });
}
```

## Debug/automation handles
`window.__gpMux/__gpDemux/__gpAvc1` overlay:32075-32077; `__gpHud`(=gpHudRender)/`__gpHudData` overlay:30728-30729; `__gpUntaint/__gpTainted` overlay:31327-31330; `__gpRows/__gpCar/__gpDrift` overlay:30718-30727.

## gotchas

- **Report line refs against source files only** — `src/dist/index.html` is generated (ADR-0007); the whole export/HUD block lives in the `#gpWorkspace` IIFE in `src/tauri-overlay.html`; symbols are closure-local except the `window.__gp*` handles.
- **Real time is a fallback, not the design**: the slow path exists for files WebCodecs can't handle (fragmented handled now; codec refusals, reordering encoders). Any background-export design must keep both paths or accept losing those files.
- **The fast path already survives a hidden window** (dequeue-event backpressure, overlay:32226-32254) — the actual blockers for "background export" are (a) the full-screen `.gp-expdlg` modal (CSS overlay:1732), (b) shared mutable closure state (`gp.trace`, `gp.selLap`, `gp.cam.hud`, the tile cache) read live per frame — a user re-selecting a lap or editing the overlay mid-export would change frames mid-file, which the modal currently prevents by construction, and (c) the slow path's dependence on the visible `<video>` element.
- **`gpHudRender` must not be forked** (doc:23-30): tile, editor and export all call the one function; `check_hud.js` pins pixel-identity at two sizes. Two-lap comparison/highlights should feed it different `i`/data, not clone it.
- **Worker port traps**: document fonts (Google Fonts @import, firmware-base.html:10) drive `measureText`-based layout; `new Image()` logo + tile cache and `localStorage` (`rdm7_camera`) don't exist in workers; `__TAURI_INTERNALS__.invoke` is main-thread; tile `onload` calls `gpVideoDrawOverlay`/`setTimeout` (DOM coupling at overlay:29306-29309). CSP permits blob:/self workers, but there is no bundler — a worker ships as a plain file.
- **Canvas taint is the export's landmine**: path videos are CORS-loaded off `asset.localhost` (`gpVideoSetSrc` overlay:28569); map tiles need `crossOrigin="anonymous"` (overlay:29300) — all three imagery hosts verified to send ACAO:*. A single tainted draw kills captureStream and WebCodecs reads silently.
- **IPC bytes**: never return `Vec<u8>` or take `data: Vec<u8>` in a new command — use `ipc::Response` / `Request` raw body (5dfa9ac). `read_file_range` rejects reads >8 MB — the audio copy shipped broken once because of that cap (overlay:32331-2339).
- **Sample entries lie**: QuickTime v1 `mp4a` copied verbatim = silent file that every probe tool reads as fine (doc:503-507); HEVC decoder must be given `codedWidth/Height` or Chromium invents 1280×720 (overlay:31579-31592). "Measuring with a forgiving decoder proves nothing about players."
- **Sound is deliberately not a setting** (regressed twice); a comparison/highlight exporter must keep audio-always semantics or re-fight that battle.
- **Save is one buffer end-to-end**: Blob → `arrayBuffer()` → raw IPC body → `std::fs::write`. A 2 GB export would hold ~3 copies in memory transiently; streaming would need a new chunked command or temp-file append pattern.
- **Timers clamp to 1 s in unfocused windows** — any progress/backpressure logic for background export must use events, not setTimeout (already learned at overlay:32226-32233).
- **Even dimensions required** by H.264 (overlay:30835-30841); keyframes forced every 2 s; encoder-reorder falls back rather than writing ctts.
- **`gp.video.t0 === null` blocks export** with a toast (overlay:30864-30868) — restore paths that can leave t0 null were closed (doc:587-596) but any new entry point must call `gpVideoSyncSet`/fallback the same way.
- Heredocs eat backslashes in this repo's tooling history (memory) — edit JS with Edit/Write, verify with `tools/check_syntax.js`; the JS harnesses (`tools/check_export.js` etc.) are node scripts using the `__gp*` handles.

## open_questions

- `gpStore.putMeta` backing store: the video link fields ride the session meta via `gpStore` (IndexedDB per the workspace's storage layer); I did not trace `gpStore`'s implementation lines in this pass — the calls are at overlay:28416/28427/28447.
- Whether MediaRecorder MP4 (`video/mp4;codecs=avc1…`) is actually supported in the shipped WebView2 build (slow path mime selection at overlay:30805-30810 probes at runtime; no recorded answer found in code or doc).
- The exact drawn content of the minimap's car glyph / lower half of `gpHudMinimap` (read to ~29536; the car marker functions `gpCarGlyph`/`gpSteerAt` etc. at overlay:30722-30726 were not read in full — not load-bearing for the export pipeline).
- No fps-per-frame throughput number beyond the doc's "31.2 s in ~18 s (throttled, hidden)" and "several times quicker than playback" claim in the dialog copy (overlay:30919-30924); no measurement exists for a full-length session export.
- `tools/check_export.js` internals (93 checks) were not read; cited from doc:3-7.
- JetBrains Mono weight 700 is used by the HUD ("700 82px", overlay:30437) but the Google Fonts @import (firmware-base.html:10) loads only 400/500/600 for it — the browser synthesises the bold today; worth knowing before any font self-hosting for a worker, but I did not verify rendering impact.