# The keypad's lights

**Date:** 2026-09-02, laid out as a workspace 2026-09-03 (§1.1), rest and
reactions added 2026-09-03 (§1.2) — third shape in one day, see §7
**Where:** RDM Studio → Keypad → **Lights**
**Code:** `src/tauri-overlay.html`, `kpfx*`, one contiguous block
**Tests:** `tools/check_lightshow.js`
**Decision:** ADR-0058 — *Render in colour the hardware does not have*, and its five addenda
**Hardware log:** `docs/BLINK_MARINE_PKP2200_CANOPEN_2026-08-28.md`

---

## 1. What it is

What the keypad's lights do, in the order it happens: the **boot**, then what
it **rests** in, then what a **press** does. One row across the page, read left
to right, and every block in it opens into the same panel.

The boot is a **row of steps**, each an effect, a colour and a length. The
block at the end of the row is everything after it.

| You can | How |
|---|---|
| Watch it | the keypad in the middle plays the boot on a loop, then rests, then goes again |
| Add, remove, reorder steps | the timeline under the keypad; up to eight |
| Change what a step does | pick from sixteen effects, on the left |
| Change its colour | one swatch row — the seven colours a ring can make |
| Change which way it goes | for the effects that have a direction |
| Change how long it lasts | one slider, 0.2–8 s |
| Change how fast it runs | one slider, 0.25×–4× (§3) |
| Say what happens after the boot | open the block at the end of the row (§1.2) |
| Say what a press does | same block — a reaction belongs to the rest |
| Go to a moment | drag the playhead along the timeline |
| Start from something | six ready-made boots; picking one replaces the steps, then it is yours |
| Send it | play it on the keypad through the dash · save · load · frames for a USB-CAN tool |

No alerts, energy dials or colour themes. Warnings are a per-key thing and
live on the Design page (ADR-0062); the other two are not coming back.

## 1.1 The page

The dash designer's shape, for the same reason: what you are making has to
stay on screen while you change it.

| Column | What is in it |
|---|---|
| Left, scrolls | **Choices.** Every effect as a live tile — the effect running on *your* keypad at *your* grid size, through the same quantiser as the wire. Under them, the six ready-made boots. |
| Middle, never scrolls | **The keypad**, playing. Above it the transport and what is playing right now; below it the sequence. |
| Right, scrolls | **This step.** What it does, colour, direction, how long, how fast. Then the ways it leaves Studio. |

The sequence under the keypad is a **timeline**: each step is a block as wide
as it is long, so a two-second step is twice the block of a one-second one and
the shape of the boot is visible without reading a number. A trailing block is
the keys at rest. The playhead is the clock, and dragging it scrubs and picks
up the step it lands on. It is the demo and the editor at once.

## 1.2 After the boot

Two questions, on the block at the end of the row, because that is when they
are true. During the boot the boot is playing; once the rings are handed back
to the buttons there is nothing left to react with.

**What it rests in.** Any of the eight looping effects, with its own colour and
speed — or **Back to the buttons**, the default, which hands the rings over to
what each button is actually doing. A once-through effect cannot be a resting
look: it would settle and then hold one frame for the rest of the day.

The panel is straight about the cost. Handing back streams nothing. Anything
else means *the rings show the animation, not what your buttons are doing*, and
Studio has to stay open to drive it.

**What a press does.** Nothing (the default) · Light while held · Flash it ·
Ripple out · Everything else out. A reaction is drawn **over** the resting look
rather than instead of it, so a ripple crosses a scanner and letting go leaves
no seam. Press a key on the picture to try one.

The honest part: in the car the **dash** does this. It is what reads the
keypad's key frame and lights the ring, so a reaction lives in the file and in
the dash, never in the keypad. Studio previews it against your own thumb.

## 2. What the hardware can actually do

| Thing | What it really is | How many |
|---|---|---|
| Key ring colour | Three bits in one CAN frame — one red, one green, one blue | 7 colours, or dark |
| Per-key brightness | Does not exist. A ring is lit or it is not | — |
| Legend backlight | A separate lamp behind the printed legends, one colour for the whole keypad | 9 colours, 64 steps |
| How often it can change | As often as a host sends the frame | limited by the bus, not the keypad |

So "the LEDs are addressable" is true in the sense that matters — every key is
independent — and false in the sense people usually mean. A PKP-3500 is 15
independent elements refreshed as fast as a host cares to send. That is a
display. A small one, with a seven-colour palette.

Amber and lime are backlight-only; no ring can make them, so a step cannot be
drawn in them, and the harness asserts the quantiser never picks them.

## 3. The effects

| | Effects |
|---|---|
| **Once** — play through and settle | Wipe · Sweep · Roll call · Start lights · Crank · Burst out · Flash · Colour check |
| **For a while** — loop for as long as the step lasts | Scanner · Chequered flag · Fire · Rainbow · Sparkle · Hold the colour · Hold your keys · Wait |

**A step has two knobs, and they answer different questions.** *How long* is
the slot the step takes in the boot. *Speed* is how fast it runs inside that
slot, where 1× means "exactly fill it".

| Speed | A once-through effect | A looping effect |
|---|---|---|
| 1× | finishes right at the end of the step | its normal pace |
| above 1× | finishes early, then holds what it made | that much faster |
| below 1× | the step ends before it finishes — a crank that never quite catches | that much slower |

Below 1× being allowed is deliberate: it is a real look, not a fault, and the
panel says in a sentence which of the three is happening. At 1× the old rule
still holds exactly — every once-through effect paces itself to the time it
has been given, on four keys or fifteen, so Roll call over 1.2 s reaches the
last key at 1.2 s.

The harness checks all of it: that at 1× every once-through effect has settled
by the end of its own time on every model and is still going a quarter of the
way in; that a step given twice the time is at the same point halfway through;
that a looping effect at 2× is that effect at twice the time; that at 2× a
once-through effect is finished by halfway *and holds*; and that no effect
wound all the way up outruns the dash.

*Sweep*, *Roll call* and *Crank* end on the keys' own colours from the Design
page, so the boot lands on the keypad you designed. On a keypad with no keys
assigned yet they use the step colour instead, because a boot that ends on
nothing is worse than one that ends on white.

Each effect carries one sentence about what quantising does to it.

## 4. The ready-made boots

| Boot | Steps |
|---|---|
| Ignition | Crank 1.8 s → Sweep 1.0 s |
| Roll call | Roll call 1.5 s |
| Start lights | Start lights 2.2 s (red) → Flash 0.5 s (green) |
| Sweep | Wipe 0.6 s → Sweep 0.9 s |
| Fire up | Fire 1.8 s → Burst out 0.6 s |
| Colour check | Colour check 2.4 s |

Each is tuned to look right on a 2×2 as well as a 3×5. The harness plays every
one from cold on every model and checks it lights something, settles inside
its time, and ends with the keys at rest.

## 5. What goes on the wire

CANopen only; the J1939 manual documents no LED command.

| Frame | ID | Bytes |
|---|---|---|
| Rings | `0x200 + node` | red, green, blue key bitmaps — one byte each up to 8 keys, two each above (keys 9-16 in the high byte) |
| Wake it first | `0x000` | `01 <node>` — PDOs are ignored until the node is operational |

The dash gateway refuses more than two dozen frames a second (ADR-0055). A
frame identical to the one before it is never sent; the streamer keeps its own
rolling one-second window; the page shows the busiest second before anyone
presses play. The harness checks no ready-made boot and no effect held for six
seconds exceeds the budget.

## 6. The three ways the lights leave Studio

| Route | What it is | Works today |
|---|---|---|
| **Play it on the keypad** | Studio streams the frames through your dash while the window is open | with a dash on WiFi |
| **Save** (`rdm_keypad_<name>_lights.json`, format 4) | The boot, the resting look and the reaction, as a small readable file | yes |
| **Frames** (`rdm_keypad_<name>_lights_frames.txt`) | Every frame with its timing, for a USB-CAN tool | yes |

**A keypad cannot play any of this on its own.** The file is the handoff to
dash firmware. Until then the only animation that runs with no host is the
keypad's own built-in start-up show (CANopen object `2014h`, Connection page).

The frame script says which of two things its tail is: after the boot it either
**holds** (the rings went back to the buttons — the last frame is that, and it
stays) or **loops** (a resting animation — the frames past the boot are one
turn of it, and replaying them once leaves the keypad frozen on the last one).
That distinction is the whole reason the header changed in format 4.

Loading reads every shape this feature has had and carries across what still
means something: the steps and their colours, the resting look, and the press
lane where its name survived. Files are named after the keypad they describe
(ADR-0060).

## 7. Why it is the third shape in one day

The first version was lanes of stacked layers with blend modes, masks and
timing windows. The second was ten prebuilt shows with four moments, colour
themes and an energy dial. Both could do more than this; both were chaos. The
brief that ended it was: *a boot sequence that is fully customisable, then the
rest is basic setup; we add onto it once basic is set up properly.* So: one
thing, done properly, and a shape that can take the next thing when it is
wanted — the rest state is already a field (`idle`), fixed to the key colours
for now.

What survived every rewrite is everything below the surface — render in true
RGB and quantise at the end, a hash instead of a dice roll, a step paced by its
length, dedupe every frame, never exceed the bus budget — and the harness that
proves each of those.

## 8. Not done

- **The dash does not play boots yet.** Today a boot needs Studio open.
- **A resting animation needs Studio open.** Handing the rings back to the
  buttons is the only resting look that costs nothing and survives Studio being
  closed. Everything else is a stream, which makes an animated rest a bench and
  show-off feature until the dash plays these files itself.
- **A reaction is previewed here and played by the dash.** Studio streams
  frames blind — it is not told about real key presses — so pressing a key on
  the picture is the only way to see one until the dash reads the file.
- **No per-frame LED dimmer.** The manual's `0x400 + node` object is deliberately
  unused: unverified on our bench, and `0x400-0x43F` is the RDM GPS node range.
