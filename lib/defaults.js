'use strict';
// Starting content for a new Body Lab folder. The supplement plan is an example
// to edit; the app never recommends doses. Personal history is entered in the app.

module.exports = {
  goals: {
    ideal_weight: null,
    net_carb_max: 50,
    protein_min: 90,
    fiber_min: 25,
    water_oz: 64,
    walks_per_day: 3,
    walk_minutes: 10,
    next_checkup: null,
    program: '',
    program_start: null,
    diet: '',
    diet_add_on: '',
    eating_window: null,
  },
  phases: {
    phases: [],
  },
  // Off until turned on in Settings. shot_day: 0 = Sunday .. 6 = Saturday.
  glp1: { enabled: false, medication: '', dose_mg: null, shot_day: null },
  // Empty for a new folder: people add their own supplements in Library.
  supplements: { items: [] },
  workouts: {
    moves: [
      { name: 'Chair squats', notes: '' },
      { name: 'Wall push-ups', notes: '' },
      { name: 'Glute bridges', notes: '' },
      { name: 'Bird dogs', notes: '' },
      { name: 'Standing calf raises', notes: '' },
      { name: 'Dead bugs', notes: '' },
    ],
    routines: [{ name: 'Bodyweight A', moves: ['Chair squats', 'Wall push-ups', 'Glute bridges', 'Bird dogs'] }],
  },
  symptomTags: [
    'bloated', 'gas', 'constipated', 'nausea', 'hungry', 'craving', 'tired', 'energized',
    'brain-fog', 'headache', 'acne', 'joint-pain', 'hot-flash', 'irritable', 'calm', 'anxious',
  ],
};
