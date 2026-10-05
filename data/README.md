# Food data

`usda-foods.json` is built from USDA FoodData Central, **SR Legacy, April 2018**: about
7,800 common foods, with energy, protein, carbohydrate, fiber and fat per 100 g and the
household portions USDA lists for each.

Nutrition data: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.

It is a U.S. government work in the public domain (CC0), so it can ship with the app.

## Regenerating it

1. Download the SR Legacy CSV release from fdc.nal.usda.gov and unzip it (into `data/raw/`,
   which git ignores).
2. From `App/`, run:

   ```
   node tools/build-food-db.js data/raw/<unzipped folder>
   ```

   It writes `data/usda-foods.json` (a second argument picks another output file).
3. Run `node --test`, then `node tools/link-starters.js --check` to see whether the starter
   recipes' numbers moved. Run it without `--check` to rewrite them.

The app reads this file only; it never downloads anything.
