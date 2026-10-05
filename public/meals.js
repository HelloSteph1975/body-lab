// Pure meal-planning rules: no DOM, no fetch, so node:test can import them.
// Notes and AI tools write this data, so every collection is checked before use.

import { addDaysIso } from './programs.js';

export const FOOD_TAGS = ['meat', 'fish', 'eggs', 'dairy', 'vegetable', 'fruit', 'fruit-high-sugar', 'legume', 'grain', 'nut', 'seed', 'oil', 'sugar', 'processed', 'drink'];
export const SECTIONS = ['produce', 'meat & seafood', 'dairy & eggs', 'bakery', 'pantry', 'frozen', 'spices', 'other'];
export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const SLOT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
// Typical times, used when a planned meal is logged for a past day.
export const SLOT_TIMES = { breakfast: '08:00', lunch: '12:30', dinner: '18:30', snack: '15:00' };

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const objs = (v) => arr(v).filter((x) => x && typeof x === 'object' && !Array.isArray(x));
const strings = (v) => arr(v).filter((x) => typeof x === 'string');
const parseNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const num = (v) => { const n = parseNum(v); return n === null ? 0 : n; };
const servingsOf = (v) => { const n = parseNum(v); return n !== null && n > 0 ? n : 1; };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10;
const lower = (s) => (typeof s === 'string' || typeof s === 'number' ? String(s).trim().toLowerCase() : '');
const tagList = (v) => strings(v).map(lower).filter(Boolean);
// "cups" and "cup" are the same unit; very short units ("oz", "g") are left alone.
const unitKey = (u) => { const k = lower(u); return k.length > 2 ? k.replace(/s$/, '') : k; };

export function recipeIndex(recipes) {
  return new Map(objs(recipes).filter((r) => typeof r.name === 'string' && r.name.trim()).map((r) => [lower(r.name), r]));
}

export function shoppingList(plan, recipes) {
  const index = recipeIndex(recipes);
  const shopping = obj(obj(plan).shopping);
  const checked = new Set(strings(shopping.checked));
  const rows = new Map();
  const missing = [];
  const missingSeen = new Set();
  for (const meal of objs(obj(plan).meals)) {
    if (typeof meal.recipe !== 'string' || !meal.recipe.trim()) continue;
    const recipe = index.get(lower(meal.recipe));
    if (!recipe) {
      if (!missingSeen.has(lower(meal.recipe))) {
        missingSeen.add(lower(meal.recipe));
        missing.push(meal.recipe);
      }
      continue;
    }
    const scale = servingsOf(meal.servings) / servingsOf(recipe.servings);
    for (const ing of objs(recipe.ingredients)) {
      const item = lower(ing.item);
      if (!item) continue;
      const key = `${item}|${unitKey(ing.unit)}`;
      const row = rows.get(key) || { key, item, amount: 0, unit: String(ing.unit ?? ''), section: SECTIONS.includes(ing.section) ? ing.section : 'other', recipes: [], hasAmount: false };
      const amount = parseNum(ing.amount);
      if (amount !== null) {
        row.amount += amount * scale;
        row.hasAmount = true;
      }
      if (!row.recipes.includes(recipe.name)) row.recipes.push(recipe.name);
      rows.set(key, row);
    }
  }
  const sections = SECTIONS.map((section) => ({
    section,
    items: [...rows.values()]
      .filter((r) => r.section === section)
      .sort((a, b) => a.item.localeCompare(b.item))
      .map((r) => ({ key: r.key, item: r.item, amount: r.hasAmount ? round2(r.amount) : null, unit: r.unit, recipes: r.recipes.sort(), checked: checked.has(r.key) })),
  })).filter((s) => s.items.length);
  const extras = objs(shopping.extras).map((x) => ({ ...x }));
  return { sections, extras, missing };
}

export function plannedDayTotals(plan, recipes, date) {
  const index = recipeIndex(recipes);
  const t = { net_carbs: 0, protein: 0, fiber: 0, fat: 0, kcal: 0 };
  for (const meal of objs(obj(plan).meals)) {
    if (meal.date !== date) continue;
    const r = index.get(lower(meal.recipe));
    if (!r) continue;
    const s = servingsOf(meal.servings);
    const per = obj(r.per_serving);
    for (const k of Object.keys(t)) t[k] += num(per[k]) * s;
  }
  return { net_carbs: round1(t.net_carbs), protein: round1(t.protein), fiber: round1(t.fiber), fat: round1(t.fat), kcal: Math.round(t.kcal) };
}

// "8:00" and "08:00" both work. Anything that doesn't parse means no restriction.
const toMinutes = (t) => {
  const m = typeof t === 'string' ? /^\s*(\d{1,2}):(\d{2})/.exec(t) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
};

export function inWindow(time, win) {
  const w = obj(win);
  const t = toMinutes(time);
  const s = toMinutes(w.start);
  const e = toMinutes(w.end);
  if (t === null || s === null || e === null || s === e) return true;
  if (s < e) return t >= s && t <= e;
  return t >= s || t <= e;
}

function tagsFor(name, foods, recipes) {
  const key = lower(name);
  const food = objs(foods).find((f) => lower(f.name) === key);
  const foodTags = food ? tagList(food.tags) : [];
  if (foodTags.length) return foodTags;
  const recipe = recipeIndex(recipes).get(key);
  const recipeTags = recipe ? tagList(recipe.tags) : [];
  return recipeTags.length ? recipeTags : null;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);

export function dietFlags(meal, { diet, addOn, foods, recipes } = {}) {
  const rules = [diet, addOn].filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  const flags = new Set();
  const m = obj(meal);
  for (const r of rules) {
    if (r.eating_window && typeof r.eating_window === 'object' && !inWindow(m.time, r.eating_window)) {
      flags.add(`Eaten outside your eating window (${r.eating_window.start}–${r.eating_window.end}).`);
    }
  }
  for (const item of objs(m.items)) {
    const name = typeof item.food === 'string' ? item.food.trim() : '';
    if (!name) continue;
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    // Tags stored on the item (a food picked from USDA) plus the saved food's or recipe's, so a
    // food retagged in the library still counts for meals logged before.
    const both = [...new Set([...tagList(item.tags), ...(tagsFor(name, foods, recipes) || [])])];
    const tags = both.length ? both : null;
    for (const r of rules) {
      const dietName = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : '';
      const avoidList = dietName ? `the ${dietName} avoid list` : "your diet's avoid list";
      if (tags) {
        const avoid = tagList(r.avoid_tags);
        const bad = tags.find((t) => avoid.includes(t));
        if (bad) { flags.add(`${label}: ${bad} is on ${avoidList}.`); continue; }
        const only = tagList(r.only_tags);
        if (only.length) {
          const outside = tags.find((t) => !only.includes(t));
          if (outside) flags.add(`${label}: ${outside} isn't part of ${dietName || 'your diet'}.`);
        }
      } else {
        // An untagged item can't be checked against only_tags, so say so gently.
        if (tagList(r.only_tags).length) flags.add(`${label}: not tagged, so Body Lab can't confirm it fits ${dietName || 'your diet'}.`);
        const word = strings(r.avoid_words).map((w) => w.trim()).find((w) => w && hasWord(name, w));
        if (word) flags.add(`${label}: "${word}" is on ${avoidList}.`);
      }
    }
  }
  return [...flags];
}

export function ateThisEntry(planned, recipe, time) {
  const p = planned && typeof planned === 'object' ? planned : null;
  const rec = recipe && typeof recipe === 'object' ? recipe : null;
  if (!p || !rec) return null;
  const s = servingsOf(p.servings);
  const per = obj(rec.per_serving);
  return {
    time,
    kind: p.slot,
    recipe: rec.name,
    planned_id: plannedKey(p),
    items: [{ food: rec.name, qty: s, net_carbs: round1(num(per.net_carbs) * s), protein: round1(num(per.protein) * s), fiber: round1(num(per.fiber) * s), fat: round1(num(per.fat) * s), kcal: Math.round(num(per.kcal) * s) }],
  };
}

// A planned meal's identity for "Ate this". Id-less meals (hand-written plans) use date|slot|recipe.
export function plannedKey(meal) {
  const m = obj(meal);
  if (typeof m.id === 'string' && m.id) return m.id;
  return `${m.date ?? ''}|${m.slot ?? ''}|${m.recipe ?? ''}`;
}

// ---------- eating window ----------

const validWindow = (w) => !!w && typeof w === 'object' && !Array.isArray(w)
  && typeof w.start === 'string' && w.start.trim() !== '' && typeof w.end === 'string' && w.end.trim() !== '';
const hasWindow = (r) => !!r && validWindow(r.eating_window);
const copyRule = (r) => (r && typeof r === 'object' && !Array.isArray(r) ? { ...r } : null);

// Goals.eating_window is the person's own window. It replaces the window on whichever chosen diet
// has one, add-on first (as Settings shows it). Returns copies; the inputs are never changed.
export function effectiveRules(diet, addOn, eatingWindow) {
  const out = { diet: copyRule(diet), addOn: copyRule(addOn) };
  if (!validWindow(eatingWindow)) return out;
  const target = hasWindow(out.addOn) ? out.addOn : hasWindow(out.diet) ? out.diet : null;
  if (target) target.eating_window = { start: eatingWindow.start, end: eatingWindow.end };
  return out;
}

// ---------- plan changes ----------
const isRow = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const hasId = (x) => typeof x.id === 'string' && x.id !== '';
// Each takes a plan read fresh from disk and returns a new plan; the input is never changed.

// FNV-1a: a short, stable id from an extra's own content, so it doesn't shift when another extra goes.
function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const LIST_FIELDS = [['meals', (p) => p], ['prep', (p) => p], ['shopping.checked', (p) => obj(p.shopping)], ['shopping.extras', (p) => obj(p.shopping)]];

// A list field that holds something else (a hand edit or an AI tool) must not be replaced with [] by a save.
export function planListProblem(plan) {
  const p = obj(plan);
  if (Object.prototype.hasOwnProperty.call(p, 'shopping') && !(p.shopping && typeof p.shopping === 'object' && !Array.isArray(p.shopping))) {
    return "This week's plan note has a shopping field that isn't a group of fields; fix it in the note first.";
  }
  for (const [name, holder] of LIST_FIELDS) {
    const box = holder(p);
    const key = name.split('.').pop();
    if (Object.prototype.hasOwnProperty.call(box, key) && !Array.isArray(box[key])) {
      return `This week's plan note has a ${name} field that isn't a list; fix it in the note first.`;
    }
  }
  return null;
}

// Fills in missing collections and gives every shopping extra an id, so one extra can be ticked
// or removed on its own. An id-less extra gets x-legacy-<hash of item|section>, plus -2, -3 for
// duplicates; it is saved with the next write.
// Entries the page can't read (a stray string in extras) are kept as they are, never dropped.
export function normalizePlan(plan) {
  const p = obj(plan);
  const shopping = obj(p.shopping);
  const used = new Set(arr(shopping.extras).filter(isRow).map((x) => x.id));
  const seen = new Set();
  const extras = arr(shopping.extras).map((x) => {
    if (!isRow(x)) return x;
    if (hasId(x) && !seen.has(x.id)) { seen.add(x.id); return { ...x }; }
    const base = `x-legacy-${shortHash(`${lower(x.item)}|${lower(x.section)}`)}`;
    let id = base;
    for (let n = 2; used.has(id) || seen.has(id); n += 1) id = `${base}-${n}`;
    seen.add(id);
    return { ...x, id };
  });
  return {
    ...p,
    meals: arr(p.meals),
    prep: arr(p.prep),
    shopping: { ...shopping, checked: arr(shopping.checked), extras },
  };
}

const gone = () => new Error('That item is no longer in the plan. Reload the page and try again.');

const withShopping = (plan, patch) => {
  const p = normalizePlan(plan);
  return { ...p, shopping: { ...p.shopping, ...patch(p.shopping) } };
};

// on: true ticks, false unticks, left out flips.
export function toggleChecked(plan, key, on) {
  return withShopping(plan, (sh) => {
    const has = sh.checked.includes(key);
    const want = on === undefined ? !has : !!on;
    if (!want) return { checked: sh.checked.filter((k) => k !== key) };
    return { checked: has ? sh.checked : [...sh.checked, key] };
  });
}

export const addExtra = (plan, extra) => withShopping(plan, (sh) => ({ extras: [...sh.extras, { ...extra }] }));
// An id that isn't in the fresh plan throws, so the page reports it instead of changing another extra.
const requireExtra = (sh, id) => { if (!sh.extras.some((x) => isRow(x) && x.id === id)) throw gone(); };
export const removeExtra = (plan, id) => withShopping(plan, (sh) => {
  requireExtra(sh, id);
  return { extras: sh.extras.filter((x) => !isRow(x) || x.id !== id) };
});
export const toggleExtra = (plan, id, on) => withShopping(plan, (sh) => {
  requireExtra(sh, id);
  return { extras: sh.extras.map((x) => (isRow(x) && x.id === id ? { ...x, checked: on === undefined ? !x.checked : !!on } : x)) };
});

// target = { id, index } from the rendered page. Match by id; an id-less row falls back to its
// index, and only while the row there still has no id.
function findRow(list, target) {
  const t = obj(target);
  if (typeof t.id === 'string' && t.id) return list.findIndex((x) => isRow(x) && x.id === t.id);
  const i = Number.isInteger(t.index) ? t.index : -1;
  return isRow(list[i]) && !hasId(list[i]) ? i : -1;
}


export function updateMealById(plan, target, patch) {
  const p = normalizePlan(plan);
  const i = findRow(p.meals, target);
  if (i < 0) throw gone();
  return { ...p, meals: p.meals.map((m, k) => (k === i ? { ...m, ...patch } : m)) };
}

export function removeMealById(plan, target) {
  const p = normalizePlan(plan);
  const i = findRow(p.meals, target);
  if (i < 0) throw gone();
  const id = hasId(p.meals[i]) ? p.meals[i].id : null;
  return {
    ...p,
    meals: p.meals.filter((_, k) => k !== i),
    prep: p.prep.map((q) => (id && isRow(q) && Array.isArray(q.meal_ids) ? { ...q, meal_ids: q.meal_ids.filter((x) => x !== id) } : q)),
  };
}

// Saves a prep day against the fresh plan: meal ids no longer in the plan are dropped, and a prep day
// left with no meals and no notes is removed (or, when new, not added).
export function savePrep(plan, target, entry) {
  const p = normalizePlan(plan);
  const ids = new Set(p.meals.filter((m) => isRow(m) && hasId(m)).map((m) => m.id));
  const e = obj(entry);
  const kept = { ...e, meal_ids: arr(e.meal_ids).filter((id) => ids.has(id)) };
  const empty = !kept.meal_ids.length && !(typeof kept.notes === 'string' && kept.notes.trim());
  if (!target) return empty ? p : { ...p, prep: [...p.prep, kept] };
  return empty ? removePrepById(p, target) : updatePrepById(p, target, kept);
}

export function updatePrepById(plan, target, entry) {
  const p = normalizePlan(plan);
  const i = findRow(p.prep, target);
  if (i < 0) throw gone();
  return { ...p, prep: p.prep.map((q, k) => (k === i ? entry : q)) };
}

export function removePrepById(plan, target) {
  const p = normalizePlan(plan);
  const i = findRow(p.prep, target);
  if (i < 0) throw gone();
  return { ...p, prep: p.prep.filter((_, k) => k !== i) };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const sameMeal = (a, b) => a.date === b.date && a.slot === b.slot && lower(a.recipe) === lower(b.recipe);

// Appends last week's meals a week later with new ids. Each meal this week already had (same day,
// slot and recipe) cancels one copy, so copying twice adds nothing while a recipe planned twice in
// one slot copies twice. Prep and shopping are kept.
export function copyWeekMeals(prevPlan, thisPlan, newId) {
  const p = normalizePlan(thisPlan);
  const before = p.meals.filter(isRow);
  const added = [];
  for (const m of objs(obj(prevPlan).meals)) {
    if (typeof m.date !== 'string' || !ISO_DATE.test(m.date) || Number.isNaN(Date.parse(`${m.date}T00:00:00Z`))) continue;
    const copy = { ...m, id: newId(), date: addDaysIso(m.date, 7) };
    const match = before.findIndex((x) => sameMeal(x, copy));
    if (match >= 0) { before.splice(match, 1); continue; }
    added.push(copy);
  }
  return { plan: { ...p, meals: [...p.meals, ...added] }, added: added.length };
}

const sameRecipe = (a, b) => lower(a) !== '' && lower(a) === lower(b);

export function countRecipeUses(plan, name) {
  return objs(obj(plan).meals).filter((m) => sameRecipe(m.recipe, name)).length;
}

export function renameRecipeInPlan(plan, oldName, newName) {
  const p = obj(plan);
  let count = 0;
  const meals = arr(p.meals).map((m) => {
    if (!isRow(m) || !sameRecipe(m.recipe, oldName)) return m;
    count += 1;
    return { ...m, recipe: newName };
  });
  return { plan: { ...p, meals }, count };
}

// ---------- friendly shopping amounts (display only) ----------

const FRACTIONS = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
const TSP = /^(tsps?|teaspoons?)$/i;
const TBSP = /^(tbsps?|tbs|tablespoons?)$/i;
const PINCH_TSP = 1 / 16;
const KITCHEN = /^(cups?|tsps?|teaspoons?|tbsps?|tbs|tablespoons?)$/i;
// Whole items ("each" or no unit) read as "¼ cucumber" or "3 eggs", without the word each.
const EACH = /^(each|)$/i;

export function friendlyAmount(amount, unit) {
  const n = parseNum(amount);
  if (n === null || n < 0) return '';
  const u = typeof unit === 'string' ? unit.trim() : '';
  const withUnit = (text) => (u && !EACH.test(u) ? `${text} ${u}` : text);
  // A pinch is under 1/16 tsp (about 0.02 tbsp).
  const pinch = TSP.test(u) ? PINCH_TSP : TBSP.test(u) ? PINCH_TSP / 3 : 0;
  if (n > 0 && n < pinch) return 'a pinch';
  if (KITCHEN.test(u) || EACH.test(u)) {
    const whole = Math.floor(n);
    const rest = n - whole;
    if (rest < 0.02 && (whole > 0 || n === 0)) return withUnit(String(whole));
    if (rest > 0.98) return withUnit(String(whole + 1));
    const hit = FRACTIONS.find(([v]) => Math.abs(rest - v) < 0.02);
    if (hit) return withUnit(`${whole || ''}${hit[1]}`);
  }
  // A non-zero amount never reads as 0.
  const r = round2(n);
  return n > 0 && r === 0 ? 'a little' : withUnit(String(r));
}

// Read, apply, save with the version that was read. When another window saved in between, the server
// answers stale; read again and re-apply, up to 3 more times. Other errors stop at once.
export async function savePlanWithRetry({ load, save, build, retries = 3 }) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const raw = await load();
    const problem = planListProblem(raw);
    if (problem) throw new Error(problem);
    const { version, expected_version: ignored, ...plan } = normalizePlan(raw);
    const next = { ...build(plan) };
    delete next.version;
    try {
      await save({ ...next, expected_version: version ?? 'none' });
      return next;
    } catch (e) {
      if (!e || !e.stale) throw e;
    }
  }
  throw new Error('This week kept changing in another window. Reload the page and try again.');
}
