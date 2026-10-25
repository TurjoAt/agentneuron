import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRegistry } from '../src/actions/registry.js';
import { loadConfig } from '../src/core/config.js';
import { createGit } from '../src/analysis/git.js';
import { createGit2 } from '../src/git2/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-reg2-'));
const hasGit = spawnSync('git', ['--version']).status === 0;

test('job output keeps multi-byte characters split across chunks', async () => {
  const root = tmp();
  const config = loadConfig(root, { actions: { exec: true } });
  const ctx = { root, config, broadcast() {}, notify() {}, can: () => true, persist: { audit: { log() {} } } };
  const reg = createRegistry(ctx);
  // "€" is e2 82 ac: write it in two separate chunks
  const code = 'process.stdout.write(Buffer.from([0xe2,0x82]));setTimeout(()=>process.stdout.write(Buffer.from([0xac,0x0a])),100)';
  reg.register({ id: 'u.split', title: 'S', category: 'x', level: 'exec', run: (_p, _c, job) => job.exec(process.execPath, ['-e', code]) });
  const j = await reg.run('u.split', {}, { role: 'admin' });
  await j.done;
  assert.equal(j.result.stdout, '€\n');
});

test('registry.list leaves no pending availability timers', async () => {
  const root = tmp();
  const ctx = { root, config: loadConfig(root), broadcast() {}, notify() {}, can: () => true, persist: { audit: { log() {} } } };
  const reg = createRegistry(ctx);
  reg.register({ id: 'a.b', title: 'A', category: 'x', level: 'exec', available: () => true, run() {} });
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  await reg.list('admin');
  assert.equal(process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length, before);
});

test('git: non-ASCII file names are not C-quoted in recent commits and stats', { skip: !hasGit && 'git not installed' }, async () => {
  const root = tmp();
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'über.md'), '# x\n');
  git('add', '.'); git('commit', '-qm', 'init');
  const info = await createGit(root).repoInfo();
  assert.deepEqual(info.recent[0].files, ['über.md']);
  const st = await createGit2(root).stats({});
  assert.equal(st.topFiles[0].path, 'über.md');
  assert.equal(st.truncated, false);
});

test('locateTranscript: uses a pre-walked codex list; foreign claude dirs ignored with a root', async () => {
  const { locateTranscript, listCodexTranscripts } = await import('../src/agentcenter/transcript.js');
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude/projects/other'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/projects/other/s1.jsonl'), '{}\n');
  fs.mkdirSync(path.join(home, '.codex/sessions/2026/01'), { recursive: true });
  const cf = path.join(home, '.codex/sessions/2026/01/rollout-x-c1.jsonl');
  fs.writeFileSync(cf, '{}\n');
  assert.equal(locateTranscript('s1', { root: '/some/project', home }), null);
  assert.equal(locateTranscript('s1', { home }).tool, 'claude');
  const files = listCodexTranscripts(home);
  assert.deepEqual(files, [cf]);
  assert.equal(locateTranscript('c1', { root: '/p', home, codexFiles: files }).file, cf);
  assert.equal(locateTranscript('c1', { root: '/p', home, codexFiles: [] }), null, 'pre-walked list is used as-is');
});
