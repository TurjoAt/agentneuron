import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncStatus, syncPlan, similarity } from '../src/agentcenter/sync.js';
import { estimateCosts, modelFamily, priceFor, usdOf } from '../src/agentcenter/costs.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mdctl-sync-'));

test('similarity', () => {
  assert.equal(similarity('- aaa\n- bbb\n', '- aaa\n- bbb\n'), 100);
  assert.equal(similarity('- aaa\n- bbb\n- ccc\n- ddd', '- aaa\n- bbb\n- xxx\n- yyy'), 33);
  assert.equal(similarity('alpha line\n', 'beta line\n'), 0);
});

test('syncStatus pairs, linked and missing', () => {
  const contents = new Map([
    ['CLAUDE.md', '# P\n- use tabs\n- run tests\n- be nice\n'],
    ['AGENTS.md', '# P\n- use tabs\n- run tests\n- be nice\n'],
    ['GEMINI.md', 'completely different text here\n'],
    ['.cursorrules', '@AGENTS.md\n- use tabs\n'],
  ]);
  const files = [...contents.keys()].map((p) => ({ path: p }));
  const s = syncStatus('/x', files, contents);
  const pair = (a, b) => s.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  assert.equal(pair('CLAUDE.md', 'AGENTS.md').status, 'identical');
  assert.equal(pair('CLAUDE.md', 'AGENTS.md').similarity, 100);
  assert.equal(pair('CLAUDE.md', 'GEMINI.md').status, 'diverged');
  assert.equal(pair('AGENTS.md', '.cursorrules').status, 'linked');
  assert.ok(s.missing.some((m) => m.tool === 'copilot'));
  assert.equal(s.files.length, 4);
});

test('syncPlan produces diffs, supports tool ids and import mode, rejects escapes', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# A\n- one\n- two\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# A\n- one\n');
  const plan = syncPlan(root, { source: 'AGENTS.md', targets: ['claude', 'gemini', 'AGENTS.md'] });
  assert.equal(plan.length, 2);
  const c = plan.find((p) => p.target === 'CLAUDE.md');
  assert.equal(c.exists, true);
  assert.equal(c.diff.added, 1);
  assert.equal(plan.find((p) => p.target === 'GEMINI.md').exists, false);
  const imp = syncPlan(root, { source: 'codex', targets: ['claude'], mode: 'import' });
  assert.equal(imp[0].content, '@AGENTS.md\n');
  assert.throws(() => syncPlan(root, { source: 'AGENTS.md', targets: ['../evil.md'] }));
  assert.throws(() => syncPlan(root, { source: '/etc/passwd', targets: ['claude'] }));
});

test('model families and pricing overrides', () => {
  assert.equal(modelFamily('claude-sonnet-4-5-20250929'), 'sonnet');
  assert.equal(modelFamily('claude-opus-4-1-20250805'), 'opus-legacy');
  assert.equal(modelFamily('claude-opus-4-5-20251101'), 'opus');
  assert.equal(modelFamily('claude-haiku-4-5'), 'haiku');
  assert.equal(modelFamily('gpt-5-codex'), 'gpt');
  assert.equal(modelFamily('mystery'), 'other');
  assert.equal(priceFor('claude-sonnet-4-5', { sonnet: { input: 10 } }).input, 10);
  assert.equal(priceFor('claude-sonnet-4-5', { sonnet: { input: 10 } }).output, 15);
});

test('estimateCosts math per session and day', () => {
  const u = { input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite: 400_000 };
  // sonnet: 3 + 1.5 + 0.6 + 1.5 = 6.6
  assert.ok(Math.abs(usdOf(u, 'claude-sonnet-4-5') - 6.6) < 1e-9);
  const d1 = Date.parse('2026-10-01T10:00:00Z'), d2 = Date.parse('2026-10-02T10:00:00Z');
  const sessions = [
    { sessionId: 's1', tool: 'claude', title: 'one', startedAt: d1, lastAt: d2, tokens: {} },
    { sessionId: 's2', tool: 'codex', title: 'two', startedAt: d2, lastAt: d2, tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } },
  ];
  const transcripts = new Map([['s1', {
    models: { 'claude-sonnet-4-5': u },
    days: { '2026-10-01': { 'claude-sonnet-4-5': { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } }, '2026-10-02': { 'claude-sonnet-4-5': { input: 0, output: 100_000, cacheRead: 2_000_000, cacheWrite: 400_000 } } },
  }]]);
  const r = estimateCosts(sessions, transcripts, {});
  const s1 = r.sessions.find((s) => s.sessionId === 's1');
  assert.equal(s1.usd, 6.6);
  assert.equal(s1.input, 1_000_000);
  const s2 = r.sessions.find((s) => s.sessionId === 's2');
  assert.equal(s2.estimated, true);
  assert.equal(s2.usd, 1.25);
  assert.equal(r.days.length, 2);
  assert.equal(r.days[0].day, '2026-10-01');
  assert.equal(r.days[0].usd, 3);
  assert.equal(r.days[1].usd, Math.round((3.6 + 1.25) * 10000) / 10000);
  assert.equal(r.total.usd, 7.85);
  const only2 = estimateCosts(sessions, transcripts, {}, { from: Date.parse('2026-10-02'), to: Date.parse('2026-10-03') });
  assert.equal(only2.days.length, 1);
});
