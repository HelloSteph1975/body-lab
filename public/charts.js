import { esc, shortDate } from './util.js';

// Hand-drawn SVG charts in the Body Lab glow style. x values are YYYY-MM-DD.
const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);

export function lineChart({ from, to, series, markers = [], target = null, height = 220, unit = '' }) {
  const w = 640;
  const h = height;
  const pad = { l: 44, r: 14, t: 18, b: 26 };
  const x0 = dayNum(from);
  const x1 = Math.max(dayNum(to), x0 + 1);
  const inRange = (p) => p.x >= from && p.x <= to && typeof p.y === 'number' && Number.isFinite(p.y);
  const clean = series.map((s) => ({ ...s, points: s.points.filter(inRange).sort((a, b) => a.x.localeCompare(b.x)) }));
  const ys = clean.flatMap((s) => s.points.map((p) => p.y));
  if (!ys.length) {
    return `<svg viewBox="0 0 ${w} ${h}" class="chart"><text class="empty" x="${w / 2}" y="${h / 2}">No data yet</text></svg>`;
  }
  if (target && typeof target.y === 'number') ys.push(target.y);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo;
  lo -= span * 0.08;
  hi += span * 0.08;
  const X = (iso) => pad.l + ((dayNum(iso) - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);

  let out = `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img">`;
  for (let i = 0; i <= 3; i += 1) {
    const v = lo + ((hi - lo) * i) / 3;
    out += `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/>`;
    out += `<text class="axis" x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  out += `<text class="axis" x="${pad.l}" y="${h - 6}">${shortDate(from)}</text>`;
  out += `<text class="axis" x="${w - pad.r}" y="${h - 6}" text-anchor="end">${shortDate(to)}</text>`;
  markers.filter((m) => m.x >= from && m.x <= to).forEach((m, i) => {
    const x = X(m.x);
    const isRightEdge = x >= pad.l + 0.7 * (w - pad.l - pad.r);
    out += `<line class="marker" x1="${x}" x2="${x}" y1="${pad.t}" y2="${h - pad.b}"/>`;
    out += `<text class="marker-label" ${isRightEdge ? 'text-anchor="end"' : ''} x="${isRightEdge ? x - 4 : x + 4}" y="${pad.t + 10 + (i % 3) * 12}">${esc(m.label)}</text>`;
  });
  if (target && typeof target.y === 'number') {
    out += `<line class="target" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(target.y)}" y2="${Y(target.y)}"/>`;
    out += `<text class="target-label" x="${w - pad.r}" y="${Y(target.y) - 5}" text-anchor="end">${esc(target.label)}</text>`;
  }
  for (const s of clean) {
    if (!s.points.length) continue;
    if (s.points.length > 1) {
      out += `<polyline class="line" style="--c:${s.color}" points="${s.points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}"/>`;
    }
    out += s.points.map((p) => `<circle class="pt" style="--c:${s.color}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.5"><title>${shortDate(p.x)} · ${esc(s.name)}: ${p.y}${unit}</title></circle>`).join('');
  }
  if (clean.length > 1) {
    let lx = pad.l + 4;
    for (const s of clean) {
      out += `<text class="legend" x="${lx}" y="${pad.t - 5}" fill="${s.color}">● ${esc(s.name)}</text>`;
      lx += 16 + s.name.length * 7;
    }
  }
  return `${out}</svg>`;
}

export function ring({ value, max, label, display, color }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const f = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return `<div class="ring"><svg viewBox="0 0 100 100">
    <circle class="track" cx="50" cy="50" r="${r}"/>
    <circle class="fill" style="--c:${color}" cx="50" cy="50" r="${r}" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>
    <text x="50" y="55" text-anchor="middle">${esc(display)}</text></svg><div class="k">${esc(label)}</div></div>`;
}

// Picks one number per day out of /api/days results.
export function seriesFrom(days, pick) {
  return days.filter((d) => d.data).map((d) => ({ x: d.date, y: pick(d.data, d.totals) })).filter((p) => typeof p.y === 'number');
}
