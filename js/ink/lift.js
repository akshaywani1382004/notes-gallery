/* Notes Gallery 2.0 — NG.Lift: many blocks moving together are reparented
   into one transformed container (div#lift inside #world), so a drag or a
   grip scale costs one style write per pointer move instead of N left/top
   writes (and N style recalcs) on the individual .block elements.

   API (all coordinates in world units — #lift lives inside the transformed
   #world, so 1 world unit = 1 px of #lift's own transform):

   NG.Lift.active
     null, or {el, items, mode, dx, dy, ratio, ox, oy} while a lift is up.
     items: [{id, el, next}] in the DOM order they had before begin();
     `next` is the original next sibling (already resolved past other
     lifted elements, so a whole adjacent run shares one `next`).

   NG.Lift.begin(ids, mode, ctx)
     ids   iterable of block ids to lift (ids without an element, or whose
           element is not a direct child of world, are skipped)
     mode  'move' | 'scale' (informational; stored on active.mode)
     ctx   {world, els}: world = the #world element (default #world in the
           document), els = id -> element map (default NG.bag.state.els).
     Creates div#lift appended to world, moves each element into it in DOM
     order, sets #lift's z-index to the max of the items' inline z-index
     (so the group keeps painting above what it painted above), increments
     NG.counters.lifts. A lift that is still active is ended (no commit)
     first. Returns the active record.

   NG.Lift.move(dxWorld, dyWorld)
     #lift.style.transform = translate(dx px, dy px).

   NG.Lift.scale(ox, oy, ratio)
     transform = translate(ox, oy) scale(ratio) translate(-ox, -oy): every
     lifted element scales about the world point (ox, oy) — pass the
     selection box's top-left in WORLD units (not screen), because the
     transform composes inside #world's own translate/scale.

   NG.Lift.refresh(els)
     After undo/redo (applyRecsToView) replaced elements: any item whose
     els[id] is a different element adopts the new one into #lift in the
     old one's place (applyRecsToView's replaceWith already leaves it there;
     a freshly appended element is moved in). Also re-keys the els map used
     to resolve stale neighbours at end().

   NG.Lift.end(commit) -> items
     Puts every element still inside #lift back into world before its
     original next sibling (or appends when the run ended the parent), so
     the DOM order after end() equals the order before begin(); clears the
     transform, removes #lift and returns the items so the caller can write
     the final left/top (commit === true) or the reverted ones (false) —
     the container never touches left/top itself. Neighbours that vanished
     or were replaced during the lift are resolved through the DOM-order
     snapshot taken at begin() and the els map, so order survives an undo
     in the middle of a drag.

   NG.Lift.isLifted(id) -> bool, NG.Lift.has() -> bool.

   Classic script on globalThis.NG; loaded after ng.js and before app.js. */
(() => {
  const NG = (globalThis.NG = globalThis.NG || {});

  let active = null;

  const defaultWorld = () => (typeof document !== 'undefined' ? document.getElementById('world') : null);
  const defaultEls = () => (NG.bag && NG.bag.state && NG.bag.state.els) || null;

  // The element that should follow `item` once it is back in world. The
  // snapshot index walks forward over anything that has since left world
  // (deleted, or still lifted in a later run); a replaced neighbour is
  // found again through the els map by its data-id so the item lands
  // before the new element rather than one slot further down.
  function resolveNext(a, item) {
    const world = a.world, order = a.order, els = a.els;
    for (let i = item.nextIdx; i < order.length; i++) {
      const n = order[i];
      if (n.parentNode === world) return n;
      const id = n.dataset && n.dataset.id;
      if (id && els) {
        const r = els[id];
        if (r && r !== n && r.parentNode === world && !a.ids.has(id)) return r;
      }
    }
    return null;
  }

  function begin(ids, mode, ctx) {
    if (active) end(false);
    const world = (ctx && ctx.world) || defaultWorld();
    const els = (ctx && ctx.els) || defaultEls();
    if (!world || !els) return null;

    const want = new Set();
    const idSet = new Set();
    for (const id of ids || []) {
      const el = els[id];
      if (el && el.parentNode === world) { want.add(el); idSet.add(id); }
    }
    if (!want.size) return null;

    // One pass over world's children gives both the items in DOM order and
    // the order snapshot end() falls back on. This is the only O(children)
    // step of a lift; every move afterwards is O(1).
    const order = [];
    const items = [];
    let maxZ = 0;
    const kids = world.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      order.push(c);
      if (!want.has(c)) continue;
      const z = parseInt(c.style.zIndex, 10) || 0;
      if (z > maxZ) maxZ = z;
      items.push({ id: c.dataset.id, el: c, next: null, nextIdx: i + 1 });
    }
    // An adjacent run shares the first non-lifted sibling after it (or null
    // when the run closes the parent): chain-safe restore in one insertBefore.
    for (const it of items) {
      let j = it.nextIdx;
      while (j < order.length && want.has(order[j])) j++;
      it.nextIdx = j;
      it.next = j < order.length ? order[j] : null;
    }

    const lift = world.ownerDocument.createElement('div');
    lift.id = 'lift';
    if (maxZ) lift.style.zIndex = String(maxZ);
    for (const it of items) lift.appendChild(it.el);
    world.appendChild(lift);

    active = { el: lift, items, mode: mode || 'move', dx: 0, dy: 0, ratio: 1, ox: 0, oy: 0, world, els, order, ids: idSet };
    if (NG.counters) NG.counters.lifts = (NG.counters.lifts || 0) + 1;
    return active;
  }

  function move(dx, dy) {
    const a = active; if (!a) return;
    if (dx === a.dx && dy === a.dy && a.ratio === 1) return;
    a.dx = dx; a.dy = dy; a.ratio = 1;
    a.el.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function scale(ox, oy, ratio) {
    const a = active; if (!a) return;
    a.ox = ox; a.oy = oy; a.ratio = ratio; a.dx = 0; a.dy = 0;
    a.el.style.transform = `translate(${ox}px, ${oy}px) scale(${ratio}) translate(${-ox}px, ${-oy}px)`;
  }

  function refresh(els) {
    const a = active; if (!a) return;
    if (els) a.els = els;
    const map = a.els; if (!map) return;
    const lift = a.el;
    for (const it of a.items) {
      const cur = map[it.id];
      if (!cur || cur === it.el) continue;
      if (cur.parentNode !== lift) {
        // replaceWith on an element inside #lift already put the new one
        // here; an element created elsewhere is moved into the old slot
        if (it.el.parentNode === lift) lift.replaceChild(cur, it.el);
        else lift.appendChild(cur);
      }
      it.el = cur;
    }
  }

  function end(commit) {
    const a = active; if (!a) return [];
    active = null;
    const { el: lift, world, items, els } = a;
    lift.style.transform = '';
    for (const it of items) {
      let el = it.el;
      if (el.parentNode !== lift) {
        // refresh() was not called after a swap: pick up the replacement
        const cur = els && els[it.id];
        if (cur && cur.parentNode === lift) el = it.el = cur;
        else continue;                       // deleted during the lift: nothing to put back
      }
      const next = it.next && it.next.parentNode === world ? it.next : resolveNext(a, it);
      world.insertBefore(el, next);
    }
    lift.remove();
    a.commit = !!commit;
    return items;
  }

  const isLifted = (id) => !!(active && active.ids.has(id));
  const has = () => !!active;

  NG.Lift = {
    get active() { return active; },
    begin, move, scale, refresh, end, isLifted, has,
  };
})();
