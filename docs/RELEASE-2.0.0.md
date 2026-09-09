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

## 2.0.2 (site v116) — GUI round

- Toolbar regrouped: brand + outline / search / read on the left; home, back, forward, Add, link, pen, eraser, Select and delete in the middle; undo, redo and zoom on the right; save status, theme and menu at the end. Groups wrap to three rows on a phone.
- The dark band along the right edge (the hidden drawer's shadow) is gone.
- New mark: a dark tile with the page-and-nib glyph in silver and one accent point at the nib. Same glyph in the toolbar, About, the home hero, the favicon, icon.svg and every Tauri icon (Windows and Android adaptive icons regenerated with a dark background).
- Fingers move the page. A finger drag on an unselected block pans; a finger tap selects it, and a selected block can then be moved, resized, long-pressed and opened by finger. The Select tool answers to the stylus (or mouse) only; a finger with it up pans.
- Two erasers. The toolbar eraser takes anything it touches: strokes, blocks, shapes, text, images and connectors (all three modes: sweep, whole object, circle). The eraser inside the draw panel erases handwriting only. Pressing the toolbar button while the panel's eraser is up widens it; the panel button narrows it again. Everything an eraser gesture removes is one undo step.
- Copy and paste travel across workspaces, platforms and devices: Copy also writes the selection to the device clipboard as a Notes Gallery clip (blocks, connectors, attachments as data URLs, 20 MB budget; 400 KB on Android), and Paste (Ctrl+V, the context menu) reads it back in any workspace, in the website or the apps. An image on the device clipboard pastes as an image block. Android: text clips only; the WebView plugin has no image clipboard.
- The outline and search buttons put the pen, eraser and Select tool away when tapped.
- The About header shows "2.0.2 · v116".

Stage 2 of the Ink Plane (stroke model, spatial index, handles on demand, IndexedDB v4, autosave off the input thread) moves to 2.0.3 / v117.

## 2.0.3 (site v117) — the studio theme

- New look: near-black surfaces (never pure black), hairline borders instead of shadows, one muted emerald accent, light bleeding in from the top, halftone dot texture, Instrument Sans for the interface and JetBrains Mono for key chips. Tokens live in `css/theme.css`; `css/styles.css` keeps the layout and maps its older variable names onto the tokens. The light theme is a light variant of the same palette.
- Landing screen: two-tone headline ("Notes Gallery" / "A canvas for your thinking"), a tilted miniature of each workspace's top page on its card, the wordmark in halftone at the foot of the page, one staggered reveal (240 ms, 60 ms steps), nothing looping. Respects prefers-reduced-motion.
- Canvas: blocks are a surface step with a light top edge; the selected block gets a soft emerald glow (dropped while it is being dragged, so a drag repaints nothing soft); connectors are 1 px dashed emerald with a point of light at the middle (no SVG filters); handles and lasso in accent ink.
- Performance decisions (kept from the lag rounds): no backdrop blur on any panel over the canvas (floating panels are near-opaque charcoal), no full-screen grain overlay (a static grain tile appears only on the landing screen and modal cards), no filter effects on connectors, fonts self-hosted (about 84 KB, precached) instead of fetched from Google Fonts.
- Toolbar: spacing is fluid. From 1440 px down to 1200 px the air between buttons shrinks (12 → 6 px, groups 28 → 12 px); from 1200 px to 1024 px the buttons shrink (42 → 36 px) and the wordmark hides at 1100 px; below 960 px the right group wraps to a second row (34–36 px buttons, still finger-sized) and at 560 px the phone layout takes over. Nothing overflows or overlaps at any width.
- Mark: the same glyph in accent ink on a raised charcoal tile; favicon, icon.svg and the Tauri icons regenerated to match. New workspaces and blocks default to the emerald accent (existing colours are untouched).
- Image properties: Crop (rectangle) and Crop by selection (freehand loop, transparent outside). Apply replaces the image at full resolution and is one undo step.

Ink Plane stage 2 moves to 2.0.4 / v118.

## 2.0.4 (site v118) — polish after the theme

- Floating panels (draw panel, selection bar, menus, context menu, command palette, search, mini-map, toasts, outline, editor drawer) are frosted glass again: 16 px backdrop blur at 72% surface, by the user's choice after the cost was explained (a blur re-renders whenever the canvas under it changes, so pan and zoom with panels open cost a few ms per frame on a tablet).
- Read mode: a pointer landing on any object pans the page, exactly like one on empty paper. Nothing is picked up or moved; a double-tap on a card still steps inside.
- The mark is silver again with one emerald point at the nib, on the dark tile: toolbar, About, home hero, favicon, icon.svg and all Windows and Android icons.

## 2.0.5 (site v119) — landing screen

- Workspace cards show a real preview of the workspace's top page: cards, shapes, text, checkboxes, images, tables, handwriting and connectors, drawn small in the current theme. The preview is rendered once when you leave the workspace (or switch to another) and stored with the workspace, so nothing renders while you work. A workspace edited since its last snapshot, or viewed in the other theme, is redrawn the next time the landing screen shows it; never-opened workspaces get their first preview lazily on the landing screen.
- Two buttons join the theme toggle at the top right of the landing screen: Full screen (the same behaviour as F11 and the menu entry; the icon turns into inward-pointing arrows while full screen is on, and hides the system bars in the apps) and About, help and shortcuts (opens the help dialog).

## 2.0.6 (site v120) - what the full feature verification found

Every feature was driven end to end in a real browser, area by area. Twelve defects were confirmed and fixed; three reported items turned out to be intended behaviour and were left alone (with the wording corrected where it disagreed).

- A refresh inside a workspace kept the default dotted paper instead of the one you chose. It now restores the saved paper.
- The workspace list ignored use: opening or editing a workspace never moved its card. Workspaces are now ordered by when you last used them, and the switcher in the logo menu matches.
- Export dropped the paper choice, so an exported and re-imported workspace came back on dots. The paper now travels with the file.
- Cancelling the workspace properties dialog left the paper you were previewing on screen. Cancel, Escape and a click on the backdrop all put the saved one back.
- Tab dropped a sibling card on top of the one you were on. It now lands beside it.
- Ctrl+Shift+] and Ctrl+Shift+[ (bring to front, send to back) never fired, because a shifted bracket arrives as a brace. Both work now.
- The context menu offered "Open inside" on checkboxes, handwriting and tables, which have nothing inside. Only cards and lists offer it now.
- Copy look then paste look ignored what it landed on: a text's look turned a list card into a canvas card and resized checkboxes. A look now only paints what the target understands, and across different kinds only the colour travels.
- The checkbox panel could not be closed with Escape.
- Editing a table cell or its title in place was not undoable. Each inline edit is now one undo step, and Ctrl+V inside a cell pastes into the cell instead of making a new text block.
- Closing a panel left the keyboard focus inside it, so the next shortcut was swallowed. Panels release the focus when they close.
- Attachments added in the same second could list in any order; they now sort stably.
- The card editor gained Reset and Done, like every other editor.

Left as designed: the checkbox has no corner grip (tap ticks it, hold it to size and colour) - the Add menu's tip now says so; a fresh install still starts with one empty workspace.

### Measured in the deep drawing pass (headless Edge, dpr 2, 480 strokes)

Each of the four pen styles wrote 120 lines, 13,080 samples per style.

| What | Result |
| --- | --- |
| Per-sample work, 95th percentile | 0.1 ms, every style |
| Samples kept vs sent | 13,080 of 13,080, none dropped or doubled |
| Cost of the last 20 lines vs the first 20 | unchanged |
| Ink spread beyond the nib | 0.0 px |
| Lasso over 352 strokes | 29 ms to close, 0.2 ms per move |
| Dragging 352 strokes as one | 0.2 ms per move |
| Undo of that move | 210 ms, every stroke back in place |
| Heap after 480 strokes | 16 MB |

## 2.0.7 (site v121) - Ink Plane stage 2, first half

Stage 2 is about the costs that grow with how much is on the page. Measured on a page holding 2200 objects (600 cards, 1600 strokes, 200 connectors).

| What | Before | After |
| --- | --- | --- |
| One zoom step | 76 ms | 0.6 ms |
| Commit of one stroke | 79 ms | 57 ms |
| Opening the level | 289 ms | 289 ms, with 4400 fewer database queries |
| Redrawing 200 connectors | 0.1 ms | 0.1 ms, and no longer one page layout per connector |
| Drawing, panning, dragging | already flat | unchanged (0.1 ms per event) |

What changed:

- **A block's chrome is mounted only when you need it.** The edit buttons and the rotate, resize and edge handles are added to a block when you pick it up (or, with a mouse, hover it) and removed when you leave it. They carry the counter-scale that keeps them the same size at any zoom, so every one of them used to be restyled on every zoom step. This is the 76 ms to 0.6 ms above. While nothing is picked up, the counter-scale is not even written.
- **Block sizes come from a ResizeObserver.** Reading an element's size right after moving it forces the browser to lay out the whole page. The selection bar, the selection frame, the connectors, the lasso and the mini-map now read a cache the browser fills after layout instead.
- **Connectors are drawn in one write.** The old loop measured a block, appended a line, measured the next block, and so on, which made the browser lay the page out once per connector.
- **Every change goes through one write queue**, committed as a single database transaction per frame instead of one transaction per record. Reads see queued writes, so nothing else changes; Ctrl+S, autosave, undo ordering and the tests wait on the queue as before.
- **Opening a level is one query.** It used to ask the database twice per block (children and files) in a transaction each. It now counts them in one transaction without reading the records, and only list cards fetch their preview items.
- The database moves to version 4, adding workspace-and-parent indexes. Existing data upgrades in place on first open.

Still to come in stage 2: the database moves into a worker, and the autosave payload is built off the input thread.
