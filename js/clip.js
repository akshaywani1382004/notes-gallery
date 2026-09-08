/* Notes Gallery 2.0 — cross-platform clipboard (NG.Clip).

   A copy in one workspace can be pasted into another workspace, and into
   another platform's copy of the app (website <-> Windows app <-> Android
   app): the deep snapshot app.js already keeps in memory is ALSO written to
   the OS clipboard as one self-describing JSON text, and Paste reads the OS
   clipboard back — a Notes Gallery clip, an image (screenshot / copied
   picture) or plain text.

   Everything here runs only inside a copy or a paste; nothing is polled,
   nothing runs per frame, no state is kept between calls. Classic script,
   registers NG.Clip; loaded after platform.js (NGShell) and before app.js.

   Wire format (text/plain on the clipboard):
     { app:'NotesGallery', kind:'clip', version:2, exportedAt,
       roots:[id], blocks:[...], edges:[...],
       files:[{ ...meta, data:'data:<type>;base64,...' }], note? }
   Blocks/edges/files are the DB records as-is minus `ws` (re-assigned on
   paste) and minus each file's Blob, which travels as a data URL. */
(() => {
  const NG = (globalThis.NG = globalThis.NG || {});

  const APP = 'NotesGallery';
  const KIND = 'clip';
  const VERSION = 2;
  // Roughly how much text we are willing to put on the OS clipboard. Blocks
  // and edges always go; attachments are added while they fit, the rest are
  // left out with a note (the in-memory copy in app.js still has them).
  const TEXT_BUDGET = 20 * 1024 * 1024;

  const shell = () => (typeof window !== 'undefined' && window.NGShell) || null;
  const navClip = () => (typeof navigator !== 'undefined' && navigator.clipboard) || null;
  const isImageType = (t) => /^image\//i.test(String(t || ''));

  /* ------------------------------ blobs ------------------------------- */
  const blobToDataUrl = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || ''));
    fr.onerror = () => rej(fr.error || new Error('read failed'));
    fr.readAsDataURL(blob);
  });

  // data URL -> Blob, decoded here (no fetch: works the same on http, file://
  // and inside the Tauri webviews, and never touches the network layer).
  function dataUrlToBlob(url) {
    if (typeof url !== 'string' || url.slice(0, 5) !== 'data:') return null;
    const comma = url.indexOf(',');
    if (comma < 0) return null;
    const meta = url.slice(5, comma).split(';');
    const type = meta[0] || '';
    const payload = url.slice(comma + 1);
    try {
      let bytes;
      if (meta.indexOf('base64') >= 0) {
        const bin = atob(payload);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        bytes = new TextEncoder().encode(decodeURIComponent(payload));
      }
      return new Blob([bytes], { type });
    } catch (_) { return null; }
  }

  /* ------------------------------ format ------------------------------ */
  // Cheap sniff used before JSON.parse: our clips always start with the app
  // and kind fields, so a glance at the head is enough to rule text out.
  function isNgText(text) {
    if (typeof text !== 'string' || text.length < 20) return false;
    const head = text.slice(0, 160);
    return /^\s*\{/.test(head) && /"app"\s*:\s*"NotesGallery"/.test(head) && /"kind"\s*:\s*"clip"/.test(head);
  }

  const strip = (rec) => { const o = Object.assign({}, rec); delete o.ws; return o; };

  // Snapshot {roots, blocks, edges, files(with Blob)} -> { text, bytes, dropped }.
  async function serialize(snap) {
    const roots = Array.isArray(snap && snap.roots) ? snap.roots.slice() : [];
    const blocks = (snap && snap.blocks || []).map(strip);
    const edges = (snap && snap.edges || []).map(strip);
    const out = { app: APP, kind: KIND, version: VERSION, exportedAt: new Date().toISOString(), roots, blocks, edges, files: [] };
    let bytes = JSON.stringify(out).length;
    let dropped = 0;
    for (const f of (snap && snap.files || [])) {
      if (!f) continue;
      const meta = strip(f);
      delete meta.blob;
      let data = null;
      try {
        if (f.blob && typeof f.blob.size === 'number') data = await blobToDataUrl(f.blob);
        else if (typeof f.data === 'string') data = f.data;
      } catch (_) { data = null; }
      if (data && bytes + data.length + 64 <= TEXT_BUDGET) {
        meta.data = data;
        bytes += data.length + 64;
      } else {
        meta.data = null;
        meta.dropped = true;
        dropped++;
      }
      out.files.push(meta);
    }
    if (dropped) out.note = `${dropped} attachment${dropped > 1 ? 's' : ''} left out: over the ${Math.round(TEXT_BUDGET / 1048576)} MB clipboard budget`;
    const text = JSON.stringify(out);
    return { text, bytes: text.length, dropped };
  }

  // Text -> validated snapshot (files' data URLs back to Blobs), or null when
  // the text is not a Notes Gallery clip. Tolerant of partial records: a
  // block without an id, an edge without both ends, a file without data are
  // skipped rather than failing the whole paste.
  function parse(text) {
    if (!isNgText(text)) return null;
    let d;
    try { d = JSON.parse(text); } catch (_) { return null; }
    if (!d || d.app !== APP || d.kind !== KIND || !Array.isArray(d.blocks)) return null;
    const blocks = d.blocks.filter(b => b && typeof b === 'object' && (typeof b.id === 'string' || typeof b.id === 'number'));
    if (!blocks.length) return null;
    const ids = new Set(blocks.map(b => b.id));
    let roots = Array.isArray(d.roots) ? d.roots.filter(id => ids.has(id)) : [];
    if (!roots.length) roots = blocks.filter(b => !ids.has(b.parentId)).map(b => b.id);   // top of the copied tree
    const edges = (Array.isArray(d.edges) ? d.edges : []).filter(e => e && typeof e === 'object' && e.from != null && e.to != null);
    const files = [];
    let dropped = 0;
    for (const f of (Array.isArray(d.files) ? d.files : [])) {
      if (!f || typeof f !== 'object' || f.blockId == null) continue;
      const blob = dataUrlToBlob(f.data);
      if (!blob) { dropped++; continue; }
      const rec = Object.assign({}, f, { blob });
      delete rec.data; delete rec.dropped;
      if (typeof rec.size !== 'number') rec.size = blob.size;
      if (!rec.type) rec.type = blob.type;
      files.push(rec);
    }
    return { roots, blocks, edges, files, dropped, version: d.version || 1, exportedAt: d.exportedAt || null, note: d.note || null };
  }

  const fromText = (text) => {
    if (typeof text !== 'string' || !text) return null;
    const snapshot = parse(text);
    if (snapshot) return { kind: 'ng', snapshot };
    return { kind: 'text', text };
  };
  const imageResult = (blobs) => ({ kind: 'image', blob: blobs[0], blobs });

  /* ------------------------------- write ------------------------------ */
  // Serialise the snapshot and put it on the OS clipboard. Resolves to
  // { ok, via:'shell'|'navigator'|null, bytes, dropped }. Never throws: a
  // denied permission just means the copy stays in-app (app.js keeps its
  // in-memory snapshot regardless).
  async function write(snapshot) {
    let ser;
    try { ser = await serialize(snapshot); }
    catch (e) { console.warn('NG.Clip: serialise failed', e); return { ok: false, via: null, bytes: 0, dropped: 0 }; }
    const via = await writeText(ser.text);
    return { ok: !!via, via, bytes: ser.bytes, dropped: ser.dropped };
  }

  async function writeText(text) {
    const sh = shell();
    if (sh && typeof sh.clipWriteText === 'function') {
      try { if (await sh.clipWriteText(text) !== false) return 'shell'; }
      catch (e) { console.warn('NG.Clip: shell write failed', e); }
    }
    const nc = navClip();
    if (nc && typeof nc.writeText === 'function') {
      try { await nc.writeText(text); return 'navigator'; }
      catch (e) { console.warn('NG.Clip: clipboard write not allowed', e && e.name); }
    }
    return null;
  }

  // Optional: put an image on the OS clipboard (used by a future "Copy image").
  async function writeImage(blob) {
    if (!blob) return null;
    const sh = shell();
    if (sh && typeof sh.clipWriteImage === 'function') {
      try { if (await sh.clipWriteImage(blob)) return 'shell'; }
      catch (e) { console.warn('NG.Clip: shell image write failed', e); }
    }
    const nc = navClip();
    if (nc && typeof nc.write === 'function' && typeof ClipboardItem !== 'undefined') {
      try {
        const png = blob.type === 'image/png' ? blob : await toPng(blob);
        await nc.write([new ClipboardItem({ 'image/png': png })]);
        return 'navigator';
      } catch (e) { console.warn('NG.Clip: image write not allowed', e && e.name); }
    }
    return null;
  }

  // Any raster Blob -> PNG Blob through a canvas (the async clipboard only takes PNG).
  function toPng(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        c.toBlob(b => b ? res(b) : rej(new Error('encode failed')), 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode failed')); };
      img.src = url;
    });
  }

  /* -------------------------------- read ------------------------------ */
  // What the OS clipboard holds, as { kind:'ng', snapshot } | { kind:'image',
  // blob, blobs } | { kind:'text', text } | null. Order: shell image, shell
  // text, navigator.clipboard.read() (image/* first, then text/plain), then
  // navigator.clipboard.readText(). A denied permission or a missing API is
  // simply "nothing there" so the caller can fall back to its own memory.
  async function read() {
    const sh = shell();
    if (sh) {
      if (typeof sh.clipReadImage === 'function') {
        try { const blob = await sh.clipReadImage(); if (blob && blob.size) return imageResult([blob]); }
        catch (e) { console.warn('NG.Clip: shell image read failed', e); }
      }
      if (typeof sh.clipReadText === 'function') {
        try { const r = fromText(await sh.clipReadText()); if (r) return r; }
        catch (e) { console.warn('NG.Clip: shell text read failed', e); }
      }
    }
    const nc = navClip();
    if (nc && typeof nc.read === 'function') {
      try {
        const items = await nc.read();
        for (const it of items) {
          const t = (it.types || []).find(isImageType);
          if (t) { const blob = await it.getType(t); if (blob && blob.size) return imageResult([blob]); }
        }
        for (const it of items) {
          if ((it.types || []).indexOf('text/plain') >= 0) {
            const r = fromText(await (await it.getType('text/plain')).text());
            if (r) return r;
          }
        }
      } catch (e) { /* NotAllowedError, DataError, no focus: fall through */ }
    }
    if (nc && typeof nc.readText === 'function') {
      try { const r = fromText(await nc.readText()); if (r) return r; }
      catch (e) { /* NotAllowedError: nothing we can read */ }
    }
    return null;
  }

  // Same result shape from a ClipboardEvent ('paste'): image files first,
  // then text that parses as a clip, then plain text; null when empty.
  async function fromPasteEvent(e) {
    const dt = e && e.clipboardData;
    if (!dt) return null;
    const items = dt.items ? Array.from(dt.items) : [];
    const blobs = [];
    for (const it of items) {
      if (it.kind === 'file' && isImageType(it.type)) { const f = it.getAsFile(); if (f) blobs.push(f); }
    }
    if (!blobs.length && dt.files) for (const f of Array.from(dt.files)) if (isImageType(f.type)) blobs.push(f);
    if (blobs.length) return imageResult(blobs);
    let text = '';
    try { text = dt.getData('text/plain') || ''; } catch (_) {}
    if (!text) {
      const si = items.find(it => it.kind === 'string' && it.type === 'text/plain');
      if (si) text = await new Promise(res => { try { si.getAsString(s => res(s || '')); } catch (_) { res(''); } });
    }
    return fromText(text);
  }

  /* ------------------------------- toasts ----------------------------- */
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function summary(result) {
    if (!result) return 'Nothing to paste';
    if (result.kind === 'ng') {
      const s = result.snapshot || {};
      let msg = plural((s.roots || []).length, 'block');
      if (s.files && s.files.length) msg += `, ${plural(s.files.length, 'attachment')}`;
      if (s.dropped) msg += ` (${plural(s.dropped, 'attachment')} did not fit on the clipboard)`;
      return msg;
    }
    if (result.kind === 'image') return result.blobs && result.blobs.length > 1 ? plural(result.blobs.length, 'image') : 'Image';
    if (result.kind === 'text') {
      const t = String(result.text || '').replace(/\s+/g, ' ').trim();
      return t.length > 40 ? `Text: ${t.slice(0, 40)}…` : `Text: ${t}`;
    }
    return 'Clipboard';
  }

  NG.Clip = {
    APP, KIND, VERSION, TEXT_BUDGET,
    write, writeText, writeImage,
    read, fromPasteEvent,
    isNgText, parse, serialize, summary,
    blobToDataUrl, dataUrlToBlob,
  };
})();
