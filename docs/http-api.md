# HTTP API

AgentNeuron's UI is a thin client over this JSON API. It is stable enough for scripts but is not a versioned public contract; check the changelog when upgrading.

- Base URL: `http://127.0.0.1:4747` (or your host/port).
- All responses are JSON (`cache-control: no-store`) unless noted. Errors: `{ "error": "message" }` with a 4xx/5xx status.
- Paths are project-relative POSIX (`docs/a.md`). Absolute paths and `..` are rejected with `400`.
- `POST` bodies must be a JSON object sent as `application/json` (`415` otherwise, `400` for invalid JSON), at most 2 MB (`413`).
- Without a token configured, requests with a `Host` header that does not name this machine get `403 invalid host header` (DNS-rebinding guard).
- After 5 wrong tokens an address is blocked with `429` and `Retry-After`.
- Level = the minimum [permission level](permissions-and-security.md). `read` needs any valid token (or none when none is configured). `state` needs the admin role. `edit`, `exec`, `danger` need the admin role and the level enabled; otherwise `403`.

## Authentication

When a token is configured, send one of:

```sh
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4747/api/state
curl "http://127.0.0.1:4747/api/state?token=$TOKEN"       # works, but leaks into logs
```

or log in once and reuse the cookie:

```sh
curl -c jar -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\"}" http://127.0.0.1:4747/api/auth/login
curl -b jar http://127.0.0.1:4747/api/state
```

Writes (`POST`) with a cross-site `Sec-Fetch-Site` or an `Origin` that does not match `Host` are refused (`403`). Unauthenticated `/api/*` requests get `401` with `WWW-Authenticate: Bearer`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/auth/me` | `{ role, levels: { read, state, edit, exec, danger, terminal }, tokenRequired }`. `role` is `null` if not authenticated. |
| POST | `/api/auth/login` | Body `{ token }`. Returns `{ role, levels, tokenRequired }` and sets the session cookie. `401` bad token, `429` after 5 failures. |
| POST | `/api/auth/logout` | Clears the session. |

## Core (read)

| Method | Path | Parameters | Response |
|---|---|---|---|
| GET | `/api/state` | | `{ project: { root, name }, version, startedAt, counts: { files, tokens, byTool, byKind }, health: { score, grade, counts }, git: { available, branch, dirty }, allowWrite, actions }` |
| GET | `/api/files` | | Array of file entries: `path, name, dir, tool, kind, ext, size, mtime, hash, tokens, lines, title`, plus `gitStatus` when git is available |
| GET | `/api/file` | `path` | `{ entry, content, links: { out, in }, history, git: { log, status } }`; `404` if not tracked |
| GET | `/api/diff` | `path`, `from` (default `git:HEAD`), `to` (default `current`) | `{ path, from, to, hunks, added, removed }`. A ref is `current`, `git:<rev>` or a history id. |
| GET | `/api/history` | `path` | Stored versions of a file |
| GET | `/api/history/content` | `path`, `id` | `{ content }` |
| GET | `/api/events` | `since` (event id) | Recent change events with `id > since` |
| GET | `/api/graph` | | `{ nodes, edges }`; edge types `md-link`, `wiki`, `import`, `ref`, `mention`; `broken: true` when unresolved |
| GET | `/api/context` | `dir`, `tool` (default `claude`) | Effective context: `{ dir, tool, tokens, chain, text }` |
| GET | `/api/context/dirs` | | Directories that have their own context files |
| GET | `/api/context/at` | `ts` (required), `dir`, `tool` (`claude`, `codex`, `cursor`) | Context as it was at a time |
| GET | `/api/context/diff` | `from` (required), `to`, `dir`, `tool` | Context changes between two times |
| GET | `/api/health` | | `{ score, grade, counts, byRule, issues }` |
| GET | `/api/tasks` | | Tasks from Markdown: `{ path, line, text, done, section }` |
| GET | `/api/decisions` | | Decision records (ADRs, decision logs) |
| GET | `/api/git` | | `{ available, ...repoInfo }` |
| GET | `/api/config` | | MCP servers, hooks and permissions found in agent config files (secrets masked) |
| GET | `/api/sessions` | | Agent sessions (Claude Code, Codex) attributed to this project |
| GET | `/api/conflicts` | | Files edited by more than one agent in the last 2 minutes |
| GET | `/api/search` | `q` | Case-insensitive line search, max 200 hits: `{ path, line, text }` |
| GET | `/api/stream` | `since` | Server-Sent Events, see below |

## Files, links, fixes (editor backend)

| Method | Path | Level | Parameters | Notes |
|---|---|---|---|---|
| GET | `/api/file/raw` | read | `path` | Raw content and its `hash`. Only tracked project files can be read or written through the file routes (`403` otherwise). |
| POST | `/api/file/save` | edit | `{ path, content, baseHash }` | `baseHash` (from `/api/file/raw`) is required for existing files; `409` with `{ conflict: true, current, currentHash }` if the file changed on disk |
| POST | `/api/file/create` | edit | `{ path, content?, template?, vars? }` | Never overwrites |
| POST | `/api/file/rename` | edit | `{ from, to, rewriteLinks?, dryRun? }` | Rewrites links that point to the file |
| POST | `/api/file/delete` | edit | `{ path }` | Moves to `.agentneuron/trash` |
| GET | `/api/trash` | read | | Trashed files |
| POST | `/api/trash/restore` | edit | `{ id }` | |
| POST | `/api/trash/purge` | danger | `{ id }` | Permanent |
| GET | `/api/links/resolve` | read | `from`, `target` | Resolve a link target as the graph would |
| GET | `/api/backlinks` | read | `path` | Files linking to `path` |
| GET | `/api/replace/preview` | read | `q`, `replace`, `regex`, `case`, `word`, `paths` (comma list) | Matching lines |
| POST | `/api/replace/apply` | edit | same, in the body | |
| GET | `/api/fixes` | read | `issue` (issue id) | Suggested fixes for a lint issue |
| POST | `/api/fixes/apply` | edit | `{ issue, fix }` | |
| POST | `/api/restore` | edit | `{ path, id }` | Restore a stored version |
| GET | `/api/bookmarks` | read | | |
| POST | `/api/bookmarks` | state | `{ path, label? }` | |
| POST | `/api/bookmarks/remove` | state | `{ path }` | |
| GET | `/api/annotations` | read | `path` (optional) | |
| POST | `/api/annotations` | state | `{ path, line, text }` | |
| POST | `/api/annotations/remove` | state | `{ id }` | |
| POST | `/api/annotations/resolve` | state | `{ id, resolved? }` | |

## Task board

| Method | Path | Level | Body |
|---|---|---|---|
| GET | `/api/board` | read | Returns `{ columns, tasks, labels, assignees, mdWritable }` |
| POST | `/api/board/task` | state | `{ task, path? }`. Creating a task inside a Markdown file needs `edit`. |
| POST | `/api/board/update` | state | `{ id, patch }` |
| POST | `/api/board/move` | state | `{ id, status, order }` |
| POST | `/api/board/delete` | state | `{ id }` |
| POST | `/api/board/comment` | state | `{ id, text }` |
| POST | `/api/board/columns` | state | `{ columns }` |

Board edits are stored in `.agentneuron/board.json`. Changing a task that comes from a Markdown file also writes the checkbox, priority, labels or due date back into that file, but only if `edit` is enabled; otherwise only the board overlay changes.

## Git (read)

`GET /api/git/branches`, `/api/git/log` (`branch`, `path`, `author`, `since`, `until`, `limit`=100, `skip`), `/api/git/commit` (`hash`), `/api/git/changes`, `/api/git/diff` (`path`, `staged=1`), `/api/git/tags`, `/api/git/stash`, `/api/git/remotes`, `/api/git/blame` (`path`), `/api/git/stats` (`since`, `until`), `/api/changelog` (`from`, `to`=`HEAD`).

Writing to git is done through [actions](actions.md) (`git.commit`, `git.push`, ...).

## Agents center (read)

| Path | Parameters |
|---|---|
| `GET /api/agents/setup` | `global=1` include home config; `fresh=1` bypass the 3 s cache |
| `GET /api/agents/rules-for` | `path` : rules and instructions that apply to a file, per tool |
| `GET /api/agents/templates` | List of built-in templates |
| `GET /api/agents/template/render` | `id`, `vars` (JSON) |
| `GET /api/agents/sync/status` | Similarity and drift between tools' instruction files |
| `POST /api/agents/sync/plan` | `{ source, targets, mode }` : dry-run plan (no writes); apply with `agents.sync.apply` |
| `GET /api/agents/session` | `id` : timeline of one session |
| `GET /api/agents/costs` | `from`, `to` (ms epoch or date) : estimated cost |

## Project intelligence (read)

`GET /api/project` (`refresh=1`), `/api/project/stats`, `/api/project/deps` (`manager`), `/api/project/outdated`, `/api/project/routes`, `/api/project/migrations`, `/api/project/models` (Laravel), `/api/project/drift` (docs older than the code they mention). See [project intelligence](project-intelligence.md).

## Truth check and security audit

| Endpoint | Level | Notes |
|---|---|---|
| `GET /api/verify` | read | `status` (`ok`/`false`/`unknown`), `file`: `{ generatedAt, summary, claims }`. See [truth check](verify.md) |
| `POST /api/verify/fix` | edit | `{ id }` of a fixable claim: the replacement is recomputed server-side and written with history; `404` if not fixable any more, `409` if the file changed on disk |
| `GET /api/audit/config` | read | `{ generatedAt, score, level, counts, findings, scanned }`, values masked. See [security audit](audit.md). (`GET /api/audit` is the action audit log.) |

## Reports (read)

All accept `from` and `to` as epoch milliseconds (default: the last 7 days).

| Path | Parameters |
|---|---|
| `GET /api/reports/summary` | KPIs for the range and the previous range |
| `GET /api/reports/series` | `bucket` = `hour`, `day` (default), `week`; `metric` = `changes` (default), `lines`, `commits`, `agents`, `tokens`, `health`, `tasks`; `split` = `none`, `tool`, `kind`, `author`, `session` |
| `GET /api/reports/top` | `by` = `churn` (default), `links`, `stale`, `tokens` |
| `GET /api/reports/heatmap` | `days` (default 365) |
| `GET /api/reports/export` | `format` = `csv` (default), `md`, `html`, `json`, `ai` (alias `llm`); `include=content` (json, ai); returns a file download |

### Exports

The export is sent as an attachment named `agentneuron-report-<project>-<from>_<to>.<ext>` (project name lower-cased and reduced to `a-z0-9._-`; dates are UTC `YYYY-MM-DD`). The response also carries `x-agentneuron-tokens`, an estimate of the body's size in tokens.

| `format` | Content type | Extension | Contents |
|---|---|---|---|
| `csv` | `text/csv` | `csv` | One row per day: `date,changes,lines,commits,agent_edits` |
| `md` | `text/markdown` | `md` | KPI table with the previous period, top churned files, daily table |
| `html` | `text/html` | `html` | Standalone page (inline styles, no scripts) |
| `json` | `application/json` | `json` | The `agentneuron.report/v1` object below |
| `ai` / `llm` | `text/markdown` | `ai.md` | Context pack for pasting into an LLM (below) |

Every format is passed through secret masking, and absolute paths (project root, home directory) are replaced with `.` and `~`. Environment values, tokens and manifests are never included.

**`agentneuron.report/v1`** (keys in this order; times are ISO 8601 UTC):

```text
schema        "agentneuron.report/v1"
generatedAt   string
project       { name, stack: [{ id, version|null }] }
range         { from, to }
prevRange     { from, to }              previous period of the same length
kpis          { <key>: { value, previous, delta } } for changes, filesTouched, linesAdded,
              linesRemoved, commits, agentEdits, activeSessions, tokensNow, tokensDelta,
              healthNow, healthDelta, tasksOpened, tasksClosed (null when unknown)
series        [{ date, changes, lines, commits, agentEdits }]   one per UTC day
top           [{ path, changes, added, removed, lastChangedAt }] most churned, max 20
fileChanges   { added: [path], removed: [path] }               files created/deleted in range
health        { score, grade, counts: { error, warn, info } }
tasks         { open, done, items: [{ path, line, text, section }] }   open items, max 50
contextFiles  [{ path, tool, kind, tokens, updatedAt }]
issues        [{ rule, severity, path, line, message, hint }]   errors first, max 100
contents?     { budget, tokens, files: [{ path, tool, kind, tokens, truncated, content }], omitted: [path] }
              only with include=content
```

New fields may be added within `v1`; existing ones keep their meaning. A breaking change bumps the schema to `v2`.

**AI context pack** (`ai`): YAML front-matter (`schema`, `format`, `generatedAt`, `project`, `range`, `tokenEstimate`, `includesContent`), then a short summary, a KPI table with deltas, what changed (top churned, new and removed files), ranked health issues, open tasks, context budget per tool, and suggested next actions. With `include=content` it appends the main context files (kinds `context`, `rules`, `agent`, `skill`, `memory`, `command`, in that order), masked, capped at about 40k tokens in total and 12k per file, with `… [truncated: …]` markers; files past the budget are listed as omitted.

```sh
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:4747/api/reports/export?format=ai&include=content" > pack.md
```

## Workspace (read)

`GET /api/workspace` (`refresh=1`) lists projects under the workspace root; `GET /api/workspace/instances` lists instances started with `workspace.open`.

## Actions, jobs, settings

| Method | Path | Level | Description |
|---|---|---|---|
| GET | `/api/actions` | read | All actions: `id, title, category, level, description, params, enabled, reason` for your role |
| POST | `/api/actions/preview` | read | `{ id, params }` returns `{ command, summary, params }` without running anything |
| POST | `/api/actions/run` | by action | `{ id, params }` starts a job; returns the job summary. `403` if disabled |
| GET | `/api/jobs` | read | Latest 100 jobs |
| GET | `/api/job` | read | `id` : job summary plus `log` |
| POST | `/api/jobs/cancel` | state | `{ id }` |
| GET | `/api/audit` | state | `limit` (default 200, max 5000), newest first |
| GET | `/api/settings` | read | Permissions, roles, notification config (webhook URLs masked), data paths, version |

Job summary: `{ id, actionId, title, params, level, status, queuedAt, startedAt, endedAt, exitCode, result, error, command, by }`; `status` is `queued`, `running`, `ok`, `error` or `cancelled`. Parameters are masked in summaries.

```sh
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"id":"git.fetch","params":{}}' http://127.0.0.1:4747/api/actions/run
```

## Server-Sent Events: `/api/stream`

At most 100 streams are served at once (`503` beyond that). Reconnects replay missed file events when `Last-Event-ID` (or `?since=`) is given. A `ping` is sent every 20 seconds. Events:

| Event | Data |
|---|---|
| `event` | A file change: `{ id, type: add|change|unlink, path, ts, stats?, agent?, file? }` |
| `health` | `{ score, grade, counts }` after re-analysis |
| `graph` | `{ changed: true }` |
| `files` | `{ changed: true }` after a rescan |
| `conflict` | Array of active conflicts |
| `job` | Job summary on every state change |
| `joblog` | `{ id, stream, text }` live output (`stdout`, `stderr`, `info`) |
| `notify` | `{ type, title, body, level, ts, path? }` |
| `ping` | `{ ts }` |
