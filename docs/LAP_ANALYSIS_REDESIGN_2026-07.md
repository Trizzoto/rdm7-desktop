# Lap recording and telemetry analysis — the redesign (2026-07-29)

> **ADR-0027, 2026-08-09 — a corner does not care where the timing line is.**
> Corner detection ran strictly between a lap's own two crossings, so a corner
> sitting on or near the start/finish was invisible: its apex fell inside the
> one-second guard band at one end of the lap and its approach was in the
> other lap, and neither lap could see a minimum with real trace on both sides
> of it. Tested against a synthetic six-corner circuit with known radii and a
> gate 30 m past an apex — an utterly ordinary placement — the assessment
> reported **five corners and never mentioned the sixth**. Everything it did
> say was correct, which is what made it dangerous.
>
> The scan now reaches 300 samples past both ends of the lap, as far as the
> samples stay contiguous, and a corner is claimed by the lap it was **entered**
> in. Entry rather than apex because a slow corner holds its apex speed for a
> second or more, so the detected minimum wanders inside that plateau: with a
> line placed on such an apex the same corner fell either side of it lap to
> lap, and the assessment reported seven corners on one lap and five on the
> next. A braking point does not wander.
>
> A corner that genuinely straddles the line keeps its whole geometry — apex,
> minimum speed, brake point, and the map framing — but only the seconds on
> this side of the line count towards this lap, and the table says so rather
> than calling half a corner "on pace". Without that clip the exit was driven
> at the *next* lap's pace on both sides of the comparison, and a lap followed
> by a slow one showed a loss in a corner it had actually driven better —
> +0.20 s in a corner on a lap that was six tenths quicker.
>
> Verified by running the shipped `gpSplitRows` / `gpFindCorners` /
> `gpCompareLaps` against generated laps of known geometry, from five different
> start/finish placements (mid-straight, just after an apex, exactly on the
> tightest apex, exactly on a fast apex, mid-braking-zone). All five: six
> corners on every lap, the same six in the same order whichever lap is the
> reference, none dropped by the position match across all 12 lap pairings,
> and swapping the two laps negates every corner delta to within one sample.
>
> **ADR-0026, 2026-08-09 — Analyse is a mosaic, and it may be taller than
> the window.** ADR-0025 made Analyse a grid of panels you arrange. Three
> things were wrong with it once it was full of real panels.
>
> *It was giving a fifth of the window to chrome.* A 34 px band said "No RDM
> GPS connected" — true, and irrelevant to reading a recording already on
> this PC — and a 41 px band under it carried the track name, the session
> line, the tags and four arrangement controls. The facts now live in the
> black bar's own slack, which was empty; the arrangement controls live
> behind one **Arrange** button; the hint is suppressed in Analyse. Add the
> add-a-row banner (35 px) and the per-row add-a-panel column, and the
> panels got **88 px and a column back** — at 800 px tall that took each
> panel in a quad from 223 px to 329 px.
>
> *Rows always won.* The model was strictly row-major: a row spanned the
> full width, and a column could only ever be as tall as the row it was in,
> so "a map down the left with a graph and the lap times stacked beside it"
> could not be described. It is now a nested tree — a node is a panel or a
> split of other nodes — and every panel carries **Split left/right** and
> **Split top/bottom**. A `TOWER` preset ships the arrangement that used to
> be impossible. v1 arrangements and v1 saved layouts convert on read.
>
> *Panels could be re-typed but not re-placed.* Getting the video from the
> bottom row to the top meant changing two dropdowns and hoping. Panels are
> dragged by their header now: drop on the middle of another to swap the two,
> or on an edge to put the panel on that side of it — which is the only route
> to moving a panel out of one row and into another. Held near the top or
> bottom of a scrolling grid, the drag scrolls it, since the destination is
> exactly what may be off screen. Escape, a lost pointer or a window blur all
> cancel.
>
> *There was nowhere to put a fifth panel.* Panels now have a floor
> (`GP_ROW_MIN`), a row is never shorter than what it holds, and the grid is
> its own scrollport. **When adding a row would put something below the
> floor, the page extends below the fold and scrolls instead of squeezing** —
> which is the whole answer to "compress or scroll". Dragging a divider
> takes height from the next row, and from the one after it when that one is
> already at its floor, all the way down; past the bottom the page grows.
> Drag back up and it sheds the overflow first, so it snaps back to fitting.
>
> Three rack bugs went with it. **Combined drew only the analysed lap** —
> ticking two laps and switching to Combined silently dropped one; the other
> ticked laps now draw dashed on the same scale. **Combined printed no
> magnitudes at all**, and its gutter legend dropped any channel whose row
> fell past the bottom of a short panel, which is why RPM could be ticked and
> nowhere to be found; the legend now lays out to fit and carries each
> channel's own scale. **Stacked drew the analysed lap in the channel's
> colour while the legend gave it a lap colour**, so Lap 1's swatch was dark
> red and its speed trace was black; with more than one lap on the rack,
> colour means the lap, and the legend says which rule is in force.
>
> **Status 2026-08-09:** The workspace now wears the brand (ADR-0024,
> `RDM-7_Dash/docs/adr/0024-the-lap-timer-wears-the-brand.md`): Industry
> light ground, black brand bar, Barlow type, RDM red as the only accent,
> and six flat views — Sessions (library landing), Live, Analyse,
> **Corners** (every corner ranked by time lost, on the coach engine),
> Tracks, Setup. Sourced from the claude.ai/design "RDM Studio Redesign"
> project, turns 2–4. Everything below this line predates that skin and
> still describes the machinery underneath it.

> **Status 2026-07-30:** Stages 0–4 built and verified live (Stage 3's
> live-bus bit-extraction still wants a moving car). Stage 4 shipped with
> the split-times grid, stats, ideal lap and click-to-zoom. The same pass
> fixed the seams the plan missed: the node's track is now part of the
> readiness checklist (ADR-0015), confirm dialogs actually gate
> (ADR-0015/0016), gates snap onto the driven line, and a dead receiver
> reports as dead.
>
> Channels then got their own surface — one list, a **Log** tick and a
> **Graph** tick, in Setup and in a popover over the rack (ADR-0017) — and
> stopped needing an RDM dash: a definition can come from a dash, a DBC
> file, or be typed in (ADR-0018). Recordings now keep their channel
> columns through a save, a reload and an export.
>
> Stage 5 landed too: sectors can be named, the name lives on the gate that
> opens the stretch so every edit stays correct, and gates are now kept in
> the order the car crosses them (ADR-0019).
>
> **All five stages are done.** The one thing still unverified is the puck's
> bit extraction against a live bus — everything around it is proven on
> hardware, but reading real frames needs a moving car or a real CAN source.
>
> **Setup pass, same day (ADR-0020).** Stage 1.4's checklist was right about
> what to check and wrong about where to put it and how much of it to say.
> It now leads the Session aside as a single line — *Ready to record ·
> Winton · 11 sats* — that expands only when it has something to report, and
> collapsed it lists nothing but the failing rows and their fix buttons.
>
> The same pass retired a genuine falsehood: **Record was never a
> prerequisite.** `s_recording` defaults to true in `trace_log.c` and is not
> persisted, so the puck logs from power-on and writes above 8 km/h with no
> laptop attached — yet three places in the product told you to press Record
> before driving, and the checklist graded a correctly-logging puck as not
> ready. Record's two jobs are now two buttons: **Watch live** (Studio only)
> and **Pause logging** (for the bench). Tracks gained a course-type segment
> and a three-step strip, so *circuit or time trial* and *what is left to do*
> are stated rather than inferred.

Sourced from the Race Studio 3 manual (structure and vocabulary only — no code,
no assets, no wording lifted) and from what the RDM hardware can already do that
AiM's cannot.

---

## The finding that comes before the plan

**The app you have been launching has no recording in it.**

`src/dist/index.html` was built today at 18:45. It contains `ltAnBuildSession` —
the synthetic lap simulator that draws a warped ellipse and invents four laps.
It does not contain `gpBuildSessionRail` or any part of the real GPS workspace.

The real work exists. It is 38 commits on `claude/xenodochial-bhabha-883b42`,
branched from master's current tip, also pushed to origin:

| What | Where |
|---|---|
| Session recording, kept in IndexedDB | `f4c9fe6` |
| Metric / imperial | `e1ac3d5` |
| CSV and `.rdmsession` export | `3a3ae52` |
| Per-track history across sessions | `49fa0ad` |
| 108 circuits, searchable | `af45771` |
| Compare against another day | `955ddad` |
| Video beside the data, clock-synced | `88d3616` |
| 30 further fixes and refinements | through `a70ced1` |

So "I haven't been able to properly record a lap" has a mechanical cause before
it has a design cause: the code that records is not in the binary being run.
Nothing below matters until that branch is on master.

---

## What the redesign has to fix

Three separate problems, in the order they block each other.

| # | Problem | Symptom |
|---|---|---|
| 1 | Recording is a thing you must know how to do | Press Record, pick a track, place a line — miss any one and you get zero laps and no explanation |
| 2 | Channels are stacked, never combined | Nine separate lanes. No way to put speed and throttle on one set of axes and see them against each other |
| 3 | The only channels are GPS ones | Throttle, brake and steering are placeholders that say "waiting on CAN". The car is broadcasting them right now |

---

## Stage 1 — Recording that happens whether or not you know how

Every logger worth the money records by itself. On an AiM box you never press
Record; it arms on speed and closes the session when you stop. That single
behaviour is the difference between "I got 14 laps" and "I forgot to press it".

**1.1 Auto-arm on the node.** Start logging when speed holds above 15 km/h for
3 s. Close the session after 90 s below 5 km/h. Session boundaries go in the
ring's sector headers, so one download can carry a morning of separate runs.
Configurable, defaulted on, and the manual Record button stays for the bench.

**1.2 Recognise the track by itself.** On load, match the first valid fix against
the 108-circuit library; nearest inside 3 km wins. Today lap splitting silently
depends on the right track being selected by hand — an invisible prerequisite.

**1.3 Propose the start/finish line.** For a circuit that is not in the library,
find the loop closure in the trace — the first sample that returns within 25 m of
an earlier one on a similar heading — and put a perpendicular gate there. Show it
on the map and let it be dragged. This is the single largest cause of "it
recorded but there are no laps".

**1.4 Turn Record into a readiness panel.** Not a button: a live checklist where
every row is a fact and every failing row carries the action that fixes it.

| Row | Reads |
|---|---|
| Puck | Seen on USB / not seen |
| Fix | 3D, 11 satellites, 0.8 m |
| Track | Winton, matched automatically |
| Start/finish | Placed, or "propose one" |
| Storage | 4.9 MB free, 148 minutes |
| Recording | Armed, waiting for 15 km/h |
| Laps so far | 6 |

**1.5 Say it in the car too.** The node already broadcasts lap, sector and delta
on `0x407`–`0x409`. Add recording state, so the dash can show that it is logging
without a laptop present.

**Done when** a puck is plugged in, the car is driven, the puck is plugged into
Studio, and laps appear — with nothing pressed and nothing configured.

---

## Stage 2 — One graph, with a draggable window under it

This is Race Studio's Time-Distance panel and its StoryBoard, and it is the right
shape. Today's lane rack is RS3's *tiled* mode and only that.

**2.1 Overlaid mode, and make it the default.** Every chosen channel on one set
of axes, each keeping its own vertical scale, colour per channel. When two laps
are compared, RS3's rule inverts: colour identifies the *lap*, line style
identifies the channel — otherwise four traces in four colours across two laps is
unreadable.

**2.2 The navigator strip.** Below the main plot, the whole lap (or the whole
session) drawn small, with a selection window you drag to pan and resize to zoom.
The main plot follows it. Double-click a sector band in the strip to fit that
sector exactly.

**2.3 Three plot modes.** Overlaid, Tiled (today's rack, kept as-is), and Mixed —
channels assigned to up to six sub-plots, so brake and throttle can share one
frame while RPM has its own.

**2.4 Distance or time on the x-axis.** Distance is what makes two laps
comparable; time is what makes one lap's video line up. Both, toggled.

**2.5 Channel tags.** A value box per channel showing its reading at the cursor.
Click one and its trace thickens and its minimum, maximum and average appear,
marked where they occurred.

**2.6 One cursor.** The graph, the map, the video and the split table all move
together — already true for the first three, and it stays true as panels are
added.

---

## Stage 3 — Telemetry from the car's own bus

This is the part no GPS lap timer in the price bracket has, and RDM gets it
nearly free: the dash has already decoded and named every channel on the bus.

**3.1 The dash's channel list is the configuration.** `GET /api/channels`
returns each active channel with its CAN id, bit layout, scale, offset and unit.
Studio reads it and offers the list. Nothing is typed twice; the DBC import work
already landed feeds straight into this.

**3.2 Pick what to log, with the cost shown.** Each channel adds 2 bytes per
sample. The picker states the running total and what it does to recording time —
8 channels at 25 Hz turns 370 minutes into about 152. That is a trade the user
should see while making it, not discover afterwards.

**3.3 Trace format v2.** A 12-byte GPS block plus N two-byte channel slots. The
sector header carries the channel table, so a downloaded session describes itself
and an old recording still reads back after the selection changes.

**3.4 The node sniffs the bus.** `can_node_receive()` already exists. Keep the
last value for each configured signal and sample it alongside the GPS fix. No
new hardware, no new wiring — the puck is already on the bus.

**3.5 The placeholders fill in.** Throttle, brake and steering stop saying
"waiting on CAN" and become real traces. The corner-phase attribution that today
infers braking from speed gets the actual pedal.

**3.6 The IMU as well.** Roll, pitch and both accelerometers are already computed
and broadcast; they are simply not written to flash. Same format change.

---

## Stage 4 — The split times report

The table Race Studio leans on hardest, and the one place a lap time turns into a
decision. Laps down the side, sectors across the top, each cell coloured from
best to worst.

Statistics rows beneath: average, median, standard deviation (that is
consistency, stated as a number), best theoretical (every sector at its best, a
lap nobody drove) and best rolling (the fastest lap actually driven, not
necessarily line to line).

Click a sector's column and the graph and map both zoom to it.

---

## Stage 5 — Splits you name

Sectors are thirds today. RS3 lets each split be placed, merged, divided, named
and typed — corner entry, corner exit, straight. That is the difference between
"you lost 0.3 s in sector 2" and "you lost 0.3 s on the exit of Turn 4", and it
is what makes the corner-phase work already in the branch legible.

---

## Order, and why

| Stage | Why here |
|---|---|
| 0 — land the branch | Everything below is an edit to code that is not on master yet |
| 1 — recording | Nothing can be analysed that was never captured |
| 2 — the graph | Works on GPS channels alone; does not wait on firmware |
| 3 — CAN channels | Spans two firmware repos; the graph must exist to show them in |
| 4 — split report | Wants stage 3's channels to be worth tabulating |
| 5 — named splits | Cosmetic until 4 exists to name things in |

Stages 2 and 3 are independent of each other and can run in parallel — stage 2 is
entirely in Studio, stage 3 is mostly in `rdm-gps-node`.

---

## Not doing, and why

- **Copying Race Studio's layout system** (profiles → layouts → panels, eleven
  tabs). It is the right answer for a tool used daily by a race engineer and the
  wrong one for a tool opened after a track day. Four views, each complete.
- **Burned-in video export.** Deferred already, for the same reason: it needs a
  GoPro on the bench to be verified rather than assumed.
- **Frequency and suspension analysis.** No damper sensors exist on this
  platform. A layout for channels nobody has is a menu item that always says
  "no data".
