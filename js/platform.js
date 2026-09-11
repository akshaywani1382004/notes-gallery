/* Platform adapter — when running inside the desktop/mobile app (Tauri),
   exposes NGShell with native file dialogs, direct file read/write and
   "show in folder". On the website this file defines nothing and the app
   keeps using the browser's File System Access API. */
(() => {
  const T = window.__TAURI__;
  if (!T || !T.core) return;
  const inv = (cmd, args) => T.core.invoke(cmd, args);
  const FILTERS = [{ name: 'Notes Gallery workspace', extensions: ['json'] }];
  const filtersFor = (name) => (/\.pdf$/i.test(name || '')
    ? [{ name: 'PDF document', extensions: ['pdf'] }]
    : FILTERS);

  // ---- clipboard image helpers (used only inside a paste / copy) ----
  // Whatever shape the IPC hands back for a byte vector -> Uint8Array.
  const toBytes = (r) => r instanceof Uint8Array ? r
    : r instanceof ArrayBuffer ? new Uint8Array(r)
    : (r && r.buffer instanceof ArrayBuffer) ? new Uint8Array(r.buffer, r.byteOffset || 0, r.byteLength)
    : Uint8Array.from(r || []);
  // Straight RGBA bytes + size -> PNG Blob through a canvas.
  function rgbaToPng(bytes, width, height) {
    return new Promise((res, rej) => {
      const w = width | 0, h = height | 0;
      if (!w || !h || bytes.length < w * h * 4) { res(null); return; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, w * h * 4), w, h), 0, 0);
      c.toBlob(b => b ? res(b) : rej(new Error('png encode failed')), 'image/png');
    });
  }
  // Any raster Blob -> { rgba: number[], width, height } (what JsImage::Rgba takes).
  function blobToRgba(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { res(null); return; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        res({ rgba: Array.from(ctx.getImageData(0, 0, w, h).data), width: w, height: h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image decode failed')); };
      img.src = url;
    });
  }

  window.NGShell = {
    isApp: true,

    // native Save-As dialog → full path (or null on cancel)
    async saveDialog(suggestedName) {
      const filters = filtersFor(suggestedName);
      if (T.dialog && T.dialog.save) return T.dialog.save({ defaultPath: suggestedName, filters });
      return inv('plugin:dialog|save', { options: { defaultPath: suggestedName, filters } });
    },

    // native Open dialog → full path (or null on cancel)
    async openDialog() {
      let r;
      if (T.dialog && T.dialog.open) r = await T.dialog.open({ multiple: false, directory: false, filters: FILTERS });
      else r = await inv('plugin:dialog|open', { options: { multiple: false, directory: false, filters: FILTERS } });
      return Array.isArray(r) ? r[0] : r;
    },

    // Text or binary: a Uint8Array (a PDF, say) must not go through the text
    // writer, which would re-encode the bytes and corrupt the file.
    async writeFile(path, data) {
      const binary = data instanceof Uint8Array || data instanceof ArrayBuffer;
      if (binary) {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        if (T.fs && T.fs.writeFile) return T.fs.writeFile(path, bytes);
        throw new Error('binary write unavailable');
      }
      if (T.fs && T.fs.writeTextFile) return T.fs.writeTextFile(path, data);
      return inv('plugin:fs|write_text_file', { path, contents: data });
    },

    async readFile(path) {
      const r = (T.fs && T.fs.readTextFile) ? await T.fs.readTextFile(path)
                                            : await inv('plugin:fs|read_text_file', { path });
      if (typeof r === 'string') return r;
      // the raw command returns the file's bytes, not text: decode them here
      const bytes = r instanceof ArrayBuffer ? new Uint8Array(r)
        : (r && r.buffer instanceof ArrayBuffer) ? new Uint8Array(r.buffer, r.byteOffset || 0, r.byteLength)
        : Uint8Array.from(r || []);
      return new TextDecoder().decode(bytes);
    },

    // open Windows Explorer / Finder with the file selected
    async reveal(path) {
      try {
        if (T.opener && T.opener.revealItemInDir) return await T.opener.revealItemInDir(path);
        return await inv('plugin:opener|reveal_item_in_dir', { path });
      } catch (e) { console.warn('reveal failed:', e); }
    },

    // Handwriting -> text via the OS recogniser (Windows Ink analysis today).
    // Returns null when this build has no recogniser, so the app can say so.
    async recognizeInk(strokes) {
      try { return await inv('recognize_ink', { strokes }); }
      catch (e) { console.warn('ink recognition unavailable:', e); return null; }
    },

    // ---- OS clipboard (tauri-plugin-clipboard-manager). Text both ways on
    // every platform. Images: Windows only - the plugin's mobile side answers
    // "Unsupported on this platform" for read_image / write_image, so on
    // Android clipReadImage resolves null and clipWriteImage false and the app
    // stays on the text path. Each call runs once per copy or paste; nothing
    // here is polled or touched per frame.
    // How much clip text the platform's clipboard takes comfortably. Android
    // hands ClipData over Binder (1 MB transaction cap, UTF-16), so keep well
    // under it there; the desktop has no such limit worth naming.
    clipTextBudget: window.NGHost ? 400 * 1024 : 20 * 1024 * 1024,

    async clipWriteText(text) {
      const s = String(text == null ? '' : text);
      if (T.clipboardManager && T.clipboardManager.writeText) await T.clipboardManager.writeText(s);
      else await inv('plugin:clipboard-manager|write_text', { text: s });
      return true;
    },

    // Text on the clipboard, or null (empty, non-text content, or a platform
    // without a reader for what is there).
    async clipReadText() {
      try {
        const r = (T.clipboardManager && T.clipboardManager.readText) ? await T.clipboardManager.readText()
                                                                      : await inv('plugin:clipboard-manager|read_text');
        return typeof r === 'string' ? r : null;
      } catch (_) { return null; }
    },

    // Image on the clipboard as a PNG Blob, or null. The plugin hands back an
    // Image resource (RGBA bytes + size) that must be closed afterwards.
    async clipReadImage() {
      let img = null, rid = null;
      try {
        if (T.clipboardManager && T.clipboardManager.readImage) { img = await T.clipboardManager.readImage(); rid = img && img.rid; }
        else rid = await inv('plugin:clipboard-manager|read_image');
      } catch (_) { return null; }                       // no image there, or unsupported (Android)
      if (!img && rid == null) return null;
      try {
        const [raw, size] = await Promise.all([
          (img && img.rgba) ? img.rgba() : inv('plugin:image|rgba', { rid }),
          (img && img.size) ? img.size() : inv('plugin:image|size', { rid }),
        ]);
        return await rgbaToPng(toBytes(raw), size && size.width, size && size.height);
      } catch (e) { console.warn('clipboard image decode failed:', e); return null; }
      finally {
        try { if (img && img.close) await img.close(); else if (rid != null) await inv('plugin:resources|close', { rid }); } catch (_) {}
      }
    },

    // Optional: put a raster Blob on the clipboard as an image. Resolves
    // false where that is not possible (Android, undecodable blob).
    async clipWriteImage(blob) {
      try {
        const px = await blobToRgba(blob);
        if (!px) return false;
        if (T.clipboardManager && T.clipboardManager.writeImage) await T.clipboardManager.writeImage(px);   // passes the {rgba,width,height} object through
        else await inv('plugin:clipboard-manager|write_image', { image: px });
        return true;
      } catch (e) { console.warn('clipboard image write failed:', e); return false; }
    },

    basename(path) { return String(path).split(/[\\/]/).pop(); },

    pathJoin(...parts) {
      const sep = String(parts[0] || '').includes('\\') ? '\\' : '/';
      return parts.filter(Boolean).join(sep);
    },

    // ---- Android ink host (MainActivity.kt NgHost, injected as window.NGHost
    // before the first page load). Only the Android app has it: on Windows and
    // on the website it is null, so every call below is a guarded no-op.
    host: window.NGHost || null,

    // Pen or eraser tool active -> ask the panel for 120 Hz; off restores the
    // default. Never a static hint.
    setInking(on) {
      try { if (window.NGHost && window.NGHost.setInking) window.NGHost.setInking(!!on); } catch (_) {}
    },

    // Kill switch for unbuffered stylus dispatch; the host persists it.
    setUnbuffered(on) {
      try { if (window.NGHost && window.NGHost.setUnbuffered) window.NGHost.setUnbuffered(!!on); } catch (_) {}
    },

    // { unbuffered, refresh, sdk } from the host, or null when there is none.
    hostInfo() {
      try { return window.NGHost && window.NGHost.info ? JSON.parse(window.NGHost.info()) : null; }
      catch (_) { return null; }
    },
  };
})();
