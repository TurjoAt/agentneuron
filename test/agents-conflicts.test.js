import test from 'node:test';
import assert from 'node:assert/strict';
import { createConflictRadar } from '../src/agents/conflicts.js';

const ag = (id, tool = 'claude') => ({ tool, sessionId: id, ts: 0 });

test('two distinct sessions in window conflict', () => {
  let t = 1000000;
  const r = createConflictRadar({ windowMs: 60000, now: () => t });
  r.note({ path: 'CLAUDE.md', ts: t, agent: ag('a') });
  assert.deepEqual(r.active(), []);
  r.note({ path: 'CLAUDE.md', ts: t + 5000, agent: ag('b') });
  t += 6000;
  const a = r.active();
  assert.equal(a.length, 1);
  assert.equal(a[0].path, 'CLAUDE.md');
  assert.deepEqual(a[0].agents.map((x) => x.sessionId), ['b', 'a']);
  assert.equal(a[0].lastTs, 1005000);
});

test('same session repeatedly is not a conflict; no agent ignored', () => {
  const r = createConflictRadar({ now: () => 5000 });
  r.note({ path: 'a.md', ts: 1000, agent: ag('a') });
  r.note({ path: 'a.md', ts: 2000, agent: ag('a') });
  r.note({ path: 'a.md', ts: 2000, agent: null });
  r.note({ path: 'a.md', ts: 2000 });
  assert.deepEqual(r.active(), []);
});

test('window expiry clears conflicts', () => {
  let t = 0;
  const r = createConflictRadar({ windowMs: 1000, now: () => t });
  r.note({ path: 'a.md', ts: 0, agent: ag('a') });
  r.note({ path: 'a.md', ts: 100, agent: ag('b') });
  t = 500;
  assert.equal(r.active().length, 1);
  t = 1050; // a expired, b still live
  assert.equal(r.active().length, 0);
});

test('different tools with same id are distinct; paths independent', () => {
  const r = createConflictRadar({ now: () => 10 });
  r.note({ path: 'x.md', ts: 1, agent: ag('s', 'claude') });
  r.note({ path: 'x.md', ts: 2, agent: ag('s', 'codex') });
  r.note({ path: 'y.md', ts: 2, agent: ag('s', 'codex') });
  assert.deepEqual(r.active().map((c) => c.path), ['x.md']);
});
