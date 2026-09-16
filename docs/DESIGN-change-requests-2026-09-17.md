# Change requests against DESIGN.md v1.1

From: Tommy (apps) · 17 September 2026 · against v1.1 of 16 September 2026

Ten requests. CR-1 to CR-5 came from reading the spec; CR-6 to CR-10 came
out of running the Dash web pilot. Each follows the §Governance format: section and token, current
value, proposed value, the measurement, and what it affects.

Everything else in v1.1 verified. Every contrast ratio in the file was
recomputed against every ground it names, and all of them reproduce exactly:
the focus-ring figures 2.52 / 2.21 / 1.92, `accent.ink` at 5.60 worst case,
`line.control` at 3.47 / 3.44 / 3.36, 3.04 on storefront ink `raised`, the
danger ring at 8.20, and the corrected status colours at 4.60 / 4.54 / 4.51.
The file is well measured and none of the below disputes a number in it.

---

## CR-1 — `bar` and `stage` have no role bindings (highest priority)

**Section and token.** §2.3 and §2.4, the `bar` and `stage` rows.

**Current.** Both palettes list `stage` `#16181b` and `bar` `#0c0d0e`, annotated
"dark in both modes". Neither section says which role values apply *on* them.

**Why.** Read literally, light mode puts light-mode ink on a near-black bar.
Measured against `bar` `#0c0d0e`:

| Light-mode role landing on `bar` | Ratio |
|---|---|
| `text.primary` `#1d1f20` | 1.18 |
| `text.secondary` `#545557` | 2.61 |
| `divider` `rgba(29,31,32,0.2)` | 1.03 |
| `line.strong` `rgba(29,31,32,0.38)` | 1.05 |
| `highlight` `rgba(29,31,32,0.07)` — the §9.2 hover treatment | 1.00 |
| §9.3 danger focus ring (`text.primary`) | 1.18 |

`stage` `#16181b` is the same picture: 1.07, 2.38, 1.01, 1.03, 1.00.

A hover state at 1.00 is not a weak hover, it is no hover at all.

This is the bug class §"What changed in 1.1" names — a value set against one set
of grounds and used on another — reappearing where the ground is fixed and the
*mode* moves underneath it.

**Proposed.** One sentence in §2.3, or a note on both rows:

> Components sitting on `bar` or `stage` resolve dark-mode role values in both
> modes. These two grounds do not follow the mode.

Ground-scoped rather than mode-scoped, which is the fix pattern 1.1 already
applied to `accent`.

**What it affects.** Studio first and hardest: its whole shell is the black bar
carrying the workspace tabs, so the affected elements are interactive and need
hover, focus and selected states. Dash web and the Phone share the pattern.
No token value changes; this is a resolution rule.

---

## CR-2 — §9.2 `selected` and `active/pressed` still carry the bug §9.3 was fixed for

**Section and token.** §9.2, the `selected` and `active / pressed` rows.

**Current.**
- selected: "`accent` fill, or a 2px `accent` bottom border"
- active / pressed: "`accent.pressed` fill, or `highlight` at double strength"

**Why.** v1.1 fixed the focus ring in §9.3 because `accent` on a dark ground
falls below the 3:1 in §2.6. Its two siblings were left as they were, and they
fail the same requirement:

| Treatment | dark `ground` | `surface` | `raised` |
|---|---|---|---|
| 2px `accent` bottom border | 2.52 | 2.21 | 1.92 |
| `accent.pressed` `#c02026` fill | 2.18 | 1.91 | 1.66 |

§2.1's edge rule is written for `accent` only, so `accent.pressed` — which is
darker, and therefore worse on every dark ground — is not covered by it.

**Proposed.**
1. Extend the §2.1 edge rule to read "an `accent` or `accent.pressed` fill on a
   dark ground takes a 1px `line.control` edge".
2. In §9.2, qualify the bottom-border option: "a 2px `accent` bottom border on
   light, `accent.ink` on dark", matching §2.6.

**What it affects.** Every selected tab, active nav item and pressed button on
all three software surfaces in dark mode. No token value changes.

---

## CR-3 — §2.6 and §9.3 disagree about which token on `bar` and `stage`

**Section and token.** §2.6 closing paragraph, and the §9.3 ring table.

**Current.** §2.6: "Any accent line, ring or arc on a dark ground must use
`accent.ink` instead of `accent`." §9.3 keys the ring on mode: light → `accent`,
dark → `accent.ink`.

**Why.** On `bar` and `stage` in light mode these give different answers, because
those grounds are dark while the mode is light. Nothing fails — `accent` measures
3.40 on `stage` and 3.72 on `bar`, both clearing 3:1 — so this is an ambiguity
rather than a defect. An implementer still has to guess.

**Proposed.** No change if CR-1 is accepted; its resolution rule settles this.
Otherwise, make the §9.3 table key on the ground rather than the mode.

**What it affects.** Clarity only. No measured failure.

---

## CR-4 — `#b3261f` is missing from the §11.1 migration map

**Section and token.** §11.1, the accent rows.

**Current.** The map lists `#d2232a`, `#d71900`, `#E01616`, `#CC0000`,
`#E00000`, `H(0xD2232A)` → `accent`, and `#c02026`, `#A80000`, `#990000` →
`accent.pressed`. `#b3261f` appears nowhere in the file.

**Why.** It is live: `src/tauri-overlay.html` defines
`--accent: #b3261f` under `body.dsb-on`, the Studio dash-editor scope. A
map-driven replacement skips it silently, which is exactly the failure v1.1
recorded as defect #5 for `#CC0000`.

It is a fifth red, after `#d2232a`, `#d71900`, `#E01616` and `#CC0000`.

**Proposed.** Add `#b3261f` to the `accent` row of §11.1.

**What it affects.** One definition site in the Studio overlay, which drives the
dash editor's accent. Small, but it is the one that silently survives a
scripted migration.

---

## CR-5 — `#e8433c` maps to a text colour but is in use as a fill

**Section and token.** §11.1, the row `#e8433c`, `#f2635c`, … → `accent.ink`
(dark).

**Current.** The map sends `#e8433c` to `accent.ink`.

**Why.** In the Studio overlay `#e8433c` is the value of `--accent` under
`#suiteHome` and under `#kpWorkspace` — a fill role, not ink. Applying §11.1
mechanically turns two workspace accent fills into a text colour, which §2.2
explicitly forbids ("accent is never a text colour", and `accent.ink` is defined
for text, line, arc and icon).

DESIGN.md already contains the right answer for the fill case, in §2.5: the
device `accent` is "**corrected** from `#e8433c`" to `#d2232a`. The §11.1 table
just has no column to express that the same literal maps two ways depending on
the role it currently fills.

**Proposed.** Split the row, or add a qualifier:

> `#e8433c` → `accent` where it is a fill, `accent.ink` where it is text, a line
> or an icon. Check the declaration, not just the value.

**What it affects.** 8 occurrences of `#e8433c` in the Studio overlay, two of
them `--accent` definitions that drive whole workspace scopes.

---

## Not a change request: a scoping note on §11.1

§11.1 says the remainder is "521 single-use values … each maps to the nearest
role". Measured across Dash web and the Studio overlay only, the tail is larger
than single-use:

| | |
|---|---|
| distinct colour literals in the two surfaces | 415 (1,501 uses) |
| not named anywhere in DESIGN.md | 366 |
| of those, used more than once | 154 (599 uses) |
| used three or more times | 89 |
| saturated, three or more uses (carry meaning, not chrome) | 44 |

The saturated ones are the concern, because "nearest role" is a judgement call
where a status colour is involved. Unmapped examples: `#118833` (24 uses) and
`#6fbf73` (23) are greens where §11.1 maps only `#2e7d43` to `status.ok`; eleven
further greens and eleven further yellows and oranges sit outside the
`status.warn` row.

**"The blue goes" is also wider than two values.** §2.2 names `#2d8ceb` and
`#4da3f2`. In use there are at least a dozen more blue-ish values, including
`#7cc0ff` (7), `#4fc3f7` (7), `#2979ff` (6), `#3b82f6` (5) and `#5bb8ff` (3).

**Caveat, and it matters.** Some of this tail is certainly user data rather than
interface chrome — dashboard widgets carry their own colours by design
(ADR-0075), so a default widget colour like `#00ff00` is not a token candidate.
The figures above are a bound on the work, not a defect count, and the split
between chrome and widget defaults has not been separated yet. No change to
DESIGN.md is proposed; this is for planning the "zero raw colour literals"
definition of done, which is a larger job than the map implies.

---

# From the Dash web pilot

CR-6 to CR-9 are things the pilot hit in practice. This is what running one file
end to end was for.

## CR-6 — there is no categorical palette

**Section.** §2, roles.

**Current.** Colour roles are `accent`, `ok`, `warn`, `bad` plus the neutrals.
Every one carries a meaning.

**Why.** The editor colour-codes widgets by type: sixteen entries in
`.widget-box[data-type="..."]`. Nine already borrow a status role, so a panel is
"ok" green and an rpm bar is "danger" red while meaning neither, and the other
seven are raw hues (210, 270, 190, 280, 220, 200, 320). Five of those are blues,
which §2.2 deletes.

Rule 2 says a value not in DESIGN.md does not get used, so these can be neither
converted nor invented. They are the only raw colours left in the editor's CSS
that carry meaning.

**Proposed.** A categorical set, explicitly not semantic, sized to the need
(sixteen widget types; the phone and storefront will want the same). Verified
against the three dark and three light grounds at the 3:1 non-text threshold,
since these are borders.

**What it affects.** 16 rules in Dash web, the same colour-coding in Studio, and
it stops status roles being used to mean "category".

## CR-7 — `opacity` is used to dim interactive content

**Section.** §9.4, and §2.1 rule 4.

**Current.** §9.4 gives `opacity: 0.45` to **disabled** controls. Nothing covers
de-emphasis of content that is still interactive.

**Why.** Dash web has 23 rules dimming with opacity. The largest is
`.ch2-row.inactive { opacity: 0.40 }` — the "not set up" channel list, which is
clickable, brightens to 0.95 on hover, and is captioned "click one to see what
it is". It is not disabled.

Measured over every visible text node against its real composited background
with ancestor opacity folded in, this puts **649 text nodes under 4.5 in both
modes**: 2.19 worst case on dark, 1.69 on light. It is mode-independent and
predates the token work — with opacity ignored, both modes measure 0 failures.

This is the third text tier returning through the side door. §2.1 rule 4 retired
`ghost` / `hint` because three tiers cannot all clear 4.5. Dimming a tier with
opacity recreates exactly that, invisibly to the token layer.

**Proposed.** Either state that opacity below 1 is for disabled only and give
non-disabled de-emphasis a role that still clears 4.5, or state the floor: no
composited text below 4.5 regardless of how the dimming is done.

**What it affects.** 23 rules in Dash web and the equivalents elsewhere. It is a
visible change to the channels page, which is why it is a request rather than
something done quietly in code.

## CR-8 — scrims and status tints have no tokens

**Section.** §2.

**Current.** No token for a modal backdrop, and none for a tinted status
surface.

**Why.** Dash web has 20 scrim call sites (`rgba(20,20,20,0.4)`,
`rgba(10,10,10,0.85)` and 19 more) and 37 status-tint sites
(`rgba(251,191,36,0.12)` behind a warning row, `hsla(0,70%,55%,0.08)` behind an
error). Both are ordinary interface furniture, neither maps to an existing role,
and together they are the largest remaining group of raw values in the CSS after
the categorical palette.

**Proposed.** `scrim` per mode, and a tint form of `ok` / `warn` / `danger` — or
a stated rule for deriving a tint from a status role, since a fixed alpha over a
moving ground does not hold its contrast.

**What it affects.** 57 call sites in Dash web alone.

## CR-9 — §10.2 is narrower than the problem it names

**Section.** §10.2, "The JS problem".

**Current.** "Values read from JavaScript do not follow a `var()` swap."

**Why.** True, but the same class of bug bit harder from pure CSS. A property
fed by a token that also carries a `transition` does **not** restart that
transition when the token changes: the element keeps its old computed value
indefinitely, not for the transition's duration. `.ch2-row` has
`transition: background 0.12s`; 800ms after switching to light it was still
painting the dark ground, and only a forced recalc with transitions suppressed
corrected it.

Any themed property with a transition is affected, and §7 mandates transitions
on "hover, focus, colour and border changes", so the overlap is large. Dash web
alone uses `transition: all` 16 times.

The fix is mechanical — suppress transitions for the frame the swap lands in —
but nothing in the file tells an implementer to expect it, and the symptom looks
like a browser caching bug rather than a design-system one.

**Proposed.** Widen §10.2 to "a value does not follow a `var()` swap if it was
read into JavaScript **or if it is mid-transition**", and record the
suppress-for-one-frame technique beside it.

**What it affects.** Every surface that gains a theme toggle: Studio and Dash
web. The phone is unaffected, having no CSS transitions.

## CR-10 — there is no ink for a light fill, and no light ground

**Section.** §2.2 (`accent.onFill`) and §2.3 / §2.4.

**Current.** `text.onFill` is `#ffffff`, defined as the "label on an accent
fill". The grounds all move with the mode.

**Why.** Two related gaps, 17 call sites between them in Dash web:

*Ink on a light fill* (12 sites). A dark label on a pale surface:
`.cm-item:hover`, `.setup-card .dev-chip`, `#draftToast`,
`.preset-col-item.active`, `.props-test-momentary.pressed`,
`.path-add-handle`. Each currently carries `#1a1a1a` or `#000`. `text.onFill`
is white, so it is wrong here, and `text.primary` inverts with the mode, so it
is wrong too — in dark mode it would put light ink on the pale fill.

*A ground that stays light* (5 sites). `.resize-handle`, `.path-handle`,
`#interactionLayer::before/::after` and `.toggle-track::after` are white
handles and grips drawn over the canvas. They are the mirror of `stage` and
`bar`: fixed regardless of mode, because they sit on artwork rather than on the
page. There is no role for that.

**Proposed.** Either a second `onFill` pair — `onFill.light` for a dark label on
a pale fill, alongside the existing white — or a named fixed-light ground to
match the fixed-dark `stage` and `bar`, with its own ink. Whichever is chosen,
it wants the same treatment §2.3 gives `stage`: a note that it does not follow
the mode.

**What it affects.** 17 call sites in Dash web. They are the last group of raw
neutrals in the CSS; everything else left is covered by CR-6, CR-7 or CR-8.
