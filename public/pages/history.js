import { api } from '../api.js';
import { esc, isoDate } from '../util.js';

let month = isoDate().slice(0, 7);

function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function render(main, { refresh }) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const days = await api.days(first, last);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const lead = new Date(y, m - 1, 1).getDay();
  const today = isoDate();
  const title = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push('<span></span>');
  for (let n = 1; n <= daysInMonth; n += 1) {
    const date = `${month}-${String(n).padStart(2, '0')}`;
    const d = byDate.get(date);
    const info = d?.broken ? 'needs repair' : d?.data ? [d.data.weight ? `${d.data.weight} lb` : '', d.totals.walks ? `${d.totals.walks} walks` : '', (d.data.notes || []).length ? '✎' : ''].filter(Boolean).join(' · ') : '';
    cells.push(`<a href="#/today/${date}" class="${d ? 'has' : ''} ${date === today ? 'today' : ''}">${n}<small>${esc(info)}</small></a>`);
  }

  main.innerHTML = `
    <div class="head"><button data-m="-1">◀</button><h1>${esc(title)}</h1><button data-m="1">▶</button><span class="grow"></span>
      <label class="muted" style="display:flex;gap:8px;align-items:center">Go to <input type="date" id="jump" style="width:auto"></label></div>
    <section class="card"><div class="cal">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => `<div class="dow">${w}</div>`).join('')}
      ${cells.join('')}
    </div></section>`;

  main.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { month = shiftMonth(month, Number(b.dataset.m)); refresh(); }));
  main.querySelector('#jump').addEventListener('change', (e) => { if (e.target.value) location.hash = `#/today/${e.target.value}`; });
}
