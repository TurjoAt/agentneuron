// Ship check: parsers, check detection, runs, scope, readiness, placeholders, report, MCP, CLI. Temp dirs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseOutput, stripAnsi } from '../src/ship/parse.js';
import { detectChecks, kindOfScript } from '../src/ship/checks.js';
import { saveRun, listRuns, getRun, relFailures } from '../src/ship/runs.js';
import { extractCriteria, taskScope, allScope, criterionId, setOverride, keywords, matches } from '../src/ship/scope.js';
import { readiness, placeholders, _clearScanCache } from '../src/ship/scan.js';
import { scanFile } from '../src/ship/rules.js';
import { scannable, isTestLike } from '../src/ship/files.js';
import { completionReport, verdictOf, shipSummary } from '../src/ship/index.js';
import registerShip, { runChecks } from '../src/actions/ship.js';
import { makeTools, TOOL_DEFS } from '../src/ship/mcp.js';
import { cmdShip } from '../src/commands/ship.js';
import { clearProjectCache } from '../src/project/index.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-ship-')));
const put = (root, rel, c) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), c); };
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: GIT_ENV }).toString();
function repo() {
  const d = tmp();
  sh(d, 'init', '-q', '-b', 'main');
  sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t'); sh(d, 'config', 'commit.gpgsign', 'false');
  return d;
}
const commit = (d, msg) => { sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', msg); };
// fake credentials assembled at runtime so this file holds no secret-shaped literal
const FAKE_AWS = 'AKIA' + 'Q7RZ4M2XK9WB3TNP';
const FAKE_GH = 'ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF3hJ5';
const fakeJob = (results = {}) => {
  const calls = [];
  return { id: 'job1', calls, logs: [], log(s, t) { this.logs.push([s, t]); }, async exec(cmd, args, opts) { calls.push([cmd, args, opts]); const k = `${cmd} ${args.join(' ')}`; return results[k] || { code: 0, stdout: '', stderr: '' }; } };
};

// ---------------------------------------------------------------- parsers
const NODE_TAP = `TAP version 13
# Subtest: passes
ok 1 - passes
  ---
  duration_ms: 1.1
  ...
# Subtest: suite
    # Subtest: inner ok
    ok 1 - inner ok
      ---
      duration_ms: 0.2
      ...
    # Subtest: inner bad
    not ok 2 - inner bad
      ---
      duration_ms: 0.9
      location: '/work/proj/test/a.test.mjs:3:74'
      failureType: 'testCodeFailure'
      error: '1 == 2'
      code: 'ERR_ASSERTION'
      ...
    1..2
not ok 2 - suite
  ---
  error: '1 subtest failed'
  ...
# Subtest: skipped one
ok 3 - skipped one # SKIP
1..3
# tests 5
# pass 2
# fail 2
# skipped 1
`;

test('parse node:test TAP: leaf counts, failure with location and message', () => {
  const p = parseOutput(NODE_TAP, { exitCode: 1 });
  assert.equal(p.format, 'tap');
  assert.deepEqual([p.passed, p.failed, p.skipped], [2, 1, 1]);
  assert.equal(p.failures.length, 1);
  assert.deepEqual(p.failures[0], { name: 'inner bad', file: '/work/proj/test/a.test.mjs', line: 3, message: '1 == 2' });
  assert.ok(p.tests.some((t) => t.name === 'inner ok' && t.status === 'passed'));
  assert.deepEqual(relFailures('/work/proj', p.failures)[0].file, 'test/a.test.mjs');
  assert.equal(relFailures('/elsewhere', p.failures)[0].file, null, 'paths outside the project are dropped');
});

test('parse Jest and Vitest summaries with failure locations', () => {
  const jest = `PASS src/a.test.js
FAIL src/cart.test.js
  Cart
    ✓ adds items (3 ms)
    ✕ applies discount (5 ms)

  ● Cart › applies discount

    expect(received).toBe(expected)

      at Object.<anonymous> (src/cart.test.js:14:23)

Tests:       1 failed, 1 skipped, 7 passed, 9 total
`;
  const j = parseOutput(jest, { exitCode: 1 });
  assert.equal(j.format, 'jest');
  assert.deepEqual([j.passed, j.failed, j.skipped], [7, 1, 1]);
  assert.equal(j.failures[0].name, 'Cart > applies discount');
  assert.equal(j.failures[0].file, 'src/cart.test.js');
  assert.equal(j.failures[0].line, 14);
  assert.match(j.failures[0].message, /toBe/);
  const vitest = `\x1b[31m FAIL \x1b[39m src/math.test.ts > math > divides
AssertionError: expected 2 to be 3
 ❯ src/math.test.ts:9:17

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 11 passed (12)
`;
  const v = parseOutput(vitest, { exitCode: 1 });
  assert.equal(v.format, 'vitest');
  assert.deepEqual([v.passed, v.failed], [11, 1]);
  assert.equal(v.failures[0].file, 'src/math.test.ts');
  assert.equal(v.failures[0].line, 9);
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
});

test('parse PHPUnit, pytest, go test, cargo test', () => {
  const php = `PHPUnit 10.5.0

..F.

There was 1 failure:

1) Tests\\Feature\\InvoiceTest::test_total
Failed asserting that 10 matches expected 12.

/app/tests/Feature/InvoiceTest.php:22

FAILURES!
Tests: 4, Assertions: 6, Failures: 1.
`;
  const ph = parseOutput(php, { exitCode: 1 });
  assert.equal(ph.format, 'phpunit');
  assert.deepEqual([ph.passed, ph.failed], [3, 1]);
  assert.equal(ph.failures[0].name, 'Tests\\Feature\\InvoiceTest::test_total');
  assert.equal(ph.failures[0].line, 22);
  assert.equal(parseOutput('OK (12 tests, 30 assertions)\n').passed, 12);

  const py = `tests/test_api.py:31: AssertionError
FAILED tests/test_api.py::test_login - assert 401 == 200
========================= 1 failed, 5 passed, 2 skipped in 0.42s =========================
`;
  const p = parseOutput(py, { exitCode: 1 });
  assert.equal(p.format, 'pytest');
  assert.deepEqual([p.passed, p.failed, p.skipped], [5, 1, 2]);
  assert.deepEqual(p.failures[0], { name: 'tests/test_api.py::test_login', file: 'tests/test_api.py', line: 31, message: 'assert 401 == 200' });

  const go = `=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSub
    calc_test.go:12: got 1 want 2
--- FAIL: TestSub (0.00s)
FAIL
FAIL	example.com/calc	0.002s
`;
  const g = parseOutput(go, { exitCode: 1 });
  assert.equal(g.format, 'go');
  assert.deepEqual([g.passed, g.failed], [1, 1]);
  assert.equal(g.failures[0].file, 'calc_test.go');
  assert.equal(g.failures[0].line, 12);

  const cargo = `running 2 tests
test tests::ok_one ... ok
test tests::bad_one ... FAILED

failures:

---- tests::bad_one stdout ----
thread 'tests::bad_one' panicked at src/lib.rs:10:9:
assertion failed

failures:
    tests::bad_one

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out
`;
  const c = parseOutput(cargo, { exitCode: 101 });
  assert.equal(c.format, 'cargo');
  assert.deepEqual([c.passed, c.failed], [1, 1]);
  assert.equal(c.failures[0].file, 'src/lib.rs');
  assert.equal(c.failures[0].line, 10);
});

test('parse tsc / eslint diagnostics and generic exit codes', () => {
  const tsc = parseOutput('src/a.ts(3,7): error TS2322: Type string is not assignable to type number.\n', { exitCode: 2 });
  assert.equal(tsc.failed, 1);
  assert.deepEqual([tsc.failures[0].file, tsc.failures[0].line], ['src/a.ts', 3]);
  const eslint = parseOutput('/p/src/b.js\n  4:10  error  \'x\' is defined but never used  no-unused-vars\n\n✖ 1 problem\n', { exitCode: 1 });
  assert.equal(eslint.failures[0].name, 'no-unused-vars');
  assert.equal(eslint.failures[0].line, 4);
  const ok = parseOutput('built in 2.1s\n', { exitCode: 0 });
  assert.deepEqual([ok.format, ok.passed, ok.failed], ['exit', 1, 0]);
  const bad = parseOutput('Error: Cannot find module x\n    at y (src/c.js:5:1)\n', { exitCode: 1 });
  assert.equal(bad.failed, 1);
  assert.equal(bad.failures[0].file, 'src/c.js');
  // a recognised format with 0 failures but a non-zero exit is still a failure
  const crash = parseOutput('Tests:       3 passed, 3 total\nJest: coverage threshold not met\n', { exitCode: 1 });
  assert.equal(crash.failed, 1);
});

// ---------------------------------------------------------------- checks + runs
test('detectChecks: package scripts by kind, never watch/dev, composer, go, cargo', async () => {
  const r = tmp();
  put(r, 'package.json', JSON.stringify({ name: 'p', scripts: { test: 'node --test', 'test:watch': 'x --watch', build: 'vite build', lint: 'eslint .', typecheck: 'tsc --noEmit', dev: 'vite', start: 'node s.js' } }));
  put(r, 'package-lock.json', '{}');
  put(r, 'go.mod', 'module example.com/x\n\ngo 1.22\n');
  put(r, 'Cargo.toml', '[package]\nname = "x"\nversion = "0.1.0"\n');
  clearProjectCache(r);
  const checks = await detectChecks(r);
  const ids = checks.map((c) => c.id);
  for (const id of ['npm:test', 'npm:build', 'npm:lint', 'npm:typecheck', 'go:test', 'cargo:test']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.some((i) => /watch|dev|start/.test(i)));
  assert.deepEqual(checks.find((c) => c.id === 'npm:test').command, ['npm', 'run', 'test']);
  assert.equal(checks.find((c) => c.id === 'npm:test').source, 'package.json#scripts.test');
  assert.equal(checks[0].kind, 'test');
  assert.equal(kindOfScript('pretest'), null);
  assert.equal(kindOfScript('type-check'), 'typecheck');
});

test('runs: stored newest first, limit, masked log, invalid ids rejected', async () => {
  const r = tmp();
  const a = await saveRun(r, { check: 'npm:test', kind: 'test', command: 'npm run test', startedAt: 1000, endedAt: 2000, exitCode: 0, passed: 3 }, 'all good');
  const b = await saveRun(r, { check: 'npm:test', kind: 'test', command: 'npm run test', startedAt: 3000, endedAt: 4000, exitCode: 1, failed: 1, failures: [{ name: 't', file: path.join(r, 'src/x.js'), line: 2, message: `token ${FAKE_GH}` }] }, `leaked ${FAKE_GH}\n`);
  const list = await listRuns(r);
  assert.deepEqual(list.map((x) => x.id), [b.id, a.id]);
  assert.equal((await listRuns(r, { limit: 1 })).length, 1);
  assert.equal(list[0].failures[0].file, 'src/x.js');
  assert.ok(!JSON.stringify(list).includes(FAKE_GH));
  const one = await getRun(r, b.id);
  assert.ok(one.log.includes('leaked'));
  assert.ok(!one.log.includes(FAKE_GH));
  assert.equal(await getRun(r, '../etc/passwd'), null);
  assert.deepEqual(await listRuns(tmp()), []);
});

test('ship.verify.run: commands only from detection, results stored, failures fail the job', async () => {
  const r = tmp();
  put(r, 'package.json', JSON.stringify({ name: 'p', scripts: { test: 'node --test', build: 'vite build' } }));
  clearProjectCache(r);
  const defs = new Map();
  registerShip({ register: (d) => defs.set(d.id, d) }, { root: r, broadcast: () => {} });
  const run = defs.get('ship.verify.run');
  assert.equal(run.level, 'exec');
  assert.equal(defs.get('ship.criterion.set').level, 'state');
  assert.equal(await run.available(), true);
  const job = fakeJob({ 'npm run test': { code: 1, stdout: NODE_TAP.replace('/work/proj', r), stderr: '' } });
  await assert.rejects(run.run({ checks: ['npm:test', 'npm:build'] }, {}, job), /1 of 2 checks failed: npm:test/);
  assert.deepEqual(job.calls.map((c) => [c[0], ...c[1]]), [['npm', 'run', 'test'], ['npm', 'run', 'build']]);
  assert.equal(job.calls[0][2].env.CI, '1');
  const runs = await listRuns(r);
  assert.equal(runs.length, 2, 'runs are stored before the job fails');
  const t = runs.find((x) => x.check === 'npm:test');
  assert.deepEqual([t.passed, t.failed, t.failures[0].file], [2, 1, 'test/a.test.mjs']);
  await assert.rejects(run.run({ checks: ['npm:deploy'] }, {}, fakeJob()), /unknown check/);
  const prev = await run.preview({ checks: [] });
  assert.deepEqual(prev.commands, [['npm', 'run', 'test'], ['npm', 'run', 'build']]);
  const ok = await runChecks(r, [{ id: 'npm:build', kind: 'build', label: 'b', command: ['npm', 'run', 'build'], source: 'x' }], fakeJob());
  assert.equal(ok[0].exitCode, 0);
});

// ---------------------------------------------------------------- scope
test('extractCriteria: checklist items and a Criteria: block in the description', () => {
  const c = extractCriteria({ id: 'n1', checklist: [{ text: 'Login form validates email', done: true }, { text: 'Logout clears session', done: false }],
    description: 'Some context.\nAcceptance criteria:\n- Rate limit after 5 attempts\n- [x] Audit log entry written\n\nNotes: later' });
  assert.deepEqual(c.map((x) => [x.text, x.done, x.source]), [
    ['Login form validates email', true, 'checklist'], ['Logout clears session', false, 'checklist'],
    ['Rate limit after 5 attempts', null, 'description'], ['Audit log entry written', true, 'description'],
  ]);
  assert.equal(c[0].id, criterionId('n1', 'login form validates email'));
  assert.ok(matches(keywords('Login form validates email'), 'validates the email field on the login form'));
  assert.ok(!matches(keywords('Login form validates email'), 'logout clears cookies'));
});

test('taskScope(root, id): statuses from runs, commits, overrides; works without a server store', async () => {
  const r = repo();
  put(r, 'src/auth.js', 'export const login = () => 1;\n');
  put(r, 'TASKS.md', '# Tasks\n\n- [/] Build login\n  - [x] Login form validates email\n  - [x] Logout clears session\n  - [ ] Password reset email\n  - [x] Remember me cookie\n  - [x] Lockout after failed attempts `src/auth.js`\n');
  commit(r, 'init');
  const tasks = await allScope(r);
  assert.equal(tasks.tasks.length, 1);
  const id = tasks.tasks[0].id;
  put(r, 'src/auth.js', 'export const login = () => 2;\n');
  commit(r, `feat: lockout after failed attempts (${id})`);
  await saveRun(r, { check: 'npm:test', kind: 'test', command: 'npm run test', startedAt: Date.now(), endedAt: Date.now(), exitCode: 1, passed: 1, failed: 1,
    tests: [{ name: 'login form validates the email', status: 'passed' }, { name: 'logout clears the session', status: 'failed' }],
    failures: [{ name: 'logout clears the session', file: 'test/auth.test.js', line: 4, message: 'expected null' }] });
  const s = await taskScope(r, id);
  assert.equal(s.task.id, id);
  const by = Object.fromEntries(s.criteria.map((c) => [c.text.replace(/ `.*`/, ''), c]));
  assert.equal(by['Login form validates email'].status, 'verified');
  assert.equal(by['Logout clears session'].status, 'failed');
  assert.equal(by['Password reset email'].status, 'incomplete');
  assert.equal(by['Remember me cookie'].status, 'untested');
  const lock = by['Lockout after failed attempts'];
  assert.equal(lock.status, 'untested');
  assert.ok(lock.evidence.some((e) => e.kind === 'commit'));
  assert.ok(lock.evidence.some((e) => e.kind === 'file' && e.ref === 'src/auth.js'));
  assert.ok(by['Login form validates email'].evidence.some((e) => e.kind === 'test'));
  assert.deepEqual(s.summary, { criteria: 5, verified: 1, incomplete: 1, untested: 2, failed: 1 });
  setOverride(r, { task: id, criterion: by['Remember me cookie'].id, status: 'verified', note: 'checked by hand' });
  const s2 = await taskScope(r, id);
  const rem = s2.criteria.find((c) => c.text === 'Remember me cookie');
  assert.equal(rem.status, 'verified');
  assert.equal(rem.auto, false);
  assert.equal(rem.evidence[0].kind, 'manual');
  setOverride(r, { task: id, criterion: rem.id, status: 'auto' });
  assert.equal((await taskScope(r, id)).criteria.find((c) => c.text === 'Remember me cookie').status, 'untested');
  assert.throws(() => setOverride(r, { task: id, criterion: rem.id, status: 'done' }), /invalid status/);
  assert.equal(await taskScope(r, 'nope'), null);
});

// ---------------------------------------------------------------- readiness + placeholders
function readinessFixture() {
  const r = repo();
  put(r, 'package.json', JSON.stringify({ name: 'app', dependencies: { express: '^4.0.0' }, scripts: { test: 'node --test' } }));
  put(r, '.env', `APP_DEBUG=true\nAWS_KEY=${FAKE_AWS}\n`);
  put(r, '.env.example', 'DATABASE_URL=\n');
  put(r, 'src/server.js', [
    "const app = require('express')();",
    "app.use(cors());",
    "const db = process.env.DATABASE_URL;",
    "const key = process.env.STRIPE_KEY;",
    "const admin = { user: 'admin', password: 'admin' };",
    `const aws = '${FAKE_AWS}';`,
    '// TODO before release: remove the debug route',
    "process.env.NODE_ENV = 'development';",
  ].join('\n'));
  put(r, 'database/migrations/2024_01_01_000000_create_users_table.php', "<?php Schema::create('users', fn () => 1);\n");
  commit(r, 'init');
  put(r, 'database/migrations/2024_01_01_000000_create_users_table.php', "<?php Schema::create('users', fn () => 2);\n");
  put(r, 'database/migrations/2024_02_01_000000_add_flag.php', "<?php Schema::table('users', fn () => 1);\n");
  return r;
}

test('readiness: blockers with why/fix/location, secrets never echoed', async () => {
  const r = readinessFixture();
  clearProjectCache(r); _clearScanCache();
  const out = await readiness(r);
  assert.equal(out.ready, false);
  const rules = (rule) => out.findings.filter((f) => f.rule === rule);
  assert.ok(rules('env-committed').some((f) => f.location.path === '.env' && f.severity === 'high'));
  assert.ok(rules('debug-flag').some((f) => f.location.path === '.env'));
  assert.ok(rules('secret').some((f) => f.location.path === 'src/server.js' && f.location.line === 6 && /AWS access key/.test(f.title)));
  assert.ok(rules('cors-any').length);
  assert.ok(rules('default-credential').some((f) => f.location.line === 5));
  assert.ok(rules('release-todo').some((f) => f.location.line === 7));
  assert.ok(rules('node-env').length);
  assert.ok(rules('env-undocumented').some((f) => /STRIPE_KEY/.test(f.title)));
  assert.ok(!rules('env-undocumented').some((f) => /DATABASE_URL/.test(f.title)));
  assert.ok(rules('lockfile-missing').length);
  assert.ok(rules('start-missing').length);
  assert.ok(rules('migration-edited').some((f) => f.severity === 'high'));
  assert.ok(rules('migration-pending').some((f) => /add_flag/.test(f.location.path)));
  for (const f of out.findings) for (const k of ['id', 'severity', 'category', 'title', 'why', 'fix', 'location']) assert.ok(f[k] !== undefined, `${f.rule} lacks ${k}`);
  assert.equal(out.blockers, out.counts.high);
  const json = JSON.stringify(out);
  assert.ok(!json.includes(FAKE_AWS) && !json.includes(FAKE_AWS.slice(4)), 'secret value echoed');
  assert.ok(!/password[^"]*admin'/.test(json));
});

test('placeholders: fake functionality in app code, not in tests, mocks or node_modules', async () => {
  const r = tmp();
  const bad = [
    'export function Toolbar() {',
    '  return <div><button onClick={() => {}}>Save</button>',
    '  <button onClick={() => console.log("clicked")}>Share</button>',
    '  <a href="#">Docs</a></div>;',
    '}',
    "export const exportCsv = () => alert('Coming soon');",
    "export function sync() { throw new Error('Not implemented'); }",
    "export const load = () => fetch('https://api.example.com/users');",
    'export const blurb = "Lorem ipsum dolor sit amet";',
    'export function isAuthenticated(req) {',
    '  return true;',
    '}',
    "export const check = (u, password) => password === 'hunter2';",
    'const mockUsers = [{ id: 1 }];',
  ].join('\n');
  put(r, 'src/Toolbar.jsx', bad);
  put(r, 'src/Toolbar.test.jsx', bad);
  put(r, 'src/__mocks__/api.js', bad);
  put(r, 'node_modules/lib/index.jsx', bad);
  put(r, 'src/ok.js', "// ship-ignore\nexport const x = () => alert('TODO later');\n");
  _clearScanCache();
  const out = await placeholders(r);
  const rules = new Set(out.findings.map((f) => f.rule));
  for (const rule of ['empty-handler', 'log-handler', 'dead-link', 'alert-todo', 'not-implemented', 'fake-api', 'lorem', 'mock-auth', 'demo-data']) assert.ok(rules.has(rule), rule);
  assert.ok(out.findings.every((f) => f.location.path === 'src/Toolbar.jsx'), JSON.stringify(out.findings.map((f) => f.location.path)));
  assert.ok(out.findings.every((f) => f.category === 'placeholder' && f.why && f.fix));
  assert.equal(out.findings.filter((f) => f.rule === 'mock-auth').length, 2);
  assert.ok(isTestLike('ui/src/mock-ship.js') && isTestLike('tests/a.py') && !isTestLike('src/app.js'));
  assert.ok(!scannable('vendor/x/y.php') && !scannable('dist/app.js') && scannable('src/a.ts') && scannable('.env.production'));
  assert.equal(scanFile('src/a.js', 'const t = { token: userToken };\n').readiness.length, 0, 'identifier values are not secrets');
});

test('scanners stay fast on a repo-sized tree and skip dependency folders', async () => {
  const r = tmp();
  const junk = "export const x = () => alert('TODO'); // TODO before release\nconst p = { password: 'admin' };\n";
  for (let i = 0; i < 10000; i++) put(r, `node_modules/pkg${i % 400}/f${i}.js`, junk);
  for (let i = 0; i < 6000; i++) put(r, `vendor/v${i % 200}/f${i}.php`, junk);
  for (let i = 0; i < 4000; i++) put(r, `dist/assets/c${i}.js`, junk);
  // Windows runners create and open many small files much more slowly than Linux; fewer source files there keep the
  // test about skipping dependency folders and the per-file cache rather than about the runner's disk (Linux: ~1.3 s for 2500).
  const SRC = process.platform === 'win32' ? 1000 : 2500;
  for (let i = 0; i < SRC; i++) put(r, `src/mod${i % 50}/file${i}.js`, `export function f${i}(a) { return a + ${i}; }\n`.repeat(20));
  put(r, 'src/bad.js', junk);
  _clearScanCache();
  const t0 = Date.now();
  const [ready, ph] = await Promise.all([readiness(r), placeholders(r)]);
  const ms = Date.now() - t0;
  assert.ok(ms < 6000, `scan took ${ms} ms`);
  const paths = new Set([...ready.findings, ...ph.findings].map((f) => f.location.path).filter(Boolean));
  assert.deepEqual([...paths].filter((p) => /node_modules|vendor|dist/.test(p)), []);
  assert.ok(paths.has('src/bad.js'));
  assert.equal(ready.scanned.files, SRC + 1);
  const t1 = Date.now();
  await readiness(r, { fresh: true });
  assert.ok(Date.now() - t1 < 3000, 'second scan reuses the per-file cache');
});

// ---------------------------------------------------------------- report + verdict
test('verdictOf: failing > unverified > partial > verified', () => {
  const chk = (status, stale = false) => ({ id: 'x', label: 'npm run test', kind: 'test', status, stale, last: status === 'never' ? null : { passed: 3, failed: status === 'failed' ? 1 : 0 } });
  const crit = (status) => ({ status });
  assert.equal(verdictOf([], []).verdict, 'unverified');
  assert.equal(verdictOf([chk('never')], []).verdict, 'unverified');
  assert.equal(verdictOf([chk('failed')], [crit('verified')]).verdict, 'failing');
  assert.equal(verdictOf([chk('passed')], [crit('failed')]).verdict, 'failing');
  assert.equal(verdictOf([chk('passed'), chk('never')], []).verdict, 'partial');
  assert.equal(verdictOf([chk('passed', true)], []).verdict, 'partial');
  assert.equal(verdictOf([chk('passed')], [crit('verified'), crit('untested')]).verdict, 'partial');
  const v = verdictOf([chk('passed')], [crit('verified')]);
  assert.equal(v.verdict, 'verified');
  assert.ok(v.reasons.some((x) => x.level === 'ok'));
});

test('completionReport: changed files with +/-, last runs, stale runs, failures, base ref', async () => {
  const r = repo();
  put(r, 'package.json', JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  put(r, 'src/a.js', 'a\nb\n');
  commit(r, 'init');
  sh(r, 'tag', 'v1');
  put(r, 'src/b.js', 'x\n');
  commit(r, 'feat: b');
  put(r, 'src/a.js', 'a\nB\nc\n');
  put(r, 'src/new.js', '1\n2\n3\n');
  clearProjectCache(r);
  let rep = await completionReport(r);
  assert.equal(rep.verdict, 'unverified');
  assert.deepEqual(rep.changedFiles.map((f) => [f.path, f.status, f.added, f.removed]), [['src/a.js', 'M', 2, 1], ['src/new.js', '?', 3, 0]]);
  assert.deepEqual(rep.totals, { files: 2, added: 5, removed: 1 });
  await saveRun(r, { check: 'npm:test', kind: 'test', command: 'npm run test', startedAt: Date.now() + 1000, endedAt: Date.now() + 2000, exitCode: 0, passed: 4 });
  rep = await completionReport(r);
  assert.equal(rep.verdict, 'verified');
  assert.equal(rep.checks[0].status, 'passed');
  await saveRun(r, { check: 'npm:test', kind: 'test', command: 'npm run test', startedAt: Date.now() + 3000, endedAt: Date.now() + 4000, exitCode: 1, passed: 3, failed: 1, failures: [{ name: 'adds', file: 'src/a.js', line: 2, message: 'boom' }] });
  rep = await completionReport(r);
  assert.equal(rep.verdict, 'failing');
  assert.deepEqual(rep.failures.map((f) => [f.check, f.file, f.line]), [['npm:test', 'src/a.js', 2]]);
  // a run older than the newest change is stale
  await saveRun(r, { check: 'npm:test', kind: 'test', command: 'npm run test', startedAt: 1000, endedAt: 2000, exitCode: 0, passed: 4 });
  const fresh = await completionReport(r);
  assert.ok(['partial', 'failing'].includes(fresh.verdict));
  const withBase = await completionReport(r, { base: 'v1' });
  assert.ok(withBase.changedFiles.some((f) => f.path === 'src/b.js'));
  assert.ok(withBase.evidence.some((e) => e.kind === 'commit' && /feat: b/.test(e.label)));
  const badBase = await completionReport(r, { base: 'nope-ref' });
  assert.match(badBase.git.error, /unknown base/);
  const sum = await shipSummary(r);
  for (const k of ['verdict', 'readiness', 'placeholders', 'lastRuns', 'scope']) assert.ok(k in sum, k);
  // no git at all: still answers
  const plain = tmp();
  const np = await completionReport(plain);
  assert.equal(np.git.available, false);
  assert.equal(np.verdict, 'unverified');
});

// ---------------------------------------------------------------- MCP + CLI
test('MCP tools: names, read-only report, task scope, input validation', async () => {
  assert.deepEqual(TOOL_DEFS.map((t) => t.name), ['get_ship_report', 'get_task_scope']);
  const r = repo();
  put(r, 'TASKS.md', '- [ ] Export invoices\n  - [ ] CSV download works\n');
  put(r, 'package.json', JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  commit(r, 'init');
  clearProjectCache(r);
  const tools = makeTools({ root: r, config: {}, store: null });
  const rep = await tools.get_ship_report({});
  assert.equal(rep.verdict, 'unverified');
  assert.ok(rep.readiness && rep.placeholders && Array.isArray(rep.checks));
  assert.equal(rep.criteriaSummary.incomplete, 1);
  assert.deepEqual(await listRuns(r), [], 'the MCP report never runs checks');
  await assert.rejects(tools.get_ship_report({ base: '--output=/tmp/x' }), /base must be/);
  const all = await tools.get_task_scope({});
  assert.equal(all.tasks.length, 1);
  const one = await tools.get_task_scope({ task: all.tasks[0].id });
  assert.equal(one.criteria[0].status, 'incomplete');
  await assert.rejects(tools.get_task_scope({ task: 'missing' }), /not found/);
});

test('CLI: static report, --json, --fail-on thresholds, bad flags', async () => {
  const r = repo();
  put(r, 'src/app.js', "export const go = () => fetch('https://api.example.com/x');\n");
  commit(r, 'init');
  clearProjectCache(r); _clearScanCache();
  const lines = [];
  const log = { log: (s) => lines.push(s), error: (s) => lines.push(s) };
  assert.equal(await cmdShip(r, {}, log), 0, 'only a medium placeholder: passes the default high threshold');
  assert.ok(lines.join('\n').includes('Ship check: UNVERIFIED'));
  assert.equal(await cmdShip(r, { 'fail-on': 'medium' }, log), 1);
  lines.length = 0;
  assert.equal(await cmdShip(r, { json: true, 'fail-on': 'low' }, log), 1);
  const j = JSON.parse(lines.join('\n'));
  assert.equal(j.schema, 'agentneuron.ship/v1');
  assert.equal(j.placeholders.findings[0].rule, 'fake-api');
  assert.equal(await cmdShip(r, { 'fail-on': 'urgent' }, log), 2);
  assert.equal(await cmdShip(r, { base: '--evil' }, log), 2);
});
