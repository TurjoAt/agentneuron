import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyContext, claimFix, falseClaimIssues, extractClaims, clearFactsCache } from '../src/verify/index.js';
import { claimMatches, compileRange } from '../src/verify/semver.js';
import { lint } from '../src/health/lint.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-verify-'));
const put = (root, rel, c) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), c); };

function project(files, md) {
  const root = tmp();
  for (const [k, v] of Object.entries(files)) put(root, k, typeof v === 'string' ? v : JSON.stringify(v));
  const docs = typeof md === 'string' ? { 'CLAUDE.md': md } : md;
  for (const [k, v] of Object.entries(docs)) put(root, k, v);
  clearFactsCache();
  const entries = Object.keys(docs).map((p) => ({ path: p, kind: p.includes('/examples/') || p.startsWith('examples/') ? 'context' : /\.cursor\/rules/.test(p) ? 'rules' : /README/.test(p) ? 'readme' : 'context', tool: 'claude' }));
  const contents = new Map(Object.entries(docs));
  return { root, files: entries, contents, run: () => verifyContext({ root, files: entries, contents }) };
}
const find = (r, text) => r.claims.find((c) => c.text === text);
const statusOf = (r, text) => find(r, text)?.status ?? 'none';

const PNPM = {
  'package.json': { name: 'app', scripts: { test: 'vitest run', build: 'vite build', dev: 'vite --port 5173', lint: 'eslint .' }, devDependencies: { vitest: '^1.6.0', vite: '^5.0.0', react: '^18.2.0', eslint: '^9.0.0' }, engines: { node: '>=18' } },
  'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  'src/index.ts': 'export const x = process.env.DATABASE_URL;\n',
  '.env.example': 'DATABASE_URL=\nREDIS_URL=\n',
  Makefile: '.PHONY: build test\nbuild:\n\tpnpm build\ntest: build\n\tpnpm test\n',
};

test('false claims: wrong package manager, missing/typo scripts, make targets, artisan, cargo', () => {
  const p = project(PNPM, [
    '# App', '',
    '- Run `yarn test` before committing.',
    '- `npm run tset` runs the unit tests.',
    '- Deploy with `pnpm deploy-prod`.',
    '- `make lint` checks style; `make build` builds.',
    '- Migrations: `php artisan migrate`.',
    '- Native module: `cargo test`.',
    '',
  ].join('\n'));
  const r = p.run();
  const y = find(r, 'yarn test');
  assert.equal(y.status, 'false');
  assert.match(y.evidence, /pnpm \(pnpm-lock\.yaml\)/);
  assert.equal(y.suggestion, 'replace `yarn test` with `pnpm test`');
  assert.equal(y.fixable, true);
  const t = find(r, 'npm run tset');
  assert.equal(t.status, 'false');
  assert.match(t.suggestion, /pnpm test|npm run test/);
  assert.equal(statusOf(r, 'pnpm deploy-prod'), 'unknown'); // could be a bin; node_modules not installed
  assert.equal(statusOf(r, 'make lint'), 'false');
  assert.equal(statusOf(r, 'make build'), 'ok');
  assert.equal(statusOf(r, 'php artisan migrate'), 'false');
  assert.equal(statusOf(r, 'cargo test'), 'false');
});

test('ok claims: existing scripts, bins from deps, builtins, global installs', () => {
  const p = project(PNPM, '- `pnpm test` and `pnpm build`\n- `pnpm vitest --watch`\n- `pnpm add zod`\n- `pnpm run lint`\n- `npm i -g agentneuron`\n- `pnpm install`\n');
  const r = p.run();
  for (const t of ['pnpm test', 'pnpm build', 'pnpm vitest --watch', 'pnpm add zod', 'pnpm run lint', 'pnpm install']) assert.equal(statusOf(r, t), 'ok', t);
  assert.equal(statusOf(r, 'npm i -g agentneuron'), 'unknown');
  assert.equal(r.summary.false, 0);
});

test('a missing script with an installed node_modules/.bin is false with a near-miss suggestion', () => {
  const p = project({ ...PNPM, 'node_modules/.bin/vite': '' }, '- `pnpm buld` to build\n');
  const c = find(p.run(), 'pnpm buld');
  assert.equal(c.status, 'false');
  assert.equal(c.suggestion, 'replace `pnpm buld` with `pnpm build`');
});

test('versions, competitor frameworks, env vars, ports, paths', () => {
  const p = project({ ...PNPM, '.nvmrc': '20.11.1\n' }, [
    'Requires Node 16. Built with React 17 and Vite 5.',
    'Unit tests use Jest.',
    'Set `DATABSE_URL` in your environment. `REDIS_URL` too.',
    '`pnpm dev` serves on port 3000.',
    'Entry point: `src/index.ts`; old helpers in `src/legacy/helpers.ts`.',
  ].join('\n'));
  const r = p.run();
  const node = find(r, 'Node 16');
  assert.equal(node.status, 'false');
  assert.equal(node.suggestion, 'replace `Node 16` with `Node 20`');
  assert.equal(find(r, 'React 17').suggestion, 'replace `React 17` with `React 18`');
  assert.equal(statusOf(r, 'Vite 5'), 'ok');
  const jest = find(r, 'Jest');
  assert.equal(jest.status, 'false');
  assert.equal(jest.suggestion, 'replace `Jest` with `Vitest`');
  assert.equal(find(r, 'DATABSE_URL').suggestion, 'replace `DATABSE_URL` with `DATABASE_URL`');
  assert.equal(statusOf(r, 'REDIS_URL'), 'ok');
  const port = find(r, 'port 3000');
  assert.equal(port.status, 'false');
  assert.match(port.evidence, /5173/);
  assert.equal(statusOf(r, 'src/index.ts'), 'ok');
  assert.equal(statusOf(r, 'src/legacy/helpers.ts'), 'false');
});

test('runtime ranges: "Node 20" and "Node 18+" agree with >=18; understated floors are false', () => {
  const p = project({ 'package.json': { engines: { node: '>=18.17' } } }, 'Node 20 works. Node 18+ is required. Node 14+ is fine.\n');
  const r = p.run();
  assert.equal(statusOf(r, 'Node 20'), 'ok');
  assert.equal(statusOf(r, 'Node 18+'), 'ok');
  assert.equal(statusOf(r, 'Node 14+'), 'false');
  assert.equal(claimMatches('^8.2', { major: 8, minor: 1 }), false);
  assert.equal(claimMatches('^8.2', { major: 8, minor: 3 }), true);
  assert.equal(claimMatches('>=3.11,<4', { major: 3, minor: 12 }), true);
  assert.equal(claimMatches('workspace:*', { major: 1 }), null);
  assert.equal(compileRange('latest'), null);
});

test('precision: examples, placeholders, non-shell fences, negations, ignore markers, URLs are not claims', () => {
  const md = [
    '---', 'description: run `yarn nope` here', '---',
    '# Guide',
    '```js', 'exec("npm run nope")', '```',
    'Example:', '```bash', 'yarn nope', '```',
    '```sh example', 'yarn nope', '```',
    '- Package managers: `pnpm`, `yarn`, `bun`.',
    '- Run any script with `npm run <script>` or `npm run $NAME`.',
    '- e.g. `yarn nope` would work elsewhere.',
    '- We migrated from Jest to Vitest last year.',
    '<!-- agentneuron-ignore -->',
    '- `yarn nope`',
    '- See https://example.com/docs/yarn-test and http://localhost:3000/x',
    '## Examples', '- `yarn nope`',
  ].join('\n');
  const r = project(PNPM, md).run();
  assert.deepEqual(r.claims.filter((c) => c.status === 'false').map((c) => c.text), []);
  assert.ok(!r.claims.some((c) => c.kind === 'dependency'));
  assert.ok(!r.claims.some((c) => /nope/.test(c.text)));
  assert.equal(r.claims.filter((c) => c.kind === 'port').length, 1); // localhost:3000 is a port claim (unknown), the URL path is not a path claim
});

test('shell fences are checked; cd scopes the package.json; no manifest means unknown', () => {
  const p = project({ ...PNPM, 'web/package.json': { scripts: { serve: 'vite preview' } } }, '```bash\n$ cd web && pnpm serve\npnpm serve\n```\n');
  const r = p.run();
  assert.deepEqual(r.claims.map((c) => [c.line, c.status]), [[2, 'ok'], [3, 'unknown']]);
  const bare = project({}, '- `npm run lint`\n- `make test`\n').run();
  assert.equal(statusOf(bare, 'npm run lint'), 'unknown');
  assert.equal(statusOf(bare, 'make test'), 'false'); // no Makefile anywhere
});

test('nested sample projects are skipped; context files only', () => {
  const p = project(PNPM, { 'CLAUDE.md': '- `pnpm test`\n', 'examples/demo/CLAUDE.md': '- `yarn nope`\n', 'README.md': '- `yarn nope`\n' });
  const r = p.run();
  assert.deepEqual(r.claims.map((c) => c.file), ['CLAUDE.md']);
});

test('claimFix recomputes the edit server-side; lint folds non-path false claims as warn', () => {
  const p = project(PNPM, '# A\n\n- Run `yarn test` first.\n- See `src/nope/x.ts`.\n');
  const r = p.run();
  const c = find(r, 'yarn test');
  const fix = claimFix({ root: p.root, files: p.files, contents: p.contents, id: c.id });
  assert.equal(fix.after, '# A\n\n- Run `pnpm test` first.\n- See `src/nope/x.ts`.\n');
  assert.equal(claimFix({ root: p.root, files: p.files, contents: p.contents, id: c.id.replace(/[0-9a-f]{10}$/, '0000000000') }), null);
  assert.equal(claimFix({ root: p.root, files: p.files, contents: p.contents, id: '../etc:passwd:1:0000000000' }), null);
  const issues = falseClaimIssues(p);
  assert.deepEqual(issues.map((i) => [i.rule, i.severity, i.line]), [['false-claim', 'warn', 3]]);
  const all = lint({ root: p.root, files: p.files.map((f) => ({ ...f, tokens: 10, size: 10 })), contents: p.contents, links: [] });
  assert.ok(all.some((i) => i.rule === 'false-claim'));
  assert.ok(all.some((i) => i.rule === 'missing-path')); // the path stays with missing-path, not duplicated
});

test('extractClaims keeps line numbers and exact segment text', () => {
  const cl = extractClaims('a\n`cd api && npm run build -- --prod`\n');
  assert.equal(cl[0].line, 2);
  assert.equal(cl[0].text, 'npm run build -- --prod');
  assert.equal(cl[0].cmd.dir, 'api');
});
