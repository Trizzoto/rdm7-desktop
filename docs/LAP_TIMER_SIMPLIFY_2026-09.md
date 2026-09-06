# The lap timer, examined and re-proposed (2026-09-05)

Everything below was measured in the built app at **1366 × 768** — MoTeC i2's
own stated minimum, and the machine this class of software is expected to run
on — with the Donington session open (7 laps, GPS 10 Hz + 1 CAN channel, no
footage). Nothing here is built. It is a proposal and a set of questions.

---

## 1. What is actually on screen today

| View | Visible controls | What it says with the Donington session open |
| --- | ---: | --- |
| Analyse › Overview (the default) | **67** | three of the four panels ask you to pick something first |
| Analyse › Corners | 19 | "Turn 1, +0.43 s, brake 5 m early, get to throttle earlier" |
| Drift | 31 | one paragraph in a 533 px column |
| Live | 21 | six collapsed sections and twelve em dashes |
| Library | 34 | one recording in an eleven-column table |
| Setup | 42 | — |
| Circuits | 47 | — |

The most useful screen in the application has the **fewest** controls on it and
is a sub-tab you have to know to click. The screen with 67 controls is the one
that opens.

### The front door answers nothing

Open a recording and you land on the QUAD mosaic. Measured:

| Panel | Size | What it contains before you touch anything |
| --- | --- | --- |
| Track map | 664 × 396 | the whole recording's line, and it is right |
| Graph | 664 × 396 | "WHOLE SESSION · pick a lap and a comparison lap" over ten minutes of every lap drawn on top of every other |
| Lap times | 664 × **156** | four rows of eight — the thing you must use first is the smallest panel |
| Lap report | 664 × 156 | "the whole recording — pick a lap on the left for its report" |

Three of the four panels are placeholders, and the one you have to act on has
been given the least room. The lap list is the front door's front door and it
is in the bottom-left corner at 156 px.

### Space spent on absence

Every one of these was measured on a recording that has no footage, no puck
and no angle channel:

| Where | The waste |
| --- | --- |
| Bottom bar | **30 px of 76** is a footage ribbon captioned "no footage on this recording", above a clock captioned "no footage yet". Two apologies where numbers used to be. Switching the bar to Readouts gives the lap list and the report **156 → 186 px each, +19%** |
| Drift | the right column reserves **533 × 597 px — 39% of the window width** — to print 159 px of one paragraph saying it cannot measure the angle. 73% of it is empty. The map is held to 800 px when 1333 are free |
| Library | one recording, eleven columns, ~78% white |
| Live | with no puck linked: six rail sections and a twelve-row device table, every value an em dash |

The pattern is the same everywhere and it is one sentence: **a panel with
nothing to say keeps its rectangle and apologises inside it.**

### One subject, described three times

- **Corners** is a top-level view, *and* a mosaic panel ("Where the time went"),
  *and* the readout column in Drift.
- **Footage** is a mosaic panel, *and* one of four bottom-bar shapes, *and* a
  control row on the Video panel, *and* three timeline shapes inside the panel.
- **Lap times** is a mosaic panel, *and* a Library sub-tab, *and* the left
  column of Corners, *and* a table in Drift.

### The reading and the watching are on different screens

Corners tells you Turn 1 cost 0.43 s and what to do about it, and then offers a
button labelled **"Watch it in Analyse"** — which changes view, rebuilds the
mosaic and jumps a playhead. The screen that diagnoses cannot show you the
moment. It hands you off.

Drift, meanwhile, already has the right behaviour: `gpDriftCornerPlay` plays one
corner with a stop point and a loop, in place. It exists on the discipline with
no footage support and not on the one with it.

### The cause

**Every hard question of the last two months was answered by building both
options and adding a toggle.** Four bottom-bar shapes. Three footage-timeline
shapes. Five mosaic presets plus saved arrangements. GETS THE ROOM / EQUAL
SHARES. BAR FOLLOWS IT / BAR IS FIXED. Thirteen panel types. **Around thirty
persisted preference keys inside the lap timer alone.**

Each of those was a defensible call in isolation. Together they mean the app
never decides anything — and because the default has to be *something*, it
defaults to film-first on a recording that has no film, and to a four-panel
data mosaic for a driver who wants to know which corner to fix.

---

## 2. Three principles

**1. The recording decides the layout, not a preference.**
Three facts, all already computable, none of them a setting:

| Fact | States |
| --- | --- |
| `gpFilmState()` | `none` / `unaligned` / `ready` |
| does anything measure the angle | yes / no |
| does the track have gates | real laps / stop-split runs |

**2. A panel with nothing to say gives its space back.**
Not a smaller apology — no rectangle at all. What it was going to say becomes
one strip, and its width goes to the thing that does have something to say.

**3. One corner, one card, one place.** You read it and you watch it without
changing screen.

---

## 3. The shape

### 3.1 The corner feed is the front door

```
┌ LAP TIMER │ DONINGTON NATIONAL  8 Sep · Gareth · Evora GTE · 10 Hz + 1 CAN ┐
├ LIBRARY  LIVE  [ANALYSE]  DRIFT   │  Corners · Data · Watch  │ Export      ┤
├───────────────────────────────┬────────────────────────────────────────────┤
│                               │ LAP 1  1:10.119  +1.90 vs best   ‹ ▾ ›     │
│                               │ 0.43 s is available in one corner          │
│   MAP                         │                                            │
│   framed on the corner you    │ ┌ 1 · TURN 1 ─────────────────── +0.43 s ┐ │
│   are reading, the lap's      │ │ ┌───────┐ brake 5 m early · 95 vs 103  │ │
│   line, the other laps' rims  │ │ │       │ braking 81% · turn-in 85%    │ │
│                               │ │ │  ▶ 4s │ Get to throttle earlier.     │ │
│                               │ │ └───────┘ Sacrifice a little apex…     │ │
│                               │ └────────────────────────────────────────┘ │
│                               │ ┌ 2 · TURN 2 ─────────────────── +0.32 s ┐ │
│                               │ …                                          │
├───────────────────────────────┴────────────────────────────────────────────┤
│ ⏮ ⏯ ⏭   0:00.00 ────────────────────  Speed  RPM  Throttle  Δ      1× 2× 4×│
└────────────────────────────────────────────────────────────────────────────┘
```

- Left, the map at ~46% width and full height — it frames the corner whose card
  you are reading, which is what it already does in Corners.
- Right, the feed. A head with the lap picker and the session's verdict, then
  one card per corner ranked by what it costs.
- Bottom, **one transport, always the same shape.**

**The picture slot is the whole video answer.** Each card has one picture:

| the recording has | the card shows |
| --- | --- |
| no film | the corner's own trace — speed through the phases, or the angle in Drift |
| film, ready | the frames of that corner, and ▶ plays them |

Same slot, two fillings. Nothing to configure, and the moment footage is linked
and aligned every card in the feed gains a picture. That *is* "when you upload
and align a video it works it out for you" — expressed in the place a driver
actually looks.

**▶ plays that corner in place.** The map follows, the transport runs, the card
stays on screen, and it stops at the corner's exit. Shift-▶ loops it. The
machinery exists: `gp.playStopAt` / `gp.playLoopFrom` and `gpDriftCornerPlay`.
It is generalised to any corner in any discipline and `gpCornerToAnalyse` — the
handoff to another screen — is deleted.

**And ▶▶ plays it across the laps.** Turn 1 on lap 1, then lap 2, then lap 3,
back to back — film or trace, whichever the card has. This is the strongest
single idea in Garmin Catalyst's lap review and Studio is close to it already:
`gpCoachOps` knows each lap's entry, apex and exit, and the stop point already
works. The comparison a driver actually wants is not "this lap against the best
lap" as two lines on a graph — it is the same corner, six times, in a row.

### 3.2 Drift is the same screen with a different scorer

Same map, same feed, same cards, same transport. What differs is only what a
corner is scored on and what its headline says:

| | Circuit | Drift |
| --- | --- | --- |
| card headline | `+0.43 s` | `★★★★½ · held 36°` |
| ranked by | time lost | score, worst first |
| picture (no film) | speed through the phases | the angle trace |
| under the map | the graph rack | the angle lane (already built) |
| the lap picker says | "Lap 4 of 7 · 1:08.215" | "**Run 4 of 7**" — no time |

**No lap times anywhere in Drift**, as asked. That deletes the drift laps table
(swatch / Lap / Time / Angle / °·s / Stars), the separate "every corner"
numbers-only table — it becomes the feed — and the two paragraphs of "How this
is rated", which become a `?` on the score.

And Drift gets footage for the first time, because the card's picture slot is
the same slot. Watching one corner ten times is what a drifter does; it is the
discipline that needs it most and the one that has never had it.

### 3.3 The mosaic survives as the deep tool, one tab across

`Analyse → [Corners] [Data] [Watch]`

**Data** is today's mosaic, unchanged: the graph with its lanes, the second
cursor, thirteen panel types, presets, saved arrangements, the working panel.
None of that work is thrown away — it is a genuinely strong analysis tool. It
simply stops being what a driver is shown first.

**Watch** exists only when there is film, and is the player at full size with
the HUD, the map inset and the transport. It replaces the Video preset.

### 3.4 The film rule replaces seven settings

```
gpFilmState()  →  none | unaligned | ready
```

| state | bottom bar | corner cards | tabs | footage controls |
| --- | --- | --- | --- | --- |
| `none` | **46 px** readouts | traces | Corners, Data | behind "+ Footage" in Export |
| `unaligned` | 46 px readouts | traces | + a strip at the top of the screen | the alignment strip, on screen once |
| `ready` | 76 px, ribbon | frames | + Watch | on the Watch tab |

Deleted: `GP_BARS` (four shapes), `GP_TLS` (three shapes), BAR FOLLOWS IT /
BAR IS FIXED, the "no footage on this recording" caption, the "no footage yet"
caption. **Seven settings and two apologies become one function.**

The `unaligned` strip is the only time alignment UI is ever on screen:

```
┌ Donington-1.mp4 · placed from the camera clock, 4.2 s into the recording ──┐
│ Does the film start where the car does?     [ Looks right ]  [ Nudge it ]  │
└────────────────────────────────────────────────────────────────────────────┘
```

`gpClipAutoAlign` already computes the placement from the clip's creation date
against the recording's UTC. Today it does that silently and then leaves ten
alignment controls on screen forever. It should state its answer once, take a
yes, and get out of the way.

### 3.5 Lining the film up against the speed trace

This is the part that has never worked, and it is the whole point of linking
footage at all. Read the drag handler at `src/tauri-overlay.html:43137`:

```
if (!moved) { moved = true; block.classList.add("dragging"); gpPlayStop(); … }
…
var up = function () { … gpClipSyncFor(gp.playIdx); gpVideoFollowSeek(true); … }
```

**The picture is frozen for the entire drag.** The first movement stops
playback, the drag moves a translucent rectangle along a waveform, and the film
is not re-seeked until `mouseup`. You are dragging blind and only find out
whether it matched *after* you let go — then you drag again. Four bar shapes and
three timeline shapes were built on top of a gesture that gives no feedback,
which is why none of them helped.

Three fixes, smallest first.

**(a) The picture follows the drag.** Delete the `gpPlayStop()` and call
`gpClipSyncFor` / `gpVideoFollowSeek` from `move`, throttled to one seek per
animation frame. Now you drag the clip and *watch the film move against the
trace* — brake here, cliff there, they either coincide or they do not. This is
a handful of lines and it is most of what was missing.

**(b) A sync point: two clicks, no dragging at all.** The gesture every other
tool uses (RaceRender, Circuit Tools) and Studio does not have. One landmark is
unmistakable in both media: **a hard brake** — the picture stops rushing, the
trace falls off a cliff.

```
┌ LINE THE FOOTAGE UP ─────────────────────────────────────────────────────┐
│  ┌──────────────────────────┐   Find one moment in both.                 │
│  │                          │   A hard brake is easiest: the picture      │
│  │   THE FILM, LARGE        │   stops rushing, the trace falls off a      │
│  │   scrubbing live         │   cliff.                                    │
│  │                          │                                             │
│  └──────────────────────────┘   Film   0:04.20   ◀◀ ◀ ▶ ▶▶  ⟨ frame ⟩    │
│                                  Trace  1:12.60   ← click the trace       │
│  SPEED ─────────────────────────────────────────────────────────────────  │
│   ╱‾‾‾╲__╱‾‾‾‾‾╲___╱‾‾‾‾‾‾‾╲_____╱‾‾‾╲__                                 │
│              ▲ clicked here                                               │
│  ▬▬▬▬▬▬▬▬▬▬▬ the film, now sitting here                                   │
│                                                                           │
│  Offset −3.42 s        [ Nudge ◀ 0.1 ▶ ]   [ Undo ]   [ That's it ]       │
└───────────────────────────────────────────────────────────────────────────┘
```

Park the film on the brake with frame-step keys, click the cliff on the trace,
the offset is exact. Both the film and the trace are on one axis and both are
big, because the whole task is comparing two pictures. Frame-step matters:
`requestVideoFrameCallback` gives exact frames, and a tenth of a second is
worth a metre and a half at 55 km/h.

**(c) Automatic, from the film's own motion.** The camera clock is the one thing
that cannot be trusted — the puck has dated six sessions 2212 days early — so
the strongest match does not use a clock at all.

Sample the film at ~4 Hz into a 64 × 36 greyscale canvas, take the mean absolute
difference between consecutive frames: that is "how fast is the world moving
past the lens", and over 90 seconds it has the same shape as the speed trace.
Normalise both, cross-correlate over ±5 minutes, take the peak. Around 360 frame
decodes — a few seconds of work, on a worker, once.

Then the strip says the thing worth saying:

```
Matched the film's motion to the speed trace — strong match, 
offset −3.42 s (the camera clock said −7.8 s).   [ Use it ]  [ Line it up myself ]
```

And it states its confidence, because a match on a lap of a road drive with no
braking is a weak one and should say so rather than quietly being wrong. Same
rule as everywhere else in this app: say what you know and how well you know it
(ADR-0049, ADR-0066).

This is the honest reading of "when you upload and align a video it works it out
for you" — it works it out from the two signals themselves, and the manual path
exists for when it cannot.

### 3.6 The space rules, applied

| Where | Rule | Measured gain |
| --- | --- | --- |
| Bottom bar, no film | readouts, not a ribbon | **+30 px** to every panel row |
| Drift, no angle channel | the column collapses to one strip; the map takes the width | **533 px** of width back |
| Library, under ~12 recordings | cards, not an eleven-column table | most of the window |
| Live, no puck | one connect card | six sections and twelve dashes gone |
| Any panel with a placeholder | it is not in the arrangement | — |

---

## 3.7 What is built (2026-09-05)

Steps 1–5 of the order below are in the working tree, measured in the built app
at 1366 × 768 on the Donington session and on a generated Mallala drift session
(`tools/make_drift_fixture.js`). **Not committed** — the overlay carries ~5,000
lines of unrelated in-flight work (the keypad lightshow), so the tree is left as
it is.

| | Was | Is |
| --- | --- | --- |
| The drag that lines footage up | picture frozen for the whole drag | seeks per animation frame; Escape restores the offset with the block |
| Bottom bar, no footage | 76 px, two "no footage" captions | **46 px** of live numbers |
| The panel rows under it | 156 px each | **186 px each, +19%** |
| Bar and timeline shapes | 4 × 3, chosen and stored | one function, `gpFilmState()` |
| Corners | a nine-column table that did not fit | a card per corner, with a picture and a transport |
| …and its report column | 200 px repeating the selected card | folded onto the card; the map went 340 px → 46% |
| Watching a corner | "Watch it in Analyse" — changed view | ▶ plays it in place, ⟲ loops, **▶▶ plays it on every lap** |
| A recording opens on | the mosaic, three panels saying "pick a lap" | the corner feed, with a lap already chosen |
| Drift | a hero for one corner, then a table of all of them, then a table of the laps **with their times** | the same feed, scored on stars; no time anywhere |
| …its column | a fixed 500 px beside a `flex:1` map | 54%, and the map takes the rest |
| A drift corner's picture | an 84 × 20 unsigned mark in a table row | the signed angle on the card, mirrored left and right like the lane |

Written: `gpFilmState`, `gpAlignAskHtml` / `gpFilmAgree`, `gpCornerSpanOn` /
`gpCornerPlay` / `gpCornerRunSync`, `gpCornerPicDraw`, `gpCornerDetailHtml`,
`gpDriftSpanOn`, `gpOpenView`, `gpPlaysBack`, `gp.playQueue`, and
`window.gpCornerRunDebug()`.

Deleted: `GP_BARS`, `GP_TLS`, `gpLookSet`, `gpLookDef`, `gpLookGroupHtml`,
`GP_LOOK_LS`, `gpBarChaptersHtml`, `gpBarChipCamHtml`, `gpTlCoverIn`,
`gpDockCtx`, `gpCornersFit`, `gpCornerToAnalyse`, `gpFocusDockSet`, the
BAR FOLLOWS IT segment, `gpDriftTile`, and the CSS for `.gpb-dhero`,
`.gpb-dbig`, `.gpb-dnum`, `.gpb-dtiles`, `.gpb-dtile`, `.gpb-dhead`,
`.gpb-dtools`, `.gpb-dlaps` and `.gpb-dcorn`.

**Drift is the same screen with the scorer swapped.** One card class
(`.gpb-ccard`) serves both; `.gpb-dfeed` scopes what differs. The card's
headline is stars and held angle, the ranking is ascending stars — what is left
to find, the drift twin of "seconds available" — with the unrated corners
(spin, rough, not a drift, not driven) after them, since there is no score to
be short of. The runs are chips above the feed, carrying the run's average and
its map swatch, and no time. `▶▶` plays the corner on every run, the same
machinery as the circuit side.

Two bugs found by building it, both invisible from outside:

- **`gpIdxSecondsBefore` / `gpIdxSecondsAfter` clamp to `gpLapRange()`** — the
  lap being *analysed*. Right while a corner was only ever played on that lap;
  wrong the moment the same corner is played on every lap, where it collapsed
  all seven spans onto lap 4 and the run played once and stopped. They take the
  lap to walk within now.
- **A bare `<header>` inside the card inherited the app's
  `header { background: #000 }`**, so the corner's name came out black on
  black. The same trap as reusing `.gpb-phead`, one level lower down: an
  element name is the one nobody thinks to check.

**`tools/check_feed.js` is new** — 46 assertions over both feeds: that a span is
walked within its own lap, that the queue is part of a stop point, that the
ticker asks about the queue before the loop and marks rather than re-renders,
that a card's transport does not also select the card, that no card builds a
bare `<header>`, that Drift says nothing about lap times, and that every route
into a recording goes through `gpOpenView`.

Harnesses updated to pin the new rules rather than the deleted ones:
`check_focus` (46 pass), `check_lookbar` (45), `check_clips` (68),
`check_pairs` (20), `check_autodl` (38), and `check_driftview`'s class-name and
attribute lists. Six harnesses still fail and none is from this work —
`check_colour` and `check_hud` fail at HEAD too, and `check_autotrack`,
`check_controls`, `check_driftview` and `check_mallala` break on symbols from
the in-flight keypad/wizard work (`GP_RING_LOW_MIN`, `gpwMeasureRoll`,
`gpCornerLabel`, `gpGripX`).

Still to do: steps 6–9 — the sync point, the empty states for
Drift/Library/Live, the card extras (export a corner's footage, the
practise-this filter), and the automatic alignment from the film's motion.

## 4. Build order — each step shippable on its own

1. **The picture follows the drag** (§3.5a). A handful of lines, and it is the
   difference between alignment working and not working.
2. **`gpFilmState()` and the bar rule.** Delete `GP_BARS`/`GP_TLS`/the toggles.
   Measured win on every recording without film.
3. **The corner card**: the picture slot, play-in-place by generalising
   `gp.playStopAt` to any corner, and ▶▶ across the laps. Ship it inside
   today's Corners view first, where it can be judged against what it replaces.
4. **The feed becomes the front door**; the mosaic moves to a `Data` tab. A lap
   is always pre-selected, on every route in.
5. **Drift re-pointed at the same feed** with the drift scorer; the laps table,
   the second corner table and the ratings prose come out.
6. **The sync point** (§3.5b) — the film and the trace on one axis, two clicks.
7. **The empty-state rules** for Drift, Library and Live.
8. **The card extras** — ghost lap under the trace, export this corner's
   footage, and the practise-this mode of the feed.
9. **Automatic alignment from the film's motion** (§3.5c) — the biggest single
   piece, and worth nothing until (1) and (6) exist to check its answer.
10. `tools/check_feed.js` — the card's two picture states, the stop point, the
   film-state table, the drag's per-frame seek, and an assertion that no view
   reserves a column for a message.

---

## 5. Decisions taken (2026-09-05)

| Question | Answer |
| --- | --- |
| The front door | **the corner feed** — §3.1 as written, mosaic to a `Data` tab |
| Drift | **the same feed with a drift scorer** — §3.2 as written |
| The four bar shapes and three timeline shapes | **deleted; the recording decides** — §3.4 as written |
| Video alignment | **all three** — the drag follows the picture, the sync point, and the automatic match from the film's own motion |
| Same corner across laps | **in** — ▶▶ on a card |
| Export one corner's footage | **in** |
| Practise-this filter | **in** — a mode of the feed |
| Ghost lap on the card | **in** |
| Live and Library empty states | **both rebuilt** |

### The front door, and what the field actually does

| Product | What it opens on |
| --- | --- |
| **VBOX Circuit Tools** | laps / map / video / graph — a quad, much like Studio's — but **the fastest lap is already selected**, synchronised to circuit position. It never opens on a question |
| **AiM Race Studio 3** | named layouts per task, and the **Movie panel appears only when video is linked** |
| **MoTeC i2** | workbooks of task-shaped worksheets; you switch screens rather than crowd one |
| **Garmin Catalyst** | no data screen at all. A list of **"opportunities"** — moments where a change would quicken the lap — and per-corner video. Its lap review plays **short clips of the same corner over successive laps**, full-screen or beside a speed graph |

Two things fall out of that, and they matter more than the choice of card
shape.

**The quad is not the bug — the EMPTY quad is.** Circuit Tools ships almost
exactly Studio's arrangement and it works, because a lap is chosen before you
arrive. Studio's four panels are three placeholders because nothing has been
selected. Whatever the front door becomes, the first rule is: **a lap is always
already chosen** — the best clean lap — and a comparison lap with it.

**Studio has independently built Catalyst's model and then hidden it.** The
Corners view ranks corners by time lost and has a column literally named
*Opportunity*, which is Catalyst's own word for the same idea, in the most
successful driver-coaching product on the market. Studio computes it, prints a
written instruction beside it, and puts it behind a sub-tab with no playback.

**Recommendation: the corner feed (§3.1).** Not because a card reads better
than a table, but because of the three things it makes true, none of which is
true today:

1. a lap is already chosen, so nothing on screen asks you to pick first;
2. corners are ranked by opportunity, which Studio already computes and hides;
3. each corner is watchable **in place** — and, stealing Catalyst outright,
   watchable **across laps**: the same corner on lap 1, then 2, then 3, back to
   back, film or trace. That is the single strongest thing in Catalyst and
   Studio is four functions away from it (`gp.playStopAt` already exists,
   `gpDriftCornerPlay` already stops and loops, `gpCoachOps` already knows each
   lap's entry/apex/exit).

The mosaic stays one tab across as **Data**, unchanged, because it is a good
tool for a different question — and because AiM and MoTeC both say the same
thing: several task-shaped screens beat one crowded one.

**Where the feed has nothing to rank** — a road drive with no gates, so no
corners and stop-split runs — the front door falls back to the session summary
over the mosaic. That is the same rule as everywhere else here: the recording
decides.

### Still open

The session verdict line, which is deliberately left until the feed exists —
a summary of a screen that has not been built yet is a guess.
