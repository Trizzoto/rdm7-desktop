# RDM Studio — launch artwork for Instagram

Sixteen posts teasing the GPS lap timer and drift mode, in the workspace's own
brand (ADR-0024): Industry-light ground, RDM red as the only accent, Barlow and
Barlow Condensed, square corners, hairline rules.

```
marketing/instagram/   1080 x 1350   feed posts (4:5, the tallest the feed allows)
marketing/stories/     1080 x 1920   the same posts on a branded ground, safe areas cleared
```

## Where the numbers come from

**Every figure on this artwork is measured, not invented.** The generator loads
the committed golden recordings (`tools/fixtures/`, ADR-0050) and runs them
through the app's own analysis functions, lifted verbatim out of
`src/tauri-overlay.html` the same way the test harnesses do. If a number could
not be measured from a recording it is not on a poster.

| Recording | What it is | Posts |
|---|---|---|
| `donington-driver1` | **Real.** Racelogic's publicly distributed RaceRender demo dataset — Lotus Evora GTE, VBOX HD2, 7 laps at 10 Hz. Its lap times are checkable against Circuit Tools 3. | 01–06, 11, 12, 13, 14 |
| `mallala-2026-08-23` | **Real.** Your 23 August puck session: 25,720 samples, 12 CAN channels, three genuine GNSS dropouts. | 10, 14 |
| `mountbarker-ring-2026-08-22` | **Real.** The 22 August ring off the node, 168,105 samples. | 14 |
| `mallala-drift.vbo` | **Synthetic** — the app's own demo drive, rebuilt from a fixed seed by `tools/make_drift_fixture.js`. It is the only recording here with a car deliberately sideways in it. | 07, 08, 09 |

**Posts 07, 08 and 09 are the drift ones, and they run on synthetic data.**
The star ratings, the angle trace and the board are all the real engine's real
output — but the drive underneath is generated, not driven. They are honest as
a demonstration of the feature and would not be honest as a claim about a run
you did. Swap in a real drift session before posting if you would rather not
draw that line.

Two things a reader could check, and what they would find:

- **The delta trace closes on the lap gap.** Samples inside a lap span slightly
  less than the lap does — the gate is crossed between two of them at each end
  — which at 10 Hz left the trace ending 22 ms away from the 0.278 s printed
  next to it. The series is stretched onto the gate-measured span (a 0.03%
  correction) so the two are one measurement. See the comment on `elapsed()`.
- **Corner losses do not sum to the lap gap.** They come to −0.237 s of the
  −0.278 s. The rest was taken on the straights, which is what you would
  expect and is why the delta is drawn as a continuous line.

## Claims worth a second look before you post

- **There is no call to action in the set, and only you can add one.** Post 16
  closes on "Built for the RDM GPS lap timer" and the footer names the three
  platforms. It does not say where to get it, because inventing a domain or a
  store page would be exactly the kind of unchecked fact the rest of this
  artwork avoids. Add the line before you post.
- **No price is claimed anywhere.** If it ships free with the hardware, say so
  — it is a strong line and I did not want to invent a commercial fact.
- **Platforms** are Windows, macOS and Linux, taken from
  `.github/workflows/release.yml`.
- **No corner is named.** Donington's corner names would have been guesses from
  a position on the lap, so posts 02 and 06 describe where things happened by
  distance instead. Post 02 says "into Redgate" because the largest positive
  delta is ~400 m after the line, which is Redgate on the National circuit —
  change it if you disagree.
- Post 12 deliberately shows **no throttle or brake bars**: the Donington file
  carries no pedal channels, and the app does not draw empty tubes. The footer
  says so, which is the point.

## Rebuilding

```bash
node tools/hype/data.js && node tools/hype/build.js && python tools/hype/stories.py
```

`data.js` re-measures everything from the fixtures; `build.js` renders each post
with headless Chrome at exactly 1080x1350; `stories.py` makes the 9:16 set.
`python tools/hype/sheet.py` writes a contact sheet to `tools/hype/out/` — worth
a look after any change, because layout overflow is invisible in the HTML and
obvious in a grid.

Editing: `tools/hype/posts.js` (01–11) and `tools/hype/posts2.js` (12–16) hold
one function per post; `tools/hype/kit.js` holds the palette, the type scale and
the page furniture. Copy lives in those files, next to the layout it belongs to.
