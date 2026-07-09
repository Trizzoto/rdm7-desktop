# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RDM-7 Visual Designer — a Tauri 2 desktop app for designing automotive dashboard/gauge clusters for MaxxECU systems. Rust backend handles device communication; the frontend is a single-page HTML/JS app with a WebAssembly renderer compiled from separate C/C++ firmware code (rdm7-wasm-editor repo).

This repo (rdm7-desktop) is one part of a larger project that includes: **Web Studio** (browser-based editor), **Desktop Studio** (this repo), **RDM Marketplace** (shared layouts/assets), and **RDM-7 Dash** (the device firmware/runtime). They share the same WASM renderer and layout format.

## Build & Development Commands

```bash
# Development (hot-reload frontend, Rust recompiles on change)
cargo tauri dev

# Production build (generates MSI + NSIS installers)
cargo tauri build

# Rust checks only (faster iteration on backend)
cd src-tauri && cargo check
cd src-tauri && cargo clippy
```

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
- **`src/lib.rs`** — All Tauri commands (~18 `#[tauri::command]` functions) and the `run()` function that wires up plugins and state. This is the main file for backend work.
- **`src/main.rs`** — Minimal entry point, calls `lib::run()`.
- **State:** `SerialState` (Mutex-wrapped serial port) is the only shared Tauri state.

Key backend subsystems:
- **Device discovery** — parallel HTTP sweep of every local /24 subnet probing `GET /api/device/info` (the firmware has no mDNS — it was removed 2026-04-27). `discover_devices` takes `extra_ips` to probe known addresses first; `probe_device` checks a single IP fast. Emits `scan-progress` events.
- **Serial protocol** — custom binary framing: `STX + 4-byte LE length + payload + CRC16-CCITT + ETX`. Payload type 0x00 = JSON, 0x01 = binary (chunked firmware uploads with session_id + chunk_idx, 4096-byte chunks). Progress emitted via Tauri events.
- **HTTP proxy** — `http_fetch`/`http_fetch_binary`/`http_upload_binary` commands bypass CORS for device communication. Uses `no_proxy()` (important for local device hotspots).
- **Firmware updates** — checks GitHub releases API, compares semver versions.

### Frontend (`src/`)
- **`firmware-base.html` + `tauri-overlay.html` → `dist/index.html`** — the SPA (~22k lines merged). See "Frontend is BUILT, not edited" above.
- **`transport.js`** — Transport abstraction layer exposing `window.RDM` API. Implementations: LocalTransport, WifiTransport (+ hotspot variant), UsbTransport, plus the `fetch()` interceptor that reroutes the firmware's raw `/api/*` calls through the active transport under Tauri.
- **`build/`** — WASM module. Loaded at runtime for real-time canvas rendering of dashboard widgets/signals.

### Communication Flow
Frontend JS → `window.__TAURI__.core.invoke("command_name", {args})` → Rust `#[tauri::command]` → serial port / HTTP / mDNS → response back to JS.

## Release Process (installers + built-in self-update)

1. Bump `version` in `src-tauri/tauri.conf.json` (single source of truth —
   `Cargo.toml` should match; the frontend's `_DESKTOP_VERSION` is injected
   from it by merge_overlay.py).
2. Commit, then tag `v<version>` (e.g. `v0.2.0`) and push the tag.
3. GitHub Actions (tauri-action) builds Windows setup.exe (NSIS) + MSI, macOS
   DMGs, Linux AppImage/deb/rpm, **signs each bundle** with the
   `TAURI_SIGNING_PRIVATE_KEY` repo secret, generates `latest.json` with the
   signatures, and publishes everything to the GitHub release.
4. Installed apps poll `releases/latest/download/latest.json` (checked ~3 s
   after launch, banner → one-click passive update via tauri-plugin-updater;
   the pubkey in tauri.conf.json verifies every download).

**Updater signing key**: private key at `C:\Users\ruuva\.tauri\rdm7-desktop-updater.key`
(no password) + the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret. **Back it up —
if it's lost, already-installed apps can never self-update again** (they
verify against the pubkey baked into their config). Local signed builds:
`TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/rdm7-desktop-updater.key cargo tauri build`.

Not yet done: Windows Authenticode code-signing (SmartScreen will show the
"unknown publisher" warning until an OV/EV certificate is purchased and wired
into the workflow).

## Important Notes

- The frontend uses `'unsafe-eval'` and `'wasm-unsafe-eval'` CSP directives — required for WASM execution.
- Serial port auto-detection filters by USB VID/PID to identify RDM-7 hardware.
- KiCAD schematic files in the repo root are hardware reference designs for display interfaces (DSI-to-LVDS bridge, round LCD), not part of the software build.
