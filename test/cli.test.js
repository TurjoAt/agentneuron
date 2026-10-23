import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const run = (args, opts = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000, ...opts });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mdctl-cli-'));

test('--help and --version', () => {
  const h = run(['--help']);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /Usage/);
  const v = run(['--version']);
  assert.equal(v.status, 0);
  assert.match(v.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('lint --json exits 0 on clean project, 1 on errors', () => {
  const ok = tmp();
  fs.writeFileSync(path.join(ok, 'README.md'), '# Hello\n\nA readme with some content.\n');
  const r0 = run(['lint', '--json', ok]);
  assert.equal(r0.status, 0, r0.stderr + r0.stdout);
  const j0 = JSON.parse(r0.stdout);
  assert.ok(Array.isArray(j0.issues));

  const bad = tmp();
  fs.writeFileSync(path.join(bad, 'CLAUDE.md'), '# X\n\nsee [gone](missing-file.md)\n\nkey sk-ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0'.repeat(3) + '\n');
  const r1 = run(['lint', '--json', bad]);
  const j1 = JSON.parse(r1.stdout);
  assert.ok(j1.issues.some((i) => i.severity === 'error'), r1.stdout);
  assert.equal(r1.status, 1);
});

test('status prints summary; init creates .mdctl/config.json', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'AGENTS.md'), '# Agents\n\nhi\n');
  const s = run(['status', d]);
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /files:/);
  const i = run(['init', d]);
  assert.equal(i.status, 0, i.stderr);
  assert.ok(fs.existsSync(path.join(d, '.mdctl/config.json')));
});

test('start prints URL banner and stops on SIGINT', async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# hi\n');
  const p = spawn(process.execPath, [cli, 'start', d, '--port', '0', '--token', 'tk'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (x) => (out += x));
  const url = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('no banner: ' + out)), 15000);
    p.stdout.on('data', () => { const m = out.match(/open\s+:\s+(\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
  });
  assert.match(url, /token=tk/);
  const r = await fetch(url.replace('/?', '/api/state?'));
  assert.equal(r.status, 200);
  const exited = new Promise((r2) => p.on('exit', (c) => r2(c)));
  p.kill('SIGINT');
  assert.equal(await exited, 0);
});

test('--enable validates levels; banner shows enabled actions; admin token roles', async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# hi\n');
  const bad = run(['start', d, '--port', '0', '--enable', 'root']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown level/);
  const p = spawn(process.execPath, [cli, 'start', d, '--port', '0', '--token', 'view', '--admin-token', 'adm', '--enable', 'edit,exec'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (x) => (out += x));
  const url = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('no banner: ' + out)), 15000);
    p.stdout.on('data', () => { const m = out.match(/open\s+:\s+(\S+)/); if (m && /Ctrl\+C/.test(out)) { clearTimeout(t); res(m[1]); } });
  });
  try {
    assert.match(out, /actions : edit, exec enabled/);
    const base = url.split('/?')[0];
    const me = await (await fetch(`${base}/api/auth/me`, { headers: { authorization: 'Bearer adm' } })).json();
    assert.equal(me.role, 'admin'); assert.equal(me.levels.exec, true); assert.equal(me.levels.danger, false);
    const vw = await (await fetch(`${base}/api/auth/me`, { headers: { authorization: 'Bearer view' } })).json();
    assert.equal(vw.role, 'viewer'); assert.equal(vw.levels.edit, false);
  } finally {
    const exited = new Promise((r2) => p.on('exit', (c) => r2(c)));
    p.kill('SIGINT'); await exited;
  }
});
