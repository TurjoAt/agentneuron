// Usage analytics over Claude Code / Codex local data. Shapes: docs/internal/usage-contract.md; reference: docs/usage.md.
import path from 'node:path';
import { liveAccess } from '../live/coord.js';
import { FileError } from '../files/paths.js';
import { readRegularAsync } from '../files/safeio.js';
import { homeOf, safeRead, safeStat } from './guard.js';
import { claudeProjectDirs } from './locate.js';
import { loadSessions, candidates, buildSession, sessionTitle } from './load.js';
import { digestFile } from './digest.js';
import { readTimeline } from './timeline.js';
import { readMemory, readPlans } from './memory.js';
import { auditSettings } from './settings.js';
import * as V from './views.js';
import { clip, relTo, round } from './records.js';

const DAY = 86400e3;
export const SUMMARY_BUDGET_MS = 2500;
export const DEFAULT_BUDGET_MS = 8000;
const MAX_FILE_VERSION = 1024 * 1024;

export const rangeOf = (spec = '30d', now = Date.now()) => {
  if (spec === 'all') return { from: 0, to: now };
  const m = /^(\d+)(h|d)$/.exec(String(spec));
  const ms = m ? Number(m[1]) * (m[2] === 'h' ? 3600e3 : DAY) : 30 * DAY;
  return { from: now - ms, to: now };
};

const historyCache = new Map(); // file -> { mtimeMs, size, rows }

/** ~/.claude/history.jsonl rows: { ts, prompt, length, project, sessionId, pasted }. pastedContents is only counted. */
export async function readHistory(home) {
  const file = path.join(home, '.claude', 'history.jsonl');
  const st = await safeStat(file, home);
  if (!st) return [];
  const c = historyCache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.rows;
  const r = await safeRead(file, home, { tail: 16 * 1024 * 1024 });
  const rows = [];
  if (r) {
    let text = r.buf.toString('utf8');
    if (r.st.size > r.buf.length) text = text.slice(text.indexOf('\n') + 1);
    for (const line of text.split('\n')) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!o || typeof o !== 'object' || typeof o.display !== 'string' || !o.display.trim()) continue;
      const pc = o.pastedContents;
      rows.push({ ts: typeof o.timestamp === 'number' ? o.timestamp : Date.parse(o.timestamp) || 0, prompt: clip(o.display, 2000), length: o.display.length,
        project: typeof o.project === 'string' ? o.project : null, sessionId: typeof o.sessionId === 'string' ? o.sessionId.slice(0, 200) : null,
        pasted: pc && typeof pc === 'object' ? (Array.isArray(pc) ? pc.length : Object.keys(pc).length) : 0 });
    }
  }
  historyCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, rows });
  return rows;
}

/**
 * @param ctx { root, config, home?, store?, usageBudgetMs? } (server ctx, MCP ctx or CLI ctx)
 */
export function getUsage(ctx = {}) {
  const config = ctx.config || {};
  const c = { root: path.resolve(ctx.root || process.cwd()), home: homeOf(ctx), config };
  const budget = (dflt) => (ctx.usageBudgetMs !== undefined ? ctx.usageBudgetMs : dflt);
  const scopeOf = (o = {}) => (o.scope === 'all' ? 'all' : 'project');

  async function load(o = {}, dflt = DEFAULT_BUDGET_MS) {
    const range = rangeOf(o.range);
    const res = await loadSessions(c, { range, scope: scopeOf(o), tool: o.tool || 'all', budgetMs: budget(dflt) });
    const sessions = res.sessions.filter((s) => V.activeInRange(s, range));
    return { range, sessions, coverage: V.coverageOf(sessions, range, res.coverage), generatedAt: Date.now() };
  }

  /** Locate one session (main + subagents) in scope and digest it fully. */
  async function findSession(id, o = {}) {
    const cands = await candidates(c, { range: { from: 0, to: Date.now() }, scope: scopeOf(o), tool: 'all' });
    for (const cand of cands) {
      if (cand.tool === 'claude' && cand.sessionId !== id) continue;
      if (cand.tool === 'codex' && !(path.basename(cand.file) === `${id}.jsonl` || path.basename(cand.file).endsWith(`-${id}.jsonl`))) continue;
      const d = await digestFile(cand, c.home);
      if (!d) continue;
      if (cand.tool === 'codex' && scopeOf(o) !== 'all' && !(d.cwd && (path.resolve(d.cwd) === c.root || relTo(c.root, d.cwd)))) continue;
      const subs = [];
      for (const s of cand.subagents) {
        const sd = await digestFile({ ...s, tool: 'claude' }, c.home);
        let meta = null;
        const r = await safeRead(s.metaFile, c.home, { maxBytes: 65536 });
        if (r) { try { meta = JSON.parse(r.buf.toString('utf8')); } catch { /* bad meta */ } }
        if (sd) subs.push({ agentId: sd.agentId || s.agentId, d: sd, meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null });
      }
      return { cand, s: buildSession(cand, d, subs, c) };
    }
    return null;
  }

  const fileRows = (s) => {
    const by = new Map();
    for (const e of s.fileHistory) {
      const p = relTo(c.root, e.path) || e.path;
      const list = by.get(p) || [];
      list.push({ backup: e.backup || `new@v${e.version}`, version: e.version, ts: e.ts || null, messageId: e.messageId });
      by.set(p, list);
    }
    return [...by].map(([p, versions]) => ({ path: p, versions: versions.sort((a, b) => a.version - b.version) }));
  };

  async function entity(kind, id) {
    const out = { kind, id, title: id, subtitle: '', stats: [], related: { sessions: [], files: [], commits: [], tasks: [], tools: [] }, links: [] };
    const { sessions } = await load({ range: '90d' });
    const sref = (s) => ({ sessionId: s.sessionId, title: sessionTitle(s), ts: s.lastAt || s.startedAt });
    const rel = (p) => relTo(c.root, p) || p;
    const toolCounts = (list) => { const m = new Map(); for (const t of list) m.set(t.name, (m.get(t.name) || 0) + 1); return [...m].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls).slice(0, 20); };
    const tasks = async () => { try { const { getBoard } = await import('../board/index.js'); return ctx.store ? getBoard(ctx).get('viewer').tasks || [] : []; } catch { return []; } };
    const git = async () => { try { const { createGit2 } = await import('../git2/index.js'); return createGit2(c.root); } catch { return null; } };
    const commitsBetween = async (from, to, p) => {
      const g = await git();
      if (!g) return [];
      const r = await g.log({ since: new Date(from).toISOString(), until: new Date(to).toISOString(), limit: 20, path: p }).catch(() => []);
      return Array.isArray(r) ? r.map((x) => ({ hash: x.hash, subject: x.subject, ts: Date.parse(x.date) || null })) : [];
    };
    const stat = (label, value, unit) => (unit ? { label, value, unit } : { label, value });
    const taskRef = (t) => ({ id: t.id, title: t.title, status: t.status });
    if (kind === 'session') {
      const s = sessions.find((x) => x.sessionId === id) || (await findSession(id))?.s;
      if (!s) return out;
      const row = V.sessionRow(s, c.root);
      out.title = row.title; out.subtitle = `${s.tool} · ${s.branch || 'no branch'} · ${new Date(s.startedAt || s.lastAt).toISOString()}`;
      out.stats = [stat('Cost', row.usd, 'USD'), stat('Exact cost', row.exact), stat('Tokens', row.tokens.input + row.tokens.output + row.tokens.cacheRead + row.tokens.cacheWrite), stat('Prompts', row.prompts), stat('Tool calls', row.toolCalls), stat('Errors', row.errors), stat('Subagents', row.subagents), stat('Active', row.activeMs, 'ms'), stat('Lines added', row.linesAdded), stat('Lines removed', row.linesRemoved)];
      const files = V.filesOf(s, c.root);
      out.related.files = [...files].map(([p, edits]) => ({ path: p, edits })).sort((a, b) => b.edits - a.edits).slice(0, 50);
      out.related.tools = toolCounts(s.tools);
      out.related.sessions = sessions.filter((x) => x.sessionId !== s.sessionId && x.branch && x.branch === s.branch).sort((a, b) => b.lastAt - a.lastAt).slice(0, 5).map(sref);
      out.related.commits = s.startedAt ? await commitsBetween(s.startedAt - 3600e3, s.lastAt + 3600e3) : [];
      const fset = new Set(files.keys());
      out.related.tasks = (await tasks()).filter((t) => Array.isArray(t.files) && t.files.some((f) => fset.has(f))).slice(0, 20).map(taskRef);
      out.links = [{ label: 'Open replay', href: `#/sessions?id=${encodeURIComponent(id)}` }];
    } else if (kind === 'file') {
      const touching = sessions.filter((s) => s.edits.some((e) => rel(e.path) === id) || s.tools.some((t) => t.path && rel(t.path) === id));
      let edits = 0, added = 0, removed = 0;
      const tl = [];
      for (const s of touching) {
        for (const e of s.edits) if (rel(e.path) === id && e.ok !== false) { edits++; added += e.added; removed += e.removed; }
        for (const t of s.tools) if (t.path && rel(t.path) === id) tl.push(t);
      }
      out.subtitle = 'file';
      out.stats = [stat('Agent edits', edits), stat('Sessions', touching.length), stat('Lines added', added), stat('Lines removed', removed)];
      out.related.sessions = touching.sort((a, b) => b.lastAt - a.lastAt).slice(0, 20).map(sref);
      out.related.tools = toolCounts(tl);
      out.related.files = [{ path: id, edits }];
      out.related.commits = path.isAbsolute(id) ? [] : await commitsBetween(Date.now() - 90 * DAY, Date.now(), id);
      out.related.tasks = (await tasks()).filter((t) => Array.isArray(t.files) && t.files.includes(id)).slice(0, 20).map(taskRef);
      out.links = [{ label: 'Open file', href: `#/files?path=${encodeURIComponent(id)}` }, { label: 'Impact', href: '#/usage?tab=impact' }];
    } else if (kind === 'commit') {
      const g = /^[0-9a-f]{4,64}$/i.test(id) ? await git() : null;
      const cm = g ? await g.commit(id).catch(() => null) : null;
      if (cm && !cm.error) {
        const ts = Date.parse(cm.date) || 0;
        out.title = cm.subject || id; out.subtitle = `${cm.short || id.slice(0, 7)} · ${cm.date || ''}`;
        const files = Array.isArray(cm.files) ? cm.files : [];
        out.stats = [stat('Files', files.length), stat('Lines added', files.reduce((a, f) => a + (f.added || 0), 0)), stat('Lines removed', files.reduce((a, f) => a + (f.removed || 0), 0))];
        out.related.files = files.slice(0, 100).map((f) => ({ path: f.path, edits: (f.added || 0) + (f.removed || 0) }));
        const fset = new Set(files.map((f) => f.path));
        out.related.sessions = sessions.filter((s) => ts && s.startedAt <= ts + 1800e3 && s.lastAt >= ts - DAY && (s.lastAt >= ts - 2 * 3600e3 || s.edits.some((e) => fset.has(rel(e.path))))).slice(0, 20).map(sref);
        out.related.commits = [{ hash: cm.hash, subject: cm.subject, ts }];
      }
      out.links = [{ label: 'Open commit', href: `#/git?tab=log&commit=${encodeURIComponent(id)}` }];
    } else if (kind === 'task') {
      const t = (await tasks()).find((x) => x.id === id);
      if (t) {
        out.title = t.title || id; out.subtitle = t.status || '';
        const files = Array.isArray(t.files) ? t.files : [];
        out.related.tasks = [taskRef(t)];
        out.related.files = files.map((f) => ({ path: f, edits: 0 }));
        const touching = sessions.filter((s) => s.edits.some((e) => files.includes(rel(e.path))));
        out.related.sessions = touching.slice(0, 20).map(sref);
        out.stats = [stat('Files', files.length), stat('Sessions', touching.length)];
      }
      out.links = [{ label: 'Open task', href: `#/tasks?task=${encodeURIComponent(id)}` }];
    } else if (kind === 'tool') {
      const tl = [], using = [];
      for (const s of sessions) { const mine = s.tools.filter((t) => t.name === id); if (mine.length) { tl.push(...mine); using.push([s, mine.length]); } }
      const errs = tl.filter((t) => t.err).length;
      const ms = tl.map((t) => t.ms).filter((x) => typeof x === 'number');
      out.subtitle = `${tl[0]?.kind || 'tool'} · last 90 days`;
      out.stats = [stat('Calls', tl.length), stat('Errors', errs), stat('Error rate', tl.length ? round(errs / tl.length) : 0), stat('Denied', tl.filter((t) => t.denied).length), stat('Avg duration', ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null, 'ms')];
      out.related.sessions = using.sort((a, b) => b[1] - a[1]).slice(0, 20).map(([s]) => sref(s));
      const fm = new Map(); for (const t of tl) if (t.path) { const p = rel(t.path); fm.set(p, (fm.get(p) || 0) + 1); }
      out.related.files = [...fm].map(([p, edits]) => ({ path: p, edits })).sort((a, b) => b.edits - a.edits).slice(0, 20);
      out.related.tools = [{ name: id, calls: tl.length }];
      out.links = [{ label: 'Tool health', href: `#/usage?tab=tools&tool=${encodeURIComponent(id)}` }];
    } else if (kind === 'model') {
      let usd = 0, tokens = 0, turns = 0;
      const using = [];
      for (const s of sessions) { const mine = s.msgs.filter((m) => m.model === id); if (!mine.length) continue; using.push(s); turns += mine.length; for (const m of mine) { usd += m.usd; tokens += m.u.input + m.u.output + m.u.cacheRead + m.u.cacheWrite; } }
      out.subtitle = 'model · last 90 days';
      out.stats = [stat('Cost', round(usd), 'USD'), stat('Tokens', tokens), stat('Turns', turns), stat('Sessions', using.length)];
      out.related.sessions = using.sort((a, b) => b.lastAt - a.lastAt).slice(0, 20).map(sref);
      out.related.tools = toolCounts(using.flatMap((s) => s.tools));
      out.links = [{ label: 'Usage by model', href: `#/usage?tab=overview&model=${encodeURIComponent(id)}` }];
    } else if (kind === 'agent') {
      const mine = sessions.filter((s) => s.tool === id);
      out.title = id === 'codex' ? 'Codex' : id === 'claude' ? 'Claude Code' : id; out.subtitle = 'agent · last 90 days';
      out.stats = [stat('Sessions', mine.length), stat('Cost', round(mine.reduce((a, s) => a + s.usd, 0)), 'USD'), stat('Tool calls', mine.reduce((a, s) => a + s.tools.length, 0))];
      out.related.sessions = mine.sort((a, b) => b.lastAt - a.lastAt).slice(0, 20).map(sref);
      out.related.tools = toolCounts(mine.flatMap((s) => s.tools));
      out.links = [{ label: 'Usage', href: `#/usage?tab=overview&tool=${encodeURIComponent(id)}` }];
    }
    return out;
  }

  return {
    async summary(o = {}) {
      const L = await load(o, SUMMARY_BUDGET_MS);
      const body = V.summary(L.sessions, L.range, { scope: scopeOf(o), dailyBudgetUsd: config.usage?.dailyBudgetUsd });
      return { range: L.range, coverage: L.coverage, generatedAt: L.generatedAt, ...body };
    },
    async sessions(o = {}) {
      const L = await load(o);
      const needle = String(o.q || '').toLowerCase();
      const byTitle = o.titleSearch !== false;
      const rows = L.sessions.map((s) => V.sessionRow(s, c.root)).filter((r) => !needle || (byTitle && String(r.title).toLowerCase().includes(needle)) || r.sessionId.includes(needle));
      return { range: L.range, coverage: L.coverage, generatedAt: L.generatedAt, sessions: rows.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)) };
    },
    /** o.scope 'all' searches every project dir (the route passes it only for admins with usage.scope "all"). */
    async session(id, o = {}) {
      const hit = await findSession(id, o);
      if (!hit) return { session: null, timeline: [], agents: [], files: [] };
      const { cand, s } = hit;
      const scale = s.exact && s.estUsd > 0 ? s.cost.usd / s.estUsd : 1;
      const timeline = await readTimeline(cand.file, cand.tool, c.home, { root: c.root, pricing: config.pricing || {}, thinkingText: liveAccess(config).showPrompts, scale, todos: o.todos === true });
      const run = V.fleet([s], { from: 0, to: Infinity }).runs[0];
      const parentOf = new Map((run?.edges || []).filter((e) => e.kind === 'spawn').map((e) => [e.to, e.from]));
      const agents = (run?.nodes || []).filter((n) => n.kind === 'subagent').map((n) => ({ agentId: n.id, name: n.name, title: n.title, model: n.model,
        parent: parentOf.get(n.id) && parentOf.get(n.id) !== 'main' ? parentOf.get(n.id) : null,
        startedAt: n.startedAt, endedAt: n.endedAt, turns: n.turns, tokens: n.tokens, usd: n.usd, toolCalls: n.toolCalls }));
      const spawnTs = new Map(s.spawns.filter((x) => x.agentId).map((x) => [x.ts, x.agentId]));
      for (const r of timeline) if (r.kind === 'subagent' && !r.agentId && spawnTs.has(r.ts)) r.agentId = spawnTs.get(r.ts);
      return { session: V.sessionRow(s, c.root), timeline, agents, files: fileRows(s) };
    },
    async fileVersion({ session, backup, path: p = '' } = {}, o = {}) {
      const hit = await findSession(session, o);
      if (!hit) throw new FileError(404, 'session not found');
      const file = fileRows(hit.s).find((f) => (!p || f.path === p) && f.versions.some((v) => v.backup === backup));
      if (!file) throw new FileError(404, 'version not found');
      const i = file.versions.findIndex((v) => v.backup === backup);
      const v = file.versions[i], next = file.versions[i + 1];
      // the directory comes from the transcript file name, never from record content
      const sessDir = hit.cand?.sessionId || hit.s.sessionId;
      if (!/^[\w-]{1,200}$/.test(String(sessDir))) throw new FileError(404, 'version not found');
      const dir = path.join(c.home, '.claude', 'file-history', sessDir);
      let truncated = false;
      const readBackup = async (name) => {
        if (!name || name.startsWith('new@') || !/^[\w.-]{1,200}@v\d+$/.test(name)) return null;
        const f = path.join(dir, name);
        const st = await safeStat(f, c.home);
        if (st && st.size > MAX_FILE_VERSION) { truncated = true; return null; }
        const r = await safeRead(f, c.home, { maxBytes: MAX_FILE_VERSION, confine: dir });
        return r ? r.buf.toString('utf8') : null;
      };
      const before = await readBackup(v.backup);
      let after = null;
      if (next) after = await readBackup(next.backup);
      else if (!path.isAbsolute(file.path)) {
        // newest version: compare with the file on disk (inside the project only)
        const abs = path.join(c.root, file.path);
        const st = await safeStat(abs, c.home);
        if (st && st.size > MAX_FILE_VERSION) truncated = true;
        else { const r = await readRegularAsync(abs, { maxBytes: MAX_FILE_VERSION, confine: c.root }); after = r ? r.buf.toString('utf8') : null; }
      }
      return { path: file.path, before, after, ts: v.ts, truncated };
    },
    async tools(o = {}) {
      const L = await load(o);
      // home-level MCP servers needing login are listed only for admins (o.home)
      const s = await auditSettings({ root: c.root, home: c.home, includeHome: o.home !== false });
      return { range: L.range, coverage: L.coverage, generatedAt: L.generatedAt, ...V.tools(L.sessions, L.range, { needsAuth: s.mcpNeedsAuth }) };
    },
    async prompts(o = {}) {
      const L = await load(o);
      const scope = scopeOf(o);
      const history = (o.tool === 'codex' ? [] : await readHistory(c.home)).filter((h) => scope === 'all' || (h.project && path.resolve(h.project) === c.root));
      return { range: L.range, coverage: L.coverage, generatedAt: L.generatedAt, ...V.prompts(L.sessions, L.range, { q: o.q || '', limit: o.limit || 100, history }) };
    },
    async fleet(o = {}) {
      const L = await load(o);
      return { range: L.range, coverage: L.coverage, generatedAt: L.generatedAt, ...V.fleet(L.sessions, L.range) };
    },
    async impact(o = {}) {
      const L = await load(o);
      return { range: L.range, coverage: L.coverage, generatedAt: L.generatedAt, ...V.impact(L.sessions, L.range, c.root) };
    },
    async activity(o = {}) {
      const L = await load(o);
      return { range: L.range, coverage: L.coverage, generatedAt: L.generatedAt, ...V.activity(L.sessions, L.range) };
    },
    async memory() {
      const dirs = await claudeProjectDirs({ root: c.root, home: c.home, scope: 'project' });
      const memory = await readMemory({ dirs, home: c.home, root: c.root });
      // plans are global files: only those whose name matches a plan slug seen in this project's sessions
      const { sessions } = await load({ range: 'all' }, SUMMARY_BUDGET_MS); // bounded: plans are a side panel
      const slugs = new Set(sessions.flatMap((s) => s.slugs));
      return { memory, plans: await readPlans({ home: c.home, slugs }) };
    },
    /** o.home: include ~/.claude/settings.json (admins only: home agent config is not project data). */
    async settings(o = {}) {
      const { sessions } = await load({ range: '30d' });
      const permModes = {};
      let hookErrors = 0;
      for (const s of sessions) {
        for (const [k, v] of Object.entries(s.permModes || {})) permModes[k] = (Object.hasOwn(permModes, k) ? permModes[k] : 0) + v;
        for (const h of s.hooks) hookErrors += h[2];
      }
      return auditSettings({ root: c.root, home: c.home, permModes, hookErrors, includeHome: o.home !== false });
    },
    entity,
  };
}
