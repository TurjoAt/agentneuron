# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-10-28

### Added

- **Usage & cost** page and `agentneuron usage`: cost per day, model, branch, agent and session from local Claude Code and Codex logs. Cost is exact where Claude Code recorded it (`cost-state`) and marked as an estimate otherwise; every figure reports its coverage. Cache hit rate and savings, tokens, turn times, daily budget with burn rate and projection, alerts (cost spikes, repeated tool failures, context jumps, slow turns, denials) and tips.
- Usage tabs for tool health (error rate, denials, latency, MCP servers, skills, hooks, failure loops), a prompt library with repeated-prompt suggestions, agent fleet graphs (subagents and advisor), code impact per file and activity patterns.
- **Sessions** page: every session with filters, and a replay of prompts, thinking (duration), tool calls, results, errors, edits, compactions and subagents on one timeline with a time ruler and before/after file diffs. Replaces the Agents "Sessions & cost" and Insights "Replay" tabs (old links redirect).
- **Memory & plans** page: Claude's saved memory and plans for the project, links between memories, and warnings for paths a memory mentions that no longer exist.
- Agent settings audit tab under Truth & safety (permission modes, broad allow rules, MCP servers that need login, hook errors).
- Details panel for any session, file, commit, task, tool, model or agent, linked from every page; a product map of pages and how their data connects; related-page links on each page; grouped, collapsible sidebar with badges; a bottom bar on phones; entity search in the command palette.
- Animated first-load screen that shows the real startup steps (connect, sign in, files, analysis, sessions).
- MCP tools `get_usage`, `get_session_replay` and `get_tool_health`.
- **Ship check** page and `agentneuron ship`: detects the project's test, build, lint and typecheck commands, runs them on request (`exec` level, or `--run` in the CLI), parses the results and gives a verdict (verified, partial, failing, unverified) with evidence. Acceptance criteria on board tasks are tracked as verified, incomplete, untested or failed with linked tests, commits and files. Static production-readiness scan and a fake-functionality detector (placeholder handlers, mock auth, demo data, stubs).
- **Change review** page and `agentneuron review`: per-file and per-hunk risk with reasons, missing tests and a read-first order; impact analysis of changed symbols (importers, callers, routes, tests, contracts). Safe checkpoints (`agentneuron checkpoint`) stored as `refs/agentneuron/checkpoints/*` with per-file restore after an automatic undo point. Package guard (`agentneuron packages`) for look-alike, unlocked or risky dependencies, offline by default.
- **Agent brief** page: resume briefs of a session or task to continue in another agent (`agentneuron resume`), warnings before repeating known mistakes (`agentneuron preflight`, exit 2 for `PreToolUse` hooks), task context packs (`agentneuron pack`) and a bug detective (`agentneuron debug`).
- MCP tools `get_ship_report`, `get_task_scope`, `review_changes`, `get_change_impact`, `check_package`, `get_resume_brief`, `preflight_check`, `get_context_pack` and `get_debug_report`.
- New logo and favicon; GitHub link in the top bar and account menu; reorganized Overview with a status row (usage, ship check, change review, truth & safety) and labelled sections.

### Security

- Usage routes follow the prompt policy (`live.showPrompts`, `live.viewerPrompts`): viewers get no prompt text, titles, thinking or memory bodies, and file versions need `live.viewerDiffs`. Claude's credentials, session keys and pasted prompt content are never read or returned. Other projects' sessions are read only with `"usage": { "scope": "all" }` and the admin role.

- Quality-round routes: test-failure excerpts and run logs are admin-only, session text in briefs follows the prompt policy, pasted error text is admin-only and never stored in job parameters, package registry lookups need `packages.online` and the admin role, and checkpoint file content needs `live.viewerDiffs`.

## [1.0.0] - 2026-10-26

From watching context to keeping it true. Includes everything prepared for 0.3.0 below, which was not published separately.

### Added

- **Port fallback**: when port 4747 (or `--port`) is busy, `start` moves to the next free port and says so; `--strict-port` restores the old behaviour.
- **Network links**: with `--host 0.0.0.0` or `::`, the startup output lists a ready-to-open `network` URL for each real network interface (Docker and loopback interfaces are skipped).

- **Live view** (`#/live`): files Claude Code, Codex and other agents edit in real time, from their session transcripts, confirmed by the file watcher. One lane per agent, streaming diffs, "now editing" chips, a heat strip, filters and collision warnings when two sessions touch the same file. New SSE events `agent.session`, `agent.edit`, `agent.command`, `agent.collision`; the Overview, Neuron brain and radar show agent activity in agent colours.
- **Multi-agent coordination**: advisory file claims with TTL, task claims and handoff notes over HTTP and MCP (`claim_task`, `claim_files`, `release_files`, `handoff_note` at `--level state`; `list_claims`, `get_handoffs` read-only), shown on board cards and in Live.
- **Truth check** (`agentneuron verify`, `/api/verify`, MCP `verify_context`, new lint rule `false-claim`): commands, scripts, paths, versions, competing libraries, env vars and ports claimed in context files, checked against package.json, lockfiles, Makefile, composer, pyproject and the file tree, with suggested fixes (apply at `edit` level).
- **Security audit** (`agentneuron audit`, `/api/audit/config`, MCP `audit_agent_config`): unpinned or `@latest` MCP servers, plain-http servers, inline tokens, `Bash(*)` and bypass modes, Codex full access, risky hooks, world-writable files and secrets, with a 0 to 100 risk score.
- **Context CI** (`agentneuron ci`) with GitHub annotations, a job summary, `--base` to report only new problems, and a composite GitHub Action (`uses: TurjoAt/agentneuron@v1.0.0`).
- **Insights** (`#/insights`, `agentneuron lessons`, MCP `suggest_rules`): lessons from user corrections, reverted edits, repeatedly failing commands and repeated instructions, as proposed rules with evidence; rule effectiveness and a context diet; "why did the agent do that?" replay; cost by feature.
- **Rules studio** (`#/rules`, `agentneuron compile`, `agentneuron rules import|list`, MCP `compile_preview`): write rules once in `.agentneuron/rules/` and compile them into CLAUDE.md, AGENTS.md, GEMINI.md, Cursor, Copilot and Windsurf files, keeping hand-written text, with `--check` for CI and merge-back of hand edits.
- **Generate** (`agentneuron generate`): a starter AGENTS.md/CLAUDE.md from the code, every line cited.
- `examples/drifted-project` for the truth check and audit.

### Changed

- The sidebar is grouped into Monitor, Context, Agents and Project. Keyboard shortcuts 1 to 9 follow the new order (Overview, Live, Graph, Files, Diff, Context, Health, Truth & safety, Rules studio).
- Valued CLI flags no longer swallow a following `--flag`.

### Security

- File events show the attributed agent's prompt and session title to admins only; viewers get the tool and session id.
- Live prompts and diffs follow `live.showPrompts`, `live.viewerPrompts` and `live.viewerDiffs` (prompts off for viewers and for non-loopback binds by default).
- Session lists, the session timeline, cost rows and Insights (Replay, Lessons, cost by feature) follow the same prompt policy. This changes existing endpoints: on a non-loopback bind, admins now need `live.showPrompts: true` to see session titles and prompts there.

## [0.3.0] - 2026-10-25

Not published separately; first released as part of 1.0.0.

### Added

- **AI-ready report export.** `ai` format: a compact Markdown context pack with YAML front-matter, summary, KPI deltas, what changed, ranked health issues, open tasks, per-tool budget and suggested next actions (optionally with size-capped file contents). `json` format with the versioned schema `agentneuron.report/v1`. Secrets are masked and absolute paths removed in every format.
- `report_export` MCP tool, and Export menu with "Copy for AI" on the Reports page.
- CLI: `agentneuron update [--check] [--yes]` (global npm install, or verified, atomic update of an `init` copy), `agentneuron doctor [--json]`, `agentneuron export [--format ai|json|md|csv|html] [--range 7d] [--out file]`; grouped help and `<command> --help`.
- Dashboard: animated "Neuron brain" orbit view of the context graph, and a radar indicator in the top bar that sweeps while the live stream is connected and stops when it drops.
- UI motion: sliding tab indicator, card entrance, sparkline draw-in, loading skeletons. Animations respect reduced-motion and pause in hidden tabs.
- `llms.txt`, a comparison page, and a rewritten README.
- Neuron brain nodes are keyboard accessible (arrow keys, Enter to open, Esc to leave).

### Changed

- Tasks open in the Table view by default (`#/tasks?tab=board` for the board).
- One version source for the CLI, server and MCP server.
- `update` cross-checks the GitHub release bundle against the same version's npm tarball (sha512 integrity, then the bundle's sha256) before replacing anything; `--allow-unverified` only covers a version not on npm yet.
- CodeQL skips the test folder.

### Fixed

- File changes that arrived during an analysis were lost, leaving health and lint stale.
- A failed `listen` (port in use) left watchers and timers keeping the process alive.
- `lint`, `status` and `export` wrote history snapshots into the project.
- Multi-byte characters split across process output chunks; leaked timers in the action registry; git-quoted non-ASCII file names never matched; checklist item edits on markdown tasks were silently dropped; new tasks in CRLF files mixed line endings.
- Windows: actions that run `npm`, `pnpm`, `yarn`, `npx` and other `.cmd` shims now work (safe `cmd.exe` argument escaping, no shell), and timeouts/cancel stop the whole process tree.
- Case-only renames (`notes.md` → `Notes.md`) work on case-insensitive filesystems (Windows, macOS), and the watcher no longer re-adds the old name.
- Agent sessions: transcripts are parsed up to the last 64 MB; the Codex sessions folder is not re-walked on every change; sessions matched by working directory have a timeline; Codex patch paths resolve against the session's own folder.
- Several Svelte reactivity bugs (dialogs, rules tester re-running on every keystroke) and accessibility of chart legends.

### Performance

- Link extraction is no longer O(files × paths) (4000 notes: ~9 s to ~0.2 s); startup reads each file once; the costs route walks Codex sessions once per request.

## [0.2.1] - 2026-10-24

First release on npm (0.2.0 was tagged on GitHub but not published to npm).

### Security

- Project files are checked and read through one file descriptor, so a file swapped for a symlink between the check and the read can no longer lead outside the project.
- Unexpected server errors return their message only (or `internal error`), never a raw thrown value.
- Cookie parsing ignores keys such as `__proto__`.
- The Composer package-name check no longer backtracks exponentially on long input.
- The UI's CSP script hashing also matches `</script >` end tags; heading slugs strip tags without regexes; report table cells escape backslashes.

## [0.2.0] - 2026-10-23

From monitor to control center. Everything that changes anything is opt-in and off by default.

### Fixed

- Terminal action on Windows: backslashes in paths such as `C:\Program Files\nodejs\node.exe` are no longer treated as escape characters.
- Test suite runs on Windows; CI builds on Node 20.19+/22 (required by the UI build tools) and smoke-tests the bundle on Node 18.

### Changed

- **Renamed from `mdctl` to AgentNeuron.** The npm package and command are now `agentneuron`; the data folder is `.agentneuron/`. An existing `.mdctl/` folder is moved to `.agentneuron/` automatically on first run, keeping history and config. The bundle is `agentneuron.mjs`.
- The `--write` flag is kept as an alias for `--enable edit`; history restore now requires the `edit` level.

### Added

- **Permission levels and actions engine.** `read`, `state`, `edit`, `exec`, `danger`, `terminal`; enabled with `actions` in `config.json` or `--enable`. Every action has a schema-validated parameter set, a preview, runs as a cancellable job with live output, and is spawned without a shell. See [docs/actions.md](docs/actions.md).
- **Roles and auth.** Admin and read-only viewer tokens (`--admin-token`, `--token`), login screen with an HttpOnly session cookie, rate-limited login, `Authorization: Bearer` and `?token=` for scripts.
- **Audit log** (`.agentneuron/audit.jsonl`) of every action and every state/edit/danger request, with secrets masked; persistent event and metric logs with rotation.
- **Notifications** in the UI and Slack/Discord-compatible webhooks for secrets, agent conflicts, health drops and job results.
- **Editor and file operations:** edit Markdown in the browser with conflict detection, create from templates, rename with link rewriting, soft delete to trash, find and replace across files, one-click lint fixes, bookmarks and annotations.
- **Graph 2.0:** multiple layouts, neighbourhood focus, shortest path between files.
- **Tasks:** board, list, table, calendar and timeline views from Markdown checkboxes with inline metadata (`!priority`, `#label`, `@due()`, `@assignee`), native tasks, comments, optional write-back to Markdown, decision records.
- **Git 2.0:** changes, history, branches, tags, stash, remotes, blame, stats, generated changelog; git actions (stage, commit, branch, stash, tag, fetch, pull, push, discard).
- **Reports:** KPIs, time series, heatmap, top tables, export to CSV, Markdown and HTML.
- **Project intelligence:** stack, dependency, script, CI, Docker, env-key and hidden-folder detection; Laravel routes, models and migrations; documentation drift; code statistics; package and script actions.
- **Agents center:** tool and capability matrix for 13 AI tools, rules that apply to a file, templates, sync and drift between instruction files, MCP server management and testing, Claude permissions and hooks editing, session timelines and estimated cost, context time travel.
- **MCP server** (`agentneuron mcp`): read-only tools over stdio.
- **Workspace mode** (`agentneuron workspace`) for a folder of projects.
- Detection for Cline, Roo Code, Aider, Continue, Zed, JetBrains Junie and Amazon Q.
- Documentation in `docs/`, runnable examples in `examples/`.

### Security

- Security hardening (see [docs/permissions-and-security.md](docs/permissions-and-security.md)).

## [0.1.0] - 2026-10-23

Initial release, developed as `mdctl`: a live monitor for AI-context Markdown.

### Added

- Project scanner and file watcher for `CLAUDE.md`, `AGENTS.md`, Cursor rules, Copilot and Windsurf instructions, Gemini files, skills, agents, commands, plans, TODOs and docs.
- Single-file bundle with an embedded web UI served on `127.0.0.1:4747`.
- Link graph (Markdown links, wiki links, `@imports`, path mentions), effective context view, token estimates.
- Health score with lint rules and a secret scanner; `lint` command for CI.
- Per-file version history, diffs and restore (`--write`), git status and log.
- Task and decision extraction from Markdown.
- Agent session discovery and a concurrent-edit conflict radar.
- Server-Sent Events live updates, text search, token authentication, `init` and `status` commands.

[Unreleased]: https://github.com/TurjoAt/agentneuron/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/TurjoAt/agentneuron/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/TurjoAt/agentneuron/compare/v0.2.1...v1.0.0
[0.3.0]: https://github.com/TurjoAt/agentneuron/compare/v0.2.1...v1.0.0
[0.2.1]: https://github.com/TurjoAt/agentneuron/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/TurjoAt/agentneuron/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TurjoAt/agentneuron/releases/tag/v0.1.0
