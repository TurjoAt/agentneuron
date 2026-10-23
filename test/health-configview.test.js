import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAgentConfig, parseSimpleToml } from '../src/health/configview.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mdctl-cfg-'));
const w = (root, rel, c) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), typeof c === 'string' ? c : JSON.stringify(c)); };

test('empty project', () => {
  const r = readAgentConfig(tmp());
  assert.deepEqual(r.mcpServers, []);
  assert.deepEqual(r.hooks, []);
  assert.deepEqual(r.permissions, { allow: [], deny: [], ask: [], source: '' });
  assert.deepEqual(r.settingsFiles, []);
});

test('mcp servers, env/header values never leak', () => {
  const root = tmp();
  w(root, '.mcp.json', { mcpServers: {
    gh: { command: 'npx', args: ['-y', '@x/server'], env: { GITHUB_TOKEN: 'ghp_SUPERSECRETVALUE123456789012345678901234' } },
    remote: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer topsecretvalue1234567' } },
  } });
  w(root, '.cursor/mcp.json', { mcpServers: { cur: { url: 'https://c.example.com/sse' } } });
  const r = readAgentConfig(root);
  assert.deepEqual(r.mcpServers.map((s) => [s.name, s.type, s.source]), [['gh', 'stdio', '.mcp.json'], ['remote', 'http', '.mcp.json'], ['cur', 'http', '.cursor/mcp.json']]);
  assert.equal(r.mcpServers[0].command, 'npx -y @x/server');
  assert.equal(r.mcpServers[1].url, 'https://mcp.example.com/mcp');
  const dump = JSON.stringify(r);
  assert.ok(!dump.includes('SUPERSECRET') && !dump.includes('topsecret'));
  assert.deepEqual(r.mcpServers[0].envKeys, ['GITHUB_TOKEN']);
  assert.deepEqual(r.settingsFiles, ['.mcp.json', '.cursor/mcp.json']);
});

test('claude settings: hooks and permissions merged, secrets in commands masked', () => {
  const root = tmp();
  w(root, '.claude/settings.json', {
    permissions: { allow: ['Bash(npm test)'], deny: ['Read(.env)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }], Stop: [{ hooks: [{ type: 'command', command: 'curl -H "Authorization: Bearer abcdef1234567890XYZ" x' }] }] },
  });
  w(root, '.claude/settings.local.json', { permissions: { allow: ['Bash(git status)'], ask: ['Bash(rm:*)'] } });
  const r = readAgentConfig(root);
  assert.deepEqual(r.permissions.allow, ['Bash(npm test)', 'Bash(git status)']);
  assert.deepEqual(r.permissions.deny, ['Read(.env)']);
  assert.deepEqual(r.permissions.ask, ['Bash(rm:*)']);
  assert.equal(r.permissions.source, '.claude/settings.json, .claude/settings.local.json');
  assert.equal(r.hooks.length, 2);
  assert.deepEqual(r.hooks[0], { event: 'PreToolUse', matcher: 'Bash', command: 'echo hi', source: '.claude/settings.json' });
  assert.ok(!JSON.stringify(r.hooks).includes('abcdef1234567890XYZ'));
});

test('codex toml', () => {
  const root = tmp();
  w(root, '.codex/config.toml', `model = "gpt"\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs-mcp"]\n\n[mcp_servers.docs.env]\nAPI_KEY = "sk-supersecretsupersecretsupersecret12"\n\n[mcp_servers.web]\nurl = "https://w.example.com"\n`);
  const r = readAgentConfig(root);
  assert.deepEqual(r.mcpServers.map((s) => s.name), ['docs', 'web']);
  assert.equal(r.mcpServers[0].command, 'npx -y docs-mcp');
  assert.equal(r.mcpServers[1].type, 'http');
  assert.ok(!JSON.stringify(r).includes('supersecret'));
  assert.deepEqual(parseSimpleToml('a = 1\nb = true\n[t]\nc = "x" # note').t, { c: 'x' });
});

test('malformed json is tolerated', () => {
  const root = tmp();
  w(root, '.mcp.json', '{ nope');
  w(root, '.claude/settings.json', '[]');
  assert.deepEqual(readAgentConfig(root).mcpServers, []);
});
