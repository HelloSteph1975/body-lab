const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'meals.js')).href);

const keto = { name: 'Keto', eating_window: null, avoid_tags: ['grain'] };
const fasting = { name: 'Intermittent fasting', add_on: true, eating_window: { start: '12:00', end: '20:00' } };
const win = { start: '10:00', end: '18:00' };

// ---- effectiveRules ----

test('effectiveRules: an add-on-only setup gets the Goals window', async () => {
  const m = await load();
  const r = m.effectiveRules(null, fasting, win);
  assert.equal(r.diet, null);
  assert.deepEqual(r.addOn.eating_window, win);
  assert.deepEqual(fasting.eating_window, { start: '12:00', end: '20:00' }, 'input not mutated');
  assert.deepEqual(m.dietFlags({ time: '09:00', items: [] }, r), ['Eaten outside your eating window (10:00–18:00).']);
  assert.deepEqual(m.dietFlags({ time: '19:00', items: [] }, r), ['Eaten outside your eating window (10:00–18:00).']);
  assert.deepEqual(m.dietFlags({ time: '12:30', items: [] }, r), []);
});

test('effectiveRules: main + add-on puts the window on the add-on only, so flags agree', async () => {
  const m = await load();
  const mainWithWindow = { ...keto, eating_window: { start: '08:00', end: '16:00' } };
  const r = m.effectiveRules(keto, fasting, win);
  assert.equal(r.diet.eating_window, null);
  assert.deepEqual(r.addOn.eating_window, win);
  assert.notEqual(r.diet, keto, 'a copy');
  assert.deepEqual(m.dietFlags({ time: '17:00', items: [] }, r), []);
  // When only the main diet has a window, it gets the override.
  const r2 = m.effectiveRules(mainWithWindow, { name: 'Other add-on', add_on: true }, win);
  assert.deepEqual(r2.diet.eating_window, win);
  assert.equal(r2.addOn.eating_window, undefined);
  assert.deepEqual(mainWithWindow.eating_window, { start: '08:00', end: '16:00' });
});

test('effectiveRules: a malformed or missing window leaves the diets as they are', async () => {
  const m = await load();
  for (const bad of [null, undefined, 'noon', ['12:00', '20:00'], { start: '12:00' }, { start: 5, end: 9 }, { start: '', end: '20:00' }]) {
    const r = m.effectiveRules(keto, fasting, bad);
    assert.deepEqual(r.addOn.eating_window, { start: '12:00', end: '20:00' }, JSON.stringify(bad));
    assert.deepEqual(r.diet, keto);
  }
});

test('effectiveRules: no diet has a window, so the override goes nowhere', async () => {
  const m = await load();
  const r = m.effectiveRules(keto, null, win);
  assert.equal(r.diet.eating_window, null);
  assert.equal(r.addOn, null);
  assert.deepEqual(m.effectiveRules(null, null, win), { diet: null, addOn: null });
  assert.deepEqual(m.effectiveRules('x', [1], win), { diet: null, addOn: null });
});

// ---- plan normalizing and extras ----

test('normalizePlan fills missing collections and gives every extra a stable, content-based id', async () => {
  const m = await load();
  const raw = { week_start: '2026-10-05', meals: [], custom: 1, shopping: { checked: ['a|oz', 3], extras: [{ item: 'coffee' }, 'junk', { id: 'x1', item: 'tea' }, { item: 'milk', checked: true }], note: 'kept' } };
  const p = m.normalizePlan(raw);
  assert.deepEqual(p.prep, []);
  assert.equal(p.custom, 1);
  assert.equal(p.shopping.note, 'kept');
  assert.deepEqual(p.shopping.checked, ['a|oz', 3], 'odd entries survive');
  assert.equal(p.shopping.extras[1], 'junk', 'odd entries survive');
  const ids = (q) => q.shopping.extras.filter((x) => x && typeof x === 'object').map((x) => x.id);
  const [coffee, tea, milk] = ids(p);
  assert.equal(tea, 'x1');
  assert.match(coffee, /^x-legacy-[a-z0-9]+$/);
  assert.notEqual(coffee, milk);
  assert.deepEqual(ids(m.normalizePlan(raw)), [coffee, tea, milk], 'same ids every time');
  assert.equal(raw.shopping.extras[0].id, undefined, 'input not mutated');
  assert.deepEqual(m.normalizePlan(null), { meals: [], prep: [], shopping: { checked: [], extras: [] } });
  // The id depends on the extra itself, not its position.
  const moved = m.normalizePlan({ shopping: { extras: [{ item: 'milk', checked: true }] } });
  assert.equal(ids(moved)[0], milk);
  // Duplicates get a counter, and a duplicate explicit id is replaced so each extra is addressed alone.
  const twins = ids(m.normalizePlan({ shopping: { extras: [{ item: 'eggs', section: 'dairy & eggs' }, { item: 'eggs', section: 'dairy & eggs' }] } }));
  assert.equal(new Set(twins).size, 2);
  const dup = m.normalizePlan({ shopping: { extras: [{ id: 'x1', item: 'a' }, { id: 'x1', item: 'b' }, { item: 'c' }] } });
  assert.equal(new Set(dup.shopping.extras.map((x) => x.id)).size, 3);
});

test('extras: tick or remove one id-less extra leaves the others alone', async () => {
  const m = await load();
  const plan = m.normalizePlan({ shopping: { extras: [{ item: 'coffee' }, { item: 'milk' }, { item: 'tea' }] } });
  const [coffee, milk, tea] = plan.shopping.extras.map((x) => x.id);
  const ticked = m.toggleExtra(plan, milk, true);
  assert.deepEqual(ticked.shopping.extras.map((x) => !!x.checked), [false, true, false]);
  assert.equal(plan.shopping.extras[1].checked, undefined, 'not mutated');
  const removed = m.removeExtra(ticked, coffee);
  assert.deepEqual(removed.shopping.extras.map((x) => x.item), ['milk', 'tea']);
  assert.deepEqual(removed.shopping.extras.map((x) => x.id), [milk, tea], 'ids saved with the plan');
  const added = m.addExtra(removed, { id: 'x9', item: 'salt', section: 'spices', checked: false });
  assert.equal(added.shopping.extras.length, 3);
  assert.throws(() => m.toggleExtra(added, 'nope', true), /no longer in the plan/);
  assert.throws(() => m.removeExtra(added, 'nope'), /no longer in the plan/);
});

test('an id-less extra deleted outside the app never makes a click hit the wrong extra', async () => {
  const m = await load();
  const raw = [{ item: 'coffee', section: 'pantry' }, { item: 'eggs', section: 'dairy & eggs' }, { item: 'eggs', section: 'dairy & eggs' }, { item: 'tea', section: 'pantry' }];
  const rendered = m.normalizePlan({ shopping: { extras: raw } }).shopping.extras;
  for (let gone = 0; gone < raw.length; gone += 1) {
    // Another window or a hand edit removes one extra before the page saves.
    const fresh = { shopping: { extras: raw.filter((_, i) => i !== gone) } };
    for (let k = 0; k < rendered.length; k += 1) {
      if (k === gone) continue;
      const clicked = rendered[k];
      let next;
      try {
        next = m.toggleExtra(fresh, clicked.id, true);
      } catch (e) {
        assert.match(e.message, /no longer in the plan/);
        continue;
      }
      const hit = next.shopping.extras.filter((x) => x.checked);
      assert.equal(hit.length, 1);
      assert.equal(hit[0].item, clicked.item, `removed ${gone}, clicked ${k}`);
      assert.equal(hit[0].section, clicked.section);
    }
  }
});

test('planListProblem names a list field that holds something else', async () => {
  const m = await load();
  assert.equal(m.planListProblem({ meals: [], prep: [], shopping: { checked: [], extras: [] } }), null);
  assert.equal(m.planListProblem({}), null, 'missing fields are fine');
  assert.match(m.planListProblem({ shopping: 7 }), /shopping field/);
  assert.match(m.planListProblem({ meals: 'oops' }), /meals field that isn't a list; fix it in the note first/);
  assert.match(m.planListProblem({ meals: [], prep: { a: 1 } }), /prep field/);
  assert.match(m.planListProblem({ shopping: { checked: 'x' } }), /shopping\.checked field/);
  assert.match(m.planListProblem({ shopping: { checked: [], extras: 5 } }), /shopping\.extras field/);
  assert.match(m.planListProblem({ meals: null }), /meals field/);
});

test('toggleChecked adds and removes a key on the fresh plan', async () => {
  const m = await load();
  const plan = m.normalizePlan({ shopping: { checked: ['eggs|each'] } });
  assert.deepEqual(m.toggleChecked(plan, 'salt|', true).shopping.checked, ['eggs|each', 'salt|']);
  assert.deepEqual(m.toggleChecked(plan, 'eggs|each', true).shopping.checked, ['eggs|each']);
  assert.deepEqual(m.toggleChecked(plan, 'eggs|each', false).shopping.checked, []);
  assert.deepEqual(m.toggleChecked(plan, 'eggs|each').shopping.checked, [], 'no flag flips it');
  assert.deepEqual(plan.shopping.checked, ['eggs|each']);
});

// ---- meals and prep by id ----

const weekPlan = () => ({
  meals: [
    { id: 'p1', date: '2026-10-05', slot: 'dinner', recipe: 'A', servings: 1 },
    { id: 'p2', date: '2026-10-06', slot: 'lunch', recipe: 'B', servings: 1, extra: 'kept' },
    { date: '2026-10-07', slot: 'lunch', recipe: 'C' },
  ],
  prep: [{ id: 'q1', date: '2026-10-04', meal_ids: ['p1', 'p2'], notes: 'n' }, { date: '2026-10-04', notes: 'no id' }],
});

test('updateMealById edits the matching meal even after the list shifted', async () => {
  const m = await load();
  const fresh = weekPlan();
  fresh.meals.unshift({ id: 'p0', date: '2026-10-05', slot: 'breakfast', recipe: 'Z' });
  const next = m.updateMealById(fresh, { id: 'p2', index: 1 }, { servings: 2 });
  assert.equal(next.meals[2].servings, 2);
  assert.equal(next.meals[2].extra, 'kept');
  assert.equal(next.meals[1].recipe, 'A');
  assert.equal(fresh.meals[2].servings, 1, 'not mutated');
  // An id-less row falls back to its index, but only if that row still has no id.
  assert.equal(m.updateMealById(weekPlan(), { index: 2 }, { servings: 3 }).meals[2].servings, 3);
  assert.throws(() => m.updateMealById(weekPlan(), { index: 0 }, { servings: 3 }), /no longer in the plan/);
  assert.throws(() => m.updateMealById(weekPlan(), { id: 'gone', index: 0 }, { servings: 3 }), /no longer in the plan/);
});

test('removeMealById removes the meal and strips its id from prep days', async () => {
  const m = await load();
  const next = m.removeMealById(weekPlan(), { id: 'p1', index: 0 });
  assert.deepEqual(next.meals.map((x) => x.recipe), ['B', 'C']);
  assert.deepEqual(next.prep[0].meal_ids, ['p2']);
  assert.deepEqual(next.prep[1], { date: '2026-10-04', notes: 'no id' });
  const noId = m.removeMealById(weekPlan(), { index: 2 });
  assert.deepEqual(noId.meals.map((x) => x.recipe), ['A', 'B']);
  assert.throws(() => m.removeMealById(weekPlan(), { id: 'gone' }), /no longer in the plan/);
});

test('prep days are found by id, with an index fallback for id-less ones', async () => {
  const m = await load();
  const p = weekPlan();
  const edited = m.updatePrepById(p, { id: 'q1', index: 0 }, { id: 'q1', date: '2026-10-05', meal_ids: [], notes: 'x' });
  assert.equal(edited.prep[0].notes, 'x');
  assert.equal(m.removePrepById(p, { index: 1 }).prep.length, 1);
  assert.throws(() => m.removePrepById(p, { index: 0 }), /no longer in the plan/);
  assert.equal(p.prep.length, 2);
});

// ---- copy last week ----

test('copyWeekMeals appends last week with new ids and dates a week later', async () => {
  const m = await load();
  let n = 0;
  const newId = () => `n${++n}`;
  const prev = { meals: [{ id: 'a', date: '2026-09-28', slot: 'dinner', recipe: 'Salmon', servings: 2 }, { id: 'b', date: '2026-09-29', slot: 'lunch', recipe: 'Soup' }, { date: 'bad', recipe: 'X' }, null] };
  const mine = { meals: [{ id: 'k', date: '2026-10-06', slot: 'lunch', recipe: 'soup ' }], prep: [{ id: 'q', meal_ids: ['k'] }], shopping: { checked: ['x|'], extras: [{ id: 'x1', item: 'tea' }] } };
  const { plan, added } = m.copyWeekMeals(prev, mine, newId);
  assert.equal(added, 1, 'Soup on Tuesday lunch is already there');
  assert.deepEqual(plan.meals[1], { id: 'n1', date: '2026-10-05', slot: 'dinner', recipe: 'Salmon', servings: 2 });
  assert.deepEqual(plan.meals[0], mine.meals[0]);
  assert.deepEqual(plan.prep, mine.prep);
  assert.deepEqual(plan.shopping, mine.shopping);
  assert.equal(mine.meals.length, 1, 'not mutated');
  assert.equal(m.copyWeekMeals(prev, plan, newId).added, 0, 'copying twice adds nothing');
  assert.equal(m.copyWeekMeals(null, null, newId).added, 0);
  // A recipe planned twice in one slot last week copies twice; only meals already here are matched, one for one.
  const twice = { meals: [{ date: '2026-09-28', slot: 'snack', recipe: 'Eggs' }, { date: '2026-09-28', slot: 'snack', recipe: 'Eggs' }] };
  assert.equal(m.copyWeekMeals(twice, { meals: [] }, newId).added, 2);
  assert.equal(m.copyWeekMeals(twice, { meals: [{ date: '2026-10-05', slot: 'snack', recipe: 'eggs' }] }, newId).added, 1);
});

// ---- recipe rename ----

test('renameRecipeInPlan renames matching meals case-insensitively and counts them', async () => {
  const m = await load();
  const p = { week_start: 'w', meals: [{ id: '1', recipe: ' salmon plate' }, { id: '2', recipe: 'Soup' }, { id: '3', recipe: 'SALMON PLATE' }, 'x'] };
  const { plan, count } = m.renameRecipeInPlan(p, 'Salmon Plate', 'Salmon dinner');
  assert.equal(count, 2);
  assert.deepEqual(plan.meals.map((x) => x.recipe ?? x), ['Salmon dinner', 'Soup', 'Salmon dinner', 'x']);
  assert.equal(p.meals[0].recipe, ' salmon plate');
  assert.equal(m.countRecipeUses(p, 'salmon plate'), 2);
  assert.equal(m.countRecipeUses(null, 'x'), 0);
  assert.equal(m.renameRecipeInPlan({ meals: 'bad' }, 'a', 'b').count, 0);
});

// ---- Today: planned keys and times ----

test('plannedKey uses the id, or date|slot|recipe for an id-less meal', async () => {
  const m = await load();
  assert.equal(m.plannedKey({ id: 'p1', date: 'd', slot: 's', recipe: 'r' }), 'p1');
  assert.equal(m.plannedKey({ date: '2026-10-05', slot: 'dinner', recipe: 'Salmon' }), '2026-10-05|dinner|Salmon');
  const e = m.ateThisEntry({ date: '2026-10-05', slot: 'dinner', recipe: 'Salmon' }, { name: 'Salmon', per_serving: {} }, '18:30');
  assert.equal(e.planned_id, '2026-10-05|dinner|Salmon');
  assert.deepEqual(m.SLOT_TIMES, { breakfast: '08:00', lunch: '12:30', dinner: '18:30', snack: '15:00' });
});

// ---- friendly shopping amounts ----

test('friendlyAmount shows kitchen fractions, a pinch, and short decimals', async () => {
  const m = await load();
  assert.equal(m.friendlyAmount(1 / 3, 'cup'), '⅓ cup');
  assert.equal(m.friendlyAmount(1.5, 'cups'), '1½ cups');
  assert.equal(m.friendlyAmount(2 / 3, 'tbsp'), '⅔ tbsp');
  assert.equal(m.friendlyAmount(0.25, 'tsp'), '¼ tsp');
  assert.equal(m.friendlyAmount(2.75, 'Tbsp'), '2¾ Tbsp');
  assert.equal(m.friendlyAmount(2.999, 'cup'), '3 cup');
  assert.equal(m.friendlyAmount(18.666666, 'oz'), '18.67 oz');
  assert.equal(m.friendlyAmount(1 / 3, 'oz'), '0.33 oz');
  assert.equal(m.friendlyAmount(4, ''), '4');
  assert.equal(m.friendlyAmount(0.4, 'cup'), '0.4 cup');
  assert.equal(m.friendlyAmount(0, 'cup'), '0 cup');
  assert.equal(m.friendlyAmount(null, 'cup'), '');
  assert.equal(m.friendlyAmount(NaN, 'cup'), '');
});

test('friendlyAmount: a pinch only under 1/16 tsp, and a non-zero amount never shows as 0', async () => {
  const m = await load();
  assert.equal(m.friendlyAmount(0.05, 'tsp'), 'a pinch');
  assert.equal(m.friendlyAmount(0.0625, 'tsp'), '0.06 tsp');
  assert.equal(m.friendlyAmount(0.07, 'tsp'), '0.07 tsp');
  assert.equal(m.friendlyAmount(0.0833, 'tbsp'), '0.08 tbsp');
  assert.equal(m.friendlyAmount(0.015, 'tbsp'), 'a pinch');
  assert.equal(m.friendlyAmount(0.025, 'tbsp'), '0.03 tbsp');
  assert.equal(m.friendlyAmount(0.05, 'cup'), '0.05 cup');
  assert.equal(m.friendlyAmount(0.01, 'cup'), '0.01 cup');
  assert.equal(m.friendlyAmount(0.004, 'cup'), 'a little');
  assert.equal(m.friendlyAmount(0.003, 'oz'), 'a little');
  assert.equal(m.friendlyAmount(1.004, 'cup'), '1 cup');
  for (const unit of ['cup', 'cups', 'tbsp', 'tsp', 'oz', 'g', '']) {
    for (const n of [0.0001, 0.001, 0.004, 0.009, 0.0149, 0.019]) {
      assert.doesNotMatch(m.friendlyAmount(n, unit), /^0(\s|$)/, `${n} ${unit}`);
    }
  }
});

test('friendlyAmount: whole items use fractions and drop the word "each"', async () => {
  const m = await load();
  assert.equal(m.friendlyAmount(0.25, 'each'), '¼');
  assert.equal(m.friendlyAmount(0.1333, 'each'), '⅛');
  assert.equal(m.friendlyAmount(1.5, 'each'), '1½');
  assert.equal(m.friendlyAmount(3, 'each'), '3');
  assert.equal(m.friendlyAmount(2 / 3, 'Each'), '⅔');
  assert.equal(m.friendlyAmount(0.5, ''), '½');
  assert.equal(m.friendlyAmount(1.25, ''), '1¼');
  assert.equal(m.friendlyAmount(0.4, 'each'), '0.4');
  assert.equal(m.friendlyAmount(0.003, 'each'), 'a little');
  assert.equal(m.friendlyAmount(0, 'each'), '0');
  assert.equal(m.friendlyAmount(0.125, 'cup'), '⅛ cup');
  assert.equal(m.friendlyAmount(0.125, 'oz'), '0.13 oz', 'weights stay decimal');
});

test("planListProblem: a shopping value that isn't a group of fields", async () => {
  const m = await load();
  for (const shopping of [7, null, ['tea'], 'x']) {
    assert.match(m.planListProblem({ meals: [], shopping }), /shopping field that isn't a group of fields; fix it in the note first/);
  }
  assert.equal(m.planListProblem({ shopping: {} }), null);
});

test('only_tags: an untagged item gets a soft flag; a tagged one that fits does not', async () => {
  const m = await load();
  const carnivore = { name: 'Carnivore', only_tags: ['meat', 'fish', 'eggs', 'dairy'], avoid_words: ['bread'] };
  const foods = [{ name: 'steak', tags: ['meat'] }];
  const flags = (food) => m.dietFlags({ items: [{ food }] }, { diet: carnivore, foods });
  assert.deepEqual(flags('apple'), ["Apple: not tagged, so Body Lab can't confirm it fits Carnivore."]);
  assert.deepEqual(flags('steak'), []);
  assert.deepEqual(flags('garlic bread'), ["Garlic bread: not tagged, so Body Lab can't confirm it fits Carnivore.", 'Garlic bread: "bread" is on the Carnivore avoid list.']);
  assert.deepEqual(m.dietFlags({ items: [{ food: 'apple' }, { food: 'Apple' }] }, { diet: carnivore, foods }).length, 1, 'deduped');
  assert.deepEqual(m.dietFlags({ items: [{ food: 'apple' }] }, { diet: { name: 'Keto', only_tags: [] }, foods }), [], 'empty only_tags means unset');
});

test('a Goals window is ignored when no chosen diet has one', async () => {
  const m = await load();
  const rules = m.effectiveRules({ name: 'Keto' }, null, { start: '12:00', end: '20:00' });
  assert.deepEqual(m.dietFlags({ time: '23:00', items: [] }, rules), []);
});

test('preparePrep keeps only meal ids still in the plan and drops an empty prep with no notes', async () => {
  const m = await load();
  const plan = { meals: [{ id: 'p1' }, { id: 'p3' }, 'x'], prep: [{ id: 'q1', meal_ids: ['p1', 'p2'], notes: '' }, { id: 'q2', meal_ids: ['p2'] }] };
  // Editing q1 after p2 was removed in another window keeps p1 only.
  let next = m.savePrep(plan, { id: 'q1', index: 0 }, { id: 'q1', date: 'd', meal_ids: ['p1', 'p2'], notes: '' });
  assert.deepEqual(next.prep[0].meal_ids, ['p1']);
  // Editing q2: its only meal is gone and it has no notes, so it is dropped.
  next = m.savePrep(plan, { id: 'q2', index: 1 }, { id: 'q2', date: 'd', meal_ids: ['p2'], notes: ' ' });
  assert.deepEqual(next.prep.map((q) => q.id), ['q1']);
  // With notes it stays, with no meals.
  next = m.savePrep(plan, { id: 'q2', index: 1 }, { id: 'q2', date: 'd', meal_ids: ['p2'], notes: 'Chop onions' });
  assert.deepEqual(next.prep[1], { id: 'q2', date: 'd', meal_ids: [], notes: 'Chop onions' });
  // A new prep day is appended, or skipped when it ends up empty with no notes.
  assert.equal(m.savePrep(plan, null, { id: 'q9', date: 'd', meal_ids: ['p3', 'gone'], notes: '' }).prep[2].meal_ids.join(), 'p3');
  assert.equal(m.savePrep(plan, null, { id: 'q9', date: 'd', meal_ids: ['gone'], notes: '' }).prep.length, 2);
  assert.equal(plan.prep[0].meal_ids.length, 2, 'not mutated');
  assert.throws(() => m.savePrep(plan, { id: 'nope' }, { id: 'nope', meal_ids: [] }), /no longer in the plan/);
});

test('savePlanWithRetry re-reads and re-applies on a stale save, then gives up', async () => {
  const m = await load();
  const stale = () => Object.assign(new Error('This week changed in another window.'), { stale: true });
  let version = 1;
  let disk = { meals: ['a'] };
  const saves = [];
  let failNext = 2;
  const loadPlan = async () => ({ ...disk, version: String(version) });
  const save = async (plan) => {
    saves.push(plan);
    if (failNext > 0) { failNext -= 1; disk = { meals: [...disk.meals, 'other'] }; version += 1; throw stale(); }
    if (plan.expected_version !== String(version)) throw stale();
    disk = plan;
  };
  const build = (p) => ({ ...p, meals: [...p.meals, 'mine'] });
  await m.savePlanWithRetry({ load: loadPlan, save, build });
  assert.equal(saves.length, 3);
  assert.deepEqual(disk.meals, ['a', 'other', 'other', 'mine'], 'the other window\'s changes are kept');
  assert.equal('version' in disk, false, 'version is not saved');
  assert.equal(disk.expected_version, '3');
  // Always stale: one try plus 3 retries, then a clear error.
  let tries = 0;
  await assert.rejects(m.savePlanWithRetry({ load: loadPlan, save: async () => { tries += 1; throw stale(); }, build }), /kept changing in another window/);
  assert.equal(tries, 4);
  // Any other error stops at once.
  tries = 0;
  await assert.rejects(m.savePlanWithRetry({ load: loadPlan, save: async () => { tries += 1; throw new Error('disk full'); }, build }), /disk full/);
  assert.equal(tries, 1);
  // A list problem in the note stops before any save.
  await assert.rejects(m.savePlanWithRetry({ load: async () => ({ meals: 'x' }), save: async () => { throw new Error('saved'); }, build }), /meals field/);
});

test('dietFlags combines tags stored on the item with the saved food tags', async () => {
  const m = await load();
  const carnivore = { name: 'Carnivore', only_tags: ['meat', 'fish', 'eggs', 'dairy'] };
  const meal = { time: '12:00', items: [{ food: 'Apples, raw, with skin', tags: ['fruit'], usda_id: 171688 }] };
  assert.deepEqual(m.dietFlags(meal, { diet: carnivore, foods: [], recipes: [] }), ["Apples, raw, with skin: fruit isn't part of Carnivore."]);
  // The saved food was retagged after the meal was logged: both sets of tags count.
  const egg = { time: '12:00', items: [{ food: 'Egg', tags: ['eggs'] }] };
  assert.deepEqual(m.dietFlags(egg, { diet: carnivore, foods: [{ name: 'Egg', tags: ['grain'] }] }), ["Egg: grain isn't part of Carnivore."]);
  assert.deepEqual(m.dietFlags(egg, { diet: carnivore, foods: [{ name: 'Egg', tags: ['dairy'] }] }), []);
});
