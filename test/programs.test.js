const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'programs.js')).href);
// 2026-10-05 is a Monday.
const program = {
  name: 'Test Program',
  routines: [{ name: 'A', moves: [{ move: 'Squat', sets: 2, reps: 10 }, 'Plank'] }],
  phases: [
    { name: 'One', weeks: 2, days: { mon: 'A', wed: 'A', fri: 'A' }, walk_minutes: 10 },
    { name: 'Two', weeks: 1, days: { mon: 'A', fri: 'B' } },
  ],
};
const workout = (date, extra) => ({ date, data: { date, activity: [{ type: 'workout', ...extra }] } });

test('dates: day keys and Mondays', async () => {
  const p = await load();
  assert.equal(p.dayKey('2026-10-05'), 'mon');
  assert.equal(p.dayKey('2026-10-11'), 'sun');
  assert.equal(p.mondayOf('2026-10-11'), '2026-10-05');
  assert.equal(p.mondayOf('2026-10-05'), '2026-10-05');
  assert.equal(p.nextMonday('2026-10-05'), '2026-10-05');
  assert.equal(p.nextMonday('2026-10-06'), '2026-10-12');
  assert.equal(p.addDaysIso('2026-10-31', 1), '2026-11-01');
});

test('programPosition: before, during, phase boundary, after', async () => {
  const p = await load();
  assert.equal(p.totalWeeks(program), 3);
  assert.deepEqual(p.programPosition(program, '2026-10-05', '2026-10-03'), { state: 'not-started', daysUntilStart: 2, totalWeeks: 3 });
  let pos = p.programPosition(program, '2026-10-05', '2026-10-05');
  assert.equal(pos.state, 'active'); assert.equal(pos.week, 1); assert.equal(pos.phaseIndex, 0);
  pos = p.programPosition(program, '2026-10-05', '2026-10-18');
  assert.equal(pos.week, 2); assert.equal(pos.phaseIndex, 0);
  pos = p.programPosition(program, '2026-10-05', '2026-10-19');
  assert.equal(pos.week, 3); assert.equal(pos.phaseIndex, 1);
  assert.equal(p.programPosition(program, '2026-10-05', '2026-10-26').state, 'complete');
  assert.equal(p.programPosition(null, '2026-10-05', '2026-10-05').state, 'none');
  assert.equal(p.programPosition(program, null, '2026-10-05').state, 'none');
});

test('scheduledRoutine and weekPlan statuses', async () => {
  const p = await load();
  assert.equal(p.scheduledRoutine(program, '2026-10-05', '2026-10-07'), 'A');
  assert.equal(p.scheduledRoutine(program, '2026-10-05', '2026-10-06'), null);
  const days = [workout('2026-10-05', { program: 'Test Program', name: 'A' }), workout('2026-10-09', { name: 'A' })];
  const plan = p.weekPlan(program, '2026-10-05', '2026-10-08', days);
  assert.deepEqual(plan.map((d) => d.status), ['done', 'rest', 'missed', 'rest', 'done', 'rest', 'rest']);
  assert.equal(plan[0].date, '2026-10-05');
  assert.equal(p.weekPlan(program, '2026-10-05', '2026-10-07', [])[4].status, 'upcoming');
});

test('effectiveWalkMinutes uses the phase only while active', async () => {
  const p = await load();
  const goals = { walk_minutes: 15, program: 'Test Program', program_start: '2026-10-05' };
  assert.deepEqual(p.effectiveWalkMinutes(goals, program, '2026-10-06'), { minutes: 10, source: 'program', program: 'Test Program' });
  assert.deepEqual(p.effectiveWalkMinutes(goals, program, '2026-10-20'), { minutes: 15, source: 'settings' });
  assert.deepEqual(p.effectiveWalkMinutes(goals, program, '2026-10-01'), { minutes: 15, source: 'settings' });
  assert.deepEqual(p.effectiveWalkMinutes({ walk_minutes: 12 }, null, '2026-10-06'), { minutes: 12, source: 'settings' });
});

test('findRoutine looks in the program first, then the library; prefillSets expands sets', async () => {
  const p = await load();
  const library = { routines: [{ name: 'B', moves: ['Wall push-up'] }, { name: 'A', moves: ['Wrong'] }] };
  const a = p.findRoutine('A', program, library);
  assert.deepEqual(a.moves, [{ move: 'Squat', sets: 2, reps: 10 }, { move: 'Plank', sets: 1 }]);
  assert.equal(p.findRoutine('B', program, library).moves[0].move, 'Wall push-up');
  assert.equal(p.findRoutine('Z', program, library), null);
  assert.deepEqual(p.prefillSets(a), [
    { move: 'Squat', reps: 10, weight_lb: null, seconds: null, done: false },
    { move: 'Squat', reps: 10, weight_lb: null, seconds: null, done: false },
    { move: 'Plank', reps: null, weight_lb: null, seconds: null, done: false },
  ]);
});

test('moveProgress picks weight, then seconds, then reps, best per day', async () => {
  const p = await load();
  const days = [
    workout('2026-10-05', { sets: [{ move: 'Squat', reps: 10, weight_lb: 10, done: true }, { move: 'Squat', reps: 8, weight_lb: 15, done: true }, { move: 'Plank', seconds: 20, done: true }] }),
    workout('2026-10-07', { sets: [{ move: 'Squat', reps: 10, weight_lb: 20, done: false }, { move: 'Squat', reps: 10, weight_lb: 15, done: true }, { move: 'Push-up', reps: 6, done: true }] }),
    workout('2026-10-09', { sets: [{ move: 'Push-up', reps: 9, done: true }, { move: 'Plank', seconds: 30, done: true }] }),
  ];
  assert.deepEqual(p.loggedMoves(days), ['Plank', 'Push-up', 'Squat']);
  assert.deepEqual(p.moveProgress(days, 'Squat'), { metric: 'weight_lb', unit: ' lb', points: [{ x: '2026-10-05', y: 15 }, { x: '2026-10-07', y: 15 }] });
  assert.equal(p.moveProgress(days, 'Plank').metric, 'seconds');
  assert.deepEqual(p.moveProgress(days, 'Push-up').points.map((pt) => pt.y), [6, 9]);
});

test('hardening: malformed programs never throw', async () => {
  const p = await load();
  for (const bad of [{ name: 'x' }, { name: 'x', phases: [null] }, { name: 'x', phases: {} }, { id: 'x', broken: 'oops' }, { name: 'x', phases: [] }]) {
    assert.deepEqual(p.programPosition(bad, '2026-10-05', '2026-10-06'), { state: 'none' });
    assert.equal(p.totalWeeks(bad), 0);
    assert.equal(p.scheduledRoutine(bad, '2026-10-05', '2026-10-06'), null);
  }
  assert.equal(p.totalWeeks({ phases: [null, { weeks: 2 }] }), 2);
});

test('hardening: bad dates and weeks', async () => {
  const p = await load();
  assert.deepEqual(p.programPosition(program, 'garbage', '2026-10-06'), { state: 'none' });
  assert.deepEqual(p.programPosition(program, '2026-10-05', 'garbage'), { state: 'none' });
  const odd = { name: 'O', phases: [{ weeks: -1 }, { weeks: 3, days: { mon: 'A' } }] };
  assert.equal(p.totalWeeks(odd), 3);
  const pos = p.programPosition(odd, '2026-10-05', '2026-10-05');
  assert.equal(pos.state, 'active'); assert.equal(pos.phaseIndex, 1);
  assert.deepEqual(p.weekPlan(program, '2026-10-05', 'garbage', []), []);
});

test('hardening: odd moves and sets', async () => {
  const p = await load();
  const prog = { name: 'P', routines: [{ name: 'A', moves: [null, 5, 'Plank', { move: 'Squat', sets: 99 }] }] };
  const r = p.findRoutine('A', prog, null);
  assert.deepEqual(r.moves, [{ move: 'Plank', sets: 1 }, { move: 'Squat', sets: 20 }]);
  const days = [workout('2026-10-05', { sets: 'nope' }), workout('2026-10-06', { sets: [{ move: 'Squat', reps: 5 }] })];
  assert.deepEqual(p.loggedMoves(days), ['Squat']);
  assert.equal(p.moveProgress(days, 'Squat').points.length, 1);
});

test('splitSets/joinSets: extras survive a round trip', async () => {
  const { splitSets, joinSets } = await load();
  const sets = [
    { move: 'Squat', reps: 10, weight_lb: 20, done: true, notes: 'felt easy', rpe: 7, side: 'left' },
    { move: 'Squat', reps: 8, done: false, tempo: '3-1-1' },
    { move: 'Plank', seconds: 30, done: true },
  ];
  const groups = splitSets(sets);
  assert.equal(groups.length, 2);
  assert.deepEqual(joinSets(groups), sets);
});

test('splitSets groups only adjacent sets, so interleaved order is kept', async () => {
  const { splitSets, joinSets } = await load();
  const sets = [
    { move: 'A', reps: 5, done: true }, { move: 'B', reps: 6, done: true },
    { move: 'A', reps: 7, done: true }, { move: 'B', reps: 8, done: true },
  ];
  const groups = splitSets(sets);
  assert.equal(groups.length, 4);
  assert.deepEqual(joinSets(groups).map((s) => s.reps), [5, 6, 7, 8]);
});

test('sets the form cannot show are kept as is, in place', async () => {
  const { splitSets, joinSets } = await load();
  const odd = [
    { reps: 10 }, { move: 'Row', reps: '8-12', done: true }, 'junk', null, { move: 'Curl', weight_lb: 'BW', done: true },
    { move: 'Press', reps: 5, done: true },
  ];
  const groups = splitSets(odd);
  assert.equal(groups.filter((g) => 'kept' in g).length, 5);
  groups[groups.length - 1].rows[0].reps = 6; // an edit to the one editable set
  const back = joinSets(groups);
  assert.deepEqual(back.slice(0, 5), odd.slice(0, 5));
  assert.equal(back[5].reps, 6);
});

test('mergeProgram/mergeRoutine/mergePhase keep unknown keys and strip id and broken', async () => {
  const { mergeProgram, mergeRoutine, mergePhase } = await load();
  const original = { id: 'X', broken: undefined, name: 'X', author: 'AI', routines: [], phases: [], starter: true };
  const merged = mergeProgram(original, { name: 'Y', routines: [1], phases: [2], starter: false });
  assert.deepEqual(merged, { name: 'Y', author: 'AI', routines: [1], phases: [2], starter: false });
  assert.deepEqual(mergeRoutine({ name: 'A', tip: 'x', moves: [] }, 'B', [1]), { name: 'B', tip: 'x', moves: [1] });
  assert.deepEqual(mergePhase({ name: 'P', weeks: 1, days: {}, focus: 'legs', walk_minutes: 10 }, { name: 'Q', weeks: 2, days: { mon: 'A' }, walk_minutes: null }),
    { name: 'Q', weeks: 2, days: { mon: 'A' }, focus: 'legs' });
  assert.equal(mergePhase({ name: 'P' }, { name: 'P', weeks: 1, days: {}, walk_minutes: 15 }).walk_minutes, 15);
});

test('readNumber keeps a non-numeric original when the box is left blank', async () => {
  const { readNumber } = await load();
  assert.equal(readNumber('', '8-12'), '8-12');
  assert.equal(readNumber('', undefined), null);
  assert.equal(readNumber('', 5), null);
  assert.equal(readNumber('9', '8-12'), 9);
});

test('daysPerWeek counts only weekday keys with a value', async () => {
  const { daysPerWeek } = await load();
  assert.equal(daysPerWeek({ phases: [{ days: { mon: 'A', tue: '', wed: null, extra: 'x' } }, { days: { mon: 'A', fri: 'B' } }] }), 2);
  assert.equal(daysPerWeek({ phases: [] }), 0);
});

test('a text target like "8-12" prefills as a null with a hint, and the set is editable', async () => {
  const { prefillSets, findRoutine, splitSets, joinSets, isEditableSet } = await load();
  const r = findRoutine('R', null, { routines: [{ name: 'R', moves: [{ move: 'Row', sets: 2, reps: '8-12', weight_lb: 15 }] }] });
  const sets = prefillSets(r);
  assert.equal(sets.length, 2);
  assert.equal(sets[0].reps, null);
  assert.deepEqual(sets[0].hint, { reps: '8-12' });
  assert.equal(sets[0].weight_lb, 15);
  assert.ok(isEditableSet(sets[0]));
  const groups = splitSets(sets, true);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows[0].hint.reps, '8-12');
  assert.ok(groups[0].rows.every((row) => row.done));
  groups[0].rows[0].reps = 10;
  const out = joinSets(groups);
  assert.equal(out[0].reps, 10);
  assert.ok(!('hint' in out[0]) && !('hint' in out[1]));
});

test('isWorkoutDone: old style, some set done, or no set done', async () => {
  const { isWorkoutDone } = await load();
  assert.equal(isWorkoutDone({ type: 'workout' }), true);
  assert.equal(isWorkoutDone({ type: 'workout', sets: [] }), true);
  assert.equal(isWorkoutDone({ sets: [{ move: 'A', done: false }, { move: 'A', done: true }] }), true);
  assert.equal(isWorkoutDone({ sets: [{ move: 'A' }] }), true);
  assert.equal(isWorkoutDone({ sets: [{ move: 'A', done: false }, { move: 'B', done: false }] }), false);
  assert.equal(isWorkoutDone({ sets: [null, 'junk'] }), false);
});

test('weekPlan: a workout with no set done is not done', async () => {
  const p = await load();
  const undone = [workout('2026-10-05', { program: 'Test Program', name: 'A', sets: [{ move: 'Squat', done: false }] })];
  const plan = p.weekPlan(program, '2026-10-05', '2026-10-08', undone);
  assert.equal(plan[0].status, 'missed');
  assert.equal(plan[2].status, 'missed');
  const today = p.weekPlan(program, '2026-10-05', '2026-10-05', undone);
  assert.equal(today[0].status, 'upcoming');
});
