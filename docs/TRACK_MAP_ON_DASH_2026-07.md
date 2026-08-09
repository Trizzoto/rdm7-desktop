# The track on the dash — design notes

> **ADR-0028, 2026-08-09 — one track library, and circuits arrive with their
> shape.** The Tracks rail held two lists: your saved tracks, and a circuit
> picker beneath them. Opening the same circuit twice put two of it in the
> upper list while the lower one still offered it a third time, and every
> entry in the upper list was a copy of something the lower list already
> named. Double dipping — so there is one list now.
>
> A circuit **is** a library entry. Opening one adopts it in place: the record
> is keyed by `place` (the GP_PLACES id) rather than a fresh uid, so "open
> Winton" twice is the same Winton, and the entry stays where it was in the
> list with your sector count where the region tag used to be. The only
> division left is **Your own** — tracks you drew from scratch, which cannot
> be found any other way — above **Circuits**, which is always one search
> away. Adopted circuits sort to the top of Circuits so the cap can never
> hide the one you have put a line on, and the row shows *your* name for it
> once you have renamed it.
>
> Tracks made before `place` existed are matched back by name, including the
> names that shipped before a circuit gained configurations (`GP_PLACE_WAS`) —
> otherwise a Winton lap recorded last month would land under Your own, the
> one place it does not belong.
>
> Circuits now ship with geometry (`GP_SHAPES`, keyed by place id): 21 layouts
> across 12 Australian venues, taken from OpenStreetMap's raceway ways and
> simplified through `gpOutlineSimplify` itself, so a built-in shape and a
> traced one are the same kind of object everywhere downstream. Each
> configuration is a closed cycle over the site's way graph, identified by
> measuring it against the published length — that check is what separates
> "this is the International Circuit" from "this is a loop of roughly the
> right size". Still **no start/finish line**: a gate has to go on the real
> paint, and the shape does not change that.
>
> A circuit adopted before its shape shipped keeps its gate and gains the
> outline on load — additive only. A shape you traced, or took off a lap you
> drove, is yours and beats the survey.
>
> © OpenStreetMap contributors, ODbL. `outline.src` carries `"osm"` so the
> readiness card can print the credit where a person actually reads it.

Status: **plan only, nothing built** · 2026-07-31

The ask: draw a track outline in Studio by tracing the map, push it to the
RDM-7 along with the track's name, show it on the dash, and eventually put a
live "you are here" dot on it.

---

## 1. The two things that make this much smaller than it sounds

**`widget_pathbar` already draws an arbitrary polyline.** It stores a flat
`[x0,y0,x1,y1,…]` point array in the layout JSON, heap-allocates it in
`from_json`, optionally treats the authored points as anchors and tessellates
a Catmull-Rom spline through them, and draws a fill along the path up to a
value with a bright leading cap. A track map is that widget with geographic
points and a marker driven by position instead of a fill driven by RPM. The
renderer, the JSON plumbing and the memory pattern are all proven in the
firmware already.

**The dash already has 25 Hz position.** `lap_engine_on_can_frame` receives
every GPS frame in arrival order, and the puck broadcasts lat/lon on
`base+0x1` at 25 Hz. Nothing new is needed on the wire to know where the car
is.

So this is mostly a **data-modelling and authoring** job, not a rendering or
protocol job.

### Precision, settled early

Signal-path floats quantise latitude to ~1.7 m (that is why the lap engine
takes the raw int32 separately). For a marker on screen that does not matter:
a 6 km circuit in a 400 px widget is ~15 m per pixel, so 1.7 m is **0.1 px**.

**The dot can bind to the ordinary GPS channels like any other widget.** No
new high-precision path, no new plumbing. Worth writing down because the
instinct is to reach for `lap_engine`'s int32 and that would be a needless
new API.

---

## 2. Where the shape comes from — three sources, and the best one is free

| Source | When you'd use it | Effort |
|---|---|---|
| **A recorded lap** | You have driven the track | Nearly zero — it already exists |
| **Tracing the map** | You have not driven it yet | The tool they asked for |
| **Import** (GeoJSON/GPX) | Someone else's file | Small |

The first one deserves emphasis: **a 25 Hz trace of a driven lap *is* the
track outline.** `gp.trace` + `gp.traceLaps` already hold it, already
snapped to the real driven line, already at the right place on Earth. Take
the best lap, simplify, done — no tracing, and it is the line the car
actually takes rather than a hand-drawn approximation of the tarmac.

So the tracing tool is for the *before you have driven it* case, and
"derive from my best lap" should probably be the headline button.

Both feed the same simplifier: **Ramer–Douglas–Peucker** to a tolerance of
about 1 px at display scale. A 400 px-wide widget cannot resolve more than a
few hundred distinguishable points; typical circuits should land at 150–300.
Cap it around 512 and say what was dropped.

---

## 3. The one real design decision: store geography, not pixels

`pathbar` stores absolute screen pixels. **The track map should not.** Store
the points as geography (i32 1e7 lat/lon, same encoding as the wire and the
trace format) plus a transform, and project once at layout load.

Reasons, in order of weight:

1. **The live dot demands the projection anyway.** The dash must be able to
   turn a lat/lon into a widget pixel every frame. Once that function exists,
   storing pre-projected points is a *second* representation of the same
   truth — exactly the kind of thing that drifts.
2. **Resizing the widget re-fits the track for free.** Pixel points would
   have to be re-authored every time the box moves or the screen preset
   changes.
3. Projecting ~300 points once at load is nothing on an S3 with an FPU.

### The projection

Local tangent plane is more than enough at track scale:

```
x_m = (lon − lon0) · cos(lat0) · 111320
y_m = (lat − lat0) · 110540
```

Then rotate by `rot`, scale by `px_per_m`, offset to the widget centre. Error
against a proper geodesic over a 6 km circuit is well under a metre — two
orders of magnitude below what a pixel represents.

Stored transform: `lat0`, `lon0` (i32 1e7), `rot` (degrees), `px_per_m`
(float), and the widget-relative centre. Studio computes `rot` and
`px_per_m` by fitting the rotated bounding box into the widget box with a
margin, so "make it fill the box nicely" is authoring-time work the dash
never repeats.

---

## 4. How it gets to the dash — as an asset, not as a layout edit

This is the part worth getting right, because the obvious answer is wrong.

**Obvious:** put the points in the `track_map` widget's config. Then "push
the track" means editing the active layout and re-applying it. Change
circuits on a track day and you re-push your whole dash design.

**Better:** make the track outline a **named device asset**, exactly like an
image. The dash already has `POST /api/image/upload` writing RDMIMG files to
LittleFS, and widgets reference images by name. Mirror it:

- `POST /api/track/upload?name=<name>` → an `RDMTRK` file in LittleFS
- the `track_map` widget holds a **track name**, not geometry
- pushing a track is one action that touches no layout at all
- several tracks can live on the device; switching is a one-field change,
  or eventually automatic

The name travels **inside** the asset, which is what makes "push the shape
and the name together" a single gesture — precisely what was asked for.

### `RDMTRK` sketch

```
magic "RDMTRK" | u8 version | u8 flags
char name[32]                        ← what the dash prints
i32 lat0_1e7, lon0_1e7               ← projection origin
u16 n_points
i32 lat_1e7, lon_1e7  × n_points     ← the outline
(then, optionally: start/finish + sector gate positions)
```

Binary rather than JSON, to match RDMIMG and to keep the on-device parse
trivial. ~300 points ≈ 2.4 KB. If size ever bites, delta-encoding
consecutive points shrinks it a long way, but it will not bite at this size.

Carrying the gates in the same file is worth considering: the dash could
then draw the start/finish line and sector marks without a second source.
Note that these are the *same* gates the puck holds for timing — one origin
in Studio's track library, two consumers with different needs (the puck
times against them, the dash draws them).

### Not to be confused with the puck's track

The puck holds gate geometry so it can time laps with no laptop. The dash
would hold an outline so it can draw. Same library in Studio, different
payloads, different transports, different reasons. Keeping them clearly
separate avoids a tempting-but-wrong "just send the puck's track to the
dash".

---

## 5. Where each piece is authored

The placement rule that said device-config UI must be authored in the
firmware editor was **retired** by `STUDIO_SHELL_PLAN_2026-07.md` §2.0
("the device serves an API; clients are separate products"). So:

| Piece | Repo | Why |
|---|---|---|
| Tracing tool, simplifier, derive-from-lap, preview, push | **rdm7-desktop** (`tauri-overlay.html`, GPS workspace) | It needs the Leaflet map and the recordings, both of which are already there and desktop-only |
| `widget_track_map.c` renderer | **RDM-7_Dash** | It is a C widget |
| `WIDGET_DEFS` entry | **RDM-7_Dash** (`main/web/index.html`) | WIDGET_DEFS arrives via the firmware base and is guarded by firmware CI (desktop `CLAUDE.md`) |
| `/api/track/upload` + LittleFS store | **RDM-7_Dash** | Device API |

Clean split, no sync obligation beyond the existing WIDGET_DEFS pipeline.

---

## 6. Phasing

Each phase is worth having on its own, which is the test of whether the
split is honest.

**Phase 1 — Studio owns a shape.** Add `outline` to the track object in
Studio's library. Two ways to fill it: *derive from a recorded lap* (do this
first — it is nearly free and immediately useful) and *trace on the map*.
Simplify, show the point count and the size it will be, draw it in the
Tracks view. **Nothing touches the dash.** Deliverable: your tracks have
shapes, and the analysis views can already use them.

**Phase 2 — the dash draws it, statically.** `RDMTRK` + upload endpoint +
`widget_track_map` rendering outline, name, and start/finish. Deliverable:
the track is on the dash.

**Phase 3 — the dot.** Bind GPS lat/lon, project, draw. Decide raw vs
snapped (below). Deliverable: you can see where you are.

**Phase 4 — the good stuff.** Sector colouring, a fading trail, the best
lap's line under the current one, auto-rotate so the car always points up,
dimming the parts of the lap you have not reached yet.

---

## 7. Open questions — worth deciding before Phase 1

1. **Raw dot, or snapped to the line?** Snapping to the nearest polyline
   segment keeps the marker on the drawn track (it will otherwise wander a
   few pixels off on GPS noise), and it yields *distance around the lap* for
   free, which is what any progress or delta readout wants. Costs ~300
   segment tests at 25 Hz — trivial. I lean snapped, with the raw position
   available underneath.

2. **Auto-fit and auto-rotate, or hand-placed?** Auto is right for a first
   version — the whole point is that you trace and it looks correct. A
   manual rotation override is a small field to add later.

3. **One track on the device, or a small library?** The asset model makes
   several nearly free. The interesting follow-on is whether the dash can
   pick the right one automatically — the puck already knows which track it
   is timing, so a name match could select the outline with no user action.
   Worth designing toward even if v1 is manual.

4. **Does the outline become part of the track library's export/import?**
   It should, or shared tracks arrive shapeless.

5. **What does the dot do when the fix drops?** This matters more than it
   sounds: a live map makes a GPS dropout *visible and annoying* in a way a
   lap counter does not. Given the receiver wedge is still unsolved
   (`gnss-uart-wedge`), the widget needs a defined stale state — freeze and
   grey out after N ms, rather than a marker sitting confidently in the
   wrong place.

---

## 8. Risks

- **Point budget vs. LittleFS and heap.** Small at 300 points; needs a hard
  cap and a visible count so nobody pushes a 20 km Nordschleife trace at
  25 Hz (52,000 points) and wonders why the dash is unhappy.
- **The tracing UX is the actual hard part.** Not the maths — drawing a
  smooth closed loop over satellite imagery with click, drag, insert,
  delete, undo and close-the-loop is a real interaction to get right. The
  derive-from-lap path sidesteps it entirely, which is the main argument for
  building that first.
- **Screen presets.** `CANVAS_W` is 800 by default but presets exist;
  storing geography rather than pixels means this costs nothing, which is
  the third reason for §3.
