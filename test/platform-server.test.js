import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { startServer } from '../src/server/app.js';

let root, srv, base;
const ADMIN = 'adm-secret', VIEW = 'view-secret';

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-plat-'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# P\n\n- [ ] one\n');
  srv = await startServer(loadConfig(root, { port: 0, token: VIEW, adminToken: ADMIN }));
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => { await srv.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

const jpost = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function login(token) {
  const r = await jpost('/api/auth/login', { token });
  return { r, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

test('HTML loads without auth, API does not; me reports unauthenticated', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/api/state')).status, 401);
  const me = await (await fetch(base + '/api/auth/me')).json();
  assert.equal(me.role, null); assert.equal(me.tokenRequired, true);
});

test('cookie login: admin vs viewer roles, logout', async () => {
  assert.equal((await login('wrong')).r.status, 401);
  const a = await login(ADMIN);
  assert.equal(a.r.status, 200);
  const sc = a.r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /agentneuron_session=/);
  const me = await (await fetch(base + '/api/auth/me', { headers: { cookie: a.cookie } })).json();
  assert.equal(me.role, 'admin'); assert.equal(me.levels.state, true); assert.equal(me.levels.exec, false);
  assert.equal((await fetch(base + '/api/state', { headers: { cookie: a.cookie } })).status, 200);

  const v = await login(VIEW);
  const vme = await (await fetch(base + '/api/auth/me', { headers: { cookie: v.cookie } })).json();
  assert.equal(vme.role, 'viewer'); assert.equal(vme.levels.state, false);
  assert.equal((await fetch(base + '/api/audit', { headers: { cookie: v.cookie } })).status, 403);
  assert.equal((await fetch(base + '/api/audit', { headers: { cookie: a.cookie } })).status, 200);
  // bearer + query still work and map to roles
  const bm = await (await fetch(base + '/api/auth/me', { headers: { authorization: `Bearer ${VIEW}` } })).json();
  assert.equal(bm.role, 'viewer');
  assert.equal((await fetch(`${base}/api/state?token=${ADMIN}`)).status, 200);
  // cross-origin write with cookie refused
  const x = await jpost('/api/actions/run', { id: 'agentneuron.snapshot' }, { cookie: a.cookie, origin: 'http://evil.example' });
  assert.equal(x.status, 403);
  await jpost('/api/auth/logout', {}, { cookie: a.cookie });
  assert.equal((await fetch(base + '/api/state', { headers: { cookie: a.cookie } })).status, 401);
});

test('actions list, state action runs, exec/danger disabled with reason, audit written', async () => {
  const { cookie } = await login(ADMIN);
  const H = { cookie };
  const list = await (await fetch(base + '/api/actions', { headers: H })).json();
  const byId = Object.fromEntries(list.map((a) => [a.id, a]));
  assert.equal(byId['agentneuron.snapshot'].enabled, true);
  assert.equal(byId['agentneuron.history.clear'].enabled, false);
  assert.match(byId['agentneuron.history.clear'].reason, /actions\.danger/);
  assert.equal(byId['agentneuron.terminal'].enabled, false);

  const run = await jpost('/api/actions/run', { id: 'agentneuron.snapshot' }, H);
  assert.equal(run.status, 200);
  const job = await run.json();
  let j;
  for (let i = 0; i < 40; i++) {
    j = await (await fetch(`${base}/api/job?id=${job.id}`, { headers: H })).json();
    if (j.status === 'ok' || j.status === 'error') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(j.status, 'ok'); assert.ok(Array.isArray(j.log));
  assert.ok((await (await fetch(base + '/api/jobs', { headers: H })).json()).some((x) => x.id === job.id));

  const dis = await jpost('/api/actions/run', { id: 'agentneuron.terminal', params: { command: 'echo hi' } }, H);
  assert.equal(dis.status, 403);
  assert.match((await dis.json()).error, /disabled.*actions\./);
  const prev = await jpost('/api/actions/preview', { id: 'agentneuron.terminal', params: { command: 'ls "a b"' } }, H);
  assert.deepEqual((await prev.json()).command, ['ls', 'a b']);
  assert.equal((await jpost('/api/actions/run', { id: 'agentneuron.snapshot', params: { bogus: 1 } }, { cookie })).status, 200);

  const audit = await (await fetch(base + '/api/audit?limit=20', { headers: H })).json();
  assert.ok(audit.some((a) => a.action === 'agentneuron.snapshot' && a.status === 'ok'));
  assert.ok(audit.some((a) => a.action === 'agentneuron.terminal' && a.status === 403));

  const st = await (await fetch(base + '/api/settings', { headers: H })).json();
  assert.equal(st.actions.exec, false); assert.match(st.howToEnable, /--enable/);
  assert.ok(fs.existsSync(path.join(root, '.agentneuron/audit.jsonl')));
  assert.ok(fs.existsSync(path.join(root, '.agentneuron/metrics.jsonl')));
});

test('enabled terminal action executes without a shell and streams', async () => {
  const c = loadConfig(root, { port: 0, actions: { danger: true, terminal: true } });
  const s2 = await startServer(c);
  try {
    const b = `http://127.0.0.1:${s2.port}`;
    const job = await s2.ctx.actions.run('agentneuron.terminal', { command: `${process.execPath} -e "console.log(1+1); console.log(process.argv[1])" "a;b"` }, { role: 'admin' });
    await job.done;
    assert.equal(job.status, 'ok');
    assert.ok(job.logBuf.some((l) => l.stream === 'stdout' && /^2/.test(l.text)));
    assert.ok(job.logBuf.some((l) => /a;b/.test(l.text)));
    const bad = await s2.ctx.actions.run('agentneuron.terminal', { command: `${process.execPath} -e "process.exit(3)"` }, { role: 'admin' });
    await bad.done;
    assert.equal(bad.status, 'error');
    assert.equal((await fetch(b + '/api/auth/me')).status, 200);
  } finally { await s2.close(); }
});

test('restore requires edit level (alias --write / actions.edit)', async () => {
  const r = await fetch(`${base}/api/restore?token=${ADMIN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"path":"CLAUDE.md","id":"x"}' });
  assert.equal(r.status, 403);
  const s2 = await startServer(loadConfig(root, { port: 0, allowWrite: true }));
  try {
    const r2 = await fetch(`http://127.0.0.1:${s2.port}/api/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"path":"CLAUDE.md","id":"nope"}' });
    assert.equal(r2.status, 404);
  } finally { await s2.close(); }
});
