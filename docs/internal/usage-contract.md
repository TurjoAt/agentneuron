# Usage analytics contract (1.1 round)

Internal contract between the backend (agent A), the Usage/Sessions UI (agent B) and the shell/linking UI (agent C).
Shapes below are the JSON the routes return. Every field may be `null` when the source has no data; the UI must cope.
All numbers are plain numbers (ms epoch for times, USD as float, tokens as integers).

## Sources (read-only)

| Source | Used for |
|---|---|
| `~/.claude/projects/<projectDirName(root)>/<session>.jsonl` | prompts, replies, thinking (duration only by default), tool_use / tool_result (`is_error`), usage (input/output/cache read/cache write), model, gitBranch, permissionMode, toolDenialKind, interrupts, `attributionMcpServer` / `attributionSkill`, `system` records (`turn_duration`, `stop_hook_summary`, `compact_boundary`), `cost-state`, `ai-title` / `custom-title` / `agent-name`, `file-history-snapshot` / `file-history-delta` |
| `.../<session>/subagents/agent-*.jsonl` | subagent transcripts (fleet) |
| `~/.claude/file-history/<session>/<hash>@vN` | file versions for before/after diffs |
| `~/.claude/history.jsonl` | typed prompts (`display`, `timestamp`, `project`, `sessionId`); `pastedContents` -> **count only, never returned** |
| `~/.claude/projects/<dir>/memory/*.md`, `~/.claude/plans/*.md` | memory & plans |
| `~/.claude/settings.json`, `<root>/.claude/settings*.json`, `~/.claude/mcp-needs-auth-cache.json` | settings audit |
| `~/.codex/sessions/**/rollout-*.jsonl` | Codex parity where a field exists (tokens, tool calls, prompts) |

**Never read:** `~/.claude/.credentials.json`, `~/.claude/sessions/*.key`, `~/.claude/remote/`, `~/.claude/state/`, `~/.claude/paste-cache/` (count files only). Enforce with a denylist in the reader and a test.

Scope: current project only by default. `config.usage.scope: "all"` (file or `--usage-scope all`, admin only) lets `?scope=all` read every `~/.claude/projects/*` directory; otherwise `scope=all` is a 403.

## Rules for the parser (agent A)

- Extend / consolidate the existing readers (`src/agents/sessions.js`, `src/agentcenter/transcript.js`, `src/agentcenter/costs.js`, `src/insights/transcripts.js`). New code lives in `src/usage/`; it must reuse `projectDirName`, `locateTranscript`, `listCodexTranscripts`, `readRegularAsync` (safeio) and the mtime+size cache pattern of `readTranscriptUsageCached`. No fourth independent parser.
- Async reads only on request paths; per-file cache keyed by `mtimeMs`+`size`; cap bytes per file (reuse `MAX_TRANSCRIPT_BYTES`); never walk synchronously on a request or health path.
- Unknown record types are ignored, missing fields become `null`, parsing never throws.
- **Exact vs estimated:** cost comes from `cost-state.totalCostUSD` when present (`exact: true`), otherwise from token usage x pricing (`exact: false`). Every aggregate carries a `coverage` object.
- All text goes through `maskSecretsInText` / `maskDeep`.

## Privacy (all routes)

- Prompt-like text uses only these keys so `redactPrompts` (src/live/coord.js) can strip it: `prompt`, `title`, `quote`, `lastPrompt`, `thinking`, `body` (memory/plan bodies), and timeline rows with `kind: 'prompt' | 'thinking'`. A extends `redactPrompts` to cover `thinking` and `body` keys and `kind: 'thinking'` rows.
- Each route: `liveAccess(ctx.config).prompts(role) ? out : redactPrompts(out)`.
- File versions / diffs: `liveAccess(ctx.config).diffs(role)` else 403.
- A viewer-token test per route.

## Routes (all GET, level `read`, registered in `src/server/routes/usage.js`)

Common query: `range` (`24h|7d|30d|90d|all`, default `30d`), `tool` (`claude|codex|all`, default `all`), `scope` (`project|all`).
Common envelope fields: `range: {from, to}`, `coverage: {sessions, exactCostSessions, durationTurns, transcripts}`, `generatedAt`.

### `/api/usage/summary`  (cockpit)
```js
{ range, coverage, generatedAt,
  kpis: { usd, usdExact /* part of usd from cost-state */, sessions, prompts, toolCalls, toolErrors, linesAdded, linesRemoved,
          tokens: { input, output, cacheRead, cacheWrite }, cacheHitRate /* 0..1 */, cacheSavedUsd, activeMs, medianTurnMs, p90TurnMs },
  series: [{ date /* YYYY-MM-DD */, usd, tokens, sessions, toolCalls, errors }],
  byModel: [{ model, usd, tokens, turns }],
  byBranch: [{ branch, usd, sessions }],
  byProject: [{ project, usd, sessions }] /* only with scope=all, else [] */,
  byAgent: [{ tool /* claude|codex */, usd, sessions }],
  budget: { dailyUsd /* config.usage.dailyBudgetUsd or null */, todayUsd, burnPerHourUsd, projectedTodayUsd, over: bool },
  anomalies: [{ id, kind: 'cost-spike'|'error-loop'|'context-jump'|'slow-turn'|'denials', severity: 'high'|'medium'|'low', message, session, ts }],
  tips: [{ id, message, kind: 'cache'|'model'|'context'|'tools' }] }
```

### `/api/usage/sessions`  (list; `q` filter on title)
```js
{ range, coverage, sessions: [{ sessionId, tool, title, startedAt, lastAt, branch, models: [string], usd, exact, tokens, prompts,
  toolCalls, errors, subagents, filesTouched: [path], compactions, linesAdded, linesRemoved, activeMs }] }
```

### `/api/usage/session?id=`  (replay)
```js
{ session: { /* row from /sessions */ },
  timeline: [{ id, ts, kind: 'prompt'|'thinking'|'text'|'tool'|'result'|'edit'|'compact'|'hook'|'interrupt'|'denied'|'subagent'|'error',
    prompt? /* kind prompt */, thinking? /* kind thinking, only with prompts allowed; otherwise durationMs only */, text?, tool?, input? /* short summary */,
    isError?, durationMs?, path?, agentId?, model?, tokens?, usd? }],
  agents: [{ agentId, name, model, parent /* agentId|null */, startedAt, endedAt, turns, tokens, usd, toolCalls }],
  files: [{ path, versions: [{ backup /* opaque id */, ts, messageId }] }] }
```

### `/api/usage/file-version?session=&backup=&path=`  (diffs; 403 unless `diffs(role)`)
```js
{ path, before /* string|null */, after /* string|null */, ts, truncated }
```

### `/api/usage/tools`
```js
{ range, coverage,
  tools: [{ name, kind: 'builtin'|'mcp'|'skill', server /* mcp server or null */, calls, errors, errorRate, denied, avgMs, p90Ms, lastAt }],
  mcpServers: [{ server, calls, errors, needsAuth: bool }],
  skills: [{ name, calls }],
  hooks: { runs, errors, preventedStops },
  interrupts, denials,
  loops: [{ session, tool, count, sample, ts }] /* same tool failing >= 3x in a row */ }
```

### `/api/usage/prompts?q=&limit=`
```js
{ range, stats: { total, avgLength, interruptedRate, reworkRate },
  prompts: [{ id, ts, session, tool, prompt, length, outcome: { toolCalls, errors, interrupted, rework, usd, durationMs } }],
  repeated: [{ id, prompt, count, sessions, lastAt, suggestion: { kind: 'command'|'skill', name } }] }
```

### `/api/usage/fleet`
```js
{ range, runs: [{ sessionId, title, tool, startedAt, usd, model,
  nodes: [{ id /* 'main' or agentId */, name, model, kind: 'main'|'subagent'|'advisor', turns, tokens, usd, toolCalls, startedAt, endedAt }],
  edges: [{ from, to, kind: 'spawn'|'message'|'advice' }] }] }
```

### `/api/usage/impact`
```js
{ range, exact /* lines from cost-state */, linesAdded, linesRemoved,
  files: [{ path, edits, sessions, linesAdded, linesRemoved, lastAt, tools: [string] }],
  churn: [{ date, added, removed }] }
```

### `/api/usage/activity`
```js
{ range, heatmap: [{ date, sessions, prompts, usd }], hourly: [/* 24 */], weekHour: [/* 7 x 24, Monday first */],
  turns: { count, medianMs, p90Ms, maxMs }, sessions: [{ sessionId, startedAt, endedAt, activeMs, prompts }], focusMs, awayCount }
```

### `/api/usage/memory`
```js
{ memory: [{ project, file, name, description, type, body, updatedAt, links: [string], stale: [{ claim, reason }] }],
  plans: [{ file, title, updatedAt, body }] }
```

### `/api/usage/settings`
```js
{ settings: { model, advisorModel, autoMode, theme, hooks, permissions: { allow, deny, ask } } /* masked */,
  permissionModes: { auto, plan, default, acceptEdits, bypassPermissions },
  mcpNeedsAuth: [string],
  findings: [{ id, severity: 'high'|'medium'|'low'|'info', title, why, fix, location }] }
```

### `/api/usage/entity?kind=&id=`  (side panel)
kinds: `session` (sessionId), `file` (project-relative path), `commit` (hash), `task` (task id), `tool` (tool name), `model` (model id), `agent` (`claude|codex`).
```js
{ kind, id, title, subtitle, stats: [{ label, value, unit? }],
  related: { sessions: [{ sessionId, title, ts }], files: [{ path, edits }], commits: [{ hash, subject, ts }], tasks: [{ id, title, status }], tools: [{ name, calls }] },
  links: [{ label, href }] /* deep links into views */ }
```

## MCP tools (read level)
- `get_usage({ range })` -> summary (no prompt text).
- `get_session_replay({ id, limit })` -> session + timeline (prompts follow the MCP prompt policy: included, masked).
- `get_tool_health({ range })` -> tools route payload.

## CLI
`agentneuron usage [dir] [--range 7d] [--json] [--scope project|all]` prints the KPIs, top models, top tools, anomalies.

## Config (`.agentneuron/config.json`)
```json
{ "usage": { "scope": "project", "dailyBudgetUsd": null } }
```

## UI (views and hashes)

| View id | Owner | Content |
|---|---|---|
| `usage` (tabs `overview`, `tools`, `prompts`, `fleet`, `impact`, `activity`) | B (activity: C) | `ui/src/views/Usage.svelte`, `ui/src/views/usage/*.svelte` |
| `sessions` (`?id=` opens replay) | B | `ui/src/views/Sessions.svelte`, `ui/src/views/sessions/*.svelte` |
| `memory` (tabs `memory`, `plans`) | C | `ui/src/views/Memory.svelte`, `ui/src/views/memory/*` |
| `verify?tab=settings` | C | new `ui/src/views/verify/SettingsAudit.svelte` |
| Entity side panel | C | `ui/src/lib/entity.svelte.js`, `ui/src/lib/EntityLink.svelte`, `ui/src/lib/EntityDrawer.svelte` |

Redirects (in `nav.js`): `agents?tab=sessions` -> `sessions`, `insights?tab=replay` -> `sessions` (keeps `session`/`path`/`ts` params).

`EntityLink` usage: `<EntityLink kind="session" id={s.sessionId} label={s.title} />`. Plain click opens the side panel; Ctrl/Cmd-click or middle-click follows `entityHref(kind, id)`.

`entityHref(kind, id)`: session -> `#/sessions?id=`, file -> `#/files?path=`, commit -> `#/git?tab=log&commit=`, task -> `#/tasks?task=`, tool -> `#/usage?tab=tools&tool=`, model -> `#/usage?tab=overview&model=`, agent -> `#/usage?tab=overview&tool=`.

Mocks: B owns `ui/src/mock-usage.js`; C owns `ui/src/mock-usage-shell.js` (memory, settings, activity, entity). Both are already merged into `mock.js`. Mock data is synthetic: never copy real numbers from a developer machine.
