import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createPersist } from '../src/persist/index.js';
import { createAudit, maskParams } from '../src/persist/audit.js';
import { createJsonl } from '../src/persist/jsonl.js';
import { createNotifier } from '../src/notify/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mdctl-persist-'));

test('events + metrics persistence, query by range and limit', async () => {
  const root = tmp();
  const ctx = {
    root,
    analysis: async () => ({ health: { score: 90, grade: 'A', counts: { error: 0, warn: 2, info: 1 } }, tasks: [{ done: true }, { done: false }], gitAvail: false }),
    allFiles: () => [{ tool: 'claude', kind: 'rules', tokens: 10 }, { tool: 'cursor', kind: 'rules', tokens: 5 }],
    repoInfo: async () => ({ dirty: 3 }),
  };
  const p = createPersist(ctx);
  for (let i = 1; i <= 5; i++) p.events.append({ id: i, type: 'change', path: 'a.md', ts: 1000 * i, file: { kind: 'rules', tool: 'claude' } });
  assert.equal(p.events.query({}).length, 5);
  assert.deepEqual(p.events.query({ from: 2000, to: 4000 }).map((e) => e.id), [2, 3, 4]);
  assert.deepEqual(p.events.query({ limit: 2 }).map((e) => e.id), [4, 5]);
  assert.equal(p.events.query({})[0].tool, 'claude');
  const snap = await p.metrics.snapshot();
  assert.equal(snap.files, 2); assert.equal(snap.tokens, 15); assert.equal(snap.tasksOpen, 1); assert.equal(snap.tasksDone, 1);
  assert.equal(snap.byTool.cursor, 1); assert.equal(snap.warns, 2); assert.equal(snap.grade, 'A');
  const rows = p.metrics.query({ from: Date.now() - 5000 });
  assert.equal(rows.length, 1);
  assert.ok(fs.existsSync(path.join(root, '.mdctl/metrics.jsonl')));
});

test('jsonl rotation keeps 3 rotated files', () => {
  const root = tmp();
  const j = createJsonl(path.join(root, 'x.jsonl'), { maxBytes: 100, keep: 3 });
  for (let i = 0; i < 40; i++) j.append({ i, pad: 'xxxxxxxxxx' });
  assert.ok(fs.existsSync(`${j.file}.1`));
  assert.ok(fs.existsSync(`${j.file}.3`));
  assert.ok(!fs.existsSync(`${j.file}.4`));
  const all = j.readAll();
  assert.equal(all.at(-1).i, 39);
  assert.ok(all.every((r, k) => k === 0 || r.i > all[k - 1].i));
});

test('audit masks secrets and sensitive keys; newest first', () => {
  const root = tmp();
  const a = createAudit(root);
  a.log({ role: 'admin', action: 'x', params: { token: 'abc', password: 'p', note: 'k sk-ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0'.repeat(3), content: 'long file body' }, status: 'ok' });
  a.log({ role: 'admin', route: 'POST /api/y', status: 200 });
  const rows = a.read({ limit: 10 });
  assert.equal(rows[0].route, 'POST /api/y');
  const p = rows[1].params;
  assert.equal(p.token, '***'); assert.equal(p.password, '***');
  assert.ok(!/sk-ant-api03-A1b2C3d4E5f6G7h8I9j0A1b2/.test(p.note));
  assert.equal(p.content, '[14 chars]');
  assert.equal(maskParams({ a: { apiKey: 'z' } }).a.apiKey, '***');
});

test('notify: SSE broadcast + webhook POST (event filter, never throws)', async () => {
  const got = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => { got.push({ url: req.url, body: JSON.parse(b) }); res.end('ok'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const sse = [];
  const ctx = {
    broadcast: (n, d) => sse.push([n, d]),
    config: { notifications: { webhooks: [
      { url: `http://127.0.0.1:${port}/all` },
      { url: `http://127.0.0.1:${port}/secrets`, events: ['secret'] },
      { url: 'http://127.0.0.1:1/dead' }, { url: 'not-a-url' },
    ] } },
  };
  const notify = createNotifier(ctx, { timeoutMs: 1000 });
  notify('job-done', { title: 'Build ok', body: 'fine' });
  notify('secret', { title: 'Secret', path: 'CLAUDE.md' });
  assert.deepEqual(sse.map(([n, d]) => [n, d.type]), [['notify', 'job-done'], ['notify', 'secret']]);
  assert.equal(sse[1][1].path, 'CLAUDE.md'); assert.equal(sse[1][1].level, 'error');
  for (let i = 0; i < 50 && got.length < 3; i++) await new Promise((r) => setTimeout(r, 50));
  srv.close(); srv.closeAllConnections?.();
  assert.deepEqual(got.map((g) => g.url).sort(), ['/all', '/all', '/secrets']);
  const first = got.find((g) => g.body.type === 'job-done');
  assert.match(first.body.text, /Build ok/);
  assert.equal(createNotifier({ broadcast() { throw new Error('x'); }, config: {} })('secret', {}), null);
});
