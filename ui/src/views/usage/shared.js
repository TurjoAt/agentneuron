// Shared helpers for the Usage & cost tabs and the Sessions views.
import { fmtNum } from '../../lib/format.js';

export const RANGES = ['24h', '7d', '30d', '90d', 'all'];
export const AGENTS = ['all', 'claude', 'codex'];
const AGENT_SET = new Set(['claude', 'codex']);

/** Range from route params (default 30d). */
export const rangeOf = (params = {}) => (RANGES.includes(params.range) ? params.range : '30d');

/**
 * Agent filter from route params. `agent` is the canonical key; `tool=claude|codex`
 * is accepted as an alias because entityHref('agent') links with `tool=`.
 */
export function agentOf(params = {}) {
  if (AGENT_SET.has(params.agent)) return params.agent;
  if (AGENT_SET.has(params.tool)) return params.tool;
  return 'all';
}
/** Tool name to highlight on the Tools tab (`tool=` that is not an agent id). */
export const toolNameOf = (params = {}) => (params.tool && !AGENT_SET.has(params.tool) && params.tool !== 'all' ? params.tool : '');

/** Query object for /api/usage/* routes. Never forwards a tool *name* as `tool`. */
export const usageQuery = (range, agent, extra = {}) => ({ range, tool: agent === 'all' ? undefined : agent, ...extra });

export function money(v, { est = false, digits = null } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  const d = digits ?? (a >= 100 ? 0 : 2);
  const s = a >= 10_000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : a.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${est ? '~' : ''}${v < 0 ? '−' : ''}$${s}`;
}

export function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1).replace(/\.0$/, '') : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.round(h / 24)}d`;
}

export const pct = (v, digits = 1) => (v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(digits).replace(/\.0$/, '')}%`);
export const tokTotal = (t) => (t ? (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) : null);
export const fmtTok = (n) => (n == null ? '—' : fmtNum(n));

/** YYYY-MM-DD as local midnight (Date.parse of a bare date is UTC). */
export const dayMs = (d) => (typeof d === 'number' ? d : Date.parse(`${d}T00:00:00`));

/** Compare the second half of a series with the first half (for KPI trend pills). */
export function halves(values) {
  const v = (values || []).map((x) => x || 0);
  if (v.length < 4) return null;
  const mid = Math.floor(v.length / 2);
  const a = v.slice(0, mid).reduce((s, x) => s + x, 0);
  const b = v.slice(v.length - mid).reduce((s, x) => s + x, 0);
  return { prev: a, now: b };
}

/** Short model name: claude-opus-4-5 -> Opus 4.5, gpt-5-codex -> GPT-5 Codex. */
export function modelLabel(m) {
  if (!m) return 'unknown';
  const c = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/i.exec(m);
  if (c) return `${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[2]}${c[3] && c[3].length <= 2 ? '.' + c[3] : ''}`;
  if (/^gpt-/i.test(m)) return m.replace(/^gpt/i, 'GPT').replace(/-codex$/i, ' Codex');
  return m;
}

export const shortId = (id) => (!id ? '—' : id.length > 14 ? `${id.slice(0, 8)}…` : id);
export const sessionLabel = (s) => (s?.title && s.title.trim() ? s.title : `Session ${shortId(s?.sessionId)}`);

export const SEVERITY = { high: { cls: 'err', label: 'High' }, medium: { cls: 'warn', label: 'Medium' }, low: { cls: 'info', label: 'Low' } };
export const ANOMALY = { 'cost-spike': 'Cost spike', 'error-loop': 'Error loop', 'context-jump': 'Context jump', 'slow-turn': 'Slow turn', denials: 'Denials' };
export const ANOMALY_ICON = { 'cost-spike': 'flame', 'error-loop': 'refresh', 'context-jump': 'layers', 'slow-turn': 'clock', denials: 'lock' };

/** Copy text to the clipboard with a textarea fallback (CSP-safe). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
