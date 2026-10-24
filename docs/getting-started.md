# Getting started

## Requirements

Node.js 18 or newer. Git is optional but unlocks the Git page, doc drift and the changelog generator.

## Run it

```sh
npx agentneuron                  # current directory
npx agentneuron ./my-project     # a specific directory
```

The banner shows the URL, number of tracked files, and which action levels are enabled:

```
  AgentNeuron 0.2.1  -  AI context control center
  project : /home/me/my-project
  files   : 42
  open    : http://127.0.0.1:4747/
  actions : read-only (enable with --enable edit,exec,...)
```

Add `--open` to open the browser automatically, `--port 0` to pick a random free port.

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

## What it scans

AgentNeuron walks the project and tracks every file matching a known AI-tool pattern ([supported tools](supported-tools.md)) plus all other Markdown (`includeAllMarkdown`, default on). It skips `.git`, `node_modules`, `vendor`, `dist`, `build`, `.next`, `storage`, `.agentneuron` and similar. Use `ignore` and `extraPatterns` in [configuration](configuration.md) to adjust.

It writes only inside `<project>/.agentneuron/` (history, cache, event and metric logs, audit log, board state, trash, config) unless you enable `edit` and use an action that edits project files.

## Tour of the pages

Keys `1` to `9` jump to the first nine pages; `/` focuses search; `?` lists shortcuts; the command palette lists everything else.

| Page | What you get |
|---|---|
| Overview | Health ring, token budget, files by tool, live change feed, git status |
| Graph | Link graph of files, `@imports`, wiki links and path mentions. Layouts, focus on a neighbourhood, find the path between two files |
| Files | Browse and read tracked files, links in and out, history, annotations, bookmarks. With `edit`: editor, create, rename (rewrites links), delete to trash, find and replace |
| Diff | Compare any two versions: stored history, `git:HEAD`, or the current file |
| Context | The effective context an agent gets for a directory and tool (`claude`, `codex`, `cursor`): the merged chain of files, total tokens, rendered text |
| Health | Score and grade, issues grouped by rule, with suggested fixes. With `edit`, apply a fix in one click |
| Tasks | Board, list, table, calendar and timeline built from Markdown checkboxes and `TODO:` comments, plus a Decisions tab for ADRs. Moving a card edits the Markdown only with `edit` |
| Git | Overview, changes, history, branches, tags, stash, remotes, blame, stats, generated changelog |
| Agents | Matrix of tools vs capabilities, per-tool setup, rules that apply to a file, templates, sync and drift between instruction files, MCP servers, sessions and cost, conflict radar, time travel |
| Project | Detected stacks, dependencies and outdated packages, scripts, CI, Docker, env keys, Laravel routes/models/migrations, doc drift, code statistics |
| Reports | KPIs, time series, heatmap, top tables, export to CSV, Markdown or HTML |
| Settings | Permissions (what is on and how to enable it), role and auth, audit log, notifications, trash, jobs, appearance, about |

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
- AI tools: `agentneuron mcp` gives Claude Code, Cursor and others read-only access to the same data. See [MCP](mcp.md).

## Next

[CLI reference](cli.md), [configuration](configuration.md), [examples](../examples/).
