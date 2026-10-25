import { createGit2 } from '../git2/index.js';
import { estimateTokens } from '../core/tokens.js';
import { buildReportV1, renderAi, makeScrubber, scrubDeep, exportFilename } from './export.js';
import {
  DAY, parseRange, prevRangeOf, getEvents, getMetrics, currentMetric, evTool, evKind, evLines,
  bucketStart, makeBuckets,
} from './data.js';

export { parseRange, prevRangeOf };
export { SCHEMA, buildReportV1, renderAi, rangeFromSpec, slugify, exportFilename, collectContents } from './export.js';

const gitFor = (ctx) => ctx.git2 || (ctx.git2 = createGit2(ctx.root));
const withTimeout = (p, ms, fb) => new Promise((res) => {
  const t = setTimeout(() => res(fb), ms);
  Promise.resolve(p).then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(fb); });
});

function metricAt(metrics, ts) { // last metric at or before ts
  let m = null;
  for (const x of metrics) { if (x.ts <= ts) m = x; else break; }
  return m;
}

async function sessionsList(ctx) {
  try { return (await withTimeout(ctx.sessions?.list?.(), 5000, [])) || []; } catch { return []; }
}

export function computeKpis({ events, metrics, commits, sessions, range, nowMetric }) {
  const files = new Set();
  let linesAdded = 0, linesRemoved = 0, agentEdits = 0;
  for (const e of events) {
    files.add(e.path);
    linesAdded += e.stats?.added || 0;
    linesRemoved += e.stats?.removed || 0;
    if (e.agent) agentEdits++;
  }
  const inRange = metrics.filter((m) => m.ts >= range.from && m.ts <= range.to);
  const before = metricAt(metrics, range.from);
  const first = before || inRange[0] || null;
  const last = inRange.length ? inRange[inRange.length - 1] : (nowMetric || before);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const tokensNow = num(last?.tokens), healthNow = num(last?.health);
  const tokensDelta = tokensNow !== null && num(first?.tokens) !== null ? tokensNow - first.tokens : 0;
  const healthDelta = healthNow !== null && num(first?.health) !== null ? healthNow - first.health : 0;
  let tasksOpened = 0, tasksClosed = 0;
  if (first && last && first !== last) {
    const total = (m) => (m.tasksOpen || 0) + (m.tasksDone || 0);
    tasksOpened = Math.max(0, total(last) - total(first));
    tasksClosed = Math.max(0, (last.tasksDone || 0) - (first.tasksDone || 0));
  }
  const active = sessions.filter((s) => s.lastAt >= range.from && (s.startedAt || s.lastAt) <= range.to).length;
  return {
    changes: events.length, filesTouched: files.size, linesAdded, linesRemoved,
    tokensNow, tokensDelta, healthNow, healthDelta, tasksOpened, tasksClosed,
    commits: commits.length, agentEdits, activeSessions: active,
  };
}

export async function summary(ctx, range) {
  const prevRange = prevRangeOf(range);
  const git = gitFor(ctx);
  const [events, pEvents, metrics, commits, pCommits, sessions] = await Promise.all([
    getEvents(ctx, range.from, range.to), getEvents(ctx, prevRange.from, prevRange.to),
    getMetrics(ctx, prevRange.from, range.to),
    withTimeout(git.commitTimes(range.from, range.to), 8000, []), withTimeout(git.commitTimes(prevRange.from, prevRange.to), 8000, []),
    sessionsList(ctx),
  ]);
  const nowMetric = Date.now() <= range.to + 60000 ? await currentMetric(ctx) : null;
  const kpis = computeKpis({ events, metrics, commits, sessions, range, nowMetric: metrics.length ? null : nowMetric });
  const prev = computeKpis({ events: pEvents, metrics, commits: pCommits, sessions, range: prevRange, nowMetric: null });
  return { range, prevRange, kpis, prev };
}

const OTHER_AFTER = 12;
function finalizeSplit(map, buckets) {
  const keys = [...map.keys()].sort((a, b) => sum(map.get(b)) - sum(map.get(a)));
  const series = [];
  const top = keys.slice(0, OTHER_AFTER);
  for (const k of top) series.push({ key: k, values: map.get(k) });
  if (keys.length > OTHER_AFTER) {
    const other = new Array(buckets.length).fill(0);
    for (const k of keys.slice(OTHER_AFTER)) map.get(k).forEach((v, i) => { other[i] += v; });
    series.push({ key: 'other', values: other });
  }
  return series;
}
const sum = (a) => a.reduce((s, v) => s + v, 0);

export async function series(ctx, range, { bucket = 'day', metric = 'changes', split = 'none' } = {}) {
  if (!['hour', 'day', 'week'].includes(bucket)) bucket = 'day';
  const buckets = makeBuckets(range.from, range.to, bucket);
  const idx = new Map(buckets.map((t, i) => [t, i]));
  const at = (ts) => idx.get(bucketStart(ts, bucket));
  const out = { range, bucket, metric, split, buckets, series: [] };

  if (['changes', 'lines', 'agents'].includes(metric)) {
    const events = await getEvents(ctx, range.from, range.to);
    const keyOf = {
      none: () => 'all', tool: evTool, kind: evKind,
      author: (e) => e.agent?.tool || 'human',
      session: (e) => e.agent?.sessionId || 'none',
    }[split] || (() => 'all');
    const map = new Map();
    if (split === 'none') map.set('all', new Array(buckets.length).fill(0));
    for (const e of events) {
      if (metric === 'agents' && !e.agent) continue;
      const i = at(e.ts); if (i === undefined) continue;
      const k = keyOf(e);
      if (!map.has(k)) map.set(k, new Array(buckets.length).fill(0));
      map.get(k)[i] += metric === 'lines' ? evLines(e) : 1;
    }
    out.series = finalizeSplit(map, buckets);
    return out;
  }
  if (metric === 'commits') {
    const commits = await withTimeout(gitFor(ctx).commitTimes(range.from, range.to), 8000, []);
    const map = new Map();
    if (split !== 'author') map.set('all', new Array(buckets.length).fill(0));
    for (const c of commits) {
      const i = at(c.ts); if (i === undefined) continue;
      const k = split === 'author' ? c.author : 'all';
      if (!map.has(k)) map.set(k, new Array(buckets.length).fill(0));
      map.get(k)[i]++;
    }
    out.series = finalizeSplit(map, buckets);
    return out;
  }
  if (['tokens', 'health', 'tasks'].includes(metric)) {
    let metrics = await getMetrics(ctx, range.from - 90 * DAY, range.to);
    if (!metrics.length) metrics = [await currentMetric(ctx)];
    const fields = metric === 'tasks' ? [['open', 'tasksOpen'], ['done', 'tasksDone']]
      : metric === 'tokens' ? [['all', 'tokens']] : [['all', 'health']];
    for (const [key, f] of fields) {
      const values = buckets.map((t, i) => {
        const end = (buckets[i + 1] ?? (t + bucketStepOf(bucket))) - 1;
        const m = metricAt(metrics, end);
        return m && typeof m[f] === 'number' ? m[f] : null;
      });
      out.series.push({ key, values });
    }
    return out;
  }
  out.error = 'unknown metric';
  return out;
}
function bucketStepOf(b) { return b === 'hour' ? 3600000 : b === 'week' ? 7 * DAY : DAY; }

export async function top(ctx, range, by = 'churn') {
  if (by === 'churn') {
    const events = await getEvents(ctx, range.from, range.to);
    const m = new Map();
    for (const e of events) {
      const r = m.get(e.path) || { path: e.path, changes: 0, added: 0, removed: 0, lastTs: 0 };
      r.changes++; r.added += e.stats?.added || 0; r.removed += e.stats?.removed || 0; r.lastTs = Math.max(r.lastTs, e.ts);
      m.set(e.path, r);
    }
    return [...m.values()].sort((a, b) => b.changes - a.changes || (b.added + b.removed) - (a.added + a.removed)).slice(0, 50);
  }
  const files = ctx.allFiles ? ctx.allFiles() : [];
  if (by === 'tokens') return files.map((f) => ({ path: f.path, tokens: f.tokens || 0, tool: f.tool, kind: f.kind })).sort((a, b) => b.tokens - a.tokens).slice(0, 50);
  if (by === 'stale') {
    const now = Date.now();
    return files.map((f) => ({ path: f.path, mtime: f.mtime, ageDays: Math.floor((now - f.mtime) / DAY), tool: f.tool, kind: f.kind }))
      .sort((a, b) => a.mtime - b.mtime).slice(0, 50);
  }
  if (by === 'links') {
    const a = await ctx.analysis();
    const inb = new Map(), outb = new Map();
    for (const e of a.graph?.edges || []) {
      inb.set(e.to, (inb.get(e.to) || 0) + 1);
      outb.set(e.from, (outb.get(e.from) || 0) + 1);
    }
    return [...new Set([...inb.keys(), ...outb.keys()])].map((p) => ({ path: p, inbound: inb.get(p) || 0, outbound: outb.get(p) || 0 }))
      .sort((x, y) => y.inbound - x.inbound || y.outbound - x.outbound).slice(0, 50);
  }
  return null;
}

export async function heatmap(ctx, days = 365, now = Date.now()) {
  days = Math.max(1, Math.min(730, Number(days) || 365));
  const from = bucketStart(now, 'day') - (days - 1) * DAY;
  const [events, commits] = await Promise.all([getEvents(ctx, from, now), withTimeout(gitFor(ctx).commitTimes(from, now), 10000, [])]);
  const counts = new Map();
  const add = (ts) => { const d = new Date(bucketStart(ts, 'day')).toISOString().slice(0, 10); counts.set(d, (counts.get(d) || 0) + 1); };
  events.forEach((e) => add(e.ts));
  commits.forEach((c) => add(c.ts));
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from + i * DAY).toISOString().slice(0, 10);
    out.push({ date: d, count: counts.get(d) || 0 });
  }
  return out;
}

/** Full report object used by exports. */
export async function buildReport(ctx, range) {
  const [s, ch, ln, cm, ag, tp] = await Promise.all([
    summary(ctx, range),
    series(ctx, range, { bucket: 'day', metric: 'changes' }),
    series(ctx, range, { bucket: 'day', metric: 'lines' }),
    series(ctx, range, { bucket: 'day', metric: 'commits' }),
    series(ctx, range, { bucket: 'day', metric: 'agents' }),
    top(ctx, range, 'churn'),
  ]);
  const daily = ch.buckets.map((t, i) => ({
    date: new Date(t).toISOString().slice(0, 10),
    changes: ch.series[0]?.values[i] || 0, lines: ln.series[0]?.values[i] || 0,
    commits: cm.series[0]?.values[i] || 0, agents: ag.series[0]?.values[i] || 0,
  }));
  return { ...s, daily, top: tp };
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : (/^[=+\-@]/.test(s) ? `'${s}` : s); };

export function renderCsv(rep) {
  const lines = ['date,changes,lines,commits,agent_edits'];
  for (const d of rep.daily) lines.push([d.date, d.changes, d.lines, d.commits, d.agents].map(csvCell).join(','));
  return lines.join('\n') + '\n';
}

const KPI_LABELS = [
  ['changes', 'Changes'], ['filesTouched', 'Files touched'], ['linesAdded', 'Lines added'], ['linesRemoved', 'Lines removed'],
  ['commits', 'Commits'], ['agentEdits', 'Agent edits'], ['activeSessions', 'Active sessions'], ['tokensNow', 'Tokens'],
  ['tokensDelta', 'Token delta'], ['healthNow', 'Health'], ['healthDelta', 'Health delta'], ['tasksOpened', 'Tasks opened'], ['tasksClosed', 'Tasks closed'],
];
const iso = (t) => new Date(t).toISOString();
const fmt = (v) => (v === null || v === undefined ? '-' : String(v));
const mdCell = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMd(rep) {
  const L = [`# agentneuron report${rep.project ? `: ${mdCell(rep.project)}` : ''}`, '', `Range: ${iso(rep.range.from)} to ${iso(rep.range.to)} (previous: ${iso(rep.prevRange.from)} to ${iso(rep.prevRange.to)})`, '',
    '| KPI | Value | Previous |', '|---|---:|---:|'];
  for (const [k, label] of KPI_LABELS) L.push(`| ${label} | ${fmt(rep.kpis[k])} | ${fmt(rep.prev[k])} |`);
  L.push('', '## Top churned files', '', '| File | Changes | Added | Removed |', '|---|---:|---:|---:|');
  for (const r of rep.top.slice(0, 20)) L.push(`| ${mdCell(r.path)} | ${r.changes} | ${r.added} | ${r.removed} |`);
  L.push('', '## Daily', '', '| Date | Changes | Lines | Commits | Agent edits |', '|---|---:|---:|---:|---:|');
  for (const d of rep.daily) L.push(`| ${d.date} | ${d.changes} | ${d.lines} | ${d.commits} | ${d.agents} |`);
  return L.join('\n') + '\n';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderHtml(rep) {
  const max = Math.max(1, ...rep.daily.map((d) => d.changes));
  const bars = rep.daily.map((d) => `<div title="${esc(d.date)}: ${d.changes}" style="flex:1;background:#6aa;height:${Math.round((d.changes / max) * 100)}%"></div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>agentneuron report</title>
<style>body{font:15px system-ui;max-width:860px;margin:2rem auto;padding:0 1rem;color:#222}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border-bottom:1px solid #ddd;padding:.3rem .5rem;text-align:left}td.n,th.n{text-align:right}.bars{display:flex;align-items:flex-end;gap:1px;height:80px}</style></head><body>
<h1>agentneuron report${rep.project ? `: ${esc(rep.project)}` : ''}</h1><p>${esc(iso(rep.range.from))} to ${esc(iso(rep.range.to))}</p>
<table><tr><th>KPI</th><th class="n">Value</th><th class="n">Previous</th></tr>
${KPI_LABELS.map(([k, l]) => `<tr><td>${esc(l)}</td><td class="n">${esc(fmt(rep.kpis[k]))}</td><td class="n">${esc(fmt(rep.prev[k]))}</td></tr>`).join('\n')}
</table><h2>Changes per day</h2><div class="bars">${bars}</div>
<h2>Top churned files</h2><table><tr><th>File</th><th class="n">Changes</th><th class="n">Added</th><th class="n">Removed</th></tr>
${rep.top.slice(0, 20).map((r) => `<tr><td>${esc(r.path)}</td><td class="n">${r.changes}</td><td class="n">${r.added}</td><td class="n">${r.removed}</td></tr>`).join('\n')}
</table></body></html>
`;
}

export const EXPORT_FORMATS = ['csv', 'md', 'html', 'json', 'ai', 'llm'];
const EXPORT_TYPES = {
  csv: ['text/csv; charset=utf-8', 'csv'], md: ['text/markdown; charset=utf-8', 'md'], html: ['text/html; charset=utf-8', 'html'],
  json: ['application/json; charset=utf-8', 'json'], ai: ['text/markdown; charset=utf-8', 'ai.md'],
};

/**
 * Export a report. format: csv | md | html | json | ai (alias llm).
 * opts.includeContent appends capped contents of the main context files (json, ai).
 * Returns { body, type, filename, format, tokens? }. All text is secret-masked and has no absolute paths.
 */
export async function exportReport(ctx, range, format = 'csv', opts = {}) {
  let f = String(format || 'csv').toLowerCase();
  if (f === 'llm') f = 'ai';
  if (!EXPORT_TYPES[f]) throw new Error(`unknown export format "${String(format).slice(0, 20)}" (use ${EXPORT_FORMATS.join('|')})`);
  const rep = await buildReport(ctx, range);
  const v1 = await buildReportV1(ctx, rep, { includeContent: !!opts.includeContent && (f === 'json' || f === 'ai') });
  const scrub = makeScrubber(ctx.root);
  const [type, ext] = EXPORT_TYPES[f];
  const out = { format: f, type, filename: exportFilename(v1.project.name, range, ext) };
  if (f === 'json') out.body = scrub(JSON.stringify(v1, null, 2)) + '\n';
  else if (f === 'ai') { const r = renderAi(v1); out.body = scrub(r.body); out.tokens = r.tokens; }
  else {
    const named = scrubDeep({ ...rep, project: v1.project.name }, scrub);
    out.body = scrub(f === 'md' ? renderMd(named) : f === 'html' ? renderHtml(named) : renderCsv(named));
  }
  if (out.tokens === undefined) out.tokens = estimateTokens(out.body);
  return out;
}
