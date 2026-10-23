// Seed content for the mock backend (realistic monorepo with AI-context files).
// Kept separate from mock.js so the logic stays readable.

export const PROJECT = { root: '/home/dev/acme-commerce', name: 'acme-commerce' };

/** [path, tool, kind, ageMinutes, content] */
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
- [ ] Fix flaky \`checkout.e2e.ts\` on CI
- [ ] Add Klarna to payment methods
- [x] Upgrade to Next 15
- [ ] Write ADR for search provider

## Later
- [ ] Multi-currency price lists
- [ ] Gift cards
- [x] Remove moment.js

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
- [x] Spike the SDK in a branch
- [x] Map payment states to order states
- [ ] Implement \`PaymentIntent\` module in \`apps/api/src/modules/checkout\`
- [ ] Feature flag \`checkout_v2\`
- [ ] Shadow traffic for a week
- [ ] Remove legacy flow

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
