# Configuration

Configuration lives in `<project>/.agentneuron/config.json`. Create it with `agentneuron init` or by hand. Precedence, lowest to highest:

1. built-in defaults
2. `.agentneuron/config.json`
3. command-line flags (`--port`, `--host`, `--token`, `--admin-token`, `--enable`, `--write`, `--open`)

A missing, unreadable or invalid-JSON config file is silently ignored and defaults are used. If something seems not to apply, check the JSON with `node -e "JSON.parse(require('fs').readFileSync('.agentneuron/config.json','utf8'))"`. Unknown keys are ignored.

Restart AgentNeuron after editing; the file is read at startup.

> Config files containing tokens or webhook URLs are secrets. Keep `.agentneuron/config.json` out of git (or do not store tokens in it) and readable only by you: `chmod 600 .agentneuron/config.json`.

## Reference

| Key | Type | Default | Description |
|---|---|---|---|
| `port` | number | `4747` | Listen port. `0` = random. |
| `host` | string | `"127.0.0.1"` | Bind address. Non-loopback hosts require a token (auto-generated for the run if unset). |
| `token` | string or null | `null` | Access token. Alone: its holder is admin. With `adminToken`: read-only viewer. |
| `adminToken` | string or null | `null` | Admin token. When set, `token` becomes the viewer token. |
| `actions` | object | all `false` | Which action levels are enabled. See below. |
| `ignore` | string[] | `[]` | Extra paths or globs to skip. |
| `extraPatterns` | object[] | `[]` | Extra file patterns to track and classify; checked before the built-in catalogue. |
| `includeAllMarkdown` | boolean | `true` | Track every `.md`, `.mdc`, `.mdx`, `.markdown` file, not only known AI-tool files. |
| `maxFileSize` | number (bytes) | `1048576` | Larger files are not read. |
| `historyLimitPerFile` | number | `200` | Versions of each file kept in `.agentneuron/history`. |
| `openBrowser` | boolean | `false` | Open the browser at start (same as `--open`). |
| `notifications` | object | `{ "browser": true, "allowPrivate": false, "webhooks": [] }` | See below. |
| `pricing` | object | `{}` | Per-million-token price overrides for cost estimates. |
| `workspaceRoot` | string or null | parent of the project | Folder scanned for sibling projects. Set automatically by `agentneuron workspace`. |
| `includeGlobalAgents` | boolean | `false` | Also scan your home-level agent config (`~/.claude`, `~/.codex` and similar) in the Agents pages. Read-only. |
| `allowWrite` | boolean | `false` | Legacy alias for `actions.edit`. Prefer `actions`. |
| `debounceMs` | number | `150` | Milliseconds the file watcher waits to merge bursts of events for one file. Rarely needs changing. |
| `live` | object | see [Live view](live.md#configuration) | Live agent view: `enabled`, `showPrompts` (default: on for a loopback bind), `viewerPrompts`, `viewerDiffs`, `idleMs`, `endMs`, `collisionWindowMs`. |
| `usage` | object | `{ "scope": "project", "dailyBudgetUsd": null }` | [Usage analytics](usage.md): `scope` `"all"` lets admins read every project's sessions; `dailyBudgetUsd` sets the daily budget. See below. |
| `mcp` | object | `{ "level": "read" }` | `"level": "state"` enables the MCP [coordination](coordination.md) tools (same as `agentneuron mcp --level state`). |

### `actions`

```json
{ "actions": { "edit": false, "exec": false, "danger": false, "terminal": false } }
```

Only a literal `true` enables a level. `read` and `state` are not configurable: `read` is always on, `state` is available to the admin role. `terminal` also requires `danger`. See [permissions and security](permissions-and-security.md).

### `ignore`

Plain names match any path segment (`"legacy"` skips every folder or file named `legacy`). Entries with `/`, `*`, `?`, `{` or `[` are globs matched against the path and its parent folders.

```json
{ "ignore": ["legacy", "docs/generated", "**/*.generated.md", "packages/*/CHANGELOG.md"] }
```

Always ignored: `.git`, `node_modules`, `vendor`, `.agentneuron`, `.mdctl`, `dist`, `build`, `.next`, `storage`, `__MACOSX`, and `worktrees` under `.claude` or `.codex`.

### `extraPatterns`

Each entry: `glob` (required), `tool`, `kind`, `description`.

```json
{
  "extraPatterns": [
    { "glob": "prompts/**/*.txt", "tool": "generic", "kind": "doc", "description": "Prompt library" },
    { "glob": ".ai/rules.md", "tool": "claude", "kind": "rules", "description": "Shared team rules" }
  ]
}
```

`tool` is one of the ids in [supported tools](supported-tools.md) (or `generic`). `kind` is one of `context`, `rules`, `agent`, `skill`, `command`, `config`, `doc`, `readme`, `todo`, `plan`, `decision`, `changelog`, `memory`, `other`. With `includeAllMarkdown: false`, only files matching a pattern (yours or the built-in ones) are tracked.

### `notifications`

```json
{
  "notifications": {
    "browser": true,
    "webhooks": [
      { "url": "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX", "events": ["secret", "job-failed"] }
    ]
  }
}
```

- `browser`: show notifications in the UI (default `true`).
- `allowPrivate`: boolean, default `false`. Webhooks to loopback, private, link-local or cloud-metadata addresses are refused unless this is `true` (or the individual webhook sets `"allowPrivate": true`). Redirects are never followed.
- `webhooks[].url`: `http(s)` URL. Receives `POST` with JSON `{ "text", "content", "type", "title", "body", "level", "ts", "path"? }`. `text` makes it Slack-compatible and `content` Discord-compatible.
- `webhooks[].events`: optional filter. Omit or leave empty for all. Valid: `secret`, `conflict`, `health-drop`, `job-failed`, `job-done`.

Triggers: a new secret finding; two agents editing the same file within two minutes; a health score drop of 10 or more points; an action job finishing or failing. Webhook URLs are shown masked (`https://host/…`) in Settings and the API. A webhook URL is a credential; treat the file accordingly.

### `pricing`

Estimated cost uses built-in per-million-token USD prices per model family (`opus`, `opus-legacy`, `sonnet`, `haiku`, `gpt`, `other`). Override by family or by exact model id; any missing field falls back to the default.

```json
{ "pricing": { "sonnet": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }, "my-custom-model": { "input": 2, "output": 8 } } }
```

Treat results as estimates, not billing data.

### `usage`

```json
{ "usage": { "scope": "project", "dailyBudgetUsd": 20 } }
```

- `scope`: `"project"` (default) limits the [usage analytics](usage.md) to this project's sessions. `"all"` allows admins to request `scope=all`, which reads every directory under `~/.claude/projects` and every Codex session on the machine. Viewers always get the project scope.
- `dailyBudgetUsd`: a number, or `null` for no budget. The Usage view shows today's cost against it, and `budget.over` turns true once today's cost reaches it.

## Generated files in `.agentneuron/`

| Path | Content |
|---|---|
| `config.json` | This file |
| `agentneuron.mjs` | Optional single-file copy of AgentNeuron (`init`) |
| `history/` | Stored file versions |
| `cache/` | Cached results (for example outdated packages) |
| `trash/` | Files deleted from the UI, restorable |
| `board.json` | Task board overlay (columns, native tasks, comments) |
| `claims.json` | Advisory file claims of agent sessions ([coordination](coordination.md)) |
| `handoffs.jsonl` | Agent handoff notes; rotates at 5 MB |
| `events.jsonl`, `metrics.jsonl`, `audit.jsonl` | Change events, health snapshots, audit log. A file over 20 MB rotates; three old files are kept. |

Bookmarks and annotations are also stored here. The generated `.gitignore` excludes `history/`, `cache/`, `trash/` and `*.jsonl`. Commit `config.json` only if it holds no secrets.

See [examples/config](../examples/config/) for complete annotated variants.
