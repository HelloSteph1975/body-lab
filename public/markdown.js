// A small, safe Markdown renderer for the Read Me. Everything is escaped first,
// then a fixed set of patterns is turned back into tags.
import { esc } from './util.js';

// Heading ids are prefixed so they can never match the app's own ids (toast, modal...).
const ID_PREFIX = 'readme-';
const IMAGE_DIR = 'docs/readme/';
const IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg)$/i;

function inline(raw) {
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  let s = esc(raw.replace(/\u0000/g, ''));
  s = s.replace(/`([^`]+)`/g, (m, code) => hold(`<code>${code}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]*)\)/g, (m, alt, src) => {
    const name = src.startsWith(IMAGE_DIR) ? src.slice(IMAGE_DIR.length) : '';
    return IMAGE_NAME.test(name)
      ? hold(`<img src="/readme-images/${encodeURIComponent(name)}" alt="${alt}" loading="lazy">`)
      : alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) return hold(`<a href="${url}" target="_blank" rel="noopener">${text}</a>`);
    if (/^#[A-Za-z0-9_-]+$/.test(url)) return hold(`<a href="#${ID_PREFIX}${url.slice(1)}">${text}</a>`);
    return text;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
  // Restore held pieces (links may hold code or images, so loop until none remain).
  let guard = 0;
  while (s.includes('\u0000') && guard++ < 5) s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => held[Number(i)]);
  return s;
}

function slugOf(text) {
  return text.replace(/[`*]/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSeparator = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-');
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function renderMarkdown(text) {
  if (typeof text !== 'string' || !text) return '';
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const used = new Set();
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*```/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const base = ID_PREFIX + slugOf(h[2]);
      let id = base;
      for (let n = 1; used.has(id);) id = `${base}-${++n}`;
      used.add(id);
      out.push(`<h${h[1].length} id="${id}">${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      const tr = (r, tag) => `<tr>${head.map((_, k) => `<${tag}>${inline(r[k] ?? '')}</${tag}>`).join('')}</tr>`;
      out.push(`<div class="table-wrap"><table><thead>${tr(head, 'th')}</thead><tbody>${rows.map((r) => tr(r, 'td')).join('')}</tbody></table></div>`);
      continue;
    }
    const kind = BULLET.test(line) ? ['ul', BULLET] : NUMBERED.test(line) ? ['ol', NUMBERED] : null;
    if (kind) {
      const items = [];
      while (i < lines.length && kind[1].test(lines[i])) items.push(lines[i++].match(kind[1])[1]);
      out.push(`<${kind[0]}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${kind[0]}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])
      && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])
      && !(lines[i].includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1]))) para.push(lines[i++]);
    out.push(`<p>${inline(para.join('\n'))}</p>`);
  }
  return out.join('\n');
}
