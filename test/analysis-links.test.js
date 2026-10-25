import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks } from '../src/analysis/links.js';
import { buildGraph } from '../src/analysis/graph.js';
import { effectiveContext, contextDirs } from '../src/analysis/context.js';
import { extractTasks } from '../src/analysis/tasks.js';
import { extractDecisions } from '../src/analysis/decisions.js';

const P = (...a) => new Set(a);

test('md links, anchors, urls, broken', () => {
  const c = '[a](docs/plan.md#x) [u](https://x.com/a.md) [m](mailto:a@b.c) [b](missing.md) [h](#top) ![i](img.png)';
  const l = extractLinks('CLAUDE.md', c, P('CLAUDE.md', 'docs/plan.md'));
  assert.deepEqual(l.map((x) => [x.to, x.type, x.broken]), [['docs/plan.md', 'md-link', false], ['missing.md', 'md-link', true]]);
});
test('relative resolution', () => {
  const l = extractLinks('docs/a.md', '[x](../CLAUDE.md) [y](b.md "t") [z](<sub/c d.md>)', P('CLAUDE.md', 'docs/b.md', 'docs/sub/c d.md'));
  assert.deepEqual(l.map((x) => x.to), ['CLAUDE.md', 'docs/b.md', 'docs/sub/c d.md']);
  assert.ok(l.every((x) => !x.broken && x.line === 1));
});
test('wiki links', () => {
  const l = extractLinks('a.md', 'see [[plan]] and [[Nope|alias]]\n[[docs/plan#h]]', P('a.md', 'docs/plan.md'));
  assert.equal(l[0].to, 'docs/plan.md');
  assert.equal(l[1].broken, true);
  assert.equal(l[2].to, 'docs/plan.md');
});
test('imports: not emails, fences, inline code', () => {
  const c = ['@docs/plan.md', 'mail me@docs/plan.md or a@b.com', '`@docs/plan.md`', '```', '@docs/plan.md', '```', 'use @claude and @nothing.md here'].join('\n');
  const l = extractLinks('CLAUDE.md', c, P('CLAUDE.md', 'docs/plan.md')).filter((x) => x.type === 'import');
  assert.deepEqual(l.map((x) => [x.line, x.to, x.broken]), [[1, 'docs/plan.md', false], [7, 'nothing.md', true]]);
});
test('mentions', () => {
  const l = extractLinks('CLAUDE.md', 'read docs/plan.md. also xdocs/plan.md and docs/plan.mdx\n```\ndocs/plan.md\n```', P('CLAUDE.md', 'docs/plan.md'));
  assert.equal(l.length, 1);
  assert.equal(l[0].type, 'mention');
  assert.equal(l[0].line, 1);
});
test('no duplicate mention for linked path', () => {
  const l = extractLinks('CLAUDE.md', '[p](docs/plan.md)', P('CLAUDE.md', 'docs/plan.md'));
  assert.equal(l.length, 1);
  assert.equal(l[0].type, 'md-link');
});

const F = (path, extra = {}) => {
  const i = path.lastIndexOf('/');
  return { path, name: path.slice(i + 1), dir: i < 0 ? '' : path.slice(0, i), tool: 'claude', kind: 'context', tokens: 10, size: 5, mtime: 1, ...extra };
};

test('graph hierarchy + degree', () => {
  const files = [F('CLAUDE.md'), F('a/CLAUDE.md'), F('a/b/CLAUDE.md'), F('docs/x.md')];
  const contents = new Map([['CLAUDE.md', '@docs/x.md'], ['a/CLAUDE.md', ''], ['a/b/CLAUDE.md', ''], ['docs/x.md', '']]);
  const g = buildGraph(files, contents);
  const h = g.edges.filter((e) => e.type === 'hierarchy').map((e) => `${e.from}>${e.to}`).sort();
  assert.deepEqual(h, ['a/CLAUDE.md>CLAUDE.md', 'a/b/CLAUDE.md>a/CLAUDE.md']);
  const deg = Object.fromEntries(g.nodes.map((n) => [n.id, n.degree]));
  assert.equal(deg['CLAUDE.md'], 2);
  assert.equal(deg['a/CLAUDE.md'], 2);
  assert.equal(deg['docs/x.md'], 1);
});

test('claude context: chain, imports, cycles, depth', () => {
  const files = [F('CLAUDE.md'), F('CLAUDE.local.md'), F('a/CLAUDE.md'), F('docs/x.md'), F('docs/y.md')];
  const contents = new Map([
    ['CLAUDE.md', 'root @docs/x.md'], ['CLAUDE.local.md', 'local'], ['a/CLAUDE.md', 'sub'],
    ['docs/x.md', 'X @y.md'], ['docs/y.md', 'Y @x.md @../CLAUDE.md'],
  ]);
  const r = effectiveContext('a', files, contents, 'claude');
  assert.deepEqual(r.chain.map((c) => [c.path, c.reason]), [
    ['CLAUDE.md', 'root'], ['docs/x.md', 'import'], ['docs/y.md', 'import'], ['CLAUDE.local.md', 'root'], ['a/CLAUDE.md', 'ancestor']]);
  assert.ok(r.text.includes('\n\n<!-- from: a/CLAUDE.md -->\nsub'));
  assert.ok(r.tokens > 0);
  const root = effectiveContext('', files, contents);
  assert.equal(root.chain.length, 4);
});
test('import depth limit 5', () => {
  const files = [F('CLAUDE.md')], contents = new Map([['CLAUDE.md', '@f1.md']]);
  for (let i = 1; i <= 9; i++) { files.push(F(`f${i}.md`)); contents.set(`f${i}.md`, `@f${i + 1}.md`); }
  const r = effectiveContext('', files, contents);
  assert.equal(r.chain.length, 1 + 5);
});
test('codex + cursor', () => {
  const files = [F('AGENTS.md'), F('s/AGENTS.md'), F('s/AGENTS.override.md'), F('.cursorrules'), F('.cursor/rules/a.mdc'), F('.cursor/rules/b.mdc')];
  const contents = new Map([['AGENTS.md', 'r'], ['s/AGENTS.md', 's'], ['s/AGENTS.override.md', 'o'], ['.cursorrules', 'old'],
    ['.cursor/rules/a.mdc', '---\nalwaysApply: true\n---\nA'], ['.cursor/rules/b.mdc', '---\nalwaysApply: false\n---\nB']]);
  assert.deepEqual(effectiveContext('s', files, contents, 'codex').chain.map((c) => c.path), ['AGENTS.md', 's/AGENTS.md', 's/AGENTS.override.md']);
  const c = effectiveContext('', files, contents, 'cursor');
  assert.deepEqual(c.chain.map((x) => [x.path, x.reason]), [['.cursorrules', 'rule'], ['.cursor/rules/a.mdc', 'rule']]);
  assert.deepEqual(contextDirs(files), ['', 's']);
});

test('tasks', () => {
  const c = '# Plan\n- [ ] one\n* [x] two\n```\n- [ ] no\n```\n## Later\nTODO: three\nfix FIXME: four\n1. [X] five';
  const t = extractTasks('p.md', c);
  assert.deepEqual(t.map((x) => [x.line, x.text, x.done, x.section]), [
    [2, 'one', false, 'Plan'], [3, 'two', true, 'Plan'], [8, 'three', false, 'Later'], [9, 'four', false, 'Later'], [10, 'five', true, 'Later']]);
});

test('decisions: ADR file', () => {
  const c = '# 3. Use Postgres\n\nDate: 2024-05-06\n\n## Status\n\nAccepted\n\n## Decision\nWe use it.';
  const d = extractDecisions('docs/adr/0003-use-postgres.md', c, 'decision');
  assert.deepEqual(d, [{ path: 'docs/adr/0003-use-postgres.md', title: '3. Use Postgres', status: 'Accepted', date: '2024-05-06', line: 1 }]);
});
test('decisions: filename date, frontmatter status', () => {
  const d = extractDecisions('adr/2024-01-02-x.md', '---\nstatus: proposed\n---\n# X', 'decision');
  assert.equal(d[0].status, 'proposed');
  assert.equal(d[0].date, '2024-01-02');
});
test('decisions: heading in plain doc and DECISIONS.md log', () => {
  const d = extractDecisions('docs/arch.md', '# Arch\n## Decision: Use Redis\nText\n## Other', 'doc');
  assert.deepEqual(d.map((x) => [x.title, x.line]), [['Use Redis', 2]]);
  const l = extractDecisions('DECISIONS.md', '# Log\n## 2024-03-01 Pick A\nStatus: accepted\n## Pick B', 'decision');
  assert.deepEqual(l.map((x) => [x.title, x.status, x.date]), [['2024-03-01 Pick A', 'accepted', '2024-03-01'], ['Pick B', undefined, undefined]]);
});

// reference: the original per-path scan for plain mentions
function slowMentions(path, content, allPaths) {
  const lines = String(content).split(/\r?\n/); const out = []; const seen = new Set();
  let fence = null; const fl = lines.map((t) => { const m = /^\s{0,3}(`{3,}|~{3,})/.exec(t); let inF = fence !== null; if (m) { if (fence === null) { fence = m[1][0]; inF = true; } else if (m[1][0] === fence) { fence = null; inF = true; } } return inF; });
  for (const p of allPaths) {
    if (p === path || !content.includes(p)) continue;
    lines.forEach((lt, li) => {
      if (fl[li]) return;
      let from = 0;
      for (;;) {
        const i = lt.indexOf(p, from); if (i === -1) break; from = i + p.length;
        const b = lt[i - 1], a = lt[i + p.length];
        if (b !== undefined && /[\w/.\-]/.test(b)) continue;
        if (a !== undefined && /[\w/\-]/.test(a)) continue;
        if (a === '.' && /\w/.test(lt[i + p.length + 1] || '')) continue;
        const k = `${li + 1}|${p}`; if (!seen.has(k)) { seen.add(k); out.push(k); } break;
      }
    });
  }
  return out;
}

test('mentions: indexed lookup matches the per-path scan (randomised)', () => {
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const words = ['a', 'b', 'docs', 'x.y', 'src', 'ü', 'my file', 'plan', 'v1.2'];
  const exts = ['.md', '.js', '.json', '', '.test.js'];
  for (let round = 0; round < 40; round++) {
    const paths = new Set();
    while (paths.size < 12) paths.add(Array.from({ length: 1 + rnd(3) }, () => words[rnd(words.length)]).join('/') + exts[rnd(exts.length)]);
    const list = [...paths];
    const seps = [' ', '.', '..', '/', '-', '(', ')', '`', ',', '\n', '.x', 'z', ':', '\n```\n'];
    let text = '';
    for (let i = 0; i < 60; i++) text += (rnd(2) ? list[rnd(list.length)] : words[rnd(words.length)]) + seps[rnd(seps.length)];
    const fast = extractLinks(list[0], text, paths).filter((l) => l.type === 'mention').map((l) => `${l.line}|${l.to}`);
    const slow = slowMentions(list[0], text, paths);
    assert.deepEqual(fast.slice().sort(), slow.slice().sort(), text);
  }
});

test('mentions: large path sets stay fast', () => {
  const paths = new Set(Array.from({ length: 4000 }, (_, i) => `notes/n${i}.md`));
  const files = [...paths].map((p, i) => [p, `# N\n\nsee notes/n${(i * 7) % 4000}.md and [[n${(i * 3) % 4000}]] ${'lorem ipsum '.repeat(40)}\n`]);
  const t = Date.now();
  let n = 0;
  for (const [p, c] of files) n += extractLinks(p, c, paths).length;
  assert.ok(n >= 4000);
  assert.ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
});
