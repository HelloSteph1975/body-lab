// Pure workout-program helpers: no DOM, no fetch, so node:test can import them.
// Dates are YYYY-MM-DD strings; all math is on UTC midnights, so no time-zone drift.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const WEEK_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const fromNum = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

export const addDaysIso = (iso, n) => fromNum(dayNum(iso) + n);
export const dayKey = (iso) => DAY_KEYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

export function mondayOf(iso) {
  const k = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDaysIso(iso, -((k + 6) % 7));
}

export function nextMonday(iso) {
  const m = mondayOf(iso);
  return m === iso ? iso : addDaysIso(m, 7);
}

const phasesOf = (program) => (program && !program.broken && Array.isArray(program.phases) ? program.phases.filter((p) => p && typeof p === 'object') : []);
const weeksOf = (p) => Math.max(0, Math.floor(Number(p.weeks) || 0));

export const totalWeeks = (program) => phasesOf(program).reduce((s, p) => s + weeksOf(p), 0);

export function programPosition(program, startIso, dateIso) {
  const phases = phasesOf(program);
  if (!phases.length || !startIso) return { state: 'none' };
  const diff = dayNum(dateIso) - dayNum(startIso);
  if (Number.isNaN(diff)) return { state: 'none' };
  const total = totalWeeks(program);
  if (diff < 0) return { state: 'not-started', daysUntilStart: -diff, totalWeeks: total };
  const week = Math.floor(diff / 7) + 1;
  let end = 0;
  for (let i = 0; i < phases.length; i += 1) {
    end += weeksOf(phases[i]);
    if (week <= end) return { state: 'active', week, totalWeeks: total, phaseIndex: i, phase: phases[i] };
  }
  return { state: 'complete', week, totalWeeks: total };
}

export function scheduledRoutine(program, startIso, dateIso) {
  const pos = programPosition(program, startIso, dateIso);
  if (pos.state !== 'active') return null;
  return (pos.phase.days || {})[dayKey(dateIso)] || null;
}

// A logged workout counts as done when it has no sets (old style) or at least one set is not marked undone.
export function isWorkoutDone(entry) {
  const sets = entry && entry.sets;
  if (!Array.isArray(sets) || !sets.length) return true;
  return sets.some((s) => s !== null && typeof s === 'object' && s.done !== false);
}

const workoutsOn = (day) => {
  const a = day && day.data && day.data.activity;
  return Array.isArray(a) ? a.filter((x) => x && x.type === 'workout') : [];
};

export function weekPlan(program, startIso, todayIso, days = []) {
  if (Number.isNaN(dayNum(todayIso))) return [];
  const byDate = new Map((days || []).map((d) => [d.date, d]));
  const mon = mondayOf(todayIso);
  return WEEK_ORDER.map((key, i) => {
    const date = addDaysIso(mon, i);
    const routine = scheduledRoutine(program, startIso, date);
    let status = 'rest';
    if (routine) {
      const done = workoutsOn(byDate.get(date)).some((w) => (w.program === program.name || w.name === routine) && isWorkoutDone(w));
      if (done) status = 'done';
      else status = date < todayIso ? 'missed' : 'upcoming';
    }
    return { date, key, routine, status };
  });
}

export function effectiveWalkMinutes(goals, program, todayIso) {
  const pos = programPosition(program, goals && goals.program_start, todayIso);
  const m = pos.state === 'active' ? pos.phase.walk_minutes : null;
  if (typeof m === 'number' && m > 0) return { minutes: m, source: 'program', program: program.name };
  return { minutes: (goals && goals.walk_minutes) ?? null, source: 'settings' };
}

export function normalizeMove(m) {
  if (typeof m === 'string') return { move: m, sets: 1 };
  return { ...m, sets: Math.min(20, Math.max(1, Math.floor(Number(m.sets)) || 1)) };
}

export function findRoutine(name, program, library) {
  const pick = (list) => (Array.isArray(list) ? list : []).find((r) => r && r.name === name);
  const r = pick(program && program.routines) || pick(library && library.routines);
  return r ? { name: r.name, moves: (Array.isArray(r.moves) ? r.moves : []).filter((m) => typeof m === 'string' || (m && typeof m === 'object' && !Array.isArray(m))).map(normalizeMove) } : null;
}

export function prefillSets(routine) {
  const out = [];
  for (const m of (routine && routine.moves) || []) {
    for (let i = 0; i < m.sets; i += 1) {
      const set = { move: m.move, reps: m.reps ?? null, weight_lb: m.weight_lb ?? null, seconds: m.seconds ?? null, done: false };
      // A text target like "8-12" can't go in a number box: null it and keep the text as a hint.
      const hint = {};
      for (const k of ['reps', 'weight_lb', 'seconds']) {
        if (set[k] !== null && !(typeof set[k] === 'number' && Number.isFinite(set[k]))) {
          hint[k] = String(set[k]);
          set[k] = null;
        }
      }
      if (Object.keys(hint).length) set.hint = hint;
      out.push(set);
    }
  }
  return out;
}

export function loggedMoves(days) {
  const names = new Set();
  for (const d of days || []) for (const w of workoutsOn(d)) for (const s of (Array.isArray(w.sets) ? w.sets : [])) if (s && s.move) names.add(s.move);
  return [...names].sort();
}

const UNITS = { weight_lb: ' lb', seconds: ' s', reps: ' reps' };

export function moveProgress(days, move) {
  const sets = [];
  for (const d of days || []) {
    for (const w of workoutsOn(d)) {
      for (const s of (Array.isArray(w.sets) ? w.sets : [])) if (s && s.move === move && s.done !== false) sets.push({ date: d.date, ...s });
    }
  }
  const has = (k) => sets.some((s) => typeof s[k] === 'number' && s[k] > 0);
  const metric = has('weight_lb') ? 'weight_lb' : has('seconds') ? 'seconds' : 'reps';
  const best = new Map();
  for (const s of sets) {
    const v = s[metric];
    if (typeof v !== 'number') continue;
    if (!best.has(s.date) || v > best.get(s.date)) best.set(s.date, v);
  }
  const points = [...best].sort((a, b) => a[0].localeCompare(b[0])).map(([x, y]) => ({ x, y }));
  return { metric, unit: UNITS[metric], points };
}

// ---------- editing helpers: keep what the forms cannot show ----------

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const SET_KNOWN = ['move', 'reps', 'seconds', 'weight_lb', 'done'];
const numOk = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v));

export function daysPerWeek(program) {
  const phases = phasesOf(program);
  return Math.max(0, ...phases.map((p) => (isPlain(p.days) ? WEEK_ORDER.filter((k) => p.days[k]).length : 0)));
}

// A blank box keeps a non-numeric original (like "8-12") instead of nulling it.
export function readNumber(raw, original) {
  const t = String(raw ?? '').trim();
  if (t !== '') return Number(t);
  return original !== undefined && original !== null && typeof original !== 'number' ? original : null;
}

// A set the workout form can show and edit: an object with a move name and numeric (or empty) numbers.
export function isEditableSet(s) {
  return isPlain(s) && typeof s.move === 'string' && s.move.trim() !== ''
    && numOk(s.reps) && numOk(s.seconds) && numOk(s.weight_lb) && (s.done === undefined || typeof s.done === 'boolean');
}

// Groups ADJACENT sets with the same move, so the logged order never changes. Sets the form can't
// show become { kept: original } items that join back unchanged and in place.
export function splitSets(sets, ticked = false) {
  const out = [];
  for (const s of Array.isArray(sets) ? sets : []) {
    if (!isEditableSet(s)) {
      out.push({ kept: s });
      continue;
    }
    const extra = Object.fromEntries(Object.entries(s).filter(([k]) => !SET_KNOWN.includes(k) && k !== 'hint'));
    const row = { reps: s.reps ?? null, seconds: s.seconds ?? null, weight_lb: s.weight_lb ?? null, done: ticked || s.done !== false, extra, hint: s.hint || {} };
    const last = out[out.length - 1];
    if (last && !('kept' in last) && last.move === s.move) last.rows.push(row);
    else out.push({ move: s.move, rows: [row] });
  }
  return out;
}

export function joinSets(items) {
  return items.flatMap((g) => {
    if ('kept' in g) return [g.kept];
    if (!String(g.move || '').trim()) return [];
    return g.rows.map((r) => {
      const out = { ...(r.extra || {}), move: g.move };
      if (r.reps != null) out.reps = r.reps;
      if (r.seconds != null) out.seconds = r.seconds;
      if (r.weight_lb != null) out.weight_lb = r.weight_lb;
      out.done = r.done;
      return out;
    });
  });
}

// Spread the original and override only the edited keys; id/broken/body_sha belong to the app.
export function mergeProgram(original, edited) {
  const base = isPlain(original) ? { ...original } : {};
  delete base.id;
  delete base.broken;
  delete base.body_sha;
  return { ...base, ...edited };
}

export const mergeRoutine = (original, name, moves) => ({ ...(isPlain(original) ? original : {}), name, moves });

export function mergePhase(original, { name, weeks, days, walk_minutes: walk }) {
  const out = { ...(isPlain(original) ? original : {}), name, weeks, days };
  if (typeof walk === 'number' && walk > 0) out.walk_minutes = walk;
  else if (walk === null || walk === undefined || typeof walk === 'number') delete out.walk_minutes;
  else out.walk_minutes = walk;
  return out;
}
