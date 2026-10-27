// Change review routes (agent B). Contract: docs/internal/quality-contract.md (Slice B).
// All GET, level read: read-only git through src/git2/run.js, no other processes; network only for
// /api/changes/packages(+package) when packages.online is configured and the caller is admin.
import { HttpError } from '../router.js';
import { maskDeep } from '../mask.js';
import { liveAccess } from '../../live/coord.js';
import {
  reviewChanges, analyzeImpact, listCheckpoints, compareCheckpoint, checkpointFileDiff, scanPackages, checkPackage, packagesOnline,
} from '../../changes/index.js';

/** Errors carrying an HTTP-ish `status` (400/403/404/409/413) become HttpError; others stay 500. */
const wrap = (fn) => async (a) => {
  try { return maskDeep(await fn(a)); } catch (e) {
    if (e instanceof HttpError) throw e;
    if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 500) throw new HttpError(e.status, e.message);
    throw e;
  }
};

// Heavy reads (whole diffs, lockfiles, hashing untracked files) are shared: identical requests within
// a moment reuse one result, and at most two run at a time so a burst of requests cannot pile up git work.
const TTL = 1500, MAX_KEYS = 64, MAX_RUNNING = 2; // short TTL: a view reloaded right after a restore must not show the old state
function heavyCache() {
  const memo = new Map(); // key -> { ts, p }
  let running = 0;
  const waiting = [];
  const slot = () => (running < MAX_RUNNING ? (running++, Promise.resolve()) : new Promise((r) => waiting.push(r)));
  const release = () => { const next = waiting.shift(); if (next) next(); else running--; };
  return (key, fn) => {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.ts < TTL) return hit.p;
    const p = slot().then(() => fn()).finally(release);
    memo.set(key, { ts: Date.now(), p });
    p.catch(() => memo.delete(key));
    while (memo.size > MAX_KEYS) memo.delete(memo.keys().next().value);
    return p;
  };
}

export default async function register(router, ctx) {
  const heavy = heavyCache();
  const root = ctx.root;
  const online = (role) => packagesOnline(ctx.config) && (ctx.can ? ctx.can('state', role) : role === 'admin');
  const G = (p, fn) => router.get(p, wrap(fn), { level: 'read' });

  G('/api/changes/review', ({ q }) => heavy(`review\0${q.get('base') || ''}\0${q.get('head') || ''}`, () => reviewChanges(root, { base: q.get('base') || undefined, head: q.get('head') || undefined })));
  G('/api/changes/impact', ({ q }) => heavy(`impact\0${q.get('base') || ''}\0${(q.get('paths') || '').slice(0, 8000)}`, () => analyzeImpact(root, { base: q.get('base') || undefined, paths: (q.get('paths') || '').slice(0, 8000) || undefined })));
  G('/api/changes/checkpoints', async ({ q }) => ({ checkpoints: await listCheckpoints(root, { limit: Math.min(200, Number(q.get('limit')) || 50) }) }));
  G('/api/changes/checkpoint', ({ q }) => heavy(`cp\0${q.get('id') || ''}`, () => compareCheckpoint(root, q.get('id') || '')));
  G('/api/changes/checkpoint/diff', async ({ q, role }) => {
    if (!liveAccess(ctx.config).diffs(role)) throw new HttpError(403, 'checkpoint file content is admin-only (live.viewerDiffs)');
    return checkpointFileDiff(root, q.get('id') || '', q.get('path') || '');
  });
  G('/api/changes/packages', ({ role }) => heavy(`pkgs\0${online(role)}`, () => scanPackages(root, { online: online(role) })));
  G('/api/changes/package', ({ q, role }) => checkPackage(root, { manager: q.get('manager') || '', name: q.get('name') || '', version: q.get('version') || undefined }, { online: online(role) }));
}
