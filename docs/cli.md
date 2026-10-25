# CLI reference

```
agentneuron [start] [dir] [flags]
agentneuron workspace [dir] [flags]
agentneuron mcp [dir]
agentneuron lint [--json] [dir]
agentneuron status [dir]
agentneuron init [dir]
agentneuron export [dir] [--format ai|json|md|csv|html] [--range 7d] [--out file]
agentneuron doctor [dir] [--json] [--port n] [--host h]
agentneuron update [--check] [--yes]
agentneuron help [command] | <command> --help
agentneuron --version | --help
```

`dir` is the project root. If omitted: the parent folder when the script itself lives in a folder named `.agentneuron`, otherwise the current directory. A `dir` that is not a directory exits with code 2.

Flags may be written `--flag value` or `--flag=value`. `help` is also accepted as a command; `help <command>` or `<command> --help` prints the help for one command.

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

### `export [dir]`

Write an activity and health report built from the same data as the Reports view (`.agentneuron/events.jsonl`, `metrics.jsonl`, git history, the current analysis). No server is started and nothing is written to the project.

| Flag | Description |
|---|---|
| `--format <f>` | `ai` (default; compact text for pasting into an AI chat), `json`, `md`, `csv`, `html`. Anything else exits with code 2. |
| `--range <r>` | `24h`, `7d` (default), `2w`, `90d`, ... (at most 2000 days) or `all` (from the oldest recorded event). Malformed values exit with code 2. |
| `--out <file>` | Write to a file (relative to the current directory) instead of stdout. |

```sh
agentneuron export > context-report.txt
agentneuron export --format md --range 30d --out report.md
```

### `doctor [dir]`

Check the environment and print one line per check (`✓` ok, `!` warning, `✗` failure). Exit code `1` if any check fails.

```
agentneuron 0.3.0 doctor - /path/to/project
  ✓ node         Node 22.11.0 (requires >= 18)
  ✓ git          git version 2.43.0, project is a git repository
  ✓ config       .agentneuron/config.json is valid
  ! port         127.0.0.1:4747 is in use (start with --port <n>)
  ✓ permissions  read-only (no action levels enabled)
  ✓ data-dir     .agentneuron/ is writable
  ✓ ai-tools     detected: claude, codex, cursor

no problems found
```

Checks: Node version against `engines`, git on `PATH`, whether the port (`--port`/`--host` or config) can be bound, `config.json` validity, enabled action levels (a warning when risky levels come from the project file), write access to `.agentneuron/` (a probe file is created and removed; the folder is not created), and detected AI tool configs. `--json` prints `{ version, root, ok, checks: [{ id, status, message }] }`.

### `update`

Updates are only ever checked when you run this command; `start` never contacts the network.

- `--check`: compare the running version with `https://registry.npmjs.org/agentneuron/latest` (5 s timeout) and exit. Offline prints a short message and exits `1`.
- Without `--check`, the update depends on how this copy is installed:
  - **global npm install**: runs `npm install -g agentneuron@latest`.
  - **`init` copy** (`<project>/.agentneuron/agentneuron.mjs`): downloads `agentneuron.mjs` and `agentneuron.mjs.sha256` from the GitHub release `v<version>`, verifies the checksum, writes a temp file next to the copy and renames it over; the previous copy is kept as `agentneuron.mjs.bak`. A checksum mismatch changes nothing.
  - **npx or anything else**: prints the `npx agentneuron@latest ...` / `npm install -g` command to run.
- Asks for confirmation before replacing anything; `--yes` skips the prompt. Without a terminal and without `--yes` nothing is changed.

### `--version`, `--help`

Print the version or the usage text.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | `lint` found errors, `doctor` found a failure, `update` failed or was declined; or an unexpected runtime error |
| `2` | Bad usage: not a directory, invalid `--enable` level, bad `export` format or range |

## Environment

`AGENTNEURON_DEBUG=1` prints internal warnings (analysis, routes, file events) to stderr. There are no other environment variables.
