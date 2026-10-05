import { api } from '../api.js';
import { noteForm } from '../entries.js';
import { esc, isoDate, prettyDate } from '../util.js';

let query = '';
let tagFilter = '';

export async function render(main, { refresh }) {
  const [all, notes] = await Promise.all([api.journal(), api.journal(query, tagFilter)]);
  const tags = [...new Set(all.flatMap((n) => n.tags || []))].sort();

  main.innerHTML = `
    <div class="head"><h1>Journal</h1><span class="grow"></span><button class="primary" id="new">+ Note</button></div>
    <div class="card" style="margin-bottom:14px">
      <input id="q" placeholder="Search your notes" value="${esc(query)}">
      <div class="tabs" style="margin:10px 0 0">
        <button data-tag="" class="${tagFilter ? '' : 'on'}">All</button>
        ${tags.map((t) => `<button data-tag="${esc(t)}" class="${t === tagFilter ? 'on' : ''}">${esc(t)}</button>`).join('')}
      </div>
    </div>
    ${notes.length ? `<ul class="list card">${notes.map((n, i) => `<li data-i="${i}">
        <span class="time">${esc(n.time || '')}</span>
        <span class="what"><small class="muted">${esc(prettyDate(n.date))}${n.mood ? ` · mood ${esc(n.mood)}/5` : ''}</small><br>
        ${esc(n.text || '')} ${(n.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span></li>`).join('')}</ul>`
      : (query || tagFilter ? `<p class="muted">No notes match. <button id="clear-search">Clear search</button></p>` : '<p class="muted">No notes yet. Tap + Note any time to jot down how you feel.</p>')}`;

  const q = main.querySelector('#q');
  q.addEventListener('change', () => { query = q.value.trim(); refresh(); });
  main.querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => { tagFilter = b.dataset.tag; refresh(); }));
  const clearBtn = main.querySelector('#clear-search');
  if (clearBtn) clearBtn.addEventListener('click', () => { query = ''; tagFilter = ''; refresh(); });
  main.querySelector('#new').addEventListener('click', () => noteForm(isoDate(), null, refresh));
  main.querySelectorAll('[data-i]').forEach((li) => li.addEventListener('click', () => {
    const n = notes[Number(li.dataset.i)];
    const { date, ...entry } = n;
    noteForm(date, entry, refresh);
  }));
}
