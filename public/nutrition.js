// Pure nutrient math for USDA foods: no DOM, no fetch, so node:test can import it.

const DIRECT_GRAMS = { g: 1, gram: 1, kg: 1000, kilogram: 1000, oz: 28.35, ounce: 28.35, lb: 453.6, pound: 453.6 };
const UNIT_ALIASES = { tbsp: 'tablespoon', tbs: 'tablespoon', tbl: 'tablespoon', tsp: 'teaspoon' };
const EACH_ORDER = ['large', 'medium', 'whole'];
// Teaspoons in each volume unit, for a unit the food has no label for (2 tbsp from a cup weight).
const VOLUME_TSP = { cup: 48, tablespoon: 3, teaspoon: 1 };
// Label words that measure an amount rather than count one thing, so "each" never picks them.
const NOT_COUNTS = new Set(['cup', 'tablespoon', 'teaspoon', 'oz', 'fl', 'g', 'gram', 'kg', 'lb', 'pound', 'ml', 'liter', 'quart', 'pint', 'gallon',
  'slice', 'serving', 'nlea', 'package', 'can', 'container', 'carton', 'bottle', 'jar', 'box', 'bag', 'packet', 'bunch', 'strip', 'wedge', 'ring',
  'dash', 'pinch', 'pat', 'stick', 'cubic', 'sprig', 'spear', 'unit', 'portion', 'yield', 'scoop', 'envelope', 'bar', 'order']);
const KEYS = ['net_carbs', 'protein', 'fiber', 'fat', 'kcal'];
// Own keys only, so 'constructor' or '__proto__' is never a unit or a food.
const own = (table, key) => (table && Object.hasOwn(table, key) ? table[key] : undefined);

const round1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10;
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const num = (v) => { const n = finite(v); return n === null ? 0 : n; };
const objs = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : []);

// "Cups" -> "cup", "tbsp" -> "tablespoon". Very short units ("oz", "g") keep their s.
function unitKey(u) {
  let k = typeof u === 'string' ? u.trim().toLowerCase() : '';
  if (k.length > 2) k = k.replace(/s$/, '');
  return own(UNIT_ALIASES, k) || k;
}

// "1 large" -> { count: 1, rest: 'large' }; "0.5 cup, chopped" -> { count: 0.5, rest: 'cup, chopped' }.
function splitLabel(label) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(.*)$/.exec(label);
  if (m) return { count: Number(m[1]) || 1, rest: m[2].toLowerCase() };
  return { count: 1, rest: label.trim().toLowerCase() };
}

// The first word of the label's unit part, in the same form unitKey gives.
const labelUnit = (rest) => unitKey((rest.match(/^[a-z]+/) || [''])[0]);

function portionGrams(unit, portions) {
  const list = objs(portions).filter((p) => typeof p.label === 'string' && finite(p.g) !== null && finite(p.g) > 0);
  const parsed = list.map((p) => ({ ...splitLabel(p.label), g: finite(p.g) }));
  const key = unitKey(unit);
  const wanted = key === 'each' ? EACH_ORDER : [key];
  for (const w of wanted) {
    if (!w) continue;
    const hit = parsed.find((p) => labelUnit(p.rest) === w);
    if (hit) return hit.g / hit.count;
  }
  if (key === 'each') {
    // One of something: a clove, a fruit, a stalk. A medium one if the food lists sizes.
    const counts = parsed.filter((p) => labelUnit(p.rest) && !NOT_COUNTS.has(labelUnit(p.rest)));
    const hit = counts.find((p) => /\bmedium\b/.test(p.rest)) || counts[0];
    return hit ? hit.g / hit.count : null;
  }
  if (own(VOLUME_TSP, key)) {
    const hit = parsed.find((p) => own(VOLUME_TSP, labelUnit(p.rest)));
    if (hit) return (hit.g / hit.count / VOLUME_TSP[labelUnit(hit.rest)]) * VOLUME_TSP[key];
  }
  return null;
}

export function gramsFor(amount, unit, portions) {
  const a = finite(amount);
  if (a === null || a < 0) return null;
  const key = typeof unit === 'string' ? unit.trim().toLowerCase().replace(/\.$/, '') : '';
  if (!key) return null;
  const direct = own(DIRECT_GRAMS, key) ?? own(DIRECT_GRAMS, key.replace(/s$/, ''));
  if (direct !== undefined) return Math.round(a * direct * 1e6) / 1e6;
  const one = portionGrams(key, portions);
  return one === null ? null : Math.round(a * one * 1e6) / 1e6;
}

function rawNutrients(per100, grams) {
  const p = per100 && typeof per100 === 'object' ? per100 : {};
  const f = num(grams) / 100;
  return {
    net_carbs: Math.max(0, num(p.carbs) - num(p.fiber)) * f,
    protein: num(p.protein) * f,
    fiber: num(p.fiber) * f,
    fat: num(p.fat) * f,
    kcal: num(p.kcal) * f,
  };
}

function rounded(n) {
  const out = {};
  for (const k of KEYS) out[k] = k === 'kcal' ? Math.round(n[k]) : round1(n[k]);
  return out;
}

export function nutrientsFor(per100, grams) {
  return rounded(rawNutrients(per100, grams));
}

// ingredients: [{ amount, unit, usda_id }]; foodsById: Map or plain object of USDA foods.
export function recipeFromIngredients(ingredients, foodsById, servings) {
  const list = objs(ingredients);
  const lookup = (id) => {
    if (id === undefined || id === null || id === '') return null;
    if (foodsById instanceof Map) return foodsById.get(id) || foodsById.get(String(id)) || foodsById.get(Number(id)) || null;
    return foodsById && typeof foodsById === 'object' ? own(foodsById, String(id)) || null : null;
  };
  const sum = Object.fromEntries(KEYS.map((k) => [k, 0]));
  let matched = 0;
  for (const ing of list) {
    const food = lookup(ing.usda_id);
    if (!food) continue;
    const grams = gramsFor(ing.amount, ing.unit, food.portions);
    if (grams === null) continue;
    const n = rawNutrients(food.per100, grams);
    for (const k of KEYS) sum[k] += n[k];
    matched += 1;
  }
  const s = finite(servings);
  const div = s !== null && s > 0 ? s : 1;
  const per = {};
  for (const k of KEYS) per[k] = sum[k] / div;
  return { per_serving: rounded(per), matched, total: list.length };
}
