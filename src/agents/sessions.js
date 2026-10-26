import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WRITE_TOOLS, textOf } from '../usage/records.js';

const TOLERANCE_MS = 120000;
/** Only the last MAX_TRANSCRIPT_BYTES of a transcript are parsed (shared with agentcenter/transcript.js). */
export const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const WALK_TTL_MS = 60000;

/** Claude Code project dir name: every non-alphanumeric char becomes "-". */
export function projectDirName(root) {
  return path.resolve(root).replace(/[^A-Za-z0-9]/g, '-');
}

function toMs(v) {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isNaN(n) ? 0 : n;
}

function cleanPrompt(t) {
  const s = String(t || '').trim();
  if (!s) return '';
  // skip injected system-ish content
  if (/^<(?:system-reminder|command-|local-command|environment_context|user_instructions|ide_|task-notification)/i.test(s)) return '';
  if (/^\[Request interrupted/i.test(s) || /^Caveat:/.test(s)) return '';
  return s.replace(/\s+/g, ' ').slice(0, 300);
}

function newState(file) {
  return {
    tool: 'claude', sessionId: path.basename(file, '.jsonl'), summary: null, firstPrompt: null,
    lastPrompt: null, startedAt: 0, lastAt: 0, messages: 0, cwd: null,
    usage: new Map(), anon: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, touches: [],
  };
}

function bump(st, ts) {
  if (!ts) return;
  if (!st.startedAt || ts < st.startedAt) st.startedAt = ts;
  if (ts > st.lastAt) st.lastAt = ts;
}

function applyClaude(st, o) {
  if (!o || typeof o !== 'object') return;
  if (o.sessionId && typeof o.sessionId === 'string') st.sessionId = o.sessionId;
  if (o.cwd && !st.cwd) st.cwd = o.cwd;
  const ts = toMs(o.timestamp);
  if (o.type === 'summary') {
    if (typeof o.summary === 'string' && o.summary.trim()) st.summary = o.summary.trim().slice(0, 200);
    return;
  }
  if (o.type === 'last-prompt') {
    if (typeof o.lastPrompt === 'string') st.lastPromptEntry = cleanPrompt(o.lastPrompt) || st.lastPromptEntry;
    return;
  }
  if (o.type !== 'user' && o.type !== 'assistant') return;
  bump(st, ts);
  st.messages++;
  const msg = o.message || {};
  if (o.type === 'user') {
    if (o.isMeta) return;
    const c = msg.content;
    const isToolResult = Array.isArray(c) && c.length > 0 && c.every((x) => x && x.type === 'tool_result');
    if (!isToolResult) {
      const p = cleanPrompt(textOf(c));
      if (p) {
        if (!st.firstPrompt) st.firstPrompt = p;
        st.lastPrompt = p;
      }
    }
    return;
  }
  const u = msg.usage;
  if (u && typeof u === 'object') {
    const rec = {
      input: +u.input_tokens || 0, output: +u.output_tokens || 0,
      cacheRead: +u.cache_read_input_tokens || 0, cacheWrite: +u.cache_creation_input_tokens || 0,
    };
    if (msg.id) st.usage.set(msg.id, rec); // one API message can span several lines; count once
    else for (const k of Object.keys(rec)) st.anon[k] += rec[k];
  }
  if (Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c && c.type === 'tool_use' && WRITE_TOOLS.has(c.name) && c.input) {
        const fp = c.input.file_path || c.input.notebook_path || c.input.path;
        if (typeof fp === 'string' && fp) st.touches.push({ file: fp, ts, prompt: st.lastPrompt || null });
      }
    }
  }
}

/** Codex patch paths are relative to the session's working directory, not the project root. */
export function codexPath(cwd, p) {
  return typeof cwd === 'string' && path.isAbsolute(cwd) && !path.isAbsolute(p) ? path.join(cwd, p) : p;
}

function applyCodex(st, o) {
  if (!o || typeof o !== 'object') return;
  const ts = toMs(o.timestamp);
  bump(st, ts);
  const p = o.payload || {};
  if (o.type === 'session_meta') {
    if (p.id) st.sessionId = p.id;
    if (p.cwd) st.cwd = st.curCwd = p.cwd;
    return;
  }
  if (o.type === 'turn_context' && typeof p.cwd === 'string' && p.cwd) {
    if (!st.cwd) st.cwd = p.cwd;
    st.curCwd = p.cwd;
  }
  if (o.type === 'event_msg') {
    if (p.type === 'user_message') {
      st.messages++;
      const t = cleanPrompt(p.message);
      if (t) { st.firstPrompt = st.firstPrompt || t; st.lastPrompt = t; }
    } else if (p.type === 'agent_message') st.messages++;
    else if (p.type === 'token_count' && p.info && p.info.total_token_usage) {
      const t = p.info.total_token_usage;
      st.anon = { input: +t.input_tokens || 0, output: +t.output_tokens || 0, cacheRead: +t.cached_input_tokens || 0, cacheWrite: 0 };
    }
    return;
  }
  if (o.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
    const args = typeof p.arguments === 'string' ? p.arguments : typeof p.input === 'string' ? p.input : '';
    const re = /\*\*\* (?:Update|Add|Delete) File: ([^\\\n"]+)/g;
    let m;
    while ((m = re.exec(args.replace(/\\n/g, '\n')))) st.touches.push({ file: codexPath(st.curCwd || st.cwd, m[1].trim()), ts, prompt: st.lastPrompt || null });
  }
}

/** Parse the complete lines of a buffer; returns bytes consumed. */
function feed(st, buf, apply) {
  const end = buf.lastIndexOf(0x0a);
  if (end < 0) return 0;
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    try { apply(st, JSON.parse(line)); } catch { /* tolerate malformed lines */ }
  }
  return end + 1;
}

// file -> { mtimeMs, size, offset, state }
const cache = new Map();

function parseFile(file, kind, max = MAX_TRANSCRIPT_BYTES) {
  let fd, stat;
  try { fd = fs.openSync(file, 'r'); stat = fs.fstatSync(fd); } catch {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
    cache.delete(file); return null;
  }
  let c = cache.get(file);
  if (c && c.mtimeMs === stat.mtimeMs && c.size === stat.size) { try { fs.closeSync(fd); } catch { /* ignore */ } return c.state; }
  const apply = kind === 'codex' ? applyCodex : applyClaude;
  if (!c || stat.size < c.offset) {
    c = { offset: 0, state: newState(file) };
    if (kind === 'codex') c.state.tool = 'codex';
  }
  try {
    let skip = false;
    if (stat.size - c.offset > max) { // huge transcript / backlog: parse only the tail
      if (!c.offset) { // session_meta is in the head
        const m = headMeta(file);
        if (m.cwd) c.state.cwd = c.state.curCwd = m.cwd;
        if (m.id && kind === 'codex') c.state.sessionId = m.id;
      }
      c.offset = stat.size - max;
      skip = true;
    }
    const len = stat.size - c.offset;
    if (len > 0) {
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, c.offset);
      let b = buf.subarray(0, n);
      if (skip) { // drop the partial first line
        const nl = b.indexOf(0x0a);
        const cut = nl < 0 ? 0 : nl + 1;
        c.offset += cut;
        b = b.subarray(cut);
      }
      c.offset += feed(c.state, b, apply);
    }
  } catch { /* unreadable: keep what we have */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
  c.mtimeMs = stat.mtimeMs;
  c.size = stat.size;
  cache.set(file, c);
  return c.state;
}

function listJsonl(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
  } catch { return []; }
}

function walkJsonl(dir, depth = 0, out = []) {
  if (depth > 5) return out;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, depth + 1, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function head(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(65536);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.subarray(0, n).toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

export function firstCwd(file, text = head(file)) {
  for (const line of text.split('\n')) {
    const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line);
    if (m) { try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; } }
  }
  return null;
}

/** cwd + codex session id from a transcript's head (for tail-only parses that never see session_meta). */
function headMeta(file) {
  const text = head(file);
  const id = /^[^\n]*"type":"session_meta"[^\n]*?"payload":\{"id":"([\w.-]{1,200})"/.exec(text);
  return { cwd: firstCwd(file, text), id: id ? id[1] : null };
}

/**
 * @param {string} root absolute project root
 * @param {{home?:string, maxBytes?:number}} [opts]
 */
export function createSessions(root, { home = os.homedir(), maxBytes = MAX_TRANSCRIPT_BYTES } = {}) {
  const absRoot = path.resolve(root);
  const projectsDir = path.join(home, '.claude', 'projects');
  const codexDir = path.join(home, '.codex', 'sessions');

  function claudeFiles() {
    const names = new Set([projectDirName(absRoot), absRoot.replace(/\//g, '-')]);
    const files = [];
    for (const n of names) files.push(...listJsonl(path.join(projectsDir, n)));
    if (files.length) return files;
    // fallback: match by cwd recorded inside transcripts
    let dirs = [];
    try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
    for (const d of dirs) {
      if (names.has(d.name)) continue;
      const fs_ = listJsonl(path.join(projectsDir, d.name));
      if (!fs_.length) continue;
      const hit = fs_.slice(0, 3).some((f) => {
        const cwd = firstCwd(f);
        return cwd && path.resolve(cwd) === absRoot;
      });
      if (hit) files.push(...fs_);
    }
    return files;
  }

  function rel(p) {
    const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(absRoot, p);
    const r = path.relative(absRoot, abs);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
    return r.split(path.sep).join('/');
  }

  function inRoot(cwd) {
    if (!cwd) return false;
    const r = path.relative(absRoot, path.resolve(cwd));
    return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
  }

  // The codex tree holds every session of every project, so it is not re-walked per file change.
  // New rollouts land in the newest sessions/YYYY/MM/DD dir: the mtimes of that dir chain (a few stats)
  // tell when a file appeared; a slow TTL catches anything else.
  let walk = { at: 0, sig: '', files: [] };
  function walkSig() {
    const sig = [];
    let d = codexDir;
    for (let i = 0; i < 4; i++) {
      let st, ents;
      try { st = fs.statSync(d); ents = fs.readdirSync(d, { withFileTypes: true }); } catch { break; }
      sig.push(`${st.mtimeMs}:${ents.length}`); // entry count too: coarse mtimes (1s on HFS+) can hide a new file
      const last = ents.filter((e) => e.isDirectory()).map((e) => e.name).sort().pop();
      if (!last) break;
      d = path.join(d, last);
    }
    return sig.join(',');
  }
  function codexFiles() {
    const now = Date.now();
    const sig = walkSig();
    if (now - walk.at < WALK_TTL_MS && sig === walk.sig) return walk.files;
    walk = { at: now, sig, files: sig ? walkJsonl(codexDir) : [] };
    return walk.files;
  }

  const files = new Map(); // sessionId -> { file, tool }, for timelines/costs of cwd-matched sessions

  function collect() {
    const states = [];
    for (const f of claudeFiles()) {
      const st = parseFile(f, 'claude', maxBytes);
      if (st) { states.push(st); files.set(st.sessionId, { file: f, tool: 'claude' }); }
    }
    for (const f of codexFiles()) {
      const st = parseFile(f, 'codex', maxBytes);
      if (st && inRoot(st.cwd)) { states.push(st); files.set(st.sessionId, { file: f, tool: 'codex' }); }
    }
    return states.filter((s) => s.messages > 0 || s.touches.length > 0);
  }

  function tokensOf(st) {
    const t = { ...st.anon };
    for (const u of st.usage.values()) {
      t.input += u.input; t.output += u.output; t.cacheRead += u.cacheRead; t.cacheWrite += u.cacheWrite;
    }
    return t;
  }

  return {
    async list() {
      const out = collect().map((st) => {
        const files = new Set();
        for (const t of st.touches) { const r = rel(t.file); if (r) files.add(r); }
        return {
          tool: st.tool,
          sessionId: st.sessionId,
          title: st.summary || st.firstPrompt || st.lastPromptEntry || '(untitled)',
          startedAt: st.startedAt,
          lastAt: st.lastAt,
          messages: st.messages,
          tokens: tokensOf(st),
          filesTouched: [...files],
        };
      });
      return out.sort((a, b) => b.lastAt - a.lastAt);
    },

    async attribute(filePath, ts) {
      const target = rel(filePath);
      if (!target) return null;
      const at = toMs(ts);
      if (!at) return null;
      let best = null;
      for (const st of collect()) {
        for (const t of st.touches) {
          if (rel(t.file) !== target) continue;
          const d = at - t.ts;
          if (Math.abs(d) > TOLERANCE_MS) continue;
          const score = d >= 0 ? d : -d * 2 + 1; // prefer the touch just before the change
          if (!best || score < best.score) best = { score, st, t };
        }
      }
      if (!best) return null;
      const { st, t } = best;
      const ref = { tool: st.tool, sessionId: st.sessionId, title: st.summary || st.firstPrompt || undefined, ts: t.ts };
      const lp = t.prompt || st.lastPrompt;
      if (lp) ref.lastPrompt = lp;
      if (!ref.title) delete ref.title;
      return ref;
    },

    /** { file, tool } of a session matched to this root (incl. claude cwd fallback, codex by cwd), or null. */
    fileOf(id) {
      if (!files.has(id)) collect();
      return files.get(id) || null;
    },
  };
}
