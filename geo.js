// FieldBook coordinate engine — window.fbGeo
//
// One place for everything spatial: the CRS registry, grid <-> lat/lon
// conversion, the geoid lookup, and the unified point index that the exporter
// (and the future map page) read. Plain JS, no JSX — loaded by a normal
// <script> tag before the Babel block. Depends on proj4js (CDN) and, for
// heights, geoid-ns.js.
(function () {
  'use strict';

  // ─── CRS registry ──────────────────────────────────────────────────────────
  // Projections are DATA. To add a system, add an entry — no code changes.
  //   id        stable key stored on the project (project.crs)
  //   label     full name shown in settings / exports
  //   short     compact name for chips and badges
  //   epsg      EPSG code (null for local)
  //   proj4     proj4 definition string (null = no lat/lon possible)
  //   fileTag   filesystem-safe name used in export filenames
  //   datumText text written to the Title page "Datum & Projection" field
  //
  // Definitions are from the EPSG registry via https://epsg.io (retrieved
  // 2026-10-10):
  //   EPSG:2961  NAD83(CSRS) / UTM zone 20N
  //              Transverse Mercator, CM 63°W, k0 0.9996, FE 500 000, FN 0, GRS80
  //   EPSG:8083  NAD83(CSRS)v6 / MTM NS 2010 zone 5   (Nova Scotia west of 63°W)
  //              Transverse Mercator, lat0 0, CM 64°30'W, k0 0.9999,
  //              FE 25 500 000, FN 0, GRS80
  //              NOTE: NOT EPSG:2295 — that is the old ATS77 zone 5 (FE 5 500 000).
  //
  // DATUM NOTE: phone GNSS reports WGS84. It is treated here as NAD83(CSRS)
  // with NO datum shift (the two differ by roughly 1–1.5 m in Nova Scotia,
  // well inside phone accuracy). So the strings below carry no +towgs84 and
  // lat/lon in this app means NAD83(CSRS) lat/lon. Do not use phone-sourced
  // values for anything survey-grade.
  const CRS_REGISTRY = [
    {
      id: 'utm20n',
      label: 'NAD83(CSRS) / UTM zone 20N',
      short: 'UTM 20N',
      epsg: 2961,
      proj4: '+proj=utm +zone=20 +ellps=GRS80 +units=m +no_defs',
      fileTag: 'NAD83CSRS-UTM20N',
      datumText: 'NAD83(CSRS), UTM Zone 20N / CGVD2013',
    },
    {
      id: 'nsmtm5',
      label: 'NAD83(CSRS) / MTM Nova Scotia zone 5',
      short: 'NS MTM 5',
      epsg: 8083,
      proj4: '+proj=tmerc +lat_0=0 +lon_0=-64.5 +k=0.9999 +x_0=25500000 +y_0=0 +ellps=GRS80 +units=m +no_defs',
      fileTag: 'NAD83CSRS-NSMTM5',
      datumText: 'NAD83(CSRS), MTM Nova Scotia Zone 5 / CGVD2013',
    },
    {
      id: 'local',
      label: 'Local / assumed coordinates',
      short: 'Local',
      epsg: null,
      proj4: null,
      fileTag: 'LOCAL',
      datumText: 'Local / assumed coordinates',
    },
  ];
  const DEFAULT_CRS = 'utm20n';
  // Geographic side of every conversion — same ellipsoid as the grids, so
  // proj4 performs a pure projection with no datum step.
  const GEOGRAPHIC = '+proj=longlat +ellps=GRS80 +no_defs';

  function getCrs(id) {
    return CRS_REGISTRY.find(c => c.id === id) || null;
  }
  // Projects created before CRS support have no `crs` — they read as the app
  // default and are only written when the user changes the setting.
  function projectCrsId(project) {
    return (project && getCrs(project.crs)) ? project.crs : DEFAULT_CRS;
  }
  function projectCrs(project) { return getCrs(projectCrsId(project)); }
  function isGrid(crsId) { const c = getCrs(crsId); return !!(c && c.proj4); }

  const _conv = {};
  function conv(crsId) {
    if (_conv[crsId]) return _conv[crsId];
    const c = getCrs(crsId);
    if (!c || !c.proj4 || typeof proj4 === 'undefined') return null;
    return (_conv[crsId] = proj4(GEOGRAPHIC, c.proj4));
  }

  const fin = v => typeof v === 'number' && isFinite(v);

  // Grid (northing, easting) -> { lat, lon } in decimal degrees, or null if
  // the CRS is local / unknown or the inputs aren't numbers.
  function toLatLon(n, e, crsId) {
    const c = conv(crsId);
    if (!c || !fin(n) || !fin(e)) return null;
    const out = c.inverse([e, n]);
    return (fin(out[0]) && fin(out[1])) ? { lat: out[1], lon: out[0] } : null;
  }

  // Lat/lon (decimal degrees) -> { n, e } in metres, or null.
  function toGrid(lat, lon, crsId) {
    const c = conv(crsId);
    if (!c || !fin(lat) || !fin(lon)) return null;
    const out = c.forward([lon, lat]);
    return (fin(out[0]) && fin(out[1])) ? { n: out[1], e: out[0] } : null;
  }

  // ─── Geoid (CGG2013a, Nova Scotia subset — see geoid-ns.js) ────────────────
  let _grid = null;
  function grid() {
    if (_grid) return _grid;
    const g = window.FB_GEOID_NS;
    if (!g) return null;
    const bin = atob(g.data);
    const v = new Int16Array(bin.length / 2);
    for (let i = 0; i < v.length; i++) {
      const u = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); // little-endian
      v[i] = u > 32767 ? u - 65536 : u;
    }
    return (_grid = { ...g, v });
  }

  // Geoid undulation N (metres) at a position by bilinear interpolation.
  // Returns null outside the bundled Nova Scotia grid.
  function geoidN(lat, lon) {
    const g = grid();
    if (!g || !fin(lat) || !fin(lon)) return null;
    const fr = (g.latN - lat) / g.dLat;
    const fc = (lon - g.lonW) / g.dLon;
    if (fr < 0 || fc < 0 || fr > g.nRows - 1 || fc > g.nCols - 1) return null;
    const r0 = Math.min(Math.floor(fr), g.nRows - 2);
    const c0 = Math.min(Math.floor(fc), g.nCols - 2);
    const tr = fr - r0, tc = fc - c0;
    const at = (r, c) => g.v[r * g.nCols + c];
    const top = at(r0, c0) * (1 - tc) + at(r0, c0 + 1) * tc;
    const bot = at(r0 + 1, c0) * (1 - tc) + at(r0 + 1, c0 + 1) * tc;
    return (top * (1 - tr) + bot * tr) * g.scale;
  }

  // Orthometric height H = h − N. Returns { h, N, H }; N and H are null when
  // h is missing or the point is outside the geoid grid.
  function orthoHeight(h, lat, lon) {
    const N = geoidN(lat, lon);
    const ok = fin(h) && N !== null;
    return { h: fin(h) ? h : null, N, H: ok ? h - N : null };
  }

  // ─── Phone-GPS formatting (recon grade — never survey formatting) ──────────
  const GPS_GRID_DECIMALS = 1;   // N/E written to PNEZD cells for phone points
  const GPS_ELEV_DECIMALS = 0;   // phone vertical is ±5–15 m at best

  function fmtGrid(v) { return fin(v) ? v.toFixed(GPS_GRID_DECIMALS) : ''; }
  function fmtElev(v) { return fin(v) ? v.toFixed(GPS_ELEV_DECIMALS) : ''; }
  function fmtAcc(acc) {
    return fin(acc) ? `±${acc < 10 ? acc.toFixed(1).replace(/\.0$/, '') : Math.round(acc)} m phone GPS` : 'phone GPS';
  }
  function fmtLatLon(lat, lon) {
    if (!fin(lat) || !fin(lon)) return '';
    return `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(5)}°${lon >= 0 ? 'E' : 'W'}`;
  }
  // Android routes geo: links straight to the user's map app.
  function geoUri(lat, lon, label) {
    if (!fin(lat) || !fin(lon)) return null;
    const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    const q = label ? `${ll}(${encodeURIComponent(String(label))})` : ll;
    return `geo:${ll}?q=${q}`;
  }

  // Build the `geo` block stored on a GPS-sourced record (point row, photo,
  // voice note). lat/lon is the source of truth; grid values are derived.
  //   fix = { lat, lon, h, acc, ts, fixes }
  function makeGeo(fix, source) {
    const oh = orthoHeight(fix.h, fix.lat, fix.lon);
    return {
      source: source || 'gps',
      lat: fix.lat, lon: fix.lon,
      h: oh.h, N: oh.N, H: oh.H,          // ellipsoid ht (phone), geoid undulation, orthometric
      acc: fin(fix.acc) ? fix.acc : null,
      ts: fix.ts || new Date().toISOString(),
      fixes: fix.fixes || 1,
    };
  }

  // PNEZD cell values for a GPS-sourced point in the project's CRS.
  // Z stays blank unless the project opted in (then Z = H, CGVD2013).
  function gpsCells(geo, project) {
    const g = toGrid(geo.lat, geo.lon, projectCrsId(project));
    return {
      col_north: g ? fmtGrid(g.n) : '',
      col_east:  g ? fmtGrid(g.e) : '',
      col_elev:  (project && project.gpsUseZ && fin(geo.H)) ? fmtElev(geo.H) : '',
    };
  }

  // ─── Unified point index ───────────────────────────────────────────────────
  // Every point the project knows about, from any source. The exporter and the
  // future map page both read this — nothing else should walk pages for points.
  //
  // Sources:
  //   'instrument'  Points-page row typed / imported / placed on a sketch
  //   'gps'         Points-page row captured with phone GPS
  //   'notes-pin'   Points-page row dropped from a Notes page
  //   'photo'       position of a photo on a Photos page
  //   'voice'       position of a voice note (standalone or attached to a photo)
  //
  // Entry: { id, number, N, E, Z, desc, lat, lon, source, phone, acc, ts,
  //          pageId, pageType, pageTitle }
  //   N/E/Z are numbers or null. lat/lon are null when the project is Local
  //   (instrument points) — phone-sourced entries always keep their lat/lon.
  const SOURCES = {
    'instrument': { label: 'Points page', icon: '◎' },
    'gps':        { label: 'GPS point',   icon: '📍' },
    'notes-pin':  { label: 'Notes pin',   icon: '📝' },
    'photo':      { label: 'Photo',       icon: '📷' },
    'voice':      { label: 'Voice note',  icon: '🎙' },
  };

  function num(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s || s.startsWith('=')) return null;
    const n = Number(s.replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  function getProjectPoints(project) {
    const out = [];
    if (!project) return out;
    const crsId = projectCrsId(project);
    const pages = project.pages || [];

    // A media record (photo / voice) that carries its own phone position.
    function pushMedia(rec, source, pg, fallbackDesc) {
      if (!rec || !rec.geo || !fin(rec.geo.lat) || !fin(rec.geo.lon)) return;
      const g = toGrid(rec.geo.lat, rec.geo.lon, crsId);
      out.push({
        id: rec.id, number: String(rec.ptNum ?? '').trim(),
        N: g ? g.n : null, E: g ? g.e : null,
        Z: (project.gpsUseZ && fin(rec.geo.H)) ? rec.geo.H : null,
        desc: rec.title || rec.note || rec.desc || fallbackDesc || '',
        lat: rec.geo.lat, lon: rec.geo.lon,
        source, phone: true, acc: rec.geo.acc ?? null, ts: rec.geo.ts || null,
        pageId: pg.id, pageType: pg.type, pageTitle: pg.title || '',
      });
    }

    pages.forEach(pg => {
      if (pg.type === 'points') {
        (pg.rows || []).forEach(r => {
          const c = r.cells || {};
          const number = String(c.col_ptnum ?? '').trim();
          const N = num(c.col_north), E = num(c.col_east), Z = num(c.col_elev);
          const geo = (r.geo && fin(r.geo.lat) && fin(r.geo.lon)) ? r.geo : null;
          if (!geo && N === null && E === null) return;   // blank / unplaced row
          let lat = null, lon = null;
          if (geo) { lat = geo.lat; lon = geo.lon; }
          else if (N !== null && E !== null) {
            const ll = toLatLon(N, E, crsId);
            if (ll) { lat = ll.lat; lon = ll.lon; }
          }
          out.push({
            id: r.id, number, N, E, Z,
            desc: String(c.col_desc ?? ''),
            lat, lon,
            source: geo ? (geo.source || 'gps') : 'instrument',
            phone: !!geo, acc: geo ? (geo.acc ?? null) : null, ts: geo ? (geo.ts || null) : null,
            pageId: pg.id, pageType: pg.type, pageTitle: pg.title || '',
          });
        });
      }
      if (pg.type === 'photo') {
        (pg.photos || []).forEach(ph => {
          pushMedia(ph, 'photo', pg, 'Photo');
          (ph && ph.voice || []).forEach(v => pushMedia(v, 'voice', pg, 'Voice memo'));
        });
        (pg.voiceNotes || []).forEach(v => pushMedia(v, 'voice', pg, 'Voice note'));
      }
    });
    return out;
  }

  // Every point number in use anywhere in the project (as trimmed strings).
  function usedPointNumbers(project) {
    const used = new Set();
    (project && project.pages || []).forEach(pg => {
      (pg.rows || []).forEach(r => {
        if (pg.type !== 'points') return;
        const n = String(r.cells?.col_ptnum ?? '').trim();
        if (n) used.add(n);
      });
      (pg.photos || []).forEach(ph => {
        if (ph && String(ph.ptNum ?? '').trim()) used.add(String(ph.ptNum).trim());
        (ph && ph.voice || []).forEach(v => { if (String(v.ptNum ?? '').trim()) used.add(String(v.ptNum).trim()); });
      });
      (pg.voiceNotes || []).forEach(v => { if (String(v.ptNum ?? '').trim()) used.add(String(v.ptNum).trim()); });
    });
    return used;
  }

  // Phone-captured points number from their own per-project range (default
  // 9001) so they never collide with instrument point numbers.
  const DEFAULT_GPS_PT_START = 9001;
  function gpsPtStart(project) {
    const n = parseInt(project && project.gpsPtStart);
    return (isFinite(n) && n > 0) ? n : DEFAULT_GPS_PT_START;
  }
  function nextGpsPtNum(project) {
    const used = usedPointNumbers(project);
    let n = gpsPtStart(project);
    while (used.has(String(n))) n++;
    return n;
  }

  // ─── CRS change ────────────────────────────────────────────────────────────
  // What changing a project's CRS would do. Used by the settings dialog to
  // decide whether to ask "relabel or reproject".
  function crsChangeSummary(project, toId) {
    const fromId = projectCrsId(project);
    let gps = 0, instrument = 0;
    (project.pages || []).forEach(pg => {
      if (pg.type !== 'points') return;
      (pg.rows || []).forEach(r => {
        if (r.geo && fin(r.geo.lat)) gps++;
        else if (num(r.cells?.col_north) !== null && num(r.cells?.col_east) !== null) instrument++;
      });
    });
    return { fromId, toId, gps, instrument, canReproject: isGrid(fromId) && isGrid(toId) };
  }

  // Returns the project's pages with point coordinates updated for `toId`.
  //   - GPS-sourced rows ALWAYS re-derive from their stored lat/lon (blank N/E
  //     when the target is Local).
  //   - Instrument rows are reprojected only when `reproject` is true and both
  //     systems are real grids; otherwise their numbers are left untouched
  //     (relabel only). Decimal places typed by the user are preserved.
  //   - Sketch point shapes carry copies of N/E — they are refreshed to match.
  function applyCrsChange(project, toId, reproject) {
    const fromId = projectCrsId(project);
    const doInstr = !!reproject && isGrid(fromId) && isGrid(toId);
    const target = { ...project, crs: toId };
    const changed = {};   // rowId -> { col_north, col_east, [col_elev] }
    const decimals = s => { const m = String(s).trim().match(/\.(\d+)$/); return m ? m[1].length : 0; };

    const pages = (project.pages || []).map(pg => {
      if (pg.type !== 'points' || !pg.rows) return pg;
      const rows = pg.rows.map(r => {
        const c = r.cells || {};
        if (r.geo && fin(r.geo.lat) && fin(r.geo.lon)) {
          const gc = gpsCells(r.geo, target);
          const cells = { ...c, col_north: gc.col_north, col_east: gc.col_east };
          changed[r.id] = cells;
          return { ...r, cells };
        }
        if (!doInstr) return r;
        const N = num(c.col_north), E = num(c.col_east);
        if (N === null || E === null) return r;
        const ll = toLatLon(N, E, fromId);
        const g = ll && toGrid(ll.lat, ll.lon, toId);
        if (!g) return r;
        const d = Math.max(decimals(c.col_north), decimals(c.col_east));
        const cells = { ...c, col_north: g.n.toFixed(d), col_east: g.e.toFixed(d) };
        changed[r.id] = cells;
        return { ...r, cells };
      });
      return { ...pg, rows };
    });

    return pages.map(pg => {
      if (pg.type !== 'sketch' || !pg.shapes) return pg;
      let touched = false;
      const shapes = pg.shapes.map(s => {
        if (s.type !== 'point' || !s.pointId || !changed[s.pointId]) return s;
        touched = true;
        return { ...s, northing: changed[s.pointId].col_north, easting: changed[s.pointId].col_east };
      });
      return touched ? { ...pg, shapes } : pg;
    });
  }

  // Does free-text datum (Title page) agree with the project CRS? Loose match
  // on the distinguishing words so hand-edited text doesn't trip the warning.
  function datumMatchesCrs(text, crsId) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return true;
    if (crsId === 'utm20n') return /utm/.test(t) && /20/.test(t);
    if (crsId === 'nsmtm5') return /mtm/.test(t) && /5/.test(t);
    if (crsId === 'local')  return /local|assumed/.test(t);
    return true;
  }

  // ─── Point-number ranges ("1-50, 75, 9001-9010") ───────────────────────────
  // Returns { ranges: [[lo, hi], …], bad: [tokens that didn't parse] }.
  function parseRange(str) {
    const ranges = [], bad = [];
    String(str || '').split(/[,;\s]+/).filter(Boolean).forEach(tok => {
      const m = tok.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
      if (!m) { bad.push(tok); return; }
      const a = parseInt(m[1]), b = m[2] !== undefined ? parseInt(m[2]) : a;
      ranges.push([Math.min(a, b), Math.max(a, b)]);
    });
    return { ranges, bad };
  }
  function inRanges(number, ranges) {
    if (!/^\d+$/.test(String(number).trim())) return false;
    const n = parseInt(number);
    return ranges.some(([lo, hi]) => n >= lo && n <= hi);
  }

  // ─── Self-test ─────────────────────────────────────────────────────────────
  // Run from the browser console:   fbGeo.geoSelfTest()
  //
  // ┌──────────────────────────────────────────────────────────────────────┐
  // │  PLACEHOLDER — NOVA SCOTIA CONTROL MONUMENT                          │
  // │  Fill in the PUBLISHED values for one NSCRS monument (NAD83(CSRS)).  │
  // │  Leave a system null if you don't have it. Until this is filled in,  │
  // │  the monument check reports SKIPPED and the self-test is incomplete. │
  // └──────────────────────────────────────────────────────────────────────┘
  const CONTROL_MONUMENT = {
    name: null,                 // e.g. 'NSHPN 12345'
    lat: null, lon: null,       // decimal degrees, lon negative (west)
    utm20n: { n: null, e: null },
    nsmtm5: { n: null, e: null },
    tolerance: 0.002,           // metres — published coords are usually to the mm
  };

  function geoSelfTest() {
    const rows = [];
    let pass = true;
    const check = (name, err, tol, unit) => {
      const ok = fin(err) && err <= tol;
      if (!ok) pass = false;
      rows.push({ test: name, error: fin(err) ? err.toExponential(2) + ' ' + unit : 'n/a', tolerance: tol + ' ' + unit, result: ok ? 'PASS' : 'FAIL' });
    };

    if (typeof proj4 === 'undefined') {
      console.error('fbGeo self-test: proj4 is not loaded');
      return { pass: false, rows };
    }

    // 1. Round trips: lat/lon -> grid -> lat/lon, both systems, across NS.
    const samples = [
      ['Halifax',  44.6488, -63.5752],
      ['Lawrencetown (COGS)', 44.8840, -65.1680],
      ['Yarmouth', 43.8375, -66.1174],
      ['Sydney',   46.1368, -60.1942],
    ];
    CRS_REGISTRY.filter(c => c.proj4).forEach(c => {
      samples.forEach(([name, lat, lon]) => {
        const g = toGrid(lat, lon, c.id);
        const ll = g && toLatLon(g.n, g.e, c.id);
        // degrees -> metres (approx) so the tolerance reads in mm
        const err = ll ? Math.hypot((ll.lat - lat) * 111320, (ll.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180)) : NaN;
        check(`round-trip ${c.short} @ ${name}`, err, 0.001, 'm');
      });
    });

    // 2. Defining parameters: on the central meridian the easting equals the
    //    false easting exactly.
    check('UTM 20N false easting on CM 63°W',    Math.abs(toGrid(45, -63.0, 'utm20n').e - 500000),   0.001, 'm');
    check('NS MTM 5 false easting on CM 64°30′W', Math.abs(toGrid(45, -64.5, 'nsmtm5').e - 25500000), 0.001, 'm');

    // 3. Control monument (published values).
    const m = CONTROL_MONUMENT;
    if (!fin(m.lat) || !fin(m.lon)) {
      rows.push({ test: 'control monument', error: '—', tolerance: m.tolerance + ' m', result: 'SKIPPED — monument not supplied' });
    } else {
      ['utm20n', 'nsmtm5'].forEach(id => {
        const pub = m[id];
        if (!pub || !fin(pub.n) || !fin(pub.e)) return;
        const g = toGrid(m.lat, m.lon, id);
        check(`${m.name || 'monument'} lat/lon -> ${getCrs(id).short}`, Math.hypot(g.n - pub.n, g.e - pub.e), m.tolerance, 'm');
      });
      if (fin(m.utm20n.n) && fin(m.nsmtm5.n)) {
        const ll = toLatLon(m.utm20n.n, m.utm20n.e, 'utm20n');
        const g = toGrid(ll.lat, ll.lon, 'nsmtm5');
        check(`${m.name || 'monument'} UTM 20N -> NS MTM 5`, Math.hypot(g.n - m.nsmtm5.n, g.e - m.nsmtm5.e), m.tolerance, 'm');
      }
    }

    // 4. Geoid grid loaded and plausible (NS undulations are about −9 to −24 m).
    const N = geoidN(44.6488, -63.5752);
    rows.push({ test: 'geoid CGG2013a @ Halifax', error: N === null ? 'n/a' : N.toFixed(3) + ' m', tolerance: '−24 … −9 m',
                result: (N !== null && N < -9 && N > -24) ? 'PASS' : 'FAIL' });
    if (!(N !== null && N < -9 && N > -24)) pass = false;

    console.table(rows);
    console.log(pass ? 'fbGeo self-test: PASS' : 'fbGeo self-test: FAIL');
    return { pass, rows };
  }

  window.fbGeo = {
    CRS_REGISTRY, DEFAULT_CRS, SOURCES, CONTROL_MONUMENT,
    getCrs, projectCrsId, projectCrs, isGrid,
    toLatLon, toGrid, geoidN, orthoHeight,
    fmtGrid, fmtElev, fmtAcc, fmtLatLon, geoUri,
    makeGeo, gpsCells,
    getProjectPoints, usedPointNumbers, gpsPtStart, nextGpsPtNum,
    crsChangeSummary, applyCrsChange, datumMatchesCrs,
    parseRange, inRanges,
    geoSelfTest,
  };
})();
