import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import registerGit from '../src/actions/git.js';
import { createGit2 } from '../src/git2/index.js';

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-ga-')));
const w = (d, f, c) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); };

function setup() {
  const d = tmp();
  sh(d, 'init', '-q', '-b', 'main'); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t');
  w(d, 'a.md', 'a\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'init');
  const defs = new Map();
  const registry = { register: (x) => defs.set(x.id, x) };
  const ctx = { root: d, config: {}, invalidate() {} };
  registerGit(registry, ctx);
  const job = {
    log() {},
    exec: (cmd, args) => new Promise((res) => execFile(cmd, args, { cwd: d }, (e, stdout, stderr) => res({ code: e ? (e.code || 1) : 0, stdout, stderr }))),
  };
  const run = (id, p) => defs.get(id).run(p, ctx, job);
  return { d, defs, run, g: createGit2(d), ctx };
}

test('registers all contract actions with right levels', () => {
  const { defs } = setup();
  const lv = (id) => defs.get(id).level;
  for (const id of ['git.stage', 'git.unstage', 'git.commit', 'git.branch.create', 'git.branch.switch', 'git.stash.push', 'git.stash.pop', 'git.tag.create', 'git.changelog.write']) assert.equal(lv(id), 'edit', id);
  for (const id of ['git.fetch', 'git.pull', 'git.push', 'workspace.open']) assert.equal(lv(id), 'exec', id);
  for (const id of ['git.discard', 'git.branch.delete', 'git.stash.drop']) assert.equal(lv(id), 'danger', id);
});

test('stage, unstage, commit, amend', async () => {
  const { d, run, g } = setup();
  w(d, 'b.md', 'b\n'); w(d, 'c.md', 'c\n');
  await run('git.stage', { paths: ['b.md'] });
  assert.equal((await g.changes()).staged.length, 1);
  await run('git.unstage', { paths: ['b.md'] });
  assert.equal((await g.changes()).staged.length, 0);
  await run('git.stage', { paths: ['b.md', 'c.md'] });
  await assert.rejects(run('git.commit', { message: '  ' }));
  await run('git.commit', { message: 'feat: add b and c' });
  assert.equal((await g.log({}))[0].subject, 'feat: add b and c');
  await run('git.commit', { amend: true, message: 'feat: amended' });
  const l = await g.log({});
  assert.equal(l.length, 2); assert.equal(l[0].subject, 'feat: amended');
});

test('rejects bad paths and ref names', async () => {
  const { run, defs } = setup();
  await assert.rejects(run('git.stage', { paths: ['../x'] }), /invalid path/);
  await assert.rejects(run('git.stage', { paths: ['/etc/passwd'] }), /invalid path/);
  await assert.rejects(run('git.stage', { paths: [] }), /paths required/);
  await assert.rejects(run('git.branch.create', { name: '--orphan' }), /invalid name/);
  await assert.rejects(run('git.branch.create', { name: 'a b' }), /invalid name/);
  await assert.rejects(run('git.branch.switch', { name: 'x..y' }), /invalid/);
  await assert.rejects(run('git.tag.create', { name: '-d' }), /invalid tag/);
  await assert.rejects(run('git.fetch', { remote: '--upload-pack=x' }), /invalid remote/);
  await assert.rejects(run('git.stash.pop', { index: '1;rm' }), /invalid stash index/);
  assert.deepEqual(defs.get('git.stage').preview({ paths: ['a.md'] }).command, ['git', 'add', '--', 'a.md']);
});

test('branch create/switch/delete, tag, stash push/pop/drop', async () => {
  const { d, run, g } = setup();
  await run('git.branch.create', { name: 'feat/x' });
  assert.equal((await g.branches()).current, 'feat/x');
  await run('git.branch.switch', { name: 'main' });
  assert.equal((await g.branches()).current, 'main');
  await assert.rejects(run('git.branch.delete', { name: 'main' })); // current branch
  await run('git.branch.delete', { name: 'feat/x' });
  assert.ok(!(await g.branches()).local.find((b) => b.name === 'feat/x'));
  await run('git.tag.create', { name: 'v9', message: 'rel' });
  assert.equal((await g.tags())[0].annotated, true);
  w(d, 'a.md', 'changed\n');
  await run('git.stash.push', { message: 'wip' });
  assert.equal((await g.stash()).length, 1);
  await run('git.stash.pop', {});
  assert.equal((await g.stash()).length, 0);
  assert.equal(fs.readFileSync(path.join(d, 'a.md'), 'utf8'), 'changed\n');
  await run('git.stash.push', {});
  await run('git.stash.drop', { index: 0 });
  assert.equal((await g.stash()).length, 0);
});

test('discard restores tracked and cleans untracked', async () => {
  const { d, run, g } = setup();
  w(d, 'a.md', 'dirty\n'); w(d, 'new.md', 'n\n'); w(d, 'dir/x.md', 'x\n');
  await run('git.discard', { paths: ['a.md', 'new.md', 'dir'] });
  assert.equal(fs.readFileSync(path.join(d, 'a.md'), 'utf8'), 'a\n');
  assert.ok(!fs.existsSync(path.join(d, 'new.md')));
  assert.ok(!fs.existsSync(path.join(d, 'dir')));
  const ch = await g.changes();
  assert.equal(ch.untracked.length + ch.unstaged.length, 0);
});

test('changelog.write prepends CHANGELOG.md', async () => {
  const { d, run } = setup();
  w(d, 'a.md', '2\n'); sh(d, 'commit', '-qam', 'feat: second');
  const r = await run('git.changelog.write', {});
  assert.equal(r.commits, 2);
  let t = fs.readFileSync(path.join(d, 'CHANGELOG.md'), 'utf8');
  assert.match(t, /^# Changelog\n\n## Unreleased/);
  await run('git.changelog.write', {});
  t = fs.readFileSync(path.join(d, 'CHANGELOG.md'), 'utf8');
  assert.equal(t.match(/## Unreleased/g).length, 2);
});

test('unavailable outside repo', async () => {
  const defs = new Map();
  registerGit({ register: (x) => defs.set(x.id, x) }, { root: tmp(), config: {} });
  assert.equal(await defs.get('git.stage').available(), false);
});
