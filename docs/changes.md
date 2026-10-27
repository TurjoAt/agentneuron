# Change review (`changes`)

Four tools for reviewing what an agent changed before you accept it. They live in the **Change review** view (tabs Review, Impact, Checkpoints, Packages), in the CLI and over MCP. Nothing here calls a model: every result comes from git, the files on disk and bundled rules.

| Feature | UI tab | CLI | MCP | HTTP |
|---|---|---|---|---|
| Review guardian | Review | `agentneuron review` | `review_changes` | `GET /api/changes/review` |
| Change impact | Impact | | `get_change_impact` | `GET /api/changes/impact` |
| Checkpoints and selective rollback | Checkpoints | `agentneuron checkpoint` | | `GET /api/changes/checkpoint*` + actions |
| Package hallucination guard | Packages | `agentneuron packages` | `check_package` | `GET /api/changes/packages`, `/api/changes/package` |

## Review guardian

Compares the working tree (tracked changes plus untracked files, ignored files excluded) with `HEAD`, or with `--base <ref>` / `?base=`. `base..head` ranges work too. Each file gets a risk (`high`, `medium`, `low`, `none`) and the reasons behind it, each with a line number where one applies:

| Code | Risk | What it flags |
|---|---|---|
| `removed-check` | high | A removed authentication, permission or authorization condition (moved lines are not counted) |
| `removed-validation` | medium | A removed validation, sanitizing, escaping or assertion call |
| `widened-permission` | high / medium | `chmod 777`, `AllowAny`, disabled TLS verification, `csrf_exempt`, `auth: false`; CORS `*` is medium |
| `secret-added` | high | A secret pattern in an added line (only the kind is reported, never the value) |
| `env-file` | high | An environment file in the change |
| `deleted-test`, `deleted-sensitive` | high | A deleted test file, or a deleted file in auth, permissions, payments or crypto code |
| `disabled-test`, `focused-test` | high / medium | `.skip`, `xit`, `@skip` added to a test; `.only`, `fit` left in |
| `risky-api`, `security-headers` | medium | `eval`, raw HTML, shell execution, raw SQL, unsafe deserialization; changed security headers or CSP |
| `generated-blob` | medium | Build output or a very large generated-looking addition |
| `area` | medium / low | Touches auth, permissions, payments, crypto, migrations, infra, dependencies or config |
| `missing-test`, `tests-not-updated` | low | Source changed but no related test exists, or none of its tests changed |
| `debug-code`, `large-change`, `lockfile`, `binary` | low | `debugger`, `dd()`, `var_dump()`, `pdb.set_trace()` in source, a big diff, moved dependency versions, a non-text file |

Files are grouped as feature, refactor, config, deps, tests or docs. **Read these first** lists up to eight files, highest risk first. Hunks carry their own risk, so the UI can point you to the part of a file that matters.

```sh
agentneuron review                   # human summary
agentneuron review --base main       # everything since main
agentneuron review --json            # { base, head, summary, groups, files, readFirst }
agentneuron review --fail-on high    # exit 1 if any file is high risk (use in CI)
```

Limits: 400 files, 160 KB of patch per file, 3 MB in total, 200 untracked files of up to 256 KB each. If a limit is hit, the result has `truncated: true`.

## Change impact

For each changed file, AgentNeuron extracts the changed functions, classes, methods and exports. These parsers are regex-based and cover JS/TS, PHP, Python and Go. It then follows the project's static imports to find what may be affected:

- **Importers**: files that import a changed file. Confidence is high when they use a changed symbol by name and medium otherwise. Importers of importers count at low confidence.
- **Callers**: files that mention a changed exported name without importing it (low).
- **Tests**: tests that import the changed code, or tests whose name matches it (medium).
- **Routes**: Express/Fastify-style, Flask/FastAPI decorators, Go handlers, Laravel route files and file-system routes (Next.js, SvelteKit) in a changed file (high) or its importers (medium).
- **Contracts**: OpenAPI/GraphQL/proto/JSON-schema files that changed or mention a changed name, and exported types.

The Impact tab shows the result as a layered graph (changed files, then symbols, then dependents, then routes/tests/contracts; hover a node to highlight its links). On narrow screens it becomes a list. Below it is the flat **Possibly affected** list with filters. You can also type file paths to analyse files that have not changed yet.

The analysis is static: dynamic imports, dependency injection and reflection are not followed, so treat "low" as "worth a glance". Limits: 5000 files scanned (256 KB each), 60 changed files, 150 graph nodes, 400 edges, 400 affected entries. The import graph is cached by file mtime and size.

## Checkpoints and selective rollback

A checkpoint is a snapshot of the whole working tree: tracked files with their uncommitted edits, plus untracked files. Ignored files, untracked files over 20 MB and AgentNeuron's own `.agentneuron/` directory are left out. Each checkpoint is stored as a commit object under `refs/agentneuron/checkpoints/<id>`. It is built with a temporary index (`GIT_INDEX_FILE`), so **creating a checkpoint never changes HEAD, the index, branches or any file**. The label, base commit, branch and source (`manual`, `auto`, `task`) are kept in the commit message.

**Restore is selective.** Pick files, look at the preview, confirm. Only the chosen paths are written, re-created or deleted to match the checkpoint. HEAD, the index, branches and every other file stay as they are. The current state is first saved as an automatic `auto` checkpoint, so a restore can itself be undone. Symlinks, submodules and paths outside the project are never restored.

| Action | Level |
|---|---|
| `changes.checkpoint.create` | `edit` |
| `changes.checkpoint.delete`, `changes.checkpoint.prune` | `edit` |
| `changes.checkpoint.restore` | `danger` (typed confirmation; `/api/actions/preview` returns the per-file plan) |

When a level is off, the Checkpoints tab shows the buttons disabled with the setting that enables them. Viewing a checkpoint's file diff needs the same permission as other diffs (`live.viewerDiffs` for viewers).

```sh
agentneuron checkpoint list
agentneuron checkpoint create --label "before refactor"
agentneuron checkpoint diff --id <id>                          # per-file status vs now
agentneuron checkpoint restore --id <id> --paths src/a.js,b.txt # preview only, exit 1
agentneuron checkpoint restore --id <id> --paths src/a.js --yes # restore
agentneuron checkpoint delete --id <id>
```

Checkpoints are local refs. `git push` does not send them unless you push `refs/agentneuron/*` explicitly. `git gc` keeps them, because they are referenced. Restoring only the hunks of one task (instead of whole files) is not supported yet.

## Package hallucination guard

Agents sometimes add dependencies that do not exist or that look like popular ones (`expresss`, `reqeusts`, `@type/node`). AgentNeuron reads `package.json`, `composer.json`, `pyproject.toml`, `requirements*.txt` and `Pipfile`, plus their lockfiles (npm, pnpm, yarn, composer, poetry, uv, Pipfile). It reports:

| Code | Severity | Meaning |
|---|---|---|
| `lookalike`, `scope-lookalike`, `suffix-clone` | high / medium | One or two letters away from a popular package, a misspelled scope, or `<popular>-js`-style clones |
| `not-in-lockfile` | medium | Declared in the manifest but missing from the lockfile |
| `url-dep`, `non-registry-source` | medium | Installed from a URL, git or a tarball instead of the registry |
| `unpinned`, `local-dep` | low | `*` / `latest` versions; `file:` / `link:` paths |
| `install-script` | low | A locked package runs install scripts |

**Offline by default.** Checks use a bundled list of popular packages per ecosystem (npm, PyPI, Packagist) and the project's own files. Registry and OSV lookups (existence, age, deprecation, maintainers, known advisories) happen only when you opt in:

```json
{ "packages": { "online": true } }
```

in `.agentneuron/config.json`. Even then, only admins trigger lookups in the UI and API. Each request times out after 5 s, at most 25 lookups run per scan, and results are cached for 24 h under `.agentneuron/cache/packages/`. The MCP tool `check_package` never goes online: it uses cached results when online mode is on. The CLI's `--online` flag enables lookups for that run.

```sh
agentneuron packages            # findings; exit 1 if any is high
agentneuron packages --json     # { online, deps, findings, lockfiles }
agentneuron packages --online   # also ask the registries for this run
```

The **Packages** tab has a single-package checker for use before installing. It returns a verdict (`ok`, `warn`, `block`, `unknown`) with its reasons.

## Privacy and safety

- GET endpoints and MCP tools only run read-only git commands and never use the network unless online package mode is configured.
- Everything returned is secret-masked. Review reasons never quote source lines, and a detected secret is reported by kind only.
- All work on request paths is bounded (file, byte, node and edge caps) and asynchronous.
