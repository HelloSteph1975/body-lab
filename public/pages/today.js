import { api } from '../api.js';
import { activityForm, dayStatsForm, mealForm, noteForm, readingForm, shotForm, workoutForm } from '../entries.js';
import { siteLabel } from '../glp1.js';
import { openForm } from '../forms.js';
import {
  ateThisEntry, dietFlags, effectiveRules, plannedKey, planListProblem, recipeIndex, SLOT_LABELS, SLOT_TIMES, SLOTS,
} from '../meals.js';
import { effectiveWalkMinutes, isWorkoutDone, mondayOf, programPosition, scheduledRoutine } from '../programs.js';
import {
  addDays, attempt, esc, isoDate, nowTime, prettyDate, shortDate, toast,
} from '../util.js';

const MEAL_NAMES = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const SLOT_ORDER = ['morning', 'pre-lunch', 'meals', 'any'];

function timeline(d, withShots, rules) {
  const rows = [];
  for (const m of d.meals || []) {
    const carbs = (m.items || []).reduce((s, i) => s + (i.net_carbs || 0), 0);
    // Same rule as metrics.js num(): only a finite number counts.
    const kcal = Math.round((m.items || []).reduce((s, i) => s + (typeof i.kcal === 'number' && Number.isFinite(i.kcal) ? i.kcal : 0), 0));
    const flags = dietFlags(m, rules);
    rows.push({ list: 'meals', e: m, what: `${MEAL_NAMES[m.kind] || 'Meal'} · ${(m.items || []).map((i) => i.food).join(', ')}`, sub: `${Math.round(carbs * 10) / 10} g net carbs${kcal ? ` · ${kcal} kcal` : ''}`, flags });
  }
  for (const r of d.readings || []) {
    const what = r.type === 'bp' ? `Blood pressure ${r.systolic}/${r.diastolic}` : r.type === 'ketones' ? `Ketones ${r.value}` : `Blood sugar ${r.value}`;
    rows.push({ list: 'readings', e: r, what, sub: r.context || '' });
  }
  for (const a of d.activity || []) {
    rows.push({ list: 'activity', e: a, what: a.type === 'walk' ? `Walk ${a.minutes || 0} min` : a.name || 'Workout', sub: a.after ? `after ${a.after}` : a.details || '' });
  }
  for (const s of withShots ? d.shots || [] : []) {
    const effects = (s.side_effects || []).filter((e) => e !== 'none');
    rows.push({ list: 'shots', e: s, what: `Shot · ${s.medication || 'GLP-1'}${s.dose_mg != null ? ` ${s.dose_mg} mg` : ''}`, sub: [siteLabel(s.site), ...effects].filter(Boolean).join(' · ') });
  }
  for (const n of d.notes || []) {
    rows.push({ list: 'notes', e: n, what: n.text || '(note)', sub: [n.mood ? `mood ${n.mood}/5` : '', ...(n.tags || [])].filter(Boolean).join(' · ') });
  }
  return rows.sort((a, b) => String(a.e.time || '').localeCompare(String(b.e.time || '')));
}

export async function render(main, { arg, refresh }) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : isoDate();
  const [day, plan, goals, meta, glp1, programs, mealPlan, rawRecipes, rawDiets, foods] = await Promise.all([api.day(date), api.doc('supplements'), api.doc('goals'), api.meta(), api.doc('glp1').catch(() => ({ enabled: false })), api.items('programs').catch(() => []),
    api.mealPlan(mondayOf(date)).catch((e) => ({ error: e.message })), api.items('recipes').catch(() => []), api.items('diets').catch(() => []), api.items('foods').catch(() => [])]);
  const go = (d) => { location.hash = `#/today/${d}`; };

  if (day.broken) {
    main.innerHTML = `<div class="card error"><h2>This day's note can't be read</h2>
      <p>Days/${esc(date)}.md was changed outside the app and no longer reads correctly, so Body Lab won't overwrite it.
      Open it in Notepad and fix the top section, or ask Claude to repair it.</p><p class="muted">${esc(day.broken)}</p></div>`;
    return;
  }
  const d = day.data;
  const t = day.totals;
  const supps = d.supplements || {};
  const recipes = (Array.isArray(rawRecipes) ? rawRecipes : []).filter((r) => r && !r.broken);
  const dietList = (Array.isArray(rawDiets) ? rawDiets : []).filter((x) => x && !x.broken);
  const baseDiet = dietList.find((x) => goals.diet && x.id === goals.diet) || null;
  const addOn = dietList.find((x) => goals.diet_add_on && x.id === goals.diet_add_on) || null;
  const rules = { ...effectiveRules(baseDiet, addOn, goals.eating_window), foods: Array.isArray(foods) ? foods : [], recipes };
  const rows = timeline(d, glp1.enabled, rules);
  const planItems = plan.items || [];
  const program = programs.find((p) => p.id === goals.program && !p.broken);
  const routine = program ? scheduledRoutine(program, goals.program_start, date) : null;
  const week = routine ? programPosition(program, goals.program_start, date).week : null;
  const walkMin = effectiveWalkMinutes(goals, program, date).minutes;
  const workoutDone = !!routine && (d.activity || []).some((a) => a && a.type === 'workout' && (a.name === routine || a.program === program.name) && isWorkoutDone(a));
  const workoutCard = routine ? `<section class="card"><h2>${date === isoDate() ? "Today's workout" : `Workout for ${esc(shortDate(date))}`} · ${esc(routine)}</h2>
          <p>${esc(program.name)} · Week ${esc(week)}</p>
          ${workoutDone ? '<p class="mint"><b>Done ✓</b></p>' : '<div class="btns"><button class="primary" data-start-workout>Start</button></div>'}
        </section>` : '';
  const idx = recipeIndex(recipes);
  const planError = mealPlan && mealPlan.error ? mealPlan.error : mealPlan ? planListProblem(mealPlan) : null;
  const planned = (mealPlan && !planError && Array.isArray(mealPlan.meals) ? mealPlan.meals : []).filter((m) => m && typeof m === 'object' && m.date === date)
    .sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  const eaten = new Set((d.meals || []).map((m) => m.planned_id).filter(Boolean));
  const plannedCard = planError ? `<section class="card error"><h2>Planned today</h2><p>${esc(planError)}</p></section>` : planned.length ? `<section class="card"><h2>Planned today</h2><ul class="list">${planned.map((m, i) => {
    const rec = idx.get(String(m.recipe ?? '').trim().toLowerCase());
    const n = Number(m.servings) > 0 ? Number(m.servings) : 1;
    const carbs = rec ? Math.round((Number(rec.per_serving?.net_carbs) || 0) * n * 10) / 10 : null;
    const label = `${SLOT_LABELS[m.slot] || 'Meal'} · ${m.recipe} ×${n}${carbs !== null ? ` · ${carbs} g net carbs` : ''}`;
    const action = !rec ? '<span class="muted">Recipe missing</span>' : eaten.has(plannedKey(m)) ? '<span class="mint"><b>Eaten ✓</b></span>' : `<button class="primary" data-ate="${i}">Ate this</button>`;
    return `<li><span class="what">${esc(label)}</span> ${action}</li>`;
  }).join('')}</ul></section>` : '';
  const slotOf = (i) => (SLOT_ORDER.includes(i.slot) ? i.slot : 'any');
  const slots = SLOT_ORDER.map((s) => [s, planItems.filter((i) => slotOf(i) === s)]).filter(([, list]) => list.length);

  main.innerHTML = `
    <div class="head">
      <button data-go="${addDays(date, -1)}" title="Previous day">◀</button>
      <h1>${esc(prettyDate(date))}</h1>
      <button data-go="${addDays(date, 1)}" title="Next day">▶</button>
      ${date !== isoDate() ? `<button data-go="${isoDate()}">Today</button>` : ''}
      <span class="grow"></span>
      <div class="btns">
        <button class="primary" data-add="meal">+ Meal</button>
        <button data-add="activity">+ Walk / Workout</button>
        <button data-add="reading">+ Reading</button>
        ${glp1.enabled ? '<button data-add="shot">+ Shot</button>' : ''}
        <button data-add="note">+ Note</button>
        <button data-add="stats">Check-in</button>
      </div>
    </div>
    <div class="grid today-grid">
      <section class="card"><h2>Timeline</h2>
        ${rows.length ? `<ul class="list">${rows.map((r, i) => `<li data-row="${i}"><span class="time">${esc(r.e.time || '')}</span><span class="what">${esc(r.what)}<br>${r.flags?.length ? `<small class="pink">⚠ ${esc(r.flags.join(' · '))}</small><br>` : ''}<small class="muted">${esc(r.sub)}</small></span></li>`).join('')}</ul>`
          : '<p class="muted">Nothing logged yet. Use the buttons above.</p>'}
      </section>
      <div class="grid">
        ${workoutCard}
        ${plannedCard}
        <section class="card"><h2>Totals</h2>
          <p>Net carbs <b class="${goals.net_carb_max != null && t.net_carbs > goals.net_carb_max ? 'warn' : 'pink'}">${t.net_carbs} g</b> / ${esc(goals.net_carb_max ?? '—')} ·
             Protein <b class="purple">${t.protein} g</b> / ${esc(goals.protein_min ?? '—')} ·
             Fiber <b class="blue">${t.fiber} g</b> / ${esc(goals.fiber_min ?? '—')} ·
             Fat <b>${esc(t.fat ?? 0)} g</b> · <b>${esc(t.kcal ?? 0)}</b> kcal</p>
          <p>Walks <b class="blue">${t.walks}</b> / ${esc(goals.walks_per_day ?? '—')} (${t.walk_minutes} min)${walkMin ? ` · goal ${esc(walkMin)} min each` : ''} ·
             Weight <b>${esc(d.weight ?? '—')}</b> · Water <b>${esc(d.water_oz ?? '—')}</b> oz · Sleep <b>${esc(d.sleep_hours ?? '—')}</b> h</p>
          ${(d.symptoms || []).length ? `<p>${d.symptoms.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</p>` : ''}
        </section>
        <section class="card"><h2>Supplements · ${t.supps_done}/${t.supps_total}</h2>
          ${(plan.items || []).length ? '' : '<p class="muted">No supplements yet. Add yours in <a href="#/library/supplements">Library</a>.</p>'}
          ${slots.map(([s, list]) => `<div class="slot">${esc(meta.slots[s] || s)}</div>${list.map((i) => `<label class="check"><input type="checkbox" data-supp="${esc(i.key)}"${supps[i.key] ? ' checked' : ''}> ${esc(i.name)} <small class="muted">${esc(i.dose || '')}</small></label>`).join('')}`).join('')}
        </section>
      </div>
    </div>`;

  const done = () => refresh();
  main.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  const adders = {
    meal: () => mealForm(date, null, done),
    activity: () => activityForm(date, null, done, walkMin || 10),
    reading: () => readingForm(date, null, done),
    shot: () => shotForm(date, null, done),
    note: () => noteForm(date, null, done),
    stats: () => dayStatsForm(date, d, done),
  };
  main.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', adders[b.dataset.add]));
  const editors = { meals: mealForm, readings: readingForm, activity: activityForm, notes: noteForm, shots: shotForm };
  main.querySelectorAll('[data-row]').forEach((li) => li.addEventListener('click', () => {
    const r = rows[Number(li.dataset.row)];
    editors[r.list](date, r.e, done);
  }));
  // Ate this logs once: the button is disabled while saving, and a planned meal already logged
  // (matched by plannedKey) shows Eaten instead. A past day asks for the time it was eaten.
  const logPlanned = async (m, time) => {
    const entry = ateThisEntry(m, idx.get(String(m.recipe ?? '').trim().toLowerCase()), time);
    if (!entry) throw new Error('Recipe missing');
    await api.addEntry(date, 'meals', entry);
  };
  main.querySelectorAll('[data-ate]').forEach((b) => b.addEventListener('click', () => {
    const m = planned[Number(b.dataset.ate)];
    if (b.disabled) return;
    if (date < isoDate()) {
      openForm({
        title: `When did you eat ${m.recipe}?`,
        fields: [{ name: 'time', label: 'Time', type: 'time', required: true, default: SLOT_TIMES[m.slot] || '12:00' }],
        onSave: async (v) => {
          await logPlanned(m, v.time);
          toast('Logged');
          refresh();
        },
      });
      return;
    }
    b.disabled = true;
    attempt(async () => {
      await logPlanned(m, nowTime());
      refresh();
    }, 'Logged').catch(() => { b.disabled = false; });
  }));
  main.querySelector('[data-start-workout]')?.addEventListener('click', () => workoutForm(date, null, done, { program, routine }));
  main.querySelectorAll('[data-supp]').forEach((box) => box.addEventListener('change', () => attempt(async () => {
    await api.patchDay(date, { supplements: { [box.dataset.supp]: box.checked } });
    refresh();
  })));
}
