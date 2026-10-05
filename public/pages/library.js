import { api } from '../api.js';
import { openForm } from '../forms.js';
import { attachFoodPicker, defaultPortion, NUTRIENT_KEYS, planLookup, portionOptionsHtml } from '../foodpicker.js';
import { FOOD_TAGS } from '../meals.js';
import { mergeRoutine } from '../programs.js';
import { attempt, esc, slug } from '../util.js';

let tab = 'foods';

function foodForm(food, done) {
  openForm({
    title: food ? 'Edit food' : 'Add food',
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'serving', label: 'Serving', placeholder: '1 cup, 2 eggs, 100 g…' },
      { name: 'net_carbs', label: 'Net carbs (g)', type: 'number', step: '0.1' },
      { name: 'protein', label: 'Protein (g)', type: 'number', step: '0.1' },
      { name: 'fiber', label: 'Fiber (g)', type: 'number', step: '0.1' },
      { name: 'fat', label: 'Fat (g)', type: 'number', step: '0.1' },
      { name: 'kcal', label: 'Calories (kcal)', type: 'number', step: '1' },
      { name: 'tags', label: 'Tags', type: 'tags', options: FOOD_TAGS },
    ],
    values: food || {},
    confirmDelete: 'Move this to .trash?',
    onDelete: food && (async () => { await api.deleteItem('foods', food.id); done(); }),
    onSave: (v) => attempt(async () => {
      if (food) {
        try {
          // The version the page read; the server refuses the save if the note changed since.
          await api.updateItem('foods', food.id, { ...food, ...v, expected_version: food.version ?? 'none' });
        } catch (e) {
          if (e.stale) throw new Error('This food changed in another window. Close and reopen it.');
          throw e;
        }
      }
      else await api.createItem('foods', v);
      done();
    }, 'Food saved'),
    extra: (box, form) => lookUp(box, form),
  });
}

// "Look up" searches the USDA list and fills the name, serving, numbers and tags for one portion.
// Values already in the form are the person's: only empty fields, or fields still holding the
// last fill, change without asking. planLookup (foodpicker.js) decides; this only reads and writes.
function lookUp(box, form) {
  const el = document.createElement('div');
  el.className = 'lookup';
  el.innerHTML = `<button type="button" data-lookup>Look up</button>
    <span class="lookup-box" hidden><input placeholder="Search USDA foods, like egg or apple" aria-label="Search USDA foods">
    <select aria-label="Portion" hidden></select></span>`;
  form.querySelector('label').after(el);
  box.remove();
  const search = el.querySelector('.lookup-box input');
  const portion = el.querySelector('select');
  const tagButtons = () => [...form.querySelectorAll('.tags[data-name="tags"] button')];
  const current = () => ({
    ...Object.fromEntries(['name', 'serving', ...NUTRIENT_KEYS].map((k) => [k, form.elements[k].value])),
    tags: tagButtons().filter((b) => b.classList.contains('on')).map((b) => b.dataset.v),
  });
  let food = null;
  let last = {};
  const apply = (plan) => {
    for (const [k, v] of Object.entries(plan.writes)) form.elements[k].value = v;
    for (const b of tagButtons()) b.classList.toggle('on', plan.tags.includes(b.dataset.v));
    last = plan.next;
  };
  attachFoodPicker(search, {
    filter: (f) => f.source === 'usda',
    onPick: (picked) => {
      const label = defaultPortion(picked);
      let plan = planLookup(current(), picked, label, last);
      if (plan.conflicts.length) {
        // Declined: the form stays as it was and isn't linked, so its numbers and its USDA id
        // can't come from two different foods.
        if (!confirm(`Replace your numbers with USDA values for ${picked.name}?`)) {
          search.value = '';
          return;
        }
        plan = planLookup(current(), picked, label, last, true);
      }
      food = picked;
      portion.innerHTML = portionOptionsHtml(picked, label);
      portion.hidden = false;
      apply(plan);
    },
  });
  // A new portion refills only what the last fill wrote; it never asks.
  portion.addEventListener('change', () => { if (food) apply(planLookup(current(), food, portion.value, last)); });
  el.querySelector('[data-lookup]').addEventListener('click', (ev) => {
    ev.currentTarget.hidden = true;
    el.querySelector('.lookup-box').hidden = false;
    search.focus();
  });
  return () => (food ? { usda_id: food.id } : {});
}

function suppForm(plan, index, slots, done) {
  const item = index == null ? null : plan.items[index];
  openForm({
    title: item ? 'Edit supplement' : 'Add supplement',
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'dose', label: 'Amount' },
      { name: 'slot', label: 'When', type: 'select', options: Object.entries(slots) },
    ],
    values: item || { slot: 'morning' },
    onDelete: item && (async () => { const next = { ...plan, items: [...plan.items] }; next.items.splice(index, 1); await api.saveDoc('supplements', next); done(); }),
    onSave: (v) => attempt(async () => {
      const next = { ...plan, items: [...plan.items] };
      const suppItem = { key: item?.key || slug(v.name), name: v.name, dose: v.dose || '', slot: v.slot };
      if (!item && next.items.some((i) => i.key === suppItem.key)) throw new Error('That supplement is already in the plan.');
      if (item) next.items[index] = suppItem;
      else next.items.push(suppItem);
      await api.saveDoc('supplements', next);
      done();
    }, 'Plan saved'),
  });
}

function moveForm(workouts, index, done) {
  const move = index == null ? null : workouts.moves[index];
  openForm({
    title: move ? 'Edit move' : 'Add move',
    fields: [{ name: 'name', label: 'Move', required: true }, { name: 'notes', label: 'Notes (form cues, weight used)', type: 'textarea' }],
    values: move || {},
    onDelete: move && (async () => { const next = { ...workouts, moves: [...workouts.moves] }; next.moves.splice(index, 1); await api.saveDoc('workouts', next); done(); }),
    onSave: (v) => attempt(async () => {
      const next = { ...workouts, moves: [...workouts.moves] };
      if (move) next.moves[index] = v;
      else next.moves.push(v);
      await api.saveDoc('workouts', next);
      done();
    }, 'Workouts saved'),
  });
}

const asMove = (m) => (typeof m === 'string' ? { move: m, sets: 1 } : m && typeof m === 'object' && !Array.isArray(m) ? m : null);

// "Chair squat 2×10, Plank 2×20 s"
function describeMoves(moves) {
  return (Array.isArray(moves) ? moves : []).map(asMove).filter((m) => m && m.move).map((m) => {
    const target = m.seconds ? `${m.seconds} s` : m.reps ? `${m.reps}` : '';
    return `${m.move}${target ? ` ${m.sets || 1}×${target}` : ''}${m.weight_lb ? ` @ ${m.weight_lb} lb` : ''}`;
  }).join(', ');
}

function routineForm(workouts, index, done) {
  const routine = index == null ? null : workouts.routines[index];
  const moves = (routine && Array.isArray(routine.moves) ? routine.moves : []).map(asMove).filter(Boolean);
  const saved = (workouts.moves || []).map((m) => m && m.name).filter(Boolean);
  openForm({
    title: routine ? 'Edit routine' : 'Add routine',
    fields: [{ name: 'name', label: 'Routine name', required: true }],
    values: routine ? { name: routine.name } : {},
    onDelete: routine && (async () => { const next = { ...workouts, routines: [...workouts.routines] }; next.routines.splice(index, 1); await api.saveDoc('workouts', next); done(); }),
    onSave: (v) => attempt(async () => {
      const next = { ...workouts, routines: [...workouts.routines] };
      const routineData = mergeRoutine(routine, v.name, v.moves.filter((m) => m.move));
      if (routine) next.routines[index] = routineData;
      else next.routines.push(routineData);
      await api.saveDoc('workouts', next);
      done();
    }, 'Workouts saved'),
    extra: (box) => {
      box.innerHTML = `<datalist id="lib-moves">${saved.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="items"><div class="item-row head move-row"><span>Move</span><span>Sets</span><span>Reps</span><span>Seconds</span><span>Weight lb</span><span></span></div></div>
        <div class="btns"><button type="button" data-add>+ Move</button></div>`;
      const wrap = box.querySelector('.items');
      const addRow = (m = { move: '', sets: 1 }) => {
        const row = document.createElement('div');
        row.className = 'item-row move-row';
        // Keep what the row can't show: unknown keys, and numbers written as text (like "8-12").
        const isNum = (k) => typeof m[k] === 'number' || m[k] === undefined || m[k] === null;
        row.dataset.extra = JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => !['move', 'sets', 'reps', 'seconds', 'weight_lb'].includes(k) || (k !== 'move' && k !== 'sets' && !isNum(k)))));
        const shown = (k) => (isNum(k) ? esc(m[k]) : '');
        const hint = (k) => (isNum(k) ? '' : ` placeholder="${esc(m[k])}"`);
        row.innerHTML = `<input data-k="move" list="lib-moves" placeholder="Move" aria-label="Move" value="${esc(m.move)}">
          <input data-k="sets" type="number" min="1" step="1" placeholder="Sets" aria-label="Sets" value="${esc(m.sets ?? 1)}">
          <input data-k="reps" type="number" min="0" step="1" aria-label="Reps"${hint('reps') || ' placeholder="Reps"'} value="${shown('reps')}">
          <input data-k="seconds" type="number" min="0" step="1" aria-label="Seconds"${hint('seconds') || ' placeholder="Seconds"'} value="${shown('seconds')}">
          <input data-k="weight_lb" type="number" min="0" step="0.5" aria-label="Weight in pounds"${hint('weight_lb') || ' placeholder="Weight lb"'} value="${shown('weight_lb')}">
          <button type="button" title="Remove">✕</button>`;
        row.querySelector('button').addEventListener('click', () => row.remove());
        wrap.append(row);
      };
      moves.forEach(addRow);
      box.querySelector('[data-add]').addEventListener('click', () => addRow());
      return () => ({
        moves: [...wrap.querySelectorAll('.move-row:not(.head)')].map((row) => {
          const get = (k) => row.querySelector(`[data-k=${k}]`).value.trim();
          const out = { ...JSON.parse(row.dataset.extra || '{}'), move: get('move'), sets: Math.min(20, Math.max(1, Math.floor(Number(get('sets'))) || 1)) };
          for (const k of ['reps', 'seconds', 'weight_lb']) {
            const n = get(k) === '' ? null : Number(get(k));
            if (n !== null && n >= 0) out[k] = ['reps', 'seconds'].includes(k) ? Math.floor(n) : n;
          }
          return out;
        }),
      });
    },
  });
}

export async function render(main, { arg, refresh }) {
  if (['foods', 'supplements', 'workouts'].includes(arg)) tab = arg;
  const [foods, plan, workouts, meta] = await Promise.all([api.items('foods'), api.doc('supplements'), api.doc('workouts'), api.meta()]);
  plan.items = plan.items || [];
  const tabs = [['foods', 'Foods'], ['supplements', 'Supplement plan'], ['workouts', 'Workouts']];
  let body = '';
  if (tab === 'foods') {
    body = `<div class="head"><h2>Saved foods</h2><span class="grow"></span><button class="primary" data-new>+ Food</button></div>
      ${foods.length ? `<table><thead><tr><th>Food</th><th>Serving</th><th>Net carbs</th><th>Protein</th><th>Fiber</th><th>Fat</th><th>kcal</th><th>Tags</th></tr></thead><tbody>
      ${foods.map((f, i) => `<tr data-i="${i}"><td>${esc(f.name || f.id)}${f.broken ? ' <span class="tag">needs repair</span>' : ''}</td><td>${esc(f.serving || '')}</td><td>${esc(f.net_carbs ?? '')}</td><td>${esc(f.protein ?? '')}</td><td>${esc(f.fiber ?? '')}</td><td>${esc(f.fat ?? '')}</td><td>${esc(f.kcal ?? '')}</td><td>${(Array.isArray(f.tags) ? f.tags : []).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">No foods yet. They are added here when you log a meal with "Remember new foods" ticked.</p>'}`;
  } else if (tab === 'supplements') {
    body = `<div class="head"><h2>Supplement plan</h2><span class="grow"></span><button class="primary" data-new>+ Supplement</button></div>
      <p class="muted">Doses come from your research document. Check changes with your doctor.</p>
      <table><thead><tr><th>Supplement</th><th>Amount</th><th>When</th></tr></thead><tbody>
      ${plan.items.map((s, i) => `<tr data-i="${i}"><td>${esc(s.name)}</td><td>${esc(s.dose || '')}</td><td>${esc(meta.slots[s.slot] || s.slot)}</td></tr>`).join('')}
      </tbody></table>`;
  } else {
    body = `<div class="grid halves">
      <section><div class="head"><h2>Moves</h2><span class="grow"></span><button class="primary" data-new-move>+ Move</button></div>
        <ul class="list">${workouts.moves.map((m, i) => `<li data-move="${i}"><span class="what">${esc(m.name)}<br><small class="muted">${esc(m.notes || '')}</small></span></li>`).join('')}</ul></section>
      <section><div class="head"><h2>Routines</h2><span class="grow"></span><button class="primary" data-new-routine>+ Routine</button></div>
        <ul class="list">${workouts.routines.map((r, i) => `<li data-routine="${i}"><span class="what">${esc(r.name)}<br><small class="muted">${esc(describeMoves(r.moves))}</small></span></li>`).join('')}</ul></section>
    </div>`;
  }
  main.innerHTML = `<div class="head"><h1>Library</h1></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <section class="card">${body}</section>`;

  main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/library/' + b.dataset.tab; }));
  if (tab === 'foods') {
    main.querySelector('[data-new]').addEventListener('click', () => foodForm(null, refresh));
    main.querySelectorAll('[data-i]').forEach((tr) => tr.addEventListener('click', () => foodForm(foods[Number(tr.dataset.i)], refresh)));
  } else if (tab === 'supplements') {
    main.querySelector('[data-new]').addEventListener('click', () => suppForm(plan, null, meta.slots, refresh));
    main.querySelectorAll('[data-i]').forEach((tr) => tr.addEventListener('click', () => suppForm(plan, Number(tr.dataset.i), meta.slots, refresh)));
  } else {
    main.querySelector('[data-new-move]').addEventListener('click', () => moveForm(workouts, null, refresh));
    main.querySelector('[data-new-routine]').addEventListener('click', () => routineForm(workouts, null, refresh));
    main.querySelectorAll('[data-move]').forEach((li) => li.addEventListener('click', () => moveForm(workouts, Number(li.dataset.move), refresh)));
    main.querySelectorAll('[data-routine]').forEach((li) => li.addEventListener('click', () => routineForm(workouts, Number(li.dataset.routine), refresh)));
  }
}
