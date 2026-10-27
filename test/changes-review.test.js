// Review guardian (#6) and impact analyzer (#3) on synthetic diffs and temp repos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyFile, reviewChanges, reviewMarkdown } from '../src/changes/review.js';
import { analyzeImpact, parseSymbols } from '../src/changes/impact.js';
import { parseRange } from '../src/changes/diff.js';
import { fileKind, sensitiveAreas } from '../src/changes/classify.js';

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-rv-')));
const w = (d, f, c) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); };
const hunk = (lines, oldStart = 10, newStart = 10) => ({ oldStart, newStart, oldLines: 0, newLines: 0, lines });
const file = (p, lines, extra = {}) => ({ path: p, status: 'M', added: lines.filter((l) => l[0] === '+').length, removed: lines.filter((l) => l[0] === '-').length, hunks: [hunk(lines)], ...extra });
const codes = (c) => c.reasons.map((r) => r.code);

test('classify: removed authorization checks are high risk, moved lines are not', () => {
  const c = classifyFile(file('app/Http/Controllers/PostController.php', [' public function destroy(Post $post) {', '-    $this->authorize(\'delete\', $post);', '     $post->delete();']));
  assert.equal(c.risk, 'high');
  assert.ok(codes(c).includes('removed-check'));
  const r = c.reasons.find((x) => x.code === 'removed-check');
  assert.equal(r.line, 11); assert.equal(r.side, 'old');
  assert.equal(c.hunks[0].risk, 'high');
  const moved = classifyFile(file('src/x.js', ['-  if (!user) return deny();', '+  if (!user) return deny();']));
  assert.ok(!codes(moved).includes('removed-check'));
  const mw = classifyFile(file('routes/web.php', ["-Route::get('/admin', [AdminController::class, 'index'])->middleware('auth');", "+Route::get('/admin', [AdminController::class, 'index']);"]));
  assert.equal(mw.risk, 'high');
  const csrf = classifyFile(file('resources/views/form.blade.php', ['-    @csrf']));
  assert.ok(codes(csrf).includes('removed-check'));
});

test('classify: widened permissions, CORS, skipped tests, secrets, generated, env files', () => {
  assert.equal(classifyFile(file('src/server.js', ["+app.use(cors({ origin: '*' }));"])).risk, 'medium');
  assert.equal(classifyFile(file('src/tls.js', ['+  rejectUnauthorized: false,'])).risk, 'high');
  const skip = classifyFile(file('test/cart.test.js', ["+test.skip('totals', () => {"]));
  assert.ok(codes(skip).includes('disabled-test')); assert.equal(skip.risk, 'high');
  assert.ok(!codes(classifyFile(file('src/cart.js', ["+const x = list.skip(2);"]))).includes('disabled-test'), 'only in test files');
  assert.ok(codes(classifyFile(file('test/a.spec.ts', ["+describe.only('x', () => {"]))).includes('focused-test'));
  const key = 'sk_live_' + 'abcdefghijklmnop1234567890';
  const sec = classifyFile(file('src/pay.js', [`+const stripeKey = "${key}";`]));
  assert.ok(codes(sec).includes('secret-added'));
  assert.equal(sec.risk, 'high');
  assert.ok(!JSON.stringify(sec).includes(key), 'secret value never echoed');
  assert.ok(!JSON.stringify(sec).includes('const stripeKey'), 'no source line quoted');
  assert.ok(codes(classifyFile({ path: 'test/old.test.js', status: 'D', added: 0, removed: 20, hunks: [] })).includes('deleted-test'));
  assert.ok(codes(classifyFile(file('dist/bundle.min.js', ['+x']))).includes('generated-blob'));
  assert.equal(classifyFile(file('.env.production', ['+DB_HOST=x'])).risk, 'high');
  assert.ok(codes(classifyFile(file('src/a.js', ['+el.innerHTML = html;']))).includes('risky-api'));
  assert.equal(classifyFile(file('src/util/format.js', ['+export const x = 1;'])).risk, 'low');
});

test('classify paths: kinds and sensitive areas', () => {
  assert.equal(fileKind('package.json'), 'deps');
  assert.equal(fileKind('pnpm-lock.yaml'), 'deps');
  assert.equal(fileKind('src/__tests__/a.ts'), 'tests');
  assert.equal(fileKind('tests/test_api.py'), 'tests');
  assert.equal(fileKind('docs/guide.md'), 'docs');
  assert.equal(fileKind('.github/workflows/ci.yml'), 'config');
  assert.equal(fileKind('src/lib/auth.ts'), 'source');
  const a = (p) => sensitiveAreas(p).map((x) => x.area);
  assert.ok(a('src/auth/session.ts').includes('auth'));
  assert.ok(a('app/Policies/PostPolicy.php').includes('permissions'));
  assert.ok(a('src/billing/stripeWebhook.ts').includes('payments'));
  assert.ok(a('database/migrations/2024_01_01_create_users.php').includes('migrations'));
  assert.ok(a('.github/workflows/deploy.yml').includes('infra'));
  assert.ok(a('Dockerfile').includes('infra'));
  assert.deepEqual(a('src/components/Button.svelte'), []);
});

test('parseRange validates revisions', () => {
  assert.deepEqual(parseRange('main..feature'), { base: 'main', head: 'feature' });
  assert.deepEqual(parseRange('HEAD~2', undefined), { base: 'HEAD~2', head: null });
  assert.throws(() => parseRange('--output=/tmp/x'), /invalid revision/);
  assert.throws(() => parseRange('a;rm'), /invalid revision/);
});

function project() {
  const d = tmp();
  sh(d, 'init', '-q', '-b', 'main'); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t'); sh(d, 'config', 'core.autocrlf', 'false');
  w(d, 'src/util.js', 'export function formatPrice(n) {\n  return `$${n}`;\n}\n\nexport function slugify(s) {\n  return s.toLowerCase();\n}\n');
  w(d, 'src/cart.js', "import { formatPrice } from './util.js';\nexport function total(items) {\n  return formatPrice(items.length);\n}\n");
  w(d, 'src/api.js', "import { total } from './cart.js';\nimport express from 'express';\nconst app = express();\napp.get('/api/cart', (req, res) => res.json(total([])));\n");
  w(d, 'src/pricing.js', "const { formatPrice } = require('./util');\napp.post('/api/price', (req, res) => res.send(formatPrice(1)));\n");
  w(d, 'src/other.js', '// mentions formatPrice in a comment only\nexport const y = 2;\n');
  w(d, 'test/util.test.js', "import { formatPrice } from '../src/util.js';\ntest('fmt', () => formatPrice(1));\n");
  w(d, 'src/auth/session.js', 'export function requireUser(req) {\n  if (!req.user) throw new Error("no");\n  return req.user;\n}\n');
  w(d, 'openapi.yaml', 'paths:\n  /api/price:\n    post: {}\n');
  w(d, 'app/models.py', 'class Order:\n    def total(self):\n        return 1\n\ndef helper():\n    pass\n');
  w(d, 'app/views.py', 'from app.models import Order\n\n@app.route("/orders")\ndef orders():\n    return Order().total()\n');
  sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'init');
  return d;
}

test('reviewChanges: working tree vs HEAD incl. untracked, groups, missing tests, read-first', async () => {
  const d = project();
  w(d, 'src/util.js', 'export function formatPrice(n) {\n  return `USD ${n}`;\n}\n\nexport function slugify(s) {\n  return s.toLowerCase();\n}\n');
  w(d, 'src/auth/session.js', 'export function requireUser(req) {\n  return req.user;\n}\n');
  w(d, 'src/newfeature.js', 'export function brandNew() {\n  return 1;\n}\n');
  w(d, 'package.json', '{"dependencies":{"express":"^4"}}\n');
  const r = await reviewChanges(d);
  assert.equal(r.available, true);
  assert.equal(r.base, 'HEAD');
  const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
  assert.equal(by['src/auth/session.js'].risk, 'high');
  assert.ok(by['src/auth/session.js'].reasons.some((x) => x.code === 'removed-check'));
  assert.equal(by['src/newfeature.js'].untracked, true);
  assert.equal(by['src/newfeature.js'].missingTest, true);
  assert.equal(by['src/newfeature.js'].group, 'feature');
  assert.deepEqual(by['src/util.js'].tests, ['test/util.test.js']);
  assert.equal(by['src/util.js'].missingTest, false);
  assert.ok(by['src/util.js'].reasons.some((x) => x.code === 'tests-not-updated'));
  assert.equal(r.readFirst[0], 'src/auth/session.js');
  const kinds = r.groups.map((g) => g.kind);
  assert.ok(kinds.includes('deps') && kinds.includes('feature'));
  assert.equal(r.summary.files, 4);
  assert.equal(r.summary.high, 1);
  assert.equal(r.summary.missingTests, 1); // session.js only lost lines
  for (const k of ['files', 'added', 'removed', 'high', 'medium', 'low', 'missingTests']) assert.equal(typeof r.summary[k], 'number');
  assert.match(reviewMarkdown(r), /Read these first/);
  // nothing in the output quotes the changed source lines
  assert.ok(!JSON.stringify(r).includes('req.user;'));
});

test('reviewChanges: base..head range, bad revisions, no git', async () => {
  const d = project();
  sh(d, 'checkout', '-q', '-b', 'feat');
  w(d, 'test/util.test.js', "test.skip('fmt', () => {});\n");
  sh(d, 'commit', '-qam', 'skip');
  w(d, 'uncommitted.js', 'x\n'); // not part of a range review
  const r = await reviewChanges(d, { base: 'main', head: 'feat' });
  assert.deepEqual(r.files.map((f) => f.path), ['test/util.test.js']);
  assert.equal(r.files[0].risk, 'high');
  const r2 = await reviewChanges(d, { base: 'main..feat' });
  assert.equal(r2.files.length, 1);
  await assert.rejects(reviewChanges(d, { base: '--exec=x' }), /invalid revision/);
  await assert.rejects(reviewChanges(d, { base: 'nope' }), /unknown revision/);
  const none = await reviewChanges(tmp());
  assert.equal(none.available, false);
});

test('reviewChanges: repo without commits diffs against the empty tree', async () => {
  const d = tmp();
  sh(d, 'init', '-q', '-b', 'main');
  w(d, 'a.js', 'export const a = 1;\n');
  const r = await reviewChanges(d);
  assert.equal(r.available, true);
  assert.equal(r.base, null);
  assert.deepEqual(r.files.map((f) => f.path), ['a.js']);
});

test('parseSymbols: JS, PHP, Python, Go', () => {
  const js = parseSymbols('js', 'export async function a() {}\nexport class B {}\nconst c = (x) => x;\nexport type D = string;\nfunction e() {}\nexport { e };\n');
  assert.deepEqual(js.map((s) => [s.name, s.kind, s.exported]), [['a', 'function', true], ['B', 'class', true], ['c', 'function', false], ['D', 'type', true], ['e', 'function', true]]);
  const php = parseSymbols('php', '<?php\nfinal class UserController extends Controller\n{\n    public function index() {}\n    private static function helper() {}\n}\n');
  assert.deepEqual(php.map((s) => s.name), ['UserController', 'index', 'helper']);
  assert.deepEqual(parseSymbols('py', 'class A:\n    def m(self):\n        pass\nasync def f():\n    pass\n').map((s) => s.name), ['A', 'm', 'f']);
  const go = parseSymbols('go', 'func (s *Server) Start() error {\n}\nfunc helper() {}\ntype Config struct{}\n');
  assert.deepEqual(go.map((s) => [s.name, s.exported]), [['Start', true], ['helper', false], ['Config', true]]);
});

test('analyzeImpact: changed symbol -> importers, callers, routes, tests, contracts', async () => {
  const d = project();
  w(d, 'src/util.js', 'export function formatPrice(n) {\n  return `USD ${n}`;\n}\n\nexport function slugify(s) {\n  return s.toLowerCase();\n}\n');
  const r = await analyzeImpact(d);
  assert.equal(r.available, true);
  assert.deepEqual(r.changed.map((c) => c.path), ['src/util.js']);
  assert.deepEqual(r.changed[0].symbols.map((s) => s.name), ['formatPrice'], 'only the enclosing symbol of the changed lines');
  const aff = Object.fromEntries(r.affected.map((a) => [`${a.kind}:${a.label}`, a]));
  assert.equal(aff['file:src/cart.js'].confidence, 'high');
  assert.equal(aff['file:src/pricing.js'].confidence, 'high', 'require() with an extension-less path resolves');
  assert.equal(aff['test:test/util.test.js'].confidence, 'high');
  assert.equal(aff['file:src/api.js'].confidence, 'low', 'transitive importer');
  assert.equal(aff['route:POST /api/price'].confidence, 'medium');
  assert.equal(aff['file:src/other.js'].confidence, 'low', 'name match without import');
  assert.equal(aff['contract:openapi.yaml'].confidence, 'medium');
  const kinds = new Set(r.nodes.map((n) => n.kind));
  for (const k of ['file', 'symbol', 'route', 'test', 'contract']) assert.ok(kinds.has(k), k);
  const ids = new Set(r.nodes.map((n) => n.id));
  for (const e of r.edges) assert.ok(ids.has(e.from) && ids.has(e.to), 'edges reference existing nodes');
  assert.ok(r.edges.some((e) => e.kind === 'calls' && e.from === 'file:src/cart.js' && e.to === 'sym:src/util.js#formatPrice'));
  assert.ok(r.edges.some((e) => e.kind === 'serves'));
  assert.ok(r.edges.some((e) => e.kind === 'covers'));
});

test('analyzeImpact: explicit paths, Python imports and routes, invalid input', async () => {
  const d = project();
  const r = await analyzeImpact(d, { paths: 'app/models.py' });
  const aff = r.affected.map((a) => `${a.kind}:${a.label}:${a.confidence}`);
  assert.ok(aff.includes('file:app/views.py:high'), aff.join(', '));
  assert.ok(aff.includes('route:ANY /orders:medium'), aff.join(', '));
  await assert.rejects(analyzeImpact(d, { paths: '../etc/passwd' }), /invalid path/);
  const empty = await analyzeImpact(d);
  assert.equal(empty.changed.length, 0);
  assert.deepEqual(empty.affected, []);
});
