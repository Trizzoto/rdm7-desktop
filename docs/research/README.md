# Raw research — the eight features (2026-09-01)

Six code surveys written to support `../EIGHT_FEATURES_PLAN_2026-09.md`. They are
**raw research, not prose**: dense, `file:line`-anchored, written for an implementer
who is about to edit the file, and occasionally rough. Where a brief and one of these
disagree, the brief is the decision and this is the evidence.

Every line reference is against **source** files — `src/tauri-overlay.html`,
`src/firmware-base.html`, `src/transport.js`, `src-tauri/src/lib.rs` — never
`src/dist/index.html`, which is generated (ADR-0007). Line numbers were correct on
branch `analyse-video-playback` at commit `19014ef`; the overlay moves, so treat them
as a starting point and confirm the symbol name.

| File | Feeds |
|---|---|
| `drift-calibration.md` | Trust panel — the gyro/yaw pipeline, `gpDriftAngle()`, puck IMU firmware |
| `session-quality.md` | Trust panel — every data-quality signal that exists today and where each lives |
| `harness-tests.md` | Golden recordings — how `tools/check_*.js` work, fixtures, `check_all.js`, CI |
| `layout-formats.md` | One layout format — dash `WIDGET_DEFS` vs the HUD overlay format |
| `export-pipeline.md` | Highlights, comparison video, background export — the whole video export flow |
| `moments-analysis.md` | Highlights, comparison video — Moments, corner scoring, best/ideal lap, delta |
