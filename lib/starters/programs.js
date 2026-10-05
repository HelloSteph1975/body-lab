'use strict';
// Starter programs, seeded once into Programs/. General fitness information,
// not medical advice.

const NOTE = 'General fitness information, not medical advice. Check with your doctor before starting a new exercise plan.';

module.exports = [
  {
    name: 'Beginner Bodyweight',
    description: `Six weeks of short full-body sessions at home, no equipment. ${NOTE}`,
    routines: [
      {
        name: 'Bodyweight A',
        moves: [
          { move: 'Chair squat', sets: 2, reps: 10, notes: 'Sit back until you touch the chair, then stand.' },
          { move: 'Wall push-up', sets: 2, reps: 10 },
          { move: 'Glute bridge', sets: 2, reps: 12 },
          { move: 'Bird dog', sets: 2, reps: 8, notes: 'Count each side once.' },
          { move: 'Plank', sets: 2, seconds: 20, notes: 'Knees down is fine.' },
        ],
      },
      {
        name: 'Bodyweight B',
        moves: [
          { move: 'Step-up', sets: 2, reps: 8, notes: 'Use the bottom stair; count each leg.' },
          { move: 'Standing calf raise', sets: 2, reps: 15 },
          { move: 'Dead bug', sets: 2, reps: 8 },
          { move: 'Wall push-up', sets: 3, reps: 10 },
          { move: 'Glute bridge', sets: 3, reps: 12 },
        ],
      },
    ],
    phases: [
      { name: 'Getting started', weeks: 2, days: { mon: 'Bodyweight A', wed: 'Bodyweight A', fri: 'Bodyweight A' }, walk_minutes: 10 },
      { name: 'Building', weeks: 4, days: { mon: 'Bodyweight A', wed: 'Bodyweight B', fri: 'Bodyweight A' }, walk_minutes: 15 },
    ],
    starter: true,
  },
  {
    name: 'Dumbbell Basics',
    description: `Eight weeks with a pair of dumbbells, three days a week. Pick a weight you can lift for every rep with two reps to spare. ${NOTE}`,
    routines: [
      {
        name: 'Dumbbells A',
        moves: [
          { move: 'Goblet squat', sets: 3, reps: 10 },
          { move: 'One-arm row', sets: 3, reps: 10, notes: 'Count each arm.' },
          { move: 'Floor press', sets: 3, reps: 10 },
          { move: 'Plank', sets: 3, seconds: 30 },
        ],
      },
      {
        name: 'Dumbbells B',
        moves: [
          { move: 'Romanian deadlift', sets: 3, reps: 10, notes: 'Hinge at the hips, back flat.' },
          { move: 'Overhead press', sets: 3, reps: 8 },
          { move: 'Glute bridge', sets: 3, reps: 12 },
          { move: 'Farmer carry', sets: 3, seconds: 30 },
        ],
      },
      {
        name: 'Dumbbells C',
        moves: [
          { move: 'Goblet squat', sets: 3, reps: 8 },
          { move: 'Floor press', sets: 3, reps: 8 },
          { move: 'One-arm row', sets: 3, reps: 8 },
          { move: 'Romanian deadlift', sets: 3, reps: 8 },
        ],
      },
    ],
    phases: [
      { name: 'Learning the moves', weeks: 4, days: { mon: 'Dumbbells A', wed: 'Dumbbells B', fri: 'Dumbbells A' } },
      { name: 'Adding a day', weeks: 4, days: { mon: 'Dumbbells A', wed: 'Dumbbells B', fri: 'Dumbbells C' } },
    ],
    starter: true,
  },
];
