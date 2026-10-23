// Tiny plugin router: feature modules register routes here instead of editing app.js.

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Handler: async ({ req, res, url, q, body, ctx, role }) => any
 *   - return a value → sent as 200 JSON
 *   - throw new HttpError(status, msg) → error JSON
 *   - return undefined after writing `res` yourself (streaming) → nothing more is sent
 * Options: { level: 'read'|'edit'|'exec'|'danger' } — minimum action level the
 * request needs (checked by app.js through ctx.can(level, role)). Default 'read'.
 */
export function createRouter() {
  const routes = new Map(); // "GET /api/x" -> { fn, level }
  const add = (method) => (path, fn, opts = {}) => {
    const key = `${method} ${path}`;
    if (routes.has(key)) throw new Error(`route already registered: ${key}`);
    routes.set(key, { fn, level: opts.level || 'read' });
  };
  return {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),
    match(method, path) { return routes.get(`${method} ${path}`) || null; },
    list() { return [...routes.keys()]; },
  };
}
