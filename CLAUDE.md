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

There is no npm/yarn — the frontend has no bundler or package manager. The WASM artifacts (`src/build/index.js` and `src/build/index.wasm`) are built externally in the `rdm7-wasm-editor` repo and copied in; they are gitignored.

## Architecture

### Backend (`src-tauri/`)
- **`src/lib.rs`** — All Tauri commands (~18 `#[tauri::command]` functions) and the `run()` function that wires up plugins and state. This is the main file for backend work.
- **`src/main.rs`** — Minimal entry point, calls `lib::run()`.
- **State:** `SerialState` (Mutex-wrapped serial port) is the only shared Tauri state.

Key backend subsystems:
- **mDNS discovery** — browses `_rdm7._tcp.local.` for devices on the network
- **Serial protocol** — custom binary framing: `STX + 4-byte LE length + payload + CRC16-CCITT + ETX`. Payload type 0x00 = JSON, 0x01 = binary (chunked firmware uploads with session_id + chunk_idx, 4096-byte chunks). Progress emitted via Tauri events.
- **HTTP proxy** — `http_fetch`/`http_fetch_binary`/`http_upload_binary` commands bypass CORS for device communication. Uses `no_proxy()` (important for local device hotspots).
- **Firmware updates** — checks GitHub releases API, compares semver versions.

### Frontend (`src/`)
- **`index.html`** — The entire SPA (~10k lines). All UI, styles, and application logic in one file.
- **`transport.js`** — Transport abstraction layer exposing `window.RDM` API. Implementations: LocalTransport, WifiTransport, HotspotTransport, UsbTransport. Bridges Tauri `invoke()` calls to backend commands.
- **`build/`** — WASM module (gitignored). Loaded at runtime for real-time canvas rendering of dashboard widgets/signals.

### Communication Flow
Frontend JS → `window.__TAURI__.core.invoke("command_name", {args})` → Rust `#[tauri::command]` → serial port / HTTP / mDNS → response back to JS.

## Release Process

Tag a commit with `v*` (e.g., `v0.1.0`). GitHub Actions builds on Windows, runs `cargo tauri build`, and uploads MSI/NSIS installers to the GitHub release.

## Important Notes

- The frontend uses `'unsafe-eval'` and `'wasm-unsafe-eval'` CSP directives — required for WASM execution.
- Serial port auto-detection filters by USB VID/PID to identify RDM-7 hardware.
- KiCAD schematic files in the repo root are hardware reference designs for display interfaces (DSI-to-LVDS bridge, round LCD), not part of the software build.
