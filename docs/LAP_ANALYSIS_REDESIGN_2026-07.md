# Lap recording and telemetry analysis — the redesign (2026-07-29)

> **2026-08-21 (tenth) — the map when nothing is open.**
>
> > when no session is loaded can you show that somehow so it doesnt look
> > boring becuase most people will open it first and see whats going on
>
> Counting properly first, because "boring" undersold it. Analyse with nothing
> loaded said NOTHING about ten times — the graph's "no recording loaded", two
> panels printing the identical sentence *No recording open.*, six em-dashes
> across the transport, and a map showing anonymous farmland at whatever zoom
> it was last left at — and said what to do next **zero** times. Meanwhile
> seven recordings sat one click away and the one genuinely useful line on the
> screen (*connected to a dash, which is not a GPS node*) was in the smallest
> type on it.
>
> The map already knows something worth showing: **every circuit you have
> driven**. Outlines where they exist, a pill per track carrying how many
> recordings are on it and your best lap there, and the one you drove most
> recently wearing the accent so "where was I last" is answerable at a glance.
> Nothing is invented — ADR-0011 still forbids a demo trace — it is the track
> library and the session store, drawn instead of hidden.
>
> Clicking a circuit **offers** its recordings rather than opening one: the
> sessions list narrows to that track and you pick the day. Auto-opening the
> last recording was considered and deliberately not done.
>
> Four faults, all found by driving the built app against his real library:
>
> - **It opened on Chad.** His circuits span South Australia, Donington and
>   Colorado; fitting all of them is a view of the planet centred at 11.5°N
>   21.1°E with eleven pills in one smudge. It frames the most recently driven
>   circuit and everything within a day's drive (600 km) — the rest stay drawn,
>   with a line saying how many are out there.
> - **His library holds duplicates**: "The Bend GT" three times, "Mallala"
>   twice, adopted more than once over the months. Three identical pills on one
>   point — and worse, two rows sharing a name both matched the same recordings
>   BY NAME, so each claimed the whole count. One pill per circuit now, keeping
>   the copy that can draw a shape. The library itself is untouched.
> - **`isFinite(null)` is `true`.** null coerces to zero, so a track with a
>   null lat on its timing line sailed through the guard and would have put a
>   pill carrying the user's own circuit name in the Atlantic. Caught by the
>   harness check written for exactly that, before it ever shipped.
> - **The fit ran before the map had a box.** Zoom came back as exactly
>   `maxZoom` BOTH times — once for three circuits 45 km apart and once for a
>   set spanning three continents. The same answer for two bounds that share
>   nothing is what a measurement taken before the box exists looks like:
>   gpDrawTrace runs while the Analyse grid is still laying out, and fitBounds
>   on a zero-size map returns the cap whatever you hand it. The fit waits for
>   a size now, and only marks itself done once it actually fitted — stamping
>   first would mean a fit that never happened is never retried.
>
> Then two more the screenshot found that no number would have: the hint
> banner sat across the map toolbar, and the northernmost circuit lost its name
> off the top edge. Pills are drawn ABOVE the point they name, so the top is
> the one edge they need — the fit takes 62 px of padding there against 34 at
> the bottom, and the hint moved to the bottom left, which is empty inside an
> Analyse panel because the place-search is hidden there.
>
> `tools/check_mapempty.js` — 43 checks: where a pill is placed and when a
> track is skipped rather than dropped at 0,0, the dedupe, the framing rule
> with the measured Chad coordinates in its failure message, and that the whole
> thing takes itself down the moment a recording is open.

> **2026-08-21 (ninth) — changing your mind after the recording exists.**
> Three asks, one theme. See
> [ADR-0045](../../RDM-7_Dash/docs/adr/0045-a-reading-can-be-corrected-after-the-drive.md).
>
> **A panel can fill the window.** Studying one corner of a speed trace in a
> quarter of the screen is reading it through a letterbox, and the only answer
> was to rearrange the mosaic and then rearrange it back. Arrows-out on the
> panel header, a double-click on the header itself (which is what a title bar
> does), and <kbd>Esc</kbd> to come back.
>
> Three things it must not do, all of them the same mistake in different
> clothes. The other panels are **not rendered**, not hidden: a `display:none`
> map still costs a Leaflet resize and a canvas redraw every frame. `gpGridLayout`
> **returns early** — running the measurement pass would write row heights back
> into the saved arrangement from a tree whose other panels are not on screen to
> be measured, which is how you lose a layout by looking at one panel. And it is
> **not persisted**: reopening Studio into a single panel, with no memory of
> having asked for it, reads as the arrangement having been lost.
>
> One tuning: `GP_LANE_MAX` (92 px) stops one lane hogging a shared panel, and
> full screen is the case where hogging is the entire request. The cap comes off
> — you gave the window to that graph, the lanes get the window.
>
> **Two faults the harness could not have found, both caught by driving the
> built app.**
>
> *Esc closed the whole workspace and left the panel full.* The suite's own
> Escape handler is registered at capture on `document` long before this
> workspace draws anything, so an ordinary listener added later fires second —
> by which time Escape has already shut the workspace. There is an existing
> hook for exactly this, `gpEscapeCaught`, which that handler asks first; full
> screen belongs in it, after the popovers, because a split menu open over a
> full-screened panel is the inner thing and Escape closes the inner thing
> first. A way in with no way out is worse than no way in.
>
> *Full screen made a tall rack SMALLER.* Pinning the canvas to the port is
> right for a map and wrong for the rack: nineteen lanes get their readable
> 46 px each in the mosaic and the page scrolls, and the same nineteen crushed
> into one screen come out at 27 px — under the floor, and smaller than before
> the gesture. Measured: 894 px before, 526 px after. A full-screened panel now
> gets at least the height it wants and the page scrolls if that is more than
> the window, which is ADR-0043's rule applied to a mosaic of one.
>
> **A decode can be corrected after the drive.** This is the important one, and
> it is the other half of yesterday's ADR-0044: freezing a recording's
> definitions makes it readable for ever, and would have frozen *mistakes* just
> as permanently. A wrong scale is a wrong label on counts that are still there
> — the puck never applied the scale — so it is a label you can change, with
> nothing downloaded again.
>
> Corrections outrank the frozen definitions (later and deliberate beats earlier
> and automatic), at two scopes: **everywhere**, for a definition that was simply
> wrong, and **this recording only**, for one that is right now but predates a
> change to the car. The wire half — id, start bit, width — is never editable:
> those chose which bits the puck copied months ago, and offering to "fix" them
> would be offering to change what was recorded.
>
> The form is built around the answer rather than the inputs. It shows the raw
> counts in the open recording, what they would read under whatever is in the
> boxes, and one chip per plausible scale **with its resulting range printed on
> it**. You do not need to know the ECU's scaling; you need to recognise a
> throttle when you see one, and `×0.1 → 0–99.8` beside `×1 → 0–998` is not a
> hard choice. Nothing picks for you — a fitted scale is a guess with a number
> on it — and a corrected channel says *corrected* on its row afterwards.
>
> Signedness is correctable too, which matters more than it looks: it is the
> fault that turns −6° of ignition advance into 65530 with nothing on screen
> looking broken.
>
> **Bulk ticks.** Twenty channels was twenty clicks to see one on its own and
> twenty more to get back. A three-state tick in each column header, the same
> gesture the sessions table already uses, acting on **the rows you can see** —
> with a filter up, "all" means all of what is in front of you. Log honours the
> puck's 12-channel cap and says how many it left off rather than silently
> ticking the first twelve.
>
> A third fault found by driving it, and the only one that needed real data to
> exist at all: **his dash describes 119 channels and the record holds 12**, so
> "every eligible row is ticked" is unreachable — and a tick whose state can
> never be `true` never offers to turn anything OFF. Pressing it twice ticked
> twelve, then ticked the same twelve again, and the only way back was twelve
> single clicks. "Full" for the Log column is now the puck's cap rather than
> the list length. The Graph column has no cap and keeps the plain rule; the
> harness pins both, because making one of them cap-aware is exactly the sort
> of change that quietly generalises to the other.
>
> That fix was not enough on its own, and the second half is the more
> interesting one: **two of his twelve logged channels have no CAN decode**, so
> they are not eligible ROWS — while still occupying two of the puck's twelve
> SLOTS. Counting only eligible rows still left the state at "some" with a full
> record. The cap is read from the whole selection now, and the rule the
> control actually follows is stated as: *offer ON while ticking more is
> possible, and OFF once it is not.*
>
> Verified live, and it is a clean cycle: twelve ticked → click → two left (the
> ten eligible ones cleared) → click → back to twelve. The message counts what
> CHANGED rather than how many rows were looked at — over a 119-channel dash it
> had been saying "Unticked 117" when ten were ticked to begin with.
>
> `tools/check_chanfix.js` — 71 checks. The precedence chain, both scopes, what
> a correction must not touch (can_id, start bit, width, endianness — a
> corrected channel has to stay loggable), the preview arithmetic including the
> signed case where the range must be *measured* rather than derived, and the
> claims about the full-screen code that have to hold for it not to eat the
> saved arrangement. Every fault found by driving it carries its measured
> numbers in the failure message, so the reason survives the code moving.
>
> **Verified against the real Mount Barker recording**, on his dash's own
> 119-channel library:
>
> | | |
> |---|---|
> | throttle lane, as found | `Throttle Position %`, 0 – 99.8 |
> | decode form readout | `raw 0 – 998 counts → 0 – 100 %` over 20,677 samples |
> | after picking ×0.01 and saving | lane reads 0 – 9.98, row says **corrected** |
> | after Remove correction | back to 0 – 99.8, store empty |
> | graph bulk tick | 19/20 → 20/20 → 0/20 → 20/20 |
> | log bulk tick | 12 → 2 → 12 |
> | full screen | 5 panels → 1, rack holds 894 px, Esc restores all five |
>
> The ×0.01 was deliberately wrong. Applying a correction proves half of it;
> taking it off again and landing back on exactly what was there proves the
> half that matters more.

> **2026-08-20 (eighth) — a column of counts is not a reading.** See
> [ADR-0044](../../RDM-7_Dash/docs/adr/0044-a-recording-carries-its-own-meaning.md).
>
> > the canbus in the graph is all wrong like throttle position 818 and -74 is
> > that right? shouldnt it be between 0 and 100. same with ignition timing
>
> Both numbers were real and neither was a reading. The puck logs **raw CAN
> field counts** on purpose (ADR-0008); everything that turns a count into a
> percent lives in a channel library fetched off a dash. That library was
> written by exactly one thing — the **Refresh button** on Setup ▸ Channels —
> and was never persisted. Not fetched on opening the view, not on connecting
> a dash, not on downloading. Unless you had pressed that button, this session,
> on that card, Studio held no definitions at all, and it never said so.
>
> So `throttle_position` resolved to nothing, the lane got scale 1 / offset 0 /
> no unit / the raw id as its label, and plotted the counts: 0..744. `gpLaneScale`
> pads an axis by 10% either side, which is where **−74 and 818** came from.
> The −74 was breathing room under a 744 peak — never a sample. Chasing it as
> a sign bug on the throttle would have been the wrong hunt.
>
> There **is** a sign bug, one layer down, on the channels that really are
> signed. `trace_log.c` sign-extends a field and keeps the low sixteen bits
> (`s_chan_val[i] = (uint16_t)raw`); Studio read every slot with `getUint16`
> and never put the sign back. Ignition advance at −6° came back as **65530**.
> A right-hand yaw rate reached the drift engine as about **+1300 °/s** — the
> identical failure the puck's *own* gyro column had had and had fixed with
> `getInt16`, in the one place where getting it wrong ruins a whole analysis
> quietly rather than looking broken. And a third: the dash emits `label` and
> `units_native`, Studio looked for `name` and `unit`, so every channel that
> *did* resolve still arrived unitless.
>
> Now: definitions are **snapshotted into the recording** at download and saved
> with it (an imported VBO always did this; a puck download did not), the
> library is **cached to disk** with a date, it is **read without being asked**
> once per session whenever a dash is reachable, and one `gpChanDef` /
> `gpChanValue` pair owns the decode for the rack, the drift engine, the CSV
> and the VBO export alike. Ids that resolve to nothing are **not** frozen into
> the file, so an old recording repairs itself the first time a dash is
> connected.
>
> The part that matters most is the smallest: a column nothing describes is
> labelled `counts` and tagged **not decoded** on the lane, in red, beside the
> numbers it is about. An undecoded column draws a perfectly smooth, perfectly
> plausible line, and nothing on the screen disagreed with it.
>
> `tools/check_candecode.js` — 46 checks: the resolver, the arithmetic, a round
> trip of every signed field width 2..16 against the node's own `(uint16_t)`
> truncation, and the reported −74..818 axis reproduced from raw counts and
> then shown landing inside 0..100 once decoded.
>
> **Verified against the real Mount Barker recording**, 16 Aug, twelve puck
> channels. Before: every one of the twelve read `counts` with the note
> attached — the library really was empty on his machine, which is the
> diagnosis confirmed rather than argued. With a stand-in library present, the
> five described channels resolved and the seven that were not still said
> `counts`. The fitted ranges, read off the lane popups:
>
> | lane | fitted |
> |---|---|
> | Throttle Position % | 0 .. 99.8 |
> | Vehicle Speed km/h | 0 .. 88.4 — against the puck's own GPS speed lane |
> | Ignition Advance °BTDC | 3.0 .. 26.6 |
> | Coolant Temp °C | 68.7 .. 94.0 |
>
> Three unrelated channels landing inside their physical ranges at once is the
> part worth trusting; one could be a coincidence. The stand-in library was
> then **removed**, because its scales were a guess and a guessed scale
> presented as a reading is the failure being fixed.

> **2026-08-20 (seventh) — the car on the map, and how big a car is.**
>
> > the icon is glitching during playback … im not sure the to scale car is
> > right for this actually, it looks a bit small doesnt it
>
> Both, and they were the same fault twice over.
>
> **The glitch.** `gpDrawHeadMarker` — the course-only car, which is the car on
> every VBO import and every recording without a usable slip angle — rotated by
> calling `setIcon`. That DESTROYS the marker element and builds a new one. Any
> corner turns the car more than a degree between frames, so it was being
> re-created twenty-five times a second. Worse, `gpScaleCarGlyphs` remembered
> the scale for the **map**, not per element: a rebuilt element carries no
> transform, the remembered scale still matches, the guard returns early — so
> each new car also arrived **unscaled**. It flickered and changed size at the
> same time. The live car in Monitor did the same thing at every poll.
>
> Rotation now happens in place on the `.body` group, which was always its own
> `<g>`; the scale is remembered per element against a build counter. And the
> angle is taken **between** samples like the position already was — the clock
> runs at 25 fps against 10 Hz fixes, so holding the attitude on the whole
> sample while the position slid smoothly was the judder taken out of the
> position and left behind in the heading. Wrapped the short way, or a lap that
> crosses north pirouettes.
>
> **The size.** True scale alone is not usable and pretending otherwise is what
> made it a speck. A map fitted to a circuit is two kilometres across in six
> hundred pixels — three metres a pixel, so a real car is **one and a half
> pixels**. Geometrically correct, completely useless: at every zoom where you
> can see a lap, a to-scale car is smaller than the line it is driving on. The
> old floor was a scale FACTOR of 0.42, and at zoom 18 — the Esri native level,
> where a lap fills the panel — a 4.6 m car is about nine pixels, so **the
> clamp was the normal case** and the true scaling almost never ran.
>
> The clamp is now stated in **screen pixels**, which is the thing that has to
> be legible: never under 30 px, never over 88, and truly to scale in the band
> between — from about zoom 19.5, which is where you are looking at one corner
> and true size starts to mean something. The degree readout is a **label**, not
> part of the car: counter-scaled so it keeps one size and one gap below the
> tail at every zoom. It was four pixels tall fitted to a circuit and forty on
> top of one corner.
>
> Also fixed in passing: the car picker never reached the course-only marker, so
> choosing a new car left that one wearing the old shape.
>
> `tools/check_carglyph.js` — 41 checks, including the heading wrap through
> north, that the size never shrinks as you zoom in, and the exact regression:
> a car built later, at the same zoom, must still be scaled. Proved by
> reintroducing the one-value guard: 40 pass, 1 fails, and it is that one.
>
> **Measured live during playback of the real Mount Barker recording**, 120
> samples across two zoom levels:
>
> - **one** scale value the whole way through at each zoom — `scale(1.364)`
>   at 13, `scale(1.709)` at 20. No flicker.
> - **zero** element swaps. The marker built once and was still the same
>   element after a zoom change.
> - the body angle moved on **79 of 79** consecutive samples, 78 of them by
>   under 3°. Held on a whole sample against a 25 Hz clock, roughly half would
>   have been identical to the frame before.
> - at zoom 20 the glyph measured **37.6 px** and a real 4.6 m car measured
>   **37.6 px** by Leaflet's own projection — to scale, checked against the
>   map rather than against the formula that drew it.

> **2026-08-20 (sixth) — several recordings at once, and a harness that
> parses what we ship.**
>
> One row at a time was fine while a download was one recording. It is not any
> more: a track day arrives as an outing per session and a drift day as a
> handful of runs, so clearing out the practice meant the same four clicks over
> and over, each with its own confirm.
>
> Ticks are kept **by id, not by row**, so they survive a re-sort and a change
> of filter — the set you built is still the set you have after clicking a
> column header. Shift extends from the last tick over the rows *as currently
> sorted and filtered*, which is what makes “sort by date, then bin everything
> before March” one gesture. Select-all means **the rows you can see**: ticking
> everything while a filter is up and then deleting the lot would be a trap.
> A tick can never outlive the recording it points at.
>
> The bar that appears says what happens next — count, Clear, and a Delete that
> is the only red thing on it — and the confirm names up to three and counts
> the rest. The per-recording Car/Driver/Rename fields still belong to the
> HIGHLIGHTED row, not the ticked set: renaming thirty recordings to the same
> thing is not something anyone wants, and a Car box that silently wrote to all
> of them would be worse than not offering it. Deletes run one at a time — the
> store opens a transaction per remove, and firing thirty at once is how you
> get a mid-way failure with no way to say which ones went.
>
> Ticked and highlighted are two different states and a row can be both, so
> ticked gets an EDGE rather than a fill. The first attempt tinted it
> `rgba(192,32,38,0.055)` — which lands on rgb(246,238,238) against `.sel`'s
> rgb(253,238,236), a difference of seven units in one channel, which is no
> difference at all.
>
> **And the reason there is now a `check_syntax.js`.** Writing the confirm text
> through a shell heredoc had `"?

"` arrive as a raw newline inside the
> string literal. Unterminated string, the whole IIFE failed to parse, and
> Studio booted to a blank workspace — while `merge_overlay.py` reported OK and
> all twelve harnesses passed, because every one of them lifts NAMED FUNCTIONS
> out of the overlay and a broken literal between two of them is never parsed.
> The new harness parses every inline script in the BUILT `src/dist/index.html`
> (the file the release binary embeds) and in the overlay, reports the line, and
> was verified by reintroducing the exact bug. It is worth running before any
> `cargo build --release`: the frontend is embedded at compile time, so a parse
> error otherwise ships in silence.
>
> Verified live end to end: three throwaway recordings ticked, bar reads
> “3 selected”, confirm names all three, OK, and exactly those three are gone
> with the other four untouched. Twelve checks in `check_sessions.js` (48
> total) cover the selection rules without a DOM.
>
> **2026-08-20 (fifth) — a track you have driven should look like the track
> you drove.**
>
> `gpAutoSetUp` put a start/finish line on a recognised circuit and stopped
> there. So a track that arrived from a recording was a gate marker floating
> on satellite imagery with nothing to place it against — and the Tracks map
> made that worse, because both places that frame it did the same thing:
> `setView(start_finish, max(zoom, 18))`. At zoom 18 the circuit is entirely
> off screen and the only thing you can see is the line. “It only shows the
> start finish points” was a literal description of the view.
>
> The shape was always obtainable — the Tracks inspector has a button that
> takes it off a lap — but a button you have to find is not the same as the
> track having a shape. `gpShapeFromDrive` now does it on load, off the
> quickest lap (the cleanest time round is the closest thing to a centreline),
> or off the whole recording when there is no lap. It runs after the re-split,
> not before, so the shape is ONE lap rather than every lap of the recording
> drawn on top of itself — measured on a four-lap Winton fixture: 2.6 km of
> shape, not 10.4.
>
> It **only ever fills a track that has none.** A shape traced by hand, or one
> that shipped from the survey, beats a single lap of GPS and is left exactly
> where it is — the same rule the OSM adoption already followed, and the one
> the comment there had been describing (“a shape you traced, or took off a
> lap you drove, is yours and beats the survey”) since before anything took a
> shape off a lap automatically.
>
> And `gpFrameTrack` replaces the two copies of the zoom-18 rule: a track with
> a shape is framed by its shape; one without still opens on the gate, because
> then the gate genuinely is all there is to look at. Gate placement was the
> thing to check after that — `gpPlaceGate` drops at the map centre, which is
> now the infield rather than the old gate — and it is unaffected, because the
> work is done by `gpSnapGate`'s 600 m snap and not by the zoom: measured live,
> Re-place start/finish landed **4 m from the driven line**, “Snapped onto the
> driven line, aimed the way the car went.”
>
> Verified live: Donington went from `NO SHAPE` to `62 pts (lap) + gate` on
> opening the Lotus session, the inspector reads “Shape drawn from a lap”, and
> the Tracks map draws the whole circuit in gold with the gate on it. Mallala's
> 55-point OSM ring was untouched beside it. Sixteen checks in
> `check_autotrack.js` — including that the shape is one lap not four, that a
> traced or surveyed shape survives, that a run-split recording gets one too,
> and that a recording too short for a shape does not get a two-point smear.
>
> One thing the fixture taught, worth keeping: **a straight line is two points
> after RDP, and a two-point shape is not a shape.** The first version of the
> runs fixture drove in a straight line and silently produced nothing.
>
> **2026-08-20 (fourth) — a recording with no line is still a set of runs.**
>
> A drift day does not necessarily have a gate, and often cannot have one.
> Both shapes it actually takes ended in the same place:
>
> - *A one-way run through a course.* `gpProposeLine` looks for a LOOP to
>   close on — `gpLoopClosure` walks forward until the car comes back within
>   `GP_CLOSE_M` on the same heading — and there is no loop, so it returns
>   null and no line is placed.
> - *A skid pan that IS a loop.* A line gets proposed and then thrown out:
>   `gpAutoLine` checks that the lap times do not scatter more than 35%, and a
>   “lap” holding the queue between two runs is minutes long against a run of
>   forty seconds.
>
> Either way `gp.traceLaps` came back empty, and every view built on laps said
> so — including the whole Drift board, which is the point of the exercise.
>
> But the boundary was in the data the whole time: **the car stops between
> runs.** `gpMoveRuns` cuts on it, from either signal, because both occur. The
> puck writes nothing under 8 km/h, so a stop is a hole in the CLOCK; an
> imported log records straight through it, so a stop is also a stretch of
> near-zero speed. Five seconds of either ends a run; eight seconds of movement
> makes one. It runs only after the gate splitter AND the auto-setup have both
> produced nothing, and only when it finds at least two runs — one run is the
> whole recording, and calling that a run says nothing the “whole session” row
> does not already say.
>
> **They are called RUNS, not laps.** `gp.lapsFrom` records where the set came
> from and `gpRunWord` reads it, so a stretch with no timing line behind it is
> never labelled as though it has one — and no reference is auto-picked,
> because there is no lap time to be quickest at. Fourteen hardcoded “lap”s in
> the Drift view and one in the map legend went with it; the view now reads
> “run 1 of 4”, “Every corner, run 1”, “this is your best run here”.
>
> And the empty state it leaves behind is a different sentence, because
> reaching it now means something else: not “no line” but “no line AND the car
> never stopped”. Naming the one remedy that used to be the only one would
> send someone to place a gate when what they actually have is a continuous
> drive.
>
> Verified end to end against two synthetic imports with no gate anywhere: a
> generated VBO of four one-way runs (→ Run 1–4 in the lap list, Drift past the
> “no laps” wall) and the Mallala drift mock cut into four windows so the
> discarded stretches become holes in its clock (→ the full board, with angle:
> “Turn 1, run 1, 3.0 of 5, 20° held ±3°”). Plus eleven checks in
> `check_autotrack.js` — both stop signals cut, a two-second hesitation does
> not, a three-second shuffle is not a run, a single unbroken drive is left
> alone, and a recording that DOES have a line is still timed as laps.
>
> **2026-08-20 (third) — a drift day is not a circuit day, and both stint
> thresholds were circuit numbers.**
>
> The pattern is: queue two to six minutes with the car stopped, take a run of
> twenty to sixty seconds, queue again. The recorder writes nothing under
> 8 km/h, so the queue is a hole in the clock and the ring comes down as a
> string of short bursts. `gpSaveStints` cut it in the wrong place twice.
>
> *`GP_STINT_MIN_S` was 90 s — "shorter than this is a shuffle, not a
> session".* Not one run of a drift day reaches ninety seconds. So the filter
> came back EMPTY, and the fallback — `keep = all.slice(-1)` — saved the last
> run and threw the other seven away. Simulated against the shipped splitter:
> **eight runs in, one 29-second recording out**, silently, with no way to get
> them back. It is 20 s now, which is twenty seconds of the car actually
> moving; a paddock shuffle does not reach it and a drift run clears it with
> room. And when nothing clears the bar, the bar is wrong for that recording —
> so all of it is kept rather than a guess at which burst mattered.
>
> *`GP_STINT_GAP_S` was 180 s.* Fixing the floor alone would have made every
> run its own recording, which is worse in a subtler way: the entire Drift view
> is built on comparing the runs INSIDE one recording — best per corner across
> laps, "your best here was lap 3". Seven one-run recordings can be looked at
> but not compared, and comparison is the feature. Ten minutes now: longer than
> any queue, shorter than a lunch break or a tyre change. Erring LONG is the
> safe direction — an outing that should have been two is still completely
> analysable, since gpStep already clamps the hole so nothing accumulates
> across it, whereas one that was split has had its comparison taken away.
>
> *And spins, which a drift day is guaranteed to produce, had no coverage at
> all.* `gpDriftSpun` was extracted by the harness and never exercised. Now:
> past 100&deg; is called a spin and says how far round it went; a drive that
> never over-rotates is not accused of it; still 45&deg;+ sideways below the
> readable speed is reported as a DROP rather than an over-rotation, because
> those are two different amounts of certainty and the view prints two
> different explanations off them; stopping straight is not a spin; a slide
> that gets caught and driven on is not one either; and nothing the engine
> calls spun is ever given stars, since nought would read as a corner driven
> badly rather than one nobody finished.
>
> Writing that fixture found the assumption worth recording: **a car at
> 60&deg; of slip whose COURSE does not change and which carries no lateral
> load is, by every measurement the engine has, going straight.** The first
> version held exactly that for eight seconds and was correctly zeroed. A spin
> keeps rotating while the speed collapses, and the fixture has to as well.
>
> **2026-08-20 (later) — the drift day: sessions in an order, and Drift and
> Corners under ADR-0043's rule.**
>
> *Sessions had no order.* The table printed whatever the object store handed
> back, which is insertion order — so a re-import, or a download that landed
> after one, appeared wherever it happened to land. A track day is six or seven
> recordings in one afternoon under a Date column that said the same thing on
> every row. Newest first now, with the date shown once per day and the CLOCK
> on every row, and every column that is a number or a time sorts on its
> header. Ties break on the id so two recordings sharing a stamp keep a stable
> order instead of swapping places between renders.
>
> *Drift and Corners were the two views ADR-0043 had not reached.* Both are a
> map beside a column, and in both the column had its own scrollbar: Drift held
> **1116 px of content in a 546 px box**, with the lap table and the whole
> explanation of how a corner is rated below a fold that nothing announced. The
> view is the scrollport now and the column is as long as what is in it — with
> the map STICKY, because on these two screens reading one line against another
> is the analysis, and losing the map to read the table would be keeping the
> wrong half.
>
> Three smaller things went with it, all of the same kind — a rule written for
> Analyse that stopped at Analyse. The transport **dock sat above the map** in
> Drift and Corners and below it in Analyse, because the markup declares it
> before those two wraps; it is `order: 9` now, last in the stage wherever it
> appears. The **puck-connection hint** was suppressed in Analyse only, so it
> came back the moment you switched tabs, about a state that had not changed.
> And the **circuit search** sat over the bottom-left of the map in both — that
> is how you set a track up, not how you read one you have already driven.
>
> *The map lost its framing between views.* Drift hosts it in a ~780 px cell
> and Corners in a 340 px one, and `gp.framed` marked the recording framed for
> whichever you saw first. Measured: **zoom 17 in Drift, 15 after a trip
> through Corners, and it never came back** — the whole circuit as a postage
> stamp. A fit belongs to the box it was made in, so it is re-fitted when the
> box changes by a QUARTER or more. Less than that is a divider nudge or a
> window resize, and a zoom the driver set has to survive those: Analyse
> rebuilds its panels on every render.
>
> *And the one thing you cannot fix after the fact.* The readiness card checked
> fix, track, start/finish, the node's own copy, recording and storage — and
> said nothing about **angle**, which is the prerequisite a drift day has that
> a lap day does not. Two things have to be true: the IMU has to be talking,
> and the ring has to have somewhere to put what it says. A 12-byte fix drops
> the gyro silently (measured on fw 0.1.0 as late as 2026-08-12), so a whole
> day comes back with lap times, a map, and no angle anywhere in it. The card
> now answers it before the drive, pinned when it will NOT work so it shows
> without expanding — and kept out of the verdict either way, because Studio
> cannot know whether today is a drift day and turning a circuit driver's card
> amber over a channel they will never open is crying wolf.
>
> Covered by `tools/check_sessions.js` (26 checks: newest first, every column,
> reversal, stable ties, and the filter still filtering) and
> `tools/check_autotrack.js` (the card names the remedy not the symptom; the
> channel tail is not mistaken for gyro room; a working puck says nothing when
> collapsed; and the framing ratio re-fits a different box but not a nudged
> divider).
>
> **2026-08-20 — the ghost was on a coarser clock than the car, and the
> sectors were in the wrong panel.**
>
> *The ghost car dragged during playback.* The ticker turns a wall-clock
> moment into a sample plus the fraction of a step past it, and the car is
> drawn between the two fixes — that is what stopped it hopping. The ghost
> asked `gpSecs(rows, lap.from, gp.playIdx)` for the time to place the
> reference lap at, which is the same figure rounded DOWN to the sample
> below. On the 10 Hz Donington import that clock only advanced every other
> ticker frame, so the ghost stood still for a tenth of a second and then
> jumped, twenty times a second, against a map panning smoothly underneath
> it. Measured before the fix: its screen position alternated between two
> values a pixel apart at 10 Hz, net zero drift over 200 ms. After: it
> advances monotonically, one step per frame, in lockstep with the car.
>
> `gpPlaySecs` is the fractional answer and everything that has to move as
> smoothly as the car reads it — the ghosts, the POSITION readout, seeking by
> seconds, and the anchor playback resumes from. The fraction also now records
> WHICH index it was measured against (`gpPlayFrac`): a dozen places move the
> playhead by assigning `gp.playIdx` directly — the four transport buttons,
> the coach jumps, rolling over into the next lap — and a fraction that
> outlived its index was drawing the car past the wrong sample. Pressing
> “back to the start” landed it a fraction of a step into the lap.
>
> *The sectors were computed for a panel most people never opened.*
> `gpSectorChips` — the purple/green/red sector row from the retired laps
> rail — had been dead code since ADR-0025 turned Analyse into panels: defined,
> never called. So “which third did I lose it in”, which is a question you ask
> while reading the list of lap times, needed a second panel to answer and
> mostly went unasked. Every lap line carries its own sectors now, marked
> three ways: session best solid, quicker than the reference green, slower a
> red tint. The first attempt gave best and slower the same red-100 ground,
> which left the one sector worth finding indistinguishable from the two
> thirds of the list that were merely off the pace.
>
> *And the panel they came from earns its name.* **Splits** is now
> **Sectors** — the gates are splits, the stretches between them are sectors,
> and the panel shows the second. It gained the two things a timing screen has
> that it did not: a **Best** row stating each sector's fastest time and which
> lap set it (`gpSessionSectors` had been computing the owner all along with
> nowhere to print it — the ideal lap was a single figure with none of its
> working), and a **Times / Deltas** toggle. Deltas measure against the
> reference lap, or against the best sector when none is set, and the heat
> still grades the TIME in both modes so a column stays readable as a column.
>
> Two “best”s meet in that grid — the quickest lap, which is a row, and the
> quickest sector, which is a cell — and they had the same fill, so inside the
> quickest lap's row the cells vanished. The lap is marked at its edge now.
>
> Covered by `tools/check_playhead.js` (the round trip: every moment the
> ticker computes survives being read back by the ghost, worst drift < 1e-9;
> and a fraction measured against another sample is ignored) and
> `tools/check_autotrack.js` (the Best row adds up to the ideal lap printed
> under it; deltas fall back to the best sector with no reference set; a track
> with no sector lines adds nothing at all to the lap line).
>
> **ADR-0043, 2026-08-20 — a panel is as tall as what is in it.** ADR-0026
> gave the mosaic a rule for height — divide the window between the rows, and
> past a floor let the page scroll — which answered "what happens when you add
> a sixth panel" but not "what happens to a panel given less height than its
> contents need". The answer it had was: that panel scrolls inside itself. Four
> panels is then four scrollports plus the page, and the wheel goes to whichever
> is under the pointer, which is not reliably the one you meant.
>
> It also hid things without saying so. The shipped `QUAD` at 1280×690 — Studio
> at half a 3840 ultrawide, which is how it is used — gave Lap times 223 px for
> 312 px of list, so Donington opened parked on **Lap 2**, with Lap 1 above its
> own fold and nothing on screen distinguishing that from a session that starts
> at lap 2. And the same rule was deciding how tall a speed trace could be: the
> row split chosen for the map set the rack's lane height, already clamped at
> its 26 px floor in a six-lane quad.
>
> So a panel is measured now. A **document** — lap times, report, corners,
> splits, history — gets exactly the height its content ends at; the **rack**
> asks for all its lanes at a readable height rather than what is left over; a
> **map** asks for about half its own width, because a picture has no natural
> height, only a shape. The page is the only thing that scrolls. Spare height
> goes only to the panels that can use it — another 80 px of lap list is 80 px
> of nothing — and a shortfall under 48 px comes back out of them, because a
> page that scrolls by thirteen pixels is worse than a rack whose lanes are
> thirteen pixels shorter.
>
> Content height is where the content *ends*, not `scrollHeight`: at rest that
> is just the box, so measuring with it would ratchet every panel up to whatever
> height it last had — open a seven-lap session after a forty-lap one and the
> list would keep the taller one's height forever.
>
> `FIT | TALL` becomes **`FULL | FIT`**, and FULL is the default. FIT is
> ADR-0026's behaviour, kept, because packing everything into one screen is a
> legitimate thing to want. TALL — every row given a flat 260 px — was a number
> nobody chose and is gone. Dragging a row divider is the one gesture that
> contradicts auto height, so it turns it off; FULL hands it back. Panel headers
> are sticky, above Leaflet's controls, or the map's + and − punch through them.
>
> **Three bar defects surfaced while measuring it, all the same shape.**
> *Arrange could not be clicked at all* — last child of a `flex: 1 1 auto;
> overflow: hidden` bar that the circuit name and tags already overran at
> 1400 px, so it rendered at x=1091 in a box ending at 1067 and was clipped
> away, taking every preset, every saved arrangement and the fit rule with it.
> It is a sibling of that bar now. *"Connect over USB" wrapped to three lines*
> inside a 30 px button and spilled under a 50 px bar. *The circuit search sat
> over the map's bottom-left corner* in every Analyse arrangement — that is how
> you set a track up, not how you read a lap you have already driven.
>
> Verified by `tools/check_gridfit.js` (29 checks over `gpFlowH`,
> `gpNodeWantH`, `gpNodeElastic` and `gpSpineFill`) and in the running app over
> CDP at both widths: all eight panel types placed in turn, every one reporting
> `scrollHeight - clientHeight === 0`.
>
> **Analyse test sweep, 2026-08-13.** Every panel, control and gesture on the
> Analyse screen driven against a five-lap Winton fixture with two named
> sectors, two CAN channels and a 130 s clip. Most of it held: the mosaic keeps
> its 150 px row floor and extends below the fold rather than squeezing; drag
> swaps and edge-drops land where the drop hint says; dividers cascade and give
> height back; the transport, the keyboard and the video sync are exact to the
> sample; the split grid's sectors sum to the lap; corner deltas negate exactly
> when the two laps are swapped (ADR-0027's claim, re-proven live); and the
> corner jump leaves both zooms pixel-identical. Eight things did not hold.
>
> **Three were the same mistake in three places, and it is ADR-0025's.** When
> Analyse became panels, the surfaces that used to redraw through
> `gpRenderInspector` kept calling it — and it now draws a rail no view renders.
> So an action would change the state, redraw the map, and leave every panel
> showing the previous answer until an unrelated click happened to rebuild the
> grid. *Switching units* put 123 mph in the dock and 199 km/h in the report
> panel beside it. *Comparing against another day* looked like a button that did
> nothing at all: the map quietly repainted against the other day while the lap
> list, the dock and the corner table went on saying "vs lap 1". Both now render
> the grid. The lesson is that anything reachable from Analyse which changes what
> a panel would say has to say so, and `gpRenderGridSoft` is how.
>
> **A sign was inverted in one panel out of five.** Every surface in the app
> states a time loss as positive — the lap list's "+0.56", the dock's "Δ +0.56
> s", the Corners view's "Time lost +0.12" — except the Analyse corner panel,
> which printed the same `gpCoachOps` figure as "−0.12". A corner you lost two
> tenths in read as a corner you gained them in, next to a lap list using the
> opposite convention. It also never said what the corners added up to, so a lap
> six tenths slower with every corner on pace invited exactly the wrong
> conclusion; it now carries the Corners view's "s available".
>
> **History had no route to the screen.** `gpHistoryHtml` — the trend across
> saved days at a track, the personal best, the since-last-visit corner deltas —
> was only ever called by the one-column inspector ADR-0025 retired. It has been
> a panel type since today ("History at this track"), which is where the question
> is asked. Two things were in its way: an imported recording carries
> `trackId: null`, meaning "never said", and *borrows* the active track to cut
> its laps — a borrow that was never written down, while the trend filters
> session metadata strictly on `trackId`. So every imported day, and every sim
> stint from `ac_record.py`, stayed invisible to the trend no matter how many
> were saved. The load-time healing write that already repairs lap counts now
> records the track those laps were timed against, laps on the board being the
> evidence the borrow was right.
>
> **And four smaller ones.** The channel popover anchored to the Live view's
> button, which is present but 0×0 in Analyse — so a 389 px list landed at (8, 8)
> in the far corner, over the map, while the button that opened it sat a thousand
> pixels away; and that button could not close it, because the dismiss handler
> named only the Live one, so its own click reopened what the mousedown had just
> shut. The navigator strip could only be zoomed by a 6 px sliver at the very end
> of the canvas: with the whole lap showing there was nothing to pan, so dragging
> across the middle — the gesture the strip looks like it wants — did nothing at
> all, silently. A CSV column header lost any unit written in symbols, so the
> throttle column came out as `Throttle_` and `°/s` collapsed to `_s`, which in a
> spreadsheet next season reads as seconds. And the lap list measured "whole
> session" to the end of the array rather than the end of the recording, so a
> loaded ghost lap — appended behind `gp.ghostFence`, carrying another day's
> clock — made a 5.6 minute session report 1.9 minutes.
>
> Two test aids were fixed on the way, both of the same kind as the bugs:
> `check_ac_session.js` demanded a file path, so `check_all.js` counted it as
> DEAD on every run — the exact failure that harness exists to catch — and it now
> makes its own fixture. `make_fixture.js` wrote channel columns with no
> definitions and printed a `localStorage` line to paste by hand, which reads as
> an app fault: throttle showed as "avg pedal 628%", the raw ×10 count, and looks
> exactly like a scaling bug in the report. The fixture describes itself now.
>
> **ADR-0028, 2026-08-13 — a sim lap is a recording like any other, once you
> tell it where on earth it happened.** Assetto Corsa publishes the car to
> Windows shared memory at about 333 Hz, so a stint can be recorded without
> the game knowing. `tools/ac_record.py` reads it at 25 Hz — the puck's own
> rate, so a sim recording and a real one are the same shape of thing — and
> writes a `.rdmsession` the Session view imports unchanged.
>
> It writes the session format rather than VBO, which was the obvious first
> guess. VBO is the portable one, but it is 10 Hz text with no place for a
> channel's scale, and Studio already exports VBO *from* a session — so
> writing the native format loses nothing and gets Circuit Tools for free
> anyway. Fidelity in, portability out.
>
> **The hard part is that a sim has no GPS.** AC gives world coordinates in
> metres on a track-local grid whose origin and north are arbitrary, and the
> format wants latitude and longitude. So the metres are pinned to the real
> circuit: an anchor point plus a rotation, projected through a local tangent
> plane, which over the five kilometres a circuit spans is wrong by
> centimetres against a proper geodesic — irrelevant next to the 2.5 m fix it
> is standing in for. The anchor comes from `GP_PLACES`, parsed out of
> `tauri-overlay.html` at run time rather than copied into the tool, for the
> same reason `check_autotrack.js` extracts the real functions: a copy drifts,
> and then the tool anchors a lap at a circuit the app has since moved.
>
> Rotation is the one thing that cannot be derived from a single anchor point,
> and AC's world is left-handed, so seen from above a track also comes out as
> its own mirror image unless one axis is turned over. Both are settable by
> hand (`--rotate`, `--mirror`), and `--fit` solves both from a real track
> outline by brute force over every half-degree in both mirror states. It is
> worth knowing that **only the picture depends on getting this right** — lap
> times, speeds, distances and deltas are all rotation-invariant, so a
> recording anchored at the right circuit but turned the wrong way is fully
> analysable and merely sits crooked on the basemap.
>
> **AC's own lap times are printed, not written into the file.** The fields
> are left at 0 and `[]` exactly as a VBO import leaves them, so Studio times
> the laps off the track's gates by the path that is already proven. That
> turns the sim's timing into an independent check on the whole chain: if the
> gate timing agrees with what AC said, then the frame, the projection and the
> sample rate are all right. Writing both would have been two answers to one
> question, and no way to tell which was lying.
>
> Nine channels come across, including one the real hardware cannot measure:
> **slip angle**, exactly, from the angle between the car's velocity vector
> and where it is pointing. The puck has to infer that.
>
> Verified with `--selftest`, which drives a synthetic lap through the real
> writers, and `tools/check_ac_session.js`, which reads the result back with
> Studio's own `gpSessionFileParse` and `gpMatchTrack`: 25.0 Hz, time
> monotonic, heading sweeping all 360°, every channel live and none of them
> constant, u16 packing holding one part in 65,534, and the lap landing 0.52 km
> from Winton and being recognised as it. **Not yet run against the game** —
> the struct layout is guarded by ten runtime sanity checks (`--check`)
> instead, because a misread struct produces a file full of plausible numbers,
> and that is the failure that wastes an afternoon.
>
> One trap found on the way, worth writing down because it is the same class
> of failure: `mmap.mmap(-1, n, tagname=...)` on Windows **creates** the
> shared-memory page when it does not exist, even opened read-only. With the
> game shut, the reader therefore succeeded and returned zeros — and zero is
> an ordinary reading for speed, throttle, rpm and position, so the tool
> recorded a stationary car at the origin and reported no problem. The pages
> are now probed with `OpenFileMapping`, which refuses.
>
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
