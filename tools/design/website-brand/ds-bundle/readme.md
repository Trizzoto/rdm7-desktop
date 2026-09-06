# RDM — Design System

The website's brand, pulled directly from RDM Studio's own interface —
not a marketing skin invented separately from the product. Every color,
size and spacing value in here was measured out of `rdm7-desktop/src/tauri-overlay.html`,
the shell the lap timer, the keypad editor, the dash editor and the app's
Home all already wear.

---

## The 30-second version

| | |
|---|---|
| **Ground, light** | `#c8c9cc` page · `#d9dadd` surface · `#e4e5e8` elevated |
| **Ground, dark** | `#303030` page · `#393939` surface · `#424242` elevated |
| **Ink** | `#1d1f20` on light · `#e8e8e8` on dark |
| **The black bar** | `#0c0d0e` — fixed, never repaints with theme |
| **Brand red** | `#d2232a` on light (hover `#c02026`) · `#e8433c` on dark (hover `#f2635c`) — one step brighter so it still clears contrast on the dark ground |
| **Headings** | Barlow Condensed, uppercase, tight tracking |
| **Body** | Barlow |
| **Numbers** | JetBrains Mono, tabular |
| **Corners** | **Zero, everywhere.** Only round things — status dots — are round |
| **Depth** | 1px rules. No drop shadows, no elevation scale |
| **Structure** | Ruled tables and ruled cells, one fact per column |

### The rule that makes it look like this

**Red means exactly two things: where you are, and the one thing to do.**
The active tab's underline, and the primary button. Nothing else earns
red as decoration — a link arrow, a section kicker, a highlighted table
row are all ink. The only exception the app itself makes is a slower lap
delta, because red already means "attention" there too; a website page
won't usually need that case.

The second thing that makes this recognizable as RDM and not a generic
minimal site: **two bands, always in that order.** A black identity bar
(who you are), then a light tab row (where you are) — and the tab row's
ground never goes dark, even on a page that otherwise repaints for dark
mode. That one strip is what makes every RDM surface, light or dark,
read as the same product.

---

## Files

```
tokens.css                     ← source of truth. Link it from every page.
foundations/
  colors.html                  Both palettes, the fixed tokens, and why the tab row never repaints
  typography.html              The type ramp at real sizes
  shell.html                   THE SHELL rebuilt in tokens: the black bar + the tab row, light and dark
components/
  buttons.html                 Primary / secondary / quiet, at both sizes
  navigation.html               The tab-row nav pattern, standalone
  panels.html                  The product-picture panel (a header row + a dark stage)
  tables.html                  Ruled tables and ruled fact-cells — one value per column
  data-display.html            Lap-time lists, "where the time went", meta lines, status dots
  forms.html                   A pill-free text field + button row (newsletter, search)
patterns/
  hero.html                    The homepage hero: eyebrow, display title, one CTA pair, a product panel
  sections.html                Section opener, spec strip, comparison table, closing CTA, footer
```

Each HTML file is a standalone, token-driven preview with a first-line
`<!-- @dsCard group="…" -->` marker for the Claude Design pane. View
source on any of them — the markup is what you copy onto a page.

---

## Non-negotiables

1. **No rounded corners, anywhere**, except a status dot — it is round
   because it is a round thing, not for softness.
2. **Red is exactly two roles.** Active tab underline, primary button.
   Never a decorative accent, never a second "important" color.
3. **The tab row stays light.** `--tabrow-*` are fixed tokens, not theme
   roles — do not let a dark page darken band two.
4. **No drop shadows.** If a card needs to read as "above" something,
   give it a 1px border instead.
5. **Numbers are JetBrains Mono, and tabular.** A price, a lap time, a
   version string — anything meant to be scanned in a column.
6. **Headings are Barlow Condensed and uppercase.** Body copy is never
   condensed and never uppercase.
7. **One primary button per view.** The inverted "ink" secondary button
   (`--btn-secondary-bg`/`--btn-secondary-text`) is for the second action,
   never a second red.
8. **A product gets a panel, not a photo.** The dash, the app, a track
   map: draw it as itself inside a header-row panel on the dark stage
   (`--stage`), never a lifestyle photograph with a shadow under it.

---

## Usage

Link the one stylesheet from every page and build with its variables and
classes — never a hard-coded hex, font name or px value the tokens
already carry:

```html
<link rel="stylesheet" href="tokens.css">
```

`--action`, `--text`, `--bg`, `--surface`, `--border` and the rest all
flip together between the light and dark roots (`prefers-color-scheme`,
or `data-theme="dark"`/`"light"` to force one). `--bar-*`, `--tabrow-*`
and `--stage` are deliberately NOT theme roles — they are fixed, because
those three surfaces never repaint.

## Known gaps

- **Responsive breakpoints** are sketched (the display and h1 sizes use
  `clamp()`) but not exhaustively tested below 720px — the app itself is
  desktop software and has no phone layout to measure against.
- **Product artwork** in the panels below is redrawn as inline SVG from
  the app's own layout, not exported screenshots — swap in real
  screenshots of Studio and the dash where you have them; keep them
  inside a panel on `--stage`, never bare.
