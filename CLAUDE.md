# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RDM Studio (formerly "RDM-7 Visual Designer"; renamed 2026-07-10 — the bundle `identifier` stays `com.rdm7.designer` so self-update and app data carry over) — a Tauri 2 desktop app for designing automotive dashboard/gauge clusters for RDM-7 display hardware, expanding into the configuration suite for the whole RDM device family (CAN keypads, GPS lap timer, IO expander — see `../RDM-7_Dash/docs/PLATFORM_PLAN_2026-07.md`). Rust backend handles device communication; the frontend is a single-page HTML/JS app with a WebAssembly renderer compiled from separate C/C++ firmware code (rdm7-wasm-editor repo).

This repo (rdm7-desktop) is one part of a larger project that includes: **Web Studio** (browser-based editor), **Desktop Studio** (this repo), **RDM Marketplace** (shared layouts/assets), and **RDM-7 Dash** (the device firmware/runtime). They share the same WASM renderer and layout format.

**Where to look for what** — this file is architecture and build mechanics, kept short on purpose. For a live feature initiative, read the doc, not this file:
- GPS lap timing / telemetry analysis (Studio side) — `docs/LAP_ANALYSIS_REDESIGN_2026-07.md`
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
- **Device discovery** — parallel HTTP sweep of every local /24 subnet probing `GET /api/device/info` (the firmware has no mDNS — it was removed 2026-04-27). `discover_devices` takes `extra_ips` to probe known addresses first; `probe_device` checks a single IP fast. Emits `scan-progress` events.
- **Serial protocol** — custom binary framing: `STX + 4-byte LE length + payload + CRC16-CCITT + ETX`. Payload type 0x00 = JSON, 0x01 = binary (chunked firmware uploads with session_id + chunk_idx, 4096-byte chunks). Progress emitted via Tauri events.
- **HTTP proxy** — `http_fetch`/`http_fetch_binary`/`http_upload_binary` commands bypass CORS for device communication. Uses `no_proxy()` (important for local device hotspots).
- **Firmware updates** — checks GitHub releases API, compares semver versions.

### Frontend (`src/`)
- **`firmware-base.html` + `tauri-overlay.html` → `dist/index.html`** — the SPA (~22k lines merged). See "Frontend is BUILT, not edited" above.
- **`transport.js`** — Transport abstraction layer exposing `window.RDM` API. Implementations: LocalTransport, WifiTransport (+ hotspot variant), UsbTransport, plus the `fetch()` interceptor that reroutes the firmware's raw `/api/*` calls through the active transport under Tauri. **Local (Offline) is a "virtual dash"**: `_localRouteApiCall` serves `/api/layout/*`, `/api/image|font/list`, `/api/storage/info`, `/api/device/info`, etc. from `LocalTransport` (localStorage/IndexedDB), so the firmware editor code works offline unchanged. It keeps its own active layout in `rdm7_local_active`. The interceptor routes ALL modes (including local) through `proxyApiCall` — the earlier `mode!=='local'` skip made offline `/api` calls 404 on the tauri.localhost origin. `RDM.local` (the local store) and `RDM.deviceTransport()` (device when connected) are exposed so layout **transfer** can read/write both stores at once.
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
