// Food picker: a text box that suggests saved and USDA foods as you type, plus the
// portion and fill helpers the meal form and recipe editor share. No module state:
// every attachFoodPicker call keeps its own timer, token and list.

import { api } from './api.js';
import { nutrientsFor } from './nutrition.js';
import { esc } from './util.js';

export const NUTRIENT_KEYS = ['net_carbs', 'protein', 'fiber', 'fat', 'kcal'];

const round1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10;
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isDirty = (dirty, k) => (dirty instanceof Set ? dirty.has(k) : isObj(dirty) && !!dirty[k]);

// The portions a food can be measured in: a saved food's own serving first (its numbers are
// per that serving), then the USDA gram portions. Labels are unique; the saved serving wins.
export function portionOptions(food) {
  const f = isObj(food) ? food : {};
  const out = [];
  const seen = new Set();
  const serving = typeof f.serving === 'string' ? f.serving.trim() : '';
  if (f.source === 'saved' || !isObj(f.per100)) {
    const label = serving || '1 serving';
    out.push({ label, saved: true });
    seen.add(label);
  }
  if (isObj(f.per100)) {
    for (const p of Array.isArray(f.portions) ? f.portions : []) {
      const g = isObj(p) ? finite(p.g) : null;
      if (typeof p?.label !== 'string' || !p.label.trim() || g === null || g <= 0 || seen.has(p.label)) continue;
      seen.add(p.label);
      out.push({ label: p.label, g });
    }
  }
  return out;
}

export const defaultPortion = (food) => portionOptions(food)[0]?.label ?? '';

// Numbers for qty × portion of food, as { net_carbs, protein, fiber, fat, kcal }, or null when
// the portion isn't one of the food's. kcal is whole; the rest have one decimal.
export function nutrientsForPortion(food, portionLabel, qty) {
  const portion = portionOptions(food).find((p) => p.label === portionLabel);
  if (!portion) return null;
  const q = finite(qty);
  const n = q !== null && q >= 0 ? q : 1;
  if (portion.saved) {
    const out = {};
    for (const k of NUTRIENT_KEYS) {
      const v = finite(food[k]);
      out[k] = v === null ? null : (k === 'kcal' ? Math.round(v * n) : round1(v * n));
    }
    return out;
  }
  return nutrientsFor(food.per100, portion.g * n);
}

// The fields to write into a row: every nutrient the person hasn't typed in (dirty), filled
// from qty × portion. dirty is a Set or an object of key -> true. Returns {} when nothing fits.
export function fillItem(food, portionLabel, qty, dirty) {
  const n = nutrientsForPortion(food, portionLabel, qty);
  if (!n) return {};
  const out = {};
  for (const k of NUTRIENT_KEYS) if (!isDirty(dirty, k) && n[k] !== null && n[k] !== undefined) out[k] = n[k];
  return out;
}

// For an item logged earlier: the fields whose numbers aren't exactly what the food fills for
// portion × qty, so they count as typed. values: { key: number | string }; empty fields are skipped.
export function typedFields(values, food, portionLabel, qty) {
  const typed = new Set();
  const expected = nutrientsForPortion(food, portionLabel, qty);
  for (const k of NUTRIENT_KEYS) {
    const v = finite(isObj(values) ? values[k] : null);
    if (v === null) continue;
    const e = expected ? finite(expected[k]) : null;
    if (e === null || Math.abs(v - e) > 1e-9) typed.add(k);
  }
  return typed;
}

// Of several candidate foods (the saved food, the USDA food it came from), the one whose fill
// explains the most of an item's numbers, with the fields it doesn't explain. Earlier wins ties.
// candidates: [{ food, portion }]. Returns { food, portion, typed } or null.
export function bestMatch(values, candidates, qty) {
  let best = null;
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c || !isObj(c.food)) continue;
    const typed = typedFields(values, c.food, c.portion, qty);
    if (!best || typed.size < best.typed.size) best = { food: c.food, portion: c.portion, typed };
  }
  return best;
}

// Numbers for one serving of a remembered food. Fields the person typed are divided by qty;
// the rest come from the picked food at qty 1, so rounding doesn't build up.
export function perServing(item, food, portionLabel, dirty) {
  const it = isObj(item) ? item : {};
  const q = finite(it.qty) !== null && finite(it.qty) > 0 ? finite(it.qty) : 1;
  const base = food ? nutrientsForPortion(food, portionLabel, 1) : null;
  const out = {};
  for (const k of NUTRIENT_KEYS) {
    const typed = finite(it[k]);
    if (base && !isDirty(dirty, k) && base[k] !== null && base[k] !== undefined) out[k] = base[k];
    else if (typed === null) out[k] = 0;
    else out[k] = k === 'kcal' ? Math.round(typed / q) : round1(typed / q);
  }
  return out;
}

// What a key press in the picker does. state: { open, active, count }.
// Returns { prevent, stop, active, choose (an index or -1), close }.
// Enter never reaches the form, so it can't submit it by accident.
export function pickerKey(key, { open = false, active = -1, count = 0 } = {}) {
  const out = { prevent: false, stop: false, active, choose: -1, close: false };
  if (key === 'Enter') {
    out.prevent = true;
    if (open && active >= 0 && active < count) out.choose = active;
    return out;
  }
  if (!open) return out;
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    out.prevent = true;
    if (!count) return out;
    if (active < 0) out.active = key === 'ArrowDown' ? 0 : count - 1;
    else out.active = (active + (key === 'ArrowDown' ? 1 : -1) + count) % count;
  } else if (key === 'Escape') {
    // Close the list, not the dialog around it.
    out.prevent = true;
    out.stop = true;
    out.close = true;
  }
  return out;
}

const LOOKUP_KEYS = ['serving', ...NUTRIENT_KEYS];
const sameValue = (a, b) => {
  const x = finite(a);
  const y = finite(b);
  if (x !== null && y !== null) return Math.abs(x - y) < 1e-9;
  return String(a ?? '').trim() === String(b ?? '').trim();
};
const blank = (v) => String(v ?? '').trim() === '';

// The library's "Look up": what picking `food` at `portionLabel` writes into the food form.
// current: { name, serving, net_carbs, ..., tags: [tags switched on] }.
// prev: { name, values, tags } from the last fill (empty on the first one).
// A field is the person's when it isn't empty and doesn't hold the last fill. Their fields are
// listed in `conflicts` when the new value differs, and only written when `replace` is true.
// Tags the last pick switched on are switched off first; tags the person chose are left alone.
// Returns { writes, conflicts, tags, next } where next is the prev for the following fill.
export function planLookup(current, food, portionLabel, prev = {}, replace = false) {
  const cur = isObj(current) ? current : {};
  const last = isObj(prev) ? prev : {};
  const lastValues = isObj(last.values) ? last.values : {};
  const fresh = { serving: portionLabel, ...fillItem(food, portionLabel, 1, null) };
  const writes = {};
  const conflicts = [];
  for (const k of LOOKUP_KEYS) {
    if (!(k in fresh)) continue;
    const mine = !blank(cur[k]) && !(k in lastValues && sameValue(cur[k], lastValues[k]));
    if (mine) {
      // Already the same: leave it, so it stays theirs for the next pick.
      if (sameValue(cur[k], fresh[k])) continue;
      conflicts.push(k);
      if (!replace) continue;
    }
    writes[k] = fresh[k];
  }
  const name = isObj(food) && typeof food.name === 'string' ? food.name : '';
  if (name && (blank(cur.name) || (last.name && sameValue(cur.name, last.name)))) writes.name = name;
  const lastTags = Array.isArray(last.tags) ? last.tags : [];
  const kept = (Array.isArray(cur.tags) ? cur.tags : []).filter((t) => !lastTags.includes(t));
  const added = (isObj(food) && Array.isArray(food.tags) ? food.tags : []).filter((t) => typeof t === 'string' && t && !kept.includes(t));
  const values = { ...writes };
  delete values.name;
  return {
    writes,
    conflicts,
    tags: [...kept, ...added],
    next: { name: writes.name ?? last.name ?? '', values, tags: added },
  };
}

// What a picked food adds to a meal item: its USDA id, tags and the chosen portion label.
export function itemMeta(food, portionLabel) {
  const f = isObj(food) ? food : {};
  const out = {};
  const usda = f.source === 'usda' ? f.id : f.usda_id;
  if (usda !== undefined && usda !== null && usda !== '') out.usda_id = usda;
  const tags = Array.isArray(f.tags) ? f.tags.filter((t) => typeof t === 'string' && t) : [];
  if (tags.length) out.tags = tags;
  if (portionLabel) out.portion = portionLabel;
  return out;
}

// A one-line summary for a suggestion: "72 kcal · 1 large".
function suggestionNote(food) {
  const label = defaultPortion(food);
  const n = nutrientsForPortion(food, label, 1);
  return n && n.kcal !== null ? `${n.kcal} kcal · ${label}` : label;
}

// <option>s for a portion select.
export function portionOptionsHtml(food, selected) {
  return portionOptions(food).map((p) => `<option value="${esc(p.label)}"${p.label === selected ? ' selected' : ''}>${esc(p.label)}${p.saved ? ' (saved)' : ''}</option>`).join('');
}

// A saved food that came back with a usda_id gains the USDA portions, so a different
// portion can be chosen. Failures leave the saved food as it is.
export async function withUsdaPortions(food, fetchFood = api.usdaFood) {
  if (!isObj(food) || food.source !== 'saved' || food.usda_id == null || food.usda_id === '' || isObj(food.per100)) return food;
  try {
    const usda = await fetchFood(food.usda_id);
    if (!isObj(usda) || !isObj(usda.per100)) return food;
    return { ...food, per100: usda.per100, portions: usda.portions, tags: Array.isArray(food.tags) && food.tags.length ? food.tags : usda.tags };
  } catch {
    return food;
  }
}

// Turns `input` into a food search box. onPick(food) gets the chosen search result.
// Options: search(q, limit) (default api.foodSearch), filter(food) to hide some results,
// limit (10), minChars (2), delay (200 ms). Returns { close, destroy }.
export function attachFoodPicker(input, { onPick, search = api.foodSearch, filter, limit = 10, minChars = 2, delay = 200 } = {}) {
  const wrap = document.createElement('span');
  wrap.className = 'fp-wrap';
  input.replaceWith(wrap);
  wrap.append(input);
  const list = document.createElement('ul');
  list.className = 'fp-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(list);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('list');

  let timer = null;
  let token = 0;
  let results = [];
  let active = -1;

  // The list is position: fixed, placed from the input's box, so a scrolling dialog can't clip
  // it. It stays inside the viewport: as wide as the input, at least 420 px when there's room,
  // and above the input when there's more space there.
  const place = () => {
    if (list.hidden) return;
    if (!input.isConnected) { close(); return; }
    const r = input.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 420), vw - 16);
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 180 && above > below;
    list.style.width = `${width}px`;
    list.style.left = `${Math.max(8, Math.min(r.left, vw - 8 - width))}px`;
    list.style.maxHeight = `${Math.max(120, Math.min(320, (up ? above : below) - 4))}px`;
    list.style.top = up ? '' : `${r.bottom + 4}px`;
    list.style.bottom = up ? `${vh - r.top + 4}px` : '';
  };
  const watch = (on) => {
    const fn = on ? 'addEventListener' : 'removeEventListener';
    window[fn]('scroll', place, true);
    window[fn]('resize', place);
  };

  const close = () => {
    token += 1; // a response still on its way is now stale
    clearTimeout(timer);
    watch(false);
    list.hidden = true;
    list.innerHTML = '';
    results = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
  };

  const highlight = (i) => {
    active = i;
    list.querySelectorAll('li').forEach((li, k) => li.classList.toggle('on', k === i));
    list.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  };

  // The list closes with the dialog it sits in, so it can't float over the page afterwards.
  let dialog = null;
  const show = (foods, failed = false) => {
    results = foods;
    active = -1;
    const box = input.closest('dialog');
    if (box !== dialog) {
      dialog?.removeEventListener('close', close);
      dialog = box;
      dialog?.addEventListener('close', close);
    }
    if (failed) {
      list.innerHTML = '<li class="fp-none">Search unavailable</li>';
    } else if (!foods.length) {
      list.innerHTML = '<li class="fp-none">No matches</li>';
    } else {
      list.innerHTML = foods.map((f, i) => `<li role="option" data-i="${i}">
        <span class="fp-badge ${f.source === 'saved' ? 'saved' : 'usda'}">${f.source === 'saved' ? 'saved' : 'USDA'}</span>
        <span class="fp-name">${esc(f.name)}</span>
        <span class="fp-note">${esc(suggestionNote(f))}</span></li>`).join('');
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    place();
    watch(true);
  };

  const choose = (i) => {
    const food = results[i];
    if (!food) return;
    close();
    input.value = food.name;
    onPick?.(food);
  };

  const onInput = () => {
    const q = input.value.trim();
    clearTimeout(timer);
    const mine = ++token;
    if (q.length < minChars) { close(); return; }
    timer = setTimeout(async () => {
      let found;
      let failed = false;
      try {
        found = await search(q, filter ? 30 : limit);
      } catch {
        found = [];
        failed = true;
      }
      if (mine !== token || document.activeElement !== input) return;
      const kept = (Array.isArray(found) ? found : []).filter((f) => f && typeof f.name === 'string' && (!filter || filter(f))).slice(0, limit);
      show(kept, failed);
    }, delay);
  };

  const onKey = (ev) => {
    const r = pickerKey(ev.key, { open: !list.hidden, active, count: results.length });
    if (r.prevent) ev.preventDefault();
    if (r.stop) ev.stopPropagation();
    if (r.close) close();
    else if (r.choose >= 0) choose(r.choose);
    else if (r.active !== active) highlight(r.active);
  };

  // mousedown, not click: preventDefault keeps focus in the input, so blur doesn't close the
  // list before the choice lands.
  const onDown = (ev) => {
    ev.preventDefault();
    const li = ev.target.closest('li[data-i]');
    if (li) choose(Number(li.dataset.i));
  };

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', close);
  list.addEventListener('mousedown', onDown);

  return {
    close,
    destroy() {
      close();
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', close);
      dialog?.removeEventListener('close', close);
      list.remove();
    },
  };
}
