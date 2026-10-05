import { api } from '../api.js';
import { attachFoodPicker } from '../foodpicker.js';
import { openForm } from '../forms.js';
import {
  addExtra, copyWeekMeals, countRecipeUses, dietFlags, effectiveRules, FOOD_TAGS, friendlyAmount, normalizePlan,
  plannedDayTotals, planListProblem, recipeIndex, removeExtra, removeMealById, removePrepById, renameRecipeInPlan, SECTIONS,
  SLOT_LABELS, SLOTS, savePlanWithRetry, savePrep, shoppingList, toggleChecked, toggleExtra, updateMealById,
} from '../meals.js';
import {
  addDaysIso, DAY_LABELS, mondayOf, readNumber, WEEK_ORDER,
} from '../programs.js';
import {
  calcSummary, ESTIMATE_NOTE, isLinked, linkedIds, loadFoods, PER_SERVING_KEYS, recipeCalc, relinkIngredients, sameNumbers,
  starterTargets, uncountedLinked, uncountedText, updatedStarter, USDA_NOTE, withCalculated,
} from '../recipecalc.js';
import {
  attempt, esc, isoDate, prettyDate, shortDate, toast,
} from '../util.js';

const TABS = [['recipes', 'Recipes'], ['week', 'This week'], ['shopping', 'Shopping list']];
// USDA foods the recipe pages have loaded, by id string. Kept for the page's life; the list never changes.
const usdaFoods = new Map();

let tab = 'recipes';
let weekStart = mondayOf(isoDate());
// Until the person uses the week arrows, the page follows the real current week (it may stay open overnight).
let navigated = false;
let hideTicked = false;
let focusExtra = false;
const filters = { q: '', diet: '', prepOnly: false };

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const objs = (x) => (Array.isArray(x) ? x.filter(isObj) : []);
const strings = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const servingsOf = (m) => { const n = Number(m.servings); return Number.isFinite(n) && n > 0 ? n : 1; };
const nice = (n) => String(Math.round(n * 100) / 100);
const weekdayShort = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
const stepText = (s) => (typeof s === 'string' ? s : String(isObj(s) ? s.text ?? '' : ''));

// A hand-edited or AI-written note can hold odd types; keep only what the page can read.
function clean(r) {
  if (!r || r.broken) return r;
  return {
    ...r,
    name: String(r.name ?? ''),
    diets: strings(r.diets),
    tags: strings(r.tags),
    per_serving: isObj(r.per_serving) ? r.per_serving : {},
    ingredients: objs(r.ingredients),
    steps: (Array.isArray(r.steps) ? r.steps : []).filter((s) => typeof s === 'string' || isObj(s)),
  };
}

// Reads the plan for any week fresh from disk, applies a change that builds a new object, and saves it.
// Errors are thrown to the caller (a form shows them; buttons toast them).
// It saves with the version it read; if another window saved first, it reads again and re-applies
// (savePlanWithRetry). A note with an odd list or shopping field is refused, never overwritten.
async function changePlan(monday, build, okMessage) {
  await savePlanWithRetry({
    load: () => api.mealPlan(monday),
    save: (plan) => api.saveMealPlan(monday, { ...plan, week_start: monday }),
    build,
  });
  if (okMessage) toast(okMessage);
}

const goWeek = (n, refresh) => { navigated = true; weekStart = addDaysIso(weekStart, n); refresh(); };

// Every saved week, for checking a recipe rename or delete.
async function allPlans() {
  const mondays = await api.mealPlans();
  return Promise.all(mondays.map((monday) => api.mealPlan(monday).then((plan) => ({ monday, plan }), (e) => ({ monday, plan: null, error: e.message }))));
}

async function recipeUses(name) {
  const plans = await allPlans();
  const hits = plans.filter((x) => x.plan && countRecipeUses(x.plan, name) > 0).map((x) => ({ monday: x.monday, count: countRecipeUses(x.plan, name) }));
  return { hits, meals: hits.reduce((n, h) => n + h.count, 0), unreadable: plans.filter((x) => x.error).length };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function deleteRecipe(r, done) {
  const uses = await recipeUses(r.name);
  const missing = uses.meals === 1 ? 'planned meal uses this recipe; it will' : 'planned meals use this recipe; they will';
  if (uses.meals && !confirm(`${uses.meals} ${missing} show as missing. Move it to .trash anyway?`)) return;
  await attempt(() => api.deleteItem('recipes', r.id), 'Recipe deleted');
  done();
}

// ---------- recipe forms ----------

function addToWeekForm(r, done) {
  const today = isoDate();
  openForm({
    title: `Add "${r.name}" to the plan`,
    fields: [
      { name: 'date', label: 'Day', type: 'date', required: true, min: weekStart, default: today > weekStart ? today : weekStart },
      { name: 'slot', label: 'Meal', type: 'select', options: SLOTS.map((s) => [s, SLOT_LABELS[s]]), default: 'dinner' },
      { name: 'servings', label: 'Servings', type: 'number', min: 0.5, step: '0.5', placeholder: '1', default: 1 },
    ],
    values: {},
    onSave: async (v) => {
      if (v.date < weekStart) throw new Error('Pick a day in the week you are viewing or later.');
      const servings = v.servings === null ? 1 : v.servings;
      if (!(servings > 0)) throw new Error('Servings must be more than 0.');
      await changePlan(mondayOf(v.date), (plan) => ({
        ...plan, meals: [...plan.meals, { id: uid('p'), date: v.date, slot: v.slot, recipe: r.name, servings }],
      }), 'Added to the plan');
      done();
    },
  });
}

const numAttr = (v) => (typeof v === 'number' && Number.isFinite(v) ? `value="${esc(v)}"` : v === undefined || v === null ? 'value=""' : `value="" data-kept placeholder="${esc(v)}"`);

// The USDA cell of an ingredient row: a "linked" badge with an unlink ✕, or a Link button.
function linkCell(ing, i) {
  const name = String(ing.item ?? '').trim() || 'ingredient';
  if (!isLinked(ing)) return `<button type="button" class="mini" data-link="${i}" title="Link to a USDA food" aria-label="Link ${esc(name)} to a USDA food">Link</button>`;
  const food = usdaFoods.get(String(ing.usda_id));
  const title = food ? `Linked to ${food.name}` : `Linked to USDA food ${ing.usda_id}`;
  return `<span class="ing-link"><span class="fp-badge usda" title="${esc(title)}">linked</span><button type="button" class="mini" data-unlink="${i}" title="Unlink" aria-label="Unlink ${esc(name)}">✕</button></span>`;
}

function ingredientRow(ing, i, linking) {
  const sec = SECTIONS.includes(ing.section) ? SECTIONS : [...SECTIONS, ing.section].filter((s) => typeof s === 'string');
  return `<div class="item-row ing-row" data-ing="${i}">
    <input data-f="item" placeholder="Ingredient" aria-label="Ingredient" value="${esc(ing.item)}">
    <input data-f="amount" type="number" min="0" step="any" placeholder="Amount" aria-label="Amount" ${numAttr(ing.amount)}>
    <input data-f="unit" placeholder="Unit" aria-label="Unit" value="${esc(ing.unit)}">
    <select data-f="section" aria-label="Store section">${sec.map((s) => `<option value="${esc(s)}"${(ing.section || 'other') === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
    ${linkCell(ing, i)}
    <button type="button" data-rm-ing="${i}" aria-label="Remove ingredient">✕</button>
  </div>${linking ? `<div class="ing-linkbox" data-linkbox="${i}"><input data-link-q placeholder="Search USDA foods" aria-label="Search USDA foods for ${esc(String(ing.item ?? '').trim() || 'this ingredient')}" value="${esc(ing.item)}">
    <button type="button" data-link-cancel>Cancel</button></div>` : ''}`;
}

const SOURCE_OPTIONS = [['usda', 'Calculated from ingredients (USDA)'], ['manual', 'Manual: typed in']];
const psField = (k) => `ps_${k}`;

function recipeEditorExtra(base) {
  // Work on copies. Each row remembers the original so unknown keys survive the save.
  const st = {
    ingredients: base.ingredients.map((x) => ({ ...x })),
    steps: base.steps.map((s) => ({ orig: s, text: stepText(s) })),
    linking: null,
    calc: null,
  };
  return (box, form) => {
    const sourceSel = form.elements.ps_source;
    const line = document.createElement('p');
    line.className = 'muted calc-line';
    line.setAttribute('aria-live', 'polite');
    sourceSel.closest('label').after(line);
    const psInputs = PER_SERVING_KEYS.map((k) => form.elements[psField(k)]);
    let token = 0;
    let timer = null;

    const showSource = () => {
      const calculated = sourceSel.value === 'usda';
      for (const input of psInputs) input.readOnly = calculated;
      form.classList.toggle('ps-calculated', calculated);
      if (!calculated) line.textContent = 'Manual: the numbers below are kept as typed.';
      else if (st.calc) {
        line.textContent = calcSummary(st.calc);
        PER_SERVING_KEYS.forEach((k, n) => { psInputs[n].value = st.calc.per_serving[k]; });
      } else line.textContent = 'Calculating…';
    };

    // Loads any linked foods it hasn't seen, then works the numbers out again.
    const recalc = async () => {
      sync();
      const mine = ++token;
      await loadFoods(linkedIds(st.ingredients), usdaFoods, api.usdaFood);
      if (mine !== token) return;
      st.calc = recipeCalc(st.ingredients, usdaFoods, readNumber(form.elements.servings.value, 1));
      showSource();
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(recalc, 150); };

    const sync = () => {
      box.querySelectorAll('[data-ing]').forEach((row) => {
        const cur = st.ingredients[Number(row.dataset.ing)];
        cur.item = row.querySelector('[data-f="item"]').value;
        cur.unit = row.querySelector('[data-f="unit"]').value;
        cur.section = row.querySelector('[data-f="section"]').value;
        cur.amount = readNumber(row.querySelector('[data-f="amount"]').value, cur.amount);
      });
      box.querySelectorAll('[data-step]').forEach((ta) => { st.steps[Number(ta.dataset.step)].text = ta.value; });
    };
    const draw = () => {
      box.innerHTML = `<h3 class="sub-h">Ingredients</h3>
        <div class="item-row head ing-row"><span>Item</span><span>Amount</span><span>Unit</span><span>Section</span><span>USDA</span><span></span></div>
        ${st.ingredients.map((ing, i) => ingredientRow(ing, i, st.linking === i)).join('')}
        <div><button type="button" data-add-ing>+ Ingredient</button></div>
        <h3 class="sub-h">Steps</h3>
        ${st.steps.map((s, i) => `<div class="item-row step-row"><textarea rows="2" data-step="${i}" placeholder="Step ${i + 1}" aria-label="Step ${i + 1}">${esc(s.text)}</textarea>
          <button type="button" data-rm-step="${i}" aria-label="Remove step ${i + 1}">✕</button></div>`).join('')}
        <div><button type="button" data-add-step>+ Step</button></div>`;
      box.querySelector('[data-add-ing]').addEventListener('click', () => { sync(); st.ingredients.push({ item: '', amount: null, unit: '', section: 'produce' }); draw(); });
      box.querySelector('[data-add-step]').addEventListener('click', () => { sync(); st.steps.push({ orig: '', text: '' }); draw(); });
      box.querySelectorAll('[data-rm-ing]').forEach((b) => b.addEventListener('click', () => {
        sync();
        const n = Number(b.dataset.rmIng);
        st.ingredients.splice(n, 1);
        if (st.linking === n) st.linking = null; else if (st.linking > n) st.linking -= 1;
        draw();
        recalc();
      }));
      box.querySelectorAll('[data-rm-step]').forEach((b) => b.addEventListener('click', () => { sync(); st.steps.splice(Number(b.dataset.rmStep), 1); draw(); }));
      box.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', () => { sync(); st.linking = Number(b.dataset.link); draw(); }));
      box.querySelectorAll('[data-unlink]').forEach((b) => b.addEventListener('click', () => {
        sync();
        delete st.ingredients[Number(b.dataset.unlink)].usda_id;
        draw();
        recalc();
      }));
      const linkBox = box.querySelector('[data-linkbox]');
      if (linkBox) {
        const n = Number(linkBox.dataset.linkbox);
        const q = linkBox.querySelector('[data-link-q]');
        linkBox.querySelector('[data-link-cancel]').addEventListener('click', () => { st.linking = null; draw(); });
        attachFoodPicker(q, {
          filter: (f) => f.source === 'usda',
          onPick: (food) => {
            usdaFoods.set(String(food.id), food);
            sync();
            st.ingredients[n].usda_id = food.id;
            st.linking = null;
            draw();
            recalc();
          },
        });
        q.focus();
        q.select();
        q.dispatchEvent(new Event('input'));
      }
    };
    draw();
    box.addEventListener('input', (ev) => { if (ev.target.closest('[data-ing]')) soon(); });
    form.elements.servings.addEventListener('input', soon);
    // What the per-serving boxes hold while Manual, so switching to Calculated can ask first.
    const remember = () => {
      if (sourceSel.value === 'manual') st.typed = Object.fromEntries(PER_SERVING_KEYS.map((k, n) => [k, psInputs[n].value.trim() === '' ? null : Number(psInputs[n].value)]));
    };
    psInputs.forEach((input) => input.addEventListener('input', remember));
    sourceSel.addEventListener('change', async () => {
      if (sourceSel.value !== 'usda') { showSource(); remember(); return; }
      const typed = st.typed;
      await recalc(); // writes the calculated numbers into the boxes
      if (!st.calc) return;
      if (!sameNumbers(typed, st.calc.per_serving) && !confirm('Replace the numbers you typed with the ones calculated from the ingredients?')) {
        sourceSel.value = 'manual';
        PER_SERVING_KEYS.forEach((k, n) => { psInputs[n].value = typed[k] ?? ''; });
        showSource();
      }
    });
    remember();
    showSource();
    recalc();

    return () => {
      sync();
      const ingredients = st.ingredients.filter((x) => String(x.item ?? '').trim()).map((x) => {
        const out = { ...x, item: String(x.item).trim(), unit: String(x.unit ?? '').trim() };
        if (typeof out.amount === 'number' && (!Number.isFinite(out.amount) || out.amount < 0)) throw new Error(`${out.item}: amount can't be negative.`);
        if (out.amount === null) delete out.amount;
        return out;
      });
      const steps = st.steps.filter((s) => s.text.trim()).map((s) => (isObj(s.orig) ? { ...s.orig, text: s.text.trim() } : s.text.trim()));
      if (!ingredients.length) throw new Error('Add at least one ingredient.');
      if (!steps.length) throw new Error('Add at least one step.');
      return { ingredients, steps };
    };
  };
}

function withoutFatKcal(per) {
  const { fat, kcal, ...rest } = per || {};
  return rest;
}

function recipeForm(recipe, dietNames, done) {
  const isNew = !recipe;
  const base = clean(recipe || { name: '', servings: 2, ingredients: [{ item: '', amount: null, unit: '', section: 'produce' }], steps: [''] });
  const per = base.per_serving || {};
  const f = (name, label, ph) => ({ name, label, type: 'number', min: 0, step: 'any', placeholder: ph });
  openForm({
    title: isNew ? 'New recipe' : 'Edit recipe',
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'servings', label: 'Servings', type: 'number', min: 0.5, step: '0.5', placeholder: 'e.g. 2', required: true },
      f('prep_minutes', 'Prep minutes', 'e.g. 10'),
      f('cook_minutes', 'Cook minutes', 'e.g. 20'),
      { name: 'diets', label: 'Diets', type: 'tags', options: dietNames, raw: true },
      { name: 'tags', label: 'Food tags', type: 'tags', options: FOOD_TAGS },
      { name: 'meal_prep', label: 'Good for meal prep?', type: 'select', options: [['no', 'No'], ['yes', 'Yes']] },
      { name: 'ps_source', label: 'Nutrition per serving', type: 'select', options: SOURCE_OPTIONS },
      f('ps_net_carbs', 'Net carbs per serving (g)', 'e.g. 6'),
      f('ps_protein', 'Protein per serving (g)', 'e.g. 34'),
      f('ps_fiber', 'Fiber per serving (g)', 'e.g. 4'),
      f('ps_fat', 'Fat per serving (g)', 'e.g. 12'),
      f('ps_kcal', 'Calories per serving (kcal)', 'e.g. 350'),
    ],
    values: {
      ...base,
      meal_prep: base.meal_prep === true ? 'yes' : 'no',
      // A recipe saved before this choice existed has typed numbers; a new one starts calculated.
      ps_source: base.per_serving_source === 'usda' || (isNew && base.per_serving_source === undefined) ? 'usda' : 'manual',
      ps_net_carbs: per.net_carbs, ps_protein: per.protein, ps_fiber: per.fiber, ps_fat: per.fat, ps_kcal: per.kcal,
    },
    extra: recipeEditorExtra(base),
    confirmDelete: 'Move this recipe to .trash?',
    onDelete: !isNew && (() => deleteRecipe(recipe, done)),
    onSave: async (v) => {
      if (!(v.servings >= 0.5)) throw new Error('Servings must be 0.5 or more.');
      const calculated = v.ps_source === 'usda';
      for (const [k, label] of [['prep_minutes', 'Prep minutes'], ['cook_minutes', 'Cook minutes'], ['ps_net_carbs', 'Net carbs'], ['ps_protein', 'Protein'], ['ps_fiber', 'Fiber'], ['ps_fat', 'Fat'], ['ps_kcal', 'Calories']]) {
        if (!(calculated && k.startsWith('ps_')) && v[k] !== null && !(v[k] >= 0)) throw new Error(`${label} can't be negative.`);
      }
      let perServing;
      if (calculated) {
        // Worked out again at save time from what's in the form, never from the boxes.
        const ids = linkedIds(v.ingredients);
        await loadFoods(ids, usdaFoods, api.usdaFood);
        const missing = v.ingredients.filter((i) => isLinked(i) && !usdaFoods.has(String(i.usda_id).trim())).map((i) => i.item);
        if (missing.length) throw new Error(`Couldn't load the USDA food for ${missing.join(', ')}. Try again, or switch to Manual.`);
        const calc = recipeCalc(v.ingredients, usdaFoods, v.servings);
        const left = uncountedLinked(calc);
        if (left.length && !confirm(`Not counted: ${uncountedText(left)}. Save anyway?`)) throw new Error('Not saved. Fix the amount or unit, unlink it, or switch to Manual.');
        if (calc.matched === 0 && !confirm('No ingredients are linked, so the numbers will be 0. Save anyway?')) throw new Error('Not saved. Link an ingredient, or switch to Manual.');
        perServing = withCalculated(per, calc);
      } else {
        perServing = { ...withoutFatKcal(per), net_carbs: v.ps_net_carbs ?? 0, protein: v.ps_protein ?? 0, fiber: v.ps_fiber ?? 0, ...(v.ps_fat != null ? { fat: v.ps_fat } : {}), ...(v.ps_kcal != null ? { kcal: v.ps_kcal } : {}) };
      }
      const hasNote = base.note !== undefined && base.note !== null && base.note !== '';
      // Keep the recipe's own note; the two built-in lines follow the source.
      let note = hasNote ? base.note : ESTIMATE_NOTE;
      if (calculated && note === ESTIMATE_NOTE) note = USDA_NOTE;
      if (!calculated && note === USDA_NOTE) note = ESTIMATE_NOTE;
      const item = {
        ...base,
        name: v.name,
        servings: v.servings,
        prep_minutes: v.prep_minutes ?? 0,
        cook_minutes: v.cook_minutes ?? 0,
        diets: v.diets,
        tags: v.tags,
        meal_prep: v.meal_prep === 'yes',
        per_serving: perServing,
        per_serving_source: calculated ? 'usda' : 'manual',
        ingredients: v.ingredients,
        steps: v.steps,
        starter: false,
        note,
      };
      delete item.ps_source;
      delete item.id;
      delete item.broken;
      const oldName = isNew ? '' : String(recipe.name ?? '').trim();
      const renamed = !isNew && oldName && oldName !== String(v.name).trim();
      let rename = null;
      if (renamed) {
        const uses = await recipeUses(oldName);
        if (uses.meals && confirm(`Update ${plural(uses.meals, 'planned meal', 'planned meals')} in ${plural(uses.hits.length, 'week', 'weeks')} to the new name?`)) rename = uses.hits;
      }
      await attempt(async () => {
        if (isNew) return api.createItem('recipes', item);
        try {
          // The version the page read; the server refuses the save if the note changed since.
          return await api.updateItem('recipes', recipe.id, { ...item, expected_version: recipe.version ?? 'none' });
        } catch (e) {
          if (e.stale) throw new Error('This recipe changed in another window. Close and reopen it.');
          throw e;
        }
      }, 'Recipe saved');
      if (rename) {
        // Each week is read fresh and rewritten on its own, so one bad week doesn't stop the rest.
        const failed = [];
        for (const { monday } of rename) {
          try {
            await changePlan(monday, (p) => renameRecipeInPlan(p, oldName, item.name).plan);
          } catch (e) {
            failed.push(shortDate(monday));
          }
        }
        if (failed.length) toast(`Couldn't update the plan for the week of ${failed.join(', ')}.`, true);
        else toast('Recipe saved and plans updated');
      }
      done();
    },
  });
}

// Throws on failure (after the toast), so the recipe dialog stays open.
async function copyRecipe(r, done) {
  const copy = { ...r };
  delete copy.id;
  delete copy.broken;
  await attempt(() => api.createItem('recipes', { ...copy, name: `${r.name} (copy)`, starter: false }), 'Recipe copied');
  done();
}

// The recipe's own note, plus the estimates line when the note says something else.
function noteLines(note) {
  const text = typeof note === 'string' ? note.trim() : note === undefined || note === null ? '' : JSON.stringify(note);
  const lines = text ? [text] : [];
  if (text !== ESTIMATE_NOTE && text !== USDA_NOTE) lines.push(ESTIMATE_NOTE);
  return lines.map((l) => `<p class="muted">${esc(l)}</p>`).join('');
}

function viewRecipe(r, dietNames, done) {
  const per = r.per_serving;
  const form = openForm({
    title: r.name || r.id,
    fields: [],
    values: {},
    confirmDelete: 'Move this recipe to .trash?',
    onDelete: () => deleteRecipe(r, done),
    onSave: async () => {},
    extra: (box) => {
      box.innerHTML = `<p class="muted">Serves ${esc(r.servings ?? '?')} · ${esc(num(r.prep_minutes))} min prep · ${esc(num(r.cook_minutes))} min cook</p>
        <p>${esc(num(per.net_carbs))} g net carbs · ${esc(num(per.protein))} g protein · ${esc(num(per.fiber))} g fiber${per.fat != null ? ` · ${esc(num(per.fat))} g fat` : ''}${per.kcal != null ? ` · ${esc(num(per.kcal))} kcal` : ''} <span class="muted">per serving</span></p>
        ${r.per_serving_source === 'usda' ? '<p class="muted calc-line" data-calc>Calculated from ingredients…</p>' : ''}
        <div>${r.diets.map((d) => `<span class="tag">${esc(d)}</span>`).join('')}${r.meal_prep ? '<span class="tag starter">meal prep</span>' : ''}</div>
        <h3 class="sub-h">Ingredients</h3>
        <ul class="recipe-list">${r.ingredients.map((x) => `<li>${[x.amount, x.unit, x.item].filter((p) => p !== undefined && p !== null && p !== '').map(esc).join(' ')}</li>`).join('') || '<li class="muted">None</li>'}</ul>
        <h3 class="sub-h">Steps</h3>
        <ol class="recipe-list">${r.steps.map((s) => `<li>${esc(stepText(s))}</li>`).join('') || '<li class="muted">None</li>'}</ol>
        ${noteLines(r.note)}
        <div class="btns"><button type="button" class="primary" data-x="add">Add to week…</button><button type="button" data-x="edit">Edit</button><button type="button" data-x="copy">Copy</button></div>`;
      const line = box.querySelector('[data-calc]');
      if (line) {
        // textContent, so names from the note can't become markup.
        loadFoods(linkedIds(r.ingredients), usdaFoods, api.usdaFood)
          .then(() => { line.textContent = calcSummary(recipeCalc(r.ingredients, usdaFoods, r.servings)); })
          .catch(() => {});
      }
      box.querySelector('[data-x="add"]').addEventListener('click', () => addToWeekForm(r, done));
      box.querySelector('[data-x="edit"]').addEventListener('click', () => recipeForm(r, dietNames, done));
      box.querySelector('[data-x="copy"]').addEventListener('click', async (ev) => {
        const err = ev.target.closest('form').querySelector('.err');
        try {
          await copyRecipe(r, done);
        } catch (e) {
          err.textContent = e.message;
          err.hidden = false;
          return;
        }
        document.getElementById('modal').close();
      });
    },
  });
  form.querySelector('button[type="submit"]').hidden = true;
  form.querySelector('[data-act="cancel"]').textContent = 'Close';
}

// ---------- recipes tab ----------

function recipeCards(recipes, query) {
  const q = query.q.trim().toLowerCase();
  const shown = recipes.filter((r) => !r.broken
    && (!q || r.name.toLowerCase().includes(q))
    && (!query.diet || r.diets.includes(query.diet))
    && (!query.prepOnly || r.meal_prep === true));
  const broken = recipes.filter((r) => r.broken).map((r) => `<div class="card error recipe-card static"><b>${esc(r.id)}</b> <span class="tag">needs repair</span>
    <p class="muted">This note cannot be read. Fix its frontmatter by hand.</p></div>`);
  const cards = shown.map((r) => {
    const per = r.per_serving;
    return `<button type="button" class="card recipe-card" data-recipe="${esc(r.id)}">
      <b>${esc(r.name || r.id)}</b>
      <span class="muted">${esc(num(r.prep_minutes) + num(r.cook_minutes))} min</span>
      <span>${esc(num(per.net_carbs))} g net carbs · ${esc(num(per.protein))} g protein · ${esc(num(per.fiber))} g fiber${per.fat != null ? ` · ${esc(num(per.fat))} g fat` : ''}${per.kcal != null ? ` · ${esc(num(per.kcal))} kcal` : ''}</span>
      <span>${r.diets.map((d) => `<span class="tag">${esc(d)}</span>`).join('')}${r.meal_prep ? '<span class="tag starter">meal prep</span>' : ''}</span>
    </button>`;
  });
  if (!cards.length && !broken.length) return '<p class="muted">No recipes match. Change the filters or add one with + Recipe.</p>';
  return cards.concat(broken).join('');
}

// "Update starter recipes' nutrition": starters seeded before the food database came along get the
// built-in USDA links and calculated numbers. Each save goes through the normal recipe update, so a
// note whose text was edited by hand is copied to .trash first, and it sends the version it read, so
// a recipe changed in another window since is refused rather than overwritten.
async function updateStarterNutrition(shownRecipes, refresh) {
  const shown = starterTargets(shownRecipes);
  if (!shown.length) { toast('No starter recipes to update.'); return; }
  if (!confirm(`Recalculate the nutrition of ${plural(shown.length, 'starter recipe', 'starter recipes')} from USDA foods? Recipes you've edited or set to Manual are left alone. A recipe note whose text was edited by hand is copied to .trash first.`)) return;
  let fresh;
  let starters;
  try {
    // Read again after the question: the page may be old, or another window may have saved since.
    [fresh, starters] = await Promise.all([api.items('recipes'), api.starterRecipes()]);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const targets = starterTargets(fresh);
  const byName = new Map((Array.isArray(starters) ? starters : []).filter((x) => x && typeof x.name === 'string').map((x) => [x.name.trim().toLowerCase(), x]));
  const starterOf = (r) => byName.get(String(r.name ?? '').trim().toLowerCase()) || null;
  const ids = new Set(targets.flatMap((r) => linkedIds(relinkIngredients(r.ingredients, starterOf(r)))));
  await loadFoods([...ids], usdaFoods, api.usdaFood);
  // A food that didn't load shows as "food not found" in updatedStarter, which skips only the
  // recipes that use it; the rest still update.
  let changed = 0;
  const skipped = [];
  const failed = [];
  for (const r of targets) {
    const name = String(r.name ?? r.id);
    const out = updatedStarter(r, starterOf(r), usdaFoods);
    if (!out) continue;
    if (out.skip) { skipped.push(`${name} (${out.skip})`); continue; }
    try {
      await api.updateItem('recipes', r.id, { ...out.recipe, expected_version: r.version ?? 'none' });
      changed += 1;
    } catch (e) {
      failed.push(`${name} (${e.stale ? 'changed in another window' : e.message})`);
    }
  }
  const parts = [changed ? `Updated ${plural(changed, 'starter recipe', 'starter recipes')}.` : (skipped.length || failed.length ? 'No starter recipes were updated.' : 'Starter recipes were already up to date.')];
  if (skipped.length) parts.push(`Skipped: ${skipped.join(', ')}.`);
  if (failed.length) parts.push(`Couldn't save: ${failed.join(', ')}.`);
  toast(parts.join(' '), skipped.length + failed.length > 0);
  refresh();
}

function recipesTab(main, {
  recipes, rawRecipes, diets, brokenDiets, refresh,
}) {
  const dietNames = diets.map((d) => d.name || d.id);
  const canUpdate = starterTargets(rawRecipes).length > 0;
  const box = main.querySelector('#tab');
  box.innerHTML = `<div class="head">
      <input type="search" id="rq" class="grow-in" placeholder="Search recipes" aria-label="Search recipes" value="${esc(filters.q)}">
      <select id="rd" aria-label="Filter by diet" class="move-pick"><option value="">All diets</option>${dietNames.map((n) => `<option value="${esc(n)}"${filters.diet === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="rp"${filters.prepOnly ? ' checked' : ''}> Meal prep only</label>
      <span class="grow"></span><button type="button" class="primary" id="new-recipe">+ Recipe</button>
    </div>
    <div class="recipe-grid" id="recipe-grid">${recipeCards(recipes, filters)}</div>
    ${brokenDiets.length ? `<p class="muted">Diet notes that need repair: ${brokenDiets.map((d) => esc(d.id)).join(', ')}</p>` : ''}
    ${canUpdate ? `<p class="starter-update"><button type="button" id="update-starters">Update starter recipes' nutrition</button>
      <span class="muted">Works out the starter recipes' numbers from USDA foods.</span></p>` : ''}`;
  const grid = box.querySelector('#recipe-grid');
  const byId = new Map(recipes.map((r) => [String(r.id), r]));
  // Filtering swaps only the grid, so the search box keeps focus while typing.
  const redraw = () => { grid.innerHTML = recipeCards(recipes, filters); };
  box.querySelector('#rq').addEventListener('input', (e) => { filters.q = e.target.value; redraw(); });
  box.querySelector('#rd').addEventListener('change', (e) => { filters.diet = e.target.value; redraw(); });
  box.querySelector('#rp').addEventListener('change', (e) => { filters.prepOnly = e.target.checked; redraw(); });
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-recipe]');
    const r = card && byId.get(card.dataset.recipe);
    if (r) viewRecipe(r, dietNames, refresh);
  });
  box.querySelector('#new-recipe').addEventListener('click', () => recipeForm(null, dietNames, refresh));
  const update = box.querySelector('#update-starters');
  update?.addEventListener('click', async () => {
    update.disabled = true;
    try {
      await updateStarterNutrition(rawRecipes, refresh);
    } finally {
      update.disabled = false;
    }
  });
}

// ---------- week tab ----------

function pickRecipeForm(date, slot, recipes, done) {
  const names = recipes.filter((r) => !r.broken && r.name).map((r) => r.name);
  openForm({
    title: `Add to ${SLOT_LABELS[slot]} · ${shortDate(date)}`,
    fields: [{ name: 'servings', label: 'Servings', type: 'number', min: 0.5, step: '0.5', placeholder: '1', default: 1 }],
    values: {},
    extra: (box) => {
      box.innerHTML = `<div class="form"><input type="search" data-q placeholder="Search recipes" aria-label="Search recipes">
        <select data-r size="6" aria-label="Recipe"></select></div>`;
      const sel = box.querySelector('[data-r]');
      const fill = () => {
        const q = box.querySelector('[data-q]').value.trim().toLowerCase();
        const keep = sel.value;
        sel.innerHTML = names.filter((n) => n.toLowerCase().includes(q)).map((n) => `<option value="${esc(n)}"${n === keep ? ' selected' : ''}>${esc(n)}</option>`).join('');
        if (!sel.value && sel.options.length) sel.selectedIndex = 0;
      };
      box.querySelector('[data-q]').addEventListener('input', fill);
      fill();
      return () => {
        if (!sel.value) throw new Error('Pick a recipe.');
        return { recipe: sel.value };
      };
    },
    onSave: async (v) => {
      const servings = v.servings === null ? 1 : v.servings;
      if (!(servings > 0)) throw new Error('Servings must be more than 0.');
      await changePlan(weekStart, (plan) => ({ ...plan, meals: [...plan.meals, { id: uid('p'), date, slot, recipe: v.recipe, servings }] }), 'Added to the plan');
      done();
    },
  });
}

function mealForm(plan, idx, dates, done) {
  const meal = plan.meals[idx];
  const target = { id: meal.id, index: idx };
  const options = dates.includes(meal.date) ? dates : [...dates, meal.date].filter((d) => typeof d === 'string');
  openForm({
    title: `${meal.recipe}`,
    fields: [
      { name: 'date', label: 'Day', type: 'select', options: options.map((d) => [d, `${weekdayShort(d)} ${shortDate(d)}`]) },
      { name: 'slot', label: 'Meal', type: 'select', options: SLOTS.map((s) => [s, SLOT_LABELS[s]]) },
      { name: 'servings', label: 'Servings', type: 'number', min: 0.5, step: '0.5', placeholder: '1' },
    ],
    values: { date: meal.date, slot: meal.slot, servings: servingsOf(meal) },
    confirmDelete: 'Remove this meal from the plan?',
    onDelete: async () => {
      await changePlan(weekStart, (p) => removeMealById(p, target), 'Removed from the plan');
      done();
    },
    onSave: async (v) => {
      if (!(v.servings > 0)) throw new Error('Servings must be more than 0.');
      await changePlan(weekStart, (p) => updateMealById(p, target, { date: v.date, slot: v.slot, servings: v.servings }), 'Meal updated');
      done();
    },
  });
}

function prepForm(plan, idx, dates, done) {
  const existing = idx === null ? null : plan.prep[idx];
  const target = existing ? { id: existing.id, index: idx } : null;
  const meals = plan.meals.filter((m) => isObj(m) && typeof m.id === 'string' && m.id);
  const covered = new Set(existing && Array.isArray(existing.meal_ids) ? existing.meal_ids : []);
  openForm({
    title: existing ? 'Edit prep day' : 'New prep day',
    fields: [
      { name: 'date', label: 'Day', type: 'date', required: true, default: dates[0] },
      { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'e.g. Cook salmon and egg muffins' },
    ],
    values: existing || {},
    confirmDelete: 'Delete this prep day?',
    onDelete: existing && (async () => {
      await changePlan(weekStart, (p) => removePrepById(p, target), 'Prep day deleted');
      done();
    }),
    extra: (box) => {
      box.innerHTML = `<fieldset class="prep-meals"><legend>Meals this prep day cooks</legend>${meals.length ? meals.map((m, i) => `<label class="check"><input type="checkbox" data-meal="${i}"${covered.has(m.id) ? ' checked' : ''}>
        ${esc(weekdayShort(m.date))} ${esc(SLOT_LABELS[m.slot] || m.slot || '')} · ${esc(m.recipe)}</label>`).join('') : '<span class="muted">Plan some meals first.</span>'}</fieldset>`;
      return () => ({ meal_ids: [...box.querySelectorAll('[data-meal]:checked')].map((c) => meals[Number(c.dataset.meal)].id) });
    },
    onSave: async (v) => {
      if (!existing && !dates.includes(v.date)) throw new Error('Pick a day in this week.');
      const entry = { ...(existing || { id: uid('q') }), date: v.date, meal_ids: v.meal_ids, notes: v.notes || '' };
      // Meals removed in another window are dropped from the prep day rather than put back.
      await changePlan(weekStart, (p) => savePrep(p, target, entry), 'Prep day saved');
      done();
    },
  });
}

function dayCard(date, i, ctx) {
  const {
    plan, recipes, goals, rules, today, foods,
  } = ctx;
  const entries = plan.meals.map((m, k) => ({ m, k })).filter(({ m }) => isObj(m) && m.date === date);
  const preps = plan.prep.map((q, k) => ({ q, k })).filter(({ q }) => isObj(q) && q.date === date);
  const prepFor = (id) => plan.prep.find((q) => isObj(q) && Array.isArray(q.meal_ids) && id && q.meal_ids.includes(id));
  const idx = recipeIndex(recipes);
  const slots = SLOTS.map((slot) => {
    const here = entries.filter(({ m }) => m.slot === slot);
    return `<div class="slot-box"><div class="slot-head"><span class="slot">${esc(SLOT_LABELS[slot])}</span>
        <button type="button" class="mini" data-add="${esc(date)}|${slot}" aria-label="Add ${esc(SLOT_LABELS[slot])} on ${esc(shortDate(date))}">+</button></div>
      ${here.map(({ m, k }) => {
    const p = prepFor(m.id);
    const known = idx.has(String(m.recipe ?? '').trim().toLowerCase());
    return `<button type="button" class="meal-chip${known ? '' : ' missing'}" data-meal="${k}">${esc(m.recipe)} ×${esc(nice(servingsOf(m)))}${p ? `<small class="prepped">prepped ${esc(weekdayShort(p.date))}</small>` : ''}</button>`;
  }).join('')}</div>`;
  }).join('');
  let totals = '';
  if (entries.length) {
    const t = plannedDayTotals(plan, recipes, date);
    const carbOver = goals.net_carb_max != null && t.net_carbs > goals.net_carb_max;
    const protLow = goals.protein_min != null && t.protein < goals.protein_min;
    const fiberLow = goals.fiber_min != null && t.fiber < goals.fiber_min;
    const flags = dietFlags({ time: '', items: entries.map(({ m }) => ({ food: m.recipe })) }, { diet: rules.diet, addOn: rules.addOn, foods, recipes });
    totals = `<p class="day-totals">Planned: <span class="${carbOver ? 'warn' : ''}">${esc(t.net_carbs)} g net carbs / ${esc(goals.net_carb_max ?? '—')}</span> ·
      <span class="${protLow ? 'warn' : ''}">${esc(t.protein)} g protein / ${esc(goals.protein_min ?? '—')}</span> ·
      <span class="${fiberLow ? 'warn' : ''}">${esc(t.fiber)} g fiber / ${esc(goals.fiber_min ?? '—')}</span>${t.kcal ? ` · ${esc(t.kcal)} kcal` : ''}</p>
      ${flags.map((f) => `<p class="flag">${esc(f)}</p>`).join('')}`;
  }
  return `<div class="day${date === today ? ' today' : ''}">
    <div class="day-head"><b>${esc(DAY_LABELS[WEEK_ORDER[i]])}</b> <small class="muted">${esc(shortDate(date))}</small></div>
    ${preps.map(({ q, k }) => `<button type="button" class="prep-banner" data-prep="${k}">🥘 Prep: ${esc(q.notes || 'no notes')}</button>`).join('')}
    ${slots}${totals}</div>`;
}

async function weekTab(main, ctx) {
  const {
    plan, recipes, refresh,
  } = ctx;
  const dates = WEEK_ORDER.map((_, i) => addDaysIso(weekStart, i));
  const outside = plan.prep.map((q, k) => ({ q, k })).filter(({ q }) => isObj(q) && !dates.includes(q.date));
  const outsideMeals = plan.meals.map((m, k) => ({ m, k })).filter(({ m }) => isObj(m) && !dates.includes(m.date));
  const toCopy = ctx.prevPlan ? copyWeekMeals(ctx.prevPlan, plan, () => '').added : 0;
  const box = main.querySelector('#tab');
  box.innerHTML = `<div class="head">
      <button type="button" data-wk="-7" aria-label="Previous week">◀</button>
      <h2 class="week-title">Week of ${esc(prettyDate(weekStart))}</h2>
      <button type="button" data-wk="7" aria-label="Next week">▶</button>
      <span class="grow"></span>
      ${toCopy ? '<button type="button" id="copy-last">Copy last week</button>' : ''}
      <button type="button" class="primary" id="new-prep">+ Prep day</button>
    </div>
    <div class="meal-week">${dates.map((d, i) => dayCard(d, i, ctx)).join('')}</div>
    ${outsideMeals.length ? `<section class="card outside-week"><h3 class="sub-h">Outside this week</h3>
      <p class="muted">These meals are saved in this week's plan but dated another week.</p>
      <ul class="list">${outsideMeals.map(({ m, k }) => `<li><span class="what">${esc(typeof m.date === 'string' ? m.date : '(no date)')} · ${esc(SLOT_LABELS[m.slot] || m.slot || '')} · ${esc(m.recipe ?? '')}</span>
        <button type="button" class="mini" data-rm-meal="${k}" aria-label="Remove ${esc(m.recipe ?? 'meal')}">Remove</button></li>`).join('')}</ul></section>` : ''}
    ${outside.length ? `<p class="muted">Prep days outside this week: ${outside.map(({ q, k }) => `<button type="button" class="mini" data-prep="${k}">${esc(shortDate(String(q.date)))} ${esc(q.notes || '')}</button>`).join(' ')}</p>` : ''}
    ${ctx.missing.length ? `<p class="muted">These planned recipes aren't in Recipes anymore: ${ctx.missing.map(esc).join(', ')}</p>` : ''}`;
  box.querySelectorAll('[data-wk]').forEach((b) => b.addEventListener('click', () => goWeek(Number(b.dataset.wk), refresh)));
  const copy = box.querySelector('#copy-last');
  if (copy) {
    copy.addEventListener('click', async () => {
      if (!confirm(`Add ${plural(toCopy, 'meal', 'meals')} from last week to this week? Meals already planned stay.`)) return;
      copy.disabled = true;
      try {
        const prev = await api.mealPlan(addDaysIso(weekStart, -7));
        await changePlan(weekStart, (p) => {
          const { plan: next, added } = copyWeekMeals(prev, p, () => uid('p'));
          if (!added) throw new Error("This week already has all of last week's meals.");
          return next;
        }, 'Copied last week');
      } catch (e) {
        toast(e.message, true);
        copy.disabled = false;
        return;
      }
      refresh();
    });
  }
  box.querySelectorAll('[data-rm-meal]').forEach((b) => b.addEventListener('click', async () => {
    const { m, k } = outsideMeals.find((x) => x.k === Number(b.dataset.rmMeal));
    if (!confirm(`Remove ${m.recipe ?? 'this meal'} from the plan?`)) return;
    try {
      await changePlan(weekStart, (p) => removeMealById(p, { id: m.id, index: k }), 'Removed from the plan');
    } catch (e) {
      toast(e.message, true);
    }
    refresh();
  }));
  box.querySelector('#new-prep').addEventListener('click', () => prepForm(plan, null, dates, refresh));
  box.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const [date, slot] = b.dataset.add.split('|');
    pickRecipeForm(date, slot, recipes, refresh);
  }));
  box.querySelectorAll('[data-meal]').forEach((b) => b.addEventListener('click', () => mealForm(plan, Number(b.dataset.meal), dates, refresh)));
  box.querySelectorAll('[data-prep]').forEach((b) => b.addEventListener('click', () => prepForm(plan, Number(b.dataset.prep), dates, refresh)));
}

// ---------- shopping tab ----------

function amountText(row) {
  if (row.amount === null) return `${esc(row.item)} <span class="muted">(as needed)</span>`;
  return `<b>${esc(friendlyAmount(row.amount, row.unit))}</b> ${esc(row.item)}`;
}

function shoppingTab(main, ctx) {
  const { plan, recipes, refresh } = ctx;
  const monday = weekStart;
  const list = shoppingList(plan, recipes);
  // Every extra has an id (normalizePlan gives old ones x-legacy-<hash>), so rows are addressed by id.
  const extrasIn = (section) => list.extras.filter((x) => (SECTIONS.includes(x.section) ? x.section : 'other') === section);
  const cards = SECTIONS.map((section) => {
    const items = (list.sections.find((s) => s.section === section) || { items: [] }).items;
    const extras = extrasIn(section);
    if (!items.length && !extras.length) return '';
    return `<section class="card shop-card"><h2>${esc(section)}</h2>
      ${items.map((it) => `<label class="check shop-row${it.checked ? ' done' : ''}" data-key-row${it.checked && hideTicked ? ' hidden' : ''}>
        <input type="checkbox" data-key="${esc(it.key)}"${it.checked ? ' checked' : ''}><span>${amountText(it)}${it.recipes.length ? ` <small class="muted">${it.recipes.map(esc).join(', ')}</small>` : ''}</span></label>`).join('')}
      ${extras.map((x) => `<div class="check shop-row${x.checked ? ' done' : ''}"${x.checked && hideTicked ? ' hidden' : ''}>
        <label class="check"><input type="checkbox" data-extra-tick="${esc(x.id)}"${x.checked ? ' checked' : ''}><span>${esc(x.item)}</span></label>
        <button type="button" class="mini" data-extra-rm="${esc(x.id)}" aria-label="Remove ${esc(x.item)}">✕</button></div>`).join('')}
    </section>`;
  }).join('');
  const box = main.querySelector('#tab');
  box.innerHTML = `<div class="head"><h2 class="week-title">Shopping for the week of ${esc(shortDate(weekStart))}</h2><span class="grow"></span>
      <button type="button" id="hide-ticked" class="${hideTicked ? 'on' : ''}">Hide ticked</button>
      <button type="button" id="print">Print</button></div>
    ${list.missing.length ? `<p class="warn">These planned recipes aren't in Recipes anymore: ${list.missing.map(esc).join(', ')}</p>` : ''}
    <form class="card extras-form" id="extra-form">
      <input id="extra-item" placeholder="Add something else to buy" aria-label="Extra item">
      <select id="extra-section" aria-label="Store section">${SECTIONS.map((s) => `<option value="${esc(s)}"${s === 'other' ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <button type="submit" class="primary">Add</button></form>
    <div class="shop-grid">${cards || '<p class="muted">Nothing to buy yet. Plan some meals on the This week tab, or add an extra above.</p>'}</div>`;

  // Saves run one after another. Each reads the plan fresh from disk and applies only its own
  // change, so quick clicks, the Week tab or another window can't be overwritten.
  let chain = Promise.resolve();
  const update = (build) => {
    const run = chain.then(() => attempt(() => changePlan(monday, build)));
    chain = run.catch(() => {});
    return run;
  };
  box.querySelector('#hide-ticked').addEventListener('click', () => { hideTicked = !hideTicked; refresh(); });
  box.querySelector('#print').addEventListener('click', () => window.print());
  // Ticking updates the row in place: a full redraw would jump the page.
  const mark = (input) => {
    const row = input.closest('.shop-row');
    row.classList.toggle('done', input.checked);
    row.hidden = input.checked && hideTicked;
  };
  box.querySelectorAll('[data-key]').forEach((input) => input.addEventListener('change', () => {
    const { key } = input.dataset;
    const on = input.checked;
    mark(input);
    update((p) => toggleChecked(p, key, on)).catch(() => { input.checked = !on; mark(input); });
  }));
  box.querySelectorAll('[data-extra-tick]').forEach((input) => input.addEventListener('change', () => {
    const id = input.dataset.extraTick;
    const on = input.checked;
    mark(input);
    // An extra that is gone from the note throws; the toast says so and the page reloads the list.
    update((p) => toggleExtra(p, id, on)).catch(() => refresh());
  }));
  box.querySelectorAll('[data-extra-rm]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.extraRm;
    await update((p) => removeExtra(p, id)).catch(() => {});
    refresh();
  }));
  box.querySelector('#extra-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const item = box.querySelector('#extra-item').value.trim();
    if (!item) return;
    const extra = { id: uid('x'), item, section: box.querySelector('#extra-section').value, checked: false };
    await update((p) => addExtra(p, extra)).catch(() => {});
    focusExtra = true;
    refresh();
  });
  if (focusExtra) { focusExtra = false; box.querySelector('#extra-item').focus(); }
}

// ---------- page ----------

export async function render(main, { arg, refresh }) {
  if (TABS.some(([k]) => k === arg)) tab = arg;
  if (!navigated) weekStart = mondayOf(isoDate());
  const [rawRecipes, rawDiets, goals, foods] = await Promise.all([
    api.items('recipes'), api.items('diets').catch(() => []), api.doc('goals'),
    tab === 'week' ? api.items('foods').catch(() => []) : Promise.resolve([]),
  ]);
  const recipes = rawRecipes.map(clean);
  const allDiets = Array.isArray(rawDiets) ? rawDiets : [];
  const diets = allDiets.filter((d) => d && !d.broken);
  const brokenDiets = allDiets.filter((d) => d && d.broken);

  main.innerHTML = `<div class="head"><h1>Meals</h1></div>
    <div class="tabs" role="tablist">${TABS.map(([k, label]) => `<button type="button" role="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${esc(label)}</button>`).join('')}</div>
    <div id="tab"></div>`;
  main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    const target = `#/meals/${tab}`;
    if (location.hash === target) refresh(); else location.hash = target;
  }));

  if (tab === 'recipes') {
    recipesTab(main, {
      recipes, rawRecipes, diets, brokenDiets, refresh,
    });
    return;
  }

  // This week's and last week's plans load together. Last week's only decides whether
  // "Copy last week" shows, so a broken note there just hides the button.
  const [loaded, prevPlan] = await Promise.all([
    api.mealPlan(weekStart).then((p) => ({ plan: p }), (e) => ({ error: e.message })),
    tab === 'week' ? api.mealPlan(addDaysIso(weekStart, -7)).catch(() => null) : null,
  ]);
  let { plan } = loaded;
  try {
    if (loaded.error) throw new Error(loaded.error);
    const problem = planListProblem(plan);
    if (problem) throw new Error(problem);
  } catch (e) {
    main.querySelector('#tab').innerHTML = `<div class="head"><button type="button" data-wk="-7" aria-label="Previous week">◀</button><h2 class="week-title">Week of ${esc(prettyDate(weekStart))}</h2>
      <button type="button" data-wk="7" aria-label="Next week">▶</button></div><div class="card error"><p>${esc(e.message)}</p></div>`;
    main.querySelectorAll('[data-wk]').forEach((b) => b.addEventListener('click', () => goWeek(Number(b.dataset.wk), refresh)));
    return;
  }
  plan = normalizePlan(plan);
  const good = recipes.filter((r) => !r.broken);
  const byId = (id) => diets.find((d) => d.id === id) || null;
  const idx = recipeIndex(good);
  const missing = [...new Set(plan.meals.filter((m) => isObj(m) && typeof m.recipe === 'string' && m.recipe.trim() && !idx.has(m.recipe.trim().toLowerCase())).map((m) => m.recipe))];
  const ctx = {
    plan,
    recipes: good,
    goals,
    foods: (Array.isArray(foods) ? foods : []).filter((f) => f && !f.broken),
    rules: effectiveRules(byId(goals.diet), byId(goals.diet_add_on), goals.eating_window),
    prevPlan,
    today: isoDate(),
    missing,
    refresh,
  };
  if (tab === 'week') await weekTab(main, ctx); else shoppingTab(main, ctx);
}
