import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadConfig } from '../src/core/config.js';
import { startServer } from '../src/server/app.js';

const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) { try { await f(); } catch { /* ignore */ } } });

async function boot(overrides, setup) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-secf-'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# P\n\nhello\n');
  if (setup) setup(root);
  const srv = await startServer(loadConfig(root, { port: 0, ...overrides }));
  cleanups.push(async () => { await srv.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const port = srv.port;
  const api = async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let b = null; try { b = await r.json(); } catch { /* none */ }
    return { status: r.status, body: b };
  };
  return { root, srv, port, api };
}

test('symlinked files and directories cannot be read or written through the file API', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-secout-'));
  cleanups.push(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'TOP SECRET');
  const { api } = await boot({ actions: { edit: true } }, (root) => {
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'link.md'));
    fs.symlinkSync(outside, path.join(root, 'linkdir'));
  });
  assert.equal((await api('GET', '/api/file/raw?path=link.md')).status, 403);
  assert.equal((await api('GET', '/api/file/raw?path=linkdir/secret.md')).status, 403);
  assert.equal((await api('POST', '/api/file/save', { path: 'linkdir/new.md', content: 'x' })).status, 403);
  assert.equal((await api('POST', '/api/file/create', { path: 'linkdir/new.md', content: 'x' })).status, 403);
  assert.equal((await api('POST', '/api/file/rename', { from: 'CLAUDE.md', to: 'linkdir/moved.md' })).status, 403);
  assert.deepEqual(fs.readdirSync(outside), ['secret.md']);
  for (const bad of ['/etc/passwd', '../x.md', 'a/../../x.md', 'a\\b.md', 'C:/x.md', '.git/config', 'a\0b.md']) {
    const r = await api('GET', `/api/file/raw?path=${encodeURIComponent(bad)}`);
    assert.ok(r.status >= 400 && r.status < 500, bad);
  }
});

test('rename cannot create files of a non-tracked type (e.g. CI workflows)', async () => {
  const { api, root } = await boot({ actions: { edit: true } });
  const r = await api('POST', '/api/file/rename', { from: 'CLAUDE.md', to: '.github/workflows/pwn.yml' });
  assert.equal(r.status, 403);
  assert.ok(fs.existsSync(path.join(root, 'CLAUDE.md')));
});

test('files that make agent tools run commands need actions.exec', async () => {
  const edit = await boot({ actions: { edit: true } });
  assert.equal((await edit.api('POST', '/api/file/create', { path: '.claude/settings.json', content: '{"hooks":{}}' })).status, 403);
  assert.equal((await edit.api('POST', '/api/file/create', { path: '.mcp.json', content: '{}' })).status, 403);
  const both = await boot({ actions: { edit: true, exec: true } });
  assert.equal((await both.api('POST', '/api/file/create', { path: '.mcp.json', content: '{}' })).status, 200);
});

test('agent sync cannot read or write outside tracked, non-symlinked files', async () => {
  const { api, root } = await boot({ actions: { edit: true } }, (r) => {
    fs.writeFileSync(path.join(r, '.env'), 'API_KEY=hunter2hunter2');
    fs.symlinkSync('/etc/hostname', path.join(r, 'AGENTS.md'));
  });
  for (const source of ['.env', 'AGENTS.md', '../x', '/etc/passwd']) {
    const r = await api('POST', '/api/agents/sync/plan', { source, targets: ['claude'] });
    assert.ok(r.status >= 400 && r.status < 500, source);
    assert.ok(!JSON.stringify(r.body).includes('hunter2'));
  }
  const ok = await api('POST', '/api/agents/sync/plan', { source: 'CLAUDE.md', targets: ['GEMINI.md'] });
  assert.equal(ok.status, 200);
  const evil = await api('POST', '/api/agents/sync/plan', { source: 'CLAUDE.md', targets: ['.github/workflows/x.yml'] });
  assert.ok(evil.status >= 400);
  assert.ok(!fs.existsSync(path.join(root, '.github')));
});

test('regex replace: catastrophic backtracking is interrupted (400) instead of hanging', async () => {
  const { api } = await boot({ actions: { edit: true } }, (root) => fs.writeFileSync(path.join(root, 'evil.md'), `${'a'.repeat(45)}!\n`));
  const t0 = Date.now();
  const r = await api('GET', `/api/replace/preview?q=${encodeURIComponent('(a+)+$')}&regex=1`);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /too slow/);
  assert.ok(Date.now() - t0 < 8000);
  const ok = await api('GET', '/api/replace/preview?q=hello&regex=1');
  assert.equal(ok.status, 200);
});

test('SSE connections are capped', async () => {
  const { port } = await boot({});
  const open = [];
  const agent = new http.Agent({ keepAlive: false, maxSockets: 500 });
  const connect = () => new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/stream', agent }, (res) => { open.push(res); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    open.push(req);
  });
  let last = 200;
  for (let i = 0; i < 101 && last === 200; i++) last = await connect();
  assert.equal(last, 503);
  for (const o of open) { try { o.destroy(); } catch { /* ignore */ } }
});
