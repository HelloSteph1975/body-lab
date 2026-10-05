const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'markdown.js')).href);
const md = async (text) => (await load()).renderMarkdown(text);

test('headings 1 to 4 get slug ids; repeats get a number', async () => {
  const html = await md('# Big One\n## Set up Body Lab\n### Third\n#### Fourth\n## Set up Body Lab');
  assert.match(html, /<h1 id="readme-big-one">Big One<\/h1>/);
  assert.match(html, /<h2 id="readme-set-up-body-lab">Set up Body Lab<\/h2>/);
  assert.match(html, /<h3 id="readme-third">Third<\/h3>/);
  assert.match(html, /<h4 id="readme-fourth">Fourth<\/h4>/);
  assert.match(html, /<h2 id="readme-set-up-body-lab-2">/);
});

test('in-page anchor links are kept', async () => {
  assert.match(await md('See [setup](#set-up-body-lab).'), /<a href="#readme-set-up-body-lab">setup<\/a>/);
});

test('paragraphs, bold, italic and inline code', async () => {
  const html = await md('Hello **bold** and *italic* and `a*b*c`.\nSame paragraph.\n\nSecond.');
  assert.match(html, /<p>Hello <strong>bold<\/strong> and <em>italic<\/em> and <code>a\*b\*c<\/code>\.\nSame paragraph\.<\/p>/);
  assert.match(html, /<p>Second\.<\/p>/);
});

test('fenced code is escaped and kept verbatim', async () => {
  const html = await md('```\nif (a < b) **no**\n  indent\n```');
  assert.match(html, /<pre><code>if \(a &lt; b\) \*\*no\*\*\n  indent<\/code><\/pre>/);
});

test('bullet and numbered lists', async () => {
  const html = await md('- one\n- two **b**\n\n1. first\n2. second');
  assert.match(html, /<ul><li>one<\/li><li>two <strong>b<\/strong><\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
});

test('http and https links open in a new tab', async () => {
  const html = await md('[Site](https://example.com/a?b=1&c=2) and [Plain](http://example.com)');
  assert.match(html, /<a href="https:\/\/example.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener">Site<\/a>/);
  assert.match(html, /<a href="http:\/\/example.com" target="_blank" rel="noopener">Plain<\/a>/);
});

test('javascript: and other schemes are not linked', async () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'file:///c:/x', '//evil.com']) {
    const html = await md(`[click](${bad})`);
    assert.doesNotMatch(html, /<a /);
    assert.doesNotMatch(html, /href/);
    assert.match(html, /click/);
  }
});

test('script tags are escaped everywhere', async () => {
  const html = await md('<script>alert(1)</script>\n\n# <img src=x onerror=alert(1)>\n\n- <b>x</b>\n\n| a |\n|---|\n| <i>y</i> |\n\n[<s>t</s>](https://e.com/"onmouseover="x)');
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<b>|<i>|<s>/);
  assert.doesNotMatch(html, /"onmouseover=/);
  assert.match(html, /&lt;script&gt;/);
});

test('pipe tables become a scrollable table', async () => {
  const html = await md('| Name | Qty |\n| --- | :-: |\n| Eggs | **2** |\n| Ham | 1 |');
  assert.match(html, /<div class="table-wrap"><table>/);
  assert.match(html, /<thead><tr><th>Name<\/th><th>Qty<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td>Eggs<\/td><td><strong>2<\/strong><\/td><\/tr><tr><td>Ham<\/td><td>1<\/td><\/tr><\/tbody>/);
});

test('images under docs/readme/ are rewritten to /readme-images/', async () => {
  const html = await md('![Today page](docs/readme/today.png)');
  assert.match(html, /<img src="\/readme-images\/today\.png" alt="Today page"/);
});

test('an image that climbs out of docs/readme renders as alt text', async () => {
  const html = await md('![sneaky](docs/readme/../x.png)');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /sneaky/);
});

test('an unknown image path renders as alt text', async () => {
  for (const src of ['https://evil.com/x.png', 'images/a.png', '/etc/passwd', 'docs/readme/a/b.png', 'docs/readme/a.gif']) {
    const html = await md(`![alt text](${src})`);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /alt text/);
  }
});

test('empty and non-string input give an empty string', async () => {
  assert.equal(await md(''), '');
  assert.equal(await md(undefined), '');
});

test('heading ids carry a readme- prefix so they cannot hit the app ids', async () => {
  const html = await md('# Toast\n## Modal\n## Quick note\n## Main');
  for (const bad of ['toast', 'modal', 'quick-note', 'main']) assert.doesNotMatch(html, new RegExp(`id="${bad}"`));
  assert.match(html, /id="readme-toast"/);
  assert.match(html, /id="readme-quick-note"/);
});

test('every heading id is unique, even when a repeat collides with a real heading', async () => {
  const html = await md('## Setup\n## Setup\n## Setup 2\n## Setup\n## Setup 2');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
  assert.deepEqual(ids.slice(0, 3), ['readme-setup', 'readme-setup-2', 'readme-setup-2-2']);
});
