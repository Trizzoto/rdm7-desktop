# The HUD over the footage, and the export that burns it in

2026-08-31. Where this lives: the `gpHud*` / `gpExport*` / `gpMp4*` block in
`src/tauri-overlay.html`. Harnesses: `tools/check_hud.js` (223),
`tools/check_carglyph.js` (156), `tools/check_hudedit.js` (111),
`tools/check_export.js` (93), `tools/check_untaint.js` (30),
`tools/check_videot0.js` (23) and `tools/check_transport.js` (18).

> Rebuilt 2026-08-31 after a patch script of mine truncated it. The file was
> untracked, so git could not help; the content below is reconstructed from
> the session it documents. If a detail here reads thinner than it should,
> that is why.

## What it is

The 46-pixel strip that used to float over the video tile is now an
instrument cluster: speed and gear, a segmented tacho, throttle and brake
bars, the grip circle, lap time and delta, slip angle, a Need-for-Speed-style
minimap, the track caption and the RDM mark. **Export video** on the video
tile writes footage + HUD out as one MP4 that plays anywhere, and **Customise
the overlay** moves and resizes any of it over a frame of the footage itself.

## The one design rule

There is exactly **one renderer**, `gpHudRender(ctx, W, H, sampleIndex)`, and
every measurement in it is in units of
`S = min(min(W, H) / 720, W / 700)` — **the short side carries the scale**,
whichever side that is. The on-screen tile, the editor and the export call the
same function at different sizes; `check_hud.js` proves a 720p and a 1440p
render are the same picture to the pixel. Do not fork it.

The rule has been wrong twice, in opposite directions. Scaled off height
alone, a 1080×1920 phone video got a 2.7× HUD and the minimap hung off the
side of the frame. Patched to `min(H/720, W/1080)`, the same portrait footage
got a HUD half the size it should be — "not full size", in its owner's words,
on a 1216×1616 iPhone clip. The short side is the invariant. The `W/700` term
is the fit guarantee, derived from the layout's own worst-case row, and
`check_hud.js` pins both failure modes.

Data comes from `gpHudData(i)` — one object per sample, no DOM reads — so the
export cannot disagree with the preview about what a frame shows.

### What the HUD refuses to draw

- A channel `gpChanQuiet()` marks quiet (configured id, no frames ever) gets
  no gauge — a tacho pinned at zero for a whole video is worse than none.
- Slip angle comes from `gpDriftAngle()` only — ADR-0011, never invented from
  the path.
- One pedal present, one absent → only the present one is drawn. An empty
  brake tube beside a live throttle reads as "never braked".
- **An angle the engine will not stand behind is not stated.** The slip
  widget, the minimap wedge and the corner readout all stop at the same
  `GP_DRIFT_ROUGH` gate the Drift readout has always used, and say "rough"
  instead. A greyed number in the app and a confident one burned into a video
  would be the tool disagreeing with itself.

Channels are matched by canonical id first, then by *name* regex — most
sessions are imported VBO/CSV whose columns are just headings like
"Engine RPM". The tacho ceiling is the session's measured max rounded up to
500; a pressure-unit "brake pedal" is scaled to the hardest stop of the
session.

## The mark

Top right, the **real logo** — `rdm_logo.png`, the same transparent 600×275
master the suite topbar draws — with **Studio** written after it.

- **Not `rdm_logo_data.js`.** `_RDM_LOGO_RDMIMG_B64` in that file is the
  RDMIMG *device* image format. It looks like the logo and no `<img>` will
  decode it.
- **Same origin**, so unlike a map tile it needs no CORS and cannot taint the
  export canvas.
- **The export waits for it.** `gpExportRunNow(p, waited)` resolves
  `gpHudLogoReady()` before either path starts. A late image costs the tile
  one repaint; it costs an export the first frames of an 80 MB file, burned
  in. Capped at 1.5 s, falling back to the words. The `waited` flag rather
  than a "has it loaded" test: the promise resolves on the timeout too, and a
  re-entry that asked the record would spin for ever on a missing file.

The cluster is measured then placed from its RIGHT edge, so a re-mastered logo
of another ratio cannot run off the frame.

## The minimap

Track-up, car fixed near the bottom, road rotating around it. The window is
metres walked along the trace (4.8 s of road, 160–700 m). Underneath: the
track outline and the start/finish gate at its real width and angle.

Four grounds (persisted in `rdm7_camera`): `night` (violet plate), `sat`,
`satdim` and `plain`. Satellite tiles are drawn by hand (no Leaflet) with
`crossOrigin="anonymous"` — all three tile hosts answer
`Access-Control-Allow-Origin: *`, so satellite survives into the export.

**The route is the analysis map's own line.** Through the whole window —
ahead of the car as well as behind — `GP_TRACE_WHOLE` (#f2f2f3) at 0.85,
2.4·S wide, over a dark casing `GP_LAP_CASE` wide each side. One constant
colour. No taper, no ramp, no speed and no angle.

It took four rounds, and the wrong lesson was learned twice. The painted road
went 16·S tube → 9·S line → removed entirely, each size asked off in turn, and
after the third the conclusion drawn was "he doesn't want a line". He did.
What he didn't want was **weight** and a second variable arguing with the
picture. Asked once more — "the smaller constant line like what's on the
analyse GPS page, that's a perfect line" — the answer was to stop inventing a
minimap idiom and copy the one already right on the big map.

Nothing on this map may ever take `gpSpeedColour` or `gpAngleColour` again.
The angle belongs to the CAR, which carries the arrow, the wedge and the
number — a WHITE arrow over a dark keyline, the wedge filled with
`gpAngleColour` at 0.55, both behind the map's 10° `GP_DRIFT_ON` gate.

## The overlay designer

"I want it same as the dash layout editor — same layout, same colours,
layers, properties." So it is not a lookalike: `gpHudEdOpen()` mounts the dash
editor's **own** grid and component classes — `.workspace`, `.sidebar`,
`.palette-item`, `.layer-item`, `.field`, `.inspector-group` — and puts the
overlay in them. Reached from the HUD popover and from the export dialog.

**It is mounted on `<body>`, not in `#gpWorkspace`.** That element re-binds
every theme variable to the light Industry ground, so an editor mounted inside
it comes out white. Verified: `#303030` chrome, `#393939` headers, `#2d8ceb`
selection.

**The stage is not a preview, it is the HUD.** It calls the same
`gpHudRender` at the footage's own size over a real frame of the footage,
asking for `opt.rects`. The editor draws exactly one thing of its own: the
selection box.

### Planned, then painted

`gpHudRender` computes every widget's box in **flow order** and then paints
the plan in **layer order**. The flow decides where a widget belongs, the
Layers panel decides what covers what, and **reordering layers never moves
anything**.

`gpHudOrder` is BUILT, not sorted. The obvious comparator (stored rank,
falling back to flow position) is not transitive, and a non-transitive
comparator lets `Array.prototype.sort` return anything. So: everything the
stored order names, in that order, then anything it does not, in flow order —
which also means a widget added later arrives on top rather than vanishing.

### What is stored

```
gp.cam.hud = { v: 1,
               w: { hudSpeed: { dx: 40, dy: -12, k: 1.25 }, … },
               z: ["hudSpeed", …],      // only once something is reordered
               lock: { hudMap: 1 },     // only once something is locked
               add: [ … ],              // widgets made from the recording
               seq: 7 }                 // the id counter, never the list length
```

`dx`/`dy` are a nudge **from where the widget belongs**, in S units; `k`
scales about the widget's own centre.

- **Relative, not absolute** — the default layout is algorithmic.
- **S units, not pixels** — a layout laid out on a 600 px tile must land in
  the same proportional place in a 4K export.
- **Absent means factory**, per key and per field. A widget put back at its
  defaults DROPS its entry.

**Reset all** clears positions, order and locks together.

### The refactor was proved to be nothing

Two proofs: `check_hud.js` renders with no config and with an empty config and
compares the call log entry for entry, and the running app re-rendered a
1216×1616 frame of the real session after the refactor against the same frame
before it — **0 differing subpixels across the whole frame**.

### Traps paid for here

- **`gpCamLoad` copies key by key.** It does not merge, so `hud` had to be
  named in it explicitly, or the layout is dropped on every reload.
- **`gpHudEdStore` must FILL GAPS, never replace.** It read
  `if (!hud || !hud.w) hud = {v:1,w:{}}`, which threw away the made-widget
  list, the layer order and the locks whenever the positions map was absent —
  exactly the shape of a layout with widgets in it but nothing moved yet.
  Found by DRIVING the editor, not by any check.
- **A drag must be measured against the box it started in.** Selecting a
  widget grew the properties rail and shrank the stage *under the cursor*, and
  a 60 px drag arrived as 270.
- **Two 232 px rails leave 74 px for the picture in a 540-wide window.** Under
  900 px the panels stack.
- **The frame is drawn COVER, not stretched.**
- **Controls must re-decide every draw.** The "Footage" preset and the "Import
  from dash layout" row were both decided once at open and became dead
  controls, because the video and the dash layout load afterwards.
- A widget can be dragged clean off the picture; the Layers row says so.

`window.__gpHudEd()` is the debug handle, like `__gpHud` and `__gpMap`.

## The two widgets the overlay grew

- **Slip angle** — the measured angle as its own readout, in the map's ramp
  past the same 10° gate, with LEFT or RIGHT beside it and the ± on the label
  line (beside the number it collided with the direction word at two digits).
- **Track and date** — top left, opposite the mark. The circuit comes from
  **`trackName`** and the date from **`recordedAt`** — the fields a session
  meta actually carries (`id, name, trackId, trackName, recordedAt, dated,
  savedAt, startT, device, samples, durationS, lapCount, bestLapS, lapTimesS,
  lapsBy, corners, chanIds, chanDefs, car, driver`). `track` and `startedUtc`
  were guesses and do not exist.

## The dash's widget set, over footage

The palette has two sections: **Overlay instruments** (the nine with fixed
roles) and **Dash widgets** — the dash's own set, by the same names, with
**the dash's own `PALETTE_ICONS`**:

| type | | needs |
| --- | --- | --- |
| `panel` | Panel | a channel |
| `text` | Text / Value | a channel |
| `bar` | Bar Graph | a channel and a range |
| `rpm_bar` | RPM Bar | a channel and a range |
| `meter` | Meter | a channel and a range |
| `shift_light` | Shift Light | a channel and a range |
| `warning` | Alert Light | a channel, a level, a colour |
| `indicator` | Turn Indicator | a channel and a level |
| `banner` | Alert Banner | a channel, a level, a colour |
| `track_map` | Track Map | a colour, and the session's track |
| `shape_panel` | Shape | a colour |
| `line` | Line | a colour |
| `arc` | Arc | a colour |

**These are not the dash's renderer.** A dash widget is drawn by the firmware
onto 800×480 of known hardware; these are drawn onto whatever the camera shot,
in S units, by the one `gpHudRender`. What carries across is the vocabulary.
Left out on purpose: `toggle` and `button` are things you press, `image` needs
the device's image store, `pathbar` and `anim` are device chrome.

`gpHudMadeNeeds(type, what)` drives both the drawing and the Properties rail,
so a Line is never offered a channel and an Alert Light always gets a level
**and** a direction — "coolant over 105" and "oil pressure under 150" are both
alarms and only one is a maximum.

### The Track Map is not the minimap

Nearly left out on the grounds that "the minimap already does that", and that
was wrong. The **minimap** is track-up and scrolling, a 160-metre window:
*what is the next corner*. The **Track Map** is the whole circuit, north-up,
with a dot on it: *where on the lap is he*.

Same switches as the dash's own — rotation, start/finish tick, the car, its
trail, the track name — and absent means on. **With no track in the library it
draws the line that was DRIVEN.** Only with neither does it say "no track".
Fitted with a single scale on the smaller axis so it keeps its proportions and
stays inside its box at any rotation; pinned at 0°, 45° and 90°.

### Widgets you make yourself

`gpHudChanList()` is what the picker offers: every column that is not
`gpChanQuiet`, each with **the range it actually covered**. The picker shows
the live value beside each name.

They key off the same id as a built-in, so position, size, visibility, locking
and layer order work through existing code. Ids come from a counter, never the
list length: an id keys the position, the lock and the layer order, so reusing
a deleted one hands the new widget the dead one's place. Deleting takes
everything keyed off it.

A widget bound to nothing draws a dash. A confident `0` reads as a
measurement somebody took.

Two things only the full set revealed: every row was called "Value" (named
after its TYPE now), and **an alert that is not tripped draws nothing** —
right in an export, useless in an editor, so the editor alone outlines the
silent ones and labels them "not tripped".

## Importing a dash layout

A dash layout and a video overlay are not the same picture. Copying the
geometry would give a HUD that covers the footage. What carries is the
**thinking** — which numbers this driver chose, what they called them, what
range they set.

- **Matched by name**, three ways in order: exact, containment, then "every
  word of the shorter name appears in the longer". That third pass gets
  `INTAKE_AIR_TEMP` onto a column called "Intake Temp" — while still never
  letting `OIL_TEMP` land on "Coolant Temp".
- **A signal shown twice becomes one widget, and a bar wins.** Taking whichever
  came first in the file turned his real coolant and throttle bars into plain
  readouts.
- **A gauge this recording cannot feed is reported, not invented.**

Measured against his own 26-widget layout: 10 across, one honestly missed.
`window.__gpHudDash(layout, chans)` asks the mapping what it WOULD do without
importing.

## The car marker steers

The front wheels turn. `gpSteerAt` answers with, in order of preference:

1. **A measured steering channel**, matched by name the way every other role
   here is. Nothing beats it and nothing overrides it.
2. **The geometric steer** — `atan(wheelbase × yaw ÷ speed)`, the bicycle
   model's answer for a car that is not sliding. Both inputs are measured.

Plus opposite lock — *minus the slip angle* — **only when the slip angle was
measured** (`d.direct`). Built on the integrated angle it inherits that
angle's errors, and it inherits them where they show: on the 23 Aug Mallala
lap the engine's beta reaches 54°, and the wheels went to **full lock through
every corner** on a car tracking the racing line. Gated, the same lap sweeps
−3.9° to +11.2°.

Below walking pace the wheels point straight ahead rather than dividing by a
speed that is not there, and everything is held to ±38°. The front pair is
**found, not named** — the two wheels with the smallest y — so a car glyph
added later steers without anyone remembering to mark it up.

## …and its tail lights come on

The other half of a marker that reacts. Wheels say where he pointed it; the
tail lights say when he was slowing it down — which on a map is every braking
point of the lap, drawn in the place you are already looking.

Same rule as the steering, in the same order: a **brake pedal or brake
pressure channel** first, matched by the HUD's own role table, because that is
the driver's foot. Failing that, **deceleration** — not the foot, since a lift
is not a brake and neither is an uphill, but measured, and the *same test*
`gpCornerPhases` already uses to find a brake point. Sharing `GP_BRAKE_G` is
the point: the car on the map and the corner table cannot disagree about where
he braked, which they would the moment this invented a threshold of its own.
Full brightness at `GP_BRAKE_FULL_G` (0.75 g).

`gpBrakeAt` returns 0…1, or **null when nothing in the recording knows** —
and null and zero draw the *same*. An unlit lamp is the absence of a claim,
not a claim that he was off the brakes.

**Every car grew tail lights, and most of them already had them.** They only
needed naming, which is what naming parts by role is for: the Skyline's four
round lamps, and the rear panel on the Silvia, AE86, muscle car and police
car, became `brake`. The RX-7 and the wedge got a pair each. The wedge is the
plain arrow with no wheels to steer, so without them the *default* icon would
have been the one car that never reacted to anything.

**The halo fades out as the car grows.** A tail lamp is about one unit across
in a 22-unit car, so at the zoom that fits a whole circuit it is a single
pixel and would not be seen at all; widening the lit lamp is the only thing
that makes it read there. But the same halo on a car drawn at 88 px welds the
Skyline's four separate lamps into one red blob and throws away the reason
there are four of them. So `gpBrakeLamps` takes the pixels-per-unit and lets
the halo fall to nothing by the big end. Verified by rendering all seven cars
lit and unlit at 30, 55 and 88 px through the real stylesheet.

Painted inline rather than by a class, because "how hard" is a number.
Unlit **clears** rather than setting an off colour — what an unlit lamp looks
like is a different thing on the playback car, on a ghost and in a picker
swatch, and only the stylesheet knows which.

### It had to work on the marker almost nobody was looking at

`gpDrawCar` only appears where the slip angle is trustworthy **and** the view
is Drift or Session. `gpDrawHeadMarker` stands in everywhere else — every VBO
import, every pre-gyro recording, every other view. A reacting car that only
turned up on gyro recordings in one view would be a feature almost nobody ever
saw, so `gpCarReact` does the same two things for any marker. Parts are cached
per **element**, not per marker: these markers are rebuilt whenever the artwork
changes, and a cache keyed on the marker keeps handing back parts belonging to
a car that is no longer on the map.

Measured on the 23 Aug Mallala session (25,720 samples): the lights are on for
**11.7%** of it, peak 1.0, and **99% of the lit samples were also losing
speed** with none at all lit while gaining it. Then swept live through 61
scrubber positions on the stand-in marker — 7 that should be lit, 54 dark,
**zero disagreements** between the lamp and the answer.

### The stand-in was wearing the live car's red

Found while wiring it up. `live` is a CLAIM, not a size — the red shell means
"this is where the car is right now" — and `gpCarIcon` hard-coded it.
`gpDrawHeadMarker` borrowed that builder for the PLAYBACK stand-in and
inherited the claim with it, so on every recording without a trustworthy angle
the playhead was drawn in the live colour on a map where nothing was live.
The stylesheet already stated the rule it broke: *the live car wears the live
colour, so "now" and "a lap you drove earlier" are never the same object on
the same map.*

It is a class on a string. A screenshot of a whitish car at 30 px would never
have caught it and nobody looking at it ever did. `gpCarIcon` takes the flag
now, and `check_carglyph.js` pins both call sites as well as the builder.

## The picker demonstrates instead of describing

A still picture of a car cannot tell you the marker does anything. Pointing at
one in Setup drives it through a corner — brake in a straight line, trail it
off as the wheel goes on, hold the lock, unwind — and picking one runs the
same lap once, so the feedback does not depend on the pointer happening to be
over the button already.

It runs through the **same two functions the map uses**, `gpFrontWheels` to
find the steered pair and `gpBrakeLamps` to light the tail. So a car that
demonstrates here is a car that works there, and a glyph whose parts are named
wrong is obvious the moment you point at it. Nothing in it is a measurement,
and it says so: the only numbers involved are the four keyframes in
`gpCarDemoAt`.

The loop stops and **puts the car back** — a car left mid-corner in the picker
is a car the picker is lying about — and a frame already in flight when
another car is hovered gives up rather than drawing over the new one.

### The check that catches the next car somebody adds

Steering and brake lights are found by CLASS, so a glyph whose parts are
unnamed draws perfectly and reacts to nothing — and it would never be noticed,
because it *looks* right. `check_carglyph.js` (156 checks) now reads `GP_CARS`
out of the source and asserts, for every car: it has tail lights; it has four
wheels or none at all; it carries no colour of its own; the wheel finder reads
all four; there is no tie in the middle to make the front pair ambiguous; and
**the steered pair is at the front**, because a car laid out the other way
round would steer with its back axle and nobody would spot it in a screenshot.

## The map got two of the overlay's ideas back

- **Writing stays upright.** Track up turns the whole map element and every
  word on it turned too. `gpDegPlace` composes the label's transform as
  *translate, then rotate by +the map's angle, then scale* — the order
  matters, and written on its own the rotation threw the label back to the
  car's centre at map scale. Two more things had to be right, and both were
  wrong first:

  - **The angle is read off the map ELEMENT, not `gp._tuAngle`.** They are
    written in different places and drift — measured live, the map wore
    `rotate(-94.94deg)` while the stored angle said 270.64, leaving the label
    176° out, which is upside down.
  - **Labels are re-placed AFTER the map turns** (`gpMapLabelsUpright`, called
    from `gpTrackUpApply`). The car is drawn before the map is rotated, so a
    label reading the rotation while being drawn gets the PREVIOUS frame's
    angle — one step stale all the way round the lap.

- **Night came to the big map.** The only ground the minimap had and the map
  did not. It is all in the tile pane's filter — a wash pane does not work,
  because a Leaflet pane is a zero-sized positioned div and `inset: 0` on it
  collapses to nothing. The cycle is dim → full → night → off.

## The export

**Fast (the normal one).** Demux the MP4 ourselves (plain ISO-BMFF sample
tables), feed WebCodecs `VideoDecoder`, draw the HUD on each frame at its own
presentation time, encode with `VideoEncoder`, mux with `gpMp4Build`. The
**audio is copied byte-for-byte**. Measured: 31.2 s of 1080×1920 in ~18 s in a
throttled hidden pane. Honours tkhd rotation and the file's real frame rate.

**Fragmented MP4 goes through the fast path too.** `gpFmp4Scan` walks the file
through a 64 KB window, reads every `tfhd`/`tfdt`/`trun`, and rebuilds one
table. All three `tfhd` base-offset cases are handled by name, because
guessing wrong does not fail — it feeds the decoder video from the middle of
some other sample.

**HEVC decodes too.** `gpHevcCodec` builds the codec string from the `hvcC`
(compatibility flags **bit-reversed**) — `hvc1.1.6.L123.B0` for a 4K iPhone.

**The decoder is TOLD the frame size.** `codedWidth/codedHeight` come from the
VisualSampleEntry (bytes 32/34). Given only a codec string and an `hvcC`,
Chromium answered a 1216×1616 file with `displayWidth 1280×720` and
`drawImage` sampled that imaginary rectangle — every HEVC export was a smeared
ruin while the demux, the codec string, the tkhd matrix and the muxed output
all checked out healthy. Nothing in the pipeline validated the PICTURE; the
person watching it did.

**Sound is not a setting at all.** Got wrong twice, so there is nothing left
to get wrong: `gpExportPlan` returns `audio: true` unconditionally and the
dialog has no Sound row. First it was tied to `el.muted` — a viewing
preference silencing every export. Then it was a dialog row, default on —
still a control that can sit on the wrong answer when you press Start.

A source with no usable audio is handled by the source: `gpCopyAudio` returns
null and the toast says **why** — "the camera did not record AAC". Plain "no
sound" reads as the exporter having dropped it.

**The real-time path must not record a MUTED element.** `captureStream()` on a
muted element hands back a silent track — the track exists, ffprobe reports
stereo 48 kHz, and every sample is zero. Since the tile is muted by default,
every slow-path export was silent in a way that looked fine from outside.
`gpExportSlow` unmutes for the recording and restores `wasMuted` on every
exit.

**Slow (the fallback).** captureStream + MediaRecorder in real time, only for
a codec WebCodecs will not decode, an encoder that reorders, or an unreadable
file. 6-second stall watchdog.

## The sound description is REBUILT, not copied

An iPhone `.MOV` carries a QuickTime **version 1** sound sample entry: the
standard 28 bytes, then 16 QuickTime-only fields, and the decoder config
(`esds`) inside a `wave` atom instead of as a direct child. "Copying the sound
losslessly" meant putting those 143 bytes back unchanged — into a file branded
`isom`.

A strict ISO demuxer reads the 28-byte header, looks for a child box, finds
the extension fields where a box should be, never locates an `esds`, and never
gets an AudioSpecificConfig. No decoder config, no decoder, no sound — from a
track that is otherwise perfect.

`gpAudioEntryIso` rebuilds it as a plain version-0 entry with the `esds`
lifted out of the `wave` (v0/v1/v2 handled; compression id `0xfffe` cleared;
rate written 16.16 by multiplication, not a 32-bit shift). The SAMPLES are
still copied byte for byte. An entry with no `esds` anywhere is refused, the
same rule that refuses `lpcm`.

**What this cost, and the lesson.** ffprobe, `volumedetect`, an envelope
correlation against the source, Chromium's `decodeAudioData` and Windows Media
Foundation all read the malformed file happily — every one handles QuickTime
and ISO in the same demuxer. **Measuring a file with a forgiving decoder
proves nothing about whether a player will play it.**

**The audio copy reads in windows, never one span.** Interleaved audio spans
99.7 MB on a one-minute iPhone clip, and `read_file_range` caps a read at
8 MB. A 4 MB window walks the interleave.

**The last frame has no next frame.** Guessing its duration from average fps
put a 16.0 s clip out at 17.0 s; it is taken from the source.

Saving goes through `gpSaveVideoBlob`: the OS save dialog + `RDM.writeFile`
under Tauri, `<a download>` in a browser.

## The origin the footage is served from

Under Tauri a video opened **by path** is served from `asset.localhost`, a
different origin — so drawing it into a canvas taints the canvas, and a
tainted canvas hands frames to neither MediaRecorder nor WebCodecs.

**The video element asks for CORS** (`gpVideoSetSrc`, before the src, path
videos only). Tauri's asset protocol answers every request — ranges included —
with `Access-Control-Allow-Origin: <the window's own origin>`, and `Range` is
CORS-safelisted. If a runtime stops sending that header the element fails to
load rather than loading tainted, so the attribute is dropped and the load
retried once.

`gpUntaintVideo` is now only that fallback's fallback — capped (300 MB), timed
out (30 s), cancellable. It used to be the normal path, and it was **the
export hanging**: 49.6 s on a 128 MB clip.

## Bytes over the IPC, in both directions

| | before | after |
| --- | --- | --- |
| `read_binary_file`, 128 MB | 49.6 s (`Vec<u8>` → JSON array out) | **3.1 s** (`ipc::Response`) |
| `write_binary_file`, 20 MB | 11.4 s (`data: Vec<u8>` → JSON array in) | **0.55 s** (raw request body) |

The write direction sends the `Uint8Array` **as the payload** — Tauri posts it
as `application/octet-stream` so it arrives as `InvokeBody::Raw` — with the
destination in a percent-encoded `x-path` header.

## Gotchas that cost time once already

- `L.tileLayer(…, { pane: undefined })` crashes Leaflet — present-but-undefined
  overrides the default.
- The harness canvas stub must parse the *px* out of `ctx.font` — "700 82px"
  starts with the weight.
- Backpressure waits on the codecs' `dequeue` event, not `setTimeout` — timers
  clamp to 1 s in unfocused windows.
- MP4 wants even dimensions; the muxer's stts is run-length.
- **A wedged IPC does not look like a wedged IPC.** When a stage stalls with
  no error, time a trivial command before blaming the stage.
- Instrumenting `__TAURI_INTERNALS__.invoke` from a probe silently does
  nothing — the property is not writable.
- A promise with only a success listener is a hang with no error message.
  Every wait here settles on `error` and on a timer, and the harnesses race
  each one against a HUNG sentinel.

## "Export says Lap 2 but the footage isn't lap 2"

The exporter was innocent: the LAP TABLE had been silently destroyed.
`gpSessionLoad` re-splits laps on every open and heals the stored numbers, but
relied on `_gpOpen` having loaded the track library. Open a session straight
after a page load and the split ran against `gp.tracks = null`: laps fell back
to the stops, and the heal block **persisted** that downgrade.

Two fixes: `gpSessionLoad` calls `gpTracksReady()` itself, and the heal block
refuses to overwrite stored gate-timed laps when `meta.trackId` names a track
the library doesn't have.

## Who drives the replay

- playhead **inside** the footage → the video is the transport
- playhead **outside** it → the index ticker is, and nothing jumps
- the ticker **walks into** coverage → the video takes over on that tick
- the footage **ends** first → `ended` hands back to the ticker
- a `play()` the webview refuses → the ticker takes the clock back

Pinned by `check_transport.js`, mutation-tested against the original
snap-to-video bug.

## Where the footage sits in the recording

`gp.video.t0` is the UTC moment of the video's first frame. Two routes to a
null t0, both closed (`check_videot0.js`):

- **`gpCurSessionMeta()` returned null for a recording that was open.** The
  loader stashes the meta in `gp.sessionMeta` and the lookup falls back to it.
- **`gpVideoSyncSet` refused silently.** It returns a boolean now, and the
  restore falls back to the start of the recording — without persisting the
  downgrade, and *after* the nudge is restored.

## Verified, not assumed

Rotation goes end to end: a 1280×720 file with a 90° matrix in its tkhd
exports to 720×1280 with the edge markers where the player puts them.

**The whole thing, on a real session.** Mallala 23 Aug 2026
(`ses_mtdnct186rr`, best 2:16.091) with its linked `IMG_0726.MOV` — 69.5 s of
1216×1616 `hvc1` iPhone footage. Fast path, saved as an H.264 MP4 that ffprobe
reads back at 1216×1616 at the source duration exactly, with stereo 48 kHz AAC
correlating 0.949 against the source at zero lag.

The muxer and demuxer are checked against each other in node — including a
fragmented file built from the spec — and against every real video file on
this machine: QuickTime `.MOV` with `wide`/`mdat`/`moov` ordering, one with no
`ftyp` box at all, `mdat` before `moov`, and a Windows Camera `.mp4` behind
`uuid` and `pdin` boxes.

## Not done

- `sidx`/`mfra` indexes are ignored; the fragment walk reads every moof in
  file order instead.
- **The slip angle itself is not trustworthy on real recordings.** See
  `STUDIO_IDEAS_2026-08.md` §1: the engine is accurate to under 3° on
  synthetic data and produces ±50° phantoms on the Mallala lap, because
  nothing calibrates the puck's gyro. The HUD refuses to state a rough angle,
  but the underlying number still needs the instrument chain fixed.
