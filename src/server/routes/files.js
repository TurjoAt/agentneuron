// File editor backend: raw/save/create/rename/delete/trash, links, replace, fixes, bookmarks, annotations.
import { HttpError } from '../router.js';
import { getOps } from '../../files/ops.js';
import { computeFixes, applyFix, publicFix } from '../../files/fixes.js';
import { createState } from '../../files/state.js';
import { FileError } from '../../files/paths.js';

const flag = (v) => v === '1' || v === 'true' || v === true;

export function guard(fn) {
  return async (a) => {
    try { return await fn(a); } catch (e) {
      if (e instanceof FileError) {
        if (e.extra && e.extra.conflict) {
          a.res.writeHead(e.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          a.res.end(JSON.stringify({ error: e.message, ...e.extra }));
          return undefined;
        }
        throw new HttpError(e.status, e.message);
      }
      throw e;
    }
  };
}

export default async function register(router, ctx) {
  const ops = getOps(ctx);
  const state = createState(ctx);
  const R = (m, p, fn, level) => router[m](p, guard(fn), { level });
  const replaceOpts = (o) => ({
    q: o.q, replace: o.replace ?? '', regex: flag(o.regex), caseSensitive: flag(o.case), word: flag(o.word),
    paths: typeof o.paths === 'string' ? o.paths.split(',').map((s) => s.trim()).filter(Boolean) : (Array.isArray(o.paths) ? o.paths : undefined),
  });

  R('get', '/api/file/raw', ({ q }) => ops.readRaw(q.get('path')), 'read');
  R('post', '/api/file/save', ({ body }) => ops.save(body || {}), 'edit');
  R('post', '/api/file/create', ({ body }) => ops.create(body || {}), 'edit');
  R('post', '/api/file/rename', ({ body }) => ops.rename({
    from: body.from, to: body.to, rewriteLinks: body.rewriteLinks !== false, dryRun: body.dryRun === true || body.dryRun === 'true' || body.dryRun === 1,
  }), 'edit');
  R('post', '/api/file/delete', ({ body }) => ops.remove({ path: body.path }), 'edit');
  R('get', '/api/trash', () => ops.listTrash(), 'read');
  R('post', '/api/trash/restore', ({ body }) => ops.restore({ id: body.id }), 'edit');
  R('post', '/api/trash/purge', ({ body }) => ops.purge({ id: body.id }), 'danger');

  R('get', '/api/links/resolve', ({ q }) => ops.resolveLink(q.get('from') || '', q.get('target') || ''), 'read');
  R('get', '/api/backlinks', ({ q }) => ops.backlinks(q.get('path')), 'read');

  R('get', '/api/replace/preview', ({ q }) => ops.replace(replaceOpts(Object.fromEntries(q))), 'read');
  R('post', '/api/replace/apply', ({ body }) => ops.replace(replaceOpts(body || {}), { apply: true }), 'edit');

  R('get', '/api/fixes', async ({ q }) => (await computeFixes(ctx, q.get('issue') || '')).fixes.map(publicFix), 'read');
  R('post', '/api/fixes/apply', ({ body }) => applyFix(ctx, body.issue, body.fix), 'edit');

  R('get', '/api/bookmarks', () => state.bookmarks(), 'read');
  R('post', '/api/bookmarks', ({ body }) => state.addBookmark(body || {}), 'state');
  R('post', '/api/bookmarks/remove', ({ body }) => state.removeBookmark(body || {}), 'state');

  R('get', '/api/annotations', ({ q }) => state.annotations(q.get('path') || ''), 'read');
  R('post', '/api/annotations', ({ body, role }) => state.addAnnotation(body || {}, role), 'state');
  R('post', '/api/annotations/remove', ({ body }) => state.removeAnnotation(body || {}), 'state');
  R('post', '/api/annotations/resolve', ({ body }) => state.resolveAnnotation(body || {}), 'state');
}
