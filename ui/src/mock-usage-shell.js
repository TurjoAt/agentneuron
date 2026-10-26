// Mock routes for Memory & plans, settings audit, activity and the entity panel (agent C). Synthetic data only.
// mock.js merges these: usageShellRoutes({ sessions, files, commits, role }).
// Shapes follow docs/internal/usage-contract.md. Ids reuse the mock sessions, files, commits and tasks so links resolve.

import { NATIVE_TASKS } from './mock-data.js';

const H = 3600_000;
const DAY = 24 * H;
const RANGE_DAYS = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, all: 180 };

/** Small deterministic PRNG so the mock looks the same on every reload. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const ymd = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TOOLS = [
  ['Read', 412], ['Edit', 238], ['Bash', 196], ['Grep', 151], ['Write', 64], ['Glob', 58], ['TodoWrite', 41], ['Task', 17], ['WebFetch', 9], ['mcp__github__create_pull_request', 6],
];
const MODELS = { claude: ['claude-opus-4-5', 'claude-sonnet-4-5'], codex: ['gpt-5-codex'] };

export function usageShellRoutes({ sessions, files, commits = () => [], role = () => 'admin' }) {
  const now = Date.now();
  const S = () => sessions();
  const viewer = () => role() === 'viewer';
  const tasks = () => NATIVE_TASKS(now);
  const sessionRow = (s) => ({ sessionId: s.sessionId, title: viewer() ? null : s.title, ts: s.lastAt });
  const usdOf = (s) => {
    const t = s.tokens || {};
    return Math.round(((t.input || 0) * 3 + (t.output || 0) * 15 + (t.cacheRead || 0) * 0.3 + (t.cacheWrite || 0) * 3.75) / 1e4) / 100;
  };
  const tokOf = (s) => Object.values(s.tokens || {}).reduce((a, b) => a + b, 0);
  const commitsFor = (paths) => commits().filter((c) => (c.files || []).some((f) => paths.includes(f)));
  const commitRow = (c) => ({ hash: c.hash, subject: c.subject, ts: Date.parse(c.date) || null });
  const tasksFor = (paths) => tasks().filter((t) => (t.files || []).some((f) => paths.includes(f)));
  const taskRow = (t) => ({ id: t.id, title: t.title, status: t.status });
  const hashSeed = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const toolsFor = (seed, n = 5) => {
    const r = rng(seed);
    return TOOLS.slice(0, n + 2).map(([name, c]) => ({ name, calls: Math.max(1, Math.round((c / 12) * (0.4 + r()))) })).sort((a, b) => b.calls - a.calls).slice(0, n);
  };
  const filesForSessions = (ss) => {
    const m = new Map();
    for (const s of ss) for (const p of s.filesTouched || []) m.set(p, (m.get(p) || 0) + 1 + (hashSeed(p + s.sessionId) % 4));
    return [...m].map(([path, edits]) => ({ path, edits })).sort((a, b) => b.edits - a.edits);
  };
  const enc = encodeURIComponent;
  const notFound = (kind) => Object.assign(new Error(`${kind} not found`), { status: 404 });
  const empty = () => ({ sessions: [], files: [], commits: [], tasks: [], tools: [] });

  // ---------------------------------------------------------------- entity
  function entity(q) {
    const kind = q.kind;
    const id = String(q.id || '');

    if (kind === 'session') {
      const s = S().find((x) => x.sessionId === id);
      if (!s) throw notFound(kind);
      const paths = s.filesTouched || [];
      return {
        kind, id, title: viewer() ? null : s.title, subtitle: `${s.tool === 'codex' ? 'Codex' : 'Claude Code'} · ${MODELS[s.tool]?.[0] || s.tool}`,
        stats: [
          { label: 'Cost', value: usdOf(s), unit: 'usd' },
          { label: 'Tokens', value: tokOf(s), unit: 'tokens' },
          { label: 'Messages', value: s.messages || 0 },
          { label: 'Duration', value: Math.max(0, (s.lastAt || now) - (s.startedAt || now)), unit: 'ms' },
        ],
        related: { ...empty(), files: filesForSessions([s]), commits: commitsFor(paths).slice(0, 5).map(commitRow), tasks: tasksFor(paths).map(taskRow), tools: toolsFor(hashSeed(id)) },
        links: [
          { label: 'Open replay', href: `#/sessions?id=${enc(id)}` },
          { label: 'Live edits', href: `#/live?session=${enc(`${s.tool}:${id}`)}` },
          { label: 'Usage for this agent', href: `#/usage?tab=overview&tool=${s.tool}` },
        ],
      };
    }
    if (kind === 'file') {
      const f = (files() || []).find((x) => x.path === id);
      const ss = S().filter((s) => (s.filesTouched || []).includes(id));
      if (!f && !ss.length) throw notFound(kind);
      const cs = commitsFor([id]);
      return {
        kind, id, title: id.split('/').pop(), subtitle: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : 'project root',
        stats: [
          { label: 'Sessions', value: ss.length },
          { label: 'Agent edits', value: ss.reduce((a, s) => a + 1 + (hashSeed(id + s.sessionId) % 4), 0) },
          { label: 'Commits', value: cs.length },
          ...(f?.tokens != null ? [{ label: 'Tokens', value: f.tokens, unit: 'tokens' }] : []),
        ],
        related: { ...empty(), sessions: ss.map(sessionRow), commits: cs.slice(0, 6).map(commitRow), tasks: tasksFor([id]).map(taskRow), tools: toolsFor(hashSeed(id), 3) },
        links: [
          { label: 'Open file', href: `#/files?path=${enc(id)}` },
          { label: 'Diff history', href: `#/diff?path=${enc(id)}` },
          { label: 'Show in graph', href: `#/graph?focus=${enc(id)}` },
        ],
      };
    }
    if (kind === 'commit') {
      const c = commits().find((x) => x.hash === id || x.hash.startsWith(id) || x.short === id);
      if (!c) throw notFound(kind);
      const paths = c.files || [];
      const ss = S().filter((s) => (s.filesTouched || []).some((p) => paths.includes(p)));
      return {
        kind, id: c.hash, title: c.subject, subtitle: `${c.short || c.hash.slice(0, 7)} · ${c.author}`,
        stats: [{ label: 'Files', value: paths.length }, { label: 'Sessions', value: ss.length }, { label: 'Committed', value: Date.parse(c.date), unit: 'time' }],
        related: { ...empty(), sessions: ss.map(sessionRow), files: paths.map((p) => ({ path: p, edits: 1 })), tasks: tasksFor(paths).map(taskRow) },
        links: [{ label: 'Open in Git', href: `#/git?tab=history&hash=${c.hash}` }],
      };
    }
    if (kind === 'task') {
      const t = tasks().find((x) => x.id === id);
      if (!t) throw notFound(kind);
      const paths = t.files || [];
      const ss = S().filter((s) => (s.filesTouched || []).some((p) => paths.includes(p)));
      return {
        kind, id, title: t.title, subtitle: `${t.status} · ${t.priority} priority${t.assignee ? ' · ' + t.assignee : ''}`,
        stats: [
          { label: 'Checklist', value: `${(t.checklist || []).filter((c) => c.done).length}/${(t.checklist || []).length}` },
          { label: 'Sessions', value: ss.length },
          { label: 'Cost', value: ss.reduce((a, s) => a + usdOf(s), 0) / 2, unit: 'usd' },
        ],
        related: { ...empty(), sessions: ss.map(sessionRow), files: paths.map((p) => ({ path: p, edits: 1 + (hashSeed(p) % 3) })), commits: commitsFor(paths).slice(0, 4).map(commitRow) },
        links: [{ label: 'Open task', href: `#/tasks?task=${enc(id)}` }, { label: 'Cost by feature', href: '#/insights?tab=costs' }],
      };
    }
    if (kind === 'tool') {
      const base = TOOLS.find(([n]) => n === id);
      const calls = base ? base[1] : 3 + (hashSeed(id) % 20);
      const ss = S().filter((_s, i) => (hashSeed(id) + i) % 3 !== 0);
      const errors = Math.round(calls * (id === 'Bash' ? 0.07 : 0.015));
      return {
        kind, id, title: id, subtitle: id.startsWith('mcp__') ? `MCP · ${id.split('__')[1]}` : 'Built-in tool',
        stats: [{ label: 'Calls', value: calls }, { label: 'Errors', value: errors }, { label: 'Error rate', value: calls ? errors / calls : 0, unit: 'pct' }, { label: 'Avg time', value: 300 + (hashSeed(id) % 2400), unit: 'ms' }],
        related: { ...empty(), sessions: ss.map(sessionRow), files: id === 'Bash' ? [] : filesForSessions(ss).slice(0, 6) },
        links: [{ label: 'Tool analytics', href: `#/usage?tab=tools&tool=${enc(id)}` }],
      };
    }
    if (kind === 'model') {
      const tool = id.startsWith('gpt') ? 'codex' : 'claude';
      const ss = S().filter((s) => s.tool === tool);
      return {
        kind, id, title: id, subtitle: tool === 'codex' ? 'OpenAI · Codex' : 'Anthropic · Claude Code',
        stats: [{ label: 'Cost', value: ss.reduce((a, s) => a + usdOf(s), 0), unit: 'usd' }, { label: 'Tokens', value: ss.reduce((a, s) => a + tokOf(s), 0), unit: 'tokens' }, { label: 'Sessions', value: ss.length }],
        related: { ...empty(), sessions: ss.map(sessionRow), tools: toolsFor(hashSeed(id)) },
        links: [{ label: 'Usage by model', href: `#/usage?tab=overview&model=${enc(id)}` }],
      };
    }
    if (kind === 'agent') {
      const ss = S().filter((s) => s.tool === id);
      if (!ss.length && !['claude', 'codex'].includes(id)) throw notFound(kind);
      return {
        kind, id, title: id === 'codex' ? 'Codex' : id === 'claude' ? 'Claude Code' : id, subtitle: `${ss.length} session${ss.length === 1 ? '' : 's'} in this project`,
        stats: [{ label: 'Cost', value: ss.reduce((a, s) => a + usdOf(s), 0), unit: 'usd' }, { label: 'Tokens', value: ss.reduce((a, s) => a + tokOf(s), 0), unit: 'tokens' }, { label: 'Sessions', value: ss.length }],
        related: { ...empty(), sessions: ss.map(sessionRow), files: filesForSessions(ss).slice(0, 8), tools: toolsFor(hashSeed(id)) },
        links: [{ label: 'Usage for this agent', href: `#/usage?tab=overview&tool=${id}` }, { label: 'Agent config', href: '#/agents' }],
      };
    }
    throw Object.assign(new Error('unknown kind'), { status: 400 });
  }

  // ---------------------------------------------------------------- memory & plans
  function memory() {
    const proj = 'acme-commerce';
    const m = (file, name, type, description, ago, body, links = [], stale = []) => ({ project: proj, file, name, description, type, body: viewer() ? null : body, updatedAt: now - ago * H, links, stale });
    return {
      memory: [
        m('user_role.md', 'user_role', 'user', 'Maja is the tech lead; prefers small PRs and terse reviews.', 30,
          '---\nname: user_role\ntype: user\n---\nMaja leads the checkout team. Prefers **small PRs**, terse review comments and links to the plan.\n\nSee [[feedback_pnpm]] for tooling preferences.', ['feedback_pnpm']),
        m('feedback_pnpm.md', 'feedback_pnpm', 'feedback', 'Use pnpm, never npm. Corrected 5 times in sessions.', 6,
          'Use `pnpm` for every install and script. `npm install` breaks the lockfile.\n\n**Why:** the monorepo uses pnpm workspaces.\n**How to apply:** run `pnpm test --filter api` before commits in apps/api (see [[project_checkout_v2]]).', ['project_checkout_v2'],
          [{ claim: '`pnpm test --filter api`', reason: 'script `test` not found in apps/api/package.json' }]),
        m('project_checkout_v2.md', 'project_checkout_v2', 'project', 'Checkout v2 moves to Stripe PaymentIntent; state machine lives in apps/api/src/payments.', 3,
          '# Checkout v2\n\n- PaymentIntent replaces Charges.\n- State machine: `apps/api/src/payments/machine.ts`.\n- Plan: docs/plan.md\n\nRelated: [[reference_stripe_docs]], [[feedback_generated_code]].', ['reference_stripe_docs', 'feedback_generated_code'],
          [{ claim: 'apps/api/src/payments/machine.ts', reason: 'file does not exist in the repo' }]),
        m('feedback_generated_code.md', 'feedback_generated_code', 'feedback', "Don't edit apps/web/src/generated; run pnpm codegen instead.", 26,
          'Never hand-edit `apps/web/src/generated/`. Regenerate with `pnpm codegen`.\n\nContext: [[project_checkout_v2]].', ['project_checkout_v2']),
        m('reference_stripe_docs.md', 'reference_stripe_docs', 'reference', 'Where the Stripe webhook retry policy is documented.', 72,
          'Webhook retries: docs/api.md, section "Retries". Max 8 attempts with jitter.', []),
        m('reference_release.md', 'reference_release', 'reference', 'Release checklist for 2.x (changelog, tag, publish).', 50,
          '1. Update CHANGELOG.md\n2. Tag `v2.x.y`\n3. Publish\n\nNotes: [[release_notes_draft]]', ['release_notes_draft'],
          [{ claim: '[[release_notes_draft]]', reason: 'linked memory does not exist' }]),
      ],
      plans: [
        { file: 'checkout-v2-rollout.md', title: 'Checkout v2 rollout', updatedAt: now - 2 * H, body: viewer() ? null : '# Checkout v2 rollout\n\n## Steps\n- [x] PaymentIntent module\n- [x] Webhook retries\n- [ ] Feature flag in apps/web\n- [ ] Remove Charges code path\n\n## Risks\nDouble capture on retry; covered by idempotency keys.' },
        { file: 'docs-cleanup.md', title: 'Docs cleanup: stale commands', updatedAt: now - 28 * H, body: viewer() ? null : '# Docs cleanup\n\nFind commands in README.md and docs/ that no longer exist and fix them.\n\n- `npm run dev` → `pnpm dev`\n- remove `make seed`' },
        { file: 'search-provider.md', title: 'Search provider spike', updatedAt: now - 6 * DAY, body: viewer() ? null : '# Search provider\n\nCompare Meilisearch and Typesense. See docs/adr/0003-search.md.' },
      ],
    };
  }

  // ---------------------------------------------------------------- settings audit
  const settings = () => ({
    settings: {
      model: 'claude-opus-4-5', advisorModel: 'claude-opus-4-5', autoMode: true, theme: 'dark',
      hooks: { PreToolUse: 2, PostToolUse: 1, Stop: 1 },
      permissions: { allow: ['Bash(pnpm test:*)', 'Bash(git status)', 'Read(**)', 'Edit(apps/**)'], deny: ['Read(.env*)', 'Bash(rm -rf:*)'], ask: ['Bash(git push:*)'] },
    },
    permissionModes: { auto: 41, plan: 9, default: 63, acceptEdits: 22, bypassPermissions: 3 },
    mcpNeedsAuth: ['linear', 'sentry'],
    findings: [
      { id: 'bypass-used', severity: 'high', title: 'Sessions ran with bypassPermissions', why: '3 turns ran with every permission check disabled. A prompt injection in a fetched page could run any command.', fix: 'Use acceptEdits or auto mode with an allowlist instead of --dangerously-skip-permissions.', location: '~/.claude/settings.json' },
      { id: 'broad-edit', severity: 'medium', title: 'Edit(apps/**) is allowed without asking', why: 'Agents can rewrite any app file, including generated code that the project says not to touch.', fix: 'Deny Edit(apps/web/src/generated/**) in .claude/settings.json.', location: '.claude/settings.json' },
      { id: 'mcp-auth', severity: 'medium', title: '2 MCP servers need authentication', why: 'Calls to linear and sentry fail until you sign in, which shows up as tool errors in sessions.', fix: 'Run /mcp in Claude Code and authenticate linear and sentry, or remove them.', location: '~/.claude/mcp-needs-auth-cache.json' },
      { id: 'env-read', severity: 'low', title: 'Secrets in .env are protected', why: 'Read(.env*) is denied, so agents cannot read local secrets.', fix: 'Nothing to do.', location: '.claude/settings.json' },
      { id: 'hooks', severity: 'info', title: '4 hooks configured', why: 'PreToolUse (2), PostToolUse (1), Stop (1). Hooks run shell commands with your permissions.', fix: 'Review hook commands when you pull changes to .claude/settings.json.', location: '.claude/settings.json' },
    ],
  });

  // ---------------------------------------------------------------- activity
  function activity(q) {
    const days = RANGE_DAYS[q?.range] || 30;
    const r = rng(42);
    const heatmap = [];
    for (let i = days - 1; i >= 0; i--) {
      const t = now - i * DAY;
      const dow = new Date(t).getDay();
      const weekend = dow === 0 || dow === 6;
      const base = weekend ? r() * 1.5 : 1 + r() * 4;
      const n = r() < 0.12 ? 0 : Math.round(base);
      heatmap.push({ date: ymd(t), sessions: n, prompts: n * Math.round(4 + r() * 10), usd: Math.round(n * (0.6 + r() * 2.4) * 100) / 100 });
    }
    const shape = (h) => (h < 7 ? 0.05 : h < 9 ? 0.4 : h < 12 ? 1 : h < 13 ? 0.5 : h < 18 ? 0.9 : h < 22 ? 0.45 : 0.15);
    const weekHour = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => Math.round(shape(h) * (d >= 5 ? 0.3 : 1) * (6 + r() * 10))));
    const hourly = Array.from({ length: 24 }, (_, h) => weekHour.reduce((a, row) => a + row[h], 0));
    const bands = S().map((s) => ({ sessionId: s.sessionId, startedAt: s.startedAt, endedAt: s.lastAt, activeMs: Math.round((s.lastAt - s.startedAt) * 0.62), prompts: Math.max(1, Math.round((s.messages || 10) / 6)) }));
    return {
      range: { from: now - days * DAY, to: now },
      coverage: { sessions: bands.length, exactCostSessions: 3, durationTurns: 214, transcripts: bands.length },
      generatedAt: now,
      heatmap, hourly, weekHour,
      turns: { count: 214, medianMs: 18_400, p90Ms: 96_000, maxMs: 742_000 },
      sessions: bands.sort((a, b) => b.startedAt - a.startedAt),
      focusMs: Math.round(Math.min(days, 30) * 0.9 * H), awayCount: 17,
    };
  }

  return {
    '/api/usage/entity': (q) => entity(q || {}),
    '/api/usage/memory': () => memory(),
    '/api/usage/settings': () => settings(),
    '/api/usage/activity': (q) => activity(q || {}),
  };
}
