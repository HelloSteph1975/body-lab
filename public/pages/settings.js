import { api } from '../api.js';
import { WEEKDAYS } from '../glp1.js';
import { effectiveWalkMinutes, programPosition } from '../programs.js';
import { attempt, esc, isoDate, prettyDate, shortDate, toast } from '../util.js';

const DISCLAIMER = 'General nutrition information, not medical advice. Check with your doctor, especially if you take medication.';
const STATUS = { changed: 'Changed since', missing: 'Missing from folder', added: 'Added since (kept)' };

function backupCard(b) {
  const last = b.last_snapshot_at ? new Date(b.last_snapshot_at).toLocaleString() : 'never';
  return `<section class="card" id="backups" style="max-width:560px;margin:14px 0">
    <h2>Backups</h2>
    <p>Last backup: <b>${esc(last)}</b>${b.last_error ? ` <span class="warn">· Last backup failed: ${esc(b.last_error)}</span>` : ''}${b.error ? ` <span class="warn">· ${esc(b.error)}</span>` : ''}</p>
    <p class="muted" style="margin-top:0">Body Lab keeps a copy of every note each day for 30 days, in Backups/body-lab.sqlite.</p>
    <div class="btns"><button type="button" id="backup-now">Back up now</button></div>
    <label class="muted" style="display:grid;gap:4px;margin-top:10px">Look at a backup
      <select id="backup-day"><option value="">Pick a date</option>${(b.days || []).map((d) => `<option value="${esc(d.taken_on)}">${esc(prettyDate(d.taken_on))} · ${d.count} notes</option>`).join('')}</select></label>
    <div id="backup-diff"></div>
  </section>`;
}

function diffHtml(day, rows) {
  if (!rows.length) return '<p class="muted">Nothing has changed since this backup.</p>';
  const restorable = rows.filter((r) => r.status !== 'added');
  return `<ul class="list">${rows.map((r) => `<li><span class="what">${esc(r.path)}<br><small class="muted">${STATUS[r.status]}</small></span>
      ${r.status === 'added' ? '' : `<button type="button" data-restore="${esc(r.path)}">Restore</button>`}</li>`).join('')}</ul>
    ${restorable.length > 1 ? `<div class="btns" style="margin-top:8px"><button type="button" class="danger" id="restore-all">Restore all ${restorable.length} notes</button></div>` : ''}
    <p class="muted">Restoring puts the current version in .trash first, so nothing is lost.</p>`;
}

const FIELDS = [
  ['ideal_weight', 'Ideal weight (lb)', '0.1'],
  ['net_carb_max', 'Net carbs, most per day (g)', '1'],
  ['protein_min', 'Protein, least per day (g)', '1'],
  ['fiber_min', 'Fiber, least per day (g)', '1'],
  ['water_oz', 'Water per day (oz)', '1'],
  ['walks_per_day', 'Walks per day', '1'],
  ['walk_minutes', 'Minutes per walk', '1'],
];

export async function render(main, { refresh }) {
  const [goals, glp1, backups, programs, diets] = await Promise.all([
    api.doc('goals'),
    api.doc('glp1').catch(() => null),
    api.backups().catch((e) => ({ error: e.message, days: [] })),
    api.items('programs').catch(() => []),
    api.items('diets').catch(() => []),
  ]);
  const goodDiets = (Array.isArray(diets) ? diets : []).filter((d) => d && !d.broken);
  const mains = goodDiets.filter((d) => d.add_on !== true);
  const addOns = goodDiets.filter((d) => d.add_on === true);
  const dietById = (id) => goodDiets.find((d) => d.id === id);
  const program = programs.find((p) => p.id === goals.program && !p.broken);
  const walk = effectiveWalkMinutes(goals, program, isoDate());
  const phaseNo = walk.source === 'program' ? programPosition(program, goals.program_start, isoDate()).phaseIndex + 1 : null;
  const note = (k) => (k === 'walk_minutes' && walk.source === 'program' ? `<small class="muted">Set by ${esc(walk.program)} (phase ${esc(phaseNo)}) while it runs. This number is used when no program sets one.</small>` : '');
  main.innerHTML = `<div class="head"><h1>Settings</h1></div>
    <form class="card form" id="goals" style="max-width:560px">
      <h2>Your goals</h2>
      ${FIELDS.map(([k, label, step]) => `<label>${label}<input type="number" step="${step}" name="${k}" value="${esc(goals[k] ?? '')}">${note(k)}</label>`).join('')}
      <label>Next checkup<input type="date" name="next_checkup" value="${esc(goals.next_checkup || '')}"></label>
      <div class="actions"><span class="grow"></span><button class="primary" type="submit">Save goals</button></div>
    </form>
    <form class="card form" id="diet" style="max-width:560px;margin:14px 0">
      <h2>Diet</h2>
      <label>Main diet<select name="diet"><option value="">None</option>${mains.map((d) => `<option value="${esc(d.id)}"${goals.diet === d.id ? ' selected' : ''}>${esc(d.name || d.id)}</option>`).join('')}</select></label>
      <label>Add-on<select name="diet_add_on"><option value="">None</option>${addOns.map((d) => `<option value="${esc(d.id)}"${goals.diet_add_on === d.id ? ' selected' : ''}>${esc(d.name || d.id)}</option>`).join('')}</select></label>
      <div id="diet-window" hidden>
        <label>Eating window starts<input type="time" name="window_start"></label>
        <label>Eating window ends<input type="time" name="window_end"></label>
      </div>
      <p class="muted" id="diet-desc" style="margin:0"></p>
      <div class="actions"><span class="grow"></span><button class="primary" type="submit">Save diet</button></div>
    </form>
    ${glp1 ? `<form class="card form" id="glp1" style="max-width:560px;margin:14px 0">
      <h2>GLP-1 tracking</h2>
      <label class="check"><input type="checkbox" name="enabled"${glp1.enabled ? ' checked' : ''}> Track GLP-1 shots</label>
      <label>Medication<input type="text" name="medication" value="${esc(glp1.medication || '')}"></label>
      <label>Current dose (mg)<input type="number" step="0.25" name="dose_mg" min="0" value="${esc(glp1.dose_mg ?? '')}"></label>
      <label>Weekly shot day<select name="shot_day"><option value="">—</option>${WEEKDAYS.map((w, i) => `<option value="${i}"${glp1.shot_day === i ? ' selected' : ''}>${w}</option>`).join('')}</select></label>
      <p class="muted" style="margin:0">Body Lab records and graphs. It never recommends doses.</p>
      <div class="actions"><span class="grow"></span><button class="primary" type="submit">Save GLP-1 settings</button></div>
    </form>` : `<section class="card error" style="max-width:560px;margin:14px 0"><h2>GLP-1 tracking</h2>
      <p>Library/GLP-1.md can't be read, so GLP-1 settings are paused. Fix or delete that file.</p></section>`}
    ${backupCard(backups)}
    <p class="muted" style="max-width:560px">Protein tip from your research document: 1.2–2.0 g per kg of body weight a day.
      At your ideal weight that is about ${goals.ideal_weight ? `${Math.round(goals.ideal_weight / 2.2046 * 1.2)}–${Math.round(goals.ideal_weight / 2.2046 * 2)}` : '—'} g.</p>`;

  main.querySelector('#goals').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const next = { ...goals };
    for (const [k] of FIELDS) next[k] = f[k].value === '' ? null : Number(f[k].value);
    next.next_checkup = f.next_checkup.value || null;
    attempt(async () => { await api.saveDoc('goals', next); refresh(); }, 'Goals saved');
  });

  const dietForm = main.querySelector('#diet');
  const dietEls = dietForm.elements;
  const windowBox = main.querySelector('#diet-window');
  const picked = () => [dietById(dietEls.diet.value), dietById(dietEls.diet_add_on.value)].filter(Boolean);
  const windowOf = (d) => (d.eating_window && d.eating_window.start && d.eating_window.end ? d.eating_window : null);
  let windowFor = null;
  function syncDiet() {
    const withWindow = picked().find(windowOf);
    const key = withWindow ? withWindow.id : '';
    windowBox.hidden = !withWindow;
    if (withWindow && key !== windowFor) {
      const w = (goals.eating_window && goals.eating_window.start && goals.eating_window.end ? goals.eating_window : null) || windowOf(withWindow);
      dietEls.window_start.value = w.start;
      dietEls.window_end.value = w.end;
    }
    windowFor = key;
    // Each diet's description once, and the shared disclaimer once at the end.
    const texts = picked().map((d) => (typeof d.description === 'string' ? d.description.replace(DISCLAIMER, '').trim() : '')).filter(Boolean);
    main.querySelector('#diet-desc').textContent = picked().length ? [...new Set(texts), DISCLAIMER].join(' ') : '';
  }
  dietEls.diet.addEventListener('change', syncDiet);
  dietEls.diet_add_on.addEventListener('change', syncDiet);
  syncDiet();

  dietForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const main_ = dietById(dietEls.diet.value);
    // Custom hours stay in Goals when the chosen diets have no window; they come back with a fasting diet.
    const next = { ...goals, diet: dietEls.diet.value, diet_add_on: dietEls.diet_add_on.value, eating_window: goals.eating_window ?? null };
    if (!windowBox.hidden) {
      if (!dietEls.window_start.value || !dietEls.window_end.value) return toast('Pick both eating window times.', true);
      next.eating_window = { start: dietEls.window_start.value, end: dietEls.window_end.value };
    }
    const keys = [['net_carb_max', 'Net carbs'], ['protein_min', 'protein'], ['fiber_min', 'fiber']];
    const changed = main_ ? keys.filter(([k]) => main_[k] != null && main_[k] !== goals[k]) : [];
    if (changed.length) {
      const label = (k, n) => `${n} ${main_[k]} g`;
      if (confirm(`Use ${main_.name || main_.id}'s daily targets? ${changed.map(([k, n]) => label(k, n)).join(', ')}`)) {
        for (const [k] of changed) next[k] = main_[k];
      }
    }
    attempt(async () => { await api.saveDoc('goals', next); refresh(); }, 'Diet saved');
  });

  main.querySelector('#glp1')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const dose = f.dose_mg.value === '' ? null : Number(f.dose_mg.value);
    if (dose !== null && !(dose >= 0)) return toast('Dose can\'t be below 0.', true);
    const next = {
      ...glp1,
      enabled: f.enabled.checked,
      medication: f.medication.value.trim(),
      dose_mg: dose,
      shot_day: f.shot_day.value === '' ? null : Number(f.shot_day.value),
    };
    attempt(async () => { await api.saveDoc('glp1', next); refresh(); }, 'GLP-1 settings saved');
  });

  main.querySelector('#backup-now').addEventListener('click', () => attempt(async () => { await api.backupNow(); refresh(); }, 'Backup saved'));
  const pick = main.querySelector('#backup-day');
  const box = main.querySelector('#backup-diff');
  let diffToken = 0;
  async function showDiff() {
    const token = ++diffToken;
    const day = pick.value;
    if (!day) { box.innerHTML = ''; delete box.dataset.day; return; }
    try {
      const rows = await api.backupDiff(day);
      if (token !== diffToken) return;
      box.innerHTML = diffHtml(day, rows);
      box.dataset.day = day;
    } catch (e) {
      if (token !== diffToken) return;
      box.innerHTML = `<p class="warn">${esc(e.message)}</p>`;
      delete box.dataset.day;
    }
  }
  pick.addEventListener('change', showDiff);
  box.addEventListener('click', (e) => {
    const one = e.target.closest('[data-restore]');
    const all = e.target.closest('#restore-all');
    if (!one && !all) return;
    const day = box.dataset.day;
    if (!day) return;
    const what = one ? one.dataset.restore : 'all changed notes';
    if (!confirm(`Restore ${what} from ${shortDate(day)}? The current version goes to .trash first.`)) return;
    attempt(async () => {
      await api.restoreBackup(day, one ? { paths: [one.dataset.restore] } : { all: true });
      await showDiff();
    }, 'Restored');
  });
}
