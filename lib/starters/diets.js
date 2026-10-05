'use strict';
// Starter diets, seeded once into Diets/. Written for Body Lab.

const NOTE = 'General nutrition information, not medical advice. Check with your doctor, especially if you take medication.';

module.exports = [
  {
    name: 'Low carb or keto',
    description: `Keeps net carbs low so meals lean on protein, fat and non-starchy vegetables. ${NOTE}`,
    net_carb_max: 50, protein_min: 90, fiber_min: 25, eating_window: null,
    favor_tags: ['meat', 'fish', 'eggs', 'dairy', 'vegetable', 'nut', 'seed', 'oil'],
    avoid_tags: ['grain', 'sugar', 'fruit-high-sugar'],
    only_tags: null,
    avoid_words: ['bread', 'pasta', 'rice', 'potato', 'tortilla', 'cereal', 'soda', 'juice', 'candy', 'chips'],
    add_on: false, starter: true,
  },
  {
    name: 'Mediterranean',
    description: `Built around vegetables, beans, fish, olive oil and nuts, with little red meat and few sweets. ${NOTE}`,
    net_carb_max: null, protein_min: 80, fiber_min: 30, eating_window: null,
    favor_tags: ['fish', 'vegetable', 'fruit', 'legume', 'grain', 'nut', 'seed', 'oil'],
    avoid_tags: ['sugar', 'processed'],
    only_tags: null,
    avoid_words: ['soda', 'candy', 'hot dog', 'bacon', 'sausage'],
    add_on: false, starter: true,
  },
  {
    name: 'High protein, GLP-1 support',
    description: `Puts protein and fiber first at every meal, which helps you feel full and protects muscle while losing weight. ${NOTE}`,
    net_carb_max: 100, protein_min: 100, fiber_min: 30, eating_window: null,
    favor_tags: ['meat', 'fish', 'eggs', 'dairy', 'legume', 'vegetable', 'nut', 'seed'],
    avoid_tags: ['sugar', 'processed'],
    only_tags: null,
    avoid_words: ['soda', 'candy', 'pastry', 'donut'],
    add_on: false, starter: true,
  },
  {
    name: 'Intermittent fasting',
    description: `An eating window you add to any diet: eat between noon and 8 PM, then fast until noon the next day. Change the hours in Settings. ${NOTE}`,
    net_carb_max: null, protein_min: null, fiber_min: null,
    eating_window: { start: '12:00', end: '20:00' },
    favor_tags: [], avoid_tags: [], only_tags: null, avoid_words: [],
    add_on: true, starter: true,
  },
  {
    name: 'Carnivore',
    description: `Animal foods only: meat, fish, eggs and some dairy. Anything else gets flagged. ${NOTE}`,
    net_carb_max: 20, protein_min: 100, fiber_min: null, eating_window: null,
    favor_tags: ['meat', 'fish', 'eggs', 'dairy'],
    avoid_tags: [],
    only_tags: ['meat', 'fish', 'eggs', 'dairy'],
    avoid_words: [],
    add_on: false, starter: true,
  },
  {
    name: 'Whole foods',
    description: `Food as close to how it grows as possible: vegetables, fruit, meat, fish, eggs, beans, nuts and whole grains. Skips ultra-processed food, added sugar and white flour. ${NOTE}`,
    net_carb_max: null, protein_min: 80, fiber_min: 30, eating_window: null,
    favor_tags: ['meat', 'fish', 'eggs', 'vegetable', 'fruit', 'legume', 'grain', 'nut', 'seed', 'oil'],
    avoid_tags: ['processed', 'sugar'],
    only_tags: null,
    avoid_words: ['white bread', 'white flour', 'soda', 'candy', 'chips', 'frozen dinner', 'hot dog'],
    add_on: false, starter: true,
  },
];
