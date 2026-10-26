// Load the sessions in scope: discover transcripts, digest them under a time budget (the rest keeps warming
// in the background), and merge each Claude session with its subagent transcripts.
import path from 'node:path';
import { priceFor, usdOf } from '../agentcenter/costs.js';
import { claudeProjectDirs, claudeSessions, codexFiles, pool } from './locate.js';
import { digestFile, cachedDigest } from './digest.js';
import { safeRead } from './guard.js';
import { relTo } from './records.js';

const CONCURRENCY = 4;
const metaCache = new Map(); // file -> { mtimeMs, meta }

async function readMeta(sub, home) {
  const c = metaCache.get(sub.metaFile);
  if (c && c.mtimeMs === sub.mtimeMs) return c.meta;
  let meta = null;
  const r = await safeRead(sub.metaFile, home, { maxBytes: 65536 });
  if (r) { try { const o = JSON.parse(r.buf.toString('utf8')); if (o && typeof o === 'object' && !Array.isArray(o)) meta = o; } catch { /* bad meta */ } }
  metaCache.set(sub.metaFile, { mtimeMs: sub.mtimeMs, meta });
  return meta;
}

const str = (v, n = 100) => (typeof v === 'string' && v ? v.slice(0, n) : null);

/** Discover the candidate transcripts for a request. */
export async function candidates(ctx, { range, scope = 'project', tool = 'all' }) {
  const home = ctx.home;
  const minMtime = range.from || 0;
  const out = [];
  if (tool !== 'codex') {
    const dirs = await claudeProjectDirs({ root: ctx.root, home, scope });
    out.push(...await claudeSessions(dirs, home, { minMtime }));
  }
  if (tool !== 'claude') out.push(...await codexFiles(home, { minMtime }));
  out.sort((a, b) => b.lastWrite - a.lastWrite);
  return out;
}

/**
 * Sessions in scope with digests. Work beyond `budgetMs` continues in the background and is reported in coverage.
 * Returns { sessions: Session[], coverage: { transcripts, totalTranscripts, partial } }.
 */
export async function loadSessions(ctx, { range, scope = 'project', tool = 'all', budgetMs = Infinity }) {
  const home = ctx.home;
  const cands = await candidates(ctx, { range, scope, tool });
  const work = pool(cands, CONCURRENCY, async (c) => {
    await digestFile(c, home);
    for (const s of c.subagents) { await digestFile({ ...s, tool: 'claude' }, home); await readMeta(s, home); }
  });
  if (Number.isFinite(budgetMs)) {
    let timer;
    await Promise.race([work, new Promise((r) => { timer = setTimeout(r, Math.max(0, budgetMs)); timer.unref?.(); })]);
    clearTimeout(timer);
  } else await work;

  const sessions = [];
  let parsed = 0, total = 0, partial = false;
  const absRoot = path.resolve(ctx.root);
  for (const c of cands) {
    total += 1 + c.subagents.length;
    const d = cachedDigest(c);
    if (d === undefined) { partial = true; continue; }
    parsed++;
    if (!d) continue;
    if (c.tool === 'codex' && scope !== 'all' && !(d.cwd && (path.resolve(d.cwd) === absRoot || relTo(absRoot, d.cwd)))) continue;
    const subs = [];
    for (const s of c.subagents) {
      const sd = cachedDigest({ ...s, tool: 'claude' });
      if (sd === undefined) { partial = true; continue; }
      parsed++;
      const mc = metaCache.get(s.metaFile);
      if (sd) subs.push({ agentId: sd.agentId || s.agentId, d: sd, meta: mc && mc.mtimeMs === s.mtimeMs ? mc.meta : null });
    }
    sessions.push(buildSession(c, d, subs, ctx));
  }
  return { sessions: sessions.filter((s) => s.startedAt || s.lastAt), coverage: { transcripts: parsed, totalTranscripts: total, partial } };
}

/** Merge a main digest with its subagents and price every message. */
export function buildSession(c, d, subs, ctx) {
  const pricing = ctx.config?.pricing || {};
  const seen = new Set();
  const msgs = [];
  for (const [list, agentId] of [[d.msgs, null], ...subs.map((s) => [s.d.msgs, s.agentId])]) {
    for (const m of list) {
      if (seen.has(m[0]) && !String(m[0]).startsWith('anon-')) continue;
      seen.add(m[0]);
      const u = { input: m[3], output: m[4], cacheRead: m[5], cacheWrite: m[6] };
      const p = priceFor(m[2], pricing);
      msgs.push({ id: m[0], ts: m[1], model: m[2], u, est: usdOf(u, m[2], pricing), saved: (m[5] * Math.max(0, p.input - p.cacheRead)) / 1e6, agentId: m[7] || agentId });
    }
  }
  const est = msgs.reduce((a, m) => a + m.est, 0);
  const cs = Object.values(d.costStates || {});
  const exact = cs.some((x) => x.hasModels || x.usd > 0);
  const cost = exact ? { usd: cs.reduce((a, x) => a + x.usd, 0), linesAdded: cs.reduce((a, x) => a + x.linesAdded, 0), linesRemoved: cs.reduce((a, x) => a + x.linesRemoved, 0) } : null;
  const factor = exact && est > 0 ? cost.usd / est : 1;
  for (const m of msgs) m.usd = m.est * factor;
  if (exact && est === 0 && cost.usd > 0) msgs.push({ id: 'cost-state', ts: d.lastAt, model: 'unknown', u: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, est: 0, saved: 0, usd: cost.usd, agentId: null });
  msgs.sort((a, b) => a.ts - b.ts);
  const all = [d, ...subs.map((s) => s.d)];
  const cat = (k) => all.flatMap((x) => x[k] || []);
  const branch = Object.entries(d.branches || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || d.lastBranch || null;
  const startedAt = Math.min(...all.map((x) => x.startedAt).filter(Boolean), Infinity);
  const lastAt = Math.max(...all.map((x) => x.lastAt), 0);
  return {
    sessionId: d.sessionId || c.sessionId, tool: c.tool, project: c.project || null, cwd: d.cwd, file: c.file,
    title: d.title || null, firstPrompt: d.firstPrompt, agentName: d.agentName,
    startedAt: Number.isFinite(startedAt) ? startedAt : 0, lastAt, branch, branches: d.branches,
    msgs, exact, cost, estUsd: est,
    usd: msgs.reduce((a, m) => a + m.usd, 0),
    main: d, subs,
    tools: cat('tools').sort((a, b) => a.ts - b.ts),
    edits: cat('edits'), denials: cat('denials'), messages: cat('messages'),
    prompts: d.prompts, turns: d.turns, hooks: d.hooks, compactions: d.compactions, interrupts: d.interrupts,
    away: d.away, apiErrors: cat('apiErrors'), permModes: d.permModes, fileHistory: d.fileHistory, spawns: d.spawns,
    advisor: d.advisor, thinking: d.thinking, slugs: [...new Set(cat('slugs'))],
    spans: unionSpans(cat('spans')),
  };
}

function unionSpans(spans) {
  const s = spans.map((x) => [x[0], x[1]]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) { if (x[1] > last[1]) last[1] = x[1]; } else out.push(x);
  }
  return out;
}

export const sessionTitle = (s) => s.title || s.firstPrompt || '(untitled)';
export { str };
