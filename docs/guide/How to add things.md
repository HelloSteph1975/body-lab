# How to add things to Body Lab

General fitness and nutrition information, not medical advice.

> Written by Body Lab and replaced when the app updates. Copy it into Claude, ChatGPT
> or another AI tool, then ask it to write a note for you. Save what it writes as a
> `.md` file in the folder named in each section.

Every Body Lab note starts with a properties block between two `---` lines. Each line
is `key: value`, and every value is written as JSON: text in "double quotes", lists
in [square brackets], groups in {curly braces}. One key per line, with nothing nested
across lines. Anything below the second `---` is rebuilt by the app, so put all data
in the properties block.

## Programs

Folder: `Programs/`. File name: the program name plus `.md`.

| key | what it is |
|---|---|
| `name` | the program's name; same as the file name |
| `description` | one or two sentences |
| `routines` | list of `{ "name", "moves": [...] }` |
| `phases` | list of `{ "name", "weeks", "days", "walk_minutes" }`, in order |

Each move is `{ "move": "Goblet squat", "sets": 3, "reps": 10, "weight_lb": 15 }`.
Use `"seconds": 30` instead of reps for holds like planks. `weight_lb` and `notes` are
optional.

`days` maps weekdays to a routine name, using `mon tue wed thu fri sat sun`. Days that
aren't listed are rest days. `weeks` is a whole number. `walk_minutes` is optional; when
set, Body Lab uses it as the walk goal during that phase.

Example:

```
---
name: "Morning Strength"
description: "Two short dumbbell days and one bodyweight day. General fitness information, not medical advice."
routines: [{"name":"Upper","moves":[{"move":"Floor press","sets":3,"reps":10},{"move":"One-arm row","sets":3,"reps":10}]},{"name":"Lower","moves":[{"move":"Goblet squat","sets":3,"reps":10},{"move":"Glute bridge","sets":3,"reps":12}]},{"name":"Core","moves":[{"move":"Dead bug","sets":2,"reps":8},{"move":"Plank","sets":2,"seconds":30}]}]
phases: [{"name":"Base","weeks":3,"days":{"mon":"Upper","wed":"Core","fri":"Lower"},"walk_minutes":15},{"name":"Progress","weeks":3,"days":{"mon":"Upper","wed":"Lower","fri":"Upper","sat":"Core"},"walk_minutes":20}]
---
```

Checklist before saving:
- every routine named in `days` exists in `routines` (or in Library → Workouts);
- every `weeks` is a whole number of at least 1;
- the file name matches `name`.

## Diets

Folder: `Diets/`. File name: the diet name plus `.md`. Body Lab starts with six; add your own the same way.

| key | what it is |
|---|---|
| `name` | the diet's name; same as the file name |
| `description` | one or two sentences |
| `net_carb_max`, `protein_min`, `fiber_min` | daily targets in grams, or `null` for none |
| `eating_window` | `{ "start": "12:00", "end": "20:00" }` (24-hour times) or `null` |
| `favor_tags` | food tags the diet leans on |
| `avoid_tags` | food tags that get flagged |
| `only_tags` | `null`, or the only tags allowed; anything else is flagged |
| `avoid_words` | words in a food name that get flagged, such as "bread" |
| `add_on` | `true` if it combines with a main diet (like Intermittent fasting) |
| `starter` | optional; `true` on the diets Body Lab ships. Leave it out on your own |

Food tags: `meat, fish, eggs, dairy, vegetable, fruit, fruit-high-sugar, legume, grain, nut, seed, oil, sugar, processed, drink`.

Example:

```
---
name: "Low carb dinners"
description: "Protein and vegetables at dinner, no starch."
net_carb_max: 40
protein_min: 90
fiber_min: 25
eating_window: null
favor_tags: ["meat","fish","vegetable","oil"]
avoid_tags: ["grain","sugar"]
only_tags: null
avoid_words: ["bread","pasta","rice"]
add_on: false
---
```

Checklist before saving:
- targets are numbers or `null`, never text;
- `eating_window` has both `start` and `end` as `"HH:MM"`, or is `null`;
- tags come from the list above;
- the file name matches `name`.

## Recipes

Folder: `Recipes/`. File name: the recipe name plus `.md`.

| key | what it is |
|---|---|
| `name` | the recipe's name; same as the file name |
| `servings` | how many servings the recipe makes; halves are fine (`2.5`) |
| `prep_minutes`, `cook_minutes` | whole numbers |
| `diets` | names of diets it fits; each must match a diet's `name` exactly, capitals and spaces included |
| `tags` | food tags, same list as Diets |
| `meal_prep` | `true` if it keeps well for batch cooking |
| `per_serving` | `{ "net_carbs", "protein", "fiber" }` in grams |
| `ingredients` | a list (`[...]`) of `{ "item", "amount", "unit", "section" }`, even for one ingredient |
| `steps` | a list (`[...]`) of text steps, in order, even for one step. Not one long string |
| `note` | optional one-line note shown on the recipe |
| `starter` | optional; `true` on the recipes Body Lab ships. Leave it out on your own |

Store sections: `produce, meat & seafood, dairy & eggs, bakery, pantry, frozen, spices, other`.
Units are short: `oz, lb, g, cup, tbsp, tsp, each`. Use `"amount": null` and `"unit": ""` for
"to taste" items. The nutrition numbers are estimates, and the recipe page says so.

Example:

```
---
name: "Lemon chicken and green beans"
servings: 2
prep_minutes: 10
cook_minutes: 20
diets: ["Low carb or keto","Whole foods"]
tags: ["meat","vegetable","oil"]
meal_prep: true
per_serving: {"net_carbs":6,"protein":36,"fiber":4}
ingredients: [{"item":"chicken thighs","amount":12,"unit":"oz","section":"meat & seafood"},{"item":"green beans","amount":3,"unit":"cup","section":"produce"},{"item":"lemon","amount":1,"unit":"each","section":"produce"},{"item":"olive oil","amount":2,"unit":"tbsp","section":"pantry"}]
steps: ["Heat the oven to 425 F.","Toss everything with the oil and lemon juice on a sheet pan.","Roast 20 minutes, until the chicken is cooked through."]
---
```

Checklist before saving:
- every name in `diets` matches a diet's `name` exactly (`"Low carb or keto"`, not `"keto"`);
- `ingredients` and `steps` are lists in square brackets;
- `section` is one of the store sections above;
- units are short (`oz, lb, g, cup, tbsp, tsp, each`);
- the numbers in `per_serving` are estimates for one serving;
- the file name matches `name`.

## Meal plans

Folder: `Meal plans/`. File name: the Monday of the week, such as `2026-10-05.md`. The app
usually writes these when you plan in the Meals tab, so you rarely need to create one.

| key | what it is |
|---|---|
| `week_start` | the Monday, `"YYYY-MM-DD"`; same as the file name |
| `meals` | list of `{ "id", "date", "slot", "recipe", "servings" }` |
| `prep` | list of `{ "id", "date", "meal_ids", "notes" }`; `meal_ids` are ids from `meals` that this prep day cooks |
| `shopping` | `{ "checked": [...], "extras": [...] }` |

`slot` is `breakfast`, `lunch`, `dinner` or `snack`. `recipe` is a recipe name. Each `checked`
entry is the lowercased item, a `|`, then the lowercased unit with a trailing "s" trimmed
when the unit is longer than two letters, such as `"salmon fillets|oz"` or `"broccoli florets|cup"`. Each extra is
`{ "id", "item", "section", "checked" }`.

Example:

```
---
week_start: "2026-10-05"
meals: [{"id":"p1","date":"2026-10-05","slot":"dinner","recipe":"Sheet-pan salmon and broccoli","servings":1}]
prep: [{"id":"q1","date":"2026-10-04","meal_ids":["p1"],"notes":"Cook salmon"}]
shopping: {"checked":["salmon fillets|oz"],"extras":[{"id":"x1","item":"coffee","section":"pantry","checked":false}]}
---
```

Checklist before saving:
- the file name is a Monday and matches `week_start`;
- every `recipe` matches a file in `Recipes/`;
- every id in `meal_ids` exists in `meals`;
- `meals`, `prep`, `checked` and `extras` are lists, even when empty.
