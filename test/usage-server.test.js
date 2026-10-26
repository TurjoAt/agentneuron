// HTTP routes of the usage analytics, booted against a synthetic HOME (this file runs in its own process).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { makeHome } from './usage-fixtures.js';

const fx = makeHome();
process.env.HOME = fx.home;
process.env.USERPROFILE = fx.home;
const { loadConfig } = await import('../src/core/config.js');
const { startServer } = await import('../src/server/app.js');

const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) { try { await f(); } catch { /* ignore */ } } fs.rmSync(fx.base, { recursive: true, force: true }); });

async function boot(overrides = {}) {
  const srv = await startServer(loadConfig(fx.root, { port: 0, adminToken: 'adm-usage-1234', token: 'view-usage-1234', ...overrides }));
  cleanups.push(() => srv.close());
  return srv.port;
}
const get = (port, p, tok) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${tok}` }, agent: false }, (res) => {
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  });
  r.on('error', reject); r.end();
});
const ADMIN = 'adm-usage-1234', VIEWER = 'view-usage-1234';
const SECRET_TEXT = ['Fixture session one', 'please add the parser', 'sub task', 'USER-ANSWER-POSTGRES', 'Which database', 'parser lives', 'echo done', 'Bash(*)'];

const port = await boot();

const ROUTES = [
  '/api/usage/summary?range=30d', '/api/usage/sessions?range=30d', '/api/usage/session?id=S1', '/api/usage/tools?range=30d',
  '/api/usage/prompts?range=30d', '/api/usage/fleet?range=30d', '/api/usage/impact?range=30d', '/api/usage/activity?range=30d',
  '/api/usage/memory', '/api/usage/settings', '/api/usage/entity?kind=session&id=S1',
];

for (const route of ROUTES) {
  test(`viewer token: ${route} answers without prompt text, titles or bodies`, async () => {
    const v = await get(port, route, VIEWER);
    assert.equal(v.status, 200, v.body);
    for (const s of SECRET_TEXT) assert.ok(!v.body.includes(s), `${route} leaks "${s}"`);
    assert.ok(!v.body.includes('PASTED-SECRET-CONTENT'));
    const a = await get(port, route, ADMIN);
    assert.equal(a.status, 200, a.body);
    assert.ok(!a.body.includes('PASTED-SECRET-CONTENT'));
  });
}

test('admin sees titles and prompts on loopback; viewers get prompt rows removed', async () => {
  const a = JSON.parse((await get(port, '/api/usage/session?id=S1', ADMIN)).body);
  assert.equal(a.session.title, 'Fixture session one');
  assert.ok(a.timeline.some((r) => r.kind === 'prompt'));
  const v = JSON.parse((await get(port, '/api/usage/session?id=S1', VIEWER)).body);
  assert.equal(v.session.title, '');
  assert.ok(!v.timeline.some((r) => r.kind === 'prompt' || r.kind === 'thinking'));
  assert.ok(v.timeline.some((r) => r.kind === 'tool'), 'non-prompt rows stay');
  const p = JSON.parse((await get(port, '/api/usage/prompts?range=30d', VIEWER)).body);
  assert.deepEqual(p.prompts, []);
  assert.ok(p.stats.total > 0);
  const m = JSON.parse((await get(port, '/api/usage/memory', VIEWER)).body);
  assert.equal(m.memory[0].body, '');
});

test('file versions are admin-only', async () => {
  const q = '/api/usage/file-version?session=S1&backup=abc123@v1&path=src/a.js';
  assert.equal((await get(port, q, VIEWER)).status, 403);
  const a = await get(port, q, ADMIN);
  assert.equal(a.status, 200);
  assert.equal(JSON.parse(a.body).before, 'x\n');
  assert.equal((await get(port, '/api/usage/file-version?session=S1&backup=nope@v9&path=src/a.js', ADMIN)).status, 404);
  assert.equal((await get(port, '/api/usage/file-version?session=../x&backup=a@v1', ADMIN)).status, 400);
});

test('scope=all needs the config opt-in and the admin role', async () => {
  assert.equal((await get(port, '/api/usage/summary?scope=all', ADMIN)).status, 403);
  const p2 = await boot({ usage: { scope: 'all' } });
  assert.equal((await get(p2, '/api/usage/summary?scope=all', VIEWER)).status, 403);
  const a = await get(p2, '/api/usage/sessions?range=30d&scope=all', ADMIN);
  assert.equal(a.status, 200);
  assert.ok(JSON.parse(a.body).sessions.some((s) => s.sessionId === 'S9'));
  assert.equal(JSON.parse((await get(p2, '/api/usage/session?id=S9', ADMIN)).body).session.sessionId, 'S9');
  assert.equal(JSON.parse((await get(p2, '/api/usage/session?id=S9', VIEWER)).body).session, null, 'viewers stay in the project');
  assert.equal(JSON.parse((await get(port, '/api/usage/session?id=S9', ADMIN)).body).session, null);
});

test('bad parameters are rejected', async () => {
  assert.equal((await get(port, '/api/usage/summary?range=5y', ADMIN)).status, 400);
  assert.equal((await get(port, '/api/usage/entity?kind=nope&id=x', ADMIN)).status, 400);
  assert.equal((await get(port, '/api/usage/session?id=a/b', ADMIN)).status, 400);
});
