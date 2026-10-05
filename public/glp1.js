// Pure GLP-1 helpers: no DOM, no fetch, so node:test can import them.

export const SITES = [
  ['belly-left', 'Belly, left'], ['belly-right', 'Belly, right'],
  ['thigh-left', 'Thigh, left'], ['thigh-right', 'Thigh, right'],
  ['arm-left', 'Arm, left'], ['arm-right', 'Arm, right'],
];
export const SIDE_EFFECTS = [
  'nausea', 'fatigue', 'constipation', 'diarrhea', 'headache', 'heartburn',
  'injection-site-reaction', 'low-appetite',
];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const siteLabel = (value) => (SITES.find(([v]) => v === value) || [, value || ''])[1];

const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const fromNum = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

// Most recent shot across /api/days results (by date, then time), or null.
export function findLastShot(days) {
  let best = null;
  for (const d of days || []) {
    const shots = d && d.data && Array.isArray(d.data.shots) ? d.data.shots : [];
    for (const shot of shots) {
      const key = `${d.date} ${shot.time || ''}`;
      if (!best || key > best.key) best = { key, date: d.date, shot };
    }
  }
  return best && { date: best.date, shot: best.shot };
}

// The next site in the fixed rotation after the one used last time.
export function nextSite(lastSite) {
  const i = SITES.findIndex(([v]) => v === lastSite);
  return SITES[(i + 1) % SITES.length][0];
}

// First date strictly after `afterIso` (or on/after it, when inclusive) that falls on `dow`.
function nextOn(afterIso, dow, inclusive) {
  let n = dayNum(afterIso) + (inclusive ? 0 : 1);
  while (weekday(fromNum(n)) !== dow) n += 1;
  return fromNum(n);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Works out when the next shot is due. state: today | upcoming | overdue | none.
export function nextShotInfo({ today, shotDay, days }) {
  const last = findLastShot(days);
  const hasDay = Number.isInteger(shotDay) && shotDay >= 0 && shotDay <= 6;
  const out = { last, nextSite: nextSite(last && last.shot.site), dueDate: null, daysUntil: null, state: 'none', text: 'No shots logged yet' };
  let due = null;
  // With a shot day: the first shot day on or after last + 4, so an early shot
  // still counts toward the week it was meant for.
  if (last) due = hasDay ? nextOn(fromNum(dayNum(last.date) + 4), shotDay, true) : fromNum(dayNum(last.date) + 7);
  else if (hasDay) due = nextOn(today, shotDay, true);
  if (!due) return out;
  const diff = dayNum(due) - dayNum(today);
  out.dueDate = due;
  out.daysUntil = diff;
  if (diff === 0) Object.assign(out, { state: 'today', text: 'Due today' });
  else if (diff > 0) Object.assign(out, { state: 'upcoming', text: `Due ${WEEKDAYS[weekday(due)]} (in ${plural(diff, 'day')})` });
  else Object.assign(out, { state: 'overdue', text: `Overdue by ${plural(-diff, 'day')}` });
  return out;
}

// The site to suggest for a shot on `date`: the one after the latest earlier shot.
// With no `time` (a new shot), every shot already logged that day counts; with a
// `time` (editing), only same-day shots at an earlier time do, never the shot itself.
export function suggestSite(days, { date, time = null }) {
  const earlier = (days || []).map((d) => {
    if (!d || !d.data || !Array.isArray(d.data.shots) || d.date > date) return null;
    const shots = d.date < date || time === null ? d.data.shots : d.data.shots.filter((s) => (s.time || '') < time);
    return { date: d.date, data: { shots } };
  });
  const last = findLastShot(earlier.filter(Boolean));
  return nextSite(last && last.shot.site);
}
