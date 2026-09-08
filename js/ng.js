/* Notes Gallery 2.0 — shared namespace for the ink engine, diagnostics and
   the test API. Loaded first; every other engine file registers on NG.
   Classic scripts on globalThis (page and worker) — ES modules in stage 4. */
(() => {
  const NG = (globalThis.NG = globalThis.NG || {});
  NG.version = '2.0.4';

  // Counters read by the diagnostics overlay and window.__ng.counters().
  NG.counters = {
    livePaints: 0, livePaintsSync: 0, tileRenders: 0, lifts: 0, layoutsForced: 0, planeConflicts: 0, deltaTx: 0,
    samples: { raw: 0, coalesced: 0, kept: 0, minStepDropped: 0, predicted: 0 },
  };
  NG.resetCounters = () => {
    const c = NG.counters;
    c.livePaints = c.livePaintsSync = c.tileRenders = c.lifts = c.layoutsForced = c.planeConflicts = c.deltaTx = 0;
    c.samples = { raw: 0, coalesced: 0, kept: 0, minStepDropped: 0, predicted: 0 };
  };

  // Runs fn after the next frame has been committed (rAF, then a task queued
  // from inside it). Used to clear the wet stroke only once the committed
  // pixels are on screen, so a desynchronized canvas can never present the
  // clear before the DOM shows the stroke.
  NG.afterNextPaint = (fn) => requestAnimationFrame(() => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); fn(); };
    ch.port2.postMessage(0);
  });

  // The input tier this browser offers (probed once; shown in diagnostics).
  NG.tier = (() => {
    try {
      if (globalThis.isSecureContext && 'onpointerrawupdate' in globalThis) return 'raw';
      if (typeof PointerEvent !== 'undefined' && PointerEvent.prototype.getCoalescedEvents) return 'move';
    } catch (_) {}
    return 'plain';
  })();

  // app.js hands the engine and the test API a bag of accessors at init.
  NG.bag = null;
  NG._onAttach = [];
  NG.attachApi = (bag) => { NG.bag = bag; NG._onAttach.forEach(fn => { try { fn(bag); } catch (e) { console.warn('NG attach hook failed:', e); } }); };
  NG.onAttach = (fn) => { if (NG.bag) fn(NG.bag); else NG._onAttach.push(fn); };

  // Event bus for stroke lifecycle (used by __ng.on and the diagnostics).
  const subs = new Map();
  NG.on = (ev, fn) => { let s = subs.get(ev); if (!s) subs.set(ev, s = new Set()); s.add(fn); return () => s.delete(fn); };
  NG.emit = (ev, data) => { const s = subs.get(ev); if (s) s.forEach(fn => { try { fn(data); } catch (e) { console.warn('NG listener failed:', e); } }); };
})();
