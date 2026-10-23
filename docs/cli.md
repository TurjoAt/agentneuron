# CLI reference

```
agentneuron [start] [dir] [flags]
agentneuron workspace [dir] [flags]
agentneuron mcp [dir]
agentneuron lint [--json] [dir]
agentneuron status [dir]
agentneuron init [dir]
agentneuron --version | --help
```

`dir` is the project root. If omitted: the parent folder when the script itself lives in a folder named `.agentneuron`, otherwise the current directory. A `dir` that is not a directory exits with code 2.

Flags may be written `--flag value` or `--flag=value`. `help` is also accepted as a command.

## Commands

### `start` (default)

Start the server for one project and print the URL.

| Flag | Description |
|---|---|
| `--port`, `-p <n>` | Port. Default `4747`. `0` picks a random free port. |
| `--host <h>` | Bind address. Default `127.0.0.1`. A non-loopback host requires a token; one is generated and printed if you give none. |
| `--token <t>` | Require a token. With `--admin-token` it becomes the read-only viewer token. |
| `--admin-token <t>` | Admin token. Enables the two-role model. |
| `--enable <list>` | Comma list of `edit`, `exec`, `danger`, `terminal`. Unknown names exit with code 2. |
| `--write` | Alias for `--enable edit`. |
| `--open` | Open the browser (`xdg-open`, `open` or `start`). |

Flags override `.agentneuron/config.json`. `--enable` adds to levels already enabled in the file; it cannot turn a level off.

Stop with Ctrl+C (SIGINT/SIGTERM): running jobs are cancelled, connections closed.

```sh
agentneuron                                   # read-only on 127.0.0.1:4747
agentneuron ./app --port 5000 --open
agentneuron --enable edit,exec
agentneuron --host 0.0.0.0 --admin-token "$ADMIN" --token "$VIEWER"
```

Passing secrets on the command line exposes them to other users via `ps`. Prefer `token` and `adminToken` in `.agentneuron/config.json` (keep it out of git and readable only by you) on shared machines.

### `workspace [dir]`

Same flags as `start`. `dir` is a folder that holds several projects. The server exposes `/api/workspace` (projects found under `dir`, with detected stack and AI tools) and `/api/workspace/instances`, and the `workspace.open` action (level `exec`) can start another AgentNeuron instance for one of them on a random port.

### `mcp [dir]`

Run the MCP server on stdio (JSON-RPC, newline-delimited). Read-only. See [MCP](mcp.md). Takes no flags; stdout carries only protocol messages.

### `lint [--json] [dir]`

Analyse the project and print every issue. Exit code `1` if any issue has severity `error`, otherwise `0`.

Text output, one line per issue:

```
error src/CLAUDE.md:12  [broken-link] Link to "docs/old.md" does not resolve to an existing file
warn  TODO.md  [stale-plan] todo not modified for 41 days

17 files, 2 issues, score 87 (B)
```

With `--json`:

```json
{ "root": "/path", "files": 17, "health": { "score": 87, "grade": "B", "counts": { "error": 1, "warn": 1, "info": 0 }, "byRule": {} }, "issues": [ { "id": "...", "rule": "broken-link", "severity": "error", "path": "src/CLAUDE.md", "line": 12, "message": "...", "hint": "..." } ] }
```

Rules: `broken-link`, `missing-path`, `secret`, `large-context`, `duplicate-rule`, `stale-plan`, `orphan`, `empty-file`. See [project intelligence](project-intelligence.md#lint-rules).

### `status [dir]`

```
agentneuron status for /path/to/project
  files:  17  (claude:5 codex:1 generic:11)
  tokens: 9210
  health: 87/100 (B)  errors 1  warnings 1  info 0
  issues: 2
```

### `init [dir]`

Create `.agentneuron/` with `.gitignore` and `config.json` (`{ "port": 4747, "ignore": [], "extraPatterns": [], "includeAllMarkdown": true }`) if absent, and, when run from the bundled build, copy the bundle to `.agentneuron/agentneuron.mjs`. Running from source skips the copy and says so. Safe to run again; an existing `config.json` is left alone.

### `--version`, `--help`

Print the version or the usage text.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | `lint` found errors; or an unexpected runtime error |
| `2` | Bad usage: not a directory, invalid `--enable` level |

## Environment

`AGENTNEURON_DEBUG=1` prints internal warnings (analysis, routes, file events) to stderr. There are no other environment variables.
