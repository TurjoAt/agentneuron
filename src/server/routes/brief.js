// Agent brief routes (agent C): resume briefs, warnings / preflight, context packs, bug detective.
// Contract: docs/internal/quality-contract.md (Slice C). Read-only: nothing here spawns a process except
// read-only `git log` (with a timeout) like the other GET routes; nothing touches the network.
import { HttpError } from '../router.js';
import { maskDeep } from '../mask.js';
import { guard } from './files.js';
import { liveAccess } from '../../live/coord.js';
import {
  briefCtx, buildResume, resumeSources, warningRules, checkAction, publicRule, buildPack, buildDebug, listBriefs, getBrief, VIEWER, MAX_ERROR,
} from '../../brief/index.js';

const id = (v, what) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^[\w.@:-]{1,200}$/.test(v)) throw new HttpError(400, `invalid ${what}`);
  return v;
};
const text = (v, max, what) => {
  if (v == null) return '';
  if (typeof v !== 'string' || v.includes('\0')) throw new HttpError(400, `invalid ${what}`);
  if (v.length > max) throw new HttpError(413, `${what} too long (max ${max} characters)`);
  return v;
};
/** Plain errors carrying a status (pack / debug input errors) become HTTP errors. */
const wrap = async (fn) => {
  try { return await fn(); } catch (e) {
    if (e && typeof e.status === 'number' && Object.getPrototypeOf(e) === Error.prototype) throw new HttpError(e.status, e.message);
    throw e;
  }
};

export default async function register(router, ctx) {
  const B = () => briefCtx(ctx);
  const prompts = (role) => liveAccess(ctx.config).prompts(role);
  // roles that may see prompts get the masked payload; everyone else the VIEWER view of it
  const R = (m, p, fn, viewer) => router[m](p, guard(async (a) => {
    const v = maskDeep(await wrap(() => fn(a)));
    return prompts(a.role) ? v : viewer(v);
  }), { level: 'read' });

  R('get', '/api/brief/resume', ({ q }) => buildResume(B(), { session: id(q.get('session'), 'session'), task: id(q.get('task'), 'task') }), VIEWER.resume);
  R('get', '/api/brief/sources', () => resumeSources(B()), VIEWER.sources);
  R('get', '/api/brief/briefs', async () => ({ briefs: await listBriefs(ctx.root) }), VIEWER.briefs);
  R('get', '/api/brief/brief', ({ q }) => getBrief(ctx.root, q.get('id')), VIEWER.saved);
  // viewers never match against session history: a query must not reveal whether a command failed before
  R('get', '/api/brief/warnings', ({ q, role }) => checkAction(B(), {
    command: text(q.get('command'), 4000, 'command'), paths: text(q.get('paths'), 20000, 'paths'), task: text(q.get('task'), 2000, 'task'),
  }, { sessionData: prompts(role) }), VIEWER.warnings);
  R('get', '/api/brief/rules', async ({ role }) => ({ rules: (await warningRules(B(), { sessionData: prompts(role) })).map(publicRule) }), VIEWER.rules);
  R('get', '/api/brief/pack', ({ q }) => {
    const task = text(q.get('task'), 4000, 'task').trim();
    if (!task) throw new HttpError(400, 'task is required');
    return buildPack(B(), { task, budget: q.get('budget') });
  }, (v) => v); // files, context sections, repo facts and counts only: no session text
  // pasted error text is accepted only from roles that may see prompts; `run` (a failing run) works for all
  R('post', '/api/brief/debug', ({ body, role }) => {
    const b = body && typeof body === 'object' ? body : {};
    const error = text(b.error, MAX_ERROR, 'error');
    if (error.trim() && !prompts(role)) throw new HttpError(403, 'pasting error text is admin-only; send { "run": "last" } for the last failing run');
    const run = b.run == null || b.run === '' ? null : b.run === 'last' ? 'last' : id(b.run, 'run');
    return buildDebug(B(), { error, run }, { sessionData: prompts(role) });
  }, VIEWER.debug);
}
