/* Notes Gallery 2.0 — NG.Overlay: selection decorations on canvas#ink-ui.

   Stage 1 draws one thing: when more than 12 blocks are selected and the
   selection contains handwriting, a dashed rounded outline round every
   selected ink block. Hundreds of CSS outlines (and before them, hundreds
   of blurred drop-shadows) were what made a lasso over a paragraph slow;
   one canvas path with one stroke is O(1) style work for the DOM.

   API:

   NG.Overlay.attach(canvas, bag)
     canvas  the #ink-ui element (position:absolute; inset:0 inside #stage,
             CSS-sized; starts `hidden`).
     bag     NG.bag: {state: {blocks, selectedIds:Set, view:{scale,tx,ty},
             els}, inkBox(b) -> {x,y,w,h} in world units, liveDpr() -> dpr}.
             Optional: falls back to NG.bag, or waits for NG.attachApi.
     The backing store is sized to the stage's clientWidth/Height * dpr
     on demand (checked inside draw(), so a resize or a dpr change is
     picked up by the next draw); a ResizeObserver repaints when the stage
     changes size while outlines are showing.

   NG.Overlay.draw()
     Re-reads the selection from bag.state. If selectedIds.size > 12 and at
     least one selected block is ink: for each selected ink block b, a
     dashed rounded rect round bag.inkBox(b) — 1 css px line, accent colour
     at 55 % alpha, 2 css px outside the box, radius 3 css px — all sizes
     constant on screen, the geometry mapped by D = {S: scale*dpr,
     Tx: round(tx*dpr), Ty: round(ty*dpr)}. Otherwise the canvas is cleared
     and hidden. Call it whenever the selection changes (end of
     applySelectionClasses) and after every view change (end of applyView).
     Resets the lift offset to 0 because block data already carries the
     moved positions once a drag has been applied to it.

   NG.Overlay.setLiftOffset(dxWorld, dyWorld)
     Repaints the outlines from the last draw() shifted by (dx, dy) world
     units, without touching block data or the DOM: the cheap per-move call
     for a lifted drag. No-op while nothing is showing.

   NG.Overlay.clear()   clears and hides the canvas, forgets the cached rects.
   NG.Overlay.resize()  re-measures the stage and repaints if showing.

   Cost: draw() with 1000 selected strokes is one pass over state.blocks,
   1000 roundRect calls into one Path2D and one stroke (well under 1 ms of
   main-thread time; rasterisation happens off-thread). Classic script on
   globalThis.NG; loaded after ng.js and before app.js.                    */
(() => {
  const NG = (globalThis.NG = globalThis.NG || {});

  const OUTLINE_MIN = 12;     // more than this many selected -> outlines instead of per-block glow
  const LINE = 1;             // css px
  const OFFSET = 2;           // css px outside the box (CSS outline-offset equivalent)
  const RADIUS = 3;           // css px
  const DASH = [4, 3];        // css px
  const ALPHA = 0.55;

  let canvas = null, ctx = null, bag = null, ro = null;
  let cssW = 0, cssH = 0, dpr = 1;
  let showing = false;
  // the last draw's geometry, kept so a lifted drag can translate without
  // re-reading the model: device-space Path2D plus the D it was built with
  let path = null, pathS = 1, pathDpr = 1;
  let accent = '', accentKey = null;

  // The accent is a theme token; a theme flip rewrites data-theme on <html>,
  // so that attribute is the cache key. Reading the computed value per draw
  // would force a style flush right after applySelectionClasses dirtied 1000
  // .selected toggles, which is exactly the work we are trying not to do.
  function accentColor() {
    const root = document.documentElement;
    const key = root.getAttribute('data-theme') || '';
    if (accent && key === accentKey) return accent;
    let v = '';
    try { v = getComputedStyle(root).getPropertyValue('--accent').trim(); } catch (_) {}
    accent = v || '#2b7fff';
    accentKey = key;
    return accent;
  }

  function liveDpr() {
    let d = 0;
    if (bag && typeof bag.liveDpr === 'function') { try { d = +bag.liveDpr(); } catch (_) {} }
    if (!(d > 0)) d = (globalThis.devicePixelRatio || 1);
    return d;
  }

  function measure() {
    // the canvas itself is display:none while hidden, so its own client box
    // reads 0: the stage it covers (inset:0) is the reliable size
    // the app caches the stage rect per frame; a direct read would force
    // layout right after a selection restyled hundreds of elements
    const bag = NG.bag;
    if (bag && bag.stageRect) { const r = bag.stageRect(); cssW = r.width; cssH = r.height; return; }
    const host = canvas.parentElement || canvas;
    cssW = host.clientWidth; cssH = host.clientHeight;
  }

  // Backing store = css size * dpr, integers, never CSS-scaled. Assigning
  // width/height resets the context state, so the stroke style is set per
  // paint rather than once.
  function ensureSize() {
    dpr = liveDpr();
    // with a ResizeObserver the css size is pushed to us; without one (or
    // before the first observation) it is read here — layout is clean at
    // every call site, so the read costs nothing extra
    if (!ro || !cssW || !cssH) measure();
    const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
  }

  // The store changed size while outlines were showing: the cached path is
  // still valid device geometry for the same view, so repaint it rather
  // than re-read the model.
  function fit() {
    if (!showing) return;
    const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width === W && canvas.height === H) return;
    canvas.width = W; canvas.height = H;
    paint(0, 0);
  }

  // Pixel snapping: a line lw device px wide is crisp when its centre sits
  // at k + lw/2 for integer k (half-integers at dpr 1, integers at dpr 2).
  const snap = (v, lw) => Math.round(v - lw / 2) + lw / 2;

  function addRect(p, box, S, Tx, Ty, d) {
    const lw = LINE * d, out = (OFFSET + LINE / 2) * d;   // stroke centre 2.5 css px outside the box
    const x0 = snap(box.x * S + Tx - out, lw), y0 = snap(box.y * S + Ty - out, lw);
    const x1 = snap((box.x + box.w) * S + Tx + out, lw), y1 = snap((box.y + box.h) * S + Ty + out, lw);
    const w = x1 - x0, h = y1 - y0;
    if (p.roundRect) { p.roundRect(x0, y0, w, h, RADIUS * d); return; }
    // fallback for engines without Path2D.roundRect
    let r = RADIUS * d; const m = Math.min(w, h) / 2; if (r > m) r = m;
    p.moveTo(x0 + r, y0);
    p.arcTo(x1, y0, x1, y1, r); p.arcTo(x1, y1, x0, y1, r);
    p.arcTo(x0, y1, x0, y0, r); p.arcTo(x0, y0, x1, y0, r);
    p.closePath();
  }

  function paint(dxDev, dyDev) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!path) return;
    const d = pathDpr;
    ctx.lineWidth = LINE * d;
    ctx.setLineDash([DASH[0] * d, DASH[1] * d]);
    ctx.strokeStyle = accentColor();
    ctx.globalAlpha = ALPHA;
    ctx.translate(dxDev, dyDev);
    ctx.stroke(path);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function hide() {
    path = null;
    if (!showing) return;
    showing = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.hidden = true;
  }

  function draw() {
    if (!ctx || !bag || !bag.state) return;
    const st = bag.state;
    const sel = st.selectedIds;
    if (!sel || sel.size <= OUTLINE_MIN || !st.blocks) { hide(); return; }

    ensureSize();
    const view = st.view || { scale: 1, tx: 0, ty: 0 };
    const S = (view.scale || 1) * dpr, Tx = Math.round((view.tx || 0) * dpr), Ty = Math.round((view.ty || 0) * dpr);
    // Walk the (usually much smaller) selection instead of every block on the
    // level - an id->block map is instant either way, but a page can have
    // orders of magnitude more blocks than are ever selected at once.
    const byId = st.byId;
    const p = new Path2D();
    let n = 0;
    for (const id of sel) {
      const b = byId ? byId.get(id) : null;
      if (!b || b.kind !== 'ink') continue;
      addRect(p, bag.inkBox(b), S, Tx, Ty, dpr);
      n++;
    }
    if (!n) { hide(); return; }
    path = p; pathS = S; pathDpr = dpr;
    if (!showing) { showing = true; canvas.hidden = false; }
    paint(0, 0);
  }

  function setLiftOffset(dxWorld, dyWorld) {
    if (!ctx || !showing || !path) return;
    // integer device delta: the outlines stay as crisp as the first paint
    paint(Math.round(dxWorld * pathS), Math.round(dyWorld * pathS));
  }

  function clear() {
    if (!ctx) return;
    hide();
  }

  function resize() {
    if (!ctx) return;
    measure();
    fit();
  }

  function attach(cv, b) {
    canvas = cv;
    ctx = cv.getContext('2d');
    if (b) bag = b;
    else NG.onAttach && NG.onAttach((got) => { bag = got; });
    measure();
    if (ro) { ro.disconnect(); ro = null; }
    if (typeof ResizeObserver !== 'undefined' && cv.parentElement) {
      ro = new ResizeObserver((entries) => {
        const r = entries[0] && entries[0].contentRect;
        if (r) { cssW = r.width; cssH = r.height; }
        fit();
      });
      ro.observe(cv.parentElement);
    }
  }

  NG.Overlay = { attach, draw, setLiftOffset, clear, resize };
})();
