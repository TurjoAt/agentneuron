import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { runMcpServer } from '../src/mcp/server.js';

const SECRET = 'sk-ant-api03-' + 'Zq9Xw8Vu7Ts6Rp5On4Ml3'.repeat(2);

async function session(setup) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-mcpsec-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-mcpout-'));
  setup(root, outside);
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = [];
  const waiters = [];
  let buf = '';
  output.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      const m = JSON.parse(l);
      lines.push(m);
      waiters.splice(0).forEach((w) => w());
    }
  });
  const done = runMcpServer(root, {}, { input, output, noWatch: true });
  const next = async (n) => {
    const t0 = Date.now();
    while (lines.length < n) {
      if (Date.now() - t0 > 8000) throw new Error('timeout waiting for reply');
      await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });
    }
  };
  let sent = 0;
  return {
    root, outside, lines,
    raw: async (s) => { sent++; input.write(s + '\n'); await next(sent); return lines[sent - 1]; },
    call: async (name, args) => {
      sent++;
      input.write(JSON.stringify({ jsonrpc: '2.0', id: sent, method: 'tools/call', params: { name, arguments: args } }) + '\n');
      await next(sent);
      const r = lines[sent - 1];
      return { isError: r.result.isError, text: r.result.content[0].text };
    },
    close: async () => { input.end(); await done; },
  };
}

test('mcp: path arguments cannot escape the root (traversal, absolute, symlink)', async () => {
  const s = await session((root, outside) => {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# ok\n');
    fs.writeFileSync(path.join(outside, 'CLAUDE.md'), `# outside\n${SECRET}\n`);
    try { fs.symlinkSync(path.join(outside, 'CLAUDE.md'), path.join(root, 'AGENTS.md')); } catch { /* no symlinks */ }
    try { fs.symlinkSync(outside, path.join(root, 'docs')); } catch { /* ignore */ }
  });
  try {
    for (const p of ['../x', '/etc/passwd', 'C:\\x', 'a/../../b', 'AGENTS.md', 'docs/CLAUDE.md', '\0', '', 42, null, { a: 1 }]) {
      const r = await s.call('read_file', { path: p });
      assert.equal(r.isError, true, String(p));
      assert.ok(!r.text.includes('Zq9Xw8Vu7Ts6Rp5On4Ml3'));
    }
    assert.equal((await s.call('get_links', { path: '../x' })).isError, true);
    assert.equal((await s.call('get_context', { dir: '../..' })).isError, true);
    assert.equal((await s.call('get_context', { dir: '/etc' })).isError, true);
    assert.equal((await s.call('get_context', { dir: 'a', tool: 'nope' })).isError, true);
    const list = JSON.parse((await s.call('list_files', {})).text);
    assert.deepEqual(list.map((f) => f.path), ['CLAUDE.md']);
  } finally { await s.close(); }
});

test('mcp: secrets are masked in every output, and search cannot probe secret values', async () => {
  const s = await session((root) => {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# Title ${SECRET}\napi_key = "${SECRET}"\n- [ ] TODO use ${SECRET}\nSee [x](${SECRET})\n`);
  });
  try {
    const all = [];
    all.push((await s.call('read_file', { path: 'CLAUDE.md' })).text);
    all.push((await s.call('list_files', {})).text);
    all.push((await s.call('get_context', {})).text);
    all.push((await s.call('get_tasks', { status: 'all' })).text);
    all.push((await s.call('get_health', {})).text);
    all.push((await s.call('get_links', { path: 'CLAUDE.md' })).text);
    all.push((await s.call('search', { query: 'api_key' })).text);
    for (const t of all) assert.ok(!t.includes('Zq9Xw8Vu7Ts6Rp5On4Ml3'), t.slice(0, 200));
    // searching for the secret value itself must not confirm it exists
    const probe = JSON.parse((await s.call('search', { query: 'Zq9Xw8Vu7Ts6Rp5On4Ml3' })).text);
    assert.deepEqual(probe, []);
  } finally { await s.close(); }
});

test('mcp: tool results are size-limited', async () => {
  const s = await session((root) => {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'word '.repeat(150000)); // 750 KB
  });
  try {
    const r = await s.call('read_file', { path: 'CLAUDE.md' });
    assert.ok(r.text.length < 1024 * 1024 + 200);
    assert.equal(JSON.parse(r.text).truncated, true);
    const c = await s.call('get_context', {});
    assert.ok(c.text.length < 1024 * 1024 + 200);
  } finally { await s.close(); }
});

test('mcp: malformed JSON-RPC yields errors and never crashes', async () => {
  const s = await session((root) => fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# x\n'));
  try {
    assert.equal((await s.raw('{not json')).error.code, -32700);
    assert.equal((await s.raw('null')).error.code, -32600);
    assert.equal((await s.raw('123')).error.code, -32600);
    assert.equal((await s.raw('"str"')).error.code, -32600);
    assert.equal((await s.raw('[]')).error.code, -32600);
    assert.equal((await s.raw('{"jsonrpc":"1.0","id":7,"method":"ping"}')).error.code, -32600);
    assert.equal((await s.raw('{"jsonrpc":"2.0","id":8}')).error.code, -32600);
    assert.equal((await s.raw('{"jsonrpc":"2.0","id":9,"method":42}')).error.code, -32600);
    assert.equal((await s.raw('{"jsonrpc":"2.0","id":10,"method":"nope"}')).error.code, -32601);
    assert.equal((await s.raw('{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"__proto__"}}')).error.code, -32602);
    assert.equal((await s.raw('{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"constructor"}}')).error.code, -32602);
    assert.equal((await s.raw('{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":["list_files"]}}')).error.code, -32602);
    assert.equal((await s.raw('{"jsonrpc":"2.0","id":14,"method":"tools/call","params":"x"}')).error.code, -32602);
    const bad = await s.raw('{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"read_file","arguments":[1,2]}}');
    assert.equal(bad.result.isError, true);
    const sinceBad = await s.raw('{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"recent_changes","arguments":{"since":"garbage"}}}');
    assert.equal(sinceBad.result.isError, true);
    // still alive and answering
    const ok = await s.raw('{"jsonrpc":"2.0","id":17,"method":"tools/list"}');
    assert.equal(ok.result.tools.length, 10);
  } finally { await s.close(); }
});

test('mcp: tool surface is read-only (no write-capable tool names, schemas closed)', async () => {
  const s = await session((root) => fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# x\n'));
  try {
    const r = await s.raw('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    for (const t of r.result.tools) {
      assert.ok(!/write|edit|delete|create|exec|run|apply|move|rename|set_/i.test(t.name), t.name);
      assert.equal(t.inputSchema.additionalProperties, false);
    }
    const before = fs.readdirSync(s.root).sort();
    for (const t of r.result.tools) await s.call(t.name, { path: 'CLAUDE.md', query: 'x' });
    assert.deepEqual(fs.readdirSync(s.root).sort(), before);
    assert.equal(fs.readFileSync(path.join(s.root, 'CLAUDE.md'), 'utf8'), '# x\n');
  } finally { await s.close(); }
});
