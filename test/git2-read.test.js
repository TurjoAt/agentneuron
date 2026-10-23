import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit2, parseHunks, parseTrack } from '../src/git2/index.js';
import { groupCommits, parseConventional, buildChangelog, prependChangelog } from '../src/git2/changelog.js';

export const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-g2-')));
const w = (d, f, c) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); };

function mkRepo() {
  const d = tmp();
  sh(d, 'init', '-q', '-b', 'main');
  sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t');
  return d;
}
const commit = (d, msg) => { sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', msg); };

test('not a repo / missing dir: available false, never throws', async () => {
  const g = createGit2(tmp());
  const b = await g.branches();
  assert.equal(b.available, false);
  assert.ok(b.reason);
  assert.equal((await g.changes()).available, false);
  assert.equal((await createGit2('/nonexistent/zzz').log()).available, false);
});

test('branches with ahead/behind against bare remote', async () => {
  const bare = tmp(); sh(bare, 'init', '-q', '--bare', '-b', 'main');
  const d = mkRepo();
  w(d, 'a.md', 'a\n'); commit(d, 'feat: a');
  sh(d, 'remote', 'add', 'origin', bare);
  sh(d, 'push', '-q', '-u', 'origin', 'main');
  w(d, 'b.md', 'b\n'); commit(d, 'fix: b');
  const other = tmp(); fs.rmSync(other, { recursive: true });
  sh(path.dirname(other), 'clone', '-q', bare, other);
  sh(other, 'config', 'user.name', 't'); sh(other, 'config', 'user.email', 't@t');
  w(other, 'c.md', 'c\n'); commit(other, 'docs: c'); sh(other, 'push', '-q');
  sh(d, 'fetch', '-q');
  sh(d, 'branch', 'feature');
  const g = createGit2(d);
  const b = await g.branches();
  assert.equal(b.current, 'main');
  const main = b.local.find((x) => x.name === 'main');
  assert.equal(main.upstream, 'origin/main');
  assert.equal(main.ahead, 1); assert.equal(main.behind, 1);
  assert.equal(main.last.subject, 'fix: b');
  assert.ok(b.local.find((x) => x.name === 'feature'));
  assert.ok(b.remote.find((x) => x.name === 'origin/main'));
  assert.ok(!b.remote.find((x) => x.name.endsWith('/HEAD')));
  const rem = await g.remotes();
  assert.equal(rem[0].name, 'origin');
  assert.deepEqual(parseTrack('[ahead 2, behind 3]'), { ahead: 2, behind: 3, gone: false });
});

test('log has parents and refs; merge commit has 2 parents; filters', async () => {
  const d = mkRepo();
  w(d, 'a.md', '1\n'); commit(d, 'feat: one');
  sh(d, 'tag', 'v1');
  sh(d, 'switch', '-q', '-c', 'side');
  w(d, 'side.md', 's\n'); commit(d, 'fix: side');
  sh(d, 'switch', '-q', 'main');
  w(d, 'a.md', '1\n2\n'); commit(d, 'docs: main');
  sh(d, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
  const g = createGit2(d);
  const l = await g.log({});
  assert.equal(l.length, 4);
  assert.equal(l[0].subject, 'Merge side');
  assert.equal(l[0].parents.length, 2);
  assert.ok(l[0].refs.some((r) => r.includes('main')));
  const first = l[l.length - 1];
  assert.deepEqual(first.parents, []);
  assert.ok(first.refs.includes('tag: v1'));
  assert.equal(l[0].email, 't@t');
  assert.equal((await g.log({ limit: 2 })).length, 2);
  assert.equal((await g.log({ skip: 3 })).length, 1);
  assert.equal((await g.log({ path: 'side.md' })).length, 1);
  assert.equal((await g.log({ author: 'nobody' })).length, 0);
  assert.equal((await g.log({ branch: 'side' })).length, 2);
  assert.equal((await g.log({ branch: 'all' })).length, 4);
  assert.equal((await g.log({ branch: '--evil' })).error, 'bad branch');
  assert.equal((await g.log({ path: '../x' })).error, 'bad path');
  const t = await g.tags();
  assert.equal(t[0].name, 'v1');
});

test('commit detail with numstat, rename and patch', async () => {
  const d = mkRepo();
  w(d, 'old.md', 'x\ny\nz\n'); commit(d, 'init');
  sh(d, 'mv', 'old.md', 'new.md');
  w(d, 'new.md', 'x\ny\nz\nw\n');
  w(d, 'other.md', 'o\n');
  commit(d, 'feat: rename\n\nbody text here');
  const g = createGit2(d);
  const [c] = await g.log({ limit: 1 });
  const det = await g.commit(c.hash);
  assert.equal(det.body, 'body text here');
  const rn = det.files.find((f) => f.path === 'new.md');
  assert.equal(rn.status, 'R'); assert.equal(rn.from, 'old.md'); assert.equal(rn.added, 1);
  assert.equal(det.files.find((f) => f.path === 'other.md').status, 'A');
  assert.match(det.patch, /^diff --git/m);
  assert.equal((await g.commit('nonexistent1')).error, 'not found');
  assert.equal((await g.commit('--output=x')).error, 'bad hash');
});

test('changes: staged/unstaged/untracked/conflicted/rename', async () => {
  const d = mkRepo();
  w(d, 'a.md', 'a\n'); w(d, 'r.md', 'r1\nr2\nr3\n'); w(d, 'c.md', 'base\n'); commit(d, 'init');
  sh(d, 'switch', '-q', '-c', 'x'); w(d, 'c.md', 'x\n'); commit(d, 'x');
  sh(d, 'switch', '-q', 'main'); w(d, 'c.md', 'main\n'); commit(d, 'm');
  try { sh(d, 'merge', 'x'); } catch { /* conflict expected */ }
  sh(d, 'mv', 'r.md', 'r2.md');
  w(d, 'a.md', 'a\nmore\n');
  w(d, 'u.md', 'untracked\n');
  w(d, 'staged.md', 's\n'); sh(d, 'add', 'staged.md');
  const g = createGit2(d);
  const ch = await g.changes();
  assert.deepEqual(ch.conflicted, ['c.md']);
  assert.deepEqual(ch.untracked, ['u.md']);
  const rn = ch.staged.find((f) => f.path === 'r2.md');
  assert.equal(rn.status, 'R'); assert.equal(rn.from, 'r.md');
  assert.ok(ch.staged.find((f) => f.path === 'staged.md' && f.status === 'A' && f.added === 1));
  const ua = ch.unstaged.find((f) => f.path === 'a.md');
  assert.equal(ua.added, 1); assert.equal(ua.status, 'M');
  const df = await g.diff({ path: 'a.md' });
  assert.equal(df.hunks.length, 1);
  assert.equal(df.hunks[0].newLines, 2);
  assert.match(df.patch, /\+more/);
  const st = await g.diff({ path: 'staged.md', staged: true });
  assert.match(st.patch, /\+s/);
  const un = await g.diff({ path: 'u.md' });
  assert.match(un.patch, /\+untracked/);
  assert.equal((await g.diff({ path: '/etc/passwd' })).error, 'bad path');
});

test('repo above root: paths are project-relative', async () => {
  const d = mkRepo();
  w(d, 'sub/a.md', 'a\n'); w(d, 'top.md', 't\n'); commit(d, 'init');
  w(d, 'sub/a.md', 'a2\n'); w(d, 'top.md', 't2\n'); w(d, 'sub/n.md', 'n\n');
  const g = createGit2(path.join(d, 'sub'));
  const ch = await g.changes();
  assert.deepEqual(ch.unstaged.map((f) => f.path), ['a.md']);
  assert.equal(ch.unstaged[0].added, 1);
  assert.deepEqual(ch.untracked, ['n.md']);
  const l = await g.log({});
  assert.equal(l.length, 1);
  const b = await g.blame('a.md');
  assert.equal(b.length, 1);
});

test('blame, stash, stats', async () => {
  const d = mkRepo();
  w(d, 'a.md', 'l1\nl2\n'); commit(d, 'first');
  w(d, 'a.md', 'l1\nl2 changed\nl3\n'); commit(d, 'second change');
  const g = createGit2(d);
  const b = await g.blame('a.md');
  assert.equal(b.length, 3);
  assert.equal(b[0].summary, 'first');
  assert.equal(b[1].summary, 'second change');
  assert.equal(b[2].author, 't');
  assert.equal(b[0].short.length, 7);
  w(d, 'a.md', 'dirty\n'); sh(d, 'stash', 'push', '-m', 'wip');
  const s = await g.stash();
  assert.equal(s.length, 1); assert.equal(s[0].index, 0); assert.match(s[0].message, /wip/);
  const st = await g.stats({});
  assert.equal(st.byAuthor[0].commits, 2);
  assert.equal(st.byDay.length, 1);
  assert.equal(st.topFiles[0].path, 'a.md');
  assert.equal(st.topFiles[0].commits, 2);
  assert.equal((await g.blame('nope.md')).error.length > 0, true);
});

test('ref validation', async () => {
  const d = mkRepo();
  const g = createGit2(d);
  assert.equal(await g.validRefName('feature/ok'), true);
  for (const bad of ['-x', 'a..b', 'a b', 'a~1', 'a:b', '', 'x@{u}', 'a.lock', '--upload-pack=x']) assert.equal(await g.validRefName(bad), false, bad);
});

test('parseHunks', () => {
  const h = parseHunks('diff --git a/x b/x\n@@ -1,2 +1,3 @@ ctx\n a\n+b\n c\n@@ -10 +11 @@\n-x\n+y\n');
  assert.equal(h.length, 2);
  assert.equal(h[0].lines.length, 3);
  assert.equal(h[1].oldLines, 1);
});

test('changelog grouping and git build', async () => {
  assert.deepEqual(parseConventional('feat(ui)!: new thing'), { type: 'feat', scope: 'ui', text: 'new thing', breaking: true });
  assert.equal(parseConventional('random subject').type, 'other');
  const groups = groupCommits([
    { hash: 'a'.repeat(40), subject: 'fix: bug' }, { hash: 'b'.repeat(40), subject: 'feat(x): thing' },
    { hash: 'c'.repeat(40), subject: 'whatever' }, { hash: 'd'.repeat(40), subject: 'chore: y', body: 'BREAKING CHANGE: oh' },
  ]);
  assert.deepEqual(groups.map((g) => g.type), ['feat', 'fix', 'chore', 'other']);
  assert.equal(groups[3].title, 'Other');
  const d = mkRepo();
  w(d, 'a', '1'); commit(d, 'feat: first');
  sh(d, 'tag', 'v0.1.0');
  w(d, 'a', '2'); commit(d, 'fix: second');
  w(d, 'a', '3'); commit(d, 'feat(core): third');
  const r = await buildChangelog(d, {});
  assert.equal(r.from, 'v0.1.0');
  assert.equal(r.count, 2);
  assert.match(r.markdown, /### Features\n\n- \*\*core:\*\* third/);
  assert.match(r.markdown, /### Bug Fixes\n\n- second/);
  assert.ok(!/first/.test(r.markdown));
  const all = await buildChangelog(d, { from: 'v0.1.0^' }).catch(() => null);
  assert.ok(all);
  assert.ok((await buildChangelog(d, { from: '--x' })).error);
  assert.equal(prependChangelog('# Changelog\n\nold\n', '## new\n').startsWith('# Changelog\n\n## new'), true);
  assert.match(prependChangelog('', '## new\n'), /^# Changelog/);
});
