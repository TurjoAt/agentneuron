# AgentNeuron

**AgentNeuron is an open-source, local control center for AI coding-agent context files.** It shows what Claude Code, Codex and other agents are editing in real time, checks that `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor rules, Copilot instructions, Windsurf rules, skills and MCP configs are still true and safe, learns rules from your agent sessions, and keeps every tool's rules in sync, in a web dashboard, a CLI and an MCP server.

[![npm version](https://img.shields.io/npm/v/agentneuron)](https://www.npmjs.com/package/agentneuron)
[![npm downloads](https://img.shields.io/npm/dm/agentneuron)](https://www.npmjs.com/package/agentneuron)
[![CI](https://github.com/TurjoAt/agentneuron/actions/workflows/ci.yml/badge.svg)](https://github.com/TurjoAt/agentneuron/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >= 18](https://img.shields.io/badge/node-%3E%3D18-339933.svg)](https://nodejs.org)

```sh
npx agentneuron            # then open http://127.0.0.1:4747
```

![AgentNeuron overview dashboard: KPIs, the Neuron brain graph of context files, live agents, truth and safety summary and context health](https://raw.githubusercontent.com/TurjoAt/agentneuron/main/docs/assets/overview.png)

## What is AgentNeuron?

AgentNeuron is a Node.js command-line tool that gives you one place to see, check and manage the instruction files your AI coding agents read. Claude Code, OpenAI Codex, Cursor, GitHub Copilot, Gemini CLI, Windsurf and others each load their own Markdown and config files. AgentNeuron finds all of them in a project, shows how they link together, works out what each agent actually sees in a given folder, flags problems (broken links, leaked secrets, oversized context, duplicated or drifting rules), and records every change.

It runs on your machine, needs no account, sends no telemetry and does not call any AI model. It is read-only by default.

## Why

AI tools read a growing pile of instruction files, and nobody checks them. Links rot, the same rule is copied into five tools and drifts, a context file quietly grows to 12,000 tokens, someone pastes an API key into `CLAUDE.md`. AgentNeuron watches the project and tells you what each agent will see, what is broken, and what changed.

- **Local and self-contained:** one file with the UI embedded, no database, binds to `127.0.0.1`.
- **Safe by default:** writes only inside `<project>/.agentneuron/`. Anything that edits files or runs commands is opt-in.
- **Works across tools:** one view of 13 AI coding tools instead of one config format at a time.

## Features

**Watch agents work, live**
- [Live view](docs/live.md): every file Claude Code, Codex and other agents edit, as it happens, in one lane per agent, with diffs, "now editing" chips, a heat strip and collision warnings when two sessions touch the same file.
- [Coordination](docs/coordination.md) over MCP: agents claim tasks and files (advisory locks) and leave handoff notes for the next session.

**Check that context is true and safe**
- [Truth check](docs/verify.md): finds instructions that are no longer true (commands, scripts, paths, versions, ports, env vars) against the real repo and suggests the fix.
- [Security audit](docs/audit.md) of agent config: unpinned MCP servers, inline tokens, `Bash(*)`, bypass modes, risky hooks, with a 0 to 100 risk score.
- [Context CI](docs/ci.md): `agentneuron ci` and a GitHub Action that annotate pull requests, with `--base` to report only new problems.

**Learn from your sessions**
- [Insights](docs/insights.md): corrections, reverted edits and repeatedly failing commands in Claude/Codex sessions become proposed rules you accept with one click.
- Rule effectiveness: which rules agents follow, ignore or never need, and a "context diet" with token savings.
- Replay: the exact context an agent had when it made a change. Cost by feature: agent tokens and cost per task or branch.

**Monitor**
- Live file watcher with a change feed, per-file version history and diffs.
- Health score (A to F) from 8 lint rules: broken links and `@imports`, missing paths, secrets, oversized context, duplicate rules, stale plans, orphans, empty files.
- Secret scanner. Findings show at most the first 4 characters, and secrets are masked in MCP output, the audit log and notifications.
- Token estimates per file and per tool, shown against a context budget.

**Understand**
- Link graph of files, `@imports`, wiki links and path mentions, with several layouts (neural, force, orbit, radial, clusters, timeline, matrix) and path finding.
- Effective context: the merged instruction chain Claude, Codex or Cursor sees for a given directory, with token counts.
- Agents center: tool and capability matrix for 13 AI tools, rules that apply to a file, MCP servers, concurrent-edit radar, context time travel.
- Memory & plans: Claude's saved memory and plans for the project, with links between memories and warnings when a memory claims something the repo no longer has.
- One connected dashboard: pages grouped into Monitor, Analytics, Context, Agents and Project, a product map of how pages and data connect, and a details panel for any session, file, commit, task, tool or model.
- Project intelligence: stacks, dependencies and outdated packages, scripts, CI, Docker, env keys, Laravel routes/models/migrations, doc drift, code stats.
- Git: changes, history, branches, tags, stash, blame, stats, generated changelog.

**Plan and report**
- Tasks from Markdown (`- [ ]`, `- [/]`, `- [x]`, `TODO:`) as board, list, table, calendar and timeline, plus decision records (ADRs).
- Reports: KPIs, activity series, heatmap, top files (most changed, most linked, stalest, heaviest), export to CSV, Markdown or HTML.
- AI-ready report export: a compact context pack to paste into an assistant, and JSON with the schema `agentneuron.report/v1`.

**Act** (opt-in, see the [security model](#security-model))
- Edit files in the browser, rename with link rewriting, find and replace, soft delete to trash, one-click fixes for lint issues.
- Create files from templates (CLAUDE.md, AGENTS.md, GEMINI.md, skills, subagents, Cursor rules, Copilot instructions, ADRs and more).
- Sync instruction files between tools and see drift between them; edit Claude permissions, hooks and `.mcp.json`.
- [Rules compiler](docs/compiler.md): write each rule once in `.agentneuron/rules/` and compile it into CLAUDE.md, AGENTS.md, GEMINI.md, Cursor `.mdc`, Copilot and Windsurf rules (`agentneuron compile --check` for CI, merge-back of hand edits). [Generate](docs/generate.md) a cited starter AGENTS.md from the code.
- Git stage/commit/branch, package and script runner. Commands are spawned without a shell, stream live output and are written to an audit log.

**Integrate**
- [MCP server](docs/mcp.md) (`agentneuron mcp`) with 16 read-only tools, plus 4 opt-in coordination tools, so your AI agents can query the same data.
- HTTP + Server-Sent Events [API](docs/http-api.md).
- `agentneuron lint --json` for CI ([example workflow](examples/ci/)).
- Slack/Discord-compatible webhooks for secrets, conflicts, health drops and job results.
- Workspace mode: one UI for a folder of projects.

## Screenshots

| | |
|---|---|
| ![Live view: Claude, Codex and Cursor sessions in swimlanes with streaming file edits, line counts, a heat strip of touched files and a collision warning](https://raw.githubusercontent.com/TurjoAt/agentneuron/main/docs/assets/live.png) | ![Overview dashboard with KPIs, the animated Neuron brain orbit graph, live agents, truth and safety summary and context health](https://raw.githubusercontent.com/TurjoAt/agentneuron/main/docs/assets/overview.png) |
| **Live:** what each agent is editing right now | **Overview:** Neuron brain, live agents, health and tasks |
| ![Truth check listing false commands and paths in CLAUDE.md with the evidence and a one-click fix](https://raw.githubusercontent.com/TurjoAt/agentneuron/main/docs/assets/verify.png) | ![Insights: lessons mined from agent sessions as proposed rules with evidence quotes and confidence](https://raw.githubusercontent.com/TurjoAt/agentneuron/main/docs/assets/insights.png) |
| **Truth & safety:** instructions that are no longer true | **Insights:** rules learned from your sessions |
| ![Link graph of CLAUDE.md, skills, subagents and docs grouped by role in AgentNeuron's neural layout](https://raw.githubusercontent.com/TurjoAt/agentneuron/main/docs/assets/graph.png) | ![Tasks board built from Markdown checkboxes in TODO.md, with labels, due dates and links to the source line](https://raw.githubusercontent.com/TurjoAt/agentneuron/main/docs/assets/tasks.png) |
| **Graph:** how context files link to and import each other | **Tasks:** checkboxes and `TODO:` comments as a board, table, calendar or timeline |
| ![Reports page with KPIs, activity over time, heatmap and top files by changes, links and tokens](https://raw.githubusercontent.com/TurjoAt/agentneuron/main/docs/assets/reports.png) | ![Agents center with a matrix of AI coding tools against capabilities such as instructions, rules, MCP, hooks and skills](https://raw.githubusercontent.com/TurjoAt/agentneuron/main/docs/assets/agents.png) |
| **Reports:** activity, heatmap and exports | **Agents:** which tools are set up and what they can use |

## Quick start

Requires Node.js 18 or newer.

**Run without installing**

```sh
npx agentneuron                  # monitor the current directory
npx agentneuron ./my-project     # or any directory
```

Open the printed URL (default `http://127.0.0.1:4747`). Add `--open` to open the browser.

**Install globally**

```sh
npm i -g agentneuron
agentneuron ./my-project
```

**Per project, as one file you can commit or hand to a teammate**

```sh
cd my-project
npx agentneuron init                # creates .agentneuron/config.json and copies the bundle
node .agentneuron/agentneuron.mjs   # the project root is the parent of .agentneuron
```

`dist/agentneuron.mjs` is a single self-contained file (UI embedded, no dependencies). Copy it anywhere and run `node agentneuron.mjs /path/to/project`.

**Docker**

```sh
docker run --rm -it --user "$(id -u):$(id -g)" \
  -v "$PWD":/project -p 127.0.0.1:4747:4747 \
  ghcr.io/turjoat/agentneuron
```

Inside the container the server binds `0.0.0.0`, so an access token is generated and printed in the log; open the URL it shows. Add `:ro` to the volume for a strictly read-only mount. More in [examples/deploy/docker.md](examples/deploy/docker.md).

**Common commands**

```sh
agentneuron lint                 # print issues, exit 1 on any error (CI friendly)
agentneuron status               # files, tokens, health in a few lines
agentneuron workspace ~/code     # one UI for a folder of projects
agentneuron mcp                  # MCP server on stdio
agentneuron --enable edit        # allow editing files from the UI for this run
```

Full walkthrough: [docs/getting-started.md](docs/getting-started.md).

## Supported AI coding tools

| Tool | Files detected (examples) |
|---|---|
| Claude Code | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/agents/`, `.claude/skills/*/SKILL.md`, `.claude/commands/`, `.claude/rules/`, `.claude/settings*.json`, `.mcp.json` |
| OpenAI Codex | `AGENTS.md`, `AGENTS.override.md`, `.codex/` |
| Cursor | `.cursor/rules/*.mdc`, `.cursorrules`, `.cursor/mcp.json` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.github/prompts/`, `.github/chatmodes/` |
| Windsurf | `.windsurfrules`, `.windsurf/rules/`, `.windsurf/workflows/` |
| Gemini CLI | `GEMINI.md`, `.gemini/` |
| Cline, Roo Code, Aider, Continue, Zed, JetBrains Junie, Amazon Q Developer | shown in the Agents matrix and setup pages; see [supported tools](docs/supported-tools.md) |

Any other Markdown in the project (README, TODO, ROADMAP, ADRs, `docs/`) is tracked too. Add your own patterns with `extraPatterns`.

## Use it from your AI agent (MCP)

`agentneuron mcp` is a read-only MCP server on stdio. Its tools: `project_info`, `list_files`, `read_file`, `search`, `get_health`, `get_context`, `recent_changes`, `get_tasks`, `get_links`, `report_export`, `verify_context`, `audit_agent_config`, `suggest_rules`, `compile_preview`, `list_claims`, `get_handoffs`. With `--level state`, agents can also `claim_task`, `claim_files`, `release_files` and write a `handoff_note`. Full reference: [docs/mcp.md](docs/mcp.md).

**Claude Code** (CLI, or `.mcp.json` at the project root):

```sh
claude mcp add agentneuron -- npx -y agentneuron mcp
```

```json
{ "mcpServers": { "agentneuron": { "command": "npx", "args": ["-y", "agentneuron", "mcp"] } } }
```

**Cursor** (`.cursor/mcp.json`):

```json
{ "mcpServers": { "agentneuron": { "command": "npx", "args": ["-y", "agentneuron", "mcp", "."] } } }
```

**VS Code / GitHub Copilot** (`.vscode/mcp.json`):

```json
{ "servers": { "agentneuron": { "type": "stdio", "command": "npx", "args": ["-y", "agentneuron", "mcp", "${workspaceFolder}"] } } }
```

Other MCP clients (Codex, Windsurf, Gemini CLI, Zed, Continue) use the same command: `npx -y agentneuron mcp <dir>`.

## Security model

- Binds to `127.0.0.1` by default. A non-loopback `--host` forces a token (generated if you do not set one).
- Two roles: `admin` and read-only `viewer` (`--admin-token` plus `--token`). Viewers can never run actions.
- Starts read-only. Higher levels must be enabled in `.agentneuron/config.json` (`"actions"`) or with `--enable`:

| Level | Allows | Enabled by |
|---|---|---|
| `read` | Monitor, search, graph, health, git read | always |
| `state` | AgentNeuron's own data in `.agentneuron/`: task board, bookmarks, annotations, rescan | admin role |
| `edit` | Write project files, git stage/commit/branch, history and trash restore | `--enable edit` |
| `exec` | Run commands: package managers, scripts, git fetch/pull/push, MCP test; edit files that make agents run commands (Claude hooks and permissions, `.mcp.json`) | `--enable exec` |
| `danger` | Discard changes, delete branches, run migrations, clear history, purge trash | `--enable danger` |
| `terminal` | Free-form command runner (also requires `danger`) | `--enable terminal` |

- Commands are spawned without a shell, every parameter is validated, and file paths cannot leave the project.
- Every state-changing request and action is written to `.agentneuron/audit.jsonl` with secrets masked.
- Never expose `exec`, `danger` or `terminal` over plain HTTP.

Read [docs/permissions-and-security.md](docs/permissions-and-security.md) before binding to anything other than localhost. To report a vulnerability see [SECURITY.md](SECURITY.md).

## CLI

| Command | What it does |
|---|---|
| `agentneuron [start] [dir]` | Start the web UI for one project (default) |
| `agentneuron workspace [dir]` | One UI for a folder of projects |
| `agentneuron mcp [dir]` | Read-only MCP server on stdio |
| `agentneuron lint [--json] [dir]` | Print issues; exit 1 on errors |
| `agentneuron status [dir]` | Files, tokens and health summary |
| `agentneuron init [dir]` | Create `.agentneuron/` with config and a copy of the bundle |
| `agentneuron verify [dir]` | Truth check: false commands, paths and versions in context files |
| `agentneuron audit [dir]` | Security audit of MCP servers, permissions and hooks |
| `agentneuron ci [dir]` | Lint + verify + audit for pull requests (GitHub annotations) |
| `agentneuron lessons [dir]` | Rules to learn from your Claude/Codex sessions |
| `agentneuron compile [dir]` | Compile `.agentneuron/rules/` into every tool's files |
| `agentneuron generate [dir]` | Starter AGENTS.md/CLAUDE.md from the code, every line cited |
| `agentneuron export [dir]` | Report as an AI context pack, JSON, Markdown, CSV or HTML |
| `agentneuron doctor` / `update` | Check the setup / update to the latest release |

Every flag and exit code is in the [CLI reference](docs/cli.md).

## FAQ

### What files does AgentNeuron read?

Every file that matches a known AI-tool pattern (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules`, `.github/copilot-instructions.md`, `.windsurfrules`, skills, subagents, commands, MCP and settings files) plus all other Markdown in the project. It skips `.git`, `node_modules`, `vendor`, `dist`, `build` and similar folders. See [supported tools](docs/supported-tools.md).

### Does it send my code or files anywhere?

No. There is no telemetry. The only outbound requests are webhooks you configure, commands you run yourself through actions (such as `git fetch`), and the MCP server test.

### Does it use an AI model or cost tokens?

No. AgentNeuron does not call any model. Token counts are local estimates; session costs are estimated from your own Claude Code and Codex logs.

### Will it change my project?

Not by default. It writes only inside `.agentneuron/`. Editing files and running commands require you to enable a permission level.

### How do I lint CLAUDE.md or AGENTS.md in CI?

Use the GitHub Action (`uses: TurjoAt/agentneuron@v1.0.0`) or run `npx agentneuron ci`. It runs lint, the truth check and the security audit, annotates the pull request, and with `--base` reports only problems the change introduced. See [docs/ci.md](docs/ci.md) and [examples/ci](examples/ci/).

### How do I keep CLAUDE.md, AGENTS.md and Cursor rules in sync?

Write each rule once in `.agentneuron/rules/` and run `agentneuron compile`: it generates CLAUDE.md, AGENTS.md, GEMINI.md, Cursor, Copilot and Windsurf rules, keeps your hand-written text, and `--check` fails CI when they are out of date ([docs/compiler.md](docs/compiler.md)). To compare existing files instead, open **Agents > Sync & drift**. It compares the root instruction files of each tool pairwise and labels each pair `identical`, `linked`, `similar`, `drifted` or `diverged`. With `edit` enabled you can copy one file into the others, or replace them with a short file that `@imports` a single source.

### Can my AI agent use AgentNeuron?

Yes, through the MCP server (`agentneuron mcp`). An agent can ask for the effective context of a folder, broken links, false instructions, open tasks or lessons from past sessions, and (with `--level state`) claim files and leave handoff notes for other agents.

### Can I see what Claude Code or Codex is editing right now?

Yes. Open **Live**: AgentNeuron tails the Claude Code and Codex session transcripts for the project and shows each edit as it happens, checked against the file watcher, with diffs and collision warnings. Prompts are shown to admins only. See [docs/live.md](docs/live.md).

More answers: [docs/faq.md](docs/faq.md).

## How it compares

| | AgentNeuron | Generic Markdown linters | Per-tool rule sync scripts | Reading files by hand |
|---|---|---|---|---|
| Knows which files each AI tool loads | Yes, 13 tools | No | One or a few tools | You have to know |
| Effective context per folder, with tokens | Yes | No | No | Manual |
| Broken `@imports` and links | Yes | Links only | No | Manual |
| Secret detection in context files | Yes | No | No | Manual |
| Drift between tools' instruction files | Yes | No | Usually one-way copy | Manual |
| Live change feed and history | Yes | No | No | git log |
| MCP server for agents | Yes, read-only | No | No | No |
| Runs locally, no account | Yes | Yes | Yes | Yes |

The table compares categories of tools, not specific products. More detail: [docs/comparison.md](docs/comparison.md).

## Roadmap

- Ideas and requests are tracked in [GitHub issues](https://github.com/TurjoAt/agentneuron/issues). Released changes are in [CHANGELOG.md](CHANGELOG.md).

## Documentation

Start at [docs/README.md](docs/README.md): [getting started](docs/getting-started.md), [CLI](docs/cli.md), [configuration](docs/configuration.md), [permissions and security](docs/permissions-and-security.md), [HTTP API](docs/http-api.md), [actions](docs/actions.md), [MCP](docs/mcp.md), [supported tools](docs/supported-tools.md), [project intelligence](docs/project-intelligence.md), [architecture](docs/architecture.md), [FAQ](docs/faq.md), [troubleshooting](docs/troubleshooting.md).

Runnable [examples](examples/) cover a Claude Code project, a multi-tool project with drift, config variants, a CI workflow and deployment files.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

```sh
git clone https://github.com/TurjoAt/agentneuron.git
cd agentneuron
npm install
npm test                # node --test
npm run ui:dev          # UI dev server (Vite)
npm run dev             # run the CLI from source
npm run build           # build the UI and bundle dist/agentneuron.mjs
```

README screenshots are generated with `node scripts/screenshots.mjs` (usage is in the header of that file).

## License

[MIT](LICENSE) (c) Rezaul Hoque Turjo. Created and maintained by **Rezaul Hoque Turjo** ([turjo.me](https://turjo.me), [hi@turjo.me](mailto:hi@turjo.me)).
