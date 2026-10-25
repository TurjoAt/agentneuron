// Truth check and agent-config security audit (/api/audit itself is the action audit log, see system.js).
// Reads are `read`; applying a suggested fix needs `edit`.
import { HttpError } from '../router.js';
import { maskDeep } from '../mask.js';
import { verifyContext, claimFix } from '../../verify/index.js';
import { auditAgentConfig } from '../../audit/index.js';
import { getOps } from '../../files/ops.js';
import { guard } from './files.js';

export default async function register(router, ctx) {
  const input = () => ({ root: ctx.root, files: ctx.allFiles(), contents: ctx.store.contents });

  router.get('/api/verify', async ({ q }) => {
    const r = verifyContext(input());
    const status = q.get('status');
    const file = q.get('file');
    const claims = r.claims.filter((c) => (!status || c.status === status) && (!file || c.file === file));
    return maskDeep({ generatedAt: Date.now(), summary: r.summary, claims });
  });

  router.get('/api/audit/config', async () => maskDeep({ generatedAt: Date.now(), ...auditAgentConfig(input()) }));

  router.post('/api/verify/fix', guard(async ({ body }) => {
    const id = body?.id;
    if (typeof id !== 'string' || !id || id.length > 2048) throw new HttpError(400, 'id required');
    // the edit is recomputed here from the current file; the client only names the claim
    const fix = claimFix({ ...input(), id });
    if (!fix) throw new HttpError(404, 'no automatic fix for this claim (already fixed, changed, or not fixable)');
    const ops = getOps(ctx);
    if (ops.readFresh(fix.path) !== fix.before) throw new HttpError(409, `${fix.path} changed; reload and retry`);
    await ops.writeTracked(fix.path, fix.after);
    return maskDeep({ applied: true, path: fix.path, line: fix.line, from: fix.from, to: fix.to });
  }), { level: 'edit' });
}
