import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  parseRange, prevRangeOf, summary, series, top, heatmap, buildReport, renderCsv, renderMd, renderHtml, exportReport,
} from '../src/reports/index.js';
import { bucketStart, DAY, HOUR, WEEK, makeBuckets } from '../src/reports/data.js';

const T0 = Date.UTC(2026, 0, 5, 0, 0, 0); // a Monday
const ev = (i, ts, path_, tool, kind, added, removed, agent) => ({ id: i, type: 'change', path: path_, ts, file: { tool, kind }, stats: { added, removed }, agent: agent || null });

function fakeCtx(extra = {}) {
  const events = [
    ev(1, T0 + 1 * HOUR, 'a.md', 'claude', 'instructions', 3, 1, { tool: 'claude', sessionId: 's1' }),
    ev(2, T0 + 2 * HOUR, 'a.md', 'claude', 'instructions', 1, 0),
    ev(3, T0 + DAY + HOUR, 'b.md', 'cursor', 'rules', 5, 5, { tool: 'cursor', sessionId: 's2' }),
    ev(4, T0 + 8 * DAY, 'c.md', 'claude', 'docs', 2, 2),
    // previous period (range = [T0, T0+7d], prev = [T0-7d, T0])
    ev(5, T0 - DAY, 'a.md', 'claude', 'instructions', 1, 1),
  ];
  const metrics = [
    { ts: T0 - 3 * DAY, tokens: 1000, health: 80, tasksOpen: 5, tasksDone: 1 },
    { ts: T0 + HOUR, tokens: 1200, health: 85, tasksOpen: 6, tasksDone: 2 },
    { ts: T0 + 3 * DAY, tokens: 1500, health: 90, tasksOpen: 6, tasksDone: 4 },
  ];
  return {
    root: '/nonexistent/none', config: {},
    persist: { events: { query: async ({ from, to }) => events.filter((e) => e.ts >= from && e.ts <= to) }, metrics: { query: async ({ from, to }) => metrics.filter((m) => m.ts >= from && m.ts <= to) } },
    sessions: { list: async () => [{ sessionId: 's1', startedAt: T0 + HOUR, lastAt: T0 + 2 * HOUR }, { sessionId: 'old', startedAt: T0 - 30 * DAY, lastAt: T0 - 29 * DAY }] },
    allFiles: () => [{ path: 'a.md', tokens: 50, mtime: T0 - 100 * DAY, tool: 'claude', kind: 'instructions' }, { path: 'b.md', tokens: 90, mtime: T0, tool: 'cursor', kind: 'rules' }],
    analysis: async () => ({ graph: { edges: [{ from: 'a.md', to: 'b.md' }, { from: 'c.md', to: 'b.md' }] }, health: { score: 70 }, tasks: [{ done: true }, { done: false }] }),
    ...extra,
  };
}
const range = { from: T0, to: T0 + 7 * DAY };

test('parseRange defaults / swap; prevRange', () => {
  const r = parseRange(new URLSearchParams(''), 1e12);
  assert.equal(r.to, 1e12); assert.equal(r.to - r.from, 7 * DAY);
  const s = parseRange(new URLSearchParams('from=200&to=100'));
  assert.deepEqual(s, { from: 100, to: 200 });
  assert.deepEqual(prevRangeOf({ from: 100, to: 200 }), { from: 0, to: 100 });
});

test('bucketing', () => {
  assert.equal(bucketStart(T0 + 5 * HOUR, 'day'), T0);
  assert.equal(bucketStart(T0 + 3 * DAY, 'week'), T0); // weeks start Monday
  assert.equal(bucketStart(T0 + 5 * HOUR + 123, 'hour'), T0 + 5 * HOUR);
  assert.equal(makeBuckets(T0, T0 + 3 * DAY, 'day').length, 4);
  assert.equal(makeBuckets(T0 + HOUR, T0 + 15 * DAY, 'week').length, 3);
});

test('summary kpis and previous-period comparison', async () => {
  const s = await summary(fakeCtx(), range);
  assert.deepEqual(s.prevRange, { from: T0 - 7 * DAY, to: T0 });
  assert.equal(s.kpis.changes, 3);
  assert.equal(s.kpis.filesTouched, 2);
  assert.equal(s.kpis.linesAdded, 9); assert.equal(s.kpis.linesRemoved, 6);
  assert.equal(s.kpis.agentEdits, 2);
  assert.equal(s.kpis.activeSessions, 1);
  assert.equal(s.kpis.tokensNow, 1500);
  assert.equal(s.kpis.tokensDelta, 500); // 1500 - 1000 (last point before range)
  assert.equal(s.kpis.healthNow, 90); assert.equal(s.kpis.healthDelta, 10);
  assert.equal(s.kpis.tasksClosed, 3); // 4 - 1
  assert.equal(s.kpis.tasksOpened, 4); // total 10 - 6
  assert.equal(s.prev.changes, 1);
  assert.equal(s.prev.linesAdded, 1);
  assert.equal(s.prev.activeSessions, 0);
  assert.equal(s.kpis.commits, 0); // no git repo
});

test('series: changes with bucket + split', async () => {
  const c = fakeCtx();
  const r = await series(c, range, { bucket: 'day', metric: 'changes' });
  assert.equal(r.buckets.length, 8);
  assert.equal(r.series.length, 1);
  assert.deepEqual(r.series[0].values, [2, 1, 0, 0, 0, 0, 0, 0].map((v, i) => (i === 7 ? 0 : v)).map((v, i) => (i === 8 ? v : v)));
  assert.equal(r.series[0].values.reduce((a, b) => a + b, 0), 3 + 0); // event at T0+8d is outside range
  const t = await series(c, range, { bucket: 'day', metric: 'changes', split: 'tool' });
  const keys = t.series.map((x) => x.key).sort();
  assert.deepEqual(keys, ['claude', 'cursor']);
  assert.deepEqual(t.series.find((x) => x.key === 'cursor').values.slice(0, 2), [0, 1]);
  const wk = await series(c, { from: T0, to: T0 + 14 * DAY }, { bucket: 'week', metric: 'changes' });
  assert.equal(wk.buckets.length, 3);
  assert.equal(wk.series[0].values[0], 3); assert.equal(wk.series[0].values[1], 1);
  const h = await series(c, { from: T0, to: T0 + 3 * HOUR }, { bucket: 'hour', metric: 'changes' });
  assert.deepEqual(h.series[0].values, [0, 1, 1, 0]);
});

test('series: lines, agents (split session), tokens carry-forward, tasks', async () => {
  const c = fakeCtx();
  const l = await series(c, range, { bucket: 'day', metric: 'lines' });
  assert.equal(l.series[0].values[0], 5); assert.equal(l.series[0].values[1], 10);
  const a = await series(c, range, { bucket: 'day', metric: 'agents', split: 'session' });
  assert.deepEqual(a.series.map((x) => x.key).sort(), ['s1', 's2']);
  const tk = await series(c, range, { bucket: 'day', metric: 'tokens' });
  assert.deepEqual(tk.series[0].values.slice(0, 5), [1200, 1200, 1200, 1500, 1500]);
  const ts = await series(c, range, { bucket: 'day', metric: 'tasks' });
  assert.deepEqual(ts.series.map((x) => x.key), ['open', 'done']);
  assert.equal(ts.series[1].values[3], 4);
  assert.equal((await series(c, range, { metric: 'bogus' })).error, 'unknown metric');
});

test('split overflow collapses into other', async () => {
  const events = Array.from({ length: 15 }, (_, i) => ev(i, T0 + HOUR, `f${i}.md`, `tool${i}`, 'k', 1, 0));
  const c = fakeCtx({ persist: { events: { query: async () => events }, metrics: { query: async () => [] } } });
  const r = await series(c, range, { metric: 'changes', split: 'tool' });
  assert.equal(r.series.length, 13);
  assert.equal(r.series.at(-1).key, 'other');
  assert.equal(r.series.at(-1).values[0], 3);
});

test('falls back to ctx.store.events and current metrics without persist', async () => {
  const c = fakeCtx(); delete c.persist;
  c.store = { events: [ev(1, T0 + HOUR, 'x.md', 'claude', 'docs', 1, 1)] };
  const r = await series(c, range, { metric: 'changes' });
  assert.equal(r.series[0].values[0], 1);
  const tk = await series(c, { from: Date.now() - DAY, to: Date.now() }, { metric: 'tokens' });
  assert.equal(tk.series[0].values.at(-1), 140);
});

test('top: churn, tokens, stale, links', async () => {
  const c = fakeCtx();
  const churn = await top(c, range, 'churn');
  assert.equal(churn[0].path, 'a.md'); assert.equal(churn[0].changes, 2); assert.equal(churn[0].added, 4);
  assert.equal((await top(c, range, 'tokens'))[0].path, 'b.md');
  assert.equal((await top(c, range, 'stale'))[0].path, 'a.md');
  const links = await top(c, range, 'links');
  assert.equal(links[0].path, 'b.md'); assert.equal(links[0].inbound, 2);
  assert.equal(await top(c, range, 'nope'), null);
});

test('heatmap counts per day incl. commits', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mdctl-rp-')));
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 't'); g('config', 'user.email', 't@t');
  fs.writeFileSync(path.join(repo, 'a'), '1'); g('add', '-A'); g('commit', '-q', '-m', 'x');
  const now = Date.now();
  const c = fakeCtx({ root: repo, persist: { events: { query: async () => [ev(1, now, 'a.md', 'claude', 'k', 1, 0), ev(2, now - 1000, 'a.md', 'claude', 'k', 1, 0)] }, metrics: { query: async () => [] } } });
  const h = await heatmap(c, 10, now);
  assert.equal(h.length, 10);
  assert.equal(h.at(-1).count, 3); // 2 events + 1 commit
  assert.equal(h[0].count, 0);
  const kp = await summary(c, { from: now - DAY, to: now + 1000 });
  assert.equal(kp.kpis.commits, 1);
  const sc = await series(c, { from: now - DAY, to: now + 1000 }, { metric: 'commits', split: 'author' });
  assert.deepEqual(sc.series.map((s) => s.key), ['t']);
});

test('export csv/md/html', async () => {
  const c = fakeCtx();
  const rep = await buildReport(c, range);
  assert.equal(rep.daily.length, 8);
  const csv = renderCsv(rep).split('\n');
  assert.equal(csv[0], 'date,changes,lines,commits,agent_edits');
  assert.equal(csv[1], '2026-01-05,2,5,0,1');
  assert.equal(csv.length, 10);
  const md = renderMd(rep);
  assert.match(md, /\| Changes \| 3 \| 1 \|/);
  assert.match(md, /## Top churned files/);
  rep.top[0].path = '<script>x</script>';
  const html = renderHtml(rep);
  assert.ok(!html.includes('<script>x'));
  assert.match(html, /&lt;script&gt;/);
  const e = await exportReport(c, range, 'md');
  assert.match(e.filename, /^mdctl-report-.*\.md$/);
  assert.equal((await exportReport(c, range, 'csv')).type.startsWith('text/csv'), true);
});
