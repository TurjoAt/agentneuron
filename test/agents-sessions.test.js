import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessions, projectDirName } from '../src/agents/sessions.js';

const T0 = Date.UTC(2026, 9, 23, 10, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-sess-'));
  const root = path.join(base, 'my.proj_x');
  const home = path.join(base, 'home');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { base, root, home, dir: path.join(home, '.claude', 'projects', projectDirName(root)) };
}

function transcript(root, sid, { start = T0, edit = 'CLAUDE.md' } = {}) {
  const lines = [
    { type: 'mode', mode: 'x', sessionId: sid },
    { type: 'user', sessionId: sid, timestamp: iso(start), cwd: root, message: { role: 'user', content: 'Please tidy the docs' } },
    { type: 'assistant', sessionId: sid, timestamp: iso(start + 1000), cwd: root, message: { id: 'm1', role: 'assistant', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }, content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Edit', input: { file_path: path.join(root, edit) } }] } },
    // same API message split over two lines: usage must be counted once
    { type: 'assistant', sessionId: sid, timestamp: iso(start + 1001), cwd: root, message: { id: 'm1', role: 'assistant', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }, content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/etc/passwd' } }, { type: 'tool_use', name: 'Read', input: { file_path: path.join(root, 'nope.md') } }] } },
    { type: 'user', sessionId: sid, timestamp: iso(start + 2000), cwd: root, message: { role: 'user', content: [{ type: 'tool_result', content: 'done' }] } },
    { type: 'user', sessionId: sid, timestamp: iso(start + 60000), cwd: root, message: { role: 'user', content: [{ type: 'text', text: 'Now fix README' }] } },
    { type: 'assistant', sessionId: sid, timestamp: iso(start + 61000), cwd: root, message: { id: 'm2', role: 'assistant', usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }, content: [{ type: 'tool_use', name: 'MultiEdit', input: { file_path: path.join(root, 'docs/a.md'), edits: [] } }] } },
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

test('projectDirName replaces every non-alphanumeric char', () => {
  if (process.platform === 'win32') assert.match(projectDirName('/opt/a-b/c.d_e'), /^[A-Za-z]--opt-a-b-c-d-e$/);
  else assert.equal(projectDirName('/opt/a-b/c.d_e'), '-opt-a-b-c-d-e');
});

test('list: stats, title, relative files, outside-root dropped', async () => {
  const { root, home, dir } = setup();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), transcript(root, 's1') + 'not json{{\n' + JSON.stringify({ type: 'summary', summary: 'Docs cleanup', leafUuid: 'x' }) + '\n');
  fs.writeFileSync(path.join(dir, 's2.jsonl'), transcript(root, 's2', { start: T0 + 3600000 }));
  const list = await createSessions(root, { home }).list();
  assert.equal(list.length, 2);
  assert.equal(list[0].sessionId, 's2'); // newest first
  const s1 = list.find((s) => s.sessionId === 's1');
  assert.equal(s1.tool, 'claude');
  assert.equal(s1.title, 'Docs cleanup');
  assert.equal(list[0].title, 'Please tidy the docs');
  assert.equal(s1.startedAt, T0);
  assert.equal(s1.lastAt, T0 + 61000);
  assert.equal(s1.messages, 7 - 1); // 6 user/assistant lines... see below
  assert.deepEqual(s1.tokens, { input: 11, output: 22, cacheRead: 103, cacheWrite: 9 });
  assert.deepEqual(s1.filesTouched.sort(), ['CLAUDE.md', 'docs/a.md']);
});

test('cache: unchanged file is not reparsed; appended lines are picked up', async () => {
  const { root, home, dir } = setup();
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 's1.jsonl');
  fs.writeFileSync(f, transcript(root, 's1'));
  const s = createSessions(root, { home });
  const a = await s.list();
  const b = await s.list();
  assert.deepEqual(a, b);
  fs.appendFileSync(f, JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: iso(T0 + 90000), message: { id: 'm9', usage: { input_tokens: 7, output_tokens: 0 }, content: [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(root, 'NEW.md') } }] } }) + '\n');
  const c = await s.list();
  assert.equal(c[0].tokens.input, a[0].tokens.input + 7);
  assert.ok(c[0].filesTouched.includes('NEW.md'));
  assert.equal(c[0].messages, a[0].messages + 1);
});

test('partial trailing line is deferred until complete', async () => {
  const { root, home, dir } = setup();
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 's1.jsonl');
  const line = JSON.stringify({ type: 'user', sessionId: 's1', timestamp: iso(T0), message: { content: 'hello there' } });
  fs.writeFileSync(f, line.slice(0, 20));
  const s = createSessions(root, { home });
  assert.equal((await s.list()).length, 0);
  fs.writeFileSync(f, line + '\n');
  const l = await s.list();
  assert.equal(l.length, 1);
  assert.equal(l[0].title, 'hello there');
});

test('attribute: closest touch within +-2 min, with prompt', async () => {
  const { root, home, dir } = setup();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), transcript(root, 's1'));
  fs.writeFileSync(path.join(dir, 's2.jsonl'), transcript(root, 's2', { start: T0 + 30000 }));
  const s = createSessions(root, { home });
  const ref = await s.attribute('CLAUDE.md', T0 + 1500);
  assert.equal(ref.sessionId, 's1');
  assert.equal(ref.tool, 'claude');
  assert.equal(ref.lastPrompt, 'Please tidy the docs');
  assert.equal(ref.ts, T0 + 1000);
  // later change closer to s2's touch
  assert.equal((await s.attribute('CLAUDE.md', T0 + 32000)).sessionId, 's2');
  // abs path and Date/ISO accepted
  assert.equal((await s.attribute(path.join(root, 'docs/a.md'), iso(T0 + 62000))).sessionId, 's1');
  assert.equal((await s.attribute('docs/a.md', new Date(T0 + 62000))).lastPrompt, 'Now fix README');
  // out of tolerance / untouched / outside root
  assert.equal(await s.attribute('CLAUDE.md', T0 + 10 * 60000), null);
  assert.equal(await s.attribute('other.md', T0 + 1000), null);
  assert.equal(await s.attribute('/etc/passwd', T0 + 1000), null);
});

test('fallback: dir name mismatch is resolved via cwd field', async () => {
  const { root, home } = setup();
  const odd = path.join(home, '.claude', 'projects', 'weird-name');
  const other = path.join(home, '.claude', 'projects', 'other-proj');
  fs.mkdirSync(odd, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(odd, 'x.jsonl'), transcript(root, 'x'));
  fs.writeFileSync(path.join(other, 'y.jsonl'), transcript(path.join(root, '..', 'elsewhere'), 'y'));
  const l = await createSessions(root, { home }).list();
  assert.deepEqual(l.map((s) => s.sessionId), ['x']);
});

test('no transcripts / missing home', async () => {
  const { root, home } = setup();
  assert.deepEqual(await createSessions(root, { home }).list(), []);
  assert.equal(await createSessions(root, { home }).attribute('a.md', T0), null);
});

test('codex sessions best-effort', async () => {
  const { root, home } = setup();
  const d = path.join(home, '.codex', 'sessions', '2026', '10', '23');
  fs.mkdirSync(d, { recursive: true });
  const L = [
    { timestamp: iso(T0), type: 'session_meta', payload: { id: 'cx1', cwd: root } },
    { timestamp: iso(T0 + 1000), type: 'event_msg', payload: { type: 'user_message', message: 'update agents file' } },
    { timestamp: iso(T0 + 2000), type: 'response_item', payload: { type: 'function_call', name: 'apply_patch', arguments: JSON.stringify({ input: '*** Begin Patch\n*** Update File: AGENTS.md\n@@\n-a\n+b\n*** End Patch' }) } },
    { timestamp: iso(T0 + 3000), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 50, output_tokens: 6, cached_input_tokens: 9 } } } },
  ];
  fs.writeFileSync(path.join(d, 'rollout-1.jsonl'), L.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const other = { timestamp: iso(T0), type: 'session_meta', payload: { id: 'cx2', cwd: '/somewhere/else' } };
  fs.writeFileSync(path.join(d, 'rollout-2.jsonl'), JSON.stringify(other) + '\n');
  const s = createSessions(root, { home });
  const l = await s.list();
  assert.equal(l.length, 1);
  assert.equal(l[0].tool, 'codex');
  assert.equal(l[0].sessionId, 'cx1');
  assert.deepEqual(l[0].filesTouched, ['AGENTS.md']);
  assert.deepEqual(l[0].tokens, { input: 50, output: 6, cacheRead: 9, cacheWrite: 0 });
  const ref = await s.attribute('AGENTS.md', T0 + 2500);
  assert.equal(ref.tool, 'codex');
  assert.equal(ref.lastPrompt, 'update agents file');
});
