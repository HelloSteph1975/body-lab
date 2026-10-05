const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'foodpicker.js')).href);

const egg = { id: 171287, source: 'usda', name: 'Egg, whole, raw, fresh', tags: ['eggs'],
  per100: { kcal: 143, protein: 12.6, carbs: 0.7, fiber: 0, fat: 9.5 },
  portions: [{ label: '1 large', g: 50 }, { label: '1 medium', g: 44 }, { label: '100 g', g: 100 }, { label: '1 oz', g: 28.35 }] };
const savedSoup = { id: 'bone-broth', source: 'saved', name: 'Bone broth', serving: '1 cup', net_carbs: 0.5, protein: 9.4, fiber: 0, fat: 1.2, kcal: 41, tags: ['meat'] };

test('fillItem: two large eggs fill every field', async () => {
  const { fillItem } = await load();
  assert.deepEqual(fillItem(egg, '1 large', 2, new Set()), { net_carbs: 0.7, protein: 12.6, fiber: 0, fat: 9.5, kcal: 143 });
});

test('fillItem: a dirty field is left out, so a qty change never overwrites it', async () => {
  const { fillItem } = await load();
  const out = fillItem(egg, '1 large', 3, new Set(['protein']));
  assert.equal('protein' in out, false);
  assert.equal(out.kcal, 215);
  assert.deepEqual(Object.keys(fillItem(egg, '1 large', 1, { fat: true, kcal: true })).sort(), ['fiber', 'net_carbs', 'protein']);
});

test('fillItem: a saved food fills per serving × qty', async () => {
  const { fillItem } = await load();
  assert.deepEqual(fillItem(savedSoup, '1 cup', 1.5, null), { net_carbs: 0.8, protein: 14.1, fiber: 0, fat: 1.8, kcal: 62 });
});

test('fillItem: a saved food missing a number leaves that field alone', async () => {
  const { fillItem } = await load();
  const out = fillItem({ source: 'saved', name: 'Tea', serving: '1 mug', protein: 0 }, '1 mug', 2);
  assert.deepEqual(out, { protein: 0 });
});

test('fillItem: unknown portion or bad food fills nothing; bad qty counts as 1', async () => {
  const { fillItem } = await load();
  assert.deepEqual(fillItem(egg, '1 bucket', 1, null), {});
  assert.deepEqual(fillItem(null, '1 large', 1, null), {});
  assert.equal(fillItem(egg, '1 large', 'abc', null).kcal, 72);
  assert.equal(fillItem(egg, '1 large', 0, null).kcal, 0);
});

test('portionOptions: saved serving first, USDA portions after, no duplicate labels', async () => {
  const { portionOptions, defaultPortion } = await load();
  const linked = { ...savedSoup, serving: '1 large', per100: egg.per100, portions: egg.portions };
  assert.deepEqual(portionOptions(linked).map((p) => p.label), ['1 large', '1 medium', '100 g', '1 oz']);
  assert.equal(portionOptions(linked)[0].saved, true);
  assert.equal(defaultPortion(egg), '1 large');
  assert.equal(defaultPortion({ source: 'saved', name: 'x' }), '1 serving');
  assert.deepEqual(portionOptions({ per100: {}, portions: [{ label: 'bad', g: 0 }, 'junk', { g: 5 }] }), []);
});

test('itemMeta: USDA id, tags and portion for the meal item', async () => {
  const { itemMeta } = await load();
  assert.deepEqual(itemMeta(egg, '1 large'), { usda_id: 171287, tags: ['eggs'], portion: '1 large' });
  assert.deepEqual(itemMeta(savedSoup, '1 cup'), { tags: ['meat'], portion: '1 cup' });
  assert.deepEqual(itemMeta({ ...savedSoup, usda_id: 5, tags: [] }, ''), { usda_id: 5 });
});

test('portionOptionsHtml escapes labels', async () => {
  const { portionOptionsHtml } = await load();
  const html = portionOptionsHtml({ per100: {}, portions: [{ label: '1 "big" <one>', g: 10 }] }, '1 "big" <one>');
  assert.match(html, /value="1 &quot;big&quot; &lt;one&gt;" selected/);
  assert.doesNotMatch(html, /<one>/);
});

test('withUsdaPortions adds USDA portions to a linked saved food, and survives a failed fetch', async () => {
  const { withUsdaPortions } = await load();
  const linked = { ...savedSoup, usda_id: 171287 };
  const got = await withUsdaPortions(linked, async () => egg);
  assert.equal(got.portions.length, 4);
  assert.deepEqual(got.tags, ['meat']);
  assert.equal(await withUsdaPortions(linked, async () => { throw new Error('down'); }), linked);
  assert.equal(await withUsdaPortions(savedSoup, async () => egg), savedSoup);
});

test('typedFields compares exactly against the fill for portion × qty', async () => {
  const { typedFields } = await load();
  assert.deepEqual([...typedFields({ net_carbs: 0.7, protein: 12.6, fiber: 0, fat: 9.5, kcal: 143 }, egg, '1 large', 2)], []);
  assert.deepEqual([...typedFields({ net_carbs: '0.7', protein: '15', fiber: '', fat: 9.5, kcal: 144 }, egg, '1 large', 2)], ['protein', 'kcal']);
  assert.deepEqual([...typedFields({ protein: 1 }, egg, 'no such portion', 1)], ['protein']);
});

test('bestMatch picks the food that explains the logged numbers', async () => {
  const { bestMatch } = await load();
  // Logged from USDA as 2 large eggs, then the egg was remembered with rounded per-serving numbers.
  const savedEgg = { source: 'saved', name: 'Egg', serving: '1 large', net_carbs: 0.4, protein: 6.3, fiber: 0, fat: 4.8, kcal: 72, per100: egg.per100, portions: egg.portions };
  const logged = { net_carbs: 0.7, protein: 12.6, fiber: 0, fat: 9.5, kcal: 143 };
  const both = [{ food: savedEgg, portion: '1 large' }, { food: egg, portion: '1 large' }];
  const m = bestMatch(logged, both, 2);
  assert.equal(m.food, egg);
  assert.deepEqual([...m.typed], []);
  assert.deepEqual([...bestMatch({ ...logged, protein: 20 }, both, 2).typed], ['protein']);
  assert.equal(bestMatch(logged, [], 2), null);
});

test('perServing: picked fields come from the food at qty 1, typed ones are divided by qty', async () => {
  const { perServing } = await load();
  const item = { qty: 2, net_carbs: 0.7, protein: 15, fiber: 0, fat: 9.5, kcal: 143 };
  assert.deepEqual(perServing(item, egg, '1 large', new Set(['protein'])), { net_carbs: 0.4, protein: 7.5, fiber: 0, fat: 4.8, kcal: 72 });
  assert.deepEqual(perServing({ qty: 4, protein: 10, kcal: 250 }, null, '', null), { net_carbs: 0, protein: 2.5, fiber: 0, fat: 0, kcal: 63 });
});

test('pickerKey: arrows wrap, and ArrowUp with nothing highlighted goes to the last item', async () => {
  const { pickerKey } = await load();
  assert.equal(pickerKey('ArrowUp', { open: true, active: -1, count: 5 }).active, 4);
  assert.equal(pickerKey('ArrowDown', { open: true, active: -1, count: 5 }).active, 0);
  assert.equal(pickerKey('ArrowDown', { open: true, active: 4, count: 5 }).active, 0);
  assert.equal(pickerKey('ArrowUp', { open: true, active: 0, count: 5 }).active, 4);
  assert.equal(pickerKey('ArrowDown', { open: false, active: -1, count: 5 }).prevent, false);
});

test('pickerKey: Enter never submits the form; it picks only a highlighted item', async () => {
  const { pickerKey } = await load();
  assert.deepEqual(pickerKey('Enter', { open: true, active: 2, count: 5 }), { prevent: true, stop: false, active: 2, choose: 2, close: false });
  // Nothing highlighted, list closed, or a search still pending (open with no results yet).
  for (const state of [{ open: true, active: -1, count: 5 }, { open: false, active: -1, count: 0 }, { open: true, active: -1, count: 0 }]) {
    const r = pickerKey('Enter', state);
    assert.equal(r.prevent, true);
    assert.equal(r.choose, -1);
  }
  assert.deepEqual(pickerKey('Escape', { open: true, active: 1, count: 3 }), { prevent: true, stop: true, active: 1, choose: -1, close: true });
  assert.equal(pickerKey('Escape', { open: false }).prevent, false, 'with the list closed, Esc still closes the dialog');
});

const apple = { id: 171688, source: 'usda', name: 'Apples, raw, with skin', tags: ['fruit'],
  per100: { kcal: 52, protein: 0.3, carbs: 13.8, fiber: 2.4, fat: 0.2 }, portions: [{ label: '1 medium', g: 182 }, { label: '100 g', g: 100 }] };
const blankForm = { name: '', serving: '', net_carbs: '', protein: '', fiber: '', fat: '', kcal: '', tags: [] };

test('planLookup fills an empty form, then refills only its own values', async () => {
  const { planLookup } = await load();
  const first = planLookup(blankForm, egg, '1 large');
  assert.deepEqual(first.writes, { serving: '1 large', net_carbs: 0.4, protein: 6.3, fiber: 0, fat: 4.8, kcal: 72, name: 'Egg, whole, raw, fresh' });
  assert.deepEqual(first.conflicts, []);
  assert.deepEqual(first.tags, ['eggs']);
  // The person types protein, then picks another portion: protein stays, the rest follow.
  const form = { ...blankForm, ...first.writes, protein: '7', tags: first.tags };
  const second = planLookup(form, egg, '1 medium', first.next);
  assert.equal('protein' in second.writes, false);
  assert.deepEqual(second.conflicts, ['protein']);
  assert.equal(second.writes.kcal, 63);
  assert.equal(second.writes.serving, '1 medium');
});

test('planLookup never overwrites an existing food without asking', async () => {
  const { planLookup } = await load();
  const existing = { name: 'My eggs', serving: '2 eggs', net_carbs: '1', protein: '12', fiber: '0', fat: '', kcal: '', tags: ['dairy'] };
  const plan = planLookup(existing, egg, '1 large', {});
  assert.deepEqual(plan.conflicts.sort(), ['net_carbs', 'protein', 'serving']);
  assert.deepEqual(plan.writes, { fat: 4.8, kcal: 72 }, 'empty fields fill, the name is kept');
  const replaced = planLookup(existing, egg, '1 large', {}, true);
  assert.equal(replaced.writes.protein, 6.3);
  assert.equal(replaced.writes.serving, '1 large');
  assert.equal('name' in replaced.writes, false);
  // Their fiber (0) happened to match the egg; it is still theirs when the apple comes along.
  const next = planLookup({ ...existing, fat: 4.8, kcal: 72, tags: plan.tags }, apple, '1 medium', plan.next);
  assert.ok(next.conflicts.includes('fiber'));
  assert.equal('fiber' in next.writes, false);
});

test("planLookup swaps the last pick's tags and keeps the person's own", async () => {
  const { planLookup } = await load();
  const first = planLookup({ ...blankForm, tags: ['processed'] }, egg, '1 large');
  assert.deepEqual(first.tags, ['processed', 'eggs']);
  const second = planLookup({ ...blankForm, ...first.writes, tags: first.tags }, apple, '1 medium', first.next);
  assert.deepEqual(second.tags, ['processed', 'fruit']);
  assert.equal(second.writes.name, 'Apples, raw, with skin', 'a name the last pick wrote follows the new pick');
  assert.deepEqual(second.conflicts, []);
  // A tag the person had already chosen isn't the pick's to remove.
  const own = planLookup({ ...blankForm, tags: ['fruit'] }, apple, '1 medium');
  const after = planLookup({ ...blankForm, ...own.writes, tags: own.tags }, egg, '1 large', own.next);
  assert.deepEqual(after.tags, ['fruit', 'eggs']);
});
