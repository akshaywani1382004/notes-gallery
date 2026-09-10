/* Notes Gallery — NG.WorkspaceFS: a workspace stored as a folder of small
   files (one per block) instead of one big JSON blob, for the app shell
   (Windows/Android) only. The website keeps using IndexedDB + a single
   exported JSON file - it never had the bug this replaces (see below), and
   giving it the same treatment would mean a second, harder-to-verify
   filesystem layer (OPFS + a WASM database) for no problem it actually has.

   Why: autosaving used to mean "read every block, rebuild the whole file,
   write the whole file" on every single change - the cost scaled with the
   size of the WHOLE workspace, not the size of the change. On a real,
   actively-used workspace that was a multi-second freeze, repeatedly, while
   writing (confirmed on real hardware via the app's own Diagnostics
   overlay). A folder write only ever touches the files for what actually
   changed - one new stroke means one new small file, not a full rebuild.

   Layout of a workspace folder:
     manifest.json          {name, color, paper, version}
     blocks/<shard>/<id>.json   one file per block; shard = id.slice(0,2),
                                 so no single directory ever holds more than
                                 a small fraction of a huge workspace
     edges.json              connectors - always few, kept as one small file
     files/<id>.json          {name, type, size, kind, createdAt, dataUrl}
                               one per attachment (these can be large; kept
                               separate from blocks/ on purpose)

   This module only knows how to read and write that shape, given a bag of
   {mkdir, writeFile, readFile, readDir, removeFile, exists} (NGShell on the
   real app, a fake in-memory filesystem in a test) - it never touches
   IndexedDB, NG.bag, or the DOM itself, so it can be exercised head-on
   without the rest of the app.                                            */
(() => {
  const NG = (globalThis.NG = globalThis.NG || {});

  const MANIFEST = 'manifest.json';
  const EDGES = 'edges.json';
  const BLOCKS_DIR = 'blocks';
  const FILES_DIR = 'files';

  const join = (...parts) => parts.join('/').replace(/\/+/g, '/');
  // Any id's first two characters are a fine bucket key - they do not need
  // to be hex specifically (the fallback uid() format is not), only short
  // and roughly evenly spread, which any id's own prefix already is.
  const shardOf = (id) => (String(id).slice(0, 2) || '_') .padEnd(2, '_');
  const blockPath = (folder, id) => join(folder, BLOCKS_DIR, shardOf(id), id + '.json');
  const filePath = (folder, id) => join(folder, FILES_DIR, id + '.json');

  // Run `fn` over `items` with at most `limit` in flight at once - plain
  // Promise.all would open thousands of file handles at once on a big
  // workspace; fully sequential would make a large read pay full per-call
  // IPC latency thousands of times over for nothing. A small window gets
  // most of the parallelism without either extreme.
  async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }
    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    await Promise.all(workers);
    return out;
  }

  // fs: {mkdir, writeFile, readFile, readDir, removeFile, exists} - NGShell
  // in production, a fake in the test harness (see workspacefs.spec below).
  function makeApi(fs) {
    // Write only what changed - dirtyBlocks: block records to (re)write;
    // deletedBlockIds: ids whose file should be removed; edges/edgesDirty:
    // the full edges array and whether it changed at all (few enough that
    // "changed at all -> rewrite the one small file" is the right amount of
    // granularity for it, unlike blocks); manifest/manifestDirty: same idea.
    async function saveDelta(folder, { manifest, manifestDirty, dirtyBlocks, deletedBlockIds, edges, edgesDirty, newFiles, deletedFileIds }) {
      await fs.mkdir(folder);
      if (manifestDirty && manifest) {
        await fs.writeFile(join(folder, MANIFEST), JSON.stringify(manifest));
      }
      if (dirtyBlocks && dirtyBlocks.length) {
        const shards = new Set(dirtyBlocks.map(b => shardOf(b.id)));
        await mapPool([...shards], 8, (s) => fs.mkdir(join(folder, BLOCKS_DIR, s)));
        await mapPool(dirtyBlocks, 16, (b) => fs.writeFile(blockPath(folder, b.id), JSON.stringify(b)));
      }
      if (deletedBlockIds && deletedBlockIds.length) {
        await mapPool(deletedBlockIds, 16, (id) => fs.removeFile(blockPath(folder, id)));
      }
      if (edgesDirty) {
        await fs.writeFile(join(folder, EDGES), JSON.stringify(edges || []));
      }
      if (newFiles && newFiles.length) {
        await fs.mkdir(join(folder, FILES_DIR));
        await mapPool(newFiles, 8, (f) => fs.writeFile(filePath(folder, f.id), JSON.stringify(f)));
      }
      if (deletedFileIds && deletedFileIds.length) {
        await mapPool(deletedFileIds, 16, (id) => fs.removeFile(filePath(folder, id)));
      }
    }

    // Full read of a workspace folder, for opening it or importing it.
    // Missing manifest/edges/files are treated as "not there yet", not an
    // error - a workspace folder that has only ever had one autosave still
    // has to open correctly.
    async function loadAll(folder) {
      let manifest = null;
      if (await fs.exists(join(folder, MANIFEST))) {
        try { manifest = JSON.parse(await fs.readFile(join(folder, MANIFEST))); } catch (_) {}
      }
      const blocks = [];
      const shardEntries = await fs.readDir(join(folder, BLOCKS_DIR));
      const shardDirs = shardEntries.filter(e => e.isDirectory).map(e => e.name);
      await mapPool(shardDirs, 6, async (shard) => {
        const entries = await fs.readDir(join(folder, BLOCKS_DIR, shard));
        const files = entries.filter(e => e.isFile).map(e => e.name);
        const texts = await mapPool(files, 24, (name) => fs.readFile(join(folder, BLOCKS_DIR, shard, name)));
        for (const t of texts) { try { blocks.push(JSON.parse(t)); } catch (_) {} }
      });
      let edges = [];
      if (await fs.exists(join(folder, EDGES))) {
        try { edges = JSON.parse(await fs.readFile(join(folder, EDGES))) || []; } catch (_) {}
      }
      const files = [];
      const fileEntries = await fs.readDir(join(folder, FILES_DIR));
      const fileNames = fileEntries.filter(e => e.isFile).map(e => e.name);
      const fileTexts = await mapPool(fileNames, 12, (name) => fs.readFile(join(folder, FILES_DIR, name)));
      for (const t of fileTexts) { try { files.push(JSON.parse(t)); } catch (_) {} }
      return { manifest, blocks, edges, files };
    }

    // A brand-new, empty workspace folder - manifest only, no blocks yet.
    async function init(folder, manifest) {
      await fs.mkdir(folder);
      await fs.mkdir(join(folder, BLOCKS_DIR));
      await fs.writeFile(join(folder, MANIFEST), JSON.stringify(manifest));
    }

    // Does this path look like an already-initialised workspace folder
    // (has a manifest)? Used to tell "a real folder link" apart from a
    // stale/foreign path, and from the old single-file link format this
    // replaces (a .json FILE path, which fails this the same way a path
    // that does not exist at all does - both correctly fall through to
    // "ask where this workspace should live" instead of silently trying to
    // write folder-shaped data into or next to an unrelated file).
    async function isWorkspaceFolder(folder) {
      if (!folder) return false;
      try { return await fs.exists(join(folder, MANIFEST)); } catch (_) { return false; }
    }

    return { saveDelta, loadAll, init, isWorkspaceFolder };
  }

  NG.WorkspaceFS = { makeApi, shardOf, join };
})();
