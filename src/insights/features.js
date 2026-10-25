// Cost by feature: join agent sessions (token cost), git commits/branches and board tasks.
// Each session is assigned to ONE best-matching feature (never split, never counted twice).
import { runGit } from '../git2/run.js';
import { estimateCosts } from '../agentcenter/costs.js';
import { readTranscriptUsageCached } from '../agentcenter/transcript.js';
import { tokens, jaccard, quote } from './text.js';

const RS = '\x1e', US = '\x1f';
const DEFAULT = new Set(['main', 'master', 'develop', 'dev', 'trunk', 'HEAD']);
const HOUR = 36e5;

/** Bounded commit list with files and branch hints. */
export async function readCommits(root, limit = 500) {
  const r = await runGit(root, ['-c', 'core.quotepath=off', 'log', '--all', `-n${limit}`, '--name-only', '--relative', `--format=${RS}%H${US}%aI${US}%D${US}%s${US}%b${US}`], { timeout: 15000 });
  if (!r.ok) return [];
  const out = [];
  for (const chunk of r.out.split(RS)) {
    if (!chunk.trim()) continue;
    const parts = chunk.split(US);
    if (parts.length < 6) continue;
    const [hash, date, refs, subject, body] = parts;
    out.push({ hash, ts: Date.parse(date) || 0, refs: refs.split(',').map((x) => x.trim().replace(/^HEAD -> /, '')).filter(Boolean), subject, body: body.slice(0, 2000), files: parts.slice(5).join(US).split('\n').map((s) => s.trim()).filter(Boolean) });
  }
  return out;
}

/** Commits reachable from a branch but not from the default branch. */
async function branchCommits(root, branches, base) {
  const map = new Map(); // hash -> branch
  for (const b of branches.slice(0, 30)) {
    const r = await runGit(root, ['log', '-n300', '--format=%H', b, '--not', base, '--'], { timeout: 8000 });
    if (r.ok) for (const h of r.out.split('\n').map((s) => s.trim()).filter(Boolean)) if (!map.has(h)) map.set(h, b);
  }
  return map;
}

async function localBranches(root) {
  const r = await runGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { timeout: 5000 });
  const all = r.ok ? r.out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const base = all.find((b) => b === 'main') || all.find((b) => b === 'master') || null;
  return { base, feature: all.filter((b) => !DEFAULT.has(b) && !b.includes('..') && !b.startsWith('-')) };
}

const slugTokens = (s) => tokens(String(s || '').replace(/[/_-]+/g, ' '));
const scopeOf = (subject) => /^\w+\(([\w./-]{1,40})\)!?:/.exec(subject || '')?.[1] || null;
const idIn = (id, text) => id && id.length >= 4 && new RegExp(`(^|[^\\w])#?${id.replace(/[^\w-]/g, '')}([^\\w]|$)`, 'i').test(text);

/**
 * Pure join. input: { sessions: [{sessionId, tool, title, startedAt, lastAt, branch, files, prompts, tokens, usd}],
 * commits: [{hash, ts, subject, body, files, branch}], tasks: [{id, title, files, labels}] }
 */
export function joinFeatures({ sessions = [], commits = [], tasks = [] }) {
  const feats = new Map();
  const feat = (key, init) => { if (!feats.has(key)) feats.set(key, { feature: init.feature, kind: init.kind, taskId: init.taskId || null, branch: init.branch || null, sessions: [], commits: [], files: new Set(), tokens: 0, cost: 0, timeMs: 0, firstAt: 0, lastAt: 0, matchedBy: new Set() }); return feats.get(key); };
  const taskKey = (t) => `task:${t.id}`;
  for (const t of tasks) { const f = feat(taskKey(t), { feature: t.title, kind: 'task', taskId: t.id }); for (const p of t.files || []) f.files.add(p); }

  // commits -> feature: task id in message > branch matches a task title > task files overlap > branch > conventional scope
  for (const c of commits) {
    const msg = `${c.subject}\n${c.body || ''}`;
    let f = null, why = null;
    const byId = tasks.find((t) => idIn(t.id, msg) || idIn(t.id, c.branch || ''));
    if (byId) { f = feats.get(taskKey(byId)); why = 'task id in commit'; }
    if (!f && c.branch) {
      const bt = slugTokens(c.branch);
      const t = tasks.find((x) => jaccard(slugTokens(x.title), bt) >= 0.5);
      if (t) { f = feats.get(taskKey(t)); why = 'branch name ~ task title'; }
    }
    if (!f) {
      const t = tasks.find((x) => (x.files || []).length && c.files.some((p) => x.files.includes(p)));
      if (t) { f = feats.get(taskKey(t)); why = 'files overlap task'; }
    }
    if (!f && c.branch) { f = feat(`branch:${c.branch}`, { feature: c.branch, kind: 'branch', branch: c.branch }); why = 'branch'; }
    if (!f) { const sc = scopeOf(c.subject); if (sc) { f = feat(`scope:${sc}`, { feature: sc, kind: 'scope' }); why = 'commit scope'; } }
    if (!f) continue;
    f.commits.push(c);
    if (c.branch && !f.branch) f.branch = c.branch;
    for (const p of c.files) f.files.add(p);
    f.matchedBy.add(why);
  }

  // sessions -> best feature
  const list = [...feats.values()];
  for (const s of sessions) {
    let best = null, bs = 0, why = null;
    const sf = new Set(s.files || []);
    const text = `${s.title || ''}\n${(s.prompts || []).join('\n')}`;
    for (const f of list) {
      let sc = 0; const w = [];
      if (s.branch && f.branch && s.branch === f.branch) { sc += 10; w.push('session branch'); }
      if (f.taskId && idIn(f.taskId, `${text}\n${s.branch || ''}`)) { sc += 8; w.push('task id in prompt'); }
      if (f.kind === 'task' && jaccard(tokens(f.feature), tokens(s.title || '')) >= 0.5) { sc += 4; w.push('title ~ task'); }
      if (sf.size && f.files.size) {
        let n = 0; for (const p of sf) if (f.files.has(p)) n++;
        if (n) { sc += 5 * (n / sf.size); w.push('files overlap'); }
      }
      if (sc > 0 && f.commits.some((c) => c.ts >= (s.startedAt || 0) - HOUR && c.ts <= (s.lastAt || 0) + 2 * HOUR)) { sc += 2; w.push('commit in session window'); }
      if (sc > bs) { best = f; bs = sc; why = w; }
    }
    if (!best && s.branch && !DEFAULT.has(s.branch)) { best = feat(`branch:${s.branch}`, { feature: s.branch, kind: 'branch', branch: s.branch }); list.push(best); bs = 10; why = ['session branch']; }
    if (!best) { best = feat('unattributed', { feature: 'Unattributed', kind: 'unattributed' }); if (!list.includes(best)) list.push(best); why = []; }
    best.sessions.push({ sessionId: s.sessionId, tool: s.tool, title: quote(s.title || '', 120), usd: s.usd, tokens: s.tokens, score: Math.round(bs * 10) / 10, matchedBy: why });
    best.tokens += s.tokens || 0;
    best.cost += s.usd || 0;
    best.timeMs += Math.max(0, Math.min((s.lastAt || 0) - (s.startedAt || 0), 12 * HOUR));
    for (const p of s.files || []) best.files.add(p);
    for (const m of why || []) best.matchedBy.add(m);
  }
  const rows = [...feats.values()].filter((f) => f.sessions.length || f.commits.length).map((f) => {
    const times = [...f.sessions.map((s) => sessions.find((x) => x.sessionId === s.sessionId)?.startedAt || 0), ...f.commits.map((c) => c.ts)].filter(Boolean);
    return {
      feature: quote(f.feature, 160), kind: f.kind, taskId: f.taskId, branch: f.branch,
      sessions: f.sessions.length, sessionList: f.sessions.slice(0, 20), tokens: f.tokens, cost: Math.round(f.cost * 10000) / 10000,
      commits: f.commits.length, commitList: f.commits.slice(0, 10).map((c) => ({ hash: c.hash.slice(0, 12), ts: c.ts, subject: quote(c.subject, 120) })),
      files: f.files.size, timeMs: f.timeMs, firstAt: times.length ? Math.min(...times) : 0, lastAt: times.length ? Math.max(...times) : 0, matchedBy: [...f.matchedBy].filter(Boolean),
    };
  });
  rows.sort((a, b) => (a.kind === 'unattributed') - (b.kind === 'unattributed') || b.cost - a.cost || b.commits - a.commits);
  const total = rows.reduce((a, r) => ({ tokens: a.tokens + r.tokens, cost: a.cost + r.cost, sessions: a.sessions + r.sessions }), { tokens: 0, cost: 0, sessions: 0 });
  total.cost = Math.round(total.cost * 10000) / 10000;
  return { features: rows, total, currency: 'USD', note: 'Each session is counted once, under its best-matching feature (branch, task id, files, time window). Costs are estimates from token usage and list prices.' };
}

/** Gather sessions (with costs), commits and board tasks for a ctx, then join. */
export async function costsByFeature(ctx, { sessions: parsed = [], tasks = [] } = {}) {
  const usage = new Map();
  for (const s of parsed) { const u = s.file ? readTranscriptUsageCached(s.file, s.tool) : null; if (u) usage.set(s.sessionId, u); }
  const est = estimateCosts(parsed, usage, ctx.config?.pricing || {});
  const usd = new Map(est.sessions.map((r) => [r.sessionId, r]));
  const sessions = parsed.map((s) => {
    const r = usd.get(s.sessionId);
    const tk = r ? r.input + r.output + r.cacheRead + r.cacheWrite : Object.values(s.tokens || {}).reduce((a, b) => a + (+b || 0), 0);
    return { sessionId: s.sessionId, tool: s.tool, title: s.title, startedAt: s.startedAt, lastAt: s.lastAt, branch: s.branch,
      files: [...new Set(s.events.filter((e) => e.k === 'edit' && e.inRoot).map((e) => e.path))],
      prompts: s.events.filter((e) => e.k === 'prompt').slice(0, 20).map((e) => e.text.slice(0, 300)), tokens: tk, usd: r?.usd || 0 };
  });
  let commits = [];
  const ok = await runGit(ctx.root, ['rev-parse', '--is-inside-work-tree'], { timeout: 5000 });
  if (ok.ok) {
    commits = await readCommits(ctx.root);
    const { base, feature } = await localBranches(ctx.root);
    if (base && feature.length) {
      const owner = await branchCommits(ctx.root, feature, base);
      for (const c of commits) c.branch = owner.get(c.hash) || null;
    }
  }
  return joinFeatures({ sessions, commits, tasks: tasks.filter((t) => t && t.id && t.title).map((t) => ({ id: String(t.id), title: t.title, files: t.files || [], labels: t.labels || [] })) });
}
