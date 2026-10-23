import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/core/config.js';
import { startServer } from '../src/server/app.js';
import { scan, readEntry } from '../src/core/scanner.js';
import { readAgentConfig } from '../src/health/configview.js';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-seccli-'));

function start(dir, args, env = {}) {
  const p = spawn(process.execPath, [cli, 'start', dir, '--port', '0', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let out = '';
  p.stdout.on('data', (x) => (out += x)); p.stderr.on('data', (x) => (out += x));
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('no banner: ' + out)), 15000);
    const iv = setInterval(() => { if (/Ctrl\+C/.test(out)) { clearTimeout(t); clearInterval(iv); res(); } }, 50);
  });
  const stop = () => new Promise((r) => { p.on('exit', r); p.kill('SIGINT'); });
  return { ready, stop, out: () => out };
}

test('banner never prints a user-supplied token; env var AGENTNEURON_TOKEN is honoured', async () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# hi\n');
  const s = start(d, ['--token', 'supersecrettoken123']);
  await s.ready;
  assert.ok(!s.out().includes('supersecrettoken123'));
  assert.match(s.out(), /supe\*\*\*\*/);
  await s.stop();
  const e = start(d, [], { AGENTNEURON_TOKEN: 'envsecrettoken456' });
  await e.ready;
  assert.match(e.out(), /token\s+: required/);
  assert.ok(!e.out().includes('envsecrettoken456'));
  await e.stop();
});

test('banner warns about file-enabled risky levels and malformed config', async () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# hi\n');
  fs.mkdirSync(path.join(d, '.agentneuron'));
  fs.writeFileSync(path.join(d, '.agentneuron', 'config.json'), '{"actions":{"danger":true,"terminal":true}}');
  const s = start(d, []);
  await s.ready;
  assert.match(s.out(), /WARNING : \.agentneuron\/config\.json enables danger, terminal/);
  await s.stop();
  fs.writeFileSync(path.join(d, '.agentneuron', 'config.json'), '{nope');
  const m = start(d, []);
  await m.ready;
  assert.match(m.out(), /WARNING : .*not valid JSON/);
  await m.stop();
});

test('scanner and config reader do not read through symlinked directories', async () => {
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret.md'), '# OUTSIDE');
  fs.mkdirSync(path.join(outside, '.claude'));
  fs.writeFileSync(path.join(outside, '.claude', 'settings.json'), '{"permissions":{"allow":["OUTSIDE-RULE"]}}');
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# in');
  fs.symlinkSync(outside, path.join(root, 'linked'));
  fs.symlinkSync(path.join(outside, '.claude'), path.join(root, '.claude'));
  assert.equal(await readEntry(root, 'linked/secret.md'), null);
  assert.ok((await readEntry(root, 'CLAUDE.md')).entry);
  assert.ok(!(await scan(root, {})).some((f) => f.path.startsWith('linked/')));
  assert.ok(!JSON.stringify(readAgentConfig(root)).includes('OUTSIDE-RULE'));
});

test('analysis git.show refuses option-like revs', async () => {
  const { createGit } = await import('../src/analysis/git.js');
  const d = tmp(); fs.writeFileSync(path.join(d, 'a.md'), 'x');
  const victim = path.join(d, 'victim');
  assert.equal(await createGit(d).show('a.md', `--output=${victim}`), null);
  assert.ok(!fs.existsSync(victim));
});
