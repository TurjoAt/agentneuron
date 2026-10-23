import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { detectProject, laravelRoutes, laravelMigrations, laravelModels, parseRoutesSource, docDrift, clearProjectCache } from '../src/project/index.js';
import { parseToml } from '../src/project/util.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'mdctl-proj-')); }
function put(root, files) {
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), typeof c === 'string' ? c : JSON.stringify(c));
  }
}
const ids = (p) => p.stacks.map((s) => s.id);

test('node: next + tailwind + ts + pnpm, scripts, ci, docker, env', async () => {
  const r = tmp();
  put(r, {
    'package.json': { name: 'web', version: '1.2.3', engines: { node: '>=20' }, scripts: { dev: 'next dev', build: 'next build' },
      dependencies: { next: '^14.2.1', react: '18.3.0' }, devDependencies: { tailwindcss: '^3.4.0', typescript: '^5.4.0', vitest: '^1.0.0', husky: '^9.0.0' } },
    'pnpm-lock.yaml': 'lockfileVersion: 9',
    'app/page.tsx': 'export default function P(){return null}\n',
    'tsconfig.json': '{}', '.eslintrc.json': '{}', '.editorconfig': 'root=true',
    '.github/workflows/ci.yml': 'name: CI\non:\n  push:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n  lint:\n    runs-on: ubuntu-latest\n',
    'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n    ports:\n      - "5432:5432"\n  web:\n    build: .\n',
    '.env.example': 'A=1\nB=2\nC=\n', '.env': 'A=secretvalue\nD=x\n',
    'vercel.json': '{}',
    'CLAUDE.md': '# hi',
  });
  const p = await detectProject(r);
  assert.equal(p.name, 'web'); assert.equal(p.version, '1.2.3');
  for (const id of ['next', 'react', 'tailwind', 'typescript', 'vitest', 'husky', 'eslint', 'editorconfig', 'vercel', 'docker', 'docker-compose', 'github-actions', 'node', 'pnpm', 'ai-tools']) assert.ok(ids(p).includes(id), id);
  assert.equal(p.stacks.find((s) => s.id === 'next').version, '14.2.1');
  assert.equal(p.packageManagers[0].id, 'pnpm');
  assert.deepEqual(p.scripts.map((s) => s.name).sort(), ['build', 'dev']);
  assert.equal(p.scripts[0].manager, 'pnpm');
  assert.equal(p.framework.next.router, 'app');
  assert.deepEqual(p.ci[0].triggers, ['push', 'pull_request']); assert.deepEqual(p.ci[0].jobs, ['test', 'lint']);
  assert.deepEqual(p.docker.services.map((s) => s.name), ['db', 'web']);
  assert.deepEqual(p.docker.services[0].ports, ['5432:5432']);
  assert.deepEqual(p.env.missing, ['B', 'C']); assert.deepEqual(p.env.extra, ['D']);
  assert.ok(!JSON.stringify(p.env).includes('secretvalue'));
  assert.ok(p.dotfolders.some((d) => d.name === '.github' && d.files.includes('workflows/ci.yml')));
  assert.ok(p.stats.languages.find((l) => l.lang === 'TypeScript'));
  assert.equal(p.manifests[0].deps.find((d) => d.name === 'vitest').dev, true);
});

test('composer: laravel version from lock, phpunit, routes/migrations/models', async () => {
  const r = tmp();
  put(r, {
    'composer.json': { name: 'acme/app', require: { php: '^8.3', 'laravel/framework': '^11.0' }, 'require-dev': { 'phpunit/phpunit': '^11' }, scripts: { test: ['@php artisan test', 'echo ok'] } },
    'composer.lock': { packages: [{ name: 'laravel/framework', version: 'v11.9.2' }], 'packages-dev': [] },
    artisan: '#!/usr/bin/env php', 'bootstrap/app.php': '<?php',
    'app/Providers/AppServiceProvider.php': '<?php',
    'app/Models/User.php': "<?php\nclass User extends Model { protected $table = 'users';\n public function posts() { return $this->hasMany(Post::class); } }",
    'database/migrations/2024_01_02_030405_create_posts_table.php': "<?php Schema::create('posts', function(){});",
    'database/migrations/2024_02_02_000000_add_x_to_posts.php': "<?php Schema::table('posts', function(){});",
    'routes/web.php': "<?php\nRoute::get('/', [HomeController::class, 'index'])->name('home');\n",
  });
  const p = await detectProject(r);
  assert.equal(p.stacks.find((s) => s.id === 'laravel').version, '11.9.2');
  assert.ok(ids(p).includes('phpunit') && ids(p).includes('php') && ids(p).includes('composer'));
  assert.deepEqual(p.framework.laravel, { version: '11.9.2', routes: 1, migrations: 2, models: 1, providers: 1 });
  assert.equal(p.scripts.find((s) => s.name === 'test').command, '@php artisan test && echo ok');
  const m = await laravelMigrations(r);
  assert.equal(m[0].table, 'posts'); assert.equal(m[0].op, 'create'); assert.equal(m[0].ts, '2024-01-02T03:04:05Z'); assert.equal(m[1].op, 'alter');
  const md = await laravelModels(r);
  assert.deepEqual(md[0].relations, [{ name: 'posts', type: 'hasMany' }]); assert.equal(md[0].table, 'users');
});

test('laravel routes parser: groups, prefix, name, middleware, resource, match, view', () => {
  const src = `<?php
use Illuminate\\Support\\Facades\\Route;
// Route::get('/commented', fn() => 1);
Route::get('/', [PageController::class, 'home'])->name('home');
Route::middleware(['auth', 'verified'])->prefix('admin')->name('admin.')->group(function () {
    Route::get('users', [UserController::class, 'index'])->name('users.index');
    Route::post('users', 'UserController@store');
    Route::controller(ReportController::class)->group(function () {
        Route::get('reports', 'index')->middleware('throttle:60,1')->name('reports');
    });
    Route::resource('photos', PhotoController::class)->only(['index', 'show']);
});
Route::group(['prefix' => 'api', 'middleware' => 'auth:sanctum'], function () {
    Route::apiResource('tags', TagController::class)->except(['destroy']);
});
Route::match(['get', 'post'], '/docs/{token}', [DocController::class, 'entry'])->name('docs');
Route::view('/about', 'about');
Route::any('/ping', fn () => 'pong');
Route::delete('/x/{id}', DestroyController::class);
`;
  const rs = parseRoutesSource(src, 'routes/web.php');
  const find = (m, u) => rs.find((r) => r.method === m && r.uri === u);
  assert.ok(!rs.some((r) => r.uri === '/commented'));
  assert.deepEqual(find('GET', '/'), { file: 'routes/web.php', line: 4, method: 'GET', uri: '/', action: 'PageController@home', name: 'home', middleware: [] });
  const u = find('GET', '/admin/users');
  assert.equal(u.name, 'admin.users.index'); assert.deepEqual(u.middleware, ['auth', 'verified']); assert.equal(u.action, 'UserController@index');
  assert.equal(find('POST', '/admin/users').action, 'UserController@store');
  const rep = find('GET', '/admin/reports');
  assert.equal(rep.action, 'ReportController@index'); assert.deepEqual(rep.middleware, ['auth', 'verified', 'throttle:60,1']); assert.equal(rep.name, 'admin.reports');
  assert.ok(find('GET', '/admin/photos') && find('GET', '/admin/photos/{photo}') && !find('POST', '/admin/photos'));
  assert.equal(find('GET', '/admin/photos/{photo}').name, 'admin.photos.show');
  assert.deepEqual(rs.filter((r) => r.uri.startsWith('/api/tags')).map((r) => r.action.split('@')[1]).sort(), ['index', 'show', 'store', 'update']);
  assert.deepEqual(find('GET', '/api/tags').middleware, ['auth:sanctum']);
  assert.ok(find('GET|POST', '/docs/{token}'));
  assert.equal(find('GET', '/about').action, 'view:about');
  assert.equal(find('ANY', '/ping').action, 'Closure');
  assert.equal(find('DELETE', '/x/{id}').action, 'DestroyController@__invoke');
});

test('other families: python, go, rust, ruby, java, dotnet, deno', async () => {
  const r = tmp();
  put(r, {
    'pyproject.toml': '[project]\nname = "svc"\nversion = "0.1.0"\nrequires-python = ">=3.11"\ndependencies = [\n  "fastapi>=0.110",\n  "uvicorn",\n]\n[tool.ruff]\nline-length = 100\n',
    'requirements-dev.txt': 'pytest==8.0.0\n# c\n',
    'go.mod': 'module example.com/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/text v0.1.0 // indirect\n)\n',
    'Cargo.toml': '[package]\nname = "crate"\nversion = "0.2.0"\n[dependencies]\naxum = "0.7"\nserde = { version = "1.0", features = ["derive"] }\n',
    Gemfile: "source 'https://rubygems.org'\nruby '3.3.0'\ngem 'rails', '~> 7.1'\ngem 'rspec-rails'\n",
    'Gemfile.lock': '    rails (7.1.3)\n',
    'pom.xml': '<project><parent><artifactId>spring-boot-starter-parent</artifactId><version>3.2.0</version></parent><artifactId>demo</artifactId><version>1.0</version><dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>1</version></dependency></dependencies></project>',
    'App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="Serilog" Version="3.1.0" /></ItemGroup></Project>',
    'deno.json': { tasks: { start: 'deno run main.ts' } },
  });
  const p = await detectProject(r);
  for (const id of ['python', 'fastapi', 'pytest', 'ruff', 'go', 'gin', 'rust', 'axum', 'ruby', 'rails', 'rspec', 'java', 'spring', 'dotnet', 'aspnet', 'deno']) assert.ok(ids(p).includes(id), id);
  assert.equal(p.stacks.find((s) => s.id === 'rails').version, '7.1.3');
  assert.equal(p.stacks.find((s) => s.id === 'go').version, '1.22');
  assert.equal(p.stacks.find((s) => s.id === 'spring').version, '3.2.0');
  const types = p.manifests.map((m) => m.type).sort();
  assert.deepEqual(types, ['cargo', 'deno', 'dotnet', 'go', 'maven', 'python', 'ruby']);
  assert.ok(p.packageManagers.some((m) => m.id === 'pip') && p.packageManagers.some((m) => m.id === 'cargo'));
  assert.ok(p.scripts.some((s) => s.manager === 'deno' && s.name === 'start'));
  assert.equal(p.manifests.find((m) => m.type === 'go').deps.find((d) => d.name.includes('text')).dev, true);
});

test('parseToml basics', () => {
  const t = parseToml('a = 1\n[x.y]\nk = "v" # c\narr = [\n "a",\n "b"\n]\n[[z]]\nn = 1\n[[z]]\nn = 2\n');
  assert.equal(t.a, 1); assert.equal(t.x.y.k, 'v'); assert.deepEqual(t.x.y.arr, ['a', 'b']); assert.equal(t.z.length, 2);
});

test('cache invalidates when a manifest changes; ignores node_modules', async () => {
  const r = tmp();
  put(r, { 'package.json': { name: 'a', dependencies: { express: '4.0.0' } }, 'node_modules/x/package.json': { name: 'x' } });
  const p1 = await detectProject(r);
  assert.equal(p1.manifests.length, 1);
  assert.strictEqual(await detectProject(r), p1);
  await new Promise((s) => setTimeout(s, 20));
  put(r, { 'package.json': { name: 'b' } });
  fs.utimesSync(path.join(r, 'package.json'), new Date(), new Date(Date.now() + 5000));
  const p2 = await detectProject(r);
  assert.equal(p2.name, 'b'); assert.ok(!ids(p2).includes('express'));
  clearProjectCache(r);
});

test('docDrift: doc mentioning code that changed after it', async () => {
  const r = tmp();
  const g = (...a) => execFileSync('git', a, { cwd: r, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  g('init', '-q');
  put(r, { 'src/a.js': 'a', 'src/b.js': 'b', 'docs/guide.md': 'See `src/a.js` and src/b.js and `src/missing.js`. https://x.io/src/a.js', 'docs/ok.md': 'Nothing here' });
  g('add', '.');
  execFileSync('git', ['commit', '-q', '-m', 'init', '--date', '2024-01-01T00:00:00Z'], { cwd: r, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z' } });
  for (let i = 0; i < 3; i++) {
    put(r, { 'src/a.js': 'a' + i });
    g('add', '.');
    execFileSync('git', ['commit', '-q', '-m', 'c' + i], { cwd: r, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_COMMITTER_DATE: `2024-0${i + 3}-01T00:00:00Z` } });
  }
  const d = await docDrift(r, [{ path: 'docs/guide.md' }, { path: 'docs/ok.md' }], null);
  assert.equal(d.length, 1);
  assert.equal(d[0].doc, 'docs/guide.md');
  assert.deepEqual(d[0].mentions, ['src/a.js']);
  assert.equal(d[0].commitsSince, 3);
  assert.ok(d[0].codeChangedAt > d[0].docChangedAt);
  assert.equal(d[0].severity, 'high');
  // non-git dir
  assert.deepEqual(await docDrift(tmp(), [{ path: 'x.md' }], null), []);
});
