// Formatting for usage numbers (cost, durations, ratios). Dependency-free.
import { fmtNum, timeAgo } from './format.js';

export function fmtUsd(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n === 0) return '$0';
  if (Math.abs(n) < 0.01) return '<$0.01';
  if (Math.abs(n) >= 1000) return '$' + fmtNum(n);
  return '$' + n.toFixed(2);
}

export function fmtDur(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const s = Math.round(Number(ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
  return `${Math.round(h / 24)}d`;
}

export function fmtPct(v, digits = 0) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${(Number(v) * 100).toFixed(digits)}%`;
}

/** Render a `{ value, unit }` stat from the usage API. */
export function fmtStat(value, unit, now = Date.now()) {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  switch (unit) {
    case 'usd': return fmtUsd(value);
    case 'ms': return fmtDur(value);
    case 'pct': return fmtPct(value, value < 0.1 ? 1 : 0);
    case 'time': return timeAgo(value, now);
    case 'tokens': return fmtNum(value);
    default: return fmtNum(value);
  }
}
