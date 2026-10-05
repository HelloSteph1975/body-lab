'use strict';
// Notes keep their data in YAML frontmatter, one key per line, with each value
// written as JSON. JSON is valid YAML, so Obsidian reads these notes too. The
// reader also accepts plain scalars and simple "- item" lists, which is what
// Obsidian writes when a property is edited there.

class FrontmatterError extends Error {}

function parseValue(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  try {
    return JSON.parse(s);
  } catch {
    // not JSON; fall through
  }
  if (s.startsWith('[') || s.startsWith('{')) throw new FrontmatterError(`not valid JSON: ${s}`);
  if (s.startsWith('"')) throw new FrontmatterError(`unfinished quoted value: ${s}`);
  if (s.startsWith("'")) {
    if (/^'(?:[^']|'')*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    throw new FrontmatterError(`unfinished quoted value: ${s}`);
  }
  return s;
}

function parse(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const open = src.match(/^(?:[ \t]*\n)*---[ \t]*\n/);
  if (!open) return { data: {}, body: src, hasFrontmatter: false };
  // keep the opener's newline so an empty block still finds its closer
  const rest = src.slice(open[0].length - 1);
  const close = rest.match(/\n---[ \t]*(?:\n|$)/);
  if (!close) throw new FrontmatterError('frontmatter has no closing ---');
  const data = {};
  let listKey = null;
  for (const line of rest.slice(1, close.index).split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s*(.*)$/);
    if (item) {
      if (!listKey) throw new FrontmatterError(`list item with no key: ${line}`);
      if (/^[\w-]+:(\s|$)/.test(item[1])) throw new FrontmatterError(`nested YAML objects aren't supported: ${line}`);
      if (data[listKey] === null) data[listKey] = [];
      data[listKey].push(parseValue(item[1]));
      continue;
    }
    const m = line.match(/^([A-Za-z_][\w-]*):(?:\s(.*))?$/);
    if (!m) throw new FrontmatterError(`can't read line: ${line}`);
    const value = parseValue(m[2] || '');
    data[m[1]] = value;
    listKey = value === null ? m[1] : null;
  }
  return { data, body: rest.slice(close.index + close[0].length), hasFrontmatter: true };
}

function serialize(data, body = '') {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.map((l) => `${l}\n`).join('')}---\n${body}`;
}

module.exports = { parse, serialize, FrontmatterError };
