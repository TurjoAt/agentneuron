// Package hallucination guard (#9): offline checks, lockfile parsing, opt-in online lookups with a stubbed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lookalike, versionIssues, readLockfiles, scanPackages, checkPackage, registryInfo } from '../src/changes/packages.js';
import { NPM, PYPI, PACKAGIST } from '../src/changes/popular.js';
import { clearProjectCache } from '../src/project/index.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-pkg-')));
const w = (d, f, c) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), typeof c === 'string' ? c : JSON.stringify(c, null, 2)); };

// no test in this file may reach the network
const realFetch = globalThis.fetch;
test.beforeEach(() => { globalThis.fetch = () => { throw new Error('network used in an offline test'); }; });
test.afterEach(() => { globalThis.fetch = realFetch; });

test('bundled popular lists are non-trivial and well formed', () => {
  assert.ok(NPM.length >= 300 && PYPI.length >= 200 && PACKAGIST.length >= 120);
  assert.equal(new Set(NPM).size, NPM.length, 'no duplicates');
  for (const n of PACKAGIST) assert.match(n, /^[a-z0-9-]+\/[a-z0-9_.-]+$/);
});

test('lookalike: typosquats, separators, -js clones, scope copies; popular names pass', () => {
  for (const [n, code] of [['expresss', 'lookalike'], ['lodahs', 'lookalike'], ['axois', 'lookalike'], ['lodash_es', 'lookalike'], ['lodash-js', 'suffix-clone'], ['@evil/react', 'scope-lookalike']]) {
    assert.equal(lookalike(n, 'npm')?.code, code, n);
  }
  for (const n of ['react', 'preact', 'vitest', 'vite', 'esbuild', '@types/node', 'ws', 'pg', '@babel/core', 'svelte', 'my-internal-lib']) assert.equal(lookalike(n, 'npm'), null, n);
  assert.equal(lookalike('reqeusts', 'pypi')?.target, 'requests');
  assert.equal(lookalike('Requests', 'pypi'), null);
  assert.equal(lookalike('python-dateutil', 'pypi'), null);
  assert.equal(lookalike('laravel/framwork', 'packagist')?.target, 'laravel/framework');
  assert.equal(lookalike('monolog/monolog', 'packagist'), null);
});

test('versionIssues: url, local, unpinned', () => {
  const c = (eco, v) => versionIssues(eco, v).map((x) => x.code);
  assert.deepEqual(c('npm', 'github:user/repo'), ['url-dep']);
  assert.deepEqual(c('npm', 'git+https://example.com/x.git'), ['url-dep']);
  assert.deepEqual(c('npm', 'file:../lib'), ['local-dep']);
  assert.deepEqual(c('npm', '*'), ['unpinned']);
  assert.deepEqual(c('npm', 'latest'), ['unpinned']);
  assert.deepEqual(c('npm', '>=1.0'), ['unpinned']);
  assert.deepEqual(c('npm', '^1.2.3'), []);
  assert.deepEqual(c('packagist', 'dev-main'), ['url-dep']);
});

function npmProject() {
  const d = tmp();
  w(d, 'package.json', { name: 'demo', dependencies: { lodash: '^4.17.21', expresss: '^4.0.0', 'left-thing': '*', 'from-git': 'github:someone/thing', 'not-locked': '^1.0.0' }, devDependencies: { vitest: '^2.0.0' } });
  w(d, 'package-lock.json', { lockfileVersion: 3, packages: {
    '': { name: 'demo' },
    'node_modules/lodash': { version: '4.17.21', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz' },
    'node_modules/expresss': { version: '4.0.0', resolved: 'https://registry.npmjs.org/expresss/-/expresss-4.0.0.tgz', hasInstallScript: true },
    'node_modules/left-thing': { version: '1.0.0', resolved: 'https://registry.npmjs.org/left-thing/-/left-thing-1.0.0.tgz' },
    'node_modules/from-git': { version: '1.0.0', resolved: 'git+ssh://git@github.com/someone/thing.git#abc' },
    'node_modules/vitest': { version: '2.0.0', resolved: 'https://registry.npmjs.org/vitest/-/vitest-2.0.0.tgz' },
  } });
  return d;
}

test('scanPackages (offline): lockfile drift, look-alikes, risky sources, install scripts', async () => {
  const d = npmProject();
  clearProjectCache(d);
  const r = await scanPackages(d);
  assert.equal(r.online, false);
  assert.equal(r.deps, 6);
  assert.deepEqual(r.lockfiles, ['package-lock.json']);
  const has = (code, name) => r.findings.some((f) => f.code === code && f.name === name);
  assert.ok(has('not-in-lockfile', 'not-locked'));
  assert.ok(!has('not-in-lockfile', 'lodash'));
  assert.ok(has('lookalike', 'expresss'));
  assert.ok(has('unpinned', 'left-thing'));
  assert.ok(has('url-dep', 'from-git'));
  assert.ok(has('non-registry-source', 'from-git'));
  assert.ok(has('install-script', 'expresss'));
  assert.equal(r.findings[0].severity, 'high', 'sorted by severity');
  for (const f of r.findings) for (const k of ['id', 'severity', 'manager', 'name', 'version', 'code', 'message', 'fix']) assert.ok(k in f, k);
});

test('readLockfiles: pnpm, yarn, composer, poetry', async () => {
  const d = tmp();
  w(d, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies:\n      react:\n        specifier: ^18\n        version: 18.3.1\n\npackages:\n\n  react@18.3.1:\n    resolution: {integrity: sha512-x}\n\n  '@scope/pkg@1.0.0':\n    resolution: {tarball: https://example.com/pkg.tgz}\n    requiresBuild: true\n");
  w(d, 'composer.lock', { packages: [{ name: 'laravel/framework', dist: { url: 'https://api.github.com/repos/laravel/framework/zipball/x' } }], 'packages-dev': [{ name: 'phpunit/phpunit' }] });
  w(d, 'poetry.lock', '[[package]]\nname = "Requests"\nversion = "2.0"\n\n[[package]]\nname = "typing_extensions"\nversion = "4"\n');
  const l = await readLockfiles(d);
  assert.ok(l.npm.names.has('react') && l.npm.names.has('@scope/pkg'));
  assert.deepEqual(l.npm.scripts, ['@scope/pkg']);
  assert.equal(l.npm.sources[0].name, '@scope/pkg');
  assert.ok(l.packagist.names.has('laravel/framework') && l.packagist.names.has('phpunit/phpunit'));
  assert.ok(l.pypi.names.has('requests') && l.pypi.names.has('typing-extensions'));
  const y = tmp();
  w(y, 'yarn.lock', '# yarn lockfile v1\n\n"@babel/core@^7.0.0", "@babel/core@^7.1.0":\n  version "7.1.0"\n\nlodash@^4.17.0:\n  version "4.17.21"\n');
  const ly = await readLockfiles(y);
  assert.ok(ly.npm.names.has('@babel/core') && ly.npm.names.has('lodash'));
});

test('checkPackage (offline): verdicts and input validation', async () => {
  const d = npmProject();
  clearProjectCache(d);
  assert.equal((await checkPackage(d, { manager: 'npm', name: 'react' })).verdict, 'ok');
  assert.equal((await checkPackage(d, { manager: 'npm', name: 'lodash' })).known.inLockfile, true);
  const bad = await checkPackage(d, { manager: 'pnpm', name: 'reactt' });
  assert.equal(bad.verdict, 'block');
  assert.match(bad.reasons.find((r) => r.code === 'lookalike').fix, /react/);
  const unknown = await checkPackage(d, { manager: 'npm', name: 'some-internal-tool' });
  assert.equal(unknown.verdict, 'unknown');
  assert.equal(unknown.registry, null);
  assert.equal((await checkPackage(d, { manager: 'npm', name: 'react', version: 'latest' })).verdict, 'warn');
  assert.equal((await checkPackage(d, { manager: 'pip', name: 'reqeusts' })).verdict, 'block');
  assert.equal((await checkPackage(d, { manager: 'composer', name: 'laravel/framework' })).verdict, 'ok');
  await assert.rejects(checkPackage(d, { manager: 'npm', name: '../../etc' }), /invalid package name/);
  await assert.rejects(checkPackage(d, { manager: 'brew', name: 'x' }), /unknown manager/);
  await assert.rejects(checkPackage(d, { manager: 'npm', name: 'x', version: '1 && rm' }), /invalid version/);
});

function fakeFetch(routes, calls) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', signal: !!init.signal });
    for (const [re, body] of routes) {
      if (!re.test(String(url))) continue;
      if (body === 404) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
      if (body === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
    }
    return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) };
  };
}

test('online (opt-in): registry existence, new package, advisories, disk cache', async () => {
  const d = npmProject();
  const calls = [];
  const now = Date.now();
  const f = fakeFetch([
    [/registry\.npmjs\.org\/ghost-pkg-xyz/, 404],
    [/registry\.npmjs\.org\/fresh-pkg/, { 'dist-tags': { latest: '0.0.1' }, time: { created: new Date(now - 2 * 86400000).toISOString() }, maintainers: [{ name: 'a' }], versions: { '0.0.1': {} } }],
    [/registry\.npmjs\.org\/old-vuln/, { 'dist-tags': { latest: '2.0.0' }, time: { created: '2015-01-01T00:00:00Z' }, maintainers: [{}, {}], versions: { '2.0.0': {} } }],
    [/api\.osv\.dev/, { vulns: [{ id: 'GHSA-xxxx', summary: 'prototype pollution' }] }],
  ], calls);
  const ghost = await checkPackage(d, { manager: 'npm', name: 'ghost-pkg-xyz' }, { online: true, fetchImpl: f });
  assert.equal(ghost.verdict, 'block');
  assert.equal(ghost.registry.exists, false);
  assert.ok(ghost.reasons.some((r) => r.code === 'not-on-registry'));
  assert.ok(calls.every((c) => c.signal), 'every request has an abort signal (timeout)');
  const fresh = await checkPackage(d, { manager: 'npm', name: 'fresh-pkg' }, { online: true, fetchImpl: f });
  assert.ok(fresh.reasons.some((r) => r.code === 'new-package'));
  const vuln = await checkPackage(d, { manager: 'npm', name: 'old-vuln', version: '1.0.0' }, { online: true, fetchImpl: f });
  assert.equal(vuln.verdict, 'block');
  assert.equal(vuln.registry.advisories[0].id, 'GHSA-xxxx');
  assert.ok(fs.readdirSync(path.join(d, '.agentneuron/cache/packages')).length >= 3);
  const n = calls.length;
  const again = await checkPackage(d, { manager: 'npm', name: 'old-vuln', version: '1.0.0' }, { online: true, fetchImpl: f });
  assert.equal(calls.length, n, 'served from the disk cache');
  assert.equal(again.registry.cached, true);
  // cacheOnly (MCP): cached facts are used, misses never fetch
  const mcp = await checkPackage(d, { manager: 'npm', name: 'old-vuln', version: '1.0.0' }, { cacheOnly: true, fetchImpl: () => { throw new Error('no'); } });
  assert.equal(mcp.registry.advisories.length, 1);
  const miss = await checkPackage(d, { manager: 'npm', name: 'never-looked-up' }, { cacheOnly: true, fetchImpl: () => { throw new Error('no'); } });
  assert.equal(miss.registry, null);
});

test('online: a hanging registry times out after 5 s and is not cached', { timeout: 15000 }, async () => {
  const d = tmp();
  const calls = [];
  const t0 = Date.now();
  const info = await registryInfo(d, 'npm', 'slow-pkg', null, { fetchImpl: fakeFetch([[/registry/, 'hang']], calls) });
  const ms = Date.now() - t0;
  assert.match(info.error, /timed out/);
  assert.ok(ms >= 4500 && ms < 9000, `took ${ms} ms`);
  assert.ok(!fs.existsSync(path.join(d, '.agentneuron/cache/packages')));
});

test('scanPackages online looks up a bounded number of deps', async () => {
  const d = npmProject();
  clearProjectCache(d);
  const calls = [];
  const r = await scanPackages(d, { online: true, fetchImpl: fakeFetch([[/registry\.npmjs\.org\/not-locked/, 404], [/registry\.npmjs\.org/, { 'dist-tags': { latest: '1.0.0' }, time: { created: '2016-01-01T00:00:00Z' }, maintainers: [{}, {}], versions: {} }], [/osv/, { vulns: [] }]], calls) });
  assert.equal(r.online, true);
  assert.ok(r.findings.some((f) => f.code === 'not-on-registry' && f.name === 'not-locked'));
  assert.ok(calls.length <= 2 * 25);
});
