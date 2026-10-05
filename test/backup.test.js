const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, writeAtomic } = require('../lib/store');
const { createBackup, ensureTodaySnapshot } = require('../lib/backup');

// Roots are removed once every test (and every backup it opened) is done, so no file is locked.
const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function setup(t, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bodylab-backup-'));
  roots.push(root);
  const store = createStore(root);
  store.ensureSeed();
  const backup = createBackup(root, { writeFile: writeAtomic, trashFile: store.trashFile, ...opts });
  t.after(() => backup.close());
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  return { root, store, backup, write, read };
}
const day = (s) => new Date(`${s}T12:00:00`);

test('snapshot copies notes and skips App, Backups and dot folders', (t) => {
  const { backup, write } = setup(t);
  write('Days/2026-10-01.md', '---\nweight: 150\n---\n');
  write('App/docs/x.md', 'code docs');
  write('.trash/old.md', 'old');
  write('.obsidian/a.md', 'x');
  const r = backup.snapshot(day('2026-10-01'));
  assert.equal(r.taken_on, '2026-10-01');
  const paths = backup.diff('2026-10-01');
  assert.deepEqual(paths, []); // nothing changed since
  const list = backup.list();
  assert.equal(list.days.length, 1);
  assert.ok(list.days[0].count >= 6); // seeded docs + the day note
  assert.ok(list.last_snapshot_at);
  assert.equal(list.last_error, null);
  assert.ok(backup.hasSnapshotFor('2026-10-01'));
  assert.ok(!backup.hasSnapshotFor('2026-10-02'));
});

test('a second snapshot the same day replaces the first', (t) => {
  const { backup, write } = setup(t);
  write('Days/2026-10-01.md', '---\nweight: 150\n---\n');
  backup.snapshot(day('2026-10-01'));
  write('Days/2026-10-01.md', '---\nweight: 149\n---\n');
  backup.snapshot(day('2026-10-01'));
  assert.equal(backup.list().days.length, 1);
  assert.deepEqual(backup.diff('2026-10-01'), []);
});

test('keeps only the newest keepDays days', (t) => {
  const { backup } = setup(t, { keepDays: 3 });
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) backup.snapshot(day(d));
  assert.deepEqual(backup.list().days.map((x) => x.taken_on), ['2026-10-04', '2026-10-03', '2026-10-02']);
});

test('diff reports changed, missing and added notes', (t) => {
  const { backup, write, root } = setup(t);
  write('Days/2026-10-01.md', 'a');
  write('Days/2026-10-02.md', 'b');
  backup.snapshot(day('2026-10-02'));
  write('Days/2026-10-01.md', 'a changed');
  fs.unlinkSync(path.join(root, 'Days/2026-10-02.md'));
  write('Days/2026-10-03.md', 'new');
  assert.deepEqual(backup.diff('2026-10-02'), [
    { path: 'Days/2026-10-01.md', status: 'changed' },
    { path: 'Days/2026-10-02.md', status: 'missing' },
    { path: 'Days/2026-10-03.md', status: 'added' },
  ]);
});

test('restore trashes the current file first and leaves added notes alone', (t) => {
  const { backup, write, read, root } = setup(t);
  write('Days/2026-10-01.md', 'old text');
  write('Days/2026-10-02.md', 'gone later');
  backup.snapshot(day('2026-10-02'));
  write('Days/2026-10-01.md', 'new text');
  fs.unlinkSync(path.join(root, 'Days/2026-10-02.md'));
  write('Days/2026-10-03.md', 'added');
  const r = backup.restore('2026-10-02', { all: true });
  assert.deepEqual(r.restored.sort(), ['Days/2026-10-01.md', 'Days/2026-10-02.md']);
  assert.equal(read('Days/2026-10-01.md'), 'old text');
  assert.equal(read('Days/2026-10-02.md'), 'gone later');
  assert.equal(read('Days/2026-10-03.md'), 'added');
  const trashed = fs.readdirSync(path.join(root, '.trash'));
  assert.ok(trashed.some((f) => f.startsWith('2026-10-01 ')));
  assert.equal(fs.readFileSync(path.join(root, '.trash', trashed.find((f) => f.startsWith('2026-10-01 '))), 'utf8'), 'new text');
});

test('restore of one path, and refusal of bad input', (t) => {
  const { backup, write, read } = setup(t);
  write('Days/2026-10-01.md', 'v1');
  write('Goals.md', 'g1');
  backup.snapshot(day('2026-10-01'));
  write('Days/2026-10-01.md', 'v2');
  write('Goals.md', 'g2');
  assert.deepEqual(backup.restore('2026-10-01', { paths: ['Goals.md'] }).restored, ['Goals.md']);
  assert.equal(read('Goals.md'), 'g1');
  assert.equal(read('Days/2026-10-01.md'), 'v2');
  assert.throws(() => backup.restore('2026-10-01', { paths: ['../escape.md'] }), { status: 400 });
  assert.throws(() => backup.restore('2026-10-01', { paths: ['Days/2026-10-09.md'] }), { status: 400 });
  assert.throws(() => backup.diff('nope'), { status: 400 });
  assert.throws(() => backup.diff('2025-01-01'), { status: 404 });
});

test('corrupt DB is handled: hasSnapshotFor returns false, snapshot returns error', (t) => {
  const { root, store } = setup(t);
  const backup = createBackup(root, { writeFile: writeAtomic, trashFile: store.trashFile });
  t.after(() => backup.close());
  // Take a good snapshot first
  backup.snapshot(day('2026-10-01'));
  backup.close(); // Close before corrupting
  // Replace the database file with garbage
  fs.writeFileSync(path.join(root, 'Backups', 'body-lab.sqlite'), 'garbage');
  // Create a new backup instance pointing to the corrupted DB
  const backup2 = createBackup(root, { writeFile: writeAtomic, trashFile: store.trashFile });
  t.after(() => backup2.close());
  // hasSnapshotFor should return false and not throw
  const has = backup2.hasSnapshotFor('2026-10-01');
  assert.equal(has, false);
  assert.ok(backup2.list().last_error);
  // snapshot should return an error object
  const r = backup2.snapshot(day('2026-10-02'));
  assert.ok(r.error);
  // diff should throw 503, not 404
  assert.throws(() => backup2.diff('2026-10-01'), { status: 503, message: /backup file couldn't be read/ });
});

test('snapshot with injected readFile failure preserves prior snapshot', (t) => {
  const { root, store } = setup(t);
  const backup = createBackup(root, {
    writeFile: writeAtomic,
    trashFile: store.trashFile,
    readFile: fs.readFileSync,
  });
  t.after(() => backup.close());
  // Take a good snapshot
  backup.snapshot(day('2026-10-01'));
  assert.equal(backup.list().days.length, 1);
  // Inject a failure for the next snapshot
  const failingRead = (file, enc) => {
    if (String(file).endsWith('Goals.md')) throw new Error('read failed');
    return fs.readFileSync(file, enc);
  };
  const backupWithFailure = createBackup(root, {
    writeFile: writeAtomic,
    trashFile: store.trashFile,
    readFile: failingRead,
  });
  t.after(() => backupWithFailure.close());
  const r = backupWithFailure.snapshot(day('2026-10-01'));
  assert.ok(r.error);
  // First snapshot should still be there
  assert.equal(backupWithFailure.list().days.length, 1);
  assert.equal(backupWithFailure.list().days[0].taken_on, '2026-10-01');
});

test('snapshot copies notes and excludes App, Backups and dot folders', (t) => {
  const { backup, write } = setup(t);
  write('Days/2026-10-01.md', '---\nweight: 150\n---\n');
  write('App/docs/x.md', 'code docs');
  write('Backups/data.txt', 'backup file');
  write('.trash/old.md', 'old');
  write('.obsidian/a.md', 'x');
  backup.snapshot(day('2026-10-01'));
  const paths = backup.paths('2026-10-01');
  assert.ok(paths.includes('Days/2026-10-01.md'), 'Days note should be included');
  assert.ok(!paths.some((p) => p.startsWith('App/')), 'App folder should be excluded');
  assert.ok(!paths.some((p) => p.startsWith('Backups/')), 'Backups folder should be excluded');
  assert.ok(!paths.includes('.trash/old.md'), 'dot folders should be excluded');
  assert.ok(!paths.includes('.obsidian/a.md'), 'dot folders should be excluded');
});

test('restore refuses excluded paths and path traversal', (t) => {
  const { backup, write, root } = setup(t);
  write('Days/2026-10-01.md', 'v1');
  write('Goals.md', 'g1');
  backup.snapshot(day('2026-10-01'));
  write('Days/2026-10-01.md', 'v2');
  write('Goals.md', 'g2');
  // Normal restore works
  assert.deepEqual(backup.restore('2026-10-01', { paths: ['Goals.md'] }).restored, ['Goals.md']);
  // App/ should be refused (never backed up)
  assert.throws(() => backup.restore('2026-10-01', { paths: ['App/x.md'] }), { status: 400, message: /App\/x\.md has nothing to restore/ });
  // Backups/ should be refused
  assert.throws(() => backup.restore('2026-10-01', { paths: ['Backups/body-lab.sqlite'] }), { status: 400, message: /Backups.*has nothing to restore/ });
  // .trash/ should be refused
  assert.throws(() => backup.restore('2026-10-01', { paths: ['.trash/old.md'] }), { status: 400, message: /\.trash.*has nothing to restore/ });
  // ../ should be refused with message
  try {
    backup.restore('2026-10-01', { paths: ['../escape.md'] });
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.status, 400);
    assert.match(e.message, /\.\.\//);
  }
  // backslash path traversal should be refused with message
  try {
    backup.restore('2026-10-01', { paths: ['Days\\..\\x.md'] });
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.status, 400);
    assert.match(e.message, /has nothing to restore|Bad path/);
  }
  // absolute paths should be refused
  assert.throws(() => backup.restore('2026-10-01', { paths: [path.resolve(root, 'Days/x.md')] }), { status: 400 });
  assert.throws(() => backup.restore('2026-10-01', { paths: ['/etc/x.md'] }), { status: 400 });
});

test('trash avoids collisions with (2), (3) suffixes', (t) => {
  const { root, store, backup } = setup(t);
  // Create two files with same basename in different dirs
  fs.writeFileSync(path.join(root, 'Days', 'x.md'), 'day version');
  fs.writeFileSync(path.join(root, 'Labs', 'x.md'), 'lab version');
  backup.snapshot(day('2026-10-01'));
  // Modify both
  fs.writeFileSync(path.join(root, 'Days', 'x.md'), 'day modified');
  fs.writeFileSync(path.join(root, 'Labs', 'x.md'), 'lab modified');
  // Restore both to trigger trash of both files with same basename
  backup.restore('2026-10-01', { all: true });
  // Check trashed files exist (both should be in trash, not overwriting each other)
  const trashed = fs.readdirSync(path.join(root, '.trash'));
  const trashedXFiles = trashed.filter((f) => f.startsWith('x '));
  assert.equal(trashedXFiles.length, 2, 'both x.md files should be trashed separately');
  // Check content is preserved in both trashed files
  const contents = trashedXFiles.map((f) => fs.readFileSync(path.join(root, '.trash', f), 'utf8'));
  assert.ok(contents.includes('day modified'), 'day modified should be in trash');
  assert.ok(contents.includes('lab modified'), 'lab modified should be in trash');
});

test('ensureTodaySnapshot takes one if missing, skips if exists', (t) => {
  const { root, store } = setup(t);
  const backup = createBackup(root, { writeFile: writeAtomic, trashFile: store.trashFile });
  t.after(() => backup.close());
  const now = new Date('2026-10-01T12:00:00Z');
  const todayIso = '2026-10-01';

  // No snapshot yet
  assert.equal(backup.hasSnapshotFor(todayIso), false);
  // ensureTodaySnapshot takes one
  ensureTodaySnapshot(backup, now);
  assert.equal(backup.hasSnapshotFor(todayIso), true);

  // Second call doesn't take another
  const listBefore = backup.list().days.length;
  ensureTodaySnapshot(backup, now);
  const listAfter = backup.list().days.length;
  assert.equal(listBefore, listAfter, 'should not create duplicate snapshot');
});

test('ensureTodaySnapshot calls snapshot only when today has none', (t) => {
  const { backup } = setup(t);
  let calls = 0;
  const spy = {
    hasSnapshotFor: (d) => backup.hasSnapshotFor(d),
    snapshot: (n) => { calls++; return backup.snapshot(n); },
  };
  const now = day('2026-10-02');
  ensureTodaySnapshot(spy, now);
  assert.equal(calls, 1);
  ensureTodaySnapshot(spy, now);
  assert.equal(calls, 1, 'second call must skip');
  ensureTodaySnapshot(spy, day('2026-10-03'));
  assert.equal(calls, 2, 'a new day takes a new one');
});

test('restore refuses to write through a junction that points outside the root', (t) => {
  const { root, backup, write } = setup(t);
  write('Days/2026-10-01.md', 'original');
  backup.snapshot(day('2026-10-01'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bodylab-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.rmSync(path.join(root, 'Days'), { recursive: true, force: true });
  try {
    fs.symlinkSync(outside, path.join(root, 'Days'), 'junction');
  } catch (e) {
    return t.skip(`cannot create a junction here: ${e.code}`);
  }
  assert.throws(() => backup.restore('2026-10-01', { all: true }), { status: 400, message: /linked folder/ });
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.rmdirSync(path.join(root, 'Days')); // removes the junction, not the target
});

test('a failed snapshot is remembered across instances until a good one clears it', (t) => {
  const { root, store, backup } = setup(t);
  backup.snapshot(day('2026-10-01'));
  backup.close();
  const failingRead = (file, enc) => {
    if (String(file).endsWith('Goals.md')) throw new Error('read failed');
    return fs.readFileSync(file, enc);
  };
  const mk = (opts = {}) => {
    const b = createBackup(root, { writeFile: writeAtomic, trashFile: store.trashFile, ...opts });
    t.after(() => b.close());
    return b;
  };
  const bad = mk({ readFile: failingRead });
  assert.ok(bad.snapshot(day('2026-10-02')).error);
  bad.close();
  const second = mk();
  assert.match(second.list().last_error, /read failed/);
  assert.ok(second.snapshot(day('2026-10-02')).count > 0);
  assert.equal(second.list().last_error, null);
  second.close();
  assert.equal(mk().list().last_error, null);
  assert.equal(fs.existsSync(path.join(root, 'Backups', 'last-error.txt')), false);
});

test('when the DB is unusable, the failure goes to last-error.txt and survives a restart', (t) => {
  const { root, store, backup } = setup(t);
  backup.snapshot(day('2026-10-01'));
  backup.close();
  fs.writeFileSync(path.join(root, 'Backups', 'body-lab.sqlite'), 'garbage');
  const mk = () => {
    const b = createBackup(root, { writeFile: writeAtomic, trashFile: store.trashFile });
    t.after(() => b.close());
    return b;
  };
  assert.ok(mk().snapshot(day('2026-10-02')).error);
  const text = fs.readFileSync(path.join(root, 'Backups', 'last-error.txt'), 'utf8');
  assert.match(text, /^\d{4}-\d{2}-\d{2}T\S+ .+\n$/);
  const msg = text.trim().replace(/^\S+ /, '');
  assert.equal(mk().list().last_error, msg);
});

test('a leftover last-error.txt that could not be removed stays hidden; a new failure shows', (t) => {
  const { root, store } = setup(t);
  const file = path.join(root, 'Backups', 'last-error.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '2026-10-01T00:00:00.000Z old failure\n');
  const locked = () => { throw new Error('EBUSY: locked'); };
  const failingRead = (f, enc) => {
    if (String(f).endsWith('Goals.md')) throw new Error('new failure');
    return fs.readFileSync(f, enc);
  };
  const mk = (opts = {}) => {
    const b = createBackup(root, { writeFile: writeAtomic, trashFile: store.trashFile, ...opts });
    t.after(() => b.close());
    return b;
  };
  const first = mk({ rmFile: locked });
  assert.equal(first.list().last_error, 'old failure');
  assert.ok(first.snapshot(day('2026-10-02')).count > 0);
  assert.ok(fs.existsSync(file), 'removal was blocked');
  assert.equal(first.list().last_error, null);
  first.close();
  // restart: still hidden, and list() never deletes the file
  const second = mk({ rmFile: locked });
  assert.equal(second.list().last_error, null);
  assert.ok(fs.existsSync(file));
  second.close();
  // a new failure with the clock set earlier than the old one still shows
  const bad = mk({ rmFile: locked, readFile: failingRead });
  assert.ok(bad.snapshot(day('2026-09-01')).error);
  bad.close();
  assert.equal(mk({ rmFile: locked }).list().last_error, 'new failure');
});
