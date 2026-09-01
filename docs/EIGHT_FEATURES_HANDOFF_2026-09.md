# Handoff: planning the eight features — closed

**Status: done, superseded by `EIGHT_FEATURES_PLAN_2026-09.md`.** This file was a
working note so a fresh session could pick the research up mid-flight. It has. Kept as
the record of how the plan got made; nothing here needs acting on.

The plan is `EIGHT_FEATURES_PLAN_2026-09.md`, the per-feature briefs are in `briefs/`
(one file each, written to be handed over on their own), and the six code surveys they
rest on are in `research/`.

## What the brief was

2026-08-31 he reviewed `STUDIO_IDEAS_2026-08.md` — eight feature ideas, already ranked —
and said *"plan it all out and how to implement, do all the hard thinking and yards and
then get ready to pass on the bulk work to opus to save usage."* All eight greenlit, with
per-item reactions ranging from *"yep go on"* to *"brilliant"*.

## How it was resolved (2026-09-01)

**Research.** Ten parallel briefs were commissioned; six completed and four hit the
session usage limit. The four were closed by direct investigation rather than re-running
the fleet, which was faster for single topics:

| Gap | Closed by |
|---|---|
| `docs-decisions` | `STUDIO_IDEAS`, `LAP_ANALYSIS_REDESIGN` headings, `VIDEO_HUD_EXPORT` + `HUD_OVERLAY_PLAN` (the latter two already surveyed in `research/layout-formats.md` §7). Marketplace: **no doc exists** — it is a Supabase layout-sharing platform, link-out only in this repo (`openMarketplace` `21780-21783`), and `ADR-0042` is the relevant decision. |
| `workspace-shell` | `tools/merge_overlay.py` in full (22 anchored blocks; new static files must join `ASSETS` at `:44`); `gpSetView` (`35454-35590`, 7 views not 6 — Drift was added after ADR-0024); CSP read from `tauri.conf.json:25`. |
| `video-playback` | One `<video>` element and one `gp.video`, but the fast export path never touches either — it reads through a **stateless** reader into WebCodecs, so two decoders are fine. `gpDeltaSeries` (`18656-18682`) already computes the lap-to-lap spatial match and discards it. Cross-session comparison is already built, behind `gp.ghostFence`. |
| `history-storage` | `gpStore` (`10247-10300`), `gpHistoryFor`/`gpHistoryHtml` (`11516`, `11569`) — the feature is **written, not missing**; it starves because most sessions carry `trackId: null`. |

**The worker/CSP question — the one flagged as most consequential — came back the other
way.** CSP permits workers (no `worker-src`, so `default-src` with `'self'`/`blob:`
applies), but a worker is the wrong answer: decode and encode are already off-main-thread,
the fast path already survives a hidden window on dequeue-event backpressure, and the
actual blockers are a full-screen modal and shared mutable state. Background export got
*smaller*, not bigger. Reasoning and evidence in `briefs/06-background-exports.md`, which
owns ADR-0052.

**Item 1 folded into item 2** — `gpDriftAngle()` already self-calibrates from ordinary
driving and hides the result. Confirmed with him rather than reordered silently. The
mounting-axis routine survives as deferred item 1b, written up at the end of
`briefs/01-trust-panel.md` so it isn't re-derived.

**Item 3's pinned recordings get committed to the repo.** Also confirmed with him. It is
the only option where the golden tests run anywhere but this PC.

## What is left

ADRs **0049–0052** were written 2026-09-01 and are indexed in
`../RDM-7_Dash/docs/adr/README.md` (next free number is now 0053). So what remains is
the building, in the order `EIGHT_FEATURES_PLAN_2026-09.md` gives: golden recordings,
trust panel, session history, layout format, background export, highlights, comparison
video.

Baseline as of 2026-09-01: `python tools/merge_overlay.py` clean,
`node tools/check_all.js` **34 harnesses, all passed**.
