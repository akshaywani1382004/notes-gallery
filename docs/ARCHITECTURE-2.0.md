# Notes Gallery 2.0 — Architecture ("Ink Plane", final)

Status: decided 2026-09-08. Supersedes the three proposals (Flat Canvas, Ink Plane, Glass & Tiles) and the three judgements. Paths: app `G:/Other computers/My Computer/LAT_WorkSpace/Notes/Interface` (quote it), shells `.../Notes/Software/app`, suite in the scratchpad (`suite.sh`, `*test.ps1`, `perfbench.ps1`).

## 1. Decision

**Base: Ink Plane (hybrid).** Only handwriting leaves the DOM. Committed strokes become data rendered into device-pixel tiles on two plane canvases around an unchanged `#world`; the wet stroke is painted on the existing desynchronized `#ink-live`; selection, lasso, eraser and drag work on point data; storage moves to batched transactions and an O(delta) journal. Everything else — every block kind and its editor, connectors, panels, keys, menus, CSS, IndexedDB `blocknotes` stores and record shapes, `.notesgallery.json` v2, NGShell, the build scripts — stays as in 1.5.3.

Why not the others: Flat Canvas re-implements cards/text/tables/markdown on Canvas 2D (unbounded parity work with no complaint behind it); Glass & Tiles' WebGL stage is a look-parity and WebView-behaviour gamble whose stage 2 is this design anyway. Both are kept as options behind the backend interface (§6.4), not as the plan.

Hard requirements kept: feature parity (§12), file compatibility (§8), three platforms (§11), vanilla JS authored as ES modules with a zero-dependency bundle (§3), exact-preview invariant (§6.3), exact undo (§9), testability via `window.__ng` (§10), staged shipping (§13).

### 1.1 Root causes → answers

| Complaint | Established mechanism | 2.0 answer |
|---|---|---|
| (1) latency, preview sometimes missing | whole-stroke `clearRect` + `Path2D` repaint of a 4.1 Mpx desync canvas per paint (7.5 ms raster at 1450 pts, dpr 2.5); canvas `display:none` until penning and never the pointer-down target (no low-latency scheduling); a desync canvas cleared then repainted can be scanned out cleared (Chrome/Android single-buffer); autosave stringify + IPC of the whole workspace landing between words | live canvas shown and hit-testable whenever the pen tool is on (pen-down lands on it → Chromium stops rAF-aligning moves); clipped dirty-rect repaints bounded by the tail window (never a full clear); predicted tail; autosave deferred while the pen tool is active, later moved off-thread |
| (2) skipped points on fast curves, brush "spreads" | Android WebView never requests unbuffered dispatch, so Android batches pen samples per vsync and Chromium converts only the newest (1 of 2–3 samples lost before JS); the app's cross-channel `t <= lastT` de-dup can also drop legitimate samples; sparse samples make the ribbon's window normals cross at corners (self-intersecting fill = blob) | `requestUnbufferedDispatch` for stylus in `MainActivity.onWebViewCreate` (what Chrome does); one geometry channel per stroke, no timestamp de-dup; prediction; diagnostics prove samples/s on the device |
| (3) lag moving many strokes, lasso artefacts | per move `style.left/top` on N elements + layout; `getBoundingClientRect` per selected element for frame/bar; class toggles on every element of the level; per-stroke drop-shadow surfaces; WebView tile-memory pressure from thousands of SVGs in one transformed layer | stage 1: lift container (one transform per move), frames from data, diff-based class toggling, overlay-drawn outlines; stage 3: no DOM per stroke, float bitmap drag, overlay canvas |

Note (correcting the brief): `PEN_STYLES.blend` is `''` for every style (app.js:225-229), so `inkCv.style.mixBlendMode` was always empty and never forced a render surface. Removing the assignment is cleanup, not a fix. Also `taperCentreline` (app.js:305-309) drops the stored nib factor `p[3]`, so `taperWidths` always uses the geometric fallback `nibFactor(span/12, pressure, taper)`; live and committed agree because both call `inkTaperD`. 2.0 keeps that behaviour exactly (changing it would alter every existing stroke) and keeps writing `k` into records for format stability.

## 2. Components

```
pointer events → input/router (channel ladder, gesture arbiter) → input/sampler (typed buffers, prediction)
                                                                 → tools: pen / eraser / lasso / drag / gizmo (data queries via InkModel)
InkModel (strokes, paint order, planes, SpatialIndex, selection) ← Store (records) ↔ engine worker (IDB v4, journal, file chunks)
        │ change events (ids, old/new boxes)                           ▲ deltas / acks
TileCache (dirty queue, LRU) → Backend (2d | later gl): renderStroke / renderTile / composite / readPixels
LayerStack: #ink-under (z0) | #world (z1, DOM) | #ink-over (z2) | #ink-ui (z4) | #ink-live (z6) | DOM chrome (z7+)
history.js: before/after record sets (unchanged) → Store.apply → InkModel / DOM renderers refresh touched ids
```

Single source of truth: the records. Tiles, index, DOM elements, glow bitmaps are derived and rebuildable.

## 3. Module layout

Authored as ES modules (`import`/`export`, no default exports, static imports only). `tools/bundle.mjs` (~100 lines, no dependencies) topologically concatenates them into `js/app.bundle.js` and `js/engine.worker.bundle.js` (classic scripts) so `file://` double-click, `?v=N` cache-busting and the `sw.js` CACHE rule keep working; dev serves modules directly; the suite runs against the bundle. Stage 1 lands its new files as classic scripts registering on `globalThis.NG` (shared by page and worker — never `window`) and stage 4 converts everything; the file names below are the final ones.

```
Interface/
  index.html                same ids; stage children gain canvas#ink-under, canvas#ink-over, canvas#ink-ui, div#lift, div#diag
  sw.js                     CACHE = notes-gallery-vN (lists the bundles)
  tools/bundle.mjs          module → classic bundle
  js/main.js                boot: capability probe, backend choice, wiring, registerSW() (stripped by app builds)
  js/app/                   the 1.5.3 IIFE split by concern, behaviour unchanged: state, view, gestures, tools, selection,
                            blocks/{card,text,shape,image,table,check}, edges, panels/*, menus, keys, cmdk, home, present,
                            outline, search, minimap, toast, exports/{svg,png}
  js/ink/
    styles.js               PEN_STYLES, PEN_ORDER, styleWidth, nibFactor, taperWidths, taperCentreline, inkPathD, inkTaperD,
                            inkStrokeD — verbatim from 1.5.3, golden-tested
    codec.js                inkPad, inkWorldPts, encodeStroke (finalizeInk / inkFromWorldPts arithmetic), hitBox, paintBox
    sampler.js              StrokeSampler (channel decision, typed buffers, velocity/nib, prediction reader, recorder)
    router.js               listeners, GestureArbiter (palm/finger/second-pointer/long-press rules verbatim)
    spatial.js              SpatialIndex (SoA Float32 AABB arrays + id table; linear scan; grid option if > 50k)
    model.js                InkModel (strokes, seq order, planes, index, selection queries)
    wet.js                  WetLayer (#ink-live paint policy, dirty tail window, prediction, commit hand-off)
    tiles.js                TileCache + scheduler (worker or main-thread fallback), PlaneCanvas x2, commit-first queue
    backend-2d.js           renderStroke / renderTile / composite / readPixels with Canvas 2D (the legacy-exact look)
    overlay.js              #ink-ui: glow (<=12), dashed outlines (>12), float bitmap, lock badge
    hit.js                  hitTest, lassoHits, eraseSweep/eraseStrokeAt/eraseInsideLasso on data
    shapes.js               $1 recogniser, window.__ngShape (unchanged)
    tile-worker.js          mirror of InkModel + index, OffscreenCanvas raster, ImageBitmap transfer
  js/store/
    db.js                   IDB blocknotes v4, WriteQueue (one tx per frame), key-only counts
    engine-worker.js        IDB owner, journal, cached export chunks, import parsing
    history.js              unchanged semantics
    autosave.js             scheduler, pill states, journal + idle full save
    format.js               .notesgallery.json v2 reader/writer (+ additive fields)
  js/platform.js            NGShell (same surface) + NGHost bridge (Android JavascriptInterface, §11)
  js/pdf.js                 unchanged API
  js/diag.js                diagnostics overlay
  js/ngapi.js               window.__ng
Software/app/build-android.ps1   MainActivity.kt gains onWebViewCreate (§5.4)
```

## 4. Data structures

**Stroke record (persisted, byte-compatible):** `{id, ws, parentId, kind:'ink', title:'', color, width (world units = slider px / view.scale at write), style, pts:[[dx,dy]|[dx,dy,p]|[dx,dy,p,k]], w, h, x, y, z:500, group, locked?, createdAt, updatedAt}`; `pts` relative to `(x + width + 2, y + width + 2)` at 0.05, pressure 2 dp, `k` 3 dp — encoded only by `codec.encodeStroke`. The width-shift quirk (points relative to `x + width + 2`) is preserved (byte compatibility; fixing it is a separate decision, §12).

**In-memory Stroke:** `{rec, wpts: Float32Array(4n) (world x,y,p,k), hitBox (= element box: x, y, (w||1)+2pad, (h||1)+2pad with pad = width+2), paintBox (= hitBox), seq, z, plane:0|1, path2d cache per S, glow cache}`.

**Paint order:** `(z ?? 0)` ascending, ties by `seq` = position in `state.blocks` at load (IDB index order) with new blocks appended — the exact stacking 1.5.3 produces both in-session and after reload. No createdAt tie-break (deliberately not the Glass/Ink-Plane deviation). `stepZ`/`reorderZ` maths unchanged.

**SpatialIndex:** SoA `minX/minY/maxX/maxY: Float32Array`, `ids[]`, `Map<id,slot>`, free list. `query(rect)`, `hitAt(x,y)` (top-most by paint order). 10k boxes ≈ 50 µs per query; a 512-unit grid can be added behind the same API if a level exceeds ~50k blocks.

**Tiles:** tile space = world × S, `S = view.scale × dpr` (exact float, not a bucket — required so wet and committed pixels share phase), `T = 512` device px, key `plane|S6|i|j` with `S6 = S.toPrecision(6)`. `Tile {key, bitmap: ImageBitmap|null, version, epoch, lastUsed}`. Cap 96 tiles (64 when `deviceMemory <= 4`), LRU with `bitmap.close()`. Previous-S tiles kept as `stale` until the visible set at the new S has landed. Visible set at dpr 2 on 1600×2560 = 30 tiles; prefetch ring of 1 → 56.

**Device transform (every frame, all layers):** `D = {S, Tx: round(tx·dpr), Ty: round(ty·dpr)}`; `#world` uses `translate(Tx/dpr px, Ty/dpr px) scale(scale)`; canvases map `dx = x·S + Tx`. Tiles blit at integer offsets `(i·T + Tx, j·T + Ty)`.

**Planes:** `plane(stroke) = 1 (over)` unless some DOM block on the level with `rect ∩ hitBox ≠ ∅` has a higher paint key → `0 (under)`. Recomputed for strokes touched by a DOM move/resize/z change. `#ink-under` is `display:none` when empty (the usual case). Accepted deviation: a stroke strictly between two overlapping DOM blocks renders under both; connectors sit above under-plane ink; both counted in `__ng.counters().planeConflicts`.

## 5. Input pipeline

### 5.1 Channel ladder (probed once, shown in diagnostics)
- **Tier raw:** `window.isSecureContext && 'onpointerrawupdate' in window` → geometry from `pointerrawupdate` iterating `getCoalescedEvents()` (fallback `[e]`); `pointermove` feeds only `getPredictedEvents()`.
- **Tier move:** `getCoalescedEvents` exists → `pointermove` + coalesced list.
- **Tier plain:** `pointermove` only.

**Per-stroke channel decision (no timestamps):** the first move-class event seen for the inking pointer decides: a `pointerrawupdate` → the stroke is `'raw'` and every later `pointermove` for it contributes prediction only; a `pointermove` first → `'move'`. Chromium and the spec guarantee the raw copy precedes its pointermove, so a real tier-raw browser always decides `'raw'`; synthetic or rawupdate-less browsers decide `'move'`. The `t <= lastT` rule is deleted. r10 sections A and B pass unchanged under this rule (61 points each).

### 5.2 Sampler (constants verbatim)
Per coalesced event, in list order: world point via the stage rect cached at pointer-down; skip if `< 0.7/scale` world from the last kept point; `dt = max(1, t − lastT)`; velocity EMA `0.7·old + 0.3·new` in screen px/ms; pressure used only for `pointerType === 'pen'` (`ev.pressure || 0.5`, clamped to [0,1] — Android may exceed 1); `k = taper ? round3(nibFactor(vel, press, taper)) : 0`; coordinates rounded to 0.1. Storage: growable `Float64Array` columns (x, y, t, p, k), initial 1024, doubling. No dt clamp beyond `max(1, ·)`, no k-delta clamp (both would change stored data). Prediction: positions from `getPredictedEvents()` (≤ 25 ms, ≤ 6 points, position-only, last real pressure), only when velocity > 0.4 px/ms, never stored.

### 5.3 Pointer-down target and low-latency scheduling
`#ink-live` is `display:block` whenever `#stage.penning` (today) **and** `pointer-events:auto` under `#stage.penning:not(.erasing)` so a pen-down lands on the desynchronized canvas and Chromium stops rAF-aligning moves until pointer-up. In eraser mode the canvas keeps `pointer-events:none` — 1.5.3 deliberately keeps blocks hit-testable while erasing (`#stage.penning:not(.erasing) #world .block {pointer-events:none}`), and `eraseStrokeAt`, finger long-press on cards and the table-cell menu depend on it. Events bubble to the existing `#stage` handlers; tests keep dispatching on `#stage`. `setPointerCapture` stays on `#stage`.

### 5.4 Android host (in the `MainActivity.kt` that `build-android.ps1` writes)
```kotlin
override fun onWebViewCreate(webView: WebView) {
  webView.setOnTouchListener { v, e ->
    if (unbuffered && e.actionMasked == MotionEvent.ACTION_DOWN && e.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS) {
      v.requestUnbufferedDispatch(e); v.parent?.requestDisallowInterceptTouchEvent(true) }
    false }
  webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
  WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG || DIAG_BUILD)
  webView.addJavascriptInterface(NgHost(), "NGHost")   // setUnbuffered(b), setInking(b), info()
}
```
`NgHost.setInking(true)` (pen or eraser tool activated) sets `window.attributes.preferredRefreshRate = 120f`, `false` restores 0 — never a static hint. `unbuffered` is a SharedPreferences kill switch toggled from the diagnostics overlay. Fingers keep Android's buffered/resampled path. No `setLayerType`, `setRenderPriority`, `enableSlowWholeDocumentDraw`. `useHttpsScheme` is **not** flipped: Chromium treats `*.localhost` as potentially trustworthy, so `http://tauri.localhost` should already be a secure context; the overlay reports `isSecureContext`, and if it is ever false the fallback is tier `move` (correct, slightly higher latency) plus a documented one-time export/import migration before any origin change.

### 5.5 Gesture arbiter (rules verbatim, made explicit)
`isPalm`: touch width or height > 42 px or area > 1500 → ignored. `inkAccepts`: pen always (`sawStylus`), touch only with `ng-finger-draw==='on'` (one toast per session), mouse always. While `ink|erase|lasso` is live, any pointer failing `inkAccepts` is ignored (no pan, no long-press); a second accepted pointer drops the stroke and starts a pinch; pen-down aborts a finger pan/drag/gizmo and reverts it (`abandonPointer`); `pointercancel` ends only the gesture with that `pointerId`. Long-press 500 ms / 8 px, tap < 4 px, drag ≥ 3 px, GRID 26, GUIDE_SNAP 6, zoom 0.02–64, `inkPassThrough` (unselected ink pans; tap picks the word group), tool exclusivity, Esc cascade — unchanged. State: `{kind: none|pan|pinch|ink|erase|lasso|drag|gizmo|marquee|selScale, owner: pointerId}` exposed as `__ng.state().gesture`.

## 6. Render pipeline

### 6.1 Layers inside `#stage`
| element | z | role |
|---|---|---|
| `canvas#ink-under` | 0 | committed strokes below an overlapping higher-z DOM block (usually hidden) |
| `#world` | 1 | all DOM blocks, `#edge-layer`, `.lasso-path`, `#guide-layer`, `div#lift` (transient) |
| `canvas#ink-over` | 2 | all other committed strokes (ink z 500 is above cards by default) |
| `canvas#ink-ui` | 4 | selection glow/outlines, float bitmap, lock badges, eraser ring; hidden when empty |
| `canvas#ink-live` | 6 | wet strokes; `{desynchronized:true, alpha:true}`; pointer-down target while penning |
| `#sel-frame`, `#sel-bar`, `#pen-bar`, `#minimap`, `#diag` | 7+ | DOM chrome, unchanged ids |

No transform/opacity/filter/mix-blend-mode/clip-path on any canvas or its ancestors. Backing stores are `viewport × dpr` integers, never CSS-scaled; `dpr = devicePixelRatio` (the 2.5 cap was a no-op on the DPR-2 tablet; a non-integer cap would force resampling on DPR-3 phones), adaptive: drop to 2 if wet raster p95 > 4 ms for 2 s. Paper stays CSS on `#stage` (b1test reads `stage.dataset.paper` and the background image); `#paper` becomes a compositor-only translated div in stage 2.

### 6.2 Wet layer (`wet.js`)
- **Per paint** (policy as today, pinned by r10: synchronous on the first sample batch of a frame, one trailing rAF paint for the rest, ≤ 2 per frame): `dirty = bbox(C[n−8..n−1]) ∪ bbox(raw samples since last paint) ∪ lastPredictedBox`, where `C = taperCentreline(pts, width)` for ribbon styles (the resampled centreline, `minGap = max(1.1, 0.45·width)`; appending a sample changes C from n−2, widths from n−6 after tip softening and two 1-2-1 passes, normals from n−3, side quadratics from n−7 → 8 points cover it) and the raw points for stroked styles; padded by `width + 2` world units (max nib factor 1.55 → half-width ≤ 0.78·width) then by 2 device px, rounded outward, clamped. Then on `#ink-live`: `save; rect(dirty); clip(); clearRect(dirty); setTransform(D); globalAlpha = opacity; fill/stroke(wholePath)` for every pending stroke whose bounds intersect `dirty` (in start order), then the predicted tail (last two real points + predicted, same style), `restore`.
- **Why whole path, why no accumulator, why no partial rebuild:** one `fill()`/`stroke()` of a self-overlapping path is a single coverage mask × alpha in Skia — no double-darkening — so an alpha-1 accumulator buys nothing; a partial outline rebuild is wrong for self-crossing strokes (earlier segments pass through the dirty rect). Whole path inside the clip is exact by construction: pixels outside the clip are untouched, pixels inside are re-rasterised from the complete geometry. JS cost per paint is O(n) string/Path2D work (≈ 0.1 ms at 1500 points; stroked styles keep an incrementally extended `Path2D` prefix plus the trailing `L`; pencil always uses the whole path so the dash phase matches the committed render); GPU-process edge setup stays O(n) with a small constant while pixel fill — the dominant cost today — is bounded by the dirty rect (~100–150 px square). The clear and the draw are two recorded ops in one flush; under true single-buffer scanout (Chrome for Android only) the exposure is a sub-millisecond window on a ~100 px rect instead of a whole frame on 4.1 Mpx.
- **Pending strokes:** a stroke stays on `#ink-live` after pointer-up until the committed pixels are on screen (§6.3); a new stroke may start meanwhile (an i-dot after its stem); the clipped repaint redraws every pending path intersecting `dirty`, so nothing is wiped.
- **View change mid-stroke** (wheel while penning, resize): full repaint of pending strokes at the new `D` (rare, O(n)).
- **Final frame before commit** is painted from the encoded-then-decoded record points (0.05 grid, `round`ed origin, 2-dp pressure) so the swap frame is what the committed renderer draws.

### 6.3 Commit hand-off and the exact-preview invariant
- Stage 1 (committed ink still DOM): `finalizeInk` appends the element synchronously; the wet region is cleared in `afterNextPaint` (rAF → `MessageChannel` message, i.e. after that frame's commit) so a desynchronized canvas frame can never present the clear before the DOM frame shows the stroke. For translucent styles the stroke is doubled for one frame (0.3 over 0.3) — chosen over a one-frame gap.
- Stage 3 onward: the record is rendered into its tiles first (commit-first queue, synchronous for ≤ 3 tiles), the plane canvas re-blits the stroke's rect and `#ink-live` clears that rect in the same task. Identity: one `renderStroke(ctx, stroke, D)` in `backend-2d.js` for wet, tiles, float bitmap, minimap and PNG; identical `Path2D` (same `inkStrokeD` output, including `toFixed(1)` quantisation), identical `D` up to integer device translation (tile origin `i·T`), identical colour/alpha/cap/join/dash. Verified by `wet==committed` tests (§10).

### 6.4 Tiles and the backend interface
```
renderStroke(target, stroke, D, {opacityMode:'style'|'one', dim})
renderTile(tile, strokesInOrder)          // clear + all strokes at S with origin (iT, jT)
composite(plane, {tiles, stale, float?}) → plane canvas
readPixels(rect, layers) → ImageData
```
The Canvas2D backend is the legacy-exact look and the golden reference. A WebGL backend may implement the same interface later (stage 5, optional) and ships only when parity tests pass on all three platforms. Worker protocol: level load posts records; every model delta is mirrored (2–5 KB per stroke); jobs `{key, plane, S, i, j, epoch}` → `OffscreenCanvas(T,T)` → `transferToImageBitmap()` transferred back; main installs if `epoch` is current. Fallback (no Worker/OffscreenCanvas, e.g. `file://`): the same `renderTile` on the main thread in ≤ 3 ms slices. Priority: tiles under a pending commit → visible tiles nearest the pen → prefetch ring. Invalidation from store deltas (old ∪ new `paintBox`), including undo/redo, eraser runs, moves, restyles, plane changes. Zoom: during a gesture stale tiles are drawn scaled (GPU); 120 ms after the last scale change (or at pinch end) the new S set renders centre-out, at least one tile per frame; far zoom-out LoD renders strokes with device bbox < 2 px as dots/polylines so dense tiles stay inside the budget. Honest budget: a dense 512-px tile with ~300 strokes is 10–40 ms of raster in the GPU process, not 2–4 (AA concave fills are re-tessellated per draw) — hence commit-first, at-least-one-per-frame, stale-scaled display and the worker offloading recording only; measured on the tablet in stage 3.

### 6.5 Overlay canvas (`#ink-ui`)
≤ 12 selected: glow reproducing `drop-shadow(0 0 4px accent) drop-shadow(0 0 8px accent 45%)` via `ctx.filter` (Chromium/Firefox) with a two-pass `shadowBlur` fallback (Safari), cached per stroke, translated during drag. > 12: `#world.many-sel` still toggled (tests) and one dashed rounded rect per selected `hitBox` (1 px, accent 55%, offset 2, radius 3). Float bitmap for drags: selected strokes rendered once, one `drawImage` per move at the integer device delta; vector re-render per frame for ≤ 20k selected points during the scale grip, bitmap scaling beyond (final render exact on release). Lock badge, eraser ring, `.dim` (alpha .28 + `saturate(.6)`) handled here or in tiles.

### 6.6 Minimap
Content bitmap rendered from data in content-bounds space (2× minimap resolution) at most every 250 ms after a model change; per pan/zoom frame one scaled `drawImage` plus the viewport rectangle (the mapping uses bounds ∪ viewport, so the bitmap is re-projected, not re-rendered). Sizes, toggles and pen-bar dodging unchanged.

### 6.7 DOM costs that scale with cards (stage 2)
`.block-actions` and `.tnode-*`/`.col-resize`/`.row-resize` handles are mounted only for selected (and mouse-hovered) blocks, so the `--inv` restyle on each zoom step is O(selected) instead of O(blocks) (the measured 13/36 ms zoom-step flush). `#world` already has `will-change: transform`; nothing is toggled per gesture. A `ResizeObserver` rect cache replaces `getBoundingClientRect` for DOM blocks in mixed selections; `drawEdges` keyed by edge id.

## 7. Selection, hit-testing, eraser, lasso — from data
- `hitTest(wx, wy)`: ink candidates from the index, hit = point inside `hitBox` (the element box `elementFromPoint` hit before), top-most by paint order; DOM blocks via `elementFromPoint(...).closest('.block')` only when `#ink-live` is not the hit target (it never is outside `penning:not(.erasing)`), winner by paint key. Drives tap-pick (`inkPassThrough`), `eraseStrokeAt`, long-press, link mode.
- Lasso select: `.lasso-path` SVG unchanged; on up, ink centres `(x + hitBox.w/2, y + hitBox.h/2)` even-odd inside the polygon, DOM blocks via cached rects; modes replace/add/remove, group growth, toasts unchanged. Stage 1 already computes ink centres from data (no `offsetWidth` per stroke).
- Eraser: `eraseSweep` (densify `max(2,R)`, ≤ 40/segment, drop points within `R + width/2`, runs > 1 point → `encodeStroke`), `eraseInsideLasso` (≥ 50 % of 24 samples), radius `3 + 0.35·size` screen px — moved verbatim; candidates from the index; one undo entry per gesture incl. connectors. Stroke eraser keeps box semantics (`hitBox`), matching `elementFromPoint`; a precise (distance-to-polyline) option ships off by default.
- Selection frame/bar: `selectionWorldBox()` = ink `hitBox`es from data ∪ DOM rects (cached); during gestures shifted/scaled arithmetically. Grip ratio rule and per-kind clamps verbatim. Shift-click, marquee, Ctrl+A, groups, z-order, lock, nudge, align/tidy, clipboard, format painter: pure data operations already.
- Selection classes: diff-based toggling on DOM elements (stage 1), ink selection rendered by the overlay (stage 3); `#world.many-sel` at `sel.size > 12` kept for tests.

## 8. Storage
- **IDB `blocknotes` v4** (`onupgradeneeded`, records untouched): compound indexes `blocks.byLevel [ws, parentId]`, `edges.byLevel [ws, parentId]`, `files.byWsBlock [ws, blockId]`. Root-level load becomes O(level) via `getAll(range)` in 2k batches (`getAllRecords` when present). Child/file counts and peeks computed with `index.count()` / `getAll(range, 4)` inside one readonly transaction per level — no cached stats record, so directly-seeded databases (the whole suite) and external writers stay correct. `navigator.storage.persist()` requested once.
- **WriteQueue:** every mutation enqueues `{puts, dels}`; flushed once per animation frame (or immediately when the `afterInkWrites` chain needs ordering) as one readwrite transaction across blocks/edges/files, resolved on `tx.oncomplete`, never awaiting foreign promises inside. `DB.saveBlock` becomes sugar over it; undo/redo of 500 strokes, lasso-move, paste, import become one commit each. Durability default. Records stay < 64 KiB.
- **Engine worker** owns IDB (structured clone off the input thread); the main thread keeps the in-memory records and never awaits storage; `flush()` = ack of the last sequence number.
- **Autosave** (stage 4): observable behaviour unchanged (900 ms debounce, 10 s cap, busy guard, pill grey/blue/red, Ctrl+S, relink dialog, visibility flush). Tier 1: JSONL journal line per delta within 350 ms to OPFS (`createSyncAccessHandle`; available in Chrome, WebView2 and Android WebView ≥ 114) with the IDB `meta` store as fallback. Tier 2: full `.notesgallery.json` assembled from cached per-record export strings (re-stringified only for changed records; attachments cached as base64, 32 MiB budget) — byte-identical to `JSON.stringify(payload)` (verified by a debug-build byte compare) — written at idle (≥ 2 s since the last gesture), on visibility change, workspace switch/close, Ctrl+S and the 10 s cap; never during a gesture. Web: `createWritable()` from the worker if the handle clones, else a `Blob` from the main thread. Tauri: bytes transferred to the main thread → `NGShell.writeFile(path, bytes)` (invoke is unavailable in workers). Android crash safety: the full snapshot is written to OPFS `snapshots/<ws>.json` **before** the `content://` mirror (opened "wt", not atomically replaceable); on open the newest valid of {user file, OPFS snapshot + journal} wins, the journal replays into IDB and is truncated after a successful mirror; written length verified. No new Tauri capabilities are needed for this path.
- **Format:** v2 exactly as today plus optional `workspace.paper` and edge `label/style/both` (1.5.3 readers ignore unknown keys). Import parses in the worker (id remap, data URL → Blob) with one transaction per 2k records; the in-canvas Import menu also accepts `.notesgallery.json`; `NGShell.readFile` is verified against `content://` URIs on Android.
- Stage 1 interim: while the pen or eraser tool is active the autosave debounce is 2500 ms after the last pointer-up (the 10 s deadline stays), and payload build time is reported in the overlay.

## 9. Undo/redo and ordering
`history.js` unchanged: before/after record sets, limit 200, `gen` guard, `applyDelta` = put target ∪ delete other-only, `afterInkWrites` chain. Stage 2 replaces per-record puts with one transaction per `applyDelta`; the chain awaits the worker ack of that sequence number, preserving "Undo pressed right after a stroke waits for the stroke". `applyRecsToView` keeps patching DOM blocks in place (node identity preserved — r10 `undoKeepsOtherNodes`); for ink it invalidates tiles from the delta's old/new boxes. Ink-write ordering during a lift-drag: `applyRecsToView` already re-keys `dragging.byId`; lifted elements replaced by undo land inside `#lift` and are restored on drop.

## 10. Diagnostics and the `window.__ng` API
**Overlay** (`#diag`, frosted DOM panel, ⋯ menu "Diagnostics", Ctrl+Shift+D, cmdk, `?diag=1`): input tier and per-stroke channel, `isSecureContext`, `getContextAttributes().desynchronized` (labelled "requested"), dpr, UA (`wv`, `Chrome/NNN`), reduced-motion; pen samples/s, coalesced-list p50/max, median Δt (≈ 4.2 ms unbuffered vs ≈ 8.3 ms batched), `performance.now() − timeStamp` p50/p95, predicted points used; rAF Hz, dropped frames, LoAF count and worst `blockingDuration` with script attribution; wet paints/frame, dirty px/paint, JS ms p95; lift/float state; tiles visible/ready/queued, worker RTT, cache MiB (stage 3); last delta tx ms, payload build ms, journal bytes, last full save ms/bytes; context-loss count. Buttons: record 10 s trace (raw samples to `meta` store, exportable), clear tile cache, force main-thread tiles, precise eraser, predicted tail, unbuffered dispatch (via `NGHost`).

**`window.__ng`** (shipped in stage 1 beside `window.__ngShape`, read-only snapshots): `version`, `state()` (ws, level, view, tools, gesture, tier, paper), `blocks(filter)`, `block(id)`, `inks()`, `selection()`, `selectionMode()→'glow'|'outline'`, `worldToScreen/screenToWorld`, `inkBounds(id)`, `inkScreenRect(id)`, `blockScreenRect(id)`, `hitTest(cx, cy)`, `selectionBox()`, `strokePathD(id)`, `strokeStyle(id)`, `renderStroke(id, ctx, D)`, `liveCanvas()`, `live()→{tier, channel, dpr, w, h, desyncAttr}`, `readLivePixels(x,y,w,h)`, `readInkPixels(x,y,w,h)` (stage 1: the committed SVGs rasterised through the production `inkStrokeD`; stage 3: the plane canvases), `tiles()`, `tileAt(wx,wy)`, `enable()/disable()/reset()`, `counters()→{livePaints, livePaintsSync, tileRenders, samples:{raw, coalesced, minStepDropped, kept}, layoutsForced, planeConflicts, deltaTx}`, `on(event, fn)`, `flush()` (ink-write chain + worker ack + one rAF), `saved(ws)`, `injectSamples(pointerId, samples, {channel})`, `recordSamples(on)`, `traces()`, `setBackend('2d'|'gl')`, `diag(on)`.

**Suite port** (mechanical, ~150 edits over the 15 coupled scripts): `.block-ink` counts → `__ng.inks().length`; ink rects → `inkScreenRect`; dispatch on an ink element → dispatch on `#stage` at the rect centre; svg `d`/attrs → `strokePathD/strokeStyle`; SVG rasterisation (r6, matchtest) → `readInkPixels`; `.block.selected` → `selection()`; computed filter → `selectionMode()`; r10 B paint probe → `counters().livePaintsSync <= 1 && counters().livePaints <= 2`; `wait(n)` → `await __ng.flush()`; every body wrapped in the r7-style try/catch so failures report PARTIAL, not EXC. Unchanged and still asserted directly: IDB seeding shape, `#brand/.ws-card`, toolbar/panel ids, `#stage` classes, `#world` transform + `--inv` + `.many-sel`, `#sel-frame/.sel-grip/#sel-bar`, `#ink-live` id with a readable 2D context, `#toast`, `#fatal-banner`, `#import-input/#image-input`, `URL.createObjectURL` capture, `window.NGPdf`, `window.__ngShape`. 10 of 25 scripts need no change.

**New tests:** `intake` (raw-first then coalesced pointermove ignored; move-only kept; equal timestamps kept; 6–8 coalesced per frame kept; 240 Hz curve ≥ 95 % of unique inputs kept and max gap ≤ 1.2× spacing; recorded S-Pen traces replay to identical records), `live` (first pixel within one rAF of the third sample for every style/dpr; 50 random strokes all previewed; predicted tail present then gone; commit hand-off coverage), `parity` (per style × zoom {0.5,1,2.5} × dpr {1,2}: coverage ≥ 96 %, pixel count ≤ 8 %, thickness ≤ 18 % in stage 1; ≥ 99.5 % identical pixels in stage 3), `drag300` (2000 strokes seeded, lasso 300, 60 moves: per-move median ≤ 2 ms, p95 ≤ 4 ms, CDP `LayoutCount` Δ ≤ 1, one history entry), `lasso1000` (≤ 16 ms, `LayoutCount` Δ ≤ 2), `tiles` (invalidation sets, eviction cap, no stale tile), `scale` (606/2206/10000 strokes: pan/zoom/minimap/undo growth < 1.3×), `autosave` (bytes per stroke ∝ stroke, byte-identical file, journal replay after a simulated kill), `hitparity` (dual-run data vs `elementFromPoint` while both exist), `v3→v4 upgrade`. CDP `Performance.getMetrics` deltas become pass/fail thresholds in perfbench.

## 11. Platforms
- **Web:** modules in dev, bundle in release; `sw.js` network-first unchanged; FSA handle flow unchanged plus OPFS journal; `?v` = CACHE rule.
- **Windows (WebView2):** unchanged bundle flow (`build-windows.ps1` strips `registerSW()`); pen contact is a touch event, so `touch-action:none` on `#stage` matters (already set); timestamps are processing times (the velocity EMA already damps them); Ink API trail is a stage-5 option.
- **Android (Tauri 2, system WebView):** §5.4 additions to the existing `MainActivity.kt` rewrite (immersive bars, targetSdk 35, edge-to-edge opt-out kept); `<meta name="color-scheme" content="dark light">`; `NGHost` JavascriptInterface (no Tauri plugin needed); origin unchanged.
- **Versions:** stage 1 = 2.0.0 (tauri.conf.json and Cargo.toml, web `?v=114` = sw CACHE), then 2.0.1, 2.1.0, 2.2.0, 2.3.x. Every stage ships to all three platforms in the same round.

## 12. Deliberate decisions (kept vs changed)
Kept: all interaction constants; ink record encoding and the width-shift quirk; paint order; highlighter as plain 30 % alpha; hidden `marker` style renderable; two/three-finger tap undo stays removed; `#stage` paper CSS; `.lasso-path`, `#sel-frame`, `#sel-bar`, `#guide-layer` as DOM/SVG. Changed: export/paste gain `workspace.paper` and edge `label/style/both` (additive); in-canvas Import accepts workspace files; dead code removed (`penWidth`, `add-child`, `[data-sel=paint]`, `data-align`); `meta` store reused for traces; dpr cap 2.5 → native with adaptive fallback; stroke eraser box semantics with a precise option; the DOM ink renderer selectable via `localStorage['ng-ink-renderer']='dom'` for one release after stage 3.

## 13. Staged plan

**Stage 1 — 2.0.0 "Pen first" (site v114, Windows 2.0.0, Android 2.0.0).** Scope: `js/ink/sampler.js` + channel rule (no timestamp de-dup, prediction), `js/ink/wet.js` (always-ready live canvas as pen-down target, clipped tail-window repaints, predicted tail, `afterNextPaint` hand-off), lift container for multi-selection drag and scale grip, data-derived ink boxes for frame/bar/lasso, diff-based selection classes, `#ink-ui` outlines for > 12 selected, cached minimap bitmap, autosave debounce while the pen tool is active, `MainActivity.onWebViewCreate` (+ `NGHost`), `window.__ng` + `js/diag.js`, port of the 15 coupled scripts, new `intake`/`live`/`drag300`/`lasso1000` tests. Acceptance (harness): suite green with the same known-false keys; r10 A/B 55–62 points; `counters().livePaintsSync <= 1 && livePaints <= 2` for 40 raw samples; perfbench P1 raster probes ≤ 1.0 ms at samples 150/750/1450 (dpr 1) and ≤ 2 ms (dpr 2.5), flat across the stroke; first live pixel within one rAF for all styles at dpr 1/2/2.5; `drag300` per-move median ≤ 2 ms, p95 ≤ 4 ms, `LayoutCount` Δ ≤ 1 (lift path); `lasso1000` ≤ 16 ms; minimap draw during pan ≤ 0.5 ms at 2206 blocks; `intake` keeps 100 % of Android-style batched samples; zero `.block-ink`-dependent EXC in ported scripts. Tablet only: overlay median Δt ≈ 4.2 ms and coalesced p50 = 1 with unbuffered dispatch on (vs ≈ 8.3 ms / 2–3 off); input latency p95 ≤ 20 ms; preview present for 50/50 strokes; no straight chords on a fast loop test page; finger scrolling unaffected with the pen switch on; Power-saving mode shows 60 Hz in the overlay. Risk: low–medium (unbuffered dispatch on Samsung firmware — kill switch; lift container z-stacking during drags is an accepted transient).

**Stage 2 — 2.0.1 "Model and storage" (v115).** `js/ink/{codec,styles,spatial,model,hit}.js` extracted verbatim with golden `d`-string fixtures; InkModel + SpatialIndex built alongside the DOM renderer; `hit.js` used for tap-pick, stroke eraser, lasso, sweep with dual-run assertions against `elementFromPoint`; handles/actions mounted only when selected; ResizeObserver rect cache; keyed `drawEdges`; compositor-only `#paper`; IDB v4 indexes + key-only counts + WriteQueue + engine worker owning IDB; autosave payload built off-thread from cached chunks (still one file write per save). Acceptance (harness): goldens string-equal for all styles/widths; hit-test dual-run 100 % agreement over the r3/r4/r6 scenarios; undo/redo of 500 strokes = one transaction (≤ 40 ms at 2206 blocks, was 9–23 ms median with per-record commits at smaller counts); zoom-step forced flush ≤ 3 ms at 2206 blocks (was 36); level open at 10k strokes ≤ 300 ms in the worker; v3→v4 upgrade test; importtest/savetest unchanged; zero storage-attributable main-thread tasks > 16 ms during a 10 s scribble (LoAF). Tablet only: LoAF count during scribble ≤ 1; payload build no longer visible in the overlay's main-thread ms. Risk: low–medium (worker/undo ordering — covered by r10/r11 and new ack tests).

**Stage 3 — 2.1.0 "Ink to tiles".** `tiles.js`, `tile-worker.js`, `backend-2d.js`, planes and plane assignment, `overlay.js` (glow/outline/float/lock badge), commit-first hand-off (pixel-identical swap), exact-S keys, stale-scaled zoom, LoD, `__ng.readInkPixels/tiles/renderStroke` wired to the real renderer; drag and scale via float bitmap / vector lift; minimap from the model; DOM ink renderer behind `ng-ink-renderer='dom'`. Acceptance (harness): suite green in both renderers; `parity` ≥ 99.5 % identical pixels wet vs committed and r6/matchtest via `readInkPixels`; `tiles` invalidation exactness; `scale` growth < 1.3× from 606 to 10000 strokes for pan/zoom/minimap/undo; `#world` child count independent of stroke count; drag300 `LayoutCount` Δ = 0; lasso1000 `LayoutCount` Δ ≤ 1. Tablet only: pan of a 2000-stroke page within 1.3× of a 100-stroke page (frame-gap p95); dense-tile raster ms and post-zoom time-to-crisp recorded; GPU memory under the 96-tile cap without context loss; z-ordered cards above ink render correctly on existing files. Risk: medium–high (largest change; mitigated by the stage-1 port, the renderer flag, and the 2D backend being the legacy generator).

**Stage 4 — 2.2.0 "Flat cost everywhere".** Delete `paintInkNode`/`.block-ink`; ES-module split + `tools/bundle.mjs`; OPFS JSONL journal + idle byte-identical full save + Android OPFS snapshot before the content:// mirror + journal replay; worker import; additive export fields; in-canvas Import of workspace files; `content://` read check; dead code removed. Acceptance (harness): `autosave` test (bytes after one stroke ∝ stroke; full file byte-identical to `JSON.stringify(payload)`; replay after simulated kill mid-mirror restores IDB); importtest/savetest/pdftest unchanged; suite runs against the bundle from `file://` and `http://`; total suite time ≤ 2 min with `flush()`. Tablet only: kill the app mid-save and reopen — no truncated workspace; Windows: 10–50 MB full save happens at idle with no main-thread task > 16 ms. Risk: medium (FileSystemFileHandle cloning into workers — main-thread Blob fallback; SAF providers ignoring "t" — length check).

**Stage 5 — 2.3.x "Headroom" (measurement-driven, all optional).** WebGL backend behind the interface, shipped only if parity goldens pass on WebView2, Android WebView and browsers; Windows-only Ink API trail; adaptive tile/VBO budgets by device class; precise eraser default decision; native front-buffer SurfaceView overlay for the wet stroke only if stage 3/4 tablet numbers still trail Samsung Notes. Acceptance: parity ≥ 98 % coverage / ±5 % thickness / dash phase within 0.1·w for the GL backend; camera-measured pen-to-pixel latency before/after.

## 14. Expected numbers (Galaxy Tab S9 class, dpr 2, 120 Hz → 8.3 ms/frame)
Inking frame: intake ≤ 0.15 ms (2–3 rawupdates × ≤ 50 µs), wet paint JS ≤ 0.3 ms (+ ≤ 0.1 ms at 1500 points for the O(n) path), pixel fill bounded by a ~100–150 px dirty rect (today 4.1 Mpx), 0 DOM writes, 0 storage; input→glass ≈ 1 frame + compositor with the predicted tail hiding ≤ 25 ms. Commit: encode ≤ 0.5 ms, tiles 1–4 (stage 3), one presented frame. Pan frame (stage 3): ≤ 35 tile blits + overlay ≈ 0.5 ms JS, flat in stroke count. Drag of N strokes: stage 1 one transform write per move; stage 3 one `drawImage`. Lasso 2000 strokes ≤ 2 ms. Memory (stage 3): planes 2 × 16 MB, `#ink-ui` 16 MB, `#ink-live` 16 MB, tiles ≤ 96 MB, plus Chromium's up-to-3 recycled resources per non-single-buffered canvas (worst ≈ +100 MB) — budgets halve on `deviceMemory <= 4`. Storage: one transaction per frame of edits (≈ 0.1 ms/record amortised), journal appends of a few KB, full file = memcpy of cached chunks at idle.

## 15. Open risks
1. Unbuffered stylus dispatch on Samsung firmware (jitter, S-Pen air actions) — kill switch, overlay verification across Android 13/14/15.
2. Dense-tile raster cost in the GPU process (10–40 ms per 300-stroke tile) — commit-first, stale-scaled display, LoD, at-least-one-tile-per-frame; measured in stage 3 before removing the DOM renderer.
3. Per-paint GPU-process path work remains O(stroke length) in the 2D wet path (pixel fill bounded) — acceptable per measurements; the GL backend is the escape if a 3000-point stroke ever shows growth on the tablet.
4. Two-plane compositing cannot show ink strictly between two overlapping DOM blocks — rare, logged, accepted.
5. Worker unavailability on `file://` and OffscreenCanvas absence on old Safari — main-thread fallback within a 3 ms budget.
6. WebView memory pressure with 96 tiles + four viewport canvases — device-class budgets, contextlost rebuild from data.
7. `pointerrawupdate` hidden on insecure origins (WebView 142+) — tier `move` fallback; origin never changed silently.
8. Suite port scale (15 scripts, ~470 keys) — done in stage 1 while the DOM renderer exists (green-to-green), PARTIAL pattern everywhere.
9. Byte-identical chunked autosave — debug-build byte compare after every full save.
10. The WebView will not match Chrome's or a native front-buffer surface's latency floor — set expectations; stage 5 contingency.