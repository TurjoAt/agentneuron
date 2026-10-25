// Live agent activity (GET /api/live + SSE agent.* events) and multi-agent coordination (claims, handoffs).
import os from 'node:os';
import { guard } from './files.js';
import { maskDeep } from '../mask.js';
import { getBoard } from '../../board/index.js';
import { createLive } from '../../live/index.js';
import { createClaims } from '../../live/claims.js';
import { createHandoffs } from '../../live/handoffs.js';
import { claimTask, liveAccess, snapshotFor, stripEdit, stripSession } from '../../live/coord.js';

const ms = (v, min, max) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : undefined);

export default async function register(router, ctx) {
  const lc = ctx.config?.live && typeof ctx.config.live === 'object' ? ctx.config.live : {};
  const access = liveAccess(ctx.config);
  const claims = createClaims(ctx.root);
  const handoffs = createHandoffs(ctx.root);
  const out = (name, data, allow) => ctx.broadcast(name, maskDeep(data), allow);
  const emit = (name, data, kind) => {
    if (kind === 'prompt') return out(name, data, access.prompts);
    if (kind === 'diff') { out(name, data, access.diffs); return out(name, stripEdit(data), (r) => !access.diffs(r)); }
    if (kind === 'session') { out(name, data, access.prompts); return out(name, stripSession(data), (r) => !access.prompts(r)); }
    return out(name, data);
  };
  const opts = Object.fromEntries(Object.entries({
    idleMs: ms(lc.idleMs, 10000, 3600000), endMs: ms(lc.endMs, 60000, 86400000), collisionWindowMs: ms(lc.collisionWindowMs, 10000, 3600000),
  }).filter(([, v]) => v !== undefined));
  const live = createLive({ root: ctx.root, home: ctx.home || os.homedir(), store: ctx.store, emit, claims, handoffs, ...opts });
  if (lc.enabled !== false) {
    live.start();
    ctx.store?.on?.('event', (ev) => { try { live.onFsEvent(ev); } catch (e) { ctx.warn?.('live', e); } });
  }
  ctx.live = live;
  ctx.onClose?.(() => live.close());

  const announceClaims = () => { claims.changed(); emit('agent.claims', { claims: claims.list() }); };
  const who = (b) => ({ agent: typeof b?.agent === 'string' && b.agent ? b.agent : 'human', sessionId: typeof b?.sessionId === 'string' && b.sessionId ? b.sessionId : 'ui' });
  const R = (m, p, fn, level) => router[m](p, guard(fn), { level });

  R('get', '/api/live', ({ role }) => snapshotFor(maskDeep(live.snapshot()), role, access), 'read');
  R('get', '/api/live/claims', () => ({ claims: claims.list() }), 'read');
  R('post', '/api/live/claims', ({ body }) => {
    const r = claims.claim({ ...who(body), paths: body?.paths, ttlMs: body?.ttlMs, note: body?.note, taskId: body?.taskId, force: body?.force === true });
    announceClaims();
    return r;
  }, 'state');
  R('post', '/api/live/release', ({ body }) => {
    const r = claims.release({ ...who(body), paths: body?.paths, id: typeof body?.id === 'string' ? body.id : undefined });
    announceClaims();
    return r;
  }, 'state');
  R('get', '/api/live/handoffs', ({ q }) => ({ handoffs: handoffs.list({ taskId: q.get('taskId') || undefined, sessionId: q.get('sessionId') || undefined, agent: q.get('agent') || undefined, limit: q.get('limit') }) }), 'read');
  R('post', '/api/live/handoff', ({ body }) => {
    const h = handoffs.add({ ...who(body), taskId: body?.taskId, summary: body?.summary, done: body?.done, next: body?.next, blockers: body?.blockers, files: body?.files });
    handoffs.changed();
    emit('agent.handoff', { handoff: h, handoffs: handoffs.list({ limit: 20 }) });
    return { handoff: h };
  }, 'state');
  R('post', '/api/live/claim-task', async ({ body, role }) => {
    const r = await claimTask(getBoard(ctx), claims, { ...who(body), id: body?.id, ttlMs: body?.ttlMs, force: body?.force === true }, role);
    announceClaims();
    return r;
  }, 'state');
}
