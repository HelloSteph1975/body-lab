import { api } from '../api.js';
import { renderMarkdown } from '../markdown.js';

export async function render(el) {
  const { text } = await api.readme();
  el.innerHTML = `<div class="head"><h1>READ ME</h1></div><article class="readme card">${renderMarkdown(text)}</article>`;
  // The page route lives in the hash, so an in-page #anchor link would be taken
  // for a route. Scroll to the heading ourselves and leave the hash alone.
  el.querySelectorAll('.readme a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}
