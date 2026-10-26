// Mock routes for Usage & cost and Sessions (agent B). Synthetic data only.
// mock.js merges these: usageRoutes({ sessions: () => sessions }).
//
// Everything is derived from a seeded PRNG keyed by session id, so repeated
// calls (live refreshes) return identical numbers. `?role=viewer` exercises the
// redacted-prompt path and the admin-only file-version 403.

const H = 3600_000;
const DAY = 24 * H;
const RANGES = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY };

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = typeof seed === 'number' ? seed : hashStr(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickR = (r, arr) => arr[Math.floor(r() * arr.length)];
const intR = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const round2 = (v) => Math.round(v * 100) / 100;
const dkey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const notFound = (msg) => Object.assign(new Error(msg), { status: 404 });
const forbidden = (msg) => Object.assign(new Error(msg), { status: 403 });

// list prices per million tokens (synthetic, for the estimate path)
const PRICE = {
  'claude-opus-4-5': { in: 5, out: 25, cr: 0.5, cw: 6.25 },
  'claude-sonnet-4-5': { in: 3, out: 15, cr: 0.3, cw: 3.75 },
  'claude-haiku-4-5': { in: 1, out: 5, cr: 0.1, cw: 1.25 },
  'gpt-5-codex': { in: 1.25, out: 10, cr: 0.125, cw: 0 },
};
const costOf = (t, model) => {
  const p = PRICE[model] || PRICE['claude-sonnet-4-5'];
  return ((t.input || 0) * p.in + (t.output || 0) * p.out + (t.cacheRead || 0) * p.cr + (t.cacheWrite || 0) * p.cw) / 1e6;
};
const tokSum = (t) => (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);

const BRANCHES = ['feat/checkout-v2', 'feat/checkout-v2', 'main', 'fix/webhook-retries', 'docs/api-refresh', 'chore/release-2.14', 'feat/search-provider'];
const FILES = ['docs/plan.md', 'docs/api.md', 'CLAUDE.md', 'AGENTS.md', 'README.md', 'TODO.md', 'CHANGELOG.md', 'apps/api/CLAUDE.md', 'apps/web/CLAUDE.md',
  'docs/architecture.md', 'docs/design-system.md', 'docs/adr/0003-search.md', 'ROADMAP.md', 'DECISIONS.md', '.claude/agents/reviewer.md', '.claude/skills/release/SKILL.md',
  '.cursor/rules/testing.mdc', 'docs/glossary.md', 'packages/ui/README.md'];
const VERBS = ['Implement', 'Refactor', 'Fix', 'Document', 'Review', 'Add tests for', 'Speed up', 'Clean up', 'Migrate', 'Investigate'];
const SUBJECTS = ['refund flow', 'webhook retries', 'checkout summary', 'search provider ADR', 'rate limiter', 'design tokens', 'release notes', 'session expiry bug',
  'API error codes', 'onboarding docs', 'PaymentIntent tests', 'CI cache', 'feature flags', 'glossary', 'monorepo scripts'];
const PROMPTS = [
  'run the tests and fix any failures',
  'run the tests and fix any failures',
  'commit this with a conventional commit message',
  'commit this with a conventional commit message',
  'update docs/plan.md with what we just did',
  'review the diff before I merge',
  'why is the webhook handler retrying twice?',
  'add a test for the refund edge case where the amount is zero',
  'use pnpm, not npm',
  'make the checkout summary match the design system spacing',
  'explain what this module does and where it is used',
  'split this into smaller functions and keep behaviour identical',
  'check CLAUDE.md for commands that no longer exist',
  'draft release notes for 2.14.0 from the changelog',
  'stop, revert that last change',
  'continue',
  'find all callers of createPaymentIntent and update them to the new signature',
  'write an ADR comparing Typesense and Meilisearch for search',
];
const BUILTIN = [['Read', 30, 60, 0.004], ['Edit', 18, 140, 0.03], ['Bash', 16, 4200, 0.11], ['Grep', 12, 90, 0.01], ['Glob', 6, 45, 0], ['Write', 4, 120, 0.02],
  ['TodoWrite', 5, 15, 0], ['Task', 2, 48000, 0.04], ['WebFetch', 2, 1800, 0.12]];
const MCP = [['mcp__github__create_pull_request', 'github', 1, 2400, 0.06], ['mcp__github__get_issue', 'github', 2, 900, 0.02], ['mcp__linear__get_issue', 'linear', 1, 1100, 0.31],
  ['mcp__playwright__browser_click', 'playwright', 1, 650, 0.08]];
const SKILLS = [['release', 0.6, 3200, 0], ['pdf', 0.3, 5400, 0.1]];
const BASH_SAMPLES = ['pnpm test --filter api', 'pnpm lint', 'git status', 'pnpm build', 'docker compose up -d', 'git diff --stat', 'pnpm codegen'];
const ERR_SAMPLES = ['exit 1: 2 failing tests in payments.test.ts', 'Error: port 5432 already allocated', 'ENOENT: no such file or directory', 'Type error: Property amount does not exist'];

const isViewer = () => {
  try {
    return new URLSearchParams(location.search).get('role') === 'viewer';
  } catch {
    return false;
  }
};
// Strip prompt-like text the way the server's redactPrompts does for viewers.
const PROMPT_KEYS = ['prompt', 'title', 'quote', 'lastPrompt', 'thinking', 'body'];
function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = PROMPT_KEYS.includes(k) && typeof x === 'string' ? '' : redact(x);
  if ((out.kind === 'prompt' || out.kind === 'thinking') && typeof out.text === 'string') out.text = '';
  return out;
}

export function usageRoutes({ sessions }) {
  const T0 = Date.now();
  const SEEDS = () => (sessions?.() || []).slice(0, 4);

  // ---- synthetic sessions over the last 90 days (seed sessions come first)
  const synth = [];
  {
    const r = rng('usage-synth');
    let t = T0 - 3 * H;
    while (synth.length < 64 && t > T0 - 92 * DAY) {
      t -= (0.25 + r() * 1.6) * DAY * (r() < 0.25 ? 1.8 : 0.7);
      const tool = r() < 0.72 ? 'claude' : 'codex';
      const dur = (0.2 + r() * 2.6) * H;
      const startedAt = Math.round(t - dur);
      const id = tool === 'claude'
        ? [8, 4, 4, 4, 12].map((n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('')).join('-')
        : `rollout-${new Date(startedAt).toISOString().slice(0, 19).replace(/:/g, '-')}-${Math.floor(r() * 65536).toString(16).padStart(4, '0')}`;
      const scale = 0.3 + r() * 2.2;
      synth.push({
        tool, sessionId: id, title: `${pickR(r, VERBS)} ${pickR(r, SUBJECTS)}`, startedAt, lastAt: Math.round(t),
        tokens: { input: Math.round(90_000 * scale), output: Math.round(14_000 * scale), cacheRead: Math.round((tool === 'claude' ? 900_000 : 260_000) * scale), cacheWrite: tool === 'claude' ? Math.round(60_000 * scale) : 0 },
        filesTouched: Array.from(new Set(Array.from({ length: intR(r, 1, 5) }, () => pickR(r, FILES)))),
      });
    }
  }

  const rowCache = new Map();
  function row(s) {
    const key = s.sessionId;
    const cached = rowCache.get(key);
    if (cached && cached.lastAt === s.lastAt) return cached;
    const r = rng(key);
    const tool = s.tool === 'codex' ? 'codex' : 'claude';
    const main = tool === 'codex' ? 'gpt-5-codex' : r() < 0.7 ? 'claude-opus-4-5' : 'claude-sonnet-4-5';
    const subagents = tool === 'claude' && r() < 0.45 ? intR(r, 1, 4) : 0;
    const models = subagents ? [main, 'claude-haiku-4-5'] : [main];
    const tokens = s.tokens || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const usd = round2(costOf(tokens, main) * (subagents ? 1.12 : 1));
    const prompts = Math.max(1, Math.round(tokSum(tokens) / 160_000) + intR(r, 1, 6));
    const toolCalls = prompts * intR(r, 3, 9);
    const errors = r() < 0.3 ? intR(r, 2, Math.max(3, Math.round(toolCalls * 0.18))) : intR(r, 0, 2);
    const files = s.filesTouched || [];
    const linesAdded = files.length * intR(r, 6, 90);
    const linesRemoved = Math.round(linesAdded * (0.1 + r() * 0.6));
    const out = {
      sessionId: key, tool, title: s.title || null, startedAt: s.startedAt, lastAt: s.lastAt,
      branch: key.startsWith('1a9e') ? 'chore/release-2.14' : pickR(r, BRANCHES), models, usd,
      exact: tool === 'claude' && r() < 0.75, tokens: { ...tokens }, prompts, toolCalls, errors, subagents, filesTouched: files.slice(),
      compactions: tokSum(tokens) > 2_500_000 ? intR(r, 1, 2) : 0, linesAdded, linesRemoved,
      activeMs: Math.round(Math.max(60_000, (s.lastAt - s.startedAt) * (0.35 + r() * 0.45))),
    };
    rowCache.set(key, out);
    return out;
  }
  const all = () => [...SEEDS(), ...synth].map(row).sort((a, b) => b.lastAt - a.lastAt);

  function win(q) {
    const span = RANGES[q.range] ?? (q.range === 'all' ? null : 30 * DAY);
    const to = Date.now();
    return { from: span == null ? to - 92 * DAY : to - span, to };
  }
  function scoped(q) {
    const { from, to } = win(q);
    const agent = q.tool === 'claude' || q.tool === 'codex' ? q.tool : null;
    return all().filter((s) => s.lastAt >= from && s.startedAt <= to && (!agent || s.tool === agent));
  }
  const coverageOf = (list) => ({ sessions: list.length, exactCostSessions: list.filter((s) => s.exact).length, durationTurns: list.reduce((a, s) => a + s.prompts * 2, 0), transcripts: list.length });
  const envelope = (q, list) => ({ range: win(q), coverage: coverageOf(list), generatedAt: Date.now() });

  // ---- per-session detail (prompts + timeline), cached
  const detailCache = new Map();
  function detail(s) {
    const hit = detailCache.get(s.sessionId);
    if (hit && hit.lastAt === s.lastAt) return hit;
    const r = rng(s.sessionId + ':tl');
    const n = Math.min(s.prompts, 14);
    const span = Math.max(10 * 60_000, s.lastAt - s.startedAt);
    const step = span / n;
    const timeline = [];
    const promptRows = [];
    let id = 0;
    let errorsLeft = s.errors;
    const fileQ = s.filesTouched.slice();
    const agents = [{ agentId: 'main', name: 'main', model: s.models[0], parent: null, startedAt: s.startedAt, endedAt: s.lastAt, turns: s.prompts * 3, tokens: tokSum(s.tokens), usd: s.usd, toolCalls: s.toolCalls }];
    const fileVersions = new Map();
    let subLeft = s.subagents;
    const callsPer = Math.max(1, Math.round(s.toolCalls / n));
    for (let p = 0; p < n; p++) {
      let t = s.startedAt + p * step + r() * step * 0.1;
      const prompt = p === 0 && s.title ? `${s.title.toLowerCase()}, then update the plan` : pickR(r, PROMPTS);
      const pId = `t${++id}`;
      timeline.push({ id: pId, ts: Math.round(t), kind: 'prompt', prompt });
      const pStart = t;
      let calls = 0;
      let errs = 0;
      let interrupted = false;
      t += 2000 + r() * 6000;
      const thinkMs = Math.round(1500 + r() * 22000);
      timeline.push({ id: `t${++id}`, ts: Math.round(t), kind: 'thinking', thinking: 'Plan: read the relevant files first, then make the smallest change and run the tests.', durationMs: thinkMs });
      t += thinkMs;
      const k = Math.max(1, Math.round(callsPer * (0.6 + r() * 0.8)));
      for (let c = 0; c < k && t < pStart + step * 0.92; c++) {
        const tr = r();
        let name;
        let input;
        if (tr < 0.32) { name = 'Read'; input = pickR(r, fileQ.length ? fileQ : FILES); }
        else if (tr < 0.5) { name = 'Grep'; input = pickR(r, ['createPaymentIntent', 'retryPolicy', 'TODO', 'npm run']); }
        else if (tr < 0.78) { name = 'Bash'; input = pickR(r, BASH_SAMPLES); }
        else if (tr < 0.92) { name = 'Edit'; input = pickR(r, fileQ.length ? fileQ : FILES); }
        else {
          name = s.tool === 'claude' ? pickR(r, ['mcp__github__get_issue', 'TodoWrite', 'WebFetch']) : 'Bash';
          input = name === 'WebFetch' ? 'docs.stripe.com/webhooks' : name === 'TodoWrite' ? '4 todos' : name === 'Bash' ? 'git status' : '#142';
        }
        const ms = Math.round(name === 'Bash' ? 800 + r() * 9000 : 40 + r() * 400);
        if (subLeft > 0 && r() < 0.3) {
          const agentId = `agent-${(hashStr(s.sessionId + c + p) % 0xffffff).toString(16)}`;
          const nm = pickR(r, ['Explore', 'code-reviewer', 'test-writer', 'general-purpose']);
          const dur = Math.round(30_000 + r() * 160_000);
          const tk = Math.round(tokSum(s.tokens) * (0.04 + r() * 0.06));
          const sUsd = round2(costOf({ input: tk * 0.3, output: tk * 0.06, cacheRead: tk * 0.64 }, 'claude-haiku-4-5'));
          agents.push({ agentId, name: nm, model: 'claude-haiku-4-5', parent: 'main', startedAt: Math.round(t), endedAt: Math.round(t + dur), turns: intR(r, 4, 22), tokens: tk, usd: sUsd, toolCalls: intR(r, 3, 30) });
          timeline.push({ id: `t${++id}`, ts: Math.round(t), kind: 'subagent', agentId, model: 'claude-haiku-4-5', text: `${nm}: ${pickR(r, ['map the payments module', 'review the diff for regressions', 'write missing tests', 'find stale commands in docs'])}`, durationMs: dur, tokens: tk, usd: sUsd });
          t += dur;
          subLeft--;
          calls++;
          continue;
        }
        if (s.tool === 'claude' && name === 'Bash' && r() < 0.06) {
          timeline.push({ id: `t${++id}`, ts: Math.round(t), kind: 'denied', tool: 'Bash', input: 'git push --force' });
          t += 1500;
          continue;
        }
        timeline.push({ id: `t${++id}`, ts: Math.round(t), kind: 'tool', tool: name, input, durationMs: ms });
        calls++;
        t += ms;
        const isErr = errorsLeft > 0 && (name === 'Bash' ? r() < 0.45 : r() < 0.08);
        if (isErr) { errorsLeft--; errs++; }
        timeline.push({ id: `t${++id}`, ts: Math.round(t), kind: 'result', tool: name, isError: isErr,
          text: isErr ? (name === 'Bash' ? pickR(r, ERR_SAMPLES) : 'File has not been read yet. Read it first before writing to it.') : name === 'Bash' ? 'exit 0' : name === 'Read' ? `${intR(r, 40, 420)} lines` : name === 'Grep' ? `${intR(r, 1, 14)} matches` : 'ok' });
        if (name === 'Edit' && !isErr) {
          const path = input;
          const v = (fileVersions.get(path) || []).length + 1;
          const backup = `${hashStr(s.sessionId + path).toString(16).slice(0, 8)}@v${v}`;
          fileVersions.set(path, [...(fileVersions.get(path) || []), { backup, ts: Math.round(t), messageId: `msg_${id}` }]);
          timeline.push({ id: `t${++id}`, ts: Math.round(t + 30), kind: 'edit', path, tool: 'Edit', text: `+${intR(r, 1, 30)} −${intR(r, 0, 12)}` });
          if (r() < 0.15) timeline.push({ id: `t${++id}`, ts: Math.round(t + 60), kind: 'hook', text: 'PostToolUse: prettier --write' });
        }
        t += 600 + r() * 3000;
      }
      if (p > 1 && r() < 0.08) {
        interrupted = true;
        timeline.push({ id: `t${++id}`, ts: Math.round(t), kind: 'interrupt', text: 'Interrupted by user' });
      } else {
        const tk = Math.round(tokSum(s.tokens) / n);
        timeline.push({ id: `t${++id}`, ts: Math.round(t + 800), kind: 'text', text: pickR(r, ['Done. Tests pass and the plan is updated.', 'Fixed: the retry ran twice because the idempotency key was regenerated.', 'I changed 3 files; summary below.', 'Here is what the module does and where it is used.']), model: s.models[0], tokens: tk, usd: round2(s.usd / n) });
      }
      if (s.compactions && p === Math.floor(n / 2)) timeline.push({ id: `t${++id}`, ts: Math.round(t + 2000), kind: 'compact', text: 'Context compacted (auto)', tokens: Math.round((tokSum(s.tokens) / n) * 2.5) });
      promptRows.push({ id: pId, ts: Math.round(pStart), session: s.sessionId, tool: s.tool, prompt, length: prompt.length,
        outcome: { toolCalls: calls, errors: errs, interrupted, rework: /revert|stop|again|no,/.test(prompt) || (errs > 1 && r() < 0.5), usd: round2(s.usd / n), durationMs: Math.round(t - pStart) } });
    }
    // every touched file has at least one version
    for (const path of s.filesTouched) if (!fileVersions.has(path)) fileVersions.set(path, [{ backup: `${hashStr(s.sessionId + path).toString(16).slice(0, 8)}@v1`, ts: s.lastAt - 60_000, messageId: null }]);
    timeline.sort((a, b) => a.ts - b.ts);
    const d = { lastAt: s.lastAt, timeline, prompts: promptRows, agents, files: [...fileVersions].map(([path, versions]) => ({ path, versions })) };
    detailCache.set(s.sessionId, d);
    return d;
  }

  function fileText(path, seed, v) {
    const r = rng(`${path}:${seed}`);
    const lines = [`# ${path.split('/').pop().replace(/\.\w+$/, '')}`, '', 'Synthetic mock content for the replay diff.', ''];
    for (let i = 0; i < 18; i++) lines.push(`- ${pickR(r, ['Use pnpm, not npm.', 'Run `pnpm test --filter api` before committing.', 'Webhooks retry 5 times with backoff.', 'Never edit generated code.', 'Checkout v2 ships behind a flag.', 'Keep PRs small.'])} (${i + 1})`);
    if (v > 0) {
      lines.splice(5, 1, `- Updated in step ${v}: retry policy is now 6 attempts with jitter.`);
      lines.splice(9, 0, `- Added in step ${v}: document the idempotency key.`);
      if (v > 1) lines.splice(14, 2);
    }
    return lines.join('\n');
  }

  const find = (id) => all().find((s) => s.sessionId === id);
  const viewerize = (o) => (isViewer() ? redact(o) : o);

  // ---- routes
  return {
    '/api/usage/summary': (q) => {
      const list = scoped(q);
      const { from, to } = win(q);
      const sum = (f) => list.reduce((a, s) => a + (f(s) || 0), 0);
      const tokens = { input: sum((s) => s.tokens.input), output: sum((s) => s.tokens.output), cacheRead: sum((s) => s.tokens.cacheRead), cacheWrite: sum((s) => s.tokens.cacheWrite) };
      const usd = round2(sum((s) => s.usd));
      const turnMs = list.flatMap((s) => detail(s).prompts.map((p) => p.outcome.durationMs));
      const days = [];
      for (let d = new Date(from); d.getTime() <= to; d.setDate(d.getDate() + 1)) days.push(dkey(d.getTime()));
      if (days[days.length - 1] !== dkey(to)) days.push(dkey(to));
      const byDay = new Map(days.map((k) => [k, { date: k, usd: 0, tokens: 0, sessions: 0, toolCalls: 0, errors: 0 }]));
      for (const s of list) {
        const b = byDay.get(dkey(s.startedAt)) || byDay.get(days[0]);
        b.usd = round2(b.usd + s.usd); b.tokens += tokSum(s.tokens); b.sessions++; b.toolCalls += s.toolCalls; b.errors += s.errors;
      }
      const group = (keyOf, init) => {
        const m = new Map();
        for (const s of list) {
          for (const [k, part] of keyOf(s)) {
            const g = m.get(k) || { ...init(k), usd: 0, _s: new Set(), _t: 0, _turns: 0 };
            g.usd = round2(g.usd + s.usd * part); g._s.add(s.sessionId); g._t += tokSum(s.tokens) * part; g._turns += s.prompts * 3 * part;
            m.set(k, g);
          }
        }
        return [...m.values()].sort((a, b) => b.usd - a.usd);
      };
      const byModel = group((s) => (s.models.length > 1 ? [[s.models[0], 0.88], [s.models[1], 0.12]] : [[s.models[0], 1]]), (k) => ({ model: k }))
        .map((g) => ({ model: g.model, usd: g.usd, tokens: Math.round(g._t), turns: Math.round(g._turns) }));
      const byBranch = group((s) => [[s.branch || '(none)', 1]], (k) => ({ branch: k })).map((g) => ({ branch: g.branch, usd: g.usd, sessions: g._s.size }));
      const byAgent = group((s) => [[s.tool, 1]], (k) => ({ tool: k })).map((g) => ({ tool: g.tool, usd: g.usd, sessions: g._s.size }));
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const todayUsd = round2(all().filter((s) => s.lastAt >= midnight.getTime()).reduce((a, s) => a + s.usd, 0));
      const hrs = Math.max(1, (Date.now() - midnight.getTime()) / H);
      const burn = round2(todayUsd / hrs);
      const dailyUsd = 25;
      const avg = usd / Math.max(1, list.length);
      const topCost = list.slice().sort((a, b) => b.usd - a.usd)[0];
      const topErr = list.slice().sort((a, b) => b.errors - a.errors)[0];
      const big = list.find((s) => s.compactions > 0);
      const anomalies = [];
      if (topCost && topCost.usd > avg * 1.5) anomalies.push({ id: `a-cost-${topCost.sessionId.slice(0, 6)}`, kind: 'cost-spike', severity: 'high', message: `$${topCost.usd.toFixed(2)} in one session, ${(topCost.usd / Math.max(0.01, avg)).toFixed(1)}x the average`, session: topCost.sessionId, ts: topCost.lastAt });
      if (topErr && topErr.errors >= 3) anomalies.push({ id: `a-loop-${topErr.sessionId.slice(0, 6)}`, kind: 'error-loop', severity: 'medium', message: `Bash failed ${Math.min(topErr.errors, 5)} times in a row ("pnpm test --filter api")`, session: topErr.sessionId, ts: topErr.lastAt - 20 * 60_000 });
      if (big) anomalies.push({ id: `a-ctx-${big.sessionId.slice(0, 6)}`, kind: 'context-jump', severity: 'medium', message: 'Context grew 180k tokens in one turn, then auto-compacted', session: big.sessionId, ts: big.lastAt - H });
      if (list[3]) anomalies.push({ id: `a-slow-${list[3].sessionId.slice(0, 6)}`, kind: 'slow-turn', severity: 'low', message: 'One turn took 14m 20s (p90 is 2m 10s)', session: list[3].sessionId, ts: list[3].lastAt - 30 * 60_000 });
      const den = list.find((s, i) => i > 3 && s.tool === 'claude');
      if (den) anomalies.push({ id: `a-deny-${den.sessionId.slice(0, 6)}`, kind: 'denials', severity: 'low', message: '4 tool calls denied (git push --force)', session: den.sessionId, ts: den.lastAt });
      return viewerize({
        ...envelope(q, list),
        kpis: {
          usd, usdExact: round2(sum((s) => (s.exact ? s.usd : 0))), sessions: list.length, prompts: sum((s) => s.prompts), toolCalls: sum((s) => s.toolCalls), toolErrors: sum((s) => s.errors),
          linesAdded: sum((s) => s.linesAdded), linesRemoved: sum((s) => s.linesRemoved), tokens,
          cacheHitRate: tokSum(tokens) ? tokens.cacheRead / (tokens.input + tokens.cacheRead + tokens.cacheWrite) : null,
          cacheSavedUsd: round2((tokens.cacheRead * 4.1) / 1e6), activeMs: sum((s) => s.activeMs), medianTurnMs: pct(turnMs, 0.5), p90TurnMs: pct(turnMs, 0.9),
        },
        series: [...byDay.values()],
        byModel, byBranch, byProject: q.scope === 'all' ? [{ project: 'acme/commerce', usd, sessions: list.length }] : [], byAgent,
        budget: { dailyUsd, todayUsd, burnPerHourUsd: burn, projectedTodayUsd: round2(todayUsd + burn * Math.max(0, 24 - hrs) * 0.6), over: todayUsd > dailyUsd },
        anomalies,
        tips: [
          { id: 'tip-cache', kind: 'cache', message: 'Cache hit rate drops after long idle gaps: sessions resumed after 5+ minutes re-write the prompt cache. Keep related work in one sitting.' },
          { id: 'tip-model', kind: 'model', message: 'Explore subagents on Haiku cost about a fifth of Opus. 31% of read-only turns ran on Opus.' },
          { id: 'tip-context', kind: 'context', message: 'Some sessions auto-compacted. Splitting long tasks with /clear keeps context and cost lower.' },
          { id: 'tip-tools', kind: 'tools', message: 'Bash errors cluster on `docker compose up`. Add the working invocation to CLAUDE.md.' },
        ],
      });
    },

    '/api/usage/sessions': (q) => {
      const list = scoped(q);
      const needle = String(q.q || '').toLowerCase();
      const out = needle ? list.filter((s) => (s.title || '').toLowerCase().includes(needle) || s.sessionId.includes(needle)) : list;
      return viewerize({ ...envelope(q, out), sessions: out });
    },

    '/api/usage/session': (q) => {
      const s = find(q.id);
      if (!s) throw notFound('session not found');
      const d = detail(s);
      return viewerize({ session: s, timeline: d.timeline, agents: d.agents, files: d.files });
    },

    '/api/usage/file-version': (q) => {
      if (isViewer()) throw forbidden('requires the admin role (diffs are admin-only)');
      const s = find(q.session);
      if (!s) throw notFound('session not found');
      const v = Number(String(q.backup || '').split('@v')[1]) || 1;
      const isNew = q.path === 'TODO.md' && v === 1;
      return { path: q.path, before: isNew ? null : fileText(q.path, s.sessionId, v - 1), after: fileText(q.path, s.sessionId, v), ts: s.lastAt, truncated: false };
    },

    '/api/usage/tools': (q) => {
      const list = scoped(q);
      const total = list.reduce((a, s) => a + s.toolCalls, 0);
      const r = rng(`tools:${q.range}:${q.tool}`);
      const wsum = BUILTIN.reduce((a, b) => a + b[1], 0) + MCP.reduce((a, b) => a + b[2], 0) + SKILLS.reduce((a, b) => a + b[1], 0);
      const mk = (name, kind, server, w, ms, er) => {
        const calls = Math.round((total * w) / wsum);
        const errors = Math.round(calls * er * (0.7 + r() * 0.6));
        return { name, kind, server, calls, errors, errorRate: calls ? errors / calls : 0, denied: name === 'Bash' ? Math.round(calls * 0.02) : name === 'WebFetch' ? Math.min(calls, 1) : 0,
          avgMs: Math.round(ms * (0.8 + r() * 0.4)), p90Ms: Math.round(ms * (2.2 + r())), lastAt: list[0]?.lastAt ?? null };
      };
      const tools = [
        ...BUILTIN.map(([n, w, ms, er]) => mk(n, 'builtin', null, w, ms, er)),
        ...MCP.map(([n, sv, w, ms, er]) => mk(n, 'mcp', sv, w, ms, er)),
        ...SKILLS.map(([n, w, ms, er]) => mk(n, 'skill', null, w, ms, er)),
      ].filter((t) => t.calls > 0).sort((a, b) => b.calls - a.calls);
      const servers = new Map();
      for (const t of tools.filter((x) => x.kind === 'mcp')) {
        const g = servers.get(t.server) || { server: t.server, calls: 0, errors: 0, needsAuth: t.server === 'linear' };
        g.calls += t.calls;
        g.errors += t.errors;
        servers.set(t.server, g);
      }
      const loops = list.filter((s) => s.errors >= 4).slice(0, 6).map((s, i) => ({ session: s.sessionId, tool: i % 3 === 2 ? 'mcp__linear__get_issue' : 'Bash', count: Math.min(s.errors, 3 + (i % 3)), sample: i % 3 === 2 ? 'Error: authentication required (401)' : ERR_SAMPLES[i % 2], ts: s.lastAt - 15 * 60_000 }));
      return { ...envelope(q, list), tools, mcpServers: [...servers.values()], skills: tools.filter((t) => t.kind === 'skill').map((t) => ({ name: t.name, calls: t.calls })),
        hooks: { runs: Math.round(total * 0.06), errors: Math.round(total * 0.002), preventedStops: Math.round(list.length * 0.1) },
        interrupts: Math.round(list.length * 0.4), denials: tools.reduce((a, t) => a + t.denied, 0), loops };
    },

    '/api/usage/prompts': (q) => {
      const list = scoped(q);
      let prompts = list.flatMap((s) => detail(s).prompts).sort((a, b) => b.ts - a.ts);
      const needle = String(q.q || '').toLowerCase();
      if (needle) prompts = prompts.filter((p) => p.prompt.toLowerCase().includes(needle));
      const groups = new Map();
      for (const p of prompts) {
        const k = p.prompt.trim().toLowerCase();
        const g = groups.get(k) || { prompt: p.prompt, count: 0, sessions: new Set(), lastAt: 0 };
        g.count++;
        g.sessions.add(p.session);
        g.lastAt = Math.max(g.lastAt, p.ts);
        groups.set(k, g);
      }
      const STOP = ['the', 'a', 'and', 'any', 'with', 'this', 'we', 'what', 'just', 'did', 'i', 'before', 'for'];
      const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').filter((w) => w && !STOP.includes(w)).slice(0, 3).join('-');
      const repeated = [...groups.values()].filter((g) => g.count >= 3 && g.prompt.length > 10).sort((a, b) => b.count - a.count).slice(0, 8)
        .map((g) => ({ id: `rp-${hashStr(g.prompt).toString(16)}`, prompt: g.prompt, count: g.count, sessions: g.sessions.size, lastAt: g.lastAt, suggestion: { kind: g.prompt.length > 40 ? 'skill' : 'command', name: slug(g.prompt) } }));
      const total = prompts.length;
      const limit = Math.max(1, Math.min(500, Number(q.limit) || 200));
      return viewerize({
        ...envelope(q, list),
        stats: { total, avgLength: total ? Math.round(prompts.reduce((a, p) => a + p.length, 0) / total) : null, interruptedRate: total ? prompts.filter((p) => p.outcome.interrupted).length / total : null, reworkRate: total ? prompts.filter((p) => p.outcome.rework).length / total : null },
        prompts: prompts.slice(0, limit), repeated,
      });
    },

    '/api/usage/fleet': (q) => {
      const list = scoped(q).filter((s) => s.subagents > 0).slice(0, 24);
      const runs = list.map((s) => {
        const d = detail(s);
        const nodes = d.agents.map((a) => ({ id: a.agentId, name: a.agentId === 'main' ? 'main' : a.name, model: a.model, kind: a.agentId === 'main' ? 'main' : 'subagent', turns: a.turns, tokens: a.tokens, usd: a.usd, toolCalls: a.toolCalls, startedAt: a.startedAt, endedAt: a.endedAt }));
        const edges = nodes.filter((n) => n.id !== 'main').map((n) => ({ from: 'main', to: n.id, kind: 'spawn' }));
        if (hashStr(s.sessionId) % 3 === 0) {
          nodes.push({ id: 'advisor', name: 'advisor', model: 'claude-opus-4-5', kind: 'advisor', turns: 2, tokens: Math.round(tokSum(s.tokens) * 0.03), usd: round2(s.usd * 0.06), toolCalls: 0, startedAt: s.startedAt + 60_000, endedAt: s.lastAt });
          edges.push({ from: 'main', to: 'advisor', kind: 'advice' });
        }
        return { sessionId: s.sessionId, title: s.title, tool: s.tool, startedAt: s.startedAt, usd: s.usd, model: s.models[0], nodes, edges };
      }).filter((x) => x.nodes.length > 1);
      return viewerize({ range: win(q), runs });
    },

    '/api/usage/impact': (q) => {
      const list = scoped(q);
      const files = new Map();
      for (const s of list) {
        const n = s.filesTouched.length || 1;
        for (const path of s.filesTouched) {
          const f = files.get(path) || { path, edits: 0, sessions: 0, linesAdded: 0, linesRemoved: 0, lastAt: 0, tools: new Set() };
          f.edits += Math.max(1, Math.round(s.toolCalls / 6 / n));
          f.sessions++;
          f.linesAdded += Math.round(s.linesAdded / n);
          f.linesRemoved += Math.round(s.linesRemoved / n);
          f.lastAt = Math.max(f.lastAt, s.lastAt);
          f.tools.add(s.tool);
          files.set(path, f);
        }
      }
      const { from, to } = win(q);
      const churn = new Map();
      for (let d = new Date(from); d.getTime() <= to; d.setDate(d.getDate() + 1)) churn.set(dkey(d.getTime()), { date: dkey(d.getTime()), added: 0, removed: 0 });
      for (const s of list) {
        const c = churn.get(dkey(s.startedAt));
        if (c) { c.added += s.linesAdded; c.removed += s.linesRemoved; }
      }
      return { range: win(q), coverage: coverageOf(list), exact: list.length > 0 && list.every((s) => s.exact), linesAdded: list.reduce((a, s) => a + s.linesAdded, 0), linesRemoved: list.reduce((a, s) => a + s.linesRemoved, 0),
        files: [...files.values()].map((f) => ({ ...f, tools: [...f.tools] })).sort((a, b) => b.edits - a.edits), churn: [...churn.values()] };
    },
  };
}
