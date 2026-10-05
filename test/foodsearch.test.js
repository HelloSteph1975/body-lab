const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFoodIndex } = require('../lib/foodsearch');

const f = (id, name, group = 'Other') => ({ id, name, group, tags: [], per100: { kcal: 1, protein: 1, carbs: 0, fiber: 0, fat: 0 }, portions: [] });
const foods = [
  f(1, 'Egg, whole, cooked, hard-boiled', 'Dairy and Egg Products'),
  f(2, 'Egg, whole, raw, fresh', 'Dairy and Egg Products'),
  f(3, 'Egg Beaters, fat free product'),
  f(4, 'Apples, raw, with skin', 'Fruits and Fruit Juices'),
  f(5, 'Apple juice, canned', 'Fruits and Fruit Juices'),
  f(6, 'Apple pie'),
  f(7, 'Chicken, broilers or fryers, breast, meat only, raw', 'Poultry Products'),
  f(8, 'Chicken breast tenders, breaded'),
  f(9, 'Beef, ground, raw', 'Beef Products'),
  f(10, 'Bread, raw dough'),
];
const names = (r) => r.map((x) => x.name);

test('every query word must start a name word, in any order', () => {
  const idx = createFoodIndex(foods);
  assert.deepEqual(names(idx.search('breast chick')).sort(), ['Chicken breast tenders, breaded', 'Chicken, broilers or fryers, breast, meat only, raw']);
  assert.deepEqual(idx.search('ggs'), []);
  assert.deepEqual(names(idx.search('EGG whole')), ['Egg, whole, raw, fresh', 'Egg, whole, cooked, hard-boiled']);
});

test('words split on anything that is not a letter or digit', () => {
  const idx = createFoodIndex(foods);
  assert.equal(idx.search('hard boiled').length, 1);
  assert.equal(idx.search('hard-boiled').length, 1);
});

test('empty or one-character queries return nothing', () => {
  const idx = createFoodIndex(foods);
  assert.deepEqual(idx.search(''), []);
  assert.deepEqual(idx.search('a'), []);
  assert.deepEqual(idx.search('  e '), []);
  assert.deepEqual(idx.search(null), []);
});

test('whole words beat prefix-only matches, and a plural s is the same word', () => {
  const idx = createFoodIndex([f(1, 'Eggnog'), f(2, 'Eggplant, raw'), f(3, 'Eggs, scrambled'), f(4, 'Egg, whole')]);
  assert.deepEqual(names(idx.search('egg')).slice(0, 2).sort(), ['Egg, whole', 'Eggs, scrambled']);
  assert.equal(idx.search('egg')[0].name, 'Egg, whole');
  // Only the last word may be half-typed: "chick bre" needs "chick" whole, so it still matches by prefix but ranks after whole words.
  const idx2 = createFoodIndex([f(1, 'Chickpea, breast'), f(2, 'Chick, breast')]);
  assert.equal(idx2.search('chick breast')[0].name, 'Chick, breast');
  assert.equal(idx2.search('chick bre').length, 2);
});

test('a first segment that is the query beats one that merely contains it', () => {
  const idx = createFoodIndex([f(1, 'Strudel, apple'), f(2, 'Apple pie, home'), f(3, 'Apples, raw'), f(4, 'Apple')]);
  assert.deepEqual(names(idx.search('apple')), ['Apple', 'Apples, raw', 'Apple pie, home', 'Strudel, apple']);
});

test('everyday foods beat brands and prepared groups, then raw wins, then fewer segments', () => {
  const idx = createFoodIndex([
    f(1, 'Kiwi, Oscar Mayer'),
    f(2, 'Kiwi, snack', 'Snacks'),
    f(3, 'Kiwi, green, cooked', 'Fruits and Fruit Juices'),
    f(4, 'Kiwi, green, raw', 'Fruits and Fruit Juices'),
    f(5, 'Kiwi, plain'),
  ]);
  assert.deepEqual(names(idx.search('kiwi')), ['Kiwi, green, raw', 'Kiwi, plain', 'Kiwi, green, cooked', 'Kiwi, snack', 'Kiwi, Oscar Mayer']);
});

test('processed forms drop below plain ones', () => {
  const idx = createFoodIndex([f(1, 'Egg, yolk, dried'), f(2, 'Egg, whole, raw, fresh')]);
  assert.deepEqual(names(idx.search('egg')), ['Egg, whole, raw, fresh', 'Egg, yolk, dried']);
});

const realFile = path.join(__dirname, '..', 'data', 'usda-foods.json');
const real = fs.existsSync(realFile) ? createFoodIndex(JSON.parse(fs.readFileSync(realFile, 'utf8'))) : null;
const top = (q, n) => names(real.search(q, n));
const realTest = (name, fn) => test(name, { skip: !real && 'data/usda-foods.json is missing' }, fn);

realTest('real data: egg has a plain whole egg in the top 3', () => {
  assert.ok(top('egg', 3).some((n) => /^Egg, whole, (raw|cooked)/.test(n)), top('egg', 3).join(' | '));
});
realTest('real data: chicken breast has a plain chicken breast in the top 3', () => {
  assert.ok(top('chicken breast', 3).some((n) => /^Chicken, broilers? or fryers, breast.*meat only/.test(n)), top('chicken breast', 3).join(' | '));
});
realTest('real data: apple has raw apples in the top 3', () => {
  assert.ok(top('apple', 3).some((n) => /^Apples, raw/.test(n)), top('apple', 3).join(' | '));
});
realTest('real data: salmon has plain salmon in the top 3', () => {
  assert.ok(top('salmon', 3).some((n) => /^Fish, salmon, [a-z ]+, (raw|cooked)/.test(n)), top('salmon', 3).join(' | '));
});
realTest('real data: broccoli puts Broccoli, raw first', () => {
  assert.equal(top('broccoli', 1)[0], 'Broccoli, raw');
});
realTest('real data: olive oil puts plain olive oil first', () => {
  assert.equal(top('olive oil', 1)[0], 'Oil, olive, salad or cooking');
});
realTest('real data: greek yogurt has plain Greek yogurt in the top 3', () => {
  assert.ok(top('greek yogurt', 3).some((n) => /^Yogurt, Greek, plain/.test(n)), top('greek yogurt', 3).join(' | '));
});

test('limit caps results and byId finds a food', () => {
  const idx = createFoodIndex(foods);
  assert.equal(idx.search('egg', 2).length, 2);
  assert.equal(idx.byId(4).name, 'Apples, raw, with skin');
  assert.equal(idx.byId('4').id, 4);
  assert.equal(idx.byId(999), null);
});

test('bad food lists do not throw', () => {
  const idx = createFoodIndex([null, { id: 1 }, f(2, 'Okra, raw')]);
  assert.deepEqual(names(idx.search('okra')), ['Okra, raw']);
  assert.deepEqual(createFoodIndex(undefined).search('okra'), []);
});

test('huge queries are capped and return quickly', () => {
  const idx = createFoodIndex(foods);
  const huge = Array.from({ length: 5000 }, (_, i) => `egg${i % 7 ? '' : 'x'}`).join(' ');
  const t0 = Date.now();
  idx.search(huge);
  idx.search('e'.repeat(50000));
  assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
  // Only the first 8 words count, so a long query of real words still finds the food.
  assert.deepEqual(names(idx.search(`egg ${'whole '.repeat(20)}`)), names(idx.search('egg whole')));
  assert.ok(names(idx.search('egg whole')).length > 0);
});

realTest('real data: a 5,000-word query returns quickly', () => {
  const huge = Array.from({ length: 5000 }, (_, i) => ['c', 'r', 'chicken'][i % 3]).join(' ');
  const t0 = Date.now();
  real.search(huge);
  real.search('c '.repeat(5000));
  assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms`);
});
