const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'glp1.js')).href);
const day = (date, ...shots) => ({ date, data: { date, shots } });
// 2026-10-07 is a Wednesday (shot_day 3).
const WED = 3;

test('no shot yet and a shot day set: due today when today is that day', async () => {
  const { nextShotInfo } = await load();
  const r = nextShotInfo({ today: '2026-10-07', shotDay: WED, days: [] });
  assert.equal(r.dueDate, '2026-10-07');
  assert.equal(r.state, 'today');
  assert.equal(r.text, 'Due today');
  assert.equal(r.last, null);
  assert.equal(r.nextSite, 'belly-left');
});

test('no shot yet: counts forward to the next shot day', async () => {
  const { nextShotInfo } = await load();
  const r = nextShotInfo({ today: '2026-10-05', shotDay: WED, days: [] });
  assert.equal(r.dueDate, '2026-10-07');
  assert.equal(r.text, 'Due Wednesday (in 2 days)');
  assert.equal(r.state, 'upcoming');
});

test('due in N days after the last shot', async () => {
  const { nextShotInfo } = await load();
  const days = [day('2026-09-30', { time: '09:00', dose_mg: 2.5, site: 'belly-left' })];
  const r = nextShotInfo({ today: '2026-10-05', shotDay: WED, days });
  assert.equal(r.dueDate, '2026-10-07');
  assert.equal(r.text, 'Due Wednesday (in 2 days)');
  assert.equal(r.last.date, '2026-09-30');
  assert.equal(r.nextSite, 'belly-right');
});

test('singular day wording', async () => {
  const { nextShotInfo } = await load();
  const r = nextShotInfo({ today: '2026-10-06', shotDay: WED, days: [day('2026-09-30', { site: 'arm-left' })] });
  assert.equal(r.text, 'Due Wednesday (in 1 day)');
});

test('due today', async () => {
  const { nextShotInfo } = await load();
  const r = nextShotInfo({ today: '2026-10-07', shotDay: WED, days: [day('2026-09-30', { site: 'belly-left' })] });
  assert.equal(r.text, 'Due today');
  assert.equal(r.state, 'today');
});

test('overdue by N days', async () => {
  const { nextShotInfo } = await load();
  const r = nextShotInfo({ today: '2026-10-09', shotDay: WED, days: [day('2026-09-30', { site: 'belly-left' })] });
  assert.equal(r.dueDate, '2026-10-07');
  assert.equal(r.text, 'Overdue by 2 days');
  assert.equal(r.state, 'overdue');
});

test('no shot_day: last shot plus 7 days', async () => {
  const { nextShotInfo } = await load();
  const days = [day('2026-10-01', { site: 'thigh-left' })];
  let r = nextShotInfo({ today: '2026-10-05', shotDay: null, days });
  assert.equal(r.dueDate, '2026-10-08');
  assert.equal(r.text, 'Due Thursday (in 3 days)');
  r = nextShotInfo({ today: '2026-10-10', shotDay: null, days });
  assert.equal(r.text, 'Overdue by 2 days');
});

test('no shot and no shot_day: nothing to count from', async () => {
  const { nextShotInfo } = await load();
  const r = nextShotInfo({ today: '2026-10-05', shotDay: null, days: [] });
  assert.equal(r.dueDate, null);
  assert.equal(r.state, 'none');
  assert.equal(r.text, 'No shots logged yet');
});

test('the latest shot wins, by date then time; broken days are skipped', async () => {
  const { findLastShot } = await load();
  const days = [
    day('2026-09-23', { time: '09:00', site: 'belly-left' }),
    { date: '2026-09-28', broken: 'bad' },
    day('2026-09-30', { time: '08:00', site: 'arm-left' }, { time: '20:00', site: 'arm-right' }),
    day('2026-10-02'),
  ];
  const last = findLastShot(days);
  assert.equal(last.date, '2026-09-30');
  assert.equal(last.shot.site, 'arm-right');
  assert.equal(findLastShot([]), null);
});

test('site rotation wraps around', async () => {
  const { nextSite, SITES } = await load();
  assert.equal(SITES.length, 6);
  assert.equal(nextSite('belly-left'), 'belly-right');
  assert.equal(nextSite('arm-right'), 'belly-left');
  assert.equal(nextSite(undefined), 'belly-left');
  assert.equal(nextSite('somewhere-else'), 'belly-left');
});

// Shot day Wednesday: the next due date is the first Wednesday on or after last + 4 days.
const dueAfter = async (lastDate, shotDay = WED) => {
  const { nextShotInfo } = await load();
  return nextShotInfo({ today: '2026-10-05', shotDay, days: [day(lastDate, { site: 'belly-left' })] }).dueDate;
};

test('a shot 1 or 2 days early still counts toward the following week', async () => {
  assert.equal(await dueAfter('2026-10-06'), '2026-10-14'); // Tuesday
  assert.equal(await dueAfter('2026-10-05'), '2026-10-14'); // Monday
});

test('a shot 1 or 2 days late is due on the next shot day', async () => {
  assert.equal(await dueAfter('2026-10-08'), '2026-10-14'); // Thursday
  assert.equal(await dueAfter('2026-10-09'), '2026-10-14'); // Friday
});

test('a shot on the shot day itself is next due 7 days later', async () => {
  assert.equal(await dueAfter('2026-10-07'), '2026-10-14');
});

test('shot_day Sunday with a Saturday shot is due the next Sunday', async () => {
  assert.equal(await dueAfter('2026-10-03', 0), '2026-10-11');
});

test('suggestSite: a long gap still finds the last shot', async () => {
  const { suggestSite } = await load();
  const days = [day('2026-01-10', { time: '09:00', site: 'thigh-left' })];
  assert.equal(suggestSite(days, { date: '2026-10-05' }), 'thigh-right');
  assert.equal(suggestSite([], { date: '2026-10-05' }), 'belly-left');
});

test('suggestSite: counts an earlier shot on the same day, never later days', async () => {
  const { suggestSite } = await load();
  const days = [
    day('2026-10-01', { time: '09:00', site: 'belly-left' }),
    day('2026-10-05', { time: '08:00', site: 'belly-right' }, { time: '20:00', site: 'arm-left' }),
    day('2026-10-09', { time: '09:00', site: 'thigh-left' }),
  ];
  // New shot on the 5th: both same-day shots count, the 9th does not.
  assert.equal(suggestSite(days, { date: '2026-10-05' }), 'arm-right');
  // Editing the 20:00 shot: only the 08:00 one is earlier.
  assert.equal(suggestSite(days, { date: '2026-10-05', time: '20:00' }), 'thigh-left');
  // Editing the 08:00 shot: falls back to the 1st.
  assert.equal(suggestSite(days, { date: '2026-10-05', time: '08:00' }), 'belly-right');
});

test('suggestSite: backfilling at 07:00 ignores a 09:00 shot the same day', async () => {
  const { suggestSite } = await load();
  const days = [
    day('2026-10-04', { time: '09:00', site: 'thigh-left' }),
    day('2026-10-05', { time: '09:00', site: 'arm-left' }),
  ];
  assert.equal(suggestSite(days, { date: '2026-10-05', time: '07:00' }), 'thigh-right');
  assert.equal(suggestSite(days, { date: '2026-10-05', time: '10:00' }), 'arm-right');
});
