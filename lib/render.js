'use strict';
// Readable note bodies. The frontmatter is the data; these bodies are rebuilt
// on every save so the note reads well in Notepad or Obsidian.
const { mealTotals } = require('./metrics');

const byTime = (a, b) => String(a.time || '').localeCompare(String(b.time || ''));
const sorted = (list) => [...(list || [])].sort(byTime);
const REBUILT = '> Written by Body Lab. Change things in the app; this text is rebuilt on every save.';
const SLOTS = { morning: 'Morning', 'pre-lunch': 'Before lunch', meals: 'With meals', any: 'Any time' };
const GOAL_LABELS = [
  ['ideal_weight', 'Ideal weight (lb)'],
  ['net_carb_max', 'Net carbs, most per day (g)'],
  ['protein_min', 'Protein, least per day (g)'],
  ['fiber_min', 'Fiber, least per day (g)'],
  ['water_oz', 'Water per day (oz)'],
  ['walks_per_day', 'Walks per day'],
  ['walk_minutes', 'Minutes per walk'],
  ['next_checkup', 'Next checkup'],
  ['program', 'Active program'],
  ['program_start', 'Program start'],
  ['diet', 'Diet'],
  ['diet_add_on', 'Diet add-on'],
];
const DOC_TITLES = { goals: 'Goals', phases: 'Experiment phases', supplements: 'Supplement plan', workouts: 'Workouts', glp1: 'GLP-1 tracking' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SITES = { 'belly-left': 'Belly, left', 'belly-right': 'Belly, right', 'thigh-left': 'Thigh, left', 'thigh-right': 'Thigh, right', 'arm-left': 'Arm, left', 'arm-right': 'Arm, right' };

function describeReading(r) {
  if (r.type === 'bp') return `Blood pressure ${r.systolic}/${r.diastolic}${r.pulse ? `, pulse ${r.pulse}` : ''}`;
  if (r.type === 'ketones') return `Ketones ${r.value} mmol/L`;
  return `Blood sugar ${r.value} mg/dL${r.context ? ` (${r.context})` : ''}`;
}

function describeActivity(a) {
  if (a.type === 'walk') return `Walk ${a.minutes || 0} min${a.after ? ` after ${a.after}` : ''}`;
  const sets = describeSets(a.sets);
  return `${a.name || 'Workout'}${a.minutes ? ` ${a.minutes} min` : ''}${sets ? `: ${sets}` : ''}${a.details ? ` (${a.details})` : ''}`;
}

// Done sets only, grouped by move in first-seen order: "Squat 10, 8 @ 20 lb; Plank 20 s".
function describeSets(sets) {
  const groups = new Map();
  for (const s of Array.isArray(sets) ? sets : []) {
    if (!s || typeof s !== 'object' || !s.move || s.done === false) continue;
    if (!groups.has(s.move)) groups.set(s.move, []);
    groups.get(s.move).push(s);
  }
  const parts = [];
  for (const [move, list] of groups) {
    const reps = list.filter((s) => typeof s.reps === 'number').map((s) => s.reps);
    const secs = list.filter((s) => typeof s.seconds === 'number').map((s) => s.seconds);
    const weights = list.filter((s) => typeof s.weight_lb === 'number' && s.weight_lb > 0).map((s) => s.weight_lb);
    const bits = [];
    if (reps.length) bits.push(reps.join(', '));
    if (secs.length) bits.push(`${secs.join(', ')} s`);
    parts.push(`${move}${bits.length ? ` ${bits.join(' ')}` : ''}${weights.length ? ` @ ${Math.max(...weights)} lb` : ''}`);
  }
  return parts.join('; ');
}

function describeShot(s) {
  const dose = s.dose_mg != null ? ` ${s.dose_mg} mg` : '';
  const effects = (s.side_effects || []).filter((e) => e !== 'none');
  return `Shot: ${s.medication || 'GLP-1'}${dose}${s.site ? `, ${SITES[s.site] || s.site}` : ''}${effects.length ? ` (${effects.join(', ')})` : ''}${s.notes ? ` - ${s.notes}` : ''}`;
}

function renderDay(date, d, planItems = []) {
  const out = [`# ${date}`, '', REBUILT, '', '## Summary'];
  if (d.weight != null) out.push(`- Weight: ${d.weight} lb`);
  const t = mealTotals(d.meals);
  out.push(`- Net carbs ${t.net_carbs} g · protein ${t.protein} g · fiber ${t.fiber} g · fat ${t.fat} g · ${t.kcal} kcal`);
  if (d.water_oz != null) out.push(`- Water: ${d.water_oz} oz`);
  if (d.sleep_hours != null) out.push(`- Sleep: ${d.sleep_hours} h`);
  const ratings = Object.entries(d.ratings || {}).filter(([, v]) => v != null);
  if (ratings.length) out.push(`- Ratings: ${ratings.map(([k, v]) => `${k} ${v}/5`).join(', ')}`);
  if (d.meals?.length) {
    out.push('', '## Meals');
    for (const m of sorted(d.meals)) out.push(`- ${m.time || ''} ${m.kind || 'meal'}: ${(m.items || []).map((i) => i.food).join(', ')}`);
  }
  if (d.readings?.length) {
    out.push('', '## Readings');
    for (const r of sorted(d.readings)) out.push(`- ${r.time || ''} ${describeReading(r)}`);
  }
  if (d.activity?.length) {
    out.push('', '## Activity');
    for (const a of sorted(d.activity)) out.push(`- ${a.time || ''} ${describeActivity(a)}`);
  }
  if (d.shots?.length) {
    out.push('', '## Shots');
    for (const s of sorted(d.shots)) out.push(`- ${s.time || ''} ${describeShot(s)}`);
  }
  if (planItems.length) {
    const s = d.supplements || {};
    out.push('', '## Supplements');
    for (const p of planItems) out.push(`- [${s[p.key] ? 'x' : ' '}] ${p.name}${p.dose ? ` (${p.dose})` : ''}`);
  }
  if (d.symptoms?.length) out.push('', '## Symptoms', `- ${d.symptoms.join(', ')}`);
  if (d.notes?.length) {
    out.push('', '## Journal');
    for (const n of sorted(d.notes)) {
      const tags = (n.tags || []).length ? ` #${n.tags.join(' #')}` : '';
      out.push(`- **${n.time || ''}**${n.mood ? ` mood ${n.mood}/5` : ''}${tags} ${n.text || ''}`);
    }
  }
  return `${out.join('\n')}\n`;
}

function renderDoc(name, d) {
  const out = [`# ${DOC_TITLES[name]}`, '', REBUILT, ''];
  if (name === 'goals') {
    for (const [k, label] of GOAL_LABELS) out.push(`- ${label}: ${d[k] ?? '—'}`);
    const w = d.eating_window;
    out.push(`- Eating window: ${w && typeof w === 'object' && w.start && w.end ? `${w.start}–${w.end}` : '—'}`);
  }
  if (name === 'phases') {
    for (const p of [...(d.phases || [])].sort((a, b) => a.date.localeCompare(b.date))) out.push(`- ${p.date}: ${p.label}`);
  }
  if (name === 'supplements') {
    for (const i of d.items || []) out.push(`- **${i.name}** ${i.dose || ''} (${SLOTS[i.slot] || i.slot || 'any time'})`);
  }
  if (name === 'glp1') {
    out.push(`- Tracking: ${d.enabled ? 'on' : 'off'}`, `- Medication: ${d.medication || '—'}`, `- Current dose: ${d.dose_mg != null ? `${d.dose_mg} mg` : '—'}`,
      `- Weekly shot day: ${WEEKDAYS[d.shot_day] || '—'}`);
  }
  if (name === 'workouts') {
    out.push('## Moves');
    for (const m of d.moves || []) out.push(`- ${m.name}${m.notes ? `: ${m.notes}` : ''}`);
    out.push('', '## Routines');
    for (const r of d.routines || []) out.push(`- **${r.name}**: ${(Array.isArray(r.moves) ? r.moves : []).map((m) => (typeof m === 'string' ? m : m && m.move)).filter(Boolean).join(', ')}`);
  }
  return `${out.join('\n')}\n`;
}

const LAB_ROWS = [
  ['a1c', 'A1C', '%'],
  ['fasting_glucose', 'Fasting glucose', 'mg/dL'],
  ['total_chol', 'Total cholesterol', 'mg/dL'],
  ['ldl', 'LDL', 'mg/dL'],
  ['hdl', 'HDL', 'mg/dL'],
  ['triglycerides', 'Triglycerides', 'mg/dL'],
];

const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (v === null || v === undefined ? '' : String(v));

function renderDiet(d) {
  const out = [`# ${text(d.name)}`, '', text(d.description), ''];
  const targets = [['net_carb_max', 'Net carbs, most (g)'], ['protein_min', 'Protein, least (g)'], ['fiber_min', 'Fiber, least (g)']]
    .filter(([k]) => typeof d[k] === 'number').map(([k, label]) => `- ${label}: ${d[k]}`);
  out.push(...targets);
  const w = d.eating_window;
  if (obj(w) && w.start && w.end) out.push(`- Eating window: ${w.start}–${w.end}`);
  for (const [k, label] of [['favor_tags', 'Favor'], ['avoid_tags', 'Avoid'], ['only_tags', 'Only'], ['avoid_words', 'Avoid words']]) {
    const items = list(d[k]).filter((x) => typeof x === 'string' && x);
    if (items.length) out.push(`- ${label}: ${items.join(', ')}`);
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function renderRecipe(d) {
  const out = [`# ${text(d.name)}`, ''];
  const bits = [];
  if (d.servings != null) bits.push(`Serves ${d.servings}`);
  if (d.prep_minutes != null) bits.push(`prep ${d.prep_minutes} min`);
  if (d.cook_minutes != null) bits.push(`cook ${d.cook_minutes} min`);
  if (bits.length) out.push(`${bits.join(' · ')}`, '');
  const diets = list(d.diets).filter((x) => typeof x === 'string' && x);
  if (diets.length) out.push(`Diets: ${diets.join(', ')}`, '');
  if (obj(d.per_serving)) {
    const p = d.per_serving;
    out.push(`Estimated per serving: net carbs ${p.net_carbs ?? '?'} g · protein ${p.protein ?? '?'} g · fiber ${p.fiber ?? '?'} g${p.fat != null ? ` · fat ${p.fat} g` : ''}${p.kcal != null ? ` · ${p.kcal} kcal` : ''} (estimates)`, '');
  }
  const ingredients = list(d.ingredients).filter(obj);
  if (ingredients.length) {
    out.push('## Ingredients');
    for (const i of ingredients) out.push(`- ${[i.amount, i.unit, i.item].filter((x) => x !== null && x !== undefined && x !== '').join(' ')}`);
    out.push('');
  }
  const steps = list(d.steps).filter((x) => x !== null && x !== undefined && x !== '');
  if (steps.length) {
    out.push('## Steps');
    steps.forEach((st, n) => out.push(`${n + 1}. ${text(st)}`));
    out.push('');
  }
  if (d.note) out.push(text(d.note), '');
  return `${out.join('\n').trimEnd()}\n`;
}

const SLOT_NAMES = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

function renderMealPlan(plan) {
  const p = obj(plan) ? plan : {};
  const out = [`# Meal plan: week of ${text(p.week_start)}`, '', REBUILT, ''];
  const byDate = new Map();
  for (const m of list(p.meals).filter(obj)) {
    const date = text(m.date) || 'No date';
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(m);
  }
  for (const date of [...byDate.keys()].sort()) {
    out.push(`## ${date}`);
    for (const m of byDate.get(date)) {
      out.push(`- ${(Object.hasOwn(SLOT_NAMES, m.slot) ? SLOT_NAMES[m.slot] : text(m.slot)) || 'Meal'}: ${text(m.recipe)}${m.servings != null && m.servings !== 1 ? ` ×${m.servings}` : ''}`);
    }
    out.push('');
  }
  const prep = list(p.prep).filter(obj);
  if (prep.length) {
    out.push('## Prep');
    for (const q of prep) out.push(`- ${text(q.date)}: ${text(q.notes) || 'Prep'} (${list(q.meal_ids).length} meal${list(q.meal_ids).length === 1 ? '' : 's'})`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function renderItem(collection, d) {
  if (collection === 'diets') return renderDiet(d);
  if (collection === 'recipes') return renderRecipe(d);
  if (collection === 'programs') {
    const out = [`# ${d.name}`, '', d.description || '', ''];
    for (const ph of list(d.phases).filter(obj)) {
      const days = Object.entries(obj(ph.days) ? ph.days : {}).map(([k, v]) => `${k} ${v}`).join(', ');
      out.push(`## ${ph.name || 'Phase'}: ${ph.weeks} week${ph.weeks === 1 ? '' : 's'}`, `- ${days}${ph.walk_minutes ? ` · walks ${ph.walk_minutes} min` : ''}`, '');
    }
    for (const r of list(d.routines).filter(obj)) {
      out.push(`### ${r.name}`);
      for (const m of list(r.moves)) {
        if (typeof m === 'string') { out.push(`- ${m}`); continue; }
        if (!obj(m)) continue;
        const amount = m.seconds ? `${m.seconds} s` : `${m.reps ?? '?'} reps`;
        out.push(`- ${m.move}: ${m.sets || 1} × ${amount}${m.weight_lb ? ` @ ${m.weight_lb} lb` : ''}${m.notes ? ` (${m.notes})` : ''}`);
      }
      out.push('');
    }
    return `${out.join('\n').trimEnd()}\n`;
  }
  if (collection === 'foods') {
    return `# ${d.name}\n\n- Serving: ${d.serving || '—'}\n- Net carbs ${d.net_carbs ?? 0} g · protein ${d.protein ?? 0} g · fiber ${d.fiber ?? 0} g\n`;
  }
  const rows = LAB_ROWS.filter(([k]) => d[k] != null && d[k] !== '').map(([k, label, unit]) => `| ${label} | ${d[k]} ${unit} |`);
  const extra = [d.other, d.notes].filter(Boolean).join('\n\n');
  return `# Labs ${d.date}\n\n| Test | Result |\n|---|---|\n${rows.join('\n')}\n${extra ? `\n${extra}\n` : ''}`;
}

module.exports = { renderDay, renderDoc, renderItem, renderMealPlan, describeShot, SLOTS, SITES, WEEKDAYS, GOAL_LABELS, LAB_ROWS };
