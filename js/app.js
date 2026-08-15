/* ===========================================================================
 * app.js — Notes Gallery UI, canvas, navigation, CRUD.
 * Plain script (no modules) so it runs from file:// on double-click.
 * Depends on the global `DB` from db.js.
 * ========================================================================= */
(() => {
  'use strict';

  // surface any runtime error on-screen instead of failing silently
  function showFatal(msg) {
    let el = document.getElementById('fatal-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fatal-banner';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#7a1420;color:#fff;font:12px/1.5 ui-monospace,Consolas,monospace;padding:9px 14px;white-space:pre-wrap;max-height:45vh;overflow:auto;border-top:2px solid #ff5a5f';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = 'Notes Gallery error — please screenshot this:\n' + msg;
  }
  window.addEventListener('error', (e) => showFatal((e.error && e.error.stack) || e.message || String(e)));
  window.addEventListener('unhandledrejection', (e) => showFatal('(promise) ' + ((e.reason && (e.reason.stack || e.reason.message)) || String(e.reason))));

  /* ---------------------------- helpers -------------------------------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () =>
    (crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + '-' + performance.now().toString(36);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const humanSize = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  };
  const fileKind = (type, name) => {
    if (type && type.startsWith('image/')) return 'image';
    if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
    return 'other';
  };
  const monogram = (t) => { const s = (t || '').trim(); return s ? s.charAt(0).toUpperCase() : 'N'; };

  /* ---- line-icon set (stroke SVGs, sized via CSS .ic) ------------------ */
  const ICON = {
    diary: '<path d="M12 3.4C15 3.4 16.4 5.6 16.2 8L12.6 18.8C12.4 19.6 11.6 19.6 11.4 18.8L7.8 8C7.6 5.6 9 3.4 12 3.4Z"/><line x1="12" y1="10.6" x2="12" y2="18.2"/><circle cx="12" cy="9" r="1.2"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    link: '<line x1="9.5" y1="14.5" x2="14.5" y2="9.5"/><path d="M11 6.5 12 5.5a3.4 3.4 0 0 1 4.8 4.8l-1 1"/><path d="M13 17.5 12 18.5a3.4 3.4 0 0 1-4.8-4.8l1-1"/>',
    frame: '<path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5V8"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"/><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M16 20h2.5a1.5 1.5 0 0 0 1.5-1.5V16"/>',
    moon: '<path d="M20 13.5A7.5 7.5 0 1 1 10.5 4a6 6 0 0 0 9.5 9.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/><line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/><line x1="5.6" y1="5.6" x2="7" y2="7"/><line x1="17" y1="17" x2="18.4" y2="18.4"/><line x1="18.4" y1="5.6" x2="17" y2="7"/><line x1="7" y1="17" x2="5.6" y2="18.4"/>',
    more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
    close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M6.5 7l.8 11.2a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L18.5 7"/>',
    'arrow-right': '<line x1="5" y1="12" x2="17.5" y2="12"/><polyline points="12.5 7 18 12 12.5 17"/>',
    'arrow-left': '<line x1="19" y1="12" x2="6.5" y2="12"/><polyline points="11.5 7 6 12 11.5 17"/>',
    home: '<path d="M3.6 11.3 12 4l8.4 7.3"/><path d="M5.5 10v8.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V10"/><path d="M9.5 19.5V14a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5.5"/>',
    upload: '<path d="M12 15V4.5"/><polyline points="7.5 9 12 4.5 16.5 9"/><path d="M5 16.5v2A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-2"/>',
    download: '<path d="M12 4.5V15"/><polyline points="7.5 10.5 12 15 16.5 10.5"/><path d="M5 17.5v1A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-1"/>',
    external: '<path d="M14 5h5v5"/><line x1="19" y1="5" x2="11.5" y2="12.5"/><path d="M18 13.5v4A1.5 1.5 0 0 1 16.5 19h-9A1.5 1.5 0 0 1 6 17.5v-9A1.5 1.5 0 0 1 7.5 7h4"/>',
    file: '<path d="M13 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V8.5Z"/><polyline points="13 3.5 13 8.5 18 8.5"/>',
    layers: '<path d="M12 3.5 20 8l-8 4.5L4 8Z"/><path d="M4 12l8 4.5L20 12"/>',
    clip: '<path d="M18 11.5 12 17.5a3.5 3.5 0 0 1-5-5l6.5-6.5a2.3 2.3 0 0 1 3.3 3.3L10 15.7a1.1 1.1 0 0 1-1.6-1.6l5.6-5.6"/>',
    pencil: '<path d="M4 20h4L18.5 9.5a1.8 1.8 0 0 0 0-2.5l-1.5-1.5a1.8 1.8 0 0 0-2.5 0L4 16Z"/><line x1="13.5" y1="7" x2="17" y2="10.5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none"/>',
    square: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
    list: '<line x1="9" y1="6.5" x2="20" y2="6.5"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17.5" x2="20" y2="17.5"/><circle cx="4.9" cy="6.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.9" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.9" cy="17.5" r="1.15" fill="currentColor" stroke="none"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4"/><circle cx="12" cy="17.2" r="0.95" fill="currentColor" stroke="none"/>',
    sliders: '<line x1="4" y1="6.5" x2="20" y2="6.5"/><circle cx="15" cy="6.5" r="2.4"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="9" cy="12" r="2.4"/><line x1="4" y1="17.5" x2="20" y2="17.5"/><circle cx="14" cy="17.5" r="2.4"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6A2 2 0 0 0 4 6v7.5A2 2 0 0 0 6 15.5h2.5"/>',
    scissors: '<circle cx="6.5" cy="7" r="2.3"/><circle cx="6.5" cy="17" r="2.3"/><line x1="8.6" y1="8.5" x2="20" y2="16"/><line x1="8.6" y1="15.5" x2="20" y2="8"/>',
    type: '<path d="M5 6.5V5h14v1.5"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="9" y1="19" x2="15" y2="19"/>',
    'align-left': '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="17" x2="18" y2="17"/>',
    'align-center': '<line x1="4" y1="7" x2="20" y2="7"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="17" x2="19" y2="17"/>',
    'align-right': '<line x1="4" y1="7" x2="20" y2="7"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="6" y1="17" x2="20" y2="17"/>',
    shapes: '<rect x="3.5" y="9" width="11" height="11" rx="2"/><circle cx="16.5" cy="8" r="4.3"/>',
    rect: '<rect x="3.5" y="6.5" width="17" height="11" rx="2"/>',
    circle: '<circle cx="12" cy="12" r="8.5"/>',
    triangle: '<path d="M12 4.5 20.5 19H3.5Z"/>',
    star: '<path d="M12 3.6l2.6 5.2 5.8.9-4.2 4.1 1 5.7-5.2-2.7-5.2 2.7 1-5.7L3.6 9.7l5.8-.9z"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17l4.5-4.5 3 3L15 12l5 5"/>',
    front: '<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" stroke="none"/><path d="M4 14V5.5A1.5 1.5 0 0 1 5.5 4H14"/>',
    back: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M10 16h8.5A1.5 1.5 0 0 0 20 14.5V6" fill="none"/><rect x="10" y="10" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
    forward: '<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" stroke="none"/><polyline points="6.5 6 10 9.5 6.5 13" fill="none"/>',
    backward: '<rect x="4" y="4" width="12" height="12" rx="2"/><polyline points="17.5 11 14 14.5 17.5 18" fill="none"/><rect x="10" y="10" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  };
  const FONT_STACK = {
    sans: '"Inter", ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif',
    serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, "Cascadia Code", "Consolas", "Courier New", monospace',
  };
  const ic = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;
  function hydrateIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => {
      if (el.getAttribute('data-icon-done')) return;
      el.innerHTML = ic(el.getAttribute('data-icon'));
      el.setAttribute('data-icon-done', '1');
    });
  }

  const PALETTE = [
    '#2b7fff', // blue
    '#4353ff', // indigo
    '#7c5cff', // violet
    '#a855f7', // purple
    '#ec4899', // pink
    '#f43f5e', // rose
    '#ef4444', // red
    '#f97316', // orange
    '#f5b83d', // amber / yellow
    '#22d3ee', // neon cyan
    '#22c38f', // neon green
    '#14b8a6', // teal
    '#0ea5e9', // sky
    '#8a94a6', // slate
  ];
  const BLOCK_W = 210;
  const BLOCK_H_GUESS = 130;
  const GRID = 26;   // world-units grid step (matches the dot grid)
  let snapOn = false;
  try { snapOn = localStorage.getItem('ng-snap') === '1'; } catch (_) {}
  const snapVal = (v) => snapOn ? Math.round(v / GRID) * GRID : Math.round(v);

  /* ---------------------------- app state ------------------------------ */
  const state = {
    ws: null,                // current workspace id (null = on landing screen)
    wsName: '',              // current workspace name
    autosave: true,          // autosave changes to the bound file
    dirty: false,            // unsaved changes (when autosave is off)
    level: DB.ROOT,          // current parent id being viewed
    navStack: [],            // history of visited levels (for back/forward)
    navIndex: -1,
    levelBlock: null,        // the block we're inside (null at root)
    levelLayout: 'canvas',   // 'canvas' | 'list' — how this level shows children
    path: [{ id: DB.ROOT, title: 'Home' }],
    blocks: [],              // blocks at current level
    edges: [],               // edges at current level
    childCounts: {},         // blockId -> {blocks, files}
    childPeek: {},           // blockId -> [{title,color}] first few children (for list previews)
    selectedIds: new Set(),  // multi-selection (canvas)
    view: { scale: 1, tx: 60, ty: 40 },
    linkMode: false,
    linkSrc: null,
    els: {},                 // blockId -> DOM element
  };

  const stage  = $('#stage');
  const world  = $('#world');
  const svg    = $('#edge-layer');

  /* ---------------------------- viewport ------------------------------- */
  function applyView() {
    const { scale, tx, ty } = state.view;
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    stage.style.backgroundSize = `${26 * scale}px ${26 * scale}px`;
    stage.style.backgroundPosition = `${tx}px ${ty}px`;
    const pct = Math.round(scale * 100) + '%';
    $('#btn-zoom-reset').textContent = pct;
  }
  const screenToWorld = (sx, sy) => ({
    x: (sx - state.view.tx) / state.view.scale,
    y: (sy - state.view.ty) / state.view.scale,
  });
  function zoomAt(sx, sy, factor) {
    const before = screenToWorld(sx, sy);
    state.view.scale = clamp(state.view.scale * factor, 0.25, 2.5);
    // keep the world point under the cursor fixed
    state.view.tx = sx - before.x * state.view.scale;
    state.view.ty = sy - before.y * state.view.scale;
    applyView();
  }
  function centerOfView() {
    const r = stage.getBoundingClientRect();
    return screenToWorld(r.width / 2, r.height / 2);
  }

  /* ---------------------------- data load ------------------------------ */
  async function loadLevel(levelId, opts = {}) {
    state.level = levelId;
    state.levelBlock = levelId === DB.ROOT ? null : await DB.getBlock(levelId);
    state.levelLayout = (state.levelBlock && state.levelBlock.layout === 'list') ? 'list' : 'canvas';
    state.blocks = await DB.childBlocks(levelId, state.ws);
    state.edges = await DB.levelEdges(levelId, state.ws);
    state.path = await DB.buildPath(levelId === DB.ROOT ? null : levelId);
    state.selectedIds.clear();
    // per-block counts + item previews for cards
    state.childCounts = {};
    state.childPeek = {};
    await Promise.all(state.blocks.map(async b => {
      const [kids, files] = await Promise.all([DB.childBlocks(b.id), DB.blockFiles(b.id)]);
      state.childCounts[b.id] = { blocks: kids.length, files: files.length };
      kids.sort((a, c) => (a.createdAt || 0) - (c.createdAt || 0));
      state.childPeek[b.id] = kids.slice(0, 4).map(k => ({ title: k.title, color: k.color }));
    }));

    const listMode = state.levelLayout === 'list';
    document.getElementById('app').classList.toggle('list-mode', listMode);
    stage.classList.toggle('list-mode', listMode);
    $('#world').hidden = listMode;
    $('#list-view').hidden = !listMode;
    if (state.linkMode && listMode) setLinkMode(false);

    renderBreadcrumbs();
    if (listMode) {
      $('#empty-hint').hidden = true;
      renderList();
    } else {
      renderBlocks();
      if (opts.fit) fitToView(); else applyView();
      drawEdges();
    }
    saveLoc();
    updateNavButtons();
  }

  /* ---------------------------- render blocks -------------------------- */
  function renderBlocks() {
    // wipe existing block nodes (keep the svg)
    $$('.block', world).forEach(n => n.remove());
    state.els = {};
    for (const b of state.blocks) world.appendChild(makeBlockEl(b));
    $('#empty-hint').hidden = state.blocks.length !== 0;
  }

  function makeBlockEl(b) {
    const el = document.createElement('div');
    el.className = 'block'
      + (b.kind === 'text' ? ' block-text' : '')
      + (b.kind === 'shape' ? ' block-shape' : '')
      + (b.kind === 'image' ? ' block-image' : '');
    el.dataset.id = b.id;
    el.style.left = b.x + 'px';
    el.style.top = b.y + 'px';
    if (b.z) el.style.zIndex = b.z;
    if (b.kind === 'text') paintTextNode(el, b);
    else if (b.kind === 'shape') paintShapeNode(el, b);
    else if (b.kind === 'image') paintImageNode(el, b);
    else { el.style.setProperty('--b-accent', b.color || PALETTE[0]); paintBlock(el, b); }
    state.els[b.id] = el;
    return el;
  }

  // free image node (kind === 'image'); src is a data URL stored on the block
  function paintImageNode(el, b) {
    const w = b.w || 200, h = b.h || 150;
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.transform = b.rot ? `rotate(${b.rot}deg)` : '';
    el.innerHTML =
      `<img class="img-content" alt="" draggable="false" style="border-radius:${b.round ? 12 : 0}px" />` +
      `<div class="block-actions"><button class="blk-btn" data-blk="edit" title="Edit image">${ic('pencil')}</button></div>` +
      `<div class="tnode-rotate" title="Rotate"></div>` +
      `<div class="tnode-resize" title="Resize"></div>`;
    el.querySelector('.img-content').src = b.src || '';
  }

  // free vector shape node (kind === 'shape'), drawn with inline SVG so fill
  // and outline follow the shape exactly.
  function shapePoints(b) {
    if (b.shape === 'triangle') return [[0.5, 0], [1, 1], [0, 1]];
    if (b.shape === 'polygon') {
      if (Array.isArray(b.points) && b.points.length >= 3) return b.points;
      return [[0.5, 0], [1, 0.38], [0.82, 1], [0.18, 1], [0, 0.38]];   // pentagon
    }
    return null;
  }
  function paintShapeNode(el, b) {
    const w = b.w || 150, h = b.h || 100;
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.transform = b.rot ? `rotate(${b.rot}deg)` : '';
    const fill = b.fill ? (b.color || PALETTE[0]) : 'none';
    const outline = !!b.outline;
    const stroke = outline ? (b.outlineColor || PALETTE[0]) : 'none';
    const sw = outline ? (b.outlineW || 2) : 0;
    const pad = sw / 2 + 0.5;
    let inner;
    const pts = shapePoints(b);
    if (b.shape === 'circle') {
      inner = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(1, w / 2 - pad)}" ry="${Math.max(1, h / 2 - pad)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    } else if (pts) {
      const poly = pts.map(([x, y]) => `${(pad + x * (w - 2 * pad)).toFixed(1)},${(pad + y * (h - 2 * pad)).toFixed(1)}`).join(' ');
      inner = `<polygon points="${poly}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    } else {
      inner = `<rect x="${pad}" y="${pad}" width="${Math.max(1, w - 2 * pad)}" height="${Math.max(1, h - 2 * pad)}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    }
    el.innerHTML =
      `<svg class="shape-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>` +
      `<div class="block-actions"><button class="blk-btn" data-blk="edit" title="Edit shape">${ic('pencil')}</button></div>` +
      `<div class="tnode-rotate" title="Rotate"></div>` +
      `<div class="tnode-resize" title="Resize"></div>`;
  }

  function paintBlock(el, b) {
    const c = state.childCounts[b.id] || { blocks: 0, files: 0 };
    const isList = b.layout === 'list';
    el.classList.toggle('is-list', isList);
    const meta = [];
    if (!isList && c.blocks) meta.push(`<span class="chip">${ic('layers')}${c.blocks}</span>`);
    if (c.files) meta.push(`<span class="chip">${ic('clip')}${c.files}</span>`);
    if (b.notes && b.notes.trim()) meta.push(`<span class="chip">${ic('pencil')}</span>`);
    const iconInner = isList ? ic('list') : esc(monogram(b.title));
    const body = isList
      ? peekHtml(b.id)
      : `${b.description ? `<div class="block-desc">${esc(b.description)}</div>` : ''}
         ${(!b.description && b.notes) ? `<div class="block-notes-peek">${esc(b.notes.slice(0,140))}</div>` : ''}`;
    const metaHtml = meta.length ? meta.join('') : (isList ? '' : '<span class="chip muted">empty</span>');
    el.innerHTML = `
      <div class="block-actions">
        <button class="blk-btn" data-blk="edit" title="Edit">${ic('pencil')}</button>
        <button class="blk-btn" data-blk="open" title="Open inside">${ic('arrow-right')}</button>
      </div>
      <div class="block-head">
        <div class="block-ico">${iconInner}</div>
        <div class="block-title">${esc(b.title || 'Untitled block')}</div>
      </div>
      ${body}
      ${metaHtml ? `<div class="block-meta">${metaHtml}</div>` : ''}`;
  }

  // mini preview of a list's items (shown on list-type cards)
  function peekHtml(id) {
    const items = state.childPeek[id] || [];
    const n = (state.childCounts[id] || {}).blocks || 0;
    if (!n) return `<div class="block-peek"><div class="peek-empty">Empty list</div></div>`;
    const rows = items.slice(0, 4).map(k =>
      `<div class="peek-row"><span class="peek-dot" style="background:${esc(k.color || PALETTE[0])}"></span><span class="peek-t">${esc(k.title || 'Untitled')}</span></div>`
    ).join('');
    const more = n > 4 ? `<div class="peek-more">+${n - 4} more</div>` : '';
    return `<div class="block-peek">${rows}${more}</div>`;
  }
  function peekText(id) {
    const items = state.childPeek[id] || [];
    const n = (state.childCounts[id] || {}).blocks || 0;
    if (!n) return 'Empty list';
    const names = items.slice(0, 3).map(k => k.title || 'Untitled').join(' · ');
    return n > 3 ? `${names} +${n - 3}` : names;
  }

  // free text node (kind === 'text')
  function paintTextNode(el, b) {
    el.style.transform = b.rot ? `rotate(${b.rot}deg)` : '';
    el.classList.toggle('glow', !!b.glow);
    el.style.setProperty('--glow-col', b.glowColor || 'var(--accent)');
    el.innerHTML =
      `<div class="text-content"></div>` +
      `<div class="block-actions"><button class="blk-btn" data-blk="edit" title="Edit text">${ic('pencil')}</button></div>` +
      `<div class="tnode-rotate" title="Rotate"></div>` +
      `<div class="tnode-resize" title="Resize"></div>`;
    // Set styles via DOM props — the font stacks contain double quotes, which
    // would break a string-interpolated style="..." attribute.
    const tc = el.querySelector('.text-content');
    tc.textContent = b.text || 'Text';
    const s = tc.style;
    s.fontFamily = FONT_STACK[b.font] || FONT_STACK.sans;
    s.fontSize = (b.size || 20) + 'px';
    s.fontWeight = b.bold ? '700' : '400';
    s.fontStyle = b.italic ? 'italic' : 'normal';
    s.textAlign = b.align || 'left';
    s.color = b.color ? b.color : 'var(--text)';
    if (b.orient === 'v') { s.writingMode = 'vertical-rl'; s.textOrientation = 'mixed'; }
    else { s.writingMode = ''; s.textOrientation = ''; }
  }

  function refreshBlockCard(id) {
    const el = state.els[id];
    const b = state.blocks.find(x => x.id === id);
    if (!el || !b) return;
    if (b.kind === 'text') { paintTextNode(el, b); }
    else if (b.kind === 'shape') { paintShapeNode(el, b); }
    else if (b.kind === 'image') { paintImageNode(el, b); }
    else { paintBlock(el, b); el.style.setProperty('--b-accent', b.color || PALETTE[0]); }
  }

  // Update whichever representation (canvas card or list row) exists for a block.
  function refreshItem(id) {
    if (state.levelLayout === 'list') {
      const row = $(`.list-row[data-id="${id}"]`);
      const b = state.blocks.find(x => x.id === id);
      if (row && b) {
        const wrap = document.createElement('div');
        wrap.innerHTML = listRowHtml(b);
        const next = wrap.firstElementChild;
        if (state.selectedIds.has(id)) next.classList.add('selected');
        row.replaceWith(next);
      }
    } else {
      refreshBlockCard(id);
    }
  }

  /* ---------------------------- list view ------------------------------ */
  function listRowHtml(b) {
    if (b.kind === 'text') {
      return `<div class="list-row" data-id="${esc(b.id)}" style="--b-accent:${esc(b.color || 'var(--accent)')}">
          <div class="lr-ico">${ic('type')}</div>
          <div class="lr-main"><div class="lr-title">${esc((b.text || 'Text').slice(0, 80))}</div>
          <div class="lr-sub">Text</div></div>
          <div class="lr-actions"><button class="lr-btn" data-edit="${esc(b.id)}" title="Edit text">${ic('pencil')}</button></div>
        </div>`;
    }
    if (b.kind === 'image' || b.kind === 'shape') {
      const isImg = b.kind === 'image';
      return `<div class="list-row" data-id="${esc(b.id)}" style="--b-accent:${esc(b.color || 'var(--accent)')}">
          <div class="lr-ico">${ic(isImg ? 'image' : 'shapes')}</div>
          <div class="lr-main"><div class="lr-title">${isImg ? 'Image' : 'Shape'}</div>
          <div class="lr-sub">${isImg ? 'Picture' : (b.shape || 'shape')}</div></div>
          <div class="lr-actions"><button class="lr-btn" data-edit="${esc(b.id)}" title="Edit">${ic('pencil')}</button></div>
        </div>`;
    }
    const c = state.childCounts[b.id] || { blocks: 0, files: 0 };
    const isList = b.layout === 'list';
    const meta = [];
    if (isList) meta.push(`<span class="chip">${ic('list')}${c.blocks} item${c.blocks === 1 ? '' : 's'}</span>`);
    else if (c.blocks) meta.push(`<span class="chip">${ic('layers')}${c.blocks}</span>`);
    if (c.files) meta.push(`<span class="chip">${ic('clip')}${c.files}</span>`);
    if (b.notes && b.notes.trim()) meta.push(`<span class="chip">${ic('pencil')}</span>`);
    const sub = isList ? peekText(b.id) : (b.description || (b.notes ? b.notes.slice(0, 120) : ''));
    const iconInner = isList ? ic('list') : esc(monogram(b.title));
    return `<div class="list-row" data-id="${esc(b.id)}" style="--b-accent:${esc(b.color || PALETTE[0])}">
        <div class="lr-ico">${iconInner}</div>
        <div class="lr-main">
          <div class="lr-title">${esc(b.title || 'Untitled')}</div>
          ${sub ? `<div class="lr-sub">${esc(sub)}</div>` : ''}
          ${meta.length ? `<div class="lr-meta">${meta.join('')}</div>` : ''}
        </div>
        <div class="lr-actions">
          <button class="lr-btn" data-edit="${esc(b.id)}" title="Edit">${ic('pencil')}</button>
          <button class="lr-btn" data-open="${esc(b.id)}" title="Open inside">${ic('arrow-right')}</button>
        </div>
      </div>`;
  }

  function renderList() {
    const view = $('#list-view');
    const items = state.blocks.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const title = (state.levelBlock && state.levelBlock.title) || 'List';
    const head = `<div class="list-head"><div class="list-head-main">
        <span class="list-head-ico" data-icon="list"></span>
        <div><div class="list-head-title">${esc(title)}</div>
        <div class="list-head-sub">${items.length} item${items.length === 1 ? '' : 's'}</div></div>
      </div></div>`;
    const rows = items.map(listRowHtml).join('');
    const body = rows
      ? `<div class="list-rows">${rows}</div>`
      : `<div class="list-empty">No items yet. Add your first one below.</div>`;
    const add = `<button class="list-add" id="list-add"><span data-icon="plus"></span>Add item</button>`;
    view.innerHTML = head + body + add;
    hydrateIcons(view);
  }

  /* ---------------------------- edges ---------------------------------- */
  function blockRect(id) {
    const b = state.blocks.find(x => x.id === id);
    if (!b) return null;
    const el = state.els[id];
    const w = el ? el.offsetWidth : BLOCK_W;
    const h = el ? el.offsetHeight : BLOCK_H_GUESS;
    return { x: b.x, y: b.y, w, h, cx: b.x + w / 2, cy: b.y + h / 2 };
  }
  // where the line from `other` should touch the border of `rect`
  function borderPoint(rect, towards) {
    const dx = towards.cx - rect.cx, dy = towards.cy - rect.cy;
    if (dx === 0 && dy === 0) return { x: rect.cx, y: rect.cy };
    const hw = rect.w / 2, hh = rect.h / 2;
    const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
    const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
    const t = Math.min(sx, sy);
    return { x: rect.cx + dx * t, y: rect.cy + dy * t };
  }
  function drawEdges() {
    if (state.levelLayout === 'list') return;
    $$('g.edge-g', svg).forEach(n => n.remove());
    for (const e of state.edges) {
      const a = blockRect(e.from), b = blockRect(e.to);
      if (!a || !b) continue;
      const p1 = borderPoint(a, b), p2 = borderPoint(b, a);
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const d = `M ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y}`;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'edge-g');
      g.innerHTML =
        `<path class="hit" d="${d}"></path>` +
        `<path class="edge" d="${d}" marker-end="url(#arrow)"></path>`;
      g.addEventListener('click', (ev) => { ev.stopPropagation(); askDeleteEdge(e); });
      svg.appendChild(g);
    }
  }

  function askDeleteEdge(e) {
    confirmDialog('Remove connection?', 'This deletes the arrow between these two blocks.', 'Remove', async () => {
      await DB.delEdge(e.id);
      state.edges = state.edges.filter(x => x.id !== e.id);
      recordChange({ blocks: [], edges: [{ ...e }], files: [] }, emptySet());
      drawEdges();
      toast('Connection removed');
    });
  }

  /* ---------------------------- breadcrumbs ---------------------------- */
  function renderBreadcrumbs() {
    const nav = $('#breadcrumbs');
    nav.innerHTML = '';
    state.path.forEach((p, i) => {
      if (i) { const s = document.createElement('span'); s.className = 'crumb-sep'; s.textContent = '›'; nav.appendChild(s); }
      const b = document.createElement('button');
      b.className = 'crumb' + (i === state.path.length - 1 ? ' current' : '');
      b.textContent = i === 0 ? (state.wsName || 'Home') : (p.title || 'Untitled');
      b.title = p.title || '';
      b.addEventListener('click', () => navigateTo(p.id));
      nav.appendChild(b);
    });
  }

  // Central level navigation with back/forward history.
  async function goToLevel(levelId, opts = {}) {
    const push = opts.push !== false;
    if (push) {
      state.navStack = state.navStack.slice(0, state.navIndex + 1);
      if (state.navStack[state.navIndex] !== levelId) {
        state.navStack.push(levelId);
        state.navIndex = state.navStack.length - 1;
      }
    }
    await loadLevel(levelId, { fit: true });
    updateNavButtons();
  }
  async function navigateTo(levelId) {
    closeDrawer();
    await goToLevel(levelId, { push: true });
  }
  function initNav(levelId) {
    state.navStack = [levelId];
    state.navIndex = 0;
    updateNavButtons();
  }
  async function navBack() {
    if (state.navIndex <= 0) return;
    state.navIndex--;
    closeDrawer();
    await goToLevel(state.navStack[state.navIndex], { push: false });
  }
  async function navForward() {
    if (state.navIndex >= state.navStack.length - 1) return;
    state.navIndex++;
    closeDrawer();
    await goToLevel(state.navStack[state.navIndex], { push: false });
  }
  function updateNavButtons() {
    const back = $('#btn-back'), fwd = $('#btn-forward'), home = $('#btn-home');
    if (back) back.disabled = state.navIndex <= 0;
    if (fwd) fwd.disabled = state.navIndex >= state.navStack.length - 1;
    if (home) home.disabled = state.level === DB.ROOT;
  }

  /* ---------------------------- CRUD ----------------------------------- */
  async function createBlock(type = 'block', at) {
    flushEdit();
    const isText = type === 'text';
    const isShape = type === 'shape';
    const layout = type === 'list' ? 'list' : 'canvas';
    const b = {
      id: uid(),
      ws: state.ws,
      parentId: state.level,
      title: (isText || isShape) ? '' : (layout === 'list' ? 'New list' : 'New block'),
      description: '',
      notes: '',
      layout,
      color: isText ? '' : PALETTE[state.blocks.length % PALETTE.length],
      icon: '',
      x: 0, y: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (isText) { b.kind = 'text'; b.text = 'Text'; b.font = 'sans'; b.size = 22; b.bold = false; b.italic = false; b.align = 'left'; b.orient = 'h'; b.rot = 0; b.glow = false; b.glowColor = ''; }
    if (isShape) { b.kind = 'shape'; b.shape = 'rectangle'; b.w = 150; b.h = 100; b.points = null; b.fill = true; b.outline = false; b.outlineW = 3; b.outlineColor = PALETTE[0]; b.rot = 0; }
    if (state.levelLayout === 'canvas') {
      const pos = at || centerOfView();
      const halfW = isText ? 20 : isShape ? b.w / 2 : BLOCK_W / 2;
      const halfH = isText ? 12 : isShape ? b.h / 2 : 30;
      b.x = Math.round(pos.x - halfW);
      b.y = Math.round(pos.y - halfH);
    }
    await DB.saveBlock(b);
    state.blocks.push(b);
    state.childCounts[b.id] = { blocks: 0, files: 0 };
    recordChange(emptySet(), { blocks: [b], edges: [], files: [] });
    if (state.levelLayout === 'list') {
      renderList();
    } else {
      world.appendChild(makeBlockEl(b));
      $('#empty-hint').hidden = true;
    }
    if (isText) openTextEditor(b.id);
    else if (isShape) openShapeEditor(b.id);
    else openEditor(b.id, true);
    toast(isText ? 'Text added' : isShape ? 'Shape added' : (layout === 'list' ? 'List added' : 'Block added'));
  }

  async function persistBlock(b) {
    b.updatedAt = Date.now();
    await DB.saveBlock(b);
  }

  /* ---------------------------- image node ----------------------------- */
  let pendingImageAt = null;     // world position for the next picked image
  let replaceImageId = null;     // when set, the picked file replaces this node's src
  const readAsDataUrl = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const loadImageSize = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth || 200, h: im.naturalHeight || 150 }); im.onerror = () => res({ w: 200, h: 150 }); im.src = src; });

  function pickImage(at) {
    if (state.levelLayout !== 'canvas') { toast('Open a canvas block to add an image here.'); return; }
    pendingImageAt = at || centerOfView();
    replaceImageId = null;
    $('#image-input').click();
  }
  async function createImageBlock(file, opts = {}) {
    if (!file || !/^image\//.test(file.type)) { toast('That file is not an image.'); return null; }
    const src = await readAsDataUrl(file);
    const nat = await loadImageSize(src);
    const maxW = 300;
    const scale = nat.w > maxW ? maxW / nat.w : 1;
    const w = Math.round(nat.w * scale), h = Math.round(nat.h * scale);
    const pos = opts.at || pendingImageAt || centerOfView();
    const b = {
      id: uid(), ws: state.ws, parentId: state.level, kind: 'image',
      title: '', description: '', notes: '', layout: 'canvas', color: '', icon: '',
      src, w, h, rot: 0, round: false,
      x: Math.round(pos.x - w / 2), y: Math.round(pos.y - h / 2),
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    await DB.saveBlock(b);
    state.blocks.push(b);
    state.childCounts[b.id] = { blocks: 0, files: 0 };
    recordChange(emptySet(), { blocks: [b], edges: [], files: [] });
    world.appendChild(makeBlockEl(b));
    $('#empty-hint').hidden = true;
    if (opts.openAfter !== false) openImageEditor(b.id);
    else selectBlock(b.id);
    return b;
  }

  // Paste an image from the clipboard (Ctrl+V of a copied picture / screenshot).
  function bindImagePaste() {
    window.addEventListener('paste', async (e) => {
      if (state.ws == null || state.levelLayout !== 'canvas') return;
      const t = document.activeElement;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;   // let text fields paste normally
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const imgs = [];
      for (const it of items) { if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) imgs.push(f); } }
      if (!imgs.length) return;               // no image on the clipboard → let block-paste handle it
      e.preventDefault();
      // drop at the cursor if it's over the canvas, else at the view centre
      const r = stage.getBoundingClientRect();
      const p = lastPointer;
      const overStage = p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
      const c = overStage ? screenToWorld(p.x - r.left, p.y - r.top) : centerOfView();
      let i = 0;
      for (const f of imgs) { await createImageBlock(f, { at: { x: c.x + i * 24, y: c.y + i * 24 }, openAfter: false }); i++; }
      toast(imgs.length > 1 ? `${imgs.length} images pasted` : 'Image pasted');
    });
  }

  // Drop image files onto the canvas (from the OS or another app).
  async function dropImageFiles(fileList, clientX, clientY) {
    const imgs = Array.from(fileList).filter(f => /^image\//.test(f.type));
    if (!imgs.length) return;
    if (state.ws == null || state.levelLayout !== 'canvas') { toast('Open a canvas to drop images.'); return; }
    const r = stage.getBoundingClientRect();
    const base = screenToWorld(clientX - r.left, clientY - r.top);
    let i = 0;
    for (const f of imgs) {
      await createImageBlock(f, { at: { x: base.x + i * 24, y: base.y + i * 24 }, openAfter: false });
      i++;
    }
    toast(imgs.length > 1 ? `${imgs.length} images added` : 'Image added');
  }

  /* ---------------------------- undo / redo ---------------------------- */
  // Each history entry stores a `before` and `after` set of records
  // {blocks,edges,files}. Undo makes the DB match `before`, redo `after`.
  // History is per workspace session (cleared on open/home).
  const history = { past: [], future: [], limit: 200 };
  const cloneRec = (r) => ({ ...r });      // shallow clone (keeps file Blob refs)
  const emptySet = () => ({ blocks: [], edges: [], files: [] });
  const cloneSet = (s) => ({
    blocks: (s.blocks || []).map(cloneRec),
    edges: (s.edges || []).map(cloneRec),
    files: (s.files || []).map(cloneRec),
  });
  function recordChange(before, after) {
    history.past.push({ level: state.level, before: cloneSet(before), after: cloneSet(after) });
    if (history.past.length > history.limit) history.past.shift();
    history.future.length = 0;
    markChanged();
  }
  function clearHistory() { history.past.length = 0; history.future.length = 0; }

  async function putAll(recs) {
    for (const b of recs.blocks) await DB.saveBlock(b);
    for (const e of recs.edges) await DB.saveEdge(e);
    for (const f of recs.files) await DB.saveFile(f);
  }
  async function applyDelta(target, other) {
    await putAll(target);
    const hb = new Set(target.blocks.map(x => x.id));
    const he = new Set(target.edges.map(x => x.id));
    const hf = new Set(target.files.map(x => x.id));
    for (const b of other.blocks) if (!hb.has(b.id)) await DB.del('blocks', b.id);
    for (const e of other.edges) if (!he.has(e.id)) await DB.delEdge(e.id);
    for (const f of other.files) if (!hf.has(f.id)) await DB.delFile(f.id);
  }
  async function undo() {
    const entry = history.past.pop();
    if (!entry) { toast('Nothing to undo'); return; }
    await applyDelta(entry.before, entry.after);
    history.future.push(entry);
    await refreshAfterHistory(entry);
    markChanged();
    toast('Undone');
  }
  async function redo() {
    const entry = history.future.pop();
    if (!entry) { toast('Nothing to redo'); return; }
    await applyDelta(entry.after, entry.before);
    history.past.push(entry);
    await refreshAfterHistory(entry);
    markChanged();
    toast('Redone');
  }
  async function refreshAfterHistory(entry) {
    closeDrawer();
    let level = entry.level;
    if (level !== DB.ROOT) { const lb = await DB.getBlock(level); if (!lb) level = DB.ROOT; }
    await loadLevel(level, {});
  }

  // Everything deleteBlockDeep would remove for these ids (for undo capture).
  async function gatherRemoval(ids) {
    const set = new Set();
    const blocks = [], files = [];
    const collect = async (id) => {
      if (set.has(id)) return;
      set.add(id);
      const b = await DB.getBlock(id);
      if (!b) return;
      blocks.push(b);
      const fs = await DB.blockFiles(id);
      files.push(...fs);
      const kids = await DB.childBlocks(id);
      for (const k of kids) await collect(k.id);
    };
    for (const id of ids) await collect(id);
    const allEdges = await DB.getAll('edges');
    const edges = allEdges.filter(e => set.has(e.from) || set.has(e.to));
    return { blocks, edges, files };
  }

  /* ---------------------------- z-order -------------------------------- */
  // Bring the given ids to the front (or back) by rewriting their `z` above
  // (below) every sibling on this level. Records one undo entry.
  async function reorderZ(ids, toFront) {
    if (!ids || !ids.length) return;
    const zs = state.blocks.map(b => b.z || 0);
    const top = zs.length ? Math.max(...zs) : 0;
    const bottom = zs.length ? Math.min(...zs) : 0;
    const idset = new Set(ids);
    // keep the selected group's relative order stable
    const moving = state.blocks.filter(b => idset.has(b.id));
    const before = { blocks: moving.map(b => ({ ...b })), edges: [], files: [] };
    let base = toFront ? top + 1 : bottom - moving.length;
    moving.forEach((b, i) => {
      b.z = toFront ? base + i : base + i;
      const el = state.els[b.id]; if (el) el.style.zIndex = b.z;
    });
    for (const b of moving) await persistBlock(b);
    recordChange(before, { blocks: moving.map(b => ({ ...b })), edges: [], files: [] });
    drawEdges();
  }
  const bringToFront = (ids) => reorderZ(ids, true);
  const sendToBack = (ids) => reorderZ(ids, false);

  // Move the given ids ONE step forward/backward in the stack (swap with the
  // neighbour just above/below). Normalizes z to a contiguous order first.
  async function stepZ(ids, toFront) {
    if (!ids || !ids.length) return;
    const dir = toFront ? 1 : -1;
    const origZ = new Map(state.blocks.map(b => [b.id, b.z || 0]));
    const sorted = [...state.blocks].sort((a, b) => ((a.z || 0) - (b.z || 0)) || ((a.createdAt || 0) - (b.createdAt || 0)));
    sorted.forEach((b, i) => { b.z = i; });                 // contiguous 0..n-1
    const idset = new Set(ids);
    const n = sorted.length;
    const orderIdx = dir > 0 ? [...Array(n).keys()].reverse() : [...Array(n).keys()];
    for (const i of orderIdx) {
      const b = sorted[i]; if (!idset.has(b.id)) continue;
      const j = i + dir; if (j < 0 || j >= n) continue;
      const other = sorted[j]; if (idset.has(other.id)) continue;   // don't swap within the group
      const tz = b.z; b.z = other.z; other.z = tz;
      sorted[i] = other; sorted[j] = b;
    }
    const before = { blocks: [], edges: [], files: [] }, after = { blocks: [], edges: [], files: [] };
    for (const b of state.blocks) {
      if ((b.z || 0) !== (origZ.get(b.id) || 0)) {
        before.blocks.push({ ...b, z: origZ.get(b.id) || 0 });
        after.blocks.push({ ...b });
        const el = state.els[b.id]; if (el) el.style.zIndex = b.z;
        await persistBlock(b);
      }
    }
    if (!after.blocks.length) return;
    recordChange(before, after);
    drawEdges();
  }
  const bringForward = (ids) => stepZ(ids, true);
  const sendBackward = (ids) => stepZ(ids, false);

  /* ---------------------------- arrow-key nudge ------------------------ */
  let nudge = null;   // { before:Map<id,{x,y}>, timer }
  function nudgeSelection(dx, dy) {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    if (!nudge) {
      const before = new Map();
      ids.forEach(id => { const b = state.blocks.find(x => x.id === id); if (b) before.set(id, { x: b.x, y: b.y }); });
      nudge = { before, timer: null };
    }
    for (const id of ids) {
      const b = state.blocks.find(x => x.id === id); if (!b) continue;
      b.x += dx; b.y += dy;
      const el = state.els[id]; if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; }
    }
    drawEdges();
    clearTimeout(nudge.timer);
    nudge.timer = setTimeout(commitNudge, 450);
  }
  async function commitNudge() {
    if (!nudge) return;
    const before = { blocks: [], edges: [], files: [] }, after = { blocks: [], edges: [], files: [] };
    for (const [id, pos] of nudge.before) {
      const b = state.blocks.find(x => x.id === id); if (!b) continue;
      if (b.x === pos.x && b.y === pos.y) continue;
      before.blocks.push({ ...b, x: pos.x, y: pos.y });
      after.blocks.push({ ...b });
      await persistBlock(b);
    }
    nudge = null;
    if (after.blocks.length) recordChange(before, after);
  }

  function deleteBlock(id) {
    const b = state.blocks.find(x => x.id === id);
    if (!b) return;
    const label = b.kind === 'text'
      ? (b.text ? `“${b.text.slice(0, 24)}”` : 'this text')
      : `“${b.title || 'Untitled'}”`;
    const c = state.childCounts[id] || {};
    const extra = (c.blocks || c.files)
      ? ` It contains ${c.blocks || 0} inner block(s) and ${c.files || 0} file(s) — all will be removed.`
      : '';
    confirmDialog(`Delete ${label}?`, 'You can undo this with Ctrl+Z.' + extra, 'Delete', async () => {
      const removal = await gatherRemoval([id]);
      await DB.deleteBlockDeep(id);
      recordChange(removal, emptySet());
      closeDrawer(); closeTextEditor();
      await loadLevel(state.level);
      toast(b.kind === 'text' ? 'Text deleted' : 'Block deleted');
    });
  }

  /* ---------------------------- selection / drawer --------------------- */
  // Single-click = select (highlight only). Shift+click toggles into a
  // multi-selection; right-drag marquee-selects. Editing is via the edit
  // button / openEditor(); opening the inner canvas is double-click / open btn.
  function applySelectionClasses() {
    $$('.block, .list-row').forEach(n => n.classList.toggle('selected', state.selectedIds.has(n.dataset.id)));
  }
  function selectBlock(id) {              // replace selection with just this one
    state.selectedIds = new Set([id]);
    applySelectionClasses();
  }
  function toggleSelect(id) {             // shift+click
    if (state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
    applySelectionClasses();
  }
  function setSelection(ids) {
    state.selectedIds = new Set(ids);
    applySelectionClasses();
  }
  function clearSelection() {
    state.selectedIds.clear();
    applySelectionClasses();
  }
  function openEditor(id, focusTitle) {
    selectBlock(id);
    openDrawer(id, focusTitle);
  }

  function deleteSelected() {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    if (ids.length === 1) { deleteBlock(ids[0]); return; }
    confirmDialog(`Delete ${ids.length} blocks?`,
      'This removes them and everything inside them. You can undo with Ctrl+Z.', 'Delete', async () => {
        const removal = await gatherRemoval(ids);
        for (const id of ids) await DB.deleteBlockDeep(id);
        recordChange(removal, emptySet());
        closeDrawer(); closeTextEditor();
        await loadLevel(state.level);
        toast(`${ids.length} blocks deleted`);
      });
  }

  /* ---------------------------- copy / paste --------------------------- */
  // Clipboard holds a DEEP snapshot: the selected blocks, every descendant,
  // all edges between them (at each level), and all attached files.
  let clipboard = null;   // { roots:[id], blocks:[], edges:[], files:[] }

  async function copySelection(silent) {
    if (drawerBlock) await persistBlock(drawerBlock);   // flush any pending edit
    const ids = [...state.selectedIds];
    if (!ids.length) return false;
    const blocks = [], edges = [], files = [], seen = new Set();
    async function gather(id) {
      if (seen.has(id)) return;
      seen.add(id);
      const b = await DB.getBlock(id);
      if (!b) return;
      blocks.push(b);
      const [kids, fs, es] = await Promise.all([DB.childBlocks(id), DB.blockFiles(id), DB.levelEdges(id)]);
      files.push(...fs);
      edges.push(...es);                       // connectors among this block's children
      for (const k of kids) await gather(k.id);
    }
    for (const id of ids) await gather(id);
    // connectors between the selected top-level blocks themselves
    const sel = new Set(ids);
    const sibEdges = (await DB.levelEdges(state.level)).filter(e => sel.has(e.from) && sel.has(e.to));
    edges.push(...sibEdges);
    clipboard = { roots: ids.slice(), blocks, edges, files };
    if (!silent) toast(`Copied ${ids.length} block${ids.length > 1 ? 's' : ''}`);
    return true;
  }

  // Cut = copy into the clipboard, then remove (no confirm; undoable).
  async function cutSelection() {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    await copySelection(true);
    const removal = await gatherRemoval(ids);
    for (const id of ids) await DB.deleteBlockDeep(id);
    recordChange(removal, emptySet());
    closeDrawer(); closeTextEditor();
    await loadLevel(state.level);
    toast(`Cut ${ids.length} block${ids.length > 1 ? 's' : ''}`);
  }

  // Gather a deep snapshot of the given top-level ids (blocks+descendants+edges+files).
  async function gatherSnapshot(ids) {
    const blocks = [], edges = [], files = [], seen = new Set();
    async function gather(id) {
      if (seen.has(id)) return;
      seen.add(id);
      const b = await DB.getBlock(id); if (!b) return;
      blocks.push(b);
      const [kids, fs, es] = await Promise.all([DB.childBlocks(id), DB.blockFiles(id), DB.levelEdges(id)]);
      files.push(...fs); edges.push(...es);
      for (const k of kids) await gather(k.id);
    }
    for (const id of ids) await gather(id);
    const sel = new Set(ids);
    const sibEdges = (await DB.levelEdges(state.level)).filter(e => sel.has(e.from) && sel.has(e.to));
    edges.push(...sibEdges);
    return { roots: ids.slice(), blocks, edges, files };
  }

  async function pasteClipboard() {
    if (!clipboard) return;
    await pasteSnapshot(clipboard, 'Pasted');
  }

  // Duplicate the current selection in place (offset), without touching clipboard.
  async function duplicateSelection() {
    if (drawerBlock) await persistBlock(drawerBlock);
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    const snap = await gatherSnapshot(ids);
    await pasteSnapshot(snap, 'Duplicated');
  }

  async function pasteSnapshot(snap, verb) {
    const { roots, blocks, edges, files } = snap;
    const idMap = new Map();
    blocks.forEach(b => idMap.set(b.id, uid()));   // fresh id for every copied block
    const rootSet = new Set(roots);
    const now = Date.now();

    const madeBlocks = [], madeEdges = [], madeFiles = [];
    for (const b of blocks) {
      const nb = { ...b, id: idMap.get(b.id), ws: state.ws, createdAt: now, updatedAt: now };
      if (rootSet.has(b.id)) {                 // paste top-level copies into the current level
        nb.parentId = state.level;
        nb.x = (b.x || 0) + 28; nb.y = (b.y || 0) + 28;
      } else {
        nb.parentId = idMap.get(b.parentId) || state.level;
      }
      await DB.saveBlock(nb); madeBlocks.push(nb);
    }
    for (const e of edges) {
      const from = idMap.get(e.from), to = idMap.get(e.to);
      if (!from || !to) continue;
      // internal edges keep their (remapped) parent; sibling edges land in this level
      const ne = { id: uid(), ws: state.ws, parentId: idMap.get(e.parentId) || state.level, from, to, createdAt: now };
      await DB.saveEdge(ne); madeEdges.push(ne);
    }
    for (const f of files) {
      const blockId = idMap.get(f.blockId);
      if (!blockId) continue;
      const nf = { ...f, id: uid(), ws: state.ws, blockId, createdAt: now };
      await DB.saveFile(nf); madeFiles.push(nf);
    }
    recordChange(emptySet(), { blocks: madeBlocks, edges: madeEdges, files: madeFiles });

    const newRoots = roots.map(r => idMap.get(r));
    await loadLevel(state.level);
    setSelection(newRoots);
    toast(`${verb || 'Pasted'} ${roots.length} block${roots.length > 1 ? 's' : ''}`);
  }

  let drawerBlock = null;
  let editBaseline = null;   // snapshot of editable fields when an editor opened
  const saveState = $('#save-state');
  let saveTimer = null;
  // superset covering both the block editor and the text editor
  const EDIT_FIELDS = ['title', 'description', 'notes', 'color', 'layout', 'text', 'font', 'size', 'bold', 'italic', 'align', 'orient', 'rot', 'glow', 'glowColor', 'shape', 'w', 'h', 'fill', 'outline', 'outlineW', 'outlineColor', 'src', 'round'];

  function snapshotFields(b) {
    const o = { id: b.id };
    EDIT_FIELDS.forEach(f => { o[f] = b[f]; });
    return o;
  }
  // open the right editor for a block (text vs normal)
  function openAnyEditor(id) {
    const b = state.blocks.find(x => x.id === id);
    if (b && b.kind === 'text') openTextEditor(id);
    else if (b && b.kind === 'shape') openShapeEditor(id);
    else if (b && b.kind === 'image') openImageEditor(id);
    else openEditor(id);
  }

  // Commit a single undo entry for an editing session (if anything changed).
  function flushEdit() {
    if (!editBaseline) return;
    const base = editBaseline; editBaseline = null;
    const cur = state.blocks.find(x => x.id === base.id) ||
      (drawerBlock && drawerBlock.id === base.id ? drawerBlock : null) ||
      (textBlock && textBlock.id === base.id ? textBlock : null) ||
      (shapeBlock && shapeBlock.id === base.id ? shapeBlock : null) ||
      (imageBlock && imageBlock.id === base.id ? imageBlock : null);
    if (!cur) return;
    if (!EDIT_FIELDS.some(f => (cur[f] ?? '') !== (base[f] ?? ''))) return;
    const before = { ...cur };
    EDIT_FIELDS.forEach(f => { before[f] = base[f]; });
    recordChange({ blocks: [before], edges: [], files: [] }, { blocks: [{ ...cur }], edges: [], files: [] });
  }

  async function openDrawer(id, focusTitle) {
    flushEdit();
    closeTextEditor(true);
    const b = state.blocks.find(x => x.id === id);
    if (!b) return;
    drawerBlock = b;
    editBaseline = snapshotFields(b);
    $('#f-title').value = b.title || '';
    $('#f-desc').value  = b.description || '';
    $('#f-notes').value = b.notes || '';
    renderSwatches(b.color);
    renderLayoutSeg(b.layout === 'list' ? 'list' : 'canvas');
    await renderFiles(b.id);
    const d = $('#drawer'); d.hidden = false;
    saveState.textContent = '';
    if (focusTitle) setTimeout(() => { $('#f-title').select(); $('#f-title').focus(); }, 60);
  }
  function closeDrawer() {
    flushEdit();
    $('#drawer').hidden = true;
    drawerBlock = null;
    // keep the block selected (highlighted) after closing the editor
  }

  function renderSwatches(active) {
    const wrap = $('#swatches');
    wrap.innerHTML = '';
    PALETTE.forEach(col => {
      const s = document.createElement('div');
      s.className = 'swatch' + (col === active ? ' active' : '');
      s.style.background = col;
      s.addEventListener('click', () => {
        if (!drawerBlock) return;
        drawerBlock.color = col;
        renderSwatches(col);
        refreshItem(drawerBlock.id);
        if (state.levelLayout === 'canvas') drawEdges();
        queueSave();
      });
      wrap.appendChild(s);
    });
  }

  function renderLayoutSeg(active) {
    $$('#layout-seg button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === active);
    });
  }

  function queueSave() {
    if (!drawerBlock) return;
    saveState.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await persistBlock(drawerBlock);
      refreshItem(drawerBlock.id);
      if (state.levelLayout === 'canvas') drawEdges();
      saveState.textContent = 'Saved';
      setTimeout(() => { if (saveState.textContent === 'Saved') saveState.textContent = ''; }, 1500);
      markChanged();
    }, 350);
  }

  function bindDrawerFields() {
    const map = { '#f-title': 'title', '#f-desc': 'description', '#f-notes': 'notes' };
    Object.entries(map).forEach(([sel, key]) => {
      $(sel).addEventListener('input', (e) => {
        if (!drawerBlock) return;
        drawerBlock[key] = e.target.value;
        refreshItem(drawerBlock.id);
        queueSave();
      });
    });
    $$('#layout-seg button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!drawerBlock) return;
        drawerBlock.layout = btn.dataset.layout;
        renderLayoutSeg(btn.dataset.layout);
        refreshItem(drawerBlock.id);   // update the "list" chip on its card/row
        queueSave();
      });
    });
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#f-delete').addEventListener('click', () => drawerBlock && deleteBlock(drawerBlock.id));
    $('#f-open').addEventListener('click', () => drawerBlock && navigateTo(drawerBlock.id));
    $('#f-upload').addEventListener('click', () => $('#file-input').click());
  }

  /* ---------------------------- text editor ---------------------------- */
  let textBlock = null;
  let textSaveTimer = null;

  function renderTFont(active) { $$('#t-font button').forEach(b => b.classList.toggle('active', b.dataset.font === active)); }
  function renderTAlign(active) { $$('#text-drawer .talign').forEach(b => b.classList.toggle('on', b.dataset.align === active)); }
  function renderTOrient(active) { $$('#t-orient button').forEach(b => b.classList.toggle('active', b.dataset.orient === active)); }
  function renderTGlowSwatches(active) {
    const wrap = $('#t-glow-swatches'); wrap.innerHTML = '';
    PALETTE.forEach(col => {
      const s = document.createElement('div');
      s.className = 'swatch' + ((active || PALETTE[0]) === col ? ' active' : '');
      s.style.background = col;
      s.addEventListener('click', () => {
        if (!textBlock) return;
        textBlock.glowColor = col; renderTGlowSwatches(col);
        refreshItem(textBlock.id); queueTextSave();
      });
      wrap.appendChild(s);
    });
  }
  function renderTSwatches(active) {
    const wrap = $('#t-swatches'); wrap.innerHTML = '';
    const mk = (col, isDefault) => {
      const s = document.createElement('div');
      s.className = 'swatch' + ((active || '') === col ? ' active' : '');
      s.style.background = isDefault ? 'var(--text)' : col;
      s.title = isDefault ? 'Default' : col;
      s.addEventListener('click', () => {
        if (!textBlock) return;
        textBlock.color = col;
        renderTSwatches(col);
        refreshItem(textBlock.id);
        queueTextSave();
      });
      wrap.appendChild(s);
    };
    mk('', true);
    PALETTE.forEach(c => mk(c, false));
  }
  function queueTextSave() {
    if (!textBlock) return;
    $('#text-save').textContent = 'Saving…';
    clearTimeout(textSaveTimer);
    textSaveTimer = setTimeout(async () => {
      if (!textBlock) return;
      await persistBlock(textBlock);
      refreshItem(textBlock.id);
      $('#text-save').textContent = 'Saved';
      setTimeout(() => { if ($('#text-save').textContent === 'Saved') $('#text-save').textContent = ''; }, 1500);
      markChanged();
    }, 300);
  }
  function openTextEditor(id) {
    flushEdit();
    const b = state.blocks.find(x => x.id === id);
    if (!b) return;
    selectBlock(id);
    $('#drawer').hidden = true; drawerBlock = null;   // close block editor if open
    textBlock = b;
    editBaseline = snapshotFields(b);
    $('#t-content').value = b.text || '';
    renderTFont(b.font || 'sans');
    $('#t-size').value = b.size || 22; $('#t-size-val').textContent = (b.size || 22) + 'px';
    $('#t-bold').classList.toggle('on', !!b.bold);
    $('#t-italic').classList.toggle('on', !!b.italic);
    renderTAlign(b.align || 'left');
    renderTSwatches(b.color || '');
    renderTOrient(b.orient || 'h');
    $('#t-rot').value = b.rot || 0; $('#t-rot-val').textContent = (b.rot || 0) + '°';
    $('#t-glow').checked = !!b.glow;
    $('#t-glow-wrap').hidden = !b.glow;
    renderTGlowSwatches(b.glowColor || PALETTE[0]);
    $('#text-drawer').hidden = false;
    $('#text-save').textContent = '';
    setTimeout(() => $('#t-content').focus(), 60);
  }
  function closeTextEditor() {
    if ($('#text-drawer').hidden && !textBlock) return;
    flushEdit();
    $('#text-drawer').hidden = true;
    textBlock = null;
  }
  function bindTextEditor() {
    $('#t-content').addEventListener('input', (e) => { if (!textBlock) return; textBlock.text = e.target.value; refreshItem(textBlock.id); queueTextSave(); });
    $$('#t-font button').forEach(btn => btn.addEventListener('click', () => { if (!textBlock) return; textBlock.font = btn.dataset.font; renderTFont(btn.dataset.font); refreshItem(textBlock.id); queueTextSave(); }));
    $('#t-size').addEventListener('input', (e) => { if (!textBlock) return; textBlock.size = parseInt(e.target.value, 10) || 22; $('#t-size-val').textContent = textBlock.size + 'px'; refreshItem(textBlock.id); queueTextSave(); });
    $('#t-bold').addEventListener('click', () => { if (!textBlock) return; textBlock.bold = !textBlock.bold; $('#t-bold').classList.toggle('on', textBlock.bold); refreshItem(textBlock.id); queueTextSave(); });
    $('#t-italic').addEventListener('click', () => { if (!textBlock) return; textBlock.italic = !textBlock.italic; $('#t-italic').classList.toggle('on', textBlock.italic); refreshItem(textBlock.id); queueTextSave(); });
    $$('#text-drawer .talign').forEach(btn => btn.addEventListener('click', () => { if (!textBlock) return; textBlock.align = btn.dataset.align; renderTAlign(btn.dataset.align); refreshItem(textBlock.id); queueTextSave(); }));
    $$('#t-orient button').forEach(btn => btn.addEventListener('click', () => { if (!textBlock) return; textBlock.orient = btn.dataset.orient; renderTOrient(btn.dataset.orient); refreshItem(textBlock.id); queueTextSave(); }));
    $('#t-rot').addEventListener('input', (e) => { if (!textBlock) return; textBlock.rot = parseInt(e.target.value, 10) || 0; $('#t-rot-val').textContent = textBlock.rot + '°'; refreshItem(textBlock.id); queueTextSave(); });
    $('#t-glow').addEventListener('change', (e) => { if (!textBlock) return; textBlock.glow = e.target.checked; $('#t-glow-wrap').hidden = !e.target.checked; refreshItem(textBlock.id); queueTextSave(); });
    $('#text-close').addEventListener('click', closeTextEditor);
    $('#t-done').addEventListener('click', closeTextEditor);
    $('#t-delete').addEventListener('click', () => { if (textBlock) deleteBlock(textBlock.id); });
  }

  /* ---------------------------- shape editor --------------------------- */
  let shapeBlock = null;
  let shapeSaveTimer = null;
  function renderSType(active) { $$('#s-type button').forEach(b => b.classList.toggle('active', b.dataset.shape === active)); }
  function renderSFill(active) {
    const wrap = $('#s-swatches'); wrap.innerHTML = '';
    PALETTE.forEach(col => {
      const s = document.createElement('div');
      s.className = 'swatch' + ((active || PALETTE[0]) === col ? ' active' : '');
      s.style.background = col;
      s.addEventListener('click', () => { if (!shapeBlock) return; shapeBlock.color = col; renderSFill(col); refreshItem(shapeBlock.id); queueShapeSave(); });
      wrap.appendChild(s);
    });
  }
  function renderSOutline(active) {
    const wrap = $('#s-outline-swatches'); wrap.innerHTML = '';
    PALETTE.forEach(col => {
      const s = document.createElement('div');
      s.className = 'swatch' + ((active || PALETTE[0]) === col ? ' active' : '');
      s.style.background = col;
      s.addEventListener('click', () => { if (!shapeBlock) return; shapeBlock.outlineColor = col; renderSOutline(col); refreshItem(shapeBlock.id); queueShapeSave(); });
      wrap.appendChild(s);
    });
  }
  function queueShapeSave() {
    if (!shapeBlock) return;
    $('#shape-save').textContent = 'Saving…';
    clearTimeout(shapeSaveTimer);
    shapeSaveTimer = setTimeout(async () => {
      if (!shapeBlock) return;
      await persistBlock(shapeBlock);
      refreshItem(shapeBlock.id);
      $('#shape-save').textContent = 'Saved';
      setTimeout(() => { if ($('#shape-save').textContent === 'Saved') $('#shape-save').textContent = ''; }, 1500);
      markChanged();
    }, 300);
  }
  function openShapeEditor(id) {
    flushEdit();
    const b = state.blocks.find(x => x.id === id);
    if (!b) return;
    selectBlock(id);
    $('#drawer').hidden = true; drawerBlock = null;
    $('#text-drawer').hidden = true; textBlock = null;
    shapeBlock = b;
    editBaseline = snapshotFields(b);
    renderSType(b.shape || 'rectangle');
    $('#s-w').value = b.w || 150; $('#s-w-val').textContent = (b.w || 150) + 'px';
    $('#s-h').value = b.h || 100; $('#s-h-val').textContent = (b.h || 100) + 'px';
    $('#s-fill').checked = b.fill !== false;
    $('#s-fill-wrap').hidden = b.fill === false;
    renderSFill(b.color);
    $('#s-outline').checked = !!b.outline;
    $('#s-outline-wrap').hidden = !b.outline;
    $('#s-ow').value = b.outlineW || 3; $('#s-ow-val').textContent = (b.outlineW || 3) + 'px';
    renderSOutline(b.outlineColor);
    $('#shape-drawer').hidden = false;
    $('#shape-save').textContent = '';
  }
  function closeShapeEditor() {
    if ($('#shape-drawer').hidden && !shapeBlock) return;
    flushEdit();
    $('#shape-drawer').hidden = true;
    shapeBlock = null;
  }
  function bindShapeEditor() {
    $$('#s-type button').forEach(btn => btn.addEventListener('click', () => { if (!shapeBlock) return; shapeBlock.shape = btn.dataset.shape; if (btn.dataset.shape !== 'polygon') shapeBlock.points = null; renderSType(btn.dataset.shape); refreshItem(shapeBlock.id); queueShapeSave(); }));
    $('#s-w').addEventListener('input', (e) => { if (!shapeBlock) return; shapeBlock.w = parseInt(e.target.value, 10) || 150; $('#s-w-val').textContent = shapeBlock.w + 'px'; refreshItem(shapeBlock.id); queueShapeSave(); });
    $('#s-h').addEventListener('input', (e) => { if (!shapeBlock) return; shapeBlock.h = parseInt(e.target.value, 10) || 100; $('#s-h-val').textContent = shapeBlock.h + 'px'; refreshItem(shapeBlock.id); queueShapeSave(); });
    $('#s-fill').addEventListener('change', (e) => { if (!shapeBlock) return; shapeBlock.fill = e.target.checked; $('#s-fill-wrap').hidden = !e.target.checked; refreshItem(shapeBlock.id); queueShapeSave(); });
    $('#s-outline').addEventListener('change', (e) => { if (!shapeBlock) return; shapeBlock.outline = e.target.checked; $('#s-outline-wrap').hidden = !e.target.checked; refreshItem(shapeBlock.id); queueShapeSave(); });
    $('#s-ow').addEventListener('input', (e) => { if (!shapeBlock) return; shapeBlock.outlineW = parseInt(e.target.value, 10) || 2; $('#s-ow-val').textContent = shapeBlock.outlineW + 'px'; refreshItem(shapeBlock.id); queueShapeSave(); });
    $('#shape-close').addEventListener('click', closeShapeEditor);
    $('#s-done').addEventListener('click', closeShapeEditor);
    $('#s-delete').addEventListener('click', () => { if (shapeBlock) deleteBlock(shapeBlock.id); });
  }

  /* ---------------------------- image editor --------------------------- */
  let imageBlock = null;
  let imageSaveTimer = null;
  function queueImageSave() {
    if (!imageBlock) return;
    $('#image-save').textContent = 'Saving…';
    clearTimeout(imageSaveTimer);
    imageSaveTimer = setTimeout(async () => {
      if (!imageBlock) return;
      await persistBlock(imageBlock);
      refreshItem(imageBlock.id);
      $('#image-save').textContent = 'Saved';
      setTimeout(() => { if ($('#image-save').textContent === 'Saved') $('#image-save').textContent = ''; }, 1500);
      markChanged();
    }, 300);
  }
  function openImageEditor(id) {
    flushEdit();
    const b = state.blocks.find(x => x.id === id);
    if (!b) return;
    selectBlock(id);
    $('#drawer').hidden = true; drawerBlock = null;
    $('#text-drawer').hidden = true; textBlock = null;
    $('#shape-drawer').hidden = true; shapeBlock = null;
    imageBlock = b;
    editBaseline = snapshotFields(b);
    const pv = $('#i-preview'); pv.innerHTML = ''; const im = document.createElement('img'); im.src = b.src || ''; pv.appendChild(im);
    $('#i-w').value = b.w || 200; $('#i-w-val').textContent = (b.w || 200) + 'px';
    $('#i-rot').value = b.rot || 0; $('#i-rot-val').textContent = (b.rot || 0) + '°';
    $('#i-round').checked = !!b.round;
    $('#image-drawer').hidden = false;
    $('#image-save').textContent = '';
  }
  function closeImageEditor() {
    if ($('#image-drawer').hidden && !imageBlock) return;
    flushEdit();
    $('#image-drawer').hidden = true;
    imageBlock = null;
  }
  function bindImageEditor() {
    $('#i-w').addEventListener('input', (e) => {
      if (!imageBlock) return;
      const newW = parseInt(e.target.value, 10) || 200;
      const ratio = (imageBlock.h && imageBlock.w) ? imageBlock.h / imageBlock.w : 0.75;
      imageBlock.w = newW; imageBlock.h = Math.round(newW * ratio);
      $('#i-w-val').textContent = newW + 'px';
      refreshItem(imageBlock.id); queueImageSave();
    });
    $('#i-rot').addEventListener('input', (e) => { if (!imageBlock) return; imageBlock.rot = parseInt(e.target.value, 10) || 0; $('#i-rot-val').textContent = imageBlock.rot + '°'; refreshItem(imageBlock.id); queueImageSave(); });
    $('#i-round').addEventListener('change', (e) => { if (!imageBlock) return; imageBlock.round = e.target.checked; refreshItem(imageBlock.id); queueImageSave(); });
    $('#i-replace').addEventListener('click', () => { if (!imageBlock) return; replaceImageId = imageBlock.id; pendingImageAt = null; $('#image-input').click(); });
    $('#image-close').addEventListener('click', closeImageEditor);
    $('#i-done').addEventListener('click', closeImageEditor);
    $('#i-delete').addEventListener('click', () => { if (imageBlock) deleteBlock(imageBlock.id); });
    // shared file input for both new images and replacements
    $('#image-input').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) { replaceImageId = null; return; }
      if (replaceImageId) {
        const b = state.blocks.find(x => x.id === replaceImageId); replaceImageId = null;
        if (!b) return;
        const before = { ...b };
        b.src = await readAsDataUrl(file);
        const nat = await loadImageSize(b.src);
        b.h = Math.round((b.w || 200) * (nat.h / (nat.w || 1)));
        await persistBlock(b);
        refreshItem(b.id);
        if (imageBlock && imageBlock.id === b.id) openImageEditor(b.id);
        recordChange({ blocks: [before], edges: [], files: [] }, { blocks: [{ ...b }], edges: [], files: [] });
        toast('Image replaced');
      } else {
        await createImageBlock(file);
      }
    });
  }

  /* ---------------------------- files ---------------------------------- */
  const objectUrls = new Set();
  function makeUrl(blob) { const u = URL.createObjectURL(blob); objectUrls.add(u); return u; }

  async function renderFiles(blockId) {
    const list = $('#file-list');
    const files = await DB.blockFiles(blockId);
    $('#file-count').textContent = files.length ? `(${files.length})` : '';
    list.innerHTML = '';
    if (!files.length) { list.innerHTML = '<div class="muted" style="font-size:13px;padding:2px 2px 6px">No files yet.</div>'; return; }
    files.sort((a, b) => a.createdAt - b.createdAt);
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'file-row';
      const thumb = f.kind === 'image'
        ? `<div class="file-thumb"><img src="${makeUrl(f.blob)}" alt=""></div>`
        : `<div class="file-thumb">${ic('file')}</div>`;
      const label = f.kind === 'pdf' ? 'PDF' : (f.type || 'file');
      row.innerHTML = `
        ${thumb}
        <div class="file-info">
          <div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div>
          <div class="file-sub">${esc(label)} · ${humanSize(f.size)}</div>
        </div>
        <div class="file-actions">
          <button data-act="open" title="Open">${ic('external')}</button>
          <button data-act="download" title="Download">${ic('download')}</button>
          <button data-act="del" title="Remove">${ic('trash')}</button>
        </div>`;
      row.querySelector('[data-act="open"]').addEventListener('click', () => {
        window.open(makeUrl(f.blob), '_blank');
      });
      row.querySelector('[data-act="download"]').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = makeUrl(f.blob); a.download = f.name; a.click();
      });
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        confirmDialog('Remove file?', esc(f.name), 'Remove', async () => {
          await DB.delFile(f.id);
          await renderFiles(blockId);
          await recount(blockId);
          markChanged();
          toast('File removed');
        });
      });
      list.appendChild(row);
    }
  }

  async function recount(blockId) {
    const [kids, files] = await Promise.all([DB.childBlocks(blockId), DB.blockFiles(blockId)]);
    state.childCounts[blockId] = { blocks: kids.length, files: files.length };
    kids.sort((a, c) => (a.createdAt || 0) - (c.createdAt || 0));
    state.childPeek[blockId] = kids.slice(0, 4).map(k => ({ title: k.title, color: k.color }));
    refreshItem(blockId);
  }

  async function addFiles(fileList) {
    if (!drawerBlock) return;
    const blockId = drawerBlock.id;
    const files = Array.from(fileList);
    let added = 0;
    for (const file of files) {
      try {
        const rec = {
          id: uid(), ws: state.ws, blockId,
          name: file.name, type: file.type || '', size: file.size,
          kind: fileKind(file.type, file.name),
          blob: file, createdAt: Date.now(),
        };
        await DB.saveFile(rec);
        added++;
      } catch (err) {
        console.error(err);
        toast('Could not store ' + file.name);
      }
    }
    await renderFiles(blockId);
    await recount(blockId);
    if (added) { toast(added + ' file' + (added > 1 ? 's' : '') + ' added'); markChanged(); }
  }

  function bindFileInputs() {
    $('#file-input').addEventListener('change', (e) => {
      addFiles(e.target.files);
      e.target.value = '';
    });
    const dz = $('#dropzone');
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  }

  /* ---------------------------- pointer: pan/zoom/drag/select ---------- */
  const pointers = new Map();          // pointerId -> {x,y}
  let dragging = null;                 // group drag: {primary, ids, starts, startX, startY, moved, shift}
  let panning = null;                  // {startX, startY, tx, ty}
  let pinch = null;                    // {dist}
  let marquee = null;                  // rubber-band: {r, sx, sy, base}
  let lpTimer = null, lpFired = false, lpX = 0, lpY = 0;   // long-press (touch → context menu)
  let gizmo = null;                    // rotate/resize handle drag {id, mode, ...}
  let lastPointer = null;              // last pointer position (screen coords) for paste-at-cursor

  function onPointerDown(e) {
    if (state.levelLayout === 'list') return;   // list view handles its own clicks/scroll

    // RIGHT-button drag = marquee (rubber-band) selection
    if (e.button === 2) { startMarquee(e); return; }
    if (e.button !== 0) return;

    // NOTE: intentionally NOT using setPointerCapture — it can redirect
    // click/dblclick to the capture target in some browsers. Move/up are on
    // window (see bindStage) so gestures still track off-stage.
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {         // start pinch
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      if (dragging) state.els[dragging.primary]?.classList.remove('dragging');
      dragging = panning = null;
      clearTimeout(lpTimer); lpTimer = null; lpFired = false;   // cancel long-press during pinch
      return;
    }

    const blockEl = e.target.closest('.block');
    if (blockEl) {
      const id = blockEl.dataset.id;
      // rotate / resize handle → start a gizmo gesture (not a move)
      const handle = e.target.closest('.tnode-rotate, .tnode-resize');
      if (handle) {
        const b = state.blocks.find(x => x.id === id);
        selectBlock(id);
        const rect = blockEl.getBoundingClientRect();
        gizmo = {
          id, mode: handle.classList.contains('tnode-rotate') ? 'rotate' : 'resize',
          startX: e.clientX, startY: e.clientY,
          startSize: b.size || 22, startW: b.w || 150, startH: b.h || 100, startRot: b.rot || 0,
          cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
          isText: b.kind === 'text', isImage: b.kind === 'image', before: { ...b },
        };
        gizmo.startAngle = Math.atan2(e.clientY - gizmo.cy, e.clientX - gizmo.cx);
        return;
      }
      if (e.target.closest('[data-blk]')) return;   // hover action buttons
      if (state.linkMode) { handleLinkTap(id); return; }
      // if it's an unselected block and no shift, select just it (so drag moves it)
      if (!e.shiftKey && !state.selectedIds.has(id)) selectBlock(id);
      // move the whole current selection if this block is part of it; else just this one
      const ids = (!e.shiftKey && state.selectedIds.has(id)) ? [...state.selectedIds] : [id];
      const starts = {};
      ids.forEach(bid => { const bb = state.blocks.find(x => x.id === bid); if (bb) starts[bid] = { x: bb.x, y: bb.y }; });
      dragging = { primary: id, ids, starts, startX: e.clientX, startY: e.clientY, moved: false, shift: e.shiftKey };
      blockEl.classList.add('dragging');
    } else {
      const r = stage.getBoundingClientRect();
      panning = { startX: e.clientX, startY: e.clientY, tx: state.view.tx, ty: state.view.ty, r };
      stage.classList.add('panning');
    }

    // touch long-press → context menu (mouse uses right-click)
    if (e.pointerType === 'touch') {
      lpFired = false; lpX = e.clientX; lpY = e.clientY;
      const cx = e.clientX, cy = e.clientY, tid = blockEl ? blockEl.dataset.id : null;
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => {
        lpTimer = null; lpFired = true;
        if (dragging) { state.els[dragging.primary]?.classList.remove('dragging'); dragging = null; }
        if (panning) { stage.classList.remove('panning'); panning = null; }
        openContextMenu(cx, cy, tid);
      }, 500);
    }
  }

  function onPointerMove(e) {
    lastPointer = { x: e.clientX, y: e.clientY };   // for paste-at-cursor
    if (lpTimer && (Math.abs(e.clientX - lpX) + Math.abs(e.clientY - lpY) > 8)) { clearTimeout(lpTimer); lpTimer = null; }
    if (marquee) {
      if (!marquee.moved && (Math.abs(e.clientX - marquee.sx) + Math.abs(e.clientY - marquee.sy) > 4)) {
        marquee.moved = true; if (!marquee.shift) clearSelection();
      }
      if (marquee.moved) { positionMarquee(e.clientX, e.clientY); updateMarqueeSelection(e.clientX, e.clientY); }
      return;
    }
    if (gizmo) {
      const b = state.blocks.find(x => x.id === gizmo.id); if (!b) return;
      const s = state.view.scale || 1;
      if (gizmo.mode === 'resize') {
        if (gizmo.isText) {
          const d = ((e.clientX - gizmo.startX) + (e.clientY - gizmo.startY)) / 2 / s;
          b.size = clamp(Math.round(gizmo.startSize + d * 0.7), 8, 240);
          if (textBlock && textBlock.id === b.id) { $('#t-size').value = b.size; $('#t-size-val').textContent = b.size + 'px'; }
        } else if (gizmo.isImage) {
          const ratio = gizmo.startH / (gizmo.startW || 1);
          b.w = clamp(Math.round(gizmo.startW + (e.clientX - gizmo.startX) / s), 20, 2000);
          b.h = Math.max(20, Math.round(b.w * ratio));   // keep aspect ratio
          if (imageBlock && imageBlock.id === b.id) { const W = $('#i-w'); if (W) { W.value = b.w; $('#i-w-val').textContent = b.w + 'px'; } }
        } else {
          b.w = clamp(Math.round(gizmo.startW + (e.clientX - gizmo.startX) / s), 20, 1400);
          b.h = clamp(Math.round(gizmo.startH + (e.clientY - gizmo.startY) / s), 20, 1400);
          if (shapeBlock && shapeBlock.id === b.id) { const W = $('#s-w'), H = $('#s-h'); if (W) { W.value = b.w; $('#s-w-val').textContent = b.w + 'px'; } if (H) { H.value = b.h; $('#s-h-val').textContent = b.h + 'px'; } }
        }
      } else {
        const ang = Math.atan2(e.clientY - gizmo.cy, e.clientX - gizmo.cx);
        let deg = Math.round(gizmo.startRot + (ang - gizmo.startAngle) * 180 / Math.PI);
        deg = (((deg + 180) % 360) + 360) % 360 - 180;
        b.rot = deg;
        if (textBlock && textBlock.id === b.id) { $('#t-rot').value = deg; $('#t-rot-val').textContent = deg + '°'; }
        if (imageBlock && imageBlock.id === b.id) { $('#i-rot').value = deg; $('#i-rot-val').textContent = deg + '°'; }
      }
      refreshBlockCard(b.id);
      drawEdges();
      return;
    }
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = stage.getBoundingClientRect();
      if (pinch.dist) zoomAt(mid.x - r.left, mid.y - r.top, dist / pinch.dist);
      pinch.dist = dist;
      return;
    }

    if (dragging) {
      const dx = e.clientX - dragging.startX, dy = e.clientY - dragging.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
      if (dragging.shift) return;      // shift = toggle only, don't move
      const s = state.view.scale;
      for (const bid of dragging.ids) {
        const st = dragging.starts[bid]; if (!st) continue;
        const nx = snapVal(st.x + dx / s), ny = snapVal(st.y + dy / s);
        const bb = state.blocks.find(x => x.id === bid); if (!bb) continue;
        bb.x = nx; bb.y = ny;
        const el = state.els[bid]; if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; }
      }
      drawEdges();
      return;
    }

    if (panning) {
      state.view.tx = panning.tx + (e.clientX - panning.startX);
      state.view.ty = panning.ty + (e.clientY - panning.startY);
      applyView();
    }
  }

  async function onPointerUp(e) {
    clearTimeout(lpTimer); lpTimer = null;
    if (lpFired) {                       // long-press already opened the context menu
      lpFired = false;
      if (dragging) { state.els[dragging.primary]?.classList.remove('dragging'); dragging = null; }
      if (panning) { stage.classList.remove('panning'); panning = null; }
      pointers.delete(e.pointerId);
      return;
    }
    if (marquee) {
      const m = marquee; endMarquee();
      if (!m.moved) openContextMenu(e.clientX, e.clientY, m.target ? m.target.dataset.id : null);
      return;
    }
    if (gizmo) {
      pointers.delete(e.pointerId);       // release the handle's pointer (else next touch looks like a 2nd finger → pinch)
      if (pointers.size < 2) pinch = null;
      const b = state.blocks.find(x => x.id === gizmo.id);
      if (b) {
        await persistBlock(b);
        recordChange({ blocks: [{ ...gizmo.before }], edges: [], files: [] }, { blocks: [{ ...b }], edges: [], files: [] });
      }
      gizmo = null;
      return;
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;

    if (dragging) {
      state.els[dragging.primary]?.classList.remove('dragging');
      if (dragging.shift && !dragging.moved) {
        toggleSelect(dragging.primary);          // shift+click toggles
      } else if (dragging.moved) {
        const before = { blocks: [], edges: [], files: [] };
        const after = { blocks: [], edges: [], files: [] };
        for (const bid of dragging.ids) {
          const bb = state.blocks.find(x => x.id === bid);
          if (!bb) continue;
          const st = dragging.starts[bid];
          before.blocks.push({ ...bb, x: st.x, y: st.y });
          after.blocks.push({ ...bb });
          await persistBlock(bb);
        }
        recordChange(before, after);
      } else {
        selectBlock(dragging.primary);           // plain click = single select
      }
      dragging = null;
      return;
    }
    if (panning) {
      stage.classList.remove('panning');
      const moved = Math.abs(e.clientX - panning.startX) + Math.abs(e.clientY - panning.startY);
      panning = null;
      if (moved < 4 && !state.linkMode) { closeDrawerIfOpen(); clearSelection(); }
    }
  }

  /* ---------------------------- marquee select ------------------------- */
  function startMarquee(e) {
    marquee = {
      r: stage.getBoundingClientRect(), sx: e.clientX, sy: e.clientY,
      base: e.shiftKey ? new Set(state.selectedIds) : new Set(),
      shift: e.shiftKey, moved: false, target: e.target.closest('.block'),
    };
    const box = $('#marquee'); box.hidden = false;
    positionMarquee(e.clientX, e.clientY);
  }
  function positionMarquee(cx, cy) {
    const r = marquee.r;
    const box = $('#marquee');
    box.style.left = (Math.min(marquee.sx, cx) - r.left) + 'px';
    box.style.top = (Math.min(marquee.sy, cy) - r.top) + 'px';
    box.style.width = Math.abs(cx - marquee.sx) + 'px';
    box.style.height = Math.abs(cy - marquee.sy) + 'px';
  }
  function updateMarqueeSelection(cx, cy) {
    const r = marquee.r;
    const p1 = screenToWorld(Math.min(marquee.sx, cx) - r.left, Math.min(marquee.sy, cy) - r.top);
    const p2 = screenToWorld(Math.max(marquee.sx, cx) - r.left, Math.max(marquee.sy, cy) - r.top);
    const hit = [];
    for (const b of state.blocks) {
      const rect = blockRect(b.id);
      if (rect.x < p2.x && rect.x + rect.w > p1.x && rect.y < p2.y && rect.y + rect.h > p1.y) hit.push(b.id);
    }
    setSelection([...marquee.base, ...hit]);
  }
  function endMarquee() { $('#marquee').hidden = true; marquee = null; }

  function closeDrawerIfOpen() {
    if (!$('#drawer').hidden) closeDrawer();
    if (!$('#text-drawer').hidden) closeTextEditor();
    if (!$('#shape-drawer').hidden) closeShapeEditor();
    if (!$('#image-drawer').hidden) closeImageEditor();
    hideSearchResults();
    $('#menu').hidden = true;
  }

  /* ---------------------------- context menu --------------------------- */
  function hideCtxMenu() { $('#ctxmenu').hidden = true; }
  function openContextMenu(clientX, clientY, targetId) {
    if (state.ws == null || state.levelLayout !== 'canvas') return;
    $('#menu').hidden = true; $('#add-menu').hidden = true; $('#brand-menu').hidden = true;
    const r = stage.getBoundingClientRect();
    const at = screenToWorld(clientX - r.left, clientY - r.top);   // world point under cursor
    let items;
    if (targetId) {
      if (!state.selectedIds.has(targetId)) selectBlock(targetId);
      const b = state.blocks.find(x => x.id === targetId);
      const many = state.selectedIds.size > 1;
      const openable = b && b.kind !== 'text' && b.kind !== 'shape' && b.kind !== 'image';
      items = [{ icon: 'pencil', label: 'Edit', fn: () => openAnyEditor(targetId), disabled: many }];
      if (openable) items.push({ icon: 'arrow-right', label: 'Open inside', fn: () => navigateTo(targetId), disabled: many });
      items.push(
        { icon: 'copy', label: many ? `Copy ${state.selectedIds.size}` : 'Copy', fn: () => copySelection() },
        { icon: 'scissors', label: 'Cut', fn: () => cutSelection() },
        { sep: true },
        { icon: 'front', label: 'Bring to front', fn: () => bringToFront([...state.selectedIds]) },
        { icon: 'forward', label: 'Bring forward', fn: () => bringForward([...state.selectedIds]) },
        { icon: 'backward', label: 'Send backward', fn: () => sendBackward([...state.selectedIds]) },
        { icon: 'back', label: 'Send to back', fn: () => sendToBack([...state.selectedIds]) },
        { sep: true },
        { icon: 'trash', label: many ? `Delete ${state.selectedIds.size}` : 'Delete', fn: () => deleteSelected(), danger: true },
      );
    } else {
      clearSelection();
      items = [
        { icon: 'plus', label: 'Add block', fn: () => createBlock('block', at) },
        { icon: 'list', label: 'Add list', fn: () => createBlock('list', at) },
        { icon: 'type', label: 'Add text', fn: () => createBlock('text', at) },
        { icon: 'shapes', label: 'Add shape', fn: () => createBlock('shape', at) },
        { icon: 'image', label: 'Add image', fn: () => pickImage(at) },
        { sep: true },
        { icon: 'download', label: 'Paste', fn: () => pasteClipboard(), disabled: !clipboard },
        { icon: 'frame', label: 'Fit to view', fn: () => fitToView() },
        { sep: true },
        { icon: 'upload', label: 'Export workspace', fn: () => exportWorkspaceFlow(state.ws) },
        { icon: 'info', label: 'About', fn: () => openAbout('about') },
        { icon: 'help', label: 'Help', fn: () => openAbout('help') },
      ];
    }
    const menu = $('#ctxmenu');
    menu.innerHTML = items.map(it => it.sep
      ? '<div class="menu-sep"></div>'
      : `<button ${it.disabled ? 'disabled' : ''} class="${it.danger ? 'danger' : ''}"><span data-icon="${it.icon}"></span><span>${esc(it.label)}</span></button>`
    ).join('');
    hydrateIcons(menu);
    const btns = [...menu.querySelectorAll('button')];
    let bi = 0;
    items.forEach(it => {
      if (it.sep) return;
      const btn = btns[bi++];
      if (it.disabled) return;
      btn.addEventListener('click', () => { hideCtxMenu(); it.fn(); });
    });
    menu.hidden = false;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(clientX, window.innerWidth - mw - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(clientY, window.innerHeight - mh - 8)) + 'px';
  }
  function bindContextMenu() {
    document.addEventListener('pointerdown', (e) => {
      if (!$('#ctxmenu').hidden && !e.target.closest('#ctxmenu')) hideCtxMenu();
    }, true);
    window.addEventListener('wheel', () => hideCtxMenu(), { passive: true });
  }

  function onWheel(e) {
    if (state.levelLayout === 'list') return;   // let the list scroll
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
  }

  function onDblClick(e) {
    if (state.levelLayout === 'list') return;   // handled by list-view
    if (e.target.closest('[data-blk]')) return; // action buttons, not "open"
    const blockEl = e.target.closest('.block');
    if (blockEl) {
      const b = state.blocks.find(x => x.id === blockEl.dataset.id);
      if (b && b.kind === 'text') openTextEditor(b.id);
      else if (b && b.kind === 'shape') openShapeEditor(b.id);
      else if (b && b.kind === 'image') openImageEditor(b.id);
      else navigateTo(blockEl.dataset.id);
      return;
    }
    if (e.target.closest('#edge-layer g')) return;
    const r = stage.getBoundingClientRect();
    createBlock('block', screenToWorld(e.clientX - r.left, e.clientY - r.top));
  }

  // canvas hover-action buttons (edit / open) fire as native clicks
  function onStageClick(e) {
    const btn = e.target.closest('[data-blk]');
    if (!btn) return;
    const blk = btn.closest('.block');
    if (!blk) return;
    if (btn.dataset.blk === 'edit') openAnyEditor(blk.dataset.id);
    else navigateTo(blk.dataset.id);
  }

  /* ---------------------------- link mode ------------------------------ */
  function setLinkMode(on) {
    if (on && state.levelLayout === 'list') return;   // connectors are canvas-only
    state.linkMode = on;
    state.linkSrc = null;
    $('#btn-link').classList.toggle('active', on);
    stage.classList.toggle('linking', on);
    $('#link-banner').hidden = !on;
    $$('.block', world).forEach(n => n.classList.remove('link-src'));
    if (on) closeDrawerIfOpen();
  }
  async function handleLinkTap(id) {
    if (!state.linkSrc) {
      state.linkSrc = id;
      state.els[id]?.classList.add('link-src');
      return;
    }
    if (state.linkSrc === id) {          // tapped same block -> cancel
      state.els[id]?.classList.remove('link-src');
      state.linkSrc = null;
      return;
    }
    const from = state.linkSrc, to = id;
    const exists = state.edges.some(e =>
      (e.from === from && e.to === to) || (e.from === to && e.to === from));
    if (!exists) {
      const edge = { id: uid(), ws: state.ws, parentId: state.level, from, to, createdAt: Date.now() };
      await DB.saveEdge(edge);
      state.edges.push(edge);
      recordChange(emptySet(), { blocks: [], edges: [{ ...edge }], files: [] });
      drawEdges();
      toast('Connected');
    } else {
      toast('Already connected');
    }
    state.els[from]?.classList.remove('link-src');
    state.linkSrc = null;
  }

  /* ---------------------------- fit / zoom buttons --------------------- */
  function fitToView() {
    if (state.levelLayout === 'list') return;
    const r = stage.getBoundingClientRect();
    if (!state.blocks.length) {
      state.view = { scale: 1, tx: r.width / 2 - 105, ty: r.height / 2 - 120 };
      applyView(); return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of state.blocks) {
      const rect = blockRect(b.id);
      minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w); maxY = Math.max(maxY, rect.y + rect.h);
    }
    const pad = 70;
    const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    const scale = clamp(Math.min(r.width / w, r.height / h), 0.25, 1.4);
    state.view.scale = scale;
    state.view.tx = (r.width - (maxX + minX) * scale) / 2;
    state.view.ty = (r.height - (maxY + minY) * scale) / 2;
    applyView();
  }

  /* ---------------------------- search --------------------------------- */
  let searchTimer = null;
  function bindSearch() {
    const input = $('#search');
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(input.value.trim()), 160);
    });
    input.addEventListener('focus', () => { if (input.value.trim()) runSearch(input.value.trim()); });
  }
  function hideSearchResults() { const r = $('#search-results'); r.hidden = true; r.innerHTML = ''; }

  async function runSearch(q) {
    const box = $('#search-results');
    if (!q) { hideSearchResults(); return; }
    const ql = q.toLowerCase();
    const [blocks, files] = await Promise.all([DB.allByWs('blocks', state.ws), DB.allByWs('files', state.ws)]);
    const fileByBlock = {};
    files.forEach(f => { (fileByBlock[f.blockId] ||= []).push(f); });

    const hits = [];
    for (const b of blocks) {
      const inTitle = (b.title || '').toLowerCase().includes(ql);
      const inDesc  = (b.description || '').toLowerCase().includes(ql);
      const inNotes = (b.notes || '').toLowerCase().includes(ql);
      const inText  = (b.text || '').toLowerCase().includes(ql);
      const fileHit = (fileByBlock[b.id] || []).find(f => f.name.toLowerCase().includes(ql));
      if (inTitle || inDesc || inNotes || inText || fileHit) {
        let sub = '';
        if (inTitle) sub = b.description || (b.kind === 'text' ? 'text' : 'block');
        else if (inDesc) sub = b.description;
        else if (inText) sub = b.text.slice(0, 80);
        else if (inNotes) { const i = b.notes.toLowerCase().indexOf(ql); sub = '…' + b.notes.slice(Math.max(0, i - 20), i + 40) + '…'; }
        else if (fileHit) sub = fileHit.name;
        hits.push({ b, sub, score: inTitle ? 3 : inDesc ? 2 : inText ? 2 : fileHit ? 1.5 : 1 });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    box.hidden = false;
    if (!hits.length) { box.innerHTML = '<div class="result-empty">No matches.</div>'; return; }
    box.innerHTML = '';
    hits.slice(0, 40).forEach(h => {
      const row = document.createElement('div');
      row.className = 'result';
      row.innerHTML = `
        <div class="r-ico">${esc(monogram(h.b.title))}</div>
        <div class="r-main">
          <div class="r-title">${esc(h.b.title || 'Untitled')}</div>
          <div class="r-sub">${esc(h.sub || '')}</div>
        </div>
        <div class="r-tag">open</div>`;
      row.addEventListener('click', () => { hideSearchResults(); $('#search').value = ''; goToBlock(h.b); });
      box.appendChild(row);
    });
  }

  // Navigate to a block's PARENT level, then select/open it.
  async function goToBlock(b) {
    await goToLevel(b.parentId || DB.ROOT, { push: true });
    setTimeout(() => {
      if (state.levelLayout === 'list') {
        const row = $(`.list-row[data-id="${b.id}"]`);
        if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); openEditor(b.id); }
        return;
      }
      const el = state.els[b.id];
      if (el) {
        const r = stage.getBoundingClientRect();
        const rect = blockRect(b.id);
        state.view.tx = r.width / 2 - (rect.cx) * state.view.scale;
        state.view.ty = r.height / 2 - (rect.cy) * state.view.scale;
        applyView(); drawEdges();
        openEditor(b.id);
      }
    }, 40);
  }

  /* ---------------------------- export / import ------------------------ */
  function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }
  async function dataUrlToBlob(dataUrl) { return (await fetch(dataUrl)).blob(); }

  // Build the portable, self-contained representation of a workspace
  // (files embedded as data URLs). Used by both download-export and file-save.
  async function workspacePayload(wsId, overrideName) {
    const w = await DB.getWorkspace(wsId);
    const [blocks, edges, files] = await Promise.all([
      DB.allByWs('blocks', wsId), DB.allByWs('edges', wsId), DB.allByWs('files', wsId),
    ]);
    const outFiles = [];
    for (const f of files) {
      outFiles.push({ blockId: f.blockId, name: f.name, type: f.type, size: f.size, kind: f.kind, createdAt: f.createdAt, data: await blobToDataUrl(f.blob) });
    }
    // Preserve every field (kind, text/shape/image props, src, etc.); only drop `ws`
    // which is re-assigned on import.
    const outBlocks = blocks.map(b => { const o = { ...b }; delete o.ws; return o; });
    const outEdges = edges.map(e => ({ id: e.id, parentId: e.parentId, from: e.from, to: e.to, createdAt: e.createdAt }));
    return {
      app: 'NotesGallery', kind: 'workspace', version: 2, exportedAt: new Date().toISOString(),
      workspace: { name: overrideName || (w && w.name) || 'Workspace', color: (w && w.color) || PALETTE[0] },
      blocks: outBlocks, edges: outEdges, files: outFiles,
    };
  }
  const safeFileName = (name) => (String(name || 'workspace').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()) || 'workspace';

  // Download-export (Save As) — works in every browser; always available.
  async function exportWorkspace(wsId, overrideName) {
    wsId = wsId || state.ws;
    if (!wsId) return;
    toast('Preparing export…');
    const payload = await workspacePayload(wsId, overrideName);
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeFileName(overrideName || payload.workspace.name)}.notesgallery.json`;
    a.click();
    toast('Workspace exported');
  }
  function exportWorkspaceFlow(wsId) {
    const id = wsId || state.ws;
    if (!id) return;
    DB.getWorkspace(id).then(w => {
      promptDialog('Export workspace', (w && w.name) || 'Workspace', (name) => {
        exportWorkspace(id, (name || '').trim() || (w && w.name) || 'Workspace');
      });
    });
  }

  /* ---- write a workspace into its bound local file --------------------- */
  // file:// exposes the method names but throws on call; require a secure http(s)/localhost context.
  const FS_OK = ('showSaveFilePicker' in window) && ('showOpenFilePicker' in window)
    && window.isSecureContext && location.protocol !== 'file:';
  function fsStatus() {
    if (!('showSaveFilePicker' in window)) return { ok: false, why: 'this browser has no file access — use Chrome or Edge' };
    if (location.protocol === 'file:') return { ok: false, why: 'opened as a local file — open http://localhost:8765 via the launcher' };
    if (!window.isSecureContext) return { ok: false, why: 'not a secure page — open http://localhost:8765 via the launcher' };
    return { ok: true, why: 'new workspaces are saved to a file at a location you choose' };
  }
  async function ensurePermission(handle, mode = 'readwrite') {
    if (!handle) return false;
    try {
      const opts = { mode };
      if ((await handle.queryPermission(opts)) === 'granted') return true;
      if ((await handle.requestPermission(opts)) === 'granted') return true;
    } catch (_) {}
    return false;
  }
  async function writeToHandle(handle, payload) {
    const writable = await handle.createWritable();
    await writable.write(new Blob([JSON.stringify(payload, null, 0)], { type: 'application/json' }));
    await writable.close();
  }

  // Turn a parsed workspace file into a NEW workspace in the DB. Returns its id.
  async function createWorkspaceFromData(data) {
    const wsId = uid();
    const now = Date.now();
    const count = (await DB.listWorkspaces()).length;
    const name = (data.workspace && data.workspace.name) || 'Imported workspace';
    const color = (data.workspace && data.workspace.color) || pickWsColor(count);
    await DB.saveWorkspace({ id: wsId, name, color, createdAt: now, updatedAt: now });
    const idMap = new Map();
    data.blocks.forEach(b => idMap.set(b.id, uid()));
    for (const b of data.blocks) {
      const nb = { ...b, id: idMap.get(b.id), ws: wsId, createdAt: b.createdAt || now, updatedAt: b.updatedAt || now };
      nb.parentId = (b.parentId === DB.ROOT || b.parentId == null) ? DB.ROOT : (idMap.get(b.parentId) || DB.ROOT);
      await DB.saveBlock(nb);
    }
    for (const e of (data.edges || [])) {
      const from = idMap.get(e.from), to = idMap.get(e.to);
      if (!from || !to) continue;
      const parentId = (e.parentId === DB.ROOT || e.parentId == null) ? DB.ROOT : (idMap.get(e.parentId) || DB.ROOT);
      await DB.saveEdge({ id: uid(), ws: wsId, parentId, from, to, createdAt: e.createdAt || now });
    }
    for (const f of (data.files || [])) {
      const blockId = idMap.get(f.blockId);
      if (!blockId) continue;
      const blob = f.data ? await dataUrlToBlob(f.data) : new Blob([]);
      await DB.saveFile({ id: uid(), ws: wsId, blockId, name: f.name, type: f.type, size: f.size, kind: f.kind, blob, createdAt: f.createdAt || now });
    }
    return { wsId, name };
  }
  function validWorkspaceData(data) {
    return data && (data.app === 'NotesGallery' || data.app === 'BlockNotes') && Array.isArray(data.blocks);
  }

  // Fallback import (no file link) via a normal file input.
  async function importWorkspaceFile(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (_) { toast('That file is not valid JSON.'); return; }
    if (!validWorkspaceData(data)) { toast('Not a Notes Gallery workspace file.'); return; }
    const { name } = await createWorkspaceFromData(data);
    toast(`Imported “${name}”`);
    await renderHome();
  }

  // Import via the File System Access API and BIND the file so edits save back.
  async function importViaPicker() {
    if (!FS_OK) { $('#import-input').click(); return; }
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({ types: [{ description: 'Notes Gallery workspace', accept: { 'application/json': ['.json'] } }] });
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // user cancelled
      console.warn('showOpenFilePicker failed:', e);
      $('#import-input').click();                 // fall back to the plain file dialog
      return;
    }
    let data;
    try { data = JSON.parse(await (await handle.getFile()).text()); }
    catch (_) { toast('That file is not valid JSON.'); return; }
    if (!validWorkspaceData(data)) { toast('Not a Notes Gallery workspace file.'); return; }
    const { wsId, name } = await createWorkspaceFromData(data);
    await DB.saveHandleRec(wsId, handle);   // future saves write back to this file
    toast(`Imported “${name}” (linked to file)`);
    await renderHome();
  }

  /* ---- autosave / manual (Ctrl+S) save -------------------------------- */
  let autoSaveTimer = null;
  // 3-state light: grey = autosave off, red = unsaved changes, blue = autosave on
  function setSaveState() {
    const el = $('#save-status');
    if (!el) return;
    if (state.ws == null) { el.className = 'save-status-pill'; el.title = ''; return; }
    let cls, title;
    if (state.dirty) { cls = 'red'; title = 'Unsaved changes — press Ctrl+S'; }
    else if (state.autosave) { cls = 'blue'; title = 'Autosave on'; }
    else { cls = 'grey'; title = 'Autosave off'; }
    el.className = 'save-status-pill ' + cls;
    el.title = title;
  }
  async function saveCurrentWorkspace(manual) {
    if (state.ws == null) return;
    const rec = await DB.getHandleRec(state.ws);
    if (!rec || !rec.handle) {
      state.dirty = false;
      setSaveState();
      if (manual) toast('This workspace has no linked file — use ⋯ → Export to save a copy.');
      return;
    }
    const ok = await ensurePermission(rec.handle, 'readwrite');
    if (!ok) { state.dirty = true; setSaveState(); if (manual) toast('Permission to write the file was denied.'); return; }
    try {
      const payload = await workspacePayload(state.ws);
      await writeToHandle(rec.handle, payload);
      state.dirty = false;
      setSaveState();
    } catch (e) {
      console.error(e);
      state.dirty = true;
      setSaveState();
      if (manual) toast('Could not write the file.');
    }
  }
  // called after any edit; schedules a save (autosave) or flags dirty (manual)
  function markChanged() {
    if (state.ws == null) return;
    if (state.autosave) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => saveCurrentWorkspace(false), 900);
    } else {
      state.dirty = true;
    }
    setSaveState();
  }
  async function refreshSaveUi() { setSaveState(); }
  function bindAutosave() {
    let on = true;
    try { const v = localStorage.getItem('ng-autosave'); if (v != null) on = v === '1'; } catch (_) {}
    state.autosave = on;
    const cb = $('#autosave');
    cb.checked = on;
    cb.addEventListener('change', () => {
      state.autosave = cb.checked;
      try { localStorage.setItem('ng-autosave', state.autosave ? '1' : '0'); } catch (_) {}
      if (state.autosave && state.dirty) saveCurrentWorkspace(true);
      setSaveState();
    });
  }

  /* ---------------------------- workspaces / home ---------------------- */
  const pickWsColor = (n) => PALETTE[n % PALETTE.length];

  // remember where the user is, so a refresh restores it
  function saveLoc() {
    try { localStorage.setItem('ng-loc', JSON.stringify({ ws: state.ws, level: state.level })); } catch (_) {}
  }
  function readLoc() {
    try { return JSON.parse(localStorage.getItem('ng-loc') || 'null'); } catch (_) { return null; }
  }
  async function restoreOrHome() {
    const loc = readLoc();
    if (loc && loc.ws) {
      const w = await DB.getWorkspace(loc.ws);
      if (w) {
        state.ws = loc.ws; state.wsName = w.name;
        clearHistory();
        document.getElementById('app').classList.remove('home-mode');
        $('#home').hidden = true; $('#stage').hidden = false;
        let level = loc.level || DB.ROOT;
        if (level !== DB.ROOT) {
          const lb = await DB.getBlock(level);
          if (!lb || lb.ws !== loc.ws) level = DB.ROOT;   // level was deleted → fall back to root
        }
        await loadLevel(level, { fit: true });
        initNav(level);
        state.dirty = false;
        refreshSaveUi();
        return;
      }
    }
    await goHome();
  }

  /* ---- hero intro: typing tagline + shared-element flip to the top bar - */
  const HERO_TAG = 'An infinite page that never asks you to be tidy.\nDrag, link, nest. Nothing is filed until you decide it is.';
  let typeTimer = null;
  function startTyping() {
    const el = $('#hero-tag');
    if (!el) return;
    clearTimeout(typeTimer);
    el.textContent = ''; el.classList.add('typing');
    let i = 0;
    const tick = () => {
      el.textContent = HERO_TAG.slice(0, i);
      if (i >= HERO_TAG.length) { el.classList.remove('typing'); return; }
      const justTyped = HERO_TAG[i];
      i++;
      typeTimer = setTimeout(tick, justTyped === '\n' ? 320 : (justTyped === '.' ? 180 : 24));
    };
    tick();
  }
  function stopTyping() { clearTimeout(typeTimer); const el = $('#hero-tag'); if (el) el.classList.remove('typing'); }

  async function goHome() {
    state.ws = null; state.wsName = '';
    clearHistory();
    closeDrawer(); hideSearchResults();
    $('#menu').hidden = true; $('#add-menu').hidden = true; $('#brand-menu').hidden = true;
    if (state.linkMode) setLinkMode(false);
    clearTimeout(autoSaveTimer);
    state.dirty = false;
    setSaveState('', '');
    document.getElementById('app').classList.add('home-mode');
    $('#stage').hidden = true;
    $('#home').hidden = false;
    saveLoc();
    await renderHome();
    startTyping();
  }

  async function openWorkspace(id) {
    const w = await DB.getWorkspace(id);
    if (!w) return;
    state.ws = id; state.wsName = w.name;
    clearHistory();
    stopTyping();
    $('#brand-menu').hidden = true;
    document.getElementById('app').classList.remove('home-mode');
    $('#home').hidden = true;
    $('#stage').hidden = false;
    await loadLevel(DB.ROOT, { fit: true });
    initNav(DB.ROOT);
    state.dirty = false;
    refreshSaveUi();
  }

  async function renderHome() {
    const note = $('#fs-note');
    if (note) {
      const fs = fsStatus();
      note.textContent = (fs.ok ? 'File saving ON — ' : 'File saving OFF — ') + fs.why;
      note.className = 'fs-note ' + (fs.ok ? 'ok' : 'warn');
    }
    const grid = $('#ws-grid');
    const wss = await DB.listWorkspaces();
    wss.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const counts = {};
    await Promise.all(wss.map(async w => { counts[w.id] = (await DB.allByWs('blocks', w.id)).length; }));
    grid.innerHTML = '';
    for (const w of wss) {
      const card = document.createElement('div');
      card.className = 'ws-card';
      card.dataset.ws = w.id;
      card.style.setProperty('--b-accent', w.color || PALETTE[0]);
      const n = counts[w.id] || 0;
      card.innerHTML = `
        <div class="ws-card-top">
          <span class="ws-ico">${ic('diary')}</span>
          <div class="ws-card-actions">
            <button data-wact="properties" title="Properties">${ic('sliders')}</button>
            <button data-wact="export" title="Export">${ic('upload')}</button>
            <button data-wact="delete" title="Delete">${ic('trash')}</button>
          </div>
        </div>
        <div class="ws-name">${esc(w.name || 'Untitled')}</div>
        <div class="ws-meta">${n} block${n === 1 ? '' : 's'}</div>`;
      grid.appendChild(card);
    }
    const add = document.createElement('button');
    add.className = 'ws-add'; add.id = 'ws-add';
    add.innerHTML = `${ic('plus')}<span>New workspace</span>`;
    grid.appendChild(add);
  }

  async function newWorkspaceFlow() {
    const count = (await DB.listWorkspaces()).length;
    promptDialog('New Workspace', '', async (name, color) => {
      name = (name || '').trim() || 'Untitled workspace';
      const chosen = color || pickWsColor(count);
      let handle = null;
      if (FS_OK) {
        try {
          handle = await window.showSaveFilePicker({
            suggestedName: safeFileName(name) + '.notesgallery.json',
            types: [{ description: 'Notes Gallery workspace', accept: { 'application/json': ['.json'] } }],
          });
        } catch (e) {
          if (e && e.name === 'AbortError') return;   // user cancelled the picker
          console.warn('showSaveFilePicker failed:', e);
          toast('File picker blocked here — open via the launcher in Chrome/Edge. Created in-browser for now.');
        }
      } else {
        toast('Saving to a file needs Chrome/Edge opened via the launcher — created in-browser for now.');
      }
      const id = uid();
      const now = Date.now();
      await DB.saveWorkspace({ id, name, color: chosen, createdAt: now, updatedAt: now });
      if (handle) await DB.saveHandleRec(id, handle);
      await openWorkspace(id);              // jump straight into the new workspace
      if (handle) await saveCurrentWorkspace(false);   // write the initial file now
    }, { colors: true, color: pickWsColor(count), okLabel: 'Create' });
  }

  /* ---- workspace Properties dialog (name, colour, file location) ------ */
  let propsWs = null, propsColor = null;
  function renderPropsColors(active) {
    const wrap = $('#props-colors');
    wrap.innerHTML = '';
    PALETTE.forEach(col => {
      const s = document.createElement('div');
      s.className = 'swatch' + (col === active ? ' active' : '');
      s.style.background = col;
      s.addEventListener('click', () => { propsColor = col; renderPropsColors(col); });
      wrap.appendChild(s);
    });
  }
  async function openProperties(id) {
    const w = await DB.getWorkspace(id);
    if (!w) return;
    propsWs = id;
    propsColor = w.color || PALETTE[0];
    $('#props-name').value = w.name || '';
    renderPropsColors(propsColor);
    const rec = await DB.getHandleRec(id);
    const loc = $('#props-loc');
    if (rec && rec.handle) loc.innerHTML = esc(rec.handle.name) + ' <span class="muted">(the folder is hidden by the browser)</span>';
    else loc.innerHTML = '<span class="muted">Stored in this browser — not linked to a file</span>';
    $('#props').hidden = false;
    setTimeout(() => { $('#props-name').focus(); $('#props-name').select(); }, 50);
  }
  function bindProps() {
    const close = () => { $('#props').hidden = true; propsWs = null; };
    $('#props-cancel').addEventListener('click', close);
    $('#props').addEventListener('mousedown', (e) => { if (e.target.id === 'props') close(); });
    $('#props-save').addEventListener('click', async () => {
      if (!propsWs) { close(); return; }
      const w = await DB.getWorkspace(propsWs);
      if (!w) { close(); return; }
      const name = ($('#props-name').value || '').trim();
      w.name = name || w.name;
      w.color = propsColor || w.color;
      w.updatedAt = Date.now();
      await DB.saveWorkspace(w);
      if (state.ws === propsWs) { state.wsName = w.name; renderBreadcrumbs(); markChanged(); }
      const wasHome = !$('#home').hidden;
      close();
      if (wasHome) await renderHome();
      toast('Workspace updated');
    });
  }

  async function deleteWorkspaceFlow(id) {
    const w = await DB.getWorkspace(id);
    confirmDialog(`Delete “${(w && w.name) || 'workspace'}”?`,
      'This permanently removes the workspace and everything inside it. This cannot be undone.', 'Delete', async () => {
        await DB.deleteWorkspaceDeep(id);
        if (state.ws === id) await goHome(); else await renderHome();
        toast('Workspace deleted');
      });
  }

  function onWsGridClick(e) {
    if (e.target.closest('#ws-add')) { newWorkspaceFlow(); return; }
    const card = e.target.closest('.ws-card');
    if (!card) return;
    const act = e.target.closest('[data-wact]');
    if (act) {
      e.stopPropagation();
      const id = card.dataset.ws;
      if (act.dataset.wact === 'properties') openProperties(id);
      else if (act.dataset.wact === 'export') exportWorkspaceFlow(id);
      else if (act.dataset.wact === 'delete') deleteWorkspaceFlow(id);
      return;
    }
    openWorkspace(card.dataset.ws);
  }

  function bindHome() {
    $('#brand').addEventListener('click', goHome);
    $('#home-new').addEventListener('click', newWorkspaceFlow);
    $('#home-import').addEventListener('click', importViaPicker);
    $('#ws-grid').addEventListener('click', onWsGridClick);
  }

  /* ---- workspace switcher (hover the logo, when inside a workspace) ---- */
  let brandHideTimer = null;
  async function openBrandMenu() {
    if (state.ws == null) return;              // no switcher on the landing screen
    const menu = $('#brand-menu');
    const wss = await DB.listWorkspaces();
    wss.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    let html = '<div class="bm-head">Switch workspace</div>';
    for (const w of wss) {
      html += `<button class="bm-item${w.id === state.ws ? ' active' : ''}" data-ws="${esc(w.id)}">` +
              `<span class="bm-dot" style="background:${esc(w.color || PALETTE[0])}"></span>` +
              `<span class="bm-t">${esc(w.name || 'Untitled')}</span></button>`;
    }
    html += '<div class="menu-sep"></div>';
    html += `<button class="bm-item" data-bm="new"><span data-icon="plus"></span><span>New workspace</span></button>`;
    html += `<button class="bm-item" data-bm="home"><span data-icon="frame"></span><span>All workspaces</span></button>`;
    menu.innerHTML = html;
    hydrateIcons(menu);
    const a = $('#brand').getBoundingClientRect();
    menu.hidden = false;
    menu.style.right = 'auto';
    menu.style.left = a.left + 'px';
    menu.style.top = (a.bottom + 6) + 'px';
  }
  function hideBrandMenu() { $('#brand-menu').hidden = true; }

  function bindBrandMenu() {
    const brand = $('#brand');
    const menu = $('#brand-menu');
    brand.addEventListener('mouseenter', () => { clearTimeout(brandHideTimer); openBrandMenu(); });
    brand.addEventListener('mouseleave', () => { brandHideTimer = setTimeout(hideBrandMenu, 180); });
    menu.addEventListener('mouseenter', () => clearTimeout(brandHideTimer));
    menu.addEventListener('mouseleave', () => { brandHideTimer = setTimeout(hideBrandMenu, 180); });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-ws]');
      if (item) { hideBrandMenu(); openWorkspace(item.dataset.ws); return; }
      const b = e.target.closest('[data-bm]');
      if (!b) return;
      hideBrandMenu();
      if (b.dataset.bm === 'new') newWorkspaceFlow();
      else if (b.dataset.bm === 'home') goHome();
    });
    document.addEventListener('click', (e) => {
      if (menu.hidden) return;
      if (!menu.contains(e.target) && !brand.contains(e.target)) hideBrandMenu();
    });
  }

  /* ---------------------------- prompt dialog -------------------------- */
  let promptCb = null;
  let promptColor = null;
  function renderPromptColors(active) {
    const wrap = $('#prompt-colors');
    wrap.innerHTML = '';
    PALETTE.forEach(col => {
      const s = document.createElement('div');
      s.className = 'swatch' + (col === active ? ' active' : '');
      s.style.background = col;
      s.addEventListener('click', () => { promptColor = col; renderPromptColors(col); });
      wrap.appendChild(s);
    });
  }
  // opts: { colors: true, color: '#..', okLabel: 'Create' }. cb receives (name, color).
  function promptDialog(title, value, cb, opts = {}) {
    $('#prompt-title').textContent = title;
    const inp = $('#prompt-input');
    inp.value = value || '';
    promptCb = cb;
    const wantColors = !!opts.colors;
    $('#prompt-color-wrap').hidden = !wantColors;
    if (wantColors) { promptColor = opts.color || PALETTE[0]; renderPromptColors(promptColor); }
    else promptColor = null;
    $('#prompt-ok').textContent = opts.okLabel || 'Save';
    $('#prompt').hidden = false;
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  }
  function bindPrompt() {
    $('#prompt-cancel').addEventListener('click', () => { $('#prompt').hidden = true; promptCb = null; });
    $('#prompt-ok').addEventListener('click', () => {
      const v = $('#prompt-input').value;
      $('#prompt').hidden = true;
      const cb = promptCb; promptCb = null;
      if (cb) cb(v, promptColor);
    });
    $('#prompt-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#prompt-ok').click(); } });
  }

  /* ---------------------------- dialogs / toast ------------------------ */
  let confirmCb = null;
  function confirmDialog(title, msg, okLabel, cb, okKind) {
    $('#confirm-title').textContent = title;
    $('#confirm-msg').innerHTML = msg;
    const ok = $('#confirm-ok');
    ok.textContent = okLabel || 'OK';
    ok.className = 'btn ' + (okKind === 'primary' ? 'primary' : 'danger');
    confirmCb = cb;
    $('#confirm').hidden = false;
    setTimeout(() => $('#confirm-ok').focus(), 40);   // Enter confirms
  }
  function bindConfirm() {
    $('#confirm-cancel').addEventListener('click', () => { $('#confirm').hidden = true; confirmCb = null; });
    $('#confirm-ok').addEventListener('click', async () => { $('#confirm').hidden = true; const cb = confirmCb; confirmCb = null; if (cb) await cb(); });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.hidden = true, 220); }, 2200);
  }

  /* ---------------------------- theme ---------------------------------- */
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('#btn-theme').innerHTML = ic(theme === 'dark' ? 'moon' : 'sun');
    try { localStorage.setItem('bn-theme', theme); } catch (_) {}
  }
  function initTheme() {
    let t;
    try { t = localStorage.getItem('bn-theme'); } catch (_) {}
    if (!t) t = matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(t);
  }

  function updateSnapLabel() { const el = $('#snap-state'); if (el) el.textContent = snapOn ? '· on' : '· off'; }

  /* ---------------------------- menu ----------------------------------- */
  function bindMenu() {
    const menu = $('#menu');
    $('#btn-menu').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const act = btn.dataset.act;
      menu.hidden = true;
      if (act === 'export') exportWorkspaceFlow(state.ws);
      if (act === 'properties') openProperties(state.ws);
      if (act === 'add-child') createBlock('block');
      if (act === 'snap') { snapOn = !snapOn; try { localStorage.setItem('ng-snap', snapOn ? '1' : '0'); } catch (_) {} updateSnapLabel(); toast(snapOn ? 'Snap to grid on' : 'Snap to grid off'); }
      if (act === 'properties') openProperties(state.ws);
      if (act === 'about') openAbout('about');
      if (act === 'help') openAbout('help');
    });
    updateSnapLabel();
    $('#import-input').addEventListener('change', (e) => { if (e.target.files[0]) importWorkspaceFile(e.target.files[0]); e.target.value = ''; });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target.id !== 'btn-menu') menu.hidden = true;
      if (!e.target.closest('.search')) hideSearchResults();
    });
  }

  /* ---------------------------- about / help --------------------------- */
  function showAboutTab(tab) {
    $$('#about-tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#tab-about').classList.toggle('active', tab === 'about');
    $('#tab-help').classList.toggle('active', tab === 'help');
  }
  async function fillAboutPanel() {
    const p = $('#tab-about');
    if (state.ws == null) { p.innerHTML = '<p class="muted">Open a workspace to see its details here.</p>'; return; }
    const w = await DB.getWorkspace(state.ws);
    const blocks = await DB.allByWs('blocks', state.ws);
    const rec = await DB.getHandleRec(state.ws);
    const loc = (rec && rec.handle)
      ? esc(rec.handle.name) + ' <span class="muted">(folder hidden by the browser)</span>'
      : '<span class="muted">Stored in this browser — no linked file</span>';
    const created = w && w.createdAt ? new Date(w.createdAt).toLocaleString() : '—';
    p.innerHTML = `
      <dl class="about-props">
        <div><dt>Name</dt><dd>${esc((w && w.name) || 'Untitled')}</dd></div>
        <div><dt>Color</dt><dd><span class="prop-dot" style="background:${esc((w && w.color) || PALETTE[0])}"></span>${esc((w && w.color) || '')}</dd></div>
        <div><dt>Blocks</dt><dd>${blocks.length}</dd></div>
        <div><dt>Created</dt><dd>${esc(created)}</dd></div>
        <div><dt>File</dt><dd>${loc}</dd></div>
      </dl>`;
  }
  async function openAbout(tab) {
    await fillAboutPanel();
    showAboutTab(tab || 'help');
    $('#about').hidden = false;
  }
  function bindAbout() {
    const close = () => { $('#about').hidden = true; };
    $('#about-close').addEventListener('click', close);
    $('#about-x').addEventListener('click', close);
    $('#about').addEventListener('mousedown', (e) => { if (e.target.id === 'about') close(); });
    $$('#about-tabs .tab').forEach(b => b.addEventListener('click', () => showAboutTab(b.dataset.tab)));
  }

  /* ---------------------------- keyboard ------------------------------- */
  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === 'Escape') {
        if (!$('#ctxmenu').hidden) { hideCtxMenu(); }
        else if (!$('#prompt').hidden) { $('#prompt').hidden = true; promptCb = null; }
        else if (!$('#props').hidden) { $('#props').hidden = true; propsWs = null; }
        else if (!$('#confirm').hidden) { $('#confirm').hidden = true; confirmCb = null; }
        else if (!$('#about').hidden) $('#about').hidden = true;
        else if (state.linkMode) setLinkMode(false);
        else if (!$('#text-drawer').hidden) closeTextEditor();
        else if (!$('#shape-drawer').hidden) closeShapeEditor();
        else if (!$('#image-drawer').hidden) closeImageEditor();
        else if (!$('#drawer').hidden) closeDrawer();
        else if (state.selectedIds.size) clearSelection();
        else hideSearchResults();
        return;
      }
      if (typing) return;
      if (state.ws == null) return;   // no canvas shortcuts on the landing screen
      if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveCurrentWorkspace(true); return; }
      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey)) ||
          ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && state.levelLayout === 'canvas') {
        e.preventDefault(); setSelection(state.blocks.map(b => b.id));
      }
      if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
        if (state.selectedIds.size) { e.preventDefault(); copySelection(); } return;
      }
      if ((e.key === 'x' || e.key === 'X') && (e.ctrlKey || e.metaKey)) {
        if (state.selectedIds.size) { e.preventDefault(); cutSelection(); } return;
      }
      if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
        if (clipboard) { e.preventDefault(); pasteClipboard(); } return;
      }
      if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
        if (state.selectedIds.size && state.levelLayout === 'canvas') { e.preventDefault(); duplicateSelection(); } return;
      }
      if (e.key === ']' && (e.ctrlKey || e.metaKey)) { if (state.selectedIds.size) { e.preventDefault(); (e.shiftKey ? bringToFront : bringForward)([...state.selectedIds]); } return; }
      if (e.key === '[' && (e.ctrlKey || e.metaKey)) { if (state.selectedIds.size) { e.preventDefault(); (e.shiftKey ? sendToBack : sendBackward)([...state.selectedIds]); } return; }
      // arrow-key nudge (canvas only)
      if (/^Arrow/.test(e.key) && state.selectedIds.size && state.levelLayout === 'canvas') {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelection(dx, dy);
        return;
      }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); createBlock('block'); }
      if (e.key === 'l' || e.key === 'L') setLinkMode(!state.linkMode);
      if (e.key === 'f' || e.key === 'F') fitToView();
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIds.size) deleteSelected();
      if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    });
  }

  /* ---------------------------- add popover ---------------------------- */
  let addHideTimer = null;
  function openAddMenu(anchor) {
    const menu = $('#add-menu');
    menu.hidden = false;
    const a = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth || 250;
    let left = a.left;
    left = Math.min(left, window.innerWidth - mw - 10);
    left = Math.max(10, left);
    menu.style.left = left + 'px';
    menu.style.top = (a.bottom + 6) + 'px';
  }
  function hideAddMenu() { $('#add-menu').hidden = true; }
  function scheduleHideAdd() { clearTimeout(addHideTimer); addHideTimer = setTimeout(hideAddMenu, 180); }
  function cancelHideAdd() { clearTimeout(addHideTimer); }

  function bindAddMenu() {
    const btn = $('#btn-add');
    const menu = $('#add-menu');
    // hover (desktop) + click/tap (touch) both reveal it
    btn.addEventListener('mouseenter', () => { cancelHideAdd(); openAddMenu(btn); });
    btn.addEventListener('mouseleave', scheduleHideAdd);
    menu.addEventListener('mouseenter', cancelHideAdd);
    menu.addEventListener('mouseleave', scheduleHideAdd);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) openAddMenu(btn); else hideAddMenu();
    });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-add]'); if (!item) return;
      hideAddMenu();
      if (item.dataset.add === 'image') pickImage();
      else createBlock(item.dataset.add);
    });
    document.addEventListener('click', (e) => {
      if (menu.hidden) return;
      if (!menu.contains(e.target) && !btn.contains(e.target) && !e.target.closest('#list-add')) hideAddMenu();
    });
  }

  function bindListView() {
    const view = $('#list-view');
    view.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) { e.stopPropagation(); openAnyEditor(editBtn.dataset.edit); return; }
      const openBtn = e.target.closest('[data-open]');
      if (openBtn) { e.stopPropagation(); navigateTo(openBtn.dataset.open); return; }
      const addBtn = e.target.closest('#list-add');
      if (addBtn) { e.stopPropagation(); openAddMenu(addBtn); return; }
      const row = e.target.closest('.list-row');
      if (row) selectBlock(row.dataset.id);
    });
    view.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.list-row');
      if (!row) return;
      const b = state.blocks.find(x => x.id === row.dataset.id);
      if (b && b.kind === 'text') openTextEditor(b.id); else navigateTo(row.dataset.id);
    });
  }

  /* ---------------------------- init ----------------------------------- */
  function bindToolbar() {
    $('#btn-back').addEventListener('click', navBack);
    $('#btn-forward').addEventListener('click', navForward);
    $('#btn-home').addEventListener('click', () => navigateTo(DB.ROOT));
    $('#btn-link').addEventListener('click', () => setLinkMode(!state.linkMode));
    $('#link-exit').addEventListener('click', () => setLinkMode(false));
    $('#btn-fit').addEventListener('click', fitToView);
    $('#btn-help').addEventListener('click', () => openAbout('help'));
    $('#btn-theme').addEventListener('click', () =>
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
    const r = () => stage.getBoundingClientRect();
    $('#btn-zoom-in').addEventListener('click',  () => zoomAt(r().width / 2, r().height / 2, 1.18));
    $('#btn-zoom-out').addEventListener('click', () => zoomAt(r().width / 2, r().height / 2, 1 / 1.18));
    $('#btn-zoom-reset').addEventListener('click', () => {
      const c = centerOfView();
      state.view.scale = 1;
      const rr = r();
      state.view.tx = rr.width / 2 - c.x; state.view.ty = rr.height / 2 - c.y;
      applyView();
    });
  }

  function bindStage() {
    stage.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('click', onStageClick);
    stage.addEventListener('dblclick', onDblClick);
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    // drag-and-drop images from the OS onto the canvas
    stage.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; stage.classList.add('drop-active');
      }
    });
    stage.addEventListener('dragleave', (e) => { if (e.target === stage) stage.classList.remove('drop-active'); });
    stage.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) { e.preventDefault(); stage.classList.remove('drop-active'); dropImageFiles(files, e.clientX, e.clientY); }
    });
    window.addEventListener('beforeunload', (e) => {
      objectUrls.forEach(u => URL.revokeObjectURL(u));
      if (state.ws != null && !state.autosave && state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // Register the service worker (offline / installable). Secure contexts only.
  function registerSW() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW register failed:', e));
    });
  }

  async function init() {
    hydrateIcons();
    registerSW();
    initTheme();
    document.getElementById('app').classList.add('home-mode');   // avoid canvas flash before landing loads
    $('#stage').hidden = true;
    bindToolbar(); bindStage(); bindDrawerFields(); bindFileInputs();
    bindSearch(); bindMenu(); bindConfirm(); bindKeys();
    bindAddMenu(); bindListView(); bindHome(); bindPrompt(); bindBrandMenu(); bindAutosave(); bindProps(); bindAbout(); bindContextMenu();
    bindTextEditor(); bindShapeEditor(); bindImageEditor(); bindImagePaste();
    try {
      await DB.open();
    } catch (err) {
      console.error(err);
      document.getElementById('app').classList.add('home-mode');
      $('#stage').hidden = true; $('#home').hidden = false;
      $('#ws-grid').innerHTML =
        `<div class="home-empty"><b>Storage unavailable.</b> Your browser blocked local storage for this file.
         Try Chrome or Edge, or run the optional launcher (see README).</div>`;
      return;
    }
    await restoreOrHome();   // reopen the last workspace/level, or the landing screen
  }

  document.addEventListener('DOMContentLoaded', init);
})();
