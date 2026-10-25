import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLive } from '../src/live/index.js';
import { claudeItems, codexItems, parsePatch, claudeEdit, exitCodeOf } from '../src/live/extract.js';
import { createClaims } from '../src/live/claims.js';
import { projectDirName } from '../src/agents/sessions.js';

const KEY = 'sk-ant-api03-' + 'Zq9Xw8Vu7Ts6Rp5On4Ml3'.repeat(2);
const pad = (n) => String(n).padStart(2, '0');
function rmTemp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (e) { if (process.platform !== 'win32') throw e; }
}

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'an-live-'));
  const root = path.join(base, 'proj');
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/a.js'), 'one\ntwo\n');
  const cdir = path.join(home, '.claude', 'projects', projectDirName(root));
  fs.mkdirSync(cdir, { recursive: true });
  const d = new Date();
  const xdir = path.join(home, '.codex', 'sessions', String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
  fs.mkdirSync(xdir, { recursive: true });
  const events = [];
  const mk = (extra = {}) => createLive({ root, home, emit: (name, data, kind) => events.push({ name, data: JSON.parse(JSON.stringify(data)), kind }), ...extra }).start({ timers: false });
  return { base, root, home, cdir, xdir, events, mk };
}
const line = (o) => JSON.stringify(o) + '\n';
const ts = () => new Date().toISOString();
const claudeUser = (sid, text) => line({ type: 'user', sessionId: sid, cwd: '/x', timestamp: ts(), message: { role: 'user', content: text } });
const claudeTool = (sid, name, input, id = 'tu' + Math.random().toString(36).slice(2, 8), model = 'claude-opus-4') =>
  line({ type: 'assistant', sessionId: sid, timestamp: ts(), message: { model, role: 'assistant', content: [{ type: 'text', text: 'I will update the file.' }, { type: 'tool_use', id, name, input }] } });

test('extract: Claude Edit/Write/MultiEdit and Codex apply_patch', () => {
  const e = claudeEdit('Edit', { file_path: '/p/a.md', old_string: 'a\nb\n', new_string: 'a\nB\nc\n' });
  assert.equal(e.op, 'edit'); assert.equal(e.linesAdded, 2); assert.equal(e.linesRemoved, 1);
  assert.ok(e.hunk.some((h) => h.type === 'add' && h.text === 'B'));
  const w = claudeEdit('Write', { file_path: 'x.md', content: 'l1\nl2\nl3\n' });
  assert.equal(w.op, 'write'); assert.equal(w.linesAdded, 3);
  const m = claudeEdit('MultiEdit', { file_path: 'x', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd\ne' }] });
  assert.equal(m.linesAdded, 3); assert.equal(m.linesRemoved, 2);
  const big = claudeEdit('Write', { file_path: 'x', content: Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n') });
  assert.ok(big.hunk.length <= 40); assert.equal(big.truncated, true);

  const p = parsePatch('*** Begin Patch\n*** Update File: src/a.js\n@@\n one\n-two\n+TWO\n+three\n*** Add File: docs/n.md\n+# N\n*** Delete File: old.md\n*** Update File: r.md\n*** Move to: s.md\n@@\n-x\n+y\n*** End Patch');
  assert.deepEqual(p.map((x) => [x.file, x.op, x.linesAdded, x.linesRemoved]), [['src/a.js', 'patch', 2, 1], ['docs/n.md', 'create', 1, 0], ['old.md', 'delete', 0, 0], ['s.md', 'patch', 1, 1]]);
  assert.equal(p[3].from, 'r.md');

  const fc = codexItems({ type: 'response_item', timestamp: ts(), payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) } }, {});
  assert.equal(fc[0].kind, 'command'); assert.equal(fc[0].cmd, 'npm test');
  const ap = codexItems({ type: 'response_item', timestamp: ts(), payload: { type: 'function_call', name: 'shell', call_id: 'c2', arguments: JSON.stringify({ command: ['apply_patch', '*** Begin Patch\n*** Add File: z.md\n+z\n*** End Patch'] }) } }, {});
  assert.equal(ap[0].kind, 'edit'); assert.equal(ap[0].op, 'create');
  assert.equal(exitCodeOf(JSON.stringify({ output: 'x', metadata: { exit_code: 2 } })), 2);
  assert.equal(exitCodeOf('Process exited with code 1\n'), 1);
  // injected/system content is not a prompt; secrets are masked
  assert.equal(claudeItems({ type: 'user', message: { content: '<system-reminder>x' } }, {}).filter((i) => i.kind === 'prompt').length, 0);
  const pr = claudeItems({ type: 'user', message: { content: `use ${KEY} please` } }, {}).find((i) => i.kind === 'prompt');
  assert.ok(!pr.text.includes('Zq9Xw8Vu7Ts6Rp5On4Ml3Zq9'));
});

test('Claude transcript: incremental tailing emits session/prompt/edit/command once, confined + masked', () => {
  const s = setup();
  try {
    const live = s.mk();
    const f = path.join(s.cdir, 'sess-1.jsonl');
    fs.writeFileSync(f, claudeUser('sess-1', 'Please fix the parser'));
    live.discover(); live.poll();
    assert.deepEqual(s.events.map((e) => e.name).sort(), ['agent.prompt', 'agent.session']);
    const se = s.events.find((e) => e.name === 'agent.session');
    assert.equal(se.data.state, 'start'); assert.equal(se.kind, 'session'); assert.equal(se.data.promptTitle, 'Please fix the parser'); assert.equal(se.data.title, null);
    assert.equal(s.events.find((e) => e.name === 'agent.prompt').kind, 'prompt');
    s.events.length = 0;

    fs.appendFileSync(f, claudeTool('sess-1', 'Edit', { file_path: path.join(s.root, 'src/a.js'), old_string: 'two', new_string: `two\nconst k = "${KEY}"` }, 'tu1'));
    fs.appendFileSync(f, claudeTool('sess-1', 'Bash', { command: `curl -H "Authorization: Bearer abcdefghijklmnopqrstuv" x` }, 'tu2'));
    fs.appendFileSync(f, claudeTool('sess-1', 'Write', { file_path: '/etc/passwd-nope', content: 'x' }, 'tu3'));
    fs.appendFileSync(f, claudeTool('sess-1', 'Edit', { file_path: path.join(s.root, '..', 'outside.txt'), old_string: 'a', new_string: 'b' }, 'tu4'));
    fs.appendFileSync(f, '{"type":"assistant","partial'); // incomplete line: not consumed yet
    live.poll();
    const edits = s.events.filter((e) => e.name === 'agent.edit');
    assert.equal(edits.length, 1, 'edits outside the project are ignored');
    const ed = edits[0].data;
    assert.equal(ed.path, 'src/a.js'); assert.equal(ed.op, 'edit'); assert.equal(ed.tool, 'claude'); assert.equal(ed.sessionId, 'sess-1');
    assert.equal(ed.linesAdded, 1); assert.equal(ed.linesRemoved, 0); assert.equal(ed.status, 'pending'); assert.equal(edits[0].kind, 'diff');
    assert.ok(!JSON.stringify(ed.hunk).includes('Zq9Xw8Vu7Ts6Rp5On4Ml3Zq9'), 'secret masked in hunk');
    const cmd = s.events.find((e) => e.name === 'agent.command').data;
    assert.ok(!cmd.cmd.includes('abcdefghijklmnopqrstuv'));
    assert.ok(s.events.some((e) => e.name === 'agent.thinking'));

    // tool results: command exit, failed edit; the partial line completes
    s.events.length = 0;
    fs.appendFileSync(f, `"}\n` + line({ type: 'user', sessionId: 'sess-1', timestamp: ts(), message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', is_error: true, content: 'Exit code 7\nfail' }] } }));
    live.poll();
    const done = s.events.find((e) => e.name === 'agent.command').data;
    assert.equal(done.exitCode, 7); assert.equal(done.ok, false);

    // a watcher event for the edited file confirms it
    s.events.length = 0;
    live.onFsEvent({ type: 'change', path: 'src/a.js', ts: Date.now(), stats: { added: 2, removed: 1 } });
    assert.equal(s.events.find((e) => e.name === 'agent.edit').data.status, 'confirmed');
    // nothing new when nothing is appended
    s.events.length = 0;
    live.poll();
    assert.equal(s.events.filter((e) => e.name !== 'agent.session').length, 0);
    const snap = live.snapshot();
    assert.equal(snap.sessions[0].model, 'claude-opus-4');
    assert.equal(snap.editing[0].path, 'src/a.js');
    live.close();
  } finally { rmTemp(s.base); }
});

test('existing transcripts are backfilled quietly; symlink escapes are ignored', () => {
  const s = setup();
  try {
    const f = path.join(s.cdir, 'old.jsonl');
    fs.writeFileSync(f, claudeUser('old', 'earlier work') + claudeTool('old', 'Edit', { file_path: path.join(s.root, 'src/a.js'), old_string: 'one', new_string: 'uno' }));
    const outside = path.join(s.base, 'outside');
    fs.mkdirSync(outside);
    let linked = true;
    try { fs.symlinkSync(outside, path.join(s.root, 'link'), 'junction'); } catch { linked = false; }
    const live = s.mk();
    assert.equal(s.events.length, 0, 'backfill is not broadcast');
    const snap = live.snapshot();
    assert.equal(snap.edits.length, 1); assert.equal(snap.edits[0].status, 'unverified');
    if (linked) {
      fs.appendFileSync(f, claudeTool('old', 'Write', { file_path: path.join(s.root, 'link', 'x.txt'), content: 'x' }));
      live.poll();
      assert.equal(s.events.filter((e) => e.name === 'agent.edit').length, 0, 'write through a symlink to outside is ignored');
    }
    // a path given through the real (resolved) root is accepted
    fs.appendFileSync(f, claudeTool('old', 'Write', { file_path: path.join(fs.realpathSync(s.root), 'src', 'b.js'), content: 'b\n' }));
    live.poll();
    assert.equal(s.events.filter((e) => e.name === 'agent.edit').pop().data.path, 'src/b.js');
    live.close();
  } finally { rmTemp(s.base); }
});

test('Codex rollout: only sessions in this project; apply_patch + shell with exit codes', () => {
  const s = setup();
  try {
    const live = s.mk();
    const id = '0199aaaa-bbbb-cccc-dddd-eeeeffff0001';
    const f = path.join(s.xdir, `rollout-2025-01-01T00-00-00-${id}.jsonl`);
    const other = path.join(s.xdir, 'rollout-2025-01-01T00-00-01-0199aaaa-bbbb-cccc-dddd-eeeeffff0002.jsonl');
    const meta = (cwd, sid) => line({ timestamp: ts(), type: 'session_meta', payload: { id: sid, cwd } });
    fs.writeFileSync(f, meta(s.root, id) + line({ timestamp: ts(), type: 'turn_context', payload: { cwd: s.root, model: 'gpt-5-codex' } }));
    fs.writeFileSync(other, meta(path.join(s.base, 'elsewhere'), 'x2') + line({ timestamp: ts(), type: 'event_msg', payload: { type: 'user_message', message: 'secret other project' } }));
    live.discover(); live.poll();
    fs.appendFileSync(f, line({ timestamp: ts(), type: 'event_msg', payload: { type: 'user_message', message: 'add notes' } }));
    fs.appendFileSync(f, line({ timestamp: ts(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'p1', input: '*** Begin Patch\n*** Add File: docs/notes.md\n+# Notes\n+hi\n*** Update File: ../../etc/hosts\n@@\n-a\n+b\n*** End Patch' } }));
    fs.appendFileSync(f, line({ timestamp: ts(), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 's1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) } }));
    fs.appendFileSync(f, line({ timestamp: ts(), type: 'response_item', payload: { type: 'function_call_output', call_id: 's1', output: JSON.stringify({ output: 'ok', metadata: { exit_code: 0 } }) } }));
    fs.appendFileSync(other, line({ timestamp: ts(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'q', input: '*** Begin Patch\n*** Add File: z.md\n+z\n*** End Patch' } }));
    live.poll();
    const names = s.events.map((e) => e.name);
    assert.ok(!JSON.stringify(s.events).includes('secret other project'));
    const edits = s.events.filter((e) => e.name === 'agent.edit').map((e) => e.data);
    assert.deepEqual(edits.map((e) => [e.path, e.op, e.linesAdded]), [['docs/notes.md', 'create', 2]]);
    assert.equal(edits[0].tool, 'codex'); assert.equal(edits[0].sessionId, id);
    const cmds = s.events.filter((e) => e.name === 'agent.command').map((e) => e.data);
    assert.equal(cmds.at(-1).exitCode, 0);
    assert.ok(names.includes('agent.prompt'));
    assert.equal(live.snapshot().sessions.find((x) => x.tool === 'codex').model, 'gpt-5-codex');
    live.close();
  } finally { rmTemp(s.base); }
});

test('collisions: two sessions on one file; foreign claims; unmatched watcher change is human', () => {
  const s = setup();
  try {
    let clock = Date.now();
    const claims = createClaims(s.root);
    const live = s.mk({ claims, now: () => clock });
    const a = path.join(s.cdir, 'A.jsonl'), b = path.join(s.cdir, 'B.jsonl');
    fs.writeFileSync(a, ''); fs.writeFileSync(b, '');
    live.discover();
    claims.claim({ agent: 'codex', sessionId: 'cx1', paths: ['src/**'] });
    fs.appendFileSync(a, claudeTool('A', 'Edit', { file_path: path.join(s.root, 'src/a.js'), old_string: 'one', new_string: '1' }));
    live.poll();
    fs.appendFileSync(b, claudeTool('B', 'Edit', { file_path: path.join(s.root, 'src/a.js'), old_string: 'two', new_string: '2' }));
    live.poll();
    const col = s.events.filter((e) => e.name === 'agent.collision').map((e) => e.data);
    assert.ok(col.some((c) => c.reason === 'overlap' && c.sessions.length === 2 && c.path === 'src/a.js'));
    assert.ok(col.some((c) => c.reason === 'claim' && c.claim.agent === 'codex'));
    // own-family claim (claude) does not warn
    s.events.length = 0;
    claims.release({ agent: 'codex', sessionId: 'cx1' });
    claims.claim({ agent: 'claude-code', sessionId: 'default', paths: ['src/c.js'] });
    fs.appendFileSync(a, claudeTool('A', 'Write', { file_path: path.join(s.root, 'src/c.js'), content: 'c' }));
    live.poll();
    assert.equal(s.events.filter((e) => e.name === 'agent.collision' && e.data.reason === 'claim').length, 0);

    s.events.length = 0;
    live.onFsEvent({ id: 9, type: 'add', path: 'NOTES.md', ts: clock, stats: { added: 3, removed: 0 } });
    live.poll();
    assert.equal(s.events.filter((e) => e.name === 'agent.edit').length, 0, 'waits for a transcript first');
    clock += 2000;
    live.poll();
    const h = s.events.find((e) => e.name === 'agent.edit').data;
    assert.equal(h.tool, 'human'); assert.equal(h.op, 'create'); assert.equal(h.source, 'watcher'); assert.equal(h.linesAdded, 3);
    // idle after the idle window
    clock += 10 * 60000;
    s.events.length = 0;
    live.poll();
    assert.ok(s.events.some((e) => e.name === 'agent.session' && e.data.state === 'idle'));
    live.close();
  } finally { rmTemp(s.base); }
});
