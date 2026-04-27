# Widget Schema Sync

The `WIDGET_DEFS` JS literal in `src/index.html` (the editor's per-widget metadata
— display name, default size, inspector field list with types/defaults/groups)
is **auto-generated** from `schema/widgets.schema.json` by
`tools/codegen_widget_defs.py`. Do not edit the generated block by hand.

## Source of truth

The canonical schema lives in the firmware repo (`RDM-7_Dash`) at
`schema/widgets.schema.json`. The desktop repo vendors a copy plus the
codegen + validator scripts. All four consumers (firmware, desktop, web
WASM editor, marketplace) eventually pull from the same schema; firmware is
the version that the dash actually loads layouts against, so its schema wins
any conflict.

Vendored from `RDM-7_Dash` @ commit **95ae13c** (Wave 1 codegen apply).

## Files vendored

| Path | Purpose | Edits allowed? |
|---|---|---|
| `schema/widgets.schema.json` | Canonical metadata (13 widgets, 218 fields) | No — sync from firmware |
| `schema/widgets.schema.meta.json` | JSON Schema meta-validator | No — sync from firmware |
| `schema/README.md` | Design doc (firmware-flavoured) | No — sync from firmware |
| `schema/examples/panel.json` | Example for review | No — sync from firmware |
| `tools/codegen_widget_defs.py` | Schema → `WIDGET_DEFS` JS codegen | No — sync from firmware |
| `tools/validate_widget_schema.py` | Schema well-formedness check | No — sync from firmware |
| `tools/check_widget_codegen.py` | CI drift check | Local diff: `DEFAULT_TARGETS` set to `["src/index.html"]` |
| `tools/requirements.txt` | `jsonschema` for the validator | No — sync from firmware |

## Generated block in `src/index.html`

Wrapped in markers so codegen knows where to splice:

```
// AUTO-GENERATED FROM schema/widgets.schema.json — DO NOT EDIT BY HAND.
// Run: python tools/codegen_widget_defs.py src/index.html
// AUTO-GENERATED BEGIN: WIDGET_DEFS
        const WIDGET_DEFS = {
            ...
        };
// AUTO-GENERATED END: WIDGET_DEFS
```

Everything between BEGIN and END is regenerated on every codegen run.

## Re-syncing from firmware

When the firmware repo ships an updated schema:

```bash
# 1. Copy fresh files from sibling firmware checkout.
cp ../RDM-7_Dash/schema/widgets.schema.json schema/
cp ../RDM-7_Dash/schema/widgets.schema.meta.json schema/
cp ../RDM-7_Dash/schema/README.md schema/
cp ../RDM-7_Dash/schema/examples/panel.json schema/examples/
cp ../RDM-7_Dash/tools/codegen_widget_defs.py tools/
cp ../RDM-7_Dash/tools/validate_widget_schema.py tools/
cp ../RDM-7_Dash/tools/requirements.txt tools/
# Note: tools/check_widget_codegen.py has a desktop-specific DEFAULT_TARGETS
# patch — re-apply it after copying (see the top docstring of the file).

# 2. Re-stamp the "Vendored from RDM-7_Dash @ <commit>" header in each
#    .py file (top docstring) with the new firmware commit SHA.

# 3. Run the validator + codegen + drift check.
python tools/validate_widget_schema.py
python tools/codegen_widget_defs.py src/index.html
python tools/check_widget_codegen.py

# 4. Diff src/index.html. Spot-check any changed defaults/added fields are
#    intentional. If a field default has flipped to a value desktop disagrees
#    with, raise it on the firmware repo — DO NOT edit the schema locally.

# 5. Commit with a message listing the substantive deltas (see commit
#    feature/widget-schema-codegen for the template).
```

The python deps install once:

```bash
pip install -r tools/requirements.txt
```

## CI hook

`.github/workflows/widget-schema-check.yml` runs the validator + drift check
on every push / PR. It fails the build if either:

1. `schema/widgets.schema.json` doesn't validate against the meta-schema, or
2. `src/index.html`'s `WIDGET_DEFS` block doesn't match what codegen would
   emit from the current schema.

That check is the safety net. Local git pre-commit hooks are encouraged but
not provided.

## Known divergences from firmware schema (flagged for upstream review)

These are points where running codegen replaced a more-correct desktop value
with a firmware-canonical one. Not bugs in the codegen — bugs (or design
decisions) in the schema. **Do not fix locally**; raise upstream.

### 1. `rpm_bar` and `shift_light` width / Y-position

Pre-codegen, desktop used **runtime expressions** so the rpm bar and shift
light scaled with the active screen size (responsive editor):

```js
"rpm_bar":     { defW: CANVAS_W, defY: -ORIGIN_Y + Math.round(55 / 2), ... }
"shift_light": { defW: ORIGIN_X, ... }
```

Schema bakes in concrete integers (firmware always runs at 800×480):

```js
"rpm_bar":     { defW: 800, defY: -213, ... }
"shift_light": { defW: 400, ... }
```

**Impact for desktop:** when the user switches the editor to a non-800px
preview (e.g. round 480px), newly created `rpm_bar` widgets default to 800px
wide instead of fitting. Existing layouts are unaffected (defaults only apply
on widget create).

**Upstream fix:** the schema spec already supports `screen_w` /
`screen_origin_x` / `screen_origin_y` string tokens that codegen expands to
identifier names (`SCREEN_W` / `SCREEN_ORIGIN_X` / etc.). Two issues:

- The firmware schema authoring chose literal ints over those tokens.
- Even if firmware fixes that, the codegen emits `SCREEN_W` etc., but desktop
  defines `CANVAS_W` / `ORIGIN_X` / `ORIGIN_Y`. Either:
  - Desktop adds top-level aliases: `const SCREEN_W = CANVAS_W; const SCREEN_ORIGIN_X = -ORIGIN_X; ...` (and updates them in `applyScreenDimensions`), or
  - Codegen takes a `--token-map` flag so each consumer can map tokens to its own identifiers.

Until that's resolved, accept the regression on the responsive defaults.

### 2. `meter` — many fields gained `enabledBy`

Schema introduces `enabledBy: "show_ticks"` on six tick fields and
`enabledBy: "needle_image_name"` on three needle pivot/angle fields. These
weren't previously gated in desktop. Net effect: in the inspector, those
fields now grey out when their parent toggle is off. This appears to be a
firmware UX decision — desktop should accept it.

### 3. `meter` — new fields

The codegen adds `show_ticks`, `needle_tip_style`, `needle_tip_base_w`,
`needle_tip_point_w`, `needle_tip_taper`. Desktop already supports these in
the WASM renderer (firmware-side widget code is shared via WASM); the editor
just never exposed them. Accept.

### 4. `warning` — new fields and changed default

Schema adds `label_font`, `label_y_offset`, `label_text_align` and changes
`inactive_opa` default from `80` to `180`. The new fields match the dash
firmware (alert label slider, momentary-aware test button — see firmware
project notes 2026-04-26). `inactive_opa` jumping to 180 was an explicit
firmware-side polish change in 2026-04-22. Accept.

### 5. `meter` — `auto_ticks` doc comment text drift

Schema doc comment says
`"auto_ticks lives in w.config but is NOT in the inspector — see _meterSyncDerived. Min/Major Tick Spacing replace the old count-based fields."`,
desktop comment was the older
`"auto_ticks lives in w.config but is no longer exposed in the inspector — it stays true on widget creation so the initial step is auto-derived from the range, then is flipped off the first time the user edits a step value (handled in updateWidgetConfigField)."`
Cosmetic.

### 6. Options arrays formatting

Pre-codegen desktop had options arrays inline on one line. Codegen always
emits multi-line. Cosmetic — diff noise only.
