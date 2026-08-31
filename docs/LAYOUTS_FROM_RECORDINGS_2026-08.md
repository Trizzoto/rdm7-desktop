# Building a dash layout from a recording — plan

2026-08-29. Status: **plan, nothing built.**

## The idea

When a session has CAN data in it, that recording is a complete description of
what the car actually sends. Today it is only used to draw traces. It could
also be used to **build the cluster**: bind widgets to the channels the puck
logged, set every gauge's range from the numbers that were actually measured,
and preview the layout by replaying the lap — so you watch the cluster the way
it would have looked through the windscreen, before it ever goes on the dash.

## Why it is worth doing

Building a cluster for a car today is three disconnected jobs:

| Step | Where it happens now | What you are working from |
| --- | --- | --- |
| Get the channels onto the dash | Setup → Channels, by hand | a DBC, a forum post, or guesswork |
| Put widgets on the screen | Design workspace | a channel list of names with no values |
| Find out whether it reads well | in the car, at speed | memory of what you meant to do |

The recording collapses all three. It already contains the channel definitions,
the real ranges, and a minute of the car doing what it does — which is exactly
what each step is missing.

The design loop that matters: **redline set from the highest RPM the engine
actually saw, not from a number typed in.** Same for the coolant band, the oil
pressure warning, the boost gauge's top of scale.

## What already exists (so this is smaller than it sounds)

| Piece | Where | Note |
| --- | --- | --- |
| The renderer takes a layout and a channel registry | `load_layout_json`, `load_channels_json` | already the editor's backdrop |
| Values can be pushed one at a time | `inject_signal(name, value)` via `injectWasmSignal` | already used by the test sliders |
| An override that beats the bench sim | `_testValues` | the exact hook a replay needs |
| Recordings carry their channel definitions | `meta.chanDefs` — id, name, unit, decimals, scale, offset, signed | rides with the recording, deliberately not in the channel library |
| Which recorded columns never said anything | `gpChanQuiet()` | full-column scan, cached per recording |
| Writing channels to the dash | `POST /api/channels/activate`, `/update`, `/create`, `/import` | plus the baked-in catalogue, so it works offline (ADR-0033) |
| A playhead over the samples | the Analyse view | already scrubs, plays and follows video |

Nothing new has to be invented for the rendering path. The work is plumbing
plus two pieces of judgement (namespaces and ranges), below.

## The one real problem: two namespaces

A recording's channels and a dash layout's signals are not the same thing.

- A **recording** has channel ids, which came from whatever the puck was
  logging — often pulled from the dash itself, sometimes typed in by hand,
  sometimes (for an imported VBO) just a column heading from someone else's
  logger.
- A **layout** binds `w.signal` to a signal name in the dash's channel
  registry.

They line up most of the time and it would be wrong to assume it. So
recordings split into two classes and they get different treatment:

| Recording | Channels carry a CAN decode? | Preview | Push to the dash |
| --- | --- | --- | --- |
| From his own puck | yes — id, scale, offset, signed | yes | yes, this is the point |
| Imported VBO / CSV / other logger | no, name and unit only | yes | no — there is no id or decode to send |

The existing comment on `chanDefs` says why the second class must never quietly
join the channel library: *"They describe someone else's car on someone else's
logger — offering them in Setup as things to tick and log on this puck would be
nonsense."* Adoption stays an explicit act with a review step, never a
side-effect of opening a session.

## Design

### 1. A recording becomes a preview data source

The editor's backdrop has three sources today: the live dash, the bench sim
that sweeps every signal min→max, and the test sliders. Add a fourth —
**Replay** — that reads the sample at a playhead and injects each channel by
name. It is the same override path the sliders use, so it beats the sweep for
free, and it is the smallest possible change to the renderer side.

With a transport bar under the canvas: play, scrub, and a lap picker. Playing
the fastest lap while the cluster is on screen is the whole feature in one
gesture.

### 2. The channel picker offers what the recording proves

When a session is loaded, the widget's channel dropdown grows a section headed
by the session, listing its channels, each with what it measured:

```
From this recording — Mallala, 22 Aug
  RPM              750 – 6 820        moved
  Coolant          78 – 96 °C         moved
  Oil pressure     1.1 – 4.8 bar      moved
  Lambda target    0.78 – 1.00        moved
  Gear             (never moved)      quiet — nothing arrived
```

`gpChanQuiet()` already computes that last state. A channel that never said
anything is shown and not selectable, because the useful fact is not "this
channel is missing" but "this channel was configured and the car never sent
it" — which is a wiring or an id problem, and the driver should see it here
rather than discover it as a dead gauge at the track.

### 3. Ranges come from the data

Selecting a channel offers to set the widget's range from what was measured:

- **min / max** from the samples, not the theoretical range;
- a **round outward** step, so 6 820 rpm suggests a 7 000 top of scale;
- the **99.5th percentile** for anything with spikes (a single-sample glitch
  should not set the top of a boost gauge);
- warning and redline thresholds proposed from the same numbers, clearly as a
  suggestion that can be overridden.

This is the part that cannot be done any other way, and it is why the feature
is worth more than "bind widgets faster".

### 4. Pushing the channels to the dash

For a recording whose channels carry a decode, one action: **"Set this dash up
for this car"**. It shows exactly what it will do before it does anything —
one row per channel, what already matches, what will be created, what will be
changed — and then writes with the existing endpoints. Anything already on the
dash and different is a conflict the user resolves, never an overwrite.

The signed flag has to ride along. The node keeps the low 16 bits of a
sign-extended field, so a channel adopted without `is_signed` reads ignition
retard as ~65 500 — the same bug the puck's own gyro column had.

## What it looks like

Design workspace, with a session loaded:

```
┌ Design ─────────────────────────────────────────────────────────┐
│  [ Live ] [ Sim ] [ Replay ▾ Mallala, 22 Aug — lap 7 ]           │
│                                                                  │
│                  ( the cluster, rendering )                      │
│                                                                  │
│  ◀◀  ▶  ▶▶   ├──────────●───────────────────┤   00:41.2 / 1:28.6 │
└──────────────────────────────────────────────────────────────────┘
```

The rest of the editor is unchanged. That is the point: this is a data source
and a channel list, not a second editor.

## Staging

Three steps, each shippable on its own:

1. **Replay as a preview source.** Editor renders a loaded session at a
   playhead. No new bindings, no writes. This alone makes every existing
   layout testable against real data.
2. **The recording's channels in the picker, with measured ranges.** Binding
   and range suggestions. Still no writes to the dash.
3. **Adopt the channels onto the dash.** The review-then-write step, only for
   recordings that carry a decode.

Step 1 is most of the value for a fraction of the work, and steps 2 and 3 are
each meaningful on their own if the other never happens.

## Open questions

- **Where does the session come from?** The Design workspace has no session
  concept today. Simplest: the most recently opened recording in Analyse,
  named in the Replay button, with a picker to change it.
- **Frame rate.** Samples are 25 Hz; the renderer repaints on a debounce.
  Replay should drive on the sample clock and let the renderer coalesce, the
  way live values already do.
- **Units.** `chanDefs.unit` is the *native* unit — scale and offset are
  defined against what the ECU sends, and the dash's display unit is a
  conversion after that. A range taken from the samples is in native units and
  must be labelled that way or a bar gauge will be wrong by a hundred.
- **Video.** Sessions with footage are already synced to the playhead. Cluster
  and video side by side, both scrubbing together, is nearly free once step 1
  exists — and is the best possible answer to "does this gauge read at speed".
