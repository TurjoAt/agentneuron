// Session replay: an ordered timeline of one transcript, parsed on demand (not cached in the digest).
import { MAX_TRANSCRIPT_BYTES } from '../agents/sessions.js';
import { codexTimeline } from '../agentcenter/transcript.js';
import { usdOf } from '../agentcenter/costs.js';
import { safeRead } from './guard.js';
import { parseLinesAsync } from './digest.js';
import { WRITE_TOOLS, INTERRUPT, toMs, textOf, resultText, isInjected, clip, usageOf, summarizeInput, editPath, relTo } from './records.js';

const MAX_ROWS = 5000;
// tool results that carry text the user typed (answers, rejection feedback) go under `quote`, which is redacted for viewers
const USER_TEXT = /the user said:|doesn't want to proceed|user (?:has )?answered/i;
const USER_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

/**
 * Claude transcript lines -> timeline rows. opts: { root, pricing, thinkingText (bool), scale (exact/estimate factor) }.
 * Thinking text is only included with `thinkingText`; otherwise thinking rows carry durationMs only.
 */
export function claudeTimeline(lines, { root = null, pricing = {}, thinkingText = false, scale = 1, todos = false } = {}) {
  const out = [];
  const names = new Map(); // tool_use id -> name
  const seenMsg = new Set();
  let n = 0;
  const add = (row) => { if (out.length < MAX_ROWS) out.push({ id: `r${n++}`, ...row }); };
  const rel = (p, cwd) => (typeof p === 'string' ? relTo(root, p, cwd || root) || p : undefined);
  for (const o of lines) {
    const ts = toMs(o.timestamp);
    if (o.type === 'system') {
      if (o.subtype === 'compact_boundary') add({ ts, kind: 'compact', tokens: typeof o.compactMetadata?.preTokens === 'number' ? o.compactMetadata.preTokens : null, text: typeof o.compactMetadata?.trigger === 'string' ? o.compactMetadata.trigger : null });
      else if (o.subtype === 'stop_hook_summary') {
        const errs = Array.isArray(o.hookErrors) ? o.hookErrors.length : 0;
        add({ ts, kind: 'hook', isError: errs > 0, text: `${Number(o.hookCount) || 0} hook(s)${errs ? `, ${errs} error(s)` : ''}${o.preventedContinuation ? ', prevented stop' : ''}` });
      }
      continue;
    }
    if (o.type === 'user') {
      const c = o.message?.content;
      if (Array.isArray(c) && c.some((x) => x && x.type === 'tool_result')) {
        for (const r of c) {
          if (!r || r.type !== 'tool_result') continue;
          const tool = names.get(r.tool_use_id) || null;
          if (typeof o.toolDenialKind === 'string') add({ ts, kind: 'denied', tool, text: o.toolDenialKind.slice(0, 40) });
          else {
            const first = clip(resultText(r.content).split('\n').find((l) => l.trim()) || '', 200);
            const user = USER_TOOLS.has(tool) || USER_TEXT.test(resultText(r.content).slice(0, 4000));
            add({ ts, kind: 'result', tool, isError: r.is_error === true, ...(user ? { quote: first } : { text: first }) });
          }
        }
        continue;
      }
      if (o.isMeta || o.isCompactSummary) continue;
      const t = textOf(c).trim();
      if (!t) continue;
      if (INTERRUPT.test(t)) { add({ ts, kind: 'interrupt' }); continue; }
      if (isInjected(t)) continue;
      add({ ts, kind: 'prompt', prompt: clip(t, 4000) });
      continue;
    }
    if (o.type !== 'assistant') continue;
    const m = o.message || {};
    const model = typeof m.model === 'string' ? m.model : null;
    let meta = {};
    const u = usageOf(m.usage);
    const mid = typeof m.id === 'string' ? m.id : null;
    if (u && model !== '<synthetic>' && (!mid || !seenMsg.has(mid))) {
      if (mid) seenMsg.add(mid);
      meta = { model, tokens: u.input + u.output + u.cacheRead + u.cacheWrite, usd: Math.round(usdOf(u, model, pricing) * scale * 1e6) / 1e6 };
    }
    const agentId = typeof o.agentId === 'string' ? o.agentId : undefined;
    if (o.isApiErrorMessage) { add({ ts, kind: 'error', text: clip(textOf(m.content), 300), ...meta }); continue; }
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (!b || typeof b !== 'object') continue;
      let row = null;
      if (b.type === 'thinking') {
        row = { ts, kind: 'thinking', durationMs: typeof o.thinkingDurationMs === 'number' ? o.thinkingDurationMs : null };
        if (thinkingText && typeof b.thinking === 'string' && b.thinking) row.thinking = clip(b.thinking, 4000);
      } else if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        row = { ts, kind: 'text', text: clip(b.text, 2000) };
      } else if (b.type === 'server_tool_use' && b.name === 'advisor') {
        row = { ts, kind: 'tool', tool: 'advisor' };
      } else if (b.type === 'tool_use' && typeof b.name === 'string') {
        if (typeof b.id === 'string') names.set(b.id, b.name);
        const inp = b.input && typeof b.input === 'object' ? b.input : {};
        if (WRITE_TOOLS.has(b.name)) row = { ts, kind: 'edit', tool: b.name, path: rel(editPath(inp), o.cwd), input: clip(rel(editPath(inp), o.cwd) || '', 300) };
        else if (b.name === 'Agent' || b.name === 'Task') row = { ts, kind: 'subagent', tool: b.name, input: clip(inp.subagent_type || '', 100), title: clip(inp.description || '', 300) };
        else if (USER_TOOLS.has(b.name)) row = { ts, kind: 'tool', tool: b.name, quote: clip(summarizeInput(inp) || JSON.stringify(inp), 300) };
        else if (todos && b.name === 'TodoWrite' && Array.isArray(inp.todos)) {
          // opt-in (agent brief): todo text is agent-written session text, so it sits under `title` (redacted for viewers)
          row = { ts, kind: 'tool', tool: b.name, input: '', todos: inp.todos.slice(0, 50).filter((t) => t && typeof t === 'object')
            .map((t) => ({ title: clip(t.content || t.activeForm || '', 200), status: ['pending', 'in_progress', 'completed'].includes(t.status) ? t.status : 'pending' })) };
        }
        else {
          row = { ts, kind: 'tool', tool: b.name, input: clip(summarizeInput(inp), 300) };
          const fp = inp.file_path || inp.notebook_path;
          if (typeof fp === 'string') row.path = rel(fp, o.cwd);
        }
      }
      if (!row) continue;
      if (agentId) row.agentId = agentId;
      add({ ...row, ...meta });
      meta = {};
    }
    if (meta.model) add({ ts, kind: 'text', text: '', ...meta }); // usage without visible content
  }
  return out;
}

/** Map the Codex timeline (agentcenter) onto replay rows. */
export function codexRows(lines, root) {
  return codexTimeline(lines, root).map((e, i) => (e.type === 'prompt' ? { id: `r${i}`, ts: e.ts, kind: 'prompt', prompt: e.text }
    : e.type === 'edit' ? { id: `r${i}`, ts: e.ts, kind: 'edit', tool: e.tool, path: e.path, input: e.text }
      : { id: `r${i}`, ts: e.ts, kind: 'tool', tool: e.tool, input: e.text }));
}

/** Read + build a timeline for one file. */
export async function readTimeline(file, tool, home, opts) {
  const r = await safeRead(file, home, { tail: MAX_TRANSCRIPT_BYTES });
  if (!r) return [];
  const lines = await parseLinesAsync(r.buf.toString('utf8'), r.st.size > r.buf.length);
  return tool === 'codex' ? codexRows(lines, opts.root) : claudeTimeline(lines, opts);
}
