// The usage parser: one pass over a transcript into a compact digest (aggregates, no reply text).
// Claude Code records are read here; Codex rollouts reuse the insights parser plus the shared token reader.
// Digests are cached per file by mtimeMs + size; parses run with bounded concurrency and share in-flight work.
import path from 'node:path';
import { MAX_TRANSCRIPT_BYTES } from '../agents/sessions.js';
import { codexTokenUsage } from '../agentcenter/transcript.js';
import { parseCodex } from '../insights/transcripts.js';
import { safeRead } from './guard.js';
import {
  WRITE_TOOLS, INTERRUPT, toMs, num, textOf, resultText, isInjected, clip, usageOf, toolKind, editPath, patchLines, inputLines,
} from './records.js';

const GAP_MS = 5 * 60 * 1000; // a pause longer than this ends an active span
const MAX_ITEMS = 20000; // per array, per transcript
const PROMPT_CHARS = 2000;
const SKIP = ['{"type":"api-request', '{"type":"queue-operation', '{"type":"atis-latch'];
const REWORK = /\b(no|nope|wrong|revert|undo|instead|still|again|didn'?t|doesn'?t|isn'?t|not working|broke|broken|that's not|fix (it|this|that))\b/i;

const push = (a, v) => { if (a.length < MAX_ITEMS) a.push(v); };

/** Split text into lines and parse each JSON line; never throws. Drops the partial first line of a tail read. */
export function parseLines(text, partial = false) {
  const out = [];
  if (partial) text = text.slice(text.indexOf('\n') + 1);
  for (const line of text.split('\n')) {
    if (!line || SKIP.some((p) => line.startsWith(p))) continue;
    try { const o = JSON.parse(line); if (o && typeof o === 'object') out.push(o); } catch { /* malformed or truncated line */ }
  }
  return out;
}

function newDigest(file, tool) {
  return {
    v: 1, file, tool, sessionId: tool === 'claude' ? path.basename(file, '.jsonl') : null, agentId: null, cwd: null,
    title: null, aiTitle: null, customTitle: null, agentName: null, firstPrompt: null, slugs: [],
    startedAt: 0, lastAt: 0, branches: {}, lastBranch: null,
    msgs: [], // [id, ts, model, input, output, cacheRead, cacheWrite, agentId]
    costStates: {}, // startTime -> { usd, linesAdded, linesRemoved, hasModels }
    prompts: [], // { ts, text, length, msgFrom, pasted }
    tools: [], // { id, ts, name, kind, server, ms, err, denied, path, skill, agentId, sample }
    turns: [], // [ts, ms]
    hooks: [], // [ts, runs, errors, prevented]
    compactions: [], interrupts: [], away: [], apiErrors: [],
    denials: [], // [ts, kind, tool]
    permModes: {},
    edits: [], // { ts, path, tool, added, removed, ok }
    fileHistory: [], // { path, backup, version, ts, messageId }
    spawns: [], // { ts, toolUseId, agentId, name }
    messages: [], // { ts, from, to }  (SendMessage)
    advisor: { calls: 0, model: null, firstTs: 0, lastAt: 0 },
    thinking: { count: 0, ms: 0 },
    spans: [], // [start, end] active spans (gap <= GAP_MS)
  };
}

function touch(d, ts) {
  if (!ts) return;
  if (!d.startedAt || ts < d.startedAt) d.startedAt = ts;
  if (ts > d.lastAt) d.lastAt = ts;
  const s = d.spans[d.spans.length - 1];
  if (s && ts >= s[0] - GAP_MS && ts <= s[1] + GAP_MS) { if (ts > s[1]) s[1] = ts; if (ts < s[0]) s[0] = ts; } else push(d.spans, [ts, ts]);
}

/** Claude Code transcript (main session or subagent) -> digest. */
export function digestClaude(lines, file) {
  const d = newDigest(file, 'claude');
  const msgIndex = new Map();
  const pending = new Map(); // tool_use id -> tool row
  const editById = new Map(); // tool_use id -> edit row
  const spawnById = new Map();
  const fh = new Map(); // path@version -> entry
  let anon = 0;
  const addFh = (p, b, ts, messageId) => {
    if (typeof p !== 'string' || !p || !b || typeof b !== 'object') return;
    const version = num(b.version);
    const key = `${p}@${version}`;
    if (fh.has(key)) return;
    const backup = typeof b.backupFileName === 'string' && /^[\w.-]{1,200}@v\d+$/.test(b.backupFileName) ? b.backupFileName : null;
    const e = { path: d.cwd && !path.isAbsolute(p) ? path.resolve(d.cwd, p) : p, backup, version, ts: toMs(b.backupTime) || ts, messageId: typeof messageId === 'string' ? messageId : null };
    fh.set(key, e);
    push(d.fileHistory, e);
  };
  for (const o of lines) {
    const ts = toMs(o.timestamp);
    if (typeof o.sessionId === 'string' && /^[\w.-]{1,200}$/.test(o.sessionId)) d.sessionId = o.sessionId;
    if (typeof o.agentId === 'string' && o.isSidechain && !d.agentId) d.agentId = o.agentId.slice(0, 100);
    if (typeof o.cwd === 'string' && !d.cwd) d.cwd = o.cwd;
    if (typeof o.slug === 'string' && /^[\w-]{1,120}$/.test(o.slug) && !d.slugs.includes(o.slug) && d.slugs.length < 50) d.slugs.push(o.slug);
    if (typeof o.gitBranch === 'string' && o.gitBranch && o.gitBranch !== 'HEAD' && (o.type === 'user' || o.type === 'assistant')) {
      const b = o.gitBranch.slice(0, 200);
      d.branches[b] = (Object.hasOwn(d.branches, b) ? d.branches[b] : 0) + 1;
      d.lastBranch = b;
    }
    switch (o.type) {
      case 'ai-title': if (typeof o.aiTitle === 'string') d.aiTitle = clip(o.aiTitle, 200); continue;
      case 'custom-title': if (typeof o.customTitle === 'string') d.customTitle = clip(o.customTitle, 200); continue;
      case 'agent-name': if (typeof o.agentName === 'string') d.agentName = clip(o.agentName, 100); continue;
      case 'summary': if (typeof o.summary === 'string') d.title = clip(o.summary, 200); continue;
      case 'permission-mode': if (typeof o.permissionMode === 'string') bumpKey(d.permModes, o.permissionMode); continue;
      case 'cost-state': {
        const k = String(num(o.startTime));
        const hasModels = !!(o.modelUsage && typeof o.modelUsage === 'object' && Object.keys(o.modelUsage).length);
        d.costStates[k] = { usd: num(o.totalCostUSD), linesAdded: num(o.totalLinesAdded), linesRemoved: num(o.totalLinesRemoved), hasModels };
        continue;
      }
      case 'file-history-snapshot': {
        const s = o.snapshot?.trackedFileBackups;
        if (s && typeof s === 'object') for (const [p, b] of Object.entries(s)) addFh(p, b, toMs(o.snapshot?.timestamp), o.messageId);
        continue;
      }
      case 'file-history-delta': addFh(o.trackingPath, o.backup, ts, o.messageId); continue;
      case 'system': {
        touch(d, ts);
        if (o.subtype === 'turn_duration' && num(o.durationMs) > 0) push(d.turns, [ts, num(o.durationMs)]);
        else if (o.subtype === 'stop_hook_summary') push(d.hooks, [ts, num(o.hookCount), Array.isArray(o.hookErrors) ? o.hookErrors.length : 0, o.preventedContinuation === true ? 1 : 0]);
        else if (o.subtype === 'compact_boundary') push(d.compactions, ts);
        else if (o.subtype === 'away_summary') push(d.away, ts);
        continue;
      }
      case 'user': {
        touch(d, ts);
        if (typeof o.permissionMode === 'string') bumpKey(d.permModes, o.permissionMode);
        const c = o.message?.content;
        if (Array.isArray(c) && c.some((x) => x && x.type === 'tool_result')) {
          for (const r of c) {
            if (!r || r.type !== 'tool_result') continue;
            const t = pending.get(r.tool_use_id);
            if (!t) continue;
            pending.delete(r.tool_use_id);
            if (t.ts && ts >= t.ts) t.ms = ts - t.ts;
            if (typeof o.toolDenialKind === 'string') {
              t.denied = o.toolDenialKind.slice(0, 40);
              push(d.denials, [ts, t.denied, t.name]);
            } else if (r.is_error === true) {
              t.err = true;
              const first = resultText(r.content).split('\n').map((l) => l.trim()).find(Boolean) || '';
              t.sample = clip(first, 160);
            }
            const tur = o.toolUseResult && typeof o.toolUseResult === 'object' ? o.toolUseResult : null;
            const ed = editById.get(r.tool_use_id);
            if (ed) {
              ed.ok = !t.err && !t.denied;
              const pl = tur ? patchLines(tur.structuredPatch) : null;
              if (pl && (pl.added || pl.removed)) { ed.added = pl.added; ed.removed = pl.removed; }
            }
            const sp = spawnById.get(r.tool_use_id);
            if (sp && tur && typeof tur.agentId === 'string') sp.agentId = tur.agentId.slice(0, 100);
          }
          continue;
        }
        if (o.isMeta || o.isCompactSummary) continue;
        const t = textOf(c).trim();
        if (!t) continue;
        if (INTERRUPT.test(t)) { push(d.interrupts, ts); continue; }
        if (isInjected(t)) continue;
        const text = clip(t, PROMPT_CHARS);
        if (!d.firstPrompt) d.firstPrompt = clip(t, 200);
        push(d.prompts, { ts, text, length: t.length, msgFrom: d.msgs.length, tools: d.tools.length, rework: REWORK.test(t.slice(0, 400)) });
        continue;
      }
      case 'assistant': {
        touch(d, ts);
        const m = o.message || {};
        const agentId = typeof o.agentId === 'string' ? o.agentId.slice(0, 100) : null;
        if (o.isApiErrorMessage) push(d.apiErrors, ts);
        if (typeof o.advisorModel === 'string') d.advisor.model = o.advisorModel.slice(0, 100);
        const u = usageOf(m.usage);
        const model = typeof m.model === 'string' ? m.model.slice(0, 100) : 'unknown';
        if (u && model !== '<synthetic>') {
          const id = typeof m.id === 'string' ? m.id : `anon-${anon++}`;
          const row = [id, ts, model, u.input, u.output, u.cacheRead, u.cacheWrite, agentId];
          if (msgIndex.has(id)) d.msgs[msgIndex.get(id)] = row; // one API message spans several lines: last wins
          else if (d.msgs.length < MAX_ITEMS) { msgIndex.set(id, d.msgs.length); d.msgs.push(row); }
        }
        if (typeof o.thinkingDurationMs === 'number' && o.thinkingDurationMs > 0) { d.thinking.count++; d.thinking.ms += o.thinkingDurationMs; }
        for (const b of Array.isArray(m.content) ? m.content : []) {
          if (!b || typeof b !== 'object') continue;
          if (b.type === 'server_tool_use' && b.name === 'advisor') {
            d.advisor.calls++; if (!d.advisor.firstTs) d.advisor.firstTs = ts; d.advisor.lastAt = ts;
            continue;
          }
          if (b.type !== 'tool_use' || typeof b.name !== 'string') continue;
          const name = b.name.slice(0, 120);
          const inp = b.input && typeof b.input === 'object' ? b.input : {};
          const k = toolKind(name);
          const row = { id: typeof b.id === 'string' ? b.id : null, ts, name, kind: k.kind, server: k.server, ms: null, err: false, denied: null, path: null, skill: null, agentId, sample: null };
          if (name === 'Skill' && typeof inp.skill === 'string') row.skill = inp.skill.slice(0, 100);
          if (WRITE_TOOLS.has(name)) {
            const fp = editPath(inp);
            if (typeof fp === 'string' && fp) {
              row.path = d.cwd && !path.isAbsolute(fp) ? path.resolve(d.cwd, fp) : fp;
              const il = inputLines(name, inp);
              const ed = { ts, path: row.path, tool: name, added: il.added, removed: il.removed, ok: null };
              push(d.edits, ed);
              if (row.id) editById.set(row.id, ed);
            }
          } else if (typeof (inp.file_path || inp.notebook_path) === 'string') row.path = inp.file_path || inp.notebook_path;
          if (name === 'Agent' || name === 'Task') {
            const sp = { ts, toolUseId: row.id, agentId: null, name: typeof inp.subagent_type === 'string' ? inp.subagent_type.slice(0, 60) : null };
            push(d.spawns, sp);
            if (row.id) spawnById.set(row.id, sp);
          }
          if (name === 'SendMessage' && typeof (inp.to || inp.recipient) === 'string') push(d.messages, { ts, from: agentId || 'main', to: String(inp.to || inp.recipient).slice(0, 100) });
          push(d.tools, row);
          if (row.id) pending.set(row.id, row);
        }
        continue;
      }
      default: continue; // unknown record types are ignored
    }
  }
  d.title = d.customTitle || d.aiTitle || d.title || null;
  return d;
}

function bumpKey(o, k) { const key = String(k).slice(0, 40); o[key] = (Object.hasOwn(o, key) ? o[key] : 0) + 1; }

/** Codex rollout -> digest (prompts, commands, patches, tokens from the shared readers). */
export function digestCodex(lines, file) {
  const d = newDigest(file, 'codex');
  const s = parseCodex(lines, file);
  d.sessionId = s.sessionId || path.basename(file, '.jsonl');
  d.cwd = s.cwd;
  if (s.branch) { d.branches[s.branch] = 1; d.lastBranch = s.branch; }
  for (const o of lines) touch(d, toMs(o.timestamp));
  const tok = codexTokenUsage(lines);
  if (tok.usage) d.msgs.push(['codex-total', tok.ts || d.lastAt, tok.model, tok.usage.input, tok.usage.output, tok.usage.cacheRead, 0, null]);
  for (const e of s.events) {
    if (e.k === 'prompt') {
      if (!d.firstPrompt) d.firstPrompt = clip(e.text, 200);
      push(d.prompts, { ts: e.ts, text: clip(e.text, PROMPT_CHARS), length: String(e.text || '').length, msgFrom: 0, tools: d.tools.length, rework: REWORK.test(String(e.text).slice(0, 400)) });
    } else if (e.k === 'cmd') {
      push(d.tools, { id: null, ts: e.ts, name: 'shell', kind: 'builtin', server: null, ms: null, err: e.ok === false, denied: null, path: null, skill: null, agentId: null, sample: e.ok === false ? clip(e.err || '', 160) : null });
    } else if (e.k === 'edit') {
      const ch = e.changes?.[0] || {};
      const lines2 = (t) => (t ? String(t).split('\n').length : 0);
      push(d.tools, { id: null, ts: e.ts, name: 'apply_patch', kind: 'builtin', server: null, ms: null, err: false, denied: null, path: e.path, skill: null, agentId: null, sample: null });
      push(d.edits, { ts: e.ts, path: e.path, tool: 'apply_patch', added: lines2(ch.added), removed: lines2(ch.removed), ok: true });
    }
  }
  d.title = null;
  return d;
}

// ---- cache + loading -------------------------------------------------------------------------------------------

const cache = new Map(); // file -> { mtimeMs, size, d }
const inflight = new Map(); // file -> Promise<digest|null>
const MAX_CACHE = 5000;

/** Cached digest when the file is unchanged, else undefined. */
export function cachedDigest(f) {
  const c = cache.get(f.file);
  return c && c.mtimeMs === f.mtimeMs && c.size === f.size ? c.d : undefined;
}

/** Read + digest one file ({ file, tool, mtimeMs, size }); cached by mtimeMs + size; never throws. */
export async function digestFile(f, home) {
  const hit = cachedDigest(f);
  if (hit !== undefined) return hit;
  const key = `${f.file}|${f.mtimeMs}|${f.size}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    let d = null;
    try {
      const r = await safeRead(f.file, home, { tail: MAX_TRANSCRIPT_BYTES });
      if (r) {
        const lines = parseLines(r.buf.toString('utf8'), r.st.size > r.buf.length);
        d = f.tool === 'codex' ? digestCodex(lines, f.file) : digestClaude(lines, f.file);
      }
    } catch { d = null; }
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(f.file, { mtimeMs: f.mtimeMs, size: f.size, d });
    return d;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function clearDigestCache() { cache.clear(); }
