const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'nutrition.js')).href);

const egg = { id: 1, per100: { kcal: 143, protein: 12.6, carbs: 0.7, fiber: 0, fat: 9.5 },
  portions: [{ label: '1 large', g: 50 }, { label: '1 medium', g: 44 }, { label: '1 cup, chopped', g: 136 }, { label: '100 g', g: 100 }, { label: '1 oz', g: 28.35 }] };
const flour = { id: 2, per100: { kcal: 364, protein: 10, carbs: 76, fiber: 2.7, fat: 1 },
  portions: [{ label: '0.5 cup', g: 60 }, { label: '1 tablespoon', g: 8 }, { label: '1 tsp', g: 2.6 }, { label: '1 whole', g: 30 }, { label: '1 slice', g: 25 }] };

test('gramsFor converts direct units', async () => {
  const { gramsFor } = await load();
  assert.equal(gramsFor(150, 'g', []), 150);
  assert.equal(gramsFor(2, 'kg', []), 2000);
  assert.equal(gramsFor(2, 'oz', []), 56.7);
  assert.equal(gramsFor(1, 'lb', []), 453.6);
  assert.equal(gramsFor(1, 'LBS', []), 453.6);
});

test('gramsFor matches portion labels by unit word', async () => {
  const { gramsFor } = await load();
  assert.equal(gramsFor(3, 'large', egg.portions), 150);
  assert.equal(gramsFor(2, 'Cups', egg.portions), 272);
  assert.equal(gramsFor(1, 'cup', flour.portions), 120);
  assert.equal(gramsFor(2, 'tbsp', flour.portions), 16);
  assert.equal(gramsFor(3, 'teaspoons', flour.portions), 7.8);
  assert.equal(gramsFor(2, 'slices', flour.portions), 50);
});

test('"each" tries large, medium, then whole', async () => {
  const { gramsFor } = await load();
  assert.equal(gramsFor(2, 'each', egg.portions), 100);
  assert.equal(gramsFor(2, 'each', egg.portions.slice(1)), 88);
  assert.equal(gramsFor(2, 'each', flour.portions), 60);
  assert.equal(gramsFor(2, 'each', [{ label: '1 cup', g: 100 }]), null);
});

test('gramsFor returns null when it cannot tell', async () => {
  const { gramsFor } = await load();
  assert.equal(gramsFor(1, 'bunch', egg.portions), null);
  assert.equal(gramsFor('abc', 'g', []), null);
  assert.equal(gramsFor(null, 'g', []), null);
  assert.equal(gramsFor(1, '', egg.portions), null);
  assert.equal(gramsFor(1, 'cup', null), null);
  assert.equal(gramsFor(1, 'cup', [null, { label: 5 }, { label: '1 cup' }]), null);
});

test('nutrientsFor scales per 100 g, floors net carbs, rounds', async () => {
  const { nutrientsFor } = await load();
  assert.deepEqual(nutrientsFor(egg.per100, 50), { net_carbs: 0.4, protein: 6.3, fiber: 0, fat: 4.8, kcal: 72 });
  assert.equal(nutrientsFor({ kcal: 10, protein: 1, carbs: 2, fiber: 9, fat: 0 }, 100).net_carbs, 0);
  assert.deepEqual(nutrientsFor(null, 100), { net_carbs: 0, protein: 0, fiber: 0, fat: 0, kcal: 0 });
});

test('recipeFromIngredients sums matched ingredients per serving', async () => {
  const { recipeFromIngredients } = await load();
  const byId = new Map([[1, egg], [2, flour]]);
  const r = recipeFromIngredients([
    { item: 'eggs', amount: 4, unit: 'large', usda_id: 1 },
    { item: 'flour', amount: 1, unit: 'cup', usda_id: 2 },
    { item: 'salt', amount: 1, unit: 'pinch' },
    { item: 'mystery', amount: 1, unit: 'bunch', usda_id: 1 },
    { item: 'gone', amount: 1, unit: 'g', usda_id: 99 },
    null,
  ], byId, 2);
  assert.equal(r.matched, 2);
  assert.equal(r.total, 5);
  // 200 g egg + 120 g flour: protein 25.2 + 12 = 37.2, over 2 servings
  assert.equal(r.per_serving.protein, 18.6);
  assert.equal(r.per_serving.kcal, Math.round((286 + 436.8) / 2));
  assert.equal(r.per_serving.fat, 10.1);
});

test('recipeFromIngredients accepts a plain object, bad servings and junk', async () => {
  const { recipeFromIngredients } = await load();
  const r = recipeFromIngredients([{ amount: 100, unit: 'g', usda_id: 1 }], { 1: egg }, 0);
  assert.equal(r.per_serving.protein, 12.6);
  assert.deepEqual(recipeFromIngredients('nope', null, 2), { per_serving: { net_carbs: 0, protein: 0, fiber: 0, fat: 0, kcal: 0 }, matched: 0, total: 0 });
});

test('prototype names are not units or foods', async () => {
  const { gramsFor, recipeFromIngredients } = await load();
  for (const u of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(gramsFor(1, u, []), null, u);
    assert.equal(gramsFor(1, u, egg.portions), null, u);
  }
  for (const id of ['constructor', '__proto__', 'toString']) {
    const r = recipeFromIngredients([{ amount: 100, unit: 'g', usda_id: id }], { 1: egg }, 1);
    assert.equal(r.matched, 0, id);
  }
});

test('"each" falls back to a countable portion, preferring medium', async () => {
  const { gramsFor } = await load();
  const lemon = [{ label: '1 cup, sections', g: 212 }, { label: '1 fruit (2-1/8" dia)', g: 58 }, { label: '1 NLEA serving', g: 58 }];
  assert.equal(gramsFor(1, 'each', lemon), 58);
  const garlic = [{ label: '1 cup', g: 136 }, { label: '1 tsp', g: 2.8 }, { label: '1 clove', g: 3 }, { label: '3 cloves', g: 9 }];
  assert.equal(gramsFor(2, 'each', garlic), 6);
  const celery = [{ label: '1 cup chopped', g: 101 }, { label: '1 stalk, large (11" long)', g: 64 }, { label: '1 stalk, medium (8" long)', g: 40 }];
  assert.equal(gramsFor(3, 'each', celery), 120);
  // Measures, servings and packages never count as one of something.
  const measures = ['1 cup', '1 tbsp', '1 slice', '1 NLEA serving', '1 package (10 oz)', '1 can', '1 container', '10 strips', '1 oz', '100 g', '1 unit (yield from 1 lb)', '1 bunch', '1 wedge'];
  assert.equal(gramsFor(1, 'each', measures.map((label) => ({ label, g: 10 }))), null);
  // large, medium and whole still win over the fallback.
  assert.equal(gramsFor(1, 'each', [{ label: '1 clove', g: 3 }, { label: '1 whole', g: 40 }]), 40);
});

test('cups, tablespoons and teaspoons convert into each other', async () => {
  const { gramsFor } = await load();
  const walnuts = [{ label: '1 cup, chopped', g: 117 }, { label: '1 oz (14 halves)', g: 28.35 }];
  assert.equal(gramsFor(2, 'tbsp', walnuts), 14.625);
  assert.equal(gramsFor(3, 'tsp', walnuts), 7.3125);
  const olives = [{ label: '1 tbsp', g: 8.4 }, { label: '1 large', g: 4.4 }];
  assert.equal(gramsFor(0.5, 'cup', olives), 67.2);
  // A real label for the unit wins over a converted one.
  assert.equal(gramsFor(1, 'tbsp', [{ label: '1 cup', g: 160 }, { label: '1 tbsp', g: 9 }]), 9);
  assert.equal(gramsFor(1, 'cup', [{ label: '1 large', g: 50 }]), null);
});
