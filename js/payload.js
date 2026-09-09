/* Notes Gallery — the workspace file format, in one place.

   A workspace is written to disk (autosave) and exported (Save As) through the
   same shape, and it is now built in a worker as well as on the page, so the
   rules live here rather than in three copies. Nothing in this file touches
   the DOM or IndexedDB: it takes records in and gives the file's object out.  */
(() => {
  const root = (typeof globalThis !== 'undefined') ? globalThis : self;
  const NGPayload = {};

  // A connector keeps its label, line style and both-ends arrow; everything
  // else about it is derivable.
  NGPayload.edgeOut = (e) => {
    const o = { id: e.id, parentId: e.parentId, from: e.from, to: e.to, createdAt: e.createdAt };
    if (e.label) o.label = e.label;
    if (e.style) o.style = e.style;
    if (e.both) o.both = true;
    return o;
  };

  // parts: { workspace, blocks, edges, files } where each file already carries
  // its `data` (a data URL). `name` overrides the workspace's own name.
  NGPayload.build = (parts, name, defaultColor) => {
    const w = parts.workspace || {};
    const blocks = (parts.blocks || []).map(b => { const o = { ...b }; delete o.ws; return o; });
    const edges = (parts.edges || []).map(NGPayload.edgeOut);
    const files = (parts.files || []).map(f => ({
      blockId: f.blockId, name: f.name, type: f.type, size: f.size, kind: f.kind, createdAt: f.createdAt, data: f.data,
    }));
    return {
      app: 'NotesGallery', kind: 'workspace', version: 2, exportedAt: new Date().toISOString(),
      workspace: { name: name || w.name || 'Workspace', color: w.color || defaultColor || '#3F8A66', paper: w.paper || 'dots' },
      blocks, edges, files,
    };
  };

  root.NGPayload = NGPayload;
})();
