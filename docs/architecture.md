# Architecture

AgentNeuron is a Node.js program (ESM, Node 18+) with a Svelte UI. There is no database and no build step at runtime: it serves a pre-built single-page app and a JSON API, and keeps state in plain files under `.agentneuron/`.

```
 CLI (src/cli.js)
   |-- start / workspace -> server (src/server/app.js)
   |-- mcp               -> MCP server (src/mcp/server.js)
   |-- lint / status     -> analysis only, no server
   `-- init              -> .agentneuron/ + bundle copy
```

## Data flow

```
 filesystem --chokidar--> watcher --> store --> history (versions)
                                       |   `--> 'event' --> persist (events.jsonl)
                                       v
                    analysis (debounced 300 ms): graph + lint + score + tasks + decisions + git status
                                       |
              HTTP routes <------------+------------> SSE /api/stream --> UI
                    |
        permission check (role + level) --> handler --> audit log
                    |
          actions registry --> job runner --> spawn (no shell) --> joblog events
```

1. `core/scanner.js` walks the project once; `core/classify.js` assigns a tool and kind from `patterns/catalogue.json` plus `extraPatterns`.
2. `core/watcher.js` (chokidar, 150 ms debounce) feeds changes into `core/store.js`, which keeps file entries and contents in memory and writes versions to `core/history.js`.
3. After any change the server recomputes analysis (graph, lint, health, tasks, decisions) once things settle and pushes `health`, `graph` and `event` messages over SSE.
4. Agent attribution: `agents/sessions.js` reads Claude Code and Codex session logs to attribute a change to an agent session; `agents/conflicts.js` flags two agents editing the same file within two minutes.

## Module map

| Path | Responsibility |
|---|---|
| `src/cli.js` | Argument parsing, commands, banner |
| `src/core/` | Config, scanner, classifier, glob, watcher, store, history, diff, token estimate |
| `src/analysis/` | Links and graph, effective context, tasks, decisions, git helpers |
| `src/health/` | Lint rules, secret scanner, score, agent-config reader |
| `src/server/` | HTTP server, auth and roles, router; `routes/*.js` register endpoints by area (files, git, tasks, agentcenter, project, reports, system, workspace) |
| `src/actions/` | Action registry, job runner; action modules (`files`, `git`, `packages`, `agents`, `tasks`, `agentneuron`) |
| `src/files/` | Safe file operations: save with hash check, rename with link rewriting, trash, replace, lint fixes, bookmarks, annotations |
| `src/board/` | Task board: Markdown task parsing and write-back, native tasks, `board.json` |
| `src/agentcenter/` | Tool setup scanner, templates, sync, transcripts, costs, time travel, MCP test |
| `src/agents/` | Session discovery and conflict radar |
| `src/insights/` | Lessons from sessions, rule effectiveness, replay, cost by feature ([insights](insights.md)) |
| `src/git2/` | Git read APIs and changelog generator |
| `src/project/` | Project intelligence: detectors, env, dotfolders, stats, drift, Laravel parsers |
| `src/reports/` | Report data and export |
| `src/persist/` | JSONL logs with rotation: events, metrics, audit |
| `src/notify/` | Notifications and webhooks |
| `src/workspace/` | Workspace project discovery and child instances |
| `src/mcp/` | MCP server |
| `src/patterns/catalogue.json` | File-pattern catalogue |
| `ui/` | Svelte 5 + Vite app: `src/views` (pages), `src/lib` (components, API client, stores) |
| `scripts/build.mjs` | Build: Vite for the UI, then esbuild for the bundle |
| `test/` | `node --test` suites |

## Routing and permissions

Feature modules in `src/server/routes/` register handlers on a tiny router with a minimum level (`read`, `state`, `edit`, `exec`, `danger`). `app.js` authenticates the request (cookie, `Authorization: Bearer`, or `?token=`), derives a role, checks `ctx.can(level, role)`, parses the JSON body, runs the handler, and appends non-read requests to the audit log. Routes still in `app.js` (state, files, file, diff, history, events, graph, context, health, tasks, decisions, git, config, sessions, conflicts, search, stream) are `read`.

Actions use the same check and add parameter validation, previews, and job tracking. Adding an action means registering a definition with `id`, `level`, `params`, `preview` and `run`; nothing else needs to change.

## Single-file bundle

`npm run build` (`scripts/build.mjs`):

1. Vite builds `ui/` to one self-contained `ui/dist/index.html` (JS and CSS inlined).
2. esbuild bundles `src/cli.js` and all dependencies into `dist/agentneuron.mjs` (ESM, target Node 18), with the UI HTML and the package version injected as compile-time constants (`__AGENTNEURON_UI__`, `__AGENTNEURON_VERSION__`) and a `#!/usr/bin/env node` banner.

The result is the `bin` of the npm package and the file `agentneuron init` copies to `.agentneuron/agentneuron.mjs`. If the UI build fails, the previous `ui/dist` is reused, or a fallback page is embedded (the API still works). `npm run build -- --strict` fails the build on UI errors.

When run from source (`npm run dev`), the server loads `ui/dist/index.html` from disk.

## Design principles

- Local-first, zero infrastructure; state in readable files.
- Read-only by default; every capability beyond that is an explicit opt-in with a level.
- No shell: commands are argument arrays with schema validation.
- The UI is just a client of the HTTP API; anything the UI does, a script can do.
- Degrade quietly: no git, no sessions, unreadable files, or a read-only project must not stop monitoring.

Design notes from development are in [internal/](internal/).
