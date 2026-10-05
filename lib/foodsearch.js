'use strict';
/*
 * Pure food-name search over the USDA list and saved foods. No I/O.
 * Every query word must be a prefix of some word in the name. Ranking favors
 * plain everyday foods ("Egg, whole, raw") over brands, prepared dishes and
 * look-alike words ("Eggnog").
 */

const RAW_GROUPS = ['Vegetables', 'Fruits', 'Beef', 'Pork', 'Poultry', 'Finfish', 'Lamb'];
const PREPARED_GROUPS = ['Fast Foods', 'Restaurant Foods', 'Meals, Entrees', 'Snacks', 'Sweets', 'Baked Products', 'Baby Foods', 'Sausages and Luncheon', 'Soups'];
const MIN_QUERY = 2;
// Longer queries are cut before matching, so a pasted paragraph costs no more than a short one.
const MAX_QUERY_CHARS = 100;
const MAX_QUERY_WORDS = 8;
// Words that mark a processed form or a part of the food, not the plain thing.
const PROCESSED = new Set(['dried', 'dehydrated', 'canned', 'frozen', 'powder', 'powdered', 'smoked', 'breaded', 'sliced', 'roll', 'deli', 'mixture', 'flavored', 'flavor', 'sulfured', 'yolk', 'white', 'nuggets', 'pickled', 'substitute', 'imitation', 'juice', 'prepackaged', 'concentrate', 'dessert', 'cured', 'bologna', 'luncheon']);

const wordsOf = (s) => (typeof s === 'string' ? s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean) : []);
// "eggs" and "egg" are the same word.
const stem = (w) => (w.length > 2 ? w.replace(/s$/, '') : w);

// True when every query word starts some word of the name.
function matchesWords(queryWords, nameWords) {
  return queryWords.length > 0 && queryWords.every((q) => nameWords.some((w) => w.startsWith(q)));
}

function queryWordsOf(q) {
  if (typeof q !== 'string' || q.trim().length < MIN_QUERY) return [];
  return wordsOf(q.slice(0, MAX_QUERY_CHARS)).slice(0, MAX_QUERY_WORDS);
}

// Brand-like: a capitalized word that does not begin a comma segment ("Oscar Mayer"),
// or an all-caps word ("SILK", "GERBER"). Parenthetical notes are ignored.
function hasBrandWord(name) {
  const plain = name.replace(/\([^)]*\)/g, ' ');
  if (plain.split(',').some((seg) => seg.trim().split(/\s+/).slice(1).some((w) => /^[("']?[A-Z][a-z]/.test(w)))) return true;
  return /(^|[^A-Za-z])[A-Z]{3,}([^a-z]|$)/.test(plain);
}

function prepare(food) {
  const group = typeof food.group === 'string' ? food.group : '';
  const segments = food.name.split(',');
  const segWords = segments.map(wordsOf);
  const words = segWords.flat();
  return {
    food,
    words,
    stems: new Set(words.map(stem)),
    segWords,
    everyday: PREPARED_GROUPS.some((g) => group.startsWith(g)) || hasBrandWord(food.name) ? 1 : 0,
    rawTier: RAW_GROUPS.some((g) => group.startsWith(g)) && words.includes('raw') ? 0 : 1,
    processed: words.some((w) => PROCESSED.has(w)) ? 1 : 0,
    segCount: segments.length,
  };
}

function rankKey(e, qw) {
  // 1. Whole-word matches for every query word but the last.
  const prefixOnly = qw.slice(0, -1).filter((q) => !e.stems.has(stem(q))).length;
  // 1b. The last word may be half-typed, but a whole word still wins ("egg" before "eggnog").
  const lastQ = stem(qw[qw.length - 1]);
  const lastPrefixOnly = e.stems.has(lastQ) ? 0 : 1;
  // 2. How early in the name the query is covered; 0 means the first segment is the query.
  const qStems = qw.map(stem);
  const first = e.segWords[0].map(stem);
  let cover;
  if (first.length === qStems.length && qStems.every((q) => first.includes(q))) cover = 0;
  else {
    cover = e.segWords.length + 1;
    let seen = [];
    for (let i = 0; i < e.segWords.length; i++) {
      seen = seen.concat(e.segWords[i]);
      if (qw.every((q) => seen.some((w) => w.startsWith(q)))) { cover = i + 1; break; }
    }
  }
  // Processed forms drop below plain ones even when their name starts with the query.
  const start = Math.min(cover, 2) + (e.processed ? 2 : 0);
  return [prefixOnly, lastPrefixOnly, start, e.everyday, e.rawTier, e.segCount, e.food.name.length];
}

function createFoodIndex(foods) {
  const entries = (Array.isArray(foods) ? foods : [])
    .filter((f) => f && typeof f === 'object' && typeof f.name === 'string' && f.name)
    .map(prepare);
  const byIdMap = new Map();
  for (const e of entries) if (e.food.id !== undefined && e.food.id !== null) byIdMap.set(String(e.food.id), e.food);

  function search(q, limit = 15) {
    const qw = queryWordsOf(q);
    if (!qw.length) return [];
    const hits = [];
    for (const e of entries) {
      if (matchesWords(qw, e.words)) hits.push({ e, key: rankKey(e, qw) });
    }
    hits.sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
      return a.e.food.name < b.e.food.name ? -1 : a.e.food.name > b.e.food.name ? 1 : 0;
    });
    const n = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 15;
    return hits.slice(0, n).map((h) => h.e.food);
  }

  function byId(id) {
    return byIdMap.get(String(id)) || null;
  }

  return { search, byId };
}

module.exports = { createFoodIndex, wordsOf, matchesWords, queryWordsOf };
