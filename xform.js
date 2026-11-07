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

  const api = { scaleShape, scaleShapes, corners, anchorFor, cornerFactor, textWrapChars, TEXT_CHAR_W };
  root.fbXform = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
