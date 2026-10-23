import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderTemplate, listTemplates } from '../src/agentcenter/templates.js';
import { syncPlan } from '../src/agentcenter/sync.js';
import { testMcpServer } from '../src/agentcenter/mcptest.js';
import { readTranscriptUsage, locateTranscript } from '../src/agentcenter/transcript.js';
import { estimateCosts } from '../src/agentcenter/costs.js';
import { scanAgentSetup } from '../src/agentcenter/setup.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-acsec-'));
const SECRET = 'sk-ant-api03-' + 'Zq9Xw8Vu7Ts6Rp5On4Ml3'.repeat(2);

test('templates: no variable can traverse out of the output path', () => {
  const evil = ['../../../../etc/passwd', '..\\..\\x', '/abs/path', 'a/b/c', '\0', '....//', '%2e%2e/x', '.', '..', ''];
  for (const t of listTemplates()) {
    const vars = Object.fromEntries(t.vars.map((v) => [v.name, evil[0]]));
    for (const e of evil) {
      for (const k of Object.keys(vars)) vars[k] = e;
      let r;
      try { r = renderTemplate(t.id, { ...vars, number: e, date: e, topic: e, title: e, name: e, project: e }); } catch { continue; }
      assert.ok(!r.path.startsWith('/'), `${t.id}: ${r.path}`);
      assert.ok(!r.path.includes('\\') && !r.path.includes('\0'), `${t.id}: ${r.path}`);
      assert.ok(!r.path.split('/').some((s) => s === '..' || s === '.' || s === ''), `${t.id}: ${r.path}`);
      assert.equal(path.posix.normalize(r.path), r.path, `${t.id}: ${r.path}`);
    }
  }
});

test('templates: prototype keys and object values are not substituted', () => {
  const r = renderTemplate('adr', { number: { x: 1 }, __proto__: 'x', constructor: 'y', title: 'Use {{number}}' });
  assert.ok(!/function Object|\[native code\]/.test(r.content));
});

test('syncPlan: symlinked source/target/parent cannot read or reach outside the root', { skip: process.platform === 'win32' }, () => {
  const root = tmp();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret.txt'), `TOP SECRET ${SECRET}\n`);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# real\n- rule one here\n');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'GEMINI.md'));
  fs.symlinkSync(outside, path.join(root, 'linked'));
  // symlinked source is refused (content would otherwise be returned in the plan)
  assert.throws(() => syncPlan(root, { source: 'GEMINI.md', targets: ['CLAUDE.md'] }), /not readable/);
  assert.throws(() => syncPlan(root, { source: 'linked/secret.txt', targets: ['CLAUDE.md'] }), /not readable/);
  // symlinked target: its (outside) content must not be read into the diff
  assert.throws(() => syncPlan(root, { source: 'AGENTS.md', targets: ['GEMINI.md'] }), /not a regular file/);
  // new file under a symlinked directory would be written outside the root
  assert.throws(() => syncPlan(root, { source: 'AGENTS.md', targets: ['linked/new.md'] }), /escapes project root/);
  assert.throws(() => syncPlan(root, { source: 'AGENTS.md', targets: ['../x.md'] }), /invalid path/);
  assert.throws(() => syncPlan(root, { source: '../x.md', targets: ['a.md'] }), /invalid path/);
  // the normal case still works
  const ok = syncPlan(root, { source: 'AGENTS.md', targets: ['CLAUDE.md', '.github/copilot-instructions.md'] });
  assert.deepEqual(ok.map((p) => p.target), ['CLAUDE.md', '.github/copilot-instructions.md']);
});

test('mcptest: no shell, bad input rejected, env values never echoed, hostile server cannot crash us', async () => {
  // shell metacharacters are passed as a literal argv entry, never interpreted
  const marker = path.join(tmp(), 'pwned');
  const r1 = await testMcpServer({ command: 'echo', args: [`; touch ${marker}`] }, { timeoutMs: 3000 });
  assert.equal(r1.ok, false);
  assert.ok(!fs.existsSync(marker));
  for (const def of [null, 5, {}, { command: '' }, { command: 'a\0b' }, { command: 'x', args: ['a\0b'] }, { url: 'ftp://x' }, { url: 'javascript:alert(1)' }, { url: 'http://u:p@127.0.0.1:1/' }, { url: 'http://169.254.169.254/' }]) {
    const r = await testMcpServer(def, { timeoutMs: 2000 });
    assert.equal(r.ok, false, JSON.stringify(def));
  }
  // missing command: error does not echo the command line / args
  const r2 = await testMcpServer({ command: 'definitely-not-a-command-xyz', args: [`--token=${SECRET}`], env: { API_KEY: SECRET } }, { timeoutMs: 3000 });
  assert.equal(r2.ok, false);
  assert.ok(!JSON.stringify(r2).includes('Zq9Xw8Vu7Ts6Rp5On4Ml3'));
  assert.ok(!JSON.stringify(r2).includes('definitely-not-a-command'));

  // hostile server: null tool entries / non-object payloads / secret in stderr+description / secret env
  const script = `
    const rl = require('readline').createInterface({ input: process.stdin });
    console.error('boot ' + process.env.MY_SECRET);
    rl.on('line', (l) => {
      const m = JSON.parse(l);
      if (m.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: 'str', protocolVersion: 'x' } }));
      if (m.method === 'tools/list') console.log(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [null, 5, 'x', { name: { a: 1 }, description: process.env.MY_SECRET }, { name: 'ok', description: 'd' }] } }));
    });
    console.log('null'); console.log('[1]'); console.log('"s"');`;
  const r3 = await testMcpServer({ command: process.execPath, args: ['-e', script], env: { MY_SECRET: SECRET } }, { timeoutMs: 5000 });
  assert.equal(r3.ok, true, JSON.stringify(r3));
  assert.ok(r3.tools.some((t) => t.name === 'ok'));
  assert.ok(!JSON.stringify(r3).includes('Zq9Xw8Vu7Ts6Rp5On4Ml3'));
  assert.equal(r3.serverInfo, null);
});

test('mcptest: timeout kills the child process group', { skip: process.platform === 'win32' }, async () => {
  const pidFile = path.join(tmp(), 'pid');
  const script = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const t0 = Date.now();
  const r = await testMcpServer({ command: process.execPath, args: ['-e', script] }, { timeoutMs: 600 });
  assert.equal(r.ok, false);
  assert.match(r.error, /timeout/);
  assert.ok(Date.now() - t0 < 5000);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  await new Promise((res) => setTimeout(res, 1500));
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, 'child must be killed');
});

test('mcptest: huge unterminated server output is bounded', async () => {
  const script = `process.stdin.on('data',()=>{}); const b='x'.repeat(65536); setInterval(()=>process.stdout.write(b),1);`;
  const r = await testMcpServer({ command: process.execPath, args: ['-e', script] }, { timeoutMs: 8000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /too large/);
});

test('transcript usage: "__proto__" model names and absurd timestamps do not pollute or throw', () => {
  const dir = tmp();
  const f = path.join(dir, 's.jsonl');
  const line = (o) => JSON.stringify(o);
  fs.writeFileSync(f, [
    line({ type: 'assistant', timestamp: 1e20, message: { id: 'a', model: '__proto__', usage: { input_tokens: 5, output_tokens: 1 } } }),
    line({ type: 'assistant', timestamp: '2025-01-01T00:00:00Z', message: { id: 'b', model: 'constructor', usage: { input_tokens: 7 } } }),
    line({ type: 'assistant', timestamp: 'garbage', message: { id: 'c', model: 'claude-sonnet-4', usage: 'nope' } }),
  ].join('\n'));
  const u = readTranscriptUsage(f, 'claude');
  assert.equal(({}).input, undefined);
  assert.equal(Object.prototype.input, undefined);
  assert.equal(u.models.constructor.input, 7);
  const c = estimateCosts([{ sessionId: 's', tool: 'claude', lastAt: 1e20, tokens: { input: 1 } }], { s: u });
  assert.equal(c.sessions.length, 1);
  estimateCosts([{ sessionId: 's2', tool: 'claude', lastAt: 1e20, startedAt: 1, tokens: { input: 1 } }], {});
});

test('transcript: session ids cannot traverse; codex lookup needs an exact id match', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.codex', 'sessions', '2025'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'sessions', '2025', 'rollout-2025-abc123.jsonl'), '{}\n');
  for (const id of ['../../etc/passwd', '..', 'a/b', '', 'x'.repeat(300), null, 5]) assert.equal(locateTranscript(id, { home }), null, String(id));
  assert.equal(locateTranscript('c123', { home }), null);
  assert.ok(locateTranscript('abc123', { home }));
});

test('setup scan: a symlinked config pointing outside the project is not read', { skip: process.platform === 'win32' }, () => {
  const root = tmp();
  const outside = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'r.md'), `---\ndescription: leaked ${SECRET}\n---\nbody\n`);
  fs.symlinkSync(path.join(outside, 'r.md'), path.join(root, '.claude', 'rules', 'evil.md'));
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'ok.md'), '---\ndescription: fine\n---\nbody\n');
  const s = scanAgentSetup(root, { includeGlobal: false });
  const rules = s.tools.find((t) => t.id === 'claude').capabilities.rules.items;
  assert.deepEqual(rules.map((r) => r.name), ['ok']);
  assert.ok(!JSON.stringify(s).includes('Zq9Xw8Vu7Ts6Rp5On4Ml3'));
});
