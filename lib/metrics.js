'use strict';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round1 = (v) => Math.round(v * 10) / 10;

function mealTotals(meals = []) {
  const t = { net_carbs: 0, protein: 0, fiber: 0, fat: 0, kcal: 0 };
  for (const meal of meals || []) {
    for (const it of (meal && meal.items) || []) {
      if (!it) continue;
      t.net_carbs += num(it.net_carbs);
      t.protein += num(it.protein);
      t.fiber += num(it.fiber);
      t.fat += num(it.fat);
      t.kcal += num(it.kcal);
    }
  }
  return { net_carbs: round1(t.net_carbs), protein: round1(t.protein), fiber: round1(t.fiber), fat: round1(t.fat), kcal: Math.round(t.kcal) };
}

function dayTotals(data, planItems = []) {
  const d = data || {};
  const walks = (d.activity || []).filter((a) => a.type === 'walk');
  const fasting = (d.readings || []).find((r) => r.type === 'glucose' && r.context === 'fasting');
  const supps = d.supplements || {};
  return {
    ...mealTotals(d.meals),
    weight: typeof d.weight === 'number' ? d.weight : null,
    walks: walks.length,
    walk_minutes: walks.reduce((s, a) => s + num(a.minutes), 0),
    fasting_glucose: fasting ? fasting.value : null,
    supps_done: planItems.filter((p) => supps[p.key]).length,
    supps_total: planItems.length,
  };
}

function poundsToGoal(weight, ideal) {
  if (typeof weight !== 'number' || typeof ideal !== 'number') return null;
  return Math.max(0, round1(weight - ideal));
}

module.exports = { mealTotals, dayTotals, poundsToGoal };
