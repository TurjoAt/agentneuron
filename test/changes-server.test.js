// HTTP routes of the change review: shapes, viewer access to diff content, online gating, actions.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-chs-home-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { loadConfig } = await import('../src/core/config.js');
const { startServer } = await import('../src/server/app.js');
const { createCheckpoint } = await import('../src/changes/checkpoints.js');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
const w = (d, f, c) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); };
const ADMIN = 'adm-changes-1234', VIEWER = 'view-changes-1234';
const SECRET_LINE = 'SECRET-CHECKPOINT-CONTENT-42';

const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) { try { await f(); } catch { /* ignore */ } } fs.rmSync(home, { recursive: true, force: true }); });

function repo() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-chs-')));
  sh(d, 'init', '-q', '-b', 'main'); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t'); sh(d, 'config', 'core.autocrlf', 'false');
  w(d, 'CLAUDE.md', '# Project\n');
  w(d, 'src/auth/guard.js', 'export function guard(req) {\n  if (!req.user) throw new Error("401");\n  return true;\n}\n');
  w(d, 'package.json', JSON.stringify({ name: 'x', dependencies: { lodash: '^4.0.0', 'ghost-pkg-xyz': '^1.0.0' } }));
  sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'init');
  return d;
}
async function boot(root, overrides = {}) {
  const srv = await startServer(loadConfig(root, { port: 0, adminToken: ADMIN, token: VIEWER, ...overrides }));
  cleanups.push(async () => { await srv.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return srv.port;
}
const req = (port, p, tok, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${tok}`, ...(body ? { 'content-type': 'application/json' } : {}) }, agent: false }, (res) => {
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b, json: () => JSON.parse(b) }));
  });
  r.on('error', reject); r.end(body ? JSON.stringify(body) : undefined);
});

test('routes answer with the contract shapes; viewers get no checkpoint content', async () => {
  const d = repo();
  w(d, 'src/auth/guard.js', `export function guard(req) {\n  return true; // ${SECRET_LINE}\n}\n`);
  const cp = await createCheckpoint(d, { label: 'before' });
  w(d, 'src/auth/guard.js', 'export function guard(req) {\n  return false;\n}\n');
  const port = await boot(d);

  const rv = await req(port, '/api/changes/review', VIEWER);
  assert.equal(rv.status, 200, rv.body);
  const review = rv.json();
  for (const k of ['base', 'head', 'summary', 'groups', 'files', 'readFirst']) assert.ok(k in review, k);
  assert.equal(review.files[0].path, 'src/auth/guard.js');
  assert.equal(review.files[0].risk, 'high');
  assert.ok(!rv.body.includes(SECRET_LINE) && !rv.body.includes('return false'), 'review never carries diff lines');

  const im = (await req(port, '/api/changes/impact', VIEWER)).json();
  for (const k of ['changed', 'nodes', 'edges', 'affected']) assert.ok(Array.isArray(im[k]), k);

  const list = (await req(port, '/api/changes/checkpoints', VIEWER)).json();
  assert.equal(list.checkpoints[0].id, cp.id);
  const one = (await req(port, `/api/changes/checkpoint?id=${cp.id}`, VIEWER)).json();
  assert.equal(one.files.find((f) => f.path === 'src/auth/guard.js').status, 'changed');

  const dv = await req(port, `/api/changes/checkpoint/diff?id=${cp.id}&path=src/auth/guard.js`, VIEWER);
  assert.equal(dv.status, 403);
  assert.ok(!dv.body.includes(SECRET_LINE));
  const da = await req(port, `/api/changes/checkpoint/diff?id=${cp.id}&path=src/auth/guard.js`, ADMIN);
  assert.equal(da.status, 200);
  assert.ok(da.json().before.includes(SECRET_LINE));
  assert.equal(da.json().after, 'export function guard(req) {\n  return false;\n}\n');

  assert.equal((await req(port, '/api/changes/checkpoint?id=..%2F..%2FHEAD', ADMIN)).status, 400);
  assert.equal((await req(port, '/api/changes/checkpoint?id=missing-1', ADMIN)).status, 404);
  assert.equal((await req(port, `/api/changes/checkpoint/diff?id=${cp.id}&path=../x`, ADMIN)).status, 400);
  assert.equal((await req(port, '/api/changes/review?base=--output%3D%2Ftmp%2Fx', ADMIN)).status, 400);
  assert.equal((await req(port, '/api/changes/impact?paths=..%2Fetc', ADMIN)).status, 400);
});

test('viewer diffs allowed only with live.viewerDiffs', async () => {
  const d = repo();
  const cp = await createCheckpoint(d, {});
  const port = await boot(d, { live: { viewerDiffs: true } });
  assert.equal((await req(port, `/api/changes/checkpoint/diff?id=${cp.id}&path=CLAUDE.md`, VIEWER)).status, 200);
});

test('packages: offline by default; online only with packages.online and the admin role', async () => {
  const d = repo();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }; };
  cleanups.push(() => { globalThis.fetch = realFetch; });

  const offPort = await boot(d);
  const off = (await req(offPort, '/api/changes/packages', ADMIN)).json();
  assert.equal(off.online, false);
  assert.equal(typeof off.deps, 'number');
  assert.equal((await req(offPort, '/api/changes/package?manager=npm&name=ghost-pkg-xyz', ADMIN)).json().registry, null);
  assert.equal(calls.length, 0, 'no network without packages.online');

  const d2 = repo();
  const onPort = await boot(d2, { packages: { online: true } });
  const viewer = (await req(onPort, '/api/changes/package?manager=npm&name=ghost-pkg-xyz', VIEWER)).json();
  assert.equal(viewer.online, false);
  assert.equal(calls.length, 0, 'viewers never trigger lookups');
  const admin = (await req(onPort, '/api/changes/package?manager=npm&name=ghost-pkg-xyz', ADMIN)).json();
  assert.equal(admin.online, true);
  assert.equal(admin.verdict, 'block');
  assert.ok(calls.length > 0 && calls.every((u) => u.startsWith('https://')));
  assert.equal((await req(onPort, '/api/changes/package?manager=npm&name=..%2F..', ADMIN)).status, 400);
});

test('actions: create needs edit, restore is danger and previews per file', async () => {
  const d = repo();
  w(d, 'a.txt', 'one\n');
  const port = await boot(d, { actions: { edit: true, danger: false } });
  const list = (await req(port, '/api/actions', ADMIN)).json();
  const lv = Object.fromEntries(list.filter((a) => a.id.startsWith('changes.')).map((a) => [a.id, [a.level, a.enabled]]));
  assert.deepEqual(lv['changes.checkpoint.create'], ['edit', true]);
  assert.deepEqual(lv['changes.checkpoint.restore'], ['danger', false]);
  const run = await req(port, '/api/actions/run', ADMIN, { method: 'POST', body: { id: 'changes.checkpoint.create', params: { label: 'from api' } } });
  assert.equal(run.status, 200, run.body);
  let cps = [];
  for (let i = 0; i < 50 && !cps.length; i++) { await new Promise((r) => setTimeout(r, 50)); cps = (await req(port, '/api/changes/checkpoints', ADMIN)).json().checkpoints; }
  assert.equal(cps[0].label, 'from api');
  w(d, 'a.txt', 'two\n');
  const pv = (await req(port, '/api/actions/preview', ADMIN, { method: 'POST', body: { id: 'changes.checkpoint.restore', params: { id: cps[0].id, paths: ['a.txt'] } } })).json();
  assert.deepEqual(pv.files, [{ path: 'a.txt', action: 'overwrite' }]);
  const denied = await req(port, '/api/actions/run', ADMIN, { method: 'POST', body: { id: 'changes.checkpoint.restore', params: { id: cps[0].id, paths: ['a.txt'] } } });
  assert.equal(denied.status, 403);
  const viewerRun = await req(port, '/api/actions/run', VIEWER, { method: 'POST', body: { id: 'changes.checkpoint.create', params: {} } });
  assert.equal(viewerRun.status, 403);
  assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), 'two\n');
});
