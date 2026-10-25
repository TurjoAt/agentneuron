// Turn single Claude Code / Codex transcript lines into live items (edits, commands, prompts, meta).
// Pure: no I/O. Paths stay raw here; the engine confines them to the project.
import { lineDiff } from '../core/diff.js';
import { maskSecretsInText } from '../health/secrets.js';

export const HUNK_LINES = 40;
const HUNK_LINE_CHARS = 200;
const HUNK_BYTES = 4096;
export const CMD_CHARS = 300;
export const PROMPT_CHARS = 200;

const toMs = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) && Math.abs(n) <= 8.64e15 ? n : 0;
};
const str = (v) => (typeof v === 'string' ? v : '');
/** Mask, collapse whitespace, truncate. */
export const clip = (s, n) => {
  const t = maskSecretsInText(String(s ?? '').replace(/\s+/g, ' ').trim());
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

const INJECTED = /^<(?:system-reminder|command-|local-command|environment_context|user_instructions|ide_|task-notification)|^\[Request interrupted|^Caveat:/i;
export function cleanPrompt(t) {
  const s = str(t).trim();
  return !s || INJECTED.test(s) ? '' : clip(s, PROMPT_CHARS);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
  return '';
}

/** Cap and mask diff rows ({type,text}); line numbers are dropped (snippet-relative, misleading). */
export function capHunk(rows) {
  const out = [];
  let bytes = 0;
  let truncated = false;
  for (const r of rows) {
    if (out.length >= HUNK_LINES || bytes > HUNK_BYTES) { truncated = true; break; }
    let text = maskSecretsInText(str(r.text));
    if (text.length > HUNK_LINE_CHARS) { text = text.slice(0, HUNK_LINE_CHARS) + '…'; }
    bytes += text.length + 2;
    out.push({ type: r.type, text });
  }
  return { hunk: out, truncated };
}

/** Rows around changes only (≤2 lines of context). */
function trimCtx(rows) {
  const keep = rows.map((r) => r.type !== 'ctx');
  return rows.filter((r, i) => keep[i] || keep.slice(Math.max(0, i - 2), i + 3).some(Boolean));
}

function diffOf(oldText, newText) {
  const d = lineDiff(str(oldText), str(newText));
  return { added: d.added, removed: d.removed, rows: trimCtx(d.hunks) };
}

function editItem(fields, rows) {
  const { hunk, truncated } = capHunk(rows);
  return { kind: 'edit', ...fields, hunk, truncated };
}

/** Claude Code tool_use (Write/Edit/MultiEdit/NotebookEdit) -> edit item | null. `prev` is the file's known content, if any. */
export function claudeEdit(name, input, prev = null) {
  if (!input || typeof input !== 'object') return null;
  const file = str(input.file_path || input.notebook_path || input.path);
  if (!file) return null;
  if (name === 'Write') {
    const d = diffOf(prev ?? '', str(input.content));
    return editItem({ file, op: 'write', linesAdded: d.added, linesRemoved: d.removed }, d.rows);
  }
  if (name === 'Edit') {
    const d = diffOf(input.old_string, input.new_string);
    return editItem({ file, op: 'edit', linesAdded: d.added, linesRemoved: d.removed }, d.rows);
  }
  if (name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits.slice(0, 200) : [];
    let added = 0, removed = 0;
    const rows = [];
    for (const e of edits) {
      if (!e || typeof e !== 'object') continue;
      const d = diffOf(e.old_string, e.new_string);
      added += d.added; removed += d.removed;
      if (rows.length < HUNK_LINES * 2) rows.push(...d.rows);
    }
    return editItem({ file, op: 'edit', linesAdded: added, linesRemoved: removed }, rows);
  }
  if (name === 'NotebookEdit') {
    const d = diffOf('', str(input.new_source));
    return editItem({ file, op: input.edit_mode === 'delete' ? 'delete' : 'edit', linesAdded: d.added, linesRemoved: 0 }, d.rows);
  }
  return null;
}

/** Parse an apply_patch envelope into per-file edit items (paths raw, relative to the session cwd). */
export function parsePatch(text) {
  const out = [];
  let cur = null;
  let rows = [];
  const flush = () => {
    if (!cur) return;
    out.push(editItem(cur, rows));
    cur = null; rows = [];
  };
  for (const line of str(text).replace(/\r\n/g, '\n').split('\n')) {
    const m = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (m) {
      flush();
      cur = { file: m[2].trim(), op: m[1] === 'Add' ? 'create' : m[1] === 'Delete' ? 'delete' : 'patch', linesAdded: 0, linesRemoved: 0 };
      continue;
    }
    if (!cur) continue;
    const mv = /^\*\*\* Move to: (.+)$/.exec(line);
    if (mv) { cur.from = cur.file; cur.file = mv[1].trim(); continue; }
    if (line.startsWith('*** ')) { flush(); continue; } // End Patch / End of File
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+')) { cur.linesAdded++; rows.push({ type: 'add', text: line.slice(1) }); }
    else if (line.startsWith('-')) { cur.linesRemoved++; rows.push({ type: 'del', text: line.slice(1) }); }
    else if (line.startsWith(' ')) rows.push({ type: 'ctx', text: line.slice(1) });
  }
  flush();
  return out;
}

const PATCH_RE = /\*\*\* Begin Patch[\s\S]*?(?:\*\*\* End Patch|$)/;

/** Shell command array/string -> display string (unwraps bash -lc "..."). */
function cmdString(c) {
  if (Array.isArray(c)) {
    const a = c.map(String);
    if (a.length >= 3 && /(^|\/)(ba|z)?sh$/.test(a[0]) && /^-l?c$/.test(a[1])) return a.slice(2).join(' ');
    return a.join(' ');
  }
  return str(c);
}

function parseJson(s) { try { return JSON.parse(s); } catch { return null; } }

/** Exit code from a tool output (JSON metadata or "Exit code: N" / "exited with code N"). */
export function exitCodeOf(output) {
  if (output && typeof output === 'object') {
    const ec = output.metadata?.exit_code ?? output.exit_code;
    if (Number.isInteger(ec)) return ec;
    output = output.output;
  }
  const s = str(output);
  const j = s.startsWith('{') ? parseJson(s) : null;
  if (j) return exitCodeOf(j);
  const m = /(?:exit(?:ed with)? code:?|Process exited with code)\s*(-?\d+)/i.exec(s.slice(0, 4000));
  return m ? Number(m[1]) : undefined;
}

/**
 * One Claude Code transcript line -> items. `st` carries per-file context ({sessionId, cwd, model}).
 * Items: {kind:'meta', ...} | {kind:'edit', id, file, ...} | {kind:'command', id, cmd} |
 *        {kind:'result', id, ok, exitCode, type} | {kind:'prompt'|'thinking', text}
 */
export function claudeItems(o, st, prevOf = () => null) {
  if (!o || typeof o !== 'object') return [];
  const out = [];
  const ts = toMs(o.timestamp);
  const meta = {};
  if (typeof o.sessionId === 'string' && /^[\w.-]{1,200}$/.test(o.sessionId)) meta.sessionId = o.sessionId;
  if (typeof o.cwd === 'string' && o.cwd) meta.cwd = o.cwd;
  if (o.type === 'summary' && typeof o.summary === 'string') meta.title = clip(o.summary, 120);
  const msg = o.message || {};
  if (o.type === 'assistant' && typeof msg.model === 'string' && msg.model !== '<synthetic>') meta.model = msg.model.slice(0, 80);
  if (Object.keys(meta).length) out.push({ kind: 'meta', ts, ...meta });
  if (o.type === 'user' && !o.isMeta) {
    const c = msg.content;
    if (Array.isArray(c) && c.some((x) => x && x.type === 'tool_result')) {
      for (const r of c) {
        if (!r || r.type !== 'tool_result' || typeof r.tool_use_id !== 'string') continue;
        const tur = o.toolUseResult && typeof o.toolUseResult === 'object' ? o.toolUseResult : {};
        out.push({ kind: 'result', ts, id: r.tool_use_id, ok: !r.is_error, exitCode: exitCodeOf(textOf(r.content) || r.content), type: str(tur.type) });
      }
    } else {
      const p = cleanPrompt(textOf(c));
      if (p) out.push({ kind: 'prompt', ts, text: p });
    }
  } else if (o.type === 'assistant' && Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (!c || typeof c !== 'object') continue;
      if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) out.push({ kind: 'thinking', ts, text: clip(c.text, PROMPT_CHARS) });
      if (c.type !== 'tool_use') continue;
      const id = typeof c.id === 'string' ? c.id.slice(0, 100) : '';
      if (c.name === 'Bash' && c.input && typeof c.input.command === 'string') out.push({ kind: 'command', ts, id, cmd: clip(c.input.command, CMD_CHARS) });
      else {
        const fp = c.input && str(c.input.file_path || c.input.notebook_path || c.input.path);
        const e = fp ? claudeEdit(c.name, c.input, c.name === 'Write' ? prevOf(fp, st) : null) : null;
        if (e) out.push({ ...e, ts, id });
      }
    }
  }
  return out;
}

/** One Codex rollout line -> items (same shapes as claudeItems). Patch paths are relative to the current cwd. */
export function codexItems(o, st) {
  if (!o || typeof o !== 'object') return [];
  const out = [];
  const ts = toMs(o.timestamp);
  const p = o.payload && typeof o.payload === 'object' ? o.payload : {};
  if (o.type === 'session_meta') {
    const m = { kind: 'meta', ts };
    if (typeof p.id === 'string' && /^[\w.-]{1,200}$/.test(p.id)) m.sessionId = p.id;
    if (typeof p.cwd === 'string') m.cwd = p.cwd;
    if (typeof p.model === 'string') m.model = p.model.slice(0, 80);
    out.push(m);
    return out;
  }
  if (o.type === 'turn_context') {
    const m = { kind: 'meta', ts };
    if (typeof p.cwd === 'string' && p.cwd) m.cwd = p.cwd;
    if (typeof p.model === 'string') m.model = p.model.slice(0, 80);
    out.push(m);
    return out;
  }
  if (o.type === 'event_msg') {
    if (p.type === 'user_message') { const t = cleanPrompt(p.message); if (t) out.push({ kind: 'prompt', ts, text: t }); }
    else if (p.type === 'agent_message' && typeof p.message === 'string') out.push({ kind: 'thinking', ts, text: clip(p.message, PROMPT_CHARS) });
    else if (p.type === 'agent_reasoning' && typeof p.text === 'string') out.push({ kind: 'thinking', ts, text: clip(p.text, PROMPT_CHARS) });
    else if (p.type === 'exec_command_end' && typeof p.call_id === 'string' && Number.isInteger(p.exit_code)) out.push({ kind: 'result', ts, id: p.call_id, ok: p.exit_code === 0, exitCode: p.exit_code });
    return out;
  }
  if (o.type !== 'response_item') return out;
  const id = typeof p.call_id === 'string' ? p.call_id.slice(0, 100) : '';
  if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
    const ec = exitCodeOf(p.output);
    const failed = /^(?:error|apply_patch verification failed)/i.test(str(p.output).slice(0, 200));
    out.push({ kind: 'result', ts, id, ok: ec === undefined ? !failed : ec === 0, exitCode: ec });
    return out;
  }
  let patch = null;
  let cmd = null;
  if (p.type === 'custom_tool_call' && p.name === 'apply_patch') patch = str(p.input);
  else if (p.type === 'function_call') {
    const args = parseJson(str(p.arguments)) || {};
    if (p.name === 'apply_patch') patch = str(args.input || args.patch || p.arguments);
    else {
      const c = args.command ?? args.cmd;
      cmd = cmdString(c);
      if (Array.isArray(c) && c[0] === 'apply_patch') { patch = str(c[1]); cmd = null; }
    }
  } else if (p.type === 'local_shell_call') cmd = cmdString(p.action?.command);
  if (cmd && /\bapply_patch\b/.test(cmd) && PATCH_RE.test(cmd)) { patch = PATCH_RE.exec(cmd)[0]; cmd = null; }
  if (patch) for (const e of parsePatch(patch)) out.push({ ...e, ts, id });
  else if (cmd) out.push({ kind: 'command', ts, id, cmd: clip(cmd, CMD_CHARS) });
  return out;
}
