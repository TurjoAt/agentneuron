import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAnalyzer } from '../src/core/analyze.js';
import { createStore } from '../src/core/store.js';
import { loadConfig } from '../src/core/config.js';
import { createHeadlessCtx } from '../src/core/headless.js';
import { createJsonl } from '../src/persist/jsonl.js';
import * as scanner from '../src/core/scanner.js';
import { VERSION } from '../src/server/version.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-fix-'));
const here = path.dirname(fileURLToPath(import.meta.url));

test('VERSION comes from package.json when not bundled', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '../package.json'), 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('analyzer: a change during an in-flight compute is not lost', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# A\n');
  const store = createStore(root, loadConfig(root), { record: false });
  await store.init();
  let release; let calls = 0;
  const git = { available: async () => true, status: () => { calls++; return calls === 1 ? new Promise((r) => { release = () => r(new Map()); }) : new Map(); } };
  const an = createAnalyzer({ root, store, git });
  const p = an.analysis();
  await new Promise((r) => setTimeout(r, 20));
  // file changes while git status is still running
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# A\n\n- [ ] new task\n');
  await store.handleFsEvent({ type: 'change', path: 'CLAUDE.md' });
  an.invalidate();
  release();
  await p;
  const a = await an.analysis();
  assert.equal(a.tasks.length, 1, 'analysis must reflect the change made during compute');
  assert.equal(an.dirty, false);
});

test('store record:false writes no history; init reads each file once', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# A\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# B\n');
  const store = createStore(root, loadConfig(root), { record: false });
  await store.init();
  assert.equal(store.files.size, 2);
  assert.equal(store.contents.get('CLAUDE.md'), '# A\n');
  assert.ok(!fs.existsSync(path.join(root, '.agentneuron', 'history')));
  const both = await scanner.scanFiles(root, loadConfig(root));
  assert.deepEqual(both.map((r) => r.entry.path), ['AGENTS.md', 'CLAUDE.md']);
  assert.equal(both[1].content, '# A\n');
});

test('headless ctx: analysis + persist readers, nothing written to the project', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# A\n\n- [ ] t\n');
  const ctx = await createHeadlessCtx(root, {}, { git: false });
  const a = await ctx.analysis();
  assert.equal(a.tasks.length, 1);
  assert.deepEqual(ctx.persist.events.query({}), []);
  assert.equal(ctx.can('edit', 'admin'), false);
  assert.deepEqual(fs.readdirSync(root), ['CLAUDE.md']);
});

test('jsonl readAll cache is invalidated by appends and rotation', () => {
  const root = tmp();
  const j = createJsonl(path.join(root, 'x.jsonl'), { maxBytes: 60, keep: 2 });
  j.append({ ts: 1 });
  assert.deepEqual(j.readAll().map((r) => r.ts), [1]);
  j.append({ ts: 2 });
  assert.deepEqual(j.readAll().map((r) => r.ts), [1, 2]);
  for (let i = 3; i <= 8; i++) j.append({ ts: i, pad: 'xxxxxxxxxx' });
  const ts = j.readAll().map((r) => r.ts);
  assert.equal(ts[ts.length - 1], 8);
  assert.deepEqual(ts, [...ts].sort((x, y) => x - y));
});

test('startServer with strictPort on a busy port rejects and leaves nothing running', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = blocker.address().port;
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# A\n');
  const app = pathToFileURL(path.join(here, '../src/server/app.js')).href;
  const cfg = pathToFileURL(path.join(here, '../src/core/config.js')).href;
  const code = `const { startServer } = await import(${JSON.stringify(app)}); const { loadConfig } = await import(${JSON.stringify(cfg)});
    try { await startServer(loadConfig(${JSON.stringify(root)}, { port: ${port}, strictPort: true })); console.log('started'); } catch (e) { console.log('rejected ' + e.code); }`;
  // without cleanup the chokidar watcher keeps the child alive and spawnSync times out
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 15000 });
  blocker.close();
  assert.equal(r.error, undefined, 'child must exit on its own');
  assert.match(r.stdout, /rejected EADDRINUSE/);
});
