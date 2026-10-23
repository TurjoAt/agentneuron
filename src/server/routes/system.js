// System routes: actions, jobs, audit, settings, restore. Owner: Agent S1.
import { HttpError } from '../router.js';
import { maskUrl } from '../../notify/index.js';
import { howToEnable, safeRelPath } from '../../actions/registry.js';
import { VERSION } from '../version.js';

export default async function register(router, ctx) {
  const reg = () => ctx.actions;
  const byOf = (req) => req.socket?.remoteAddress || 'unknown';

  router.get('/api/actions', async ({ role }) => reg().list(role));

  router.post('/api/actions/preview', async ({ body }) => {
    if (!body || typeof body.id !== 'string') throw new HttpError(400, 'id required');
    return reg().preview(body.id, body.params || {});
  });

  router.post('/api/actions/run', async ({ body, role, req }) => {
    if (!body || typeof body.id !== 'string') throw new HttpError(400, 'id required');
    const job = await reg().run(body.id, body.params || {}, { role, by: byOf(req) });
    return reg().summary(job);
  });

  router.get('/api/jobs', async () => reg().listJobs().map((j) => reg().summary(j)));

  router.get('/api/job', async ({ q }) => {
    const job = reg().getJob(q.get('id') || '');
    if (!job) throw new HttpError(404, 'job not found');
    return { ...reg().summary(job), log: job.logBuf };
  });

  router.post('/api/jobs/cancel', async ({ body, role }) => {
    if (!ctx.can('state', role)) throw new HttpError(403, howToEnable('state'));
    const ok = reg().cancel(String(body?.id || ''));
    if (!ok) throw new HttpError(404, 'job not found or already finished');
    return { ok: true };
  });

  router.get('/api/audit', async ({ q }) => ctx.persist.audit.read({ limit: Number(q.get('limit')) || 200 }), { level: 'state' });

  router.get('/api/settings', async ({ role }) => {
    const c = ctx.config;
    return {
      actions: { ...c.actions },
      roles: { you: role, tokenRequired: !!(c.token || c.adminToken), adminToken: !!c.adminToken, viewerToken: !!(c.adminToken && c.token) },
      notifications: {
        browser: c.notifications?.browser !== false,
        webhooks: (c.notifications?.webhooks || []).map((w) => ({ url: maskUrl(w.url), events: w.events || [] })),
      },
      paths: { root: ctx.root, data: '.agentneuron', config: '.agentneuron/config.json', audit: '.agentneuron/audit.jsonl', events: '.agentneuron/events.jsonl', metrics: '.agentneuron/metrics.jsonl' },
      version: VERSION,
      howToEnable: 'Actions beyond read are OFF by default. Enable them in .agentneuron/config.json, e.g. {"actions":{"edit":true,"exec":true}}, or start agentneuron with --enable edit,exec[,danger,terminal]. Use --admin-token to separate admin from read-only viewers.',
    };
  });

  // v0.1 history restore, now an `edit`-level route.
  router.post('/api/restore', async ({ body }) => {
    const p = safeRelPath(body?.path);
    if (!p || !body?.id) throw new HttpError(400, 'path and id required');
    try { return ctx.store.history.restore(p, body.id); }
    catch (e) { throw new HttpError(404, String(e.message || e)); }
  }, { level: 'edit' });
}
