// Synthetic Claude Code / Codex home for the usage tests. All content is made up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectDirName } from '../src/agents/sessions.js';

export const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const jl = (rows) => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

/** Build { home, root, dir, now, T } with sessions S1 (exact cost, subagent, loops), S2 (estimated), S9 (other project), Codex C1. */
export function makeHome() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-usage-')));
  const home = path.join(base, 'home');
  const root = path.join(base, 'proj');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'y\nz\nnow\n');
  const now = Date.now();
  // S1 starts 3h ago (stays inside today's local day only when the test runs after 03:00; the tests do not depend on it)
  const T = (min) => iso(now - 3 * H + min * 60000);
  const claude = path.join(home, '.claude');
  const dir = path.join(claude, 'projects', projectDirName(root));
  const common = { cwd: root, sessionId: 'S1', gitBranch: 'main', version: '9.9.9' };
  const A = (min, id, content, usage, extra = {}) => ({ ...common, type: 'assistant', timestamp: T(min), uuid: `${id}-${min}`, slug: 'plan-slug-one',
    message: { id, model: extra.model || 'claude-sonnet-4-5', role: 'assistant', content, usage: usage || { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }, ...extra });
  const U = (min, content, extra = {}) => ({ ...common, type: 'user', timestamp: T(min), message: { role: 'user', content }, ...extra });
  const R = (id, opts = {}) => ({ type: 'tool_result', tool_use_id: id, content: opts.text || 'ok', ...(opts.err ? { is_error: true } : {}) });
  const u1 = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 2000 };
  w(path.join(dir, 'S1.jsonl'), jl([
    { type: 'custom-title', customTitle: 'Fixture session one', sessionId: 'S1' },
    { type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: 'S1' },
    { type: 'api-request-blob', sessionId: 'S1', hash: 'h', message: { huge: true } },
    'this line is not json',
    { type: 'weird-new-record', sessionId: 'S1', foo: 1 },
    U(0, 'please add the parser'),
    A(1, 'm1', [{ type: 'thinking', thinking: 'secret chain of thought' }, { type: 'text', text: 'Working on it.' }, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: path.join(root, 'src', 'a.js'), old_string: 'x', new_string: 'y\nz' } }], u1, { thinkingDurationMs: 1200 }),
    A(1, 'm1', [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }], u1), // same API message, second content block
    U(2, [R('t1')], { toolUseResult: { filePath: 'src/a.js', structuredPatch: [{ lines: ['-x', '+y', '+z'] }] } }),
    U(2, [R('t2', { err: true, text: 'Error: tests failed' })]),
    A(3, 'm2', [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test' } }]),
    U(4, [R('t3', { err: true, text: 'Error: tests failed again' })]),
    A(5, 'm3', [{ type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'npm test' } }]),
    U(6, [R('t4', { err: true, text: 'Error: still failing' })]),
    A(7, 'm4', [{ type: 'tool_use', id: 't5', name: 'mcp__github__create_issue', input: { title: 'x' } }]),
    U(8, [R('t5', { err: true, text: 'rejected' })], { toolDenialKind: 'user-rejected' }),
    A(9, 'm5', [{ type: 'server_tool_use', id: 'adv1', name: 'advisor', input: {} }, { type: 'tool_use', id: 't6', name: 'Agent', input: { description: 'sub task', subagent_type: 'general-purpose', prompt: 'do it' } }], null, { advisorModel: 'claude-opus-4-5' }),
    U(12, [R('t6')], { toolUseResult: { agentId: 'a1', status: 'completed' } }),
    A(13, 'm6', [{ type: 'tool_use', id: 't7', name: 'Skill', input: { skill: 'review' } }]),
    U(14, [R('t7')]),
    A(14, 'm7', [{ type: 'tool_use', id: 't8', name: 'AskUserQuestion', input: { questions: [{ question: 'Which database?' }] } }]),
    U(14, [R('t8', { text: 'User has answered your questions: "Which database?"="USER-ANSWER-POSTGRES"' })]),
    U(15, [{ type: 'text', text: '[Request interrupted by user]' }]),
    { ...common, type: 'system', subtype: 'turn_duration', durationMs: 900000, timestamp: T(15) },
    { ...common, type: 'system', subtype: 'stop_hook_summary', hookCount: 2, hookErrors: [{ e: 1 }], preventedContinuation: true, timestamp: T(15) },
    U(20, "no, that's wrong, revert it"),
    { ...common, type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 150000 }, timestamp: T(21) },
    { type: 'file-history-snapshot', messageId: 'm1', snapshot: { messageId: 'm1', timestamp: T(1), trackedFileBackups: { [path.join(root, 'src', 'a.js')]: { backupFileName: 'abc123@v1', version: 1, backupTime: T(1) } } } },
    { type: 'file-history-delta', messageId: 'm2', trackingPath: 'src/a.js', backup: { backupFileName: 'abc123@v2', version: 2, backupTime: T(3) }, timestamp: T(3) },
    { type: 'cost-state', sessionId: 'S1', totalCostUSD: 0.5, totalLinesAdded: 10, totalLinesRemoved: 3, startTime: now - 3 * H, modelUsage: { 'claude-sonnet-4-5': { costUSD: 0.5 } } },
    { type: 'system', subtype: 'away_summary', timestamp: T(22), content: 'away' },
  ]));
  // subagent of S1
  w(path.join(dir, 'S1', 'subagents', 'agent-a1.jsonl'), jl([
    { ...common, type: 'user', isSidechain: true, agentId: 'a1', timestamp: T(10), message: { role: 'user', content: 'do it' } },
    { ...common, type: 'assistant', isSidechain: true, agentId: 'a1', timestamp: T(11), message: { id: 'sm1', model: 'claude-haiku-4-5', content: [{ type: 'tool_use', id: 'st1', name: 'Read', input: { file_path: path.join(root, 'src', 'a.js') } }], usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { ...common, type: 'user', isSidechain: true, agentId: 'a1', timestamp: T(11), message: { role: 'user', content: [R('st1')] } },
  ]));
  w(path.join(dir, 'S1', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'sub task description', model: 'haiku' }));
  // S2: no cost-state (estimated), 5 days ago, 1M sonnet input tokens = $3 at list price
  const t2 = (min) => iso(now - 5 * 24 * H + min * 60000);
  w(path.join(dir, 'S2.jsonl'), jl([
    { type: 'ai-title', aiTitle: 'Second fixture session', sessionId: 'S2' },
    { cwd: root, sessionId: 'S2', gitBranch: 'feature', type: 'user', timestamp: t2(0), message: { role: 'user', content: 'please add the parser' } },
    { cwd: root, sessionId: 'S2', gitBranch: 'feature', type: 'assistant', timestamp: t2(1), message: { id: 'x1', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 1000000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { cwd: root, sessionId: 'S2', gitBranch: 'feature', type: 'user', timestamp: t2(2), message: { role: 'user', content: 'please add the parser' } },
    { cwd: root, sessionId: 'S2', gitBranch: 'feature', type: 'user', timestamp: t2(3), message: { role: 'user', content: 'please add the parser' } },
  ]));
  // another project: only visible with scope=all
  const other = path.join(claude, 'projects', '-somewhere-else');
  w(path.join(other, 'S9.jsonl'), jl([
    { cwd: '/somewhere/else', sessionId: 'S9', type: 'user', timestamp: T(30), message: { role: 'user', content: 'other project prompt' } },
    { cwd: '/somewhere/else', sessionId: 'S9', type: 'assistant', timestamp: T(31), message: { id: 'o1', model: 'claude-opus-4-5', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ]));
  // file history backups
  w(path.join(claude, 'file-history', 'S1', 'abc123@v1'), 'x\n');
  w(path.join(claude, 'file-history', 'S1', 'abc123@v2'), 'y\nz\n');
  // typed prompt history: pastedContents must never be returned
  w(path.join(claude, 'history.jsonl'), jl([
    { display: 'please add the parser', pastedContents: { 1: { id: 1, type: 'text', content: 'PASTED-SECRET-CONTENT' } }, timestamp: now - 3 * H, project: root, sessionId: 'S1' },
    { display: 'prompt from a session without transcript', pastedContents: {}, timestamp: now - 2 * H, project: root, sessionId: 'S-gone' },
    { display: 'other project', pastedContents: {}, timestamp: now - 2 * H, project: '/somewhere/else', sessionId: 'S9' },
  ]));
  // memory + plans
  w(path.join(dir, 'memory', 'note.md'), '---\nname: Build notes\ndescription: How the build works\nmetadata:\n  type: project\n---\n\nThe parser lives in `src/a.js`; the old one was `src/missing.js`. See [index](MEMORY.md).\n');
  w(path.join(claude, 'plans', 'plan-slug-one.md'), '# Plan one\n\nSteps.\n');
  w(path.join(claude, 'plans', 'unrelated-plan.md'), '# Other project plan\n');
  // settings
  w(path.join(claude, 'settings.json'), JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(*)', 'Read'], defaultMode: 'bypassPermissions' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } }));
  w(path.join(claude, 'mcp-needs-auth-cache.json'), JSON.stringify({ github: { timestamp: 1 } }));
  // denied files: must never be read
  w(path.join(claude, '.credentials.json'), JSON.stringify({ token: 'CREDENTIAL-SECRET' }));
  w(path.join(claude, 'sessions', 'x.key'), 'KEY-SECRET');
  w(path.join(claude, 'remote', 'r.jsonl'), 'REMOTE-SECRET');
  w(path.join(claude, 'state', 's.json'), 'STATE-SECRET');
  w(path.join(claude, 'paste-cache', 'p.txt'), 'PASTE-CACHE-SECRET');
  // a transcript that is a symlink to the credentials file
  try { fs.symlinkSync(path.join(claude, '.credentials.json'), path.join(dir, 'S-link.jsonl')); } catch { /* no symlinks on this fs */ }
  // codex rollout in this project
  w(path.join(home, '.codex', 'sessions', '2026', '01', '01', 'rollout-2026-C1.jsonl'), jl([
    { type: 'session_meta', timestamp: T(40), payload: { id: 'C1', cwd: root } },
    { type: 'turn_context', timestamp: T(40), payload: { cwd: root, model: 'gpt-5-codex' } },
    { type: 'event_msg', timestamp: T(41), payload: { type: 'user_message', message: 'codex prompt' } },
    { type: 'response_item', timestamp: T(42), payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) } },
    { type: 'event_msg', timestamp: T(43), payload: { type: 'exec_command_end', call_id: 'c1', exit_code: 1, stderr: 'Error: boom' } },
    { type: 'event_msg', timestamp: T(44), payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 2000, cached_input_tokens: 500, output_tokens: 100 } } } },
  ]));
  // codex rollout of another project: never read under scope=project
  w(path.join(home, '.codex', 'sessions', '2026', '01', '01', 'rollout-2026-C2.jsonl'), jl([
    { type: 'session_meta', timestamp: T(50), payload: { id: 'C2', cwd: '/somewhere/else' } },
    { type: 'event_msg', timestamp: T(51), payload: { type: 'user_message', message: 'foreign codex prompt' } },
  ]));
  return { base, home, root, dir, now };
}
