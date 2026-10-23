// Series colors for charts (owner: UI-B).
// Identity rule: a series' color follows its entity, never its rank. Tools use
// their brand accent (tools.js); everything else takes a categorical slot in a
// fixed, CVD-validated order (dark + light stepped separately).
import { TOOLS } from '../tools.js';
import { app } from '../store.svelte.js';

export const CATEGORICAL = {
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#2f9e2f', '#9085e9', '#e66767'],
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
};

/** neutral used for "Other" and previous-period overlays */
export const NEUTRAL = { dark: '#7c8496', light: '#8a90a0' };

const theme = () => (app.theme === 'light' ? 'light' : 'dark');

/** Stable key → slot assignment for the session (so a filter never repaints survivors). */
const slots = new Map();
export function slotOf(key) {
  if (!slots.has(key)) slots.set(key, slots.size % CATEGORICAL.dark.length);
  return slots.get(key);
}

export function seriesColor(key, t = theme()) {
  if (key === 'other' || key === 'Other') return NEUTRAL[t];
  const tool = TOOLS[key];
  if (tool) return t === 'light' ? tool.light : tool.color;
  return CATEGORICAL[t][slotOf(String(key))];
}

/** Colors for an ordered list of keys; >8 distinct non-tool keys fold into "other". */
export function colorize(series, t = theme()) {
  return series.map((s) => ({ ...s, color: s.color || seriesColor(s.key, t) }));
}

/** Fold everything past `max` series (by total) into one "Other" series. */
export function foldSeries(series, max = 7) {
  if (series.length <= max) return series;
  const total = (s) => s.values.reduce((a, v) => a + (v || 0), 0);
  const sorted = series.slice().sort((a, b) => total(b) - total(a));
  const keep = sorted.slice(0, max);
  const rest = sorted.slice(max);
  const n = rest[0].values.length;
  const values = Array.from({ length: n }, (_, i) => rest.reduce((a, s) => a + (s.values[i] || 0), 0));
  const keepKeys = new Set(keep.map((s) => s.key));
  return [...series.filter((s) => keepKeys.has(s.key)), { key: 'other', label: `Other (${rest.length})`, values }];
}
