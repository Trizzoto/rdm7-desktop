# Brief 8 — footage in sections

Asked for on 2026-09-02, in these words: *"a video timeline style somewhere that you can
drag around videos on like adobe premiere, where it's layers, so you can drag multiple
videos around in case you didn't record the entire thing, just sections at a time. Then
when there's no video playing a placeholder or just something visually entertaining shows
in the video box, like channels into visuals."*

Owns **ADR-0053**. Harness: `tools/check_clips.js` (64 checks), plus two new checks in
`tools/check_transport.js`.

## What we are building

Two things, and the second only exists because of the first.

1. **A recording holds as many sections of footage as you shot.** Each one sits on a lane
   at a position; lane 0 covers the lanes beneath it; the recording itself is the track
   they are lined up against. Drag a section along the timeline to move it, drop it on
   another lane to stack it. Drop files onto the timeline to add them.
2. **A gap between sections is drawn, not left blank.** No footage at this instant is an
   ordinary, correct answer — and before this it presented as a frozen frame or a black
   rectangle beside readouts that were still moving, which reads as a broken player. The
   tile now paints the channels instead.

## Why one video per recording was the wrong shape

`gp.video` was a single object. `gpVideoBegin` revoked the previous blob url and
overwrote it, so **opening the second file threw the first away** — and a lap the second
card covered simply had no picture, with nothing on screen explaining why.

That is not an edge case. A track day is three or four cards. A GoPro splits at 4 GB. A
phone in a windscreen mount stops when it gets a call. The one thing every one of those
produces is *a recording with footage over part of it*, which is precisely the case the
model could not express.

Two smaller things fell out of the same assumption:

- **The alignment slider was the only way to place footage**, and it reaches ±120 s. A
  section filmed twenty minutes into a session cannot be nudged into place; it has to be
  *put* there. A timeline is the control that does that.
- **`gpVideoCover` already knew how to say "this footage reaches 0:00–0:20 of an
  eleven-minute session"** — it just had nowhere to draw it, so it said it in words at
  the bottom of the video panel. The timeline is that sentence as a picture.

## The design

### The model

`gp.clips` is the list. `gp.video` is still **one clip — the one in the picture** — so
every existing reader of it is unchanged, and that was the constraint that kept this from
being a rewrite. Roughly forty places read `gp.video` or
`document.getElementById("gpVideo")`; none of them changed.

```
clip = { id, name, path, url, blob, reader, size, dur,
         t0, offsetMs,          /* the clock, and the nudge  */
         src, autoT0, fileT0,   /* which clock, and what it said */
         lane, placed, dead }
```

A clip covers `[t0 + offsetMs, + dur)`. **A clip whose duration has not arrived covers
nothing** — a loading clip must never win a lookup, or the picture switches to a section
that cannot yet be shown.

### One `<video>` per clip, and the id moves

The switch between sections has to be instant, and it has to leave
`getElementById("gpVideo")` working. So each clip decodes in its own element, all of them
live in the tile, and **the active one wears the id** (`gpClipActivate`). Elements are
pooled: a removed clip hands its element back with its source dropped.

`visibility: hidden`, not `display: none`, for the inactive ones — a
hidden-by-display video is not laid out, reports no size, keeps no decoded frame, and
flashes black on the switch.

Two consequences that cost a bug each, and are now commented where they bite:

- **Stand the outgoing element down *after* the id has moved.** Pausing it fires the
  pause handler, and that handler stops the whole replay when the element it fires on is
  the active one. Stopping the old clip first ended playback every time the footage
  crossed from one section into the next.
- **Every listener in `gpVideoBind` speaks for the whole replay**, so one firing on a
  section that is not on screen must say nothing. Hence `mine()`.

### Which section is showing

`gpClipAtUtc` resolves, in order:

1. a section the user has **picked**, for as long as the playhead is inside it — the only
   way to look at a clip that something above it is covering, and cheaper than a Solo
   button nobody would find;
2. the **lowest lane number**;
3. inside one lane, the **later** clip.

A pick also survives for a section dragged *off the end of the recording*, which the
playhead cannot get inside — otherwise selecting it in order to drag it back would take
the controls off it (`gpClipReaches`).

`gpClipSyncFor(i)` is the switch, and it hangs off `gpVideoFollowSeek`, which every path
that moves the playhead already goes through. It is an identity test and a pass over a
handful of clips, because `gpDrawPlayhead` is a caller and runs once per presented frame.
The two playback handover points — `gpPlayToggle` and the ticker — ask it **before** they
look the element up, since with sections the element *is* whichever section the answer
names.

### Placing a new section

A section with a clock of its own places itself, exactly as before. One without — no
camera time, no log anchor — used to land at the start of the recording, which is right
for the first clip and the **worst available guess for the second**: it stacks every
section on top of the first. "I recorded it in pieces" almost always means consecutive
pieces, so `gpClipButt` puts it end to end with the last one.

Two sections of the same moment are two cameras, and `gpClipLaneFree` puts them on two
lanes. Stacked on one, the lower is unreachable and looks lost.

### What is stored

`meta.videoClips` — every section, with its lane and nudge. The first is **mirrored onto
the three keys that existed before sections did** (`videoPath` / `videoSrc` /
`videoOffsetMs`), because `gpGhostVideoTimeFor` reads those directly for a lap borrowed
from another day, and a session written by this build gets opened by builds that are not
this one.

`gpVideoRelink` loads the list. When a file has moved, **only that entry comes out** —
re-deriving the stored list from the live clips there would be a write on top of sections
that are still probing their clocks, and would save every one of them with the nudge it
has not been given back yet.

## The field behind the film

`gpVideoBgDraw`, on a canvas *behind* the video elements, so it also fills the letterbox
bars of a portrait clip rather than leaving two dead black margins.

It is deliberately **not** a second instrument cluster — the HUD is already drawn on top
and says the numbers. It does the thing a number cannot:

- a field of light streaks moving at the speed the car is moving, leaning with lateral g,
  tinted green on throttle and red under brakes. You can tell a braking zone from a
  straight across the room with no footage of either;
- the last twelve seconds of every channel the car actually reports, along the top;
- one line saying *why* there is no picture — "no footage — next section in 0:03" — so
  that nothing looks broken.

It runs only while the replay does. A paused replay is showing one moment, and a moment
does not move.

The alpha was **measured, not guessed**: at the first values the whole field sat between
luminance 11 and 25 on a plate of 10, which is a backdrop nobody can see.

The same canvas is what an **empty** Video panel shows. The red "No video loaded" placard
is gone: the tile is worth looking at either way, and a full-panel placard would have
been covering up the thing that replaced it.

## Where it lives

- **`Footage timeline`** is a panel type like any other, so it can be chosen from any
  panel's type list. Nobody finds it that way the first time, so the Video panel carries a
  **Timeline** button (`gpClipsPanelReveal`) that shows the one already open or cuts the
  video panel in two and puts one below it — the Premiere layout, recoverable in one
  click like every other panel.
- **A compact strip** rides inside the video panel's own control row when there are two or
  more sections **and** no timeline panel is open. One section has nothing to arrange, and
  a window that already has the full timeline has somewhere better to drag.
  One renderer, one density flag — two of these would have disagreed about something
  within a week.

## What is deliberately not here

- **Export still writes one section.** `gpExportPlan` works on the active clip and clamps
  to it, exactly as before. Burning a gap — which would mean encoding the field as video —
  is a bigger question than this brief, and the coverage line in the control bar already
  says which stretch an export will reach.
- **No trimming, no ripple, no transitions.** A clip is a whole file at a position. The
  timeline is an alignment tool wearing an editor's clothes, and pretending otherwise
  would be promising an NLE this app is not.

## ADR-0053 — *Footage is sections on lanes, and a gap is a picture*

Worth recording because two obvious alternatives are worse and will be proposed again.

**Why not one `<video>` whose `src` is swapped?** Because the swap is the whole feature.
Re-pointing one element drops the decoded frame, reloads, and re-seeks on every crossing
— a visible stall at exactly the moment the user is checking whether two sections line
up. One element per clip costs a decoder each and buys an instant switch; and because the
id moves rather than the state, nothing downstream had to learn that sections exist.

**Why not a second state field for "the clip the controls point at", separate from "the
clip on screen"?** Because that is two concepts to keep in step, and the app has one
question — *what am I looking at* — that they would both answer differently. The pin
(`gp.clipPin`) is the same idea at a fraction of the cost: it says "prefer this one while
the playhead is inside it", and it evaporates on its own.

**Why the placeholder is not just a message.** The gap is where the app most looks broken
and is most obviously fine, and a line of grey text does not carry that. The channels do,
and they were already being computed for the HUD.

Record also: that the mirror onto `videoPath`/`videoSrc`/`videoOffsetMs` is load-bearing
for ghost laps and for older builds; that `gpClipSyncFor` sits in `gpVideoFollowSeek`
because that is the one funnel every playhead move already passes through; and that
standing the outgoing element down must happen *after* the id moves, or the replay stops
at every crossing.
