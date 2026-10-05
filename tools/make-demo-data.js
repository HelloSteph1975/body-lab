'use strict';
/*
 * Fills a separate folder with about 8 weeks of made-up Body Lab data, for demos and screenshots.
 *   node tools/make-demo-data.js [folder] [--weeks 8] [--seed 45] [--end YYYY-MM-DD]
 *   node tools/make-demo-data.js [folder] --check    only say whether the folder may be used
 * The folder defaults to dev\body-lab-demo in your home folder. The dates end today unless --end
 * is given, and the same seed always gives the same notes.
 * Everything is written through lib/store.js, so every note is one the app wrote itself.
 * It only writes to a folder that is missing, empty, or has the .body-lab-demo marker it wrote
 * itself, so it can't touch real data. Running it again on a demo folder rebuilds it.
 * The person is made up: a woman over 45 with prediabetes, low-carb eating, walks after meals, a
 * starter workout program and weekly GLP-1 shots. None of it is advice.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createStore } = require('../lib/store');
const { MARKER, MARKER_TEXT, folderState } = require('../lib/demo-marker');

// What a rebuild clears: only things the app or this tool make. Anything else is left alone.
// Backups goes first: a running demo server holds it open, so a busy rebuild stops before deleting anything else.
const DEMO_ITEMS = ['Backups', 'Days', 'Foods', 'Labs', 'Library', 'Meal plans', 'Programs', 'Diets', 'Recipes', '.trash',
  'Goals.md', 'Phases.md', 'How to add things.md'];
const DEFAULT_FOLDER = path.join(os.homedir(), 'dev', 'body-lab-demo');
const PUBLIC = path.join(__dirname, '..', 'public');
const FOODS_FILE = path.join(__dirname, '..', 'data', 'usda-foods.json');

const PROGRAM = 'Beginner Bodyweight';
const DIET = 'Low carb or keto';
const MEDICATION = 'Semaglutide';
const SHOT_DAY = 4; // Thursday
const IDEAL_WEIGHT = 175;
const START_WEIGHT = 199.8;

// ---------- seeded randomness ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomTools(seed) {
  const next = mulberry32(seed);
  const r = {
    next,
    between: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    // Roughly bell-shaped noise with the given spread.
    noise: (spread) => ((next() + next() + next()) / 3 - 0.5) * 2 * spread,
  };
  r.time = (from, to) => {
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    const m = r.int(fh * 60 + fm, th * 60 + tm);
    return clock(m);
  };
  return r;
}

// ---------- dates (UTC midnights, so no time-zone drift) ----------

const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const fromNum = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const addDays = (iso, n) => fromNum(dayNum(iso) + n);
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const mondayOf = (iso) => addDays(iso, -((weekday(iso) + 6) % 7));
const pad = (n) => String(n).padStart(2, '0');
const localToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (minutes) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const minutesOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const later = (t, a, b, rnd) => clock(minutesOf(t) + rnd.int(a, b));
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isValidDate = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(dayNum(iso)) && fromNum(dayNum(iso)) === iso;

// ---------- the folder ----------

// 'missing', 'empty' or 'demo' (folderState in lib/demo-marker.js) can be written; anything else can't.
// Throws unless the folder is missing, empty or a demo folder this tool made.
function checkFolder(folder) {
  const state = folderState(folder);
  if (state === 'not-a-folder') throw new Error(`${folder} is a file, not a folder. Nothing was changed.`);
  if (state === 'bad-marker') throw new Error(`${folder} has a ${MARKER} file this tool didn't write, so nothing was changed. Pick an empty folder.`);
  if (state === 'other') throw new Error(`${folder} already has files in it and isn't a demo folder, so nothing was changed. Pick an empty folder.`);
  return state;
}

const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);

function prepareFolder(folder) {
  const state = checkFolder(folder);
  fs.mkdirSync(folder, { recursive: true });
  if (state === 'demo') {
    for (const item of DEMO_ITEMS) {
      try {
        fs.rmSync(path.join(folder, item), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (e) {
        if (BUSY.has(e.code)) throw new Error('Stop the demo first (Stop Body Lab with -Demo), then try again.');
        throw e;
      }
    }
  }
  fs.writeFileSync(path.join(folder, MARKER), MARKER_TEXT);
}

// ---------- foods ----------

// Friendly name -> USDA SR Legacy id and the portion it is usually eaten in.
const FOODS = {
  'Scrambled eggs': [172187, '1 large'],
  'Hard-boiled egg': [173424, '1 large'],
  'Baby spinach': [168462, '1 cup'],
  Coffee: [171890, '1 cup (8 fl oz)'],
  'Half and half': [171255, '1 tbsp'],
  'Roast chicken breast': [171477, '0.5 breast, bone and skin removed'],
  'Green leaf lettuce': [169249, '1 cup shredded'],
  Avocado: [171706, '1 fruit, without skin and seed'],
  'Olive oil': [171413, '1 tablespoon'],
  Almonds: [170567, '1 oz (23 whole kernels)'],
  'Sharp cheddar': [170899, '1 slice (1 oz)'],
  'Celery sticks': [169988, '1 stalk, medium (7-1/2" - 8" long)'],
  'Peanut butter': [172470, '2 tbsp'],
  Apple: [171688, '1 medium (3" dia)'],
  'Plain Greek yogurt': [170894, '1 container'],
  Strawberries: [167762, '1 cup, sliced'],
  Raspberries: [167755, '1 cup'],
  'Tuna, canned in water': [173709, '3 oz'],
  'Cherry tomatoes': [170457, '1 cup cherry tomatoes'],
  Cucumber: [168409, '0.5 cup slices'],
  'Cottage cheese': [172182, '4 oz'],
  'Turkey breast': [171496, '3 oz'],
  'Steamed broccoli': [169967, '0.5 cup, chopped'],
  Cauliflower: [169986, '1 cup chopped (1/2" pieces)'],
  Walnuts: [170187, '1 oz (14 halves)'],
  'Pumpkin seeds': [169415, '1 oz'],
  Salmon: [175168, '3 oz'],
  'Beef patty': [174032, '1 patty (yield from 1/4 lb raw meat)'],
  Hummus: [172454, '1 tablespoon'],
  'Whole-wheat toast': [172689, '1 slice'],
  'Mozzarella stick': [171244, '1 oz'],
  Mushrooms: [169251, '1 cup, pieces or slices'],
  'Red bell pepper': [170108, '1 cup, sliced'],
  Zucchini: [169291, '1 cup, sliced'],
  Shrimp: [175180, '3 oz'],
  'Dark chocolate': [170273, '1 oz'],
  'Chicken thigh': [172388, '1 thigh without skin'],
  Asparagus: [168390, '4 spears (1/2" base)'],
  'Italian dressing': [171019, '1 tbsp'],
};

const MEALS = {
  breakfast: [
    [['Scrambled eggs', 3], ['Baby spinach', 1], ['Coffee', 1], ['Half and half', 1]],
    [['Plain Greek yogurt', 1], ['Raspberries', 0.5], ['Walnuts', 0.5], ['Coffee', 1], ['Half and half', 1]],
    [['Cottage cheese', 1.5], ['Strawberries', 0.5], ['Coffee', 1]],
    [['Hard-boiled egg', 2], ['Avocado', 0.5], ['Coffee', 1], ['Half and half', 1]],
  ],
  lunch: [
    [['Roast chicken breast', 1.5], ['Green leaf lettuce', 2], ['Cherry tomatoes', 0.5], ['Cucumber', 1], ['Olive oil', 1]],
    [['Tuna, canned in water', 1.5], ['Celery sticks', 1], ['Avocado', 0.5], ['Green leaf lettuce', 1]],
    [['Turkey breast', 1.5], ['Sharp cheddar', 1], ['Cucumber', 1], ['Hummus', 2]],
    [['Shrimp', 1.5], ['Green leaf lettuce', 2], ['Avocado', 0.5], ['Italian dressing', 1]],
  ],
  dinner: [
    [['Salmon', 1.5], ['Asparagus', 2], ['Olive oil', 1]],
    [['Chicken thigh', 2], ['Steamed broccoli', 2], ['Cauliflower', 1]],
    [['Beef patty', 1.5], ['Mushrooms', 1], ['Zucchini', 1], ['Sharp cheddar', 1]],
    [['Shrimp', 1.5], ['Zucchini', 1.5], ['Red bell pepper', 0.5], ['Olive oil', 1]],
  ],
  snack: [
    [['Almonds', 1]],
    [['Celery sticks', 2], ['Peanut butter', 1]],
    [['Apple', 1], ['Peanut butter', 0.5]],
    [['Mozzarella stick', 1], ['Cherry tomatoes', 0.5]],
    [['Pumpkin seeds', 1]],
    [['Hard-boiled egg', 1]],
  ],
};
// The first two weeks, before cutting carbs.
const EARLY_MEALS = {
  breakfast: [[['Scrambled eggs', 2], ['Whole-wheat toast', 1], ['Coffee', 1], ['Half and half', 2]]],
  lunch: [[['Turkey breast', 1], ['Whole-wheat toast', 2], ['Sharp cheddar', 1], ['Apple', 1]]],
  snack: [[['Dark chocolate', 0.5]], [['Apple', 1], ['Peanut butter', 1]]],
};

// ---------- meal plans ----------

const PLAN_WEEKS = [
  {
    breakfast: ['Spinach and feta egg muffins', 'Greek yogurt bowl with berries and walnuts', 'Spinach and feta egg muffins', 'Overnight chia pudding', 'Spinach and feta egg muffins', 'Cottage cheese egg scramble', 'Greek yogurt bowl with berries and walnuts'],
    lunch: ['Lentil and vegetable soup', 'Turkey taco lettuce wraps', 'Lentil and vegetable soup', 'Chickpea cucumber salad', 'Garlic butter chicken thighs with green beans', 'Turkey taco lettuce wraps', 'Turkey taco lettuce wraps'],
    dinner: ['Sheet-pan salmon and broccoli', 'Garlic butter chicken thighs with green beans', 'Turkey taco lettuce wraps', 'Baked cod with tomatoes and olives', 'Steak and roasted vegetable plate', 'Garlic butter chicken thighs with green beans', 'Roast chicken with root vegetables'],
    prep: [
      [0, 'Bake egg muffins, make a pot of lentil soup', ['Spinach and feta egg muffins', 'Lentil and vegetable soup']],
      [3, 'Chicken thighs and taco meat for the weekend', ['Garlic butter chicken thighs with green beans', 'Turkey taco lettuce wraps']],
    ],
  },
  {
    breakfast: ['Overnight chia pudding', 'Spinach and feta egg muffins', 'Overnight chia pudding', 'Spinach and feta egg muffins', 'Greek yogurt bowl with berries and walnuts', 'Cottage cheese egg scramble', 'Spinach and feta egg muffins'],
    lunch: ['Chickpea cucumber salad', 'Chickpea cucumber salad', 'Turkey taco lettuce wraps', 'Chickpea cucumber salad', 'Turkey taco lettuce wraps', 'Lentil and vegetable soup', 'Beef patties with fried eggs'],
    dinner: ['Garlic butter chicken thighs with green beans', 'Baked cod with tomatoes and olives', 'Garlic butter chicken thighs with green beans', 'Sheet-pan salmon and broccoli', 'Turkey taco lettuce wraps', 'Beef patties with fried eggs', 'Steak and roasted vegetable plate'],
    prep: [
      [0, 'Chia pudding jars, chop cucumbers and herbs for the salad', ['Overnight chia pudding', 'Chickpea cucumber salad']],
      [3, 'Egg muffins and taco meat', ['Spinach and feta egg muffins', 'Turkey taco lettuce wraps']],
    ],
  },
];
const SERVINGS = { 'Steak and roasted vegetable plate': 1, 'Spinach and feta egg muffins': 1 };
// Shopping extras for the current week: [item, section, checked].
const EXTRAS = [['Coffee beans', 'pantry', true], ['Sparkling water', 'other', false], ['Lemons', 'produce', false]];

// ---------- words ----------

// Notes for the story's events: event -> [time, mood, tags, text]. All the words are written for this demo.
const EVENT_NOTES = {
  start: ['19:30', 3, ['tired'], 'Day one. Blood work is tomorrow and I already know my sugar has been creeping up. Starting small: a ten minute walk after each meal, and writing everything down here.'],
  lab1: ['12:10', 3, ['anxious'], 'Blood work came back. A1C 6.1. Not diabetes, but close enough that I want to do something about it now.'],
  firstShot: ['20:00', 3, ['nausea'], 'First shot tonight. Belly, left side. Barely felt the needle. A little queasy an hour later, so I ate light.'],
  carbs: ['18:45', 3, ['craving'], 'Cutting carbs to 50 g starting today. Cleared the bread and crackers out of the pantry so they are not staring at me.'],
  program: ['17:40', 4, ['energized'], 'First real workout. Chair squats and wall push-ups felt silly at first, but my legs knew they did something.'],
  doseUp: ['20:15', 3, ['calm'], 'Dose went up to 0.5 today. Noticed I left half my dinner and did not miss it.'],
  walks15: ['13:05', 4, ['calm'], 'Walks are fifteen minutes now. The after-lunch one is my favorite part of the workday.'],
  lab2: ['15:20', 5, ['energized'], 'New labs: A1C down to 5.8 and triglycerides way down. Doctor said keep doing exactly this. I may have done a little dance in the parking lot.'],
};
// [earliest point in the story (0 = start, 1 = today), mood, tags, text], in the order they are used.
const NOTES = [
  [0, 3, ['hungry'], 'Hungry around 4 pm again. A handful of almonds took the edge off.'],
  [0, 4, ['calm'], 'Slept straight through the night for once.'],
  [0, 2, ['hot-flash', 'irritable'], 'Three hot flashes before lunch. Wore layers and peeled them off one by one.'],
  [0, 3, ['tired'], 'Low energy all afternoon. Drank more water and it helped a bit.'],
  [0.1, 3, ['nausea'], 'A bit queasy the morning after the shot. Small breakfast and it passed by ten.'],
  [0.1, 3, ['craving'], 'Office birthday cake. Had two bites, then walked it off at lunch.'],
  [0.15, 3, ['hungry'], 'Skipped my snack and regretted it at dinner. Keeping the boiled eggs ready.'],
  [0.2, 2, ['headache'], 'Headache today. Probably not enough water while it was hot out.'],
  [0.2, 4, ['calm'], 'Rain, so I walked laps in the hallway after dinner. Still counts.'],
  [0.3, 4, ['energized'], 'Took the long way around the block after dinner without thinking about it.'],
  [0.3, 3, ['constipated'], 'Digestion slow this week. Adding more vegetables and water.'],
  [0.3, 5, ['calm'], 'Weekend farmers market. Bought too much zucchini, which is a nice problem to have.'],
  [0.35, 3, ['tired'], 'Short night. Kept the workout but went easier on the reps.'],
  [0.4, 3, ['hot-flash'], 'Hot flash woke me at 3 am. Fan on, back to sleep by four.'],
  [0.45, 4, [], 'Jeans that were snug last month button easily today.'],
  [0.5, 4, ['energized'], 'Neighbor asked what I am doing differently. Told her: walking after every meal.'],
  [0.5, 4, ['calm'], 'Feeling steadier in the afternoons. No three o\'clock slump today.'],
  [0.55, 5, ['energized'], 'Carried all the groceries up in one trip. Did not need to stop on the landing.'],
  [0.6, 4, [], 'Blood pressure was the lowest I have seen it in a year.'],
  [0.66, 4, [], 'Meal prep took an hour and lunch is sorted for four days. Worth it.'],
  [0.68, 4, [], 'Tried the chia pudding for the first time. Better than expected with the berries.'],
  [0.7, 3, ['bloated'], 'Bloated after the lentil soup. Might be the beans, might be eating it too fast.'],
  [0.75, 4, ['calm'], 'Fasting number under 105 three days running. Small thing, but it feels like proof.'],
  [0.85, 4, [], 'Planks feel easier now. My first try lasted 12 seconds.'],
];
const DETAILS = ['Felt strong today.', 'Went slow on the step-ups.', 'Knee a little stiff, kept the range small.', 'Did it in the living room before dinner.', ''];
const SHOT_NOTES = { late: 'Took it a day late, Thursday got away from me.' };

// ---------- the person over time ----------

function buildTimeline(start, end) {
  const total = dayNum(end) - dayNum(start);
  const at = (n) => addDays(start, Math.min(n, total));
  let firstShot = start;
  while (weekday(firstShot) !== SHOT_DAY) firstShot = addDays(firstShot, 1);
  // Phase labels sit near the top of the weight graph, so later phases wait until the line has
  // dropped below them: the first shot from day 12, the program from day 21.
  while (dayNum(firstShot) - dayNum(start) < 12) firstShot = addDays(firstShot, 7);
  let programStart = addDays(start, 21);
  while (weekday(programStart) !== 1) programStart = addDays(programStart, 1);
  const events = {
    start,
    lab1: at(1),
    firstShot,
    carbs: at(13),
    program: programStart,
    doseUp: addDays(firstShot, 28),
    walks15: addDays(programStart, 14),
    lab2: addDays(end, -3),
  };
  return { total, firstShot, programStart, events };
}

// ---------- main ----------

async function loadHelpers() {
  const load = (f) => import(pathToFileURL(path.join(PUBLIC, f)).href);
  const [nutrition, meals, programs, glp1] = await Promise.all([load('nutrition.js'), load('meals.js'), load('programs.js'), load('glp1.js')]);
  return { ...nutrition, ...meals, ...programs, SITES: glp1.SITES };
}

async function makeDemoData(folder = DEFAULT_FOLDER, { weeks = 8, seed = 45, end = localToday() } = {}) {
  if (!isValidDate(end)) throw new Error(`--end must be a date like 2026-10-04, not ${end}.`);
  if (!Number.isInteger(weeks) || weeks < 3 || weeks > 26) throw new Error('--weeks must be a whole number from 3 to 26.');
  if (!Number.isInteger(seed)) throw new Error('--seed must be a whole number.');
  folder = path.resolve(folder);
  prepareFolder(folder);

  const h = await loadHelpers();
  const rnd = randomTools(seed);
  const idRnd = mulberry32(seed ^ 0x5eed);
  const makeId = (prefix) => prefix + Math.floor(idRnd() * 36 ** 6).toString(36).padStart(6, '0') + Math.floor(idRnd() * 36 ** 6).toString(36).padStart(6, '0');
  const store = createStore(folder, { makeId });
  store.ensureSeed();

  const start = addDays(end, -(weeks * 7 - 1));
  const { total, firstShot, programStart, events } = buildTimeline(start, end);
  const inRange = (d) => d >= start && d <= end;
  const progress = (date) => (dayNum(date) - dayNum(start)) / Math.max(1, total);

  // Foods: every food the person logs is saved, as the meal form does with "Remember new foods".
  const usda = new Map(JSON.parse(fs.readFileSync(FOODS_FILE, 'utf8')).map((f) => [f.id, f]));
  const foodInfo = {};
  for (const [name, [id, portion]] of Object.entries(FOODS)) {
    const f = usda.get(id);
    if (!f) throw new Error(`USDA food ${id} (${name}) is missing from data/usda-foods.json.`);
    const p = f.portions.find((x) => x.label === portion);
    if (!p) throw new Error(`USDA food ${id} has no portion "${portion}".`);
    foodInfo[name] = { food: f, portion, grams: p.g };
    store.createItem('foods', { name, serving: portion, ...h.nutrientsFor(f.per100, p.g), tags: f.tags, usda_id: id });
  }
  const itemFor = ([name, qty]) => {
    const { food, portion, grams } = foodInfo[name];
    return { food: name, qty, portion, usda_id: food.id, tags: food.tags, ...h.nutrientsFor(food.per100, grams * qty) };
  };

  const recipes = store.listItems('recipes');
  const recipeByName = new Map(recipes.map((r) => [r.name, r]));
  const programs = store.listItems('programs');
  const program = programs.find((p) => p.name === PROGRAM);

  // Settings and the library.
  store.saveDoc('goals', {
    ...store.getDoc('goals'),
    ideal_weight: IDEAL_WEIGHT, net_carb_max: 50, protein_min: 90, fiber_min: 25, water_oz: 64,
    walks_per_day: 3, walk_minutes: 10, next_checkup: addDays(end, 88),
    program: PROGRAM, program_start: programStart, diet: DIET, diet_add_on: '', eating_window: null,
  });
  store.saveDoc('supplements', {
    items: [
      { key: 'vitamin-d', name: 'Vitamin D3', dose: '1 softgel', slot: 'morning' },
      { key: 'fish-oil', name: 'Fish oil', dose: '1 softgel', slot: 'meals' },
      { key: 'psyllium', name: 'Psyllium husk', dose: '1 tsp in water', slot: 'pre-lunch' },
      { key: 'magnesium', name: 'Magnesium glycinate', dose: '1 capsule', slot: 'any' },
    ],
  });
  // A few short phases, spread out so their labels clear each other and the weight line at 90 days.
  const PHASES = [
    ['start', 'Walks after meals'],
    ['firstShot', 'First GLP-1 shot'],
    ['program', `Started ${PROGRAM}`],
    ['doseUp', 'Dose up to 0.5 mg'],
  ];
  store.saveDoc('phases', { phases: PHASES.filter(([k]) => inRange(events[k])).map(([k, label]) => ({ date: events[k], label })) });

  // Labs: two visits, A1C down a little.
  store.createItem('labs', {
    date: events.lab1, a1c: 6.1, fasting_glucose: 116, total_chol: 221, ldl: 139, hdl: 47, triglycerides: 172,
    other: 'TSH 2.4, vitamin D 27', notes: 'A1C in the prediabetes range. Plan: walk after meals, cut back on sugar and white flour, recheck in about two months.',
  });
  store.createItem('labs', {
    date: events.lab2, a1c: 5.8, fasting_glucose: 104, total_chol: 204, ldl: 126, hdl: 50, triglycerides: 131,
    other: 'Vitamin D 33', notes: 'A1C down 0.3. Keep going and recheck in three months.',
  });

  // Meal plans for the last three weeks, the current one with prep days and a shopping list.
  const plans = new Map();
  const thisMonday = mondayOf(end);
  const planMondays = [-14, -7, 0].map((n) => addDays(thisMonday, n)).filter((m) => m >= mondayOf(start) && addDays(m, 6) >= start);
  planMondays.forEach((monday, wi) => {
    const tpl = PLAN_WEEKS[(planMondays.length - 1 - wi) % PLAN_WEEKS.length];
    const meals = [];
    for (let i = 0; i < 7; i += 1) {
      for (const slot of ['breakfast', 'lunch', 'dinner']) {
        const recipe = tpl[slot][i];
        meals.push({ id: makeId('p'), date: addDays(monday, i), slot, recipe, servings: SERVINGS[recipe] ?? 1 });
      }
    }
    const prep = tpl.prep.map(([offset, notes, names]) => ({
      id: makeId('q'), date: addDays(monday, offset), notes,
      meal_ids: meals.filter((m) => names.includes(m.recipe) && m.date >= addDays(monday, offset)).map((m) => m.id),
    }));
    const plan = { week_start: monday, meals, prep, shopping: { checked: [], extras: [] } };
    const list = h.shoppingList(plan, recipes);
    const keys = list.sections.flatMap((s) => s.items.map((it) => it.key));
    if (monday === thisMonday) {
      plan.shopping.checked = keys.filter(() => rnd.chance(0.45));
      plan.shopping.extras = EXTRAS.map(([item, section, checked]) => ({ id: makeId('x'), item, section, checked }));
    } else {
      plan.shopping.checked = keys;
    }
    store.saveMealPlan(monday, plan);
    plans.set(monday, plan);
  });
  const plannedFor = (date, slot) => {
    const plan = plans.get(mondayOf(date));
    return plan ? plan.meals.find((m) => m.date === date && m.slot === slot) : null;
  };

  // GLP-1 settings and shot days.
  const shotDates = [];
  for (let d = firstShot, n = 0; d <= end; d = addDays(d, 7), n += 1) shotDates.push(n === 2 ? addDays(d, 1) : d);
  const doseFor = (n) => (n < 4 ? 0.25 : 0.5);
  store.saveDoc('glp1', { enabled: true, medication: MEDICATION, dose_mg: doseFor(shotDates.length - 1), shot_day: SHOT_DAY });

  // Notes: event notes on their days, the rest spread out three or four a week.
  const notesOn = new Map();
  for (const [k, [time, mood, tags, text]] of Object.entries(EVENT_NOTES)) {
    if (inRange(events[k])) notesOn.set(events[k], [...(notesOn.get(events[k]) || []), { time, mood, tags, text }]);
  }
  // Each note waits until it fits the story (a plank note once planks are longer, and so on).
  const unused = [...NOTES];
  for (let d = addDays(start, 2); d <= addDays(end, -1); d = addDays(d, 1)) {
    if (notesOn.has(d) || !rnd.chance(0.42)) continue;
    const i = unused.findIndex(([minP]) => minP <= progress(d));
    if (i < 0) continue;
    const [, mood, tags, text] = unused.splice(i, 1)[0];
    notesOn.set(d, [{ time: rnd.time('19:00', '21:45'), mood, tags, text }]);
  }

  let weightNoise = 0;
  const shotsGiven = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const isToday = date === end;
    const p = progress(date);
    const dayIndex = dayNum(date) - dayNum(start);
    const early = date < events.carbs;
    const shotIndex = shotDates.indexOf(date);
    const sinceShot = shotsGiven.length ? dayNum(date) - dayNum(shotsGiven[shotsGiven.length - 1]) : 99;
    const symptoms = new Set();

    // Weight: faster at first (water), then about a pound a week, with day-to-day noise.
    weightNoise = weightNoise * 0.55 + rnd.noise(0.9);
    const lost = Math.min(dayIndex, 14) * 0.23 + Math.max(0, dayIndex - 14) * 0.165;
    const weight = round1(START_WEIGHT - lost + weightNoise);

    // Readings.
    const readings = [];
    if (isToday || rnd.chance(0.9)) {
      readings.push({ time: rnd.time('06:40', '07:25'), type: 'glucose', context: 'fasting', value: Math.round(115 - 13 * p + rnd.noise(5)) });
    }
    if (isToday || rnd.chance(0.4)) {
      readings.push({ time: rnd.time('07:00', '07:40'), type: 'bp', systolic: Math.round(137 - 10 * p + rnd.noise(4)), diastolic: Math.round(88 - 7 * p + rnd.noise(3)), pulse: Math.round(75 - 4 * p + rnd.noise(4)) });
    }

    // Meals.
    const meals = [];
    const slots = isToday ? ['breakfast', 'lunch'] : ['breakfast', 'lunch', 'dinner', ...(rnd.chance(0.55) ? ['snack'] : [])];
    const times = { breakfast: rnd.time('07:30', '08:30'), lunch: rnd.time('12:00', '13:00'), snack: rnd.time('15:00', '16:00'), dinner: rnd.time('18:00', '19:00') };
    for (const slot of slots) {
      const time = times[slot];
      const planned = slot === 'snack' ? null : plannedFor(date, slot);
      if (planned && recipeByName.has(planned.recipe) && (isToday || rnd.chance(0.85))) {
        meals.push(h.ateThisEntry(planned, recipeByName.get(planned.recipe), time));
        if (/lentil|chickpea/i.test(planned.recipe) && rnd.chance(0.3)) symptoms.add('bloated');
        continue;
      }
      const pool = early && EARLY_MEALS[slot] && rnd.chance(0.5) ? EARLY_MEALS[slot] : MEALS[slot];
      meals.push({ time, kind: slot, items: rnd.pick(pool).map(itemFor) });
    }

    // Walks after meals and the program's workouts.
    const activity = [];
    const walkGoal = date >= events.walks15 ? 15 : 10;
    for (const m of meals) {
      if (m.kind === 'snack') continue;
      const p2 = { breakfast: 0.65, lunch: 0.8, dinner: 0.88 }[m.kind];
      if (!isToday && !rnd.chance(Math.min(0.95, p2 + 0.1 * p))) continue;
      activity.push({ time: later(m.time, 15, 35, rnd), type: 'walk', minutes: rnd.int(walkGoal - 2, walkGoal + 6), after: m.kind });
    }
    const routine = h.scheduledRoutine(program, programStart, date);
    if (routine && !isToday && (date === programStart || rnd.chance(0.85))) {
      const pos = h.programPosition(program, programStart, date);
      const found = h.findRoutine(routine, program, null);
      const bump = Math.floor((pos.week - 1) / 2);
      const sets = h.prefillSets(found).map((s, i, all) => {
        const out = { move: s.move };
        if (s.reps != null) out.reps = s.reps + bump - (i === all.length - 1 && rnd.chance(0.3) ? 2 : 0);
        if (s.seconds != null) out.seconds = s.seconds + 5 * bump;
        out.done = true;
        return out;
      });
      const details = rnd.pick(DETAILS);
      activity.push({ time: rnd.time('16:45', '17:30'), type: 'workout', name: routine, minutes: rnd.int(18, 28), ...(details ? { details } : {}), sets, program: PROGRAM, week: pos.week });
    }

    // Shots.
    const shots = [];
    if (shotIndex >= 0) {
      const n = shotIndex;
      let effects = [];
      if (n === 0) effects = ['nausea'];
      else if (n === 1) effects = ['nausea', 'low-appetite'];
      else if (n === 4) effects = ['nausea', 'fatigue'];
      else if (rnd.chance(0.25)) effects = [rnd.pick(['constipation', 'low-appetite', 'injection-site-reaction'])];
      shots.push({
        time: isToday ? '07:50' : rnd.time('19:30', '20:30'), medication: MEDICATION, dose_mg: doseFor(n), site: h.SITES[n % h.SITES.length][0],
        side_effects: effects, notes: n === 2 ? SHOT_NOTES.late : '',
      });
      shotsGiven.push(date);
      if (effects.includes('nausea')) symptoms.add('nausea');
      if (effects.includes('constipation')) symptoms.add('constipated');
    }
    const shotCalm = shotIndex >= 0 || sinceShot <= 2;

    // Check-in: ratings, water, sleep, hot flashes, supplements.
    const hotFlashes = rnd.chance(0.3) ? rnd.int(1, 3) : 0;
    if (hotFlashes) symptoms.add('hot-flash');
    if (early && rnd.chance(0.3)) symptoms.add(rnd.pick(['craving', 'tired']));
    if (dayIndex >= 13 && dayIndex <= 17 && rnd.chance(0.5)) symptoms.add('headache');
    if (p > 0.5 && rnd.chance(0.25)) symptoms.add('energized');
    const rating = (base, spread = 0.6) => clamp(Math.round(base + rnd.noise(spread)), 1, 5);
    const ratings = {
      hunger: rating(3.4 - 1.1 * p - (shotCalm ? 0.8 : 0)),
      cravings: rating(3.3 - 1.4 * p - (shotCalm ? 0.5 : 0)),
      energy: rating(2.7 + 1.2 * p - (symptoms.has('nausea') ? 0.7 : 0)),
      mood: rating(3 + 0.9 * p),
      sleep: rating(3.2 + 0.4 * p - (hotFlashes > 2 ? 0.8 : 0), 0.9),
      digestion: rating(3.6 - (symptoms.has('constipated') || symptoms.has('bloated') ? 1.4 : 0)),
    };
    const supplements = {};
    for (const [key, slot] of [['vitamin-d', 'morning'], ['fish-oil', 'meals'], ['psyllium', 'pre-lunch'], ['magnesium', 'any']]) {
      if (isToday) { if (slot === 'morning' || slot === 'pre-lunch') supplements[key] = true; continue; }
      supplements[key] = rnd.chance(slot === 'morning' ? 0.92 : 0.8);
    }
    const fields = {
      weight,
      water_oz: isToday ? 32 : 8 * rnd.int(6, 10),
      sleep_hours: rnd.int(24, 32) / 4,
      ratings: isToday ? { hunger: ratings.hunger, energy: ratings.energy, mood: ratings.mood, sleep: ratings.sleep } : ratings,
      symptoms: [...symptoms],
      supplements,
    };
    if (hotFlashes) fields.hormonal = { hot_flashes: hotFlashes, cycle: 'none' };
    if (!isToday && rnd.chance(0.06)) delete fields.weight; // a missed weigh-in
    store.patchDay(date, fields);

    // After-meal blood sugar and ketones in the evening, a few days a week.
    if (!isToday && rnd.chance(0.45)) {
      const dinner = meals.find((m) => m.kind === 'dinner');
      if (dinner) readings.push({ time: later(dinner.time, 115, 130, rnd), type: 'glucose', context: '2h-after', value: Math.round(141 - 17 * p + rnd.noise(9)) });
    }
    if (!isToday && rnd.chance(0.3)) {
      const lunch = meals.find((m) => m.kind === 'lunch');
      if (lunch) readings.push({ time: later(lunch.time, 55, 70, rnd), type: 'glucose', context: '1h-after', value: Math.round(150 - 18 * p + rnd.noise(10)) });
    }
    if (!isToday && rnd.chance(0.3)) {
      readings.push({ time: rnd.time('21:00', '21:45'), type: 'ketones', value: round1(early ? rnd.between(0.1, 0.4) : rnd.between(0.3, 1.3)) });
    }

    const byTime = (a, b) => a.time.localeCompare(b.time);
    for (const r of readings.sort(byTime)) store.addEntry(date, 'readings', r);
    for (const m of meals.sort(byTime)) store.addEntry(date, 'meals', m);
    for (const a of activity.sort(byTime)) store.addEntry(date, 'activity', a);
    for (const s of shots) store.addEntry(date, 'shots', s);
    for (const n of notesOn.get(date) || []) store.addEntry(date, 'notes', n);
  }
  return { folder, start, end, weeks, seed };
}

function parseArgs(argv) {
  const out = { folder: DEFAULT_FOLDER, options: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--weeks' || a === '--seed') out.options[a.slice(2)] = Number(argv[++i]);
    else if (a === '--end') out.options.end = argv[++i];
    else if (a === '--check') out.check = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}.`);
    else out.folder = a;
  }
  return out;
}

if (require.main === module) {
  (async () => {
    try {
      const { folder, options, check } = parseArgs(process.argv.slice(2));
      if (check) {
        const state = checkFolder(path.resolve(folder));
        console.log(state === 'demo' ? `${folder} is a demo folder.` : `${folder} can be used for the demo.`);
        return;
      }
      const r = await makeDemoData(folder, options);
      console.log(`Demo data written to ${r.folder}: ${r.weeks} weeks, ${r.start} to ${r.end}, seed ${r.seed}.`);
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
  })();
}

module.exports = { makeDemoData, checkFolder, MARKER, MARKER_TEXT, DEFAULT_FOLDER };
