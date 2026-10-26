// Aggregations for the usage routes. Input: sessions from load.js; output: the shapes in docs/internal/usage-contract.md.
import { modelFamily } from '../agentcenter/costs.js';
import { dayKey, percentile, median, round, relTo } from './records.js';
import { sessionTitle } from './load.js';

const DAY = 86400000;
const tokSum = (u) => u.input + u.output + u.cacheRead + u.cacheWrite;
const zeroTok = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const addTok = (t, u) => { t.input += u.input; t.output += u.output; t.cacheRead += u.cacheRead; t.cacheWrite += u.cacheWrite; };
const sortNum = (a) => a.slice().sort((x, y) => x - y);
const inR = (r) => (ts) => ts >= r.from && ts <= r.to;
const fmtUsd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const SEV = { high: 0, medium: 1, low: 2 };

/** Active milliseconds of span list clipped to a range. */
export function activeIn(spans, r) {
  let ms = 0;
  for (const [a, b] of spans) { const s = Math.max(a, r.from), e = Math.min(b, r.to); if (e > s) ms += e - s; }
  return ms;
}
const longestSpan = (spans, r) => spans.reduce((m, [a, b]) => Math.max(m, Math.min(b, r.to) - Math.max(a, r.from)), 0);

export const activeInRange = (s, r) => s.lastAt >= r.from && (s.startedAt || s.lastAt) <= r.to;

/** Files a session edited, project-relative when inside the root. */
export function filesOf(s, root, okOnly = true) {
  const out = new Map();
  for (const e of s.edits) {
    if (okOnly && e.ok === false) continue;
    const p = relTo(root, e.path) || e.path;
    out.set(p, (out.get(p) || 0) + 1);
  }
  return out;
}

/** Lines added/removed for a session within a range: cost-state totals when the whole session is inside it, else edit results. */
function linesOf(s, r) {
  const whole = s.startedAt >= r.from && s.lastAt <= r.to;
  if (s.cost && whole) return { added: s.cost.linesAdded, removed: s.cost.linesRemoved, exact: true };
  let added = 0, removed = 0;
  for (const e of s.edits) if (e.ok !== false && e.ts >= r.from && e.ts <= r.to) { added += e.added; removed += e.removed; }
  return { added, removed, exact: false };
}

export function sessionRow(s, root) {
  const tokens = zeroTok();
  const models = new Map();
  for (const m of s.msgs) { addTok(tokens, m.u); if (m.model !== 'unknown') models.set(m.model, (models.get(m.model) || 0) + tokSum(m.u)); }
  const lines = s.cost ? { added: s.cost.linesAdded, removed: s.cost.linesRemoved } : s.edits.reduce((a, e) => (e.ok === false ? a : { added: a.added + e.added, removed: a.removed + e.removed }), { added: 0, removed: 0 });
  return {
    sessionId: s.sessionId, tool: s.tool, title: sessionTitle(s), startedAt: s.startedAt || null, lastAt: s.lastAt || null, branch: s.branch,
    models: [...models].sort((a, b) => b[1] - a[1]).map(([m]) => m), usd: round(s.usd), exact: s.exact, tokens,
    prompts: s.prompts.length, toolCalls: s.tools.length, errors: s.tools.filter((t) => t.err).length, subagents: s.subs.length,
    filesTouched: [...filesOf(s, root).keys()].slice(0, 200), compactions: s.compactions.length,
    linesAdded: lines.added, linesRemoved: lines.removed, activeMs: activeIn(s.spans, { from: 0, to: Infinity }),
    project: s.project, agentName: s.agentName || null,
  };
}

export function coverageOf(sessions, r, load) {
  const inRange = inR(r);
  return {
    sessions: sessions.length,
    exactCostSessions: sessions.filter((s) => s.exact).length,
    durationTurns: sessions.reduce((a, s) => a + s.turns.filter((t) => inRange(t[0])).length, 0),
    transcripts: load.transcripts, totalTranscripts: load.totalTranscripts, partial: load.partial,
  };
}

function daysBetween(r, present) {
  const keys = [...present].sort();
  if (!keys.length) return [];
  let start = r.from > 0 ? r.from : Date.parse(`${keys[0]}T12:00:00`);
  const end = Math.min(r.to, Date.now());
  if (!Number.isFinite(start)) return keys;
  if (end - start > 400 * DAY) start = end - 400 * DAY;
  const out = new Set();
  for (let t = start; t <= end + DAY; t += DAY) { const k = dayKey(Math.min(t, end)); out.add(k); }
  for (const k of keys) out.add(k);
  return [...out].sort();
}

/** Consecutive failures of the same tool (>= 3) in a session. */
export function loopsOf(s) {
  const out = [];
  let run = null;
  const flush = () => { if (run && run.count >= 3) out.push(run); run = null; };
  for (const t of s.tools) {
    if (t.err && run && run.tool === t.name) { run.count++; continue; }
    flush();
    if (t.err) run = { session: s.sessionId, tool: t.name, count: 1, sample: t.sample || '', ts: t.ts };
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

export function summary(sessions, r, opts) {
  const inRange = inR(r);
  const kp = { usd: 0, usdExact: 0, sessions: sessions.length, prompts: 0, toolCalls: 0, toolErrors: 0, linesAdded: 0, linesRemoved: 0,
    tokens: zeroTok(), cacheHitRate: null, cacheSavedUsd: 0, activeMs: 0, medianTurnMs: null, p90TurnMs: null };
  const days = new Map();
  const day = (k) => { if (!days.has(k)) days.set(k, { date: k, usd: 0, tokens: 0, sessions: new Set(), toolCalls: 0, errors: 0 }); return days.get(k); };
  const byModel = new Map(), byBranch = new Map(), byProject = new Map(), byAgent = new Map();
  const turns = [];
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const now = Date.now();
  let todayUsd = 0, last3h = 0;
  for (const s of sessions) {
    let sUsd = 0;
    for (const m of s.msgs) {
      if (m.ts >= startOfToday.getTime()) todayUsd += m.usd;
      if (m.ts >= now - 3 * 3600e3) last3h += m.usd;
      if (!inRange(m.ts)) continue;
      sUsd += m.usd;
      addTok(kp.tokens, m.u);
      kp.cacheSavedUsd += m.saved;
      const d = day(dayKey(m.ts)); d.usd += m.usd; d.tokens += tokSum(m.u); d.sessions.add(s.sessionId);
      const bm = byModel.get(m.model) || { model: m.model, usd: 0, tokens: 0, turns: 0 };
      bm.usd += m.usd; bm.tokens += tokSum(m.u); bm.turns++;
      byModel.set(m.model, bm);
    }
    kp.usd += sUsd;
    if (s.exact) kp.usdExact += sUsd;
    kp.prompts += s.prompts.filter((p) => inRange(p.ts)).length;
    for (const t of s.tools) {
      if (!inRange(t.ts)) continue;
      kp.toolCalls++; if (t.err) kp.toolErrors++;
      const d = day(dayKey(t.ts)); d.toolCalls++; if (t.err) d.errors++; d.sessions.add(s.sessionId);
    }
    const l = linesOf(s, r); kp.linesAdded += l.added; kp.linesRemoved += l.removed;
    kp.activeMs += activeIn(s.spans, r);
    for (const t of s.turns) if (inRange(t[0])) turns.push(t[1]);
    const br = s.branch || '(none)';
    const b = byBranch.get(br) || { branch: br, usd: 0, sessions: 0 }; b.usd += sUsd; b.sessions++; byBranch.set(br, b);
    const pr = s.cwd || s.project || '(unknown)';
    const p = byProject.get(pr) || { project: pr, usd: 0, sessions: 0 }; p.usd += sUsd; p.sessions++; byProject.set(pr, p);
    const a = byAgent.get(s.tool) || { tool: s.tool, usd: 0, sessions: 0 }; a.usd += sUsd; a.sessions++; byAgent.set(s.tool, a);
  }
  const ctxTok = kp.tokens.input + kp.tokens.cacheRead + kp.tokens.cacheWrite;
  kp.cacheHitRate = ctxTok ? round(kp.tokens.cacheRead / ctxTok) : null;
  const st = sortNum(turns);
  kp.medianTurnMs = median(st); kp.p90TurnMs = percentile(st, 90);
  kp.usd = round(kp.usd); kp.usdExact = round(kp.usdExact); kp.cacheSavedUsd = round(kp.cacheSavedUsd);
  const series = daysBetween(r, days.keys()).map((k) => {
    const d = days.get(k);
    return d ? { date: k, usd: round(d.usd), tokens: d.tokens, sessions: d.sessions.size, toolCalls: d.toolCalls, errors: d.errors } : { date: k, usd: 0, tokens: 0, sessions: 0, toolCalls: 0, errors: 0 };
  });
  const byUsd = (m) => [...m.values()].map((x) => ({ ...x, usd: round(x.usd) })).sort((a, b) => b.usd - a.usd);
  const dailyUsd = typeof opts.dailyBudgetUsd === 'number' && opts.dailyBudgetUsd > 0 ? opts.dailyBudgetUsd : null;
  const burn = last3h / 3;
  const hoursLeft = Math.max(0, (startOfToday.getTime() + DAY - now) / 3600e3);
  const budget = { dailyUsd, todayUsd: round(todayUsd), burnPerHourUsd: round(burn), projectedTodayUsd: round(todayUsd + burn * hoursLeft), over: dailyUsd !== null && todayUsd >= dailyUsd };
  return {
    kpis: kp, series, byModel: byUsd(byModel), byBranch: byUsd(byBranch), byProject: opts.scope === 'all' ? byUsd(byProject) : [], byAgent: byUsd(byAgent),
    budget, anomalies: anomalies(sessions, r), tips: tips(sessions, r, kp, byModel),
  };
}

export function anomalies(sessions, r) {
  const inRange = inR(r);
  const out = [];
  // cost spike: session cost vs the median of the previous (up to 10) sessions
  const ordered = sessions.slice().sort((a, b) => a.startedAt - b.startedAt);
  for (let i = 3; i < ordered.length; i++) {
    const s = ordered[i];
    const prev = sortNum(ordered.slice(Math.max(0, i - 10), i).map((x) => x.usd));
    const med = median(prev);
    if (med > 0 && s.usd >= 1 && s.usd >= 3 * med && inRange(s.lastAt)) {
      const x = s.usd / med;
      out.push({ id: `cost-spike:${s.sessionId}`, kind: 'cost-spike', severity: x >= 5 ? 'high' : 'medium', session: s.sessionId, ts: s.startedAt,
        message: `Session cost ${fmtUsd(s.usd)} is ${x.toFixed(1)}x the median of the previous ${prev.length} sessions (${fmtUsd(med)}).` });
    }
  }
  for (const s of sessions) {
    for (const l of loopsOf(s)) {
      if (!inRange(l.ts)) continue;
      out.push({ id: `error-loop:${s.sessionId}:${l.ts}`, kind: 'error-loop', severity: l.count >= 5 ? 'high' : 'medium', session: s.sessionId, ts: l.ts,
        message: `${l.tool} failed ${l.count} times in a row.` });
    }
    const writes = sortNum(s.msgs.map((m) => m.u.cacheWrite).filter((n) => n > 0));
    const med = median(writes);
    let top = null;
    for (const m of s.msgs) if (inRange(m.ts) && m.u.cacheWrite >= 100000 && med && m.u.cacheWrite >= 5 * med && (!top || m.u.cacheWrite > top.u.cacheWrite)) top = m;
    if (top) {
      out.push({ id: `context-jump:${s.sessionId}:${top.ts}`, kind: 'context-jump', severity: 'low', session: s.sessionId, ts: top.ts,
        message: `One turn wrote ${Math.round(top.u.cacheWrite / 1000)}k tokens to the prompt cache (session median ${Math.round(med / 1000)}k): the context grew sharply, e.g. from a large file or tool output.` });
    }
    const den = s.denials.filter((d) => inRange(d[0]));
    if (den.length >= 3) {
      const kinds = [...new Set(den.map((d) => d[1]))].join(', ');
      out.push({ id: `denials:${s.sessionId}`, kind: 'denials', severity: den.length >= 5 ? 'medium' : 'low', session: s.sessionId, ts: den[den.length - 1][0],
        message: `${den.length} tool calls were denied (${kinds}).` });
    }
  }
  const all = [];
  for (const s of sessions) for (const t of s.turns) if (inRange(t[0])) all.push({ s, ts: t[0], ms: t[1] });
  if (all.length >= 10) {
    const p95 = percentile(sortNum(all.map((x) => x.ms)), 95);
    all.filter((x) => x.ms > p95 && x.ms >= 120000).sort((a, b) => b.ms - a.ms).slice(0, 5).forEach((x) => {
      out.push({ id: `slow-turn:${x.s.sessionId}:${x.ts}`, kind: 'slow-turn', severity: 'low', session: x.s.sessionId, ts: x.ts,
        message: `A turn took ${(x.ms / 60000).toFixed(1)} min (95th percentile of turns in range: ${(p95 / 60000).toFixed(1)} min).` });
    });
  }
  return out.sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.ts - a.ts).slice(0, 30);
}

export function tips(sessions, r, kp, byModel) {
  const out = [];
  const t = kp.tokens;
  const ctxTok = t.input + t.cacheRead + t.cacheWrite;
  if (ctxTok > 1e6 && kp.cacheHitRate !== null && kp.cacheHitRate < 0.5) {
    out.push({ id: 'cache-hit', kind: 'cache', message: `Only ${Math.round(kp.cacheHitRate * 100)}% of input tokens were cache reads. Long, stable sessions and fewer edits to CLAUDE.md mid-session keep the prompt cache warm.` });
  }
  if (t.cacheWrite > 0 && t.cacheWrite > t.cacheRead && ctxTok > 1e6) {
    out.push({ id: 'cache-write', kind: 'cache', message: 'More tokens were written to the prompt cache than read from it: many short sessions or frequent context changes pay the cache-write premium without reusing it.' });
  }
  const total = [...byModel.values()].reduce((a, m) => a + m.usd, 0);
  const opus = [...byModel.values()].filter((m) => /opus/.test(modelFamily(m.model))).reduce((a, m) => a + m.usd, 0);
  if (total >= 5 && opus / total >= 0.85) {
    out.push({ id: 'model-mix', kind: 'model', message: `${Math.round((opus / total) * 100)}% of spend is on Opus-class models. Routine edits and searches usually work on a Sonnet-class model (or as subagents) at a fraction of the price.` });
  }
  const comp = sessions.reduce((a, s) => a + s.compactions.filter((x) => x >= r.from && x <= r.to).length, 0);
  if (comp >= 3 && comp / Math.max(1, sessions.length) >= 1) {
    out.push({ id: 'compactions', kind: 'context', message: `${comp} context compactions in ${sessions.length} sessions. Splitting long tasks into separate sessions or subagents keeps context smaller and avoids lossy summaries.` });
  }
  const tools = new Map();
  for (const s of sessions) for (const x of s.tools) if (x.ts >= r.from && x.ts <= r.to) { const a = tools.get(x.name) || { calls: 0, errors: 0 }; a.calls++; if (x.err) a.errors++; tools.set(x.name, a); }
  const bad = [...tools].filter(([, a]) => a.calls >= 10 && a.errors / a.calls >= 0.2).sort((a, b) => b[1].errors - a[1].errors)[0];
  if (bad) out.push({ id: `tool-errors:${bad[0]}`, kind: 'tools', message: `${bad[0]} failed in ${Math.round((bad[1].errors / bad[1].calls) * 100)}% of ${bad[1].calls} calls. A note in CLAUDE.md on how to call it correctly (paths, flags, required setup) usually helps.` });
  const den = sessions.reduce((a, s) => a + s.denials.filter((d) => d[0] >= r.from && d[0] <= r.to).length, 0);
  if (den >= 5) out.push({ id: 'denials', kind: 'tools', message: `${den} tool calls were denied. If these are routine commands, a narrow allow rule in .claude/settings.json saves the round trips.` });
  return out;
}

export function tools(sessions, r, { needsAuth = [] } = {}) {
  const inRange = inR(r);
  const byName = new Map(), servers = new Map(), skills = new Map();
  const hooks = { runs: 0, errors: 0, preventedStops: 0 };
  let interrupts = 0, denials = 0;
  const loops = [];
  for (const s of sessions) {
    for (const t of s.tools) {
      if (!inRange(t.ts)) continue;
      const a = byName.get(t.name) || { name: t.name, kind: t.kind, server: t.server, calls: 0, errors: 0, denied: 0, ms: [], lastAt: 0 };
      a.calls++; if (t.err) a.errors++; if (t.denied) a.denied++;
      if (typeof t.ms === 'number') a.ms.push(t.ms);
      if (t.ts > a.lastAt) a.lastAt = t.ts;
      byName.set(t.name, a);
      if (t.server) { const v = servers.get(t.server) || { server: t.server, calls: 0, errors: 0 }; v.calls++; if (t.err) v.errors++; servers.set(t.server, v); }
      if (t.skill) skills.set(t.skill, (skills.get(t.skill) || 0) + 1);
    }
    for (const h of s.hooks) if (inRange(h[0])) { hooks.runs += h[1]; hooks.errors += h[2]; hooks.preventedStops += h[3]; }
    interrupts += s.interrupts.filter(inRange).length;
    denials += s.denials.filter((d) => inRange(d[0])).length;
    for (const l of loopsOf(s)) if (inRange(l.ts)) loops.push(l);
  }
  const auth = new Set(needsAuth);
  return {
    tools: [...byName.values()].map(({ ms, ...a }) => {
      const sm = sortNum(ms);
      return { ...a, errorRate: a.calls ? round(a.errors / a.calls) : 0, avgMs: sm.length ? Math.round(sm.reduce((x, y) => x + y, 0) / sm.length) : null, p90Ms: percentile(sm, 90), lastAt: a.lastAt || null };
    }).sort((a, b) => b.calls - a.calls),
    mcpServers: [...servers.values()].map((v) => ({ ...v, needsAuth: auth.has(v.server) })).sort((a, b) => b.calls - a.calls),
    skills: [...skills].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls),
    hooks, interrupts, denials,
    loops: loops.sort((a, b) => b.ts - a.ts).slice(0, 100),
  };
}

const normPrompt = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 200);
const slug = (t) => normPrompt(t).split(' ').filter((w) => w.length > 2).slice(0, 3).join('-') || 'prompt';

export function prompts(sessions, r, { q = '', limit = 100, history = [] } = {}) {
  const inRange = inR(r);
  const rows = [];
  const bySession = new Map();
  for (const s of sessions) {
    bySession.set(s.sessionId, s);
    const main = s.main;
    const scale = s.exact && s.estUsd > 0 ? s.cost.usd / s.estUsd : 1;
    const ps = s.prompts;
    const estById = new Map(s.msgs.map((m) => [m.id, m.est]));
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], next = ps[i + 1];
      if (!inRange(p.ts)) continue;
      const end = next ? next.ts : Infinity;
      const tl = main.tools.slice(p.tools, next ? next.tools : undefined);
      let usd = null;
      if (s.tool === 'claude') {
        usd = 0;
        for (const m of main.msgs.slice(p.msgFrom, next ? next.msgFrom : undefined)) usd += (estById.get(m[0]) ?? 0) * scale;
        usd = round(usd);
      }
      const turn = s.turns.find((t) => t[0] >= p.ts && t[0] < end);
      rows.push({ id: `${s.sessionId}:${p.ts}`, ts: p.ts, session: s.sessionId, tool: s.tool, prompt: p.text, length: p.length, pasted: 0,
        outcome: { toolCalls: tl.length, errors: tl.filter((t) => t.err).length, interrupted: s.interrupts.some((x) => x >= p.ts && x < end),
          rework: !!next?.rework, usd, durationMs: turn ? turn[1] : null } });
    }
  }
  // typed-prompt history: pasted-content counts, and prompts of sessions without a transcript
  for (const h of history) {
    if (!inRange(h.ts)) continue;
    const hit = rows.find((x) => x.session === h.sessionId && Math.abs(x.ts - h.ts) < 15000);
    if (hit) { hit.pasted = h.pasted; continue; }
    if (bySession.has(h.sessionId)) continue;
    rows.push({ id: `${h.sessionId || 'history'}:${h.ts}`, ts: h.ts, session: h.sessionId, tool: 'claude', prompt: h.prompt, length: h.length, pasted: h.pasted,
      outcome: { toolCalls: null, errors: null, interrupted: null, rework: null, usd: null, durationMs: null } });
  }
  rows.sort((a, b) => b.ts - a.ts);
  const total = rows.length;
  const stats = {
    total, avgLength: total ? Math.round(rows.reduce((a, x) => a + x.length, 0) / total) : 0,
    interruptedRate: total ? round(rows.filter((x) => x.outcome.interrupted).length / total) : 0,
    reworkRate: total ? round(rows.filter((x) => x.outcome.rework).length / total) : 0,
  };
  const groups = new Map();
  for (const x of rows) {
    const k = normPrompt(x.prompt);
    if (k.length < 8) continue;
    const g = groups.get(k) || { prompt: x.prompt, count: 0, sessions: new Set(), lastAt: 0 };
    g.count++; g.sessions.add(x.session); if (x.ts > g.lastAt) { g.lastAt = x.ts; g.prompt = x.prompt; }
    groups.set(k, g);
  }
  const repeated = [...groups.values()].filter((g) => g.count >= 3 || (g.count >= 2 && g.sessions.size >= 2)).sort((a, b) => b.count - a.count).slice(0, 50)
    .map((g, i) => ({ id: `repeat-${i}`, prompt: g.prompt, count: g.count, sessions: g.sessions.size, lastAt: g.lastAt, suggestion: { kind: g.prompt.length <= 160 ? 'command' : 'skill', name: slug(g.prompt) } }));
  const needle = q.toLowerCase();
  return { stats, prompts: rows.filter((x) => !needle || String(x.prompt).toLowerCase().includes(needle)).slice(0, limit), repeated };
}

export function fleet(sessions, r) {
  const runs = [];
  for (const s of sessions.filter((x) => x.subs.length || x.advisor.calls).sort((a, b) => b.startedAt - a.startedAt).slice(0, 50)) {
    const agg = (agentId) => {
      const ms = s.msgs.filter((m) => (m.agentId || null) === agentId);
      const models = new Map();
      for (const m of ms) models.set(m.model, (models.get(m.model) || 0) + 1);
      return { turns: ms.length, tokens: ms.reduce((a, m) => a + tokSum(m.u), 0), usd: round(ms.reduce((a, m) => a + m.usd, 0)), model: [...models].sort((a, b) => b[1] - a[1])[0]?.[0] || null };
    };
    const main = agg(null);
    const nodes = [{ id: 'main', name: s.agentName || 'main', model: main.model, kind: 'main', turns: main.turns, tokens: main.tokens, usd: main.usd,
      toolCalls: s.main.tools.length, startedAt: s.main.startedAt || null, endedAt: s.main.lastAt || null }];
    const edges = [];
    const ids = new Set(['main']);
    for (const sub of s.subs) {
      const a = agg(sub.agentId);
      const meta = sub.meta || {};
      ids.add(sub.agentId);
      nodes.push({ id: sub.agentId, name: typeof meta.agentType === 'string' ? meta.agentType.slice(0, 60) : 'subagent', title: typeof meta.description === 'string' ? meta.description.slice(0, 200) : '',
        model: a.model || (typeof meta.model === 'string' ? meta.model : null), kind: 'subagent', turns: a.turns, tokens: a.tokens, usd: a.usd,
        toolCalls: sub.d.tools.length, startedAt: sub.d.startedAt || null, endedAt: sub.d.lastAt || null });
    }
    for (const sub of s.subs) {
      const parent = typeof sub.meta?.parentAgentId === 'string' && ids.has(sub.meta.parentAgentId) ? sub.meta.parentAgentId : 'main';
      edges.push({ from: parent, to: sub.agentId, kind: 'spawn' });
    }
    const msgEdges = new Set();
    for (const m of s.messages) if (ids.has(m.to) && m.to !== m.from && ids.has(m.from)) msgEdges.add(`${m.from}>${m.to}`);
    for (const k of msgEdges) { const [from, to] = k.split('>'); edges.push({ from, to, kind: 'message' }); }
    if (s.advisor.calls) {
      nodes.push({ id: 'advisor', name: 'advisor', model: s.advisor.model, kind: 'advisor', turns: s.advisor.calls, tokens: null, usd: null, toolCalls: 0, startedAt: s.advisor.firstTs || null, endedAt: s.advisor.lastAt || null });
      edges.push({ from: 'main', to: 'advisor', kind: 'advice' });
    }
    const top = sessionRow(s, null);
    runs.push({ sessionId: s.sessionId, title: sessionTitle(s), tool: s.tool, startedAt: s.startedAt, usd: round(s.usd), model: top.models[0] || null, nodes, edges });
  }
  return { runs: runs.filter((x) => x.startedAt <= r.to) };
}

export function impact(sessions, r, root) {
  const inRange = inR(r);
  const files = new Map(), churn = new Map();
  let added = 0, removed = 0, exact = sessions.length > 0;
  for (const s of sessions) {
    const l = linesOf(s, r);
    added += l.added; removed += l.removed;
    if (!l.exact && s.edits.length) exact = false;
    for (const e of s.edits) {
      if (e.ok === false || !inRange(e.ts)) continue;
      const p = relTo(root, e.path) || e.path;
      const f = files.get(p) || { path: p, edits: 0, sessions: new Set(), linesAdded: 0, linesRemoved: 0, lastAt: 0, tools: new Set() };
      f.edits++; f.sessions.add(s.sessionId); f.linesAdded += e.added; f.linesRemoved += e.removed; f.tools.add(e.tool);
      if (e.ts > f.lastAt) f.lastAt = e.ts;
      files.set(p, f);
      const k = dayKey(e.ts);
      const c = churn.get(k) || { date: k, added: 0, removed: 0 }; c.added += e.added; c.removed += e.removed; churn.set(k, c);
    }
  }
  return {
    exact, linesAdded: added, linesRemoved: removed,
    files: [...files.values()].map((f) => ({ ...f, sessions: f.sessions.size, tools: [...f.tools] })).sort((a, b) => b.edits - a.edits).slice(0, 500),
    churn: [...churn.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function activity(sessions, r) {
  const inRange = inR(r);
  const heat = new Map();
  const hourly = Array(24).fill(0);
  const weekHour = Array.from({ length: 7 }, () => Array(24).fill(0));
  const turnMs = [];
  let focus = 0, away = 0;
  const rows = [];
  for (const s of sessions) {
    let pc = 0;
    for (const p of s.prompts) {
      if (!inRange(p.ts)) continue;
      pc++;
      const d = new Date(p.ts);
      hourly[d.getHours()]++;
      weekHour[(d.getDay() + 6) % 7][d.getHours()]++;
      const h = heat.get(dayKey(p.ts)) || { date: dayKey(p.ts), sessions: new Set(), prompts: 0, usd: 0 };
      h.prompts++; h.sessions.add(s.sessionId); heat.set(h.date, h);
    }
    for (const m of s.msgs) {
      if (!inRange(m.ts)) continue;
      const h = heat.get(dayKey(m.ts)) || { date: dayKey(m.ts), sessions: new Set(), prompts: 0, usd: 0 };
      h.usd += m.usd; h.sessions.add(s.sessionId); heat.set(h.date, h);
    }
    for (const t of s.turns) if (inRange(t[0])) turnMs.push(t[1]);
    focus = Math.max(focus, longestSpan(s.spans, r));
    away += s.away.filter(inRange).length;
    rows.push({ sessionId: s.sessionId, startedAt: s.startedAt || null, endedAt: s.lastAt || null, activeMs: activeIn(s.spans, r), prompts: pc });
  }
  const st = sortNum(turnMs);
  return {
    heatmap: [...heat.values()].map((h) => ({ date: h.date, sessions: h.sessions.size, prompts: h.prompts, usd: round(h.usd) })).sort((a, b) => a.date.localeCompare(b.date)),
    hourly, weekHour,
    turns: { count: st.length, medianMs: median(st), p90Ms: percentile(st, 90), maxMs: st.length ? st[st.length - 1] : null },
    sessions: rows.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 500),
    focusMs: Math.max(0, focus), awayCount: away,
  };
}
