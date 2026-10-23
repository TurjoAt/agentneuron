# mdctl

Live monitor for the markdown that steers your AI tools: `CLAUDE.md`, `AGENTS.md`, Cursor rules, Copilot instructions, skills, agents, plans, TODOs and docs. mdctl scans a project, watches it, builds a link graph, lints it, reads git, and serves a live web UI from a single file.

## Install / run

```sh
npx mdctl                 # monitor the current directory
npx mdctl ./my-project    # or any directory
```

Per-project single file (no npm needed afterwards):

```sh
npx mdctl init            # creates .mdctl/config.json and copies the bundle to .mdctl/mdctl.mjs
node .mdctl/mdctl.mjs     # root = parent of .mdctl, no argument needed
```

`mdctl` only ever writes inside `<project>/.mdctl/` (history, cache, config). Add `.mdctl/` to your own `.gitignore` if you do not want to commit the bundle.

## Commands

| Command | Description |
|---|---|
| `mdctl [start] [dir]` | Start the server and print the URL (with token if set). |
| `mdctl lint [--json] [dir]` | Print issues; exit code 1 if any error-level issue (CI friendly). |
| `mdctl status [dir]` | Short text summary: files, tokens, health. |
| `mdctl init [dir]` | Create `.mdctl/` with `config.json` and the bundle copy. |
| `--version`, `--help` | |

Start flags: `--port <n>` (default 4747, `0` = random), `--host <h>` (default `127.0.0.1`), `--token <t>`, `--open`, `--write` (enables history restore).

If `--host` is not loopback and no token is given, a random token is generated and shown in the banner. With a token, send `?token=<t>` or `Authorization: Bearer <t>`.

Configuration lives in `.mdctl/config.json`: `port`, `host`, `token`, `ignore`, `extraPatterns`, `includeAllMarkdown`, `maxFileSize`, `historyLimitPerFile`.

## HTTP API

All JSON, `GET` unless noted. Paths are project-relative POSIX.

- `/api/state` project summary, counts, health, git
- `/api/files` all tracked files (with `gitStatus`)
- `/api/file?path=` entry, content, links in/out, history, git log
- `/api/diff?path=&from=<historyId|git:HEAD>&to=<historyId|current>`
- `/api/history?path=`, `/api/history/content?path=&id=`
- `POST /api/restore` `{path,id}` (needs `--write`, otherwise 403)
- `/api/events?since=<id>` recent change events
- `/api/graph` nodes and edges
- `/api/context?dir=&tool=`, `/api/context/dirs` effective agent context
- `/api/health` score, grade, issues
- `/api/tasks`, `/api/decisions`
- `/api/git` repo info
- `/api/config` MCP servers, hooks, permissions found in agent config
- `/api/sessions`, `/api/conflicts` agent sessions and concurrent-edit radar
- `/api/search?q=` case-insensitive line search (max 200)
- `/api/stream` Server-Sent Events: `event`, `health`, `graph`, `conflict`, `ping`

## Develop

```sh
npm install
npm test            # node --test
npm run ui:dev      # UI dev server
npm run build       # vite build + esbuild -> dist/mdctl.mjs (use -- --strict to fail on UI build errors)
```

Requires Node >= 18.

## v0.2: control center, permissions and auth

Everything that changes something is **off by default**. mdctl starts read-only.

| Level | Meaning | Enabled by |
|---|---|---|
| `read` | monitor, search, graph, health | always |
| `state` | mdctl's own data in `.mdctl/` (board, bookmarks, annotations, rescan) | admin role |
| `edit` | write project files, git stage/commit, history restore | `actions.edit` |
| `exec` | run commands (packages, scripts, git fetch/pull/push, MCP test) | `actions.exec` |
| `danger` | discard, delete, migrate, clear history | `actions.danger` |
| `terminal` | free-form command runner (also needs `danger`) | `actions.terminal` |

Enable in `.mdctl/config.json`:

```json
{ "actions": { "edit": true, "exec": false, "danger": false, "terminal": false },
  "token": "viewer-or-only-token", "adminToken": null,
  "notifications": { "webhooks": [ { "url": "https://hooks.slack.com/...", "events": ["secret", "job-failed"] } ], "browser": true } }
```

or per run: `mdctl start --enable edit,exec` (`--write` = `--enable edit`).

**Roles / auth.** No token: everyone is admin (loopback only by default). Only `token`: its holder is admin.
With `adminToken` (or `--admin-token`): that token is admin and `token` is a read-only viewer.
The UI shows a login screen (`POST /api/auth/login` sets an HttpOnly `mdctl_session` cookie);
`?token=` and `Authorization: Bearer` keep working for scripts.

**Actions and jobs.** `GET /api/actions` lists actions with `enabled`/`reason`; `POST /api/actions/run` starts a job
(live output over SSE `job`/`joblog`, cancel via `POST /api/jobs/cancel`). Commands are spawned without a shell.
Every action run and every state/edit route call is appended to `.mdctl/audit.jsonl` (secrets masked).

**Persistence.** `.mdctl/events.jsonl` (all file events), `.mdctl/metrics.jsonl` (snapshot on start, hourly, on health change);
files over 20 MB rotate (3 kept).

**Notifications.** Secrets, conflicts, health drops of 10+ points and job results go to the UI (SSE `notify`) and to webhooks (Slack/Discord compatible).

**Other commands.** `mdctl mcp [dir]` runs the MCP server on stdio; `mdctl workspace [dir]` starts in workspace mode.
