import { HttpError } from '../router.js';
import { createGit2 } from '../../git2/index.js';
import { buildChangelog } from '../../git2/changelog.js';

function check(v) {
  if (v && v.error) throw new HttpError(400, v.error);
  return v;
}

export default async function register(router, ctx) {
  const g = ctx.git2 || (ctx.git2 = createGit2(ctx.root));
  const num = (q, k, d) => { const v = Number(q.get(k)); return Number.isFinite(v) && v >= 0 ? v : d; };

  router.get('/api/git/branches', () => g.branches());
  router.get('/api/git/log', ({ q }) => check(g.log({
    branch: q.get('branch') || undefined, path: q.get('path') || undefined, author: q.get('author') || undefined,
    since: q.get('since') || undefined, until: q.get('until') || undefined, limit: num(q, 'limit', 100), skip: num(q, 'skip', 0),
  })));
  router.get('/api/git/commit', async ({ q }) => check(await g.commit(q.get('hash') || '')));
  router.get('/api/git/changes', () => g.changes());
  router.get('/api/git/diff', async ({ q }) => check(await g.diff({ path: q.get('path'), staged: q.get('staged') === '1' })));
  router.get('/api/git/tags', () => g.tags());
  router.get('/api/git/stash', () => g.stash());
  router.get('/api/git/remotes', () => g.remotes());
  router.get('/api/git/blame', async ({ q }) => check(await g.blame(q.get('path'))));
  router.get('/api/git/stats', ({ q }) => g.stats({ since: q.get('since') || undefined, until: q.get('until') || undefined }));
  router.get('/api/changelog', async ({ q }) => check(await buildChangelog(ctx.root, { from: q.get('from') || undefined, to: q.get('to') || 'HEAD' })));
}
