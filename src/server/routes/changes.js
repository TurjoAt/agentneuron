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

export default async function register(router, ctx) {
  const root = ctx.root;
  const online = (role) => packagesOnline(ctx.config) && (ctx.can ? ctx.can('state', role) : role === 'admin');
  const G = (p, fn) => router.get(p, wrap(fn), { level: 'read' });

  G('/api/changes/review', ({ q }) => reviewChanges(root, { base: q.get('base') || undefined, head: q.get('head') || undefined }));
  G('/api/changes/impact', ({ q }) => analyzeImpact(root, { base: q.get('base') || undefined, paths: (q.get('paths') || '').slice(0, 8000) || undefined }));
  G('/api/changes/checkpoints', async ({ q }) => ({ checkpoints: await listCheckpoints(root, { limit: Math.min(200, Number(q.get('limit')) || 50) }) }));
  G('/api/changes/checkpoint', ({ q }) => compareCheckpoint(root, q.get('id') || ''));
  G('/api/changes/checkpoint/diff', async ({ q, role }) => {
    if (!liveAccess(ctx.config).diffs(role)) throw new HttpError(403, 'checkpoint file content is admin-only (live.viewerDiffs)');
    return checkpointFileDiff(root, q.get('id') || '', q.get('path') || '');
  });
  G('/api/changes/packages', ({ role }) => scanPackages(root, { online: online(role) }));
  G('/api/changes/package', ({ q, role }) => checkPackage(root, { manager: q.get('manager') || '', name: q.get('name') || '', version: q.get('version') || undefined }, { online: online(role) }));
}
