# mdctl — Module & API Contract (source of truth for all agents)

Read `docs/VISION.md` for the why. This file is the **how**. Do not change a
signature here without telling the lead (it breaks other agents' work).

## Ground rules
- Plain **JavaScript ESM** (`.js`, `import`/`export`), Node >= 18. JSDoc types welcome. No TypeScript.
- Server code may only import Node built-ins + `chokidar` (v4). Everything gets bundled by esbuild into one file.
- All paths exchanged between modules and over the API are **project-relative POSIX** (`docs/plan.md`, never absolute, never `\`).
- Never write inside the target project except under `<root>/.mdctl/`. Read-only on everything else (except explicit restore).
- Always ignore: `.git`, `node_modules`, `vendor`, `.mdctl`, `dist`, `build`, `.next`, `storage`, `__MACOSX`, plus `config.ignore`. Skip files > `config.maxFileSize` (default 1 MB).
- Tests: `node --test`, in `test/<module>.test.js`, use temp dirs (`fs.mkdtempSync(os.tmpdir()+...)`) — never touch real projects.
- Each agent ONLY edits the files it owns (listed below). Need something from another module? Code against this contract.

## Shared types
```js
/** FileEntry */
{
  path: "CLAUDE.md",          // rel posix
  name: "CLAUDE.md",
  dir: "",                    // rel posix dir, "" for root
  tool: "claude",             // claude|codex|cursor|copilot|windsurf|gemini|generic
  kind: "context",            // context|rules|agent|skill|command|memory|config|doc|todo|decision|plan|readme|changelog|other
  ext: ".md",
  size: 1234,                 // bytes
  mtime: 1729700000000,       // ms
  hash: "sha1hex",
  tokens: 310,                // estimateTokens(content)
  lines: 42,
  title: "First H1 or null"
}

/** Event (pushed to UI) */
{ id: 17, type: "add"|"change"|"unlink", path, ts, file?: FileEntry,
  stats?: { added: 12, removed: 3 },   // line diff vs previous version
  historyId?: "1729700000000-ab12cd" , agent?: AgentRef|null }

/** Link */
{ from: "CLAUDE.md", to: "docs/plan.md", type: "md-link"|"wiki"|"import"|"mention"|"hierarchy"|"ref", line: 12, broken: false, raw: "@docs/plan.md" }

/** Issue (lint) */
{ id: "broken-link:CLAUDE.md:12", rule: "broken-link", severity: "error"|"warn"|"info", path, line?: 12, message, hint? }

/** HistoryEntry */
{ id: "1729700000000-ab12cd", path, ts, hash, size, added, removed }

/** AgentRef */
{ tool: "claude"|"codex", sessionId, title?: string, lastPrompt?: string, ts }
```

## Modules & owners

### Agent A (Sonnet) — core: `src/core/*`, `src/patterns/catalogue.json`
- `src/patterns/catalogue.json` — `{ patterns: [{ glob, tool, kind, description }] , docKinds: [{ regex, kind }] }`. Cover Claude (CLAUDE.md, CLAUDE.local.md, .claude/agents/*.md, .claude/skills/**/SKILL.md, .claude/commands/**/*.md, .claude/settings*.json, .mcp.json), Codex (AGENTS.md, AGENTS.override.md, .codex/**), Cursor (.cursorrules, .cursor/rules/**/*.mdc, .cursor/mcp.json), Copilot (.github/copilot-instructions.md, .github/instructions/**/*.instructions.md, .github/prompts/*.prompt.md), Windsurf (.windsurfrules, .windsurf/rules/**), Gemini (GEMINI.md, .gemini/**), generic (README, TODO, ROADMAP, DECISIONS, adr/**, PLAN*, CHANGELOG, docs/**, memory/**).
- `src/core/config.js` — `export function loadConfig(root, overrides={})` → `{ root, port:4747, host:"127.0.0.1", token:null, ignore:[], extraPatterns:[], includeAllMarkdown:true, maxFileSize:1048576, historyLimitPerFile:200, openBrowser:false }`. Reads `<root>/.mdctl/config.json` if present. `export function ensureMdctlDir(root)` creates `.mdctl/` (+ `.mdctl/.gitignore` containing `history/\ncache/\n`).
- `src/core/classify.js` — `export function classify(relPath)` → `{ tool, kind, tracked: boolean }` (tracked=true if it matches a catalogue pattern or is `.md/.mdc`). `export function isCandidate(relPath, config)`.
- `src/core/tokens.js` — `export function estimateTokens(text)` (≈ chars/4 with word-aware tweak; deterministic).
- `src/core/scanner.js` — `export async function scan(root, config)` → `FileEntry[]`; `export async function readEntry(root, relPath)` → `{ entry: FileEntry, content: string } | null`.
- `src/core/watcher.js` — `export function createWatcher(root, config, onEvent)` → `{ close(): Promise<void> }`. onEvent(`{type, path}`) debounced ~150ms per path, via chokidar with ignore rules.
- `src/core/history.js` — `export function createHistory(root, config)` → `{ record(path, content) => HistoryEntry|null (null if hash unchanged), list(path) => HistoryEntry[] (newest first), get(path, id) => string|null, latest(path) => HistoryEntry|null, restore(path, id) => HistoryEntry (writes file + records) }`. Storage under `.mdctl/history/`. Enforce historyLimitPerFile.
- `src/core/diff.js` — `export function lineDiff(oldText, newText)` → `{ added, removed, hunks: [{ type:"add"|"del"|"ctx", line, text }] }` (Myers or LCS; fine for files < 1MB; cap work for huge inputs).
- `src/core/store.js` — `export function createStore(root, config)` → EventEmitter-based state: `{ files: Map<path, FileEntry>, contents: Map<path,string>, events: Event[] (ring, 500), init(): Promise<void> (scan+read+history.record baseline), handleFsEvent({type,path}): Promise<Event|null>, history, on('event', fn), on('changed', fn) }`. On each change: read, compute stats via lineDiff against previous content, record history, push Event, emit `'event'`.

### Agent B (Sonnet) — analysis: `src/analysis/*`
- `src/analysis/git.js` — `export function createGit(root)` → `{ available(): Promise<boolean>, repoInfo(): Promise<{branch, head, ahead, behind, remote, dirty:number, recent:[{hash,short,author,date,subject,files:[path]}]}>, status(): Promise<Map<path,"M"|"A"|"D"|"?"|"R">>, fileLog(path, n=30): Promise<[{hash,short,author,date,subject}]>, show(path, rev="HEAD"): Promise<string|null>, diff(path): Promise<string> }`. Use `child_process.execFile('git', ...)` with `cwd: root`, timeouts, never throw when git is missing (return empty/false).
- `src/analysis/links.js` — `export function extractLinks(path, content, allPaths:Set<string>)` → `Link[]`. Handle `[t](rel.md#x)`, `[[name]]` (match by basename w/o ext), Claude `@path/to/file` imports (not emails, not inside code fences), plain-text mentions of existing tracked paths, `.mdc`/frontmatter references. Resolve relative to file dir; mark `broken`.
- `src/analysis/graph.js` — `export function buildGraph(files:FileEntry[], contents:Map)` → `{ nodes:[{id:path, tool, kind, tokens, size, mtime, degree}], edges: Link[] }`. Include `hierarchy` edges: each nested CLAUDE.md/AGENTS.md/GEMINI.md → nearest ancestor same-name file.
- `src/analysis/context.js` — `export function effectiveContext(dir, files, contents, tool="claude")` → `{ dir, tool, chain:[{path, reason:"root"|"ancestor"|"import"|"rule", tokens}], text, tokens }`. Claude: CLAUDE.md + CLAUDE.local.md from root down to `dir`, recursively expand `@imports` (max depth 5, no cycles). Codex: AGENTS.md(+override) root→dir. Cursor: `.cursor/rules/*.mdc` with `alwaysApply: true` + `.cursorrules`. `export function contextDirs(files)` → list of dirs worth previewing.
- `src/analysis/tasks.js` — `export function extractTasks(path, content)` → `[{ path, line, text, done:boolean, section }]` (checkboxes + `TODO:`/`FIXME:` lines outside code).
- `src/analysis/decisions.js` — `export function extractDecisions(path, content, kind)` → `[{ path, title, status?, date?, line }]` for ADR files / "## Decision" headings.

### Agent C (Sonnet) — health & agents: `src/health/*`, `src/agents/*`
- `src/health/secrets.js` — `export function scanSecrets(path, content)` → `Issue[]` (rule `secret`). AWS keys, GitHub tokens (ghp_, github_pat_), OpenAI/Anthropic (`sk-`, `sk-ant-`), Slack, Stripe, Google API, JWT, private key blocks, `password=`/`api_key:` assignments with high-entropy values. Mask the secret in message (show first 4 chars).
- `src/health/lint.js` — `export function lint({ files, contents, links, gitStatus?, codeMtimes? })` → `Issue[]`. Rules: `broken-link`, `missing-path` (backticked paths that don't exist — check with fs relative to root; lint takes `root` too), `orphan`, `large-context` (context/rules file > 5k tokens warn, >10k error), `duplicate-rule` (same normalized bullet line in ≥2 context/rules files of different tools), `stale-plan` (plan/todo not modified 30d), `empty-file`, plus secrets. Signature: `lint({ root, files, contents, links })`.
- `src/health/score.js` — `export function healthScore(issues, files)` → `{ score: 0-100, grade:"A".."F", counts:{error,warn,info}, byRule:{} }`.
- `src/health/configview.js` — `export function readAgentConfig(root)` → `{ mcpServers:[{name, source, command?, url?, type}], hooks:[{event, matcher?, command, source}], permissions:{allow:[],deny:[],ask:[], source}, settingsFiles:[path] }` from `.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`, `.cursor/mcp.json`, `.codex/config.toml` (simple TOML parse for `[mcp_servers.x]`). Never include env values (mask).
- `src/agents/sessions.js` — Claude Code transcripts: `~/.claude/projects/<root with / replaced by ->/*.jsonl`. `export function createSessions(root, { home = os.homedir() } = {})` → `{ list(): Promise<[{tool:"claude", sessionId, title, startedAt, lastAt, messages, tokens:{input,output,cacheRead,cacheWrite}, filesTouched:[path]}]>, attribute(path, ts): Promise<AgentRef|null> }` — attribute finds the session whose tool_use (Write/Edit/MultiEdit/NotebookEdit file_path) touched that file closest before ts (±2 min). Parse incrementally & tolerate malformed lines. Also scan Codex `~/.codex/sessions/**/*.jsonl` best-effort.
- `src/agents/conflicts.js` — `export function createConflictRadar({ windowMs = 120000 })` → `{ note(event /*with agent*/), active(): [{ path, agents:[AgentRef], lastTs }] }` — flags a path touched by ≥2 distinct sessions within window.

### Agent D (Sonnet) — server, CLI, build: `src/server/*`, `src/cli.js`, `scripts/build.mjs`, `test/server.test.js`, `README.md`
- `src/server/app.js` — `export async function startServer(config)` → `{ url, close() }`. Wires store, git, analysis, health, agents. Plain `node:http`. Serves UI from an injected HTML string (`globalThis.__MDCTL_UI__` when bundled; in dev read `ui/dist/index.html`; if missing serve a tiny fallback page). Auth: if `config.token` set, require `?token=` or `Authorization: Bearer` (UI keeps token from the URL and sends it on API calls & SSE via `?token=`). If host isn't loopback and no token → auto-generate token and print it.
- Caches analysis results; recompute graph/lint lazily after changes (debounce 300ms).
- REST (all JSON, GET unless noted):
  - `/api/state` → `{ project:{root, name}, version, startedAt, counts:{files, tokens, byTool:{}, byKind:{}}, health:{score,grade,counts}, git:{available, branch, dirty} }`
  - `/api/files` → `FileEntry[]` (+ `gitStatus` field per file when available)
  - `/api/file?path=` → `{ entry, content, links:{out:Link[], in:Link[]}, history:HistoryEntry[], git:{log, status} }`
  - `/api/diff?path=&from=<historyId|"git:HEAD">&to=<historyId|"current">` → `{ path, from, to, hunks, added, removed }`
  - `/api/history?path=` → `HistoryEntry[]`; `/api/history/content?path=&id=` → `{ content }`
  - `POST /api/restore` body `{path,id}` → HistoryEntry (only if `config.allowWrite`; else 403)
  - `/api/events?since=<id>` → `Event[]`
  - `/api/graph` → `{ nodes, edges }`
  - `/api/context?dir=&tool=` → effectiveContext result; `/api/context/dirs` → `string[]`
  - `/api/health` → `{ score, grade, counts, byRule, issues: Issue[] }`
  - `/api/tasks` → task[]; `/api/decisions` → decision[]
  - `/api/git` → repoInfo
  - `/api/config` → readAgentConfig result
  - `/api/sessions` → sessions list; `/api/conflicts` → active conflicts
  - `/api/search?q=` → `[{ path, line, text }]` (case-insensitive, max 200)
- SSE `/api/stream` (`text/event-stream`): events named `event` (Event), `health` ({score,grade,counts}), `graph` ({changed:true}), `conflict` (conflict list), `ping` every 20s.
- `src/cli.js` — commands: `start` (default) `[--port n] [--host h] [--token t] [--open] [--write] [dir]`, `lint [--json] [dir]` (exit 1 if errors), `status [dir]` (short text summary), `init [dir]` (creates `.mdctl/` with `config.json` + copies the running bundle to `.mdctl/mdctl.mjs` when running bundled), `--version`, `--help`. Root = dir arg or cwd.
- `scripts/build.mjs` — 1) `vite build --config ui/vite.config.js` (UI owned by Agent E, outputs single inlined `ui/dist/index.html`); 2) esbuild bundle `src/cli.js` → `dist/mdctl.mjs` (platform node, format esm, target node18, bundle chokidar, banner `#!/usr/bin/env node` + `createRequire` shim), defining `globalThis.__MDCTL_UI__` to the HTML string; chmod +x.
- Result must work as: `node dist/mdctl.mjs /some/project` and `cp dist/mdctl.mjs project/.mdctl/ && node project/.mdctl/mdctl.mjs` (root = parent of `.mdctl` when the script lives inside a `.mdctl` folder and no dir is given).

### Agent E (Opus) — UI: `ui/**` only
- Svelte 5 + Vite, `ui/vite.config.js` with root `ui/`, output `ui/dist/index.html` as ONE file (inline all JS/CSS — write a tiny vite plugin or use build options; no external network at runtime, no CDN fonts → system font stack).
- Talks only to the REST + SSE API above (`?token=` passthrough). Must also run against a mock (`ui/src/mock.js`, enabled by `?mock=1` or when API unreachable in `vite dev`) so it can be developed before the server exists.
- Views: Overview (health, counts, live activity, hot files), Graph (animated d3-force, nodes pulse on change, color by tool, size by tokens), Files (tree + viewer + rendered markdown + history timeline + diff), Context (effective context per dir/tool with token meter), Health (issues grouped), Tasks/Decisions, Git, Agents (sessions + conflict radar + config view), Search (⌘K palette).
- Modern, dark-first (with light mode), animated, glassy, fast. Light markdown renderer written in-house (no heavy deps; `d3-force` allowed).
