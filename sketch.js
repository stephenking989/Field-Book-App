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
const SNAP_NODES = new Set(['p1', 'p2', 'c', 'r', 'tl', 'br']);

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
    case 'text':   return { x: shape.x + (shape.w||160)/2,      y: shape.y + (shape.h||40)/2      };
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
// All curves are stored as BC (x1,y1), EC (x2,y2), arc-midpoint (ax,ay).
// The arc-midpoint is the point on the circular arc exactly halfway between
// BC and EC along the arc.  From these three points every survey curve
// element can be derived analytically.

// Backward-compat: old curves stored a quadratic bezier control point (cx,cy).
// Estimate the equivalent arc midpoint from the bezier at t=0.5.
function getCurveArcMid(shape) {
  if (shape.ax !== undefined) return { ax: shape.ax, ay: shape.ay };
  const bx = shape.cx !== undefined ? shape.cx : (shape.x1 + shape.x2) / 2;
  const by = shape.cy !== undefined ? shape.cy : (shape.y1 + shape.y2) / 2;
  return { ax: (shape.x1 + 2*bx + shape.x2) / 4,
           ay: (shape.y1 + 2*by + shape.y2) / 4 };
}

// Compute center and radius of the circular arc from BC, EC, arc-midpoint.
// Returns null if the three points are collinear (degenerate straight line).
function arcCenter(x1, y1, x2, y2, ax, ay) {
  const mx = (x1+x2)/2, my = (y1+y2)/2;
  const M  = Math.hypot(ax-mx, ay-my);       // middle ordinate
  const h  = Math.hypot(x2-x1, y2-y1) / 2;  // half-chord
  if (M < 0.5 || h < 0.5) return null;
  const R  = (h*h + M*M) / (2*M);
  // Centre lies on perpendicular bisector of BC-EC, at distance R from arc-midpoint
  // toward the chord midpoint: C = arcMid + R·normalize(chordMid - arcMid)
  const cx = ax + R*(mx-ax)/M;
  const cy = ay + R*(my-ay)/M;
  return { cx, cy, R };
}

// Build the SVG arc path string for a committed or preview curve.
function arcPath(x1, y1, x2, y2, ax, ay) {
  const arc = arcCenter(x1, y1, x2, y2, ax, ay);
  if (!arc) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const { R } = arc;
  const mx = (x1+x2)/2, my = (y1+y2)/2;
  const M  = Math.hypot(ax-mx, ay-my);
  const largeArc = M > R ? 1 : 0;
  // Sweep: cross-product of (arcMid - BC) × (EC - BC) in SVG y-down coords.
  // cross < 0  →  arcMid is to the right of BC→EC  →  CW  →  sweep=1
  const cross = (ax-x1)*(y2-y1) - (ay-y1)*(x2-x1);
  const sweep  = cross < 0 ? 1 : 0;
  return `M ${x1} ${y1} A ${R.toFixed(3)} ${R.toFixed(3)} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
}

// Compute the full set of horizontal curve elements used in surveying.
function computeCurveProps(x1, y1, x2, y2, ax, ay) {
  const arc = arcCenter(x1, y1, x2, y2, ax, ay);
  if (!arc) return null;
  const { R } = arc;
  const chord = Math.hypot(x2-x1, y2-y1);
  const h     = chord / 2;
  const mx    = (x1+x2)/2, my = (y1+y2)/2;
  const M_ord = Math.hypot(ax-mx, ay-my);
  // Half-delta via arcsin; handle major arcs (M_ord > R means Δ > 180°)
  const sinHalf = Math.min(1, h / R);
  let deltaRad  = 2 * Math.asin(sinHalf);
  if (M_ord > R) deltaRad = 2*Math.PI - deltaRad;
  const deltaDeg = deltaRad * 180 / Math.PI;
  const T = R * Math.tan(deltaRad / 2);     // tangent length
  const L = R * deltaRad;                   // arc length
  const E = R * (1/Math.cos(deltaRad/2)-1); // external distance
  const chordBearingDeg = Math.atan2(y2-y1, x2-x1) * 180/Math.PI;
  return { R, delta: deltaDeg, T: Math.abs(T), L, M: M_ord,
           E: Math.abs(E), chord, chordBearing: chordBearingDeg };
}

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION LABEL UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

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

// Change arc radius while keeping both endpoints fixed.
// Sagitta: h = R - sqrt(R² - (chord/2)²); new arc midpoint offset from chord midpoint.
function applyArcRadius(s, newR) {
  const { x1, y1, x2, y2 } = s;
  const chord = Math.hypot(x2-x1, y2-y1);
  const r = Math.max(newR, chord/2 + 0.1);        // R must be >= chord/2
  const { ax, ay } = getCurveArcMid(s);
  const mx = (x1+x2)/2, my = (y1+y2)/2;
  const side = Math.sign((x2-x1)*(ay-y1) - (y2-y1)*(ax-x1)) || 1;  // which side of chord
  const h = r - Math.sqrt(r*r - (chord/2)*(chord/2));
  const dx = -(y2-y1)/chord, dy = (x2-x1)/chord;  // perpendicular unit vector
  return { ...s, ax: mx + side*dx*h, ay: my + side*dy*h };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE VALUE CARD  —  proper React component with controlled inputs
// Extracted from the IIFE so it can hold useState/useEffect.
// Props:
//   shape    — the currently selected shape object (never null when rendered)
//   onUpdate — fn(transformFn) called with a shape→shape transform to apply
// ─────────────────────────────────────────────────────────────────────────────
function ShapeValueCard({ shape: s, onUpdate }) {
  // ── Shared styles ───────────────────────────────────────────────────────
  const iStyle = {
    width: 82, background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.2)', borderRadius: 3,
    color: 'rgba(255,255,255,0.9)', fontFamily: 'Courier New, monospace',
    fontSize: 10, padding: '2px 5px', outline: 'none',
  };
  const lStyle = { color: '#64748B', width: 46, flexShrink: 0, fontSize: 10 };
  const rStyle = { display: 'flex', gap: 5, alignItems: 'center', lineHeight: 1.6 };
  const unit   = v => <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>{v}</span>;

  // ── Compute initial values from the shape ───────────────────────────────
  function initVals(sh) {
    const len = sh.type === 'line' ? Math.hypot(sh.x2-sh.x1, sh.y2-sh.y1) : 0;
    const brg = sh.type === 'line'
      ? ((Math.atan2(sh.x2-sh.x1, -(sh.y2-sh.y1)) * 180/Math.PI) + 360) % 360 : 0;
    const cp = sh.type === 'curve'
      ? (() => { const {ax,ay} = getCurveArcMid(sh);
                 return computeCurveProps(sh.x1,sh.y1,sh.x2,sh.y2,ax,ay); })()
      : null;
    return {
      len:    len.toFixed(2),
      brg:    brg.toFixed(3),
      r:      sh.type === 'circle' ? sh.r.toFixed(2) : '0',
      w:      sh.type === 'rect'   ? Math.abs(sh.w).toFixed(2) : '0',
      h:      sh.type === 'rect'   ? Math.abs(sh.h).toFixed(2) : '0',
      crvR:   cp ? cp.R.toFixed(2) : '0',
      nts:    sh.ntsLabel || '',
    };
  }

  const [vals, setVals] = useState(() => initVals(s));

  // Re-initialise whenever a DIFFERENT shape is selected (shape ID changes).
  // Also re-initialise when the shape object itself changes (after an update)
  // so the field reflects the new committed value on next focus.
  useEffect(() => { setVals(initVals(s)); }, [s.id, s.x1, s.y1, s.x2, s.y2, s.r, s.w, s.h, s.ax, s.ay, s.ntsLabel]);

  // ── Commit helper ───────────────────────────────────────────────────────
  // Parses the raw string value, validates with guard, applies transform.
  // If invalid, snaps the field back to fallbackFn().
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
    const {ax, ay} = getCurveArcMid(s);
    cp = computeCurveProps(s.x1, s.y1, s.x2, s.y2, ax, ay);
  }

  // ── Build rows ───────────────────────────────────────────────────────────
  let title = 'Shape';
  let rows  = [];

  if (s.type === 'line') {
    title = 'Line';
    rows = [
      <div key="len" style={rStyle}>
        <span style={lStyle}>Length</span>
        <input
          value={vals.len}
          onChange={e => setVals(v => ({ ...v, len: e.target.value }))}
          onBlur={e  => tryCommit('len', e.target.value, parseFloat,
                         n => !isNaN(n) && n > 0,
                         (sh, n) => applyLineLength(sh, n),
                         () => Math.hypot(s.x2-s.x1, s.y2-s.y1).toFixed(2))}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, len: Math.hypot(s.x2-s.x1,s.y2-s.y1).toFixed(2)})); e.target.blur(); } }}
          style={iStyle}
        />{unit('px')}
      </div>,
      <div key="brg" style={rStyle}>
        <span style={lStyle}>Bearing</span>
        <input
          value={vals.brg}
          onChange={e => setVals(v => ({ ...v, brg: e.target.value }))}
          onBlur={e  => tryCommit('brg', e.target.value, parseFloat,
                         n => !isNaN(n),
                         (sh, n) => applyLineBearing(sh, n),
                         () => (((Math.atan2(s.x2-s.x1,-(s.y2-s.y1))*180/Math.PI)+360)%360).toFixed(3))}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, brg: (((Math.atan2(s.x2-s.x1,-(s.y2-s.y1))*180/Math.PI)+360)%360).toFixed(3)})); e.target.blur(); } }}
          style={iStyle}
        />{unit('°')}
      </div>,
    ];

  } else if (s.type === 'circle') {
    title = 'Circle';
    rows = [
      <div key="r" style={rStyle}>
        <span style={lStyle}>Radius</span>
        <input
          value={vals.r}
          onChange={e => setVals(v => ({ ...v, r: e.target.value }))}
          onBlur={e  => tryCommit('r', e.target.value, parseFloat,
                         n => !isNaN(n) && n > 0,
                         (sh, n) => ({ ...sh, r: n }),
                         () => s.r.toFixed(2))}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, r: s.r.toFixed(2)})); e.target.blur(); } }}
          style={iStyle}
        />{unit('px')}
      </div>,
    ];

  } else if (s.type === 'rect') {
    title = 'Rectangle';
    rows = [
      <div key="w" style={rStyle}>
        <span style={lStyle}>Width</span>
        <input
          value={vals.w}
          onChange={e => setVals(v => ({ ...v, w: e.target.value }))}
          onBlur={e  => tryCommit('w', e.target.value, parseFloat,
                         n => !isNaN(n) && n > 0,
                         (sh, n) => ({ ...sh, w: n }),
                         () => Math.abs(s.w).toFixed(2))}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, w: Math.abs(s.w).toFixed(2)})); e.target.blur(); } }}
          style={iStyle}
        />{unit('px')}
      </div>,
      <div key="h" style={rStyle}>
        <span style={lStyle}>Height</span>
        <input
          value={vals.h}
          onChange={e => setVals(v => ({ ...v, h: e.target.value }))}
          onBlur={e  => tryCommit('h', e.target.value, parseFloat,
                         n => !isNaN(n) && n > 0,
                         (sh, n) => ({ ...sh, h: n }),
                         () => Math.abs(s.h).toFixed(2))}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, h: Math.abs(s.h).toFixed(2)})); e.target.blur(); } }}
          style={iStyle}
        />{unit('px')}
      </div>,
      <div key="rot" style={rStyle}>
        <span style={lStyle}>Rot°</span>
        <span style={{ fontSize: 10 }}>{(s._rot||0).toFixed(1)}°</span>
      </div>,
    ];

  } else if (s.type === 'curve' && cp) {
    title = 'Curve Elements';
    rows = [
      <div key="R" style={rStyle}>
        <span style={lStyle}>R</span>
        <input
          value={vals.crvR}
          onChange={e => setVals(v => ({ ...v, crvR: e.target.value }))}
          onBlur={e  => tryCommit('crvR', e.target.value, parseFloat,
                         n => !isNaN(n) && n > 0,
                         (sh, n) => applyArcRadius(sh, n),
                         () => cp.R.toFixed(2))}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setVals(v => ({...v, crvR: cp.R.toFixed(2)})); e.target.blur(); } }}
          style={iStyle}
        />{unit('px')}
      </div>,
      ...[
        ['Δ', toDMS(cp.delta)], ['T', cp.T.toFixed(1)+' px'],
        ['L', cp.L.toFixed(1)+' px'], ['M', cp.M.toFixed(1)+' px'],
        ['E', cp.E.toFixed(1)+' px'], ['Chord', cp.chord.toFixed(1)+' px'],
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

  // ── NTS label field (all committed shapes) ──────────────────────────────
  rows = rows.concat([
    <div key="_sep" style={{ borderTop: '1px solid rgba(255,255,255,0.09)', margin: '4px 0 2px' }} />,
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
  const [snapEnabled,    setSnapEnabled]    = useState(false);
  const [snapPoint,      setSnapPoint]      = useState(null);  // {x,y}|null — visual indicator

  // ── Dimension labels ───────────────────────────────────────────────────────
  // When true, each committed shape shows an inline measurement label (length,
  // radius, arc length, width×height).  Also shown live while drawing.
  const [showDims,      setShowDims]      = useState(true);
  const [showValueCard, setShowValueCard] = useState(true);

  // ── Layers ────────────────────────────────────────────────────────────────
  const _initLayers = (page.layers && page.layers.length)
    ? page.layers : [{ id: 'l_1', name: 'Layer 1', visible: true }];
  const [layers,         setLayers]         = useState(_initLayers);
  const [activeLayerId,  setActiveLayerId]  = useState(_initLayers[0].id);
  const [rightPanelOpen,   setRightPanelOpen]   = useState(true);
  const [collapsedLayers,  setCollapsedLayers]  = useState(new Set());

  const svgRef      = useRef(null);
  const svgWrapRef  = useRef(null);
  const textareaRef = useRef(null);
  const saveTimer   = useRef(null);
  // svgSizeRef: raw CSS pixel dimensions of the SVG container (updated by ResizeObserver).
  // Used to compute pixelScale (ps) = viewBox.w / svgSizeRef.w = world-units per CSS pixel.
  // ps = 1.0 at zoom:1, ps = 0.5 at zoom:2, etc.
  const svgSizeRef    = useRef({ w: 800, h: 600 });
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
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 800, h: 600 });
  // latestViewBoxRef: always holds the most recent viewBox value so that native
  // DOM event listeners (wheel, middle-mouse pan) can read it without stale closures.
  // Updated after every render via a no-dep-array useEffect below.
  const latestViewBoxRef = useRef({ x: 0, y: 0, w: 800, h: 600 });

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
  function persist(nextShapes, nextNotes, nextLayers) {
    const s = nextShapes !== undefined ? nextShapes : shapes;
    const n = nextNotes  !== undefined ? nextNotes  : notes;
    const l = nextLayers !== undefined ? nextLayers : layers;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      DB.updatePage(projectId, page.id, { shapes: s, notes: n, layers: l });
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
        const { ax, ay } = getCurveArcMid(shape);
        return [
          { key: 'p1',  x: shape.x1, y: shape.y1, type: 'endpoint' },
          { key: 'p2',  x: shape.x2, y: shape.y2, type: 'endpoint' },
          { key: 'arc', x: ax,        y: ay,        type: 'arc'     },
        ];
      }
      case 'circle':
        return [
          { key: 'c',  x: shape.cx,           y: shape.cy, type: 'endpoint' },
          { key: 'r',  x: shape.cx + shape.r, y: shape.cy, type: 'control'  },
        ];
      case 'rect':
        return [
          { key: 'tl', x: shape.x,            y: shape.y,            type: 'endpoint' },
          { key: 'br', x: shape.x + shape.w,  y: shape.y + shape.h,  type: 'endpoint' },
        ];
      case 'text':
        return [
          { key: 'tl', x: shape.x,           y: shape.y,                     type: 'endpoint' },
          { key: 'br', x: shape.x + shape.w, y: shape.y + (shape.h || 40),   type: 'control'  },
        ];
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
          const { ax: oax, ay: oay } = getCurveArcMid(shape);
          return { ...shape, x1:shape.x1+dx, y1:shape.y1+dy, x2:shape.x2+dx, y2:shape.y2+dy,
            ax: oax+dx, ay: oay+dy, ...(piv && {_pivot:piv}) };
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
        const { ax: cax, ay: cay } = getCurveArcMid(shape);
        if (nodeKey === 'p1')  return { ...shape, x1: shape.x1+dx, y1: shape.y1+dy };
        if (nodeKey === 'p2')  return { ...shape, x2: shape.x2+dx, y2: shape.y2+dy };
        if (nodeKey === 'arc') return { ...shape, ax: cax+dx, ay: cay+dy };
        break;
      }
      case 'circle':
        if (nodeKey === 'c') return { ...shape, cx: shape.cx+dx, cy: shape.cy+dy };
        if (nodeKey === 'r') return { ...shape, r: Math.max(4, shape.r+dx) };
        break;
      case 'rect': {
        if (nodeKey === 'tl') return { ...shape, x: shape.x+dx, y: shape.y+dy, w: Math.max(10, shape.w-dx), h: Math.max(10, shape.h-dy) };
        if (nodeKey === 'br') return { ...shape, w: Math.max(10, shape.w+dx), h: Math.max(10, shape.h+dy) };
        break;
      }
      case 'text':
        if (nodeKey === 'tl') return { ...shape, x: shape.x+dx, y: shape.y+dy };
        if (nodeKey === 'br') return { ...shape, w: Math.max(40, shape.w+dx) };
        break;
    }
    return shape;
  }

  // ── Pointer down ───────────────────────────────────────────────────────────
  function onPointerDown(e) {
    if (e.target.closest('.sketch-ribbon')) return;

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

    // ── Select mode: active when tool is 'select' OR when prevTool is set
    // (prevTool is set immediately after creating a shape so handles are
    //  interactive before the tool state has a chance to switch).
    if (tool === 'select' || prevTool !== null) {
      const isTouch    = e.pointerType === 'touch';
      const nodeThresh = (isTouch ? 28 : NODE_R + 4) * ps;
      const hitThresh  = (isTouch ? 24 : 8) * ps;

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

          // ── Click on shape body → body drag ─────────────────────────
          if (hitTest(pt, [sel], hitThresh)) {
            setDragNode({ shapeId: sel.id, nodeKey: 'body' });
            setDragStart({ svgX: pt.x, svgY: pt.y, snapshot: shapes });
            return;
          }
        }
      }

      // ── New selection / deselect ─────────────────────────────────────
      const hit = hitTest(pt, shapes, hitThresh);
      setSelectedId(hit ? hit.id : null);
      setDragNode(null);
      if (!hit && prevTool !== null) {
        // Clicking empty space exits post-create handle mode.
        // tool was NEVER switched away from the drawing tool, so just clear
        // prevTool and fall through — this same pointer event will start the
        // next draw immediately (no extra click needed).
        setPrevTool(null);
        // ← no return: fall through to the drawing tool handler below
      } else {
        return;
      }
    }

    if (tool === 'eraser') {
      const hitThresh = (e.pointerType === 'touch' ? 24 : 8) * ps;
      const hit = hitTest(pt, shapes, hitThresh);
      if (hit) commitShapes(shapes.filter(s => s.id !== hit.id));
      return;
    }

    if (tool === 'text') {
      const id = newId();
      setTextEdit({ id, x: pt.x, y: pt.y, w: 160, content: '', layerId: activeLayerId });
      return;
    }

    if (tool === 'line') {
      const sp = snapEnabled ? snapToNodes(pt) : pt;
      setDrawState({ type: 'line', x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y, layerId: activeLayerId });
    }

    // ── Curve: 3-click  BC → EC → arc-midpoint ───────────────────────────────
    if (tool === 'curve') {
      const sp = snapEnabled ? snapToNodes(pt) : pt;
      if (!drawState) {
        // Click 1: set BC
        setDrawState({ type: 'curve', phase: 1,
          x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y,
          ax: sp.x, ay: sp.y, layerId: activeLayerId });
      } else if (drawState.phase === 1) {
        // Click 2: lock EC, compute default arc-midpoint offset (chord/6 left of chord)
        const ex = sp.x, ey = sp.y;
        const len = Math.hypot(ex-drawState.x1, ey-drawState.y1);
        const mx  = (drawState.x1+ex)/2, my = (drawState.y1+ey)/2;
        const perpX = -(ey-drawState.y1)/(len||1);
        const perpY =  (ex-drawState.x1)/(len||1);
        const off   = len/6;
        setDrawState(d => ({ ...d, phase: 2, x2: ex, y2: ey,
          ax: mx + off*perpX, ay: my + off*perpY }));
      } else if (drawState.phase === 2) {
        // Click 3: commit with current arc-midpoint (mouse position)
        const { ax: fax, ay: fay } = drawState;
        const _crvId = newId();
        commitShapes([...shapes, { id: _crvId, type: 'curve',
          x1: drawState.x1, y1: drawState.y1,
          x2: drawState.x2, y2: drawState.y2,
          ax: fax, ay: fay,
          stroke: STROKE, strokeWidth: STROKE_W,
          layerId: drawState.layerId || activeLayerId }]);
        setSelectedId(_crvId);
        setPrevTool(tool);
        setDrawState(null);
        setSnapPoint(null);
      }
    }

    // ── Circle: 2-click ───────────────────────────────────────────────────────
    if (tool === 'circle') {
      const sp = snapEnabled ? snapToNodes(pt) : pt;
      if (!drawState) {
        // Click 1: snap + set center
        setDrawState({ type: 'circle', phase: 1, cx: sp.x, cy: sp.y, r: 0, layerId: activeLayerId });
      } else if (drawState.phase === 1) {
        // Click 2: commit at current radius
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
    }

    if (tool === 'rect') {
      const sp = snapEnabled ? snapToNodes(pt) : pt;
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
        const newRot     = ((dragStart.startRot + deltaDeg) % 360 + 360) % 360;
        setShapes(dragStart.snapshot.map(s =>
          s.id === dragNode.shapeId ? { ...s, _rot: newRot } : s
        ));
        return;
      }

      // Pivot handle: move the stored pivot point
      if (dragNode.nodeKey === 'pivot') {
        const dx = rawPt.x - dragStart.svgX;
        const dy = rawPt.y - dragStart.svgY;
        setShapes(dragStart.snapshot.map(s => {
          if (s.id !== dragNode.shapeId) return s;
          const basePiv = getShapePivot(s);
          return { ...s, _pivot: { x: basePiv.x + dx, y: basePiv.y + dy } };
        }));
        return;
      }

      // Body drag: move the whole shape
      if (dragNode.nodeKey === 'body') {
        const dx = rawPt.x - dragStart.svgX;
        const dy = rawPt.y - dragStart.svgY;
        setShapes(dragStart.snapshot.map(s =>
          s.id === dragNode.shapeId ? applyNodeDrag(s, 'body', dx, dy) : s
        ));
        return;
      }

      // Regular node drag.
      // When snap is on, project the node to the nearest candidate on any OTHER shape.
      if (snapEnabled && SNAP_NODES.has(dragNode.nodeKey)) {
        const snapshotShape = dragStart.snapshot.find(s => s.id === dragNode.shapeId);
        const snapshotNode  = snapshotShape && getNodes(snapshotShape).find(n => n.key === dragNode.nodeKey);
        if (snapshotNode) {
          const rot = snapshotShape._rot || 0;
          const piv = getShapePivot(snapshotShape);
          // Snap the screen-space target, excluding the dragged shape so it can't self-snap
          const snappedScreen = snapToNodes(rawPt, dragNode.shapeId);
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
    // Phase 2 of curve (arc-midpoint placement) is free-form — no endpoint snap.
    let pt = rawPt;
    if (snapEnabled && drawState) {
      const isCurveArc = drawState.type === 'curve' && drawState.phase === 2;
      if (!isCurveArc) pt = snapToNodes(rawPt);
      else setSnapPoint(null);
    } else {
      setSnapPoint(null);
    }

    if (!drawState) return;

    if (drawState.type === 'line') {
      setDrawState(d => ({ ...d, x2: pt.x, y2: pt.y }));
    } else if (drawState.type === 'curve') {
      if (drawState.phase === 1) {
        // EC tracks snapped mouse (phase 1: choosing second endpoint)
        setDrawState(d => ({ ...d, x2: pt.x, y2: pt.y }));
      } else if (drawState.phase === 2) {
        // Arc-midpoint tracks raw mouse — user is shaping the arc freely
        setDrawState(d => ({ ...d, ax: rawPt.x, ay: rawPt.y }));
      }
    } else if (drawState.type === 'circle') {
      const r = Math.hypot(pt.x - drawState.cx, pt.y - drawState.cy);
      setDrawState(d => ({ ...d, r }));
    } else if (drawState.type === 'rect') {
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
    // Curve and circle commit on click (handled in onPointerDown), not mouseup.
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
        const cam  = getCurveArcMid(s);
        const carc = arcCenter(s.x1, s.y1, s.x2, s.y2, cam.ax, cam.ay);
        if (carc) {
          // Loose pre-filter: bail if tp is nowhere near the circle.
          const dtc = Math.hypot(tp.x - carc.cx, tp.y - carc.cy);
          if (Math.abs(dtc - carc.R) < thresh * 4) {
            // Determine arc direction (CW or CCW) by checking whether M falls
            // in the CW span from A to B or the CCW span.
            const angA = Math.atan2(s.y1  - carc.cy, s.x1  - carc.cx);
            const angM = Math.atan2(cam.ay - carc.cy, cam.ax - carc.cx);
            const angB = Math.atan2(s.y2   - carc.cy, s.x2  - carc.cx);
            // Normalise to [0, 2π) relative to angA
            const cw = a => { let r = a - angA; while (r < 0) r += 2*Math.PI; while (r >= 2*Math.PI) r -= 2*Math.PI; return r; };
            const mCW = cw(angM), bCW = cw(angB);
            // mCW ≤ bCW → M is before B going CW → arc travels CW
            const dir  = (mCW <= bCW) ? 1 : -1;
            const span = (dir === 1) ? bCW : (2 * Math.PI - bCW);
            // Sample the arc at ~6 px intervals and test distance to tp
            const N = Math.max(10, Math.ceil(span * carc.R / 6));
            const t2 = thresh * thresh;
            for (let j = 0; j <= N; j++) {
              const a  = angA + dir * (j / N) * span;
              const dx = tp.x - (carc.cx + carc.R * Math.cos(a));
              const dy = tp.y - (carc.cy + carc.R * Math.sin(a));
              if (dx * dx + dy * dy < t2) { return s; }
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
        const sh = s.h || 40;
        if (tp.x >= s.x-thresh && tp.x <= s.x+(s.w||160)+thresh &&
            tp.y >= s.y-thresh && tp.y <= s.y+sh+thresh) return s;
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

  // ── Snap helpers ───────────────────────────────────────────────────────────
  // Returns the snap-candidate points for a shape (rotation-aware).
  // Lines/curves: endpoints. Circles: centre. Rects: four corners. Text: top-left.
  function getSnapPoints(shape) {
    const rot = shape._rot || 0;
    const piv = getShapePivot(shape);
    let raw = [];
    switch (shape.type) {
      case 'line':   raw = [{x:shape.x1,y:shape.y1},{x:shape.x2,y:shape.y2}]; break;
      case 'curve':  raw = [{x:shape.x1,y:shape.y1},{x:shape.x2,y:shape.y2}]; break;
      case 'circle': raw = [{x:shape.cx,y:shape.cy}]; break;
      case 'rect':   raw = [
        {x:shape.x,          y:shape.y},
        {x:shape.x+shape.w,  y:shape.y},
        {x:shape.x,          y:shape.y+shape.h},
        {x:shape.x+shape.w,  y:shape.y+shape.h},
      ]; break;
      case 'text': raw = [{x:shape.x,y:shape.y}]; break;
    }
    if (!rot) return raw;
    return raw.map(p => rotatePoint(p.x, p.y, piv.x, piv.y, rot));
  }

  // Tries to snap pt to the nearest committed node within SNAP_R.
  // excludeId: skip this shape's nodes (used during node-drag so a shape can't snap to itself).
  // Updates the snap-indicator state and returns the snapped point (or pt if none).
  function snapToNodes(pt, excludeId = null) {
    // Keep snap radius constant in screen pixels regardless of zoom.
    const ps     = viewBox.w / (svgSizeRef.current.w || viewBox.w);
    const SNAP_R = 10 * ps;
    let best = null, bestDist = SNAP_R;
    for (const s of shapes) {
      if (s.id === excludeId) continue;
      for (const sp of getSnapPoints(s)) {
        const d = Math.hypot(pt.x - sp.x, pt.y - sp.y);
        if (d < bestDist) { bestDist = d; best = sp; }
      }
    }
    setSnapPoint(best);
    return best || pt;
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
      // Capture actual textarea size so the foreignObject matches exactly
      const ta = textareaRef.current;
      const w  = ta ? ta.offsetWidth  : (textEdit.w || 160);
      const h  = ta ? ta.scrollHeight : 80;
      commitShapes([...shapes, { id: textEdit.id, type: 'text',
        x: textEdit.x, y: textEdit.y, w, h,
        content: textEdit.content, fontSize: 13, stroke: STROKE,
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
      setTextEdit({ id: hit.id, x: hit.x, y: hit.y, w: hit.w, content: hit.content, editing: true });
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
          const { ax, ay } = getCurveArcMid(s);
          add(s.x1,s.y1); add(s.x2,s.y2); add(ax,ay); break;
        }
        case 'circle':
          add(s.cx-s.r,s.cy); add(s.cx+s.r,s.cy);
          add(s.cx,s.cy-s.r); add(s.cx,s.cy+s.r); break;
        case 'rect':
          add(s.x,s.y); add(s.x+s.w,s.y);
          add(s.x,s.y+s.h); add(s.x+s.w,s.y+s.h); break;
        case 'text':
          add(s.x,s.y); add(s.x+(s.w||160),s.y+(s.h||40)); break;
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
        const { ax: rax, ay: ray } = getCurveArcMid(s);
        inner = <path d={arcPath(s.x1, s.y1, s.x2, s.y2, rax, ray)}
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
      case 'text':
        inner = (
          <foreignObject x={s.x} y={s.y} width={s.w || 160} height={(s.h || 80) + 8} style={sel}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{
              width: '100%', boxSizing: 'border-box',
              fontFamily: 'Courier New, monospace', fontSize: s.fontSize || 13,
              color: s.stroke, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              overflowWrap: 'break-word', lineHeight: 1.4, padding: '2px 4px',
              pointerEvents: 'none', userSelect: 'none',
            }}>
              {s.content}
            </div>
          </foreignObject>
        );
        break;
      default: return null;
    }
    return <g key={s.id} transform={transform}>{inner}</g>;
  }

  // ── Render dimension label(s) for a committed shape ───────────────────────
  // Labels live OUTSIDE shape groups so the group's rotation transform doesn't
  // skew the text.  Instead we manually rotate the anchor point and adjust the
  // text angle to match the (possibly rotated) geometry.
  function renderDimLabel(s) {
    const ps  = viewBox.w / (svgSizeRef.current.w || viewBox.w);
    const OFF = 13 * ps;   // offset from shape edge → constant screen px at any zoom

    // NTS override — show custom label at shape centre instead of computed dims
    if (s.ntsLabel) {
      let nx = 0, ny = 0;
      switch (s.type) {
        case 'line':   nx = (s.x1+s.x2)/2; ny = (s.y1+s.y2)/2; break;
        case 'circle': nx = s.cx;           ny = s.cy;           break;
        case 'rect':   nx = s.x + s.w/2;   ny = s.y + s.h/2;   break;
        case 'curve':  { const { ax, ay } = getCurveArcMid(s); nx = ax; ny = ay; break; }
        default: return null;
      }
      return dimTextEl(nx, ny, 0, s.ntsLabel + ' *', ps);
    }

    const rot = s._rot || 0;
    const piv = getShapePivot(s);

    // Rotate anchor (rawX, rawY) by the shape's own rotation, then render text
    // at that world position with text angle adjusted to match rotated direction.
    function D(rawX, rawY, ang, txt) {
      const { x: lx, y: ly } = rot
        ? rotatePoint(rawX, rawY, piv.x, piv.y, rot)
        : { x: rawX, y: rawY };
      let a = (ang + rot) % 360;
      if (a >  90) a -= 180;
      if (a < -90) a += 180;
      return dimTextEl(lx, ly, a, txt, ps);
    }

    switch (s.type) {
      case 'line': {
        const len = Math.hypot(s.x2-s.x1, s.y2-s.y1);
        if (len < 5 * ps) return null;
        const mx = (s.x1+s.x2)/2, my = (s.y1+s.y2)/2;
        // Perpendicular offset in the left-hand normal direction
        const nx = -(s.y2-s.y1)/len, ny = (s.x2-s.x1)/len;
        const ang = Math.atan2(s.y2-s.y1, s.x2-s.x1) * 180 / Math.PI;
        return D(mx + nx*OFF, my + ny*OFF, ang, fmtDim(len));
      }
      case 'curve': {
        const { ax: rax, ay: ray } = getCurveArcMid(s);
        const cp = computeCurveProps(s.x1, s.y1, s.x2, s.y2, rax, ray);
        if (!cp || cp.L < 5 * ps) return null;
        // Push label outward from chord midpoint along the arc-midpoint direction
        const mx = (s.x1+s.x2)/2, my = (s.y1+s.y2)/2;
        const olen = Math.hypot(rax-mx, ray-my) || 1;
        const ux = (rax-mx)/olen, uy = (ray-my)/olen;
        const lx1 = rax + ux * OFF,            ly1 = ray + uy * OFF;
        const lx2 = rax + ux * (OFF + 12*ps),  ly2 = ray + uy * (OFF + 12*ps);
        const r0 = rot ? rotatePoint(lx1, ly1, piv.x, piv.y, rot) : { x: lx1, y: ly1 };
        const r1 = rot ? rotatePoint(lx2, ly2, piv.x, piv.y, rot) : { x: lx2, y: ly2 };
        return <>
          {dimTextEl(r0.x, r0.y, 0, `L ${fmtDim(cp.L)}`, ps)}
          {dimTextEl(r1.x, r1.y, 0, `R ${fmtDim(cp.R)}`, ps)}
        </>;
      }
      case 'circle': {
        if (s.r < 5 * ps) return null;
        // Radius label inside the circle, slightly below centre
        return D(s.cx, s.cy + s.r * 0.25, 0, `R=${fmtDim(s.r)}`);
      }
      case 'rect': {
        // Width label below bottom edge, height label right of right edge
        return <>
          {D(s.x + s.w/2,     s.y + s.h + OFF, 0,   fmtDim(Math.abs(s.w)))}
          {D(s.x + s.w + OFF, s.y + s.h/2,     -90, fmtDim(Math.abs(s.h)))}
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
          if (n.key === 'arc') {
            // Arc midpoint handle — green diamond with guide line from chord midpoint
            const midRaw = { x: (shape.x1+shape.x2)/2, y: (shape.y1+shape.y2)/2 };
            const midRot = rot ? rotatePoint(midRaw.x, midRaw.y, piv.x, piv.y, rot) : midRaw;
            const sz = 7 * ps;
            const pts = `${np.x},${np.y-sz} ${np.x+sz},${np.y} ${np.x},${np.y+sz} ${np.x-sz},${np.y}`;
            return (
              <g key="arc">
                <line x1={midRot.x} y1={midRot.y} x2={np.x} y2={np.y}
                  stroke="rgba(34,197,94,0.45)" strokeWidth={ps} strokeDasharray={`${4*ps},${3*ps}`}
                  style={{ pointerEvents: 'none' }} />
                <polygon points={pts}
                  fill="rgba(34,197,94,0.18)" stroke="#22C55E" strokeWidth={1.5 * ps}
                  style={{ cursor: 'move' }}
                  onPointerDown={onDown} />
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
        return <>
          <line x1={drawState.x1} y1={drawState.y1} x2={drawState.x2} y2={drawState.y2} {...props} />
          {showDims && len >= 5*ps && dimTextEl(mx + nx*OFF, my + ny*OFF, ang, fmtDim(len), ps)}
        </>;
      }
      case 'curve':
        if (drawState.phase === 1) {
          // Phase 1: show dashed chord BC→EC + chord length label
          const len = Math.hypot(drawState.x2-drawState.x1, drawState.y2-drawState.y1);
          const mx  = (drawState.x1+drawState.x2)/2, my = (drawState.y1+drawState.y2)/2;
          const nx  = len > 0 ? -(drawState.y2-drawState.y1)/len : 0;
          const ny  = len > 0 ?  (drawState.x2-drawState.x1)/len : 1;
          const ang = Math.atan2(drawState.y2-drawState.y1, drawState.x2-drawState.x1) * 180/Math.PI;
          return <>
            <line x1={drawState.x1} y1={drawState.y1} x2={drawState.x2} y2={drawState.y2} {...props} />
            {showDims && len >= 5*ps && dimTextEl(mx + nx*OFF, my + ny*OFF, ang, fmtDim(len), ps)}
          </>;
        } else {
          // Phase 2: live circular arc + green diamond at arc-midpoint + guide dashes
          const { ax: pax, ay: pay } = drawState;
          const arcD = arcPath(drawState.x1, drawState.y1, drawState.x2, drawState.y2, pax, pay);
          const midX = (drawState.x1+drawState.x2)/2, midY = (drawState.y1+drawState.y2)/2;
          const sz = 6;
          const dpts = `${pax},${pay-sz} ${pax+sz},${pay} ${pax},${pay+sz} ${pax-sz},${pay}`;
          const aInfo = arcCenter(drawState.x1, drawState.y1, drawState.x2, drawState.y2, pax, pay);
          const cp   = showDims ? computeCurveProps(drawState.x1, drawState.y1, drawState.x2, drawState.y2, pax, pay) : null;
          const olen = Math.hypot(pax-midX, pay-midY) || 1;
          const ux   = (pax-midX)/olen, uy = (pay-midY)/olen;
          return <>
            <path d={arcD} {...props} />
            <line x1={midX} y1={midY} x2={pax} y2={pay}
              stroke="rgba(34,197,94,0.5)" strokeWidth={1} strokeDasharray="4,3" />
            <polygon points={dpts} fill="rgba(34,197,94,0.25)" stroke="#22C55E" strokeWidth={1.5} opacity={0.9} />
            {/* BC and EC dot indicators */}
            <circle cx={drawState.x1} cy={drawState.y1} r={4} fill="#3B82F6" opacity={0.6} />
            <circle cx={drawState.x2} cy={drawState.y2} r={4} fill="#3B82F6" opacity={0.6} />
            {/* Radius indicator: faint line from centre to arc-midpoint */}
            {aInfo && <line x1={aInfo.cx} y1={aInfo.cy} x2={pax} y2={pay}
              stroke="rgba(34,197,94,0.2)" strokeWidth={1} strokeDasharray="2,4" />}
            {/* Live arc-length + radius labels */}
            {showDims && cp && cp.L >= 5*ps && <>
              {dimTextEl(pax + ux*OFF,           pay + uy*OFF,           0, `L ${fmtDim(cp.L)}`, ps)}
              {dimTextEl(pax + ux*(OFF + 12*ps), pay + uy*(OFF + 12*ps), 0, `R ${fmtDim(cp.R)}`, ps)}
            </>}
          </>;
        }
      case 'circle': {
        const r = Math.max(0, drawState.r);
        return <>
          <circle cx={drawState.cx} cy={drawState.cy} r={r} {...props} />
          {showDims && r >= 5*ps && dimTextEl(drawState.cx, drawState.cy, 0, `R=${fmtDim(r)}`, ps)}
        </>;
      }
      case 'rect': {
        const w = Math.max(0, drawState.w), h = Math.max(0, drawState.h);
        return <>
          <rect x={drawState.x} y={drawState.y} width={w} height={h} {...props} />
          {showDims && w >= 5*ps && dimTextEl(drawState.x + w/2,     drawState.y + h + OFF, 0,   fmtDim(w), ps)}
          {showDims && h >= 5*ps && dimTextEl(drawState.x + w + OFF, drawState.y + h/2,     -90, fmtDim(h), ps)}
        </>;
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
      <PageHeaderStrip page={page} projectId={projectId} onReload={onReload} />

      {/* ── Top Toolbar ──────────────────────────────────────────────────── */}
      <div style={{
        height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px',
        background: 'rgba(22,30,60,0.92)', backdropFilter: 'blur(6px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        {/* Snap toggle */}
        <button
          onClick={() => { setSnapEnabled(v => !v); setSnapPoint(null); }}
          title={snapEnabled ? 'Node snap ON — click to disable' : 'Node snap OFF — click to enable'}
          style={{
            height: 26, padding: '0 10px', borderRadius: 4,
            display: 'flex', alignItems: 'center', gap: 5,
            background: snapEnabled ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${snapEnabled ? 'rgba(34,197,94,0.55)' : 'rgba(255,255,255,0.14)'}`,
            color: snapEnabled ? '#4ADE80' : 'rgba(255,255,255,0.45)',
            cursor: 'pointer', fontSize: 11,
            fontFamily: 'Courier New, monospace', outline: 'none', transition: 'all 0.15s',
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>⊙</span>
          <span style={{ letterSpacing: '0.03em' }}>Snap</span>
        </button>

        {/* Dims toggle */}
        <button
          onClick={() => setShowDims(v => !v)}
          title={showDims ? 'Dimension labels ON — click to hide' : 'Dimension labels OFF — click to show'}
          style={{
            height: 26, padding: '0 10px', borderRadius: 4,
            display: 'flex', alignItems: 'center', gap: 5,
            background: showDims ? 'rgba(99,179,237,0.18)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${showDims ? 'rgba(99,179,237,0.55)' : 'rgba(255,255,255,0.14)'}`,
            color: showDims ? '#90CDF4' : 'rgba(255,255,255,0.45)',
            cursor: 'pointer', fontSize: 11,
            fontFamily: 'Courier New, monospace', outline: 'none', transition: 'all 0.15s',
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>◫</span>
          <span style={{ letterSpacing: '0.03em' }}>Dims</span>
        </button>

        {/* Card toggle */}
        <button
          onClick={() => setShowValueCard(v => !v)}
          title={showValueCard ? 'Shape value card ON — click to hide' : 'Shape value card OFF — click to show'}
          style={{
            height: 26, padding: '0 10px', borderRadius: 4,
            display: 'flex', alignItems: 'center', gap: 5,
            background: showValueCard ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${showValueCard ? 'rgba(167,139,250,0.55)' : 'rgba(255,255,255,0.14)'}`,
            color: showValueCard ? '#C4B5FD' : 'rgba(255,255,255,0.45)',
            cursor: 'pointer', fontSize: 11,
            fontFamily: 'Courier New, monospace', outline: 'none', transition: 'all 0.15s',
          }}
        >
          <span style={{ fontSize: 12, lineHeight: 1 }}>▤</span>
          <span style={{ letterSpacing: '0.03em' }}>Card</span>
        </button>

        {/* Separator */}
        <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', margin: '0 2px' }} />

        {/* Zoom % readout */}
        <span style={{
          fontSize: 10, fontFamily: 'Courier New, monospace', letterSpacing: '0.03em',
          color: 'rgba(255,255,255,0.4)', minWidth: 36, textAlign: 'right',
          userSelect: 'none',
        }}>
          {Math.round((svgSizeRef.current.w / viewBox.w) * 100)}%
        </span>

        {/* Zoom to Extents */}
        <button
          onClick={zoomToExtents}
          title="Zoom to fit all shapes"
          style={{
            height: 26, padding: '0 8px', borderRadius: 4,
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.14)',
            color: 'rgba(255,255,255,0.55)',
            cursor: 'pointer', fontSize: 11,
            fontFamily: 'Courier New, monospace', outline: 'none',
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>⊡</span>
          <span>Fit</span>
        </button>

        {/* Reset zoom */}
        <button
          onClick={zoomReset}
          title="Reset zoom to 100%"
          style={{
            height: 26, padding: '0 8px', borderRadius: 4,
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.14)',
            color: 'rgba(255,255,255,0.55)',
            cursor: 'pointer', fontSize: 11,
            fontFamily: 'Courier New, monospace', outline: 'none',
          }}
        >
          <span style={{ fontSize: 12, lineHeight: 1 }}>1:1</span>
        </button>

        {/* Pan hint — only shown while actively panning */}
        {isPanActive && (
          <span style={{
            fontSize: 10, fontFamily: 'Courier New, monospace',
            color: 'rgba(255,255,255,0.35)', marginLeft: 4,
          }}>panning…</span>
        )}
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

          {/* Tool buttons — only show when open */}
          {ribbonOpen && TOOLS.map(t => (
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

          {/* Delete selected — shown when a shape is selected */}
          {ribbonOpen && selectedId && (
            <button
              onClick={() => { commitShapes(shapes.filter(s => s.id !== selectedId)); setSelectedId(null); }}
              title="Delete selected"
              style={{
                marginTop: 'auto', width: 52, height: 40, flexShrink: 0,
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
        <div ref={svgWrapRef} className="page-grid-blue" style={{ flex: 1, position: 'relative', overflow: 'hidden', touchAction: 'none' }}>

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
            {selectedShape && (tool === 'select' || prevTool !== null) && renderNodes(selectedShape)}

            {/* Preview shape while drawing */}
            {renderPreview()}

            {/* Snap indicator — green crosshair at nearest snap point.
                Radii counter-scaled by ps so the indicator stays the same
                visual size in screen pixels regardless of zoom. */}
            {snapEnabled && snapPoint && (() => {
              const _ps = viewBox.w / (svgSizeRef.current.w || viewBox.w);
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <circle cx={snapPoint.x} cy={snapPoint.y} r={9 * _ps}
                    fill="none" stroke="#22C55E" strokeWidth={1.5 * _ps} opacity={0.85} />
                  <circle cx={snapPoint.x} cy={snapPoint.y} r={2.5 * _ps}
                    fill="#22C55E" opacity={0.85} />
                </g>
              );
            })()}
          </svg>

          {/* ── Shape Value Card ─────────────────────────────────────────────── */}
          {/* Curve draw-phase live preview (read-only badge) */}
          {showValueCard && (() => {
            if (!drawState || drawState.type !== 'curve' || drawState.phase !== 2) return null;
            const cp = computeCurveProps(drawState.x1, drawState.y1,
                                         drawState.x2, drawState.y2, drawState.ax, drawState.ay);
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
                  ['R', cp.R.toFixed(1)+' px'], ['Δ', toDMS(cp.delta)],
                  ['T', cp.T.toFixed(1)+' px'], ['L', cp.L.toFixed(1)+' px'],
                  ['M', cp.M.toFixed(1)+' px'], ['E', cp.E.toFixed(1)+' px'],
                  ['Chord', cp.chord.toFixed(1)+' px'],
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
            />
          )}

          {/* Inline text editor — absolutely positioned in SVG container.
              textEdit stores world coordinates; convert to screen pixels for CSS. */}
          {textEdit && (() => {
            const sp = worldToScreen(textEdit.x, textEdit.y);
            // Scale the minimum width too so the textarea matches the SVG text size.
            const _ps = viewBox.w / (svgSizeRef.current.w || viewBox.w);
            return (
            <div style={{
              position: 'absolute',
              left: sp.x, top: sp.y,
              minWidth: (textEdit.w || 160) / _ps,
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
                  width: '100%', minHeight: 40,
                  background: 'rgba(255,255,248,0.97)',
                  border: '1.5px dashed #3B82F6',
                  outline: 'none', resize: 'both',
                  fontFamily: 'Courier New, monospace', fontSize: 13,
                  padding: '2px 4px', lineHeight: 1.4, color: STROKE,
                  boxSizing: 'border-box', overflow: 'hidden',
                }}
                rows={2}
                onInput={e => {
                  // Auto-grow height to match content while editing
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
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

      {/* Notes strip */}
      <div style={{ borderTop: '1px solid rgba(80,120,200,0.18)', background: 'rgba(255,255,255,0.9)', flexShrink: 0 }}>
        <textarea
          value={notes}
          onChange={e => handleNotesChange(e.target.value)}
          placeholder="Sketch notes, labels, bearings, dimensions..."
          className="w-full px-4 py-3 text-sm font-data text-fb-text bg-transparent resize-none outline-none"
          rows={3}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Expose SketchPage to the app shell and signal ready.
// =============================================================================
window.SketchPage = SketchPage;
window._resolveSketch();
