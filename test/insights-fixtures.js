// Synthetic Claude Code + Codex transcripts for the insights tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectDirName } from '../src/agents/sessions.js';

export const SECRET = 'sk-ant-api03-' + 'Zq9Xw8Vu7Ts6Rp5On4Ml3'.repeat(2);
export const tmp = (p = 'agentneuron-ins-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const L = (o) => JSON.stringify(o);
export const T0 = Date.parse('2026-10-01T10:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();

export function rmTemp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (process.platform !== 'win32' || !['EBUSY', 'EPERM'].includes(e.code)) throw e; }
}

function claude(root, id, branch, steps) {
  let n = 0;
  const base = { sessionId: id, cwd: root, gitBranch: branch };
  const lines = [];
  for (const s of steps) {
    const ts = at(s.t);
    if (s.user) lines.push(L({ ...base, type: 'user', timestamp: ts, ...(s.side ? { isSidechain: true } : {}), message: { role: 'user', content: s.user } }));
    if (s.tool) {
      const tid = `toolu_${id}_${++n}`;
      lines.push(L({ ...base, type: 'assistant', timestamp: ts, message: { id: `m_${id}_${n}`, model: 'claude-sonnet-4-5', usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: 'tool_use', id: tid, name: s.tool, input: s.input }] } }));
      if (s.result !== undefined) lines.push(L({ ...base, type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: s.result, ...(s.error ? { is_error: true } : {}) }] } }));
    }
  }
  return lines.join('\n') + '\n';
}

/** Write fixtures; returns { home, root }. */
export function makeProject({ root = tmp('agentneuron-insproj-'), home = tmp('agentneuron-inshome-') } = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), [
    '# Rules', '',
    '- Never edit `dist/` files.',
    '- Use pnpm, not npm.',
    '- Run tests before committing.',
    '- Use the `FancyWidget` helper for modals.',
    '- Never touch the migrations folder.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src/app.js'), 'const a = 1;\n');
  const dir = path.join(home, '.claude', 'projects', projectDirName(root));
  fs.mkdirSync(dir, { recursive: true });
  const f = (p) => path.join(root, p);
  fs.writeFileSync(path.join(dir, 'sess-a.jsonl'), claude(root, 'sess-a', 'feat/login', [
    { t: 0, user: 'add the login form' },
    { t: 1, tool: 'Bash', input: { command: 'npm install' }, result: 'Exit code 1\nnpm ERR! code EUSAGE\nnpm ERR! lockfile pnpm-lock.yaml found', error: true },
    { t: 2, tool: 'Bash', input: { command: 'pnpm install' }, result: 'done' },
    { t: 3, tool: 'Edit', input: { file_path: f('src/app.js'), old_string: 'const a = 1;', new_string: 'const a = 2;' }, result: 'ok' },
    { t: 4, user: 'no, we use pnpm not npm' },
    { t: 5, tool: 'Edit', input: { file_path: f('dist/bundle.js'), old_string: 'x', new_string: 'y' }, result: 'ok' },
    { t: 6, user: 'No worries, looks great' },
    { t: 7, tool: 'Bash', input: { command: 'git status' }, result: 'clean' },
    { t: 8, user: 'now run it' },
    { t: 9, tool: 'Bash', input: { command: 'git commit -m "login"' }, result: 'ok' },
    { t: 10, user: `don't hardcode the key ${SECRET} in the config` },
    { t: 11, user: 'no, never do that', side: true },
  ]));
  fs.writeFileSync(path.join(dir, 'sess-b.jsonl'), claude(root, 'sess-b', 'feat/login', [
    { t: 60, user: 'Remember to run the linter before you push changes' },
    { t: 61, tool: 'Bash', input: { command: 'npm install' }, result: 'Exit code 1\nnpm ERR! lockfile pnpm-lock.yaml found', error: true },
    { t: 62, tool: 'Bash', input: { command: 'pnpm install' }, result: 'ok' },
    { t: 63, tool: 'Edit', input: { file_path: f('src/app.js'), old_string: 'const a = 2;', new_string: 'const a = 1;' }, result: 'ok' },
    { t: 64, user: "don't use npm, we use pnpm" },
    { t: 65, tool: 'Bash', input: { command: 'pnpm test' }, result: 'ok' },
    { t: 66, tool: 'Bash', input: { command: 'git commit -m "fix"' }, result: 'ok' },
    { t: 67, tool: 'Write', input: { file_path: f('db/migrations/001.sql'), content: 'x' },
      result: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nnever touch the migrations folder" },
  ]));
  fs.writeFileSync(path.join(dir, 'sess-d.jsonl'), claude(root, 'sess-d', 'main', [
    { t: 120, user: 'Remember to run the linter before you push changes please' },
    { t: 121, tool: 'Read', input: { file_path: f('src/app.js') }, result: 'x' },
  ]));
  // Codex rollout
  const cdir = path.join(home, '.codex', 'sessions', '2026', '10', '01');
  fs.mkdirSync(cdir, { recursive: true });
  const c = [
    { timestamp: at(200), type: 'session_meta', payload: { id: 'codex-c', cwd: root, git: { branch: 'feat/login' } } },
    { timestamp: at(201), type: 'event_msg', payload: { type: 'user_message', message: 'Please always use pnpm instead of npm' } },
    { timestamp: at(202), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm install'] }) } },
    { timestamp: at(202), type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: 'npm ERR! lockfile pnpm-lock.yaml found', metadata: { exit_code: 1 } }) } },
    { timestamp: at(203), type: 'response_item', payload: { type: 'function_call', name: 'apply_patch', call_id: 'c2', arguments: JSON.stringify({ input: '*** Begin Patch\n*** Update File: src/b.js\n@@\n-old line\n+new line\n*** End Patch' }) } },
    { timestamp: at(204), type: 'event_msg', payload: { type: 'user_message', message: "stop, don't edit src/b.js" } },
    { timestamp: at(205), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 5000, output_tokens: 500, cached_input_tokens: 0 } } } },
  ];
  fs.writeFileSync(path.join(cdir, 'rollout-2026-10-01T13-20-00-codex-c.jsonl'), c.map(L).join('\n') + '\n');
  return { home, root };
}
