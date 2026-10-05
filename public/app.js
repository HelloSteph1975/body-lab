import * as dashboard from './pages/dashboard.js';
import * as today from './pages/today.js';
import * as meals from './pages/meals.js';
import * as workouts from './pages/workouts.js';
import * as goals from './pages/goals.js';
import * as history from './pages/history.js';
import * as journal from './pages/journal.js';
import * as library from './pages/library.js';
import * as labs from './pages/labs.js';
import * as settings from './pages/settings.js';
import * as readme from './pages/readme.js';
import { noteForm } from './entries.js';
import { esc, isoDate } from './util.js';

const pages = { dashboard, today, meals, workouts, goals, history, journal, library, labs, settings, readme };
const main = document.getElementById('main');

let renderToken = 0;

// Each page renders into a detached div; its nodes replace #main only if no
// newer route() call started meanwhile, so a slow page can't overwrite a newer one.
async function route() {
  const token = ++renderToken;
  const [, name = 'dashboard', arg] = location.hash.split('/');
  const key = pages[name] ? name : 'dashboard';
  document.querySelectorAll('.side a').forEach((a) => a.classList.toggle('active', a.dataset.page === key));
  const target = document.createElement('div');
  try {
    await pages[key].render(target, { arg: arg && decodeURIComponent(arg), refresh: route });
  } catch (e) {
    target.innerHTML = `<div class="card error"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`;
  }
  if (token === renderToken) main.replaceChildren(...target.childNodes);
}

window.addEventListener('hashchange', route);
document.getElementById('quick-note').addEventListener('click', () => {
  const [, name, arg] = location.hash.split('/');
  const date = name === 'today' && arg ? arg : isoDate();
  noteForm(date, null, route);
});
route();
