import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lint } from '../src/health/lint.js';

const NOW = Date.UTC(2026, 9, 23);
const f = (p, o = {}) => ({
  path: p, name: p.split('/').pop(), dir: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '',
  tool: 'generic', kind: 'doc', ext: '.md', size: 100, mtime: NOW, hash: 'h', tokens: 50, lines: 5, title: null, ...o,
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-lint-'));
const rules = (is, r) => is.filter((i) => i.rule === r);

test('broken-link from links', () => {
  const files = [f('CLAUDE.md', { kind: 'context', tool: 'claude' })];
  const links = [
    { from: 'CLAUDE.md', to: 'docs/x.md', type: 'md-link', line: 3, broken: true, raw: '[x](docs/x.md)' },
    { from: 'CLAUDE.md', to: 'ok.md', type: 'md-link', line: 4, broken: false, raw: '' },
    { from: 'CLAUDE.md', to: 'm.md', type: 'mention', line: 5, broken: true, raw: '' },
  ];
  const r = rules(lint({ root: tmp(), files, contents: new Map([['CLAUDE.md', '# a']]), links, now: NOW }), 'broken-link');
  assert.equal(r.length, 2);
  assert.equal(r[0].severity, 'error');
  assert.equal(r[0].id, 'broken-link:CLAUDE.md:3:docs/x.md');
  assert.equal(r[0].line, 3);
  assert.ok(r[0].hint);
  assert.equal(r[1].severity, 'warn');
});

test('missing-path checks backticked paths on disk, ignoring fences and generated dirs', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/real.js'), '');
  const content = [
    'Use `src/real.js` and `src/gone.js` and `./src/gone2.js`.',
    'Ignore `node_modules/x/y.js`, `dist/app.js`, `https://a.com/b.md`, `src/*.js`, `npm run build`, `a/b`, `package.json`.',
    '```',
    '`src/in-fence.js`',
    '```',
    'dup `src/gone.js` again',
  ].join('\n');
  const files = [f('README.md', { kind: 'readme' })];
  const r = rules(lint({ root, files, contents: new Map([['README.md', content]]), links: [], now: NOW }), 'missing-path');
  assert.deepEqual(r.map((i) => i.message.split('`')[1]).sort(), ['./src/gone2.js', 'src/gone.js']);
  assert.equal(r[0].line, 1);
  assert.equal(r[0].severity, 'warn');
});

test('missing-path resolves relative to the file dir and against tracked files', () => {
  const root = tmp();
  const files = [f('docs/a.md'), f('docs/sub/b.md')];
  const contents = new Map([['docs/a.md', 'see `sub/b.md`'], ['docs/sub/b.md', '']]);
  const r = rules(lint({ root, files, contents, links: [], now: NOW }), 'missing-path');
  assert.equal(r.length, 0);
});

test('orphan', () => {
  const files = [f('a.md'), f('b.md'), f('README.md', { kind: 'readme' })];
  const contents = new Map(files.map((x) => [x.path, 'text']));
  const links = [{ from: 'README.md', to: 'a.md', type: 'md-link', line: 1, broken: false, raw: '' }];
  const r = rules(lint({ root: tmp(), files, contents, links, now: NOW }), 'orphan');
  assert.deepEqual(r.map((i) => i.path), ['b.md']);
  assert.equal(r[0].severity, 'info');
  // single file: not an orphan
  assert.equal(rules(lint({ root: tmp(), files: [f('a.md')], contents: new Map([['a.md', 'x']]), links: [], now: NOW }), 'orphan').length, 0);
});

test('large-context thresholds', () => {
  const mk = (t, kind = 'context') => f('CLAUDE.md', { kind, tokens: t });
  const run = (file) => rules(lint({ root: tmp(), files: [file], contents: new Map([[file.path, 'x']]), links: [], now: NOW }), 'large-context');
  assert.equal(run(mk(5000)).length, 0);
  assert.equal(run(mk(5001))[0].severity, 'warn');
  assert.equal(run(mk(10001))[0].severity, 'error');
  assert.equal(run(mk(20000, 'doc')).length, 0);
  assert.ok(run(mk(6000))[0].hint);
});

test('duplicate-rule across tools only', () => {
  const rule = '- Always run the full test suite before committing changes';
  const files = [
    f('CLAUDE.md', { kind: 'context', tool: 'claude' }),
    f('AGENTS.md', { kind: 'context', tool: 'codex' }),
    f('sub/CLAUDE.md', { kind: 'context', tool: 'claude' }),
  ];
  const contents = new Map([
    ['CLAUDE.md', `# a\n${rule}\n- short`],
    ['AGENTS.md', `* **Always** run the full test suite before committing changes.\n`],
    ['sub/CLAUDE.md', `${rule}\n`],
  ]);
  const r = rules(lint({ root: tmp(), files, contents, links: [], now: NOW }), 'duplicate-rule');
  assert.deepEqual(r.map((i) => i.path).sort(), ['AGENTS.md', 'CLAUDE.md', 'sub/CLAUDE.md']);
  assert.ok(r.find((i) => i.path === 'AGENTS.md').message.includes('CLAUDE.md:2'));
  // same tool only: none
  const same = lint({ root: tmp(), files: files.filter((x) => x.tool === 'claude'), contents, links: [], now: NOW });
  assert.equal(rules(same, 'duplicate-rule').length, 0);
});

test('stale-plan', () => {
  const day = 86400000;
  const files = [
    f('PLAN.md', { kind: 'plan', mtime: NOW - 31 * day }),
    f('TODO.md', { kind: 'todo', mtime: NOW - 29 * day }),
    f('docs/old.md', { kind: 'doc', mtime: NOW - 400 * day }),
  ];
  const r = rules(lint({ root: tmp(), files, contents: new Map(files.map((x) => [x.path, 'x'])), links: [], now: NOW }), 'stale-plan');
  assert.deepEqual(r.map((i) => i.path), ['PLAN.md']);
  assert.match(r[0].message, /31 days/);
});

test('empty-file', () => {
  const files = [f('CLAUDE.md', { kind: 'context', size: 3 }), f('a.md', { size: 0 })];
  const r = rules(lint({ root: tmp(), files, contents: new Map([['CLAUDE.md', ' \n\n'], ['a.md', '']]), links: [], now: NOW }), 'empty-file');
  assert.equal(r.length, 2);
  assert.equal(r.find((i) => i.path === 'CLAUDE.md').severity, 'warn');
  assert.equal(r.find((i) => i.path === 'a.md').severity, 'info');
});

test('secrets included and issues have unique ids', () => {
  const files = [f('CLAUDE.md', { kind: 'context' })];
  const is = lint({ root: tmp(), files, contents: new Map([['CLAUDE.md', 'key AKIAQ3EXAMPL4TESTK7Z']]), links: [], now: NOW });
  assert.equal(rules(is, 'secret').length, 1);
  assert.equal(new Set(is.map((i) => i.id)).size, is.length);
});

test('clean project yields no issues', () => {
  const files = [f('README.md', { kind: 'readme' })];
  assert.deepEqual(lint({ root: tmp(), files, contents: new Map([['README.md', '# Hi\n\nHello']]), links: [], now: NOW }), []);
});

test('missing-path accepts shortened paths that match the end of a real file', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'resources/views/layouts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'resources/views/layouts/app.blade.php'), '');
  const content = 'See `layouts/app.blade.php` and `layouts/gone.blade.php`.';
  const r = rules(lint({ root, files: [f('README.md')], contents: new Map([['README.md', content]]), links: [], now: NOW }), 'missing-path');
  assert.deepEqual(r.map((i) => i.message.split('`')[1]), ['layouts/gone.blade.php']);
});
