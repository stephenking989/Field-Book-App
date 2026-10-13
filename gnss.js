// FieldBook GNSS static observation engine — window.fbGnss
//
// Everything the GNSS Obs page computes, kept free of React so the page, the
// PDF export and the Node tests (../test-gnss.js) all run the same code:
//   • antenna library  — saved antenna models, shared by every project
//   • slant-height reduction — the COGS static observation form's arithmetic
//   • Julian day and UT session times
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

  const api = {
    BUILTIN_ANTENNAS, DEFAULT_ANTENNA_ID, METHODS, DEFAULT_TOL,
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
