'use strict';
/*
 * Builds data/usda-foods.json from an unzipped USDA FoodData Central
 * "SR Legacy" CSV folder. Run by hand; the app never downloads anything.
 *   node tools/build-food-db.js <csvDir> [outFile]
 */
const fs = require('node:fs');
const path = require('node:path');

const NUTRIENTS = { 1008: 'kcal', 1003: 'protein', 1005: 'carbs', 1079: 'fiber', 1004: 'fat' };
const OZ_G = 28.35;
const HIGH_SUGAR_NET_CARBS = 12;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let pending = false; // a field has started on this row
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
      pending = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      pending = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (pending || field !== '') { row.push(field); rows.push(row); }
      row = [];
      field = '';
      pending = false;
    } else {
      field += c;
      pending = true;
    }
  }
  if (pending || field !== '') { row.push(field); rows.push(row); }
  return rows;
}

function readTable(dir, name) {
  const [header, ...rows] = parseCsv(fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, ''));
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const round1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const startsWith = (s, p) => s.startsWith(p);

function tagsFor(group, name, per100) {
  const g = String(group || '');
  const n = String(name || '');
  const p = per100 || {};
  const netCarbs = Math.max(0, (p.carbs || 0) - (p.fiber || 0));
  if (startsWith(g, 'Sausages and Luncheon Meats')) return ['meat', 'processed'];
  if (['Beef Products', 'Pork Products', 'Poultry Products'].includes(g) || startsWith(g, 'Lamb, Veal')) return ['meat'];
  if (startsWith(g, 'Finfish and Shellfish')) return ['fish'];
  // "Egg" or "Eggs" as the whole first word: Eggnog is a dairy drink.
  if (startsWith(g, 'Dairy and Egg')) return [/^eggs?\b/i.test(n) ? 'eggs' : 'dairy'];
  if (startsWith(g, 'Vegetables')) return ['vegetable'];
  if (startsWith(g, 'Fruits')) return netCarbs >= HIGH_SUGAR_NET_CARBS ? ['fruit', 'fruit-high-sugar'] : ['fruit'];
  if (startsWith(g, 'Legumes')) return ['legume'];
  if (startsWith(g, 'Cereal Grains')) return ['grain'];
  if (startsWith(g, 'Baked Products') || startsWith(g, 'Breakfast Cereals')) return ['grain', 'processed'];
  if (startsWith(g, 'Nut and Seed')) return [/seed/i.test(n) ? 'seed' : 'nut'];
  if (startsWith(g, 'Fats and Oils')) return ['oil'];
  if (startsWith(g, 'Sweets')) return ['sugar'];
  if (startsWith(g, 'Beverages')) return ['drink'];
  if (['Fast Foods', 'Meals, Entrees', 'Snacks', 'Restaurant Foods'].some((x) => startsWith(g, x))) return ['processed'];
  return [];
}

const fmtAmount = (a) => String(Math.round(a * 1000) / 1000);

function buildFoods(dir) {
  const groups = new Map(readTable(dir, 'food_category.csv').map((r) => [r.id, r.description]));
  const units = new Map(readTable(dir, 'measure_unit.csv').map((r) => [r.id, r.name]));

  const per100ById = new Map();
  for (const r of readTable(dir, 'food_nutrient.csv')) {
    const key = NUTRIENTS[r.nutrient_id];
    if (!key) continue;
    const amount = Number(r.amount);
    if (!Number.isFinite(amount)) continue;
    if (!per100ById.has(r.fdc_id)) per100ById.set(r.fdc_id, {});
    per100ById.get(r.fdc_id)[key] = amount;
  }

  const portionsById = new Map();
  const portionRows = readTable(dir, 'food_portion.csv')
    .sort((a, b) => Number(a.seq_num) - Number(b.seq_num));
  for (const r of portionRows) {
    const g = Number(r.gram_weight);
    const amount = Number(r.amount);
    if (!(g > 0) || !(amount > 0)) continue;
    const unit = units.get(r.measure_unit_id);
    const word = unit && unit !== 'undetermined' ? unit : (r.modifier || r.portion_description || '');
    const label = `${fmtAmount(amount)} ${word}`.trim();
    if (!word) continue;
    if (!portionsById.has(r.fdc_id)) portionsById.set(r.fdc_id, []);
    portionsById.get(r.fdc_id).push({ label, g: round2(g) });
  }

  const foods = [];
  for (const f of readTable(dir, 'food.csv')) {
    const n = per100ById.get(f.fdc_id) || {};
    if (!n.kcal && !n.protein) continue;
    const per100 = {
      kcal: round1(n.kcal || 0),
      protein: round1(n.protein || 0),
      carbs: round1(n.carbs || 0),
      fiber: round1(n.fiber || 0),
      fat: round1(n.fat || 0),
    };
    const group = groups.get(f.food_category_id) || '';
    const portions = [];
    const seen = new Set();
    for (const p of [...(portionsById.get(f.fdc_id) || []), { label: '100 g', g: 100 }, { label: '1 oz', g: OZ_G }]) {
      const k = p.label.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      portions.push(p);
    }
    foods.push({ id: Number(f.fdc_id), name: f.description, group, tags: tagsFor(group, f.description, per100), per100, portions });
  }
  return foods;
}

function writeFoods(foods, outFile) {
  const body = foods.map((f) => JSON.stringify(f)).join(',\n');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `[\n${body}\n]\n`);
}

module.exports = { parseCsv, buildFoods, tagsFor, writeFoods };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node tools/build-food-db.js <csvDir> [outFile]');
    process.exit(1);
  }
  const out = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'usda-foods.json'));
  const foods = buildFoods(path.resolve(dir));
  writeFoods(foods, out);
  console.log(`${foods.length} foods, ${(fs.statSync(out).size / 1024).toFixed(0)} KB -> ${out}`);
}
