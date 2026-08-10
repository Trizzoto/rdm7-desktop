# Drift course configuration — plan (2026-08-11)

**Status: PLAN, nothing built.** Written to be read and argued with before any
code moves. Companion to `DRIFT_MODE_PLAN_2026-08.md`, which is the feature as
it stands today.

## 1. The ask

> "I would like to be able to set my own corners track. sometimes not all of
> the track is going to be drifting. some of it's where you stop with the cones
> and stuff. so I think we do need some sort of input where you can modify the
> track start endpoint corners. you can adjust and decide where each corner is."

Three things, and they are not equally hard:

1. **The drift course is not the whole lap.** Part of the circuit is transit —
   driving round to the section, stopping at the cones, going back.
2. **Its start and end are yours to set**, not the circuit's start/finish line.
3. **The corners are yours to set.** Where each one begins, where it ends,
   which ones count, and which of them are one drift rather than two.

## 2. Two of the three already work

This is the important finding, and it makes the build much smaller than the ask
sounds.

**A track that carries a `finish` gate already splits into RUNS, not laps.**
`gpSplitRows` does it today: a start crossing followed by the next finish
crossing is one span, and only ever one run per start. That is the shipped
point-to-point machinery from ADR-0013 — *"a finish line is a thing you add,
not a mode you pick"*. So "set my own start and end point" is already
expressible: put a start gate at the cones you launch from and a finish gate at
the cones you stop at, and every pass between them becomes an assessed span.

**The app even already knows what to call them.** `gpRunWord()` returns "run"
for a track with a finish gate and "lap" otherwise. Analyse uses it. Drift does
not — Drift hardcodes "Lap" and "Laps" everywhere, which is the only reason a
gated drift course would read wrong today.

**And gates are already editable**, in Tracks: `gpDrawEditor` builds draggable
centre and end handles per gate, keeps them in `gp._gateViews`, and
`gpRefreshGate` moves the geometry as you drag. Nothing about that needs
inventing.

**Bonus that falls out for free:** `gpTrackSend` already whitelists
`point_to_point` + `finish` when sending a track to the puck. So a drift course
defined this way can be pushed to the node, and it will time and beep at your
own entry line trackside, with no new firmware and no new Studio code.

So of the three asks, **only the corners are genuinely new work.**

## 3. What is actually missing

The corner set is **derived fresh every time and stored nowhere**. Today
`gpDriftCorners()` runs `gpFindCorners` (speed minima) on whichever lap has the
modal corner count, and maps that onto every other span. There is no
representation of "a corner" that survives the session, and therefore nothing
to edit.

That is the whole gap. Everything downstream — reading a corner, rating it,
linking it, comparing it across spans — already takes corner boundaries as
input and does not care where they came from.

## 4. The model

Corners hang off the track record, beside `start_finish`, `sectors` and
`outline`, exactly as `courses:[]` used to. Studio-side only; `gpTrackSend`'s
whitelist keeps it off the wire.

```js
track.drift = {
  seeded: "auto" | "hand",       // where this set came from, for honesty
  corners: [{
    id:        "c3",
    name:      "Turn 3",         // or "the bowl" — it is your course
    at:        [lat, lon],       // the apex: where the corner IS
    before_m:  55,               // how far back along the driven line it starts
    after_m:   70,               // how far past it ends
    link_next: null,             // null = work it out | true = always one drift | false = never
    assess:    true              // false = you drive it, it is not scored
  }]
}
```

**Why position and metres, not sample indices.** A sample index means nothing
in the next session. A lat/lon plus a distance either side is portable: the
same corner, every session, every car, forever. Mapping it onto a recording is
`gpNearestIndex` under the existing 40 m rule for the apex, then walking out by
`gpArcLength` — both already in the file and both already used for exactly this
by `gpCompareLaps`.

**`link_next` is the direct answer to "these corners are always linked".**
Today linkage is inferred (a single drift segment spanning two apexes, on at
least half the spans). That is a good default and a bad law — a driver learning
to link a complex crosses the threshold mid-session and the table changes shape
under them. A three-state override — auto, always, never — settles it.

**`assess: false`** is the cones. A corner you drive through on the way back,
or a turnaround, stays visible on the map and out of the rating.

## 5. Interaction

### Where it lives

**In the Drift view, behind an Edit toggle in the toolbar.** Not in Tracks.
The reason is the same one that moved the retired clip editor into Drift and
was worth recording at the time: you adjust a corner boundary and want to see
the stars move. Gate placement stays in Tracks, where it already is, with a
link across.

### On the map

Reusing `gpDrawEditor`'s handle vocabulary, so it looks and behaves like gate
editing already does:

| Handle | Does |
|---|---|
| apex marker | drag along the driven line to move the corner |
| two extent handles | drag to set where it starts and stops |
| click the line | add a corner there |
| click a corner badge | select it |

### In the panel

The corner table gains an edit mode: rename, delete, **assess** on/off, and a
three-state **link to next** control between adjacent rows. Plus one button —
**Find them for me** — which runs today's auto-detection and writes the result
in as editable corners. That is the on-ramp: nobody starts from an empty map.

## 6. Rules that keep it honest

- **Auto-found and hand-placed must look different.** Precedent: a derived
  start/finish carries `derived: true` and says so on screen. A corner set
  seeded by the detector and never touched should say so too, because "the app
  guessed this" and "I placed this" are different claims about the same line.
- **Nothing stores a score**, so nothing needs re-stamping when a layout
  changes — every rating is computed live from the current corners. Moving a
  boundary moves the number in front of you, which is the point.
- **A corner nobody drifted stays unrated, not nought-star**, however it was
  placed. That rule does not change.
- **A hand-placed corner that no span comes within 40 m of reads as not
  driven**, the same as an auto one. Placing a corner somewhere you never went
  must not invent a reading for it.

## 7. Phases

| Phase | What | Size |
|---|---|---|
| **1** | Drift honours gated courses: use `gpRunWord`, stop hardcoding "Lap". A start+finish track already works after this. | small |
| **2** | Stored corner set + panel editing: seed from auto, rename, delete, assess, link override. No map dragging yet. | medium |
| **3** | Map editing: drag the apex, drag the extents, click the line to add. | medium |
| **4** | Multiple named courses per track, if one is not enough. | small, deferred |

Phase 1 alone gets you a working drift course today, with auto corners inside
it. Phase 2 is the one that answers the actual ask.

## 8. Decisions I need from you

1. **One drift course per track, or several named ones?** A track might hold a
   short course and a long one. Several is more code and more UI; one is
   probably right to start. → *I would do one, and add names in phase 4 only if
   you hit the limit.*

2. **Course as gates on the track, or as its own track record?** A drift course
   IS a point-to-point track under ADR-0013, so "Mallala Drift Course" could
   simply be a second track sharing the same outline — zero new span code, and
   `gpGateToSiblings` already shares gates between tracks at the same place.
   The alternative keeps one track record and hangs drift gates off it. →
   *I lean towards a separate track: it reuses everything and the puck can time
   it. But it clutters the track list, so your call.*

3. **Should the drift course be pushable to the puck?** It costs nothing —
   `gpTrackSend` already supports it — and gives you a trackside beep at your
   own entry line. → *I would do it.*

4. **When nothing is configured, keep today's behaviour?** Auto corners over
   the whole lap, exactly as now. → *Yes, unless you disagree — it means this
   feature is purely additive and nothing you have already breaks.*

5. **How much should a hand-placed corner be allowed to disagree with the
   data?** If you put a corner on a straight, it will read no drift and rate
   nothing. Do you want a warning, or is silence correct? → *I would let it be
   silent and simply read "no drift here" — the tool should not argue with you
   about where your course is.*
