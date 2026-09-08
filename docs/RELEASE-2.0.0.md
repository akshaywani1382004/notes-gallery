# Notes Gallery 2.0.0 — stage 1 "Pen first"

Website `?v=114`, Windows 2.0.0, Android 2.0.0. Architecture: `ARCHITECTURE-2.0.md`; spec: `STAGE1-SPEC.md`.

## What changed for the pen

- **Every sample taken once.** A stroke's channel is decided by its first move-class event (`pointerrawupdate` wins; the following `pointermove` only feeds prediction). The v113 timestamp de-dup that could drop Android's batched samples is gone (`js/ink/sampler.js`).
- **Live layer repaints a dirty rectangle, not the screen.** Clip → clear → redraw every pending path that crosses it, from the same path generator the saved SVG uses; predicted tail from the browser's motion predictor; the stroke stays on the glass until the committed pixels are on screen (`js/ink/wet.js`). Raster cost per sample at dpr 2.5: 2.7→5.0 ms growing along the stroke in 1.5.3, now 0.2–0.4 ms flat.
- **Pen-down lands on the live canvas** (`pointer-events:auto` while the pen tool is up), which lets Chromium stop aligning moves to animation frames.
- **Android:** the WebView asks for unbuffered stylus dispatch on pen contact (what Chrome itself does), so Android no longer batches pen samples per frame; renderer priority raised; 120 Hz requested while a stylus tool is up; `NGHost` bridge. Kill switch in the diagnostics overlay.
- **Large selections:** 2+ blocks move as one lifted container (one transform per move), selection frame/bar from data and positioned by transform, no forced layout per gesture frame; mini-map content cached and re-projected per frame.
- **Diagnostics overlay** (⋯ menu → Diagnostics, Ctrl+Shift+D, `?diag=1`): input tier and channel, samples/s, coalesced list size, Δt, latency, predicted points, rAF Hz, long frames, paint ms, save timings, host info; 10 s raw trace recorder.
- Workspace files import from inside a workspace (Add → Import, drag-and-drop) with an offer to open; app-shell file reads decode byte payloads and report real errors.

## Measured (headless Edge harness, 1440×900)

| metric | 1.5.3 | 2.0.0 |
|---|---|---|
| live raster per sample @1448 pts, dpr 2.5 | 5.0 ms | 0.4 ms |
| live raster per sample @148 → @1448, dpr 1 | 0.6 → 1.6 ms | 0.3 → 0.5 ms |
| mini-map per pan frame, 2206 blocks | 4.2 ms | 0.1 ms |
| drag 300 lassoed strokes, per move | ~ (N style writes) | 0.4 ms median, 0.7 p95, layout Δ 2 / 60 moves |
| lasso-select 1000 strokes (pointer-up) | 43 ms | 3.7 ms |
| undo / redo, 906 blocks | 5 / 5 ms | 5 / 5 ms |
| preview present at once, 4 styles × dpr 1/2/2.5 | — | 50/50 strokes, all styles |
| heap after 300 strokes + 200 undo/redo + 100 panel toggles + 50 lassos | +0.5 MB | +0.3 MB |

Still open (stage 2): zoom-step style flush at 2206 blocks (handles restyle, 25 ms).

## Tablet checklist (only the device can confirm)

Open ⋯ → Diagnostics and record while writing a page:
1. tier `raw`, `isSecureContext true`, channel `raw` while writing.
2. Δt median ≈ 4.2 ms and coalesced p50 = 1 with "Unbuffered" on (≈ 8.3 ms / 2–3 with it off).
3. Samples/s ≥ 200 at S-Pen speed; latency p95 ≤ 20 ms.
4. 50 fast loops: no straight chords, no ribbon blobs; preview visible for every stroke.
5. Finger scrolling unaffected; a resting finger while writing never pans or opens a menu.
6. Power-saving mode: refresh shows 60 Hz (expected); normal: 120 Hz while the pen tool is up.
7. Long frames (LoAF) during a 10 s scribble ≤ 1.
If something feels wrong, press "Record 10 s" during it and export the trace.

## 2.0.1 (site v115) — same day

- Connectors keep their label, line style and both-ends arrow through Export, Import and copy-paste (they were dropped since 1.x; found by the workspace verification pass).
- The About header shows the build: app version and site cache number (e.g. "2.0.1 · v115").
- Workspace verification (three end-to-end runs): lifecycle, persistence of every block kind with export/import round-trip, save paths and service-worker update - no workspace-breaking problem; the database schema is unchanged, so 1.x data needs no migration.
