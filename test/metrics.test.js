const test = require('node:test');
const assert = require('node:assert/strict');
const { mealTotals, dayTotals, poundsToGoal } = require('../lib/metrics');
const { renderDay } = require('../lib/render');

const day = {
  weight: 148,
  meals: [
    { id: 'm1', time: '07:30', kind: 'breakfast', items: [{ food: 'Eggs', net_carbs: 1, protein: 12, fiber: 0 }] },
    { id: 'm2', time: '12:30', kind: 'lunch', items: [{ food: 'Salad', net_carbs: 6.5, protein: 30, fiber: 7 }, { food: 'EVOO', net_carbs: 0 }] },
  ],
  readings: [{ id: 'r1', time: '06:45', type: 'glucose', context: 'fasting', value: 98 }],
  activity: [{ id: 'a1', time: '07:50', type: 'walk', minutes: 10 }, { id: 'a2', type: 'workout', name: 'Bodyweight A' }],
  supplements: { berberine: true, creatine: false },
  notes: [{ id: 'n1', time: '15:10', mood: 3, tags: ['craving'], text: 'Wanted chips' }],
};
const plan = [{ key: 'berberine', name: 'Berberine' }, { key: 'creatine', name: 'Creatine' }];

test('mealTotals adds up items and ignores missing numbers', () => {
  assert.deepEqual(mealTotals(day.meals), { net_carbs: 7.5, protein: 42, fiber: 7, fat: 0, kcal: 0 });
  assert.deepEqual(mealTotals(undefined), { net_carbs: 0, protein: 0, fiber: 0, fat: 0, kcal: 0 });
});

test('dayTotals counts walks, fasting glucose and supplements', () => {
  const t = dayTotals(day, plan);
  assert.equal(t.walks, 1);
  assert.equal(t.walk_minutes, 10);
  assert.equal(t.fasting_glucose, 98);
  assert.equal(t.supps_done, 1);
  assert.equal(t.supps_total, 2);
  assert.equal(t.weight, 148);
});

test('poundsToGoal never goes below zero', () => {
  assert.equal(poundsToGoal(148, 130), 18);
  assert.equal(poundsToGoal(128, 130), 0);
  assert.equal(poundsToGoal(null, 130), null);
});

test('renderDay writes readable sections', () => {
  const md = renderDay('2026-09-30', day, plan);
  assert.match(md, /## Meals/);
  assert.match(md, /Blood sugar 98 mg\/dL \(fasting\)/);
  assert.match(md, /- \[x\] Berberine/);
  assert.match(md, /#craving Wanted chips/);
});

test('renderDay shows workout sets', () => {
  const md = renderDay('2026-10-05', { activity: [{ id: 'a1', time: '07:30', type: 'workout', name: 'Bodyweight A', sets: [
    { move: 'Chair squat', reps: 10, done: true }, { move: 'Chair squat', reps: 8, done: true }, { move: 'Plank', seconds: 20, done: true }, { move: 'Glute bridge', reps: 12, weight_lb: 0, done: false },
  ] }] }, []);
  assert.match(md, /Bodyweight A/);
  assert.match(md, /Chair squat 10, 8/);
  assert.match(md, /Plank 20 s/);
  assert.doesNotMatch(md, /Glute bridge/);
});

test('mealTotals sums fat and kcal and treats old entries as 0', () => {
  const t = mealTotals([{ items: [{ food: 'A', fat: 10.25, kcal: 120 }, { food: 'B', fat: 'x', kcal: null }, { food: 'C', net_carbs: 1 }] }, null]);
  assert.equal(t.fat, 10.3);
  assert.equal(t.kcal, 120);
  assert.equal(dayTotals({ meals: [{ items: [{ fat: 5, kcal: 50 }] }] }, []).kcal, 50);
});

test('renderDay summary includes fat and kcal', () => {
  const md = renderDay('2026-10-03', { meals: [{ id: 'm', time: '08:00', kind: 'breakfast', items: [{ food: 'Eggs', net_carbs: 1, protein: 12, fiber: 0, fat: 9, kcal: 140 }] }] }, []);
  assert.match(md, /fat 9 g · 140 kcal/);
});

test('renderDay summary treats old entries without fat or kcal as zero', () => {
  const md = renderDay('2026-10-03', { meals: [{ id: 'm', time: '08:00', kind: 'breakfast', items: [{ food: 'Old', net_carbs: 2 }] }] }, []);
  assert.match(md, /fat 0 g · 0 kcal/);
  assert.equal(mealTotals([{ items: [{ kcal: 100.4 }, { kcal: 100.4 }] }]).kcal, 201);
});

test('recipe note shows per-serving fat and kcal only when set', () => {
  const { renderItem } = require('../lib/render');
  const withBoth = renderItem('recipes', { name: 'R', servings: 2, per_serving: { net_carbs: 1, protein: 2, fiber: 3, fat: 4, kcal: 90 } });
  assert.match(withBoth, /fiber 3 g · fat 4 g · 90 kcal/);
  const without = renderItem('recipes', { name: 'R', servings: 2, per_serving: { net_carbs: 1, protein: 2, fiber: 3 } });
  assert.doesNotMatch(without, /kcal/);
});
