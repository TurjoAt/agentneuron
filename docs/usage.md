# Usage, cost and sessions

AgentNeuron reads the files Claude Code and Codex keep on your machine and turns them into usage figures: cost, tokens, cache use, tool health, session replays, file versions, memory files and a settings audit. Nothing is sent anywhere, and nothing is written to the agents' files.

The same data is available in the dashboard (Usage, Sessions and Memory views, and the settings tab of Verify), over [HTTP](http-api.md#usage-analytics), through the [MCP tools](mcp.md) `get_usage`, `get_session_replay` and `get_tool_health`, and on the command line with [`agentneuron usage`](cli.md#usage-dir).

The format of these files is not documented by Anthropic or OpenAI and changes between versions. AgentNeuron ignores record types it does not know, treats missing fields as unknown (`null`), and skips lines it cannot parse.

## What is read

| Source | Used for |
|---|---|
| `~/.claude/projects/<project>/<session>.jsonl` | Prompts, replies, thinking duration, tool calls and results, token usage, model, git branch, permission mode, denials, interrupts, hooks, compactions, turn durations, recorded cost, titles, file-history entries |
| `~/.claude/projects/<project>/<session>/subagents/agent-*.jsonl` and `agent-*.meta.json` | Subagent transcripts and their type, description and parent |
| `~/.claude/file-history/<session>/<hash>@vN` | File contents before each agent edit (file versions) |
| `~/.claude/history.jsonl` | Typed prompts. Pasted content is only counted, never returned |
| `~/.claude/projects/<project>/memory/*.md` | Memory files |
| `~/.claude/plans/*.md` | Plans, only those whose name matches a plan slug in this project's sessions |
| `~/.claude/settings.json`, `<project>/.claude/settings.json`, `<project>/.claude/settings.local.json`, `~/.claude/mcp-needs-auth-cache.json` | Settings audit |
| `~/.codex/sessions/**/rollout-*.jsonl` | Codex sessions whose working directory is the project (prompts, shell commands and their exit codes, patches, total tokens) |

`<project>` is the project path with every character other than a letter or digit replaced by `-`. If no such directory exists, AgentNeuron looks for a directory whose transcripts record the project path as their working directory. Sessions started in a subdirectory of the project, or in another checkout of it, belong to a different directory and are not counted under `scope: project`.

**Never read**, enforced in the reader for the requested path and for the real path behind a symlink: `~/.claude/.credentials.json`, `~/.claude/sessions/*.key`, `~/.claude/remote/`, `~/.claude/state/`, `~/.claude/paste-cache/`, and `~/.codex/auth.json`.

Only the last 64 MB of a transcript are read. Records of type `api-request*`, `queue-operation` and `atis-latch` are skipped without parsing.

## Scope

By default every figure covers the current project only. With `"usage": { "scope": "all" }` in `.agentneuron/config.json`, an admin can pass `scope=all` to read every directory under `~/.claude/projects` and every Codex session. Viewers always get the project scope, and a `scope=all` request without the config key is refused with 403. The CLI runs as you and accepts `--scope all` without the config key.

## Metrics

| Metric | Meaning |
|---|---|
| Cost (`usd`) | See [Exact and estimated cost](#exact-and-estimated-cost). Includes subagents. |
| `usdExact` | The part of `usd` that comes from sessions with a recorded cost. |
| Tokens | `input` (uncached input), `output`, `cacheRead`, `cacheWrite` from each API response. A response written over several transcript lines counts once. Codex reports one cumulative total per session. |
| `cacheHitRate` | `cacheRead / (input + cacheRead + cacheWrite)`: the share of input tokens served from the prompt cache. |
| `cacheSavedUsd` | What the cache reads would have cost at the model's input price, minus what they cost at the cache-read price. |
| Sessions | Sessions with any activity in the range. |
| Prompts | Typed user messages. Injected text (system reminders, command output, tool results, continuation summaries) and interrupts are not prompts. |
| Tool calls, errors | One per `tool_use`. An error is a result with `is_error`. A call the user or a permission rule denied counts as `denied`, not as an error. Codex shell commands count as errors when they exit non-zero. |
| Tool duration (`avgMs`, `p90Ms`) | Time between the tool call record and its result record. Approximate: it includes time spent waiting for a permission prompt. |
| Lines added/removed | From the recorded totals (`cost-state`) when the whole session lies in the range; otherwise from successful edits (`structuredPatch` of the edit result, or the edit input when no result exists). |
| Active time (`activeMs`) | Sum of periods with transcript activity, where a gap over 5 minutes ends a period. Subagents running in parallel are not counted twice. |
| Turn time (`medianTurnMs`, `p90TurnMs`) | From the `turn_duration` records Claude Code writes at the end of a turn. `coverage.durationTurns` says how many there were. |
| `focusMs` | The longest single active period in the range. |
| `awayCount` | Number of "while you were away" summaries. |
| Budget | `todayUsd` is the cost since local midnight; `burnPerHourUsd` the average over the last three hours; `projectedTodayUsd` assumes that rate until midnight; `over` is true when `todayUsd` reaches `usage.dailyBudgetUsd`. |

Days (`series`, `heatmap`, `churn`) use the local time zone of the machine running AgentNeuron.

### Exact and estimated cost

Claude Code writes a `cost-state` record with the session's total cost (`totalCostUSD`). When a session has one, its cost is **exact** (`exact: true`), and it includes subagents and helper calls that do not appear in the transcript. If a session was resumed in a new process, the last record of each process is summed.

Without that record the cost is **estimated** (`exact: false`): tokens times the list price of the model family (`opus`, `sonnet`, `haiku`, `gpt`, `other`), overridable with [`pricing`](configuration.md#pricing). Codex sessions are always estimated.

Recorded costs are totals per session. To place them on days and filter them by range, AgentNeuron spreads the exact total over the session's responses in proportion to their estimated cost. Daily figures of exact sessions are therefore exact in sum but approximate per day.

### Coverage

Every aggregate carries `coverage`:

| Field | Meaning |
|---|---|
| `sessions` | Sessions included |
| `exactCostSessions` | Of those, sessions with a recorded cost |
| `durationTurns` | Turns with a recorded duration |
| `transcripts` / `totalTranscripts` | Transcript files read / found (main and subagent) |
| `partial` | `true` when some transcripts were not read yet (see below) |

Parsed transcripts are cached in memory by modification time and size. On a cold start the summary stops after about 2.5 seconds (other routes after 8 seconds), answers with what it has and `partial: true`, and keeps reading in the background; the next request has the rest. Transcripts last written before the start of the range are not read at all.

## Anomalies

| Kind | Rule |
|---|---|
| `cost-spike` | A session costs at least 3 times the median of the previous (up to 10) sessions and at least $1. `high` from 5 times. |
| `error-loop` | The same tool failed at least 3 times in a row. `high` from 5. |
| `context-jump` | One response wrote at least 100k tokens to the prompt cache and at least 5 times the session's median cache write. |
| `slow-turn` | A turn longer than the 95th percentile of turns in the range and at least 2 minutes (the 5 slowest; needs 10 turns). |
| `denials` | 3 or more denied tool calls in a session. `medium` from 5. |

## Tips

Shown when they apply: a cache hit rate under 50% (with over 1M input tokens), more cache writes than reads, 85% or more of spend on Opus-class models (from $5), at least one compaction per session (from 3), a tool failing in 20% or more of at least 10 calls, and 5 or more denied tool calls.

## Session replay and file versions

The replay is built when it is opened, from the main transcript: prompts, thinking, replies, tool calls and results, edits, denials, interrupts, hooks, compactions and subagent spawns, with the model, tokens and cost on the first row of each response. Subagents are listed under `agents`.

Thinking text is included only when the [live prompt policy](live.md#configuration) shows prompts (`live.showPrompts`, on by default for a loopback bind); otherwise thinking rows carry only their duration.

`files` lists the versions Claude Code saved in `~/.claude/file-history`. A version's `before` is the saved copy; its `after` is the next saved copy, or for the newest version the file as it is now on disk (only for files inside the project). A version with no saved copy (the file did not exist yet) has the id `new@vN` and `before: null`. Files over 1 MB return `truncated: true`. File versions are admin-only unless `live.viewerDiffs` is set.

## Memory, plans and settings

Memory files are read from the project's `memory/` directory with their frontmatter (`name`, `description`, `metadata.type`). Backticked project paths in the body that no longer exist are listed under `stale`. Plans live in one global directory, so only plans whose file name matches a plan slug recorded in this project's sessions are returned.

The settings audit merges the user and project settings and reports: `bypassPermissions` as the default mode or used in sessions, broad allow rules such as `Bash(*)`, writes allowed everywhere, a disabled bypass warning, auto-enabled project MCP servers, MCP servers waiting for authentication, failing hooks, and the absence of deny rules. Values are masked; `env` blocks are not returned.

## Privacy

- Prompt-like text is returned only under the keys `prompt`, `title`, `quote`, `lastPrompt`, `thinking` and `body`, and in timeline rows of kind `prompt` and `thinking`. When the live prompt policy hides prompts from a role (by default: viewers, and everyone on a non-loopback bind unless `live.showPrompts` is set), these are blanked or removed. Session titles count as prompt text, because Claude Code often derives them from the first prompt.
- Every response goes through the secret masker.
- `pastedContents` from `history.jsonl` is never returned; prompts carry only `pasted`, the number of pasted items.
- The MCP tool `get_usage` returns no prompt text; `get_session_replay` follows the MCP prompt policy (included, masked).

## Configuration

```json
{ "usage": { "scope": "project", "dailyBudgetUsd": null } }
```

| Key | Default | Description |
|---|---|---|
| `usage.scope` | `"project"` | `"all"` lets admins request `scope=all` (every project and Codex session). |
| `usage.dailyBudgetUsd` | `null` | Daily budget in USD for the budget gauge and `budget.over`. |
