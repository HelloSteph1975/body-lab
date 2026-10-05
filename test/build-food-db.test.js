const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCsv, buildFoods, tagsFor, writeFoods } = require('../tools/build-food-db');

const FIXTURE = path.join(__dirname, 'fixtures', 'usda');

test('parseCsv handles quoted commas, doubled quotes, CRLF and a missing final newline', () => {
  const rows = parseCsv('"a","b, c","say ""hi"""\r\n"1","","x"');
  assert.deepEqual(rows, [['a', 'b, c', 'say "hi"'], ['1', '', 'x']]);
});

test('buildFoods reads the fixture folder', () => {
  const foods = buildFoods(FIXTURE);
  assert.equal(foods.length, 5, 'water has no energy or protein, so it is skipped');
  const by = Object.fromEntries(foods.map((f) => [f.name, f]));
  const egg = by['Egg, whole, raw, fresh'];
  assert.equal(egg.id, 100001);
  assert.equal(egg.group, 'Dairy and Egg Products');
  assert.deepEqual(egg.per100, { kcal: 143, protein: 12.6, carbs: 0.7, fiber: 0, fat: 9.5 });
  assert.deepEqual(egg.tags, ['eggs']);
  assert.deepEqual(egg.portions, [{ label: '1 large', g: 50 }, { label: '100 g', g: 100 }, { label: '1 oz', g: 28.35 }]);
  assert.deepEqual(by['Beef, rib eye steak, raw'].tags, ['meat']);
  assert.deepEqual(by['Bananas, raw'].tags, ['fruit', 'fruit-high-sugar']);
  assert.deepEqual(by['Strawberries, raw'].tags, ['fruit']);
  assert.deepEqual(by['Bananas, raw'].portions[0], { label: '1 medium', g: 118 }, 'undetermined unit uses the modifier');
  const almonds = by['Nuts, almonds'];
  assert.deepEqual(almonds.tags, ['nut']);
  assert.deepEqual(almonds.portions.slice(0, 2), [{ label: '1 cup', g: 143 }, { label: '1 almond', g: 1.2 }]);
  assert.equal(by['Strawberries, raw'].portions.length, 2, 'a zero-gram portion is dropped');
});

test('tagsFor follows the group table', () => {
  const p = (carbs = 0, fiber = 0) => ({ kcal: 100, protein: 5, carbs, fiber, fat: 1 });
  const cases = [
    ['Beef Products', 'Beef, x', ['meat']],
    ['Pork Products', 'Pork, x', ['meat']],
    ['Lamb, Veal, and Game Products', 'Lamb, x', ['meat']],
    ['Sausages and Luncheon Meats', 'Salami', ['meat', 'processed']],
    ['Poultry Products', 'Chicken', ['meat']],
    ['Finfish and Shellfish Products', 'Fish, salmon', ['fish']],
    ['Dairy and Egg Products', 'Egg, whole', ['eggs']],
    ['Dairy and Egg Products', 'Eggs, scrambled', ['eggs']],
    ['Dairy and Egg Products', 'Eggnog', ['dairy']],
    ['Dairy and Egg Products', 'Egg substitute, liquid', ['eggs']],
    ['Dairy and Egg Products', 'Cheese, brie', ['dairy']],
    ['Vegetables and Vegetable Products', 'Kale', ['vegetable']],
    ['Fruits and Fruit Juices', 'Apples, raw', ['fruit'], p(14, 2.4)],
    ['Fruits and Fruit Juices', 'Grapes', ['fruit', 'fruit-high-sugar'], p(18, 1)],
    ['Fruits and Fruit Juices', 'Odd fruit', ['fruit'], p(2, 9)],
    ['Legumes and Legume Products', 'Beans', ['legume']],
    ['Cereal Grains and Pasta', 'Rice', ['grain']],
    ['Baked Products', 'Bread', ['grain', 'processed']],
    ['Breakfast Cereals', 'Cornflakes', ['grain', 'processed']],
    ['Nut and Seed Products', 'Nuts, almonds', ['nut']],
    ['Nut and Seed Products', 'Seeds, chia seeds', ['seed']],
    ['Fats and Oils', 'Oil, olive', ['oil']],
    ['Sweets', 'Candy', ['sugar']],
    ['Beverages', 'Coffee', ['drink']],
    ['Fast Foods', 'Burger', ['processed']],
    ['Meals, Entrees, and Side Dishes', 'Lasagna', ['processed']],
    ['Snacks', 'Chips', ['processed']],
    ['Restaurant Foods', 'Fries', ['processed']],
    ['Spices and Herbs', 'Basil', []],
    ['Soups, Sauces, and Gravies', 'Soup', []],
    ['Baby Foods', 'Puree', []],
    ['American Indian/Alaska Native Foods', 'Acorn stew', []],
    ['Something New', 'Thing', []],
  ];
  for (const [group, name, tags, per] of cases) {
    assert.deepEqual(tagsFor(group, name, per || p()), tags, `${group} / ${name}`);
  }
});

test('writeFoods puts one food per line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bodylab-usda-'));
  try {
    const out = path.join(dir, 'out.json');
    writeFoods(buildFoods(FIXTURE), out);
    const text = fs.readFileSync(out, 'utf8');
    const lines = text.trim().split('\n');
    assert.equal(lines.length, 7);
    assert.equal(lines[0], '[');
    assert.equal(lines[6], ']');
    assert.equal(JSON.parse(text).length, 5);
    assert.ok(lines[1].endsWith(','));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
