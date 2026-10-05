'use strict';
/*
 * Links each starter recipe ingredient to a USDA food and recalculates the
 * per-serving numbers from them. Run by hand after editing the map below:
 *   node tools/link-starters.js            rewrite lib/starters/recipes.js
 *   node tools/link-starters.js --check    print the table, write nothing
 * Prints each recipe's old and new numbers and flags any that moved more than 40%.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const RECIPES_FILE = path.join(ROOT, 'lib', 'starters', 'recipes.js');
const FOODS_FILE = path.join(ROOT, 'data', 'usda-foods.json');
const NOTE = 'Nutrition from USDA FoodData Central; amounts are approximate.';

// Starter ingredient name -> USDA SR Legacy id. Chosen by hand: the plain, raw (or as-sold) food.
// Salt has no SR Legacy entry, so it stays unlinked; it adds nothing to the numbers anyway.
const USDA_IDS = {
  'salmon fillets': 175167, // Fish, salmon, Atlantic, farmed, raw
  'broccoli florets': 170379, // Broccoli, raw
  lemon: 167746, // Lemons, raw, without peel
  'garlic cloves': 169230, // Garlic, raw
  'olive oil': 171413, // Oil, olive, salad or cooking
  'black pepper': 170931, // Spices, pepper, black
  eggs: 171287, // Egg, whole, raw, fresh
  'baby spinach': 168462, // Spinach, raw
  'feta cheese': 173420, // Cheese, feta
  milk: 171265, // Milk, whole, 3.25% milkfat, with added vitamin D
  butter: 173410, // Butter, salted
  'boneless skinless chicken thighs': 173627, // Chicken, broilers or fryers, dark meat, thigh, meat only, raw
  'green beans': 169961, // Beans, snap, green, raw
  paprika: 171329, // Spices, paprika
  'dry brown lentils': 172420, // Lentils, raw
  carrots: 170393, // Carrots, raw
  'celery stalks': 169988, // Celery, raw
  'yellow onion': 170000, // Onions, raw
  'diced tomatoes, canned': 170051, // Tomatoes, red, ripe, canned, packed in tomato juice
  'vegetable or chicken broth': 171583, // Soup, vegetable broth, ready to serve
  cumin: 170923, // Spices, cumin seed
  'canned chickpeas': 175206, // Chickpeas, mature seeds, canned, solids and liquids (the can weight)
  cucumbers: 168409, // Cucumber, with peel, raw
  cucumber: 168409,
  'cherry tomatoes': 170457, // Tomatoes, red, ripe, raw, year round average (has "1 cup cherry tomatoes")
  'red onion': 170000, // Onions, raw
  'fresh parsley': 170416, // Parsley, fresh
  'cod fillets': 171955, // Fish, cod, Atlantic, raw
  'pitted olives': 169094, // Olives, ripe, canned (small-extra large)
  'dried oregano': 171328, // Spices, oregano, dried
  'plain greek yogurt': 170894, // Yogurt, Greek, plain, nonfat
  'mixed berries': 167762, // Strawberries, raw: SR Legacy has no mixed berries
  walnuts: 170187, // Nuts, walnuts, english
  cinnamon: 171320, // Spices, cinnamon, ground
  'lean ground turkey': 172850, // Turkey, ground, 93% lean, 7% fat, raw
  'romaine leaves': 169247, // Lettuce, cos or romaine, raw
  avocado: 171705, // Avocados, raw, all commercial varieties
  salsa: 174524, // Sauce, salsa, ready-to-serve
  'shredded cheddar': 173414, // Cheese, cheddar
  'chili powder': 171319, // Spices, chili powder
  'garlic powder': 171325, // Spices, garlic powder
  'cottage cheese': 172179, // Cheese, cottage, creamed, large or small curd
  chives: 169994, // Chives, raw
  'sirloin steak': 168726, // Beef, top sirloin, steak, lean and fat, trimmed to 1/8" fat, all grades, raw
  zucchini: 169291, // Squash, summer, zucchini, includes skin, raw
  'bell pepper': 170108, // Peppers, sweet, red, raw
  mushrooms: 169251, // Mushrooms, white, raw
  'boneless skinless chicken breast': 171077, // Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw
  'dry quinoa': 168874, // Quinoa, uncooked
  'chia seeds': 170554, // Seeds, chia seeds, dried
  'unsweetened almond milk': 174832, // Beverages, almond milk, unsweetened, shelf stable
  raspberries: 167755, // Raspberries, raw
  'vanilla extract': 173471, // Vanilla extract
  'ribeye steaks': 168612, // Beef, rib, eye, small end, lean and fat, trimmed to 0" fat, choice, raw
  'ground beef, 80/20': 174036, // Beef, ground, 80% lean meat / 20% fat, raw
  'boneless pork shoulder': 167843, // Pork, fresh, shoulder, whole, separable lean and fat, raw
  'sweet potatoes': 168482, // Sweet potato, raw, unprepared
  'canned black beans': 175238, // Beans, black, mature seeds, canned, low sodium (the can weight)
  lime: 168155, // Limes, raw
  'rolled oats': 173904, // Cereals, oats, regular and quick, not fortified, dry
  apple: 171688, // Apples, raw, with skin
  'whole chicken (about 4 lb)': 171447, // Chicken, broilers or fryers, meat and skin, raw
  parsnips: 170417, // Parsnips, raw
  'dried thyme': 170938, // Spices, thyme, dried
};

// Amounts USDA can't weigh as written are rewritten by STARTER_FIXES in public/recipecalc.js,
// which the "Update starter recipes' nutrition" button shares.

// A recipe is flagged when a number moved more than 40% and more than 2 g.
const FLAG_SHARE = 0.4;
const FLAG_GRAMS = 2;

function differs(oldV, newV) {
  if (typeof oldV !== 'number' || typeof newV !== 'number') return false;
  const diff = Math.abs(newV - oldV);
  return diff > FLAG_GRAMS && diff > FLAG_SHARE * Math.max(Math.abs(oldV), 1);
}

function linkIngredient(ing, fixFor) {
  const fix = fixFor(ing);
  const out = fix ? { ...ing, ...fix.now } : { ...ing };
  // "To taste" lines (no amount) stay unlinked: they add about nothing, and a linked line with no
  // amount makes the editor warn that it isn't counted.
  const toTaste = out.amount === null || out.amount === undefined;
  if (!toTaste && Object.hasOwn(USDA_IDS, out.item)) out.usda_id = USDA_IDS[out.item];
  else delete out.usda_id;
  return out;
}

async function linkAll(recipes, foods) {
  const { recipeFromIngredients } = await import(pathToFileURL(path.join(ROOT, 'public', 'nutrition.js')).href);
  const { fixFor } = await import(pathToFileURL(path.join(ROOT, 'public', 'recipecalc.js')).href);
  const byId = new Map(foods.map((f) => [f.id, f]));
  return recipes.map((r) => {
    const ingredients = r.ingredients.map((i) => linkIngredient(i, fixFor));
    for (const i of ingredients) if (i.usda_id !== undefined && !byId.has(i.usda_id)) throw new Error(`${r.name}: no USDA food ${i.usda_id} for ${i.item}`);
    const calc = recipeFromIngredients(ingredients, byId, r.servings);
    const unmatched = ingredients.filter((i) => {
      const one = recipeFromIngredients([i], byId, 1);
      return one.matched === 0;
    }).map((i) => i.item);
    const keys = ['net_carbs', 'protein', 'fiber'];
    const flags = keys.filter((k) => differs(r.per_serving[k], calc.per_serving[k]));
    return {
      recipe: { ...r, per_serving: calc.per_serving, per_serving_source: 'usda', ingredients, note: NOTE },
      old: r.per_serving,
      matched: calc.matched,
      total: calc.total,
      unmatched,
      flags,
    };
  });
}

// ---------- writing recipes.js ----------

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const lit = (v) => (typeof v === 'string' ? q(v) : v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));
const list = (a) => `[${a.map(lit).join(', ')}]`;
const obj = (o) => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${lit(v)}`).join(', ')} }`;
const KNOWN = ['name', 'servings', 'prep_minutes', 'cook_minutes', 'diets', 'tags', 'meal_prep', 'per_serving', 'per_serving_source', 'ingredients', 'steps', 'note', 'starter'];

function ingLine(i) {
  const extra = Object.keys(i).filter((k) => !['item', 'amount', 'unit', 'section', 'usda_id'].includes(k));
  if (extra.length) throw new Error(`${i.item}: unexpected ingredient keys ${extra.join(', ')}`);
  const args = [i.item, i.amount, i.unit, i.section].map(lit);
  if (i.usda_id !== undefined) args.push(lit(i.usda_id));
  return `      ing(${args.join(', ')}),`;
}

function recipeBlock(r) {
  const extra = Object.keys(r).filter((k) => !KNOWN.includes(k));
  if (extra.length) throw new Error(`${r.name}: unexpected recipe keys ${extra.join(', ')}`);
  return `  {
    name: ${q(r.name)},
    servings: ${r.servings}, prep_minutes: ${r.prep_minutes}, cook_minutes: ${r.cook_minutes},
    diets: ${list(r.diets)},
    tags: ${list(r.tags)},
    meal_prep: ${r.meal_prep},
    per_serving: ${obj(r.per_serving)},
    per_serving_source: ${q(r.per_serving_source)},
    ingredients: [
${r.ingredients.map(ingLine).join('\n')}
    ],
    steps: [
${r.steps.map((s) => `      ${q(s)},`).join('\n')}
    ],
    note: NOTE, starter: ${r.starter},
  },`;
}

function recipesSource(recipes) {
  return `'use strict';
// Starter recipes, seeded once into Recipes/. Written for Body Lab.
// Ingredients carry USDA ids and per_serving is worked out from them by
// tools/link-starters.js. Edit the map there and rerun it; don't edit the numbers here.

const NOTE = ${q(NOTE)};
const ing = (item, amount, unit, section, usda_id) => (usda_id === undefined ? { item, amount, unit, section } : { item, amount, unit, section, usda_id });

module.exports = [
${recipes.map(recipeBlock).join('\n')}
];
`;
}

// ---------- report ----------

function table(results) {
  const f = (p) => `${p.net_carbs}/${p.protein}/${p.fiber}`;
  const rows = results.map((x) => `| ${x.recipe.name} | ${f(x.old)} | ${f(x.recipe.per_serving)} | ${x.recipe.per_serving.fat} | ${x.recipe.per_serving.kcal} | ${x.matched} of ${x.total} | ${x.unmatched.join(', ') || '—'} | ${x.flags.length ? `**${x.flags.join(', ')}**` : ''} |`);
  return ['| Recipe | Old carbs/protein/fiber | New carbs/protein/fiber | Fat | kcal | Matched | Unmatched | Off >40% |', '|---|---|---|---|---|---|---|---|', ...rows].join('\n');
}

async function main() {
  const check = process.argv.includes('--check');
  delete require.cache[require.resolve(RECIPES_FILE)];
  const recipes = require(RECIPES_FILE);
  const foods = JSON.parse(fs.readFileSync(FOODS_FILE, 'utf8'));
  const results = await linkAll(recipes, foods);
  console.log(table(results));
  const flagged = results.filter((x) => x.flags.length);
  if (flagged.length) console.log(`\nFlagged for review (moved more than 40%): ${flagged.map((x) => x.recipe.name).join('; ')}`);
  if (!check) {
    fs.writeFileSync(RECIPES_FILE, recipesSource(results.map((x) => x.recipe)));
    console.log(`\nWrote ${path.relative(ROOT, RECIPES_FILE)}`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { USDA_IDS, NOTE, linkAll, linkIngredient, differs, recipesSource };
