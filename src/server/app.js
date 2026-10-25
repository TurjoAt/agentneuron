import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createStore } from '../core/store.js';
import { createAnalyzer } from '../core/analyze.js';
import { createWatcher } from '../core/watcher.js';
import { lineDiff } from '../core/diff.js';
import { ensureAgentneuronDir } from '../core/config.js';
import { createGit } from '../analysis/git.js';
import { effectiveContext, contextDirs } from '../analysis/context.js';
import { readAgentConfig } from '../health/configview.js';
import { createSessions } from '../agents/sessions.js';
import { createConflictRadar } from '../agents/conflicts.js';
import { createRouter, HttpError } from './router.js';
import { registerAll } from './routes/index.js';
import { VERSION } from './version.js';
import { createRegistry } from '../actions/registry.js';
import { registerActions } from '../actions/index.js';
import { createPersist } from '../persist/index.js';
import { createNotifier } from '../notify/index.js';
import { validRev } from '../git2/run.js';

export { VERSION };
const SESSION_COOKIE = 'agentneuron_session';
const SESSION_TTL = 7 * 24 * 3600 * 1000;

const FALLBACK_HTML = `<!doctype html><meta charset="utf-8"><title>agentneuron</title>
<body style="font:15px system-ui;background:#0b0d12;color:#dde;padding:2rem">
<h1>agentneuron</h1><p>The UI bundle is not built. Run <code>npm run build</code>.</p>
<p>The JSON API is live: <a style="color:#8cf" href="api/state">/api/state</a></p></body>`;

const MAX_SSE_CLIENTS = 100;
const FAIL_FREE = 5; // wrong-credential attempts per IP before backoff starts
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Hostname part of a Host header ("[::1]:80" -> "::1", "Localhost:4747" -> "localhost"). */
export function hostnameOf(h) {
  h = String(h || '').trim().toLowerCase();
  if (h.startsWith('[')) { const i = h.indexOf(']'); return i < 0 ? '' : h.slice(1, i); }
  const i = h.indexOf(':');
  return (i >= 0 ? h.slice(0, i) : h).replace(/\.$/, '');
}

/** CSP for the single-file UI: inline scripts are allow-listed by sha256 (no 'unsafe-inline' for scripts). */
export function uiCsp(html) {
  const hashes = [];
  for (const m of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    hashes.push(`'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`);
  }
  return [
    "default-src 'none'", `script-src ${hashes.length ? hashes.join(' ') : "'none'"}`, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:", "font-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'",
    "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; ');
}
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function isLoopback(h) {
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function loadUi() {
  if (typeof globalThis.__AGENTNEURON_UI__ === 'string' && globalThis.__AGENTNEURON_UI__.length) return globalThis.__AGENTNEURON_UI__;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
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
  try { ensureAgentneuronDir(root); } catch { /* read-only project is fine */ }

  const startedAt = Date.now();
  const store = createStore(root, config);
  await store.init();
  const git = createGit(root);
  const sessions = createSessions(root);
  const radar = createConflictRadar({ windowMs: 120000 });
  const html = loadUi();

  // ---- analysis cache -------------------------------------------------
  let recomputeTimer = null;
  const clients = new Set();
  const allFiles = () => [...store.files.values()];
  const analyzer = createAnalyzer({ root, store, git, warn });
  const analysis = analyzer.analysis;

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

  function warn(what, e) { if (process.env.AGENTNEURON_DEBUG) console.error(`[agentneuron] ${what}:`, e); }

  function broadcast(name, data) {
    const msg = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      if (name === 'joblog' && res.agentRole !== 'admin') continue; // command output is admin-only
      try { res.write(msg); } catch { clients.delete(res); } }
  }

  function scheduleRecompute() {
    analyzer.invalidate();
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(async () => {
      try {
        const a = await analysis();
        broadcast('health', { score: a.health.score, grade: a.health.grade, counts: a.health.counts });
        broadcast('graph', { changed: true });
        try { afterAnalysis(a); } catch (e) { warn('afterAnalysis', e); }
      } catch (e) { warn('recompute', e); }
    }, 300);
    recomputeTimer.unref?.();
  }

  // ---- event pipeline -------------------------------------------------
  store.on('event', (ev) => {
    scheduleRecompute();
    repo.ts = 0;
    if (ev.type === 'unlink') { ctx.persist.events.append(ev); broadcast('event', ev); return; }
    // attribute best-effort, short timeout, then broadcast
    withTimeout(sessions.attribute(ev.path, ev.ts), 400, null).then((agent) => {
      if (agent) {
        ev.agent = agent;
        try {
          radar.note(ev); const act = radar.active();
          if (act.length) { broadcast('conflict', act); notifyConflicts(act); }
        } catch (e) { warn('radar', e); }
      }
      ctx.persist.events.append(ev);
      broadcast('event', ev);
    }).catch((e) => warn('event pipeline', e)); // never an unhandled rejection
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

  // ---- auth: cookie session OR ?token= OR Bearer ----------------------
  const tokenRequired = () => !!(config.token || config.adminToken);
  const sessionsMap = new Map(); // sid -> { role, exp }
  const failures = new Map(); // ip -> { n, until }
  // Hash both sides first: constant time regardless of length, no length oracle.
  const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
  const eq = (given, want) => {
    if (!want) return false;
    return crypto.timingSafeEqual(digest(given), digest(want));
  };
  /** Seconds the IP is locked out for (0 = not blocked). Exponential backoff after FAIL_FREE misses. */
  function blockedFor(ip) {
    const f = failures.get(ip);
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  }
  function noteFail(ip) {
    const f = failures.get(ip) || { n: 0, until: 0 };
    f.n++; f.seen = Date.now();
    if (f.n >= FAIL_FREE) f.until = Date.now() + Math.min(30000 * 2 ** (f.n - FAIL_FREE), 15 * 60000);
    failures.set(ip, f);
    if (failures.size > 1000) { // bounded memory: drop expired, then oldest
      for (const [k, v] of failures) if (v.until < Date.now() && Date.now() - v.seen > 15 * 60000) failures.delete(k);
      while (failures.size > 1000) failures.delete(failures.keys().next().value);
    }
  }
  /** Role for a token value, or null. */
  function roleForToken(given) {
    if (!given) return null;
    if (config.adminToken) {
      if (eq(given, config.adminToken)) return 'admin';
      if (config.token && eq(given, config.token)) return 'viewer';
      return null;
    }
    return eq(given, config.token) ? 'admin' : null;
  }
  function parseCookies(req) {
    const out = new Map();
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('='); if (i < 0) continue;
      out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
    return out;
  }
  function sessionRole(req) {
    const sid = parseCookies(req).get(SESSION_COOKIE);
    const s = sid && sessionsMap.get(sid);
    if (!s) return null;
    if (s.exp < Date.now()) { sessionsMap.delete(sid); return null; }
    return s.role;
  }
  /** -> { role, via } or null when unauthenticated. */
  function authenticate(req, url) {
    if (!tokenRequired()) return { role: 'admin', via: 'none' };
    const h = req.headers.authorization || '';
    const given = url.searchParams.get('token') || (h.startsWith('Bearer ') ? h.slice(7) : '');
    if (given) { const r = roleForToken(given); if (r) return { role: r, via: 'token' }; return null; }
    const r = sessionRole(req);
    return r ? { role: r, via: 'cookie' } : null;
  }
  const isHttps = (req) => !!req.socket?.encrypted || /(^|,)\s*https\s*(,|$)/i.test(String(req.headers['x-forwarded-proto'] || ''));
  const cookieHeader = (sid, maxAge, req) =>
    `${SESSION_COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${req && isHttps(req) ? '; Secure' : ''}`;
  function levelsFor(role) {
    const l = { read: true, state: ctx.can('state', role), edit: ctx.can('edit', role), exec: ctx.can('exec', role), danger: ctx.can('danger', role), terminal: ctx.can('terminal', role) };
    return l;
  }
  async function handleAuth(req, res, url) {
    const p = url.pathname;
    if (p === '/api/auth/me' && req.method === 'GET') {
      const a = authenticate(req, url);
      const role = a ? a.role : null;
      return json(res, 200, { role, levels: role ? levelsFor(role) : { read: false, state: false, edit: false, exec: false, danger: false, terminal: false }, tokenRequired: tokenRequired() });
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || '?';
      const wait = blockedFor(ip);
      if (wait) { res.setHeader('retry-after', String(wait)); return bad(res, 429, 'too many attempts, try again later'); }
      let body; try { body = await readBody(req); } catch (e) { return bad(res, e.status || 400, e.message || 'bad body'); }
      const role = tokenRequired() ? roleForToken(typeof body.token === 'string' ? body.token : '') : 'admin';
      if (!role) {
        noteFail(ip);
        ctx.persist.audit.log({ role: null, ip, route: 'POST /api/auth/login', status: 401 });
        return bad(res, 401, 'invalid token');
      }
      failures.delete(ip);
      const sid = crypto.randomBytes(24).toString('hex');
      sessionsMap.set(sid, { role, exp: Date.now() + SESSION_TTL });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': cookieHeader(sid, SESSION_TTL / 1000, req) });
      return res.end(JSON.stringify({ role, levels: levelsFor(role), tokenRequired: tokenRequired() }));
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const sid = parseCookies(req).get(SESSION_COOKIE);
      if (sid) sessionsMap.delete(sid);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': cookieHeader('', 0, req) });
      return res.end('{"ok":true}');
    }
    return bad(res, 404, 'unknown endpoint');
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
      allowWrite: !!(config.actions && config.actions.edit),
      actions: { ...config.actions },
      fileEnabled: config.fileEnabled || [], // risky levels enabled by .agentneuron/config.json (not by the CLI)
      configWarning: config.configWarning || null,
    };
  }

  const BODY_LIMIT = Math.max(2e6, (Number(config.maxFileSize) || 0) * 2 + 65536);
  async function readBody(req) {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new HttpError(413, 'body too large');
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > BODY_LIMIT) throw new HttpError(413, 'body too large'); chunks.push(c); }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    let v;
    try { v = JSON.parse(raw); } catch { throw new HttpError(400, 'invalid JSON'); }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'body must be a JSON object');
    return v;
  }

  async function diffRoute(q) {
    const p = safePath(q.get('path'));
    if (!p) return [400, { error: 'bad path' }];
    const from = q.get('from') || 'git:HEAD';
    const to = q.get('to') || 'current';
    // a git ref that starts with "-" would be parsed by `git show` as an option (e.g. --output=FILE)
    for (const ref of [from, to]) if (ref.startsWith('git:') && ref.length > 4 && !validRev(ref.slice(4))) return [400, { error: 'bad ref' }];
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
  const router = createRouter();
  const canLevel = (level, role) => {
    if (level === 'read') return true;
    if (role !== 'admin') return false;
    if (level === 'state') return true;
    if (!['edit', 'exec', 'danger', 'terminal'].includes(level)) return false;
    return !!(config.actions && config.actions[level]);
  };
  const ctx = {
    root, config, store, git, sessions, radar, startedAt,
    analysis, repoInfo, allFiles, broadcast, warn,
    invalidate: scheduleRecompute,
    /** read: always; state: admin; edit/exec/danger/terminal: admin AND config.actions[level]. */
    can: canLevel,
  };
  ctx.notify = createNotifier(ctx);
  ctx.persist = createPersist(ctx);
  ctx.actions = createRegistry(ctx);
  await registerActions(ctx.actions, ctx);
  await registerAll(router, ctx);

  // ---- notification triggers -------------------------------------------
  const seenSecrets = new Set();
  let secretsPrimed = false;
  let lastScore = null;
  const conflictSeen = new Map();
  function afterAnalysis(a) {
    ctx.persist.metrics.onHealth(a.health.score);
    const cur = new Set();
    for (const i of a.issues) if (i.rule === 'secret') cur.add(i.id);
    if (secretsPrimed) {
      for (const i of a.issues) {
        if (i.rule === 'secret' && !seenSecrets.has(i.id)) {
          ctx.notify('secret', { title: 'Possible secret in context file', body: `${i.path}${i.line ? ':' + i.line : ''}`, path: i.path });
        }
      }
    }
    seenSecrets.clear(); for (const id of cur) seenSecrets.add(id);
    secretsPrimed = true;
    if (lastScore != null && lastScore - a.health.score >= 10) {
      ctx.notify('health-drop', { title: `Health dropped to ${a.health.score} (${a.health.grade})`, body: `was ${lastScore}` });
    }
    lastScore = a.health.score;
  }
  function notifyConflicts(act) {
    const now = Date.now();
    for (const c of act) {
      const key = c.path || JSON.stringify(c);
      if (now - (conflictSeen.get(key) || 0) < 5 * 60 * 1000) continue;
      conflictSeen.set(key, now);
      ctx.notify('conflict', { title: 'Agent conflict', body: c.path || 'multiple agents editing the same file', path: c.path });
    }
  }
  analysis().then((a) => { lastScore = a.health.score; for (const i of a.issues) if (i.rule === 'secret') seenSecrets.add(i.id); secretsPrimed = true; }).catch(() => {});
  ctx.persist.start();

  async function handlePlugin(req, res, url, role) {
    const route = router.match(req.method, url.pathname);
    if (!route) return false;
    const audited = route.level !== 'read';
    const ip = req.socket?.remoteAddress || null;
    if (!ctx.can(route.level, role)) {
      const why = route.level === 'state' ? 'requires the admin role' : `action level "${route.level}" is disabled - enable it in .agentneuron/config.json (actions.${route.level}: true) or start with --enable ${route.level}`;
      if (audited) ctx.persist.audit.log({ role, ip, route: `${req.method} ${url.pathname}`, status: 403 });
      bad(res, 403, why);
      return true;
    }
    let body = {};
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try { body = await readBody(req); } catch (e) { bad(res, e.status || 400, e.message || 'bad body'); return true; }
    }
    try {
      const out = await route.fn({ req, res, url, q: url.searchParams, body, ctx, role });
      if (out !== undefined && !res.headersSent) json(res, 200, out);
      if (audited) ctx.persist.audit.log({ role, ip, route: `${req.method} ${url.pathname}`, params: req.method === 'GET' ? Object.fromEntries(url.searchParams) : body, status: res.statusCode || 200 });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500; // unexpected errors are 500, never a process exit
      if (audited) ctx.persist.audit.log({ role, ip, route: `${req.method} ${url.pathname}`, params: req.method === 'GET' ? Object.fromEntries(url.searchParams) : body, status });
      if (res.headersSent) { try { res.end(); } catch {} return true; }
      if (e instanceof HttpError) bad(res, e.status, e.message);
      else { warn('route ' + url.pathname, e); bad(res, 500, (e instanceof Error && e.message) || 'internal error'); }
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
        if (clients.size >= MAX_SSE_CLIENTS) { res.setHeader('retry-after', '5'); return bad(res, 503, 'too many event streams'); }
        res.writeHead(200, {
          'content-type': 'text/event-stream', 'cache-control': 'no-store',
          connection: 'keep-alive', 'x-accel-buffering': 'no',
        });
        res.write(`retry: 2000\n\n`);
        const lastId = Number(req.headers['last-event-id'] || q.get('since') || 0);
        if (lastId) for (const e of store.events) if (e.id > lastId) res.write(`event: event\ndata: ${JSON.stringify(e)}\n\n`);
        res.agentRole = role;
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
    }
    return bad(res, 404, 'unknown endpoint');
  }

  const htmlCsp = uiCsp(html);
  const allowedHosts = new Set([...LOOPBACK_HOSTS, hostnameOf(config.host)]);
  const server = http.createServer(async (req, res) => {
    // security headers on every response (API, UI, errors)
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('cross-origin-opener-policy', 'same-origin');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const url = new URL(req.url, 'http://localhost');
      const isApi = url.pathname.startsWith('/api/');
      res.setHeader('content-security-policy', isApi ? API_CSP : htmlCsp);
      // DNS rebinding: without a token the only protection is the Host header, so it must name this machine.
      if (!tokenRequired() && !allowedHosts.has(hostnameOf(req.headers.host))) return bad(res, 403, 'invalid host header');
      if (isApi) {
        const ip = req.socket?.remoteAddress || '?';
        const safeMethod = req.method === 'GET' || req.method === 'HEAD';
        if (!safeMethod) {
          // CSRF: browsers always label cross-site requests; a state change must be same-origin JSON.
          const sfs = req.headers['sec-fetch-site'];
          if (sfs && sfs !== 'same-origin' && sfs !== 'none') return bad(res, 403, 'cross-origin request refused');
          const origin = req.headers.origin;
          if (origin !== undefined) {
            let oh = ''; try { oh = new URL(origin).host; } catch { /* "null" or malformed */ }
            if (!oh || oh !== req.headers.host) return bad(res, 403, 'cross-origin request refused');
          }
          const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'] !== undefined;
          if (hasBody && !/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) return bad(res, 415, 'content-type must be application/json');
        }
        // brute force: every wrong token (query, bearer, login) counts against the client IP
        const h = req.headers.authorization || '';
        const presented = url.searchParams.get('token') || (h.startsWith('Bearer ') ? h.slice(7) : '');
        if (presented && tokenRequired() && url.pathname !== '/api/auth/login') {
          const wait = blockedFor(ip);
          if (wait) { res.setHeader('retry-after', String(wait)); return bad(res, 429, 'too many attempts, try again later'); }
          if (roleForToken(presented)) failures.delete(ip); else noteFail(ip);
        }
        if (url.pathname.startsWith('/api/auth/')) return await handleAuth(req, res, url);
        const auth = authenticate(req, url);
        if (!auth) {
          res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
          return res.end(JSON.stringify({ error: 'unauthorized' }));
        }
        return await handle(req, res, url, auth.role);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return bad(res, 405, 'method not allowed');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    } catch (e) {
      warn('request', e);
      try { if (!res.headersSent) bad(res, 500, 'internal error'); else res.end(); } catch { /* socket gone */ }
    }
  });
  server.requestTimeout = 60000; // slow-body clients cannot hold a connection open forever
  server.headersTimeout = 20000;
  server.on('clientError', (_e, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n'); } catch { /* gone */ } });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port ?? 4747, config.host, resolve);
    });
  } catch (e) { // e.g. EADDRINUSE: release the watcher, timers and jobs so the process can exit
    clearInterval(ping); clearTimeout(recomputeTimer);
    try { ctx.actions.cancelAll(); ctx.persist.stop(); } catch {}
    try { await watcher.close(); } catch {}
    throw e;
  }
  const addr = server.address();
  const shown = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  const base = `http://${shown.includes(':') ? `[${shown}]` : shown}:${addr.port}`;
  const shareToken = config.adminToken || config.token;
  const url = shareToken ? `${base}/?token=${shareToken}` : `${base}/`;
  ctx.url = `${base}/`;

  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    clearInterval(ping); clearTimeout(recomputeTimer);
    try { ctx.actions.cancelAll(); ctx.persist.stop(); } catch {}
    try { ctx.workspace?.cleanup?.(); } catch {}
    for (const res of clients) { try { res.end(); } catch {} }
    clients.clear();
    try { await watcher.close(); } catch {}
    server.closeAllConnections?.();
    await new Promise((r) => server.close(() => r()));
  }
  return { url, port: addr.port, token: config.token || null, adminToken: config.adminToken || null, close, store, ctx };
}
