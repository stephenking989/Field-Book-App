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

const TOOLS = [
  { id: 'select',    label: 'Select',    icon: '↖' },
  { id: 'line',      label: 'Line',      icon: '╱' },
  { id: 'curve',     label: 'Curve',     icon: '⌒' },
  { id: 'circle',    label: 'Circle',    icon: '○' },
  { id: 'rect',      label: 'Rect',      icon: '□' },
  { id: 'text',      label: 'Text',      icon: 'T' },
  { id: 'eraser',    label: 'Eraser',    icon: '⌫' },
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

// Render a single dimension text element at (lx, ly) rotated by `angle` degrees.
// Uses SVG paint-order trick to stroke a white halo behind the fill, keeping
// the label readable over lines, fills, and the grid at any zoom level.
// NOT a React component (lowercase) — call as a factory that returns a React element.
function dimTextEl(lx, ly, angle, text, ps) {
  const a = angle || 0;
  return (
    <text
      x={lx} y={ly}
      transform={a ? `rotate(${a},${lx},${ly})` : undefined}
      fontSize={9.5 * ps}
      fontFamily="Courier New, monospace"
      textAnchor="middle"
      dominantBaseline="middle"
      fill={STROKE}
      stroke="rgba(255,255,255,0.90)"
      strokeWidth={2.5 * ps}
      paintOrder="stroke fill"
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >{text}</text>
  );
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
// SHAPE VALUE CARD  —  proper React component with controlled inputs
// Extracted from the IIFE so it can hold useState/useEffect.
// Props:
//   shape    — the currently selected shape object (never null when rendered)
//   onUpdate — fn(transformFn) called with a shape→shape transform to apply
// ─────────────────────────────────────────────────────────────────────────────
function ShapeValueCard({ shape: s, onUpdate, scaleDenom, units }) {
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
    return {
      len:    pxToReal(lenPx, scaleDenom, units).toFixed(3),
      brg:    brg.toFixed(3),
      r:      sh.type === 'circle' ? pxToReal(sh.r, scaleDenom, units).toFixed(3) : '0',
      w:      sh.type === 'rect'   ? pxToReal(Math.abs(sh.w), scaleDenom, units).toFixed(3) : '0',
      h:      sh.type === 'rect'   ? pxToReal(Math.abs(sh.h), scaleDenom, units).toFixed(3) : '0',
      crvR:   cp ? pxToReal(cp.R, scaleDenom, units).toFixed(3) : '0',
      nts:    sh.ntsLabel || '',
    };
  }

  const [vals, setVals] = useState(() => initVals(s));

  // Re-initialise when shape changes, or when scale/units change so displayed
  // values refresh immediately without needing to re-select the shape.
  useEffect(() => { setVals(initVals(s)); },
    [s.id, s.x1, s.y1, s.x2, s.y2, s.r, s.w, s.h, s.px, s.py, s.ntsLabel, scaleDenom, units]);

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
    const brgFallback   = () => (((Math.atan2(s.x2-s.x1,-(s.y2-s.y1))*180/Math.PI)+360)%360).toFixed(3);
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
          onBlur={e  => tryCommit('brg', e.target.value, parseFloat,
                         n => !isNaN(n),
                         (sh, n) => applyLineBearing(sh, n),
                         brgFallback)}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, brg: brgFallback()})); e.target.blur(); } }}
          style={iStyle}
        />{unit('°')}
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

function SketchPage({ page, projectId, onReload }) {
  const [shapes,      setShapes]      = useState(page.shapes || []);
  const [notes,       setNotes]       = useState(page.notes  || '');
  const [tool,        setTool]        = useState('select');
  const [prevTool,    setPrevTool]    = useState(null);  // saved drawing tool after shape commit
  const [ribbonOpen,  setRibbonOpen]  = useState(true);
  const [selectedId,  setSelectedId]  = useState(null);
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
    grid:          false,  // snap to minor grid intersections
  });
  const [snapPoint, setSnapPoint] = useState(null); // {x,y,type}|null — visual indicator
  const anySnapActive = Object.values(snapModes).some(Boolean);

  // ── Scale & Units (Phase 3) ────────────────────────────────────────────────
  const [scaleDenom,    setScaleDenom]    = useState(page.scaleDenom  || 1);
  const [units,         setUnits]         = useState(page.units       || 'm');
  const [showScaleBar,  setShowScaleBar]  = useState(true);
  const [showGrid,      setShowGrid]      = useState(true);
  // Tracks the live text-input value while the user is typing a new denominator
  const [scaleInput,    setScaleInput]    = useState(String(page.scaleDenom || 1));

  // ── Dimension labels ───────────────────────────────────────────────────────
  // When true, each committed shape shows an inline measurement label (length,
  // radius, arc length, width×height).  Also shown live while drawing.
  const [showDims,      setShowDims]      = useState(true);
  const [showValueCard, setShowValueCard] = useState(true);

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
  const [headerOpen,       setHeaderOpen]       = useState(false);
  const [notesOpen,        setNotesOpen]        = useState(false);

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
  const lastPinchRef  = useRef(null);           // { dist, midX, midY }
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
    setSelectedId(null);
    setDrawState(null);
    setSnapPoint(null);
  }, [page.id]);

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
    const sd = (patch && patch.scaleDenom !== undefined) ? patch.scaleDenom : scaleDenom;
    const u  = (patch && patch.units      !== undefined) ? patch.units      : units;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      DB.updatePage(projectId, page.id, { shapes: s, notes: n, layers: l, scaleDenom: sd, units: u });
    }, 600);
  }

  function commitShapes(next) {
    setShapes(next);
    persist(next, undefined);
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
        if (nodeKey === 'tl') return { ...shape, x: shape.x+dx, y: shape.y+dy, w: Math.max(10, shape.w-dx), h: Math.max(10, shape.h-dy) };
        if (nodeKey === 'tr') return { ...shape,                y: shape.y+dy, w: Math.max(10, shape.w+dx), h: Math.max(10, shape.h-dy) };
        if (nodeKey === 'bl') return { ...shape, x: shape.x+dx,                w: Math.max(10, shape.w-dx), h: Math.max(10, shape.h+dy) };
        if (nodeKey === 'br') return { ...shape,                                w: Math.max(10, shape.w+dx), h: Math.max(10, shape.h+dy) };
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

    // ── Two-finger touch → cancel draw, enter pinch/pan mode ─────────────
    if (activePtrsRef.current.size >= 2) {
      e.preventDefault();
      setDrawState(null);
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
      const hit = hitTest(pt, shapes, hitThresh);
      setSelectedId(hit ? hit.id : null);
      setDragNode(null);
      if (!hit && prevTool !== null) {
        // Clicking empty space exits post-create handle mode.
        // Just deselect — do NOT fall through and start the next shape on the
        // same click. The user needs a deliberate second click to begin drawing.
        setPrevTool(null);
        return;
      }
      return;
    }

    if (tool === 'eraser') {
      const hitThresh = (e.pointerType === 'touch' ? 24 : 8) * ps;
      const hit = hitTest(pt, shapes, hitThresh);
      if (hit) commitShapes(shapes.filter(s => s.id !== hit.id));
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
      setSelectedId(null);
      const sp = anySnapActive ? resolveSnap(pt) : pt;
      setDrawState({ type: 'text', ox: sp.x, oy: sp.y, x: sp.x, y: sp.y, w: 0, h: 0, layerId: activeLayerId });
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
          stroke: STROKE, strokeWidth: STROKE_W,
          layerId: drawState.layerId || activeLayerId }]);
        setSelectedId(_crvId);
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

    // ── Node / handle drag ────────────────────────────────────────────────────
    if (dragNode && dragStart) {
      setSnapPoint(null);

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
              const cands    = collectSnapCandidates(rotPt, null, dragNode.shapeId);
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
        const dx = rawPt.x - dragStart.svgX;
        const dy = rawPt.y - dragStart.svgY;
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

        setShapes(dragStart.snapshot.map(s =>
          s.id === dragNode.shapeId ? applyNodeDrag(s, 'body', dx, dy) : s
        ));
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
        pt = resolveSnap(rawPt, drawingFrom);
      } else {
        setSnapPoint(null);
      }
    } else {
      setSnapPoint(null);
    }

    if (!drawState) return;

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

    // Commit node drag
    if (dragNode) {
      commitShapes(shapes);
      setDragNode(null);
      setDragStart(null);
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
          stroke: STROKE, strokeWidth: STROKE_W,
          layerId: drawState.layerId || activeLayerId }]);
        setSelectedId(_lineId);
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
          stroke: STROKE, strokeWidth: STROKE_W, fill: 'none',
          layerId: drawState.layerId || activeLayerId }]);
        setSelectedId(_rctId);
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
          stroke: STROKE, strokeWidth: STROKE_W, fill: 'none',
          layerId: drawState.layerId || activeLayerId }]);
        setSelectedId(_cirId);
        setPrevTool(tool);
      }
      setDrawState(null);
      setSnapPoint(null);
    }

    // Text bbox drawn — open the textarea at the drawn dimensions.
    // drawState.w/h are in world units; convert to screen pixels for storage
    // (s.w/s.h are kept as screen px so the box stays the same visual size at any zoom).
    if (drawState.type === 'text') {
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
        if (Math.abs(d - s.r) < thresh || d < s.r + thresh) return s;
      } else if (s.type === 'rect') {
        if (tp.x >= s.x-thresh && tp.x <= s.x+s.w+thresh &&
            tp.y >= s.y-thresh && tp.y <= s.y+s.h+thresh) return s;
      } else if (s.type === 'text') {
        // s.x/y = world center; s.w/h = screen pixels. Convert half-extents to world units.
        const _psHT = viewBox.w / (svgSizeRef.current.w || viewBox.w);
        const hwHT  = (s.w || 180) * _psHT / 2;
        const hhHT  = (s.h ||  80) * _psHT / 2;
        if (tp.x >= s.x - hwHT - thresh && tp.x <= s.x + hwHT + thresh &&
            tp.y >= s.y - hhHT - thresh && tp.y <= s.y + hhHT + thresh) return s;
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
      case 'text': raw = [{x:shape.x,y:shape.y}]; break;
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

    // ── 5. Grid ────────────────────────────────────────────────────────────
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

    const PRIORITY = { endpoint: 0, midpoint: 1, intersection: 2, perpendicular: 3, grid: 4 };
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

  // ── Text commit ────────────────────────────────────────────────────────────
  function commitText() {
    if (!textEdit) return;
    if (textEdit.content.trim()) {
      commitShapes([...shapes, { id: textEdit.id, type: 'text',
        x: textEdit.x, y: textEdit.y,
        w: textEdit.w || 180, h: textEdit.h || 80,
        content: textEdit.content, stroke: STROKE,
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

    let inner = null;
    switch (s.type) {
      case 'line':
        inner = <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinecap="round" style={sel} />;
        break;
      case 'curve': {
        const { px: rpx, py: rpy } = getCurvePI(s);
        inner = <path d={arcPath(s.x1, s.y1, s.x2, s.y2, rpx, rpy)}
          stroke={s.stroke} strokeWidth={s.strokeWidth} fill="none" strokeLinecap="round" style={sel} />;
        break;
      }
      case 'circle':
        inner = <circle cx={s.cx} cy={s.cy} r={s.r}
          stroke={s.stroke} strokeWidth={s.strokeWidth} fill={s.fill || 'none'} style={sel} />;
        break;
      case 'rect':
        inner = <rect x={s.x} y={s.y} width={s.w} height={s.h}
          stroke={s.stroke} strokeWidth={s.strokeWidth} fill={s.fill || 'none'} style={sel} />;
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
        // Surveying azimuth from North, clockwise, 0–360°
        const az  = ((Math.atan2(s.x2-s.x1, -(s.y2-s.y1)) * 180/Math.PI) + 360) % 360;
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
      default: return null;
    }
  }

  // ── Render node handles for selected shape ─────────────────────────────────
  // Handles appear at their visually rotated positions in SVG space.
  // The pivot (⊕) and rotate (↻) handles are rendered outside the shape <g>
  // so they're always accessible regardless of shape rotation.
  function renderNodes(shape) {
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

        {/* Dashed line from pivot to rotate handle */}
        <line x1={piv.x} y1={piv.y} x2={rhPos.x} y2={rhPos.y}
          stroke="rgba(245,158,11,0.45)" strokeWidth={ps} strokeDasharray={`${3*ps},${3*ps}`}
          style={{ pointerEvents: 'none' }} />

        {/* Pivot handle — amber crosshair circle */}
        <g key="pivot" style={{ cursor: 'move' }}
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
        </g>

        {/* Rotate handle — amber ↻ circle */}
        <g key="rotate" style={{ cursor: 'grab' }}
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
      default: return null;
    }
  }

  const selectedShape = shapes.find(s => s.id === selectedId);
  const cursorMap = {
    select: 'default', line: 'crosshair', curve: 'crosshair',
    circle: 'crosshair', rect: 'crosshair', text: 'text', eraser: 'pointer',
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
          {headerOpen ? '▲' : '▼'}
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
              { label: 'Grid',      icon: '⊞', state: showGrid,      set: () => setShowGrid(v => !v),      activeCol: '#6EE7B7', activeBg: 'rgba(52,211,153,0.15)' },
              { label: 'Dims',      icon: '◫', state: showDims,      set: () => setShowDims(v => !v),      activeCol: '#90CDF4', activeBg: 'rgba(99,179,237,0.18)' },
              { label: 'Card',      icon: '▤', state: showValueCard, set: () => setShowValueCard(v => !v), activeCol: '#C4B5FD', activeBg: 'rgba(167,139,250,0.18)' },
              { label: 'Scale Bar', icon: '⊟', state: showScaleBar,  set: () => setShowScaleBar(v => !v),  activeCol: '#FCD34D', activeBg: 'rgba(251,191,36,0.15)' },
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
                <span style={{ fontSize: 14, lineHeight: 1, width: 16 }}>{icon}</span>
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
                <span style={{ fontSize: 13 }}>⊡</span>
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
              { key: 'endpoint',     label: 'Endpoint',      icon: '◉', col: '#4ADE80', bg: 'rgba(34,197,94,0.15)',   desc: 'Line & curve endpoints' },
              { key: 'midpoint',     label: 'Midpoint',       icon: '◈', col: '#22D3EE', bg: 'rgba(34,211,238,0.15)',  desc: 'Segment midpoints' },
              { key: 'intersection', label: 'On Object',      icon: '◎', col: '#FB923C', bg: 'rgba(251,146,60,0.15)',  desc: 'Nearest pt on shape' },
              { key: 'perpendicular',label: 'Perpendicular',  icon: '⊾', col: '#C084FC', bg: 'rgba(192,132,252,0.15)', desc: 'Perpendicular foot' },
              { key: 'grid',         label: 'Grid',           icon: '⊞', col: '#FCD34D', bg: 'rgba(251,191,36,0.15)',  desc: 'Grid intersections' },
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
                  <span style={{ fontSize: 14, lineHeight: 1, width: 16, textAlign: 'center' }}>{icon}</span>
                  <span style={{ flex: 1, fontFamily: 'Courier New, monospace' }}>{label}</span>
                  <span style={{ fontSize: 9, color: on ? col : 'rgba(255,255,255,0.2)', opacity: 0.75 }}>{desc}</span>
                  <span style={{ fontSize: 10, color: on ? col : 'rgba(255,255,255,0.22)', marginLeft: 8, minWidth: 18, textAlign: 'right' }}>
                    {on ? 'on' : 'off'}
                  </span>
                </button>
              );
            })}
            {/* Tangent — future */}
            <button disabled style={{
              width: '100%', height: 38, display: 'flex', alignItems: 'center',
              gap: 10, padding: '0 14px',
              background: 'transparent', border: 'none', cursor: 'default',
              color: 'rgba(255,255,255,0.22)', fontSize: 11, opacity: 0.5,
            }}>
              <span style={{ fontSize: 14, lineHeight: 1, width: 16, textAlign: 'center' }}>⌒</span>
              <span style={{ flex: 1, fontFamily: 'Courier New, monospace' }}>Tangent</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)' }}>soon</span>
            </button>
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
            <span style={{ fontSize: 13, lineHeight: 1 }}>⊙</span>
            <span style={{ letterSpacing: '0.03em' }}>Snap</span>
            <span style={{ fontSize: 8, opacity: 0.5, marginLeft: 1 }}>▾</span>
          </button>

          {/* Separator */}
          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', margin: '0 2px', flexShrink: 0 }} />

          {/* ── View menu button ──────────────────────────────────────── */}
          <button
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
            <span style={{ fontSize: 13, lineHeight: 1 }}>◨</span>
            <span style={{ letterSpacing: '0.03em' }}>View</span>
            <span style={{ fontSize: 8, opacity: 0.5, marginLeft: 1 }}>▾</span>
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
            <span style={{ fontSize: 12, lineHeight: 1 }}>⊞</span>
            <span style={{ letterSpacing: '0.03em' }}>Scale</span>
            <span style={{ fontSize: 8, opacity: 0.5, marginLeft: 1 }}>▾</span>
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
            {ribbonOpen ? '◀' : '▶'}
          </button>

          {/* Tool buttons — scrollable column */}
          {ribbonOpen && (
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {TOOLS.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setTool(t.id); setSelectedId(null); setDrawState(null); setPrevTool(null); }}
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
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{t.icon}</span>
                  <span style={{ fontSize: 7, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1 }}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Delete selected — pinned at bottom, outside the scroll area */}
          {ribbonOpen && selectedId && (
            <button
              onClick={() => { commitShapes(shapes.filter(s => s.id !== selectedId)); setSelectedId(null); }}
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
              <span style={{ fontSize: 14 }}>✕</span>
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
          <div style={{ position: 'absolute', top: 10, right: 14, opacity: 0.28, display: 'flex',
            flexDirection: 'column', alignItems: 'center', color: '#3B5BDB',
            fontFamily: 'Courier New, monospace', fontSize: 11, pointerEvents: 'none', zIndex: 2 }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>↑</span>
            <span style={{ fontWeight: 700, lineHeight: 1 }}>N</span>
          </div>

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
            onDblClick={onDblClick}
          >
            {/* Dynamic grid — rendered below everything */}
            {showGrid && renderGrid()}

            {/* Committed shapes — rendered in layer order, bottom to top */}
            {layers.map(layer => layer.visible && (
              <g key={layer.id}>
                {shapes
                  .filter(s => (s.layerId || layers[0]?.id) === layer.id)
                  .map(s => renderShape(s, s.id === selectedId))}
              </g>
            ))}

            {/* Dimension labels — rendered above shapes, below handles */}
            {showDims && shapes.map(s => {
              const layer = layers.find(l => l.id === (s.layerId || layers[0]?.id));
              if (!layer?.visible) return null;
              const lbl = renderDimLabel(s);
              return lbl ? <g key={`dim-${s.id}`}>{lbl}</g> : null;
            })}

            {/* Node handles for selected shape.
                Shows in select mode OR when prevTool is set (shape just created —
                tool hasn't switched, but we need handles immediately). */}
            {selectedShape && (tool === 'select' || tool === 'text' || prevTool !== null) && renderNodes(selectedShape)}

            {/* Preview shape while drawing */}
            {renderPreview()}

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
                      {/* Layer row */}
                      <div
                        onClick={() => setActiveLayerId(layer.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 2,
                          padding: '4px 3px 4px 4px', minHeight: 28,
                          background: isActive ? 'rgba(59,130,246,0.18)' : 'transparent',
                          borderLeft: isActive ? '2px solid #3B82F6' : '2px solid transparent',
                          cursor: 'pointer',
                        }}
                      >
                        {/* Collapse toggle */}
                        <button
                          onClick={ev => { ev.stopPropagation(); setCollapsedLayers(prev => { const next = new Set(prev); next.has(layer.id) ? next.delete(layer.id) : next.add(layer.id); return next; }); }}
                          title={collapsedLayers.has(layer.id) ? 'Expand' : 'Collapse'}
                          style={{
                            width: 14, height: 14, flexShrink: 0, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'none', border: 'none', cursor: 'pointer', fontSize: 8,
                            color: 'rgba(255,255,255,0.35)', outline: 'none', lineHeight: 1,
                          }}
                        >{collapsedLayers.has(layer.id) ? '▸' : '▾'}</button>

                        {/* Visibility */}
                        <button
                          onClick={ev => { ev.stopPropagation(); toggleLayerVisibility(layer.id); }}
                          title={layer.visible ? 'Hide' : 'Show'}
                          style={{
                            width: 18, height: 18, flexShrink: 0, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'none', border: 'none', cursor: 'pointer', fontSize: 10,
                            color: layer.visible ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)',
                            outline: 'none',
                          }}
                        >{layer.visible ? '👁' : '○'}</button>

                        {/* Name */}
                        <span style={{
                          flex: 1, fontSize: 11, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          color: isActive ? '#93C5FD'
                            : (layer.visible ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)'),
                        }}>{layer.name}</span>

                        {/* Up / Down */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                          {[{ dir: 1, icon: '▲', ttl: 'Move up' }, { dir: -1, icon: '▼', ttl: 'Move down' }].map(({ dir, icon, ttl }) => (
                            <button key={dir}
                              onClick={ev => { ev.stopPropagation(); moveLayer(layer.id, dir); }}
                              title={ttl}
                              style={{
                                width: 14, height: 10, display: 'flex', alignItems: 'center',
                                justifyContent: 'center', background: 'none', border: 'none',
                                cursor: 'pointer', fontSize: 7, lineHeight: 1, padding: 0,
                                color: 'rgba(255,255,255,0.35)', outline: 'none',
                              }}
                            >{icon}</button>
                          ))}
                        </div>
                      </div>

                      {/* Objects in this layer — newest first (highest Z) */}
                      {!collapsedLayers.has(layer.id) && [...layerShapes].reverse().map((s, ri) => (
                        <div
                          key={s.id}
                          onClick={() => { setTool('select'); setSelectedId(s.id); setPrevTool(null); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '2px 6px 2px 22px',
                            background: s.id === selectedId ? 'rgba(59,130,246,0.12)' : 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>—</span>
                          <span style={{
                            fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            color: s.id === selectedId ? '#93C5FD' : 'rgba(255,255,255,0.4)',
                          }}>
                            {s.type.charAt(0).toUpperCase() + s.type.slice(1)} {layerShapes.length - ri}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
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
            {notesOpen ? '▼' : '▲'}
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
// Expose SketchPage to the app shell and signal ready.
// =============================================================================
window.SketchPage = SketchPage;
window._resolveSketch();
