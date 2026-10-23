import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../src/analysis/git.js';

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mdctl-git-')));

test('not a repo: never throws', async () => {
  const d = tmp();
  const g = createGit(d);
  assert.equal(await g.available(), false);
  assert.equal((await g.status()).size, 0);
  assert.deepEqual(await g.fileLog('a.md'), []);
  assert.equal(await g.show('a.md'), null);
  assert.equal(await g.diff('a.md'), '');
  const info = await g.repoInfo();
  assert.equal(info.dirty, 0);
  assert.deepEqual(info.recent, []);
});

test('nonexistent cwd: never throws', async () => {
  const g = createGit('/nonexistent/zzz');
  assert.equal(await g.available(), false);
  assert.equal((await g.status()).size, 0);
});

test('repo with project in subdir', async () => {
  const top = tmp();
  sh(top, 'init', '-q');
  sh(top, 'config', 'user.email', 't@t.t');
  sh(top, 'config', 'user.name', 'Tester');
  sh(top, 'config', 'commit.gpgsign', 'false');
  const root = path.join(top, 'proj');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(top, 'outside.md'), 'o');
  fs.writeFileSync(path.join(root, 'a.md'), 'one\n');
  fs.writeFileSync(path.join(root, 'b.md'), 'bee\nbee\nbee\n');
  fs.writeFileSync(path.join(root, 'c.md'), 'c\n');
  sh(top, 'add', '-A');
  sh(top, 'commit', '-qm', 'first');
  const g = createGit(root);
  assert.equal(await g.available(), true);
  assert.equal((await g.status()).size, 0);

  fs.writeFileSync(path.join(root, 'a.md'), 'two\n');
  sh(top, 'mv', 'proj/b.md', 'proj/d.md');
  fs.rmSync(path.join(root, 'c.md'));
  fs.writeFileSync(path.join(root, 'new.md'), 'n');
  fs.writeFileSync(path.join(top, 'outside.md'), 'changed');
  fs.writeFileSync(path.join(root, 'staged.md'), 's');
  sh(top, 'add', 'proj/staged.md');

  const st = await g.status();
  assert.equal(st.get('a.md'), 'M');
  assert.equal(st.get('d.md'), 'R');
  assert.equal(st.get('c.md'), 'D');
  assert.equal(st.get('new.md'), '?');
  assert.equal(st.get('staged.md'), 'A');
  assert.ok(![...st.keys()].some((k) => k.includes('outside')));

  assert.equal(await g.show('a.md'), 'one\n');
  assert.equal(await g.show('nope.md'), null);
  assert.match(await g.diff('a.md'), /-one\n\+two/);

  const log = await g.fileLog('a.md');
  assert.equal(log.length, 1);
  assert.equal(log[0].subject, 'first');
  assert.equal(log[0].author, 'Tester');

  const info = await g.repoInfo();
  assert.equal(info.dirty, st.size);
  assert.ok(info.branch);
  assert.ok(info.head);
  assert.equal(info.remote, null);
  assert.equal(info.recent.length, 1);
  assert.deepEqual(info.recent[0].files.sort(), ['a.md', 'b.md', 'c.md']);
});

test('fresh repo without commits', async () => {
  const d = tmp();
  sh(d, 'init', '-q');
  fs.writeFileSync(path.join(d, 'x.md'), 'x');
  const g = createGit(d);
  assert.equal((await g.status()).get('x.md'), '?');
  const info = await g.repoInfo();
  assert.equal(info.recent.length, 0);
  assert.equal(await g.show('x.md'), null);
});
