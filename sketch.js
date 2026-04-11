// =============================================================================
// SKETCH ENGINE  —  sketch.js
// Loaded by index.html via <script type="text/babel" src="./sketch.js">.
// Depends on window._fb (set by index.html before this script runs):
//   window._fb.DB            — data-layer object
//   window._fb.PageHeaderStrip — shared page-header component
// Signals readiness by calling window._resolveSketch() at the end,
// which unblocks the ReactDOM.createRoot() call in index.html.
// =============================================================================

const { useState, useEffect, useRef } = React;
const { DB, PageHeaderStrip } = window._fb;



// ─────────────────────────────────────────────────────────────────────────────
// SKETCH PAGE — vector drawing
// ─────────────────────────────────────────────────────────────────────────────

const SVG_W = 800;
const SVG_H = 600;
const STROKE = '#1a1a2e';
const STROKE_W = 1.8;
const NODE_R = 6;
const CP_R = 5;           // control-point handle radius
const ROT_HANDLE_DIST = 44; // px from pivot to rotate handle
const PIVOT_R = 5;          // pivot crosshair circle radius
const ROT_R   = 9;          // rotate handle hit radius
// Node keys that snap (excludes bezier handle 'cp' and body/pivot/rotate pseudo-keys)
const SNAP_NODES = new Set(['p1', 'p2', 'c', 'r', 'tl', 'tr', 'bl', 'br']);

// ── Sketch tool SVG icons — 20×20 viewBox, stroke="currentColor" ──────────────
const SketchIco = {
  // Arrow cursor with a subtle tail
  Select: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2 L3 14 L7 10 L10 17 L12 16 L9 9 L14 9 Z" fill="currentColor" fillOpacity="0.25" strokeWidth="1.3"/>
    </svg>
  ),
  // Straight diagonal line with endpoint dots
  Line: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="3" y1="17" x2="17" y2="3"/>
      <circle cx="3" cy="17" r="1.5" fill="currentColor"/>
      <circle cx="17" cy="3" r="1.5" fill="currentColor"/>
    </svg>
  ),
  // Smooth arc with endpoint dots
  Curve: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 16 C5 4, 15 4, 17 16"/>
      <circle cx="3" cy="16" r="1.5" fill="currentColor"/>
      <circle cx="17" cy="16" r="1.5" fill="currentColor"/>
    </svg>
  ),
  // Pencil with eraser end
  Pencil: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2.5 a2 2 0 0 1 2.83 2.83 L6 16.5 l-4 1 1-4 Z"/>
      <line x1="12" y1="5" x2="15" y2="8" strokeWidth="1.2" opacity="0.6"/>
    </svg>
  ),
  // Fountain pen nib
  Pen: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 17 L3 10 L10 2 L17 10 Z" fillOpacity="0.15" fill="currentColor"/>
      <path d="M10 17 L3 10 L10 2 L17 10 Z"/>
      <line x1="10" y1="2" x2="10" y2="17"/>
      <circle cx="10" cy="17" r="1.3" fill="currentColor"/>
    </svg>
  ),
  // Node edit — path with visible bezier handles
  Node: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M3 15 C5 5, 15 5, 17 15" strokeWidth="1.6"/>
      <circle cx="3" cy="15" r="2" fill="currentColor" fillOpacity="0.9"/>
      <circle cx="17" cy="15" r="2" fill="currentColor" fillOpacity="0.9"/>
      <circle cx="10" cy="5" r="1.5" fill="none" strokeWidth="1.3"/>
      <line x1="3" y1="15" x2="6" y2="7" strokeDasharray="1.5 1.5" opacity="0.55"/>
      <line x1="17" y1="15" x2="14" y2="7" strokeDasharray="1.5 1.5" opacity="0.55"/>
    </svg>
  ),
  // Circle with centre crosshair
  Circle: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="10" cy="10" r="7"/>
      <line x1="10" y1="7" x2="10" y2="13" strokeWidth="1.2" opacity="0.5"/>
      <line x1="7" y1="10" x2="13" y2="10" strokeWidth="1.2" opacity="0.5"/>
      <circle cx="10" cy="10" r="1.2" fill="currentColor"/>
    </svg>
  ),
  // Rectangle with corner marks
  Rect: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="14" height="10" rx="1.5"/>
      <circle cx="3" cy="5" r="1.2" fill="currentColor" fillOpacity="0.6"/>
      <circle cx="17" cy="15" r="1.2" fill="currentColor" fillOpacity="0.6"/>
    </svg>
  ),
  // Text cursor T
  Text: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="5" x2="16" y2="5"/>
      <line x1="10" y1="5" x2="10" y2="16"/>
      <line x1="7" y1="16" x2="13" y2="16" strokeWidth="1.2" opacity="0.6"/>
    </svg>
  ),
  // Eraser block
  Eraser: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 15 L9 4 L17 8 L11 19 Z" fillOpacity="0.15" fill="currentColor"/>
      <path d="M3 15 L9 4 L17 8 L11 19 Z"/>
      <line x1="3" y1="15" x2="11" y2="19"/>
      <line x1="6" y1="9.5" x2="14" y2="13.5" strokeWidth="1" opacity="0.5"/>
    </svg>
  ),
  // Paint bucket with drip
  Fill: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13 L10 3 L14 7 L7 17 Z" fillOpacity="0.2" fill="currentColor"/>
      <path d="M3 13 L10 3 L14 7 L7 17 Z"/>
      <line x1="10" y1="3" x2="7" y2="17" strokeWidth="1" opacity="0.4"/>
      <circle cx="16" cy="15" r="2.5" fillOpacity="0.3" fill="currentColor"/>
      <circle cx="16" cy="15" r="2.5"/>
      <line x1="16" y1="11" x2="16" y2="12.5" strokeWidth="1.3"/>
    </svg>
  ),
  // Linear dimension — two endpoints with extension lines and arrow
  DimLinear: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="3" y1="13" x2="17" y2="13"/>
      <line x1="3" y1="10" x2="3" y2="16" strokeWidth="1.2"/>
      <line x1="17" y1="10" x2="17" y2="16" strokeWidth="1.2"/>
      <polyline points="6 11 3 13 6 15" strokeWidth="1.2"/>
      <polyline points="14 11 17 13 14 15" strokeWidth="1.2"/>
      <line x1="7" y1="7" x2="13" y2="7" strokeWidth="1" strokeDasharray="2 1.5" opacity="0.5"/>
    </svg>
  ),
  // Angle arc between two lines
  DimAngle: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="4" y1="16" x2="16" y2="4"/>
      <line x1="4" y1="16" x2="17" y2="16"/>
      <path d="M14 16 A10 10 0 0 0 10.5 9.5" strokeWidth="1.3"/>
      <text x="11" y="17" fontSize="5" fill="currentColor" stroke="none" fontFamily="sans-serif">°</text>
    </svg>
  ),
  // Bearing — north arrow with compass rose hint
  DimBearing: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" strokeWidth="1.1" opacity="0.35"/>
      <line x1="10" y1="3" x2="10" y2="17" strokeWidth="1" opacity="0.3"/>
      <line x1="3" y1="10" x2="17" y2="10" strokeWidth="1" opacity="0.3"/>
      <path d="M10 3 L12.5 10 L10 9 L7.5 10 Z" fill="currentColor" fillOpacity="0.85" strokeWidth="1"/>
      <text x="8.5" y="7" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="sans-serif" fontWeight="bold">N</text>
    </svg>
  ),
  // Radius — circle with radius line and R label
  DimRadius: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="10" cy="11" r="7"/>
      <line x1="10" y1="11" x2="15.5" y2="5.5"/>
      <circle cx="10" cy="11" r="1.2" fill="currentColor"/>
      <text x="13" y="8" fontSize="5" fill="currentColor" stroke="none" fontFamily="sans-serif" fontWeight="bold">R</text>
    </svg>
  ),
};

const TOOLS = [
  { id: 'select',    label: 'Select',    icon: <SketchIco.Select /> },
  { id: 'line',      label: 'Line',      icon: <SketchIco.Line /> },
  { id: 'curve',     label: 'Curve',     icon: <SketchIco.Curve /> },
  { id: 'pencil',    label: 'Pencil',    icon: <SketchIco.Pencil /> },
  { id: 'pen',       label: 'Pen',       icon: <SketchIco.Pen /> },
  { id: 'node',      label: 'Node',      icon: <SketchIco.Node /> },
  { id: 'circle',    label: 'Circle',    icon: <SketchIco.Circle /> },
  { id: 'rect',      label: 'Rect',      icon: <SketchIco.Rect /> },
  { id: 'text',      label: 'Text',      icon: <SketchIco.Text /> },
  { id: 'eraser',    label: 'Eraser',    icon: <SketchIco.Eraser /> },
  { id: 'fill',      label: 'Fill',      icon: <SketchIco.Fill /> },
  { id: 'dim-linear',  label: 'Dist',    icon: <SketchIco.DimLinear /> },
  { id: 'dim-angle',   label: 'Angle',   icon: <SketchIco.DimAngle /> },
  { id: 'dim-bearing', label: 'Bearing', icon: <SketchIco.DimBearing /> },
  { id: 'dim-radius',  label: 'Radius',  icon: <SketchIco.DimRadius /> },
];

function newId() { return 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }

// ── Rotation helpers ──────────────────────────────────────────────────────────
// Returns the pivot point for a shape. Uses stored _pivot if set, otherwise
// computes the geometric centre of the shape.
function getShapePivot(shape) {
  if (shape._pivot) return { ...shape._pivot };
  switch (shape.type) {
    case 'line':   return { x: (shape.x1+shape.x2)/2,          y: (shape.y1+shape.y2)/2          };
    case 'curve':  return { x: (shape.x1+shape.x2)/2,          y: (shape.y1+shape.y2)/2          };
    case 'circle': return { x: shape.cx,                        y: shape.cy                       };
    case 'rect':   return { x: shape.x + shape.w/2,             y: shape.y + shape.h/2            };
    case 'text':   return { x: shape.x,                          y: shape.y                        }; // s.x/y is center
    case 'path': {
      if (!shape.nodes || shape.nodes.length === 0) return { x: 0, y: 0 };
      const xs = shape.nodes.map(n => n.x);
      const ys = shape.nodes.map(n => n.y);
      return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
    }
    default:       return { x: 0, y: 0 };
  }
}

// Rotate a point (px,py) around centre (cx,cy) by angleDeg degrees.
function rotatePoint(px, py, cx, cy, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { x: cx + (px-cx)*cos - (py-cy)*sin,
           y: cy + (px-cx)*sin + (py-cy)*cos };
}

// ── Circular arc helpers ────────────────────────────────────────────────────
// Curves are stored as BC (x1,y1), EC (x2,y2), PI (px,py).
// PI = Point of Intersection — where the back-tangent (through BC) and
// forward-tangent (through EC) meet.  This matches standard surveying workflow.
//
// Backward-compat shim: old shapes stored (ax, ay) = arc-midpoint.
// getCurvePI converts those to an equivalent PI so legacy data is preserved.
function getCurvePI(shape) {
  if (shape.px !== undefined) return { px: shape.px, py: shape.py };
  // Legacy shape: reconstruct PI from old arc-midpoint (ax, ay)
  const ax = shape.ax !== undefined ? shape.ax
           : shape.cx !== undefined ? (shape.x1 + 2*shape.cx + shape.x2) / 4
           : (shape.x1 + shape.x2) / 2;
  const ay = shape.ay !== undefined ? shape.ay
           : shape.cy !== undefined ? (shape.y1 + 2*shape.cy + shape.y2) / 4
           : (shape.y1 + shape.y2) / 2;
  const { x1, y1, x2, y2 } = shape;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const chord = Math.hypot(x2 - x1, y2 - y1);
  const m = Math.hypot(ax - mx, ay - my);   // middle ordinate
  if (chord < 0.5 || m < 0.5) return { px: mx, py: my };
  const h = chord / 2;
  const R = (h * h + m * m) / (2 * m);
  const sinHalf = Math.min(1, h / R);
  const deltaRad = 2 * Math.asin(sinHalf);
  const T = R * Math.tan(deltaRad / 2);
  // PI is on the perpendicular bisector of BC-EC, on the same side as the arc-midpoint,
  // at distance sqrt(T²-h²) from the chord midpoint.
  const d = Math.sqrt(Math.max(0, T * T - h * h));
  const ux = (ax - mx) / (Math.hypot(ax - mx, ay - my) || 1);
  const uy = (ay - my) / (Math.hypot(ax - mx, ay - my) || 1);
  return { px: mx + ux * d, py: my + uy * d };
}

// Compute PO (center), R, and all survey curve elements from BC, PI, EC.
// PO = Point of Origin (center of radius circle), using surveying convention.
// Returns null if the three points are collinear (degenerate straight line).
function computeArcFromPI(x1, y1, x2, y2, px, py) {
  const d1 = Math.hypot(px - x1, py - y1);   // BC–PI
  const d2 = Math.hypot(px - x2, py - y2);   // EC–PI
  if (d1 < 0.5 || d2 < 0.5) return null;
  // Interior angle at PI between the two tangent directions
  const u1x = (x1 - px) / d1, u1y = (y1 - py) / d1;  // PI → BC
  const u2x = (x2 - px) / d2, u2y = (y2 - py) / d2;  // PI → EC
  const cosInt = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
  const intAngle = Math.acos(cosInt);
  // Degenerate: collinear or back-on-itself
  if (intAngle < 1e-4 || Math.PI - intAngle < 1e-4) return null;
  const deltaRad = Math.PI - intAngle;       // Δ = deflection angle
  const deltaDeg = deltaRad * 180 / Math.PI;
  const chord = Math.hypot(x2 - x1, y2 - y1);
  if (chord < 0.5) return null;
  const h = chord / 2;                       // half-chord
  const sinHalf = Math.sin(deltaRad / 2);
  if (sinHalf < 1e-6) return null;
  const R  = h / sinHalf;                    // radius
  const T  = R * Math.tan(deltaRad / 2);     // tangent length
  const L  = R * deltaRad;                   // arc length
  const M  = R * (1 - Math.cos(deltaRad / 2)); // middle ordinate
  const E  = R / Math.cos(deltaRad / 2) - R;   // external distance
  // PO lies on the angular bisector from PI (toward the arc interior)
  // at distance R / cos(Δ/2) from PI.
  const bisX = u1x + u2x, bisY = u1y + u2y;
  const bisLen = Math.hypot(bisX, bisY);
  if (bisLen < 1e-6) return null;
  const piToPO = R / Math.cos(deltaRad / 2);
  const cx = px + (bisX / bisLen) * piToPO;
  const cy = py + (bisY / bisLen) * piToPO;
  return { cx, cy, R, delta: deltaDeg, T, L, M, E, chord };
}

// Build the SVG arc path string from BC, EC, PI.
function arcPath(x1, y1, x2, y2, px, py) {
  const arc = computeArcFromPI(x1, y1, x2, y2, px, py);
  if (!arc) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const { R, delta } = arc;
  const largeArc = delta > 180 ? 1 : 0;
  // Sweep: cross-product of (PI - BC) × (EC - BC) in SVG y-down coords.
  // SVG sweep=1 = positive-angle direction = CW on screen.
  // cross > 0 → PI is LEFT of BC→EC (above chord for horizontal BC→EC).
  // PO goes to opposite side (below chord), and the arc must travel CW
  // to reach the top of the circle — i.e., toward PI.  sweep=1.
  // cross < 0 → PI RIGHT of BC→EC → PO above chord → arc goes CCW (sweep=0)
  // toward bottom, i.e., toward PI.
  const cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
  const sweep  = cross > 0 ? 1 : 0;
  return `M ${x1} ${y1} A ${R.toFixed(3)} ${R.toFixed(3)} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── PATH SHAPE UTILITIES  (Pencil / Pen / Node tools) ────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

// Convert a path shape's nodes array into an SVG path `d` string.
// Each node: { x, y, type:'sharp'|'smooth'|'cusp', cp1x, cp1y, cp2x, cp2y }
// cp1 = incoming handle (toward previous node), cp2 = outgoing handle (toward next).
function pathToSVGD(nodes, closed) {
  if (!nodes || nodes.length < 2) return '';
  const n = nodes.length;
  let d = `M ${nodes[0].x.toFixed(2)} ${nodes[0].y.toFixed(2)}`;
  for (let i = 1; i < n; i++) {
    const prev = nodes[i - 1];
    const curr = nodes[i];
    const c1x = prev.cp2x !== undefined && prev.cp2x !== null ? prev.cp2x : prev.x;
    const c1y = prev.cp2y !== undefined && prev.cp2y !== null ? prev.cp2y : prev.y;
    const c2x = curr.cp1x !== undefined && curr.cp1x !== null ? curr.cp1x : curr.x;
    const c2y = curr.cp1y !== undefined && curr.cp1y !== null ? curr.cp1y : curr.y;
    const isLine = (Math.abs(c1x - prev.x) < 0.01 && Math.abs(c1y - prev.y) < 0.01 &&
                    Math.abs(c2x - curr.x) < 0.01 && Math.abs(c2y - curr.y) < 0.01);
    if (isLine) {
      d += ` L ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
    } else {
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
    }
  }
  if (closed && n >= 2) {
    const last = nodes[n - 1];
    const first = nodes[0];
    const c1x = last.cp2x !== undefined && last.cp2x !== null ? last.cp2x : last.x;
    const c1y = last.cp2y !== undefined && last.cp2y !== null ? last.cp2y : last.y;
    const c2x = first.cp1x !== undefined && first.cp1x !== null ? first.cp1x : first.x;
    const c2y = first.cp1y !== undefined && first.cp1y !== null ? first.cp1y : first.y;
    const isLine = (Math.abs(c1x - last.x) < 0.01 && Math.abs(c1y - last.y) < 0.01 &&
                    Math.abs(c2x - first.x) < 0.01 && Math.abs(c2y - first.y) < 0.01);
    if (!isLine) {
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
    }
    d += ' Z';
  }
  return d;
}

// Ramer-Douglas-Peucker polyline simplification.
// Returns indices of points to keep from pts array.
function rdpSimplify(pts, epsilon) {
  if (pts.length <= 2) return pts.map((_, i) => i);
  function rdp(start, end, eps, result) {
    let maxDist = 0, maxIdx = start;
    const dx = pts[end].x - pts[start].x;
    const dy = pts[end].y - pts[start].y;
    const len = Math.hypot(dx, dy);
    for (let i = start + 1; i < end; i++) {
      let dist;
      if (len < 1e-10) {
        dist = Math.hypot(pts[i].x - pts[start].x, pts[i].y - pts[start].y);
      } else {
        dist = Math.abs(dy * pts[i].x - dx * pts[i].y + pts[end].x * pts[start].y - pts[end].y * pts[start].x) / len;
      }
      if (dist > maxDist) { maxDist = dist; maxIdx = i; }
    }
    if (maxDist > eps) {
      rdp(start, maxIdx, eps, result);
      result.push(maxIdx);
      rdp(maxIdx, end, eps, result);
    }
  }
  const result = [0];
  rdp(0, pts.length - 1, epsilon, result);
  result.push(pts.length - 1);
  result.sort((a, b) => a - b);
  return [...new Set(result)];
}

// Fit cubic Bezier curves through a reduced set of points using Catmull-Rom
// to Bezier conversion. Returns a nodes array suitable for a path shape.
// smoothness: 0–1 (higher = more aggressive simplification / smoother curves).
function fitCurveToPoints(pts, smoothness) {
  if (!pts || pts.length < 2) return [];
  // RDP simplification: epsilon scales with smoothness
  const eps = Math.max(0.5, smoothness * 20);
  const keepIdx = rdpSimplify(pts, eps);
  const reduced = keepIdx.map(i => pts[i]);
  // Ensure at least 2 distinct points survive simplification
  if (reduced.length < 2) return pts.length >= 2 ? [
    { x: pts[0].x, y: pts[0].y, type: 'sharp', cp1x: pts[0].x, cp1y: pts[0].y, cp2x: pts[0].x, cp2y: pts[0].y },
    { x: pts[pts.length-1].x, y: pts[pts.length-1].y, type: 'sharp', cp1x: pts[pts.length-1].x, cp1y: pts[pts.length-1].y, cp2x: pts[pts.length-1].x, cp2y: pts[pts.length-1].y },
  ] : [];

  // Catmull-Rom tension (lower = tighter, higher = looser)
  const tension = 0.5;
  const nodes = [];
  const n = reduced.length;

  for (let i = 0; i < n; i++) {
    const p0 = reduced[Math.max(0, i - 1)];
    const p1 = reduced[i];
    const p2 = reduced[Math.min(n - 1, i + 1)];
    const p3 = reduced[Math.min(n - 1, i + 2)];

    // Catmull-Rom tangent at p1 → outgoing handle (cp2)
    const cp2x = p1.x + (p2.x - p0.x) * tension / 3;
    const cp2y = p1.y + (p2.y - p0.y) * tension / 3;
    // Catmull-Rom tangent at p1 → incoming handle (cp1)
    const inCp1x = p1.x - (p2.x - p0.x) * tension / 3;
    const inCp1y = p1.y - (p2.y - p0.y) * tension / 3;

    const node = {
      x: p1.x, y: p1.y, type: 'smooth',
      cp1x: isFinite(inCp1x) ? inCp1x : p1.x,
      cp1y: isFinite(inCp1y) ? inCp1y : p1.y,
      cp2x: isFinite(cp2x)   ? cp2x   : p1.x,
      cp2y: isFinite(cp2y)   ? cp2y   : p1.y,
    };
    nodes.push(node);
  }
  // Fix first node's cp1 to equal its position (no incoming handle at start)
  nodes[0].cp1x = nodes[0].x;
  nodes[0].cp1y = nodes[0].y;
  // Fix last node's cp2 to equal its position (no outgoing handle at end)
  const last = nodes[nodes.length - 1];
  last.cp2x = last.x;
  last.cp2y = last.y;
  return nodes;
}

// Compute Catmull-Rom smooth handles for a Smart-mode Pen path.
// Mutates nodes in-place to set cp1x/cp1y/cp2x/cp2y.
function applySmartHandles(nodes) {
  const n = nodes.length;
  if (n < 2) return;
  const tension = 0.5;
  for (let i = 0; i < n; i++) {
    const p0 = nodes[Math.max(0, i - 1)];
    const p1 = nodes[i];
    const p2 = nodes[Math.min(n - 1, i + 1)];
    const cp2x = p1.x + (p2.x - p0.x) * tension / 3;
    const cp2y = p1.y + (p2.y - p0.y) * tension / 3;
    const cp1x = p1.x - (p2.x - p0.x) * tension / 3;
    const cp1y = p1.y - (p2.y - p0.y) * tension / 3;
    nodes[i].cp2x = isFinite(cp2x) ? cp2x : p1.x;
    nodes[i].cp2y = isFinite(cp2y) ? cp2y : p1.y;
    nodes[i].cp1x = isFinite(cp1x) ? cp1x : p1.x;
    nodes[i].cp1y = isFinite(cp1y) ? cp1y : p1.y;
  }
  // Clamp endpoints
  nodes[0].cp1x = nodes[0].x; nodes[0].cp1y = nodes[0].y;
  nodes[n - 1].cp2x = nodes[n - 1].x; nodes[n - 1].cp2y = nodes[n - 1].y;
}

// Find the parameter t ∈ [0,1] on a cubic Bezier closest to point pt.
// Returns { t, x, y } of the nearest point on the curve.
function nearestOnCubic(p0, p1, p2, p3, pt, steps = 20) {
  let bestT = 0, bestDist = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x;
    const y = mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y;
    const d = Math.hypot(x - pt.x, y - pt.y);
    if (d < bestDist) { bestDist = d; bestT = t; }
  }
  // Newton refinement
  for (let iter = 0; iter < 4; iter++) {
    const t = bestT, mt = 1 - t;
    const x = mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x;
    const y = mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y;
    const dx = -3*mt*mt*p0.x + 3*mt*mt*p1.x - 6*mt*t*p1.x + 6*mt*t*p2.x - 3*t*t*p2.x + 3*t*t*p3.x;
    const dy = -3*mt*mt*p0.y + 3*mt*mt*p1.y - 6*mt*t*p1.y + 6*mt*t*p2.y - 3*t*t*p2.y + 3*t*t*p3.y;
    const denom = dx*dx + dy*dy;
    if (denom < 1e-10) break;
    bestT = Math.max(0, Math.min(1, t - ((x - pt.x)*dx + (y - pt.y)*dy) / denom));
  }
  const t = bestT, mt = 1 - t;
  return {
    t: bestT,
    x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
    y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION LABEL UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

// Word-wrap text to fit inside a given character-width budget.
// Handles explicit \n paragraph breaks; long words that exceed maxChars are
// hard-broken at the limit so they never overflow the box.
function wrapText(text, maxChars) {
  if (maxChars < 1) maxChars = 1;
  const out = [];
  for (const para of text.split('\n')) {
    if (para.length === 0) { out.push(''); continue; }
    const words = para.split(' ');
    let cur = '';
    for (const word of words) {
      // Hard-break any single word longer than maxChars
      let w = word;
      while (w.length > maxChars) {
        const space = maxChars - cur.length - (cur ? 1 : 0);
        if (space > 0) {
          cur = cur ? cur + ' ' + w.slice(0, space) : w.slice(0, space);
          w   = w.slice(space);
        }
        out.push(cur);
        cur = '';
      }
      if (!w) continue;
      if (!cur) {
        cur = w;
      } else if (cur.length + 1 + w.length <= maxChars) {
        cur += ' ' + w;
      } else {
        out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [''];
}

// Format a world-unit distance for display.
// Shows enough precision to be useful without being noisy.
function fmtDim(v) {
  if (v >= 1000) return Math.round(v).toLocaleString();
  if (v >=   10) return v.toFixed(1);
  return v.toFixed(2);
}

// Render a dimension text label at (lx, ly) rotated by `angle` degrees.
// A white rectangle sized to the text bounding box is drawn first so that
// no drawing lines can cross through the label text.
// NOT a React component (lowercase) — call as a factory that returns a React element.
function dimTextEl(lx, ly, angle, text, ps) {
  const a   = angle || 0;
  const fs  = 9.5 * ps;
  // Courier New is monospace: char width ≈ 0.6 em, line height ≈ 1.4 em.
  const rw  = (text ? text.length : 1) * fs * 0.6 + 4 * ps;
  const rh  = fs * 1.4;
  const content = <>
    <rect x={lx - rw/2} y={ly - rh/2} width={rw} height={rh}
          fill="rgba(255,255,255,0.97)" />
    <text x={lx} y={ly}
          fontSize={fs}
          fontFamily="Courier New, monospace"
          textAnchor="middle"
          dominantBaseline="middle"
          fill={STROKE}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
    >{text}</text>
  </>;
  return a
    ? <g transform={`rotate(${a},${lx},${ly})`} style={{ pointerEvents:'none', userSelect:'none' }}>{content}</g>
    : <g style={{ pointerEvents:'none', userSelect:'none' }}>{content}</g>;
}

// Format decimal degrees as D°MM'SS"
function toDMS(deg) {
  const sign = deg < 0 ? '-' : '';
  const abs  = Math.abs(deg);
  const d    = Math.floor(abs);
  const mf   = (abs - d) * 60;
  const m    = Math.floor(mf);
  const s    = Math.round((mf - m) * 60);
  return `${sign}${d}°${String(m).padStart(2,'0')}'${String(s).padStart(2,'0')}"`;
}

// Normalise a text rotation angle so the label always reads upright (never
// upside-down). Steps:
//   1. Wrap to [0°, 360°)  — handles negative angles and large values
//   2. Flip the upside-down band (90°, 270°] by subtracting 180°  → (-90°, 90°]
//   3. Re-center to (-180°, 180°] to keep SVG happy
// Result is always in (-90°, 90°] — readable at any zoom, scale, or rotation.
function normAng(a) {
  a = ((a % 360) + 360) % 360;       // → [0, 360)
  if (a > 90 && a <= 270) a -= 180;  // → (-90, 90]  (flip upside-down range)
  if (a > 180) a -= 360;             // → (-90, 90]  (handle 270–360 band)
  return a;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE GEOMETRY MUTATIONS  —  used by the Shape Value Card editable fields
// ─────────────────────────────────────────────────────────────────────────────

// Resize a line to newLen, scaling symmetrically from its midpoint.
function applyLineLength(s, newLen) {
  const cx = (s.x1+s.x2)/2, cy = (s.y1+s.y2)/2;
  const len = Math.hypot(s.x2-s.x1, s.y2-s.y1) || 1;
  const ux = (s.x2-s.x1)/len, uy = (s.y2-s.y1)/len;
  const half = Math.max(0.5, newLen) / 2;
  return { ...s, x1: cx-ux*half, y1: cy-uy*half, x2: cx+ux*half, y2: cy+uy*half };
}

// Rotate a line to bearingDeg (clockwise from screen-North), preserving midpoint & length.
// In SVG coords: North = y decreasing; dx = sin(brg), dy = -cos(brg).
function applyLineBearing(s, bearingDeg) {
  const cx = (s.x1+s.x2)/2, cy = (s.y1+s.y2)/2;
  const len = Math.hypot(s.x2-s.x1, s.y2-s.y1);
  const rad = bearingDeg * Math.PI / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const half = len / 2;
  return { ...s, x1: cx-dx*half, y1: cy-dy*half, x2: cx+dx*half, y2: cy+dy*half };
}

// Change arc radius while keeping BC and EC fixed, working in the PI model.
// Preserves which side of the chord the current PI is on.
function applyArcRadius(s, newR) {
  const { x1, y1, x2, y2 } = s;
  const chord = Math.hypot(x2 - x1, y2 - y1);
  const h = chord / 2;
  const r = Math.max(newR, h + 0.1);              // R must be >= half-chord
  const { px: cpx, py: cpy } = getCurvePI(s);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  // Which side of chord BC→EC is the current PI on?
  const cross = (cpx - x1) * (y2 - y1) - (cpy - y1) * (x2 - x1);
  const side  = cross >= 0 ? 1 : -1;
  // New PI distance from chord midpoint along perpendicular bisector:
  // sin(Δ/2) = h/R → T = R*tan(Δ/2) → PI_dist = sqrt(T²-h²)
  const sinHalf = Math.min(1, h / r);
  const deltaRad = 2 * Math.asin(sinHalf);
  const T = r * Math.tan(deltaRad / 2);
  const d = Math.sqrt(Math.max(0, T * T - h * h));
  // Left-hand perpendicular unit vector of chord BC→EC
  const perpX = -(y2 - y1) / chord;
  const perpY =  (x2 - x1) / chord;
  return { ...s, px: mx + side * perpX * d, py: my + side * perpY * d };
}

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION TOOL HELPERS  (Phase 7)
// ─────────────────────────────────────────────────────────────────────────────

// Find the intersection of two infinite lines: (x1,y1)→(x2,y2) and (x3,y3)→(x4,y4).
// Returns { x, y } or null if the lines are parallel (determinant < 1e-10).
function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const dx1 = x2-x1, dy1 = y2-y1;
  const dx2 = x4-x3, dy2 = y4-y3;
  const denom = dx1*dy2 - dy1*dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((x3-x1)*dy2 - (y3-y1)*dx2) / denom;
  return { x: x1 + t*dx1, y: y1 + t*dy1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCALE & UNIT HELPERS  (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────
// Anchor: 1000 canvas pixels = 1 metre at scale 1:1.
// At scale 1:S → 1 canvas pixel = S/1000 metres.
const PIXELS_PER_METER = 1000;

const COMMON_SCALES = [1, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const MAX_SCALE     = COMMON_SCALES[COMMON_SCALES.length - 1];

function pxToReal(px, scaleDenom, units) {
  const m = px * scaleDenom / PIXELS_PER_METER;
  return units === 'ft' ? m * 3.28084 : m;
}

function realToPx(val, scaleDenom, units) {
  const m = units === 'ft' ? val / 3.28084 : val;
  return m * PIXELS_PER_METER / scaleDenom;
}

// Format a real-world value (already converted from px) for display.
// Metres: nearest millimetre (X.XXX m). Feet: nearest 0.01 ft (X.XX').
function formatReal(val, units) {
  if (units === 'ft') {
    // Nearest hundredth of a foot for all distances
    return val.toFixed(2) + "'";
  }
  // Metres — always 3 decimal places (nearest mm)
  if (val >= 1000) return val.toFixed(3) + ' m';   // e.g. 1234.567 m
  return val.toFixed(3) + ' m';
}

// Convert px distance to real-world value then format. Drop-in replacement
// for the old fmtDim() at all call-sites inside SketchPage's render path.
function fmtPxAsReal(px, scaleDenom, units) {
  return formatReal(pxToReal(px, scaleDenom, units), units);
}

// Choose a round-number distance that will produce a scale-bar ≈ 60–150 screen px wide.
function niceScaleBarValue(scaleDenom, vbW, containerW, units) {
  const targetScreenPx = 100;
  const targetWorldPx  = targetScreenPx * (vbW / (containerW || vbW));
  const targetReal     = pxToReal(targetWorldPx, scaleDenom, units);
  const niceValues     = [
    0.001, 0.002, 0.005,
    0.01, 0.02, 0.05,
    0.1, 0.2, 0.5,
    1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
  ];
  return niceValues.filter(v => v <= targetReal).pop() || niceValues[0];
}

// Map a 0-100 slider value to a scale denominator using a log scale, snapping
// to COMMON_SCALES when within 3% of one.
function sliderToScale(t) {
  const raw = Math.round(Math.pow(MAX_SCALE, t / 100));
  const clamped = Math.max(1, raw);
  for (const cs of COMMON_SCALES) {
    if (Math.abs(clamped - cs) / cs < 0.03) return cs;
  }
  return clamped;
}

function scaleToSlider(s) {
  if (s <= 1) return 0;
  return Math.round(Math.log(s) / Math.log(MAX_SCALE) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// GRID HELPERS  (Phase 4)
// ─────────────────────────────────────────────────────────────────────────────

// Choose a round-number real-world interval that targets ~10 minor grid lines
// visible across the current view width.
function niceGridInterval(scaleDenom, vbW, containerW, units) {
  const worldWidthReal = pxToReal(vbW, scaleDenom, units);
  const rawInterval    = worldWidthReal / 10;
  const niceValues = [
    0.001, 0.002, 0.005,
    0.01,  0.02,  0.05,
    0.1,   0.2,   0.5,
    1,     2,     5,     10,   25,   50,
    100,   250,   500,   1000, 2500, 5000,
  ];
  return niceValues.find(v => v >= rawInterval) || 5000;
}
// Major gridlines fall every 5th minor interval.

// ─────────────────────────────────────────────────────────────────────────────
// BEARING DMS HELPERS  —  used by ShapeValueCard bearing field
// ─────────────────────────────────────────────────────────────────────────────

// Convert azimuth (0–360 decimal degrees, clockwise from North) to a quadrant
// bearing string like "N57°16'26"E".
function aziToQBearing(az) {
  az = ((az % 360) + 360) % 360;
  let q1, q2, angle;
  if (az < 90)       { q1 = 'N'; q2 = 'E'; angle = az; }
  else if (az < 180) { q1 = 'S'; q2 = 'E'; angle = 180 - az; }
  else if (az < 270) { q1 = 'S'; q2 = 'W'; angle = az - 180; }
  else               { q1 = 'N'; q2 = 'W'; angle = 360 - az; }
  const d = Math.floor(angle);
  const mRaw = (angle - d) * 60;
  let m = Math.floor(mRaw);
  let s = Math.round((mRaw - m) * 60);
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; /* d would become 90, still valid */ }
  return `${q1}${d}°${String(m).padStart(2,'0')}'${String(s).padStart(2,'0')}"${q2}`;
}

// Parse a bearing string in many formats → azimuth decimal degrees (0–360).
// Accepts: N57°16'26"E, N 57 16 26 E, N57°16'E, N57E, 57°16'26", 57 16 26, 57.274
// Returns NaN if the string cannot be parsed.
function parseQBearing(str) {
  str = str.trim().toUpperCase();

  // Helper: parse a D, DM, DMS, or DD middle string → decimal degrees.
  function parseMid(s) {
    s = s.trim();
    // DMS: 57°16'26" or 57 16 26 or 57-16-26
    const m3 = s.match(/^(\d+(?:\.\d+)?)[°\s\-]+(\d+(?:\.\d+)?)['\s\-]+(\d+(?:\.\d+)?)["\s]*$/);
    if (m3) return +m3[1] + +m3[2] / 60 + +m3[3] / 3600;
    // DM: 57°16' or 57 16
    const m2 = s.match(/^(\d+(?:\.\d+)?)[°\s\-]+(\d+(?:\.\d+)?)['\s]*$/);
    if (m2) return +m2[1] + +m2[2] / 60;
    // D or DD
    const dd = parseFloat(s);
    return isNaN(dd) ? NaN : dd;
  }

  // Quadrant format: leading N/S and trailing E/W
  const q1m = str.match(/^([NS])\s*/);
  const q2m = str.match(/\s*([EW])$/);
  if (q1m && q2m) {
    const q1 = q1m[1], q2 = q2m[1];
    const mid = str.slice(q1m[0].length, str.length - q2m[0].length);
    const angle = parseMid(mid);
    if (isNaN(angle)) return NaN;
    let az;
    if      (q1 === 'N' && q2 === 'E') az = angle;
    else if (q1 === 'S' && q2 === 'E') az = 180 - angle;
    else if (q1 === 'S' && q2 === 'W') az = 180 + angle;
    else                               az = 360 - angle; // N...W
    return ((az % 360) + 360) % 360;
  }

  // No quadrant — treat as plain azimuth DMS or decimal degrees
  const az = parseMid(str);
  return isNaN(az) ? NaN : ((az % 360) + 360) % 360;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE VALUE CARD  —  proper React component with controlled inputs
// Extracted from the IIFE so it can hold useState/useEffect.
// Props:
//   shape    — the currently selected shape object (never null when rendered)
//   onUpdate — fn(transformFn) called with a shape→shape transform to apply
// ─────────────────────────────────────────────────────────────────────────────
function ShapeValueCard({ shape: s, onUpdate, scaleDenom, units, northAzimuth: northAz }) {
  // ── Shared styles ───────────────────────────────────────────────────────
  const iStyle = {
    width: 82, background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.2)', borderRadius: 3,
    color: 'rgba(255,255,255,0.9)', fontFamily: 'Courier New, monospace',
    fontSize: 10, padding: '2px 5px', outline: 'none',
  };
  const lStyle = { color: '#64748B', width: 46, flexShrink: 0, fontSize: 10 };
  const rStyle = { display: 'flex', gap: 5, alignItems: 'center', lineHeight: 1.6 };
  const unitSuffix = units === 'ft' ? "'" : ' m';
  const unit   = v => <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>{v}</span>;

  // ── Compute initial values from the shape ───────────────────────────────
  function initVals(sh) {
    const lenPx = sh.type === 'line' ? Math.hypot(sh.x2-sh.x1, sh.y2-sh.y1) : 0;
    const brg = sh.type === 'line'
      ? ((Math.atan2(sh.x2-sh.x1, -(sh.y2-sh.y1)) * 180/Math.PI) + 360) % 360 : 0;
    const cp = sh.type === 'curve'
      ? (() => { const {px,py} = getCurvePI(sh);
                 return computeArcFromPI(sh.x1,sh.y1,sh.x2,sh.y2,px,py); })()
      : null;
    const _dbPx = (sh.type==='dim-bearing'&&sh.p1&&sh.p2) ? Math.hypot(sh.p2.x-sh.p1.x,sh.p2.y-sh.p1.y) : 0;
    const _dbAz = (sh.type==='dim-bearing'&&sh.p1&&sh.p2) ? ((Math.atan2(sh.p2.x-sh.p1.x,-(sh.p2.y-sh.p1.y))*180/Math.PI)+360)%360 : 0;
    return {
      len:    pxToReal(lenPx, scaleDenom, units).toFixed(3),
      brg:    aziToQBearing(brg),
      r:      sh.type === 'circle' ? pxToReal(sh.r, scaleDenom, units).toFixed(3) : '0',
      w:      sh.type === 'rect'   ? pxToReal(Math.abs(sh.w), scaleDenom, units).toFixed(3) : '0',
      h:      sh.type === 'rect'   ? pxToReal(Math.abs(sh.h), scaleDenom, units).toFixed(3) : '0',
      crvR:   cp ? pxToReal(cp.R, scaleDenom, units).toFixed(3) : '0',
      nts:    sh.ntsLabel || '',
      dimBrg: sh.type==='dim-bearing' ? aziToQBearing((_dbAz-(northAz||0)+360)%360) : '',
      dimLen: sh.type==='dim-bearing' ? pxToReal(_dbPx, scaleDenom, units).toFixed(3) : '',
    };
  }

  const [vals, setVals] = useState(() => initVals(s));

  // Re-initialise when shape changes, or when scale/units change so displayed
  // values refresh immediately without needing to re-select the shape.
  useEffect(() => { setVals(initVals(s)); },
    [s.id, s.x1, s.y1, s.x2, s.y2, s.r, s.w, s.h, s.px, s.py, s.ntsLabel, scaleDenom, units,
     s.p1?.x, s.p1?.y, s.p2?.x, s.p2?.y]);

  // ── Commit helper ───────────────────────────────────────────────────────
  function tryCommit(key, raw, parse, guard, transform, fallbackFn) {
    const n = parse(raw);
    if (guard(n)) {
      onUpdate(sh => transform(sh, n));
    } else {
      setVals(prev => ({ ...prev, [key]: fallbackFn() }));
    }
  }

  // ── Curve props (only for curve type) ───────────────────────────────────
  let cp = null;
  if (s.type === 'curve') {
    const { px, py } = getCurvePI(s);
    cp = computeArcFromPI(s.x1, s.y1, s.x2, s.y2, px, py);
  }

  // ── Build rows ───────────────────────────────────────────────────────────
  let title = 'Shape';
  let rows  = [];

  if (s.type === 'line') {
    const lenPxFallback = () => pxToReal(Math.hypot(s.x2-s.x1, s.y2-s.y1), scaleDenom, units).toFixed(3);
    const brgFallback   = () => aziToQBearing((((Math.atan2(s.x2-s.x1,-(s.y2-s.y1))*180/Math.PI)+360)%360));
    title = 'Line';
    rows = [
      <div key="len" style={rStyle}>
        <span style={lStyle}>Length</span>
        <input
          value={vals.len}
          onChange={e => setVals(v => ({ ...v, len: e.target.value }))}
          onBlur={e  => tryCommit('len', e.target.value, parseFloat,
                         n => !isNaN(n) && n > 0,
                         (sh, n) => applyLineLength(sh, realToPx(n, scaleDenom, units)),
                         lenPxFallback)}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, len: lenPxFallback()})); e.target.blur(); } }}
          style={iStyle}
        />{unit(unitSuffix)}
      </div>,
      <div key="brg" style={rStyle}>
        <span style={lStyle}>Bearing</span>
        <input
          value={vals.brg}
          onChange={e => setVals(v => ({ ...v, brg: e.target.value }))}
          onBlur={e  => tryCommit('brg', e.target.value, parseQBearing,
                         n => !isNaN(n),
                         (sh, n) => applyLineBearing(sh, n),
                         brgFallback)}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, brg: brgFallback()})); e.target.blur(); } }}
          style={{ ...iStyle, width: 110 }}
        />
      </div>,
    ];

  } else if (s.type === 'circle') {
    const rFallback = () => pxToReal(s.r, scaleDenom, units).toFixed(3);
    title = 'Circle';
    rows = [
      <div key="r" style={rStyle}>
        <span style={lStyle}>Radius</span>
        <input
          value={vals.r}
          onChange={e => setVals(v => ({ ...v, r: e.target.value }))}
          onBlur={e  => tryCommit('r', e.target.value, parseFloat,
                         n => !isNaN(n) && n > 0,
                         (sh, n) => ({ ...sh, r: realToPx(n, scaleDenom, units) }),
                         rFallback)}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, r: rFallback()})); e.target.blur(); } }}
          style={iStyle}
        />{unit(unitSuffix)}
      </div>,
    ];

  } else if (s.type === 'rect') {
    const wFallback = () => pxToReal(Math.abs(s.w), scaleDenom, units).toFixed(3);
    const hFallback = () => pxToReal(Math.abs(s.h), scaleDenom, units).toFixed(3);
    title = 'Rectangle';
    rows = [
      <div key="w" style={rStyle}>
        <span style={lStyle}>Width</span>
        <input
          value={vals.w}
          onChange={e => setVals(v => ({ ...v, w: e.target.value }))}
          onBlur={e  => tryCommit('w', e.target.value, parseFloat,
                         n => !isNaN(n) && n > 0,
                         (sh, n) => ({ ...sh, w: realToPx(n, scaleDenom, units) }),
                         wFallback)}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, w: wFallback()})); e.target.blur(); } }}
          style={iStyle}
        />{unit(unitSuffix)}
      </div>,
      <div key="h" style={rStyle}>
        <span style={lStyle}>Height</span>
        <input
          value={vals.h}
          onChange={e => setVals(v => ({ ...v, h: e.target.value }))}
          onBlur={e  => tryCommit('h', e.target.value, parseFloat,
                         n => !isNaN(n) && n > 0,
                         (sh, n) => ({ ...sh, h: realToPx(n, scaleDenom, units) }),
                         hFallback)}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, h: hFallback()})); e.target.blur(); } }}
          style={iStyle}
        />{unit(unitSuffix)}
      </div>,
      <div key="rot" style={rStyle}>
        <span style={lStyle}>Rot°</span>
        <span style={{ fontSize: 10 }}>{(s._rot||0).toFixed(1)}°</span>
      </div>,
    ];

  } else if (s.type === 'curve' && cp) {
    const crvRFallback = () => pxToReal(cp.R, scaleDenom, units).toFixed(3);
    title = 'Curve Elements';
    rows = [
      <div key="R" style={rStyle}>
        <span style={lStyle}>R</span>
        <input
          value={vals.crvR}
          onChange={e => setVals(v => ({ ...v, crvR: e.target.value }))}
          onBlur={e  => tryCommit('crvR', e.target.value, parseFloat,
                         n => !isNaN(n) && n > 0,
                         (sh, n) => applyArcRadius(sh, realToPx(n, scaleDenom, units)),
                         crvRFallback)}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, crvR: crvRFallback()})); e.target.blur(); } }}
          style={iStyle}
        />{unit(unitSuffix)}
      </div>,
      ...[
        ['Δ',     toDMS(cp.delta)],
        ['T',     formatReal(pxToReal(cp.T,     scaleDenom, units), units)],
        ['L',     formatReal(pxToReal(cp.L,     scaleDenom, units), units)],
        ['M',     formatReal(pxToReal(cp.M,     scaleDenom, units), units)],
        ['E',     formatReal(pxToReal(cp.E,     scaleDenom, units), units)],
        ['Chord', formatReal(pxToReal(cp.chord, scaleDenom, units), units)],
      ].map(([lbl, val]) => (
        <div key={lbl} style={rStyle}>
          <span style={lStyle}>{lbl}</span>
          <span style={{ fontSize: 10 }}>{val}</span>
        </div>
      )),
    ];

  } else if (s.type === 'dim-bearing' && s.p1 && s.p2) {
    title = 'Bearing';
    const _dbLenFb = () => pxToReal(Math.hypot(s.p2.x-s.p1.x,s.p2.y-s.p1.y),scaleDenom,units).toFixed(3);
    const _dbBrgFb = () => { const az=((Math.atan2(s.p2.x-s.p1.x,-(s.p2.y-s.p1.y))*180/Math.PI)+360)%360; return aziToQBearing((az-(northAz||0)+360)%360); };
    rows = [
      <div key="dimBrg" style={rStyle}>
        <span style={lStyle}>Bearing</span>
        <input value={vals.dimBrg}
          onChange={e => setVals(v=>({...v,dimBrg:e.target.value}))}
          onBlur={e => {
            const p = parseQBearing(e.target.value);
            if (!isNaN(p)) {
              const rawAz = (p+(northAz||0)+360)%360;
              const rad = rawAz*Math.PI/180;
              onUpdate(sh => {
                const dist = Math.hypot(sh.p2.x-sh.p1.x,sh.p2.y-sh.p1.y)||10;
                return {...sh, p2:{x:sh.p1.x+Math.sin(rad)*dist, y:sh.p1.y-Math.cos(rad)*dist}};
              });
            } else { setVals(v=>({...v,dimBrg:_dbBrgFb()})); }
          }}
          onKeyDown={e=>{if(e.key==='Enter')e.target.blur();if(e.key==='Escape'){setVals(v=>({...v,dimBrg:_dbBrgFb()}));e.target.blur();}}}
          style={iStyle} />
      </div>,
      <div key="dimLen" style={rStyle}>
        <span style={lStyle}>Length</span>
        <input value={vals.dimLen}
          onChange={e=>setVals(v=>({...v,dimLen:e.target.value}))}
          onBlur={e=>{
            const n=parseFloat(e.target.value);
            if(!isNaN(n)&&n>0){
              onUpdate(sh=>{
                const d=Math.hypot(sh.p2.x-sh.p1.x,sh.p2.y-sh.p1.y)||1;
                const ux=(sh.p2.x-sh.p1.x)/d, uy=(sh.p2.y-sh.p1.y)/d;
                const nd=realToPx(n,scaleDenom,units);
                return {...sh, p2:{x:sh.p1.x+ux*nd, y:sh.p1.y+uy*nd}};
              });
            } else { setVals(v=>({...v,dimLen:_dbLenFb()})); }
          }}
          onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}}
          style={iStyle}/>{unit(unitSuffix)}
      </div>,
      <div key="arrowOnly" style={rStyle}>
        <span style={lStyle}>Mode</span>
        <button onClick={()=>onUpdate(sh=>({...sh,arrowOnly:!sh.arrowOnly}))} style={{
          height:20,padding:'0 8px',borderRadius:3,cursor:'pointer',outline:'none',
          fontFamily:'Courier New,monospace',fontSize:9,letterSpacing:'0.03em',
          background:s.arrowOnly?'rgba(251,191,36,0.15)':'rgba(99,179,237,0.18)',
          border:`1px solid ${s.arrowOnly?'rgba(251,191,36,0.45)':'rgba(99,179,237,0.55)'}`,
          color:s.arrowOnly?'#FCD34D':'#90CDF4',
        }}>{s.arrowOnly?'→ arrow only':'→ N57°E label'}</button>
      </div>,
    ];
  } else {
    return null;
  }

  // ── NTS label field + per-shape dims toggle (all committed shapes) ─────
  rows = rows.concat([
    <div key="_sep" style={{ borderTop: '1px solid rgba(255,255,255,0.09)', margin: '4px 0 2px' }} />,
    <div key="_dimtoggle" style={rStyle}>
      <span style={lStyle}>Dims</span>
      <button
        onClick={() => onUpdate(sh => ({ ...sh, _hideDims: sh._hideDims ? undefined : true }))}
        style={{
          height: 20, padding: '0 9px', borderRadius: 3, cursor: 'pointer',
          fontFamily: 'Courier New, monospace', fontSize: 9, outline: 'none',
          background: s._hideDims ? 'rgba(255,255,255,0.06)' : 'rgba(99,179,237,0.18)',
          border: `1px solid ${s._hideDims ? 'rgba(255,255,255,0.18)' : 'rgba(99,179,237,0.55)'}`,
          color:  s._hideDims ? 'rgba(255,255,255,0.35)' : '#90CDF4',
          letterSpacing: '0.04em',
        }}
      >{s._hideDims ? 'hidden' : 'shown'}</button>
    </div>,
    <div key="_nts" style={rStyle}>
      <span style={{ ...lStyle, color: vals.nts ? '#FCD34D' : '#64748B' }}>Label</span>
      <input
        value={vals.nts}
        placeholder="NTS override…"
        onChange={e => setVals(v => ({ ...v, nts: e.target.value }))}
        onBlur={e  => { const v = e.target.value.trim();
                        onUpdate(sh => ({ ...sh, ntsLabel: v || undefined })); }}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
        style={{
          ...iStyle, width: 90,
          background: vals.nts ? 'rgba(251,191,36,0.10)' : iStyle.background,
          border:     `1px solid ${vals.nts ? 'rgba(251,191,36,0.45)' : 'rgba(255,255,255,0.2)'}`,
          color:      vals.nts ? '#FCD34D' : iStyle.color,
          fontStyle:  vals.nts ? 'italic' : 'normal',
        }}
      />
    </div>,
  ]);

  return (
    <div style={{
      position: 'absolute', bottom: 10, left: 10, pointerEvents: 'all',
      background: 'rgba(10,15,35,0.90)', border: '1px solid rgba(59,130,246,0.35)',
      borderRadius: 6, padding: '7px 11px',
      fontFamily: 'Courier New, monospace', fontSize: 10.5,
      color: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(5px)', zIndex: 15,
      lineHeight: 1.7, minWidth: 180, maxWidth: 230,
    }}>
      <div style={{ color: '#60A5FA', fontSize: 9.5, letterSpacing: '0.1em',
        marginBottom: 4, textTransform: 'uppercase' }}>{title}</div>
      {rows}
    </div>
  );
}

// Offset every geometric coordinate of a shape by (dx, dy).
// Used when pasting shapes so they don't land exactly on the originals.
function offsetShape(s, dx, dy) {
  switch (s.type) {
    case 'line':   return { ...s, x1:s.x1+dx, y1:s.y1+dy, x2:s.x2+dx, y2:s.y2+dy };
    case 'curve': {
      const px = (s.px !== undefined ? s.px : (s.x1+s.x2)/2) + dx;
      const py = (s.py !== undefined ? s.py : (s.y1+s.y2)/2) + dy;
      return { ...s, x1:s.x1+dx, y1:s.y1+dy, x2:s.x2+dx, y2:s.y2+dy, px, py };
    }
    case 'circle': return { ...s, cx:s.cx+dx, cy:s.cy+dy };
    case 'rect':   return { ...s, x:s.x+dx, y:s.y+dy };
    case 'text':   return { ...s, x:s.x+dx, y:s.y+dy };
    case 'path':
      return { ...s, nodes: (s.nodes||[]).map(n => ({
        ...n, x:n.x+dx, y:n.y+dy,
        cp1x:(n.cp1x??n.x)+dx, cp1y:(n.cp1y??n.y)+dy,
        cp2x:(n.cp2x??n.x)+dx, cp2y:(n.cp2y??n.y)+dy,
      }))};
    case 'dim-linear':
      return { ...s, p1: { x:s.p1.x+dx, y:s.p1.y+dy }, p2: { x:s.p2.x+dx, y:s.p2.y+dy } };
    case 'dim-bearing':
      if (s.p1 && s.p2) return { ...s, p1: { x:s.p1.x+dx, y:s.p1.y+dy }, p2: { x:s.p2.x+dx, y:s.p2.y+dy } };
      return s;
    case 'dim-radius':
      return { ...s, offset: { x:(s.offset?.x||0)+dx, y:(s.offset?.y||0)+dy } };
    // dim-angle references line IDs — shifting it independently doesn't make geometric sense;
    // just return unchanged so pasting doesn't crash.
    default: return s;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function hexToHsv(hex) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return { h: 0, s: 1, v: 1 };
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d > 0) {
    if      (max === r) hue = ((g - b) / d + 6) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else                hue = (r - g) / d + 4;
    hue *= 60;
  }
  return { h: hue, s: max > 0 ? d / max : 0, v: max };
}

function hsvToHex(h, s, v) {
  const f = n => {
    const k = (n + h / 60) % 6;
    const val = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(val * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(5) + f(3) + f(1);
}

function hsvToRgb255(h, s, v) {
  const f = n => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return { r: f(5), g: f(3), b: f(1) };
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR WHEEL COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function ColorWheel({ color, onChange, onCommit }) {
  const SIZE    = 154;
  const RING_W  = 18;
  const CENTER  = SIZE / 2;
  const OUTER_R = CENTER - 2;
  const INNER_R = OUTER_R - RING_W;

  const canvasRef = useRef(null);
  const dragging  = useRef(null);

  const parseColor = c => {
    if (!c || c === 'none') return { h: 0, s: 1, v: 1 };
    try { return hexToHsv(c); } catch { return { h: 0, s: 1, v: 1 }; }
  };

  const [hsv, setHsv] = useState(() => parseColor(color));
  useEffect(() => { setHsv(parseColor(color)); }, [color]);

  // Triangle vertices in canvas-space.
  // A = pure hue (S=1, V=1), B = black (V=0), C = white (S=0, V=1)
  // All three vertices sit exactly on INNER_R, so they touch the ring.
  function triVerts(h) {
    const base = (h - 90) * Math.PI / 180;
    const T = 2 * Math.PI / 3;
    return {
      Ax: CENTER + INNER_R * Math.cos(base),
      Ay: CENTER + INNER_R * Math.sin(base),
      Bx: CENTER + INNER_R * Math.cos(base + T),
      By: CENTER + INNER_R * Math.sin(base + T),
      Cx: CENTER + INNER_R * Math.cos(base - T),
      Cy: CENTER + INNER_R * Math.sin(base - T),
    };
  }

  // Barycentric coords of canvas point (px, py) relative to triangle A/B/C
  function bary({ Ax, Ay, Bx, By, Cx, Cy }, px, py) {
    const d = (By - Cy) * (Ax - Cx) + (Cx - Bx) * (Ay - Cy);
    if (Math.abs(d) < 1e-10) return { lA: 1/3, lB: 1/3, lC: 1/3 };
    const lA = ((By - Cy) * (px - Cx) + (Cx - Bx) * (py - Cy)) / d;
    const lB = ((Cy - Ay) * (px - Cx) + (Ax - Cx) * (py - Cy)) / d;
    return { lA, lB, lC: 1 - lA - lB };
  }

  // S/V from barycentric: λA=hue vertex, λB=black vertex, λC=white vertex
  function baryToSV(lA, lB, lC) {
    const V = Math.max(0, Math.min(1, lA + lC));
    const S = V > 0.001 ? Math.max(0, Math.min(1, lA / V)) : 0;
    return { S, V };
  }

  // Canvas position from S/V
  function svToXY(s, v, verts) {
    const { Ax, Ay, Bx, By, Cx, Cy } = verts;
    const lA = s * v, lC = (1 - s) * v, lB = 1 - v;
    return { x: lA * Ax + lB * Bx + lC * Cx, y: lA * Ay + lB * By + lC * Cy };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);

    // ── Hue ring ──
    for (let i = 0; i < 360; i++) {
      const a0 = (i - 90.5) * Math.PI / 180;
      const a1 = (i - 89.5) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(CENTER, CENTER);
      ctx.arc(CENTER, CENTER, OUTER_R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = `hsl(${i},100%,50%)`;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, INNER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // ── HSV triangle ──
    const verts = triVerts(hsv.h);
    const { Ax, Ay, Bx, By, Cx, Cy } = verts;
    const { r, g, b } = hsvToRgb255(hsv.h, 1, 1);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(Ax, Ay); ctx.lineTo(Bx, By); ctx.lineTo(Cx, Cy);
    ctx.closePath();
    ctx.clip();

    const minX = Math.min(Ax, Bx, Cx) - 1, minY = Math.min(Ay, By, Cy) - 1;
    const bw   = Math.max(Ax, Bx, Cx) - minX + 2;
    const bh   = Math.max(Ay, By, Cy) - minY + 2;

    // Pure hue base
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(minX, minY, bw, bh);

    // White overlay: from white vertex C toward midpoint of AB
    const wg = ctx.createLinearGradient(Cx, Cy, (Ax + Bx) / 2, (Ay + By) / 2);
    wg.addColorStop(0, 'rgba(255,255,255,1)');
    wg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wg;
    ctx.fillRect(minX, minY, bw, bh);

    // Black overlay: from black vertex B toward midpoint of AC
    const bg = ctx.createLinearGradient(Bx, By, (Ax + Cx) / 2, (Ay + Cy) / 2);
    bg.addColorStop(0, 'rgba(0,0,0,1)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(minX, minY, bw, bh);

    ctx.restore();

    // ── Hue ring indicator ──
    const hAngle = (hsv.h - 90) * Math.PI / 180;
    const ir = INNER_R + RING_W / 2;
    const ix = CENTER + ir * Math.cos(hAngle), iy = CENTER + ir * Math.sin(hAngle);
    ctx.beginPath(); ctx.arc(ix, iy, 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();

    // ── SV triangle indicator ──
    const { x: svX, y: svY } = svToXY(hsv.s, hsv.v, verts);
    ctx.beginPath(); ctx.arc(svX, svY, 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  }, [hsv.h, hsv.s, hsv.v]);

  function getXY(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (SIZE / rect.width),
      y: (e.clientY - rect.top)  * (SIZE / rect.height),
    };
  }

  function hitZone(x, y) {
    const dx = x - CENTER, dy = y - CENTER;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= INNER_R && d <= OUTER_R) return 'ring';
    const { lA, lB, lC } = bary(triVerts(hsv.h), x, y);
    if (lA >= -0.02 && lB >= -0.02 && lC >= -0.02) return 'sv';
    return 'none';
  }

  // lastHex: tracks current hex during drag so onCommit can fire it on pointerUp
  const lastHexRef = useRef(null);

  function applyXYFull(zone, x, y) {
    if (zone === 'ring') {
      const h = ((Math.atan2(y - CENTER, x - CENTER) * 180 / Math.PI) + 90 + 360) % 360;
      const next = { ...hsv, h };
      setHsv(next);
      const hex = hsvToHex(next.h, next.s, next.v);
      lastHexRef.current = hex;
      onChange(hex);
    } else if (zone === 'sv') {
      let { lA, lB, lC } = bary(triVerts(hsv.h), x, y);
      lA = Math.max(0, lA); lB = Math.max(0, lB); lC = Math.max(0, lC);
      const sum = lA + lB + lC || 1;
      const { S, V } = baryToSV(lA / sum, lB / sum, lC / sum);
      const next = { ...hsv, s: S, v: V };
      setHsv(next);
      const hex = hsvToHex(next.h, next.s, next.v);
      lastHexRef.current = hex;
      onChange(hex);
    }
  }

  return (
    <canvas ref={canvasRef} width={SIZE} height={SIZE}
      style={{ width: '100%', maxWidth: SIZE, display: 'block', margin: '0 auto',
        cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={e => {
        const { x, y } = getXY(e);
        const zone = hitZone(x, y);
        if (zone === 'none') return;
        dragging.current = zone;
        lastHexRef.current = null;
        canvasRef.current.setPointerCapture(e.pointerId);
        applyXYFull(zone, x, y);
      }}
      onPointerMove={e => {
        if (!dragging.current) return;
        const { x, y } = getXY(e);
        applyXYFull(dragging.current, x, y);
      }}
      onPointerUp={() => {
        if (dragging.current && lastHexRef.current && onCommit) {
          onCommit(lastHexRef.current);
        }
        dragging.current = null;
        lastHexRef.current = null;
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR PANEL COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function ColorPanel({ colorTarget, onTargetChange, activeColor, recentColors, onColorChange, onColorCommit }) {
  const [hexInput, setHexInput] = useState(activeColor === 'none' ? '' : (activeColor || ''));

  useEffect(() => {
    setHexInput(activeColor === 'none' ? '' : (activeColor || ''));
  }, [activeColor]);

  function handleHexCommit(val) {
    const clean = val.trim();
    const hex = clean.startsWith('#') ? clean : '#' + clean;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      (onColorCommit || onColorChange)(colorTarget, hex);
    }
  }

  const btnBase = {
    height: 24, borderRadius: 4, fontSize: 10, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'Courier New, monospace', outline: 'none',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  };

  return (
    <div style={{ padding: '8px 8px 6px', fontFamily: 'Courier New, monospace' }}>
      {/* Stroke / Fill / None toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {['stroke', 'fill'].map(t => (
          <button key={t} onClick={() => onTargetChange(t)} style={{
            ...btnBase, flex: 1,
            background: colorTarget === t ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.06)',
            border: colorTarget === t ? '1px solid #3B82F6' : '1px solid rgba(255,255,255,0.12)',
            color: colorTarget === t ? '#93C5FD' : 'rgba(255,255,255,0.4)',
          }}>{t}</button>
        ))}
        <button title="Set to none (invisible)" onClick={() => (onColorCommit || onColorChange)(colorTarget, 'none')} style={{
          ...btnBase, width: 30,
          background: activeColor === 'none' ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.06)',
          border: activeColor === 'none' ? '1px solid #EF4444' : '1px solid rgba(255,255,255,0.12)',
          color: activeColor === 'none' ? '#FCA5A5' : 'rgba(255,255,255,0.35)',
        }}>∅</button>
      </div>

      {/* Color wheel */}
      <ColorWheel
        color={!activeColor || activeColor === 'none' ? '#1a1a2e' : activeColor}
        onChange={c => onColorChange(colorTarget, c)}
        onCommit={c => onColorCommit && onColorCommit(colorTarget, c)}
      />

      {/* Hex input row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 }}>
        <div style={{
          width: 20, height: 20, borderRadius: 3, flexShrink: 0,
          border: '1px solid rgba(255,255,255,0.25)',
          background: activeColor === 'none'
            ? 'repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 6px 6px'
            : (activeColor || '#1a1a2e'),
        }} />
        <input type="text" value={hexInput}
          onChange={e => setHexInput(e.target.value)}
          onBlur={e  => handleHexCommit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { handleHexCommit(hexInput); e.target.blur(); } }}
          placeholder="#1a1a2e"
          style={{
            flex: 1, height: 22, borderRadius: 3, fontSize: 10, padding: '0 6px',
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)',
            color: 'rgba(255,255,255,0.75)', fontFamily: 'Courier New, monospace', outline: 'none',
          }}
        />
      </div>

      {/* Recent colors — 2 rows of 10 */}
      {recentColors.length > 0 && (
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 6 }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 5 }}>Recent</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3 }}>
            {Array.from({ length: 20 }).map((_, i) => {
              const c = recentColors[i];
              if (!c) return <div key={i} style={{ width: '100%', aspectRatio: '1', borderRadius: 3,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }} />;
              return (
                <button key={i} title={c} onClick={() => onColorCommit ? onColorCommit(colorTarget, c) : onColorChange(colorTarget, c)} style={{
                  width: '100%', aspectRatio: '1', borderRadius: 3, background: c, cursor: 'pointer',
                  padding: 0, outline: 'none',
                  border: activeColor === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                }} />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAPER.JS BOOLEAN JOIN UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

// Initialize paper.js in headless mode (no canvas needed for boolean ops)
(function initPaper() {
  if (typeof paper === 'undefined') return;
  try {
    const _c = document.createElement('canvas');
    _c.width = 1; _c.height = 1;
    paper.setup(_c);
  } catch (e) { /* paper not available — join tools will be disabled */ }
})();

// Convert our shape schema to a paper.js Path object
function paperPathFromShape(s) {
  if (typeof paper === 'undefined') return null;
  try {
    switch (s.type) {
      case 'line': {
        const p = new paper.Path();
        p.add(new paper.Point(s.x1, s.y1));
        p.add(new paper.Point(s.x2, s.y2));
        return p;
      }
      case 'rect':
        return new paper.Path.Rectangle(new paper.Rectangle(s.x, s.y, s.w, s.h));
      case 'circle':
        return new paper.Path.Circle(new paper.Point(s.cx, s.cy), s.r);
      case 'curve': {
        const arc = computeArcFromPI(s.x1, s.y1, s.x2, s.y2, s.px, s.py);
        if (!arc) {
          const p = new paper.Path();
          p.add(new paper.Point(s.x1, s.y1));
          p.add(new paper.Point(s.x2, s.y2));
          return p;
        }
        const { cx, cy, R, delta } = arc;
        const angA = Math.atan2(s.y1 - cy, s.x1 - cx);
        const cross = (s.px - s.x1) * (s.y2 - s.y1) - (s.py - s.y1) * (s.x2 - s.x1);
        const sweepCW = cross > 0;
        const midAng = angA + (sweepCW ? 1 : -1) * delta / 2;
        const tx = cx + R * Math.cos(midAng), ty = cy + R * Math.sin(midAng);
        return new paper.Path.Arc(
          new paper.Point(s.x1, s.y1),
          new paper.Point(tx, ty),
          new paper.Point(s.x2, s.y2)
        );
      }
      case 'path': {
        if (!s.nodes || s.nodes.length < 2) return null;
        const p = new paper.Path();
        s.nodes.forEach(n => {
          p.add(new paper.Segment(
            new paper.Point(n.x, n.y),
            new paper.Point((n.cp1x || n.x) - n.x, (n.cp1y || n.y) - n.y),
            new paper.Point((n.cp2x || n.x) - n.x, (n.cp2y || n.y) - n.y)
          ));
        });
        if (s.closed) p.closePath();
        return p;
      }
      default: return null;
    }
  } catch { return null; }
}

// Convert a paper.js path back to our path shape schema
function paperPathToOurShape(pp, ref) {
  if (!pp || !pp.segments) return null;
  try {
    // Handle compound paths (result of some boolean ops)
    const segs = pp.children ? pp.children.flatMap(c => c.segments || []) : pp.segments;
    if (!segs || segs.length < 2) return null;
    const nodes = segs.map(seg => ({
      x: seg.point.x, y: seg.point.y,
      type: (Math.abs(seg.handleIn.x) < 0.01 && Math.abs(seg.handleIn.y) < 0.01 &&
             Math.abs(seg.handleOut.x) < 0.01 && Math.abs(seg.handleOut.y) < 0.01) ? 'sharp' : 'smooth',
      cp1x: seg.point.x + seg.handleIn.x,  cp1y: seg.point.y + seg.handleIn.y,
      cp2x: seg.point.x + seg.handleOut.x, cp2y: seg.point.y + seg.handleOut.y,
    }));
    return {
      id: newId(), type: 'path',
      closed: pp.closed || (pp.children && pp.children[0]?.closed) || false,
      nodes,
      stroke: ref.stroke || STROKE, fill: ref.fill || 'none',
      strokeWidth: ref.strokeWidth || STROKE_W,
      layerId: ref.layerId,
    };
  } catch { return null; }
}

// Perform a boolean join operation on an array of shapes.
// Returns an array of new shapes (usually 1, more for divide).
function performJoin(op, selectedShapes) {
  if (typeof paper === 'undefined') return null;
  if (selectedShapes.length < 2) return null;
  const paths = selectedShapes.map(paperPathFromShape).filter(Boolean);
  if (paths.length < 2) return null;
  const ref = selectedShapes[0];
  try {
    if (op === 'divide') {
      // Divide: split each shape at intersections with others
      const results = [];
      let base = paths[0];
      for (let i = 1; i < paths.length; i++) {
        const divided = base.divide(paths[i]);
        if (divided) { results.push(divided); }
        base = base.subtract(paths[i]);
        if (base) results.push(base);
      }
      return results.map(r => paperPathToOurShape(r, ref)).filter(Boolean);
    }
    let result = paths[0];
    for (let i = 1; i < paths.length; i++) {
      switch (op) {
        case 'add':       result = result.unite(paths[i]); break;
        case 'subtract':  result = result.subtract(paths[i]); break;
        case 'intersect': result = result.intersect(paths[i]); break;
        case 'xor':       result = result.exclude(paths[i]); break;
      }
      if (!result) return null;
    }
    const shape = paperPathToOurShape(result, ref);
    return shape ? [shape] : null;
  } catch (err) {
    console.warn('Join op failed:', err);
    return null;
  }
}

// ─── Closed-region detection ────────────────────────────────────────────────
// Given a click point and an array of shapes, finds the smallest closed polygon
// formed by connected line segments that contains the click point.
// Uses planar DCEL (half-edge) face traversal.
// Returns an array of path nodes (sharp corners) or null if no region found.
function detectClosedRegionFromSegments(clickPt, shapes, snapTol) {
  // ── 1. Closed path/pen/pencil shapes: check directly via PIP ─────────────
  // A closed path with a click inside it → return its nodes as-is.
  for (let si = shapes.length - 1; si >= 0; si--) {
    const s = shapes[si];
    if (s.type !== 'path' || !s.closed || !s.nodes || s.nodes.length < 3) continue;
    let inside = false;
    const nv = s.nodes.length;
    for (let ci = 0, cj = nv - 1; ci < nv; cj = ci++) {
      const xi = s.nodes[ci].x, yi = s.nodes[ci].y;
      const xj = s.nodes[cj].x, yj = s.nodes[cj].y;
      if (((yi > clickPt.y) !== (yj > clickPt.y)) &&
          clickPt.x < (xj - xi) * (clickPt.y - yi) / (yj - yi) + xi)
        inside = !inside;
    }
    if (inside) {
      return s.nodes.map(n => ({
        x: n.x, y: n.y,
        type: n.type || 'sharp',
        cp1x: n.cp1x ?? n.x, cp1y: n.cp1y ?? n.y,
        cp2x: n.cp2x ?? n.x, cp2y: n.cp2y ?? n.y,
      }));
    }
  }

  // ── 2. Collect raw polyline segments from all shape types ─────────────────
  // Curves are approximated as 20-step polylines so arc intersections work.
  const rawSegs = []; // each: [x1, y1, x2, y2]

  shapes.forEach(s => {
    if (s.visible === false) return;
    if (s.type === 'line') {
      rawSegs.push([s.x1, s.y1, s.x2, s.y2]);
    } else if (s.type === 'rect') {
      const { x, y, w, h } = s;
      rawSegs.push([x, y, x+w, y], [x+w, y, x+w, y+h],
                   [x+w, y+h, x, y+h], [x, y+h, x, y]);
    } else if (s.type === 'curve') {
      const cpx = s.px !== undefined ? s.px : (s.x1+s.x2)/2;
      const cpy = s.py !== undefined ? s.py : (s.y1+s.y2)/2;
      const arc = computeArcFromPI(s.x1, s.y1, s.x2, s.y2, cpx, cpy);
      if (arc) {
        const { cx, cy, R, delta } = arc;
        const angA = Math.atan2(s.y1 - cy, s.x1 - cx);
        const cross = (cpx - s.x1) * (s.y2 - s.y1) - (cpy - s.y1) * (s.x2 - s.x1);
        const sweepDir = cross > 0 ? 1 : -1;
        const STEPS = 20;
        let prev = { x: s.x1, y: s.y1 };
        for (let i = 1; i <= STEPS; i++) {
          const a = angA + sweepDir * (delta * i / STEPS);
          const cur = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
          rawSegs.push([prev.x, prev.y, cur.x, cur.y]);
          prev = cur;
        }
      } else {
        rawSegs.push([s.x1, s.y1, s.x2, s.y2]);
      }
    } else if (s.type === 'circle') {
      const STEPS = 48;
      for (let i = 0; i < STEPS; i++) {
        const a0 = (i / STEPS) * 2 * Math.PI;
        const a1 = ((i + 1) / STEPS) * 2 * Math.PI;
        rawSegs.push([
          s.cx + s.r * Math.cos(a0), s.cy + s.r * Math.sin(a0),
          s.cx + s.r * Math.cos(a1), s.cy + s.r * Math.sin(a1),
        ]);
      }
    } else if (s.type === 'path' && s.nodes && s.nodes.length >= 2) {
      const nodes = s.nodes;
      for (let i = 0; i < nodes.length - 1; i++)
        rawSegs.push([nodes[i].x, nodes[i].y, nodes[i+1].x, nodes[i+1].y]);
      if (s.closed)
        rawSegs.push([nodes[nodes.length-1].x, nodes[nodes.length-1].y, nodes[0].x, nodes[0].y]);
    }
  });

  if (rawSegs.length < 2) return null;

  // ── 3. Split segments at all pairwise intersections ───────────────────────
  // This lets crossing lines (non-endpoint-connected) form closed regions.
  function segSplit(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx-ax, d1y = by-ay, d2x = dx-cx, d2y = dy-cy;
    const denom = d1x*d2y - d1y*d2x;
    if (Math.abs(denom) < 1e-10) return null;
    const t = ((cx-ax)*d2y - (cy-ay)*d2x) / denom;
    const u = ((cx-ax)*d1y - (cy-ay)*d1x) / denom;
    const EPS = 1e-6;
    if (t > EPS && t < 1-EPS && u > EPS && u < 1-EPS)
      return { x: ax + t*d1x, y: ay + t*d1y, t, u };
    return null;
  }

  // Collect intersection t-values per segment
  const splitTs = rawSegs.map(() => []);
  for (let i = 0; i < rawSegs.length; i++) {
    for (let j = i+1; j < rawSegs.length; j++) {
      const [ax,ay,bx,by] = rawSegs[i], [cx,cy,dx,dy] = rawSegs[j];
      const p = segSplit(ax,ay,bx,by,cx,cy,dx,dy);
      if (p) {
        splitTs[i].push(p.t);
        splitTs[j].push(p.u);
      }
    }
  }

  // Build final segment list after splitting
  const finalSegs = [];
  for (let i = 0; i < rawSegs.length; i++) {
    const [ax,ay,bx,by] = rawSegs[i];
    const ts = [...new Set(splitTs[i])].sort((a,b)=>a-b);
    const pts = [0, ...ts, 1].map(t => ({ x: ax+t*(bx-ax), y: ay+t*(by-ay) }));
    for (let k = 0; k < pts.length-1; k++) {
      const dx = pts[k+1].x-pts[k].x, dy = pts[k+1].y-pts[k].y;
      if (dx*dx+dy*dy > 0.0001)
        finalSegs.push([pts[k].x, pts[k].y, pts[k+1].x, pts[k+1].y]);
    }
  }

  if (finalSegs.length < 3) return null;

  // ── 3.5 Build vertex set + prune dangling segments ────────────────────────
  // IMPORTANT: build the vertex set first (with float-safe dedup), then use
  // vertex *indices* for degree counting.  Using Math.round string keys was
  // unreliable: intersection points computed from two different segment pairs
  // may differ by a fraction of a pixel, rounding to different keys and
  // leaving dangling line-tails alive, which breaks the DCEL face traversal.
  const DEDUP = 0.5;
  const tol2 = DEDUP * DEDUP;
  const verts = [];
  function findOrAdd(x, y) {
    for (let i = 0; i < verts.length; i++) {
      const dx = verts[i][0]-x, dy = verts[i][1]-y;
      if (dx*dx+dy*dy < tol2) return i;
    }
    verts.push([x, y]);
    return verts.length - 1;
  }

  // Map every final sub-segment to a pair of vertex indices
  let viSegs = finalSegs.map(([x1,y1,x2,y2]) => [findOrAdd(x1,y1), findOrAdd(x2,y2)]);
  viSegs = viSegs.filter(([a,b]) => a !== b); // drop zero-length

  // Iteratively remove segments whose either endpoint has degree < 2.
  // A degree-1 tip can never be part of a closed face.
  {
    let changed = true;
    while (changed) {
      changed = false;
      const deg = new Array(verts.length).fill(0);
      viSegs.forEach(([a,b]) => { deg[a]++; deg[b]++; });
      const next = viSegs.filter(([a,b]) => deg[a] >= 2 && deg[b] >= 2);
      if (next.length < viSegs.length) { viSegs = next; changed = true; }
    }
  }

  if (viSegs.length < 3) return null;

  // ── 4. DCEL face detection on the pruned graph ────────────────────────────
  // Deduplicate parallel edges (same vertex pair in either direction) to avoid
  // phantom half-edges that corrupt the face traversal.
  const edgeSet = new Set();
  const edges = [];
  viSegs.forEach(([a, b]) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!edgeSet.has(key)) { edgeSet.add(key); edges.push([a, b]); }
  });
  if (edges.length < 3) return null;

  const nv = verts.length;
  const hFrom=[], hTo=[], hTwin=[], hNext=[];
  const outgoing = Array.from({ length: nv }, () => []);

  edges.forEach(([a, b]) => {
    const h1 = hFrom.length, h2 = h1+1;
    hFrom.push(a); hTo.push(b); hTwin.push(h2); hNext.push(-1);
    hFrom.push(b); hTo.push(a); hTwin.push(h1); hNext.push(-1);
    outgoing[a].push(h1);
    outgoing[b].push(h2);
  });

  for (let v = 0; v < nv; v++) {
    const vx = verts[v][0], vy = verts[v][1];
    outgoing[v].sort((ia, ib) => {
      const aA = Math.atan2(verts[hTo[ia]][1]-vy, verts[hTo[ia]][0]-vx);
      const aB = Math.atan2(verts[hTo[ib]][1]-vy, verts[hTo[ib]][0]-vx);
      return aA - aB;
    });
  }

  const numHE = hFrom.length;
  for (let idx = 0; idx < numHE; idx++) {
    const v = hTo[idx], deg = outgoing[v].length;
    if (!deg) continue;
    const pos = outgoing[v].indexOf(hTwin[idx]);
    if (pos !== -1) hNext[idx] = outgoing[v][(pos-1+deg)%deg];
  }

  const visited = new Uint8Array(numHE);
  const faces = [];
  for (let s = 0; s < numHE; s++) {
    if (visited[s] || hNext[s] === -1) continue;
    const fv = [];
    let idx = s, cnt = 0;
    while (!visited[idx] && cnt < numHE) {
      visited[idx] = 1; fv.push(hFrom[idx]); idx = hNext[idx]; cnt++;
    }
    if (fv.length >= 3) faces.push(fv);
  }

  function signedArea(fv) {
    let a = 0, nf = fv.length;
    for (let i=0, j=nf-1; i<nf; j=i++) {
      const xi=verts[fv[i]][0], yi=verts[fv[i]][1];
      const xj=verts[fv[j]][0], yj=verts[fv[j]][1];
      a += (xi-xj)*(yi+yj);
    }
    return a/2;
  }

  function pip(pt, fv) {
    let inside = false, nf = fv.length;
    for (let i=0, j=nf-1; i<nf; j=i++) {
      const xi=verts[fv[i]][0], yi=verts[fv[i]][1];
      const xj=verts[fv[j]][0], yj=verts[fv[j]][1];
      if (((yi>pt.y)!==(yj>pt.y)) && pt.x<(xj-xi)*(pt.y-yi)/(yj-yi)+xi)
        inside = !inside;
    }
    return inside;
  }

  let bestFace = null, bestArea = Infinity;
  faces.forEach(fv => {
    // Use absolute area — DCEL winding depends on traversal order, not guaranteed CW.
    const sa = Math.abs(signedArea(fv));
    if (sa > 1 && pip(clickPt, fv) && sa < bestArea) {
      bestArea = sa; bestFace = fv;
    }
  });

  if (!bestFace) return null;

  // Build raw node list from face vertex indices
  let faceNodes = bestFace.map(vi => ({ x: verts[vi][0], y: verts[vi][1] }));

  // Remove collinear / near-collinear nodes: if a node lies within 0.5 px of
  // the line through its two neighbours, it adds no geometric information and
  // is just floating-point noise from segment-splitting.  Iterate until stable.
  {
    let changed = true;
    while (changed && faceNodes.length > 3) {
      changed = false;
      for (let i = faceNodes.length - 1; i >= 0 && faceNodes.length > 3; i--) {
        const prev = faceNodes[(i - 1 + faceNodes.length) % faceNodes.length];
        const curr = faceNodes[i];
        const nx   = faceNodes[(i + 1) % faceNodes.length];
        const dx = nx.x - prev.x, dy = nx.y - prev.y;
        const len2 = dx*dx + dy*dy;
        const dist = len2 < 1e-10 ? 0
          : Math.abs((curr.x - prev.x)*dy - (curr.y - prev.y)*dx) / Math.sqrt(len2);
        if (dist < 0.5) { faceNodes.splice(i, 1); changed = true; }
      }
    }
  }

  return faceNodes.map(n => ({
    x: n.x, y: n.y,
    type: 'sharp',
    cp1x: n.x, cp1y: n.y,
    cp2x: n.x, cp2y: n.y,
  }));
}

function SketchPage({ page, projectId, onReload }) {
  // Sanitize shapes on load: remove any path shapes with corrupted (NaN/null/undefined)
  // node coordinates that would crash pathToSVGD on render.
  function sanitizeShapes(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(s => {
      if (s.type !== 'path') return true;
      if (!Array.isArray(s.nodes) || s.nodes.length < 2) return false;
      return s.nodes.every(n =>
        isFinite(n.x) && isFinite(n.y) &&
        isFinite(n.cp1x ?? n.x) && isFinite(n.cp1y ?? n.y) &&
        isFinite(n.cp2x ?? n.x) && isFinite(n.cp2y ?? n.y)
      );
    });
  }
  const [shapes,      setShapes]      = useState(() => sanitizeShapes(page.shapes || []));
  const [notes,       setNotes]       = useState(page.notes  || '');
  const [tool,        setTool]        = useState('select');
  const [prevTool,    setPrevTool]    = useState(null);  // saved drawing tool after shape commit
  const [ribbonOpen,  setRibbonOpen]  = useState(true);
  const [selectedIds,   setSelectedIds]   = useState([]);          // multi-select
  const [shapesHistory, setShapesHistory] = useState({ past: [], future: [] }); // undo/redo
  const [marquee,       setMarquee]       = useState(null);        // lasso { ox,oy,x,y,w,h }
  const shapeClipRef = useRef(null);                               // shape clipboard
  const [drawState,   setDrawState]   = useState(null);  // in-progress shape
  const [dragNode,    setDragNode]    = useState(null);  // {shapeId, nodeKey}
  const [dragStart,   setDragStart]   = useState(null);  // {svgX, svgY, snapshot}
  const [textEdit,    setTextEdit]    = useState(null);  // {id, x, y, w, content}

  // ── Snap ──────────────────────────────────────────────────────────────────
  const [snapModes, setSnapModes] = useState({
    endpoint:      true,   // snap to shape endpoints / corners / centres
    midpoint:      false,  // snap to midpoints of segments
    intersection:  false,  // snap to line/line and line/circle intersections
    perpendicular: false,  // snap to perpendicular foot on a segment
    tangent:       false,  // snap to tangent point from cursor to a circle
    grid:          false,  // snap to minor grid intersections
  });
  const [snapPoint, setSnapPoint] = useState(null); // {x,y,type}|null — visual indicator
  const anySnapActive = Object.values(snapModes).some(Boolean);

  // Derived from selectedIds — backward-compat single-selection alias
  const selectedId = selectedIds[0] ?? null;
  const canUndo    = shapesHistory.past.length > 0;
  const canRedo    = shapesHistory.future.length > 0;

  // ── Scale & Units (Phase 3) ────────────────────────────────────────────────
  const [scaleDenom,    setScaleDenom]    = useState(page.scaleDenom  || 1);
  const [units,         setUnits]         = useState(page.units       || 'm');
  const [showScaleBar,  setShowScaleBar]  = useState(page.showScaleBar  !== false);
  const [showNorthArrow, setShowNorthArrow] = useState(page.showNorthArrow !== false);
  const [showGrid,      setShowGrid]      = useState(page.showGrid      !== false);
  // Tracks the live text-input value while the user is typing a new denominator
  const [scaleInput,    setScaleInput]    = useState(String(page.scaleDenom || 1));

  // ── Dimension labels ───────────────────────────────────────────────────────
  // When true, each committed shape shows an inline measurement label (length,
  // radius, arc length, width×height).  Also shown live while drawing.
  const [defaultStrokeW, setDefaultStrokeW] = useState(1.5);
  // ── Active color state ─────────────────────────────────────────────────────
  const [activeStrokeColor, setActiveStrokeColor] = useState(STROKE);
  const [activeFillColor,   setActiveFillColor]   = useState('none');
  const [colorTarget,       setColorTarget]       = useState('stroke'); // 'stroke' | 'fill'
  const [recentColors,      setRecentColors]      = useState([]);       // up to 10
  const [colorPanelOpen,    setColorPanelOpen]    = useState(true);
  const [bgColor,           setBgColor]           = useState(page.bgColor || null);

  // Add a color to the recent history (prepend, deduplicate, cap at 20)
  function pushRecentColor(hex) {
    if (!hex || hex === 'none') return;
    setRecentColors(prev => [hex, ...prev.filter(c => c !== hex)].slice(0, 20));
  }

  // Live update — called on every drag move. Sets the active color and updates
  // selected shapes immediately, but does NOT push to recent history.
  function applyColorToSelection(target, color) {
    if (target === 'stroke') setActiveStrokeColor(color);
    else setActiveFillColor(color);
    if (selectedIds.length > 0) {
      commitShapes(shapes.map(s =>
        selectedIds.includes(s.id) ? { ...s, [target]: color } : s
      ));
    }
  }

  // Commit — called on pointer release. Same as above but also pushes to history.
  function commitColorToSelection(target, color) {
    pushRecentColor(color);
    applyColorToSelection(target, color);
  }

  const [showDims,      setShowDims]      = useState(page.showDims      !== false);
  // When true (default), new shapes are committed with dims visible.
  // When false, new shapes are committed with _hideDims:true so dims are hidden by default.
  const [dimsOnDraw,    setDimsOnDraw]    = useState(page.dimsOnDraw   !== false);
  const [showValueCard, setShowValueCard] = useState(page.showValueCard !== false);

  // ── North direction (Phase 7) ──────────────────────────────────────────────
  // northAzimuth: clockwise degrees from screen-up that true North points.
  // Default 0 = North is straight up the screen.  Affects dim-bearing display
  // and the ShapeValueCard bearing field (Phase 6.9 deferred until Phase 7).
  const [northAzimuth, setNorthAzimuth]  = useState(page.northAzimuth || 0);

  // ── Dropdown menus ─────────────────────────────────────────────────────────
  const [openMenu, setOpenMenu] = useState(null); // null | 'view' | 'scale'
  const [menuPos,  setMenuPos]  = useState({ x: 0 });

  // Close any open dropdown when the user clicks outside the toolbar
  useEffect(() => {
    if (!openMenu) return;
    function onDoc(e) {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('pointerdown', onDoc, { capture: true });
    return () => document.removeEventListener('pointerdown', onDoc, { capture: true });
  }, [openMenu]);

  // ── Layers ────────────────────────────────────────────────────────────────
  const _initLayers = (page.layers && page.layers.length)
    ? page.layers : [{ id: 'l_1', name: 'Layer 1', visible: true }];
  const [layers,         setLayers]         = useState(_initLayers);
  const [activeLayerId,  setActiveLayerId]  = useState(_initLayers[0].id);
  const [rightPanelOpen,   setRightPanelOpen]   = useState(false);
  const [collapsedLayers,  setCollapsedLayers]  = useState(new Set());
  const [panelDrag, setPanelDrag]             = useState(null);
  const panelDragTimerRef = useRef(null);
  const [headerOpen,       setHeaderOpen]       = useState(false);
  const [notesOpen,        setNotesOpen]        = useState(false);

  // ── Pencil tool state ──────────────────────────────────────────────────────────────────────────────
  // stabilizerMode: 'rope' | 'window'
  const [stabilizerMode,  setStabilizerMode]  = useState('rope');
  const [ropeLength,      setRopeLength]      = useState(20);   // screen px
  const [windowSize,      setWindowSize]      = useState(8);    // samples
  const [pencilSmoothness,setPencilSmoothness]= useState(0.4);  // 0–1
  const [sculptMode,      setSculptMode]      = useState(false);
  // Pencil raw/smoothed points during active stroke (refs to avoid re-render on every point)
  const pencilRawRef      = useRef([]);    // raw pointer positions
  const pencilSmoothedRef = useRef([]);    // stabilizer output
  const pencilTipRef      = useRef(null);  // current rope-stabilizer tip {x,y}
  const [pencilPreview,   setPencilPreview] = useState(null); // [{x,y}] for live polyline

  // ── Pen tool state ────────────────────────────────────────────────────────────────────────────────
  // penMode: 'bezier' | 'smart' | 'corner'
  // 'corner' places only sharp nodes (no handle phase) — produces straight-line segments.
  const [penMode,         setPenMode]         = useState('bezier');
  // penNodes: placed nodes for in-progress pen path
  const [penNodes,        setPenNodes]        = useState([]);
  // penPhase: 'point' = next click places a node + rubber-band shows;
  //           'handle' = next click locks the bezier handle, cursor controls it live
  const [penPhase,        setPenPhase]        = useState('point');
  // penCursor: current mouse position for rubber band preview
  const [penCursor,       setPenCursor]       = useState(null);

  // ── Node tool state ──────────────────────────────────────────────────────────────────────────────
  // nodeSelectedId: which path shape is being edited with the Node tool
  const [nodeSelectedId,  setNodeSelectedId]  = useState(null);
  // nodeSelectedIdx: index of the selected node within the path (for type conversion)
  const [nodeSelectedIdx, setNodeSelectedIdx] = useState(null);
  // nodeDrag: active node/handle drag state for Node tool
  const nodeDragRef       = useRef(null); // { shapeId, type:'node'|'cp1'|'cp2'|'seg', nodeIdx, segIdx, startX, startY, snapshot }

  const svgRef      = useRef(null);
  const svgWrapRef  = useRef(null);
  const textareaRef = useRef(null);
  const lastTapRef  = useRef({ time: 0, x: 0, y: 0 }); // for touch double-tap detection
  const toolbarRef  = useRef(null);   // top toolbar — used to anchor dropdown position
  const saveTimer   = useRef(null);
  // svgSizeRef: raw CSS pixel dimensions of the SVG container (updated by ResizeObserver).
  // Used to compute pixelScale (ps) = viewBox.w / svgSizeRef.w = world-units per CSS pixel.
  // ps = 1.0 at zoom:1, ps = 0.5 at zoom:2, etc.
  // Seeded from page.containerSize so the ResizeObserver's proportional scale
  // calculation is based on the saved container size, not the 800×600 default.
  const svgSizeRef    = useRef(page.containerSize || { w: 800, h: 600 });
  // ── Zoom / Pan refs ────────────────────────────────────────────────────────
  // activePtrsRef: tracks all active pointer IDs and their client positions.
  //   When size >= 2 we're in pinch/pan mode; single-pointer drawing is suppressed.
  const activePtrsRef = useRef(new Map());     // pointerId → { x, y }
  // lastPinchRef: stores the previous frame's pinch midpoint + distance so we can
  //   compute per-frame zoom factor and pan delta incrementally.
  const lastPinchRef       = useRef(null);           // { dist, midX, midY }
  const pendingDeselectRef = useRef(null);           // setTimeout id — defers touch empty-space deselect
  // midPanRef: anchor data captured at middle-mouse button-down for smooth pan.
  const midPanRef     = useRef(null);           // { startX, startY, vbX, vbY, ps }
  const [isPanActive, setIsPanActive] = useState(false); // drives 'grab' cursor

  // viewBox state: { x, y, w, h } — the SVG camera window in world coordinates.
  // At zoom:1  → w = containerWidth, h = containerHeight (1:1 pixel mapping).
  // Zoom in    → shrink w and h (more world-space per pixel).
  // Pan        → shift x and y.
  // Restored from page.viewBox if available so the user sees the same view on reload.
  const _initVB = page.viewBox || { x: 0, y: 0, w: 800, h: 600 };
  const [viewBox, setViewBox] = useState(_initVB);
  // latestViewBoxRef: always holds the most recent viewBox value so that native
  // DOM event listeners (wheel, middle-mouse pan) can read it without stale closures.
  // Updated after every render via a no-dep-array useEffect below.
  const latestViewBoxRef = useRef(_initVB);
  // vbSaveRef: debounce timer for persisting the viewBox to DB.
  const vbSaveRef = useRef(null);

  // Keep viewBox in sync with the actual container size, preserving zoom level
  // when the window resizes.
  useEffect(() => {
    const el = svgWrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width <= 0 || height <= 0) return;
      const newW = Math.round(width);
      const newH = Math.round(height);
      const old  = svgSizeRef.current;
      svgSizeRef.current = { w: newW, h: newH };
      setViewBox(vb => ({
        ...vb,
        // Scale world dimensions proportionally so zoom level is preserved on resize.
        w: old.w > 0 ? vb.w * (newW / old.w) : newW,
        h: old.h > 0 ? vb.h * (newH / old.h) : newH,
      }));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Keep latestViewBoxRef current after every render so native event listeners
  // can always read the latest viewBox without being captured in stale closures.
  useEffect(() => { latestViewBoxRef.current = viewBox; });

  // Persist viewBox and container size to DB after 1 s of inactivity so the user
  // returns to the same pan position and zoom level on reload.
  // Container size is saved alongside so the ResizeObserver can proportionally
  // scale the zoom level correctly across different screen sizes.
  useEffect(() => {
    clearTimeout(vbSaveRef.current);
    vbSaveRef.current = setTimeout(() => {
      DB.updatePage(projectId, page.id, {
        viewBox,
        containerSize: svgSizeRef.current,
      });
    }, 1000);
    return () => clearTimeout(vbSaveRef.current);
  }, [viewBox.x, viewBox.y, viewBox.w, viewBox.h]);

  // Persist visual toggle states so they survive reload and so PDF export
  // respects show/hide settings.
  useEffect(() => {
    const t = setTimeout(() => {
      window._fb.DB.updatePage(projectId, page.id, {
        showGrid, showDims, dimsOnDraw, showValueCard, showScaleBar, showNorthArrow,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [showGrid, showDims, dimsOnDraw, showValueCard, showScaleBar, showNorthArrow]);

  // ── Native canvas input handlers (wheel zoom, middle-mouse pan, context menu) ──
  // All three are attached as native DOM listeners on svgWrapRef rather than as
  // React synthetic events because:
  //   • Wheel: Chrome won't reliably block ancestor scroll via React's passive onWheel.
  //   • Middle-mouse: Chrome fires pointercancel to activate its auto-scroll cursor
  //     mode before React's synthetic onPointerDown can respond, killing the pan
  //     before it starts. A native listener with passive:false + preventDefault()
  //     suppresses auto-scroll at the source.
  //   • Context menu: simplest to suppress at the native level alongside the others.
  // latestViewBoxRef provides a fresh viewBox snapshot so there are no stale closures.
  useEffect(() => {
    const el = svgWrapRef.current;
    if (!el) return;

    // ── Wheel zoom ────────────────────────────────────────────────────────────
    function handleWheel(e) {
      e.preventDefault();
      const svgEl = svgRef.current;
      const rect  = svgEl ? svgEl.getBoundingClientRect() : el.getBoundingClientRect();
      const sx    = e.clientX - rect.left;
      const sy    = e.clientY - rect.top;
      const dir   = e.deltaY > 0 ? 1 : -1;   // +1 zoom out, -1 zoom in
      const STEP  = 0.15;
      setViewBox(vb => {
        const sw     = svgSizeRef.current.w || vb.w;
        const sh     = svgSizeRef.current.h || vb.h;
        const factor = 1 + dir * STEP;
        const newW   = Math.max(20, Math.min(vb.w * factor, sw * 20));
        const newH   = newW * (sh / sw);
        const fx     = rect.width  > 0 ? sx / rect.width  : 0.5;
        const fy     = rect.height > 0 ? sy / rect.height : 0.5;
        const wx = vb.x + fx * vb.w;
        const wy = vb.y + fy * vb.h;
        return { x: wx - fx * newW, y: wy - fy * newH, w: newW, h: newH };
      });
    }

    // ── Middle-mouse pan ─────────────────────────────────────────────────────
    // Handled natively so Chrome's auto-scroll is suppressed before it activates.
    // Uses latestViewBoxRef so the start snapshot is always fresh.
    function handlePanDown(e) {
      if (e.button !== 1) return;
      e.preventDefault(); // suppresses Chrome's auto-scroll cursor activation
      const vb = latestViewBoxRef.current;
      const sw = svgSizeRef.current.w || vb.w;
      midPanRef.current = {
        startX: e.clientX, startY: e.clientY,
        vbX: vb.x, vbY: vb.y,
        ps: vb.w / sw,
      };
      setIsPanActive(true);
      // Capture the pointer so move/up events reach this element even if the
      // cursor leaves the canvas mid-drag.
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    }
    function handlePanMove(e) {
      if (!midPanRef.current) return;
      // Safety check: if middle button was released without a pointerup (e.g.
      // focus loss), clear the pan state.
      if (!(e.buttons & 4)) { midPanRef.current = null; setIsPanActive(false); return; }
      const { startX, startY, vbX, vbY, ps } = midPanRef.current;
      setViewBox(vb => ({
        ...vb,
        x: vbX - (e.clientX - startX) * ps,
        y: vbY - (e.clientY - startY) * ps,
      }));
    }
    function handlePanUp(e) {
      if (e.button !== 1) return;
      midPanRef.current = null;
      setIsPanActive(false);
    }

    // ── Context menu suppression ──────────────────────────────────────────────
    // Right-click inside the canvas should do nothing for now (reserved for
    // future tool assignment). The React onPointerDown handler also returns early
    // for button=2, so no drawing is triggered either.
    function handleContextMenu(e) { e.preventDefault(); }

    el.addEventListener('wheel',       handleWheel,       { passive: false });
    el.addEventListener('pointerdown', handlePanDown,     { passive: false });
    el.addEventListener('pointermove', handlePanMove);
    el.addEventListener('pointerup',   handlePanUp);
    el.addEventListener('contextmenu', handleContextMenu);
    return () => {
      el.removeEventListener('wheel',       handleWheel);
      el.removeEventListener('pointerdown', handlePanDown);
      el.removeEventListener('pointermove', handlePanMove);
      el.removeEventListener('pointerup',   handlePanUp);
      el.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []); // stable — only touches refs + functional setState; svgWrapRef lives for component lifetime

  // Reset state when page changes
  useEffect(() => {
    setShapes(page.shapes || []);
    setNotes(page.notes   || '');
    const ls = (page.layers && page.layers.length)
      ? page.layers : [{ id: 'l_1', name: 'Layer 1', visible: true }];
    setLayers(ls);
    setActiveLayerId(ls[0].id);
    setSelectedIds([]);
    setShapesHistory({ past: [], future: [] });
    setMarquee(null);
    setDrawState(null);
    setSnapPoint(null);
    // Reset new tool state on page change
    setPenNodes([]);
    setPenPhase('point');
    setPenCursor(null);
    setNodeSelectedId(null);
    setNodeSelectedIdx(null);
    setPencilPreview(null);
  }, [page.id]);

  // Keyboard shortcuts — undo/redo, delete, escape, clipboard, pen/pencil/node tools
  useEffect(() => {
    function handleKeyDown(e) {
      // Don't intercept when typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // ── Undo: Ctrl+Z / Cmd+Z ──────────────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        if (shapesHistory.past.length > 0) {
          const prev = shapesHistory.past[shapesHistory.past.length - 1];
          setShapesHistory(h => ({
            past: h.past.slice(0, -1),
            future: [shapes, ...h.future.slice(0, 49)],
          }));
          setShapes(prev);
          persist(prev, undefined);
          setSelectedIds([]);
        }
        return;
      }

      // ── Redo: Ctrl+Y / Cmd+Y / Ctrl+Shift+Z / Cmd+Shift+Z ───────────────
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        if (shapesHistory.future.length > 0) {
          const next = shapesHistory.future[0];
          setShapesHistory(h => ({
            past: [...h.past.slice(-49), shapes],
            future: h.future.slice(1),
          }));
          setShapes(next);
          persist(next, undefined);
          setSelectedIds([]);
        }
        return;
      }

      // ── Copy shapes: Ctrl+C / Cmd+C ───────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          shapeClipRef.current = shapes.filter(s => selectedIds.includes(s.id));
        }
        return;
      }

      // ── Paste shapes: Ctrl+V / Cmd+V ──────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (shapeClipRef.current && shapeClipRef.current.length > 0) {
          e.preventDefault();
          let t = Date.now();
          const pasted = shapeClipRef.current.map(s => {
            const id = 's_' + (++t) + '_' + Math.random().toString(36).slice(2, 6);
            return offsetShape({ ...s, id }, 20, 20);
          });
          commitShapes([...shapes, ...pasted]);
          setSelectedIds(pasted.map(s => s.id));
        }
        return;
      }

      // ── Enter: commit in-progress pen path as an open path ────────────────
      if (e.key === 'Enter' && tool === 'pen' && penNodes.length >= 2) {
        e.preventDefault();
        commitPenPath(false);
        return;
      }

      // ── Escape: cancel in-progress drawing; clear selection ───────────────
      if (e.key === 'Escape') {
        if (penNodes.length > 0) {
          setPenNodes([]);
          setPenPhase('point');
          setPenCursor(null);
        }
        if (drawState && drawState.type === 'pencil_stroke') {
          pencilRawRef.current = [];
          pencilSmoothedRef.current = [];
          pencilTipRef.current = null;
          setPencilPreview(null);
          setDrawState(null);
        }
        setDrawState(null);
        setSelectedIds([]);
        setMarquee(null);
        return;
      }

      // ── Delete / Backspace ────────────────────────────────────────────────
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Node tool: delete the selected node within a path
        if (tool === 'node' && nodeSelectedId !== null && nodeSelectedIdx !== null) {
          e.preventDefault();
          const newShapes = shapes.map(s => {
            if (s.id !== nodeSelectedId || !s.nodes) return s;
            const newNodes = s.nodes.filter((_, i) => i !== nodeSelectedIdx);
            if (newNodes.length < 2) return null;
            return { ...s, nodes: newNodes };
          }).filter(Boolean);
          commitShapes(newShapes);
          setNodeSelectedIdx(null);
          if (!newShapes.find(s => s.id === nodeSelectedId)) setNodeSelectedId(null);
          return;
        }
        // Select tool: delete all currently selected shapes
        if (selectedIds.length > 0) {
          e.preventDefault();
          commitShapes(shapes.filter(s => !selectedIds.includes(s.id)));
          setSelectedIds([]);
          return;
        }
      }

      // ── Tool shortcut keys ────────────────────────────────────────────────
      // Single-key shortcuts (no modifier). Skip if text tool is actively drawing.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const TOOL_KEYS = {
          v: 'select', l: 'line', c: 'curve', b: 'pencil', p: 'pen',
          a: 'node',   r: 'rect', o: 'circle', t: 'text', e: 'eraser', f: 'fill',
          m: 'dim-linear', g: 'dim-angle', k: 'dim-bearing', q: 'dim-radius',
        };
        const newTool = TOOL_KEYS[e.key.toLowerCase()];
        if (newTool) {
          // Don't hijack 't' or 'f' etc. while text tool is placing a shape
          if (tool === 'text' && drawState) return;
          e.preventDefault();
          setTool(newTool);
          setPrevTool(null);
          setDrawState(null);
          setPenNodes([]);
          setPenPhase('point');
          setPenCursor(null);
          return;
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tool, penNodes, drawState, nodeSelectedId, nodeSelectedIdx, shapes, shapesHistory, selectedIds]);

  // ── Coordinate conversion ──────────────────────────────────────────────────
  // screenToWorld: converts a pointer/mouse event's position from CSS screen
  // pixels to world (SVG viewBox) coordinates, accounting for pan and zoom.
  function screenToWorld(e) {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const sx = cx - rect.left;
    const sy = cy - rect.top;
    return {
      x: viewBox.x + (sx / rect.width)  * viewBox.w,
      y: viewBox.y + (sy / rect.height) * viewBox.h,
    };
  }

  // worldToScreen: converts world coordinates back to CSS pixel offsets within
  // the SVG wrapper div.  Used to position overlays (text editor) in screen space.
  function worldToScreen(wx, wy) {
    const { w: sw, h: sh } = svgSizeRef.current;
    return {
      x: (wx - viewBox.x) / viewBox.w * sw,
      y: (wy - viewBox.y) / viewBox.h * sh,
    };
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  // patch: optional { scaleDenom, units } to avoid stale-closure issues when
  // called immediately after setScaleDenom / setUnits in the same tick.
  function persist(nextShapes, nextNotes, nextLayers, patch) {
    const s  = nextShapes !== undefined ? nextShapes : shapes;
    const n  = nextNotes  !== undefined ? nextNotes  : notes;
    const l  = nextLayers !== undefined ? nextLayers : layers;
    const sd = (patch && patch.scaleDenom  !== undefined) ? patch.scaleDenom  : scaleDenom;
    const u  = (patch && patch.units       !== undefined) ? patch.units       : units;
    const na = (patch && patch.northAzimuth !== undefined) ? patch.northAzimuth : northAzimuth;
    const bg = (patch && patch.bgColor     !== undefined) ? patch.bgColor     : bgColor;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      DB.updatePage(projectId, page.id, { shapes: s, notes: n, layers: l, scaleDenom: sd, units: u, northAzimuth: na, bgColor: bg });
    }, 600);
  }

  function commitShapes(next) {
    // Push current shapes to history before applying next
    setShapesHistory(h => ({ past: [...h.past.slice(-49), shapes], future: [] }));
    setShapes(next);
    persist(next, undefined);
  }

  // Returns the layer ID to use for new dimension shapes (Phase 7).
  // If only one layer exists ("Layer 1"), auto-creates a "Dimensions" layer
  // and returns its ID. Otherwise returns the current active layer.
  function getDimLayerId() {
    const existing = layers.find(l => l.name === 'Dimensions');
    if (existing) return existing.id;
    if (layers.length === 1) {
      const dimLayerId = 'l_dims_' + Date.now();
      setLayers(prev => [...prev, { id: dimLayerId, name: 'Dimensions', visible: true }]);
      return dimLayerId;
    }
    return activeLayerId;
  }

  // Commit the in-progress pen path. closed=true closes the path back to the
  // first node; closed=false commits it as an open path.
  // Safe to call even if penNodes is empty (no-op).
  function commitPenPath(closed) {
    if (penNodes.length < 2) {
      // Not enough nodes — just cancel
      setPenNodes([]);
      setPenCursor(null);
      setPenPhase('point');
      return;
    }
    const nodes = penNodes.map(n => ({
      ...n,
      // Clamp any non-finite coordinates to the node position
      cp1x: isFinite(n.cp1x) ? n.cp1x : n.x,
      cp1y: isFinite(n.cp1y) ? n.cp1y : n.y,
      cp2x: isFinite(n.cp2x) ? n.cp2x : n.x,
      cp2y: isFinite(n.cp2y) ? n.cp2y : n.y,
    }));
    // Reject any node with a non-finite position — can't render or save safely
    if (!nodes.every(n => isFinite(n.x) && isFinite(n.y))) {
      setPenNodes([]);
      setPenCursor(null);
      setPenPhase('point');
      return;
    }
    if (penMode === 'smart') applySmartHandles(nodes);
    const pathId = newId();
    commitShapes([...shapes, {
      id: pathId, type: 'path', closed,
      nodes,
      stroke: activeStrokeColor, fill: activeFillColor, strokeWidth: defaultStrokeW,
      layerId: activeLayerId,
      ...(dimsOnDraw ? {} : { _hideDims: true }),
    }]);
    setPenNodes([]);
    setPenCursor(null);
    setPenPhase('point');
    setSelectedIds([pathId]);
    setPrevTool('pen');
  }

  // Functional update for the ShapeValueCard — always operates on the latest
  // shapes state so rapid field edits never race against each other.
  function handleCardUpdate(transformFn) {
    setShapes(prev => {
      const next = prev.map(sh => sh.id === selectedId ? transformFn(sh) : sh);
      persist(next, undefined);
      return next;
    });
  }

  function handleNotesChange(val) {
    setNotes(val);
    persist(undefined, val);
  }

  // ── Node positions per shape type ──────────────────────────────────────────
  // Returns array of {key, x, y, type: 'endpoint'|'control'}
  function getNodes(shape) {
    switch (shape.type) {
      case 'line':
        return [
          { key: 'p1', x: shape.x1, y: shape.y1, type: 'endpoint' },
          { key: 'p2', x: shape.x2, y: shape.y2, type: 'endpoint' },
        ];
      case 'curve': {
        const { px, py } = getCurvePI(shape);
        return [
          { key: 'p1', x: shape.x1, y: shape.y1, type: 'endpoint' },
          { key: 'p2', x: shape.x2, y: shape.y2, type: 'endpoint' },
          { key: 'pi', x: px,        y: py,        type: 'arc'     },
        ];
      }
      case 'circle':
        return [
          { key: 'c',  x: shape.cx,           y: shape.cy, type: 'endpoint' },
          { key: 'r',  x: shape.cx + shape.r, y: shape.cy, type: 'control'  },
        ];
      case 'rect':
        return [
          { key: 'tl', x: shape.x,           y: shape.y,           type: 'endpoint' },
          { key: 'tr', x: shape.x + shape.w, y: shape.y,           type: 'endpoint' },
          { key: 'bl', x: shape.x,           y: shape.y + shape.h, type: 'endpoint' },
          { key: 'br', x: shape.x + shape.w, y: shape.y + shape.h, type: 'endpoint' },
        ];
      case 'text': {
        // s.x/y = world center; s.w/h = screen pixels. Convert half-sizes to world units.
        const _ps2 = viewBox.w / (svgSizeRef.current.w || viewBox.w);
        const hw2  = (shape.w || 180) * _ps2 / 2;
        const hh2  = (shape.h ||  80) * _ps2 / 2;
        return [
          { key: 'tl', x: shape.x - hw2, y: shape.y - hh2, type: 'endpoint' },
          { key: 'tr', x: shape.x + hw2, y: shape.y - hh2, type: 'endpoint' },
          { key: 'bl', x: shape.x - hw2, y: shape.y + hh2, type: 'endpoint' },
          { key: 'br', x: shape.x + hw2, y: shape.y + hh2, type: 'endpoint' },
        ];
      }
      case 'dim-linear': {
        // P1 and P2 endpoint handles + offset handle at dim-line midpoint
        const { p1, p2 } = shape;
        const off = shape.offset || 0;
        const len = Math.hypot(p2.x-p1.x, p2.y-p1.y);
        if (len < 1) return [
          { key: 'p1', x: p1.x, y: p1.y, type: 'endpoint' },
          { key: 'p2', x: p2.x, y: p2.y, type: 'endpoint' },
        ];
        const perpX = -(p2.y-p1.y)/len, perpY = (p2.x-p1.x)/len;
        const omx = (p1.x+p2.x)/2 + perpX*off;
        const omy = (p1.y+p2.y)/2 + perpY*off;
        return [
          { key: 'p1',     x: p1.x, y: p1.y, type: 'endpoint' },
          { key: 'p2',     x: p2.x, y: p2.y, type: 'endpoint' },
          { key: 'offset', x: omx,  y: omy,   type: 'control'  },
        ];
      }
      case 'dim-angle': {
        const l1 = shapes.find(sh => sh.id === shape.line1Id && sh.type === 'line');
        const l2 = shapes.find(sh => sh.id === shape.line2Id && sh.type === 'line');
        if (!l1 || !l2) return [];
        const inter = lineIntersection(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2);
        if (!inter) return [];
        const _ps3 = viewBox.w / (svgSizeRef.current.w || viewBox.w);
        const arcR = (shape.scale || 1.0) * 40 * _ps3;
        let a1 = dimAngleArm(l1.x1, l1.y1, l1.x2, l1.y2, inter.x, inter.y);
        let a2 = dimAngleArm(l2.x1, l2.y1, l2.x2, l2.y2, inter.x, inter.y);
        let dAng = ((a2-a1)+2*Math.PI) % (2*Math.PI);
        if (dAng > Math.PI) { const t = a1; a1 = a2; a2 = t; dAng = 2*Math.PI - dAng; }
        const midAng = (a1 + dAng/2) + (shape.flip ? Math.PI : 0);
        return [{ key: 'body', x: inter.x + Math.cos(midAng)*arcR, y: inter.y + Math.sin(midAng)*arcR, type: 'control' }];
      }
      case 'dim-bearing': {
        if (!shape.p1 || !shape.p2) return [];
        return [
          { key: 'p1', x: shape.p1.x, y: shape.p1.y, type: 'endpoint' },
          { key: 'p2', x: shape.p2.x, y: shape.p2.y, type: 'endpoint' },
        ];
      }
      case 'dim-radius': {
        const ref = shapes.find(sh => sh.id === shape.shapeId);
        if (!ref) return [];
        const off = shape.offset || { x: 0, y: 0 };
        const cx = ref.type === 'circle' ? ref.cx : (ref.x1+ref.x2)/2;
        const cy = ref.type === 'circle' ? ref.cy : (ref.y1+ref.y2)/2;
        return [{ key: 'body', x: cx + off.x, y: cy + off.y, type: 'control' }];
      }
      default: return [];
    }
  }

  // Apply a node drag delta to a shape.
  // 'body' key moves all geometry + the stored _pivot together.
  function applyNodeDrag(shape, nodeKey, dx, dy) {
    if (nodeKey === 'body') {
      const piv = shape._pivot ? { x: shape._pivot.x+dx, y: shape._pivot.y+dy } : undefined;
      switch (shape.type) {
        case 'line':   return { ...shape, x1:shape.x1+dx, y1:shape.y1+dy, x2:shape.x2+dx, y2:shape.y2+dy, ...(piv && {_pivot:piv}) };
        case 'curve': {
          const { px: opx, py: opy } = getCurvePI(shape);
          return { ...shape, x1:shape.x1+dx, y1:shape.y1+dy, x2:shape.x2+dx, y2:shape.y2+dy,
            px: opx+dx, py: opy+dy, ...(piv && {_pivot:piv}) };
        }
        case 'circle': return { ...shape, cx:shape.cx+dx, cy:shape.cy+dy, ...(piv && {_pivot:piv}) };
        case 'rect':   return { ...shape, x:shape.x+dx, y:shape.y+dy, ...(piv && {_pivot:piv}) };
        case 'text':   return { ...shape, x:shape.x+dx, y:shape.y+dy, ...(piv && {_pivot:piv}) };
        case 'path': {
          return {
            ...shape,
            nodes: shape.nodes.map(n => ({
              ...n,
              x: n.x + dx, y: n.y + dy,
              cp1x: n.cp1x + dx, cp1y: n.cp1y + dy,
              cp2x: n.cp2x + dx, cp2y: n.cp2y + dy,
            })),
            ...(piv && { _pivot: piv }),
          };
        }
        case 'dim-bearing':
          return { ...shape, p1:{x:(shape.p1?.x||0)+dx,y:(shape.p1?.y||0)+dy}, p2:{x:(shape.p2?.x||0)+dx,y:(shape.p2?.y||0)+dy} };
        case 'dim-linear':
          return { ...shape, p1:{x:(shape.p1?.x||0)+dx,y:(shape.p1?.y||0)+dy}, p2:{x:(shape.p2?.x||0)+dx,y:(shape.p2?.y||0)+dy} };
        default: return shape;
      }
    }
    switch (shape.type) {
      case 'line':
        if (nodeKey === 'p1') return { ...shape, x1: shape.x1+dx, y1: shape.y1+dy };
        if (nodeKey === 'p2') return { ...shape, x2: shape.x2+dx, y2: shape.y2+dy };
        break;
      case 'curve': {
        const { px: cpx, py: cpy } = getCurvePI(shape);
        if (nodeKey === 'p1' || nodeKey === 'p2') {
          // Move the dragged endpoint; keep the other endpoint exactly fixed.
          // Re-project PI onto the NEW chord's perp bisector at the same signed
          // depth it had on the old chord — this preserves the curve's radius/
          // bulge and prevents the arc from warping when an endpoint is adjusted.
          const nx1 = nodeKey === 'p1' ? shape.x1 + dx : shape.x1;
          const ny1 = nodeKey === 'p1' ? shape.y1 + dy : shape.y1;
          const nx2 = nodeKey === 'p2' ? shape.x2 + dx : shape.x2;
          const ny2 = nodeKey === 'p2' ? shape.y2 + dy : shape.y2;
          // Signed depth of old PI along old perp bisector
          const oldCh = Math.hypot(shape.x2-shape.x1, shape.y2-shape.y1) || 1;
          const omx = (shape.x1+shape.x2)/2, omy = (shape.y1+shape.y2)/2;
          const opX = -(shape.y2-shape.y1)/oldCh, opY = (shape.x2-shape.x1)/oldCh;
          const t = (cpx - omx) * opX + (cpy - omy) * opY;
          // Place PI at the same signed depth on the new chord's perp bisector
          const newCh = Math.hypot(nx2-nx1, ny2-ny1) || 1;
          const nmx = (nx1+nx2)/2, nmy = (ny1+ny2)/2;
          const npX = -(ny2-ny1)/newCh, npY = (nx2-nx1)/newCh;
          const minT = newCh * 0.05;
          const ct = t >= 0 ? Math.max(minT, t) : Math.min(-minT, t);
          return { ...shape, x1: nx1, y1: ny1, x2: nx2, y2: ny2,
                   px: nmx + npX * ct, py: nmy + npY * ct };
        }
        if (nodeKey === 'pi') {
          // Constrain PI to the perpendicular bisector of BC-EC.
          // The PI for a symmetric circular curve always lies on this line,
          // so we only allow movement along it (controls curve depth, not lateral drift).
          const { x1, y1, x2, y2 } = shape;
          const chord = Math.hypot(x2-x1, y2-y1) || 1;
          const mx = (x1+x2)/2, my = (y1+y2)/2;
          const perpX = -(y2-y1)/chord, perpY = (x2-x1)/chord;  // left-hand unit normal
          const rawPx = cpx + dx, rawPy = cpy + dy;
          // Signed projection distance from chord midpoint along perp bisector
          const t = (rawPx - mx) * perpX + (rawPy - my) * perpY;
          // Clamp to avoid degenerate flat curve
          const minT = chord * 0.05;
          const ct = t >= 0 ? Math.max(minT, t) : Math.min(-minT, t);
          return { ...shape, px: mx + perpX * ct, py: my + perpY * ct };
        }
        break;
      }
      case 'circle':
        if (nodeKey === 'c') {
          // 'c' is a full body move — carry _pivot along in world space.
          // dx/dy arrive in local (unrotated) coords; convert to world for _pivot.
          let wpx = dx, wpy = dy;
          if (shape._pivot && (shape._rot || 0)) {
            const rad = (shape._rot || 0) * Math.PI / 180;
            const cosR = Math.cos(rad), sinR = Math.sin(rad);
            wpx = dx * cosR - dy * sinR;
            wpy = dx * sinR + dy * cosR;
          }
          return {
            ...shape, cx: shape.cx + dx, cy: shape.cy + dy,
            ...(shape._pivot && { _pivot: { x: shape._pivot.x + wpx, y: shape._pivot.y + wpy } }),
          };
        }
        if (nodeKey === 'r') return { ...shape, r: Math.max(4, shape.r+dx) };
        break;
      case 'rect': {
        const rot = shape._rot || 0;
        if (!rot) {
          // Unrotated: simple local-space ops — opposite corner stays fixed in world space.
          if (nodeKey === 'tl') return { ...shape, x: shape.x+dx, y: shape.y+dy, w: Math.max(10, shape.w-dx), h: Math.max(10, shape.h-dy) };
          if (nodeKey === 'tr') return { ...shape,                y: shape.y+dy, w: Math.max(10, shape.w+dx), h: Math.max(10, shape.h-dy) };
          if (nodeKey === 'bl') return { ...shape, x: shape.x+dx,                w: Math.max(10, shape.w-dx), h: Math.max(10, shape.h+dy) };
          if (nodeKey === 'br') return { ...shape,                                w: Math.max(10, shape.w+dx), h: Math.max(10, shape.h+dy) };
        } else {
          // Rotated: dx/dy = local-space delta (caller already un-rotates world delta).
          // Strategy: work entirely in world space.
          //   1. Convert local delta → world delta (re-rotate by +rot).
          //   2. Compute world positions of fixed (opposite) corner and new dragged corner.
          //   3. New world center = midpoint of those two world positions.
          //   4. World diagonal (fixed→dragged) un-rotated → gives new local w and h.
          //   5. New top-left = new_center − (nw/2, nh/2).
          // Uses getShapePivot so it's correct whether or not _pivot is set.
          const rad = rot * Math.PI / 180;
          const cos = Math.cos(rad), sin = Math.sin(rad);
          // Local → world delta
          const wdx = dx * cos - dy * sin;
          const wdy = dx * sin + dy * cos;
          // Rotation center (may be _pivot or geometric center)
          const pivot = getShapePivot(shape);
          const pcx = pivot.x, pcy = pivot.y;
          // Local corner positions
          const C = {
            tl: { x: shape.x,           y: shape.y           },
            tr: { x: shape.x + shape.w, y: shape.y           },
            bl: { x: shape.x,           y: shape.y + shape.h },
            br: { x: shape.x + shape.w, y: shape.y + shape.h },
          };
          const opp = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' }[nodeKey];
          if (!opp) break;
          const Lf = C[opp], Ld = C[nodeKey];
          // World position of fixed (opposite) corner — does not change
          const Wfx = pcx + (Lf.x - pcx)*cos - (Lf.y - pcy)*sin;
          const Wfy = pcy + (Lf.x - pcx)*sin + (Lf.y - pcy)*cos;
          // World position of dragged corner after applying drag delta
          const Wdx = pcx + (Ld.x - pcx)*cos - (Ld.y - pcy)*sin + wdx;
          const Wdy = pcy + (Ld.x - pcx)*sin + (Ld.y - pcy)*cos + wdy;
          // New world center = midpoint
          const Ncx = (Wfx + Wdx) / 2, Ncy = (Wfy + Wdy) / 2;
          // World diagonal vector from fixed corner to dragged corner, un-rotated to local space.
          // R(−rot)(dx,dy) = (dx·cos + dy·sin, −dx·sin + dy·cos)
          const diagWx = Wdx - Wfx, diagWy = Wdy - Wfy;
          const diagLx = diagWx * cos + diagWy * sin;
          const diagLy = -diagWx * sin + diagWy * cos;
          // New dimensions are the absolute components of the local diagonal
          const nw = Math.max(10, Math.abs(diagLx));
          const nh = Math.max(10, Math.abs(diagLy));
          // New top-left: new world center is also the new local center (rotation is about center)
          return { ...shape, x: Ncx - nw / 2, y: Ncy - nh / 2, w: nw, h: nh };
        }
        break;
      }
      case 'text': {
        // s.x/y = world center; s.w/h = screen pixels; dx/dy = world units.
        // When dragging a corner, the opposite corner stays fixed and the center
        // moves by dx/2, dy/2 (midpoint of old and new corner positions).
        const _ps3 = viewBox.w / (svgSizeRef.current.w || viewBox.w);
        const tw3  = shape.w || 180;
        const th3  = shape.h ||  80;
        if (nodeKey === 'tl') return { ...shape, x: shape.x+dx/2, y: shape.y+dy/2, w: Math.max(40, tw3-dx/_ps3), h: Math.max(20, th3-dy/_ps3) };
        if (nodeKey === 'tr') return { ...shape, x: shape.x+dx/2, y: shape.y+dy/2, w: Math.max(40, tw3+dx/_ps3), h: Math.max(20, th3-dy/_ps3) };
        if (nodeKey === 'bl') return { ...shape, x: shape.x+dx/2, y: shape.y+dy/2, w: Math.max(40, tw3-dx/_ps3), h: Math.max(20, th3+dy/_ps3) };
        if (nodeKey === 'br') return { ...shape, x: shape.x+dx/2, y: shape.y+dy/2, w: Math.max(40, tw3+dx/_ps3), h: Math.max(20, th3+dy/_ps3) };
        break;
      }
      case 'dim-linear': {
        if (nodeKey === 'p1') return { ...shape, p1: { x: shape.p1.x+dx, y: shape.p1.y+dy } };
        if (nodeKey === 'p2') return { ...shape, p2: { x: shape.p2.x+dx, y: shape.p2.y+dy } };
        if (nodeKey === 'offset') {
          // Project cursor movement onto the perpendicular of P1→P2
          const len = Math.hypot(shape.p2.x-shape.p1.x, shape.p2.y-shape.p1.y);
          if (len < 1) return shape;
          const perpX = -(shape.p2.y-shape.p1.y)/len, perpY = (shape.p2.x-shape.p1.x)/len;
          return { ...shape, offset: (shape.offset || 0) + dx*perpX + dy*perpY };
        }
        break;
      }
      case 'dim-bearing':
        if (nodeKey === 'p1') return { ...shape, p1: { x:(shape.p1?.x||0)+dx, y:(shape.p1?.y||0)+dy } };
        if (nodeKey === 'p2') return { ...shape, p2: { x:(shape.p2?.x||0)+dx, y:(shape.p2?.y||0)+dy } };
        break;
      case 'dim-radius':
        if (nodeKey === 'body') return { ...shape, offset: { x:(shape.offset?.x||0)+dx, y:(shape.offset?.y||0)+dy } };
        break;
      case 'dim-angle': {
        if (nodeKey !== 'body') break;
        const _l1 = shapes.find(sh => sh.id === shape.line1Id && sh.type === 'line');
        const _l2 = shapes.find(sh => sh.id === shape.line2Id && sh.type === 'line');
        if (!_l1 || !_l2) break;
        const _inter = lineIntersection(_l1.x1, _l1.y1, _l1.x2, _l1.y2, _l2.x1, _l2.y1, _l2.x2, _l2.y2);
        if (!_inter) break;
        const _psD = viewBox.w / (svgSizeRef.current.w || viewBox.w);
        const _arcR = (shape.scale || 1.0) * 40 * _psD;
        const _a1 = dimAngleArm(_l1.x1, _l1.y1, _l1.x2, _l1.y2, _inter.x, _inter.y);
        const _a2 = dimAngleArm(_l2.x1, _l2.y1, _l2.x2, _l2.y2, _inter.x, _inter.y);
        let _dAng = ((_a2-_a1)+2*Math.PI) % (2*Math.PI);
        if (_dAng > Math.PI) _dAng = 2*Math.PI - _dAng;
        const _midNorm = _a1 + _dAng/2;
        const _midFlip = _midNorm + Math.PI;
        // Current handle position + incremental drag delta
        const _curMid = shape.flip ? _midFlip : _midNorm;
        const hx = _inter.x + Math.cos(_curMid)*_arcR + dx;
        const hy = _inter.y + Math.sin(_curMid)*_arcR + dy;
        const toDrag = Math.atan2(hy - _inter.y, hx - _inter.x);
        const newDist = Math.hypot(hx - _inter.x, hy - _inter.y);
        const newScale = Math.max(0.3, newDist / (40 * _psD));
        const angDiff = (a, b) => Math.abs(((a - b + 3*Math.PI) % (2*Math.PI)) - Math.PI);
        const newFlip = angDiff(toDrag, _midFlip) < angDiff(toDrag, _midNorm);
        return { ...shape, scale: newScale, flip: newFlip };
      }
    }
    return shape;
  }

  // ── Pointer down ───────────────────────────────────────────────────────────
  function onPointerDown(e) {
    if (e.target.closest('.sketch-ribbon')) return;
    setOpenMenu(null);

    // ── Bug fix 1: if a text edit is in progress, commit it and stop ────────
    // Don't call preventDefault here so the textarea blur fires naturally too.
    if (textEdit) {
      commitText();
      return;
    }

    // Only left-click (button 0) draws or selects.
    // Middle-click (button 1) pan is handled by native listeners in the useEffect above.
    // Right-click (button 2) is reserved for future use; context menu is suppressed natively.
    if (e.button !== 0) return;

    // Track every pointer for pinch/pan detection (must happen before any early returns)
    activePtrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // ── Two-finger touch → enter pinch/pan mode ───────────────────────────
    // Do NOT cancel drawState here — active drawings should survive a two-finger pan.
    // Cancel any pending touch-deselect so selection is preserved during the gesture.
    if (activePtrsRef.current.size >= 2) {
      e.preventDefault();
      if (pendingDeselectRef.current) {
        clearTimeout(pendingDeselectRef.current);
        pendingDeselectRef.current = null;
      }
      setDragNode(null);
      setDragStart(null);
      const pts  = [...activePtrsRef.current.values()];
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      lastPinchRef.current = { dist, midX, midY };
      return;
    }

    e.preventDefault();
    const pt = screenToWorld(e);
    // ps: world-units per CSS pixel — scales all fixed-screen-size thresholds so
    // they remain constant in screen pixels regardless of zoom level.
    const ps = viewBox.w / (svgSizeRef.current.w || viewBox.w);

    // ── Select mode: active when tool is 'select', when prevTool is set
    // (shape just created — handles stay interactive), or when tool is 'text'
    // and a text shape is already selected (so handles/drag work).
    const textToolWithSelection = tool === 'text' && selectedId &&
      shapes.some(s => s.id === selectedId && s.type === 'text');
    if (tool === 'select' || prevTool !== null || textToolWithSelection) {
      const isTouch    = e.pointerType === 'touch';
      const nodeThresh = (isTouch ? 28 : NODE_R + 4) * ps;
      const hitThresh  = (isTouch ? 24 : 8) * ps;

      // ── Double-click / double-tap: open text for editing (all pointer types) ──
      // Must run before handle/drag checks so the second click of a double-click
      // triggers editing rather than starting a body drag.
      {
        const now = Date.now();
        const lt  = lastTapRef.current;
        const dblR = isTouch ? 30 : 12;
        if (now - lt.time < 400 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < dblR) {
          const dblHit = hitTest(pt, shapes, hitThresh);
          if (dblHit && dblHit.type === 'text') {
            setTextEdit({ id: dblHit.id, x: dblHit.x, y: dblHit.y,
              w: dblHit.w, h: dblHit.h || 80, content: dblHit.content, editing: true });
            commitShapes(shapes.filter(s => s.id !== dblHit.id));
            lastTapRef.current = { time: 0, x: 0, y: 0 };
            return;
          }
        }
        lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
      }

      // ── Multi-select: group controls take priority over single-shape handling ──
      if (selectedIds.length >= 2) {
        const selShapes = shapes.filter(s => selectedIds.includes(s.id));
        const bb = getBoundingBox(selShapes);

        if (bb) {
          const PAD     = 10 * ps;
          const cx      = (bb.minX + bb.maxX) / 2;
          const cy      = (bb.minY + bb.maxY) / 2;
          const rotDist = ROT_HANDLE_DIST * ps;
          const rhPos   = { x: cx, y: bb.minY - PAD - rotDist };

          // Check group rotate handle
          if (Math.hypot(pt.x - rhPos.x, pt.y - rhPos.y) < Math.max(nodeThresh, (ROT_R + 4) * ps)) {
            setDragNode({ shapeId: null, nodeKey: 'group-rotate' });
            setDragStart({
              svgX: pt.x, svgY: pt.y, snapshot: shapes,
              pivX: cx, pivY: cy,
              multiIds: selectedIds.slice(),
            });
            return;
          }
        }

        // Check individual shape nodes for each selected shape
        for (const shape of selShapes) {
          if (shape.type.startsWith('dim-')) continue;
          const rot  = shape._rot || 0;
          const piv  = getShapePivot(shape);
          const nodes = getNodes(shape);
          for (const node of nodes) {
            const np = rot ? rotatePoint(node.x, node.y, piv.x, piv.y, rot) : node;
            if (Math.hypot(pt.x - np.x, pt.y - np.y) < nodeThresh) {
              setDragNode({ shapeId: shape.id, nodeKey: node.key });
              setDragStart({ svgX: pt.x, svgY: pt.y, snapshot: shapes });
              return;
            }
          }
        }

        // Check body hit on any selected shape → multi-body drag
        const bodyHit = hitTest(pt, selShapes, hitThresh);
        if (bodyHit) {
          setDragNode({ shapeId: bodyHit.id, nodeKey: 'body' });
          setDragStart({
            svgX: pt.x, svgY: pt.y, snapshot: shapes,
            multiIds: selectedIds.slice(),
          });
          return;
        }

        // Fell through — clicked outside selection; run new-selection / deselect
        const _msSelShapes = shapes.filter(s => {
          if (s.visible === false) return false;
          if (s.locked) return false;
          const _lid = s.layerId || layers[0]?.id;
          const _layer = layers.find(l => l.id === _lid);
          return _layer?.visible !== false && !_layer?.locked;
        });
        const msHit = hitTest(pt, _msSelShapes, hitThresh);
        setDragNode(null);
        if (msHit) {
          if (e.shiftKey) {
            setSelectedIds(prev =>
              prev.includes(msHit.id) ? prev.filter(id => id !== msHit.id) : [...prev, msHit.id]
            );
          } else {
            setSelectedIds([msHit.id]);
          }
        } else {
          if (!e.shiftKey) {
            if (e.pointerType === 'touch') {
              if (pendingDeselectRef.current) clearTimeout(pendingDeselectRef.current);
              pendingDeselectRef.current = setTimeout(() => {
                pendingDeselectRef.current = null;
                if (activePtrsRef.current.size < 2) setSelectedIds([]);
              }, 100);
            } else {
              setSelectedIds([]);
            }
          }
          if (prevTool !== null) { setPrevTool(null); return; }
          if (tool === 'select') {
            setMarquee({ ox: pt.x, oy: pt.y, x: pt.x, y: pt.y, w: 0, h: 0 });
          }
        }
        return;
      }

      if (selectedId) {
        const sel = shapes.find(s => s.id === selectedId);
        if (sel) {
          const rot = sel._rot || 0;
          const piv = getShapePivot(sel);

          // ── Check rotate handle ──────────────────────────────────────
          const rhRaw = { x: piv.x, y: piv.y - ROT_HANDLE_DIST * ps };
          const rhPos = rot ? rotatePoint(rhRaw.x, rhRaw.y, piv.x, piv.y, rot) : rhRaw;
          if (Math.hypot(pt.x - rhPos.x, pt.y - rhPos.y) < Math.max(nodeThresh, (ROT_R + 4) * ps)) {
            setDragNode({ shapeId: sel.id, nodeKey: 'rotate' });
            setDragStart({ svgX: pt.x, svgY: pt.y, snapshot: shapes,
              pivX: piv.x, pivY: piv.y, startRot: sel._rot || 0 });
            return;
          }

          // ── Check pivot handle ───────────────────────────────────────
          if (Math.hypot(pt.x - piv.x, pt.y - piv.y) < Math.max(nodeThresh, (PIVOT_R + 6) * ps)) {
            setDragNode({ shapeId: sel.id, nodeKey: 'pivot' });
            setDragStart({ svgX: pt.x, svgY: pt.y, snapshot: shapes });
            return;
          }

          // ── Check regular shape nodes (at their rotated visual positions) ──
          const nodes = getNodes(sel);
          for (const node of nodes) {
            const np = rot ? rotatePoint(node.x, node.y, piv.x, piv.y, rot) : node;
            if (Math.hypot(pt.x - np.x, pt.y - np.y) < nodeThresh) {
              setDragNode({ shapeId: sel.id, nodeKey: node.key });
              setDragStart({ svgX: pt.x, svgY: pt.y, snapshot: shapes });
              return;
            }
          }

          // ── Click on shape body → body drag (or edit if text tool) ─────
          if (hitTest(pt, [sel], hitThresh)) {
            if (textToolWithSelection) {
              // Text tool + click on selected text → open for editing immediately
              setTextEdit({ id: sel.id, x: sel.x, y: sel.y,
                w: sel.w, h: sel.h || 80, content: sel.content || '', editing: true });
              commitShapes(shapes.filter(s => s.id !== sel.id));
              return;
            }
            setDragNode({ shapeId: sel.id, nodeKey: 'body' });
            setDragStart({ svgX: pt.x, svgY: pt.y, snapshot: shapes });
            return;
          }
        }
      }

      // (Double-tap/double-click handling is at the top of this block)

      // ── New selection / deselect ─────────────────────────────────────
      const _selShapes = shapes.filter(s => {
        if (s.visible === false) return false;
        if (s.locked) return false;
        const _lid = s.layerId || layers[0]?.id;
        const _layer = layers.find(l => l.id === _lid);
        return _layer?.visible !== false && !_layer?.locked;
      });
      const hit = hitTest(pt, _selShapes, hitThresh);
      setDragNode(null);
      if (hit) {
        if (e.shiftKey) {
          // Shift-click: toggle this shape in the selection
          setSelectedIds(prev =>
            prev.includes(hit.id) ? prev.filter(id => id !== hit.id) : [...prev, hit.id]
          );
        } else {
          setSelectedIds([hit.id]);
        }
      } else {
        // Click on empty space — deselect, but defer for touch so a second finger
        // arriving within 100ms (two-finger pan/zoom) cancels the deselect.
        if (!e.shiftKey) {
          if (e.pointerType === 'touch') {
            if (pendingDeselectRef.current) clearTimeout(pendingDeselectRef.current);
            pendingDeselectRef.current = setTimeout(() => {
              pendingDeselectRef.current = null;
              if (activePtrsRef.current.size < 2) setSelectedIds([]);
            }, 100);
          } else {
            setSelectedIds([]);
          }
        }
        if (prevTool !== null) {
          // Exit post-create handle mode; don't start a marquee on the same click
          setPrevTool(null);
          return;
        }
        // Start a lasso/marquee drag (select tool only; not in post-create mode)
        if (tool === 'select') {
          setMarquee({ ox: pt.x, oy: pt.y, x: pt.x, y: pt.y, w: 0, h: 0 });
        }
      }
      return;
    }

    if (tool === 'eraser') {
      const hitThresh = (e.pointerType === 'touch' ? 24 : 8) * ps;
      const _erasable = shapes.filter(s => {
        if (s.visible === false) return false;
        if (s.locked) return false;
        const _lid = s.layerId || layers[0]?.id;
        const _layer = layers.find(l => l.id === _lid);
        return _layer?.visible !== false && !_layer?.locked;
      });
      const hit = hitTest(pt, _erasable, hitThresh);
      if (hit) commitShapes(shapes.filter(s => s.id !== hit.id));
      return;
    }

    // ── Fill tool ─────────────────────────────────────────────────────────────
    // Never modifies existing shapes. Detects closed regions formed by connected
    // line segments and creates a new, independent filled path shape.
    if (tool === 'fill') {
      const regionSnapTol = Math.max(12 * ps, 2);
      const regionNodes = detectClosedRegionFromSegments(pt, shapes.filter(s => s.visible !== false), regionSnapTol);
      if (regionNodes && regionNodes.length >= 3) {
        const fillColor = activeFillColor === 'none' ? activeStrokeColor : activeFillColor;
        pushRecentColor(fillColor);
        const regionId = newId();
        // Insert BEFORE existing shapes so the fill renders below the boundary lines
        const regionShape = {
          id: regionId, type: 'path', closed: true,
          nodes: regionNodes,
          stroke: 'none', fill: fillColor,
          strokeWidth: defaultStrokeW,
          layerId: activeLayerId,
          ...(dimsOnDraw ? {} : { _hideDims: true }),
        };
        commitShapes([regionShape, ...shapes]);
        setSelectedIds([regionId]);
      } else {
        // No closed region found — set background color
        const newBg = activeFillColor === 'none' ? null : activeFillColor;
        setBgColor(newBg);
        pushRecentColor(activeFillColor);
        persist(undefined, undefined, undefined, { bgColor: newBg });
      }
      return;
    }

    if (tool === 'text') {
      // Click on any text shape with text tool → immediately open for editing.
      // (If a text shape is already selected, the textToolWithSelection branch above
      // handles it; this path runs when no text shape is currently selected.)
      const hitThresh = (e.pointerType === 'touch' ? 24 : 8) * ps;
      const txtHit    = hitTest(pt, shapes, hitThresh);
      if (txtHit && txtHit.type === 'text') {
        setTextEdit({ id: txtHit.id, x: txtHit.x, y: txtHit.y,
          w: txtHit.w, h: txtHit.h || 80, content: txtHit.content || '', editing: true });
        commitShapes(shapes.filter(s => s.id !== txtHit.id));
        return;
      }
      // Click-drag on empty space draws a new text box (same flow as rect).
      setSelectedIds([]);
      const sp = anySnapActive ? resolveSnap(pt) : pt;
      setDrawState({ type: 'text', ox: sp.x, oy: sp.y, x: sp.x, y: sp.y, w: 0, h: 0, layerId: activeLayerId });
      return;
    }

    // ── Dimensioning tools (Phase 7) ─────────────────────────────────────────
    // dim-linear: two-click placement. Click 1 = P1, Click 2 = P2 → commit.
    // dim-angle:  two-click. Click line 1, click line 2 → commit.
    // dim-bearing / dim-radius: single click on the target shape → commit immediately.
    if (tool === 'dim-linear') {
      const sp = anySnapActive ? resolveSnap(pt) : pt;
      if (!drawState) {
        setDrawState({ type: 'dim-linear', phase: 1, x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y });
      } else {
        // Second click: commit dim-linear
        const dimId = newId();
        const defOff = 20 * ps; // default 20-screen-pixel offset
        commitShapes([...shapes, {
          id: dimId, type: 'dim-linear',
          p1: { x: drawState.x1, y: drawState.y1 },
          p2: { x: sp.x, y: sp.y },
          offset: defOff,
          stroke: STROKE, strokeWidth: defaultStrokeW,
          layerId: getDimLayerId(),
        }]);
        setSelectedIds([dimId]);
        setPrevTool(tool);
        setDrawState(null);
        setSnapPoint(null);
      }
      return;
    }

    if (tool === 'dim-angle') {
      const hitThreshDA = (e.pointerType === 'touch' ? 24 : 8) * ps;
      const hitDA = hitTest(pt, shapes.filter(sh => sh.type === 'line'), hitThreshDA);
      if (!drawState) {
        // Phase 1: click first line
        if (!hitDA) return;
        setDrawState({ type: 'dim-angle', phase: 1, line1Id: hitDA.id });
      } else if (drawState.phase === 1) {
        // Phase 2: click second line → enter preview/side-selection mode
        if (!hitDA || hitDA.id === drawState.line1Id) return;
        setDrawState({ type: 'dim-angle', phase: 2, line1Id: drawState.line1Id, line2Id: hitDA.id, flip: false });
      } else {
        // Phase 3: commit with whichever side the cursor is currently on
        const dimId = newId();
        commitShapes([...shapes, {
          id: dimId, type: 'dim-angle',
          line1Id: drawState.line1Id, line2Id: drawState.line2Id,
          scale: 1.0, flip: drawState.flip || false,
          stroke: STROKE, strokeWidth: defaultStrokeW,
          layerId: getDimLayerId(),
        }]);
        setSelectedIds([dimId]);
        setPrevTool(tool);
        setDrawState(null);
        setSnapPoint(null);
      }
      return;
    }

    if (tool === 'dim-bearing') {
      const sp = anySnapActive ? resolveSnap(pt) : pt;
      if (!drawState) {
        setDrawState({ type: 'dim-bearing', phase: 1, x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y });
      } else {
        const dimId = newId();
        commitShapes([...shapes, {
          id: dimId, type: 'dim-bearing',
          p1: { x: drawState.x1, y: drawState.y1 },
          p2: { x: sp.x, y: sp.y },
          stroke: STROKE, strokeWidth: defaultStrokeW,
          layerId: getDimLayerId(),
          ...(dimsOnDraw ? {} : { _hideDims: true }),
        }]);
        setSelectedIds([dimId]);
        setPrevTool(tool);
        setDrawState(null);
        setSnapPoint(null);
      }
      return;
    }

    if (tool === 'dim-radius') {
      const hitThreshDR = (e.pointerType === 'touch' ? 24 : 8) * ps;
      const hitDR = hitTest(pt, shapes.filter(sh => sh.type === 'circle' || sh.type === 'curve'), hitThreshDR);
      if (!hitDR) return;
      const dimId = newId();
      // Default offset: upper-right at 45°, length = radius or a screen constant
      const defLen = 60 * ps;
      commitShapes([...shapes, {
        id: dimId, type: 'dim-radius',
        shapeId: hitDR.id,
        offset: { x: defLen * Math.cos(-Math.PI/4), y: defLen * Math.sin(-Math.PI/4) },
        stroke: STROKE, strokeWidth: defaultStrokeW,
        layerId: getDimLayerId(),
      }]);
      setSelectedIds([dimId]);
      setPrevTool(tool);
      setSnapPoint(null);
      return;
    }

    if (tool === 'line') {
      const sp = anySnapActive ? resolveSnap(pt) : pt;
      setDrawState({ type: 'line', x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y, layerId: activeLayerId });
    }

    // ── Curve: 3-click  BC → EC → PI ─────────────────────────────────────────
    // Phase 1: click places BC; mouse shows dashed chord to cursor (EC preview).
    // Phase 2: click places EC; mouse tracks PI — arc updates live.
    // Phase 3: click places PI and commits the curve.
    if (tool === 'curve') {
      const sp = anySnapActive ? resolveSnap(pt) : pt;
      if (!drawState) {
        // Click 1: set BC
        setDrawState({ type: 'curve', phase: 1,
          x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y,
          px: sp.x, py: sp.y, layerId: activeLayerId });
      } else if (drawState.phase === 1) {
        // Click 2: lock EC; transition to phase 2 (PI follows mouse).
        // Guard inside the functional callback — on fast mobile taps the outer
        // drawState closure may be stale (still phase 1) when click 3 fires.
        // Without the guard the click-3 tap would re-run this branch and
        // overwrite x2/y2 with the PI tap position.
        const ec = anySnapActive ? resolveSnap(pt, { x: drawState.x1, y: drawState.y1 }) : pt;
        setDrawState(d => d?.phase === 1
          ? { ...d, phase: 2, x2: ec.x, y2: ec.y, px: ec.x, py: ec.y }
          : d);
      } else if (drawState.phase === 2) {
        // Click 3: commit with current PI position
        const _crvId = newId();
        commitShapes([...shapes, { id: _crvId, type: 'curve',
          x1: drawState.x1, y1: drawState.y1,
          x2: drawState.x2, y2: drawState.y2,
          px: drawState.px,  py: drawState.py,
          stroke: activeStrokeColor, fill: activeFillColor, strokeWidth: defaultStrokeW,
          layerId: drawState.layerId || activeLayerId,
          ...(dimsOnDraw ? {} : { _hideDims: true }) }]);
        setSelectedIds([_crvId]);
        setPrevTool(tool);
        setDrawState(null);
        setSnapPoint(null);
      }
    }

    // ── Circle: click-drag (same model as rect/line) ─────────────────────────
    // pointerDown sets center, pointerMove updates radius, pointerUp commits.
    if (tool === 'circle') {
      const sp = anySnapActive ? resolveSnap(pt) : pt;
      setDrawState({ type: 'circle', cx: sp.x, cy: sp.y, r: 0, layerId: activeLayerId });
    }

    if (tool === 'rect') {
      const sp = anySnapActive ? resolveSnap(pt) : pt;
      setDrawState({ type: 'rect', ox: sp.x, oy: sp.y, x: sp.x, y: sp.y, w: 0, h: 0, layerId: activeLayerId });
    }

    // ── Pencil Tool ──────────────────────────────────────────────────────────────────────────────
    if (tool === 'pencil') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const sp = anySnapActive ? resolveSnap(pt) : pt;
      pencilRawRef.current = [sp];
      pencilSmoothedRef.current = [sp];
      pencilTipRef.current = { ...sp };
      setPencilPreview([sp]);
      setDrawState({ type: 'pencil_stroke', layerId: activeLayerId });
    }

    // ── Pen Tool ─────────────────────────────────────────────────────────────────────────────────────────
    if (tool === 'pen') {
      const sp = anySnapActive ? resolveSnap(pt) : pt;
      // Right-click while drawing: commit open path (any phase)
      if (e.button === 2 && penNodes.length >= 2) {
        commitPenPath(false);
        return;
      }

      if (penPhase === 'handle') {
        // Handle click: lock the current handle (already baked into penNodes by onPointerMove)
        // and switch back to point phase so next click places the next node.
        setPenPhase('point');
        return;
      }

      // penPhase === 'point': place a new node
      // Check if clicking near first node to close the path
      if (penNodes.length >= 2) {
        const firstNode = penNodes[0];
        const closeDist = 14 * ps;
        if (Math.hypot(sp.x - firstNode.x, sp.y - firstNode.y) < closeDist) {
          commitPenPath(true);
          return;
        }
      }
      const newNode = { x: sp.x, y: sp.y, type: 'sharp',
        cp1x: sp.x, cp1y: sp.y, cp2x: sp.x, cp2y: sp.y };
      setPenNodes(prev => [...prev, newNode]);
      // Enter handle phase only in bézier mode — corner + smart skip it
      if (penNodes.length >= 1 && penMode === 'bezier') setPenPhase('handle');
    }
    // ── Node Tool ─────────────────────────────────────────────────────────────────────────────────
    if (tool === 'node') {
      // Ignore secondary touch points (second finger for two-finger scroll/zoom)
      // so the selected node/shape is preserved during pan gestures.
      if (!e.isPrimary) return;
      const nodeHitR = 12 * ps; // hit radius in world units
      const cpHitR   = 10 * ps;

      // Check if clicking on a node or handle of the currently selected path
      const pathShape = nodeSelectedId ? shapes.find(s => s.id === nodeSelectedId) : null;
      if (pathShape && pathShape.nodes) {
        // Check on-curve nodes FIRST — nodes have priority over their handles.
        // End nodes store cp1/cp2 at the node position initially; checking handles
        // first would always steal the click away from the node itself.
        for (let i = 0; i < pathShape.nodes.length; i++) {
          const node = pathShape.nodes[i];
          if (Math.hypot(pt.x - node.x, pt.y - node.y) < nodeHitR) {
            nodeDragRef.current = { shapeId: pathShape.id, type: 'node', nodeIdx: i,
              startX: pt.x, startY: pt.y, snapshot: shapes };
            setNodeSelectedIdx(i);
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
        }
        // Check control handles (only for non-sharp nodes, and only when the
        // handle has been pulled away from the node — skip co-located handles)
        for (let i = 0; i < pathShape.nodes.length; i++) {
          const node = pathShape.nodes[i];
          if (node.type !== 'sharp') {
            // cp1 handle — skip if it sits on the node (not yet pulled out)
            const cp1Dist = Math.hypot(node.cp1x - node.x, node.cp1y - node.y);
            if (cp1Dist > 1 && Math.hypot(pt.x - node.cp1x, pt.y - node.cp1y) < cpHitR) {
              nodeDragRef.current = { shapeId: pathShape.id, type: 'cp1', nodeIdx: i,
                startX: pt.x, startY: pt.y, snapshot: shapes };
              setNodeSelectedIdx(i);
              e.currentTarget.setPointerCapture(e.pointerId);
              return;
            }
            // cp2 handle — skip if it sits on the node (not yet pulled out)
            const cp2Dist = Math.hypot(node.cp2x - node.x, node.cp2y - node.y);
            if (cp2Dist > 1 && Math.hypot(pt.x - node.cp2x, pt.y - node.cp2y) < cpHitR) {
              nodeDragRef.current = { shapeId: pathShape.id, type: 'cp2', nodeIdx: i,
                startX: pt.x, startY: pt.y, snapshot: shapes };
              setNodeSelectedIdx(i);
              e.currentTarget.setPointerCapture(e.pointerId);
              return;
            }
          }
        }
        // Check segment click (bow curve or insert node)
        for (let i = 0; i < pathShape.nodes.length - 1; i++) {
          const n0 = pathShape.nodes[i];
          const n1 = pathShape.nodes[i + 1];
          const nearest = nearestOnCubic(
            { x: n0.x, y: n0.y },
            { x: n0.cp2x, y: n0.cp2y },
            { x: n1.cp1x, y: n1.cp1y },
            { x: n1.x, y: n1.y },
            pt
          );
          if (Math.hypot(nearest.x - pt.x, nearest.y - pt.y) < nodeHitR) {
            nodeDragRef.current = { shapeId: pathShape.id, type: 'seg', nodeIdx: i,
              segT: nearest.t, startX: pt.x, startY: pt.y, snapshot: shapes };
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
        }
      }

      const hitThreshN = (e.pointerType === 'touch' ? 24 : 8) * ps;

      // If a non-path shape is already selected, check its handles and body first
      // (same behaviour as the select tool — node tool acts as select for non-path shapes)
      if (selectedId && !nodeSelectedId) {
        const sel = shapes.find(s => s.id === selectedId);
        const selLayerLocked = sel ? layers.find(l => l.id === (sel.layerId || layers[0]?.id))?.locked : false;
        if (sel && sel.type !== 'path' && !sel.locked && !selLayerLocked) {
          const isTouch   = e.pointerType === 'touch';
          const nodeThresh = (isTouch ? 28 : NODE_R + 4) * ps;
          const rot = sel._rot || 0;
          const piv = getShapePivot(sel);

          // Check shape nodes (handles)
          const selNodes = getNodes(sel);
          for (const n of selNodes) {
            const np = rot ? rotatePoint(n.x, n.y, piv.x, piv.y, rot) : n;
            if (Math.hypot(pt.x - np.x, pt.y - np.y) < nodeThresh) {
              setDragNode({ shapeId: sel.id, nodeKey: n.key });
              setDragStart({ svgX: pt.x, svgY: pt.y, snapshot: shapes });
              e.currentTarget.setPointerCapture(e.pointerId);
              return;
            }
          }

          // Check body drag
          if (hitTest(pt, [sel], hitThreshN)) {
            setDragNode({ shapeId: sel.id, nodeKey: 'body' });
            setDragStart({ svgX: pt.x, svgY: pt.y, snapshot: shapes });
            return;
          }
        }
      }

      // Click on a path shape to select it for node editing,
      // or body-drag it if it was already selected.
      const _nodeUnlocked = s => {
        if (s.locked) return false;
        const _lid = s.layerId || layers[0]?.id;
        return !layers.find(l => l.id === _lid)?.locked;
      };
      const pathHit = hitTest(pt, shapes.filter(s => s.type === 'path' && _nodeUnlocked(s)), hitThreshN);
      if (pathHit) {
        if (pathHit.id === nodeSelectedId) {
          // Already selected — start body drag (moves all nodes together)
          nodeDragRef.current = { shapeId: pathHit.id, type: 'body-path',
            startX: pt.x, startY: pt.y, snapshot: shapes };
          e.currentTarget.setPointerCapture(e.pointerId);
        } else {
          setNodeSelectedId(pathHit.id);
          setNodeSelectedIdx(null);
          setSelectedIds([]);
          nodeDragRef.current = null;
        }
        return;
      }

      // Click on a non-path shape — select it and use select-tool handle behaviour
      const nonPathHit = hitTest(pt, shapes.filter(s => s.type !== 'path' && _nodeUnlocked(s)), hitThreshN);
      if (nonPathHit) {
        setSelectedIds([nonPathHit.id]);
        setNodeSelectedId(null);
        setNodeSelectedIdx(null);
        nodeDragRef.current = null;
      } else {
        // Click on empty space — deselect, deferred for touch (same pattern as select tool)
        nodeDragRef.current = null;
        if (e.pointerType === 'touch') {
          if (pendingDeselectRef.current) clearTimeout(pendingDeselectRef.current);
          pendingDeselectRef.current = setTimeout(() => {
            pendingDeselectRef.current = null;
            if (activePtrsRef.current.size < 2) {
              setSelectedIds([]);
              setNodeSelectedId(null);
              setNodeSelectedIdx(null);
            }
          }, 100);
        } else {
          setSelectedIds([]);
          setNodeSelectedId(null);
          setNodeSelectedIdx(null);
        }
      }
    }
  }

  function onPointerMove(e) {
    // Keep pointer map current so pinch tracking stays accurate.
    // Only left-click pointers are in activePtrsRef (button !== 0 returns early in onPointerDown).
    if (activePtrsRef.current.has(e.pointerId)) {
      activePtrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // ── Two-finger pinch + pan ──────────────────────────────────────────────
    if (activePtrsRef.current.size >= 2 && lastPinchRef.current) {
      const pts  = [...activePtrsRef.current.values()];
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const last = lastPinchRef.current;
      const el   = svgRef.current;
      const rect = el ? el.getBoundingClientRect()
                      : { left: 0, top: 0,
                          width:  svgSizeRef.current.w,
                          height: svgSizeRef.current.h };
      setViewBox(vb => {
        const sw     = svgSizeRef.current.w || vb.w;
        const sh     = svgSizeRef.current.h || vb.h;
        // Zoom: finger spread → zoom in (factor < 1 → smaller vb), spread apart → zoom out
        const factor = last.dist > 1 ? last.dist / dist : 1;
        const newW   = Math.max(20, Math.min(vb.w * factor, sw * 20));
        const newH   = newW * (sh / sw);
        // Keep world point under pinch midpoint stationary
        const fx     = rect.width  > 0 ? (midX - rect.left) / rect.width  : 0.5;
        const fy     = rect.height > 0 ? (midY - rect.top)  / rect.height : 0.5;
        const wx     = vb.x + fx * vb.w;
        const wy     = vb.y + fy * vb.h;
        // Apply zoom-anchored position + pan delta
        const ps     = vb.w / sw;
        return {
          x: wx - fx * newW - (midX - last.midX) * ps,
          y: wy - fy * newH - (midY - last.midY) * ps,
          w: newW, h: newH,
        };
      });
      lastPinchRef.current = { dist, midX, midY };
      return;
    }

    const rawPt = screenToWorld(e);
    const ps = viewBox.w / (svgSizeRef.current.w || viewBox.w);

    // ── Marquee drag update ────────────────────────────────────────────────────
    if (marquee) {
      const { ox, oy } = marquee;
      setMarquee({
        ox, oy,
        x: Math.min(ox, rawPt.x), y: Math.min(oy, rawPt.y),
        w: Math.abs(rawPt.x - ox), h: Math.abs(rawPt.y - oy),
      });
      return;
    }

    // ── Node / handle drag ────────────────────────────────────────────────────
    if (dragNode && dragStart) {
      setSnapPoint(null);

      // Group rotate: rotate all selected shapes around group bounding-box centre
      if (dragNode.nodeKey === 'group-rotate') {
        const piv        = { x: dragStart.pivX, y: dragStart.pivY };
        const startAngle = Math.atan2(dragStart.svgY - piv.y, dragStart.svgX - piv.x);
        const curAngle   = Math.atan2(rawPt.y - piv.y, rawPt.x - piv.x);
        const deltaDeg   = (curAngle - startAngle) * 180 / Math.PI;

        setShapes(dragStart.snapshot.map(s => {
          if (!dragStart.multiIds || !dragStart.multiIds.includes(s.id)) return s;
          const snap     = dragStart.snapshot.find(ss => ss.id === s.id);
          const shapePiv = getShapePivot(snap);
          const newPos   = rotatePoint(shapePiv.x, shapePiv.y, piv.x, piv.y, deltaDeg);
          const dx       = newPos.x - shapePiv.x;
          const dy       = newPos.y - shapePiv.y;
          const moved    = applyNodeDrag(snap, 'body', dx, dy);
          return { ...moved, _rot: (((snap._rot || 0) + deltaDeg) % 360 + 360) % 360 };
        }));
        return;
      }

      // Rotate handle: compute angle change from pivot using atan2
      if (dragNode.nodeKey === 'rotate') {
        const piv = { x: dragStart.pivX, y: dragStart.pivY };
        const startAngle = Math.atan2(dragStart.svgY - piv.y, dragStart.svgX - piv.x);
        const curAngle   = Math.atan2(rawPt.y - piv.y, rawPt.x - piv.x);
        const deltaDeg   = (curAngle - startAngle) * 180 / Math.PI;
        let   newRot     = ((dragStart.startRot + deltaDeg) % 360 + 360) % 360;

        // Snap: for each key endpoint of the shape (at would-be rotation newRot),
        // check if it falls within snap radius of an external snap point.
        // If so, compute the exact angle that places the endpoint in the direction
        // of that snap target and use it as the snapped rotation.
        if (anySnapActive) {
          const snapShape = dragStart.snapshot.find(s => s.id === dragNode.shapeId);
          if (snapShape) {
            const endpts = getSnapPoints(snapShape);
            let bestDist = Infinity, bestSnapRot = null, bestSnapCand = null;
            for (const ep of endpts) {
              const d = Math.hypot(ep.x - piv.x, ep.y - piv.y);
              if (d < 1e-6) continue;                          // ignore pivot itself
              const theta0   = Math.atan2(ep.y - piv.y, ep.x - piv.x);
              const rotRad   = newRot * Math.PI / 180;
              const rotPt    = { x: piv.x + d * Math.cos(theta0 + rotRad),
                                 y: piv.y + d * Math.sin(theta0 + rotRad) };
              const cands    = collectSnapCandidates(rotPt, null, null);
              if (cands.length && cands[0].dist < bestDist) {
                bestDist = cands[0].dist;
                // Angle from pivot to snap target → exact rotation to align ep with it
                const thetaT  = Math.atan2(cands[0].pt.y - piv.y, cands[0].pt.x - piv.x);
                bestSnapRot   = (((thetaT - theta0) * 180 / Math.PI) % 360 + 360) % 360;
                bestSnapCand  = cands[0];
              }
            }
            if (bestSnapRot !== null) {
              newRot = bestSnapRot;
              setSnapPoint({ x: bestSnapCand.pt.x, y: bestSnapCand.pt.y, type: bestSnapCand.type });
            } else {
              setSnapPoint(null);
            }
          }
        }

        setShapes(dragStart.snapshot.map(s =>
          s.id === dragNode.shapeId ? { ...s, _rot: newRot } : s
        ));
        return;
      }

      // Pivot handle: move the stored pivot point.
      // When the shape is rotated, changing _pivot shifts the SVG
      // rotate(rot, piv.x, piv.y) anchor and visually moves the shape.
      // We cancel that by offsetting the raw geometry by:
      //   offset = (I − R(−rot)) × ΔP
      // This keeps every rendered point at the same screen position
      // regardless of where the new pivot sits.
      if (dragNode.nodeKey === 'pivot') {
        let dx = rawPt.x - dragStart.svgX;
        let dy = rawPt.y - dragStart.svgY;

        // Snap the pivot to nearby shape nodes / snap points.
        if (anySnapActive) {
          const pivSnap = dragStart.snapshot.find(s => s.id === dragNode.shapeId);
          if (pivSnap) {
            const basePiv = getShapePivot(pivSnap);
            const wouldBe = { x: basePiv.x + dx, y: basePiv.y + dy };
            const cands   = collectSnapCandidates(wouldBe, null, null);
            if (cands.length) {
              dx = cands[0].pt.x - basePiv.x;
              dy = cands[0].pt.y - basePiv.y;
              setSnapPoint({ x: cands[0].pt.x, y: cands[0].pt.y, type: cands[0].type });
            } else {
              setSnapPoint(null);
            }
          }
        }

        setShapes(dragStart.snapshot.map(s => {
          if (s.id !== dragNode.shapeId) return s;
          const basePiv = getShapePivot(s);
          const newPiv  = { x: basePiv.x + dx, y: basePiv.y + dy };
          const rot     = s._rot || 0;
          if (rot) {
            const rad  = rot * Math.PI / 180;
            const cosR = Math.cos(rad);
            const sinR = Math.sin(rad);
            // (I − R(−rot)) × (dx, dy)
            // R(−rot)(dx,dy) = (dx·cosR + dy·sinR, −dx·sinR + dy·cosR)
            const offX = dx * (1 - cosR) - dy * sinR;
            const offY = dx * sinR       + dy * (1 - cosR);
            const moved = applyNodeDrag(s, 'body', offX, offY);
            return { ...moved, _pivot: newPiv };
          }
          return { ...s, _pivot: newPiv };
        }));
        return;
      }

      // Body drag: move the whole shape (with snap-to-node when any snap is active).
      // Check each key point of the shape at its would-be position and snap
      // whichever corner/endpoint is closest to a candidate.
      if (dragNode.nodeKey === 'body') {
        let dx = rawPt.x - dragStart.svgX;
        let dy = rawPt.y - dragStart.svgY;

        if (anySnapActive) {
          const snapShape = dragStart.snapshot.find(s => s.id === dragNode.shapeId);
          if (snapShape) {
            let bestDist = Infinity;
            let bestAdj  = null;
            let bestCand = null;
            for (const node of getSnapPoints(snapShape)) {
              const wouldBe = { x: node.x + dx, y: node.y + dy };
              const cands   = collectSnapCandidates(wouldBe, null, dragNode.shapeId);
              if (cands.length && cands[0].dist < bestDist) {
                bestDist = cands[0].dist;
                bestAdj  = { x: cands[0].pt.x - wouldBe.x, y: cands[0].pt.y - wouldBe.y };
                bestCand = cands[0];
              }
            }
            if (bestAdj) {
              dx += bestAdj.x;
              dy += bestAdj.y;
              setSnapPoint({ x: bestCand.pt.x, y: bestCand.pt.y, type: bestCand.type });
            } else {
              setSnapPoint(null);
            }
          }
        } else {
          setSnapPoint(null);
        }

        setShapes(dragStart.snapshot.map(s => {
          // Multi-body drag: move all shapes in the selection by the same offset
          if (dragStart.multiIds && dragStart.multiIds.includes(s.id)) {
            return applyNodeDrag(s, 'body', dx, dy);
          }
          return s.id === dragNode.shapeId ? applyNodeDrag(s, 'body', dx, dy) : s;
        }));
        return;
      }

      // Regular node drag.
      // When snap is on, project the node to the nearest candidate on any OTHER shape.
      if (anySnapActive && SNAP_NODES.has(dragNode.nodeKey)) {
        const snapshotShape = dragStart.snapshot.find(s => s.id === dragNode.shapeId);
        const snapshotNode  = snapshotShape && getNodes(snapshotShape).find(n => n.key === dragNode.nodeKey);
        if (snapshotNode) {
          const rot = snapshotShape._rot || 0;
          const piv = getShapePivot(snapshotShape);
          // Snap the screen-space target, excluding the dragged shape so it can't self-snap
          const snappedScreen = resolveSnap(rawPt, null, dragNode.shapeId);
          // Convert target screen position to the shape's local (unrotated) coordinate space
          const tl = rot ? rotatePoint(snappedScreen.x, snappedScreen.y, piv.x, piv.y, -rot) : snappedScreen;
          const ldx = tl.x - snapshotNode.x;
          const ldy = tl.y - snapshotNode.y;
          setShapes(dragStart.snapshot.map(s =>
            s.id === dragNode.shapeId ? applyNodeDrag(s, dragNode.nodeKey, ldx, ldy) : s
          ));
          return;
        }
      }

      // No snap (or non-snappable key): convert screen delta to shape-local space
      setSnapPoint(null);
      const dx = rawPt.x - dragStart.svgX;
      const dy = rawPt.y - dragStart.svgY;
      setShapes(dragStart.snapshot.map(s => {
        if (s.id !== dragNode.shapeId) return s;
        const rot = s._rot || 0;
        let ldx = dx, ldy = dy;
        if (rot) {
          const rad = -rot * Math.PI / 180;
          ldx = dx * Math.cos(rad) - dy * Math.sin(rad);
          ldy = dx * Math.sin(rad) + dy * Math.cos(rad);
        }
        return applyNodeDrag(s, dragNode.nodeKey, ldx, ldy);
      }));
      return;
    }

    // ── Apply snap during drawing ─────────────────────────────────────────────
    // Curve phase 2 (PI placement) is free-form — no snap on the PI itself.
    let pt = rawPt;
    if (anySnapActive && drawState) {
      const isCurvePI = drawState.type === 'curve' && drawState.phase === 2;
      if (!isCurvePI) {
        // Determine the "drawing from" anchor for perpendicular snap
        let drawingFrom = null;
        if (drawState.type === 'line')   drawingFrom = { x: drawState.x1, y: drawState.y1 };
        if (drawState.type === 'curve')  drawingFrom = { x: drawState.x1, y: drawState.y1 };
        if (drawState.type === 'rect')   drawingFrom = { x: drawState.ox, y: drawState.oy };
        if (drawState.type === 'circle') drawingFrom = { x: drawState.cx, y: drawState.cy };
        if (drawState.type === 'dim-linear'  && drawState.phase === 1) drawingFrom = { x: drawState.x1, y: drawState.y1 };
        if (drawState.type === 'dim-bearing' && drawState.phase === 1) drawingFrom = { x: drawState.x1, y: drawState.y1 };
        pt = resolveSnap(rawPt, drawingFrom);
      } else {
        setSnapPoint(null);
      }
    } else {
      setSnapPoint(null);
    }

    // Pen tool: update rubber-band cursor; in handle phase drive bezier live
    if (tool === 'pen') {
      const sp = anySnapActive ? resolveSnap(rawPt) : rawPt;
      setPenCursor(sp);
      if (penPhase === 'handle' && penNodes.length > 0) {
        // Cursor IS the outgoing handle of the last node; incoming handle is mirrored
        const cp2x = sp.x, cp2y = sp.y;
        setPenNodes(prev => {
          if (prev.length === 0) return prev;
          const next = [...prev];
          const n = next[next.length - 1];
          const cp1x = 2 * n.x - cp2x;
          const cp1y = 2 * n.y - cp2y;
          next[next.length - 1] = { ...n, type: 'smooth', cp1x, cp1y, cp2x, cp2y };
          return next;
        });
      }
    }

    // Node tool: handle active drag
    if (tool === 'node' && nodeDragRef.current) {
      const drag = nodeDragRef.current;
      const sp = anySnapActive ? resolveSnap(rawPt) : rawPt;
      setShapes(prev => prev.map(s => {
        if (s.id !== drag.shapeId || !s.nodes) return s;
        const nodes = s.nodes.map((n, i) => ({ ...n }));
        if (drag.type === 'node') {
          const node = nodes[drag.nodeIdx];
          const dx = sp.x - node.x;
          const dy = sp.y - node.y;
          // Move node and its handles together
          node.x    = sp.x;
          node.y    = sp.y;
          node.cp1x = node.cp1x + dx;
          node.cp1y = node.cp1y + dy;
          node.cp2x = node.cp2x + dx;
          node.cp2y = node.cp2y + dy;
        } else if (drag.type === 'cp1') {
          const node = nodes[drag.nodeIdx];
          node.cp1x = sp.x;
          node.cp1y = sp.y;
          if (node.type === 'smooth') {
            // Mirror cp2 around the node
            const len = Math.hypot(node.cp2x - node.x, node.cp2y - node.y);
            const dx = node.x - sp.x, dy = node.y - sp.y;
            const d = Math.hypot(dx, dy) || 1;
            node.cp2x = node.x + (dx / d) * len;
            node.cp2y = node.y + (dy / d) * len;
          }
        } else if (drag.type === 'cp2') {
          const node = nodes[drag.nodeIdx];
          node.cp2x = sp.x;
          node.cp2y = sp.y;
          if (node.type === 'smooth') {
            // Mirror cp1 around the node
            const len = Math.hypot(node.cp1x - node.x, node.cp1y - node.y);
            const dx = node.x - sp.x, dy = node.y - sp.y;
            const d = Math.hypot(dx, dy) || 1;
            node.cp1x = node.x + (dx / d) * len;
            node.cp1y = node.y + (dy / d) * len;
          }
        } else if (drag.type === 'seg') {
          // Bow the segment: move the nearest point on the curve by dragging
          const n0 = nodes[drag.nodeIdx];
          const n1 = nodes[drag.nodeIdx + 1];
          if (n1) {
            const dx = sp.x - drag.startX;
            const dy = sp.y - drag.startY;
            const t = drag.segT;
            // Weight the handle movement by t (closer to n0 → move n0's cp2 more)
            n0.cp2x += dx * (1 - t) * 2;
            n0.cp2y += dy * (1 - t) * 2;
            n1.cp1x += dx * t * 2;
            n1.cp1y += dy * t * 2;
            drag.startX = sp.x;
            drag.startY = sp.y;
          }
        } else if (drag.type === 'body-path') {
          // Move the entire path shape — translate all nodes and handles
          const dx = sp.x - drag.startX;
          const dy = sp.y - drag.startY;
          drag.startX = sp.x;
          drag.startY = sp.y;
          for (const n of nodes) {
            n.x    += dx; n.y    += dy;
            n.cp1x += dx; n.cp1y += dy;
            n.cp2x += dx; n.cp2y += dy;
          }
        }
        return { ...s, nodes };
      }));
    }

    if (!drawState) return;

    // dim-linear / dim-bearing: P2 tracks cursor after P1 is placed
    if (drawState.type === 'dim-linear') {
      setDrawState(d => d?.phase === 1 ? { ...d, x2: pt.x, y2: pt.y } : d);
    }
    if (drawState.type === 'dim-bearing') {
      setDrawState(d => d?.phase === 1 ? { ...d, x2: pt.x, y2: pt.y } : d);
    }
    // dim-angle phase 2: update flip based on which side of the intersection the cursor is on
    if (drawState.type === 'dim-angle' && drawState.phase === 2) {
      const _l1 = shapes.find(sh => sh.id === drawState.line1Id && sh.type === 'line');
      const _l2 = shapes.find(sh => sh.id === drawState.line2Id && sh.type === 'line');
      if (_l1 && _l2) {
        const _int = lineIntersection(_l1.x1, _l1.y1, _l1.x2, _l1.y2, _l2.x1, _l2.y1, _l2.x2, _l2.y2);
        if (_int) {
          let _a1 = dimAngleArm(_l1.x1, _l1.y1, _l1.x2, _l1.y2, _int.x, _int.y);
          let _a2 = dimAngleArm(_l2.x1, _l2.y1, _l2.x2, _l2.y2, _int.x, _int.y);
          let _dAng = ((_a2-_a1)+2*Math.PI) % (2*Math.PI);
          if (_dAng > Math.PI) { const _t = _a1; _a1 = _a2; _a2 = _t; _dAng = 2*Math.PI - _dAng; }
          const _midNorm = _a1 + _dAng/2;
          const _midFlip = _midNorm + Math.PI;
          const _cAng = Math.atan2(pt.y - _int.y, pt.x - _int.x);
          const _dN = Math.abs((((_cAng-_midNorm)+3*Math.PI) % (2*Math.PI)) - Math.PI);
          const _dF = Math.abs((((_cAng-_midFlip)+3*Math.PI) % (2*Math.PI)) - Math.PI);
          setDrawState(d => d ? { ...d, flip: _dF < _dN } : d);
        }
      }
    }

    if (drawState.type === 'line') {
      setDrawState(d => ({ ...d, x2: pt.x, y2: pt.y }));
    } else if (drawState.type === 'curve') {
      if (drawState.phase === 1) {
        // EC tracks snapped mouse (phase 1: choosing second endpoint).
        // Guard inside callback — stale closure may still read phase 1 on a
        // fast follow-up move after click 2 transitions us to phase 2.
        setDrawState(d => d?.phase === 1 ? { ...d, x2: pt.x, y2: pt.y } : d);
      } else if (drawState.phase === 2) {
        // PI tracks the perpendicular bisector of BC-EC — constraining lateral drift.
        // All BC/EC coords come from fresh `d` inside the callback so rapid moves
        // after the phase 1→2 transition always use the locked EC position.
        const _rawX = rawPt.x, _rawY = rawPt.y;
        setDrawState(d => {
          if (!d || d.phase !== 2) return d;
          const chord = Math.hypot(d.x2-d.x1, d.y2-d.y1) || 1;
          const mx = (d.x1+d.x2)/2, my = (d.y1+d.y2)/2;
          const perpX = -(d.y2-d.y1)/chord, perpY = (d.x2-d.x1)/chord;
          const t = (_rawX - mx) * perpX + (_rawY - my) * perpY;
          const minT = chord * 0.05;
          const ct = t >= 0 ? Math.max(minT, t) : Math.min(-minT, t);
          return { ...d, px: mx + perpX * ct, py: my + perpY * ct };
        });
      }
    } else if (drawState.type === 'circle') {
      const r = Math.hypot(pt.x - drawState.cx, pt.y - drawState.cy);
      setDrawState(d => ({ ...d, r }));
    } else if (drawState.type === 'rect' || drawState.type === 'text') {
      setDrawState(d => ({
        ...d,
        x: Math.min(d.ox, pt.x), y: Math.min(d.oy, pt.y),
        w: Math.abs(pt.x - d.ox), h: Math.abs(pt.y - d.oy),
      }));
    } else if (drawState.type === 'pencil_stroke') {
      // Collect coalesced events for high-frequency input
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events) {
        const rawEvPt = screenToWorld(ev);
        pencilRawRef.current.push(rawEvPt);
      }
      // Apply stabilizer — runs once per animation frame to update the smoothed trail
      const raw = pencilRawRef.current;
      const last = raw[raw.length - 1];
      if (stabilizerMode === 'rope') {
        // Rope stabilizer: virtual rope tip lags behind the pointer.
        // The tip moves toward the pointer only when the distance exceeds ropeLength.
        // We always append the current tip position so the preview trail is continuous.
        const ropeLenWorld = ropeLength * (viewBox.w / (svgSizeRef.current.w || viewBox.w));
        const tip = pencilTipRef.current || { ...last };
        const dist = Math.hypot(last.x - tip.x, last.y - tip.y);
        if (dist > ropeLenWorld) {
          // Move tip toward pointer, stopping ropeLength behind it
          const frac = (dist - ropeLenWorld) / dist;
          tip.x += (last.x - tip.x) * frac;
          tip.y += (last.y - tip.y) * frac;
        }
        // Always update the ref and always push the current tip to the smoothed trail
        pencilTipRef.current = { x: tip.x, y: tip.y };
        pencilSmoothedRef.current.push({ x: tip.x, y: tip.y });
      } else {
        // Window stabilizer: moving average of last windowSize raw points
        const win = raw.slice(-windowSize);
        const smoothed = {
          x: win.reduce((s, p) => s + p.x, 0) / win.length,
          y: win.reduce((s, p) => s + p.y, 0) / win.length,
        };
        pencilSmoothedRef.current.push(smoothed);
      }
      setPencilPreview([...pencilSmoothedRef.current]);
    }
  }

  function onPointerUp(e) {
    // ── Pointer tracking cleanup ──────────────────────────────────────────
    // activePtrsRef only contains left-click pointers (button !== 0 returns
    // early in onPointerDown), so this delete is always safe.
    activePtrsRef.current.delete(e.pointerId);
    if (activePtrsRef.current.size < 2) lastPinchRef.current = null;

    // ── Still in two-finger mode → don't process single-pointer events ────
    if (activePtrsRef.current.size >= 2) return;

    setSnapPoint(null);

    // ── Marquee selection commit ───────────────────────────────────────────
    if (marquee) {
      const { x, y, w, h } = marquee;
      if (w > 4 && h > 4) {
        const ids = shapes
          .filter(s => {
            const layer = layers.find(l => l.id === (s.layerId || layers[0]?.id));
            if (!layer?.visible) return false;
            return shapeIntersectsRect(s, x, y, x + w, y + h);
          })
          .map(s => s.id);
        if (ids.length > 0) setSelectedIds(ids);
      }
      setMarquee(null);
      return;
    }

    // Commit node drag
    if (dragNode) {
      commitShapes(shapes);
      setDragNode(null);
      setDragStart(null);
      return;
    }

    // Node tool: commit drag on pointer up
    if (tool === 'node' && nodeDragRef.current) {
      commitShapes(shapes);
      nodeDragRef.current = null;
      return;
    }

    if (!drawState) return;

    // Line commits on mouseup (click-drag)
    if (drawState.type === 'line') {
      const dx = drawState.x2 - drawState.x1, dy = drawState.y2 - drawState.y1;
      if (Math.hypot(dx, dy) > 4) {
        const _lineId = newId();
        commitShapes([...shapes, { id: _lineId, type: 'line',
          x1: drawState.x1, y1: drawState.y1, x2: drawState.x2, y2: drawState.y2,
          stroke: activeStrokeColor, fill: activeFillColor, strokeWidth: defaultStrokeW,
          layerId: drawState.layerId || activeLayerId,
          ...(dimsOnDraw ? {} : { _hideDims: true }) }]);
        setSelectedIds([_lineId]);
        setPrevTool(tool);
      }
      setDrawState(null);
    }

    // Rect commits on mouseup (click-drag)
    if (drawState.type === 'rect') {
      if (drawState.w > 4 && drawState.h > 4) {
        const _rctId = newId();
        commitShapes([...shapes, { id: _rctId, type: 'rect',
          x: drawState.x, y: drawState.y, w: drawState.w, h: drawState.h,
          stroke: activeStrokeColor, fill: activeFillColor, strokeWidth: defaultStrokeW,
          layerId: drawState.layerId || activeLayerId,
          ...(dimsOnDraw ? {} : { _hideDims: true }) }]);
        setSelectedIds([_rctId]);
        setPrevTool(tool);
      }
      setDrawState(null);
    }

    // Circle commits on mouseup (click-drag — same model as rect/line)
    if (drawState.type === 'circle') {
      if (drawState.r > 4) {
        const _cirId = newId();
        commitShapes([...shapes, { id: _cirId, type: 'circle',
          cx: drawState.cx, cy: drawState.cy, r: drawState.r,
          stroke: activeStrokeColor, fill: activeFillColor, strokeWidth: defaultStrokeW,
          layerId: drawState.layerId || activeLayerId,
          ...(dimsOnDraw ? {} : { _hideDims: true }) }]);
        setSelectedIds([_cirId]);
        setPrevTool(tool);
      }
      setDrawState(null);
      setSnapPoint(null);
    }

    // Pencil stroke commits on pointer up
    if (drawState && drawState.type === 'pencil_stroke') {
      const pts = pencilSmoothedRef.current;
      if (pts.length >= 2) {
        let nodes = fitCurveToPoints(pts, pencilSmoothness);
        // Sanitize: clamp any non-finite handle coordinates to the node position
        nodes = nodes.map(n => ({
          ...n,
          cp1x: isFinite(n.cp1x) ? n.cp1x : n.x,
          cp1y: isFinite(n.cp1y) ? n.cp1y : n.y,
          cp2x: isFinite(n.cp2x) ? n.cp2x : n.x,
          cp2y: isFinite(n.cp2y) ? n.cp2y : n.y,
        }));
        // Only commit if all node positions are finite
        const nodesValid = nodes.length >= 2 &&
          nodes.every(n => isFinite(n.x) && isFinite(n.y));
        if (nodesValid) {
          const pathId = newId();
          commitShapes([...shapes, {
            id: pathId, type: 'path', closed: false,
            nodes,
            stroke: activeStrokeColor, fill: activeFillColor, strokeWidth: defaultStrokeW,
            layerId: drawState.layerId || activeLayerId,
            ...(dimsOnDraw ? {} : { _hideDims: true }),
          }]);
          setSelectedIds([pathId]);
          setPrevTool(tool);
        }
      }
      pencilRawRef.current = [];
      pencilSmoothedRef.current = [];
      pencilTipRef.current = null;
      setPencilPreview(null);
      setDrawState(null);
    }

    // Text bbox drawn — open the textarea at the drawn dimensions.
    // drawState.w/h are in world units; convert to screen pixels for storage
    // (s.w/s.h are kept as screen px so the box stays the same visual size at any zoom).
    if (drawState && drawState.type === 'text') {
      const _psUp    = viewBox.w / (svgSizeRef.current.w || viewBox.w);
      const bigEnough = drawState.w > 10 && drawState.h > 10;
      // Store the CENTER as the world anchor, and w/h as screen pixels.
      setTextEdit({
        id: newId(),
        x: bigEnough ? drawState.x + drawState.w / 2 : drawState.ox,
        y: bigEnough ? drawState.y + drawState.h / 2 : drawState.oy,
        w: bigEnough ? Math.round(drawState.w / _psUp) : 180,
        h: bigEnough ? Math.round(drawState.h / _psUp) : 80,
        content: '',
        layerId: drawState.layerId || activeLayerId,
      });
      setDrawState(null);
    }
  }

  // Hit-test — returns first shape the point falls near/within.
  // thresh: mouse ≈ 8, touch ≈ 24 (fingers are imprecise).
  // For rotated shapes, the test point is un-rotated into shape-local space.
  function hitTest(pt, shapeList, thresh = 8) {
    const ps = viewBox.w / (svgSizeRef.current.w || viewBox.w);
    for (let i = shapeList.length - 1; i >= 0; i--) {
      const s = shapeList[i];
      // Un-rotate the test point into the shape's local (unrotated) space
      const rot = s._rot || 0;
      const tp = rot ? (() => {
        const piv = getShapePivot(s);
        return rotatePoint(pt.x, pt.y, piv.x, piv.y, -rot);
      })() : pt;

      if (s.type === 'line') {
        if (distToSegment(tp, {x:s.x1,y:s.y1}, {x:s.x2,y:s.y2}) < thresh) return s;
      } else if (s.type === 'curve') {
        const { px: cpx, py: cpy } = getCurvePI(s);
        const carc = computeArcFromPI(s.x1, s.y1, s.x2, s.y2, cpx, cpy);
        if (carc) {
          const { cx, cy, R } = carc;
          // Quick pre-filter: skip if tp is nowhere near the circle ring
          const dtc = Math.hypot(tp.x - cx, tp.y - cy);
          if (Math.abs(dtc - R) < thresh * 4) {
            // Fine test: is tp within thresh of the arc radius?
            if (Math.abs(dtc - R) < thresh) {
              // Verify tp falls on the drawn arc segment (BC→EC in the correct sweep direction)
              // Sweep direction is determined by which side of BC→EC the PI is on.
              const cross = (cpx - s.x1) * (s.y2 - s.y1) - (cpy - s.y1) * (s.x2 - s.x1);
              // sweepCW = true means SVG sweep=1 (positive-angle / CW on screen)
              // matches the corrected arcPath convention: cross > 0 → sweep=1
              const sweepCW = cross > 0;
              const angA = Math.atan2(s.y1  - cy, s.x1  - cx);
              const angB = Math.atan2(s.y2  - cy, s.x2  - cx);
              const angP = Math.atan2(tp.y  - cy, tp.x  - cx);
              // Normalise: how far along the arc (in the sweep direction) is each angle?
              // sweepCW (increasing theta): distance = (a - angA) mod 2π
              // !sweepCW (decreasing theta): distance = (angA - a) mod 2π
              const norm = sweepCW
                ? a => { let r = a - angA; while (r < 0) r += 2*Math.PI; return r; }
                : a => { let r = angA - a; while (r < 0) r += 2*Math.PI; return r; };
              const nB = norm(angB), nP = norm(angP);
              if (nP <= nB + 1e-6) return s;
            }
          }
        } else {
          if (distToSegment(tp, {x:s.x1,y:s.y1}, {x:s.x2,y:s.y2}) < thresh) return s;
        }
      } else if (s.type === 'circle') {
        const d = Math.hypot(tp.x-s.cx, tp.y-s.cy);
        const hasFillC = s.fill && s.fill !== 'none';
        if (hasFillC ? d < s.r + thresh : Math.abs(d - s.r) < thresh) return s;
      } else if (s.type === 'rect') {
        const hasFillR = s.fill && s.fill !== 'none';
        const inX = tp.x >= s.x - thresh && tp.x <= s.x + s.w + thresh;
        const inY = tp.y >= s.y - thresh && tp.y <= s.y + s.h + thresh;
        if (inX && inY) {
          if (hasFillR) {
            return s;
          } else {
            // Only hit near the border lines
            const nearLeft   = tp.x <= s.x + thresh;
            const nearRight  = tp.x >= s.x + s.w - thresh;
            const nearTop    = tp.y <= s.y + thresh;
            const nearBottom = tp.y >= s.y + s.h - thresh;
            if (nearLeft || nearRight || nearTop || nearBottom) return s;
          }
        }
      } else if (s.type === 'text') {
        // s.x/y = world center; s.w/h = screen pixels. Convert half-extents to world units.
        const _psHT = viewBox.w / (svgSizeRef.current.w || viewBox.w);
        const hwHT  = (s.w || 180) * _psHT / 2;
        const hhHT  = (s.h ||  80) * _psHT / 2;
        if (tp.x >= s.x - hwHT - thresh && tp.x <= s.x + hwHT + thresh &&
            tp.y >= s.y - hhHT - thresh && tp.y <= s.y + hhHT + thresh) return s;
      } else if (s.type === 'path' && s.nodes && s.nodes.length >= 2) {
        // Hit-test each cubic Bezier segment of the path
        const nodes = s.nodes;
        for (let i = 0; i < nodes.length - 1; i++) {
          const n0 = nodes[i], n1 = nodes[i + 1];
          const nearest = nearestOnCubic(
            { x: n0.x, y: n0.y },
            { x: n0.cp2x !== undefined ? n0.cp2x : n0.x, y: n0.cp2y !== undefined ? n0.cp2y : n0.y },
            { x: n1.cp1x !== undefined ? n1.cp1x : n1.x, y: n1.cp1y !== undefined ? n1.cp1y : n1.y },
            { x: n1.x, y: n1.y },
            tp
          );
          if (Math.hypot(nearest.x - tp.x, nearest.y - tp.y) < thresh) return s;
        }
        // Closing segment for closed paths
        if (s.closed && nodes.length >= 2) {
          const n0 = nodes[nodes.length - 1], n1 = nodes[0];
          const nearest = nearestOnCubic(
            { x: n0.x, y: n0.y },
            { x: n0.cp2x !== undefined ? n0.cp2x : n0.x, y: n0.cp2y !== undefined ? n0.cp2y : n0.y },
            { x: n1.cp1x !== undefined ? n1.cp1x : n1.x, y: n1.cp1y !== undefined ? n1.cp1y : n1.y },
            { x: n1.x, y: n1.y },
            tp
          );
          if (Math.hypot(nearest.x - tp.x, nearest.y - tp.y) < thresh) return s;
        }
        // For closed paths with a visible fill, also hit-test the interior area.
        // Uses ray-casting against the node polygon (ignores Bezier bulge, which is
        // fine for selection — the visual and interactive areas are essentially the same).
        if (s.closed && s.fill && s.fill !== 'none' && nodes.length >= 3) {
          let inside = false;
          const nv = nodes.length;
          for (let ci = 0, cj = nv - 1; ci < nv; cj = ci++) {
            const xi = nodes[ci].x, yi = nodes[ci].y;
            const xj = nodes[cj].x, yj = nodes[cj].y;
            if (((yi > tp.y) !== (yj > tp.y)) &&
                tp.x < (xj - xi) * (tp.y - yi) / (yj - yi) + xi) {
              inside = !inside;
            }
          }
          if (inside) return s;
        }
      } else if (s.type === 'dim-linear') {
        // Hit the dimension line (the offset line parallel to P1→P2)
        const { p1, p2 } = s;
        const off = s.offset || 0;
        const len = Math.hypot(p2.x-p1.x, p2.y-p1.y);
        if (len < 1) continue;
        const perpX = -(p2.y-p1.y)/len, perpY = (p2.x-p1.x)/len;
        const dp1 = { x: p1.x + perpX*off, y: p1.y + perpY*off };
        const dp2 = { x: p2.x + perpX*off, y: p2.y + perpY*off };
        if (distToSegment(tp, dp1, dp2) < thresh) return s;
      } else if (s.type === 'dim-angle') {
        const l1 = shapes.find(sh => sh.id === s.line1Id && sh.type === 'line');
        const l2 = shapes.find(sh => sh.id === s.line2Id && sh.type === 'line');
        if (!l1 || !l2) continue;
        const inter = lineIntersection(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2);
        if (!inter) continue;
        const arcR = (s.scale || 1.0) * 40 * ps;
        if (Math.abs(Math.hypot(tp.x-inter.x, tp.y-inter.y) - arcR) < thresh * 2) return s;
      } else if (s.type === 'dim-bearing') {
        if (!s.p1 || !s.p2) continue;
        if (distToSegment(tp, s.p1, s.p2) < thresh * 2) return s;
      } else if (s.type === 'dim-radius') {
        const ref = shapes.find(sh => sh.id === s.shapeId);
        if (!ref) continue;
        const off = s.offset || { x: 0, y: 0 };
        const cx = ref.type === 'circle' ? ref.cx : (ref.x1+ref.x2)/2;
        const cy = ref.type === 'circle' ? ref.cy : (ref.y1+ref.y2)/2;
        const tx = cx + off.x, ty = cy + off.y;
        if (distToSegment(tp, { x: cx, y: cy }, { x: tx, y: ty }) < thresh) return s;
      }
    }
    return null;
  }

  function distToSegment(p, a, b) {
    const dx = b.x-a.x, dy = b.y-a.y;
    const lenSq = dx*dx + dy*dy;
    if (lenSq === 0) return Math.hypot(p.x-a.x, p.y-a.y);
    const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy) / lenSq));
    return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
  }

  // Returns true if shape's axis-aligned bounding box overlaps [rx1,rx2] × [ry1,ry2].
  // Used for marquee/lasso selection.
  function shapeIntersectsRect(s, rx1, ry1, rx2, ry2) {
    const ps = viewBox.w / (svgSizeRef.current.w || viewBox.w);
    let minX, maxX, minY, maxY;
    switch (s.type) {
      case 'line':
        minX=Math.min(s.x1,s.x2); maxX=Math.max(s.x1,s.x2);
        minY=Math.min(s.y1,s.y2); maxY=Math.max(s.y1,s.y2); break;
      case 'circle':
        minX=s.cx-s.r; maxX=s.cx+s.r; minY=s.cy-s.r; maxY=s.cy+s.r; break;
      case 'rect':
        minX=s.x; maxX=s.x+s.w; minY=s.y; maxY=s.y+s.h; break;
      case 'curve': {
        const { px: cpx, py: cpy } = getCurvePI(s);
        minX=Math.min(s.x1,s.x2,cpx); maxX=Math.max(s.x1,s.x2,cpx);
        minY=Math.min(s.y1,s.y2,cpy); maxY=Math.max(s.y1,s.y2,cpy); break;
      }
      case 'text': {
        const hw=(s.w||180)*ps/2, hh=(s.h||80)*ps/2;
        minX=s.x-hw; maxX=s.x+hw; minY=s.y-hh; maxY=s.y+hh; break;
      }
      case 'path':
        if (!s.nodes || !s.nodes.length) return false;
        minX=Math.min(...s.nodes.map(n=>n.x)); maxX=Math.max(...s.nodes.map(n=>n.x));
        minY=Math.min(...s.nodes.map(n=>n.y)); maxY=Math.max(...s.nodes.map(n=>n.y)); break;
      case 'dim-linear':
        minX=Math.min(s.p1.x,s.p2.x); maxX=Math.max(s.p1.x,s.p2.x);
        minY=Math.min(s.p1.y,s.p2.y); maxY=Math.max(s.p1.y,s.p2.y); break;
      case 'dim-bearing': {
        const _ln=shapes.find(sh=>sh.id===s.lineId); if(!_ln) return false;
        const _ox=s.offset?.x||0, _oy=s.offset?.y||0;
        minX=Math.min(_ln.x1,_ln.x2,(_ln.x1+_ln.x2)/2+_ox); maxX=Math.max(_ln.x1,_ln.x2,(_ln.x1+_ln.x2)/2+_ox);
        minY=Math.min(_ln.y1,_ln.y2,(_ln.y1+_ln.y2)/2+_oy); maxY=Math.max(_ln.y1,_ln.y2,(_ln.y1+_ln.y2)/2+_oy); break;
      }
      case 'dim-radius': {
        const _ref=shapes.find(sh=>sh.id===s.shapeId); if(!_ref) return false;
        const _rcx=_ref.type==='circle'?_ref.cx:(_ref.x1+_ref.x2)/2;
        const _rcy=_ref.type==='circle'?_ref.cy:(_ref.y1+_ref.y2)/2;
        minX=Math.min(_rcx,_rcx+(s.offset?.x||0)); maxX=Math.max(_rcx,_rcx+(s.offset?.x||0));
        minY=Math.min(_rcy,_rcy+(s.offset?.y||0)); maxY=Math.max(_rcy,_rcy+(s.offset?.y||0)); break;
      }
      case 'dim-angle': return false; // no simple AABB for a referenced angle arc
      default: return false;
    }
    return minX <= rx2 && maxX >= rx1 && minY <= ry2 && maxY >= ry1;
  }

  // ── Snap Engine (Phase 5) ────────────────────────────────────────────────
  // Snap radius: 14 screen pixels, converted to world units at current zoom.
  const SNAP_R_PX = 14;

  // Endpoint candidates for a shape (rotation-aware).
  // Lines/curves: BC + EC. Circles: centre. Rects: 4 corners. Text: top-left.
  function getSnapPoints(shape) {
    const rot = shape._rot || 0;
    const piv = getShapePivot(shape);
    let raw = [];
    switch (shape.type) {
      case 'line':   raw = [{x:shape.x1,y:shape.y1},{x:shape.x2,y:shape.y2}]; break;
      case 'curve':  raw = [{x:shape.x1,y:shape.y1},{x:shape.x2,y:shape.y2}]; break;
      case 'circle': raw = [{x:shape.cx,y:shape.cy}]; break;
      case 'rect':   raw = [
        {x:shape.x,         y:shape.y},
        {x:shape.x+shape.w, y:shape.y},
        {x:shape.x,         y:shape.y+shape.h},
        {x:shape.x+shape.w, y:shape.y+shape.h},
      ]; break;
      case 'text': {
        // s.x/y = center; s.w/h = screen pixels
        const _psGS = viewBox.w / (svgSizeRef.current.w || viewBox.w);
        const hwGS = (shape.w || 180) * _psGS / 2;
        const hhGS = (shape.h ||  80) * _psGS / 2;
        raw = [
          { x: shape.x - hwGS, y: shape.y - hhGS },
          { x: shape.x + hwGS, y: shape.y - hhGS },
          { x: shape.x - hwGS, y: shape.y + hhGS },
          { x: shape.x + hwGS, y: shape.y + hhGS },
        ];
        break;
      }
      case 'path': {
        // Every node of the path is a snap endpoint
        raw = (shape.nodes || []).map(n => ({ x: n.x, y: n.y }));
        break;
      }
    }
    if (!rot) return raw;
    return raw.map(p => rotatePoint(p.x, p.y, piv.x, piv.y, rot));
  }

  // Extract line segments from a shape (for intersection + perpendicular snaps).
  function getSegments(s) {
    const rot = s._rot || 0;
    const piv = getShapePivot(s);
    const rp = (x, y) => rot ? rotatePoint(x, y, piv.x, piv.y, rot) : { x, y };
    switch (s.type) {
      case 'line': return [{ a: rp(s.x1,s.y1), b: rp(s.x2,s.y2) }];
      case 'rect': {
        const { x, y, w, h } = s;
        return [
          { a: rp(x,   y),   b: rp(x+w, y) },
          { a: rp(x+w, y),   b: rp(x+w, y+h) },
          { a: rp(x+w, y+h), b: rp(x,   y+h) },
          { a: rp(x,   y+h), b: rp(x,   y) },
        ];
      }
      case 'path': {
        // Approximate each bezier segment as a straight node-to-node line for
        // perpendicular and intersection snapping. Good enough for field use.
        if (!s.nodes || s.nodes.length < 2) return [];
        const segs = [];
        const nodes = s.nodes;
        for (let i = 0; i < nodes.length - 1; i++) {
          segs.push({ a: rp(nodes[i].x, nodes[i].y), b: rp(nodes[i+1].x, nodes[i+1].y) });
        }
        if (s.closed && nodes.length >= 2) {
          segs.push({ a: rp(nodes[nodes.length-1].x, nodes[nodes.length-1].y), b: rp(nodes[0].x, nodes[0].y) });
        }
        return segs;
      }
      default: return [];
    }
  }

  // Segment / segment intersection. Allows 5% extension to catch near-end hits.
  function segIntersect(p1, p2, p3, p4) {
    const d1x = p2.x-p1.x, d1y = p2.y-p1.y;
    const d2x = p4.x-p3.x, d2y = p4.y-p3.y;
    const cross = d1x*d2y - d1y*d2x;
    if (Math.abs(cross) < 1e-8) return null;
    const t = ((p3.x-p1.x)*d2y - (p3.y-p1.y)*d2x) / cross;
    const u = ((p3.x-p1.x)*d1y - (p3.y-p1.y)*d1x) / cross;
    const ext = 0.05;
    if (t < -ext || t > 1+ext || u < -ext || u > 1+ext) return null;
    return { x: p1.x + t*d1x, y: p1.y + t*d1y };
  }

  // Line segment / circle intersection. Returns 0–2 points.
  function lineCircleIntersect(p1, p2, cx, cy, r) {
    const dx = p2.x-p1.x, dy = p2.y-p1.y;
    const fx = p1.x-cx,   fy = p1.y-cy;
    const a = dx*dx + dy*dy;
    if (a < 1e-10) return [];
    const b = 2*(fx*dx + fy*dy);
    const c = fx*fx + fy*fy - r*r;
    const disc = b*b - 4*a*c;
    if (disc < 0) return [];
    const sq = Math.sqrt(disc);
    const pts = [];
    for (const sign of [-1, 1]) {
      const t = (-b + sign*sq) / (2*a);
      if (t >= -0.05 && t <= 1.05) pts.push({ x: p1.x+t*dx, y: p1.y+t*dy });
    }
    return pts;
  }

  // Perpendicular foot from point pt onto segment a→b. Returns null if degenerate.
  function perpFoot(pt, a, b) {
    const dx = b.x-a.x, dy = b.y-a.y;
    const lenSq = dx*dx + dy*dy;
    if (lenSq < 1e-8) return null;
    const t = Math.max(0, Math.min(1, ((pt.x-a.x)*dx + (pt.y-a.y)*dy) / lenSq));
    return { x: a.x+t*dx, y: a.y+t*dy };
  }

  // Direction from an intersection point INTO the body of line segment (lx1,ly1)→(lx2,ly2).
  // Uses the projection parameter t to decide which endpoint is "near" the intersection,
  // then points toward the far endpoint so the arm always lies inside the segment.
  function dimAngleArm(lx1, ly1, lx2, ly2, px, py) {
    const dx = lx2 - lx1, dy = ly2 - ly1;
    const lenSq = dx*dx + dy*dy || 1;
    const t = ((px - lx1)*dx + (py - ly1)*dy) / lenSq;
    // t ≤ 0.5 → intersection is in the first half → arm points toward endpoint 2
    return t <= 0.5 ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx);
  }

  // Tangent points from external point pt to a circle {cx, cy, r}.
  // Returns 0, 1, or 2 points where a line from pt is tangent to the circle.
  function getTangentPoints(pt, circle) {
    const dx = pt.x - circle.cx;
    const dy = pt.y - circle.cy;
    const distSq = dx*dx + dy*dy;
    const rSq = circle.r * circle.r;
    if (distSq < rSq - 1e-8) return []; // pt is inside circle
    if (distSq < 1e-8) return []; // pt is at centre
    const dist = Math.sqrt(distSq);
    if (dist <= circle.r) return []; // on or inside circle boundary
    // Angle from pt→centre to the tangent line
    const alpha = Math.asin(Math.min(1, circle.r / dist));
    // Angle of the pt→centre direction
    const theta = Math.atan2(circle.cy - pt.y, circle.cx - pt.x);
    // The two tangent points lie on the circle at angles (theta ± (π/2 - alpha)) from centre
    const phi = Math.PI / 2 - alpha;
    return [
      { x: circle.cx + circle.r * Math.cos(theta + phi + Math.PI), y: circle.cy + circle.r * Math.sin(theta + phi + Math.PI) },
      { x: circle.cx + circle.r * Math.cos(theta - phi + Math.PI), y: circle.cy + circle.r * Math.sin(theta - phi + Math.PI) },
    ];
  }

  // Returns the nearest point(s) on a shape's actual geometry (edges/arcs).
  // Used by "On Object" snap — lets endpoints snap anywhere along a line, arc, circle, or rect edge.
  function nearestOnShape(pt, s) {
    const rot = s._rot || 0;
    const piv = getShapePivot(s);
    const rp  = (x, y) => rot ? rotatePoint(x, y, piv.x, piv.y, rot) : { x, y };
    const pts = [];
    if (s.type === 'line') {
      const f = perpFoot(pt, rp(s.x1, s.y1), rp(s.x2, s.y2));
      if (f) pts.push(f);
    } else if (s.type === 'rect') {
      const { x, y, w, h } = s;
      const corners = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
      for (let i = 0; i < 4; i++) {
        const a = rp(corners[i][0], corners[i][1]);
        const b = rp(corners[(i+1)%4][0], corners[(i+1)%4][1]);
        const f = perpFoot(pt, a, b);
        if (f) pts.push(f);
      }
    } else if (s.type === 'circle') {
      const dx = pt.x - s.cx, dy = pt.y - s.cy;
      const d  = Math.hypot(dx, dy);
      if (d > 1e-6) pts.push({ x: s.cx + (dx/d)*s.r, y: s.cy + (dy/d)*s.r });
    } else if (s.type === 'curve') {
      const cp = computeArcFromPI(s.x1, s.y1, s.x2, s.y2, s.px, s.py);
      if (cp) {
        const dx = pt.x - cp.cx, dy = pt.y - cp.cy;
        const d  = Math.hypot(dx, dy);
        if (d > 1e-6) {
          const projected = { x: cp.cx + (dx/d)*cp.R, y: cp.cy + (dy/d)*cp.R };
          // Only include if projected point lies within the arc's actual sweep
          const cross   = (s.px - s.x1)*(s.y2 - s.y1) - (s.py - s.y1)*(s.x2 - s.x1);
          const sweepCW = cross > 0;
          const norm    = a => ((a % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
          const angA    = Math.atan2(s.y1 - cp.cy, s.x1 - cp.cx);
          const angB    = Math.atan2(s.y2 - cp.cy, s.x2 - cp.cx);
          const angP    = Math.atan2(dy, dx);
          const nP      = sweepCW ? norm(angP - angA) : norm(angA - angP);
          const nB      = sweepCW ? norm(angB - angA) : norm(angA - angB);
          if (nP <= nB + 1e-6) pts.push(projected);
        }
      }
    } else if (s.type === 'path') {
      // Find nearest point on each cubic bezier segment of the path
      if (s.nodes && s.nodes.length >= 2) {
        const nodes = s.nodes;
        const nearestOnSeg = (n0, n1) => {
          // Rotate node coords into world space (same transform applied to path group)
          const a0 = rp(n0.x, n0.y);
          const c0 = rp(n0.cp2x !== undefined ? n0.cp2x : n0.x, n0.cp2y !== undefined ? n0.cp2y : n0.y);
          const c1 = rp(n1.cp1x !== undefined ? n1.cp1x : n1.x, n1.cp1y !== undefined ? n1.cp1y : n1.y);
          const a1 = rp(n1.x, n1.y);
          return nearestOnCubic(a0, c0, c1, a1, pt);
        };
        for (let i = 0; i < nodes.length - 1; i++) {
          pts.push(nearestOnSeg(nodes[i], nodes[i+1]));
        }
        if (s.closed && nodes.length >= 2) {
          pts.push(nearestOnSeg(nodes[nodes.length-1], nodes[0]));
        }
      }
    }
    return pts;
  }

  // Collect snap candidates around `pt` — pure, no state side-effects.
  // Used by resolveSnap (drawing/node-drag) and body-drag snap.
  // Each type has a different effective snap radius — endpoint has the
  // largest "pull" (reaches out 14 screen px) while On Object only fires
  // within ~7 screen px. This gives endpoint priority over close-but-not-
  // endpoint snaps and makes the system feel right in the field.
  function collectSnapCandidates(pt, drawingFrom = null, excludeId = null) {
    const ps = viewBox.w / (svgSizeRef.current.w || viewBox.w);
    // Per-type snap radii (in world units). Larger = stronger pull.
    const SR = {
      endpoint:      SNAP_R_PX        * ps,   // 14px — strongest
      midpoint:      SNAP_R_PX * 0.75 * ps,   // ~10.5px
      intersection:  SNAP_R_PX * 0.50 * ps,   // ~7px  — weakest (on-object)
      perpendicular: SNAP_R_PX * 0.70 * ps,   // ~10px
      tangent:       SNAP_R_PX * 0.70 * ps,   // ~10px
      grid:          SNAP_R_PX * 0.65 * ps,   // ~9px
    };
    const candidates = [];

    const visibleShapes = shapes.filter(s => {
      const layer = layers.find(l => l.id === (s.layerId || layers[0]?.id));
      return layer?.visible !== false;
    });

    // ── 1. Endpoint ────────────────────────────────────────────────────────
    if (snapModes.endpoint) {
      for (const s of visibleShapes) {
        if (s.id === excludeId) continue;
        for (const sp of getSnapPoints(s)) {
          const d = Math.hypot(pt.x-sp.x, pt.y-sp.y);
          if (d < SR.endpoint) candidates.push({ pt: sp, dist: d, type: 'endpoint' });
        }
      }
    }

    // ── 2. Midpoint ────────────────────────────────────────────────────────
    if (snapModes.midpoint) {
      for (const s of visibleShapes) {
        if (s.id === excludeId) continue;
        const rot = s._rot || 0;
        const piv = getShapePivot(s);
        const rp  = (x, y) => rot ? rotatePoint(x, y, piv.x, piv.y, rot) : { x, y };
        let mids = [];
        if (s.type === 'line') {
          mids = [rp((s.x1+s.x2)/2, (s.y1+s.y2)/2)];
        } else if (s.type === 'curve') {
          const cp = computeArcFromPI(s.x1, s.y1, s.x2, s.y2, s.px, s.py);
          if (cp) {
            const mx = (s.x1+s.x2)/2, my = (s.y1+s.y2)/2;
            const pi = getCurvePI(s);
            const ux = pi.px-mx, uy = pi.py-my;
            const uLen = Math.hypot(ux, uy) || 1;
            mids = [{ x: mx+(ux/uLen)*cp.M, y: my+(uy/uLen)*cp.M }];
          }
        } else if (s.type === 'rect') {
          const { x, y, w, h } = s;
          mids = [rp(x+w/2,y), rp(x+w,y+h/2), rp(x+w/2,y+h), rp(x,y+h/2)];
        } else if (s.type === 'path' && s.nodes && s.nodes.length >= 2) {
          // Midpoint of each bezier segment at t=0.5
          const nodes = s.nodes;
          const cubicMid = (n0, n1) => {
            const cp2x = n0.cp2x !== undefined ? n0.cp2x : n0.x;
            const cp2y = n0.cp2y !== undefined ? n0.cp2y : n0.y;
            const cp1x = n1.cp1x !== undefined ? n1.cp1x : n1.x;
            const cp1y = n1.cp1y !== undefined ? n1.cp1y : n1.y;
            // Cubic bezier at t=0.5
            return rp(
              0.125*n0.x + 0.375*cp2x + 0.375*cp1x + 0.125*n1.x,
              0.125*n0.y + 0.375*cp2y + 0.375*cp1y + 0.125*n1.y
            );
          };
          for (let i = 0; i < nodes.length - 1; i++) {
            mids.push(cubicMid(nodes[i], nodes[i+1]));
          }
          if (s.closed && nodes.length >= 2) {
            mids.push(cubicMid(nodes[nodes.length-1], nodes[0]));
          }
        }
        for (const m of mids) {
          const d = Math.hypot(pt.x-m.x, pt.y-m.y);
          if (d < SR.midpoint) candidates.push({ pt: m, dist: d, type: 'midpoint' });
        }
      }
    }

    // ── 3. On Object (nearest point on shape geometry) ─────────────────────
    // Lets an endpoint snap to ANY position along a line, arc, circle, or rect edge.
    if (snapModes.intersection) {
      for (const s of visibleShapes) {
        if (s.id === excludeId) continue;
        for (const np of nearestOnShape(pt, s)) {
          const d = Math.hypot(pt.x-np.x, pt.y-np.y);
          if (d < SR.intersection) candidates.push({ pt: np, dist: d, type: 'intersection' });
        }
      }
    }

    // ── 4. Perpendicular ───────────────────────────────────────────────────
    if (snapModes.perpendicular && drawingFrom) {
      for (const s of visibleShapes) {
        for (const seg of getSegments(s)) {
          const foot = perpFoot(drawingFrom, seg.a, seg.b);
          if (!foot) continue;
          const d = Math.hypot(pt.x-foot.x, pt.y-foot.y);
          if (d < SR.perpendicular) candidates.push({ pt: foot, dist: d, type: 'perpendicular' });
        }
      }
    }

    // ── 5. Tangent ─────────────────────────────────────────────────────────
    if (snapModes.tangent && drawingFrom) {
      for (const s of visibleShapes) {
        if (s.type !== 'circle') continue;
        for (const tp of getTangentPoints(drawingFrom, s)) {
          const d = Math.hypot(pt.x-tp.x, pt.y-tp.y);
          if (d < SR.tangent) candidates.push({ pt: tp, dist: d, type: 'tangent' });
        }
      }
    }

    // ── 6. Grid ────────────────────────────────────────────────────────────
    if (snapModes.grid) {
      const containerW = svgSizeRef.current.w || viewBox.w;
      const majorPx = realToPx(niceScaleBarValue(scaleDenom, viewBox.w, containerW, units), scaleDenom, units);
      const minorPx = majorPx / 5;
      if (minorPx > 0) {
        const gp = {
          x: Math.round(pt.x / minorPx) * minorPx,
          y: Math.round(pt.y / minorPx) * minorPx,
        };
        const d = Math.hypot(pt.x-gp.x, pt.y-gp.y);
        if (d < SR.grid) candidates.push({ pt: gp, dist: d, type: 'grid' });
      }
    }

    const PRIORITY = { endpoint: 0, midpoint: 1, intersection: 2, perpendicular: 3, tangent: 3, grid: 4 };
    candidates.sort((a, b) => a.dist - b.dist || PRIORITY[a.type] - PRIORITY[b.type]);
    return candidates;
  }

  // Master snap resolver — sets snapPoint state and returns snapped world pt.
  // drawingFrom: start of active drawing segment (enables perpendicular snap).
  // excludeId:   skip this shape's own nodes (prevents self-snap on drag).
  function resolveSnap(pt, drawingFrom = null, excludeId = null) {
    const candidates = collectSnapCandidates(pt, drawingFrom, excludeId);
    const best = candidates[0] || null;
    setSnapPoint(best ? { x: best.pt.x, y: best.pt.y, type: best.type } : null);
    return best ? best.pt : pt;
  }

  // ── Layer management ───────────────────────────────────────────────────────
  function addLayer() {
    const id = 'l_' + Date.now();
    const name = `Layer ${layers.length + 1}`;
    const next = [...layers, { id, name, visible: true }];
    setLayers(next);
    setActiveLayerId(id);
    persist(undefined, undefined, next);
  }

  function toggleLayerVisibility(layerId) {
    const next = layers.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l);
    setLayers(next);
    persist(undefined, undefined, next);
  }

  // dir: +1 moves toward top (higher render order), -1 toward bottom
  function moveLayer(layerId, dir) {
    const idx = layers.findIndex(l => l.id === layerId);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= layers.length) return;
    const next = [...layers];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setLayers(next);
    persist(undefined, undefined, next);
  }

  function reorderLayer(layerId, fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    const next = [...layers];
    const [mv] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, mv);
    setLayers(next);
    persist(undefined, undefined, next);
  }

  function reorderShapeInLayer(shapeId, fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    const sh = shapes.find(s => s.id === shapeId);
    if (!sh) return;
    const lid = sh.layerId || layers[0]?.id;
    const lSh = shapes.filter(s => (s.layerId || layers[0]?.id) === lid);
    if (fromIdx < 0 || fromIdx >= lSh.length || toIdx < 0 || toIdx >= lSh.length) return;
    const reordered = [...lSh];
    const [mv] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, mv);
    let li = 0;
    commitShapes(shapes.map(s => (s.layerId || layers[0]?.id) === lid ? reordered[li++] : s));
  }

  function toggleShapeVisible(shapeId) {
    commitShapes(shapes.map(s => s.id === shapeId
      ? { ...s, visible: s.visible === false ? undefined : false } : s));
  }

  function toggleLayerLocked(layerId) {
    const next = layers.map(l => l.id === layerId ? { ...l, locked: !l.locked } : l);
    setLayers(next);
    persist(undefined, undefined, next);
  }

  function toggleShapeLocked(shapeId) {
    commitShapes(shapes.map(s => s.id === shapeId
      ? { ...s, locked: s.locked ? undefined : true } : s));
  }

  // Panel drag: document-level listeners while a drag is in progress
  useEffect(() => {
    if (!panelDrag) return;
    const ROW_H = panelDrag.type === 'layer' ? 28 : 22;
    const maxIdx = panelDrag.type === 'layer'
      ? layers.length - 1 : (panelDrag.layerShapeCount || 1) - 1;
    const startY = panelDrag.startY;
    const origIdx = panelDrag.origIdx;
    function onMove(e) {
      const dy = e.clientY - startY;
      const steps = -Math.round(dy / ROW_H);
      const newTgt = Math.max(0, Math.min(maxIdx, origIdx + steps));
      setPanelDrag(d => d ? { ...d, targetIdx: newTgt } : null);
    }
    function onUp() {
      setPanelDrag(d => {
        if (!d) return null;
        if (d.targetIdx !== d.origIdx) {
          if (d.type === 'layer') reorderLayer(d.id, d.origIdx, d.targetIdx);
          else reorderShapeInLayer(d.id, d.origIdx, d.targetIdx);
        }
        return null;
      });
      if (panelDragTimerRef.current) { clearTimeout(panelDragTimerRef.current); panelDragTimerRef.current = null; }
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
  }, [!!panelDrag, panelDrag?.id]);

  // ── Text commit ────────────────────────────────────────────────────────────
  function commitText() {
    if (!textEdit) return;
    if (textEdit.content.trim()) {
      commitShapes([...shapes, { id: textEdit.id, type: 'text',
        x: textEdit.x, y: textEdit.y,
        w: textEdit.w || 180, h: textEdit.h || 80,
        content: textEdit.content, stroke: activeStrokeColor,
        layerId: textEdit.layerId || activeLayerId }]);
    }
    setTextEdit(null);
  }

  // ── Double-click: edit existing text shape ─────────────────────────────────
  function onDblClick(e) {
    const pt  = screenToWorld(e);
    const ps  = viewBox.w / (svgSizeRef.current.w || viewBox.w);
    const hit = hitTest(pt, shapes, 8 * ps);
    if (hit && hit.type === 'text') {
      setTextEdit({ id: hit.id, x: hit.x, y: hit.y, w: hit.w, h: hit.h || 80, content: hit.content, editing: true });
      commitShapes(shapes.filter(s => s.id !== hit.id));
      return;
    }

    // Pen tool: double-click commits the open path (without closing it)
    if (tool === 'pen' && penNodes.length >= 2) {
      commitPenPath(false);
      return;
    }

    // Node tool: double-click on a path segment inserts a node.
    // Works whether the path is already selected or not (first double-click on a path).
    if (tool === 'node') {
      let pathShape = nodeSelectedId ? shapes.find(s => s.id === nodeSelectedId) : null;
      // Hit-test fallback for first double-click on an unselected path
      if (!pathShape) {
        const hitThreshDbl = (e.pointerType === 'touch' ? 24 : 8) * ps;
        pathShape = hitTest(pt, shapes.filter(s => s.type === 'path'), hitThreshDbl) || null;
        if (pathShape) {
          setNodeSelectedId(pathShape.id);
          setNodeSelectedIdx(null);
        }
      }
      if (pathShape && pathShape.nodes) {
        const nodes = pathShape.nodes;
        for (let i = 0; i < nodes.length - 1; i++) {
          const n0 = nodes[i], n1 = nodes[i + 1];
          const nearest = nearestOnCubic(
            { x: n0.x, y: n0.y },
            { x: n0.cp2x !== undefined ? n0.cp2x : n0.x, y: n0.cp2y !== undefined ? n0.cp2y : n0.y },
            { x: n1.cp1x !== undefined ? n1.cp1x : n1.x, y: n1.cp1y !== undefined ? n1.cp1y : n1.y },
            { x: n1.x, y: n1.y },
            pt
          );
          if (Math.hypot(nearest.x - pt.x, nearest.y - pt.y) < 12 * ps) {
            const newNode = {
              x: nearest.x, y: nearest.y, type: 'smooth',
              cp1x: nearest.x, cp1y: nearest.y,
              cp2x: nearest.x, cp2y: nearest.y,
            };
            const newNodes = [
              ...nodes.slice(0, i + 1),
              newNode,
              ...nodes.slice(i + 1),
            ];
            applySmartHandles(newNodes);
            commitShapes(shapes.map(s =>
              s.id === pathShape.id ? { ...s, nodes: newNodes } : s
            ));
            setNodeSelectedIdx(i + 1);
            return;
          }
        }
      }
    }

    // Node tool: double-click on a path shape to enter node editing
    if (tool === 'select' && hit && hit.type === 'path') {
      setTool('node');
      setNodeSelectedId(hit.id);
      setNodeSelectedIdx(null);
    }
  }

  // ── Zoom helpers ───────────────────────────────────────────────────────────
  // Returns the axis-aligned bounding box of a list of shapes (rotation-aware).
  function getBoundingBox(shapeList) {
    if (!shapeList.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const expand = (x, y) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    };
    for (const s of shapeList) {
      const rot = s._rot || 0;
      const piv = getShapePivot(s);
      const add = (x, y) => {
        const p = rot ? rotatePoint(x, y, piv.x, piv.y, rot) : { x, y };
        expand(p.x, p.y);
      };
      switch (s.type) {
        case 'line':   add(s.x1,s.y1); add(s.x2,s.y2); break;
        case 'curve': {
          const { px, py } = getCurvePI(s);
          add(s.x1,s.y1); add(s.x2,s.y2); add(px,py); break;
        }
        case 'circle':
          add(s.cx-s.r,s.cy); add(s.cx+s.r,s.cy);
          add(s.cx,s.cy-s.r); add(s.cx,s.cy+s.r); break;
        case 'rect':
          add(s.x,s.y); add(s.x+s.w,s.y);
          add(s.x,s.y+s.h); add(s.x+s.w,s.y+s.h); break;
        case 'text': {
          // s.x/y is the world-space center; s.w/h are screen pixels.
          // Convert to world units at current zoom for bounding box.
          const _bps = viewBox.w / (svgSizeRef.current.w || viewBox.w);
          const _bw  = (s.w || 180) * _bps / 2;
          const _bh  = (s.h ||  80) * _bps / 2;
          add(s.x - _bw, s.y - _bh); add(s.x + _bw, s.y + _bh); break;
        }
        case 'path':
          if (s.nodes) { for (const n of s.nodes) add(n.x, n.y); } break;
        case 'dim-linear':
          add(s.p1.x, s.p1.y); add(s.p2.x, s.p2.y); break;
        case 'dim-bearing':
          if (s.p1 && s.p2) { add(s.p1.x, s.p1.y); add(s.p2.x, s.p2.y); } break;
        case 'dim-radius': {
          const _bref = shapes.find(sh => sh.id === s.shapeId);
          if (_bref) {
            const _bcx = _bref.type === 'circle' ? _bref.cx : (_bref.x1+_bref.x2)/2;
            const _bcy = _bref.type === 'circle' ? _bref.cy : (_bref.y1+_bref.y2)/2;
            add(_bcx, _bcy);
            add(_bcx + (s.offset?.x||0), _bcy + (s.offset?.y||0));
          }
          break;
        }
        default: break;
      }
    }
    return minX <= maxX ? { minX, minY, maxX, maxY } : null;
  }

  // Zoom the view to fit all visible shapes with 12% padding on each side.
  function zoomToExtents() {
    const visible = shapes.filter(s => {
      const layer = layers.find(l => l.id === (s.layerId || layers[0]?.id));
      return layer?.visible !== false;
    });
    const bb = getBoundingBox(visible);
    if (!bb) return;
    const { w: sw, h: sh } = svgSizeRef.current;
    const aspect  = sw / sh;
    const PAD     = 0.12;  // 12% padding
    let vbW = (bb.maxX - bb.minX) * (1 + PAD * 2);
    let vbH = (bb.maxY - bb.minY) * (1 + PAD * 2);
    // Expand to match screen aspect ratio
    if (vbW / vbH > aspect) vbH = vbW / aspect;
    else                    vbW = vbH * aspect;
    vbW = Math.max(vbW, 100); vbH = Math.max(vbH, 100 / aspect);
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    setViewBox({ x: cx - vbW/2, y: cy - vbH/2, w: vbW, h: vbH });
  }

  // Reset zoom to 1:1 (100%) anchored at origin.
  function zoomReset() {
    const { w: sw, h: sh } = svgSizeRef.current;
    setViewBox({ x: 0, y: 0, w: sw, h: sh });
  }

  // ── Render a single shape ──────────────────────────────────────────────────
  // Always wrapped in a <g key={s.id}> so rotation transform can be applied.
  function renderShape(s, isSelected) {
    const sel = isSelected ? { filter: 'drop-shadow(0 0 3px rgba(59,130,246,0.7))' } : {};
    const rot = s._rot || 0;
    const piv = getShapePivot(s);
    const transform = rot ? `rotate(${rot},${piv.x},${piv.y})` : undefined;
    const ps  = viewBox.w / (svgSizeRef.current.w || viewBox.w);

    let inner = null;
    switch (s.type) {
      case 'line':
        inner = <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          stroke={s.stroke} strokeWidth={(s.strokeWidth || 1.5) * ps} strokeLinecap="round" style={sel} />;
        break;
      case 'curve': {
        const { px: rpx, py: rpy } = getCurvePI(s);
        inner = <path d={arcPath(s.x1, s.y1, s.x2, s.y2, rpx, rpy)}
          stroke={s.stroke} strokeWidth={(s.strokeWidth || 1.5) * ps} fill="none" strokeLinecap="round" style={sel} />;
        break;
      }
      case 'circle':
        inner = <circle cx={s.cx} cy={s.cy} r={s.r}
          stroke={s.stroke} strokeWidth={(s.strokeWidth || 1.5) * ps} fill={s.fill || 'none'} style={sel} />;
        break;
      case 'rect':
        inner = <rect x={s.x} y={s.y} width={s.w} height={s.h}
          stroke={s.stroke} strokeWidth={(s.strokeWidth || 1.5) * ps} fill={s.fill || 'none'} style={sel} />;
        break;
      case 'text': {
        // Text is rendered as counter-scaled SVG text elements so it stays the
        // same visual size on screen regardless of zoom — identical to dim labels.
        // The border box is in world coordinates (stays fixed to the drawing).
        const _tps      = viewBox.w / (svgSizeRef.current.w || viewBox.w);
        const tFontSize = 9.5 * _tps;               // counter-scaled: constant screen size
        const tLineH    = tFontSize * 1.55;
        // s.w / s.h are screen pixels — multiply by _tps to get world-space dimensions.
        // This makes the box counter-scale with zoom: same visual size at any zoom level.
        const swPx      = s.w || 180;               // screen-pixel width
        const shPx      = s.h || 80;                // screen-pixel height
        const tw        = swPx * _tps;              // world-space width
        const th        = shPx * _tps;              // world-space height
        // s.x / s.y is the world-space CENTER of the box; draw from top-left offset.
        const rx        = s.x - tw / 2;
        const ry        = s.y - th / 2;
        // maxChars is purely screen-space (screen px / screen char width) so wrap
        // stays identical regardless of zoom level.
        const charW     = 9.5 * 0.601;              // screen px per Courier New char
        const maxChars  = Math.max(1, Math.floor((swPx - 6) / charW));
        const lines     = wrapText(s.content || '', maxChars);
        inner = (
          <g style={sel}>
            {/* Border box — fully transparent bg; border only when selected */}
            <rect x={rx} y={ry} width={tw} height={th}
              fill="none"
              stroke={isSelected ? (s.stroke || STROKE) : 'none'}
              strokeWidth={0.7 * _tps}
              strokeDasharray={`${3.5*_tps},${2*_tps}`} />
            {/* Content lines — counter-scaled so font stays constant on screen */}
            {lines.map((line, i) => (
              <text key={i}
                x={rx + 3 * _tps}
                y={ry + tFontSize * 1.25 + i * tLineH}
                fontSize={tFontSize}
                fontFamily="Courier New, monospace"
                fill={s.stroke || STROKE}
                stroke="rgba(255,255,248,0.7)" strokeWidth={1.6 * _tps}
                paintOrder="stroke fill"
                style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {line || '\u00A0'}
              </text>
            ))}
          </g>
        );
        break;
      }
      case 'path': {
        if (!s.nodes || s.nodes.length < 2) return null;
        // Guard: skip rendering if any node coordinate is non-finite (prevents
        // a saved NaN value from crashing the entire render tree).
        const nodesOk = s.nodes.every(n =>
          isFinite(n.x) && isFinite(n.y) &&
          isFinite(n.cp1x ?? n.x) && isFinite(n.cp1y ?? n.y) &&
          isFinite(n.cp2x ?? n.x) && isFinite(n.cp2y ?? n.y)
        );
        if (!nodesOk) return null;
        let d;
        try { d = pathToSVGD(s.nodes, s.closed); } catch { return null; }
        if (!d) return null;
        inner = (
          <path
            d={d}
            stroke={s.stroke || STROKE}
            strokeWidth={(s.strokeWidth || STROKE_W) * ps}
            fill={s.fill || 'none'}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
        break;
      }
      // ── Dimension shapes (Phase 7) ──────────────────────────────────────────
      case 'dim-linear': {
        // Linear dimension: extension lines from P1/P2 to the offset dim line, arrowheads, label.
        const { p1, p2 } = s;
        const off = s.offset || 0;
        const len = Math.hypot(p2.x-p1.x, p2.y-p1.y);
        if (len < 1) return null;
        const perpX = -(p2.y-p1.y)/len, perpY = (p2.x-p1.x)/len;
        // Dim line endpoints
        const dp1x = p1.x + perpX*off, dp1y = p1.y + perpY*off;
        const dp2x = p2.x + perpX*off, dp2y = p2.y + perpY*off;
        const sw = 1.2 * ps;
        const gap = 3 * ps;    // gap from measurement point before ext line starts
        const ext = 6 * ps;    // ext line overshoot past the dim line
        // Direction along dim line (P1→P2)
        const udx = (p2.x-p1.x)/len, udy = (p2.y-p1.y)/len;
        // Open-tick arrowhead: V shape pointing inward
        const ah = 8 * ps, as = 3 * ps;
        const mkArrow = (ax, ay, dx, dy) =>
          `M ${ax-dx*ah*0.5+dy*as} ${ay-dy*ah*0.5-dx*as} L ${ax} ${ay} L ${ax-dx*ah*0.5-dy*as} ${ay-dy*ah*0.5+dx*as}`;
        inner = (
          <g style={sel}>
            {/* Extension line P1 side */}
            <line x1={p1.x+perpX*gap} y1={p1.y+perpY*gap}
                  x2={dp1x+perpX*ext} y2={dp1y+perpY*ext}
                  stroke={STROKE} strokeWidth={sw*0.75} strokeLinecap="round" />
            {/* Extension line P2 side */}
            <line x1={p2.x+perpX*gap} y1={p2.y+perpY*gap}
                  x2={dp2x+perpX*ext} y2={dp2y+perpY*ext}
                  stroke={STROKE} strokeWidth={sw*0.75} strokeLinecap="round" />
            {/* Dimension line */}
            <line x1={dp1x} y1={dp1y} x2={dp2x} y2={dp2y}
                  stroke={STROKE} strokeWidth={sw} strokeLinecap="round" />
            {/* Arrowhead at P1 end (pointing outward, away from P2) */}
            <path d={mkArrow(dp1x, dp1y, -udx, -udy)}
                  stroke={STROKE} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {/* Arrowhead at P2 end (pointing outward, away from P1) */}
            <path d={mkArrow(dp2x, dp2y, udx, udy)}
                  stroke={STROKE} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
        break;
      }
      case 'dim-angle': {
        // Angle dimension: arc at intersection of two referenced lines.
        // Respect both the master Dims toggle and per-shape _hideDims flag.
        if (!showDims || s._hideDims) return null;
        const l1 = shapes.find(sh => sh.id === s.line1Id && sh.type === 'line');
        const l2 = shapes.find(sh => sh.id === s.line2Id && sh.type === 'line');
        if (!l1 || !l2) return null;
        const inter = lineIntersection(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2);
        if (!inter) return null;
        // Use endpoint-parameter heuristic so the arc always sits inside the actual
        // line segments regardless of where the intersection falls relative to them.
        let a1 = dimAngleArm(l1.x1, l1.y1, l1.x2, l1.y2, inter.x, inter.y);
        let a2 = dimAngleArm(l2.x1, l2.y1, l2.x2, l2.y2, inter.x, inter.y);
        // Canonicalize: swap so the CW short arc (sweep=1) always sits inside the
        // measured angle, regardless of which line the user clicked first.
        let dAng = ((a2-a1)+2*Math.PI) % (2*Math.PI);
        if (dAng > Math.PI) { const t = a1; a1 = a2; a2 = t; dAng = 2*Math.PI - dAng; }
        const arcR = (s.scale || 1.0) * 40 * ps;
        const ax1 = inter.x + Math.cos(a1)*arcR, ay1 = inter.y + Math.sin(a1)*arcR;
        const ax2 = inter.x + Math.cos(a2)*arcR, ay2 = inter.y + Math.sin(a2)*arcR;
        // flip=true draws the complementary (larger) arc on the other side.
        const largeArc = s.flip ? 1 : 0;
        const sweepF   = s.flip ? 0 : 1;
        const sw2 = 1.2 * ps;
        inner = (
          <g style={sel}>
            <path d={`M ${ax1} ${ay1} A ${arcR} ${arcR} 0 ${largeArc} ${sweepF} ${ax2} ${ay2}`}
                  stroke={STROKE} strokeWidth={sw2} fill="none" strokeLinecap="round" />
          </g>
        );
        break;
      }
      case 'dim-bearing': {
        // Bearing dimension: arrow from P1 to P2, label rotated along the line.
        // Legacy shapes that referenced a lineId are silently skipped.
        if (!s.p1 || !s.p2) return null;
        const { p1, p2 } = s;
        const bLen = Math.hypot(p2.x-p1.x, p2.y-p1.y);
        if (bLen < 1) return null;
        const udx = (p2.x-p1.x)/bLen, udy = (p2.y-p1.y)/bLen;
        const sw3 = 1.2 * ps;
        const ah = 8 * ps, as = 3 * ps;
        const mkArrow = (ax, ay, dx, dy) =>
          `M ${ax-dx*ah*0.5+dy*as} ${ay-dy*ah*0.5-dx*as} L ${ax} ${ay} L ${ax-dx*ah*0.5-dy*as} ${ay-dy*ah*0.5+dx*as}`;
        inner = (
          <g style={sel}>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke={STROKE} strokeWidth={sw3} strokeLinecap="round" />
            <path d={mkArrow(p2.x, p2.y, udx, udy)}
                  stroke={STROKE} strokeWidth={sw3} fill="none"
                  strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
        break;
      }
      case 'dim-radius': {
        // Radius dimension: leader line from shape centre to label offset position.
        const ref = shapes.find(sh => sh.id === s.shapeId);
        if (!ref) return null;
        let rcx, rcy, rr;
        if (ref.type === 'circle') {
          rcx = ref.cx; rcy = ref.cy; rr = ref.r;
        } else if (ref.type === 'curve') {
          const { px: rpx, py: rpy } = getCurvePI(ref);
          const rarc = computeArcFromPI(ref.x1, ref.y1, ref.x2, ref.y2, rpx, rpy);
          if (!rarc) return null;
          rcx = rarc.cx; rcy = rarc.cy; rr = rarc.R;
        } else {
          return null;
        }
        const off = s.offset || { x: 50*ps, y: -50*ps };
        const ex = rcx + off.x, ey = rcy + off.y;
        const leaderLen = Math.hypot(off.x, off.y) || 1;
        const ux = off.x/leaderLen, uy = off.y/leaderLen;
        // Leader starts at the shape surface (radius from centre in the leader direction)
        const surfX = rcx + ux * rr, surfY = rcy + uy * rr;
        const sw4 = 1.2 * ps;
        inner = (
          <g style={sel}>
            <line x1={surfX} y1={surfY} x2={ex} y2={ey}
                  stroke={STROKE} strokeWidth={sw4} strokeLinecap="round" />
            {/* Short tick at label end */}
            <line x1={ex} y1={ey} x2={ex + 12*ps} y2={ey}
                  stroke={STROKE} strokeWidth={sw4} strokeLinecap="round" />
          </g>
        );
        break;
      }
      default: return null;
    }
    return <g key={s.id} transform={transform}>{inner}</g>;
  }

  // ── Dynamic SVG grid (Phase 4) ────────────────────────────────────────────
  // Grid is tied to the scale bar: one major square = one scale bar unit.
  // 5 minor divisions per major square — matches Rite in the Rain grid style.
  // Lines are counter-scaled by ps so they stay constant thickness on screen.
  function renderGrid() {
    const containerW = svgSizeRef.current.w || viewBox.w;
    const ps         = viewBox.w / containerW;

    // Major interval = the same nice real-world value shown on the scale bar.
    const majorReal = niceScaleBarValue(scaleDenom, viewBox.w, containerW, units);
    const majorPx   = realToPx(majorReal, scaleDenom, units);
    if (!majorPx || majorPx <= 0) return null;

    // Minor interval = 1/5 of major (5 divisions per square).
    const minorPx = majorPx / 5;

    // If minor lines would be < 4 screen px apart, skip them to avoid noise.
    const skipMinor = (minorPx / ps) < 4;
    const intervalPx = skipMinor ? majorPx : minorPx;

    const minorStroke = 0.4 * ps;
    const majorStroke = 0.9 * ps;
    const minorColor  = 'rgba(80,120,200,0.13)';
    const majorColor  = 'rgba(80,120,200,0.32)';

    const lines = [];

    // ── Vertical lines ──────────────────────────────────────────────────────
    const xStart = Math.floor(viewBox.x / intervalPx);
    const xEnd   = Math.ceil((viewBox.x + viewBox.w) / intervalPx);
    let xCount   = 0;
    for (let i = xStart; i <= xEnd && xCount < 300; i++, xCount++) {
      const x = i * intervalPx;
      // majorPx = 5 * minorPx exactly, so i % 5 === 0 ↔ world coord is a
      // multiple of majorPx — alignment is correct from any starting index.
      const isMajor = skipMinor || (i % 5 === 0);
      lines.push(
        <line key={`gx${i}`}
          x1={x} y1={viewBox.y}
          x2={x} y2={viewBox.y + viewBox.h}
          stroke={isMajor ? majorColor : minorColor}
          strokeWidth={isMajor ? majorStroke : minorStroke}
        />
      );
    }

    // ── Horizontal lines ────────────────────────────────────────────────────
    const yStart = Math.floor(viewBox.y / intervalPx);
    const yEnd   = Math.ceil((viewBox.y + viewBox.h) / intervalPx);
    let yCount   = 0;
    for (let i = yStart; i <= yEnd && yCount < 300; i++, yCount++) {
      const y       = i * intervalPx;
      const isMajor = skipMinor || (i % 5 === 0);
      lines.push(
        <line key={`gy${i}`}
          x1={viewBox.x}             y1={y}
          x2={viewBox.x + viewBox.w} y2={y}
          stroke={isMajor ? majorColor : minorColor}
          strokeWidth={isMajor ? majorStroke : minorStroke}
        />
      );
    }

    return <g key="grid" style={{ pointerEvents: 'none' }}>{lines}</g>;
  }

  // ── Render dimension label(s) for a committed shape ───────────────────────
  // Labels live OUTSIDE shape groups so the group's rotation transform doesn't
  // skew the text.  Instead we manually rotate the anchor point and adjust the
  // text angle to match the (possibly rotated) geometry.
  function renderDimLabel(s) {
    // Per-shape override: user can suppress this shape's dim label independently
    // of the master Dims toggle.
    if (s._hideDims) return null;

    const ps  = viewBox.w / (svgSizeRef.current.w || viewBox.w);
    const OFF = 13 * ps;   // offset from shape edge → constant screen px at any zoom

    // NTS override — show custom label at shape centre instead of computed dims
    if (s.ntsLabel) {
      let nx = 0, ny = 0;
      switch (s.type) {
        case 'line':   nx = (s.x1+s.x2)/2; ny = (s.y1+s.y2)/2; break;
        case 'circle': nx = s.cx;           ny = s.cy;           break;
        case 'rect':   nx = s.x + s.w/2;   ny = s.y + s.h/2;   break;
        case 'curve':  { const { px, py } = getCurvePI(s); nx = px; ny = py; break; }
        default: return null;
      }
      return dimTextEl(nx, ny, 0, s.ntsLabel + ' *', ps);
    }

    const rot = s._rot || 0;
    const piv = getShapePivot(s);

    // Rotate anchor (rawX, rawY) by the shape's own rotation, then render text
    // at that world position with text angle adjusted to match rotated direction.
    // normAng() ensures the result is always in (-90°, 90°] so text is never
    // upside-down regardless of the shape's rotation or the label's base angle.
    function D(rawX, rawY, ang, txt) {
      const { x: lx, y: ly } = rot
        ? rotatePoint(rawX, rawY, piv.x, piv.y, rot)
        : { x: rawX, y: rawY };
      return dimTextEl(lx, ly, normAng(ang + rot), txt, ps);
    }

    switch (s.type) {
      case 'line': {
        const len = Math.hypot(s.x2-s.x1, s.y2-s.y1);
        if (len < 5 * ps) return null;
        const mx = (s.x1+s.x2)/2, my = (s.y1+s.y2)/2;
        // Left-hand perpendicular unit normal (points "up" when line goes L→R)
        const nx = -(s.y2-s.y1)/len, ny = (s.x2-s.x1)/len;
        // Text angle along line direction; D() normalises to ±90° so text always reads up
        const ang = Math.atan2(s.y2-s.y1, s.x2-s.x1) * 180 / Math.PI;
        // Surveying azimuth from North, clockwise, 0–360°.
        // Add shape rotation so the label reflects the actual bearing on screen.
        const az  = ((Math.atan2(s.x2-s.x1, -(s.y2-s.y1)) * 180/Math.PI) + rot + 360) % 360;
        return <>
          {/* Length — left-perp side (top for L→R, bottom for R→L) */}
          {D(mx + nx*OFF, my + ny*OFF, ang, fmtPxAsReal(len, scaleDenom, units))}
          {/* Bearing DMS — right-perp side (always opposite to length) */}
          {D(mx - nx*OFF, my - ny*OFF, ang, toDMS(az))}
        </>;
      }
      case 'curve': {
        const { px: rpx, py: rpy } = getCurvePI(s);
        const cp = computeArcFromPI(s.x1, s.y1, s.x2, s.y2, rpx, rpy);
        if (!cp || cp.L < 5 * ps) return null;
        // Arc midpoint = chord midpoint + M (middle ordinate) in the PI direction.
        // Labels sit just outside the arc surface — close enough to read but
        // not overlapping the curve.  OFF is ~13 screen px past the arc midpoint.
        const mx = (s.x1+s.x2)/2, my = (s.y1+s.y2)/2;
        const olen = Math.hypot(rpx-mx, rpy-my) || 1;
        const ux = (rpx-mx)/olen, uy = (rpy-my)/olen;
        const lx1 = mx + (cp.M + OFF)          * ux, ly1 = my + (cp.M + OFF)          * uy;
        const lx2 = mx + (cp.M + OFF + 12*ps)  * ux, ly2 = my + (cp.M + OFF + 12*ps)  * uy;
        const r0 = rot ? rotatePoint(lx1, ly1, piv.x, piv.y, rot) : { x: lx1, y: ly1 };
        const r1 = rot ? rotatePoint(lx2, ly2, piv.x, piv.y, rot) : { x: lx2, y: ly2 };
        return <>
          {dimTextEl(r0.x, r0.y, 0, `L ${fmtPxAsReal(cp.L, scaleDenom, units)}`, ps)}
          {dimTextEl(r1.x, r1.y, 0, `R ${fmtPxAsReal(cp.R, scaleDenom, units)}`, ps)}
        </>;
      }
      case 'circle': {
        if (s.r < 5 * ps) return null;
        // Radius label inside the circle, slightly below centre
        return D(s.cx, s.cy + s.r * 0.25, 0, `R=${fmtPxAsReal(s.r, scaleDenom, units)}`);
      }
      case 'rect': {
        // Width label below bottom edge, height label right of right edge
        return <>
          {D(s.x + s.w/2,     s.y + s.h + OFF, 0,   fmtPxAsReal(Math.abs(s.w), scaleDenom, units))}
          {D(s.x + s.w + OFF, s.y + s.h/2,     -90, fmtPxAsReal(Math.abs(s.h), scaleDenom, units))}
        </>;
      }

      // ── Dimension shape labels (Phase 7) ────────────────────────────────────
      case 'dim-linear': {
        const { p1, p2 } = s;
        const off = s.offset || 0;
        const len = Math.hypot(p2.x-p1.x, p2.y-p1.y);
        if (len < 5*ps) return null;
        const perpX = -(p2.y-p1.y)/len, perpY = (p2.x-p1.x)/len;
        const mx = (p1.x+p2.x)/2 + perpX*off;
        const my = (p1.y+p2.y)/2 + perpY*off;
        const ang = Math.atan2(p2.y-p1.y, p2.x-p1.x) * 180/Math.PI;
        const txt = s.ntsLabel ? s.ntsLabel + ' *' : fmtPxAsReal(len, scaleDenom, units);
        return dimTextEl(mx, my, normAng(ang), txt, ps);
      }
      case 'dim-angle': {
        const al1 = shapes.find(sh => sh.id === s.line1Id && sh.type === 'line');
        const al2 = shapes.find(sh => sh.id === s.line2Id && sh.type === 'line');
        if (!al1 || !al2) return null;
        const aInter = lineIntersection(al1.x1, al1.y1, al1.x2, al1.y2, al2.x1, al2.y1, al2.x2, al2.y2);
        if (!aInter) return null;
        let aa1 = dimAngleArm(al1.x1, al1.y1, al1.x2, al1.y2, aInter.x, aInter.y);
        let aa2 = dimAngleArm(al2.x1, al2.y1, al2.x2, al2.y2, aInter.x, aInter.y);
        let dAngA = ((aa2-aa1)+2*Math.PI) % (2*Math.PI);
        // Same canonicalization as rendering — swap if needed so midAng is always correct.
        if (dAngA > Math.PI) { const t = aa1; aa1 = aa2; aa2 = t; dAngA = 2*Math.PI - dAngA; }
        const midAngNormal = aa1 + dAngA / 2;
        const midAng = s.flip ? midAngNormal + Math.PI : midAngNormal;
        const angleDeg = s.flip ? (360 - dAngA * 180/Math.PI) : (dAngA * 180/Math.PI);
        const arcRA = (s.scale || 1.0) * 40 * ps;
        const lx = aInter.x + Math.cos(midAng) * (arcRA + 30*ps);
        const ly = aInter.y + Math.sin(midAng) * (arcRA + 30*ps);
        const atxt = s.ntsLabel ? s.ntsLabel + ' *' : toDMS(angleDeg);
        const labelRotDeg = normAng(midAng * 180 / Math.PI);
        return dimTextEl(lx, ly, labelRotDeg, atxt, ps);
      }
      case 'dim-bearing': {
        if (!s.p1 || !s.p2) return null;
        if (s.arrowOnly) return null; // arrow-only mode: no bearing label
        const { p1: bp1, p2: bp2 } = s;
        const bLen2 = Math.hypot(bp2.x-bp1.x, bp2.y-bp1.y);
        if (bLen2 < 5*ps) return null;
        const bmx = (bp1.x+bp2.x)/2, bmy = (bp1.y+bp2.y)/2;
        const rawAz = ((Math.atan2(bp2.x-bp1.x, -(bp2.y-bp1.y)) * 180/Math.PI) + 360) % 360;
        const adjustedAz = (rawAz - northAzimuth + 360) % 360;
        const lineAngDeg = Math.atan2(bp2.y-bp1.y, bp2.x-bp1.x) * 180/Math.PI;
        const btxt = s.ntsLabel ? s.ntsLabel + ' *' : toDMS(adjustedAz);
        return dimTextEl(bmx, bmy, normAng(lineAngDeg), btxt, ps);
      }
      case 'dim-radius': {
        const rref = shapes.find(sh => sh.id === s.shapeId);
        if (!rref) return null;
        let rrcx, rrcy, rrR;
        if (rref.type === 'circle') {
          rrcx = rref.cx; rrcy = rref.cy; rrR = rref.r;
        } else if (rref.type === 'curve') {
          const { px: rrpx, py: rrpy } = getCurvePI(rref);
          const rrarc = computeArcFromPI(rref.x1, rref.y1, rref.x2, rref.y2, rrpx, rrpy);
          if (!rrarc) return null;
          rrcx = rrarc.cx; rrcy = rrarc.cy; rrR = rrarc.R;
        } else {
          return null;
        }
        const rroff = s.offset || { x: 50*ps, y: -50*ps };
        const rrex = rrcx + rroff.x + 14*ps, rrey = rrcy + rroff.y;
        const rrtxt = s.ntsLabel ? s.ntsLabel + ' *' : `R ${fmtPxAsReal(rrR, scaleDenom, units)}`;
        return dimTextEl(rrex, rrey, 0, rrtxt, ps);
      }
      default: return null;
    }
  }

  // ── Render node handles for selected shape ─────────────────────────────────
  // Handles appear at their visually rotated positions in SVG space.
  // The pivot (⊕) and rotate (↻) handles are rendered outside the shape <g>
  // so they're always accessible regardless of shape rotation.
  function renderNodes(shape, opts = {}) {
    const { suppressPivotRotate = false } = opts;
    const rot = shape._rot || 0;
    const piv = getShapePivot(shape);
    // Counter-scale all fixed-screen-size handles so they stay the same visual
    // size in CSS pixels regardless of zoom level.
    const ps   = viewBox.w / (svgSizeRef.current.w || viewBox.w);
    const nodeR     = NODE_R          * ps;
    const pivR      = PIVOT_R         * ps;
    const rotR      = ROT_R           * ps;
    const rotDist   = ROT_HANDLE_DIST * ps;
    const crossArm  = 8              * ps;

    // Position of the rotate handle — straight up from pivot, then rotated
    const rhRaw = { x: piv.x, y: piv.y - rotDist };
    const rhPos = rot ? rotatePoint(rhRaw.x, rhRaw.y, piv.x, piv.y, rot) : rhRaw;

    const nodes = getNodes(shape);

    return (
      <>
        {/* Existing shape nodes — drawn at their visually rotated positions */}
        {nodes.map(n => {
          const np = rot ? rotatePoint(n.x, n.y, piv.x, piv.y, rot) : { x: n.x, y: n.y };
          const onDown = ev => {
            ev.stopPropagation();
            setDragNode({ shapeId: shape.id, nodeKey: n.key });
            setDragStart({ svgX: screenToWorld(ev).x, svgY: screenToWorld(ev).y, snapshot: shapes });
          };
          if (n.key === 'offset') {
            // Offset handle for dim-linear — amber diamond, drag to move the dim line
            const sz = 6 * ps;
            const pts = `${np.x},${np.y-sz} ${np.x+sz},${np.y} ${np.x},${np.y+sz} ${np.x-sz},${np.y}`;
            return (
              <g key="offset">
                <polygon points={pts}
                  fill="rgba(245,158,11,0.22)" stroke="#F59E0B" strokeWidth={1.5 * ps}
                  style={{ cursor: 'move' }}
                  onPointerDown={onDown} />
              </g>
            );
          }
          if (n.key === 'pi') {
            // PI handle — green diamond with guide line from chord midpoint to PI
            const midRaw = { x: (shape.x1+shape.x2)/2, y: (shape.y1+shape.y2)/2 };
            const midRot = rot ? rotatePoint(midRaw.x, midRaw.y, piv.x, piv.y, rot) : midRaw;
            const sz = 7 * ps;
            const pts = `${np.x},${np.y-sz} ${np.x+sz},${np.y} ${np.x},${np.y+sz} ${np.x-sz},${np.y}`;
            return (
              <g key="pi">
                {/* Dashed guide from chord midpoint to PI */}
                <line x1={midRot.x} y1={midRot.y} x2={np.x} y2={np.y}
                  stroke="rgba(34,197,94,0.45)" strokeWidth={ps} strokeDasharray={`${4*ps},${3*ps}`}
                  style={{ pointerEvents: 'none' }} />
                {/* PI diamond handle */}
                <polygon points={pts}
                  fill="rgba(34,197,94,0.18)" stroke="#22C55E" strokeWidth={1.5 * ps}
                  style={{ cursor: 'move' }}
                  onPointerDown={onDown} />
                {/* "PI" label */}
                <text x={np.x} y={np.y - sz - 4*ps}
                  textAnchor="middle" dominantBaseline="auto"
                  fontSize={7.5 * ps} fontFamily="Courier New, monospace"
                  fill="#22C55E" stroke="rgba(10,15,35,0.7)" strokeWidth={1.8*ps}
                  paintOrder="stroke fill"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>PI</text>
              </g>
            );
          }
          return (
            <g key={n.key}>
              <circle cx={np.x} cy={np.y} r={nodeR}
                fill="white" stroke="#3B82F6" strokeWidth={1.5 * ps}
                style={{ cursor: 'move' }}
                onPointerDown={onDown} />
            </g>
          );
        })}

        {/* Pivot + rotate handles are suppressed for dimension shapes and multi-select */}
        {!suppressPivotRotate && !shape.type.startsWith('dim-') && <line x1={piv.x} y1={piv.y} x2={rhPos.x} y2={rhPos.y}
          stroke="rgba(245,158,11,0.45)" strokeWidth={ps} strokeDasharray={`${3*ps},${3*ps}`}
          style={{ pointerEvents: 'none' }} />}

        {/* Pivot handle — amber crosshair circle (not shown for dim shapes or multi-select) */}
        {!suppressPivotRotate && !shape.type.startsWith('dim-') && <g key="pivot" style={{ cursor: 'move' }}
          onPointerDown={ev => {
            ev.stopPropagation();
            setDragNode({ shapeId: shape.id, nodeKey: 'pivot' });
            setDragStart({ svgX: screenToWorld(ev).x, svgY: screenToWorld(ev).y, snapshot: shapes });
          }}>
          <circle cx={piv.x} cy={piv.y} r={(pivR + 4 * ps)}
            fill="transparent" stroke="none" />
          <circle cx={piv.x} cy={piv.y} r={pivR}
            fill="rgba(245,158,11,0.18)" stroke="#F59E0B" strokeWidth={1.5 * ps} />
          <line x1={piv.x - crossArm} y1={piv.y} x2={piv.x + crossArm} y2={piv.y}
            stroke="#F59E0B" strokeWidth={1.5 * ps} />
          <line x1={piv.x} y1={piv.y - crossArm} x2={piv.x} y2={piv.y + crossArm}
            stroke="#F59E0B" strokeWidth={1.5 * ps} />
        </g>}

        {/* Rotate handle — amber ↻ circle (not shown for dim shapes or multi-select) */}
        {!suppressPivotRotate && !shape.type.startsWith('dim-') && <g key="rotate" style={{ cursor: 'grab' }}
          onPointerDown={ev => {
            ev.stopPropagation();
            const svgPt = screenToWorld(ev);
            setDragNode({ shapeId: shape.id, nodeKey: 'rotate' });
            setDragStart({
              svgX: svgPt.x, svgY: svgPt.y, snapshot: shapes,
              pivX: piv.x, pivY: piv.y, startRot: shape._rot || 0,
            });
          }}>
          <circle cx={rhPos.x} cy={rhPos.y} r={(rotR + 4 * ps)}
            fill="transparent" stroke="none" />
          <circle cx={rhPos.x} cy={rhPos.y} r={rotR}
            fill="rgba(245,158,11,0.2)" stroke="#F59E0B" strokeWidth={1.5 * ps} />
          <text x={rhPos.x} y={rhPos.y} textAnchor="middle" dominantBaseline="central"
            fontSize={11 * ps} fill="#F59E0B" style={{ pointerEvents: 'none', userSelect: 'none' }}>
            ↻
          </text>
        </g>}
      </>
    );
  }

  // ── Multi-select bounding box + group rotate handle ───────────────────────
  function renderGroupControls(selShapes) {
    if (!selShapes || selShapes.length < 2) return null;
    const bb = getBoundingBox(selShapes);
    if (!bb) return null;
    const ps      = viewBox.w / (svgSizeRef.current.w || viewBox.w);
    const PAD     = 10 * ps;
    const bx      = bb.minX - PAD;
    const by      = bb.minY - PAD;
    const bw      = (bb.maxX - bb.minX) + PAD * 2;
    const bh      = (bb.maxY - bb.minY) + PAD * 2;
    const cx      = (bb.minX + bb.maxX) / 2;
    const cy      = (bb.minY + bb.maxY) / 2;
    const rotDist = ROT_HANDLE_DIST * ps;
    const rotR    = ROT_R * ps;
    const rhPos   = { x: cx, y: bb.minY - PAD - rotDist };

    return (
      <>
        {/* Selection bounding box */}
        <rect x={bx} y={by} width={bw} height={bh}
          fill="rgba(59,130,246,0.05)" stroke="rgba(59,130,246,0.55)"
          strokeWidth={ps} strokeDasharray={`${5*ps},${3*ps}`}
          style={{ pointerEvents: 'none' }} />

        {/* Dashed stem from top-center to group rotate handle */}
        <line x1={cx} y1={bb.minY - PAD} x2={rhPos.x} y2={rhPos.y}
          stroke="rgba(245,158,11,0.45)" strokeWidth={ps}
          strokeDasharray={`${3*ps},${3*ps}`}
          style={{ pointerEvents: 'none' }} />

        {/* Group rotate handle */}
        <g style={{ cursor: 'grab' }}
          onPointerDown={ev => {
            ev.stopPropagation();
            const svgPt = screenToWorld(ev);
            setDragNode({ shapeId: null, nodeKey: 'group-rotate' });
            setDragStart({
              svgX: svgPt.x, svgY: svgPt.y, snapshot: shapes,
              pivX: cx, pivY: cy,
              multiIds: selShapes.map(s => s.id),
            });
          }}>
          <circle cx={rhPos.x} cy={rhPos.y} r={rotR + 4 * ps}
            fill="transparent" stroke="none" />
          <circle cx={rhPos.x} cy={rhPos.y} r={rotR}
            fill="rgba(245,158,11,0.2)" stroke="#F59E0B" strokeWidth={1.5 * ps} />
          <text x={rhPos.x} y={rhPos.y} textAnchor="middle" dominantBaseline="central"
            fontSize={11 * ps} fill="#F59E0B"
            style={{ pointerEvents: 'none', userSelect: 'none' }}>↻</text>
        </g>
      </>
    );
  }

  // ── Draw preview shape ─────────────────────────────────────────────────────
  function renderPreview() {
    if (!drawState) return null;
    const props = { stroke: STROKE, strokeWidth: STROKE_W, fill: 'none',
      strokeDasharray: '5,4', strokeLinecap: 'round', opacity: 0.7 };
    const ps  = viewBox.w / (svgSizeRef.current.w || viewBox.w);
    const OFF = 13 * ps;
    switch (drawState.type) {
      case 'line': {
        const len = Math.hypot(drawState.x2-drawState.x1, drawState.y2-drawState.y1);
        const mx  = (drawState.x1+drawState.x2)/2, my = (drawState.y1+drawState.y2)/2;
        const nx  = len > 0 ? -(drawState.y2-drawState.y1)/len : 0;
        const ny  = len > 0 ?  (drawState.x2-drawState.x1)/len : 1;
        const ang = Math.atan2(drawState.y2-drawState.y1, drawState.x2-drawState.x1) * 180/Math.PI;
        const az  = len > 0 ? ((Math.atan2(drawState.x2-drawState.x1, -(drawState.y2-drawState.y1))*180/Math.PI)+360)%360 : 0;
        const na  = normAng(ang);
        return <>
          <line x1={drawState.x1} y1={drawState.y1} x2={drawState.x2} y2={drawState.y2} {...props} />
          {showDims && len >= 5*ps && <>
            {dimTextEl(mx + nx*OFF, my + ny*OFF, na, fmtPxAsReal(len, scaleDenom, units), ps)}
            {dimTextEl(mx - nx*OFF, my - ny*OFF, na, toDMS(az), ps)}
          </>}
        </>;
      }
      case 'curve':
        if (drawState.phase === 1) {
          // Phase 1: dashed chord line BC→cursor + endpoint dot + chord length label
          const len = Math.hypot(drawState.x2-drawState.x1, drawState.y2-drawState.y1);
          const mx  = (drawState.x1+drawState.x2)/2, my = (drawState.y1+drawState.y2)/2;
          const nx  = len > 0 ? -(drawState.y2-drawState.y1)/len : 0;
          const ny  = len > 0 ?  (drawState.x2-drawState.x1)/len : 1;
          const ang = Math.atan2(drawState.y2-drawState.y1, drawState.x2-drawState.x1) * 180/Math.PI;
          const az  = len > 0 ? ((Math.atan2(drawState.x2-drawState.x1, -(drawState.y2-drawState.y1))*180/Math.PI)+360)%360 : 0;
          const na  = normAng(ang);
          return <>
            <line x1={drawState.x1} y1={drawState.y1} x2={drawState.x2} y2={drawState.y2} {...props} />
            <circle cx={drawState.x1} cy={drawState.y1} r={4*ps} fill="#3B82F6" opacity={0.7} />
            {showDims && len >= 5*ps && <>
              {dimTextEl(mx + nx*OFF, my + ny*OFF, na, fmtPxAsReal(len, scaleDenom, units), ps)}
              {dimTextEl(mx - nx*OFF, my - ny*OFF, na, toDMS(az), ps)}
            </>}
          </>;
        } else {
          // Phase 2: live circular arc from BC to EC shaped by PI cursor position.
          // Construction lines: dashed back-tangent (BC→PI) and forward-tangent (PI→EC).
          const { px: ppx, py: ppy } = drawState;
          const arcD = arcPath(drawState.x1, drawState.y1, drawState.x2, drawState.y2, ppx, ppy);
          const cp   = showDims ? computeArcFromPI(drawState.x1, drawState.y1, drawState.x2, drawState.y2, ppx, ppy) : null;
          const midX = (drawState.x1+drawState.x2)/2, midY = (drawState.y1+drawState.y2)/2;
          const sz   = 7 * ps;
          const dpts = `${ppx},${ppy-sz} ${ppx+sz},${ppy} ${ppx},${ppy+sz} ${ppx-sz},${ppy}`;
          const olen = Math.hypot(ppx-midX, ppy-midY) || 1;
          const ux   = (ppx-midX)/olen, uy = (ppy-midY)/olen;
          return <>
            {/* Live arc */}
            <path d={arcD} {...props} />
            {/* Tangent construction lines: BC→PI and PI→EC */}
            <line x1={drawState.x1} y1={drawState.y1} x2={ppx} y2={ppy}
              stroke="rgba(34,197,94,0.4)" strokeWidth={ps} strokeDasharray={`${4*ps},${3*ps}`}
              style={{ pointerEvents: 'none' }} />
            <line x1={ppx} y1={ppy} x2={drawState.x2} y2={drawState.y2}
              stroke="rgba(34,197,94,0.4)" strokeWidth={ps} strokeDasharray={`${4*ps},${3*ps}`}
              style={{ pointerEvents: 'none' }} />
            {/* BC and EC endpoint dots */}
            <circle cx={drawState.x1} cy={drawState.y1} r={4*ps} fill="#3B82F6" opacity={0.7} />
            <circle cx={drawState.x2} cy={drawState.y2} r={4*ps} fill="#3B82F6" opacity={0.7} />
            {/* PI diamond handle */}
            <polygon points={dpts} fill="rgba(34,197,94,0.25)" stroke="#22C55E"
              strokeWidth={1.5*ps} opacity={0.95} style={{ pointerEvents: 'none' }} />
            <text x={ppx} y={ppy - sz - 4*ps}
              textAnchor="middle" dominantBaseline="auto"
              fontSize={7.5*ps} fontFamily="Courier New, monospace"
              fill="#22C55E" stroke="rgba(10,15,35,0.7)" strokeWidth={1.8*ps}
              paintOrder="stroke fill"
              style={{ pointerEvents: 'none', userSelect: 'none' }}>PI</text>
            {/* Live arc-length + radius labels near arc midpoint (chord mid + M in PI dir) */}
            {showDims && cp && cp.L >= 5*ps && <>
              {dimTextEl(midX + (cp.M + OFF)         * ux, midY + (cp.M + OFF)         * uy, 0, `L ${fmtPxAsReal(cp.L, scaleDenom, units)}`, ps)}
              {dimTextEl(midX + (cp.M + OFF + 12*ps) * ux, midY + (cp.M + OFF + 12*ps) * uy, 0, `R ${fmtPxAsReal(cp.R, scaleDenom, units)}`, ps)}
            </>}
          </>;
        }
      case 'circle': {
        const r = Math.max(0, drawState.r);
        return <>
          <circle cx={drawState.cx} cy={drawState.cy} r={r} {...props} />
          {showDims && r >= 5*ps && dimTextEl(drawState.cx, drawState.cy, 0, `R=${fmtPxAsReal(r, scaleDenom, units)}`, ps)}
        </>;
      }
      case 'rect': {
        const w = Math.max(0, drawState.w), h = Math.max(0, drawState.h);
        return <>
          <rect x={drawState.x} y={drawState.y} width={w} height={h} {...props} />
          {showDims && w >= 5*ps && dimTextEl(drawState.x + w/2,     drawState.y + h + OFF, 0,   fmtPxAsReal(w, scaleDenom, units), ps)}
          {showDims && h >= 5*ps && dimTextEl(drawState.x + w + OFF, drawState.y + h/2,     -90, fmtPxAsReal(h, scaleDenom, units), ps)}
        </>;
      }
      case 'text': {
        // Text box draw preview — dashed blue rect
        const w = Math.max(0, drawState.w), h = Math.max(0, drawState.h);
        return <rect x={drawState.x} y={drawState.y} width={w} height={h}
          stroke="#3B82F6" strokeWidth={1.5*ps} fill="rgba(59,130,246,0.06)"
          strokeDasharray={`${4*ps},${2*ps}`} />;
      }
      case 'pencil_stroke': {
        // Live freehand stroke preview as a polyline through stabilized points
        if (!pencilPreview || pencilPreview.length < 2) return null;
        const pts = pencilPreview.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
        return (
          <polyline points={pts}
            stroke={STROKE} strokeWidth={STROKE_W * ps}
            fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.8}
          />
        );
      }
      case 'dim-bearing': {
        // Phase 1 preview: dot at P1, dashed line to cursor, ghosted bearing arrow + label
        const { x1: bx1, y1: by1, x2: bx2, y2: by2 } = drawState;
        const bpLen = Math.hypot(bx2-bx1, by2-by1);
        if (bpLen < 2) return <circle cx={bx1} cy={by1} r={4*ps} fill="#3B82F6" opacity={0.7} />;
        const budx = (bx2-bx1)/bpLen, budy = (by2-by1)/bpLen;
        const bah = 8*ps, bas = 3*ps;
        const bAng = Math.atan2(by2-by1, bx2-bx1) * 180/Math.PI;
        const bAz  = ((Math.atan2(bx2-bx1, -(by2-by1)) * 180/Math.PI) + 360) % 360;
        const bAzAdj = (bAz - northAzimuth + 360) % 360;
        const mkBA = (ax, ay, dx, dy) =>
          `M ${ax-dx*bah*0.5+dy*bas} ${ay-dy*bah*0.5-dx*bas} L ${ax} ${ay} L ${ax-dx*bah*0.5-dy*bas} ${ay-dy*bah*0.5+dx*bas}`;
        return <>
          <circle cx={bx1} cy={by1} r={4*ps} fill="#3B82F6" opacity={0.7} />
          <line x1={bx1} y1={by1} x2={bx2} y2={by2} {...props} />
          <path d={mkBA(bx2, by2, budx, budy)}
                stroke={STROKE} strokeWidth={1.2*ps} fill="none"
                strokeLinecap="round" strokeLinejoin="round" opacity={0.65} />
          {showDims && bpLen > 5*ps &&
            dimTextEl((bx1+bx2)/2, (by1+by2)/2, normAng(bAng), toDMS(bAzAdj), ps)}
        </>;
      }
      case 'dim-linear': {
        // Phase 1 preview: dot at P1, dashed rubber-band line to cursor + ghosted dim
        const { x1, y1, x2, y2 } = drawState;
        const len = Math.hypot(x2-x1, y2-y1);
        if (len < 2) return <circle cx={x1} cy={y1} r={4*ps} fill="#3B82F6" opacity={0.7} />;
        const perpX = -(y2-y1)/len, perpY = (x2-x1)/len;
        const off = 20 * ps;
        const dp1x = x1+perpX*off, dp1y = y1+perpY*off;
        const dp2x = x2+perpX*off, dp2y = y2+perpY*off;
        const ang = Math.atan2(y2-y1, x2-x1) * 180/Math.PI;
        const udx = (x2-x1)/len, udy = (y2-y1)/len;
        const ah = 8*ps, as = 3*ps;
        const mkA = (ax, ay, dx, dy) =>
          `M ${ax-dx*ah*0.5+dy*as} ${ay-dy*ah*0.5-dx*as} L ${ax} ${ay} L ${ax-dx*ah*0.5-dy*as} ${ay-dy*ah*0.5+dx*as}`;
        return <>
          <circle cx={x1} cy={y1} r={4*ps} fill="#3B82F6" opacity={0.7} />
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...props} />
          {len > 8*ps && <>
            <line x1={x1+perpX*3*ps} y1={y1+perpY*3*ps} x2={dp1x+perpX*6*ps} y2={dp1y+perpY*6*ps}
                  stroke={STROKE} strokeWidth={1.2*ps} strokeLinecap="round" opacity={0.65} />
            <line x1={x2+perpX*3*ps} y1={y2+perpY*3*ps} x2={dp2x+perpX*6*ps} y2={dp2y+perpY*6*ps}
                  stroke={STROKE} strokeWidth={1.2*ps} strokeLinecap="round" opacity={0.65} />
            <line x1={dp1x} y1={dp1y} x2={dp2x} y2={dp2y}
                  stroke={STROKE} strokeWidth={1.2*ps} strokeLinecap="round" opacity={0.65} />
            <path d={mkA(dp1x, dp1y, -udx, -udy)}
                  stroke={STROKE} strokeWidth={1.2*ps} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.65} />
            <path d={mkA(dp2x, dp2y, udx, udy)}
                  stroke={STROKE} strokeWidth={1.2*ps} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.65} />
            {showDims && len > 5*ps && dimTextEl((dp1x+dp2x)/2, (dp1y+dp2y)/2, normAng(ang), fmtPxAsReal(len, scaleDenom, units), ps)}
          </>}
        </>;
      }
      case 'dim-angle': {
        if (drawState.phase === 1) {
          // Highlight the first selected line in blue
          const _pl1 = shapes.find(sh => sh.id === drawState.line1Id && sh.type === 'line');
          if (!_pl1) return null;
          return <line x1={_pl1.x1} y1={_pl1.y1} x2={_pl1.x2} y2={_pl1.y2}
                       stroke="#3B82F6" strokeWidth={2.5*ps} strokeLinecap="round" opacity={0.55} />;
        }
        // Phase 2: live arc preview that flips as cursor crosses sides
        const _pl1 = shapes.find(sh => sh.id === drawState.line1Id && sh.type === 'line');
        const _pl2 = shapes.find(sh => sh.id === drawState.line2Id && sh.type === 'line');
        if (!_pl1 || !_pl2) return null;
        const _pi = lineIntersection(_pl1.x1, _pl1.y1, _pl1.x2, _pl1.y2, _pl2.x1, _pl2.y1, _pl2.x2, _pl2.y2);
        if (!_pi) return null;
        let _pa1 = dimAngleArm(_pl1.x1, _pl1.y1, _pl1.x2, _pl1.y2, _pi.x, _pi.y);
        let _pa2 = dimAngleArm(_pl2.x1, _pl2.y1, _pl2.x2, _pl2.y2, _pi.x, _pi.y);
        let _pdAng = ((_pa2-_pa1)+2*Math.PI) % (2*Math.PI);
        if (_pdAng > Math.PI) { const _t = _pa1; _pa1 = _pa2; _pa2 = _t; _pdAng = 2*Math.PI - _pdAng; }
        const _flip = drawState.flip || false;
        const _pr = 40 * ps;
        const _pax1 = _pi.x + Math.cos(_pa1)*_pr, _pay1 = _pi.y + Math.sin(_pa1)*_pr;
        const _pax2 = _pi.x + Math.cos(_pa2)*_pr, _pay2 = _pi.y + Math.sin(_pa2)*_pr;
        const _pLarge = _flip ? 1 : 0, _pSweep = _flip ? 0 : 1;
        const _pMid = (_pa1 + _pdAng/2) + (_flip ? Math.PI : 0);
        const _pDeg  = _flip ? (360 - _pdAng*180/Math.PI) : (_pdAng*180/Math.PI);
        const _plx = _pi.x + Math.cos(_pMid)*(_pr + 30*ps);
        const _ply = _pi.y + Math.sin(_pMid)*(_pr + 30*ps);
        return <>
          <path d={`M ${_pax1} ${_pay1} A ${_pr} ${_pr} 0 ${_pLarge} ${_pSweep} ${_pax2} ${_pay2}`}
                stroke={STROKE} strokeWidth={1.5*ps} fill="none" strokeLinecap="round" opacity={0.6} />
          {showDims && dimTextEl(_plx, _ply, normAng(_pMid*180/Math.PI), toDMS(_pDeg), ps)}
        </>;
      }
      default: return null;
    }
  }

  const selectedShape = shapes.find(s => s.id === selectedId);
  const cursorMap = {
    select: 'default', line: 'crosshair', curve: 'crosshair',
    pencil: 'crosshair', pen: 'crosshair', node: 'default',
    circle: 'crosshair', rect: 'crosshair', text: 'text', eraser: 'pointer', fill: 'cell',
    'dim-linear': 'crosshair', 'dim-angle': 'pointer',
    'dim-bearing': 'crosshair', 'dim-radius': 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Page Header — collapsible tombstone ─────────────────────────── */}
      {headerOpen
        ? <PageHeaderStrip page={page} projectId={projectId} onReload={onReload} />
        : null}
      {/* Slim collapse/expand bar — always visible */}
      <button
        onClick={() => setHeaderOpen(o => !o)}
        style={{
          flexShrink: 0, height: 20, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 10px',
          background: 'rgba(245,242,235,0.96)',
          borderBottom: '1px solid rgba(180,160,110,0.25)',
          cursor: 'pointer', outline: 'none', border: 'none', width: '100%',
        }}
      >
        <span style={{
          fontSize: 9.5, fontFamily: 'Courier New, monospace',
          color: 'rgba(60,50,30,0.65)', letterSpacing: '0.03em', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {page.pageNumber ? `Pg ${page.pageNumber}` : ''}
          {page.pageNumber && page.title ? ' · ' : ''}
          {page.title || (headerOpen ? '' : 'tap to show page info')}
        </span>
        <span style={{ fontSize: 9, color: 'rgba(60,50,30,0.4)', flexShrink: 0, marginLeft: 6 }}>
          {headerOpen ? (
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 5.5 4.5 1.5 8 5.5"/></svg>
          ) : (
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 1.5 4.5 5.5 8 1.5"/></svg>
          )}
        </span>
      </button>

      {/* ── Top Toolbar ──────────────────────────────────────────────────── */}
      <div ref={toolbarRef} className="sketch-top-bar" style={{
        height: 36, flexShrink: 0, position: 'relative',
        background: 'rgba(22,30,60,0.92)', backdropFilter: 'blur(6px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        zIndex: 20, overflow: 'visible',
      }}>

        {/* ── View dropdown panel ──────────────────────────────────────── */}
        {openMenu === 'view' && (
          <div style={{
            position: 'absolute', top: 36, left: menuPos.x, zIndex: 100,
            background: 'rgba(16,22,48,0.98)', backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6,
            boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
            minWidth: 185, padding: '4px 0',
            fontFamily: 'Courier New, monospace',
          }}>
            {[
              { label: 'Grid',         icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><line x1="0" y1="4.7" x2="14" y2="4.7"/><line x1="0" y1="9.3" x2="14" y2="9.3"/><line x1="4.7" y1="0" x2="4.7" y2="14"/><line x1="9.3" y1="0" x2="9.3" y2="14"/></svg>, state: showGrid,      set: () => setShowGrid(v => !v),      activeCol: '#6EE7B7', activeBg: 'rgba(52,211,153,0.15)' },
              { label: 'Dims',         icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><line x1="2" y1="9" x2="12" y2="9"/><line x1="2" y1="7" x2="2" y2="11"/><line x1="12" y1="7" x2="12" y2="11"/><polyline points="4 7.5 2 9 4 10.5" strokeWidth="1.1"/><polyline points="10 7.5 12 9 10 10.5" strokeWidth="1.1"/><line x1="4" y1="4" x2="10" y2="4" strokeWidth="1" strokeDasharray="1.5 1" opacity="0.6"/></svg>, state: showDims,      set: () => setShowDims(v => !v),      activeCol: '#90CDF4', activeBg: 'rgba(99,179,237,0.18)' },
              { label: 'Dims on Draw', icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2 12 L7 2 L12 12"/><line x1="4.5" y1="8" x2="9.5" y2="8" strokeWidth="1"/></svg>, state: dimsOnDraw,    set: () => setDimsOnDraw(v => !v),    activeCol: '#90CDF4', activeBg: 'rgba(99,179,237,0.12)' },
              { label: 'Card',         icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="1" y="2" width="12" height="10" rx="1.5"/><line x1="1" y1="5.5" x2="13" y2="5.5" strokeWidth="1.2"/><line x1="3" y1="8" x2="8" y2="8" strokeWidth="1"/><line x1="3" y1="10" x2="6" y2="10" strokeWidth="1"/></svg>, state: showValueCard, set: () => setShowValueCard(v => !v), activeCol: '#C4B5FD', activeBg: 'rgba(167,139,250,0.18)' },
              { label: 'Scale Bar',    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="1" y="5" width="12" height="4" rx="0.5"/><line x1="4.3" y1="5" x2="4.3" y2="9" strokeWidth="1"/><line x1="7.7" y1="5" x2="7.7" y2="9" strokeWidth="1"/></svg>, state: showScaleBar,  set: () => setShowScaleBar(v => !v),  activeCol: '#FCD34D', activeBg: 'rgba(251,191,36,0.15)' },
              { label: 'N Arrow',      icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="12" x2="7" y2="2"/><polyline points="4 5 7 2 10 5"/><text x="5.5" y="11" fontSize="4" fill="currentColor" stroke="none" fontFamily="sans-serif" fontWeight="bold">N</text></svg>, state: showNorthArrow, set: () => setShowNorthArrow(v => !v), activeCol: '#FCD34D', activeBg: 'rgba(251,191,36,0.15)' },
              { label: 'Bg Color',     icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="1" y="1" width="12" height="12" rx="2"/><path d="M4 10 L7 4 L10 10" strokeWidth="1.2"/><line x1="5.5" y1="8" x2="8.5" y2="8" strokeWidth="1"/></svg>, state: !!bgColor,     set: () => { setBgColor(null); persist(undefined, undefined, undefined, { bgColor: null }); }, activeCol: '#F9A8D4', activeBg: 'rgba(249,168,212,0.15)' },
            ].map(({ label, icon, state, set, activeCol, activeBg }) => (
              <button key={label}
                onClick={set}
                style={{
                  width: '100%', height: 34, display: 'flex', alignItems: 'center',
                  gap: 10, padding: '0 14px',
                  background: state ? activeBg : 'transparent',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  color: state ? activeCol : 'rgba(255,255,255,0.55)',
                  fontSize: 11,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, flexShrink: 0 }}>{icon}</span>
                <span style={{ flex: 1, fontFamily: 'Courier New, monospace' }}>{label}</span>
                <span style={{ fontSize: 10, color: state ? activeCol : 'rgba(255,255,255,0.22)', marginLeft: 8 }}>
                  {state ? 'on' : 'off'}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── Scale dropdown panel ─────────────────────────────────────── */}
        {openMenu === 'scale' && (
          <div style={{
            position: 'absolute', top: 36,
            left: Math.max(4, menuPos.x),
            zIndex: 100,
            background: 'rgba(16,22,48,0.98)', backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6,
            boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
            width: 232, padding: '8px 0',
            fontFamily: 'Courier New, monospace',
          }}>

            {/* Zoom controls row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 8px' }}>
              <button
                onClick={() => { zoomToExtents(); setOpenMenu(null); }}
                title="Zoom to fit all shapes"
                style={{
                  height: 26, padding: '0 10px', borderRadius: 4, flex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)',
                  color: 'rgba(255,255,255,0.65)', cursor: 'pointer', fontSize: 11, outline: 'none',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 1 13 1 13 5"/><polyline points="5 13 1 13 1 9"/><line x1="13" y1="1" x2="8" y2="6"/><line x1="1" y1="13" x2="6" y2="8"/></svg>
                <span>Fit</span>
              </button>
              <button
                onClick={() => { zoomReset(); setOpenMenu(null); }}
                title="Reset zoom to 100%"
                style={{
                  height: 26, padding: '0 10px', borderRadius: 4, flex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)',
                  color: 'rgba(255,255,255,0.65)', cursor: 'pointer', fontSize: 11, outline: 'none',
                }}
              >
                <span style={{ fontSize: 11 }}>1 : 1</span>
              </button>
              <span style={{
                fontSize: 10, color: 'rgba(255,255,255,0.35)',
                userSelect: 'none', minWidth: 34, textAlign: 'right',
              }}>
                {Math.round((svgSizeRef.current.w / viewBox.w) * 100)}%
              </span>
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '0 10px 8px' }} />

            {/* Units row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 8px' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', flex: 1 }}>Units</span>
              <button
                onClick={() => {
                  const next = units === 'm' ? 'ft' : 'm';
                  setUnits(next);
                  persist(undefined, undefined, undefined, { units: next });
                }}
                title="Toggle units: metres / feet"
                style={{
                  height: 26, padding: '0 16px', borderRadius: 4,
                  background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
                  color: 'rgba(255,255,255,0.85)', cursor: 'pointer',
                  fontSize: 11, fontWeight: 600,
                  fontFamily: 'Courier New, monospace', outline: 'none',
                }}
              >{units}</button>
            </div>

            {/* Scale row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 8px' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>Scale  1 :</span>
              <input
                type="text"
                inputMode="numeric"
                value={scaleInput}
                onChange={e => setScaleInput(e.target.value)}
                onBlur={e => {
                  const n = parseInt(e.target.value, 10);
                  const next = (!isNaN(n) && n >= 1) ? Math.min(n, MAX_SCALE) : scaleDenom;
                  setScaleDenom(next);
                  setScaleInput(String(next));
                  persist(undefined, undefined, undefined, { scaleDenom: next });
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                  if (e.key === 'Escape') { setScaleInput(String(scaleDenom)); e.target.blur(); }
                }}
                style={{
                  flex: 1, height: 26, minWidth: 0, background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.18)', borderRadius: 4,
                  color: 'rgba(255,255,255,0.9)', fontFamily: 'Courier New, monospace',
                  fontSize: 11, padding: '0 10px', outline: 'none', textAlign: 'left',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Slider row */}
            <div style={{ padding: '0 14px 4px' }}>
              <input
                type="range" min={0} max={100} step={1}
                value={scaleToSlider(scaleDenom)}
                onChange={e => {
                  const next = sliderToScale(Number(e.target.value));
                  setScaleDenom(next);
                  setScaleInput(String(next));
                  persist(undefined, undefined, undefined, { scaleDenom: next });
                }}
                style={{ width: '100%', cursor: 'pointer', accentColor: '#60A5FA' }}
              />
            </div>
          </div>
        )}

        {openMenu === 'stroke' && (() => {
          const selShape = selectedId ? shapes.find(s => s.id === selectedId) : null;
          const currentW = selShape ? (selShape.strokeWidth || 1.5) : defaultStrokeW;
          const setW = val => {
            const v = Math.max(0.5, Math.min(10, Number(val) || 1.5));
            setDefaultStrokeW(v);
            if (selShape) {
              commitShapes(shapes.map(s => s.id === selShape.id ? { ...s, strokeWidth: v } : s));
            }
          };
          return (
            <div style={{
              position: 'absolute', top: '100%', left: menuPos.x,
              marginTop: 4, zIndex: 120, minWidth: 220,
              background: 'rgba(22,28,40,0.97)',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
              padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              {/* Header */}
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)',
                textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {selShape ? `Line — ${selShape.type}` : 'Line — default'}
              </div>

              {/* Thickness row */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)',
                  fontFamily: 'Courier New, monospace', letterSpacing: '0.06em' }}>
                  THICKNESS
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="range" min="0.5" max="10" step="0.5"
                    value={currentW}
                    onChange={e => setW(e.target.value)}
                    style={{ flex: 1, accentColor: '#3B82F6', cursor: 'pointer' }}
                  />
                  <input type="number" min="0.5" max="10" step="0.5"
                    value={currentW}
                    onChange={e => setW(e.target.value)}
                    style={{
                      width: 44, padding: '2px 4px', borderRadius: 4, textAlign: 'center',
                      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)',
                      color: 'rgba(255,255,255,0.85)', fontSize: 11,
                      fontFamily: 'Courier New, monospace', outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)',
                    fontFamily: 'Courier New, monospace' }}>px</span>
                </div>
                {/* Live preview line */}
                <svg width="100%" height={Math.max(currentW * 2 + 6, 14)} style={{ display: 'block' }}>
                  <line x1="8" y1="50%" x2="calc(100% - 8px)" y2="50%"
                    stroke="rgba(255,255,255,0.7)" strokeWidth={currentW} strokeLinecap="round" />
                </svg>
              </div>

              {/* Line type — deferred */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: 0.35 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)',
                  fontFamily: 'Courier New, monospace', letterSpacing: '0.06em' }}>
                  LINE TYPE &nbsp;<span style={{ fontSize: 9, fontStyle: 'italic' }}>(coming soon)</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['——', '- - -', '·····'].map(t => (
                    <button key={t} disabled style={{
                      flex: 1, height: 26, borderRadius: 4, cursor: 'not-allowed',
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.3)', fontSize: 12,
                    }}>{t}</button>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Snap dropdown panel ───────────────────────────────────────── */}
        {openMenu === 'snap' && (
          <div style={{
            position: 'absolute', top: 36, left: menuPos.x, zIndex: 100,
            background: 'rgba(16,22,48,0.98)', backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6,
            boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
            minWidth: 200, padding: '4px 0',
            fontFamily: 'Courier New, monospace',
          }}>
            {[
              { key: 'endpoint',     label: 'Endpoint',      icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5"/><circle cx="7" cy="7" r="2" fill="currentColor"/></svg>, col: '#4ADE80', bg: 'rgba(34,197,94,0.15)',   desc: 'Line & curve endpoints' },
              { key: 'midpoint',     label: 'Midpoint',       icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="1" y1="13" x2="13" y2="1"/><circle cx="7" cy="7" r="2.2" fill="currentColor" fillOpacity="0.85"/></svg>, col: '#22D3EE', bg: 'rgba(34,211,238,0.15)',  desc: 'Segment midpoints' },
              { key: 'intersection', label: 'On Object',      icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/><circle cx="7" cy="7" r="2" fill="currentColor" fillOpacity="0.7"/></svg>, col: '#FB923C', bg: 'rgba(251,146,60,0.15)',  desc: 'Nearest pt on shape' },
              { key: 'perpendicular',label: 'Perpendicular',  icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="2" y1="12" x2="12" y2="12"/><line x1="7" y1="12" x2="7" y2="2"/><rect x="7" y="9" width="3" height="3" strokeWidth="1"/></svg>, col: '#C084FC', bg: 'rgba(192,132,252,0.15)', desc: 'Perpendicular foot' },
              { key: 'tangent',      label: 'Tangent',        icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="7" cy="9" r="4"/><line x1="1" y1="5" x2="13" y2="5"/><circle cx="7" cy="5" r="1.3" fill="currentColor"/></svg>, col: '#A78BFA', bg: 'rgba(167,139,250,0.15)', desc: 'Tangent to circle' },
              { key: 'grid',         label: 'Grid',           icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><line x1="0" y1="4.7" x2="14" y2="4.7"/><line x1="0" y1="9.3" x2="14" y2="9.3"/><line x1="4.7" y1="0" x2="4.7" y2="14"/><line x1="9.3" y1="0" x2="9.3" y2="14"/><circle cx="4.7" cy="4.7" r="1.5" fill="currentColor"/></svg>, col: '#FCD34D', bg: 'rgba(251,191,36,0.15)',  desc: 'Grid intersections' },
            ].map(({ key, label, icon, col, bg, desc }) => {
              const on = snapModes[key];
              return (
                <button key={key}
                  onClick={() => setSnapModes(m => ({ ...m, [key]: !m[key] }))}
                  style={{
                    width: '100%', height: 38, display: 'flex', alignItems: 'center',
                    gap: 10, padding: '0 14px',
                    background: on ? bg : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    color: on ? col : 'rgba(255,255,255,0.5)',
                    fontSize: 11,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, flexShrink: 0 }}>{icon}</span>
                  <span style={{ flex: 1, fontFamily: 'Courier New, monospace' }}>{label}</span>
                  <span style={{ fontSize: 9, color: on ? col : 'rgba(255,255,255,0.2)', opacity: 0.75 }}>{desc}</span>
                  <span style={{ fontSize: 10, color: on ? col : 'rgba(255,255,255,0.22)', marginLeft: 8, minWidth: 18, textAlign: 'right' }}>
                    {on ? 'on' : 'off'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Join dropdown panel ───────────────────────────────────────── */}
        {openMenu === 'join' && (
          <div style={{
            position: 'absolute', top: 36, left: menuPos.x, zIndex: 100,
            background: 'rgba(16,22,48,0.98)', backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6,
            boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
            minWidth: 170, padding: '4px 0',
            fontFamily: 'Courier New, monospace',
          }}>
            {[
              { op: 'add',       label: 'Add',       icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="5" cy="8" r="4"/><circle cx="10" cy="8" r="4"/></svg>, desc: 'Union of all shapes',         col: '#4ADE80', bg: 'rgba(34,197,94,0.15)'    },
              { op: 'subtract',  label: 'Subtract',  icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="5" cy="8" r="4"/><circle cx="10" cy="8" r="4" strokeDasharray="2 1.5"/><line x1="10" y1="4" x2="10" y2="12" strokeWidth="1" opacity="0.5"/></svg>, desc: 'Subtract from first shape',   col: '#FB923C', bg: 'rgba(251,146,60,0.15)'   },
              { op: 'intersect', label: 'Intersect', icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="5" cy="8" r="4"/><circle cx="10" cy="8" r="4"/><path d="M7.5 4.3 A4 4 0 0 1 7.5 11.7 A4 4 0 0 1 7.5 4.3" fill="currentColor" fillOpacity="0.3" stroke="none"/></svg>, desc: 'Keep overlapping area only',  col: '#60A5FA', bg: 'rgba(96,165,250,0.15)'   },
              { op: 'xor',       label: 'XOR',       icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="5" cy="8" r="4" fill="currentColor" fillOpacity="0.2"/><circle cx="10" cy="8" r="4" fill="currentColor" fillOpacity="0.2"/><path d="M7.5 4.3 A4 4 0 0 1 7.5 11.7 A4 4 0 0 1 7.5 4.3" fill="rgba(16,22,48,1)" stroke="none"/></svg>, desc: 'Keep non-overlapping parts',  col: '#C084FC', bg: 'rgba(192,132,252,0.15)'  },
              { op: 'divide',    label: 'Divide',    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="5" cy="8" r="4"/><circle cx="10" cy="8" r="4"/><line x1="7.5" y1="4" x2="7.5" y2="12" strokeDasharray="1.5 1" strokeWidth="1.2"/></svg>, desc: 'Split at intersections',      col: '#F9A8D4', bg: 'rgba(249,168,212,0.15)'  },
            ].map(({ op, label, icon, desc, col, bg }) => (
              <button key={op}
                onClick={() => {
                  setOpenMenu(null);
                  const sel = shapes.filter(s => selectedIds.includes(s.id));
                  const results = performJoin(op, sel);
                  if (results && results.length > 0) {
                    const remaining = shapes.filter(s => !selectedIds.includes(s.id));
                    const next = [...remaining, ...results];
                    commitShapes(next);
                    setSelectedIds(results.map(r => r.id));
                  }
                }}
                style={{
                  width: '100%', height: 38, display: 'flex', alignItems: 'center',
                  gap: 10, padding: '0 14px', background: 'transparent',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  color: 'rgba(255,255,255,0.65)', fontSize: 11,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = bg; e.currentTarget.style.color = col; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; }}
              >
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, flexShrink: 0 }}>{icon}</span>
                <span style={{ flex: 1 }}>{label}</span>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Scrollable inner button row ──────────────────────────────── */}
        <div style={{
          height: '100%', display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px',
          overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          position: 'relative', zIndex: 99,
        }}>

          {/* Snap ▾ dropdown button */}
          <button
            onClick={e => {
              const btnRect = e.currentTarget.getBoundingClientRect();
              const barRect = toolbarRef.current ? toolbarRef.current.getBoundingClientRect() : { left: 0 };
              setMenuPos({ x: btnRect.left - barRect.left });
              setOpenMenu(m => m === 'snap' ? null : 'snap');
            }}
            title="Snap modes"
            style={{
              height: 26, padding: '0 8px', borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 4,
              background: anySnapActive ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${anySnapActive ? 'rgba(34,197,94,0.55)' : 'rgba(255,255,255,0.14)'}`,
              color: anySnapActive ? '#4ADE80' : 'rgba(255,255,255,0.45)',
              cursor: 'pointer', fontSize: 11,
              fontFamily: 'Courier New, monospace', outline: 'none', transition: 'all 0.15s',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="5"/><circle cx="7" cy="7" r="2" fill="currentColor" fillOpacity="0.7"/><line x1="7" y1="1" x2="7" y2="3" strokeWidth="1.2"/><line x1="7" y1="11" x2="7" y2="13" strokeWidth="1.2"/><line x1="1" y1="7" x2="3" y2="7" strokeWidth="1.2"/><line x1="11" y1="7" x2="13" y2="7" strokeWidth="1.2"/></svg>
            <span style={{ letterSpacing: '0.03em' }}>Snap</span>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.5, marginLeft: 1 }}><polyline points="1 2.5 4 5.5 7 2.5"/></svg>
          </button>
          {/* Separator */}
          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', margin: '0 2px', flexShrink: 0 }} />

          {/* Join ▾ dropdown button — only visible when 2+ shapes selected */}
          {selectedIds.length >= 2 && (
            <button
              onClick={e => {
                const btnRect = e.currentTarget.getBoundingClientRect();
                const barRect = toolbarRef.current ? toolbarRef.current.getBoundingClientRect() : { left: 0 };
                setMenuPos({ x: btnRect.left - barRect.left });
                setOpenMenu(m => m === 'join' ? null : 'join');
              }}
              title="Boolean join operations"
              style={{
                height: 26, padding: '0 8px', borderRadius: 4, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 4,
                background: openMenu === 'join' ? 'rgba(249,168,212,0.2)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${openMenu === 'join' ? 'rgba(249,168,212,0.6)' : 'rgba(255,255,255,0.14)'}`,
                color: openMenu === 'join' ? '#F9A8D4' : 'rgba(255,255,255,0.55)',
                cursor: 'pointer', fontSize: 11,
                fontFamily: 'Courier New, monospace', outline: 'none',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="5" cy="7.5" r="4"/><circle cx="10" cy="7.5" r="4"/></svg>
              <span style={{ letterSpacing: '0.03em' }}>Join</span>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.5, marginLeft: 1 }}><polyline points="1 2.5 4 5.5 7 2.5"/></svg>
            </button>
          )}

          {/* ── Pencil tool context controls ────────────────────────────────── */}
          {tool === 'pencil' && (
            <>
              {/* Stabilizer mode toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                {[{ id: 'rope', label: 'Rope', title: 'Rope stabilizer: lag-based smoothing' },
                  { id: 'window', label: 'Window', title: 'Window stabilizer: moving average' }].map(m => (
                  <button key={m.id}
                    onClick={() => setStabilizerMode(m.id)}
                    title={m.title}
                    style={{
                      height: 22, padding: '0 8px', borderRadius: 3, fontSize: 10,
                      fontFamily: 'Courier New, monospace',
                      background: stabilizerMode === m.id ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${stabilizerMode === m.id ? 'rgba(99,102,241,0.7)' : 'rgba(255,255,255,0.14)'}`,
                      color: stabilizerMode === m.id ? '#A5B4FC' : 'rgba(255,255,255,0.45)',
                      cursor: 'pointer', outline: 'none',
                    }}
                  >{m.label}</button>
                ))}
              </div>
              {/* Rope length / Window size control */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Courier New, monospace' }}>
                  {stabilizerMode === 'rope' ? 'Lag' : 'Win'}
                </span>
                <input type="range" min={1} max={stabilizerMode === 'rope' ? 80 : 20} step={1}
                  value={stabilizerMode === 'rope' ? ropeLength : windowSize}
                  onChange={e => stabilizerMode === 'rope'
                    ? setRopeLength(Number(e.target.value))
                    : setWindowSize(Number(e.target.value))}
                  style={{ width: 60, cursor: 'pointer', accentColor: '#818CF8' }}
                />
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Courier New, monospace', minWidth: 18 }}>
                  {stabilizerMode === 'rope' ? ropeLength : windowSize}
                </span>
              </div>
              {/* Smoothness control */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Courier New, monospace' }}>Smooth</span>
                <input type="range" min={0} max={100} step={5}
                  value={Math.round(pencilSmoothness * 100)}
                  onChange={e => setPencilSmoothness(Number(e.target.value) / 100)}
                  style={{ width: 60, cursor: 'pointer', accentColor: '#818CF8' }}
                />
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Courier New, monospace', minWidth: 22 }}>
                  {Math.round(pencilSmoothness * 100)}%
                </span>
              </div>
            </>
          )}

          {/* ── Pen tool context controls ───────────────────────────────────── */}
          {tool === 'pen' && (
            <>
              {[{ id: 'bezier', label: 'Bézier', title: 'Click to place node; click+drag to pull smooth handles' },
                { id: 'smart',  label: 'Smart',  title: 'Click to place nodes; handles auto-calculated for smooth curves' },
                { id: 'corner', label: 'Corner', title: 'Click to place sharp corner nodes — produces straight line segments' }].map(m => (
                <button key={m.id}
                  onClick={() => setPenMode(m.id)}
                  title={m.title}
                  style={{
                    height: 22, padding: '0 8px', borderRadius: 3, fontSize: 10,
                    fontFamily: 'Courier New, monospace',
                    background: penMode === m.id ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${penMode === m.id ? 'rgba(59,130,246,0.7)' : 'rgba(255,255,255,0.14)'}`,
                    color: penMode === m.id ? '#93C5FD' : 'rgba(255,255,255,0.45)',
                    cursor: 'pointer', outline: 'none', flexShrink: 0,
                  }}
                >{m.label}</button>
              ))}
              {penNodes.length > 0 && (
                <>
                  <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', margin: '0 2px', flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'Courier New, monospace', flexShrink: 0 }}>
                    {penNodes.length} node{penNodes.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => commitPenPath(false)}
                    title="Commit open path (Enter)"
                    style={{
                      height: 22, padding: '0 9px', borderRadius: 3, fontSize: 10,
                      fontFamily: 'Courier New, monospace',
                      background: 'rgba(34,197,94,0.25)',
                      border: '1px solid rgba(34,197,94,0.55)',
                      color: '#86EFAC', cursor: 'pointer', outline: 'none', flexShrink: 0,
                    }}
                  >✓ Done</button>
                  <button
                    onClick={() => { setPenNodes([]); setPenPhase('point'); setPenCursor(null); }}
                    title="Cancel path (Escape)"
                    style={{
                      height: 22, padding: '0 8px', borderRadius: 3, fontSize: 10,
                      fontFamily: 'Courier New, monospace',
                      background: 'rgba(239,68,68,0.18)',
                      border: '1px solid rgba(239,68,68,0.45)',
                      color: '#FCA5A5', cursor: 'pointer', outline: 'none', flexShrink: 0,
                    }}
                  >✕ Cancel</button>
                </>
              )}
            </>
          )}

          {/* ── Node tool context controls ─────────────────────────────────── */}
          {tool === 'node' && nodeSelectedId && nodeSelectedIdx !== null && (() => {
            const pathShape = shapes.find(s => s.id === nodeSelectedId);
            const node = pathShape && pathShape.nodes && pathShape.nodes[nodeSelectedIdx];
            if (!node) return null;
            return (
              <>
                <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', margin: '0 2px', flexShrink: 0 }} />
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'Courier New, monospace', flexShrink: 0 }}>Node:</span>
                {[{ id: 'sharp', label: 'Sharp', title: 'Sharp corner node — handles are independent' },
                  { id: 'smooth', label: 'Smooth', title: 'Smooth node — handles mirror each other' },
                  { id: 'cusp', label: 'Cusp', title: 'Cusp node — handles are independent but shown' }].map(t => (
                  <button key={t.id}
                    onClick={() => {
                      setShapes(prev => prev.map(s => {
                        if (s.id !== nodeSelectedId || !s.nodes) return s;
                        const nodes = s.nodes.map((n, i) => i === nodeSelectedIdx ? { ...n, type: t.id } : n);
                        return { ...s, nodes };
                      }));
                      commitShapes(shapes.map(s => {
                        if (s.id !== nodeSelectedId || !s.nodes) return s;
                        const nodes = s.nodes.map((n, i) => i === nodeSelectedIdx ? { ...n, type: t.id } : n);
                        return { ...s, nodes };
                      }));
                    }}
                    title={t.title}
                    style={{
                      height: 22, padding: '0 7px', borderRadius: 3, fontSize: 10,
                      fontFamily: 'Courier New, monospace',
                      background: node.type === t.id ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${node.type === t.id ? 'rgba(99,102,241,0.7)' : 'rgba(255,255,255,0.14)'}`,
                      color: node.type === t.id ? '#A5B4FC' : 'rgba(255,255,255,0.45)',
                      cursor: 'pointer', outline: 'none', flexShrink: 0,
                    }}
                  >{t.label}</button>
                ))}
                <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', margin: '0 2px', flexShrink: 0 }} />
                {/* Delete selected node */}
                <button
                  onClick={() => {
                    if (!pathShape || !pathShape.nodes) return;
                    const newNodes = pathShape.nodes.filter((_, i) => i !== nodeSelectedIdx);
                    if (newNodes.length < 2) {
                      commitShapes(shapes.filter(s => s.id !== nodeSelectedId));
                      setNodeSelectedId(null);
                    } else {
                      commitShapes(shapes.map(s => s.id === nodeSelectedId ? { ...s, nodes: newNodes } : s));
                    }
                    setNodeSelectedIdx(null);
                  }}
                  title="Delete selected node"
                  style={{
                    height: 22, padding: '0 7px', borderRadius: 3, fontSize: 10,
                    fontFamily: 'Courier New, monospace',
                    background: 'rgba(239,68,68,0.15)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    color: '#FCA5A5', cursor: 'pointer', outline: 'none', flexShrink: 0,
                  }}
                >Del Node</button>
              </>
            );
          })()}

          {/* ── Dimension tool context controls ─────────────────────────── */}
          {['dim-linear', 'dim-angle', 'dim-bearing', 'dim-radius'].includes(tool) && (<>
            <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', margin: '0 2px', flexShrink: 0 }} />
            {tool === 'dim-linear' && (
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'Courier New, monospace', flexShrink: 0 }}>
                {drawState ? 'click P2' : 'click P1'}
              </span>
            )}
            {tool === 'dim-angle' && (
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'Courier New, monospace', flexShrink: 0 }}>
                {!drawState ? 'click a line' : drawState.phase === 1 ? 'click 2nd line' : 'click to confirm side'}
              </span>
            )}
            {tool === 'dim-bearing' && (
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'Courier New, monospace', flexShrink: 0 }}>
                {drawState ? 'click P2' : 'click P1'}
              </span>
            )}
            {tool === 'dim-radius' && (
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'Courier New, monospace', flexShrink: 0 }}>click circle or arc</span>
            )}
            {/* North azimuth: relevant to bearing dims */}
            {tool === 'dim-bearing' && (<>
              <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', margin: '0 4px', flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Courier New, monospace', flexShrink: 0 }}>N:</span>
              <input
                type="number" min={0} max={359} step={1}
                value={northAzimuth}
                onChange={e => {
                  const v = ((Number(e.target.value) % 360) + 360) % 360;
                  setNorthAzimuth(v);
                  persist(undefined, undefined, undefined, { northAzimuth: v });
                }}
                title="True North azimuth — clockwise degrees from screen-up"
                style={{
                  width: 44, height: 22, borderRadius: 3, fontSize: 10, textAlign: 'center',
                  fontFamily: 'Courier New, monospace', outline: 'none',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: 'rgba(255,255,255,0.7)',
                }}
              />
              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', fontFamily: 'Courier New, monospace', flexShrink: 0 }}>°</span>
            </>)}
          </>)}

          {/* ── Undo / Redo buttons ─────────────────────────────────────── */}
          <button
            onClick={() => {
              if (!canUndo) return;
              setShapesHistory(h => {
                const prev = h.past[h.past.length - 1];
                setShapes(prev);
                persist(prev, undefined);
                setSelectedIds([]);
                return { past: h.past.slice(0, -1), future: [shapes, ...h.future] };
              });
            }}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            style={{
              height: 26, padding: '0 8px', borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 4,
              background: canUndo ? 'rgba(255,255,255,0.06)' : 'transparent',
              border: `1px solid ${canUndo ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)'}`,
              color: canUndo ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)',
              cursor: canUndo ? 'pointer' : 'default', fontSize: 15,
              fontFamily: 'Courier New, monospace', outline: 'none',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6"/>
              <path d="M3 13C5 8 10 5 16 6a9 9 0 0 1 5 8"/>
            </svg>
          </button>
          <button
            onClick={() => {
              if (!canRedo) return;
              setShapesHistory(h => {
                const next = h.future[0];
                setShapes(next);
                persist(next, undefined);
                setSelectedIds([]);
                return { past: [...h.past, shapes], future: h.future.slice(1) };
              });
            }}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            style={{
              height: 26, padding: '0 8px', borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 4,
              background: canRedo ? 'rgba(255,255,255,0.06)' : 'transparent',
              border: `1px solid ${canRedo ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)'}`,
              color: canRedo ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)',
              cursor: canRedo ? 'pointer' : 'default', fontSize: 15,
              fontFamily: 'Courier New, monospace', outline: 'none',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6"/>
              <path d="M21 13C19 8 14 5 8 6a9 9 0 0 0-5 8"/>
            </svg>
          </button>

          {/* ── View menu button ────────────────────────────────────────── */}          <button
            onClick={e => {
              const btnRect = e.currentTarget.getBoundingClientRect();
              const barRect = toolbarRef.current ? toolbarRef.current.getBoundingClientRect() : { left: 0 };
              setMenuPos({ x: btnRect.left - barRect.left });
              setOpenMenu(m => m === 'view' ? null : 'view');
            }}
            title="View options — Grid, Dims, Card, Scale Bar"
            style={{
              height: 26, padding: '0 10px', borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 5,
              background: openMenu === 'view'
                ? 'rgba(255,255,255,0.14)'
                : (showGrid || showDims || showValueCard || showScaleBar)
                  ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${openMenu === 'view' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.14)'}`,
              color: openMenu === 'view' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer', fontSize: 11,
              fontFamily: 'Courier New, monospace', outline: 'none',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1" y="1" width="12" height="12" rx="1.5"/><line x1="1" y1="5" x2="13" y2="5" strokeWidth="1.2"/><line x1="5" y1="5" x2="5" y2="13" strokeWidth="1.2"/></svg>
            <span style={{ letterSpacing: '0.03em' }}>View</span>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.5, marginLeft: 1 }}><polyline points="1 2.5 4 5.5 7 2.5"/></svg>
          </button>

          {/* ── Scale menu button ─────────────────────────────────────── */}
          <button
            onClick={e => {
              const btnRect = e.currentTarget.getBoundingClientRect();
              const barRect = toolbarRef.current ? toolbarRef.current.getBoundingClientRect() : { left: 0 };
              setMenuPos({ x: btnRect.left - barRect.left });
              setOpenMenu(m => m === 'scale' ? null : 'scale');
            }}
            title="Scale &amp; units"
            style={{
              height: 26, padding: '0 10px', borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 5,
              background: openMenu === 'scale' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${openMenu === 'scale' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.14)'}`,
              color: openMenu === 'scale' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer', fontSize: 11,
              fontFamily: 'Courier New, monospace', outline: 'none',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1" y="4" width="12" height="6" rx="1"/><line x1="4" y1="4" x2="4" y2="10" strokeWidth="1"/><line x1="7" y1="4" x2="7" y2="10" strokeWidth="1"/><line x1="10" y1="4" x2="10" y2="10" strokeWidth="1"/></svg>
            <span style={{ letterSpacing: '0.03em' }}>Scale</span>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.5, marginLeft: 1 }}><polyline points="1 2.5 4 5.5 7 2.5"/></svg>
          </button>

          {/* ── Line settings button ──────────────────────────────────── */}
          <button
            onClick={e => {
              const btnRect = e.currentTarget.getBoundingClientRect();
              const barRect = toolbarRef.current ? toolbarRef.current.getBoundingClientRect() : { left: 0 };
              setMenuPos({ x: btnRect.left - barRect.left });
              setOpenMenu(m => m === 'stroke' ? null : 'stroke');
            }}
            title="Line thickness & style"
            style={{
              height: 26, padding: '0 10px', borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 5,
              background: openMenu === 'stroke' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${openMenu === 'stroke' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.14)'}`,
              color: openMenu === 'stroke' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer', fontSize: 11,
              fontFamily: 'Courier New, monospace', outline: 'none',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="2" y1="4" x2="12" y2="4" strokeWidth="2.5"/><line x1="2" y1="7" x2="12" y2="7" strokeWidth="1.5"/><line x1="2" y1="10" x2="12" y2="10" strokeWidth="0.8"/></svg>
            <span style={{ letterSpacing: '0.03em' }}>Line</span>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.5, marginLeft: 1 }}><polyline points="1 2.5 4 5.5 7 2.5"/></svg>
          </button>

          {/* Zoom % readout */}
          <span style={{
            fontSize: 10, fontFamily: 'Courier New, monospace', letterSpacing: '0.03em',
            color: 'rgba(255,255,255,0.35)', minWidth: 34, textAlign: 'right',
            userSelect: 'none', flexShrink: 0,
          }}>
            {Math.round((svgSizeRef.current.w / viewBox.w) * 100)}%
          </span>

          {/* Pan hint */}
          {isPanActive && (
            <span style={{
              fontSize: 10, fontFamily: 'Courier New, monospace',
              color: 'rgba(255,255,255,0.35)', marginLeft: 4, flexShrink: 0,
            }}>panning…</span>
          )}

        </div>
      </div>

      {/* Main sketch area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Tool Ribbon ──────────────────────────────────────────────── */}
        <div className="sketch-ribbon" style={{
          width: ribbonOpen ? 52 : 20,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(30,40,80,0.92)',
          backdropFilter: 'blur(6px)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          transition: 'width 0.2s ease',
          overflow: 'hidden',
          zIndex: 10,
        }}>
          {/* Toggle button */}
          <button
            onClick={() => setRibbonOpen(o => !o)}
            style={{
              height: 32, flexShrink: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'rgba(255,255,255,0.5)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              fontSize: 11, background: 'none', border: 'none',
              cursor: 'pointer', width: '100%',
            }}
            title={ribbonOpen ? 'Hide toolbar' : 'Show toolbar'}
          >
            {ribbonOpen ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 1 3 5 7 9"/></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 1 7 5 3 9"/></svg>
            )}
          </button>

          {/* Tool buttons — scrollable column */}
          {ribbonOpen && (
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {TOOLS.map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    // If a pen path is in progress, commit it as an open path before switching
                    if (tool === 'pen' && penNodes.length >= 2) {
                      commitPenPath(false);
                    } else if (tool === 'pen') {
                      setPenNodes([]); setPenCursor(null); setPenPhase('point');
                    }
                    // Preserve selection when toggling between select ↔ node tools
                    const togglingSelectNode =
                      (tool === 'select' && t.id === 'node') ||
                      (tool === 'node'   && t.id === 'select');
                    if (togglingSelectNode) {
                      // select → node: if a path shape is selected, enter node editing
                      if (t.id === 'node') {
                        const selPath = shapes.find(s => selectedIds.includes(s.id) && s.type === 'path');
                        if (selPath) { setNodeSelectedId(selPath.id); setNodeSelectedIdx(null); }
                      }
                      // node → select: carry nodeSelectedId into selectedIds so the shape stays highlighted
                      if (t.id === 'select' && nodeSelectedId) {
                        setSelectedIds(prev => prev.includes(nodeSelectedId) ? prev : [nodeSelectedId, ...prev]);
                        setNodeSelectedId(null);
                      }
                      setTool(t.id); setDrawState(null); setPrevTool(null);
                    } else {
                      setTool(t.id); setSelectedIds([]); setDrawState(null); setPrevTool(null);
                      setNodeSelectedId(null); setNodeSelectedIdx(null);
                    }
                  }}
                  title={t.label}
                  style={{
                    width: 52, height: 46, flexShrink: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 2,
                    background: tool === t.id ? 'rgba(59,130,246,0.28)' : 'none',
                    borderLeft: tool === t.id ? '2px solid #3B82F6' : '2px solid transparent',
                    borderTop: 'none', borderRight: 'none', borderBottom: 'none',
                    color: tool === t.id ? '#93C5FD' : 'rgba(255,255,255,0.55)',
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{t.icon}</span>
                  <span style={{ fontSize: 7, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1 }}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Delete selected — pinned at bottom, outside the scroll area */}
          {ribbonOpen && selectedIds.length > 0 && (
            <button
              onClick={() => { commitShapes(shapes.filter(s => !selectedIds.includes(s.id))); setSelectedIds([]); }}
              title="Delete selected"
              style={{
                flexShrink: 0, width: 52, height: 40,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 2,
                background: 'rgba(239,68,68,0.15)', border: 'none',
                borderTop: '1px solid rgba(255,255,255,0.07)',
                color: '#FCA5A5', cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </span>
              <span style={{ fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Del</span>
            </button>
          )}
        </div>

        {/* ── SVG drawing surface ──────────────────────────────────────── */}
        {/* touchAction:'none' on the wrapper (not just the SVG) is required for mobile.
            The browser resolves touch-action by walking up from the touch target — any
            ancestor with touch-action:auto lets the browser intercept pinch/pan before
            our pointer events fire. Setting it here covers SVG children + overlays. */}
        <div ref={svgWrapRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', touchAction: 'none', backgroundColor: '#FEFEFE' }}>

          {/* North arrow */}
          {showNorthArrow && (
          <div style={{ position: 'absolute', top: 10, right: 14, opacity: 0.28, display: 'flex',
            flexDirection: 'column', alignItems: 'center', color: '#3B5BDB',
            fontFamily: 'Courier New, monospace', fontSize: 11, pointerEvents: 'none', zIndex: 2 }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>↑</span>
            <span style={{ fontWeight: 700, lineHeight: 1 }}>N</span>
          </div>
          )}

          {/* Empty hint */}
          {shapes.length === 0 && !drawState && (
            <div style={{ position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%,-50%)', textAlign: 'center',
              opacity: 0.2, pointerEvents: 'none' }}>
              <p style={{ fontSize: 13, color: '#3B5BDB', fontFamily: 'Courier New, monospace' }}>
                Select a tool and sketch
              </p>
            </div>
          )}

          <svg
            ref={svgRef}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            preserveAspectRatio="none"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              cursor: isPanActive ? 'grabbing'
                     : activePtrsRef.current.size >= 2 ? 'move'
                     : cursorMap[tool] || 'crosshair',
              touchAction: 'none',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDblClick}
          >
            {/* Background color — rendered below grid and shapes */}
            {bgColor && (
              <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h}
                fill={bgColor} style={{ pointerEvents: 'none' }} />
            )}

            {/* Dynamic grid — rendered below everything */}
            {showGrid && renderGrid()}

            {/* Committed shapes — rendered in layer order, bottom to top */}
            {layers.map(layer => layer.visible && (
              <g key={layer.id}>
                {shapes
                  .filter(s => (s.layerId || layers[0]?.id) === layer.id && s.visible !== false)
                  .map(s => renderShape(s, selectedIds.includes(s.id)))}
              </g>
            ))}

            {/* Dimension labels — rendered above shapes, below handles */}
            {showDims && shapes.map(s => {
              if (s.visible === false) return null;
              const layer = layers.find(l => l.id === (s.layerId || layers[0]?.id));
              if (!layer?.visible) return null;
              const lbl = renderDimLabel(s);
              return lbl ? <g key={`dim-${s.id}`}>{lbl}</g> : null;
            })}

            {/* Marquee selection rectangle */}
            {marquee && marquee.w > 0 && marquee.h > 0 && (
              <rect
                x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h}
                fill="rgba(59,130,246,0.08)" stroke="#3B82F6"
                strokeWidth={viewBox.w / (svgSizeRef.current.w || viewBox.w)}
                strokeDasharray={`${4 * viewBox.w / (svgSizeRef.current.w || viewBox.w)} ${3 * viewBox.w / (svgSizeRef.current.w || viewBox.w)}`}
                style={{ pointerEvents: 'none' }}
              />
            )}

            {/* Node handles for selected shape.
                Shows in select mode OR when prevTool is set (shape just created —
                tool hasn't switched, but we need handles immediately). */}
            {/* Multi-select: group bounding box + group rotate handle + per-shape handles */}
            {(tool === 'select' || prevTool !== null) && selectedIds.length >= 2 && (() => {
              const selShapes = shapes.filter(s => selectedIds.includes(s.id));
              return <>
                {renderGroupControls(selShapes)}
                {selShapes.map(s =>
                  <React.Fragment key={s.id}>
                    {renderNodes(s, { suppressPivotRotate: true })}
                  </React.Fragment>
                )}
              </>;
            })()}
            {/* Single-select: full handles (geometry + pivot + rotate) */}
            {selectedShape && selectedIds.length <= 1 && (tool === 'select' || tool === 'text' || prevTool !== null || (tool === 'node' && selectedShape.type !== 'path')) && renderNodes(selectedShape)}

            {/* Preview shape while drawing */}
            {renderPreview()}

            {/* Pen tool: in-progress path + rubber band + handle lines */}
            {tool === 'pen' && penNodes.length > 0 && (() => {
              const _ps = viewBox.w / (svgSizeRef.current.w || viewBox.w);
              const allNodes = penNodes;
              // Committed segments so far
              const committedD = allNodes.length >= 2 ? pathToSVGD(allNodes, false) : null;
              // Rubber band: last node → cursor, only in 'point' phase (in 'handle' phase
              // the cursor IS the handle so don't draw a line to it as a point preview)
              const lastN = allNodes[allNodes.length - 1];
              const rubberBandD = penCursor && lastN && penPhase === 'point' ? (() => {
                const cp1x = lastN.cp2x !== undefined ? lastN.cp2x : lastN.x;
                const cp1y = lastN.cp2y !== undefined ? lastN.cp2y : lastN.y;
                return `M ${lastN.x.toFixed(2)} ${lastN.y.toFixed(2)} C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${penCursor.x.toFixed(2)} ${penCursor.y.toFixed(2)} ${penCursor.x.toFixed(2)} ${penCursor.y.toFixed(2)}`;
              })() : null;
              return (
                <g style={{ pointerEvents: 'none' }}>
                  {/* Committed path segments */}
                  {committedD && (
                    <path d={committedD} stroke={STROKE} strokeWidth={STROKE_W * _ps}
                      fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
                  )}
                  {/* Rubber band to cursor */}
                  {rubberBandD && (
                    <path d={rubberBandD} stroke={STROKE} strokeWidth={STROKE_W * _ps}
                      fill="none" strokeLinecap="round" strokeLinejoin="round"
                      strokeDasharray={`${5*_ps},${3*_ps}`} opacity={0.5} />
                  )}
                  {/* Handle lines and control points */}
                  {allNodes.map((n, i) => {
                    const hasHandles = n.type === 'smooth' || n.type === 'cusp';
                    return (
                      <g key={i}>
                        {/* Node dot */}
                        <circle cx={n.x} cy={n.y} r={4 * _ps}
                          fill="rgba(59,130,246,0.9)" stroke="white" strokeWidth={_ps} />
                        {/* Handle lines */}
                        {hasHandles && n.cp2x !== n.x && (
                          <>
                            <line x1={n.x} y1={n.y} x2={n.cp2x} y2={n.cp2y}
                              stroke="rgba(59,130,246,0.5)" strokeWidth={_ps} />
                            <circle cx={n.cp2x} cy={n.cp2y} r={3 * _ps}
                              fill="rgba(59,130,246,0.7)" stroke="white" strokeWidth={_ps} />
                          </>
                        )}
                        {hasHandles && n.cp1x !== n.x && i > 0 && (
                          <>
                            <line x1={n.x} y1={n.y} x2={n.cp1x} y2={n.cp1y}
                              stroke="rgba(59,130,246,0.5)" strokeWidth={_ps} />
                            <circle cx={n.cp1x} cy={n.cp1y} r={3 * _ps}
                              fill="rgba(59,130,246,0.7)" stroke="white" strokeWidth={_ps} />
                          </>
                        )}
                      </g>
                    );
                  })}
                  {/* First node close indicator */}
                  {penNodes.length >= 2 && penCursor && (() => {
                    const fn = penNodes[0];
                    const closeDist = 12 * _ps;
                    const near = Math.hypot(penCursor.x - fn.x, penCursor.y - fn.y) < closeDist;
                    return near ? (
                      <circle cx={fn.x} cy={fn.y} r={7 * _ps}
                        fill="none" stroke="#22C55E" strokeWidth={1.5 * _ps} opacity={0.9} />
                    ) : null;
                  })()}
                </g>
              );
            })()}

            {/* Node tool: node handles for the selected path */}
            {tool === 'node' && nodeSelectedId && (() => {
              const pathShape = shapes.find(s => s.id === nodeSelectedId);
              if (!pathShape || !pathShape.nodes) return null;
              const _ps = viewBox.w / (svgSizeRef.current.w || viewBox.w);
              return (
                <g style={{ pointerEvents: 'none' }}>
                  {pathShape.nodes.map((n, i) => {
                    const isSelected = i === nodeSelectedIdx;
                    const hasHandles = n.type !== 'sharp';
                    return (
                      <g key={i}>
                        {/* cp1 handle line + dot */}
                        {hasHandles && (Math.abs(n.cp1x - n.x) > 0.5 || Math.abs(n.cp1y - n.y) > 0.5) && (
                          <>
                            <line x1={n.x} y1={n.y} x2={n.cp1x} y2={n.cp1y}
                              stroke="rgba(99,102,241,0.6)" strokeWidth={_ps} />
                            <circle cx={n.cp1x} cy={n.cp1y} r={3.5 * _ps}
                              fill="rgba(99,102,241,0.8)" stroke="white" strokeWidth={_ps} />
                          </>
                        )}
                        {/* cp2 handle line + dot */}
                        {hasHandles && (Math.abs(n.cp2x - n.x) > 0.5 || Math.abs(n.cp2y - n.y) > 0.5) && (
                          <>
                            <line x1={n.x} y1={n.y} x2={n.cp2x} y2={n.cp2y}
                              stroke="rgba(99,102,241,0.6)" strokeWidth={_ps} />
                            <circle cx={n.cp2x} cy={n.cp2y} r={3.5 * _ps}
                              fill="rgba(99,102,241,0.8)" stroke="white" strokeWidth={_ps} />
                          </>
                        )}
                        {/* On-curve node */}
                        <rect
                          x={n.x - 4 * _ps} y={n.y - 4 * _ps}
                          width={8 * _ps} height={8 * _ps}
                          fill={isSelected ? '#3B82F6' : 'white'}
                          stroke={isSelected ? 'white' : '#3B82F6'}
                          strokeWidth={1.5 * _ps}
                          style={{ pointerEvents: 'all', cursor: 'move' }}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })()}

            {/* Snap indicator — per-type visual, counter-scaled so it stays
                constant visual size in screen pixels regardless of zoom.
                endpoint:      green circle
                midpoint:      cyan diamond (rotated square)
                intersection:  orange X cross
                perpendicular: purple square
                grid:          yellow crosshair */}
            {anySnapActive && snapPoint && (() => {
              const _ps  = viewBox.w / (svgSizeRef.current.w || viewBox.w);
              const sx   = snapPoint.x, sy = snapPoint.y;
              const r    = 8 * _ps;
              const sw   = 1.5 * _ps;
              const type = snapPoint.type || 'endpoint';
              const colors = {
                endpoint:      '#22C55E',
                midpoint:      '#22D3EE',
                intersection:  '#FB923C',
                perpendicular: '#C084FC',
                tangent:       '#A78BFA',
                grid:          '#FCD34D',
              };
              const col = colors[type] || '#22C55E';
              let indicator;
              if (type === 'endpoint') {
                indicator = <>
                  <circle cx={sx} cy={sy} r={r} fill="none" stroke={col} strokeWidth={sw} opacity={0.9} />
                  <circle cx={sx} cy={sy} r={2.5 * _ps} fill={col} opacity={0.9} />
                </>;
              } else if (type === 'midpoint') {
                // Cyan diamond — rotated 45° square
                const d = r * 0.82;
                indicator = <polygon
                  points={`${sx},${sy-d} ${sx+d},${sy} ${sx},${sy+d} ${sx-d},${sy}`}
                  fill="none" stroke={col} strokeWidth={sw} opacity={0.9} />;
              } else if (type === 'intersection') {
                // Orange "on-object" — circle with horizontal bar through it
                indicator = <>
                  <circle cx={sx} cy={sy} r={r * 0.82} fill="none" stroke={col} strokeWidth={sw} opacity={0.9} />
                  <line x1={sx - r * 1.15} y1={sy} x2={sx + r * 1.15} y2={sy}
                    stroke={col} strokeWidth={sw} opacity={0.9} strokeLinecap="round" />
                </>;
              } else if (type === 'perpendicular') {
                // Purple square
                const d = r * 0.72;
                indicator = <rect x={sx-d} y={sy-d} width={2*d} height={2*d}
                  fill="none" stroke={col} strokeWidth={sw} opacity={0.9} />;
              } else if (type === 'tangent') {
                // Violet arc (open semicircle) with centre dot — tangent-to-circle marker
                const d = r * 0.82;
                indicator = <>
                  <path d={`M ${sx - d} ${sy} A ${d} ${d} 0 0 1 ${sx + d} ${sy}`}
                    fill="none" stroke={col} strokeWidth={sw} opacity={0.9} strokeLinecap="round" />
                  <circle cx={sx} cy={sy} r={2.5 * _ps} fill={col} opacity={0.9} />
                </>;
              } else {
                // Grid — yellow crosshair
                indicator = <>
                  <line x1={sx-r} y1={sy} x2={sx+r} y2={sy} stroke={col} strokeWidth={sw} opacity={0.9} strokeLinecap="round" />
                  <line x1={sx} y1={sy-r} x2={sx} y2={sy+r} stroke={col} strokeWidth={sw} opacity={0.9} strokeLinecap="round" />
                  <circle cx={sx} cy={sy} r={2.5 * _ps} fill={col} opacity={0.75} />
                </>;
              }
              return <g style={{ pointerEvents: 'none' }}>{indicator}</g>;
            })()}
          </svg>

          {/* ── Scale Bar overlay ────────────────────────────────────────────── */}
          {showScaleBar && scaleDenom > 0 && (() => {
            const _ps = viewBox.w / (svgSizeRef.current.w || viewBox.w);
            const niceVal    = niceScaleBarValue(scaleDenom, viewBox.w, svgSizeRef.current.w, units);
            const barWorldPx = realToPx(niceVal, scaleDenom, units);
            const barScreenW = Math.max(4, Math.round(barWorldPx / _ps));
            const unitLabel  = units === 'ft' ? "'" : ' m';
            const niceStr    = niceVal < 1
              ? niceVal.toFixed(niceVal < 0.01 ? 3 : 2)
              : niceVal >= 1000 ? (niceVal / 1000).toFixed(1) + (units === 'm' ? ' km' : "'")
              : String(niceVal);
            // The canvas background is light (#FEFEFE grid paper) so we use dark ink
            // colours and a semi-opaque backdrop pill for contrast.
            return (
              <div style={{
                position: 'absolute', bottom: 12, right: 16,
                pointerEvents: 'none', zIndex: 12,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2,
                background: 'rgba(255,255,255,0.72)',
                border: '1px solid rgba(30,60,150,0.14)',
                borderRadius: 5, padding: '3px 7px',
                backdropFilter: 'blur(3px)',
              }}>
                {/* Ticked bar */}
                <svg width={barScreenW} height={7} style={{ overflow: 'visible', display: 'block' }}>
                  <line x1={0} y1={3.5} x2={barScreenW} y2={3.5}
                    stroke="rgba(20,50,140,0.7)" strokeWidth={1.5} />
                  <line x1={0}          y1={0.5} x2={0}          y2={6.5}
                    stroke="rgba(20,50,140,0.7)" strokeWidth={1.5} />
                  <line x1={barScreenW} y1={0.5} x2={barScreenW} y2={6.5}
                    stroke="rgba(20,50,140,0.7)" strokeWidth={1.5} />
                </svg>
                {/* Distance label */}
                <span style={{
                  fontSize: 8.5, fontFamily: 'Courier New, monospace',
                  color: 'rgba(20,50,140,0.70)', textAlign: 'center', letterSpacing: '0.03em',
                  width: '100%', textAlign: 'center',
                }}>{niceStr}{niceVal >= 1000 ? '' : unitLabel}</span>
              </div>
            );
          })()}

          {/* ── Shape Value Card ─────────────────────────────────────────────── */}
          {/* Curve draw-phase live preview (read-only badge) */}
          {showValueCard && (() => {
            if (!drawState || drawState.type !== 'curve' || drawState.phase !== 2) return null;
            const cp = computeArcFromPI(drawState.x1, drawState.y1,
                                       drawState.x2, drawState.y2, drawState.px, drawState.py);
            if (!cp) return null;
            const lStyle = { color: '#64748B', width: 46, flexShrink: 0, fontSize: 10 };
            const rStyle = { display: 'flex', gap: 5, alignItems: 'center', lineHeight: 1.6 };
            return (
              <div style={{
                position: 'absolute', bottom: 10, left: 10, pointerEvents: 'none',
                background: 'rgba(10,15,35,0.90)', border: '1px solid rgba(59,130,246,0.35)',
                borderRadius: 6, padding: '7px 11px',
                fontFamily: 'Courier New, monospace', fontSize: 10.5,
                color: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(5px)', zIndex: 15,
                lineHeight: 1.7, minWidth: 180, maxWidth: 230,
              }}>
                <div style={{ color: '#60A5FA', fontSize: 9.5, letterSpacing: '0.1em',
                  marginBottom: 4, textTransform: 'uppercase' }}>Curve Elements</div>
                {[
                  ['R',     formatReal(pxToReal(cp.R,     scaleDenom, units), units)],
                  ['Δ',     toDMS(cp.delta)],
                  ['T',     formatReal(pxToReal(cp.T,     scaleDenom, units), units)],
                  ['L',     formatReal(pxToReal(cp.L,     scaleDenom, units), units)],
                  ['M',     formatReal(pxToReal(cp.M,     scaleDenom, units), units)],
                  ['E',     formatReal(pxToReal(cp.E,     scaleDenom, units), units)],
                  ['Chord', formatReal(pxToReal(cp.chord, scaleDenom, units), units)],
                ].map(([lbl, val]) => (
                  <div key={lbl} style={rStyle}>
                    <span style={lStyle}>{lbl}</span>
                    <span style={{ fontSize: 10 }}>{val}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          {/* Committed-shape card — proper React component with controlled inputs */}
          {showValueCard && selectedShape && selectedShape.type !== 'text' && (
            <ShapeValueCard
              key={selectedShape.id}
              shape={selectedShape}
              onUpdate={handleCardUpdate}
              scaleDenom={scaleDenom}
              units={units}
              northAzimuth={northAzimuth}
            />
          )}

          {/* Inline text editor — absolutely positioned in SVG container.
              textEdit stores world coordinates; convert to screen pixels for CSS. */}
          {textEdit && (() => {
            const sp  = worldToScreen(textEdit.x, textEdit.y); // screen position of center
            // textEdit.w/h are screen pixels — use directly
            const screenW = Math.max(80,  textEdit.w || 180);
            const screenH = Math.max(40,  textEdit.h || 80);
            return (
            <div style={{
              position: 'absolute',
              // Offset by half-size so the overlay is centered on the world anchor
              left: sp.x - screenW / 2, top: sp.y - screenH / 2,
              width: screenW, height: screenH,
              zIndex: 20, pointerEvents: 'all',
            }}>
              <textarea
                ref={textareaRef}
                autoFocus
                value={textEdit.content}
                onChange={e => setTextEdit(te => ({ ...te, content: e.target.value }))}
                onBlur={commitText}
                onKeyDown={e => { if (e.key === 'Escape') setTextEdit(null); }}
                style={{
                  display: 'block',
                  width: '100%', height: '100%',
                  background: 'rgba(255,255,248,0.97)',
                  border: '1.5px dashed #3B82F6',
                  outline: 'none', resize: 'none',
                  fontFamily: 'Courier New, monospace', fontSize: 11,
                  padding: '3px 5px', lineHeight: 1.55, color: STROKE,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            );
          })()}
        </div>

        {/* ── Layers Panel ─────────────────────────────────────────────── */}
        <div style={{
          width: rightPanelOpen ? 175 : 24, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          background: 'rgba(18,24,54,0.97)', backdropFilter: 'blur(6px)',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          transition: 'width 0.2s ease', overflow: 'hidden',
          zIndex: 10, userSelect: 'none',
        }}>
          {/* Toggle */}
          <button
            onClick={() => setRightPanelOpen(o => !o)}
            style={{
              height: 32, flexShrink: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'rgba(255,255,255,0.4)',
              fontSize: 11, background: 'none', border: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              cursor: 'pointer', width: '100%', outline: 'none',
            }}
            title={rightPanelOpen ? 'Hide layers' : 'Show layers'}
          >
            {rightPanelOpen ? '▶' : '◀'}
          </button>

          {rightPanelOpen && (
            <>
              {/* Header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 6px 4px 8px', flexShrink: 0,
                borderBottom: '1px solid rgba(255,255,255,0.07)',
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.35)',
                  textTransform: 'uppercase', letterSpacing: '0.08em' }}>Layers</span>
                <button onClick={addLayer} title="New layer" style={{
                  width: 20, height: 20, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', borderRadius: 3,
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)',
                  color: 'rgba(255,255,255,0.65)', fontSize: 15,
                  cursor: 'pointer', lineHeight: 1, outline: 'none',
                }}>+</button>
              </div>

              {/* Layer list — reversed so top of list = topmost render layer */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {[...layers].reverse().map((layer) => {
                  const isActive   = layer.id === activeLayerId;
                  const layerShapes = shapes.filter(s =>
                    (s.layerId || layers[0]?.id) === layer.id);
                  return (
                    <div key={layer.id}>
                      {/* Layer row — with drag and drop indicator */}
                      {(()=>{
                        const _lOrig = layers.findIndex(l=>l.id===layer.id);
                        const _lDrag = panelDrag?.type==='layer' && panelDrag.id===layer.id;
                        const _lDrop = panelDrag?.type==='layer' && panelDrag.id!==layer.id && panelDrag.targetIdx===_lOrig;
                        const _lUp   = panelDrag ? panelDrag.targetIdx > panelDrag.origIdx : false;
                        return (<>
                          {_lDrop && _lUp && <div style={{height:2,background:'#3B82F6',margin:'0 4px'}}/>}
                          <div
                            onClick={()=>setActiveLayerId(layer.id)}
                            style={{
                              display:'flex', alignItems:'center', gap:2,
                              padding:'4px 3px 4px 4px', minHeight:28,
                              background: isActive ? 'rgba(59,130,246,0.18)' : 'transparent',
                              borderLeft: isActive ? '2px solid #3B82F6' : '2px solid transparent',
                              cursor:'pointer', opacity: _lDrag ? 0.35 : 1,
                            }}
                          >
                            {/* Layer drag handle — long press to reorder */}
                            <span
                              style={{fontSize:9,color:'rgba(255,255,255,0.2)',cursor:'grab',
                                flexShrink:0,padding:'0 1px',userSelect:'none',touchAction:'none'}}
                              onPointerDown={e=>{
                                e.stopPropagation();
                                const _sy=e.clientY;
                                if(panelDragTimerRef.current) clearTimeout(panelDragTimerRef.current);
                                panelDragTimerRef.current=setTimeout(()=>{
                                  panelDragTimerRef.current=null;
                                  if(navigator.vibrate) navigator.vibrate(40);
                                  const _i=layers.findIndex(l=>l.id===layer.id);
                                  setPanelDrag({type:'layer',id:layer.id,origIdx:_i,targetIdx:_i,startY:_sy});
                                },400);
                              }}
                              onPointerMove={e=>{
                                if(panelDragTimerRef.current&&Math.abs(e.clientY-(panelDrag?.startY||e.clientY))>6){
                                  clearTimeout(panelDragTimerRef.current);panelDragTimerRef.current=null;
                                }
                              }}
                              onPointerUp={()=>{if(panelDragTimerRef.current){clearTimeout(panelDragTimerRef.current);panelDragTimerRef.current=null;}}}
                            >⣿</span>
                            {/* Collapse toggle */}
                            <button
                              onClick={ev=>{ev.stopPropagation();setCollapsedLayers(prev=>{const next=new Set(prev);next.has(layer.id)?next.delete(layer.id):next.add(layer.id);return next;});}}
                              title={collapsedLayers.has(layer.id)?'Expand':'Collapse'}
                              style={{width:14,height:14,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:'none',border:'none',cursor:'pointer',fontSize:8,color:'rgba(255,255,255,0.35)',outline:'none',lineHeight:1}}
                            >{collapsedLayers.has(layer.id)?'▸':'▾'}</button>
                            {/* Visibility */}
                            <button
                              onClick={ev=>{ev.stopPropagation();toggleLayerVisibility(layer.id);}}
                              title={layer.visible?'Hide':'Show'}
                              style={{width:18,height:18,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:'none',border:'none',cursor:'pointer',fontSize:10,color:layer.visible?'rgba(255,255,255,0.6)':'rgba(255,255,255,0.2)',outline:'none'}}
                            >{layer.visible?'👁':'○'}</button>
                            {/* Lock */}
                            <button
                              onClick={ev=>{ev.stopPropagation();toggleLayerLocked(layer.id);}}
                              title={layer.locked?'Unlock layer':'Lock layer'}
                              style={{width:18,height:18,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:'none',border:'none',cursor:'pointer',fontSize:10,color:layer.locked?'#FCD34D':'rgba(255,255,255,0.2)',outline:'none'}}
                            >{layer.locked?'🔒':'🔓'}</button>
                            {/* Name */}
                            <span style={{flex:1,fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                              color:isActive?'#93C5FD':(layer.visible?'rgba(255,255,255,0.7)':'rgba(255,255,255,0.3)')
                            }}>{layer.name}{layer.locked && <span style={{marginLeft:3,fontSize:8,opacity:0.6}}>🔒</span>}</span>
                            {/* Up / Down */}
                            <div style={{display:'flex',flexDirection:'column',gap:1,flexShrink:0}}>
                              {[{dir:1,svg:<svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 5 4 1 7 5"/></svg>,ttl:'Move up'},{dir:-1,svg:<svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 1 4 5 7 1"/></svg>,ttl:'Move down'}].map(({dir,svg,ttl})=>(
                                <button key={dir} onClick={ev=>{ev.stopPropagation();moveLayer(layer.id,dir);}} title={ttl}
                                  style={{width:14,height:10,display:'flex',alignItems:'center',justifyContent:'center',background:'none',border:'none',cursor:'pointer',lineHeight:1,padding:0,color:'rgba(255,255,255,0.35)',outline:'none'}}
                                >{svg}</button>
                              ))}
                            </div>
                          </div>
                          {_lDrop && !_lUp && <div style={{height:2,background:'#3B82F6',margin:'0 4px'}}/>}
                        </>);
                      })()}

                      {/* Objects in this layer — newest first (highest Z) */}
                      {!collapsedLayers.has(layer.id) && (()=>{
                        const _revS=[...layerShapes].reverse();
                        return _revS.map((s,ri)=>{
                          const _sOrig=layerShapes.length-1-ri;
                          const _sDrag=panelDrag?.type==='shape'&&panelDrag.id===s.id;
                          const _sDrop=panelDrag?.type==='shape'&&panelDrag.id!==s.id&&panelDrag.targetIdx===_sOrig;
                          const _sUp=panelDrag?panelDrag.targetIdx>panelDrag.origIdx:false;
                          return (
                          <React.Fragment key={s.id}>
                            {_sDrop&&_sUp&&<div style={{height:2,background:'#3B82F6',margin:'0 14px'}}/>}
                            <div
                              onClick={()=>{setTool('select');setSelectedIds([s.id]);setPrevTool(null);}}
                              style={{display:'flex',alignItems:'center',gap:3,padding:'2px 4px 2px 14px',
                                background:selectedIds.includes(s.id)?'rgba(59,130,246,0.12)':'transparent',
                                opacity:_sDrag?0.35:1,cursor:'pointer'}}
                            >
                              {/* Shape drag handle */}
                              <span
                                style={{fontSize:8,color:'rgba(255,255,255,0.18)',cursor:'grab',
                                  flexShrink:0,padding:'0 2px',userSelect:'none',touchAction:'none'}}
                                onPointerDown={e=>{
                                  e.stopPropagation();
                                  const _sy=e.clientY;
                                  if(panelDragTimerRef.current) clearTimeout(panelDragTimerRef.current);
                                  panelDragTimerRef.current=setTimeout(()=>{
                                    panelDragTimerRef.current=null;
                                    if(navigator.vibrate) navigator.vibrate(40);
                                    setPanelDrag({type:'shape',id:s.id,origIdx:_sOrig,targetIdx:_sOrig,startY:_sy,layerShapeCount:layerShapes.length});
                                  },400);
                                }}
                                onPointerMove={e=>{
                                  if(panelDragTimerRef.current&&Math.abs(e.clientY-(panelDrag?.startY||e.clientY))>6){
                                    clearTimeout(panelDragTimerRef.current);panelDragTimerRef.current=null;
                                  }
                                }}
                                onPointerUp={()=>{if(panelDragTimerRef.current){clearTimeout(panelDragTimerRef.current);panelDragTimerRef.current=null;}}}
                              >⣿</span>
                              {/* Per-shape visibility toggle */}
                              <button
                                onClick={ev=>{ev.stopPropagation();toggleShapeVisible(s.id);}}
                                title={s.visible===false?'Show':'Hide'}
                                style={{width:14,height:14,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',
                                  background:'none',border:'none',cursor:'pointer',fontSize:9,outline:'none',
                                  color:s.visible===false?'rgba(255,255,255,0.15)':'rgba(255,255,255,0.45)'}}
                              >{s.visible===false?'○':'●'}</button>
                              {/* Per-shape lock toggle */}
                              <button
                                onClick={ev=>{ev.stopPropagation();toggleShapeLocked(s.id);}}
                                title={s.locked?'Unlock shape':'Lock shape'}
                                style={{width:14,height:14,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',
                                  background:'none',border:'none',cursor:'pointer',fontSize:8,outline:'none',
                                  color:s.locked?'#FCD34D':'rgba(255,255,255,0.18)'}}
                              >{s.locked?'🔒':'🔓'}</button>
                              <span style={{flex:1,fontSize:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                                color:s.visible===false?'rgba(255,255,255,0.2)':(selectedIds.includes(s.id)?'#93C5FD':'rgba(255,255,255,0.4)')}}>
                                {s.type.charAt(0).toUpperCase()+s.type.slice(1)} {layerShapes.length-ri}{s.locked&&<span style={{marginLeft:2,fontSize:7,opacity:0.7}}>🔒</span>}
                              </span>
                            </div>
                            {_sDrop&&!_sUp&&<div style={{height:2,background:'#3B82F6',margin:'0 14px'}}/>}
                          </React.Fragment>);
                        });
                      })()}
                    </div>
                  );
                })}
              </div>

              {/* ── Color Panel ─────────────────────────────────────────── */}
              <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                {/* Color section header */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '4px 6px 4px 8px', cursor: 'pointer',
                  borderBottom: colorPanelOpen ? '1px solid rgba(255,255,255,0.07)' : 'none',
                }} onClick={() => setColorPanelOpen(o => !o)}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.35)',
                    textTransform: 'uppercase', letterSpacing: '0.08em' }}>Colors</span>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
                    {colorPanelOpen ? '▾' : '▸'}
                  </span>
                </div>
                {colorPanelOpen && (
                  <ColorPanel
                    colorTarget={colorTarget}
                    onTargetChange={t => {
                      setColorTarget(t);
                    }}
                    activeColor={colorTarget === 'stroke' ? activeStrokeColor : activeFillColor}
                    recentColors={recentColors}
                    onColorChange={(target, color) => applyColorToSelection(target, color)}
                    onColorCommit={(target, color) => commitColorToSelection(target, color)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Notes strip — collapsible */}
      <div style={{ flexShrink: 0, borderTop: '1px solid rgba(80,120,200,0.18)' }}>
        {/* Toggle bar */}
        <button
          onClick={() => setNotesOpen(o => !o)}
          style={{
            width: '100%', height: 22, display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', padding: '0 10px',
            background: 'rgba(245,248,255,0.96)',
            border: 'none', borderBottom: notesOpen ? '1px solid rgba(80,120,200,0.15)' : 'none',
            cursor: 'pointer', outline: 'none',
          }}
        >
          <span style={{
            fontSize: 9.5, fontFamily: 'Courier New, monospace',
            color: 'rgba(40,60,120,0.55)', letterSpacing: '0.04em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {notesOpen ? 'Notes' : (notes.trim() ? notes.replace(/\n/g, ' ').slice(0, 55) + (notes.length > 55 ? '…' : '') : 'Notes')}
          </span>
          <span style={{ fontSize: 9, color: 'rgba(40,60,120,0.4)', flexShrink: 0, marginLeft: 6 }}>
            {notesOpen ? (
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 1.5 4.5 5.5 8 1.5"/></svg>
            ) : (
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 5.5 4.5 1.5 8 5.5"/></svg>
            )}
          </span>
        </button>
        {/* Textarea — only rendered when open */}
        {notesOpen && (
          <textarea
            value={notes}
            onChange={e => handleNotesChange(e.target.value)}
            placeholder="Sketch notes, labels, bearings, dimensions..."
            className="w-full px-4 py-3 text-sm font-data text-fb-text bg-transparent resize-none outline-none"
            rows={3}
            style={{ background: 'rgba(255,255,255,0.92)', display: 'block', width: '100%' }}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Expose SketchPage and geometry utilities to the app shell.
// =============================================================================
// arcPath, pathToSVGD, and computeArcFromPI are used by the project PDF export
// in index.html to render sketch pages without re-implementing the geometry.
window._fbSketchUtils = {
  computeArcFromPI, arcPath, pathToSVGD,
  pxToReal, realToPx, formatReal, fmtPxAsReal,
  niceScaleBarValue, normAng, toDMS,
  PIXELS_PER_METER,
};
window.SketchPage = SketchPage;
window._resolveSketch();
