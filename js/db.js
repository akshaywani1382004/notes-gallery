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
  const DB_VERSION = 3;
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
    const db = await open();
    return reqP(db.transaction(store, 'readonly').objectStore(store).getAll());
  }
  async function getAllByIndex(store, index, key) {
    const db = await open();
    const idx = db.transaction(store, 'readonly').objectStore(store).index(index);
    return reqP(idx.getAll(key));
  }
  async function get(store, key) {
    const db = await open();
    return reqP(db.transaction(store, 'readonly').objectStore(store).get(key));
  }
  async function put(store, value) {
    const db = await open();
    await reqP(db.transaction(store, 'readwrite').objectStore(store).put(value));
    return value;
  }
  async function del(store, key) {
    const db = await open();
    await reqP(db.transaction(store, 'readwrite').objectStore(store).delete(key));
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
  function childBlocks(parentId, ws) {
    if (parentId === ROOT) return allByWs('blocks', ws).then(l => l.filter(b => b.parentId === ROOT));
    return getAllByIndex('blocks', 'parentId', parentId);
  }
  function levelEdges(parentId, ws) {
    if (parentId === ROOT) return allByWs('edges', ws).then(l => l.filter(e => e.parentId === ROOT));
    return getAllByIndex('edges', 'parentId', parentId);
  }
  const blockFiles = (blockId) => getAllByIndex('files', 'blockId', blockId);
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
    const edges = await getAll('edges');
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
    ROOT, open, getAll, get, put, del,
    listWorkspaces, getWorkspace, saveWorkspace, allByWs, deleteWorkspaceDeep,
    getHandleRec, saveHandleRec, savePathRec, delHandle,
    childBlocks, levelEdges, blockFiles,
    getBlock, saveBlock, saveEdge, saveFile, getFile, delFile, delEdge,
    getMeta, setMeta, deleteBlockDeep, buildPath,
  };
})();
