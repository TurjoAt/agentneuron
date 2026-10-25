import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { createClaims, overlaps, covers } from '../src/live/claims.js';
import { createHandoffs } from '../src/live/handoffs.js';
import { assigneeFor, liveAccess, snapshotFor } from '../src/live/coord.js';
import { runMcpServer } from '../src/mcp/server.js';
import { loadConfig } from '../src/core/config.js';
import { startServer } from '../src/server/app.js';
import { projectDirName } from '../src/agents/sessions.js';
import { parseMdTasks } from '../src/board/parse.js';

const KEY = 'sk-ant-api03-' + 'Zq9Xw8Vu7Ts6Rp5On4Ml3'.repeat(2);
const tmp = (p = 'an-coord-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
function rmTemp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (process.platform !== 'win32') throw e; }
}

test('claims: overlap rules, conflicts, force, TTL, release', () => {
  assert.ok(overlaps('src/a.js', 'src/a.js'));
  assert.ok(overlaps('src', 'src/a.js'));
  assert.ok(overlaps('src/**', 'src/x/y.js'));
  assert.ok(overlaps('src/*.js', 'src/**/*.ts')); // conservative for two globs
  assert.ok(!overlaps('src/a.js', 'src/b.js'));
  assert.ok(!overlaps('docs/**', 'src/a.js'));
  assert.ok(covers('src/*.js', 'src/a.js') && !covers('src/*.js', 'lib/a.js'));

  const root = tmp();
  try {
    let clock = 1_000_000;
    const c = createClaims(root, { now: () => clock });
    const a = c.claim({ agent: 'claude', sessionId: 's1', paths: ['src/**', 'README.md'], ttlMs: 60000, note: `key ${KEY}` });
    assert.deepEqual(a.granted, ['src/**', 'README.md']);
    assert.equal(a.conflicts.length, 0);
    assert.ok(!JSON.stringify(c.list()).includes('Zq9Xw8Vu7Ts6Rp5On4Ml3Zq9'), 'notes are masked');
    const b = c.claim({ agent: 'codex', sessionId: 's2', paths: ['src/api/x.js', 'docs/a.md'] });
    assert.deepEqual(b.granted, ['docs/a.md']);
    assert.equal(b.conflicts[0].heldBy.agent, 'claude'); assert.equal(b.conflicts[0].pattern, 'src/**');
    const f = c.claim({ agent: 'codex', sessionId: 's2', paths: ['src/api/x.js'], force: true });
    assert.deepEqual(f.granted, ['src/api/x.js']); assert.equal(f.conflicts.length, 1);
    assert.equal(c.holders('src/api/x.js').length, 2);
    // re-claim refreshes instead of duplicating
    c.claim({ agent: 'claude', sessionId: 's1', paths: ['README.md'], ttlMs: 60000 });
    assert.equal(c.list().filter((x) => x.pattern === 'README.md').length, 1);
    assert.throws(() => c.claim({ agent: 'x', paths: ['../etc'] }), /invalid path/);
    assert.throws(() => c.claim({ agent: 'x', paths: ['/abs'] }), /invalid path/);
    assert.equal(c.release({ agent: 'codex', sessionId: 's2', paths: ['docs/a.md'] }).released, 1);
    clock += 61000; // claude's claims expire, codex's (15 min default) remain
    assert.deepEqual(c.list().map((x) => x.agent), ['codex']);
    assert.equal(c.release({ agent: 'codex', sessionId: 's2' }).released, 1);
    assert.equal(c.list().length, 0);
  } finally { rmTemp(root); }
});

test('claims: concurrent processes cannot both win the same path', async () => {
  const root = tmp();
  try {
    const mod = 'file://' + fileURLToPath(new URL('../src/live/claims.js', import.meta.url)).replace(/\\/g, '/');
    const run = (agent) => new Promise((resolve, reject) => {
      const code = `import(${JSON.stringify(mod)}).then(m => { const c = m.createClaims(${JSON.stringify(root)}); const out = []; for (let i = 0; i < 20; i++) out.push(c.claim({ agent: ${JSON.stringify(agent)}, sessionId: 'x', paths: ['p' + i + '.md'] }).granted.length); console.log(JSON.stringify(out)); })`;
      const ch = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
      let o = ''; ch.stdout.on('data', (d) => (o += d)); ch.on('error', reject);
      ch.on('close', () => { try { resolve(JSON.parse(o)); } catch (e) { reject(e); } });
    });
    const [a, b] = await Promise.all([run('claude'), run('codex')]);
    for (let i = 0; i < 20; i++) assert.equal(a[i] + b[i], 1, `exactly one holder of p${i}.md`);
    assert.equal(createClaims(root).list().length, 20);
  } finally { rmTemp(root); }
});

test('handoffs: stored, filtered, masked, validated', () => {
  const root = tmp();
  try {
    const h = createHandoffs(root);
    assert.throws(() => h.add({ agent: 'claude' }), /needs/);
    h.add({ agent: 'claude', sessionId: 's1', taskId: 'n1', summary: 'parser done', done: '- parser\n- tests', next: ['wire UI'], blockers: [`need ${KEY}`] });
    h.add({ agent: 'codex', sessionId: 's2', summary: 'other' });
    const all = h.list();
    assert.equal(all.length, 2);
    const t = h.list({ taskId: 'n1' });
    assert.equal(t.length, 1); assert.deepEqual(t[0].done, ['parser', 'tests']);
    assert.ok(!JSON.stringify(t).includes('Zq9Xw8Vu7Ts6Rp5On4Ml3Zq9'));
    fs.appendFileSync(path.join(root, '.agentneuron', 'handoffs.jsonl'), '{"id":5}\nnot json\n{"id":"hx","ts":1,"agent":"a b/c","summary":"' + KEY + '"}\n');
    const rows = h.list({ limit: 50 });
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => !r.summary.includes('Zq9Xw8Vu7Ts6Rp5On4Ml3Zq9') && /^[\w.@-]+$/.test(r.agent)));
  } finally { rmTemp(root); }
});

test('coord: assignee names fit the board, role views strip prompts and hunks', () => {
  assert.equal(assigneeFor('claude-code', 'a1b2c3d4-e5f6'), 'claude-code.a1b2c3d4');
  assert.match(assigneeFor('123', '::'), /^[A-Za-z][\w.-]{0,40}$/);
  const snap = { sessions: [{ sessionId: 's', lastPrompt: 'p', lastThinking: 't' }], edits: [{ id: 'e', hunk: [{ type: 'add', text: 'x' }] }], notes: [{ text: 'p' }] };
  const loop = liveAccess({ host: '127.0.0.1' });
  assert.equal(snapshotFor(snap, 'admin', loop).sessions[0].lastPrompt, 'p');
  const v = snapshotFor(snap, 'viewer', loop);
  assert.equal(v.sessions[0].lastPrompt, undefined); assert.deepEqual(v.edits[0].hunk, []); assert.equal(v.notes.length, 0);
  const remote = liveAccess({ host: '0.0.0.0' });
  assert.equal(snapshotFor(snap, 'admin', remote).notes.length, 0, 'prompts off for a non-loopback bind by default');
  assert.equal(snapshotFor(snap, 'admin', liveAccess({ host: '0.0.0.0', live: { showPrompts: true } })).notes.length, 1);
});

async function mcp(root, level) {
  const input = new PassThrough(), output = new PassThrough();
  const lines = []; let buf = '';
  output.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const done = runMcpServer(root, {}, { input, output, noWatch: true, level });
  let id = 0;
  const rpc = async (method, params) => {
    const my = ++id;
    input.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
    for (let t = 0; t < 400; t++) { const m = lines.find((l) => l.id === my); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error('timeout');
  };
  const call = async (name, args) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { isError: r.isError, data: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) }; };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } });
  return { rpc, call, close: async () => { input.end(); await done; } };
}

test('MCP coordination: write tools hidden and refused at read level; claims/handoffs/claim_task at state', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'TODO.md'), '# Todo\n\n- [ ] Build parser\n');
  try {
    const r = await mcp(root, undefined);
    const names = (await r.rpc('tools/list', {})).result.tools.map((t) => t.name);
    assert.ok(names.includes('list_claims') && names.includes('get_handoffs'));
    for (const w of ['claim_task', 'claim_files', 'release_files', 'handoff_note']) {
      assert.ok(!names.includes(w), `${w} hidden at read level`);
      const res = await r.call(w, { paths: ['a.md'], id: 'x', summary: 's' });
      assert.equal(res.isError, true); assert.match(res.data, /--level state/);
    }
    assert.ok(!fs.existsSync(path.join(root, '.agentneuron', 'claims.json')));
    await r.close();

    const a = await mcp(root, 'state');
    const b = await mcp(root, 'state');
    const names2 = (await a.rpc('tools/list', {})).result.tools.map((t) => t.name);
    assert.ok(names2.includes('claim_files') && names2.includes('claim_task'));
    const c1 = await a.call('claim_files', { paths: ['src/**'], note: 'refactor' });
    assert.deepEqual(c1.data.granted, ['src/**']);
    assert.equal(c1.data.claims[0].agent, 'claude-code');
    const c2 = await b.call('claim_files', { paths: ['src/x.js'], agent: 'codex', sessionId: 'cx' });
    assert.deepEqual(c2.data.granted, []); assert.equal(c2.data.conflicts[0].heldBy.agent, 'claude-code');
    assert.equal((await b.call('list_claims', { path: 'src/x.js' })).data.claims.length, 1);
    assert.equal((await b.call('claim_files', { paths: ['../x'] })).isError, true);

    const board = (await a.call('get_tasks', {})).data;
    assert.equal(board.total, 1);
    // claim the markdown task: assignee + in-progress land in the overlay (no edit level)
    const list = parseMdTasks('TODO.md', fs.readFileSync(path.join(root, 'TODO.md'), 'utf8'));
    const ct = await a.call('claim_task', { id: list[0].id, sessionId: 'abc12345-xyz' });
    assert.equal(ct.isError, false, ct.data);
    assert.equal(ct.data.task.status, 'doing'); assert.equal(ct.data.assignee, 'claude-code.abc12345');
    assert.equal(fs.readFileSync(path.join(root, 'TODO.md'), 'utf8'), '# Todo\n\n- [ ] Build parser\n', 'markdown untouched without edit level');

    const h = await a.call('handoff_note', { summary: 'parser half done', next: ['tests'], taskId: list[0].id });
    assert.equal(h.data.handoff.agent, 'claude-code');
    assert.equal((await b.call('get_handoffs', { taskId: list[0].id })).data.handoffs[0].summary, 'parser half done');
    assert.equal((await a.call('release_files', {})).data.released, 1);
    await a.close(); await b.close();
  } finally { rmTemp(root); }
});

function sse(url, headers, onEvent) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers }, (res) => {
      let buf = '';
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (name && data) onEvent(name, JSON.parse(data));
        }
      });
      resolve(req);
    });
  });
}

test('HTTP: /api/live snapshot + SSE agent.* events per role; claims/handoffs routes gated at state', async () => {
  const base = tmp();
  const root = path.join(base, 'proj'), home = path.join(base, 'home');
  fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# P\n');
  const cdir = path.join(home, '.claude', 'projects', projectDirName(root));
  fs.mkdirSync(cdir, { recursive: true });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home; process.env.USERPROFILE = home;
  let srv;
  const reqs = [];
  try {
    srv = await startServer(loadConfig(root, { port: 0, token: 'view-t', adminToken: 'admin-t' }));
    const url = `http://127.0.0.1:${srv.port}`;
    const A = { authorization: 'Bearer admin-t' }, V = { authorization: 'Bearer view-t' };
    const got = { admin: [], viewer: [] };
    reqs.push(await sse(url + '/api/stream', A, (n, d) => got.admin.push([n, d])));
    reqs.push(await sse(url + '/api/stream', V, (n, d) => got.viewer.push([n, d])));
    await new Promise((r) => setTimeout(r, 100));
    const t = new Date().toISOString();
    fs.writeFileSync(path.join(cdir, 's1.jsonl'),
      JSON.stringify({ type: 'user', sessionId: 's1', timestamp: t, message: { content: 'rewrite the readme please' } }) + '\n' +
      JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: t, message: { model: 'claude-x', content: [{ type: 'tool_use', id: 'u1', name: 'Edit', input: { file_path: path.join(root, 'CLAUDE.md'), old_string: '# P', new_string: `# P\nkey ${KEY}` } }] } }) + '\n');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# P\nkey ${KEY}\n`);
    const until = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 100)); } };
    await until(() => got.admin.some(([n, d]) => n === 'agent.edit' && d.status === 'confirmed') && got.viewer.some(([n]) => n === 'agent.edit'));
    const ae = got.admin.filter(([n]) => n === 'agent.edit').map(([, d]) => d);
    assert.ok(ae.length, 'admin got agent.edit');
    const e = ae.at(-1);
    for (const k of ['id', 'tool', 'sessionId', 'path', 'op', 'linesAdded', 'linesRemoved', 'hunk', 'status', 'ts']) assert.ok(k in e, k);
    assert.equal(e.path, 'CLAUDE.md'); assert.equal(e.status, 'confirmed');
    assert.ok(e.hunk.length > 0); assert.ok(!JSON.stringify(got).includes('Zq9Xw8Vu7Ts6Rp5On4Ml3Zq9'), 'secrets masked on the stream');
    assert.ok(got.admin.some(([n]) => n === 'agent.prompt'), 'loopback admin sees prompts');
    assert.ok(!got.viewer.some(([n]) => n === 'agent.prompt' || n === 'agent.thinking'), 'viewer gets no prompts');
    assert.ok(got.viewer.filter(([n]) => n === 'agent.edit').every(([, d]) => d.hunk.length === 0 && d.hunkHidden));
    assert.ok(got.viewer.filter(([n]) => n === 'agent.session').every(([, d]) => !('lastPrompt' in d)));
    assert.ok(got.admin.some(([n, d]) => n === 'agent.session' && d.state === 'start' && d.tool === 'claude'));
    // events of other kinds still arrive (backward compatible stream)
    await until(() => got.viewer.some(([n]) => n === 'event'));
    assert.ok(got.viewer.some(([n]) => n === 'event'));

    const snap = await (await fetch(url + '/api/live', { headers: A })).json();
    assert.equal(snap.sessions[0].sessionId, 's1'); assert.equal(snap.sessions[0].lastPrompt, 'rewrite the readme please');
    assert.equal(snap.editing[0].path, 'CLAUDE.md');
    const vs = await (await fetch(url + '/api/live', { headers: V })).json();
    assert.equal(vs.sessions[0].lastPrompt, undefined); assert.equal(vs.notes.length, 0);

    const post = (p, body, h) => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
    assert.equal((await post('/api/live/claims', { paths: ['docs/**'] }, V)).status, 403);
    const cl = await (await post('/api/live/claims', { paths: ['docs/**'], agent: 'claude', sessionId: 's1' }, A)).json();
    assert.deepEqual(cl.granted, ['docs/**']);
    const conflict = await (await post('/api/live/claims', { paths: ['docs/a.md'] }, A)).json();
    assert.equal(conflict.conflicts[0].heldBy.sessionId, 's1');
    assert.equal((await post('/api/live/claims', { paths: ['../x'] }, A)).status, 400);
    assert.equal((await (await fetch(url + '/api/live/claims', { headers: V })).json()).claims.length, 1);
    assert.equal((await post('/api/live/handoff', { summary: 'x' }, V)).status, 403);
    assert.equal((await post('/api/live/handoff', { summary: 'done for today', next: ['ship'] }, A)).status, 200);
    assert.equal((await (await fetch(url + '/api/live/handoffs', { headers: V })).json()).handoffs[0].summary, 'done for today');
    await until(() => got.admin.some(([n]) => n === 'agent.claims') && got.admin.some(([n]) => n === 'agent.handoff'));
    assert.ok(got.admin.some(([n]) => n === 'agent.claims'));
    assert.equal((await post('/api/live/release', { agent: 'claude', sessionId: 's1' }, A)).status, 200);
  } finally {
    for (const r of reqs) r.destroy();
    await srv?.close();
    process.env.HOME = saved.HOME; process.env.USERPROFILE = saved.USERPROFILE;
    if (saved.USERPROFILE === undefined) delete process.env.USERPROFILE;
    rmTemp(base);
  }
});
