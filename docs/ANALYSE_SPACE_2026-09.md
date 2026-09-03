# Analyse on a laptop: the working panel (2026-09-03)

**ADR-0061.** Analyse draws four instruments at once on a screen that fits
about two. This is what was measured, what other analysis software does about
it, and what Studio now does.

## The measurement

A 1366 × 768 window — MoTeC i2's own stated minimum resolution, so it is the
machine this class of software is expected to run on — with the Donington
session open and the QUAD arrangement:

| | |
| --- | --- |
| Window | 768 px tall |
| The two bars | 95 px |
| The mosaic's port | 626 px |
| What the four panels wanted | 756 px |
| Result | the page scrolled, and the bottom row was below the fold |

Every panel was drawn as if it were the one being read: the map's five mode
buttons, the graph's three, the lap list and the report all at full size, an
equal share of the height each, and a bottom bar saying the same six numbers
whatever you were doing. Nothing on the screen knew which panel you were
actually working in, so nothing could give way to it.

## What other software does about the same problem

- **MoTeC i2** — workbooks of *worksheets*: you switch between task-shaped
  screens rather than crowding one. Studio already has this as the preset row
  (QUAD / SPLIT / TOWER / VIDEO / SOLO) and saved arrangements.
  ([i2 overview](https://www.motec.com.au/i2/i2overview/))
- **AiM Race Studio 3** — named layouts per task (Time/Distance, Histogram,
  Channels Report), and the **Movie panel appears when there is video linked**.
  Panels come and go with what you actually have.
  ([RS3 manual](https://www.aim-sportline.com/docs/racestudio3/manual/html/analysis.html))
- **Editors generally** — the controls belong to the thing you are working in
  (the tool-options bar), and the timeline collapses when the canvas is what
  matters and grows back when the clips are.
  ([timeline design notes](https://img.ly/blog/designing-a-timeline-for-mobile-video-editing/))

The common thread is not "smaller widgets". It is that the screen knows what
you are doing right now, and spends itself on that.

## What Studio does now

One panel is the **working panel**: the last one you clicked. Three things
follow it.

**1. It wears the controls.** The mode buttons — the map's five, the graph's
three, the splits' two — are drawn only on the working panel. Eight controls
across four headers were competing for a glance when seven of them acted on
something you were not looking at; on a narrow panel they also wrapped, which
cost a second header line per panel. The way *out* of a panel (split, fill,
close) stays on every header, always: that must never be the part that
disappears.

**2. It gets the room.** `gpSpineFocus` — pure arithmetic, checked in
`tools/check_focus.js`. When the rows want more height than the window has,
the row holding the working panel keeps what it asked for and the others give
the difference, in proportion to what each has above its floor. Three rules
make it safe:

- a spine that already fits is returned untouched — nothing moves on a big
  screen, and a layout that reshuffled itself on every click would be worse
  than one that sits still;
- a row you dragged by hand gives nothing — that height is a promise
  (ADR-0043), and quietly taking it back is the same lie as quietly ignoring
  it;
- nothing goes below its floor, and whatever cannot be covered still scrolls.
  The mosaic never hides what it could not fit.

Measured on the same window: the map row keeps its 397 px, the documents come
down from 349 to 219, the total lands on 616, and the page stops scrolling.
Click the report instead and it reverses — the report row takes its full
349 px and the instruments come down to 267.

**3. The bottom bar belongs to it.** Working in the picture, the six lap
readouts are not what you are reading — the film and where it sits against the
recording is. So clicking the video swaps the bar for the footage timeline,
and clicking anything else swaps it back. Only when there is film: an empty
ruler where six live numbers used to be is a worse bar than the one it
replaced.

Both behaviours are in the Arrange popover, beside the other height rules —
**GETS THE ROOM / EQUAL SHARES** and **BAR FOLLOWS IT / BAR IS FIXED** — and
both are remembered. A feature that moves the layout under you has to be
findable and switchable off in the same breath.

## Two things that are deliberately not done

**Focus does not re-render the mosaic.** The gesture that sets it is a
pointerdown, and rebuilding the grid under a pressed finger destroys the
element the click was going to land on. So the header controls are always in
the document and CSS decides which set is shown; setting focus only touches a
class, the row heights and the bottom bar.

**Focus is not persisted.** Panel ids are renumbered every time an
arrangement is read off disk (`gpNodeReseq`), so a remembered id is only good
within one arrangement. On open it resolves to an instrument — the map or the
rack — because that is what you are looking at when a recording opens, not the
lap list.

## Focus mode, and the three places the rest of it went (2026-09-03)

**ADR-0064.** The working panel bought back 130 px by moving height between
rows. It could not touch the 219 px that were never the rows' to begin with,
and on the same 1366 x 768 that is 29% of the window gone before a number is
drawn. Three changes, all measured on the Donington session in that window:

| | before | after |
| --- | --- | --- |
| The two top bars | 95 px | 13 px (a strip) |
| Panel headers (2 rows) | 66 px | 54 px |
| "+ Row" strip | 12 px | 0 |
| Footage timeline panel | 226 px | 170 px |
| **Height the panels get** | **924 px** | **1103 px (+19%)** |

**The bars lift, they do not shrink.** `.ws-topbar` and `.gpb-nav` go
`position: absolute` and translate off the top; a 12 px strip with a red
hairline takes their place, and the pointer at the top edge — or anything in
them taking keyboard focus, or an open popover — brings them straight back.
Nothing is deleted and nothing is re-laid-out at a second size, so there is no
second design to keep correct. `F`, `Esc`, the strip, or Arrange > The window.
The bottom dock deliberately stays: that bar is numbers you read while the car
is moving.

Two things this got wrong on the way, both caught by measuring rather than
looking: `position: relative` on the workspace dropped it out of `.ws`'s
`fixed; inset: 0` and cost 50 px instead of giving 95; and a `-100%` translate
on the lower bar left it hanging 43 px down over the first row of panels,
because a bar has to clear the WORKSPACE's top edge, not merely its own height.

**The footage timeline asks for what it can use.** It fell through
`gpPanelWantH`'s document branch, found no `.gpb-pscroll` and asked for
`GP_ROW_MIN` — so its row kept whatever the arrangement handed it: 226 px of
row for 94 px of lanes. It reads its own view's stated height now. It is not
elastic, so the difference goes to the map and the rack, which can spend it.

## Telling one lap from another (2026-09-03)

Same window, different complaint: in Pace, Speed, vs Ref and Line every lap on
the map came out the same colour, because the line's colour is spoken for — it
is saying what the car was doing, not whose lap it is. Two causes, both fixed:

- **The palette did not separate.** Seven hues, never checked. Run through a
  contrast validator on every PAIR — the right test, since any two ticked laps
  can end up side by side in a corner — lime against amber was ΔE 2.5 for a
  deuteranope and violet against blue 11.9 for everyone else. It is five
  re-stepped hues now (worst normal-vision pair 15.8), plus a **dash** as a
  second channel, so lap 6 is blue dashed rather than blue again and identity
  is never carried by hue alone.
- **The whole recording was one line.** With no lap selected the subject was
  drawn as a single strand from the first sample to the last, so ten minutes of
  Donington went down as one pace-coloured line with every lap on top of every
  other. It is cut at the lap boundaries now.

**Identity moved to the rim.** Every lap line already had a dark casing under
it so it would read over gravel; in the data modes that casing takes the lap's
own colour and dash instead (`gpLapCase`). The core says what the car was
doing, the rim says whose lap it is, and it costs nothing because the casing
was being drawn anyway. Floored at 2.2 screen px — the zoom-out scaling took
the rim to 0.3 px, which is the same as not drawing it. Only when there is more
than one lap on the map, and never in Lap mode, where the line's own colour is
already the answer.

## The transport keys, and what "is Analyse on screen" is asked of

Space did nothing on a map + video + moments arrangement — and neither did K,
J, L or the arrows. The guard on the keydown handler asked whether `gpStrip`
was visible, as a proxy for "is Analyse on screen". `gpStrip` is the RACK: it
is only in the document when a **graph** panel happens to be in the
arrangement. Arrange the mosaic without one — which is the natural thing to do
on a small screen, where the graph is the first panel to go — and every
transport key was swallowed on the view whose whole job is playback. Drift hit
the identical bug and was patched by adding a *second* panel to ask about; the
fix is to stop asking a panel at all and ask the workspace. Not via
`offsetParent`, either: `.ws` is `position: fixed`, and a fixed element's
`offsetParent` is null even when it is plainly on screen.

The one exception is a button reached by **Tab**, which keeps Space and Enter,
or the keyboard path through the workspace stops working. A button that has
focus only because it was *clicked* does not — after clicking Lap, Space has to
still be play/pause. That is told apart by tracking the input modality
(`gp._kbdNav`: Tab sets it, any pointerdown clears it) and **not** by
`:focus-visible`. Measured: Chromium leaves `:focus-visible` true on a button
after a real mouse click once the keyboard has been used at all, so the
pseudo-class answers "yes" to both cases and Space becomes "press whatever I
clicked last".

## One transport, and the buttons that were losing work (2026-09-03)

**The bar stopped moving.** ADR-0061 shipped BAR FOLLOWS IT on by default: the
bottom bar became the footage timeline while the picture was the working panel,
and the lap readouts came back when it was not. In use that means play and the
scrub sit in one place with the map focused and somewhere else with the video
focused — the control you reach for most changes shape depending on what you
last clicked. The default is now **off**. One bar that is always the same bar
beats a bar that is occasionally better suited; the footage timeline is still a
panel of its own, which is where arranging footage belongs. The toggle stays for
anyone who wants the old behaviour.

**"Close" was removing the footage.** It sat flush against Timeline — the button
you press to go and arrange that footage — it was named for closing a panel, and
it dropped the clip on one click with no confirmation, while "Remove all" three
inches away had always asked. Two sessions' worth of alignment was lost to it
twice in one afternoon. It is now called **Remove**, set apart behind a divider
in a quieter weight, and guarded by the same sentence its plural neighbour uses.

**Then the same question, asked of everything else.** Auditing every `gp*`
handler whose name implies destruction, against whether it calls `gpConfirm`:

| unguarded | what one click cost | now |
| --- | --- | --- |
| `gpGateDelete` | a start/finish or sector gate placed by hand on the map — every lap and sector time on that track is measured against it | confirms, and names the gate and the track |
| `gpLayoutDelete` | a named saved arrangement, one row from the button that loads it | confirms, and names the arrangement |
| `gpMyChanDelete` | a channel definition — id, scaling, unit, worked out against a real bus | confirms, and names the channel |
| `gpClearTrail`, `gpLaneShowReset`, `gpCarPngClear` | a live trail, a lane filter, an icon | left alone — seconds to redo, and a dialog for those is its own annoyance |

Each guard re-reads its target after the dialog rather than closing over it: the
answer arrives a gesture later, and the selected gate or clip can have changed
underneath in the meantime.

## The second cursor (2026-09-03)

Every desktop analysis package has two cursors and Studio had one. One cursor
answers "what was happening HERE". Two answer "what happened BETWEEN here and
here" — how long it took, how far it ran, and what each channel did across it.
It is the move you make to measure a braking zone, a straight, or the piece of
a corner under discussion, and without it the answer is read off the axis by
eye. MoTeC i2 calls it the dual cursor and computes the difference, minimum,
maximum and average between the two; this is the same idea.

The playhead stays the playhead — it plays, it follows the film, it is where
the car is. The **mark** is a second, still line you drop and measure back to.

- **Shift-click** the graph puts it under the pointer and leaves the playhead
  alone; a plain click still seeks. **M** drops it on the playhead, **M** again
  in the same place takes it away. **Esc** clears it, ahead of full screen and
  focus mode, because it is the smallest thing on screen Escape can mean.
- The band tints between the two cursors; the mark is **dashed** so it is never
  read as the playhead.
- Each lane prints, beside the mark, what that channel changed by and its mean
  across the band — on the side facing AWAY from the playhead, so the two sets
  of numbers cannot collide however narrow the band gets. The first attempt put
  them in the label gutter, where at real lane heights they sat straight on top
  of the channel names.
- The headline — Δtime and distance — is in the **bottom bar**, not only on the
  rack's axis. That axis label lives in a 15 px strip at the bottom of the
  graph, which is the first thing to go when the panel is short; on a laptop it
  usually is. Distance is summed from the fixes and skips break gaps, so a
  band containing a stop measures the road, not the pause.

Signed from the mark to the playhead, so dragging back over the mark reads
negative: the sign is the direction you measured in.

## The video panel gets its picture back

The control row (Nudge, Following, Sound, Sync, Log, Together, Link, + Footage,
Timeline, Remove) wraps to two lines at panel width, and the tile was given a
matching bottom margin — **55 px** taken permanently off the one panel whose
entire content is a picture, in a 630 px window. Now that the transport lives
in the bottom bar and nothing in that row is needed *while watching*, it
behaves like any media player's control bar: translated out, back under the
pointer, `:focus-within` for anyone reaching it by keyboard. `gpVidCtlFit`
reserves 0 instead of the bar's height, and keeps its ResizeObserver.

## Grip used, as a share of what the car has (2026-09-03)

"You pulled 1.31 g here" is a fact about physics. "You used 78% of the grip you
have" is a fact about *driving*, and it is the one a driver can act on: the
missing 22% is the thing to go and find. Circuit Tools puts it exactly this way,
against a grip target you set for the car, and splits it into the **braking**
and the **turn-in** because they fail for different reasons — braking short is
usually confidence, turning in short is usually the line.

- Two columns in Corners: the peak combined g (√(long² + lat²)) over the
  braking phase, and over the phase from the end of braking to the apex, each
  as a percentage of the target. Peak rather than mean: the question is whether
  the car was ever asked for everything it had, and an average over a phase that
  includes the straight before it answers something else. A corner with no
  braking phase prints "—" rather than inventing a number.
- The **target is the car's number**, so it is configurable and it persists.
  Until it is set it is derived from the recording — the 99.5th percentile of
  combined g above 25 km/h, rounded to 0.05 — because a road car on street tyres
  and a slick-shod GT car do not share a sensible default, and one bad fix on a
  kerb should not become the standard every corner is judged against. The
  control sits in the A/B strip, beside the columns it is the denominator of: a
  percentage whose denominator is off-screen is a number you cannot check.
- Over 100% is shown, not clamped. It means the target is set below what the car
  actually pulls, and seeing that is how you know to raise it.
- The same number is drawn on the g-g plot as a dashed ring, which is the same
  fact in the form that picture is good at.

Measured on Donington, lap 4 against lap 6: Turn 1 braking 99% / turn-in 90%;
Turn 3 89% / **86%**; Turn 7 92% / **82%**. Two corners where the brakes are
being used and the turn-in is not — which is a different conversation from
"you lost 0.04 s here".

**And nine columns do not fit.** The table gets 575 px beside the map on a
1280 px screen; with the two new columns it wanted 601 and the container did not
scroll, so the written instruction — the most useful thing in the row — was cut
off. The column that gives way is the **Opportunity** bar, because it is the only
one that says nothing new: it is a bar chart of Time lost, printed as a number
two columns to its left. Dropped only when the table actually does not fit
(`gpCornersFit` measures), so a wide window keeps it, and it comes back when the
window grows. `overflow-x: auto` on the container as a backstop, so nothing can
ever be cut off with no way to reach it.

## The lap list, on one line (2026-09-03)

Each lap was two rows: name / time / delta on the first with a third of it
empty, and the sector times indented underneath. **82 px a lap**, so the panel
that should answer "how did the session go" showed five of them and you
scrolled for the rest.

One row now, in fixed-width columns — `.nm` / `.tm` / `.dl` and the sector
chips all sized, not left to fit their contents, so a column of times reads as
a column instead of each row setting its own left edge. The sectors moved into
the gap the flex spacer used to hold open. **30 px a lap**: the same panel holds
twelve, and a seven-lap session fits with its heading and its footnote.

Nothing is dropped. The only thing removed is the per-chip `S1`/`S2`/`S3`
prefix, which said the same three things on every row — it is a column heading,
and there is now a heading to put it in. `gpSectorChips` still emits it, because
it is shared with the compare-a-recording rows where there is no heading to
carry it; the lap list hides it in CSS.

One bug this exposed: `.nm` carried a hard `width: 54px` from a later rule. With
the name on a line of its own that clipped nothing, but on a shared row "Whole
session" printed straight through the time beside it. A column that cannot grow
for its longest entry is not a column — it is `min-width` now, and the check is
an assertion that no row's name box overlaps its time box.

## Where the height still goes

On 1366 × 768 with a recording open, after this change: 95 px of bars, 47 px
of bottom bar, 33 px per panel header, 10 px between rows, and a 24 px "+ Row"
strip. Roughly a third of the window is chrome and two thirds is data, and
none of it scrolls. The next thing worth attacking, if it comes up, is the
report panel's whole-session state — a 32 px heading and a sentence above the
first number — and the graph's lane-label column.

## The empty video box is a picture too (ADR-0065)

A session with footage over 3% of it spends 97% of its time showing whatever
the Video panel puts in the tile when there is no film. That box used to draw
three things at once: a moving field of speed streaks leaning into the corners,
a vignette, and four channel traces (speed, RPM, throttle, brake) stacked along
the top edge at low opacity. All three sat under the HUD, which draws its own
speed, tacho, minimap and grip circle over the top. The result was two
instrument panels arguing with each other, and it read as debug output rather
than as a deliberate part of the app.

The question the missing picture would have answered is **where you were**. The
recording can answer that, so the box now answers it.

**Four grounds**, picked in the HUD popover under "When there is no footage",
persisted per camera via `gpCamPut("bgStyle", …)` the same way `hudMapStyle` is:

| Ground | What it draws |
| --- | --- |
| `circuit` (default) | the lap, filling the box, driven road in brand red, the rest in grey, the car on the join |
| `trace` | the lap's speed as one waveform, split at the playhead the same way |
| `night` | the old motion field, kept as an option |
| `plain` | the plate and one line, nothing else |

The stacked channel traces are gone; `gpVideoBgTraces` was deleted.

**The road and the dot come from one array.** `gpBgCircuit` builds its points
straight from `gp.trace`, *not* from `gpHudTrackShape()`. That helper prefers a
stored track outline whenever the session has a `trackId`, and a stored outline
is a different set of points from the drive — nothing maps a sample index onto
it, so the car would have to be projected separately and could land beside the
road. That is exactly the "the dot is in the wrong place" bug the minimap had.
Here the road and the dot are the same array indexed twice, so they cannot
disagree.

**The range follows the playhead, not the list.** `gpLapRange()` answers "the
lap the list has selected", and with nothing selected that is the whole
recording — at Mallala, 35 minutes including the paddock, the out-laps and the
drive home, which is a scribble rather than a circuit. `gpBgRange()` prefers the
lap the playhead is *inside*, and only falls back to the whole recording when
the playhead is outside every lap, which for a road drive is the honest answer.

Two smaller things fell out of building it. The plate's brand-red corner glow is
drawn **only** when the box is empty: with film up that plate is just the
letterbox bars either side of the picture, and a red wash in one of them reads
as a coloured block stuck to the edge of the footage. And the "no footage here"
caption moved from dead centre to the bottom right, because centred it sat on
top of whatever the ground was drawing.

There is no identity mark on the plate. The HUD already has a "Track and date"
widget; a second one landed on the speed gauge.

`window.gpBgDebug()` reports what the box decided and from what — the two
failure modes here ("the style drew nothing" and "the style drew off the edge")
are both a black box on screen.

## The footage timeline, and the section that would not show (ADR-0066)

**A second clip loaded, decoded, and never appeared.** `gpClipEl` pools `<video>`
elements by taking any one in the tile without a `data-gp-clip` attribute — and
the tile also holds `#gpVideoB`, which belongs to Beside. That element carries an
inline `display:none` so it stays hidden until Beside is on, and its id is
already spoken for, so `gpVideoElIdSet` could not put the picture on screen
either. The second clip took it and vanished. Two clips on one lane is the
ordinary case — a session filmed in sections — so this was not an edge case;
it was the feature not working the second time you used it. `#gpVideoB` now
carries `data-gp-reserved` and the pool skips it.

**The panel gave its subject the least room.** The speed trace had
`flex: 1 1 auto` and the film lanes `flex: none`, so the trace took two hundred
pixels and every clip you owned was a thirty-pixel strip of chips underneath,
names clipped to "IM...". Worse, the two things you are matching sat in
different boxes on different rows — you cannot line a clip up against a trace
you have to look away from.

They are one surface now. The trace is painted into the background of the lane
view and a clip sits on the stretch of recording it filmed; the blocks are
translucent so the trace shows through the thing you are aligning, and each
carries its name over its duration rather than fighting for one line.

**Coverage is the picture, not a sentence.** The trace is drawn twice — grey
everywhere, then bright blue clipped to the columns a clip covers. Dragging a
clip lights the trace under it as it moves. The lit/dim split applies whenever
the session has any film at all, *not* when the current view holds some: basing
it on the view lit up an empty Close-up window as though it were covered, which
is exactly when "is there picture here?" is the question.

The canvas cache key had to grow a signature of where every clip sits, or a drag
repainted nothing.

**And the red sentence went.** "This offset puts the last 1123.3 s and the first
912.9 s of the recording outside the footage" made sense when a session had one
clip meant to cover it. With sections it is true of every healthy session — a
69 s clip against a 35-minute drive leaves 34 minutes uncovered by design — and
a warning that is always on is a warning you stop reading. `gpAlignOverrun` now
asks the question it was written for, about the SECTION rather than the
recording: has the nudge pushed this clip off the recording altogether? It says
so only when less than half of the clip (and under 20 s) lands on data.
