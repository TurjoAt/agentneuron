import test from 'node:test';
import assert from 'node:assert/strict';
import { healthScore } from '../src/health/score.js';

const mk = (sev, n = 1, rule = 'r') => Array.from({ length: n }, (_, i) => ({ id: `${rule}${i}`, rule, severity: sev, path: 'a.md', message: '' }));
const files = (n) => Array.from({ length: n }, (_, i) => ({ path: `f${i}.md` }));

test('no issues is 100/A', () => {
  const r = healthScore([], files(5));
  assert.equal(r.score, 100);
  assert.equal(r.grade, 'A');
  assert.deepEqual(r.counts, { error: 0, warn: 0, info: 0 });
  assert.deepEqual(r.byRule, {});
});

test('weights: error > warn > info', () => {
  const f = files(10);
  const e = healthScore(mk('error'), f).score;
  const w = healthScore(mk('warn'), f).score;
  const i = healthScore(mk('info'), f).score;
  assert.ok(e < w && w < i && i < 100);
});

test('normalised by file count', () => {
  assert.ok(healthScore(mk('warn', 3), files(2)).score < healthScore(mk('warn', 3), files(50)).score);
});

test('grades and error cap', () => {
  assert.equal(healthScore(mk('error'), files(200)).grade, 'B'); // capped below A
  assert.equal(healthScore(mk('info'), files(100)).grade, 'A');
  assert.equal(healthScore(mk('error', 5), files(2)).grade, 'F');
  const g = healthScore(mk('warn', 5), files(10)).grade;
  assert.ok(['B', 'C', 'D'].includes(g));
});

test('counts, byRule, bounds, empty files', () => {
  const issues = [...mk('error', 2, 'secret'), ...mk('warn', 1, 'orphan'), ...mk('info', 3, 'orphan')];
  const r = healthScore(issues, files(3));
  assert.deepEqual(r.counts, { error: 2, warn: 1, info: 3 });
  assert.deepEqual(r.byRule, { secret: 2, orphan: 4 });
  assert.ok(r.score >= 0 && r.score <= 100);
  const z = healthScore(mk('error', 1000), []);
  assert.ok(z.score >= 0 && z.grade === 'F');
});
