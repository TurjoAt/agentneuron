// Shared helpers for the agent brief: one ctx adapter for the server, MCP and CLI entry points, cached file
// index, git reads (read-only `git log` with a timeout, like the usage entity route), evidence and text helpers.
import os from 'node:os';
import path from 'node:path';
import { createSessions } from '../agents/sessions.js';
import { getBoard } from '../board/index.js';
import { buildIndex } from '../project/fsindex.js';
import { runGit } from '../git2/run.js';
import { maskSecretsInText } from '../health/secrets.js';
import { listRuns as realListRuns } from '../ship/runs.js';
import { taskScope as realTaskScope } from '../ship/scope.js';
import { listCheckpoints as realListCheckpoints } from '../changes/checkpoints.js';

export const DEFAULT_DEPS = { listRuns: realListRuns, taskScope: realTaskScope, listCheckpoints: realListCheckpoints };

const adapters = new WeakMap();

/**
 * Normalise a server / MCP / CLI ctx into what the brief needs:
 * { root, config, home, store, sessions (createSessions), board() (task list), usageBudgetMs, deps }.
 * Never throws at construction (the MCP server builds it eagerly).
 */
export function briefCtx(ctx = {}, deps = {}) {
  if (ctx && adapters.has(ctx) && !Object.keys(deps).length) return adapters.get(ctx);
  const root = path.resolve(ctx.root || process.cwd());
  const home = ctx.home || os.homedir();
  let sessions = ctx.sessions || null;
  const boardCtx = ctx.can ? ctx : { root, config: ctx.config || {}, store: ctx.store, can: () => false, broadcast: () => {} };
  const out = {
    root, home, config: ctx.config || {}, store: ctx.store || null,
    usageBudgetMs: ctx.usageBudgetMs,
    get sessions() { return (sessions ||= createSessions(root, { home })); },
    /** Board tasks (markdown + native), [] without a store. */
    tasks() {
      if (!out.store) return [];
      try { return getBoard(boardCtx).collect() || []; } catch { return []; }
    },
    deps: { ...DEFAULT_DEPS, ...(ctx.briefDeps || {}), ...deps },
    raw: ctx,
  };
  if (ctx && typeof ctx === 'object' && !Object.keys(deps).length) adapters.set(ctx, out);
  return out;
}

/** Call a cross-slice function; never throws, falls back to `dflt`. */
export async function safeCall(fn, args, dflt) {
  try { const v = await fn(...args); return v ?? dflt; } catch { return dflt; }
}

// ---- file index (async walk, cached per root) ---------------------------------------------------------------

const INDEX_TTL = 30000;
const indexCache = new Map(); // root -> { ts, p }
export function fileIndex(root) {
  const c = indexCache.get(root);
  if (c && Date.now() - c.ts < INDEX_TTL) return c.p;
  const p = buildIndex(root, { cap: 20000 }).catch(() => ({ files: [], paths: new Set(), has: () => false, truncated: false }));
  indexCache.set(root, { ts: Date.now(), p });
  if (indexCache.size > 20) indexCache.delete(indexCache.keys().next().value);
  return p;
}
export function clearIndexCache() { indexCache.clear(); }

// ---- git (read-only) ----------------------------------------------------------------------------------------

const US = '\x1f', RS = '\x1e';
const gitCache = new Map(); // key -> { ts, v }

/**
 * Commits (newest first) with their files: [{ hash, short, ts, subject, files }].
 * opts: { since, until (ms), paths, limit }. [] when git is unavailable. Cached 15 s.
 */
export async function gitCommits(root, { since = null, until = null, paths = [], limit = 30 } = {}) {
  const ps = paths.filter((p) => typeof p === 'string' && p && !p.startsWith('-') && !p.includes('\0') && !path.isAbsolute(p)).slice(0, 50);
  const key = `${root}|${since}|${until}|${limit}|${ps.join(',')}`;
  const c = gitCache.get(key);
  if (c && Date.now() - c.ts < 15000) return c.v;
  const args = ['-c', 'core.quotepath=off', 'log', `-n${Math.max(1, Math.min(200, limit))}`, '--name-only', '--relative', `--format=${RS}%H${US}%h${US}%aI${US}%s${US}`];
  if (since) args.push(`--since=${new Date(since).toISOString()}`);
  if (until) args.push(`--until=${new Date(until).toISOString()}`);
  if (ps.length) args.push('--', ...ps);
  let v = [];
  try {
    const r = await runGit(root, args, { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
    if (r.ok) {
      for (const chunk of r.out.split(RS)) {
        if (!chunk.trim()) continue;
        const parts = chunk.split(US);
        if (parts.length < 5) continue;
        const [hash, short, date, subject] = parts;
        v.push({ hash, short, ts: Date.parse(date) || 0, subject: maskSecretsInText(subject).slice(0, 200), files: parts.slice(4).join(US).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 200) });
      }
    }
  } catch { v = []; }
  gitCache.set(key, { ts: Date.now(), v });
  if (gitCache.size > 200) gitCache.delete(gitCache.keys().next().value);
  return v;
}

// ---- small helpers ------------------------------------------------------------------------------------------

export const ev = (kind, ref, ts = null) => ({ kind, ref: ref == null ? null : String(ref), ts: ts || null });
export const clipText = (s, n = 300) => maskSecretsInText(String(s ?? '').slice(0, n + 256).replace(/\s+/g, ' ').trim()).slice(0, n);
export const isRel = (p) => typeof p === 'string' && p !== '' && !/^([/\\~]|[A-Za-z]:)/.test(p) && !p.split('/').includes('..');

/** Project-relative POSIX path or null. */
export function relPath(root, p) {
  if (typeof p !== 'string' || !p) return null;
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
  const r = path.relative(root, abs);
  return !r || r.startsWith('..') || path.isAbsolute(r) ? null : r.split(path.sep).join('/');
}

/** Validate an id coming from a query / tool argument. */
export const validId = (v) => typeof v === 'string' && /^[\w.@:-]{1,200}$/.test(v);

/** Comma list or array of project-relative paths (invalid entries dropped). */
export function pathList(v) {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return [...new Set(arr.map((x) => String(x).trim().replace(/\\/g, '/').replace(/^\.\//, '')).filter((x) => x && x.length <= 500 && isRel(x) && !x.includes('\0')))].slice(0, 100);
}

export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const fmtTs = (ts) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '');
