# Stage 1 — 2.0.0 "Pen first": implementation spec

Ships to website (`?v=114`, `sw.js` CACHE `notes-gallery-v114`), Windows 2.0.0 and Android 2.0.0 (bump `tauri.conf.json` and `Cargo.toml`). Committed ink stays DOM (`paintInkNode` untouched). New code is classic scripts on `globalThis.NG` (converted to ES modules in stage 4). Line numbers refer to `Interface/js/app.js` at v113.

## A. Files

Create:
- `Interface/js/ink/sampler.js` — `NG.StrokeSampler`.
- `Interface/js/ink/wet.js` — `NG.WetLayer`.
- `Interface/js/ink/lift.js` — `NG.Lift` (multi-selection drag/scale container).
- `Interface/js/diag.js` — `NG.Diag` (overlay + metrics + trace recorder).
- `Interface/js/ngapi.js` — `window.__ng`.
- `Interface/js/ink/overlay.js` — `NG.Overlay` (dashed outlines for > 12 selected on `canvas#ink-ui`).
- Scratchpad: `intaketest.ps1`, `livetest2.ps1`, `drag300test.ps1`, `lasso1000test.ps1`, `ngtest.js` (shim), plus ported copies of the 15 coupled scripts.

Modify:
- `index.html`: add `<canvas id="ink-ui" class="ink-ui" hidden></canvas>` after `#ink-live`, `<div id="diag" class="diag" hidden></div>` before `#minimap`, ⋯ menu button `<button data-act="diag">…Diagnostics <span id="diag-state" class="muted"></span></button>` after `snap`; scripts `platform, pdf, db, ink/sampler, ink/wet, ink/lift, ink/overlay, diag, ngapi, app` all `?v=114`.
- `css/styles.css`: `#stage.penning:not(.erasing) .ink-live { pointer-events: auto; }`; `.ink-ui { position:absolute; inset:0; width:100%; height:100%; z-index:4; pointer-events:none; }`; `#lift { position:absolute; left:0; top:0; will-change: transform; }`; `#world.many-sel .block.block-ink.selected .ink-svg { outline: none; }` (outline now drawn on `#ink-ui`; the `filter:none` rule stays for r10 `manySelNoGlow`); `.diag {…frosted panel, z-index 9, pointer-events:none; font: 11px var(--mono)}` `.diag button {pointer-events:auto}`.
- `js/app.js`: §B–§G below.
- `js/platform.js`: `NGShell.host = window.NGHost || null`; `NGShell.setInking(on)` → `NGHost.setInking(on)` when present.
- `Software/app/build-android.ps1`: MainActivity.kt rewrite (§H).
- `sw.js` CACHE bump.

## B. Sample intake (`js/ink/sampler.js` + app.js 4228-4255, 7991-7994, 4389-4396, 4565-4568)

```js
NG.StrokeSampler = class {
  constructor({ pointerId, pointerType, rect, view, taper, usePressure, t0, x0, y0, p0 }) // seeds sample 0 from pointerdown
  channel            // null | 'raw' | 'move'  — decided by the first move-class event (see below)
  n                  // samples kept
  x, y, t, p, k      // Float64Array columns, capacity 1024, doubling via grow()
  vel, lastT
  push(ev, parentTs) // one coalesced event; returns true if kept
  consumeEvent(e, kind /* 'raw'|'move' */) // implements the channel rule; returns number kept
  predicted          // Array<[wx, wy]> from the last pointermove (<= 6, <= 25 ms), cleared by consumePrediction()
  toPts()            // [[x,y,p,k], ...] rounded exactly as v113 (x,y 0.1; k 3 dp) — what finalizeInk receives
  stats              // {raw, coalesced, kept, minStepDropped, listMax, dtSamples: ring of Δt, latency: ring of (now - t)}
}
```
Rules in `push`: `wx,wy = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top)`; skip if `hypot(wx-lastX, wy-lastY) < 0.7/scale`; `dt = max(1, t - lastT)`; `v = dist_screen/dt`; `vel = vel==null ? v : vel*0.7 + v*0.3`; `press = usePressure ? clamp(ev.pressure || parent.pressure || 0.5, 0, 1) : 0`; `k = taper ? round3(nibFactor(vel, press, taper)) : 0`; store `round1(wx), round1(wy), press, k, t` (`nibFactor` is exposed as `NG.nibFactor` from app.js). No comparison against earlier timestamps anywhere.

`consumeEvent(e, kind)`: `if (channel == null) channel = kind; if (kind !== channel) { if (kind === 'move') readPrediction(e); return 0; }` then `list = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e]; for ev of list push(ev, e.timeStamp)`; if `kind === 'move'` also `readPrediction(e)`. `readPrediction(e)`: `list = e.getPredictedEvents ? e.getPredictedEvents() : []`; keep entries with `timeStamp - lastT <= 25`, at most 6, converted to world; only if `vel > 0.4`; else `[]`.

app.js changes: `addInkSamples(e, fromRaw)` becomes
```js
function addInkSamples(e, fromRaw) {
  if (!inking || e.pointerId !== inking.pointerId) return;
  inking.lastX = e.clientX; inking.lastY = e.clientY;
  const kept = inking.sampler.consumeEvent(e, fromRaw ? 'raw' : 'move');
  if (kept || inking.sampler.predicted.length) scheduleLivePaint();
}
```
`onPointerDown` (4389): `inking = { sampler: new NG.StrokeSampler({...}), pointerId, lastX, lastY, style, color, width, rect: r, paintRAF: 0, dirty: false, ws, level, taper: st0.taper || 0 }`; `inking.pts` is replaced by a getter `get pts() { return this.sampler.toPts(); }` only where read at pointer-up (4788: `const pts = stroke.sampler.toPts()`); `redrawInkStroke`/paint use the sampler directly. The rawupdate listener (7993) stays on `window` (Chromium only creates raw events when a handler exists). The r10 expectations hold: section A (60 raws, then one pointermove carrying the same 60 as coalesced) → channel `'raw'`, move ignored → 61 points; section B (moves only) → channel `'move'` → 61 points.

## C. Live layer (`js/ink/wet.js` + app.js 4125-4213, 4782-4790, 5235-5253)

Canvas lifecycle: `sizeInkSurface()` uses `inkDpr = window.devicePixelRatio || 1` (adaptive: `NG.Diag` may set `NG.wet.dprCap = 2` after wet raster p95 > 4 ms for 2 s; re-size then). Context created once `{desynchronized:true, alpha:true}`; never `getImageData` on it (tests read through `__ng.readLivePixels`, which redraws pending strokes into a scratch canvas). `beginInkStroke` no longer touches `mixBlendMode` or clears the whole surface.

```js
NG.WetLayer = {
  attach(canvas, getView, getDpr),
  pending: [],            // [{sampler|pts, style, color, width, path: Path2D|null, bounds: worldRect, opacity, cap, dash}]
  begin(stroke),          // push as active
  D(),                    // {S: scale*dpr, Tx: round(tx*dpr), Ty: round(ty*dpr)}
  dirtyRectFor(stroke),   // §C.1
  paint(stroke),          // §C.2  (counts livePaints, livePaintsSync)
  repaintAll(),           // view/resize: clear all, redraw every pending stroke (rare O(n))
  finish(stroke, encodedPts), // final paint from decoded record points, stroke stays pending
  release(stroke),        // clear stroke.bounds ∪ lastPredBox (clipped), redraw other pending strokes intersecting it
  clearAll()
}
```
C.1 `dirtyRectFor(s)`: `pts = s.sampler.toPts()`; tail = ribbon style ? last 8 points of `taperCentreline(pts, s.width)` : last 3 raw points ∪ raw points appended since the last paint; `r = bbox(tail) ∪ s.lastPredBox`; pad `s.width + 2` world; to device via `D`; expand 2 px; `floor/ceil`; clamp to the canvas; store `s.lastPredBox = bbox(predicted tail incl. its last two real points) padded` for next time (null if none).

C.2 `paint(s)`:
```js
const d = dirtyRectFor(s); const ctx = liveCtx; const D = this.D();
ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.beginPath(); ctx.rect(d.x, d.y, d.w, d.h); ctx.clip(); ctx.clearRect(d.x, d.y, d.w, d.h);
ctx.setTransform(D.S, 0, 0, D.S, D.Tx, D.Ty);
for (const p of pending) if (intersects(deviceRect(p.bounds), d)) drawWhole(ctx, p);   // active stroke included, start order
if (s.sampler.predicted.length) drawTail(ctx, s);
ctx.restore();
```
`drawWhole(ctx, p)`: `path = p.path || (p.path = pathFor(p))` where for the active stroke `pathFor` rebuilds `new Path2D(inkStrokeD(pts, style, width))` (ribbon and pencil: whole rebuild each paint, ≈ 0.1 ms at 1500 pts; pen/highlighter: keep `p.prefix` Path2D of `M + Q…` segments up to index n−2, extend by one `quadraticCurveTo` per new point, then `path = new Path2D(p.prefix); path.lineTo(last)`); pending (finished) strokes cache their `path` permanently. Style exactly as `paintLiveStroke` v113: `globalAlpha = st.opacity`, fill for `taper > 0`, else `strokeStyle/lineWidth/lineCap = st.cap/lineJoin='round'/setLineDash(grain ? [w*1.1, w*0.55] : [])`. `drawTail`: same style, path `inkStrokeD([last2 real].concat(predicted as [x,y,lastP,lastK]))`, drawn after the whole path.

Scheduling (unchanged policy, 4196-4205): `scheduleLivePaint()` → if no `paintRAF`: `paint()` synchronously (count `livePaintsSync`), then one rAF that paints once if `dirty`; else set `dirty`. `applyView` (443) and `resize` call `repaintAll()` when `pending.length`.

Hand-off (4782-4790): on pointer-up, `const stroke = inking; inking = null; NG.WetLayer.finish(stroke, encoded)` where `encoded` = the `rel` points `finalizeInk` will store, decoded back to world (`ox + q[0]`, …) so the last wet frame equals the committed geometry; then `finalizeInk(pts, stroke)` appends the element synchronously; then `afterNextPaint(() => NG.WetLayer.release(stroke))` with `afterNextPaint = fn => requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = fn; ch.port2.postMessage(0); })`. Shape-snapped strokes and dropped strokes call `release` immediately. `dropLiveStroke`/`dropLiveGestures`/`goHome` call `clearAll()`.

Pen-down target: nothing in JS — the CSS rule `#stage.penning:not(.erasing) .ink-live { pointer-events:auto }` makes the canvas the hit target; `onPointerDown` already resolves `e.target.closest('.block')` to null and enters the pen branch. `setPenMode`/`setEraser` call `NGShell.setInking && NGShell.setInking(state.penMode || state.penEraser)`.

## D. Large-selection movement (`js/ink/lift.js` + app.js 4459-4470, 4666-4695, 4837-4867, 4720-4735, 1904-1946)

```js
NG.Lift = {
  active: null,  // {el: div#lift, items: [{id, el, next /* original nextSibling */}], dx, dy, ratio, ox, oy}
  begin(ids, mode /* 'move'|'scale' */),   // reparent elements (in DOM order) into div#lift appended to #world;
                                          // #lift.style.zIndex = max(z of items, ink ? 500 : 0)
  move(dxWorld, dyWorld),                 // lift.style.transform = `translate(${dx}px, ${dy}px)`
  scale(ox, oy, ratio),                   // transform = `translate(ox,oy) scale(ratio) translate(-ox,-oy)`
  end(commit)                              // for each item: restore into #world before its original next sibling
                                          // (chained if next was lifted); when commit: left/top already set by the caller; remove #lift
}
```
Drag (4459-4470 / 4666-4695): when `dragging.ids.length >= 2` call `NG.Lift.begin(dragging.ids, 'move')` at drag start. Per move: compute `adj` as today (`alignAdjust` returns `{0,0}` for ink-only; for mixed selections its `blockBox` reads are clean because no layout is dirtied per move), update `bb.x/bb.y` in data for every id (cheap), **skip** `el.style.left/top` writes when lifted, `NG.Lift.move(dx/s + adj.dx, dy/s + adj.dy)`; frame/bar from `dragging.frame0 + delta` (already the case); `drawEdges()` only if `touchesEdge` (edges read `blockRectOf` → `offsetWidth`, clean layout). On drop (4837-4867): write final `left/top` for lifted items, `NG.Lift.end(true)`, then the existing record/save path. `abandonPointer` (4720-4735) and the long-press cancel: revert `bb.x/bb.y` and `NG.Lift.end(false)`. `applyRecsToView` keeps working (replaced elements land inside `#lift`; `items[i].el` is refreshed from `state.els` at `end`).

Scale grip (1904-1946): `beginSelScale` → `NG.Lift.begin(ids, 'scale')` when `ids.length >= 2`; per frame compute `ratio` as today but apply only `NG.Lift.scale(box.x*s+tx, box.y*s+ty, ratio)` (screen space, about the frame's top-left) and the frame rectangle; `endSelScale` applies the per-kind data scaling once (existing `applySelScale` body), repaints elements, `NG.Lift.end(true)`, records one undo entry. Single-item selections keep the v113 per-frame path (r2 pressure/width assertions unchanged either way because the final numbers are identical).

Selection cost: `applySelectionClasses` (1994) keeps `prevSel` and toggles only ids in the symmetric difference; `selectionWorldBox` (1833) and `positionSelBar` (1800) use `inkBox(b) = {x: b.x, y: b.y, w: (b.w||1) + 2*inkPad(b), h: (b.h||1) + 2*inkPad(b)}` for ink and measure only non-ink elements; `selectInsideLasso` (3681) uses `inkBox` centres for ink. `NG.Overlay.draw()` on `#ink-ui`: when `sel.size > 12` and the selection has ink, draw one dashed rounded rect per selected ink `inkBox` (1 px, accent 55 %, offset 2, radius 3, screen constant) transformed by `D`; redrawn on selection change and in `applyView`; canvas hidden otherwise.

Minimap (5847-5895): split into `renderMinimapContent()` (existing per-block loop into an offscreen canvas at 2× the minimap size over content bounds, scheduled 250 ms after `markChanged`/level load/selection-independent model changes) and `drawMinimap()` (per frame: mapping from bounds ∪ viewport, one `drawImage` of the content bitmap, viewport rectangle). `worldBounds` cached with the bitmap.

## E. Autosave interim (7049-7060, 6946-6954)
`markChanged`: debounce = `(state.penMode || state.penEraser) ? 2500 : 900` ms; `autosaveTick` additionally waits while `performance.now() - lastPointerUpAt < 1500`. `saveWorkspaceNow` records `payloadMs` and `writeMs` into `NG.Diag.metrics.save`.

## F. Diagnostics (`js/diag.js`)
`NG.Diag = { enabled, toggle(on), metrics, tick() /* 4 Hz */, record(seconds), traces() }`. Sources: sampler stats (samples/s over a 1 s window, coalesced p50/max, Δt median, `now - timeStamp` p50/p95, predicted used), wet counters (paints/frame, dirty px, JS ms p95 via `performance.now()` around `paint`), rAF cadence (Hz, gaps > 1.5× median), `PerformanceObserver({type:'long-animation-frame', buffered:true})` (count, worst `blockingDuration`, top `scripts[0].sourceURL/functionName`), `getContextAttributes().desynchronized` ("requested"), tier (`isSecureContext`, `'onpointerrawupdate' in window`, `getCoalescedEvents`/`getPredictedEvents` presence), active channel, dpr, UA `wv`/`Chrome/NNN`, `matchMedia('(prefers-reduced-motion: reduce)')`, lift state, save ms/bytes, `NGHost.info()` (unbuffered switch, refresh rate) when present. Buttons: Record 10 s (raw `{x,y,t,p,tiltX,tiltY,channel,listLen}` per sample → IDB `meta` key `trace:<iso>`; `__ng.traces()` returns them), Unbuffered on/off (`NGHost.setUnbuffered`), Predicted tail on/off, Close. Toggles: ⋯ menu `data-act="diag"`, Ctrl+Shift+D in `bindKeys`, cmdk "Diagnostics", `location.search` includes `diag=1`. Persist `ng-diag` in localStorage.

## G. `window.__ng` (`js/ngapi.js`, attached where `window.__ngShape` is set, app.js:4074)
Implement: `version`, `state()`, `blocks(filter)`, `block(id)`, `inks()`, `selection()`, `selectionMode()`, `worldToScreen/screenToWorld`, `inkBounds(id)` (= `inkBox`), `inkScreenRect(id)`, `blockScreenRect(id)`, `hitTest(cx, cy)` (stage 1: `elementFromPoint(...).closest('.block')?.dataset.id ?? null`), `selectionBox()`, `strokePathD(id)` (`inkStrokeD` of the record's padded points), `strokeStyle(id)` (`{filled, opacity, cap, dash, color, width}`), `renderStroke(id, ctx, D)`, `liveCanvas()`, `live()`, `readLivePixels(x,y,w,h)` (redraw pending strokes into a scratch canvas of the same size and `getImageData`), `readInkPixels(x,y,w,h)` (draw every ink record on the level through `renderStroke` at the current `D` into a scratch canvas, then `getImageData`), `tiles()` (`[]`), `enable/disable/reset`, `counters()` (`livePaints, livePaintsSync, samples{raw, coalesced, kept, minStepDropped}, layoutsForced (via a PerformanceObserver on 'layout-shift' is not usable — expose 0 and let the harness read CDP LayoutCount), lifts`), `on(event, fn)` for `stroke:begin|commit|drop`, `flush()` = `afterInkWrites(() => Promise.resolve())` then two rAFs, `saved(ws)` (IDB read of blocks for ws), `injectSamples(pointerId, samples, {channel})` (builds `PointerEvent`s with `coalescedEvents`/`predictedEvents` inits and dispatches on `window` as `pointerrawupdate` or `pointermove`), `recordSamples(on)`, `traces()`, `diag(on)`. All return clones; `inks()` returns `state.blocks.filter(kind==='ink')` in paint order.

## H. Android host (`build-android.ps1` MainActivity.kt heredoc)
Add imports `android.view.MotionEvent`, `android.webkit.WebView`, `android.webkit.JavascriptInterface`, `android.content.Context`. Add to `MainActivity`:
```kotlin
private val prefs by lazy { getSharedPreferences("ng", Context.MODE_PRIVATE) }
private var unbuffered = true
private var web: WebView? = null
override fun onWebViewCreate(webView: WebView) {
  web = webView; unbuffered = prefs.getBoolean("unbuffered", true)
  webView.setOnTouchListener { v, e ->
    if (unbuffered && e.actionMasked == MotionEvent.ACTION_DOWN && e.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS) {
      v.requestUnbufferedDispatch(e); v.parent?.requestDisallowInterceptTouchEvent(true) }
    false }
  webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
  WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG || DIAG_BUILD)
  webView.addJavascriptInterface(NgHost(), "NGHost")
}
inner class NgHost {
  @JavascriptInterface fun setUnbuffered(on: Boolean) { unbuffered = on; prefs.edit().putBoolean("unbuffered", on).apply() }
  @JavascriptInterface fun setInking(on: Boolean) { runOnUiThread { window.attributes = window.attributes.apply { preferredRefreshRate = if (on) 120f else 0f } } }
  @JavascriptInterface fun info(): String = "{\"unbuffered\":$unbuffered,\"refresh\":${display?.refreshRate ?: 0f},\"sdk\":${android.os.Build.VERSION.SDK_INT}}"
}
```
`DIAG_BUILD` = `const val` injected by a `-Diag` switch in `build-android.ps1` (default false). `onWebViewCreate` exists on wry's `WryActivity` (which `TauriActivity` extends); the patch check `-match 'onWebViewCreate'` is added next to the `enableEdgeToEdge` check.

## I. Test list and acceptance numbers (existing harness unless marked tablet)
1. Ported 15 coupled scripts (r10, r6, r5, r4, r3, r2, r2b, audit, verifytest, matchtest, perfbench, shape2, drawtest, pentest, tooltest, fix3) via `ngtest.js`: suite green with only the known-false keys (`r3 inkMovedOnPan`, `verifytest shapeSnapStillWorks`, `pdftest hasDest`); no EXC; bodies report PARTIAL on failure.
2. r10 A/B: `ptsRawPlusReplay` and `ptsMoveOnly` in 55..62; r10 B re-expressed: `__ng.counters().livePaintsSync <= 1 && livePaints <= 2` for 40 raw samples in one task then one frame.
3. `intaketest`: (a) 20 raws then a pointermove whose coalesced list carries 20 *new* points with older timestamps → 41 kept (channel raw ignores the move: the new points are not real in a raw browser; asserts no crash and `channel==='raw'`); (b) moves only, 6 events × 8 coalesced with equal timestamps → 49 kept; (c) `injectSamples` 240 Hz fast loop, 12 px spacing, channel move → kept ≥ 95 % of unique inputs, max consecutive gap ≤ 1.2 × spacing; (d) pressure and k preserved (`pts[i].length === 4` for brush); (e) `counters().samples.minStepDropped` is the only drop counter (> 0 only for sub-0.7 px inputs).
4. `livetest2`: for each of pen/brush/pencil/highlighter at dpr 1, 2, 2.5 (Emulation override): pointerdown + 3 raw samples → `readLivePixels` over the stroke box has > 0 alpha before the next rAF resolves; 50 random strokes → 50/50 previewed; a pointermove with `predictedEvents` 30 px ahead → alpha ahead of the last sample after the trailing paint, and gone after the next real sample's paint; after pointer-up, live ∪ committed coverage ≥ pre-commit live on the commit frame and the live region is clear two frames later; `getContextAttributes().desynchronized === true` logged.
5. perfbench P1/P1b: `raster_flush_ms_at_sample` ≤ 1.0 ms at 148/748/1448 (dpr 1) and ≤ 2.0 ms (dpr 2.5), with the 1448 value ≤ 1.5 × the 148 value; `move_1400_1500` p95 ≤ 0.6 ms; `frame_gaps_during_stroke` p95 ≤ 17 ms.
6. `drag300test`: seed 2000 strokes, lasso 300 (Select tool), 60 moves with rAF between: per-move handler median ≤ 2 ms, p95 ≤ 4 ms; CDP `LayoutCount` Δ ≤ 1 over the 60 moves; frame-gap p95 ≤ 20 ms; after drop all 300 IDB `x/y` moved by the delta and `history.past` grew by exactly 1; `#lift` absent after drop; DOM order of `.block` children identical to before the drag.
7. `lasso1000test`: lasso enclosing 1000 strokes: `lasso_up_select_ms` ≤ 16 ms; `LayoutCount` Δ ≤ 2; `#world.many-sel` set; `#ink-ui` visible with outlines; `getComputedStyle(.block-ink.selected).filter === 'none'`.
8. perfbench P8 (2206 blocks): `minimap_draw_ms_during_pan` median ≤ 0.5 ms; `zoom_in_forced_style_layout_flush_ms` unchanged or better (fixed in stage 2).
9. r9 `highlighterLive`, r6 `*_exact`, matchtest `*_matches`, verifytest all pass unchanged (same `inkStrokeD`, same style attributes).
10. Eraser regression guard: pen-panel stroke eraser (`#stage.penning.erasing`) still removes a stroke tapped at its rect centre (r4 `strokeEraserRemoves`), finger long-press on a card while the eraser is up opens `#ctxmenu` (new key `menuWhileErasing`).
11. Android build: `build-android.ps1 -Diag` and default both succeed; APK contains `onWebViewCreate` (patch check).
Tablet only (overlay readings, recorded as a checklist in the release notes): pen samples/s ≥ 200 and Δt median ≈ 4.2 ms with unbuffered on vs ≈ 8.3 ms off; coalesced p50 = 1; input latency p95 ≤ 20 ms; 50 fast loops without straight chords or ribbon blobs (visual); preview visible for 50/50 strokes in Chrome and in the app; finger scrolling unaffected; Power-saving mode reports 60 Hz; `isSecureContext === true` and tier `raw` in the app; a 10 s scribble records ≤ 1 LoAF.

## J. Order of work
1. `ngapi.js` + `ngtest.js` shim + port the 15 scripts against v113 (green-to-green). 2. `diag.js`. 3. `sampler.js` + app.js intake changes + `intaketest`. 4. `wet.js` + CSS pointer-events + hand-off + `livetest2`; re-run perfbench P1. 5. `lift.js`, data-derived boxes, diff toggling, `overlay.js`, minimap cache + `drag300test`/`lasso1000test`. 6. Autosave interim. 7. MainActivity + platform.js `NGHost`. 8. Version bumps, full suite, tablet checklist, ship all three.