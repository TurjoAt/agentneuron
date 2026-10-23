import { workspace, instances } from '../../workspace/index.js';

export default async function register(router, ctx) {
  ctx.workspace = { cleanup: instances.killAll, instances: instances.list };
  router.get('/api/workspace', ({ q }) => workspace(ctx, { force: q.get('refresh') === '1' }));
  router.get('/api/workspace/instances', () => instances.list());
}
