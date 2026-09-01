# layout-formats

## findings

# Dash layouts vs video-HUD overlay layouts — full survey

All refs are SOURCE files: `src/firmware-base.html` (FB), `src/tauri-overlay.html` (TO), `src/transport.js` (TR).

## 1. The dash layout format

### Where saved layouts live
- **In-editor model**: `let currentLayout = { name: "default", widgets: [], signals: [] };` — FB:6372. Optional top-level `ecu` / `ecu_version` (FB:14059, 19337-19341, 19266-19278). **No pages** — one 800×480 screen per layout; multiplicity is separate *named layouts* plus a display-order store at `POST /api/layout/switcher` (FB:17772-17885).
- **Device (connected)**: files on the dash behind `/api/layout/*`. Endpoints used by the editor: `list` (FB:16821; `?details=1` FB:17910), `current` (FB:16858), `raw?name=` (FB:19008), `save` (FB:17114-17119; silent autosave = `save?apply=0`), `set` (FB:18994-18998), `delete` (FB:16568), `rename` (FB:16655), `reset_default` (FB:16594), `version` (`{"v":N}`, FB:19094, 19200), `preview` (debounced live push, FB:12234), `switcher` (FB:17885). Transport method wrappers: TR:559-623.
- **Local ("virtual dash") mode**: `_localRouteApiCall` (TR:1537-1599) serves the same endpoints from localStorage: layouts at key **`rdm7_layout_<name>`**, splash at **`rdm7_layout__splash_<name>`** (TR:152-237), active-layout pointer at **`rdm7_local_active`** (TR:1521, 1551-1578). `/api/layout/current` deliberately 404s offline (TR:1556) so loads go via `/raw`.
- **Other localStorage keys**: crash-recovery draft `rdm7_draft` (FB:7566, 15888-15919, cleared on save FB:17158); offline save stash `rdm7_layout_pending` (`_LAYOUT_PENDING_KEY`, FB:17182-17228, one entry per name `{payload, isSplash, ts}` — last-write-wins per name, FB:17166-17171); assets in `rdm7_images` / `rdm7_fonts` / IndexedDB `rdm7_desktop_db` (TR:73, 242-346).

### Widget instance shape (editor format)
Created by `addWidget(type)` FB:15739-15781:
`{ type, id: "panel_3" (nextWidgetId FB:11251-11260), x, y, w, h, config: {<every field def>} }`
- **Coordinates are CENTER-ORIGIN device px**: `x`/`y` are the widget centre relative to screen centre (ORIGIN_X=400/ORIGIN_Y=240, CANVAS_W/H 800×480 — FB:6337-6340; `devToWeb`/`webToDev` FB:9301-9302). `w`/`h` absolute px.
- Optional top-level keys: `signal` (bound signal name — canonical; mirrored into `config.signal_name` at save FB:12102-12113 and hoisted back on load FB:7797-7799), `channel` (canonical channel binding, mirrored to `config.channel`, FB:12122-12126 / FB:7804-7805), `hidden` (editor-only, filtered from payload FB:12085-12087), `group` (8-hex group id FB:15798-15801), `config.slot` for slot-limited types (`SLOT_LIMITS = { panel:0, bar:0, indicator:2, warning:8 }` FB:11231; `assignSlot` FB:11270-11277).

### Firmware wire format (`buildFirmwarePayload`, FB:12078-12220)
Deep-copies currentLayout, then: filters hidden; tags `payload.screen_w/screen_h` (FB:12089-12090); `allow_empty: true` guard (ADR-0038, FB:12096-12098); **colors RGB888→RGB565** (`convertWidgetColors(payload.widgets, rgb888to565)` FB:12101, walking WIDGET_DEFS color fields FB:8002-8006); signal/channel mirroring; per-type stripping of channel-owned thresholds (panel warning_*, bar bar_low/high, arc arc_low/high — FB:12127-12147); image_scale % → LVGL zoom ×256/100 (FB:12148-12152); rules object→array `[{field,type,value}]` (FB:12160-12186); **signals[] reduced to portable entries only** (`value_map` + `FUEL_SENDER_V` `fuel_cal`; pure CAN decode dropped entirely per ADR-0005 — decode lives in the dash's channels.json — FB:12188-12218). Reverse conversion `firmwareToWebFormat(data)` FB:7788+ (endian int→`is_little_endian` bool FB:7790-7796, zoom→%, rules array→object, bar_alerts inference). 32 KB cap `_checkLayoutSize` FB:6352 / RDM_LAYOUT_MAX_BYTES check FB:17098-17110. `schema_version` appears only on the splash save payload (`schema_version: 10`, FB:9526); normal layouts carry none (the `schema_version||2` at FB:18906 is channels.json, not layouts).

### WIDGET_DEFS
FB:8332-9095, inside `// AUTO-GENERATED BEGIN: WIDGET_DEFS` markers (guarded by firmware-repo CI per CLAUDE.md; arrives via firmware base sync). **18 types**:

| type | displayName | notable config keys (field `name`s) |
|---|---|---|
| `rpm_bar` (singleton, FB:8334) | RPM Bar | rpm_max, bar_color, grad_stops, fill_dir, bar_bg_color, show_ticks/label_every/tick_side/tick_width/tick_length/tick_color, show_rpm_value + rpm_value_font/color/x_offset/y_offset, redline, limiter_value/color/effect, flash_speed, smoothing_ms |
| `panel` (FB:8377) | Panel | label, decimals, bg_color, bg_opa, border_color/width/radius, label_font/color, value_font/color, text_align, label/value_x/y_offset, custom_text(+x/y), show_unit, unit_size, show_peak + peak_font/x/y, warning_low_/high_ {enabled,threshold,color,apply_label,apply_value,apply_panel} |
| `bar` (FB:8435) | Bar Graph | bar_min/bar_max, decimals, anchor_enabled/value/position, invert_bar_value, center_fill, fill_dir, bar_in_range_color, grad_stops, bar_image_full, fill_edge_width/color, indicator_radius, bar_bg_color, bar_image, bar_radius, bar_border_width/color, ticks…, show_bar_label/label/show_bar_value, label_font/color, value_font/color, bar_alerts_enabled, bar_low(_color)/bar_high(_color), smoothing_ms |
| `indicator` (FB:8496) | Turn Indicator | slot (Left/Right), input_source (Wire/CAN), color_on/opa_on, color_off/opa_off, animation, is_momentary |
| `warning` (FB:8517) | Alert Light | label, active_color/opa, inactive_color/opa, radius, border_width, border_color_style, show_label + label_color/font/y_offset/text_align, image_name, image_scale, flash_mode, flash_speed, lamp_on (ruleOnly), is_momentary, invert_toggle |
| `text` (FB:8553) | Text / Value | static_text, decimals, rotation, font, text_color |
| `meter` (FB:8563) | Meter | min/max, reverse, anchor_*, start_angle_user, sweep_degrees, show_needle + needle_width/color/r_mod/rear_length/inner_radius/tip_style/tip_base_w/tip_point_w/tip_taper/image_name/pivot_x/pivot_y/angle_offset, show_needle_ball + size/color, meter_bg_color/opa, bg_image_name, border_*, scale_padding, shadow_*, ticks (major/mid/minor step/width/length/color/image/scale/outline), show_tick_labels + font/color/label_gap/tick_label_divisor, redline_* , smoothing_ms |
| `image` (FB:8699) | Image | image_name, image_scale, opacity, recolor, recolor_opa |
| `shape_panel` (FB:8709) | Shape Panel | shape_type (rectangle/circle/triangle/diamond/arrows/chevrons), bg_color/opa, border_*, shadow_*, bake_into_gauge |
| `line` (FB:8736) | Line | orientation, line_color/width/opa, rounded, dash_gap, curvature |
| `banner` (FB:8754) | Alert Banner | op (>,<,>=,<=,==,!=,range,always), threshold, range_min/max, bg_color/opa, border_*, radius, text, text_align, text_color, font |
| `arc` (FB:8787) | Arc Shape | signal_min/max, tick_min/max, anchor_*, reverse, start_angle_user, sweep_degrees, arc_width/offset/color, grad_stops, bg_arc_color/width, rounded_ends, fade_fill, lead_edge_*, arc_image(_full) + opa/recolor/blend/radial, ticks…, show_tick_labels…, ticks_on_top, redline_* , arc_alerts_enabled + arc_low/high(+colors), smoothing_ms |
| `toggle` (FB:8893) | Toggle Switch | signal_on_threshold, active/inactive color+opa, label…, image_name, tx_can_id/bit_start/bit_length/endian/rate_hz, remember_state |
| `button` (FB:8926) | Button | bg/text/pressed colors, border_radius, label…, image_name, latch, remember_state, tx_can_* |
| `shift_light` (FB:8958) | Shift Light | signal_name, range_min/max, led_count/spacing/width/height, border_radius, color_low/mid/high/off, threshold_mid/high, flash_threshold, flash_speed, fill_mode |
| `pathbar` (FB:8984) | Path Bar | min/max, shape (Custom/L-Bend/Straight/45°/J-Hook), orientation, corner_radius, hook_angle, smooth, lit/dim colors, band_width, rounded, fade_fill, lead_edge_*, ticks…, labels…, redline*, smoothing_ms |
| `anim` (FB:9057, `hidden:true`) | Animation | range_min/max, threshold, anim_upload, frame_prefix, frame_count, mode, loop_fps, hyst_pct |
| `track_map` (FB:9075) | Track Map | track_asset (track_picker, .rdmtrk), line_color/width, show_start_finish + sf_color, rotation, show_dot + dot_color/show_trail/dot_radius, lat_channel/lon_channel, show_name + name_color |

Field descriptor keys: `{name,label,type,def,cat(data|appearance|alerts),group,help,min,max,step,options,enabledBy,nightOverridable,nightKey,ruleOnly,inline,autoFn}`. Field input types: number, color, gradient_stops, select, stepper, stepper-auto, slider, checkbox, font, text, textarea, image_picker, track_picker, can_id, anim_frames. Screen-dependent default patching FB:16806-16812. Per-type icons: `PALETTE_ICONS` FB:9305-9323 (17 entries — everything except track_map).

## 2. The HUD overlay layout format

### Store — exact key
Everything lives inside the **camera settings object** persisted as JSON at localStorage key **`rdm7_camera`** (`GP_CAM_LS`, TO:38531). The layout is the `hud` sub-object, written via `gpCamPut("hud", st)` (TO:38563-38567). `gpCamLoad` (TO:38532-38558) rebuilds `gp.cam` **key-by-key** — `hud` is carried only because of the explicit `if (s && s.hud) out.hud = s.hud;` at TO:38557. Widget on/off toggles are **sibling booleans** on gp.cam itself (`gp.cam.hudSpeed === false` etc., `gpHudOn` TO:30030-30034 — absent means ON), as is `gp.cam.hudMapStyle` (night/sat/satdim/plain, TO:29237-29248).

### Schema (see data_shapes for verbatim)
`gp.cam.hud = { v:1, w:{...}, z:[...], lock:{...}, add:[...], seq:N }` — confirmed by `gpHudEdStore` (TO:32430-32447, gap-filling never replacing), `gpHudEdSet` (TO:32452-32464, **absent-means-factory**: an entry at dx=0,dy=0,k=1 is deleted), `gpHudEdOrderNow/Move` (TO:32468-32484, `z` written only once reordered), `gpHudEdLock` (TO:32687-32693), `gpHudEdAdd/Edit/Delete` (TO:32496-32537; ids `"w"+seq`, never reused; delete removes w/lock/z entries too). Documented at docs/VIDEO_HUD_EXPORT_2026-08.md:146-151.

### Widget vocabulary
- **9 fixed built-ins** `GP_HUD_WIDGETS` (TO:29019-29029): `hudSpeed` (Speed and gear), `hudTacho`, `hudPedals`, `hudG` (grip circle), `hudDelta` (lap time+delta), `hudAngle` (slip angle), `hudMap` (minimap), `hudName` (track+date), `hudMark` (RDM logo). Bound to recording columns **by role**, not by picker: `GP_HUD_ROLES` (TO:29048-29053) matches canonical id first, name-regex second (rpm/thr/brk/gear), ceilings measured from the samples (`gpHudChans` TO:29054-29104).
- **13 "made" (user-instantiable) types** `GP_HUD_MADE` (TO:29828-29842): `panel, text, bar, rpm_bar, meter, shift_light, warning, indicator, banner, track_map, shape_panel, line, arc` — tuples `[type, name, defW, defH, needs]` where needs ⊆ {chan, range, level, col, track}. Legacy `"value"` maps to `panel` on read (`gpHudMadeType` TO:29847-29849). `gpHudMadeNeeds(type, what)` (TO:29860-29862) drives both drawing and the Properties rail.
- **What "share" means concretely**: the **type-id strings and display names are the dash's, duplicated by hand** in GP_HUD_MADE — there is *no* reference to `WIDGET_DEFS` (comment TO:29809-29819: "Everything below them is the DASH's widget set… What carries across is the vocabulary, not the code"). The **icons are literally shared**: `gpHudDashIcon(type)` returns `PALETTE_ICONS[t]` — the dash editor's own icon object, reachable because both live in the merged dist (TO:32716-32721); only track_map gets a purpose-drawn `GP_HUD_TRACK_ICON` (TO:32711-32715, the dash has no icon for it). Built-ins use their own `GP_HUD_ED_ICON` set (TO:32695-32705). The palette renders "Overlay instruments" then "Dash widgets" then "From a dash layout" (`gpHudEdPalette` TO:32968-33020). Config keys are **not** shared: a made widget carries ~10 flat keys vs dozens in WIDGET_DEFS. Deliberately excluded dash types: `toggle`/`button` (pressable), `image` (device image store), `pathbar`/`anim` (device chrome) — docs/VIDEO_HUD_EXPORT_2026-08.md:231-232.
- Made-widget channel binding: `made.chan` = a **recording channel id** from `gpHudChanList()` (TO:29756-29794 — every non-quiet column of `gp.traceChanIds`/`gp.traceChanDefs` with measured lo/hi, name, unit, dp). Value read per sample via `gpHudChanAt(id, i)` (TO:29801-29807). lo/hi/unit/dp/label default from the channel when absent (`gpHudMadeLo/Hi/Unit/Cap` TO:29916-29948). Unbound/unmatched → draws "—", never 0 (TO:29906-29914).

### Editor
`window.gpHudEdOpen` (TO:32737+) mounts the dash editor's own CSS classes (.workspace/.sidebar/.palette-item/.layer-item/.field — TO:32400-32409) on `<body>` (not #gpWorkspace). Entry points: HUD popover "Customise overlay…" (TO:33422), export dialog (TO:30942). Properties rail `gpHudEdProps` (TO:33117-33322) edits: dx ("Across"), dy ("Down"), k ("Size" 50-200%), chan, unit, dp, label ("Caption"), lo/hi ("Bar starts/ends at"), below+level ("Comes on when / This value"), rot + sf/dot/trail/name toggles (track_map, 0=off absent=on), col ("Colour", CSS string e.g. `#d2232a`), visibility (via `gpCamSet(key, bool)`), reset, delete. Hit-testing from `opt.rects` (TO:33327-33334). Debug handles: `window.__gpHudEd` (TO:33398), `__gpHud`/`__gpHudData` (TO:30728-30729), `__gpHudDash` (TO:33402 — dry-run of the dash import mapping).

## 3. gpHudRender

- **Signature**: `function gpHudRender(g, W, H, i, opt)` TO:30355 — ctx, picture width/height *in caller units*, sample index, `opt.rects` (array to fill with placed `{key,x,y,w,h}`). Returns false when no trace. Reads **no DOM/video/playhead** (TO:30347-30354).
- **Scale**: `S = Math.min(Math.min(W, H)/720, W/700)` (TO:30374); margin `M = 26*S`; everything in S units, so 720p tile and 4K export are proportional (pixel-identity proven in tools/check_hud.js).
- **Data**: one `gpHudData(i)` object (TO:29117-29169) — `{i, kph, spd, spdU, glon, glat, hdg, rpm, rpmMax, thr, brk, gear, thrF, brkF, beta, betaConf, betaRough, delta, lapNo, lapS}`. Pedal values pre-normalised to fractions where the full scale is known (TO:29151-29154). Widgets whose data is absent are **skipped entirely** (TO:29011-29013 "a gauge with no needle is worse than no gauge").
- **Two-phase layout**: each widget is *planned* (`plan.push({key, box, draw})`) in **flow order** — the speed number's measured width feeds the gear's x, grip stacks on the minimap's DEFAULT position (TO:30391-30400, 30432-30469, 30555-30565) — then painted once in **layer order** via `gpHudOrder(plan)` (TO:30296-30319, built not sorted) through `gpHudPlace` (TO:30328-30345): `translate(cx+dx·S, cy+dy·S); scale(k)` about the default box centre, then the untouched absolute drawing code, then the post-transform rect is pushed. **Position/size are stored as relative nudges (dx/dy in S units, k scale), never absolute px** — the default layout stays algorithmic (TO:30259-30275).
- Made widgets are planned after built-ins (default = on top), boxes from `gpHudMadeBox` (stacked down the left, TO:29893-29904), drawn by `gpHudDrawMade(g, a, box, S, i)` — one canvas-drawing branch per type (TO:29981-30257; segments for rpm_bar/shift_light, 240° arc meter, sign-driven indicator arrow, lit-only banner, whole-circuit track_map with driven-line fallback `gpHudTrackShape` TO:29963-29979).
- **Callers (one renderer, three surfaces)**: tile overlay `gpVideoDrawOverlay` TO:30754-30770 (`gpHudRender(g, rect.w, rect.h, gp.playIdx)`); realtime export frame loop TO:31146-31152; fast WebCodecs export TO:32188-32189; editor stage with `{rects}` TO:32904.
- **vs the WASM dash renderer**: the dash editor canvas is the WASM module (`load_layout_json`/`load_channels_json`/`inject_signal` — docs/LAYOUTS_FROM_RECORDINGS_2026-08.md:36-38), fixed 800×480, absolute center-origin px, values from the dash signal/channel registry, config-driven styling (fonts/images/rules/night). gpHudRender is hand-rolled 2D canvas, any aspect, S-unit flow layout, data-gated, styling hardcoded except the few made-widget keys, values from the loaded recording by column index.

## 4. Delta map (HUD type ↔ dash WIDGET_DEFS type)

| HUD | dash | shared? | key config deltas / converter notes |
|---|---|---|---|
| made `panel` | `panel` | id+name+icon | HUD: label/chan/unit/dp. Dash adds ~30 style+alert keys. Dash `decimals`↔HUD `dp`; dash binds `signal` name, HUD binds recording `chan` id |
| made `text` | `text` | id+name+icon | HUD shows value+unit; dash static_text/rotation/font/color |
| made `bar` | `bar` | id+name+icon | HUD lo/hi ↔ dash bar_min/bar_max; HUD col (CSS str) ↔ dash bar_in_range_color (int RGB888) |
| made `rpm_bar` | `rpm_bar` | id+name+icon | HUD draws 24 segments w/ red top fifth; dash rpm_max/redline/limiter → HUD hi; no per-segment config |
| made `meter` | `meter` | id+name+icon | HUD fixed 240° arc+needle; dash min/max ↔ lo/hi; dash's 40+ needle/tick/shadow keys have no HUD equivalent |
| made `shift_light` | `shift_light` | id+name+icon | HUD 10 segments; dash range_min/range_max ↔ lo/hi; dash flash/threshold colours unmapped |
| made `warning` | `warning` | id+name+icon | HUD level+below+col ↔ dash implicit non-zero trigger + active_color; dash image/flash unmapped |
| made `indicator` | `indicator` | id+name+icon | HUD one widget, direction from value sign; dash slot Left/Right ×2 widgets |
| made `banner` | `banner` | id+name+icon | HUD below/level ↔ dash op/threshold (op vocabulary richer: range, ==, always); text/colors partially map |
| made `track_map` | `track_map` | id+name (icon HUD-drawn) | Same toggles by design: rot↔rotation, sf↔show_start_finish, dot↔show_dot, trail↔show_trail, name↔show_name (docs/VIDEO_HUD_EXPORT:246-247). Source differs: dash `track_asset` (.rdmtrk on device) vs HUD `gpTrackById(meta.trackId)` / driven line |
| made `shape_panel` | `shape_panel` | id+name+icon | HUD rounded rect + col only; dash shape_type/shadow unmapped |
| made `line` | `line` | id+name+icon | HUD horizontal only; dash orientation/dash_gap/curvature unmapped |
| made `arc` | `arc` | id+name+icon | HUD decorative 240° stroke; dash arc is a full gauge (signal_min/max…) — closest semantic gap in the shared set |
| built-in `hudTacho` | ≈`rpm_bar` | role-bound | no config; ceiling measured from samples |
| built-in `hudSpeed`/`hudPedals`/`hudG`/`hudDelta`/`hudAngle`/`hudMap`/`hudName`/`hudMark` | — none | — | GPS-workspace-only concepts (delta needs lap analysis; minimap is track-up scrolling window, NOT the dash track_map) |
| — none | `toggle`, `button` | excluded | interactive; meaningless on video |
| — none | `image` | excluded | needs device image store |
| — none | `pathbar`, `anim` | excluded | device chrome |

**A converter needs** (half of it already exists as `gpHudDashPlan`, TO:32598-32642, invoked by `gpHudEdImportDash` TO:32644-32680):
1. **Namespace bridge**: dash `w.signal` (registry name) → recording channel, via `gpHudMatchChan` (TO:32575-32597: exact-normalised, containment, then all-words-of-shorter-in-longer). Unmatched = reported (`missed`), never invented. Reverse direction is the "two namespaces" problem of docs/LAYOUTS_FROM_RECORDINGS_2026-08.md:47-70.
2. **Type mapping**: today's importer COLLAPSES — dedupes per signal, prefers a bar/rpm_bar/meter widget, then emits only `"bar"` or `"value"`(=panel) (TO:32621-32625), predating the full 13-type vocabulary. An upgrade would map 1:1 now that types exist.
3. **Range key normalisation**: bar_min/bar_max, min/max, rpm_max, signal_min/signal_max, range_min/range_max → lo/hi (importer handles min/max/rpm_max: TO:32633-32638).
4. **Color representation**: dash int 0xRRGGBB (RGB565 on the wire) ↔ HUD CSS string.
5. **Geometry**: deliberately NOT converted either way ("Copying the geometry would give a HUD that covers the footage", TO:32539-32544). HUD→dash would additionally need S-units→800×480 center-origin px, and WIDGET_DEFS default expansion for the dozens of unset keys.
6. **Label/unit/decimals carry**: importer takes dash `config.label` else signal name (`gpHudDashName` TO:32555-32563), layout `signals[].unit` else channel unit (TO:32630-32632).

## 5. Import / export / transfer today

- **`.rdm` bundle** (the layout file format): binary `RDM1` container, spec comment FB:18432-18460 — 16-byte header (magic, version=1, entry count, flavour byte: 1=layout [widgets+images+fonts], 2=dashboard [+channels.json]); entries typed 0=layout JSON (firmware format), 1=image, 2=font TTF, 3=channels.json. `exportRdm(flavour)` FB:18472-18645 (collects assets by scanning WIDGET_DEFS image_picker/font fields FB:18479-18508, layout JSON = `buildFirmwarePayload()`); `importRdm()` FB:18647-18868 (parses, uploads images `/api/image/upload` FB:18743, fonts `/api/font/upload` FB:18776, saves layout `/api/layout/save` FB:18800, converts via `firmwareToWebFormat` FB:18812, offers `/api/channels/import` last FB:18838-18860). The **layout flavour exists specifically for marketplace sharing** — "a bad thing to upload to the marketplace, so the layout flavour simply has no channels entry to leak" FB:18466-18471.
- **Clipboard/JSON paste import**: accepts `{widgets:[...]}` (validated `w.type in WIDGET_DEFS`) or a single widget object — FB:11340-11430 (validation FB:11362-11367); AI-paste import mirrors the .rdm path FB:4533, 7913.
- **Local↔device transfer** (desktop-only, TO): `_readLayout` TO:41715-41725, `_copyLayout` TO:41727-41761 (layout via `src.loadLayout`/`dst.saveLayout` + image/font data copy, asset scan `_collectLayoutAssets` TO:~41680-41699), `_transferLayout('upload'|'download', name)` TO:41763-41783, transfer modal TO:41786-41830 — built on `RDM.local` and `RDM.deviceTransport()`.
- **Offline dash saves**: stash + reoffer on reconnect, FB:17179-17232.
- **HUD side**: no file import/export at all — the overlay layout only lives in `rdm7_camera`; the only cross-format path is `gpHudEdImportDash` (dash layout → made widgets, one-way, lossy).

## 6. Marketplace code in this repo

**Link-out only, no payloads.** `openMarketplace()` FB:21780-21783: opens `localStorage.rdmMarketplaceUrl` or the placeholder `https://marketplace.realtimedatamonitoring.com.au/` ("placeholder until the marketplace web property lands"). Surfaced as a Setup card (FB:4824-4825) and a menu button (FB:26886). No upload/download/API code exists. The intended interchange payload is the `.rdm` **layout flavour** (FB:18466-18471). docs/STUDIO_IDEAS_2026-08.md:41-46 ties unification to it: a shared file "makes the Marketplace twice as interesting because a shared layout works in both places".

## 7. Design decisions already on record

**docs/HUD_OVERLAY_PLAN_2026-08.md** (status BUILT 2026-08-31; As-built section):
- Store shape `gp.cam.hud = {v:1, w:{key:{dx,dy,k}}}` decided lines 126-137; **offsets relative to the algorithmic flow, never absolute anchors** (lines 139-144, 245-246, reasons: survives aspect changes and default tuning); absent-means-factory per key AND per field (line 132-133); persisted via existing `gpCamPut("hud")` into `rdm7_camera` (line 134).
- **"One gpHudRender, forever — an editor-only renderer is how the preview and the export start disagreeing again"** (lines 232-233); editor draws only selection chrome on top (line 110-112).
- `gpCamLoad`'s selective copy was the flagged trap (line 135-137) and "was real" (line 288-290) — any new persisted key must be named there.
- v1 fixed widget set; **v2 backlog: custom text, ECU-channel panels, multi-instance widgets, undo stack** (lines 184-187, 304-305). (Custom/made widgets from the recording were then built anyway — the palette grew the dash vocabulary the same day.)
- Identity discipline: refactors proven call-for-call and pixel-for-pixel (0 differing subpixels) before UI work (lines 160-165, 292-294).

**docs/LAYOUTS_FROM_RECORDINGS_2026-08.md** (plan, nothing built): the other half of unification — recordings driving DASH layouts. Decisions: **the one real problem is two namespaces** — recording channel ids vs layout `w.signal` registry names; they "line up most of the time and it would be wrong to assume it" (lines 47-70); imported-log channels must never silently join the channel library (lines 66-70); replay becomes a 4th editor preview source via `inject_signal`/`_testValues` (lines 74-84); ranges from measured data (min/max, round-outward, 99.5th percentile) (lines 106-118); dash channel adoption is explicit review-then-write via `/api/channels/activate|update|create|import`, signed flag must ride along (lines 120-130); staging in 3 independently-shippable steps (lines 149-162); chanDefs.unit is the NATIVE unit (lines 172-175).

**docs/VIDEO_HUD_EXPORT_2026-08.md** (the reference doc): store schema verbatim (146-151); invariants list (157-167: relative-not-absolute, S-units-not-pixels, empty config renders byte-identical); the shared-vocabulary table with per-type "needs" and the exclusion reasons (206-232); made widgets key off the same id-space as built-ins so position/lock/order reuse existing code, ids from a counter never list length (258-262); dash-import decisions (272-290: matched by name 3 ways, a signal shown twice becomes one widget and a bar wins, a gauge the recording can't feed is reported not invented; measured 10/26 across on his real layout).

**docs/STUDIO_IDEAS_2026-08.md item 4** (lines 41-46): "One layout format for the dash and the overlay — They already share a widget vocabulary, names and icons (2026-08-31). Sharing the FILE means 'design once, use on the dash and on your videos'…" — the explicit statement of the unification goal, ranked 4th of 8.

**Harnesses**: tools/check_hud.js (223 checks — renderer, S-invariance, pixel identity), tools/check_hudedit.js (111 — store round-trip incl. the gpCamLoad carry, rect math under dx/dy/k at 720p+4K, empty-config identity, hit-test/nudge/reset) (doc lines 3-5); tools/check_export.js, check_import.js, check_transport.js exist for the other paths (tools/ glob).

## data_shapes

# Verbatim shapes

## Dash layout (editor format)
```js
// src/firmware-base.html:6372
let currentLayout = { name: "default", widgets: [], signals: [] };
// + optional: ecu, ecu_version (FB:14059/19337)
// widget instance (addWidget, FB:15767-15773):
{
  type: "panel", id: "panel_1",          // nextWidgetId FB:11251
  x: 0, y: -213,                          // CENTER-ORIGIN px on 800x480 (ORIGIN 400/240, FB:6337-6340)
  w: 155, h: 92,
  config: { /* every WIDGET_DEFS field, name -> value; colors as 0xRRGGBB ints;
               plus slot (indicator/warning), rules[], night{...} overrides */ },
  signal: "COOLANT_TEMP",                 // canonical binding (mirrored to config.signal_name on save)
  channel: "...",                         // canonical channel binding (mirrored to config.channel)
  hidden: true, group: "a1b2c3d4"         // editor-only / grouping
}
```

## Dash firmware wire payload (buildFirmwarePayload, FB:12078-12220)
```js
{
  name, widgets: [...],                   // hidden filtered; colors RGB565; rules as [{field,type,value}]
  screen_w: 800, screen_h: 480,
  allow_empty: true,                      // only when a loaded layout is deliberately emptied (ADR-0038)
  signals: [ { name, value_map: [{v,label}], fuel_cal } ],  // portable-only; key omitted when none (ADR-0005)
  ecu, ecu_version                        // when set
}
// splash save payload: { name:'_splash_'+n, schema_version: 10, widgets: [], signals: [] } (FB:9526)
// 32KB cap: RDM_LAYOUT_MAX_BYTES via _checkLayoutSize (FB:6352, 17102)
```

## Local-mode storage (transport.js)
```
rdm7_layout_<name>            layout JSON per name        (TR:160/193)
rdm7_layout__splash_<name>    splash layouts              (TR:217-237)
rdm7_local_active             active layout name          (TR:1521, 1574)
rdm7_draft                    crash-recovery editor draft (FB:7566)
rdm7_layout_pending           { [name]: {payload,isSplash,ts} } offline saves (FB:17182-17191)
/api/layout/list -> { layouts: [names], active }          (TR:1549-1553)
```

## HUD overlay layout (localStorage "rdm7_camera" -> gp.cam)
```js
// GP_CAM_LS = "rdm7_camera" (TO:38531); the hud key inside it:
gp.cam.hud = {
  v: 1,
  w:    { hudSpeed: { dx: 40, dy: -12, k: 1.25 }, w3: {...} },  // S-unit nudges from the ALGORITHMIC default;
                                                                 // entry deleted when dx=0,dy=0,k=1 (TO:32452-32460)
  z:    ["hudSpeed", "hudMap", "w3", ...],   // full paint order, written only once reordered (TO:32468-32472)
  lock: { hudMap: 1 },                        // written only once locked (TO:32687-32693)
  add:  [ /* made widgets, below */ ],
  seq:  7                                     // id counter, never reused (TO:32499)
}
// sibling keys on gp.cam (NOT inside hud):
gp.cam.hudSpeed = false        // per-widget visibility; ABSENT MEANS ON (gpHudOn TO:30030)
gp.cam.hudMapStyle = "satdim"  // minimap ground: night|sat|satdim|plain (TO:29237-29248)

// a made widget (gpHudEdAdd TO:32505-32508 + gpHudEdProps TO:33117-33322):
{
  id: "w3",              // "w"+seq
  type: "bar",           // one of GP_HUD_MADE[..][0]; legacy "value" => "panel" on read (TO:29847)
  label: "Coolant",      // caption; defaults to channel name
  chan: "coolant_temp",  // RECORDING channel id (gp.traceChanIds entry) — not a dash signal name
  unit: "°C", dp: 1,
  lo: 60, hi: 110,       // range types only; absent => channel's measured lo/hi (TO:29916-29926)
  level: 105, below: 0,  // level types: threshold + direction (TO:29930-29933)
  col: "#d2232a",        // CSS color string (col types)
  rot: 90, sf: 0, dot: 1, trail: 0, name: 0   // track_map only; 0=off, ABSENT=ON (TO:33214-33229)
}
```

## HUD vocabularies
```js
// TO:29019-29029
var GP_HUD_WIDGETS = [ ["hudSpeed","Speed and gear"], ["hudTacho","Tacho"], ["hudPedals","Throttle and brake"],
  ["hudG","Grip circle"], ["hudDelta","Lap time and delta"], ["hudAngle","Slip angle"],
  ["hudMap","Minimap"], ["hudName","Track and date"], ["hudMark","RDM mark"] ];
// TO:29828-29842 — [type, name, defW, defH, needs]
var GP_HUD_MADE = [
  ["panel","Panel",150,86,"chan"], ["text","Text / Value",120,36,"chan"],
  ["bar","Bar Graph",220,34,"chan range"], ["rpm_bar","RPM Bar",460,40,"chan range"],
  ["meter","Meter",170,170,"chan range"], ["shift_light","Shift Light",300,26,"chan range"],
  ["warning","Alert Light",30,30,"chan level col"], ["indicator","Turn Indicator",46,46,"chan level"],
  ["banner","Alert Banner",420,54,"chan level col"], ["track_map","Track Map",200,150,"col track"],
  ["shape_panel","Shape",160,90,"col"], ["line","Line",220,6,"col"], ["arc","Arc",160,160,"col"] ];
// roles for the built-ins (TO:29048-29053):
var GP_HUD_ROLES = [ ["rpm",["rpm","engine_speed"],/\brpm\b|engine[ _-]?speed/i],
  ["thr",["throttle_position","accel_pedal_position"],/throttle|\btps\b|accel(erator)?[ _-]?pedal/i],
  ["brk",["brake_pedal_position","brake_pressure_front"],/brake/i], ["gear",["gear"],/^gear\b/i] ];
```

## gpHudRender core
```js
function gpHudRender(g, W, H, i, opt)          // TO:30355
var S = Math.min(Math.min(W, H) / 720, W / 700); // TO:30374
function gpHudPlace(g, key, S, box, out, draw)   // TO:30328 — translate(cx+dx*S, cy+dy*S); scale(k,k); rect pushed post-transform
// gpHudData(i) result (TO:29122-29126):
{ i, kph, spd, spdU, glon, glat, hdg, rpm, rpmMax, thr, brk, gear,
  thrF, brkF, beta, betaConf, betaRough, delta, lapNo, lapS }
// gpHudChanList() entry (TO:29769-29773):
{ id, col, def, name, unit, dp, lo, hi }
```

## Dash->HUD import plan (gpHudDashPlan, TO:32598-32642)
```js
gpHudDashPlan(layout, chans) -> { made: [ { type: "bar"|"value", chan, label, unit, dp, lo, hi } ],
                                  missed: ["signal name", ...] }
// pick per signal: bar|rpm_bar|meter widget wins, else labelled, else first (TO:32617-32625)
// lo/hi from config.min/config.max/config.rpm_max else channel measured (TO:32633-32638)
// window.__gpHudDash(layout, chans) dry-run handle (TO:33402)
```

## .rdm container (FB:18432-18460)
```
Header 16B: "RDM1" | version u16 LE =1 | entry_count u16 LE | flavour u8 (0 unstated / 1 layout / 2 dashboard) | 7B reserved
Entry: type u8 (0 layout JSON [firmware format] / 1 image / 2 font TTF / 3 channels.json)
       | name_len u8 | name UTF-8 | data_len u32 LE | data
Filename: <name>.layout.rdm / <name>.dashboard.rdm (FB:18476)
```

## gotchas

- **Never edit src/dist or firmware-base.html by hand** (ADR-0007). WIDGET_DEFS is an AUTO-GENERATED block (FB:8332/9095) synced from RDM-7_Dash and guarded by firmware-repo CI — a unified format cannot add keys to it from this repo; dash-side schema changes go through the firmware repo + sync_firmware.py. Desktop-only work goes in tauri-overlay.html; the GPS workspace is one IIFE, so anything a harness/CDP needs must be exported on `window` (the plan doc calls this out; `__gpHud`, `__gpHudEd`, `__gpHudDash` exist for that reason).
- **Two different color systems**: dash configs use ints (0xRRGGBB in the editor, RGB565 on the wire — conversion in buildFirmwarePayload FB:12101 and back in firmwareToWebFormat); HUD `col` is a CSS string. A converter must translate, including night-override objects (`config.night`) that only the dash has.
- **Two different binding namespaces**: dash `w.signal` is a name in the dash's channel/signal registry; HUD `chan` is a recording channel id resolved against `gp.traceChanIds`. LAYOUTS_FROM_RECORDINGS_2026-08.md names this THE problem: they line up most of the time and assuming it is wrong; imported-log channels must never silently enter the dash channel library, and adoption must carry `is_signed` or values read as ~65500.
- **Two different geometry philosophies, on purpose**: dash = absolute center-origin px on fixed 800×480; HUD = algorithmic flow + relative {dx,dy,k} in S units. HUD_OVERLAY_PLAN records the explicit decision (and the reason) that absolute anchors were rejected; a "unified file" that forces absolute geometry re-breaks portrait/landscape and future default tuning. Both import directions already deliberately refuse to copy geometry (TO:32539-32544).
- **Absent-means-factory is load-bearing across the whole HUD store**: visibility (gp.cam[key] !== false), positions (entry deleted at factory values, TO:32459), track_map toggles (0 vs absent), lo/hi (fall back to measured range). Serializing "complete" objects would freeze future defaults — any converter/exporter must preserve sparseness.
- **`gpCamLoad` copies key-by-key** (TO:38532-38558): any new key persisted into `rdm7_camera` must be explicitly named there or it is silently dropped on the next reload. This bug shipped once and has its own check in tools/check_hudedit.js.
- **`gpHudEdStore` must fill gaps, never replace** (TO:32430-32447) — replacing wiped `add`/`z`/`lock` for stores that had widgets but no moves.
- **One renderer rule**: the tile, both export paths, and the editor stage all call the same `gpHudRender`; VIDEO_HUD_EXPORT/HUD_OVERLAY_PLAN both state that an editor-only or export-only renderer is how surfaces drift. Any unification must keep a single draw path (the dash side equivalently has ONE WASM renderer shared with the device).
- **Layouts read back from the device may omit fields at their defaults** ("defaults-only saves" — FB:8989, 12841, 15801, 18489); converters must resolve effective values through WIDGET_DEFS defs (helper `resolveFieldDefault`-style code at FB:12555-12562), and a mismatched editor default silently relabels saved data (the pathbar `shape` comment is a lived example).
- **HUD made-widget ids key position/lock/z** — never derived from list length; deletion cascades (TO:32493-32537). A converter emitting ids must respect `seq`.
- **The existing dash→HUD importer collapses types** to `bar`/`value` (TO:32621-32625) — written before GP_HUD_MADE grew the full vocabulary; upgrading it is cheap and is the natural first step of unification.
- **32 KB firmware layout cap** (FB:17098-17110) — any unified file that embeds overlay data must keep the dash payload under it (or strip overlay keys before /api/layout/save; firmware tolerance of unknown top-level keys is NOT verified here).
- **rdm7_camera is real user data** (per MEMORY: a probe once overwrote his `satdim`); read-before-write in any migration. Same for `rdm7_tracks_v1`.
- **allow_empty** (FB:12096-12098): saving zero widgets without it is refused by firmware — a naive programmatic writer will hit this.
- **`toggle`/`button`/`image`/`pathbar`/`anim` are excluded from the HUD on stated grounds** (VIDEO_HUD_EXPORT:231-232) — a unified format needs a defined "not applicable on this surface" behaviour rather than assuming full type overlap; conversely the 9 HUD built-ins have no dash types.
- **His WIP is on branch `analyse-video-playback` — never commit over it** (memory + HUD plan ritual). Ritual for any change here: `python tools/merge_overlay.py` → `node tools/check_all.js` → look at a real export.

## open_questions

- **Does the dash firmware tolerate unknown top-level keys in a layout JSON** (e.g. an embedded `overlay` block riding in the same file through /api/layout/save and back out of /raw)? Not determinable from this repo alone — the save/load handlers live in ../RDM-7_Dash (I did not open the firmware source for `/api/layout/save`); the 32 KB cap (FB:17098) is the only client-side constraint found. Needs a check in RDM-7_Dash's layout_manager before choosing "one file, two sections" over "two files, one converter".
- **Exact WASM renderer entry points**: `load_layout_json` / `load_channels_json` / `inject_signal` are cited from docs/LAYOUTS_FROM_RECORDINGS_2026-08.md:36-38 (and the wasm module is built in rdm7-wasm-editor); I did not verify their signatures in src/build/index.js (minified WASM glue).
- **Whether any default-stripping happens on the JS side before save**: I found none (addWidget writes full configs; buildFirmwarePayload copies them) — the "defaults-only" comments (FB:8989 etc.) appear to describe what the firmware writes back / what older files contain. Searched: `prune|strip|=== f.def|deepEqual` in firmware-base.html.
- **`/api/layout/switcher` payload shape** (order array? names?) — used at FB:17781/17885 but I did not read the request body construction in detail.
- **The AI-paste import path** (FB:4533, 7913 "Mirrors the .rdm/file import — validate → firmwareToWebFormat → renderEditor") — flow confirmed by comments, function internals not read line-by-line.
- **Marketplace payload format** — nothing exists in this repo beyond the link-out and the `.rdm` layout-flavour rationale; whatever the Web Studio / marketplace repo expects was not visible from here (PLATFORM_PLAN in ../RDM-7_Dash/docs may say more; not read for this pass).