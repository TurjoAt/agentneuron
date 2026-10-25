// Raw transcript access (Claude Code + Codex JSONL) for timelines and cost estimation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { maskSecretsInText } from '../health/secrets.js';
import { projectDirName } from '../agents/sessions.js';
import { readRegular } from '../files/safeio.js';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_TIMELINE = 3000;

// always a finite, Date-representable epoch ms (or 0): hostile timestamps must not make toISOString() throw
const toMs = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) && Math.abs(n) <= 8.64e15 ? n : 0;
};
const clip = (s, n = 500) => maskSecretsInText(String(s ?? '').replace(/\s+/g, ' ').trim()).slice(0, n);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
  return '';
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

/** All Codex rollout files (walk once and pass as codexFiles when locating many sessions). */
export function listCodexTranscripts(home = os.homedir()) { return walkJsonl(path.join(home, '.codex', 'sessions')); }

/** Find the transcript file for a session id. Returns { file, tool } | null. */
export function locateTranscript(id, { root, home = os.homedir(), codexFiles = null } = {}) {
  if (typeof id !== 'string' || !/^[\w.-]{1,200}$/.test(id)) return null;
  const projects = path.join(home, '.claude', 'projects');
  const tryDir = (d) => { const f = path.join(d, `${id}.jsonl`); return fs.existsSync(f) ? f : null; };
  if (root) {
    const f = tryDir(path.join(projects, projectDirName(root))) || tryDir(path.join(projects, path.resolve(root).replace(/\//g, '-')));
    if (f) return { file: f, tool: 'claude' };
  }
  if (!root) { // a foreign project dir is only trusted when no root is given
    try {
      for (const d of fs.readdirSync(projects, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const f = tryDir(path.join(projects, d.name));
        if (f) return { file: f, tool: 'claude' };
      }
    } catch { /* none */ }
  }
  for (const f of codexFiles || listCodexTranscripts(home)) {
    const b = path.basename(f);
    if (b === `${id}.jsonl` || b.endsWith(`-${id}.jsonl`)) return { file: f, tool: 'codex' };
  }
  return null;
}

function readLines(file) {
  const r = readRegular(file, { follow: true, tail: MAX_BYTES });
  if (!r) return [];
  const buf = r.buf;
  const out = [];
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed or truncated line */ }
  }
  return out;
}

function relPath(root, p) {
  if (typeof p !== 'string' || !p) return undefined;
  if (!root) return p;
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
  const r = path.relative(path.resolve(root), abs);
  return !r || r.startsWith('..') || path.isAbsolute(r) ? p : r.split(path.sep).join('/');
}

function summarizeInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = input.command ?? input.pattern ?? input.query ?? input.url ?? input.prompt ?? input.description ?? input.file_path ?? input.path ?? '';
  return typeof pick === 'string' ? pick : JSON.stringify(pick);
}

function injected(t) {
  return /^<(?:system-reminder|command-|local-command|environment_context|user_instructions|ide_|task-notification)/i.test(t) || /^\[Request interrupted/i.test(t) || /^Caveat:/.test(t);
}

function claudeTimeline(lines, root) {
  const tl = [];
  for (const o of lines) {
    if (!o || typeof o !== 'object') continue;
    const ts = toMs(o.timestamp);
    if (o.type === 'summary' && typeof o.summary === 'string') { tl.push({ ts, type: 'summary', text: clip(o.summary) }); continue; }
    const msg = o.message || {};
    if (o.type === 'user' && !o.isMeta) {
      const c = msg.content;
      if (Array.isArray(c) && c.length && c.every((x) => x && x.type === 'tool_result')) continue;
      const t = textOf(c).trim();
      if (t && !injected(t)) tl.push({ ts, type: 'prompt', text: clip(t) });
    } else if (o.type === 'assistant' && Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (!c || c.type !== 'tool_use') continue;
        const inp = c.input || {};
        if (WRITE_TOOLS.has(c.name)) {
          const fp = inp.file_path || inp.notebook_path || inp.path;
          tl.push({ ts, type: 'edit', tool: c.name, path: relPath(root, fp), text: clip(fp) });
        } else {
          const e = { ts, type: 'tool', tool: c.name, text: clip(summarizeInput(c.name, inp)) };
          const fp = inp.file_path || inp.path;
          if (typeof fp === 'string') e.path = relPath(root, fp);
          tl.push(e);
        }
      }
    }
    if (tl.length >= MAX_TIMELINE) break;
  }
  return tl;
}

function codexTimeline(lines, root) {
  const tl = [];
  for (const o of lines) {
    if (!o || typeof o !== 'object') continue;
    const ts = toMs(o.timestamp);
    const p = o.payload || {};
    if (o.type === 'event_msg' && p.type === 'user_message' && typeof p.message === 'string' && !injected(p.message.trim())) {
      tl.push({ ts, type: 'prompt', text: clip(p.message) });
    } else if (o.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
      const args = typeof p.arguments === 'string' ? p.arguments : typeof p.input === 'string' ? p.input : '';
      const patch = /\*\*\* (Update|Add|Delete) File: ([^\\\n"]+)/.exec(args.replace(/\\n/g, '\n'));
      if (patch) tl.push({ ts, type: 'edit', tool: p.name || 'apply_patch', path: relPath(root, patch[2].trim()), text: clip(patch[2]) });
      else tl.push({ ts, type: 'tool', tool: p.name || 'tool', text: clip(args) });
    }
    if (tl.length >= MAX_TIMELINE) break;
  }
  return tl;
}

/**
 * Timeline of one session. `sessionsApi` is the v0.1 sessions object (used for the metadata);
 * opts.root / opts.home locate the transcript. Text is truncated to 500 chars and secrets masked.
 */
export async function sessionTimeline(sessionsApi, id, { root, home } = {}) {
  let session = null;
  try { session = (await sessionsApi?.list?.())?.find((s) => s.sessionId === id) || null; } catch { /* metadata is optional */ }
  const loc = locateTranscript(id, { root, home });
  if (!loc) return { session, timeline: [] };
  const lines = readLines(loc.file);
  const timeline = (loc.tool === 'codex' ? codexTimeline(lines, root) : claudeTimeline(lines, root)).filter((e) => e.ts || e.type === 'summary');
  timeline.sort((a, b) => a.ts - b.ts);
  if (session) session = { ...session, title: maskSecretsInText(session.title || '') };
  return { session, timeline };
}

const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const addU = (t, u) => { for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) t[k] = (t[k] || 0) + (u[k] || 0); };

/** Per-model token usage of one transcript: { models: {model: usage}, days: {day: {model: usage}}, tool } */
export function readTranscriptUsage(file, tool = 'claude') {
  const lines = readLines(file);
  // model names come from untrusted transcripts ("__proto__", "constructor"): only ever touch OWN properties
  const slot = (o, k) => {
    if (!Object.hasOwn(o, k)) Object.defineProperty(o, k, { value: {}, enumerable: true, writable: true, configurable: true });
    return o[k];
  };
  const models = {};
  const days = {};
  const bump = (model, ts, u) => {
    addU(slot(models, model), u);
    if (ts) addU(slot(slot(days, day(ts)), model), u);
  };
  if (tool === 'codex') {
    let model = 'gpt', last = null, lastTs = 0;
    for (const o of lines) {
      const p = o?.payload || {};
      if (o?.type === 'turn_context' && typeof p.model === 'string') model = p.model;
      if (o?.type === 'session_meta' && typeof p.model === 'string') model = p.model;
      if (o?.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
        const t = p.info.total_token_usage;
        last = { input: +t.input_tokens || 0, output: +t.output_tokens || 0, cacheRead: +t.cached_input_tokens || 0, cacheWrite: 0 };
        lastTs = toMs(o.timestamp);
      }
    }
    if (last) { last.input = Math.max(0, last.input - last.cacheRead); bump(model, lastTs, last); }
    return { tool, models, days };
  }
  const seen = new Map(); // message id -> { model, ts, u } (last line of a message wins)
  let anon = 0;
  for (const o of lines) {
    if (o?.type !== 'assistant' || !o.message?.usage) continue;
    const m = o.message, u = m.usage;
    const rec = { model: typeof m.model === 'string' ? m.model : 'unknown', ts: toMs(o.timestamp),
      u: { input: +u.input_tokens || 0, output: +u.output_tokens || 0, cacheRead: +u.cache_read_input_tokens || 0, cacheWrite: +u.cache_creation_input_tokens || 0 } };
    seen.set(m.id || `anon-${anon++}`, rec);
  }
  for (const r of seen.values()) if (r.model !== '<synthetic>') bump(r.model, r.ts, r.u);
  return { tool, models, days };
}

const usageCache = new Map(); // file -> { mtimeMs, size, usage }
export function readTranscriptUsageCached(file, tool) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const c = usageCache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.usage;
  const usage = readTranscriptUsage(file, tool);
  usageCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, usage });
  return usage;
}
