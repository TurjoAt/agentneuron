// Usage analytics routes. Shapes: docs/internal/usage-contract.md.
import { HttpError } from '../router.js';
import { maskDeep } from '../mask.js';
import { guard } from './files.js';
import { getUsage } from '../../usage/index.js';
import { liveAccess, redactPrompts } from '../../live/coord.js';

const RANGES = new Set(['24h', '7d', '30d', '90d', 'all']);
const KINDS = new Set(['session', 'file', 'commit', 'task', 'tool', 'model', 'agent']);

function opts(q, ctx, role) {
  const range = q.get('range') || '30d';
  if (!RANGES.has(range)) throw new HttpError(400, 'range must be 24h|7d|30d|90d|all');
  const tool = q.get('tool') || 'all';
  if (!['claude', 'codex', 'all'].includes(tool)) throw new HttpError(400, 'tool must be claude|codex|all');
  const scope = q.get('scope') || 'project';
  if (scope !== 'project' && scope !== 'all') throw new HttpError(400, 'scope must be project|all');
  if (scope === 'all' && (ctx.config?.usage?.scope !== 'all' || role !== 'admin')) throw new HttpError(403, 'scope=all needs "usage": { "scope": "all" } in config and the admin role');
  return { range, tool, scope };
}
// session lookups by id search every project dir only for admins when usage.scope is "all"
const lookup = (ctx, role) => ({ scope: ctx.config?.usage?.scope === 'all' && role === 'admin' ? 'all' : 'project' });
const sid = (v, what) => { if (!v || !/^[\w.@-]{1,200}$/.test(v)) throw new HttpError(400, `invalid ${what}`); return v; };

export default async function register(router, ctx) {
  const U = () => getUsage(ctx);
  // Prompts, titles, thinking and memory bodies follow the live prompt policy (config.live).
  const R = (p, fn) => router.get(p, guard(async (a) => {
    const v = maskDeep(await fn(a));
    return liveAccess(ctx.config).prompts(a.role) ? v : redactPrompts(v);
  }), { level: 'read' });

  R('/api/usage/summary', ({ q, role }) => U().summary(opts(q, ctx, role)));
  R('/api/usage/sessions', ({ q, role }) => U().sessions({ ...opts(q, ctx, role), q: (q.get('q') || '').slice(0, 200) }));
  R('/api/usage/session', ({ q, role }) => U().session(sid(q.get('id'), 'id'), lookup(ctx, role)));
  R('/api/usage/tools', ({ q, role }) => U().tools(opts(q, ctx, role)));
  R('/api/usage/prompts', ({ q, role }) => U().prompts({ ...opts(q, ctx, role), q: (q.get('q') || '').slice(0, 200), limit: Math.min(500, Number(q.get('limit')) || 100) }));
  R('/api/usage/fleet', ({ q, role }) => U().fleet(opts(q, ctx, role)));
  R('/api/usage/impact', ({ q, role }) => U().impact(opts(q, ctx, role)));
  R('/api/usage/activity', ({ q, role }) => U().activity(opts(q, ctx, role)));
  R('/api/usage/memory', () => U().memory());
  R('/api/usage/settings', () => U().settings());
  R('/api/usage/entity', ({ q }) => {
    const kind = q.get('kind');
    if (!KINDS.has(kind)) throw new HttpError(400, 'unknown kind');
    const v = q.get('id');
    if (!v || v.length > 1024 || v.includes('\0')) throw new HttpError(400, 'invalid id');
    return U().entity(kind, v);
  });
  router.get('/api/usage/file-version', guard(async ({ q, role }) => {
    if (!liveAccess(ctx.config).diffs(role)) throw new HttpError(403, 'file versions are admin-only (live.viewerDiffs)');
    return maskDeep(await U().fileVersion({ session: sid(q.get('session'), 'session'), backup: sid(q.get('backup'), 'backup'), path: q.get('path') || '' }, lookup(ctx, role)));
  }), { level: 'read' });
}
