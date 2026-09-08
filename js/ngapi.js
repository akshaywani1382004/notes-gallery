/* Notes Gallery 2.0 — window.__ng, the test and debug API (spec section G).

   The harness scripts used to reach into app.js through DOM side effects
   (reading SVG attributes, counting canvas fills, re-opening IndexedDB). That
   coupled every test to the renderer's private shape. This file is the one
   sanctioned window: it reads records and geometry through the accessor bag
   app.js hands to NG.attachApi at init, so the renderer can change underneath
   (tiles in stage 3, modules in stage 4) without touching a single test.

   Two rules keep it honest:
   - everything returned is a clone: a test can never mutate live state by
     accident, and a record it holds cannot change under it;
   - pixel reads never look at the real live canvas (desynchronized surfaces
     may not read back deterministically); they redraw the same geometry
     through NG.renderStroke into a scratch canvas of the same size, so what
     the test measures is exactly what the renderer was asked to draw.

   window.__ng exists from script load so a harness can subscribe before the
   app initialises; bag-dependent calls throw until NG.attachApi has run.   */
(() => {
  const NG = (globalThis.NG = globalThis.NG || {});

  // Deep copy for every record and object handed out. structuredClone keeps
  // typed arrays and nested arrays intact; the JSON fallback covers hosts
  // without it (and drops functions, which no record carries anyway).
  const clone = (v) => {
    if (v == null || typeof v !== 'object') return v;
    try { return structuredClone(v); } catch (_) { return JSON.parse(JSON.stringify(v)); }
  };

  const notAttached = () => { throw new Error('__ng: app not attached yet'); };
  const needDiag = () => { if (!NG.Diag) throw new Error('__ng: diagnostics (js/diag.js) not loaded'); return NG.Diag; };

  // Coalesced/predicted lists can only be attached through the constructor
  // init; probe once so injectSamples can fall back to one event per sample
  // where the browser ignores the init (older WebViews).
  const coalescedInitSupported = (() => {
    try {
      const inner = new PointerEvent('pointermove');
      return new PointerEvent('pointermove', { coalescedEvents: [inner] }).getCoalescedEvents().length === 1;
    } catch (_) { return false; }
  })();

  // Synthetic events are stamped at construction; a test that replays a
  // recorded trace needs the original clock, so the instance property
  // shadows the prototype getter (allowed: event objects are extensible).
  function stampTime(ev, t) {
    if (t == null) return ev;
    try { Object.defineProperty(ev, 'timeStamp', { value: t, configurable: true }); } catch (_) {}
    return ev;
  }

  function makePointerEvent(type, pointerId, s, extra) {
    const init = {
      bubbles: true, cancelable: true, composed: true,
      pointerId, pointerType: 'pen', isPrimary: true, width: 3, height: 3,
      button: -1, buttons: 1,                    // a moving pen in contact (no button change)
      pressure: s.p == null ? 0.5 : s.p,
      clientX: s.x, clientY: s.y, screenX: s.x, screenY: s.y,
    };
    if (extra) Object.assign(init, extra);
    return stampTime(new PointerEvent(type, init), s.t);
  }

  /* ----------------------- bag-independent surface ---------------------- */

  // Dispatches digitiser samples the way the browser would deliver them.
  // The caller owns pointerdown/pointerup: this only feeds the channel the
  // stroke's sampler is listening on. 'raw' = one pointerrawupdate per
  // sample; 'move' = pointermove events carrying `batch` samples each in
  // their coalesced list (the parent sits at the last sample of its batch).
  // opts.predicted = [{x, y}] rides on the final move as its predicted list.
  // Returns the number of samples delivered.
  function injectSamples(pointerId, samples, opts) {
    const o = opts || {};
    const list = Array.isArray(samples) ? samples : [];
    if (!list.length) return 0;
    const channel = o.channel === 'raw' ? 'raw' : 'move';
    if (channel === 'raw') {
      for (const s of list) window.dispatchEvent(makePointerEvent('pointerrawupdate', pointerId, s));
      return list.length;
    }
    const batch = Math.max(1, o.batch | 0 || 4);
    for (let i = 0; i < list.length; i += batch) {
      const group = list.slice(i, i + batch);
      const last = group[group.length - 1];
      const isFinal = i + batch >= list.length;
      if (!coalescedInitSupported) {
        // no coalesced init: each sample is its own move (the sampler treats
        // an empty coalesced list as [e], so the count is still exact)
        for (const s of group) window.dispatchEvent(makePointerEvent('pointermove', pointerId, s));
        continue;
      }
      const coalesced = group.map(s => makePointerEvent('pointermove', pointerId, s));
      const extra = { coalescedEvents: coalesced };
      if (isFinal && Array.isArray(o.predicted) && o.predicted.length) {
        extra.predictedEvents = o.predicted.map(q => makePointerEvent('pointermove', pointerId, { x: q.x, y: q.y, p: q.p, t: q.t }));
      }
      window.dispatchEvent(makePointerEvent('pointermove', pointerId, last, extra));
    }
    return list.length;
  }

  const api = {
    version: NG.version,

    // Stage 1 has no tile renderer or backend switch; the names exist so the
    // ported suite runs unchanged and stage 3 fills them in.
    tiles: () => [],
    enable: () => true,
    disable: () => true,
    setBackend: () => {},

    reset: () => { NG.resetCounters(); return true; },
    counters: () => clone(NG.counters),
    on: (event, fn) => NG.on(event, fn),

    // Which block sits under a client point: what a real tap would land on.
    hitTest: (cx, cy) => {
      const el = document.elementFromPoint(cx, cy);
      const blk = el && el.closest ? el.closest('.block') : null;
      return (blk && blk.dataset.id) || null;
    },

    injectSamples,
    recordSamples: (seconds) => needDiag().record(seconds),
    traces: () => needDiag().traces(),
    diag: (on) => needDiag().toggle(on),
  };

  // Bag-dependent names are present from the start (a harness can feature-
  // detect the surface) but refuse to run until the app has attached.
  for (const name of ['state', 'blocks', 'block', 'inks', 'selection', 'selectionMode', 'worldToScreen', 'screenToWorld',
    'inkBounds', 'inkScreenRect', 'blockScreenRect', 'selectionBox', 'strokePathD', 'strokeStyle', 'renderStroke',
    'liveCanvas', 'live', 'readLivePixels', 'readInkPixels', 'flush', 'saved']) api[name] = notAttached;

  globalThis.__ng = api;

  /* ------------------------- bag-dependent surface ---------------------- */

  NG.onAttach((bag) => {
    const { state, stage, PEN_STYLES } = bag;
    const styleOf = (b) => (PEN_STYLES[b.style] ? b.style : 'pen');
    const widthOf = (b) => b.width || 3;
    const colorOf = (b) => b.color || bag.getTools().penColor;

    const findBlock = (id) => state.blocks.find(b => b.id === id) || null;
    const findInk = (id) => {
      const b = findBlock(id);
      if (!b || b.kind !== 'ink') throw new Error('__ng: no ink record ' + id);
      return b;
    };

    // Paint order = what the DOM shows: z ascending, array order breaks ties
    // (the same rule the level loader uses when it appends elements).
    const inksInPaintOrder = () => state.blocks
      .map((b, i) => ({ b, i }))
      .filter(e => e.b.kind === 'ink')
      .sort((p, q) => ((p.b.z ?? 0) - (q.b.z ?? 0)) || (p.i - q.i))
      .map(e => e.b);

    // Padded points exactly as paintInkNode builds them: the record stores
    // points relative to its box, the SVG viewBox starts one pad earlier.
    const paddedPts = (b) => {
      const pad = bag.inkPad(b);
      return (b.pts || []).map(p => [p[0] + pad, p[1] + pad, p[2] || 0, p[3] || 0]);
    };

    const liveCanvas = () => bag.liveCanvas();
    const liveCtx = () => bag.liveCtx();

    // Backing-store size for the scratch canvas: the live canvas once sized,
    // else the stage at the device ratio (a pixel read before any stroke).
    const backingSize = () => {
      const cv = liveCanvas();
      if (cv && cv.width && cv.height) return { w: cv.width, h: cv.height };
      const r = stage.getBoundingClientRect(), dpr = NG.wet.dpr || window.devicePixelRatio || 1;
      return { w: Math.max(1, Math.round(r.width * dpr)), h: Math.max(1, Math.round(r.height * dpr)) };
    };

    // Draw `specs` through the shared renderer into a fresh canvas and read
    // the device rect under a stage-relative CSS box. Same D as the live
    // layer, so a test compares like with like.
    const readPixels = (specs, x, y, w, h) => {
      const size = backingSize();
      const cv = document.createElement('canvas'); cv.width = size.w; cv.height = size.h;
      const ctx = cv.getContext('2d', { willReadFrequently: true }) || cv.getContext('2d');
      const D = NG.wet.D();
      for (const spec of specs) if (spec.pts && spec.pts.length) NG.renderStroke(ctx, spec, D);
      const dpr = NG.wet.dpr || 1;
      let x0 = Math.max(0, Math.floor(x * dpr)), y0 = Math.max(0, Math.floor(y * dpr));
      let x1 = Math.min(size.w, Math.ceil((x + w) * dpr)), y1 = Math.min(size.h, Math.ceil((y + h) * dpr));
      if (x1 <= x0 || y1 <= y0) return { width: 0, height: 0, data: new Uint8ClampedArray(0), alphaCount: 0 };
      const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
      let alphaCount = 0;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) alphaCount++;
      return { width: img.width, height: img.height, data: img.data, alphaCount };
    };

    const pendingSpec = (s) => ({
      pts: s.finalPts || (s.sampler ? s.sampler.toPts() : s.pts),
      style: s.style, color: s.color, width: s.width,
    });
    const recordSpec = (b) => ({ pts: bag.inkWorldPts(b), style: styleOf(b), color: colorOf(b), width: widthOf(b) });

    const real = {
      version: bag.version || NG.version,

      state: () => clone({
        ws: state.ws, level: state.level,
        view: { scale: state.view.scale, tx: state.view.tx, ty: state.view.ty },
        tools: bag.getTools(), gesture: bag.getGesture(),
        tier: NG.tier, paper: stage.dataset.paper,
      }),
      blocks: (filter) => (typeof filter === 'function' ? state.blocks.filter(filter) : state.blocks).map(clone),
      block: (id) => clone(findBlock(id)),
      inks: () => inksInPaintOrder().map(clone),
      selection: () => [...state.selectedIds],
      // twelve is where the glow filter stops being affordable per frame
      selectionMode: () => (state.selectedIds.size > 12 ? 'outline' : 'glow'),

      // stage-relative CSS px on the screen side, world units on the other
      worldToScreen: (x, y) => clone(bag.worldToScreen(x, y)),
      screenToWorld: (sx, sy) => clone(bag.screenToWorld(sx, sy)),

      inkBounds: (id) => clone(bag.inkBox(findInk(id))),
      // The element box in CLIENT coordinates without a layout read: the
      // record's box through the view transform, offset by the stage.
      inkScreenRect: (id) => {
        const box = bag.inkBox(findInk(id));
        const sr = stage.getBoundingClientRect(), s = state.view.scale || 1;
        const tl = bag.worldToScreen(box.x, box.y);
        const left = sr.left + tl.x, top = sr.top + tl.y, width = box.w * s, height = box.h * s;
        return { left, top, width, height, cx: left + width / 2, cy: top + height / 2 };
      },
      blockScreenRect: (id) => clone(bag.blockScreenRect(id)),
      selectionBox: () => clone(bag.selectionWorldBox()),

      strokePathD: (id) => { const b = findInk(id); return bag.inkStrokeD(paddedPts(b), styleOf(b), widthOf(b)); },
      // The attributes applyInkStyle writes, as data: a test compares the
      // intent rather than scraping the SVG.
      strokeStyle: (id) => {
        const b = findInk(id), st = PEN_STYLES[styleOf(b)], w = widthOf(b);
        return {
          filled: st.taper > 0, opacity: st.opacity, cap: st.cap,
          dash: st.grain ? [w * 1.1, w * 0.55] : null,
          color: colorOf(b), width: w,
        };
      },
      renderStroke: (id, ctx, D) => {
        const spec = recordSpec(findInk(id));
        if (!spec.pts.length) return false;
        NG.renderStroke(ctx, spec, D || NG.wet.D());
        return true;
      },

      liveCanvas,
      live: () => {
        const cv = liveCanvas(), ctx = liveCtx(), inking = bag.getInking();
        let desyncAttr = null;
        try { desyncAttr = ctx && ctx.getContextAttributes ? (ctx.getContextAttributes().desynchronized ?? null) : null; } catch (_) {}
        return {
          tier: NG.tier,
          channel: (inking && inking.sampler && inking.sampler.channel) || null,
          dpr: NG.wet.dpr, w: cv ? cv.width : 0, h: cv ? cv.height : 0,
          desyncAttr, pending: NG.wet.pending.length,
        };
      },
      readLivePixels: (x, y, w, h) => readPixels(NG.wet.pending.map(pendingSpec), x, y, w, h),
      readInkPixels: (x, y, w, h) => readPixels(inksInPaintOrder().map(recordSpec), x, y, w, h),

      // Every queued ink write landed, then two frames so the DOM the writes
      // touched has been painted before the test looks.
      flush: async () => {
        await bag.flushWrites();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return true;
      },
      saved: async (ws) => (await bag.DB.allByWs('blocks', ws == null ? state.ws : ws)).map(clone),
    };

    // Same object, so a harness that grabbed window.__ng before init sees
    // the real implementation appear in place.
    Object.assign(api, real);
  });
})();
