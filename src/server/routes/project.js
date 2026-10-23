import { HttpError } from '../router.js';
import { detectProject, laravelRoutes, laravelMigrations, laravelModels, docDrift } from '../../project/index.js';
import { readOutdatedCache, MANAGERS } from '../../actions/packages.js';

const TTL = 30000;
const memo = new Map();
async function cached(key, sigFn, fn) {
  const sig = await sigFn();
  const m = memo.get(key);
  if (m && m.sig === sig && Date.now() - m.ts < TTL) return m.value;
  const value = await fn();
  memo.set(key, { ts: Date.now(), sig, value });
  return value;
}

export default async function register(router, ctx) {
  const root = ctx.root;
  // Detection result's own cache keys on manifest mtimes; use its stats-free identity as signature.
  const proj = (q) => detectProject(root, { refresh: q?.refresh === '1' });
  const sigOf = async () => { const p = await detectProject(root); return p.framework?.laravel ? JSON.stringify(p.framework.laravel) : 'none'; };

  router.get('/api/project', async ({ q }) => proj(q));
  router.get('/api/project/stats', async ({ q }) => (await proj(q)).stats);

  router.get('/api/project/deps', async ({ q }) => {
    const manager = q.manager || null;
    if (manager && !MANAGERS.includes(manager) && !['go', 'cargo', 'bundler', 'maven', 'gradle', 'nuget', 'deno', 'uv'].includes(manager)) throw new HttpError(400, 'invalid manager');
    const p = await proj();
    const outdated = await readOutdatedCache(root);
    const rows = [];
    for (const m of p.manifests) {
      for (const d of m.deps) {
        const npmFam = ['npm', 'pnpm', 'yarn', 'bun'].includes(manager) && m.type === 'npm';
        if (manager && d.manager !== manager && !npmFam) continue;
        const o = outdated[d.manager]?.items?.find((x) => x.name === d.name) || null;
        rows.push({ ...d, manifest: m.path, current: o?.current ?? null, wanted: o?.wanted ?? null, latest: o?.latest ?? null, outdated: !!o });
      }
    }
    return rows;
  });

  router.get('/api/project/routes', async () => cached('routes', sigOf, () => laravelRoutes(root)));
  router.get('/api/project/migrations', async () => cached('migrations', sigOf, () => laravelMigrations(root)));
  router.get('/api/project/models', async () => cached('models', sigOf, () => laravelModels(root)));
  router.get('/api/project/drift', async () => cached('drift', async () => String(ctx.allFiles().length), () => docDrift(root, ctx.allFiles(), ctx.git)));
  router.get('/api/project/outdated', async () => ({ managers: await readOutdatedCache(root) }));
}
