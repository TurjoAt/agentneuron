// Insights: lessons from sessions, rule effectiveness, replay, cost by feature.
import { HttpError } from '../router.js';
import { maskDeep } from '../mask.js';
import { guard } from './files.js';
import { getInsights } from '../../insights/index.js';
import { liveAccess, redactPrompts } from '../../live/coord.js';

const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : Number.isNaN(Date.parse(v)) ? null : Date.parse(v); };
function cleanPath(p) {
  if (p == null || p === '') return null;
  if (typeof p !== 'string' || p.includes('\0') || p.length > 1024) throw new HttpError(400, 'invalid path');
  const r = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (r.startsWith('/') || /^[A-Za-z]:/.test(r) || r.split('/').includes('..')) throw new HttpError(400, 'invalid path');
  return r;
}

export default async function register(router, ctx) {
  const ins = () => getInsights(ctx);
  // Prompts, session titles and quoted evidence follow the same policy as the live view (config.live).
  const R = (m, p, fn, level = 'read') => router[m](p, guard(async (a) => {
    const v = maskDeep(await fn(a));
    return liveAccess(ctx.config).prompts(a.role) ? v : redactPrompts(v);
  }), { level });

  R('get', '/api/insights/lessons', ({ q, role }) => ins().lessons({ all: q.get('all') === '1' }).then((v) => ({ ...v, canAccept: ctx.can('edit', role) })));
  R('post', '/api/insights/lessons/accept', ({ body }) => ins().accept(body || {}), 'edit');
  R('post', '/api/insights/lessons/dismiss', ({ body }) => ins().dismiss(body || {}), 'state');
  R('get', '/api/insights/rules', () => ins().rules());
  R('get', '/api/insights/costs-by-feature', () => ins().costs());
  R('get', '/api/insights/replay', ({ q }) => {
    const session = q.get('session') || null;
    if (session && !/^[\w.-]{1,200}$/.test(session)) throw new HttpError(400, 'invalid session');
    const path = cleanPath(q.get('path'));
    const tool = q.get('tool') || null;
    if (tool && !['claude', 'codex', 'cursor'].includes(tool)) throw new HttpError(400, 'tool must be claude|codex|cursor');
    if (!path && !session) return ins().recent().then((changes) => ({ changes }));
    return ins().replay({ path, session, ts: num(q.get('ts')), tool });
  });
}
