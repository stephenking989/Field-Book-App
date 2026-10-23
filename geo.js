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
  //   bounds    [latS, latN, lonW, lonE] — generous area of use. Grid values
  //             that convert to somewhere outside it (assumed coordinates
  //             typed into a real-grid project, say) get no lat/lon rather
  //             than a nonsense position in a map app.
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
      bounds: [40, 84, -67, -59],
      datumText: 'NAD83(CSRS), UTM Zone 20N / CGVD2013',
    },
    {
      id: 'nsmtm5',
      label: 'NAD83(CSRS) / MTM Nova Scotia zone 5',
      short: 'NS MTM 5',
      epsg: 8083,
      proj4: '+proj=tmerc +lat_0=0 +lon_0=-64.5 +k=0.9999 +x_0=25500000 +y_0=0 +ellps=GRS80 +units=m +no_defs',
      fileTag: 'NAD83CSRS-NSMTM5',
      bounds: [43, 47.5, -67.5, -62],
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
    if (!fin(out[0]) || !fin(out[1])) return null;
    const b = getCrs(crsId).bounds;
    if (b && (out[1] < b[0] || out[1] > b[1] || out[0] < b[2] || out[0] > b[3])) return null;
    return { lat: out[1], lon: out[0] };
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
  // A phone position written in the PROJECT's coordinates ("N … E …"). Falls
  // back to lat/lon only when the project is Local and has no grid.
  function fmtPosition(lat, lon, crsId) {
    const g = toGrid(lat, lon, crsId);
    return g ? `N ${fmtGrid(g.n)}  E ${fmtGrid(g.e)}` : fmtLatLon(lat, lon);
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

  // Phone points get Z = H (orthometric, CGVD2013 via the geoid) unless the
  // project has switched "Fill Z from phone height" off.
  function useZ(project) { return !project || project.gpsUseZ !== false; }

  // PNEZD cell values for a GPS-sourced point in the project's CRS.
  function gpsCells(geo, project) {
    const g = toGrid(geo.lat, geo.lon, projectCrsId(project));
    return {
      col_north: g ? fmtGrid(g.n) : '',
      col_east:  g ? fmtGrid(g.e) : '',
      col_elev:  (useZ(project) && fin(geo.H)) ? fmtElev(geo.H) : '',
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
  //   'photo'       Points-page row created for a geotagged photo
  //   'voice'       Points-page row created for a geotagged voice note
  //   'map-pin'     Points-page row placed by hand on the Map page (no height)
  // Every phone-sourced position is a real Points-page row, so it is numbered,
  // listed, exportable and placeable on a sketch like any other point.
  //
  // Entry: { id, number, N, E, Z, desc, lat, lon, source, phone, acc, ts,
  //          pageId, pageType, pageTitle }
  //   N/E/Z are numbers or null. lat/lon are null when the project is Local
  //   (instrument points) — phone-sourced entries always keep their lat/lon.
  // `tag` is the short marker the UI draws as a badge (see SourceTag in index.html).
  const SOURCES = {
    'instrument': { label: 'Entered',     tag: 'INST' },
    'gps':        { label: 'GPS point',   tag: 'GPS' },
    'notes-pin':  { label: 'Notes pin',   tag: 'NOTE' },
    'photo':      { label: 'Photo',       tag: 'PHOTO' },
    'voice':      { label: 'Voice note',  tag: 'VOICE' },
    'map-pin':    { label: 'Map pin',     tag: 'PIN' },
  };

  function num(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s || s.startsWith('=')) return null;
    const n = Number(s.replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  // One Points-page row as an index entry (without page fields), or null for
  // a blank / unplaced row. Every row with usable N/E gets lat/lon through the
  // CRS in exactly the same way whether it was typed, imported, placed on a
  // sketch or captured by phone; a phone row falls back to its stored lat/lon
  // only when it has no N/E (Local project).
  function rowPoint(r, crsId) {
    const c = r.cells || {};
    const N = num(c.col_north), E = num(c.col_east), Z = num(c.col_elev);
    const geo = (r.geo && fin(r.geo.lat) && fin(r.geo.lon)) ? r.geo : null;
    if (!geo && N === null && E === null) return null;
    let ll = (N !== null && E !== null) ? toLatLon(N, E, crsId) : null;
    if (!ll && geo) ll = { lat: geo.lat, lon: geo.lon };
    const txt = (v, n) => n === null ? '' : String(v).trim();
    return {
      id: r.id, number: String(c.col_ptnum ?? '').trim(), N, E, Z,
      // coordinates exactly as they appear in the Points page (decimals kept)
      text: { n: txt(c.col_north, N), e: txt(c.col_east, E), z: txt(c.col_elev, Z) },
      desc: String(c.col_desc ?? ''),
      lat: ll ? ll.lat : null, lon: ll ? ll.lon : null,
      source: geo ? (geo.source || 'gps') : 'instrument',
      phone: !!geo, acc: geo ? (geo.acc ?? null) : null, ts: geo ? (geo.ts || null) : null,
      refPageId: geo ? (geo.notePageId || geo.mediaPageId || null) : null,
      mediaId: geo ? (geo.mediaId || null) : null,
      from: geo ? (geo.from || 'device') : null,
    };
  }

  // Text of a Notes-page GPS pin chip, in the project's coordinates.
  function pinText(row, project) {
    const c = row.cells || {}, g = row.geo || {};
    const n = String(c.col_north ?? '').trim(), e = String(c.col_east ?? '').trim();
    const pos = (n && e) ? `N ${n}  E ${e}` : fmtLatLon(g.lat, g.lon);
    const desc = String(c.col_desc ?? '').trim();
    return `Pt ${String(c.col_ptnum ?? '').trim()}${desc ? ' ' + desc : ''} · ${pos} · ${fmtAcc(g.acc)}`;
  }

  // Rewrite every GPS pin chip in a note's HTML from its point row, so the
  // chip follows a CRS change or an edited number/description. Chips whose
  // point was deleted are left as written. Returns the (possibly same) HTML.
  function refreshPins(html, project) {
    if (!html || html.indexOf('fb-geo-pin') === -1) return html;
    // Row ids are regenerated when a project is imported or duplicated, so a
    // chip falls back to finding its point by number.
    const byId = {}, byNum = {};
    (project.pages || []).forEach(pg => {
      if (pg.type !== 'points') return;
      (pg.rows || []).forEach(r => {
        byId[r.id] = r;
        const n = String(r.cells?.col_ptnum ?? '').trim();
        if (n && r.geo && !byNum[n]) byNum[n] = r;
      });
    });
    const box = document.createElement('div');
    box.innerHTML = html;
    box.querySelectorAll('.fb-geo-pin').forEach(el => {
      const row = byId[el.dataset.ptId] || byNum[el.dataset.ptNum];
      if (!row) return;
      el.dataset.ptId = row.id;
      el.dataset.ptNum = String(row.cells?.col_ptnum ?? '').trim();
      el.textContent = pinText(row, project);
    });
    return box.innerHTML;
  }

  // Points-page rows of a project as index entries, in page order.
  function rowPoints(project) {
    const out = [];
    const crsId = projectCrsId(project);
    (project.pages || []).forEach(pg => {
      if (pg.type !== 'points') return;
      (pg.rows || []).forEach(r => {
        const pt = rowPoint(r, crsId);
        if (pt) out.push({ ...pt, pageId: pg.id, pageType: pg.type, pageTitle: pg.title || '' });
      });
    });
    return out;
  }

  // The Points-page point a media record (photo / voice note) belongs to:
  //   1. a link the user made to some OTHER point — rec.ptId, with rec.ptNum
  //      as a fallback because row ids are regenerated on project import; or
  //   2. the record's OWN point — the row created for it when it was
  //      geotagged, found through row.geo.mediaId === rec.id.
  // `rows` is rowPoints(project).
  function mediaRow(rec, rows) {
    if (!rec) return null;
    if (rec.ptId || rec.ptNum) {
      const num = String(rec.ptNum ?? '').trim();
      const hit = rows.find(r => r.id === rec.ptId) || (num ? rows.find(r => r.number === num) : null);
      if (hit) return hit;
    }
    return rows.find(r => r.mediaId === rec.id) || null;
  }

  // A media record as a point, or null when it has no position at all.
  //   rowId — the Points-page row it resolves to (null = not on the Points
  //           page yet; it is then described from its own phone position)
  //   own   — true when that row is the record's own point
  function mediaPoint(rec, project, source, rows) {
    if (!rec) return null;
    const link = mediaRow(rec, rows || rowPoints(project));
    const geo = (rec.geo && fin(rec.geo.lat) && fin(rec.geo.lon)) ? rec.geo : null;
    if (link) return { ...link, rowId: link.id, own: link.mediaId === rec.id };
    if (!geo) return null;
    const g = toGrid(geo.lat, geo.lon, projectCrsId(project));
    const Z = (useZ(project) && fin(geo.H)) ? geo.H : null;
    return {
      id: rec.id, number: '',
      N: g ? g.n : null, E: g ? g.e : null, Z,
      text: { n: g ? fmtGrid(g.n) : '', e: g ? fmtGrid(g.e) : '', z: Z !== null ? fmtElev(Z) : '' },
      desc: rec.title || rec.note || rec.desc || '',
      lat: geo.lat, lon: geo.lon,
      source, phone: true, acc: geo.acc ?? null, ts: geo.ts || rec.createdAt || null,
      from: geo.from || 'device', rowId: null, own: false, mediaId: null,
    };
  }

  // Every point in the project. Points-page rows come first; each carries
  // hasPhoto / hasVoice when a photo or voice note belongs to it. A geotagged
  // media record that has no row yet (page not opened since it was copied in)
  // is appended as its own entry so nothing with a position is ever missed.
  function getProjectPoints(project) {
    if (!project) return [];
    const rows = rowPoints(project);
    const out = rows.slice();
    const byId = {};
    out.forEach(r => { byId[r.id] = r; });
    (project.pages || []).forEach(pg => {
      if (pg.type !== 'photo') return;
      const take = (rec, source, flag, fallback) => {
        const pt = mediaPoint(rec, project, source, rows);
        if (!pt) return;
        if (pt.rowId) { byId[pt.rowId][flag] = true; return; }
        if (rec.noPoint) return;   // its point was deleted on the Points page
        out.push({ ...pt, desc: pt.desc || fallback, pageId: pg.id, pageType: pg.type, pageTitle: pg.title || '' });
      };
      // Voice memos attached to a photo belong to that photo — not points.
      (pg.photos || []).forEach(ph => take(ph, 'photo', 'hasPhoto', 'Photo'));
      (pg.voiceNotes || []).forEach(v => take(v, 'voice', 'hasVoice', 'Voice note'));
    });
    return out;
  }

  // How many Points-page rows carry each number.
  function pointNumberCounts(project) {
    const counts = {};
    (project && project.pages || []).forEach(pg => {
      if (pg.type !== 'points') return;
      (pg.rows || []).forEach(r => {
        const n = String(r.cells?.col_ptnum ?? '').trim();
        if (n) counts[n] = (counts[n] || 0) + 1;
      });
    });
    return counts;
  }
  // Every point number in use in the project (as trimmed strings).
  function usedPointNumbers(project) {
    return new Set(Object.keys(pointNumberCounts(project)));
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

  // ─── Export writers (PNEZD CSV, KML, GPX) ──────────────────────────────────
  // All three take index entries from getProjectPoints().
  const xmlEsc = v => String(v ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const csvCell = v => { const t = String(v ?? ''); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const pad2 = n => String(n).padStart(2, '0');
  function fmtWhen(ts) {
    const d = ts ? new Date(ts) : null;
    if (!d || isNaN(d)) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function pointName(p) {
    return [p.number, p.desc].filter(Boolean).join(' ') || (SOURCES[p.source] ? SOURCES[p.source].label : 'Point');
  }
  // How good a point's position is, in words.
  function qualityText(p) {
    if (!p.phone) return 'entered coordinates';
    if (p.source === 'map-pin') return 'placed on map (approx.)';
    return p.from === 'exif' ? (fin(p.acc) ? `±${Math.round(p.acc)} m photo EXIF GPS` : 'photo EXIF GPS') : fmtAcc(p.acc);
  }
  function gridText(p) {
    if (p.N === null || p.E === null) return '';
    return `N ${p.text.n}  E ${p.text.e}${p.text.z ? '  Z ' + p.text.z : ''}`;
  }
  // Lines describing a point for a map app's info balloon. `note` is the
  // Points-page row's note (Map page), when it has one.
  function describe(p, crs, note) {
    const out = [];
    const grid = gridText(p);
    if (grid) out.push(grid);
    out.push(crs.epsg ? `${crs.label} (EPSG:${crs.epsg})` : crs.label);
    out.push(`Source: ${SOURCES[p.source] ? SOURCES[p.source].label : p.source} · ${qualityText(p)}`);
    const when = fmtWhen(p.ts);
    if (when) out.push(when);
    if (note && String(note).trim()) out.push(`Note: ${String(note).trim()}`);
    return out;
  }

  // PNEZD, comma-delimited, in the project's CRS. Coordinates are written
  // exactly as they appear in the app. Points with no N/E are left out.
  // Returns { text, count, skipped }.
  function toPNEZD(points, opts) {
    const rows = points.filter(p => p.N !== null && p.E !== null);
    const lines = rows.map(p => [csvCell(p.number), p.text.n, p.text.e, p.text.z, csvCell(p.desc)].join(','));
    if (opts && opts.header) lines.unshift('Point,Northing,Easting,Elevation,Description');
    return { text: lines.join('\r\n') + (lines.length ? '\r\n' : ''), count: rows.length, skipped: points.length - rows.length };
  }

  // KML (lat/lon), one folder per source category. Returns { text, count, skipped }.
  // opts.linework (optional, Map page): figures / code lines → a "Linework" folder.
  function toKML(points, project, opts) {
    const crs = projectCrs(project);
    const extras = rowExtras(project);
    const pts = points.filter(p => p.lat !== null && p.lon !== null);
    const folders = Object.keys(SOURCES).map(src => {
      const mine = pts.filter(p => p.source === src);
      if (!mine.length) return '';
      const marks = mine.map(p => {
        const body = describe(p, crs, extras[p.id] && extras[p.id].note).map(xmlEsc).join('<br/>').replace(/]]>/g, ']]&gt;');
        const when = p.ts && !isNaN(new Date(p.ts)) ? `<TimeStamp><when>${new Date(p.ts).toISOString()}</when></TimeStamp>` : '';
        const alt = p.Z !== null ? ',' + p.Z.toFixed(1) : '';
        return `      <Placemark><name>${xmlEsc(pointName(p))}</name><description><![CDATA[${body}]]></description>${when}` +
               `<Point><coordinates>${p.lon.toFixed(8)},${p.lat.toFixed(8)}${alt}</coordinates></Point></Placemark>`;
      }).join('\n');
      return `    <Folder><name>${xmlEsc(SOURCES[src].label)}</name>\n${marks}\n    </Folder>`;
    }).filter(Boolean).join('\n');
    const lines = lineworkCoords(opts && opts.linework);
    const ll = c => `${c.lon.toFixed(8)},${c.lat.toFixed(8)}`;
    const lineFolder = !lines.length ? '' : '\n    <Folder><name>Linework</name>\n' + lines.map(l => {
      const ring = l.closed && l.coords.length >= 3;
      const body = ring
        ? `<Polygon><outerBoundaryIs><LinearRing><coordinates>${l.coords.concat([l.coords[0]]).map(ll).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
        : `<LineString><tessellate>1</tessellate><coordinates>${l.coords.map(ll).join(' ')}</coordinates></LineString>`;
      const what = `${figureLayer(l.layer).label}${ring ? ' · closed' : ''}${l.source === 'code' ? ' · from codes' : ''}`;
      return `      <Placemark><name>${xmlEsc(l.name)}</name><description>${xmlEsc(what)}</description>${body}</Placemark>`;
    }).join('\n') + '\n    </Folder>';
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEsc((project.name || 'FieldBook') + ' — points')}</name>
    <description>${xmlEsc(`Exported from FieldBook. Grid: ${crs.label}. Positions are NAD83(CSRS) lat/lon, used as WGS84.`)}</description>
${folders}${lineFolder}
  </Document>
</kml>
`;
    return { text, count: pts.length, skipped: points.length - pts.length };
  }

  // GPX 1.1 waypoints — OsmAnd's native format. <type> carries the source
  // category, which OsmAnd uses to group the waypoints. opts.linework
  // (optional) adds one track per line; a closed figure repeats its first point.
  function toGPX(points, project, opts) {
    const crs = projectCrs(project);
    const extras = rowExtras(project);
    const pts = points.filter(p => p.lat !== null && p.lon !== null);
    const wpts = pts.map(p => {
      const ele  = p.Z !== null ? `<ele>${p.Z.toFixed(1)}</ele>` : '';
      const time = p.ts && !isNaN(new Date(p.ts)) ? `<time>${new Date(p.ts).toISOString()}</time>` : '';
      return `  <wpt lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}">${ele}${time}` +
             `<name>${xmlEsc(pointName(p))}</name><desc>${xmlEsc(describe(p, crs, extras[p.id] && extras[p.id].note).join(' | '))}</desc>` +
             `<type>${xmlEsc(SOURCES[p.source] ? SOURCES[p.source].label : p.source)}</type></wpt>`;
    }).join('\n');
    const trks = lineworkCoords(opts && opts.linework).map(l => {
      const cs = l.closed && l.coords.length >= 3 ? l.coords.concat([l.coords[0]]) : l.coords;
      return `  <trk><name>${xmlEsc(l.name)}</name><type>${xmlEsc(figureLayer(l.layer).label)}</type><trkseg>` +
        cs.map(c => `<trkpt lat="${c.lat.toFixed(8)}" lon="${c.lon.toFixed(8)}">${fin(c.Z) ? `<ele>${c.Z.toFixed(1)}</ele>` : ''}</trkpt>`).join('') +
        `</trkseg></trk>`;
    }).join('\n');
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FieldBook" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${xmlEsc((project.name || 'FieldBook') + ' — points')}</name>
    <desc>${xmlEsc(`Grid: ${crs.label}. Positions are NAD83(CSRS) lat/lon, used as WGS84.`)}</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
${wpts}${trks ? '\n' + trks : ''}
</gpx>
`;
    return { text, count: pts.length, skipped: points.length - pts.length };
  }

  // ─── Map page ──────────────────────────────────────────────────────────────
  // What the Map page computes that isn't drawing: features, symbols, grid
  // inverse and its formatting, areas. Pure, so test-map.js runs it in Node.
  // The map only READS — nothing here writes a coordinate.

  // GNSS Obs stations that have an approximate position (page.gnss.pos —
  // lat/lon are numbers, h is text as typed). They aren't Points rows.
  function gnssStations(project) {
    const out = [];
    (project && project.pages || []).forEach(pg => {
      if (pg.type !== 'gnss' || !pg.gnss) return;
      const pos = pg.gnss.pos || {};
      if (!fin(pos.lat) || !fin(pos.lon)) return;
      out.push({
        id: 'gnss_' + pg.id, pageId: pg.id, pageTitle: pg.title || '',
        name: String(pg.gnss.station || '').trim() || pg.title || 'GNSS station',
        lat: pos.lat, lon: pos.lon, h: num(pos.h), source: 'gnss-station',
      });
    });
    return out;
  }

  // Everything the map draws as a point. `points` is getProjectPoints exactly.
  function getMapFeatures(project) {
    return { points: getProjectPoints(project), stations: gnssStations(project) };
  }

  // Optional Points-row fields the map uses, by row id: the row's note, and
  // mapPin — a pin dropped on a Local project, which has no geo.
  function rowExtras(project) {
    const out = {};
    (project && project.pages || []).forEach(pg => {
      if (pg.type !== 'points') return;
      (pg.rows || []).forEach(r => {
        if (r && (r.note || r.mapPin)) out[r.id] = { note: typeof r.note === 'string' ? r.note : '', mapPin: r.mapPin || null };
      });
    });
    return out;
  }

  // Setup / control / boundary symbols are picked by the field code — the
  // first word of the description — from per-project lists.
  const DEFAULT_SYMBOL_CODES = {
    setup:    ['STN', 'SETUP', 'SU', 'OCC', 'TS'],
    control:  ['CP', 'CTRL', 'CNTL', 'BM', 'MON', 'NSCM', 'CM'],
    boundary: ['IP', 'IB', 'IBFD', 'IR', 'PIN', 'RB', 'IRON', 'CORNER', 'COR', 'SIB', 'SM', 'SMFD'],
  };
  const SYMBOL_CODE_KINDS = ['setup', 'control', 'boundary'];
  function parseCodeList(text) {
    const seen = new Set();
    return String(text || '').split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(s => s && !seen.has(s) && seen.add(s));
  }
  function symbolCodes(project) {
    const c = (project && project.mapSymbolCodes) || {};
    const out = {};
    SYMBOL_CODE_KINDS.forEach(k => {
      out[k] = Array.isArray(c[k]) ? c[k].map(s => String(s).trim().toUpperCase()).filter(Boolean) : DEFAULT_SYMBOL_CODES[k].slice();
    });
    return out;
  }
  function pointCode(desc) {
    const w = String(desc || '').trim().split(/\s+/)[0];
    return w ? w.toUpperCase() : '';
  }
  // Which symbol a point gets: code symbol > source symbol > ordinary.
  // Returns setup | control | boundary | map-pin | notes-pin | photo | voice | gps | topo.
  const SOURCE_SYMBOL = { 'map-pin': 'map-pin', 'notes-pin': 'notes-pin', 'photo': 'photo', 'voice': 'voice', 'gps': 'gps' };
  function pointSymbol(p, codes, extra) {
    const code = pointCode(p.desc);
    if (code) for (const k of SYMBOL_CODE_KINDS) if (codes[k] && codes[k].indexOf(code) !== -1) return k;
    if (extra && extra.mapPin) return 'map-pin';
    return SOURCE_SYMBOL[p.source] || 'topo';
  }

  // The photo records that belong to a Points row (its own, or linked to it).
  function mediaForPoint(project, rowId, kind) {
    const rows = rowPoints(project), out = [];
    (project && project.pages || []).forEach(pg => {
      if (pg.type !== 'photo') return;
      ((kind === 'voice' ? pg.voiceNotes : pg.photos) || []).forEach(rec => {
        const r = mediaRow(rec, rows);
        if (r && r.id === rowId) out.push({ rec, pageId: pg.id });
      });
    });
    return out;
  }

  // Stored grid N/E in one CRS shown in another — DISPLAY ONLY, never stored.
  function convertGrid(n, e, fromId, toId) {
    if (fromId === toId) return fin(n) && fin(e) ? { n, e } : null;
    const ll = toLatLon(n, e, fromId);
    return ll ? toGrid(ll.lat, ll.lon, toId) : null;
  }

  // Grid inverse between two { N, E, Z } in the same grid. Azimuth is from
  // grid north, clockwise, 0 ≤ az < 360. dZ only when both heights exist.
  function gridInverse(a, b) {
    const dN = b.N - a.N, dE = b.E - a.E;
    let az = Math.atan2(dE, dN) * 180 / Math.PI;
    if (az < 0) az += 360;
    if (az >= 360) az -= 360;
    const dZ = (fin(a.Z) && fin(b.Z)) ? b.Z - a.Z : null;
    return { dist: Math.hypot(dN, dE), az, dN, dE, dZ };
  }

  // Angles are rounded to whole seconds (or minutes) FIRST, as an integer
  // count, so the carry (60″ → 1′, 60′ → 1°) and the quadrant come out of the
  // same rounded value — 89.99999° is N 90°00′00″ E, never N 89°59′60″ E.
  function angleUnits(deg, seconds) {
    const unit = seconds ? 3600 : 60;
    const full = 360 * unit;
    let t = Math.round((((deg % 360) + 360) % 360) * unit);
    if (t >= full) t -= full;
    return { t, unit };
  }
  function unitsText(t, unit) {
    const d = Math.floor(t / unit);
    const rest = t - d * unit;
    if (unit === 60) return `${d}°${pad2(rest)}′`;
    const m = Math.floor(rest / 60);
    return `${d}°${pad2(m)}′${pad2(rest - m * 60)}″`;
  }
  // Azimuth  ddd°mm′ss″ (360 → 0°00′00″). { seconds: false } → ddd°mm′.
  function fmtAzimuth(az, opts) {
    const { t, unit } = angleUnits(az, !(opts && opts.seconds === false));
    return unitsText(t, unit);
  }
  // Quadrant bearing  N dd°mm′ss″ E. Cardinals: 0 → N 0° E, 90 → N 90° E,
  // 180 → S 0° E, 270 → N 90° W.
  function fmtQuadrant(az, opts) {
    const { t, unit } = angleUnits(az, !(opts && opts.seconds === false));
    const Q = 90 * unit;
    if (t <= Q)     return `N ${unitsText(t, unit)} E`;
    if (t <= 2 * Q) return `S ${unitsText(2 * Q - t, unit)} E`;
    if (t < 3 * Q)  return `S ${unitsText(t - 2 * Q, unit)} W`;
    return `N ${unitsText(4 * Q - t, unit)} W`;
  }

  // A number with thin-space thousands grouping: 4 985 312.4
  function fmtThin(v, dec) {
    if (!fin(v)) return '';
    const s = Math.abs(v).toFixed(dec || 0).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (v < 0 && Number(s.join('.')) !== 0 ? '−' : '') + s.join('.');
  }

  // Grid area (shoelace) and length of a run of { N, E } vertices.
  function shoelaceArea(verts) {
    let s = 0;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      s += a.E * b.N - b.E * a.N;
    }
    return Math.abs(s) / 2;
  }
  function pathLength(verts, closed) {
    let L = 0;
    for (let i = 1; i < verts.length; i++) L += Math.hypot(verts[i].N - verts[i - 1].N, verts[i].E - verts[i - 1].E);
    if (closed && verts.length > 2) L += Math.hypot(verts[0].N - verts[verts.length - 1].N, verts[0].E - verts[verts.length - 1].E);
    return L;
  }
  function fmtArea(m2) {
    return { m2: fmtThin(m2, 1) + ' m²', ha: (m2 / 10000).toFixed(4) + ' ha' };
  }

  // ─── Linework (Map page) ───────────────────────────────────────────────────
  // project.figures = [{ id, name, kind: 'line' | 'polygon', layer, pts: [{ id, num }], createdAt }]
  // A vertex is a Points row, kept as row id + point number: row ids are
  // regenerated when a project is imported or duplicated, so a vertex is found
  // by id first and by number after (the same fallback as refreshPins).
  const FIGURE_LAYERS = [
    { id: 'lot',      label: 'Lot' },
    { id: 'building', label: 'Building' },
    { id: 'fence',    label: 'Fence' },
    { id: 'water',    label: 'Water' },
    { id: 'road',     label: 'Road' },
    { id: 'other',    label: 'Other' },
  ];
  const figureLayer = id => FIGURE_LAYERS.find(l => l.id === id) || FIGURE_LAYERS[FIGURE_LAYERS.length - 1];

  function getFigures(project) {
    return Array.isArray(project && project.figures)
      ? project.figures.filter(f => f && f.id && Array.isArray(f.pts)) : [];
  }
  // Points rows with N/E, by id and by number (first row wins a number).
  function vertexLookup(project) {
    const byId = {}, byNum = {};
    rowPoints(project).forEach(p => {
      byId[p.id] = p;
      if (p.number && !byNum[p.number]) byNum[p.number] = p;
    });
    return { byId, byNum };
  }
  // A figure's live vertices. Vertices whose point is gone (or has no N/E)
  // are listed in `missing` — the figure keeps the rest, never dropped.
  function resolveFigure(fig, lookup) {
    const verts = [], missing = [];
    (fig.pts || []).forEach(v => {
      const num = String(v.num ?? '').trim();
      const p = lookup.byId[v.id] || (num ? lookup.byNum[num] : null);
      if (p && p.N !== null && p.E !== null) verts.push(p);
      else missing.push(num || '?');
    });
    const closed = fig.kind === 'polygon';
    return {
      verts, missing, closed,
      length: pathLength(verts, closed),
      area: closed && verts.length >= 3 ? shoelaceArea(verts) : null,
    };
  }
  // "Lot 1", "Lot 2"… — the next free number for that layer.
  function nextFigureName(project, layer) {
    const label = figureLayer(layer).label;
    const used = new Set(getFigures(project).map(f => String(f.name || '').trim().toLowerCase()));
    let n = 1;
    while (used.has(`${label} ${n}`.toLowerCase())) n++;
    return `${label} ${n}`;
  }
  // Where a polygon's name and area go: its area centroid (falls back to the
  // vertex mean for a degenerate ring). In { N, E }.
  function figureLabelPoint(verts) {
    let a = 0, cn = 0, ce = 0;
    for (let i = 0; i < verts.length; i++) {
      const p = verts[i], q = verts[(i + 1) % verts.length];
      const k = p.E * q.N - q.E * p.N;
      a += k; ce += (p.E + q.E) * k; cn += (p.N + q.N) * k;
    }
    if (Math.abs(a) < 1e-9) {
      return { N: verts.reduce((s, v) => s + v.N, 0) / verts.length, E: verts.reduce((s, v) => s + v.E, 0) / verts.length };
    }
    return { N: cn / (3 * a), E: ce / (3 * a) };
  }
  // Row ids changed (project duplicate / import): point the vertices at the new ids.
  function remapFigureRows(figures, idMap) {
    if (!Array.isArray(figures)) return figures;
    return figures.map(f => (f && Array.isArray(f.pts))
      ? { ...f, pts: f.pts.map(v => (v && idMap[v.id]) ? { ...v, id: idMap[v.id] } : v) } : f);
  }
  // Every drawable line for export: figures (and, from the Map page, code
  // lines) as { name, layer, closed, source, coords: [{ lat, lon, Z }] }.
  // Vertices without a map position are skipped; fewer than two → left out.
  function figureLinework(project) {
    const lookup = vertexLookup(project);
    return getFigures(project).map(f => {
      const r = resolveFigure(f, lookup);
      return { name: f.name || figureLayer(f.layer).label, layer: f.layer, closed: r.closed, source: 'figure', verts: r.verts };
    });
  }
  function lineworkCoords(lines) {
    return (lines || []).map(l => ({
      ...l,
      coords: (l.verts || []).filter(v => fin(v.lat) && fin(v.lon)).map(v => ({ lat: v.lat, lon: v.lon, Z: v.Z })),
    })).filter(l => l.coords.length >= 2);
  }

  // Grid-line spacing for the map's grid ticks: the smallest of 10/50/100/
  // 500/1000 m that leaves at least `minPx` screen pixels between lines, or
  // null when even 1000 m lines would be too dense.
  const GRID_STEPS = [10, 50, 100, 500, 1000];
  function gridStep(metresPerPixel, minPx) {
    const px = minPx || 70;
    for (const s of GRID_STEPS) if (s / metresPerPixel >= px) return s;
    return null;
  }

  // ─── Self-test ─────────────────────────────────────────────────────────────
  // Run from the browser console:   fbGeo.geoSelfTest()
  //
  // CONTROL MONUMENTS — NSCC COGS (Lawrencetown, NS) campus control, from the
  // published sheets "COGS Monuments_CSRS2010 — Survey March 2018 v2" (one in
  // NAD83(CSRS) 2010 MTM zone 5, one in UTM zone 20). Each station is published
  // in BOTH grids, so the test is: take the UTM value, convert to MTM, and
  // compare with the published MTM value (and back). h = ellipsoidal height,
  // H = CGVD2013 orthometric height, so h − H is the published geoid
  // undulation and checks the bundled CGG2013a grid.
  //   [ station, MTM5 N, MTM5 E, UTM20 N, UTM20 E, h, H(CGVD2013) ]
  const CONTROL_MONUMENTS = [
    ['27001', 4971794.083, 25447108.773, 4972374.050, 328663.543, 7.461, 28.104],
    ['27002', 4971655.358, 25447259.098, 4972232.567, 328811.283, 4.235, 24.879],
    ['27003', 4971840.496, 25447347.724, 4972416.040, 328903.317, 5.305, 25.945],
    ['27004', 4971997.482, 25447180.107, 4972576.101, 328738.626, 6.593, 27.233],
    ['27005', 4972126.296, 25447127.354, 4972705.871, 328688.261, 7.457, 28.095],
    ['27006', 4972344.836, 25447028.326, 4972926.210, 328593.286, 6.478, 27.114],
    ['27007', 4972135.955, 25446959.303, 4972718.635, 328520.413, 9.058, 29.698],
    ['27008', 4972398.564, 25446843.627, 4972983.344, 328409.607, 7.223, 27.861],
    ['27010', 4972901.340, 25446912.930, 4973484.767, 328488.193, 8.004, 28.632],
    ['27011', 4972782.560, 25447167.451, 4973361.299, 328740.481, 9.422, 30.049],
    ['27012', 4972588.465, 25447310.895, 4973164.581, 328880.317, 7.567, 28.196],
    ['BL1',   4972015.730, 25447342.440, 4972591.346, 328901.273, 7.219, 27.857],
    ['BL2',   4972418.970, 25447067.216, 4972999.614, 328633.541, 6.954, 27.589],
    ['BL3',   4972772.209, 25446826.516, 4973357.251, 328399.404, 7.947, 28.579],
  ];
  const MONUMENT_TOL = 0.002;        // m — sheets are published to the millimetre
  const MONUMENT_GEOID_TOL = 0.010;  // m — h and H are independent published values

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
        const b = c.bounds;   // Sydney is outside MTM zone 5's area of use
        if (b && (lat < b[0] || lat > b[1] || lon < b[2] || lon > b[3])) return;
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

    // 3. Control monuments (published values, both grids).
    CONTROL_MONUMENTS.forEach(([name, mN, mE, uN, uE, h, H]) => {
      const ll = toLatLon(uN, uE, 'utm20n');
      const m = ll && toGrid(ll.lat, ll.lon, 'nsmtm5');
      check(`${name} UTM 20N -> NS MTM 5`, m ? Math.hypot(m.n - mN, m.e - mE) : NaN, MONUMENT_TOL, 'm');
      const ll2 = toLatLon(mN, mE, 'nsmtm5');
      const u = ll2 && toGrid(ll2.lat, ll2.lon, 'utm20n');
      check(`${name} NS MTM 5 -> UTM 20N`, u ? Math.hypot(u.n - uN, u.e - uE) : NaN, MONUMENT_TOL, 'm');
      const N = ll ? geoidN(ll.lat, ll.lon) : null;
      check(`${name} geoid N vs published h - H`, N === null ? NaN : Math.abs(N - (h - H)), MONUMENT_GEOID_TOL, 'm');
    });

    // 4. Geoid grid loaded and plausible (NS undulations are about −9 to −24 m).
    const N = geoidN(44.6488, -63.5752);
    rows.push({ test: 'geoid CGG2013a @ Halifax', error: N === null ? 'n/a' : N.toFixed(3) + ' m', tolerance: '−24 … −9 m',
                result: (N !== null && N < -9 && N > -24) ? 'PASS' : 'FAIL' });
    if (!(N !== null && N < -9 && N > -24)) pass = false;

    console.table(rows);
    console.log(pass ? 'fbGeo self-test: PASS' : 'fbGeo self-test: FAIL');
    return { pass, rows };
  }

  // Map-page arithmetic checks — fixed answers worked by hand. Shared by
  // fbGeo.mapSelfTest() (browser console) and test-map.js (Node).
  function mapChecks() {
    const out = [];
    const eq = (test, got, want) => out.push({ test, got: String(got), want: String(want), result: String(got) === String(want) ? 'PASS' : 'FAIL' });
    const P = (N, E, Z) => ({ N, E, Z: Z === undefined ? null : Z });

    const ne = gridInverse(P(1000, 1000), P(1100, 1100));
    eq('inverse NE: distance', ne.dist.toFixed(3), '141.421');
    eq('inverse NE: azimuth', fmtAzimuth(ne.az), '45°00′00″');
    eq('inverse NE: quadrant', fmtQuadrant(ne.az), 'N 45°00′00″ E');
    const sw = gridInverse(P(1000, 1000), P(900, 900));
    eq('inverse SW: azimuth', fmtAzimuth(sw.az), '225°00′00″');
    eq('inverse SW: quadrant', fmtQuadrant(sw.az), 'S 45°00′00″ W');
    eq('due east', fmtQuadrant(gridInverse(P(0, 0), P(0, 10)).az), 'N 90°00′00″ E');
    eq('due west', fmtQuadrant(gridInverse(P(0, 0), P(0, -10)).az), 'N 90°00′00″ W');
    eq('due south', fmtQuadrant(gridInverse(P(0, 0), P(-10, 0)).az), 'S 0°00′00″ E');
    eq('due north', fmtQuadrant(gridInverse(P(0, 0), P(10, 0)).az), 'N 0°00′00″ E');
    eq('cardinal 0', fmtQuadrant(0), 'N 0°00′00″ E');
    eq('cardinal 90', fmtQuadrant(90), 'N 90°00′00″ E');
    eq('cardinal 180', fmtQuadrant(180), 'S 0°00′00″ E');
    eq('cardinal 270', fmtQuadrant(270), 'N 90°00′00″ W');
    eq('azimuth 360 → 0', fmtAzimuth(360), '0°00′00″');
    eq('seconds carry 29.99999°', fmtAzimuth(29.99999), '30°00′00″');
    eq('seconds carry into the quadrant', fmtQuadrant(89.99999), 'N 90°00′00″ E');
    eq('minute carry', fmtAzimuth(10 + 59 / 60 + 59.6 / 3600), '11°00′00″');
    eq('to the minute', fmtQuadrant(19.555, { seconds: false }), 'N 19°33′ E');
    eq('dZ only with both heights', JSON.stringify([gridInverse(P(0, 0, 10), P(3, 4, 12.5)).dZ, gridInverse(P(0, 0, 10), P(3, 4)).dZ]), '[2.5,null]');

    const sq = [P(0, 0), P(0, 100), P(100, 100), P(100, 0)];
    const a1 = fmtArea(shoelaceArea(sq)), a2 = fmtArea(shoelaceArea(sq.slice().reverse()));
    eq('square area m²', a1.m2, '10 000.0 m²');
    eq('square area ha', a1.ha, '1.0000 ha');
    eq('square area, other vertex order', a2.m2 + ' ' + a2.ha, a1.m2 + ' ' + a1.ha);
    eq('square perimeter', pathLength(sq, true), 400);

    eq('thin-space grouping', fmtThin(4985312.4, 1), '4 985 312.4');
    eq('grid step at 0.5 m/px', gridStep(0.5), 50);
    eq('symbol: code beats source', pointSymbol({ desc: 'ip fd', source: 'gps' }, DEFAULT_SYMBOL_CODES), 'boundary');
    eq('symbol: source', pointSymbol({ desc: 'shed corner', source: 'photo' }, DEFAULT_SYMBOL_CODES), 'photo');
    eq('symbol: ordinary', pointSymbol({ desc: 'GND', source: 'instrument' }, DEFAULT_SYMBOL_CODES), 'topo');
    eq('symbol: Local map pin', pointSymbol({ desc: 'gate', source: 'instrument' }, DEFAULT_SYMBOL_CODES, { mapPin: { ts: 'x' } }), 'map-pin');
    eq('map-pin quality', qualityText({ phone: true, source: 'map-pin', acc: null }), 'placed on map (approx.)');
    return out;
  }

  // Run from the browser console:   fbGeo.mapSelfTest()
  function mapSelfTest() {
    const rows = mapChecks();
    const pass = rows.every(r => r.result === 'PASS');
    console.table(rows);
    console.log(pass ? 'fbGeo map self-test: PASS' : 'fbGeo map self-test: FAIL');
    return { pass, rows };
  }

  window.fbGeo = {
    CRS_REGISTRY, DEFAULT_CRS, SOURCES, CONTROL_MONUMENTS,
    getCrs, projectCrsId, projectCrs, isGrid,
    toLatLon, toGrid, geoidN, orthoHeight,
    fmtGrid, fmtElev, fmtAcc, fmtLatLon, fmtPosition, geoUri,
    makeGeo, gpsCells, useZ,
    rowPoint, rowPoints, mediaRow, mediaPoint, pinText, refreshPins,
    getProjectPoints, pointNumberCounts, usedPointNumbers, gpsPtStart, nextGpsPtNum,
    crsChangeSummary, applyCrsChange, datumMatchesCrs,
    parseRange, inRanges,
    toPNEZD, toKML, toGPX, qualityText, fmtWhen,
    gnssStations, getMapFeatures, rowExtras,
    DEFAULT_SYMBOL_CODES, SYMBOL_CODE_KINDS, parseCodeList, symbolCodes, pointCode, pointSymbol,
    mediaForPoint, convertGrid, gridInverse, fmtAzimuth, fmtQuadrant, fmtThin,
    shoelaceArea, pathLength, fmtArea, GRID_STEPS, gridStep,
    FIGURE_LAYERS, figureLayer, getFigures, vertexLookup, resolveFigure, nextFigureName, figureLabelPoint,
    remapFigureRows, figureLinework, lineworkCoords,
    GPS_GRID_DECIMALS, GPS_ELEV_DECIMALS,
    geoSelfTest, mapSelfTest, mapChecks,
  };
})();
