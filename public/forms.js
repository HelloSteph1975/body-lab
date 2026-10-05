import { esc, slug } from './util.js';

// One modal form for every add/edit in the app.
// fields: [{ name, label, type: text|number|date|time|select|textarea|rating|tags,
//            options, step, placeholder, required, default, raw (tags: don't slug typed values) }]
export function openForm({ title, fields, values = {}, onSave, onDelete, extra, confirmDelete }) {
  const dlg = document.getElementById('modal');
  if (dlg.open) dlg.close();
  dlg.innerHTML = `<form class="form" novalidate>
    <h2>${esc(title)}</h2>
    ${fields.map((f) => renderField(f, values[f.name])).join('')}
    <div class="extra"></div>
    <p class="err" hidden></p>
    <div class="actions">
      ${onDelete ? '<button type="button" class="danger" data-act="delete">Delete</button>' : ''}
      <span class="grow"></span>
      <button type="button" data-act="cancel">Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>`;
  const form = dlg.querySelector('form');
  const showError = (e) => {
    const p = form.querySelector('.err');
    p.textContent = e.message;
    p.hidden = false;
  };
  const getExtra = extra ? extra(form.querySelector('.extra'), form) : null;

  form.addEventListener('click', async (ev) => {
    const rate = ev.target.closest('.rating button');
    if (rate) {
      const wasOn = rate.classList.contains('on');
      rate.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
      if (!wasOn) rate.classList.add('on');
    }
    const tag = ev.target.closest('.tags button');
    if (tag) tag.classList.toggle('on');
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') dlg.close();
    if (act === 'delete' && confirm(confirmDelete || 'Delete this? This can\'t be undone from the app.')) {
      try {
        await onDelete();
        dlg.close();
      } catch (e) {
        showError(e);
      }
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const values = readFields(form, fields);
    const missing = fields.find((f) => f.required && (values[f.name] === null || values[f.name] === ''));
    if (missing) return showError(new Error(`${missing.label} is required.`));
    submitBtn.disabled = true;
    try {
      await onSave(getExtra ? { ...values, ...getExtra() } : values);
      dlg.close();
    } catch (e) {
      submitBtn.disabled = false;
      showError(e);
    }
    return undefined;
  });

  dlg.showModal();
  form.querySelector('input, select, textarea')?.focus();
  return form;
}

function renderField(f, v) {
  const value = v ?? f.default ?? '';
  const label = esc(f.label);
  if (f.type === 'select') {
    const opts = f.options.map((o) => {
      const [val, text] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(val)}"${String(value) === String(val) ? ' selected' : ''}>${esc(text)}</option>`;
    });
    return `<label>${label}<select name="${f.name}">${opts.join('')}</select></label>`;
  }
  if (f.type === 'textarea') return `<label>${label}<textarea name="${f.name}" rows="4" placeholder="${esc(f.placeholder || '')}">${esc(value)}</textarea></label>`;
  if (f.type === 'rating') {
    return `<fieldset class="rating" data-name="${f.name}"><legend>${label}</legend>${[1, 2, 3, 4, 5]
      .map((n) => `<button type="button" data-v="${n}" class="${Number(value) === n ? 'on' : ''}">${n}</button>`).join('')}</fieldset>`;
  }
  if (f.type === 'tags') {
    const chosen = Array.isArray(v) ? v : [];
    const all = [...new Set([...(f.options || []), ...chosen])];
    return `<fieldset class="tags" data-name="${f.name}"><legend>${label}</legend>${all
      .map((t) => `<button type="button" data-v="${esc(t)}" class="${chosen.includes(t) ? 'on' : ''}">${esc(t)}</button>`).join('')}
      <input name="${f.name}__more" placeholder="Other tags, separated by commas"></fieldset>`;
  }
  return `<label>${label}<input name="${f.name}" type="${f.type || 'text'}"${f.step ? ` step="${f.step}"` : ''}${f.min != null ? ` min="${f.min}"` : ''}
    value="${esc(value)}" placeholder="${esc(f.placeholder || '')}"${f.list ? ` list="${f.list}"` : ''}></label>`;
}

function readFields(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'rating') {
      const on = form.querySelector(`.rating[data-name="${f.name}"] .on`);
      out[f.name] = on ? Number(on.dataset.v) : null;
    } else if (f.type === 'tags') {
      const on = [...form.querySelectorAll(`.tags[data-name="${f.name}"] .on`)].map((b) => b.dataset.v);
      // raw: true keeps what was typed (diet names have capitals and spaces); other tags become slugs.
      const more = form.elements[`${f.name}__more`].value.split(',').map(f.raw ? (t) => t.trim() : slug).filter(Boolean);
      out[f.name] = [...new Set([...on, ...more])];
    } else {
      const raw = form.elements[f.name].value.trim();
      if (raw === '') out[f.name] = null;
      else out[f.name] = f.type === 'number' ? Number(raw) : raw;
    }
  }
  return out;
}
