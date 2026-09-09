/* ===========================================================================
 * db.js — IndexedDB data layer for Notes Gallery
 * ---------------------------------------------------------------------------
 * Global `DB`. No ES modules, so it works from file:// on double-click.
 *
 * Object stores:
 *   workspaces { id, name, color, createdAt, updatedAt }
 *   blocks     { id, ws, parentId, title, description, notes, layout,
 *                color, icon, x, y, createdAt, updatedAt }
 *   edges      { id, ws, parentId, from, to, createdAt }   // connectors per level
 *   files      { id, ws, blockId, name, type, size, kind, blob, createdAt }
 *   meta       { key, value }
 *
 * A workspace's top level = records with parentId === DB.ROOT and a matching
 * `ws`. Nested levels use the (globally unique) parent block id. The `ws`
 * index lets us grab / delete / export an entire workspace at once.
 * ========================================================================= */
const DB = (() => {
  const DB_NAME = 'blocknotes';
  const DB_VERSION = 4;
  const ROOT = '__root__';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in window) || !window.indexedDB) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        const tx = req.transaction;
        const oldV = e.oldVersion;

        if (oldV < 1) {
          const b = db.createObjectStore('blocks', { keyPath: 'id' });
          b.createIndex('parentId', 'parentId', { unique: false });
          const ed = db.createObjectStore('edges', { keyPath: 'id' });
          ed.createIndex('parentId', 'parentId', { unique: false });
          const f = db.createObjectStore('files', { keyPath: 'id' });
          f.createIndex('blockId', 'blockId', { unique: false });
          db.createObjectStore('meta', { keyPath: 'key' });
        }

        if (oldV < 4) {
          // A level is (workspace, parent). With a compound index opening one
          // is a range read instead of "load the workspace and filter".
          const bs4 = tx.objectStore('blocks');
          if (!bs4.indexNames.contains('byLevel')) bs4.createIndex('byLevel', ['ws', 'parentId'], { unique: false });
          const es4 = tx.objectStore('edges');
          if (!es4.indexNames.contains('byLevel')) es4.createIndex('byLevel', ['ws', 'parentId'], { unique: false });
          const fs4 = tx.objectStore('files');
          if (!fs4.indexNames.contains('byWsBlock')) fs4.createIndex('byWsBlock', ['ws', 'blockId'], { unique: false });
        }

        if (oldV < 2) {
          if (!db.objectStoreNames.contains('workspaces')) {
            db.createObjectStore('workspaces', { keyPath: 'id' });
          }
          const bs = tx.objectStore('blocks');
          if (!bs.indexNames.contains('ws')) bs.createIndex('ws', 'ws', { unique: false });
          const es = tx.objectStore('edges');
          if (!es.indexNames.contains('ws')) es.createIndex('ws', 'ws', { unique: false });
          const fs = tx.objectStore('files');
          if (!fs.indexNames.contains('ws')) fs.createIndex('ws', 'ws', { unique: false });

          // Migrate any existing single-workspace data into a default workspace
          // so upgrading users keep everything.
          const defId = 'ws-default';
          tx.objectStore('workspaces').put({ id: defId, name: 'My Workspace', color: '#2b7fff', createdAt: 0, updatedAt: 0 });
          ['blocks', 'edges', 'files'].forEach((name) => {
            tx.objectStore(name).openCursor().onsuccess = (ev) => {
              const cur = ev.target.result;
              if (!cur) return;
              const v = cur.value;
              if (v.ws == null) { v.ws = defId; cur.update(v); }
              cur.continue();
            };
          });
        }

        if (oldV < 3) {
          // file handles for workspaces bound to a local file (File System Access API)
          if (!db.objectStoreNames.contains('handles')) {
            db.createObjectStore('handles', { keyPath: 'ws' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function reqP(request) {
    return new Promise((res, rej) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => rej(request.error);
    });
  }

  async function getAll(store) {
    await settled();
    const db = await open();
    return reqP(db.transaction(store, 'readonly').objectStore(store).getAll());
  }
  async function getAllByIndex(store, index, key) {
    await settled();
    const db = await open();
    const idx = db.transaction(store, 'readonly').objectStore(store).index(index);
    return reqP(idx.getAll(key));
  }
  async function get(store, key) {
    // served from the queue when it is waiting there (no commit needed)
    const m = queued.get(store);
    if (m && m.has(key)) { const e = m.get(key); return e.op === 'del' ? undefined : e.value; }
    await settled();
    const db = await open();
    return reqP(db.transaction(store, 'readonly').objectStore(store).get(key));
  }
  /* ---- write queue ------------------------------------------------------ *
   * Every change is queued and the queue is committed as ONE transaction per
   * animation frame. Moving 2000 objects used to be 2000 transactions.
   * `put`/`del` resolve as soon as the change is queued: reads below serve it
   * from the queue, so nothing can observe the difference, and `flush()` (what
   * autosave, undo ordering and the tests await) resolves on the commit.     */
  const QUEUE_STORES = ['workspaces', 'blocks', 'edges', 'files', 'meta', 'handles'];
  const queued = new Map();          // store -> Map(key -> {op:'put'|'del', value})
  let flushTimer = 0, flushing = null, flushWaiters = [];
  const keyOf = (store, value) => (store === 'meta' ? value.key : (store === 'handles' ? value.ws : value.id));

  function queueOp(store, key, op, value) {
    let m = queued.get(store);
    if (!m) { m = new Map(); queued.set(store, m); }
    m.set(key, { op, value });
    scheduleFlush();
  }
  function scheduleFlush() {
    if (flushTimer) return;
    const run = () => { flushTimer = 0; flush(); };
    flushTimer = (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !document.hidden)
      ? requestAnimationFrame(run) : setTimeout(run, 0);
  }
  function pendingCount() { let n = 0; for (const m of queued.values()) n += m.size; return n; }

  // Commit everything queued. Concurrent callers share the in-flight commit and
  // are re-queued behind it if more work arrived meanwhile.
  function flush() {
    if (flushing) return flushing.then(() => (pendingCount() ? flush() : undefined));
    if (!pendingCount()) return Promise.resolve();
    const batch = new Map(queued);
    queued.clear();
    flushing = (async () => {
      const dbi = await open();
      const stores = [...batch.keys()].filter(s => dbi.objectStoreNames.contains(s));
      if (!stores.length) return;
      await new Promise((resolve, reject) => {
        const tx = dbi.transaction(stores, 'readwrite');
        for (const store of stores) {
          const os = tx.objectStore(store);
          for (const [key, entry] of batch.get(store)) {
            if (entry.op === 'del') os.delete(key); else os.put(entry.value);
          }
        }
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('write failed'));
      });
    })().finally(() => { flushing = null; });
    const done = flushing;
    done.then(() => { const w = flushWaiters; flushWaiters = []; w.forEach(fn => fn()); }, () => {});
    return done.then(() => (pendingCount() ? flush() : undefined));
  }
  // A read must see what is queued: commit first, then read.
  function settled() { return pendingCount() || flushing ? flush() : Promise.resolve(); }

  function put(store, value) {
    if (QUEUE_STORES.includes(store)) { queueOp(store, keyOf(store, value), 'put', value); return Promise.resolve(value); }
    return open().then(dbi => reqP(dbi.transaction(store, 'readwrite').objectStore(store).put(value))).then(() => value);
  }
  function del(store, key) {
    if (QUEUE_STORES.includes(store)) { queueOp(store, key, 'del', null); return Promise.resolve(); }
    return open().then(dbi => reqP(dbi.transaction(store, 'readwrite').objectStore(store).delete(key)));
  }

  /* ---- workspaces ------------------------------------------------------ */
  const listWorkspaces = () => getAll('workspaces');
  const getWorkspace   = (id) => get('workspaces', id);
  const saveWorkspace  = (w)  => put('workspaces', w);
  const allByWs        = (store, ws) => getAllByIndex(store, 'ws', ws);

  async function deleteWorkspaceDeep(ws) {
    for (const store of ['files', 'edges', 'blocks']) {
      const items = await allByWs(store, ws);
      for (const it of items) await del(store, it.id);
    }
    try { await del('handles', ws); } catch (_) {}
    await del('workspaces', ws);
  }

  /* ---- file handles (File System Access API) --------------------------- */
  const getHandleRec  = (ws) => get('handles', ws);
  const saveHandleRec = (ws, handle) => put('handles', { ws, handle });
  const savePathRec   = (ws, path)   => put('handles', { ws, path });   // app shell: plain file path
  const delHandle     = (ws) => del('handles', ws);

  /* ---- blocks / edges / files ----------------------------------------- */
  // Root level is scoped by workspace; deeper levels use the unique parent id.
  // The root level of a workspace is a range on [ws, parentId]; deeper levels
  // are keyed by their (globally unique) parent id.
  function childBlocks(parentId, ws) {
    if (parentId !== ROOT) return getAllByIndex('blocks', 'parentId', parentId);
    if (ws == null) return getAllByIndex('blocks', 'parentId', ROOT);
    return getAllByIndex('blocks', 'byLevel', [ws, ROOT])
      .catch(() => allByWs('blocks', ws).then(l => l.filter(b => b.parentId === ROOT)));
  }
  function levelEdges(parentId, ws) {
    if (parentId !== ROOT) return getAllByIndex('edges', 'parentId', parentId);
    if (ws == null) return getAllByIndex('edges', 'parentId', ROOT);
    return getAllByIndex('edges', 'byLevel', [ws, ROOT])
      .catch(() => allByWs('edges', ws).then(l => l.filter(e => e.parentId === ROOT)));
  }
  const blockFiles = (blockId) => getAllByIndex('files', 'blockId', blockId);

  // Counts (and, for list cards, the first few items) for a whole level in ONE
  // readonly transaction. Opening a level used to run two index queries per
  // block, each in its own transaction, and each materialising every child
  // record; `count()` reads no records at all.
  async function levelStats(ids, peekIds) {
    const out = { counts: {}, peeks: {} };
    if (!ids || !ids.length) return out;
    await settled();
    const dbi = await open();
    const want = new Set(peekIds || []);
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction(['blocks', 'files'], 'readonly');
      const bi = tx.objectStore('blocks').index('parentId');
      const fi = tx.objectStore('files').index('blockId');
      for (const id of ids) {
        const c = { blocks: 0, files: 0 };
        out.counts[id] = c;
        const rb = bi.count(id); rb.onsuccess = () => { c.blocks = rb.result; };
        const rf = fi.count(id); rf.onsuccess = () => { c.files = rf.result; };
        if (want.has(id)) { const rp = bi.getAll(id); rp.onsuccess = () => { out.peeks[id] = rp.result; }; }
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('level stats failed'));
    });
  }
  const getBlock   = (id) => get('blocks', id);
  const saveBlock  = (b)  => put('blocks', b);
  const saveEdge   = (e)  => put('edges', e);
  const saveFile   = (f)  => put('files', f);
  const getFile    = (id) => get('files', id);
  const delFile    = (id) => del('files', id);
  const delEdge    = (id) => del('edges', id);
  const getMeta    = (k)  => get('meta', k);
  const setMeta    = (k, value) => put('meta', { key: k, value });

  // Delete a block and everything under it (descendants, files, touching edges).
  async function deleteBlockDeep(id) {
    const root0 = await getBlock(id);
    const toRemove = [];
    const collect = async (bid) => {
      toRemove.push(bid);
      const kids = await childBlocks(bid);
      for (const k of kids) await collect(k.id);
    };
    await collect(id);

    for (const bid of toRemove) {
      const files = await blockFiles(bid);
      for (const f of files) await delFile(f.id);
      await del('blocks', bid);
    }
    const removed = new Set(toRemove);
    const edges = (root0 && root0.ws) ? await allByWs('edges', root0.ws) : await getAll('edges');
    for (const e of edges) {
      if (removed.has(e.from) || removed.has(e.to)) await delEdge(e.id);
    }
  }

  // Breadcrumb path (root -> ... -> block) by walking parentId up.
  async function buildPath(blockId) {
    const path = [];
    let cur = blockId;
    const guard = new Set();
    while (cur && cur !== ROOT && !guard.has(cur)) {
      guard.add(cur);
      const b = await getBlock(cur);
      if (!b) break;
      path.unshift({ id: b.id, title: b.title });
      cur = b.parentId;
    }
    path.unshift({ id: ROOT, title: 'Home' });
    return path;
  }

  return {
    ROOT, open, getAll, get, put, del, flush, pendingWrites: pendingCount,
    listWorkspaces, getWorkspace, saveWorkspace, allByWs, deleteWorkspaceDeep,
    getHandleRec, saveHandleRec, savePathRec, delHandle,
    childBlocks, levelEdges, blockFiles, levelStats,
    getBlock, saveBlock, saveEdge, saveFile, getFile, delFile, delEdge,
    getMeta, setMeta, deleteBlockDeep, buildPath,
  };
})();
