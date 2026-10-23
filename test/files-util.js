import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { createStore } from '../src/core/store.js';
import { buildGraph } from '../src/analysis/graph.js';
import { lint } from '../src/health/lint.js';
import { createRouter } from '../src/server/router.js';
import filesRoutes from '../src/server/routes/files.js';
import taskRoutes from '../src/server/routes/tasks.js';

export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mdctl-f-'));
export const put = (root, rel, c) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), c); };
export const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

export async function makeCtx(root, { edit = true, state = true } = {}) {
  const config = loadConfig(root, { actions: { edit, exec: false, danger: false, terminal: false } });
  const store = createStore(root, config);
  await store.init();
  const sent = [];
  const ctx = {
    root, config, store, sent,
    broadcast: (name, data) => sent.push([name, data]),
    invalidate: () => {},
    can: (level, role) => (level === 'read' ? true : level === 'state' ? role === 'admin' && state : role === 'admin' && !!config.actions[level]),
    allFiles: () => [...store.files.values()],
    async analysis() {
      const files = ctx.allFiles();
      const graph = buildGraph(files, store.contents);
      const issues = lint({ root, files, contents: store.contents, links: graph.edges });
      return { graph, issues };
    },
  };
  return ctx;
}

export async function makeApi(root, opts) {
  const ctx = await makeCtx(root, opts);
  const router = createRouter();
  await filesRoutes(router, ctx);
  await taskRoutes(router, ctx);
  const api = async (method, url, body, role = 'admin') => {
    const u = new URL(url, 'http://x');
    const route = router.match(method, u.pathname);
    if (!route) throw new Error(`no route ${method} ${u.pathname}`);
    if (!ctx.can(route.level, role)) return { status: 403, body: { error: 'forbidden' } };
    let status = 200; let out;
    const res = { writeHead(s) { status = s; }, end(b) { out = JSON.parse(b); }, headersSent: false };
    try {
      const v = await route.fn({ req: {}, res, url: u, q: u.searchParams, body: body || {}, ctx, role });
      if (v !== undefined) out = v;
    } catch (e) { status = e.status || 500; out = { error: e.message }; }
    return { status, body: out };
  };
  return { ctx, api, router };
}
