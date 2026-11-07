// FieldBook sketch shape transforms — window.fbXform
//
// Uniform scaling of sketch shapes about an anchor point (the Scale tool).
// Plain JS, no React and no DOM: sketch.js draws the box and handles and calls
// these. Runs in Node too, for the tests (test-xform.js).
//
// Units: shapes are in sketch world px, except a few sizes that are kept in
// screen px so they look the same at any zoom — strokeWidth, a text box's w/h,
// a dim-angle's arc scale, a point's symbol. Scaling leaves stroke widths,
// symbols and arcs alone; a text box and its type grow with the drawing (see
// scaleShape), so text keeps its place and its line breaks.
(function (root) {
  const fin = v => typeof v === 'number' && isFinite(v);

  // Text wraps by character count, worked out from the box's screen width
  // (sketch.js renderShape 'text', index.html buildSketchSVG). A Courier
  // character is 9.5 × 0.601 screen px at fontSize 1.
  const TEXT_CHAR_W = 9.5 * 0.601;
  function textWrapChars(s) {
    if (fin(s.wrapChars) && s.wrapChars >= 1) return Math.floor(s.wrapChars);
    return Math.max(1, Math.floor(((s.w || 180) - 6) / TEXT_CHAR_W));
  }

  // ─── Scaling one shape ─────────────────────────────────────────────────────
  // Every coordinate moves to A + k (p − A). Lengths stored on the shape (radius,
  // width, height, dimension offsets) multiply by k. Rotation (_rot) is kept, and
  // a stored _pivot scales with the shape, so a rotated shape lands exactly where
  // its picture should: the default pivots (end-point midpoint, centre, box
  // centre, text centre) are points of the shape and scale with it.
  //
  // Text: its centre moves like any point; its box (w, h) and fontSize grow by k;
  // and wrapChars pins the line breaks as they were, so the words stay on the
  // same lines at the new size.
  //
  // dim-angle has no geometry of its own (it follows its two lines) and is
  // returned unchanged. Anything else unknown is returned unchanged too.
  function scaleShape(s, k, ax, ay) {
    if (!s || !fin(k) || k <= 0) return s;
    const X = v => ax + (v - ax) * k, Y = v => ay + (v - ay) * k;
    const P = p => (p && fin(p.x) && fin(p.y) ? { ...p, x: X(p.x), y: Y(p.y) } : p);
    const o = { ...s };
    switch (s.type) {
      case 'line':
        o.x1 = X(s.x1); o.y1 = Y(s.y1); o.x2 = X(s.x2); o.y2 = Y(s.y2);
        break;
      case 'curve':
        o.x1 = X(s.x1); o.y1 = Y(s.y1); o.x2 = X(s.x2); o.y2 = Y(s.y2);
        if (fin(s.px)) { o.px = X(s.px); o.py = Y(s.py); }
        if (fin(s.ax)) { o.ax = X(s.ax); o.ay = Y(s.ay); }        // older curves
        if (fin(s.cx)) { o.cx = X(s.cx); o.cy = Y(s.cy); }
        break;
      case 'circle':
        o.cx = X(s.cx); o.cy = Y(s.cy); o.r = s.r * k;
        break;
      case 'rect':
      case 'image':
        o.x = X(s.x); o.y = Y(s.y); o.w = s.w * k; o.h = s.h * k;
        break;
      case 'text':
        o.x = X(s.x); o.y = Y(s.y);
        o.wrapChars = textWrapChars(s);
        o.w = (s.w || 180) * k; o.h = (s.h || 80) * k;
        o.fontSize = (s.fontSize || 1) * k;
        break;
      case 'path':
        o.nodes = (s.nodes || []).map(n => {
          const m = { ...n, x: X(n.x), y: Y(n.y) };
          if (fin(n.cp1x)) { m.cp1x = X(n.cp1x); m.cp1y = Y(n.cp1y); }
          if (fin(n.cp2x)) { m.cp2x = X(n.cp2x); m.cp2y = Y(n.cp2y); }
          return m;
        });
        break;
      case 'point':
        o.x = X(s.x); o.y = Y(s.y);
        break;
      case 'dim-linear':
        o.p1 = P(s.p1); o.p2 = P(s.p2);
        if (fin(s.offset)) o.offset = s.offset * k;
        break;
      case 'dim-bearing':
        o.p1 = P(s.p1); o.p2 = P(s.p2);
        break;
      case 'dim-radius':
        // The offset is measured from the circle / arc it labels, which scales too.
        if (s.offset && fin(s.offset.x)) o.offset = { ...s.offset, x: s.offset.x * k, y: s.offset.y * k };
        break;
      default:
        return s;
    }
    if (s._pivot && fin(s._pivot.x)) o._pivot = { x: X(s._pivot.x), y: Y(s._pivot.y) };
    return o;
  }

  // Scale the shapes whose ids are in `ids`, leaving the rest as they are.
  function scaleShapes(shapes, ids, k, ax, ay) {
    const want = new Set(ids);
    return shapes.map(s => (want.has(s.id) ? scaleShape(s, k, ax, ay) : s));
  }

  // ─── Corner handles ────────────────────────────────────────────────────────
  // box = { minX, minY, maxX, maxY }. The four corners are 'nw' 'ne' 'se' 'sw'.
  function corners(box) {
    return { nw: { x: box.minX, y: box.minY }, ne: { x: box.maxX, y: box.minY },
             se: { x: box.maxX, y: box.maxY }, sw: { x: box.minX, y: box.maxY } };
  }
  const OPPOSITE = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };
  // The anchor a corner scales about: the opposite corner.
  function anchorFor(box, corner) { return corners(box)[OPPOSITE[corner]]; }
  // The factor a corner dragged to `pt` gives: how far along the box's diagonal
  // (anchor → grabbed corner) the pointer has gone. Never below kMin, so the
  // selection can't be turned inside out or shrunk to nothing.
  function cornerFactor(box, corner, pt, kMin) {
    const c = corners(box)[corner], a = corners(box)[OPPOSITE[corner]];
    const dx = c.x - a.x, dy = c.y - a.y, L2 = dx * dx + dy * dy;
    if (!(L2 > 0)) return 1;
    const k = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / L2;
    return Math.max(fin(kMin) && kMin > 0 ? kMin : 1e-9, k);
  }

  // ─── Groups ────────────────────────────────────────────────────────────────
  // A group is the shapes that share a groupId ('g_…'), two or more of them.
  // Membership lives on the shapes, so undo / redo, copy and save carry it with
  // no extra bookkeeping; a builder that doesn't know groups simply ignores the
  // field. Names are kept apart, on the page (page.groups = [{ id, name }]).
  // Points stay on their own Points layer; every other member shares one layer.
  const newGroupId = () => 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);

  // groupId → number of shapes carrying it.
  function groupSizes(shapes) {
    const n = {};
    for (const s of shapes) if (s.groupId) n[s.groupId] = (n[s.groupId] || 0) + 1;
    return n;
  }
  // The group a shape belongs to, or null (a lone groupId is no group).
  function groupOf(shapes, id, sizes) {
    const s = shapes.find(x => x.id === id);
    if (!s || !s.groupId) return null;
    return ((sizes || groupSizes(shapes))[s.groupId] || 0) >= 2 ? s.groupId : null;
  }
  function membersOf(shapes, gid) { return gid ? shapes.filter(s => s.groupId === gid) : []; }

  // ids plus every other member of any group they touch. `ok(shape)` filters
  // the members added (hidden / locked ones are left out). Order: ids as given,
  // then the added members in stack order.
  function expandGroups(ids, shapes, ok) {
    const sizes = groupSizes(shapes), want = new Set(ids), gids = new Set();
    for (const id of ids) { const g = groupOf(shapes, id, sizes); if (g) gids.add(g); }
    if (!gids.size) return ids.slice();
    const out = ids.slice();
    for (const s of shapes) {
      if (s.groupId && gids.has(s.groupId) && !want.has(s.id) && (!ok || ok(s))) { out.push(s.id); want.add(s.id); }
    }
    return out;
  }

  // The group id when `ids` is exactly the members of one group (of those
  // `ok` lets through), else null — what makes the Group button read "pressed".
  function wholeGroup(ids, shapes, ok) {
    if (!ids.length) return null;
    const sizes = groupSizes(shapes), g = groupOf(shapes, ids[0], sizes);
    if (!g) return null;
    const mem = membersOf(shapes, g).filter(s => !ok || ok(s)).map(s => s.id);
    const set = new Set(ids);
    return mem.length === set.size && mem.every(id => set.has(id)) ? g : null;
  }

  // Drop the groupId from any group left with fewer than 2 shapes. Returns the
  // same array when nothing changes; never reorders.
  function tidyGroups(shapes) {
    const sizes = groupSizes(shapes);
    if (!Object.values(sizes).some(n => n < 2)) return shapes;
    return shapes.map(s => (s.groupId && sizes[s.groupId] < 2 ? stripGroup(s) : s));
  }
  function stripGroup(s) { const { groupId, ...rest } = s; return rest; }

  // Group the shapes in `ids` as `gid`. opts: { layerOf(s) → its layer id,
  // activeLayerId, pointsLayerId, fixedLayers (layer ids a group can't live
  // on — Points, Aerial) }.
  //   • Home layer: the layer all non-point members share; else the active
  //     layer; else (active is Points / Aerial) the topmost non-point member's.
  //   • Non-point members move to the home layer and sit together in the
  //     stack where the topmost of them was, in their own order.
  //   • Points keep their place on the Points layer.
  // Shapes already in another group leave it (tidyGroups then clears a group
  // left with one shape).
  function makeGroup(shapes, ids, gid, opts) {
    const o = opts || {}, layerOf = o.layerOf || (s => s.layerId);
    const want = new Set(ids);
    const members = shapes.filter(s => want.has(s.id));
    if (members.length < 2) return shapes;
    const isPt = s => s.type === 'point';
    const lines = members.filter(s => !isPt(s));
    let home = null;
    if (lines.length) {
      const ls = new Set(lines.map(layerOf));
      const fixed = new Set(o.fixedLayers || []);
      if (ls.size === 1) home = [...ls][0];
      else if (o.activeLayerId && !fixed.has(o.activeLayerId)) home = o.activeLayerId;
      else home = layerOf(lines[lines.length - 1]);
    }
    const tag = s => (isPt(s) ? { ...s, groupId: gid } : { ...s, groupId: gid, layerId: home });
    const lineIds = new Set(lines.map(s => s.id));
    const topIdx = shapes.reduce((m, s, i) => (lineIds.has(s.id) ? i : m), -1);
    const out = [];
    shapes.forEach((s, i) => {
      if (lineIds.has(s.id)) { if (i === topIdx) lines.forEach(m => out.push(tag(m))); return; }
      out.push(want.has(s.id) ? tag(s) : s);
    });
    return tidyGroups(out);
  }
  function ungroup(shapes, gid) { return shapes.map(s => (s.groupId === gid ? stripGroup(s) : s)); }

  // Copies (paste / duplicate) get groups of their own: each groupId in `list`
  // is replaced with a new one. Returns { shapes, map: { oldGid: newGid } }.
  function remapGroups(list, makeId) {
    const map = {}, mk = makeId || newGroupId;
    const shapes = list.map(s => {
      if (!s.groupId) return s;
      if (!map[s.groupId]) map[s.groupId] = mk();
      return { ...s, groupId: map[s.groupId] };
    });
    return { shapes, map };
  }

  // ─── Stack order inside a layer ────────────────────────────────────────────
  // A layer's shapes in stack order (bottom first) as units: a run of members
  // of one group is one unit, any other shape is a unit of its own.
  function stackUnits(layerShapes, sizes) {
    const units = [];
    for (const s of layerShapes) {
      const g = s.groupId && (sizes[s.groupId] || 0) >= 2 ? s.groupId : null;
      const last = units[units.length - 1];
      if (g && last && last.gid === g) last.ids.push(s.id);
      else units.push({ gid: g, ids: [s.id] });
    }
    return units;
  }
  // Move the unit holding `id` one step up (dir +1, towards the top) or down
  // within its layer, past the next unit whole — so a shape jumps a group
  // rather than landing inside it. Shapes of other layers keep their places.
  function moveInLayer(shapes, id, dir, layerOf) {
    const lo = layerOf || (s => s.layerId);
    const me = shapes.find(s => s.id === id);
    if (!me) return shapes;
    const lid = lo(me), idx = [];
    shapes.forEach((s, i) => { if (lo(s) === lid) idx.push(i); });
    const layerShapes = idx.map(i => shapes[i]);
    const units = stackUnits(layerShapes, groupSizes(shapes));
    const u = units.findIndex(x => x.ids.includes(id)), t = u + (dir > 0 ? 1 : -1);
    if (u < 0 || t < 0 || t >= units.length) return shapes;
    [units[u], units[t]] = [units[t], units[u]];
    const byId = Object.fromEntries(layerShapes.map(s => [s.id, s]));
    const order = units.flatMap(x => x.ids).map(i => byId[i]);
    const out = shapes.slice();
    idx.forEach((i, k) => { out[i] = order[k]; });
    return out;
  }

  const api = {
    scaleShape, scaleShapes, corners, anchorFor, cornerFactor, textWrapChars, TEXT_CHAR_W,
    newGroupId, groupSizes, groupOf, membersOf, expandGroups, wholeGroup, tidyGroups, makeGroup, ungroup,
    remapGroups, stackUnits, moveInLayer,
  };
  root.fbXform = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
