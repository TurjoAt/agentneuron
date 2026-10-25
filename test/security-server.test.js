import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadConfig } from '../src/core/config.js';
import { startServer, hostnameOf, uiCsp } from '../src/server/app.js';
import { createRegistry } from '../src/actions/registry.js';
import { isPrivateAddress, postWebhook, guardedLookup } from '../src/notify/index.js';

const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) { try { await f(); } catch { /* ignore */ } } });

async function boot(overrides = {}, setup) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-sec-'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# P\n\nhello\n');
  if (setup) setup(root);
  const srv = await startServer(loadConfig(root, { port: 0, ...overrides }));
  cleanups.push(async () => { await srv.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, srv, base: `http://127.0.0.1:${srv.port}`, port: srv.port };
}
const raw = (port, { method = 'GET', p = '/', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false }, (res) => {
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject); r.end(body);
});
const J = { 'content-type': 'application/json' };

test('security headers on UI and API responses; CSP hashes inline scripts', async () => {
  const { port } = await boot();
  for (const p of ['/', '/api/state', '/api/nope']) {
    const r = await raw(port, { p });
    assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
    assert.equal(r.headers['referrer-policy'], 'no-referrer', p);
    assert.equal(r.headers['x-frame-options'], 'DENY', p);
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/, p);
  }
  const csp = (await raw(port, { p: '/' })).headers['content-security-policy'];
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /img-src 'self' data:/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  const c2 = uiCsp('<script>alert(1)</script><script src="x.js"></script><script type="module">a()</script>');
  assert.equal((c2.match(/sha256-/g) || []).length, 2);
});

test('DNS rebinding: foreign Host header refused when no token is configured', async () => {
  const { port } = await boot();
  assert.equal((await raw(port, { p: '/api/state', headers: { host: 'evil.example.com' } })).status, 403);
  assert.equal((await raw(port, { p: '/', headers: { host: 'evil.example.com:4747' } })).status, 403);
  assert.equal((await raw(port, { p: '/api/state', headers: { host: `localhost:${port}` } })).status, 200);
  assert.equal((await raw(port, { p: '/api/state', headers: { host: `[::1]:${port}` } })).status, 200);
  assert.equal(hostnameOf('[::1]:80'), '::1');
  assert.equal(hostnameOf('LocalHost.:80'), 'localhost');
});

test('CSRF: state changes need same-origin JSON', async () => {
  const { port } = await boot();
  const post = (headers, body = '{}') => raw(port, { method: 'POST', p: '/api/bookmarks', headers: { host: `127.0.0.1:${port}`, ...headers }, body });
  assert.equal((await post({ 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post({ ...J, origin: 'http://evil.example.com' })).status, 403);
  assert.equal((await post({ ...J, origin: 'null' })).status, 403);
  assert.equal((await post({ ...J, 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post({ ...J, 'sec-fetch-site': 'same-site' })).status, 403);
  const ok = await post({ ...J, origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }, '{"path":"CLAUDE.md"}');
  assert.equal(ok.status, 200);
});

test('malformed bodies are 400/413, never a crash', async () => {
  const { port } = await boot();
  const post = (body) => raw(port, { method: 'POST', p: '/api/bookmarks', headers: { ...J, host: `127.0.0.1:${port}` }, body });
  assert.equal((await post('{bad')).status, 400);
  assert.equal((await post('null')).status, 400);
  assert.equal((await post('[1]')).status, 400);
  assert.equal((await post('{"x":"' + 'a'.repeat(3e6) + '"}').catch(() => ({ status: 413 }))).status, 413);
  assert.equal((await raw(port, { p: '/api/state' })).status, 200); // still alive
});

test('login brute force is rate limited with backoff, also via bearer/query tokens', async () => {
  const { port } = await boot({ token: 'right-token' });
  const login = (token) => raw(port, { method: 'POST', p: '/api/auth/login', headers: { ...J, host: `127.0.0.1:${port}` }, body: JSON.stringify({ token }) });
  for (let i = 0; i < 5; i++) assert.equal((await login('wrong' + i)).status, 401);
  const blocked = await login('right-token');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.equal((await raw(port, { p: '/api/state', headers: { authorization: 'Bearer right-token' } })).status, 429);
  const { port: p2 } = await boot({ token: 'tok2' });
  for (let i = 0; i < 5; i++) assert.equal((await raw(p2, { p: `/api/state?token=bad${i}` })).status, 401);
  assert.equal((await raw(p2, { p: '/api/auth/me?token=bad' })).status, 429);
});

test('session cookie: HttpOnly, SameSite=Strict, Secure behind https', async () => {
  const { port } = await boot({ token: 'cookie-token' });
  const login = (extra) => raw(port, { method: 'POST', p: '/api/auth/login', headers: { ...J, host: `127.0.0.1:${port}`, ...extra }, body: '{"token":"cookie-token"}' });
  const plain = (await login({})).headers['set-cookie'][0];
  assert.match(plain, /HttpOnly/); assert.match(plain, /SameSite=Strict/); assert.ok(!/Secure/.test(plain));
  const tls = (await login({ 'x-forwarded-proto': 'https' })).headers['set-cookie'][0];
  assert.match(tls, /; Secure/);
});

test('non-loopback bind without a token generates one', async () => {
  const { srv } = await boot({ host: '0.0.0.0' });
  assert.ok(srv.token && srv.token.length >= 16);
});

test('/api/diff refuses git refs that would be parsed as options (--output=FILE)', async () => {
  const { port, root } = await boot();
  const victim = path.join(root, 'victim.txt');
  const r = await raw(port, { p: `/api/diff?path=CLAUDE.md&from=${encodeURIComponent('git:--output=' + victim)}` });
  assert.equal(r.status, 400);
  assert.ok(!fs.existsSync(victim));
});

test('/api/restore does not follow symlinks out of the project', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-out-'));
  cleanups.push(() => fs.rmSync(outside, { recursive: true, force: true }));
  const { port } = await boot({ actions: { edit: true } }, (root) => fs.symlinkSync(outside, path.join(root, 'docs')));
  const r = await raw(port, { method: 'POST', p: '/api/restore', headers: { ...J, host: `127.0.0.1:${port}` }, body: '{"path":"docs/x.md","id":"1-abc"}' });
  assert.equal(r.status, 403);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('audit log never contains the token passed in the query string', async () => {
  const { port, root } = await boot({ adminToken: 'admin-secret-token', token: 'viewer-token' });
  await raw(port, { p: '/api/audit?token=admin-secret-token' });
  await raw(port, { p: '/api/audit?token=admin-secret-token' });
  const log = fs.readFileSync(path.join(root, '.agentneuron', 'audit.jsonl'), 'utf8');
  assert.ok(log.length > 0 && !log.includes('admin-secret-token'));
});

test('terminal needs both danger and terminal; config token never served', async () => {
  const { port } = await boot({ actions: { danger: true }, adminToken: 'a-token-value', token: 'v-token-value' });
  const H = { ...J, host: `127.0.0.1:${port}`, authorization: 'Bearer a-token-value' };
  const run = () => raw(port, { method: 'POST', p: '/api/actions/run', headers: H, body: JSON.stringify({ id: 'agentneuron.terminal', params: { command: 'node -v' } }) });
  assert.equal((await run()).status, 403);
  for (const p of ['/api/settings', '/api/state', '/api/actions']) {
    const r = await raw(port, { p, headers: H });
    assert.ok(!r.body.includes('a-token-value') && !r.body.includes('v-token-value'), p);
  }
  const { port: p2 } = await boot({ actions: { danger: true, terminal: true } });
  const r2 = await raw(p2, { method: 'POST', p: '/api/actions/run', headers: { ...J, host: `127.0.0.1:${p2}` }, body: JSON.stringify({ id: 'agentneuron.terminal', params: { command: 'node -v' } }) });
  assert.equal(r2.status, 200);
});

test('git.fetch remote cannot be an option; invalid action params are 400', async () => {
  const { port } = await boot({ actions: { exec: true } });
  for (const remote of ['--upload-pack=touch /tmp/pwn', '-v', '--all']) {
    const r = await raw(port, { method: 'POST', p: '/api/actions/preview', headers: { ...J, host: `127.0.0.1:${port}` }, body: JSON.stringify({ id: 'git.fetch', params: { remote } }) });
    assert.equal(r.status, 400, remote);
  }
});

test('job logs, results and errors are secret-masked', async () => {
  const SECRET = 'sk-ant-api03-A1b2C3d4E5f6G7h8I9j0A1b2';
  const events = [];
  const ctx = { root: os.tmpdir(), config: { actions: { exec: true } }, can: () => true, broadcast: (n, d) => events.push([n, d]), persist: { audit: { log() {} } } };
  const reg = createRegistry(ctx);
  reg.register({ id: 'x.leak', title: 'Leak', level: 'exec', run: async (_p, _c, job) => { job.log('stdout', `key ${SECRET}`); return { out: SECRET }; } });
  const job = await reg.run('x.leak', {}, { role: 'admin' });
  await job.done;
  assert.ok(!JSON.stringify(job.logBuf).includes(SECRET));
  assert.ok(!JSON.stringify(reg.summary(job)).includes(SECRET));
  assert.ok(!JSON.stringify(events).includes(SECRET));
});

test('webhook SSRF guard: private, loopback, link-local, metadata, non-http refused', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.5', '192.168.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPrivateAddress(ip), false, ip);
  for (const u of ['http://127.0.0.1:9/', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://metadata.google.internal/', 'file:///etc/passwd', 'ftp://example.com/']) {
    await assert.rejects(postWebhook(u, {}), undefined, u);
  }
  // a hostname that resolves to loopback is refused at connect time (DNS rebinding)
  await new Promise((resolve, reject) => guardedLookup(false)('localhost', { all: true }, (err) => (err ? resolve() : reject(new Error('should have been blocked')))));
});

test('webhook redirects are not followed', async () => {
  let hits = 0;
  const target = http.createServer((_q, r) => { hits++; r.end('x'); });
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  const redir = http.createServer((_q, r) => { r.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/` }); r.end(); });
  await new Promise((r) => redir.listen(0, '127.0.0.1', r));
  const res = await postWebhook(`http://127.0.0.1:${redir.address().port}/`, {}, { allowPrivate: true });
  assert.equal(res.status, 302);
  assert.equal(hits, 0);
  target.close(); redir.close();
});

test('config.json: file-enabled risky levels and malformed JSON are surfaced', async () => {
  const bad = await boot({}, (root) => { fs.mkdirSync(path.join(root, '.agentneuron')); fs.writeFileSync(path.join(root, '.agentneuron', 'config.json'), '{oops'); });
  const st = await (await fetch(`${bad.base}/api/state`)).json();
  assert.match(st.configWarning, /not valid JSON/);
  const risky = await boot({}, (root) => { fs.mkdirSync(path.join(root, '.agentneuron')); fs.writeFileSync(path.join(root, '.agentneuron', 'config.json'), '{"actions":{"edit":true,"exec":true,"terminal":true}}'); });
  const st2 = await (await fetch(`${risky.base}/api/state`)).json();
  assert.deepEqual(st2.fileEnabled, ['exec', 'terminal']);
  const cli = await boot({ actions: { exec: true } });
  assert.deepEqual((await (await fetch(`${cli.base}/api/state`)).json()).fileEnabled, []);
});

test('job command output is admin-only (HTTP and SSE)', async () => {
  const { port } = await boot({ actions: { exec: true }, adminToken: 'adm-tok-1234', token: 'view-tok-1234' });
  const A = { ...J, host: `127.0.0.1:${port}`, authorization: 'Bearer adm-tok-1234' };
  const V = { host: `127.0.0.1:${port}`, authorization: 'Bearer view-tok-1234' };
  const run = await raw(port, { method: 'POST', p: '/api/actions/run', headers: A, body: '{"id":"agentneuron.rescan"}' });
  const id = JSON.parse(run.body).id;
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(JSON.parse((await raw(port, { p: `/api/job?id=${id}`, headers: { ...A } })).body).log.length > 0);
  assert.deepEqual(JSON.parse((await raw(port, { p: `/api/job?id=${id}`, headers: V })).body).log, []);
});

test('file events show the agent prompt and session title to admins only', async () => {
  const { srv, port } = await boot({ adminToken: 'adm-tok-5678', token: 'view-tok-5678' });
  srv.store.events.push({ id: 999999, type: 'change', path: 'CLAUDE.md', ts: Date.now(), agent: { tool: 'claude', sessionId: 's1', title: 'fix billing secret', lastPrompt: 'use key sk-live-xyz', ts: 1 } });
  const get = async (tok) => JSON.parse((await raw(port, { p: '/api/events?since=999998', headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${tok}` } })).body);
  const [a] = await get('adm-tok-5678');
  const [v] = await get('view-tok-5678');
  assert.equal(a.agent.lastPrompt, 'use key sk-live-xyz');
  assert.equal(v.agent.tool, 'claude');
  assert.equal(v.agent.lastPrompt, undefined);
  assert.equal(v.agent.title, undefined);
});
