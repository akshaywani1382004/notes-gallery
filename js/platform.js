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

    basename(path) { return String(path).split(/[\\/]/).pop(); },

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
