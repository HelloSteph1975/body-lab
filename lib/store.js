'use strict';
// The notes service. Every read and write of the Body Lab folder goes through
// here, so the "never overwrite a note we can't read" rule lives in one place.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const fm = require('./frontmatter');
const metrics = require('./metrics');
const render = require('./render');
const defaults = require('./defaults');
const { HttpError } = require('./errors');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LISTS = { meals: 'm', readings: 'r', activity: 'a', notes: 'n', shots: 's' };
const DAY_FIELDS = ['weight', 'water_oz', 'sleep_hours', 'ratings', 'supplements', 'symptoms', 'hormonal'];
const DOCS = {
  goals: 'Goals.md',
  phases: 'Phases.md',
  supplements: path.join('Library', 'Supplement plan.md'),
  workouts: path.join('Library', 'Workouts.md'),
  glp1: path.join('Library', 'GLP-1.md'),
};
const STARTER_PROGRAMS = require('./starters/programs');
const STARTER_DIETS = require('./starters/diets');
const STARTER_RECIPES = require('./starters/recipes');
const GUIDE_SOURCE = path.join(__dirname, '..', 'docs', 'guide', 'How to add things.md');
const COLLECTIONS = {
  foods: { dir: 'Foods', key: 'name' },
  labs: { dir: 'Labs', key: 'date' },
  programs: { dir: 'Programs', key: 'name' },
  diets: { dir: 'Diets', key: 'name' },
  recipes: { dir: 'Recipes', key: 'name' },
};

const newId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = (v) => structuredClone(v);

// On Windows, OneDrive or an open editor can hold a file for a moment; rename
// and unlink then fail with EPERM/EACCES/EBUSY. Retry briefly, then say so.
const BUSY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function retryFs(op, { tries = 5, delayMs = 250 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return op();
    } catch (e) {
      if (!BUSY_CODES.has(e.code)) throw e;
      if (attempt >= tries) throw new HttpError(503, 'The file is busy (OneDrive may be syncing). Try again in a moment.');
      sleepSync(delayMs);
    }
  }
}

function removeQuietly(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // best effort
  }
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    retryFs(() => fs.renameSync(tmp, file));
  } catch (e) {
    removeQuietly(tmp);
    throw e;
  }
}

// Every note the app writes records a hash of the body it wrote. If the body on
// disk no longer matches (or never had a hash), someone typed in it.
const bodySha = (body) => crypto.createHash('sha256').update(String(body)).digest('hex').slice(0, 16);

function requireObject(value, what = 'That') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${what} must be an object.`);
  }
  return value;
}

function safeName(value) {
  const name = String(value ?? '').replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/^\.+/, '').trim();
  if (!name) throw new HttpError(400, 'A name is required.');
  return name;
}

function validateKey(key) {
  if (!/^[A-Za-z_][\w-]*$/.test(String(key))) throw new HttpError(400, `Invalid key: ${key}`);
}

// makeId replaces the entry id maker; the demo data tool passes a seeded one so a run repeats exactly.
function createStore(root, { makeId = newId } = {}) {
  const at = (rel) => path.join(root, rel);

  function readNote(file) {
    if (!fs.existsSync(file)) return { exists: false, data: null };
    try {
      const text = fs.readFileSync(file, 'utf8');
      const parsed = fm.parse(text);
      // Text with no properties block is someone's own note, not an empty one.
      if (!parsed.hasFrontmatter && parsed.body.trim()) {
        return { exists: true, data: null, broken: "it has no properties block at the top (the section between two --- lines)" };
      }
      const { body_sha: sha, ...data } = parsed.data;
      return { exists: true, data, body: parsed.body, sha, blank: !text.trim() };
    } catch (e) {
      return { exists: true, data: null, broken: e.message };
    }
  }

  function refuseBroken(file, rel) {
    const n = readNote(file);
    if (n.broken) throw new HttpError(409, `${rel} can't be read, so it wasn't changed: ${n.broken}`);
    return n;
  }

  function backupIfEdited(file, prior) {
    if (prior && prior.exists && !prior.blank && prior.body.trim() && (!prior.sha || bodySha(prior.body) !== prior.sha)) {
      trash(file, { copy: true });
    }
  }

  // Writes a note with its body hash, first copying the old file to .trash if
  // its body was edited by hand (or predates the hash).
  function writeNote(file, data, body, prior) {
    backupIfEdited(file, prior);
    const { body_sha: _ignored, ...clean } = data;
    writeAtomic(file, fm.serialize({ ...clean, body_sha: bodySha(body) }, body));
  }

  // Moves a file into .trash (or copies it, when the original is about to be rewritten).
  function trash(file, { copy = false, now = new Date() } = {}) {
    const dir = at('.trash');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    let dest = path.join(dir, `${path.basename(file, '.md')} ${stamp}.md`);
    // Avoid collisions by adding (2), (3), etc. suffix
    let suffix = 2;
    while (fs.existsSync(dest)) {
      dest = path.join(dir, `${path.basename(file, '.md')} ${stamp} (${suffix}).md`);
      suffix++;
    }
    if (copy) retryFs(() => fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL));
    else retryFs(() => {
      if (fs.existsSync(dest)) throw new Error('Destination exists');
      fs.renameSync(file, dest);
    });
  }

  // ---- docs: goals, phases, supplement plan, workouts
  function docFile(name) {
    if (!DOCS[name]) throw new HttpError(404, `No document called ${name}.`);
    return at(DOCS[name]);
  }

  function getDoc(name) {
    const n = refuseBroken(docFile(name), DOCS[name]);
    return n.data && Object.keys(n.data).length ? n.data : clone(defaults[name]);
  }

  function saveDoc(name, data) {
    const file = docFile(name);
    requireObject(data);
    const prior = refuseBroken(file, DOCS[name]);
    const { body_sha: _ignored, ...clean } = data;
    for (const key of Object.keys(clean)) validateKey(key);
    writeNote(file, clean, render.renderDoc(name, clean), prior);
    return clean;
  }

  // Seeds a starter folder once. A crash mid-seed can leave a marked <dir>.seeding behind. Only a
  // folder carrying our marker is ours: it moves to .trash. Anything else is left alone. A locked
  // file must never stop the server from starting, so seeding problems only log.
  function seedCollection(dir, coll, starters) {
    const label = dir.toLowerCase();
    try {
      const tmp = at(`${dir}.seeding`);
      const marker = path.join(tmp, '.body-lab-seeding');
      let blocked = false;
      if (fs.existsSync(tmp)) {
        if (fs.existsSync(marker)) {
          const trashDir = at('.trash');
          fs.mkdirSync(trashDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          let dest = path.join(trashDir, `${dir}.seeding ${stamp}`);
          for (let n = 2; fs.existsSync(dest); n += 1) dest = path.join(trashDir, `${dir}.seeding ${stamp} (${n})`);
          retryFs(() => fs.renameSync(tmp, dest));
        } else {
          blocked = true;
          console.error(`${dir}.seeding exists but was not made by Body Lab, so it was left alone. Starter ${label} were not added.`);
        }
      }
      if (!blocked && !fs.existsSync(at(dir))) {
        // Build in a side folder and rename, so a crash can't leave the folder half-filled.
        fs.mkdirSync(tmp, { recursive: true });
        fs.writeFileSync(marker, `Body Lab is building the starter ${label} here. Safe to delete if Body Lab is not running.`);
        for (const item of starters) {
          const data = clone(item);
          writeNote(path.join(tmp, `${safeName(data.name)}.md`), data, render.renderItem(coll, data), null);
        }
        // Rename first: if it fails, the marker stays so the next start can clean up and retry.
        retryFs(() => fs.renameSync(tmp, at(dir)));
        try {
          fs.rmSync(path.join(at(dir), '.body-lab-seeding'), { force: true });
        } catch { /* a stray marker file is harmless: listItems reads only *.md */ }
      }
    } catch (e) {
      console.error(`Couldn't set up the starter ${label}: ${e.message}`);
    }
  }

  function ensureSeed() {
    for (const dir of ['Days', 'Foods', 'Labs', 'Library']) fs.mkdirSync(at(dir), { recursive: true });
    for (const name of Object.keys(DOCS)) {
      try {
        if (!fs.existsSync(docFile(name))) saveDoc(name, clone(defaults[name]));
      } catch (e) {
        console.error(`Couldn't write the default ${name} note: ${e.message}`);
      }
    }
    seedCollection('Programs', 'programs', STARTER_PROGRAMS);
    seedCollection('Diets', 'diets', STARTER_DIETS);
    seedCollection('Recipes', 'recipes', STARTER_RECIPES);
    let guide = null;
    try {
      guide = fs.readFileSync(GUIDE_SOURCE, 'utf8');
    } catch (e) {
      console.error(`Couldn't read the AI guide: ${e.message}`);
    }
    const guideFile = at('How to add things.md');
    if (guide !== null) {
      try {
        const exists = fs.existsSync(guideFile);
        if (!exists || fs.readFileSync(guideFile, 'utf8') !== guide) {
          if (exists) trash(guideFile, { copy: true });
          writeAtomic(guideFile, guide);
        }
      } catch (e) {
        console.error(`Couldn't update the AI guide: ${e.message}`);
      }
    }
  }

  function planItems() {
    const n = readNote(docFile('supplements'));
    return (n.data && n.data.items) || [];
  }

  // ---- days
  function dayFile(date) {
    if (!DATE_RE.test(String(date))) throw new HttpError(400, `Not a date: ${date}`);
    return at(path.join('Days', `${date}.md`));
  }

  function readDay(date) {
    const n = readNote(dayFile(date));
    if (n.broken) return { date, broken: n.broken };
    const data = { ...(n.data || {}), date };
    return { date, exists: n.exists, data, totals: metrics.dayTotals(data, planItems()) };
  }

  function updateDay(date, change) {
    const file = dayFile(date);
    const n = refuseBroken(file, `Days/${date}.md`);
    const data = { date, ...(n.data || {}) };
    const result = change(data);
    data.date = date;
    writeNote(file, data, render.renderDay(date, data, planItems()), n);
    return result;
  }

  function patchDay(date, fields) {
    requireObject(fields);
    return updateDay(date, (d) => {
      for (const [k, v] of Object.entries(fields)) {
        if (!DAY_FIELDS.includes(k)) throw new HttpError(400, `Can't set ${k} on a day.`);
        if (v === null) delete d[k];
        else if (k === 'supplements' && typeof v === 'object' && !Array.isArray(v)) {
          const old = d.supplements && typeof d.supplements === 'object' && !Array.isArray(d.supplements) ? d.supplements : {};
          d.supplements = { ...old, ...v };
        } else d[k] = v;
      }
      return { ok: true };
    });
  }

  function checkList(list) {
    if (!LISTS[list]) throw new HttpError(404, `No list called ${list}.`);
  }

  function findIndex(d, list, id) {
    const i = (d[list] || []).findIndex((e) => e.id === id);
    if (i < 0) throw new HttpError(404, `Couldn't find that entry (${id}).`);
    return i;
  }

  function addEntry(date, list, entry) {
    checkList(list);
    requireObject(entry);
    return updateDay(date, (d) => {
      const e = { ...entry, id: makeId(LISTS[list]) };
      d[list] = [...(d[list] || []), e];
      return e;
    });
  }

  function updateEntry(date, list, id, entry) {
    checkList(list);
    requireObject(entry);
    return updateDay(date, (d) => {
      const i = findIndex(d, list, id);
      d[list][i] = { ...entry, id };
      return d[list][i];
    });
  }

  function deleteEntry(date, list, id) {
    checkList(list);
    return updateDay(date, (d) => {
      const i = findIndex(d, list, id);
      d[list].splice(i, 1);
      return { deleted: id };
    });
  }

  function listDays(from, to) {
    const dir = at('Days');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map((f) => f.slice(0, 10))
      .filter((d) => (!from || d >= from) && (!to || d <= to))
      .sort()
      .map(readDay);
  }

  function journal({ q, tag } = {}) {
    const needle = q ? String(q).toLowerCase() : null;
    const out = [];
    for (const day of listDays()) {
      const notes = day.data && day.data.notes;
      for (const n of Array.isArray(notes) ? notes : []) {
        if (tag && !(n.tags || []).includes(tag)) continue;
        if (needle && !String(n.text || '').toLowerCase().includes(needle)) continue;
        out.push({ ...n, date: day.date });
      }
    }
    const key = (n) => `${n.date} ${n.time || ''}`;
    return out.sort((a, b) => key(b).localeCompare(key(a)));
  }

  // ---- collections: foods (one note per food), labs (one note per visit)
  function coll(name) {
    if (!COLLECTIONS[name]) throw new HttpError(404, `No collection called ${name}.`);
    return COLLECTIONS[name];
  }

  const itemFile = (c, id) => at(path.join(c.dir, `${safeName(id)}.md`));

  function listItems(name) {
    const c = coll(name);
    const dir = at(c.dir);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const id = f.slice(0, -3);
        const file = path.join(dir, f);
        const n = readNote(file);
        // version (a hash of the note's bytes, never written to it) lets a save refuse stale data.
        return n.broken ? { id, broken: n.broken } : { ...n.data, id, version: fileVersion(file) };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function saveItem(name, oldId, item) {
    const c = coll(name);
    requireObject(item);
    const id = safeName(item[c.key]);
    if (name === 'labs' && !DATE_RE.test(id)) throw new HttpError(400, 'The lab date must look like 2026-01-15.');
    const target = itemFile(c, id);
    let oldNote = null;
    if (oldId) {
      const old = itemFile(c, oldId);
      if (!fs.existsSync(old)) throw new HttpError(404, `Couldn't find ${oldId}.`);
      oldNote = refuseBroken(old, `${c.dir}/${oldId}.md`);
      // Optimistic concurrency, as for meal plans: a save that read an older version must re-read first.
      if (Object.hasOwn(item, 'expected_version') && item.expected_version !== fileVersion(old)) {
        const stale = new HttpError(409, `${oldId} changed in another window.`);
        stale.code = 'stale';
        throw stale;
      }
    }
    if (id !== oldId && fs.existsSync(target)) throw new HttpError(409, `${id} already exists.`);
    const data = { ...item, [c.key]: id };
    delete data.id;
    delete data.body_sha;
    delete data.version;
    delete data.expected_version;
    for (const key of Object.keys(data)) validateKey(key);
    const renamed = oldId && oldId !== id;
    // On a rename the old file is removed below, so back it up now if it was edited by hand.
    if (renamed) backupIfEdited(itemFile(c, oldId), oldNote);
    writeNote(target, data, render.renderItem(name, data), renamed ? null : oldNote);
    if (renamed) {
      try {
        retryFs(() => fs.unlinkSync(itemFile(c, oldId)));
      } catch (e) {
        removeQuietly(target); // don't leave a duplicate behind
        throw e;
      }
    }
    return { ...data, id };
  }

  function deleteItem(name, id) {
    const file = itemFile(coll(name), id);
    if (!fs.existsSync(file)) throw new HttpError(404, `Couldn't find ${id}.`);
    trash(file);
    return { deleted: id };
  }

  // ---- meal plans: one note per week, named by its Monday
  const isMonday = (iso) => {
    if (!DATE_RE.test(String(iso))) return false;
    const d = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && d.getUTCDay() === 1;
  };
  function planFile(monday) {
    if (!isMonday(monday)) throw new HttpError(400, `Meal plans are saved by week; ${monday} isn't a Monday.`);
    return at(path.join('Meal plans', `${monday}.md`));
  }
  const emptyPlan = (monday) => ({ week_start: monday, meals: [], prep: [], shopping: { checked: [], extras: [] } });
  const arr = (v) => (Array.isArray(v) ? v : []);

  // The version is a short hash of the note's bytes; it is sent to the page, never written to the note.
  const fileVersion = (file) => (fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12) : 'none');
  const isGroup = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  function listMealPlans() {
    const dir = at('Meal plans');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map((f) => /^(\d{4}-\d{2}-\d{2})\.md$/.exec(f)).filter((m) => m && isMonday(m[1])).map((m) => m[1]).sort();
  }

  const shoppingOf = (data) => (data.shopping && typeof data.shopping === 'object' && !Array.isArray(data.shopping) ? data.shopping : {});
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const keep = (o, k) => (has(o, k) ? o[k] : []);

  // Odd shapes in what is being saved become empty lists, so the note always reads cleanly.
  function normalizePlan(monday, data) {
    const shopping = shoppingOf(data);
    return {
      ...data,
      week_start: monday,
      meals: arr(data.meals),
      prep: arr(data.prep),
      shopping: { ...shopping, checked: arr(shopping.checked), extras: arr(shopping.extras) },
    };
  }

  // A list field in the note that holds something else (a hand edit or an AI tool) is the person's data:
  // name it, and refuse to replace it with an empty list.
  function listProblem(data) {
    if (has(data, 'shopping') && !isGroup(data.shopping)) return "This week's plan note has a shopping field that isn't a group of fields; fix it in the note first.";
    const shopping = shoppingOf(data);
    for (const [name, box, key] of [['meals', data, 'meals'], ['prep', data, 'prep'], ['shopping.checked', shopping, 'checked'], ['shopping.extras', shopping, 'extras']]) {
      if (has(box, key) && !Array.isArray(box[key])) return `This week's plan note has a ${name} field that isn't a list; fix it in the note first.`;
    }
    return null;
  }

  // Reading fills in missing lists but returns odd ones as they are, so the app can see and refuse them.
  function getMealPlan(monday) {
    const file = planFile(monday);
    const n = refuseBroken(file, `Meal plans/${monday}.md`);
    const { version: v1, expected_version: v2, ...data } = n.data || {};
    const shopping = shoppingOf(data);
    return {
      ...data,
      week_start: monday,
      meals: keep(data, 'meals'),
      prep: keep(data, 'prep'),
      shopping: has(data, 'shopping') && !isGroup(data.shopping) ? data.shopping
        : { ...shopping, checked: keep(shopping, 'checked'), extras: keep(shopping, 'extras') },
      version: fileVersion(file),
    };
  }

  function saveMealPlan(monday, plan) {
    const file = planFile(monday);
    requireObject(plan);
    if (plan.week_start && plan.week_start !== monday) throw new HttpError(400, 'week_start must match the week in the address.');
    // Optimistic concurrency: a page that read an older version of this week must re-read first.
    if (has(plan, 'expected_version') && plan.expected_version !== fileVersion(file)) {
      const stale = new HttpError(409, 'This week changed in another window.');
      stale.code = 'stale';
      throw stale;
    }
    const prior = refuseBroken(file, `Meal plans/${monday}.md`);
    const problem = prior && prior.data ? listProblem(prior.data) : null;
    if (problem) throw new HttpError(409, problem);
    const data = normalizePlan(monday, plan);
    delete data.body_sha;
    delete data.version;
    delete data.expected_version;
    for (const key of Object.keys(data)) validateKey(key);
    writeNote(file, data, render.renderMealPlan(data), prior);
    return { ...data, version: fileVersion(file) };
  }

  return {
    ensureSeed, getDoc, saveDoc,
    readDay, patchDay, addEntry, updateEntry, deleteEntry, listDays, journal,
    listItems, deleteItem, trashFile: trash, getMealPlan, saveMealPlan, listMealPlans,
    createItem: (name, item) => saveItem(name, null, item),
    updateItem: (name, id, item) => saveItem(name, id, item),
  };
}

module.exports = { createStore, retryFs, writeAtomic, LISTS, DAY_FIELDS, COLLECTION_NAMES: Object.keys(COLLECTIONS) };
