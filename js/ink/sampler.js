/* Notes Gallery 2.0 — stroke sampler.
   Collects the pen samples of one stroke: complete, in order, taken once.

   Chromium delivers every digitiser sample twice: as a pointerrawupdate and
   again inside the following pointermove's coalesced list. The old code
   merged the two channels by timestamp and could drop legitimate samples
   (Android batches several samples per frame; the replayed ones were older
   than the raw sample already stored). Here the FIRST move-class event of a
   stroke decides its channel: a rawupdate makes the stroke 'raw' and every
   later pointermove only feeds prediction; a pointermove first makes it
   'move' (browsers without rawupdate, synthetic tests). No timestamps are
   compared, so nothing real is ever thrown away.                           */
(() => {
  const NG = (globalThis.NG = globalThis.NG || {});
  const round1 = (v) => Math.round(v * 10) / 10;
  const round3 = (v) => Math.round(v * 1000) / 1000;
  const RING = 64;

  class Ring {
    constructor(n) { this.a = new Float64Array(n); this.i = 0; this.n = 0; }
    push(v) { this.a[this.i] = v; this.i = (this.i + 1) % this.a.length; if (this.n < this.a.length) this.n++; }
    values() { const out = []; for (let k = 0; k < this.n; k++) out.push(this.a[k]); return out; }
    percentile(p) { const v = this.values().sort((a, b) => a - b); if (!v.length) return 0; return v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))]; }
  }
  NG.Ring = Ring;

  NG.StrokeSampler = class StrokeSampler {
    /* opts: pointerId, pointerType, rect (stage rect at pen-down), toWorld(sx, sy) -> {x, y},
       getScale(), taper (0 for stroked styles), usePressure, nibFactor(vel, press, taper),
       t0, x0, y0 (client), p0 (pressure at pen-down) */
    constructor(o) {
      this.pointerId = o.pointerId; this.pointerType = o.pointerType;
      this.rect = o.rect; this.toWorld = o.toWorld; this.getScale = o.getScale;
      this.taper = o.taper || 0; this.usePressure = !!o.usePressure; this.nib = o.nibFactor;
      this.channel = null;                 // 'raw' | 'move' once the first move-class event arrives
      this.cap = 1024; this.n = 0;
      this.x = new Float64Array(this.cap); this.y = new Float64Array(this.cap);
      this.t = new Float64Array(this.cap); this.p = new Float64Array(this.cap); this.k = new Float64Array(this.cap);
      this.vel = 0; this.lastT = o.t0 || performance.now();
      this.predicted = [];                 // [[wx, wy], ...] from getPredictedEvents, never stored
      this.stats = { raw: 0, coalesced: 0, kept: 0, minStepDropped: 0, listMax: 0, predictedUsed: 0,
                     dt: new Ring(RING), latency: new Ring(RING), listLen: new Ring(RING) };
      // sample 0: the pen-down itself
      const w = this.toWorld(o.x0 - this.rect.left, o.y0 - this.rect.top);
      const p0 = this.usePressure ? clamp01(o.p0 == null ? 0.5 : o.p0) : 0;
      this._store(w.x, w.y, this.lastT, p0, this.taper ? round3(this.nib(0, p0, this.taper)) : 0);
    }

    grow() {
      this.cap *= 2;
      for (const k of ['x', 'y', 't', 'p', 'k']) { const a = new Float64Array(this.cap); a.set(this[k]); this[k] = a; }
    }
    _store(wx, wy, t, p, k) {
      if (this.n === this.cap) this.grow();
      const i = this.n++;
      this.x[i] = round1(wx); this.y[i] = round1(wy); this.t[i] = t; this.p[i] = p; this.k[i] = k;
    }

    // One sample. Returns true when kept (a step under 0.7 screen px is noise).
    push(ev, parent) {
      const w = this.toWorld(ev.clientX - this.rect.left, ev.clientY - this.rect.top);
      const scale = this.getScale() || 1;
      const i = this.n - 1;
      const dxw = w.x - this.x[i], dyw = w.y - this.y[i];
      const distW = Math.hypot(dxw, dyw);
      if (distW < 0.7 / scale) { this.stats.minStepDropped++; NG.counters.samples.minStepDropped++; return false; }
      const t = ev.timeStamp || (parent && parent.timeStamp) || performance.now();
      // pen velocity in screen px/ms, smoothed so the nib width does not flicker
      const dt = Math.max(1, t - this.lastT);
      const v = (distW * scale) / dt;
      this.vel = this.vel * 0.7 + v * 0.3;
      this.lastT = t;
      const press = this.usePressure ? clamp01((ev.pressure || (parent && parent.pressure) || 0.5)) : 0;
      const k = this.taper ? round3(this.nib(this.vel, press, this.taper)) : 0;
      this._store(w.x, w.y, t, press, k);
      this.stats.kept++; NG.counters.samples.kept++;
      this.stats.dt.push(dt);
      this.stats.latency.push(Math.max(0, performance.now() - t));
      return true;
    }

    // kind: 'raw' | 'move'. Returns the number of samples kept from this event.
    consumeEvent(e, kind) {
      if (this.channel == null) this.channel = kind;
      if (kind !== this.channel) {
        // the other channel carries the same samples; only prediction is new
        if (kind === 'move') this.readPrediction(e);
        return 0;
      }
      const list = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
      if (kind === 'raw') this.stats.raw++, NG.counters.samples.raw++;
      else { this.stats.coalesced += list.length; NG.counters.samples.coalesced += list.length; }
      this.stats.listLen.push(list.length);
      if (list.length > this.stats.listMax) this.stats.listMax = list.length;
      let kept = 0;
      for (const ev of list) if (this.push(ev, e)) kept++;
      if (kind === 'move') this.readPrediction(e);
      return kept;
    }

    // Predicted positions from the browser's motion predictor: up to 6 points
    // no more than 25 ms ahead, shown only while the pen is moving. They are
    // drawn as the stroke's tail and replaced by real samples next frame.
    readPrediction(e) {
      this.predicted = [];
      if (NG.predictedTail === false) return;
      if (!e.getPredictedEvents || this.vel <= 0.4) return;
      let list;
      try { list = e.getPredictedEvents(); } catch (_) { return; }
      for (const pe of list) {
        if (this.predicted.length >= 6) break;
        if (pe.timeStamp && pe.timeStamp - this.lastT > 25) break;
        const w = this.toWorld(pe.clientX - this.rect.left, pe.clientY - this.rect.top);
        this.predicted.push([round1(w.x), round1(w.y)]);
      }
      if (this.predicted.length) { this.stats.predictedUsed++; NG.counters.samples.predicted += this.predicted.length; }
    }
    consumePrediction() { const p = this.predicted; this.predicted = []; return p; }

    // The points finalizeInk stores: [x, y, pressure, nib], rounded as v1 did.
    toPts() {
      const out = new Array(this.n);
      for (let i = 0; i < this.n; i++) out[i] = [this.x[i], this.y[i], this.p[i], this.k[i]];
      return out;
    }
    last() { const i = this.n - 1; return i < 0 ? null : [this.x[i], this.y[i], this.p[i], this.k[i]]; }
    // world bbox of samples [from, n)
    bbox(from = 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = Math.max(0, from); i < this.n; i++) {
        const x = this.x[i], y = this.y[i];
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    }
  };

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
})();
