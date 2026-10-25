import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  compareVersions, detectInstall, parseSha256File, fetchLatest, updateLocalCopy, cmdUpdate, REGISTRY_URL, RELEASE_BASE,
} from '../src/commands/update.js';
import { runDoctor } from '../src/commands/doctor.js';
import { parseRangeArg } from '../src/commands/export.js';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const run = (args, opts = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000, ...opts });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-cmd-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** fetch stub: url -> { status, body } | Error */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return { ok: false, status: 404, headers: new Map(), json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    if (r instanceof Error) throw r;
    const buf = Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    return {
      ok: (r.status || 200) < 400, status: r.status || 200, headers: new Map(),
      json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    };
  };
  fn.calls = calls;
  return fn;
}
const logger = () => { const out = []; return { out, log: (m) => out.push(m), error: (m) => out.push(m) }; };

test('compareVersions', () => {
  assert.equal(compareVersions('0.2.1', '0.2.1'), 0);
  assert.equal(compareVersions('0.2.1', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
});

test('detectInstall: init copy, npx, global, other (POSIX and Windows paths)', () => {
  assert.equal(detectInstall('/p/proj/.agentneuron/agentneuron.mjs'), 'local');
  assert.equal(detectInstall('C:\\Users\\a\\proj\\.agentneuron\\agentneuron.mjs'), 'local');
  assert.equal(detectInstall('/home/a/.npm/_npx/123abc/node_modules/agentneuron/dist/agentneuron.mjs'), 'npx');
  assert.equal(detectInstall('C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\9f\\node_modules\\agentneuron\\dist\\agentneuron.mjs'), 'npx');
  const g = path.resolve('/usr/local/lib/node_modules');
  assert.equal(detectInstall(path.join(g, 'agentneuron/dist/agentneuron.mjs'), { globalRoot: g }), 'global');
  assert.equal(detectInstall(path.resolve('/w/app/node_modules/agentneuron/dist/agentneuron.mjs'), { globalRoot: g }), 'other');
  assert.equal(detectInstall(path.resolve('/w/agentneuron/src/commands/update.js'), { globalRoot: g }), 'other');
});

test('parseSha256File accepts sha256sum output only', () => {
  const h = 'a'.repeat(64);
  assert.equal(parseSha256File(`${h}  agentneuron.mjs\n`), h);
  assert.equal(parseSha256File(h.toUpperCase()), h);
  assert.equal(parseSha256File('nope'), null);
  assert.equal(parseSha256File(''), null);
});

test('fetchLatest: registry answer, HTTP error, offline, timeout', async () => {
  assert.equal(await fetchLatest({ fetch: fakeFetch({ [REGISTRY_URL]: { body: { version: '9.9.9' } } }) }), '9.9.9');
  await assert.rejects(fetchLatest({ fetch: fakeFetch({ [REGISTRY_URL]: { status: 503, body: {} } }) }), /HTTP 503/);
  await assert.rejects(fetchLatest({ fetch: fakeFetch({ [REGISTRY_URL]: new TypeError('fetch failed') }) }), /offline/);
  await assert.rejects(fetchLatest({ fetch: fakeFetch({ [REGISTRY_URL]: { body: { version: '<script>' } } }) }), /no usable version/);
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(fetchLatest({ fetch: hang, timeoutMs: 50 }), /did not answer/);
});

test('update --check reports availability and never installs', async () => {
  const f = fakeFetch({ [REGISTRY_URL]: { body: { version: '9.0.0' } } });
  const l = logger();
  assert.equal(await cmdUpdate({ check: true }, { fetch: f, current: '0.2.1', log: l, npmInstall: () => { throw new Error('must not install'); } }), 0);
  assert.match(l.out.join('\n'), /update available: 0\.2\.1 -> 9\.0\.0/);
  assert.deepEqual(f.calls, [REGISTRY_URL]);
  const l2 = logger();
  assert.equal(await cmdUpdate({ check: true }, { fetch: fakeFetch({ [REGISTRY_URL]: new TypeError('x') }), current: '0.2.1', log: l2 }), 1);
  assert.match(l2.out.join('\n'), /update check failed/);
});

function localCopy(content = 'old bundle\n') {
  const dir = path.join(tmp(), '.agentneuron');
  fs.mkdirSync(dir);
  const target = path.join(dir, 'agentneuron.mjs');
  fs.writeFileSync(target, content);
  return { dir, target };
}

test('local copy: verified download replaces atomically and keeps .bak', async () => {
  const { dir, target } = localCopy();
  const bundle = '#!/usr/bin/env node\nconsole.log("new")\n';
  const base = `${RELEASE_BASE}/v9.0.0/agentneuron.mjs`;
  const f = fakeFetch({ [REGISTRY_URL]: { body: { version: '9.0.0' } }, [base]: { body: bundle }, [`${base}.sha256`]: { body: `${sha(bundle)}  agentneuron.mjs\n` } });
  const l = logger();
  assert.equal(await cmdUpdate({ yes: true }, { fetch: f, current: '0.2.1', selfPath: target, log: l }), 0, l.out.join('\n'));
  assert.equal(fs.readFileSync(target, 'utf8'), bundle);
  assert.equal(fs.readFileSync(`${target}.bak`, 'utf8'), 'old bundle\n');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['agentneuron.mjs', 'agentneuron.mjs.bak']);
});

test('local copy: sha256 mismatch is rejected and nothing changes', async () => {
  const { dir, target } = localCopy();
  const base = `${RELEASE_BASE}/v9.0.0/agentneuron.mjs`;
  const f = fakeFetch({ [base]: { body: 'tampered' }, [`${base}.sha256`]: { body: `${sha('original')}  agentneuron.mjs` } });
  await assert.rejects(updateLocalCopy(target, '9.0.0', { fetch: f }), /checksum mismatch/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old bundle\n');
  assert.deepEqual(fs.readdirSync(dir), ['agentneuron.mjs']);
  const f2 = fakeFetch({ [base]: { body: 'x' }, [`${base}.sha256`]: { body: 'garbage' } });
  await assert.rejects(updateLocalCopy(target, '9.0.0', { fetch: f2 }), /malformed/);
  const f3 = fakeFetch({ [base]: { body: 'x' } });
  await assert.rejects(updateLocalCopy(target, '9.0.0', { fetch: f3 }), /HTTP 404/);
  assert.deepEqual(fs.readdirSync(dir), ['agentneuron.mjs']);
});

test('update asks before replacing; declined or no TTY means no change', async () => {
  const { target } = localCopy();
  const f = fakeFetch({ [REGISTRY_URL]: { body: { version: '9.0.0' } } });
  const l = logger();
  assert.equal(await cmdUpdate({}, { fetch: f, current: '0.2.1', selfPath: target, log: l, confirm: async () => false }), 1);
  assert.deepEqual(f.calls, [REGISTRY_URL], 'no download when declined');
  assert.equal(fs.readFileSync(target, 'utf8'), 'old bundle\n');
});

test('update: global install runs npm, npx/other prints a hint', async () => {
  const f = () => fakeFetch({ [REGISTRY_URL]: { body: { version: '9.0.0' } } });
  const g = path.resolve('/usr/lib/node_modules');
  let ran = 0;
  const l = logger();
  assert.equal(await cmdUpdate({ yes: true }, { fetch: f(), current: '0.2.1', selfPath: path.join(g, 'agentneuron/dist/agentneuron.mjs'), globalRoot: g, log: l, npmInstall: async () => { ran++; return 0; } }), 0);
  assert.equal(ran, 1);
  const l2 = logger();
  assert.equal(await cmdUpdate({ yes: true }, { fetch: f(), current: '0.2.1', selfPath: '/x/_npx/1/node_modules/agentneuron/dist/agentneuron.mjs', log: l2, npmInstall: async () => { ran++; return 0; } }), 0);
  assert.equal(ran, 1);
  assert.match(l2.out.join('\n'), /npx agentneuron@latest/);
  const l3 = logger();
  assert.equal(await cmdUpdate({ yes: true }, { fetch: f(), current: '9.0.0', selfPath: '/x', log: l3 }), 0);
  assert.match(l3.out.join('\n'), /up to date/);
});

test('doctor checks and --json', async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# hi\n');
  const checks = await runDoctor(d, { port: 0 });
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(by.node.status, 'ok');
  assert.equal(by.config.status, 'ok');
  assert.match(by['ai-tools'].message, /claude/);
  assert.equal(by['data-dir'].status, 'ok');
  assert.ok(!fs.existsSync(path.join(d, '.agentneuron')), 'doctor must not create .agentneuron');
  assert.deepEqual(fs.readdirSync(d), ['CLAUDE.md'], 'no probe file left behind');

  fs.mkdirSync(path.join(d, '.agentneuron'));
  fs.writeFileSync(path.join(d, '.agentneuron/config.json'), '{ broken');
  const r = run(['doctor', d, '--json', '--port', '0']);
  assert.equal(r.status, 1, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.equal(j.checks.find((c) => c.id === 'config').status, 'fail');
  const t = run(['doctor', d, '--port', '0']);
  assert.match(t.stdout, /✗ config/);
});

test('export: range parsing, formats, --out, bad input', () => {
  const now = 1e12;
  assert.deepEqual(parseRangeArg('7d', now), { from: now - 7 * 86400000, to: now });
  assert.deepEqual(parseRangeArg('24h', now), { from: now - 86400000, to: now });
  assert.equal(parseRangeArg('all', now).from, 1);
  assert.equal(parseRangeArg('7x', now), null);
  assert.equal(parseRangeArg('0d', now), null);

  const d = tmp();
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# hi\n');
  const md = run(['export', d, '--format', 'md', '--range', '30d']);
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /^# agentneuron report/);
  const csv = run(['export', d, '--format=csv']);
  assert.match(csv.stdout, /^date,changes,lines,commits,agent_edits/);
  const out = path.join(tmp(), 'r.html');
  const html = run(['export', d, '--format', 'html', '--out', out]);
  assert.equal(html.status, 0, html.stderr);
  assert.equal(html.stdout, '');
  assert.match(fs.readFileSync(out, 'utf8'), /<!doctype html>/);
  // ai/json are added to the report module separately: either real output or a clear refusal, never CSV
  for (const f of ['ai', 'json']) {
    const r = run(['export', d, '--format', f]);
    if (r.status === 0) { assert.ok(r.stdout.length > 0); assert.doesNotMatch(r.stdout, /^date,changes/); }
    else { assert.equal(r.status, 2); assert.match(r.stderr, /not supported/); }
  }
  assert.equal(run(['export', d, '--format', 'pdf']).status, 2);
  assert.equal(run(['export', d, '--range', 'yesterday']).status, 2);
  assert.deepEqual(fs.readdirSync(d), ['CLAUDE.md'], 'export writes nothing into the project');
});

test('help: grouped, per-command, backward compatible', () => {
  const h = run(['--help']);
  assert.match(h.stdout, /Usage/);
  for (const c of ['export', 'doctor', 'update', 'lint', 'workspace']) assert.match(h.stdout, new RegExp(`\\b${c}\\b`));
  assert.match(run(['export', '--help']).stdout, /--format ai\|json\|md\|csv\|html/);
  assert.match(run(['help', 'update']).stdout, /--check/);
  assert.match(run(['doctor', '-h']).stdout, /Usage: agentneuron doctor/);
});
