// Normalised view of Claude Code + Codex transcripts for insights: prompts, edits (with old/new text),
// commands (with exit status), reads, and the git branch. Tail-capped (MAX_TRANSCRIPT_BYTES) and cached per file.
import fs from 'node:fs';
import path from 'node:path';
import { readRegular } from '../files/safeio.js';
import { MAX_TRANSCRIPT_BYTES, codexPath, firstCwd } from '../agents/sessions.js';
import { locateTranscript, listCodexTranscripts } from '../agentcenter/transcript.js';
import { toMs, clipMasked } from './text.js';

const WRITE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const MAX_EVENTS = 20000;
const MAX_SESSIONS = 200;
const TXT = 2000;
const INJECTED = /^<(?:system-reminder|command-|local-command|environment_context|user_instructions|ide_|task-notification)/i;
const REJECT = /the user said:\s*([\s\S]*)$/i;

const clipRaw = (s, n = TXT) => clipMasked(s, n); // masked at parse time: nothing unmasked is cached or cut
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x && x.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n') : '');
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('\n') : '');
const exitOf = (s) => { const m = /(?:^Exit code|Process exited with code|exit code:?)\s*(-?\d+)/im.exec(String(s || '')); return m ? Number(m[1]) : null; };
const errLine = (s) => String(s || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(exit code|process exited|wall time|output:|chunk id)/i.test(l)).find((l) => /err|fail|not found|cannot|denied|invalid|missing|unknown/i.test(l)) || '';

function readLines(file, max = MAX_TRANSCRIPT_BYTES) {
  const r = readRegular(file, { follow: true, tail: max });
  if (!r) return [];
  const out = [];
  let text = r.buf.toString('utf8');
  if (r.st.size > r.buf.length) text = text.slice(text.indexOf('\n') + 1); // drop the partial first line of a tail read
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* malformed */ }
  }
  return out;
}

function newSession(file, tool) {
  return { file, tool, sessionId: path.basename(file, '.jsonl'), branch: null, cwd: null, startedAt: 0, lastAt: 0, events: [] };
}
const bump = (s, ts) => { if (!ts) return; if (!s.startedAt || ts < s.startedAt) s.startedAt = ts; if (ts > s.lastAt) s.lastAt = ts; };
const push = (s, e) => { if (s.events.length < MAX_EVENTS) s.events.push(e); return e; };

/** Claude: Edit/MultiEdit/Write inputs -> [{removed, added}] */
function claudeChanges(name, inp) {
  if (name === 'Edit') return [{ removed: clipRaw(inp.old_string, 1000), added: clipRaw(inp.new_string, 1000) }];
  if (name === 'MultiEdit' && Array.isArray(inp.edits)) return inp.edits.slice(0, 20).map((e) => ({ removed: clipRaw(e?.old_string, 1000), added: clipRaw(e?.new_string, 1000) }));
  if (name === 'Write') return [{ removed: '', added: clipRaw(inp.content, 1000) }];
  return [];
}

export function parseClaude(lines, file) {
  const s = newSession(file, 'claude');
  const pending = new Map(); // tool_use id -> event
  let last = null; // kind of the last assistant action since the previous prompt
  let interrupted = false;
  for (const o of lines) {
    if (!o || typeof o !== 'object' || o.isSidechain) continue;
    if (typeof o.sessionId === 'string' && /^[\w.-]{1,200}$/.test(o.sessionId)) s.sessionId = o.sessionId;
    if (typeof o.gitBranch === 'string' && o.gitBranch && o.gitBranch !== 'HEAD') s.branch = o.gitBranch.slice(0, 200);
    if (typeof o.cwd === 'string' && !s.cwd) s.cwd = o.cwd;
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    const ts = toMs(o.timestamp);
    bump(s, ts);
    const msg = o.message || {};
    if (o.type === 'user') {
      if (o.isMeta || o.isCompactSummary) continue;
      const c = msg.content;
      if (Array.isArray(c) && c.some((x) => x && x.type === 'tool_result')) {
        for (const r of c) {
          if (!r || r.type !== 'tool_result') continue;
          const t = resultText(r.content);
          const ev = pending.get(r.tool_use_id);
          const rej = REJECT.exec(t);
          if (rej && /doesn't want to proceed|rejected/i.test(t)) {
            if (ev) ev.rejected = true;
            push(s, { k: 'prompt', ts, text: clipRaw(rej[1].trim()), after: ev?.k === 'edit' ? 'edit' : 'command', rejected: true });
            continue;
          }
          if (ev && ev.k === 'cmd') {
            const code = exitOf(t);
            ev.ok = !(r.is_error === true || (code !== null && code !== 0));
            if (!ev.ok) ev.err = clipRaw(errLine(t) || t.split('\n').find((l) => l.trim() && !/^exit code/i.test(l)) || '', 300);
          }
        }
        continue;
      }
      const t = textOf(c).trim();
      if (!t) continue;
      if (/^\[Request interrupted/i.test(t)) { interrupted = true; continue; }
      if (INJECTED.test(t) || /^Caveat:/.test(t) || /^This session is being continued/i.test(t)) continue;
      push(s, { k: 'prompt', ts, text: clipRaw(t), after: last, interrupted });
      last = null; interrupted = false;
      continue;
    }
    if (!Array.isArray(msg.content)) continue;
    for (const c of msg.content) {
      if (!c || c.type !== 'tool_use' || !c.input || typeof c.input !== 'object') continue;
      const inp = c.input;
      if (WRITE.has(c.name)) {
        const fp = inp.file_path || inp.notebook_path || inp.path;
        if (typeof fp !== 'string') continue;
        const ev = push(s, { k: 'edit', ts, path: fp, tool: c.name, changes: claudeChanges(c.name, inp) });
        if (c.id) pending.set(c.id, ev);
        last = 'edit';
      } else if (c.name === 'Bash' && typeof inp.command === 'string') {
        const ev = push(s, { k: 'cmd', ts, cmd: clipRaw(inp.command, 500), ok: null });
        if (c.id) pending.set(c.id, ev);
        if (last !== 'edit') last = 'command';
      } else if (READ.has(c.name)) {
        const fp = inp.file_path || inp.path || inp.pattern;
        if (typeof fp === 'string') push(s, { k: 'read', ts, path: fp });
      }
    }
  }
  return s;
}

/** apply_patch text -> [{ path, removed, added }] */
export function parsePatch(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    const m = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (m) { cur = { path: m[2].trim(), removed: [], added: [] }; out.push(cur); continue; }
    if (!cur || line.startsWith('***') || line.startsWith('@@')) continue;
    if (line.startsWith('-')) cur.removed.push(line.slice(1));
    else if (line.startsWith('+')) cur.added.push(line.slice(1));
  }
  return out.map((f) => ({ path: f.path, removed: clipRaw(f.removed.join('\n'), 1000), added: clipRaw(f.added.join('\n'), 1000) }));
}

function codexCommand(name, args) {
  let a = args;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return null; } }
  if (!a || typeof a !== 'object') return null;
  if (typeof a.cmd === 'string') return a.cmd;
  if (Array.isArray(a.command)) {
    const c = a.command.map(String);
    if (/^(ba|z)?sh$/.test(path.basename(c[0] || '')) && /^-l?c$/.test(c[1] || '')) return c.slice(2).join(' ');
    return c.join(' ');
  }
  if (typeof a.command === 'string') return a.command;
  return null;
}

export function parseCodex(lines, file, cwd0 = null) {
  const s = newSession(file, 'codex');
  s.cwd = cwd0;
  let cwd = cwd0;
  const pending = new Map(); // call_id -> event
  let last = null;
  for (const o of lines) {
    if (!o || typeof o !== 'object') continue;
    const ts = toMs(o.timestamp);
    bump(s, ts);
    const p = o.payload || {};
    if (o.type === 'session_meta') {
      if (typeof p.id === 'string' && /^[\w.-]{1,200}$/.test(p.id)) s.sessionId = p.id;
      if (typeof p.cwd === 'string') { cwd = p.cwd; s.cwd = s.cwd || p.cwd; }
      if (typeof p.git?.branch === 'string' && p.git.branch) s.branch = p.git.branch.slice(0, 200);
      continue;
    }
    if (o.type === 'turn_context' && typeof p.cwd === 'string') { cwd = p.cwd; s.cwd = s.cwd || p.cwd; continue; }
    if (o.type === 'event_msg') {
      if (p.type === 'user_message' && typeof p.message === 'string') {
        const t = p.message.trim();
        if (t && !INJECTED.test(t)) { push(s, { k: 'prompt', ts, text: clipRaw(t), after: last }); last = null; }
      } else if (p.type === 'exec_command_end' && pending.has(p.call_id)) {
        const ev = pending.get(p.call_id);
        if (typeof p.exit_code === 'number') { ev.ok = p.exit_code === 0; if (!ev.ok) ev.err = clipRaw(errLine(`${p.stderr || ''}\n${p.stdout || ''}`) || p.stderr || '', 300); }
      }
      continue;
    }
    if (o.type !== 'response_item') continue;
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const args = typeof p.arguments === 'string' ? p.arguments : typeof p.input === 'string' ? p.input : '';
      const patchSrc = /\*\*\* (?:Update|Add|Delete) File:/.test(args) ? (() => { try { const j = JSON.parse(args); return typeof j.input === 'string' ? j.input : Array.isArray(j.command) ? j.command.join('\n') : args; } catch { return args.replace(/\\n/g, '\n'); } })() : null;
      if (patchSrc) {
        for (const f of parsePatch(patchSrc)) push(s, { k: 'edit', ts, path: codexPath(cwd, f.path), tool: 'apply_patch', changes: [{ removed: f.removed, added: f.added }] });
        last = 'edit';
        continue;
      }
      const cmd = codexCommand(p.name, args);
      if (cmd) {
        const ev = push(s, { k: 'cmd', ts, cmd: clipRaw(cmd, 500), ok: null });
        if (p.call_id) pending.set(p.call_id, ev);
        if (last !== 'edit') last = 'command';
      }
    } else if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && pending.has(p.call_id)) {
      const ev = pending.get(p.call_id);
      if (ev.ok !== null) continue;
      let out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
      let code = null;
      try { const j = JSON.parse(out); if (j && typeof j === 'object') { code = typeof j.metadata?.exit_code === 'number' ? j.metadata.exit_code : null; out = typeof j.output === 'string' ? j.output : out; } } catch { /* plain text */ }
      if (code === null) code = exitOf(out);
      if (code !== null) { ev.ok = code === 0; if (!ev.ok) ev.err = clipRaw(errLine(out) || out.split('\n').find((l) => l.trim()) || '', 300); }
    }
  }
  return s;
}

const cache = new Map(); // file -> { mtimeMs, size, s }

/** Parse one transcript (cached by mtime + size). */
export function readSession(file, tool, maxBytes = MAX_TRANSCRIPT_BYTES) {
  let st;
  try { st = fs.statSync(file); } catch { cache.delete(file); return null; }
  const c = cache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size && c.max === maxBytes) return c.s;
  const lines = readLines(file, maxBytes);
  const s = tool === 'codex' ? parseCodex(lines, file, firstCwd(file)) : parseClaude(lines, file);
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, max: maxBytes, s });
  return s;
}

/** Project-relative POSIX path, or null when outside the root. */
const real = new Map();
export function relTo(root, p) {
  if (typeof p !== 'string' || !p) return null;
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
  if (!real.has(root)) { let r = path.resolve(root); try { r = fs.realpathSync(root); } catch { /* keep */ } real.set(root, r); }
  for (const base of new Set([path.resolve(root), real.get(root)])) {
    const r = path.relative(base, abs);
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) return r.split(path.sep).join('/');
  }
  return null;
}

/**
 * Sessions of this project, newest first, with parsed events (paths made root-relative).
 * Uses ctx.sessions (list + fileOf) like the costs route. Returns [{ sessionId, tool, title, startedAt, lastAt, tokens, branch, events, file }].
 */
export async function projectSessions(ctx, { limit = MAX_SESSIONS } = {}) {
  let list = [];
  try { list = (await ctx.sessions?.list?.()) || []; } catch { list = []; }
  const out = [];
  let codexFiles = null;
  for (const meta of list.slice(0, limit)) {
    const loc = ctx.sessions.fileOf?.(meta.sessionId) || locateTranscript(meta.sessionId, { root: ctx.root, home: ctx.home, codexFiles: codexFiles ||= listCodexTranscripts(ctx.home) });
    if (!loc) continue;
    const s = readSession(loc.file, loc.tool);
    if (!s) continue;
    const events = s.events.map((e) => (e.path === undefined ? e : { ...e, path: relTo(ctx.root, e.path) || e.path, inRoot: !!relTo(ctx.root, e.path) }));
    out.push({ ...meta, branch: s.branch, events, file: loc.file, startedAt: meta.startedAt || s.startedAt, lastAt: meta.lastAt || s.lastAt });
  }
  return out;
}

/** Cheap signature of the transcripts a computation depends on (for result caches). */
export function signature(sessions) {
  return sessions.map((s) => `${s.sessionId}:${s.lastAt}:${s.events.length}`).join('|');
}
