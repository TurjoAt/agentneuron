// Seed content for the mock backend (realistic monorepo with AI-context files).
// Kept separate from mock.js so the logic stays readable.

export const PROJECT = { root: '/home/dev/acme-commerce', name: 'acme-commerce' };

/** [path, tool, kind, ageMinutes, content] */
/** YYYY-MM-DD n days from today (keeps demo due dates fresh). */
export function dueIn(n) {
  const d = new Date(Date.now() + n * 86400000);
  return d.toISOString().slice(0, 10);
}

export const SEED = [
  ['CLAUDE.md', 'claude', 'context', 3, `# Acme Commerce — guide for Claude Code

@docs/architecture.md
@.claude/rules/style.md

This is a pnpm monorepo: \`apps/web\` (Next.js storefront), \`apps/api\` (Fastify),
\`packages/ui\` (design system). Read [the plan](docs/plan.md) before large changes.

## Commands
- \`pnpm dev\` — start all apps with turbo
- \`pnpm test --filter api\` — API tests (vitest)
- \`pnpm lint --fix\` — eslint + prettier
- \`pnpm db:migrate\` — run drizzle migrations (see \`scripts/seed.ts\`)

## Conventions
- Use TypeScript strict mode everywhere.
- Never commit secrets; read them from \`.env.local\`.
- Prefer server components in \`apps/web\`; client components end in \`.client.tsx\`.
- All money values are integers in minor units (cents).
- Write tests next to the code: \`foo.ts\` → \`foo.test.ts\`.

## Workflow
- [ ] Migrate checkout to the new payments SDK
- [x] Split the API into feature modules
- [ ] Remove the legacy \`/v1/cart\` endpoints

Decisions live in [DECISIONS.md](DECISIONS.md) and [ADRs](docs/adr/0001-postgres.md).
`],
  ['CLAUDE.local.md', 'claude', 'context', 47, `# Local overrides (not committed)

- My dev DB runs on port 5433.
- Skip e2e tests unless I ask; they take ~6 minutes.
- Prefer short answers and show diffs before applying large refactors.
`],
  ['AGENTS.md', 'codex', 'context', 12, `# AGENTS.md

Instructions for Codex and other agents working in this repository.

## Setup
1. \`corepack enable && pnpm install\`
2. Copy \`.env.example\` to \`.env.local\`
3. \`pnpm dev\`

## Rules
- Use TypeScript strict mode everywhere.
- Run \`pnpm lint\` and \`pnpm test\` before proposing a change.
- Keep PRs under 400 changed lines; split otherwise.
- Do not edit generated files in \`packages/ui/dist\`.

## Architecture
See [architecture](docs/architecture.md) and the [API notes](docs/api.md).

## Open items
- [ ] Document the webhook retry policy
- [x] Add codex sandbox notes
`],
  ['apps/api/CLAUDE.md', 'claude', 'context', 22, `# API (Fastify)

@../../docs/api.md

- Routes live in \`src/modules/<feature>/routes.ts\`.
- Validate every request body with zod schemas from \`src/schemas\`.
- Use the \`db\` helper from \`src/db.ts\`; never import \`pg\` directly.
- Errors: throw \`HttpError\`, never return raw 500s.

## TODO
- [ ] Rate-limit \`POST /orders\`
- [ ] Add idempotency keys to payment intents
- [x] Move auth to a plugin
`],
  ['apps/api/AGENTS.md', 'codex', 'context', 140, `# API agent notes

- Tests: \`pnpm --filter api test\`.
- Fixtures live in \`test/fixtures\`; reuse them.
- See [the root guide](../../AGENTS.md).
`],
  ['apps/web/CLAUDE.md', 'claude', 'context', 300, `# Storefront (Next.js)

- App router only. Data fetching in server components.
- Use components from \`packages/ui\` — do not restyle primitives locally.
- Images go through \`next/image\` with explicit sizes.
- See [[design-system]] for tokens.
`],
  ['.claude/agents/reviewer.md', 'claude', 'agent', 95, `---
name: reviewer
description: Reviews diffs for correctness, security and style before commit.
tools: Read, Grep, Glob, Bash
model: opus
---

You are a meticulous code reviewer for Acme Commerce.

1. Read the diff and the touched files.
2. Check against [CLAUDE.md](../../CLAUDE.md) conventions.
3. Flag missing tests, money handled as floats, and unvalidated input.
4. Use the release skill when asked to prepare a release: @../skills/release/SKILL.md
`],
  ['.claude/agents/test-writer.md', 'claude', 'agent', 420, `---
name: test-writer
description: Writes focused vitest tests for new code.
tools: Read, Write, Edit, Bash
---

Write tests next to the code. Prefer table-driven tests. Never mock the database
in API tests — use the transaction fixture from \`test/fixtures/db.ts\`.
`],
  ['.claude/skills/release/SKILL.md', 'claude', 'skill', 1440, `---
name: release
description: Cut a release — bump versions, update CHANGELOG, tag.
---

# Release skill

1. Make sure \`main\` is green.
2. Run \`pnpm changeset version\`.
3. Update [CHANGELOG.md](../../../CHANGELOG.md).
4. Tag \`vX.Y.Z\` and push.
`],
  ['.claude/commands/deploy.md', 'claude', 'command', 2880, `---
description: Deploy the current branch to staging
argument-hint: [app]
---

Deploy $ARGUMENTS to staging:

- Build with \`pnpm build --filter $ARGUMENTS\`
- Run \`./scripts/deploy.sh staging\`
- Post the preview URL in the PR.
`],
  ['.claude/settings.json', 'claude', 'config', 600, `{
  "permissions": {
    "allow": ["Bash(pnpm test:*)", "Bash(pnpm lint:*)", "Read(**)", "Edit(apps/**)"],
    "deny": ["Bash(rm -rf:*)", "Read(.env*)"],
    "ask": ["Bash(git push:*)"]
  },
  "hooks": {
    "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "pnpm lint --fix" }] }]
  }
}
`],
  ['.mcp.json', 'claude', 'config', 900, `{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "••••" } },
    "postgres": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres"] },
    "playwright": { "type": "http", "url": "http://localhost:8931/mcp" }
  }
}
`],
  ['.cursorrules', 'cursor', 'rules', 4300, `You are working on Acme Commerce.

- Use TypeScript strict mode everywhere.
- Use pnpm, never npm or yarn.
- Prefer functional React components.
`],
  ['.cursor/rules/frontend.mdc', 'cursor', 'rules', 260, `---
description: Frontend conventions for apps/web
globs: apps/web/**/*.tsx
alwaysApply: false
---

- Use Tailwind utility classes; no inline styles.
- Every interactive element needs an accessible name.
- See [design system](../../docs/design-system.md).
`],
  ['.cursor/rules/testing.mdc', 'cursor', 'rules', 1800, `---
description: Testing rules
alwaysApply: true
---

- Write tests next to the code: \`foo.ts\` → \`foo.test.ts\`.
- Use vitest; no jest.
`],
  ['.github/copilot-instructions.md', 'copilot', 'rules', 5000, `# Copilot instructions

This repo is a pnpm + turbo monorepo. Follow [AGENTS.md](../AGENTS.md).

- Money values are integers in minor units.
- Prefer \`zod\` for validation.
`],
  ['.github/instructions/api.instructions.md', 'copilot', 'rules', 5100, `---
applyTo: "apps/api/**"
---

- Use Fastify plugins for cross-cutting concerns.
- Throw \`HttpError\` for client errors.
`],
  ['.windsurfrules', 'windsurf', 'rules', 9000, `- Use pnpm.
- Keep functions small and pure where possible.
- Never commit secrets; read them from \`.env.local\`.
`],
  ['GEMINI.md', 'gemini', 'context', 7000, `# Gemini CLI context

Follow [AGENTS.md](AGENTS.md). Use \`pnpm\` for everything.
`],
  ['README.md', 'generic', 'readme', 3000, `# Acme Commerce

Headless commerce monorepo.

| App | Path | Port |
|:----|:-----|----:|
| Storefront | \`apps/web\` | 3000 |
| API | \`apps/api\` | 4000 |
| Admin | \`apps/admin\` | 3100 |

## Getting started

\`\`\`bash
corepack enable
pnpm install
pnpm dev
\`\`\`

Docs: [architecture](docs/architecture.md) · [API](docs/api.md) · [roadmap](ROADMAP.md) · [changelog](CHANGELOG.md)
`],
  ['TODO.md', 'generic', 'todo', 8, `# TODO

## Now
- [/] Fix flaky \`checkout.e2e.ts\` on CI !urgent #ci @maja @due(${dueIn(1)})
  - [x] Reproduce locally with \`--repeat-each 20\`
  - [ ] Stub the 3DS iframe
- [ ] Add Klarna to payment methods !high #payments @jonas @due(${dueIn(6)})
- [x] Upgrade to Next 15 #web
- [ ] Write ADR for search provider #docs @ola @due(${dueIn(3)})

## Later
- [ ] Multi-currency price lists !med #payments @due(${dueIn(24)})
- [ ] Gift cards #payments
- [x] Remove moment.js #web

TODO: audit the cart cookie TTL
`],
  ['ROADMAP.md', 'generic', 'plan', 60 * 24 * 45, `# Roadmap

## Q4
- Checkout v2 with the new payments SDK
- Search on Meilisearch (see [ADR 0003](docs/adr/0003-search.md))
- B2B price lists

## Q1
- Marketplace sellers
- Mobile app (React Native)
`],
  ['DECISIONS.md', 'generic', 'decision', 2000, `# Decision log

## Decision: Use Postgres for everything (2026-03-02)
Status: accepted — see [ADR 0001](docs/adr/0001-postgres.md).

## Decision: Monorepo with pnpm + turbo (2026-04-18)
Status: accepted — see [ADR 0002](docs/adr/0002-monorepo.md).

## Decision: Drop GraphQL gateway (2026-08-11)
Status: accepted. REST + typed client is enough.
`],
  ['docs/adr/0001-postgres.md', 'generic', 'decision', 60 * 24 * 200, `# ADR 0001: Use Postgres

- Status: accepted
- Date: 2026-03-02

## Context
We need transactions, JSON and full-text search without running many services.

## Decision
Use Postgres 16 for all persistent data, accessed via drizzle.

## Consequences
- One backup story.
- Search may outgrow Postgres → revisit (see [ADR 0003](0003-search.md)).
`],
  ['docs/adr/0002-monorepo.md', 'generic', 'decision', 60 * 24 * 150, `# ADR 0002: Monorepo with pnpm + turbo

- Status: accepted
- Date: 2026-04-18

## Decision
Single repository; \`apps/*\` and \`packages/*\`; turbo for task caching.
`],
  ['docs/adr/0003-search.md', 'generic', 'decision', 60 * 24 * 6, `# ADR 0003: Search provider

- Status: proposed
- Date: 2026-10-17

## Options
| Option | Cost | Ops |
|---|---|---|
| Postgres FTS | low | none |
| Meilisearch | low | small |
| Algolia | high | none |

## Decision
_Pending._ Leaning towards Meilisearch.
`],
  ['docs/architecture.md', 'generic', 'doc', 180, `# Architecture

\`\`\`
web (Next.js) ──▶ api (Fastify) ──▶ Postgres
                     │
                     └──▶ payments SDK, Meilisearch
\`\`\`

- The API is split into modules: \`cart\`, \`checkout\`, \`catalog\`, \`orders\`.
- Background jobs run on BullMQ (see [API notes](api.md)).
- Design tokens: [[design-system]].

> [!NOTE]
> The storefront never talks to Postgres directly.
`],
  ['docs/api.md', 'generic', 'doc', 35, `# API notes

## Auth
Bearer tokens issued by \`/auth/token\`. Sessions expire after 30 minutes.

## Webhooks
Retries with exponential backoff, max 8 attempts. See [retry policy](webhooks.md).

## Endpoints
- \`GET /catalog/products\`
- \`POST /cart/items\`
- \`POST /checkout\`
`],
  ['docs/design-system.md', 'generic', 'doc', 60 * 24 * 20, `# Design system

Tokens live in \`packages/ui/src/tokens.ts\`. Use \`<Button>\`, \`<Stack>\`, \`<Text>\`.
`],
  ['docs/plan.md', 'generic', 'plan', 5, `# Checkout v2 plan

## Goals
- Replace the legacy payment flow with the new SDK.
- Cut checkout p95 from 1.8s to under 800ms.

## Steps
- [x] Spike the SDK in a branch #payments
- [x] Map payment states to order states #payments
- [/] Implement \`PaymentIntent\` module in \`apps/api/src/modules/checkout\` !high #api @claude @due(${dueIn(2)})
- [ ] Feature flag \`checkout_v2\` #api @due(${dueIn(4)})
- [ ] Shadow traffic for a week !med #ops @jonas @due(${dueIn(12)})
- [ ] Remove legacy flow !low #api @due(${dueIn(20)})

## Risks
- 3DS challenges on mobile Safari.
- Refund parity with the old provider.
`],
  ['docs/glossary.md', 'generic', 'doc', 60 * 24 * 90, ``],
  ['docs/old-notes.md', 'generic', 'doc', 60 * 24 * 120, `# Old notes

Notes from the 2025 replatforming. Mostly obsolete.
`],
  ['memory/notes.md', 'claude', 'memory', 15, `# Session memory

- User prefers pnpm workspaces filters over cd.
- Staging key used during debugging: ${atob('c2stYW50LWFwaTAz')}-Xq7f${'FAKE'.repeat(4)}0123456789
- The checkout module owns payment state transitions.
`],
  ['CHANGELOG.md', 'generic', 'changelog', 60 * 24 * 3, `# Changelog

## 2.14.0 — 2026-10-20
- Next 15 upgrade
- Faster product listing (-40% TTFB)

## 2.13.2 — 2026-10-02
- Fix cart rounding for SEK
`],
  ['packages/ui/README.md', 'generic', 'readme', 60 * 24 * 30, `# @acme/ui

Design system primitives. See [docs](../../docs/design-system.md).
`],
];

const H = 3600_000;
export function sessions(now) {
  return [
    {
      tool: 'claude', sessionId: '8f2c1a90-3b7e-4d0e-9a41-2f6c5d8e1b07', title: 'Implement PaymentIntent module',
      lastPrompt: 'Wire the PaymentIntent module into checkout routes and update the plan',
      startedAt: now - 2.2 * H, lastAt: now - 40_000, messages: 184,
      tokens: { input: 412_300, output: 58_900, cacheRead: 3_120_000, cacheWrite: 211_000 },
      filesTouched: ['docs/plan.md', 'apps/api/CLAUDE.md', 'CLAUDE.md', 'TODO.md'],
    },
    {
      tool: 'claude', sessionId: 'c41d77e2-90aa-4c1b-8f3e-6a2b9d0e5f11', title: 'Review docs for stale commands',
      lastPrompt: 'Find docs that mention commands that no longer exist',
      startedAt: now - 5.5 * H, lastAt: now - 9 * 60_000, messages: 62,
      tokens: { input: 120_400, output: 14_200, cacheRead: 880_000, cacheWrite: 64_000 },
      filesTouched: ['README.md', 'docs/api.md', 'AGENTS.md'],
    },
    {
      tool: 'codex', sessionId: 'rollout-2026-10-23T08-12-44-1f9e', title: 'Add webhook retry docs',
      lastPrompt: 'Document the webhook retry policy in docs/api.md and AGENTS.md',
      startedAt: now - 1.1 * H, lastAt: now - 2 * 60_000, messages: 41,
      tokens: { input: 98_000, output: 11_700, cacheRead: 240_000, cacheWrite: 0 },
      filesTouched: ['AGENTS.md', 'docs/api.md'],
    },
    {
      tool: 'claude', sessionId: '1a9e0b33-7c55-4e8f-b2d1-0c3f4e5a6b78', title: 'Release 2.14.0',
      lastPrompt: 'Cut the 2.14.0 release',
      startedAt: now - 52 * H, lastAt: now - 50 * H, messages: 37,
      tokens: { input: 64_000, output: 7_900, cacheRead: 310_000, cacheWrite: 22_000 },
      filesTouched: ['CHANGELOG.md'],
    },
  ];
}

export function gitInfo(now) {
  const c = (h, author, minsAgo, subject, files) => ({
    hash: h.padEnd(40, '0'), short: h.slice(0, 7), author, date: new Date(now - minsAgo * 60_000).toISOString(), subject, files,
  });
  return {
    branch: 'feat/checkout-v2', head: 'e3b9a1c', ahead: 2, behind: 0,
    remote: 'origin → github.com/acme/commerce', dirty: 4,
    recent: [
      c('e3b9a1c7d2', 'Maja Lind', 38, 'docs: update checkout v2 plan', ['docs/plan.md']),
      c('9a0f44be12', 'Claude', 95, 'chore(agents): add reviewer agent', ['.claude/agents/reviewer.md', 'CLAUDE.md']),
      c('77c1d0e9aa', 'Jonas Ek', 190, 'docs(api): webhook retries', ['docs/api.md', 'AGENTS.md']),
      c('5be2a8f031', 'Maja Lind', 60 * 26, 'release: 2.14.0', ['CHANGELOG.md']),
      c('31aa0c9d7e', 'Codex', 60 * 30, 'docs: codex sandbox notes in AGENTS.md', ['AGENTS.md']),
      c('0c9d7e31aa', 'Jonas Ek', 60 * 50, 'adr: propose search provider', ['docs/adr/0003-search.md', 'ROADMAP.md']),
      c('d7e31aa0c9', 'Maja Lind', 60 * 120, 'cursor: testing rules always apply', ['.cursor/rules/testing.mdc']),
      c('a0c9d7e31b', 'Ola Berg', 60 * 300, 'docs: architecture overview', ['docs/architecture.md', 'README.md']),
    ],
  };
}

export const AGENT_CONFIG = {
  mcpServers: [
    { name: 'github', source: '.mcp.json', command: 'npx -y @modelcontextprotocol/server-github', type: 'stdio' },
    { name: 'postgres', source: '.mcp.json', command: 'npx -y @modelcontextprotocol/server-postgres', type: 'stdio' },
    { name: 'playwright', source: '.mcp.json', url: 'http://localhost:8931/mcp', type: 'http' },
    { name: 'linear', source: '.cursor/mcp.json', url: 'https://mcp.linear.app/sse', type: 'sse' },
    { name: 'docs', source: '.codex/config.toml', command: 'node tools/docs-mcp.js', type: 'stdio' },
  ],
  hooks: [
    { event: 'PostToolUse', matcher: 'Edit|Write', command: 'pnpm lint --fix', source: '.claude/settings.json' },
    { event: 'PreToolUse', matcher: 'Bash', command: './scripts/guard.sh', source: '.claude/settings.local.json' },
    { event: 'Stop', command: 'say "Claude is done"', source: '.claude/settings.local.json' },
  ],
  permissions: {
    allow: ['Bash(pnpm test:*)', 'Bash(pnpm lint:*)', 'Read(**)', 'Edit(apps/**)'],
    deny: ['Bash(rm -rf:*)', 'Read(.env*)'],
    ask: ['Bash(git push:*)'],
    source: '.claude/settings.json',
  },
  settingsFiles: ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json', '.cursor/mcp.json', '.codex/config.toml'],
};

/** Lines the fake agents "write" during the live demo. */
export const EDIT_LINES = [
  '- [ ] Verify 3DS challenge flow on iOS 18',
  '- Use `HttpError` for all 4xx responses.',
  '- [x] Add PaymentIntent state machine',
  '- [ ] Backfill order.payment_provider column',
  'Note: webhooks are retried up to 8 times with jitter.',
  '- Prefer `satisfies` over type assertions.',
  '- [ ] Load test checkout with k6 (500 rps)',
  '- Keep server actions in `app/(shop)/actions.ts`.',
  '- [ ] Update [the plan](docs/plan.md) after shadow traffic',
  'See @docs/api.md for the endpoint list.',
];

// ---------------------------------------------------------------- v0.2 seeds

/**
 * Commit graph seed, newest first: [key, parents, author, minutesAgo, subject, files, refs]
 * Lanes: main, feat/checkout-v2 (HEAD), feat/search (open), fix/webhook-retries (merged).
 */
export const GIT_SEED = [
  ['h1', ['h2'], 'Maja Lind', 38, 'docs: update checkout v2 plan', ['docs/plan.md'], ['HEAD -> feat/checkout-v2']],
  ['h2', ['h3'], 'Claude', 95, 'chore(agents): add reviewer agent', ['.claude/agents/reviewer.md', 'CLAUDE.md'], ['origin/feat/checkout-v2']],
  ['s1', ['s2'], 'Ola Berg', 140, 'feat(search): meilisearch adapter skeleton', ['docs/adr/0003-search.md'], ['feat/search']],
  ['h3', ['m1', 'w2'], 'Jonas Ek', 190, "Merge branch 'fix/webhook-retries' into feat/checkout-v2", ['docs/api.md', 'AGENTS.md'], []],
  ['w2', ['w1'], 'Codex', 210, 'docs(api): webhook retries with jitter', ['docs/api.md'], ['fix/webhook-retries']],
  ['s2', ['m3'], 'Ola Berg', 600, 'adr: draft search provider comparison', ['docs/adr/0003-search.md', 'ROADMAP.md'], []],
  ['w1', ['m2'], 'Codex', 720, 'docs(agents): retry policy in AGENTS.md', ['AGENTS.md'], []],
  ['m1', ['m2'], 'Claude', 60 * 18, 'feat(checkout): PaymentIntent state machine notes', ['docs/plan.md', 'apps/api/CLAUDE.md'], []],
  ['m2', ['m3'], 'Maja Lind', 60 * 26, 'release: 2.14.0', ['CHANGELOG.md'], ['tag: v2.14.0', 'origin/main', 'main']],
  ['m3', ['m4'], 'Codex', 60 * 30, 'docs: codex sandbox notes in AGENTS.md', ['AGENTS.md'], []],
  ['m4', ['m5', 'r2'], 'Jonas Ek', 60 * 44, "Merge pull request #212 from acme/feat/rules-cleanup", ['.cursorrules', '.windsurfrules'], []],
  ['r2', ['r1'], 'Maja Lind', 60 * 47, 'rules: dedupe strict-mode rule across tools', ['.cursorrules', '.windsurfrules'], []],
  ['m5', ['m6'], 'Jonas Ek', 60 * 50, 'adr: propose search provider', ['docs/adr/0003-search.md', 'ROADMAP.md'], []],
  ['r1', ['m6'], 'Maja Lind', 60 * 52, 'rules: move frontend rules to .cursor/rules', ['.cursor/rules/frontend.mdc'], []],
  ['m6', ['m7'], 'Maja Lind', 60 * 120, 'cursor: testing rules always apply', ['.cursor/rules/testing.mdc'], ['tag: v2.13.1']],
  ['m7', ['m8'], 'Ola Berg', 60 * 300, 'docs: architecture overview', ['docs/architecture.md', 'README.md'], []],
  ['m8', ['m9'], 'Claude', 60 * 410, 'chore(claude): release skill + deploy command', ['.claude/skills/release/SKILL.md', '.claude/commands/deploy.md'], []],
  ['m9', ['m10'], 'Maja Lind', 60 * 500, 'docs: design system tokens', ['docs/design-system.md'], ['tag: v2.13.0']],
  ['m10', ['m11'], 'Jonas Ek', 60 * 720, 'chore: mcp servers for github + postgres', ['.mcp.json'], []],
  ['m11', ['m12'], 'Ola Berg', 60 * 900, 'docs: copilot instructions for api', ['.github/instructions/api.instructions.md', '.github/copilot-instructions.md'], []],
  ['m12', ['m13'], 'Maja Lind', 60 * 1300, 'adr: monorepo with pnpm + turbo', ['docs/adr/0002-monorepo.md', 'DECISIONS.md'], []],
  ['m13', [], 'Maja Lind', 60 * 2900, 'Initial commit', ['README.md', 'CLAUDE.md', 'docs/adr/0001-postgres.md'], ['tag: v2.0.0']],
];

export const NATIVE_TASKS = (now) => [
  {
    id: 'n-onboard', title: 'Onboard Codex to the monorepo', description: 'Make sure **AGENTS.md** covers the same ground as `CLAUDE.md`.\n\n- sandbox notes\n- test commands\n\nSee [the plan](docs/plan.md).',
    status: 'backlog', priority: 'med', labels: ['agents', 'docs'], due: null, assignee: 'ola', files: ['AGENTS.md', 'CLAUDE.md'],
    checklist: [{ text: 'Diff AGENTS.md vs CLAUDE.md', done: true }, { text: 'Add sandbox section', done: false }, { text: 'Ask Codex to self-review', done: false }],
    comments: [{ id: 'c1', ts: now - 3 * 3600_000, author: 'admin', text: 'Sync view in Agents shows 64% similarity — worth a pass.' }],
    createdAt: now - 4 * 86400_000, updatedAt: now - 3 * 3600_000,
  },
  {
    id: 'n-secrets', title: 'Rotate leaked Anthropic key in memory/notes.md', description: 'Health flagged a key in `memory/notes.md`. Rotate it, then replace with `${ANTHROPIC_API_KEY}`.',
    status: 'review', priority: 'urgent', labels: ['security'], due: null, assignee: 'maja', files: ['memory/notes.md'],
    checklist: [{ text: 'Rotate key in console', done: true }, { text: 'Apply Health quick fix', done: false }],
    comments: [], createdAt: now - 26 * 3600_000, updatedAt: now - 2 * 3600_000,
  },
  {
    id: 'n-metrics', title: 'Weekly context-budget report', description: 'Export Reports → Markdown every Monday and attach to the eng sync notes.',
    status: 'todo', priority: 'low', labels: ['ops'], due: null, assignee: null, files: [],
    checklist: [], comments: [], createdAt: now - 9 * 86400_000, updatedAt: now - 9 * 86400_000,
  },
  {
    id: 'n-glossary', title: 'Fill docs/glossary.md or delete it', description: '',
    status: 'backlog', priority: 'none', labels: ['docs'], due: null, assignee: null, files: ['docs/glossary.md'],
    checklist: [], comments: [], createdAt: now - 12 * 86400_000, updatedAt: now - 12 * 86400_000,
  },
];

const S = (label, extra = {}) => ({ type: 'string', label, ...extra });
const PATHS = { type: 'string[]', required: true, label: 'Paths' };
const MANAGER = { type: 'enum', enum: ['pnpm', 'npm', 'composer'], required: true, label: 'Manager', default: 'pnpm' };

/** Mock action registry (mirrors the server registry shapes). */
export const MOCK_ACTIONS = [
  { id: 'ship.verify.run', title: 'Run checks', category: 'ship', level: 'exec', description: 'Run the detected test, build, lint and typecheck commands and record the results.', params: { checks: { type: 'string[]', label: 'Checks' } } },
  { id: 'ship.criterion.set', title: 'Set criterion status', category: 'ship', level: 'state', description: 'Override the status of one acceptance criterion.', params: { task: { type: 'string' }, criterion: { type: 'string' }, status: { type: 'enum', enum: ['auto', 'verified', 'incomplete', 'untested', 'failed'] }, note: { type: 'text', default: '' } } },
  { id: 'agentneuron.rescan', title: 'Rescan project', category: 'agentneuron', level: 'state', description: 'Re-index every tracked file and recompute the graph and health.', params: {} },
  { id: 'agentneuron.snapshot', title: 'Record metrics snapshot', category: 'agentneuron', level: 'state', description: 'Append a metrics snapshot to .agentneuron/metrics.jsonl.', params: {} },
  { id: 'agentneuron.history.clear', title: 'Clear file history', category: 'agentneuron', level: 'danger', description: 'Delete all local version snapshots in .agentneuron/history.', params: {} },
  { id: 'agentneuron.terminal', title: 'Run command', category: 'agentneuron', level: 'danger', flag: 'terminal', description: 'Run a command line (split into argv, no shell).', params: { command: S('Command line', { required: true }) } },
  { id: 'files.create', title: 'Create file', category: 'files', level: 'edit', description: 'Create a new file (refuses to overwrite).', params: { path: { type: 'path', required: true, label: 'Path' }, content: { type: 'text', label: 'Content' } } },
  { id: 'files.rename', title: 'Rename / move file', category: 'files', level: 'edit', description: 'Rename a file and rewrite every link to it.', params: { from: { type: 'path', required: true, label: 'From' }, to: { type: 'path', required: true, label: 'To' }, rewriteLinks: { type: 'boolean', default: true, label: 'Rewrite links' } } },
  { id: 'files.delete', title: 'Delete file (to trash)', category: 'files', level: 'edit', description: 'Move a file to .agentneuron/trash (restorable).', params: { path: { type: 'path', required: true, label: 'Path' } } },
  { id: 'files.replace', title: 'Find and replace', category: 'files', level: 'edit', description: 'Replace text across tracked files.', params: { q: S('Find', { required: true }), replace: S('Replace with'), regex: { type: 'boolean', default: false } } },
  { id: 'git.stage', title: 'Stage files', category: 'git', level: 'edit', description: 'git add the given paths', params: { paths: PATHS } },
  { id: 'git.unstage', title: 'Unstage files', category: 'git', level: 'edit', description: 'Remove paths from the index', params: { paths: PATHS } },
  { id: 'git.commit', title: 'Commit', category: 'git', level: 'edit', description: 'Commit staged changes', params: { message: { type: 'text', label: 'Message' }, amend: { type: 'boolean', default: false } } },
  { id: 'git.branch.create', title: 'Create branch', category: 'git', level: 'edit', description: 'Create a branch (optionally from a ref) and switch to it', params: { name: S('Branch name', { required: true, pattern: '^[\\w./-]+$' }), from: S('Start point') } },
  { id: 'git.branch.switch', title: 'Switch branch', category: 'git', level: 'edit', description: 'Switch to an existing branch', params: { name: S('Branch', { required: true }) } },
  { id: 'git.stash.push', title: 'Stash changes', category: 'git', level: 'edit', description: 'Stash working changes', params: { message: S('Message') } },
  { id: 'git.stash.pop', title: 'Pop stash', category: 'git', level: 'edit', description: 'Apply and drop a stash entry', params: { index: { type: 'number', default: 0, label: 'Index' } } },
  { id: 'git.tag.create', title: 'Create tag', category: 'git', level: 'edit', description: 'Create a (annotated) tag at HEAD', params: { name: S('Tag', { required: true }), message: S('Message') } },
  { id: 'git.changelog.write', title: 'Write changelog', category: 'git', level: 'edit', description: 'Prepend a conventional-commits changelog section to CHANGELOG.md', params: { from: S('From ref'), to: S('To ref') } },
  { id: 'git.fetch', title: 'Fetch', category: 'git', level: 'exec', description: 'Fetch from a remote (default: all)', params: { remote: S('Remote') } },
  { id: 'git.pull', title: 'Pull', category: 'git', level: 'exec', description: 'Pull (fast-forward only)', params: {} },
  { id: 'git.push', title: 'Push', category: 'git', level: 'exec', description: 'Push the current branch', params: { setUpstream: { type: 'boolean', default: false, label: 'Set upstream (origin)' } } },
  { id: 'git.discard', title: 'Discard changes', category: 'git', level: 'danger', description: 'Discard unstaged changes and delete untracked files at the given paths', params: { paths: PATHS } },
  { id: 'git.branch.delete', title: 'Delete branch', category: 'git', level: 'danger', description: 'Delete a local branch', params: { name: S('Branch', { required: true }), force: { type: 'boolean', default: false } } },
  { id: 'git.stash.drop', title: 'Drop stash', category: 'git', level: 'danger', description: 'Delete a stash entry', params: { index: { type: 'number', required: true, label: 'Index' } } },
  { id: 'packages.install', title: 'Install dependencies', category: 'packages', level: 'exec', description: 'Install all dependencies from the lockfile.', params: { manager: MANAGER } },
  { id: 'packages.add', title: 'Add package', category: 'packages', level: 'exec', description: 'Add a dependency.', params: { manager: MANAGER, name: S('Package', { required: true, pattern: '^(@[a-z0-9][\\w.-]*\\/)?[a-z0-9][\\w.-]*$' }), version: S('Version'), dev: { type: 'boolean', default: false, label: 'Dev dependency' } } },
  { id: 'packages.remove', title: 'Remove package', category: 'packages', level: 'exec', description: 'Remove a dependency.', params: { manager: MANAGER, name: S('Package', { required: true }) } },
  { id: 'packages.update', title: 'Update packages', category: 'packages', level: 'exec', description: 'Update one or all dependencies.', params: { manager: MANAGER, name: S('Package') } },
  { id: 'packages.outdated', title: 'Check outdated packages', category: 'packages', level: 'exec', description: 'List outdated dependencies.', params: { manager: MANAGER } },
  { id: 'packages.audit', title: 'Security audit', category: 'packages', level: 'exec', description: 'Audit dependencies for known vulnerabilities.', params: { manager: MANAGER } },
  { id: 'scripts.run', title: 'Run script', category: 'scripts', level: 'exec', description: 'Run a script defined in package.json.', params: { manager: MANAGER, name: { type: 'enum', enum: ['build', 'dev', 'lint', 'test', 'typecheck'], required: true, label: 'Script' } } },
  { id: 'agents.create', title: 'Create agent file from template', category: 'agents', level: 'edit', description: 'Render a template into a new file.', params: { template: S('Template', { required: true }), vars: { type: 'text', label: 'Variables (JSON)' }, path: { type: 'path', label: 'Path' } } },
  { id: 'agents.mcp.test', title: 'Test MCP server', category: 'agents', level: 'exec', description: 'Spawn the server, initialize and list tools (15 s timeout).', params: { name: S('Server', { required: true }) } },
  { id: 'tasks.export', title: 'Export native tasks to markdown', category: 'tasks', level: 'edit', description: 'Write native board tasks into TASKS.md.', params: { path: { type: 'path', default: 'TASKS.md', label: 'Path' } } },
  { id: 'workspace.open', title: 'Open project in agentneuron', category: 'workspace', level: 'exec', description: 'Start another agentneuron instance for a sibling project.', params: { path: { type: 'string', required: true, label: 'Project path' } } },
];
