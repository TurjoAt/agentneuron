import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportReport, EXPORT_FORMATS, SCHEMA, rangeFromSpec, slugify, exportFilename } from '../src/reports/index.js';
import { CONTENT_BUDGET } from '../src/reports/export.js';
import { estimateTokens } from '../src/core/tokens.js';

const DAY = 86400000, HOUR = 3600000;
const T0 = Date.UTC(2026, 0, 5);
const range = { from: T0, to: T0 + 7 * DAY };
const SECRET = 'sk-ant-' + 'Qw3rTy7uIo9pAs2dFg4hJk6lZx8cVb1nM0';
const ROOT = path.join(os.tmpdir(), 'an-export-nowhere', 'My Cool Proj!');

function fakeCtx(extra = {}) {
  const events = [
    { id: 1, type: 'add', path: 'CLAUDE.md', ts: T0 + HOUR, file: { tool: 'claude', kind: 'context' }, stats: { added: 4, removed: 0 }, agent: { tool: 'claude', sessionId: 's1' } },
    { id: 2, type: 'change', path: 'CLAUDE.md', ts: T0 + 2 * HOUR, file: { tool: 'claude', kind: 'context' }, stats: { added: 2, removed: 1 }, agent: null },
    { id: 3, type: 'unlink', path: 'old-rules.md', ts: T0 + DAY, file: { tool: 'cursor', kind: 'rules' }, stats: { added: 0, removed: 3 }, agent: null },
  ];
  const contents = new Map([
    ['CLAUDE.md', `# Project\n\nUse the key ${SECRET} for tests.\nLogs live in ${ROOT}${path.sep}logs\n- [ ] ship export\n`],
    ['.cursor/rules/style.mdc', '# Style\n' + 'Prefer small functions. '.repeat(20000)],
    ['docs/notes.md', '# Notes\n'],
  ]);
  return {
    root: ROOT, config: {},
    persist: { events: { query: async ({ from, to }) => events.filter((e) => e.ts >= from && e.ts <= to) }, metrics: { query: async () => [] } },
    store: { contents },
    allFiles: () => [
      { path: 'CLAUDE.md', tool: 'claude', kind: 'context', tokens: 40, mtime: T0 + 2 * HOUR },
      { path: '.cursor/rules/style.mdc', tool: 'cursor', kind: 'rules', tokens: estimateTokens(contents.get('.cursor/rules/style.mdc')), mtime: T0 - 200 * DAY },
      { path: 'docs/notes.md', tool: 'generic', kind: 'doc', tokens: 3, mtime: T0 },
    ],
    analysis: async () => ({
      health: { score: 72, grade: 'C', counts: { error: 1, warn: 1, info: 0 } },
      issues: [
        { rule: 'size', severity: 'warn', path: '.cursor/rules/style.mdc', message: 'rules file is large' },
        { rule: 'secret', severity: 'error', path: 'CLAUDE.md', line: 3, message: `Anthropic API key ${SECRET.slice(0, 4)}****`, hint: `see ${ROOT}` },
      ],
      tasks: [{ path: 'CLAUDE.md', line: 5, text: 'ship export', done: false }, { path: 'CLAUDE.md', line: 6, text: 'done one', done: true }],
    }),
    ...extra,
  };
}

const leaks = (body) => {
  assert.ok(!body.includes(SECRET), 'secret leaked');
  assert.ok(!body.includes(SECRET.slice(8, 24)), 'secret fragment leaked');
  assert.ok(!body.includes(ROOT) && !body.includes(ROOT.replace(/\\/g, '/')), 'absolute root leaked');
  assert.ok(!body.includes(os.homedir() + path.sep), 'home dir leaked');
};

test('rangeFromSpec / slugify / filename', () => {
  const r = rangeFromSpec('7d', 1e12);
  assert.deepEqual(r, { from: 1e12 - 7 * DAY, to: 1e12 });
  assert.equal(rangeFromSpec('24h', 1e12).from, 1e12 - DAY);
  assert.throws(() => rangeFromSpec('lots'), /invalid range/);
  assert.throws(() => rangeFromSpec('0d'), /invalid range/);
  assert.equal(slugify('My Cool Proj!'), 'my-cool-proj');
  assert.equal(slugify('../../etc'), 'etc');
  assert.equal(slugify('"; rm -rf'), 'rm-rf');
  assert.equal(slugify(''), 'project');
  assert.equal(exportFilename('A/B', range, 'json'), 'agentneuron-report-a-b-2026-01-05_2026-01-12.json');
});

test('every format: content type, filename, masking, no absolute paths', async () => {
  const types = { csv: 'text/csv', md: 'text/markdown', html: 'text/html', json: 'application/json', ai: 'text/markdown', llm: 'text/markdown' };
  const ext = { csv: 'csv', md: 'md', html: 'html', json: 'json', ai: 'ai.md', llm: 'ai.md' };
  for (const f of EXPORT_FORMATS) {
    const out = await exportReport(fakeCtx(), range, f, { includeContent: true });
    assert.ok(out.type.startsWith(types[f]), `${f}: ${out.type}`);
    assert.equal(out.filename, `agentneuron-report-my-cool-proj-2026-01-05_2026-01-12.${ext[f]}`);
    assert.ok(out.body.length > 20);
    assert.ok(out.tokens > 0);
    leaks(out.body);
  }
  await assert.rejects(exportReport(fakeCtx(), range, 'pdf'), /unknown export format/);
  // 3-arg call (CLI) keeps working
  assert.equal((await exportReport(fakeCtx(), range, 'csv')).format, 'csv');
});

test('json: agentneuron.report/v1 schema', async () => {
  const out = await exportReport(fakeCtx(), range, 'json');
  const r = JSON.parse(out.body);
  assert.deepEqual(Object.keys(r), ['schema', 'generatedAt', 'project', 'range', 'prevRange', 'kpis', 'series', 'top', 'fileChanges', 'health', 'tasks', 'contextFiles', 'issues']);
  assert.equal(r.schema, SCHEMA);
  assert.equal(r.project.name, 'My Cool Proj!');
  assert.ok(Array.isArray(r.project.stack));
  assert.equal(r.range.from, '2026-01-05T00:00:00.000Z');
  assert.equal(r.prevRange.to, r.range.from);
  assert.deepEqual(r.kpis.changes, { value: 3, previous: 0, delta: 3 });
  assert.equal(r.series.length, 8);
  assert.deepEqual(Object.keys(r.series[0]), ['date', 'changes', 'lines', 'commits', 'agentEdits']);
  assert.equal(r.top[0].path, 'CLAUDE.md');
  assert.deepEqual(r.fileChanges, { added: ['CLAUDE.md'], removed: ['old-rules.md'] });
  assert.deepEqual(r.health, { score: 72, grade: 'C', counts: { error: 1, warn: 1, info: 0 } });
  assert.equal(r.tasks.open, 1); assert.equal(r.tasks.done, 1); assert.equal(r.tasks.items[0].text, 'ship export');
  assert.deepEqual(Object.keys(r.contextFiles[0]), ['path', 'tool', 'kind', 'tokens', 'updatedAt']);
  assert.equal(r.issues[0].severity, 'error'); // ranked
  assert.equal(r.issues[0].hint, 'see .');
  assert.equal(r.contents, undefined);
  const withC = JSON.parse((await exportReport(fakeCtx(), range, 'json', { includeContent: true })).body);
  assert.equal(withC.contents.files[0].path, 'CLAUDE.md');
});

test('ai: front-matter, sections, content cap and masking', async () => {
  const out = await exportReport(fakeCtx(), range, 'ai');
  const b = out.body;
  assert.match(b, /^---\nschema: "agentneuron\.report\/v1"\n/);
  assert.match(b, /\nproject: "My Cool Proj!"\n/);
  assert.match(b, /\ntokenEstimate: \d+\n/);
  for (const h of ['## Summary', '## KPIs', '## What changed', '## Health issues', '## Open tasks', '## Context budget by tool', '## Suggested next actions']) assert.ok(b.includes(h), h);
  assert.match(b, /\| Changes \| 3 \| 0 \| \+3 \|/);
  assert.match(b, /New files: `CLAUDE\.md`/);
  assert.match(b, /Removed files: `old-rules\.md`/);
  assert.match(b, /1\. \*\*error\*\* `secret`/);
  assert.match(b, /- \[ \] ship export/);
  assert.match(b, /Remove and rotate 1 hard-coded secret/);
  assert.ok(!b.includes('## File contents'));

  const c = await exportReport(fakeCtx(), range, 'llm', { includeContent: true });
  assert.match(c.body, /includesContent: true/);
  assert.match(c.body, /## File contents/);
  assert.match(c.body, /### CLAUDE\.md/);
  assert.match(c.body, /sk-a\*\*\*\*/); // masked inside included content
  assert.match(c.body, /… \[truncated: showing ~\d+ of \d+ tokens\]/);
  assert.ok(!c.body.includes('### docs/notes.md')); // docs are not "main context"
  assert.ok(c.tokens < CONTENT_BUDGET + 4000, `tokens ${c.tokens}`);
  leaks(c.body);
});
