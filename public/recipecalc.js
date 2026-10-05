// Recipe nutrition from linked USDA ingredients: the pure parts the recipe editor and the
// "Update starter recipes' nutrition" button share. No DOM; fetching is passed in.

import { gramsFor, recipeFromIngredients } from './nutrition.js';

export const ESTIMATE_NOTE = 'Nutrition numbers are estimates.';
export const USDA_NOTE = 'Nutrition from USDA FoodData Central; amounts are approximate.';
export const PER_SERVING_KEYS = ['net_carbs', 'protein', 'fiber', 'fat', 'kcal'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const objs = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
const hasId = (id) => (typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && id.trim() !== '');
// True when an ingredient carries a usable USDA id: the editor's "linked" badge and the counts agree.
export const isLinked = (ing) => isObj(ing) && hasId(ing.usda_id);

// Starter ingredients whose amount changed when the starters were linked to USDA foods, because
// USDA can't weigh them as first written. tools/link-starters.js applies these to the built-in
// starters; the update button applies them to a seeded note only when the note still has the
// old amount. Greek yogurt and chia have no cup weight in SR Legacy; a whole chicken bought by
// the pound includes bone (USDA counts one chicken as 920 g edible); "each" means a large
// zucchini, which pushed the keto steak plate over 12 g net carbs.
export const STARTER_FIXES = [
  { was: { item: 'plain greek yogurt', amount: 1, unit: 'cup' }, now: { item: 'plain greek yogurt', amount: 8, unit: 'oz' } },
  { was: { item: 'plain greek yogurt', amount: 0.5, unit: 'cup' }, now: { item: 'plain greek yogurt', amount: 4, unit: 'oz' } },
  { was: { item: 'chia seeds', amount: 0.33, unit: 'cup' }, now: { item: 'chia seeds', amount: 2, unit: 'oz' } },
  { was: { item: 'whole chicken', amount: 4, unit: 'lb' }, now: { item: 'whole chicken (about 4 lb)', amount: 1, unit: 'each' } },
  { was: { item: 'zucchini', amount: 1, unit: 'each' }, now: { item: 'zucchini', amount: 1, unit: 'medium' } },
];

const key = (s) => String(s ?? '').trim().toLowerCase();
const samePair = (a, b) => key(a.item) === key(b.item) && finite(a.amount) === finite(b.amount) && key(a.unit) === key(b.unit);

// The fix that turns this ingredient (as first written) into the given new one, if any.
export function fixFor(ing, now) {
  return STARTER_FIXES.find((f) => samePair(ing, f.was) && (!now || samePair(now, f.now))) || null;
}
const itemName = (i) => (typeof i.item === 'string' ? i.item.trim() : i.item === undefined || i.item === null ? '' : String(i.item).trim());
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));

function foodFor(foodsById, id) {
  if (!hasId(id) || !(foodsById instanceof Map)) return null;
  return foodsById.get(String(id)) || foodsById.get(Number(id)) || null;
}

// Why an ingredient isn't counted, or null when it is.
export function ingredientIssue(ing, foodsById) {
  if (!isObj(ing)) return 'not readable';
  if (!hasId(ing.usda_id)) return 'not linked';
  const food = foodFor(foodsById, ing.usda_id);
  if (!food) return 'food not found';
  if (finite(ing.amount) === null) return 'no amount';
  if (gramsFor(ing.amount, ing.unit, food.portions) === null) return `can't weigh "${String(ing.unit ?? '').trim() || 'no unit'}"`;
  return null;
}

// Per-serving numbers from the linked ingredients, plus which ones weren't counted and why.
// Rows with no name (a blank row in the editor) don't count toward M.
export function recipeCalc(ingredients, foodsById, servings) {
  const list = objs(ingredients).filter((i) => itemName(i));
  const map = foodsById instanceof Map ? foodsById : new Map();
  const { per_serving, matched } = recipeFromIngredients(list, map, servings);
  const unmatched = [];
  for (const i of list) {
    const why = ingredientIssue(i, map);
    if (why) unmatched.push({ item: itemName(i), why });
  }
  return { per_serving, matched, total: list.length, unmatched };
}

// Linked ingredients the calculation left out: a food that wasn't found, a unit it can't weigh, or
// no amount. Linking a line says it counts, so a blank amount there is worth a warning. Unlinked
// lines stay silent; "to taste" seasonings are left unlinked for that reason.
export function uncountedLinked(calc) {
  return objs(isObj(calc) ? calc.unmatched : []).filter((u) => u.why !== 'not linked');
}

export const uncountedText = (list) => list.map((u) => `${u.item} (${u.why})`).join(', ');

// "Calculated from 5 of 7 ingredients. Not counted: salt (no amount), chives (not linked)."
export function calcSummary(calc) {
  const c = isObj(calc) ? calc : { matched: 0, total: 0, unmatched: [] };
  const head = `Calculated from ${c.matched} of ${c.total} ingredient${c.total === 1 ? '' : 's'}`;
  const miss = objs(c.unmatched).map((u) => `${u.item} (${u.why})`);
  return miss.length ? `${head}. Not counted: ${miss.join(', ')}.` : `${head}.`;
}

// The USDA ids the ingredients link to, once each, as strings.
export function linkedIds(ingredients) {
  return [...new Set(objs(ingredients).filter((i) => hasId(i.usda_id)).map((i) => String(i.usda_id).trim()))];
}

// Fills cache (a Map keyed by id string) with any of ids it lacks. A food that fails to load is
// left out, so its ingredient shows as "food not found" and the next call tries again.
export async function loadFoods(ids, cache, fetchFood) {
  const missing = (Array.isArray(ids) ? ids : []).map(String).filter((id) => !cache.has(id));
  await Promise.all(missing.map(async (id) => {
    try {
      const food = await fetchFood(id);
      if (isObj(food) && isObj(food.per100)) cache.set(id, food);
    } catch {
      // left out on purpose
    }
  }));
  return cache;
}

// True when the typed numbers match the calculated ones, so switching to Calculated loses nothing.
export function sameNumbers(typed, calculated) {
  const a = isObj(typed) ? typed : {};
  const b = isObj(calculated) ? calculated : {};
  return PER_SERVING_KEYS.every((k) => {
    const x = finite(a[k]);
    const y = finite(b[k]);
    return x === null || (y !== null && Math.abs(x - y) < 1e-9);
  });
}

// per_serving with the calculated numbers in place; any other keys the note had are kept.
export function withCalculated(perServing, calc) {
  return { ...(isObj(perServing) ? perServing : {}), ...calc.per_serving };
}

// Starters the update button may change: unedited starters not set to Manual.
export function starterTargets(recipes) {
  return objs(recipes).filter((r) => !r.broken && r.starter === true && r.per_serving_source !== 'manual');
}

// The note's ingredient lines up with the starter's: same name, or the old name a fix renamed.
const sameIngredient = (i, s) => key(i.item) === key(s.item) || !!STARTER_FIXES.find((f) => key(f.was.item) === key(i.item) && key(f.now.item) === key(s.item));

// A seeded note's ingredients, linked like the built-in starter. When the note still lists the
// same ingredients in the same order, each gets the starter's USDA id unless it already links to
// another food, which stays. Its amount and unit change only when they are still the old value a
// STARTER_FIXES entry replaced (and it isn't linked elsewhere), so a changed amount stays.
// Other keys on the note's ingredient stay. A reordered or edited list only gets missing ids by name.
export function relinkIngredients(ingredients, starter) {
  const mine = objs(ingredients);
  const theirs = isObj(starter) ? objs(starter.ingredients) : [];
  const sameList = mine.length === theirs.length && mine.every((i, n) => sameIngredient(i, theirs[n]));
  if (sameList) {
    return mine.map((i, n) => {
      const s = theirs[n];
      // A "to taste" seasoning: the starter leaves it unlinked with no amount. A note seeded by an
      // earlier build may still link it, which would leave a linked line with no amount; drop that.
      if (!hasId(s.usda_id) && finite(s.amount) === null && finite(i.amount) === null) {
        const out = { ...i };
        delete out.usda_id;
        return out;
      }
      const own = hasId(i.usda_id) && String(i.usda_id).trim() !== String(s.usda_id ?? '').trim();
      if (own) return { ...i };
      const out = fixFor(i, s) ? { ...i, item: s.item, amount: s.amount, unit: s.unit } : { ...i };
      if (hasId(s.usda_id)) out.usda_id = s.usda_id;
      return out;
    });
  }
  const byName = new Map(theirs.filter((s) => hasId(s.usda_id)).map((s) => [key(s.item), s.usda_id]));
  return mine.map((i) => (hasId(i.usda_id) || !byName.has(key(i.item)) ? { ...i } : { ...i, usda_id: byName.get(key(i.item)) }));
}

const withoutMeta = (r) => {
  const out = { ...r };
  for (const k of ['id', 'broken', 'version', 'expected_version']) delete out[k];
  return out;
};

// What the update does to one recipe: null when nothing would change, { skip: reason } when it
// must be left alone, else { recipe, calc } with the recipe ready to save.
export function updatedStarter(recipe, starter, foodsById) {
  if (!isObj(recipe)) return null;
  if (!isObj(starter)) return { skip: 'not a built-in starter' };
  const servings = recipe.servings;
  if (typeof servings !== 'number' || !Number.isFinite(servings) || servings < 0.5) return { skip: 'servings is not a number of 0.5 or more' };
  const ingredients = relinkIngredients(recipe.ingredients, starter);
  const calc = recipeCalc(ingredients, foodsById, servings);
  if (calc.matched === 0) return { skip: 'no ingredients matched a USDA food' };
  // A linked ingredient left out would make the numbers too low: one whose food is gone, whose unit
  // can't be weighed, or whose amount was cleared. That recipe alone is skipped. Unlinked lines
  // (salt, pepper to taste) carry next to nothing and don't stop it.
  const weak = uncountedLinked(calc);
  if (weak.length) return { skip: `not counted: ${uncountedText(weak)}` };
  const note = recipe.note === undefined || recipe.note === null || recipe.note === '' || recipe.note === ESTIMATE_NOTE ? USDA_NOTE : recipe.note;
  const next = withoutMeta({ ...recipe, ingredients, per_serving: withCalculated(recipe.per_serving, calc), per_serving_source: 'usda', note });
  return JSON.stringify(next) === JSON.stringify(withoutMeta(recipe)) ? null : { recipe: next, calc };
}
