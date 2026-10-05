const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, serialize, FrontmatterError } = require('../lib/frontmatter');

test('round-trips nested data', () => {
  const data = {
    date: '2026-09-30',
    weight: 148,
    ratings: { hunger: 2, mood: 4 },
    meals: [{ id: 'm1', time: '07:30', items: [{ food: 'Eggs', protein: 12 }] }],
  };
  const text = serialize(data, '# Body\n');
  assert.deepEqual(parse(text), { data, body: '# Body\n', hasFrontmatter: true });
});

test('a note without frontmatter has empty data', () => {
  assert.deepEqual(parse('# Hello\n'), { data: {}, body: '# Hello\n', hasFrontmatter: false });
});

test('reads plain scalars and block lists the way Obsidian writes them', () => {
  const text = '---\r\ntitle: Breakfast ideas\r\ncount: 3\r\ntags:\r\n  - food\r\n  - "low carb"\r\nempty:\r\n---\r\nbody';
  assert.deepEqual(parse(text).data, { title: 'Breakfast ideas', count: 3, tags: ['food', 'low carb'], empty: null });
});

test('broken JSON and nested YAML objects throw', () => {
  assert.throws(() => parse('---\nmeals: [{"id": \n---\n'), FrontmatterError);
  assert.throws(() => parse('---\nmeals:\n  - id: m1\n---\n'), FrontmatterError);
  assert.throws(() => parse('---\nweight: 1\n'), FrontmatterError);
});

test('leading blank lines before the opening --- are tolerated', () => {
  const r = parse('\n\n---\nweight: 150\n---\nMy journal');
  assert.equal(r.hasFrontmatter, true);
  assert.equal(r.data.weight, 150);
  assert.equal(r.body, 'My journal');
});

test('trailing spaces on the --- lines are tolerated', () => {
  const r = parse('---  \nweight: 150\n---\t\nbody');
  assert.equal(r.hasFrontmatter, true);
  assert.equal(r.data.weight, 150);
  assert.equal(r.body, 'body');
});

test('CRLF files parse', () => {
  const r = parse('---\r\nweight: 150\r\nnote: "hi"\r\n---\r\nbody\r\n');
  assert.deepEqual(r.data, { weight: 150, note: 'hi' });
  assert.equal(r.body, 'body\n');
  assert.equal(r.hasFrontmatter, true);
});

test('an unfinished quoted value throws instead of becoming plain text', () => {
  assert.throws(() => parse('---\nweight: "unfinished\n---\n'), FrontmatterError);
  assert.throws(() => parse("---\nweight: 'unfinished\n---\n"), FrontmatterError);
  assert.throws(() => parse('---\ntags:\n  - "oops\n---\n'), FrontmatterError);
});

test('single-quoted YAML strings still read', () => {
  assert.equal(parse("---\nname: 'it''s fine'\n---\n").data.name, "it's fine");
});
