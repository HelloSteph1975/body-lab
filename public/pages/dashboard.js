import { api } from '../api.js';
import { lineChart, seriesFrom } from '../charts.js';
import { nextShotInfo, siteLabel } from '../glp1.js';
import { effectiveWalkMinutes, isWorkoutDone, scheduledRoutine } from '../programs.js';
import { addDays, attempt, C, esc, isoDate, prettyDate, shortDate } from '../util.js';

let range = 90;

export async function render(main, { refresh }) {
  const today = isoDate();
  const from = addDays(today, -(range - 1));
  const from30 = addDays(today, -29);
  const [day, days, goals, phases, plan, glp1, programs] = await Promise.all([
    api.day(today), api.days(addDays(today, -364), today), api.doc('goals'), api.doc('phases'), api.doc('supplements'), api.doc('glp1').catch(() => ({ enabled: false })), api.items('programs').catch(() => []),
  ]);
  const shot = glp1.enabled ? nextShotInfo({ today, shotDay: glp1.shot_day, days }) : null;
  const t = day.totals || {};
  const d = day.data || {};
  const weights = seriesFrom(days, (x) => x.weight);
  const latest = weights[weights.length - 1];
  const weekAgo = [...weights].reverse().find((p) => p.x <= addDays(today, -7));
  const change = latest && weekAgo ? Math.round((latest.y - weekAgo.y) * 10) / 10 : null;
  const markers = (phases.phases || []).map((p) => ({ x: p.date, label: p.label }));
  const supps = d.supplements || {};
  const program = programs.find((p) => p.id === goals.program && !p.broken);
  const routine = program ? scheduledRoutine(program, goals.program_start, today) : null;
  const walkMin = effectiveWalkMinutes(goals, program, today).minutes;
  const workoutDone = !!routine && (d.activity || []).some((a) => a && a.type === 'workout' && (a.name === routine || a.program === program.name) && isWorkoutDone(a));

  const fasting = seriesFrom(days, (x, tot) => tot.fasting_glucose);
  const postMeal = seriesFrom(days, (x) => {
    const v = (x.readings || []).filter((r) => r.type === 'glucose' && /after/.test(r.context || '')).map((r) => r.value);
    return v.length ? Math.max(...v) : null;
  });
  const rating = (k) => seriesFrom(days, (x) => x.ratings && x.ratings[k]);

  main.innerHTML = `
    <div class="head"><h1><span class="blue">BODY LAB</span></h1><span class="grow"></span><span class="purple">${esc(prettyDate(today))}</span></div>
    <div class="grid kpis${shot ? ' five' : ''}">
      <div class="card kpi"><h2>Weight</h2><div class="v blue">${latest ? latest.y : '—'}</div>
        <div class="sub">${latest ? `${latest.x === today ? 'today' : shortDate(latest.x)}${change != null ? ` · ${change > 0 ? '+' : ''}${change} lb this week` : ''}` : 'Log it in Check-in'}</div></div>
      <div class="card kpi"><h2>Fasting blood sugar</h2><div class="v purple">${esc(t.fasting_glucose ?? '—')}</div><div class="sub">mg/dL today</div></div>
      <div class="card kpi"><h2>Net carbs</h2><div class="v ${goals.net_carb_max != null && t.net_carbs > goals.net_carb_max ? 'warn' : 'pink'}">${t.net_carbs ?? 0} g</div><div class="sub">limit ${esc(goals.net_carb_max ?? '—')} g</div></div>
      <div class="card kpi"><h2>Walks</h2><div class="v blue">${t.walks ?? 0}/${esc(goals.walks_per_day ?? '—')}</div><div class="sub">${t.walk_minutes ?? 0} minutes today${walkMin ? ` · ${esc(walkMin)} min each` : ''}</div></div>
      ${shot ? `<div class="card kpi"><h2>Next shot</h2><div class="v small ${shot.state === 'overdue' ? 'warn' : 'purple'}">${esc(shot.text)}</div>
        <div class="sub">${shot.last ? `Last: ${shortDate(shot.last.date)}${shot.last.shot.dose_mg != null ? ` · ${esc(shot.last.shot.dose_mg)} mg` : ''}${shot.last.shot.site ? ` · ${esc(siteLabel(shot.last.shot.site))}` : ''}` : ''}</div>
        <div class="sub">Next site: ${esc(siteLabel(shot.nextSite))}</div></div>` : ''}
    </div>
    <div class="grid two" style="margin-top:14px">
      <section class="card"><div class="head" style="margin:0"><h2>Weight trend and phases</h2><span class="grow"></span>
        <div class="btns">${[30, 90, 365].map((n) => `<button data-range="${n}" class="${n === range ? 'on' : ''}">${n === 365 ? '1 yr' : `${n} d`}</button>`).join('')}</div></div>
        ${lineChart({ from, to: today, series: [{ name: 'Weight', color: C.blue, points: weights }], markers, target: goals.ideal_weight ? { y: goals.ideal_weight, label: `Ideal ${goals.ideal_weight}` } : null, unit: ' lb', height: 260 })}
      </section>
      <section class="card"><h2>Today's checklist</h2>
        ${(plan.items || []).map((i) => `<label class="check"><input type="checkbox" data-supp="${esc(i.key)}"${supps[i.key] ? ' checked' : ''}> ${esc(i.name)}</label>`).join('')}
        <div class="slot">Walks</div>
        ${Array.from({ length: goals.walks_per_day || 3 }, (_, i) => `<label class="check"><input type="checkbox" disabled${i < (t.walks || 0) ? ' checked' : ''}> Walk ${i + 1}</label>`).join('')}
        ${routine ? `<label class="check"><input type="checkbox" disabled${workoutDone ? ' checked' : ''}> Workout: ${esc(routine)}</label>
        ` : ''}
        <p><a href="#/today">${routine && !workoutDone ? 'Start on Today →' : 'Log on Today →'}</a></p>
      </section>
    </div>
    <div class="grid halves" style="margin-top:14px">
      <section class="card"><h2>Blood sugar · 30 days</h2>
        ${lineChart({ from: from30, to: today, series: [{ name: 'Fasting', color: C.purple, points: fasting }, { name: 'After meals (highest)', color: C.pink, points: postMeal }], unit: ' mg/dL', height: 190 })}</section>
      <section class="card"><h2>How you feel · 30 days</h2>
        ${lineChart({ from: from30, to: today, series: [{ name: 'Hunger', color: C.pink, points: rating('hunger') }, { name: 'Energy', color: C.blue, points: rating('energy') }, { name: 'Mood', color: C.purple, points: rating('mood') }], height: 190 })}</section>
    </div>`;

  main.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { range = Number(b.dataset.range); refresh(); }));
  main.querySelectorAll('[data-supp]').forEach((box) => box.addEventListener('change', () => attempt(async () => {
    await api.patchDay(isoDate(), { supplements: { [box.dataset.supp]: box.checked } });
    refresh();
  })));
}
