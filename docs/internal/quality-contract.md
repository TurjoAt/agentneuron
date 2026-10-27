# Quality round contract (verify, change safety, agent brief)

Internal contract for three parallel agents. Each agent owns one vertical slice (backend, routes, actions, CLI, MCP, UI, mocks, tests, docs).
Shared files are scaffolded on `main` and **must not be edited by agents** except where noted:
`src/server/routes/index.js`, `src/actions/index.js`, `src/mcp/server.js`, `test/mcp-server.test.js`, `src/cli.js`, `ui/src/lib/nav.js`, `ui/src/App.svelte`, `ui/src/mock.js`.
If a shared file really needs a change, describe it in your final report instead.

## Global rules (all agents)

- AgentNeuron never calls a model. "Compare to requirements" means explicit acceptance criteria + evidence (tests, commits, files, job results), never an LLM judgement.
- **GET routes and MCP read tools never spawn processes and never touch the network.** Running tests/builds/commands only through the actions registry (`src/actions/registry.js`, job runner) at level `exec`; it is off by default and the UI shows `howToEnable(level)`. Viewers can never trigger it.
- **No outbound network by default.** Anything online is behind an explicit config flag, admin-only, cached on disk, with a timeout.
- **Git writes** only via `src/git2/run.js` helpers; never change HEAD, the index, branches or unrelated files unless the action is explicitly that (and then level `danger` with a preview).
- Session-derived text (prompts, replies, summaries of what the user asked) uses only the keys `prompt`, `title`, `quote`, `lastPrompt`, `thinking`, `body` so `redactPrompts` (`src/live/coord.js`) strips it for viewers. Routes: `liveAccess(ctx.config).prompts(role) ? out : redactPrompts(out)`. One viewer-token test per route that returns session-derived text.
- Everything returned passes `maskDeep` / `maskSecretsInText`. Secrets are never echoed, only their location and kind.
- Async I/O on request paths; bounded file reads (`readRegularAsync` in safeio); caches keyed by mtime+size. A request must not walk the whole repo synchronously.
- Node >= 18 APIs only (no `toSorted`, `Object.groupBy`, `import.meta.dirname`).
- Tests with `node --test` for every feature (temp dirs/repos, never this machine's data). Full suite (`npm test`) and `npm run build` (strict) pass before you report.
- UI: Svelte 5 runes, existing primitives (`Tabs`, `Empty`, `resource`, `api`, `EntityLink`, `viz/*`, `app.css` tokens), skeletons while loading, empty states that say what to do, works at 360px width, light + dark. Mock data is synthetic.
- Docs: one user doc per slice (`docs/ship.md`, `docs/changes.md`, `docs/brief.md`), plus rows in `docs/cli.md`, `docs/mcp.md`, `docs/http-api.md`. No README/CHANGELOG edits (the lead does those).
- Commit on your branch with Conventional Commits ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, never bump the version.

## Cross-slice functions (stable signatures, stubs exist)

| Function | Owner | Used by |
|---|---|---|
| `listRuns(root, { limit }) -> [{ id, kind: 'test'\|'build'\|'lint'\|'typecheck', command, startedAt, endedAt, exitCode, passed, failed, skipped, failures: [{ name, file, message }] }]` in `src/ship/runs.js` | A | C (resume, debug) |
| `listCheckpoints(root, { limit }) -> [{ id, ref, label, createdAt, base /* HEAD hash */, files: [path], source: 'manual'\|'auto'\|'task', task /* id or null */, session /* id or null */ }]` in `src/changes/checkpoints.js` | B | C (resume) |
| `taskScope(root, taskId) -> { task, criteria: [...], summary }` in `src/ship/scope.js` | A | C (resume, pack) |

Until the owner lands, the stub returns `[]` / `null`. Callers must cope with empty.

---

## Slice A: Ship check (`ship`)  owner: agent A

Features: **#1 Verification engine**, **#12 Task completion & scope tracker**, **#2 Production readiness scanner**, **#15 Fake functionality detector**.

Code: `src/ship/*`, `src/server/routes/ship.js`, `src/actions/ship.js`, `src/commands/ship.js`, `src/ship/mcp.js`, `ui/src/views/Ship.svelte`, `ui/src/views/ship/*`, `ui/src/mock-ship.js`, `test/ship*.test.js`, `docs/ship.md`.
May extend: `src/board/*` (acceptance criteria on tasks), `src/project/*` read helpers.

- **Verification (#1)**: detect how to check the project (package scripts `test`/`build`/`lint`/`typecheck`, `composer test`, `pytest`, `go test`, `cargo test` ...). Action `ship.verify.run` (level `exec`, params `{ checks: string[] }`) runs them via the job runner, parses results (node:test/TAP, Jest/Vitest summary, PHPUnit, pytest, generic exit code), stores runs under `.agentneuron/ship/runs/`. A **completion report** combines: changed files since a base (git), which criteria have evidence, last run per check, failures with file/line, and a verdict `verified | partial | failing | unverified`.
- **Scope tracker (#12)**: acceptance criteria per board task (`- [ ]` sub-items or a `criteria:` list; you decide the storage, document it). Each criterion gets `status: 'verified'|'incomplete'|'untested'|'failed'` with evidence links (commits mentioning the task id, files, test names matched to the criterion, run results). Manual override at level `state`.
- **Readiness (#2)**: static checks: env vars used in code vs `.env.example`/deploy config, `.env` committed, debug/dev flags (`APP_DEBUG=true`, `NODE_ENV` hard-coded, auth bypass), secrets in tracked files (reuse `src/health/secrets.js`), pending migrations (reuse `src/project/laravel.js` / migrations), lockfile present and in sync, build output configured, missing `start` script, CORS `*`, default credentials, known release blockers (TODO/FIXME with "before release"). Each finding `{ id, severity, category, title, why, fix, location: { path, line } }`; overall `ready: bool`, `blockers`.
- **Fake functionality (#15)**: static scan for placeholder handlers (`onClick={() => {}}`, `alert('TODO')`, `console.log` only handlers), hard-coded demo data in non-test code, mock auth (`return true` in auth checks, `password === 'admin'`), unimplemented API calls (`fetch('/api/todo')`, `throw new Error('not implemented')`), lorem ipsum, `href="#"` buttons. Same finding shape, `category: 'placeholder'`.

Routes (GET `read` unless noted):
- `/api/ship/summary` -> `{ generatedAt, verdict, readiness: { ready, blockers, counts }, placeholders: { count }, lastRuns: [run], scope: { tasks, criteria, verified, incomplete, untested, failed } }`
- `/api/ship/checks` -> `{ checks: [{ id, kind, command, source /* e.g. package.json#scripts.test */ }] }`
- `/api/ship/runs` -> `{ runs: [run] }`; `/api/ship/run?id=` -> run + `log` (masked, capped)
- `/api/ship/report?base=` -> completion report `{ base, head, changedFiles: [{ path, added, removed }], verdict, checks: [...], criteria: [...], failures: [...], evidence: [...] }`
- `/api/ship/scope` -> `{ tasks: [{ id, title, status, criteria: [{ id, text, status, evidence: [{ kind: 'commit'|'file'|'test'|'run'|'manual', ref, label }] }] }] }`
- `/api/ship/readiness` -> `{ ready, blockers, findings: [...] }`
- `/api/ship/placeholders` -> `{ findings: [...] }`
- Actions: `ship.verify.run` (exec), `ship.criterion.set` (state).

MCP: `get_ship_report({ base? })`, `get_task_scope({ task? })`. CLI: `agentneuron ship [dir] [--json] [--base ref] [--fail-on high|medium|low]` (static report only; exit 1 on blockers at/above fail-on; `--run` runs the detected checks locally, since the CLI is the user's own shell).

UI view `ship` ("Ship check"), tabs: `report` (default: verdict hero, changed files, checks, criteria), `scope`, `readiness`, `placeholders`, `runs`.

---

## Slice B: Change review (`changes`)  owner: agent B

Features: **#6 Review guardian**, **#3 Change impact analyzer**, **#10 Safe checkpoints & rollback**, **#9 Package hallucination guard**.

Code: `src/changes/*`, `src/server/routes/changes.js`, `src/actions/changes.js`, `src/commands/changes.js`, `src/changes/mcp.js`, `ui/src/views/Changes.svelte`, `ui/src/views/changes/*`, `ui/src/mock-changes.js`, `test/changes*.test.js`, `docs/changes.md`.
May extend: `src/git2/*` (add helpers, don't change existing behaviour), `src/project/fsindex.js` read helpers.

- **Review guardian (#6)**: for a diff (working tree vs HEAD by default, or `base..head`): per-file and per-hunk risk classification (`high|medium|low`) with reasons: sensitive paths/areas (auth, permissions/policies, payments, crypto, migrations, infra/CI, env/config, dependency manifests, security headers), removed checks (deleted `if (!user...)`, `authorize`, `can(`, middleware removal, `@csrf`), widened permissions, disabled tests (`.skip`, `xit`, deleted test files), large generated blobs, secrets added. Missing tests: changed source files with no changed/related test file. Reviewer summary: groups (feature / refactor / config / tests / deps), counts, "read these first" ordering.
- **Impact analyzer (#3)**: changed symbols (functions/classes/exports via a light regex parser for JS/TS/PHP/Python/Go), their importers and callers (static import graph + identifier search, bounded), affected routes (reuse `/api/project/routes` data), tests that cover them, API contracts (OpenAPI files, route definitions, exported types). Output nodes + edges for a graph and a flat "possibly affected" list with confidence.
- **Checkpoints & rollback (#10)**: create a checkpoint = snapshot of the working tree (incl. untracked, excluding ignored) as a commit object under `refs/agentneuron/checkpoints/<id>` (use a temp index via `GIT_INDEX_FILE`; never touch the real index or HEAD). List, diff checkpoint vs now (per file), and **selective restore**: restore only chosen paths (or only the hunks of one task) to checkpoint content; preview first; untouched paths stay as they are. Delete/prune. Actions: `changes.checkpoint.create` (edit), `changes.checkpoint.restore` (danger, preview via `/api/actions/preview`), `changes.checkpoint.delete` (edit). Test in a temp repo with dirty unrelated files, untracked files, staged changes and a moved HEAD.
- **Package guard (#9)**: offline by default: parse manifests + lockfiles (npm/pnpm/yarn/composer/pip/poetry), flag deps not in the lockfile, names within edit distance of popular packages (ship a small bundled top-N list per ecosystem), suspicious names (`-js` clones, scoped look-alikes), install scripts in lockfile metadata, git/url/file deps, unpinned `*`/`latest`. Check a single name (`?manager=&name=&version=`) for the MCP tool / agents before install. Online mode only with `config.packages.online: true`, admin-only, cached under `.agentneuron/cache/packages/`, 5s timeout: registry existence, first publish date, maintainers count, latest version, deprecation, OSV advisories.

Routes (GET `read`):
- `/api/changes/review?base=&head=` -> `{ base, head, summary: { files, added, removed, high, medium, low, missingTests }, groups: [{ kind, files: [path] }], files: [{ path, status, added, removed, risk, reasons: [{ code, message, line }], tests: [path], missingTest: bool }], readFirst: [path] }`
- `/api/changes/impact?base=&paths=` -> `{ changed: [{ path, symbols: [{ name, kind, line }] }], nodes: [{ id, kind: 'file'|'symbol'|'route'|'test'|'contract', label, path }], edges: [{ from, to, kind: 'imports'|'calls'|'covers'|'serves' }], affected: [{ kind, label, path, confidence: 'high'|'medium'|'low', via }] }`
- `/api/changes/checkpoints` -> `{ checkpoints: [checkpoint] }`; `/api/changes/checkpoint?id=` -> `{ checkpoint, files: [{ path, status: 'same'|'changed'|'deleted'|'added', added, removed }] }`; `/api/changes/checkpoint/diff?id=&path=` -> `{ path, before, after }` (diffs policy: `liveAccess(config).diffs(role)` else 403)
- `/api/changes/packages` -> `{ online: bool, findings: [{ id, severity, manager, name, version, code, message, fix }], deps: n }`; `/api/changes/package?manager=&name=&version=` -> `{ manager, name, verdict: 'ok'|'warn'|'block'|'unknown', reasons: [...], registry: {...}|null }`

MCP: `review_changes({ base? })`, `get_change_impact({ paths?, base? })`, `check_package({ manager, name, version? })`. CLI: `agentneuron review [dir] [--base ref] [--json] [--fail-on high]`, `agentneuron checkpoint list|create|diff|restore [dir] [--label x] [--id id] [--paths a,b] [--yes]`, `agentneuron packages [dir] [--json] [--online]`.

UI view `changes` ("Change review"), tabs: `review` (default), `impact` (graph + list), `checkpoints`, `packages`.

---

## Slice C: Agent brief (`brief`)  owner: agent C

Features: **#4 Smart session recovery**, **#8 Agent mistake prevention**, **#11 Smart context builder**, **#5 Bug detective**.

Code: `src/brief/*`, `src/server/routes/brief.js`, `src/actions/brief.js`, `src/commands/brief.js`, `src/brief/mcp.js`, `ui/src/views/Brief.svelte`, `ui/src/views/brief/*`, `ui/src/mock-brief.js`, `test/brief*.test.js`, `docs/brief.md`.
May extend: `src/insights/lessons.js`, `src/live/handoffs.js`, `src/usage/*` read helpers (no behaviour change for existing routes).

- **Session recovery (#4)**: evidence-backed checkpoint ("resume brief") per session or per task: goal (first prompt / task title), completed work (edits + commits), failed attempts (tool errors, reverted edits, failing commands), decisions (user corrections, accepted lessons), changed files, last test results (`listRuns`), open todos (TodoWrite / board), next steps; each item carries evidence `{ kind: 'session'|'commit'|'file'|'run'|'task', ref, ts }`. Export as Markdown for pasting into another agent (Claude -> Codex). Saved briefs in `.agentneuron/briefs/` (action `brief.save`, level `state`; extends handoffs so `get_handoffs` sees them).
- **Mistake prevention (#8)**: turn lessons + accepted rules + repo facts (package manager from lockfile, test runner, forbidden paths from rules, repeated failing commands) into **warnings** matched against a proposed action: `{ command?, paths?, task? }`. E.g. `npm install` in a pnpm repo, editing a generated file, running a command that failed N times before, touching a file a rule protects. `preflight` exits 2 on a blocking warning so a Claude Code `PreToolUse` hook can call `agentneuron preflight --command "$CMD"`; document a hook snippet (do not install it automatically).
- **Context builder (#11)**: for a task description (free text or board task id): rank files by keyword/path match, import graph neighbours, recently co-edited files (sessions/git), related tests, relevant rule/context sections (from effective context), verified facts (verify claims status ok), within a token budget. Output a pack (list + rendered Markdown). Deterministic, no model.
- **Bug detective (#5)**: given an error text/stack trace (pasted, or the last failing run from `listRuns`, or failing tool results in recent sessions): parse frames -> project files/lines, recent changes to those files (git + sessions), related config/env keys, dependency versions involved, failing tests, matching past failures from sessions with what fixed them, pending migrations/env mismatches. Output a diagnostic report with ranked hypotheses `{ title, confidence, evidence: [...], check /* how to confirm */ }` and Markdown export. Pasted error text is admin-only input (POST at level `read` with a body is fine; it is not stored unless saved).

Routes (GET `read` unless noted):
- `/api/brief/resume?session=&task=` -> `{ generatedAt, source: { session, task }, title, goal: { prompt }, done: [...], failed: [...], decisions: [...], files: [...], runs: [...], todos: [...], next: [...], markdown }` (session-derived text under the redactable keys; markdown omitted for viewers)
- `/api/brief/briefs` -> `{ briefs: [{ id, title, createdAt, source }] }`
- `/api/brief/warnings?command=&paths=&task=` -> `{ warnings: [{ id, severity: 'block'|'warn'|'info', title, why, evidence: [...], fix }] }` and `/api/brief/rules` -> the current warning rules (derived + accepted)
- `/api/brief/pack?task=&budget=` -> `{ task, budget, tokens, items: [{ kind: 'file'|'rule'|'fact'|'test', path, reason, score, tokens }], markdown }`
- POST `/api/brief/debug` `{ error?, run? }` (level `read`) -> `{ frames: [...], hypotheses: [...], related: { files, commits, sessions, config, deps, tests }, markdown }`
- Actions: `brief.save` (state).

MCP: `get_resume_brief({ session?, task? })`, `preflight_check({ command?, paths? })`, `get_context_pack({ task, budget? })`, `get_debug_report({ error })`. CLI: `agentneuron resume [dir] [--session id] [--task id] [--md]`, `agentneuron preflight [dir] --command "..." [--paths a,b] [--json]`, `agentneuron pack [dir] --task "..." [--budget 8000] [--md]`, `agentneuron debug [dir] [--error "..." | stdin] [--md]`.

UI view `brief` ("Agent brief"), tabs: `resume` (default), `warnings`, `pack`, `debug`.
