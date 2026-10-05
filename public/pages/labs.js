import { api } from '../api.js';
import { lineChart } from '../charts.js';
import { openForm } from '../forms.js';
import { attempt, C, esc, isoDate, prettyDate } from '../util.js';

const LAB_FIELDS = [
  { name: 'date', label: 'Date of the blood draw', type: 'date', required: true },
  { name: 'a1c', label: 'A1C (%)', type: 'number', step: '0.1' },
  { name: 'fasting_glucose', label: 'Fasting glucose (mg/dL)', type: 'number' },
  { name: 'total_chol', label: 'Total cholesterol', type: 'number' },
  { name: 'ldl', label: 'LDL', type: 'number' },
  { name: 'hdl', label: 'HDL', type: 'number' },
  { name: 'triglycerides', label: 'Triglycerides', type: 'number' },
  { name: 'other', label: 'Other results', type: 'textarea', placeholder: 'TSH 2.1, vitamin D 34…' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

function labForm(lab, done) {
  openForm({
    title: lab ? 'Edit lab visit' : 'Add lab visit',
    fields: LAB_FIELDS,
    values: lab || {},
    confirmDelete: 'Move this to .trash?',
    onDelete: lab && (async () => { await api.deleteItem('labs', lab.id); done(); }),
    onSave: (v) => attempt(async () => {
      if (lab) await api.updateItem('labs', lab.id, v);
      else await api.createItem('labs', v);
      done();
    }, 'Labs saved'),
  });
}

function phaseForm(phases, index, done) {
  const p = index == null ? null : phases.phases[index];
  openForm({
    title: p ? 'Edit phase' : 'Add phase',
    fields: [{ name: 'date', label: 'Date', type: 'date', required: true, default: isoDate() }, { name: 'label', label: 'What changed', required: true, placeholder: 'Walks go to 15 minutes' }],
    values: p || {},
    onDelete: p && (async () => { const next = { ...phases, phases: [...phases.phases] }; next.phases.splice(index, 1); await api.saveDoc('phases', next); done(); }),
    onSave: (v) => attempt(async () => {
      const next = { ...phases, phases: [...phases.phases] };
      if (p) next.phases[index] = v;
      else next.phases.push(v);
      next.phases.sort((a, b) => a.date.localeCompare(b.date));
      await api.saveDoc('phases', next);
      done();
    }, 'Phases saved'),
  });
}

export async function render(main, { refresh }) {
  const [labs, phases, goals] = await Promise.all([api.items('labs'), api.doc('phases'), api.doc('goals')]);
  const a1c = labs.filter((l) => typeof l.a1c === 'number').map((l) => ({ x: l.date || l.id, y: l.a1c }));
  const from = a1c.length ? a1c[0].x : isoDate();
  const sortedLabs = [...labs].sort((a, b) => b.id.localeCompare(a.id));

  main.innerHTML = `
    <div class="head"><h1>Labs &amp; Phases</h1></div>
    <div class="grid two">
      <section class="card"><h2>A1C over the years</h2>
        ${lineChart({ from, to: isoDate(), series: [{ name: 'A1C', color: C.purple, points: a1c }], target: { y: 5.7, label: 'Prediabetes range starts at 5.7' }, unit: '%', height: 240 })}</section>
      <section class="card"><h2>Next checkup</h2>
        <div class="kpi"><div class="v blue">${goals.next_checkup ? esc(prettyDate(goals.next_checkup)) : 'Not set'}</div></div>
        <label class="muted">Change date <input type="date" id="checkup" value="${esc(goals.next_checkup || '')}"></label>
        <p class="muted">Bring the Labs table so you and your doctor can compare with January.</p></section>
    </div>
    <section class="card" style="margin-top:14px"><div class="head" style="margin:0"><h2>Lab visits</h2><span class="grow"></span><button class="primary" id="new-lab">+ Lab visit</button></div>
      ${sortedLabs.length ? `<table><thead><tr><th>Date</th><th>A1C</th><th>Fasting</th><th>LDL</th><th>HDL</th><th>Trig.</th></tr></thead><tbody>
        ${sortedLabs.map((l, i) => `<tr data-lab="${i}"><td>${esc(l.id)}${l.broken ? ' <span class="tag">needs repair</span>' : ''}</td><td>${esc(l.a1c ?? '')}</td><td>${esc(l.fasting_glucose ?? '')}</td><td>${esc(l.ldl ?? '')}</td><td>${esc(l.hdl ?? '')}</td><td>${esc(l.triglycerides ?? '')}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">Add your last three years of A1C results to start the chart.</p>'}</section>
    <section class="card" style="margin-top:14px"><div class="head" style="margin:0"><h2>Experiment phases</h2><span class="grow"></span><button class="primary" id="new-phase">+ Phase</button></div>
      <ul class="list">${phases.phases.map((p, i) => ({ p, i })).sort((a, b) => b.p.date.localeCompare(a.p.date)).map(({ p, i }) => `<li data-phase="${i}"><span class="time">${esc(p.date)}</span><span class="what">${esc(p.label)}</span></li>`).join('')}</ul></section>`;

  main.querySelector('#new-lab').addEventListener('click', () => labForm(null, refresh));
  main.querySelectorAll('[data-lab]').forEach((tr) => tr.addEventListener('click', () => {
    const lab = sortedLabs[Number(tr.dataset.lab)];
    if (!lab.broken) labForm(lab, refresh);
  }));
  main.querySelector('#new-phase').addEventListener('click', () => phaseForm(phases, null, refresh));
  main.querySelectorAll('[data-phase]').forEach((li) => li.addEventListener('click', () => phaseForm(phases, Number(li.dataset.phase), refresh)));
  main.querySelector('#checkup').addEventListener('change', (e) => attempt(async () => {
    await api.saveDoc('goals', { ...goals, next_checkup: e.target.value || null });
    refresh();
  }, 'Checkup date saved'));
}
