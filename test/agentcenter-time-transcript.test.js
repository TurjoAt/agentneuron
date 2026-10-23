import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/core/store.js';
import { loadConfig } from '../src/core/config.js';
import { contextAt, contextDiff } from '../src/agentcenter/timetravel.js';
import { sessionTimeline, readTranscriptUsage, locateTranscript } from '../src/agentcenter/transcript.js';
import { projectDirName } from '../src/agents/sessions.js';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('contextAt / contextDiff use history versions', async () => {
  const root = tmp('agentneuron-tt-');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# V1\n- alpha\n');
  const store = createStore(root, loadConfig(root));
  await store.init();
  const t1 = Date.now();
  await new Promise((r) => setTimeout(r, 15));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# V2\n- alpha\n- beta\n');
  await store.handleFsEvent({ type: 'change', path: 'CLAUDE.md' });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'new codex file\n');
  await store.handleFsEvent({ type: 'add', path: 'AGENTS.md' });
  const t2 = Date.now() + 1;
  const old = contextAt(store, '', 'claude', t1);
  assert.match(old.text, /V1/);
  assert.ok(!/beta/.test(old.text));
  const cur = contextAt(store, '', 'claude', t2);
  assert.match(cur.text, /beta/);
  assert.equal(contextAt(store, '', 'codex', t1).chain.length, 0); // AGENTS.md did not exist yet
  const d = contextDiff(store, '', 'claude', t1, t2);
  assert.ok(d.diff.added >= 2 && d.diff.removed >= 1);
  assert.ok(d.tokenDelta > 0);
  assert.ok(d.diff.hunks.some((h) => h.type === 'add' && /beta/.test(h.text)));
});

test('sessionTimeline reads claude transcript, masks secrets, truncates', async () => {
  const home = tmp('agentneuron-home-');
  const root = tmp('agentneuron-proj-');
  const dir = path.join(home, '.claude', 'projects', projectDirName(root));
  fs.mkdirSync(dir, { recursive: true });
  const L = (o) => JSON.stringify(o);
  const secret = 'sk-ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0'.repeat(3);
  fs.writeFileSync(path.join(dir, 'abc-123.jsonl'), [
    L({ type: 'summary', summary: 'Did stuff' }),
    L({ type: 'user', timestamp: '2026-10-01T10:00:00Z', message: { role: 'user', content: `please fix ${secret} ` + 'x'.repeat(900) } }),
    L({ type: 'user', timestamp: '2026-10-01T10:00:01Z', message: { role: 'user', content: '<system-reminder>hidden</system-reminder>' } }),
    L({ type: 'assistant', timestamp: '2026-10-01T10:00:02Z', message: { id: 'm1', model: 'claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }, content: [
      { type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Edit', input: { file_path: path.join(root, 'src/a.js') } },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }),
    L({ type: 'assistant', timestamp: '2026-10-01T10:00:03Z', message: { id: 'm1', model: 'claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 9, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }, content: [] } }),
    L({ type: 'user', timestamp: '2026-10-01T10:00:04Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }),
    '{broken json',
  ].join('\n') + '\n');
  const fake = { list: async () => [{ sessionId: 'abc-123', tool: 'claude', title: 'T' }] };
  const r = await sessionTimeline(fake, 'abc-123', { root, home });
  assert.equal(r.session.sessionId, 'abc-123');
  const types = r.timeline.map((e) => e.type);
  assert.deepEqual(types.sort(), ['edit', 'prompt', 'summary', 'tool']);
  const prompt = r.timeline.find((e) => e.type === 'prompt');
  assert.ok(prompt.text.length <= 500);
  assert.ok(!prompt.text.includes(secret));
  const edit = r.timeline.find((e) => e.type === 'edit');
  assert.equal(edit.path, 'src/a.js');
  assert.equal(r.timeline.find((e) => e.tool === 'Bash').text, 'npm test');
  const loc = locateTranscript('abc-123', { root, home });
  const u = readTranscriptUsage(loc.file);
  assert.deepEqual(u.models['claude-sonnet-4-5'], { input: 10, output: 9, cacheRead: 100, cacheWrite: 20 }); // dedup by message id
  assert.equal(locateTranscript('../etc', { root, home }), null);
  assert.deepEqual((await sessionTimeline(fake, 'missing', { root, home })).timeline, []);
});
