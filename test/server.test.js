const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');

async function start(t, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bodylab-http-'));
  start.lastRoot = root;
  const app = createApp(root, options);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.close(); app.backup.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return `http://127.0.0.1:${server.address().port}`;
}
const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('day entries round-trip over HTTP', async (t) => {
  const base = await start(t);
  let r = await fetch(`${base}/api/day/2026-09-30/meals`, json({ time: '07:30', kind: 'breakfast', items: [{ food: 'Eggs', protein: 12 }] }));
  assert.equal(r.status, 200);
  const meal = await r.json();
  r = await fetch(`${base}/api/day/2026-09-30`);
  assert.equal((await r.json()).totals.protein, 12);
  r = await fetch(`${base}/api/day/2026-09-30/meals/${meal.id}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  r = await fetch(`${base}/api/days?from=2026-09-01&to=2026-09-30`);
  assert.equal((await r.json()).length, 1);
});

test('errors come back with their status', async (t) => {
  const base = await start(t);
  const r = await fetch(`${base}/api/day/nope`);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Not a date/);
});

test('writes without a JSON content type are refused', async (t) => {
  const base = await start(t);
  const r = await fetch(`${base}/api/foods`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"name":"x"}' });
  assert.equal(r.status, 415);
});

test('requests for another host are refused', async (t) => {
  const base = await start(t);
  const { port } = new URL(base);
  const status = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/api/doc/goals', headers: { Host: 'evil.example' } }, (res) => resolve(res.statusCode));
  });
  assert.equal(status, 403);
});

test('static files are served and traversal is refused', async (t) => {
  const base = await start(t);
  let r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Body Lab/);
  r = await fetch(`${base}/..%2fserver.js`);
  assert.equal(r.status, 404);
});

test('shutdown requires application/json content-type', async (t) => {
  let shutdownCalled = false;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bodylab-http-'));
  const app = createApp(root, { onShutdown: () => { shutdownCalled = true; } });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.close(); app.backup.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const base = `http://127.0.0.1:${server.address().port}`;

  let r = await fetch(`${base}/api/shutdown`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415);
  assert.equal(shutdownCalled, false);

  r = await fetch(`${base}/api/shutdown`, json({}));
  assert.equal(r.status, 200);
  assert.equal(shutdownCalled, true);
});

test('a malformed escape in the URL is a 400', async (t) => {
  const base = await start(t);
  const r = await fetch(`${base}/api/foods/%E0`, { method: 'DELETE' });
  assert.equal(r.status, 400);
});

test('a day note without frontmatter gives 409 over HTTP and stays untouched', async (t) => {
  const base = await start(t);
  const file = path.join(start.lastRoot, 'Days', '2026-09-30.md');
  fs.writeFileSync(file, 'My journal\n');
  const r = await fetch(`${base}/api/day/2026-09-30`, json({ supplements: { berberine: true } }, 'PATCH'));
  assert.equal(r.status, 409);
  assert.equal(fs.readFileSync(file, 'utf8'), 'My journal\n');
});

test('backup routes: snapshot, list, diff and restore', async (t) => {
  const base = await start(t);
  const root = start.lastRoot;
  let r = await fetch(`${base}/api/backups`, json({}));
  assert.equal(r.status, 200);
  const { taken_on: takenOn } = await r.json();
  r = await fetch(`${base}/api/backups`);
  const list = await r.json();
  assert.equal(list.days[0].taken_on, takenOn);
  fs.writeFileSync(path.join(root, 'Goals.md'), '---\nideal_weight: 1\n---\n');
  r = await fetch(`${base}/api/backups/${takenOn}`);
  assert.deepEqual(await r.json(), [{ path: 'Goals.md', status: 'changed' }]);
  r = await fetch(`${base}/api/backups/${takenOn}/restore`, json({ paths: ['Goals.md'] }));
  assert.deepEqual((await r.json()).restored, ['Goals.md']);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'Goals.md'), 'utf8'), /ideal_weight: 1\n/);
  r = await fetch(`${base}/api/backups/2020-01-01`);
  assert.equal(r.status, 404);
});

test('programs route lists the starters', async (t) => {
  const base = await start(t);
  const r = await fetch(`${base}/api/programs`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).length, 2);
});

test('programs: PUT keeps unknown keys, a rename moves the note, DELETE goes to .trash', async (t) => {
  const base = await start(t);
  const root = start.lastRoot;
  const prog = { name: 'Mine', author: 'an AI', phases: [{ name: 'P', weeks: 1, days: { mon: 'A' }, focus: 'legs' }], routines: [{ name: 'A', moves: [], tip: 'warm up' }] };
  let r = await fetch(`${base}/api/programs`, json(prog));
  assert.equal(r.status, 200);
  r = await fetch(`${base}/api/programs/Mine`, json({ ...prog, description: 'new' }, 'PUT'));
  assert.equal(r.status, 200);
  r = await fetch(`${base}/api/programs`);
  const mine = (await r.json()).find((p) => p.id === 'Mine');
  assert.equal(mine.author, 'an AI');
  assert.equal(mine.phases[0].focus, 'legs');
  assert.equal(mine.routines[0].tip, 'warm up');
  assert.equal(mine.description, 'new');
  // rename
  r = await fetch(`${base}/api/programs/Mine`, json({ ...prog, name: 'Renamed' }, 'PUT'));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).id, 'Renamed');
  assert.ok(fs.existsSync(path.join(root, 'Programs', 'Renamed.md')));
  assert.ok(!fs.existsSync(path.join(root, 'Programs', 'Mine.md')));
  // renaming onto an existing program is refused
  r = await fetch(`${base}/api/programs/Renamed`, json({ ...prog, name: 'Dumbbell Basics' }, 'PUT'));
  assert.equal(r.status, 409);
  // delete
  r = await fetch(`${base}/api/programs/Renamed`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.ok(!fs.existsSync(path.join(root, 'Programs', 'Renamed.md')));
  assert.ok(fs.readdirSync(path.join(root, '.trash')).some((f) => f.startsWith('Renamed ')));
  r = await fetch(`${base}/api/programs/Renamed`, { method: 'DELETE' });
  assert.equal(r.status, 404);
});

test('programs: a note that cannot be read is not overwritten or renamed', async (t) => {
  const base = await start(t);
  const file = path.join(start.lastRoot, 'Programs', 'Beginner Bodyweight.md');
  const bad = '---\nname: "Beginner Bodyweight"\nroutines: [oops\n---\nhand text\n';
  fs.writeFileSync(file, bad);
  let r = await fetch(`${base}/api/programs`);
  assert.equal((await r.json()).find((p) => p.id === 'Beginner Bodyweight').broken !== undefined, true);
  r = await fetch(`${base}/api/programs/Beginner%20Bodyweight`, json({ name: 'Beginner Bodyweight', phases: [], routines: [] }, 'PUT'));
  assert.equal(r.status, 409);
  r = await fetch(`${base}/api/programs/Beginner%20Bodyweight`, json({ name: 'Other', phases: [], routines: [] }, 'PUT'));
  assert.equal(r.status, 409);
  assert.equal(fs.readFileSync(file, 'utf8'), bad);
});

test('meal plan and recipe routes', async (t) => {
  const base = await start(t);
  let r = await fetch(`${base}/api/recipes`);
  assert.equal((await r.json()).length, 18);
  r = await fetch(`${base}/api/mealplan/2026-10-05`);
  assert.deepEqual((await r.json()).meals, []);
  r = await fetch(`${base}/api/mealplan/2026-10-05`, json({ week_start: '2026-10-05', meals: [], prep: [], shopping: { checked: ['eggs|each'], extras: [] } }, 'PUT'));
  assert.equal(r.status, 200);
  r = await fetch(`${base}/api/mealplan/2026-10-05`);
  assert.deepEqual((await r.json()).shopping.checked, ['eggs|each']);
  r = await fetch(`${base}/api/mealplan/2026-10-07`);
  assert.equal(r.status, 400);
});

test('meal plan week mismatch is 400 and a broken plan note is 409', async (t) => {
  const base = await start(t);
  let r = await fetch(`${base}/api/mealplan/2026-10-05`, json({ week_start: '2026-10-12', meals: [] }, 'PUT'));
  assert.equal(r.status, 400);
  fs.mkdirSync(path.join(start.lastRoot, 'Meal plans'), { recursive: true });
  fs.writeFileSync(path.join(start.lastRoot, 'Meal plans', '2026-10-05.md'), '---\nmeals: [oops\n---\n');
  r = await fetch(`${base}/api/mealplan/2026-10-05`);
  assert.equal(r.status, 409);
  r = await fetch(`${base}/api/mealplan/2026-10-05`, json({ meals: [] }, 'PUT'));
  assert.equal(r.status, 409);
});

test('GET /api/mealplans lists plan weeks; a stale save says stale: true', async (t) => {
  const base = await start(t);
  let r = await fetch(`${base}/api/mealplans`);
  assert.deepEqual(await r.json(), []);
  await fetch(`${base}/api/mealplan/2026-10-12`, json({ meals: [] }, 'PUT'));
  await fetch(`${base}/api/mealplan/2026-10-05`, json({ meals: [] }, 'PUT'));
  r = await fetch(`${base}/api/mealplans`);
  assert.deepEqual(await r.json(), ['2026-10-05', '2026-10-12']);
  const plan = await (await fetch(`${base}/api/mealplan/2026-10-05`)).json();
  r = await fetch(`${base}/api/mealplan/2026-10-05`, json({ meals: [{ id: 'a' }], expected_version: plan.version }, 'PUT'));
  assert.equal(r.status, 200);
  r = await fetch(`${base}/api/mealplan/2026-10-05`, json({ meals: [], expected_version: plan.version }, 'PUT'));
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'This week changed in another window.', stale: true });
});

const FOODS = [
  { id: 1, name: 'Egg, whole, raw, fresh', group: 'Dairy and Egg Products', tags: ['eggs'], per100: { kcal: 143, protein: 12.6, carbs: 0.7, fiber: 0, fat: 9.5 }, portions: [{ label: '1 large', g: 50 }] },
  { id: 2, name: 'Egg Beaters', group: 'Other', tags: [], per100: { kcal: 44, protein: 10, carbs: 1, fiber: 0, fat: 0 }, portions: [] },
  { id: 3, name: 'Apples, raw, with skin', group: 'Fruits and Fruit Juices', tags: ['fruit'], per100: { kcal: 52, protein: 0.3, carbs: 14, fiber: 2.4, fat: 0.2 }, portions: [] },
];

async function startWithFoods(t, foods) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bodylab-foods-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const foodsFile = path.join(dir, 'usda-foods.json');
  if (foods) fs.writeFileSync(foodsFile, JSON.stringify(foods));
  return { base: await start(t, { foodsFile }), foodsFile };
}

test('food search puts saved foods first, then USDA, and honors limit', async (t) => {
  const { base } = await startWithFoods(t, FOODS);
  await fetch(`${base}/api/foods`, json({ name: 'Egg salad', protein: 9 }));
  await fetch(`${base}/api/foods`, json({ name: 'Greek yogurt', protein: 9 }));
  const r = await fetch(`${base}/api/food-search?q=egg`);
  assert.equal(r.status, 200);
  let list = await r.json();
  assert.deepEqual(list.map((x) => [x.name, x.source]), [['Egg salad', 'saved'], ['Egg, whole, raw, fresh', 'usda'], ['Egg Beaters', 'usda']]);
  assert.equal(list[1].per100.protein, 12.6);
  list = await (await fetch(`${base}/api/food-search?q=egg&limit=2`)).json();
  assert.equal(list.length, 2);
  list = await (await fetch(`${base}/api/food-search?q=egg&limit=0`)).json();
  assert.equal(list.length, 1);
  list = await (await fetch(`${base}/api/food-search?q=e`)).json();
  assert.deepEqual(list, []);
});

test('GET /api/usda-food/:id returns one food, 404 for an unknown id', async (t) => {
  const { base } = await startWithFoods(t, FOODS);
  let r = await fetch(`${base}/api/usda-food/3`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).name, 'Apples, raw, with skin');
  r = await fetch(`${base}/api/usda-food/999`);
  assert.equal(r.status, 404);
});

test('a missing or broken food file gives 503 and the server keeps running; installing it later works', async (t) => {
  const { base, foodsFile } = await startWithFoods(t, null);
  let r = await fetch(`${base}/api/food-search?q=egg`);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'Food database not installed.');
  assert.equal((await fetch(`${base}/api/usda-food/1`)).status, 503);
  fs.writeFileSync(foodsFile, '{not json');
  assert.equal((await fetch(`${base}/api/food-search?q=egg`)).status, 503);
  fs.writeFileSync(foodsFile, JSON.stringify(FOODS));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(foodsFile, later, later); // a new mtime, even on a coarse clock
  r = await fetch(`${base}/api/food-search?q=egg`);
  assert.equal(r.status, 200);
  assert.equal((await fetch(`${base}/api/meta`)).status, 200);
});

test('a 0- or 1-character query is [] even before the food file exists', async (t) => {
  const { base } = await startWithFoods(t, null);
  for (const q of ['', 'e', '%20']) {
    const r = await fetch(`${base}/api/food-search?q=${q}`);
    assert.equal(r.status, 200, q);
    assert.deepEqual(await r.json(), []);
  }
  assert.deepEqual(await (await fetch(`${base}/api/food-search`)).json(), []);
});

test('GET /api/starter-recipes lists the built-in starters with USDA links', async (t) => {
  const { base } = await startWithFoods(t, FOODS);
  const r = await fetch(`${base}/api/starter-recipes`);
  assert.equal(r.status, 200);
  const list = await r.json();
  assert.equal(list.length, 18);
  assert.ok(list.every((x) => x.starter === true && x.per_serving_source === 'usda'));
  assert.ok(list[0].ingredients.some((i) => typeof i.usda_id === 'number'));
});

test('GET /api/starter-recipes hands out a copy, never the module list', async (t) => {
  const starters = require('../lib/starters/recipes');
  const before = JSON.stringify(starters);
  const base = await start(t);
  const list = await (await fetch(`${base}/api/starter-recipes`)).json();
  assert.deepEqual(list, JSON.parse(before));
  list[0].ingredients.length = 0;
  assert.equal(JSON.stringify(starters), before);
});

test('recipe saves carry a version; a stale expected_version is refused with 409', async (t) => {
  const base = await start(t);
  let list = await (await fetch(`${base}/api/recipes`)).json();
  const r = list.find((x) => x.name === 'Apple cinnamon oatmeal');
  assert.match(r.version, /^[0-9a-f]{12}$/);
  const url = `${base}/api/recipes/${encodeURIComponent(r.id)}`;
  let res = await fetch(url, json({ ...r, servings: 3, expected_version: 'old000000000' }, 'PUT'));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).stale, true);
  res = await fetch(url, json({ ...r, servings: 3, expected_version: r.version }, 'PUT'));
  assert.equal(res.status, 200);
  const saved = await res.json();
  assert.equal(saved.version, undefined);
  assert.equal(saved.expected_version, undefined);
  list = await (await fetch(`${base}/api/recipes`)).json();
  const again = list.find((x) => x.name === 'Apple cinnamon oatmeal');
  assert.equal(again.servings, 3);
  assert.notEqual(again.version, r.version);
  // Saves without expected_version work as before, and the version never lands in the note.
  assert.equal((await fetch(url, json({ ...again, servings: 2 }, 'PUT'))).status, 200);
  const note = fs.readFileSync(path.join(start.lastRoot, 'Recipes', 'Apple cinnamon oatmeal.md'), 'utf8');
  assert.doesNotMatch(note, /^(expected_)?version:/m);
});

test('a broken food file is read and logged once until it changes', async (t) => {
  const { base, foodsFile } = await startWithFoods(t, null);
  fs.writeFileSync(foodsFile, '{not json');
  const logged = [];
  const orig = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  t.after(() => { console.error = orig; });
  for (let n = 0; n < 3; n++) assert.equal((await fetch(`${base}/api/food-search?q=egg`)).status, 503);
  assert.equal(logged.filter((l) => /food database/.test(l)).length, 1);
  fs.writeFileSync(foodsFile, JSON.stringify(FOODS));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(foodsFile, later, later);
  assert.equal((await fetch(`${base}/api/food-search?q=egg`)).status, 200);
});

test('food search caps a huge limit at 30', async (t) => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: 1000 + i, name: `Egg, test ${i}`, group: 'Dairy and Egg Products', tags: ['eggs'], per100: { kcal: 1, protein: 1, carbs: 0, fiber: 0, fat: 0 }, portions: [] }));
  const { base } = await startWithFoods(t, many);
  const list = await (await fetch(`${base}/api/food-search?q=egg&limit=9999`)).json();
  assert.equal(list.length, 30);
});

function readmeFixture(t, { withReadme = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bodylab-readme-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const images = path.join(dir, 'images');
  fs.mkdirSync(images);
  fs.writeFileSync(path.join(images, 'today.png'), 'PNGDATA');
  fs.writeFileSync(path.join(images, 'shot.jpg'), 'JPGDATA');
  fs.writeFileSync(path.join(images, 'notes.txt'), 'secret');
  fs.mkdirSync(path.join(images, 'sub'));
  fs.writeFileSync(path.join(dir, 'outside.png'), 'OUTSIDE');
  const readmeFile = path.join(dir, 'README.md');
  if (withReadme) fs.writeFileSync(readmeFile, '# Hi\n');
  return { readmeFile, readmeImagesDir: images };
}

test('GET /api/readme returns the text, or 404', async (t) => {
  let base = await start(t, readmeFixture(t));
  let r = await fetch(`${base}/api/readme`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { text: '# Hi\n' });
  base = await start(t, readmeFixture(t, { withReadme: false }));
  r = await fetch(`${base}/api/readme`);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'Read Me not found.');
});

test('/readme-images serves png and jpg only, straight from the folder', async (t) => {
  const base = await start(t, readmeFixture(t));
  let r = await fetch(`${base}/readme-images/today.png`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(await r.text(), 'PNGDATA');
  r = await fetch(`${base}/readme-images/shot.jpg`);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  for (const bad of ['notes.txt', 'missing.png', 'sub', 'sub.png', '..%2Foutside.png', '%2e%2e%2foutside.png', '..%5Coutside.png', '%2e%2e/outside.png', 'a%2Fb.png', 'today.png%00', '%ZZ.png', '']) {
    r = await fetch(`${base}/readme-images/${bad}`);
    assert.equal(r.status, 404, bad);
    assert.notEqual(await r.text(), 'OUTSIDE');
  }
  // Raw paths that the client normalises or that carry a slash.
  const raw = await new Promise((resolve) => {
    const u = new URL(base);
    http.get({ host: u.hostname, port: u.port, path: '/readme-images/../outside.png' }, (res) => resolve(res.statusCode));
  });
  assert.equal(raw, 404);
});

test('/readme-images keeps the host allow-list', async (t) => {
  const base = await start(t, readmeFixture(t));
  const u = new URL(base);
  const status = await new Promise((resolve) => {
    http.get({ host: u.hostname, port: u.port, path: '/readme-images/today.png', headers: { Host: 'evil.com' } }, (res) => resolve(res.statusCode));
  });
  assert.equal(status, 403);
});

test('GET /api/info says whether the data folder is a demo folder', async (t) => {
  const { MARKER, MARKER_TEXT } = require('../lib/demo-marker');
  const base = await start(t);
  const info = async () => {
    const r = await fetch(`${base}/api/info`);
    assert.equal(r.status, 200);
    return r.json();
  };
  assert.deepEqual(await info(), { demo: false });
  fs.writeFileSync(path.join(start.lastRoot, MARKER), 'something else\n');
  assert.deepEqual(await info(), { demo: false }, 'a marker with other text is not a demo');
  fs.writeFileSync(path.join(start.lastRoot, MARKER), MARKER_TEXT);
  assert.deepEqual(await info(), { demo: true });
  const r = await fetch(`${base}/api/info`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 404, 'read-only');
});
