const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store');
const { makeDemoData, MARKER, MARKER_TEXT } = require('../tools/make-demo-data');

const END = '2026-10-04';
const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function tempDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bodylab-demo-'));
  roots.push(root);
  return root;
}

// Every file under dir, as relative path -> contents.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(dir, full).replace(/\\/g, '/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

let shared;
async function demo() {
  if (!shared) {
    const root = path.join(tempDir(), 'demo');
    await makeDemoData(root, { seed: 7, end: END });
    shared = { root, store: createStore(root) };
  }
  return shared;
}

test('the demo folder gets its marker and 8 weeks of days ending on --end', async () => {
  const { root, store } = await demo();
  assert.ok(fs.existsSync(path.join(root, MARKER)));
  const days = store.listDays();
  assert.equal(days.length, 56);
  assert.equal(days[0].date, '2026-08-10');
  assert.equal(days[days.length - 1].date, END);
});

test('every note parses and saves again without a 409', async () => {
  const { store } = await demo();
  for (const day of store.listDays()) {
    assert.equal(day.broken, undefined, `${day.date}: ${day.broken}`);
    assert.ok(day.data.meals.length >= 1, `${day.date} has meals`);
    store.patchDay(day.date, { water_oz: day.data.water_oz });
  }
  for (const name of ['foods', 'labs', 'programs', 'diets', 'recipes']) {
    for (const item of store.listItems(name)) assert.equal(item.broken, undefined, `${name}/${item.id}`);
  }
  for (const name of ['goals', 'phases', 'supplements', 'workouts', 'glp1']) store.saveDoc(name, store.getDoc(name));
  const mondays = store.listMealPlans();
  assert.ok(mondays.length >= 2);
  for (const monday of mondays) {
    const plan = store.getMealPlan(monday);
    assert.ok(plan.meals.length >= 21);
    store.saveMealPlan(monday, { ...plan, expected_version: plan.version });
  }
  const current = store.getMealPlan('2026-09-28');
  assert.ok(current.prep.length >= 1 && current.prep.every((q) => q.meal_ids.length > 0));
  assert.ok(current.shopping.checked.length > 0);
});

test('weight trends down over the period', async () => {
  const { store } = await demo();
  const weights = store.listDays().map((d) => d.data.weight).filter((w) => typeof w === 'number');
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const first = mean(weights.slice(0, 7));
  const last = mean(weights.slice(-7));
  const perWeek = (first - last) / 7;
  assert.ok(perWeek >= 0.5 && perWeek <= 1.5, `lost ${perWeek.toFixed(2)} lb a week`);
});

test('GLP-1 tracking is on, with about one shot a week on rotating sites', async () => {
  const { store } = await demo();
  const glp1 = store.getDoc('glp1');
  assert.equal(glp1.enabled, true);
  assert.equal(typeof glp1.dose_mg, 'number');
  const shots = store.listDays().flatMap((d) => (d.data.shots || []).map((s) => ({ date: d.date, ...s })));
  assert.ok(shots.length >= 6 && shots.length <= 9, `${shots.length} shots`);
  for (let i = 1; i < shots.length; i += 1) {
    const gap = (Date.parse(shots[i].date) - Date.parse(shots[i - 1].date)) / 86400000;
    assert.ok(gap >= 5 && gap <= 9, `gap of ${gap} days`);
    assert.notEqual(shots[i].site, shots[i - 1].site);
  }
});

test('the rest of the story is there: labs, phases, goals, workouts and walks', async () => {
  const { store } = await demo();
  const labs = store.listItems('labs');
  assert.equal(labs.length, 2);
  assert.ok(labs[1].a1c < labs[0].a1c);
  assert.ok(store.getDoc('phases').phases.length >= 4);
  const goals = store.getDoc('goals');
  assert.equal(typeof goals.ideal_weight, 'number');
  assert.ok(store.listItems('programs').some((p) => p.id === goals.program));
  const days = store.listDays();
  const workouts = days.flatMap((d) => (d.data.activity || []).filter((a) => a.type === 'workout'));
  assert.ok(workouts.length >= 8 && workouts.every((w) => w.program === goals.program && w.sets.length > 0));
  const walks = days.flatMap((d) => (d.data.activity || []).filter((a) => a.type === 'walk'));
  assert.ok(walks.length >= days.length * 1.8);
  assert.ok(store.journal().length >= 15);
});

test('the same seed gives the same notes, and another seed does not', async () => {
  const a = path.join(tempDir(), 'a');
  const b = path.join(tempDir(), 'b');
  const c = path.join(tempDir(), 'c');
  await makeDemoData(a, { seed: 11, end: END, weeks: 3 });
  await makeDemoData(b, { seed: 11, end: END, weeks: 3 });
  await makeDemoData(c, { seed: 12, end: END, weeks: 3 });
  assert.deepEqual(snapshot(a), snapshot(b));
  assert.notDeepEqual(snapshot(a), snapshot(c));
});

test('running again on a demo folder rebuilds it', async () => {
  const dir = path.join(tempDir(), 'again');
  await makeDemoData(dir, { seed: 3, end: END, weeks: 3 });
  const before = snapshot(dir);
  fs.writeFileSync(path.join(dir, 'Days', '2020-01-01.md'), '---\nweight: 1\n---\n');
  await makeDemoData(dir, { seed: 3, end: END, weeks: 3 });
  assert.deepEqual(snapshot(dir), before);
});

test('it refuses a folder with notes and no demo marker, and changes nothing', async () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'Days'));
  const note = path.join(dir, 'Days', '2026-01-05.md');
  fs.writeFileSync(note, '---\nweight: 180\n---\n');
  await assert.rejects(makeDemoData(dir, { end: END }), /isn't a demo folder/);
  assert.deepEqual(fs.readdirSync(dir), ['Days']);
  assert.equal(fs.readFileSync(note, 'utf8'), '---\nweight: 180\n---\n');
});

test('it refuses a folder with other files in it, even with no notes', async () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'Library'));
  fs.writeFileSync(path.join(dir, 'Library', 'photo.jpg'), 'not a note');
  fs.writeFileSync(path.join(dir, 'todo.txt'), 'keep me');
  await assert.rejects(makeDemoData(dir, { end: END }), /isn't a demo folder/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Library', 'todo.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'Library', 'photo.jpg'), 'utf8'), 'not a note');
});

test('it refuses a marker it did not write, and changes nothing', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, MARKER), 'something else');
  fs.mkdirSync(path.join(dir, 'Recipes'));
  fs.writeFileSync(path.join(dir, 'Recipes', 'Soup.md'), 'mine');
  await assert.rejects(makeDemoData(dir, { end: END }), /didn't write/);
  assert.equal(fs.readFileSync(path.join(dir, MARKER), 'utf8'), 'something else');
  assert.equal(fs.readFileSync(path.join(dir, 'Recipes', 'Soup.md'), 'utf8'), 'mine');
});

test('an empty folder is accepted and marked', async () => {
  const dir = tempDir();
  await makeDemoData(dir, { seed: 2, end: END, weeks: 3 });
  assert.equal(fs.readFileSync(path.join(dir, MARKER), 'utf8'), MARKER_TEXT);
});

test('a rebuild that hits a busy file says to stop the demo first', async () => {
  const dir = path.join(tempDir(), 'busy');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, MARKER), MARKER_TEXT);
  fs.mkdirSync(path.join(dir, 'Days'));
  const realRm = fs.rmSync;
  fs.rmSync = (p, ...rest) => {
    if (path.basename(p) === 'Days') throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
    return realRm(p, ...rest);
  };
  try {
    await assert.rejects(makeDemoData(dir, { end: END, weeks: 3 }), /Stop the demo first \(Stop Body Lab with -Demo\), then try again\.$/);
  } finally {
    fs.rmSync = realRm;
  }
});

test('bad options are refused', async () => {
  const dir = path.join(tempDir(), 'bad');
  await assert.rejects(makeDemoData(dir, { end: '2026-02-30' }), /--end/);
  await assert.rejects(makeDemoData(dir, { weeks: 1, end: END }), /--weeks/);
  assert.equal(fs.existsSync(dir), false);
});
