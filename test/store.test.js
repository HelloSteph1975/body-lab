const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, retryFs } = require('../lib/store');

const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bodylab-'));
  roots.push(root);
  const store = createStore(root);
  store.ensureSeed();
  return { root, store };
}

test('ensureSeed writes default docs once', () => {
  const { root, store } = setup();
  assert.equal(store.getDoc('supplements').items.length, 0);
  store.saveDoc('goals', { ...store.getDoc('goals'), ideal_weight: 130 });
  store.ensureSeed();
  assert.equal(store.getDoc('goals').ideal_weight, 130);
  assert.ok(fs.existsSync(path.join(root, 'Library', 'Supplement plan.md')));
});

test('a missing day reads as empty', () => {
  const { store } = setup();
  const d = store.readDay('2026-09-30');
  assert.equal(d.exists, false);
  assert.equal(d.data.date, '2026-09-30');
  assert.equal(d.totals.walks, 0);
});

test('entries can be added, edited and deleted by id', () => {
  const { root, store } = setup();
  const meal = store.addEntry('2026-09-30', 'meals', { time: '07:30', kind: 'breakfast', items: [{ food: 'Eggs', protein: 12 }] });
  assert.match(meal.id, /^m/);
  store.updateEntry('2026-09-30', 'meals', meal.id, { time: '08:00', kind: 'breakfast', items: [{ food: 'Eggs', protein: 18 }] });
  let d = store.readDay('2026-09-30');
  assert.equal(d.totals.protein, 18);
  assert.equal(d.data.meals[0].time, '08:00');
  store.deleteEntry('2026-09-30', 'meals', meal.id);
  d = store.readDay('2026-09-30');
  assert.equal(d.data.meals.length, 0);
  assert.throws(() => store.deleteEntry('2026-09-30', 'meals', meal.id), { status: 404 });
  assert.throws(() => store.addEntry('2026-09-30', 'snacks', {}), { status: 404 });
  const text = fs.readFileSync(path.join(root, 'Days', '2026-09-30.md'), 'utf8');
  assert.match(text, /^---\ndate: "2026-09-30"\n/);
});

test('patchDay sets and clears allowed fields only', () => {
  const { store } = setup();
  store.saveDoc('supplements', { items: [{ key: 'berberine', name: 'Berberine', dose: '', slot: 'any' }] });
  store.patchDay('2026-09-30', { weight: 148, supplements: { berberine: true } });
  let d = store.readDay('2026-09-30');
  assert.equal(d.data.weight, 148);
  assert.equal(d.totals.supps_done, 1);
  store.patchDay('2026-09-30', { weight: null });
  d = store.readDay('2026-09-30');
  assert.equal(d.data.weight, undefined);
  assert.throws(() => store.patchDay('2026-09-30', { meals: [] }), { status: 400 });
});

test('a broken note is reported and never overwritten', () => {
  const { root, store } = setup();
  const file = path.join(root, 'Days', '2026-09-30.md');
  fs.writeFileSync(file, '---\nmeals: [oops\n---\nmine\n');
  assert.ok(store.readDay('2026-09-30').broken);
  assert.throws(() => store.addEntry('2026-09-30', 'notes', { text: 'hi' }), { status: 409 });
  assert.equal(fs.readFileSync(file, 'utf8'), '---\nmeals: [oops\n---\nmine\n');
});

test('bad dates are refused', () => {
  const { store } = setup();
  assert.throws(() => store.readDay('../../x'), { status: 400 });
});

test('listDays and journal', () => {
  const { store } = setup();
  store.addEntry('2026-09-28', 'notes', { time: '09:00', tags: ['tired'], text: 'Slept badly' });
  store.addEntry('2026-09-30', 'notes', { time: '15:00', tags: ['craving'], text: 'Chips again' });
  store.addEntry('2026-09-30', 'notes', { time: '08:00', text: 'Good walk' });
  assert.deepEqual(store.listDays('2026-09-29', '2026-09-30').map((d) => d.date), ['2026-09-30']);
  assert.deepEqual(store.journal().map((n) => n.text), ['Chips again', 'Good walk', 'Slept badly']);
  assert.deepEqual(store.journal({ tag: 'tired' }).map((n) => n.date), ['2026-09-28']);
  assert.deepEqual(store.journal({ q: 'WALK' }).map((n) => n.text), ['Good walk']);
});

test('foods: create, rename and delete to .trash', () => {
  const { root, store } = setup();
  store.createItem('foods', { name: 'Egg', serving: '1 large', net_carbs: 0.5, protein: 6, fiber: 0 });
  assert.throws(() => store.createItem('foods', { name: 'Egg' }), { status: 409 });
  const renamed = store.updateItem('foods', 'Egg', { name: 'Egg (large)', serving: '1', net_carbs: 0.5, protein: 6, fiber: 0 });
  assert.equal(renamed.id, 'Egg (large)');
  assert.deepEqual(store.listItems('foods').map((f) => f.id), ['Egg (large)']);
  store.deleteItem('foods', 'Egg (large)');
  assert.equal(store.listItems('foods').length, 0);
  assert.ok(fs.readdirSync(path.join(root, '.trash')).some((f) => f.startsWith('Egg (large)')));
});

test('labs need a real date', () => {
  const { store } = setup();
  assert.throws(() => store.createItem('labs', { date: 'January', a1c: 5.9 }), { status: 400 });
  store.createItem('labs', { date: '2026-01-15', a1c: 5.9 });
  assert.equal(store.listItems('labs')[0].a1c, 5.9);
});

test('deleting from an empty/missing day throws 404', () => {
  const { store } = setup();
  assert.throws(() => store.deleteEntry('2026-09-30', 'meals', 'm1'), { status: 404 });
});

test('doc keys must be valid identifiers', () => {
  const { root, store } = setup();
  const goals = store.getDoc('goals');
  assert.throws(() => store.saveDoc('goals', { ...goals, 'a b': 1 }), { status: 400 });
  assert.throws(() => store.saveDoc('goals', { ...goals, '1x': 1 }), { status: 400 });
  const file = path.join(root, 'Goals.md');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => store.saveDoc('goals', { ...goals, 'bad-key!': 1 }), { status: 400 });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('food/lab keys must be valid identifiers', () => {
  const { root, store } = setup();
  assert.throws(() => store.createItem('foods', { name: 'Egg', net_carbs: 0, protein: 0, fiber: 0, 'bad key': true }), { status: 400 });
  assert.equal(store.listItems('foods').length, 0);
  store.createItem('foods', { name: 'Egg', net_carbs: 0.5, protein: 6, fiber: 0 });
  const file = path.join(root, 'Foods', 'Egg.md');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => store.updateItem('foods', 'Egg', { name: 'Egg', net_carbs: 0.5, protein: 6, fiber: 0, '1invalid': true }), { status: 400 });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a day note with no frontmatter but real text is refused, not wiped', () => {
  const { root, store } = setup();
  const file = path.join(root, 'Days', '2026-09-30.md');
  const text = '\nweight: 150\n\nMy journal\n';
  fs.writeFileSync(file, text);
  assert.ok(store.readDay('2026-09-30').broken);
  assert.throws(() => store.patchDay('2026-09-30', { supplements: { berberine: true } }), { status: 409 });
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('a blank day file counts as empty', () => {
  const { root, store } = setup();
  fs.writeFileSync(path.join(root, 'Days', '2026-09-30.md'), '  \n');
  assert.equal(store.readDay('2026-09-30').broken, undefined);
  store.patchDay('2026-09-30', { weight: 150 });
  assert.equal(store.readDay('2026-09-30').data.weight, 150);
  assert.equal(fs.existsSync(path.join(root, '.trash')), false);
});

test('a day note with a leading blank line is read, not wiped', () => {
  const { root, store } = setup();
  fs.writeFileSync(path.join(root, 'Days', '2026-09-30.md'), '\n---\nweight: 150\n---\nMy journal');
  assert.equal(store.readDay('2026-09-30').data.weight, 150);
});

test('a doc file with no frontmatter is refused', () => {
  const { root, store } = setup();
  fs.writeFileSync(path.join(root, 'Goals.md'), 'just some words');
  assert.throws(() => store.getDoc('goals'), { status: 409 });
});

test('hand-typed text in a day note is copied to .trash before the rewrite', () => {
  const { root, store } = setup();
  store.patchDay('2026-09-30', { weight: 150 });
  const file = path.join(root, 'Days', '2026-09-30.md');
  const typed = fs.readFileSync(file, 'utf8') + '\nMy hand-typed thought\n';
  fs.writeFileSync(file, typed);
  store.patchDay('2026-09-30', { water_oz: 40 });
  const saved = fs.readdirSync(path.join(root, '.trash'));
  assert.equal(saved.length, 1);
  assert.equal(fs.readFileSync(path.join(root, '.trash', saved[0]), 'utf8'), typed);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /hand-typed/);
  // an untouched (app-written) note makes no backup
  store.patchDay('2026-09-30', { water_oz: 41 });
  assert.equal(fs.readdirSync(path.join(root, '.trash')).length, 1);
});

test('supplement ticks merge instead of replacing', () => {
  const { store } = setup();
  store.patchDay('2026-09-30', { supplements: { berberine: true } });
  store.patchDay('2026-09-30', { supplements: { magnesium: true } });
  assert.deepEqual(store.readDay('2026-09-30').data.supplements, { berberine: true, magnesium: true });
  store.patchDay('2026-09-30', { supplements: { berberine: false } });
  assert.deepEqual(store.readDay('2026-09-30').data.supplements, { berberine: false, magnesium: true });
  store.patchDay('2026-09-30', { ratings: { mood: 3 } });
  store.patchDay('2026-09-30', { ratings: { energy: 2 } });
  assert.deepEqual(store.readDay('2026-09-30').data.ratings, { energy: 2 });
});

test('retryFs retries busy files then succeeds', () => {
  let calls = 0;
  const r = retryFs(() => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return 'ok';
  }, { delayMs: 1 });
  assert.equal(r, 'ok');
  assert.equal(calls, 3);
});

test('retryFs gives up with a 503 and does not retry other errors', () => {
  let calls = 0;
  assert.throws(() => retryFs(() => { calls += 1; throw Object.assign(new Error('x'), { code: 'EPERM' }); }, { delayMs: 1 }), { status: 503 });
  assert.equal(calls, 5);
  calls = 0;
  assert.throws(() => retryFs(() => { calls += 1; throw Object.assign(new Error('x'), { code: 'ENOENT' }); }, { delayMs: 1 }), { code: 'ENOENT' });
  assert.equal(calls, 1);
});

test('journal skips notes that are not a list', () => {
  const { root, store } = setup();
  fs.writeFileSync(path.join(root, 'Days', '2026-09-29.md'), '---\nnotes: "oops"\n---\n');
  store.addEntry('2026-09-30', 'notes', { text: 'hello' });
  assert.equal(store.journal().length, 1);
});

test('bodies that are not plain objects are refused', () => {
  const { store } = setup();
  assert.throws(() => store.addEntry('2026-09-30', 'meals', 'x'), { status: 400 });
  assert.throws(() => store.addEntry('2026-09-30', 'meals', [1]), { status: 400 });
  assert.throws(() => store.patchDay('2026-09-30', null), { status: 400 });
  assert.throws(() => store.saveDoc('goals', []), { status: 400 });
  assert.throws(() => store.createItem('foods', 5), { status: 400 });
});

test('changing the supplement plan does not trigger a backup of app-written notes', () => {
  const { root, store } = setup();
  store.patchDay('2026-09-30', { weight: 150, supplements: { berberine: true } });
  const plan = store.getDoc('supplements');
  store.saveDoc('supplements', { ...plan, items: [...plan.items, { key: 'newone', name: 'New one', slot: 'morning', dose: '1' }] });
  store.patchDay('2026-09-30', { water_oz: 40 });
  assert.equal(fs.existsSync(path.join(root, '.trash')), false);
});

// ---- body_sha: the exact hand-edit rule for every write path
const trashCount = (root) => (fs.existsSync(path.join(root, '.trash')) ? fs.readdirSync(path.join(root, '.trash')).length : 0);
const appendTo = (file, text) => fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + text);

test('saving a day twice makes no backup, and body_sha stays out of the data', () => {
  const { root, store } = setup();
  store.patchDay('2026-09-30', { weight: 150 });
  store.patchDay('2026-09-30', { weight: 151 });
  assert.equal(trashCount(root), 0);
  assert.match(fs.readFileSync(path.join(root, 'Days', '2026-09-30.md'), 'utf8'), /\nbody_sha: "[0-9a-f]{16}"\n/);
  assert.equal('body_sha' in store.readDay('2026-09-30').data, false);
  assert.equal(JSON.stringify(store.journal()).includes('body_sha'), false);
});

test('changing the supplement plan then saving a day makes no backup', () => {
  const { root, store } = setup();
  store.patchDay('2026-09-30', { weight: 150 });
  const plan = store.getDoc('supplements');
  store.saveDoc('supplements', { ...plan, items: [...plan.items, { key: 'new-one', name: 'New one', slot: 'any' }] });
  store.patchDay('2026-09-30', { weight: 151 });
  assert.equal(trashCount(root), 0);
});

test('a hand-edited checklist line is backed up', () => {
  const { root, store } = setup();
  store.saveDoc('supplements', { items: [{ key: 'berberine', name: 'Berberine', dose: '', slot: 'any' }] });
  store.patchDay('2026-09-30', { weight: 150 });
  const file = path.join(root, 'Days', '2026-09-30.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('- [ ]', '- [x]'));
  store.patchDay('2026-09-30', { weight: 151 });
  assert.equal(trashCount(root), 1);
});

test('a day note with a body but no body_sha is backed up', () => {
  const { root, store } = setup();
  fs.writeFileSync(path.join(root, 'Days', '2026-09-30.md'), '---\nweight: 150\n---\nMy journal');
  store.patchDay('2026-09-30', { water_oz: 40 });
  assert.equal(trashCount(root), 1);
});

test('hand text in Goals.md is backed up on saveDoc; a plain save is not', () => {
  const { root, store } = setup();
  store.saveDoc('goals', { ...store.getDoc('goals'), ideal_weight: 131 });
  assert.equal(trashCount(root), 0);
  appendTo(path.join(root, 'Goals.md'), '\nMy own goal thoughts\n');
  const goals = store.getDoc('goals');
  assert.equal('body_sha' in goals, false);
  store.saveDoc('goals', { ...goals, body_sha: 'deadbeefdeadbeef', ideal_weight: 132 });
  assert.equal(trashCount(root), 1);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'Goals.md'), 'utf8'), /deadbeef/);
  assert.equal('body_sha' in store.getDoc('goals'), false);
});

test('hand text in a food note is backed up on update and on rename', () => {
  const { root, store } = setup();
  store.createItem('foods', { name: 'Egg', serving: '1', net_carbs: 0.5, protein: 6, fiber: 0 });
  store.updateItem('foods', 'Egg', { name: 'Egg', serving: '1 large', net_carbs: 0.5, protein: 6, fiber: 0 });
  assert.equal(trashCount(root), 0);
  appendTo(path.join(root, 'Foods', 'Egg.md'), '\nFrom the farm stand\n');
  store.updateItem('foods', 'Egg', { name: 'Egg', serving: '2', net_carbs: 1, protein: 12, fiber: 0 });
  assert.equal(trashCount(root), 1);
  appendTo(path.join(root, 'Foods', 'Egg.md'), '\nAnother note\n');
  store.updateItem('foods', 'Egg', { name: 'Eggs', serving: '2', net_carbs: 1, protein: 12, fiber: 0 });
  assert.equal(trashCount(root), 2);
  assert.equal(fs.existsSync(path.join(root, 'Foods', 'Egg.md')), false);
  assert.equal(JSON.stringify(store.listItems('foods')).includes('body_sha'), false);
});

test('lab notes use the same rule', () => {
  const { root, store } = setup();
  store.createItem('labs', { date: '2026-01-15', a1c: 5.4 });
  store.updateItem('labs', '2026-01-15', { date: '2026-01-15', a1c: 5.5 });
  assert.equal(trashCount(root), 0);
  appendTo(path.join(root, 'Labs', '2026-01-15.md'), '\nDoctor said hi\n');
  store.updateItem('labs', '2026-01-15', { date: '2026-01-15', a1c: 5.6 });
  assert.equal(trashCount(root), 1);
});

test('glp1 doc defaults to disabled and saves to Library/GLP-1.md', () => {
  const { root, store } = setup();
  const d = store.getDoc('glp1');
  assert.deepEqual(d, { enabled: false, medication: '', dose_mg: null, shot_day: null });
  store.saveDoc('glp1', { enabled: true, medication: 'Example', dose_mg: 2.5, shot_day: 3 });
  assert.equal(store.getDoc('glp1').dose_mg, 2.5);
  const text = fs.readFileSync(path.join(root, 'Library', 'GLP-1.md'), 'utf8');
  assert.match(text, /^---\nenabled: true\n/);
  assert.match(text, /# GLP-1 tracking/);
  assert.match(text, /Weekly shot day: Wednesday/);
});

test('shots can be added, edited and deleted, and render under ## Shots', () => {
  const { root, store } = setup();
  const shot = store.addEntry('2026-10-01', 'shots', { time: '09:00', medication: 'Example', dose_mg: 2.5, site: 'belly-left', side_effects: ['nausea'], notes: '' });
  assert.match(shot.id, /^s/);
  store.updateEntry('2026-10-01', 'shots', shot.id, { time: '09:30', medication: 'Example', dose_mg: 5, site: 'belly-right', side_effects: ['none'], notes: 'x' });
  let d = store.readDay('2026-10-01');
  assert.equal(d.data.shots[0].dose_mg, 5);
  const text = fs.readFileSync(path.join(root, 'Days', '2026-10-01.md'), 'utf8');
  assert.match(text, /## Shots\n- 09:30 Shot: Example 5 mg, Belly, right/);
  store.deleteEntry('2026-10-01', 'shots', shot.id);
  d = store.readDay('2026-10-01');
  assert.equal(d.data.shots.length, 0);
  assert.throws(() => store.deleteEntry('2026-10-01', 'shots', shot.id), { status: 404 });
});

test('new folders seed no personal phases', () => {
  const { store } = setup();
  assert.deepEqual(store.getDoc('phases'), { phases: [] });
});

test('upgrade: a folder with Programs and Goals but no Diets or Recipes gets both seeded; Programs untouched', () => {
  const { root, store } = setup();
  fs.rmSync(path.join(root, 'Diets'), { recursive: true });
  fs.rmSync(path.join(root, 'Recipes'), { recursive: true });
  store.deleteItem('programs', 'Dumbbell Basics');
  store.saveDoc('goals', { ...store.getDoc('goals'), ideal_weight: 140 });
  const snap = (dir) => Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  const programs = snap(path.join(root, 'Programs'));
  const goals = fs.readFileSync(path.join(root, 'Goals.md'), 'utf8');
  const upgraded = createStore(root);
  upgraded.ensureSeed();
  assert.equal(upgraded.listItems('diets').length, 6);
  assert.equal(upgraded.listItems('recipes').length, 18);
  assert.deepEqual(snap(path.join(root, 'Programs')), programs);
  assert.equal(fs.readFileSync(path.join(root, 'Goals.md'), 'utf8'), goals);
});

test('programs: starters seeded once, CRUD works, delete goes to .trash', () => {
  const { root, store } = setup();
  const names = store.listItems('programs').map((p) => p.id);
  assert.deepEqual(names, ['Beginner Bodyweight', 'Dumbbell Basics']);
  store.deleteItem('programs', 'Dumbbell Basics');
  store.ensureSeed();
  assert.deepEqual(store.listItems('programs').map((p) => p.id), ['Beginner Bodyweight']);
  const saved = store.createItem('programs', { name: 'Mine', phases: [{ name: 'P', weeks: 1, days: { mon: 'A' } }], routines: [] });
  assert.equal(saved.id, 'Mine');
  assert.ok(fs.readdirSync(path.join(root, '.trash')).some((f) => f.startsWith('Dumbbell Basics ')));
});

test('starter programs reference routines they contain', () => {
  const { store } = setup();
  for (const p of store.listItems('programs')) {
    const names = new Set(p.routines.map((r) => r.name));
    for (const ph of p.phases) {
      assert.ok(Number.isInteger(ph.weeks) && ph.weeks >= 1, `${p.name} weeks`);
      for (const r of Object.values(ph.days)) assert.ok(names.has(r), `${p.name} uses ${r}`);
    }
  }
});

test('the AI guide is written to the data folder and kept current', () => {
  const { root, store } = setup();
  const file = path.join(root, 'How to add things.md');
  assert.match(fs.readFileSync(file, 'utf8'), /## Programs/);
  fs.writeFileSync(file, 'stale');
  store.ensureSeed();
  assert.match(fs.readFileSync(file, 'utf8'), /## Programs/);
});

test('goals defaults include the active program fields', () => {
  const { store } = setup();
  const g = store.getDoc('goals');
  assert.equal(g.program, '');
  assert.equal(g.program_start, null);
});

test('rendering tolerates hand-edited program shapes', () => {
  const render = require('../lib/render');
  for (const d of [
    { name: 'A', phases: {} }, { name: 'A', phases: [null] }, { name: 'A', routines: [null] },
    { name: 'A', routines: [{ name: 'R', moves: [null] }] }, { name: 'A', routines: [{ name: 'R', moves: 5 }] },
    { name: 'A', routines: {} },
  ]) assert.doesNotThrow(() => render.renderItem('programs', d));
  assert.doesNotThrow(() => render.renderDoc('workouts', { moves: [], routines: [{ name: 'R', moves: [null, 'x', { move: 'y' }] }] }));
});

test('ensureSeed moves a marked, half-built Programs.seeding into .trash and keeps the old guide', () => {
  const { root, store } = setup();
  fs.rmSync(path.join(root, 'Programs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Programs.seeding'));
  fs.writeFileSync(path.join(root, 'Programs.seeding', '.body-lab-seeding'), 'x');
  fs.writeFileSync(path.join(root, 'Programs.seeding', 'junk.md'), 'x');
  store.ensureSeed();
  assert.equal(store.listItems('programs').length, 2);
  assert.ok(!fs.existsSync(path.join(root, 'Programs.seeding')));
  const trashed = fs.readdirSync(path.join(root, '.trash')).filter((f) => f.startsWith('Programs.seeding '));
  assert.equal(trashed.length, 1);
  assert.ok(fs.existsSync(path.join(root, '.trash', trashed[0], 'junk.md')));
  fs.writeFileSync(path.join(root, 'How to add things.md'), 'my edits');
  store.ensureSeed();
  assert.ok(fs.readdirSync(path.join(root, '.trash')).some((f) => f.startsWith('How to add things ')));
});

test('ensureSeed leaves an unmarked Programs.seeding folder alone', () => {
  const { root, store } = setup();
  fs.rmSync(path.join(root, 'Programs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Programs.seeding'));
  fs.writeFileSync(path.join(root, 'Programs.seeding', 'mine.md'), 'my notes');
  const orig = console.error;
  const errors = [];
  console.error = (m) => errors.push(String(m));
  try {
    store.ensureSeed();
  } finally {
    console.error = orig;
  }
  assert.equal(fs.readFileSync(path.join(root, 'Programs.seeding', 'mine.md'), 'utf8'), 'my notes');
  assert.ok(errors.some((e) => /Programs.seeding/.test(e)));
  assert.ok(!fs.existsSync(path.join(root, '.trash')) || !fs.readdirSync(path.join(root, '.trash')).some((f) => f.startsWith('Programs.seeding')));
});

test('ensureSeed never throws when the guide or starters cannot be written', () => {
  const { root, store } = setup();
  // A folder where the guide file should be makes both the read and the write fail.
  fs.rmSync(path.join(root, 'How to add things.md'));
  fs.mkdirSync(path.join(root, 'How to add things.md'));
  fs.rmSync(path.join(root, 'Programs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Programs'), 'a file where the folder should be');
  const errors = [];
  const orig = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    assert.doesNotThrow(() => store.ensureSeed());
  } finally {
    console.error = orig;
  }
  assert.ok(errors.length >= 1);
  assert.ok(fs.statSync(path.join(root, 'How to add things.md')).isDirectory());
});

test('ensureSeed never throws when a default note cannot be written', () => {
  const { root, store } = setup();
  fs.rmSync(path.join(root, 'Goals.md'));
  fs.mkdirSync(path.join(root, `Goals.md.tmp-${process.pid}`)); // the atomic write's temp file can't be created
  const orig = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => store.ensureSeed());
  } finally {
    console.error = orig;
  }
});

test('a failed rename leaves a marked folder that the next start cleans into .trash and re-seeds', () => {
  const { root, store } = setup();
  fs.rmSync(path.join(root, 'Programs'), { recursive: true });
  const realRename = fs.renameSync;
  const errors = [];
  const orig = console.error;
  console.error = (m) => errors.push(String(m));
  fs.renameSync = (from, to) => {
    if (String(from).endsWith('Programs.seeding') && String(to).endsWith('Programs')) throw Object.assign(new Error('nope'), { code: 'EINVAL' });
    return realRename(from, to);
  };
  try {
    store.ensureSeed();
  } finally {
    fs.renameSync = realRename;
    console.error = orig;
  }
  assert.ok(errors.length >= 1);
  assert.ok(fs.existsSync(path.join(root, 'Programs.seeding', '.body-lab-seeding')), 'marker kept');
  store.ensureSeed();
  assert.equal(store.listItems('programs').length, 2);
  assert.ok(!fs.existsSync(path.join(root, 'Programs.seeding')));
  assert.ok(fs.readdirSync(path.join(root, '.trash')).some((f) => f.startsWith('Programs.seeding ')));
  assert.ok(!fs.existsSync(path.join(root, 'Programs', '.body-lab-seeding')));
});

test('diets and recipes are seeded once', () => {
  const { store } = setup();
  assert.equal(store.listItems('diets').length, 6);
  assert.equal(store.listItems('recipes').length, 18);
  store.deleteItem('recipes', 'Apple cinnamon oatmeal');
  store.ensureSeed();
  assert.equal(store.listItems('recipes').length, 17);
});

test('meal plans: empty week, save, Monday only, broken refused', () => {
  const { root, store } = setup();
  assert.deepEqual(store.getMealPlan('2026-10-05'), { week_start: '2026-10-05', meals: [], prep: [], shopping: { checked: [], extras: [] }, version: 'none' });
  const plan = { week_start: '2026-10-05', meals: [{ id: 'p1', date: '2026-10-05', slot: 'dinner', recipe: 'Chicken quinoa bowl', servings: 1 }], prep: [], shopping: { checked: [], extras: [] } };
  store.saveMealPlan('2026-10-05', plan);
  assert.deepEqual(store.getMealPlan('2026-10-05').meals, plan.meals);
  assert.match(fs.readFileSync(path.join(root, 'Meal plans', '2026-10-05.md'), 'utf8'), /Chicken quinoa bowl/);
  assert.throws(() => store.getMealPlan('2026-10-06'), { status: 400 });
  assert.throws(() => store.saveMealPlan('2026-10-05', { ...plan, week_start: '2026-10-12' }), { status: 400 });
  fs.writeFileSync(path.join(root, 'Meal plans', '2026-10-05.md'), '---\nmeals: [oops\n---\n');
  assert.throws(() => store.saveMealPlan('2026-10-05', plan), { status: 409 });
});

test('a list field holding something else is returned as is and never overwritten', () => {
  const { root, store } = setup();
  fs.mkdirSync(path.join(root, 'Meal plans'));
  const file = path.join(root, 'Meal plans', '2026-10-05.md');
  const odd = '---\nmeals: "oops"\nprep: {"a":1}\nshopping: {"checked":"x","extras":5}\n---\n';
  fs.writeFileSync(file, odd);
  const p = store.getMealPlan('2026-10-05');
  assert.deepEqual([p.meals, p.prep, p.shopping.checked, p.shopping.extras], ['oops', { a: 1 }, 'x', 5]);
  assert.throws(() => store.saveMealPlan('2026-10-05', { meals: [], prep: [], shopping: { checked: [], extras: [] } }), (e) => e.status === 409 && /meals field that isn't a list; fix it in the note first/.test(e.message));
  assert.equal(fs.readFileSync(file, 'utf8'), odd, 'note untouched');
  for (const [line, field] of [['meals: []\nprep: "x"', 'prep'], ['shopping: {"checked":[],"extras":"tea"}', 'shopping.extras']]) {
    fs.writeFileSync(file, `---\n${line}\n---\n`);
    assert.throws(() => store.saveMealPlan('2026-10-05', {}), new RegExp(`${field.replace('.', '\\.')} field`));
  }
  fs.writeFileSync(file, '---\nmeals: []\n---\n');
  assert.deepEqual(store.getMealPlan('2026-10-05').prep, [], 'missing lists are filled');
  // A shopping value that isn't a group of fields is kept on read and never overwritten.
  for (const odd of ['7', 'null', '["tea"]']) {
    fs.writeFileSync(file, `---\nshopping: ${odd}\n---\n`);
    assert.deepEqual(store.getMealPlan('2026-10-05').shopping, JSON.parse(odd));
    assert.throws(() => store.saveMealPlan('2026-10-05', {}), (e) => e.status === 409 && /shopping field that isn't a group of fields; fix it in the note first/.test(e.message));
    assert.equal(fs.readFileSync(file, 'utf8'), `---\nshopping: ${odd}\n---\n`);
  }
  fs.rmSync(file);
  assert.doesNotThrow(() => store.saveMealPlan('2026-10-05', { meals: [null, 3], prep: 'x', shopping: null }));
  assert.deepEqual(store.getMealPlan('2026-10-05').prep, []);
});

test('goals defaults include diet fields', () => {
  const { store } = setup();
  const g = store.getDoc('goals');
  assert.equal(g.diet, '');
  assert.equal(g.diet_add_on, '');
  assert.equal(g.eating_window, null);
});

test('rendering tolerates odd diet, recipe and meal plan shapes', () => {
  const render = require('../lib/render');
  const odd = [{}, { name: null, ingredients: 'x', steps: { a: 1 }, diets: 5, per_serving: [], eating_window: 'x', favor_tags: [null] }, { ingredients: [null, 3, { item: 'a' }], steps: [null, 's'], only_tags: 'x' }];
  for (const d of odd) {
    assert.doesNotThrow(() => render.renderItem('diets', d));
    assert.doesNotThrow(() => render.renderItem('recipes', d));
  }
  for (const p of [null, {}, { meals: 'x', prep: {} }, { meals: [null, 3, { date: 1 }], prep: [null, { meal_ids: 'x' }] }]) {
    assert.doesNotThrow(() => render.renderMealPlan(p));
  }
  assert.match(render.renderItem('recipes', { name: 'R', ingredients: [{ item: 'salmon', amount: 12, unit: 'oz' }], steps: ['Cook'] }), /- 12 oz salmon\n\n## Steps\n1\. Cook/);
  assert.match(render.renderMealPlan({ week_start: '2026-10-05', meals: [{ date: '2026-10-05', slot: 'dinner', recipe: 'X', servings: 2 }] }), /Dinner: X ×2/);
});

test('seeding diets and recipes cleans only a marked leftover and never throws', () => {
  const { root, store } = setup();
  fs.rmSync(path.join(root, 'Diets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Diets.seeding'));
  fs.writeFileSync(path.join(root, 'Diets.seeding', '.body-lab-seeding'), 'x');
  fs.rmSync(path.join(root, 'Recipes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Recipes.seeding'));
  fs.writeFileSync(path.join(root, 'Recipes.seeding', 'mine.md'), 'my notes');
  const orig = console.error;
  const errors = [];
  console.error = (m) => errors.push(String(m));
  try {
    store.ensureSeed();
  } finally {
    console.error = orig;
  }
  assert.equal(store.listItems('diets').length, 6);
  assert.ok(!fs.existsSync(path.join(root, 'Diets', '.body-lab-seeding')));
  assert.ok(fs.readdirSync(path.join(root, '.trash')).some((f) => f.startsWith('Diets.seeding ')));
  assert.equal(fs.readFileSync(path.join(root, 'Recipes.seeding', 'mine.md'), 'utf8'), 'my notes');
  assert.equal(fs.existsSync(path.join(root, 'Recipes')), false);
  assert.ok(errors.some((e) => /Recipes.seeding/.test(e)));
});

test('a file where Diets should be only logs', () => {
  const { root, store } = setup();
  fs.rmSync(path.join(root, 'Diets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Diets'), 'a file');
  const orig = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => store.ensureSeed());
  } finally {
    console.error = orig;
  }
  assert.equal(store.listItems('programs').length, 2);
});

test('every seeded diet, recipe and program has id equal to name', () => {
  const { store } = setup();
  for (const coll of ['diets', 'recipes', 'programs']) {
    const items = store.listItems(coll);
    assert.ok(items.length > 0);
    for (const i of items) assert.equal(i.id, i.name, `${coll}: ${i.id}`);
  }
});

test('meal plans refuse impossible dates', () => {
  const { store } = setup();
  assert.throws(() => store.getMealPlan('2026-02-30'), { status: 400 });
  assert.throws(() => store.saveMealPlan('2026-13-01', {}), { status: 400 });
});

test('meal plans keep unknown top-level and shopping keys', () => {
  const { store } = setup();
  store.saveMealPlan('2026-10-05', { week_start: '2026-10-05', note_to_self: 'hi', shopping: { checked: ['a|oz'], extras: [], pantry: ['salt'] } });
  const p = store.getMealPlan('2026-10-05');
  assert.equal(p.note_to_self, 'hi');
  assert.deepEqual(p.shopping.pantry, ['salt']);
  assert.deepEqual(p.shopping.checked, ['a|oz']);
});

test('meal plans carry a version; a save with a stale expected_version is refused', () => {
  const { root, store } = setup();
  const file = path.join(root, 'Meal plans', '2026-10-05.md');
  assert.equal(store.getMealPlan('2026-10-05').version, 'none');
  store.saveMealPlan('2026-10-05', { meals: [{ id: 'a', recipe: 'A' }], expected_version: 'none' });
  const first = store.getMealPlan('2026-10-05');
  assert.match(first.version, /^[0-9a-f]{12}$/);
  const text = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /version/, 'version is never written');
  // Window 1 saves; window 2 still holds the old version.
  store.saveMealPlan('2026-10-05', { ...first, meals: [...first.meals, { id: 'b', recipe: 'B' }], expected_version: first.version });
  const afterOne = fs.readFileSync(file, 'utf8');
  assert.throws(() => store.saveMealPlan('2026-10-05', { ...first, meals: [], expected_version: first.version }),
    (e) => e.status === 409 && e.code === 'stale' && e.message === 'This week changed in another window.');
  assert.equal(fs.readFileSync(file, 'utf8'), afterOne, 'file unchanged');
  const fresh = store.getMealPlan('2026-10-05');
  assert.notEqual(fresh.version, first.version);
  assert.doesNotThrow(() => store.saveMealPlan('2026-10-05', { ...fresh, meals: [], expected_version: fresh.version }));
  assert.deepEqual(store.getMealPlan('2026-10-05').meals, []);
  // A brand-new week expects "none"; once the file exists that is stale.
  assert.throws(() => store.saveMealPlan('2026-10-05', { meals: [], expected_version: 'none' }), { code: 'stale' });
  // A save without expected_version (an older client or an AI tool) still works.
  assert.doesNotThrow(() => store.saveMealPlan('2026-10-05', { meals: [] }));
});

test('listMealPlans lists every valid Monday note, sorted', () => {
  const { root, store } = setup();
  assert.deepEqual(store.listMealPlans(), []);
  const dir = path.join(root, 'Meal plans');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['2026-10-12.md', '2026-09-28.md', '2026-10-06.md', 'notes.md', '2026-10-05.txt', '2026-02-30.md', '2027-01-04.md']) fs.writeFileSync(path.join(dir, f), '---\n---\n');
  assert.deepEqual(store.listMealPlans(), ['2026-09-28', '2026-10-12', '2027-01-04']);
});
