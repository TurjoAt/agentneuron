// "Why did the agent do that?" replay: the context an agent had for a change (context file versions from
// history or git at that time, effective context for the path) and the session's preceding prompts and actions.
import path from 'node:path';
import { contextAt } from '../agentcenter/timetravel.js';
import { sessionTimeline } from '../agentcenter/transcript.js';
import { runGit } from '../git2/run.js';
import { maskSecretsInText } from '../health/secrets.js';
import { projectSessions } from './transcripts.js';
import { quote } from './text.js';

const CTX = /(^|\/)(CLAUDE(\.local)?\.md|AGENTS(\.override)?\.md|GEMINI\.md|\.cursorrules)$|(^|\/)\.cursor\/rules\//;
const MAX_TEXT = 30000;
const DAY = 864e5;

/** Context files at `ts` from git, for files whose local history does not reach back that far. */
async function gitFallback(ctx, ts) {
  const out = new Map();
  const ok = await runGit(ctx.root, ['rev-parse', '--is-inside-work-tree'], { timeout: 5000 });
  if (!ok.ok) return out;
  const cands = [...ctx.store.files.keys()].filter((p) => CTX.test(p)).slice(0, 30);
  await Promise.all(cands.map(async (p) => {
    let hist = [];
    try { hist = ctx.store.history.list(p); } catch { /* none */ }
    if (hist.length && hist[hist.length - 1].ts <= ts) return; // history covers ts
    const r = await runGit(ctx.root, ['log', '-1', '--format=%H%x1f%aI', `--until=${new Date(ts).toISOString()}`, '--', p], { timeout: 8000 });
    if (!r.ok) return;
    const [hash, date] = r.out.trim().split('\x1f');
    if (!hash) {
      const any = await runGit(ctx.root, ['log', '-1', '--format=%H', '--', p], { timeout: 8000 });
      if (any.ok && any.out.trim()) out.set(p, { absent: true }); // tracked, but added after ts
      return;
    }
    if (!/^[0-9a-f]{40}$/.test(hash)) return;
    const show = await runGit(ctx.root, ['show', `${hash}:./${p}`], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 });
    if (show.ok) out.set(p, { content: show.out, source: 'git', commit: hash.slice(0, 12), ts: Date.parse(date) || 0 });
  }));
  return out;
}

/** Recent file changes with an agent attached (persisted events + live store events + transcript edits). */
export async function recentChanges(ctx, limit = 60) {
  const seen = new Set();
  const out = [];
  const add = (p, ts, agent, source) => {
    const k = `${p}@${Math.round(ts / 1000)}`;
    if (!p || !ts || seen.has(k)) return;
    seen.add(k);
    out.push({ path: p, ts, agent, source });
  };
  let evs = [];
  try { evs = ctx.persist?.events?.query?.({ limit: 2000 }) || []; } catch { /* none */ }
  for (const e of [...evs, ...(ctx.store?.events || [])]) if (e.agent && e.type !== 'unlink') add(e.path, e.ts, { tool: e.agent.tool, sessionId: e.agent.sessionId, title: quote(e.agent.title || '', 120) }, 'event');
  for (const s of await projectSessions(ctx, { limit: 30 })) {
    for (const e of s.events) if (e.k === 'edit' && e.inRoot) add(e.path, e.ts, { tool: s.tool, sessionId: s.sessionId, title: quote(s.title || '', 120) }, 'transcript');
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/**
 * opts: { path?, session?, ts?, tool? }. Returns { path, ts, tool, session, context, versions, timeline }.
 */
export async function replay(ctx, { path: p = null, session = null, ts = null, tool = null } = {}) {
  let at = Number(ts) || 0;
  let agent = null;
  if (p && !at) {
    const hit = (await recentChanges(ctx, 500)).find((c) => c.path === p);
    at = hit?.ts || 0;
    if (hit) agent = hit.agent;
    if (!at) { try { at = ctx.store.history.latest(p)?.ts || 0; } catch { /* none */ } }
  }
  if (!at) at = Date.now();
  if (!session && p) {
    try { agent = agent || (await ctx.sessions?.attribute?.(path.join(ctx.root, p), at)); } catch { /* none */ }
    session = agent?.sessionId || null;
  }
  let meta = null;
  if (session) {
    try { meta = (await ctx.sessions.list()).find((s) => s.sessionId === session) || null; } catch { /* none */ }
  }
  const t = tool || meta?.tool || agent?.tool || 'claude';
  const dir = p && p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  const fallback = await gitFallback(ctx, at);
  const c = contextAt(ctx.store, dir, t === 'codex' || t === 'cursor' ? t : 'claude', at, { fallback });
  let text = maskSecretsInText(c.text);
  const truncated = text.length > MAX_TEXT;
  if (truncated) text = text.slice(0, MAX_TEXT);

  // context file versions around the change (and whether the file changed since)
  const from = Math.min(meta?.startedAt || at, at) - 7 * DAY;
  const versions = [];
  const timeline = [];
  for (const link of c.chain) {
    let hist = [];
    try { hist = ctx.store.history.list(link.path); } catch { /* none */ }
    link.changedSince = hist.some((h) => h.ts > at);
    for (const h of hist) {
      if (h.ts < from || h.ts > at) continue;
      versions.push({ path: link.path, id: h.id, ts: h.ts, added: h.added, removed: h.removed });
      timeline.push({ ts: h.ts, kind: 'context-version', path: link.path, text: `${link.path} changed (+${h.added}/−${h.removed})`, id: h.id });
    }
    if (link.version?.source === 'git') timeline.push({ ts: link.version.ts, kind: 'context-version', path: link.path, text: `${link.path} at commit ${link.version.commit}`, commit: link.version.commit });
  }
  let prompts = [];
  if (session) {
    try {
      const tl = (await sessionTimeline(ctx.sessions, session, { root: ctx.root, home: ctx.home })).timeline;
      const before = tl.filter((e) => e.ts && e.ts <= at + 5000);
      prompts = before.filter((e) => e.type === 'prompt').slice(-12);
      for (const e of prompts) timeline.push({ ts: e.ts, kind: 'prompt', text: quote(e.text, 500) });
      for (const e of before.filter((x) => x.type === 'edit' || x.type === 'tool').slice(-15)) timeline.push({ ts: e.ts, kind: e.type === 'edit' ? 'edit' : 'action', tool: e.tool, path: e.path, text: quote(e.text, 300) });
    } catch { /* transcript gone */ }
  }
  if (p) timeline.push({ ts: at, kind: 'change', path: p, text: `${p} changed` });
  timeline.sort((a, b) => a.ts - b.ts);
  return {
    path: p, ts: at, tool: t,
    session: session ? { sessionId: session, tool: meta?.tool || agent?.tool || t, title: quote(meta?.title || agent?.title || '', 200), startedAt: meta?.startedAt || null } : null,
    context: { dir: c.dir, tool: c.tool, tokens: c.tokens, chain: c.chain, text, truncated },
    versions, prompts: prompts.map((e) => ({ ts: e.ts, text: quote(e.text, 500) })), timeline: timeline.slice(-200),
  };
}
