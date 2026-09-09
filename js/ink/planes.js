/* Notes Gallery 2.1 — NG.Planes: committed handwriting is painted onto two
   canvases instead of one SVG element per stroke.

   Why. Measured on a page of 2000 strokes (headless Edge, dpr 2): a pan runs
   at 33 ms a frame with the strokes painted and 16.7 ms with the very same
   elements present but not painted. Layout, style and script barely move -
   the whole difference is the browser rastering thousands of vector paths as
   the page slides. A canvas plane pays that cost once per tile and then
   blits, so a pan costs about thirty five image copies whatever the page
   holds.

   How. The visible area is covered by 512 px device tiles keyed by the exact
   device scale, so panning at one zoom re-uses every tile it has already
   drawn and only fills the ones coming into view. A zoom changes the key:
   the frame is filled from the nearest scale it has (a moment of softness)
   and the crisp tiles are rendered a few per frame behind it.

   What is NOT painted here. A stroke that is selected, lifted for a drag or
   being scaled goes back to its DOM element for as long as that lasts, so
   the selection glow, the lift container and the scale grip keep working
   exactly as they did; the planes leave a hole where it is. The element is
   invisible (not absent) the rest of the time, so hit-testing, the eraser,
   export and every other reader of the DOM are unchanged.

   Paint order. Strokes sit above the page by default (z = INK_Z). Anything
   sent behind the page (a smaller z) is drawn on the under-plane below
   #world; everything else on the over-plane above it. Two planes cannot
   interleave a stroke between two cards - a deliberate limit, noted in the
   architecture document.                                                   */
(() => {
  const NG = (globalThis.NG = globalThis.NG || {});
  const TILE = 512;               // device px
  const CAP = 240;                // cached tiles before the oldest go
  const BUDGET = 8;               // fresh tiles rendered per frame

  function boxesOverlap(a, b) {
    return !(a.x > b.x + b.w || a.y > b.y + b.h || a.x + a.w < b.x || a.y + a.h < b.y);
  }

  // Where a stroke really lands. The record's own box is what the page laid
  // out, and a stroke can paint outside it (the nib is wider than the
  // centreline, and an older record's points need not sit inside its box).
  // A tile that only trusted the record would clip the stroke away, so the
  // bounds are taken from the points themselves, once per record.
  const boundsCache = new WeakMap();
  function strokeBounds(bag, b) {
    let r = boundsCache.get(b);
    if (r) return r;
    const pts = bag.inkWorldPts(b);
    if (!pts.length) { r = bag.inkBox(b); boundsCache.set(b, r); return r; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    const m = (b.width || 3) * 2 + 4;            // the nib, plus room for a taper
    r = { x: x0 - m, y: y0 - m, w: (x1 - x0) + 2 * m, h: (y1 - y0) + 2 * m };
    boundsCache.set(b, r);
    return r;
  }

  const Planes = {
    enabled: false,
    over: null, under: null, octx: null, uctx: null,
    bag: null,
    strokes: [],                  // paint order, over-plane and under-plane split at draw time
    excluded: new Set(),          // ids the DOM is drawing right now (selected / lifted)
    tiles: new Map(),             // key -> {cv, S, i, j, plane, at}
    dirty: true,                  // the whole surface needs a repaint
    pendingFill: false,
    stats: { tileRenders: 0, blits: 0, lastDrawMs: 0, stale: 0 },

    init(bag, over, under) {
      this.bag = bag; this.over = over; this.under = under;
      this.octx = over.getContext('2d'); this.uctx = under.getContext('2d');
      this.enabled = true;
      return this;
    },

    /* ---- what to paint ------------------------------------------------- */
    // Called whenever the set of strokes on the level changes.
    setStrokes(list) {
      this.strokes = list.slice().sort((a, b) => ((a.z || 0) - (b.z || 0)) || ((a.createdAt || 0) - (b.createdAt || 0)));
      this.clearTiles();
    },
    // Called when one stroke changed: only the tiles it touches are dropped.
    invalidate(box) {
      if (!box) { this.clearTiles(); return; }
      for (const [key, t] of this.tiles) {
        const wx = t.i * TILE / t.S, wy = t.j * TILE / t.S, ws = TILE / t.S;
        if (boxesOverlap(box, { x: wx, y: wy, w: ws, h: ws })) this.tiles.delete(key);
      }
      this.dirty = true;
    },
    clearTiles() { this.tiles.clear(); this.dirty = true; },
    // The DOM is showing these ids (selection, a live drag): leave them out.
    setExcluded(ids) {
      const next = new Set(ids || []);
      if (next.size === this.excluded.size) {
        let same = true;
        for (const id of next) if (!this.excluded.has(id)) { same = false; break; }
        if (same) return false;
      }
      // every tile that held one of the ids entering or leaving the set
      const changed = [];
      for (const id of next) if (!this.excluded.has(id)) changed.push(id);
      for (const id of this.excluded) if (!next.has(id)) changed.push(id);
      this.excluded = next;
      const byId = new Map(this.strokes.map(s => [s.id, s]));
      for (const id of changed) {
        const s = byId.get(id);
        if (s) this.invalidate(strokeBounds(this.bag, s)); else this.clearTiles();
      }
      return true;
    },

    /* ---- painting ------------------------------------------------------ */
    size(rect, dpr) {
      const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
      for (const cv of [this.over, this.under]) {
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; this.dirty = true; }
        cv.style.width = rect.width + 'px'; cv.style.height = rect.height + 'px';
      }
    },

    renderTile(plane, S, i, j) {
      const wx = i * TILE / S, wy = j * TILE / S, ws = TILE / S;
      const box = { x: wx, y: wy, w: ws, h: ws };
      const bag = this.bag;
      // what falls in this tile, before making a canvas for it
      const here = [];
      for (const b of this.strokes) {
        if (this.excluded.has(b.id)) continue;
        const under = (b.z || bag.INK_Z) < bag.INK_Z;   // z 0 means "above the page" for ink, as the DOM had it
        if ((plane === 'under') !== under) continue;
        if (boxesOverlap(strokeBounds(bag, b), box)) here.push(b);
      }
      this.stats.tileRenders++;
      if (!here.length) return null;             // an empty tile costs nothing to keep
      const cv = document.createElement('canvas');
      cv.width = TILE; cv.height = TILE;
      const ctx = cv.getContext('2d');
      const D = { S, Tx: -i * TILE, Ty: -j * TILE };
      for (const b of here) {
        NG.renderStroke(ctx, {
          pts: bag.inkWorldPts(b), style: b.style, color: b.color || '#fff', width: b.width || 3,
        }, D);
      }
      return cv;
    },

    // The nearest cached tile at another scale covering this world rect, so a
    // zoom shows something immediately instead of a hole.
    staleBlit(ctx, plane, S, i, j, dx, dy) {
      const wx = i * TILE / S, wy = j * TILE / S, ws = TILE / S;
      for (const t of this.tiles.values()) {
        if (t.plane !== plane || t.S === S || !t.cv) continue;
        const tx = t.i * TILE / t.S, ty = t.j * TILE / t.S, tw = TILE / t.S;
        if (wx < tx || wy < ty || wx + ws > tx + tw || wy + ws > ty + tw) continue;
        const k = S / t.S;                       // how much bigger we are drawing it
        const sx = (wx - tx) * t.S, sy = (wy - ty) * t.S, sw = ws * t.S, sh = ws * t.S;
        ctx.drawImage(t.cv, sx, sy, sw, sh, dx, dy, TILE, TILE);
        this.stats.stale++;
        return true;
      }
      return false;
    },

    draw() {
      if (!this.enabled || !this.bag) return;
      const t0 = performance.now();
      const bag = this.bag;
      const view = bag.state.view;
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      this.size(bag.stageRect(), dpr);
      const S = (view.scale || 1) * dpr;
      const sKey = S.toFixed(4);
      const W = this.over.width, H = this.over.height;
      const ox = view.tx * dpr, oy = view.ty * dpr;
      this.octx.clearRect(0, 0, W, H);
      this.uctx.clearRect(0, 0, W, H);
      const i0 = Math.floor(-ox / TILE), i1 = Math.floor((W - ox) / TILE);
      const j0 = Math.floor(-oy / TILE), j1 = Math.floor((H - oy) / TILE);
      let budget = BUDGET, missing = false;
      const bagI = bag.INK_Z;
      const hasUnder = this.strokes.some(b => (b.z || bagI) < bagI);
      const planes = hasUnder ? [['under', this.uctx], ['over', this.octx]] : [['over', this.octx]];
      for (const [plane, ctx] of planes) {
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const key = plane + '|' + sKey + '|' + i + '|' + j;
            const dx = i * TILE + ox, dy = j * TILE + oy;
            let t = this.tiles.get(key);
            if (!t && budget > 0) {
              t = { cv: this.renderTile(plane, S, i, j), S, i, j, plane, at: performance.now() };
              this.tiles.set(key, t);
              budget--;
            }
            if (t) { t.at = performance.now(); if (t.cv) { ctx.drawImage(t.cv, dx, dy); this.stats.blits++; } }
            else { this.staleBlit(ctx, plane, S, i, j, dx, dy); missing = true; }
          }
        }
      }
      // keep the cache bounded: the least recently blitted go first
      if (this.tiles.size > CAP) {
        const all = [...this.tiles.entries()].sort((a, b) => a[1].at - b[1].at);
        for (let k = 0; k < all.length - CAP; k++) this.tiles.delete(all[k][0]);
      }
      this.dirty = false;
      this.stats.lastDrawMs = performance.now() - t0;
      // fill what the budget could not, on the next frames
      if (missing && !this.pendingFill) {
        this.pendingFill = true;
        requestAnimationFrame(() => { this.pendingFill = false; this.draw(); });
      }
    },

    clear() {
      if (!this.over) return;
      this.octx.clearRect(0, 0, this.over.width, this.over.height);
      this.uctx.clearRect(0, 0, this.under.width, this.under.height);
      this.strokes = []; this.clearTiles();
    },
  };

  NG.Planes = Planes;
})();
