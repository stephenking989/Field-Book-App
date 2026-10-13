// FieldBook sketch print-area engine — window.fbPrint
//
// A print area is a frame on a sketch that prints as a PDF page of its own.
// It is stored on the sketch page as { id, label, x, y, w }: its top-left
// corner and its width, in sketch world px. Its height is never stored — it
// always comes from the paper, so a frame cannot drift off the page's shape.
//
// Plain JS, no React and no DOM: sketch.js draws and drags the frames,
// index.html prints them. Runs in Node too, for the tests (test-print.js).
(function (root) {
  const fin = v => typeof v === 'number' && isFinite(v);

  // ─── Paper ─────────────────────────────────────────────────────────────────
  // The drawable area of a sketch page in the PDF, in mm: A4 portrait with
  // 14 mm margins, less the 23 mm header band and the 14 mm footer strip.
  // exportProjectPDF / exportSinglePagePDF print a frame into exactly this box.
  const PAPER = { w: 182, h: 232 };
  const RATIO = PAPER.h / PAPER.w;

  // (multiplied before dividing, so a 182 px frame is exactly 232 px tall)
  function frameRect(a) { return { x: a.x, y: a.y, w: a.w, h: a.w * PAPER.h / PAPER.w }; }
  const centre = a => ({ x: a.x + a.w / 2, y: a.y + a.w * RATIO / 2 });

  // ─── Print scale ───────────────────────────────────────────────────────────
  // The frame's width on the ground over the paper's width. `pxPerMetre` is
  // the sketch's world px per metre at 1:1 (PIXELS_PER_METER in sketch.js).
  function frameScale(a, scaleDenom, pxPerMetre) {
    return (a.w * scaleDenom / pxPerMetre) / (PAPER.w / 1000);
  }
  function widthForScale(denom, scaleDenom, pxPerMetre) {
    return denom * (PAPER.w / 1000) * pxPerMetre / scaleDenom;
  }
  // The frame resized about its centre to print at exactly 1:denom.
  function setScale(a, denom, scaleDenom, pxPerMetre) {
    const c = centre(a), w = widthForScale(denom, scaleDenom, pxPerMetre);
    return { ...a, x: c.x - w / 2, y: c.y - w * RATIO / 2, w };
  }
  // "1:250" for a round scale, "≈1:247" for whatever a drag left behind.
  function scaleText(denom) {
    if (!fin(denom) || denom <= 0) return '';
    const whole = Math.round(denom);
    if (Math.abs(denom - whole) <= denom * 1e-6) return `1:${whole}`;
    return `≈1:${denom < 20 ? denom.toFixed(1) : whole}`;
  }

  // ─── Moving, resizing, drawing ─────────────────────────────────────────────
  function move(a, dx, dy) { return { ...a, x: a.x + dx, y: a.y + dy }; }
  // Drag a corner ('nw' 'ne' 'se' 'sw') to `pt`: the opposite corner stays put,
  // the paper ratio holds, and the frame follows whichever of the pointer's
  // reach across or down is the larger. Never narrower than minW.
  function resize(a, corner, pt, minW) {
    const r = frameRect(a), west = corner.includes('w'), north = corner.includes('n');
    const ax = west ? r.x + r.w : r.x, ay = north ? r.y + r.h : r.y;        // the fixed corner
    const w = Math.max(minW, Math.abs(pt.x - ax), Math.abs(pt.y - ay) / RATIO);
    return { ...a, x: west ? ax - w : ax, y: north ? ay - w * RATIO : ay, w };
  }
  // The frame a drag from p0 to p1 draws, or null while it is still under minW.
  function fromDrag(p0, p1, minW) {
    const w = Math.max(Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y) / RATIO);
    if (w < minW) return null;
    return { x: p1.x < p0.x ? p0.x - w : p0.x, y: p1.y < p0.y ? p0.y - w * RATIO : p0.y, w };
  }
  // A frame centred in a view, filling `fill` of whichever way is tighter.
  function fitView(view, fill) {
    const w = Math.min(view.w, view.h / RATIO) * (fill || 0.8);
    return { x: view.x + (view.w - w) / 2, y: view.y + (view.h - w * RATIO) / 2, w };
  }

  // ─── Labels ────────────────────────────────────────────────────────────────
  // A … Z, then AA, AB … (the way spreadsheet columns run).
  function labelAt(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
    return s;
  }
  function labelIndex(label) {
    const t = String(label || '').toUpperCase();
    if (!/^[A-Z]+$/.test(t)) return Infinity;
    let n = 0;
    for (const ch of t) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  // The first label nothing uses — deleting A frees it for the next frame.
  function nextLabel(areas) {
    const used = new Set((areas || []).map(a => a.label));
    for (let i = 0; ; i++) if (!used.has(labelAt(i))) return labelAt(i);
  }
  // Print order: by label, not by the order the frames were drawn in.
  function sorted(areas) {
    return (areas || []).map((a, i) => [a, i]).sort((p, q) => labelIndex(p[0].label) - labelIndex(q[0].label) || p[1] - q[1]).map(p => p[0]);
  }
  // Area A — the one a station sketch and its thumbnail show.
  function primary(areas) { return (areas || []).find(a => a.label === 'A') || null; }

  // ─── Hit-testing ───────────────────────────────────────────────────────────
  // What a tap at `pt` lands on: a corner handle of the selected frame, else
  // the body of the smallest frame it is inside (so a frame nested in another
  // can still be reached). `tol` is the handle reach, in world px.
  function hit(areas, pt, tol, selectedId) {
    const sel = (areas || []).find(a => a.id === selectedId);
    if (sel) {
      const r = frameRect(sel);
      const corners = { nw: [r.x, r.y], ne: [r.x + r.w, r.y], se: [r.x + r.w, r.y + r.h], sw: [r.x, r.y + r.h] };
      for (const part of Object.keys(corners)) {
        if (Math.abs(pt.x - corners[part][0]) <= tol && Math.abs(pt.y - corners[part][1]) <= tol) return { id: sel.id, part };
      }
    }
    const inside = (areas || []).filter(a => {
      const r = frameRect(a);
      return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
    });
    if (!inside.length) return null;
    return { id: inside.reduce((best, a) => (a.w < best.w ? a : best)).id, part: 'body' };
  }

  // ─── Stored data ───────────────────────────────────────────────────────────
  const newId = () => 'pa_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  // What a sketch page has saved, made safe to use: frames with real numbers
  // and a width, each with an id and a label of its own. A page saved before
  // print areas existed has none.
  function normalize(raw) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach(a => {
      if (!a || !fin(a.x) || !fin(a.y) || !fin(a.w) || a.w <= 0) return;
      const label = /^[A-Z]+$/.test(String(a.label || '')) && !out.some(b => b.label === a.label) ? a.label : nextLabel(out);
      out.push({ id: a.id ? String(a.id) : newId(), label, x: a.x, y: a.y, w: a.w });
    });
    return out;
  }

  const api = {
    PAPER, RATIO, frameRect, frameScale, widthForScale, setScale, scaleText,
    move, resize, fromDrag, fitView,
    labelAt, nextLabel, sorted, primary, hit, normalize, newId,
  };
  root.fbPrint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
