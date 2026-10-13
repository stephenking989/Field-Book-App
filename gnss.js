// FieldBook GNSS static observation engine — window.fbGnss
//
// Everything the GNSS Obs page computes, kept free of React so the page, the
// PDF export and the Node tests (../test-gnss.js) all run the same code:
//   • antenna library  — saved antenna models, shared by every project
//   • slant-height reduction — the COGS static observation form's arithmetic
//   • Julian day and UT session times
//   • the antenna height drawing and the obstruction sky plot, as SVG strings
//
// Page data lives under page.gnss (see emptyGnss). Readings are stored as the
// text the surveyor typed; numbers are parsed here, at compute time.
(function (root) {
  'use strict';

  const fin = v => typeof v === 'number' && isFinite(v);
  const DP = 4;                       // the COGS form is 4-decimal throughout
  const f = v => v.toFixed(DP);
  const fm = v => f(v) + ' m';

  // ─── Numbers ───────────────────────────────────────────────────────────────
  // '' / null → null (nothing entered);  unparseable → NaN (entered, but bad).
  function num(v) {
    if (fin(v)) return v;
    const t = String(v ?? '').trim().replace(/−/g, '-').replace(',', '.');
    if (!t) return null;
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
  }
  function fmt4(v) { return fin(v) ? f(v) : ''; }
  // A difference that rounds to zero prints "0.0000", never "-0.0000".
  function fmtDiff(v) { return fin(v) ? f(v).replace(/^-(0\.0+)$/, '$1') : ''; }

  // ─── Dates and times (UT) ──────────────────────────────────────────────────
  const pad2 = n => String(n).padStart(2, '0');

  // Day of year for a YYYY-MM-DD date. The arithmetic is done on UTC midnights
  // so the device's time zone and daylight saving can't shift the count.
  function julianDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return Math.round((t - Date.UTC(y, 0, 0)) / 86400000);
  }
  function utcDateISO(date) {
    const d = date || new Date();
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  function utcTimeHMS(date) {
    const d = date || new Date();
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  }
  // "HH:MM:SS", "HH:MM" or "HHMMSS" → seconds since 00:00, or null.
  function parseHMS(str) {
    const t = String(str || '').trim();
    let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t) || /^(\d{2})(\d{2})(\d{2})?$/.exec(t);
    if (!m) return null;
    const h = +m[1], mi = +m[2], s = m[3] ? +m[3] : 0;
    if (h > 23 || mi > 59 || s > 59) return null;
    return h * 3600 + mi * 60 + s;
  }
  function fmtHMS(secs) {
    if (!fin(secs)) return '';
    const t = ((Math.round(secs) % 86400) + 86400) % 86400;
    return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor((t % 3600) / 60))}:${pad2(t % 60)}`;
  }
  // Stop before start means the session ran through 00:00 UT.
  function sessionDuration(start, stop) {
    const a = parseHMS(start), b = parseHMS(stop);
    if (a === null || b === null) return null;
    const secs = (b - a + 86400) % 86400;
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return { secs, text: `${h} h ${pad2(m)} m ${pad2(s)} s` };
  }

  // ─── Latitude / longitude ──────────────────────────────────────────────────
  // Stored as decimal degrees, shown as DMS.  Accepts "44 38 55.7 N",
  // "63°34'30.7\" W", "-63.5752" — one number is decimal degrees, two or three
  // are D M (S). S and W, or a leading minus, make it negative.
  function parseLatLon(str) {
    const t = String(str || '').trim().replace(/−/g, '-');
    if (!t) return null;
    const parts = t.match(/\d+(?:\.\d+)?/g);
    if (!parts || parts.length > 3) return null;
    if (/[^\d\s.\-+°'"′″:dmsDMSnNeEwW,]/.test(t)) return null;
    const [d, m = 0, s = 0] = parts.map(Number);
    if (parts.length > 1 && (m >= 60 || s >= 60)) return null;
    const neg = /^\s*-/.test(t) || /[sSwW]\s*$/.test(t);
    return (neg ? -1 : 1) * (d + m / 60 + s / 3600);
  }
  function fmtLatLonDMS(dd, kind, secDp = 1) {
    if (!fin(dd)) return '';
    const hemi = kind === 'lon' ? (dd < 0 ? 'W' : 'E') : (dd < 0 ? 'S' : 'N');
    const k = Math.pow(10, secDp);
    let total = Math.round(Math.abs(dd) * 3600 * k);          // in units of 1/k second
    const s = (total % (60 * k)) / k; total = Math.floor(total / (60 * k));
    const m = total % 60, d = Math.floor(total / 60);
    return `${d}°${pad2(m)}′${s.toFixed(secDp).padStart(secDp ? secDp + 3 : 2, '0')}″ ${hemi}`;
  }

  // ─── Antenna library ───────────────────────────────────────────────────────
  // Saved antenna models are shared by every project, so they live in
  // localStorage (`fb_antennas`) like the custom data-page templates.
  //   { id, name, R, d, l1, l2, slantMark, notes }
  //   R  — radius, antenna centre to the slant measure mark (m)
  //   d  — slant mark (SHMP) height above the ARP (m); negative if below it
  //   l1 — ARP to L1 phase centre correction (m);  l2 — ARP to L2
  // The built-in models are read-only: duplicate one to change its values.
  const STORE_KEY = 'fb_antennas';
  const BUILTIN_ANTENNAS = [
    { id: 'builtin-f90', name: 'F90', R: 0.0785, d: 0.0437, l1: 0.0689, l2: 0.0623,
      slantMark: 'White line', notes: 'Values from the COGS static observation form.', builtin: true },
  ];
  const DEFAULT_ANTENNA_ID = BUILTIN_ANTENNAS[0].id;

  function storage() { return root.localStorage || null; }
  function readSaved() {
    try {
      const raw = JSON.parse(storage().getItem(STORE_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(a => a && a.id && !isBuiltin(a.id)) : [];
    } catch { return []; }
  }
  function writeSaved(list) { storage().setItem(STORE_KEY, JSON.stringify(list)); }
  function isBuiltin(id) { return BUILTIN_ANTENNAS.some(a => a.id === id); }
  function newAntennaId() { return 'ant_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  function getAntennas() { return [...BUILTIN_ANTENNAS.map(a => ({ ...a })), ...readSaved()]; }
  function getAntenna(id) { return getAntennas().find(a => a.id === id) || null; }

  function cleanAntenna(rec) {
    const n = v => { const x = num(v); return fin(x) ? x : null; };
    return {
      id: rec.id || newAntennaId(),
      name: String(rec.name || '').trim() || 'Untitled antenna',
      R: n(rec.R), d: n(rec.d), l1: n(rec.l1), l2: n(rec.l2),
      slantMark: String(rec.slantMark || '').trim(),
      notes: String(rec.notes || '').trim(),
    };
  }
  function saveAntenna(rec) {
    if (rec.id && isBuiltin(rec.id)) throw new Error('Built-in antennas are read-only — duplicate it to change the values.');
    const clean = cleanAntenna(rec);
    const list = readSaved();
    const i = list.findIndex(a => a.id === clean.id);
    if (i === -1) list.push(clean); else list[i] = clean;
    writeSaved(list);
    return clean;
  }
  function deleteAntenna(id) {
    if (isBuiltin(id)) throw new Error('Built-in antennas cannot be deleted.');
    writeSaved(readSaved().filter(a => a.id !== id));
  }
  function duplicateAntenna(id) {
    const src = getAntenna(id);
    if (!src) return null;
    const { id: _id, builtin: _b, ...rest } = src;
    return saveAntenna({ ...rest, name: src.name + ' (copy)' });
  }

  // The constants a page records. A page keeps its own copy so editing the
  // library later never changes an old observation record.
  const SNAP_KEYS = ['name', 'R', 'd', 'l1', 'l2', 'slantMark'];
  function antennaSnapshot(ant) {
    if (!ant) return null;
    const out = {};
    SNAP_KEYS.forEach(k => { out[k] = ant[k] ?? (k === 'name' || k === 'slantMark' ? '' : null); });
    return out;
  }
  // True when the library entry has changed since the page copied it.
  function snapshotDiffers(snap, ant) {
    if (!snap || !ant) return false;
    return SNAP_KEYS.some(k => (snap[k] ?? null) !== (ant[k] ?? null));
  }

  // ─── Page data ─────────────────────────────────────────────────────────────
  const METHODS = ['Static', 'Rapid Static', 'Other'];
  const DEFAULT_TOL = 0.003;          // m — an app default, NOT a COGS standard
  const EMPTY_POS = { lat: null, lon: null, h: '', acc: null, source: '', ts: '' };
  const triple = a => [0, 1, 2].map(i => String((Array.isArray(a) ? a[i] : '') ?? ''));
  const readingSet = s => ({ before: triple(s && s.before), after: triple(s && s.after) });

  function emptyGnss(seed) {
    const ant = getAntenna(DEFAULT_ANTENNA_ID);
    return {
      v: 1,
      // Header — left column of the COGS form
      projectName: '', receiverModel: '', receiverSerial: '', receiverSoftware: '',
      antennaId: ant.id, antenna: antennaSnapshot(ant), antennaSerial: '', cableLength: '',
      // Header — right column
      // julianDay holds a typed override; it is only used while julianManual is on.
      section: '', sessionId: '', station: '', obsDate: utcDateISO(), julianDay: '', julianManual: false,
      operators: '', fileName: '',
      // Approximate position. lat/lon are decimal degrees (shown as DMS); h is the
      // ellipsoidal height as typed (m); source is 'phone' | 'manual' | ''.
      pos: { ...EMPTY_POS },
      // Session
      interval: '', startUT: '', stopUT: '', elevMask: '', pdop: '', method: METHODS[0], methodOther: '',
      // Antenna height readings, as typed
      slant: readingSet(), vert: readingSet(), tol: '',
      // Site
      obstructions: [], bearingRef: 'mag', declination: '',
      sketch: { source: 'blank', linkedSketchPageId: '', inset: false, ownPage: false, notes: '' },
      images: { satellite: null, photo: null },
      observations: [],
      ...(seed || {}),
    };
  }
  // Fill anything missing so a page saved by an older version still opens.
  function normalize(raw, seed) {
    const base = emptyGnss(seed);
    const g = { ...base, ...(raw || {}) };
    g.slant = readingSet(g.slant);
    g.vert = readingSet(g.vert);
    g.obstructions = Array.isArray(g.obstructions) ? g.obstructions : [];
    g.observations = Array.isArray(g.observations) ? g.observations : [];
    g.pos = { ...EMPTY_POS, ...(g.pos || {}) };
    g.sketch = { ...base.sketch, ...(g.sketch || {}) };
    g.images = { ...base.images, ...(g.images || {}) };
    if (!METHODS.includes(g.method)) g.method = METHODS[0];
    return g;
  }

  // ─── Antenna height reduction ──────────────────────────────────────────────
  // One set of readings (slant or vertical): 3 before + 3 after the session.
  function readStats(list) {
    if (!list.length) return null;
    const min = Math.min(...list), max = Math.max(...list);
    return { vals: list, n: list.length, avg: list.reduce((a, b) => a + b, 0) / list.length, min, max, range: max - min };
  }
  function readSet(set, tol) {
    const parse = arr => (arr || []).map(num).filter(v => v !== null);
    const b = parse(set && set.before), a = parse(set && set.after);
    const bad = [...b, ...a].some(v => !fin(v) || v <= 0);
    if (bad) return { bad: true, before: null, after: null, all: null, flag: false };
    const all = readStats([...b, ...a]);
    // Compared at the form's 4 decimals so 1.5030 − 1.5000 reads as exactly 0.0030.
    const flag = !!all && Math.round((all.range - tol) * 1e6) > 0;
    return { bad: false, before: readStats(b), after: readStats(a), all, flag };
  }

  //   Slant:    S̄ = mean of every slant reading;  Z = √(S̄² − R²);  ARP = Z − d
  //   Vertical: V̄ = mean of every vertical reading;  ARP = V̄
  //   Both:     APC L1 = ARP + l1;  APC L2 = ARP + l2
  function solveHeights(g) {
    const t = num(g.tol);
    const tol = fin(t) && t > 0 ? t : DEFAULT_TOL;
    const A = g.antenna || {};
    const ant = { R: num(A.R), d: num(A.d), l1: num(A.l1), l2: num(A.l2) };
    const apc = (arp, k) => (fin(ant[k]) ? arp + ant[k] : null);

    const slant = readSet(g.slant, tol), vert = readSet(g.vert, tol);
    const out = { tol, ant, slant, vert, slantRes: null, slantErr: null, vertRes: null, vertErr: null, diff: null };
    const BAD = 'Readings must be positive numbers.';

    if (slant.bad) out.slantErr = BAD;
    else if (slant.all) {
      const S = slant.all.avg;
      if (!fin(ant.R) || !fin(ant.d)) out.slantErr = 'Pick an antenna to reduce the slant height — R and d are needed.';
      else if (S <= ant.R) out.slantErr = 'Slant height S must be longer than radius R.';
      else {
        const Z = Math.sqrt(S * S - ant.R * ant.R);
        const ARP = Z - ant.d;
        if (ARP <= 0) out.slantErr = 'ARP height comes out zero or negative. Check d (sign) and the readings.';
        else out.slantRes = { S, Z, ARP, L1: apc(ARP, 'l1'), L2: apc(ARP, 'l2') };
      }
    }
    if (vert.bad) out.vertErr = BAD;
    else if (vert.all) {
      const V = vert.all.avg;
      out.vertRes = { V, ARP: V, L1: apc(V, 'l1'), L2: apc(V, 'l2') };
    }
    if (out.slantRes && out.vertRes) out.diff = out.slantRes.ARP - out.vertRes.ARP;
    return out;
  }

  // Step-by-step working for a solveHeights result, as plain text:
  //   [{ t: 'Vertical to slant mark', e: 'Z = √(S̄² − R²) = √(1.5000² − 0.0785²) = 1.4979 m' }, …]
  function workingSteps(r) {
    const steps = [];
    const mean = (sym, st) => `${sym} = ${st.n > 1 ? `(${st.vals.map(f).join(' + ')}) / ${st.n} = ` : ''}${fm(st.avg)}`;
    const apc = (band, arp, corr) => `APC ${band} = ARP + ${band} correction = ${f(arp)} + (${f(corr)}) = ${fm(arp + corr)}`;
    const n = st => (st.n > 1 ? ` (average of ${st.n})` : '');

    if (r.slantRes) {
      const s = r.slantRes, a = r.ant;
      steps.push({ t: 'Slant height' + n(r.slant.all), e: mean('S̄', r.slant.all) });
      steps.push({ t: 'Vertical to slant mark', e: `Z = √(S̄² − R²) = √(${f(s.S)}² − ${f(a.R)}²) = ${fm(s.Z)}` });
      steps.push({ t: 'ARP height', e: `ARP = Z − d = ${f(s.Z)} − (${f(a.d)}) = ${fm(s.ARP)}` });
      if (s.L1 !== null) steps.push({ t: 'L1 phase centre height', e: apc('L1', s.ARP, a.l1) });
      if (s.L2 !== null) steps.push({ t: 'L2 phase centre height', e: apc('L2', s.ARP, a.l2) });
    }
    if (r.vertRes) {
      const v = r.vertRes, a = r.ant;
      steps.push({ t: 'Vertical method: measurement to ARP' + n(r.vert.all), e: mean('V̄', r.vert.all) });
      steps.push({ t: 'Vertical method: ARP height', e: `ARP = V̄ = ${fm(v.ARP)}` });
      if (v.L1 !== null) steps.push({ t: 'Vertical method: L1 phase centre height', e: apc('L1', v.ARP, a.l1) });
      if (v.L2 !== null) steps.push({ t: 'Vertical method: L2 phase centre height', e: apc('L2', v.ARP, a.l2) });
    }
    if (r.diff !== null) {
      steps.push({ t: 'Check: slant − vertical ARP height', check: true,
        e: `${f(r.slantRes.ARP)} − ${f(r.vertRes.ARP)} = ${fmtDiff(r.diff)} m` });
    }
    return steps;
  }

  // ─── Drawings ──────────────────────────────────────────────────────────────
  // Both drawings are built as SVG strings so the page and the PDF export use
  // one renderer. On screen the colours come from the brand (FBC / fbAlpha);
  // with { print: true } everything is black on white, greys made by opacity.
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const r2 = v => String(Math.round(v * 100) / 100);

  function palette(print) {
    const C = root.FBC;
    if (print || !C) {
      return { print: true, ink: '#000', soft: '#000', softOp: 0.5, faintOp: 0.28, dim: '#000', hot: '#000', dot: '#000',
               body: '#fff', paper: '#fff', sky: '#fff', font: 'Helvetica, Arial, sans-serif' };
    }
    return { print: false, ink: C.ink, soft: C.inkMuted, softOp: 1, faintOp: 0.5, dim: C.heading, hot: C.info, dot: C.accent,
             body: C.pageDeep, paper: C.page, sky: C.field, font: (root.FBF && root.FBF.mono) || 'monospace' };
  }
  // Text with a paper-coloured halo so it stays readable over lines and fills.
  function haloText(c, x, y, str, o) {
    const a = o || {};
    return `<text x="${r2(x)}" y="${r2(y)}" font-family="${c.font}" font-size="${a.size || 11}" font-weight="${a.weight || 700}"` +
      ` fill="${a.fill || c.ink}" text-anchor="${a.anchor || 'middle'}"${a.base ? ` dominant-baseline="${a.base}"` : ''}` +
      `${a.rot != null ? ` transform="rotate(${a.rot} ${r2(x)} ${r2(y)})"` : ''}${a.cls ? ` class="${a.cls}"` : ''}` +
      ` stroke="${c.paper}" stroke-width="${a.halo != null ? a.halo : 3}" stroke-linejoin="round" paint-order="stroke" pointer-events="none">${esc(str)}</text>`;
  }

  // ── Antenna height drawing ─────────────────────────────────────────────────
  // Label values for the drawing, from a solveHeights result. The slant method
  // gives S, Z and the ARP height; vertical readings alone give only the ARP.
  function diagramValues(r) {
    const s = r.slantRes, v = r.vertRes, a = r.ant || {};
    return {
      S: s ? s.S : null, Z: s ? s.Z : null, ARP: s ? s.ARP : v ? v.ARP : null,
      R: fin(a.R) ? a.R : null, d: fin(a.d) ? a.d : null,
    };
  }

  // Tripod over the mark, antenna with its ARP, the slant measure mark (SHMP)
  // on the ground-plane edge and the L1/L2 phase centres on the axis.
  // Dimensions: S (mark → SHMP), R (centre → SHMP), Z (vertical, mark → SHMP
  // level), d (SHMP level → ARP), ARP height (mark → ARP). Each label shows its
  // value when there is one and the bare symbol when there isn't.
  function buildAntennaSVG(values, opts) {
    const v = values || {}, c = palette(opts && opts.print);
    const arrow = 'gnArrow' + (c.print ? 'P' : 'S');
    const lab = (sym, val) => (fin(val) ? `${sym} ${f(val)}` : sym);
    const ends = `marker-start="url(#${arrow})" marker-end="url(#${arrow})"`;
    const dimLine = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c.dim}" stroke-width="1.3" ${ends}/>`;
    const ext = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c.dim}" stroke-opacity="${c.print ? 0.6 : 0.8}" stroke-width="0.8" stroke-dasharray="2 2"/>`;
    const small = (x, y, str, anchor) => `<text x="${x}" y="${y}" font-family="${c.font}" font-size="8.5" fill="${c.soft}" fill-opacity="${c.print ? 0.75 : 1}" text-anchor="${anchor || 'start'}">${esc(str)}</text>`;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 330" width="240" height="330" role="img" aria-label="Antenna on a tripod over the mark, showing slant height S, radius R, vertical Z, offset d and the ARP height">`,
      `<defs><marker id="${arrow}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 Z" fill="${c.dim}"/></marker></defs>`,
      // ground and tripod
      `<line x1="5" y1="300" x2="235" y2="300" stroke="${c.soft}" stroke-opacity="${c.softOp}" stroke-width="2"/>`,
      `<g stroke="${c.soft}" stroke-opacity="${c.softOp}" stroke-linecap="round">`,
      `<line x1="80" y1="120" x2="30" y2="300" stroke-width="3"/><line x1="80" y1="120" x2="130" y2="300" stroke-width="3"/>`,
      `<line x1="80" y1="120" x2="80" y2="296" stroke-width="2" stroke-opacity="${c.faintOp}"/></g>`,
      // tribrach, antenna stem, ground plane and dome
      `<g fill="${c.body}" stroke="${c.soft}" stroke-opacity="${c.softOp}" stroke-width="1.2" stroke-linejoin="round">`,
      `<rect x="68" y="108" width="24" height="12" rx="2"/><rect x="76" y="88" width="8" height="20"/>`,
      `<path d="M38 78 L122 78 L114 88 L46 88 Z"/><path d="M50 78 Q80 46 110 78 Z"/></g>`,
      // R — antenna centre to the slant mark
      ext(80, 46, 80, 78), ext(122, 46, 122, 76), dimLine(80, 50, 122, 50),
      haloText(c, 101, 42, lab('R', v.R)),
      // S — the taped slant, mark to slant mark
      `<line x1="80" y1="300" x2="122" y2="78" stroke="${c.hot}" stroke-width="2"/>`,
      haloText(c, 117, 192, lab('S', v.S), { rot: -79.3, fill: c.hot, size: 12 }),
      // Z — vertical, mark to the level of the slant mark
      ext(125, 78, 206, 78), dimLine(165, 78, 165, 300),
      haloText(c, 160, 189, lab('Z', v.Z), { rot: -90 }),
      // d — slant mark level to the ARP
      ext(84, 108, 206, 108), dimLine(200, 78, 200, 108),
      haloText(c, 200, 70, lab('d', v.d)),
      // ARP height — mark to the ARP
      ext(42, 108, 76, 108), dimLine(48, 108, 48, 300),
      haloText(c, 43, 204, lab('ARP', v.ARP), { rot: -90 }),
      // points
      `<circle cx="80" cy="300" r="3.5" fill="${c.ink}"/>`, small(80, 318, 'mark', 'middle'),
      `<circle cx="80" cy="108" r="3" fill="${c.dot}"/>`,
      `<circle cx="122" cy="78" r="3" fill="${c.hot}"/>`, small(127, 90, 'SHMP'),
      `<circle cx="80" cy="66" r="2.3" fill="${c.soft}"/>`, small(75, 68.5, 'L1', 'end'),
      `<circle cx="80" cy="73" r="2.3" fill="${c.soft}"/>`, small(85, 75.5, 'L2'),
      `</svg>`,
    ].join('');
  }

  // ── Obstructions and the sky plot ──────────────────────────────────────────
  // An obstruction row: { id, name, desc, fromAz, fromEl, toAz, toEl, comments }
  // — angles as typed. It covers the sky clockwise from From Az to To Az, from
  // the horizon up to an elevation that runs evenly from From Elev to To Elev.
  const norm360 = a => ((a % 360) + 360) % 360;
  const THIN = 3;                     // degrees drawn for an obstruction with one bearing
  const signed = v => (v < 0 ? '−' : '+') + Math.abs(v);

  // Which north the plot is drawn to. Magnetic bearings are turned to true when
  // a declination is given: True = Magnetic + declination (west negative).
  function plotNorth(opts) {
    const o = opts || {}, decl = num(o.declination);
    if (o.ref === 'true') return { shift: 0, top: 'N', label: 'TRUE NORTH', note: 'bearings entered as true' };
    if (fin(decl)) return { shift: decl, top: 'N', label: 'TRUE NORTH', note: `magnetic bearings + declination ${signed(decl)}°` };
    return { shift: 0, top: 'MN', label: 'MAGNETIC NORTH', note: 'no declination applied' };
  }

  // Rows as plot wedges: [{ id, n, az1, sweep, el1, el2 }] — az1 is where the
  // wedge starts on the plot's north, sweep how far it runs clockwise.
  // opts.parse turns a typed angle into degrees (the app passes parseDMSInput).
  function skyWedges(rows, opts) {
    const o = opts || {}, parse = o.parse || num, shift = plotNorth(o).shift;
    const ang = raw => {
      const t = String(raw ?? '').trim().replace(/−/g, '-');
      const x = t ? parse(t) : null;
      return fin(x) ? x : null;
    };
    const clampEl = e => Math.max(0, Math.min(90, e));
    const out = [];
    (rows || []).forEach((row, i) => {
      if (!row) return;
      const a1 = ang(row.fromAz), a2 = ang(row.toAz);
      let e1 = ang(row.fromEl), e2 = ang(row.toEl);
      if (e1 === null) e1 = e2;
      if (e2 === null) e2 = e1;
      const start = a1 !== null ? a1 : a2;
      if (start === null || e1 === null) return;
      e1 = clampEl(e1); e2 = clampEl(e2);
      if (e1 === 0 && e2 === 0) return;                 // nothing above the horizon
      let az1 = norm360(start + shift);
      let sweep = a1 !== null && a2 !== null ? norm360(a2 - a1) : 0;
      if (sweep === 0) { az1 = norm360(az1 - THIN / 2); sweep = THIN; }
      out.push({ id: row.id, n: i + 1, az1, sweep, el1: e1, el2: e2 });
    });
    return out;
  }
  const wedgeOffset = (w, az) => norm360(az - w.az1);
  function inWedge(w, az) { return wedgeOffset(w, az) <= w.sweep; }
  function wedgeElev(w, az) {
    return w.el1 + (w.el2 - w.el1) * Math.min(1, wedgeOffset(w, az) / w.sweep);
  }

  // Polar plot, north up: the outer ring is the horizon (0°), the centre the
  // zenith (90°). opts: { print, ref: 'mag'|'true', declination, mask, parse,
  // highlight: obstruction id }. Each wedge carries data-obs="<id>".
  function buildSkyPlotSVG(rows, opts) {
    const o = opts || {}, c = palette(o.print), north = plotNorth(o);
    const W = 320, H = 344, cx = 160, cy = 162, R = 128;
    const rad = el => R * (90 - el) / 90;
    const xy = (az, el, r) => {
      const a = az * Math.PI / 180, rr = r != null ? r : rad(el);
      return [cx + rr * Math.sin(a), cy - rr * Math.cos(a)];
    };
    const p = (az, el) => xy(az, el).map(r2).join(' ');
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Sky plot of site obstructions, ${north.label.toLowerCase()} up">`];
    if (c.print) {
      out.push(`<defs><pattern id="gnHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
        `<rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#000" stroke-opacity="0.6" stroke-width="1.5"/></pattern></defs>`);
    }
    out.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${c.sky}"/>`);

    // Obstruction wedges, under the grid so the rings stay readable.
    const wedges = skyWedges(rows, o);
    wedges.forEach(w => {
      const steps = Math.max(2, Math.ceil(w.sweep / 2));
      const outer = [], inner = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, az = w.az1 + w.sweep * t;
        outer.push(p(az, 0));
        inner.push(p(az, w.el1 + (w.el2 - w.el1) * t));
      }
      const on = o.highlight != null && o.highlight === w.id;
      const fill = c.print ? 'url(#gnHatch)' : root.fbAlpha('accent', on ? 0.62 : 0.3);
      out.push(`<path d="M${outer.join(' L')} L${inner.reverse().join(' L')} Z" data-obs="${esc(w.id)}"${on ? ' data-on="1"' : ''}` +
        ` fill="${fill}" stroke="${c.print ? '#000' : c.dot}" stroke-width="${on ? 2.4 : 1.1}" stroke-linejoin="round"/>`);
    });

    // Elevation rings every 15° (30° and 60° solid and labelled) and radials every 30°.
    for (let az = 0; az < 360; az += 30) {
      const [x, y] = xy(az, 0);
      out.push(`<line x1="${cx}" y1="${cy}" x2="${r2(x)}" y2="${r2(y)}" stroke="${c.soft}" stroke-opacity="${c.faintOp}" stroke-width="0.6" pointer-events="none"/>`);
    }
    [15, 30, 45, 60, 75].forEach(el => {
      const solid = el % 30 === 0;
      out.push(`<circle cx="${cx}" cy="${cy}" r="${r2(rad(el))}" fill="none" stroke="${c.soft}" stroke-opacity="${solid ? c.softOp : c.faintOp}"` +
        ` stroke-width="${solid ? 0.9 : 0.7}"${solid ? '' : ' stroke-dasharray="3 3"'} pointer-events="none"/>`);
    });
    out.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${c.ink}" stroke-width="1.5" pointer-events="none"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="1.6" fill="${c.ink}" pointer-events="none"/>`);

    // Elevation mask from the session block.
    const mask = num(o.mask);
    if (fin(mask) && mask > 0 && mask < 90) {
      out.push(`<circle cx="${cx}" cy="${cy}" r="${r2(rad(mask))}" fill="none" stroke="${c.hot}" stroke-width="1.2" stroke-dasharray="7 3" pointer-events="none"/>`);
      const [mx, my] = xy(225, mask);
      out.push(haloText(c, mx, my, `mask ${mask}°`, { size: 8.5, fill: c.hot, base: 'central' }));
    }

    // Labels.
    [30, 60].forEach(el => out.push(haloText(c, cx + 3, cy - rad(el) - 3, `${el}°`, { size: 8.5, anchor: 'start', fill: c.soft, weight: 400 })));
    for (let az = 0; az < 360; az += 30) {
      const main = az % 90 === 0;
      const [x, y] = xy(az, 0, R + (main ? 13 : 11));
      const str = main ? (az === 0 ? north.top : 'ESW'[az / 90 - 1]) : String(az).padStart(3, '0');
      out.push(haloText(c, x, y, str, main ? { size: 13, base: 'central', halo: 0 } : { size: 8, base: 'central', fill: c.soft, weight: 400, halo: 0 }));
    }
    wedges.forEach(w => {
      const mid = w.az1 + w.sweep / 2;
      const [x, y] = xy(mid, (w.el1 + w.el2) / 4);
      out.push(haloText(c, x, y, String(w.n), { size: 11, base: 'central', cls: 'gn-sky-num' }));
    });
    out.push(haloText(c, cx, H - 16, north.label, { size: 10, halo: 0 }));
    out.push(haloText(c, cx, H - 5, north.note, { size: 8, fill: c.soft, weight: 400, halo: 0 }));
    out.push('</svg>');
    return out.join('');
  }

  // ─── Station sketch images ─────────────────────────────────────────────────
  // page.gnss.images holds up to two pictures, each { photoRef, … } keyed into
  // photoDB: `satellite` (captured imagery) and `photo` (camera / gallery).
  const IMAGE_SLOTS = ['satellite', 'photo'];
  function pageImageRefs(pg) {
    const imgs = pg && pg.gnss && pg.gnss.images;
    if (!imgs) return [];
    return IMAGE_SLOTS.map(k => imgs[k] && imgs[k].photoRef).filter(Boolean);
  }

  // Satellite imagery: Esri World Imagery, standard 256 px web-mercator tiles.
  const SAT_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
  const SAT_HOST = 'server.arcgisonline.com';
  const SAT_ATTRIBUTION = 'Imagery: Esri, Maxar, Earthstar Geographics';
  const SAT_ZOOM = { min: 14, max: 19, initial: 18 };
  const TILE = 256;

  // Position in tile units at a zoom level (fractional — the integer part is the tile).
  function tileXY(lat, lon, z) {
    const n = Math.pow(2, z), phi = lat * Math.PI / 180;
    return { x: (lon + 180) / 360 * n, y: (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * n };
  }
  function metresPerPixel(lat, z) {
    return 156543.03392804097 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
  }
  // The tiles that cover a w × h canvas centred on the station, each with the
  // canvas position (dx, dy) to draw it at.
  function tilePlan(lat, lon, z, w, h) {
    const c = tileXY(lat, lon, z), n = Math.pow(2, z);
    const left = c.x * TILE - w / 2, top = c.y * TILE - h / 2;
    const tiles = [];
    for (let ty = Math.floor(top / TILE); ty * TILE < top + h; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(left / TILE); tx * TILE < left + w; tx++) {
        const x = ((tx % n) + n) % n;
        tiles.push({ x, y: ty, url: `${SAT_TILE_URL}/${z}/${ty}/${x}`, dx: Math.round(tx * TILE - left), dy: Math.round(ty * TILE - top) });
      }
    }
    return { tiles, mpp: metresPerPixel(lat, z) };
  }
  // Longest round distance (1, 2 or 5 × 10ⁿ m) whose bar fits in maxPx.
  function niceScale(mpp, maxPx) {
    const max = mpp * maxPx;
    let best = 1;
    for (let e = -1; e <= 6; e++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, e); if (v <= max) best = v; }
    return { metres: best, px: best / mpp, label: best >= 1000 ? `${best / 1000} km` : `${best} m` };
  }

  const api = {
    BUILTIN_ANTENNAS, DEFAULT_ANTENNA_ID, METHODS, DEFAULT_TOL,
    IMAGE_SLOTS, pageImageRefs, SAT_HOST, SAT_ATTRIBUTION, SAT_ZOOM, tileXY, metresPerPixel, tilePlan, niceScale,
    diagramValues, buildAntennaSVG, plotNorth, skyWedges, inWedge, wedgeElev, buildSkyPlotSVG,
    num, fmt4, fmtDiff,
    julianDay, utcDateISO, utcTimeHMS, parseHMS, fmtHMS, sessionDuration,
    parseLatLon, fmtLatLonDMS,
    getAntennas, getAntenna, saveAntenna, deleteAntenna, duplicateAntenna, isBuiltin,
    antennaSnapshot, snapshotDiffers,
    emptyGnss, normalize,
    solveHeights, workingSteps,
  };
  root.fbGnss = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
