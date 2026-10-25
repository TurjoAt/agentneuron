import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../src/mcp/server.js', import.meta.url));

test('MCP stdio server: initialize, tools/list, tools/call', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-mcp-'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Proj\nSee @docs/plan.md\n- [ ] ship it\napi_key = "sk-ant-api03-' + 'Zq9Xw8Vu7Ts6Rp5On4Ml3'.repeat(2) + '"\n');
  fs.writeFileSync(path.join(root, 'docs/plan.md'), '# Plan\n- [x] done thing\nneedle here\n');
  const child = spawn(process.execPath, ['-e', `import(${JSON.stringify('file://' + server)}).then(m => m.runMcpServer(${JSON.stringify(root)}, {}))`], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiters = new Map();
  const lines = [];
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      lines.push(line);
      const m = JSON.parse(line); // every stdout line must be valid JSON-RPC
      assert.equal(m.jsonrpc, '2.0');
      waiters.get(m.id)?.(m);
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const myId = ++id;
    const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 10000);
    waiters.set(myId, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
  const call = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args });
    return { isError: r.result.isError, data: r.result.isError ? r.result.content[0].text : JSON.parse(r.result.content[0].text) };
  };
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'agentneuron');
    assert.ok(init.result.capabilities.tools);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const list = await rpc('tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['compile_preview', 'get_context', 'get_health', 'get_links', 'get_tasks', 'list_files', 'project_info', 'read_file', 'recent_changes', 'report_export', 'search']);
    for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');

    const files = await call('list_files', {});
    assert.deepEqual(files.data.map((f) => f.path).sort(), ['CLAUDE.md', 'docs/plan.md']);
    const rf = await call('read_file', { path: 'docs/plan.md' });
    assert.match(rf.data.content, /needle/);
    const secret = await call('read_file', { path: 'CLAUDE.md' });
    assert.ok(!secret.data.content.includes('Zq9Xw8Vu7Ts6Rp5On4Ml3Zq9'));
    assert.equal((await call('read_file', { path: '../etc/passwd' })).isError, true);
    assert.equal((await call('read_file', { path: '/etc/passwd' })).isError, true);
    assert.equal((await call('search', { query: 'NEEDLE' })).data[0].path, 'docs/plan.md');
    assert.ok((await call('get_health', {})).data.score >= 0);
    const ctx = await call('get_context', { dir: '', tool: 'claude' });
    assert.ok(ctx.data.chain.some((c) => c.path === 'CLAUDE.md'));
    assert.ok(ctx.data.chain.some((c) => c.path === 'docs/plan.md' && c.reason === 'import'));
    assert.ok((await call('recent_changes', { since: '1h' })).data.changed.length >= 2);
    assert.equal((await call('get_tasks', { status: 'open' })).data.tasks[0].text, 'ship it');
    assert.equal((await call('get_tasks', { status: 'done' })).data.total, 1);
    assert.equal((await call('get_links', { path: 'CLAUDE.md' })).data.out[0].to, 'docs/plan.md');
    assert.equal((await call('project_info', {})).data.files, 2);
    const ai = await rpc('tools/call', { name: 'report_export', arguments: { range: '7d', format: 'ai', includeContent: true } });
    assert.equal(ai.result.isError, false);
    const md = ai.result.content[0].text;
    assert.match(md, /^---\nschema: "agentneuron\.report\/v1"/);
    assert.match(md, /## Suggested next actions/);
    assert.match(md, /### CLAUDE\.md/);
    assert.match(md, /- \[ \] ship it/);
    assert.ok(!md.includes('Zq9Xw8Vu7Ts6Rp5On4Ml3Zq9'), 'secret leaked');
    assert.ok(!md.includes(root), 'absolute root leaked');
    const js = await call('report_export', { range: '30d', format: 'json' });
    assert.equal(js.data.schema, 'agentneuron.report/v1');
    assert.equal(js.data.tasks.open, 1);
    assert.deepEqual(js.data.contextFiles.map((f) => f.path).sort(), ['CLAUDE.md', 'docs/plan.md']);
    assert.equal((await call('report_export', { range: 'forever' })).isError, true);
    assert.equal((await call('report_export', { format: 'csv' })).isError, true);
    assert.equal((await rpc('nope/method', {})).error.code, -32601);
    assert.equal((await rpc('tools/call', { name: 'zzz' })).error.code, -32602);
    child.stdin.write('not json\n');
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(lines.some((l) => JSON.parse(l).error?.code === -32700));
  } finally {
    child.stdin.end();
    await new Promise((r) => { child.on('close', r); setTimeout(() => { child.kill(); r(); }, 3000); });
  }
});
