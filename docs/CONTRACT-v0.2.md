# mdctl v0.2 — Contract (binding for all agents)

Read first: `docs/PLAN-v0.2.md` (what & why), `docs/CONTRACT.md` (v0.1 types, rules —
still valid), `README.md`. v0.1 code is committed (`git log`). Do not break v0.1
endpoints the UI uses today.

## Ground rules (unchanged + new)
- JS ESM, Node ≥ 18, Node built-ins + already-installed deps only (`chokidar`, `yaml`
  on the server; UI may use `svelte`, `d3-*`, `@codemirror/*`, `@lezer/highlight`).
  **Never edit package.json** — ask the lead.
- Project-relative POSIX paths everywhere. Validate every path from a request:
  reject absolute, `..`, NUL; resolve and check it stays inside `ctx.root`.
- **Never spawn a shell**: use `spawn/execFile(cmd, argsArray)`; validate every arg
  (package names `^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$` (+ optional `@version`
  `^[\w.^~<>=*|-]+$`), composer `vendor/name`, script names must exist in manifest).
- mdctl internal state goes to `<root>/.mdctl/` only.
- **Only edit files you own** (listed per agent). Tests: `test/<area>-*.test.js`
  with temp dirs; never touch real projects. `npm test` must stay green.
- Secrets: never return env values, tokens, passwords. Use
  `maskSecretsInText` from `src/health/secrets.js` on any free text from transcripts.

## Permission model (user rule: **everything that changes things is OFF by default**)
Levels: `read` (always) · `state` (mdctl's own data in `.mdctl/`: board, bookmarks,
annotations — needs role admin) · `edit` (write project files, git stage/commit) ·
`exec` (run commands: packages, scripts, artisan, fetch/pull/push, MCP test) ·
`danger` (discard, delete branch, migrate, delete files permanently, terminal).
- Config `.mdctl/config.json`:
  ```json
  { "actions": { "edit": false, "exec": false, "danger": false, "terminal": false },
    "token": null, "adminToken": null,
    "notifications": { "webhooks": [ { "url": "...", "events": ["secret","conflict","health-drop","job-failed","job-done"] } ], "browser": true },
    "pricing": { }, "workspaceRoot": null }
  ```
  CLI equivalents: `--enable edit,exec[,danger,terminal]`, `--admin-token X`.
- Roles: no tokens set → `admin`. Only `token` set → holder is `admin`. If
  `adminToken` set → `adminToken` = admin, `token` = viewer.
- `ctx.can(level, role)`: read → true; state → role admin; edit/exec/danger → role
  admin AND `config.actions[level]`. (Lead added the router; Agent S1 adds `state`.)

## Server plumbing (already in place — lead)
- `src/server/router.js`: `router.get|post|put|delete(path, handler, { level })`.
  Handler `async ({ req, res, url, q, body, ctx, role }) => value` → 200 JSON; throw
  `new HttpError(status, msg)` (import from `../router.js`); stream by writing `res`
  yourself and returning `undefined`. Exact paths only — use query params for ids.
- Route modules `src/server/routes/<area>.js`: `export default async function register(router, ctx)`.
- Action modules `src/actions/<area>.js`: `export default function register(registry, ctx)`.
- `ctx` = `{ root, config, store, git, sessions, radar, startedAt, analysis(),
  repoInfo(), allFiles(), broadcast(name, data), warn, invalidate(), can(level, role),
  actions /*registry, S1*/, persist /*S1*/ }`. `analysis()` → `{ graph, issues, health, gitStatus, gitAvail, tasks, decisions }`.
- SSE names used by the UI: `event`, `health`, `graph`, `conflict`, `ping` (v0.1) +
  `job`, `joblog`, `notify`, `board`, `files` (v0.2).

## Actions registry (S1 implements, everyone registers)
```js
registry.register({
  id: 'packages.add',            // dotted, unique
  title: 'Add package', category: 'packages', // files|git|packages|scripts|framework|agents|tasks|mdctl|workspace
  level: 'exec', description: '…',
  params: { manager: { type: 'enum', enum: ['npm','composer'], required: true },
            name: { type: 'string', required: true, pattern: '…', label: 'Package' },
            dev: { type: 'boolean', default: false } },   // types: string|number|boolean|enum|path|text|string[]
  available: async (ctx) => true,                       // optional (hide when false)
  preview: (params, ctx) => ({ command: ['npm','install','x'], summary: 'Installs x' }),
  run: async (params, ctx, job) => result,              // job.exec(...) streams output
});
```
- `registry.list(role)` → `[{ id, title, category, level, description, params, enabled, reason? }]`
  (`enabled:false` + reason like `"enable actions.exec in .mdctl/config.json"`).
- `registry.preview(id, params)`; `registry.run(id, params, { role, by })` → Job
  (validates params by schema first; checks `ctx.can(def.level, role)`).
- Job: `{ id, actionId, title, params, level, status: 'queued'|'running'|'ok'|'error'|'cancelled',
  startedAt, endedAt, exitCode, result, error, command }` + inside run:
  `job.log(stream /*'stdout'|'stderr'|'info'*/, text)`, `job.signal` (AbortSignal),
  `job.exec(cmd, args, { cwd /*rel to root*/, env, timeoutMs = 600000 })` →
  `{ code, stdout, stderr }` (spawn, no shell, output streamed as `joblog`, kills on cancel).
- One job per category at a time (queue), max 3 concurrent overall.

## Agent S1 (Sonnet) — platform: security, actions, jobs, persistence, notifications, CLI
Owns: `src/server/app.js`, `src/server/router.js`, `src/cli.js`, `src/core/config.js`,
`src/actions/registry.js` (new), `src/actions/index.js`, `src/actions/mdctl.js`,
`src/persist/*`, `src/notify/*`, `src/server/routes/system.js`, `scripts/build.mjs`,
`test/platform-*.test.js`, `test/server.test.js`, `test/cli.test.js`, `README.md`.
- Config defaults + `--enable`, `--admin-token`; `state` level in `ctx.can`; roles
  as above; convert v0.1 `/api/restore` to `edit` level (keep `--write` as alias for `--enable edit`).
- **Auth**: `POST /api/auth/login {token}` → sets cookie `mdctl_session` (HttpOnly,
  SameSite=Strict, random session id ↔ role, in-memory) ; `POST /api/auth/logout`;
  `GET /api/auth/me` → `{ role, levels: { read, state, edit, exec, danger, terminal }, tokenRequired }`.
  Requests authenticate by cookie OR `?token=` OR Bearer (keep v0.1 behaviour).
  `/` (HTML) must load without auth so the UI can show a login screen; all `/api/*`
  except `/api/auth/*` require auth when a token is configured.
- Registry + job runner (above). Routes in `system.js`: `GET /api/actions`,
  `POST /api/actions/preview {id, params}`, `POST /api/actions/run {id, params}` → Job,
  `GET /api/jobs` (recent 100), `GET /api/job?id=` → Job + `log: [{ts, stream, text}]` (cap 2 MB),
  `POST /api/jobs/cancel {id}`, `GET /api/audit?limit=` (admin only),
  `GET /api/settings` → `{ actions, roles, notifications (urls masked), paths, version, howToEnable: "…" }`.
  SSE `job` (job summary on every status change), `joblog` (`{ id, stream, text }`).
- **Audit** `.mdctl/audit.jsonl`: every action run + every state/edit route call
  (`{ ts, role, ip, action|route, params (secrets masked), status }`).
- **Persistence** (`ctx.persist`): `.mdctl/events.jsonl` (append every store event),
  `.mdctl/metrics.jsonl` (snapshot on start + hourly + on health change, debounced 5 min):
  `{ ts, files, tokens, health, grade, errors, warns, infos, tasksOpen, tasksDone, gitDirty, byTool, byKind }`.
  API: `ctx.persist.events.query({ from, to, limit })`, `ctx.persist.metrics.query({ from, to })`,
  `ctx.persist.metrics.snapshot()`. Rotate files > 20 MB (keep 3).
- **Notifications**: `ctx.notify(type, payload)` → SSE `notify` `{ type, title, body, level, ts, path? }`
  + POST JSON to configured webhooks (Slack/Discord-compatible `text` field), with
  5 s timeout, never throws. Triggers: new secret issue, conflict, health drop ≥ 10
  points, job failed/done.
- mdctl actions (`src/actions/mdctl.js`): `mdctl.rescan` (state), `mdctl.history.clear` (danger),
  `mdctl.snapshot` (state; metrics snapshot), `mdctl.terminal` (danger + `actions.terminal`;
  runs a command line via `spawn(cmd, args)` after simple shell-words split, no shell).
- CLI: `mdctl mcp [dir]` → `import { runMcpServer } from './mcp/server.js'` (S3 writes it);
  `mdctl workspace [dir]` → start in workspace mode (sets `config.workspaceRoot`).
- Wire `ctx.actions`, `ctx.persist`, `ctx.notify` **before** `registerAll`; call
  `registerActions(registry, ctx)` from `src/actions/index.js`.

## Agent S2 (Sonnet) — project intelligence + package/script/framework actions
Owns: `src/project/**`, `src/server/routes/project.js`, `src/actions/packages.js`, `test/project-*.test.js`.
- `detectProject(root)` (cached 30 s, invalidated when any manifest mtime changes) →
  ```js
  { name, description, version,
    stacks: [{ id, name, version, category /*language|framework|runtime|tool|infra|testing|ci|ai|db*/, confidence, source }],
    manifests: [{ path, type /*npm|composer|python|go|cargo|ruby|maven|gradle|dotnet|deno*/, name, version, scripts, deps: [{ name, version, dev, manager }] }],
    packageManagers: [{ id, lockfile, manifest, available /*binary on PATH*/ }],
    scripts: [{ manager, name, command, source }],
    env: { files, exampleKeys, presentKeys, missing, extra },   // names only, never values
    docker: { files, services: [{ name, image, build, ports }] },
    ci: [{ provider, path, name, triggers, jobs }],
    dotfolders: [{ name, purpose, tool, files, bytes }],
    framework: { laravel?: { version, routes: n, migrations: n, models: n, providers: n }, next?: {...}, vite?: {...}, ... },
    stats: { languages: [{ lang, files, lines, bytes }], totalFiles, totalLines, largest: [{ path, bytes }], dirs: [{ path, files, bytes }] } }
  ```
  Detectors as small modules in `src/project/detectors/*.js` (`{ id, detect(root, fsIndex) → partial }`).
  Cover at least: npm/pnpm/yarn/bun, composer, Laravel, Symfony, Next, Nuxt, Vite, Astro,
  SvelteKit, Remix, Angular, React, Vue, Express/Nest, Tailwind, TypeScript, ESLint/Prettier,
  PHPUnit/Pest, Jest/Vitest/Playwright, Python (pyproject/requirements, Django/Flask/FastAPI),
  Go, Rust, Ruby/Rails, Java (maven/gradle), .NET, Docker/compose, GitHub Actions, GitLab CI,
  Vercel/Netlify/Fly, Prisma/Drizzle, Husky, devcontainer, EditorConfig, AI tools (count only).
  Use `yaml` for YAML. File walk must skip v0.1 ignore dirs and cap at 50k files.
- Laravel extras: `laravelRoutes(root)` → static parse of `routes/*.php`
  `[{ method, uri, action, name, middleware, file, line }]`; `laravelMigrations(root)` → `[{ file, table, ts }]`;
  models list.
- `docDrift(root, files, git)` → `[{ doc, mentions: [path], docChangedAt, codeChangedAt, commitsSince, severity }]`
  (docs mentioning code files that changed after the doc did, via `git log -1 --format=%ct -- path`).
- Routes: `GET /api/project`, `GET /api/project/deps?manager=`, `GET /api/project/routes`,
  `GET /api/project/migrations`, `GET /api/project/drift`, `GET /api/project/stats`,
  `GET /api/project/outdated` (last result of the outdated action, cached in `.mdctl/cache/`).
- Actions (`exec` unless noted): `packages.install {manager}`, `packages.add {manager, name, version?, dev?}`,
  `packages.remove {manager, name}`, `packages.update {manager, name?}`,
  `packages.outdated {manager}` (parses JSON output → stores cache), `packages.audit {manager}`,
  `scripts.run {manager, name}` (name must exist), `framework.artisan {command}` with
  allowlist (`about, route:list, migrate:status, cache:clear, config:clear, view:clear, route:clear, optimize:clear, queue:failed, schedule:list`) and
  `framework.artisan.migrate` (danger). Managers: npm, pnpm, yarn, bun, composer, pip, poetry.
  `available()` = manifest present AND binary on PATH.

## Agent S3 (Sonnet) — agent context center, templates, sync, sessions, costs, MCP server
Owns: `src/agentcenter/**`, `src/mcp/**`, `src/server/routes/agentcenter.js`, `src/actions/agents.js`, `test/agentcenter-*.test.js`, `test/mcp-*.test.js`.
- `scanAgentSetup(root, { home, includeGlobal = false })` →
  `{ tools: [{ id, name, detected, files: [{ path, kind, scope /*project|local|global*/ }],
     capabilities: { instructions, rules, mcp, hooks, permissions, agents, skills, commands, ignore } /* each { count, items } */ }],
     totals }`.
  Tools: claude, codex, cursor, copilot, windsurf, gemini, cline, roo, aider, continue, zed, junie, amazonq.
  Parse frontmatter for Claude agents (name, description, tools, model), skills
  (`SKILL.md` name/description + files), commands (description, argument-hint), Cursor
  `.mdc` (description, globs, alwaysApply), Copilot `.instructions.md` (applyTo).
  Reuse `readAgentConfig` from `src/health/configview.js` for MCP/hooks/permissions.
- `rulesForFile(root, path, setup)` → `[{ tool, path, reason /*always|glob|hierarchy|description*/, glob? }]`.
- Templates `src/agentcenter/templates.js`: `listTemplates()` →
  `[{ id, name, category, tool, defaultPath, description, vars: [{name, label, default}] }]`,
  `renderTemplate(id, vars)` → `{ path, content }`. ≥ 14 templates: CLAUDE.md, AGENTS.md, GEMINI.md,
  Cursor rule (.mdc), Copilot instructions, Claude skill, Claude subagent, slash command,
  ADR, plan, PRD, TODO list, decision log, session handoff, README.
- Sync: `syncStatus(root, files, contents)` → pairs of instruction files across tools with
  similarity %; `syncPlan(root, { source, targets })` → `[{ target, exists, content, diff }]`.
- Sessions: `sessionTimeline(sessionsApi, id)` → `{ session, timeline: [{ ts, type /*prompt|edit|tool|summary*/, text, tool, path }] }`
  (text truncated 500 chars, secrets masked). Needs raw transcript access — implement a
  reader in `src/agentcenter/transcript.js` (do not edit `src/agents/sessions.js`; you may import it).
- Costs: `estimateCosts(sessionsList, transcripts, pricing)` → per session + per day
  `{ input, output, cacheRead, cacheWrite, usd }`; default pricing table by model family
  (opus/sonnet/haiku/gpt/other), overridable by `config.pricing`. Read `message.model` from transcripts.
- Context time-travel: `contextAt(store, dir, tool, ts)` (use `store.history` versions ≤ ts,
  fallback current) and `contextDiff(store, dir, tool, fromTs, toTs)` → `{ from, to, diff /*lineDiff*/ }`.
- MCP server `src/mcp/server.js`: `export async function runMcpServer(root, config)` —
  stdio JSON-RPC 2.0 (MCP `initialize`, `tools/list`, `tools/call`, protocolVersion `2025-06-18`),
  no stdout noise. Tools: `list_files`, `read_file`, `search`, `get_health`,
  `get_context {dir, tool}`, `recent_changes {since}`, `get_tasks`, `get_links {path}`, `project_info`.
  Build its own store (`createStore`) and analysis.
- Routes: `GET /api/agents/setup`, `GET /api/agents/rules-for?path=`, `GET /api/agents/templates`,
  `GET /api/agents/template/render?id=&vars=` (JSON vars), `GET /api/agents/sync/status`,
  `POST /api/agents/sync/plan {source, targets}`, `GET /api/agents/session?id=`,
  `GET /api/agents/costs?from=&to=`, `GET /api/context/at?dir=&tool=&ts=`,
  `GET /api/context/diff?dir=&tool=&from=&to=`.
- Actions: `agents.create {template, vars, path?}` (edit), `agents.sync.apply {source, targets}` (edit),
  `agents.permissions.update {file, allow, deny, ask}` (edit), `agents.hooks.update {file, hooks}` (edit),
  `agents.mcp.add {name, type, command?, args?, url?}` / `agents.mcp.remove {name}` (edit, `.mcp.json`),
  `agents.mcp.test {name}` (exec: spawn stdio server / POST http, `initialize` + `tools/list`, 15 s timeout).

## Agent S4 (Sonnet) — files, editor backend, links, find/replace, quick fixes, annotations, bookmarks, tasks board
Owns: `src/files/**`, `src/board/**`, `src/server/routes/files.js`, `src/server/routes/tasks.js`,
`src/actions/files.js`, `src/actions/tasks.js`, `test/files-*.test.js`, `test/board-*.test.js`.
- Routes (level in brackets):
  - `GET /api/file/raw?path=` → `{ path, content, hash, mtime }` [read]
  - `POST /api/file/save {path, content, baseHash}` → `{ entry, hash }`; if disk hash ≠ baseHash →
    **409** `{ conflict: true, current, currentHash }` [edit]. Writes atomically (tmp + rename),
    snapshots history before and after, triggers store update.
  - `POST /api/file/create {path, content?, template?, vars?}` (templates via
    `renderTemplate` from `src/agentcenter/templates.js`) [edit]; refuse overwrite.
  - `POST /api/file/rename {from, to, rewriteLinks = true, dryRun = false}` →
    `{ from, to, rewritten: [{ path, count }] }` — rewrites md links / wiki / `@imports` /
    backticked & plain mentions in all tracked files [edit].
  - `POST /api/file/delete {path}` → moves to `.mdctl/trash/<id>/` [edit];
    `GET /api/trash`, `POST /api/trash/restore {id}` [edit], `POST /api/trash/purge {id}` [danger].
  - `GET /api/links/resolve?from=&target=` → `{ path | null, exists, candidates }`;
    `GET /api/backlinks?path=` → `Link[]` [read].
  - `GET /api/replace/preview?q=&replace=&regex=0|1&case=0|1&word=0|1&paths=a,b` →
    `[{ path, line, before, after }]` (cap 2000); `POST /api/replace/apply {…, paths}` → `{ changed: [{ path, count }] }` [edit].
  - `GET /api/fixes?issue=<issue id>` → `[{ id, title, description, edits: [{ path, line, before, after }] }]`;
    `POST /api/fixes/apply {issue, fix}` [edit]. Fixes: broken-link/missing-path → closest
    existing files (fuzzy by basename + path distance); orphan → add link to nearest README/CLAUDE.md/AGENTS.md
    index section; secret → replace value with `${ENV_NAME}`; empty-file → delete (to trash);
    duplicate-rule → remove from one file.
  - Bookmarks `.mdctl/bookmarks.json`: `GET /api/bookmarks`, `POST /api/bookmarks {path, label?}`,
    `POST /api/bookmarks/remove {path}` [state].
  - Annotations `.mdctl/annotations.json`: `GET /api/annotations?path=`,
    `POST /api/annotations {path, line, text}` (stores anchor = line text, re-anchors on change),
    `POST /api/annotations/remove {id}`, `POST /api/annotations/resolve {id}` [state].
    `{ id, path, line, anchor, text, author /*role*/, ts, resolved }`.
- **Board** (`src/board/*`, routes in `tasks.js`):
  - Task: `{ id, source: 'md'|'native', path, line, title, description, status /*backlog|todo|doing|review|done*/,
    priority /*none|low|med|high|urgent*/, labels, due /*YYYY-MM-DD|null*/, assignee, files,
    checklist: [{ text, done }], comments: [{ id, ts, author, text }], createdAt, updatedAt, order, section }`.
  - md parsing: `- [ ]` todo, `- [/]` doing, `- [x]` done; inline meta `@due(2026-11-01)`, `#label`,
    `!low|!med|!high|!urgent`, `@name` assignee; nested checkboxes under a task → checklist.
    Stable id = sha1(path + normalized title) (survives line moves). Extra fields for md tasks
    (backlog/review status, order, comments…) stored as an overlay in `.mdctl/board.json`.
  - `GET /api/board` → `{ columns: [{ id, title, wip }], tasks, labels, assignees }` [read];
    `POST /api/board/task {task, path?}` create (native → state; with `path` → appends to md → edit-checked inside);
    `POST /api/board/update {id, patch}`, `POST /api/board/move {id, status, order}`,
    `POST /api/board/delete {id}`, `POST /api/board/comment {id, text}`, `POST /api/board/columns {columns}` [state].
    For md tasks, status todo/doing/done + title/meta edits are written back to the md line **only if**
    `ctx.can('edit', role)`; otherwise saved to overlay and response has `{ mdSynced: false, reason }`.
  - Broadcast SSE `board` `{ changed: true }` after mutations.
- Actions: `files.create`, `files.rename`, `files.delete`, `files.replace` (edit), `tasks.export {path}` (edit → writes TASKS.md).

## Agent S5 (Sonnet) — git 2.0, reports, changelog, workspace
Owns: `src/git2/**`, `src/reports/**`, `src/workspace/**`, `src/server/routes/git.js`,
`src/server/routes/reports.js`, `src/server/routes/workspace.js`, `src/actions/git.js`,
`test/git2-*.test.js`, `test/reports-*.test.js`, `test/workspace-*.test.js`.
- Git routes [read]: `GET /api/git/branches` → `{ current, local: [{ name, upstream, ahead, behind, last: { hash, date, subject } }], remote: [{ name, last }] }`;
  `GET /api/git/log?branch=&path=&author=&since=&until=&limit=100&skip=` → `[{ hash, short, parents, refs, author, email, date, subject }]`;
  `GET /api/git/commit?hash=` → `{ ...commit, body, files: [{ path, status, added, removed }], patch /*≤ 400 KB*/ }`;
  `GET /api/git/changes` → `{ staged: [{ path, status, added, removed }], unstaged: [...], untracked: [path], conflicted: [path] }`;
  `GET /api/git/diff?path=&staged=0|1` → `{ path, patch, hunks }`; `GET /api/git/tags`, `/api/git/stash`,
  `/api/git/remotes`, `/api/git/blame?path=` → `[{ line, hash, short, author, date, summary }]`,
  `/api/git/stats?since=&until=` → `{ byAuthor, byDay, topFiles }`.
  Paths project-relative; repo may sit above root (reuse ideas from `src/analysis/git.js`).
  Handle "dubious ownership" by returning `{ available: false, reason }` (do NOT add safe.directory).
- Git actions: edit: `git.stage {paths}`, `git.unstage {paths}`, `git.commit {message, amend?}`,
  `git.branch.create {name, from?}`, `git.branch.switch {name}`, `git.stash.push {message?}`,
  `git.stash.pop {index?}`, `git.tag.create {name, message?}`;
  exec: `git.fetch {remote?}`, `git.pull`, `git.push {setUpstream?}`;
  danger: `git.discard {paths}`, `git.branch.delete {name, force?}`, `git.stash.drop {index}`.
  Validate ref names with `git check-ref-format --branch`.
- Reports [read] (data from `ctx.persist`, git, sessions, board via `GET`-level helpers):
  `GET /api/reports/summary?from=&to=` → `{ range, prevRange, kpis: { changes, filesTouched, linesAdded, linesRemoved,
   tokensNow, tokensDelta, healthNow, healthDelta, tasksOpened, tasksClosed, commits, agentEdits, activeSessions }, prev: {…same} }`;
  `GET /api/reports/series?from=&to=&bucket=hour|day|week&metric=changes|lines|tokens|health|tasks|commits|agents&split=none|tool|kind|author|session`
   → `{ buckets: [ts], series: [{ key, values }] }`;
  `GET /api/reports/top?from=&to=&by=churn|links|stale|tokens` → rows;
  `GET /api/reports/heatmap?days=365` → `[{ date, count }]`;
  `GET /api/reports/export?from=&to=&format=csv|md|html` → file download (content-disposition).
  Times are ms epoch; default range last 7 days.
- Changelog: `GET /api/changelog?from=&to=HEAD` → `{ markdown, groups: [{ type, items }] }`
  (conventional commits grouping, fallback "Other"); action `git.changelog.write {from?, to?}` (edit, prepends CHANGELOG.md).
- Workspace (`src/workspace/*`, route `workspace.js`): root = `config.workspaceRoot` ||
  parent of project root. `GET /api/workspace` → `{ root, current, projects: [{ name, path, stacks, aiTools, mdFiles,
  lastModified, hasMdctl, git: { branch, dirty }, running: { url } | null }] }` (scan depth ≤ 2, skip ignores,
  cached 60 s, quick stack sniff by manifest names only). Action `workspace.open {path}` (exec): spawns
  `process.execPath <bundle or src/cli.js> start <path> --port 0 --host <same> [--token same]` detached-ish (child
  tracked, killed on close), parses printed URL, returns `{ url }`. `GET /api/workspace/instances`.

## UI — two Opus agents
Design: **modern, advanced, yet minimal** — calm surfaces, few colors (tool accents
only), strong typography, generous spacing, subtle motion, no clutter; everything
discoverable via ⌘K and right-click. Dark-first + light. Keyboard-first. Phone-usable.
Keep `ui/dist/index.html` a single self-contained file. Extend `ui/src/mock.js` so every
new endpoint works with `?mock=1`.

### UI-A (Opus) — shell, editing, navigation, work views
Owns: `ui/src/App.svelte`, `ui/src/app.css`, `ui/src/main.js`, `ui/index.html`, `ui/vite.config.js`,
`ui/src/mock.js`, `ui/src/mock-data.js`, all existing `ui/src/lib/*` (incl. new `lib/actions.js`, `lib/links.js`),
new `ui/src/lib/editor/**`, `ui/src/lib/board/**`, `ui/src/lib/git/**`, views `Files`, `Diff`, `Context`, `Health`, `Tasks`, `Git`, `Settings`.
- Implement `lib/actions.js` (`runAction`, `canRun`) **first** (UI-B depends on it): ActionDialog with
  param form from schema, `POST /api/actions/preview` command preview, confirm (typed confirm for danger),
  starts job, opens Jobs dock. Disabled actions show the reason + "how to enable" link to Settings.
- Auth: login screen (`/api/auth/login`), role from `/api/auth/me`, strip token from URL after login.
- Jobs dock (bottom, collapsible): live logs (`job`/`joblog`), cancel, history.
- Notifications: toast + optional browser Notification for SSE `notify`; bell menu with recent.
- **Links everywhere**: markdown renderer turns md links / `[[wiki]]` / `@imports` / backticked or plain
  paths to existing files into in-app links (use `/api/links/resolve` or local file index), hover peek card,
  back/forward stack + breadcrumbs, backlinks panel, recent files, bookmarks (sidebar "Pinned").
- **Editor**: CodeMirror 6 markdown (`lib/editor/`), split edit/preview, Ctrl/Cmd+S, dirty state,
  Ctrl+click links, conflict (409) merge dialog (yours vs disk, pick/merge), read-only when edit disabled.
- File actions: new (template picker via `/api/agents/templates`), rename with rewrite preview (`dryRun`),
  delete → trash, restore version, copy path, reveal in graph, create task from selection, find & replace panel.
- Health: one-click fixes (`/api/fixes`), Annotations in file viewer gutter.
- **Tasks**: Trello/ClickUp-style — Board (DnD columns, WIP), List, Table (sortable), Calendar, Timeline;
  card modal (desc md, checklist, labels, priority, due, assignee, files, comments); filters & swimlanes;
  shows md vs native source, mdSynced warnings.
- **Git**: tabs Overview · Changes (stage/unstage/discard/commit) · History (commit graph lanes) ·
  Branches · Tags · Stash · Remotes · Blame · Stats.
- **Settings**: permission levels (on/off + how to enable via config/flags — read-only display), roles,
  audit log table, notifications, trash, jobs history, about.
- Topbar: mount `WorkspaceSwitcher` from `ui/src/lib/insight/WorkspaceSwitcher.svelte` (UI-B builds it).

### UI-B (Opus) — insight views
Owns: views `Overview`, `Graph`, `Reports`, `Project`, `Agents`, folders `ui/src/views/graph/**`,
`ui/src/lib/viz/**` (charts), `ui/src/lib/insight/**`, `ui/src/mock-insight.js`.
Use (don't edit) UI-A's `lib/api.js`, `lib/store.svelte.js`, `lib/nav.js`, `lib/actions.js`, `lib/links.js`, `app.css` tokens,
shared components. Need a change in UI-A files? Note it in your report.
- **Graph 2.0** (canvas/WebGL-quality perf, 1k+ nodes): layouts Neural (layered: context/rules → agents/skills/commands →
  docs/plans → tasks/decisions; glowing edges; particles travel along edges when a file changes),
  Force, Orbit (pseudo-3D rotatable sphere, depth shading), Radial (from chosen root), Clusters (hulls by
  folder/tool/kind), Timeline (x = mtime), Matrix. Smooth animated transitions between layouts, minimap,
  focus mode (n-hop), path finder, filters, LOD labels, heat by churn, broken links, click → open file,
  right-click → actions.
- **Reports**: time range picker (24h/7d/30d/90d/custom) + compare to previous; KPI tiles with deltas;
  charts (own small SVG chart lib in `lib/viz/`: line/area/stacked, bar, donut, sparkline, heatmap calendar):
  changes over time by tool/kind, tokens, health trend, tasks burnup, agent activity, commits; top tables;
  export buttons.
- **Project**: stack badges, manifests & dependency tables (outdated/audit via actions), scripts (run via
  `runAction('scripts.run', …)`), env check, Docker services, CI, dot-folders, Laravel routes/migrations,
  code stats (languages donut, largest files, folder sizes), doc drift.
- **Agents** (context center): capability matrix tool × capability, per-tool panels (Claude agents/skills/
  commands/hooks/permissions/MCP…), "which rules apply to file X?" tester, templates gallery (create via
  `runAction('agents.create')`), cross-tool sync & drift, MCP add/test, sessions list + session timeline +
  costs, conflict radar, context time-travel diff.
- **Overview** dashboard upgrade: context-management center (per-tool cards, budget meters), KPIs with
  sparklines, live activity, health, tasks summary, git summary, project stack strip, workspace widget.
- `ui/src/lib/insight/WorkspaceSwitcher.svelte` (dropdown of `/api/workspace` projects; open via
  `runAction('workspace.open')` and navigate to returned URL).
