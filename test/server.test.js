import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadConfig } from '../src/core/config.js';
import { startServer } from '../src/server/app.js';

let root, srv, base;
const TOKEN = 'secret123';

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-srv-'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n\nSee @docs/plan.md and [missing](nope.md)\n\n- [ ] first task\n');
  fs.writeFileSync(path.join(root, 'docs/plan.md'), '# Plan\n\nhello needle world\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Agents\n');
  const config = loadConfig(root, { port: 0, token: TOKEN });
  config.allowWrite = false;
  srv = await startServer(config);
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => { await srv.close(); fs.rmSync(root, { recursive: true, force: true }); });

const get = async (p, extra = '') => {
  const r = await fetch(`${base}${p}${p.includes('?') ? '&' : '?'}token=${TOKEN}${extra}`);
  return { status: r.status, body: await r.json() };
};

test('auth rejects without token and accepts query/bearer', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/api/state?token=bad`)).status, 401);
  assert.equal((await fetch(`${base}/api/state`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 200);
  assert.equal((await fetch(`${base}/?token=${TOKEN}`)).status, 200);
  assert.match(srv.url, /token=secret123/);
});

test('serves html at /', async () => {
  const r = await fetch(`${base}/?token=${TOKEN}`);
  assert.match(r.headers.get('content-type'), /text\/html/);
});

test('state/files/file/search/graph/health', async () => {
  const st = (await get('/api/state')).body;
  assert.equal(st.project.name, path.basename(root));
  assert.ok(st.counts.files >= 3);
  assert.ok(st.health.grade);
  const files = (await get('/api/files')).body;
  assert.ok(files.some((f) => f.path === 'CLAUDE.md'));
  const f = (await get('/api/file?path=CLAUDE.md')).body;
  assert.equal(f.entry.path, 'CLAUDE.md');
  assert.match(f.content, /Project/);
  assert.ok(Array.isArray(f.links.out));
  assert.ok(Array.isArray(f.history));
  assert.equal((await get('/api/file?path=../etc/passwd')).status, 404);
  assert.equal((await get('/api/file?path=missing.md')).status, 404);
  const s = (await get('/api/search?q=NEEDLE')).body;
  assert.deepEqual(s.map((x) => [x.path, x.line]), [['docs/plan.md', 3]]);
  const g = (await get('/api/graph')).body;
  assert.ok(Array.isArray(g.nodes) && Array.isArray(g.edges));
  const h = (await get('/api/health')).body;
  assert.ok(typeof h.score === 'number' && Array.isArray(h.issues));
});

test('misc endpoints return JSON', async () => {
  for (const p of ['/api/events', '/api/context/dirs', '/api/tasks', '/api/decisions', '/api/git',
    '/api/config', '/api/sessions', '/api/conflicts', '/api/history?path=CLAUDE.md', '/api/context?dir=&tool=claude']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await get('/api/nope')).status, 404);
  const tasks = (await get('/api/tasks')).body;
  assert.ok(tasks.some((t) => t.text.includes('first task')));
});

test('restore is forbidden without allowWrite; diff works', async () => {
  const r = await fetch(`${base}/api/restore?token=${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"path":"CLAUDE.md","id":"x"}' });
  assert.equal(r.status, 403);
  const hist = (await get('/api/history?path=CLAUDE.md')).body;
  if (hist.length) {
    const d = await get(`/api/diff?path=CLAUDE.md&from=${hist[0].id}&to=current`);
    assert.equal(d.status, 200);
    assert.ok(Array.isArray(d.body.hunks));
  }
});

test('SSE delivers an event after a file write', async () => {
  const got = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no SSE event')), 8000);
    const req = http.get(`${base}/api/stream?token=${TOKEN}`, (res) => {
      assert.match(res.headers['content-type'], /event-stream/);
      let buf = '';
      res.on('data', (d) => {
        buf += d;
        const m = buf.match(/event: event\ndata: (.*)\n\n/);
        if (m) { clearTimeout(t); req.destroy(); resolve(JSON.parse(m[1])); }
      });
      setTimeout(() => fs.writeFileSync(path.join(root, 'docs/plan.md'), '# Plan\n\nchanged line\nmore\n'), 400);
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
  const ev = await got;
  assert.equal(ev.path, 'docs/plan.md');
  assert.ok(['change', 'add'].includes(ev.type));
  const evs = (await get('/api/events?since=0')).body;
  assert.ok(evs.length >= 1);
});

test('non-loopback host without token auto-generates one', async () => {
  const c = loadConfig(root, { port: 0, host: '0.0.0.0' });
  const s2 = await startServer(c);
  try {
    assert.ok(s2.token && s2.token.length >= 16);
    assert.equal((await fetch(`http://127.0.0.1:${s2.port}/api/state`)).status, 401);
  } finally { await s2.close(); }
});
