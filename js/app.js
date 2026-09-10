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

  // ---- tiny, safe Markdown renderer (escape first, then limited inline/block rules)
  function mdInline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$1" data-href="$2" class="md-link">$1</a>');
    return s;
  }
  function mdToHtml(src) {
    const lines = String(src || '').split(/\r?\n/);
    let html = '', list = null;   // list: 'ul' | 'ol' | 'todo'
    const closeList = () => { if (list) { html += list === 'ol' ? '</ol>' : '</ul>'; list = null; } };
    for (let raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { closeList(); continue; }
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { closeList(); const n = m[1].length; html += `<h${n + 2} class="md-h">${mdInline(m[2])}</h${n + 2}>`; continue; }
      if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
        if (list !== 'todo') { closeList(); html += '<ul class="md-todo">'; list = 'todo'; }
        const done = m[1].toLowerCase() === 'x';
        html += `<li class="${done ? 'done' : ''}"><span class="md-box">${done ? '☑' : '☐'}</span> ${mdInline(m[2])}</li>`;
        continue;
      }
      if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${mdInline(m[1])}</li>`; continue; }
      if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${mdInline(m[1])}</li>`; continue; }
      closeList(); html += `<p>${mdInline(line)}</p>`;
    }
    closeList();
    return html;
  }
  // checklist progress from notes markdown → {done,total} or null
  function todoProgress(src) {
    const items = String(src || '').match(/^\s*[-*]\s+\[( |x|X)\]/gm);
    if (!items || !items.length) return null;
    const done = (String(src).match(/^\s*[-*]\s+\[(x|X)\]/gm) || []).length;
    return { done, total: items.length };
  }
  // parse comma/space separated tags string → array
  const parseTags = (s) => String(s || '').split(/[,\n]/).map(t => t.trim().replace(/^#/, '')).filter(Boolean);

  /* ---- line-icon set (stroke SVGs, sized via CSS .ic) ------------------ */
  const ICON = {
    diary: '<path d="M5.5 9.6V5.6A2.1 2.1 0 0 1 7.6 3.5H14.2L19.8 9.1V15.2L14.6 20.5H10.4"/><path d="M14.2 3.5V9.1H19.8Z" fill="currentColor" fill-opacity=".8" stroke="none"/><path d="M19.8 15.2H14.6V20.5Z" fill="currentColor" fill-opacity=".8" stroke="none"/><path d="M3.2 20.8L6.1 13.5C6.8 11.8 8.3 10.7 10.1 10.7H12.5V13.1C12.5 15.1 11.5 16.9 9.8 18Z"/><path d="M3.2 20.8L8.3 15.7"/><path d="M9.9 14.1L13.7 10.3"/><path d="M15.9 8.1L12.3 8.7L15.3 11.7Z" fill="currentColor" stroke="none"/><circle cx="8.8" cy="15.2" r="1.35" fill="var(--accent)" stroke="none"/>',
    chev: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
    checkbox: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.2 12.2l2.6 2.6 5-5.4"/>',
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
    filetext: '<path d="M13 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V8.5Z"/><polyline points="13 3.5 13 8.5 18 8.5"/><line x1="8.7" y1="12.5" x2="15.3" y2="12.5"/><line x1="8.7" y1="15" x2="15.3" y2="15"/><line x1="8.7" y1="17.5" x2="12.8" y2="17.5"/>',
    layers: '<path d="M12 3.5 20 8l-8 4.5L4 8Z"/><path d="M4 12l8 4.5L20 12"/>',
    clip: '<path d="M18 11.5 12 17.5a3.5 3.5 0 0 1-5-5l6.5-6.5a2.3 2.3 0 0 1 3.3 3.3L10 15.7a1.1 1.1 0 0 1-1.6-1.6l5.6-5.6"/>',
    pencil: '<path d="M4.8 19.2l1.5-4.7 9.8-9.8a2.3 2.3 0 0 1 3.2 0l.1.1a2.3 2.3 0 0 1 0 3.2l-9.8 9.8Z"/><path d="M6.3 14.5l3.2 3.2"/><path d="M14.2 6.6l3.2 3.2"/><path d="M4.8 19.2l1-3.2 2.2 2.2Z" fill="currentColor" stroke="none"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><line x1="9.5" y1="4.5" x2="9.5" y2="19.5"/><line x1="6" y1="8.2" x2="7.3" y2="8.2"/><line x1="6" y1="11" x2="7.3" y2="11"/>',
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
    'align-justify': '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
    shapes: '<rect x="3.5" y="9" width="11" height="11" rx="2"/><circle cx="16.5" cy="8" r="4.3"/>',
    rect: '<rect x="3.5" y="6.5" width="17" height="11" rx="2"/>',
    circle: '<circle cx="12" cy="12" r="8.5"/>',
    triangle: '<path d="M12 4.5 20.5 19H3.5Z"/>',
    star: '<path d="M12 3.6l2.6 5.2 5.8.9-4.2 4.1 1 5.7-5.2-2.7-5.2 2.7 1-5.7L3.6 9.7l5.8-.9z"/>',
    line: '<line x1="4.5" y1="19.5" x2="19.5" y2="4.5"/>',
    table: '<rect x="4" y="5" width="16" height="14" rx="2"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="5" x2="10" y2="19"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17l4.5-4.5 3 3L15 12l5 5"/>',
    pen: '<path d="M4.5 19.5l2.4-7.1a3.4 3.4 0 0 1 .8-1.3l6.6-6.6a2.7 2.7 0 0 1 3.8 0l1.4 1.4a2.7 2.7 0 0 1 0 3.8l-6.6 6.6a3.4 3.4 0 0 1-1.3.8Z"/><path d="M4.5 19.5l5.3-5.3"/><circle cx="11.2" cy="12.8" r="1.4"/>',
    eraser: '<path d="M7.7 19.3 4.4 16a2 2 0 0 1 0-2.8l7-7a2 2 0 0 1 2.8 0l5.1 5.1a2 2 0 0 1 0 2.8l-5.2 5.2H7.7Z"/><path d="M8.4 10.6l6 6"/><path d="M4 21h16"/>',
    'eraser-stroke': '<path d="M9.6 16.8 7 14.2a1.8 1.8 0 0 1 0-2.6l5.6-5.6a1.8 1.8 0 0 1 2.6 0l3.4 3.4a1.8 1.8 0 0 1 0 2.6l-4.8 4.8H9.6Z"/><path d="M9.9 9.5l4.6 4.6"/><path d="M2.5 20.2c1.5-1.8 3-1.8 4.5 0"/><path d="M13 20.2c1.5-1.8 3-1.8 4.5 0 .9 1.1 1.9 1.1 3 0"/>',
    'eraser-lasso': '<path d="M12 3.5c4.7 0 8.5 2.3 8.5 5.2S16.7 13.9 12 13.9 3.5 11.6 3.5 8.7 7.3 3.5 12 3.5Z" stroke-dasharray="2.4 2.2"/><path d="M10.4 21l-2.1-2.1a1.5 1.5 0 0 1 0-2.1l3.6-3.6a1.5 1.5 0 0 1 2.1 0l2.4 2.4a1.5 1.5 0 0 1 0 2.1L13.1 21h-2.7Z"/>',
    brush: '<path d="M11.7 12.3l6.6-6.6a1.9 1.9 0 0 1 2.7 2.7l-6.6 6.6"/><path d="M11.7 12.3l2.7 2.7"/><path d="M11.4 13.4c-2.9-.6-5 .9-5.5 3.3-.2 1.1-.8 1.9-1.7 2.4 2.2 1.1 5.6 1 7.4-.9 1.1-1.2 1.3-2.7.5-4.2Z"/>',
    highlighter: '<path d="M9.5 3.5h5.5a1 1 0 0 1 1 1V12l-1.6 3.6H10L8.5 12V4.5a1 1 0 0 1 1-1Z"/><path d="M8.5 8h7.5"/><path d="M10 15.6v2.4h4.4v-2.4"/><path d="M4 21h16" stroke-width="3" opacity=".55"/>',
    marker: '<path d="M4.5 19.5h7"/><path d="M9 16.5 6.8 14.3l7.5-7.5a2.4 2.4 0 0 1 3.4 0l.5.5a2.4 2.4 0 0 1 0 3.4L10.7 18.2Z"/>',
    hand: '<path d="M9 11V5.6a1.6 1.6 0 0 1 3.2 0V11m0-1.2V4.8a1.6 1.6 0 0 1 3.2 0V11m0-.8a1.6 1.6 0 0 1 3.2 0v4.4a5.6 5.6 0 0 1-5.6 5.6h-1a5 5 0 0 1-3.8-1.7L5 17.4a1.6 1.6 0 0 1 2.2-2.3L9 16.6V7.6a1.6 1.6 0 0 0-3.2 0V13"/>',
    select: '<path d="M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.2"/>',
    'align-top': '<line x1="4" y1="4" x2="20" y2="4"/><rect x="7" y="8" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="7" rx="1"/>',
    'align-middle': '<line x1="4" y1="12" x2="20" y2="12"/><rect x="7" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
    'align-bottom': '<line x1="4" y1="20" x2="20" y2="20"/><rect x="7" y="4" width="4" height="12" rx="1"/><rect x="14" y="9" width="4" height="7" rx="1"/>',
    'dist-h': '<line x1="3" y1="4" x2="3" y2="20"/><line x1="21" y1="4" x2="21" y2="20"/><rect x="10" y="8" width="4" height="8" rx="1"/>',
    'dist-v': '<line x1="4" y1="3" x2="20" y2="3"/><line x1="4" y1="21" x2="20" y2="21"/><rect x="8" y="10" width="8" height="4" rx="1"/>',
    group: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.6"/><rect x="11.5" y="11.5" width="9" height="9" rx="1.6"/>',
    ungroup: '<rect x="3.5" y="3.5" width="8" height="8" rx="1.6"/><rect x="12.5" y="12.5" width="8" height="8" rx="1.6" stroke-dasharray="2.5 2.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3.2"/>',
    redo: '<path d="M20 10H9.5A4.5 4.5 0 0 0 9.5 19H15"/><path d="M15.5 5.5 20 10l-4.5 4.5"/>',
    diamond: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12Z"/>',
    pentagon: '<path d="M12 3.5 20.5 9.7 17.2 19.8H6.8L3.5 9.7Z"/>',
    hexagon: '<path d="M8.2 4h7.6l3.8 8-3.8 8H8.2L4.4 12Z"/>',
    lasso: '<path d="M6.4 12.6C4 10.2 6.6 5.3 12.4 4.5c5.6-.8 9.8 2.3 9 5.5-.4 1.6-2 2.9-4.2 3.6"/><circle cx="5.6" cy="14.3" r="1.9"/><path d="M4.4 15.8l-1 2.6"/><path d="M11.5 10.6v10.6l2.7-2.8 2 3.6 1.9-1.1-2-3.6 3.5-.5Z" fill="currentColor" stroke="none"/>',
    grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
    expand: '<path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M9 20H4v-5"/><path d="M15 20h5v-5"/>',
    // exit full screen: four arrows from the corners pointing in at the centre
    compress: '<path d="M9.5 9.5L4.5 4.5M9.5 5.5v4h-4"/><path d="M14.5 9.5l5-5M14.5 5.5v4h4"/><path d="M9.5 14.5l-5 5M9.5 18.5v-4h-4"/><path d="M14.5 14.5l5 5M14.5 18.5v-4h4"/>',
    map: '<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><line x1="9" y1="4" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="20"/>',
    undo: '<path d="M4 8h9.5a5.5 5.5 0 0 1 0 11H8"/><polyline points="7.5 4 4 8 7.5 12"/>',
    front: '<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" stroke="none"/><path d="M4 14V5.5A1.5 1.5 0 0 1 5.5 4H14"/>',
    back: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M10 16h8.5A1.5 1.5 0 0 0 20 14.5V6" fill="none"/><rect x="10" y="10" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    unlock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.7-1.5"/>',
    forward: '<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" stroke="none"/><polyline points="6.5 6 10 9.5 6.5 13" fill="none"/>',
    backward: '<rect x="4" y="4" width="12" height="12" rx="2"/><polyline points="17.5 11 14 14.5 17.5 18" fill="none"/><rect x="10" y="10" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  };
  const FONT_STACK = {
    sans: '"Inter", ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif',
    serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, "Cascadia Code", "Consolas", "Courier New", monospace',
  };
  ICON['hand-off'] = ICON.hand + '<line x1="3.5" y1="3.5" x2="20.5" y2="20.5"/>';
  // the Select tool wears its mode: a small mark top-right of the lasso
  const LASSO_BASE = '<g transform="translate(-1 2.6) scale(.86)">' + ICON.lasso + '</g>';
  ICON['lasso-new'] = LASSO_BASE + '<rect x="16.6" y="1.6" width="5.8" height="5.8" rx="1.3"/><circle cx="19.5" cy="4.5" r="1" fill="currentColor" stroke="none"/>';
  ICON['lasso-add'] = LASSO_BASE + '<path d="M19.5 1.9v5.2M16.9 4.5h5.2"/>';
  ICON['lasso-remove'] = LASSO_BASE + '<path d="M16.9 4.5h5.2"/>';
  const ic = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;
  function hydrateIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => {
      if (el.getAttribute('data-icon-done')) return;
      el.innerHTML = ic(el.getAttribute('data-icon'));
      el.setAttribute('data-icon-done', '1');
    });
  }

  // Grouped by hue so the swatch grid reads as a spectrum rather than a jumble.
  const PALETTE = [
    '#3F8A66', // emerald     (the app's own accent — keep first)
    '#0ea5e9', // sky
    '#22d3ee', // cyan
    '#14b8a6', // teal
    '#10b981', // emerald
    '#22c38f', // green
    '#4ade80', // spring green
    '#84cc16', // lime
    '#a3b18a', // sage
    '#facc15', // yellow
    '#e9c46a', // honey
    '#f59e0b', // amber
    '#f97316', // orange
    '#e76f51', // terracotta
    '#ef4444', // red
    '#f43f5e', // rose
    '#ec4899', // pink
    '#d946ef', // magenta
    '#a855f7', // purple
    '#7c5cff', // violet
    '#4353ff', // indigo
    '#8a94a6', // slate
    '#b08968', // mocha
  ];
  // A spread across the spectrum for the draw panel, where space is tight.
  const PEN_COLORS = ['#2b7fff', '#22d3ee', '#10b981', '#84cc16', '#facc15',
                      '#f97316', '#ef4444', '#ec4899', '#a855f7', '#8a94a6'];
  const BLOCK_W = 210;
  const BLOCK_H_GUESS = 130;
  const GRID = 26;   // world-units grid step (matches the dot grid)
  let penColor = PALETTE[0], penWidth = 3;
  try { penColor = localStorage.getItem('ng-pen-color') || penColor; penWidth = +(localStorage.getItem('ng-pen-width')) || penWidth; } catch (_) {}

  /* --------------------------- pen styles ------------------------------ *
   * Each style maps the thickness slider (1-100%) onto a real stroke width
   * and its own look. `taper` styles render as a filled outline whose width
   * follows drawing speed (brush/marker feel); the rest are stroked paths.  */
  const PEN_STYLES = {
    pen:         { label: 'Ink pen',     icon: 'pen',         mul: 1,    min: 1,   opacity: 1,    cap: 'round',  taper: 0,    blend: '' },
    brush:       { label: 'Brush',       icon: 'brush',       mul: 2.1,  min: 1.5, opacity: .95,  cap: 'round',  taper: .55,  blend: '' },
    pencil:      { label: 'Pencil',      icon: 'pencil',      mul: .75,  min: 1,   opacity: .72,  cap: 'round',  taper: 0,    blend: '', grain: true },
    marker:      { label: 'Marker',      icon: 'marker',      mul: 1.7,  min: 2,   opacity: .92,  cap: 'square', taper: .18,  blend: '', hidden: true },
    highlighter: { label: 'Highlighter', icon: 'highlighter', mul: 3.4,  min: 6,   opacity: .3,   cap: 'round',  taper: 0,    blend: '' },
  };
  let penStyle = 'pen', penSize = 12;          // penSize is the 1-100% slider
  try {
    const ps = localStorage.getItem('ng-pen-style'); if (ps && PEN_STYLES[ps]) penStyle = ps;
    const sz = +(localStorage.getItem('ng-pen-size')); if (sz >= 1 && sz <= 100) penSize = sz;
  } catch (_) {}

  // slider % -> px for a style (1% is hairline, 100% is a broad sweep)
  function styleWidth(style, pct) {
    const s = PEN_STYLES[style] || PEN_STYLES.pen;
    return Math.max(s.min, Math.round((0.6 + (pct / 100) * 22) * s.mul * 10) / 10);
  }
  const curWidth = () => styleWidth(penStyle, penSize);

  // Apply a style's look to an SVG element (used live while drawing and when
  // repainting a saved stroke, so both always match exactly).
  function applyInkStyle(el, style, color, width) {
    const s = PEN_STYLES[style] || PEN_STYLES.pen;
    const filled = s.taper > 0;
    el.setAttribute('fill', filled ? color : 'none');
    el.setAttribute('stroke', filled ? 'none' : color);
    if (!filled) {
      el.setAttribute('stroke-width', width);
      el.setAttribute('stroke-linecap', s.cap);
      el.setAttribute('stroke-linejoin', 'round');
      if (s.grain) el.setAttribute('stroke-dasharray', (width * 1.1).toFixed(2) + ' ' + (width * 0.55).toFixed(2));
      else el.removeAttribute('stroke-dasharray');
    }
    el.setAttribute('opacity', s.opacity);
    el.style.mixBlendMode = s.blend || '';
  }

  /* How wide is the nib at this moment? One rule, shared by the live preview
     and the saved stroke, so the two can never disagree. Speed is real pen
     velocity in screen pixels per millisecond, which is zoom-independent. */
  const NIB_FAST = 2.6;                        // px/ms counts as a fast flick
  function nibFactor(vel, pressure, taper) {
    const f = 1 - taper * Math.min(1, (vel || 0) / NIB_FAST);   // faster -> thinner
    const pf = pressure ? (0.45 + 1.1 * pressure) : 1;          // harder -> thicker
    return Math.max(0.15, f * pf);
  }

  // Per-point half widths. Uses the factor recorded while writing when the
  // stroke has one (every stroke drawn in-app does); older strokes and
  // imports fall back to estimating it from the geometry.
  function taperWidths(P, half, taper) {
    const n = P.length, w = new Array(n);
    for (let i = 0; i < n; i++) {
      let k = P[i][3];
      if (!k) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
        const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
        k = nibFactor(span / 12, P[i][2], taper);
      }
      const ends = Math.min(1, Math.min(i, n - 1 - i) / 2);     // soften both tips
      w[i] = half * k * (0.55 + 0.45 * ends);
    }
    for (let k2 = 0; k2 < 2; k2++)
      for (let i = 1; i < n - 1; i++) w[i] = (w[i - 1] + w[i] * 2 + w[i + 1]) / 4;
    return w;
  }

  // Resample to a sensible spacing and smooth: adjacent raw samples are a
  // fraction of a pixel apart, and normals taken across them jitter, which is
  // what made the outline serrated.
  function taperCentreline(pts, width) {
    const minGap = Math.max(1.1, width * 0.45);
    const P = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const last = P[P.length - 1];
      if (Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) >= minGap) P.push(pts[i]);
    }
    const tail = pts[pts.length - 1];
    const lastKept = P[P.length - 1];
    if (lastKept !== tail && Math.hypot(tail[0] - lastKept[0], tail[1] - lastKept[1]) > 0.01) P.push(tail);
    if (P.length < 3) return P.map(q => [q[0], q[1], q[2] || 0]);
    const C = P.map((q, i) => {
      if (i === 0 || i === P.length - 1) return [q[0], q[1], q[2] || 0];
      const a = P[i - 1], b = P[i], c = P[i + 1];
      return [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, b[2] || 0];
    });
    return C;
  }

  // Filled outline for tapered styles: a smooth ribbon around the centreline.
  function inkTaperD(pts, width, taper) {
    if (!pts || pts.length < 2) return '';
    const C = taperCentreline(pts, width);
    const n = C.length;
    if (n < 2) return '';
    const half = width / 2;
    const w = taperWidths(C, half, taper);
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      // direction over a window, not between neighbours — steady normals
      const a = C[Math.max(0, i - 1)], b = C[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
      L.push([C[i][0] - dy * w[i], C[i][1] + dx * w[i]]);
      R.push([C[i][0] + dy * w[i], C[i][1] - dx * w[i]]);
    }
    // curved edges: quadratics through the midpoints of each side
    const side = (arr) => {
      let d = '';
      for (let i = 1; i < arr.length - 1; i++) {
        const mx = (arr[i][0] + arr[i + 1][0]) / 2, my = (arr[i][1] + arr[i + 1][1]) / 2;
        d += ` Q${arr[i][0].toFixed(1)} ${arr[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
      }
      const l = arr[arr.length - 1];
      return d + ` L${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
    };
    R.reverse();
    return `M${L[0][0].toFixed(1)} ${L[0][1].toFixed(1)}` + side(L) + side(R) + ' Z';
  }

  function updateShapeSnapBtn() {
    const b = $('#pen-snap'); if (!b) return;
    b.classList.toggle('active', shapeSnap);
    b.title = shapeSnap ? 'Shape snapping: on' : 'Shape snapping: off';
  }
  /* ------------------- palm + finger detection (Samsung-style) ---------- *
   * A palm resting on the screen makes a big, low-pressure contact — those
   * are dropped outright so they neither draw nor pan. Fingers draw until a
   * stylus is seen; from then on the stylus writes and fingers pan/zoom
   * instead (the "auto" mode most note apps use). The toolbar button forces
   * finger drawing on or off when auto isn't what you want.                */
  let sawStylus = false;                       // a real pen/stylus has been used
  let fingerDraw = 'off';                      // 'on' | 'off': do fingers draw, or only the stylus?
  try { const f = localStorage.getItem('ng-finger-draw'); if (f === 'on' || f === 'off') fingerDraw = f; } catch (_) {}
  // Said once per session, the first time a finger is turned away by a tool.
  let fingerHinted = false;
  function fingerHint() {
    if (fingerHinted || !(state.penMode || state.penEraser || state.selectTool)) return;
    fingerHinted = true;
    toast('Stylus only — tap the hand button in the toolbar to let fingers draw too');
  }

  function isPalm(e) {
    if (e.pointerType !== 'touch') return false;
    const w = e.width || 0, h = e.height || 0;
    if (w > 42 || h > 42) return true;                    // broad contact = palm/knuckle
    return w * h > 1500;                                  // large area, any shape
  }
  // Should this pointer lay down ink?
  function inkAccepts(e) {
    if (e.pointerType === 'pen') { sawStylus = true; return true; }
    if (e.pointerType === 'touch') {
      if (isPalm(e)) return false;
      if (fingerDraw !== 'on') { fingerHint(); return false; }   // stylus only: fingers navigate
      return true;
    }
    return true;                                              // mouse / trackpad
  }
  // Two buttons show and toggle the same state: #pen-touch (inside the draw
  // panel, only visible with the pen tool open) and #btn-finger (always on
  // the main toolbar, so turning fingers on doesn't require opening the pen
  // tool first).
  function updatePenTouchBtn() {
    const on = fingerDraw === 'on';
    for (const id of ['#pen-touch', '#btn-finger']) {
      const b = $(id); if (!b) continue;
      b.classList.toggle('active', on);
      b.innerHTML = ic(on ? 'hand' : 'hand-off');
      b.title = on ? 'Finger drawing: on — fingers draw as well as the stylus'
                   : 'Finger drawing: off — stylus only, fingers move the page';
    }
  }
  function toggleFingerDraw() {
    fingerDraw = fingerDraw === 'on' ? 'off' : 'on';
    try { localStorage.setItem('ng-finger-draw', fingerDraw); } catch (_) {}
    updatePenTouchBtn();
    toast(fingerDraw === 'on' ? 'Finger drawing on' : 'Finger drawing off — stylus only');
  }

  // The path data for a stroke, in whichever form its style needs.
  function inkStrokeD(pts, style, width) {
    const s = PEN_STYLES[style] || PEN_STYLES.pen;
    return s.taper > 0 ? inkTaperD(pts, width, s.taper) : inkPathD(pts);
  }
  let minimapOn = true;
  try { const v = localStorage.getItem('ng-minimap'); if (v != null) minimapOn = v === '1'; } catch (_) {}
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
    byId: new Map(),         // blockId -> block record (kept in sync with `blocks` at every mutation)
    edges: [],               // edges at current level
    childCounts: {},         // blockId -> {blocks, files}
    childPeek: {},           // blockId -> [{title,color}] first few children (for list previews)
    selectedIds: new Set(),  // multi-selection (canvas)
    tagFilter: null,         // active #tag filter (dims non-matching)
    penMode: false,          // freehand ink drawing mode
    penEraser: false,        // the eraser, with or without the draw panel
    readOnly: false,         // read mode: look and navigate only
    selectTool: false,       // toolbar Select tool: lasso-pick on the canvas
    view: { scale: 1, tx: 60, ty: 40 },
    linkMode: false,
    linkSrc: null,
    els: {},                 // blockId -> DOM element
  };

  const stage  = $('#stage');
  const world  = $('#world');
  const svg    = $('#edge-layer');

  /* ---------------------------- viewport ------------------------------- */
  // The writing surface: dots (default), grid, ruled lines or blank.
  function applyPaper(kind) {
    stage.dataset.paper = kind || 'dots';
  }

  function applyView() {
    if (inking) inking.sampler.rect = inking.rect = stage.getBoundingClientRect();
    if (NG.wet.pending.length) redrawInkStroke();
    const { scale, tx, ty } = state.view;
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    // The handles' counter-scale is a custom property on #world. Writing it
    // restyles everything that reads it, so it waits for the fingers during a
    // pinch - and while no handles are mounted (nothing reads it) it is not
    // written at all; mountChrome catches up.
    if (pinch || !chromeMounted()) invPending = true;
    else { world.style.setProperty('--inv', 1 / (scale || 1)); invPending = false; }
    const paper = stage.dataset.paper || 'dots';
    stage.style.backgroundSize = paper === 'lines'
      ? `100% ${30 * scale}px`
      : `${26 * scale}px ${26 * scale}px`;
    stage.style.backgroundPosition = `${tx}px ${ty}px`;
    positionSelBar();
    positionSelFrame();
    if (planesOn) requestPlaneRedraw(scale);
    if (NG.Overlay) NG.Overlay.draw();
    const pct = Math.round(scale * 100) + '%';
    $('#btn-zoom-reset').textContent = pct;
    scheduleMinimap();
    scheduleVirtApply();
  }
  let invPending = false;
  function flushInv() {
    if (invPending && !pinch && chromeMounted()) { invPending = false; world.style.setProperty('--inv', 1 / (state.view.scale || 1)); }
  }
  // is any block's chrome on the page right now?
  const chromeMounted = () => state.selectedIds.size > 0 || hoverChromeId != null;
  // a newly mounted handle needs the counter-scale the page skipped writing
  function syncInv() {
    if (!invPending || pinch) return;
    invPending = false;
    world.style.setProperty('--inv', 1 / (state.view.scale || 1));
  }
  let mmRAF = null;
  let mmAutoSuppressed = false;   // test-only: drive the mini-map by hand, with no race against its own cycle
  function scheduleMinimap() { if (mmAutoSuppressed || mmRAF) return; mmRAF = requestAnimationFrame(() => { mmRAF = null; drawMinimap(); }); }
  const screenToWorld = (sx, sy) => ({
    x: (sx - state.view.tx) / state.view.scale,
    y: (sy - state.view.ty) / state.view.scale,
  });
  function zoomAt(sx, sy, factor) {
    const before = screenToWorld(sx, sy);
    // Below 30% a huge workspace's rendering and panning gets visibly heavy
    // (every block's DOM element still has to exist somewhere on the page to
    // show as a dot), so the floor stops there rather than letting the view
    // shrink all the way down to a barely-legible speck.
    state.view.scale = clamp(state.view.scale * factor, 0.3, 64);
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
    if (levelId !== state.level) dropLiveGestures();   // a half stroke never lands on another page
    lastInk = null;                                    // word grouping never spans a page change
    state.level = levelId;
    state.levelBlock = levelId === DB.ROOT ? null : await DB.getBlock(levelId);
    state.levelLayout = (state.levelBlock && state.levelBlock.layout === 'list') ? 'list' : 'canvas';
    state.blocks = await DB.childBlocks(levelId, state.ws);
    state.byId = new Map(state.blocks.map(b => [b.id, b]));
    state.edges = await DB.levelEdges(levelId, state.ws);
    state.path = await DB.buildPath(levelId === DB.ROOT ? null : levelId);
    state.selectedIds.clear();
    // per-block counts + item previews for cards
    state.childCounts = {};
    state.childPeek = {};
    // one transaction for the whole level; only list cards show a peek
    {
      const ids = state.blocks.map(b => b.id);
      const peekIds = state.blocks.filter(b => b.layout === 'list').map(b => b.id);
      const stats = await DB.levelStats(ids, peekIds);
      for (const b of state.blocks) {
        state.childCounts[b.id] = stats.counts[b.id] || { blocks: 0, files: 0 };
        const kids = stats.peeks[b.id];
        if (kids) {
          kids.sort((a, c) => (a.createdAt || 0) - (c.createdAt || 0));
          state.childPeek[b.id] = kids.slice(0, 4).map(k => ({ title: k.title, color: k.color }));
        }
      }
    }

    const listMode = state.levelLayout === 'list';
    document.getElementById('app').classList.toggle('list-mode', listMode);
    stage.classList.toggle('list-mode', listMode);
    $('#world').hidden = listMode;
    $('#list-view').hidden = !listMode;
    if (state.linkMode && listMode) setLinkMode(false);
    if (state.penMode && listMode) setPenMode(false);

    state.tagFilter = null;   // filters are per-level
    renderBreadcrumbs();
    if (outlineOpen) renderOutline();
    if (listMode) {
      renderList();
    } else {
      renderBlocks();
      if (opts.fit) fitToView(); else applyView();
      drawEdges();
    }
    applyTagFilter();   // also hides the filter banner in list mode
    saveLoc();
    updateNavButtons();
  }

  /* ---------------------------- render blocks -------------------------- *
   * Every block used to get a real DOM element the moment a level opened,
   * whether or not it was anywhere near what you could actually see - and
   * every one of those elements sat under the browser's continuous per-frame
   * size-watch (ResizeObserver) for as long as the page stayed open. That
   * cost scaled with how much the PAGE held, not with how much of it you
   * were looking at. Below: only build what is actually near the viewport
   * (plus whatever is selected, mid-drag, or open in an editor - see
   * virtPinnedIds), and keep the rest as plain data with no DOM box at all
   * until it is scrolled near or otherwise needed. The mini-map's spatial
   * index (mmGrid, generalised to every block kind earlier tonight) is what
   * answers "what's near the viewport" - one query, not a scan.
   *
   * A block that already has an element never has it destroyed for merely
   * leaving view - it is hidden (display:none) and kept, because toggling is
   * far cheaper than rebuilding for content you pan back and forth over.
   * Only ink is treated differently here: it already has a working, shipped
   * rule (css/styles.css) that hides its DOM copy unless selected/dragging/
   * lifted, regardless of viewport - the canvas planes show the real pixels
   * either way, so an unselected stroke never needs to be *visible* just for
   * being on screen, only *built* the first time it is needed. So ink is
   * mounted here only through the "pinned" path below, never merely for
   * being near the viewport, and this code never touches its display style
   * directly (that CSS rule owns it - an inline override here would outlive
   * a later re-selection and fight it). */
  const VIEW_MARGIN = 500;             // world units of slack before mount/unmount, so panning never pops content in right at the edge
  let virtRAF = 0;

  function viewportWorldRect(marginWorld) {
    const r = stageRect();
    const s = state.view.scale || 1;
    const m = (marginWorld == null ? VIEW_MARGIN : marginWorld) / s;
    const x0 = (-state.view.tx) / s - m, y0 = (-state.view.ty) / s - m;
    return { x: x0, y: y0, w: r.width / s + 2 * m, h: r.height / s + 2 * m };
  }
  // Ids that must have a real element regardless of where they are: picked
  // up (selected), moving (drag/lift), or open in a side panel right now.
  function virtPinnedIds() {
    const want = new Set(state.selectedIds);
    if (dragging) for (const id of dragging.ids) want.add(id);
    if (NG.Lift && NG.Lift.active) for (const it of NG.Lift.active.items) want.add(it.id);
    if (textBlock) want.add(textBlock.id);
    if (shapeBlock) want.add(shapeBlock.id);
    if (imageBlock) want.add(imageBlock.id);
    if (checkBlock) want.add(checkBlock.id);
    if (tableBlock) want.add(tableBlock.id);
    if (editTableId) want.add(editTableId);
    if (drawerBlock) want.add(drawerBlock.id);
    if (gizmo) want.add(gizmo.id);
    if (colResize) want.add(colResize.id);
    if (rowResize) want.add(rowResize.id);
    return want;
  }
  // Below this on-screen size (css px, either dimension), a block is not
  // worth a DOM element even if it is technically inside the viewport -
  // "fit to view" on a big page zooms out until EVERYTHING is inside the
  // viewport, by definition, which would otherwise mean the very moment a
  // huge page tries hardest to show you an overview is also the moment this
  // would mount every single block anyway. A block below this size could not
  // be told apart from its neighbours regardless, so there is nothing lost
  // by leaving it as plain data until you zoom in far enough to actually
  // see it as its own thing.
  const VIRT_MIN_PX = 3;
  function virtComputeWanted() {
    const want = virtPinnedIds();
    const rect = viewportWorldRect();
    const { x0, y0, x1, y1 } = mmCellRange(rect);
    const scale = state.view.scale || 1;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const cell = mmGrid.get(cx + ',' + cy); if (!cell) continue;
      for (const id of cell) {
        if (want.has(id)) continue;
        const b = state.byId.get(id);
        if (!b) continue;
        // Ink still needs to be BUILT near the viewport, same as everything
        // else (that's what avoids constructing every stroke on a page the
        // moment it loads) - what it does not need is to be made VISIBLE for
        // that alone, since the canvas planes already paint it regardless.
        // Its own CSS rule keeps a built-but-unselected stroke hidden by
        // default, and virtUnmountOne knows to leave that rule alone rather
        // than fight it - so including ink here is safe: it gets a DOM
        // element when near the viewport, that element just starts (and
        // stays, until selected) invisible, exactly as it already was. The
        // size threshold applies to ink too - a fit-to-view of a dense
        // handwritten page is exactly the case that most needs it, since
        // handwriting is usually the majority of a real page's blocks.
        const br = mmSeen.get(id);
        if (br && br.w * scale < VIRT_MIN_PX && br.h * scale < VIRT_MIN_PX) continue;
        want.add(id);
      }
    }
    return want;
  }
  function virtMountOne(id) {
    let el = state.els[id];
    if (el) { if (el.style.display === 'none') el.style.display = ''; return; }
    const b = state.byId.get(id); if (!b) return;
    el = makeBlockEl(b);
    world.appendChild(el);
  }
  function virtUnmountOne(id) {
    const el = state.els[id]; if (!el) return;
    const b = state.byId.get(id);
    if (b && b.kind === 'ink') return;   // its own CSS rule owns visibility - never set an inline style here
    el.style.display = 'none';
  }
  // state.els's own keys are the source of truth for "has a real element
  // right now" - not a second bookkeeping Set that could drift from it (a
  // direct create - paste, import, undo - always appends straight into
  // state.els, same as before tonight; tracking a parallel Set in step would
  // mean remembering to update it at every such site instead of just here).
  // The size of that iteration is bounded by what has actually been mounted
  // - roughly "near the viewport, ever" - not by how much the page holds.
  function virtApply() {
    if (!state.ws || state.levelLayout !== 'canvas') return;
    const want = virtComputeWanted();
    for (const id in state.els) if (!want.has(id)) virtUnmountOne(id);
    for (const id of want) virtMountOne(id);
  }
  function scheduleVirtApply() {
    if (virtRAF) return;
    virtRAF = requestAnimationFrame(() => { virtRAF = 0; virtApply(); });
  }
  // A block id that might not currently have an element (off-view) but is
  // about to be interacted with programmatically (a jump, a keyboard action,
  // undo bringing it back) - build/show it now instead of waiting for the
  // next scheduled pass, so the caller can rely on state.els[id] existing
  // right after this returns, the same guarantee the DOM used to give for
  // free. Safe to call for ink too: virtMountOne already knows to leave an
  // ink element's display alone (its own CSS rule owns that).
  function ensureMounted(id) {
    virtMountOne(id);
    return state.els[id] || null;
  }

  function renderBlocks() {
    // wipe existing block nodes (keep the svg)
    $$('.block', world).forEach(n => n.remove());
    state.els = {};
    prevSel = new Set();
    untrackAllSizes();
    mmDirty = true; mmDirtyAll = true; mmContent = null;
    mmResetIndex();                    // the spatial index must be ready before the first mount pass reads it
    virtApply();                       // only what's in the initial view (+ pinned) gets built now
    planesRefresh();
  }

  /* --------------------------- ink planes ------------------------------ *
   * Committed strokes are painted by NG.Planes onto two canvases. Their DOM
   * elements stay in the page (everything that reads the DOM keeps working)
   * but are not painted, which is what a big page was paying for. A stroke
   * that is selected or lifted for a drag paints itself again and the planes
   * leave it out, so the glow and the lift container are untouched.        */
  const INK_PLANES = (() => {
    try { if (new URLSearchParams(location.search).get('ink') === 'dom') return false; } catch (_) {}
    try { if (localStorage.getItem('ng-ink-renderer') === 'dom') return false; } catch (_) {}
    return true;
  })();
  let planesOn = false;
  function initPlanes() {
    if (!INK_PLANES || planesOn || !NG.Planes) return;
    const over = $('#ink-over'), under = $('#ink-under');
    if (!over || !under) return;
    NG.Planes.init(planeBag(), over, under);
    world.classList.add('ink-planes');
    planesOn = true;
  }
  function planeBag() {
    return { state, stageRect, inkBox, inkWorldPts, INK_Z };
  }
  // the strokes on this level, and what the DOM is drawing right now
  function planesSync(full) {
    if (!planesOn) return;
    if (full) NG.Planes.setStrokes(state.blocks.filter(b => b.kind === 'ink' && b.parentId === state.level));
    const busy = new Set();
    for (const id of state.selectedIds) busy.add(id);
    if (NG.Lift && NG.Lift.active) for (const it of NG.Lift.active.items) busy.add(it.id);
    if (dragging) for (const id of (dragging.ids || [])) busy.add(id);
    NG.Planes.setExcluded(busy);
    NG.Planes.draw();
  }
  function planesInvalidate(box) { if (planesOn) { NG.Planes.invalidate(box); NG.Planes.draw(); } }
  /* A zoom is a stream of scales, and each one is a different set of tiles.
   * Rendering for a scale the next frame replaces is work thrown away, and the
   * gaps while it happens are what read as blinking handwriting. So while the
   * scale is moving the planes re-blit what they have; a moment after it stops
   * they render the crisp tiles for where it landed.                        */
  // applyView can run more than once inside a single screen frame - a mouse,
  // trackpad or pen commonly reports movement faster than the screen redraws.
  // The world transform itself is one CSS property the browser composites for
  // free and stays immediate; only the plane repaint, the one part with real
  // work behind it, is held to at most once per frame. Nothing visible is
  // delayed by this: the screen only ever shows the state as of the last call
  // before it paints, so extra calls before that were pure waste, not extra
  // smoothness. This is what turned "redraws on every pointer report" into
  // "redraws once per frame, like everything else on the page."
  let planeViewRAF = 0, planeViewScale = 1;
  function requestPlaneRedraw(scale) {
    planeViewScale = scale;
    if (planeViewRAF) return;
    planeViewRAF = requestAnimationFrame(() => { planeViewRAF = 0; planesDrawForView(planeViewScale); });
  }
  let planeScale = 0, planeSettle = null;
  function planesDrawForView(scale) {
    const zooming = Math.abs((scale || 1) - planeScale) > 1e-6;
    planeScale = scale || 1;
    if (zooming) {
      NG.Planes.livePending = true;
      clearTimeout(planeSettle);
      planeSettle = setTimeout(() => {
        planeSettle = null; NG.Planes.livePending = false;
        NG.Planes.draw(false);                 // crisp, at the scale it settled on
      }, 170);
    }
    NG.Planes.draw(zooming || !!pinch);
  }
  // One stroke changed. The plane measures a stroke from its points, so it is
  // told which record moved rather than being handed the record's own box -
  // points can paint outside it, and a box-shaped invalidate left the old ink
  // on screen until the page was reloaded.
  // One sweep of the eraser can take a dozen strokes apart, so the repaint is
  // coalesced into the next frame. The tiles still hold the old ink until it
  // lands, so nothing blinks in between.
  let planeDrawQueued = false;
  function planesQueueDraw() {
    if (planeDrawQueued) return;
    planeDrawQueued = true;
    requestAnimationFrame(() => { planeDrawQueued = false; if (planesOn) NG.Planes.draw(false); });
  }
  // `now` for a stroke just finished: it must be on the plane in this frame,
  // because the wet layer lets go of it in this frame.
  function planesAdd(b, now) { if (planesOn) { NG.Planes.addStroke(b); if (now) NG.Planes.draw(false); else planesQueueDraw(); } }
  function planesUpdate(b) { if (planesOn) { NG.Planes.updateStroke(b); planesQueueDraw(); } }
  function planesRemove(id) { if (planesOn) { NG.Planes.removeStroke(id); planesQueueDraw(); } }
  // Any block a recorded change touched: re-place the ink ones in the plane's
  // index (a drag, an align, a group move - anything that changes x/y or
  // shape without going through finalizeInk/refreshBlockCard) and drop the
  // ones that no longer exist. Everything else is not the plane's concern.
  function planesNotifyMoved(before, after) {
    if (!planesOn) return;
    const afterBlocks = (after && after.blocks) || [];
    const beforeBlocks = (before && before.blocks) || [];
    const afterIds = new Set(afterBlocks.map(b => b.id));
    for (const b of afterBlocks) if (b.kind === 'ink') planesUpdate(b);
    for (const b of beforeBlocks) if (b.kind === 'ink' && !afterIds.has(b.id)) planesRemove(b.id);
  }
  // The topmost stroke under a screen point, by the same box rule the hidden
  // element would have answered with. Only needed while the planes paint.
  function inkHitAt(clientX, clientY) {
    if (!planesOn) return null;
    const r = stageRect();
    const p = screenToWorld(clientX - r.left, clientY - r.top);
    const slack = 6 / (state.view.scale || 1);       // a finger's worth of room, as before
    let best = null, bestKey = -Infinity;
    for (const b of state.blocks) {
      if (b.kind !== 'ink' || b.parentId !== state.level) continue;
      const box = inkBox(b);
      if (p.x < box.x - slack || p.y < box.y - slack || p.x > box.x + box.w + slack || p.y > box.y + box.h + slack) continue;
      // The box, not the line: the stroke's own element answered anywhere
      // inside its box before (its SVG path is stroke-only, the div is not),
      // and the eraser and tap-to-pick were built on that.
      const key = (b.z || 0) * 1e13 + (b.createdAt || 0);
      if (key >= bestKey) { bestKey = key; best = b; }
    }
    return best;
  }
  // What a tap lands on, honouring paint order: handwriting paints above the
  // page, so a stroke lying over a card wins even though the browser can only
  // see the card (the stroke's element is not painted while the planes are).
  function topBlockAt(clientX, clientY, domEl) {
    const ink = inkHitAt(clientX, clientY);
    const dom = domEl && domEl.dataset ? state.byId.get(domEl.dataset.id) : null;
    if (!ink) return dom || null;
    if (!dom) return ink;
    const zi = ink.z || INK_Z, zd = dom.z || 0;
    return zi >= zd ? ink : dom;
  }
  const topElAt = (clientX, clientY, domEl) => {
    const b = topBlockAt(clientX, clientY, domEl);
    return b ? (state.els[b.id] || domEl || null) : (domEl || null);
  };
  const inkElAt = (clientX, clientY) => { const b = inkHitAt(clientX, clientY); return b ? state.els[b.id] : null; };
  function planesRefresh() { if (planesOn) planesSync(true); }

  /* ------------------------- block size cache -------------------------- *
   * A card's height comes from its content, so the old code asked the element
   * (`offsetWidth`/`offsetHeight`). Every such read after a write forces a
   * layout of the whole page - the cost of dragging or nudging a big
   * selection. A ResizeObserver reports sizes after layout instead, so the
   * readers below never trigger one.                                        */
  const sizeCache = new Map();
  const sizeRO = (typeof ResizeObserver === 'function') ? new ResizeObserver((entries) => {
    for (const e of entries) {
      const id = e.target && e.target.dataset ? e.target.dataset.id : null;
      if (!id) continue;
      const bs = e.borderBoxSize && e.borderBoxSize[0];
      const w = bs ? bs.inlineSize : (e.contentRect ? e.contentRect.width : 0);
      const h = bs ? bs.blockSize : (e.contentRect ? e.contentRect.height : 0);
      if (w || h) sizeCache.set(id, { w, h });
    }
  }) : null;
  function trackSize(el) { if (sizeRO && el) { try { sizeRO.observe(el); } catch (_) {} } }
  function untrackSize(id) {
    const el = state.els[id];
    if (sizeRO && el) { try { sizeRO.unobserve(el); } catch (_) {} }
    sizeCache.delete(id);
  }
  function untrackAllSizes() { if (sizeRO) { try { sizeRO.disconnect(); } catch (_) {} } sizeCache.clear(); }
  // The observer has not reported yet for a block made this frame: measure it
  // once (the only read that can force a layout, and only for new elements).
  function elSize(id, el) {
    const c = sizeCache.get(id);
    if (c && (c.w || c.h)) return c;
    if (!el) return null;
    const s = { w: el.offsetWidth, h: el.offsetHeight };
    if (s.w || s.h) sizeCache.set(id, s);
    return s;
  }

  /* --------------------------- block chrome ---------------------------- *
   * The edit buttons and the rotate/resize/edge handles are only ever visible
   * on the block you have picked (or, with a mouse, the one under the cursor).
   * Keeping them out of the page until then matters: they carry
   * `transform: scale(var(--inv))`, so every one of them is restyled on every
   * zoom step. Mounted on demand this is O(selected), not O(blocks).        */
  function chromeHtml(b) {
    const kind = b.kind || 'block';
    if (kind === 'ink' || kind === 'check') return '';
    const edit = (title) => `<div class="block-actions"><button class="blk-btn" data-blk="edit" title="${title}">${ic('pencil')}</button></div>`;
    if (kind === 'text') return edit('Edit text') +
      `<div class="tnode-rotate" title="Rotate"></div>` +
      `<div class="tnode-edge e" data-edge="e" title="Wrap width"></div>` +
      `<div class="tnode-resize" title="Resize text size"></div>`;
    if (kind === 'shape') return edit('Edit shape') +
      `<div class="tnode-rotate" title="Rotate"></div>` +
      `<div class="tnode-resize" title="Resize"></div>`;
    if (kind === 'image') return edit('Edit image') +
      `<div class="tnode-rotate" title="Rotate"></div>` +
      `<div class="tnode-resize" title="Resize"></div>`;
    if (kind === 'table') return edit('Edit table') +
      `<div class="tnode-edge e" data-edge="e" title="Wrap width"></div>` +
      `<div class="tnode-edge s" data-edge="s" title="Wrap height"></div>` +
      `<div class="tnode-resize" title="Scale table"></div>`;
    return `<div class="block-actions">` +
      `<button class="blk-btn" data-blk="edit" title="Edit">${ic('pencil')}</button>` +
      `<button class="blk-btn" data-blk="open" title="Open inside">${ic('arrow-right')}</button>` +
      `</div>`;
  }
  const CHROME_SEL = '.block-actions, .tnode-rotate, .tnode-resize, .tnode-edge';
  let hoverChromeId = null;
  function mountChrome(id) {
    const el = state.els[id]; if (!el || el.querySelector('.block-actions, .tnode-resize, .tnode-edge, .tnode-rotate')) return;
    const b = state.byId.get(id); if (!b) return;
    const html = chromeHtml(b); if (!html) return;
    syncInv();
    el.insertAdjacentHTML('beforeend', html);
  }
  function unmountChrome(id) {
    if (id === hoverChromeId || state.selectedIds.has(id)) return;   // still wanted
    const el = state.els[id]; if (!el) return;
    el.querySelectorAll(CHROME_SEL).forEach(n => n.remove());
  }
  // a repaint rebuilds innerHTML, so put the chrome back if the block still wants it
  function restoreChrome(id) {
    if (state.selectedIds.has(id) || id === hoverChromeId) mountChrome(id);
  }
  // With a mouse, the handles follow the cursor the way they always have; a
  // finger or a stylus never hovers, so nothing is mounted for them.
  function bindChromeHover() {
    world.addEventListener('pointerover', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const el = e.target.closest ? e.target.closest('.block') : null;
      const id = el ? el.dataset.id : null;
      if (id === hoverChromeId) return;
      const was = hoverChromeId; hoverChromeId = id;
      if (was) unmountChrome(was);
      if (id) mountChrome(id);
    });
    world.addEventListener('pointerleave', () => {
      const was = hoverChromeId; hoverChromeId = null; if (was) unmountChrome(was);
    });
  }

  function makeBlockEl(b) {
    const el = document.createElement('div');
    el.className = 'block'
      + (b.kind === 'text' ? ' block-text' : '')
      + (b.kind === 'shape' ? ' block-shape' : '')
      + (b.kind === 'image' ? ' block-image' : '')
      + (b.kind === 'check' ? ' block-check' : '')
      + (b.kind === 'ink' ? ' block-ink' : '')
      + (b.kind === 'table' ? ' block-table' : '');
    el.dataset.id = b.id;
    el.style.left = b.x + 'px';
    el.style.top = b.y + 'px';
    // Drawing sits above the page unless it has been given its own order
    // (send-to-back and friends set an explicit z, which wins).
    if (b.z) el.style.zIndex = b.z;
    else if (b.kind === 'ink') el.style.zIndex = INK_Z;
    if (b.kind === 'text') paintTextNode(el, b);
    else if (b.kind === 'shape') paintShapeNode(el, b);
    else if (b.kind === 'image') paintImageNode(el, b);
    else if (b.kind === 'check') paintCheckNode(el, b);
    else if (b.kind === 'ink') paintInkNode(el, b);
    else if (b.kind === 'table') paintTableNode(el, b);
    else { el.style.setProperty('--b-accent', b.color || PALETTE[0]); paintBlock(el, b); }
    el.classList.toggle('locked', !!b.locked);
    // A (re)built element must come in already showing whatever sticky
    // per-block UI state is true right now - the same reasoning restoreChrome
    // below already existed for. Selection used to only ever need this once,
    // on the block it was first applied to; a block can now also gain its
    // element well after being selected (scrolled into view while already
    // part of a selection made elsewhere), so it has to be checked here too,
    // not only at the moment applySelectionClasses toggles it.
    el.classList.toggle('selected', state.selectedIds.has(b.id));
    state.els[b.id] = el;
    trackSize(el);
    restoreChrome(b.id);        // a rebuilt element keeps the chrome it had
    return el;
  }

  // checkbox node (kind === 'check'): a square that ticks on a tap
  function paintCheckNode(el, b) {
    const size = b.size || 28;
    el.style.width = size + 'px'; el.style.height = size + 'px';
    el.style.setProperty('--b-accent', b.color || PALETTE[0]);
    el.classList.toggle('is-checked', !!b.checked);
    el.innerHTML =
      `<span class="check-face" title="${b.checked ? 'Ticked' : 'Not ticked'}">` +
        `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 12.5l3.6 3.6 7.4-8.2"/></svg>` +
      `</span>`;
  }

  // free image node (kind === 'image'); src is a data URL stored on the block
  function paintImageNode(el, b) {
    const w = b.w || 200, h = b.h || 150;
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.transform = b.rot ? `rotate(${b.rot}deg)` : '';
    if (!el.querySelector('.img-content')) {
      el.innerHTML =
        `<img class="img-content" alt="" draggable="false" />`;
    }
    const im = el.querySelector('.img-content');
    im.style.borderRadius = (b.round ? 12 : 0) + 'px';
    // outline drawn as a box-shadow ring so it hugs rounded corners and doesn't shift layout
    im.style.boxShadow = b.outline ? `0 0 0 ${b.outlineW || 2}px ${b.outlineColor || PALETTE[0]}` : '';
    // a slider tick must not re-assign (and re-decode) a multi-MB data URL
    const src = b.src || '';
    if (im.getAttribute('src') !== src) im.src = src;
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
    if (b.shape === 'line') {
      const y = h / 2;
      const lw = Math.max(1, b.outlineW || 4);
      const col = b.outlineColor || b.color || PALETTE[0];
      const dash = b.dash ? ` stroke-dasharray="${(lw * 0.2).toFixed(1)} ${(lw * 1.9).toFixed(1)}"` : '';
      inner = `<line x1="${(lw / 2 + 0.5).toFixed(1)}" y1="${y}" x2="${Math.max(lw / 2 + 0.5, w - lw / 2 - 0.5).toFixed(1)}" y2="${y}" stroke="${col}" stroke-width="${lw}" stroke-linecap="round"${dash}/>`;
    } else if (b.shape === 'circle') {
      inner = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(1, w / 2 - pad)}" ry="${Math.max(1, h / 2 - pad)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    } else if (pts) {
      const poly = pts.map(([x, y]) => `${(pad + x * (w - 2 * pad)).toFixed(1)},${(pad + y * (h - 2 * pad)).toFixed(1)}`).join(' ');
      inner = `<polygon points="${poly}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    } else {
      inner = `<rect x="${pad}" y="${pad}" width="${Math.max(1, w - 2 * pad)}" height="${Math.max(1, h - 2 * pad)}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    }
    el.innerHTML =
      `<svg class="shape-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  }

  function paintBlock(el, b) {
    const c = state.childCounts[b.id] || { blocks: 0, files: 0 };
    const isList = b.layout === 'list';
    el.classList.toggle('is-list', isList);
    const meta = [];
    if (!isList && c.blocks) meta.push(`<span class="chip">${ic('layers')}${c.blocks}</span>`);
    if (c.files) meta.push(`<span class="chip">${ic('clip')}${c.files}</span>`);
    const prog = todoProgress(b.notes);
    if (prog) meta.push(`<span class="chip">☑ ${prog.done}/${prog.total}</span>`);
    else if (b.notes && b.notes.trim()) meta.push(`<span class="chip">${ic('pencil')}</span>`);
    const iconInner = isList ? ic('list') : esc(monogram(b.title));
    const body = isList
      ? peekHtml(b.id)
      : `${b.description ? `<div class="block-desc">${esc(b.description)}</div>` : ''}
         ${(!b.description && b.notes) ? `<div class="block-notes-peek md">${mdToHtml(b.notes.slice(0, 240))}</div>` : ''}`;
    const tags = parseTags(b.tags);
    const tagHtml = tags.length ? `<div class="block-tags">${tags.map(t => `<button class="tag-chip" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : '';
    const metaHtml = meta.length ? meta.join('') : (isList ? '' : '<span class="chip muted">empty</span>');
    el.innerHTML = `
      <div class="block-head">
        <div class="block-ico">${iconInner}</div>
        <div class="block-title">${esc(b.title || 'Untitled block')}</div>
      </div>
      ${body}
      ${tagHtml}
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
      `<div class="text-content"></div>`;
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
    // The box ALWAYS hugs the text: width = the widest line (lines break only where
    // Enter was pressed — no soft wrapping), height = the number of lines. So the
    // bottom-right corner scales the font and the whole box grows/shrinks in BOTH
    // dimensions. (Justify is the exception — it needs a fixed width to distribute.)
    // Box hugs content. With no wrap width it hugs the widest line (breaks only on
    // Enter). The right handle sets a wrap width `b.w`; the box then wraps within it
    // (and still hugs when the text is narrower). Corner-scaling scales b.w by the
    // same ratio, so resizing keeps the same proportions.
    el.style.height = ''; el.style.minHeight = '';
    el.style.width = 'fit-content'; s.width = 'auto';
    if (b.align === 'justify') {
      el.style.width = (b.w || 320) + 'px'; el.style.maxWidth = 'none'; s.width = '100%';
      s.whiteSpace = 'pre-line'; s.textAlignLast = 'left';
    } else if (b.w) {
      el.style.maxWidth = b.w + 'px';
      s.whiteSpace = 'pre-wrap'; s.textAlignLast = '';
    } else {
      el.style.maxWidth = 'none';
      s.whiteSpace = 'pre'; s.textAlignLast = '';
    }
    if (b.orient === 'v') { s.writingMode = 'vertical-rl'; s.textOrientation = 'mixed'; }
    else { s.writingMode = ''; s.textOrientation = ''; }
  }

  function refreshBlockCard(id) {
    const el = state.els[id];
    const b = state.byId.get(id);
    if (!el || !b) return;
    if (b.kind === 'text') { paintTextNode(el, b); }
    else if (b.kind === 'shape') { paintShapeNode(el, b); }
    else if (b.kind === 'image') { paintImageNode(el, b); }
    else if (b.kind === 'check') { paintCheckNode(el, b); }
    else if (b.kind === 'ink') { paintInkNode(el, b); planesUpdate(b); }
    else if (b.kind === 'table') { paintTableNode(el, b); }
    else { paintBlock(el, b); el.style.setProperty('--b-accent', b.color || PALETTE[0]); }
    el.classList.toggle('locked', !!b.locked);
    restoreChrome(id);
  }

  // freehand ink node (kind === 'ink'); pts are relative to the block's x,y
  function paintInkNode(el, b) {
    const pad = (b.width || 3) + 2;
    const w = (b.w || 1) + pad * 2, h = (b.h || 1) + pad * 2;
    el.style.width = w + 'px'; el.style.height = h + 'px';
    const pts = (b.pts || []).map(p => [p[0] + pad, p[1] + pad, p[2] || 0, p[3] || 0]);
    const style = PEN_STYLES[b.style] ? b.style : 'pen';
    const width = b.width || 3;
    const d = inkStrokeD(pts, style, width);
    const svg = el.firstElementChild;
    if (svg && svg.classList.contains('ink-svg') && svg.firstElementChild) {
      // repaint in place: no node churn while a slider or the scale grip moves
      svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.firstElementChild.setAttribute('d', d);
    } else {
      el.innerHTML =
        `<svg class="ink-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
        `<path d="${d}"/></svg>`;
    }
    applyInkStyle(el.querySelector('path'), style, b.color || penColor, width);
  }

  // table node (kind === 'table'); rows is an array of arrays of cell strings.
  // fontSize scales the whole table (corner handle); w/h wrap it (edge handles).
  function paintTableNode(el, b) {
    const rows = Array.isArray(b.rows) ? b.rows : [];
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const editing = (editTableId === b.id);
    let cg = '<colgroup>';
    for (let c = 0; c < cols; c++) { const w = b.colW && b.colW[c]; cg += `<col${w ? ` style="width:${w}px"` : ''}>`; }
    cg += '</colgroup>';
    let t = '<div class="table-scroll"><table class="data-table">' + cg + '<tbody>';
    rows.forEach((r, ri) => {
      const cellTag = (ri === 0 && b.header !== false) ? 'th' : 'td';
      t += '<tr>';
      for (let c = 0; c < cols; c++) {
        const v = r[c] != null ? String(r[c]) : '';
        const cgrip = (ri === 0) ? `<span class="col-resize" data-col="${c}" title="Drag to resize column"></span>` : '';
        const rgrip = (c === 0) ? `<span class="row-resize" data-row="${ri}" title="Drag to resize row"></span>` : '';
        t += `<${cellTag} data-r="${ri}" data-c="${c}"${editing ? ' tabindex="0"' : ''}>${esc(v)}${cgrip}${rgrip}</${cellTag}>`;
      }
      t += '</tr>';
    });
    t += '</tbody></table></div>';
    el.style.transform = b.rot ? `rotate(${b.rot}deg)` : '';
    // By default the table shows everything (no cap). A wrap width/height (edge drag)
    // switches it to a fixed viewport that scrolls.
    el.style.width = b.w ? b.w + 'px' : '';
    el.style.maxWidth = b.w ? b.w + 'px' : 'none';
    el.style.height = b.h ? b.h + 'px' : '';
    el.classList.toggle('editing', editing);
    el.innerHTML =
      ((b.title || editing) ? `<div class="table-title${b.title ? '' : ' empty'}">${esc(b.title || (editing ? 'Untitled table' : ''))}</div>` : '') + t;
    const fs = b.fontSize || 13;
    const tbl = el.querySelector('.data-table');
    tbl.style.fontSize = fs + 'px';
    const applyFmtStyle = (node, fmt) => {
      if (!node || !fmt) return;
      if ('bold' in fmt) node.style.fontWeight = fmt.bold ? '700' : '400';
      if ('italic' in fmt) node.style.fontStyle = fmt.italic ? 'italic' : 'normal';
      if (fmt.align) node.style.textAlign = fmt.align;
      if (fmt.color) node.style.color = fmt.color;
      if (fmt.bg) node.style.backgroundColor = fmt.bg;
      if (fmt.font) node.style.fontFamily = FONT_STACK[fmt.font] || '';
    };
    const py = Math.max(2, Math.round(fs * 0.38)), px = Math.max(4, Math.round(fs * 0.72));
    el.querySelectorAll('.data-table th, .data-table td').forEach(td => {
      td.style.padding = `${py}px ${px}px`;
      const w = b.colW && b.colW[+td.dataset.c];
      if (w) { td.style.width = td.style.minWidth = td.style.maxWidth = w + 'px'; td.style.whiteSpace = 'normal'; td.style.overflowWrap = 'anywhere'; }
      else { td.style.width = td.style.minWidth = td.style.maxWidth = ''; td.style.whiteSpace = ''; td.style.overflowWrap = ''; }
      const rh = b.rowH && b.rowH[+td.dataset.r];
      // row height acts as a minimum — content is never clipped, so everything stays visible
      if (rh) { td.style.height = rh + 'px'; td.style.verticalAlign = 'top'; td.style.maxHeight = ''; td.style.overflow = ''; }
      else { td.style.height = ''; td.style.verticalAlign = ''; td.style.maxHeight = ''; td.style.overflow = ''; }
      applyFmtStyle(td, b.cellFmt && b.cellFmt[td.dataset.r + ':' + td.dataset.c]);
    });
    const titleEl = el.querySelector('.table-title');
    if (titleEl) { titleEl.style.fontSize = Math.round(fs * 1.05) + 'px'; titleEl.style.padding = `${Math.round(fs * 0.5)}px ${Math.round(fs * 0.9)}px`; applyFmtStyle(titleEl, b.titleFmt); }
    const sc = el.querySelector('.table-scroll');
    const wrapped = !!(b.w || b.h);
    sc.style.maxWidth = 'none';
    sc.style.maxHeight = 'none';
    // Only scroll when a wrap width/height is set; otherwise use plain block flow so the
    // node grows to fit the whole table exactly (no flex rounding → nothing clipped).
    el.style.display = wrapped ? 'flex' : 'block';
    el.classList.toggle('wrapped', wrapped);   // sticky header only applies in scroll mode
    el.style.overflow = 'visible';   // never clip the hover pencil/handles; .table-scroll does the clipping
    sc.style.overflow = wrapped ? 'auto' : 'visible';
    sc.style.flex = wrapped ? '1 1 auto' : 'none';
    if (editing && tfocus === 'title') { const tt = el.querySelector('.table-title'); if (tt) tt.classList.add('title-sel'); }
    else if (editing && editTableId === b.id && tmulti.size) {
      tmulti.forEach(k => { const [rr, cc] = k.split(':'); const cell = el.querySelector(`[data-r="${rr}"][data-c="${cc}"]`); if (cell) cell.classList.add('cell-sel'); });
    }
  }

  // Update whichever representation (canvas card or list row) exists for a block.
  function refreshItem(id) {
    if (state.levelLayout === 'list') {
      const row = $(`.list-row[data-id="${id}"]`);
      const b = state.byId.get(id);
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
    if (b.kind === 'table') {
      const rows = Array.isArray(b.rows) ? b.rows : [];
      const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      return `<div class="list-row" data-id="${esc(b.id)}" style="--b-accent:${esc(b.color || 'var(--accent)')}">
          <div class="lr-ico">${ic('table')}</div>
          <div class="lr-main"><div class="lr-title">${esc(b.title || 'Table')}</div>
          <div class="lr-sub">Table · ${rows.length}×${cols}</div></div>
        </div>`;
    }
    if (b.kind === 'image' || b.kind === 'shape' || b.kind === 'ink' || b.kind === 'check') {
      const kindLabel = b.kind === 'image' ? 'Image' : b.kind === 'ink' ? 'Ink drawing' : b.kind === 'check' ? 'Checkbox' : 'Shape';
      const kindIco = b.kind === 'image' ? 'image' : b.kind === 'ink' ? 'pen' : b.kind === 'check' ? 'checkbox' : 'shapes';
      const kindSub = b.kind === 'image' ? 'Picture' : b.kind === 'ink' ? 'Freehand' : b.kind === 'check' ? (b.checked ? 'Ticked' : 'Not ticked') : (b.shape || 'shape');
      return `<div class="list-row" data-id="${esc(b.id)}" style="--b-accent:${esc(b.color || 'var(--accent)')}">
          <div class="lr-ico">${ic(kindIco)}</div>
          <div class="lr-main"><div class="lr-title">${kindLabel}</div>
          <div class="lr-sub">${esc(kindSub)}</div></div>
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
  function blockRectOf(b) {
    // Stored dimensions first (every kind but auto-sized text always has
    // them - see the text-size cache-back below), a live measurement second,
    // a guess last. This matters once a block can be off-screen and
    // unmounted: there is no element to measure then, so anything that only
    // trusted the DOM (as this used to) would silently use the wrong size
    // for exactly the blocks not currently in front of you.
    if (b.w && b.h) return { x: b.x, y: b.y, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
    const el = state.els[b.id];
    const s = elSize(b.id, el);
    const w = (s && s.w) || BLOCK_W;
    const h = (s && s.h) || BLOCK_H_GUESS;
    return { x: b.x, y: b.y, w, h, cx: b.x + w / 2, cy: b.y + h / 2 };
  }
  function blockRect(id) {
    const b = state.byId.get(id);
    return b ? blockRectOf(b) : null;
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
  // Every measurement first, then one write. Reading a block's box between two
  // appends made the browser lay the page out again for each connector.
  function drawEdges() {
    if (state.levelLayout === 'list') return;
    mmDirty = true; mmDirtyAll = true; scheduleMinimap();
    const parts = [];
    for (const e of state.edges) {
      const a = blockRect(e.from), b = blockRect(e.to);
      if (!a || !b) continue;
      const p1 = borderPoint(a, b), p2 = borderPoint(b, a);
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const d = edgePathD(e.style, p1, p2);
      const startArrow = e.both ? ' marker-start="url(#arrow)"' : '';
      parts.push(
        `<g class="edge-g" data-id="${esc(e.id)}">` +
        `<path class="hit" d="${d}"></path>` +
        `<path class="edge" d="${d}"${startArrow} marker-end="url(#arrow)"></path>` +
        (e.label ? '' : `<circle class="edge-dot" cx="${mx}" cy="${my}" r="2.4"></circle>`) +   // a point of light at the middle (decorative)
        (e.label
          ? `<text class="edge-label" x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="middle">${esc(e.label)}</text>`
          : '') +
        `</g>`);
    }
    $$('g.edge-g', svg).forEach(n => n.remove());
    if (parts.length) svg.insertAdjacentHTML('beforeend', parts.join(''));
  }
  // one listener for every connector, now and later
  function bindEdgeClicks() {
    svg.addEventListener('click', (ev) => {
      const g = ev.target.closest ? ev.target.closest('g.edge-g') : null;
      if (!g) return;
      const e = state.edges.find(x => x.id === g.dataset.id);
      if (!e) return;
      ev.stopPropagation();
      openEdgeEditor(e);
    });
  }

  // Curved (default), straight, or right-angled elbow.
  function edgePathD(style, p1, p2) {
    if (style === 'straight') return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
    if (style === 'elbow') {
      const midX = (p1.x + p2.x) / 2;
      return `M ${p1.x} ${p1.y} L ${midX} ${p1.y} L ${midX} ${p2.y} L ${p2.x} ${p2.y}`;
    }
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    return `M ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y}`;
  }

  let edgeEditing = null;
  function openEdgeEditor(e) {
    edgeEditing = e;
    $('#edge-label').value = e.label || '';
    $('#edge-both').checked = !!e.both;
    const st = e.style || 'curve';
    $$('#edge-styles button').forEach(b => b.classList.toggle('active', b.dataset.estyle === st));
    $('#edge-modal').hidden = false;
    setTimeout(() => $('#edge-label').focus(), 40);
  }
  function bindEdgeEditor() {
    const close = () => { $('#edge-modal').hidden = true; edgeEditing = null; };
    $('#edge-styles').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-estyle]'); if (!b) return;
      $$('#edge-styles button').forEach(x => x.classList.toggle('active', x === b));
    });
    $('#edge-cancel').addEventListener('click', close);
    $('#edge-save').addEventListener('click', async () => {
      if (!edgeEditing) { close(); return; }
      const e = edgeEditing;
      e.label = ($('#edge-label').value || '').trim();
      e.both = $('#edge-both').checked;
      e.style = ($$('#edge-styles button').find(b => b.classList.contains('active')) || {}).dataset?.estyle || 'curve';
      await DB.saveEdge(e);
      close(); drawEdges(); markChanged();
    });
    $('#edge-delete').addEventListener('click', () => {
      const e = edgeEditing; close();
      if (e) askDeleteEdge(e);
    });
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
    await inkWrites;                        // a stroke still being written lands first
    await loadLevel(levelId, { fit: true });
    updateNavButtons();
  }
  async function navigateTo(levelId) {
    dropActiveTools();                     // tools do not follow you into a block
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
    if (state.readOnly) { toast('Read mode is on.'); return; }
    dropActiveTools();
    flushEdit();
    const isText = type === 'text';
    const isShape = type === 'shape';
    const isCheck = type === 'check';
    const layout = type === 'list' ? 'list' : 'canvas';
    const b = {
      id: uid(),
      ws: state.ws,
      parentId: state.level,
      title: (isText || isShape || isCheck) ? '' : (layout === 'list' ? 'New list' : 'New block'),
      description: '',
      notes: '',
      layout,
      color: isText ? '' : PALETTE[(state.blocks.length * 7) % PALETTE.length],
      icon: '',
      x: 0, y: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (isText) { b.kind = 'text'; b.text = 'Text'; b.font = 'sans'; b.size = 22; b.bold = false; b.italic = false; b.align = 'left'; b.orient = 'h'; b.rot = 0; b.glow = false; b.glowColor = ''; }
    if (isShape) { b.kind = 'shape'; b.shape = 'rectangle'; b.w = 150; b.h = 100; b.points = null; b.fill = true; b.outline = false; b.outlineW = 3; b.outlineColor = PALETTE[0]; b.rot = 0; }
    if (isCheck) { b.kind = 'check'; b.size = 32; b.checked = false; }
    if (state.levelLayout === 'canvas') {
      const pos = at || centerOfView();
      const halfW = isText ? 20 : isShape ? b.w / 2 : isCheck ? b.size / 2 : BLOCK_W / 2;
      const halfH = isText ? 12 : isShape ? b.h / 2 : isCheck ? b.size / 2 : 30;
      b.x = Math.round(pos.x - halfW);
      b.y = Math.round(pos.y - halfH);
    }
    await DB.saveBlock(b);
    state.blocks.push(b);
    state.byId.set(b.id, b);
    state.childCounts[b.id] = { blocks: 0, files: 0 };
    recordChange(emptySet(), { blocks: [b], edges: [], files: [] });
    if (state.levelLayout === 'list') {
      renderList();
    } else {
      world.appendChild(makeBlockEl(b));
    }
    if (isText) openTextEditor(b.id);
    else if (isShape) openShapeEditor(b.id);
    else if (isCheck) selectBlock(b.id);                     // ready to tick, no panel in the way
    else openEditor(b.id, true);
    toast(isText ? 'Text added' : isShape ? 'Shape added' : isCheck ? 'Checkbox added \u2014 tap it to tick' : (layout === 'list' ? 'List added' : 'Block added'));
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
  // Imported photos are stored at a bounded pixel size: a 12 MP camera shot
  // becomes a few hundred KB inside the workspace instead of several MB, and
  // every save, undo clone and export shrinks with it. SVG and GIF are kept
  // as they are (vector crispness, animation); anything already small too.
  async function fileToStoredSrc(file, maxPx = 2048) {
    const orig = await readAsDataUrl(file);
    try {
      if (/svg|gif/i.test(file.type || '')) return orig;
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = orig; });
      const w = im.naturalWidth, h = im.naturalHeight;
      if (!w || !h) return orig;
      if (Math.max(w, h) <= maxPx && file.size <= 400 * 1024) return orig;
      const k = Math.min(1, maxPx / Math.max(w, h));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      const jpeg = /jpe?g/i.test(file.type || '');
      let out = cv.toDataURL(jpeg ? 'image/jpeg' : 'image/webp', 0.85);
      if (!jpeg && !out.startsWith('data:image/webp')) out = cv.toDataURL('image/png');   // no webp encoder: keep alpha
      return out.length < orig.length ? out : orig;
    } catch (_) { return orig; }
  }

  function pickImage(at) {
    if (state.levelLayout !== 'canvas') { toast('Open a canvas block to add an image here.'); return; }
    pendingImageAt = at || centerOfView();
    replaceImageId = null;
    $('#image-input').click();
  }

  /* ---- import a text file → a text node ------------------------------- */
  let pendingTextAt = null;
  function pickTextFile(at) {
    if (state.levelLayout !== 'canvas') { toast('Open a canvas to import a text file here.'); return; }
    pendingTextAt = at || centerOfView();
    $('#txt-input').click();
  }
  async function createTextFromFile(file, opts = {}) {
    let content = '';
    try { content = await file.text(); } catch (_) { toast('Could not read that file.'); return; }
    content = content.replace(/\r\n/g, '\n');
    if (!content.trim()) { toast('That file is empty.'); return; }
    const MAX = 20000;
    if (content.length > MAX) { content = content.slice(0, MAX) + '\n…(truncated)'; if (!opts.silent) toast('Large file — imported the first part.'); }
    const pos = opts.at || pendingTextAt || centerOfView();
    const now = Date.now();
    const b = {
      id: uid(), ws: state.ws, parentId: state.level, kind: 'text',
      text: content, font: 'mono', size: 14, bold: false, italic: false, align: 'left', nowrap: true,
      orient: 'h', rot: 0, glow: false, glowColor: '', color: '',
      title: '', description: '', notes: '', tags: '', layout: 'canvas', icon: '',
      x: Math.round(pos.x - 150), y: Math.round(pos.y - 20), z: 0, createdAt: now, updatedAt: now,
    };
    await DB.saveBlock(b);
    state.blocks.push(b);
    state.byId.set(b.id, b);
    state.childCounts[b.id] = { blocks: 0, files: 0 };
    world.appendChild(makeBlockEl(b));
    recordChange(emptySet(), { blocks: [b], edges: [], files: [] });
    selectBlock(b.id);
    toast('Text file imported');
  }
  async function createImageBlock(file, opts = {}) {
    if (!file || !/^image\//.test(file.type)) { toast('That file is not an image.'); return null; }
    const src = await fileToStoredSrc(file);
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
    state.byId.set(b.id, b);
    state.childCounts[b.id] = { blocks: 0, files: 0 };
    recordChange(emptySet(), { blocks: [b], edges: [], files: [] });
    world.appendChild(makeBlockEl(b));
    if (opts.openAfter !== false) openImageEditor(b.id);
    else selectBlock(b.id);
    return b;
  }

  // Paste an image from the clipboard (Ctrl+V of a copied picture / screenshot).
  // Ctrl+V arrives as a paste event carrying the clipboard: images become image
  // blocks, a Notes Gallery clip (copied in any workspace, on any platform)
  // becomes blocks, plain text becomes a text block; otherwise the in-session
  // copy is pasted. Text fields keep their normal paste.
  let pasteKeyAt = 0;
  function bindImagePaste() {
    window.addEventListener('paste', async (e) => {
      pasteKeyAt = 0;
      if (state.ws == null || state.levelLayout !== 'canvas') return;
      const t = document.activeElement;
      if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;   // let text fields and table cells paste normally
      let got = null;
      if (NG.Clip) { try { got = await NG.Clip.fromPasteEvent(e); } catch (_) { got = null; } }
      else {
        const items = e.clipboardData && e.clipboardData.items; const imgs = [];
        if (items) for (const it of items) { if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) imgs.push(f); } }
        if (imgs.length) got = { kind: 'image', blob: imgs[0], blobs: imgs };
      }
      e.preventDefault();
      if (got && got.kind === 'image' && got.blobs && got.blobs.length > 1) { await pasteImageBlobs(got.blobs); return; }
      if (await pasteResult(got)) return;
      if (clipboard) await pasteSnapshot(clipboard, 'Pasted');
    });
  }

  // Drop image files onto the canvas (from the OS or another app).
  const isTextFile = (f) => /^text\/(plain|markdown)$/.test(f.type) || /\.(txt|md|markdown)$/i.test(f.name);
  const isCsvFile = (f) => f.type === 'text/csv' || /\.csv$/i.test(f.name);
  // Drop files onto the canvas: images→image nodes, .txt/.md→text, .csv→list.
  async function dropFiles(fileList, clientX, clientY) {
    const files = Array.from(fileList);
    if (state.ws == null || state.levelLayout !== 'canvas') { toast('Open a canvas to drop files.'); return; }
    const r = stage.getBoundingClientRect();
    const base = screenToWorld(clientX - r.left, clientY - r.top);
    let i = 0, n = 0;
    for (const f of files) {
      const at = { x: base.x + i * 28, y: base.y + i * 28 };
      if (isWorkspaceFile(f)) { await importWorkspaceFile(f); n++; continue; }   // a saved workspace: imported whole
      if (/^image\//.test(f.type)) { await createImageBlock(f, { at, openAfter: false }); n++; i++; }
      else if (/\.xlsx$/i.test(f.name)) { await importSheetFile(f, at); n++; i++; }
      else if (isCsvFile(f)) { await createListFromCsv(f, at); n++; i++; }
      else if (isTextFile(f)) { await createTextFromFile(f, { at, silent: true }); n++; i++; }
    }
    if (!n) toast('Drop images, .xlsx, .txt/.md, .csv or .notesgallery.json files.');
    else if (n > 1) toast(`${n} files imported`);
  }

  // Parse CSV → a List block whose rows are child blocks.
  function parseCsv(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    const s = text.replace(/\r\n/g, '\n');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }
  async function createListFromCsv(file, at) {
    let text = '';
    try { text = await file.text(); } catch (_) { toast('Could not read that file.'); return; }
    const rows = parseCsv(text);
    if (!rows.length) { toast('That CSV looks empty.'); return; }
    const name = file.name.replace(/\.csv$/i, '') || 'Imported CSV';
    const pos = at || centerOfView();
    const now = Date.now();
    const listId = uid();
    const made = [];
    const list = {
      id: listId, ws: state.ws, parentId: state.level, title: name, layout: 'list',
      description: '', notes: '', tags: '', color: PALETTE[state.blocks.length % PALETTE.length], icon: '',
      x: Math.round(pos.x - BLOCK_W / 2), y: Math.round(pos.y - 30), z: 0, createdAt: now, updatedAt: now,
    };
    await DB.saveBlock(list); made.push(list);
    let ri = 0;
    for (const cells of rows.slice(0, 500)) {
      ri++;
      const title = (cells[0] || '').trim() || `Row ${ri}`;
      const rest = cells.slice(1).map(c => c.trim()).filter(Boolean).join(' · ');
      made.push(await (async () => {
        const c = {
          id: uid(), ws: state.ws, parentId: listId, title, description: rest, layout: 'canvas',
          notes: '', tags: '', color: PALETTE[ri % PALETTE.length], icon: '',
          x: 0, y: 0, z: 0, createdAt: now + ri, updatedAt: now + ri,
        };
        await DB.saveBlock(c); return c;
      })());
    }
    state.blocks.push(list);
    state.byId.set(list.id, list);
    state.childCounts[listId] = { blocks: made.length - 1, files: 0 };
    state.childPeek[listId] = made.slice(1, 5).map(k => ({ title: k.title, color: k.color }));
    world.appendChild(makeBlockEl(list));
    recordChange(emptySet(), { blocks: made, edges: [], files: [] });
    selectBlock(listId);
    toast(`Imported ${made.length - 1} rows as a list`);
  }

  /* ---- import a spreadsheet (.xlsx / .csv) → a table node ------------- */
  let pendingSheetAt = null;
  function pickSheetFile(at) {
    if (state.levelLayout !== 'canvas') { toast('Open a canvas to import a spreadsheet here.'); return; }
    pendingSheetAt = at || centerOfView();
    $('#xlsx-input').click();
  }
  // Inflate a raw DEFLATE stream (zip entries) using the browser's DecompressionStream.
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const ab = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(ab);
  }
  // Minimal ZIP reader (central directory) — enough to pull entries out of an .xlsx.
  function readZip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65536; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    const td = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method, compSize, localOff };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries, dv, u8 };
  }
  async function zipRead(zip, name) {
    const e = zip.entries[name]; if (!e) return null;
    const lnLen = zip.dv.getUint16(e.localOff + 26, true);
    const leLen = zip.dv.getUint16(e.localOff + 28, true);
    const start = e.localOff + 30 + lnLen + leLen;
    const raw = zip.u8.subarray(start, start + e.compSize);
    return e.method === 0 ? raw.slice() : await inflateRaw(raw);
  }
  const colToIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  // Parse the first worksheet of an .xlsx into rows[][] (uses shared strings).
  async function parseXlsx(arrayBuffer) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t unzip .xlsx — try .csv.');
    const zip = readZip(new Uint8Array(arrayBuffer));
    const dec = new TextDecoder();
    const parseXml = (bytes) => new DOMParser().parseFromString(dec.decode(bytes), 'application/xml');
    let shared = [];
    if (zip.entries['xl/sharedStrings.xml']) {
      const doc = parseXml(await zipRead(zip, 'xl/sharedStrings.xml'));
      shared = Array.from(doc.getElementsByTagName('si')).map(si =>
        Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join(''));
    }
    let sheet = zip.entries['xl/worksheets/sheet1.xml'] ? 'xl/worksheets/sheet1.xml'
      : Object.keys(zip.entries).find(k => /^xl\/worksheets\/.*\.xml$/.test(k));
    if (!sheet) throw new Error('no worksheet found');
    const sdoc = parseXml(await zipRead(zip, sheet));
    // column widths: <cols><col min max width/></cols> — width is in "characters"
    const colW = [];
    for (const cel of Array.from(sdoc.getElementsByTagName('col'))) {
      const min = parseInt(cel.getAttribute('min'), 10), max = parseInt(cel.getAttribute('max'), 10);
      const wv = parseFloat(cel.getAttribute('width'));
      if (!isNaN(min) && !isNaN(max) && !isNaN(wv)) {
        const px = Math.max(24, Math.round(wv * 7 + 5));   // ~Calibri 11 char→px
        for (let i = min - 1; i <= max - 1 && i < 400; i++) if (i >= 0) colW[i] = px;
      }
    }
    const grid = [], heights = []; let maxCol = 0;
    for (const rowEl of Array.from(sdoc.getElementsByTagName('row'))) {
      const arr = [];
      for (const c of Array.from(rowEl.getElementsByTagName('c'))) {
        const col = colToIndex(c.getAttribute('r'));
        const t = c.getAttribute('t');
        const vEl = c.getElementsByTagName('v')[0];
        const isEl = c.getElementsByTagName('is')[0];
        let val = '';
        if (t === 's' && vEl) { const i = parseInt(vEl.textContent, 10); val = shared[i] != null ? shared[i] : ''; }
        else if (t === 'inlineStr' && isEl) { val = Array.from(isEl.getElementsByTagName('t')).map(x => x.textContent).join(''); }
        else if (vEl) { val = vEl.textContent; }
        if (col >= 0) { arr[col] = val; if (col + 1 > maxCol) maxCol = col + 1; }
      }
      const ht = parseFloat(rowEl.getAttribute('ht'));
      heights.push(!isNaN(ht) ? Math.max(16, Math.round(ht * 4 / 3)) : null);   // points → px
      grid.push(arr);
    }
    const rows = [], rowH = [];
    grid.forEach((r, i) => {
      const a = []; for (let j = 0; j < maxCol; j++) a.push(r[j] != null ? r[j] : '');
      if (a.some(c => String(c).trim() !== '')) { rows.push(a); rowH.push(heights[i]); }
    });
    return { rows, colW: colW.slice(0, maxCol), rowH };
  }
  async function importSheetFile(file, at) {
    const isCsv = file.type === 'text/csv' || /\.csv$/i.test(file.name);
    const isXlsx = /\.xlsx$/i.test(file.name);
    if (!isCsv && !isXlsx) { toast('Choose an .xlsx or .csv file (.xls isn’t supported).'); return; }
    let res;
    try {
      res = isCsv ? { rows: parseCsv(await file.text()) } : await parseXlsx(await file.arrayBuffer());
    } catch (err) { toast(err && err.message ? err.message : 'Could not read that spreadsheet.'); return; }
    const name = file.name.replace(/\.(xlsx|csv)$/i, '') || 'Table';
    await createTableBlock(res.rows, name, at, { colW: res.colW, rowH: res.rowH });
  }
  async function createTableBlock(rows, name, at, sizes) {
    if (!rows || !rows.length) { toast('That sheet looks empty.'); return; }
    rows = rows.slice(0, 200).map(r => r.slice(0, 40));   // sane caps
    const pos = at || centerOfView();
    const now = Date.now();
    const b = {
      id: uid(), ws: state.ws, parentId: state.level, kind: 'table',
      rows, header: true, fontSize: 13, title: name || 'Table',
      description: '', notes: '', tags: '', layout: 'canvas', color: '', icon: '',
      x: Math.round(pos.x - 180), y: Math.round(pos.y - 60), z: 0, createdAt: now, updatedAt: now,
    };
    // carry over the sheet's column widths / row heights when present
    if (sizes) {
      const cw = (sizes.colW || []).slice(0, 40);
      const rh = (sizes.rowH || []).slice(0, 200);
      if (cw.some(x => x)) b.colW = cw;
      if (rh.some(x => x)) b.rowH = rh;
    }
    await DB.saveBlock(b);
    state.blocks.push(b);
    state.byId.set(b.id, b);
    state.childCounts[b.id] = { blocks: 0, files: 0 };
    world.appendChild(makeBlockEl(b));
    recordChange(emptySet(), { blocks: [b], edges: [], files: [] });
    selectBlock(b.id);
    toast(`Imported ${rows.length}×${rows[0].length} table`);
  }

  /* ---------------------------- undo / redo ---------------------------- */
  // Each history entry stores a `before` and `after` set of records
  // {blocks,edges,files}. Undo makes the DB match `before`, redo `after`.
  // History is per workspace session (cleared on open/home).
  const history = { past: [], future: [], limit: 200, gen: 0 };   // gen: bumped by every clear
  const cloneRec = (r) => ({ ...r });      // shallow clone (keeps file Blob refs)
  // Everything that is a leaf: it holds no inner canvas, so it never "opens".
  const LEAF_KINDS = ['text', 'shape', 'image', 'ink', 'table', 'check'];
  const isLeafKind = (k) => LEAF_KINDS.includes(k);
  const opensInside = (b) => !!b && !isLeafKind(b.kind);
  const emptySet = () => ({ blocks: [], edges: [], files: [] });
  const cloneSet = (s) => ({
    blocks: (s.blocks || []).map(cloneRec),
    edges: (s.edges || []).map(cloneRec),
    files: (s.files || []).map(cloneRec),
  });
  // ---- folder-workspace dirty tracking (js/workspacefs.js) --------------
  // wsId -> { blocks: Map(id -> record|null), files: Map(id -> record|null),
  // edgesDirty }. A `null` entry means "deleted since the last folder save".
  // Only the app shell links a workspace to a folder, so this stays empty
  // (and free) on the website. recordChange already hands every edit's exact
  // before/after here - the same source markChanged uses for the mini-map -
  // so a folder save never has to diff the whole workspace to find what to
  // write, only replay what this already collected since the last save.
  const wsDirty = new Map();
  function wsDirtyFor(wsId) {
    let d = wsDirty.get(wsId);
    if (!d) { d = { blocks: new Map(), files: new Map(), edgesDirty: false }; wsDirty.set(wsId, d); }
    return d;
  }
  function trackFolderDirty(wsId, before, after) {
    if (!SHELL || wsId == null) return;
    const d = wsDirtyFor(wsId);
    const beforeB = before.blocks || [], afterB = after.blocks || [];
    const afterBIds = new Set(afterB.map(b => b.id));
    for (const b of afterB) d.blocks.set(b.id, b);                          // created or updated
    for (const b of beforeB) if (!afterBIds.has(b.id)) d.blocks.set(b.id, null);   // deleted
    const beforeF = before.files || [], afterF = after.files || [];
    const afterFIds = new Set(afterF.map(f => f.id));
    for (const f of afterF) d.files.set(f.id, f);
    for (const f of beforeF) if (!afterFIds.has(f.id)) d.files.set(f.id, null);
    if ((before.edges && before.edges.length) || (after.edges && after.edges.length)) d.edgesDirty = true;
  }
  function recordChange(before, after, level = state.level) {
    history.past.push({ level, before: cloneSet(before), after: cloneSet(after) });
    if (history.past.length > history.limit) history.past.shift();
    history.future.length = 0;
    markChanged(before, after);        // exactly what changed, straight to the mini-map's index
    trackFolderDirty(state.ws, before, after);
    // A handwriting block can change position or shape without ever passing
    // through finalizeInk/refreshBlockCard - a multi-select drag is exactly
    // this: the record moves and the DOM element follows it, but nothing told
    // the plane's spatial index the stroke was no longer where it last filed
    // it. It kept looking in the old spot, found nothing, and the stroke
    // stayed invisible - masked for as long as the drag's own selection
    // outline covered for it - until the level reloaded and rebuilt the index
    // from scratch. recordChange is where every such move is already known,
    // so the plane is told here rather than at each place that could move ink.
    if (level === state.level) planesNotifyMoved(before, after);
  }
  function clearHistory() { history.past.length = 0; history.future.length = 0; history.gen++; }

  // Ink lands on the page first and in storage second. Everything that writes
  // or rewinds ink queues on this one chain, so an Undo pressed right after a
  // stroke (or an eraser sweep) waits for that stroke to be saved and
  // recorded, and two quick presses run one whole step at a time.
  let inkWrites = Promise.resolve();
  const afterInkWrites = (fn) => {
    const p = inkWrites.then(fn, fn);
    inkWrites = p.catch(() => {});             // a failed step never blocks the next
    return p;
  };

  // all requests are created in one task, so IndexedDB orders them as written
  async function putAll(recs) {
    await Promise.all([
      ...recs.blocks.map(b => DB.saveBlock(b)),
      ...recs.edges.map(e => DB.saveEdge(e)),
      ...recs.files.map(f => DB.saveFile(f)),
    ]);
  }
  async function applyDelta(target, other) {
    await putAll(target);
    const hb = new Set(target.blocks.map(x => x.id));
    const he = new Set(target.edges.map(x => x.id));
    const hf = new Set(target.files.map(x => x.id));
    await Promise.all([
      ...other.blocks.filter(b => !hb.has(b.id)).map(b => DB.del('blocks', b.id)),
      ...other.edges.filter(e => !he.has(e.id)).map(e => DB.delEdge(e.id)),
      ...other.files.filter(f => !hf.has(f.id)).map(f => DB.delFile(f.id)),
    ]);
  }
  function undo() {
    return afterInkWrites(async () => {
      if (!history.past.length) { toast('Nothing to undo'); return; }
      // an open panel's pending edit is written and recorded first, so it is what undoes
      await flushPendingSaves();
      closeOtherEditors();
      const entry = history.past.pop();
      if (!entry) { toast('Nothing to undo'); return; }
      await applyDelta(entry.before, entry.after);
      history.future.push(entry);
      await refreshAfterHistory(entry, true);
      markChanged();
      toast('Undone');
    });
  }
  function redo() {
    return afterInkWrites(async () => {
      if (!history.future.length) { toast('Nothing to redo'); return; }
      await flushPendingSaves();
      closeOtherEditors();
      const entry = history.future.pop();
      if (!entry) { toast('Nothing to redo'); return; }
      await applyDelta(entry.after, entry.before);
      history.past.push(entry);
      await refreshAfterHistory(entry, false);
      markChanged();
      toast('Redone');
    });
  }
  async function refreshAfterHistory(entry, isUndo) {
    const level = entry.level;
    if (level !== DB.ROOT && !(await DB.getBlock(level))) { await loadLevel(DB.ROOT, {}); return; }
    await applyRecsToView(isUndo ? entry.before : entry.after, isUndo ? entry.after : entry.before, level);
  }

  // Apply a delta (a history step, a delete, a paste) to what is on screen
  // without reloading the level: only the records touched are re-read and
  // re-drawn. `target` is what should exist afterwards, `other` what existed
  // before; anything in `other` and not in `target` goes.
  async function applyRecsToView(target, other, level) {
    if (level !== state.level || state.levelLayout === 'list') { await loadLevel(level, {}); return; }
    const LEAF = LEAF_KINDS;
    const onLevel = (r) => r.parentId === state.level;
    const keep = new Set(target.blocks.map(b => b.id));
    const here = new Set(state.blocks.map(b => b.id));
    const parents = new Set();
    // a card on this level whose contents changed gets its chips refreshed
    const noteParent = (pid) => { if (pid && pid !== state.level && here.has(pid)) parents.add(pid); };
    // removals
    const drop = new Set();
    for (const b of other.blocks) {
      noteParent(b.parentId);
      if (!keep.has(b.id) && onLevel(b)) drop.add(b.id);
    }
    if (drop.size) {
      state.blocks = state.blocks.filter(b => !drop.has(b.id));
      for (const id of drop) {
        state.byId.delete(id);
        state.selectedIds.delete(id);
        const el = state.els[id]; if (el) el.remove();
        untrackSize(id);
        delete state.els[id]; delete state.childCounts[id]; if (state.childPeek) delete state.childPeek[id];
        here.delete(id);
      }
    }
    // upserts: always re-read - history holds shallow copies and the editors
    // mutate the live records in place, so a history object must never
    // become the live one
    const fresh = await Promise.all(target.blocks.filter(onLevel).map(rec => DB.getBlock(rec.id)));
    for (const b of fresh) {
      if (!b) continue;
      const i = state.blocks.findIndex(x => x.id === b.id);
      if (i >= 0) state.blocks[i] = b; else state.blocks.push(b);
      state.byId.set(b.id, b);
      // a block that was not on the page has unknown counts until recounted:
      // cards are recounted below; a leaf stays unknown and the eraser takes
      // the careful path for it (see removeInkBlock)
      const prev = state.els[b.id];
      // Ink is never mounted merely for being on screen (virtComputeWanted
      // skips it on purpose - the canvas planes already show it, and its own
      // CSS rule needs a real element to apply .selected/.dragging to, not
      // a viewport check). So unlike every other kind, an ink block that
      // was not already mounted would otherwise never get built at all -
      // still build it here, same as always.
      if (prev || b.kind === 'ink') {
        const el = makeBlockEl(b);                        // sets left/top/z and state.els
        if (prev && prev.parentNode) prev.replaceWith(el); else world.appendChild(el);
      }
      // else: leave it unbuilt for now. Every caller of applyRecsToView
      // already runs recordChange first (mmGrid already knows this block's
      // real position) and this function's own applySelectionClasses below
      // schedules a virtualisation pass - that pass, not this loop, decides
      // whether an off-screen upsert (undo bringing back hundreds of blocks
      // scattered across a page, say) is worth a DOM element right now.
      here.add(b.id);
      if (!LEAF.includes(b.kind)) parents.add(b.id);
    }
    // the objects (and elements) under a live drag may just have been swapped:
    // the next move re-keys its lookup and redraws edges for the rest of it
    if (dragging) { dragging.byId = null; dragging.touchesEdge = true; }
    if (NG.Lift && NG.Lift.has()) NG.Lift.refresh(state.els);
    for (const rec of target.blocks) noteParent(rec.parentId);
    for (const f of [...target.files, ...other.files]) noteParent(f.blockId);
    await Promise.all([...parents].filter(pid => here.has(pid)).map(pid => recount(pid)));
    state.edges = await DB.levelEdges(state.level, state.ws);
    planesRefresh();
    applySelectionClasses(); applyTagFilter(); drawEdges(); scheduleOutline(); updateNavButtons();
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
    const wsEdges = await DB.allByWs('edges', state.ws);
    const edges = wsEdges.filter(e => set.has(e.from) || set.has(e.to));
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

  // Lock / unlock the given blocks (prevents move/resize/rotate). Undoable.
  async function toggleLock(ids) {
    if (!ids || !ids.length) return;
    const blocks = ids.map(id => state.byId.get(id)).filter(Boolean);
    if (!blocks.length) return;
    const makeLocked = !blocks.every(b => b.locked);   // if any unlocked → lock all
    const before = { blocks: blocks.map(b => ({ ...b })), edges: [], files: [] };
    for (const b of blocks) { b.locked = makeLocked; await persistBlock(b); refreshBlockCard(b.id); }
    recordChange(before, { blocks: blocks.map(b => ({ ...b })), edges: [], files: [] });
    toast(makeLocked ? 'Locked' : 'Unlocked');
  }

  /* ---------------------------- arrow-key nudge ------------------------ */
  let nudge = null;   // { before:Map<id,{x,y}>, timer }
  function nudgeSelection(dx, dy) {
    const ids = [...state.selectedIds].filter(id => { const b = state.byId.get(id); return b && !b.locked; });
    if (!ids.length) return;
    if (!nudge) {
      const before = new Map();
      ids.forEach(id => { const b = state.byId.get(id); if (b) before.set(id, { x: b.x, y: b.y }); });
      nudge = { before, timer: null };
    }
    for (const id of ids) {
      const b = state.byId.get(id); if (!b) continue;
      b.x += dx; b.y += dy;
      const el = state.els[id]; if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; }
    }
    positionSelBar();
    drawEdges();
    clearTimeout(nudge.timer);
    nudge.timer = setTimeout(commitNudge, 450);
  }
  async function commitNudge() {
    if (!nudge) return;
    const before = { blocks: [], edges: [], files: [] }, after = { blocks: [], edges: [], files: [] };
    for (const [id, pos] of nudge.before) {
      const b = state.byId.get(id); if (!b) continue;
      if (b.x === pos.x && b.y === pos.y) continue;
      before.blocks.push({ ...b, x: pos.x, y: pos.y });
      after.blocks.push({ ...b });
      await persistBlock(b);
    }
    nudge = null;
    if (after.blocks.length) recordChange(before, after);
  }

  function deleteBlock(id) {
    if (state.readOnly) { toast('Read mode is on.'); return; }
    const b = state.byId.get(id);
    if (!b) return;
    const label = b.kind === 'text'
      ? (b.text ? `“${b.text.slice(0, 24)}”` : 'this text')
      : `“${b.title || 'Untitled'}”`;
    const c = state.childCounts[id] || {};
    const extra = (c.blocks || c.files)
      ? ` It contains ${c.blocks || 0} inner block(s) and ${c.files || 0} file(s) — all will be removed.`
      : '';
    confirmDialog(`Delete ${label}?`, 'Are you sure you want to delete this?' + extra, 'Delete', async () => {
      await flushPendingSaves(); closeOtherEditors();    // no late panel write can bring it back
      const removal = await gatherRemoval([id]);
      await DB.deleteBlockDeep(id);
      recordChange(removal, emptySet());
      await applyRecsToView(emptySet(), removal, state.level);
      toast(b.kind === 'text' ? 'Text deleted' : 'Block deleted');
    });
  }

  /* ---------------------------- selection / drawer --------------------- */
  // Single-click = select (highlight only). Shift+click toggles into a
  // multi-selection; right-drag marquee-selects. Editing is via the edit
  // button / openEditor(); opening the inner canvas is double-click / open btn.
  function syncSelectionButtons() {
    $('#btn-delete')?.classList.toggle('dimmed', state.selectedIds.size === 0);
  }
  // Floating toolbar over a multi-selection.
  // While dragging, the frame and the floating bar are moved by the drag
  // delta instead of re-measuring every selected element on each move.
  let selFrameBox = null;
  // Only trusted while the gesture that captured it is still live; at any
  // other time the elements are measured afresh, so a box can never go stale.
  const liveFrameBox = () => (selFrameBox && (dragging || panning || pinch || selScale || wheelFrameTimer)) ? selFrameBox : null;
  const selectionHasInk = () => [...state.selectedIds].some(id => { const b = state.byId.get(id); return b && b.kind === 'ink'; });

  // The stage rectangle, measured at most once per animation frame. Reading
  // it after a style write forces layout; gesture code reads it every move.
  let stageRectCache = null;
  function stageRect() {
    if (!stageRectCache) {
      stageRectCache = stage.getBoundingClientRect();
      requestAnimationFrame(() => { stageRectCache = null; });
    }
    return stageRectCache;
  }
  // The floating bar's own size changes only with its content; measuring it
  // on every move forced a layout. Re-measured when it is (re)shown.
  let selBarSize = null;
  function measureSelBar() {
    const bar = $('#sel-bar'); if (!bar) return;
    const wasHidden = bar.hidden; bar.hidden = false;
    selBarSize = { w: bar.offsetWidth || 320, h: bar.offsetHeight || 44 };
    bar.hidden = wasHidden;
  }
  function positionSelBar() {
    const bar = $('#sel-bar'); if (!bar) return;
    const ids = [...state.selectedIds];
    // With the Select tool up, or when handwriting has been picked up by a
    // tap — never over what you have just written.
    const selecting = state.selectTool || selectionHasInk();
    if (!ids.length || !selecting || state.levelLayout !== 'canvas') { bar.hidden = true; return; }
    // align/distribute need two; with one item only the style tools apply
    bar.querySelectorAll('[data-align]').forEach(b => { b.disabled = ids.length < 2; });
    bar.querySelector('[data-sel="group"]').disabled = ids.length < 2;
    bar.querySelector('[data-sel="ungroup"]').disabled = !ids.some(id => { const b = state.byId.get(id); return b && b.group; });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const sr = stageRect();
    const fb = liveFrameBox();
    if (fb) {
      // mid-gesture: use the box we are already carrying rather than measuring
      // every element again on each pointer move
      const sc = state.view.scale || 1;
      minX = fb.x * sc + state.view.tx + sr.left;
      minY = fb.y * sc + state.view.ty + sr.top;
      maxX = minX + fb.w * sc; maxY = minY + fb.h * sc;
    } else {
      const sc = state.view.scale || 1;
      ids.forEach(id => {
        const b = state.byId.get(id);
        if (b && b.kind === 'ink') {                 // strokes: from data, no layout read
          const ib = inkBox(b);
          const l = ib.x * sc + state.view.tx + sr.left, t = ib.y * sc + state.view.ty + sr.top;
          minX = Math.min(minX, l); maxX = Math.max(maxX, l + ib.w * sc);
          minY = Math.min(minY, t); maxY = Math.max(maxY, t + ib.h * sc);
          return;
        }
        const el = state.els[id]; if (!el) return;
        // A turned block's box is wider than its size, so that one is measured;
        // everything else comes from the size cache and forces no layout.
        if (b.rot) {
          const r = el.getBoundingClientRect();
          minX = Math.min(minX, r.left); maxX = Math.max(maxX, r.right);
          minY = Math.min(minY, r.top); maxY = Math.max(maxY, r.bottom);
          return;
        }
        const sz = elSize(id, el) || { w: BLOCK_W, h: BLOCK_H_GUESS };
        const l = (b.x || 0) * sc + state.view.tx + sr.left, t = (b.y || 0) * sc + state.view.ty + sr.top;
        minX = Math.min(minX, l); maxX = Math.max(maxX, l + sz.w * sc);
        minY = Math.min(minY, t); maxY = Math.max(maxY, t + sz.h * sc);
      });
    }
    if (!isFinite(minX)) { bar.hidden = true; selBarSize = null; return; }
    bar.hidden = false;
    if (!selBarSize) selBarSize = { w: bar.offsetWidth || 320, h: bar.offsetHeight || 44 };
    const bw = selBarSize.w, bh = selBarSize.h;
    let left = (minX + maxX) / 2 - sr.left - bw / 2;
    left = clamp(left, 8, Math.max(8, sr.width - bw - 8));
    let top = minY - sr.top - bh - 12;
    if (top < 8) top = Math.min(sr.height - bh - 8, maxY - sr.top + 12);
    // moved by transform: a composite-only change, no layout per frame
    bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  /* ----------------------- selection frame + scaling -------------------- *
   * A dashed box round everything picked up by a Select tool, with a corner
   * grip. Dragging the grip scales the whole selection about the box's
   * top-left: handwriting keeps its shape, typed text grows its font, boxes
   * and images grow their width and height.                                */
  let selScale = null;

  // Measured off the real elements, not b.w/b.h: a stroke is painted a few
  // pixels wider than its point bounds (nib padding) and a rotated node is
  // wider still, so block coordinates would draw the frame inside the ink.
  function selectionWorldBox() {
    const sr = stageRect();
    const sc = state.view.scale || 1;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const byId = new Map(state.blocks.map(b => [b.id, b]));
    state.selectedIds.forEach(id => {
      const b = byId.get(id); if (!b) return;
      const el = state.els[id];
      let x, y, w, h;
      if (b.kind === 'ink') {                        // strokes: from data, no layout read
        const ib = inkBox(b); x = ib.x; y = ib.y; w = ib.w; h = ib.h;
      } else if (el && b.rot) {                      // turned: its box is wider than its size
        const r = el.getBoundingClientRect();
        x = (r.left - sr.left - state.view.tx) / sc;
        y = (r.top - sr.top - state.view.ty) / sc;
        w = r.width / sc; h = r.height / sc;
      } else if (el) {
        const sz = elSize(id, el) || { w: BLOCK_W, h: BLOCK_H_GUESS };
        x = b.x || 0; y = b.y || 0; w = sz.w; h = sz.h;
      } else {
        const box = blockBox(b); x = box.x; y = box.y; w = box.w; h = box.h;
      }
      minX = Math.min(minX, x); maxX = Math.max(maxX, x + w);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y + h);
    });
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function positionSelFrame() {
    const f = $('#sel-frame'); if (!f) return;
    const selecting = state.selectTool || selectionHasInk();
    if (!selecting || state.readOnly || !state.selectedIds.size || state.levelLayout !== 'canvas') {
      f.hidden = true; return;
    }
    const box = selScale ? selScale.box : (liveFrameBox() || selectionWorldBox());
    if (!box) { f.hidden = true; return; }
    const sc = state.view.scale || 1;
    const pad = 6;                                  // breathing room, in screen px
    f.hidden = false;
    // position by transform (composite-only); the size is written only when it changes
    f.style.transform = `translate(${Math.round(box.x * sc + state.view.tx - pad)}px, ${Math.round(box.y * sc + state.view.ty - pad)}px)`;
    const w = Math.round(box.w * sc + pad * 2) + 'px', h = Math.round(box.h * sc + pad * 2) + 'px';
    if (f.style.width !== w) f.style.width = w;
    if (f.style.height !== h) f.style.height = h;
  }

  // Snapshot every selected block so each move scales from the start state -
  // rescaling the live values would drift.
  function beginSelScale(e) {
    const box = selectionWorldBox(); if (!box) return;
    const items = [...state.selectedIds]
      .map(id => state.byId.get(id))
      .filter(b => b && !b.locked);
    if (!items.length) return;
    selScale = {
      pointerId: e.pointerId, box, box0: box, startX: e.clientX, startY: e.clientY,
      before: { blocks: items.map(b => ({ ...b })), edges: [], files: [] },
      touchesEdge: (() => { const ids = new Set(items.map(b => b.id)); return state.edges.some(ed => ids.has(ed.from) || ids.has(ed.to)); })(),
      items: items.map(b => ({
        b,
        x: b.x || 0, y: b.y || 0, w: b.w || 0, h: b.h || 0,
        size: b.size || 0, fontSize: b.fontSize || 0, width: b.width || 0,
        colW: (b.colW || []).slice(), rowH: (b.rowH || []).slice(),
        pts: b.kind === 'ink' && Array.isArray(b.pts) ? b.pts.map(q => q.slice()) : null,
      })),
    };
    if (items.length >= 2 && NG.Lift) { NG.Lift.begin(items.map(b => b.id), 'scale', { world, els: state.els }); selScale.lifted = true; }
    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
  }

  // The grip moves at digitiser rate; the selection is rebuilt once per frame.
  function moveSelScale(e) {
    if (!selScale) return;
    selScale.pendingEvent = e;
    if (!selScale.raf) selScale.raf = requestAnimationFrame(() => {
      if (!selScale) return;
      selScale.raf = 0; applySelScale(selScale.pendingEvent);
    });
  }
  function applySelScale(e) {
    if (!selScale || !e) return;
    const sc = state.view.scale || 1;
    const box = selScale.box0;
    // the grip sits at the box's bottom-right corner, so the drag along the
    // diagonal is simply the box's new size
    const dx = (e.clientX - selScale.startX) / sc, dy = (e.clientY - selScale.startY) / sc;
    const ratio = clamp(((box.w + dx) / box.w + (box.h + dy) / box.h) / 2, 0.02, 200);
    selScale.ratio = ratio;
    if (selScale.lifted && !selScale.finalizing) {
      // mid-gesture the whole selection scales as one transform (one style
      // write); the per-item data below is written once, on release
      NG.Lift.scale(box.x, box.y, ratio);
      selScale.box = { x: box.x, y: box.y, w: box.w * ratio, h: box.h * ratio };
      positionSelFrame();
      return;
    }
    for (const it of selScale.items) {
      const b = it.b;
      b.x = Math.round(box.x + (it.x - box.x) * ratio);
      b.y = Math.round(box.y + (it.y - box.y) * ratio);
      if (b.kind === 'ink') {
        // handwriting scales by its actual points, so bounds, the eraser and
        // every export keep working with no special case
        if (it.pts) b.pts = it.pts.map(q => [q[0] * ratio, q[1] * ratio, q[2], q[3]]);
        if (it.w) b.w = Math.max(1, it.w * ratio);
        if (it.h) b.h = Math.max(1, it.h * ratio);
        if (it.width) b.width = Math.max(0.4, it.width * ratio);
      } else if (b.kind === 'text') {
        if (it.size) b.size = clamp(Math.round(it.size * ratio), 4, 4000);
        if (it.w) b.w = Math.max(20, Math.round(it.w * ratio));
      } else if (b.kind === 'check') {
        if (it.size) b.size = clamp(Math.round(it.size * ratio), 12, 600);
      } else if (b.kind === 'table') {
        if (it.fontSize) b.fontSize = clamp(Math.round(it.fontSize * ratio), 5, 400);
        if (it.w) b.w = Math.max(60, Math.round(it.w * ratio));
        if (it.h) b.h = Math.max(40, Math.round(it.h * ratio));
        if (it.colW.length) b.colW = it.colW.map(w => w ? Math.max(20, Math.round(w * ratio)) : w);
        if (it.rowH.length) b.rowH = it.rowH.map(h => h ? Math.max(16, Math.round(h * ratio)) : h);
      } else {
        if (it.w) b.w = clamp(Math.round(it.w * ratio), 8, 200000);
        if (it.h) b.h = clamp(Math.round(it.h * ratio), 8, 200000);
      }
      const el = state.els[b.id];
      if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; }
      refreshBlockCard(b.id);
    }
    selScale.box = { x: box.x, y: box.y, w: box.w * ratio, h: box.h * ratio };
    positionSelFrame();
    if (selScale.touchesEdge) drawEdges(); else scheduleMinimap();
  }

  async function endSelScale() {
    if (!selScale) return;
    if (selScale.raf) { cancelAnimationFrame(selScale.raf); selScale.raf = 0; }
    if (selScale.lifted) {
      selScale.finalizing = true;                                       // the per-item data scaling runs once, now
      if (selScale.pendingEvent) applySelScale(selScale.pendingEvent);
      NG.Lift.end(true);
      if (NG.Overlay) NG.Overlay.draw();
    } else if (selScale.pendingEvent) applySelScale(selScale.pendingEvent);   // the last move lands
    const { items, before, ratio } = selScale;
    selScale = null;
    if (!ratio || Math.abs(ratio - 1) < 0.001) { positionSelFrame(); return; }
    items.forEach(it => { it.b.updatedAt = Date.now(); });
    recordChange(before, { blocks: items.map(it => ({ ...it.b })), edges: [], files: [] });
    await Promise.all(items.map(it => DB.saveBlock(it.b)));
    positionSelFrame(); positionSelBar(); drawEdges();
    toast(ratio > 1 ? 'Scaled up' : 'Scaled down');
  }

  // A grip drag that lost its pointer (focus went away) puts everything back.
  function cancelSelScale() {
    if (!selScale) return;
    if (selScale.raf) cancelAnimationFrame(selScale.raf);
    const { items, before } = selScale; selScale = null;
    for (const it of items) {
      const snap = before.blocks.find(x => x.id === it.b.id);
      if (snap) Object.assign(it.b, snap);
      const el = state.els[it.b.id]; if (el) { el.style.left = it.b.x + 'px'; el.style.top = it.b.y + 'px'; }
      refreshBlockCard(it.b.id);
    }
    if (NG.Lift && NG.Lift.has()) NG.Lift.end(false);
    positionSelFrame(); positionSelBar(); drawEdges();
  }

  function bindSelFrame() {
    const grip = $('#sel-frame .sel-grip'); if (!grip) return;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || state.readOnly) return;
      e.preventDefault(); e.stopPropagation();
      beginSelScale(e);
    });
    window.addEventListener('pointermove', (e) => {
      if (selScale && e.pointerId === selScale.pointerId) { e.preventDefault(); moveSelScale(e); }
    }, { passive: false });
    window.addEventListener('pointerup', (e) => {
      if (selScale && e.pointerId === selScale.pointerId) endSelScale();
    });
    window.addEventListener('pointercancel', (e) => {
      if (selScale && e.pointerId === selScale.pointerId) endSelScale();
    });
  }

  let prevSel = new Set();
  function applySelectionClasses() {
    // a carried frame box describes the previous selection
    if (selFrameBox && !selScale) selFrameBox = (panning || pinch) ? selectionWorldBox() : null;
    const sel = state.selectedIds;
    // only what changed: the class comes off what left the selection and goes
    // on what is in it (a replaced element gets it back too)
    // a whole paragraph picked up at once: the per-stroke glow gives way to a
    // light outline (hundreds of blurred surfaces is what made lassos slow);
    // decided before the classes go on so the restyle is the cheap one
    world.classList.toggle('many-sel', sel.size > 12);
    if (!selBarSize && sel.size) measureSelBar();       // while the tree is clean: one cheap layout
    for (const id of prevSel) if (!sel.has(id)) { const el = state.els[id]; if (el) el.classList.remove('selected'); }
    for (const id of sel) { const el = state.els[id]; if (el && !el.classList.contains('selected')) el.classList.add('selected'); }
    // the chrome follows the selection, not the page
    for (const id of prevSel) if (!sel.has(id)) unmountChrome(id);
    for (const id of sel) if (!prevSel.has(id)) mountChrome(id);
    prevSel = new Set(sel);
    planesSync(false);
    if (NG.Overlay) NG.Overlay.draw();
    if (state.levelLayout === 'list') $$('.list-row').forEach(n => n.classList.toggle('selected', sel.has(n.dataset.id)));
    syncSelectionButtons();
    positionSelBar();
    positionSelFrame();
    scheduleVirtApply();   // a selection can pick up off-screen blocks (Select All) - they need building too, not just the class
  }
  /* -------------------------- alignment guides -------------------------- *
   * While dragging, if an edge or centre comes within a few pixels of the
   * same line on another block, the drag snaps to it and the line is drawn.  */
  const GUIDE_SNAP = 6;                       // screen px
  function blockBox(b) {
    const el = state.els[b.id];
    const s = b.w && b.h ? null : elSize(b.id, el);
    const w = (b.w || (s && s.w) || BLOCK_W);
    const h = (b.h || (s && s.h) || BLOCK_H_GUESS);
    return { x: b.x || 0, y: b.y || 0, w, h };
  }
  function alignAdjust(drag, dxW, dyW, byId) {
    const moving = drag.ids.map(id => byId ? byId.get(id) : state.byId.get(id)).filter(Boolean);
    if (!moving.length) return { dx: 0, dy: 0 };
    // Handwriting is placed by hand, not by rules — no guide snapping for it.
    if (moving.every(b => b.kind === 'ink')) { clearGuides(); return { dx: 0, dy: 0 }; }
    // the moving group's box at the current drag position
    let mx = Infinity, my = Infinity, mX = -Infinity, mY = -Infinity;
    moving.forEach(b => {
      const st = drag.starts[b.id]; if (!st) return;
      const bb = blockBox(b);
      const x = st.x + dxW, y = st.y + dyW;
      mx = Math.min(mx, x); my = Math.min(my, y);
      mX = Math.max(mX, x + bb.w); mY = Math.max(mY, y + bb.h);
    });
    // The candidate list (everything else on the level) and each candidate's
    // three v/h guide lines never change mid-drag — only the moving group's
    // position does. Rebuilding this by filtering and re-measuring the whole
    // level on every pointermove was the actual cost here (the id lookup
    // above was already O(1) via `byId`); cache it once per drag instead.
    if (!drag._alignCand) {
      const movingIds = new Set(drag.ids);
      const others = state.blocks.filter(b => b.parentId === state.level && !movingIds.has(b.id));
      drag._alignCand = others.map(o => {
        const ob = blockBox(o);
        return { ov: [ob.x, ob.x + ob.w / 2, ob.x + ob.w], oh: [ob.y, ob.y + ob.h / 2, ob.y + ob.h] };
      });
    }
    const tol = GUIDE_SNAP / state.view.scale;
    const mine = { v: [mx, (mx + mX) / 2, mX], h: [my, (my + mY) / 2, mY] };
    let best = { dx: null, dy: null, gx: [], gy: [] };
    for (const cand of drag._alignCand) {
      for (const m of mine.v) for (const t of cand.ov) {
        const d = t - m;
        if (Math.abs(d) <= tol && (best.dx === null || Math.abs(d) < Math.abs(best.dx))) { best.dx = d; best.gx = [t]; }
      }
      for (const m of mine.h) for (const t of cand.oh) {
        const d = t - m;
        if (Math.abs(d) <= tol && (best.dy === null || Math.abs(d) < Math.abs(best.dy))) { best.dy = d; best.gy = [t]; }
      }
    }
    drawGuides(best.gx, best.gy);
    return { dx: best.dx || 0, dy: best.dy || 0 };
  }
  function drawGuides(xs, ys) {
    let layer = $('#guide-layer');
    if (!layer) {
      layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layer.setAttribute('id', 'guide-layer');
      svg.appendChild(layer);
    }
    layer.innerHTML = '';
    const span = 100000;
    (xs || []).forEach(x => {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('class', 'align-guide');
      l.setAttribute('x1', x); l.setAttribute('x2', x);
      l.setAttribute('y1', -span); l.setAttribute('y2', span);
      layer.appendChild(l);
    });
    (ys || []).forEach(y => {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('class', 'align-guide');
      l.setAttribute('y1', y); l.setAttribute('y2', y);
      l.setAttribute('x1', -span); l.setAttribute('x2', span);
      layer.appendChild(l);
    });
  }
  const clearGuides = () => { const g = $('#guide-layer'); if (g) g.innerHTML = ''; };

  /* ------------------------ align + distribute -------------------------- */
  async function alignSelection(how) {
    const ids = [...state.selectedIds];
    if (ids.length < 2) { toast('Select two or more blocks first.'); return; }
    const items = ids.map(id => state.byId.get(id)).filter(b => b && !b.locked);
    if (items.length < 2) return;
    const undoBefore = { blocks: items.map(b => ({ ...b })), edges: [], files: [] };
    const boxes = items.map(b => ({ b, ...blockBox(b) }));
    const minX = Math.min(...boxes.map(o => o.x)), maxX = Math.max(...boxes.map(o => o.x + o.w));
    const minY = Math.min(...boxes.map(o => o.y)), maxY = Math.max(...boxes.map(o => o.y + o.h));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    if (how === 'dist-h' || how === 'dist-v') {
      const horiz = how === 'dist-h';
      boxes.sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
      const total = horiz ? (maxX - minX) : (maxY - minY);
      const used = boxes.reduce((t, o) => t + (horiz ? o.w : o.h), 0);
      const gap = (total - used) / (boxes.length - 1);
      let at = horiz ? minX : minY;
      boxes.forEach(o => {
        if (horiz) { o.b.x = Math.round(at); at += o.w + gap; }
        else { o.b.y = Math.round(at); at += o.h + gap; }
      });
    } else {
      boxes.forEach(o => {
        if (how === 'left') o.b.x = Math.round(minX);
        else if (how === 'right') o.b.x = Math.round(maxX - o.w);
        else if (how === 'center') o.b.x = Math.round(cx - o.w / 2);
        else if (how === 'top') o.b.y = Math.round(minY);
        else if (how === 'bottom') o.b.y = Math.round(maxY - o.h);
        else if (how === 'middle') o.b.y = Math.round(cy - o.h / 2);
      });
    }
    for (const o of boxes) {
      o.b.updatedAt = Date.now();
      await DB.saveBlock(o.b);
      const el = state.els[o.b.id];
      if (el) { el.style.left = o.b.x + 'px'; el.style.top = o.b.y + 'px'; }
    }
    recordChange(undoBefore, { blocks: items.map(b => ({ ...b })), edges: [], files: [] });
    drawEdges(); positionSelBar();
    toast('Aligned');
  }

  // Tab: a new block beside this one, ready to name.
  async function addSibling(id) {
    const b = state.byId.get(id); if (!b) return;
    const box = blockBox(b);
    // createBlock centres the new block on the point it is given
    await createBlock('block', { x: box.x + box.w + 40 + BLOCK_W / 2, y: box.y + 30 });
  }

  /* --------------------- full screen + axis locks ----------------------- *
   * Full screen hides the browser chrome; in the app the system bars go too,
   * and a swipe from the edge brings them back when needed.                */
  function toggleMinimap() {
    minimapOn = !minimapOn;
    try { localStorage.setItem('ng-minimap', minimapOn ? '1' : '0'); } catch (_) {}
    drawMinimap(); updateMenuStates();
    toast(minimapOn ? 'Mini-map on' : 'Mini-map off');
  }

  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : Promise.reject())
        .catch(() => toast('Full screen is not available here.'));
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // Pan on one axis only, for reading long notes without drifting sideways.
  let axisLock = null;                       // null | 'x' | 'y'
  try { axisLock = localStorage.getItem('ng-axis-lock') || null; } catch (_) {}
  function setAxisLock(v) {
    axisLock = v || null;
    try { if (axisLock) localStorage.setItem('ng-axis-lock', axisLock); else localStorage.removeItem('ng-axis-lock'); } catch (_) {}
    updateMenuStates();
    toast(axisLock === 'x' ? 'Panning locked to horizontal'
        : axisLock === 'y' ? 'Panning locked to vertical' : 'Panning unlocked');
  }

  // Keep the ... menu's little state labels honest.
  function updateMenuStates() {
    const set = (id, on) => { const e = $(id); if (e) e.textContent = on ? 'on' : 'off'; };
    set('#map-state', minimapOn);
    set('#autosave-state', !!($('#autosave') && $('#autosave').checked));
    set('#lockx-state', axisLock === 'x');
    set('#locky-state', axisLock === 'y');
    set('#fs-state', !!document.fullscreenElement);
    syncFullscreenButton();
  }

  // The landing screen's full-screen button wears the current state: expand
  // when windowed, compress + "Exit full screen" while full screen is on.
  function syncFullscreenButton() {
    const b = $('#btn-fullscreen'); if (!b) return;
    const on = !!document.fullscreenElement;
    const name = on ? 'compress' : 'expand';
    const ico = b.querySelector('[data-icon]');
    if (ico && ico.getAttribute('data-icon') !== name) { ico.setAttribute('data-icon', name); ico.innerHTML = ic(name); }
    b.title = on ? 'Exit full screen' : 'Full screen';
  }

  /* ------------------------------ read mode ----------------------------- *
   * Everything visible, nothing changeable: no dragging, editing, deleting
   * or drawing — just look around and step into blocks.                    */
  function setReadMode(on) {
    state.readOnly = !!on;
    document.getElementById('app').classList.toggle('reading', state.readOnly);
    $('#btn-read')?.classList.toggle('active', state.readOnly);
    if (state.readOnly) {
      setPenMode(false); setEraser(false, true); setLinkMode(false); setSelectMode(false);
      clearSelection(); closeOtherEditors();
    }
    toast(state.readOnly ? 'Read mode on — nothing can be changed' : 'Read mode off');
  }

  /* --------------------------- format painter --------------------------- *
   * Copy one block's look, then stamp it onto anything else selected.      */
  const STYLE_FIELDS = ['color', 'font', 'size', 'bold', 'italic', 'align', 'glow', 'glowColor',
                        'fill', 'outline', 'outlineW', 'outlineColor', 'round', 'width', 'style',
                        'dash', 'layout'];
  // What a look means depends on what it lands on: a text's size must not
  // resize a checkbox, and a card's "opens as list" is not a look at all for
  // anything else. Across kinds only the colour travels.
  const STYLE_BY_KIND = {
    text:  ['color', 'font', 'size', 'bold', 'italic', 'align', 'glow', 'glowColor'],
    shape: ['color', 'fill', 'outline', 'outlineW', 'outlineColor'],
    image: ['round', 'outline', 'outlineW', 'outlineColor'],
    ink:   ['color', 'width', 'style'],
    check: ['color', 'size'],
    table: ['color', 'font', 'size', 'bold', 'align'],
    block: ['color', 'layout'],
  };
  let styleClip = null;
  function copyStyle() {
    const id = [...state.selectedIds][0];
    const b = id && state.byId.get(id);
    if (!b) { toast('Select a block to copy its look.'); return; }
    styleClip = {};
    STYLE_FIELDS.forEach(f => { if (b[f] !== undefined) styleClip[f] = b[f]; });
    styleClip.__kind = b.kind || 'block';
    $('#sel-bar')?.querySelector('[data-sel="paint"]')?.classList.add('armed');
    toast('Look copied — select others and paste the look');
  }
  async function pasteStyle() {
    if (!styleClip) { toast('Copy a look first (Ctrl+Alt+C).'); return; }
    const ids = [...state.selectedIds];
    if (!ids.length) { toast('Select what to paint.'); return; }
    const items = ids.map(id => state.byId.get(id)).filter(Boolean);
    const undoBefore = { blocks: items.map(b => ({ ...b })), edges: [], files: [] };
    let done = 0;
    const from = styleClip.__kind || 'block';
    let colourOnly = 0;
    for (const b of items) {
      const kind = b.kind || 'block';
      const fields = STYLE_BY_KIND[kind] || ['color'];
      const same = kind === from;
      if (!same) colourOnly++;
      fields.forEach(f => { if (styleClip[f] !== undefined && (same || f === 'color')) b[f] = styleClip[f]; });
      b.updatedAt = Date.now();
      await DB.saveBlock(b);
      refreshItem(b.id);
      done++;
    }
    recordChange(undoBefore, { blocks: items.map(b => ({ ...b })), edges: [], files: [] });
    drawEdges();
    toast(done + (done === 1 ? ' block painted' : ' blocks painted') +
          (colourOnly ? ' \u2014 only the colour fits a different kind' : ''));
  }

  /* ------------------------------ groups -------------------------------- *
   * Blocks sharing a `group` id move, style and delete as one. Strokes
   * written in the same burst are grouped automatically, so a handwritten
   * paragraph behaves like one note instead of forty separate marks.       */
  function groupMembers(id) {
    const b = state.byId.get(id);
    if (!b || !b.group) return [id];
    return state.blocks.filter(x => x.group === b.group).map(x => x.id);
  }
  // Grow a set of ids to include every group-mate (one pass over the blocks,
  // not one scan per id).
  function withGroups(ids) {
    const out = new Set();
    const list = Array.from(ids);
    if (!list.length) return [];
    const byId = new Map(state.blocks.map(b => [b.id, b]));
    let byGroup = null;
    for (const id of list) {
      const b = byId.get(id);
      if (!b || !b.group) { out.add(id); continue; }
      if (!byGroup) {
        byGroup = new Map();
        for (const x of state.blocks) if (x.group) { let l = byGroup.get(x.group); if (!l) byGroup.set(x.group, l = []); l.push(x.id); }
      }
      for (const m of byGroup.get(b.group) || [id]) out.add(m);
    }
    return [...out];
  }
  async function groupSelection() {
    const ids = [...state.selectedIds];
    if (ids.length < 2) { toast('Select two or more things to group.'); return; }
    const items = ids.map(id => state.byId.get(id)).filter(Boolean);
    const undoBefore = { blocks: items.map(b => ({ ...b })), edges: [], files: [] };
    const gid = uid();
    for (const b of items) {
      b.group = gid; b.updatedAt = Date.now();
      await DB.saveBlock(b);
    }
    recordChange(undoBefore, { blocks: items.map(b => ({ ...b })), edges: [], files: [] });
    setSelection(ids);
    toast(ids.length + ' items grouped');
  }
  async function ungroupSelection() {
    const ids = withGroups([...state.selectedIds]);
    const items = ids.map(id => state.byId.get(id)).filter(b => b && b.group);
    if (!items.length) { toast('Nothing grouped here.'); return; }
    const undoBefore = { blocks: items.map(b => ({ ...b })), edges: [], files: [] };
    for (const b of items) {
      delete b.group; b.updatedAt = Date.now();
      await DB.saveBlock(b);
    }
    recordChange(undoBefore, { blocks: items.map(b => ({ ...b })), edges: [], files: [] });
    setSelection(ids);
    toast('Ungrouped');
  }

  function selectBlock(id) {              // replace selection with just this one
    state.selectedIds = new Set(withGroups([id]));
    applySelectionClasses();
  }
  function toggleSelect(id) {             // shift+click
    const mates = withGroups([id]);
    if (state.selectedIds.has(id)) mates.forEach(m => state.selectedIds.delete(m));
    else mates.forEach(m => state.selectedIds.add(m));
    applySelectionClasses();
  }
  function setSelection(ids) {
    state.selectedIds = new Set(withGroups(ids));
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
    if (state.readOnly) { toast('Read mode is on.'); return; }
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    if (ids.length === 1) { deleteBlock(ids[0]); return; }
    confirmDialog(`Delete ${ids.length} blocks?`,
      'Are you sure you want to delete these? Everything inside them is removed too.', 'Delete', async () => {
        await flushPendingSaves(); closeOtherEditors();
        const removal = await gatherRemoval(ids);
        for (const id of ids) await DB.deleteBlockDeep(id);
        recordChange(removal, emptySet());
        await applyRecsToView(emptySet(), removal, state.level);
        toast(`${ids.length} blocks deleted`);
      });
  }

  /* ---------------------------- copy / paste --------------------------- */
  // Clipboard holds a DEEP snapshot: the selected blocks, every descendant,
  // all edges between them (at each level), and all attached files.
  let clipboard = null;   // { roots:[id], blocks:[], edges:[], files:[] }
  let clipStamp = null;   // exportedAt of the copy we last put on the device clipboard

  async function copySelection(silent) {
    await flushPendingSaves();                          // flush any pending edit
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
    // the device clipboard too, so the copy can be pasted into another
    // workspace or into the app on another device (one-off, off the hot path)
    clipStamp = null;
    if (NG.Clip) {
      try {
        const r = await NG.Clip.write(clipboard);
        if (r && r.ok) clipStamp = r.exportedAt;
        if (r && r.dropped) toast(r.dropped + (r.dropped === 1 ? ' attachment is' : ' attachments are') + ' too large to travel to other devices');
      } catch (_) {}
    }
    if (!silent) toast(`Copied ${ids.length} block${ids.length > 1 ? 's' : ''}`);
    return true;
  }

  // Cut = copy into the clipboard, then remove (no confirm; undoable).
  async function cutSelection() {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    await flushPendingSaves(); closeOtherEditors();
    await copySelection(true);
    const removal = await gatherRemoval(ids);
    for (const id of ids) await DB.deleteBlockDeep(id);
    recordChange(removal, emptySet());
    await applyRecsToView(emptySet(), removal, state.level);
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

  // Paste: the device clipboard first (blocks copied elsewhere, an image, some
  // text), then what was copied in this session.
  async function pasteClipboard() {
    let got = null;
    try { got = NG.Clip ? await NG.Clip.read() : null; } catch (_) { got = null; }
    if (await pasteResult(got)) return;
    if (!clipboard) { toast('Nothing to paste'); return; }
    await pasteSnapshot(clipboard, 'Pasted');
  }
  // One clipboard result -> blocks on the page. Returns false when nothing usable.
  async function pasteResult(got) {
    if (!got) return false;
    if (state.ws == null || state.levelLayout !== 'canvas') return false;
    if (got.kind === 'ng' && got.snapshot) {
      // our own copy, still in memory: paste that (nothing dropped for size)
      const own = clipboard && clipStamp && got.snapshot.exportedAt === clipStamp;
      await pasteSnapshot(own ? clipboard : got.snapshot, 'Pasted'); return true;
    }
    if (got.kind === 'image' && got.blob) { await pasteImageBlobs((got.blobs && got.blobs.length) ? got.blobs : [got.blob]); return true; }
    // plain text on the device clipboard: it is newer than our copy when that
    // copy did reach the clipboard (clipStamp), or there is no copy at all
    if (got.kind === 'text' && got.text && got.text.trim() && (!clipboard || clipStamp)) {
      await createTextFromFile(new File([got.text], 'clipboard.txt', { type: 'text/plain' }), { at: pasteAt(), silent: true });
      toast('Text pasted'); return true;
    }
    return false;
  }
  // where a paste lands: under the cursor when it is over the canvas, else the view centre
  function pasteAt() {
    const r = stage.getBoundingClientRect();
    const p = lastPointer;
    const overStage = p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    return overStage ? screenToWorld(p.x - r.left, p.y - r.top) : centerOfView();
  }
  async function pasteImageBlobs(files) {
    const c = pasteAt();
    let i = 0;
    for (const f of files) { await createImageBlock(f, { at: { x: c.x + i * 24, y: c.y + i * 24 }, openAfter: false }); i++; }
    toast(files.length > 1 ? `${files.length} images pasted` : 'Image pasted');
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
      const ne = edgeIn({ id: uid(), ws: state.ws, parentId: idMap.get(e.parentId) || state.level, from, to, createdAt: now }, e);
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
    state.tagFilter = null;                            // as a fresh level load would
    await applyRecsToView({ blocks: madeBlocks, edges: madeEdges, files: madeFiles }, emptySet(), state.level);
    setSelection(newRoots);
    toast(`${verb || 'Pasted'} ${roots.length} block${roots.length > 1 ? 's' : ''}`);
  }

  let drawerBlock = null;
  let editBaseline = null;   // snapshot of editable fields when an editor opened
  const saveState = $('#save-state');
  let saveTimer = null;
  // superset covering both the block editor and the text editor
  const EDIT_FIELDS = ['title', 'description', 'notes', 'tags', 'color', 'layout', 'text', 'font', 'size', 'bold', 'italic', 'align', 'orient', 'rot', 'glow', 'glowColor', 'shape', 'w', 'h', 'fill', 'outline', 'outlineW', 'outlineColor', 'src', 'round', 'width', 'nowrap', 'style', 'points', 'dash', 'checked'];

  function snapshotFields(b) {
    const o = { id: b.id };
    EDIT_FIELDS.forEach(f => { o[f] = b[f]; });
    return o;
  }

  // Link an editable number field to its range slider. `apply(value)` writes the
  // value to the active block (and refreshes/saves). Typed values are NOT clamped
  // to the slider's min/max — you can enter any angle/size; the slider just mirrors
  // it (pinned at its own range). Dragging the on-canvas handles is likewise free.
  function wireParam(numId, sliderId, apply) {
    const num = $('#' + numId), sl = $('#' + sliderId);
    if (!num || !sl) return;
    sl.addEventListener('input', () => {
      const v = parseFloat(sl.value); if (isNaN(v)) return;
      apply(v); num.value = v;
    });
    num.addEventListener('input', () => {
      if (num.value === '') return;
      const v = parseFloat(num.value); if (isNaN(v)) return;
      apply(v); sl.value = v;                       // slider clamps its own display only
    });
  }

  // Reset the currently-open editor's block to how it was when the editor opened
  // (the editBaseline snapshot). Reverts every editable field; position is left as-is.
  function resetActiveEditor() {
    const base = editBaseline; if (!base) return;
    const b = state.byId.get(base.id); if (!b) return;
    EDIT_FIELDS.forEach(f => { b[f] = base[f]; });
    refreshItem(b.id); persistBlock(b); markChanged();
    // repopulate the open drawer's fields (re-open snapshots the same baseline)
    if (b.kind === 'text') openTextEditor(b.id);
    else if (b.kind === 'shape') openShapeEditor(b.id);
    else if (b.kind === 'image') openImageEditor(b.id);
    else if (b.kind === 'check') openCheckEditor(b.id);
    else if (b.kind === 'ink') openInkEditor(b.id);
    else openDrawer(b.id);
    toast('Reset to original');
  }

  // Reset a single parameter (the reset button beside a number field) to its
  // value when the editor opened. `data-fields` lists the block props to revert.
  function resetParamField(btn) {
    const base = editBaseline; if (!base) return;
    const b = state.byId.get(base.id); if (!b) return;
    const fields = (btn.dataset.fields || '').split(',').filter(Boolean);
    if (!fields.length) return;
    fields.forEach(f => { b[f] = base[f]; });
    refreshItem(b.id); persistBlock(b); markChanged();
    const num = $('#' + btn.dataset.num), sl = $('#' + btn.dataset.slider), primary = fields[0];
    if (num) num.value = b[primary];
    if (sl) sl.value = b[primary];
  }
  // open the right editor for a block (text vs normal)
  function openAnyEditor(id) {
    const b = state.byId.get(id);
    if (b && b.kind === 'text') openTextEditor(id);
    else if (b && b.kind === 'shape') openShapeEditor(id);
    else if (b && b.kind === 'image') openImageEditor(id);
    else if (b && b.kind === 'check') openCheckEditor(id);
    else if (b && b.kind === 'ink') openInkEditor(id);
    else if (b && b.kind === 'table') openTableEditor(id);
    else openEditor(id);
  }

  // Close every editor panel (with proper session flushing) — called before any
  // editor opens so exactly ONE panel is ever visible.
  function closeOtherEditors() {
    if (typeof editTableId !== 'undefined' && (editTableId || !$('#table-drawer').hidden)) closeTableEditor();
    if (textBlock || !$('#text-drawer').hidden) closeTextEditor();
    if (shapeBlock || !$('#shape-drawer').hidden) closeShapeEditor();
    if (imageBlock || !$('#image-drawer').hidden) closeImageEditor();
    if (checkBlock || !$('#check-drawer').hidden) closeCheckEditor();
    if (inkBlock || !$('#ink-drawer').hidden) closeInkEditor();
    if (drawerBlock || !$('#drawer').hidden) closeDrawer();
  }

  // Commit a single undo entry for an editing session (if anything changed).
  function flushEdit() {
    if (!editBaseline) return;
    const base = editBaseline; editBaseline = null;
    const cur = state.byId.get(base.id) ||
      (drawerBlock && drawerBlock.id === base.id ? drawerBlock : null) ||
      (textBlock && textBlock.id === base.id ? textBlock : null) ||
      (shapeBlock && shapeBlock.id === base.id ? shapeBlock : null) ||
      (imageBlock && imageBlock.id === base.id ? imageBlock : null) ||
      (inkBlock && inkBlock.id === base.id ? inkBlock : null);
    if (!cur) return;
    if (!EDIT_FIELDS.some(f => (cur[f] ?? '') !== (base[f] ?? ''))) return;
    const before = { ...cur };
    EDIT_FIELDS.forEach(f => { before[f] = base[f]; });
    recordChange({ blocks: [before], edges: [], files: [] }, { blocks: [{ ...cur }], edges: [], files: [] });
  }

  async function openDrawer(id, focusTitle) {
    flushEdit();
    closeOtherEditors();
    const b = state.byId.get(id);
    if (!b) return;
    drawerBlock = b;
    editBaseline = snapshotFields(b);
    $('#f-title').value = b.title || '';
    $('#f-desc').value  = b.description || '';
    $('#f-notes').value = b.notes || '';
    $('#f-tags').value  = b.tags || '';
    renderSwatches(b.color);
    renderLayoutSeg(b.layout === 'list' ? 'list' : 'canvas');
    await renderFiles(b.id);
    const d = $('#drawer'); d.hidden = false;
    saveState.textContent = '';
    if (focusTitle) setTimeout(() => { $('#f-title').select(); $('#f-title').focus(); }, 60);
  }
  function closeDrawer() {
    blurPanelField();
    flushEdit();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; if (drawerBlock) persistBlock(drawerBlock); }
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
      saveTimer = null;
      const b = drawerBlock; if (!b) return;
      await persistBlock(b);
      refreshItem(b.id);
      if (state.levelLayout === 'canvas') drawEdges();
      saveState.textContent = 'Saved';
      setTimeout(() => { if (saveState.textContent === 'Saved') saveState.textContent = ''; }, 1500);
      markChanged();
    }, 350);
  }

  function bindDrawerFields() {
    const map = { '#f-title': 'title', '#f-desc': 'description', '#f-notes': 'notes', '#f-tags': 'tags' };
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
    $('#f-done').addEventListener('click', closeDrawer);
    $('#f-reset').addEventListener('click', resetActiveEditor);
    $('#f-delete').addEventListener('click', () => drawerBlock && deleteBlock(drawerBlock.id));
    $('#f-open').addEventListener('click', () => drawerBlock && navigateTo(drawerBlock.id));
    $('#f-upload').addEventListener('click', () => $('#file-input').click());
    $('#f-desc-import').addEventListener('click', importDescriptionAsText);
    $('#f-notes-import').addEventListener('click', importNotesAsText);
  }

  // Create a text node INSIDE the current block containing its description.
  // Create a text node INSIDE the current block from one of its fields.
  async function importFieldAsText(field) {
    if (!drawerBlock) return;
    const content = (drawerBlock[field] || '').trim();
    if (!content) { toast(`This block has no ${field} yet.`); return; }
    const parent = drawerBlock;
    if (parent.layout === 'list') { parent.layout = 'canvas'; await persistBlock(parent); renderLayoutSeg('canvas'); refreshItem(parent.id); }
    const now = Date.now();
    const t = {
      id: uid(), ws: state.ws, parentId: parent.id, kind: 'text',
      text: content, font: 'sans', size: field === 'notes' ? 16 : 22,
      bold: false, italic: false, align: 'left', nowrap: true,
      orient: 'h', rot: 0, glow: false, glowColor: '', color: '',
      title: '', description: '', notes: '', tags: '', layout: 'canvas', icon: '',
      x: 60, y: 60, z: 0, createdAt: now, updatedAt: now,
    };
    await DB.saveBlock(t);
    await recount(parent.id);
    recordChange(emptySet(), { blocks: [t], edges: [], files: [] });
    toast(`${field[0].toUpperCase() + field.slice(1)} added as text inside — open the block to see it`);
  }
  const importDescriptionAsText = () => importFieldAsText('description');
  const importNotesAsText = () => importFieldAsText('notes');

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
      textSaveTimer = null;
      const b = textBlock; if (!b) return;
      await persistBlock(b);
      refreshItem(b.id);
      $('#text-save').textContent = 'Saved';
      setTimeout(() => { if ($('#text-save').textContent === 'Saved') $('#text-save').textContent = ''; }, 1500);
      markChanged();
    }, 300);
  }
  function openTextEditor(id) {
    flushEdit();
    closeOtherEditors();
    const b = state.byId.get(id);
    if (!b) return;
    selectBlock(id);
    textBlock = b;
    editBaseline = snapshotFields(b);
    $('#t-content').value = b.text || '';
    renderTFont(b.font || 'sans');
    $('#t-size').value = b.size || 22; $('#t-size-val').value = (b.size || 22);
    $('#t-bold').classList.toggle('on', !!b.bold);
    $('#t-italic').classList.toggle('on', !!b.italic);
    renderTAlign(b.align || 'left');
    renderTSwatches(b.color || '');
    renderTOrient(b.orient || 'h');
    $('#t-rot').value = b.rot || 0; $('#t-rot-val').value = (b.rot || 0);
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
    if (textSaveTimer) { clearTimeout(textSaveTimer); textSaveTimer = null; if (textBlock) persistBlock(textBlock); }
    $('#text-drawer').hidden = true;
    textBlock = null;
  }
  function bindTextEditor() {
    $('#t-content').addEventListener('input', (e) => { if (!textBlock) return; textBlock.text = e.target.value; refreshItem(textBlock.id); queueTextSave(); });
    $$('#t-font button').forEach(btn => btn.addEventListener('click', () => { if (!textBlock) return; textBlock.font = btn.dataset.font; renderTFont(btn.dataset.font); refreshItem(textBlock.id); queueTextSave(); }));
    wireParam('t-size-val', 't-size', (v) => { if (!textBlock) return; textBlock.size = Math.max(1, Math.round(v)); refreshItem(textBlock.id); queueTextSave(); });
    $('#t-bold').addEventListener('click', () => { if (!textBlock) return; textBlock.bold = !textBlock.bold; $('#t-bold').classList.toggle('on', textBlock.bold); refreshItem(textBlock.id); queueTextSave(); });
    $('#t-italic').addEventListener('click', () => { if (!textBlock) return; textBlock.italic = !textBlock.italic; $('#t-italic').classList.toggle('on', textBlock.italic); refreshItem(textBlock.id); queueTextSave(); });
    $$('#text-drawer .talign').forEach(btn => btn.addEventListener('click', () => { if (!textBlock) return; textBlock.align = btn.dataset.align; renderTAlign(btn.dataset.align); refreshItem(textBlock.id); queueTextSave(); }));
    $$('#t-orient button').forEach(btn => btn.addEventListener('click', () => { if (!textBlock) return; textBlock.orient = btn.dataset.orient; renderTOrient(btn.dataset.orient); refreshItem(textBlock.id); queueTextSave(); }));
    wireParam('t-rot-val', 't-rot', (v) => { if (!textBlock) return; textBlock.rot = Math.round(v); refreshItem(textBlock.id); queueTextSave(); });
    $('#t-glow').addEventListener('change', (e) => { if (!textBlock) return; textBlock.glow = e.target.checked; $('#t-glow-wrap').hidden = !e.target.checked; refreshItem(textBlock.id); queueTextSave(); });
    $('#text-close').addEventListener('click', closeTextEditor);
    $('#t-done').addEventListener('click', closeTextEditor);
    $('#t-reset').addEventListener('click', resetActiveEditor);
    $('#t-delete').addEventListener('click', () => { if (textBlock) deleteBlock(textBlock.id); });
  }

  /* ---------------------------- shape editor --------------------------- */
  let shapeBlock = null;
  let shapeSaveTimer = null;
  function renderSType(active, block) {
    const poly = block && block.points ? polyNameOf(block.points) : null;
    $$('#s-type button').forEach(b => {
      const on = b.dataset.shape === active && (active !== 'polygon' || !poly || b.dataset.poly === poly);
      b.classList.toggle('active', on);
    });
    const dashRow = $('#s-dash-row');
    if (dashRow) {
      dashRow.hidden = active !== 'line';
      const cb = $('#s-dash'); if (cb && block) cb.checked = !!block.dash;
    }
  }
  // Which named polygon do these points match?
  function polyNameOf(points) {
    if (!Array.isArray(points)) return null;
    return Object.keys(POLY_SHAPES).find(k =>
      POLY_SHAPES[k].length === points.length &&
      POLY_SHAPES[k].every((p, i) => Math.abs(p[0] - points[i][0]) < 0.02 && Math.abs(p[1] - points[i][1]) < 0.02)) || null;
  }
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
      shapeSaveTimer = null;
      const b = shapeBlock; if (!b) return;
      await persistBlock(b);
      refreshItem(b.id);
      $('#shape-save').textContent = 'Saved';
      setTimeout(() => { if ($('#shape-save').textContent === 'Saved') $('#shape-save').textContent = ''; }, 1500);
      markChanged();
    }, 300);
  }
  function openShapeEditor(id) {
    flushEdit();
    closeOtherEditors();
    const b = state.byId.get(id);
    if (!b) return;
    selectBlock(id);
    shapeBlock = b;
    editBaseline = snapshotFields(b);
    renderSType(b.shape || 'rectangle', b);
    $('#s-w').value = b.w || 150; $('#s-w-val').value = (b.w || 150);
    $('#s-h').value = b.h || 100; $('#s-h-val').value = (b.h || 100);
    $('#s-rot').value = b.rot || 0; $('#s-rot-val').value = (b.rot || 0);
    $('#s-fill').checked = b.fill !== false;
    $('#s-fill-wrap').hidden = b.fill === false;
    renderSFill(b.color);
    $('#s-outline').checked = !!b.outline;
    $('#s-outline-wrap').hidden = !b.outline;
    $('#s-ow').value = b.outlineW || 3; $('#s-ow-val').value = (b.outlineW || 3);
    renderSOutline(b.outlineColor);
    $('#shape-drawer').hidden = false;
    $('#shape-save').textContent = '';
  }
  function closeShapeEditor() {
    if ($('#shape-drawer').hidden && !shapeBlock) return;
    flushEdit();
    if (shapeSaveTimer) { clearTimeout(shapeSaveTimer); shapeSaveTimer = null; if (shapeBlock) persistBlock(shapeBlock); }
    $('#shape-drawer').hidden = true;
    shapeBlock = null;
  }
  function bindShapeEditor() {
    $('#s-dash').addEventListener('change', (e) => {
      if (!shapeBlock) return;
      shapeBlock.dash = e.target.checked;
      refreshItem(shapeBlock.id); queueShapeSave();
    });
    $$('#s-type button').forEach(btn => btn.addEventListener('click', () => {
      if (!shapeBlock) return;
      const shape = btn.dataset.shape;
      shapeBlock.shape = shape;
      if (shape !== 'polygon') shapeBlock.points = null;
      else shapeBlock.points = POLY_SHAPES[btn.dataset.poly] || null;
      if (shape === 'line') {                       // a line is stroke-only: no fill, drive it via the outline controls
        shapeBlock.fill = false;
        shapeBlock.outline = true;
        if (!shapeBlock.outlineW) shapeBlock.outlineW = 4;
        if (!shapeBlock.outlineColor) shapeBlock.outlineColor = shapeBlock.color || PALETTE[0];
        $('#s-fill').checked = false; $('#s-fill-wrap').hidden = true;
        $('#s-outline').checked = true; $('#s-outline-wrap').hidden = false;
        $('#s-ow').value = shapeBlock.outlineW; $('#s-ow-val').value = shapeBlock.outlineW;
        renderSOutline(shapeBlock.outlineColor);
      }
      renderSType(shape, shapeBlock);
      refreshItem(shapeBlock.id); queueShapeSave();
    }));
    wireParam('s-w-val', 's-w', (v) => { if (!shapeBlock) return; shapeBlock.w = Math.max(1, Math.round(v)); refreshItem(shapeBlock.id); queueShapeSave(); });
    wireParam('s-h-val', 's-h', (v) => { if (!shapeBlock) return; shapeBlock.h = Math.max(1, Math.round(v)); refreshItem(shapeBlock.id); queueShapeSave(); });
    wireParam('s-rot-val', 's-rot', (v) => { if (!shapeBlock) return; shapeBlock.rot = Math.round(v); refreshItem(shapeBlock.id); queueShapeSave(); });
    $('#s-fill').addEventListener('change', (e) => { if (!shapeBlock) return; shapeBlock.fill = e.target.checked; $('#s-fill-wrap').hidden = !e.target.checked; refreshItem(shapeBlock.id); queueShapeSave(); });
    $('#s-outline').addEventListener('change', (e) => { if (!shapeBlock) return; shapeBlock.outline = e.target.checked; $('#s-outline-wrap').hidden = !e.target.checked; refreshItem(shapeBlock.id); queueShapeSave(); });
    wireParam('s-ow-val', 's-ow', (v) => { if (!shapeBlock) return; shapeBlock.outlineW = Math.max(0, Math.round(v)); refreshItem(shapeBlock.id); queueShapeSave(); });
    $('#shape-close').addEventListener('click', closeShapeEditor);
    $('#s-done').addEventListener('click', closeShapeEditor);
    $('#s-reset').addEventListener('click', resetActiveEditor);
    $('#s-delete').addEventListener('click', () => { if (shapeBlock) deleteBlock(shapeBlock.id); });
  }

  /* ---------------------------- image editor --------------------------- */
  let imageBlock = null;
  let imageSaveTimer = null;
  function renderIOutline(active) {
    const wrap = $('#i-outline-swatches'); if (!wrap) return; wrap.innerHTML = '';
    PALETTE.concat(['#ffffff', '#0a0b0d']).forEach(col => {
      const s = document.createElement('div');
      s.className = 'swatch' + ((active || PALETTE[0]) === col ? ' active' : '');
      s.style.background = col;
      s.addEventListener('click', () => { if (!imageBlock) return; imageBlock.outlineColor = col; renderIOutline(col); refreshItem(imageBlock.id); queueImageSave(); });
      wrap.appendChild(s);
    });
  }
  function queueImageSave() {
    if (!imageBlock) return;
    $('#image-save').textContent = 'Saving…';
    clearTimeout(imageSaveTimer);
    imageSaveTimer = setTimeout(async () => {
      imageSaveTimer = null;
      const b = imageBlock; if (!b) return;
      await persistBlock(b);
      refreshItem(b.id);
      $('#image-save').textContent = 'Saved';
      setTimeout(() => { if ($('#image-save').textContent === 'Saved') $('#image-save').textContent = ''; }, 1500);
      markChanged();
    }, 300);
  }
  function openImageEditor(id) {
    flushEdit();
    closeOtherEditors();
    const b = state.byId.get(id);
    if (!b) return;
    selectBlock(id);
    imageBlock = b;
    editBaseline = snapshotFields(b);
    const pv = $('#i-preview'); pv.innerHTML = ''; const im = document.createElement('img'); im.src = b.src || ''; pv.appendChild(im);
    $('#i-w').value = b.w || 200; $('#i-w-val').value = (b.w || 200);
    $('#i-rot').value = b.rot || 0; $('#i-rot-val').value = (b.rot || 0);
    $('#i-round').checked = !!b.round;
    $('#i-outline').checked = !!b.outline;
    $('#i-outline-wrap').hidden = !b.outline;
    $('#i-ow').value = b.outlineW || 3; $('#i-ow-val').value = (b.outlineW || 3);
    renderIOutline(b.outlineColor);
    $('#image-drawer').hidden = false;
    $('#image-save').textContent = '';
  }
  function closeImageEditor() {
    if ($('#image-drawer').hidden && !imageBlock) return;
    flushEdit();
    if (imageSaveTimer) { clearTimeout(imageSaveTimer); imageSaveTimer = null; if (imageBlock) persistBlock(imageBlock); }
    $('#image-drawer').hidden = true;
    imageBlock = null;
  }
  function bindImageEditor() {
    wireParam('i-w-val', 'i-w', (v) => {
      if (!imageBlock) return;
      const newW = Math.max(1, Math.round(v));
      const ratio = (imageBlock.h && imageBlock.w) ? imageBlock.h / imageBlock.w : 0.75;
      imageBlock.w = newW; imageBlock.h = Math.round(newW * ratio);
      refreshItem(imageBlock.id); queueImageSave();
    });
    wireParam('i-rot-val', 'i-rot', (v) => { if (!imageBlock) return; imageBlock.rot = Math.round(v); refreshItem(imageBlock.id); queueImageSave(); });
    $('#i-round').addEventListener('change', (e) => { if (!imageBlock) return; imageBlock.round = e.target.checked; refreshItem(imageBlock.id); queueImageSave(); });
    $('#i-outline').addEventListener('change', (e) => { if (!imageBlock) return; imageBlock.outline = e.target.checked; $('#i-outline-wrap').hidden = !e.target.checked; refreshItem(imageBlock.id); queueImageSave(); });
    wireParam('i-ow-val', 'i-ow', (v) => { if (!imageBlock) return; imageBlock.outlineW = Math.max(1, Math.round(v)); refreshItem(imageBlock.id); queueImageSave(); });
    $('#i-replace').addEventListener('click', () => { if (!imageBlock) return; replaceImageId = imageBlock.id; pendingImageAt = null; $('#image-input').click(); });
    $('#image-close').addEventListener('click', closeImageEditor);
    $('#i-done').addEventListener('click', closeImageEditor);
    $('#i-reset').addEventListener('click', resetActiveEditor);
    $('#i-delete').addEventListener('click', () => { if (imageBlock) deleteBlock(imageBlock.id); });
    // shared file input for both new images and replacements
    $('#image-input').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) { replaceImageId = null; return; }
      if (replaceImageId) {
        const b = state.byId.get(replaceImageId); replaceImageId = null;
        if (!b) return;
        const before = { ...b };
        b.src = await fileToStoredSrc(file);
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

  /* ================================ crop ================================ *
   * Crop for image blocks: a rectangle (8 handles, movable box, free aspect)
   * or a freehand selection (draw a loop; the picture is clipped to it,
   * transparent outside, trimmed to the loop's box). Lives entirely in
   * #crop-modal, opened from the image editor's "Crop" / "Crop by selection"
   * buttons; nothing here is reached from the stage pointer handlers, the
   * live ink path, drawEdges or the mini-map. Apply renders the crop at the
   * picture's own resolution and writes it as a new data URL on the block
   * (image blocks keep their picture in `src`, see paintImageNode), keeps the
   * block's width, re-derives its height, and records ONE undo entry.
   * Self-contained: adds its own icon and registers its own binder.         */
  ICON.crop = '<path d="M7 3.5v11.5a2 2 0 0 0 2 2h11.5"/><path d="M17 20.5V9a2 2 0 0 0-2-2H3.5"/>';
  const CROP_MIN = 8;                 // smallest crop side, in source pixels
  const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const CROP_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', new: 'crosshair' };
  let crop = null;                    // the open session (see openCrop); null while the dialog is closed

  const cropModal = () => $('#crop-modal');
  const cropCanvas = () => $('#crop-canvas');
  const cropLoadImage = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = src; });

  async function openCrop(mode) {
    if (state.readOnly) { toast('Read mode is on.'); return; }
    const b = imageBlock;
    if (!b || !b.src) return;
    let img;
    try { img = await cropLoadImage(b.src); } catch (_) { toast('This image could not be read.'); return; }
    if (imageBlock !== b) return;                       // the panel moved on while decoding
    const natW = img.naturalWidth || 0, natH = img.naturalHeight || 0;
    if (natW < CROP_MIN || natH < CROP_MIN) { toast('This image is too small to crop.'); return; }
    const m = /^data:(image\/[\w.+-]+)/i.exec(b.src);
    crop = {
      id: b.id, img, natW, natH, type: m ? m[1].toLowerCase() : '',
      mode: 'rect', rect: { x: 0, y: 0, w: natW, h: natH }, poly: [], drawing: false,
      view: { w: natW, h: natH, dpr: 1 }, drag: null, busy: false,
    };
    cropModal().hidden = false;
    setCropMode(mode === 'free' ? 'free' : 'rect');
    window.addEventListener('resize', cropFit);
    setTimeout(() => { const a = $('#crop-apply'); if (a && crop) a.focus(); }, 30);
  }
  function closeCrop() {
    crop = null;
    cropModal().hidden = true;
    window.removeEventListener('resize', cropFit);
  }
  function setCropMode(mode) {
    if (!crop) return;
    crop.mode = mode; crop.drag = null; crop.drawing = false;
    $$('#crop-modes button').forEach(x => x.classList.toggle('active', x.dataset.cmode === mode));
    $('#crop-hint').textContent = mode === 'free'
      ? 'Draw a loop around the part to keep; lifting closes it. Everything outside becomes transparent.'
      : 'Drag the handles or move the box. Drag outside the box to start a new one.';
    cropFit();
  }
  // Fit the picture into the preview box; the canvas is exactly the fitted picture.
  function cropFit() {
    if (!crop) return;
    const cv = cropCanvas(), box = cv.parentElement;
    const bw = Math.max(40, box.clientWidth - 2), bh = Math.max(40, box.clientHeight - 2);
    const k = Math.min(bw / crop.natW, bh / crop.natH);
    const w = Math.max(1, Math.floor(crop.natW * k)), h = Math.max(1, Math.floor(crop.natH * k));
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    crop.view = { w, h, dpr };
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cropDraw();
  }
  // client point -> source pixels, clamped to the picture
  function cropPoint(e) {
    const r = cropCanvas().getBoundingClientRect();
    const x = (e.clientX - r.left) * crop.natW / (r.width || 1), y = (e.clientY - r.top) * crop.natH / (r.height || 1);
    return { x: clamp(x, 0, crop.natW), y: clamp(y, 0, crop.natH) };
  }
  function cropHandlePos(k, x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2, R = x + w, B = y + h;
    return { nw: [x, y], n: [cx, y], ne: [R, y], e: [R, cy], se: [R, B], s: [cx, B], sw: [x, B], w: [x, cy] }[k];
  }
  // Which handle, the box itself, or the space outside it sits under a client point (rect mode).
  function cropHit(e) {
    const r = cropCanvas().getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const sx = r.width / crop.natW, sy = r.height / crop.natH;
    const rc = crop.rect, x = rc.x * sx, y = rc.y * sy, w = rc.w * sx, h = rc.h * sy;
    const tol = e.pointerType === 'touch' ? 22 : 12;       // a finger gets a bigger grab
    let best = null, bd = Infinity;
    for (const k of CROP_HANDLES) {
      const [hx, hy] = cropHandlePos(k, x, y, w, h);
      const d = Math.hypot(px - hx, py - hy);
      if (d <= tol && d < bd) { best = k; bd = d; }
    }
    if (best) return best;
    return (px >= x && px <= x + w && py >= y && py <= y + h) ? 'move' : 'new';
  }
  function cropPolyBox(pts) {
    if (!pts || !pts.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of pts) { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; }
    x1 = Math.floor(x1); y1 = Math.floor(y1); x2 = Math.ceil(x2); y2 = Math.ceil(y2);
    return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
  }
  function cropDraw() {
    if (!crop) return;
    const cv = cropCanvas(), ctx = cv.getContext('2d');
    const { w, h, dpr } = crop.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(crop.img, 0, 0, w, h);
    const sx = w / crop.natW, sy = h / crop.natH;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const tracePoly = (pts) => { pts.forEach((p, i) => { if (i) ctx.lineTo(p[0] * sx, p[1] * sy); else ctx.moveTo(p[0] * sx, p[1] * sy); }); };
    if (crop.mode === 'rect') {
      const r = crop.rect, x = r.x * sx, y = r.y * sy, rw = r.w * sx, rh = r.h * sy;
      ctx.fillStyle = 'rgba(0,0,0,.52)';                    // dim what goes
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(x, y, rw, rh); ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1;   // thirds
      ctx.beginPath();
      for (let i = 1; i < 3; i++) { ctx.moveTo(x + rw * i / 3, y); ctx.lineTo(x + rw * i / 3, y + rh); ctx.moveTo(x, y + rh * i / 3); ctx.lineTo(x + rw, y + rh * i / 3); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 3; ctx.strokeRect(x, y, rw, rh);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, rw, rh);
      const hs = 5.5;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.5;
      for (const k of CROP_HANDLES) {
        const [hx, hy] = cropHandlePos(k, x, y, rw, rh);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(hx - hs, hy - hs, hs * 2, hs * 2, 2.5); else ctx.rect(hx - hs, hy - hs, hs * 2, hs * 2);
        ctx.fill(); ctx.stroke();
      }
    } else {
      const pts = crop.poly;
      if (pts.length >= 3) {
        ctx.fillStyle = 'rgba(0,0,0,.52)';
        ctx.beginPath(); ctx.rect(0, 0, w, h); tracePoly(pts); ctx.closePath(); ctx.fill('evenodd');
      }
      if (pts.length >= 2) {
        ctx.beginPath(); tracePoly(pts); if (!crop.drawing) ctx.closePath();
        ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.75; ctx.stroke();
        if (crop.drawing) {                                 // the closing edge, as lifting will draw it
          const a = pts[pts.length - 1], z = pts[0];
          ctx.beginPath(); ctx.moveTo(a[0] * sx, a[1] * sy); ctx.lineTo(z[0] * sx, z[1] * sy);
          ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.25; ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    const apply = $('#crop-apply');
    if (apply) apply.disabled = crop.busy || (crop.mode === 'free' && crop.poly.length < 3);
  }
  // The box after a drag: a handle moves its edge(s), the box moves whole, or a new box is pulled out.
  function cropDragRect(d, p) {
    const { natW, natH } = crop, r0 = d.rect0, k = d.kind, R_ = Math.round;
    if (k === 'move') {
      return { x: clamp(R_(r0.x + p.x - d.start.x), 0, natW - r0.w), y: clamp(R_(r0.y + p.y - d.start.y), 0, natH - r0.h), w: r0.w, h: r0.h };
    }
    if (k === 'new') {
      const x1 = R_(Math.min(d.start.x, p.x)), x2 = R_(Math.max(d.start.x, p.x));
      const y1 = R_(Math.min(d.start.y, p.y)), y2 = R_(Math.max(d.start.y, p.y));
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    let L = r0.x, T = r0.y, R = r0.x + r0.w, B = r0.y + r0.h;
    if (k.includes('w')) L = clamp(R_(p.x), 0, R - CROP_MIN);
    if (k.includes('e')) R = clamp(R_(p.x), L + CROP_MIN, natW);
    if (k.includes('n')) T = clamp(R_(p.y), 0, B - CROP_MIN);
    if (k.includes('s')) B = clamp(R_(p.y), T + CROP_MIN, natH);
    return { x: L, y: T, w: R - L, h: B - T };
  }
  function onCropDown(e) {
    if (!crop || crop.busy || crop.drag) return;            // one pointer at a time
    if (e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    try { cropCanvas().setPointerCapture(e.pointerId); } catch (_) {}
    const p = cropPoint(e);
    if (crop.mode === 'free') { crop.poly = [[p.x, p.y]]; crop.drawing = true; crop.drag = { pid: e.pointerId, kind: 'draw' }; }
    else crop.drag = { pid: e.pointerId, kind: cropHit(e), start: p, rect0: { ...crop.rect } };
    cropDraw();
  }
  function onCropMove(e) {
    if (!crop) return;
    const d = crop.drag;
    if (!d) { cropCanvas().style.cursor = crop.mode === 'rect' ? (CROP_CURSOR[cropHit(e)] || 'crosshair') : 'crosshair'; return; }
    if (d.pid !== e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    const p = cropPoint(e);
    if (d.kind === 'draw') {
      const last = crop.poly[crop.poly.length - 1];
      const step = 1.5 * crop.natW / (crop.view.w || 1);   // about 1.5 css px apart
      if (Math.hypot(p.x - last[0], p.y - last[1]) >= step) crop.poly.push([p.x, p.y]);
    } else {
      crop.rect = cropDragRect(d, p);
    }
    cropDraw();
  }
  function onCropUp(e) {
    if (!crop || !crop.drag || crop.drag.pid !== e.pointerId) return;
    e.stopPropagation();
    const d = crop.drag; crop.drag = null;
    try { cropCanvas().releasePointerCapture(e.pointerId); } catch (_) {}
    if (d.kind === 'draw') {
      crop.drawing = false;                                 // the loop closes back to its first point
      const bb = cropPolyBox(crop.poly);
      if (crop.poly.length < 3 || bb.w < CROP_MIN || bb.h < CROP_MIN) {
        if (crop.poly.length > 5 && e.type !== 'pointercancel') toast('Draw a larger loop.');
        crop.poly = [];
      }
    } else if (d.kind === 'new' && (crop.rect.w < CROP_MIN || crop.rect.h < CROP_MIN)) {
      crop.rect = d.rect0;                                  // a tap outside the box changes nothing
    }
    cropDraw();
  }
  function cropReset() {
    if (!crop) return;
    if (crop.mode === 'free') crop.poly = []; else crop.rect = { x: 0, y: 0, w: crop.natW, h: crop.natH };
    crop.drag = null; crop.drawing = false;
    cropDraw();
  }
  // Render the crop at the picture's own resolution. A rectangle keeps the
  // source's type when it is jpeg/webp/png (anything else becomes png); a
  // selection is always png, for the transparency.
  function cropRender() {
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    let type = 'image/png';
    if (crop.mode === 'rect') {
      const r = crop.rect;
      cv.width = r.w; cv.height = r.h;
      ctx.drawImage(crop.img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      if (/^image\/(jpeg|webp|png)$/.test(crop.type)) type = crop.type;
    } else {
      const pts = crop.poly, bb = cropPolyBox(pts);
      cv.width = bb.w; cv.height = bb.h;
      ctx.beginPath();
      pts.forEach((p, i) => { if (i) ctx.lineTo(p[0] - bb.x, p[1] - bb.y); else ctx.moveTo(p[0] - bb.x, p[1] - bb.y); });
      ctx.closePath(); ctx.clip();
      ctx.drawImage(crop.img, -bb.x, -bb.y);
    }
    return new Promise((res, rej) => cv.toBlob(bl => bl ? res({ blob: bl, w: cv.width, h: cv.height }) : rej(new Error('encode')), type, 0.92));
  }
  async function cropApply() {
    if (!crop || crop.busy) return;
    if (state.readOnly) { toast('Read mode is on.'); return; }
    const b = state.byId.get(crop.id);
    if (!b) { closeCrop(); return; }
    if (crop.mode === 'free' && crop.poly.length < 3) { toast('Draw a loop around the part to keep.'); return; }
    const r = crop.rect;
    if (crop.mode === 'rect' && r.x === 0 && r.y === 0 && r.w === crop.natW && r.h === crop.natH) { toast('The whole picture is selected.'); return; }
    crop.busy = true; cropDraw();
    try {
      const out = await cropRender();
      const src = await readAsDataUrl(out.blob);
      if (!crop || !state.blocks.includes(b)) return;      // closed, or the block went, while encoding
      if (imageSaveTimer) { clearTimeout(imageSaveTimer); imageSaveTimer = null; }
      flushEdit();                                          // a pending panel edit is its own undo step
      const before = { ...b };
      b.src = src;
      b.h = Math.max(1, Math.round((b.w || 200) * out.h / out.w));   // same width, new aspect
      await persistBlock(b);
      refreshItem(b.id);
      if (imageBlock && imageBlock.id === b.id) {
        const pv = $('#i-preview img'); if (pv) pv.src = src;
        editBaseline = snapshotFields(b);                   // the crop is not part of the panel's edit session
      }
      recordChange({ blocks: [before], edges: [], files: [] }, { blocks: [{ ...b }], edges: [], files: [] });
      drawEdges();                                          // connectors follow the new height
      closeCrop();
      toast('Image cropped');
    } catch (err) {
      console.error(err);
      toast('Could not crop this image.');
    } finally {
      if (crop) { crop.busy = false; cropDraw(); }
    }
  }
  // Escape cancels; Enter (off a button) applies; the canvas shortcuts stay
  // out while the dialog is up. Capture phase, so the stage never sees them.
  function onCropKey(e) {
    if (!crop || cropModal().hidden) return;
    if (e.key === 'Tab') return;
    if (e.key === 'Escape') { e.preventDefault(); closeCrop(); }
    else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); cropApply(); }
    e.stopImmediatePropagation();
  }
  function bindCrop() {
    const modal = cropModal(); if (!modal) return;
    $('#i-crop')?.addEventListener('click', () => openCrop('rect'));
    $('#i-crop-free')?.addEventListener('click', () => openCrop('free'));
    $('#crop-modes').addEventListener('click', (e) => { const b = e.target.closest('button[data-cmode]'); if (b && crop) setCropMode(b.dataset.cmode); });
    $('#crop-reset').addEventListener('click', cropReset);
    $('#crop-cancel').addEventListener('click', closeCrop);
    $('#crop-apply').addEventListener('click', cropApply);
    const cv = cropCanvas();
    cv.addEventListener('pointerdown', onCropDown);
    cv.addEventListener('pointermove', onCropMove);
    cv.addEventListener('pointerup', onCropUp);
    cv.addEventListener('pointercancel', onCropUp);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', onCropKey, true);
  }
  document.addEventListener('DOMContentLoaded', bindCrop);
  /* ============================== end crop ============================== */

  /* ------------------------- checkbox editor ---------------------------- */
  let checkBlock = null, checkSaveTimer = null;
  function renderCkSwatches(active) {
    const wrap = $('#ck-swatches'); if (!wrap) return; wrap.innerHTML = '';
    PALETTE.concat(['#22c38f', '#8a94a6']).forEach(col => {
      const sw = document.createElement('div');
      sw.className = 'swatch' + ((active || PALETTE[0]) === col ? ' active' : '');
      sw.style.background = col;
      sw.addEventListener('click', () => { if (!checkBlock) return; checkBlock.color = col; renderCkSwatches(col); refreshItem(checkBlock.id); queueCheckSave(); });
      wrap.appendChild(sw);
    });
  }
  function queueCheckSave() {
    if (!checkBlock) return;
    $('#check-save').textContent = 'Saving\u2026';
    clearTimeout(checkSaveTimer);
    checkSaveTimer = setTimeout(async () => {
      checkSaveTimer = null;
      const b = checkBlock; if (!b) return;
      await persistBlock(b); refreshItem(b.id);
      $('#check-save').textContent = 'Saved';
      setTimeout(() => { if ($('#check-save').textContent === 'Saved') $('#check-save').textContent = ''; }, 1500);
      markChanged();
    }, 300);
  }
  function openCheckEditor(id) {
    flushEdit(); closeOtherEditors();
    const b = state.byId.get(id); if (!b) return;
    selectBlock(id);
    checkBlock = b; editBaseline = snapshotFields(b);
    $('#ck-checked').checked = !!b.checked;
    renderCkSwatches(b.color);
    $('#ck-size').value = b.size || 32; $('#ck-size-val').value = b.size || 32;
    $('#check-drawer').hidden = false; $('#check-save').textContent = '';
  }
  function closeCheckEditor() {
    if ($('#check-drawer').hidden && !checkBlock) return;
    flushEdit();
    if (checkSaveTimer) { clearTimeout(checkSaveTimer); checkSaveTimer = null; if (checkBlock) persistBlock(checkBlock); }
    $('#check-drawer').hidden = true; checkBlock = null;
  }
  function bindCheckEditor() {
    wireParam('ck-size-val', 'ck-size', (v) => { if (!checkBlock) return; checkBlock.size = clamp(Math.round(v), 12, 600); refreshItem(checkBlock.id); queueCheckSave(); });
    $('#ck-checked').addEventListener('change', (e) => { if (!checkBlock) return; checkBlock.checked = e.target.checked; refreshItem(checkBlock.id); queueCheckSave(); });
    $('#check-close').addEventListener('click', closeCheckEditor);
    $('#ck-done').addEventListener('click', closeCheckEditor);
    $('#ck-reset').addEventListener('click', resetActiveEditor);
    $('#ck-delete').addEventListener('click', () => { if (checkBlock) deleteBlock(checkBlock.id); });
  }

  /* ---------------------------- ink editor ----------------------------- *
   * The panel edits every stroke it was opened for. Opened from a stroke's
   * own pencil that is one stroke; opened from the floating bar it is the
   * whole selection, so a word's worth of strokes restyle together.        */
  let inkBlock = null, inkSaveTimer = null;
  // Write every edit still sitting in an editor's 300 ms save timer, now.
  // Called before anything that deletes or rewinds records, so a late write
  // can never bring a deleted block back or overwrite an undo.
  function flushPendingSaves() {
    const w = [DB.flush()];
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; if (drawerBlock) w.push(persistBlock(drawerBlock)); }
    if (textSaveTimer) { clearTimeout(textSaveTimer); textSaveTimer = null; if (textBlock) w.push(persistBlock(textBlock)); }
    if (shapeSaveTimer) { clearTimeout(shapeSaveTimer); shapeSaveTimer = null; if (shapeBlock) w.push(persistBlock(shapeBlock)); }
    if (imageSaveTimer) { clearTimeout(imageSaveTimer); imageSaveTimer = null; if (imageBlock) w.push(persistBlock(imageBlock)); }
    if (checkSaveTimer) { clearTimeout(checkSaveTimer); checkSaveTimer = null; if (checkBlock) w.push(persistBlock(checkBlock)); }
    if (inkSaveTimer) { clearTimeout(inkSaveTimer); inkSaveTimer = null; inkSel.filter(b => state.blocks.some(x => x.id === b.id)).forEach(b => w.push(persistBlock(b))); }
    return Promise.all(w);
  }
  let inkSel = [];                  // the strokes the panel is acting on
  let inkBaselines = [];            // their state when it opened (reset + undo)

  // Apply an edit to every stroke the panel owns, then repaint and save. The
  // repaint is gathered into one animation frame: a slider fires many times
  // per frame and a word is dozens of strokes.
  let inkRepaintIds = new Set(), inkRepaintRAF = 0;
  function applyInk(fn) {
    if (!inkSel.length) return;
    inkSel.forEach(b => { fn(b); inkRepaintIds.add(b.id); });
    if (!inkRepaintRAF) inkRepaintRAF = requestAnimationFrame(() => {
      inkRepaintRAF = 0;
      const ids = inkRepaintIds; inkRepaintIds = new Set();
      ids.forEach(id => refreshItem(id));
    });
    queueInkSave();
  }
  // One undo entry for everything the panel changed while it was open.
  function flushInkEdits() {
    if (!inkBaselines.length) return;
    const bases = inkBaselines; inkBaselines = [];
    editBaseline = null;            // this panel records its own change
    const before = [], after = [];
    bases.forEach(base => {
      const cur = state.byId.get(base.id); if (!cur) return;
      if (!EDIT_FIELDS.some(f => (cur[f] ?? '') !== (base[f] ?? ''))) return;
      const b0 = { ...cur };
      EDIT_FIELDS.forEach(f => { b0[f] = base[f]; });
      before.push(b0); after.push({ ...cur });
    });
    if (before.length) recordChange({ blocks: before, edges: [], files: [] },
                                    { blocks: after, edges: [], files: [] });
  }
  function renderKSwatches(active) {
    const wrap = $('#k-swatches'); wrap.innerHTML = '';
    PALETTE.concat(['#ffffff', '#0a0b0d']).forEach(col => {
      const s = document.createElement('div');
      s.className = 'swatch' + ((active || PALETTE[0]) === col ? ' active' : '');
      s.style.background = col;
      s.addEventListener('click', () => { if (!inkSel.length) return; renderKSwatches(col); applyInk(b => { b.color = col; }); });
      wrap.appendChild(s);
    });
  }
  function queueInkSave() {
    if (!inkSel.length) return;
    $('#ink-save').textContent = 'Saving…';
    clearTimeout(inkSaveTimer);
    inkSaveTimer = setTimeout(async () => {
      inkSaveTimer = null;
      if (!inkSel.length) return;
      for (const b of inkSel.slice()) { await persistBlock(b); refreshItem(b.id); }
      $('#ink-save').textContent = 'Saved';
      setTimeout(() => { if ($('#ink-save').textContent === 'Saved') $('#ink-save').textContent = ''; }, 1500);
      markChanged();
    }, 300);
  }
  function openInkEditor(id) {
    flushEdit();
    closeOtherEditors();
    const b = state.byId.get(id);
    if (!b) return;
    selectBlock(id);
    showInkPanel([b]);
  }

  // The selection bar's Properties: handwriting opens the ink panel for every
  // stroke picked; anything else opens its own editor.
  function openSelProps() {
    const ids = [...state.selectedIds];
    if (!ids.length) { toast('Select something first.'); return; }
    const hasInk = ids.some(id => { const b = state.byId.get(id); return b && b.kind === 'ink'; });
    if (hasInk) { openInkProps(); return; }
    if (ids.length > 1) { toast('Properties open for one block at a time.'); }
    openAnyEditor(ids[0]);
  }
  // Every selected stroke at once - what the floating bar's properties
  // button opens, so a whole handwritten word can be recoloured in one go.
  function openInkProps() {
    const strokes = [...state.selectedIds]
      .map(id => state.byId.get(id))
      .filter(b => b && b.kind === 'ink' && !b.locked);
    if (!strokes.length) { toast('Select some handwriting first.'); return; }
    flushEdit();
    closeOtherEditors();
    showInkPanel(strokes);
  }

  function showInkPanel(strokes) {
    const b = strokes[0];
    inkBlock = b;
    inkSel = strokes;
    inkBaselines = strokes.map(snapshotFields);
    editBaseline = snapshotFields(b);   // lets the per-field reset button work
    const head = $('#ink-title');
    if (head) head.textContent = strokes.length > 1
      ? 'Handwriting \u2014 ' + strokes.length + ' strokes' : 'Ink drawing';
    renderKSwatches(b.color);
    renderInkStylePicker(b);
    const toText = $('#k-to-text');
    if (toText) toText.hidden = !inkRecognizerKind();     // hide where unsupported
    $('#k-width').value = b.width || 3; $('#k-width-val').value = (b.width || 3);
    $('#ink-drawer').hidden = false;
    $('#ink-save').textContent = '';
  }
  // restyle a stroke that's already on the page
  function renderInkStylePicker(b) {
    const wrap = $('#k-styles'); if (!wrap) return;
    wrap.innerHTML = '';
    const cur = PEN_STYLES[b.style] ? b.style : 'pen';
    Object.keys(PEN_STYLES).filter(k => !PEN_STYLES[k].hidden || k === cur).forEach(key => {
      const btn = document.createElement('button');
      btn.className = 'pen-tool' + (key === cur ? ' active' : '');
      btn.title = PEN_STYLES[key].label;
      btn.innerHTML = ic(PEN_STYLES[key].icon);
      btn.addEventListener('click', () => {
        if (!inkSel.length) return;
        applyInk(x => { x.style = key; });
        renderInkStylePicker(inkBlock);
      });
      wrap.appendChild(btn);
    });
  }
  function closeInkEditor() {
    if ($('#ink-drawer').hidden && !inkBlock) return;
    flushInkEdits();
    if (inkSaveTimer) { clearTimeout(inkSaveTimer); inkSaveTimer = null; inkSel.filter(b => state.blocks.some(x => x.id === b.id)).forEach(b => persistBlock(b)); }
    $('#ink-drawer').hidden = true;
    inkBlock = null; inkSel = [];
  }
  // Put every stroke back to how it was when the panel opened.
  function resetInkPanel() {
    if (!inkBaselines.length) { resetActiveEditor(); return; }
    inkBaselines.forEach(base => {
      const cur = state.byId.get(base.id); if (!cur) return;
      EDIT_FIELDS.forEach(f => { cur[f] = base[f]; });
      refreshItem(cur.id); persistBlock(cur);
    });
    markChanged();
    if (inkBlock) { renderKSwatches(inkBlock.color); renderInkStylePicker(inkBlock);
      $('#k-width').value = inkBlock.width || 3; $('#k-width-val').value = (inkBlock.width || 3); }
    toast('Reset');
  }
  function bindInkEditor() {
    wireParam('k-width-val', 'k-width', (v) => {
      const w = Math.max(1, Math.round(v));
      applyInk(b => { b.width = w; });
    });
    $('#k-to-text').addEventListener('click', () => { if (inkSel.length) convertInkToText(inkSel.map(b => b.id)); });
    $('#ink-close').addEventListener('click', closeInkEditor);
    $('#k-done').addEventListener('click', closeInkEditor);
    $('#k-reset').addEventListener('click', resetInkPanel);
    $('#k-delete').addEventListener('click', () => {
      if (inkSel.length > 1) { const ids = inkSel.map(b => b.id); closeInkEditor(); state.selectedIds = new Set(ids); deleteSelected(); }
      else if (inkBlock) deleteBlock(inkBlock.id);
    });
  }

  /* ---------------------------- table editor --------------------------- */
  let tableBlock = null;      // block bound to the table drawer
  let editTableId = null;     // id of the table currently in cell-edit mode
  let tsel = null;            // { id, r, c, editing, orig } — the active/anchor cell
  let tmulti = new Set();     // multi-selection of "r:c" keys (includes the anchor)
  let tmultiMode = false;     // touch: taps add/remove cells (no Shift key needed)
  let tfocus = 'cell';        // which target the format bar acts on: 'cell' | 'title'
  let titleEditing = false;   // inline title text edit in progress
  let tableOrig = null;       // deep snapshot when the editor opened (for undo + reset)
  const deepRows = (b) => (b.rows || []).map(r => r.slice());
  const tableSnap = (b) => ({ title: b.title, header: b.header, fontSize: b.fontSize, w: b.w, h: b.h, colW: (b.colW || []).slice(), rowH: (b.rowH || []).slice(), titleFmt: b.titleFmt ? { ...b.titleFmt } : null, cellFmt: b.cellFmt ? JSON.parse(JSON.stringify(b.cellFmt)) : null, rows: deepRows(b) });
  const colLetter = (n) => { let s = ''; n = n + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  function openTableEditor(id) {
    flushEdit();
    const keepCells = (editTableId === id);   // reopening the panel for the table already in cell mode
    if (!keepCells) closeOtherEditors();
    else { if (drawerBlock || !$('#drawer').hidden) closeDrawer();
           if (textBlock) closeTextEditor(); if (shapeBlock) closeShapeEditor();
           if (imageBlock) closeImageEditor(); if (inkBlock) closeInkEditor(); }
    const b = state.byId.get(id); if (!b) return;
    selectBlock(id);
    tableBlock = b; editTableId = id; tfocus = 'cell'; titleEditing = false; tmultiMode = false;
    tableOrig = tableSnap(b);
    editBaseline = snapshotFields(b);   // lets the per-field font-size reset work
    $('#tbl-header').checked = b.header !== false;
    const fs = b.fontSize || 13; $('#tbl-fs').value = fs; $('#tbl-fs-val').value = fs;
    $('#table-drawer').hidden = false;
    refreshBlockCard(id);                // repaint with editing class + focusable cells
    tsel = { id, r: 0, c: 0, editing: false };
    focusCell(id, 0, 0, false);
  }
  // Enter cell-interaction mode WITHOUT opening the drawer — a single click on a
  // cell just selects it; the edit panel only opens from the pencil button.
  function enterTableCells(id) {
    const b = state.byId.get(id); if (!b) return;
    closeDrawerIfOpen();   // close any other editor (incl. a table drawer / other cell-mode)
    selectBlock(id);
    editTableId = id; tfocus = 'cell'; titleEditing = false; tmultiMode = false;
    tsel = null; tmulti = new Set();
    refreshBlockCard(id);
  }
  function closeTableEditor() {
    if ($('#table-drawer').hidden && !tableBlock && !editTableId) return;
    commitCellEdit(); commitTitleEdit();
    const b = tableBlock;
    $('#table-drawer').hidden = true;
    const id = b ? b.id : editTableId;
    tableBlock = null; editTableId = null; tsel = null; tmulti = new Set(); tmultiMode = false; tfocus = 'cell'; titleEditing = false; editBaseline = null;
    if (b && tableOrig && state.blocks.some(x => x.id === b.id)) {
      const now = tableSnap(b);
      if (JSON.stringify(now) !== JSON.stringify(tableOrig)) {
        recordChange({ blocks: [{ ...b, ...tableOrig }], edges: [], files: [] },
                     { blocks: [{ ...b, rows: deepRows(b) }], edges: [], files: [] });
      }
    }
    tableOrig = null;
    if (id) refreshBlockCard(id);
  }
  // --- column-width / row-height dragging ---
  let colResize = null;   // { id, c, startX, startW, before }
  let rowResize = null;   // { id, r, startY, startH, before }
  function startColResize(e, id, c) {
    const b = state.byId.get(id); if (!b) return;
    const el = state.els[id]; const cell = el && el.querySelector(`[data-r="0"][data-c="${c}"]`);
    const s = state.view.scale || 1;
    const startW = cell ? Math.round(cell.getBoundingClientRect().width / s) : 80;
    colResize = { id, c, pointerId: e.pointerId, startX: e.clientX, startW, before: { ...b, colW: (b.colW || []).slice() } };
    selectBlock(id);
    e.preventDefault(); e.stopPropagation();
  }
  function startRowResize(e, id, r) {
    const b = state.byId.get(id); if (!b) return;
    const el = state.els[id]; const cell = el && el.querySelector(`[data-r="${r}"][data-c="0"]`);
    const s = state.view.scale || 1;
    const startH = cell ? Math.round(cell.getBoundingClientRect().height / s) : 28;
    rowResize = { id, r, pointerId: e.pointerId, startY: e.clientY, startH, before: { ...b, rowH: (b.rowH || []).slice() } };
    selectBlock(id);
    e.preventDefault(); e.stopPropagation();
  }

  // touch: press-and-hold a cell (or the title) → open the edit panel for it,
  // same as desktop right-click. Armed on pointerdown, cancelled by move/up.
  function armCellPress(e, id, r, c, isTitle) {
    if (e.pointerType !== 'touch') return;
    // lpPid is what the lift and the drift check cancel on. Without it a quick
    // tap on a cell left this timer running and the panel opened half a second
    // later, on its own.
    lpFired = false; lpX = e.clientX; lpY = e.clientY; lpPid = e.pointerId;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      lpTimer = null; lpFired = true;
      openTableEditor(id);
      if (isTitle) setFocusTitle(); else focusCell(id, r, c, false);
    }, 500);
  }

  // --- cell selection / editing ---
  function tableEl() { return editTableId ? state.els[editTableId] : null; }
  function cellEl(r, c) { const el = tableEl(); return el ? el.querySelector(`[data-r="${r}"][data-c="${c}"]`) : null; }
  function placeCaretEnd(node) {
    const rng = document.createRange(); rng.selectNodeContents(node); rng.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
  }
  function ensureCell(b, r, c) {
    if (!Array.isArray(b.rows)) b.rows = [];
    while (b.rows.length <= r) b.rows.push([]);
    while (b.rows[r].length <= c) b.rows[r].push('');
  }
  function focusCell(id, r, c, edit) {
    if (tsel && tsel.editing && !(tsel.r === r && tsel.c === c)) commitCellEdit();
    if (titleEditing) commitTitleEdit();
    const el = state.els[id]; if (!el) return;
    el.querySelectorAll('.cell-sel').forEach(x => x.classList.remove('cell-sel'));
    const tt = el.querySelector('.table-title'); if (tt) tt.classList.remove('title-sel');
    tfocus = 'cell';
    tsel = { id, r, c, editing: !!edit };
    tmulti = new Set([r + ':' + c]);
    const cell = cellEl(r, c); if (!cell) return;
    cell.classList.add('cell-sel');
    if (edit) { tsel.orig = cell.textContent; cell.setAttribute('contenteditable', 'true'); cell.focus(); placeCaretEnd(cell); }
    else { cell.removeAttribute('contenteditable'); cell.focus({ preventScroll: false }); }
    syncTablePanel();
  }
  // shift-click: toggle a cell in/out of the multi-selection (anchor follows the click)
  function toggleCellSel(id, r, c) {
    if (tsel && tsel.editing) commitCellEdit();
    if (titleEditing) commitTitleEdit();
    tfocus = 'cell';
    const key = r + ':' + c;
    if (tmulti.has(key)) { if (tmulti.size > 1) tmulti.delete(key); }
    else tmulti.add(key);
    // anchor = the clicked cell if still selected, else the first remaining
    const anchorKey = tmulti.has(key) ? key : [...tmulti][0];
    const [ar, ac] = anchorKey.split(':').map(Number);
    tsel = { id, r: ar, c: ac, editing: false };
    const el = state.els[id]; if (!el) return;
    el.querySelectorAll('.cell-sel').forEach(x => x.classList.remove('cell-sel'));
    tmulti.forEach(k => { const [rr, cc] = k.split(':'); const ce = el.querySelector(`[data-r="${rr}"][data-c="${cc}"]`); if (ce) ce.classList.add('cell-sel'); });
    const a = cellEl(tsel.r, tsel.c); if (a) a.focus({ preventScroll: true });
    syncTablePanel();
  }
  // --- title selection / inline editing ---
  const activeTableBlock = () => tableBlock || state.byId.get(editTableId) || null;
  function titleElOf() { const el = tableEl(); return el ? el.querySelector('.table-title') : null; }
  function setFocusTitle() {
    if (tsel && tsel.editing) commitCellEdit();
    const el = tableEl(); if (!el) return;
    el.querySelectorAll('.cell-sel').forEach(x => x.classList.remove('cell-sel'));
    tfocus = 'title';
    const tt = titleElOf(); if (tt) tt.classList.add('title-sel');
    syncTablePanel();
  }
  function beginTitleEdit() {
    const tt = titleElOf(); const b = activeTableBlock(); if (!tt || !b) return;
    setFocusTitle();
    titleEditing = true;
    if (tt.classList.contains('empty')) { tt.textContent = ''; tt.classList.remove('empty'); }
    tt.setAttribute('contenteditable', 'true'); tt.focus(); placeCaretEnd(tt);
  }
  function commitTitleEdit(cancel) {
    if (!titleEditing) return;
    const tt = titleElOf(); const b = activeTableBlock();
    if (tt && b) {
      const val = cancel ? (tableOrig ? tableOrig.title : b.title) : tt.textContent.trim();
      tt.removeAttribute('contenteditable');
      if ((b.title || '') !== val) {
        const before = tableSnapshot(b);
        b.title = val; b.updatedAt = Date.now(); persistBlock(b);
        recordChange({ blocks: [before], edges: [], files: [] }, { blocks: [tableSnapshot(b)], edges: [], files: [] });
      }
      refreshBlockCard(b.id);
    }
    titleEditing = false;
    syncTablePanel();
  }
  // --- format bar (acts on the active target: a cell or the title) ---
  function activeFmt() {
    const b = tableBlock; if (!b) return {};
    if (tfocus === 'title') return b.titleFmt || {};
    if (tsel) return (b.cellFmt && b.cellFmt[tsel.r + ':' + tsel.c]) || {};
    return {};
  }
  function applyFmt(prop, val) {
    const b = tableBlock; if (!b) return;
    commitCellEdit(); commitTitleEdit();     // keep any in-progress inline text before repainting
    if (tfocus === 'title') { b.titleFmt = { ...(b.titleFmt || {}), [prop]: val }; }
    else if (tmulti.size) { b.cellFmt = b.cellFmt || {}; tmulti.forEach(k => { b.cellFmt[k] = { ...(b.cellFmt[k] || {}), [prop]: val }; }); }
    else if (tsel) { const k = tsel.r + ':' + tsel.c; b.cellFmt = b.cellFmt || {}; b.cellFmt[k] = { ...(b.cellFmt[k] || {}), [prop]: val }; }
    else return;
    b.updatedAt = Date.now(); persistBlock(b); markChanged();
    refreshBlockCard(b.id);
    syncTablePanel();
  }
  function renderSwatchRow(wrapId, prop, active) {
    const wrap = $('#' + wrapId); if (!wrap) return; wrap.innerHTML = '';
    [''].concat(PALETTE, ['#ffffff', '#0a0b0d']).forEach(col => {
      const s = document.createElement('div');
      s.className = 'swatch' + (col === '' ? ' swatch-auto' : '') + ((active || '') === col ? ' active' : '');
      if (col) s.style.background = col; s.title = col || 'Default';
      s.addEventListener('click', () => applyFmt(prop, col));
      wrap.appendChild(s);
    });
  }
  const renderTblColors = (active) => renderSwatchRow('tbl-colors', 'color', active);
  const renderTblBg = (active) => renderSwatchRow('tbl-bg', 'bg', active);
  // Reflect the active target in the drawer's format bar + active-text field.
  function syncTablePanel() {
    const b = tableBlock; if (!b) return;
    const fmt = activeFmt();
    const label = $('#tbl-active-label'), input = $('#tbl-active-input');
    if (tfocus === 'title') { if (label) label.textContent = 'Title'; if (input) { input.value = b.title || ''; input.disabled = false; } }
    else if (tmulti.size > 1) { if (label) label.textContent = tmulti.size + ' cells'; if (input) { input.value = ''; input.disabled = true; } }
    else if (tsel) { if (label) label.textContent = 'Cell ' + colLetter(tsel.c) + (tsel.r + 1); if (input) { input.value = (b.rows[tsel.r] && b.rows[tsel.r][tsel.c]) || ''; input.disabled = false; } }
    $('#tbl-b').classList.toggle('on', !!fmt.bold);
    $('#tbl-i').classList.toggle('on', !!fmt.italic);
    $('#tbl-multi').classList.toggle('on', tmultiMode);
    $$('#tbl-align button').forEach(x => x.classList.toggle('on', (fmt.align || 'left') === x.dataset.al));
    $$('#tbl-font button').forEach(x => x.classList.toggle('on', (fmt.font || 'sans') === x.dataset.font));
    renderTblColors(fmt.color || '');
    renderTblBg(fmt.bg || '');
  }
  function beginEdit(replaceChar) {
    if (!tsel) return;
    const cell = cellEl(tsel.r, tsel.c); if (!cell) return;
    if (tmulti.size > 1) {   // typing/F2 collapses a multi-selection to the anchor cell
      tmulti = new Set([tsel.r + ':' + tsel.c]);
      const el = state.els[tsel.id];
      if (el) { el.querySelectorAll('.cell-sel').forEach(x => x.classList.remove('cell-sel')); cell.classList.add('cell-sel'); }
    }
    tsel.editing = true; tsel.orig = cell.textContent;
    cell.setAttribute('contenteditable', 'true');
    if (replaceChar != null) cell.textContent = replaceChar;
    cell.focus(); placeCaretEnd(cell);
  }
  function setCellValue(r, c, val) {
    const b = state.byId.get(editTableId); if (!b) return;
    ensureCell(b, r, c);
    b.rows[r][c] = val;
    const cell = cellEl(r, c); if (cell) cell.textContent = val;
    b.updatedAt = Date.now(); persistBlock(b); markChanged();
  }
  // A table's rows are arrays of arrays and history clones records shallowly,
  // so an entry has to carry its own copy of the grid.
  const tableSnapshot = (b) => ({ ...b, rows: (b.rows || []).map(r => r.slice()) });
  function commitCellEdit(cancel) {
    if (!tsel || !tsel.editing) return;
    const cell = cellEl(tsel.r, tsel.c);
    const b = state.byId.get(tsel.id);
    if (cell && b) {
      if (cancel) cell.textContent = tsel.orig != null ? tsel.orig : '';
      const val = cell.textContent;
      ensureCell(b, tsel.r, tsel.c);
      if (b.rows[tsel.r][tsel.c] !== val) {
        const before = tableSnapshot(b);
        b.rows[tsel.r][tsel.c] = val; b.updatedAt = Date.now(); persistBlock(b);
        recordChange({ blocks: [before], edges: [], files: [] }, { blocks: [tableSnapshot(b)], edges: [], files: [] });
      }
      cell.removeAttribute('contenteditable');
      if (tsel.r === 0 || tsel.c === 0) refreshBlockCard(b.id);   // restore column/row grips wiped while editing an edge cell
    }
    tsel.editing = false;
  }
  function moveCell(dr, dc) {
    if (!tsel) return;
    const b = state.byId.get(tsel.id); if (!b) return;
    const nr = (b.rows || []).length;
    const nc = (b.rows || []).reduce((m, r) => Math.max(m, r.length), 0);
    if (!nr || !nc) return;
    const r = clamp(tsel.r + dr, 0, nr - 1), c = clamp(tsel.c + dc, 0, nc - 1);
    focusCell(tsel.id, r, c, false);
  }
  // Keyboard handling while a table cell is focused (Excel-like).
  function onTableKey(e) {
    if (!editTableId) return;
    if (titleEditing) {
      const tt = titleElOf();
      if (tt && document.activeElement === tt) {
        if (e.key === 'Enter') { e.preventDefault(); commitTitleEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); commitTitleEdit(true); }
      }
      return;
    }
    if (!tsel) return;
    const el = tableEl(); const a = document.activeElement;
    if (!el || !a || !el.contains(a) || !a.matches('[data-r]')) return;
    if (tsel.editing) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitCellEdit(); moveCell(1, 0); }
      else if (e.key === 'Escape') { e.preventDefault(); commitCellEdit(true); focusCell(tsel.id, tsel.r, tsel.c, false); }
      else if (e.key === 'Tab') { e.preventDefault(); commitCellEdit(); moveCell(0, e.shiftKey ? -1 : 1); }
      return;   // all other keys type into the cell normally
    }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); beginEdit(null); }
    else if (e.key === 'Escape') { e.preventDefault(); closeTableEditor(); }
    else if (e.key === 'Tab') { e.preventDefault(); moveCell(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveCell(-1, 0); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveCell(1, 0); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); moveCell(0, -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveCell(0, 1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (tmulti.size > 1) tmulti.forEach(k => { const [rr, cc] = k.split(':').map(Number); setCellValue(rr, cc, ''); }); else setCellValue(tsel.r, tsel.c, ''); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); beginEdit(e.key); }
  }
  // structural edits from the drawer — repaint keeps the current selection
  function tableRepaint() {
    if (!tableBlock) return;
    tableBlock.updatedAt = Date.now(); persistBlock(tableBlock); markChanged();
    refreshBlockCard(tableBlock.id);
  }
  function bindTableEditor() {
    // active-target text field — edits the selected cell, or the title
    $('#tbl-active-input').addEventListener('focus', () => { commitCellEdit(); commitTitleEdit(); });
    $('#tbl-active-input').addEventListener('input', (e) => {
      const b = tableBlock; if (!b) return;
      if (tfocus === 'title') { b.title = e.target.value; }
      else if (tsel) { ensureCell(b, tsel.r, tsel.c); b.rows[tsel.r][tsel.c] = e.target.value; }
      else return;
      tableRepaint();
    });
    // format bar (bold / italic / align / font / colour) — targets the active cell or title
    $('#tbl-b').addEventListener('click', () => applyFmt('bold', !activeFmt().bold));
    $('#tbl-i').addEventListener('click', () => applyFmt('italic', !activeFmt().italic));
    $$('#tbl-align button').forEach(btn => btn.addEventListener('click', () => applyFmt('align', btn.dataset.al)));
    $('#tbl-multi').addEventListener('click', () => { tmultiMode = !tmultiMode; $('#tbl-multi').classList.toggle('on', tmultiMode); toast(tmultiMode ? 'Tap cells to select multiple' : 'Multi-select off'); });
    $$('#tbl-font button').forEach(btn => btn.addEventListener('click', () => applyFmt('font', btn.dataset.font)));
    $('#tbl-header').addEventListener('change', (e) => { if (!tableBlock) return; tableBlock.header = e.target.checked; tableRepaint(); });
    wireParam('tbl-fs-val', 'tbl-fs', (v) => { if (!tableBlock) return; tableBlock.fontSize = clamp(Math.round(v), 5, 400); tableRepaint(); });
    $('#tbl-add-row').addEventListener('click', () => {
      if (!tableBlock) return; const cols = (tableBlock.rows || []).reduce((m, r) => Math.max(m, r.length), 1);
      tableBlock.rows.push(new Array(cols).fill('')); tableRepaint();
    });
    $('#tbl-add-col').addEventListener('click', () => {
      if (!tableBlock) return; (tableBlock.rows || []).forEach(r => r.push('')); tableRepaint();
    });
    $('#tbl-del-row').addEventListener('click', () => {
      if (!tableBlock || (tableBlock.rows || []).length <= 1) return; tableBlock.rows.pop(); tableRepaint();
    });
    $('#tbl-del-col').addEventListener('click', () => {
      if (!tableBlock) return; const cols = (tableBlock.rows || []).reduce((m, r) => Math.max(m, r.length), 0);
      if (cols <= 1) return; tableBlock.rows.forEach(r => { if (r.length) r.pop(); }); tableRepaint();
    });
    $('#table-close').addEventListener('click', closeTableEditor);
    $('#tbl-done').addEventListener('click', closeTableEditor);
    $('#tbl-reset').addEventListener('click', () => {
      if (!tableBlock || !tableOrig) return;
      Object.assign(tableBlock, {
        title: tableOrig.title, header: tableOrig.header, fontSize: tableOrig.fontSize, w: tableOrig.w, h: tableOrig.h,
        colW: (tableOrig.colW || []).slice(), rowH: (tableOrig.rowH || []).slice(),
        titleFmt: tableOrig.titleFmt ? { ...tableOrig.titleFmt } : null,
        cellFmt: tableOrig.cellFmt ? JSON.parse(JSON.stringify(tableOrig.cellFmt)) : null,
        rows: tableOrig.rows.map(r => r.slice()),
      });
      $('#tbl-header').checked = tableBlock.header !== false;
      const fs = tableBlock.fontSize || 13; $('#tbl-fs').value = fs; $('#tbl-fs-val').value = fs;
      tableRepaint(); syncTablePanel(); toast('Reset to original');
    });
    $('#tbl-delete').addEventListener('click', () => { if (tableBlock) { const id = tableBlock.id; closeTableEditor(); deleteBlock(id); } });
    // keyboard handling for cells + title (selection is done on pointerdown, see onPointerDown)
    world.addEventListener('keydown', onTableKey);
    world.addEventListener('focusout', (e) => { if (titleEditing && e.target.classList && e.target.classList.contains('table-title')) commitTitleEdit(); });
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
    files.sort((a, b) => (a.createdAt - b.createdAt) || String(a.name || '').localeCompare(String(b.name || '')) || String(a.id).localeCompare(String(b.id)));
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
    $('#txt-input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (isWorkspaceFile(f)) importWorkspaceFile(f);
      else if (isCsvFile(f)) createListFromCsv(f, pendingTextAt); else createTextFromFile(f);
    });
    $('#xlsx-input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) importSheetFile(f, pendingSheetAt);
      pendingSheetAt = null;
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
  let lpTimer = null, lpFired = false, lpX = 0, lpY = 0, lpPid = null;   // long-press (touch → context menu)
  let gizmo = null;                    // rotate/resize handle drag {id, mode, ...}
  let lastPointer = null;              // last pointer position (screen coords) for paste-at-cursor
  let inking = null;                   // active freehand stroke {pts, path, pointerId, lastX, lastY}
  let erasing = null;                  // eraser drag in progress: { pointerId, lx, ly }
  let lasso = null;                    // freehand selection loop {pts, path, pointerId}
  let lastPointerType = 'mouse';       // dblclick has no pointerType of its own

  // Is a point inside the lasso loop? (even-odd ray cast, in world units)
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi) inside = !inside;
    }
    return inside;
  }
  // Pick every block on this level whose middle falls inside the loop.
  let lassoMode = 'replace';        // replace | add | remove
  const LASSO_MODES = {
    replace: { label: 'New selection',         hint: 'each loop starts fresh',  icon: 'lasso-new' },
    add:     { label: 'Add to selection',      hint: 'each loop adds',          icon: 'lasso-add' },
    remove:  { label: 'Remove from selection', hint: 'each loop takes away',    icon: 'lasso-remove' },
  };
  function setLassoMode(m) {
    if (!LASSO_MODES[m]) m = 'replace';
    lassoMode = m;
    const ic0 = $('#btn-select-ic'); if (ic0) ic0.innerHTML = ic(LASSO_MODES[m].icon);
    const b = $('#btn-select'); if (b) b.title = 'Select: ' + LASSO_MODES[m].label.toLowerCase() + ' \u2014 circle with the stylus; the dots pick New / Add / Remove';
  }
  function selectInsideLasso(poly) {
    const hits = [];
    for (const b of state.blocks) {
      if (b.parentId !== state.level) continue;
      let cx, cy;
      if (b.kind === 'ink') { const ib = inkBox(b); cx = ib.x + ib.w / 2; cy = ib.y + ib.h / 2; }
      else { const el = state.els[b.id]; if (!el) continue; const s = elSize(b.id, el) || {}; cx = (b.x || 0) + (s.w || BLOCK_W) / 2; cy = (b.y || 0) + (s.h || BLOCK_H_GUESS) / 2; }
      if (pointInPoly(cx, cy, poly)) hits.push(b.id);
    }
    const grown = withGroups(hits);
    if (lassoMode === 'add') {
      grown.forEach(id => state.selectedIds.add(id));
      applySelectionClasses();
    } else if (lassoMode === 'remove') {
      grown.forEach(id => state.selectedIds.delete(id));
      applySelectionClasses();
    } else {
      setSelection(hits);
    }
    const count = state.selectedIds.size;
    toast(count ? count + (count === 1 ? ' item selected' : ' items selected') : 'Selection cleared');
  }

  /* --------------------- handwriting -> text --------------------------- *
   * Recognition itself is done by the platform: the desktop/mobile app hands
   * the strokes to the OS recogniser through NGShell, and Chromium's own
   * handwriting API is used where it exists (ChromeOS). Nothing is sent to a
   * server, so where neither is available we say so rather than guess.     */
  function inkRecognizerKind() {
    if (window.NGShell && NGShell.recognizeInk) return 'native';
    if (navigator.createHandwritingRecognizer) return 'web';
    return null;
  }

  // strokes: [[[x,y],...], ...] in world units -> recognised text
  async function recognizeHandwriting(strokes) {
    const kind = inkRecognizerKind();
    if (kind === 'native') return await NGShell.recognizeInk(strokes);
    if (kind === 'web') {
      const rec = await navigator.createHandwritingRecognizer({ languages: ['en'] });
      const drawing = rec.startDrawing({ recognitionType: 'text' });
      strokes.forEach(pts => {
        const st = new HandwritingStroke();
        pts.forEach(([x, y], i) => st.addPoint({ x, y, t: i * 12 }));
        drawing.addStroke(st);
      });
      const out = await drawing.getPrediction();
      drawing.clear(); rec.finish();
      return (out && out[0] && out[0].text) || '';
    }
    return null;
  }

  // Turn the selected handwriting into a text block in its place.
  async function convertInkToText(ids) {
    const inks = (ids || [...state.selectedIds])
      .map(id => state.byId.get(id))
      .filter(b => b && b.kind === 'ink');
    if (!inks.length) { toast('Select some handwriting first.'); return; }
    if (!inkRecognizerKind()) {
      toast('Handwriting recognition is not available on this platform yet.');
      return;
    }
    toast('Reading handwriting…');
    const strokes = inks.map(b => (b.pts || []).map(([x, y]) => [x + (b.x || 0), y + (b.y || 0)]));
    let text = '';
    try { text = await recognizeHandwriting(strokes); }
    catch (e) { console.error(e); toast('Could not read that handwriting.'); return; }
    if (!text || !text.trim()) { toast('No text found in that handwriting.'); return; }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    inks.forEach(b => {
      minX = Math.min(minX, b.x || 0); minY = Math.min(minY, b.y || 0);
      maxX = Math.max(maxX, (b.x || 0) + (b.w || 0)); maxY = Math.max(maxY, (b.y || 0) + (b.h || 0));
    });
    const tb = {
      id: uid(), ws: state.ws, parentId: state.level, kind: 'text',
      text: text.trim(), title: '', color: inks[0].color || '',
      size: Math.max(14, Math.min(48, Math.round((maxY - minY) * 0.8))),
      bold: false, italic: false, align: 'left', rot: 0,
      w: Math.max(80, Math.round(maxX - minX)), h: Math.max(30, Math.round(maxY - minY)),
      x: Math.round(minX), y: Math.round(minY),
      z: 0, createdAt: Date.now(), updatedAt: Date.now(),
    };
    await flushPendingSaves(); closeOtherEditors();    // the ink panel must not outlive its strokes
    const removal = await gatherRemoval(inks.map(b => b.id));
    for (const b of inks) { await DB.deleteBlockDeep(b.id); }
    await DB.saveBlock(tb);
    recordChange(removal, { blocks: [tb], edges: [], files: [] });
    state.tagFilter = null;                            // as a fresh level load would
    await applyRecsToView({ blocks: [tb], edges: [], files: [] }, removal, state.level);
    setSelection([tb.id]);
    toast('Converted to text');
  }

  /* ---------------------- shape recognition ---------------------------- *
   * A finished stroke is measured against a few simple geometric tests. If
   * one clearly matches, the stroke becomes a real vector shape instead of
   * ink — the same trick Samsung Notes and OneNote use. Anything ambiguous
   * (handwriting, sketches) is left exactly as drawn.                      */
  let shapeSnap = false;
  try { shapeSnap = localStorage.getItem('ng-shape-snap') === '1'; } catch (_) {}

  // Resample a stroke to evenly spaced points — corner maths needs an even
  // sampling, not the uneven spacing a fast hand produces.
  function resamplePts(pts, count) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (total <= 0) return pts.slice();
    const step = total / (count - 1);
    const out = [pts[0].slice()];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      let [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      let d = Math.hypot(x1 - x0, y1 - y0);
      while (acc + d >= step && out.length < count) {
        const t = (step - acc) / d;
        const nx = x0 + (x1 - x0) * t, ny = y0 + (y1 - y0) * t;
        out.push([nx, ny]);
        x0 = nx; y0 = ny; d = Math.hypot(x1 - x0, y1 - y0); acc = 0;
      }
      acc += d;
    }
    while (out.length < count) out.push(pts[pts.length - 1].slice());
    return out;
  }

  // Corners = points where the stroke turns sharply. Measured as the angle
  // between the directions a few samples either side, then thinned so one
  // corner is reported once.
  function findCorners(rs, closed, minTurn) {
    const N = rs.length, span = Math.max(2, Math.round(N * 0.05));
    const turn = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      const a = closed ? rs[(i - span + N) % N] : rs[Math.max(0, i - span)];
      const b = rs[i];
      const c = closed ? rs[(i + span) % N] : rs[Math.min(N - 1, i + span)];
      const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      let d = Math.abs(a2 - a1);
      if (d > Math.PI) d = Math.PI * 2 - d;
      turn[i] = d;
    }
    const MIN_TURN = minTurn || 0.62;            // ~35 degrees counts as a corner
    const picks = [];
    for (let i = 0; i < N; i++) {
      if (turn[i] < MIN_TURN) continue;
      if (!closed && (i < span || i > N - 1 - span)) continue;    // ends are not corners
      let best = true;
      for (let k = -span; k <= span; k++) {
        const j = closed ? (i + k + N) % N : i + k;
        if (j < 0 || j >= N || j === i) continue;
        if (turn[j] > turn[i]) { best = false; break; }
      }
      if (best) picks.push(i);
    }
    // merge picks that sit on the same corner
    const merged = [];
    for (const i of picks) {
      const near = merged.length && (closed
        ? Math.min(Math.abs(i - merged[merged.length - 1]), N - Math.abs(i - merged[merged.length - 1])) < span * 1.6
        : i - merged[merged.length - 1] < span * 1.6);
      if (!near) merged.push(i);
    }
    if (closed && merged.length > 1) {
      const gap = Math.min(Math.abs(merged[0] - merged[merged.length - 1]),
                           N - Math.abs(merged[0] - merged[merged.length - 1]));
      if (gap < span * 1.6) merged.pop();
    }
    return merged.map(i => rs[i]);
  }

  // Normalised polygon outlines (0..1 inside the block box).
  const POLY_SHAPES = {
    diamond:  [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
    pentagon: [[0.5, 0], [1, 0.38], [0.82, 1], [0.18, 1], [0, 0.38]],
    hexagon:  [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
    star:     (() => {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.21 : 0.5;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        pts.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
      }
      return pts;
    })(),
  };

  // Does the stroke stay close to a perfect ellipse in its own bounding box?
  function ellipseError(pts, minX, minY, w, h) {
    const cx = minX + w / 2, cy = minY + h / 2;
    const rx = (w / 2) || 1, ry = (h / 2) || 1;
    let err = 0;
    for (const [px, py] of pts) err += Math.abs(Math.hypot((px - cx) / rx, (py - cy) / ry) - 1);
    return err / pts.length;
  }

  /* ---- template matching ($1 unistroke, made rotation- and start-tolerant) --
   * The stroke is resampled to 64 evenly spaced points, scaled into a square
   * (so a rectangle reads as a square and an ellipse as a circle - the
   * proportions are settled afterwards from the real box), centred, and
   * compared point by point against generated templates. Every start point
   * and both drawing directions are tried, and the best rotation is found by
   * golden-section search, so how the shape was drawn does not matter.     */
  const SR_N = 64, SR_SIZE = 250;
  // Rotate to the indicative angle FIRST, then scale to the square, then
  // centre - in that order. A box depends on the shape's rotation, so scaling
  // before rotating made an upright square and a tilted one different sizes.
  function srNormalize(P) {
    let cx = 0, cy = 0;
    for (const [x, y] of P) { cx += x; cy += y; }
    cx /= P.length; cy /= P.length;
    const a = Math.atan2(P[0][1] - cy, P[0][0] - cx);          // indicative angle
    const cos = Math.cos(-a), sin = Math.sin(-a);
    const R = P.map(([x, y]) => [(x - cx) * cos - (y - cy) * sin, (x - cx) * sin + (y - cy) * cos]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of R) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const sx = SR_SIZE / Math.max(1e-6, maxX - minX), sy = SR_SIZE / Math.max(1e-6, maxY - minY);
    let qx = 0, qy = 0;
    const Q = R.map(([x, y]) => { const q = [x * sx, y * sy]; qx += q[0]; qy += q[1]; return q; });
    qx /= Q.length; qy /= Q.length;
    return Q.map(([x, y]) => [x - qx, y - qy]);
  }
  function srRotate(P, a) { const c = Math.cos(a), s2 = Math.sin(a); return P.map(([x, y]) => [x * c - y * s2, x * s2 + y * c]); }
  function srDist(P, T) { let d = 0; for (let i = 0; i < P.length; i++) d += Math.hypot(P[i][0] - T[i][0], P[i][1] - T[i][1]); return d / P.length; }
  function srBestDist(P, T) {
    const PHI = 0.5 * (-1 + Math.sqrt(5));
    let a = -Math.PI / 4, b = Math.PI / 4;
    let x1 = PHI * a + (1 - PHI) * b, f1 = srDist(srRotate(P, x1), T);
    let x2 = (1 - PHI) * a + PHI * b, f2 = srDist(srRotate(P, x2), T);
    while (Math.abs(b - a) > 0.035) {
      if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = PHI * a + (1 - PHI) * b; f1 = srDist(srRotate(P, x1), T); }
      else { a = x1; x1 = x2; f1 = f2; x2 = (1 - PHI) * a + PHI * b; f2 = srDist(srRotate(P, x2), T); }
    }
    return Math.min(f1, f2);
  }
  // templates: a circle and the regular polygons, drawn from the top, clockwise
  const SR_TEMPLATES = (() => {
    const ring = (k, inner) => {
      const pts = [], count = inner ? k * 2 : k;
      for (let i = 0; i <= count; i++) {
        const idx = i % count, r = inner && idx % 2 ? inner : 1;
        const a = -Math.PI / 2 + idx / count * Math.PI * 2;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return pts;
    };
    const circle = []; for (let i = 0; i <= 96; i++) { const a = -Math.PI / 2 + i / 96 * Math.PI * 2; circle.push([Math.cos(a), Math.sin(a)]); }
    return [['circle', circle], ['triangle', ring(3)], ['square', ring(4)], ['pentagon', ring(5)], ['hexagon', ring(6)], ['star', ring(5, 0.42)]]
      .map(([name, pts]) => ({ name, pts: srNormalize(resamplePts(pts, SR_N)) }));
  })();
  function srMatch(pts) {
    const rs = resamplePts(pts, SR_N).map(p => [p[0], p[1]]);
    const scored = SR_TEMPLATES.map(t => {
      let dmin = Infinity;
      for (const dir of [rs, rs.slice().reverse()]) {
        for (let k = 0; k < SR_N; k += 4) {
          const P = srNormalize(dir.slice(k).concat(dir.slice(0, k)));
          dmin = Math.min(dmin, srBestDist(P, t.pts));
        }
      }
      return { name: t.name, score: 1 - dmin / (0.5 * Math.SQRT2 * SR_SIZE) };
    }).sort((a, b) => b.score - a.score);
    return { best: scored[0], second: scored[1], all: scored };
  }
  const SR_ACCEPT = 0.80;                 // below this the stroke is not a shape at all

  // A closed stroke, tidied: an overshoot past the start is cut off, and
  // whatever gap is left is bridged, so the matcher sees the intended outline.
  function tidyClosed(pts) {
    const n = pts.length, s0 = pts[0];
    let bestI = n - 1, bestD = Math.hypot(pts[n - 1][0] - s0[0], pts[n - 1][1] - s0[1]);
    for (let i = Math.floor(n * 0.75); i < n - 1; i++) {
      const d = Math.hypot(pts[i][0] - s0[0], pts[i][1] - s0[1]);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    const cut = pts.slice(0, bestI + 1);
    cut.push([s0[0], s0[1]]);
    return cut;
  }
  // How much the outline turns, against the one full turn a plain outline
  // needs: ~1 for circles and polygons, more for anything bumpy or looping.
  function wiggle(rs) {
    const N = rs.length, span = Math.max(3, Math.round(N * 0.08));
    let tot = 0;
    for (let i = 0; i < N; i++) {
      const a = rs[(i - span + N) % N], b = rs[i], c = rs[(i + span) % N];
      let d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      tot += Math.abs(d);
    }
    return tot / (2 * Math.PI * span);
  }

  // Returns { shape, points?, x, y, w, h, rot? } when the stroke is clearly a shape.
  function recognizeShape(raw) {
    if (raw.length < 6) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, pathLen = 0;
    for (let i = 0; i < raw.length; i++) {
      minX = Math.min(minX, raw[i][0]); maxX = Math.max(maxX, raw[i][0]);
      minY = Math.min(minY, raw[i][1]); maxY = Math.max(maxY, raw[i][1]);
      if (i) pathLen += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    }
    const w = maxX - minX, h = maxY - minY;
    const size = Math.max(w, h);
    // thresholds are in SCREEN pixels: a shape drawn while zoomed in is small
    // in world units but plenty big to judge under the hand
    const vsc = (typeof state !== 'undefined' && state.view && state.view.scale) || 1;
    if (size * vsc < 24 || pathLen * vsc < 34) return null;   // too small to judge
    const a = raw[0], b = raw[raw.length - 1];
    const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // closed when the ends come back together - up to about half a side apart
    const closed = gap < Math.max(size * 0.5, pathLen * 0.16);
    const box = { x: minX, y: minY, w: Math.max(w, 6), h: Math.max(h, 6) };

    if (!closed) {
      // straight when the stroke hugs the direct route: no detour, and no
      // point wandering far off the chord (works at any angle).
      if (gap > 0 && pathLen / gap < 1.16) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        let dev = 0;
        for (const [px, py] of raw) dev = Math.max(dev, Math.abs((px - a[0]) * dy - (py - a[1]) * dx) / gap);
        if (dev < gap * 0.09) return { shape: 'line', ...box, from: a, to: b };
      }
      return null;                                            // open scribble: leave as ink
    }
    // round more than once, or wander: a spiral or a scribble, never a shape
    if (pathLen > 2 * (w + h) * 1.45) return null;

    const pts = tidyClosed(raw);
    const rs = resamplePts(pts, 96);
    const m = srMatch(pts);
    if (m.best.score < SR_ACCEPT) return null;
    let kind = m.best.name;
    // bumpy outlines (a cloud, a scribbled loop) turn far more than a plain
    // shape does; a star is the one shape that legitimately turns a lot
    const wg = wiggle(rs);
    if (kind !== 'star' && wg > 1.3) return null;
    if (kind === 'star' && wg > 2.5) return null;

    const corners = findCorners(rs, true);           // ~35 degrees
    const sharp = findCorners(rs, true, 0.85);       // ~49 degrees: real corners, not wobble
    const c = corners.length, sc = sharp.length;
    // a close call between neighbours: let the corners settle it
    if (m.best.score - m.second.score < 0.04) {
      const byCorners = c === 3 ? 'triangle' : c === 4 ? 'square' : c === 5 ? 'pentagon' : c === 6 ? 'hexagon'
                      : c <= 2 ? 'circle' : (c >= 9 && c <= 11 ? 'star' : null);
      if (byCorners && (byCorners === m.best.name || byCorners === m.second.name)) kind = byCorners;
    }
    // circle and the round-looking polygons are near-twins under wobble. The
    // template can call a rounded rectangle a circle; the corner count and how
    // round the outline actually is put it right.
    if (kind === 'circle' || kind === 'pentagon' || kind === 'hexagon') {
      const err = ellipseError(rs, minX, minY, w, h);
      const round = err < 0.085;
      if (round && sc <= 2) kind = 'circle';
      else if (sc === 3 || (!round && c === 3)) kind = 'triangle';
      else if (sc === 4 || (!round && c === 4)) kind = 'square';   // quad; rect vs diamond below
      else if (sc === 5) kind = 'pentagon';
      else if (sc === 6) kind = 'hexagon';
      else if (round) kind = 'circle';
    }
    if (kind === 'circle') return { shape: 'circle', ...box };
    if (kind === 'triangle') return { shape: 'triangle', ...box };
    if (kind === 'pentagon') return { shape: 'polygon', points: POLY_SHAPES.pentagon, ...box };
    if (kind === 'hexagon') return { shape: 'polygon', points: POLY_SHAPES.hexagon, ...box };
    if (kind === 'star') return { shape: 'polygon', points: POLY_SHAPES.star, ...box };

    // four-sided: standing on a corner (diamond), or a rectangle - at whatever
    // angle it was drawn, with its real side lengths
    const near = (v, t, tol) => Math.abs(v - t) < tol;
    if (c === 4) {
      const mids = corners.filter(([px, py]) =>
        (near(px, minX + w / 2, w * 0.22) && (near(py, minY, h * 0.25) || near(py, maxY, h * 0.25))) ||
        (near(py, minY + h / 2, h * 0.22) && (near(px, minX, w * 0.25) || near(px, maxX, w * 0.25))));
      if (mids.length === 4) return { shape: 'polygon', points: POLY_SHAPES.diamond, ...box };
      const side = (k) => Math.hypot(corners[(k + 1) % 4][0] - corners[k][0], corners[(k + 1) % 4][1] - corners[k][1]);
      let wid = (side(0) + side(2)) / 2, hei = (side(1) + side(3)) / 2;
      let ang = Math.atan2(corners[1][1] - corners[0][1], corners[1][0] - corners[0][0]) * 180 / Math.PI;
      ang = ((ang % 180) + 180) % 180; if (ang > 90) ang -= 180;
      if (ang > 45) { ang -= 90; [wid, hei] = [hei, wid]; } else if (ang < -45) { ang += 90; [wid, hei] = [hei, wid]; }
      if (Math.abs(ang) < 5) ang = 0;                          // near enough upright
      const cx = corners.reduce((t, q) => t + q[0], 0) / 4, cy = corners.reduce((t, q) => t + q[1], 0) / 4;
      const square = Math.min(wid, hei) / Math.max(wid, hei) > 0.82;
      return { shape: square ? 'square' : 'rectangle', x: cx - wid / 2, y: cy - hei / 2, w: wid, h: hei, rot: ang };
    }
    // corners unclear: how much of the outline hugs the box tells a square
    // (almost all of it) from a diamond (only its four tips)
    let hug = 0;
    for (const [px, py] of rs) { if (Math.min(px - minX, maxX - px, py - minY, maxY - py) < size * 0.08) hug++; }
    if (hug / rs.length < 0.42 && Math.min(w, h) / Math.max(w, h) > 0.8) return { shape: 'polygon', points: POLY_SHAPES.diamond, ...box };
    const square = Math.min(w, h) / Math.max(w, h) > 0.82;
    return { shape: square ? 'square' : 'rectangle', ...box };
  }
  // exposed for the test bench only
  window.__ngShape = { recognizeShape, srMatch, wiggle, tidyClosed, resamplePts };

  const shapeSnapName = (hit) => {
    if (hit.shape !== 'polygon') return hit.shape;
    const key = Object.keys(POLY_SHAPES).find(k => POLY_SHAPES[k] === hit.points);
    return key || 'polygon';
  };

  // Build the vector block a recognised stroke turns into.
  async function createRecognizedShape(hit, colour, strokeW) {
    const pad = 2;
    const b = {
      id: uid(), ws: state.ws, parentId: state.level, kind: 'shape',
      title: '', shape: hit.shape === 'square' ? 'rectangle' : hit.shape,
      points: hit.points || null,
      x: Math.round(hit.x - pad), y: Math.round(hit.y - pad),
      w: Math.round(Math.max(hit.shape === 'line' ? 8 : 16, hit.w + pad * 2)),
      h: Math.round(Math.max(hit.shape === 'line' ? 8 : 16, hit.h + pad * 2)),
      color: colour, fill: false, outline: true,
      outlineW: Math.max(2, Math.round(strokeW)), outlineColor: colour,
      rot: 0, z: 0, createdAt: Date.now(), updatedAt: Date.now(),
    };
    if (hit.shape === 'square') {                              // even sides
      const side = Math.round((b.w + b.h) / 2);
      b.x += Math.round((b.w - side) / 2); b.y += Math.round((b.h - side) / 2);
      b.w = b.h = side;
    }
    if (hit.rot) b.rot = Math.round(hit.rot);                  // drawn at a tilt: keep it
    if (hit.shape === 'line') {                                // keep the drawn angle
      const dx = hit.to[0] - hit.from[0], dy = hit.to[1] - hit.from[1];
      const len = Math.hypot(dx, dy);
      b.w = Math.round(Math.max(8, len)); b.h = Math.round(Math.max(8, strokeW * 2 + 6));
      b.x = Math.round((hit.from[0] + hit.to[0]) / 2 - b.w / 2);
      b.y = Math.round((hit.from[1] + hit.to[1]) / 2 - b.h / 2);
      b.rot = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
      b.outlineW = Math.max(2, Math.round(strokeW));
    }
    state.blocks.push(b);
    state.byId.set(b.id, b);
    state.childCounts[b.id] = { blocks: 0, files: 0 };
    world.appendChild(makeBlockEl(b));
    const level = state.level, gen = history.gen;
    await afterInkWrites(async () => {
      await DB.saveBlock(b);
      if (history.gen !== gen) return;
      recordChange(emptySet(), { blocks: [b], edges: [], files: [] }, level);
    });
    return b;
  }

  /* ------------------------- live ink surface --------------------------- *
   * The wet layer (js/ink/wet.js) owns the desynchronized canvas: clipped
   * dirty-rect repaints from the same path generator the saved SVG uses, a
   * predicted tail, and a hand-off that keeps the stroke on the glass until
   * the committed pixels are on screen. app.js only feeds it samples.       */
  let inkCv = null;
  function inkSurface() {
    if (!inkCv) {
      inkCv = $('#ink-live');
      if (inkCv) NG.wet.attach(inkCv, { getView: () => state.view, styles: PEN_STYLES, strokeD: inkStrokeD, centreline: taperCentreline });
    }
    return NG.wet.ctx;
  }
  function sizeInkSurface() { inkSurface(); NG.wet.size(stage.getBoundingClientRect()); }
  // world -> screen, matching the #world transform
  const wx = (x) => x * state.view.scale + state.view.tx;
  const wy = (y) => y * state.view.scale + state.view.ty;

  function beginInkStroke(st) {
    inkSurface(); sizeInkSurface();
    inking.taper = st.taper || 0;
    NG.wet.begin(inking);
  }
  // the view moved or the canvas was resized: same picture, new place
  function redrawInkStroke() { if (NG.wet.pending.length) NG.wet.repaintAll(); }

  // At most two repaints per display frame: the first sample of a frame goes
  // to the glass at once (the low-latency path); the rest of that frame's
  // samples land in one trailing paint on the next animation frame.
  function scheduleLivePaint() {
    const s = inking; if (!s) return;
    if (!s.paintRAF) {
      NG.wet.paint(s, true);
      s.paintRAF = requestAnimationFrame(() => {
        s.paintRAF = 0;
        if (s.dirty && inking === s) { s.dirty = false; NG.wet.paint(s, false); }
      });
    } else s.dirty = true;
  }
  // Throw away the stroke in progress (a navigation, a second finger, lost
  // focus): nothing is saved, the glass is wiped, the pointer let go.
  function dropLiveStroke() {
    if (!inking) return;
    const s = inking; inking = null;
    try { stage.releasePointerCapture(s.pointerId); } catch (_) {}
    if (s.paintRAF) { cancelAnimationFrame(s.paintRAF); s.paintRAF = 0; }
    NG.wet.release(s);
    NG.emit('stroke:drop', { id: s.pointerId });
  }

  // A navigation or workspace change ends every stylus gesture: the stroke is
  // dropped, what the eraser removed so far is committed to the page it was on.
  function dropLiveGestures() {
    dropLiveStroke();
    if (erasing) { try { stage.releasePointerCapture(erasing.pointerId); } catch (_) {} erasing = null; commitEraseBatch(); }
    if (lasso) { lasso.path.remove(); lasso = null; }
  }

  // Every sample the digitiser reported, taken once: the sampler decides the
  // stroke's channel from the first move-class event (pointerrawupdate wins;
  // the following pointermove then only contributes prediction).
  function addInkSamples(e, fromRaw) {
    if (!inking || e.pointerId !== inking.pointerId) return;
    inking.lastX = e.clientX; inking.lastY = e.clientY;
    const kept = inking.sampler.consumeEvent(e, fromRaw ? 'raw' : 'move');
    if (kept || inking.sampler.predicted.length) scheduleLivePaint();
  }

  // Smooth ink path (midpoint quadratic curves) — pen strokes render as fluid
  // curves instead of jagged segment chains, live and once saved.
  function inkPathD(pts) {
    if (!pts.length) return '';
    if (pts.length < 3) return 'M' + pts.map(p => p[0] + ' ' + p[1]).join(' L');
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    }
    const l = pts[pts.length - 1];
    return d + ` L${l[0]} ${l[1]}`;
  }

  function onPointerDown(e) {
    lpFired = false;                            // a long-press only ever applies to its own pointer
    if (state.levelLayout === 'list') return;   // list view handles its own clicks/scroll
    // Floating UI sits inside the stage; a tap there is for that panel, not the
    // canvas. Without this the canvas cleared the selection first and every
    // button on the selection bar appeared to do nothing.
    if (e.target.closest && e.target.closest('#sel-bar, #sel-frame, #outline, #present-bar, #pen-bar, .banner-stack, #minimap')) return;
    // read mode: panning and navigating still work, editing does not - a
    // pointer landing on a block pans the page like one on empty paper
    // (see the pass-through rule below); a double-tap still steps inside

    // committing an in-progress table cell / title edit when clicking away from it
    if (editTableId && tsel && tsel.editing) {
      const cc = e.target.closest && e.target.closest('[data-r]');
      if (!cc || +cc.dataset.r !== tsel.r || +cc.dataset.c !== tsel.c) commitCellEdit();
    }
    if (editTableId && titleEditing && !(e.target.closest && e.target.closest('.table-title'))) commitTitleEdit();

    // RIGHT-click on a table cell (or title) → open the edit panel for that cell
    if (e.button === 2) {
      const rcCell = e.target.closest('.block-table .data-table [data-r]');
      const rcTitle = e.target.closest('.block-table .table-title');
      if (rcCell || rcTitle) {
        const tEl = e.target.closest('.block');
        if (tEl) {
          e.preventDefault();
          openTableEditor(tEl.dataset.id);
          if (rcCell) focusCell(tEl.dataset.id, +rcCell.dataset.r, +rcCell.dataset.c, false);
          else setFocusTitle();
          return;
        }
      }
      // RIGHT-button drag elsewhere = marquee (rubber-band) selection
      startMarquee(e); return;
    }
    if (e.button !== 0) return;

    // While a stylus gesture is live, a finger or knuckle landing on the glass
    // does nothing at all - no pan, no drag, no long-press. The hand resting
    // beside the pen must never move the page or open a menu mid-word.
    if ((inking || erasing || lasso) && !inkAccepts(e)) return;
    if (marquee) return;                        // a rubber band is live: no pan, drag or long-press from another pointer

    lastPointerType = e.pointerType || 'mouse';

    // a palm resting on the page while writing does nothing at all
    if (state.penMode && isPalm(e)) return;

    const offTools = !e.target.closest('#pen-bar') && !e.target.closest('.banner-stack') && !e.target.closest('#minimap');

    // a freehand loop: the Select tool picks up what is circled, the eraser's
    // "erase with selection" removes it. Stylus (or mouse) only, like the pen;
    // a finger pans the page instead.
    if (lassoActive() && !lasso && inkAccepts(e) && offTools) {      // inkAccepts: fingers only when the hand button says so
      const erase = eraseLasso();
      const hitBlock = topElAt(e.clientX, e.clientY, e.target.closest('.block'));
      // With the Select tool a block still behaves normally (tap to pick,
      // drag to move) and the loop starts from empty canvas. The eraser's
      // loop starts anywhere.
      if (erase || !hitBlock) {
        const r = stage.getBoundingClientRect();
        const p = screenToWorld(e.clientX - r.left, e.clientY - r.top);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'lasso-path' + (erase ? ' erase' : ''));
        svg.appendChild(path);
        lasso = { pts: [[p.x, p.y]], path, pointerId: e.pointerId, erase };
        path.setAttribute('d', 'M' + p.x + ' ' + p.y);
        return;
      }
      // fall through: pointer landed on a block, so the normal tap/drag runs
    }

    // the eraser (with or without the draw panel): rub out what is under the
    // stylus, and keep going as it moves (onPointerMove)
    if (state.penEraser && eraserMode !== 'lasso' && !inking && inkAccepts(e) && offTools) {
      erasing = { pointerId: e.pointerId, lx: e.clientX, ly: e.clientY };
      beginEraseBatch();
      if (eraserMode === 'stroke') eraseStrokeAt(e.clientX, e.clientY);
      else eraseSweepAt(e.clientX, e.clientY, e.clientX, e.clientY);
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // freehand pen (Samsung-Notes model): while draw mode is on, the pen ALWAYS
    // draws — over empty canvas, over blocks, over earlier strokes. Nothing gets
    // selected or dragged. Two fingers = pan/zoom the page.
    if (state.penMode && !state.penEraser && state.levelLayout === 'canvas'
        && !e.target.closest('.banner-stack') && !e.target.closest('#pen-bar') && !e.target.closest('#minimap')
        && inkAccepts(e)) {
      if (inking) {
        // a second finger landed mid-stroke → discard the stroke, navigate instead
        pointers.set(inking.pointerId, { x: inking.lastX, y: inking.lastY });
        dropLiveStroke();
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
        return;
      }
      const r = stage.getBoundingClientRect();
      const p = screenToWorld(e.clientX - r.left, e.clientY - r.top);

      // The nib keeps the thickness you picked on screen, whatever the zoom:
      // strokes live in world units, so divide by the current scale — write
      // zoomed out and the mark is the same weight under your hand.
      const width = curWidth() / (state.view.scale || 1);
      // A stylus reports how hard you press; that drives the stroke width for
      // the styles that taper. Fingers and mice report nothing useful, so
      // they keep the speed-based width.
      const pen = e.pointerType === 'pen';
      const st0 = PEN_STYLES[penStyle] || PEN_STYLES.pen;
      const press0 = pen ? (e.pressure || 0.5) : 0;
      // the pen always draws: a finger pan, drag or handle already in flight
      // yields to it (whatever it moved goes back) instead of resuming with a
      // jump once the stroke ends
      for (const pid of [...pointers.keys()]) abandonPointer(pid);
      clearTimeout(lpTimer); lpTimer = null;
      const sampler = new NG.StrokeSampler({
        pointerId: e.pointerId, pointerType: e.pointerType, rect: r, toWorld: screenToWorld,
        getScale: () => state.view.scale || 1, taper: st0.taper || 0, usePressure: pen, nibFactor,
        t0: e.timeStamp || performance.now(), x0: e.clientX, y0: e.clientY, p0: press0,
      });
      inking = { sampler, pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY,
                 style: penStyle, color: penColor, width, pressure: pen, rect: r,
                 paintRAF: 0, dirty: false, taper: st0.taper || 0,
                 ws: state.ws, level: state.level,            // the page it belongs to
                 get pts() { return this.sampler.toPts(); } };
      beginInkStroke(st0);
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}   // never lose the stroke
      return;
    }

    // NOTE: intentionally NOT using setPointerCapture — it can redirect
    // click/dblclick to the capture target in some browsers. Move/up are on
    // window (see bindStage) so gestures still track off-stage.
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {         // start pinch
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      if (dragging) state.els[dragging.primary]?.classList.remove('dragging');
      dragging = panning = null;
      if (!selScale) selFrameBox = selectionWorldBox();
      clearTimeout(lpTimer); lpTimer = null; lpFired = false;   // cancel long-press during pinch
      return;
    }

    let blockEl = topElAt(e.clientX, e.clientY, e.target.closest('.block'));
    // Handwriting behaves like ink on paper: it only moves once you have
    // deliberately picked it up with a Select tool. Otherwise a drag that
    // starts on a stroke pans the page, so writing never shifts by accident
    // while you are moving around. (A tap still selects it - see onPointerUp.)
    let inkPassThrough = null;
    if (blockEl && !state.selectTool) {
      const hb = state.byId.get(blockEl.dataset.id);
      // once picked up (tapped, or circled) a stroke drags like anything else
      if (hb && hb.kind === 'ink' && !state.selectedIds.has(hb.id)) { inkPassThrough = hb.id; blockEl = null; }
    }
    // A finger pans the page. It moves, resizes or opens a block only after a
    // tap has picked that block up (a stylus or mouse drags straight away);
    // the tap itself, a long-press and a double-tap still work on anything.
    let blockTap = null;
    if (blockEl && e.pointerType === 'touch' && !state.linkMode && !state.selectedIds.has(blockEl.dataset.id)) {
      blockTap = blockEl.dataset.id; blockEl = null; inkPassThrough = null;
    }
    // with the eraser up, a finger (the stylus never gets here) only pans
    if (blockEl && state.penEraser) { blockEl = null; inkPassThrough = null; blockTap = null; }
    // read mode: nothing is picked up or moved, so any object under the pointer pans
    if (blockEl && state.readOnly) { blockEl = null; inkPassThrough = null; blockTap = null; }
    if (state.readOnly) { inkPassThrough = null; blockTap = null; }
    // clicked a different block (or empty canvas) while a table's cells were active → leave cell mode
    if (editTableId && (!blockEl || blockEl.dataset.id !== editTableId)) closeTableEditor();
    if (blockEl) {
      const id = blockEl.dataset.id;
      // column-width / row-height grips on a table
      const colH = e.target.closest('.col-resize');
      if (colH) { startColResize(e, id, +colH.dataset.col); return; }
      const rowH = e.target.closest('.row-resize');
      if (rowH) { startRowResize(e, id, +rowH.dataset.row); return; }
      // rotate / resize / edge handle → start a gizmo gesture (not a move)
      const edge = e.target.closest('.tnode-edge');
      const handle = edge || e.target.closest('.tnode-rotate, .tnode-resize');
      if (handle) {
        const b = state.byId.get(id);
        if (b && b.locked) { selectBlock(id); return; }   // locked: no resize/rotate
        selectBlock(id);
        const rect = blockEl.getBoundingClientRect();
        const s = state.view.scale || 1;
        gizmo = {
          id, pointerId: e.pointerId, mode: edge ? 'box' : (handle.classList.contains('tnode-rotate') ? 'rotate' : 'resize'),
          edge: edge ? edge.dataset.edge : null,
          startX: e.clientX, startY: e.clientY,
          startSize: b.size || 22, startRot: b.rot || 0,
          startW: b.w || Math.round(rect.width / s), startH: b.h || Math.round(rect.height / s),
          startWrapW: b.w || null, startWrapH: b.h || null, startFont: b.fontSize || 13, startColW: (b.colW || []).slice(), startRowH: (b.rowH || []).slice(),
          startBX: b.x, startBY: b.y,
          cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
          isText: b.kind === 'text', isImage: b.kind === 'image', isTable: b.kind === 'table', isCheck: b.kind === 'check', before: { ...b },
        };
        gizmo.startAngle = Math.atan2(e.clientY - gizmo.cy, e.clientX - gizmo.cx);
        return;
      }
      // table cells: single-click selects a cell (entering edit mode if the table is
      // already selected); dragging the title/border still moves the block.
      const tb0 = state.byId.get(id);
      if (tb0 && tb0.kind === 'table') {
        const cell = e.target.closest('.data-table [data-r]');
        const titleHit = e.target.closest('.table-title');
        if (cell) {
          const r = +cell.dataset.r, c = +cell.dataset.c;
          if (editTableId === id) {
            armCellPress(e, id, r, c, false);
            if (e.shiftKey || tmultiMode) { toggleCellSel(id, r, c); return; }
            if (!(tsel && tsel.editing && tsel.r === r && tsel.c === c)) focusCell(id, r, c, false);
            return;
          }
          if (state.selectedIds.has(id)) { enterTableCells(id); armCellPress(e, id, r, c, false); if (e.shiftKey || tmultiMode) toggleCellSel(id, r, c); else focusCell(id, r, c, false); return; }
          // otherwise fall through: first click selects the block (so it can be dragged)
        } else if (titleHit) {
          if (editTableId === id) { armCellPress(e, id, 0, 0, true); if (!titleEditing) setFocusTitle(); return; }
          if (state.selectedIds.has(id)) { enterTableCells(id); armCellPress(e, id, 0, 0, true); setFocusTitle(); return; }
          // else fall through: first click selects the block
        }
        // clicking the border/padding falls through → normal drag to move the block
      }
      if (e.target.closest('[data-blk]')) return;   // hover action buttons
      if (state.linkMode) { handleLinkTap(id); return; }
      // if it's an unselected block and no shift, select just it (so drag moves it)
      if (!e.shiftKey && !state.selectedIds.has(id)) selectBlock(id);
      const primaryBlock = state.byId.get(id);
      // locked blocks: select (and shift-toggle) but never drag-move
      if (primaryBlock && primaryBlock.locked && !e.shiftKey) {
        // fall through to long-press handling below, but don't start a drag
      } else {
        // move the whole current selection if this block is part of it; else just this one
        const ids = (!e.shiftKey && state.selectedIds.has(id)) ? [...state.selectedIds] : [id];
        const starts = {};
        ids.forEach(bid => { const bb = state.byId.get(bid); if (bb && !bb.locked) starts[bid] = { x: bb.x, y: bb.y }; });
        dragging = { primary: id, pointerId: e.pointerId, ids: Object.keys(starts), starts, startX: e.clientX, startY: e.clientY, moved: false, shift: e.shiftKey };
        dragging.frame0 = selectionWorldBox();
        // connectors only need redrawing per move when one is attached to what moves
        dragging.touchesEdge = state.edges.some(ed => starts[ed.from] || starts[ed.to]);
        // many blocks (a lassoed word, a paragraph) are lifted into one
        // transformed container: one style write per move instead of hundreds
        if (dragging.ids.length >= 2 && NG.Lift) NG.Lift.begin(dragging.ids, 'move', { world, els: state.els });
        blockEl.classList.add('dragging');
      }
    } else {
      const r = stage.getBoundingClientRect();
      panning = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, tx: state.view.tx, ty: state.view.ty, r, inkTap: inkPassThrough, blockTap };
      stage.classList.add('panning');
      // carry the selection frame through the pan instead of re-measuring
      // every selected element on each move
      if (!dragging && !selScale) selFrameBox = selectionWorldBox();
    }

    // press-and-hold → context menu (mouse uses right-click); a stylus counts
    // too, except while it is the pen or eraser. On a table cell/title it
    // opens that cell's edit panel instead.
    if (e.pointerType === 'touch' || (e.pointerType === 'pen' && !state.penMode && !state.penEraser)) {
      lpFired = false; lpX = e.clientX; lpY = e.clientY; lpPid = e.pointerId;
      const cx = e.clientX, cy = e.clientY, tid = (blockEl ? blockEl.dataset.id : blockTap) || null;
      const lpCell = e.target.closest('.block-table .data-table [data-r]');
      const lpTitle = e.target.closest('.block-table .table-title');
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => {
        lpTimer = null;
        if (inking || erasing || lasso) return;      // the stylus is busy: no menu under the hand
        lpFired = true;
        cancelDrag();
        if (panning) { stage.classList.remove('panning'); panning = null; }
        selFrameBox = null;
        if (tid && (lpCell || lpTitle)) {
          const bb = state.byId.get(tid);
          if (bb && bb.kind === 'table') {
            openTableEditor(tid);
            if (lpCell) focusCell(tid, +lpCell.dataset.r, +lpCell.dataset.c, false);
            else setFocusTitle();
            return;
          }
        }
        openContextMenu(cx, cy, tid);
      }, 500);
    }
  }

  function onPointerMove(e) {
    lastPointer = { x: e.clientX, y: e.clientY };   // for paste-at-cursor
    if (erasing && erasing.pointerId === e.pointerId) {
      if (eraserMode === 'stroke') eraseStrokeAt(e.clientX, e.clientY);
      else { eraseSweepAt(erasing.lx, erasing.ly, e.clientX, e.clientY); showEraserCursor(e.clientX, e.clientY); }
      erasing.lx = e.clientX; erasing.ly = e.clientY;
      return;
    }
    // hovering with the eraser: show its footprint
    if (state.penEraser && eraserMode === 'normal' && e.pointerType !== 'touch') {
      if (e.target === stage || (e.target.closest && e.target.closest('#stage'))) showEraserCursor(e.clientX, e.clientY);
      else hideEraserCursor();
    }
    if (lasso && lasso.pointerId === e.pointerId) {
      const r = stageRect();
      const p = screenToWorld(e.clientX - r.left, e.clientY - r.top);
      const last = lasso.pts[lasso.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) * state.view.scale > 2) {
        lasso.pts.push([p.x, p.y]);
        lasso.path.setAttribute('d', 'M' + lasso.pts.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L') + ' Z');
      }
      return;
    }

    if (inking && inking.pointerId === e.pointerId) {
      addInkSamples(e, false);   // the raw channel normally has these already (see addInkSamples)
      return;
    }
    if (lpTimer && lpPid === e.pointerId && (Math.abs(e.clientX - lpX) + Math.abs(e.clientY - lpY) > 8)) { clearTimeout(lpTimer); lpTimer = null; }
    if (marquee) {
      if (e.pointerId !== marquee.pointerId) return;
      if (!marquee.moved && (Math.abs(e.clientX - marquee.sx) + Math.abs(e.clientY - marquee.sy) > 4)) {
        marquee.moved = true; if (!marquee.shift) clearSelection();
      }
      if (marquee.moved) { positionMarquee(e.clientX, e.clientY); updateMarqueeSelection(e.clientX, e.clientY); }
      return;
    }
    if (colResize && colResize.pointerId === e.pointerId) {
      const b = state.byId.get(colResize.id); if (!b) return;
      const s = state.view.scale || 1;
      const nw = Math.max(24, Math.round(colResize.startW + (e.clientX - colResize.startX) / s));
      if (!Array.isArray(b.colW)) b.colW = [];
      b.colW[colResize.c] = nw;
      refreshBlockCard(b.id);
      return;
    }
    if (rowResize && rowResize.pointerId === e.pointerId) {
      const b = state.byId.get(rowResize.id); if (!b) return;
      const s = state.view.scale || 1;
      const nh = Math.max(16, Math.round(rowResize.startH + (e.clientY - rowResize.startY) / s));
      if (!Array.isArray(b.rowH)) b.rowH = [];
      b.rowH[rowResize.r] = nh;
      refreshBlockCard(b.id);
      return;
    }
    if (gizmo && gizmo.pointerId === e.pointerId) {
      const b = state.byId.get(gizmo.id); if (!b) return;
      const s = state.view.scale || 1;
      if (gizmo.mode === 'box') {
        const dxw = (e.clientX - gizmo.startX) / s, dyw = (e.clientY - gizmo.startY) / s;
        // Only a floor, so a box can never collapse to nothing; no ceiling.
        if (gizmo.edge === 'e') b.w = clamp(Math.round(gizmo.startW + dxw), 8, 200000);
        else if (gizmo.edge === 'w') { const nw = clamp(Math.round(gizmo.startW - dxw), 8, 200000); b.x = gizmo.startBX + (gizmo.startW - nw); b.w = nw; }
        else if (gizmo.edge === 's') b.h = clamp(Math.round(gizmo.startH + dyw), 8, 200000);
        else if (gizmo.edge === 'n') { const nh = clamp(Math.round(gizmo.startH - dyw), 8, 200000); b.y = gizmo.startBY + (gizmo.startH - nh); b.h = nh; }
        const el = state.els[b.id]; if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; }
        refreshBlockCard(b.id);
        drawEdges();
        return;
      }
      if (gizmo.mode === 'resize') {
        if (gizmo.isText) {
          const d = ((e.clientX - gizmo.startX) + (e.clientY - gizmo.startY)) / 2 / s;
          b.size = clamp(Math.round(gizmo.startSize + d * 0.7), 4, 4000);
          // scale the wrap width by the same ratio so proportions stay constant
          if (gizmo.startWrapW) b.w = Math.max(40, Math.round(gizmo.startWrapW * (b.size / (gizmo.startSize || 1))));
          if (textBlock && textBlock.id === b.id) { $('#t-size').value = b.size; $('#t-size-val').value = b.size; }
        } else if (gizmo.isCheck) {
          const d = ((e.clientX - gizmo.startX) + (e.clientY - gizmo.startY)) / 2 / s;
          b.size = clamp(Math.round((gizmo.startSize || 32) + d), 12, 600);
          if (checkBlock && checkBlock.id === b.id) { $('#ck-size').value = b.size; $('#ck-size-val').value = b.size; }
        } else if (gizmo.isImage) {
          const ratio = gizmo.startH / (gizmo.startW || 1);
          b.w = clamp(Math.round(gizmo.startW + (e.clientX - gizmo.startX) / s), 20, 200000);
          b.h = Math.max(20, Math.round(b.w * ratio));   // keep aspect ratio
          if (imageBlock && imageBlock.id === b.id) { const W = $('#i-w'); if (W) { W.value = b.w; $('#i-w-val').value = b.w; } }
        } else if (gizmo.isTable) {
          // corner = scale the whole table: font size + (proportionally) any wrap w/h
          const d = ((e.clientX - gizmo.startX) + (e.clientY - gizmo.startY)) / 2 / s;
          const nf = clamp(Math.round(gizmo.startFont + d * 0.12), 5, 400);
          const ratio = nf / (gizmo.startFont || 13);
          b.fontSize = nf;
          if (gizmo.startWrapW) b.w = Math.max(60, Math.round(gizmo.startWrapW * ratio));
          if (gizmo.startWrapH) b.h = Math.max(40, Math.round(gizmo.startWrapH * ratio));
          if (gizmo.startColW && gizmo.startColW.length) b.colW = gizmo.startColW.map(w => w ? Math.max(20, Math.round(w * ratio)) : w);
          if (gizmo.startRowH && gizmo.startRowH.length) b.rowH = gizmo.startRowH.map(h => h ? Math.max(16, Math.round(h * ratio)) : h);
          if (tableBlock && tableBlock.id === b.id) { $('#tbl-fs').value = b.fontSize; $('#tbl-fs-val').value = b.fontSize; }
        } else {
          b.w = clamp(Math.round(gizmo.startW + (e.clientX - gizmo.startX) / s), 12, 200000);
          b.h = clamp(Math.round(gizmo.startH + (e.clientY - gizmo.startY) / s), 12, 200000);
          if (shapeBlock && shapeBlock.id === b.id) { const W = $('#s-w'), H = $('#s-h'); if (W) { W.value = b.w; $('#s-w-val').value = b.w; } if (H) { H.value = b.h; $('#s-h-val').value = b.h; } }
        }
      } else {
        const ang = Math.atan2(e.clientY - gizmo.cy, e.clientX - gizmo.cx);
        let deg = Math.round(gizmo.startRot + (ang - gizmo.startAngle) * 180 / Math.PI);
        deg = (((deg + 180) % 360) + 360) % 360 - 180;
        b.rot = deg;
        if (textBlock && textBlock.id === b.id) { $('#t-rot').value = deg; $('#t-rot-val').value = deg; }
        if (imageBlock && imageBlock.id === b.id) { $('#i-rot').value = deg; $('#i-rot-val').value = deg; }
        if (shapeBlock && shapeBlock.id === b.id) { $('#s-rot').value = deg; $('#s-rot-val').value = deg; }
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
      const r = stageRect();
      if (pinch.dist) zoomAt(mid.x - r.left, mid.y - r.top, dist / pinch.dist);
      pinch.dist = dist;
      return;
    }

    if (dragging && dragging.pointerId === e.pointerId) {
      const dx = e.clientX - dragging.startX, dy = e.clientY - dragging.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
      if (dragging.shift) return;      // shift = toggle only, don't move
      const s = state.view.scale;
      // one id lookup table for the whole drag: no scan of every block per item per move
      const byId = dragging.byId || (dragging.byId = new Map(state.blocks.map(b => [b.id, b])));
      // smart guides: nudge the drag so edges/centres line up with neighbours
      const adj = alignAdjust(dragging, dx / s, dy / s, byId);
      const lifted = !!(NG.Lift && NG.Lift.has());
      for (const bid of dragging.ids) {
        const st = dragging.starts[bid]; if (!st) continue;
        const bb = byId.get(bid); if (!bb) continue;
        // Handwriting must land exactly where you put it: snapping strokes to
        // the grid pulls the letters of a word apart.
        const fit = bb.kind === 'ink' ? (v) => Math.round(v) : snapVal;
        const nx = fit(st.x + dx / s + adj.dx), ny = fit(st.y + dy / s + adj.dy);
        bb.x = nx; bb.y = ny;
        if (!lifted) { const el = state.els[bid]; if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; } }
      }
      mmDirty = true; mmDirtyAll = true;   // live drag: no committed before/after to diff yet
      if (lifted) {
        NG.Lift.move(dx / s + adj.dx, dy / s + adj.dy);
        if (NG.Overlay) NG.Overlay.setLiftOffset(dx / s + adj.dx, dy / s + adj.dy);
      }
      // the dashed frame and the floating bar travel with what they are round
      if (dragging.frame0) {
        selFrameBox = { x: dragging.frame0.x + dx / s + adj.dx, y: dragging.frame0.y + dy / s + adj.dy,
                        w: dragging.frame0.w, h: dragging.frame0.h };
        positionSelFrame();
      }
      positionSelBar();
      if (dragging.touchesEdge) drawEdges(); else scheduleMinimap();
      return;
    }

    if (panning && e.pointerId === panning.pointerId) {
      if (axisLock !== 'y') state.view.tx = panning.tx + (e.clientX - panning.startX);
      if (axisLock !== 'x') state.view.ty = panning.ty + (e.clientY - panning.startY);
      applyView();
    }
  }

  // Whatever gesture pointer `pid` was driving on its own ends here without
  // being committed: a finger pan, drag or handle the pen took over from, or
  // a pointer whose up was never seen. Anything it moved goes back.
  function abandonPointer(pid) {
    pointers.delete(pid);
    if (pointers.size < 2) { pinch = null; flushInv(); }
    if (panning && panning.pointerId === pid) { stage.classList.remove('panning'); panning = null; }
    if (dragging && dragging.pointerId === pid) {
      for (const bid of dragging.ids) {
        const st = dragging.starts[bid], bb = state.byId.get(bid);
        if (!st || !bb) continue;
        bb.x = st.x; bb.y = st.y;
        const el = state.els[bid]; if (el) { el.style.left = st.x + 'px'; el.style.top = st.y + 'px'; }
      }
      if (NG.Lift && NG.Lift.has()) NG.Lift.end(false);
      state.els[dragging.primary]?.classList.remove('dragging');
      clearGuides(); dragging = null; drawEdges();
    }
    if (gizmo && gizmo.pointerId === pid) {
      const b = state.byId.get(gizmo.id);
      if (b) {
        Object.assign(b, gizmo.before);
        const el = state.els[b.id]; if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; }
        refreshBlockCard(b.id); drawEdges();
      }
      gizmo = null;
    }
    if (colResize && colResize.pointerId === pid) {
      const b = state.byId.get(colResize.id);
      if (b) { b.colW = colResize.before.colW; refreshBlockCard(b.id); }
      colResize = null;
    }
    if (rowResize && rowResize.pointerId === pid) {
      const b = state.byId.get(rowResize.id);
      if (b) { b.rowH = rowResize.before.rowH; refreshBlockCard(b.id); }
      rowResize = null;
    }
    if (marquee && marquee.pointerId === pid) endMarquee();
    if (lpTimer && lpPid === pid) { clearTimeout(lpTimer); lpTimer = null; }
    selFrameBox = null; positionSelFrame(); positionSelBar();
  }
  function endForeignPointer(e) { abandonPointer(e.pointerId); }
  // A drag that ends without a drop (long-press menu, pinch, lost focus):
  // what it moved goes back and the lift container is dissolved.
  function cancelDrag() {
    if (!dragging) return;
    const d = dragging; dragging = null;
    for (const bid of d.ids) {
      const st = d.starts[bid], bb = (d.byId && d.byId.get(bid)) || state.byId.get(bid);
      if (!st || !bb) continue;
      bb.x = st.x; bb.y = st.y;
      const el = state.els[bid]; if (el) { el.style.left = st.x + 'px'; el.style.top = st.y + 'px'; }
    }
    if (NG.Lift && NG.Lift.has()) NG.Lift.end(false);
    state.els[d.primary]?.classList.remove('dragging');
    clearGuides(); selFrameBox = null;
  }

  let lastPointerUpAt = 0;
  async function onPointerUp(e) {
    lastPointerUpAt = performance.now();
    if (NG.Diag) NG.Diag.lastPointerUpAt = lastPointerUpAt;
    // the pointer's own gesture is handled first, whatever else is live
    if (colResize && colResize.pointerId === e.pointerId) {
      const cr = colResize; colResize = null; pointers.delete(e.pointerId);
      const b = state.byId.get(cr.id);
      if (b) {
        b.updatedAt = Date.now();
        recordChange({ blocks: [{ ...cr.before }], edges: [], files: [] }, { blocks: [{ ...b, colW: (b.colW || []).slice() }], edges: [], files: [] });
        await DB.saveBlock(b);
      }
      return;
    }
    if (rowResize && rowResize.pointerId === e.pointerId) {
      const rr = rowResize; rowResize = null; pointers.delete(e.pointerId);
      const b = state.byId.get(rr.id);
      if (b) {
        b.updatedAt = Date.now();
        recordChange({ blocks: [{ ...rr.before }], edges: [], files: [] }, { blocks: [{ ...b, rowH: (b.rowH || []).slice() }], edges: [], files: [] });
        await DB.saveBlock(b);
      }
      return;
    }
    if (erasing && erasing.pointerId === e.pointerId) {
      erasing = null;
      try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
      commitEraseBatch();
      pointers.delete(e.pointerId); return;
    }
    if (lasso && lasso.pointerId === e.pointerId) {
      const shape = lasso; lasso = null;
      shape.path.remove();
      if (shape.erase) { if (shape.pts.length >= 3) eraseInsideLasso(shape.pts); }
      else if (shape.pts.length >= 3) selectInsideLasso(shape.pts);
      else clearSelection();
      return;
    }

    if (inking && inking.pointerId === e.pointerId) {
      const stroke = inking; inking = null;
      try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
      if (stroke.paintRAF) { cancelAnimationFrame(stroke.paintRAF); stroke.paintRAF = 0; }
      // the page changed under the pen (a tap on Home, Back or a crumb): the
      // stroke belongs to the level it started on and is not carried over
      if (stroke.ws !== state.ws || stroke.level !== state.level) { NG.wet.release(stroke); return; }
      const pts = stroke.sampler.toPts();
      if (pts.length >= 2) {
        const hit = shapeSnap ? recognizeShape(pts) : null;
        if (hit) {
          NG.wet.release(stroke);
          createRecognizedShape(hit, stroke.color || penColor, stroke.width || 3);
          toast('Snapped to ' + shapeSnapName(hit));
        } else {
          // The last wet frame is painted from the points the record will
          // hold, so the glass shows exactly what the committed renderer
          // draws; the element is appended now and the wet copy leaves once
          // that frame is on screen (never a gap, never a blank frame).
          const width = stroke.width || curWidth();
          NG.wet.finish(stroke, decodeInk(encodeInk(pts, width)));
          finalizeInk(pts, stroke);          // not awaited: the save lands after
          NG.afterNextPaint(() => NG.wet.release(stroke));
        }
      } else NG.wet.release(stroke);
      return;
    }
    // a stylus gesture (or a table handle) is live and this is not its pointer
    if (inking || erasing || lasso || colResize || rowResize) { endForeignPointer(e); return; }
    if (lpTimer && lpPid === e.pointerId) { clearTimeout(lpTimer); lpTimer = null; }
    if (lpFired && lpPid === e.pointerId) {   // long-press already opened the context menu
      lpFired = false;
      cancelDrag();
      if (panning) { stage.classList.remove('panning'); panning = null; }
      pointers.delete(e.pointerId);
      return;
    }
    if (marquee) {
      if (e.pointerId !== marquee.pointerId) { pointers.delete(e.pointerId); return; }
      const m = marquee; endMarquee();
      if (!m.moved) openContextMenu(e.clientX, e.clientY, m.target ? m.target.dataset.id : null);
      return;
    }
    if (gizmo) {
      if (e.pointerId !== gizmo.pointerId) { endForeignPointer(e); return; }
      const g = gizmo; gizmo = null;      // nothing stays live across the write below
      pointers.delete(e.pointerId);       // release the handle's pointer (else next touch looks like a 2nd finger → pinch)
      if (pointers.size < 2) { pinch = null; flushInv(); }
      const b = state.byId.get(g.id);
      if (b) {
        b.updatedAt = Date.now();
        recordChange({ blocks: [{ ...g.before }], edges: [], files: [] }, { blocks: [{ ...b }], edges: [], files: [] });
        await DB.saveBlock(b);
      }
      return;
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) { pinch = null; flushInv(); }

    if (dragging) {
      if (e.pointerId !== dragging.pointerId) return;
      const d = dragging; dragging = null; selFrameBox = null;   // before any await
      justDragged = d.moved;                           // before any await: the click is next
      setTimeout(() => { justDragged = false; }, 0);
      clearGuides();
      state.els[d.primary]?.classList.remove('dragging');
      if (NG.Lift && NG.Lift.has()) {
        // the lifted elements return to #world; their records already hold the final positions
        for (const it of NG.Lift.end(true)) {
          const bb = (d.byId && d.byId.get(it.id)) || state.byId.get(it.id);
          if (bb) { it.el.style.left = bb.x + 'px'; it.el.style.top = bb.y + 'px'; }
        }
        if (NG.Overlay) NG.Overlay.draw();
      }
      if (d.shift && !d.moved) {
        toggleSelect(d.primary);                 // shift+click toggles
      } else if (d.moved) {
        const before = { blocks: [], edges: [], files: [] };
        const after = { blocks: [], edges: [], files: [] };
        const moved = [];
        for (const bid of d.ids) {
          const bb = state.byId.get(bid);
          if (!bb) continue;
          const st = d.starts[bid];
          bb.updatedAt = Date.now();
          before.blocks.push({ ...bb, x: st.x, y: st.y });
          after.blocks.push({ ...bb });
          moved.push(bb);
        }
        positionSelFrame(); positionSelBar();
        recordChange(before, after);             // in history at once; the writes follow
        await Promise.all(moved.map(bb => DB.saveBlock(bb)));
        return;
      } else {
        selectBlock(d.primary);                  // plain click = single select
      }
      positionSelFrame(); positionSelBar();
      return;
    }
    // a pinch has just ended (or a stray pointer lifted): the frame carried
    // through the gesture is measured afresh
    if (!pinch && !panning && selFrameBox && !selScale) { selFrameBox = null; positionSelFrame(); positionSelBar(); }
    if (panning && e.pointerId === panning.pointerId) {
      stage.classList.remove('panning');
      selFrameBox = null;
      const moved = Math.abs(e.clientX - panning.startX) + Math.abs(e.clientY - panning.startY);
      const inkTap = panning.inkTap, blockTap = panning.blockTap;
      panning = null;
      if (moved < 4 && !state.linkMode) {
        // a drag that started on a stroke (or, for a finger, on any block)
        // panned the page; a tap still picks it up, so it can be moved,
        // opened, restyled or deleted next
        if (inkTap) { closeDrawerIfOpen(); setSelection(withGroups([inkTap])); }
        else if (blockTap) { closeDrawerIfOpen(); selectBlock(blockTap); }
        else { closeDrawerIfOpen(); clearSelection(); }
      }
    }
  }

  /* ---------------------------- marquee select ------------------------- */
  function startMarquee(e) {
    marquee = {
      pointerId: e.pointerId, r: stage.getBoundingClientRect(), sx: e.clientX, sy: e.clientY,
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
      const rect = blockRectOf(b);
      if (rect.x < p2.x && rect.x + rect.w > p1.x && rect.y < p2.y && rect.y + rect.h > p1.y) hit.push(b.id);
    }
    // only rebuild the selection classes when the hit set actually changed
    const next = withGroups([...marquee.base, ...hit]);
    const cur = state.selectedIds;
    if (next.length === cur.size && next.every(id => cur.has(id))) return;
    state.selectedIds = new Set(next);
    applySelectionClasses();
  }
  function endMarquee() { $('#marquee').hidden = true; marquee = null; }

  // A panel that is put away must not keep the keyboard: a field left focused
  // inside it makes every shortcut think the user is typing.
  function blurPanelField() {
    const a = document.activeElement;
    if (a && a.closest && a.closest('.drawer, .modal, #pen-bar, #props, #prompt')) { try { a.blur(); } catch (_) {} }
  }
  function closeDrawerIfOpen() {
    if (!$('#drawer').hidden) closeDrawer();
    if (!$('#text-drawer').hidden) closeTextEditor();
    if (!$('#shape-drawer').hidden) closeShapeEditor();
    if (!$('#image-drawer').hidden) closeImageEditor();
    if (!$('#ink-drawer').hidden) closeInkEditor();
    if (!$('#check-drawer').hidden) closeCheckEditor();
    if (!$('#table-drawer').hidden || editTableId) closeTableEditor();   // also exits drawer-less cell mode
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
      const b = state.byId.get(targetId);
      const many = state.selectedIds.size > 1;
      const openable = opensInside(b);
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
        { icon: b && b.locked ? 'unlock' : 'lock', label: (b && b.locked) ? 'Unlock' : 'Lock', fn: () => toggleLock([...state.selectedIds]) },
        { icon: 'copy', label: 'Duplicate', fn: () => duplicateSelection() },
        { sep: true },
        { icon: 'trash', label: many ? `Delete ${state.selectedIds.size}` : 'Delete', fn: () => deleteSelected(), danger: true },
      );
    } else {
      clearSelection();
      items = [
        { icon: 'download', label: 'Paste', fn: () => pasteClipboard() },
        { icon: 'frame', label: 'Fit to view', fn: () => fitToView() },
        { sep: true },
        { icon: 'map', label: 'Mini-map: ' + (minimapOn ? 'on' : 'off'), fn: () => toggleMinimap() },
        { icon: 'lock', label: 'Lock to horizontal: ' + (axisLock === 'x' ? 'on' : 'off'), fn: () => setAxisLock(axisLock === 'x' ? null : 'x') },
        { icon: 'lock', label: 'Lock to vertical: ' + (axisLock === 'y' ? 'on' : 'off'), fn: () => setAxisLock(axisLock === 'y' ? null : 'y') },
        { icon: 'frame', label: 'Snap to grid: ' + (snapOn ? 'on' : 'off'), fn: () => { snapOn = !snapOn; try { localStorage.setItem('ng-snap', snapOn ? '1' : '0'); } catch (_) {} updateSnapLabel(); toast(snapOn ? 'Snap on' : 'Snap off'); } },
        { icon: 'upload', label: 'Autosave: ' + ($('#autosave') && $('#autosave').checked ? 'on' : 'off'), fn: () => { const cb = $('#autosave'); if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); toast(cb.checked ? 'Autosave on' : 'Autosave off'); } updateMenuStates(); } },
        { sep: true },
        { icon: 'sliders', label: 'Workspace properties', fn: () => openProperties(state.ws) },
        { icon: 'info', label: 'About', fn: () => openAbout('about') },
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

  /* ---------------------------- command palette (Ctrl+K) --------------- */
  let cmdItems = [], cmdActive = 0;
  function cmdCommands() {
    const inWs = state.ws != null;
    const list = [];
    if (inWs) {
      list.push(
        { g: 'Create', icon: 'plus', title: 'Add block', fn: () => createBlock('block') },
        { g: 'Create', icon: 'list', title: 'Add list', fn: () => createBlock('list') },
        { g: 'Create', icon: 'type', title: 'Add text', fn: () => createBlock('text') },
        { g: 'Create', icon: 'shapes', title: 'Add shape', fn: () => createBlock('shape') },
        { g: 'Create', icon: 'image', title: 'Add image', fn: () => pickImage() },
        { g: 'Create', icon: 'upload', title: 'Import text file', fn: () => pickTextFile() },
        { g: 'View', icon: 'frame', title: 'Fit to view', fn: () => fitToView() },
        { g: 'View', icon: 'home', title: 'Workspace home (root)', fn: () => navigateTo(DB.ROOT) },
        { g: 'Edit', icon: 'arrow-left', title: 'Undo', fn: () => undo() },
        { g: 'Edit', icon: 'arrow-right', title: 'Redo', fn: () => redo() },
        { g: 'Workspace', icon: 'upload', title: 'Export workspace', fn: () => exportWorkspaceFlow(state.ws) },
        { g: 'Workspace', icon: 'info', title: 'Diagnostics', fn: () => { if (NG.Diag) NG.Diag.toggle(); } },
        { g: 'Style', icon: 'copy', title: 'Copy look (Ctrl+Alt+C)', fn: () => copyStyle() },
        { g: 'Style', icon: 'brush', title: 'Paste look (Ctrl+Alt+V)', fn: () => pasteStyle() },
        { g: 'Arrange', icon: 'group', title: 'Group selection', fn: () => groupSelection() },
        { g: 'Arrange', icon: 'ungroup', title: 'Ungroup selection', fn: () => ungroupSelection() },
        { g: 'Arrange', icon: 'align-left', title: 'Align left', fn: () => alignSelection('left') },
        { g: 'Arrange', icon: 'align-center', title: 'Align centres', fn: () => alignSelection('center') },
        { g: 'Arrange', icon: 'align-right', title: 'Align right', fn: () => alignSelection('right') },
        { g: 'Arrange', icon: 'align-top', title: 'Align top', fn: () => alignSelection('top') },
        { g: 'Arrange', icon: 'align-middle', title: 'Align middles', fn: () => alignSelection('middle') },
        { g: 'Arrange', icon: 'align-bottom', title: 'Align bottom', fn: () => alignSelection('bottom') },
        { g: 'Arrange', icon: 'dist-h', title: 'Space evenly across', fn: () => alignSelection('dist-h') },
        { g: 'Arrange', icon: 'dist-v', title: 'Space evenly down', fn: () => alignSelection('dist-v') },
        { g: 'View', icon: 'eye', title: 'Read mode', fn: () => setReadMode(!state.readOnly) },
        { g: 'View', icon: 'expand', title: 'Full screen (F11)', fn: () => toggleFullscreen() },
        { g: 'View', icon: 'map', title: 'Mini-map: ' + (minimapOn ? 'on → turn off' : 'off → turn on'), fn: () => toggleMinimap() },
        { g: 'View', icon: 'lock', title: 'Lock panning to horizontal', fn: () => setAxisLock(axisLock === 'x' ? null : 'x') },
        { g: 'View', icon: 'lock', title: 'Lock panning to vertical', fn: () => setAxisLock(axisLock === 'y' ? null : 'y') },
        { g: 'View', icon: 'list', title: 'Outline sidebar (O)', fn: () => toggleOutline() },
        { g: 'Arrange', icon: 'frame', title: 'Tidy this level', fn: () => tidyLevel() },
        { g: 'View', icon: 'external', title: 'Present', fn: () => startPresenting() },
        { g: 'Workspace', icon: 'image', title: 'Export this level as PNG', fn: () => exportLevelImage('png') },
        { g: 'Workspace', icon: 'shapes', title: 'Export this level as SVG', fn: () => exportLevelImage('svg') },
        { g: 'Workspace', icon: 'filetext', title: 'Export as PDF', fn: () => exportWorkspacePdfFlow(state.ws) },
        { g: 'Ink', icon: 'type', title: 'Convert handwriting to text', fn: () => convertInkToText() },
        { g: 'Workspace', icon: 'sliders', title: 'Workspace properties', fn: () => openProperties(state.ws) },
        { g: 'Workspace', icon: 'frame', title: 'Snap to grid: ' + (snapOn ? 'on → turn off' : 'off → turn on'), fn: () => { snapOn = !snapOn; try { localStorage.setItem('ng-snap', snapOn ? '1' : '0'); } catch (_) {} updateSnapLabel(); toast(snapOn ? 'Snap on' : 'Snap off'); } },
      );
    }
    list.push(
      { g: 'Workspace', icon: 'plus', title: 'New workspace', fn: () => newWorkspaceFlow() },
      { g: 'Workspace', icon: 'download', title: 'Import workspace', fn: () => importViaPicker() },
      { g: 'Workspace', icon: 'diary', title: 'All workspaces', fn: () => goHome() },
      { g: 'App', icon: 'moon', title: 'Toggle light / dark', fn: () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark') },
      { g: 'App', icon: 'help', title: 'Help', fn: () => openAbout('help') },
      { g: 'App', icon: 'info', title: 'About', fn: () => openAbout('about') },
    );
    return list;
  }
  // The palette searches the whole workspace (so you can jump to a block on
  // another page), not just what is loaded on screen - but the workspace
  // does not change while you are typing one query, so fetch it once per
  // open instead of on every keystroke.
  let cmdBlocksCache = { ws: null, blocks: null };
  async function cmdRender(q) {
    const ql = (q || '').toLowerCase().trim();
    const cmds = cmdCommands().filter(c => !ql || c.title.toLowerCase().includes(ql));
    let blockHits = [];
    if (ql && state.ws != null) {
      if (cmdBlocksCache.ws !== state.ws) cmdBlocksCache = { ws: state.ws, blocks: await DB.allByWs('blocks', state.ws) };
      const blocks = cmdBlocksCache.blocks;
      blockHits = blocks.filter(b => {
        const label = b.kind === 'text' ? (b.text || '') : (b.title || '');
        return label.toLowerCase().includes(ql) || (b.notes || '').toLowerCase().includes(ql) || (b.tags || '').toLowerCase().includes(ql);
      }).slice(0, 8).map(b => ({
        g: 'Jump to block', mono: monogram(b.kind === 'text' ? (b.text || 'T') : b.title),
        color: b.color || PALETTE[0], title: (b.kind === 'text' ? (b.text || 'Text') : (b.title || 'Untitled')).slice(0, 60),
        sub: b.tags ? '# ' + b.tags : '', fn: () => goToBlock(b),
      }));
    }
    cmdItems = [...cmds, ...blockHits];
    cmdActive = 0;
    const listEl = $('#cmdk-list');
    if (!cmdItems.length) { listEl.innerHTML = '<div class="cmdk-empty">No matches</div>'; return; }
    let html = '', lastG = null;
    cmdItems.forEach((it, i) => {
      if (it.g !== lastG) { html += `<div class="cmdk-group">${esc(it.g)}</div>`; lastG = it.g; }
      const ico = it.mono
        ? `<span class="cmdk-mono" style="background:${esc(it.color)}">${esc(it.mono)}</span>`
        : `<span>${ic(it.icon || 'plus')}</span>`;
      html += `<div class="cmdk-item${i === 0 ? ' active' : ''}" data-i="${i}">${ico}` +
        `<span class="cmdk-main"><div class="cmdk-title">${esc(it.title)}</div>${it.sub ? `<div class="cmdk-sub">${esc(it.sub)}</div>` : ''}</span></div>`;
    });
    listEl.innerHTML = html;
  }
  function cmdSetActive(i) {
    const items = $$('#cmdk-list .cmdk-item');
    if (!items.length) return;
    cmdActive = (i + items.length) % items.length;
    items.forEach((el, j) => el.classList.toggle('active', j === cmdActive));
    items[cmdActive].scrollIntoView({ block: 'nearest' });
  }
  function cmdRun(i) {
    const it = cmdItems[i]; if (!it) return;
    closeCmdk();
    setTimeout(() => it.fn(), 0);
  }
  function openCmdk() {
    $('#menu').hidden = true; $('#add-menu').hidden = true; hideCtxMenu();
    $('#cmdk').hidden = false;
    cmdBlocksCache = { ws: null, blocks: null };   // a fresh open should see edits made since the last one
    const inp = $('#cmdk-input'); inp.value = '';
    cmdRender('');
    setTimeout(() => inp.focus(), 30);
  }
  function closeCmdk() { $('#cmdk').hidden = true; }
  function bindCmdk() {
    const inp = $('#cmdk-input');
    inp.addEventListener('input', () => cmdRender(inp.value));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); cmdSetActive(cmdActive + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cmdSetActive(cmdActive - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); cmdRun(cmdActive); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCmdk(); }
    });
    $('#cmdk-list').addEventListener('click', (e) => {
      const item = e.target.closest('.cmdk-item'); if (!item) return;
      cmdRun(parseInt(item.dataset.i, 10));
    });
    $('#cmdk').addEventListener('mousedown', (e) => { if (e.target.id === 'cmdk') closeCmdk(); });
  }

  let wheelFrameTimer = null;
  function onWheel(e) {
    if (state.levelLayout === 'list') return;   // let the list scroll
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    // a burst of wheel steps carries the selection frame instead of measuring
    // every selected element per step; measured afresh once the burst ends
    if (selFrameBox == null && !dragging && !selScale && state.selectedIds.size) selFrameBox = selectionWorldBox();
    clearTimeout(wheelFrameTimer);
    wheelFrameTimer = setTimeout(() => {
      wheelFrameTimer = null;
      if (!dragging && !panning && !pinch && !selScale) { selFrameBox = null; positionSelFrame(); positionSelBar(); }
    }, 150);
    let factor;
    if (e.ctrlKey) {
      // touchpad pinch: browsers deliver it as ctrl+wheel with small fractional
      // deltas — scale smoothly by magnitude instead of a fixed step
      factor = clamp(Math.exp(-e.deltaY * 0.012), 0.6, 1.7);
    } else {
      factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    }
    zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
  }

  function onDblClick(e) {
    if (state.levelLayout === 'list') return;   // handled by list-view
    if (state.readOnly) {                       // look, step in, change nothing
      const el = e.target.closest('.block');
      const b = el && state.byId.get(el.dataset.id);
      if (opensInside(b)) navigateTo(b.id);
      return;
    }
    // while drawing, a stylus double-tap is just two dots of ink
    if ((state.penMode || state.penEraser) && lastPointerType === 'pen') return;
    if (e.target.closest('[data-blk]')) return; // action buttons, not "open"
    const blockEl = topElAt(e.clientX, e.clientY, e.target.closest('.block'));
    if (blockEl) {
      const b = state.byId.get(blockEl.dataset.id);
      if (b && b.kind === 'text') openTextEditor(b.id);
      else if (b && b.kind === 'shape') openShapeEditor(b.id);
      else if (b && b.kind === 'image') openImageEditor(b.id);
      else if (b && b.kind === 'check') openCheckEditor(b.id);
      else if (b && b.kind === 'ink') openInkEditor(b.id);
      else if (b && b.kind === 'table') {
        const cell = e.target.closest('.data-table [data-r]');
        const titleHit = e.target.closest('.table-title');
        if (editTableId !== b.id) enterTableCells(b.id);   // inline edit, no drawer
        if (cell) { focusCell(b.id, +cell.dataset.r, +cell.dataset.c, false); beginEdit(null); }
        else if (titleHit) { beginTitleEdit(); }
      }
      else navigateTo(blockEl.dataset.id);
      return;
    }
    // empty canvas: nothing - new blocks come from the Add button
  }

  // canvas hover-action buttons (edit / open) fire as native clicks
  function onStageClick(e) {
    const link = e.target.closest('.md-link');
    if (link && link.dataset.href) { e.preventDefault(); e.stopPropagation(); window.open(link.dataset.href, '_blank', 'noopener'); return; }
    const tag = e.target.closest('.tag-chip');
    if (tag) { e.stopPropagation(); setTagFilter(tag.dataset.tag); return; }
    const face = e.target.closest('.block-check .check-face');
    if (face && !justDragged && !state.readOnly && !state.penMode && !state.penEraser && !state.selectTool) {
      const blk = face.closest('.block');
      toggleCheck(blk.dataset.id);
      return;
    }
    const btn = e.target.closest('[data-blk]');
    if (!btn) return;
    const blk = btn.closest('.block');
    if (!blk) return;
    if (btn.dataset.blk === 'edit') openAnyEditor(blk.dataset.id);
    else navigateTo(blk.dataset.id);
  }
  let justDragged = false;                    // the click after a drag is not a tap
  async function toggleCheck(id) {
    const b = state.byId.get(id); if (!b || b.kind !== 'check' || b.locked) return;
    const before = { ...b };
    b.checked = !b.checked; b.updatedAt = Date.now();
    refreshBlockCard(id);
    await DB.saveBlock(b);
    recordChange({ blocks: [before], edges: [], files: [] }, { blocks: [{ ...b }], edges: [], files: [] });
    if (checkBlock && checkBlock.id === id) $('#ck-checked').checked = b.checked;
  }

  /* ---------------------------- tag filter ----------------------------- */
  function setTagFilter(tag) {
    state.tagFilter = (state.tagFilter === tag) ? null : tag;
    applyTagFilter();
  }
  function applyTagFilter() {
    const tag = state.tagFilter;
    $('#tag-filter').hidden = !tag;
    if (tag) $('#tag-filter-name').textContent = '#' + tag;
    for (const b of state.blocks) {
      const el = state.els[b.id]; if (!el) continue;
      const match = !tag || parseTags(b.tags).includes(tag);
      el.classList.toggle('dim', !!tag && !match);
    }
  }

  /* ---------------------------- freehand pen --------------------------- */
  /* ------------------------------ tools --------------------------------- *
   * Draw, Eraser and Select are one-at-a-time: switching one on puts the
   * others away. The eraser works on its own or with the draw panel open,
   * and never opens the panel by itself.                                    */
  function setPenMode(on) {
    on = !!on;
    if (on && state.readOnly) { toast('Read mode is on.'); return; }
    if (on && (state.ws == null || state.levelLayout !== 'canvas')) return;
    state.penMode = on;
    stage.classList.toggle('penning', on);
    notifyInking();
    $('#pen-bar').hidden = !on;
    if (on) {
      setLinkMode(false); closeDrawerIfOpen(); clearSelection();
      if (state.selectTool) setSelectMode(false);
      if (state.penEraser) setEraser(false, true);       // the panel opens on the pen
      renderPenTools(); renderPenColors(); syncPenSize(); updatePenTouchBtn();
      updateShapeSnapBtn(); loadPenBarPos();
      requestAnimationFrame(sizeInkSurface);            // surface ready before the first mark
    } else {
      closePenMenu();
      if (state.penEraser) setEraser(false, true);       // Done means done
    }
    syncToolButtons();
  }
  // the Android host raises the refresh rate while a stylus tool is up
  function notifyInking() {
    try { if (window.NGShell && NGShell.setInking) NGShell.setInking(!!(state.penMode || state.penEraser)); } catch (_) {}
  }
  function syncToolButtons() {
    $('#btn-pen')?.classList.toggle('active', state.penMode && !state.penEraser);
    $('#btn-eraser')?.classList.toggle('active', state.penEraser);
    $('#btn-select')?.classList.toggle('active', state.selectTool);
  }
  // The pen button: with the eraser up it means "back to the pen", otherwise
  // it opens or closes the draw panel.
  function penButton() {
    if (state.penEraser) { if (state.penMode) setEraser(false); else setPenMode(true); return; }
    setPenMode(!state.penMode);
  }
  // Doing something else (adding a block, opening a menu, stepping into a
  // block) puts the pen / eraser / lasso away, so they never linger.
  function dropActiveTools(why) {
    let dropped = false;
    if (state.penMode) { setPenMode(false); dropped = true; }
    if (state.penEraser) { setEraser(false, true); dropped = true; }
    if (state.selectTool) { setSelectMode(false); dropped = true; }
    if (state.linkMode) { setLinkMode(false); dropped = true; }
    if (dropped && why) toast(why);
  }

  // A freehand loop is drawn by the Select tool, or by the eraser in its
  // "erase what I circle" mode.
  const eraseLasso = () => state.penEraser && eraserMode === 'lasso';
  const lassoActive = () => state.selectTool || eraseLasso();

  // Toolbar Select tool: circle things on the canvas to pick them up.
  function setSelectMode(on) {
    on = !!on;
    if (on && state.readOnly) { toast('Read mode is on.'); return; }
    if (on) {                                            // one tool at a time
      if (state.penMode) setPenMode(false);
      if (state.penEraser) setEraser(false, true);
      setLinkMode(false);
    }
    state.selectTool = on;
    stage.classList.toggle('lassoing', on);
    if (!on) setLassoMode('replace');
    if (!on && lasso && !lasso.erase) { lasso.path.remove(); lasso = null; }
    if (on) toast('Select: circle anything with the stylus to pick it up');
    syncSelectionButtons(); positionSelBar(); positionSelFrame(); syncToolButtons();
  }

  /* ------------------------------ eraser -------------------------------- *
   * Three erasers, picked from the dots on the eraser button:
   *   normal - rubs out just the part of a stroke swept over, splitting it
   *   stroke - removes a whole stroke at a touch
   *   lasso  - removes every stroke inside a drawn loop
   * A finger pans while the stylus erases, by the same rule as the pen.     */
  const ERASER_MODES = {
    normal: { label: 'Eraser',               hint: 'rubs out what you sweep over', icon: 'eraser' },
    stroke: { label: 'Stroke eraser',        hint: 'removes a whole stroke',       icon: 'eraser-stroke' },
    lasso:  { label: 'Erase with selection', hint: 'circle what to remove',        icon: 'eraser-lasso' },
  };
  let eraserMode = 'normal', eraserSize = 24;
  // Which eraser is up. The toolbar eraser takes anything it touches: strokes,
  // blocks, shapes, text, images and connectors. The eraser inside the draw
  // panel erases handwriting only. Both share the three modes above.
  let eraserScope = 'ink';
  const eraserHint = () => (eraserScope === 'all'
    ? { normal: 'rubs out anything you sweep over', stroke: 'removes a whole stroke or object', lasso: 'circle what to remove' }
    : { normal: 'rubs out the ink you sweep over', stroke: 'removes a whole stroke', lasso: 'circle the strokes to remove' })[eraserMode];
  try {
    const m = localStorage.getItem('ng-eraser-mode'); if (m && ERASER_MODES[m]) eraserMode = m;
    const z = +(localStorage.getItem('ng-eraser-size')); if (z >= 1 && z <= 100) eraserSize = z;
  } catch (_) {}
  const eraserRadiusPx = () => 3 + eraserSize * 0.35;          // on screen, so zoom does not change the feel

  // scope: 'all' (the toolbar eraser) or 'ink' (the draw panel's); when not
  // given, the eraser is ink-only while the draw panel is open
  function setEraser(on, quiet, scope) {
    on = !!on;
    if (on && state.readOnly) { toast('Read mode is on.'); return; }
    if (on && (state.ws == null || state.levelLayout !== 'canvas')) return;
    const was = state.penEraser, wasScope = eraserScope;
    if (on) eraserScope = scope || (state.penMode ? 'ink' : 'all');
    state.penEraser = on;
    if (on) { if (state.selectTool) setSelectMode(false); setLinkMode(false); }
    stage.classList.toggle('erasing', on);
    stage.classList.toggle('erase-all', on && eraserScope === 'all');
    notifyInking();
    stage.classList.toggle('erase-normal', on && eraserMode === 'normal');
    if (!on) { hideEraserCursor(); if (lasso && lasso.erase) { lasso.path.remove(); lasso = null; } }
    renderPenTools(); syncPenSize(); syncToolButtons();
    if (!quiet && (was !== on || (on && wasScope !== eraserScope))) {
      toast(on ? ERASER_MODES[eraserMode].label + ' \u2014 ' + eraserHint()
               : (state.penMode ? 'Back to the pen' : 'Eraser off'));
    }
  }
  function setEraserMode(m) {
    if (!ERASER_MODES[m]) return;
    eraserMode = m;
    try { localStorage.setItem('ng-eraser-mode', m); } catch (_) {}
    if (lasso && lasso.erase) { lasso.path.remove(); lasso = null; }
    if (!state.penEraser) { setEraser(true); return; }
    stage.classList.toggle('erase-normal', m === 'normal');
    renderPenTools(); syncPenSize();
    toast(ERASER_MODES[m].label + ' \u2014 ' + eraserHint());
  }
  function showEraserCursor(x, y) {
    const c = $('#eraser-cursor'); if (!c) return;
    const d = Math.round(eraserRadiusPx() * 2);
    c.hidden = false; c.style.width = c.style.height = d + 'px';
    c.classList.toggle('all', eraserScope === 'all');
    c.style.left = x + 'px'; c.style.top = y + 'px';
  }
  function hideEraserCursor() { const c = $('#eraser-cursor'); if (c) c.hidden = true; }

  // Everything one eraser gesture removes or creates is one undo entry.
  let eraseBatch = null;
  function beginEraseBatch() { if (!eraseBatch) eraseBatch = { removed: [], added: new Map(), edges: [], boxes: new Map() }; }
  function commitEraseBatch() {
    if (!eraseBatch) return;
    const { removed, added, edges: cut } = eraseBatch; eraseBatch = null;
    const after = [...added.values()];
    if (!removed.length && !after.length && !cut.length) return;
    const level = state.level;
    // connectors the eraser took directly, plus those touching an erased
    // block or stroke (a picked-up stroke can be linked)
    const gone = new Set(removed.map(b => b.id));
    const edges = cut.slice();
    for (const ed of state.edges) if ((gone.has(ed.from) || gone.has(ed.to)) && !edges.some(k => k.id === ed.id)) edges.push(ed);
    if (edges.length) {
      const eids = new Set(edges.map(ed => ed.id));
      state.edges = state.edges.filter(ed => !eids.has(ed.id));
      drawEdges();
    }
    // a stroke that was opened and given contents keeps the deep delete
    const plain = removed.filter(b => !b.__deps), deep = removed.filter(b => b.__deps);
    removed.forEach(b => { delete b.__deps; });
    const gen = history.gen;
    const heavy = removed.some(b => b.kind !== 'ink');
    return afterInkWrites(async () => {
      if (heavy) await flushPendingSaves();          // no late panel write brings an erased block back
      await Promise.all([
        ...plain.map(b => DB.del('blocks', b.id)),
        ...after.map(b => DB.saveBlock(b)),
        ...edges.map(ed => DB.delEdge(ed.id)),
      ]);
      const extra = { blocks: [], edges: [], files: [] };
      for (const b of deep) {
        const r = await gatherRemoval([b.id]);
        extra.blocks.push(...r.blocks.filter(x => x.id !== b.id));
        extra.files.push(...r.files);
        extra.edges.push(...r.edges.filter(ed => !edges.some(k => k.id === ed.id)));
        await DB.deleteBlockDeep(b.id);
      }
      if (history.gen !== gen) return;
      recordChange({ blocks: [...removed, ...extra.blocks], edges: [...edges.map(ed => ({ ...ed })), ...extra.edges], files: extra.files },
                   { blocks: after, edges: [], files: [] }, level);
    });
  }
  // Take a stroke (or, for the toolbar eraser, any block) off the page
  // (DOM + state), remembering it for undo.
  function removeInkBlock(b) {
    beginEraseBatch();
    if (eraseBatch.added.has(b.id)) eraseBatch.added.delete(b.id);   // born and gone in one gesture
    else { const c = state.childCounts[b.id]; eraseBatch.removed.push({ ...b, __deps: !c || !!(c.blocks || c.files) }); }
    if (b.kind !== 'ink') closeEditorsFor(b.id);
    if (b.kind === 'ink') planesRemove(b.id);
    state.blocks = state.blocks.filter(x => x.id !== b.id);
    state.byId.delete(b.id);
    const wasSel = state.selectedIds.delete(b.id);
    const el = state.els[b.id]; if (el) el.remove();
    untrackSize(b.id);
    delete state.els[b.id]; delete state.childCounts[b.id]; if (state.childPeek) delete state.childPeek[b.id];
    if (wasSel) applySelectionClasses();
  }
  // A connector the eraser took on its own.
  function removeEdgeByEraser(ed) {
    beginEraseBatch();
    if (eraseBatch.edges.some(x => x.id === ed.id)) return;
    eraseBatch.edges.push({ ...ed });
    state.edges = state.edges.filter(x => x.id !== ed.id);
    drawEdges();
  }
  // An erased block that was open in a side panel: shut the panel first.
  function closeEditorsFor(id) {
    const open = [textBlock, shapeBlock, imageBlock, checkBlock, inkBlock, drawerBlock].some(x => x && x.id === id)
      || (typeof editTableId !== 'undefined' && editTableId === id);
    if (open) closeOtherEditors();
  }
  // A block's box in world units, measured once per eraser gesture.
  function eraseBoxOf(b) {
    let r = eraseBatch.boxes.get(b.id);
    if (!r) { const bb = blockBox(b); r = { x: bb.x, y: bb.y, w: bb.w, h: bb.h, cx: bb.x + bb.w / 2, cy: bb.y + bb.h / 2 }; eraseBatch.boxes.set(b.id, r); }
    return r;
  }
  // Does the sweep from (x0,y0) to (x1,y1), R wide, touch the rectangle?
  function sweepHitsRect(x0, y0, x1, y1, r, R) {
    const n = Math.min(32, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, R)) + 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      if (px >= r.x - R && px <= r.x + r.w + R && py >= r.y - R && py <= r.y + r.h + R) return true;
    }
    return false;
  }
  // The connector's line as world points, the geometry drawEdges draws
  // (the "curve" style is a quadratic through the midpoint: a straight line).
  function edgePolyline(ra, rb, style) {
    const p1 = borderPoint(ra, rb), p2 = borderPoint(rb, ra);
    if (style === 'elbow') { const mx = (p1.x + p2.x) / 2; return [[p1.x, p1.y], [mx, p1.y], [mx, p2.y], [p2.x, p2.y]]; }
    return [[p1.x, p1.y], [p2.x, p2.y]];
  }
  const segSegDist = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const cr = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
    const d1 = cr(cx, cy, dx, dy, ax, ay), d2 = cr(cx, cy, dx, dy, bx, by), d3 = cr(ax, ay, bx, by, cx, cy), d4 = cr(ax, ay, bx, by, dx, dy);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
    return Math.min(distToSeg(ax, ay, cx, cy, dx, dy), distToSeg(bx, by, cx, cy, dx, dy),
                    distToSeg(cx, cy, ax, ay, bx, by), distToSeg(dx, dy, ax, ay, bx, by));
  };
  // The toolbar eraser's extra reach: blocks and connectors under the sweep.
  function eraseObjectsAlong(x0, y0, x1, y1, R, sx, sy, ex, ey) {
    beginEraseBatch();
    for (const b of state.blocks.slice()) {
      if (b.kind === 'ink' || b.parentId !== state.level || b.locked) continue;
      const r = eraseBoxOf(b);
      if (r.x - R > ex || r.y - R > ey || r.x + r.w + R < sx || r.y + r.h + R < sy) continue;   // nowhere near
      if (sweepHitsRect(x0, y0, x1, y1, r, R)) removeInkBlock(b);
    }
    for (const ed of state.edges.slice()) {
      const a = state.byId.get(ed.from), b = state.byId.get(ed.to);
      if (!a || !b) continue;
      const pts = edgePolyline(eraseBoxOf(a), eraseBoxOf(b), ed.style);
      for (let i = 1; i < pts.length; i++) {
        if (segSegDist(x0, y0, x1, y1, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= R + 3) { removeEdgeByEraser(ed); break; }
      }
    }
  }
  function addInkBlock(nb) {
    beginEraseBatch();
    eraseBatch.added.set(nb.id, nb);
    state.blocks.push(nb);
    state.byId.set(nb.id, nb);
    state.childCounts[nb.id] = { blocks: 0, files: 0 };
    world.appendChild(makeBlockEl(nb));
    planesAdd(nb);
  }
  // whole-stroke eraser: whatever stroke is under the point goes
  function eraseStrokeAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !el.closest) return;
    if (eraserScope === 'all') {                       // the toolbar eraser: whatever object is under the point
      const g = el.closest('g.edge-g');
      if (g) { const ed = state.edges.find(x => x.id === g.dataset.id); if (ed) removeEdgeByEraser(ed); return; }
      const b = topBlockAt(clientX, clientY, el.closest('.block'));
      if (b && !b.locked) removeInkBlock(b);
      return;
    }
    const node = el.closest('.block-ink') || inkElAt(clientX, clientY);
    if (!node) return;
    const b = state.byId.get(node.dataset.id);
    if (!b || b.kind !== 'ink' || b.locked) return;
    removeInkBlock(b);
  }
  // A stroke's points in world units (they are stored relative to its box).
  const inkPad = (b) => (b.width || 3) + 2;
  // A stroke's element box, from its record alone (what getBoundingClientRect
  // measured before): no layout read per stroke.
  const inkBox = (b) => { const pad = inkPad(b); return { x: b.x || 0, y: b.y || 0, w: (b.w || 1) + 2 * pad, h: (b.h || 1) + 2 * pad }; };
  function inkWorldPts(b) {
    const pad = inkPad(b), ox = (b.x || 0) + pad, oy = (b.y || 0) + pad;
    return (b.pts || []).map(p => [ox + p[0], oy + p[1], p[2] || 0, p[3] || 0]);
  }
  // A new stroke with the same look as `src`, from world-space points.
  function inkFromWorldPts(src, pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const width = src.width || 3;
    const bx = Math.round(minX - width - 2), by = Math.round(minY - width - 2);
    const ox = bx + width + 2, oy = by + width + 2;
    const rel = pts.map(([x, y, pr, k]) => {
      const q = [Math.round((x - ox) * 20) / 20, Math.round((y - oy) * 20) / 20];
      if (pr || k) q.push(Math.round((pr || 0) * 100) / 100);
      if (k) q.push(Math.round(k * 1000) / 1000);
      return q;
    });
    return { ...src, id: uid(), pts: rel, w: Math.round(maxX - ox), h: Math.round(maxY - oy),
      x: bx, y: by, createdAt: Date.now(), updatedAt: Date.now() };
  }
  const distToSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  // Rub out whatever lies under the eraser's sweep from (x0,y0) to (x1,y1),
  // all in world units. A stroke cut in the middle becomes two strokes.
  function eraseSweep(x0, y0, x1, y1, R) {
    const sx = Math.min(x0, x1) - R, sy = Math.min(y0, y1) - R, ex = Math.max(x0, x1) + R, ey = Math.max(y0, y1) + R;
    for (const b of state.blocks.slice()) {
      if (b.kind !== 'ink' || b.parentId !== state.level || b.locked) continue;
      const pad = inkPad(b), bw = (b.w || 0) + pad * 2, bh = (b.h || 0) + pad * 2;
      if (b.x > ex || b.y > ey || b.x + bw < sx || b.y + bh < sy) continue;     // nowhere near
      const thr = R + (b.width || 3) / 2;
      // densify, so a quick sweep cannot slip between two samples of a stroke
      const src = inkWorldPts(b), pts = [];
      for (let i = 0; i < src.length; i++) {
        pts.push(src[i]);
        const nx = src[i + 1]; if (!nx) break;
        const d = Math.hypot(nx[0] - src[i][0], nx[1] - src[i][1]);
        const steps = Math.min(40, Math.floor(d / Math.max(2, R)));
        for (let k = 1; k <= steps; k++) {
          const t = k / (steps + 1);
          pts.push([src[i][0] + (nx[0] - src[i][0]) * t, src[i][1] + (nx[1] - src[i][1]) * t,
                    src[i][2] + (nx[2] - src[i][2]) * t, src[i][3] + (nx[3] - src[i][3]) * t]);
        }
      }
      let hit = false;
      const keep = pts.map(q => { const k = distToSeg(q[0], q[1], x0, y0, x1, y1) > thr; if (!k) hit = true; return k; });
      if (!hit) continue;
      const runs = []; let run = [];
      pts.forEach((q, i) => { if (keep[i]) run.push(q); else { if (run.length > 1) runs.push(run); run = []; } });
      if (run.length > 1) runs.push(run);
      removeInkBlock(b);
      for (const r of runs) addInkBlock(inkFromWorldPts(b, r));
    }
    if (eraserScope === 'all') eraseObjectsAlong(x0, y0, x1, y1, R, sx, sy, ex, ey);
  }
  function eraseSweepAt(cx0, cy0, cx1, cy1) {
    const r = stageRect();
    const a = screenToWorld(cx0 - r.left, cy0 - r.top), z = screenToWorld(cx1 - r.left, cy1 - r.top);
    eraseSweep(a.x, a.y, z.x, z.y, eraserRadiusPx() / (state.view.scale || 1));
  }
  // erase with selection: a stroke goes when most of it lies inside the loop
  function eraseInsideLasso(poly) {
    beginEraseBatch();
    let n = 0;
    for (const b of state.blocks.slice()) {
      if (b.kind !== 'ink' || b.parentId !== state.level || b.locked) continue;
      const pts = inkWorldPts(b); if (!pts.length) continue;
      const step = Math.max(1, Math.floor(pts.length / 24));
      let inside = 0, total = 0;
      for (let i = 0; i < pts.length; i += step) { total++; if (pointInPoly(pts[i][0], pts[i][1], poly)) inside++; }
      if (inside * 2 >= total) { removeInkBlock(b); n++; }
    }
    if (eraserScope === 'all') {
      // a block goes when most of its corners (and centre) lie inside
      for (const b of state.blocks.slice()) {
        if (b.kind === 'ink' || b.parentId !== state.level || b.locked) continue;
        const r = blockBox(b); let inside = 0;
        for (const [px, py] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h], [r.x + r.w / 2, r.y + r.h / 2]]) {
          if (pointInPoly(px, py, poly)) inside++;
        }
        if (inside >= 3) { removeInkBlock(b); n++; }
      }
      // a connector goes when its middle is circled (one between two erased blocks is gone with them)
      for (const ed of state.edges.slice()) {
        const a = state.byId.get(ed.from), b = state.byId.get(ed.to);
        if (!a || !b) continue;
        const pts = edgePolyline(blockRectOf(a), blockRectOf(b), ed.style);
        const q = pts.length === 2 ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] : [(pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2];
        if (pointInPoly(q[0], q[1], poly)) { removeEdgeByEraser(ed); n++; }
      }
    }
    commitEraseBatch();
    const noun = eraserScope === 'all' ? ' item' : ' stroke';
    toast(n ? n + noun + (n === 1 ? '' : 's') + ' erased' : 'Nothing inside the loop');
  }

  /* --------------------------- draw panel ------------------------------- *
   * Two tool buttons carry a small dots badge: tap the button for the tool,
   * tap the dots (or the button again while it is already the active tool)
   * for its options. Each button's icon shows the current choice.           */
  const PEN_ORDER = ['pencil', 'pen', 'brush', 'highlighter'];
  function renderPenTools() {
    const st = PEN_STYLES[penStyle] || PEN_STYLES.pen, em = ERASER_MODES[eraserMode];
    const sb = $('#pen-style'), sic = $('#pen-style-ic');
    if (sb) { sb.classList.toggle('active', !state.penEraser); sb.title = st.label + ' \u2014 tap the dots for other styles'; }
    if (sic) sic.innerHTML = ic(st.icon);
    const eb = $('#pen-eraser'), eic = $('#pen-eraser-ic');
    if (eb) { eb.classList.toggle('active', state.penEraser); eb.title = em.label + ' (E) \u2014 ink only; tap the dots for other erasers'; }
    if (eic) eic.innerHTML = ic(em.icon);
    const tic = $('#btn-eraser-ic'); if (tic) tic.innerHTML = ic(em.icon);       // the toolbar button too
    const tb = $('#btn-eraser'); if (tb) tb.title = em.label + ' (E) \u2014 erases anything it touches; the dots pick the eraser';
    const sw = $('#pen-bar .pen-size-wrap');
    if (sw) sw.classList.toggle('dimmed', state.penEraser && eraserMode !== 'normal');
  }
  // the one slider serves the pen's thickness or the eraser's size
  function syncPenSize() {
    const sl = $('#pen-size'), lab = $('#pen-size-val');
    const forEraser = state.penEraser && eraserMode === 'normal';
    const v = forEraser ? eraserSize : penSize;
    if (sl) { sl.value = v; sl.title = forEraser ? 'Eraser size' : 'Thickness'; }
    if (lab) lab.textContent = v + '%';
  }
  function choosePenStyle(key) {
    if (!PEN_STYLES[key]) return;
    penStyle = key;
    try { localStorage.setItem('ng-pen-style', key); } catch (_) {}
    if (state.penEraser) setEraser(false, true);         // choosing a pen means "draw"
    renderPenTools(); syncPenSize();
  }

  // ---- the options menu under a tool button ----
  function closePenMenu() { const m = $('#pen-menu'); if (m) { m.hidden = true; m.innerHTML = ''; m.dataset.kind = ''; } }
  function openPenMenu(kind, anchor, below) {
    const m = $('#pen-menu'); if (!m || !anchor) return;
    m.innerHTML = ''; m.dataset.kind = kind;
    const items = kind === 'style'
      ? PEN_ORDER.map(k => ({ k, icon: PEN_STYLES[k].icon, label: PEN_STYLES[k].label, hint: '', on: k === penStyle && !state.penEraser }))
      : kind === 'lasso'
      ? Object.keys(LASSO_MODES).map(k => ({ k, icon: LASSO_MODES[k].icon, label: LASSO_MODES[k].label, hint: LASSO_MODES[k].hint, on: k === lassoMode && state.selectTool }))
      : Object.keys(ERASER_MODES).map(k => ({ k, icon: ERASER_MODES[k].icon, label: ERASER_MODES[k].label, hint: ERASER_MODES[k].hint, on: k === eraserMode && state.penEraser }));
    items.forEach(it => {
      const b = document.createElement('button');
      b.className = it.on ? 'active' : ''; b.dataset.v = it.k;
      b.innerHTML = ic(it.icon) + '<span>' + esc(it.label) + '</span>' + (it.hint ? '<span class="pm-hint">' + esc(it.hint) + '</span>' : '');
      b.addEventListener('click', (e) => {
        e.stopPropagation(); closePenMenu();
        if (kind === 'style') choosePenStyle(it.k);
        else if (kind === 'lasso') { setLassoMode(it.k); if (!state.selectTool) setSelectMode(true); else toast('Select: ' + LASSO_MODES[it.k].label.toLowerCase()); }
        else setEraserMode(it.k);
      });
      m.appendChild(b);
    });
    m.hidden = false;
    // beside an upright panel, above or below a flat one; never off screen
    const r = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let left, top;
    if (!below && state.penMode && penBarVert) { left = r.left + r.width / 2 < vw / 2 ? r.right + 8 : r.left - mw - 8; top = r.top; }
    else { left = r.left + r.width / 2 - mw / 2; top = (!below && r.top + r.height / 2 > vh / 2) ? r.top - mh - 8 : r.bottom + 8; }
    m.style.left = Math.round(clamp(left, 6, Math.max(6, vw - mw - 6))) + 'px';
    m.style.top = Math.round(clamp(top, 6, Math.max(6, vh - mh - 6))) + 'px';
  }
  function bindPenMenus() {
    // primary() does the button's own job and says whether the menu should open instead
    const wire = (id, kind, primary) => {
      const btn = $(id); if (!btn) return;
      btn.addEventListener('click', (e) => {
        if (penBarJustDragged) return;
        const m = $('#pen-menu');
        if (e.target.closest('.pen-more') || primary()) {
          if (m && !m.hidden && m.dataset.kind === kind) closePenMenu(); else openPenMenu(kind, btn);
        } else closePenMenu();
      });
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openPenMenu(kind, btn); });
    };
    wire('#pen-style', 'style', () => { if (state.penEraser) { setEraser(false); return false; } return true; });
    wire('#pen-eraser', 'eraser', () => { if (!state.penEraser || eraserScope !== 'ink') { setEraser(true, false, 'ink'); return false; } return true; });
    // the toolbar eraser has no badge: right-click / long-press opens the modes
    $('#btn-eraser')?.addEventListener('contextmenu', (e) => { e.preventDefault(); openPenMenu('eraser', $('#btn-eraser'), true); });
    document.addEventListener('click', (e) => {
      const m = $('#pen-menu'); if (!m || m.hidden) return;
      if (!m.contains(e.target) && !e.target.closest('#pen-style, #pen-eraser, #btn-eraser, #btn-select')) closePenMenu();
    });
  }

  /* ------------------- draggable draw panel ---------------------------- *
   * Drag it from anywhere on its body (the slider keeps its own drag). When
   * let go it snaps to the nearest of seven spots: the middle of any edge or
   * a corner - not the bottom-right one, where the mini-map lives. Along the
   * top or bottom it lies flat, down a side it stands up, and in a corner it
   * keeps whichever way it was last.                                        */
  const PEN_ANCHORS = ['tm', 'bm', 'lm', 'rm', 'tl', 'tr', 'bl'];
  let penBarAnchor = 'bm', penBarVert = false, penBarJustDragged = false;
  function penBarHost() { return $('#app') || document.body; }
  // between the toolbar and the breadcrumb bar
  function penBarBounds() {
    const bar = $('#topbar'), foot = $('#bottombar');
    const top = bar ? bar.getBoundingClientRect().bottom + 6 : 6;
    const footH = foot && !foot.hidden ? foot.getBoundingClientRect().height : 0;
    return { top, bottom: window.innerHeight - footH - 6 };
  }
  function anchorPoints() {
    const vw = window.innerWidth, b = penBarBounds(), my = (b.top + b.bottom) / 2;
    return { tm: [vw / 2, b.top], bm: [vw / 2, b.bottom], lm: [0, my], rm: [vw, my],
             tl: [0, b.top], tr: [vw, b.top], bl: [0, b.bottom] };
  }
  function nearestAnchor(px, py) {
    const pts = anchorPoints();
    const d = (a) => Math.hypot(px - pts[a][0], py - pts[a][1]);
    return PEN_ANCHORS.reduce((best, a) => (d(a) < d(best) ? a : best), 'bm');
  }
  const anchorVert = (a, prev) => (a === 'lm' || a === 'rm') ? true : (a === 'tm' || a === 'bm') ? false : !!prev;
  function loadPenBarPos() {
    const bar = $('#pen-bar'); if (!bar) return;
    if (bar.parentElement !== penBarHost()) penBarHost().appendChild(bar);
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem('ng-pen-bar-pos') || 'null'); } catch (_) {}
    const anchor = pos && PEN_ANCHORS.includes(pos.anchor) ? pos.anchor : 'bm';
    placePenBar(anchor, anchorVert(anchor, pos && pos.vert), false);
  }
  function placePenBar(anchor, vert, save = true) {
    const bar = $('#pen-bar'); if (!bar) return;
    penBarAnchor = anchor; penBarVert = !!vert;
    bar.classList.add('moved'); bar.classList.toggle('vert', penBarVert);
    bar.style.left = '0px'; bar.style.top = '0px';                 // measure at its natural size
    const r = bar.getBoundingClientRect(), w = r.width || 320, h = r.height || 46;
    const vw = window.innerWidth, b = penBarBounds();
    const atL = anchor === 'lm' || anchor === 'tl' || anchor === 'bl', atR = anchor === 'rm' || anchor === 'tr';
    const atT = anchor === 'tm' || anchor === 'tl' || anchor === 'tr', atB = anchor === 'bm' || anchor === 'bl';
    let left = atL ? 0 : atR ? vw - w : (vw - w) / 2;
    let top = atT ? b.top : atB ? b.bottom - h : (b.top + b.bottom - h) / 2;
    // never sit on the mini-map: slide sideways or up, whichever is the
    // smaller move
    const mm = $('#minimap');
    if (mm && !mm.hidden) {
      const m = mm.getBoundingClientRect(), M = 8;
      const hits = left < m.right + M && left + w > m.left - M && top < m.bottom + M && top + h > m.top - M;
      if (hits) {
        const upTo = m.top - M - h, leftTo = m.left - M - w;
        const sideways = (left + w) - (m.left - M), upward = (top + h) - (m.top - M);
        if (!penBarVert && sideways <= upward && leftTo >= 0) left = leftTo;
        else if (upTo >= b.top) top = upTo;
        else if (leftTo >= 0) left = leftTo;
      }
    }
    bar.style.left = Math.round(clamp(left, 0, Math.max(0, vw - w))) + 'px';
    bar.style.top = Math.round(clamp(top, b.top, Math.max(b.top, b.bottom - h))) + 'px';
    bar.classList.toggle('edge-l', atL); bar.classList.toggle('edge-r', atR);
    bar.classList.toggle('edge-t', atT); bar.classList.toggle('edge-b', atB);
    bar.dataset.anchor = anchor;
    if (save) { try { localStorage.setItem('ng-pen-bar-pos', JSON.stringify({ anchor, vert: penBarVert })); } catch (_) {} }
  }
  function bindPenBarDrag() {
    const bar = $('#pen-bar'); if (!bar) return;
    let drag = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('input')) return;      // the slider drags itself
      const r = bar.getBoundingClientRect();
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, live: false };
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.live) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) return;   // a tap, not a drag
        drag.live = true; bar.classList.add('dragging'); closePenMenu();
        try { bar.setPointerCapture(e.pointerId); } catch (_) {}
      }
      bar.style.left = Math.round(e.clientX - drag.dx) + 'px';
      bar.style.top = Math.round(e.clientY - drag.dy) + 'px';
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const was = drag; drag = null;
      if (!was.live) return;
      bar.classList.remove('dragging');
      try { bar.releasePointerCapture(e.pointerId); } catch (_) {}
      const a = nearestAnchor(e.clientX, e.clientY);
      placePenBar(a, anchorVert(a, penBarVert));
      penBarJustDragged = true; setTimeout(() => { penBarJustDragged = false; }, 0);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    // a drag must not also press whatever button it started on
    bar.addEventListener('click', (e) => { if (penBarJustDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
    window.addEventListener('resize', () => { if (!bar.hidden) placePenBar(penBarAnchor, penBarVert, false); });
  }

  // Ctrl+A — select everything on this level.
  function selectAllOnLevel() {
    if (state.levelLayout !== 'canvas') { toast('Switch to canvas view to select blocks.'); return; }
    const ids = state.blocks.filter(b => b.parentId === state.level).map(b => b.id);
    if (!ids.length) { toast('Nothing here to select.'); return; }
    setSelection(ids);
    toast(ids.length + (ids.length === 1 ? ' item selected' : ' items selected'));
  }


  function renderPenColors() {
    const wrap = $('#pen-colors'); if (!wrap) return;
    wrap.innerHTML = '';
    PEN_COLORS.concat(['#ffffff', '#0a0b0d']).forEach(col => {
      const d = document.createElement('span');
      d.className = 'pen-dot' + (col === penColor ? ' active' : '');
      d.style.background = col;
      d.addEventListener('click', () => {
        penColor = col;
        try { localStorage.setItem('ng-pen-color', col); } catch (_) {}
        if (state.penEraser) setEraser(false, true);  // choosing ink means "draw"
        renderPenColors(); renderPenTools();
      });
      wrap.appendChild(d);
    });
  }
  // Ink floats above other blocks unless it is explicitly sent backward.
  const INK_Z = 500;
  // A stroke's record geometry: box at (bx, by), points relative to the box's
  // origin plus the nib padding, on a 0.05 grid. One function, so the wet
  // layer's last frame and the saved record are built from identical numbers.
  function encodeInk(pts, width) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const bx = Math.round(minX - width - 2), by = Math.round(minY - width - 2);
    const ox = bx + width + 2, oy = by + width + 2;         // where the points are drawn from
    const rel = pts.map(([x, y, pr, k]) => {
      const q = [Math.round((x - ox) * 20) / 20, Math.round((y - oy) * 20) / 20];
      if (pr || k) q.push(Math.round((pr || 0) * 100) / 100);
      if (k) q.push(k);                    // the nib width the preview drew with
      return q;
    });
    return { bx, by, ox, oy, rel, w: Math.round(maxX - ox), h: Math.round(maxY - oy) };
  }
  const decodeInk = (enc) => enc.rel.map(q => [enc.ox + q[0], enc.oy + q[1], q[2] || 0, q[3] || 0]);
  let lastInk = null;          // { group, at, x, y, w, h } — the previous stroke
  async function finalizeInk(pts, stroke) {
    const style = (stroke && stroke.style) || penStyle;
    const color = (stroke && stroke.color) || penColor;
    const width = (stroke && stroke.width) || curWidth();
    const enc = encodeInk(pts, width);
    const { bx, by, rel } = enc;
    const b = {
      id: uid(), ws: state.ws, parentId: state.level, kind: 'ink',
      title: '', color, width, style,
      pts: rel, w: enc.w, h: enc.h,
      x: bx, y: by,
      z: 0, createdAt: Date.now(), updatedAt: Date.now(),
    };
    b.z = INK_Z;                 // drawing sits above the page by default
    // Join the previous stroke's group only when it reads as the same word:
    // written straight after it, on the same line, and close by relative to
    // how tall the writing is. Fixed distances merged whole phrases.
    const now = Date.now();
    const lineH = Math.max(18, Math.min(90, b.h || 24));
    const gapX = lastInk ? (b.x - (lastInk.x + lastInk.w)) : Infinity;   // space between strokes
    const dyMid = lastInk ? Math.abs((b.y + (b.h || 0) / 2) - (lastInk.y + lastInk.h / 2)) : Infinity;
    const sameWord = lastInk &&
      now - lastInk.at < 900 &&                 // a pause ends the word
      gapX > -lineH * 1.2 && gapX < lineH * 0.45 &&
      dyMid < lineH * 0.9;
    b.group = sameWord ? lastInk.group : uid();
    lastInk = { group: b.group, at: now, x: b.x, y: b.y, w: b.w || 0, h: b.h || 0 };

    // Draw it first, save second: the ink is on the page before the write
    // finishes, so the next stroke never waits on storage.
    state.blocks.push(b);
    state.byId.set(b.id, b);
    state.childCounts[b.id] = { blocks: 0, files: 0 };
    world.appendChild(makeBlockEl(b));
    planesAdd(b, true);          // on the plane before the wet layer releases it
    const level = state.level, gen = history.gen;
    await afterInkWrites(async () => {
      await DB.saveBlock(b);
      if (history.gen !== gen) return;         // the page was left meanwhile: saved, not in the new history
      recordChange(emptySet(), { blocks: [b], edges: [], files: [] }, level);
    });
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
  function resetZoom() {
    const c = centerOfView();
    state.view.scale = 1;
    const rr = stage.getBoundingClientRect();
    state.view.tx = rr.width / 2 - c.x; state.view.ty = rr.height / 2 - c.y;
    applyView();
  }
  function fitToView() {
    if (state.levelLayout === 'list') return;
    const r = stage.getBoundingClientRect();
    if (!state.blocks.length) {
      state.view = { scale: 1, tx: r.width / 2 - 105, ty: r.height / 2 - 120 };
      applyView(); return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of state.blocks) {
      const rect = blockRectOf(b);
      minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w); maxY = Math.max(maxY, rect.y + rect.h);
    }
    const pad = 70;
    const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    const scale = clamp(Math.min(r.width / w, r.height / h), 0.3, 8);
    state.view.scale = scale;
    state.view.tx = (r.width - (maxX + minX) * scale) / 2;
    state.view.ty = (r.height - (maxY + minY) * scale) / 2;
    applyView();
  }

  /* ---------------------------- mini-map ------------------------------- */
  function worldBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of state.blocks) {
      const rect = blockRectOf(b);
      minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w); maxY = Math.max(maxY, rect.y + rect.h);
    }
    if (!isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }
  let mmMap = null;   // {scale, offX, offY} world→minimap mapping for interaction
  function drawMinimap() {
    const cv = $('#minimap');
    if (!cv) return;
    const show = minimapOn && state.ws != null && state.levelLayout === 'canvas' && state.blocks.length > 0;
    const wasHidden = cv.hidden;
    cv.hidden = !show;
    if (wasHidden !== cv.hidden && state.penMode) placePenBar(penBarAnchor, penBarVert, false);   // the panel dodges it
    if (!show) return;
    const dpr = window.devicePixelRatio || 1;
    // the map's CSS size only changes with the window: measured once per frame at most
    if (!mmSize || mmSize.hidden !== cv.hidden) { mmSize = { w: cv.clientWidth, h: cv.clientHeight, hidden: cv.hidden }; requestAnimationFrame(() => { mmSize = null; }); }
    const cssW = mmSize.w, cssH = mmSize.h;
    if (!cssW || !cssH) return;                        // hidden by CSS (presenting, short phones)
    if (cv.width !== cssW * dpr) { cv.width = cssW * dpr; cv.height = cssH * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    // The page content is rendered into a bitmap at most four times a second
    // after something changed; a pan or zoom frame only re-projects that
    // bitmap and draws the viewport rectangle, so the per-frame cost no
    // longer grows with what is on the page.
    const now = performance.now();
    if (!mmContent || (mmDirty && now - mmContent.at > 250)) updateMinimapContent(cssW, cssH, dpr);
    const b = mmContent.bounds;
    const vr = stageRect();
    const vw0 = screenToWorld(0, 0), vw1 = screenToWorld(vr.width, vr.height);
    // include viewport in bounds so the indicator is always visible
    const minX = Math.min(b.minX, vw0.x), minY = Math.min(b.minY, vw0.y);
    const maxX = Math.max(b.maxX, vw1.x), maxY = Math.max(b.maxY, vw1.y);
    const pad = 30;
    const bw = (maxX - minX) + pad * 2, bh = (maxY - minY) + pad * 2;
    const scale = Math.min(cssW / bw, cssH / bh);
    const offX = (cssW - bw * scale) / 2 - (minX - pad) * scale;
    const offY = (cssH - bh * scale) / 2 - (minY - pad) * scale;
    mmMap = { scale, offX, offY };
    const wx = (x) => x * scale + offX, wy = (y) => y * scale + offY;
    const c = mmContent;
    if (c.canvas) {
      ctx.globalAlpha = 1;
      ctx.drawImage(c.canvas, wx(c.x0), wy(c.y0), (c.x1 - c.x0) * scale, (c.y1 - c.y0) * scale);
    }
    // viewport rectangle
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5;
    ctx.strokeRect(wx(vw0.x), wy(vw0.y), (vw1.x - vw0.x) * scale, (vw1.y - vw0.y) * scale);
  }
  let mmContent = null, mmDirty = true, mmSize = null;

  /* ---- where every block sits, so one edit only repaints its own patch --- *
   * The mini-map used to redraw its whole picture - sort every block, then
   * draw every block - each time anything changed. A spatial index (the same
   * idea as the ink planes, generalised to every kind of block) remembers
   * which small patch of the page each block occupies, so a committed edit
   * with a known before/after (almost everything that isn't a bulk operation)
   * can invalidate just that patch instead. Reset in full whenever the level
   * does (mmResetIndex), which is also what the full-picture path below uses
   * to (re)build it, so the two paths never disagree about what is where.  */
  const MM_GRID = 256;                 // world units per cell, same rationale as the ink planes
  const MM_PATCH_LIMIT = 40;           // more changed blocks than this: a full redraw is simpler
  const mmGrid = new Map();            // "cx,cy" -> Set(blockId)
  const mmCellsOf = new Map();         // blockId -> the cell keys it is registered under
  const mmSeen = new Map();            // blockId -> the rect it was last placed at
  const mmBlocksById = new Map();      // blockId -> the block, for the patch path's own drawing
  let mmBounds = null;                 // running {minX,minY,maxX,maxY} over every block, kept live
  let mmBoundsStale = false;           // a removal might have shrunk it; only then is a rescan needed
  let mmDirtyIds = null;               // Set(blockId) touched since the last redraw, or null = unknown
  let mmDirtyAll = false;              // an edit arrived with no before/after to diff: redraw everything
  let mmDirtyRect = null;              // world-space union of every patch touched since the last redraw

  function mmCellRange(rect) {
    return {
      x0: Math.floor(rect.x / MM_GRID), y0: Math.floor(rect.y / MM_GRID),
      x1: Math.floor((rect.x + rect.w) / MM_GRID), y1: Math.floor((rect.y + rect.h) / MM_GRID),
    };
  }
  function mmUnionRects(a, b) {
    if (!a) return b; if (!b) return a;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }
  function mmExtendBounds(rect) {
    if (!mmBounds) { mmBounds = { minX: rect.x, minY: rect.y, maxX: rect.x + rect.w, maxY: rect.y + rect.h }; return; }
    if (rect.x < mmBounds.minX) mmBounds.minX = rect.x;
    if (rect.y < mmBounds.minY) mmBounds.minY = rect.y;
    if (rect.x + rect.w > mmBounds.maxX) mmBounds.maxX = rect.x + rect.w;
    if (rect.y + rect.h > mmBounds.maxY) mmBounds.maxY = rect.y + rect.h;
  }
  // Was this rect sitting right on the current outer edge? Only then can
  // taking it away have shrunk the true bounds - anything else leaves them
  // exactly as they were, no rescan needed.
  function mmTouchesBoundsEdge(rect) {
    if (!mmBounds) return false;
    const eps = 0.5;
    return Math.abs(rect.x - mmBounds.minX) < eps || Math.abs(rect.y - mmBounds.minY) < eps
        || Math.abs(rect.x + rect.w - mmBounds.maxX) < eps || Math.abs(rect.y + rect.h - mmBounds.maxY) < eps;
  }
  function mmInvalidateRect(r) { if (r) mmDirtyRect = mmUnionRects(mmDirtyRect, r); }
  // Register (or re-register) one block at the cells its current rect
  // touches, replacing wherever it was before.
  function mmPlace(b) {
    const rect = blockRectOf(b);
    const old = mmCellsOf.get(b.id);
    if (old) for (const k of old) { const s = mmGrid.get(k); if (s) { s.delete(b.id); if (!s.size) mmGrid.delete(k); } }
    const { x0, y0, x1, y1 } = mmCellRange(rect);
    const cells = [];
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) cells.push(cx + ',' + cy);
    mmCellsOf.set(b.id, cells);
    for (const k of cells) { let s = mmGrid.get(k); if (!s) { s = new Set(); mmGrid.set(k, s); } s.add(b.id); }
    const oldRect = mmSeen.get(b.id);
    mmSeen.set(b.id, rect); mmBlocksById.set(b.id, b);
    mmInvalidateRect(oldRect ? mmUnionRects(oldRect, rect) : rect);
    if (oldRect && mmTouchesBoundsEdge(oldRect)) mmBoundsStale = true;
    mmExtendBounds(rect);
    return rect;
  }
  function mmUnplace(id) {
    const cells = mmCellsOf.get(id);
    if (cells) for (const k of cells) { const s = mmGrid.get(k); if (s) { s.delete(id); if (!s.size) mmGrid.delete(k); } }
    mmCellsOf.delete(id); mmBlocksById.delete(id);
    const rect = mmSeen.get(id);
    mmSeen.delete(id);
    mmInvalidateRect(rect);
    if (rect && mmTouchesBoundsEdge(rect)) mmBoundsStale = true;
  }
  // Full rebuild of the index (and, as a side effect, of mmBounds): the one
  // place a pass over every block is expected. Level loads and every "we
  // don't know exactly what changed" trigger below go through this.
  function mmResetIndex() {
    mmGrid.clear(); mmCellsOf.clear(); mmSeen.clear(); mmBlocksById.clear();
    mmBounds = null; mmBoundsStale = false; mmDirtyRect = null;
    for (const b of state.blocks) mmPlace(b);
  }
  // An edit with a known before/after (almost everything that goes through
  // recordChange) updates just the blocks that actually changed. Anything
  // bigger than a handful, or an edit with no before/after to read, still
  // keeps the index itself exact (see below) but falls back to a full
  // redraw next time the mini-map actually repaints, rather than patching.
  //
  // The spatial index this maintains (mmGrid/mmPlace/mmUnplace) is no longer
  // only the mini-map's - the on-screen virtualisation below queries it too,
  // to know what is actually near the viewport. A block missing from a stale
  // index there is not a slightly-off decorative picture (the mini-map's
  // worst case) - it is content that silently never gets built. So unlike
  // before, the index itself is now kept exact on every call, regardless of
  // edit size; only the mini-map's own "full redraw vs. patch" choice still
  // uses the size threshold, since that is a pure drawing-cost decision.
  function mmMarkDirty(before, after) {
    mmDirty = true;
    const afterBlocks = (after && after.blocks) || null;
    const beforeBlocks = (before && before.blocks) || null;
    if (!afterBlocks && !beforeBlocks) {
      // no diff to read: only a full rescan keeps the index correct - rare
      // (undo/redo and a few bulk paths), so the cost is fine here.
      mmResetIndex();
      mmDirtyAll = true;
      return;
    }
    const afterIds = new Set((afterBlocks || []).map(b => b.id));
    for (const b of (afterBlocks || [])) mmPlace(b);
    for (const b of (beforeBlocks || [])) if (!afterIds.has(b.id)) mmUnplace(b.id);

    if (mmDirtyAll) return;                          // already committed to a full redraw this round
    if ((afterBlocks ? afterBlocks.length : 0) + (beforeBlocks ? beforeBlocks.length : 0) > MM_PATCH_LIMIT) {
      mmDirtyAll = true; return;
    }
    if (!mmDirtyIds) mmDirtyIds = new Set();
    for (const b of (afterBlocks || [])) mmDirtyIds.add(b.id);
    for (const b of (beforeBlocks || [])) if (!afterIds.has(b.id)) mmDirtyIds.add(b.id);
  }
  function mmCurrentColors() {
    const st = getComputedStyle(document.documentElement);
    return {
      accent: (st.getPropertyValue('--accent') || '#2b7fff').trim(),
      cardBg: (st.getPropertyValue('--card') || '#161b21').trim(),
      lineC: (st.getPropertyValue('--card-line') || '#23262d').trim(),
      text: (st.getPropertyValue('--text') || '#e7eaee').trim(),
    };
  }
  // Does the picture already on the canvas still match the current bounds
  // and pixel size? If not, nothing can be patched onto it - it was drawn
  // for a different rectangle of the page.
  function mmPatchFits(cssW, cssH, dpr) {
    if (!mmContent || mmBoundsStale || !mmBounds) return false;
    const pad = 30;
    const x0 = mmBounds.minX - pad, y0 = mmBounds.minY - pad, x1 = mmBounds.maxX + pad, y1 = mmBounds.maxY + pad;
    const W = Math.max(2, Math.round(cssW * dpr * 2)), H = Math.max(2, Math.round(cssH * dpr * 2));
    // the same scale renderMinimapContent would choose: whichever dimension is
    // the tighter fit, width or height - comparing only the width's ratio
    // failed every time on content taller than it is wide, which is most of
    // what a page of handwriting looks like.
    const cs = Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0));
    const eps = 0.5;
    return Math.abs(x0 - mmContent.x0) < eps && Math.abs(y0 - mmContent.y0) < eps
        && Math.abs(x1 - mmContent.x1) < eps && Math.abs(y1 - mmContent.y1) < eps
        && mmContent.canvas.width === Math.max(1, Math.ceil((x1 - x0) * mmContent.cs))
        && mmContent.canvas.height === Math.max(1, Math.ceil((y1 - y0) * mmContent.cs))
        && Math.abs(cs - mmContent.cs) < 0.001;
  }
  // Redraw only the patch of the persistent bitmap the changed blocks touch.
  function patchMinimapContent() {
    const c = mmContent, ctx = c.canvas.getContext('2d');
    const wx = (x) => (x - c.x0) * c.cs, wy = (y) => (y - c.y0) * c.cs;
    if (mmDirtyRect) {
      const r = mmDirtyRect;
      const px0 = Math.max(0, Math.floor(wx(r.x))), py0 = Math.max(0, Math.floor(wy(r.y)));
      const px1 = Math.min(c.canvas.width, Math.ceil(wx(r.x + r.w))), py1 = Math.min(c.canvas.height, Math.ceil(wy(r.y + r.h)));
      if (px1 > px0 && py1 > py0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.save();
        ctx.beginPath(); ctx.rect(px0, py0, px1 - px0, py1 - py0); ctx.clip();
        ctx.clearRect(px0, py0, px1 - px0, py1 - py0);
        const world = { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 };
        const { x0, y0, x1, y1 } = mmCellRange(world);
        const already = new Set(); const here = [];
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
          const cell = mmGrid.get(cx + ',' + cy); if (!cell) continue;
          for (const id of cell) {
            if (already.has(id)) continue; already.add(id);
            const rect = mmSeen.get(id); if (!rect) continue;
            if (rect.x > world.x + world.w || rect.y > world.y + world.h || rect.x + rect.w < world.x || rect.y + rect.h < world.y) continue;
            const blk = mmBlocksById.get(id); if (blk) here.push(blk);
          }
        }
        here.sort((a, b) => (a.z || 0) - (b.z || 0));      // this patch's own handful, never the whole page
        for (const blk of here) drawNodeMini(ctx, blk, mmSeen.get(blk.id), wx, wy, c.cs, c.col);
        ctx.restore();
      }
    }
    mmContent.at = performance.now();
  }
  // Everything on the level drawn once into an offscreen bitmap that covers
  // the content bounds (plus the same padding the map uses), at twice the
  // map's resolution so it stays crisp when re-projected.
  function renderMinimapContent(cssW, cssH, dpr) {
    mmResetIndex();                                    // the one full pass; also rebuilds mmBounds
    const bounds = mmBounds || { minX: 0, minY: 0, maxX: 0, maxY: 0 };   // an empty level has no bounds
    const pad = 30;
    const x0 = bounds.minX - pad, y0 = bounds.minY - pad, x1 = bounds.maxX + pad, y1 = bounds.maxY + pad;
    const W = Math.max(2, Math.round(cssW * dpr * 2)), H = Math.max(2, Math.round(cssH * dpr * 2));
    const cs = Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0));
    const bw = Math.max(1, Math.ceil((x1 - x0) * cs)), bh = Math.max(1, Math.ceil((y1 - y0) * cs));
    const canvas = (mmContent && mmContent.canvas) || document.createElement('canvas');
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    const wx = (x) => (x - x0) * cs, wy = (y) => (y - y0) * cs;
    const col = mmCurrentColors();
    // draw nodes back-to-front (respect z-order)
    const ordered = [...state.blocks].sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const blk of ordered) drawNodeMini(ctx, blk, mmSeen.get(blk.id), wx, wy, cs, col);
    mmContent = { canvas, bounds, x0, y0, x1, y1, cs, col, accent: col.accent, at: performance.now() };
    mmDirty = false;
  }
  // Patch when we know precisely what changed and the picture still fits;
  // otherwise the same full redraw as always. Either way the dirty state is
  // clear before the next edit starts filling it in again.
  function updateMinimapContent(cssW, cssH, dpr) {
    if (!mmDirtyAll && mmDirtyIds && mmDirtyIds.size && mmPatchFits(cssW, cssH, dpr)) patchMinimapContent();
    else renderMinimapContent(cssW, cssH, dpr);
    mmDirtyIds = null; mmDirtyAll = false; mmDirtyRect = null;
  }

  const _mmImgCache = new Map();   // src → HTMLImageElement (for image thumbnails)
  // A stroke's mini-map polyline, built once per point array. Point arrays are
  // only ever replaced (scale, undo, erase), never edited in place, so the
  // array itself is the cache key and a stale path is impossible.
  const mmPathCache = new WeakMap();
  function mmImage(src) {
    if (!src) return null;
    let im = _mmImgCache.get(src);
    if (!im) { im = new Image(); im.onload = () => { mmDirty = true; mmDirtyAll = true; scheduleMinimap(); }; im.src = src; _mmImgCache.set(src, im); }
    return im.complete ? im : null;
  }
  // Draw a single node into the mini-map as a faithful little preview.
  function drawNodeMini(ctx, b, rect, wx, wy, scale, col) {
    const x = wx(rect.x), y = wy(rect.y), w = Math.max(1, rect.w * scale), h = Math.max(1, rect.h * scale);
    const cx = x + w / 2, cy = y + h / 2;
    ctx.save();
    if (b.rot) { ctx.translate(cx, cy); ctx.rotate(b.rot * Math.PI / 180); ctx.translate(-cx, -cy); }
    ctx.globalAlpha = 0.95;

    if (b.kind === 'ink') {
      const pad = (b.width || 3) + 2;
      const pts = b.pts || [];
      let path = mmPathCache.get(pts);
      if (!path) {
        path = new Path2D();
        pts.forEach((p, i) => { i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1]); });
        mmPathCache.set(pts, path);
      }
      ctx.strokeStyle = b.color || col.accent;
      ctx.lineJoin = ctx.lineCap = 'round';
      // same picture as mapping every point through wx/wy (both are affine)
      ctx.save();
      ctx.translate(wx(b.x + pad), wy(b.y + pad));
      ctx.scale(scale, scale);
      ctx.lineWidth = Math.max(0.6, (b.width || 3) * scale) / scale;
      ctx.stroke(path);
      ctx.restore();
    } else if (b.kind === 'shape' && b.shape === 'line') {
      ctx.strokeStyle = b.outlineColor || b.color || col.accent;
      ctx.lineWidth = Math.max(0.6, (b.outlineW || 4) * scale);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke();
    } else if (b.kind === 'shape') {
      const fill = b.fill ? (b.color || col.accent) : null;
      const stroke = b.outline ? (b.outlineColor || col.accent) : null;
      ctx.lineWidth = Math.max(0.5, (b.outlineW || 2) * scale);
      ctx.beginPath();
      if (b.shape === 'circle') { ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); }
      else {
        const pts = shapePoints(b);
        if (pts) pts.forEach((p, i) => { const px = x + p[0] * w, py = y + p[1] * h; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }), ctx.closePath();
        else roundRectPath(ctx, x, y, w, h, Math.min(4, w / 4));
      }
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
      if (!fill && !stroke) { ctx.strokeStyle = col.accent; ctx.stroke(); }
    } else if (b.kind === 'check') {
      ctx.strokeStyle = b.color || col.accent; ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      if (b.checked) { ctx.fillStyle = b.color || col.accent; ctx.fillRect(x, y, w, h); }
    } else if (b.kind === 'image') {
      const im = mmImage(b.src);
      if (im) { try { ctx.drawImage(im, x, y, w, h); } catch (_) { ctx.fillStyle = col.lineC; ctx.fillRect(x, y, w, h); } }
      else { ctx.fillStyle = col.lineC; ctx.fillRect(x, y, w, h); }
    } else if (b.kind === 'text') {
      // Text is unreadable at mini scale — draw a clearly visible tinted marker
      // (a small chip) plus a few line-bars, with hard minimum sizes.
      const color = b.color && b.color !== '' ? b.color : col.text;
      const lines = (b.text || 'Text').split('\n').filter(l => l.trim().length);
      const maxLen = Math.max(1, ...lines.map(l => l.length));
      const bw0 = Math.max(10, w), bh0 = Math.max(8, h);   // guaranteed footprint
      // faint background chip so the text node is always locatable
      ctx.globalAlpha = 0.18; ctx.fillStyle = color;
      roundRectPath(ctx, x, y, bw0, bh0, 2); ctx.fill();
      // line bars
      ctx.globalAlpha = 0.95;
      const nLines = Math.min(lines.length || 1, Math.max(1, Math.floor(bh0 / 3)));
      const gap = bh0 / nLines;
      const bh = Math.max(1.5, Math.min(2.5, gap * 0.55));
      for (let li = 0; li < nLines; li++) {
        const ly = y + li * gap + (gap - bh) / 2;
        const frac = lines.length ? Math.min(1, (lines[li] || '').length / maxLen) : 0.7;
        const bw = Math.max(4, bw0 * Math.max(0.35, frac));
        roundRectPath(ctx, x, ly, bw, bh, Math.min(1.2, bh / 2)); ctx.fill();
      }
    } else {
      // block / list card: rounded card with accent top strip
      roundRectPath(ctx, x, y, w, h, Math.min(3, w / 5));
      ctx.fillStyle = col.cardBg; ctx.fill();
      ctx.strokeStyle = col.lineC; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.fillStyle = b.color || col.accent;
      roundRectPath(ctx, x, y, w, Math.max(1.5, 3 * scale), 1); ctx.fill();
    }
    ctx.restore();
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function minimapPan(clientX, clientY) {
    if (!mmMap) return;
    const cv = $('#minimap'); const r = cv.getBoundingClientRect();
    const wx = (clientX - r.left - mmMap.offX) / mmMap.scale;
    const wy = (clientY - r.top - mmMap.offY) / mmMap.scale;
    const vr = stage.getBoundingClientRect();
    state.view.tx = vr.width / 2 - wx * state.view.scale;
    state.view.ty = vr.height / 2 - wy * state.view.scale;
    applyView();
  }
  function bindMinimap() {
    const cv = $('#minimap');
    let dragging = false;
    cv.addEventListener('pointerdown', (e) => { dragging = true; try { cv.setPointerCapture(e.pointerId); } catch (_) {} minimapPan(e.clientX, e.clientY); });
    cv.addEventListener('pointermove', (e) => { if (dragging) minimapPan(e.clientX, e.clientY); });
    cv.addEventListener('pointerup', (e) => { dragging = false; try { cv.releasePointerCapture(e.pointerId); } catch (_) {} });
    cv.addEventListener('pointercancel', (e) => { dragging = false; try { cv.releasePointerCapture(e.pointerId); } catch (_) {} });
    drawMinimap();
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
  // Search opens under its toolbar button, sized to the screen.
  function openSearch() {
    const pop = $('#search-pop'), btn = $('#btn-search'); if (!pop) return;
    searchDataCache = null;   // a fresh open should see edits made since the last one
    pop.hidden = false;
    const tb = $('#topbar'), top = tb ? tb.getBoundingClientRect().bottom + 6 : 60;
    const w = Math.min(560, window.innerWidth - 24);
    const left = btn ? btn.getBoundingClientRect().left : 12;
    pop.style.top = Math.round(top) + 'px';
    pop.style.left = Math.round(clamp(left, 12, Math.max(12, window.innerWidth - w - 12))) + 'px';
    pop.style.width = w + 'px';
    btn?.classList.add('active');
    const input = $('#search'); input.focus(); input.select();
    if (input.value.trim()) runSearch(input.value.trim());
  }
  function closeSearch() {
    const pop = $('#search-pop'); if (!pop || pop.hidden) return;
    pop.hidden = true; hideSearchResults(); $('#btn-search')?.classList.remove('active');
  }

  // search ALL workspaces so you can jump anywhere; current workspace ranks
  // higher. That whole-database read is real work, and typing a query is a
  // keystroke-per-160ms stream - it must run once per time the panel is
  // opened, not once per keystroke. openSearch() clears this so a fresh
  // search always sees anything added or edited since the last one.
  let searchDataCache = null;
  async function runSearch(q) {
    const box = $('#search-results');
    if (!q) { hideSearchResults(); return; }
    const ql = q.toLowerCase();
    if (!searchDataCache) {
      const [blocks, files, wss] = await Promise.all([DB.getAll('blocks'), DB.getAll('files'), DB.listWorkspaces()]);
      const wsName = {}; wss.forEach(w => { wsName[w.id] = w.name; });
      const fileByBlock = {};
      files.forEach(f => { (fileByBlock[f.blockId] ||= []).push(f); });
      searchDataCache = { blocks, wsName, fileByBlock };
    }
    const { blocks, wsName, fileByBlock } = searchDataCache;

    const hits = [];
    for (const b of blocks) {
      if (b.kind === 'shape' || b.kind === 'image' || b.kind === 'ink' || b.kind === 'check') continue;   // purely visual — nothing to match
      const inTitle = (b.title || '').toLowerCase().includes(ql);
      const inDesc  = (b.description || '').toLowerCase().includes(ql);
      const inNotes = (b.notes || '').toLowerCase().includes(ql);
      const inText  = (b.text || '').toLowerCase().includes(ql);
      const inTags  = (b.tags || '').toLowerCase().includes(ql);
      const fileHit = (fileByBlock[b.id] || []).find(f => f.name.toLowerCase().includes(ql));
      if (inTitle || inDesc || inNotes || inText || inTags || fileHit) {
        let sub = '';
        if (inTitle) sub = b.description || (b.kind === 'text' ? 'text' : 'block');
        else if (inDesc) sub = b.description;
        else if (inText) sub = b.text.slice(0, 80);
        else if (inTags) sub = '# ' + b.tags;
        else if (inNotes) { const i = b.notes.toLowerCase().indexOf(ql); sub = '…' + b.notes.slice(Math.max(0, i - 20), i + 40) + '…'; }
        else if (fileHit) sub = fileHit.name;
        let score = inTitle ? 3 : inDesc ? 2 : inText ? 2 : inTags ? 2 : fileHit ? 1.5 : 1;
        if (b.ws === state.ws) score += 0.5;   // prefer current workspace
        hits.push({ b, sub, score });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    box.hidden = false;
    if (!hits.length) { box.innerHTML = '<div class="result-empty">No matches.</div>'; return; }
    box.innerHTML = '';
    hits.slice(0, 40).forEach(h => {
      const row = document.createElement('div');
      row.className = 'result';
      const elsewhere = h.b.ws !== state.ws;
      const label = h.b.kind === 'text' ? (h.b.text || 'Text').slice(0, 40) : (h.b.title || 'Untitled');
      row.innerHTML = `
        <div class="r-ico">${esc(monogram(label))}</div>
        <div class="r-main">
          <div class="r-title">${esc(label)}</div>
          <div class="r-sub">${esc(h.sub || '')}</div>
        </div>
        <div class="r-tag">${elsewhere ? esc(wsName[h.b.ws] || 'other') : 'open'}</div>`;
      row.addEventListener('click', () => { hideSearchResults(); closeSearch(); $('#search').value = ''; goToBlock(h.b); });
      box.appendChild(row);
    });
  }

  // Navigate to a block's PARENT level, then select/open it. Switches workspace if needed.
  async function goToBlock(b) {
    if (b.ws && b.ws !== state.ws) { await openWorkspace(b.ws); }
    await goToLevel(b.parentId || DB.ROOT, { push: true });
    setTimeout(() => {
      if (state.levelLayout === 'list') {
        const row = $(`.list-row[data-id="${b.id}"]`);
        if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); openEditor(b.id); }
        return;
      }
      // This used to gate on state.els[b.id] existing - true for free when
      // every block on a level got an element the moment it loaded. Now a
      // block you are jumping TO is exactly the one most likely to still be
      // off-view (that is the whole reason to jump), so the check has to be
      // "does the data exist" instead, and the element itself has to be
      // asked for explicitly before openEditor needs a real one to focus.
      if (state.byId.get(b.id)) {
        const r = stage.getBoundingClientRect();
        const rect = blockRect(b.id);
        state.view.tx = r.width / 2 - (rect.cx) * state.view.scale;
        state.view.ty = r.height / 2 - (rect.cy) * state.view.scale;
        applyView(); drawEdges();
        ensureMounted(b.id);
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
  // A connector's look travels with it: label, line style and the both-ends
  // arrow are written to exports (only when set, so files stay small - 1.x
  // readers ignore the extra keys) and read back on import and paste.
  const edgeOut = (e) => {
    const o = { id: e.id, parentId: e.parentId, from: e.from, to: e.to, createdAt: e.createdAt };
    if (e.label) o.label = e.label;
    if (e.style) o.style = e.style;
    if (e.both) o.both = true;
    return o;
  };
  const edgeIn = (rec, src) => {
    if (src.label) rec.label = src.label;
    if (src.style) rec.style = src.style;
    if (src.both) rec.both = true;
    return rec;
  };
  const fileDataCache = new Map();     // file id -> data URL; a file's blob never changes
  let fileDataBytes = 0;
  const FILE_CACHE_BUDGET = 32 * 1024 * 1024;   // beyond this, attachments are re-encoded per save
  async function workspacePayload(wsId, overrideName) {
    const w = await DB.getWorkspace(wsId);
    const [blocks, edges, files] = await Promise.all([
      DB.allByWs('blocks', wsId), DB.allByWs('edges', wsId), DB.allByWs('files', wsId),
    ]);
    const outFiles = [];
    for (const f of files) {
      const cacheable = wsId === state.ws;     // an export of another workspace stays out of memory
      let data = cacheable ? fileDataCache.get(f.id) : undefined;
      if (!data) {
        data = await blobToDataUrl(f.blob);
        if (cacheable && fileDataBytes + data.length <= FILE_CACHE_BUDGET) { fileDataCache.set(f.id, data); fileDataBytes += data.length; }
      }
      outFiles.push({ blockId: f.blockId, name: f.name, type: f.type, size: f.size, kind: f.kind, createdAt: f.createdAt, data });
    }
    // One builder for the file's shape, shared with the save worker
    // (js/payload.js), so an export and an autosave can never disagree.
    return NGPayload.build({ workspace: w, blocks, edges, files: outFiles }, overrideName, PALETTE[0]);
  }

  /* ------------------------- saving off the input thread ------------------ *
   * Reading every record, turning attachments into data URLs and stringifying
   * the result took 97 ms at 2000 strokes and 235 ms at 6000 - a freeze in
   * the middle of writing, since autosave fires while the pen is down. The
   * worker does that work on its own thread and hands back the finished text.
   * The page still does the file write itself: the app shell's file API is not
   * available to workers.                                                    */
  let saveWorker = null, saveWorkerBroken = false, saveJobId = 0;
  const saveJobs = new Map();
  function getSaveWorker() {
    if (saveWorkerBroken) return null;
    if (saveWorker) return saveWorker;
    try {
      saveWorker = new Worker('js/save-worker.js?v=' + (NG.version || ''));
      saveWorker.onmessage = (e) => {
        const { id, buffer, error, blocks } = e.data || {};
        const job = saveJobs.get(id); if (!job) return;
        saveJobs.delete(id);
        if (error) { job.reject(new Error(error)); return; }
        // buffer arrived as a transfer (a handoff, not a structured-clone
        // copy). Left undecoded here on purpose - decoding a multi-megabyte
        // buffer to a JS string turned out to still be real, measurable cost
        // on a slow device even once the transfer itself stopped being a
        // clone, and the linked-file autosave path (by far the hottest
        // caller - it fires repeatedly while actively writing) never needs
        // a string at all, since the file-write bridge takes raw bytes
        // directly. workspaceJson decodes for the callers that do need text.
        job.resolve({ buffer, blocks });
      };
      saveWorker.onerror = () => {
        saveWorkerBroken = true;
        for (const [, job] of saveJobs) job.reject(new Error('the save worker stopped'));
        saveJobs.clear();
        try { saveWorker.terminate(); } catch (_) {}
        saveWorker = null;
      };
    } catch (_) { saveWorkerBroken = true; saveWorker = null; }
    return saveWorker;
  }
  // The finished file, as raw bytes. Built on the worker when there is one,
  // on this thread when there is not (a plain file:// open, say). Prefer
  // this over workspaceJson wherever the caller is about to hand the result
  // to something that takes bytes directly (NGShell.writeFile and a File
  // System Access writable stream both do) - it skips a text decode that is
  // not actually needed just to write a file back out.
  async function workspaceBytes(wsId, overrideName) {
    // A panel's edits are written on a short timer and a stroke is written
    // after the pen lifts; the file has to contain both, or a save can be one
    // sentence behind what is on screen.
    if (wsId === state.ws) { await flushPendingSaves(); await inkWrites; }
    await DB.flush();                              // the worker reads storage, so commit first
    const w = getSaveWorker();
    if (w) {
      const wsRec = await DB.getWorkspace(wsId);
      const id = ++saveJobId;
      const t0 = performance.now();
      try {
        const res = await new Promise((resolve, reject) => {
          saveJobs.set(id, { resolve, reject });
          w.postMessage({ id, ws: wsId, name: overrideName, color: (wsRec && wsRec.color) || PALETTE[0] });
          setTimeout(() => { if (saveJobs.has(id)) { saveJobs.delete(id); reject(new Error('the save worker did not answer')); } }, 30000);
        });
        if (NG.Diag) NG.Diag.metrics.savePayload = { where: 'worker', ms: Math.round(performance.now() - t0), bytes: res.buffer.byteLength };
        return new Uint8Array(res.buffer);
      } catch (e) {
        console.warn('save worker failed, building on the page instead:', e && e.message);
        saveWorkerBroken = true;
      }
    }
    const t1 = performance.now();
    const json = JSON.stringify(await workspacePayload(wsId, overrideName));
    if (NG.Diag) NG.Diag.metrics.savePayload = { where: 'page', ms: Math.round(performance.now() - t1), bytes: json.length };
    return new TextEncoder().encode(json);
  }
  // The finished file as text. Decodes workspaceBytes once - for callers
  // that need an actual string (export's Blob/download path, a page-side
  // JSON.parse, and so on). Callers that are only going to write the result
  // straight back to a file should call workspaceBytes directly instead.
  async function workspaceJson(wsId, overrideName) {
    const bytes = await workspaceBytes(wsId, overrideName);
    return new TextDecoder().decode(bytes);
  }
  const safeFileName = (name) => (String(name || 'workspace').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()) || 'workspace';

  // Download-export (Save As) — works in every browser; always available.
  async function exportWorkspace(wsId, overrideName) {
    wsId = wsId || state.ws;
    if (!wsId) return;
    toast('Preparing export…');
    const w = await DB.getWorkspace(wsId);
    const bytes = await workspaceBytes(wsId, overrideName);
    const fname = `${safeFileName(overrideName || (w && w.name) || 'workspace')}.notesgallery.json`;
    if (SHELL) {                                     // app shell: native Save-As
      const p = await NGShell.saveDialog(fname);
      if (!p) return;
      try { await NGShell.writeFile(p, bytes); toast('Workspace exported'); }
      catch (e) { console.error(e); toast('Could not write the file.'); }
      return;
    }
    const blob = new Blob([bytes], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    toast('Workspace exported');
  }
  /* ------------------------- export as PDF ------------------------------ *
   * One page per level of the workspace: the root canvas, then a page for
   * every block that actually holds something (empty blocks are skipped).
   * Each page draws that level's contents scaled to fit, and a
   * block that has its own page becomes a clickable link to it, so the PDF
   * navigates like the app does.                                           */
  const PDF_PAGE = { w: 842, h: 595, margin: 34 };          // A4 landscape, points
  const PDF_THEMES = {
    light: { page: '#ffffff', text: '#12151c', dim: '#5b6472', faint: '#8b93a1', rule: '#d8dde5',
             card: '#ffffff', cardLine: '#d8dde5', tableHead: '#f1f4f8', grid: '#dbe1e9', ph: '#eef1f5' },
    dark:  { page: '#12151b', text: '#e9edf4', dim: '#a8b1c0', faint: '#7c8798', rule: '#2b313c',
             card: '#191d25', cardLine: '#2b313c', tableHead: '#1e242e', grid: '#2b313c', ph: '#1e242e' },
  };

  // A block earns its own page only when there is something inside it —
  // an empty block would just be a blank page, so it stays on its parent's.
  function hasOwnPage(b, kids) { return kids > 0; }

  // Convert any image source to raw JPEG bytes for embedding.
  async function srcToJpeg(src, maxPx, bg) {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej;
      i.src = src;
    });
    const scale = Math.min(1, (maxPx || 1400) / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const cw = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const ch = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = bg || '#ffffff'; ctx.fillRect(0, 0, cw, ch);   // PDF JPEGs have no alpha
    ctx.drawImage(img, 0, 0, cw, ch);
    const url = cv.toDataURL('image/jpeg', 0.86);
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, w: cw, h: ch };
  }

  async function exportWorkspacePdf(wsId, overrideName, mode) {
    const TH = PDF_THEMES[mode === 'dark' ? 'dark' : 'light'];
    wsId = wsId || state.ws;
    if (!wsId || !window.NGPdf) { toast('PDF export is unavailable here.'); return; }
    toast('Building PDF…');
    await new Promise(r => setTimeout(r, 30));               // let the toast paint

    const w = await DB.getWorkspace(wsId);
    const blocks = await DB.allByWs('blocks', wsId);
    const edges = await DB.allByWs('edges', wsId);
    const wsFiles = await DB.allByWs('files', wsId);
    const kidsOf = (id) => blocks.filter(b => b.parentId === id);
    const countOf = {};
    blocks.forEach(b => { countOf[b.parentId] = (countOf[b.parentId] || 0) + 1; });
    countOf.__files = {};
    wsFiles.forEach(f => { countOf.__files[f.blockId] = (countOf.__files[f.blockId] || 0) + 1; });

    // 1. walk the tree depth-first so pages read in navigation order
    const levels = [];                                       // { id, title, path, blocks }
    const pageOf = {};                                       // level id -> page index
    const outline = [];                                      // bookmarks, same shape as the tree
    (function walk(id, title, trail, into) {
      pageOf[id] = levels.length;
      const node = { title, page: levels.length, children: [] };
      into.push(node);
      const kids = kidsOf(id);
      levels.push({ id, title, path: trail, blocks: kids });
      kids.slice()
        .sort((a, b) => (a.y - b.y) || (a.x - b.x))
        .forEach(k => {
          if (hasOwnPage(k, countOf[k.id] || 0)) walk(k.id, blockLabel(k), trail.concat(blockLabel(k)), node.children);
        });
    })(DB.ROOT, (w && w.name) || 'Workspace', [(w && w.name) || 'Workspace'], outline);

    // 2. pre-render every image once
    const imgCache = {};
    const doc = NGPdf.createDoc({ width: PDF_PAGE.w, height: PDF_PAGE.h });
    for (const b of blocks) {
      if (b.kind === 'image' && b.src && !imgCache[b.id]) {
        try { const j = await srcToJpeg(b.src, 1400, TH.page); imgCache[b.id] = doc.addImage(j.bytes, j.w, j.h); }
        catch (_) { /* unreadable image: it just draws as a placeholder */ }
      }
    }

    // 3. draw the pages
    levels.forEach((lvl, idx) => {
      const page = doc.page();
      page.rect(0, 0, PDF_PAGE.w, PDF_PAGE.h, { fill: TH.page });     // page ground
      drawPdfHeader(page, lvl, idx + 1, levels.length, TH);
      drawPdfLevel(page, lvl, pageOf, countOf, imgCache, TH, edges);
    });

    doc.setOutline(outline);                                 // sidebar navigation
    const bytes = doc.build();
    const fname = `${safeFileName(overrideName || (w && w.name))}.pdf`;
    if (SHELL) {
      const p = await NGShell.saveDialog(fname);
      if (!p) return;
      try { await NGShell.writeFile(p, bytes); toast(`PDF exported — ${levels.length} page${levels.length === 1 ? '' : 's'}`); }
      catch (e) { console.error(e); toast('Could not write the PDF.'); }
      return;
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`PDF exported — ${levels.length} page${levels.length === 1 ? '' : 's'}`);
  }

  const blockLabel = (b) => {
    const t = (b.title || '').trim();
    if (t) return t;
    if (b.kind === 'text') return (b.text || '').trim().split('\n')[0].slice(0, 40) || 'Text';
    if (b.kind === 'table') return 'Table';
    if (b.kind === 'image') return 'Image';
    if (b.kind === 'check') return b.checked ? 'Checkbox (ticked)' : 'Checkbox';
    if (b.kind === 'ink') return 'Drawing';
    if (b.kind === 'shape') return b.shape ? b.shape[0].toUpperCase() + b.shape.slice(1) : 'Shape';
    return 'Untitled';
  };

  function drawPdfHeader(page, lvl, no, total, TH) {
    const M = PDF_PAGE.margin;
    page.text(lvl.path.join('  >  '), M, 20, { size: 9, color: TH.dim, maxWidth: PDF_PAGE.w - M * 2 - 60, maxLines: 1 });
    page.text(`${no} / ${total}`, PDF_PAGE.w - M - 60, 20, { size: 9, color: TH.dim, maxWidth: 60, align: 'right' });
    page.text(lvl.title, M, 32, { size: 15, bold: true, color: TH.text, maxWidth: PDF_PAGE.w - M * 2, maxLines: 1 });
    page.path([[M, 58], [PDF_PAGE.w - M, 58]], { stroke: TH.rule, width: 0.7 });
  }

  // Draw one level's blocks, scaled so everything fits inside the page.
  function drawPdfLevel(page, lvl, pageOf, countOf, imgCache, TH, edges) {
    const M = PDF_PAGE.margin, top = 68;
    const areaW = PDF_PAGE.w - M * 2, areaH = PDF_PAGE.h - top - M;
    if (!lvl.blocks.length) {
      page.text('(empty)', M, top + 10, { size: 10, color: TH.faint });
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const sizeOf = (b) => {
      const el = state.els[b.id];
      const s = elSize(b.id, el) || {};
      let w = b.w || s.w || 240;
      let h = b.h || s.h || 120;
      if (b.kind === 'ink') { w = (b.w || 1) + (b.width || 3) * 2 + 4; h = (b.h || 1) + (b.width || 3) * 2 + 4; }
      if (!b.kind || b.kind === 'block') { w = b.w || 260; h = b.h || 128; }
      return [w, h];
    };
    lvl.blocks.forEach(b => {
      const [w, h] = sizeOf(b);
      minX = Math.min(minX, b.x || 0); minY = Math.min(minY, b.y || 0);
      maxX = Math.max(maxX, (b.x || 0) + w); maxY = Math.max(maxY, (b.y || 0) + h);
    });
    const cw = Math.max(1, maxX - minX), ch = Math.max(1, maxY - minY);
    const s = Math.min(areaW / cw, areaH / ch, 1.6);
    const offX = M + (areaW - cw * s) / 2 - minX * s;
    const offY = top + (areaH - ch * s) / 2 - minY * s;
    const X = (x) => offX + x * s, Y = (y) => offY + y * s;

    // connector arrows first, so blocks sit on top of them
    const box = {};
    for (const b of lvl.blocks) {
      const [bw, bh] = sizeOf(b);
      box[b.id] = { x: X(b.x || 0), y: Y(b.y || 0), w: bw * s, h: bh * s };
    }
    for (const e of (edges || [])) {
      const A = box[e.from], B = box[e.to];
      if (!A || !B) continue;                       // both ends must be on this page
      drawPdfEdge(page, A, B, TH);
    }

    for (const b of lvl.blocks) {
      const [bw, bh] = sizeOf(b);
      const x = X(b.x || 0), y = Y(b.y || 0), w = bw * s, h = bh * s;
      drawPdfBlock(page, b, x, y, w, h, s, imgCache, countOf, TH);
      const target = pageOf[b.id];
      if (target != null) {
        page.link(x, y, w, h, target);                        // jump into its page
        drawPdfPageTag(page, b, x, y, w, h, s, target + 1, TH);
      }
    }
  }

  // Connector between two blocks: meets each box on its edge, arrow at the end.
  function drawPdfEdge(page, A, B, TH) {
    const c1 = { x: A.x + A.w / 2, y: A.y + A.h / 2 };
    const c2 = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
    const edgePoint = (box, from, to) => {
      const dx = to.x - from.x, dy = to.y - from.y;
      if (!dx && !dy) return from;
      const hw = box.w / 2, hh = box.h / 2;
      const t = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity,
                         Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
      return { x: from.x + dx * t, y: from.y + dy * t };
    };
    const p1 = edgePoint(A, c1, c2), p2 = edgePoint(B, c2, c1);
    const col = TH.dim;
    page.path([[p1.x, p1.y], [p2.x, p2.y]], { stroke: col, width: 1.1 });
    // arrow head at p2
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x), size = 6.5, spread = 0.42;
    page.path([
      [p2.x, p2.y],
      [p2.x - size * Math.cos(ang - spread), p2.y - size * Math.sin(ang - spread)],
      [p2.x - size * Math.cos(ang + spread), p2.y - size * Math.sin(ang + spread)],
    ], { fill: col, closed: true });
  }

  // A block that opens into its own page wears that page number, so the link
  // is visible on paper too: "p.4" in the block's accent colour.
  function drawPdfPageTag(page, b, x, y, w, h, s, pageNo, TH) {
    const label = 'p.' + pageNo;
    const fs = Math.max(5.5, Math.min(8.5, 9 * s));
    const tw = NGPdf.textWidth(label, fs, true) + fs * 0.9;
    const th = fs * 1.7;
    const bx = x + w - tw - Math.max(1.5, 3 * s);
    const by = y + Math.max(1.5, 3 * s);
    const accent = b.color || PALETTE[0];
    page.rect(bx, by, tw, th, { fill: accent, radius: th / 2 });
    page.text(label, bx, by + (th - fs * 1.1) / 2, {
      size: fs, bold: true, color: '#ffffff', maxWidth: tw, align: 'center', maxLines: 1,
    });
  }

  function drawPdfBlock(page, b, x, y, w, h, s, imgCache, countOf, TH) {
    const accent = b.color || PALETTE[0];
    if (b.kind === 'text') {
      page.text(b.text || '', x, y, {
        size: Math.max(5, (b.size || 16) * s), bold: !!b.bold, color: b.color || TH.text,
        maxWidth: w, maxLines: Math.max(1, Math.floor(h / Math.max(6, (b.size || 16) * s * 1.28))),
        align: b.align === 'center' ? 'center' : b.align === 'right' ? 'right' : 'left',
      });
      return;
    }
    if (b.kind === 'check') {
      page.rect(x, y, w, h, { fill: b.checked ? (b.color || TH.text) : null, stroke: b.color || TH.text, lineWidth: Math.max(.6, 2 * s), radius: w * 0.22 });
      if (b.checked) page.path([[x + w * 0.27, y + h * 0.52], [x + w * 0.42, y + h * 0.67], [x + w * 0.73, y + h * 0.33]], { stroke: '#ffffff', width: Math.max(.8, w * 0.13) });
      return;
    }
    if (b.kind === 'image') {
      const img = imgCache[b.id];
      if (img) page.image(img, x, y, w, h);
      else page.rect(x, y, w, h, { fill: TH.ph, stroke: TH.cardLine, radius: 4 * s });
      if (b.outline) page.rect(x, y, w, h, { stroke: b.outlineColor || TH.text, lineWidth: Math.max(.4, (b.outlineW || 2) * s), radius: (b.round ? 10 : 0) * s });
      return;
    }
    if (b.kind === 'ink') {
      const pad = ((b.width || 3) + 2) * s;
      const pts = (b.pts || []).map(p => [x + pad + p[0] * s, y + pad + p[1] * s]);
      const st = (typeof PEN_STYLES !== 'undefined' && PEN_STYLES[b.style]) ? PEN_STYLES[b.style] : null;
      if (st && st.taper > 0) {
        const d = inkTaperD(pts.map(p => [p[0], p[1]]), (b.width || 3) * s, st.taper);
        // taper outlines are a filled polygon: rebuild it as points for the PDF
        const nums = d.match(/-?\d+(\.\d+)?/g) || [];
        const poly = [];
        for (let i = 0; i + 1 < nums.length; i += 2) poly.push([+nums[i], +nums[i + 1]]);
        page.path(poly, { fill: b.color || accent, closed: true, opacity: st.opacity });
      } else {
        page.path(pts, {
          stroke: b.color || accent, width: Math.max(.3, (b.width || 3) * s),
          smooth: true, opacity: st ? st.opacity : 1,
        });
      }
      return;
    }
    if (b.kind === 'shape') {
      const o = { fill: b.fill === false ? null : (b.color || accent), stroke: b.outline ? (b.outlineColor || TH.text) : null, lineWidth: Math.max(.4, (b.outlineW || 2) * s) };
      if (b.shape === 'circle') page.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, o);
      else if (b.shape === 'triangle') page.path([[x + w / 2, y], [x + w, y + h], [x, y + h]], Object.assign({ closed: true }, o));
      else if (b.shape === 'line') {
        const lw = Math.max(.5, (b.outlineW || 3) * s);
        page.path([[x, y + h / 2], [x + w, y + h / 2]], {
          stroke: b.outlineColor || b.color || accent, width: lw,
          dash: b.dash ? (lw * 0.2).toFixed(1) + ' ' + (lw * 1.9).toFixed(1) : null,
        });
      } else if (b.shape === 'polygon' && Array.isArray(b.points) && b.points.length >= 3) {
        page.path(b.points.map(([px, py]) => [x + px * w, y + py * h]), Object.assign({ closed: true }, o));
      } else page.rect(x, y, w, h, Object.assign({ radius: 4 * s }, o));
      return;
    }
    if (b.kind === 'table') {
      const rows = b.rows || [];
      const cols = Math.max(1, Math.max(...rows.map(r => r.length), 1));
      const rh = h / Math.max(1, rows.length);
      const cwid = w / cols;
      page.rect(x, y, w, h, { fill: TH.card, stroke: TH.cardLine, lineWidth: .6 });
      rows.forEach((row, r) => {
        if (b.header !== false && r === 0) page.rect(x, y + r * rh, w, rh, { fill: TH.tableHead });
        for (let c = 0; c < cols; c++) {
          page.rect(x + c * cwid, y + r * rh, cwid, rh, { stroke: TH.grid, lineWidth: .4 });
          const t = (row[c] == null ? '' : String(row[c]));
          if (t) page.text(t, x + c * cwid + 2 * s, y + r * rh + rh * 0.22, {
            size: Math.max(4, Math.min(9, rh * 0.5)), bold: (b.header !== false && r === 0),
            color: TH.text, maxWidth: cwid - 4 * s, maxLines: 1,
          });
        }
      });
      if (b.title) page.text(b.title, x, y - 12 * s, { size: Math.max(5, 9 * s), bold: true, color: TH.text, maxWidth: w, maxLines: 1 });
      return;
    }
    // default card
    page.rect(x, y, w, h, { fill: TH.card, stroke: TH.cardLine, lineWidth: .8, radius: 9 * s });
    page.rect(x, y, Math.max(2, 3 * s), h, { fill: accent });
    const pad = 10 * s;
    let ty = page.text(blockLabel(b), x + pad + 4 * s, y + pad, {
      size: Math.max(6, 11 * s), bold: true, color: TH.text, maxWidth: w - pad * 2 - 4 * s, maxLines: 2,
    });
    const bodySize = Math.max(5, 8.5 * s);
    const innerW = w - pad * 2 - 4 * s;
    const bottom = y + h - pad - 9 * s;                       // keep clear of the meta line
    const roomLines = () => Math.max(0, Math.floor((bottom - ty) / (bodySize * 1.28)));
    if (b.description && roomLines()) {
      ty = page.text(b.description, x + pad + 4 * s, ty + 3 * s, {
        size: bodySize, color: TH.dim, maxWidth: innerW, maxLines: Math.min(3, roomLines()),
      });
    }
    // the block's own typed notes (markdown body) — shown as plain text
    if (b.notes && String(b.notes).trim() && roomLines()) {
      const plain = String(b.notes)
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/[*_`>]/g, '')
        .replace(/^\s*[-+]\s+\[( |x|X)\]\s*/gm, (m, c) => (c === ' ' ? '[ ] ' : '[x] '))
        .replace(/^\s*[-+]\s+/gm, '- ')
        .trim();
      ty = page.text(plain, x + pad + 4 * s, ty + 3 * s, {
        size: bodySize, color: TH.dim, maxWidth: innerW, maxLines: Math.min(6, roomLines()),
      });
    }
    const tags = String(b.tags || '').split(/[,\s]+/).filter(Boolean).map(t => (t[0] === '#' ? t : '#' + t));
    if (tags.length && roomLines()) {
      ty = page.text(tags.join('  '), x + pad + 4 * s, ty + 3 * s, {
        size: Math.max(4.5, 7.5 * s), color: b.color || PALETTE[0], maxWidth: innerW, maxLines: 2,
      });
    }
    const kids = countOf[b.id] || 0;
    const files = (countOf.__files && countOf.__files[b.id]) || 0;
    const meta = [];
    if (kids) meta.push(kids + ' inside');
    if (files) meta.push(files + (files === 1 ? ' file' : ' files'));
    if (meta.length) page.text(meta.join('  •  '), x + pad + 4 * s, y + h - pad - 8 * s,
      { size: Math.max(5, 7.5 * s), color: TH.faint, maxWidth: innerW, maxLines: 1 });
  }

  /* ---------------- export this level as a picture ---------------------- *
   * Vector SVG (crisp at any size) or PNG for pasting into chats/slides.   */
  function levelToSvg() {
    const blocks = state.blocks.filter(b => b.parentId === state.level);
    if (!blocks.length) return null;
    const PAD = 40;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const boxes = {};
    blocks.forEach(b => {
      const bb = blockBox(b);
      boxes[b.id] = bb;
      minX = Math.min(minX, bb.x); minY = Math.min(minY, bb.y);
      maxX = Math.max(maxX, bb.x + bb.w); maxY = Math.max(maxY, bb.y + bb.h);
    });
    const W = Math.max(1, maxX - minX + PAD * 2), H = Math.max(1, maxY - minY + PAD * 2);
    const ox = PAD - minX, oy = PAD - minY;
    const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#ffffff';
    const ink = getComputedStyle(document.body).getPropertyValue('--text').trim() || '#111111';
    const line = getComputedStyle(document.body).getPropertyValue('--line').trim() || '#d8dde5';
    const dim = getComputedStyle(document.body).getPropertyValue('--text-dim').trim() || '#666';
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}">`);
    out.push(`<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${dim}"/></marker></defs>`);
    out.push(`<rect width="100%" height="100%" fill="${bg}"/>`);

    // connectors first
    state.edges.forEach(e => {
      const A = boxes[e.from], B = boxes[e.to];
      if (!A || !B) return;
      const c1 = { x: A.x + ox + A.w / 2, y: A.y + oy + A.h / 2 };
      const c2 = { x: B.x + ox + B.w / 2, y: B.y + oy + B.h / 2 };
      out.push(`<path d="${edgePathD(e.style, c1, c2)}" fill="none" stroke="${dim}" stroke-width="1.5" marker-end="url(#a)"${e.both ? ' marker-start="url(#a)"' : ''}/>`);
      if (e.label) out.push(`<text x="${(c1.x + c2.x) / 2}" y="${(c1.y + c2.y) / 2}" fill="${dim}" font-family="system-ui,sans-serif" font-size="12" text-anchor="middle">${esc(e.label)}</text>`);
    });

    blocks.forEach(b => {
      const bb = boxes[b.id];
      const x = bb.x + ox, y = bb.y + oy, w = bb.w, h = bb.h;
      const accent = b.color || PALETTE[0];
      if (b.kind === 'ink') {
        const pad = (b.width || 3) + 2;
        const pts = (b.pts || []).map(p => [x + pad + p[0], y + pad + p[1], p[2] || 0]);
        const st = PEN_STYLES[b.style] || PEN_STYLES.pen;
        const d = inkStrokeD(pts, PEN_STYLES[b.style] ? b.style : 'pen', b.width || 3);
        out.push(st.taper > 0
          ? `<path d="${d}" fill="${accent}" opacity="${st.opacity}"/>`
          : `<path d="${d}" fill="none" stroke="${accent}" stroke-width="${b.width || 3}" stroke-linecap="round" stroke-linejoin="round" opacity="${st.opacity}"/>`);
        return;
      }
      if (b.kind === 'image' && b.src) {
        out.push(`<image href="${esc(b.src)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`);
        return;
      }
      if (b.kind === 'check') {
        const c = esc(b.color || accent);
        out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${(w * 0.22).toFixed(1)}" fill="${b.checked ? c : 'none'}" stroke="${c}" stroke-width="2"/>`);
        if (b.checked) out.push(`<path d="M${(x + w * 0.27).toFixed(1)} ${(y + h * 0.52).toFixed(1)}L${(x + w * 0.42).toFixed(1)} ${(y + h * 0.67).toFixed(1)}L${(x + w * 0.73).toFixed(1)} ${(y + h * 0.33).toFixed(1)}" fill="none" stroke="#fff" stroke-width="${(w * 0.13).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
        return;
      }
      if (b.kind === 'text') {
        const size = b.size || 16;
        const lines = String(b.text || '').split('\n');
        out.push(`<text x="${x}" y="${y + size}" fill="${b.color || ink}" font-family="system-ui,sans-serif" font-size="${size}"${b.bold ? ' font-weight="700"' : ''}${b.italic ? ' font-style="italic"' : ''}>`);
        lines.forEach((ln, i) => out.push(`<tspan x="${x}" dy="${i ? size * 1.3 : 0}">${esc(ln)}</tspan>`));
        out.push('</text>');
        return;
      }
      if (b.kind === 'shape') {
        const fill = b.fill ? accent : 'none';
        const stroke = b.outline ? (b.outlineColor || accent) : (b.fill ? 'none' : accent);
        const sw = b.outlineW || 2;
        if (b.shape === 'circle') out.push(`<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
        else if (b.shape === 'line') out.push(`<line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="${b.outlineColor || accent}" stroke-width="${b.outlineW || 4}" stroke-linecap="round"${b.dash ? ` stroke-dasharray="${(b.outlineW || 4) * 0.2} ${(b.outlineW || 4) * 1.9}"` : ''}/>`);
        else if (b.shape === 'triangle') out.push(`<polygon points="${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
        else if (b.shape === 'polygon' && Array.isArray(b.points)) out.push(`<polygon points="${b.points.map(([px, py]) => `${x + px * w},${y + py * h}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
        else out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
        return;
      }
      if (b.kind === 'table') {
        const rows = b.rows || [];
        const cols = Math.max(1, Math.max(...rows.map(r => r.length), 1));
        const rh = h / Math.max(1, rows.length), cw = w / cols;
        out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}" stroke="${line}"/>`);
        rows.forEach((row, r) => {
          for (let c = 0; c < cols; c++) {
            out.push(`<rect x="${x + c * cw}" y="${y + r * rh}" width="${cw}" height="${rh}" fill="none" stroke="${line}" stroke-width="0.7"/>`);
            const t = row[c] == null ? '' : String(row[c]);
            if (t) out.push(`<text x="${x + c * cw + 5}" y="${y + r * rh + rh * 0.66}" fill="${ink}" font-family="system-ui,sans-serif" font-size="${Math.min(13, rh * 0.5)}"${r === 0 && b.header !== false ? ' font-weight="700"' : ''}>${esc(t)}</text>`);
          }
        });
        return;
      }
      // card
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${bg}" stroke="${line}"/>`);
      out.push(`<rect x="${x}" y="${y}" width="4" height="${h}" fill="${accent}"/>`);
      out.push(`<text x="${x + 16}" y="${y + 28}" fill="${ink}" font-family="system-ui,sans-serif" font-size="15" font-weight="700">${esc(blockLabel(b))}</text>`);
      if (b.description) out.push(`<text x="${x + 16}" y="${y + 50}" fill="${dim}" font-family="system-ui,sans-serif" font-size="12">${esc(String(b.description).slice(0, 46))}</text>`);
    });
    out.push('</svg>');
    return { svg: out.join(''), w: Math.round(W), h: Math.round(H) };
  }

  async function exportLevelImage(kind) {
    const made = levelToSvg();
    if (!made) { toast('Nothing on this level to export.'); return; }
    const name = safeFileName(state.wsName || 'workspace') + '-' + (state.levelBlock ? safeFileName(state.levelBlock.title || 'level') : 'home');
    if (kind === 'svg') {
      await saveExport(new Blob([made.svg], { type: 'image/svg+xml' }), name + '.svg', made.svg);
      return;
    }
    const scale = 2;                                   // crisp on high-dpi screens
    const img = new Image();
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(made.svg);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const cv = document.createElement('canvas');
    cv.width = made.w * scale; cv.height = made.h * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    await saveExport(blob, name + '.png');
  }

  // Save a generated file: native dialog in the app, download on the web.
  async function saveExport(blob, filename, textForShell) {
    if (SHELL) {
      const path = await NGShell.saveDialog(filename);
      if (!path) return;
      const data = textForShell != null ? textForShell : new Uint8Array(await blob.arrayBuffer());
      try { await NGShell.writeFile(path, data); toast('Saved'); }
      catch (err) { console.error(err); toast('Could not write the file.'); }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Exported ' + filename);
  }

  /* --------------------------- outline sidebar -------------------------- *
   * The whole workspace as a tree — the same shape the PDF bookmarks use.  */
  let outlineOpen = false;
  // The whole-workspace fetch below is real work; re-running it on every
  // 250ms redraw while the panel just sits open would mean paying it
  // continuously for however long you keep writing. Cache it per open and,
  // for the periodic live redraw, patch in this level's blocks from
  // `state.blocks` (already correct in memory) instead of asking the
  // database again - a fresh fetch only happens when the panel is opened.
  let outlineCache = { ws: null, all: null };
  async function toggleOutline(force) {
    const wasOpen = outlineOpen;
    outlineOpen = force === undefined ? !outlineOpen : !!force;
    $('#outline').hidden = !outlineOpen;
    $('#btn-outline')?.classList.toggle('active', outlineOpen);
    if (outlineOpen) {
      if (!wasOpen) outlineCache = { ws: null, all: null };
      await renderOutline();
    }
  }
  async function renderOutline() {
    const tree = $('#outline-tree'); if (!tree || !state.ws) return;
    if (outlineCache.ws !== state.ws) {
      outlineCache = { ws: state.ws, all: await DB.allByWs('blocks', state.ws) };
    } else {
      outlineCache.all = outlineCache.all.filter(b => b.parentId !== state.level).concat(state.blocks);
    }
    const all = outlineCache.all;
    const kidsOf = (id) => all.filter(b => b.parentId === id).sort((a, b) => (a.y - b.y) || (a.x - b.x));
    tree.innerHTML = '';
    const add = (id, title, colour, depth) => {
      const kids = kidsOf(id);
      const row = document.createElement('button');
      row.className = 'outline-row' + (id === state.level ? ' here' : '');
      row.style.paddingLeft = (8 + depth * 14) + 'px';
      row.innerHTML = `<span class="outline-dot" style="background:${esc(colour || PALETTE[0])}"></span>` +
                      `<span class="outline-name">${esc(title)}</span>` +
                      (kids.length ? `<span class="outline-count">${kids.length}</span>` : '');
      row.addEventListener('click', async () => {
        await navigateTo(id === DB.ROOT ? DB.ROOT : id);
        renderOutline();
      });
      tree.appendChild(row);
      // every block that can hold things - not the loose text, shapes, images,
      // strokes and tables, which would swamp the tree
      kids.forEach(k => { if (opensInside(k)) add(k.id, blockLabel(k), k.color, depth + 1); });
    };
    add(DB.ROOT, state.wsName || 'Workspace', PALETTE[0], 0);
  }
  // Redraw soon after any change while the outline is open.
  let outlineTimer = null;
  function scheduleOutline() {
    if (!outlineOpen) return;
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => { if (outlineOpen) renderOutline(); }, 250);
  }
  // A tap anywhere else puts the outline away; the breadcrumbs sit over its
  // foot and can still be used without closing it.
  function bindOutlineDismiss() {
    document.addEventListener('pointerdown', (e) => {
      if (!outlineOpen) return;
      if (e.target.closest('#outline, #btn-outline, #bottombar, #menu, #cmdk, .modal, .drawer')) return;
      toggleOutline(false);
    }, true);
  }

  /* ------------------------------ auto tidy ----------------------------- *
   * Lay this level's blocks out on a clean grid, biggest rows first.       */
  async function tidyLevel() {
    if (state.levelLayout !== 'canvas') { toast('Switch to canvas view to tidy.'); return; }
    // Tidy what you picked (or the whole level if nothing is picked), and
    // leave handwriting alone — a grid would tear words apart.
    const picked = new Set(state.selectedIds);
    const blocks = state.blocks.filter(b =>
      b.parentId === state.level && !b.locked && b.kind !== 'ink' &&
      (!picked.size || picked.has(b.id)));
    if (blocks.length < 2) { toast(picked.size ? 'Pick two or more blocks to tidy.' : 'Nothing to tidy here.'); return; }
    const undoBefore = { blocks: blocks.map(b => ({ ...b })), edges: [], files: [] };
    const boxes = blocks.map(b => ({ b, ...blockBox(b) }));
    boxes.sort((p, q) => (p.y - q.y) || (p.x - q.x));      // keep roughly the order you had
    const GAP = 40;
    const colW = Math.max(...boxes.map(o => o.w));
    const perRow = Math.max(1, Math.ceil(Math.sqrt(boxes.length)));
    const startX = Math.min(...boxes.map(o => o.x));
    const startY = Math.min(...boxes.map(o => o.y));
    let x = startX, y = startY, rowH = 0, col = 0;
    for (const o of boxes) {
      o.b.x = Math.round(x); o.b.y = Math.round(y);
      o.b.updatedAt = Date.now();
      await DB.saveBlock(o.b);
      const el = state.els[o.b.id];
      if (el) { el.style.left = o.b.x + 'px'; el.style.top = o.b.y + 'px'; }
      rowH = Math.max(rowH, o.h);
      col++;
      if (col >= perRow) { col = 0; x = startX; y += rowH + GAP; rowH = 0; }
      else x += colW + GAP;
    }
    recordChange(undoBefore, { blocks: blocks.map(b => ({ ...b })), edges: [], files: [] });
    drawEdges(); positionSelBar(); markChanged();
    toast('Tidied ' + boxes.length + ' blocks');
  }

  /* --------------------------- presentation mode ------------------------ *
   * Walk the workspace one level at a time, full screen.                   */
  let presenting = null;        // { stops: [{id,title}], at }
  async function startPresenting() {
    if (!state.ws) { toast('Open a workspace first.'); return; }
    const all = await DB.allByWs('blocks', state.ws);
    const kidsOf = (id) => all.filter(b => b.parentId === id).sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const stops = [];
    (function walk(id, title) {
      stops.push({ id, title });
      kidsOf(id).forEach(k => { if (kidsOf(k.id).length) walk(k.id, blockLabel(k)); });
    })(DB.ROOT, state.wsName || 'Workspace');
    presenting = { stops, at: 0 };
    document.getElementById('app').classList.add('presenting');
    $('#present-bar').hidden = false;
    clearSelection();
    await gotoStop(0);
  }
  async function gotoStop(i) {
    if (!presenting) return;
    presenting.at = clamp(i, 0, presenting.stops.length - 1);
    const stop = presenting.stops[presenting.at];
    await navigateTo(stop.id);            // navigateTo already fits the view
    $('#pres-where').textContent = `${stop.title}  ·  ${presenting.at + 1} / ${presenting.stops.length}`;
  }
  function stopPresenting() {
    presenting = null;
    document.getElementById('app').classList.remove('presenting');
    $('#present-bar').hidden = true;
  }

  function exportWorkspacePdfFlow(wsId) {
    const id = wsId || state.ws;
    if (!id) { toast('Open a workspace first.'); return; }
    DB.getWorkspace(id).then(w => {
      promptDialog('Export PDF', (w && w.name) || 'Workspace', (name, _c, _t, theme) => {
        exportWorkspacePdf(id, (name || '').trim() || (w && w.name) || 'Workspace', theme);
      }, { themes: true, theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', okLabel: 'Export' });
    });
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
  // In the desktop/mobile app, NGShell (js/platform.js) provides native dialogs
  // and direct file access — full paths, no browser permission prompts.
  const SHELL = !!window.NGShell;
  // file:// exposes the method names but throws on call; require a secure http(s)/localhost context.
  const FS_OK = SHELL || (('showSaveFilePicker' in window) && ('showOpenFilePicker' in window)
    && window.isSecureContext && location.protocol !== 'file:');
  // Folder-of-files workspace storage (js/workspacefs.js) — app shell only.
  // The website keeps IndexedDB + a single exported JSON file; it never had
  // the "autosave rewrites the whole workspace" cost this exists to avoid.
  const wsFs = SHELL ? NG.WorkspaceFS.makeApi(NGShell) : null;
  const WS_FOLDER_SUFFIX = '.ngws';

  // Write only what changed since the last folder save (from wsDirty, filled
  // in by recordChange) into `folder`. Snapshots and clears the workspace's
  // dirty set first so edits arriving while this write is in flight start a
  // fresh one, rather than being silently folded into (or lost from) this
  // write.
  async function saveWorkspaceFolderDelta(wsId, folder) {
    // No dirty set yet for this workspace means tracking never saw its
    // current content - either this is the first save after it was created
    // or opened this session (a freshly-seeded template's blocks are written
    // straight to the DB, not through recordChange, so nothing tracked them),
    // or the app just (re)started and lost its in-memory tracking entirely.
    // Either way the only correct move is a full write, not an empty delta -
    // an untracked workspace is not the same thing as an unchanged one.
    const tracked = wsDirty.has(wsId);
    const d = wsDirty.get(wsId) || null;
    wsDirty.delete(wsId);
    const w = await DB.getWorkspace(wsId);
    const manifest = { name: (w && w.name) || 'Workspace', color: (w && w.color) || PALETTE[0], paper: (w && w.paper) || 'dots', version: 1 };
    const dirtyBlocks = [], deletedBlockIds = [];
    const newFiles = [], deletedFileIds = [];
    let edgesDirty, edges;
    if (tracked) {
      for (const [id, rec] of d.blocks) { if (rec) dirtyBlocks.push({ ...rec, ws: undefined }); else deletedBlockIds.push(id); }
      for (const [id, rec] of d.files) {
        if (rec) newFiles.push({
          id: rec.id, blockId: rec.blockId, name: rec.name, type: rec.type, size: rec.size, kind: rec.kind,
          createdAt: rec.createdAt, data: rec.blob ? await blobToDataUrl(rec.blob) : null,
        });
        else deletedFileIds.push(id);
      }
      edgesDirty = d.edgesDirty;
      edges = edgesDirty ? (await DB.allByWs('edges', wsId)).map(NGPayload.edgeOut) : undefined;
    } else {
      const [allBlocks, allEdges, allFiles] = await Promise.all([
        DB.allByWs('blocks', wsId), DB.allByWs('edges', wsId), DB.allByWs('files', wsId),
      ]);
      for (const b of allBlocks) dirtyBlocks.push({ ...b, ws: undefined });
      for (const f of allFiles) newFiles.push({
        id: f.id, blockId: f.blockId, name: f.name, type: f.type, size: f.size, kind: f.kind,
        createdAt: f.createdAt, data: f.blob ? await blobToDataUrl(f.blob) : null,
      });
      edgesDirty = true;
      edges = allEdges.map(NGPayload.edgeOut);
    }
    try {
      await wsFs.saveDelta(folder, { manifest, manifestDirty: true, dirtyBlocks, deletedBlockIds, edges, edgesDirty, newFiles, deletedFileIds });
      if (!wsDirty.has(wsId)) wsDirtyFor(wsId);     // tracking is live from here on - future saves may go back to a real delta
    } catch (e) {
      // put back what this write did not manage to persist, so the next
      // save (autosave or manual) retries exactly what is still unwritten
      const cur = wsDirtyFor(wsId);
      for (const b of dirtyBlocks) if (!cur.blocks.has(b.id)) cur.blocks.set(b.id, b);
      for (const id of deletedBlockIds) if (!cur.blocks.has(id)) cur.blocks.set(id, null);
      for (const f of newFiles) if (!cur.files.has(f.id)) cur.files.set(f.id, f);
      for (const id of deletedFileIds) if (!cur.files.has(id)) cur.files.set(id, null);
      if (edgesDirty) cur.edgesDirty = true;
      throw e;
    }
  }
  function fsStatus() {
    if (SHELL) return { ok: true, why: 'workspaces are saved as files on this computer' };
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
  // `json` is the finished file text (built on the worker when there is one).
  // `data` may be bytes (preferred - skips a text decode neither Blob nor
  // the writable stream actually needs) or a string; Blob accepts either.
  async function writeToHandle(handle, data) {
    const writable = await handle.createWritable();
    await writable.write(new Blob([data], { type: 'application/json' }));
    await writable.close();
  }

  // Turn a parsed workspace file into a NEW workspace in the DB. Returns its id.
  async function createWorkspaceFromData(data) {
    const wsId = uid();
    const now = Date.now();
    const count = (await DB.listWorkspaces()).length;
    const name = (data.workspace && data.workspace.name) || 'Imported workspace';
    const color = (data.workspace && data.workspace.color) || pickWsColor(count);
    const paper = (data.workspace && data.workspace.paper) || 'dots';
    await DB.saveWorkspace({ id: wsId, name, color, paper, createdAt: now, updatedAt: now, usedAt: now });
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
      await DB.saveEdge(edgeIn({ id: uid(), ws: wsId, parentId, from, to, createdAt: e.createdAt || now }, e));
    }
    let skipped = 0;
    for (const f of (data.files || [])) {
      const blockId = idMap.get(f.blockId);
      if (!blockId) continue;
      // A file whose contents did not travel (a hand-edited export, a copy
      // trimmed for size) is left out rather than stored as an empty blob
      // that still claims a name and a size.
      let blob = null;
      if (f.data) { try { blob = await dataUrlToBlob(f.data); } catch (_) { blob = null; } }
      if (!blob || !blob.size) { skipped++; continue; }
      await DB.saveFile({ id: uid(), ws: wsId, blockId, name: f.name, type: f.type || blob.type, size: blob.size, kind: f.kind, blob, createdAt: f.createdAt || now });
    }
    await DB.flush();                          // the import is committed before anything opens it
    return { wsId, name, skipped };
  }
  function validWorkspaceData(data) {
    return data && (data.app === 'NotesGallery' || data.app === 'BlockNotes') && Array.isArray(data.blocks);
  }

  const isWorkspaceFile = (f) => /\.json$/i.test(f.name || '') || f.type === 'application/json';
  // After an import: say so, refresh Home, and from inside a workspace offer to
  // jump to the new one (what is open stays saved).
  async function afterImport(wsId, name, linked, skipped) {
    toast(`Imported “${name}”` + (linked ? ' (linked to file)' : '')
      + (skipped ? ` \u2014 ${skipped} attachment${skipped > 1 ? 's' : ''} had no contents` : ''));
    await renderHome();
    if (state.ws != null) {
      confirmDialog(`Imported “${esc(name)}”`, 'Open it now? What you are working on stays saved.', 'Open',
        () => openWorkspace(wsId), 'primary');
    }
  }
  // Fallback import (no file link) via a normal file input.
  async function importWorkspaceFile(file) {
    let text;
    try { text = await file.text(); }
    catch (e) { toast('Could not read that file: ' + ((e && e.message) || e)); return; }
    let data;
    try { data = JSON.parse(text); }
    catch (_) { toast('That file is not valid JSON.'); return; }
    if (!validWorkspaceData(data)) { toast('Not a Notes Gallery workspace file.'); return; }
    const { wsId, name, skipped } = await createWorkspaceFromData(data);
    await afterImport(wsId, name, false, skipped);
  }

  // Import via the File System Access API and BIND the file so edits save back.
  async function importViaPicker() {
    if (SHELL) {                                     // app shell: native open dialog, keep the full path
      const path = await NGShell.openDialog();
      if (!path) return;
      let text;
      try { text = await NGShell.readFile(path); }
      catch (e) { toast('Could not read that file: ' + ((e && e.message) || e)); return; }
      let data;
      try { data = JSON.parse(text); }
      catch (_) { toast('That file is not valid JSON.'); return; }
      if (!validWorkspaceData(data)) { toast('Not a Notes Gallery workspace file.'); return; }
      const { wsId, name, skipped } = await createWorkspaceFromData(data);
      // Re-home the imported content as a workspace folder under the app's
      // own storage, instead of linking straight to the file it came from -
      // this workspace is now stored the same way any other one made in this
      // app is. `path` (from the file-open dialog) is only where the content
      // was read from - on Android it can be an opaque SAF content:// URI,
      // not something a sibling folder can be derived from, so it plays no
      // part in where the folder goes (see NGShell.appWorkspacesDir). The
      // link is written and flushed before anything else touches this
      // workspace, so it can never come up "imported but not linked".
      let linked = false, folder = null;
      try {
        const base = await NGShell.appWorkspacesDir();
        folder = NGShell.pathJoin(base, safeFileName(name) + '-' + wsId.slice(0, 8) + WS_FOLDER_SUFFIX);
        const w = await DB.getWorkspace(wsId);
        await wsFs.init(folder, { name: (w && w.name) || name, color: (w && w.color) || PALETTE[0], paper: (w && w.paper) || 'dots', version: 1 });
        await DB.saveFolderRec(wsId, folder);
        await DB.flush();
        linked = true;
      } catch (e) { console.warn('workspace folder init failed on import:', e); }
      if (linked) await saveWorkspaceFolderDelta(wsId, folder);   // write the imported content in immediately
      await afterImport(wsId, name, linked, skipped);
      return;
    }
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
    let text;
    try { text = await (await handle.getFile()).text(); }
    catch (e) { toast('Could not read that file: ' + ((e && e.message) || e)); return; }
    let data;
    try { data = JSON.parse(text); }
    catch (_) { toast('That file is not valid JSON.'); return; }
    if (!validWorkspaceData(data)) { toast('Not a Notes Gallery workspace file.'); return; }
    const { wsId, name, skipped } = await createWorkspaceFromData(data);
    await DB.saveHandleRec(wsId, handle);   // future saves write back to this file
    await afterImport(wsId, name, true, skipped);
  }

  /* ---- autosave / manual (Ctrl+S) save -------------------------------- */
  let autoSaveTimer = null;
  let autosaveDue = 0;                 // when a deferred autosave must run at the latest
  // Serialising the whole workspace in the pause between two words is exactly
  // when it hurts, so autosave waits until no gesture is live. A 10 s deadline
  // still guarantees the write even if a gesture flag ever sticks.
  function autosaveTick() {
    autoSaveTimer = null;
    const busy = inking || erasing || dragging || gizmo || selScale || lasso || panning || pinch
      || (performance.now() - lastPointerUpAt < 1500);          // the hand has only just lifted
    if (busy && Date.now() < autosaveDue) { autoSaveTimer = setTimeout(autosaveTick, 900); return; }
    autosaveDue = 0;
    saveCurrentWorkspace(false);
  }
  // One write at a time: a save requested while one is running goes after it
  // (the newest state wins, and two writers never race on the same file).
  let saveRun = null, saveNext = null;
  function saveCurrentWorkspace(manual) {
    if (saveRun) {
      // a request is for the workspace open now; one queued for another is superseded
      const same = saveNext && saveNext.ws === state.ws;
      saveNext = { ws: state.ws, manual: !!manual || !!(same && saveNext.manual) };
      return saveRun;
    }
    saveRun = saveWorkspaceNow(manual).catch(() => {}).finally(() => {
      saveRun = null;
      const n = saveNext; saveNext = null;
      if (n && n.ws != null && n.ws === state.ws) saveCurrentWorkspace(n.manual);
    });
    return saveRun;
  }
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
  // Explain a failed file write and offer the one thing that fixes it:
  // pointing the workspace at a file we can actually write.
  let saveFailShown = false;
  function reportSaveFailure(err, manual, where) {
    const why = (err && (err.message || String(err))) || 'unknown error';
    console.error('workspace save failed:', err);
    state.dirty = true; setSaveState();
    if (!manual && saveFailShown) return;          // don't nag on every autosave
    saveFailShown = true;
    const canRelink = SHELL || FS_OK;
    confirmDialog(
      'Could not save to the linked file',
      `Your notes are safe inside the app — only the copy on disk failed.` +
      (where ? `<br><br><span class="muted">${esc(where)}</span>` : '') +
      `<br><br><span class="muted">${esc(why)}</span>` +
      (canRelink ? '<br><br>Choose a new location for this file?' : ''),
      canRelink ? 'Choose location…' : 'OK',
      async () => {
        if (!canRelink) return;
        if (SHELL) await relinkWorkspace(state.ws);
        else await linkWorkspaceFile(state.ws);
        saveFailShown = false;
      });
  }

  async function saveWorkspaceNow(manual) {
    if (state.ws == null) return;
    const wsId = state.ws;                         // this write is for this workspace, whatever happens meanwhile
    const rec = await DB.getHandleRec(wsId);
    if (SHELL && rec && rec.folder) {                // app shell: folder-of-files workspace (js/workspacefs.js)
      try {
        const t0 = performance.now();
        await saveWorkspaceFolderDelta(wsId, rec.folder);
        if (NG.Diag) NG.Diag.metrics.save = { payloadMs: 0, writeMs: performance.now() - t0, bytes: 0, at: performance.now() };
        if (state.ws === wsId) { state.dirty = false; setSaveState(); }
        saveFailShown = false;
      } catch (e) {
        reportSaveFailure(e, manual, rec.folder);
      }
      return;
    }
    if (SHELL && rec && rec.path) {                 // app shell: legacy single-file link, write straight to the path
      try {
        // Bytes straight through, never decoded to a string - this is the
        // hottest of every save path (it fires repeatedly while you are
        // actively writing, not once), and NGShell.writeFile already takes
        // raw bytes directly, so there is nothing a string would buy here.
        const t0 = performance.now();
        const bytes = await workspaceBytes(wsId);
        const t1 = performance.now();
        await NGShell.writeFile(rec.path, bytes);
        if (NG.Diag) NG.Diag.metrics.save = { payloadMs: t1 - t0, writeMs: performance.now() - t1, bytes: bytes.byteLength, at: performance.now() };
        if (state.ws === wsId) { state.dirty = false; setSaveState(); }
        saveFailShown = false;
      } catch (e) {
        reportSaveFailure(e, manual, rec.path);
      }
      return;
    }
    if (!rec || !rec.handle) {
      state.dirty = false;
      setSaveState();
      if (manual) toast('This workspace has no linked file — use ⋯ → Export to save a copy.');
      return;
    }
    const ok = await ensurePermission(rec.handle, 'readwrite');
    if (!ok) {
      // Browsers only re-grant file permission during a click, so an autosave
      // can never do it: flag it and ask next time the user saves by hand.
      state.dirty = true; setSaveState();
      if (manual) {
        reportSaveFailure(new Error('The browser needs permission to write this file again.'),
                          true, (rec.handle && rec.handle.name) || '');
      }
      return;
    }
    try {
      const t0 = performance.now();
      const bytes = await workspaceBytes(wsId);
      const t1 = performance.now();
      await writeToHandle(rec.handle, bytes);
      if (NG.Diag) NG.Diag.metrics.save = { payloadMs: t1 - t0, writeMs: performance.now() - t1, bytes: bytes.byteLength, at: performance.now() };
      if (state.ws === wsId) { state.dirty = false; setSaveState(); }
      saveFailShown = false;
    } catch (e) {
      reportSaveFailure(e, manual, (rec.handle && rec.handle.name) || '');
    }
  }
  // called after any edit; schedules a save (autosave) or flags dirty (manual)
  // before/after (when the caller has them, from recordChange) are the exact
  // records that changed, so the mini-map can patch just their patch of the
  // page instead of redrawing all of it; omit them and it falls back to that.
  function markChanged(before, after) {
    if (state.ws == null) return;
    if (!previewFlagged.has(state.ws)) flagPreviewStale(state.ws);   // the card's snapshot is behind the page now
    mmMarkDirty(before, after); scheduleMinimap();
    scheduleOutline();
    scheduleVirtApply();
    if (state.autosave) {
      clearTimeout(autoSaveTimer);
      if (!autosaveDue) autosaveDue = Date.now() + 10000;
      autoSaveTimer = setTimeout(autosaveTick, (state.penMode || state.penEraser) ? 2500 : 900);
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
        applyPaper(w.paper);                       // a refresh lands here, not in openWorkspace
        touchWorkspaceUse(loc.ws);
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

  // Everything still owed to this workspace's file, before we stop being in
  // it. Leaving used to cancel the pending autosave without running it, so an
  // edit made in the last second reached the records but never the file.
  async function settleWorkspaceFile(wsId) {
    if (wsId == null) return;
    await flushPendingSaves();              // a panel edit still on its timer is committed either way
    const owed = !!autoSaveTimer || !!saveRun || state.dirty || DB.pendingWrites() > 0;
    clearTimeout(autoSaveTimer); autoSaveTimer = null; autosaveDue = 0;
    if (!owed) return;
    if (state.autosave) {
      try {
        await saveCurrentWorkspace(false);
        while (saveRun) await saveRun;        // a save queued behind that one still has to run
      } catch (_) {}
      return;
    }
    // Manual saving: the records are safe, the file is not up to date. Say so
    // instead of clearing the flag and looking saved.
    await DB.flush();
    try {
      const rec = await DB.getHandleRec(wsId);
      if (rec && (rec.folder || rec.path || rec.handle)) toast('Not saved to its file yet \u2014 press Ctrl+S in the workspace');
    } catch (_) {}
  }

  async function goHome() {
    const leaving = state.ws;                 // its card gets a fresh snapshot once the home is up
    dropLiveGestures(); lastInk = null;
    await inkWrites;                          // a stroke still being written is recorded before the history goes
    await settleWorkspaceFile(leaving);       // and its file gets that last edit before we go
    saveNext = null;                          // a save queued for this workspace does not fire in the next
    state.ws = null; state.wsName = '';
    clearHistory();
    closeDrawer(); hideSearchResults(); closeSearch();
    $('#menu').hidden = true; $('#add-menu').hidden = true; $('#brand-menu').hidden = true;
    if (state.linkMode) setLinkMode(false);
    if (state.penMode) setPenMode(false);
    if (state.penEraser) setEraser(false, true);
    if (state.selectTool) setSelectMode(false);
    clearTimeout(autoSaveTimer); autoSaveTimer = null; autosaveDue = 0;
    fileDataCache.clear(); fileDataBytes = 0; _mmImgCache.clear();
    state.dirty = false;
    setSaveState('', '');
    document.getElementById('app').classList.add('home-mode');
    $('#stage').hidden = true;
    $('#home').hidden = false;
    saveLoc();
    await renderHome();
    startTyping();
    if (leaving) queuePreview(leaving, true);
  }

  // "Last used" is its own stamp: updatedAt only moves when the workspace's
  // own properties change, so opening or editing a page would never reorder
  // the landing. One write per open, off every hot path.
  function touchWorkspaceUse(wsId) {
    if (!wsId) return;
    DB.getWorkspace(wsId).then(w => {
      if (!w) return undefined;
      w.usedAt = Date.now();
      return DB.saveWorkspace(w);
    }).catch(() => {});
  }
  const wsLastUse = (w) => Math.max(w.usedAt || 0, w.updatedAt || 0);

  async function openWorkspace(id) {
    const w = await DB.getWorkspace(id);
    if (!w) return;
    const leaving = state.ws !== id ? state.ws : null;   // switching pages: the old one's card is redrawn after the load
    dropLiveGestures(); lastInk = null;
    await inkWrites;                          // nothing from the old page lands in the new history
    await settleWorkspaceFile(leaving);       // the page being left gets its file written
    saveNext = null;
    clearTimeout(autoSaveTimer); autoSaveTimer = null; autosaveDue = 0;
    fileDataCache.clear(); fileDataBytes = 0; _mmImgCache.clear();
    state.ws = id; state.wsName = w.name;
    applyPaper(w.paper);
    touchWorkspaceUse(id);
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
    if (leaving) queuePreview(leaving, true);
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
    wss.sort((a, b) => wsLastUse(b) - wsLastUse(a));
    const counts = {};
    await Promise.all(wss.map(async w => { counts[w.id] = await DB.countByWs('blocks', w.id); }));
    grid.innerHTML = '';
    let idx = 0;
    for (const w of wss) {
      const card = document.createElement('div');
      card.className = 'ws-card';
      card.dataset.ws = w.id;
      card.style.setProperty('--b-accent', w.color || PALETTE[0]);
      card.style.setProperty('--i', idx++);                    // reveal order
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
        <div class="ws-thumb-wrap"><img class="ws-thumb" alt="" draggable="false"></div>
        <div class="ws-name">${esc(w.name || 'Untitled')}</div>
        <div class="ws-meta">${n} block${n === 1 ? '' : 's'}</div>`;
      if (w.preview) card.querySelector('.ws-thumb').src = w.preview;   // the stored snapshot, at once
      grid.appendChild(card);
    }
    const add = document.createElement('button');
    add.className = 'ws-add'; add.id = 'ws-add'; add.style.setProperty('--i', idx);
    add.innerHTML = `${ic('plus')}<span>New workspace</span>`;
    grid.appendChild(add);
    queueStalePreviews(wss, currentTheme());   // missing / stale / other-theme snapshots, one after another
  }

  /* ----------------------- workspace card previews ---------------------- *
   * A card shows a snapshot of the workspace's top page: the stored records
   * rendered into a small JPEG that lives on the workspace record (preview,
   * previewAt, previewTheme; previewStale marks a page edited since). It is
   * rendered when the user LEAVES a workspace, or lazily on the home for a
   * card whose snapshot is missing, stale or in the other theme - never
   * while working: nothing here runs on the canvas paths.                  */
  const PREVIEW_W = 480, PREVIEW_H = 264, PREVIEW_PAD = 24, PREVIEW_MAX_SCALE = 0.5, PREVIEW_MAX_IMAGES = 24;
  const previewFlagged = new Set();   // workspaces whose record already says previewStale (one write per visit)
  const previewQueue = [];            // [{ id, force }]: force = the page just left; the rest is the home's pass
  let previewBusy = false;
  const currentTheme = () => document.documentElement.getAttribute('data-theme') || 'dark';

  function previewTokens() {
    const cs = getComputedStyle(document.documentElement);
    const tok = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    return {
      bg1: tok('--bg-1', '#0C0D0F'), bg2: tok('--bg-2', '#101113'), bg3: tok('--bg-3', '#16181A'),
      line2: tok('--line-2', 'rgba(255,255,255,.12)'), line3: tok('--line-3', 'rgba(255,255,255,.18)'),
      text1: tok('--text-1', '#F2F3F4'), text2: tok('--text-2', '#9BA1A6'),
      paperDot: tok('--paper-dot', 'rgba(255,255,255,.055)'), paperGrid: tok('--paper-grid', 'rgba(255,255,255,.035)'),
      paperLine: tok('--paper-line', 'rgba(255,255,255,.045)'),
      font: tok('--font', 'system-ui, sans-serif'),
    };
  }
  // A block's footprint from its record alone (the page is not on screen).
  function previewRect(b) {
    const x = b.x || 0, y = b.y || 0;
    if (b.kind === 'ink') return inkBox(b);
    if (b.kind === 'text') {
      const size = b.size || 20, lines = String(b.text || 'Text').split('\n');
      let len = 1; for (const l of lines) len = Math.max(len, l.length);
      return { x, y, w: b.w || Math.max(120, Math.round(len * size * 0.55)), h: Math.max(28, Math.round(lines.length * size * 1.3)) };
    }
    if (b.kind === 'check') { const n = b.size || 28; return { x, y, w: n, h: n }; }
    if (b.kind === 'shape') return { x, y, w: b.w || 150, h: b.h || 100 };
    if (b.kind === 'image') return { x, y, w: b.w || 200, h: b.h || 150 };
    if (b.kind === 'table') {
      const rows = Array.isArray(b.rows) ? b.rows : [];
      const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      return { x, y, w: b.w || Math.max(120, cols * 96), h: b.h || Math.max(40, rows.length * 30 + (b.title ? 32 : 0)) };
    }
    return { x, y, w: b.w || 220, h: b.h || 110 };
  }
  // Paint order = what the DOM shows: an explicit z wins, drawing sits above the page otherwise.
  const previewZ = (b) => b.z || (b.kind === 'ink' ? INK_Z : 0);
  function loadPreviewImage(src) {
    return new Promise((res) => {
      const im = new Image();
      const done = (ok) => { clearTimeout(t); res(ok ? im : null); };
      const t = setTimeout(() => done(false), 4000);
      im.onload = () => done(true); im.onerror = () => done(false);
      im.src = src;
    });
  }
  // The page's paper (screen-spaced on the page too), so the picture reads as the page.
  function drawPreviewPaper(ctx, paper, W, H, T) {
    if (paper === 'blank') return;
    ctx.lineWidth = 1;
    if (paper === 'grid') {
      ctx.strokeStyle = T.paperGrid; ctx.beginPath();
      for (let x = 13; x < W; x += 13) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 13; y < H; y += 13) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke(); return;
    }
    if (paper === 'lines') {
      ctx.strokeStyle = T.paperLine; ctx.beginPath();
      for (let y = 15; y < H; y += 15) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke(); return;
    }
    ctx.fillStyle = T.paperDot;
    for (let y = 6; y < H; y += 13) for (let x = 6; x < W; x += 13) ctx.fillRect(x, y, 1, 1);
  }
  // The top page of a workspace as a JPEG data URL, from its records: root
  // blocks fitted into the frame (scale capped, so a small page stays small),
  // connectors underneath, everything in z order, in the current theme.
  async function renderWorkspacePreview(w, blocks, edges) {
    const W = PREVIEW_W, H = PREVIEW_H, T = previewTokens();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = T.bg1; ctx.fillRect(0, 0, W, H);
    drawPreviewPaper(ctx, (w && w.paper) || 'dots', W, H, T);
    blocks = (blocks || []).filter(b => b && b.parentId === DB.ROOT);
    if (blocks.length) {
      const rects = new Map();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const b of blocks) {
        const r = previewRect(b); rects.set(b.id, r);
        x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
      }
      const s = Math.min((W - 2 * PREVIEW_PAD) / Math.max(1, x1 - x0), (H - 2 * PREVIEW_PAD) / Math.max(1, y1 - y0), PREVIEW_MAX_SCALE);
      const ox = (W - (x1 - x0) * s) / 2 - x0 * s, oy = (H - (y1 - y0) * s) / 2 - y0 * s;
      // pictures first: decoding them is the only wait in here
      const imgs = new Map();
      const withSrc = blocks.filter(b => b.kind === 'image' && b.src && /^data:/i.test(b.src)).slice(0, PREVIEW_MAX_IMAGES);   // remote pictures would taint the canvas
      if (withSrc.length) await Promise.all(withSrc.map(b => loadPreviewImage(b.src).then(im => { if (im) imgs.set(b.id, im); })));
      // connectors under the blocks, centre to centre
      ctx.strokeStyle = T.line3; ctx.lineWidth = 1; ctx.beginPath();
      for (const e of (edges || [])) {
        const a = rects.get(e.from), c = rects.get(e.to);
        if (!a || !c) continue;
        ctx.moveTo(ox + (a.x + a.w / 2) * s, oy + (a.y + a.h / 2) * s);
        ctx.lineTo(ox + (c.x + c.w / 2) * s, oy + (c.y + c.h / 2) * s);
      }
      ctx.stroke();
      const ordered = blocks.map((b, i) => ({ b, i })).sort((p, q) => (previewZ(p.b) - previewZ(q.b)) || (p.i - q.i));
      for (const { b } of ordered) drawPreviewNode(ctx, b, rects.get(b.id), ox, oy, s, T, imgs);
    }
    return cv.toDataURL('image/jpeg', 0.82);
  }
  // One block, the way the page draws it, at preview scale.
  function drawPreviewNode(ctx, b, r, ox, oy, s, T, imgs) {
    const x = ox + r.x * s, y = oy + r.y * s, w = Math.max(1, r.w * s), h = Math.max(1, r.h * s);
    const col = b.color || PALETTE[0];
    ctx.save();
    ctx.globalAlpha = 1;
    if (b.rot && b.kind !== 'ink') { const cx = x + w / 2, cy = y + h / 2; ctx.translate(cx, cy); ctx.rotate(b.rot * Math.PI / 180); ctx.translate(-cx, -cy); }
    if (b.kind === 'ink') {
      const st = PEN_STYLES[b.style] || PEN_STYLES.pen;
      const pts = inkWorldPts(b);
      if (pts.length) {
        ctx.globalAlpha = st.opacity;
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.8, (b.width || 3) * s);
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ox + pts[0][0] * s, oy + pts[0][1] * s);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(ox + pts[i][0] * s, oy + pts[i][1] * s);
        if (pts.length === 1) ctx.lineTo(ox + pts[0][0] * s + 0.1, oy + pts[0][1] * s);   // a dot
        ctx.stroke();
      }
    } else if (b.kind === 'shape') {
      const fill = b.fill ? col : null;
      const stroke = b.outline ? (b.outlineColor || PALETTE[0]) : null;
      if (b.shape === 'line') {
        ctx.strokeStyle = b.outlineColor || col; ctx.lineWidth = Math.max(0.8, (b.outlineW || 4) * s); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
      } else {
        ctx.lineWidth = Math.max(0.8, (b.outlineW || 2) * s);
        if (b.shape === 'circle' || b.shape === 'ellipse') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); }
        else {
          const pts = b.shape === 'diamond' ? [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] : shapePoints(b);
          if (pts) { ctx.beginPath(); pts.forEach((p, i) => { const px = x + p[0] * w, py = y + p[1] * h; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); }
          else roundRectPath(ctx, x, y, w, h, 8 * s);
        }
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
        if (!fill && !stroke) { ctx.strokeStyle = col; ctx.stroke(); }
      }
    } else if (b.kind === 'text') {
      const lines = String(b.text || 'Text').split('\n');
      const fs = (b.size || 20) * s, lh = fs * 1.3;
      const tc = b.color || T.text1;
      const align = b.align === 'center' ? 'center' : (b.align === 'right' ? 'right' : 'left');
      const tx = align === 'center' ? x + w / 2 : (align === 'right' ? x + w : x);
      if (b.w) { ctx.beginPath(); ctx.rect(x - 1, y - 1, w + 2, Math.max(h, lines.length * lh) + 2); ctx.clip(); }
      ctx.fillStyle = tc;
      const n = Math.min(lines.length, Math.ceil(PREVIEW_H / Math.max(1, lh)) + 1);
      if (fs >= 4) {
        ctx.font = `${b.italic ? 'italic ' : ''}${b.bold ? '700' : '400'} ${fs}px ${FONT_STACK[b.font] || FONT_STACK.sans}`;
        ctx.textBaseline = 'top'; ctx.textAlign = align;
        for (let i = 0; i < n; i++) ctx.fillText(lines[i], tx, y + i * lh);
      } else {                                                   // too small to read: grey bars, one per line
        ctx.fillStyle = b.color || T.text2; ctx.globalAlpha = 0.7;
        const bh = Math.max(1, fs * 0.6);
        for (let i = 0; i < Math.min(n, 8); i++) {
          const bw = Math.max(3, Math.min(w, lines[i].length * fs * 0.55));
          ctx.fillRect(align === 'center' ? tx - bw / 2 : (align === 'right' ? tx - bw : tx), y + i * lh, bw, bh);
        }
      }
    } else if (b.kind === 'check') {
      roundRectPath(ctx, x, y, w, h, w * 0.22);
      if (b.checked) {
        ctx.fillStyle = col; ctx.fill();
        if (w >= 6) {
          const k = w / 24;
          ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, 3.2 * k); ctx.lineCap = ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(x + 6.5 * k, y + 12.5 * k); ctx.lineTo(x + 10.1 * k, y + 16.1 * k); ctx.lineTo(x + 17.5 * k, y + 7.9 * k); ctx.stroke();
        }
      } else {
        ctx.fillStyle = T.bg3; ctx.fill();
        ctx.strokeStyle = T.line2; ctx.lineWidth = 1; ctx.stroke();
      }
    } else if (b.kind === 'image') {
      const im = imgs.get(b.id);
      ctx.save();
      roundRectPath(ctx, x, y, w, h, b.round ? 12 * s : 0); ctx.clip();
      if (im) {
        // object-fit: cover, like the page
        const iw = im.naturalWidth || 1, ih = im.naturalHeight || 1, k = Math.max(w / iw, h / ih);
        const dw = iw * k, dh = ih * k;
        try { ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch (_) { ctx.fillStyle = T.bg3; ctx.fillRect(x, y, w, h); }
      } else { ctx.fillStyle = T.bg3; ctx.fillRect(x, y, w, h); ctx.strokeStyle = T.line2; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
      ctx.restore();
      if (b.outline) { ctx.strokeStyle = b.outlineColor || PALETTE[0]; ctx.lineWidth = Math.max(0.8, (b.outlineW || 2) * s); roundRectPath(ctx, x, y, w, h, b.round ? 12 * s : 0); ctx.stroke(); }
    } else if (b.kind === 'table') {
      const rows = Array.isArray(b.rows) ? b.rows : [];
      const nr = rows.length, nc = rows.reduce((m, rw) => Math.max(m, rw.length), 0);
      roundRectPath(ctx, x, y, w, h, Math.min(12 * s, w / 2, h / 2));
      ctx.fillStyle = T.bg2; ctx.fill();
      ctx.save(); ctx.clip();
      const gr = Math.min(6, Math.max(1, nr)), gc = Math.min(6, Math.max(1, nc));
      if (nr && b.header !== false) { ctx.fillStyle = T.bg3; ctx.fillRect(x, y, w, h / gr); }
      ctx.strokeStyle = T.line2; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 1; i < gr; i++) { const yy = y + h * i / gr; ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
      for (let j = 1; j < gc; j++) { const xx = x + w * j / gc; ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
      ctx.stroke();
      ctx.restore();
      roundRectPath(ctx, x, y, w, h, Math.min(12 * s, w / 2, h / 2)); ctx.strokeStyle = T.line2; ctx.stroke();
    } else {
      // block / list card: the surface, its accent bar, the colour tile and the title
      const rr = Math.min(12 * s, w / 2, h / 2);
      roundRectPath(ctx, x, y, w, h, rr);
      ctx.fillStyle = T.bg2; ctx.fill();
      ctx.strokeStyle = T.line2; ctx.lineWidth = 1; ctx.stroke();
      ctx.clip();                                                  // bar and title stay inside the card
      ctx.fillStyle = col;
      ctx.fillRect(x, y, Math.min(2, w), h);
      const t = 32 * s;
      roundRectPath(ctx, x + 16 * s, y + 14 * s, t, t, 8 * s); ctx.fill();
      const fs = 15 * s, tx = x + 59 * s, ty = y + 30 * s, title = b.title || 'Untitled block';
      if (fs >= 5) {
        ctx.font = `500 ${fs}px ${T.font}`; ctx.fillStyle = T.text1; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(title, tx, ty);
      } else {
        ctx.fillStyle = T.line3;
        ctx.fillRect(tx, ty - 1, Math.max(4, Math.min(w - 75 * s, title.length * 8 * s)), 2);
      }
    }
    ctx.restore();
  }

  // Store a snapshot on the record, re-read right before the write so a
  // concurrent property edit is never clobbered.
  async function storeWorkspacePreview(wsId, dataUrl, theme) {
    const w = await DB.getWorkspace(wsId);
    if (!w) return null;
    w.preview = dataUrl; w.previewAt = Date.now(); w.previewTheme = theme;
    delete w.previewStale;
    await DB.saveWorkspace(w);
    previewFlagged.delete(wsId);
    return w;
  }
  // Render and store one workspace's snapshot from its DB records; the
  // home's card (when showing) gets the new picture. Skipped while that
  // workspace is open: leaving it renders a fresh one anyway.
  async function snapshotWorkspace(wsId) {
    if (state.ws === wsId) return null;
    const [w, blocks, edges] = await Promise.all([DB.getWorkspace(wsId), DB.allByWs('blocks', wsId), DB.levelEdges(DB.ROOT, wsId)]);
    if (!w || state.ws === wsId) return null;
    const theme = currentTheme();
    const t0 = performance.now();
    const url = await renderWorkspacePreview(w, blocks.filter(b => b.parentId === DB.ROOT), edges);
    if (NG.Diag) NG.Diag.metrics.preview = { ws: wsId, renderMs: performance.now() - t0, blocks: blocks.length, bytes: url.length, at: performance.now() };
    if (state.ws === wsId) return null;                          // re-entered while it rendered
    if (currentTheme() !== theme) { queuePreview(wsId, true); return null; }   // theme flipped mid-render: draw it again in the current one
    const rec = await storeWorkspacePreview(wsId, url, theme);
    if (rec) { const img = wsCardThumb(wsId); if (img) img.src = url; }
    return rec;
  }
  function wsCardThumb(wsId) {
    const grid = $('#ws-grid'); if (!grid) return null;
    for (const c of grid.children) if (c.dataset && c.dataset.ws === wsId) return c.querySelector('img.ws-thumb');
    return null;
  }
  // One render at a time. `force` is the page just left: it goes first and
  // runs wherever the user is now; the home's own pass stops the moment the
  // home is no longer showing (the user is working).
  function queuePreview(id, force) {
    if (!id) return;
    const i = previewQueue.findIndex(q => q.id === id);
    if (i >= 0) { if (!force) return; previewQueue.splice(i, 1); }
    if (force) previewQueue.unshift({ id, force: true }); else previewQueue.push({ id, force: false });
    if (!previewBusy) { previewBusy = true; setTimeout(runPreviewQueue, 0); }
  }
  async function runPreviewQueue() {
    try {
      while (previewQueue.length) {
        const job = previewQueue.shift();
        if (!job.force && $('#home').hidden) continue;
        try { await snapshotWorkspace(job.id); } catch (e) { console.warn('preview:', e); }
        await new Promise(r => setTimeout(r, 0));                // let the page breathe between renders
      }
    } finally { previewBusy = false; }
  }
  // Every card whose snapshot is missing, stale or from the other theme.
  function queueStalePreviews(wss, theme) {
    for (const w of wss) if (!w.preview || w.previewStale || w.previewTheme !== theme) queuePreview(w.id, false);
  }
  // The page differs from its card now: say so on the record once per visit
  // (one write), so the home redraws it even when this visit never ends
  // through goHome (a refresh, a closed tab).
  function flagPreviewStale(wsId) {
    previewFlagged.add(wsId);
    DB.getWorkspace(wsId).then(w => {
      if (!w) return undefined;
      if (w.previewStale && w.usedAt) return undefined;
      w.previewStale = true;
      w.usedAt = Date.now();                     // an edit counts as use for the landing order
      return DB.saveWorkspace(w);
    }).catch(() => {});
  }

  async function newWorkspaceFlow() {
    const count = (await DB.listWorkspaces()).length;
    promptDialog('New Workspace', '', async (name, color, template) => {
      name = (name || '').trim() || 'Untitled workspace';
      const chosen = color || pickWsColor(count);
      const id = uid();
      let handle = null, path = null, folder = null;
      if (SHELL) {
        // The folder lives under the app's own managed storage, not a
        // location the user picks through a dialog - a directory-picker
        // dialog is not implemented on Android at all, and a path taken
        // from the file dialogs is not something sibling folders can be
        // derived from there either (see NGShell.appWorkspacesDir). No
        // dialog, no cancellation, and it works the same way every time.
        try {
          const base = await NGShell.appWorkspacesDir();
          // The id suffix keeps two workspaces named the same from ever
          // fighting over one folder - no existence check needed.
          folder = NGShell.pathJoin(base, safeFileName(name) + '-' + id.slice(0, 8) + WS_FOLDER_SUFFIX);
        } catch (e) {
          console.warn('could not resolve the app workspaces directory:', e);
          toast('Could not create the workspace folder — created in-app for now.');
        }
      } else if (FS_OK) {
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
      const now = Date.now();
      if (folder) {
        try { await wsFs.init(folder, { name, color: chosen, paper: 'dots', version: 1 }); }
        catch (e) { console.warn('workspace folder init failed:', e); toast('Could not create the workspace folder — created in-app for now.'); folder = null; }
      }
      await DB.saveWorkspace({ id, name, color: chosen, createdAt: now, updatedAt: now });
      if (path) await DB.savePathRec(id, path);
      if (handle) await DB.saveHandleRec(id, handle);
      // The folder link is written and flushed to IndexedDB BEFORE anything
      // else touches this workspace (seeding, opening) - so it is never in a
      // state where content exists but the link back to it has not landed.
      if (folder) { await DB.saveFolderRec(id, folder); await DB.flush(); }
      if (template && template !== 'blank') await seedTemplate(id, template);
      await openWorkspace(id);              // jump straight into the new workspace
      if (handle || path || folder) await saveCurrentWorkspace(false);   // write the initial contents now
    }, { colors: true, color: pickWsColor(count), okLabel: 'Create', templates: true });
  }

  // Seed a new workspace with a starter layout.
  async function seedTemplate(wsId, tpl) {
    const now = Date.now();
    const mk = (o) => ({
      id: uid(), ws: wsId, parentId: DB.ROOT, title: '', description: '', notes: '', tags: '',
      layout: 'canvas', color: PALETTE[0], icon: '', x: 0, y: 0, createdAt: now, updatedAt: now, ...o,
    });
    let blocks = [];
    if (tpl === 'kanban') {
      blocks = [
        mk({ title: 'To do', layout: 'list', color: PALETTE[5], x: 40, y: 60 }),
        mk({ title: 'In progress', layout: 'list', color: PALETTE[8], x: 300, y: 60 }),
        mk({ title: 'Done', layout: 'list', color: PALETTE[10], x: 560, y: 60 }),
      ];
    } else if (tpl === 'mindmap') {
      const c = mk({ title: 'Central idea', color: PALETTE[2], x: 320, y: 220 });
      const spokes = ['Topic 1', 'Topic 2', 'Topic 3', 'Topic 4'].map((t, i) =>
        mk({ title: t, color: PALETTE[(i + 3) % PALETTE.length], x: 120 + (i % 2) * 440, y: 60 + Math.floor(i / 2) * 340 }));
      blocks = [c, ...spokes];
      for (const b of blocks) await DB.saveBlock(b);
      for (const s of spokes) await DB.saveEdge({ id: uid(), ws: wsId, parentId: DB.ROOT, from: c.id, to: s.id, createdAt: now });
      return;
    } else if (tpl === 'project') {
      blocks = [
        mk({ title: 'Goals', color: PALETTE[1], x: 40, y: 60, notes: '# Goals\n- [ ] Define scope\n- [ ] Success metric' }),
        mk({ title: 'Tasks', layout: 'list', color: PALETTE[0], x: 300, y: 60 }),
        mk({ title: 'Resources', color: PALETTE[11], x: 560, y: 60, notes: '- Link 1\n- Link 2' }),
        mk({ title: 'Notes', color: PALETTE[7], x: 300, y: 300 }),
      ];
    }
    for (const b of blocks) await DB.saveBlock(b);
  }

  /* ---- workspace Properties dialog (name, colour, file location) ------ */
  let propsWs = null, propsColor = null;
  let propsPaper0 = 'dots';   // the paper the properties dialog opened on
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
  // Cancel (button, backdrop or Escape) undoes the live paper preview.
  function closeProps() {
    if (propsWs && state.ws === propsWs) applyPaper(propsPaper0);
    $('#props').hidden = true; propsWs = null;
  }
  async function openProperties(id) {
    const w = await DB.getWorkspace(id);
    if (!w) return;
    propsWs = id;
    propsPaper0 = w.paper || 'dots';
    propsColor = w.color || PALETTE[0];
    promptPaper = w.paper || 'dots';
    $$('#props-papers button').forEach(b => b.classList.toggle('active', b.dataset.paper === promptPaper));
    $('#props-name').value = w.name || '';
    renderPropsColors(propsColor);
    const rec = await DB.getHandleRec(id);
    const loc = $('#props-loc');
    if (rec && rec.folder) {
      loc.innerHTML = `<a class="loc-link" title="Show in folder">${esc(rec.folder)}</a>`;
      loc.querySelector('.loc-link').addEventListener('click', () => NGShell.reveal(rec.folder));
    } else if (rec && rec.path) {
      loc.innerHTML = `<a class="loc-link" title="Show in folder">${esc(rec.path)}</a>`;
      loc.querySelector('.loc-link').addEventListener('click', () => NGShell.reveal(rec.path));
    } else if (SHELL) {
      // app shell: not linked yet → offer to link now
      loc.innerHTML = `<a class="loc-link">Save to a folder</a> <span class="muted">(this workspace exists only in the app right now)</span>`;
      loc.querySelector('.loc-link').addEventListener('click', async () => {
        const p = await relinkWorkspace(id);
        if (p) openProperties(id);
      });
    }
    else if (rec && rec.handle) loc.innerHTML = esc(rec.handle.name) + ' <span class="muted">(the folder is hidden by the browser)</span>';
    else if (FS_OK) {
      // On the web a workspace made in the browser could never be given a file
      // afterwards - only exported. Offer the same choice the app shell has.
      loc.innerHTML = `<a class="loc-link">Choose a file location…</a> <span class="muted">(saves this workspace to a file)</span>`;
      loc.querySelector('.loc-link').addEventListener('click', async () => {
        const h = await linkWorkspaceFile(id);
        if (h) openProperties(id);
      });
    }
    else loc.innerHTML = '<span class="muted">Stored in this browser — not linked to a file</span>';
    $('#props').hidden = false;
    setTimeout(() => { $('#props-name').focus(); $('#props-name').select(); }, 50);
  }
  function bindProps() {
    const close = closeProps;
    $('#props-cancel').addEventListener('click', close);
    $('#props').addEventListener('mousedown', (e) => { if (e.target.id === 'props') close(); });
    $('#props-save').addEventListener('click', async () => {
      if (!propsWs) { close(); return; }
      const w = await DB.getWorkspace(propsWs);
      if (!w) { close(); return; }
      const name = ($('#props-name').value || '').trim();
      w.name = name || w.name;
      w.color = propsColor || w.color;
      w.paper = promptPaper || 'dots';
      propsPaper0 = w.paper;                     // saved: nothing for close() to put back
      w.updatedAt = Date.now();
      if (state.ws === propsWs) applyPaper(w.paper);
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
        wsDirty.delete(id);
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
    wss.sort((a, b) => wsLastUse(b) - wsLastUse(a));
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
    // the workspace switcher is a HOVER affordance — on touch devices a tap
    // already navigates home, so don't pop the menu there
    const canHover = window.matchMedia('(hover: hover)').matches;
    if (canHover) {
      brand.addEventListener('mouseenter', () => { clearTimeout(brandHideTimer); openBrandMenu(); });
      brand.addEventListener('mouseleave', () => { brandHideTimer = setTimeout(hideBrandMenu, 180); });
    }
    brand.addEventListener('click', hideBrandMenu);
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
  let promptTemplate = 'blank';
  let promptTheme = 'light';        // light / dark page style (PDF export)
  let promptPaper = 'dots';         // writing surface for a workspace
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
  // opts: { colors, color, okLabel, templates }. cb receives (name, color, template).
  function promptDialog(title, value, cb, opts = {}) {
    $('#prompt-title').textContent = title;
    const inp = $('#prompt-input');
    inp.value = value || '';
    promptCb = cb;
    const wantColors = !!opts.colors;
    $('#prompt-color-wrap').hidden = !wantColors;
    if (wantColors) { promptColor = opts.color || PALETTE[0]; renderPromptColors(promptColor); }
    else promptColor = null;
    const wantTheme = !!opts.themes;
    $('#prompt-theme-wrap').hidden = !wantTheme;
    if (wantTheme) {
      promptTheme = opts.theme || 'light';
      $$('#prompt-themes button').forEach(b => b.classList.toggle('active', b.dataset.pdftheme === promptTheme));
    }
    const wantTpl = !!opts.templates;
    $('#prompt-template-wrap').hidden = !wantTpl;
    if (wantTpl) { promptTemplate = 'blank'; $$('#prompt-templates button').forEach(b => b.classList.toggle('active', b.dataset.tpl === 'blank')); }
    $('#prompt-ok').textContent = opts.okLabel || 'Save';
    $('#prompt').hidden = false;
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  }
  function bindPrompt() {
    $('#prompt-cancel').addEventListener('click', () => { $('#prompt').hidden = true; promptCb = null; });
    $('#prompt-themes').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pdftheme]'); if (!b) return;
      promptTheme = b.dataset.pdftheme;
      $$('#prompt-themes button').forEach(x => x.classList.toggle('active', x === b));
    });
    $('#prompt-ok').addEventListener('click', () => {
      const v = $('#prompt-input').value;
      $('#prompt').hidden = true;
      const cb = promptCb; promptCb = null;
      if (cb) cb(v, promptColor, promptTemplate, promptTheme, promptPaper);
    });
    $('#prompt-templates').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tpl]'); if (!b) return;
      promptTemplate = b.dataset.tpl;
      $$('#prompt-templates button').forEach(x => x.classList.toggle('active', x === b));
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
    mmDirty = true; mmDirtyAll = true; scheduleMinimap();   // the mini-map bitmap holds the old theme's colours
    const home = $('#home');                            // so do the cards' snapshots
    if (home && !home.hidden) DB.listWorkspaces().then(wss => queueStalePreviews(wss, theme)).catch(() => {});
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
    document.addEventListener('fullscreenchange', updateMenuStates);
    $('#btn-menu').addEventListener('click', (e) => {
      updateMenuStates(); e.stopPropagation(); menu.hidden = !menu.hidden; });
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const act = btn.dataset.act;
      menu.hidden = true;
      if (act === 'export') exportWorkspaceFlow(state.ws);
      if (act === 'export-pdf') exportWorkspacePdfFlow(state.ws);
      if (act === 'fullscreen') toggleFullscreen();
      if (act === 'minimap') toggleMinimap();
      if (act === 'autosave') {
        // the switch itself now lives off the toolbar, so say what changed
        const cb = $('#autosave');
        if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true }));
          toast(cb.checked ? 'Autosave on' : 'Autosave off'); }
        updateMenuStates();
      }
      if (act === 'lock-x') { setAxisLock(axisLock === 'x' ? null : 'x'); }
      if (act === 'lock-y') { setAxisLock(axisLock === 'y' ? null : 'y'); }
      if (act === 'export-png') exportLevelImage('png');
      if (act === 'export-svg') exportLevelImage('svg');
      if (act === 'outline') toggleOutline();
      if (act === 'tidy') tidyLevel();
      if (act === 'present') startPresenting();
      if (act === 'properties') openProperties(state.ws);
      if (act === 'add-child') createBlock('block');
      if (act === 'fit') fitToView();
      if (act === 'zoom-reset') resetZoom();
      if (act === 'diag') { if (NG.Diag) NG.Diag.toggle(); }
      if (act === 'snap') { snapOn = !snapOn; try { localStorage.setItem('ng-snap', snapOn ? '1' : '0'); } catch (_) {} updateSnapLabel(); toast(snapOn ? 'Snap to grid on' : 'Snap to grid off'); }
      if (act === 'properties') openProperties(state.ws);
      if (act === 'about') openAbout('about');
      if (act === 'help') openAbout('help');
    });
    updateSnapLabel();
    $('#import-input').addEventListener('change', (e) => { if (e.target.files[0]) importWorkspaceFile(e.target.files[0]); e.target.value = ''; });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target.id !== 'btn-menu') menu.hidden = true;
      if (!e.target.closest('.search') && !e.target.closest('#btn-search')) { hideSearchResults(); closeSearch(); }
    });
  }

  /* ---------------------------- about / help --------------------------- */
  // Build number, read from the loaded script's cache-bust tag (?v=NN) — shown
  // in About so it's always possible to tell which build is running.
  function appBuild() {
    const s = document.querySelector('script[src*="app.js"]');
    const m = s && /\?v=(\d+)/.exec(s.src);
    return m ? 'build ' + m[1] : 'build ?';
  }

  function showAboutTab(tab) {
    $$('#about-tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#tab-about').classList.toggle('active', tab === 'about');
    $('#tab-help').classList.toggle('active', tab === 'help');
  }
  async function fillAboutPanel() {
    const p = $('#tab-about');
    if (state.ws == null) { p.innerHTML = '<p class="muted">Open a workspace to see its details here.</p>'; return; }
    const w = await DB.getWorkspace(state.ws);
    const blockCount = await DB.countByWs('blocks', state.ws);
    const rec = await DB.getHandleRec(state.ws);
    const loc = (rec && rec.folder)
      ? `<a class="loc-link" id="about-loc-link" title="Show in folder">${esc(rec.folder)}</a>`
      : (rec && rec.path)
        ? `<a class="loc-link" id="about-loc-link" title="Show in folder">${esc(rec.path)}</a>`
        : SHELL
          ? `<a class="loc-link" id="about-loc-link">Save to a folder</a> <span class="muted">(this workspace exists only in the app right now)</span>`
          : (rec && rec.handle)
            ? esc(rec.handle.name) + ' <span class="muted">(folder hidden by the browser)</span>'
            : FS_OK
              ? `<a class="loc-link" id="about-loc-link">Choose a file location…</a> <span class="muted">(saves this workspace to a file)</span>`
              : '<span class="muted">Stored in this browser — no linked file</span>';
    const created = w && w.createdAt ? new Date(w.createdAt).toLocaleString() : '—';
    let storage = 'not reported by this browser';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est && est.usage != null) {
          const pct = est.quota ? ` of ${humanSize(est.quota)} (${Math.round(est.usage / est.quota * 100)}%)` : '';
          storage = `${humanSize(est.usage)} used${pct}`;
        }
      }
    } catch (_) {}
    p.innerHTML = `
      <dl class="about-props">
        <div><dt>Name</dt><dd>${esc((w && w.name) || 'Untitled')}</dd></div>
        <div><dt>Color</dt><dd><span class="prop-dot" style="background:${esc((w && w.color) || PALETTE[0])}"></span>${esc((w && w.color) || '')}</dd></div>
        <div><dt>Blocks</dt><dd>${blockCount}</dd></div>
        <div><dt>Created</dt><dd>${esc(created)}</dd></div>
        <div><dt>File</dt><dd>${loc}</dd></div>
        <div><dt>Storage</dt><dd>${esc(storage)} <span class="muted">— all workspaces in this ${SHELL ? 'app' : 'browser'}</span></dd></div>
        <div><dt>Build</dt><dd class="muted">${esc(appBuild())} · ${SHELL ? 'app' : 'web'}</dd></div>
      </dl>`;
    const link = p.querySelector('#about-loc-link');
    if (link && rec && rec.folder) link.addEventListener('click', () => NGShell.reveal(rec.folder));
    else if (link && rec && rec.path) link.addEventListener('click', () => NGShell.reveal(rec.path));
    else if (link && SHELL) link.addEventListener('click', async () => { const p2 = await relinkWorkspace(state.ws); if (p2) fillAboutPanel(); });
    else if (link) link.addEventListener('click', async () => { const h = await linkWorkspaceFile(state.ws); if (h) fillAboutPanel(); });
  }

  // App shell: bind (or re-bind) a workspace to a real file via the native dialog.
  // Web: point a workspace at a (new) file the browser can write to.
  async function linkWorkspaceFile(id) {
    if (!FS_OK || SHELL) return null;
    const w = await DB.getWorkspace(id);
    let handle = null;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: safeFileName((w && w.name) || 'workspace') + '.notesgallery.json',
        types: [{ description: 'Notes Gallery workspace', accept: { 'application/json': ['.json'] } }],
      });
    } catch (e) {
      if (!(e && e.name === 'AbortError')) console.warn('file picker failed:', e);
      return null;
    }
    await DB.saveHandleRec(id, handle);
    try {
      await writeToHandle(handle, await workspaceBytes(id));
      toast('Workspace linked to file');
      state.dirty = false;
    } catch (e) { reportSaveFailure(e, true, handle.name || ''); }
    if (state.ws === id) setSaveState();
    return handle;
  }

  async function relinkWorkspace(id) {
    const w = await DB.getWorkspace(id);
    const name = (w && w.name) || 'workspace';
    // See newWorkspaceFlow: the folder lives under the app's own managed
    // storage, resolved the same deterministic way every time - nothing to
    // pick, nothing that can come back an unusable SAF reference on Android.
    let folder = null;
    try {
      folder = NGShell.pathJoin(await NGShell.appWorkspacesDir(), safeFileName(name) + '-' + id.slice(0, 8) + WS_FOLDER_SUFFIX);
      await wsFs.init(folder, { name, color: (w && w.color) || PALETTE[0], paper: (w && w.paper) || 'dots', version: 1 });
      await DB.saveFolderRec(id, folder);
      await DB.flush();
      await saveWorkspaceFolderDelta(id, folder);           // write everything in right away
      toast('Workspace linked to folder');
    } catch (e) { reportSaveFailure(e, true, folder || ''); return null; }
    if (state.ws === id) { state.dirty = false; setSaveState(); }
    return folder;
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
      // while editing a table's cells, the grid owns the keyboard (see onTableKey)
      if (editTableId) return;
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      // Command palette — works everywhere, even while typing
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if ($('#cmdk').hidden) openCmdk(); else closeCmdk();
        return;
      }
      if (e.key === 'Escape') {
        blurPanelField();                                    // never leave the focus inside a closed panel
        if (presenting) { stopPresenting(); return; }        // leave the slideshow
        if (!$('#cmdk').hidden) { closeCmdk(); return; }
        if (!$('#pen-menu').hidden) { closePenMenu(); return; }
        if (!$('#search-pop').hidden) { closeSearch(); return; }
        if (!$('#ctxmenu').hidden) { hideCtxMenu(); }
        else if (!$('#prompt').hidden) { $('#prompt').hidden = true; promptCb = null; }
        else if (!$('#props').hidden) { closeProps(); }
        else if (!$('#confirm').hidden) { $('#confirm').hidden = true; confirmCb = null; }
        else if (!$('#about').hidden) $('#about').hidden = true;
        else if (state.penMode) setPenMode(false);
        else if (state.penEraser) setEraser(false);
        else if (state.selectTool) setSelectMode(false);      // put the lasso away
        else if (state.linkMode) setLinkMode(false);
        else if (state.readOnly) setReadMode(false);          // read mode is a tool too
        else if (!$('#text-drawer').hidden) closeTextEditor();
        else if (!$('#shape-drawer').hidden) closeShapeEditor();
        else if (!$('#image-drawer').hidden) closeImageEditor();
        else if (!$('#ink-drawer').hidden) closeInkEditor();
        else if (!$('#check-drawer').hidden) closeCheckEditor();
        else if (!$('#drawer').hidden) closeDrawer();
        else if (state.selectedIds.size) clearSelection();
        else hideSearchResults();
        return;
      }
      if (typing) return;
      if (state.ws == null) return;   // no canvas shortcuts on the landing screen
      // Ctrl +/− / Ctrl+0 zoom the canvas (also catches touchpads whose pinch sends keystrokes)
      if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key)) {
        if (state.levelLayout !== 'canvas') return;
        e.preventDefault();
        if (e.key === '0') resetZoom();
        else { const r = stage.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, (e.key === '-' || e.key === '_') ? 1 / 1.15 : 1.15); }
        return;
      }
      if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveCurrentWorkspace(true); return; }
      if ((e.key === 'd' || e.key === 'D') && e.ctrlKey && e.shiftKey) { e.preventDefault(); if (NG.Diag) NG.Diag.toggle(); return; }
      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey)) ||
          ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && state.levelLayout === 'canvas') {
        e.preventDefault(); selectAllOnLevel();
      }
      if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey) && !e.altKey) {
        if (state.selectedIds.size) { e.preventDefault(); copySelection(); } return;
      }
      if ((e.key === 'c' || e.key === 'C') && e.altKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); copyStyle(); return; }
      if ((e.key === 'v' || e.key === 'V') && e.altKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pasteStyle(); return; }
      if ((e.key === 'x' || e.key === 'X') && (e.ctrlKey || e.metaKey)) {
        if (state.selectedIds.size) { e.preventDefault(); cutSelection(); } return;
      }
      if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey) && !e.altKey) {
        if (state.ws == null || state.levelLayout !== 'canvas') return;
        pasteKeyAt = performance.now();
        setTimeout(() => { if (pasteKeyAt) { pasteKeyAt = 0; pasteClipboard(); } }, 250);
        return;
      }
      if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
        if (state.selectedIds.size && state.levelLayout === 'canvas') { e.preventDefault(); duplicateSelection(); } return;
      }
      // Shift turns ] into } on most layouts, so match the character either way
      const brR = e.key === ']' || e.key === '}' || e.code === 'BracketRight';
      const brL = e.key === '[' || e.key === '{' || e.code === 'BracketLeft';
      if (brR && (e.ctrlKey || e.metaKey)) { if (state.selectedIds.size) { e.preventDefault(); (e.shiftKey ? bringToFront : bringForward)([...state.selectedIds]); } return; }
      if (brL && (e.ctrlKey || e.metaKey)) { if (state.selectedIds.size) { e.preventDefault(); (e.shiftKey ? sendToBack : sendBackward)([...state.selectedIds]); } return; }
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
      if (e.key === 'p' || e.key === 'P') penButton();
      if (e.key === 'e' || e.key === 'E') setEraser(!state.penEraser);
      // Tab drops a sibling next to the selected block and selects it
      if (e.key === 'Tab' && state.selectedIds.size === 1 && state.levelLayout === 'canvas') {
        e.preventDefault();
        addSibling([...state.selectedIds][0]);
        return;
      }
      if ((e.key === 'g' || e.key === 'G') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection(); else groupSelection();
        return;
      }
      if (presenting) {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); gotoStop(presenting.at + 1); return; }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); gotoStop(presenting.at - 1); return; }
        if (e.key === 'Escape') { stopPresenting(); return; }
      }
      if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
      if (e.key === 'o' || e.key === 'O') { toggleOutline(); return; }
      if (e.key === 'm' || e.key === 'M') toggleMinimap();
      if (e.key === 'f' || e.key === 'F') fitToView();
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIds.size) deleteSelected();
      if (e.key === '/') { e.preventDefault(); openSearch(); }
    });
  }

  /* ---------------------------- add popover ---------------------------- */
  let addHideTimer = null;
  function showImportFlyout(on) {
    const fly = $('#add-import'), wrap = $('#am-import-wrap');
    if (!fly || !wrap) return;
    if (!on) { fly.hidden = true; return; }
    fly.hidden = false;
    if (window.innerWidth <= 560) {
      // phones: drop the submenu straight down (a side flyout won't fit)
      fly.style.left = '0'; fly.style.right = 'auto'; fly.style.top = '100%';
      fly.style.marginLeft = '0'; fly.style.marginRight = ''; fly.style.marginTop = '6px'; fly.style.width = '100%';
      return;
    }
    // desktop: open to the right of the Import row; flip left if it would overflow
    fly.style.width = ''; fly.style.marginTop = '';
    fly.style.left = '100%'; fly.style.right = 'auto'; fly.style.marginLeft = '6px'; fly.style.marginRight = '';
    fly.style.top = '0';
    const r = fly.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) {
      fly.style.left = 'auto'; fly.style.right = '100%'; fly.style.marginLeft = ''; fly.style.marginRight = '6px';
    }
  }
  function openAddMenu(anchor) {
    const menu = $('#add-menu');
    showImportFlyout(false);   // always start collapsed
    menu.hidden = false;
    const a = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth || 250;
    let left = a.left;
    left = Math.min(left, window.innerWidth - mw - 10);
    left = Math.max(10, left);
    menu.style.left = left + 'px';
    menu.style.top = (a.bottom + 6) + 'px';
  }
  function hideAddMenu() { $('#add-menu').hidden = true; showImportFlyout(false); }
  function scheduleHideAdd() { clearTimeout(addHideTimer); addHideTimer = setTimeout(hideAddMenu, 180); }
  function cancelHideAdd() { clearTimeout(addHideTimer); }

  function bindAddMenu() {
    const btn = $('#btn-add');
    const menu = $('#add-menu');
    // hover reveals it on mouse devices only — on touch a tap toggles it (a
    // synthetic hover would open-then-toggle-close, needing two taps)
    const addCanHover = window.matchMedia('(hover: hover)').matches;
    if (addCanHover) {
      btn.addEventListener('mouseenter', () => { cancelHideAdd(); openAddMenu(btn); });
      btn.addEventListener('mouseleave', scheduleHideAdd);
      menu.addEventListener('mouseenter', cancelHideAdd);
      menu.addEventListener('mouseleave', scheduleHideAdd);
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) openAddMenu(btn); else hideAddMenu();
    });
    // Import submenu opens to the side on hover (desktop) and on click/tap (touch)
    const importWrap = $('#am-import-wrap');
    let importHideTimer = null;
    if (addCanHover) {
      importWrap.addEventListener('mouseenter', () => { clearTimeout(importHideTimer); showImportFlyout(true); });
      importWrap.addEventListener('mouseleave', () => { clearTimeout(importHideTimer); importHideTimer = setTimeout(() => showImportFlyout(false), 180); });
    }
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-add]'); if (!item) return;
      const kind = item.dataset.add;
      if (kind === 'import') { showImportFlyout($('#add-import').hidden); return; }   // tap toggles the flyout
      hideAddMenu();
      if (kind === 'image') pickImage();
      else if (kind === 'txtfile') pickTextFile();
      else if (kind === 'xlsx') pickSheetFile();
      else if (kind === 'wsfile') importViaPicker();
      else createBlock(kind);
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
      const b = state.byId.get(row.dataset.id);
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
    $('#tag-filter-clear').addEventListener('click', () => setTagFilter(state.tagFilter));
    $('#btn-pen').addEventListener('click', penButton);
    $('#pen-exit').addEventListener('click', () => setPenMode(false));
    updatePenTouchBtn();       // #btn-finger lives on the main toolbar - set its state up front
    // - / + beside the slider: one step per tap, and it keeps going while held
    const stepPenSize = (d) => {
      const forEraser = state.penEraser && eraserMode === 'normal';
      const v = clamp((forEraser ? eraserSize : penSize) + d, 1, 100);
      if (forEraser) { eraserSize = v; try { localStorage.setItem('ng-eraser-size', v); } catch (_) {} }
      else { penSize = v; try { localStorage.setItem('ng-pen-size', v); } catch (_) {} }
      syncPenSize();
    };
    [['#pen-size-minus', -1], ['#pen-size-plus', 1]].forEach(([id, d]) => {
      const b = $(id); if (!b) return;
      let hold = null, rep = null;
      const stop = () => { clearTimeout(hold); clearInterval(rep); hold = rep = null; };
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        stepPenSize(d);
        hold = setTimeout(() => { rep = setInterval(() => stepPenSize(d), 70); }, 380);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => b.addEventListener(ev, stop));
      b.addEventListener('click', (e) => e.preventDefault());       // the press already stepped
    });
    $('#pen-size').addEventListener('input', (e) => {
      const v = clamp(parseInt(e.target.value, 10) || 12, 1, 100);
      if (state.penEraser && eraserMode === 'normal') { eraserSize = v; try { localStorage.setItem('ng-eraser-size', v); } catch (_) {} }
      else { penSize = v; try { localStorage.setItem('ng-pen-size', v); } catch (_) {} }
      syncPenSize();
    });
    // the toolbar eraser: on its own or alongside the draw panel, never
    // opening the panel and never leaving it on when switched off
    $('#btn-eraser').addEventListener('click', (e) => {
      if (e.target.closest('.pen-more')) {
        const m = $('#pen-menu');
        if (m && !m.hidden && m.dataset.kind === 'eraser') closePenMenu(); else openPenMenu('eraser', $('#btn-eraser'), true);
        return;
      }
      // up already as the draw panel's ink eraser: this button widens it to everything
      if (state.penEraser && eraserScope !== 'all') setEraser(true, false, 'all');
      else setEraser(!state.penEraser, false, 'all');
    });
    // finger drawing: auto (default) -> always on -> off (stylus only)
    $('#pen-touch').addEventListener('click', toggleFingerDraw);
    $('#btn-finger').addEventListener('click', toggleFingerDraw);
    $('#pen-snap').addEventListener('click', () => {
      shapeSnap = !shapeSnap;
      try { localStorage.setItem('ng-shape-snap', shapeSnap ? '1' : '0'); } catch (_) {}
      updateShapeSnapBtn();
      toast(shapeSnap ? 'Shape snapping on — draw a circle, box, triangle or line'
                      : 'Shape snapping off');
    });
    $('#btn-select').addEventListener('click', (e) => {
      if (e.target.closest('.pen-more')) {
        const m = $('#pen-menu');
        if (m && !m.hidden && m.dataset.kind === 'lasso') closePenMenu(); else openPenMenu('lasso', $('#btn-select'), true);
        return;
      }
      setSelectMode(!state.selectTool);
    });
    // the outline and search put the pen, eraser and Select tool away first
    $('#btn-outline').addEventListener('click', () => { dropActiveTools(); toggleOutline(); });
    $('#btn-search').addEventListener('click', (e) => { e.stopPropagation(); dropActiveTools(); if ($('#search-pop').hidden) openSearch(); else closeSearch(); });
    $('#btn-delete').addEventListener('click', () => {
      if (!state.selectedIds.size) { toast('Select something first.'); return; }
      deleteSelected();
    });
    syncSelectionButtons();        // start dimmed until something is picked
    ['#btn-home', '#btn-back', '#btn-forward'].forEach(sel => {
      const b = $(sel); if (b) b.addEventListener('click', () => dropActiveTools());
    });
    $('#btn-undo').addEventListener('click', () => undo());
    $('#btn-redo').addEventListener('click', () => redo());
    $('#btn-read').addEventListener('click', () => setReadMode(!state.readOnly));
    $('#sel-bar').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.align) alignSelection(b.dataset.align);
      else if (b.dataset.sel === 'group') groupSelection();
      else if (b.dataset.sel === 'ungroup') ungroupSelection();
      else if (b.dataset.sel === 'props') openSelProps();
      else if (b.dataset.sel === 'copy') copySelection();
      else if (b.dataset.sel === 'cut') cutSelection();
      else if (b.dataset.sel === 'delete') deleteSelected();
      else if (b.dataset.sel === 'back') reorderZ([...state.selectedIds], false);
      else if (b.dataset.sel === 'backward') stepZ([...state.selectedIds], false);
      else if (b.dataset.sel === 'forward') stepZ([...state.selectedIds], true);
      else if (b.dataset.sel === 'front') reorderZ([...state.selectedIds], true);
    });
    $('#props-papers').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-paper]'); if (!b) return;
      promptPaper = b.dataset.paper;
      $$('#props-papers button').forEach(x => x.classList.toggle('active', x === b));
      if (state.ws === propsWs) applyPaper(promptPaper);      // live preview
    });
    $('#outline-close').addEventListener('click', () => toggleOutline(false));
    $('#pres-prev').addEventListener('click', () => gotoStop(presenting ? presenting.at - 1 : 0));
    $('#pres-next').addEventListener('click', () => gotoStop(presenting ? presenting.at + 1 : 0));
    $('#pres-exit').addEventListener('click', stopPresenting);
    bindEdgeEditor();
    bindPenBarDrag(); bindPenMenus(); bindOutlineDismiss();
    renderPenTools(); setLassoMode('replace');
    // pointerrawupdate fires as soon as the digitiser reports, ahead of the
    // throttled pointermove — the lowest-latency input the web offers.
    if ('onpointerrawupdate' in window) {
      window.addEventListener('pointerrawupdate', (e) => { if (inking) addInkSamples(e, true); });
    }
    window.addEventListener('resize', () => {
      selBarSize = null;                                 // the bar re-measures at its next show
      sizeInkSurface();
      if (inking) inking.sampler.rect = inking.rect = stage.getBoundingClientRect();
      redrawInkStroke();
    });

    $('#btn-theme').addEventListener('click', () =>
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
    // landing-screen extras: full screen (same as F11 / the ... menu) and Help
    $('#btn-fullscreen').addEventListener('click', () => toggleFullscreen());
    $('#btn-help').addEventListener('click', () => openAbout('help'));
    syncFullscreenButton();
    const r = () => stage.getBoundingClientRect();
    $('#btn-zoom-in').addEventListener('click',  () => zoomAt(r().width / 2, r().height / 2, 1.18));
    $('#btn-zoom-out').addEventListener('click', () => zoomAt(r().width / 2, r().height / 2, 1 / 1.18));
    $('#btn-zoom-reset').addEventListener('click', resetZoom);
  }

  function bindStage() {
    stage.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    // If the app/tab loses focus mid-gesture (notification, app switch, edge swipe),
    // a touch pointer can leak — the next single finger then reads as a 2-finger
    // pinch and panning "stops working". Reset all gesture state on interruption.
    const resetGestures = () => {
      // every pointer-owned gesture is abandoned: moves and handle drags revert
      const owners = new Set(pointers.keys());
      for (const g of [dragging, panning, gizmo, colResize, rowResize, marquee]) if (g && g.pointerId != null) owners.add(g.pointerId);
      for (const pid of owners) abandonPointer(pid);
      pointers.clear(); pinch = null; flushInv();
      cancelDrag();
      if (panning) { stage.classList.remove('panning'); panning = null; }
      gizmo = null; colResize = null; rowResize = null;
      if (marquee) endMarquee();
      clearTimeout(lpTimer); lpTimer = null; lpFired = false;
      if (selScale) cancelSelScale();                          // a lost grip drag reverts
      selFrameBox = null;
      dropLiveGestures();                                      // drop a half-drawn stroke / sweep / loop
    };
    window.addEventListener('blur', resetGestures);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      resetGestures();
      // The app is going away: commit the records first (a queue waiting on an
      // animation frame would never run while hidden), then write the file.
      DB.flush();
      if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; autosaveDue = 0; saveCurrentWorkspace(false); }
    });
    window.addEventListener('pagehide', () => { DB.flush(); });

    // Phone bottom sheets: a drag grip at the top of every editor panel lets the
    // user stretch the sheet taller or shorter. Height is shared across panels.
    let sheetDrag = null;
    document.querySelectorAll('.drawer').forEach(d => {
      const g = document.createElement('div');
      g.className = 'sheet-grip';
      d.prepend(g);
      g.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        sheetDrag = { startY: e.clientY, startH: d.getBoundingClientRect().height };
        try { g.setPointerCapture(e.pointerId); } catch (_) {}
      });
    });
    window.addEventListener('pointermove', (e) => {
      if (!sheetDrag) return;
      const h = clamp(sheetDrag.startH + (sheetDrag.startY - e.clientY), window.innerHeight * 0.18, window.innerHeight * 0.85);
      document.documentElement.style.setProperty('--sheet-h', Math.round(h) + 'px');
    });
    window.addEventListener('pointerup', () => { sheetDrag = null; });
    window.addEventListener('pointercancel', () => { sheetDrag = null; });
    stage.addEventListener('wheel', onWheel, { passive: false });
    // keep touchpad pinch (ctrl+wheel) zooming the CANVAS, not the browser page,
    // even when the cursor drifts over the toolbar/drawers while a canvas is open
    window.addEventListener('wheel', (e) => {
      // in the app shell always block page zoom; in the browser only while a canvas is open
      if (e.ctrlKey && (SHELL || (state.ws != null && state.levelLayout === 'canvas'))) e.preventDefault();
    }, { passive: false });
    // Safari/WebKit trackpads report pinch as gesture events instead of ctrl+wheel
    let gestureScale = 1;
    stage.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureScale = e.scale || 1; });
    stage.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (state.levelLayout !== 'canvas') return;
      const r = stage.getBoundingClientRect();
      const s = e.scale || 1;
      zoomAt((e.clientX || r.width / 2) - r.left, (e.clientY || r.height / 2) - r.top, s / (gestureScale || 1));
      gestureScale = s;
    });
    stage.addEventListener('gestureend', (e) => e.preventDefault());
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
      if (files && files.length) { e.preventDefault(); stage.classList.remove('drop-active'); dropFiles(files, e.clientX, e.clientY); }
    });
    window.addEventListener('beforeunload', (e) => {
      DB.flush();                                  // never leave records in the queue
      objectUrls.forEach(u => URL.revokeObjectURL(u));
      // Hold the close while anything is unwritten: unsaved by hand, or an
      // autosave that has not reached the file yet.
      const unwritten = state.ws != null
        && ((!state.autosave && state.dirty) || (state.autosave && (autoSaveTimer || saveRun)));
      if (unwritten) { e.preventDefault(); e.returnValue = ''; }
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
    bindToolbar(); bindStage(); bindChromeHover(); bindEdgeClicks(); bindDrawerFields(); bindFileInputs();
    bindSearch(); bindMenu(); bindConfirm(); bindKeys();
    bindAddMenu(); bindListView(); bindHome(); bindPrompt(); bindBrandMenu(); bindAutosave(); bindProps(); bindAbout(); bindContextMenu();
    bindTextEditor(); bindShapeEditor(); bindImageEditor(); bindCheckEditor(); bindInkEditor(); bindTableEditor(); bindImagePaste(); bindCmdk(); bindMinimap(); bindSelFrame();
    document.addEventListener('click', (e) => { const rb = e.target.closest && e.target.closest('.param-reset'); if (rb) { e.preventDefault(); resetParamField(rb); } });
    NG.attachApi(makeBag());
    initPlanes();
    // the About header names the build: app version and the site's cache-busting number
    try {
      const av = $('#about-version');
      const tag = [...document.scripts].map(s => (s.src.match(/app\.js\?v=(\d+)/) || [])[1]).find(Boolean);
      if (av) av.textContent = NG.version + (tag ? ' · v' + tag : '');
    } catch (_) {}
    if (NG.Overlay && $('#ink-ui')) { try { NG.Overlay.attach($('#ink-ui'), NG.bag); } catch (err) { console.warn('overlay:', err); } }
    if (NG.Diag) { try { NG.Diag.init(); } catch (err) { console.warn('diag:', err); } }
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

  // What the ink engine, the diagnostics overlay and window.__ng may reach.
  function makeBag() {
    return {
      version: NG.version, state, history, DB, PEN_STYLES, PEN_ORDER, inkStrokeD, inkPad, inkWorldPts, nibFactor, taperCentreline, inkBox,
      stage, world, stageRect,
      liveCanvas: () => { inkSurface(); return inkCv; },
      liveCtx: () => inkSurface(),
      liveDpr: () => NG.wet.dpr,
      // the mini-map's offscreen bitmap and a way to force it fresh right now
      // (bypassing the usual 250ms throttle), so a test can compare the
      // patched picture against a known-clean full rebuild.
      minimapCanvas: () => (mmContent && mmContent.canvas) || null,
      // pause the mini-map's own scheduled redraws (not the feature itself -
      // the canvas stays visible), so a test can drive it entirely through
      // forceMinimapRebuild/applyMinimapUpdate without racing the normal
      // throttled cycle for the same dirty flags.
      setMinimapAuto: (on) => { mmAutoSuppressed = !on; },
      forceMinimapRebuild: () => {
        const cv = $('#minimap');
        renderMinimapContent(cv.clientWidth, cv.clientHeight, window.devicePixelRatio || 1);
        mmDirtyIds = null; mmDirtyAll = false; mmDirtyRect = null;   // a clean baseline, like updateMinimapContent leaves
      },
      // acts on whatever an edit just marked dirty (patch or full, its own
      // normal choice), bypassing only the wall-clock throttle so a test does
      // not have to wait on it.
      applyMinimapUpdate: () => {
        const cv = $('#minimap');
        updateMinimapContent(cv.clientWidth, cv.clientHeight, window.devicePixelRatio || 1);
      },
      minimapStats: () => ({ dirtyIds: mmDirtyIds ? mmDirtyIds.size : 0, dirtyAll: mmDirtyAll, gridCells: mmGrid.size, boundsStale: mmBoundsStale }),
      minimapDirtyRectDebug: () => mmDirtyRect ? { ...mmDirtyRect } : null,
      minimapContentDebug: () => mmContent ? { x0: mmContent.x0, y0: mmContent.y0, x1: mmContent.x1, y1: mmContent.y1, cs: mmContent.cs, cw: mmContent.canvas.width, ch: mmContent.canvas.height } : null,
      screenToWorld, worldToScreen: (x, y) => ({ x: wx(x), y: wy(y) }),
      getInking: () => inking,
      getGesture: gestureState,
      getTools: () => ({ penMode: state.penMode, penEraser: state.penEraser, selectTool: state.selectTool, eraserMode, lassoMode, penStyle, penColor, penSize, fingerDraw }),
      selectionWorldBox, applySelectionClasses, setSelection, clearSelection, selectBlock,
      afterInkWrites, flushWrites: () => afterInkWrites(() => DB.flush()),
      hitAt: (cx, cy) => {
        const el = document.elementFromPoint(cx, cy);
        const b = topBlockAt(cx, cy, el && el.closest ? el.closest('.block') : null);
        return b ? b.id : null;
      },
      blockScreenRect: (id) => { const el = state.els[id]; if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; },
      toast, markChanged,
      workspaceJson,                     // the finished file text, as a save writes it
    };
  }
  function gestureState() {
    const g = inking ? ['ink', inking.pointerId] : erasing ? ['erase', erasing.pointerId] : lasso ? ['lasso', lasso.pointerId]
      : dragging ? ['drag', dragging.pointerId] : gizmo ? ['gizmo', gizmo.pointerId] : panning ? ['pan', panning.pointerId]
      : pinch ? ['pinch', null] : marquee ? ['marquee', marquee.pointerId] : selScale ? ['selScale', selScale.pointerId] : ['none', null];
    return { kind: g[0], owner: g[1] };
  }

  document.addEventListener('DOMContentLoaded', init);
})();
