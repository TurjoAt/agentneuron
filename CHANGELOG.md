# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/TurjoAt/agentneuron/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/TurjoAt/agentneuron/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/TurjoAt/agentneuron/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TurjoAt/agentneuron/releases/tag/v0.1.0
