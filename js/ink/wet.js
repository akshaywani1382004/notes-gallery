/* Notes Gallery 2.0 — the wet (live) ink layer.

   The preview IS the result: every paint draws the in-progress stroke with
   the same path generator and style the saved SVG uses, mapped through the
   view transform. What changed since 1.x is how much of the canvas each
   paint touches. The old layer cleared and repainted the whole surface
   (4 million device pixels at dpr 2) on every paint; this one clips to a
   small dirty rectangle around the stroke's tail, clears only that, and
   redraws every pending path that crosses it. Pixels outside the clip are
   untouched, pixels inside come from the complete geometry, so the result
   is exact by construction - and the fill cost is bounded by the tail box,
   not the screen.

   A finished stroke stays "pending" on this layer until the committed
   pixels are on screen (app.js releases it after the next paint), so the
   swap never shows a gap.                                                  */
(() => {
  const NG = (globalThis.NG = globalThis.NG || {});
  const Ring = NG.Ring;

  // Draw one stroke exactly like the committed SVG would look: same path
  // string, same fill/stroke rules. Shared by the live layer, the test API
  // and (later) the tile renderer. D = {S, Tx, Ty} device transform.
  NG.renderStroke = function renderStroke(ctx, spec, D, opts) {
    const styles = NG.styles || (NG.bag && NG.bag.PEN_STYLES); const strokeD = NG.strokeD || (NG.bag && NG.bag.inkStrokeD);
    if (!styles || !strokeD) return;
    const st = styles[spec.style] || styles.pen;
    const pts = spec.pts; if (!pts || !pts.length) return;
    const path = spec.path || new Path2D(strokeD(pts, spec.style, spec.width));
    ctx.save();
    ctx.setTransform(D.S, 0, 0, D.S, D.Tx, D.Ty);
    ctx.globalAlpha = (opts && opts.opacity != null) ? opts.opacity : st.opacity;
    if (st.taper > 0) { ctx.fillStyle = spec.color; ctx.fill(path); }
    else {
      ctx.strokeStyle = spec.color; ctx.lineWidth = spec.width;
      ctx.lineCap = st.cap; ctx.lineJoin = 'round';
      ctx.setLineDash(st.grain ? [spec.width * 1.1, spec.width * 0.55] : []);
      ctx.stroke(path);
    }
    ctx.restore();
    return path;
  };

  const TAIL_RIBBON = 8;   // resampled centreline points that can still move when a sample is appended
  const TAIL_STROKED = 3;  // raw points whose quadratics change

  NG.WetLayer = class WetLayer {
    constructor() {
      this.canvas = null; this.ctx = null; this.dpr = 1; this.dprCap = 0;
      this.pending = [];                         // strokes on the glass, in start order
      this.getView = null; this.styles = null; this.strokeD = null; this.centreline = null;
      this.stats = { paintMs: new Ring(64), dirtyPx: new Ring(64), paintsThisFrame: 0 };
      this._frameToken = 0;
    }

    attach(canvas, o) {
      this.canvas = canvas; this.getView = o.getView; this.getDprCap = o.getDprCap || (() => this.dprCap);
      this.styles = o.styles; this.strokeD = o.strokeD; this.centreline = o.centreline;
      NG.styles = o.styles; NG.strokeD = o.strokeD;
      try { this.ctx = canvas.getContext('2d', { desynchronized: true, alpha: true }); }
      catch (_) { this.ctx = canvas.getContext('2d'); }
      // a lost GPU context (Android after backgrounding) is rebuilt from data
      canvas.addEventListener('contextlost', () => { this.lost = true; NG.counters.contextLost = (NG.counters.contextLost || 0) + 1; });
      canvas.addEventListener('contextrestored', () => { this.lost = false; this.size(); this.repaintAll(); });
      this.size();
    }
    get desynchronized() {
      try { return !!(this.ctx && this.ctx.getContextAttributes && this.ctx.getContextAttributes().desynchronized); } catch (_) { return false; }
    }

    // Backing store = viewport x dpr, integers; never CSS-scaled.
    size(stageRect) {
      const cv = this.canvas; if (!cv) return;
      let r = cv.getBoundingClientRect();
      if ((!r.width || !r.height) && stageRect) r = stageRect;
      if (!r.width || !r.height) return;
      const cap = this.getDprCap && this.getDprCap();
      this.dpr = Math.max(1, cap ? Math.min(window.devicePixelRatio || 1, cap) : (window.devicePixelRatio || 1));
      const w = Math.max(1, Math.round(r.width * this.dpr)), h = Math.max(1, Math.round(r.height * this.dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; this.pending.forEach(p => { p.path = null; }); }
    }

    // Device transform: world -> canvas device pixels, same mapping as #world.
    D() {
      const v = this.getView();
      return { S: (v.scale || 1) * this.dpr, Tx: v.tx * this.dpr, Ty: v.ty * this.dpr };
    }

    begin(stroke) {
      stroke.path = null; stroke.bounds = null; stroke.lastPredBox = null; stroke.paintedN = 0;
      this.pending.push(stroke);
      NG.emit('stroke:begin', { id: stroke.pointerId });
    }

    // Points to draw for a stroke: its final record points once finished,
    // else the sampler's current list (plus nothing - prediction is separate).
    pointsOf(s) { return s.finalPts || (s.sampler ? s.sampler.toPts() : s.pts); }

    // World bbox of the whole stroke padded by the nib (kept up to date so a
    // pending stroke can be intersected with a dirty rect cheaply).
    boundsOf(s) {
      const pts = this.pointsOf(s);
      let b = s.bounds;
      const from = (b && s.finalPts == null) ? s.paintedN : 0;
      if (!b || from === 0) b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (let i = Math.max(0, from - 1); i < pts.length; i++) {
        const x = pts[i][0], y = pts[i][1];
        if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x; if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
      }
      s.bounds = b; s.paintedN = pts.length;
      const pad = s.width + 2;
      return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    }

    // Everything that can change on this paint: the tail of the path (8
    // centreline points for ribbons, 3 raw points for stroked styles) plus
    // the points appended since the last paint, the previous predicted tail
    // and the new one; padded by the nib, converted to device pixels.
    dirtyRectFor(s) {
      const pts = this.pointsOf(s);
      const st = this.styles[s.style] || this.styles.pen;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const take = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
      const from = Math.max(0, Math.min(s.paintedN - 1, pts.length - 1) - (st.taper > 0 ? TAIL_RIBBON : TAIL_STROKED));
      for (let i = from; i < pts.length; i++) take(pts[i][0], pts[i][1]);
      if (st.taper > 0 && this.centreline && pts.length >= 3) {
        // the resampled centreline moves a little further back than the raw tail
        const c = this.centreline(pts, s.width);
        for (let i = Math.max(0, c.length - TAIL_RIBBON); i < c.length; i++) take(c[i][0], c[i][1]);
      }
      if (s.lastPredBox) { take(s.lastPredBox.minX, s.lastPredBox.minY); take(s.lastPredBox.maxX, s.lastPredBox.maxY); }
      const pred = s.sampler ? s.sampler.predicted : [];
      if (pred.length) {
        let pb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        const last = pts[pts.length - 1], prev = pts[pts.length - 2] || last;
        for (const q of [last, prev, ...pred]) { if (q[0] < pb.minX) pb.minX = q[0]; if (q[0] > pb.maxX) pb.maxX = q[0]; if (q[1] < pb.minY) pb.minY = q[1]; if (q[1] > pb.maxY) pb.maxY = q[1]; }
        s.lastPredBox = pb; take(pb.minX, pb.minY); take(pb.maxX, pb.maxY);
      } else s.lastPredBox = null;
      if (!isFinite(minX)) return null;
      return this.toDevice({ minX, minY, maxX, maxY }, s.width + 2);
    }

    // world rect (+ world padding) -> integer device rect (+2 px), clamped
    toDevice(r, pad) {
      const D = this.D(), cv = this.canvas;
      let x0 = Math.floor((r.minX - pad) * D.S + D.Tx) - 2, y0 = Math.floor((r.minY - pad) * D.S + D.Ty) - 2;
      let x1 = Math.ceil((r.maxX + pad) * D.S + D.Tx) + 2, y1 = Math.ceil((r.maxY + pad) * D.S + D.Ty) + 2;
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(cv.width, x1); y1 = Math.min(cv.height, y1);
      if (x1 <= x0 || y1 <= y0) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    intersects(a, b) { return a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

    // Paint the active stroke's dirty rectangle: clear it, redraw every
    // pending path that crosses it (whole paths - one fill/stroke of a
    // self-overlapping path is a single coverage mask in Skia, so nothing
    // double-darkens), then the predicted tail.
    paint(s, sync) {
      const ctx = this.ctx; if (!ctx || this.lost) return;
      const t0 = performance.now();
      const d = this.dirtyRectFor(s); if (!d) return;
      const D = this.D();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath(); ctx.rect(d.x, d.y, d.w, d.h); ctx.clip();
      ctx.clearRect(d.x, d.y, d.w, d.h);
      for (const p of this.pending) {
        const pb = this.toDevice(this.boundsOf(p), 0);
        if (!this.intersects(pb, d)) continue;
        const pts = this.pointsOf(p);
        if (p === s || !p.path) {
          // the active stroke changes every paint; finished ones cache their path
          p.path = new Path2D(this.strokeD(pts, p.style, p.width));
        }
        NG.renderStroke(ctx, { pts, path: p.path, style: p.style, color: p.color, width: p.width }, D);
      }
      const pred = s.sampler ? s.sampler.predicted : [];
      if (pred.length) {
        const pts = this.pointsOf(s);
        const last = pts[pts.length - 1], prev = pts[pts.length - 2] || last;
        const tail = [prev, last, ...pred.map(q => [q[0], q[1], last[2], last[3]])];
        NG.renderStroke(ctx, { pts: tail, style: s.style, color: s.color, width: s.width }, D);
      }
      ctx.restore();
      NG.counters.livePaints++; if (sync) NG.counters.livePaintsSync++;
      const ms = performance.now() - t0;
      this.stats.paintMs.push(ms); this.stats.dirtyPx.push(d.w * d.h);
      this.adapt(ms);
    }

    // A phone at dpr 3 whose paints stay slow drops the live layer to dpr 2
    // (still sharper than the eye can tell at pen speed) after two seconds.
    adapt(ms) {
      if (this.dpr <= 2 || this.dprCap) return;
      const now = performance.now();
      if (this.stats.paintMs.n >= 16 && this.stats.paintMs.percentile(0.95) > 4) {
        if (!this._slowSince) this._slowSince = now;
        else if (now - this._slowSince > 2000) { this.dprCap = 2; this.size(); this.repaintAll(); }
      } else this._slowSince = 0;
    }

    // The view moved or the canvas was resized: everything pending, again.
    repaintAll() {
      const ctx = this.ctx; if (!ctx) return;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); ctx.restore();
      if (this.lost) return;
      const D = this.D();
      for (const p of this.pending) {
        const pts = this.pointsOf(p);
        p.path = new Path2D(this.strokeD(pts, p.style, p.width));
        NG.renderStroke(ctx, { pts, path: p.path, style: p.style, color: p.color, width: p.width }, D);
      }
      NG.counters.livePaints++;
    }

    // Pen up: the last wet frame is painted from the encoded record points,
    // so what is on the glass is exactly what the committed renderer draws.
    finish(s, worldPts) {
      s.finalPts = worldPts; s.path = null; s.bounds = null; s.paintedN = 0;
      if (s.sampler) s.sampler.predicted = [];
      const ctx = this.ctx; if (!ctx || this.lost) return;
      const d = this.toDevice(this.boundsOf(s), 0);
      const old = s.lastPredBox ? this.toDevice(s.lastPredBox, s.width + 2) : null;
      const r = old ? union(d, old) : d;
      s.lastPredBox = null;
      if (!r) return;
      this.redrawRect(r);
    }

    // The committed pixels are on screen: take the stroke off the glass.
    release(s) {
      const i = this.pending.indexOf(s); if (i < 0) return;
      this.pending.splice(i, 1);
      const ctx = this.ctx; if (!ctx) return;
      const d = this.toDevice(this.boundsOf(s), 0);
      const old = s.lastPredBox ? this.toDevice(s.lastPredBox, s.width + 2) : null;
      const r = old ? union(d, old) : d;
      if (r) this.redrawRect(r);
      NG.emit('stroke:release', { id: s.pointerId });
    }

    // Clear a device rect and redraw the pending strokes crossing it.
    redrawRect(r) {
      const ctx = this.ctx, D = this.D();
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip(); ctx.clearRect(r.x, r.y, r.w, r.h);
      for (const p of this.pending) {
        const pb = this.toDevice(this.boundsOf(p), 0);
        if (!this.intersects(pb, r)) continue;
        const pts = this.pointsOf(p);
        if (!p.path) p.path = new Path2D(this.strokeD(pts, p.style, p.width));
        NG.renderStroke(ctx, { pts, path: p.path, style: p.style, color: p.color, width: p.width }, D);
      }
      ctx.restore();
    }

    clearAll() {
      this.pending.length = 0;
      const ctx = this.ctx; if (!ctx) return;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); ctx.restore();
    }
  };

  function union(a, b) {
    if (!a) return b; if (!b) return a;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }

  NG.wet = new NG.WetLayer();
})();
