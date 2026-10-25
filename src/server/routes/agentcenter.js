import os from 'node:os';
import { HttpError } from '../router.js';
import { maskDeep } from '../mask.js';
import { guardSync } from '../../files/syncguard.js';
import { FileError } from '../../files/paths.js';
import { scanAgentSetup, rulesForFile } from '../../agentcenter/setup.js';
import { listTemplates, renderTemplate } from '../../agentcenter/templates.js';
import { syncStatus, syncPlan } from '../../agentcenter/sync.js';
import { sessionTimeline, locateTranscript, listCodexTranscripts, readTranscriptUsageCached } from '../../agentcenter/transcript.js';
import { estimateCosts } from '../../agentcenter/costs.js';
import { contextAt, contextDiff } from '../../agentcenter/timetravel.js';

const TOOLS = new Set(['claude', 'codex', 'cursor']);

function cleanPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw new HttpError(400, 'path required');
  const r = p.replace(/\\/g, '/');
  if (r.startsWith('/') || r.split('/').includes('..')) throw new HttpError(400, 'invalid path');
  return r.replace(/^\.\//, '');
}
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : Number.isNaN(Date.parse(v)) ? null : Date.parse(v); };

export default async function register(router, ctx) {
  const home = ctx.home || os.homedir();
  let setupCache = { ts: 0, v: null };
  const setup = (fresh = false) => {
    if (!fresh && setupCache.v && Date.now() - setupCache.ts < 3000) return setupCache.v;
    setupCache = { ts: Date.now(), v: scanAgentSetup(ctx.root, { home, includeGlobal: ctx.config?.includeGlobalAgents === true }) };
    return setupCache.v;
  };

  router.get('/api/agents/setup', async ({ q, role }) => {
    // the user's home-directory agent config is not project data: admin only
    if (q.get('global') === '1' && ctx.can('state', role)) return scanAgentSetup(ctx.root, { home, includeGlobal: true });
    return setup(q.get('fresh') === '1');
  });

  router.get('/api/agents/rules-for', async ({ q }) => {
    const p = cleanPath(q.get('path'));
    return rulesForFile(ctx.root, p, setup());
  });

  router.get('/api/agents/templates', async () => listTemplates());

  router.get('/api/agents/template/render', async ({ q }) => {
    let vars = {};
    const raw = q.get('vars');
    if (raw) { try { vars = JSON.parse(raw); } catch { throw new HttpError(400, 'vars must be JSON'); } }
    try { return renderTemplate(q.get('id'), vars); } catch (e) { throw new HttpError(404, e.message); }
  });

  router.get('/api/agents/sync/status', async () => syncStatus(ctx.root, ctx.allFiles(), ctx.store.contents));

  router.post('/api/agents/sync/plan', async ({ body }) => {
    try {
      // source/targets must be tracked, non-symlinked project files: this route is read-level and returns file content
      const g = guardSync(ctx, { source: body.source, targets: body.targets });
      return syncPlan(ctx.root, { source: g.source, targets: g.targets, mode: body.mode });
    } catch (e) { throw new HttpError(e instanceof FileError ? e.status : 400, e.message); }
  });

  router.get('/api/agents/session', async ({ q }) => {
    const id = q.get('id');
    if (!id) throw new HttpError(400, 'id required');
    if (!/^[\w.-]{1,200}$/.test(id)) throw new HttpError(400, 'invalid id');
    return maskDeep(await sessionTimeline(ctx.sessions, id, { root: ctx.root, home }));
  });

  router.get('/api/agents/costs', async ({ q }) => {
    const from = num(q.get('from')) || 0;
    const to = num(q.get('to')) || Date.now() + 86400000;
    const list = (await ctx.sessions.list()).filter((s) => !s.lastAt || (s.lastAt >= from && (s.startedAt || s.lastAt) <= to)).slice(0, 300);
    const transcripts = new Map();
    let codexFiles = null; // walked at most once per request, and only for sessions the sessions API can't place
    for (const s of list) {
      const loc = ctx.sessions.fileOf?.(s.sessionId) || locateTranscript(s.sessionId, { root: ctx.root, home, codexFiles: codexFiles ||= listCodexTranscripts(home) });
      const u = loc ? readTranscriptUsageCached(loc.file, loc.tool) : null;
      if (u) transcripts.set(s.sessionId, u);
    }
    return estimateCosts(list, transcripts, ctx.config?.pricing || {}, { from, to });
  });

  const tool = (q) => { const t = q.get('tool') || 'claude'; if (!TOOLS.has(t)) throw new HttpError(400, 'tool must be claude|codex|cursor'); return t; };
  const dirOf = (q) => { const d = q.get('dir') || ''; if (d.startsWith('/') || d.split('/').includes('..')) throw new HttpError(400, 'invalid dir'); return d; };

  router.get('/api/context/at', async ({ q }) => {
    const ts = num(q.get('ts'));
    if (!ts) throw new HttpError(400, 'ts required');
    return contextAt(ctx.store, dirOf(q), tool(q), ts);
  });

  router.get('/api/context/diff', async ({ q }) => {
    const from = num(q.get('from')), to = num(q.get('to')) || Date.now();
    if (!from) throw new HttpError(400, 'from required');
    return contextDiff(ctx.store, dirOf(q), tool(q), from, to);
  });
}
