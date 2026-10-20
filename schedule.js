/* Field Book — schedule (Gantt) logic. Plain JS, no React, so it runs in Node too (test-schedule.js).
 *
 * Model: a flat list of tasks in display order. `lvl` is the indent level (1 = top).
 * A task with children is a summary row: its dates and % roll up from them.
 * Dates are ISO 'YYYY-MM-DD' strings. Durations are working days (Mon–Fri).
 * A milestone (ms) has no duration: it sits on one day.
 *
 *   task = { id, name, lvl, start, days, ms, pct, who[], preds[], notes }
 *
 * Working time is counted in whole days; a successor starts on the first
 * working day after its predecessor finishes.
 */
(function (root) {
  'use strict';
  const DAY = 864e5;

  const isoToDay = iso => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
  const dayToIso = n => new Date(n * DAY).toISOString().slice(0, 10);
  const isWeekend = n => { const w = new Date(n * DAY).getUTCDay(); return w === 0 || w === 6; };
  const nextWork = n => { while (isWeekend(n)) n++; return n; };

  // Working days from a to b, both inclusive
  function workdays(a, b) {
    let c = 0;
    for (let n = a; n <= b; n++) if (!isWeekend(n)) c++;
    return c;
  }

  // The finish day of a task that runs `days` working days from `start`
  function addWorkdays(start, days) {
    let n = nextWork(start), c = 1;
    while (c < days) { n++; if (!isWeekend(n)) c++; }
    return n;
  }

  // Earliest day a successor may start, given its predecessor finishes on `f`
  const reqStart = f => nextWork(f + 1);

  function todayDay(today) {
    if (today == null) return null;
    return typeof today === 'number' ? today : isoToDay(today);
  }

  /* rows(tasks, today) → one entry per task, same order.
   *   wbs, lvl, isSum, ms, s, f (day numbers), days, pct, st, parentId, late
   *   st: 'done' | 'late' | 'active' | 'planned'  (only when today is given)
   */
  function rows(tasks, today) {
    const T = todayDay(today);
    const out = [];
    const stack = [];
    const ctr = [];
    tasks.forEach((t, idx) => {
      let lvl = Math.max(1, Math.round(+t.lvl || 1));
      const prev = out.length ? out[out.length - 1].lvl : 0;
      if (lvl > prev + 1) lvl = prev + 1;
      ctr.length = lvl;
      ctr[lvl - 1] = (ctr[lvl - 1] || 0) + 1;
      while (stack.length && stack[stack.length - 1].lvl >= lvl) stack.pop();
      const parent = stack.length ? stack[stack.length - 1] : null;
      const r = {
        id: t.id, idx, lvl, wbs: ctr.join('.'), isSum: false, ms: !!t.ms,
        parentId: parent ? parent.id : null, kids: [],
        s: null, f: null, days: 0, pct: clampPct(t.pct), st: null, late: false,
      };
      if (parent) parent.kids.push(r);
      stack.push(r);
      out.push(r);
      r._src = t;
    });

    // Leaves first, then summaries bottom-up (children always come after their parent)
    for (let i = out.length - 1; i >= 0; i--) {
      const r = out[i];
      if (r.kids.length) {
        r.isSum = true;
        r.s = Math.min(...r.kids.map(k => k.s));
        r.f = Math.max(...r.kids.map(k => k.f));
        r.days = r.kids.reduce((a, k) => a + k.days, 0);
        const w = r.kids.reduce((a, k) => a + k.days, 0);
        r.pct = w
          ? Math.round(r.kids.reduce((a, k) => a + k.days * k.pct, 0) / w)
          : Math.round(r.kids.reduce((a, k) => a + k.pct, 0) / r.kids.length);
      } else if (r.ms) {
        r.s = r.f = nextWork(isoToDay(r._src.start || dayToIso(T ?? 0)));
        r.days = 0;
      } else {
        const d = Math.max(1, Math.round(+r._src.days || 1));
        r.s = nextWork(isoToDay(r._src.start || dayToIso(T ?? 0)));
        r.f = addWorkdays(r.s, d);
        r.days = d;
      }
      if (T != null) {
        r.late = r.pct < 100 && r.f < T;
        r.st = r.pct >= 100 ? 'done' : r.late ? 'late' : r.s <= T ? 'active' : 'planned';
      }
    }
    out.forEach(r => { delete r._src; delete r.kids; });
    return out;
  }

  function clampPct(v) {
    const n = Math.round(+v || 0);
    return Math.max(0, Math.min(100, n));
  }

  // Task ids whose start falls before the required start from a predecessor
  function conflicts(tasks) {
    const R = byIdOf(rows(tasks));
    const bad = [];
    for (const t of tasks) {
      const r = R[t.id];
      if (!r || r.isSum || !(t.preds && t.preds.length)) continue;
      const req = requiredStart(t, R);
      if (req != null && r.s < req) bad.push(t.id);
    }
    return bad;
  }

  function requiredStart(t, R) {
    let req = null;
    for (const pid of (t.preds || [])) {
      const p = R[pid];
      if (!p) continue;
      const v = reqStart(p.f);
      req = req == null ? v : Math.max(req, v);
    }
    return req;
  }

  // Move every task that starts before its predecessors finish, and everything
  // that follows it, so the schedule holds together. Returns new task objects;
  // the input is not changed. Planned gaps are kept.
  function alignAll(tasks) {
    const out = tasks.map(t => Object.assign({}, t));
    for (let pass = 0; pass < 500; pass++) {
      const R = byIdOf(rows(out));
      let moved = false;
      for (const t of out) {
        const r = R[t.id];
        if (!r || r.isSum || !(t.preds && t.preds.length)) continue;
        const req = requiredStart(t, R);
        if (req != null && r.s < req) {
          t.start = dayToIso(req);
          moved = true;
        }
      }
      if (!moved) break;
    }
    return out;
  }

  function byIdOf(list) {
    const m = {};
    for (const x of list) m[x.id] = x;
    return m;
  }

  const api = {
    isoToDay, dayToIso, isWeekend, nextWork, workdays, addWorkdays,
    rows, conflicts, alignAll,
  };
  root.fbSchedule = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
