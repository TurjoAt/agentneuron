// Shared primitives for reading Claude Code / Codex transcript records. Used by the usage digest and
// timeline, and by the older readers (agentcenter/transcript.js) so the record conventions live in one place.
import path from 'node:path';
import { maskSecretsInText } from '../health/secrets.js';

export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export const INJECTED = /^<(?:system-reminder|command-|local-command|environment_context|user_instructions|ide_|task-notification)/i;
export const INTERRUPT = /^\[Request interrupted/i;

/** Finite, Date-representable epoch ms or 0 (hostile timestamps must not make toISOString() throw). */
export const toMs = (v) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= 8.64e15 ? n : 0;
};

export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
  return '';
}

/** Text of a tool_result `content` (string or blocks). */
export const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : '')).join('\n') : '');

/** True for harness-injected user text that is not a typed prompt. */
export const isInjected = (t) => INJECTED.test(t) || INTERRUPT.test(t) || /^Caveat:/.test(t) || /^This session is being continued/i.test(t);

/** Mask a bounded prefix, then clip (a secret cut in half could otherwise slip past the masker). */
export const clip = (s, n = 500) => maskSecretsInText(String(s ?? '').slice(0, n + 256).replace(/\s+/g, ' ').trim()).slice(0, n);

/** Anthropic usage block -> { input, output, cacheRead, cacheWrite } */
export function usageOf(u) {
  if (!u || typeof u !== 'object') return null;
  return { input: num(+u.input_tokens), output: num(+u.output_tokens), cacheRead: num(+u.cache_read_input_tokens), cacheWrite: num(+u.cache_creation_input_tokens) };
}

/** Tool name -> { kind: 'builtin'|'mcp'|'skill', server } (MCP tools are named mcp__<server>__<tool>). */
export function toolKind(name) {
  const n = String(name || '');
  if (n.startsWith('mcp__')) { const parts = n.split('__'); return { kind: 'mcp', server: parts[1] || null }; }
  if (n === 'Skill') return { kind: 'skill', server: null };
  return { kind: 'builtin', server: null };
}

/** Short one-line summary of a tool input (command, pattern, path, ...). */
export function summarizeInput(input) {
  if (!input || typeof input !== 'object') return '';
  const pick = input.command ?? input.pattern ?? input.query ?? input.url ?? input.skill ?? input.description ?? input.file_path ?? input.notebook_path ?? input.path ?? input.to ?? '';
  return typeof pick === 'string' ? pick : JSON.stringify(pick);
}

export const editPath = (inp) => (inp && typeof inp === 'object' ? inp.file_path || inp.notebook_path || inp.path : undefined);

/** Local calendar day YYYY-MM-DD. */
export function dayKey(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '1970-01-01';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Project-relative POSIX path, or null when outside the root. */
export function relTo(root, p, base = root) {
  if (typeof p !== 'string' || !p || !root) return null;
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(base || root, p);
  const r = path.relative(path.resolve(root), abs);
  return !r || r.startsWith('..') || path.isAbsolute(r) ? null : r.split(path.sep).join('/');
}

/** Count +/- lines of a structuredPatch ([{ lines: ['+a', '-b', ' c'] }]). */
export function patchLines(sp) {
  let added = 0, removed = 0;
  if (!Array.isArray(sp)) return null;
  for (const h of sp) for (const l of Array.isArray(h?.lines) ? h.lines : []) {
    if (typeof l !== 'string') continue;
    if (l.startsWith('+')) added++;
    else if (l.startsWith('-')) removed++;
  }
  return { added, removed };
}

export const lineCount = (s) => (typeof s === 'string' && s.length ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0);

/** Lines added/removed implied by an edit tool's input (used when no structuredPatch result exists). */
export function inputLines(name, inp) {
  if (!inp || typeof inp !== 'object') return { added: 0, removed: 0 };
  if (name === 'Edit') return { added: lineCount(inp.new_string), removed: lineCount(inp.old_string) };
  if (name === 'MultiEdit' && Array.isArray(inp.edits)) {
    let added = 0, removed = 0;
    for (const e of inp.edits) { added += lineCount(e?.new_string); removed += lineCount(e?.old_string); }
    return { added, removed };
  }
  if (name === 'Write') return { added: lineCount(inp.content), removed: 0 };
  if (name === 'NotebookEdit') return { added: lineCount(inp.new_source), removed: 0 };
  return { added: 0, removed: 0 };
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}
export const median = (sorted) => percentile(sorted, 50);
export const round = (n, d = 4) => { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; };
