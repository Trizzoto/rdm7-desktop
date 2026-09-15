# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RDM Studio (formerly "RDM-7 Visual Designer"; renamed 2026-07-10 — the bundle `identifier` stays `com.rdm7.designer` so self-update and app data carry over) — a Tauri 2 desktop app for designing automotive dashboard/gauge clusters for RDM-7 display hardware, expanding into the configuration suite for the whole RDM device family (CAN keypads, GPS lap timer, IO expander — see `../RDM-7_Dash/docs/PLATFORM_PLAN_2026-07.md`). Rust backend handles device communication; the frontend is a single-page HTML/JS app with a WebAssembly renderer compiled from separate C/C++ firmware code (rdm7-wasm-editor repo).

This repo (rdm7-desktop) is one part of a larger project that includes: **Web Studio** (browser-based editor), **Desktop Studio** (this repo), **RDM Marketplace** (shared layouts/assets), and **RDM-7 Dash** (the device firmware/runtime). They share the same WASM renderer and layout format.

**Where to look for what** — this file is architecture and build mechanics, kept short on purpose. For a live feature initiative, read the doc, not this file:
- GPS lap timing / telemetry analysis (Studio side) — `docs/LAP_ANALYSIS_REDESIGN_2026-07.md`
- Why the Analyse mosaic resizes itself as you click around it (the working
  panel, ADR-0061) — `docs/ANALYSE_SPACE_2026-09.md`
- Why the bus health, the channel-rate check, the "what to practise" panel, the
  session verdict and the video auto-sync all exist, and what auto-sync refuses
  to do — `../RDM-7_Dash/docs/adr/0066-the-app-says-what-it-knows.md`
- How "Set it up for me" MEASURES the puck's mounting instead of asking, where a
  corner's name is kept, and why the ring now warns before it wraps —
  `../RDM-7_Dash/docs/adr/0067-measure-it-rather-than-asking.md`
- What the car on the map is made of, why a custom one keeps its steering and
  its brake lights, and where the paint-your-own template comes from —
  `../RDM-7_Dash/docs/adr/0065-a-car-icon-is-a-body-and-the-parts-that-move.md`
- Why the bottom bar carries the whole day, why the footage panel has a named
  gutter, and how to change either (Setup → Analyse) —
  `../RDM-7_Dash/docs/adr/0064-one-transport-and-it-carries-the-film.md`.
  The five shapes were drawn first as a live prototype:
  `tools/design/footage-timeline.html`
- The keypad's lights — the boot, what it rests in, what a press does (the
  Lights section, `kpfx*`) — and holding more than one keypad —
  `docs/KEYPAD_LIGHTSHOW_2026-09.md`
- Why the keypad Design page has no Live tab, why a ring is dark until its
  button is on, and how a control demonstrates itself (`kpDemo*`, the
  `data-demo` hooks) — `../RDM-7_Dash/docs/adr/0062-the-picture-is-the-simulator.md`
- Which three lighting settings a PKP actually has, why there is no night
  brightness, and why a warning is drawn as a layer over the button's own
  colour — `../RDM-7_Dash/docs/adr/0063-the-lighting-the-part-actually-has.md`
- Why the dash, not Studio, plays a keypad's boot in the car (the tape, its
  two refusals, and the cross-repo fixture) —
  `../RDM-7_Dash/docs/adr/0068-the-dash-is-the-host-the-keypad-never-had.md`
- The whole device family's roadmap, and which repo owns which workspace — `../RDM-7_Dash/docs/PLATFORM_PLAN_2026-07.md`
- Where new workspace UI gets authored (firmware-first vs desktop-first) — `../RDM-7_Dash/docs/STUDIO_SHELL_PLAN_2026-07.md` §2.0
- CAN channel logging on the GPS puck itself (node firmware, unbuilt) — `../rdm-gps-node/docs/TRACE_V2_CAN_CHANNELS.md`

## Build

There is no npm/yarn — the frontend has no bundler or package manager. The WASM artifacts (`src/build/index.js` and `src/build/index.wasm`) are built externally in the `rdm7-wasm-editor` repo and copied in.

## Frontend is BUILT, not edited (ADR-0007)

The editor HTML is assembled at build time — **never edit `src/dist/` or
`src/firmware-base.html` by hand**:

```
src/firmware-base.html    verbatim copy of RDM-7_Dash/main/web/index.html
+ src/tauri-overlay.html  every desktop-specific delta, as anchored blocks
= src/dist/index.html     what the Tauri webview loads (gitignored)
```

- `python tools/merge_overlay.py` — builds `src/dist/` (also runs automatically
  as Tauri's beforeDevCommand/beforeBuildCommand).
- `python tools/sync_firmware.py` — pulls the latest firmware editor HTML from
  `../RDM-7_Dash` into `src/firmware-base.html`, then merges. Run this whenever
  the firmware editor changes; that IS the desktop sync now.
- A failed merge means a block's anchor no longer matches the firmware HTML —
  that's the drift detector. Fix the anchor in `src/tauri-overlay.html`.
- Desktop-only UI/behaviour changes go in `src/tauri-overlay.html` (or
  `transport.js` / `lib.rs`). Editor features shared with the device belong in
  the firmware repo (`RDM-7_Dash/main/web/index.html`), then re-sync.
- `WIDGET_DEFS` arrives via the firmware base and is guarded by firmware-repo
  CI; the old vendored `schema/` + codegen pipeline in this repo was retired.

## Architecture

### Backend (`src-tauri/`)

Key backend subsystems:
- **ADB link (`adb_devices` / `adb_forward` / `adb_forward_remove`)** — the Luckfox-based dashes are Linux boards: no CDC serial port, so the serial transport can never see one. What they expose over USB is adb, and behind it the same HTTP API WiFi uses. Connecting forwards a free local port (asked of the OS, not a fixed number — `adb forward` will happily rebind a port something else is serving) to the board's port 80, then hands off to the ordinary HTTP transport. The mode is `adb` in `transport.js`; it is deliberately absent from `restoreLastConnection()` because a forward dies with the app — the overlay's restore calls `RDM.adbConnect()` instead.
- **Device discovery** — parallel HTTP sweep of every local /24 subnet probing `GET /api/device/info` (the firmware has no mDNS — it was removed 2026-04-27). `discover_devices` takes `extra_ips` to probe known addresses first; `probe_device` checks a single IP fast. Emits `scan-progress` events.
- **Serial protocol** — custom binary framing: `STX + 4-byte LE length + payload + CRC16-CCITT + ETX`. Payload type 0x00 = JSON, 0x01 = binary (chunked firmware uploads with session_id + chunk_idx, 4096-byte chunks). Progress emitted via Tauri events.
- **HTTP proxy** — `http_fetch`/`http_fetch_binary`/`http_upload_binary` commands bypass CORS for device communication. Uses `no_proxy()` (important for local device hotspots).
- **Firmware updates** — checks GitHub releases API, compares semver versions.

### Frontend (`src/`)
- **`firmware-base.html` + `tauri-overlay.html` → `dist/index.html`** — the SPA (~22k lines merged). See "Frontend is BUILT, not edited" above.
- **`transport.js`** — Transport abstraction layer exposing `window.RDM` API. Implementations: LocalTransport, WifiTransport (+ hotspot and `adb` variants — an adb-forwarded Linux dash IS a WifiTransport pointed at 127.0.0.1, so there is no second HTTP implementation to keep in step), UsbTransport, plus the `fetch()` interceptor that reroutes the firmware's raw `/api/*` calls through the active transport under Tauri. **Local (Offline) is a "virtual dash"**: `_localRouteApiCall` serves `/api/layout/*`, `/api/image|font/list`, `/api/storage/info`, `/api/device/info`, etc. from `LocalTransport` (localStorage/IndexedDB), so the firmware editor code works offline unchanged. It keeps its own active layout in `rdm7_local_active`. The interceptor routes ALL modes (including local) through `proxyApiCall` — the earlier `mode!=='local'` skip made offline `/api` calls 404 on the tauri.localhost origin. `RDM.local` (the local store) and `RDM.deviceTransport()` (device when connected) are exposed so layout **transfer** can read/write both stores at once.
- **`build/`** — WASM module. Loaded at runtime for real-time canvas rendering of dashboard widgets/signals.

## Release Process

Cutting a release is a skill — see `.claude/skills/release/SKILL.md`.

**Updater signing key**: private key at `C:\Users\ruuva\.tauri\rdm7-desktop-updater.key`
(no password) + the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret. **Back it up —
if it's lost, already-installed apps can never self-update again** (they
verify against the pubkey baked into their config). Local signed builds:
`TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/rdm7-desktop-updater.key cargo tauri build`.

## Important Notes

- The frontend uses `'unsafe-eval'` and `'wasm-unsafe-eval'` CSP directives — required for WASM execution.
- Serial port auto-detection filters by USB VID/PID to identify RDM-7 hardware.
- KiCAD schematic files in the repo root are hardware reference designs for display interfaces (DSI-to-LVDS bridge, round LCD), not part of the software build.
