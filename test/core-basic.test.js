import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ensureAgentneuronDir } from '../src/core/config.js';
import { classify, isCandidate } from '../src/core/classify.js';
import { globMatch } from '../src/core/glob.js';
import { estimateTokens } from '../src/core/tokens.js';
import { scan, readEntry } from '../src/core/scanner.js';
import { lineDiff } from '../src/core/diff.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-core-'));
const put = (root, rel, c) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), c); };

test('config defaults, file and overrides', () => {
  const r = tmp();
  assert.equal(loadConfig(r).port, 4747);
  ensureAgentneuronDir(r);
  assert.equal(fs.readFileSync(path.join(r, '.agentneuron/.gitignore'), 'utf8'), 'history/\ncache/\n');
  fs.writeFileSync(path.join(r, '.agentneuron/config.json'), JSON.stringify({ port: 5000, ignore: ['tmp'] }));
  const c = loadConfig(r, { host: '0.0.0.0', port: undefined });
  assert.equal(c.port, 5000);
  assert.equal(c.host, '0.0.0.0');
  assert.deepEqual(c.ignore, ['tmp']);
  assert.equal(c.root, path.resolve(r));
  fs.writeFileSync(path.join(r, '.agentneuron/config.json'), '{bad');
  assert.equal(loadConfig(r).port, 4747);
});

test('glob matching', () => {
  assert.ok(globMatch('**/CLAUDE.md', 'CLAUDE.md'));
  assert.ok(globMatch('**/CLAUDE.md', 'a/b/CLAUDE.md'));
  assert.ok(!globMatch('*.md', 'a/b.md'));
  assert.ok(globMatch('docs/**', 'docs/a/b.md'));
  assert.ok(globMatch('a/?.md', 'a/x.md'));
  assert.ok(!globMatch('a/?.md', 'a/xy.md'));
  assert.ok(globMatch('*.{md,mdc}', 'x.mdc'));
  assert.ok(!globMatch('*.{md,mdc}', 'x.txt'));
});

test('classify known patterns', () => {
  const cases = [
    ['CLAUDE.md', 'claude', 'context'],
    ['sub/CLAUDE.local.md', 'claude', 'context'],
    ['.claude/agents/reviewer.md', 'claude', 'agent'],
    ['.claude/skills/foo/SKILL.md', 'claude', 'skill'],
    ['.claude/commands/x/y.md', 'claude', 'command'],
    ['.claude/settings.local.json', 'claude', 'config'],
    ['.mcp.json', 'claude', 'config'],
    ['AGENTS.md', 'codex', 'context'],
    ['.cursorrules', 'cursor', 'rules'],
    ['.cursor/rules/a/b.mdc', 'cursor', 'rules'],
    ['.github/copilot-instructions.md', 'copilot', 'context'],
    ['.github/instructions/x.instructions.md', 'copilot', 'rules'],
    ['.github/prompts/p.prompt.md', 'copilot', 'command'],
    ['.windsurfrules', 'windsurf', 'rules'],
    ['.windsurf/rules/a.md', 'windsurf', 'rules'],
    ['GEMINI.md', 'gemini', 'context'],
    ['README.md', 'generic', 'readme'],
    ['TODO.md', 'generic', 'todo'],
    ['ROADMAP.md', 'generic', 'plan'],
    ['DECISIONS.md', 'generic', 'decision'],
    ['docs/adr/0001-x.md', 'generic', 'decision'],
    ['docs/guide.md', 'generic', 'doc'],
    ['docs/TODO.md', 'generic', 'todo'],
    ['CHANGELOG.md', 'generic', 'changelog'],
    ['memory/notes.md', 'generic', 'memory'],
    ['random/thing.md', 'generic', 'other'],
  ];
  for (const [p, tool, kind] of cases) {
    const c = classify(p);
    assert.deepEqual([c.tool, c.kind, c.tracked], [tool, kind, true], p);
  }
  assert.equal(classify('src/app.js').tracked, false);
});

test('isCandidate honours ignore rules, extra patterns, includeAllMarkdown', () => {
  const cfg = loadConfig(tmp(), { ignore: ['legacy', 'docs/private/**'] });
  assert.ok(isCandidate('README.md', cfg));
  assert.ok(!isCandidate('node_modules/x/README.md', cfg));
  assert.ok(!isCandidate('.agentneuron/history/a.md', cfg));
  assert.ok(!isCandidate('a/vendor/b.md', cfg));
  assert.ok(!isCandidate('legacy/a.md', cfg));
  assert.ok(!isCandidate('docs/private/a.md', cfg));
  assert.ok(!isCandidate('src/x.js', cfg));
  const strict = { ...cfg, includeAllMarkdown: false };
  assert.ok(!isCandidate('random/thing.md', strict));
  assert.ok(isCandidate('CLAUDE.md', strict));
  const ex = { ...cfg, extraPatterns: [{ glob: 'prompts/**/*.txt', tool: 'generic', kind: 'command' }] };
  assert.ok(isCandidate('prompts/a/b.txt', ex));
  assert.equal(classify('prompts/a/b.txt', ex.extraPatterns).kind, 'command');
});

test('estimateTokens is deterministic and monotonic', () => {
  assert.equal(estimateTokens(''), 0);
  const a = estimateTokens('hello world, this is a test of tokens');
  assert.equal(a, estimateTokens('hello world, this is a test of tokens'));
  assert.ok(a > 0);
  assert.ok(estimateTokens('x'.repeat(4000)) > estimateTokens('x'.repeat(400)));
});

test('scan and readEntry', async () => {
  const r = tmp();
  put(r, 'CLAUDE.md', '---\nx: 1\n---\n# Hello Title\n\nbody\n');
  put(r, 'docs/a.md', '```\n# not title\n```\n# Real\n');
  put(r, 'node_modules/p/README.md', '# no');
  put(r, '.git/x.md', '# no');
  put(r, 'src/code.js', 'x');
  put(r, 'big.md', 'a'.repeat(200));
  const cfg = loadConfig(r, { maxFileSize: 100 });
  const list = await scan(r, cfg);
  assert.deepEqual(list.map((e) => e.path), ['CLAUDE.md', 'docs/a.md']);
  const c = list[0];
  assert.equal(c.title, 'Hello Title');
  assert.equal(c.tool, 'claude');
  assert.equal(c.dir, '');
  assert.equal(c.lines, 6);
  assert.match(c.hash, /^[0-9a-f]{40}$/);
  assert.equal(list[1].dir, 'docs');
  assert.equal(list[1].title, 'Real');
  assert.equal(await readEntry(r, 'nope.md'), null);
  const re = await readEntry(r, 'docs/a.md');
  assert.equal(re.entry.path, 'docs/a.md');
  assert.ok(re.content.includes('Real'));
});

test('lineDiff basics', () => {
  let d = lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n');
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
  assert.deepEqual(d.hunks.map((h) => h.type), ['ctx', 'del', 'add', 'ctx', 'add']);
  assert.equal(d.hunks[1].text, 'b');
  assert.equal(d.hunks[1].line, 2);
  d = lineDiff('', 'x\ny\n');
  assert.deepEqual([d.added, d.removed], [2, 0]);
  d = lineDiff('x\ny', '');
  assert.deepEqual([d.added, d.removed], [0, 2]);
  d = lineDiff('same\n', 'same\n');
  assert.deepEqual([d.added, d.removed], [0, 0]);
  d = lineDiff('a\nb\nc\nd\ne\n', 'a\nc\nd\nx\ne\n');
  assert.deepEqual([d.added, d.removed], [1, 1]);
  // reconstruct new text from ctx+add
  assert.equal(d.hunks.filter((h) => h.type !== 'del').map((h) => h.text).join('\n'), 'a\nc\nd\nx\ne');
});

test('lineDiff handles huge inputs without hanging', () => {
  const a = Array.from({ length: 30000 }, (_, i) => 'a' + i).join('\n');
  const b = Array.from({ length: 30000 }, (_, i) => 'b' + i).join('\n');
  const t = Date.now();
  const d = lineDiff(a, b);
  assert.equal(d.added, 30000);
  assert.equal(d.removed, 30000);
  assert.ok(Date.now() - t < 3000);
  // very different mid-size: exceeds D cap, still correct counts
  const c = Array.from({ length: 2000 }, (_, i) => 'c' + i).join('\n');
  const e = Array.from({ length: 2000 }, (_, i) => 'e' + i).join('\n');
  const d2 = lineDiff(c, e);
  assert.deepEqual([d2.added, d2.removed], [2000, 2000]);
});
