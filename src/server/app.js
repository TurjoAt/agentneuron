import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createStore } from '../core/store.js';
import { createWatcher } from '../core/watcher.js';
import { lineDiff } from '../core/diff.js';
import { ensureMdctlDir } from '../core/config.js';
import { createGit } from '../analysis/git.js';
import { buildGraph } from '../analysis/graph.js';
import { effectiveContext, contextDirs } from '../analysis/context.js';
import { extractTasks } from '../analysis/tasks.js';
import { extractDecisions } from '../analysis/decisions.js';
import { lint } from '../health/lint.js';
import { healthScore } from '../health/score.js';
import { readAgentConfig } from '../health/configview.js';
import { createSessions } from '../agents/sessions.js';
import { createConflictRadar } from '../agents/conflicts.js';
import { createRouter, HttpError } from './router.js';
import { registerAll } from './routes/index.js';

export const VERSION = globalThis.__MDCTL_VERSION__ || '0.1.0';

const FALLBACK_HTML = `<!doctype html><meta charset="utf-8"><title>mdctl</title>
<body style="font:15px system-ui;background:#0b0d12;color:#dde;padding:2rem">
<h1>mdctl</h1><p>The UI bundle is not built. Run <code>npm run build</code>.</p>
<p>The JSON API is live: <a style="color:#8cf" href="api/state">/api/state</a></p></body>`;

function isLoopback(h) {
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function loadUi() {
  if (typeof globalThis.__MDCTL_UI__ === 'string' && globalThis.__MDCTL_UI__.length) return globalThis.__MDCTL_UI__;
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    return fs.readFileSync(path.resolve(here, '../../ui/dist/index.html'), 'utf8');
  } catch { return FALLBACK_HTML; }
}

function withTimeout(p, ms, fallback = null) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

export async function startServer(config) {
  const root = config.root;
  if (!config.host) config.host = '127.0.0.1';
  if (!isLoopback(config.host) && !config.token) {
    config.token = crypto.randomBytes(12).toString('hex');
    config.tokenGenerated = true;
  }
  try { ensureMdctlDir(root); } catch { /* read-only project is fine */ }

  const startedAt = Date.now();
  const store = createStore(root, config);
  await store.init();
  const git = createGit(root);
  const sessions = createSessions(root);
  const radar = createConflictRadar({ windowMs: 120000 });
  const html = loadUi();

  // ---- analysis cache -------------------------------------------------
  let dirty = true;
  let cache = null;
  let recomputeTimer = null;
  const clients = new Set();

  const allFiles = () => [...store.files.values()];

  async function compute() {
    const files = allFiles();
    const contents = store.contents;
    let graph = { nodes: [], edges: [] };
    try { graph = buildGraph(files, contents); } catch (e) { warn('graph', e); }
    let issues = [];
    try { issues = lint({ root, files, contents, links: graph.edges }) || []; } catch (e) { warn('lint', e); }
    let health = { score: 100, grade: 'A', counts: { error: 0, warn: 0, info: 0 }, byRule: {} };
    try { health = healthScore(issues, files); } catch (e) { warn('score', e); }
    let gitStatus = new Map(); let gitAvail = false;
    try { gitAvail = await git.available(); if (gitAvail) gitStatus = await git.status(); } catch (e) { warn('git', e); }
    let tasks = [], decisions = [];
    for (const f of files) {
      const c = contents.get(f.path); if (c == null) continue;
      try { tasks.push(...extractTasks(f.path, c)); } catch (e) { warn('tasks', e); }
      try { decisions.push(...extractDecisions(f.path, c, f.kind)); } catch (e) { warn('decisions', e); }
    }
    cache = { graph, issues, health, gitStatus, gitAvail, tasks, decisions };
    dirty = false;
    return cache;
  }
  let computing = null;
  async function analysis() {
    if (!dirty && cache) return cache;
    if (!computing) computing = compute().finally(() => { computing = null; });
    return computing;
  }
  // repoInfo shells out to git several times (~1-2s on big repos): serve the last
  // value immediately and refresh in the background when it is older than REPO_TTL.
  const REPO_TTL = 10000;
  let repo = { value: null, ts: 0, inflight: null };
  function refreshRepo() {
    if (!repo.inflight) {
      repo.inflight = withTimeout(git.repoInfo(), 8000, null)
        .then((v) => { if (v) repo.value = v; repo.ts = Date.now(); return repo.value; })
        .finally(() => { repo.inflight = null; });
    }
    return repo.inflight;
  }
  async function repoInfo() {
    if (repo.value && Date.now() - repo.ts < REPO_TTL) return repo.value;
    const p = refreshRepo();
    return repo.value ?? (await p);
  }
  git.available().then((ok) => ok && refreshRepo()).catch(() => {});
  analysis().catch(() => {});

  function warn(what, e) { if (process.env.MDCTL_DEBUG) console.error(`[mdctl] ${what}:`, e); }

  function broadcast(name, data) {
    const msg = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) { try { res.write(msg); } catch { clients.delete(res); } }
  }

  function scheduleRecompute() {
    dirty = true;
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(async () => {
      try {
        const a = await analysis();
        broadcast('health', { score: a.health.score, grade: a.health.grade, counts: a.health.counts });
        broadcast('graph', { changed: true });
      } catch (e) { warn('recompute', e); }
    }, 300);
    recomputeTimer.unref?.();
  }

  // ---- event pipeline -------------------------------------------------
  const pending = new Map(); // event id -> Promise for attribution
  store.on('event', (ev) => {
    scheduleRecompute();
    repo.ts = 0;
    if (ev.type === 'unlink') { broadcast('event', ev); return; }
    // attribute best-effort, short timeout, then broadcast
    withTimeout(sessions.attribute(ev.path, ev.ts), 400, null).then((agent) => {
      if (agent) {
        ev.agent = agent;
        try { radar.note(ev); const act = radar.active(); if (act.length) broadcast('conflict', act); } catch (e) { warn('radar', e); }
      }
      broadcast('event', ev);
    });
  });

  const watcher = createWatcher(root, config, (e) => {
    store.handleFsEvent(e).catch((err) => warn('fsevent', err));
  });

  // heartbeat
  const ping = setInterval(() => broadcast('ping', { ts: Date.now() }), 20000);
  ping.unref?.();

  // ---- routes ---------------------------------------------------------
  const json = (res, code, body) => {
    const s = JSON.stringify(body);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(s);
  };
  const bad = (res, code, msg) => json(res, code, { error: msg });

  function safePath(p) {
    if (!p || typeof p !== 'string') return null;
    p = p.replace(/\\/g, '/');
    if (p.startsWith('/') || p.split('/').includes('..')) return null;
    return p;
  }

  function authOk(req, url) {
    if (!config.token) return true;
    const h = req.headers.authorization || '';
    const given = url.searchParams.get('token') || (h.startsWith('Bearer ') ? h.slice(7) : '');
    const a = Buffer.from(given), b = Buffer.from(String(config.token));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async function countsState() {
    const a = await analysis();
    const files = allFiles();
    const byTool = {}, byKind = {}; let tokens = 0;
    for (const f of files) {
      tokens += f.tokens || 0;
      byTool[f.tool] = (byTool[f.tool] || 0) + 1;
      byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    }
    let branch = null, dirtyN = 0;
    if (a.gitAvail) {
      const info = await repoInfo();
      if (info) { branch = info.branch; dirtyN = info.dirty; }
    }
    return {
      project: { root, name: path.basename(root) },
      version: VERSION, startedAt,
      counts: { files: files.length, tokens, byTool, byKind },
      health: { score: a.health.score, grade: a.health.grade, counts: a.health.counts },
      git: { available: a.gitAvail, branch, dirty: dirtyN },
      allowWrite: !!config.allowWrite,
    };
  }

  async function readBody(req) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > 1e6) throw new Error('body too large'); chunks.push(c); }
    const s = Buffer.concat(chunks).toString('utf8');
    return s ? JSON.parse(s) : {};
  }

  async function diffRoute(q) {
    const p = safePath(q.get('path'));
    if (!p) return [400, { error: 'bad path' }];
    const from = q.get('from') || 'git:HEAD';
    const to = q.get('to') || 'current';
    const resolve = async (ref) => {
      if (ref === 'current') return store.contents.get(p) ?? '';
      if (ref.startsWith('git:')) return (await git.show(p, ref.slice(4) || 'HEAD')) ?? '';
      return store.history.get(p, ref);
    };
    const a = await resolve(from), b = await resolve(to);
    if (a == null || b == null) return [404, { error: 'version not found' }];
    const d = lineDiff(a, b);
    return [200, { path: p, from, to, hunks: d.hunks, added: d.added, removed: d.removed }];
  }

  // ---- plugin routes (src/server/routes/*) ------------------------------
  const LEVELS = ['read', 'edit', 'exec', 'danger'];
  const router = createRouter();
  const ctx = {
    root, config, store, git, sessions, radar, startedAt,
    analysis, repoInfo, allFiles, broadcast, warn,
    invalidate: scheduleRecompute,
    /** Is `level` allowed for `role`? Non-read levels must be enabled in config.actions. */
    can(level, role) {
      if (level === 'read') return true;
      if (!LEVELS.includes(level) || role !== 'admin') return false;
      return !!(config.actions && config.actions[level]);
    },
  };
  await registerAll(router, ctx);

  async function handlePlugin(req, res, url, role) {
    const route = router.match(req.method, url.pathname);
    if (!route) return false;
    if (!ctx.can(route.level, role)) {
      bad(res, 403, `action level "${route.level}" is disabled — enable it in .mdctl/config.json (actions.${route.level}: true)`);
      return true;
    }
    let body = {};
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try { body = await readBody(req); } catch { bad(res, 400, 'bad body'); return true; }
    }
    try {
      const out = await route.fn({ req, res, url, q: url.searchParams, body, ctx, role });
      if (out !== undefined && !res.headersSent) json(res, 200, out);
    } catch (e) {
      if (res.headersSent) { try { res.end(); } catch {} return true; }
      if (e instanceof HttpError) bad(res, e.status, e.message);
      else { warn('route ' + url.pathname, e); bad(res, 500, String(e.message || e)); }
    }
    return true;
  }

  async function handle(req, res, url, role = 'admin') {
    if (await handlePlugin(req, res, url, role)) return;
    const q = url.searchParams;
    const r = url.pathname;
    const A = () => analysis();
    switch (r) {
      case '/api/state': return json(res, 200, await countsState());
      case '/api/files': {
        const a = await A();
        return json(res, 200, allFiles().map((f) => (a.gitAvail ? { ...f, gitStatus: a.gitStatus.get(f.path) || null } : f)));
      }
      case '/api/file': {
        const p = safePath(q.get('path'));
        const entry = p && store.files.get(p);
        if (!entry) return bad(res, 404, 'not found');
        const a = await A();
        const [log] = await Promise.all([a.gitAvail ? withTimeout(git.fileLog(p, 30), 3000, []) : []]);
        return json(res, 200, {
          entry, content: store.contents.get(p) ?? '',
          links: { out: a.graph.edges.filter((e) => e.from === p), in: a.graph.edges.filter((e) => e.to === p) },
          history: store.history.list(p),
          git: { log, status: a.gitStatus.get(p) || null },
        });
      }
      case '/api/diff': { const [c, b] = await diffRoute(q); return json(res, c, b); }
      case '/api/history': {
        const p = safePath(q.get('path')); if (!p) return bad(res, 400, 'bad path');
        return json(res, 200, store.history.list(p));
      }
      case '/api/history/content': {
        const p = safePath(q.get('path')); if (!p) return bad(res, 400, 'bad path');
        const content = store.history.get(p, q.get('id') || '');
        if (content == null) return bad(res, 404, 'not found');
        return json(res, 200, { content });
      }
      case '/api/restore': {
        if (req.method !== 'POST') return bad(res, 405, 'POST only');
        if (!config.allowWrite) return bad(res, 403, 'writes disabled (start with --write)');
        let body; try { body = await readBody(req); } catch { return bad(res, 400, 'bad body'); }
        const p = safePath(body.path);
        if (!p || !body.id) return bad(res, 400, 'path and id required');
        try { return json(res, 200, store.history.restore(p, body.id)); }
        catch (e) { return bad(res, 404, String(e.message || e)); }
      }
      case '/api/events': {
        const since = Number(q.get('since') || 0);
        return json(res, 200, store.events.filter((e) => e.id > since));
      }
      case '/api/graph': return json(res, 200, (await A()).graph);
      case '/api/context': {
        const dir = (q.get('dir') || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (dir.split('/').includes('..')) return bad(res, 400, 'bad dir');
        return json(res, 200, effectiveContext(dir, allFiles(), store.contents, q.get('tool') || 'claude'));
      }
      case '/api/context/dirs': return json(res, 200, contextDirs(allFiles()));
      case '/api/health': {
        const a = await A();
        return json(res, 200, { ...a.health, issues: a.issues });
      }
      case '/api/tasks': return json(res, 200, (await A()).tasks);
      case '/api/decisions': return json(res, 200, (await A()).decisions);
      case '/api/git': {
        const a = await A();
        if (!a.gitAvail) return json(res, 200, { available: false });
        return json(res, 200, { available: true, ...((await repoInfo()) || {}) });
      }
      case '/api/config': return json(res, 200, readAgentConfig(root));
      case '/api/sessions': return json(res, 200, await withTimeout(sessions.list(), 5000, []));
      case '/api/conflicts': return json(res, 200, radar.active());
      case '/api/search': {
        const needle = (q.get('q') || '').toLowerCase();
        const out = [];
        if (needle) {
          outer: for (const [p, c] of store.contents) {
            const lines = c.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(needle)) {
                out.push({ path: p, line: i + 1, text: lines[i].trim().slice(0, 300) });
                if (out.length >= 200) break outer;
              }
            }
          }
        }
        return json(res, 200, out);
      }
      case '/api/stream': {
        res.writeHead(200, {
          'content-type': 'text/event-stream', 'cache-control': 'no-store',
          connection: 'keep-alive', 'x-accel-buffering': 'no',
        });
        res.write(`retry: 2000\n\n`);
        const lastId = Number(req.headers['last-event-id'] || q.get('since') || 0);
        if (lastId) for (const e of store.events) if (e.id > lastId) res.write(`event: event\ndata: ${JSON.stringify(e)}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
    }
    return bad(res, 404, 'unknown endpoint');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!authOk(req, url)) {
        res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      if (url.pathname.startsWith('/api/')) return await handle(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return bad(res, 405, 'method not allowed');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    } catch (e) {
      warn('request', e);
      if (!res.headersSent) bad(res, 500, String(e.message || e)); else res.end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port ?? 4747, config.host, resolve);
  });
  const addr = server.address();
  const shown = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  const base = `http://${shown.includes(':') ? `[${shown}]` : shown}:${addr.port}`;
  const url = config.token ? `${base}/?token=${config.token}` : `${base}/`;

  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    clearInterval(ping); clearTimeout(recomputeTimer);
    for (const res of clients) { try { res.end(); } catch {} }
    clients.clear();
    try { await watcher.close(); } catch {}
    server.closeAllConnections?.();
    await new Promise((r) => server.close(() => r()));
  }
  return { url, port: addr.port, token: config.token || null, close, store };
}
