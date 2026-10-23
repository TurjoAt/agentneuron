import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import register, { buildCommand, parseOutdated, parseAudit, ARTISAN_ALLOW } from '../src/actions/packages.js';
import { detectProject, clearProjectCache, hasBinary } from '../src/project/index.js';
import projectRoutes from '../src/server/routes/project.js';
import { createRouter } from '../src/server/router.js';

function fakeRegistry() {
  const defs = new Map();
  return { defs, register: (d) => defs.set(d.id, d) };
}
function fakeJob(results = {}) {
  const calls = [];
  return { calls, logs: [], log(s, t) { this.logs.push([s, t]); }, async exec(cmd, args, opts) { calls.push([cmd, args, opts]); return results[cmd] || { code: 0, stdout: '', stderr: '' }; } };
}
function proj() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-act-'));
  fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: 'p', scripts: { build: 'x', 'test:unit': 'y' } }));
  fs.writeFileSync(path.join(r, 'composer.json'), JSON.stringify({ name: 'a/b', scripts: { test: 'phpunit' } }));
  fs.writeFileSync(path.join(r, 'artisan'), '');
  return r;
}

test('buildCommand per manager', () => {
  assert.deepEqual(buildCommand('add', { manager: 'npm', name: '@scope/pkg', version: '^1.2.0', dev: true }), ['npm', ['install', '@scope/pkg@^1.2.0', '--save-dev']]);
  assert.deepEqual(buildCommand('add', { manager: 'pnpm', name: 'left-pad' }), ['pnpm', ['add', 'left-pad']]);
  assert.deepEqual(buildCommand('add', { manager: 'yarn', name: 'x', dev: true }), ['yarn', ['add', 'x', '-D']]);
  assert.deepEqual(buildCommand('add', { manager: 'composer', name: 'vendor/name', version: '^2.0', dev: true }), ['composer', ['require', 'vendor/name:^2.0', '--no-interaction', '--dev']]);
  assert.deepEqual(buildCommand('add', { manager: 'pip', name: 'Requests', version: '2.31.0' }), ['pip', ['install', 'Requests==2.31.0']]);
  assert.deepEqual(buildCommand('add', { manager: 'poetry', name: 'httpx', dev: true }), ['poetry', ['add', 'httpx', '--group', 'dev']]);
  assert.deepEqual(buildCommand('remove', { manager: 'npm', name: 'x' }), ['npm', ['uninstall', 'x']]);
  assert.deepEqual(buildCommand('update', { manager: 'yarn' }), ['yarn', ['upgrade']]);
  assert.deepEqual(buildCommand('update', { manager: 'composer', name: 'a/b' }), ['composer', ['update', 'a/b', '--no-interaction']]);
  assert.deepEqual(buildCommand('outdated', { manager: 'npm' }), ['npm', ['outdated', '--json']]);
  assert.deepEqual(buildCommand('script', { manager: 'composer', name: 'test' }), ['composer', ['run-script', 'test']]);
  assert.deepEqual(buildCommand('script', { manager: 'npm', name: 'test:unit' }), ['npm', ['run', 'test:unit']]);
});

test('validation rejects injection / flags / bad names', () => {
  for (const name of ['--registry=evil', 'a b', 'x;rm -rf', '$(id)', 'UPPER', '../x', '', '-g']) assert.throws(() => buildCommand('add', { manager: 'npm', name }), /name/, name);
  assert.throws(() => buildCommand('add', { manager: 'composer', name: 'noslash' }));
  assert.throws(() => buildCommand('add', { manager: 'npm', name: 'ok', version: '1.0 --force' }));
  assert.throws(() => buildCommand('add', { manager: 'npm', name: 'ok', version: '-x' }));
  assert.throws(() => buildCommand('add', { manager: 'bogus', name: 'ok' }));
  assert.throws(() => buildCommand('script', { manager: 'npm', name: '--help' }));
  assert.throws(() => buildCommand('script', { manager: 'npm', name: 'a b' }));
  assert.throws(() => buildCommand('update', { manager: 'pip' }));
});

test('registered actions: ids, levels, preview, run, script must exist', async () => {
  const root = proj(); clearProjectCache(root);
  const reg = fakeRegistry(); register(reg, { root });
  const ids = [...reg.defs.keys()];
  for (const id of ['packages.install', 'packages.add', 'packages.remove', 'packages.update', 'packages.outdated', 'packages.audit', 'scripts.run', 'framework.artisan', 'framework.artisan.migrate']) assert.ok(ids.includes(id), id);
  assert.equal(reg.defs.get('framework.artisan.migrate').level, 'danger');
  for (const id of ids.filter((i) => i !== 'framework.artisan.migrate')) assert.equal(reg.defs.get(id).level, 'exec');
  assert.deepEqual(reg.defs.get('framework.artisan').params.command.enum, ARTISAN_ALLOW);
  assert.deepEqual(reg.defs.get('packages.add').preview({ manager: 'npm', name: 'x', dev: true }).command, ['npm', 'install', 'x', '--save-dev']);
  assert.deepEqual(reg.defs.get('framework.artisan').preview({ command: 'route:list' }).command, ['php', 'artisan', 'route:list', '--no-interaction', '--no-ansi']);
  assert.throws(() => reg.defs.get('framework.artisan').preview({ command: 'tinker' }));
  assert.throws(() => reg.defs.get('framework.artisan').preview({ command: 'migrate:fresh' }));
  assert.deepEqual(reg.defs.get('framework.artisan.migrate').preview({ pretend: true }).command.slice(-1), ['--pretend']);

  // scripts.run: unknown script rejected; known passes (if the binary exists on this machine)
  const run = reg.defs.get('scripts.run').run;
  const job = fakeJob();
  if (hasBinary('npm')) {
    await assert.rejects(run({ manager: 'npm', name: 'nope' }, {}, job), /not found/);
    await run({ manager: 'npm', name: 'build' }, {}, job);
    assert.deepEqual(job.calls[0].slice(0, 2), ['npm', ['run', 'build']]);
  }
  await assert.rejects(run({ manager: 'npm', name: '--x' }, {}, fakeJob()));
  await detectProject(root);
  assert.throws(() => reg.defs.get('scripts.run').preview({ manager: 'npm', name: 'nope' }), /not found/);
  assert.deepEqual(reg.defs.get('scripts.run').preview({ manager: 'npm', name: 'test:unit' }).command, ['npm', 'run', 'test:unit']);
});

test('outdated/audit parsers and cache + routes', async () => {
  const npm = JSON.stringify({ lodash: { current: '4.0.0', wanted: '4.1.0', latest: '5.0.0', dependencyType: 'dependencies' } });
  assert.deepEqual(parseOutdated('npm', npm), [{ name: 'lodash', current: '4.0.0', wanted: '4.1.0', latest: '5.0.0', type: 'dependencies' }]);
  assert.equal(parseOutdated('composer', JSON.stringify({ installed: [{ name: 'a/b', version: '1.0', latest: '1.1', 'latest-status': 'semver-safe-update' }] }))[0].latest, '1.1');
  assert.equal(parseOutdated('pip', JSON.stringify([{ name: 'x', version: '1', latest_version: '2' }]))[0].latest, '2');
  assert.equal(parseOutdated('poetry', 'requests 2.0.0 2.31.0 HTTP lib\n')[0].latest, '2.31.0');
  assert.equal(parseOutdated('npm', 'garbage').length, 0);
  assert.equal(parseAudit('npm', JSON.stringify({ metadata: { vulnerabilities: { low: 1, high: 2, total: 3 } } })).total, 3);
  assert.equal(parseAudit('composer', JSON.stringify({ advisories: { 'a/b': [{}, {}] } })).total, 2);

  const root = proj(); clearProjectCache(root);
  const reg = fakeRegistry(); register(reg, { root });
  if (hasBinary('npm')) {
    const job = fakeJob({ npm: { code: 1, stdout: npm, stderr: '' } });
    const res = await reg.defs.get('packages.outdated').run({ manager: 'npm' }, {}, job);
    assert.equal(res.count, 1);
    assert.ok(fs.existsSync(path.join(root, '.agentneuron/cache/outdated-npm.json')));
  } else {
    fs.mkdirSync(path.join(root, '.agentneuron/cache'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agentneuron/cache/outdated-npm.json'), JSON.stringify({ manager: 'npm', ts: 1, items: parseOutdated('npm', npm) }));
  }
  const router = createRouter();
  await projectRoutes(router, { root, allFiles: () => [], git: null });
  const call = async (p, q = {}) => router.match('GET', p).fn({ q: new URLSearchParams(q) });
  const out = await call('/api/project/outdated');
  assert.equal(out.managers.npm.items[0].name, 'lodash');
  const p = await call('/api/project');
  assert.equal(p.manifests.length, 2);
  await assert.rejects(call('/api/project/deps', { manager: 'x;y' }), /invalid manager/);
  assert.ok(Array.isArray(await call('/api/project/deps', { manager: 'composer' })));
  assert.ok(Array.isArray(await call('/api/project/routes')));
  assert.ok(Array.isArray(await call('/api/project/drift')));
  assert.ok(await call('/api/project/stats'));
});
