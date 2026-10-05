'use strict';
// Dated copies of every note in one SQLite file. The notes folder stays the
// source of truth; this is for rolling a note, or the folder, back to a day.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { HttpError } = require('./errors');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SKIP_TOP = new Set(['App', 'Backups']);
const WEEK_MS = 7 * 86400000;
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shaOf = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

// Relative paths (with /) of every note that belongs in a backup.
function listNotes(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!rel && SKIP_TOP.has(entry.name)) continue;
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(childRel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

function createBackup(root, { writeFile, trashFile, readFile = fs.readFileSync, rmFile = fs.rmSync, keepDays = 30 }) {
  let db = null;
  let lastError = null;

  function open() {
    if (db) return db;
    const dir = path.join(root, 'Backups');
    fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, 'body-lab.sqlite'));
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
          taken_on TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL,
          sha TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY (taken_on, path));
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');`);
    } catch (e) {
      try {
        db.close();
      } catch {
        // ignore
      }
      db = null;
      throw e;
    }
    return db;
  }

  const getMeta = (key) => open().prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  const setMeta = (key, value) => open()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);

  const errorFile = path.join(root, 'Backups', 'last-error.txt');

  // Remember a failure past a restart: in the DB if it will take it, else in a text file.
  function recordError(message) {
    lastError = message;
    try {
      setMeta('last_error', message);
      setMeta('last_error_at', new Date().toISOString());
    } catch {
      try {
        fs.mkdirSync(path.dirname(errorFile), { recursive: true });
        fs.appendFileSync(errorFile, `${new Date().toISOString()} ${String(message).replace(/\r?\n/g, ' ')}\n`);
      } catch (fileErr) {
        console.error('Could not record the backup failure:', fileErr);
      }
    }
  }

  const lastLineOfFile = () => {
    const lines = fs.readFileSync(errorFile, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.length ? lines[lines.length - 1] : null;
  };

  function clearError() {
    lastError = null;
    let staleLine = null;
    try {
      staleLine = lastLineOfFile();
    } catch {
      // no file
    }
    let removed = true;
    try {
      rmFile(errorFile, { force: true });
    } catch (e) {
      removed = false;
      console.error('Could not remove last-error.txt:', e);
    }
    try {
      const d = open();
      d.prepare("DELETE FROM meta WHERE key IN ('last_error', 'last_error_at')").run();
      if (removed || !staleLine) d.prepare("DELETE FROM meta WHERE key = 'stale_error_line'").run();
      else setMeta('stale_error_line', staleLine);
    } catch (e) {
      console.error('Could not clear the saved backup failure:', e);
    }
  }

  function persistedError() {
    let stale = null;
    try {
      const v = getMeta('last_error');
      if (v) return v;
      stale = getMeta('stale_error_line');
    } catch {
      // DB unreadable: fall through to the file
    }
    try {
      const last = lastLineOfFile();
      if (last && last !== stale) return last.replace(/^\S+ /, '');
    } catch {
      // no file
    }
    return null;
  }

  function checkDay(day) {
    if (!DATE_RE.test(String(day))) throw new HttpError(400, `Not a date: ${day}`);
  }

  function snapshot(now = new Date()) {
    const takenOn = localDate(now);
    try {
      const d = open();
      const files = listNotes(root);
      const rows = files.map((rel) => {
        const content = readFile(path.join(root, rel), 'utf8');
        return [rel, content, shaOf(content), Buffer.byteLength(content)];
      });
      d.exec('BEGIN');
      try {
        d.prepare('DELETE FROM snapshots WHERE taken_on = ?').run(takenOn);
        const insert = d.prepare('INSERT INTO snapshots (taken_on, path, content, sha, size) VALUES (?, ?, ?, ?, ?)');
        for (const [rel, content, sha, size] of rows) insert.run(takenOn, rel, content, sha, size);
        const days = d.prepare('SELECT DISTINCT taken_on FROM snapshots ORDER BY taken_on DESC').all().map((r) => r.taken_on);
        const drop = d.prepare('DELETE FROM snapshots WHERE taken_on = ?');
        for (const old of days.slice(keepDays)) drop.run(old);
        d.exec('COMMIT');
      } catch (e) {
        try {
          d.exec('ROLLBACK');
        } catch (rollbackErr) {
          console.error('ROLLBACK failed:', rollbackErr);
        }
        throw e;
      }
      setMeta('last_snapshot_at', now.toISOString());
      const lastVacuum = Date.parse(getMeta('last_vacuum_at') || '') || 0;
      if (now.getTime() - lastVacuum > WEEK_MS) {
        try {
          d.exec('VACUUM');
          setMeta('last_vacuum_at', now.toISOString());
        } catch (vacuumErr) {
          console.error('VACUUM failed:', vacuumErr);
        }
      }
      clearError();
      return { taken_on: takenOn, count: rows.length };
    } catch (e) {
      recordError(e.message);
      console.error('Body Lab backup failed:', e);
      return { error: e.message };
    }
  }

  function hasSnapshotFor(day) {
    try {
      return Boolean(open().prepare('SELECT 1 FROM snapshots WHERE taken_on = ? LIMIT 1').get(day));
    } catch (e) {
      lastError = e.message;
      return false;
    }
  }

  function list() {
    try {
      const days = open()
        .prepare('SELECT taken_on, COUNT(*) AS count FROM snapshots GROUP BY taken_on ORDER BY taken_on DESC')
        .all()
        .map((r) => ({ taken_on: r.taken_on, count: Number(r.count) }));
      return { last_snapshot_at: getMeta('last_snapshot_at'), last_error: lastError ?? persistedError(), days };
    } catch (e) {
      const saved = lastError ?? persistedError();
      lastError = e.message;
      return { last_snapshot_at: null, last_error: saved ?? e.message, days: [] };
    }
  }

  function snapshotRows(day) {
    checkDay(day);
    try {
      const rows = open().prepare('SELECT path, sha, content FROM snapshots WHERE taken_on = ?').all(day);
      if (!rows.length) throw new HttpError(404, `No backup from ${day}.`);
      return rows;
    } catch (e) {
      if (e.status) throw e; // HttpError
      lastError = e.message;
      throw new HttpError(503, `The backup file couldn't be read: ${e.message}`);
    }
  }

  function paths(day) {
    checkDay(day);
    return snapshotRows(day).map((r) => r.path).sort();
  }

  function diff(day) {
    const saved = new Map(snapshotRows(day).map((r) => [r.path, r.sha]));
    const current = new Map(listNotes(root).map((rel) => [rel, shaOf(readFile(path.join(root, rel), 'utf8'))]));
    const out = [];
    for (const [rel, sha] of saved) {
      if (!current.has(rel)) out.push({ path: rel, status: 'missing' });
      else if (current.get(rel) !== sha) out.push({ path: rel, status: 'changed' });
    }
    for (const rel of current.keys()) if (!saved.has(rel)) out.push({ path: rel, status: 'added' });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  function checkSymlinkEscape(file, rel) {
    const refuse = () => new HttpError(400, `Won't restore through a linked folder: ${rel}`);
    const rootPath = path.resolve(root);
    const parts = path.relative(rootPath, file).split(path.sep);
    // Every existing folder between root and the file must be a real folder.
    let current = rootPath;
    let nearest = rootPath;
    for (let i = 0; i < parts.length - 1; i++) {
      current = path.join(current, parts[i]);
      let st;
      try {
        st = fs.lstatSync(current);
      } catch (e) {
        if (e.code === 'ENOENT') break;
        throw refuse();
      }
      if (st.isSymbolicLink() || !st.isDirectory()) throw refuse();
      nearest = current;
    }
    // The nearest existing ancestor must really live inside the real root.
    let real;
    let realRoot;
    try {
      real = fs.realpathSync(nearest);
      realRoot = fs.realpathSync(rootPath);
    } catch {
      throw refuse();
    }
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw refuse();
  }

  function restore(day, { paths, all } = {}) {
    const rows = new Map(snapshotRows(day).map((r) => [r.path, r.content]));
    const restorable = diff(day).filter((x) => x.status !== 'added').map((x) => x.path);
    let chosen;
    if (all === true) chosen = restorable;
    else {
      if (!Array.isArray(paths) || !paths.length) throw new HttpError(400, 'Pick at least one note to restore.');
      for (const p of paths) {
        if (!restorable.includes(p)) throw new HttpError(400, `${p} has nothing to restore from ${day}.`);
      }
      chosen = [...new Set(paths)];
    }
    const restored = [];
    for (const rel of chosen) {
      const file = path.resolve(root, rel);
      if (!file.startsWith(path.resolve(root) + path.sep)) throw new HttpError(400, `Bad path: ${rel}`);
      checkSymlinkEscape(file, rel);
      if (fs.existsSync(file)) trashFile(file, { copy: true });
      writeFile(file, rows.get(rel));
      restored.push(rel);
    }
    return { restored };
  }

  function close() {
    if (db) {
      db.close();
      db = null;
    }
  }

  return { snapshot, hasSnapshotFor, list, diff, paths, restore, close };
}

function ensureTodaySnapshot(backup, now = new Date()) {
  const todayIso = localDate(now);
  if (!backup.hasSnapshotFor(todayIso)) {
    backup.snapshot(now);
  }
}

module.exports = { createBackup, listNotes, localDate, ensureTodaySnapshot };
