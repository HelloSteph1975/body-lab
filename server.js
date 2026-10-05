'use strict';
/*
 * Body Lab dashboard server. Zero dependencies. The Markdown notes in the
 * folder above App/ are the source of truth; lib/store.js owns every read
 * and write. Listens on 127.0.0.1 only.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createStore, writeAtomic, COLLECTION_NAMES } = require('./lib/store');
const { createBackup, localDate, ensureTodaySnapshot } = require('./lib/backup');
const { HttpError } = require('./lib/errors');
const defaults = require('./lib/defaults');
const { SLOTS } = require('./lib/render');
const STARTER_RECIPES = require('./lib/starters/recipes');
const { createFoodIndex, wordsOf, matchesWords, queryWordsOf } = require('./lib/foodsearch');
const { isDemoFolder } = require('./lib/demo-marker');

const ROOT = process.env.BODYLAB_ROOT ? path.resolve(process.env.BODYLAB_ROOT) : path.join(__dirname, '..');
const PORT = Number(process.env.BODYLAB_PORT) || 4185;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 256 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  try {
    checkJsonContentType(req);
  } catch (e) {
    return Promise.reject(e);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'That is too big to save.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HttpError(400, 'That was not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function checkJsonContentType(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new HttpError(415, 'Send JSON.');
  }
}

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new HttpError(400, 'That web address is not valid.');
  }
}

function serveStatic(pathname, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    rel = '';
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const DEFAULT_FOODS_FILE = path.join(__dirname, 'data', 'usda-foods.json');
const DEFAULT_README_FILE = path.join(__dirname, 'README.md');
const DEFAULT_README_IMAGES = path.join(__dirname, 'docs', 'readme');

// Serves one .png or .jpg that sits directly inside the Read Me image folder.
// Any slash, backslash, "..", or other extension is a plain 404.
function serveReadmeImage(imagesDir, rawName, res) {
  let name = '';
  try {
    name = decodeURIComponent(rawName);
  } catch {
    // bad escape: name stays empty and falls through to 404
  }
  const type = IMAGE_TYPES[path.extname(name).toLowerCase()];
  const file = path.join(imagesDir, name);
  if (!type || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || path.dirname(file) !== imagesDir
    || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function createApp(root, {
  onShutdown = () => {}, foodsFile = DEFAULT_FOODS_FILE,
  readmeFile = DEFAULT_README_FILE, readmeImagesDir = DEFAULT_README_IMAGES,
} = {}) {
  const imagesDir = path.resolve(readmeImagesDir);
  const store = createStore(root);
  store.ensureSeed();
  const backup = createBackup(root, { writeFile: writeAtomic, trashFile: store.trashFile });
  const COLL = `(${COLLECTION_NAMES.join('|')})`;

  // The USDA list loads on first use and is kept once it parses. A missing or
  // broken file is a 503. A broken file isn't read or logged again until it changes.
  let usda = null;
  let brokenMtime = null;
  function usdaIndex() {
    if (usda) return usda;
    let mtime = null;
    try {
      mtime = fs.statSync(foodsFile).mtimeMs;
    } catch {
      // missing: readFileSync below reports ENOENT
    }
    if (mtime !== null && mtime === brokenMtime) throw new HttpError(503, 'Food database not installed.');
    try {
      const foods = JSON.parse(fs.readFileSync(foodsFile, 'utf8'));
      if (!Array.isArray(foods)) throw new Error('not a list');
      usda = createFoodIndex(foods);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        brokenMtime = mtime;
        console.error(`Couldn't load the food database: ${e.message}`);
      }
      throw new HttpError(503, 'Food database not installed.');
    }
    return usda;
  }

  function foodSearch(q, limitParam) {
    // An empty or one-letter query never needs the food list, so it never loads it.
    const qw = queryWordsOf(q);
    if (!qw.length) return [];
    const index = usdaIndex();
    const asked = Number.parseInt(limitParam, 10);
    const limit = Math.min(30, Math.max(1, Number.isFinite(asked) ? asked : 15));
    const saved = store.listItems('foods')
      .filter((f) => f && !f.broken && typeof f.name === 'string' && matchesWords(qw, wordsOf(f.name)))
      .sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, limit)
      .map((f) => ({ ...f, source: 'saved' }));
    const rest = limit - saved.length;
    const fromUsda = rest > 0 ? index.search(q, rest).map((f) => ({ ...f, source: 'usda' })) : [];
    return [...saved, ...fromUsda];
  }
  const DAY = '/api/day/(\\d{4}-\\d{2}-\\d{2}|[^/]+)';
  const routes = [
    ['GET', `^/api/meta$`, () => ({ symptomTags: defaults.symptomTags, slots: SLOTS })],
    // The built-in starter recipes, for "Update starter recipes' nutrition". Read-only.
    ['GET', '^/api/starter-recipes$', () => structuredClone(STARTER_RECIPES)],
    ['GET', `^${DAY}$`, (m) => store.readDay(m[1])],
    ['PATCH', `^${DAY}$`, (m, b) => store.patchDay(m[1], b)],
    ['POST', `^${DAY}/(\\w+)$`, (m, b) => store.addEntry(m[1], m[2], b)],
    ['PUT', `^${DAY}/(\\w+)/([\\w-]+)$`, (m, b) => store.updateEntry(m[1], m[2], m[3], b)],
    ['DELETE', `^${DAY}/(\\w+)/([\\w-]+)$`, (m) => store.deleteEntry(m[1], m[2], m[3])],
    ['GET', '^/api/days$', (m, b, q) => store.listDays(q.get('from'), q.get('to'))],
    ['GET', '^/api/journal$', (m, b, q) => store.journal({ q: q.get('q'), tag: q.get('tag') })],
    ['GET', '^/api/doc/(\\w+)$', (m) => store.getDoc(m[1])],
    ['PUT', '^/api/doc/(\\w+)$', (m, b) => store.saveDoc(m[1], b)],
    ['GET', '^/api/backups$', () => backup.list()],
    ['POST', '^/api/backups$', () => {
      const r = backup.snapshot();
      if (r.error) throw new HttpError(503, `The backup didn't finish: ${r.error}`);
      return r;
    }],
    ['GET', '^/api/backups/([^/]+)$', (m) => backup.diff(decode(m[1]))],
    ['POST', '^/api/backups/([^/]+)/restore$', (m, b) => backup.restore(decode(m[1]), b || {})],
    ['GET', '^/api/mealplans$', () => store.listMealPlans()],
    ['GET', '^/api/mealplan/([^/]+)$', (m) => store.getMealPlan(decode(m[1]))],
    ['PUT', '^/api/mealplan/([^/]+)$', (m, b) => store.saveMealPlan(decode(m[1]), b)],
    // Read-only. Start scripts use it so a demo start never reuses a real Body Lab, or the other way round.
    ['GET', '^/api/info$', () => ({ demo: isDemoFolder(root) })],
    ['GET', '^/api/readme$', () => {
      try {
        return { text: fs.readFileSync(readmeFile, 'utf8') };
      } catch (e) {
        if (e.code === 'ENOENT') throw new HttpError(404, 'Read Me not found.');
        throw e;
      }
    }],
    ['GET', '^/api/food-search$', (m, b, q) => foodSearch(q.get('q'), q.get('limit'))],
    ['GET', '^/api/usda-food/(\\d+)$', (m) => {
      const food = usdaIndex().byId(m[1]);
      if (!food) throw new HttpError(404, 'No such food.');
      return food;
    }],
    ['GET', `^/api/${COLL}$`, (m) => store.listItems(m[1])],
    ['POST', `^/api/${COLL}$`, (m, b) => store.createItem(m[1], b)],
    ['PUT', `^/api/${COLL}/([^/]+)$`, (m, b) => store.updateItem(m[1], decode(m[2]), b)],
    ['DELETE', `^/api/${COLL}/([^/]+)$`, (m) => store.deleteItem(m[1], decode(m[2]))],
  ].map(([method, re, fn]) => [method, new RegExp(re), fn]);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (host !== '127.0.0.1' && host !== 'localhost') throw new HttpError(403, 'Wrong host.');
      if (req.method === 'GET' && url.pathname.startsWith('/readme-images/')) {
        return serveReadmeImage(imagesDir, url.pathname.slice('/readme-images/'.length), res);
      }
      if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        checkJsonContentType(req);
        send(res, 200, { ok: true });
        onShutdown();
        return undefined;
      }
      const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
      if (!route) throw new HttpError(404, 'Not found.');
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : null;
      const result = route[2](url.pathname.match(route[1]), body, url.searchParams);
      return send(res, 200, result ?? { ok: true });
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      const body = { error: status === 500 ? 'Something went wrong on the server.' : e.message };
      if (e.code === 'stale') body.stale = true;
      return send(res, status, body);
    }
  }
  handle.backup = backup;
  return handle;
}

if (require.main === module) {
  const app = createApp(ROOT, {
    onShutdown: () => {
      try {
        app.backup.snapshot();
        app.backup.close();
      } catch (e) {
        console.error(e);
      } finally {
        setTimeout(() => process.exit(0), 100);
      }
    },
  });
  const server = http.createServer(app);
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`Body Lab is already running on port ${PORT}.`);
      process.exit(0);
    }
    throw e;
  });
  server.listen(PORT, HOST, () => {
    try {
      ensureTodaySnapshot(app.backup, new Date());
    } catch (e) {
      console.error('Failed to take startup snapshot:', e);
    }
    console.log(`Body Lab: http://${HOST}:${PORT} (data: ${ROOT})`);
    // Check for daily backup every 30 minutes
    const interval = setInterval(() => {
      try {
        ensureTodaySnapshot(app.backup, new Date());
      } catch (e) {
        console.error('Failed to take periodic snapshot:', e);
      }
    }, 30 * 60 * 1000);
    interval.unref();
  });
}

module.exports = { createApp };
