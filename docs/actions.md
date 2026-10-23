# Actions

Actions are the operations AgentNeuron can perform for you. Each has an id, a [level](permissions-and-security.md#permission-levels), a parameter schema, and runs as a **job** with live output. List what is available on your server (including disabled ones with the reason):

```sh
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4747/api/actions
```

Preview what will run (nothing is executed):

```sh
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"id":"git.commit","params":{"message":"docs: update CLAUDE.md"}}' \
  http://127.0.0.1:4747/api/actions/preview
```

Run it:

```sh
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"id":"git.commit","params":{"message":"docs: update CLAUDE.md"}}' \
  http://127.0.0.1:4747/api/actions/run
```

Rules that apply to all actions:

- Requires the admin role and the action's level enabled; otherwise `403` with the setting to change.
- File paths must be project-relative, cannot contain `..`, cannot pass through symlinks that leave the project, and cannot point into `.git`, `.agentneuron` or `node_modules`. Only tracked file types (Markdown and agent config) can be written.
- Parameters are validated; unknown keys are dropped. Types: `string`, `text`, `number`, `boolean`, `enum`, `path` (project-relative), `string[]`.
- Commands are spawned directly (no shell) inside the project; at most 3 jobs run at once and two jobs of the same category do not run together.
- Actions marked "if available" only appear when relevant (a git repo, a `package.json`, an `artisan` file...).
- Every run and its outcome is written to the audit log.

`R` = required parameter.

## `state` (admin, always available)

| Id | Description | Params |
|---|---|---|
| `agentneuron.rescan` | Re-read all tracked files and recompute analysis | |
| `agentneuron.snapshot` | Append a metrics snapshot to `.agentneuron/metrics.jsonl` | |

## `edit` (needs `actions.edit`)

| Id | Description | Params |
|---|---|---|
| `files.create` | Create a file, optionally from a template. Never overwrites | `path`, `template`, `content`, `vars` (JSON text) |
| `files.rename` | Rename or move a file and rewrite links to it | `from` R, `to` R, `rewriteLinks` (default true), `dryRun` |
| `files.delete` | Move a file to `.agentneuron/trash` | `path` R |
| `files.replace` | Find and replace across tracked Markdown | `q` R, `replace`, `regex`, `caseSensitive`, `word`, `paths[]` |
| `tasks.export` | Write native board tasks to a Markdown file | `path` (default `TASKS.md`) |
| `agents.create` | Create a CLAUDE.md, skill, subagent, rule, ADR... from a template | `template` R, `vars` (JSON), `path` |
| `agents.sync.apply` | Copy one instruction file into other tools' files | `source` R, `targets[]` R, `mode` = `copy` or `import` |
| `agents.mcp.remove` | Remove a server from `.mcp.json` | `name` R |
| `git.stage` / `git.unstage` | `git add` / remove from the index | `paths[]` R |
| `git.commit` | Commit staged changes | `message`, `amend` |
| `git.branch.create` | Create a branch and switch to it | `name` R, `from` |
| `git.branch.switch` | Switch to an existing branch | `name` R |
| `git.stash.push` | Stash working changes | `message` |
| `git.stash.pop` | Apply and drop a stash entry | `index` (default 0) |
| `git.tag.create` | Create an annotated tag at HEAD | `name` R, `message` |
| `git.changelog.write` | Prepend a conventional-commits section to `CHANGELOG.md` | `from`, `to` (default `HEAD`) |


## `exec` (needs `actions.exec`)

| Id | Description | Params |
|---|---|---|
| `git.fetch` | Fetch (default: all remotes) | `remote` |
| `git.pull` | Pull, fast-forward only | |
| `git.push` | Push the current branch | `setUpstream` |
| `packages.install` | Install all dependencies | `manager` R |
| `packages.add` | Add a dependency | `manager` R, `name` R, `version`, `dev` |
| `packages.remove` | Remove a dependency | `manager` R, `name` R |
| `packages.update` | Update one package or all | `manager` R, `name` |
| `packages.outdated` | List outdated dependencies (cached for the Project page) | `manager` R |
| `packages.audit` | Dependency vulnerability audit | `manager` R |
| `scripts.run` | Run a script defined in `package.json` or `composer.json` (must exist) | `manager` R (`npm`, `pnpm`, `yarn`, `bun`, `composer`), `name` R |
| `framework.artisan` | Run an allow-listed Laravel command (if `artisan` and `php` exist) | `command` R: `about`, `route:list`, `migrate:status`, `cache:clear`, `config:clear`, `view:clear`, `route:clear`, `optimize:clear`, `queue:failed`, `schedule:list` |
| `agents.mcp.test` | Start a server from `.mcp.json`, run `initialize` + `tools/list` (15 s), then stop it | `name` R |
| `workspace.open` | Start another AgentNeuron instance for a project inside the workspace root | `path` R |
| `agents.permissions.update` | Replace `permissions.allow/deny/ask` in Claude settings, keeping other keys | `file` R (`.claude/settings.json` or `.claude/settings.local.json`), `allow[]`, `deny[]`, `ask[]` |
| `agents.hooks.update` | Replace the `hooks` block in Claude settings (validated) | `file` R, `hooks` R (JSON object keyed by event) |
| `agents.mcp.add` | Add a server to `.mcp.json` | `name` R, `type` R (`stdio`, `http`, `sse`), `command`, `args[]`, `url` |

`manager` is one of `npm`, `pnpm`, `yarn`, `bun`, `composer`, `pip`, `poetry`. Package names and versions must match strict patterns for the chosen manager, and the project must have the matching manifest. Install scripts of the packages you add run with your privileges, as with any package manager.

Hooks, Claude permission rules and adding MCP servers are `exec`, not `edit`, because they decide which commands agent tools will run on your machine. (`agents.mcp.remove` is `edit`: it only removes an entry.) For the same reason, saving or creating any of these files through the editor or other file routes also needs `exec`: `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, `.cursor/mcp.json`, `.codex/config.toml`, `.gemini/settings.json`.

Hook event names accepted by `agents.hooks.update`: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart`, `SessionEnd`.

`agents.mcp.test` launches whatever command `.mcp.json` declares (with `AGENTNEURON_*` variables removed from its environment). HTTP servers are contacted without following redirects, and link-local/metadata addresses are refused. Review that file first.

## `danger` (needs `actions.danger`)

| Id | Description | Params |
|---|---|---|
| `git.discard` | Discard unstaged changes and delete untracked files at the paths. Irreversible | `paths[]` R |
| `git.branch.delete` | Delete a local branch | `name` R, `force` |
| `git.stash.drop` | Drop a stash entry | `index` R |
| `framework.artisan.migrate` | `php artisan migrate --force` (changes the database) | `pretend` (dry run) |
| `agentneuron.history.clear` | Delete all stored file versions in `.agentneuron/history` | |

Purging the trash is a danger-level API route (`POST /api/trash/purge`), not an action.

## `terminal` (needs `actions.terminal` and `actions.danger`)

| Id | Description | Params |
|---|---|---|
| `agentneuron.terminal` | Run a command line. Words are split with shell-style quoting but there is **no shell**: no pipes, redirects, globbing, `&&` or variables. 5 minute timeout | `command` R (max 4000 chars), `cwd` (default `.`) |

This runs any program the server's user can run. Enable it only for a single trusted admin.

## Jobs

`POST /api/actions/run` returns immediately with a job. Follow it:

- `GET /api/job?id=<id>` : status and the log so far.
- SSE `job` and `joblog` events on `/api/stream` for live updates.
- `POST /api/jobs/cancel` `{ "id": "..." }` : sends SIGTERM, then SIGKILL after 3 seconds.

The last 100 jobs are kept in memory; they are not persisted across restarts, but the audit log is.
