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

   Finding what belongs in a tile. A page with thousands of strokes on it
   cannot afford to ask "does this stroke touch this tile?" of every stroke,
   for every tile, every time one letter is added - that cost grows with the
   whole page, so writing gets slower the more you have already written. A
   fixed-size world-space grid (independent of zoom) remembers which strokes
   live in which patch of the page, kept up to date as strokes are added,
   edited or removed; a tile only ever asks its own handful of nearby cells.
   One new letter touches its own cell and nothing else.

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
  const GRID = 256;                // world units per spatial-index cell

  function boxesOverlap(a, b) {
    return !(a.x > b.x + b.w || a.y > b.y + b.h || a.x + a.w < b.x || a.y + a.h < b.y);
  }
  // Which grid cells a world-space box touches.
  function cellRange(box) {
    return {
      x0: Math.floor(box.x / GRID), y0: Math.floor(box.y / GRID),
      x1: Math.floor((box.x + box.w) / GRID), y1: Math.floor((box.y + box.h) / GRID),
    };
  }

  // Where a stroke really lands. The record's own box is what the page laid
  // out, and a stroke can paint outside it (the nib is wider than the
  // centreline, and an older record's points need not sit inside its box).
  // A tile that only trusted the record would clip the stroke away, so the
  // bounds are taken from the points themselves, once per record.
  // The cache has to notice a rewritten stroke: a partial erase replaces the
  // points of the same record, and a bounds box remembered from before would
  // keep the old geometry alive in the tiles.
  const boundsCache = new WeakMap();
  function strokeBounds(bag, b) {
    const stamp = (b.pts ? b.pts.length : 0) + '|' + (b.updatedAt || 0) + '|' + (b.width || 0);
    let r = boundsCache.get(b);
    if (r && r.stamp === stamp && r.pts === b.pts) return r.box;
    const pts = bag.inkWorldPts(b);
    const keep = (box) => { boundsCache.set(b, { stamp, pts: b.pts, box }); return box; };
    if (!pts.length) return keep(bag.inkBox(b));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    const m = (b.width || 3) * 2 + 4;            // the nib, plus room for a taper
    return keep({ x: x0 - m, y: y0 - m, w: (x1 - x0) + 2 * m, h: (y1 - y0) + 2 * m });
  }
  const unionBox = (a, b) => {
    if (!a) return b; if (!b) return a;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };

  // Below the page first, then oldest first: the order the DOM painted in.
  // Only ever applied to one tile's small handful of candidates, never the
  // whole page - see renderTile.
  const paintOrder = (a, b) => ((a.z || 0) - (b.z || 0)) || ((a.createdAt || 0) - (b.createdAt || 0));

  const Planes = {
    enabled: false,
    over: null, under: null, octx: null, uctx: null,
    bag: null,
    byId: new Map(),               // stroke id -> the record: O(1) add/update/remove, no list to scan
    grid: new Map(),                // "cx,cy" world cell -> Set(strokeId) - the "memory" of who lives where
    cellsOf: new Map(),             // stroke id -> the cell keys it is currently registered under
    underCount: 0,                  // how many strokes sit behind the page, kept incrementally
    excluded: new Set(),          // ids the DOM is drawing right now (selected / lifted)
    tiles: new Map(),             // key -> {cv, S, i, j, plane, at}
    seen: new Map(),              // stroke id -> the box it was last painted into
    renderS: 0,                   // the device scale the cached tiles are drawn at
    dirty: true,                  // the whole surface needs a repaint
    pendingFill: false,
    stats: { tileRenders: 0, blits: 0, lastDrawMs: 0, stale: 0 },

    // A read-only view for diagnostics and tests: every stroke, as a plain
    // array. Nothing on the paint path reads this - it always goes through
    // byId and the grid, so building this list costs nothing while drawing.
    get strokes() { return [...this.byId.values()]; },

    init(bag, over, under) {
      this.bag = bag; this.over = over; this.under = under;
      this.octx = over.getContext('2d'); this.uctx = under.getContext('2d');
      this.enabled = true;
      return this;
    },

    /* ---- what to paint ------------------------------------------------- */
    _isUnder(b) { return (b.z || this.bag.INK_Z) < this.bag.INK_Z; },

    // Register a stroke at the grid cells its current bounds touch, replacing
    // wherever it was registered before. The one place that keeps `seen` (its
    // last-known paint box) and the grid in lock step.
    _place(b) {
      const box = strokeBounds(this.bag, b);
      const old = this.cellsOf.get(b.id);
      if (old) for (const k of old) { const s = this.grid.get(k); if (s) { s.delete(b.id); if (!s.size) this.grid.delete(k); } }
      const { x0, y0, x1, y1 } = cellRange(box);
      const cells = [];
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) cells.push(cx + ',' + cy);
      this.cellsOf.set(b.id, cells);
      for (const k of cells) { let s = this.grid.get(k); if (!s) { s = new Set(); this.grid.set(k, s); } s.add(b.id); }
      this.seen.set(b.id, box);
      return box;
    },
    _unplace(id) {
      const cells = this.cellsOf.get(id);
      if (cells) for (const k of cells) { const s = this.grid.get(k); if (s) { s.delete(id); if (!s.size) this.grid.delete(k); } }
      this.cellsOf.delete(id); this.seen.delete(id);
    },

    // Called whenever the set of strokes on the level changes (a level is
    // opened, or navigated to). The one place a full pass over every stroke
    // is expected - after this, one stroke changing only ever touches its
    // own cells.
    setStrokes(list) {
      this.byId.clear(); this.grid.clear(); this.cellsOf.clear(); this.seen.clear();
      this.underCount = 0;
      for (const b of list) {
        this.byId.set(b.id, b);
        if (this._isUnder(b)) this.underCount++;
        this._place(b);
      }
      this.clearTiles();
    },
    // A stroke just committed. Only the tiles under it are dropped - clearing
    // the whole surface for every stroke is what made writing flicker, and
    // finding those tiles costs only what this one stroke touches, not the
    // rest of the page.
    addStroke(b) {
      if (!b) return;
      this.byId.set(b.id, b);
      if (this._isUnder(b)) this.underCount++;
      const box = this._place(b);
      this.invalidate(box);
    },
    // A stroke was rewritten (rubbed out in part, recoloured, moved). Both
    // where it was and where it is now have to be repainted.
    updateStroke(b) {
      if (!b) return;
      const prev = this.byId.get(b.id);
      const wasUnder = prev ? this._isUnder(prev) : false;
      const was = this.seen.get(b.id);
      this.byId.set(b.id, b);
      const nowUnder = this._isUnder(b);
      if (wasUnder !== nowUnder) this.underCount += nowUnder ? 1 : -1;
      const now = this._place(b);
      this.invalidate(unionBox(was, now));
    },
    // A stroke is gone. It must leave the index as well as the page, or the
    // next tile that gets rendered paints it straight back.
    removeStroke(id) {
      if (id == null) return;
      const prev = this.byId.get(id);
      if (prev && this._isUnder(prev)) this.underCount--;
      const was = this.seen.get(id);
      this.byId.delete(id);
      this._unplace(id);
      this.excluded.delete(id);
      if (was) this.invalidate(was); else this.clearTiles();
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
    clearTiles() { this.tiles.clear(); this.renderS = 0; this.dirty = true; },
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
      for (const id of changed) {
        const s = this.byId.get(id);
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

    // Everything the grid knows about that could fall in this tile: only the
    // cells the tile's world box overlaps, never the whole document.
    renderTile(plane, S, i, j) {
      const wx = i * TILE / S, wy = j * TILE / S, ws = TILE / S;
      const box = { x: wx, y: wy, w: ws, h: ws };
      const bag = this.bag;
      const { x0, y0, x1, y1 } = cellRange(box);
      const already = new Set();
      const here = [];
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const cell = this.grid.get(cx + ',' + cy);
          if (!cell) continue;
          for (const id of cell) {
            if (already.has(id) || this.excluded.has(id)) continue;
            already.add(id);
            const b = this.byId.get(id); if (!b) continue;
            const under = (b.z || bag.INK_Z) < bag.INK_Z;   // z 0 means "above the page" for ink, as the DOM had it
            if ((plane === 'under') !== under) continue;
            const sb = this.seen.get(id) || strokeBounds(bag, b);
            if (boxesOverlap(sb, box)) here.push(b);
          }
        }
      }
      this.stats.tileRenders++;
      if (!here.length) return null;             // an empty tile costs nothing to keep
      here.sort(paintOrder);                      // this tile's own handful, never the whole page
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

    // Fill a tile we have not rendered yet from the tiles we do have, at
    // whatever scale they were drawn - each overlapping piece, scaled into
    // place. Partial cover is the point: a zoom used to leave a hole unless
    // one older tile happened to contain the whole of the new one.
    staleBlit(ctx, plane, TS, i, j, dx, dy, size) {
      const wx = i * TILE / TS, wy = j * TILE / TS, ws = TILE / TS;
      let drew = false;
      for (const t of this.tiles.values()) {
        if (t.plane !== plane || t.S === TS || !t.cv) continue;
        const tx = t.i * TILE / t.S, ty = t.j * TILE / t.S, tw = TILE / t.S;
        const ix0 = Math.max(wx, tx), iy0 = Math.max(wy, ty);
        const ix1 = Math.min(wx + ws, tx + tw), iy1 = Math.min(wy + ws, ty + tw);
        if (ix1 <= ix0 || iy1 <= iy0) continue;
        const sx = (ix0 - tx) * t.S, sy = (iy0 - ty) * t.S;
        const sw = (ix1 - ix0) * t.S, sh = (iy1 - iy0) * t.S;
        const k = size / TILE * TS;              // world -> on-screen device px
        ctx.drawImage(t.cv, sx, sy, sw, sh,
                      dx + (ix0 - wx) * k, dy + (iy0 - wy) * k, (ix1 - ix0) * k, (iy1 - iy0) * k);
        this.stats.stale++;
        drew = true;
      }
      return drew;
    },

    // `live` means a zoom is being driven right now (a pinch, a wheel). Every
    // in-between scale is a different tile key, so rendering for it is work
    // that is thrown away a frame later - and the holes while it happens are
    // what read as blinking. While live we blit the tiles we already have,
    // scaled, and render the crisp set when the view settles.
    draw(live) {
      if (!this.enabled || !this.bag) return;
      const t0 = performance.now();
      const bag = this.bag;
      const view = bag.state.view;
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      this.size(bag.stageRect(), dpr);
      const S = (view.scale || 1) * dpr;
      const reuse = !!live && this.renderS > 0 && this.tiles.size > 0;
      const TS = reuse ? this.renderS : S;       // the scale the tiles are drawn at
      if (!reuse) this.renderS = S;
      const sKey = TS.toFixed(4);
      const k = S / TS;                          // how the tiles are blitted
      const step = TILE * k;                     // one tile's size on screen
      const W = this.over.width, H = this.over.height;
      const ox = view.tx * dpr, oy = view.ty * dpr;
      this.octx.imageSmoothingEnabled = this.uctx.imageSmoothingEnabled = true;
      this.octx.imageSmoothingQuality = this.uctx.imageSmoothingQuality = 'high';
      this.octx.clearRect(0, 0, W, H);
      this.uctx.clearRect(0, 0, W, H);
      const i0 = Math.floor(-ox / step), i1 = Math.floor((W - ox) / step);
      const j0 = Math.floor(-oy / step), j1 = Math.floor((H - oy) / step);
      let budget = reuse ? 0 : BUDGET, missing = false;
      const hasUnder = this.underCount > 0;
      const planes = hasUnder ? [['under', this.uctx], ['over', this.octx]] : [['over', this.octx]];
      for (const [plane, ctx] of planes) {
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const key = plane + '|' + sKey + '|' + i + '|' + j;
            const dx = i * step + ox, dy = j * step + oy;
            let t = this.tiles.get(key);
            if (!t && budget > 0) {
              t = { cv: this.renderTile(plane, TS, i, j), S: TS, i, j, plane, at: performance.now() };
              this.tiles.set(key, t);
              budget--;
            }
            if (t) {
              t.at = performance.now();
              if (t.cv) {
                if (k === 1) ctx.drawImage(t.cv, dx, dy);
                else ctx.drawImage(t.cv, 0, 0, TILE, TILE, dx, dy, step, step);
                this.stats.blits++;
              }
            }
            else { this.staleBlit(ctx, plane, TS, i, j, dx, dy, step); missing = true; }
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
      // fill what the budget could not, on the next frames (and, after a zoom
      // gesture, render the crisp set for the scale it landed on)
      if ((missing || reuse) && !this.pendingFill) {
        this.pendingFill = true;
        requestAnimationFrame(() => { this.pendingFill = false; if (!this.livePending) this.draw(); });
      }
    },

    clear() {
      if (!this.over) return;
      this.octx.clearRect(0, 0, this.over.width, this.over.height);
      this.uctx.clearRect(0, 0, this.under.width, this.under.height);
      this.byId.clear(); this.grid.clear(); this.cellsOf.clear(); this.seen.clear();
      this.underCount = 0;
      this.clearTiles();
    },
  };

  NG.Planes = Planes;
})();
