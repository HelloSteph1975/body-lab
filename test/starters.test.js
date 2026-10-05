const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const diets = require('../lib/starters/diets');
const recipes = require('../lib/starters/recipes');

const KEY = /^[A-Za-z_][\w-]*$/;
const STRIPPED = /[\\/:*?"<>|#^[\]]/;

test('six starter diets with valid rules', async () => {
  const { FOOD_TAGS } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'meals.js')).href);
  assert.deepEqual(diets.map((d) => d.name), ['Low carb or keto', 'Mediterranean', 'High protein, GLP-1 support', 'Intermittent fasting', 'Carnivore', 'Whole foods']);
  for (const d of diets) {
    for (const k of Object.keys(d)) assert.match(k, KEY);
    assert.match(d.description, /not medical advice/);
    for (const t of [...(d.favor_tags || []), ...(d.avoid_tags || []), ...(d.only_tags || [])]) assert.ok(FOOD_TAGS.includes(t), `${d.name}: ${t}`);
    if (d.eating_window) assert.match(`${d.eating_window.start}-${d.eating_window.end}`, /^\d\d:\d\d-\d\d:\d\d$/);
  }
  assert.equal(diets.find((d) => d.name === 'Intermittent fasting').add_on, true);
  assert.deepEqual(diets.find((d) => d.name === 'Carnivore').only_tags, ['meat', 'fish', 'eggs', 'dairy']);
});

test('eighteen starter recipes, three or more per diet, valid fields', async () => {
  const { FOOD_TAGS, SECTIONS } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'meals.js')).href);
  assert.equal(recipes.length, 18);
  const names = new Set(diets.map((d) => d.name));
  for (const r of recipes) {
    for (const k of Object.keys(r)) assert.match(k, KEY);
    assert.ok(r.servings >= 1 && r.ingredients.length >= 2 && r.steps.length >= 2, r.name);
    for (const d of r.diets) assert.ok(names.has(d), `${r.name}: ${d}`);
    for (const t of r.tags) assert.ok(FOOD_TAGS.includes(t), `${r.name}: ${t}`);
    for (const i of r.ingredients) assert.ok(SECTIONS.includes(i.section), `${r.name}: ${i.section}`);
    for (const k of ['net_carbs', 'protein', 'fiber', 'fat', 'kcal']) assert.equal(typeof r.per_serving[k], 'number', `${r.name}: ${k}`);
    assert.equal(r.note, 'Nutrition from USDA FoodData Central; amounts are approximate.');
    assert.equal(r.per_serving_source, 'usda');
  }
  for (const d of diets) assert.ok(recipes.filter((r) => r.diets.includes(d.name)).length >= 3, d.name);
  for (const r of recipes.filter((x) => x.diets.includes('Carnivore'))) {
    assert.ok(r.tags.every((t) => ['meat', 'fish', 'eggs', 'dairy'].includes(t)), `${r.name} isn't carnivore`);
  }
});

test('starter recipes: names unique, keto carbs, carnivore ingredients, meal_prep, tags fit their diets', () => {
  assert.equal(new Set(recipes.map((r) => r.name.toLowerCase())).size, recipes.length);
  const prep = ['Spinach and feta egg muffins', 'Garlic butter chicken thighs with green beans', 'Lentil and vegetable soup', 'Chickpea cucumber salad',
    'Turkey taco lettuce wraps', 'Chicken quinoa bowl', 'Overnight chia pudding', 'Beef patties with fried eggs', 'Slow-cooked pork shoulder',
    'Sweet potato black bean bowl', 'Roast chicken with root vegetables'];
  for (const r of recipes) assert.equal(r.meal_prep, prep.includes(r.name), `${r.name}: meal_prep`);
  for (const r of recipes.filter((x) => x.diets.includes('Low carb or keto'))) assert.ok(r.per_serving.net_carbs <= 12, `${r.name} net carbs`);
  const allowed = new Set(['ribeye steaks', 'ground beef, 80/20', 'boneless pork shoulder', 'eggs', 'butter', 'salt', 'water']);
  for (const r of recipes.filter((x) => x.diets.includes('Carnivore'))) {
    for (const i of r.ingredients) assert.ok(allowed.has(i.item), `${r.name}: ${i.item}`);
    assert.ok(r.ingredients.every((i) => ['meat & seafood', 'dairy & eggs', 'spices'].includes(i.section)), `${r.name} sections`);
  }
  for (const r of recipes) {
    for (const dn of r.diets) {
      const d = diets.find((x) => x.name === dn);
      const only = d.only_tags && d.only_tags.length ? d.only_tags : null;
      for (const t of r.tags) {
        assert.ok(!(d.avoid_tags || []).includes(t), `${r.name}: tag ${t} is on ${dn} avoid list`);
        if (only) assert.ok(only.includes(t), `${r.name}: tag ${t} outside ${dn}`);
      }
    }
  }
});

test('recipe food-safety wording', () => {
  const by = (n) => recipes.find((r) => r.name === n);
  const text = (n) => by(n).steps.join(' ');
  assert.match(text('Slow-cooked pork shoulder'), /195°F/);
  assert.match(text('Slow-cooked pork shoulder'), /up to 4 days in the fridge/);
  assert.match(text('Slow-cooked pork shoulder'), /freez/i);
  assert.match(text('Lentil and vegetable soup'), /up to 4 days in the fridge/);
  assert.match(text('Turkey taco lettuce wraps'), /no pink remains and it reaches 165°F/);
  assert.match(text('Steak and roasted vegetable plate'), /145°F, then rest 5 minutes/);
  assert.match(text('Pan-seared ribeye with butter'), /145°F, then rest 3 minutes/);
  assert.match(text('Spinach and feta egg muffins'), /to 165°F/);
  assert.match(text('Beef patties with fried eggs'), /yolk is set/);
  for (const r of recipes) for (const s of r.steps) assert.doesNotMatch(s, /keeps 5 days/i, r.name);
});

test('no starter name contains characters the store strips from file names', () => {
  for (const x of [...diets, ...recipes]) assert.ok(!STRIPPED.test(x.name) && x.name === x.name.trim() && !x.name.startsWith('.'), x.name);
});

// The hand-written estimates the starters had before they were linked to USDA foods (commit 1324129):
// [net carbs, protein, fiber] per serving.
const OLD_ESTIMATES = {
  'Sheet-pan salmon and broccoli': [8, 38, 5],
  'Spinach and feta egg muffins': [2, 16, 0.5],
  'Garlic butter chicken thighs with green beans': [5, 40, 3],
  'Lentil and vegetable soup': [29, 14, 8],
  'Chickpea cucumber salad': [30, 15, 11],
  'Baked cod with tomatoes and olives': [4, 32, 2],
  'Greek yogurt bowl with berries and walnuts': [19, 27, 3],
  'Turkey taco lettuce wraps': [4, 39, 4],
  'Cottage cheese egg scramble': [5, 31, 1],
  'Steak and roasted vegetable plate': [10, 40, 4],
  'Chicken quinoa bowl': [30, 44, 5],
  'Overnight chia pudding': [7, 12, 12],
  'Pan-seared ribeye with butter': [0, 52, 0],
  'Beef patties with fried eggs': [0.5, 44, 0],
  'Slow-cooked pork shoulder': [0, 38, 0],
  'Sweet potato black bean bowl': [34, 15, 11],
  'Apple cinnamon oatmeal': [34, 8, 8],
  'Roast chicken with root vegetables': [24, 42, 8],
};

// Starters below 70% matched or more than 40% off their old estimate, each checked by hand.
// A recipe that newly falls outside the range fails the test until it's checked and listed here.
const REVIEWED = {
  'Cottage cheese egg scramble': 'chives and salt are "to taste" with no amount; everything else matched',
  'Pan-seared ribeye with butter': 'salt is "to taste" with no amount; the steak and butter matched',
  'Slow-cooked pork shoulder': 'salt has no USDA SR Legacy entry and adds no protein, carbs, fiber, fat or calories',
};

test('starters are linked to USDA foods and their numbers are worked out from them', async (t) => {
  const { recipeFromIngredients } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'nutrition.js')).href);
  const foods = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, '..', 'data', 'usda-foods.json'), 'utf8'));
  const byId = new Map(foods.map((f) => [f.id, f]));
  const flagged = {};
  for (const r of recipes) {
    for (const i of r.ingredients) if (i.usda_id !== undefined) assert.ok(byId.has(i.usda_id), `${r.name}: ${i.item} -> ${i.usda_id}`);
    const calc = recipeFromIngredients(r.ingredients, byId, r.servings);
    assert.deepEqual(r.per_serving, calc.per_serving, `${r.name}: rerun node tools/link-starters.js`);
    const reasons = [];
    if (calc.matched / calc.total < 0.7) reasons.push(`${calc.matched} of ${calc.total} ingredients matched`);
    const old = OLD_ESTIMATES[r.name];
    assert.ok(old, `${r.name}: no old estimate`);
    ['net_carbs', 'protein', 'fiber'].forEach((k, n) => {
      if (Math.abs(r.per_serving[k] - old[n]) > 0.4 * old[n] + 1) reasons.push(`${k} ${old[n]} -> ${r.per_serving[k]}`);
    });
    if (reasons.length) flagged[r.name] = reasons.join('; ');
  }
  for (const [name, why] of Object.entries(flagged)) t.diagnostic(`review: ${name}: ${why}${REVIEWED[name] ? ` (checked: ${REVIEWED[name]})` : ''}`);
  assert.deepEqual(Object.keys(flagged).sort(), Object.keys(REVIEWED).sort(), 'a starter moved outside the range: check it and list it in REVIEWED');
});
