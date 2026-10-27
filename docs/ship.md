# Ship check

**Is the work verified, in scope and ready to deploy?** Ship check answers that from evidence: test/build/lint results, commits, changed files and a static scan of the repository. It never asks a model.

Open it in the dashboard (Quality > Ship check), from the terminal with `agentneuron ship`, or from an agent through the MCP tools `get_ship_report` and `get_task_scope`.

| Tab | What it shows |
|---|---|
| Report | Verdict with reasons, changed files with +/−, every detected check with its last result and a Run button, acceptance-criteria progress, failures with file:line |
| Scope | Every board task with acceptance criteria, each criterion's status and evidence, manual override |
| Readiness | Ready / not ready, findings grouped by category with why and fix |
| Placeholders | Code that only looks finished (empty handlers, mock auth, "coming soon" alerts...) |
| Runs | Stored check runs with parsed failures and the (admin-only) output |

## Verification

### Detected checks

| Source | Check ids |
|---|---|
| `package.json` scripts (npm, pnpm, yarn or bun from the lockfile) | `test`, `test:unit`, `test:ci` → test; `build` → build; `lint` → lint; `typecheck`, `type-check`, `types`, `tsc`, `check` → typecheck. Ids look like `pnpm:test` |
| `composer.json` scripts | same names, e.g. `composer:test` |
| PHPUnit without a composer `test` script | `artisan:test` (Laravel) or `phpunit:all` |
| Python with pytest | `pytest:all` (`python -m pytest -q -rfE`) |
| `go.mod` | `go:test`, `go:vet` |
| `Cargo.toml` | `cargo:test`, `cargo:build` |

Watch, dev, serve and start scripts are never treated as checks.

### Running checks

Running a command is an `exec`-level action, **off by default**:

- Dashboard: Report > Checks > Run (or Run all). It needs the admin role and `actions.exec` (`{"actions":{"exec":true}}` in `.agentneuron/config.json`, or `agentneuron start --enable exec`). When it is off the button is disabled and says how to enable it. Viewers can never run checks.
- Terminal: `agentneuron ship --run`. Your own shell, so no gate applies.

The action `ship.verify.run` takes `{ checks: [ids] }` (empty = all detected). Commands come only from the detected list (looked up by id), run without a shell with `CI=1`, `NO_COLOR=1` and a 15 minute timeout per check.

### Parsed results

Output is parsed for node:test / TAP and its spec reporter, Jest, Vitest, PHPUnit / Pest, pytest, `go test`, `cargo test`, and tsc / ESLint diagnostics. Anything else is judged by exit code. A run stores passed / failed / skipped counts, test names, and failures with `{ name, file, line, message }` (paths made project-relative).

Runs live in `.agentneuron/ship/runs/<id>.json` with a secret-masked, capped `<id>.log` (the last 200 runs are kept). Other features read them through `listRuns(root, { limit })` in `src/ship/runs.js`.

### Verdict

| Verdict | When |
|---|---|
| `failing` | The last run of any check failed, or a criterion has a failing test |
| `verified` | Every check's last run passed **after** the newest change, and every criterion is verified |
| `partial` | Some evidence passes, but checks never ran, ran before the latest change (stale), or criteria are untested/incomplete |
| `unverified` | No checks or criteria, or nothing has run yet |

Each verdict comes with its reasons ("pnpm run lint ran before the latest changes", "2 criteria have no test evidence", ...). The report compares the working tree with `HEAD` by default; pick another base (branch, tag, `HEAD~3`) to include committed work, and the commits in `base..HEAD` are listed as evidence.

## Acceptance criteria

Criteria are read from the task board, so there is nothing extra to maintain:

- Sub-items of a markdown task:

  ```md
  - [ ] Cursor pagination for GET /invoices
    - [x] Responses include a nextCursor
    - [ ] Page size capped at 100
  ```

- The checklist of a native board task.
- A `Criteria:` (or `Acceptance criteria:`, `Done when:`) list in a task description, one per line or separated by `;`.

Each criterion gets a status:

| Status | Rule |
|---|---|
| `failed` | A test whose name matches the criterion failed in the last run, or a file the criterion names is in a failure |
| `incomplete` | The item is not checked off |
| `verified` | A matching test passed in the last run of its check |
| `untested` | Checked off (or the task is done) but no matching passing test |

Evidence: tests from the last runs (matched by significant words of the criterion), files named in backticks or on the task, and commits whose message mentions the task id (or its exact title) and either match the criterion's words or touch its files.

**Manual override:** the admin can set a status by hand (action `ship.criterion.set`, level `state`; `auto` removes it). Overrides are stored in `.agentneuron/ship/criteria.json`:

```json
{ "version": 1, "overrides": { "<taskId>": { "<criterionId>": { "status": "verified", "note": "checked in staging", "at": 1793130000000 } } } }
```

A criterion id is derived from the task id and the criterion text, so editing the text resets its override.

## Production readiness

A static scan (nothing is run). Findings have `{ id, severity, category, title, why, fix, location: { path, line } }`; any `high` finding is a blocker and makes the project **not ready**.

| Category | Checks |
|---|---|
| Environment | Committed `.env` files; env vars used in code (`process.env`, `import.meta.env`, `env()`, `os.environ`, `getenv`, `os.Getenv`...) missing from `.env.example` and deploy config |
| Secrets | Keys and tokens in the repository (the shared secret scanner; only the kind and location are reported, never the value) |
| Debug & dev flags | `APP_DEBUG=true` in committed env files, Django `DEBUG = True`, Laravel `'debug' => true`, Flask `debug=True`, hard-coded `NODE_ENV`, auth-bypass flags |
| CORS | `Access-Control-Allow-Origin: *`, `origin: '*'`, `cors()` without options, allow-all settings |
| Default credentials | `password: 'admin'` and similar literals (never echoed) |
| Dependencies | No lockfile, lockfile not committed, lockfile missing dependencies from the manifest (npm, pnpm, yarn, composer) |
| Scripts / Build | Server app without a `start` script or deploy file; frontend tooling without a `build` script |
| Migrations | New migration files (deploy must run them); edited existing migrations |
| Release blockers | `TODO` / `FIXME` that says "before release / launch / deploy / prod" |

## Placeholder code

Static scan of app code for things that only look finished: empty or console-only event handlers, "coming soon"/TODO alerts, `throw new Error('not implemented')` (and `todo!()`, `panic("not implemented")`), requests to placeholder APIs (`example.com`, `jsonplaceholder`...), lorem ipsum, links and buttons to `#`, auth checks that always return true or compare passwords to literals, hard-coded `mock*`/`demo*` data, and `TODO: implement` comments.

Tests, mocks, fixtures, stories, seeds, examples and docs are skipped. Accept a finding with `ship-ignore` on the line or the line above; `ship-ignore-file` in the first five lines skips a file.

## Limits and safety

- GET routes and MCP tools never run project commands or touch the network. They only make read-only git queries (`ls-files`, `diff`, `log`) and bounded file reads.
- The scan uses git's file list (tracked plus untracked, not ignored) or a capped walk. It skips `node_modules`, `vendor`, `dist`, `build`, `.git` and other dependency/build folders, binaries, minified files and lockfiles. It reads at most 6000 files of up to 512 KB each (32 MB in total). Per-file results are cached by mtime and size.
- Everything returned is secret-masked. Run logs are admin-only.

## Interfaces

- HTTP: [`/api/ship/*`](http-api.md#ship-check)
- MCP: [`get_ship_report`, `get_task_scope`](mcp.md#tools)
- CLI: [`agentneuron ship`](cli.md#ship-dir)
