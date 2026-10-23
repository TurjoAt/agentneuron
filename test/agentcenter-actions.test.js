import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import registerActions from '../src/actions/agents.js';
import registerRoutes from '../src/server/routes/agentcenter.js';
import { createRouter } from '../src/server/router.js';
import { createStore } from '../src/core/store.js';
import { loadConfig } from '../src/core/config.js';
import { testMcpServer } from '../src/agentcenter/mcptest.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-act-'));

function fakeRegistry() {
  const defs = new Map();
  return { defs, register(d) { assert.ok(!defs.has(d.id)); assert.ok(d.title && d.category === 'agents' && ['edit', 'exec'].includes(d.level) && d.params); defs.set(d.id, d); } };
}
const job = () => ({ logs: [], log(s, t) { this.logs.push([s, t]); }, signal: new AbortController().signal });

test('actions: create, sync, permissions, hooks, mcp add/remove', async () => {
  const root = tmp();
  const reg = fakeRegistry();
  registerActions(reg, { root, store: null });
  assert.deepEqual([...reg.defs.keys()].sort(), ['agents.create', 'agents.hooks.update', 'agents.mcp.add', 'agents.mcp.remove', 'agents.mcp.test', 'agents.permissions.update', 'agents.sync.apply']);
  assert.equal(reg.defs.get('agents.mcp.test').level, 'exec');
  const run = (id, p) => reg.defs.get(id).run(p, {}, job());

  const c = await run('agents.create', { template: 'claude-skill', vars: JSON.stringify({ name: 'demo' }) });
  assert.equal(c.path, '.claude/skills/demo/SKILL.md');
  await assert.rejects(run('agents.create', { template: 'claude-skill', vars: '{"name":"demo"}' }), /already exists/);
  await assert.rejects(run('agents.create', { template: 'readme', path: '../x.md' }), /invalid path/);
  await assert.rejects(run('agents.create', { template: 'readme', path: '/tmp/x.md' }), /invalid path/);

  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# hi\n- a rule here\n');
  const s = await run('agents.sync.apply', { source: 'AGENTS.md', targets: ['CLAUDE.md', '.cursorrules'] });
  assert.deepEqual(s.written.sort(), ['.cursorrules', 'CLAUDE.md']);
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), '# hi\n- a rule here\n');
  assert.deepEqual((await run('agents.sync.apply', { source: 'AGENTS.md', targets: ['CLAUDE.md'] })).written, []);

  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude/settings.json'), JSON.stringify({ model: 'opus', permissions: { defaultMode: 'plan' } }));
  await run('agents.permissions.update', { file: '.claude/settings.json', allow: ['Bash(git status)'], deny: ['Read(.env)'] });
  const j = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  assert.equal(j.model, 'opus');
  assert.equal(j.permissions.defaultMode, 'plan');
  assert.deepEqual(j.permissions.allow, ['Bash(git status)']);
  await assert.rejects(run('agents.permissions.update', { file: '../evil.json', allow: [] }), /unsupported/);

  await run('agents.hooks.update', { file: '.claude/settings.json', hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo x' }] }] } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8')).hooks.PostToolUse[0].hooks[0].command, 'echo x');
  await assert.rejects(run('agents.hooks.update', { file: '.claude/settings.json', hooks: { Bogus: [] } }), /unknown hook event/);

  await run('agents.mcp.add', { name: 'srv', type: 'stdio', command: 'node', args: ['a.js'] });
  await run('agents.mcp.add', { name: 'remote', type: 'http', url: 'https://example.com/mcp' });
  await assert.rejects(run('agents.mcp.add', { name: 'srv', type: 'stdio', command: 'node' }), /already exists/);
  await assert.rejects(run('agents.mcp.add', { name: 'bad', type: 'http', url: 'file:///etc/passwd' }), /http/);
  const m = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(m.mcpServers).sort(), ['remote', 'srv']);
  await run('agents.mcp.remove', { name: 'srv' });
  await assert.rejects(run('agents.mcp.remove', { name: 'srv' }), /not found/);
});

test('mcp test action spawns a stdio server, lists tools and kills it', async () => {
  const root = tmp();
  const script = path.join(root, 'srv.js');
  fs.writeFileSync(script, `
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (l) => { const m = JSON.parse(l);
  if (m.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake', version: '1' }, capabilities: {} } }));
  if (m.method === 'tools/list') console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 't1', description: 'one' }] } })); });
`);
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { fake: { command: process.execPath, args: [script], env: { SECRET_TOKEN: 'abc' } }, dead: { command: process.execPath, args: ['-e', 'process.exit(3)'] }, nope: { command: 'definitely-not-a-binary-xyz' } } }));
  const reg = fakeRegistry();
  registerActions(reg, { root });
  const t = reg.defs.get('agents.mcp.test');
  const ok = await t.run({ name: 'fake' }, {}, job());
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.tools.map((x) => x.name), ['t1']);
  assert.equal(ok.serverInfo.name, 'fake');
  assert.ok(!JSON.stringify(ok).includes('abc'));
  assert.equal((await t.run({ name: 'dead' }, {}, job())).ok, false);
  assert.equal((await t.run({ name: 'nope' }, {}, job())).ok, false);
  await assert.rejects(t.run({ name: 'missing' }, {}, job()), /not found/);
  const timedOut = await testMcpServer({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }, { timeoutMs: 300 });
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.error, /timeout/);
});

test('routes: setup, rules-for, templates, render, sync, context', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# V1\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# V1\n');
  const store = createStore(root, loadConfig(root));
  await store.init();
  const router = createRouter();
  const ctx = { root, config: {}, store, allFiles: () => [...store.files.values()], sessions: { list: async () => [] }, home: tmp() };
  await registerRoutes(router, ctx);
  const call = async (method, p, query = {}, body = {}) => router.match(method, p).fn({ q: new URLSearchParams(query), body, ctx });
  assert.ok((await call('GET', '/api/agents/setup')).tools.find((t) => t.id === 'claude').detected);
  assert.equal((await call('GET', '/api/agents/rules-for', { path: 'src/x.ts' })).filter((r) => r.reason === 'always').length, 2);
  await assert.rejects(call('GET', '/api/agents/rules-for', { path: '../x' }), /invalid path/);
  assert.ok((await call('GET', '/api/agents/templates')).length >= 14);
  assert.match((await call('GET', '/api/agents/template/render', { id: 'readme', vars: '{"project":"Zed"}' })).content, /^# Zed/);
  assert.equal((await call('GET', '/api/agents/sync/status')).pairs[0].status, 'identical');
  assert.equal((await call('POST', '/api/agents/sync/plan', {}, { source: 'AGENTS.md', targets: ['gemini'] }))[0].target, 'GEMINI.md');
  assert.equal((await call('GET', '/api/agents/costs')).sessions.length, 0);
  assert.match((await call('GET', '/api/context/at', { dir: '', tool: 'claude', ts: String(Date.now()) })).text, /V1/);
  assert.ok((await call('GET', '/api/context/diff', { from: String(Date.now() - 1000) })).diff);
  await assert.rejects(call('GET', '/api/context/at', { tool: 'claude' }), /ts required/);
});
