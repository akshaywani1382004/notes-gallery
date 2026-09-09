/* Notes Gallery — the save worker.

   Writing a workspace to its file means reading every record, turning each
   attachment into a data URL and stringifying the lot. On a page of six
   thousand strokes that was a quarter of a second in which nothing on screen
   could move - and it happens while you are still writing. Here it happens on
   another thread: the worker opens the same database, builds the file with the
   shared builder in payload.js and posts back the finished text. The page only
   has to write it.

   Classic worker on purpose: the app must also run from a plain file:// double
   click, where module workers are refused. The page falls back to building the
   file itself if a worker cannot start at all.                                */
importScripts('payload.js');

const DB_NAME = 'blocknotes';

function open() {
  return new Promise((resolve, reject) => {
    // Never upgrade from here: the page owns the schema. An older version
    // number would block, so open whatever is there.
    const rq = indexedDB.open(DB_NAME);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error || new Error('cannot open the database'));
    rq.onblocked = () => reject(new Error('the database is blocked'));
  });
}

function allByWs(db, store, ws) {
  return new Promise((resolve, reject) => {
    const os = db.transaction(store, 'readonly').objectStore(store);
    if (!os.indexNames.contains('ws')) { resolve([]); return; }
    const rq = os.index('ws').getAll(ws);
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error);
  });
}

function getOne(db, store, key) {
  return new Promise((resolve, reject) => {
    const rq = db.transaction(store, 'readonly').objectStore(store).get(key);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('cannot read an attachment'));
    fr.readAsDataURL(blob);
  });
}

self.onmessage = async (e) => {
  const { id, ws, name, color } = e.data || {};
  try {
    const db = await open();
    const [workspace, blocks, edges, files] = await Promise.all([
      getOne(db, 'workspaces', ws),
      allByWs(db, 'blocks', ws),
      allByWs(db, 'edges', ws),
      allByWs(db, 'files', ws),
    ]);
    const outFiles = [];
    for (const f of files) {
      outFiles.push(Object.assign({}, f, { data: f.blob ? await blobToDataUrl(f.blob) : null, blob: undefined }));
    }
    db.close();
    const payload = NGPayload.build({ workspace, blocks, edges, files: outFiles }, name, color);
    const json = JSON.stringify(payload);
    self.postMessage({ id, json, bytes: json.length, blocks: blocks.length });
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || String(err) });
  }
};
