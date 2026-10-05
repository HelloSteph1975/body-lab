import { api } from '../api.js';
import { lineChart } from '../charts.js';
import { openForm } from '../forms.js';
import {
  addDaysIso, DAY_LABELS, daysPerWeek, effectiveWalkMinutes, loggedMoves, mergePhase, mergeProgram, mergeRoutine, moveProgress, nextMonday, programPosition, readNumber, totalWeeks, weekPlan, WEEK_ORDER,
} from '../programs.js';
import { attempt, C, esc, isoDate, prettyDate, shortDate } from '../util.js';

let chosenMove = '';

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const objs = (x) => (Array.isArray(x) ? x.filter(isObj) : []);

// A hand-edited note can hold nulls or wrong types; keep only what the page can read.
function clean(p) {
  if (!p || p.broken) return p;
  return {
    ...p,
    routines: objs(p.routines).map((r) => ({ ...r, name: String(r.name ?? ''), moves: (Array.isArray(r.moves) ? r.moves : []).filter((m) => typeof m === 'string' || isObj(m)) })),
    phases: objs(p.phases).map((ph) => ({ ...ph, name: String(ph.name ?? ''), days: isObj(ph.days) ? ph.days : {} })),
  };
}

const newProgram = () => ({ name: '', description: '', routines: [], phases: [{ name: 'Phase 1', weeks: 2, days: {} }] });

// ---------- program editor ----------

const numAttr = (v) => (v === undefined || v === null || typeof v !== 'number' ? '' : esc(v));
// A number box can't show text like "8-12": leave it blank and show the original as the placeholder.
const numHint = (v) => (v === undefined || v === null ? '' : typeof v === 'number' ? `value="${esc(v)}"` : `value="" data-kept placeholder="${esc(v)}"`);

function dayOptions(names, cur) {
  const list = [...names];
  if (cur && !list.includes(cur)) list.push(cur);
  return `<option value="">Rest</option>${list.map((n) => `<option value="${esc(n)}"${n === cur ? ' selected' : ''}>${esc(n)}</option>`).join('')}`;
}

function phaseRow(ph, i, names) {
  const options = (cur) => dayOptions(names, cur);
  return `<div class="editor-block" data-phase="${i}">
    <div class="item-row phase-row">
      <input data-f="name" placeholder="Phase name" aria-label="Phase name" value="${esc(ph.name)}">
      <input data-f="weeks" type="number" min="1" step="1" placeholder="Weeks" aria-label="Weeks" value="${numAttr(ph.weeks)}">
      <input data-f="walk" type="number" min="0" step="1" placeholder="Walk min" aria-label="Walk minutes" ${numHint(ph.walk_minutes)}>
      <button type="button" data-rm-phase="${i}" aria-label="Remove phase">✕</button>
    </div>
    <div class="week-pick">${WEEK_ORDER.map((k) => `<label>${DAY_LABELS[k]}<select data-day="${k}">${options((ph.days || {})[k])}</select></label>`).join('')}</div>
  </div>`;
}

function routineBlock(r, i) {
  return `<div class="editor-block" data-routine="${i}">
    <div class="item-row routine-head"><input data-f="rname" placeholder="Routine name" aria-label="Routine name" value="${esc(r.name)}">
      <button type="button" data-rm-routine="${i}" aria-label="Remove routine">✕</button></div>
    ${(r.moves || []).map((m, j) => `<div class="item-row move-row" data-move="${j}">
      <input data-f="move" placeholder="Move" aria-label="Move" value="${esc(m.move)}">
      <input data-f="sets" type="number" min="1" step="1" placeholder="Sets" aria-label="Sets" value="${numAttr(m.sets)}">
      <input data-f="reps" type="number" min="0" step="1" placeholder="Reps" aria-label="Reps" ${numHint(m.reps)}>
      <input data-f="seconds" type="number" min="0" step="1" placeholder="Seconds" aria-label="Seconds" ${numHint(m.seconds)}>
      <input data-f="weight_lb" type="number" min="0" step="0.5" placeholder="Weight lb" aria-label="Weight in pounds" ${numHint(m.weight_lb)}>
      <button type="button" data-rm-move="${j}" aria-label="Remove move">✕</button>
    </div>`).join('')}
    <div><button type="button" data-add-move="${i}">+ Move</button></div>
  </div>`;
}

const numOrNull = (el) => {
  const raw = el.value.trim();
  return raw === '' ? null : Number(raw);
};

function programEditorExtra(program, library) {
  // Work on copies, never on the program the page is holding.
  const st = {
    routines: program.routines.map((r) => ({ ...r, moves: r.moves.map((m) => (typeof m === 'string' ? { move: m, sets: 1 } : { ...m })) })),
    phases: program.phases.map((p) => ({ ...p, days: { ...p.days } })),
  };
  const libraryNames = objs(library && library.routines).map((r) => r.name).filter(Boolean);

  return (box) => {
    // Copy what is on screen back into st, so redrawing never loses typing.
    const sync = () => {
      box.querySelectorAll('[data-phase]').forEach((el) => {
        const idx = Number(el.dataset.phase);
        const days = Object.fromEntries(Object.entries(st.phases[idx].days).filter(([k]) => !WEEK_ORDER.includes(k)));
        el.querySelectorAll('[data-day]').forEach((s) => { if (s.value) days[s.dataset.day] = s.value; });
        const cur = st.phases[idx];
        st.phases[idx] = { ...cur, name: el.querySelector('[data-f="name"]').value, weeks: numOrNull(el.querySelector('[data-f="weeks"]')), days, walk_minutes: readNumber(el.querySelector('[data-f="walk"]').value, cur.walk_minutes) };
      });
      box.querySelectorAll('[data-routine]').forEach((el) => {
        const r = st.routines[Number(el.dataset.routine)];
        r.name = el.querySelector('[data-f="rname"]').value;
        el.querySelectorAll('[data-move]').forEach((row) => {
          const m = r.moves[Number(row.dataset.move)];
          m.move = row.querySelector('[data-f="move"]').value;
          for (const k of ['sets', 'reps', 'seconds', 'weight_lb']) {
            const v = readNumber(row.querySelector(`[data-f="${k}"]`).value, m[k]);
            if (v === null) delete m[k]; else m[k] = v;
          }
        });
      });
    };

    const draw = () => {
      const names = [...new Set([...st.routines.map((r) => r.name.trim()), ...libraryNames].filter(Boolean))];
      box.innerHTML = `<h3 class="sub-h">Phases</h3>
        <div class="item-row head phase-row"><span>Name</span><span>Weeks</span><span>Walk min</span><span></span></div>
        ${st.phases.map((p, i) => phaseRow(p, i, names)).join('')}
        <div><button type="button" data-add-phase>+ Phase</button></div>
        <h3 class="sub-h">Routines</h3>
        ${st.routines.map((r, i) => routineBlock(r, i)).join('')}
        <div><button type="button" data-add-routine>+ Routine</button></div>`;
      // A renamed routine changes the day pickers. Update them in place: redrawing here
      // would detach the button under the pointer and swallow the click that caused the blur.
      box.querySelectorAll('[data-f="rname"]').forEach((el) => el.addEventListener('change', () => {
        const idx = Number(el.closest('[data-routine]').dataset.routine);
        const before = st.routines[idx].name.trim();
        sync();
        const after = st.routines[idx].name.trim();
        if (before && after && before !== after) st.phases.forEach((ph) => { for (const k of Object.keys(ph.days)) if (ph.days[k] === before) ph.days[k] = after; });
        const names = [...new Set([...st.routines.map((r) => r.name.trim()), ...libraryNames].filter(Boolean))];
        box.querySelectorAll('[data-phase]').forEach((row) => {
          const ph = st.phases[Number(row.dataset.phase)];
          row.querySelectorAll('[data-day]').forEach((sel) => { sel.innerHTML = dayOptions(names, ph.days[sel.dataset.day]); });
        });
      }));
      box.querySelector('[data-add-phase]').addEventListener('click', () => { sync(); st.phases.push({ name: `Phase ${st.phases.length + 1}`, weeks: 2, days: {} }); draw(); });
      box.querySelector('[data-add-routine]').addEventListener('click', () => { sync(); st.routines.push({ name: '', moves: [{ move: '', sets: 1 }] }); draw(); });
      box.querySelectorAll('[data-rm-phase]').forEach((b) => b.addEventListener('click', () => { sync(); st.phases.splice(Number(b.dataset.rmPhase), 1); draw(); }));
      box.querySelectorAll('[data-rm-routine]').forEach((b) => b.addEventListener('click', () => { sync(); st.routines.splice(Number(b.dataset.rmRoutine), 1); draw(); }));
      box.querySelectorAll('[data-add-move]').forEach((b) => b.addEventListener('click', () => { sync(); st.routines[Number(b.dataset.addMove)].moves.push({ move: '', sets: 1 }); draw(); }));
      box.querySelectorAll('[data-rm-move]').forEach((b) => b.addEventListener('click', () => {
        sync();
        st.routines[Number(b.closest('[data-routine]').dataset.routine)].moves.splice(Number(b.dataset.rmMove), 1);
        draw();
      }));
    };
    draw();

    return () => {
      sync();
      const routines = [];
      for (const r of st.routines) {
        const name = r.name.trim();
        const moves = r.moves.filter((m) => String(m.move || '').trim()).map((m) => {
          for (const [k, label] of [['reps', 'Reps'], ['seconds', 'Seconds'], ['weight_lb', 'Weight']]) {
            if (typeof m[k] === 'number' && (!Number.isFinite(m[k]) || m[k] < 0)) throw new Error(`${m.move.trim()}: ${label} can't be negative.`);
          }
          const out = { ...m, move: m.move.trim() };
          if (!(out.sets >= 1)) out.sets = 1;
          return out;
        });
        if (!name && !moves.length) continue;
        if (!name) throw new Error('Give every routine a name.');
        if (routines.some((x) => x.name === name)) throw new Error(`Two routines are named "${name}".`);
        routines.push(mergeRoutine(r, name, moves));
      }
      if (!st.phases.length) throw new Error('A program needs at least one phase.');
      const known = new Set([...routines.map((r) => r.name), ...libraryNames]);
      const phases = st.phases.map((p, i) => {
        const label = p.name.trim() || `Phase ${i + 1}`;
        if (!Number.isInteger(p.weeks) || p.weeks < 1) throw new Error(`${label}: weeks must be a whole number, 1 or more.`);
        for (const [k, v] of Object.entries(p.days)) {
          if (!known.has(v)) throw new Error(`${label}: ${DAY_LABELS[k] || k} uses "${v}", which is not a routine here or in the Library.`);
        }
        return mergePhase(p, { name: label, weeks: p.weeks, days: p.days, walk_minutes: p.walk_minutes });
      });
      return { routines, phases };
    };
  };
}

function programForm(program, library, goals, done) {
  const isNew = !program;
  const base = clean(program || newProgram());
  openForm({
    title: isNew ? 'New program' : 'Edit program',
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
    ],
    values: base,
    extra: programEditorExtra(base, library),
    confirmDelete: 'Move this to .trash?',
    onDelete: !isNew && (async () => {
      await attempt(async () => {
        await api.deleteItem('programs', program.id);
        if (goals.program === program.id) await api.saveDoc('goals', { ...goals, program: '', program_start: null });
      }, 'Program deleted');
      done();
    }),
    onSave: (v) => attempt(async () => {
      const item = mergeProgram(program, { name: v.name, description: v.description || '', routines: v.routines, phases: v.phases, starter: false });
      const saved = isNew ? await api.createItem('programs', item) : await api.updateItem('programs', program.id, item);
      if (!isNew && goals.program === program.id && saved.id !== program.id) await api.saveDoc('goals', { ...goals, program: saved.id });
      done();
    }, 'Program saved'),
  });
}

function startForm(program, goals, today, done, verb = 'Start') {
  openForm({
    title: `${verb} ${program.name}`,
    fields: [{ name: 'date', label: 'First day (a Monday works best)', type: 'date', required: true, default: nextMonday(today) }],
    values: {},
    onSave: (v) => attempt(async () => {
      await api.saveDoc('goals', { ...goals, program: program.id, program_start: v.date });
      done();
    }, verb === 'Start' ? 'Program started' : 'Program restarted'),
  });
}

// ---------- page ----------

function activeCard(program, goals, today, days) {
  if (!program) {
    return '<h2>Active program</h2><p class="muted">No program running. Pick one below and press Start.</p>';
  }
  const start = goals.program_start;
  const pos = programPosition(program, start, today);
  let status = 'Pick a start date to begin.';
  let restart = '<button data-restart>Restart</button>';
  if (pos.state === 'not-started') {
    status = `Starts ${esc(prettyDate(start))} (in ${pos.daysUntilStart} day${pos.daysUntilStart === 1 ? '' : 's'})`;
  } else if (pos.state === 'active') {
    status = `Week ${pos.week} of ${pos.totalWeeks} · Phase ${pos.phaseIndex + 1}: ${esc(pos.phase.name)}`;
    const walk = effectiveWalkMinutes(goals, program, today);
    if (walk.source === 'program') status += `<br><small class="muted">Walks: ${walk.minutes} min (set by this phase)</small>`;
  } else if (pos.state === 'complete') {
    status = 'Program complete 🎉';
    restart = '<button class="primary" data-restart>Restart</button>';
  }
  const cells = pos.state === 'active'
    ? `<div class="week-row">${weekPlan(program, start, today, days).map((c) => {
      const tag = c.routine && c.date <= today ? `a href="#/today/${esc(c.date)}"` : 'div';
      const close = tag === 'div' ? 'div' : 'a';
      const mark = c.status === 'done' ? ' ✓' : c.status === 'missed' ? ' ✗' : '';
      return `<${tag} class="week-cell ${c.status}${c.date === today ? ' today' : ''}">
        <b>${esc(DAY_LABELS[c.key])}</b><small>${esc(shortDate(c.date))}</small><span>${c.routine ? esc(c.routine) : 'Rest'}${mark}</span></${close}>`;
    }).join('')}</div>` : '';
  return `<div class="head"><h2>Active program: ${esc(program.name)}</h2><span class="grow"></span>
      <div class="btns">${restart}<button class="danger" data-stop>Stop</button></div></div>
    <p class="status">${status}</p>${cells}`;
}

function programsCard(programs) {
  const rows = programs.map((p, i) => (p.broken
    ? `<tr class="static"><td>${esc(p.id)} <span class="tag">needs repair</span></td><td colspan="3" class="muted">This note cannot be read. Fix its frontmatter by hand.</td></tr>`
    : `<tr class="static"><td>${esc(p.name || p.id)}${p.starter ? ' <span class="tag starter">starter</span>' : ''}<br><small class="muted">${esc(p.description || '')}</small></td>
      <td>${totalWeeks(p)}</td><td>${daysPerWeek(p)}</td>
      <td><div class="btns"><button class="primary" data-start="${i}">Start</button><button data-edit="${i}">Edit</button><button data-copy="${i}">Copy</button></div></td></tr>`)).join('');
  return `<div class="head"><h2>Programs</h2><span class="grow"></span><button class="primary" data-new>+ New program</button></div>
    ${programs.length ? `<div class="table-wrap"><table id="programs-table"><thead><tr><th>Name</th><th>Weeks</th><th>Days/week</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p class="muted">No programs yet. Add one with + New program.</p>'}`;
}

function progressCard(days, today) {
  const moves = loggedMoves(days);
  if (!moves.length) return '<h2>Progress</h2><p class="muted">Log a workout with sets to see progress here.</p>';
  if (!moves.includes(chosenMove)) chosenMove = moves[0];
  const prog = moveProgress(days, chosenMove);
  const from = prog.points.length ? prog.points[0].x : addDaysIso(today, -89);
  const label = { weight_lb: 'Heaviest weight', seconds: 'Longest hold', reps: 'Most reps' }[prog.metric];
  return `<div class="head"><h2>Progress</h2><span class="grow"></span>
      <select data-move class="move-pick">${moves.map((m) => `<option value="${esc(m)}"${m === chosenMove ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
    <p class="muted">${esc(label)} per day</p>
    ${lineChart({ from, to: today, series: [{ name: chosenMove, color: C.blue, points: prog.points }], unit: prog.unit })}`;
}

export async function render(main, { refresh }) {
  const today = isoDate();
  const [rawPrograms, goals, library, days] = await Promise.all([
    api.items('programs'), api.doc('goals'), api.doc('workouts').catch(() => ({})), api.days(addDaysIso(today, -364), today),
  ]);
  const programs = rawPrograms.map(clean);
  const program = programs.find((p) => p.id === goals.program && !p.broken) || null;

  main.innerHTML = `<div class="head"><h1>Workouts</h1></div>
    <section class="card" id="active">${activeCard(program, goals, today, days)}</section>
    <section class="card gap" id="programs">${programsCard(programs)}</section>
    <section class="card gap" id="progress">${progressCard(days, today)}</section>`;

  const stop = main.querySelector('[data-stop]');
  if (stop) {
    stop.addEventListener('click', async () => {
      await attempt(() => api.saveDoc('goals', { ...goals, program: '', program_start: null }), 'Program stopped').catch(() => {});
      refresh();
    });
  }
  main.querySelectorAll('[data-restart]').forEach((b) => b.addEventListener('click', () => startForm(program, goals, today, refresh, 'Restart')));

  main.querySelector('[data-new]').addEventListener('click', () => programForm(null, library, goals, refresh));
  main.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
    const target = programs[Number(b.dataset.start)];
    if (goals.program && goals.program !== target.id && !confirm(`Replace ${program ? program.name : goals.program}?`)) return;
    startForm(target, goals, today, refresh);
  }));
  main.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => programForm(programs[Number(b.dataset.edit)], library, goals, refresh)));
  main.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const copy = { ...programs[Number(b.dataset.copy)] };
    delete copy.id;
    delete copy.broken;
    await attempt(() => api.createItem('programs', { ...copy, name: `${copy.name} (copy)`, starter: false }), 'Program copied').catch(() => {});
    refresh();
  }));

  const pick = main.querySelector('[data-move]');
  if (pick) pick.addEventListener('change', () => { chosenMove = pick.value; refresh(); });
}
