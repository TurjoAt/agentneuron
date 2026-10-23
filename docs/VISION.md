# agentneuron — Vision & Plan (draft v0.1, 2026-10-23)

## Problem
AI-assisted projects (Claude Code, Codex, Cursor, Copilot, Windsurf…) generate and
constantly change a lot of markdown: `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`,
docs, TODOs, decision logs, plans, skills, agent definitions, memory files.
Nobody can see at a glance **what exists, how it links together, and what is
changing right now**.

## Idea
An npm package (`agentneuron`) that you install/run in **any** project folder. It:
1. Scans the project for AI-context markdown + other `.md` files.
2. Watches them live (create / change / delete).
3. Reads git info (status, diffs, history, authors, branches).
4. Builds a **graph / chain** of how files reference each other.
5. Serves a modern, animated, reactive web UI showing all of this in real time.

## Hard constraints (from the brief)
- Everything lives in a **`.agentneuron/` folder** inside the target project.
- **One single file starts the server** (e.g. `node .agentneuron/agentneuron.mjs`), and the UI comes with it.
- Can start on platform start or from any folder (`npx agentneuron` in any dir).
- Later: integrate with ecosystems — npm/Node, Composer (PHP), others — as thin
  providers/wrappers around the same core.

## Core features
### 1. Pattern knowledge base ("collection")
A built-in catalogue of known AI-context file patterns, per tool and global:
| Tool | Patterns (examples) |
|---|---|
| Claude Code | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/**` (agents, skills, commands, settings), `~/.claude/**` memory |
| Codex / OpenAI | `AGENTS.md`, `codex.md`, `.codex/**` |
| Cursor | `.cursorrules`, `.cursor/rules/*.mdc` |
| Copilot | `.github/copilot-instructions.md`, `.github/instructions/*.md` |
| Windsurf | `.windsurfrules`, `.windsurf/rules/**` |
| Gemini | `GEMINI.md` |
| Generic | `README.md`, `docs/**`, `TODO.md`, `ROADMAP.md`, `DECISIONS.md`, `adr/**`, `PLAN*.md`, `CHANGELOG.md` |
The catalogue is data (JSON), extendable by the user in `.agentneuron/config`.

Each file gets classified: **context / rules / agent / skill / command / memory / doc / todo / decision / plan**.

### 2. Link graph ("chain of data")
Detect relationships between files:
- Markdown links `[x](path.md)`, wiki links `[[name]]`
- Claude `@path` imports in CLAUDE.md
- Nested CLAUDE.md / AGENTS.md hierarchy (directory inheritance)
- Agents → skills → commands references
- Mentions of file paths in plain text
Rendered as an animated force-directed graph; nodes pulse when changed.

### 3. Live activity
- File watcher → WebSocket/SSE push to UI.
- Activity feed: "CLAUDE.md modified (+12 −3) 4s ago".
- Inline diff viewer (vs last save and vs git HEAD).
- Timeline / heatmap of which files churn most.

### 4. Git layer
- Per-file: status, last commit, author, history, diff.
- Repo: branch, uncommitted changes, recent commits touching md files.
- Works without git too (degrades gracefully).

### 5. Extras (later)
- TODO / checkbox extraction across all files → one task board.
- Decision log extraction.
- Token-size estimate per context file (how much it costs an agent to load).
- Stale-file detection (docs not touched while code changed).
- Search across all md.

## UI direction
Modern, dark-first, animated, reactive ("trap/hype" style):
- Views: **Graph**, **Files/Tree**, **Activity feed**, **Git**, **Tasks**.
- Smooth transitions, live pulses on change, glassy panels.
- Prebuilt and bundled — the user never runs a build step.

## Architecture (proposed)
```
agentneuron/                      ← package source (this repo)
  src/server/               scanner, watcher, git, graph, http+ws
  src/ui/                   frontend (built to a single bundle)
  patterns/                 pattern catalogue (json)
  build → dist/agentneuron.mjs    ONE self-contained file (server + inlined UI)

<target-project>/.agentneuron/    ← what gets installed in a project
  agentneuron.mjs                 single-file server + UI
  config.json               ports, extra patterns, ignore list
  cache/                    graph/index cache, event history
```
- Runtime: Node ≥ 18, **zero runtime deps** in the shipped file (bundled).
- Start: `npx agentneuron` (installs/updates `.agentneuron/` and runs) or `node .agentneuron/agentneuron.mjs`.
- Default `http://localhost:4747`, bound to 127.0.0.1.
- Providers later: Composer package that drops/launches the same `agentneuron.mjs`, etc.

## Extended scope (v0.2 brainstorm — real pain points)

### Tier A — core differentiators (build into v1)
- **Effective context preview** — "what does the agent actually load in folder X?"
  Merge the CLAUDE.md / AGENTS.md hierarchy + `@imports` + rules and show the final
  text and its token count. Nobody shows this today.
- **Context budget / bloat meter** — tokens per file and per load chain, warnings when
  context gets too large, so it doesn't eat the agent's window.
- **Local time-travel history** — agents change files without committing, and some
  files are gitignored (`CLAUDE.local.md`, memory). agentneuron keeps its own snapshots in
  `.agentneuron/history`, with a timeline scrubber and the ability to restore any version.
- **Context lint / health score**
  - broken links and `@imports`, and paths/commands mentioned that no longer exist
  - stale docs (code changed a lot, doc untouched)
  - duplicate or contradicting rules across CLAUDE.md / AGENTS.md / .cursorrules
  - orphan files (nothing links to them), abandoned PLAN/TODO files
  - per-project score from 0 to 100
- **Secret scanner** — API keys, tokens and passwords pasted into md, memory or settings files.
- **Config view, not only md** — `.mcp.json`, `.claude/settings.json` (permissions, hooks),
  `.cursor/mcp.json`: see which MCP servers, hooks and permissions are active.

### Tier B — multi-agent world (very trendy)
- **Agent attribution** — which session/agent changed a file. Read Claude Code
  transcripts (`~/.claude/projects/*.jsonl`) and Codex logs to link a change to the
  session and the prompt that caused it.
- **Parallel-agent conflict radar** — several sessions working on one machine
  (this server already runs 6): live "who is touching what", with an alert when two agents
  edit the same file.
- **Session usage stats** — tokens and cost per session/project from transcripts.
- **Cross-tool sync** — keep a single source of truth: generate or sync
  AGENTS.md ↔ CLAUDE.md ↔ .cursorrules ↔ copilot-instructions, show drift between them.
- **MCP server mode** — agentneuron exposes its graph, history and lint as an MCP server, so
  agents themselves can ask "what changed in docs today?" or "what's the decision on X?".

### Tier C — workflow & reach
- **Unified task board** — every `- [ ]` and TODO across files into one kanban, linked to source lines.
- **Decision log (ADR) extraction** and a timeline.
- **Multi-project dashboard** — one UI for all projects on a machine/server
  (e.g. all sites under `/www/sites`), with a project switcher.
- **Notifications** — desktop, webhook, Slack/Discord on chosen events.
- **Inline editor** — edit md from the UI (opt-in; read-only by default).
- **Pattern/skill library browser** — browse community CLAUDE.md, skills and agents from GitHub
  and install them into the project.
- **Headless/CI mode** — `agentneuron lint --json` fails CI on a broken context or a leaked secret.
- **Terminal mode** — a small TUI or `agentneuron status` for SSH-only users.
- **Search** — full-text plus fuzzy search across all md, history included.
- **Export** — snapshot report (HTML/MD) of the project's context state.

### Non-functional must-haves
- Read-only by default, local-only, **no telemetry**.
- Fast on big repos: ignore `node_modules`, `vendor`, `.git`, binaries, with file-size caps.
- Auth token when exposed beyond localhost; HTTPS through a reverse proxy (openresty).
- Graceful without git, without network, on Node 18+.
- `.agentneuron/` adds itself to `.gitignore` (history and cache), config stays committable.

## Open decisions
- [ ] Frontend stack: Svelte vs React vs Preact (+ graph lib: d3-force / cytoscape / sigma).
- [ ] Bind only localhost, or allow remote with token (servers like this one)?
- [ ] Watch scope: only known patterns, or all `.md` in project?
- [ ] Include user-global files (`~/.claude/**`)?
- [ ] Package name availability on npm (`agentneuron` may be taken).
- [ ] Auto-start "on platform start": systemd / pm2 / npm `postinstall` / composer script?

## Status (2026-10-23)
v0.1.0 built and tested (83 tests). Done: M1–M5, most of M6 (attribution, conflict
radar, session usage) and the task board / search from M7. Not yet: cross-tool sync,
MCP server mode, multi-project dashboard, notifications, Composer wrapper, library browser.

## Milestones
1. **M1 core**: scanner + pattern catalogue + watcher + git basic + local history + JSON/WS API.
2. **M2 UI**: file tree, activity feed, diff viewer, timeline, live updates.
3. **M3 graph + context**: link extraction, animated graph, effective-context preview, token meter.
4. **M4 health**: lint rules, secret scanner, health score, config view, `agentneuron lint` CLI.
5. **M5 packaging**: single-file build, `npx agentneuron`, `.agentneuron/` install, token auth.
6. **M6 multi-agent**: transcript attribution, conflict radar, usage stats, cross-tool sync.
7. **M7 reach**: MCP server mode, multi-project dashboard, task board, notifications.
8. **M8 providers**: Composer wrapper, test inside `index/` (Laravel project), library browser.
