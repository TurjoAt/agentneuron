import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findProjects, scanWorkspace, workspace, workspaceRoot, resolveProjectDir, clearCache, instances } from '../src/workspace/index.js';
import registerRoutes from '../src/server/routes/workspace.js';
import registerGit from '../src/actions/git.js';
import { createRouter } from '../src/server/router.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-ws-')));
const w = (d, f, c = '') => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); };

function mkWs() {
  const r = tmp();
  w(r, 'proj-a/package.json', '{}'); w(r, 'proj-a/CLAUDE.md', '# a'); w(r, 'proj-a/docs/x.md', 'x'); w(r, 'proj-a/node_modules/dep/package.json', '{}');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: path.join(r, 'proj-a') });
  w(r, 'proj-b/composer.json', '{}'); w(r, 'proj-b/artisan', ''); w(r, 'proj-b/AGENTS.md', '#'); w(r, 'proj-b/.agentneuron/config.json', '{}');
  w(r, 'group/nested/go.mod', 'module x'); w(r, 'group/nested/.cursor/rules/a.mdc', 'r');
  w(r, 'plain/readme.txt', 'nothing'); w(r, 'group/deep/er/est/package.json', '{}');
  return r;
}

test('findProjects: depth <= 2, skips ignores and non-projects', () => {
  const r = mkWs();
  const names = findProjects(r).map((p) => path.relative(r, p)).sort();
  assert.deepEqual(names, ['group/nested', 'proj-a', 'proj-b']);
});

test('scan: stacks, ai tools, md count, git, agentneuron', async () => {
  const r = mkWs();
  clearCache();
  const list = await scanWorkspace(r, { force: true });
  const a = list.find((p) => p.name === 'proj-a');
  assert.deepEqual(a.stacks, ['node']);
  assert.deepEqual(a.aiTools, ['claude']);
  assert.equal(a.mdFiles, 2);
  assert.equal(a.git.branch, 'main'); assert.equal(typeof a.git.dirty, 'number');
  assert.equal(a.hasAgentneuron, false);
  const b = list.find((p) => p.name === 'proj-b');
  assert.deepEqual(b.stacks.sort(), ['laravel', 'php']);
  assert.equal(b.hasAgentneuron, true);
  assert.equal(b.git.branch, null);
  const n = list.find((p) => p.name === 'nested');
  assert.deepEqual(n.aiTools, ['cursor']); assert.equal(n.mdFiles, 1);
  // cache
  w(r, 'proj-c/package.json', '{}');
  assert.equal((await scanWorkspace(r)).length, 3);
  assert.equal((await scanWorkspace(r, { force: true })).length, 4);
});

test('workspaceRoot / current / route', async () => {
  const r = mkWs();
  clearCache();
  const ctx = { root: path.join(r, 'proj-a'), config: {} };
  assert.equal(workspaceRoot(ctx), r);
  const router = createRouter();
  await registerRoutes(router, ctx);
  assert.equal(typeof ctx.workspace.cleanup, 'function');
  const out = await router.match('GET', '/api/workspace').fn({ q: new URLSearchParams('refresh=1') });
  assert.equal(out.root, r); assert.equal(out.current, ctx.root);
  assert.equal(out.projects.length, 3);
  assert.deepEqual(await router.match('GET', '/api/workspace/instances').fn({}), []);
  ctx.config.workspaceRoot = path.join(r, 'group');
  assert.equal((await workspace(ctx, { force: true })).projects.length, 1);
});

test('resolveProjectDir confines to workspace root', () => {
  const r = mkWs();
  const ctx = { root: path.join(r, 'proj-a'), config: {} };
  assert.equal(resolveProjectDir(ctx, 'proj-b'), path.join(r, 'proj-b'));
  assert.equal(resolveProjectDir(ctx, path.join(r, 'proj-b')), path.join(r, 'proj-b'));
  assert.equal(resolveProjectDir(ctx, '../'), null);
  assert.equal(resolveProjectDir(ctx, '/etc'), null);
  assert.equal(resolveProjectDir(ctx, 'nope'), null);
  assert.equal(resolveProjectDir(ctx, ''), null);
  assert.equal(resolveProjectDir(ctx, '.'), null);
});

test('workspace.open spawns an instance, reuses it and kills on cleanup', async () => {
  const r = tmp();
  w(r, 'cur/README.md', '# cur');
  w(r, 'sib/CLAUDE.md', '# sib');
  const defs = new Map();
  const ctx = { root: path.join(r, 'cur'), config: { host: '127.0.0.1' }, invalidate() {}, git2: { available: async () => false } };
  registerGit({ register: (x) => defs.set(x.id, x) }, ctx);
  const def = defs.get('workspace.open');
  await assert.rejects(def.run({ path: '../..' }, ctx, { log() {} }), /inside the workspace/);
  const res = await def.run({ path: 'sib' }, ctx, { log() {} });
  try {
    assert.match(res.url, /^http:\/\/127\.0\.0\.1:\d+/);
    assert.equal(instances.list().length, 1);
    const again = await def.run({ path: 'sib' }, ctx, { log() {} });
    assert.equal(again.url, res.url);
    const probe = await fetch(res.url + 'api/state');
    assert.equal(probe.status, 200);
    const pid = instances.list()[0].pid;
    instances.killAll();
    assert.equal(instances.list().length, 0);
    await new Promise((s) => setTimeout(s, 500));
    assert.throws(() => process.kill(pid, 0));
  } finally { instances.killAll(); }
});
