const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'recipecalc.js')).href);

const egg = { id: 1, name: 'Egg', per100: { kcal: 143, protein: 12.6, carbs: 0.7, fiber: 0, fat: 9.5 }, portions: [{ label: '1 large', g: 50 }] };
const oil = { id: 2, name: 'Oil', per100: { kcal: 884, protein: 0, carbs: 0, fiber: 0, fat: 100 }, portions: [{ label: '1 tablespoon', g: 13.5 }] };
const foods = () => new Map([['1', egg], ['2', oil]]);

test('recipeCalc counts linked ingredients and says why the rest are left out', async () => {
  const { recipeCalc, calcSummary } = await load();
  const calc = recipeCalc([
    { item: 'eggs', amount: 4, unit: 'each', usda_id: 1 },
    { item: 'oil', amount: 1, unit: 'tbsp', usda_id: '2' },
    { item: 'salt', amount: null, unit: '' },
    { item: 'pepper', unit: '', usda_id: 2 },
    { item: 'oil again', amount: 1, unit: 'bunch', usda_id: 2 },
    { item: 'ghost', amount: 1, unit: 'g', usda_id: 99 },
    { item: '   ', amount: 1, unit: 'g', usda_id: 1 },
    null, 'junk',
  ], foods(), 2);
  assert.equal(calc.matched, 2);
  assert.equal(calc.total, 6);
  // 200 g egg + 13.5 g oil over 2 servings
  assert.equal(calc.per_serving.protein, 12.6);
  assert.equal(calc.per_serving.fat, 16.3);
  assert.deepEqual(calc.unmatched, [
    { item: 'salt', why: 'not linked' },
    { item: 'pepper', why: 'no amount' },
    { item: 'oil again', why: 'can\'t weigh "bunch"' },
    { item: 'ghost', why: 'food not found' },
  ]);
  assert.equal(calcSummary(calc), 'Calculated from 2 of 6 ingredients. Not counted: salt (not linked), pepper (no amount), oil again (can\'t weigh "bunch"), ghost (food not found).');
  assert.equal(calcSummary({ matched: 1, total: 1, unmatched: [] }), 'Calculated from 1 of 1 ingredient.');
  assert.equal(calcSummary(null), 'Calculated from 0 of 0 ingredients.');
});

test('recipeCalc takes odd shapes without throwing', async () => {
  const { recipeCalc } = await load();
  assert.deepEqual(recipeCalc('nope', null, 'x'), { per_serving: { net_carbs: 0, protein: 0, fiber: 0, fat: 0, kcal: 0 }, matched: 0, total: 0, unmatched: [] });
  const calc = recipeCalc([{ item: 5, amount: '2', unit: 'each', usda_id: 1 }, { item: { x: 1 }, usda_id: '__proto__' }], foods(), 1);
  assert.equal(calc.matched, 1);
  assert.equal(calc.unmatched[0].why, 'food not found');
});

test('linkedIds and loadFoods fetch each food once and skip failures', async () => {
  const { linkedIds, loadFoods } = await load();
  assert.deepEqual(linkedIds([{ usda_id: 1 }, { usda_id: '1' }, { usda_id: 2 }, { usda_id: '' }, { usda_id: null }, null]), ['1', '2']);
  const cache = new Map([['1', egg]]);
  const asked = [];
  await loadFoods(['1', '2', '3', '4'], cache, async (id) => {
    asked.push(id);
    if (id === '3') throw new Error('404');
    if (id === '4') return { name: 'no numbers' };
    return oil;
  });
  assert.deepEqual(asked, ['2', '3', '4']);
  assert.deepEqual([...cache.keys()], ['1', '2']);
});

test('sameNumbers and withCalculated', async () => {
  const { sameNumbers, withCalculated } = await load();
  const calc = { net_carbs: 1, protein: 2, fiber: 0, fat: 3, kcal: 40 };
  assert.ok(sameNumbers({ net_carbs: 1, protein: 2 }, calc));
  assert.ok(sameNumbers({}, calc));
  assert.ok(!sameNumbers({ protein: 9 }, calc));
  assert.ok(!sameNumbers({ kcal: '41' }, calc));
  assert.ok(sameNumbers(null, null));
  assert.deepEqual(withCalculated({ sugar: 4, protein: 1 }, { per_serving: calc }), { sugar: 4, ...calc });
});

test('starterTargets skips edited, manual and broken recipes', async () => {
  const { starterTargets } = await load();
  const list = [
    { name: 'a', starter: true },
    { name: 'b', starter: true, per_serving_source: 'usda' },
    { name: 'c', starter: true, per_serving_source: 'manual' },
    { name: 'd', starter: false },
    { name: 'e', starter: 'true' },
    { name: 'f', starter: true, broken: true },
    null,
  ];
  assert.deepEqual(starterTargets(list).map((r) => r.name), ['a', 'b']);
  assert.deepEqual(starterTargets(undefined), []);
});

test('relinkIngredients changes an amount only when it is still the old starter value', async () => {
  const { relinkIngredients } = await load();
  const starter = { ingredients: [
    { item: 'plain greek yogurt', amount: 8, unit: 'oz', section: 'dairy & eggs', usda_id: 7 },
    { item: 'whole chicken (about 4 lb)', amount: 1, unit: 'each', section: 'meat & seafood', usda_id: 8 },
    { item: 'salt', amount: null, unit: '', section: 'spices' },
  ] };
  // As seeded: the old amounts take the starter's, the renamed chicken takes its new name.
  const seeded = relinkIngredients([
    { item: 'Plain Greek yogurt', amount: 1, unit: 'cup', section: 'dairy & eggs', brand: 'Fage' },
    { item: 'whole chicken', amount: 4, unit: 'lb', section: 'meat & seafood' },
    { item: 'salt', amount: null, unit: '', section: 'spices', usda_id: 3 },
  ], starter);
  assert.deepEqual(seeded, [
    { item: 'plain greek yogurt', amount: 8, unit: 'oz', section: 'dairy & eggs', brand: 'Fage', usda_id: 7 },
    { item: 'whole chicken (about 4 lb)', amount: 1, unit: 'each', section: 'meat & seafood', usda_id: 8 },
    // "To taste" in both, so the old link goes.
    { item: 'salt', amount: null, unit: '', section: 'spices' },
  ]);
  // Amounts changed by hand stay; only the id is added.
  const mine = relinkIngredients([
    { item: 'plain greek yogurt', amount: 2, unit: 'cup' },
    { item: 'whole chicken', amount: 5, unit: 'lb' },
    { item: 'salt' },
  ], starter);
  assert.deepEqual(mine, [
    { item: 'plain greek yogurt', amount: 2, unit: 'cup', usda_id: 7 },
    { item: 'whole chicken', amount: 5, unit: 'lb', usda_id: 8 },
    { item: 'salt' },
  ]);
  // A different list only gets ids by exact name.
  const edited = relinkIngredients([{ item: 'plain greek yogurt', amount: 1, unit: 'cup' }, { item: 'honey', amount: 1, unit: 'tbsp' }], starter);
  assert.deepEqual(edited, [{ item: 'plain greek yogurt', amount: 1, unit: 'cup', usda_id: 7 }, { item: 'honey', amount: 1, unit: 'tbsp' }]);
  assert.deepEqual(relinkIngredients([{ item: 'x' }], null), [{ item: 'x' }]);
  assert.deepEqual(relinkIngredients('nope', starter), []);
});

test('the shared starter fixes turn the old starters into the built-in ones', async () => {
  const { STARTER_FIXES, fixFor } = await load();
  const starters = require('../lib/starters/recipes');
  const now = starters.flatMap((r) => r.ingredients);
  for (const f of STARTER_FIXES) {
    assert.ok(now.some((i) => i.item === f.now.item && i.amount === f.now.amount && i.unit === f.now.unit), `${f.now.item} ${f.now.amount} ${f.now.unit}`);
    assert.equal(fixFor({ ...f.was, section: 'x' }), f);
    assert.equal(fixFor(f.now), null);
  }
});

test('updatedStarter recalculates, marks the source and swaps the old estimates note', async () => {
  const { updatedStarter, USDA_NOTE, ESTIMATE_NOTE } = await load();
  const starter = { ingredients: [{ item: 'eggs', amount: 2, unit: 'each', usda_id: 1 }] };
  const recipe = { id: 'Eggs', version: 'abc', name: 'Eggs', servings: 1, per_serving: { net_carbs: 0, protein: 10, fiber: 0, extra: 'kept' }, ingredients: [{ item: 'eggs', amount: 2, unit: 'each' }], note: ESTIMATE_NOTE, starter: true, tags: ['eggs'] };
  const out = updatedStarter(recipe, starter, foods());
  assert.equal(out.recipe.per_serving.protein, 12.6);
  assert.equal(out.recipe.per_serving.extra, 'kept');
  assert.equal(out.recipe.per_serving_source, 'usda');
  assert.equal(out.recipe.note, USDA_NOTE);
  assert.equal(out.recipe.id, undefined);
  assert.equal(out.recipe.version, undefined);
  assert.deepEqual(out.recipe.tags, ['eggs']);
  assert.equal(out.calc.matched, 1);
  // A second run changes nothing; a custom note stays.
  assert.equal(updatedStarter({ ...out.recipe, id: 'Eggs', version: 'def' }, starter, foods()), null);
  assert.equal(updatedStarter({ ...recipe, note: 'Mine' }, starter, foods()).recipe.note, 'Mine');
  assert.equal(updatedStarter(null, starter, foods()), null);
});

test('updatedStarter skips a recipe it would zero out or can not divide', async () => {
  const { updatedStarter } = await load();
  const starter = { ingredients: [{ item: 'eggs', amount: 2, unit: 'each', usda_id: 1 }] };
  const recipe = { name: 'Eggs', servings: 1, per_serving: { protein: 10 }, ingredients: [{ item: 'eggs', amount: 2, unit: 'each' }], starter: true };
  assert.deepEqual(updatedStarter(recipe, null, foods()), { skip: 'not a built-in starter' });
  assert.deepEqual(updatedStarter({ ...recipe, ingredients: [{ item: 'eggs' }] }, { ingredients: [{ item: 'eggs' }] }, foods()), { skip: 'no ingredients matched a USDA food' });
  assert.deepEqual(updatedStarter(recipe, starter, new Map()), { skip: 'no ingredients matched a USDA food' });
  for (const servings of [0, 0.25, '2', null, undefined, NaN, Infinity]) {
    assert.deepEqual(updatedStarter({ ...recipe, servings }, starter, foods()), { skip: 'servings is not a number of 0.5 or more' }, String(servings));
  }
  assert.ok(updatedStarter({ ...recipe, servings: 0.5 }, starter, foods()).recipe);
});

test('isLinked agrees with what linkedIds and the counts treat as linked', async () => {
  const { isLinked, linkedIds, recipeCalc } = await load();
  const cases = [1, '1', ' 2 ', 0, '', '   ', null, undefined, NaN, Infinity, {}, [], true];
  for (const usda_id of cases) {
    const ing = { item: 'x', amount: 1, unit: 'g', usda_id };
    assert.equal(isLinked(ing), linkedIds([ing]).length === 1, String(usda_id));
    const notLinked = recipeCalc([ing], foods(), 1).unmatched.some((u) => u.why === 'not linked');
    assert.equal(isLinked(ing), !notLinked, String(usda_id));
  }
  assert.equal(isLinked(null), false);
});

test('updatedStarter skips a recipe with a linked ingredient it can not weigh', async () => {
  const { updatedStarter } = await load();
  const starter = { ingredients: [{ item: 'eggs', amount: 2, unit: 'each', usda_id: 1 }, { item: 'oil', amount: 1, unit: 'bunch', usda_id: 2 }, { item: 'salt' }, { item: 'pepper' }] };
  const recipe = { name: 'Eggs', servings: 1, per_serving: {}, starter: true, ingredients: starter.ingredients.map(({ usda_id, ...i }) => i) };
  assert.deepEqual(updatedStarter(recipe, starter, foods()), { skip: 'not counted: oil (can\'t weigh "bunch")' });
  // Unlinked lines with no amount (salt, pepper to taste) don't block it.
  const ok = { ...starter, ingredients: starter.ingredients.filter((i) => i.item !== 'oil') };
  const out = updatedStarter({ ...recipe, ingredients: recipe.ingredients.filter((i) => i.item !== 'oil') }, ok, foods());
  assert.equal(out.calc.matched, 1);
});

test('uncountedLinked lists every linked line left out, including a blank amount', async () => {
  const { recipeCalc, uncountedLinked, uncountedText } = await load();
  const calc = recipeCalc([
    { item: 'eggs', amount: 2, unit: 'each', usda_id: 1 },
    { item: 'oil', amount: 1, unit: 'handful', usda_id: 2 },
    { item: 'ghost', amount: 1, unit: 'g', usda_id: 99 },
    { item: 'salmon', usda_id: 1 },
    { item: 'salt', amount: 1, unit: 'tsp' },
    { item: 'pepper' },
  ], foods(), 1);
  const left = uncountedLinked(calc);
  assert.deepEqual(left.map((u) => u.item), ['oil', 'ghost', 'salmon']);
  assert.equal(uncountedText(left), 'oil (can\'t weigh "handful"), ghost (food not found), salmon (no amount)');
  assert.deepEqual(uncountedLinked(null), []);
});

test('relinkIngredients keeps a different USDA id the note already has', async () => {
  const { relinkIngredients } = await load();
  const starter = { ingredients: [
    { item: 'plain greek yogurt', amount: 8, unit: 'oz', usda_id: 7 },
    { item: 'eggs', amount: 2, unit: 'each', usda_id: 1 },
  ] };
  const out = relinkIngredients([
    { item: 'plain greek yogurt', amount: 1, unit: 'cup', usda_id: 170903 },
    { item: 'eggs', amount: 2, unit: 'each', usda_id: '1' },
  ], starter);
  // Its own food, its own amount: the fix only follows the starter's food.
  assert.deepEqual(out[0], { item: 'plain greek yogurt', amount: 1, unit: 'cup', usda_id: 170903 });
  assert.deepEqual(out[1], { item: 'eggs', amount: 2, unit: 'each', usda_id: 1 });
});

test('updatedStarter skips a recipe whose main ingredient lost its amount', async () => {
  const { updatedStarter } = await load();
  const starter = { ingredients: [{ item: 'eggs', amount: 2, unit: 'each', usda_id: 1 }, { item: 'oil', amount: 1, unit: 'tbsp', usda_id: 2 }, { item: 'pepper', amount: null, unit: '' }] };
  const base = { name: 'Eggs', servings: 1, per_serving: {}, starter: true };
  const toTaste = updatedStarter({ ...base, ingredients: [{ item: 'eggs', amount: 2, unit: 'each' }, { item: 'oil', amount: 1, unit: 'tbsp' }, { item: 'pepper', amount: null, unit: '' }] }, starter, foods());
  assert.equal(toTaste.calc.matched, 2);
  const cleared = updatedStarter({ ...base, ingredients: [{ item: 'eggs', amount: 2, unit: 'each' }, { item: 'oil', amount: null, unit: 'tbsp' }, { item: 'pepper', amount: null, unit: '' }] }, starter, foods());
  assert.deepEqual(cleared, { skip: 'not counted: oil (no amount)' });
});

test('a hand-chosen USDA id that no longer exists skips only that recipe', async () => {
  const { updatedStarter } = await load();
  const starter = { ingredients: [{ item: 'eggs', amount: 2, unit: 'each', usda_id: 1 }, { item: 'oil', amount: 1, unit: 'tbsp', usda_id: 2 }] };
  const base = { servings: 1, per_serving: {}, starter: true };
  const gone = updatedStarter({ ...base, name: 'A', ingredients: [{ item: 'eggs', amount: 2, unit: 'each' }, { item: 'oil', amount: 1, unit: 'tbsp', usda_id: 424242 }] }, starter, foods());
  assert.deepEqual(gone, { skip: 'not counted: oil (food not found)' });
  const fine = updatedStarter({ ...base, name: 'B', ingredients: [{ item: 'eggs', amount: 2, unit: 'each' }, { item: 'oil', amount: 1, unit: 'tbsp' }] }, starter, foods());
  assert.equal(fine.calc.matched, 2);
});

test('none of the built-in starters warns in the editor', async () => {
  const { recipeCalc, uncountedLinked } = await load();
  const starters = require('../lib/starters/recipes');
  const foodsById = new Map(JSON.parse(require('node:fs').readFileSync(path.join(__dirname, '..', 'data', 'usda-foods.json'), 'utf8')).map((f) => [String(f.id), f]));
  for (const r of starters) {
    assert.deepEqual(uncountedLinked(recipeCalc(r.ingredients, foodsById, r.servings)), [], r.name);
    for (const i of r.ingredients) if (i.amount === null) assert.equal(i.usda_id, undefined, `${r.name}: ${i.item} is "to taste" but linked`);
  }
});

test('a note seeded with pepper linked but no amount drops that link and updates', async () => {
  const { relinkIngredients, updatedStarter } = await load();
  const starter = { ingredients: [
    { item: 'eggs', amount: 2, unit: 'each', usda_id: 1 },
    { item: 'black pepper', amount: null, unit: '' },
    { item: 'oil', amount: 1, unit: 'tbsp', usda_id: 2 },
  ] };
  const seeded = [
    { item: 'eggs', amount: 2, unit: 'each', usda_id: 1 },
    { item: 'black pepper', amount: null, unit: '', usda_id: 170931 },
    { item: 'oil', amount: 1, unit: 'tbsp', usda_id: 2 },
  ];
  assert.deepEqual(relinkIngredients(seeded, starter)[1], { item: 'black pepper', amount: null, unit: '' });
  const out = updatedStarter({ name: 'Eggs', servings: 1, per_serving: {}, starter: true, ingredients: seeded }, starter, foods());
  assert.ok(out && !out.skip, JSON.stringify(out));
  assert.equal(out.calc.matched, 2);
  assert.equal(out.recipe.ingredients[1].usda_id, undefined);
  // A line given an amount keeps its own link.
  const measured = relinkIngredients([seeded[0], { ...seeded[1], amount: 1, unit: 'tsp' }, seeded[2]], starter);
  assert.equal(measured[1].usda_id, 170931);
});
