import { api } from './api.js';
import { openForm } from './forms.js';
import { attachFoodPicker, bestMatch, defaultPortion, fillItem, itemMeta, NUTRIENT_KEYS, perServing, portionOptions, portionOptionsHtml, withUsdaPortions } from './foodpicker.js';
import { attempt, addDays, esc, nowTime, slug, toast } from './util.js';
import { SIDE_EFFECTS, SITES, suggestSite } from './glp1.js';
import { findRoutine, isEditableSet, joinSets, prefillSets, programPosition, splitSets } from './programs.js';

let metaCache;
// Loads what a form needs; on failure shows a message and returns null so the form doesn't half-open.
async function load(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || 'Could not load that.', true);
    return null;
  }
}

async function meta() {
  metaCache = metaCache || (await api.meta());
  return metaCache;
}

function saveEntry(date, list, entry, values, done, label) {
  return attempt(async () => {
    if (entry) await api.updateEntry(date, list, entry.id, values);
    else await api.addEntry(date, list, values);
    done();
  }, `${label} saved`);
}

function deleteEntry(date, list, entry, done) {
  return async () => {
    await api.deleteEntry(date, list, entry.id);
    done();
  };
}

const KINDS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];

// Meals have a list of foods. Typing in a food box suggests saved and USDA foods; picking one
// shows its portions and fills the numbers for portion × qty. A number the person typed is
// theirs: portion and qty changes leave it alone. New foods are saved to the library when
// "remember" is ticked.
export async function mealForm(date, entry, done) {
  const list = await load(() => api.items('foods'));
  if (!list) return;
  const foods = list.filter((f) => f.name);
  // Each item read from the form -> the food, portion and typed fields behind it (for "remember").
  const picked = new WeakMap();
  const byName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
  const items = entry?.items?.length ? entry.items : [{ food: '', qty: 1 }];
  openForm({
    title: entry ? 'Edit meal' : 'Add meal or snack',
    fields: [
      { name: 'time', label: 'Time', type: 'time', default: nowTime() },
      { name: 'kind', label: 'Which meal', type: 'select', options: KINDS },
    ],
    values: entry || {},
    onDelete: entry && deleteEntry(date, 'meals', entry, done),
    onSave: async (values) => {
      const cleaned = values.items.filter((i) => i.food);
      if (!cleaned.length) throw new Error('Add at least one food.');
      await saveEntry(date, 'meals', entry, { time: values.time, kind: values.kind, items: cleaned, ...(entry?.recipe ? { recipe: entry.recipe } : {}), ...(entry?.planned_id ? { planned_id: entry.planned_id } : {}) }, done, 'Meal');
      // The meal is safe now; remembering its foods is a bonus, so a failure here only warns.
      if (values.remember) {
        const toCreate = [...new Set(cleaned.map((it) => it.food.toLowerCase()))].map((lower) => cleaned.find((it) => it.food.toLowerCase() === lower));
        for (const it of toCreate) {
          if (byName.has(it.food.toLowerCase())) continue;
          // Saved per one serving: the chosen portion, or "1 serving" for typed numbers.
          const info = picked.get(it);
          const food = {
            name: it.food,
            serving: typeof it.portion === 'string' && it.portion ? it.portion : '1 serving',
            ...perServing(it, info?.food, info?.portion, info?.dirty),
            ...(Array.isArray(it.tags) && it.tags.length ? { tags: it.tags } : {}),
            ...(it.usda_id != null && it.usda_id !== '' ? { usda_id: it.usda_id } : {}),
          };
          try {
            const created = await api.createItem('foods', food);
            byName.set(created.name.toLowerCase(), created);
          } catch (e) {
            if (!/already exists/.test(e.message)) toast(`Meal saved, but "${it.food}" wasn't added to your foods: ${e.message}`, true);
          }
        }
      }
    },
    extra: (box) => {
      box.innerHTML = `<div class="items"><div class="item-row head"><span>Food</span><span>Qty</span><span>Net carbs</span><span>Protein</span><span>Fiber</span><span>Fat</span><span>kcal</span><span></span></div></div>
        <div class="btns"><button type="button" data-add>+ Food</button>
        <label class="check"><input type="checkbox" name="remember" checked> Remember new foods</label></div>`;
      const wrap = box.querySelector('.items');
      const addRow = (it = {}) => {
        const row = document.createElement('div');
        row.className = 'item-row';
        row._orig = it;
        const ARIA = { net_carbs: 'Net carbs in grams', protein: 'Protein in grams', fiber: 'Fiber in grams', fat: 'Fat in grams', kcal: 'Calories' };
        const num = (k, label, step, ph) => `<label class="cell"><span class="cl">${label}</span><input data-k="${k}" type="number" step="${step}" placeholder="${ph}" aria-label="${ARIA[k]}" value="${esc(it[k])}"></label>`;
        row.innerHTML = `<div class="cell food-cell"><span class="cl">Food</span><span class="food-box"><input data-k="food" placeholder="Type a food" aria-label="Food" value="${esc(it.food)}">
            <select data-k="portion" aria-label="Portion" hidden></select></span></div>
          <label class="cell"><span class="cl">Qty</span><input data-k="qty" type="number" step="0.25" placeholder="Qty" aria-label="Quantity" value="${esc(it.qty ?? 1)}"></label>
          ${num('net_carbs', 'Net carbs', '0.1', 'Carbs')}${num('protein', 'Protein', '0.1', 'Protein')}${num('fiber', 'Fiber', '0.1', 'Fiber')}${num('fat', 'Fat', '0.1', 'Fat (g)')}${num('kcal', 'kcal', '1', 'kcal')}
          <button type="button" title="Remove" aria-label="Remove food">✕</button>`;
        const $ = (k) => row.querySelector(`[data-k=${k}]`);
        const foodIn = $('food');
        const portionSel = $('portion');
        const origFood = String(it.food ?? '').trim().toLowerCase();
        // The food the numbers come from, and the fields the person typed in since it was picked.
        row._food = null;
        const dirty = new Set();
        row._dirty = dirty;
        const sameName = (f) => !!f && f.name.trim().toLowerCase() === foodIn.value.trim().toLowerCase();
        const showPortions = (food, selected) => {
          portionSel.innerHTML = portionOptionsHtml(food, selected);
          portionSel.hidden = false;
        };
        const refill = () => {
          if (!row._food) return;
          const values = fillItem(row._food, portionSel.value, $('qty').value === '' ? 1 : Number($('qty').value), dirty);
          for (const [k, v] of Object.entries(values)) $(k).value = v;
        };
        const pick = async (picked) => {
          // Extra keys (like a USDA id) belong to the food they came with; drop them if the name changes.
          if (picked.name.trim().toLowerCase() !== origFood) row._orig = {};
          const food = await withUsdaPortions(picked);
          if (!sameName(food)) return; // typed over while the portions loaded
          row._food = food;
          // Numbers typed before the pick stay the person's: fillItem skips dirty fields.
          showPortions(food, defaultPortion(food));
          refill();
        };
        attachFoodPicker(foodIn, { onPick: pick });
        foodIn.addEventListener('input', () => {
          if (foodIn.value.trim().toLowerCase() !== origFood) row._orig = {};
          if (row._food && !sameName(row._food)) {
            row._food = null;
            portionSel.hidden = true;
          }
        });
        // Typing a saved food's full name (without picking it) still fills, as before.
        foodIn.addEventListener('change', () => {
          if (row._food) return;
          const saved = byName.get(foodIn.value.trim().toLowerCase());
          if (saved) pick({ ...saved, source: 'saved' });
        });
        for (const k of NUTRIENT_KEYS) {
          $(k).addEventListener('input', () => { if ($(k).value.trim() === '') dirty.delete(k); else dirty.add(k); });
        }
        $('qty').addEventListener('input', refill);
        portionSel.addEventListener('change', refill);
        row.querySelector('button').addEventListener('click', () => row.remove());
        wrap.append(row);
        // An item logged earlier: find its food again so qty and portion changes still refill.
        // The saved food and the USDA food it came from are both tried; numbers neither one
        // explains at the logged qty count as typed.
        if (it.food) {
          (async () => {
            const saved = byName.get(origFood);
            const hasUsda = it.usda_id != null && it.usda_id !== '';
            const [fromSaved, fromUsda] = await Promise.all([
              saved ? withUsdaPortions({ ...saved, source: 'saved' }) : null,
              hasUsda ? api.usdaFood(it.usda_id).then((f) => ({ ...f, source: 'usda' })).catch(() => null) : null,
            ]);
            if (row._food || foodIn.value.trim().toLowerCase() !== origFood) return;
            const portionFor = (food) => (portionOptions(food).some((p) => p.label === it.portion) ? it.portion : defaultPortion(food));
            const candidates = [fromSaved, fromUsda].filter(Boolean).map((food) => ({ food, portion: portionFor(food) }));
            const loggedQty = it.qty === '' || it.qty == null || !Number.isFinite(Number(it.qty)) ? 1 : Number(it.qty);
            const logged = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, it[k]]));
            const match = bestMatch(logged, candidates, loggedQty);
            if (!match) return;
            for (const k of match.typed) dirty.add(k);
            row._food = match.food;
            showPortions(match.food, match.portion);
            // The qty may have changed while the food loaded; bring the other fields in line.
            if ($('qty').value.trim() !== '' && Number($('qty').value) !== loggedQty) refill();
          })();
        }
      };
      items.forEach(addRow);
      box.querySelector('[data-add]').addEventListener('click', () => addRow());
      return () => ({
        remember: box.querySelector('[name=remember]').checked,
        items: [...wrap.querySelectorAll('.item-row:not(.head)')].map((row) => {
          const get = (k) => row.querySelector(`[data-k=${k}]`).value.trim();
          const n = (k) => (get(k) === '' ? null : Number(get(k)));
          const meta = row._food ? itemMeta(row._food, get('portion')) : {};
          const item = { ...(row._orig || {}), ...meta, food: get('food'), qty: n('qty'), net_carbs: n('net_carbs'), protein: n('protein'), fiber: n('fiber'), fat: n('fat'), kcal: n('kcal') };
          if (row._food) picked.set(item, { food: row._food, portion: get('portion'), dirty: new Set(row._dirty) });
          return item;
        }),
      });
    },
  });
}

export function readingForm(date, entry, done) {
  const type = entry?.type || 'glucose';
  const fields = [
    { name: 'time', label: 'Time', type: 'time', default: nowTime() },
    { name: 'type', label: 'Reading', type: 'select', options: [['glucose', 'Blood sugar (mg/dL)'], ['bp', 'Blood pressure'], ['ketones', 'Ketones (mmol/L)']] },
    { name: 'context', label: 'When (blood sugar)', type: 'select', options: [['fasting', 'Fasting'], ['1h-after', '1 hour after a meal'], ['2h-after', '2 hours after a meal'], ['bedtime', 'Bedtime'], ['other', 'Other']] },
    { name: 'value', label: 'Value (blood sugar or ketones)', type: 'number', step: '0.1' },
    { name: 'systolic', label: 'Systolic (top number)', type: 'number' },
    { name: 'diastolic', label: 'Diastolic (bottom number)', type: 'number' },
    { name: 'pulse', label: 'Pulse', type: 'number' },
  ];
  openForm({
    title: entry ? 'Edit reading' : 'Add reading',
    fields,
    values: entry || { type },
    onDelete: entry && deleteEntry(date, 'readings', entry, done),
    onSave: (v) => {
      if (v.type === 'bp' && (v.systolic == null || v.diastolic == null)) throw new Error('Enter both blood pressure numbers.');
      if (v.type !== 'bp' && v.value == null) throw new Error('Enter the reading.');
      const clean = v.type === 'bp'
        ? { time: v.time, type: 'bp', systolic: v.systolic, diastolic: v.diastolic, pulse: v.pulse }
        : { time: v.time, type: v.type, value: v.value, ...(v.type === 'glucose' ? { context: v.context } : {}) };
      return saveEntry(date, 'readings', entry, clean, done, 'Reading');
    },
  });
}

// Walks live here. Choosing "Workout" (or opening a logged workout) hands over to workoutForm,
// so there is one set editor.
export function activityForm(date, entry, done, walkMinutes = 10) {
  if (entry && entry.type === 'workout') return workoutForm(date, entry, done);
  const form = openForm({
    title: entry ? 'Edit activity' : 'Add walk or workout',
    fields: [
      { name: 'time', label: 'Time', type: 'time', default: nowTime() },
      ...(entry && entry.type ? [] : [{ name: 'type', label: 'Type', type: 'select', options: [['walk', 'Walk'], ['workout', 'Workout']] }]),
      { name: 'after', label: 'Walk after', type: 'select', options: [['', '—'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']] },
      { name: 'minutes', label: 'Minutes', type: 'number', default: walkMinutes },
    ],
    values: entry || {},
    onDelete: entry && deleteEntry(date, 'activity', entry, done),
    onSave: (v) => {
      // Keep whatever else the entry carries; only the fields on this form change.
      const out = { ...(entry || {}), time: v.time, type: 'walk', minutes: v.minutes };
      delete out.id;
      if (v.after) out.after = v.after; else delete out.after;
      return saveEntry(date, 'activity', entry, out, done, 'Activity');
    },
  });
  form.elements.type?.addEventListener('change', async () => {
    if (form.elements.type.value !== 'workout') return;
    if (!(await workoutForm(date, entry, done))) form.elements.type.value = 'walk';
  });
  return undefined;
}

const blankSet = { reps: null, seconds: null, weight_lb: null, done: false, extra: {}, hint: {} };
const hasContent = (groups) => groups.some((g) => !('kept' in g) && (g.move || g.rows.some((r) => r.reps != null || r.seconds != null || r.weight_lb != null)));

// A workout with sets. `program` (an object) and `routine` (a name) pre-fill it from the active program.
export async function workoutForm(date, entry, done, { program, routine } = {}) {
  const loaded = await load(async () => ({
    programs: await api.items('programs').catch(() => []),
    library: await api.doc('workouts').catch(() => ({})),
    goals: await api.doc('goals').catch(() => ({})),
  }));
  if (!loaded) return false;
  const { library, goals } = loaded;
  const good = loaded.programs.filter((p) => p && !p.broken);
  const choices = [];
  for (const p of good) {
    for (const r of Array.isArray(p.routines) ? p.routines : []) {
      const found = r && findRoutine(r.name, p, null);
      if (found) choices.push({ label: `${found.name} (${p.name})`, routine: found, program: p });
    }
  }
  for (const r of library && Array.isArray(library.routines) ? library.routines : []) {
    const found = r && findRoutine(r.name, null, library);
    if (found) choices.push({ label: `${found.name} (library)`, routine: found, program: null });
  }
  const startProgram = entry ? good.find((p) => p.name === entry.program) : program;
  const pre = !entry && routine ? findRoutine(routine, startProgram, library) : null;
  let groups = splitSets(entry ? entry.sets : pre ? prefillSets(pre) : []);
  // The program a new entry is tagged with: the chosen routine's program, if that is the active one.
  let chosenProgram = pre ? startProgram || null : null;
  const moveNames = [...new Set([
    ...(library && Array.isArray(library.moves) ? library.moves : []).map((m) => m && m.name),
    ...choices.flatMap((c) => c.routine.moves.map((m) => m.move)),
  ].filter(Boolean))];
  let readSets = () => [];

  openForm({
    title: entry ? 'Edit workout' : 'Log a workout',
    fields: [
      { name: 'time', label: 'Time', type: 'time', default: nowTime() },
      { name: 'name', label: 'Workout name', type: 'text' },
      { name: 'minutes', label: 'Minutes', type: 'number' },
      { name: 'details', label: 'Notes (optional)', type: 'textarea' },
    ],
    values: entry || { name: pre ? pre.name : routine || '' },
    onDelete: entry && deleteEntry(date, 'activity', entry, done),
    onSave: (v) => {
      const sets = readSets();
      const editable = sets.filter((s) => isEditableSet(s));
      if (editable.length && !editable.some((s) => s.done !== false) && !confirm('No sets are marked done. Save anyway?')) throw new Error('Not saved: no sets are marked done.');
      // Spread the entry first so fields this form doesn't show (program, week, anything an AI tool added) survive.
      const clean = { ...(entry || {}), time: v.time, type: 'workout', name: v.name || 'Workout', minutes: v.minutes, details: v.details, sets };
      delete clean.id;
      if (!entry && chosenProgram) {
        clean.program = chosenProgram.name;
        const pos = programPosition(chosenProgram, goals.program_start, date);
        if (pos.state === 'active') clean.week = pos.week;
      }
      return saveEntry(date, 'activity', entry, clean, done, 'Workout');
    },
    extra: (box, form) => {
      box.innerHTML = `<datalist id="move-list">${moveNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <label${entry ? ' hidden' : ''}>From routine<select data-routine><option value="">— none —</option>${choices.map((c, i) => `<option value="${i}">${esc(c.label)}</option>`).join('')}</select></label>
        <div class="btns"><button type="button" data-all-done>Mark all done</button></div>
        <div class="wk-sets"></div>
        <div class="btns"><button type="button" data-add-move>+ Move</button></div>`;
      const wrap = box.querySelector('.wk-sets');
      const sel = box.querySelector('[data-routine]');
      const num = (el) => {
        const n = el.value.trim() === '' ? null : Number(el.value);
        return n === null || Number.isNaN(n) ? null : Math.max(0, n);
      };
      const sync = () => {
        const old = groups;
        groups = [...wrap.querySelectorAll('.wk-group')].map((g) => {
          if (g.dataset.kept !== undefined) return old[Number(g.dataset.g)];
          return {
            move: g.querySelector('[data-k=move]').value.trim(),
            rows: [...g.querySelectorAll('.wk-row:not(.head)')].map((r) => ({
              reps: num(r.querySelector('[data-k=reps]')),
              seconds: num(r.querySelector('[data-k=seconds]')),
              weight_lb: num(r.querySelector('[data-k=weight_lb]')),
              done: r.querySelector('[data-k=done]').checked,
              extra: JSON.parse(r.dataset.extra || '{}'),
              hint: JSON.parse(r.dataset.hint || '{}'),
            })),
          };
        });
      };
      // Per-set extras (notes, rpe, side...) ride along on the row, so nothing the form can't show is lost.
      const rowHtml = (r) => `<div class="item-row wk-row" data-extra="${esc(JSON.stringify(r.extra || {}))}" data-hint="${esc(JSON.stringify(r.hint || {}))}">
          <input data-k="reps" type="number" min="0" placeholder="${esc((r.hint && r.hint.reps) || 'reps')}" aria-label="Reps" value="${esc(r.reps)}">
          <input data-k="seconds" type="number" min="0" placeholder="${esc((r.hint && r.hint.seconds) || 'sec')}" aria-label="Seconds" value="${esc(r.seconds)}">
          <input data-k="weight_lb" type="number" min="0" step="0.5" placeholder="${esc((r.hint && r.hint.weight_lb) || 'lb')}" aria-label="Weight in pounds" value="${esc(r.weight_lb)}">
          <label class="check"><input type="checkbox" data-k="done"${r.done ? ' checked' : ''}> done</label>
          <button type="button" data-rm-set title="Remove set" aria-label="Remove set">✕</button></div>`;
      const keptHtml = (g, gi) => `<div class="wk-group" data-g="${gi}" data-kept>
          <div class="item-row kept"><input disabled aria-label="Kept as is" value="${esc(`Kept as is: ${typeof g.kept === 'string' ? g.kept : JSON.stringify(g.kept)}`)}"></div></div>`;
      const draw = () => {
        wrap.innerHTML = groups.map((g, gi) => ('kept' in g ? keptHtml(g, gi) : `<div class="wk-group" data-g="${gi}">
          <div class="item-row routine-head"><input data-k="move" list="move-list" placeholder="Move" aria-label="Move" value="${esc(g.move)}"><button type="button" data-rm-move title="Remove move" aria-label="Remove move">✕</button></div>
          <div class="item-row wk-row head"><span>reps</span><span>sec</span><span>lb</span><span>done</span><span></span></div>
          ${g.rows.map(rowHtml).join('')}
          <div class="btns"><button type="button" data-add-set>+ Set</button></div></div>`)).join('');
      };
      box.addEventListener('click', (ev) => {
        const t = ev.target.closest('button');
        if (!t) return;
        const g = t.closest('.wk-group');
        if (t.matches('[data-all-done]')) {
          wrap.querySelectorAll('[data-k=done]').forEach((c) => { c.checked = true; });
        } else if (t.matches('[data-add-move]')) {
          sync();
          groups.push({ move: '', rows: [{ ...blankSet }] });
          draw();
        } else if (t.matches('[data-add-set]')) {
          sync();
          const grp = groups[Number(g.dataset.g)];
          const last = grp.rows[grp.rows.length - 1] || blankSet;
          grp.rows.push({ reps: last.reps, seconds: last.seconds, weight_lb: last.weight_lb, done: false, extra: {}, hint: last.hint || {} });
          draw();
        } else if (t.matches('[data-rm-set]')) {
          sync();
          const grp = groups[Number(g.dataset.g)];
          grp.rows.splice([...g.querySelectorAll('.wk-row:not(.head)')].indexOf(t.closest('.wk-row')), 1);
          groups = groups.filter((x) => 'kept' in x || x.rows.length);
          draw();
        } else if (t.matches('[data-rm-move]')) {
          sync();
          groups.splice(Number(g.dataset.g), 1);
          draw();
        }
      });
      let prevChoice = '';
      sel.addEventListener('change', () => {
        const c = choices[Number(sel.value)];
        if (!c) { prevChoice = ''; return; }
        sync();
        if (hasContent(groups) && !confirm('Replace the sets below with this routine?')) {
          sel.value = prevChoice;
          return;
        }
        prevChoice = sel.value;
        groups = splitSets(prefillSets(c.routine));
        chosenProgram = c.program && ((startProgram && c.program.name === startProgram.name) || c.program.id === goals.program) ? c.program : null;
        form.elements.name.value = c.routine.name;
        draw();
      });
      if (pre) {
        const i = choices.findIndex((c) => c.routine.name === pre.name && (c.program ? c.program.name : null) === (startProgram ? startProgram.name : null));
        const j = i >= 0 ? i : choices.findIndex((c) => c.routine.name === pre.name);
        if (j >= 0) {
          sel.value = String(j);
          prevChoice = String(j);
        }
      }
      draw();
      readSets = () => {
        sync();
        return joinSets(groups);
      };
      return () => ({});
    },
  });
  return true;
}

// A GLP-1 shot. Medication and dose start from the Settings values; a new shot
// starts on the next site in the rotation.
export async function shotForm(date, entry, done) {
  let values = entry || {};
  let sites = SITES;
  let days = [];
  if (entry) {
    if (entry.site && !SITES.some(([v]) => v === entry.site)) sites = [...SITES, [entry.site, entry.site]];
  } else {
    const glp1 = await load(() => api.doc('glp1'));
    if (!glp1) return;
    // Suggest the site after the last earlier shot (including this day), so backfilling works.
    days = (await load(() => api.days(addDays(date, -365), date))) || [];
    values = { medication: glp1.medication || '', dose_mg: glp1.dose_mg ?? '', site: suggestSite(days, { date, time: nowTime() }) };
  }
  const form = openForm({
    title: entry ? 'Edit shot' : 'Log a shot',
    fields: [
      { name: 'time', label: 'Time', type: 'time', default: nowTime() },
      { name: 'medication', label: 'Medication', type: 'text' },
      { name: 'dose_mg', label: 'Dose (mg)', type: 'number', step: '0.25', min: '0' },
      { name: 'site', label: 'Injection site', type: 'select', options: sites },
      { name: 'side_effects', label: 'Side effects', type: 'tags', options: SIDE_EFFECTS },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    values,
    onDelete: entry && deleteEntry(date, 'shots', entry, done),
    onSave: (v) => {
      if (v.dose_mg != null && !(v.dose_mg >= 0)) throw new Error('Dose can\'t be below 0.');
      return saveEntry(date, 'shots', entry, v, done, 'Shot');
    },
  });
  if (!entry) {
    // Re-suggest the site when the time changes, unless the site was picked by hand.
    let touched = false;
    form.elements.site.addEventListener('change', () => { touched = true; });
    const retime = () => {
      if (!touched && form.elements.time.value) form.elements.site.value = suggestSite(days, { date, time: form.elements.time.value });
    };
    form.elements.time.addEventListener('input', retime);
    form.elements.time.addEventListener('change', retime);
  }
}

export async function noteForm(date, entry, done) {
  const m = await load(meta);
  if (!m) return;
  const { symptomTags } = m;
  openForm({
    title: entry ? 'Edit note' : 'New note',
    fields: [
      { name: 'time', label: 'Time', type: 'time', default: nowTime() },
      { name: 'mood', label: 'Mood (1 low – 5 great)', type: 'rating' },
      { name: 'tags', label: 'Symptoms and feelings', type: 'tags', options: symptomTags },
      { name: 'text', label: 'Note', type: 'textarea', placeholder: 'How are you feeling? Anything worth remembering?' },
    ],
    values: entry || {},
    onDelete: entry && deleteEntry(date, 'notes', entry, done),
    onSave: (v) => {
      if (!v.text && !v.tags.length && v.mood == null) throw new Error('Write something, pick a mood, or tap a tag.');
      return saveEntry(date, 'notes', entry, v, done, 'Note');
    },
  });
}

// Weight, water, sleep, daily ratings, symptoms and hormonal notes.
export async function dayStatsForm(date, data, done) {
  const m = await load(meta);
  if (!m) return;
  const { symptomTags } = m;
  const r = data.ratings || {};
  const hz = data.hormonal || {};
  openForm({
    title: 'Day check-in',
    fields: [
      { name: 'weight', label: 'Weight (lb)', type: 'number', step: '0.1' },
      { name: 'water_oz', label: 'Water (oz)', type: 'number' },
      { name: 'sleep_hours', label: 'Sleep (hours)', type: 'number', step: '0.25' },
      { name: 'hunger', label: 'Hunger (1 none – 5 starving)', type: 'rating' },
      { name: 'cravings', label: 'Cravings (1 none – 5 strong)', type: 'rating' },
      { name: 'energy', label: 'Energy', type: 'rating' },
      { name: 'mood', label: 'Mood', type: 'rating' },
      { name: 'sleep', label: 'Sleep quality', type: 'rating' },
      { name: 'digestion', label: 'Digestion (1 rough – 5 great)', type: 'rating' },
      { name: 'symptoms', label: 'Symptoms today', type: 'tags', options: symptomTags },
      { name: 'hot_flashes', label: 'Hot flashes (count)', type: 'number' },
      { name: 'cycle', label: 'Cycle', type: 'select', options: [['', '—'], ['period', 'Period'], ['spotting', 'Spotting'], ['none', 'None']] },
    ],
    values: { ...data, ...r, hot_flashes: hz.hot_flashes, cycle: hz.cycle },
    onSave: (v) => attempt(async () => {
      await api.patchDay(date, {
        weight: v.weight,
        water_oz: v.water_oz,
        sleep_hours: v.sleep_hours,
        ratings: { hunger: v.hunger, cravings: v.cravings, energy: v.energy, mood: v.mood, sleep: v.sleep, digestion: v.digestion },
        symptoms: v.symptoms.map(slug),
        hormonal: { hot_flashes: v.hot_flashes, cycle: v.cycle },
      });
      done();
    }, 'Check-in saved'),
  });
}
