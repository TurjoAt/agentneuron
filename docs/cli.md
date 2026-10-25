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
agentneuron lessons [dir] [--json] [--covered] [--all]
agentneuron update [--check] [--yes] [--allow-unverified]
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

### `lessons [dir]`

Mine this project's Claude Code and Codex sessions for lessons and print them as proposed rules. Lessons come from user corrections, reverted edits, commands that keep failing, and instructions repeated across sessions. Each one shows its confidence, the context file to add it to, and one evidence quote (secrets masked). The command is read-only. To accept or dismiss a lesson, use the Insights view. See [Insights](insights.md).

| Flag | Description |
|---|---|
| `--json` | Print `{ root, sessions, lessons: [...] }`. |
| `--covered` | Also list lessons that an existing rule already covers. |
| `--all` | Also list dismissed and accepted lessons. |

```
4 lesson(s) from 4 agent session(s):

  [0.62] Run the linter before you push changes.
         repeated · 2x in 2 session(s) · add to CLAUDE.md
         "Remember to run the linter before you push changes please" (claude sess-d)
  [0.60] Don't edit src/b.js.
         correction · 1x in 1 session(s) · add to AGENTS.md
         "stop, don't edit src/b.js" (codex codex-c)
```
### `compile [dir]`

Compile the source rules in `.agentneuron/rules/*.md` into `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/*.mdc`, Copilot instructions and Windsurf rules. Only the `agentneuron:begin/end` regions are rewritten. See [rules compiler](compiler.md).

| Flag | Description |
|---|---|
| `--dry-run` | Print each file that would change, with a diff; write nothing. |
| `--check` | Exit `1` if any output is stale, edited by hand, missing, or a rule is invalid. Never writes (for CI). |
| `--tools <list>` | Limit the run to `claude`, `codex`, `gemini`, `cursor`, `copilot`, `windsurf` (comma separated). |
| `--merge-back` | Pull edits made inside generated regions back into the source rules, then compile. |
| `--force` | Overwrite regions that were edited by hand. |
| `--json` | With `--check` or `--dry-run`: machine-readable plan. |

### `rules import|list [dir]`

`rules import` creates source rules from the existing context files. It writes one rule per `##` section or rule file, merges identical rules found in several tools, and never overwrites a rule file. `--dry-run` only prints what would be created. `rules list` prints the rules with their scope and tools (`--json` for machine-readable output).

### `generate [dir]`

Print a starter context file built from the code: commands, stack, layout and conventions, each line citing its source. `--tool agents|claude|gemini|copilot|cursor|windsurf` picks the format. `--out` alone writes the tool's default path, and `--out <file>` writes that file. An existing file is only replaced with `--force`. See [generate](generate.md).

### `doctor [dir]`

Check the environment and print one line per check (`✓` ok, `!` warning, `✗` failure). Exit code `1` if any check fails.

```
agentneuron 0.4.0 doctor - /path/to/project
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
  - **`init` copy** (`<project>/.agentneuron/agentneuron.mjs`): verifies the new bundle against two independent origins before touching anything:
    1. downloads `agentneuron.mjs` and `agentneuron.mjs.sha256` from the GitHub release `v<version>` and checks the sha256;
    2. fetches `https://registry.npmjs.org/agentneuron/<version>`, downloads `dist.tarball` (only accepted from `https://registry.npmjs.org`), checks it against the registry's `dist.integrity` (sha512), unpacks it in memory and requires `package/dist/agentneuron.mjs` to have exactly the same sha256 as the GitHub asset.

    Only then is a temp file written next to the copy and renamed over it; the previous copy is kept as `agentneuron.mjs.bak`. Any mismatch, malformed tarball or network/HTTP error changes nothing. Downloads are size-capped (50 MB bundle and tarball, 200 MB unpacked, 1 MB metadata) and time out after 60 s.
  - If npm does not have that version yet (HTTP 404, e.g. right after a release), the update is refused. `--allow-unverified` accepts the GitHub checksum alone in that one case and prints a warning; it never overrides a mismatch or any other error.
  - What this protects against: a tampered or corrupted file at one origin (a replaced GitHub release asset and checksum, a compromised CDN or mirror, a truncated download). An attacker has to change both the GitHub release and the npm publish consistently.
  - What it does not protect against: a compromise of the source repository or the release workflow (one CI job produces both artifacts), or someone holding both the GitHub and npm credentials. npm provenance/registry signatures are not checked. With `--allow-unverified` the check is single-origin.
  - Global npm installs are unchanged: they rely on npm's own integrity checks.
  - **npx or anything else**: prints the `npx agentneuron@latest ...` / `npm install -g` command to run.
- Asks for confirmation before replacing anything; `--yes` skips the prompt. Without a terminal and without `--yes` nothing is changed.

### `verify [dir]`

Truth check: extract commands, scripts, paths, versions, env vars and ports from context files and verify them against the repo. Exit `1` if any claim is false. `--all` also lists claims that are ok, `--fix-preview` prints the line edit of each suggested fix (nothing is written), `--json` prints `{ root, summary, claims, fixes? }`. See [truth check](verify.md).

### `audit [dir]`

Security audit of the project's agent config (MCP servers, permissions, bypass modes, hooks, file modes, secrets). Prints findings and a 0-100 risk score; exit `1` if any finding is high. `--json` prints `{ root, score, level, counts, findings, scanned }`. See [security audit](audit.md).

### `ci [dir]`

Lint + truth check + audit + context budget for CI. `--format github|markdown|json` (default `github` inside GitHub Actions, else `markdown`), `--fail-on error|warn|never` (default `error`), `--base <ref>` (only issues introduced since that revision), `--budget <tokens>` (default 20000). See [context CI](ci.md).

### `--version`, `--help`

Print the version or the usage text.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | `lint` found errors, `verify` found a false claim, `audit` found a high-severity issue, `ci` failed its `--fail-on` threshold, `doctor` found a failure, `update` failed or was declined; or an unexpected runtime error |
| `2` | Bad usage: not a directory, invalid `--enable` level, bad `export` format or range, bad `ci` flags or unusable `--base` |

## Environment

`AGENTNEURON_DEBUG=1` prints internal warnings (analysis, routes, file events) to stderr. There are no other environment variables.
