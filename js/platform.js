/* Platform adapter — when running inside the desktop/mobile app (Tauri),
   exposes NGShell with native file dialogs, direct file read/write and
   "show in folder". On the website this file defines nothing and the app
   keeps using the browser's File System Access API. */
(() => {
  const T = window.__TAURI__;
  if (!T || !T.core) return;
  const inv = (cmd, args) => T.core.invoke(cmd, args);
  const FILTERS = [{ name: 'Notes Gallery workspace', extensions: ['json'] }];

  window.NGShell = {
    isApp: true,

    // native Save-As dialog → full path (or null on cancel)
    async saveDialog(suggestedName) {
      if (T.dialog && T.dialog.save) return T.dialog.save({ defaultPath: suggestedName, filters: FILTERS });
      return inv('plugin:dialog|save', { options: { defaultPath: suggestedName, filters: FILTERS } });
    },

    // native Open dialog → full path (or null on cancel)
    async openDialog() {
      let r;
      if (T.dialog && T.dialog.open) r = await T.dialog.open({ multiple: false, directory: false, filters: FILTERS });
      else r = await inv('plugin:dialog|open', { options: { multiple: false, directory: false, filters: FILTERS } });
      return Array.isArray(r) ? r[0] : r;
    },

    async writeFile(path, text) {
      if (T.fs && T.fs.writeTextFile) return T.fs.writeTextFile(path, text);
      return inv('plugin:fs|write_text_file', { path, contents: text });
    },

    async readFile(path) {
      if (T.fs && T.fs.readTextFile) return T.fs.readTextFile(path);
      return inv('plugin:fs|read_text_file', { path });
    },

    // open Windows Explorer / Finder with the file selected
    async reveal(path) {
      try {
        if (T.opener && T.opener.revealItemInDir) return await T.opener.revealItemInDir(path);
        return await inv('plugin:opener|reveal_item_in_dir', { path });
      } catch (e) { console.warn('reveal failed:', e); }
    },

    basename(path) { return String(path).split(/[\\/]/).pop(); },
  };
})();
