// Ship check HTTP routes and actions, booted against a temp repo and a synthetic HOME (own process).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-shipsrv-')));
const home = path.join(base, 'home');
const root = path.join(base, 'proj');
fs.mkdirSync(home, { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
const put = (rel, c) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), c); };
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe', env: GIT_ENV }).toString();
const FAKE_GH = 'ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF3hJ5';

fs.mkdirSync(root, { recursive: true });
sh('init', '-q', '-b', 'main'); sh('config', 'user.name', 't'); sh('config', 'user.email', 't@t'); sh('config', 'commit.gpgsign', 'false');
put('package.json', JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }));
put('TASKS.md', '# Tasks\n\n- [/] Checkout flow\n  - [x] Totals include tax\n  - [ ] Coupon codes apply\n');
put('src/pay.js', `export const pay = () => fetch('https://api.example.com/pay');\nconst gh = '${FAKE_GH}';\n`);
put('test/agentcenter-keys.test.js', `const a = '${FAKE_GH}';\nconst b = '${FAKE_GH}';\n`);
sh('add', '-A'); sh('commit', '-q', '-m', 'init');

const { loadConfig } = await import('../src/core/config.js');
const { startServer } = await import('../src/server/app.js');
const { saveRun, listRuns } = await import('../src/ship/runs.js');

const ADMIN = 'adm-ship-1234', VIEWER = 'view-ship-1234';
const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) { try { await f(); } catch { /* ignore */ } } fs.rmSync(base, { recursive: true, force: true }); });
async function boot(actions = {}) {
  const srv = await startServer(loadConfig(root, { port: 0, adminToken: ADMIN, token: VIEWER, actions }));
  cleanups.push(() => srv.close());
  return `http://127.0.0.1:${srv.port}`;
}
const get = async (url, p, tok) => { const r = await fetch(url + p, { headers: { authorization: `Bearer ${tok}` } }); return { status: r.status, body: await r.json() }; };
const post = async (url, p, body, tok) => { const r = await fetch(url + p, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

const oldFail = await saveRun(root, { check: 'npm:test', kind: 'test', command: 'npm run test', startedAt: Date.now() - 100000, endedAt: Date.now() - 99000, exitCode: 1, failed: 1, failures: [{ name: 'checkout total', file: 'test/a.test.js', message: 'expected row CUSTOMER-ROW-77 to equal' }] }, 'fail\n');
const stored = await saveRun(root, { check: 'npm:test', kind: 'test', command: 'npm run test', startedAt: Date.now() + 5000, endedAt: Date.now() + 6000, exitCode: 0, passed: 2, tests: [{ name: 'totals include the tax', status: 'passed' }] }, `ok\nTOKEN=${FAKE_GH}\n`);
const url = await boot({ exec: false });

const ROUTES = ['/api/ship/summary', '/api/ship/checks', '/api/ship/runs', `/api/ship/run?id=${stored.id}`, '/api/ship/report', '/api/ship/report?base=HEAD', '/api/ship/scope', '/api/ship/readiness', '/api/ship/placeholders'];

for (const route of ROUTES) {
  test(`GET ${route}: 200 for admin and viewer, no secret values, no runs started`, async () => {
    const before = (await listRuns(root)).length;
    for (const tok of [ADMIN, VIEWER]) {
      const r = await get(url, route, tok);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.ok(!JSON.stringify(r.body).includes(FAKE_GH), `${route} echoes a secret`);
    }
    assert.equal((await listRuns(root)).length, before);
  });
}

test('shapes: summary, checks gate, report, scope, readiness, placeholders', async () => {
  const s = (await get(url, '/api/ship/summary', ADMIN)).body;
  for (const k of ['generatedAt', 'verdict', 'readiness', 'placeholders', 'lastRuns', 'scope']) assert.ok(k in s, k);
  assert.equal(s.scope.criteria, 2);
  const c = (await get(url, '/api/ship/checks', ADMIN)).body;
  assert.deepEqual(c.checks.map((x) => x.id), ['npm:test']);
  assert.equal(c.checks[0].status, 'passed');
  assert.equal(c.run.enabled, false);
  assert.match(c.run.reason, /actions\.exec/);
  const cv = (await get(url, '/api/ship/checks', VIEWER)).body;
  assert.match(cv.run.reason, /admin role/);
  const rep = (await get(url, '/api/ship/report', ADMIN)).body;
  for (const k of ['base', 'head', 'changedFiles', 'verdict', 'checks', 'criteria', 'failures', 'evidence']) assert.ok(k in rep, k);
  assert.equal(rep.override.enabled, true);
  assert.equal((await get(url, '/api/ship/report', VIEWER)).body.override.enabled, false);
  const scope = (await get(url, '/api/ship/scope', ADMIN)).body;
  const crit = scope.tasks[0].criteria;
  assert.equal(crit.find((x) => x.text === 'Totals include tax').status, 'verified');
  assert.equal(crit.find((x) => x.text === 'Coupon codes apply').status, 'incomplete');
  const one = await get(url, `/api/ship/scope?task=${scope.tasks[0].id}`, ADMIN);
  assert.equal(one.body.tasks.length, 1);
  assert.equal((await get(url, '/api/ship/scope?task=zzz', ADMIN)).status, 404);
  const ready = (await get(url, '/api/ship/readiness', ADMIN)).body;
  assert.equal(ready.ready, false);
  assert.ok(ready.findings.some((f) => f.rule === 'secret' && f.location.path === 'src/pay.js' && f.location.line === 2));
  assert.equal(new Set(ready.findings.map((f) => f.id)).size, ready.findings.length, 'finding ids stay unique after masking');
  const ph = (await get(url, '/api/ship/placeholders', ADMIN)).body;
  assert.ok(ph.findings.some((f) => f.rule === 'fake-api'));
});

test('test-failure excerpts are admin-only', async () => {
  const pick = (b) => b.runs.find((r) => r.id === oldFail.id);
  const admin = pick((await get(url, '/api/ship/runs', ADMIN)).body);
  assert.match(admin.failures[0].message, /CUSTOMER-ROW-77/);
  const viewer = (await get(url, '/api/ship/runs', VIEWER)).body;
  assert.ok(!JSON.stringify(viewer).includes('CUSTOMER-ROW-77'));
  assert.equal(pick(viewer).failures[0].messageHidden, true);
  assert.ok(!JSON.stringify((await get(url, `/api/ship/run?id=${oldFail.id}`, VIEWER)).body).includes('CUSTOMER-ROW-77'));
});

test('run log is admin-only; bad ids and refs are 400', async () => {
  const a = (await get(url, `/api/ship/run?id=${stored.id}`, ADMIN)).body;
  assert.ok(a.log.includes('TOKEN='));
  assert.equal(a.logHidden, false);
  const v = (await get(url, `/api/ship/run?id=${stored.id}`, VIEWER)).body;
  assert.equal(v.log, '');
  assert.equal(v.logHidden, true);
  assert.equal((await get(url, '/api/ship/run?id=../../x', ADMIN)).status, 400);
  assert.equal((await get(url, '/api/ship/run?id=rzzzzzzzzzzz', ADMIN)).status, 404);
  assert.equal((await get(url, '/api/ship/report?base=--output%3D%2Ftmp%2Fx', ADMIN)).status, 400);
  assert.equal((await get(url, '/api/ship/report?base=a..b', ADMIN)).status, 400);
});

test('ship.verify.run: off by default (403 with how to enable), viewers never', async () => {
  const off = await post(url, '/api/actions/run', { id: 'ship.verify.run', params: {} }, ADMIN);
  assert.equal(off.status, 403);
  assert.match(off.body.error, /actions\.exec/);
  const urlOn = await boot({ exec: true });
  const v = await post(urlOn, '/api/actions/run', { id: 'ship.verify.run', params: {} }, VIEWER);
  assert.equal(v.status, 403);
  const c = (await get(urlOn, '/api/ship/checks', ADMIN)).body;
  assert.equal(c.run.enabled, true);
  const bad = await post(urlOn, '/api/actions/preview', { id: 'ship.verify.run', params: { checks: ['npm:nope'] } }, ADMIN);
  assert.equal(bad.status, 400);
  const pv = await post(urlOn, '/api/actions/preview', { id: 'ship.verify.run', params: { checks: ['npm:test'] } }, ADMIN);
  assert.deepEqual(pv.body.commands, [['npm', 'run', 'test']]);
});

test('ship.criterion.set: state level, admin only, validates ids, changes the status', async () => {
  const scope = (await get(url, '/api/ship/scope', ADMIN)).body;
  const task = scope.tasks[0].id;
  const crit = scope.tasks[0].criteria.find((x) => x.text === 'Coupon codes apply').id;
  const v = await post(url, '/api/actions/run', { id: 'ship.criterion.set', params: { task, criterion: crit, status: 'verified' } }, VIEWER);
  assert.equal(v.status, 403);
  const badParam = await post(url, '/api/actions/run', { id: 'ship.criterion.set', params: { task, criterion: 'x', status: 'verified' } }, ADMIN);
  assert.equal(badParam.status, 400);
  const job = await post(url, '/api/actions/run', { id: 'ship.criterion.set', params: { task, criterion: crit, status: 'verified', note: 'manual QA' } }, ADMIN);
  assert.equal(job.status, 200, JSON.stringify(job.body));
  let s;
  for (let i = 0; i < 50; i++) {
    s = (await get(url, '/api/ship/scope', ADMIN)).body.tasks[0].criteria.find((x) => x.id === crit);
    if (s.status === 'verified') break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(s.status, 'verified');
  assert.equal(s.evidence[0].kind, 'manual');
  assert.ok(fs.existsSync(path.join(root, '.agentneuron/ship/criteria.json')));
});
