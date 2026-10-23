# agentneuron v0.2 — from monitor to control center (plan, 2026-10-23)

v0.1 *watches*. v0.2 lets you *act*: edit, navigate, manage tasks, run git and
package operations, understand the whole project stack, and manage every AI-tool
config — from one UI.

---

## 1. Editor & navigation (everywhere)
- **Edit any .md** in the app: split view (editor | live preview), CodeMirror 6,
  Ctrl+S, autosave option, dirty indicator.
- **Safe save**: hash check — if the file changed on disk (an agent edited it) since
  you opened it, show a 3-way merge / "theirs vs yours" diff instead of overwriting.
  Every save snapshots history first.
- **Hyperlinks everywhere**: any `.md` mention (md link, `[[wiki]]`, `@import`, plain
  path, backticked path) is clickable in preview, raw, editor (Ctrl+click), context
  view, health issues, tasks, search, reports. Hover → peek card of the target.
- **Browser-like navigation**: back/forward, breadcrumbs, recent files, backlinks
  panel ("who links here"), open-in-graph.
- **File actions**: new (from templates: CLAUDE.md, AGENTS.md, ADR, plan, skill,
  agent, command, rule), rename/move **with automatic link rewriting** across all
  files, duplicate, delete (to `.agentneuron/trash`, undoable), restore version, copy path,
  "create task from selection", "explain/summarize" (later via agent).

## 2. Graph 2.0 — "neural network" view
Multiple view angles, one dataset:
| Layout | Purpose |
|---|---|
| **Neural (layered)** | Context/rules files as input layer → agents/skills/commands → docs/plans → tasks/decisions. Edges glow; signal particles flow along edges when a file changes. |
| **Force 2D** | Organic overview (current, upgraded) |
| **Orbit / pseudo-3D** | Rotatable sphere layout, depth-shaded, drag to orbit |
| **Radial tree** | From a chosen root (e.g. CLAUDE.md) outward by hops |
| **Clusters** | Grouped hulls by folder / tool / kind |
| **Timeline** | X = last modified, Y = cluster — see what is alive vs stale |
| **Matrix** | Adjacency matrix for dense projects |
Plus: WebGL/canvas rendering for 1k+ nodes, minimap, focus mode (n-hop
neighborhood), path finder between two files, filters (tool/kind/health/age),
label level-of-detail, highlight broken links, heat coloring by churn, click → open
editor, right-click → actions.

## 3. Reports page (new)
- **Time range**: 24h / 7d / 30d / 90d / custom + compare to previous period.
- Needs persistence (v0.1 keeps only 500 events in memory):
  `.agentneuron/events.jsonl` (every change), `.agentneuron/metrics.jsonl` (hourly snapshot:
  files, tokens, health, tasks, git dirty).
- Charts: changes over time (line/area, by tool/kind stacked), token growth,
  health score trend, tasks created vs closed (burndown/burnup), agent activity per
  session (tokens, edits), commits per day, top churned files, most-linked files,
  stale docs, heatmap calendar (GitHub-style).
- KPI tiles with deltas; drill-down to files/events.
- Export: CSV, Markdown, HTML snapshot.

## 4. Tasks → project management (Trello / ClickUp style)
- Views: **Board** (kanban, drag & drop), **List**, **Table**, **Calendar**, **Timeline**.
- Columns: Backlog · Todo · In progress · Review · Done (customizable).
- Sources:
  - **Markdown tasks** (two-way sync): `- [ ]` todo, `- [/]` in progress, `- [x]` done;
    inline meta `@due(2026-11-01) #label !high @owner`. Moving a card edits the md line.
  - **Native tasks** stored in `.agentneuron/board.json` (optionally exported to `TASKS.md`).
- Card: title, description (md), status, priority, labels, due date, assignee
  (person or agent session), linked files, subtasks/checklist, comments, activity.
- Filters, search, swimlanes (by file / label / priority / assignee), WIP limits.
- Later: "hand this card to an agent".

## 5. Git 2.0 (tabbed)
Tabs: **Overview** (branch, ahead/behind, last commits, contributors) ·
**Changes** (staged/unstaged tree + diff, stage/unstage/discard hunk/file, commit
with message) · **History** (commit graph with lanes, filter by path/author/date,
commit detail) · **Branches** (local/remote, create/switch/merge/delete) · **Tags** ·
**Stash** · **Remotes** (fetch/pull/push) · **Blame** (per md file) · **Stats**.
All write operations go through the Actions engine (§8).

## 6. Project intelligence (new) — "what is this project?"
Detector plugins read root manifests and config files and produce facts + widgets:
- **Manifests**: package.json (scripts, deps, engines, workspaces), composer.json,
  lock files → package manager, pyproject / requirements, go.mod, Cargo.toml,
  Gemfile, pom.xml / gradle, *.csproj, deno.json, bun.lockb.
- **Frameworks**: Laravel (artisan, config/*.php, routes, migrations), Symfony,
  Next.js, Nuxt, Vite, Astro, Remix, SvelteKit, Angular, Express/Nest, Django,
  Rails, Flask/FastAPI, Spring…
- **Tooling**: tsconfig, eslint, prettier, tailwind, phpunit/pest, jest/vitest,
  playwright, husky, lint-staged, editorconfig.
- **Infra**: Dockerfile, docker-compose (services/ports), .github/workflows, GitLab CI,
  vercel.json, netlify.toml, fly.toml, Procfile, nginx confs.
- **Env**: `.env.example` keys vs `.env` keys (names only — never values) → missing keys.
- **Dot-folders**: .github, .vscode, .idea, .husky, .devcontainer, .docker, .next,
  .nuxt, .vercel, .claude, .cursor, .codex … summarized with what they contain.
- **Code stats**: languages by LOC, folder sizes, largest files.
UI: **Project** page with sections/widgets: Stack badges with versions,
Dependencies table (outdated / audit via actions), Scripts (runnable), Env check,
CI/CD, Docker services, Routes / DB schema (framework specific), Structure.

## 7. Agent context center (dashboard upgrade)
Everything AI-tool related, for every tool, in one place:
- **Claude**: CLAUDE.md hierarchy, CLAUDE.local.md, `.claude/settings*.json`
  (permissions, hooks, env names, model), agents, skills, commands, output styles,
  MCP (.mcp.json), global `~/.claude` (opt-in).
- **Codex**: AGENTS.md hierarchy, `~/.codex/config.toml` (profiles, MCP, sandbox).
- **Cursor**: `.cursor/rules/*.mdc` (globs, alwaysApply, description), `.cursorrules`,
  `.cursor/mcp.json`, `.cursorignore`.
- **Copilot, Windsurf, Gemini, Cline/Roo (.clinerules), Aider (.aider.conf.yml,
  CONVENTIONS.md), Continue (.continue/), Zed.**
Features:
- **Capability matrix**: tool × (instructions, rules, MCP, hooks, permissions,
  agents, skills, commands, ignore files) — green/missing.
- **"Which rules apply to file X?"** — glob tester across all tools.
- **Context budget simulator** per tool/dir (extends v0.1 Context view).
- **Editors & wizards**: permissions editor, hooks editor, MCP server add/edit +
  "test" (spawn, list tools), create skill / agent / command / rule from templates.
- **Cross-tool sync**: generate/sync AGENTS.md ↔ CLAUDE.md ↔ .cursorrules ↔
  copilot-instructions, drift view.

## 8. Actions engine (the core of "act, not only monitor")
- **Action registry**: `{ id, title, category, params schema, level, run() }`,
  all listed in ⌘K palette and as buttons in context.
- **Levels**: `read` · `edit` (write project files) · `exec` (run commands) ·
  `danger` (discard, delete branch, force…, typed confirmation).
- **Categories**:
  - Files: create, edit, rename/move (+link rewrite), delete/trash, restore.
  - Git: stage, unstage, discard, commit, branch create/switch/delete, fetch/pull/push, stash.
  - Packages (auto-detects manager from lockfile): npm/pnpm/yarn/bun
    install/add/remove/update/outdated/audit; composer install/require/remove/update/outdated/audit; pip/poetry.
  - Scripts: package.json scripts, composer scripts, `php artisan …` (allowlisted),
    Makefile targets.
  - Framework: Laravel cache:clear / migrate:status / route:list; Next build…
  - Agents: create skill/agent/command, add MCP server, edit permissions/hooks.
  - agentneuron: rescan, clear history, export report.
- **Job runner**: queue + live terminal panel (stdout/stderr streamed over SSE),
  cancel, exit code, duration, job history in `.agentneuron/jobs/`.
- **Safety**:
  - No free-form shell by default — only registered actions with argument validation.
    Optional "terminal" mode must be explicitly enabled.
  - Every action shows the exact command before running; confirmation dialogs.
  - **Audit log** `.agentneuron/audit.jsonl` (when, who/token, action, params, result).
  - **Two tokens**: viewer token (read-only) and admin token (actions). Cookie session
    instead of token in URL.
  - Mode flags: `--mode read|edit|exec` (default read). Recommend HTTPS when exec is
    enabled on a public address.

## 9. Cross-cutting
- Persistence layer (`.agentneuron/*.jsonl`, `board.json`) with rotation.
- UI shell: global action bar, right-click context menus, toasts with undo,
  keyboard shortcuts, job panel docked at bottom.
- Multi-project dashboard, notifications, MCP server mode (from v0.1 backlog).

## Phases
1. **Foundation**: actions engine + levels/tokens/audit + job runner + persistence;
   editor + link navigation + file actions.
2. **Project intelligence** + **Agent context center**.
3. **Tasks board** + **Git 2.0**.
4. **Graph 2.0** + **Reports**.
(Phases 2–4 can be built in parallel once phase 1's contracts exist.)
