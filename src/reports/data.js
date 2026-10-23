// Data access for reports: prefers ctx.persist, falls back to in-memory store/analysis.
export const HOUR = 3600000, DAY = 86400000, WEEK = 7 * DAY;

export function parseRange(q, now = Date.now()) {
  const get = (k) => (typeof q?.get === 'function' ? q.get(k) : q?.[k]);
  let to = Number(get('to')); if (!Number.isFinite(to) || to <= 0) to = now;
  let from = Number(get('from')); if (!Number.isFinite(from) || from <= 0) from = to - 7 * DAY;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}
export function prevRangeOf({ from, to }) {
  const len = to - from;
  return { from: from - len, to: from };
}

export async function getEvents(ctx, from, to) {
  let list = null;
  try {
    if (ctx.persist?.events?.query) list = await ctx.persist.events.query({ from, to, limit: 1000000 });
  } catch { list = null; }
  if (!Array.isArray(list)) list = ctx.store?.events || [];
  return list.filter((e) => e && e.ts >= from && e.ts <= to);
}

export async function getMetrics(ctx, from, to) {
  try {
    if (ctx.persist?.metrics?.query) {
      const l = await ctx.persist.metrics.query({ from, to });
      if (Array.isArray(l)) return l.slice().sort((a, b) => a.ts - b.ts);
    }
  } catch { /* fall through */ }
  return [];
}

/** Current snapshot from analysis (fallback when no persisted metrics). */
export async function currentMetric(ctx, now = Date.now()) {
  const files = ctx.allFiles ? ctx.allFiles() : [];
  let tokens = 0; const byTool = {}, byKind = {};
  for (const f of files) { tokens += f.tokens || 0; byTool[f.tool] = (byTool[f.tool] || 0) + 1; byKind[f.kind] = (byKind[f.kind] || 0) + 1; }
  let a = null;
  try { a = await ctx.analysis(); } catch { /* ignore */ }
  const tasks = a?.tasks || [];
  return {
    ts: now, files: files.length, tokens, health: a?.health?.score ?? null, grade: a?.health?.grade ?? null,
    tasksOpen: tasks.filter((t) => !t.done).length, tasksDone: tasks.filter((t) => t.done).length, byTool, byKind,
  };
}

export const evTool = (e) => e.file?.tool || e.tool || 'unknown';
export const evKind = (e) => e.file?.kind || e.kind || 'unknown';
export const evLines = (e) => (e.stats?.added || 0) + (e.stats?.removed || 0);

export function bucketStart(ts, bucket) {
  if (bucket === 'hour') return Math.floor(ts / HOUR) * HOUR;
  if (bucket === 'week') { const off = 4 * DAY; return Math.floor((ts - off) / WEEK) * WEEK + off; }
  return Math.floor(ts / DAY) * DAY;
}
export const bucketStep = (bucket) => (bucket === 'hour' ? HOUR : bucket === 'week' ? WEEK : DAY);

export function makeBuckets(from, to, bucket) {
  const step = bucketStep(bucket);
  const out = [];
  for (let t = bucketStart(from, bucket); t <= to && out.length < 2000; t += step) out.push(t);
  return out;
}
