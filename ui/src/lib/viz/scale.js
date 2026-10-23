// Small scale/format helpers shared by the SVG chart components.
import { fmtNum } from '../format.js';

/** Nice ticks for [0, max] (or [min,max]) — returns { ticks, max }. */
export function niceTicks(min, max, count = 4) {
  if (!(max > min)) max = min + 1;
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { ticks, min: lo, max: hi };
}

const pad = (n) => String(n).padStart(2, '0');

/** Short x-axis label for a bucket timestamp given the bucket size. */
export function fmtBucket(ts, bucket = 'day') {
  const d = new Date(ts);
  if (bucket === 'hour') return `${pad(d.getHours())}:00`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Long tooltip label for a bucket. */
export function fmtBucketLong(ts, bucket = 'day') {
  const d = new Date(ts);
  if (bucket === 'hour') return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (bucket === 'week') return 'Week of ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Pick ~n evenly spaced indices (always includes first and last). */
export function tickIndices(len, n) {
  if (len <= 0) return [];
  if (len <= n) return Array.from({ length: len }, (_, i) => i);
  const step = (len - 1) / (n - 1);
  const out = new Set();
  for (let i = 0; i < n; i++) out.add(Math.round(i * step));
  return [...out];
}

export const defaultFmt = (v) => fmtNum(v);

export function pctDelta(now, prev) {
  if (prev == null || now == null) return null;
  if (prev === 0) return now === 0 ? 0 : null;
  return ((now - prev) / Math.abs(prev)) * 100;
}

/** Inline-SVG rounded-top rect path (data end rounded, baseline square). */
export function roundedTop(x, y, w, h, r = 4) {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
