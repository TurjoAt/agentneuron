# Getting started

This guide takes you from zero to a running AgentNeuron dashboard for your project in about a minute, then tours each page. AgentNeuron is read-only until you enable more, so it is safe to try on any repository.

**In short:** `npx agentneuron` in your project folder, then open `http://127.0.0.1:4747`.

## Requirements

Node.js 18 or newer. Git is optional but unlocks the Git page, doc drift and the changelog generator.

## Run it

```sh
npx agentneuron                  # current directory
npx agentneuron ./my-project     # a specific directory
```

The banner shows the URL, number of tracked files, and which action levels are enabled:

```
  AgentNeuron 1.1.0  -  AI context control center
  project : /home/me/my-project
  files   : 42
  open    : http://127.0.0.1:4747/
  actions : read-only (enable with --enable edit,exec,...)
```

Add `--open` to open the browser automatically, `--port 0` to pick a random free port. If port 4747 is already taken, AgentNeuron uses the next free port and prints it (`--strict-port` turns that off). With `--host 0.0.0.0` the startup output also lists a `network` link for each of the machine's addresses, so you can open the dashboard from another device.

### Other ways to install

```sh
npm i -g agentneuron             # global command
agentneuron ./my-project
```

Per project, committed or shared as one file:

```sh
cd my-project
npx agentneuron init
node .agentneuron/agentneuron.mjs
```

`init` creates `.agentneuron/config.json` and `.agentneuron/.gitignore` (ignoring `history/`, `cache/`, and later `trash/` and `*.jsonl`), and copies the bundle to `.agentneuron/agentneuron.mjs`. The bundle needs only Node, no `node_modules`. When you run it from inside `.agentneuron/` the project root is the parent folder, so no argument is needed.

No install, no npm: take `dist/agentneuron.mjs` from a release or a build, and run `node agentneuron.mjs /path/to/project`.

With Docker (binds `0.0.0.0` inside the container, so a token is generated and printed in the log):

```sh
docker run --rm -it --user "$(id -u):$(id -g)" \
  -v "$PWD":/project -p 127.0.0.1:4747:4747 \
  ghcr.io/turjoat/agentneuron
```

See [examples/deploy/docker.md](../examples/deploy/docker.md) for read-only mounts, Compose and session data.

## What it scans

AgentNeuron walks the project and tracks every file matching a known AI-tool pattern ([supported tools](supported-tools.md)) plus all other Markdown (`includeAllMarkdown`, default on). It skips `.git`, `node_modules`, `vendor`, `dist`, `build`, `.next`, `storage`, `.agentneuron` and similar. Use `ignore` and `extraPatterns` in [configuration](configuration.md) to adjust.

It writes only inside `<project>/.agentneuron/` (history, cache, event and metric logs, audit log, board state, trash, config) unless you enable `edit` and use an action that edits project files.

## Tour of the pages

The sidebar groups the pages into **Monitor**, **Analytics**, **Context**, **Agents** and **Project** (click a group heading to collapse it). On a phone the bottom bar shows Overview, Live, Sessions and Usage; **More** opens every page, grouped the same way. Each page shows a strip of related pages under the top bar, and the **product map** (`m`, or the map button in the top bar) shows every page and how sessions, files, commits, tasks, tools and memory connect.

Click any session, file, commit, task, tool or model name to open its **details panel**: stats, related sessions, files, commits and tasks (click those to keep exploring, `Backspace` goes back) and buttons to the pages that show it. `Ctrl`/`Cmd`-click goes straight to its page.

Keyboard: `1` Overview, `2` Live, `3` Sessions, `4` Graph, `5` Usage & cost, `6` Insights, `7` Reports, `8` Files, `9` Diff, `0` Settings; `/` or `Ctrl`/`Cmd`+`K` opens the command palette (pages, files, sessions, tools, actions); `m` opens the product map; `?` lists every shortcut.

| Group | Page | What you get |
|---|---|---|
| Monitor | Overview | Health ring, token budget, files by tool, live agents, usage and truth teasers, live change feed, tasks, git status |
| Monitor | Live | What each agent is editing right now, one lane per agent, with collision warnings |
| Monitor | Sessions | Every Claude Code and Codex session with a step-by-step replay |
| Monitor | Graph | Link graph of files, `@imports`, wiki links and path mentions. Layouts, focus on a neighbourhood, find the path between two files |
| Analytics | Usage & cost | Tokens, cost, cache, tools, prompts, agent fleet, code impact and an activity calendar |
| Analytics | Insights | Lessons from your sessions, cost by feature, rule effects |
| Analytics | Reports | KPIs, time series, heatmap, top tables, export to CSV, Markdown or HTML; an AI context pack and JSON export with a "Copy for AI" button |
| Context | Files | Browse and read tracked files, links in and out, history, annotations, bookmarks. With `edit`: editor, create, rename (rewrites links), delete to trash, find and replace |
| Context | Diff | Compare any two versions: stored history, `git:HEAD`, or the current file |
| Context | Context | The effective context an agent gets for a directory and tool (`claude`, `codex`, `cursor`): the merged chain of files, total tokens, rendered text |
| Context | Memory & plans | Claude's saved memory (with links between memories and stale-claim warnings) and plans |
| Context | Health | Score and grade, issues grouped by rule, with suggested fixes. With `edit`, apply a fix in one click |
| Context | Truth & safety | False instructions in context files, a security audit of agent config, and an audit of agent settings (permission modes, MCP servers needing auth) |
| Context | Rules studio | Write, compile and sync rules across tools |
| Agents | Agents | Matrix of tools vs capabilities, per-tool setup, rules that apply to a file, templates, sync and drift between instruction files, MCP servers, conflict radar, time travel |
| Agents | Tasks | Board, list, table, calendar and timeline built from Markdown checkboxes and `TODO:` comments, plus a Decisions tab for ADRs. Moving a card edits the Markdown only with `edit` |
| Project | Git | Overview, changes, history, branches, tags, stash, remotes, blame, stats, generated changelog |
| Project | Project | Detected stacks, dependencies and outdated packages, scripts, CI, Docker, env keys, Laravel routes/models/migrations, doc drift, code statistics |
| | Settings | Permissions (what is on and how to enable it), role and auth, audit log, notifications, trash, jobs, appearance, about |

Sessions and cost read Claude Code and Codex transcripts from `~/.claude/projects` and `~/.codex/sessions`. Cost is an estimate from token counts; override prices with the `pricing` key.

## Enable actions safely

Everything beyond read is off. Start with the lowest level you need:

1. Try it for one run: `npx agentneuron --enable edit`. Nothing is saved to config.
2. Make it permanent for this project: edit `.agentneuron/config.json`:
   ```json
   { "actions": { "edit": true } }
   ```
3. Add `exec` only if you want to run package managers, scripts, `git push` and so on from the UI.
4. Leave `danger` and `terminal` off unless you have a specific need and trust everyone who can reach the server.
5. If anyone but you can reach the port, set tokens first: `--admin-token <admin> --token <viewer>`. Viewers can never run actions, whatever is enabled.

Every action previews the exact command (when it runs one) before you confirm, shows live output as a job, and is recorded in `.agentneuron/audit.jsonl`. Details: [permissions and security](permissions-and-security.md).

## Using it with CI and AI tools

- CI: `npx agentneuron lint --json` exits 1 on any error-level issue. See [examples/ci](../examples/ci/).
- AI tools: `agentneuron mcp` gives Claude Code, Cursor, VS Code and others read-only access to the same data. Quickest setup for Claude Code: `claude mcp add agentneuron -- npx -y agentneuron mcp`. See [MCP](mcp.md).

## Next

[CLI reference](cli.md), [configuration](configuration.md), [examples](../examples/).
