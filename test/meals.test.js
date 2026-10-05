const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'meals.js')).href);

const recipes = [
  { name: 'Salmon Plate', servings: 2, tags: ['fish', 'vegetable'], per_serving: { net_carbs: 6, protein: 34, fiber: 4 },
    ingredients: [{ item: 'Salmon fillet', amount: 12, unit: 'oz', section: 'meat & seafood' }, { item: 'broccoli', amount: 2, unit: 'cup', section: 'produce' }, { item: 'olive oil', amount: null, unit: '', section: 'pantry' }] },
  { name: 'Egg Muffins', servings: 6, tags: ['eggs', 'vegetable', 'dairy'], per_serving: { net_carbs: 1, protein: 7, fiber: 0.5 },
    ingredients: [{ item: 'eggs', amount: 8, unit: 'each', section: 'dairy & eggs' }, { item: 'Broccoli', amount: 1, unit: 'cup', section: 'produce' }, { item: 'broccoli', amount: 100, unit: 'g', section: 'produce' }] },
];
const plan = {
  week_start: '2026-10-05',
  meals: [
    { id: 'p1', date: '2026-10-05', slot: 'dinner', recipe: 'Salmon Plate', servings: 1 },
    { id: 'p2', date: '2026-10-05', slot: 'breakfast', recipe: 'Egg Muffins', servings: 3 },
    { id: 'p3', date: '2026-10-06', slot: 'dinner', recipe: 'Salmon Plate', servings: 2 },
    { id: 'p4', date: '2026-10-06', slot: 'lunch', recipe: 'Gone Recipe', servings: 1 },
  ],
  shopping: { checked: ['salmon fillet|oz'], extras: [{ id: 'x1', item: 'coffee', section: 'pantry', checked: false }] },
};

test('shopping list scales, combines by item and unit, groups by section', async () => {
  const m = await load();
  const list = m.shoppingList(plan, recipes);
  const flat = Object.fromEntries(list.sections.flatMap((s) => s.items.map((i) => [i.key, i])));
  assert.equal(flat['salmon fillet|oz'].amount, 18);
  assert.equal(flat['salmon fillet|oz'].checked, true);
  assert.equal(flat['broccoli|cup'].amount, 3.5);
  assert.equal(flat['broccoli|g'].amount, 50);
  assert.equal(flat['eggs|each'].amount, 4);
  assert.equal(flat['olive oil|'].amount, null);
  assert.deepEqual(flat['broccoli|cup'].recipes, ['Egg Muffins', 'Salmon Plate']);
  assert.deepEqual(list.sections.map((s) => s.section), ['produce', 'meat & seafood', 'dairy & eggs', 'pantry']);
  assert.deepEqual(list.extras.map((x) => x.item), ['coffee']);
  assert.deepEqual(list.missing, ['Gone Recipe']);
});

test('planned day totals multiply per-serving numbers', async () => {
  const m = await load();
  assert.deepEqual(m.plannedDayTotals(plan, recipes, '2026-10-05'), { net_carbs: 9, protein: 55, fiber: 5.5, fat: 0, kcal: 0 });
  assert.deepEqual(m.plannedDayTotals(plan, recipes, '2026-10-09'), { net_carbs: 0, protein: 0, fiber: 0, fat: 0, kcal: 0 });
  const withKcal = recipes.map((r) => ({ ...r, per_serving: { ...r.per_serving, fat: 10, kcal: 200 } }));
  const t = m.plannedDayTotals(plan, withKcal, '2026-10-05');
  assert.equal(t.fat, 40);
  assert.equal(t.kcal, 800);
});

test('eating window, including one that crosses midnight', async () => {
  const m = await load();
  assert.equal(m.inWindow('12:00', { start: '12:00', end: '20:00' }), true);
  assert.equal(m.inWindow('20:00', { start: '12:00', end: '20:00' }), true);
  assert.equal(m.inWindow('20:01', { start: '12:00', end: '20:00' }), false);
  assert.equal(m.inWindow('23:00', { start: '22:00', end: '06:00' }), true);
  assert.equal(m.inWindow('05:00', { start: '22:00', end: '06:00' }), true);
  assert.equal(m.inWindow('12:00', { start: '22:00', end: '06:00' }), false);
  assert.equal(m.inWindow('03:00', null), true);
  assert.equal(m.inWindow('', { start: '12:00', end: '20:00' }), true);
});

test('diet flags: window, avoid tags, only tags, avoid words, untagged items', async () => {
  const m = await load();
  const keto = { name: 'Keto', avoid_tags: ['grain', 'sugar'], avoid_words: ['bread', 'soda'] };
  const fasting = { name: 'IF', add_on: true, eating_window: { start: '12:00', end: '20:00' } };
  const carnivore = { name: 'Carnivore', only_tags: ['meat', 'fish', 'eggs', 'dairy'] };
  const foods = [{ name: 'Rice', tags: ['grain'] }, { name: 'Steak', tags: ['meat'] }, { name: 'Apple', tags: ['fruit'] }];
  const meal = { time: '08:00', items: [{ food: 'rice' }, { food: 'Garlic bread' }, { food: 'Steak' }, { food: 'Mystery thing' }] };
  const flags = m.dietFlags(meal, { diet: keto, addOn: fasting, foods, recipes });
  assert.deepEqual(flags, [
    'Eaten outside your eating window (12:00–20:00).',
    'Rice: grain is on the Keto avoid list.',
    'Garlic bread: "bread" is on the Keto avoid list.',
  ]);
  const c = m.dietFlags({ time: '13:00', items: [{ food: 'Steak' }, { food: 'Apple' }, { food: 'Salmon Plate' }] }, { diet: carnivore, foods, recipes });
  assert.deepEqual(c, ['Apple: fruit isn\'t part of Carnivore.', 'Salmon Plate: vegetable isn\'t part of Carnivore.']);
  assert.deepEqual(m.dietFlags(meal, { diet: null, addOn: null, foods, recipes }), []);
});

test('ateThisEntry builds a meal entry from a planned recipe', async () => {
  const m = await load();
  const e = m.ateThisEntry(plan.meals[1], recipes[1], '07:45');
  assert.deepEqual(e, { time: '07:45', kind: 'breakfast', recipe: 'Egg Muffins', planned_id: 'p2',
    items: [{ food: 'Egg Muffins', qty: 3, net_carbs: 3, protein: 21, fiber: 1.5, fat: 0, kcal: 0 }] });
  const f = m.ateThisEntry(plan.meals[1], { ...recipes[1], per_serving: { ...recipes[1].per_serving, fat: 5, kcal: 80 } }, '07:45');
  assert.equal(f.items[0].fat, 15);
  assert.equal(f.items[0].kcal, 240);
});

// ---- Robustness: AI tools and hand edits write malformed data ----

test('shopping list survives malformed plans, recipes and ingredients', async () => {
  const m = await load();
  const bad = [
    { plan: null, recipes: null },
    { plan: { meals: 'oops', shopping: { checked: 'x', extras: 5 } }, recipes: 'nope' },
    { plan: { meals: [null, 3, 'x', { recipe: null }, { recipe: 'A', servings: 'many' }], shopping: { checked: [null, 4], extras: [null, 'x', { id: 'x1', item: 'tea' }] } },
      recipes: [null, 7, { name: 'A', servings: 0, ingredients: 'bad' }, { ingredients: [] }] },
  ];
  for (const { plan: p, recipes: r } of bad) {
    const list = m.shoppingList(p, r);
    assert.ok(Array.isArray(list.sections) && Array.isArray(list.extras) && Array.isArray(list.missing));
  }
  const odd = m.shoppingList({ meals: [{ recipe: 'A', servings: '3' }, { recipe: 'a', servings: -2 }, { recipe: 'Zed' }, { recipe: 'zed' }, { recipe: 42 }, { recipe: '' }],
    shopping: { extras: [null, 'x', { id: 'x1', item: 'tea', section: 'pantry' }] } },
  [{ name: 'A', servings: '2', ingredients: [null, 'x', { item: '  ', amount: 1 }, { item: 'Oats', amount: '4', unit: 'Cups' }, { item: 'oats', amount: 1, unit: 'cup' }, { item: 'salt' }] }]);
  const flat = Object.fromEntries(list(odd).map((i) => [i.key, i]));
  // "3" servings of a 2-serving recipe = x1.5, bad -2 becomes 1 serving = x0.5; 4*2 + 1*2 = 10 cups
  assert.equal(flat['oats|cup'].amount, 10);
  assert.equal(flat['oats|cup'].unit, 'Cups');
  assert.equal(flat['salt|'].amount, null);
  assert.deepEqual(odd.missing, ['Zed']);
  assert.deepEqual(odd.extras.map((x) => x.item), ['tea']);
  function list(l) { return l.sections.flatMap((s) => s.items); }
});

test('day totals, diet flags and ateThisEntry never throw on bad input', async () => {
  const m = await load();
  const zero = { net_carbs: 0, protein: 0, fiber: 0, fat: 0, kcal: 0 };
  assert.deepEqual(m.plannedDayTotals(null, null, '2026-10-05'), zero);
  assert.deepEqual(m.plannedDayTotals({ meals: [null, 'x', { date: '2026-10-05', recipe: 'A' }] }, [null, { name: 'A', per_serving: 'bad' }], '2026-10-05'), zero);
  assert.deepEqual(m.plannedDayTotals({ meals: [{ date: 'd', recipe: 'A', servings: '2' }] }, [{ name: 'A', per_serving: { net_carbs: '3', protein: 'x' } }], 'd'), { net_carbs: 6, protein: 0, fiber: 0, fat: 0, kcal: 0 });
  assert.deepEqual(m.dietFlags(null), []);
  assert.deepEqual(m.dietFlags({ items: 'x' }, { diet: 'x', addOn: 5, foods: 'x', recipes: 'x' }), []);
  assert.deepEqual(m.dietFlags({ items: [null, 3, { food: null }, {}] }, { diet: { avoid_tags: 'grain', avoid_words: [null, 4] }, foods: [null, 1] }), []);
  assert.equal(m.ateThisEntry(null, { name: 'A' }, '08:00'), null);
  assert.equal(m.ateThisEntry({ id: 'p' }, null, '08:00'), null);
  const e = m.ateThisEntry({ id: 'p', slot: 'lunch', servings: 0 }, { name: 'A', per_serving: null }, '12:00');
  assert.deepEqual(e.items, [{ food: 'A', qty: 1, net_carbs: 0, protein: 0, fiber: 0, fat: 0, kcal: 0 }]);
});

test('servings: numeric strings count, zero and negatives become 1', async () => {
  const m = await load();
  const r = [{ name: 'A', servings: 1, per_serving: { net_carbs: 2, protein: 0, fiber: 0 } }];
  const t = (s) => m.plannedDayTotals({ meals: [{ date: 'd', recipe: 'A', servings: s }] }, r, 'd').net_carbs;
  assert.equal(t('3'), 6);
  assert.equal(t(0), 2);
  assert.equal(t(-4), 2);
  assert.equal(t(null), 2);
  assert.equal(t(1.5), 3);
});

test('inWindow handles unpadded and unparseable times', async () => {
  const m = await load();
  assert.equal(m.inWindow('9:30', { start: '8:00', end: '20:00' }), true);
  assert.equal(m.inWindow('7:59', { start: '8:00', end: '20:00' }), false);
  assert.equal(m.inWindow('12:00', { start: '8:00', end: '20:00' }), true);
  assert.equal(m.inWindow('garbage', { start: '12:00', end: '20:00' }), true);
  assert.equal(m.inWindow('10:00', { start: 'noon', end: '20:00' }), true);
  assert.equal(m.inWindow('03:00', { start: '12:00', end: '12:00' }), true);
  assert.equal(m.inWindow(null, { start: '12:00', end: '20:00' }), true);
});

test('diet tags are case-insensitive and an empty only_tags means unset', async () => {
  const m = await load();
  const foods = [{ name: 'Rice', tags: [' Grain '] }, { name: 'Steak', tags: ['MEAT'] }];
  const flags = m.dietFlags({ items: [{ food: 'rice' }, { food: 'steak' }] }, { diet: { name: 'K', avoid_tags: ['GRAIN'], only_tags: [] }, foods });
  assert.deepEqual(flags, ['Rice: grain is on the K avoid list.']);
  const c = m.dietFlags({ items: [{ food: 'steak' }] }, { diet: { name: 'C', only_tags: [' Meat '] }, foods });
  assert.deepEqual(c, []);
  assert.deepEqual(m.dietFlags({ items: [{ food: 'rice' }, { food: 'Rice' }] }, { diet: { avoid_tags: ['grain'] }, foods }), ["Rice: grain is on your diet's avoid list."]);
});

test('avoid words match whole words and only apply to untagged items', async () => {
  const m = await load();
  const diet = { name: 'Keto', avoid_words: ['rice'] };
  const foods = [{ name: 'Cauliflower rice', tags: ['vegetable'] }];
  const flag = (food) => m.dietFlags({ items: [{ food }] }, { diet, foods });
  assert.deepEqual(flag('Cauliflower rice'), []);
  assert.deepEqual(flag('white rice'), ['White rice: "rice" is on the Keto avoid list.']);
  assert.deepEqual(flag('Priceless gift'), []);
  assert.deepEqual(flag('Rice (brown)'), ['Rice (brown): "rice" is on the Keto avoid list.']);
});
