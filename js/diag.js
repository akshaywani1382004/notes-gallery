/* ===========================================================================
 * diag.js — Notes Gallery 2.0 diagnostics overlay (NG.Diag).
 *
 * Read-only window onto the ink engine: input tier and per-stroke channel,
 * sample rate / latency, rAF cadence, long animation frames, wet-layer paint
 * cost, lift state, save timings and the Android host switches. Everything
 * here is optional to the app — every read is wrapped so a field the engine
 * does not (yet) expose shows as "—" instead of throwing into app.js.
 *
 * Cost model: nothing runs while the overlay is hidden (no rAF loop, no
 * observers, no interval). While shown, one rAF callback per frame records a
 * frame gap and a 4 Hz interval recomputes the numbers and writes only the
 * text nodes whose value changed, so the panel never forces layout work of
 * its own during a stroke.
 *
 * Classic script; registers NG.Diag on the shared namespace from ng.js.
 * ========================================================================= */
(() => {
  'use strict';
  const NG = (globalThis.NG = globalThis.NG || {});

  const LS_ENABLED = 'ng-diag';
  const LS_PREDICT = 'ng-predict';
  const TICK_MS = 250;            // 4 Hz refresh
  const WINDOW_MS = 1000;         // rate window for samples/s and paints/frame
  const FRAME_RING = 180;         // ~1.5 s of frame gaps at 120 Hz
  const HIDDEN_GAP_MS = 500;      // gaps this long mean the tab was hidden, not a dropped frame

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} },
  };

  // The predicted-tail switch is read by the wet layer on every paint, so it
  // must exist from script load — before init() and before any stroke.
  if (typeof NG.predictedTail !== 'boolean') NG.predictedTail = ls.get(LS_PREDICT) !== '0';

  /* ------------------------------ helpers ------------------------------ */
  const safe = (fn, fallback) => { try { const v = fn(); return v === undefined ? fallback : v; } catch (_) { return fallback; } };
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  // Ring buffers from the sampler / wet layer may be plain arrays, typed
  // arrays, or small wrapper objects; normalise to a dense array of numbers.
  function toArr(r) {
    if (!r) return [];
    if (Array.isArray(r) || (ArrayBuffer.isView(r) && !(r instanceof DataView))) {
      const out = [];
      for (let i = 0; i < r.length; i++) if (isNum(r[i])) out.push(r[i]);
      return out;
    }
    // NG.Ring (sampler.js) exposes the filled prefix through values().
    if (typeof r.values === 'function' && !(r instanceof Map) && !(r instanceof Set)) return toArr(safe(() => r.values(), []));
    if (typeof r.toArray === 'function') return toArr(safe(() => r.toArray(), []));
    for (const k of ['buf', 'arr', 'items', 'data']) if (r[k] && typeof r[k] !== 'function') return toArr(r[k]);
    return [];
  }
  function pct(arr, q) {
    if (!arr.length) return NaN;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * q)))];
  }
  const median = (arr) => pct(arr, 0.5);
  const fmt = (v, d = 1) => isNum(v) ? (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(d)).toString() : '—';
  const fmtInt = (v) => isNum(v) ? String(Math.round(v)) : '—';
  const yn = (v) => v == null ? '—' : (v ? 'yes' : 'no');
  const onoff = (v) => v == null ? '—' : (v ? 'on' : 'off');
  const kb = (n) => !isNum(n) ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
  const ago = (t) => isNum(t) && t > 0 ? fmt((performance.now() - t) / 1000) + ' s ago' : '—';
  const basename = (u) => String(u || '').split(/[?#]/)[0].split('/').pop() || String(u || '');
  const firstOf = (obj, keys) => { for (const k of keys) if (obj && obj[k] != null) return obj[k]; return undefined; };

  /* ------------------------------- state ------------------------------- */
  let bag = null;                 // app.js accessor bag (NG.attachApi)
  let root = null;                // #diag
  let built = false;
  let intervalId = 0;
  let rafId = 0;
  let observer = null;
  const slots = {};               // key -> { el, text, cls } text nodes updated at 4 Hz
  const btns = {};

  // rAF cadence: gaps since the last tick plus a ring for the median.
  let lastFrameT = 0;
  let frameCount = 0;
  const gapRing = [];
  let newGaps = [];
  let dropped = 0;

  // Rate window: one entry per tick of the cumulative counters.
  const hist = [];
  let lastRate = NaN;             // last non-zero samples/s, kept visible after pen-up

  const loaf = { count: 0, worst: 0, top: '' };
  let lastSampler = null;         // stats stay readable after the stroke ends
  let lastChannel = null;

  let recording = null;           // { until, samples, off } while a trace is running
  const memTraces = [];           // in-memory list when neither IDB nor localStorage is available

  const Diag = NG.Diag = {
    enabled: false,
    // app.js writes save timings here (payloadMs, writeMs, bytes, at) and
    // lastPointerUpAt; both are read, never required.
    metrics: { save: null },
    lastPointerUpAt: 0,
    last: null,                   // snapshot from the most recent tick()
    init, toggle, tick, record, traces, snapshot: () => Diag.last,
  };

  NG.onAttach && NG.onAttach((b) => { bag = b; });
  if (NG.bag) bag = NG.bag;

  /* ------------------------------- DOM --------------------------------- */
  // The panel is `white-space: pre-wrap`, so it is assembled from elements
  // only — a stray text node between rows would render as a blank line.
  function line(parent, parts) {
    const div = document.createElement('div');
    div.className = 'diag-line';
    for (const p of parts) {
      if (typeof p === 'string') { div.appendChild(document.createTextNode(p)); continue; }
      const span = document.createElement('span');
      span.className = 'diag-v';
      const text = document.createTextNode('—');
      span.appendChild(text);
      div.appendChild(span);
      slots[p.k] = { el: span, text, val: '—', cls: '' };
    }
    parent.appendChild(div);
  }
  function button(parent, key, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); safe(onClick); });
    parent.appendChild(b);
    btns[key] = b;
    return b;
  }
  function set(key, val, cls) {
    const s = slots[key];
    if (!s) return;
    const v = val == null ? '—' : String(val);
    if (v !== s.val) { s.text.data = v; s.val = v; }
    const c = cls ? 'diag-v ' + cls : 'diag-v';
    if (c !== s.cls) { s.el.className = c; s.cls = c; }
  }

  function ensureDom() {
    if (built) return true;
    root = document.getElementById('diag');
    if (!root) {
      const stage = document.getElementById('stage') || document.body;
      if (!stage) return false;
      root = document.createElement('div');
      root.id = 'diag';
      root.className = 'diag';
      root.hidden = true;
      stage.appendChild(root);
    }
    root.textContent = '';
    const v = safe(() => NG.version, '2.0');
    line(root, ['diagnostics ' + v + '  tier ', { k: 'tier' }, '  channel ', { k: 'channel' }]);
    line(root, ['secure ', { k: 'secure' }, ' rawupdate ', { k: 'raw' }, ' coalesced ', { k: 'coal' }, ' predicted ', { k: 'pred' }]);
    line(root, ['ua ', { k: 'ua' }, '  reduced-motion ', { k: 'motion' }]);
    line(root, ['dpr ', { k: 'dpr' }, ' live ', { k: 'ldpr' }, ' cap ', { k: 'cap' }, '  desync requested ', { k: 'desync' }]);
    line(root, ['pen ', { k: 'rate' }, ' /s (last ', { k: 'lastRate' }, ')  list p50 ', { k: 'listP50' }, ' max ', { k: 'listMax' }]);
    line(root, ['Δt med ', { k: 'dt' }, ' ms  latency p50 ', { k: 'latP50' }, ' p95 ', { k: 'latP95' }, ' ms  predicted used ', { k: 'predUsed' }]);
    line(root, ['kept ', { k: 'kept' }, ' raw ', { k: 'rawN' }, ' coalesced ', { k: 'coalN' }, ' minStep ', { k: 'minStep' }]);
    line(root, ['rAF ', { k: 'hz' }, ' Hz  dropped ', { k: 'dropped' }, '  LoAF ', { k: 'loaf' }, ' worst ', { k: 'loafWorst' }, ' ms ', { k: 'loafTop' }]);
    line(root, ['wet ', { k: 'ppf' }, ' paints/frame  dirty ', { k: 'dirty' }, ' px  paint p95 ', { k: 'paintP95' }, ' ms  pending ', { k: 'pending' }]);
    line(root, ['paints ', { k: 'paints' }, ' sync ', { k: 'paintsSync' }, '  lift ', { k: 'lift' }, '  lifts ', { k: 'lifts' }]);
    line(root, ['save payload ', { k: 'savePayload' }, ' ms write ', { k: 'saveWrite' }, ' ms ', { k: 'saveBytes' }, ' ', { k: 'saveAgo' }, '  pen up ', { k: 'penUp' }]);
    line(root, ['host ', { k: 'host' }]);
    line(root, ['trace ', { k: 'trace' }]);

    const row = document.createElement('div');
    row.className = 'diag-row';
    button(row, 'record', 'Record 10 s', () => { if (!recording) record(10); });
    button(row, 'unbuffered', 'Unbuffered —', () => {
      const info = hostInfo();
      if (!info) return;
      const next = !info.unbuffered;
      safe(() => window.NGHost.setUnbuffered(next));
      updateButtons();
    });
    button(row, 'predict', 'Predicted tail', () => {
      NG.predictedTail = !NG.predictedTail;
      ls.set(LS_PREDICT, NG.predictedTail ? '1' : '0');
      updateButtons();
    });
    button(row, 'close', 'Close', () => toggle(false));
    root.appendChild(row);
    built = true;
    return true;
  }

  function updateButtons() {
    if (!built) return;
    const info = hostInfo();
    const ub = btns.unbuffered;
    ub.disabled = !info || typeof safe(() => window.NGHost.setUnbuffered) !== 'function';
    ub.textContent = 'Unbuffered ' + (info ? onoff(!!info.unbuffered) : '—');
    ub.classList.toggle('on', !!(info && info.unbuffered));
    btns.predict.textContent = 'Predicted tail ' + onoff(!!NG.predictedTail);
    btns.predict.classList.toggle('on', !!NG.predictedTail);
    btns.record.classList.toggle('on', !!recording);
    if (!recording) btns.record.textContent = 'Record 10 s';
  }

  function setStateLabel() {
    const s = document.getElementById('diag-state');
    if (s) s.textContent = Diag.enabled ? 'on' : '';
  }

  /* ------------------------------ sources ------------------------------ */
  function hostInfo() {
    const h = globalThis.NGHost;
    if (!h || typeof h.info !== 'function') return null;
    return safe(() => {
      const raw = h.info();
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }, null);
  }
  const wetLayer = () => NG.wet || NG.WetLayer || null;
  function currentSampler() {
    const ink = safe(() => bag && bag.getInking && bag.getInking(), null);
    const s = ink && ink.sampler;
    if (s) { lastSampler = s; if (s.channel) lastChannel = s.channel; }
    return s || null;
  }
  const liveCtx = () => safe(() => bag && bag.liveCtx && bag.liveCtx(), null);

  // Static environment facts; probed once at init since none of them change
  // while the page is alive.
  const env = {};
  function probeEnv() {
    const ua = safe(() => navigator.userAgent, '') || '';
    const chrome = ua.match(/Chrom(?:e|ium)\/(\d+)/);
    const edge = ua.match(/Edg[A-Za-z]*\/(\d+)/);
    const flags = [];
    if (chrome) flags.push('Chrome/' + chrome[1]);
    if (edge) flags.push('Edg/' + edge[1]);
    if (/\bwv\b/.test(ua)) flags.push('wv');
    if (/Android/.test(ua)) flags.push('Android');
    env.ua = flags.join(' ') || (ua.slice(0, 40) || '—');
    env.secure = safe(() => !!globalThis.isSecureContext, false);
    env.raw = safe(() => 'onpointerrawupdate' in globalThis, false);
    env.coalesced = safe(() => typeof PointerEvent !== 'undefined' && typeof PointerEvent.prototype.getCoalescedEvents === 'function', false);
    env.predicted = safe(() => typeof PointerEvent !== 'undefined' && typeof PointerEvent.prototype.getPredictedEvents === 'function', false);
    env.motion = safe(() => !!(matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches), false);
    env.loafSupported = safe(() => PerformanceObserver.supportedEntryTypes.indexOf('long-animation-frame') >= 0, false);
  }

  /* ------------------------------ frame loop --------------------------- */
  function onFrame(t) {
    if (!Diag.enabled) { rafId = 0; return; }
    if (lastFrameT) {
      const gap = t - lastFrameT;
      // A hidden tab stalls rAF entirely; those gaps say nothing about jank.
      if (gap < HIDDEN_GAP_MS) { newGaps.push(gap); frameCount++; }
    }
    lastFrameT = t;
    rafId = requestAnimationFrame(onFrame);
  }

  function startLoaf() {
    if (observer || !env.loafSupported) return;
    loaf.count = 0; loaf.worst = 0; loaf.top = '';
    observer = safe(() => {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          loaf.count++;
          const bd = isNum(e.blockingDuration) ? e.blockingDuration : e.duration;
          if (bd >= loaf.worst) {
            loaf.worst = bd;
            let top = null;
            for (const s of (e.scripts || [])) if (!top || (s.duration || 0) > (top.duration || 0)) top = s;
            loaf.top = top ? (basename(top.sourceURL) + ' ' + (top.sourceFunctionName || top.functionName || top.invoker || '')).trim() : '';
          }
        }
      });
      // buffered: the entries from before the panel opened are the ones a
      // user most often wants to see after a hitch.
      po.observe({ type: 'long-animation-frame', buffered: true });
      return po;
    }, null);
  }

  function start() {
    if (!ensureDom()) return;
    root.hidden = false;
    lastFrameT = 0; frameCount = 0; gapRing.length = 0; newGaps = []; dropped = 0; hist.length = 0;
    if (!rafId) rafId = requestAnimationFrame(onFrame);
    if (!intervalId) intervalId = setInterval(tick, TICK_MS);
    startLoaf();
    updateButtons();
    tick();
  }
  function stop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (intervalId) { clearInterval(intervalId); intervalId = 0; }
    if (observer) { safe(() => observer.disconnect()); observer = null; }
    if (root) root.hidden = true;
  }

  /* ------------------------------ public API --------------------------- */
  function init() {
    probeEnv();
    let on = ls.get(LS_ENABLED) === '1';
    const q = safe(() => location.search, '') || '';
    if (/[?&]diag=1(?:&|$)/.test(q)) on = true;
    else if (/[?&]diag=0(?:&|$)/.test(q)) on = false;
    ensureDom();
    toggle(on);
    return Diag;
  }

  function toggle(on) {
    const next = on == null ? !Diag.enabled : !!on;
    Diag.enabled = next;
    ls.set(LS_ENABLED, next ? '1' : null);
    if (next) start(); else stop();
    setStateLabel();
    return next;
  }

  function tick() {
    // Background tab: nothing is visible, so skip the work entirely.
    if (document.hidden && Diag.enabled) return;
    const s = Diag.last = compute();
    if (!built) return;

    set('tier', s.tier, s.tier === 'raw' ? 'ok' : s.tier === 'move' ? 'warn' : 'bad');
    set('channel', s.channel || (lastChannel ? lastChannel + ' (last)' : 'idle'));
    set('secure', yn(s.secure), s.secure ? 'ok' : 'bad');
    set('raw', yn(s.rawupdate), s.rawupdate ? 'ok' : 'warn');
    set('coal', yn(s.coalescedApi));
    set('pred', yn(s.predictedApi));
    set('ua', s.ua);
    set('motion', yn(s.reducedMotion));
    set('dpr', fmt(s.dpr, 2));
    set('ldpr', fmt(s.liveDpr, 2));
    set('cap', s.dprCap ? fmt(s.dprCap, 1) : 'none');   // wet.dprCap 0 = uncapped
    set('desync', s.desync == null ? '—' : yn(s.desync), s.desync == null ? '' : s.desync ? 'ok' : 'warn');
    set('rate', fmtInt(s.samplesPerSec), !isNum(s.samplesPerSec) || s.samplesPerSec === 0 ? '' : s.samplesPerSec >= 200 ? 'ok' : s.samplesPerSec >= 100 ? 'warn' : 'bad');
    set('lastRate', fmtInt(s.lastSamplesPerSec));
    set('listP50', fmt(s.listP50, 1));
    set('listMax', fmtInt(s.listMax));
    set('dt', fmt(s.dtMedian, 1));
    set('latP50', fmt(s.latencyP50, 1));
    set('latP95', fmt(s.latencyP95, 1), !isNum(s.latencyP95) ? '' : s.latencyP95 <= 20 ? 'ok' : 'warn');
    set('predUsed', fmtInt(s.predictedUsed));
    set('kept', fmtInt(s.kept));
    set('rawN', fmtInt(s.rawEvents));
    set('coalN', fmtInt(s.coalesced));
    set('minStep', fmtInt(s.minStepDropped));
    set('hz', fmtInt(s.rafHz));
    set('dropped', fmtInt(s.dropped), s.dropped > 0 ? 'warn' : '');
    set('loaf', s.loafSupported ? fmtInt(s.loafCount) : 'n/a', !s.loafSupported ? '' : s.loafCount === 0 ? 'ok' : s.loafCount < 5 ? 'warn' : 'bad');
    set('loafWorst', s.loafSupported ? fmtInt(s.loafWorstMs) : '—');
    set('loafTop', s.loafTop || '');
    set('ppf', fmt(s.paintsPerFrame, 2));
    set('dirty', fmtInt(s.dirtyPxMedian));
    set('paintP95', fmt(s.paintMsP95, 2), !isNum(s.paintMsP95) ? '' : s.paintMsP95 <= 1 ? 'ok' : s.paintMsP95 <= 4 ? 'warn' : 'bad');
    set('pending', fmtInt(s.pending));
    set('paints', fmtInt(s.livePaints));
    set('paintsSync', fmtInt(s.livePaintsSync));
    set('lift', s.lift);
    set('lifts', fmtInt(s.lifts));
    set('savePayload', fmt(s.save.payloadMs, 1));
    set('saveWrite', fmt(s.save.writeMs, 1));
    set('saveBytes', kb(s.save.bytes));
    set('saveAgo', ago(s.save.at));
    set('penUp', ago(s.lastPointerUpAt));
    set('host', s.host ? ('unbuffered ' + onoff(s.host.unbuffered) + (isNum(s.host.refresh) ? '  ' + fmtInt(s.host.refresh) + ' Hz' : '') + (s.host.sdk != null ? '  sdk ' + s.host.sdk : '')) : 'none');
    set('trace', s.trace, recording ? 'warn' : '');
    if (recording) btns.record.textContent = 'REC ' + fmt(Math.max(0, recording.until - performance.now()) / 1000, 1) + ' s';
  }

  // One consistent reading of every source; also what snapshot() returns.
  function compute() {
    const now = performance.now();
    const c = NG.counters || {};
    const cs = c.samples || {};
    const sampler = currentSampler();
    const st = safe(() => (sampler || lastSampler) && (sampler || lastSampler).stats, null) || {};
    const wet = wetLayer();
    const ws = safe(() => wet && wet.stats, null) || {};

    // Rate window: deltas of the cumulative counters over the last ~1 s.
    hist.push({ t: now, kept: cs.kept || 0, paints: c.livePaints || 0, frames: frameCount });
    while (hist.length > 2 && now - hist[1].t >= WINDOW_MS) hist.shift();
    const a = hist[0], b = hist[hist.length - 1];
    const span = (b.t - a.t) / 1000;
    let samplesPerSec = NaN, paintsPerFrame = NaN;
    if (span >= 0.5) {
      samplesPerSec = (b.kept - a.kept) / span;
      const df = b.frames - a.frames;
      if (df > 0) paintsPerFrame = (b.paints - a.paints) / df;
    }
    if (isNum(samplesPerSec) && samplesPerSec > 0) lastRate = samplesPerSec;

    // rAF cadence: median over the ring, dropped = gaps > 1.5x that median.
    for (const g of newGaps) { gapRing.push(g); if (gapRing.length > FRAME_RING) gapRing.shift(); }
    const med = median(gapRing);
    if (isNum(med) && med > 0) for (const g of newGaps) if (g > 1.5 * med) dropped++;
    newGaps = [];

    const listRing = toArr(firstOf(st, ['list', 'lists', 'listLen', 'listLens', 'coalescedLens']));
    const listP50 = listRing.length ? median(listRing)
      // Without a per-event ring, mean list length is the honest stand-in.
      : (isNum(st.coalesced) && st.raw > 0 ? st.coalesced / st.raw : NaN);
    const lat = toArr(firstOf(st, ['latency', 'lat']));

    const liftActive = safe(() => NG.Lift && NG.Lift.active, null);
    const lift = liftActive
      ? (safe(() => liftActive.items.length, '?') + ' items' + (isNum(liftActive.ratio) && liftActive.ratio !== 1 ? ' x' + fmt(liftActive.ratio, 2) : '') + (isNum(liftActive.dx) ? ' ' + fmtInt(liftActive.dx) + ',' + fmtInt(liftActive.dy) : ''))
      : 'none';

    const save = Diag.metrics && Diag.metrics.save || {};
    const trace = recording
      ? 'REC ' + fmt(Math.max(0, recording.until - now) / 1000, 1) + ' s  ' + recording.samples.length + ' samples'
      : (Diag.lastTrace ? 'saved ' + Diag.lastTrace.key + ' (' + Diag.lastTrace.n + ')' : 'idle');

    return {
      at: now,
      tier: safe(() => NG.tier, '—'),
      channel: safe(() => sampler && sampler.channel, null),
      secure: env.secure, rawupdate: env.raw, coalescedApi: env.coalesced, predictedApi: env.predicted,
      ua: env.ua, reducedMotion: env.motion,
      dpr: safe(() => window.devicePixelRatio, NaN),
      liveDpr: safe(() => bag && bag.liveDpr && bag.liveDpr(), NaN),
      dprCap: safe(() => wet && wet.dprCap, null),
      desync: safe(() => { const ctx = liveCtx(); return ctx && ctx.getContextAttributes ? !!ctx.getContextAttributes().desynchronized : null; }, null),
      samplesPerSec, lastSamplesPerSec: lastRate,
      listP50, listMax: safe(() => st.listMax, NaN),
      dtMedian: median(toArr(firstOf(st, ['dt', 'dtSamples']))),
      latencyP50: pct(lat, 0.5), latencyP95: pct(lat, 0.95),
      predictedUsed: isNum(st.predictedUsed) ? st.predictedUsed : (cs.predicted || 0),
      kept: cs.kept || 0, rawEvents: cs.raw || 0, coalesced: cs.coalesced || 0, minStepDropped: cs.minStepDropped || 0,
      rafHz: isNum(med) && med > 0 ? 1000 / med : NaN, dropped, frames: frameCount,
      loafSupported: env.loafSupported, loafCount: loaf.count, loafWorstMs: loaf.worst, loafTop: loaf.top,
      paintsPerFrame: isNum(ws.paintsThisFrame) && !isNum(paintsPerFrame) ? ws.paintsThisFrame : paintsPerFrame,
      dirtyPxMedian: median(toArr(ws.dirtyPx)),
      paintMsP95: pct(toArr(ws.paintMs), 0.95),
      pending: safe(() => wet && wet.pending && wet.pending.length, NaN),
      livePaints: c.livePaints || 0, livePaintsSync: c.livePaintsSync || 0,
      lift, lifts: c.lifts || 0,
      save: { payloadMs: save.payloadMs, writeMs: save.writeMs, bytes: save.bytes, at: save.at },
      lastPointerUpAt: Diag.lastPointerUpAt,
      host: hostInfo(),
      predictedTail: !!NG.predictedTail,
      trace, recording: !!recording,
    };
  }

  /* --------------------------- trace recorder -------------------------- */
  // Records every pointer sample the browser delivers (coalesced entries
  // included) independently of the sampler, so a trace shows what the device
  // sent even when the intake drops or ignores a channel. Listeners live only
  // for the duration of the recording.
  function record(seconds) {
    if (recording) return recording.promise;
    const secs = isNum(seconds) && seconds > 0 ? seconds : 10;
    const samples = [];
    const seen = { raw: 0, move: 0 };
    const grab = (kind) => (e) => {
      try {
        if (e.pointerType === 'mouse' && kind !== 'down' && kind !== 'up' && e.buttons === 0) return;
        const list = (kind === 'raw' || kind === 'move') && e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        const evs = list && list.length ? list : [e];
        if (seen[kind] != null) seen[kind]++;
        const now = performance.now();
        for (const ev of evs) {
          samples.push({
            x: ev.clientX, y: ev.clientY, t: ev.timeStamp, p: ev.pressure,
            tiltX: ev.tiltX, tiltY: ev.tiltY, channel: kind, listLen: evs.length,
            type: e.pointerType, id: e.pointerId, now,
          });
        }
      } catch (_) {}
    };
    const handlers = [
      ['pointerdown', grab('down')], ['pointerrawupdate', grab('raw')], ['pointermove', grab('move')],
      ['pointerup', grab('up')], ['pointercancel', grab('cancel')],
    ];
    for (const [ev, fn] of handlers) window.addEventListener(ev, fn, { capture: true, passive: true });
    const off = () => { for (const [ev, fn] of handlers) window.removeEventListener(ev, fn, { capture: true }); };

    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    recording = { until: performance.now() + secs * 1000, samples, off, promise };
    updateButtons();
    tick();
    setTimeout(async () => {
      off();
      const key = 'trace:' + new Date().toISOString();
      const value = {
        at: Date.now(), seconds: secs, ua: safe(() => navigator.userAgent, ''), tier: safe(() => NG.tier, null),
        events: seen, n: samples.length, samples,
      };
      const where = await saveTrace(key, value);
      recording = null;
      Diag.lastTrace = { key, n: samples.length, where };
      updateButtons();
      tick();
      safe(() => bag && bag.toast && bag.toast('Trace saved: ' + samples.length + ' samples (' + where + ')'));
      resolve({ key, n: samples.length, where, value });
    }, secs * 1000);
    return promise;
  }

  // db.js declares DB as a top-level const (a global binding, not a property of
  // globalThis), so it has to be reached by name.
  const dbOf = () => safe(() => (bag && bag.DB) || (typeof DB !== 'undefined' ? DB : null), null);
  async function saveTrace(key, value) {
    const DB = dbOf();
    if (DB && typeof DB.setMeta === 'function') {
      try { await DB.setMeta(key, value); return 'idb'; } catch (e) { console.warn('diag: trace to IDB failed', e); }
    }
    try { localStorage.setItem('ng-' + key, JSON.stringify(value)); return 'localStorage'; }
    catch (e) { console.warn('diag: trace to localStorage failed', e); }
    memTraces.push({ key, value });
    return 'memory';
  }

  // All saved traces as [{key, at, seconds, n, samples, where}], oldest first.
  async function traces() {
    const out = [];
    const DB = dbOf();
    if (DB && typeof DB.getAll === 'function') {
      try {
        for (const rec of await DB.getAll('meta')) {
          if (rec && typeof rec.key === 'string' && rec.key.indexOf('trace:') === 0) out.push(Object.assign({ key: rec.key, where: 'idb' }, rec.value || {}));
        }
      } catch (e) { console.warn('diag: listing IDB traces failed', e); }
    }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('ng-trace:') === 0) out.push(Object.assign({ key: k.slice(3), where: 'localStorage' }, JSON.parse(localStorage.getItem(k) || '{}')));
      }
    } catch (_) {}
    for (const m of memTraces) out.push(Object.assign({ key: m.key, where: 'memory' }, m.value));
    out.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    return out;
  }
})();
