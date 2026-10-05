import { api } from '../api.js';
import { lineChart, ring, seriesFrom } from '../charts.js';
import { effectiveWalkMinutes } from '../programs.js';
import { addDays, C, isoDate } from '../util.js';

const SHOT_TAB = ['glp1', 'GLP-1 dose'];

let tab = 'weight';
let range = 90;

const TABS = [
  ['weight', 'Weight'], ['glucose', 'Blood sugar'], ['bp', 'Blood pressure'],
  ['ketones', 'Ketones'], ['food', 'Carbs & protein'], ['feel', 'Symptoms'],
];

function graph(tabName, days, goals, markers, from, to) {
  const readings = (type, pick) => seriesFrom(days, (x) => {
    const v = (x.readings || []).filter((r) => r.type === type).map(pick).filter((n) => typeof n === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  });
  const base = { from, to, markers, height: 300 };
  if (tabName === 'glp1') {
    const dose = seriesFrom(days, (x) => {
      const v = (x.shots || []).map((s) => s.dose_mg).filter((n) => typeof n === 'number');
      return v.length ? Math.max(...v) : null;
    });
    return lineChart({ ...base, unit: ' mg', series: [{ name: 'Dose', color: C.mint, points: dose }] });
  }
  if (tabName === 'weight') {
    return lineChart({ ...base, series: [{ name: 'Weight', color: C.blue, points: seriesFrom(days, (x) => x.weight) }], target: goals.ideal_weight ? { y: goals.ideal_weight, label: `Ideal ${goals.ideal_weight}` } : null, unit: ' lb' });
  }
  if (tabName === 'glucose') {
    return lineChart({ ...base, unit: ' mg/dL', series: [
      { name: 'Fasting', color: C.purple, points: seriesFrom(days, (x, t) => t.fasting_glucose) },
      { name: 'After meals (avg)', color: C.pink, points: readings('glucose', (r) => (/after/.test(r.context || '') ? r.value : null)) },
    ] });
  }
  if (tabName === 'bp') {
    return lineChart({ ...base, series: [
      { name: 'Systolic', color: C.pink, points: readings('bp', (r) => r.systolic) },
      { name: 'Diastolic', color: C.blue, points: readings('bp', (r) => r.diastolic) },
    ] });
  }
  if (tabName === 'ketones') return lineChart({ ...base, unit: ' mmol/L', series: [{ name: 'Ketones', color: C.mint, points: readings('ketones', (r) => r.value) }] });
  if (tabName === 'food') {
    return lineChart({ ...base, unit: ' g', series: [
      { name: 'Net carbs', color: C.pink, points: seriesFrom(days, (x, t) => t.net_carbs) },
      { name: 'Protein', color: C.purple, points: seriesFrom(days, (x, t) => t.protein) },
      { name: 'Fiber', color: C.blue, points: seriesFrom(days, (x, t) => t.fiber) },
    ] });
  }
  const r = (k) => seriesFrom(days, (x) => x.ratings && x.ratings[k]);
  return lineChart({ ...base, series: [
    { name: 'Hunger', color: C.pink, points: r('hunger') }, { name: 'Cravings', color: C.warn, points: r('cravings') },
    { name: 'Energy', color: C.blue, points: r('energy') }, { name: 'Mood', color: C.purple, points: r('mood') },
    { name: 'Digestion', color: C.mint, points: r('digestion') },
  ] });
}

export async function render(main, { refresh }) {
  const today = isoDate();
  const [day, days, goals, phases, glp1, programs] = await Promise.all([api.day(today), api.days(addDays(today, -364), today), api.doc('goals'), api.doc('phases'), api.doc('glp1').catch(() => ({ enabled: false })), api.items('programs').catch(() => [])]);
  const program = programs.find((p) => p.id === goals.program && !p.broken);
  const walkMin = effectiveWalkMinutes(goals, program, today).minutes;
  const tabs = glp1.enabled ? [...TABS, SHOT_TAB] : TABS;
  const active = tabs.some(([k]) => k === tab) ? tab : 'weight';
  const rangeFrom = addDays(today, -(range - 1));
  const shotDays = glp1.enabled ? days.filter((x) => x.date >= rangeFrom && (x.data?.shots || []).length).length : 0;
  const t = day.totals || {};
  const weights = seriesFrom(days, (x) => x.weight);
  const current = weights.length ? weights[weights.length - 1].y : null;
  const start = weights.length ? Math.max(...weights.map((p) => p.y)) : null;
  const ideal = goals.ideal_weight;
  const toGo = current != null && ideal != null ? Math.max(0, Math.round((current - ideal) * 10) / 10) : null;
  const lost = start != null && current != null ? start - current : 0;
  const markers = (phases.phases || []).map((p) => ({ x: p.date, label: p.label }));

  main.innerHTML = `
    <div class="head"><h1>Goals</h1><span class="grow"></span><a href="#/settings">Change goals →</a></div>
    <div class="grid rings card">
      ${ring({ value: toGo == null ? 0 : lost, max: toGo == null ? 1 : lost + toGo, label: 'To ideal weight', display: toGo == null ? 'set goal' : `${toGo} lb`, color: C.mint })}
      ${ring({ value: t.walks || 0, max: goals.walks_per_day || 3, label: walkMin ? `Walks · ${walkMin} min` : 'Walks', display: `${t.walks || 0}/${goals.walks_per_day || 3}`, color: C.blue })}
      ${ring({ value: t.protein || 0, max: goals.protein_min || 0, label: 'Protein', display: `${t.protein || 0}g`, color: C.purple })}
      ${ring({ value: t.net_carbs || 0, max: goals.net_carb_max || 0, label: 'Net carbs used', display: `${t.net_carbs || 0}g`, color: goals.net_carb_max != null && t.net_carbs > goals.net_carb_max ? C.warn : C.pink })}
      ${ring({ value: t.fiber || 0, max: goals.fiber_min || 0, label: 'Fiber', display: `${t.fiber || 0}g`, color: C.blue })}
      ${ring({ value: t.supps_done || 0, max: t.supps_total || 1, label: 'Supplements', display: `${t.supps_done || 0}/${t.supps_total || 0}`, color: C.pink })}
      ${ring({ value: day.data?.water_oz || 0, max: goals.water_oz || 64, label: 'Water', display: `${day.data?.water_oz || 0}oz`, color: C.blue })}
    </div>
    <section class="card" style="margin-top:14px">
      <div class="head" style="margin:0 0 6px">
        <div class="tabs">${tabs.map(([k, label]) => `<button data-tab="${k}" class="${k === active ? 'on' : ''}">${label}</button>`).join('')}</div>
        <span class="grow"></span>
        <div class="btns">${[30, 90, 365].map((n) => `<button data-range="${n}" class="${n === range ? 'on' : ''}">${n === 365 ? '1 yr' : `${n} d`}</button>`).join('')}</div>
      </div>
      ${graph(active, days, goals, markers, rangeFrom, today)}
      ${active === 'glp1' ? `<p class="muted">${shotDays} shot ${shotDays === 1 ? 'day' : 'days'} in this range</p>` : ''}
    </section>`;

  main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; refresh(); }));
  main.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { range = Number(b.dataset.range); refresh(); }));
}
