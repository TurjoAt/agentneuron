// Checkpoints & selective restore in temp repos: HEAD, the index, branches and unrelated files stay untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  createCheckpoint, listCheckpoints, compareCheckpoint, checkpointFileDiff, planRestore, restoreCheckpoint, deleteCheckpoint, pruneCheckpoints,
} from '../src/changes/checkpoints.js';
import registerChanges from '../src/actions/changes.js';

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-cp-test-')));
const w = (d, f, c) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); };
const r = (d, f) => fs.readFileSync(path.join(d, f));
const BIN = Buffer.from([0, 1, 2, 3, 255, 254, 0, 10, 13, 10, 7]);
const exe = process.platform !== 'win32';

function repo() {
  const d = tmp();
  sh(d, 'init', '-q', '-b', 'main'); sh(d, 'config', 'core.autocrlf', 'false'); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t');
  w(d, '.gitignore', 'ignored/\n*.log\n');
  w(d, 'a.txt', 'a1\n'); w(d, 'unrelated.txt', 'u1\n'); w(d, 'staged.txt', 's1\n'); w(d, 'src/app.js', 'export const x = 1;\n');
  w(d, 'bin.dat', BIN); w(d, 'run.sh', '#!/bin/sh\necho hi\n');
  if (exe) fs.chmodSync(path.join(d, 'run.sh'), 0o755);
  sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'init');
  sh(d, 'branch', 'feature');
  // dirty state: modified tracked, staged change, untracked, ignored
  w(d, 'a.txt', 'a2 checkpoint version\n');
  w(d, 'unrelated.txt', 'u2 dirty unrelated\n');
  w(d, 'staged.txt', 's2 staged\n'); sh(d, 'add', 'staged.txt');
  w(d, 'untracked.txt', 'new file\n');
  w(d, 'ignored/big.txt', 'ignored\n'); w(d, 'debug.log', 'log\n');
  return d;
}
/** Everything a checkpoint must never change. */
function state(d) {
  return {
    head: sh(d, 'rev-parse', 'HEAD'), sym: sh(d, 'symbolic-ref', 'HEAD'),
    heads: sh(d, 'for-each-ref', 'refs/heads'), index: sh(d, 'ls-files', '-s'), cached: sh(d, 'diff', '--cached'),
    stash: sh(d, 'stash', 'list'),
  };
}

test('create: snapshot incl. untracked, excluding ignored; HEAD, index, branches and files untouched', async () => {
  const d = repo();
  const before = state(d);
  const status = sh(d, 'status', '--porcelain');
  const cp = await createCheckpoint(d, { label: 'before refactor', source: 'task', task: 'T-1' });
  assert.deepEqual(state(d), before);
  assert.equal(sh(d, 'status', '--porcelain'), status);
  assert.match(cp.id, /^\d{8}-\d{9}-[0-9a-f]{6}$/);
  assert.equal(cp.ref, `refs/agentneuron/checkpoints/${cp.id}`);
  assert.equal(cp.base, before.head.trim());
  assert.equal(cp.source, 'task'); assert.equal(cp.task, 'T-1'); assert.equal(cp.label, 'before refactor');
  assert.deepEqual([...cp.files].sort(), ['a.txt', 'staged.txt', 'unrelated.txt', 'untracked.txt']);
  const tree = sh(d, 'ls-tree', '-r', '--name-only', cp.hash).split('\n').filter(Boolean);
  assert.ok(tree.includes('untracked.txt') && tree.includes('a.txt') && tree.includes('bin.dat'));
  assert.ok(!tree.some((p) => p.startsWith('ignored/') || p.endsWith('.log')), 'ignored files are not captured');
  assert.equal(sh(d, 'show', `${cp.hash}:a.txt`), 'a2 checkpoint version\n');
  assert.equal(sh(d, 'show', `${cp.hash}:staged.txt`), 's2 staged\n');
  // contract shape for listCheckpoints (consumed by the agent brief)
  const list = await listCheckpoints(d, { limit: 5 });
  assert.equal(list.length, 1);
  for (const k of ['id', 'ref', 'label', 'createdAt', 'base', 'files', 'source', 'task', 'session']) assert.ok(k in list[0], k);
  assert.equal(typeof list[0].createdAt, 'number');
  assert.equal(list[0].session, null);
});

test('selective restore after a moved HEAD: only the chosen paths change', async () => {
  const d = repo();
  const cp = await createCheckpoint(d, { label: 'cp' });
  // later work: a new commit (HEAD moves), more edits, a deleted untracked file, a new file
  w(d, 'other.txt', 'committed later\n'); sh(d, 'add', 'other.txt'); sh(d, 'commit', '-q', '-m', 'later');
  w(d, 'a.txt', 'a3 broken by agent\n');
  w(d, 'unrelated.txt', 'u3 still dirty\n');
  w(d, 'bin.dat', Buffer.from('not binary any more'));
  w(d, 'run.sh', 'echo changed\n');
  if (exe) fs.chmodSync(path.join(d, 'run.sh'), 0o644);
  fs.unlinkSync(path.join(d, 'untracked.txt'));
  w(d, 'scratch.txt', 'agent scratch\n');
  w(d, 'staged.txt', 's3 staged again\n'); sh(d, 'add', 'staged.txt');

  const cmp = await compareCheckpoint(d, cp.id);
  const st = Object.fromEntries(cmp.files.map((f) => [f.path, f.status]));
  assert.equal(st['a.txt'], 'changed');
  assert.equal(st['untracked.txt'], 'deleted');
  assert.equal(st['scratch.txt'], 'added');
  assert.equal(st['other.txt'], 'added');
  assert.equal(st['bin.dat'], 'changed');

  const plan = await planRestore(d, cp.id, ['a.txt', 'untracked.txt', 'scratch.txt', 'bin.dat', 'run.sh', 'src/app.js']);
  const act = Object.fromEntries(plan.files.map((f) => [f.path, f.action]));
  assert.deepEqual(act, { 'a.txt': 'overwrite', 'untracked.txt': 'create', 'scratch.txt': 'delete', 'bin.dat': 'overwrite', 'run.sh': 'overwrite', 'src/app.js': 'skip' });

  const before = state(d);
  const unrelated = r(d, 'unrelated.txt');
  const other = r(d, 'other.txt');
  const res = await restoreCheckpoint(d, cp.id, ['a.txt', 'untracked.txt', 'scratch.txt', 'bin.dat', 'run.sh']);
  assert.equal(res.restored.length, 5);
  assert.deepEqual(state(d), before, 'HEAD, index, branches and stash unchanged');
  assert.equal(r(d, 'a.txt').toString(), 'a2 checkpoint version\n');
  assert.equal(r(d, 'untracked.txt').toString(), 'new file\n');
  assert.ok(!fs.existsSync(path.join(d, 'scratch.txt')));
  assert.deepEqual(r(d, 'bin.dat'), BIN, 'binary content restored byte for byte');
  assert.equal(r(d, 'run.sh').toString(), '#!/bin/sh\necho hi\n');
  if (exe) assert.ok(fs.statSync(path.join(d, 'run.sh')).mode & 0o100, 'executable bit restored');
  assert.deepEqual(r(d, 'unrelated.txt'), unrelated);
  assert.deepEqual(r(d, 'other.txt'), other);
  assert.equal(r(d, 'staged.txt').toString(), 's3 staged again\n');
  assert.ok(fs.existsSync(path.join(d, 'ignored/big.txt')) && fs.existsSync(path.join(d, 'debug.log')));
  // an undo checkpoint holds the pre-restore state
  assert.equal(res.undo.source, 'auto');
  assert.equal(sh(d, 'show', `${res.undo.hash}:a.txt`), 'a3 broken by agent\n');
  assert.equal(sh(d, 'show', `${res.undo.hash}:scratch.txt`), 'agent scratch\n');
  const list = await listCheckpoints(d);
  assert.equal(list.length, 2);
});

test('file diff, validation, symlink refusal, delete and prune', async () => {
  const d = repo();
  const cp = await createCheckpoint(d, {});
  w(d, 'a.txt', 'a9\n');
  const fd = await checkpointFileDiff(d, cp.id, 'a.txt');
  assert.deepEqual([fd.before, fd.after], ['a2 checkpoint version\n', 'a9\n']);
  const bd = await checkpointFileDiff(d, cp.id, 'bin.dat');
  assert.equal(bd.binary, true); assert.equal(bd.before, null);
  await assert.rejects(checkpointFileDiff(d, cp.id, '../etc/passwd'), /invalid path/);
  await assert.rejects(planRestore(d, cp.id, ['../x']), /invalid path/);
  await assert.rejects(planRestore(d, cp.id, ['/etc/passwd']), /invalid path/);
  await assert.rejects(planRestore(d, cp.id, []), /paths required/);
  await assert.rejects(compareCheckpoint(d, '../../HEAD'), /invalid checkpoint id/);
  await assert.rejects(compareCheckpoint(d, 'nope-123'), /not found/);
  if (exe) {
    const out = tmp();
    fs.symlinkSync(out, path.join(d, 'link'));
    const p = await planRestore(d, cp.id, ['link/a.txt']);
    assert.equal(p.files[0].action, 'skip');
    assert.match(p.files[0].reason, /symlink/);
  }
  const p2 = await planRestore(d, cp.id, ['.git/config']);
  assert.equal(p2.files[0].action, 'skip');
  const c2 = await createCheckpoint(d, { label: 'two' });
  const c3 = await createCheckpoint(d, { label: 'three' });
  const pr = await pruneCheckpoints(d, { keep: 2 });
  assert.equal(pr.deleted.length, 1);
  assert.deepEqual((await listCheckpoints(d)).map((c) => c.id).sort(), [c2.id, c3.id].sort());
  await deleteCheckpoint(d, c2.id);
  assert.deepEqual((await listCheckpoints(d)).map((c) => c.id), [c3.id]);
  await assert.rejects(deleteCheckpoint(d, c2.id), /not found/);
});

test('works in a repo without commits and outside git', async () => {
  const d = tmp();
  sh(d, 'init', '-q', '-b', 'main');
  w(d, 'first.txt', 'one\n');
  const cp = await createCheckpoint(d, { label: 'empty repo' });
  assert.equal(cp.base, null);
  assert.equal(sh(d, 'ls-files', '-s'), '', 'index still empty');
  assert.throws(() => sh(d, 'rev-parse', '--verify', 'HEAD'));
  w(d, 'first.txt', 'two\n');
  await restoreCheckpoint(d, cp.id, ['first.txt']);
  assert.equal(r(d, 'first.txt').toString(), 'one\n');
  const plain = tmp();
  assert.deepEqual(await listCheckpoints(plain), []);
  await assert.rejects(createCheckpoint(plain, {}), /not a git repository/);
});

test('actions: levels, restore preview lists files, run restores', async () => {
  const d = repo();
  const defs = new Map();
  const ctx = { root: d, config: {}, invalidate() {} };
  registerChanges({ register: (x) => defs.set(x.id, x) }, ctx);
  assert.equal(defs.get('changes.checkpoint.create').level, 'edit');
  assert.equal(defs.get('changes.checkpoint.delete').level, 'edit');
  assert.equal(defs.get('changes.checkpoint.prune').level, 'edit');
  assert.equal(defs.get('changes.checkpoint.restore').level, 'danger');
  assert.ok(await defs.get('changes.checkpoint.restore').available());
  const logs = [];
  const job = { log: (s, t) => logs.push(t) };
  const cp = await defs.get('changes.checkpoint.create').run({ label: 'via action' }, ctx, job);
  w(d, 'a.txt', 'changed again\n');
  const pv = await defs.get('changes.checkpoint.restore').preview({ id: cp.id, paths: ['a.txt', 'unrelated.txt'] });
  assert.deepEqual(pv.files.map((f) => [f.path, f.action]), [['a.txt', 'overwrite'], ['unrelated.txt', 'skip']]);
  assert.deepEqual(pv.command, ['restore', cp.id, '--', 'a.txt']);
  const res = await defs.get('changes.checkpoint.restore').run({ id: cp.id, paths: ['a.txt'] }, ctx, job);
  assert.equal(res.restored.length, 1);
  assert.ok(res.undo.id);
  assert.equal(r(d, 'a.txt').toString(), 'a2 checkpoint version\n');
  assert.ok(logs.some((l) => /undo point/.test(l)));
  assert.match(defs.get('changes.checkpoint.restore').params.id.pattern, /\^/);
  assert.ok(!new RegExp(defs.get('changes.checkpoint.restore').params.id.pattern).test('../x'));
});
